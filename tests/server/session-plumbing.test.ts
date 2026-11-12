import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server/app.js';
import type { ArenaDriver, ChatMessage } from '../../src/types.js';
import { defaultGatewayConfig } from '../../src/gateway/config-store.js';
import { UsageTracker } from '../../src/gateway/usage-tracker.js';
import { RoutingDriver } from '../../src/arena/routing-driver.js';

function mockManager(models = ['claude-web:default']) {
  const sent: Array<{ key: string | undefined; model: string }> = [];
  const driver: ArenaDriver = {
    async listModels() { return models; },
    async sendMessage(model: string, _msgs: ChatMessage[], _onChunk, _signal, sessionKey) {
      sent.push({ key: sessionKey === undefined ? undefined : String(sessionKey), model });
      return `ok:${model}`;
    },
  };
  return {
    sent,
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

describe('sessionKey plumbing into every route (Task 7)', () => {
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

  it('/v1/messages (Anthropic, non-stream) passes X-Chat-Session-ID as the 5th arg', async () => {
    const r = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'mac', 'X-Chat-Session-ID': 'anthropic-task-1' },
      body: JSON.stringify({ model: 'claude-web:default', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(r.status).toBe(200);
    const last = manager.sent[manager.sent.length - 1]!;
    expect(last.key).toBe('anthropic-task-1');
  });

  it('/v1/messages (Anthropic, stream) passes the session key too', async () => {
    const r = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'mac', 'X-Chat-Session-ID': 'anthropic-task-2' },
      body: JSON.stringify({ model: 'claude-web:default', max_tokens: 64, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(r.status).toBe(200);
    const last = manager.sent[manager.sent.length - 1]!;
    expect(last.key).toBe('anthropic-task-2');
  });

  it('/v1beta generateContent (Gemini, non-stream) passes the session key', async () => {
    const r = await fetch(`${base}/v1beta/models/claude-web:default:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'mac', 'X-Chat-Session-ID': 'gemini-task-1' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
    });
    expect(r.status).toBe(200);
    const last = manager.sent[manager.sent.length - 1]!;
    expect(last.key).toBe('gemini-task-1');
  });

  it('/v1beta generateContent (Gemini, stream) passes the session key', async () => {
    const r = await fetch(`${base}/v1beta/models/claude-web:default:streamGenerateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'mac', 'X-Chat-Session-ID': 'gemini-task-2' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
    });
    expect(r.status).toBe(200);
    const last = manager.sent[manager.sent.length - 1]!;
    expect(last.key).toBe('gemini-task-2');
  });

  it('SWARM: every worker gets its OWN session key with agent identity (swarm-<id>-<role>-<agent>)', async () => {
    const before = manager.sent.length;
    const r = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mac' },
      body: JSON.stringify({ model: 'swarm:parallel', messages: [{ role: 'user', content: 'build a thing' }] }),
    });
    expect(r.status).toBe(200);
    const swarmSends = manager.sent.slice(before);
    expect(swarmSends.length).toBeGreaterThanOrEqual(2); // multiple workers ran
    const keys = swarmSends.map((s) => s.key!);
    for (const k of keys) {
      expect(k).toMatch(/^swarm-/);
      expect(k.split('-').length).toBeGreaterThanOrEqual(3); // swarm-<swarmId>-<role>-<agentId>
    }
    expect(new Set(keys).size).toBe(keys.length); // all distinct — no merged chats
  });
});

describe('RoutingDriver passes sessionKey through (Task 7)', () => {
  it('forwards the 5th argument to the matched route driver', async () => {
    const captured: Array<string | undefined> = [];
    const inner: ArenaDriver = {
      async listModels() { return ['m']; },
      async sendMessage(_m: string, _msgs: ChatMessage[], _onChunk, _signal, sessionKey) {
        captured.push(sessionKey === undefined ? undefined : String(sessionKey));
        return 'ok';
      },
      async close() {},
    };
    const rd = new RoutingDriver([{ name: 'r1', driver: inner, matches: () => true }]);
    await rd.sendMessage('m', [{ role: 'user', content: 'x' }], undefined, undefined, 'routing-task');
    expect(captured).toEqual(['routing-task']);
  });
});
