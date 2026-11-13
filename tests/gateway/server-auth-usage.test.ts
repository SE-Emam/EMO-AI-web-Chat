import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server/app.js';
import type { ArenaDriver, ChatMessage } from '../../src/types.js';
import { defaultGatewayConfig } from '../../src/gateway/config-store.js';
import { UsageTracker } from '../../src/gateway/usage-tracker.js';

function mockManager(models = ['claude-web:default']) {
  let isRunning = true;
  const driver: ArenaDriver = {
    async listModels() { return models; },
    async sendMessage(_m: string, msgs: ChatMessage[], onChunk) {
      const text = 'ok:' + (msgs[msgs.length - 1]?.content || '');
      if (onChunk) onChunk(text);
      return text;
    },
  };
  return {
    getActiveDriver: () => driver,
    listStates: () => [{ id: 'claude-web', name: 'Claude Web', status: 'stopped', enabled: true, runtimeMs: 0, availableModels: models, selectedModels: models, settings: {} }],
    getState: (id: string) => ({ id, name: 'Claude Web', status: 'stopped', enabled: true, runtimeMs: 0, availableModels: models, selectedModels: models, settings: {} }),
    start: async (id: string) => ({ id, status: 'running' }),
    stop: async (id: string) => ({ id, status: 'stopped' }),
    refreshModels: async (id: string) => ({ id, availableModels: models, selectedModels: models }),
    updateProvider: async (id: string, patch: any) => ({ id, ...patch }),
    saveConfig: async () => {},
    getConfig: () => defaultGatewayConfig(),
    isServiceRunning: () => isRunning,
    setServiceRunning: async (val: boolean) => { isRunning = val; return val; },
    close: async () => {},
  } as any;
}

describe('gateway server auth/usage/management', () => {
  let app: FastifyInstance;
  let base: string;
  let tracker: UsageTracker;

  beforeAll(async () => {
    tracker = new UsageTracker({ heartbeatTimeoutMs: 15000 });
    const cfg = defaultGatewayConfig();
    cfg.gateway.requireApiKey = true;
    cfg.gateway.apiKey = 'mac';
    app = createServer({ mode: 'gateway', manager: mockManager(), tracker, gatewayConfig: cfg } as any);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });
  afterAll(async () => { await app.close(); });

  it('rejects /v1 without key and accepts Bearer/x-api-key mac', async () => {
    const body = JSON.stringify({ model: 'claude-web:default', messages: [{ role: 'user', content: 'hi' }] });
    let r = await fetch(`${base}/v1/models`);
    expect(r.status).toBe(401);
    r = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    expect(r.status).toBe(401);
    r = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mac' }, body });
    expect(r.status).toBe(200);
    expect((await r.json()).choices[0].message.content).toContain('ok:hi');
    r = await fetch(`${base}/v1/models`, { headers: { 'x-api-key': 'mac' } });
    expect(r.status).toBe(200);
  });

  it('heartbeat updates usage session and status returns gateway info', async () => {
    let r = await fetch(`${base}/api/gateway/heartbeat`, { method: 'POST', headers: { Authorization: 'Bearer mac' } });
    expect(r.status).toBe(200);
    r = await fetch(`${base}/api/gateway/status`, { headers: { Authorization: 'Bearer mac' } });
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.gateway.baseUriDisplay).toBe('emo-web.ai/v1');
    expect(data.gateway.api).toBe('mac');
    expect(data.usage.sessionActive).toBe(true);
    expect(Array.isArray(data.providers)).toBe(true);
  });

  it('serves management UI with emo-web.ai/v1 marker', async () => {
    const r = await fetch(`${base}/`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('emo-web.ai/v1');
    expect(html.toLowerCase()).toMatch(/provider|مزود|emo/);
  });

  it('toggles gateway service state and responds 503 when service is stopped', async () => {
    // Toggle service off
    let r = await fetch(`${base}/api/gateway/service-toggle`, { method: 'POST', headers: { Authorization: 'Bearer mac' } });
    expect(r.status).toBe(200);
    let res = await r.json();
    expect(res.serviceRunning).toBe(false);

    // Requesting chat completions while stopped returns 503
    const body = JSON.stringify({ model: 'claude-web:default', messages: [{ role: 'user', content: 'test' }] });
    r = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mac' }, body });
    expect(r.status).toBe(503);
    const err = await r.json();
    expect(err.error.type).toBe('service_unavailable');

    // Toggle service back on
    r = await fetch(`${base}/api/gateway/service-toggle`, { method: 'POST', headers: { Authorization: 'Bearer mac' } });
    expect(r.status).toBe(200);
    res = await r.json();
    expect(res.serviceRunning).toBe(true);

    // Request succeeds again
    r = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mac' }, body });
    expect(r.status).toBe(200);
  });
});
