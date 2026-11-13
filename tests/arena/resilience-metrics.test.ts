/**
 * Task 14 — /health metric sources: UsageTracker.inFlightCount() and the
 * process-global SessionQueue waiting counter. Additive, read-only metrics.
 */
import { describe, it, expect, vi } from 'vitest';
import { UsageTracker } from '../../src/gateway/usage-tracker.js';
import { SessionQueue } from '../../src/sessions/session-queue.js';

describe('UsageTracker.inFlightCount (Task 14, additive)', () => {
  it('counts started-not-yet-ended requests; ends decrement it', () => {
    const tracker = new UsageTracker();
    const id1 = tracker.recordRequestStart({ model: 'm', stream: false, promptChars: 5 });
    tracker.recordRequestStart({ model: 'm', stream: false, promptChars: 5 });
    expect(tracker.inFlightCount()).toBe(2);
    tracker.recordRequestEnd({ id: id1, ok: true, completionChars: 3 });
    expect(tracker.inFlightCount()).toBe(1);
    expect(tracker.snapshot().lifetime.requests).toBe(2); // tracking unchanged
  });
});

describe('SessionQueue global waiting counter (Task 14)', () => {
  it('counts requests waiting behind a busy lane; decrements when they start+finish', async () => {
    const q = new SessionQueue();
    let releaseFn!: () => void;
    const gate = new Promise<void>((r) => (releaseFn = r));
    void q.run('k1', async () => {
      await gate;
      return 'first';
    });
    // Two requests queued behind the busy lane.
    const p2 = q.run('k1', async () => 'second');
    const p3 = q.run('k1', async () => 'third');
    const pOther = q.run('other', async () => 'independent'); // different lane: not waiting
    await new Promise((r) => setTimeout(r, 20));
    expect(SessionQueue.globalWaitingCount()).toBe(2);
    releaseFn();
    expect(await p2).toBe('second');
    expect(await p3).toBe('third');
    expect(await pOther).toBe('independent');
    expect(SessionQueue.globalWaitingCount()).toBe(0);
  });
});
