/**
 * Task 12 — Gemini /v1beta × unified Request Broker (TDD: failing first).
 *
 * Proves through the REAL route (fastify registerGeminiRoutes + inject):
 *  1. new request with X-Request-Id → executes once, native body
 *     (candidates/content/parts/finishReason);
 *  2. duplicate while running → 409 denied, NO second execution;
 *  3. duplicate after completed → stored NATIVE replay (x-emo-replay), no re-exec;
 *  4. stream replay → native Gemini SSE (candidates/parts + final chunk), no re-exec;
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
 * The broker is the REAL RequestBroker over a throwaway temp store. No real
 * chats — the driver is a vi.fn mock.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fastify from 'fastify';
import type { ArenaDriver } from '../../src/types.js';
import { registerGeminiRoutes } from '../../src/server/gemini-routes.js';
import { RequestBroker, brokerKey } from '../../src/protocol/request-broker.js';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const makeStore = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'emo-gem-broker-'));
  dirs.push(d);
  return path.join(d, 'request-broker.json');
};

const BASE_BODY = {
  contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
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
  return { send, driver: { listModels: vi.fn().mockResolvedValue(['gemini-x:default']), sendMessage: send } as unknown as ArenaDriver };
};

const makeApp = (storePath: string, opts?: { validKeys?: string[] }) => {
  const state: { driver: ArenaDriver | null } = { driver: null };
  const app = fastify({ logger: false });
  registerGeminiRoutes(app, {
    getDriver: () => state.driver,
    requireApiKey: Boolean(opts?.validKeys?.length),
    getValidApiKeys: opts?.validKeys ? () => opts.validKeys! : undefined,
    broker: new RequestBroker(storePath),
  });
  return { app, state };
};

const post = (
  app: any,
  requestId: string,
  body: Record<string, unknown>,
  opts: { stream?: boolean; extraHeaders?: Record<string, string> } = {}
) =>
  app.inject({
    method: 'POST',
    url: `/v1beta/models/gemini-x:${opts.stream ? 'streamGenerateContent' : 'generateContent'}`,
    headers: { 'content-type': 'application/json', 'x-request-id': requestId, ...(opts.extraHeaders || {}) },
    payload: body,
  });

const entryState = (store: string, scope: string, model: string, rid: string) =>
  new RequestBroker(store).get(brokerKey(scope, `gemini:${model}`, rid))?.state;

describe('Gemini /v1beta × unified broker (Task 12)', () => {
  it('1. new request with X-Request-Id executes once; native body; result stored WITH nativeReplay', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ reply: 'رد جيميناي الأصلي' });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const first = await post(app, 'gem-new-1', BASE_BODY);
    expect(first.statusCode).toBe(200);
    const parsed = JSON.parse(first.body);
    expect(parsed.candidates[0].content.parts[0].text).toBe('رد جيميناي الأصلي');
    expect(parsed.candidates[0].finishReason).toBe('STOP');
    expect(send).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(entryState(store, 'anon', 'gemini-x', 'gem-new-1')).toBe('completed');
    }, { timeout: 5_000 });
    const entry = new RequestBroker(store).get(brokerKey('anon', 'gemini:gemini-x', 'gem-new-1'));
    const stored = entry?.result as any;
    expect(stored?.nativeReplay?.candidates?.[0]?.content?.parts?.[0]?.text).toBe('رد جيميناي الأصلي');
  });

  it('2. duplicate while RUNNING → 409 denied, no second execution', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ reply: 'slow', delayMs: 300 });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const first = post(app, 'gem-running-1', BASE_BODY);
    await new Promise((r) => setTimeout(r, 60));
    const dup = await post(app, 'gem-running-1', BASE_BODY);
    expect(dup.statusCode).toBe(409);
    const parsed = JSON.parse(dup.body);
    expect(parsed.error.state).toBe('running');
    expect(parsed.error.code).toBe(409);
    const finished = await first;
    expect(finished.statusCode).toBe(200);
    expect(send).toHaveBeenCalledTimes(1); // exactly ONE execution
  });

  it('3. duplicate after COMPLETED → native stored replay, never re-executed', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ reply: 'النتيجة المحفوظة' });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const first = await post(app, 'gem-replay-1', BASE_BODY);
    expect(first.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(entryState(store, 'anon', 'gemini-x', 'gem-replay-1')).toBe('completed');
    }, { timeout: 5_000 });
    const delta = send.mock.calls.length;
    const second = await post(app, 'gem-replay-1', BASE_BODY);
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-emo-replay']).toBe('true');
    expect(JSON.parse(second.body)).toEqual(JSON.parse(first.body)); // byte-equal native body
    expect(send.mock.calls.length).toBe(delta); // no re-execution
  });

  it('4. stream replay → NATIVE Gemini SSE (candidates/parts + final STOP chunk), no re-execution', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ chunks: ['قطعة ', 'أولى'], reply: 'قطعة أولى' });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const first = await post(app, 'gem-sse-replay', BASE_BODY, { stream: true });
    expect(first.statusCode).toBe(200);
    expect(first.body).toContain('data: ');
    expect(first.body).toContain('finishReason');
    await vi.waitFor(() => {
      expect(entryState(store, 'anon', 'gemini-x', 'gem-sse-replay')).toBe('completed');
    }, { timeout: 5_000 });
    const delta = send.mock.calls.length;
    const second = await post(app, 'gem-sse-replay', BASE_BODY, { stream: true });
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-emo-replay']).toBe('true');
    expect(second.body).toContain('قطعة');
    expect(second.body).toContain('أولى');
    expect(second.body).toContain('"finishReason":"STOP"');
    expect(second.body).toContain('usageMetadata');
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
      const res = await fetch(`http://127.0.0.1:${addr.port}/v1beta/models/gemini-x:streamGenerateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': 'gem-interrupt' },
        body: JSON.stringify(BASE_BODY),
        signal: ac.signal,
      });
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      await reader.read(); // first SSE bytes arrived → markSent already fired
      ac.abort(); // client disconnects mid-stream
      try { await reader.read(); } catch { /* aborted read is expected */ }
      await vi.waitFor(() => {
        expect(entryState(store, 'anon', 'gemini-x', 'gem-interrupt')).toBe('unconfirmed');
      }, { timeout: 5_000 });
    } finally {
      await app.close();
    }
    const { send: send2, driver: driver2 } = mockDriver({ reply: 'should not run' });
    const { app: app2, state: state2 } = makeApp(store);
    state2.driver = driver2;
    const second = await post(app2, 'gem-interrupt', BASE_BODY, { stream: true });
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).error.state).toBe('unconfirmed');
    expect(send2).not.toHaveBeenCalled();
  });

  it('6. failure BEFORE the send (no driver) → claim released → re-issue executes', async () => {
    const store = makeStore();
    const { app, state } = makeApp(store);
    state.driver = null; // pre-send failure: nothing was sent
    const first = await post(app, 'gem-presend', BASE_BODY);
    expect(first.statusCode).toBe(500);
    const afterFail = entryState(store, 'anon', 'gemini-x', 'gem-presend');
    expect(afterFail === null || afterFail === 'failed').toBe(true); // claim released
    const { send, driver } = mockDriver({ reply: 'succeeded on retry' });
    state.driver = driver;
    const second = await post(app, 'gem-presend', BASE_BODY);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body).candidates[0].content.parts[0].text).toBe('succeeded on retry');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('7. same X-Request-Id + DIFFERENT payload → explicit 409 CONFLICT, never a silent replay', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ reply: 'result-for-payload-A' });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const first = await post(app, 'gem-conflict', BASE_BODY);
    expect(first.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(entryState(store, 'anon', 'gemini-x', 'gem-conflict')).toBe('completed');
    }, { timeout: 5_000 });
    const delta = send.mock.calls.length;
    const changed = {
      contents: [{ role: 'user', parts: [{ text: 'a DIFFERENT request' }] }],
      generationConfig: { temperature: 0.1 },
    };
    const second = await post(app, 'gem-conflict', changed);
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
    const first = await post(app, 'gem-scope-key', BASE_BODY, { extraHeaders: { 'x-goog-api-key': 'key-A' } });
    expect(first.statusCode).toBe(200);
    const second = await post(app, 'gem-scope-key', BASE_BODY, { extraHeaders: { 'x-goog-api-key': 'key-B' } });
    expect(second.statusCode).toBe(200); // NOT a replay of key-A's result — fresh execution
    expect(send).toHaveBeenCalledTimes(2);
    expect(second.headers['x-emo-replay']).toBeUndefined();
  });

  it('9. different providers (models) → independent scope', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ reply: 'provider result' });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const first = await post(app, 'gem-scope-model', BASE_BODY);
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: '/v1beta/models/gemini-y:generateContent',
      headers: { 'content-type': 'application/json', 'x-request-id': 'gem-scope-model' },
      payload: BASE_BODY,
    });
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-emo-replay']).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('10. tool calling: replay preserves the response verbatim (binding) and NEVER re-runs the tools', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ reply: 'سأستدعي get_weather(city=القاهرة)' });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const toolBody = {
      ...BASE_BODY,
      tools: [{ functionDeclarations: [{ name: 'get_weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }] }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    };
    const first = await post(app, 'gem-tools', toolBody);
    expect(first.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(entryState(store, 'anon', 'gemini-x', 'gem-tools')).toBe('completed');
    }, { timeout: 5_000 });
    const delta = send.mock.calls.length;
    const replay = await post(app, 'gem-tools', toolBody);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['x-emo-replay']).toBe('true');
    // Verbatim native body — function-call binding preserved by construction.
    expect(JSON.parse(replay.body)).toEqual(JSON.parse(first.body));
    expect(send.mock.calls.length).toBe(delta); // no tool/service re-execution on replay
  });

  it('11. send INITIATED then failure → unconfirmed; re-issue denied (no blind retry)', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ chunks: ['started'], throwAfterChunks: 'driver crashed after starting' });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const first = await post(app, 'gem-unconfirmed', BASE_BODY);
    expect(first.statusCode).toBe(500);
    await vi.waitFor(() => {
      expect(entryState(store, 'anon', 'gemini-x', 'gem-unconfirmed')).toBe('unconfirmed');
    }, { timeout: 5_000 });
    const delta = send.mock.calls.length;
    const second = await post(app, 'gem-unconfirmed', BASE_BODY);
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).error.state).toBe('unconfirmed');
    expect(send.mock.calls.length).toBe(delta); // never blindly retried
  });

  it('12. oversize result (>256KB) → completed state-only → 409 "too large to replay"', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ reply: 'x'.repeat(300 * 1024) });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const first = await post(app, 'gem-oversize', BASE_BODY);
    expect(first.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(entryState(store, 'anon', 'gemini-x', 'gem-oversize')).toBe('completed');
    }, { timeout: 5_000 });
    const delta = send.mock.calls.length;
    const second = await post(app, 'gem-oversize', BASE_BODY);
    expect(second.statusCode).toBe(409);
    expect(second.body).toContain('too large to replay');
    expect(send.mock.calls.length).toBe(delta);
  });

  it('13. restart persistence: a NEW app+broker over the SAME store replays the stored result', async () => {
    const store = makeStore();
    const { send, driver } = mockDriver({ reply: 'durable result' });
    const { app, state } = makeApp(store);
    state.driver = driver;
    const first = await post(app, 'gem-restart', BASE_BODY);
    expect(first.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(entryState(store, 'anon', 'gemini-x', 'gem-restart')).toBe('completed');
    }, { timeout: 5_000 });
    const { send: send2, driver: driver2 } = mockDriver({ reply: 'MUST NOT RUN' });
    const { app: app2, state: state2 } = makeApp(store); // fresh process-like instance
    state2.driver = driver2;
    const second = await post(app2, 'gem-restart', BASE_BODY);
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-emo-replay']).toBe('true');
    expect(JSON.parse(second.body).candidates[0].content.parts[0].text).toBe('durable result');
    expect(send2).not.toHaveBeenCalled(); // executed exactly once across "restarts"
  });
});
