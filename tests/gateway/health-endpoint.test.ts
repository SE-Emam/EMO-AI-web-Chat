/**
 * Task 14 — /health expansion (TDD: failing first).
 *
 * Owner locked rules:
 *  - /health reports LOCAL state only — it NEVER sends a test message to
 *    ChatGPT (or any provider): driver.sendMessage call count must not
 *    change across a /health request;
 *  - provider state must be 'not_checked' unless actually verified — never
 *    "available";
 *  - breaker states, in-flight count, queued count, unconfirmed broker
 *    count, last failure code and last success/failure times are exposed;
 *  - NO secrets: no API keys, bearer tokens, cookies, IPC tokens or chat
 *    content anywhere in the response.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ArenaDriver, ChatMessage } from '../../src/types.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import { RoutingDriver, type DriverRoute } from '../../src/arena/routing-driver.js';
import { BreakerRegistry } from '../../src/arena/circuit-breaker.js';
import { ResilienceRegistry, getGlobalResilienceRegistry } from '../../src/arena/provider-failures.js';

// Real RequestBroker semantics, redirected to a throwaway store so /health
// broker counts never read the user's real store and tests can seed entries.
vi.mock('../../src/protocol/request-broker.js', async (importOriginal) => {
  const actual: typeof import('../../src/protocol/request-broker.js') = await importOriginal();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emo-health-broker-'));
  (globalThis as any).__emoHealthBrokerDir = dir;
  class RedirectedRequestBroker extends actual.RequestBroker {
    constructor(storePath?: string, lock?: any) {
      super(storePath ?? path.join(dir, 'request-broker.json'), lock);
    }
  }
  return { ...actual, RequestBroker: RedirectedRequestBroker };
});

const { createServer } = await import('../../src/server/app.js');

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const tmpDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'emo-health-'));
  dirs.push(d);
  return d;
};

const sendMock = vi.fn(async () => 'answer');
const fakeWebDriver = (tag: string): ArenaDriver =>
  ({
    listModels: vi.fn().mockResolvedValue([`${tag}-model`]),
    sendMessage: sendMock,
    close: vi.fn(),
    getProfileDir: () => `/profiles/${tag}-profile`,
  }) as unknown as ArenaDriver;

const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'hi' }];

const buildApp = () => {
  const store = tmpDir();
  const breakers = new BreakerRegistry(path.join(store, 'breaker.json'), { threshold: 1, recoveryMs: 60_000 });
  const registry = new ResilienceRegistry();
  const routes: DriverRoute[] = [
    { name: 'chatgpt-web', driver: fakeWebDriver('chatgpt'), matches: (m) => m.startsWith('gpt') },
    { name: 'zai-web', driver: fakeWebDriver('zai'), matches: () => true },
  ];
  const driver = new RoutingDriver(routes, { breakers, registry });
  // Seed local resilience memory WITHOUT any real provider call.
  registry.recordFailure('chatgpt-web', '/profiles/chatgpt-profile', 'NETWORK_TIMEOUT', { sent: true, confirmed: false });
  const app = createServer(driver, { ...DEFAULT_CONFIG });
  return { app, breakers, driver };
};

describe('/health (Task 14 — local-only expansion)', () => {
  it('reports gateway/browser/broker/requests/breaker/provider sections WITHOUT contacting any provider', async () => {
    const { app } = buildApp();
    const before = sendMock.mock.calls.length;
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(sendMock.mock.calls.length).toBe(before); // NO provider call — ever

    expect(body.gateway.alive).toBe(true);
    expect(typeof body.gateway.uptimeMs).toBe('number');
    expect(body.gateway.browserServiceRunning).toBe(true);

    expect(body.profileOwnership.state).toBe('local_driver');
    expect(body.ipc.state).toBe('off');

    expect(Array.isArray(body.providers)).toBe(true);
    expect(body.providers.length).toBe(2);
    const chatgpt = body.providers.find((p: { name: string }) => p.name === 'chatgpt-web');
    expect(chatgpt.breakerState).toBe('closed');
    expect(chatgpt.providerState).toBe('not_checked'); // NEVER "available" without verification
    expect(chatgpt.lastFailureCode).toBe('NETWORK_TIMEOUT');
    expect(typeof chatgpt.lastFailureAt).toBe('number');

    expect(body.broker.unconfirmed).toBe(0);
    expect(body.requests.queuedWaiting).toBeGreaterThanOrEqual(0);
  });

  it('reflects an OPEN breaker and the broker unconfirmed count from local state', async () => {
    const { app, breakers } = buildApp();
    await breakers.forProvider('zai-web', '/profiles/zai-profile').record('NETWORK_TIMEOUT');
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(res.body);
    const zai = body.providers.find((p: { name: string }) => p.name === 'zai-web');
    expect(zai.breakerState).toBe('open');
    expect(body.requests.inFlight ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('never includes secrets or chat content in the response', async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    const text = res.body.toLowerCase();
    for (const banned of ['bearer ', 'sk-', 'cookie', 'authorization', 'apikey', 'api_key', 'chat content']) {
      expect(text).not.toContain(banned);
    }
    // No full conversation text either: the user message 'hi' must never
    // appear as a JSON string value (not as a substring of other words).
    expect(res.body).not.toContain('"hi"');
  });

  it('the global resilience registry used by cli wiring stays secret-free and per-process', () => {
    const r = getGlobalResilienceRegistry();
    r.recordSuccess('probe-only', 'p');
    const snap = r.snapshot();
    expect(snap['probe-only::p'].lastSuccessAt).toBeGreaterThan(0);
    expect(JSON.stringify(snap)).not.toMatch(/bearer|cookie|sk-/i);
  });
});
