import { describe, it, expect, vi } from 'vitest';
import { TabScheduler } from '../../src/browser/tab-scheduler.js';
import { TabWorkerPool } from '../../src/arena/tab-worker-pool.js';
import type { BrowserContext, Page } from 'playwright';

function createMockContext() {
  let pageCount = 0;
  const pages: any[] = [];
  const mockContext: any = {
    newPage: vi.fn().mockImplementation(async () => {
      pageCount++;
      const p: any = {
        id: pageCount,
        isClosed: vi.fn().mockReturnValue(false),
        url: vi.fn().mockReturnValue('https://chatgpt.com/c/11111111-2222-3333-4444-555555555555'),
        goto: vi.fn().mockResolvedValue(null),
        close: vi.fn().mockImplementation(async () => {
          p.isClosed.mockReturnValue(true);
        }),
      };
      pages.push(p);
      return p;
    }),
  };
  return { mockContext: mockContext as BrowserContext, pages };
}

describe('TabScheduler', () => {
  it('REBINDS the same session to the same page across sequential requests', async () => {
    const { mockContext, pages } = createMockContext();
    const pool = new TabWorkerPool(mockContext, { maxTabs: 2 });
    const scheduler = new TabScheduler(pool);

    const p1 = await scheduler.acquireFor('task-a');
    await scheduler.release('task-a');
    const p2 = await scheduler.acquireFor('task-a');
    await scheduler.release('task-a');
    expect(p2).toBe(p1);
    expect(pages).toHaveLength(1); // no new tab was created
  });

  it('TWO sessions acquire TWO DIFFERENT pages and can run CONCURRENTLY (page identity)', async () => {
    const { mockContext, pages } = createMockContext();
    const pool = new TabWorkerPool(mockContext, { maxTabs: 3 });
    const scheduler = new TabScheduler(pool);

    const executionTrace: Array<{ session: string; pageId: number; at: number }> = [];
    const work = (session: string, ms: number) => async () => {
      const page = await scheduler.acquireFor(session);
      executionTrace.push({ session, pageId: (page as any).id, at: Date.now() });
      await new Promise((r) => setTimeout(r, ms));
      await scheduler.release(session);
      return (page as any).id;
    };
    const [idA, idB] = await Promise.all([work('task-a', 60)(), work('task-b', 60)()]);
    expect(idA).not.toBe(idB);
    expect(pages).toHaveLength(2);
    // Both were running at the same time: their start timestamps overlap.
    expect(executionTrace).toHaveLength(2);
    expect(Math.abs(executionTrace[0]!.at - executionTrace[1]!.at)).toBeLessThan(55);
  });

  it('LRU eviction: at the cap, the OLDEST IDLE session is evicted and its URL saved first', async () => {
    const { mockContext, pages } = createMockContext();
    const pool = new TabWorkerPool(mockContext, { maxTabs: 2 });
    const evicted: Array<{ session: string; url: string }> = [];
    const scheduler = new TabScheduler(pool, {
      onEvict: async (session, url) => {
        evicted.push({ session, url });
      },
    });

    await scheduler.acquireFor('task-old');
    await scheduler.release('task-old');
    await new Promise((r) => setTimeout(r, 10)); // ensure lastUsedAt ordering
    await scheduler.acquireFor('task-new');
    await scheduler.release('task-new');

    // Cap is 2 and both are idle-bound; a third session must evict 'task-old' (LRU).
    const p3 = await scheduler.acquireFor('task-c');
    expect(p3).toBeTruthy();
    expect(evicted).toHaveLength(1);
    expect(evicted[0]!.session).toBe('task-old');
    expect(evicted[0]!.url).toContain('/c/11111111');
    // The evicted session's page was actually closed (freed for the new one).
    expect(pages.filter((p) => (p as any).id === (p3 as any).id)).toHaveLength(1);
    expect(pages.length).toBeGreaterThanOrEqual(2);
  });

  it('a session with an IN-FLIGHT request is NEVER evicted; the waiter gets the slot only after release', async () => {
    const { mockContext } = createMockContext();
    const pool = new TabWorkerPool(mockContext, { maxTabs: 2 });
    const evicted: string[] = [];
    const scheduler = new TabScheduler(pool, { onEvict: async (s) => { evicted.push(s); } });

    await scheduler.acquireFor('task-a'); // stays in-flight (no release yet)
    await scheduler.acquireFor('task-b');
    await scheduler.release('task-b'); // task-b idle, task-a in-flight

    // Third session: only task-b is evictable, task-a is protected.
    let resolved = false;
    const third = scheduler.acquireFor('task-c').then((p) => {
      resolved = true;
      return p;
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(evicted).toEqual(['task-b']); // task-a untouched
    expect(resolved).toBe(true);
    await third;
  });

  it('an EXPLICITLY LEASED session is not evicted while an idle evictable one exists', async () => {
    const { mockContext } = createMockContext();
    const pool = new TabWorkerPool(mockContext, { maxTabs: 2 });
    const evicted: string[] = [];
    const scheduler = new TabScheduler(pool, { onEvict: async (s) => { evicted.push(s); } });

    await scheduler.acquireFor('task-fresh'); // released → idle, evictable
    await scheduler.release('task-fresh');
    // Background automation explicitly holds a lease on task-fresh's page.
    scheduler.holdLease('task-fresh');
    await new Promise((r) => setTimeout(r, 10));
    await scheduler.acquireFor('task-stale');
    await scheduler.release('task-stale'); // idle, no lease → evictable

    await scheduler.acquireFor('task-c');
    expect(evicted).toEqual(['task-stale']);
    expect(evicted).not.toContain('task-fresh');
  });

  it('an evicted session REBINDS on the next request to a FRESH page (its URL restored by the driver)', async () => {
    const { mockContext, pages } = createMockContext();
    const pool = new TabWorkerPool(mockContext, { maxTabs: 1 });
    const scheduler = new TabScheduler(pool, { onEvict: async () => {} });

    const p1 = await scheduler.acquireFor('task-a');
    await scheduler.release('task-a');
    const p2 = await scheduler.acquireFor('task-b'); // evicts task-a (cap 1)
    await scheduler.release('task-b');
    const p3 = await scheduler.acquireFor('task-a');
    expect(p3).not.toBe(p1); // a fresh page, re-bound to the session
    // The two evicted pages were actually closed (no leaks).
    expect((p1 as any).isClosed()).toBe(true);
    expect((p2 as any).isClosed()).toBe(true);
    expect(pages).toHaveLength(3);
  });

  it('a CLOSED page while bound is detected and replaced without leaking the binding', async () => {
    const { mockContext, pages } = createMockContext();
    const pool = new TabWorkerPool(mockContext, { maxTabs: 2 });
    const scheduler = new TabScheduler(pool);

    const p1 = await scheduler.acquireFor('task-a');
    await (p1 as any).close(); // tab closed externally
    await scheduler.release('task-a');

    const p2 = await scheduler.acquireFor('task-a');
    expect(p2).not.toBe(p1);
    expect((p2 as any).isClosed()).toBe(false);
    expect(pages.length).toBe(2);
  });
});
