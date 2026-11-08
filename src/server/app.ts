import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { ArenaDriver, ChatCompletionRequest, Config } from '../types.js';
import { loadConfig } from '../config.js';
import {
  formatChatCompletionChunk,
  formatChatCompletionResponse,
  formatDoneChunk,
  formatModelList,
} from './openai-formatter.js';
import type { GatewayConfigFile } from '../gateway/types.js';
import type { ProviderManager } from '../gateway/provider-manager.js';
import type { UsageTracker } from '../gateway/usage-tracker.js';
import { registerGatewayRoutes } from './gateway-routes.js';
import { registerGatewayUi } from '../gateway/ui.js';

export interface GatewayServerOptions {
  mode: 'gateway';
  manager: ProviderManager;
  tracker: UsageTracker;
  gatewayConfig: GatewayConfigFile;
}

function isDriver(v: unknown): v is ArenaDriver {
  return !!v && typeof v === 'object' && typeof (v as any).sendMessage === 'function' && typeof (v as any).listModels === 'function';
}

function getApiKey(req: FastifyRequest): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  const x = req.headers['x-api-key'];
  if (typeof x === 'string') return x.trim();
  if (Array.isArray(x)) return x[0]?.trim();
  return undefined;
}

function promptChars(messages: ChatCompletionRequest['messages'] | undefined): number {
  if (!Array.isArray(messages)) return 0;
  let n = 0;
  for (const m of messages) n += String(m?.content || '').length;
  return n;
}

/**
 * Creates and configures the Fastify server instance with OpenAI-compatible routes.
 * Legacy: createServer(driver, config?)
 * Gateway: createServer({ mode:'gateway', manager, tracker, gatewayConfig })
 */
