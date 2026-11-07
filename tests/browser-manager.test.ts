import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BrowserContext, Page } from 'playwright';
import { BrowserManager } from '../src/browser/manager.js';
import { BrowserManager as ExportedBrowserManager } from '../src/index.js';
import type { Config } from '../src/types.js';

class MockPage extends EventEmitter {
  private _closed = false;
  public gotoUrl: string | null = null;

  isClosed(): boolean {
    return this._closed;
  }

  async goto(url: string): Promise<null> {
    this.gotoUrl = url;
    return null;
  }

  async close(): Promise<void> {
    this._closed = true;
    this.emit('close', this);
  }
}

class MockBrowserContext extends EventEmitter {
  private _closed = false;
  public pagesList: MockPage[] = [];

  constructor() {
    super();
    this.pagesList.push(new MockPage());
  }

  pages(): Page[] {
    if (this._closed) {
      throw new Error('Target page, context or browser has been closed');
    }
    return this.pagesList as unknown as Page[];
  }

  async newPage(): Promise<Page> {
    if (this._closed) {
      throw new Error('Target page, context or browser has been closed');
    }
    const p = new MockPage();
    this.pagesList.push(p);
    return p as unknown as Page;
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    for (const p of this.pagesList) {
      if (!p.isClosed()) {
        await p.close();
      }
    }
    this.emit('close');
  }
}

