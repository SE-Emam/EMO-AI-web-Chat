import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readGoogleProfilePreferences } from '../../src/gateway/auth-detector.js';
import { GatewayConfigStore, defaultGatewayConfig } from '../../src/gateway/config-store.js';
import { ProviderManager } from '../../src/gateway/provider-manager.js';
import type { ArenaDriver, ChatMessage } from '../../src/types.js';
import { CLAUDE_WEB_CANONICAL_MODELS } from '../../src/arena/claude-web-driver.js';
import { GEMINI_WEB_CANONICAL_MODELS } from '../../src/arena/gemini-web-driver.js';
import { QWEN_WEB_CANONICAL_MODELS } from '../../src/arena/qwen-web-driver.js';

function fakeDriver(name: string, models: string[], onSend?: (m: string) => string): ArenaDriver {
  return {
    async listModels() { return models; },
    async sendMessage(model: string, _messages: ChatMessage[]) { return onSend ? onSend(model) : `${name}:${model}`; },
    async close() {},
  };
}

describe('Auth Detection & Provider Lifecycle', () => {
  let dir: string;
  let store: GatewayConfigStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-test-'));
    store = new GatewayConfigStore(path.join(dir, 'gateway.json'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('canonical models contain real models rather than single default stub', () => {
    expect(CLAUDE_WEB_CANONICAL_MODELS.length).toBeGreaterThan(1);
    expect(CLAUDE_WEB_CANONICAL_MODELS).toContain('claude-web:claude-3-7-sonnet');
    expect(CLAUDE_WEB_CANONICAL_MODELS).toContain('claude-web:claude-3-5-sonnet');

    expect(GEMINI_WEB_CANONICAL_MODELS.length).toBeGreaterThan(1);
    expect(GEMINI_WEB_CANONICAL_MODELS).toContain('gemini-web:gemini-2.0-flash');

    expect(QWEN_WEB_CANONICAL_MODELS.length).toBeGreaterThan(1);
    expect(QWEN_WEB_CANONICAL_MODELS).toContain('qwen-web:qwen-2.5-max');
  });

  it('reads Google profile preferences offline without launching Chrome', async () => {
    const defaultDir = path.join(dir, 'Default');
    await fs.mkdir(defaultDir, { recursive: true });
    const prefData = {
      account_info: [
        {
          email: 'developer@example.com',
          full_name: 'Test Developer',
          picture_url: 'https://example.com/avatar.jpg',
        },
      ],
    };
    await fs.writeFile(path.join(defaultDir, 'Preferences'), JSON.stringify(prefData));

    const result = readGoogleProfilePreferences(dir);
    expect(result).not.toBeNull();
    expect(result?.email).toBe('developer@example.com');
    expect(result?.name).toBe('Test Developer');
  });

  it('ProviderManager.init() discovers offline Google profile preferences', async () => {
    const profileDir = path.join(dir, 'gemini-profile', 'Default');
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(
      path.join(profileDir, 'Preferences'),
      JSON.stringify({ account_info: [{ email: 'gemini.user@gmail.com', full_name: 'Gemini User' }] })
    );

    const config = defaultGatewayConfig();
    config.providers['gemini-web'].settings.userDataDir = path.join(dir, 'gemini-profile');

    const mgr = new ProviderManager({ store, config });
    await mgr.init();

    const state = mgr.getState('gemini-web');
    expect(state.isLoggedIn).toBe(true);
    expect(state.accountEmail).toBe('gemini.user@gmail.com');
    expect(state.accountName).toBe('Gemini User');
  });

  it('updateProvider persists accountName and accountEmail to disk', async () => {
    const config = defaultGatewayConfig();
    const mgr = new ProviderManager({ store, config });
    await mgr.init();

    await mgr.updateProvider('claude-web', {
      accountEmail: 'claude.pro@example.com',
      accountName: 'Claude User',
    });

    const state = mgr.getState('claude-web');
    expect(state.accountEmail).toBe('claude.pro@example.com');
    expect(state.accountName).toBe('Claude User');
    expect(state.isLoggedIn).toBe(true);

    // Verify it was written to disk
    const reloadedConfig = await store.load();
    expect(reloadedConfig.providers['claude-web'].auth?.accountEmail).toBe('claude.pro@example.com');
  });

  it('getActiveDriver().sendMessage lazy auto-starts stopped provider', async () => {
    const config = defaultGatewayConfig();
    config.providers['claude-web'] = {
      enabled: true,
      settings: {},
      availableModels: ['claude-web:default'],
      selectedModels: ['claude-web:default'],
    };

    let started = false;
    const mgr = new ProviderManager({
      store,
      config,
      factories: {
        'claude-web': () => {
          started = true;
          return fakeDriver('claude', ['claude-web:default'], (m) => `auto-started:${m}`);
        },
      } as any,
    });
    await mgr.init();

    // Verify provider is currently stopped
    expect(mgr.getState('claude-web').status).toBe('stopped');

    // Send message to stopped provider
    const res = await mgr.getActiveDriver().sendMessage('claude-web:default', [{ role: 'user', content: 'hello' }]);
    expect(started).toBe(true);
    expect(res).toBe('auto-started:claude-web:default');
    expect(mgr.getState('claude-web').status).toBe('running');
  });

  it('refreshModels saves config and auto-selects models when none were selected', async () => {
    const config = defaultGatewayConfig();
    config.providers['qwen-web'] = {
      enabled: true,
      settings: {},
      availableModels: [],
      selectedModels: [],
    };

    const mgr = new ProviderManager({
      store,
      config,
      factories: {
        'qwen-web': () => fakeDriver('qwen', ['qwen-web:qwen-2.5-max', 'qwen-web:qwen-2.5-plus']),
      } as any,
    });
    await mgr.init();

    const state = await mgr.refreshModels('qwen-web');
    expect(state.availableModels).toContain('qwen-web:qwen-2.5-max');
    expect(state.selectedModels).toContain('qwen-web:qwen-2.5-max');

    // Verify written to disk
    const saved = await store.load();
    expect(saved.providers['qwen-web'].availableModels).toContain('qwen-web:qwen-2.5-max');
    expect(saved.providers['qwen-web'].selectedModels).toContain('qwen-web:qwen-2.5-max');
  });
});
