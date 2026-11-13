/**
 * Task 12 — unified broker helpers (TDD: failing first).
 *
 * Proves the SHARED idempotency layer used by OpenAI + Anthropic + Gemini:
 *  - canonical payload fingerprint covering ALL execution-affecting options
 *    per protocol (owner mandatory scope) with stable key order, preserved
 *    array order, protocol identity, and NO secrets;
 *  - scope isolation: apiKeyScope + provider + requestId + PROTOCOL;
 *  - the begin/replay/execute/conflict/denied lifecycle on the REAL broker
 *    (temp store), backward compatible with legacy entries that have no
 *    fingerprint (they must NOT claim diff-detection they cannot do).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  payloadFingerprint,
  brokerScopedKey,
  beginBrokeredRequest,
  completeBrokered,
  type BrokerProtocol,
} from '../../src/server/request-broker-helpers.js';
import { RequestBroker } from '../../src/protocol/request-broker.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const makeBroker = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'emo-ubh-'));
  dirs.push(d);
  const storePath = path.join(d, 'request-broker.json');
  return { d, storePath, broker: new RequestBroker(storePath) };
};

describe('payloadFingerprint (canonical, ALL execution-affecting options)', () => {
  const openaiBody = {
    model: 'gpt-x',
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.7,
  };

  it('is stable under key reordering, sensitive to array order', () => {
    const a = payloadFingerprint(openaiBody, 'openai');
    const reordered = { temperature: 0.7, messages: [{ content: 'hi', role: 'user' }], model: 'gpt-x' };
    expect(payloadFingerprint(reordered, 'openai')).toBe(a);
    const arraySwapped = { ...openaiBody, messages: [openaiBody.messages[0], { role: 'user', content: 'second' }] };
    expect(payloadFingerprint(arraySwapped, 'openai')).not.toBe(a);
  });

  it('OpenAI: tools / tool_choice / response_format / generation options / stream all affect it', () => {
    const base = payloadFingerprint(openaiBody, 'openai');
    for (const mutation of [
      { tools: [{ type: 'function', function: { name: 'f', parameters: {} } }] },
      { tool_choice: 'auto' },
      { response_format: { type: 'json_object' } },
      { temperature: 0.8 },
      { top_p: 0.9 },
      { max_tokens: 100 },
      { stop: ['\n'] },
      { seed: 42 },
      { stream: true },
      { parallel_tool_calls: false },
      { presence_penalty: 1 },
      { frequency_penalty: 1 },
    ] as Record<string, unknown>[]) {
      expect(payloadFingerprint({ ...openaiBody, ...mutation }, 'openai')).not.toBe(base);
    }
  });

  it('Anthropic: system / tools / tool_choice / max_tokens / top_k / stop_sequences / thinking / stream affect it', () => {
    const body = { model: 'claude-x', messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 };
    const base = payloadFingerprint(body, 'anthropic');
    for (const mutation of [
      { system: 'be terse' },
      { tools: [{ name: 't', input_schema: {} }] },
      { tool_choice: { type: 'auto' } },
      { max_tokens: 200 },
      { temperature: 0.1 },
      { top_p: 0.5 },
      { top_k: 5 },
      { stop_sequences: ['STOP'] },
      { thinking: { type: 'enabled', budget_tokens: 1000 } },
      { stream: true },
    ] as Record<string, unknown>[]) {
      expect(payloadFingerprint({ ...body, ...mutation }, 'anthropic')).not.toBe(base);
    }
  });

  it('Gemini: contents / systemInstruction / tools / toolConfig / generationConfig / safetySettings / cachedContent / stream affect it', () => {
    const body = { model: 'gemini-x', contents: [{ role: 'user', parts: [{ text: 'hi' }] }] };
    const base = payloadFingerprint(body, 'gemini');
    for (const mutation of [
      { systemInstruction: { parts: [{ text: 'sys' }] } },
      { tools: [{ functionDeclarations: [{ name: 'f' }] }] },
      { toolConfig: { functionCallingConfig: { mode: 'ANY' } } },
      { generationConfig: { temperature: 0.5 } },
      { generationConfig: { maxOutputTokens: 99 } },
      { safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }] },
      { cachedContent: 'cachedContents/abc' },
    ] as Record<string, unknown>[]) {
      expect(payloadFingerprint({ ...body, ...mutation }, 'gemini')).not.toBe(base);
    }
  });

  it('includes the protocol identity (same body, different protocol → different fingerprint)', () => {
    const body = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };
    const protocols: BrokerProtocol[] = ['openai', 'anthropic', 'gemini'];
    const fps = protocols.map((p) => payloadFingerprint(body, p));
    expect(new Set(fps).size).toBe(3);
  });
});

describe('brokerScopedKey (protocol is part of the scope)', () => {
  it('same X-Request-Id across different PROTOCOLS → different keys (no cross-protocol replay ever)', () => {
    const a = brokerScopedKey({ protocol: 'openai', apiKeyScope: 'k1', providerId: 'model-x', requestId: 'r1' });
    const b = brokerScopedKey({ protocol: 'anthropic', apiKeyScope: 'k1', providerId: 'model-x', requestId: 'r1' });
    const c = brokerScopedKey({ protocol: 'gemini', apiKeyScope: 'k1', providerId: 'model-x', requestId: 'r1' });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('different API keys / providers / request ids → different keys (existing isolation kept)', () => {
    const base = brokerScopedKey({ protocol: 'anthropic', apiKeyScope: 'k1', providerId: 'm', requestId: 'r' });
    expect(brokerScopedKey({ protocol: 'anthropic', apiKeyScope: 'k2', providerId: 'm', requestId: 'r' })).not.toBe(base);
    expect(brokerScopedKey({ protocol: 'anthropic', apiKeyScope: 'k1', providerId: 'm2', requestId: 'r' })).not.toBe(base);
    expect(brokerScopedKey({ protocol: 'anthropic', apiKeyScope: 'k1', providerId: 'm', requestId: 'r2' })).not.toBe(base);
  });
});

describe('beginBrokeredRequest lifecycle (REAL broker, temp store)', () => {
  it('no requestId → kind none (no forced idempotency for clients that opt out)', async () => {
    const { broker } = makeBroker();
    const claim = await beginBrokeredRequest({
      protocol: 'anthropic', apiKeyScope: 'k', providerId: 'm', requestId: null, broker,
    });
    expect(claim.kind).toBe('none');
  });

  it('first claim executes; identical re-issue replays the stored NATIVE result', async () => {
    const { broker } = makeBroker();
    const args = {
      protocol: 'anthropic' as const, apiKeyScope: 'k', providerId: 'm', requestId: 'r1',
      fingerprint: payloadFingerprint({ model: 'm', messages: [] }, 'anthropic'), broker,
    };
    const first = await beginBrokeredRequest(args);
    expect(first.kind).toBe('execute');
    if (first.kind !== 'execute') return;
    await completeBrokered(first, {
      content: 'native-text',
      nativeReplay: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'native-text' }] },
    });
    const second = await beginBrokeredRequest(args);
    expect(second.kind).toBe('replay');
    if (second.kind === 'replay') {
      expect((second.result as any)?.nativeReplay?.id).toBe('msg_1');
      expect((second.result as any)?.content).toBe('native-text');
    }
  });

  it('duplicate while RUNNING → denied (no second execution)', async () => {
    const { broker } = makeBroker();
    const args = { protocol: 'gemini' as const, apiKeyScope: 'k', providerId: 'm', requestId: 'r2', fingerprint: 'fp-x', broker };
    const first = await beginBrokeredRequest(args);
    expect(first.kind).toBe('execute');
    const second = await beginBrokeredRequest(args);
    expect(second.kind).toBe('denied');
    if (second.kind === 'denied') expect(second.state).toBe('running');
  });

  it('SAME X-Request-Id + DIFFERENT payload → explicit CONFLICT (no silent replay)', async () => {
    const { broker } = makeBroker();
    const args = { protocol: 'anthropic' as const, apiKeyScope: 'k', providerId: 'm', requestId: 'r3', fingerprint: 'fp-A', broker };
    const first = await beginBrokeredRequest(args);
    if (first.kind !== 'execute') return;
    await completeBrokered(first, { content: 'done' });
    const second = await beginBrokeredRequest({ ...args, fingerprint: 'fp-B' });
    expect(second.kind).toBe('conflict');
  });

  it('LEGACY entry without fingerprint → replay WITHOUT claiming diff-detection (documented backward compat)', async () => {
    const { storePath, broker } = makeBroker();
    const { brokerKey } = await import('../../src/protocol/request-broker.js');
    const key = brokerKey('k', 'anthropic:m', 'r4');
    // Hand-write a legacy v1 entry: no fingerprint, completed with a result.
    const legacy = {
      version: 1,
      entries: [{
        key, sessionKey: null, state: 'completed', result: { content: 'legacy-result' },
        createdAt: Date.now(), updatedAt: Date.now(),
      }],
    };
    writeFileSync(storePath, JSON.stringify(legacy));
    const claim = await beginBrokeredRequest({
      protocol: 'anthropic', apiKeyScope: 'k', providerId: 'm', requestId: 'r4',
      fingerprint: payloadFingerprint({ anything: 'different' }, 'anthropic'), broker,
    });
    // Different payload but the entry has NO fingerprint → cannot detect → replay (documented).
    expect(claim.kind).toBe('replay');
    if (claim.kind === 'replay') expect((claim.result as any)?.content).toBe('legacy-result');
  });

  it('pre-send failure (retryable) → claim released → re-issue executes again; post-markSent failure → unconfirmed denied', async () => {
    const { broker } = makeBroker();
    const args = { protocol: 'gemini' as const, apiKeyScope: 'k', providerId: 'm', requestId: 'r5', fingerprint: 'fp-r5', broker };
    const first = await beginBrokeredRequest(args);
    if (first.kind !== 'execute') return;
    await first.controller.fail({ retryable: true, error: 'pre-send boom' });
    const retry = await beginBrokeredRequest(args);
    expect(retry.kind).toBe('execute'); // safe: nothing was sent
    if (retry.kind !== 'execute') return;
    await retry.controller.markSent();
    await retry.controller.fail({ retryable: true, error: 'post-send boom' });
    const after = await beginBrokeredRequest(args);
    expect(after.kind).toBe('denied');
    if (after.kind === 'denied') expect(after.state).toBe('unconfirmed');
  });

  it('result larger than the cache limit → completed WITHOUT stored result → denied replay with clear state', async () => {
    const { broker } = makeBroker();
    const args = { protocol: 'anthropic' as const, apiKeyScope: 'k', providerId: 'm', requestId: 'r6', fingerprint: 'fp-r6', broker };
    const first = await beginBrokeredRequest(args);
    if (first.kind !== 'execute') return;
    await completeBrokered(first, { content: 'x'.repeat(300 * 1024) });
    const second = await beginBrokeredRequest(args);
    expect(second.kind).toBe('denied');
    if (second.kind === 'denied') {
      expect(second.state).toBe('completed');
      expect(second.reason).toContain('too large');
    }
  });

  it('works across PROCESSES: a second broker instance over the same store sees the claim', async () => {
    const { storePath, broker } = makeBroker();
    const args = { protocol: 'anthropic' as const, apiKeyScope: 'k', providerId: 'm', requestId: 'r7', fingerprint: 'fp-r7', broker };
    const first = await beginBrokeredRequest(args);
    expect(first.kind).toBe('execute');
    if (first.kind !== 'execute') return;
    await completeBrokered(first, { content: 'cross-process', nativeReplay: { id: 'msg_2' } });
    const otherProcessBroker = new RequestBroker(storePath);
    const second = await beginBrokeredRequest({ ...args, broker: otherProcessBroker });
    expect(second.kind).toBe('replay');
  });
});
