/**
 * Task 12 — Anthropic /v1/messages × unified Request Broker (TDD: failing first).
 *
 * Proves through the REAL route (fastify registerAnthropicRoutes + inject):
 *  1. new request with X-Request-Id → executes once, native body;
 *  2. duplicate while running → 409 denied, NO second execution;
 *  3. duplicate after completed → stored NATIVE replay (x-emo-replay), no re-exec;
 *  4. stream replay → native Anthropic SSE (message_start/content_block events/message_stop);
 *  5. stream interrupted after markSent → unconfirmed; re-issue denied;
 *  6. pre-send failure (no driver) → claim released → retry executes;
 *  7. same X-Request-Id + different payload → explicit 409 CONFLICT, never silent replay;
 *  8. different API keys → independent scope (each executes);
 *  9. different providers (models) → independent scope;
 * 10. tool calling: replay preserves the response verbatim, tools never re-run;
 * 11. send initiated then failure → unconfirmed (no blind retry);
 * 12. oversize result → completed state-only → 409 "too large to replay";
 * 13. restart persistence: a NEW app+broker over the SAME store replays.
 *
 * The broker is the REAL RequestBroker over a throwaway temp store (user
 * store never touched). No real chats — the driver is a vi.fn mock.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fastify from 'fastify';
import type { ArenaDriver } from '../../src/types.js';
import { registerAnthropicRoutes } from '../../src/server/anthropic-routes.js';
import { RequestBroker, brokerKey } from '../../src/protocol/request-broker.js';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const makeStore = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'emo-anth-broker-'));
  dirs.push(d);
  return path.join(d, 'request-broker.json');
};

const BASE_BODY = {
  model: 'claude-x',
  max_tokens: 100,
  messages: [{ role: 'user', content: 'hello' }],
};

const mockDriver = (behavior: { chunks?: string[]; reply?: string; delayMs?: number; throwAfterChunks?: string }) => {
  const send = vi.fn(
    async (
      _model: string,
      _msgs: unknown,
      onChunk?: (c: string) => void,
      signal?: AbortSignal,
      _sessionKey?: unknown
    ) => {
      if (behavior.delayMs) await new Promise((r) => setTimeout(r, behavior.delayMs));
      if (behavior.chunks) for (const c of behavior.chunks) onChunk?.(c);
      if (behavior.throwAfterChunks) throw new Error(behavior.throwAfterChunks);
      return behavior.reply ?? '';
    }
  );
  return { send, driver: { listModels: vi.fn().mockResolvedValue(['claude-x:default']), sendMessage: send } as unknown as ArenaDriver };
};

const makeApp = (storePath: string, opts?: { validKeys?: string[] }) => {
  const state: { driver: ArenaDriver | null } = { driver: null };
  const app = fastify({ logger: false });
  registerAnthropicRoutes(app, {
    getDriver: () => state.driver,
    requireApiKey: Boolean(opts?.validKeys?.length),
    getValidApiKeys: opts?.validKeys ? () => opts.validKeys! : undefined,
    broker: new RequestBroker(storePath),
  });
  return { app, state };
};

const post = (app: any, requestId: string, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: '/v1/messages',
    headers: { 'content-type': 'application/json', 'x-request-id': requestId, ...extraHeaders },
    payload: body,
  });

const entryState = (store: string, scope: string, model: string, rid: string) =>
  new RequestBroker(store).get(brokerKey(scope, `anthropic:${model}`, rid))?.state;

describe('Anthropic /v1/messages × unified broker (Task 12)', () => {
  it('1. new request with X-Request-Id executes once; native body; result stored WITH nativeReplay', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ reply: 'مرحباً من كلاود' });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const first = await post(app, 'anth-new-1', BASE_BODY);
    expect(first.statusCode).toBe(200);
    const parsed = JSON.parse(first.body);
    expect(parsed.type).toBe('message');
    expect(parsed.id).toMatch(/^msg_/);
    expect(parsed.content[0].text).toBe('مرحباً من كلاود');
    expect(send).toHaveBeenCalledTimes(1);
    // Protocol-native replay payload stored in complete() (Task 12 decision).
    // complete() is recorded asynchronously (same pattern as the OpenAI path).
    await vi.waitFor(() => {
      expect(entryState(store, 'anon', 'claude-x', 'anth-new-1')).toBe('completed');
    }, { timeout: 5_000 });
    const entry = new RequestBroker(store).get(brokerKey('anon', 'anthropic:claude-x', 'anth-new-1'));
    const stored = entry?.result as any;
    expect(stored?.nativeReplay?.type).toBe('message');
    expect(stored?.nativeReplay?.content[0].text).toBe('مرحباً من كلاود');
  });

  it('2. duplicate while RUNNING → 409 denied, no second execution', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ reply: 'slow result', delayMs: 300 });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const first = post(app, 'anth-running-1', BASE_BODY);
    await new Promise((r) => setTimeout(r, 60));
    const dup = await post(app, 'anth-running-1', BASE_BODY);
    expect(dup.statusCode).toBe(409);
    const parsed = JSON.parse(dup.body);
    expect(parsed.error.state).toBe('running');
    const finished = await first;
    expect(finished.statusCode).toBe(200);
    expect(send).toHaveBeenCalledTimes(1); // exactly ONE execution
  });

  it('3. duplicate after COMPLETED → native stored replay, never re-executed', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ reply: 'النتيجة الأصلية' });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const first = await post(app, 'anth-replay-1', BASE_BODY);
    expect(first.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(entryState(store, 'anon', 'claude-x', 'anth-replay-1')).toBe('completed');
    }, { timeout: 5_000 });
    const delta = send.mock.calls.length;
    const second = await post(app, 'anth-replay-1', BASE_BODY);
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-emo-replay']).toBe('true');
    expect(JSON.parse(second.body)).toEqual(JSON.parse(first.body)); // byte-equal native body
    expect(send.mock.calls.length).toBe(delta); // no re-execution
  });

  it('4. stream replay → NATIVE Anthropic SSE (message_start → content_block_* → message_stop), no re-execution', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ chunks: ['أول ', 'ثانٍ'], reply: 'أول ثانٍ' });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const first = await post(app, 'anth-sse-replay', { ...BASE_BODY, stream: true });
    expect(first.statusCode).toBe(200);
    expect(first.body).toContain('event: message_start');
    expect(first.body).toContain('event: message_stop');
    await vi.waitFor(() => {
      expect(entryState(store, 'anon', 'claude-x', 'anth-sse-replay')).toBe('completed');
    }, { timeout: 5_000 });
    const delta = send.mock.calls.length;
    const second = await post(app, 'anth-sse-replay', { ...BASE_BODY, stream: true });
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-emo-replay']).toBe('true');
    expect(second.body).toContain('event: message_start');
    expect(second.body).toContain('أول');
    expect(second.body).toContain('ثانٍ');
    expect(second.body).toContain('event: content_block_delta');
    expect(second.body).toContain('event: message_stop');
    expect(send.mock.calls.length).toBe(delta); // replay only — no second stream run
  });

  it('5. stream interrupted after markSent → unconfirmed; re-issue denied 409', async () => {
    const store = makeStore();
    const send = vi.fn(
      async (_m: string, _msgs: unknown, onChunk?: (c: string) => void, signal?: AbortSignal) => {
        onChunk?.('part-one');
        await new Promise<void>((_, reject) => {
          if (signal?.aborted) return reject(new Error('aborted'));
          signal?.addEventListener('abort', () => reject(new Error('client aborted mid-stream')), { once: true });
        });
      }
    );
    const { app, state } = makeApp(store);
    state.driver = { listModels: vi.fn(), sendMessage: send } as unknown as ArenaDriver;
    await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const addr = app.server.address() as { port: number };
      const ac = new AbortController();
      const res = await fetch(`http://127.0.0.1:${addr.port}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': 'anth-interrupt' },
        body: JSON.stringify({ ...BASE_BODY, stream: true }),
        signal: ac.signal,
      });
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      await reader.read(); // first SSE bytes arrived → markSent already fired
      ac.abort(); // client disconnects mid-stream
      try { await reader.read(); } catch { /* aborted read is expected */ }
      await vi.waitFor(() => {
        expect(entryState(store, 'anon', 'claude-x', 'anth-interrupt')).toBe('unconfirmed');
      }, { timeout: 5_000 });
    } finally {
      await app.close();
    }
    // Restart a fresh app over the SAME store → the interrupted request must
    // NOT be re-executable (a blind retry could duplicate the real send).
    const { send: send2, driver: driver2 } = mockDriver({ reply: 'should not run' });
    const { app: app2, state: state2 } = makeApp(store);
    state2.driver = driver2;
    const second = await post(app2, 'anth-interrupt', { ...BASE_BODY, stream: true });
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).error.state).toBe('unconfirmed');
    expect(send2).not.toHaveBeenCalled();
  });

  it('6. failure BEFORE the send (no driver) → claim released → re-issue executes', async () => {
    const store = makeStore();
    const { app, state } = makeApp(store);
    state.driver = null; // pre-send failure: nothing was sent
    const first = await post(app, 'anth-presend', BASE_BODY);
    expect(first.statusCode).toBe(500);
    // The failed entry releases its claim: absent, or present-but-failed only
    // until the next begin() removes it — never a blocking claim.
    const afterFail = entryState(store, 'anon', 'claude-x', 'anth-presend');
    expect(afterFail === null || afterFail === 'failed').toBe(true);
    const { send, driver } = mockDriver({ reply: 'succeeded on retry' });
    state.driver = driver;
    const second = await post(app, 'anth-presend', BASE_BODY);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body).content[0].text).toBe('succeeded on retry');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('7. same X-Request-Id + DIFFERENT payload → explicit 409 CONFLICT, never a silent replay', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ reply: 'result-for-payload-A' });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const first = await post(app, 'anth-conflict', BASE_BODY);
    expect(first.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(entryState(store, 'anon', 'claude-x', 'anth-conflict')).toBe('completed');
    }, { timeout: 5_000 });
    const delta = send.mock.calls.length;
    const changed = {
      ...BASE_BODY,
      messages: [{ role: 'user', content: 'a DIFFERENT request' }],
      temperature: 0.1,
    };
    const second = await post(app, 'anth-conflict', changed);
    expect(second.statusCode).toBe(409);
    expect(second.body).toContain('idempotency_key_reused_with_different_request');
    expect(second.body).not.toContain('result-for-payload-A'); // no silent wrong replay
    expect(send.mock.calls.length).toBe(delta); // conflict also never executes
  });

  it('8. different API keys → independent scope; the same X-Request-Id executes per key', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ reply: 'scoped result' });
    const { app, state } = makeApp(store, { validKeys: ['key-A', 'key-B'] });
    state.driver = driver;
    const first = await post(app, 'anth-scope-key', BASE_BODY, { 'x-api-key': 'key-A' });
    expect(first.statusCode).toBe(200);
    const second = await post(app, 'anth-scope-key', BASE_BODY, { 'x-api-key': 'key-B' });
    expect(second.statusCode).toBe(200); // NOT a replay of key-A's result — fresh execution
    expect(send).toHaveBeenCalledTimes(2);
    expect(second.headers['x-emo-replay']).toBeUndefined();
  });

  it('9. different providers (models) → independent scope', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ reply: 'provider result' });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const first = await post(app, 'anth-scope-model', BASE_BODY);
    expect(first.statusCode).toBe(200);
    const second = await post(app, 'anth-scope-model', { ...BASE_BODY, model: 'claude-y' });
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body).model).toBe('claude-y');
    expect(second.headers['x-emo-replay']).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('10. tool calling: replay preserves the response verbatim (ids/binding) and NEVER re-runs the tools', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ reply: 'سأستدعي get_weather(city=القاهرة)' });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const toolBody = {
      ...BASE_BODY,
      tools: [{ name: 'get_weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }],
      tool_choice: { type: 'auto' },
    };
    const first = await post(app, 'anth-tools', toolBody);
    expect(first.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(entryState(store, 'anon', 'claude-x', 'anth-tools')).toBe('completed');
    }, { timeout: 5_000 });
    const delta = send.mock.calls.length;
    const replay = await post(app, 'anth-tools', toolBody);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['x-emo-replay']).toBe('true');
    // Verbatim: same id, same content blocks — tool ids/binding preserved by construction.
    expect(JSON.parse(replay.body)).toEqual(JSON.parse(first.body));
    expect(send.mock.calls.length).toBe(delta); // no tool/service re-execution on replay
  });

  it('11. send INITIATED then failure → unconfirmed; re-issue denied (no blind retry)', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ chunks: ['started'], throwAfterChunks: 'driver crashed after starting' });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const first = await post(app, 'anth-unconfirmed', BASE_BODY);
    expect(first.statusCode).toBe(500);
    await vi.waitFor(() => {
      expect(entryState(store, 'anon', 'claude-x', 'anth-unconfirmed')).toBe('unconfirmed');
    }, { timeout: 5_000 });
    const delta = send.mock.calls.length;
    const second = await post(app, 'anth-unconfirmed', BASE_BODY);
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).error.state).toBe('unconfirmed');
    expect(send.mock.calls.length).toBe(delta); // never blindly retried
  });

  it('12. oversize result (>256KB) → completed state-only → 409 "too large to replay"', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ reply: 'x'.repeat(300 * 1024) });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const first = await post(app, 'anth-oversize', BASE_BODY);
    expect(first.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(entryState(store, 'anon', 'claude-x', 'anth-oversize')).toBe('completed');
    }, { timeout: 5_000 });
    const delta = send.mock.calls.length;
    const second = await post(app, 'anth-oversize', BASE_BODY);
    expect(second.statusCode).toBe(409);
    expect(second.body).toContain('too large to replay');
    expect(send.mock.calls.length).toBe(delta);
  });

  it('13. restart persistence: a NEW app+broker over the SAME store replays the stored result', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ reply: 'durable result' });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const first = await post(app, 'anth-restart', BASE_BODY);
    expect(first.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(entryState(store, 'anon', 'claude-x', 'anth-restart')).toBe('completed');
    }, { timeout: 5_000 });
    const { send: send2, driver: driver2 } = mockDriver({ reply: 'MUST NOT RUN' });
    const { app: app2, state: state2 } = makeApp(store); // fresh process-like instance
    state2.driver = driver2;
    const second = await post(app2, 'anth-restart', BASE_BODY);
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-emo-replay']).toBe('true');
    expect(JSON.parse(second.body).content[0].text).toBe('durable result');
    expect(send2).not.toHaveBeenCalled(); // executed exactly once across "restarts"
  });
});
