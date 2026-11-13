import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GatewayConfigStore, defaultGatewayConfig } from '../../src/gateway/config-store.js';

describe('gateway config store', () => {
  let dir: string;
  let file: string;

  it('ships the startup-scan defaults (the scan runs when the app starts)', async () => {
    const cfg = defaultGatewayConfig();
    expect(cfg.ui.discovery?.runOnStartup).toBe(true);
    expect(cfg.ui.discovery?.checkConnectionsOnStartup).toBe(true);
    expect(cfg.ui.discovery?.enabled).toBe(true);
    expect(cfg.ui.discovery?.intervalMs).toBe(12 * 60 * 60 * 1000);
    expect(typeof cfg.ui.discovery?.startupDelayMs).toBe('number');
  });

  it('keeps the startup-scan settings when a config is saved and loaded', async () => {
    const store2 = new GatewayConfigStore(file);
    const cfg = defaultGatewayConfig();
    cfg.ui.discovery = { ...(cfg.ui.discovery as any), runOnStartup: false, checkConnectionsOnStartup: false };
    await store2.save(cfg);
    const loaded = await new GatewayConfigStore(file).load();
    expect(loaded.ui.discovery?.runOnStartup).toBe(false);
    expect(loaded.ui.discovery?.checkConnectionsOnStartup).toBe(false);
  });

  it('ships the agent-bridge defaults (expected-call enforcement on)', () => {
    const cfg = defaultGatewayConfig();
    expect(cfg.ui.agentBridge?.repairRefusals).toBe(true);
    expect(cfg.ui.agentBridge?.environmentBlock).toBe(false);
    expect(cfg.ui.agentBridge?.enforceExpectedCall).toBe(true);
  });

  it('keeps an explicit enforceExpectedCall=false across save and load', async () => {
    const store2 = new GatewayConfigStore(file);
    const cfg = defaultGatewayConfig();
    (cfg.ui.agentBridge as any).enforceExpectedCall = false;
    await store2.save(cfg);
    const loaded = await new GatewayConfigStore(file).load();
    expect(loaded.ui.agentBridge?.enforceExpectedCall).toBe(false);
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gwcfg-'));
    file = path.join(dir, 'gateway.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('defaultGatewayConfig has required display/auth defaults and web providers', () => {
    const cfg = defaultGatewayConfig();
    expect(cfg.gateway.baseUriDisplay).toBe('emo-web.ai/v1');
    expect(cfg.gateway.apiKey).toBe('emo.web');
    expect(cfg.gateway.requireApiKey).toBe(true);
    expect(cfg.routerGroups).toEqual([]);
    for (const id of ['arena-browser', 'zai-web', 'claude-web', 'tencent-ai-web', 'gemini-web', 'qwen-web', 'chatgpt-web', 'grok-web', 'kimi-web', 'minimax-web', 'longcat-web', 'llm7-web', 'kiwi-web', 'deepseek-web', 'mistral-web'] as const) {
      expect(cfg.providers[id]).toBeDefined();
      expect(cfg.providers[id]?.enabled).toBe(false);
      expect(cfg.providers[id]?.settings.headless).toBe(true);
      expect(cfg.providers[id]?.settings.privacyMode).toBe(false);
      expect(Array.isArray(cfg.providers[id]?.selectedModels)).toBe(true);
    }
  });

  it('load returns defaults when file is missing', async () => {
    const store = new GatewayConfigStore(file);
    const cfg = await store.load();
    expect(cfg.gateway.apiKey).toBeTruthy();
    expect(cfg.providers['claude-web']).toBeDefined();
  });

  it('save then load round-trips selected models/settings without runtime fields', async () => {
    const store = new GatewayConfigStore(file);
    const cfg = defaultGatewayConfig();
    cfg.providers['claude-web'] = {
      enabled: true,
      settings: { headless: false, timeoutMs: 1234 },
      availableModels: ['claude-web:default'],
      selectedModels: ['claude-web:default'],
    };
    await store.save(cfg);
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(raw.providers['claude-web'].status).toBeUndefined();
    expect(raw.providers['claude-web'].runtimeMs).toBeUndefined();
    const loaded = await store.load();
    expect(loaded.providers['claude-web']?.selectedModels).toEqual(['claude-web:default']);
    expect(loaded.providers['claude-web']?.settings.timeoutMs).toBe(1234);
    expect(loaded.providers['claude-web']?.enabled).toBe(true);
  });

  it('save/load round-trips routerGroups', async () => {
    const store = new GatewayConfigStore(file);
    const cfg = defaultGatewayConfig();
    cfg.routerGroups = [{
      id: 'g1',
      name: 'GroupA',
      enabled: true,
      strategy: 'sequential',
      targets: [{ id: 't1', kind: 'web', providerId: 'claude-web', model: 'claude-web:default' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }];
    await store.save(cfg);
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(raw.routerGroups[0].name).toBe('GroupA');
    const loaded = await store.load();
    expect(loaded.routerGroups).toHaveLength(1);
    expect(loaded.routerGroups?.[0]?.targets[0]?.providerId).toBe('claude-web');
  });
});
