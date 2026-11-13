import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { ProviderManager } from '../../src/gateway/provider-manager.js';
import { UsageTracker } from '../../src/gateway/usage-tracker.js';
import { defaultGatewayConfig } from '../../src/gateway/config-store.js';
import { registerGatewayRoutes } from '../../src/server/gateway-routes.js';
import type { GatewayConfigFile } from '../../src/gateway/types.js';

class MockStore {
  async save(_cfg: GatewayConfigFile): Promise<void> {}
}

function makeConfig(): GatewayConfigFile {
  const base = defaultGatewayConfig();
  return {
    ...base,
    gateway: {
      ...base.gateway,
      port: 8989,
      host: '127.0.0.1',
      baseUriDisplay: 'emo-web.ai/v1',
      apiKey: 'mac',
      requireApiKey: true,
      apiKeys: [],
      customProviders: [],
    },
    ui: { heartbeatTimeoutMs: 15000 },
  };
}

describe('API Key and Custom Upstream Management', () => {
  let app: ReturnType<typeof Fastify>;
  let manager: ProviderManager;

  beforeEach(async () => {
    app = Fastify();
    const config = makeConfig();
    manager = new ProviderManager({
      store: new MockStore() as any,
      config,
    });
    await manager.init();

    registerGatewayRoutes(app, {
      manager,
      tracker: new UsageTracker(),
      getGatewayConfig: () => manager.getConfig(),
    });
  });

  it('manages API keys (CRUD)', async () => {
    // 1. Initial list has default
    const res1 = await app.inject({ method: 'GET', url: '/api/gateway/keys' });
    expect(res1.statusCode).toBe(200);
    const data1 = JSON.parse(res1.body);
    expect(Array.isArray(data1.keys)).toBe(true);

    // 2. Create custom key
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/gateway/keys',
      payload: { name: 'Claude Code Key', key: 'sk-test-custom-123' },
    });
    expect(res2.statusCode).toBe(200);
    const data2 = JSON.parse(res2.body);
    expect(data2.key.name).toBe('Claude Code Key');
    expect(data2.key.key).toBe('sk-test-custom-123');
    expect(data2.key.enabled).toBe(true);

    // 3. Verify key is recognized as valid
    expect(manager.getValidApiKeys()).toContain('sk-test-custom-123');
    expect(manager.getValidApiKeys()).toContain('mac');

    // 4. Toggle key disabled
    const res3 = await app.inject({
      method: 'PATCH',
      url: `/api/gateway/keys/${data2.key.id}`,
      payload: { enabled: false },
    });
    expect(res3.statusCode).toBe(200);
    expect(manager.getValidApiKeys()).not.toContain('sk-test-custom-123');

    // 5. Delete key
    const res4 = await app.inject({
      method: 'DELETE',
      url: `/api/gateway/keys/${data2.key.id}`,
    });
    expect(res4.statusCode).toBe(200);
    expect(manager.listApiKeys().find(k => k.id === data2.key.id)).toBeUndefined();
  });

  it('manages custom upstream providers (CRUD)', async () => {
    // 1. Create custom provider
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/gateway/custom-providers',
      payload: {
        name: 'DeepSeek Official',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-deepseek-test',
        models: ['deepseek-chat', 'deepseek-reasoner'],
      },
    });
    expect(res1.statusCode).toBe(200);
    const data1 = JSON.parse(res1.body);
    expect(data1.provider.name).toBe('DeepSeek Official');
    expect(data1.provider.models).toContain('deepseek-chat');

    // 2. List custom providers and verify models are exposed in active driver
    const res2 = await app.inject({ method: 'GET', url: '/api/gateway/custom-providers' });
    const data2 = JSON.parse(res2.body);
    expect(data2.providers.length).toBe(1);
    const activeModels = await manager.getActiveDriver().listModels();
    expect(activeModels).toContain('deepseek-chat');
    expect(manager.isModelEnabled('deepseek-chat')).toBe(true);

    // 3. Delete custom provider
    const res3 = await app.inject({
      method: 'DELETE',
      url: `/api/gateway/custom-providers/${data1.provider.id}`,
    });
    expect(res3.statusCode).toBe(200);
    expect(manager.listCustomProviders().length).toBe(0);
  });
});
