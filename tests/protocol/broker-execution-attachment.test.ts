/**
 * Task 11 step 4 — atomic one-time execution attachment on the SHARED broker
 * store (TDD: failing first).
 *
 * Owner mandatory mod #1 (binding): attachForExecution is an atomic,
 * first-wins reservation under ProcessLock. A duplicate IPC command must
 * NEVER start a second execution. Every later state update is guarded by the
 * executor identity + execution token. All decisions are read from the
 * durable store — never from an in-memory map in any single process.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RequestBroker, brokerKey } from '../../src/protocol/request-broker.js';
import { ProcessLock } from '../../src/sessions/process-lock.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const makeBroker = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'emo-broker-att-'));
  dirs.push(d);
  const storePath = path.join(d, 'request-broker.json');
  return { d, storePath, broker: new RequestBroker(storePath, new ProcessLock({ lockDir: path.join(d, 'locks') })) };
};

const executorA = { executorInstanceId: 'inst-A', executorEpoch: 'epoch-A1', executorPid: process.pid, forwardId: 'fwd-A1' };
const executorB = { executorInstanceId: 'inst-B', executorEpoch: 'epoch-B1', executorPid: process.pid, forwardId: 'fwd-B1' };

describe('attachForExecution (atomic one-time reservation)', () => {
  it('first attach after begin succeeds and persists the ExecutionAttachment', async () => {
    const { d, storePath, broker } = makeBroker();
    const key = brokerKey('scope', 'chatgpt-web', 'req-1');
    const begin = await broker.begin(key, 'sess-1');
    expect(begin.allowed).toBe(true);
    const r = await broker.attachForExecution(key, executorA);
    expect(r.attached).toBe(true);
    if (r.attached) {
      expect(r.attachment.executorInstanceId).toBe('inst-A');
      expect(r.attachment.executorEpoch).toBe('epoch-A1');
      expect(r.attachment.forwardId).toBe('fwd-A1');
      expect(r.attachment.sentAt).toBeNull();
      expect(r.attachment.executionToken).toBeDefined();
    }
    // Durable: a SECOND broker instance over the same store sees the attachment.
    const other = new RequestBroker(storePath, new ProcessLock({ lockDir: path.join(path.dirname(storePath), 'locks2') }));
    const raw = JSON.parse(readFileSync(storePath, 'utf8'));
    expect(raw.entries[0].attachment.executorInstanceId).toBe('inst-A');
    void d;
  });

  it('TWO CONCURRENT attaches → exactly ONE wins, the other is refused with already_attached (no second execution)', async () => {
    const { broker } = makeBroker();
    const key = brokerKey('scope', 'chatgpt-web', 'req-2');
    await broker.begin(key, 'sess-1');
    const [a, b] = await Promise.all([
      broker.attachForExecution(key, executorA),
      broker.attachForExecution(key, executorB),
    ]);
    const winners = [a, b].filter((r) => r.attached);
    expect(winners.length).toBe(1);
    const loser = [a, b].find((r) => !r.attached)!;
    expect(loser.reason).toBe('already_attached');
  });

  it('RE-sending the same forwardId from the same executor → idempotent re-acknowledgement, SAME token, no second reservation', async () => {
    const { broker } = makeBroker();
    const key = brokerKey('scope', 'chatgpt-web', 'req-3');
    await broker.begin(key);
    const first = await broker.attachForExecution(key, executorA);
    const again = await broker.attachForExecution(key, { ...executorA, executorPid: process.pid });
    expect(again.attached).toBe(true);
    expect((first as any).attachment.executionToken).toBe((again as any).attachment.executionToken);
    // A DIFFERENT forwardId from the same instance is a NEW command → refused.
    const newCmd = await broker.attachForExecution(key, { ...executorA, forwardId: 'fwd-A2' });
    expect(newCmd.attached).toBe(false);
    expect(newCmd.reason).toBe('already_attached');
  });

  it('attach refuses on a missing key and on a non-running state', async () => {
    const { broker } = makeBroker();
    const missing = await broker.attachForExecution(brokerKey('s', 'p', 'nope'), executorA);
    expect(missing.attached).toBe(false);
    expect(missing.reason).toBe('not_found');
    const key = brokerKey('scope', 'chatgpt-web', 'req-4');
    await broker.begin(key);
    const ctl = await broker.attachForExecution(key, executorA);
    if (ctl.attached) {
      await ctl.controller.complete(
        { ok: 1 },
        { executorInstanceId: executorA.executorInstanceId, executionToken: ctl.attachment.executionToken }
      );
    }
    const afterDone = await broker.attachForExecution(key, executorB);
    expect(afterDone.attached).toBe(false);
    expect(afterDone.reason).toBe('not_running');
  });

  it('attachment controller refuses state updates with a WRONG identity/token (documented, logged, no-op)', async () => {
    const { broker } = makeBroker();
    const key = brokerKey('scope', 'chatgpt-web', 'req-5');
    await broker.begin(key);
    const r = await broker.attachForExecution(key, executorA);
    if (!r.attached) throw new Error('expected attach');
    // Attacker without the token: complete() must NOT change the state.
    await r.controller.complete({ stolen: true }, { executorInstanceId: 'attacker', executionToken: 'forged' });
    expect(broker.get(key)?.state).toBe('running');
    // Correct identity + token works.
    await r.controller.complete({ ok: true }, { executorInstanceId: 'inst-A', executionToken: r.attachment.executionToken });
    expect(broker.get(key)?.state).toBe('completed');
  });

  it('controller markSent sets sentAt durably; fail after sent upgrades to unconfirmed even with retryable:true', async () => {
    const { broker } = makeBroker();
    const key = brokerKey('scope', 'chatgpt-web', 'req-6');
    await broker.begin(key);
    const r = await broker.attachForExecution(key, executorA);
    if (!r.attached) throw new Error('expected attach');
    await r.controller.markSent({ executorInstanceId: 'inst-A', executionToken: r.attachment.executionToken });
    expect(broker.get(key)?.attachment?.sentAt).not.toBeNull();
    await r.controller.fail({ retryable: true, error: 'post-send drop' }, { executorInstanceId: 'inst-A', executionToken: r.attachment.executionToken });
    expect(broker.get(key)?.state).toBe('unconfirmed');
  });
});

describe('settleForwardFailure (durable truth after forward interruption)', () => {
  it('no attachment → failed(retryable)', async () => {
    const { broker } = makeBroker();
    const key = brokerKey('scope', 'chatgpt-web', 'req-7');
    await broker.begin(key);
    const outcome = await broker.settleForwardFailure(key, { executorPid: 999999999 });
    expect(outcome.outcome).toBe('failed_retryable');
    expect(broker.get(key)?.state).toBe('failed');
  });

  it('attachment WITHOUT sentAt + executor pid DEAD → attachment cleared, failed(retryable)', async () => {
    const { broker } = makeBroker();
    const key = brokerKey('scope', 'chatgpt-web', 'req-8');
    await broker.begin(key);
    await broker.attachForExecution(key, { ...executorA, executorPid: 999999999 });
    const outcome = await broker.settleForwardFailure(key, { executorPid: 999999999 });
    expect(outcome.outcome).toBe('failed_retryable');
    expect(outcome.cleared).toBe(true);
    const entry = broker.get(key);
    expect(entry?.state).toBe('failed');
    expect(entry?.attachment).toBeUndefined();
  });

  it('attachment WITH sentAt → unconfirmed (message may have reached the chat — never retried)', async () => {
    const { broker } = makeBroker();
    const key = brokerKey('scope', 'chatgpt-web', 'req-9');
    await broker.begin(key);
    const r = await broker.attachForExecution(key, { ...executorA, executorPid: 999999999 });
    if (!r.attached) throw new Error('expected attach');
    await r.controller.markSent({ executorInstanceId: 'inst-A', executionToken: r.attachment.executionToken });
    const outcome = await broker.settleForwardFailure(key, { executorPid: 999999999 });
    expect(outcome.outcome).toBe('unconfirmed');
    expect(broker.get(key)?.state).toBe('unconfirmed');
  });

  it('attachment + executor pid ALIVE → unconfirmed (execution may be running right now)', async () => {
    const { broker } = makeBroker();
    const key = brokerKey('scope', 'chatgpt-web', 'req-10');
    await broker.begin(key);
    await broker.attachForExecution(key, { ...executorA, executorPid: process.pid });
    const outcome = await broker.settleForwardFailure(key, { executorPid: process.pid });
    expect(outcome.outcome).toBe('unconfirmed');
    expect(broker.get(key)?.state).toBe('running'); // untouched — may still finish
  });

  it('markUnconfirmedByKey records the reason durably', async () => {
    const { broker } = makeBroker();
    const key = brokerKey('scope', 'chatgpt-web', 'req-11');
    await broker.begin(key);
    await broker.markUnconfirmedByKey(key, 'ipc channel dropped after accepted');
    const e = broker.get(key);
    expect(e?.state).toBe('unconfirmed');
    expect(e?.reason).toBe('ipc channel dropped after accepted');
  });
});
