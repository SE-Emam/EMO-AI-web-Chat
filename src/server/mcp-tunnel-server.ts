/**
 * McpTunnelServer — Embedded MCP Tunnel Manager inside EMO-AI Gateway.
 *
 * Implements official OpenAI Secure MCP Tunnel protocol (v0.0.21 / protocol.md / openapi.json)
 * and provides isolated tunneling for Cloudflare and Ngrok via a dedicated MCP-only listener.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
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

export function parseResponseTimeout(val: unknown): number | null {
  if (typeof val !== "string") return null;
  const match = val.match(/^(\d+)(ns|us|ms|s|m|h)$/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "ns": return Math.max(0, Math.floor(num / 1_000_000));
    case "us": return Math.max(0, Math.floor(num / 1_000));
    case "ms": return num;
    case "s": return num * 1000;
    case "m": return num * 60_000;
    case "h": return num * 3_600_000;
    default: return null;
  }
}

export interface TunnelCommand {
  request_id: string;
  shard_token: string;
  command_type: 'jsonrpc' | 'session_termination' | string;
  channel?: string;
  created_at?: string;
  response_timeout?: string | number | null;
  headers?: Record<string, string | string[]>;
  jsonrpc?: unknown;
}

export interface TunnelPollResponse {
  commands?: TunnelCommand[];
}

/**
 * Dedicated loopback reverse-proxy that ONLY serves /mcp and /health.
 * All management endpoints (/api/gateway/*), model completions (/v1/*), and UI are strictly blocked.
 * This listener is the target for Cloudflare and Ngrok tunnels.
 */
export class DedicatedMcpProxy {
  private server: http.Server | null = null;
  public port = 0;

  async start(targetMcpPort: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const url = req.url || '';
        const pathname = url.split('?')[0];

        // 1. Health check
        if (pathname === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, status: 'healthy', service: 'mcp-tunnel-proxy' }));
          return;
        }

        // 2. MCP Endpoint only
        if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
          const proxyReq = http.request(
            {
              hostname: '127.0.0.1',
              port: targetMcpPort,
              path: url,
              method: req.method,
              headers: {
                ...req.headers,
                host: `127.0.0.1:${targetMcpPort}`,
              },
            },
            (proxyRes) => {
              res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
              proxyRes.pipe(res);
            }
          );
          proxyReq.on('error', (err) => {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: { message: 'Failed to connect to local MCP service', details: err.message },
              })
            );
          });
          req.pipe(proxyReq);
          return;
        }

        // 3. Strictly block all other endpoints
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: 'TUNNEL_ACCESS_DENIED: Access to management API, chat completions, and UI is forbidden over public tunnel.',
              code: 'TUNNEL_ACCESS_DENIED',
            },
          })
        );
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server?.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          resolve(this.port);
        } else {
          reject(new Error('Failed to bind dedicated MCP proxy'));
        }
      });
      this.server.on('error', reject);
    });
  }

  stop(): void {
    if (this.server) {
      try {
        this.server.close();
      } catch {}
      this.server = null;
    }
    this.port = 0;
  }
}

/**
 * Native Node.js long-poll worker implementing the official OpenAI Secure MCP Tunnel client protocol.
 * Strictly adheres to protocol.md and openapi.json.
 */
export class OpenAiTunnelPoller {
  private running = false;
  private abortController: AbortController | null = null;
  private routingShardToken: string | null = null;
  private lastPolicyRevision = -1;

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
    const base = this.baseUrl.replace(/\/$/, "");
    const pollUrl = `${base}/v1/tunnels/${encodeURIComponent(this.tunnelId)}/poll?limit=25&timeout_ms=15000`;
    const responseUrl = `${base}/v1/tunnels/${encodeURIComponent(this.tunnelId)}/response`;

    while (this.running) {
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          'X-Tunnel-Client-Capabilities': 'wrong-cluster-v1',
          'X-Tunnel-Client-Name': 'emo-ai-web',
          'X-Tunnel-Client-Version': '0.1.0',
          'X-Tunnel-Client-Wire-Protocol-Version': '2026-08-25',
          'X-Tunnel-MCP-Server-Info': JSON.stringify({ version: 1, channels: [{ name: 'main' }] }),
        };
        if (this.routingShardToken) {
          headers['X-Tunnel-Shard-Token'] = this.routingShardToken;
        }

        const res = await fetch(pollUrl, {
          method: 'GET',
          headers,
          signal: this.abortController?.signal,
        });

