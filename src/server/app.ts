import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { ArenaDriver, ChatCompletionRequest, ChatMessage, Config } from '../types.js';
import { loadConfig } from '../config.js';
import {
  formatChatCompletionChunk,
  formatChatCompletionResponse,
  formatDoneChunk,
  formatModelList,
  formatToolCallChunks,
} from './openai-formatter.js';
import type { GatewayConfigFile } from '../gateway/types.js';
import type { ProviderManager } from '../gateway/provider-manager.js';
import type { UsageTracker } from '../gateway/usage-tracker.js';
import { registerGatewayRoutes } from './gateway-routes.js';
import { registerGatewayUi } from '../gateway/ui.js';
import { registerAnthropicRoutes } from './anthropic-routes.js';
import { registerGeminiRoutes } from './gemini-routes.js';
import { isValidApiKey, redactSecrets, restoreSecrets } from '../gateway/security.js';
import { SwarmCoordinator } from './swarm-coordinator.js';
import { injectToolsInstruction, parseToolCallsFromResponse, resolveToolChoice, decideToolOutcome, detectToolRefusal, hydrateToolResultNames, detectUnsupportedDependencyClaim, shouldAttemptNeutralCorrection, buildNeutralCorrectionMessage, deriveToolLifecycleState } from './tool-interpreter.js';
import type { SwarmRequest } from '../types.js';
import { chatSessionKey } from './chat-session-key.js';
import { RequestBroker, brokerKey, type SentController } from '../protocol/request-broker.js';
import { payloadFingerprint } from './request-broker-helpers.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { OwnerRoutingDriver, ProfileOwnerRouter, type ForwardBrokerContext } from '../ipc/profile-owner-router.js';
import { defaultBrokerStorePath } from '../protocol/request-broker.js';
import { SessionQueue } from '../sessions/session-queue.js';
import { ToolPipelineLogger } from './tool-pipeline-logger.js';

/**
 * Task 11 — request-scoped receiver broker context for cross-process
 * forwarding: the receiver's claim-once key flows into OwnerRoutingDriver
 * when a ProfileBusyError triggers a forward. AsyncLocalStorage keeps the
 * context per request — concurrent requests can never mix broker keys.
 */
const routingBrokerStorage = new AsyncLocalStorage<ForwardBrokerContext>();

/** Provider selection point for Task 11: a DYNAMIC resolver wrapper — the
 * resolved driver is re-evaluated per request (owner mandatory mod #3), so
 * account switches and RoutingDriver chains are always reflected. */
function makeRoutingAwareDriver(resolve: () => ArenaDriver): ArenaDriver {
  const router = new ProfileOwnerRouter({
    stateRoot: path.dirname(defaultBrokerStorePath()),
    brokerStorePath: defaultBrokerStorePath(),
  });
  return new OwnerRoutingDriver({
    resolve,
    router,
    nextForwardId: () => randomUUID(),
    getBrokerContext: () => routingBrokerStorage.getStore() ?? null,
  });
}

/**
 * Session identity for web-chat continuation (chatgpt-web-tool-bridge lesson:
 * never identify a session by the API key alone — two agent conversations may
 * share one key and would otherwise interleave into the same web chat).
 *
 * Priority: explicit client header `X-Chat-Session-ID`, then body
 * `metadata.session_id`, then a stable fingerprint of the task itself
 * (system prompt + first user message) so the same agent task keeps one web
 * conversation across requests without any client change.
 */
export interface GatewayServerOptions {
  mode: 'gateway';
  manager: ProviderManager;
  tracker: UsageTracker;
  gatewayConfig: GatewayConfigFile;
}

function isDriver(v: unknown): v is ArenaDriver {
  return !!v && typeof v === 'object' && typeof (v as any).sendMessage === 'function' && typeof (v as any).listModels === 'function';
}

export function detectClientAgent(req: FastifyRequest, fallback = 'OpenAI Client'): string {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const clientHeader = (req.headers['x-client-agent'] || req.headers['x-emo-client'] || req.headers['client'] || '').toString().toLowerCase();
  const all = `${ua} ${clientHeader}`;
  if (all.includes('cursor')) return 'Cursor';
  if (all.includes('windsurf')) return 'Windsurf';
  if (all.includes('opencode')) return 'OpenCode';
  if (all.includes('claude')) return 'Claude Code';
  if (all.includes('gemini')) return 'Gemini CLI';
  if (all.includes('roo')) return 'Roo Code';
  if (all.includes('cline')) return 'Cline';
  if (all.includes('continue')) return 'Continue';
  if (all.includes('aider')) return 'Aider';
  if (all.includes('sillytavern')) return 'SillyTavern';
  if (all.includes('openwebui') || all.includes('open-webui') || all.includes('open webui')) return 'Open WebUI';
  if (all.includes('kiro')) return 'Kiro Code';
  if (all.includes('librechat')) return 'LibreChat';
  if (all.includes('dify')) return 'Dify';
  if (all.includes('flowise')) return 'Flowise';
  if (all.includes('n8n')) return 'n8n';
  if (all.includes('anythingllm')) return 'AnythingLLM';
  if (all.includes('lobechat') || all.includes('lobehub')) return 'LobeHub';
  if (all.includes('antigravity')) return 'Antigravity';
  if (all.includes('codex')) return 'Codex';
  if (all.includes('zed')) return 'Zed';
  if (all.includes('hermes')) return 'Hermes';
  if (all.includes('python')) return 'Python SDK';
  if (all.includes('vscode') || all.includes('vs code')) return 'VS Code';
  if (all.includes('curl')) return 'cURL CLI';
  return fallback;
}

