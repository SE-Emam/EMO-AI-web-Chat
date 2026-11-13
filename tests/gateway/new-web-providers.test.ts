import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WEB_PROVIDER_IDS, type WebProviderId } from '../../src/gateway/types.js';
import { WEB_PROVIDERS, matchesProvider, providerSpec } from '../../src/arena/providers.js';
import {
  ChatGPTWebDriver,
  GrokWebDriver,
  KimiWebDriver,
  MiniMaxWebDriver,
  LongCatWebDriver,
  Llm7WebDriver,
  KiwiWebDriver,
  DeepSeekWebDriver,
  MistralWebDriver,
} from '../../src/arena/web-drivers.js';
import { GatewayConfigStore, defaultGatewayConfig } from '../../src/gateway/config-store.js';
import { ProviderManager } from '../../src/gateway/provider-manager.js';
import type { ArenaDriver, ChatMessage } from '../../src/types.js';

function fakeDriver(name: string, models: string[]): ArenaDriver {
  return {
    async listModels() {
      return models;
    },
    async sendMessage(model: string, _messages: ChatMessage[]) {
      return `${name}:${model}`;
    },
    async close() {},
  };
}

describe('New Web Chat Providers (ChatGPT, Grok, Kimi, MiniMax, LongCat, LLM7, Kiwi)', () => {
  let dir: string;
  let store: GatewayConfigStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'new-providers-test-'));
    store = new GatewayConfigStore(path.join(dir, 'gateway.json'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('registers all 15 web provider IDs and Arena Web name', () => {
    const expected: WebProviderId[] = [
      'arena-browser',
      'zai-web',
      'claude-web',
      'tencent-ai-web',
      'gemini-web',
      'qwen-web',
      'chatgpt-web',
      'grok-web',
      'kimi-web',
      'minimax-web',
      'longcat-web',
      'llm7-web',
      'kiwi-web',
      'deepseek-web',
      'mistral-web',
    ];
    expect(WEB_PROVIDER_IDS).toEqual(expected);
    expect(WEB_PROVIDERS.map((p) => p.id)).toEqual(expected);
    expect(providerSpec('arena-browser').name).toBe('Arena Web');
  });

  it('matches provider model prefixes correctly', () => {
    // chatgpt-web
    expect(matchesProvider('chatgpt-web', 'chatgpt-web:gpt-4o')).toBe(true);
    expect(matchesProvider('chatgpt-web', 'chatgpt:o1')).toBe(true);
    expect(matchesProvider('chatgpt-web', 'gpt:4o-mini')).toBe(true);

    // grok-web
    expect(matchesProvider('grok-web', 'grok-web:grok-2')).toBe(true);
    expect(matchesProvider('grok-web', 'grok:grok-3')).toBe(true);

    // kimi-web
    expect(matchesProvider('kimi-web', 'kimi-web:k1.5')).toBe(true);
    expect(matchesProvider('kimi-web', 'kimi:latest')).toBe(true);
    expect(matchesProvider('kimi-web', 'moonshot:v1')).toBe(true);

    // minimax-web
    expect(matchesProvider('minimax-web', 'minimax-web:abab6.5s')).toBe(true);
    expect(matchesProvider('minimax-web', 'minimax:minimax-01')).toBe(true);
    expect(matchesProvider('minimax-web', 'hailuo:abab6.5s')).toBe(true);

    // longcat-web
    expect(matchesProvider('longcat-web', 'longcat-web:default')).toBe(true);
    expect(matchesProvider('longcat-web', 'longcat:auto')).toBe(true);

    // llm7-web
    expect(matchesProvider('llm7-web', 'llm7-web:claude-3-7-sonnet')).toBe(true);
    expect(matchesProvider('llm7-web', 'llm7:gpt-4o')).toBe(true);

    // kiwi-web
    expect(matchesProvider('kiwi-web', 'kiwi-web:default')).toBe(true);
    expect(matchesProvider('kiwi-web', 'kiwi:auto')).toBe(true);

    // deepseek-web
    expect(matchesProvider('deepseek-web', 'deepseek-web:deepseek-chat')).toBe(true);
    expect(matchesProvider('deepseek-web', 'deepseek:deepseek-reasoner')).toBe(true);

    // mistral-web
    expect(matchesProvider('mistral-web', 'mistral-web:mistral-large-latest')).toBe(true);
    expect(matchesProvider('mistral-web', 'mistral:codestral-latest')).toBe(true);
    expect(matchesProvider('mistral-web', 'lechat:pixtral-large-latest')).toBe(true);
  });

  it('initializes driver classes and returns canonical models', async () => {
    const dummyConfig = { enabled: true, userDataDir: '/tmp/dummy' };

    const chatgpt = new ChatGPTWebDriver(dummyConfig);
    const grok = new GrokWebDriver(dummyConfig);
    const kimi = new KimiWebDriver(dummyConfig);
    const minimax = new MiniMaxWebDriver(dummyConfig);
    const longcat = new LongCatWebDriver(dummyConfig);
    const llm7 = new Llm7WebDriver(dummyConfig);
    const kiwi = new KiwiWebDriver(dummyConfig);
    const deepseek = new DeepSeekWebDriver(dummyConfig);
    const mistral = new MistralWebDriver(dummyConfig);

    expect(await chatgpt.listModels()).toContain('chatgpt-web:default');
    expect(await grok.listModels()).toContain('grok-web:default');
    expect(await kimi.listModels()).toContain('kimi-web:default');
    expect(await minimax.listModels()).toContain('minimax-web:default');
    expect(await longcat.listModels()).toContain('longcat-web:default');
    expect(await llm7.listModels()).toContain('llm7-web:default');
    expect(await kiwi.listModels()).toContain('kiwi-web:default');
    expect(await deepseek.listModels()).toContain('deepseek-web:default');
    expect(await mistral.listModels()).toContain('mistral-web:default');
  });

  it('initializes default config seeds for all 15 providers in GatewayConfigStore', () => {
    const cfg = defaultGatewayConfig();
    for (const id of WEB_PROVIDER_IDS) {
      expect(cfg.providers[id]).toBeDefined();
      expect(cfg.providers[id].availableModels.length).toBeGreaterThan(0);
      expect(cfg.providers[id].selectedModels.length).toBeGreaterThan(0);
      expect(cfg.providers[id].settings.baseUrl).toBe(providerSpec(id).defaultBaseUrl);
    }
  });

  it('ProviderManager lists all 13 providers and routes models to enabled providers', async () => {
    const config = defaultGatewayConfig();
    config.providers['chatgpt-web'].enabled = true;
    config.providers['chatgpt-web'].selectedModels = ['chatgpt-web:gpt-4o'];
    config.providers['grok-web'].enabled = true;
    config.providers['grok-web'].selectedModels = ['grok-web:grok-3'];
    config.providers['kimi-web'].enabled = true;
    config.providers['kimi-web'].selectedModels = ['kimi-web:k1.5'];
    config.providers['minimax-web'].enabled = true;
    config.providers['minimax-web'].selectedModels = ['minimax-web:abab6.5s'];
    config.providers['longcat-web'].enabled = true;
    config.providers['longcat-web'].selectedModels = ['longcat-web:default'];
    config.providers['llm7-web'].enabled = true;
    config.providers['llm7-web'].selectedModels = ['llm7-web:claude-3-7-sonnet'];
    config.providers['kiwi-web'].enabled = true;
    config.providers['kiwi-web'].selectedModels = ['kiwi-web:auto'];

    const factories = {
      'chatgpt-web': () => fakeDriver('chatgpt', ['chatgpt-web:gpt-4o']),
      'grok-web': () => fakeDriver('grok', ['grok-web:grok-3']),
      'kimi-web': () => fakeDriver('kimi', ['kimi-web:k1.5']),
      'minimax-web': () => fakeDriver('minimax', ['minimax-web:abab6.5s']),
      'longcat-web': () => fakeDriver('longcat', ['longcat-web:default']),
      'llm7-web': () => fakeDriver('llm7', ['llm7-web:claude-3-7-sonnet']),
      'kiwi-web': () => fakeDriver('kiwi', ['kiwi-web:auto']),
    };

    const mgr = new ProviderManager({ store, config, factories: factories as any });
    await mgr.init();

    const states = mgr.listStates();
    expect(states.length).toBe(15);
    const stateIds = states.map((s) => s.id);
    for (const id of WEB_PROVIDER_IDS) {
      expect(stateIds).toContain(id);
    }

    // Check active driver model routing
    const activeDriver = mgr.getActiveDriver();
    const models = await activeDriver.listModels();
    expect(models).toContain('chatgpt-web:gpt-4o');
    expect(models).toContain('grok-web:grok-3');
    expect(models).toContain('kimi-web:k1.5');
    expect(models).toContain('minimax-web:abab6.5s');
    expect(models).toContain('longcat-web:default');
    expect(models).toContain('llm7-web:claude-3-7-sonnet');
    expect(models).toContain('kiwi-web:auto');

    // Start ChatGPT web and send message
    await mgr.start('chatgpt-web');
    const res = await activeDriver.sendMessage('chatgpt-web:gpt-4o', [{ role: 'user', content: 'hello' }]);
    expect(res).toBe('chatgpt:chatgpt-web:gpt-4o');
  });
});
