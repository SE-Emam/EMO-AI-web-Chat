/**
 * McpTunnelServer — Embedded MCP Tunnel Manager inside EMO-AI Gateway.
 *
 * Provides a built-in reverse tunnel service to expose the local MCP endpoint
 * (http://127.0.0.1:<port>/mcp) to ChatGPT and OpenAI-hosted products, supporting:
 *  1. OpenAI Platform Organization Tunnels (https://platform.openai.com/settings/organization/tunnels)
 *     - Native in-memory long-poll worker (zero external binaries or downloads)
 *     - Or managed official tunnel-client binary if installed
 *  2. Cloudflare Quick Tunnel (cloudflared — zero-config, free HTTPS trycloudflare.com endpoint)
 *  3. Ngrok tunnel
 *  4. Custom HTTPS reverse-proxy endpoint
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';

export type TunnelProvider = 'cloudflared' | 'ngrok' | 'openai' | 'custom';
export type TunnelStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface TunnelState {
  status: TunnelStatus;
  provider: TunnelProvider;
  localUrl: string;
  publicUrl: string | null;
  publicMcpUrl: string | null;
  startedAt: number | null;
  pid?: number;
  tunnelId?: string | null;
  mode?: 'native-poller' | 'binary' | 'proxy' | 'cloudflared' | 'ngrok';
  error?: string | null;
}

/**
 * Native Node.js long-poll worker implementing the OpenAI Secure MCP Tunnel client protocol.
 * Connects outbound HTTPS to api.openai.com, fetches queued MCP commands from ChatGPT,
 * forwards them to the local MCP endpoint, and delivers the response back.
 * Zero external downloads required.
 */
export class OpenAiTunnelPoller {
  private running = false;
  private abortController: AbortController | null = null;

  constructor(
    private readonly tunnelId: string,
    private readonly apiKey: string,
    private readonly localMcpPort: number,
    private readonly baseUrl = 'https://api.openai.com',
    private readonly gatewayApiKey?: string,
    private readonly onStateChange?: (status: TunnelStatus, error?: string | null) => void
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.abortController = new AbortController();
    this.onStateChange?.('starting', null);
    this.pollLoop().catch((err) => {
      console.error('[OpenAiTunnelPoller] Fatal loop error:', err);
    });
  }

  stop(): void {
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
    this.onStateChange?.('stopped', null);
  }

  private async pollLoop(): Promise<void> {
    const base = this.baseUrl.replace(/\/$/, '');
    const pollUrl = `${base}/v1/tunnels/${encodeURIComponent(this.tunnelId)}/poll`;
    const responseUrl = `${base}/v1/tunnels/${encodeURIComponent(this.tunnelId)}/response`;

    console.log(`[OpenAiTunnelPoller] Started outbound long-poll for ${this.tunnelId}`);

    while (this.running) {
      try {
        const res = await fetch(pollUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
                      },
          signal: this.abortController?.signal,
        });

        if (res.status === 200) {
          this.onStateChange?.('running', null);
          const command = (await res.json()) as any;
          if (command && command.id && command.payload) {
            // Forward JSON-RPC request to local gateway MCP endpoint
            const mcpRes = await fetch(`http://127.0.0.1:${this.localMcpPort}/mcp`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(this.gatewayApiKey ? { Authorization: `Bearer ${this.gatewayApiKey}` } : {}),
              },
              body: JSON.stringify(command.payload),
            }).catch(() => null);

            const mcpPayload = mcpRes ? await mcpRes.json().catch(() => ({})) : { error: 'Local MCP endpoint unavailable' };

            // Return execution result to ChatGPT
            await fetch(responseUrl, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                id: command.id,
                response: mcpPayload,
              }),
            }).catch(() => {});
          }
        } else if (res.status === 408 || res.status === 504) {
          this.onStateChange?.('running', null);
          continue;
        } else if (res.status === 401 || res.status === 403) {
          const authErr = `Authentication failed (HTTP ${res.status}). Check your OpenAI API key and tunnel permissions.`;
          this.onStateChange?.('error', authErr);
          console.error(`[OpenAiTunnelPoller] ${authErr}`);
          await new Promise((r) => setTimeout(r, 10_000));
        } else {
          await new Promise((r) => setTimeout(r, 3_000));
        }
      } catch (err: any) {
        if (!this.running || err?.name === 'AbortError') break;
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
  }
}

export class McpTunnelServer {
  private child: ChildProcess | null = null;
  private poller: OpenAiTunnelPoller | null = null;
  private state: TunnelState = {
    status: 'stopped',
    provider: 'cloudflared',
    localUrl: 'http://127.0.0.1:8989/mcp',
    publicUrl: null,
    publicMcpUrl: null,
    startedAt: null,
    error: null,
  };

  constructor(private readonly port = 8989) {
    this.state.localUrl = `http://127.0.0.1:${port}/mcp`;
  }

  getState(): TunnelState {
    return { ...this.state };
  }

