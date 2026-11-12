/**
 * Task 10 — swarm streaming × request-broker semantics (final-audit finding).
 *
 * Proves, through the REAL /v1/chat/completions route (createServer + inject):
 *  1. a failure BEFORE the swarm send starts keeps the pre-send retry policy
 *     (failed → claim released → re-issue allowed);
 *  2. a failure AFTER the swarm execution started (mid-stream) is recorded
 *     'unconfirmed' — markSent() now fires before the first side-effecting
 *     operation (swarmCoordinator.executeAsChatCompletion);
 *  3. re-issuing the same X-Request-Id after that does NOT re-execute;
 *  4. a completed swarm keeps the stored-replay behavior (x-emo-replay).
 *
 * SwarmCoordinator is mocked (offline — no real web chats); RequestBroker is
 * the REAL class redirected to a temp store so user data is never touched.
 *
 * NOTE (vitest quirk): clearing/resetting executeMock from beforeEach while
 * route-level async work is settling makes vitest re-attribute the mock's own
 * thrown error as a phantom test failure. So instead of beforeEach+mockReset
 * we make each test self-contained and assert on CALL DELTAS, not absolutes.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ArenaDriver } from '../../src/types.js';
import { DEFAULT_CONFIG } from '../../src/config.js';

const g = globalThis as any;
g.__emoSwarmBrokerDirs = g.__emoSwarmBrokerDirs || [];

// Real RequestBroker semantics, redirected to a throwaway store per test file.
vi.mock('../../src/protocol/request-broker.js', async (importOriginal) => {
  const actual: typeof import('../../src/protocol/request-broker.js') = await importOriginal();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emo-swarm-broker-'));
  const gg = globalThis as any;
  gg.__emoSwarmBrokerDirs = gg.__emoSwarmBrokerDirs || [];
  gg.__emoSwarmBrokerDirs.push(dir);
  class RedirectedRequestBroker extends actual.RequestBroker {
    constructor(storePath?: string, lock?: any) {
      super(storePath ?? path.join(dir, 'request-broker.json'), lock);
    }
  }
  return { ...actual, RequestBroker: RedirectedRequestBroker };
});

// SwarmCoordinator mock — we control exactly when the "swarm" starts streaming
// and when it fails, without touching any real web chat.
const executeMock = vi.fn();
vi.mock('../../src/server/swarm-coordinator.js', () => ({
  SwarmCoordinator: vi.fn().mockImplementation(() => ({
    executeAsChatCompletion: (body: any, onChunk?: (c: string) => void, signal?: AbortSignal) => executeMock(body, onChunk, signal),
    executeSwarm: vi.fn().mockResolvedValue({ status: 'completed', steps: [] }),
    listSessions: vi.fn().mockReturnValue([]),
    getSession: vi.fn().mockReturnValue(undefined),
  })),
}));

import { RequestBroker, brokerKey } from '../../src/protocol/request-broker.js';

// Dynamic import AFTER the vi.mock hoisting so the mocked SwarmCoordinator and
// the redirected RequestBroker are fully in place before app.js loads.
const { createServer } = await import('../../src/server/app.js');

afterAll(() => {
  for (const d of g.__emoSwarmBrokerDirs) fs.rmSync(d, { recursive: true, force: true });
});

const driver: ArenaDriver = {
  listModels: vi.fn().mockResolvedValue(['chatgpt-web:default']),
  sendMessage: vi.fn().mockResolvedValue('should not be called in swarm path'),
};

const post = (app: any, requestId: string, stream: boolean) =>
  app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { 'x-request-id': requestId },
    payload: {
      model: 'swarm:parallel',
      stream,
      messages: [{ role: 'user', content: 'build the thing' }],
    },
  });

// Number of swarm executions that happened SINCE the test started (deltas are
// robust across tests because the mock's call history is never cleared here).
const execDelta = () => executeMock.mock.calls.length;

describe('Swarm streaming × RequestBroker (Task 10)', () => {
  it('completed swarm keeps the stored-replay behavior; re-issue does NOT re-execute', async () => {
    const before = execDelta();
    executeMock.mockImplementation(async (_body: any, onChunk?: (c: string) => void) => {
      onChunk?.('أول ');
      onChunk?.('جزء');
      return 'أول جزء';
    });
    const app = createServer(driver, { ...DEFAULT_CONFIG });
    const first = await post(app, 'swarm-ok-1', true);
    expect(first.statusCode).toBe(200);
    expect(first.body).toContain('أول');
    expect(first.body).toContain('[DONE]');
    expect(execDelta() - before).toBe(1); // exactly one swarm execution

    // The route records complete() AFTER ending the SSE response — wait for
    // the state to land before re-issuing (test-side race, not a code race).
    const store = path.join(g.__emoSwarmBrokerDirs[0], 'request-broker.json');
    const key = brokerKey('anon', 'swarm:parallel', 'swarm-ok-1');
    await vi.waitFor(() => {
      expect(new RequestBroker(store).get(key)?.state).toBe('completed');
    }, { timeout: 5_000 });

    // Same X-Request-Id → stored replay, not a new execution.
    const replay = await post(app, 'swarm-ok-1', true);
    expect(replay.headers['x-emo-replay']).toBe('true');
    expect(replay.body).toContain('أول');
    expect(replay.body).toContain('جزء');
    expect(replay.body).toContain('[DONE]');
    expect(execDelta() - before).toBe(1); // still exactly one — never re-executed
  });

  it('mid-stream failure AFTER the swarm started → unconfirmed; same X-Request-Id cannot re-execute', async () => {
    const before = execDelta();
    executeMock.mockImplementation(async (_body: any, onChunk?: (c: string) => void) => {
      onChunk?.('partial-before-crash');
      throw new Error('agent crashed mid-swarm');
    });
    const app = createServer(driver, { ...DEFAULT_CONFIG });
    const first = await post(app, 'swarm-crash-1', true);
    expect(first.statusCode).toBe(200); // SSE was already hijacked/started
    expect(first.body).toContain('partial-before-crash');
    expect(first.body).toContain('agent crashed mid-swarm');
    expect(execDelta() - before).toBe(1);

    // The route policy: markSent BEFORE executeAsChatCompletion → the failure
    // must be upgraded to unconfirmed (never blindly retryable).
    const store = path.join(g.__emoSwarmBrokerDirs[0], 'request-broker.json');
    const key = brokerKey('anon', 'swarm:parallel', 'swarm-crash-1');
    expect(new RequestBroker(store).get(key)?.state).toBe('unconfirmed');

    // Re-issue with the same X-Request-Id → denied, no second execution.
    const second = await post(app, 'swarm-crash-1', true);
    expect(second.statusCode).toBe(409);
    const body = JSON.parse(second.body);
    expect(body.error.state).toBe('unconfirmed');
    expect(execDelta() - before).toBe(1); // the swarm did NOT run twice
  });

  it('broker policy backing the route: pre-send failure keeps retry, post-markSent failure never does', async () => {
    // (1) Failure BEFORE markSent — the only pre-send phase left in the stream
    // route (before the first side-effecting operation) — retry allowed.
    const b0 = new RequestBroker();
    const k0 = brokerKey('anon', 'swarm:parallel', 'pre-send-fail');
    const claim0 = await b0.begin(k0, 'sess');
    expect(claim0.allowed).toBe(true);
    await claim0.fail({ retryable: true, error: 'failed before any send' });
    const retry = await b0.begin(k0, 'sess');
    expect(retry.allowed).toBe(true); // pre-send failure → claim released

    // (2) After markSent (now fired before the swarm's first side effect) ANY
    // failure is unconfirmed, even when the caller asks for retryable.
    const b1 = new RequestBroker();
    const k1 = brokerKey('anon', 'swarm:parallel', 'post-start-fail');
    const claim1 = await b1.begin(k1, 'sess');
    expect(claim1.allowed).toBe(true);
    claim1.markSent();
    await claim1.fail({ retryable: true, error: 'mid-stream abort' });
    const denied = await b1.begin(k1, 'sess');
    expect(denied.allowed).toBe(false);
    expect(denied.state).toBe('unconfirmed');
  });
});