describe('BrowserManager', () => {
  let tempDir: string;
  let mockLauncher: {
    launchPersistentContext: ReturnType<typeof vi.fn>;
  };
  let activeContext: MockBrowserContext;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `arena-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    activeContext = new MockBrowserContext();
    mockLauncher = {
      launchPersistentContext: vi.fn().mockImplementation(async () => {
        activeContext = new MockBrowserContext();
        return activeContext as unknown as BrowserContext;
      }),
    };
  });

  afterEach(async () => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Initialization and Profile Directory', () => {
    it('is exported from index.ts', () => {
      expect(ExportedBrowserManager).toBe(BrowserManager);
    });

    it('creates userDataDir recursively if it does not exist', () => {
      const profilePath = path.join(tempDir, 'nested', 'profile');
      expect(fs.existsSync(profilePath)).toBe(false);

      const manager = new BrowserManager(
        { userDataDir: profilePath },
        mockLauncher as any
      );

      expect(fs.existsSync(profilePath)).toBe(true);
      expect(manager.config.userDataDir).toBe(profilePath);
    });

    it('uses default config when no config options provided', () => {
      const manager = new BrowserManager(undefined, mockLauncher as any);
      expect(manager.config.port).toBe(8989);
      expect(manager.config.arenaBaseUrl).toBe('https://arena.ai');
      expect(manager.config.headless).toBe(true);
      expect(manager.getContext()).toBeNull();
    });
  });

  describe('Launch Options and Fallback', () => {
    it('launches persistent context with Chrome channel, headless, viewport, and args', async () => {
      const profilePath = path.join(tempDir, 'profile');
      const manager = new BrowserManager(
        { userDataDir: profilePath, headless: true },
        mockLauncher as any
      );

      await manager.getOrCreatePage();

      expect(mockLauncher.launchPersistentContext).toHaveBeenCalledTimes(1);
      const [launchPath, options] = mockLauncher.launchPersistentContext.mock.calls[0];
      expect(launchPath).toBe(profilePath);
      expect(options).toMatchObject({
        channel: 'chrome',
        headless: true,
        viewport: { width: 1280, height: 800 },
        args: expect.arrayContaining(['--disable-blink-features=AutomationControlled']),
      });
    });

    it('falls back to standard chromium if channel chrome fails to launch', async () => {
      const profilePath = path.join(tempDir, 'profile');
      let attempts = 0;
      mockLauncher.launchPersistentContext.mockImplementation(async (_dir: string, opts: any) => {
        attempts++;
        if (opts?.channel === 'chrome') {
          throw new Error("Executable doesn't exist at /Applications/Google Chrome.app/...");
        }
        activeContext = new MockBrowserContext();
        return activeContext as unknown as BrowserContext;
      });

      const manager = new BrowserManager(
        { userDataDir: profilePath },
        mockLauncher as any
      );

      const page = await manager.getOrCreatePage();
      expect(page).toBeDefined();
      expect(attempts).toBe(2);
      expect(mockLauncher.launchPersistentContext).toHaveBeenNthCalledWith(
        1,
        profilePath,
        expect.objectContaining({ channel: 'chrome' })
      );
      expect(mockLauncher.launchPersistentContext).toHaveBeenNthCalledWith(
        2,
        profilePath,
        expect.not.objectContaining({ channel: 'chrome' })
      );
    });
  });

  describe('getOrCreatePage', () => {
    it('returns a page and reuses open page on consecutive calls', async () => {
      const manager = new BrowserManager({ userDataDir: tempDir }, mockLauncher as any);

      const page1 = await manager.getOrCreatePage();
      expect(page1).toBeDefined();
      expect(mockLauncher.launchPersistentContext).toHaveBeenCalledTimes(1);

      const page2 = await manager.getOrCreatePage();
      expect(page2).toBe(page1);
      expect(mockLauncher.launchPersistentContext).toHaveBeenCalledTimes(1);
    });

    it('creates a new page in existing context if current page is closed', async () => {
      const manager = new BrowserManager({ userDataDir: tempDir }, mockLauncher as any);

      const page1 = await manager.getOrCreatePage();
      await page1.close();
      expect(page1.isClosed()).toBe(true);

      const page2 = await manager.getOrCreatePage();
      expect(page2).not.toBe(page1);
      expect(page2.isClosed()).toBe(false);
      // Context should still be reused, not relaunched
      expect(mockLauncher.launchPersistentContext).toHaveBeenCalledTimes(1);
    });

    it('re-launches context and creates new page if context crashed or was closed', async () => {
      const manager = new BrowserManager({ userDataDir: tempDir }, mockLauncher as any);

      const page1 = await manager.getOrCreatePage();
      expect(manager.getContext()).not.toBeNull();

      // Simulate context crash/close
      await manager.getContext()!.close();

      const page2 = await manager.getOrCreatePage();
      expect(page2).toBeDefined();
      expect(mockLauncher.launchPersistentContext).toHaveBeenCalledTimes(2);
    });

    it('serializes concurrent getOrCreatePage calls to launch context only once', async () => {
      const manager = new BrowserManager({ userDataDir: tempDir }, mockLauncher as any);

      const [page1, page2, page3] = await Promise.all([
        manager.getOrCreatePage(),
        manager.getOrCreatePage(),
        manager.getOrCreatePage(),
      ]);

      expect(page1).toBeDefined();
      expect(page2).toBe(page1);
      expect(page3).toBe(page1);
      expect(mockLauncher.launchPersistentContext).toHaveBeenCalledTimes(1);
    });
  });

  describe('launchLogin', () => {
    it('launches persistent context with headless: false and navigates to targetUrl', async () => {
      const manager = new BrowserManager(
        { userDataDir: tempDir, arenaBaseUrl: 'https://arena.ai' },
        mockLauncher as any
      );

      // launchLogin will wait until context or page closes
      const loginPromise = manager.launchLogin('https://custom-target.com');

      // Allow microtasks to run
      await new Promise((r) => setTimeout(r, 10));

      const [_, options] = mockLauncher.launchPersistentContext.mock.calls[0];
      expect(options.headless).toBe(false);

      const page = (await manager.getOrCreatePage()) as unknown as MockPage;
      expect(page.gotoUrl).toBe('https://custom-target.com');

      // Close the context to let launchLogin finish
      await manager.close();
      await loginPromise;
      expect(manager.getContext()).toBeNull();
    });

    it('flushes and closes browser context cleanly in finally block when login finishes', async () => {
      const manager = new BrowserManager({ userDataDir: tempDir }, mockLauncher as any);
      const closeSpy = vi.spyOn(manager, 'close');

      const loginPromise = manager.launchLogin();
      await new Promise((r) => setTimeout(r, 10));

      await manager.close();
      await loginPromise;

      expect(closeSpy).toHaveBeenCalled();
      expect(manager.getContext()).toBeNull();
    });

    it('uses arenaBaseUrl as default url if targetUrl not provided', async () => {
      const manager = new BrowserManager(
        { userDataDir: tempDir, arenaBaseUrl: 'https://arena.ai/default' },
        mockLauncher as any
      );

      const loginPromise = manager.launchLogin();
      await new Promise((r) => setTimeout(r, 10));

      const page = (await manager.getOrCreatePage()) as unknown as MockPage;
      expect(page.gotoUrl).toBe('https://arena.ai/default');

      await manager.close();
      await loginPromise;
    });

    it('closes any existing context before launching login context in non-headless mode', async () => {
      const manager = new BrowserManager(
        { userDataDir: tempDir, headless: true },
        mockLauncher as any
      );

      // Open initial headless page
      await manager.getOrCreatePage();
      expect(mockLauncher.launchPersistentContext).toHaveBeenCalledTimes(1);

      // Now launch login
      const loginPromise = manager.launchLogin();
      await new Promise((r) => setTimeout(r, 10));

      expect(mockLauncher.launchPersistentContext).toHaveBeenCalledTimes(2);
      const [, secondLaunchOpts] = mockLauncher.launchPersistentContext.mock.calls[1];
      expect(secondLaunchOpts.headless).toBe(false);

      await manager.close();
      await loginPromise;
    });

    it('resolves when page is closed by user', async () => {
      const manager = new BrowserManager({ userDataDir: tempDir }, mockLauncher as any);
      const loginPromise = manager.launchLogin();
      await new Promise((r) => setTimeout(r, 10));

      const page = await manager.getOrCreatePage();
      await page.close();

      await expect(loginPromise).resolves.toBeUndefined();
    });
  });

  describe('close and getContext', () => {
    it('getContext returns null when not running, and active context when running', async () => {
      const manager = new BrowserManager({ userDataDir: tempDir }, mockLauncher as any);
      expect(manager.getContext()).toBeNull();

      await manager.getOrCreatePage();
      expect(manager.getContext()).not.toBeNull();

      await manager.close();
      expect(manager.getContext()).toBeNull();
    });

    it('close can be called safely multiple times without errors', async () => {
      const manager = new BrowserManager({ userDataDir: tempDir }, mockLauncher as any);
      await expect(manager.close()).resolves.toBeUndefined();

      await manager.getOrCreatePage();
      await expect(manager.close()).resolves.toBeUndefined();
      await expect(manager.close()).resolves.toBeUndefined();
      expect(manager.getContext()).toBeNull();
    });
  });
});
