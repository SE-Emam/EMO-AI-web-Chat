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

  it('refreshModels merges discovered models without dropping selected', async () => {
    const config = defaultGatewayConfig();
    config.providers['claude-web'] = { enabled: true, settings: {}, availableModels: ['claude-web:default'], selectedModels: ['claude-web:custom'] };
    const mgr = new ProviderManager({ store, config, factories: { 'claude-web': () => fakeDriver('claude', ['claude-web:default', 'claude-web:sonnet']) } as any });
    await mgr.init();
    const state = await mgr.refreshModels('claude-web');
    expect(state.availableModels).toContain('claude-web:sonnet');
    expect(state.selectedModels).toContain('claude-web:custom');
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
});
