import type { BrowserContext, Page } from 'playwright';

export interface TabPoolOptions {
  maxTabs?: number;
  initialUrl?: string;
  autoCompactThresholdTurns?: number;
}

export interface PooledWorkerTab {
  page: Page;
  id: string;
  turnCount: number;
  createdAt: number;
}

/**
 * TabWorkerPool manages concurrent browser pages/tabs within a shared BrowserContext.
 * Enables true parallel request execution across multiple tabs without serialization bottlenecks.
 */
export class TabWorkerPool {
  private readonly context: BrowserContext;
  private readonly maxTabs: number;
  private readonly initialUrl?: string;
  private readonly autoCompactThresholdTurns: number;

  private readonly availableTabs: PooledWorkerTab[] = [];
  private readonly busyTabs = new Map<Page, PooledWorkerTab>();
  private readonly waiters: Array<(tab: PooledWorkerTab) => void> = [];
  private tabCounter = 0;

  constructor(context: BrowserContext, options: TabPoolOptions = {}) {
    this.context = context;
    this.maxTabs = Math.max(1, options.maxTabs || 3);
    this.initialUrl = options.initialUrl;
    this.autoCompactThresholdTurns = options.autoCompactThresholdTurns || 15;
  }

  get activeCount(): number {
    return this.busyTabs.size;
  }

  /** Configured page cap (consumed by TabScheduler's eviction policy). */
  get capacity(): number {
    return this.maxTabs;
  }

  get idleCount(): number {
    return this.availableTabs.length;
  }

  get totalCount(): number {
    return this.busyTabs.size + this.availableTabs.length;
  }

  /**
   * Acquire a worker tab for handling a request.
   */
  async acquire(targetUrl?: string): Promise<PooledWorkerTab> {
    const url = targetUrl || this.initialUrl;

    // 1. Try to reuse an available tab
    while (this.availableTabs.length > 0) {
      const tab = this.availableTabs.pop()!;
      if (!tab.page.isClosed()) {
        // Check if compaction is needed due to excessive conversation length
        if (tab.turnCount >= this.autoCompactThresholdTurns && url) {
          console.log(`[TabWorkerPool] Auto-compacting tab #${tab.id} (turn count: ${tab.turnCount}). Resetting session.`);
          await tab.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
          tab.turnCount = 0;
        }

        this.busyTabs.set(tab.page, tab);
        tab.turnCount++;
        return tab;
      }
    }

    // 2. Spawn a new tab if under limit
    if (this.totalCount < this.maxTabs) {
      this.tabCounter++;
      const page = await this.context.newPage();
      if (url) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      }

      const tab: PooledWorkerTab = {
        page,
        id: `tab-${this.tabCounter}`,
        turnCount: 1,
        createdAt: Date.now(),
      };

      this.busyTabs.set(page, tab);
      return tab;
    }

    // 3. Wait for an in-use tab to be released
    return new Promise<PooledWorkerTab>((resolve) => {
      this.waiters.push((tab) => {
        tab.turnCount++;
        resolve(tab);
      });
    });
  }

  /**
   * Release the worker tab back into the pool.
   */
  release(page: Page) {
    const tab = this.busyTabs.get(page);
    if (!tab) return;

    this.busyTabs.delete(page);

    if (page.isClosed()) {
      return;
    }

    const nextWaiter = this.waiters.shift();
    if (nextWaiter) {
      this.busyTabs.set(page, tab);
      nextWaiter(tab);
    } else {
      this.availableTabs.push(tab);
    }
  }

  /**
   * Close all tabs cleanly.
   */
  async closeAll(): Promise<void> {
    const all = [...this.availableTabs, ...Array.from(this.busyTabs.values())];
    this.availableTabs.length = 0;
    this.busyTabs.clear();

    await Promise.allSettled(
      all.map(async (t) => {
        try {
          if (!t.page.isClosed()) await t.page.close();
        } catch {}
      })
    );
  }
}
