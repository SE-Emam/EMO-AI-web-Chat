import { describe, it, expect } from 'vitest';
import { SessionQueue } from '../../src/sessions/session-queue.js';

describe('SessionQueue', () => {
  it('serializes requests for the SAME session key', async () => {
    const q = new SessionQueue();
    const trace: string[] = [];
    const work = (name: string, ms: number) => async () => {
      trace.push(`start:${name}`);
      await new Promise((r) => setTimeout(r, ms));
      trace.push(`end:${name}`);
    };
    await Promise.all([q.run('task-a', work('1', 30)), q.run('task-a', work('2', 10))]);
    expect(trace).toEqual(['start:1', 'end:1', 'start:2', 'end:2']);
  });

  it('runs DIFFERENT session keys in PARALLEL', async () => {
    const q = new SessionQueue();
    const trace: string[] = [];
    const work = (name: string, ms: number) => async () => {
      trace.push(`start:${name}`);
      await new Promise((r) => setTimeout(r, ms));
      trace.push(`end:${name}`);
    };
    await Promise.all([q.run('task-a', work('a', 40)), q.run('task-b', work('b', 10))]);
    // b finished before a's work ended → interleaved, not serialized.
    expect(trace[0]).toBe('start:a');
    expect(trace[1]).toBe('start:b');
    expect(trace[2]).toBe('end:b');
  });

  it('a failing request does not block the next request for the same session', async () => {
    const q = new SessionQueue();
    await expect(q.run('task-a', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const result = await q.run('task-a', async () => 'recovered');
    expect(result).toBe('recovered');
  });

  it('two paths racing for the same session key execute strictly one after the other', async () => {
    const q = new SessionQueue();
    const order: string[] = [];
    const slow = q.run('k', async () => {
      order.push('slow-start');
      await new Promise((r) => setTimeout(r, 50));
      order.push('slow-end');
    });
    const fast = q.run('k', async () => {
      order.push('fast-start');
      order.push('fast-end');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['slow-start', 'slow-end', 'fast-start', 'fast-end']);
  });
});