export function createServer(driverOrGateway: ArenaDriver | GatewayServerOptions, config?: Partial<Config>): FastifyInstance {
  const gatewayMode = !isDriver(driverOrGateway) && (driverOrGateway as any)?.mode === 'gateway';
  const gateway = gatewayMode ? (driverOrGateway as GatewayServerOptions) : undefined;
  const driver: ArenaDriver = gatewayMode ? gateway!.manager.getActiveDriver() : (driverOrGateway as ArenaDriver);

  const loadedConfig = gatewayMode ? undefined : loadConfig(config);
  void loadedConfig;
  const requireApiKey = gatewayMode ? !!gateway!.gatewayConfig.gateway.requireApiKey : false;
  const apiKey = gatewayMode ? String(gateway!.gatewayConfig.gateway.apiKey || 'mac') : '';

  const app = Fastify({ logger: false, bodyLimit: 2_500_000 });

  app.addHook('onRequest', async (request, reply) => {
    const url = request.raw.url || '';
    const isMgmtOrUi = url.startsWith('/api/gateway/') || url === '/' || url === '/ui' || url.startsWith('/ui?');
    if (isMgmtOrUi) {
      // No wildcard CORS for management/UI — prevent any website from reading localhost state (defense-in-depth against DNS-rebinding/CSRF).
      const origin = request.headers.origin;
      if (origin) {
        const allowed = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) || origin === 'null';
        if (allowed) reply.header('Access-Control-Allow-Origin', origin);
      }
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With');
      reply.header('X-Frame-Options', 'SAMEORIGIN');
      reply.header('Referrer-Policy', 'no-referrer');
      reply.header('Cache-Control', 'no-store');
      reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'");
      if (request.method === 'OPTIONS') return reply.status(204).send();
      return;
    }
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (request.method === 'OPTIONS') return reply.status(204).send();
  });

  if (requireApiKey) {
    app.addHook('onRequest', async (request, reply) => {
      const url = request.raw.url || '';
      // Protect /v1/* and management API /api/gateway/* — UI and / are only for local display.
      // Allow /health and / without auth (health probes and the management UI shell).
      if (!url.startsWith('/v1/') && !url.startsWith('/api/gateway/')) return;
      const provided = getApiKey(request);
      if (provided !== apiKey) {
        return reply.status(401).send({ error: { message: 'Invalid or missing API key', type: 'authentication_error' } });
      }
    });
  }

  if (gateway) {
    registerGatewayUi(app, { apiKey });
    registerGatewayRoutes(app, {
      manager: gateway.manager,
      tracker: gateway.tracker,
      getGatewayConfig: () => gateway.gatewayConfig,
    });
  } else {
    const healthHandler = async () => ({ status: 'ok', service: 'arena-web-api' });
    app.get('/', healthHandler);
  }
  app.get('/health', async () => ({ status: 'ok', service: 'arena-web-api' }));
  app.get('/ready', async (_req, reply) => {
    try {
      const models = await driver.listModels();
      return reply.send({ status: 'ready', service: 'arena-web-api', models: models.length });
    } catch (err) {
      return reply.status(503).send({ status: 'not_ready', error: { message: err instanceof Error ? err.message : 'driver unavailable' } });
    }
  });

  app.get('/v1/models', async (_request, reply) => {
    try {
      const models = await driver.listModels();
      return reply.send(formatModelList(models));
    } catch (err: unknown) {
      const error = err as { statusCode?: number; type?: string; message?: string };
      return reply.status(error.statusCode || 500).send({ error: { message: error.message || 'Failed to list models', type: error.type || 'server_error' } });
    }
  });

  app.post('/v1/chat/completions', async (request, reply) => {
    const body = request.body as Partial<ChatCompletionRequest> | undefined;
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      return reply.status(400).send({ error: { message: 'Invalid request: "messages" is required and must be a non-empty array', type: 'invalid_request_error' } });
    }
    const model = body.model && body.model.trim() ? body.model.trim() : 'auto';
    const id = `chatcmpl-${randomUUID()}`;
    const abortController = new AbortController();
    const onSocketClose = () => { if (!reply.raw.writableEnded) abortController.abort(); };
    request.raw.socket?.on('close', onSocketClose);
    request.raw.on('aborted', () => abortController.abort());

    const pChars = promptChars(body.messages as ChatCompletionRequest['messages']);
    gateway?.tracker.recordRequestStart({ model, stream: !!body.stream, promptChars: pChars });
    let completionChars = 0;

    try {
      if (body.stream) {
        let headersSent = false;
        const ensureHeaders = () => {
          if (!headersSent) {
            headersSent = true;
            reply.hijack();
            reply.raw.writeHead(200, {
              'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive',
              'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
            });
          }
        };
        try {
          await driver.sendMessage(model, body.messages as ChatCompletionRequest['messages'], (chunk: string) => {
            completionChars += chunk.length;
            ensureHeaders();
            reply.raw.write(formatChatCompletionChunk(id, model, chunk));
          }, abortController.signal);
          ensureHeaders();
          reply.raw.write(formatChatCompletionChunk(id, model, '', 'stop'));
          reply.raw.write(formatDoneChunk());
          reply.raw.end();
          gateway?.tracker.recordRequestEnd({ ok: true, completionChars });
        } catch (err: unknown) {
          const error = err as { statusCode?: number; type?: string; message?: string };
          gateway?.tracker.recordRequestEnd({ ok: false, completionChars });
          if (!headersSent) {
            return reply.status(error.statusCode || 500).send({ error: { message: error.message || 'Stream processing failed', type: error.type || 'server_error' } });
          }
          if (!reply.raw.destroyed && reply.raw.writable) {
            reply.raw.write(`data: ${JSON.stringify({ error: { message: error.message || 'Stream processing failed', type: error.type || 'server_error' } })}\n\n`);
            reply.raw.write(formatDoneChunk());
            reply.raw.end();
          }
        }
        return;
      }

      const fullResponse = await driver.sendMessage(model, body.messages as ChatCompletionRequest['messages'], undefined, abortController.signal);
      completionChars = String(fullResponse || '').length;
      gateway?.tracker.recordRequestEnd({ ok: true, completionChars });
      return reply.send(formatChatCompletionResponse(id, model, fullResponse));
    } catch (err: unknown) {
      const error = err as { statusCode?: number; type?: string; message?: string };
      gateway?.tracker.recordRequestEnd({ ok: false, completionChars });
      return reply.status(error.statusCode || 500).send({ error: { message: error.message || 'Chat completion failed', type: error.type || 'server_error' } });
    } finally {
      request.raw.socket?.off('close', onSocketClose);
    }
  });

  return app;
}
