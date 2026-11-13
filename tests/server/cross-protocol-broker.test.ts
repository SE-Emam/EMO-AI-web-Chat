/**
 * Task 12 — cross-protocol broker semantics (shared layer, separate adapters).
 *
 * Proves:
 *  - the SAME X-Request-Id value across DIFFERENT protocols (Anthropic and
 *    Gemini, over the SAME broker store) yields INDEPENDENT claims — each
 *    protocol executes its own request; a body is never replayed across
 *    protocols (protocol is part of the broker key: '<protocol>:<provider>');
 *  - a legacy store entry WITHOUT a fingerprint is served by the
 *    pre-existing state semantics (replay) and must NOT claim
 *    diff-detection it cannot do — documented backward compat;
 *  - a legacy entry of ONE protocol is invisible to another protocol.
 *
 * Both routes are exercised through their REAL handlers with the REAL
 * RequestBroker over one throwaway temp store. No real chats.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fastify from 'fastify';
import type { ArenaDriver } from '../../src/types.js';
import { registerAnthropicRoutes } from '../../src/server/anthropic-routes.js';
import { registerGeminiRoutes } from '../../src/server/gemini-routes.js';
import { RequestBroker, brokerKey } from '../../src/protocol/request-broker.js';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const makeStore = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'emo-xproto-broker-'));
  dirs.push(d);
  return path.join(d, 'request-broker.json');
};

const makeApps = (storePath: string) => {
  const anthropicDriver = {
    listModels: vi.fn(),
    sendMessage: vi.fn(async () => 'ANTHROPIC-الأصلية'),
  } as unknown as ArenaDriver;
  const geminiDriver = {
    listModels: vi.fn(),
    sendMessage: vi.fn(async () => 'GEMINI-الأصلية'),
  } as unknown as ArenaDriver;
  const app = fastify({ logger: false });
  registerAnthropicRoutes(app, { getDriver: () => anthropicDriver, requireApiKey: false, broker: new RequestBroker(storePath) });
  registerGeminiRoutes(app, { getDriver: () => geminiDriver, requireApiKey: false, broker: new RequestBroker(storePath) });
  return { app, anthropicDriver, geminiDriver };
};

describe('cross-protocol broker semantics (Task 12)', () => {
  it('same X-Request-Id across Anthropic and Gemini → independent claims; bodies never cross', async () => {
    const store = makeStore();
    const { app, anthropicDriver, geminiDriver } = makeApps(store);
    const headers = { 'content-type': 'application/json', 'x-request-id': 'same-rid' };

    // Same rid to BOTH protocols.
    const anth = await app.inject({
      method: 'POST', url: '/v1/messages', headers,
      payload: { model: 'claude-x', max_tokens: 50, messages: [{ role: 'user', content: 'hi' }] },
    });
    const gem = await app.inject({
      method: 'POST', url: '/v1beta/models/gemini-x:generateContent', headers,
      payload: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
    });
    expect(anth.statusCode).toBe(200);
    expect(gem.statusCode).toBe(200);

    // EACH protocol executed exactly once — neither consumed the other's claim.
    expect(anthropicDriver.sendMessage).toHaveBeenCalledTimes(1);
    expect(geminiDriver.sendMessage).toHaveBeenCalledTimes(1);

    // Bodies are protocol-native, never crossed.
    const anthBody = JSON.parse(anth.body);
    const gemBody = JSON.parse(gem.body);
    expect(anthBody.type).toBe('message');
    expect(anthBody.content[0].text).toBe('ANTHROPIC-الأصلية');
    expect(gemBody.candidates[0].content.parts[0].text).toBe('GEMINI-الأصلية');

    // complete() is recorded asynchronously (same pattern as the OpenAI
    // path) — wait for BOTH protocol entries to land before re-issuing.
    await vi.waitFor(() => {
      expect(new RequestBroker(store).get(brokerKey('anon', 'anthropic:claude-x', 'same-rid'))?.state).toBe('completed');
      expect(new RequestBroker(store).get(brokerKey('anon', 'gemini:gemini-x', 'same-rid'))?.state).toBe('completed');
    }, { timeout: 5_000 });

    // Re-issue to each protocol → its OWN native replay, still no cross-over.
    const anthReplay = await app.inject({
      method: 'POST', url: '/v1/messages', headers,
      payload: { model: 'claude-x', max_tokens: 50, messages: [{ role: 'user', content: 'hi' }] },
    });
    const gemReplay = await app.inject({
      method: 'POST', url: '/v1beta/models/gemini-x:generateContent', headers,
      payload: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
    });
    expect(anthReplay.headers['x-emo-replay']).toBe('true');
    expect(JSON.parse(anthReplay.body).content[0].text).toBe('ANTHROPIC-الأصلية');
    expect(gemReplay.headers['x-emo-replay']).toBe('true');
    expect(JSON.parse(gemReplay.body).candidates[0].content.parts[0].text).toBe('GEMINI-الأصلية');
    // Still exactly one execution per protocol.
    expect(anthropicDriver.sendMessage).toHaveBeenCalledTimes(1);
    expect(geminiDriver.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('same store: the two protocols keep separate keys for the same rid', async () => {
    const store = makeStore();
    const broker = new RequestBroker(store);
    const { beginBrokeredRequest, completeBrokered } = await import('../../src/server/request-broker-helpers.js');
    const ca = await beginBrokeredRequest({ protocol: 'anthropic', apiKeyScope: 'anon', providerId: 'claude-x', requestId: 'same-rid', fingerprint: 'fp-anth', broker });
    expect(ca.kind).toBe('execute');
    if (ca.kind === 'execute') await completeBrokered(ca, { content: 'anth' });
    const cg = await beginBrokeredRequest({ protocol: 'gemini', apiKeyScope: 'anon', providerId: 'gemini-x', requestId: 'same-rid', fingerprint: 'fp-gem', broker });
    expect(cg.kind).toBe('execute'); // NOT blocked by the anthropic claim
    if (cg.kind === 'execute') await completeBrokered(cg, { content: 'gem' });
    // Both entries exist side by side in ONE store file.
    const a = new RequestBroker(store).get(brokerKey('anon', 'anthropic:claude-x', 'same-rid'));
    const g = new RequestBroker(store).get(brokerKey('anon', 'gemini:gemini-x', 'same-rid'));
    expect(a?.state).toBe('completed');
    expect(g?.state).toBe('completed');
    // And the OpenAI legacy key shape (brokerKey(scope, model, rid), no
    // protocol prefix) never collides with either — by construction.
    expect(brokerKey('anon', 'claude-x', 'same-rid')).not.toBe(brokerKey('anon', 'anthropic:claude-x', 'same-rid'));
  });

  it('legacy entry WITHOUT fingerprint → replay WITHOUT diff-detection; invisible to other protocols', async () => {
    const store = makeStore();
    const { app, anthropicDriver, geminiDriver } = makeApps(store);
    // Hand-write a legacy v1 entry: no fingerprint, completed with a result.
    const key = brokerKey('anon', 'anthropic:claude-old', 'legacy-rid');
    const legacy = {
      version: 1,
      entries: [
        {
          key,
          sessionKey: null,
          state: 'completed',
          result: { content: 'legacy-stored-text' },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    };
    fs.writeFileSync(store, JSON.stringify(legacy));

    // Anthropic re-issue with a DIFFERENT payload → the entry has NO stored
    // fingerprint, so diff-detection is impossible: served as replay
    // (documented backward compat — NEVER claim a conflict it cannot prove).
    const anth = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json', 'x-request-id': 'legacy-rid' },
      payload: { model: 'claude-old', max_tokens: 50, messages: [{ role: 'user', content: 'totally different payload' }] },
    });
    expect(anth.statusCode).toBe(200);
    expect(anth.headers['x-emo-replay']).toBe('true');
    expect(JSON.parse(anth.body).content[0].text).toBe('legacy-stored-text');
    expect(anthropicDriver.sendMessage).not.toHaveBeenCalled();

    // Gemini with the same rid → protocol-scoped key → legacy anthropic
    // entry is INVISIBLE; gemini executes its own request normally.
    const gem = await app.inject({
      method: 'POST', url: '/v1beta/models/gemini-old:generateContent',
      headers: { 'content-type': 'application/json', 'x-request-id': 'legacy-rid' },
      payload: { contents: [{ role: 'user', parts: [{ text: 'gemini asks' }] }] },
    });
    expect(gem.statusCode).toBe(200);
    expect(gem.headers['x-emo-replay']).toBeUndefined();
    expect(geminiDriver.sendMessage).toHaveBeenCalledTimes(1);
    expect(JSON.parse(gem.body).candidates[0].content.parts[0].text).toBe('GEMINI-الأصلية');
  });
});
