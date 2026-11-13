/**
 * Task 14 — provider failure classification (TDD: failing first).
 *
 * Owner locked rules encoded here:
 *  - 10 explicit failure codes, a classified result always carries
 *    code/phase/sent/confirmedResult/retryable/markUnconfirmed;
 *  - an error may NEVER become retryable without checking the execution
 *    phase and the send marker: pre-send retry is allowed only when
 *    non-execution is PROVEN; a possibly-sent message with an unknown
 *    result is unconfirmed and never auto-re-sent;
 *  - RATE_LIMITED / QUOTA_EXHAUSTED require TRUSTWORTHY evidence (a clear
 *    code, a Retry-After, or a confirmed page marker) — never vague
 *    message text alone;
 *  - Retry-After is honored only when valid (seconds or HTTP date;
 *    negative/huge/garbage → refused);
 *  - quota exhaustion is NOT a temporary rate limit and AUTH/QUOTA are
 *    never healed by failover (BREAKER_COUNTABLE excludes them).
 *
 * No network, no browser, no real provider — pure functions on fixtures.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyFailure,
  parseRetryAfter,
  buildDiagnostics,
  ResilienceRegistry,
  BREAKER_COUNTABLE,
  ProviderFailureError,
  type ProviderFailureCode,
} from '../../src/arena/provider-failures.js';

const err = (message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), extra) as Error & Record<string, unknown>;

const base = { phase: 'pre-send' as const, sent: false };

describe('the 10 failure codes are all reachable', () => {
  const cases: Array<[string, Error, Record<string, unknown>, ProviderFailureCode]> = [
    ['AUTH_REQUIRED', err('chatgpt-web session is not authenticated (redirected to /auth/login). Please log in'), {}, 'AUTH_REQUIRED'],
    ['AUTH_REQUIRED (401)', err('unauthorized'), { status: 401 }, 'AUTH_REQUIRED'],
    ['RATE_LIMITED (429)', err('too many requests'), { status: 429 }, 'RATE_LIMITED'],
    ['RATE_LIMITED (clear code)', err('api error'), { code: 'rate_limit_error' }, 'RATE_LIMITED'],
    ['QUOTA_EXHAUSTED (clear code)', err('you have exceeded your billing quota'), { code: 'insufficient_quota' }, 'QUOTA_EXHAUSTED'],
    ['NETWORK_TIMEOUT', err('request timed out after 30000ms'), {}, 'NETWORK_TIMEOUT'],
    ['GENERATION_STALLED', err('generation stalled: no output for 45000ms'), {}, 'GENERATION_STALLED'],
    ['UI_SELECTOR_CHANGED', err('Timeout 30000ms exceeded waiting for selector .sendMessageButton'), {}, 'UI_SELECTOR_CHANGED'],
    ['CONVERSATION_RESTORE_FAILED', err('Timeout 20000ms exceeded restoring conversation'), { phase: 'restore' }, 'CONVERSATION_RESTORE_FAILED'],
    ['PROFILE_OWNER_UNAVAILABLE', err('profile owner unavailable: claim refused busy'), { name: 'ProfileBusyError' }, 'PROFILE_OWNER_UNAVAILABLE'],
  ];
  for (const [label, e, extra, expected] of cases) {
    it(`classifies ${label}`, () => {
      const merged = Object.assign(e, extra);
      const f = classifyFailure(merged as Error, { ...base, ...extra } as never);
      expect(f.code).toBe(expected);
      expect(['code', 'phase', 'sent', 'confirmedResult', 'retryable', 'markUnconfirmed'].every((k) => k in f)).toBe(true);
    });
  }

  it('unclassified failure → PROVIDER_UNAVAILABLE', () => {
    expect(classifyFailure(err('something went sideways'), base).code).toBe('PROVIDER_UNAVAILABLE');
  });
});

describe('execution phase + send marker govern retryability (core rule)', () => {
  it('pre-send network timeout (non-execution PROVEN) → retryable, not unconfirmed', () => {
    const f = classifyFailure(err('connection timed out'), { phase: 'pre-send', sent: false });
    expect(f.code).toBe('NETWORK_TIMEOUT');
    expect(f.retryable).toBe(true);
    expect(f.markUnconfirmed).toBe(false);
  });

  it('timeout AFTER send with NO provable result → NETWORK_UNKNOWN_AFTER_SEND + unconfirmed, never auto-retried', () => {
    const f = classifyFailure(err('waiting for reply timed out'), { phase: 'awaiting', sent: true, confirmedResult: false });
    expect(f.code).toBe('NETWORK_UNKNOWN_AFTER_SEND');
    expect(f.sent).toBe(true);
    expect(f.retryable).toBe(false);
    expect(f.markUnconfirmed).toBe(true);
  });

  it('timeout AFTER send WITH a provable result (broker completed / page marker) → stays NETWORK_TIMEOUT, NOT unconfirmed', () => {
    const f = classifyFailure(err('waiting for reply timed out'), { phase: 'awaiting', sent: true, confirmedResult: true });
    expect(f.code).toBe('NETWORK_TIMEOUT');
    expect(f.markUnconfirmed).toBe(false);
    expect(f.retryable).toBe(false); // result known — no re-execution needed
  });

  it('client abort mid-awaiting (sent) → NETWORK_UNKNOWN_AFTER_SEND + unconfirmed', () => {
    const f = classifyFailure(err('Request was aborted'), { phase: 'awaiting', sent: true, confirmedResult: false });
    expect(f.code).toBe('NETWORK_UNKNOWN_AFTER_SEND');
    expect(f.markUnconfirmed).toBe(true);
  });

  it('client abort BEFORE send → PROVIDER_UNAVAILABLE, non-retryable, not unconfirmed (nothing happened)', () => {
    const f = classifyFailure(err('Request was aborted'), { phase: 'pre-send', sent: false });
    expect(f.code).toBe('PROVIDER_UNAVAILABLE');
    expect(f.retryable).toBe(false);
    expect(f.markUnconfirmed).toBe(false);
  });

  it('AUTH detected AFTER a possible send keeps its code but is unconfirmed', () => {
    const f = classifyFailure(err('login required'), { phase: 'post-send', sent: true, confirmedResult: false });
    expect(f.code).toBe('AUTH_REQUIRED');
    expect(f.markUnconfirmed).toBe(true);
    expect(f.retryable).toBe(false);
  });

  it('RATE_LIMITED detected AFTER a possible send keeps its code but is unconfirmed', () => {
    const f = classifyFailure(err('slow down'), { phase: 'post-send', sent: true, confirmedResult: false, status: 429 } as never);
    expect(f.code).toBe('RATE_LIMITED');
    expect(f.markUnconfirmed).toBe(true);
    expect(f.retryable).toBe(false);
  });

  it('restore-phase timeout → CONVERSATION_RESTORE_FAILED (no silent new conversation, not retryable)', () => {
    const f = classifyFailure(err('restore timed out'), { phase: 'restore', sent: false });
    expect(f.code).toBe('CONVERSATION_RESTORE_FAILED');
    expect(f.retryable).toBe(false);
    expect(f.markUnconfirmed).toBe(false);
  });

  it('generation stall after send without proof of output → unconfirmed', () => {
    const f = classifyFailure(err('generation stalled'), { phase: 'awaiting', sent: true, confirmedResult: false });
    expect(f.code).toBe('GENERATION_STALLED');
    expect(f.markUnconfirmed).toBe(true);
    expect(f.retryable).toBe(false);
  });
});

describe('RATE_LIMITED vs QUOTA_EXHAUSTED vs AUTH_REQUIRED trust boundary', () => {
  it('vague "rate limit" MESSAGE TEXT alone is NOT evidence → PROVIDER_UNAVAILABLE', () => {
    const f = classifyFailure(err('You are being rate limited, please slow down'), base);
    expect(f.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('HTTP 429 status IS evidence → RATE_LIMITED', () => {
    const f = classifyFailure(err('too many requests'), { ...base, status: 429 } as never);
    expect(f.code).toBe('RATE_LIMITED');
  });

  it('a clear provider code IS evidence → RATE_LIMITED', () => {
    const f = classifyFailure(err('error', { code: 'rate_limit_exceeded' }), base);
    expect(f.code).toBe('RATE_LIMITED');
  });

  it('quota code wins over rate-limit wording — quota is NOT a temporary rate limit', () => {
    const f = classifyFailure(err('rate limit hit: insufficient_quota', { code: 'insufficient_quota' }), base);
    expect(f.code).toBe('QUOTA_EXHAUSTED');
    expect(f.retryable).toBe(false);
  });

  it('quota by clear code even mid-awaiting stays QUOTA_EXHAUSTED (unconfirmed if possibly sent)', () => {
    const f = classifyFailure(err('insufficient_quota', { code: 'insufficient_quota' }), { phase: 'awaiting', sent: true, confirmedResult: false });
    expect(f.code).toBe('QUOTA_EXHAUSTED');
    expect(f.markUnconfirmed).toBe(true);
  });
});

describe('parseRetryAfter (seconds or HTTP date; trustworthy only)', () => {
  it('accepts plain seconds', () => {
    expect(parseRetryAfter('120')).toBe(120_000);
    expect(parseRetryAfter(30)).toBe(30_000);
  });

  it('accepts an HTTP date in the future', () => {
    const in90s = new Date(Date.now() + 90_000).toUTCString();
    const ms = parseRetryAfter(in90s)!;
    expect(ms).toBeGreaterThan(60_000);
    expect(ms).toBeLessThanOrEqual(90_000);
  });

  it('refuses negative, zero, garbage, and unparseable dates', () => {
    expect(parseRetryAfter('-5')).toBeNull();
    expect(parseRetryAfter('0')).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter('not-a-date')).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
  });

  it('refuses absurdly huge waits (never auto-wait forever)', () => {
    expect(parseRetryAfter('100000000')).toBeNull();
  });

  it('honors a configurable max wait: anything beyond it is refused', () => {
    expect(parseRetryAfter('3600', { maxWaitMs: 60_000 })).toBeNull();
    expect(parseRetryAfter('30', { maxWaitMs: 60_000 })).toBe(30_000);
  });

  it('HTTP date already in the past is refused (nothing to wait for)', () => {
    expect(parseRetryAfter(new Date(Date.now() - 60_000).toUTCString())).toBeNull();
  });

  it('a valid Retry-After lands on the classified failure (RATE_LIMITED)', () => {
    const f = classifyFailure(err('too many requests'), { ...base, status: 429, retryAfter: '45' } as never);
    expect(f.code).toBe('RATE_LIMITED');
    expect(f.retryAfterMs).toBe(45_000);
    expect(f.retryable).toBe(false); // no AUTO re-send once possibly sent; caller decides with the suggested time
  });
});

describe('ProviderFailureError carries the classification to route boundaries', () => {
  it('wraps a ProviderFailure; classifyFailure passes an already-classified error through', () => {
    const failure = classifyFailure(err('too many requests'), { ...base, status: 429 } as never);
    const wrapped = new ProviderFailureError(failure);
    const again = classifyFailure(wrapped, { phase: 'post-send', sent: true });
    expect(again.code).toBe('RATE_LIMITED');
    expect(again.sent).toBe(true);
  });
});

describe('BREAKER_COUNTABLE — transient failures only', () => {
  it('excludes AUTH_REQUIRED, QUOTA_EXHAUSTED, RATE_LIMITED (never healed by retrying/switching)', () => {
    expect(BREAKER_COUNTABLE.has('AUTH_REQUIRED')).toBe(false);
    expect(BREAKER_COUNTABLE.has('QUOTA_EXHAUSTED')).toBe(false);
    expect(BREAKER_COUNTABLE.has('RATE_LIMITED')).toBe(false);
  });

  it('includes the transient network/stall/infrastructure family', () => {
    for (const code of ['NETWORK_TIMEOUT', 'NETWORK_UNKNOWN_AFTER_SEND', 'GENERATION_STALLED', 'PROVIDER_UNAVAILABLE', 'PROFILE_OWNER_UNAVAILABLE'] as ProviderFailureCode[]) {
      expect(BREAKER_COUNTABLE.has(code)).toBe(true);
    }
  });
});

describe('buildDiagnostics — secret-free, redacted, uniform fields', () => {
  it('contains all §G fields with a REDACTED sessionKey', () => {
    const d = buildDiagnostics({
      requestId: 'req-1',
      sessionKey: 'sess-abcdefghijklmnopqrstuvwxyz123456',
      providerId: 'chatgpt-web',
      profileId: 'profile-x',
      ownerInstanceId: 'owner-1',
      workerId: 'w2',
      epoch: 'e1',
      failureCode: 'NETWORK_TIMEOUT',
      phase: 'awaiting',
      requestState: 'unconfirmed',
      durationMs: 1234,
      sent: true,
      confirmed: false,
    });
    expect(d.requestId).toBe('req-1');
    expect(String(d.sessionKey).length).toBeLessThanOrEqual(24);
    expect(String(d.sessionKey).length).toBeGreaterThan(0);
    expect(d.providerId).toBe('chatgpt-web');
    expect(d.failureCode).toBe('NETWORK_TIMEOUT');
    expect(d.sent).toBe(true);
    expect(d.confirmed).toBe(false);
  });

  it('strips secret-named fields from anything extra (keys/bearer/cookies/tokens)', () => {
    const d = buildDiagnostics({
      requestId: 'req-2',
      apiKey: 'sk-AAAA',
      authorization: 'Bearer xyz',
      cookie: 'session=abc',
      accessToken: 'tok',
      clientSecret: 'shh',
      providerId: 'zai-web',
      failureCode: 'PROVIDER_UNAVAILABLE',
    }) as Record<string, unknown>;
    const json = JSON.stringify(d);
    expect(json).not.toContain('sk-AAAA');
    expect(json).not.toContain('Bearer xyz');
    expect(json).not.toContain('session=abc');
    expect(json).not.toContain('tok');
    expect(json).not.toContain('shh');
    expect(d.apiKey).toBeUndefined();
    expect(d.authorization).toBeUndefined();
  });
});

describe('ResilienceRegistry (process-local last-failure/last-success memory for /health)', () => {
  it('records lastFailure per provider and never for non-countable policy codes', () => {
    const r = new ResilienceRegistry();
    r.recordFailure('chatgpt-web', 'p1', 'NETWORK_TIMEOUT', { sent: true, confirmed: false });
    const snap = r.snapshot();
    expect(snap['chatgpt-web::p1'].lastFailureCode).toBe('NETWORK_TIMEOUT');
    expect(snap['chatgpt-web::p1'].lastFailureSent).toBe(true);
    expect(snap['chatgpt-web::p1'].lastSuccessAt).toBeUndefined();

    r.recordSuccess('chatgpt-web', 'p1');
    const snap2 = r.snapshot();
    expect(snap2['chatgpt-web::p1'].lastSuccessAt).toBeGreaterThan(0);
    expect(snap2['chatgpt-web::p1'].lastFailureCode).toBe('NETWORK_TIMEOUT'); // memory kept
  });
});
