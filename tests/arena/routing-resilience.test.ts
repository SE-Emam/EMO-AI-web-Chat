/**
 * Task 14 — RoutingDriver resilience policy (TDD: failing first).
 *
 * Owner locked rules:
 *  - RATE_LIMITED: NO parallel attempts for the same request, NO automatic
 *    re-send, NO silent provider/account switching — a clear client error
 *    with a suggested retry time when evidence exists;
 *  - AUTH_REQUIRED / QUOTA_EXHAUSTED: NEVER fail over (never "healed" by
 *    switching providers) — usage limits are never bypassed by routing;
 *  - a failure AFTER a possible send (sent=true) is NEVER failed over:
 *    failover would duplicate the send;
 *  - pre-send failures with PROVEN non-execution remain failover-safe;
 *  - the circuit breaker refuses OPEN routes for NEW requests only
 *    (in-flight requests are untouched);
 *  - legacy plain-Error failover behavior is preserved (regression guard).
 *
 * Fake drivers only — no browser, no real provider, no real rate limits.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RoutingDriver, type DriverRoute } from '../../src/arena/routing-driver.js';
import { ProviderFailureError, classifyFailure, type ProviderFailure, type ProviderFailureCode } from '../../src/arena/provider-failures.js';
import { BreakerRegistry } from '../../src/arena/circuit-breaker.js';
import { ProfileBusyError } from '../../src/arena/profile-busy-error.js';
import type { ArenaDriver, ChatMessage } from '../../src/types.js';

const dirs: string[] = [];
const tmpStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emo-routing-res-'));
  dirs.push(dir);
  return path.join(dir, 'breaker.json');
};
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'hi' }];

const fakeDriver = (tag: string, impl?: ArenaDriver['sendMessage']): ArenaDriver =>
  ({
    listModels: vi.fn().mockResolvedValue([`${tag}-model`]),
    sendMessage: impl ?? vi.fn().mockResolvedValue(`${tag}-answer`),
    close: vi.fn(),
    getProfileDir: () => `/profiles/${tag}`,
  }) as unknown as ArenaDriver;

const failWith = (code: string, extra: Partial<ProviderFailure> = {}) =>
  new ProviderFailureError(
    {
      code: code as ProviderFailureCode,
      phase: extra.phase ?? 'awaiting',
      sent: extra.sent ?? false,
      confirmedResult: extra.confirmedResult ?? false,
      retryable: extra.retryable ?? false,
      markUnconfirmed: extra.markUnconfirmed ?? true,
      ...(extra.retryAfterMs !== undefined ? { retryAfterMs: extra.retryAfterMs } : {}),
    } as ProviderFailure,
    `${code}-marker`
  );

const route = (name: string, driver: ArenaDriver): DriverRoute => ({ name, driver, matches: () => true });

describe('no failover on policy codes (no silent switching)', () => {
  it('RATE_LIMITED on route 1 → route 2 NEVER called; clear error with suggested retry time', async () => {
    const rateError = failWith('RATE_LIMITED', { status: 429, retryAfter: '45' });
    const d1 = fakeDriver('one', vi.fn().mockRejectedValue(rateError));
    const d2 = fakeDriver('two');
    const routing = new RoutingDriver([route('r1', d1), route('r2', d2)]);

    await expect(routing.sendMessage('m', MESSAGES)).rejects.toThrow(/RATE_LIMITED/);
    expect(d1.sendMessage).toHaveBeenCalledTimes(1);
    expect(d2.sendMessage).not.toHaveBeenCalled(); // no silent provider switch
  });

  it('AUTH_REQUIRED on route 1 → no silent account/provider switch', async () => {
    const authError = failWith('AUTH_REQUIRED', {});
    const d1 = fakeDriver('one', vi.fn().mockRejectedValue(authError));
    const d2 = fakeDriver('two');
    const routing = new RoutingDriver([route('r1', d1), route('r2', d2)]);

    await expect(routing.sendMessage('m', MESSAGES)).rejects.toThrow(/AUTH_REQUIRED/);
    expect(d2.sendMessage).not.toHaveBeenCalled();
  });

  it('QUOTA_EXHAUSTED on route 1 → usage limits never bypassed via another provider', async () => {
    const quotaError = failWith('QUOTA_EXHAUSTED', { code: 'insufficient_quota' });
    const d1 = fakeDriver('one', vi.fn().mockRejectedValue(quotaError));
    const d2 = fakeDriver('two');
    const routing = new RoutingDriver([route('r1', d1), route('r2', d2)]);

    await expect(routing.sendMessage('m', MESSAGES)).rejects.toThrow(/QUOTA_EXHAUSTED/);
    expect(d2.sendMessage).not.toHaveBeenCalled();
  });

  it('a failure AFTER a possible send (sent=true) is never failed over — no duplicate send', async () => {
    const unknownError = failWith('NETWORK_UNKNOWN_AFTER_SEND', { phase: 'awaiting', sent: true });
    const d1 = fakeDriver('one', vi.fn().mockRejectedValue(unknownError));
    const d2 = fakeDriver('two');
    const routing = new RoutingDriver([route('r1', d1), route('r2', d2)]);

    await expect(routing.sendMessage('m', MESSAGES)).rejects.toThrow(/NETWORK_UNKNOWN_AFTER_SEND/);
    expect(d1.sendMessage).toHaveBeenCalledTimes(1);
    expect(d2.sendMessage).not.toHaveBeenCalled();
  });

  it('ProfileBusyError keeps its ownership rule: rethrown, never converted to a switch', async () => {
    const d1 = fakeDriver('one', vi.fn().mockRejectedValue(new ProfileBusyError('profile busy')));
    const d2 = fakeDriver('two');
    const routing = new RoutingDriver([route('r1', d1), route('r2', d2)]);

    await expect(routing.sendMessage('m', MESSAGES)).rejects.toThrow(ProfileBusyError);
    expect(d2.sendMessage).not.toHaveBeenCalled();
  });
});

describe('failover survives for proven non-execution failures', () => {
  it('pre-send network timeout → next route tried (retryable, nothing was sent)', async () => {
    const timeoutError = failWith('NETWORK_TIMEOUT', { phase: 'pre-send', retryable: true });
    const d1 = fakeDriver('one', vi.fn().mockRejectedValue(timeoutError));
    const d2 = fakeDriver('two');
    const routing = new RoutingDriver([route('r1', d1), route('r2', d2)]);

    expect(await routing.sendMessage('m', MESSAGES)).toBe('two-answer');
    expect(d1.sendMessage).toHaveBeenCalledTimes(1);
    expect(d2.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('legacy plain-Error failover is preserved (regression guard)', async () => {
    const d1 = fakeDriver('one', vi.fn().mockRejectedValue(new Error('boom')));
    const d2 = fakeDriver('two');
    const routing = new RoutingDriver([route('r1', d1), route('r2', d2)]);

    expect(await routing.sendMessage('m', MESSAGES)).toBe('two-answer');
    expect(d2.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('circuit breaker integration', () => {
  it('an OPEN route is skipped for NEW requests; the next route serves them', async () => {
    const store = tmpStore();
    const registry = new BreakerRegistry(store, { threshold: 1, recoveryMs: 60_000 });
    const failError = failWith('NETWORK_TIMEOUT', { phase: 'pre-send', retryable: true });
    const d1 = fakeDriver('one', vi.fn().mockRejectedValue(failError));
    const d2 = fakeDriver('two');
    const routing = new RoutingDriver([route('r1', d1), route('r2', d2)], { breakers: registry });

    // First request: r1 fails (pre-send) → failover to r2 → r1 opens.
    expect(await routing.sendMessage('m', MESSAGES)).toBe('two-answer');
    expect(d1.sendMessage).toHaveBeenCalledTimes(1);

    // Second request: r1 is OPEN → skipped WITHOUT being called.
    expect(await routing.sendMessage('m', MESSAGES)).toBe('two-answer');
    expect(d1.sendMessage).toHaveBeenCalledTimes(1); // not re-attempted
    expect(d2.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('breaker OPEN does NOT cancel in-flight work — concurrent request already inside r1 completes', async () => {
    const store = tmpStore();
    const registry = new BreakerRegistry(store, { threshold: 1, recoveryMs: 60_000 });
    let releaseFn!: () => void;
    const gate = new Promise<void>((r) => (releaseFn = r));
    const d1 = fakeDriver(
      'one',
      vi.fn().mockImplementation(async () => {
        await gate;
        return 'slow-one-answer';
      })
    );
    const d2 = fakeDriver('two', vi.fn().mockRejectedValue(failWith('NETWORK_TIMEOUT', { phase: 'pre-send' })));
    const routing = new RoutingDriver([route('r1', d1), route('r2', d2)], { breakers: registry });

    const inFlight = routing.sendMessage('m', MESSAGES); // inside r1, awaiting the gate
    await new Promise((r) => setTimeout(r, 20));
    // While r1 is in-flight, a DIFFERENT session's failure count opens r1.
    await registry.forProvider('r1', '/profiles/one').record('NETWORK_TIMEOUT');
    releaseFn();
    expect(await inFlight).toBe('slow-one-answer'); // untouched by OPEN
  });
});