        if (res.status === 200) {
          this.onStateChange?.('running', null);
          const localReceiptMonotonic = process.hrtime.bigint();
          const data = (await res.json()) as TunnelPollResponse;
          const commands = Array.isArray(data?.commands) ? data.commands : [];

          for (const cmd of commands) {
            await this.handleCommand(cmd, responseUrl, localReceiptMonotonic);
          }
        } else if (res.status === 204) {
          this.onStateChange?.('running', null);
          continue;
        } else if (res.status === 409) {
          // Check for wrong_cluster routing correction (protocol.md / routing-correction.md)
          const errBody = await res.json().catch(() => ({}));
          if (errBody?.error?.code === 'wrong_cluster') {
            const shardToken = res.headers.get('x-tunnel-shard-token');
            const policyRevision = errBody?.error?.policy_revision;
            if (shardToken && typeof policyRevision === 'number' && policyRevision >= this.lastPolicyRevision) {
              this.routingShardToken = shardToken;
              this.lastPolicyRevision = policyRevision;
            }
          }
          await new Promise((r) => setTimeout(r, 500));
        } else if (res.status === 401 || res.status === 403) {
          const authErr = `Authentication failed (HTTP ${res.status}). Check your OpenAI API key and tunnel permissions.`;
          this.onStateChange?.('error', authErr);
          await new Promise((r) => setTimeout(r, 10_000));
        } else {
          await new Promise((r) => setTimeout(r, 3_000));
        }
      } catch (err: any) {
        if (!this.running || err?.name === 'AbortError') break;
        this.onStateChange?.('error', err?.message || 'Connection error');
        await new Promise((r) => setTimeout(r, 3_000));
      }
    }
  }

  private async handleCommand(
    cmd: TunnelCommand,
    responseUrl: string,
    localReceiptMonotonic: bigint
  ): Promise<void> {
    const timeoutMs = parseResponseTimeout(cmd.response_timeout);
    let deadline: bigint | null = null;
    if (timeoutMs !== null) {
      deadline = localReceiptMonotonic + BigInt(timeoutMs) * 1_000_000n;
    }

    // Check monotonic expiration before starting work
    if (deadline !== null && process.hrtime.bigint() > deadline) {
      return;
    }

    if (cmd.command_type === 'session_termination') {
      let sessionId: string | undefined;
      if (cmd.headers) {
        for (const [k, v] of Object.entries(cmd.headers)) {
          if (k.toLowerCase() === 'mcp-session-id') {
            sessionId = Array.isArray(v) ? v[0] : String(v);
            break;
          }
        }
      }

      if (sessionId) {
        await fetch(`http://127.0.0.1:${this.localMcpPort}/mcp`, {
          method: 'DELETE',
          headers: {
            ...(this.gatewayApiKey ? { Authorization: `Bearer ${this.gatewayApiKey}` } : {}),
            'mcp-session-id': sessionId,
          },
        }).catch(() => {});
      }

      if (deadline !== null && process.hrtime.bigint() > deadline) {
        return;
      }

      await fetch(responseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'X-Tunnel-Shard-Token': cmd.shard_token,
          'X-Tunnel-Client-Capabilities': 'wrong-cluster-v1',
        },
        body: JSON.stringify({
          request_id: cmd.request_id,
          channel: cmd.channel || 'main',
          resp_code: 204,
          resp_type: 'session_termination_response',
        }),
      }).catch(() => {});
      return;
    }

    if (cmd.command_type === 'jsonrpc') {
      let mcpAbortController: AbortController | undefined;
      let timer: NodeJS.Timeout | undefined;

      if (deadline !== null) {
        const remainingMs = Number((deadline - process.hrtime.bigint()) / 1_000_000n);
        if (remainingMs <= 0) return;
        mcpAbortController = new AbortController();
        timer = setTimeout(() => mcpAbortController?.abort(), remainingMs);
      }

      const forwardHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.gatewayApiKey) {
        forwardHeaders.Authorization = `Bearer ${this.gatewayApiKey}`;
      }
      if (cmd.headers) {
        for (const [k, v] of Object.entries(cmd.headers)) {
          const lk = k.toLowerCase();
          const valStr = Array.isArray(v) ? v.join(', ') : String(v);
          if (lk === 'mcp-session-id') forwardHeaders['mcp-session-id'] = valStr;
          if (lk === 'mcp-protocol-version') forwardHeaders['mcp-protocol-version'] = valStr;
        }
      }

      let mcpStatusCode = 200;
      let mcpPayload: unknown;
      const respHeaders: Record<string, string[]> = {
        'Content-Type': ['application/json'],
      };

      try {
        const mcpRes = await fetch(`http://127.0.0.1:${this.localMcpPort}/mcp`, {
          method: 'POST',
          headers: forwardHeaders,
          body: JSON.stringify(cmd.jsonrpc),
          signal: mcpAbortController?.signal,
        });
        mcpStatusCode = mcpRes.status;
        mcpPayload = await mcpRes.json().catch(() => ({}));

        const allowlist = [
          'content-type',
          'mcp-session-id',
          'mcp-protocol-version',
          'last-event-id',
          'access-control-expose-headers',
          'www-authenticate',
          'x-tunnel-mcp-request-id',
        ];
        mcpRes.headers.forEach((val, key) => {
          if (allowlist.includes(key.toLowerCase())) {
            respHeaders[key] = [val];
          }
        });
      } catch (e: any) {
        if (e?.name === 'AbortError' || (deadline !== null && process.hrtime.bigint() > deadline)) {
          return;
        }
        mcpStatusCode = 502;
        mcpPayload = {
          error: {
            code: -32603,
            message: 'Bad Gateway',
            data: {
              tunnel_failure: {
                version: 1,
                source: 'connect',
                upstream_response_received: false,
              },
            },
          },
        };
      } finally {
        if (timer) clearTimeout(timer);
      }

      if (deadline !== null && process.hrtime.bigint() > deadline) {
        return;
      }

      await fetch(responseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'X-Tunnel-Shard-Token': cmd.shard_token,
          'X-Tunnel-Client-Capabilities': 'wrong-cluster-v1',
        },
        body: JSON.stringify({
          request_id: cmd.request_id,
          channel: cmd.channel || 'main',
          resp_code: mcpStatusCode,
          resp_type: 'jsonrpc_response',
          resp_headers: respHeaders,
          resp_json: mcpPayload,
        }),
      }).catch(() => {});
      return;
    }

    // Future / Unknown command type: log with request_id and continue polling without executing
    console.warn(`[OpenAiTunnelPoller] Unsupported command_type "${cmd.command_type}" on request_id "${cmd.request_id}". Ignoring.`);
  }
}

