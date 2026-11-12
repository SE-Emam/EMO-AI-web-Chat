import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server/app.js';
import type { ArenaDriver, ChatMessage } from '../../src/types.js';
import { defaultGatewayConfig } from '../../src/gateway/config-store.js';
import { UsageTracker } from '../../src/gateway/usage-tracker.js';
import { chatSessionKey } from '../../src/server/chat-session-key.js';

function mockManager(models = ['claude-web:default']) {
  const sentKeys: string[] = [];
  const driver: ArenaDriver = {
    async listModels() { return models; },
    async sendMessage(_m: string, _msgs: ChatMessage[], _onChunk, _signal, sessionKey) {
      sentKeys.push(String(sessionKey));
      return 'ok';
    },
  };
  return {
    sentKeys,
    getActiveDriver: () => driver,
    listStates: () => [{ id: 'claude-web', name: 'Claude Web', status: 'stopped', enabled: true, runtimeMs: 0, availableModels: models, selectedModels: models, settings: {} }],
    getState: (id: string) => ({ id, name: 'Claude Web', status: 'stopped', enabled: true, runtimeMs: 0, availableModels: models, selectedModels: models, settings: {} }),
    start: async (id: string) => ({ id, status: 'running' }),
    stop: async (id: string) => ({ id, status: 'stopped' }),
    refreshModels: async (id: string) => ({ id, availableModels: models, selectedModels: models }),
    updateProvider: async (id: string, patch: any) => ({ id, ...patch }),
    saveConfig: async () => {},
    getConfig: () => defaultGatewayConfig(),
    isServiceRunning: () => true,
    setServiceRunning: async (val: boolean) => val,
    close: async () => {},
  } as any;
}

const IDENTICAL_BODY = {
  model: 'claude-web:default',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Do the thing.' },
  ],
};

describe('session isolation (Task 4 semantics)', () => {
  let app: FastifyInstance;
  let base: string;
  let manager: ReturnType<typeof mockManager>;

  beforeAll(async () => {
    manager = mockManager();
    const cfg = defaultGatewayConfig();
    cfg.gateway.requireApiKey = true;
    cfg.gateway.apiKey = 'mac';
    app = createServer({ mode: 'gateway', manager, tracker: new UsageTracker({ heartbeatTimeoutMs: 15000 }), gatewayConfig: cfg } as any);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });
  afterAll(async () => { await app.close(); });

  const post = (headers: Record<string, string> = {}) =>
    fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mac', ...headers },
      body: JSON.stringify(IDENTICAL_BODY),
    });

  it('TWO DIFFERENT explicit headers with IDENTICAL messages = TWO DIFFERENT sessions', async () => {
    await post({ 'X-Chat-Session-ID': 'task-alpha' });
    await post({ 'X-Chat-Session-ID': 'task-beta' });
    expect(manager.sentKeys.length).toBeGreaterThanOrEqual(2);
    const last2 = manager.sentKeys.slice(-2);
    expect(last2[0]).toBe('task-alpha');
    expect(last2[1]).toBe('task-beta');
    expect(last2[0]).not.toBe(last2[1]);
  });

  it('an explicit header ALWAYS beats the fingerprint (same header → same key)', async () => {
    await post({ 'X-Chat-Session-ID': 'explicit-wins' });
    await post({ 'X-Chat-Session-ID': 'explicit-wins' });
    expect(manager.sentKeys.slice(-2)).toEqual(['explicit-wins', 'explicit-wins']);
  });

  it('NO header → stable fingerprint: identical messages reuse ONE key', async () => {
    await post();
    await post();
    const [a, b] = manager.sentKeys.slice(-2);
    expect(a).toBe(b);
    expect(a).toMatch(/^task-/);
  });

  it('NO header → different first user message → different fingerprint', async () => {
    await post();
    await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mac' },
      body: JSON.stringify({ ...IDENTICAL_BODY, messages: [...IDENTICAL_BODY.messages.slice(0, 1), { role: 'user', content: 'A different task entirely' }] }),
    });
    const [a, b] = manager.sentKeys.slice(-2);
    expect(a).not.toBe(b);
  });

  it('metadata.session_id is used when the header is absent', async () => {
    await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mac' },
      body: JSON.stringify({ ...IDENTICAL_BODY, metadata: { session_id: 'meta-session-1' } }),
    });
    expect(manager.sentKeys[manager.sentKeys.length - 1]).toBe('meta-session-1');
  });

  it('header beats metadata when both are present', () => {
    const req = { headers: { 'x-chat-session-id': 'from-header' } } as any;
    const body = { metadata: { session_id: 'from-meta' } };
    expect(chatSessionKey(req, body, IDENTICAL_BODY.messages as any)).toBe('from-header');
  });

  it('fingerprint is deterministic for the same system+first user message', () => {
    const k1 = chatSessionKey({ headers: {} } as any, {}, IDENTICAL_BODY.messages as any);
    const k2 = chatSessionKey({ headers: {} } as any, {}, IDENTICAL_BODY.messages as any);
    expect(k1).toBe(k2);
    expect(k1.startsWith('task-')).toBe(true);
  });
});
