import { describe, it, expect } from 'vitest';
import { BulkJobRunner } from '../../../src/gateway/discovery/job-runner.js';

describe('Bulk job runner (scan everything)', () => {
  it('runs every provider in turn and reports the progress', async () => {
    const seen: string[] = [];
    const runner = new BulkJobRunner({
      runOne: async (id) => {
        seen.push(id);
        return { ok: id !== 'b', status: id === 'b' ? 'failed' : 'discovered', models: 3 };
      },
      now: () => 1_700_000_000_000,
    });
    const job = runner.start('discover', ['a', 'b', 'c']);
    expect(job.running).toBe(true);
    expect(job.total).toBe(3);
    // Wait for the job to finish.
    for (let i = 0; i < 50 && runner.isRunning(); i++) await new Promise((r) => setTimeout(r, 5));
    const done = runner.get()!;
    expect(done.running).toBe(false);
    expect(done.done).toBe(3);
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(done.results.map((r) => r.providerId)).toEqual(['a', 'b', 'c']);
    expect(done.results.filter((r) => !r.ok)).toHaveLength(1);
    expect(done.finishedAt).toBeTruthy();
  });

  it('never lets one provider break the whole sweep', async () => {
    const runner = new BulkJobRunner({
      runOne: async (id) => {
        if (id === 'x') throw new Error('boom');
        return { ok: true, status: 'discovered' };
      },
      now: () => 1_700_000_000_000,
    });
    runner.start('connect', ['x', 'y']);
    for (let i = 0; i < 50 && runner.isRunning(); i++) await new Promise((r) => setTimeout(r, 5));
    const done = runner.get()!;
    expect(done.done).toBe(2);
    expect(done.results[0].ok).toBe(false);
    expect(done.results[0].detail).toContain('boom');
    expect(done.results[1].ok).toBe(true);
  });

  it('does not start a second job while one is running', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const runner = new BulkJobRunner({
      runOne: async () => {
        await gate;
        return { ok: true, status: 'discovered' };
      },
      now: () => 1_700_000_000_000,
    });
    const first = runner.start('discover', ['a']);
    const second = runner.start('discover', ['b']);
    expect(second.id).toBe(first.id);
    expect(second.total).toBe(1);
    release?.();
    for (let i = 0; i < 50 && runner.isRunning(); i++) await new Promise((r) => setTimeout(r, 5));
  });
});
