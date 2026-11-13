/**
 * Task 12 — REAL child-process semantics for the unified broker layer.
 *
 * Extends the phase-1 broker-racer pattern (tests/fixtures/broker-racer.ts)
 * with the Task 12 helpers (payloadFingerprint / brokerScopedKey /
 * beginBrokeredRequest): two (or more) REAL processes over ONE shared
 * durable store prove:
 *   1. atomic fingerprint-aware claims (exactly one ALLOWED per key);
 *   2. cross-process CONFLICT on the same key with a different fingerprint;
 *   3. REPLAY from the durable store after the executing process EXITED
 *      (owner-restart equivalent) — the stored nativeReplay survives;
 *   4. oversize results stay state-only cross-process → DENIED with a
 *      clear "too large" reason, never a fake replay;
 *   5. legacy entries WITHOUT a fingerprint are replayed cross-process
 *      WITHOUT claiming diff-detection (documented backward compat).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { brokerKey } from '../../src/protocol/request-broker.js';

const children: ChildProcess[] = [];
afterAll(() => {
  for (const c of children.splice(0)) {
    try { c.kill(); } catch { /* already exited */ }
  }
});

const make = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'emo-fp-racer-'));
  return { dir: d, store: path.join(d, 'request-broker.json'), out: path.join(d, 'racer.out') };
};

const run = (args: string[]) => {
  const script = path.resolve('tests/fixtures/broker-fingerprint-racer.ts');
  const p = spawn(
    process.execPath,
    [path.resolve('node_modules/tsx/dist/cli.mjs'), script, ...args],
    { stdio: 'ignore' }
  );
  children.push(p);
  return p;
};

const exitCode = (p: ChildProcess) =>
  new Promise<number>((res) => p.on('exit', (c) => res(c ?? 1)));

const lines = (out: string) => fs.readFileSync(out, 'utf8').split('\n').filter(Boolean);

const LEGACY_STORE = (key: string) =>
  JSON.stringify({
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
  });

describe('unified broker × REAL processes (Task 12)', () => {
  it('two REAL processes race the same key+fingerprint: exactly one ALLOWED, one DENIED:running', async () => {
    const { store, out } = make();
    const a = run([store, out, 'claim', 'A', 'model-x', 'rid-race', 'fp-same']);
    const b = run([store, out, 'claim', 'B', 'model-x', 'rid-race', 'fp-same']);
    const codes = await Promise.all([exitCode(a), exitCode(b)]);
    expect(codes).toEqual([0, 0]);
    const outLines = lines(out);
    expect(outLines.filter((l) => l.startsWith('ALLOWED:'))).toHaveLength(1);
    expect(outLines.filter((l) => l.startsWith('DENIED:') && l.includes(':running'))).toHaveLength(1);
  }, 30_000);

  it('same key, DIFFERENT fingerprint, second process after completion → cross-process CONFLICT', async () => {
    const { store, out } = make();
    const a = run([store, out, 'claim-now', 'A', 'model-x', 'rid-conflict', 'fp-ONE', 'result-one', '1']);
    expect(await exitCode(a)).toBe(0);
    const b = run([store, out, 'claim-now', 'B', 'model-x', 'rid-conflict', 'fp-TWO', 'result-two', '1']);
    expect(await exitCode(b)).toBe(0);
    const outLines = lines(out);
    expect(outLines).toContain('ALLOWED:A');
    expect(outLines).toContain('CONFLICT:B'); // explicit conflict, never a silent replay
  }, 30_000);

  it('replay after the executing process EXITED (owner-restart equivalent): stored nativeReplay survives', async () => {
    const { store, out } = make();
    const a = run([store, out, 'claim-now', 'A', 'model-x', 'rid-restart', 'fp-stable', 'النتيجة الدائمة', '1']);
    expect(await exitCode(a)).toBe(0);
    const b = run([store, out, 'claim-now', 'B', 'model-x', 'rid-restart', 'fp-stable', 'ignored', '1']);
    expect(await exitCode(b)).toBe(0);
    const replay = lines(out).find((l) => l.startsWith('REPLAY:B:'));
    expect(replay).toBeDefined();
    const stored = JSON.parse(replay!.slice('REPLAY:B:'.length)) as { nativeReplay?: { content?: Array<{ text?: string }> } };
    expect(stored.nativeReplay?.content?.[0]?.text).toBe('النتيجة الدائمة');
    expect(lines(out).filter((l) => l.startsWith('ALLOWED:'))).toHaveLength(1); // executed exactly once
  }, 30_000);

  it('oversize result (>256KB) cross-process: completed state-only → DENIED with a clear "too large" reason', async () => {
    const { store, out } = make();
    const a = run([store, out, 'claim-now', 'A', 'model-x', 'rid-big', 'fp-big', '__OVERSIZE__', '1']);
    expect(await exitCode(a)).toBe(0);
    const entry = JSON.parse(fs.readFileSync(store, 'utf8')).entries.find(
      (e: { key: string }) => e.key === brokerKey('racer-scope', 'anthropic:model-x', 'rid-big')
    );
    expect(entry.state).toBe('completed');
    expect(entry.result).toBeUndefined(); // state-only: result intentionally NOT cached
    const b = run([store, out, 'claim-now', 'B', 'model-x', 'rid-big', 'fp-big', '__OVERSIZE__', '1']);
    expect(await exitCode(b)).toBe(0);
    const denied = lines(out).find((l) => l.startsWith('DENIED:B:'));
    expect(denied).toBeDefined();
    expect(denied).toContain(':completed:');
    expect(denied).toContain('too large to replay');
  }, 30_000);

  it('legacy entry WITHOUT fingerprint: replayed cross-process WITHOUT claiming diff-detection', async () => {
    const { store, out } = make();
    fs.writeFileSync(store, LEGACY_STORE(brokerKey('racer-scope', 'anthropic:model-legacy', 'rid-legacy')));
    const b = run([store, out, 'claim-now', 'B', 'model-legacy', 'rid-legacy', 'fp-anything-different', 'ignored', '1']);
    expect(await exitCode(b)).toBe(0);
    const replay = lines(out).find((l) => l.startsWith('REPLAY:B:'));
    expect(replay).toBeDefined();
    expect(replay).toContain('legacy-stored-text');
    // And the legacy entry is NOT upgraded with a fingerprint claim: a
    // CONFLICT cannot be proven for entries that never stored one.
    expect(lines(out).filter((l) => l.startsWith('CONFLICT:'))).toHaveLength(0);
  }, 30_000);
});
