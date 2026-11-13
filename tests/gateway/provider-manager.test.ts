import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ArenaDriver, ChatMessage } from '../../src/types.js';
import type { WebProviderId } from '../../src/gateway/types.js';
import { GatewayConfigStore, defaultGatewayConfig } from '../../src/gateway/config-store.js';
import { ProviderManager } from '../../src/gateway/provider-manager.js';

function fakeDriver(name: string, models: string[], onSend?: (m: string) => string, closeSpy?: () => void): ArenaDriver {
  return {
    async listModels() { return models; },
    async sendMessage(model: string, _messages: ChatMessage[]) { return onSend ? onSend(model) : `${name}:${model}`; },
    async close() { closeSpy?.(); },
  };
}

describe('ProviderManager', () => {
  let dir: string;
  let store: GatewayConfigStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gwpm-'));
    store = new GatewayConfigStore(path.join(dir, 'gateway.json'));
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('lists all web providers and updates config patches', async () => {
    const config = defaultGatewayConfig();
    const mgr = new ProviderManager({ store, config, factories: { 'claude-web': () => fakeDriver('claude', ['claude-web:default']) } as any });
    await mgr.init();
    expect(mgr.listStates().map((s) => s.id)).toContain('claude-web');
    await mgr.updateProvider('claude-web', { enabled: true, selectedModels: ['claude-web:default'], availableModels: ['claude-web:default'] });
    expect(mgr.getConfig().providers['claude-web'].selectedModels).toEqual(['claude-web:default']);
    expect(mgr.getState('claude-web').enabled).toBe(true);
  });

  it('active driver returns only selected models from enabled providers', async () => {
    const config = defaultGatewayConfig();
    config.providers['claude-web'] = { enabled: true, settings: {}, availableModels: ['claude-web:default', 'claude-web:other'], selectedModels: ['claude-web:default'] };
    config.providers['gemini-web'] = { enabled: false, settings: {}, availableModels: ['gemini-web:default'], selectedModels: ['gemini-web:default'] };
    const mgr = new ProviderManager({ store, config, factories: {
      'claude-web': () => fakeDriver('claude', ['claude-web:default', 'claude-web:other']),
      'gemini-web': () => fakeDriver('gemini', ['gemini-web:default']),
    } as any });
    await mgr.init();
    const models = await mgr.getActiveDriver().listModels();
    expect(models).toContain('claude-web:default');
    expect(models).not.toContain('claude-web:other');
    expect(models).not.toContain('gemini-web:default');
  });

  it('rejects disabled/unselected model and sends selected model via running provider', async () => {
    const config = defaultGatewayConfig();
    config.providers['claude-web'] = { enabled: true, settings: {}, availableModels: ['claude-web:default'], selectedModels: ['claude-web:default'] };
    const mgr = new ProviderManager({ store, config, factories: { 'claude-web': () => fakeDriver('claude', ['claude-web:default'], (m) => `ok:${m}`) } as any });
    await mgr.init();
    await mgr.start('claude-web');
    await expect(mgr.getActiveDriver().sendMessage('gemini-web:default', [{ role: 'user', content: 'hi' }])).rejects.toThrow(/not enabled|not selected|no.*provider/i);
    await expect(mgr.getActiveDriver().sendMessage('claude-web:default', [{ role: 'user', content: 'hi' }])).resolves.toBe('ok:claude-web:default');
  });

  it('start/stop manages driver lifecycle and close', async () => {
    let closed = 0;
    const config = defaultGatewayConfig();
    config.providers['claude-web'] = { enabled: true, settings: {}, availableModels: ['claude-web:default'], selectedModels: ['claude-web:default'] };
    const mgr = new ProviderManager({ store, config, factories: { 'claude-web': () => fakeDriver('claude', ['claude-web:default'], undefined, () => { closed++; }) } as any });
    await mgr.init();
    await mgr.start('claude-web');
    expect(mgr.getState('claude-web').status).toBe('running');
    await mgr.stop('claude-web');
    expect(mgr.getState('claude-web').status).toBe('stopped');
    expect(closed).toBe(1);
  });

  it('refreshModels replaces the discovered list and prunes selections the provider dropped', async () => {
    const config = defaultGatewayConfig();
    config.providers['claude-web'] = { enabled: true, settings: {}, availableModels: ['claude-web:default', 'claude-web:stale'], selectedModels: ['claude-web:default', 'claude-web:stale'] };
    const mgr = new ProviderManager({ store, config, factories: { 'claude-web': () => fakeDriver('claude', ['claude-web:default', 'claude-web:sonnet']) } as any });
    await mgr.init();
    const state = await mgr.refreshModels('claude-web');
    // The stale id is GONE (the old union behaviour kept it forever).
    expect(state.availableModels).toEqual(['claude-web:default', 'claude-web:sonnet']);
    expect(state.availableModels).not.toContain('claude-web:stale');
    // The still-valid selection is kept, the removed one is pruned.
    expect(state.selectedModels).toEqual(['claude-web:default']);
    expect(state.meta?.lastModelsRefreshAt).toBeTruthy();
    expect(state.meta?.modelsSource).toBe('configured-catalog');
  });

  it('refreshModels keeps the last good list and reports the reason when discovery fails', async () => {
    const config = defaultGatewayConfig();
    config.providers['claude-web'] = { enabled: true, settings: {}, availableModels: ['claude-web:default'], selectedModels: ['claude-web:default'] };
    const mgr = new ProviderManager({ store, config, factories: { 'claude-web': () => ({ async listModels() { throw new Error('adapter exploded'); }, async sendMessage() { return ''; }, async close() {} }) } as any });
    await mgr.init();
    const report = await mgr.refreshModelsReport('claude-web');
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/adapter exploded/i);
    const state = mgr.getState('claude-web');
    // The last good list AND the selection survive a failed refresh.
    expect(state.availableModels).toEqual(['claude-web:default']);
    expect(state.selectedModels).toEqual(['claude-web:default']);
    expect(state.meta?.lastModelsError).toMatch(/adapter exploded/i);
  });

  it('serializes concurrent start for same provider', async () => {
    let creates = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const config = defaultGatewayConfig();
    config.providers['claude-web'] = { enabled: true, settings: {}, availableModels: ['claude-web:default'], selectedModels: ['claude-web:default'] };
    const mgr = new ProviderManager({ store, config, factories: { 'claude-web': async () => { creates++; await gate; return fakeDriver('claude', ['claude-web:default']); } } as any });
    await mgr.init();
    const p1 = mgr.start('claude-web');
    const p2 = mgr.start('claude-web');
    await Promise.resolve();
    release();
    await Promise.all([p1, p2]);
    expect(creates).toBe(1);
    expect(mgr.getState('claude-web').status).toBe('running');
  });

  it('updates headless and privacyMode settings via updateProvider', async () => {
    const config = defaultGatewayConfig();
    const mgr = new ProviderManager({ store, config, factories: {} as any });
    await mgr.init();
    await mgr.updateProvider('chatgpt-web', {
      settings: { privacyMode: true, headless: false },
    });
    const state = mgr.getState('chatgpt-web');
    expect(state.settings.privacyMode).toBe(true);
    expect(state.settings.headless).toBe(false);
  });

  describe('router groups', () => {
    it('creates, finds, lists, updates and deletes groups with validation', async () => {
      const config = defaultGatewayConfig();
      config.providers['zai-web'] = { ...config.providers['zai-web'], enabled: true, availableModels: ['glm-4.5-flash'], selectedModels: ['glm-4.5-flash'] };
      config.providers['claude-web'] = { ...config.providers['claude-web'], enabled: true, availableModels: ['claude-web:default'], selectedModels: ['claude-web:default'] };
      const mgr = new ProviderManager({ store, config, factories: {} as any });
      await mgr.init();

      const g = await mgr.createRouterGroup({
        name: 'A',
        enabled: true,
        strategy: 'sequential',
        targets: [
          { id: 't1', kind: 'web', providerId: 'zai-web', model: 'glm-4.5-flash' },
          { id: 't2', kind: 'web', providerId: 'claude-web', model: 'claude-web:default' },
        ],
      } as any);
      expect(g.name).toBe('A');
      expect(mgr.listRouterGroups()).toHaveLength(1);
      expect(mgr.findRouterGroupForModel('a')?.id).toBe(g.id);
      expect(mgr.findRouterGroupForModel('A')?.id).toBe(g.id);

      await expect(mgr.createRouterGroup({ name: 'a', enabled: true, strategy: 'sequential', targets: [{ id: 'x', kind: 'web', providerId: 'zai-web', model: 'glm-4.5-flash' }] } as any)).rejects.toThrow(/مستخدم/);
      await expect(mgr.createRouterGroup({ name: 'B', enabled: true, strategy: 'sequential', targets: [] } as any)).rejects.toThrow(/هدف/);

      const upd = await mgr.updateRouterGroup(g.id, { enabled: false });
      expect(upd?.enabled).toBe(false);
      expect(mgr.findRouterGroupForModel('A')).toBeUndefined();

      expect(await mgr.deleteRouterGroup(g.id)).toBe(true);
      expect(mgr.listRouterGroups()).toHaveLength(0);
    });

    it('lists enabled group names in active driver models', async () => {
      const config = defaultGatewayConfig();
      config.routerGroups = [{
        id: 'g1', name: 'Mix', enabled: true, strategy: 'sequential',
        targets: [{ id: 't1', kind: 'web', providerId: 'zai-web', model: 'glm-4.5-flash' }],
        createdAt: '', updatedAt: '',
      }];
      const mgr = new ProviderManager({ store, config, factories: {} as any });
      await mgr.init();
      const models = await mgr.getActiveDriver().listModels();
      expect(models).toContain('Mix');
      expect(mgr.isModelEnabled('mix')).toBe(true);
    });

    it('sequential strategy fails over to next target before first chunk', async () => {
      const config = defaultGatewayConfig();
      config.providers['zai-web'] = { ...config.providers['zai-web'], enabled: true, selectedModels: ['glm-4.5-flash'], availableModels: ['glm-4.5-flash'] };
      config.providers['claude-web'] = { ...config.providers['claude-web'], enabled: true, selectedModels: ['claude-web:default'], availableModels: ['claude-web:default'] };
      config.routerGroups = [{
        id: 'g1', name: 'Seq', enabled: true, strategy: 'sequential',
        targets: [
          { id: 't1', kind: 'web', providerId: 'zai-web', model: 'glm-4.5-flash' },
          { id: 't2', kind: 'web', providerId: 'claude-web', model: 'claude-web:default' },
        ],
        createdAt: '', updatedAt: '',
      }];
      const calls: string[] = [];
      const mgr = new ProviderManager({ store, config, factories: {
        'zai-web': () => fakeDriver('zai', ['glm-4.5-flash'], () => { calls.push('zai'); throw new Error('zai down'); }),
        'claude-web': () => fakeDriver('claude', ['claude-web:default'], (m) => { calls.push('claude'); return `ok:${m}`; }),
      } as any });
      await mgr.init();
      const res = await mgr.getActiveDriver().sendMessage('Seq', [{ role: 'user', content: 'hi' }]);
      expect(res).toBe('ok:claude-web:default');
      expect(calls).toEqual(['zai', 'claude']);
    });

    it('round-robin rotates starting target', async () => {
      const config = defaultGatewayConfig();
      config.providers['zai-web'] = { ...config.providers['zai-web'], enabled: true, selectedModels: ['glm-4.5-flash'], availableModels: ['glm-4.5-flash'] };
      config.providers['claude-web'] = { ...config.providers['claude-web'], enabled: true, selectedModels: ['claude-web:default'], availableModels: ['claude-web:default'] };
      config.routerGroups = [{
        id: 'g1', name: 'RR', enabled: true, strategy: 'round-robin',
        targets: [
          { id: 't1', kind: 'web', providerId: 'zai-web', model: 'glm-4.5-flash' },
          { id: 't2', kind: 'web', providerId: 'claude-web', model: 'claude-web:default' },
        ],
        createdAt: '', updatedAt: '',
      }];
      const calls: string[] = [];
      const mgr = new ProviderManager({ store, config, factories: {
        'zai-web': () => fakeDriver('zai', ['glm-4.5-flash'], () => { calls.push('zai'); return 'z'; }),
        'claude-web': () => fakeDriver('claude', ['claude-web:default'], () => { calls.push('claude'); return 'c'; }),
      } as any });
      await mgr.init();
      await mgr.getActiveDriver().sendMessage('RR', [{ role: 'user', content: '1' }]);
      await mgr.getActiveDriver().sendMessage('RR', [{ role: 'user', content: '2' }]);
      expect(calls).toEqual(['zai', 'claude']);
    });

    it('pinned account switches only when needed', async () => {
      const config = defaultGatewayConfig();
      config.providers['claude-web'] = {
        enabled: true, settings: { userDataDir: '/tmp/p1' },
        availableModels: ['claude-web:default'], selectedModels: ['claude-web:default'],
        accounts: [
          { id: 'acc1', name: 'A1', email: 'a1@x', isLoggedIn: true, active: true, userDataDir: '/tmp/p1' },
          { id: 'acc2', name: 'A2', email: 'a2@x', isLoggedIn: true, active: false, userDataDir: '/tmp/p2' },
        ],
        activeAccountId: 'acc1',
      } as any;
      config.routerGroups = [{
        id: 'g1', name: 'Pin', enabled: true, strategy: 'sequential',
        targets: [{ id: 't1', kind: 'web', providerId: 'claude-web', model: 'claude-web:default', accountId: 'acc2' }],
        createdAt: '', updatedAt: '',
      }];
      let switches = 0;
      const orig = ProviderManager.prototype.switchAccount;
      (ProviderManager.prototype as any).switchAccount = async function(id: WebProviderId, accountId: string) {
        switches++;
        return orig.call(this, id, accountId);
      };
      try {
        const mgr = new ProviderManager({ store, config, factories: { 'claude-web': () => fakeDriver('claude', ['claude-web:default'], () => 'ok') } as any });
        await mgr.init();
        await mgr.getActiveDriver().sendMessage('Pin', [{ role: 'user', content: 'hi' }]);
        expect(switches).toBe(1);
        expect(mgr.getConfig().providers['claude-web'].activeAccountId).toBe('acc2');
        await mgr.getActiveDriver().sendMessage('Pin', [{ role: 'user', content: 'hi2' }]);
        expect(switches).toBe(1); // no extra switch
      } finally {
        (ProviderManager.prototype as any).switchAccount = orig;
      }
    });
  });

  it('routes bare model names and provider aliases to enabled providers and provides 404 on unselected', async () => {
    const config = defaultGatewayConfig();
    config.providers['chatgpt-web'] = {
      enabled: true,
      settings: {},
      availableModels: ['chatgpt-web:gpt-4o', 'chatgpt-web:default'],
      selectedModels: ['chatgpt-web:gpt-4o', 'chatgpt-web:default'],
    };
    config.providers['claude-web'] = {
      enabled: true,
      settings: {},
      availableModels: ['claude-web:claude-3-5-sonnet'],
      selectedModels: ['claude-web:claude-3-5-sonnet'],
    };
    const mgr = new ProviderManager({
      store,
      config,
      factories: {
        'chatgpt-web': () => fakeDriver('chatgpt', ['chatgpt-web:gpt-4o'], (m) => `chatgpt:${m}`),
        'claude-web': () => fakeDriver('claude', ['claude-web:claude-3-5-sonnet'], (m) => `claude:${m}`),
      } as any,
    });
    await mgr.init();

    // 1. Bare model "gpt-4o" resolves to "chatgpt-web:gpt-4o"
    const targetGpt = mgr.findTargetForModel('gpt-4o');
    expect(targetGpt).toEqual({ providerId: 'chatgpt-web', targetModel: 'chatgpt-web:gpt-4o' });
    expect(mgr.findProviderForModel('gpt-4o')).toBe('chatgpt-web');

    // 2. Bare model "claude-3-5-sonnet" resolves to "claude-web:claude-3-5-sonnet"
    const targetClaude = mgr.findTargetForModel('claude-3-5-sonnet');
    expect(targetClaude).toEqual({ providerId: 'claude-web', targetModel: 'claude-web:claude-3-5-sonnet' });

    // 3. Provider alias "chatgpt" resolves to first selected model
    const targetAlias = mgr.findTargetForModel('chatgpt');
    expect(targetAlias).toEqual({ providerId: 'chatgpt-web', targetModel: 'chatgpt-web:gpt-4o' });

    // 4. Executing sendMessage with bare model works seamlessly
    const res = await mgr.getActiveDriver().sendMessage('gpt-4o', [{ role: 'user', content: 'hello' }]);
    expect(res).toBe('chatgpt:chatgpt-web:gpt-4o');

    // 5. Unselected model throws with statusCode 404
    await expect(mgr.getActiveDriver().sendMessage('nonexistent-model', [{ role: 'user', content: 'hello' }]))
      .rejects.toMatchObject({ statusCode: 404, type: 'invalid_request_error' });
  });
});
