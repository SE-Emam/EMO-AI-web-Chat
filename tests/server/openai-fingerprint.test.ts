/**
 * Task 12.1 — X-Request-Id semantics UNIFIED on the OpenAI path (owner
 * priority: the same idempotency meaning across ALL THREE EMO interfaces).
 *
 * Proves through the REAL /v1/chat/completions route (createServer + inject,
 * REAL RequestBroker redirected to a temp store):
 *  1. same X-Request-Id + DIFFERENT payload → explicit 409 CONFLICT with the
 *     SAME reason token as Anthropic/Gemini — no silent replay of a
 *     non-matching stored result, no second execution;
 *  2. new entries persist the fingerprint (diff-detection is real, not
 *     claimed vacuously);
 *  3. legacy entries WITHOUT a fingerprint are still replayed (documented
 *     backward compat — they never claim diff-detection);
 *  4. completed replay keeps working WITH a stored fingerprint (no
 *     regression of the Task 9 replay semantics).
 *
 * No real chats — the driver is a vi.fn mock.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ArenaDriver } from '../../src/types.js';
import { DEFAULT_CONFIG } from '../../src/config.js';

const g = globalThis as any;
g.__emoOaiFpDirs = g.__emoOaiFpDirs || [];

// Real RequestBroker semantics, redirected to a throwaway store.
vi.mock('../../src/protocol/request-broker.js', async (importOriginal) => {
  const actual: typeof import('../../src/protocol/request-broker.js') = await importOriginal();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emo-oai-fp-'));
  const gg = globalThis as any;
  gg.__emoOaiFpDirs = gg.__emoOaiFpDirs || [];
  gg.__emoOaiFpDirs.push(dir);
  class RedirectedRequestBroker extends actual.RequestBroker {
    constructor(storePath?: string, lock?: any) {
      super(storePath ?? path.join(dir, 'request-broker.json'), lock);
    }
  }
  return { ...actual, RequestBroker: RedirectedRequestBroker };
});

import { RequestBroker, brokerKey } from '../../src/protocol/request-broker.js';

// Dynamic import AFTER the vi.mock hoisting so the redirected broker is in
// place before app.js loads.
const { createServer } = await import('../../src/server/app.js');

const dir = g.__emoOaiFpDirs[0];
const storePath = path.join(dir, 'request-broker.json');

afterAll(() => {
  for (const d of g.__emoOaiFpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const sendMock = vi.fn(async () => 'النتيجة الأصلية');
const driver: ArenaDriver = {
  listModels: vi.fn().mockResolvedValue(['gpt-test:default']),
  sendMessage: sendMock,
} as unknown as ArenaDriver;

const BODY_A = {
  model: 'gpt-test',
  stream: false,
  messages: [{ role: 'user', content: 'طلب أ' }],
};
const BODY_B = {
  model: 'gpt-test',
  stream: false,
  temperature: 0.2,
  messages: [{ role: 'user', content: 'طلب مختلف تمامًا' }],
};

const post = (app: any, requestId: string, body: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
    payload: body,
  });

const entryFor = (rid: string) =>
  new RequestBroker(storePath).get(brokerKey('anon', 'gpt-test', rid));

describe('OpenAI path × unified fingerprint semantics (Task 12.1)', () => {
  it('same X-Request-Id + DIFFERENT payload → explicit 409 CONFLICT with the unified token; never a silent replay', async () => {
    const app = createServer(driver, { ...DEFAULT_CONFIG });
    const first = await post(app, 'oai-conflict-1', BODY_A);
    expect(first.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(entryFor('oai-conflict-1')?.state).toBe('completed');
    }, { timeout: 5_000 });
    const delta = sendMock.mock.calls.length;

    const second = await post(app, 'oai-conflict-1', BODY_B);
    expect(second.statusCode).toBe(409);
    // The SAME explicit reason token the Anthropic/Gemini paths return.
    expect(second.body).toContain('idempotency_key_reused_with_different_request');
    // No silent replay of a non-matching stored result.
    expect(second.body).not.toContain('النتيجة الأصلية');
    expect(sendMock.mock.calls.length).toBe(delta); // conflict never executes either
  });

  it('new OpenAI entries persist the fingerprint (diff-detection is real)', async () => {
    const app = createServer(driver, { ...DEFAULT_CONFIG });
    const res = await post(app, 'oai-fp-persist', BODY_A);
    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(entryFor('oai-fp-persist')?.state).toBe('completed');
    }, { timeout: 5_000 });
    const entry = entryFor('oai-fp-persist') as { fingerprint?: string };
    expect(typeof entry.fingerprint).toBe('string');
    expect(entry.fingerprint!.length).toBe(64); // sha256 hex
  });

  it('legacy entry WITHOUT fingerprint → still replayed (no diff-detection claimed)', async () => {
    // Hand-write a legacy v1 entry with the OpenAI legacy key shape.
    const legacy = {
      version: 1,
      entries: [
        {
          key: brokerKey('anon', 'gpt-test', 'oai-legacy-1'),
          sessionKey: null,
          state: 'completed',
          result: { id: 'chatcmpl-legacy', model: 'gpt-test', content: 'legacy-openai-result' },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    };
    fs.writeFileSync(storePath, JSON.stringify(legacy));
    const app = createServer(driver, { ...DEFAULT_CONFIG });
    const delta = sendMock.mock.calls.length;
    const res = await post(app, 'oai-legacy-1', BODY_B); // DIFFERENT payload — legacy cannot detect
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-emo-replay']).toBe('true');
    expect(JSON.parse(res.body).choices?.[0]?.message?.content ?? res.body).toContain('legacy-openai-result');
    expect(sendMock.mock.calls.length).toBe(delta);
  });

  it('completed replay with a STORED fingerprint keeps working (Task 9 semantics preserved)', async () => {
    const app = createServer(driver, { ...DEFAULT_CONFIG });
    const first = await post(app, 'oai-replay-fp', BODY_A);
    expect(first.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(entryFor('oai-replay-fp')?.state).toBe('completed');
    }, { timeout: 5_000 });
    const delta = sendMock.mock.calls.length;
    const second = await post(app, 'oai-replay-fp', BODY_A); // IDENTICAL payload
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-emo-replay']).toBe('true');
    // Byte-equal native body EXCEPT `created` (epoch seconds recorded at
    // store time vs response time — pre-existing Task 9 behavior, can differ
    // by 1s across a wall-clock boundary).
    const { created: _c1, ...firstBody } = JSON.parse(first.body);
    const { created: _c2, ...secondBody } = JSON.parse(second.body);
    expect(secondBody).toEqual(firstBody);
    expect(sendMock.mock.calls.length).toBe(delta);
  });
});
