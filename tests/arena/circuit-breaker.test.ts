/**
 * Task 14 — circuit breaker (TDD: failing first).
 *
 * Owner locked rules encoded here:
 *  - CLOSED → OPEN after a configurable countable-failure threshold;
 *    OPEN refuses NEW requests but NEVER touches in-flight ones;
 *  - after a configurable recovery period → HALF_OPEN allowing exactly ONE
 *    controlled probe; probe success closes the circuit, probe failure
 *    re-opens it;
 *  - state is keyed by (providerId, profileDir) and ISOLATED per key;
 *  - cross-process: two processes must never hold concurrent HALF_OPEN
 *    probes for the same profile (probe lease guarded by a ProcessLock);
 *  - AUTH_REQUIRED / QUOTA_EXHAUSTED / RATE_LIMITED are NOT transient:
 *    they never count toward opening (policy-guarded elsewhere);
 *  - user-input / ordinary tool errors never open the circuit;
 *  - no silent provider/account switching happens here — the breaker only
 *    refuses or admits requests for ITS OWN key.
 *
 * Unit tests use a temp state file; the cross-process test uses REAL child
 * processes. No browser, no real provider, no real rate limits.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CircuitBreaker } from '../../src/arena/circuit-breaker.js';
import type { ProviderFailureCode } from '../../src/arena/provider-failures.js';

const dirs: string[] = [];
const tmpStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emo-breaker-'));
  dirs.push(dir);
  return path.join(dir, 'breaker-state.json');
};

afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const newBreaker = (overrides: Record<string, unknown> = {}) =>
  new CircuitBreaker({
    providerId: 'chatgpt-web',
    profileDir: '/profiles/chatgpt',
    storePath: tmpStore(),
    threshold: 3,
    recoveryMs: 50,
    ...overrides,
  } as never);

const fail = (b: CircuitBreaker, code: ProviderFailureCode = 'NETWORK_TIMEOUT') => b.record(code);

describe('CLOSED → OPEN at the threshold', () => {
  it('admits while below the threshold, refuses AT it', async () => {
    const b = newBreaker();
    expect(b.state()).toBe('closed');
    expect(await b.canAccept()).toBe(true);
    await fail(b);
    await fail(b);
    expect(b.state()).toBe('closed'); // 2 < 3
    expect(await b.canAccept()).toBe(true);
    await fail(b);
    expect(b.state()).toBe('open');
    expect(await b.canAccept()).toBe(false); // NEW requests refused
  });

  it('successes reset the count (isolated failures must not accumulate forever)', async () => {
    const b = newBreaker();
    await fail(b);
    await fail(b);
    await b.recordSuccess();
    await fail(b);
    await fail(b);
    expect(b.state()).toBe('closed'); // never reached 3 consecutive
  });
});

describe('OPEN never cancels in-flight work', () => {
  it('opening only affects NEW canAccept calls — no cancellation API exists to kill running requests', async () => {
    const b = newBreaker();
    await fail(b);
    await fail(b);
    await fail(b);
    expect(b.state()).toBe('open');
    // The breaker exposes no cancel/abort surface; in-flight requests run to
    // completion. That is a structural property: assert no such method.
    expect((b as unknown as Record<string, unknown>).cancel).toBeUndefined();
    expect((b as unknown as Record<string, unknown>).abortInFlight).toBeUndefined();
  });
});

describe('OPEN → HALF_OPEN → probe', () => {
  it('after recoveryMs the circuit admits exactly ONE probe (same process)', async () => {
    const b = newBreaker();
    for (let i = 0; i < 3; i++) await fail(b);
    expect(b.state()).toBe('open');
    expect(await b.canAccept()).toBe(false);

    await new Promise((r) => setTimeout(r, 60)); // past recoveryMs
    const first = await b.startProbe();
    expect(first.granted).toBe(true);
    expect(b.state()).toBe('half_open');
    expect(await b.canAccept()).toBe(false); // ordinary traffic still refused

    const second = await b.startProbe();
    expect(second.granted).toBe(false); // ONE probe at a time
    expect(b.state()).toBe('half_open');
  });

  it('probe success → CLOSED with reset counters', async () => {
    const b = newBreaker();
    for (let i = 0; i < 3; i++) await fail(b);
    await new Promise((r) => setTimeout(r, 60));
    expect((await b.startProbe()).granted).toBe(true);
    await b.completeProbe(true);
    expect(b.state()).toBe('closed');
    expect(await b.canAccept()).toBe(true);
    // counters were reset: two more failures must NOT reopen
    await fail(b);
    await fail(b);
    expect(b.state()).toBe('closed');
  });

  it('probe failure → OPEN again (immediately refusing)', async () => {
    const b = newBreaker();
    for (let i = 0; i < 3; i++) await fail(b);
    await new Promise((r) => setTimeout(r, 60));
    expect((await b.startProbe()).granted).toBe(true);
    await b.completeProbe(false);
    expect(b.state()).toBe('open');
    expect(await b.canAccept()).toBe(false);
  });

  it('a STALE probe lease (dead pid / expired TTL) is taken over, not deadlock', async () => {
    const b = newBreaker();
    for (let i = 0; i < 3; i++) await fail(b);
    await new Promise((r) => setTimeout(r, 60));
    expect((await b.startProbe()).granted).toBe(true);
    // Simulate a crashed prober: forge the state file with a dead pid lease.
    const raw = JSON.parse(fs.readFileSync(b.storePath!, 'utf8'));
    raw['chatgpt-web::/profiles/chatgpt'].probe.pid = 999_999_999; // dead
    raw['chatgpt-web::/profiles/chatgpt'].probe.acquiredAt = Date.now() - 10_000; // older than lease TTL
    fs.writeFileSync(b.storePath!, JSON.stringify(raw));
    const b2 = new CircuitBreaker({ providerId: 'chatgpt-web', profileDir: '/profiles/chatgpt', storePath: b.storePath, threshold: 3, recoveryMs: 50 } as never);
    const takeover = await b2.startProbe();
    expect(takeover.granted).toBe(true);
  });
});

describe('countable-failure policy', () => {
  it('AUTH_REQUIRED / QUOTA_EXHAUSTED / RATE_LIMITED never count toward opening', async () => {
    const b = newBreaker();
    for (const code of ['AUTH_REQUIRED', 'QUOTA_EXHAUSTED', 'RATE_LIMITED'] as ProviderFailureCode[]) {
      for (let i = 0; i < 10; i++) await fail(b, code);
    }
    expect(b.state()).toBe('closed');
    expect(await b.canAccept()).toBe(true);
  });

  it('user-input and ordinary tool errors never open the circuit', async () => {
    const b = newBreaker();
    for (const code of ['INVALID_USER_INPUT', 'TOOL_ERROR', 'BAD_REQUEST'] as ProviderFailureCode[]) {
      for (let i = 0; i < 10; i++) {
        // Unknown/uncountable codes are ignored by record() — type-cast on
        // purpose: callers may pass raw strings; only BREAKER_COUNTABLE count.
        await b.record(code as ProviderFailureCode);
      }
    }
    expect(b.state()).toBe('closed');
  });
});

describe('provider/profile isolation', () => {
  it('a different providerId or profileDir has its own independent state', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emo-breaker-iso-'));
    dirs.push(dir);
    const a = new CircuitBreaker({ providerId: 'chatgpt-web', profileDir: '/p1', storePath: path.join(dir, 's.json'), threshold: 2, recoveryMs: 50 } as never);
    const b = new CircuitBreaker({ providerId: 'claude-web', profileDir: '/p1', storePath: path.join(dir, 's.json'), threshold: 2, recoveryMs: 50 } as never);
    const c = new CircuitBreaker({ providerId: 'chatgpt-web', profileDir: '/p2', storePath: path.join(dir, 's.json'), threshold: 2, recoveryMs: 50 } as never);

    for (let i = 0; i < 2; i++) await fail(a);
    expect(a.state()).toBe('open');
    expect(b.state()).toBe('closed');
    expect(c.state()).toBe('closed');
    expect(await a.canAccept()).toBe(false);
    expect(await b.canAccept()).toBe(true);
    expect(await c.canAccept()).toBe(true);
  });

  it('state persists across breaker instances on the SAME store path', async () => {
    const store = tmpStore();
    const b1 = new CircuitBreaker({ providerId: 'chatgpt-web', profileDir: '/p1', storePath: store, threshold: 2, recoveryMs: 50 } as never);
    for (let i = 0; i < 2; i++) await fail(b1);
    expect(b1.state()).toBe('open');

    const b2 = new CircuitBreaker({ providerId: 'chatgpt-web', profileDir: '/p1', storePath: store, threshold: 2, recoveryMs: 50 } as never);
    expect(b2.state()).toBe('open'); // durable state, not just memory
    expect(await b2.canAccept()).toBe(false);
  });
});

describe('cross-process single HALF_OPEN probe (REAL child processes)', () => {
  it('two real processes racing startProbe for the same key → exactly one granted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emo-breaker-race-'));
    dirs.push(dir);
    const store = path.join(dir, 'state.json');
    // Force the breaker OPEN first so startProbe is meaningful.
    const seed = new CircuitBreaker({ providerId: 'chatgpt-web', profileDir: '/pX', storePath: store, threshold: 1, recoveryMs: 0 } as never);
    await fail(seed);

    const res = spawnSync(
      process.execPath,
      [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('tests/fixtures/breaker-probe-racer.ts'), store],
      { encoding: 'utf8', timeout: 30_000, cwd: path.resolve('.') }
    );
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout.trim().split('\n').pop()!);
    expect(out.results.length).toBe(2);
    const granted = out.results.filter((r: { granted: boolean }) => r.granted);
    const refused = out.results.filter((r: { granted: boolean }) => !r.granted);
    expect(granted.length).toBe(1);
    expect(refused.length).toBe(1);
    expect(granted[0].state).toBe('half_open');
  }, 40_000);
});
