import type { FastifyInstance } from 'fastify';
import type { GatewayConfigFile, WebProviderId } from '../gateway/types.js';
import { WEB_PROVIDER_IDS } from '../gateway/types.js';
import type { ProviderManager } from '../gateway/provider-manager.js';
import type { UsageTracker } from '../gateway/usage-tracker.js';

function isProviderId(v: string): v is WebProviderId {
  return (WEB_PROVIDER_IDS as string[]).includes(v);
}

export function registerGatewayRoutes(app: FastifyInstance, opts: {
  manager: ProviderManager;
  tracker: UsageTracker;
  getGatewayConfig: () => GatewayConfigFile;
}): void {
  app.post('/api/gateway/heartbeat', async () => {
    opts.tracker.heartbeat();
    return { ok: true };
  });

  app.get('/api/gateway/status', async () => {
    const cfg = opts.getGatewayConfig();
    const providers = opts.manager.listStates().map((p) => ({
      ...p,
      settings: (() => { const { userDataDir: _ud, ...rest } = (p.settings || {}) as Record<string, unknown>; void _ud; return { ...rest, userDataDir: '[redacted]' }; })(),
    }));
    return {
      gateway: {
        baseUriDisplay: cfg.gateway.baseUriDisplay,
        api: cfg.gateway.apiKey,
        host: cfg.gateway.host,
        port: cfg.gateway.port,
      },
      usage: opts.tracker.snapshot(),
      providers,
    };
  });

  app.post('/api/gateway/providers/:id/start', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    return opts.manager.start(id);
  });
  app.post('/api/gateway/providers/:id/stop', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    return opts.manager.stop(id);
  });
  app.post('/api/gateway/providers/:id/refresh', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    return opts.manager.refreshModels(id);
  });
  app.post('/api/gateway/providers/:id/login', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    try {
      return await opts.manager.login(id);
    } catch (e) {
      return reply.status(500).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });
  app.patch('/api/gateway/providers/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    const body = (req.body || {}) as any;
    const state = await opts.manager.updateProvider(id, {
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      settings: body.settings && typeof body.settings === 'object' ? body.settings : undefined,
      selectedModels: Array.isArray(body.selectedModels) ? body.selectedModels : undefined,
      availableModels: Array.isArray(body.availableModels) ? body.availableModels : undefined,
    });
    await opts.manager.saveConfig().catch(() => {});
    return state;
  });
}