  async start(options: {
    provider?: TunnelProvider;
    tunnelId?: string;
    customUrl?: string;
    token?: string;
    port?: number;
    gatewayApiKey?: string;
  } = {}): Promise<TunnelState> {
    const provider = options.provider || (options.tunnelId || options.customUrl ? 'openai' : 'cloudflared');
    const port = options.port || this.port;
    this.state.localUrl = `http://127.0.0.1:${port}/mcp`;

    if (this.child || this.poller) {
      await this.stop();
    }

    // Custom or OpenAI Tunnel provided
    if (provider === 'openai' || provider === 'custom' || options.customUrl || options.tunnelId) {
      const tunnelId = options.tunnelId ? String(options.tunnelId).trim() : null;
      const base = String(options.customUrl || (tunnelId ? `https://api.openai.com/v1/mcp/${tunnelId}` : '')).trim();

      if (!base && !tunnelId) {
        throw new Error('Please provide the tunnel endpoint URL or tunnelId from OpenAI Platform (https://platform.openai.com/settings/organization/tunnels).');
      }

      const publicMcpUrl = tunnelId ? base : (base.endsWith('/mcp') ? base : `${base.replace(/\/$/, '')}/mcp`);

      if (tunnelId && options.token) {
        this.state = {
          status: 'starting',
          provider,
          localUrl: this.state.localUrl,
          publicUrl: base,
          publicMcpUrl,
          startedAt: Date.now(),
          tunnelId,
          mode: 'native-poller',
          error: null,
        };
        this.poller = new OpenAiTunnelPoller(
          tunnelId,
          options.token,
          port,
          undefined,
          options.gatewayApiKey,
          (status, error) => {
            this.state.status = status;
            if (error !== undefined) this.state.error = error;
          }
        );
        this.poller.start();
        return this.getState();
      }

      this.state = {
        status: 'running',
        provider,
        localUrl: this.state.localUrl,
        publicUrl: base,
        publicMcpUrl,
        startedAt: Date.now(),
        tunnelId,
        mode: 'proxy',
        error: null,
      };
      return this.getState();
    }

    // Automated Cloudflare or Ngrok Tunnel
    this.state.status = 'starting';
    this.state.provider = provider;
    this.state.error = null;

    return new Promise<TunnelState>((resolve, reject) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.state.status = 'error';
          this.state.error = 'Tunnel startup timed out after 30 seconds';
          reject(new Error(this.state.error));
        }
      }, 30_000);

      const findBin = (name: string): string => {
        const paths = [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`];
        for (const p of paths) {
          try { if (fs.existsSync(p)) return p; } catch {}
        }
        return name;
      };

      try {
        if (provider === 'cloudflared') {
          const bin = findBin('cloudflared');
          this.child = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${port}`], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        } else if (provider === 'ngrok') {
          const bin = findBin('ngrok');
          this.child = spawn(bin, ['http', String(port), '--log=stdout'], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        } else {
          clearTimeout(timeout);
          return reject(new Error(`Unsupported tunnel provider: ${provider}`));
        }

        this.state.pid = this.child.pid;

        const handleOutput = (chunk: Buffer) => {
          const text = chunk.toString();
          // Cloudflare regex: https://[a-zA-Z0-9-]+\.trycloudflare\.com
          const cfMatch = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/i);
          if (cfMatch && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            const pub = cfMatch[0];
            this.state.status = 'running';
            this.state.publicUrl = pub;
            this.state.publicMcpUrl = `${pub}/mcp`;
            this.state.startedAt = Date.now();
            this.state.mode = 'cloudflared';
            console.log(`[McpTunnelServer] Cloudflare Tunnel running: ${this.state.publicMcpUrl}`);
            resolve(this.getState());
            return;
          }
          // Ngrok regex: url=(https:\/\/[^\s]+)
          const ngrokMatch = text.match(/url=(https:\/\/[a-zA-Z0-9.-]+\.ngrok[^\s]+)/i);
          if (ngrokMatch && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            const pub = ngrokMatch[1];
            this.state.status = 'running';
            this.state.publicUrl = pub;
            this.state.publicMcpUrl = `${pub}/mcp`;
            this.state.startedAt = Date.now();
            this.state.mode = 'ngrok';
            console.log(`[McpTunnelServer] Ngrok Tunnel running: ${this.state.publicMcpUrl}`);
            resolve(this.getState());
            return;
          }
        };

        this.child.stdout?.on('data', handleOutput);
        this.child.stderr?.on('data', handleOutput);

        this.child.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            this.state.status = 'error';
            this.state.error = err.message;
            reject(err);
          }
        });

        this.child.on('exit', (code) => {
          this.state.status = 'stopped';
          this.state.publicUrl = null;
          this.state.publicMcpUrl = null;
          this.state.pid = undefined;
          this.child = null;
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            this.state.error = `Tunnel process exited with code ${code}`;
            reject(new Error(this.state.error));
          }
        });
      } catch (err) {
        clearTimeout(timeout);
        this.state.status = 'error';
        this.state.error = (err as Error).message;
        reject(err);
      }
    });
  }

  async stop(): Promise<TunnelState> {
    if (this.child) {
      try {
        this.child.kill('SIGTERM');
      } catch {}
      this.child = null;
    }
    if (this.poller) {
      this.poller.stop();
      this.poller = null;
    }
    this.state = {
      status: 'stopped',
      provider: this.state.provider,
      localUrl: this.state.localUrl,
      publicUrl: null,
      publicMcpUrl: null,
      startedAt: null,
      error: null,
    };
    return this.getState();
  }
}

export const mcpTunnelServer = new McpTunnelServer(8989);
