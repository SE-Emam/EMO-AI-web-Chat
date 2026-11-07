import { describe, it, expect } from 'vitest';
import { UsageTracker } from '../../src/gateway/usage-tracker.js';

describe('UsageTracker', () => {
  it('records lifetime and session counters', () => {
    let now = 1000;
    const t = new UsageTracker({ heartbeatTimeoutMs: 5000, now: () => now });
    t.heartbeat();
    t.recordRequestStart({ model: 'm', stream: true, promptChars: 12 });
    t.recordRequestEnd({ ok: true, completionChars: 34 });
    t.recordRequestStart({ model: 'm', stream: false, promptChars: 1 });
    t.recordRequestEnd({ ok: false, completionChars: 0 });
    const s = t.snapshot(now);
    expect(s.lifetime.requests).toBe(2);
    expect(s.lifetime.chatRequests).toBe(2);
    expect(s.lifetime.streamRequests).toBe(1);
    expect(s.lifetime.completions).toBe(1);
    expect(s.lifetime.errors).toBe(1);
    expect(s.lifetime.promptChars).toBe(13);
    expect(s.lifetime.completionChars).toBe(34);
    expect(s.session.requests).toBe(2);
  });

  it('resets session after heartbeat timeout while keeping lifetime', () => {
    let now = 1000;
    const t = new UsageTracker({ heartbeatTimeoutMs: 5000, now: () => now });
    t.heartbeat();
    t.recordRequestStart({ model: 'm', stream: false, promptChars: 5 });
    t.recordRequestEnd({ ok: true, completionChars: 6 });
    now = 7001; // expired
    const s = t.snapshot(now);
    expect(s.sessionActive).toBe(false);
    expect(s.session.requests).toBe(0);
    expect(s.session.completionChars).toBe(0);
    expect(s.lifetime.requests).toBe(1);
    expect(s.lifetime.completionChars).toBe(6);
    expect(s.sessionResetAt).toBeDefined();
  });

  it('before first heartbeat session is inactive and zeroed', () => {
    const t = new UsageTracker({ heartbeatTimeoutMs: 5000, now: () => 1000 });
    t.recordRequestStart({ model: 'm', stream: false, promptChars: 1 });
    t.recordRequestEnd({ ok: true, completionChars: 1 });
    const s = t.snapshot(1000);
    expect(s.sessionActive).toBe(false);
    expect(s.session.requests).toBe(0);
    expect(s.lifetime.requests).toBe(1);
  });

  it('resets once per expired session until next heartbeat', () => {
    let now = 1000;
    const t = new UsageTracker({ heartbeatTimeoutMs: 5000, now: () => now });
    t.heartbeat();
    t.recordRequestStart({ model: 'm', stream: false, promptChars: 1 });
    t.recordRequestEnd({ ok: true, completionChars: 1 });
    now = 8000;
    const a = t.snapshot(now);
    const resetAt = a.sessionResetAt;
    now = 9000;
    const b = t.snapshot(now);
    expect(b.session.requests).toBe(0);
    expect(b.sessionResetAt).toBe(resetAt);
    t.heartbeat();
    now = 9100;
    const c = t.snapshot(now);
    expect(c.sessionActive).toBe(true);
    t.recordRequestStart({ model: 'm', stream: false, promptChars: 1 });
    t.recordRequestEnd({ ok: true, completionChars: 1 });
    now = 15000;
    const d = t.snapshot(now);
    expect(d.session.requests).toBe(0);
    expect(d.lifetime.requests).toBe(2);
  });
});
