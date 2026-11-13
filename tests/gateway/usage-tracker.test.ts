import { describe, it, expect } from 'vitest';
import { UsageTracker } from '../../src/gateway/usage-tracker.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('UsageTracker', () => {
  it('logs a request at arrival as in flight and stamps it on completion', () => {
    let now = 1_700_000_000_000;
    const t = new UsageTracker({ heartbeatTimeoutMs: 5000, now: () => now });
    let changes = 0;
    t.onUsageChange(() => { changes += 1; });

    t.recordRequestStart({ id: 'r1', model: 'm', stream: false, promptChars: 8, clientAgent: 'Cursor' });
    const inFlight = t.getRecentRequests();
    expect(inFlight).toHaveLength(1);
    expect(inFlight[0].id).toBe('r1');
    // undefined means "in flight right now" (JSON drops the key entirely)
    expect(inFlight[0].ok).toBeUndefined();
    expect(inFlight[0].clientAgent).toBe('Cursor');
    const arrivedAt = inFlight[0].timestamp;

    now += 4200;
    t.recordRequestEnd({ id: 'r1', ok: true, completionChars: 16 });
    const done = t.getRecentRequests();
    expect(done).toHaveLength(1);
    expect(done[0].ok).toBe(true);
    expect(done[0].durationMs).toBe(4200);
    // truth: the entry keeps the moment the request actually arrived
    expect(done[0].timestamp).toBe(arrivedAt);
    expect(changes).toBe(2);
  });

  it('marks persisted in-flight entries as interrupted when the gateway restarts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emo-tracker-'));
    const persistPath = path.join(dir, 'recent.json');
    try {
      fs.writeFileSync(persistPath, JSON.stringify({
        entries: [{
          id: 'r-old', timestamp: new Date().toISOString(), timeStr: '00:00:00',
          model: 'm', stream: false, promptChars: 1, completionChars: 0,
          tokensEstimated: 1, durationMs: 0, clientAgent: 'Cursor',
        }],
      }));
      const t = new UsageTracker({ heartbeatTimeoutMs: 5000, persistPath });
      const restored = t.getRecentRequests();
      expect(restored).toHaveLength(1);
      expect(restored[0].ok).toBe(false);
      expect(restored[0].error).toBe('interrupted by gateway restart');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

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