function getApiKey(req: FastifyRequest): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
    if (auth.trim()) return auth.trim();
  }
  const x = req.headers['x-api-key'];
  if (typeof x === 'string' && x.trim()) return x.trim();
  if (Array.isArray(x) && x[0]?.trim()) return x[0].trim();

  const goog = req.headers['x-goog-api-key'];
  if (typeof goog === 'string' && goog.trim()) return goog.trim();
  if (Array.isArray(goog) && goog[0]?.trim()) return goog[0].trim();

  const q = req.query as Record<string, unknown> | undefined;
  if (q && typeof q.key === 'string' && q.key.trim()) return q.key.trim();

  const rawUrl = req.raw.url || '';
  const qIdx = rawUrl.indexOf('?');
  if (qIdx >= 0) {
    try {
      const sp = new URLSearchParams(rawUrl.slice(qIdx + 1));
      const k = sp.get('key');
      if (k && k.trim()) return k.trim();
    } catch {}
  }
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
  // Task 11 (category C): in gateway mode the driver selection point is
  // wrapped with the dynamic OwnerRoutingDriver — ProfileBusyError triggers a
  // forward to the owning process instead of a plain 503. Non-gateway usage
  // (single local driver) is untouched.
  const driver: ArenaDriver = gatewayMode
    ? makeRoutingAwareDriver(() => gateway!.manager.getActiveDriver())
    : (driverOrGateway as ArenaDriver);

  const loadedConfig = gatewayMode ? undefined : loadConfig(config);
  void loadedConfig;
  const requireApiKey = gatewayMode ? !!gateway!.gatewayConfig.gateway.requireApiKey : false;
  const apiKey = gatewayMode ? String(gateway!.gatewayConfig.gateway.apiKey || 'emo.web') : '';
  // Claim-once request broker (opt-in via X-Request-Id; never breaks existing
  // clients). Durable across gateway restarts; every claim is cross-process.
  const requestBroker = new RequestBroker();

  // forceCloseConnections:'idle' pins Fastify's default explicitly: idle
  // keep-alives are reaped at close start (never aborting in-flight work).
  // Full shutdown termination is guaranteed by closeServerGracefully()
  // (continuous idle reaping + final closeAllConnections guard) — see
  // src/server/graceful-shutdown.ts.
  const app = Fastify({ logger: false, bodyLimit: 2_500_000, forceCloseConnections: 'idle' });

  const isGatewayServiceActive = (): boolean => {
    if (gateway && typeof (gateway.manager as any).isServiceRunning === 'function') {
      return (gateway.manager as any).isServiceRunning();
    }
    return true;
  };

  app.addHook('onRequest', async (request, reply) => {
    const url = request.raw.url || '';
    const isPublicStatic = url === '/logo.png' || url === '/logo-dark.png' || url === '/logo-light.png' || url === '/favicon.ico' || url === '/favicon.png' || url === '/apple-touch-icon.png' || url === '/app-icon-512.png' || url.startsWith('/vendors/');
    const isMgmtOrUi = isPublicStatic || url.startsWith('/api/gateway/') || url === '/' || url === '/ui' || url.startsWith('/ui?');
    if (isMgmtOrUi) {
      // No wildcard CORS for management/UI — prevent any website from reading localhost state (defense-in-depth against DNS-rebinding/CSRF).
      const origin = request.headers.origin;
      if (origin) {
        const allowed = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
        if (allowed) reply.header('Access-Control-Allow-Origin', origin);
      }
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With');
      reply.header('X-Frame-Options', 'SAMEORIGIN');
      reply.header('Referrer-Policy', 'no-referrer');
      if (!isPublicStatic) {
        reply.header('Cache-Control', 'no-store');
      }
      reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'");
      if (request.method === 'OPTIONS') return reply.status(204).send();
      return;
    }
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Goog-Api-Key, x-goog-api-key, X-Api-Key, x-api-key');
    if (request.method === 'OPTIONS') return reply.status(204).send();
  });

  // Guard: if gateway service is stopped, reject model generation calls with 503
  app.addHook('onRequest', async (request, reply) => {
    const url = request.raw.url || '';
    if (url.startsWith('/v1/chat/completions') || url.startsWith('/v1/messages') || url.startsWith('/v1beta')) {
      if (!isGatewayServiceActive()) {
        const msg = 'EMO-AI Gateway service is currently stopped. Please start the gateway service from the dashboard.';
        if (url.startsWith('/v1/messages')) {
          return reply.status(503).send({
            type: 'error',
            error: { type: 'service_unavailable', message: msg },
          });
        }
        if (url.startsWith('/v1beta')) {
          return reply.status(503).send({
            error: { code: 503, message: msg, status: 'UNAVAILABLE' },
          });
        }
        return reply.status(503).send({
          error: {
            message: msg,
            type: 'service_unavailable',
            code: 503,
          },
        });
      }
    }
  });

  if (requireApiKey) {
    app.addHook('onRequest', async (request, reply) => {
      const url = request.raw.url || '';
      // Protect /v1/*, /v1beta/* and management API /api/gateway/* — UI and / are only for local display.
      // Allow /health and / without auth (health probes and the management UI shell).
      if (!url.startsWith('/v1/') && !url.startsWith('/v1beta/') && !url.startsWith('/api/gateway/')) return;
      const provided = getApiKey(request);
      const scopedGroup = (gateway && typeof (gateway.manager as any).getGroupForApiKey === 'function' && provided)
        ? (gateway.manager as any).getGroupForApiKey(provided)
        : undefined;
      if (scopedGroup) (request as any).scopedRouterGroup = scopedGroup;
      const validKeys = (gateway && typeof gateway.manager.getValidApiKeys === 'function')
        ? gateway.manager.getValidApiKeys()
        : (apiKey ? [apiKey] : []);
      if (!provided || !isValidApiKey(provided, validKeys)) {
        if (url.startsWith('/v1/messages')) {
          return reply.status(401).send({
            type: 'error',
            error: { type: 'authentication_error', message: 'Invalid or missing API key' },
          });
        }
        if (url.startsWith('/v1beta/')) {
          return reply.status(401).send({
            error: {
              code: 401,
              message: 'API key not valid. Please pass a valid API key.',
              status: 'UNAUTHENTICATED',
            },
          });
        }
        return reply.status(401).send({ error: { message: 'Invalid or missing API key', type: 'authentication_error' } });
      }
    });
  } else {
    // Even when API key auth is not required, honor per-group scoped keys for routing.
    app.addHook('onRequest', async (request, _reply) => {
      const provided = getApiKey(request);
      const scopedGroup = (gateway && typeof (gateway.manager as any).getGroupForApiKey === 'function' && provided)
        ? (gateway.manager as any).getGroupForApiKey(provided)
        : undefined;
      if (scopedGroup) (request as any).scopedRouterGroup = scopedGroup;
    });
  }

  // Static Assets from public/ folder (resolved relative to package root, with fallback to cwd)
  const modulePublicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
  const servePublicFile = (relPath: string, contentType: string) => {
    return async (_req: FastifyRequest, reply: FastifyReply) => {
      for (const baseDir of [modulePublicDir, path.join(process.cwd(), 'public')]) {
        try {
          const full = path.join(baseDir, relPath);
          const buf = await fs.readFile(full);
          return reply.type(contentType).header('Cache-Control', 'public, max-age=86400').send(buf);
        } catch {}
      }
      return reply.status(404).send('Not Found');
    };
  };

  app.get('/logo.png', servePublicFile('logo.png', 'image/png'));
  app.get('/logo-dark.png', servePublicFile('logo-dark.png', 'image/png'));
  app.get('/logo-light.png', servePublicFile('logo-light.png', 'image/png'));
  app.get('/favicon.ico', servePublicFile('favicon.ico', 'image/x-icon'));
  app.get('/favicon.png', servePublicFile('favicon.png', 'image/png'));
  app.get('/apple-touch-icon.png', servePublicFile('apple-touch-icon.png', 'image/png'));
  app.get('/app-icon-512.png', servePublicFile('app-icon-512.png', 'image/png'));

  // Vendor brand logos (public/vendors/*) — png/webp only, path locked to the vendors subdir
  const vendorFile = (relPath: string) => {
    const safe = path.basename(relPath);
    if (!/\.(png|webp|jpg)$/i.test(safe)) return null;
    return servePublicFile(path.join('vendors', safe), safe.endsWith('.webp') ? 'image/webp' : safe.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
  };
  app.get('/vendors/:file', async (req, reply) => {
    const handler = vendorFile((req as FastifyRequest<{ Params: { file?: string } }>).params?.file || '');
    if (!handler) return reply.status(404).send('Not Found');
    return handler(req, reply);
  });

  if (gateway) {
    registerGatewayUi(app, { apiKey });
    registerGatewayRoutes(app, {
      manager: gateway.manager,
      tracker: gateway.tracker,
      getGatewayConfig: () => gateway.gatewayConfig,
    });
  } else {
    const healthHandler = async () => ({ status: 'ok', service: 'emo-ai-web' });
    app.get('/', healthHandler);
  }
  app.get('/health', async () => {
    // Task 14 — LOCAL state only. /health NEVER sends a message to ChatGPT
    // or any other provider (no driver calls in this handler), and never
    // reports a provider as "available" without an actual verification —
    // provider state stays 'not_checked'. No secrets are included.
    const routing = driver as Partial<{ resilienceSnapshot?: () => unknown }>;
    const brokerCounts = requestBroker.countByState();
    const providers =
      typeof routing.resilienceSnapshot === 'function' ? (routing.resilienceSnapshot() as unknown[]) : [];
    return {
      status: 'ok',
      service: 'emo-ai-web',
      gateway: {
        alive: true,
        uptimeMs: Math.round(process.uptime() * 1000),
        mode: gatewayMode ? 'gateway' : 'driver',
        browserServiceRunning: isGatewayServiceActive(),
      },
      // Profile ownership / IPC reachability are owned by the owner process;
      // without an actual check from THIS endpoint they stay not_checked.
      profileOwnership: { state: gatewayMode ? 'not_checked' : 'local_driver' },
      ipc: { state: gatewayMode ? 'not_checked' : 'off' },
      // Local resilience state per route (breaker states, last failure/success).
      providers,
      broker: brokerCounts,
      requests: {
        inFlight: gateway ? gateway.tracker.inFlightCount() : null,
        queuedWaiting: SessionQueue.globalWaitingCount(),
      },
      notes: {
        providerVerification: 'not_checked — /health never sends messages to providers',
      },
    };
  });
  app.get('/ready', async (_req, reply) => {
    try {
      const models = await driver.listModels();
      return reply.send({ status: 'ready', service: 'emo-ai-web', models: models.length });
    } catch (err) {
      return reply.status(503).send({ status: 'not_ready', error: { message: err instanceof Error ? err.message : 'driver unavailable' } });
    }
  });

  const v1InfoHandler = async () => ({
    status: 'ok',
    service: 'emo-ai-gateway',
    version: 'v1',
    description: 'OpenAI-compatible Web Bridge Gateway',
    endpoints: ['/v1/models', '/v1/chat/completions', '/v1/messages', '/v1beta/models'],
  });
  app.get('/v1', v1InfoHandler);
  app.get('/v1/', v1InfoHandler);

  const swarmCoordinator = new SwarmCoordinator(driver);

  app.get('/v1/models', async (request, reply) => {
    try {
      const scopedGroup = (request as any).scopedRouterGroup as { name: string } | undefined;
      if (scopedGroup?.name) {
        return reply.send(formatModelList([scopedGroup.name]));
      }
      const models = await driver.listModels();
      const swarmModels = ['swarm:auto', 'swarm:fullstack', 'swarm:pipeline', 'swarm:parallel'];
      const combined = [...swarmModels, ...models.filter((m) => !swarmModels.includes(m))];
      return reply.send(formatModelList(combined));
    } catch (err: unknown) {
      const error = err as { statusCode?: number; type?: string; message?: string };
      return reply.status(error.statusCode || 500).send({ error: { message: error.message || 'Failed to list models', type: error.type || 'server_error' } });
    }
  });

  app.post('/v1/chat/completions', async (request, reply) => {    const body = request.body as Partial<ChatCompletionRequest> | undefined;
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      return reply.status(400).send({ error: { message: 'Invalid request: "messages" is required and must be a non-empty array', type: 'invalid_request_error' } });
    }
    let model = body.model && body.model.trim() ? body.model.trim() : 'auto';
    const scopedGroup = (request as any).scopedRouterGroup as { name: string } | undefined;
    if (scopedGroup?.name) {
      const wantsSwarm = model.toLowerCase().startsWith('swarm') || request.headers['x-emo-subagents'] === 'true' || request.headers['x-subagents'] === 'true' || request.headers['x-swarm'] === 'true';
      if (wantsSwarm || (model.toLowerCase() !== 'auto' && model.toLowerCase() !== scopedGroup.name.toLowerCase())) {
        return reply.status(403).send({ error: { message: `This API key is scoped to router group "${scopedGroup.name}". Use model "${scopedGroup.name}".`, type: 'permission_error' } });
      }
      model = scopedGroup.name;
      (body as any).model = model;
    }

    const id = `chatcmpl-${randomUUID()}`;
    const clientAgent = detectClientAgent(request);
    const abortController = new AbortController();
    const onSocketClose = () => { if (!reply.raw.writableEnded) abortController.abort(); };
    request.raw.socket?.on('close', onSocketClose);
    request.raw.on('aborted', () => abortController.abort());

    // ---- Claim-once request broker (opt-in via X-Request-Id) ----
    // No header → no idempotency contract, existing behavior untouched (a
    // requestId is still generated for logging below). With the header, the
    // FIRST request claims the key and executes; concurrent/later duplicates
    // are served the stored outcome instead of re-executing (across
    // processes, and across gateway restarts).
    const requestIdHeader = String(request.headers['x-request-id'] || '').trim();
    const apiKeyScope = getApiKey(request) || 'anon';
    const brokerSessionKey = chatSessionKey(request, body, body.messages as any);
    let brokerCtrl: SentController | null = null;
    let brokerKeyStr: string | null = null;
    if (requestIdHeader) {
      brokerKeyStr = brokerKey(apiKeyScope, model, requestIdHeader);
      // Task 12.1 — UNIFIED X-Request-Id semantics: the fingerprint covers
      // the EFFECTIVE body (post scoped-group model coercion) so the same
      // id reused with a different request is an explicit CONFLICT with the
      // same reason token the Anthropic/Gemini paths return — never a
      // silent replay of a non-matching stored result. Legacy entries
      // without a stored fingerprint keep the pre-existing replay behavior.
      const claim = await requestBroker.begin(brokerKeyStr, brokerSessionKey, payloadFingerprint(body, 'openai'));
      if (!claim.allowed) {
        if (claim.conflict) {
          return reply.status(409).send({
            error: {
              message: `idempotency_key_reused_with_different_request: request id "${requestIdHeader}" was already used with a different payload; refusing to replay a non-matching result.`,
              type: 'idempotency_key_reused_with_different_request',
            },
          });
        }
        if (claim.state === 'completed' && claim.result !== undefined) {
          const stored = claim.result as { content: string; cleanText?: string; toolCalls?: any[]; id: string; model: string };
          if (body.stream) {
            // SSE replay: re-broadcast the STORED result as chunks. This is a
            // replay of a recorded outcome, NOT a live execution.
            reply.hijack();
            reply.raw.writeHead(200, {
              'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive',
              'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
              'x-emo-replay': 'true',
            });
            const rid = stored.id || id;
            if (Array.isArray(stored.toolCalls) && stored.toolCalls.length > 0) {
              if (stored.cleanText) reply.raw.write(formatChatCompletionChunk(rid, stored.model || model, stored.cleanText));
              reply.raw.write(formatToolCallChunks(rid, stored.model || model, stored.toolCalls));
            } else if (stored.content) {
              reply.raw.write(formatChatCompletionChunk(rid, stored.model || model, stored.content));
            }
            reply.raw.write(formatChatCompletionChunk(rid, stored.model || model, '', 'stop'));
            reply.raw.write(formatDoneChunk());
            reply.raw.end();
            return;
          }
          // Task 12.1: the replay marker is now uniform across the three
          // EMO interfaces (Anthropic/Gemini already set it on JSON replays).
          reply.header('x-emo-replay', 'true');
          return reply.send(stored);
        }
        return reply.status(409).send({
          error: {
            message:
              claim.state === 'running'
                ? `Request ${requestIdHeader} is already in progress (claim-once). Poll or wait for the original request to finish.`
                : claim.state === 'unconfirmed'
                ? `Request ${requestIdHeader} ended UNCONFIRMED: the message may have already been sent to the web chat (${claim.reason || 'unknown reason'}). Verify on the web side before re-issuing; do NOT blindly retry.`
                : `Request ${claim.state === 'completed' ? `${requestIdHeader} completed earlier but its result was too large to replay` : `Request ${requestIdHeader} is ${claim.state}`}.`,
            type: 'request_already_claimed',
            state: claim.state,
            ...(claim.reason ? { reason: claim.reason } : {}),
          },
        });
      }
      brokerCtrl = {
        complete: claim.complete,
        fail: claim.fail,
        markUnconfirmed: claim.markUnconfirmed,
        markSent: claim.markSent,
      };
    }
    // From the moment a send is INITIATED, any failure is recorded as
    // unconfirmed (the message may have reached the web chat). markSent() is
    // called immediately before each driver send in every path below.
    const brokerFail = (message: string) => brokerCtrl?.fail({ retryable: true, error: message }).catch(() => {});

    // Task 11: the receiver's claim flows into any cross-process forward.
    const routingCtx: ForwardBrokerContext | null = brokerKeyStr
      ? { key: brokerKeyStr, apiKeyScope, providerId: model, requestId: requestIdHeader }
      : null;
    const withRoutingCtx = <T>(fn: () => T): T =>
      routingCtx ? routingBrokerStorage.run(routingCtx, fn) : fn();

    const isSwarmRequest =
      model.startsWith('swarm') ||
      request.headers['x-emo-subagents'] === 'true' ||
      request.headers['x-subagents'] === 'true' ||
      request.headers['x-swarm'] === 'true';

    const pChars = promptChars(body.messages as ChatCompletionRequest['messages']);
    gateway?.tracker.recordRequestStart({ id, model, stream: !!body.stream, promptChars: pChars, clientAgent });
    let completionChars = 0;

    if (isSwarmRequest) {
      try {
        if (body.stream) {
          let headersSent = false;
          const ensureHeaders = () => {
            if (!headersSent) {
              headersSent = true;
              reply.hijack();
              reply.raw.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
              });
            }
          };

          let swarmFull = '';
          // Task 10 (final-audit finding): the swarm call below is the FIRST
          // operation that can cause a real side effect — its agents may send
          // messages to real web chats. From here on, ANY failure (mid-stream
          // abort included) is 'unconfirmed': a blind retry could duplicate
          // agent sends even when no chunk reached the API client yet, because
          // chunk emission does not prove what the agents did internally.
          // Failures BEFORE this point still record 'failed' (retryable).
          brokerCtrl?.markSent();
          await swarmCoordinator.executeAsChatCompletion(
            body as ChatCompletionRequest,
            (chunk: string) => {
              swarmFull += chunk;
              completionChars += chunk.length;
              ensureHeaders();
              reply.raw.write(formatChatCompletionChunk(id, model, chunk));
            },
            abortController.signal
          );

          ensureHeaders();
          reply.raw.write(formatChatCompletionChunk(id, model, '', 'stop'));
          reply.raw.write(formatDoneChunk());
          reply.raw.end();
          await brokerCtrl?.complete({ id, model, content: swarmFull }).catch(() => {});
          gateway?.tracker.recordRequestEnd({ id, ok: true, completionChars });
          return;
        }

        brokerCtrl?.markSent();
        const fullResponse = await swarmCoordinator.executeAsChatCompletion(
          body as ChatCompletionRequest,
          undefined,
          abortController.signal
        );
        completionChars = String(fullResponse || '').length;
        await brokerCtrl?.complete({ id, model, content: fullResponse }).catch(() => {});
        gateway?.tracker.recordRequestEnd({ id, ok: true, completionChars });
        return reply.send(formatChatCompletionResponse(id, model, fullResponse));
      } catch (err: unknown) {
        const error = err as { statusCode?: number; type?: string; message?: string };
        await brokerFail(error.message || 'swarm coordination failed');
        gateway?.tracker.recordRequestEnd({ id, ok: false, completionChars, error: error.message });
        // Task 10: after the SSE stream was hijacked/started, reply.status().send()
        // is illegal — the client must get a TERMINATED stream (error event +
        // DONE) instead of a hanging connection. No headers yet → normal 500.
        if (reply.raw.headersSent) {
          if (!reply.raw.destroyed && reply.raw.writable) {
            reply.raw.write(`data: ${JSON.stringify({ error: { message: error.message || 'Swarm coordination failed', type: 'swarm_coordination_error' } })}\n\n`);
            reply.raw.write(formatDoneChunk());
            reply.raw.end();
          }
          return;
        }
        return reply.status(500).send({
          error: {
            message: `Swarm coordination failed: ${error.message || 'Unknown error'}`,
            type: 'swarm_coordination_error',
          },
        });
      }
    }

    // 1. Tool Injection (if tools are provided by agent client)
    let processedMessages = body.messages as ChatCompletionRequest['messages'];
    const toolCount = Array.isArray(body.tools) ? body.tools.length : 0;
    const toolRes = resolveToolChoice(body.tool_choice, toolCount);
    const pipelineLog = new ToolPipelineLogger(id, (evt) => {
      console.log(`[tool-pipeline] ${JSON.stringify({ ...evt, correlationId: undefined })} corrId=${evt.correlationId}`);
    });
    if (toolRes.shouldInjectTools) {
      console.log(`[chat] model=${model} stream=${!!body.stream} tools=${toolCount} tool_choice=${typeof body.tool_choice === 'string' ? body.tool_choice : JSON.stringify(body.tool_choice) ?? 'auto'} msgs=${processedMessages.length}`);
      pipelineLog.toolDefinitionsBuilt(toolCount);
      pipelineLog.toolAvailableInRequest(toolCount);
      processedMessages = hydrateToolResultNames(processedMessages as ChatCompletionRequest['messages']);
      processedMessages = injectToolsInstruction(processedMessages, body.tools, body.tool_choice);
      pipelineLog.toolDefinitionsSent('openai');
    } else {
      console.log(`[chat] model=${model} stream=${!!body.stream} tools=${toolCount} tool_choice=${body.tool_choice ?? 'none'} inject=false msgs=${processedMessages.length}`);
    }

    // 2. Secret Redaction (Mask sensitive API keys, tokens, passwords before leaving local host)
    const secretMappings: Record<string, string> = {};
    processedMessages = processedMessages.map((m) => {
      const { redactedText, mapping } = redactSecrets(m.content);
      Object.assign(secretMappings, mapping);
      return { ...m, content: redactedText };
    });

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
          if (toolRes.shouldParseTools) {
            // Buffer when tools are present so we can emit proper tool_calls (not raw text deltas).
            let full = '';
            brokerCtrl?.markSent();
            const res = await withRoutingCtx(() => driver.sendMessage(model, processedMessages, (chunk: string) => {
              full += restoreSecrets(chunk, secretMappings);
            }, abortController.signal, chatSessionKey(request, body, processedMessages)));
            let fullResponse = restoreSecrets(res || full, secretMappings);
            completionChars = String(fullResponse || '').length;
            pipelineLog.modelResponseReceived(true);
            const toolResult = parseToolCallsFromResponse(fullResponse);
            if (!toolResult.hasToolCalls && /tool[_ -]?call/i.test(fullResponse)) {
              console.log(`[chat] WARNING: reply contains "tool_call" but none parsed (len=${fullResponse.length}). Tail: ${fullResponse.slice(-250)}`);
            }
            if (toolResult.hasToolCalls && Array.isArray(body.tools)) {
              // Exact tool-name matching (chatgpt-web-tool-bridge lesson): never
              // guess a name by similarity; surface unknown names loudly.
              const known = new Set(body.tools.map((t: any) => t?.function?.name).filter(Boolean));
              const unknown = (toolResult.toolCalls || []).filter((c: any) => !known.has(c.function?.name));
              if (unknown.length) {
                console.log(`[chat] WARNING: parsed tool name(s) not in provided tools: ${unknown.map((c: any) => c.function?.name).join(', ')}`);
                for (const u of unknown) {
                  pipelineLog.toolCallValidationFailed(u.id, u.function?.name, 'unknown_tool');
                }
              }
            }
            const decision = decideToolOutcome(toolResult, toolRes);
            if (decision.protocolError) {
              pipelineLog.toolCallValidationFailed('', decision.toolCalls?.[0]?.function?.name ?? '', decision.protocolError);
            }
            // P2 — NOTE (review-verified): this SSE branch BUFFERS the whole
            // reply — nothing is written to the client before the tool
            // decision below — so a corrective retry could technically be
            // applied here without touching the streaming design. P2
            // deliberately scopes the correction to the non-streaming path;
            // here the claim is only classified and logged. (The no-tools SSE
            // branch below streams chunks live — there, and only there, the
            // reply is already partially delivered to the client.)
            {
              const streamClaim = detectUnsupportedDependencyClaim(decision.cleanText || fullResponse);
              if (streamClaim.detected && !processedMessages.some((m) => (m as { role?: string }).role === 'tool')) {
                pipelineLog.unsupportedDependencyClaimDetected(streamClaim.fingerprint, streamClaim.category);
              }
            }
            for (const tc of decision.toolCalls || []) {
              pipelineLog.toolCallDetected(tc.id, tc.function.name);
            }
            ensureHeaders();
            if (decision.emitToolCalls && decision.toolCalls) {
              if (decision.cleanText) {
                reply.raw.write(formatChatCompletionChunk(id, model, decision.cleanText));
              }
              reply.raw.write(formatToolCallChunks(id, model, decision.toolCalls as any));
              reply.raw.write(formatDoneChunk());
              await brokerCtrl?.complete({ id, model, content: fullResponse, cleanText: decision.cleanText, toolCalls: decision.toolCalls }).catch(() => {});
            } else if (decision.protocolError) {
              // tool contract violated (required / specific tool missing):
              // return a protocol error instead of the model's text refusal.
              if (decision.refusalDetected) pipelineLog.toolRefusalDetected();
              reply.raw.write(`data: ${JSON.stringify({
                error: {
                  message: `Model did not produce a required tool call${decision.refusalDetected ? ' (tool refusal detected)' : ''}. tool_choice was "${typeof body.tool_choice === 'string' ? body.tool_choice : JSON.stringify(body.tool_choice)}".`,
                  type: decision.protocolError,
                  code: 400,
                },
              })}\n\n`);
              reply.raw.write(formatDoneChunk());
              await brokerCtrl?.fail({ retryable: true, error: decision.protocolError }).catch(() => {});
            } else {
              if (fullResponse) reply.raw.write(formatChatCompletionChunk(id, model, fullResponse));
              reply.raw.write(formatChatCompletionChunk(id, model, '', 'stop'));
              reply.raw.write(formatDoneChunk());
              await brokerCtrl?.complete({ id, model, content: fullResponse }).catch(() => {});
            }
            reply.raw.end();
            gateway?.tracker.recordRequestEnd({ id, ok: true, completionChars });
          } else {
            let sseFull = '';
            brokerCtrl?.markSent();
            await withRoutingCtx(() => driver.sendMessage(model, processedMessages, (chunk: string) => {
              const restoredChunk = restoreSecrets(chunk, secretMappings);
              sseFull += restoredChunk;
              completionChars += restoredChunk.length;
              ensureHeaders();
              reply.raw.write(formatChatCompletionChunk(id, model, restoredChunk));
            }, abortController.signal, chatSessionKey(request, body, processedMessages)));
            ensureHeaders();
            reply.raw.write(formatChatCompletionChunk(id, model, '', 'stop'));
            reply.raw.write(formatDoneChunk());
            reply.raw.end();
            await brokerCtrl?.complete({ id, model, content: sseFull }).catch(() => {});
            gateway?.tracker.recordRequestEnd({ id, ok: true, completionChars });
          }
        } catch (err: unknown) {
          const error = err as { statusCode?: number; type?: string; message?: string };
          await brokerFail(error.message || 'stream processing failed');
          gateway?.tracker.recordRequestEnd({ id, ok: false, completionChars, error: error.message });
          const statusCode = error.statusCode || (
            error.message?.includes('not enabled or not selected') || error.message?.includes('not found') ? 404 :
            error.message?.includes('not authenticated') || error.message?.includes('not logged in') ? 401 :
            error.message?.includes('Cloudflare') || error.message?.includes('verification detected') ? 403 :
            error.message?.includes('Could not find input box') ? 502 :
            500
          );
          const errType = error.type || (
            statusCode === 404 ? 'invalid_request_error' :
            statusCode === 401 ? 'authentication_error' :
            statusCode === 403 ? 'cf_turnstile_detected' :
            statusCode === 502 ? 'bad_gateway' :
            'server_error'
          );
          if (!headersSent) {
            return reply.status(statusCode).send({ error: { message: error.message || 'Stream processing failed', type: errType } });
          }
          if (!reply.raw.destroyed && reply.raw.writable) {
            reply.raw.write(`data: ${JSON.stringify({ error: { message: error.message || 'Stream processing failed', type: errType } })}\n\n`);
            reply.raw.write(formatDoneChunk());
            reply.raw.end();
          }
        }
        return;
      }

      brokerCtrl?.markSent();
      let fullResponse = await withRoutingCtx(() => driver.sendMessage(model, processedMessages, undefined, abortController.signal, chatSessionKey(request, body, processedMessages)));
      fullResponse = restoreSecrets(fullResponse, secretMappings);

      // Check if model called any tools
      if (toolRes.shouldParseTools) {
        const toolResult = parseToolCallsFromResponse(fullResponse);
        let decision = decideToolOutcome(toolResult, toolRes);
        for (const tc of decision.toolCalls || []) {
          pipelineLog.toolCallDetected(tc.id, tc.function.name);
        }
        if (decision.protocolError) {
          pipelineLog.toolCallValidationFailed('', decision.toolCalls?.[0]?.function?.name ?? '', decision.protocolError);
        }
        if (decision.emitToolCalls && decision.toolCalls) {
          completionChars = String(decision.cleanText || fullResponse).length;
          await brokerCtrl?.complete(formatChatCompletionResponse(
            id,
            model,
            decision.cleanText,
            undefined,
            undefined,
            undefined,
            decision.toolCalls,
            'tool_calls'
          ) as unknown as object).catch(() => {});
          gateway?.tracker.recordRequestEnd({ id, ok: true, completionChars });
          return reply.send(
            formatChatCompletionResponse(
              id,
              model,
              decision.cleanText,
              undefined,
              undefined,
              undefined,
              decision.toolCalls,
              'tool_calls'
            )
          );
        }

        // ------------------------------------------------------------------
        // P2 — ONE neutral correction when the model invented an external
        // dependency (or refused despite an announced toolset). The policy is
        // evidence-based: a real tool result or a confirmed transport failure
        // disables the correction (a real failure is never disguised), an
        // already-emitted tool call is never re-sent, and the correction
        // text never repeats the model's own claim.
        // ------------------------------------------------------------------
        const claim = detectUnsupportedDependencyClaim(decision.cleanText || fullResponse);
        const hasToolResultEvidence = processedMessages.some((m) => (m as { role?: string }).role === 'tool');
        const lifecycle = deriveToolLifecycleState({
          toolsAnnounced: toolCount > 0,
          parsed: toolResult,
          resolution: toolRes,
          transportFailureObserved: false,
          modelClaimDetected: claim.detected,
        });
        if (claim.detected && !hasToolResultEvidence) {
          pipelineLog.unsupportedDependencyClaimDetected(claim.fingerprint, claim.category);
        }
        if (shouldAttemptNeutralCorrection({
          resolution: toolRes,
          decision,
          claim,
          refusalDetected: decision.refusalDetected || detectToolRefusal(decision.cleanText || fullResponse),
          hasToolResultEvidence,
          transportFailureObserved: lifecycle.transportFailureConfirmed,
          alreadyAttempted: false,
        })) {
          pipelineLog.neutralCorrectionAttempted(claim.detected ? claim.category : 'tool_refusal');
          // The assistant turn is included so the driver's stored-prefix
          // alignment stays intact (the delta then carries ONLY the neutral
          // correction — the model's own reply is never re-sent).
          const correctionMessages: ChatMessage[] = [
            ...processedMessages,
            { role: 'assistant', content: decision.cleanText || fullResponse },
            { role: 'user', content: buildNeutralCorrectionMessage() },
          ];
          try {
            const correctedRaw = await withRoutingCtx(() => driver.sendMessage(
              model,
              correctionMessages,
              undefined,
              abortController.signal,
              chatSessionKey(request, body, correctionMessages)
            ));
            const correctedText = restoreSecrets(correctedRaw, secretMappings);
            const correctedParsed = parseToolCallsFromResponse(correctedText);
            const correctedDecision = decideToolOutcome(correctedParsed, toolRes);
            if (correctedDecision.emitToolCalls && correctedDecision.toolCalls) {
              for (const tc of correctedDecision.toolCalls) {
                pipelineLog.toolCallDetected(tc.id, tc.function.name);
              }
              completionChars = String(correctedDecision.cleanText || correctedText).length;
              await brokerCtrl?.complete(formatChatCompletionResponse(
                id,
                model,
                correctedDecision.cleanText,
                undefined,
                undefined,
                undefined,
                correctedDecision.toolCalls,
                'tool_calls'
              ) as unknown as object).catch(() => {});
              gateway?.tracker.recordRequestEnd({ id, ok: true, completionChars });
              return reply.send(
                formatChatCompletionResponse(
                  id,
                  model,
                  correctedDecision.cleanText,
                  undefined,
                  undefined,
                  undefined,
                  correctedDecision.toolCalls,
                  'tool_calls'
                )
              );
            }
            // The correction produced prose: under `auto` that prose is the
            // answer; under `required`/specific the protocol error still
            // applies (a refusal is never passed off as success).
            fullResponse = correctedText;
            decision = correctedDecision;
          } catch (correctionErr) {
            // A REAL transport failure during the correction: keep the real
            // error, never mask it behind the correction text.
            pipelineLog.transportFailureConfirmed(
              correctionErr instanceof Error ? correctionErr.name : 'unknown'
            );
            throw correctionErr;
          }
        }
        // tool contract violated (required / specific tool missing) → protocol error
        if (decision.protocolError) {
          if (decision.refusalDetected) pipelineLog.toolRefusalDetected();
          await brokerCtrl?.fail({ retryable: true, error: decision.protocolError }).catch(() => {});
          gateway?.tracker.recordRequestEnd({ id, ok: false, completionChars: 0, error: decision.protocolError });
          return reply.status(400).send({
            error: {
              message: `Model did not produce a required tool call${decision.refusalDetected ? ' (tool refusal detected)' : ''}. tool_choice was "${typeof body.tool_choice === 'string' ? body.tool_choice : JSON.stringify(body.tool_choice)}".`,
              type: decision.protocolError,
            },
          });
        }
      }

      completionChars = String(fullResponse || '').length;
      await brokerCtrl?.complete(formatChatCompletionResponse(id, model, fullResponse) as unknown as object).catch(() => {});
      gateway?.tracker.recordRequestEnd({ id, ok: true, completionChars });
      return reply.send(formatChatCompletionResponse(id, model, fullResponse));
    } catch (err: unknown) {
      const error = err as { statusCode?: number; type?: string; message?: string };
      await brokerFail(error.message || 'chat completion failed');
      gateway?.tracker.recordRequestEnd({ id, ok: false, completionChars, error: error.message });
      const statusCode = error.statusCode || (
        error.message?.includes('not enabled or not selected') || error.message?.includes('not found') ? 404 :
        error.message?.includes('not authenticated') || error.message?.includes('not logged in') ? 401 :
        error.message?.includes('Cloudflare') || error.message?.includes('verification detected') ? 403 :
        error.message?.includes('Could not find input box') ? 502 :
        500
      );
      const errType = error.type || (
        statusCode === 404 ? 'invalid_request_error' :
        statusCode === 401 ? 'authentication_error' :
        statusCode === 403 ? 'cf_turnstile_detected' :
        statusCode === 502 ? 'bad_gateway' :
        'server_error'
      );
      return reply.status(statusCode).send({ error: { message: error.message || 'Chat completion failed', type: errType } });
    } finally {
      request.raw.socket?.off('close', onSocketClose);
    }
  });

  registerAnthropicRoutes(app, {
    getDriver: () => (gatewayMode ? gateway!.manager.getActiveDriver() : driver),
    tracker: gateway?.tracker,
    requireApiKey,
    apiKey,
    getValidApiKeys: () => (gateway && typeof gateway.manager.getValidApiKeys === 'function' ? gateway.manager.getValidApiKeys() : [apiKey]),
    getScopedGroup: (key: string) => (gateway && typeof (gateway.manager as any).getGroupForApiKey === 'function' ? (gateway.manager as any).getGroupForApiKey(key) : undefined),
    // Task 12: the ONE shared broker instance/store across all three protocols.
    broker: requestBroker,
  });

  registerGeminiRoutes(app, {
    getDriver: () => (gatewayMode ? gateway!.manager.getActiveDriver() : driver),
    tracker: gateway?.tracker,
    requireApiKey,
    apiKey,
    getValidApiKeys: () => (gateway && typeof gateway.manager.getValidApiKeys === 'function' ? gateway.manager.getValidApiKeys() : [apiKey]),
    getScopedGroup: (key: string) => (gateway && typeof (gateway.manager as any).getGroupForApiKey === 'function' ? (gateway.manager as any).getGroupForApiKey(key) : undefined),
    // Task 12: the ONE shared broker instance/store across all three protocols.
    broker: requestBroker,
  });

  // Dedicated Swarm / Subagents Orchestrator Endpoints
  app.post('/v1/agents/swarm', async (request, reply) => {
    const scopedGroup = (request as any).scopedRouterGroup as { name: string } | undefined;
    if (scopedGroup?.name) {
      return reply.status(403).send({ error: { message: `This API key is scoped to router group "${scopedGroup.name}" and cannot be used with /v1/agents/swarm. Use /v1/chat/completions with model "${scopedGroup.name}".`, type: 'permission_error' } });
    }
    const body = request.body as SwarmRequest | undefined;
    if (!body || !body.goal || typeof body.goal !== 'string' || !body.goal.trim()) {
      return reply.status(400).send({
        error: {
          message: 'Invalid request: "goal" string is required in JSON body',
          type: 'invalid_request_error',
        },
      });
    }

    const abortController = new AbortController();
    const onSocketClose = () => { if (!reply.raw.writableEnded) abortController.abort(); };
    request.raw.socket?.on('close', onSocketClose);

    try {
      if (body.stream) {
        reply.hijack();
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
        });

        const result = await swarmCoordinator.executeSwarm(
          body,
          (event) => {
            if (!reply.raw.destroyed && reply.raw.writable) {
              reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            }
          },
          abortController.signal
        );

        if (!reply.raw.destroyed && reply.raw.writable) {
          reply.raw.write(`event: swarm:result\ndata: ${JSON.stringify(result)}\n\n`);
          reply.raw.write('event: done\ndata: [DONE]\n\n');
          reply.raw.end();
        }
        return;
      }

      const result = await swarmCoordinator.executeSwarm(body, undefined, abortController.signal);
      return reply.send(result);
    } catch (err: unknown) {
      const error = err as { message?: string };
      return reply.status(500).send({
        error: {
          message: `Swarm execution failed: ${error.message || 'Unknown error'}`,
          type: 'swarm_error',
        },
      });
    } finally {
      request.raw.socket?.off('close', onSocketClose);
    }
  });

  app.get('/v1/agents/swarm/status', async () => {
    return {
      status: 'active',
      service: 'swarm-coordinator',
      roles: ['coordinator', 'architect', 'coder', 'reviewer', 'tester', 'custom'],
      modes: ['pipeline', 'parallel', 'auto'],
      activeSessions: swarmCoordinator.listSessions().length,
    };
  });

  app.get('/v1/agents/swarm/sessions', async () => {
    return {
      sessions: swarmCoordinator.listSessions(),
    };
  });

  return app;
}
