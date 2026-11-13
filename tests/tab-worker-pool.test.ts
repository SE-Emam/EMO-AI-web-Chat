import { describe, it, expect, vi } from 'vitest';
import { TabWorkerPool } from '../src/arena/tab-worker-pool.js';
import type { BrowserContext, Page } from 'playwright';

describe('TabWorkerPool', () => {
  const createMockContext = () => {
    let pageCount = 0;
    const pages: any[] = [];

    const mockContext: any = {
      newPage: vi.fn().mockImplementation(async () => {
        pageCount++;
        const p: any = {
          id: pageCount,
          isClosed: vi.fn().mockReturnValue(false),
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
  };

  it('acquires and creates tabs up to maxTabs limit', async () => {
    const { mockContext } = createMockContext();
    const pool = new TabWorkerPool(mockContext, { maxTabs: 2 });

    const tab1 = await pool.acquire('https://test.ai');
    expect(tab1.id).toBe('tab-1');
    expect(pool.activeCount).toBe(1);

    const tab2 = await pool.acquire('https://test.ai');
    expect(tab2.id).toBe('tab-2');
    expect(pool.activeCount).toBe(2);
    expect(pool.totalCount).toBe(2);

    // Releasing tab1 returns it to the pool
    pool.release(tab1.page);
    expect(pool.activeCount).toBe(1);
    expect(pool.idleCount).toBe(1);

    // Next acquire should reuse tab1
    const tab3 = await pool.acquire('https://test.ai');
    expect(tab3.id).toBe('tab-1');
    expect(pool.activeCount).toBe(2);
  });

  it('queues callers when all tabs are busy and resolves upon release', async () => {
    const { mockContext } = createMockContext();
    const pool = new TabWorkerPool(mockContext, { maxTabs: 1 });

    const tab1 = await pool.acquire();
    expect(pool.activeCount).toBe(1);

    let resolvedTab2: any = null;
    const promise2 = pool.acquire().then((t) => {
      resolvedTab2 = t;
    });

    expect(resolvedTab2).toBeNull();

    // Release tab1
    pool.release(tab1.page);
    await promise2;

    expect(resolvedTab2).not.toBeNull();
    expect(resolvedTab2.page).toBe(tab1.page);
  });

  it('triggers auto-compaction and session reset when turn count exceeds threshold', async () => {
    const { mockContext } = createMockContext();
    const pool = new TabWorkerPool(mockContext, { maxTabs: 1, autoCompactThresholdTurns: 2 });

    const tab = await pool.acquire('https://chat.ai');
    expect(tab.turnCount).toBe(1);

    pool.release(tab.page);

    // Turn 2
    const tabAgain = await pool.acquire('https://chat.ai');
    expect(tabAgain.turnCount).toBe(2);

    pool.release(tabAgain.page);

    // Turn 3: Should trigger compaction reset
    const tabCompacted = await pool.acquire('https://chat.ai');
    expect(tabCompacted.turnCount).toBe(1);
    expect(tabCompacted.page.goto).toHaveBeenCalledTimes(2); // Initial + reset
  });

  it('closes all active and idle tabs cleanly', async () => {
    const { mockContext } = createMockContext();
    const pool = new TabWorkerPool(mockContext, { maxTabs: 3 });

    const tab1 = await pool.acquire();
    const tab2 = await pool.acquire();
    pool.release(tab1.page);

    await pool.closeAll();
    expect(pool.totalCount).toBe(0);
  });
});
