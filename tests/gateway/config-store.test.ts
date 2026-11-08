import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GatewayConfigStore, defaultGatewayConfig } from '../../src/gateway/config-store.js';

describe('gateway config store', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gwcfg-'));
    file = path.join(dir, 'gateway.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('defaultGatewayConfig has required display/auth defaults and web providers', () => {
    const cfg = defaultGatewayConfig();
    expect(cfg.gateway.baseUriDisplay).toBe('mac.ai/v1');
    expect(cfg.gateway.apiKey).toBeTruthy();
    expect(cfg.gateway.apiKey.length).toBeGreaterThanOrEqual(20);
    expect(cfg.gateway.requireApiKey).toBe(true);
    for (const id of ['arena-browser', 'zai-web', 'claude-web', 'tencent-ai-web', 'gemini-web', 'qwen-web'] as const) {
      expect(cfg.providers[id]).toBeDefined();
      expect(cfg.providers[id]?.enabled).toBe(false);
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

  it('load falls back to defaults on corrupted JSON', async () => {
    await fs.writeFile(file, '{not-json', 'utf8');
    const store = new GatewayConfigStore(file);
    const cfg = await store.load();
    expect(cfg.gateway.baseUriDisplay).toBe('mac.ai/v1');
  });
});