export class McpTunnelServer {
  private child: ChildProcess | null = null;
  private poller: OpenAiTunnelPoller | null = null;
  private dedicatedProxy: DedicatedMcpProxy | null = null;
  private state: TunnelState;

  constructor(private localPort: number = 8989) {
    this.state = {
      status: 'stopped',
      provider: 'custom',
      localUrl: `http://127.0.0.1:${localPort}/mcp`,
      publicUrl: null,
      publicMcpUrl: null,
      startedAt: null,
      error: null,
    };
  }

  setLocalPort(port: number): void {
    this.localPort = port;
    this.state.localUrl = `http://127.0.0.1:${port}/mcp`;
  }

  getState(): TunnelState {
    return { ...this.state };
  }

  async start(options: {
    provider: TunnelProvider;
    tunnelId?: string;
    tunnelToken?: string;
    token?: string;
    customBaseUrl?: string;
    customUrl?: string;
    gatewayApiKey?: string;
    port?: number;
  }): Promise<TunnelState> {
    const port = options.port ?? this.localPort;
    this.setLocalPort(port);
    const { provider, tunnelId } = options;
    const tunnelToken = options.tunnelToken || options.token;
    const customBaseUrl = options.customBaseUrl || options.customUrl;
    const gatewayApiKey = options.gatewayApiKey;

    await this.stop();

    // 1. OpenAI Secure Tunnel
    if (provider === 'openai') {
      if (!tunnelId || !tunnelToken) {
        throw new Error('Both tunnelId and tunnelToken (OpenAI API key) are required for OpenAI tunnels.');
      }

      this.state.status = 'starting';
      this.state.provider = 'openai';
      this.state.tunnelId = tunnelId;
      this.state.error = null;

      const base = customBaseUrl || 'https://api.openai.com';
      this.poller = new OpenAiTunnelPoller(
        tunnelId,
        tunnelToken,
        port,
        base,
        gatewayApiKey,
        (status, error) => {
          this.state.status = status;
          if (error !== undefined) this.state.error = error;
        }
      );
      this.poller.start();

      this.state.mode = 'native-poller';
      this.state.publicMcpUrl = `openai-tunnel://${tunnelId}`;
      this.state.publicUrl = `https://platform.openai.com/settings/organization/tunnels`;
      this.state.startedAt = Date.now();
      return this.getState();
    }

    // 2. Custom Proxy Mode
    if (provider === 'custom') {
      const base = customBaseUrl?.replace(/\/$/, '') || null;
      const publicMcpUrl = base ? `${base}/mcp` : null;

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

    // 3. Automated Cloudflare or Ngrok Tunnel with Dedicated MCP-Only Loopback Proxy
    this.state.status = 'starting';
    this.state.provider = provider;
    this.state.error = null;

    // Spin up the isolated proxy listener for Cloudflare/Ngrok
    this.dedicatedProxy = new DedicatedMcpProxy();
    const proxyPort = await this.dedicatedProxy.start(port);

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
          try {
            if (fs.existsSync(p)) return p;
          } catch {}
        }
        return name;
      };

      try {
        if (provider === 'cloudflared') {
          const bin = findBin('cloudflared');
          this.child = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${proxyPort}`], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        } else if (provider === 'ngrok') {
          const bin = findBin('ngrok');
          this.child = spawn(bin, ['http', String(proxyPort), '--log=stdout'], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        } else {
          clearTimeout(timeout);
          return reject(new Error(`Unsupported tunnel provider: ${provider}`));
        }

        this.state.pid = this.child.pid;

        const handleOutput = (chunk: Buffer) => {
          const text = chunk.toString();
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
            resolve(this.getState());
            return;
          }
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
    if (this.dedicatedProxy) {
      this.dedicatedProxy.stop();
      this.dedicatedProxy = null;
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
