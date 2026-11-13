import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GatewayConfigStore, defaultGatewayConfig } from '../../src/gateway/config-store.js';
import { ProviderManager } from '../../src/gateway/provider-manager.js';

function jsonReply(status: number, body: any) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  } as unknown as Response;
}

describe('API provider model discovery (custom upstream /models endpoint)', () => {
  let dir: string;
  let store: GatewayConfigStore;
  let mgr: ProviderManager;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-disc-'));
    store = new GatewayConfigStore(path.join(dir, 'gateway.json'));
    mgr = new ProviderManager({ store, config: defaultGatewayConfig(), factories: {} as any });
    await mgr.init();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('queries the provider models endpoint and maps the response to model ids', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(String(url));
      return jsonReply(200, { data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] });
    });
    const res = await mgr.fetchCustomProviderModelsWithMeta('https://api.example.com/v1', 'secret-key');
    expect(seen[0]).toBe('https://api.example.com/v1/models');
    expect(res.models).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(res.source).toBe('live');
    expect(res.status).toBe(200);
  });

  it('maps the alternative response shapes (array / models / result)', async () => {
    vi.stubGlobal('fetch', async () => jsonReply(200, { models: [{ name: 'm1' }, { model: 'm2' }] }));
    expect((await mgr.fetchCustomProviderModelsWithMeta('https://api.example.com/v1')).models).toEqual(['m1', 'm2']);
    vi.stubGlobal('fetch', async () => jsonReply(200, [{ id: 'a' }, { id: 'b' }]));
    expect((await mgr.fetchCustomProviderModelsWithMeta('https://api.example.com/v1')).models).toEqual(['a', 'b']);
    vi.stubGlobal('fetch', async () => jsonReply(200, { result: [{ id: 'r1' }] }));
    expect((await mgr.fetchCustomProviderModelsWithMeta('https://api.example.com/v1')).models).toEqual(['r1']);
  });

  it('strips the models/ prefix from Gemini-style ids', async () => {
    vi.stubGlobal('fetch', async () => jsonReply(200, { models: [{ name: 'models/gemini-2.0-flash' }] }));
    expect((await mgr.fetchCustomProviderModelsWithMeta('https://api.example.com/v1')).models).toEqual(['gemini-2.0-flash']);
  });

  it('fails loudly on HTTP 401 (rejected credentials)', async () => {
    vi.stubGlobal('fetch', async () => jsonReply(401, { error: { message: 'invalid api key' } }));
    await expect(mgr.fetchCustomProviderModelsWithMeta('https://api.example.com/v1', 'k')).rejects.toThrow(/المصادقة|api key/i);
  });

  it('fails loudly on HTTP 403', async () => {
    vi.stubGlobal('fetch', async () => jsonReply(403, { error: { message: 'forbidden' } }));
    await expect(mgr.fetchCustomProviderModelsWithMeta('https://api.example.com/v1', 'k')).rejects.toThrow();
  });

  it('fails on HTTP 429 (rate limited)', async () => {
    vi.stubGlobal('fetch', async () => jsonReply(429, { error: { message: 'rate limit' } }));
    await expect(mgr.fetchCustomProviderModelsWithMeta('https://api.example.com/v1', 'k')).rejects.toThrow(/429|rate/i);
  });

  it('fails on HTTP 5xx', async () => {
    vi.stubGlobal('fetch', async () => jsonReply(503, 'upstream boom'));
    await expect(mgr.fetchCustomProviderModelsWithMeta('https://api.example.com/v1', 'k')).rejects.toThrow();
  });

  it('fails on a network error', async () => {
    vi.stubGlobal('fetch', async () => {
      throw Object.assign(new Error('ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' });
    });
    await expect(mgr.fetchCustomProviderModelsWithMeta('https://api.example.com/v1', 'k')).rejects.toThrow(/ECONNREFUSED/);
  });

  it('fails on invalid JSON', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      text: async () => '<html>not json</html>',
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    } as unknown as Response));
    await expect(mgr.fetchCustomProviderModelsWithMeta('https://api.example.com/v1', 'k')).rejects.toThrow();
  });

  it('fails on an EMPTY models list (never reports an empty success)', async () => {
    vi.stubGlobal('fetch', async () => jsonReply(200, { data: [] }));
    await expect(mgr.fetchCustomProviderModelsWithMeta('https://api.example.com/v1', 'k')).rejects.toThrow(/فارغة|empty/i);
  });

  it('never leaks the API key into the error message', async () => {
    const key = 'sk-live-abcdefghijklmnopqrstuvwxyz0123456789';
    vi.stubGlobal('fetch', async () => jsonReply(401, { error: { message: `bad key ${key}` } }));
    let message = '';
    try {
      await mgr.fetchCustomProviderModelsWithMeta('https://api.example.com/v1', key);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).not.toBe('');
    expect(message).not.toContain(key);
  });

  it('replaces (not merges) the stored model list on a successful custom refresh', async () => {
    const config = defaultGatewayConfig();
    config.gateway.customProviders = [
      { id: 'c1', name: 'C', baseUrl: 'https://api.example.com/v1', apiKey: 'k', models: ['old-model'], enabled: true, createdAt: new Date().toISOString() },
    ];
    const m2 = new ProviderManager({ store, config, factories: {} as any });
    await m2.init();
    vi.stubGlobal('fetch', async () => jsonReply(200, { data: [{ id: 'new-model' }] }));
    const item = await m2.refreshCustomProviderModels('c1');
    expect(item.models).toEqual(['new-model']);
    expect(item.models).not.toContain('old-model');
  });

  it('keeps the stored list when the custom refresh fails', async () => {
    const config = defaultGatewayConfig();
    config.gateway.customProviders = [
      { id: 'c1', name: 'C', baseUrl: 'https://api.example.com/v1', apiKey: 'k', models: ['old-model'], enabled: true, createdAt: new Date().toISOString() },
    ];
    const m2 = new ProviderManager({ store, config, factories: {} as any });
    await m2.init();
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down');
    });
    await expect(m2.refreshCustomProviderModels('c1')).rejects.toThrow();
    expect(m2.listCustomProviders()[0].models).toEqual(['old-model']);
  });
});
