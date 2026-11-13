import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { loadConfig } from '../config.js';
import type { Config } from '../types.js';

export interface PersistentBrowserLauncher {
  launchPersistentContext(
    userDataDir: string,
    options?: Record<string, unknown>
  ): Promise<BrowserContext>;
}

/**
 * Cleans up stale Chrome Singleton locks in a profile directory if the owning process is no longer running.
 */
export function cleanupStaleProfileLocks(userDataDir: string): void {
  try {
    if (!userDataDir) return;
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
      return;
    }
    const lockPath = path.join(userDataDir, 'SingletonLock');
    if (fs.existsSync(lockPath) || fs.lstatSync(lockPath, { throwIfNoEntry: false })) {
      try {
        const target = fs.readlinkSync(lockPath);
        const match = target.match(/-(\d+)$/);
        if (match) {
          const pid = parseInt(match[1], 10);
          try {
            process.kill(pid, 0); // Check if process is alive
          } catch {
            // Process is dead, remove stale locks
            fs.rmSync(lockPath, { force: true });
            fs.rmSync(path.join(userDataDir, 'SingletonCookie'), { force: true });
            fs.rmSync(path.join(userDataDir, 'SingletonSocket'), { force: true });
          }
        }
      } catch {
        // If readlink fails or stat fails, remove dangling link safely
        fs.rmSync(lockPath, { force: true });
      }
    }
  } catch {
    // Ignore any filesystem inspection error
  }
}

/**
 * Manages the persistent Chrome browser profile and browser contexts for Arena WebBridge.
 */
export class BrowserManager {
  public readonly config: Config;
  private launcher: PersistentBrowserLauncher;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private initPromise: Promise<Page> | null = null;

  constructor(
    config?: Partial<Config>,
    launcher: PersistentBrowserLauncher = chromium
  ) {
    this.config = loadConfig(config);
    this.launcher = launcher;

    // Ensure persistent profile directory exists recursively
    if (!fs.existsSync(this.config.userDataDir)) {
      fs.mkdirSync(this.config.userDataDir, { recursive: true });
    }
  }

  /**
   * Returns the currently active BrowserContext or null if not running.
   */
  public getContext(): BrowserContext | null {
    return this.context;
  }

  /**
   * Cleans up stale Chrome Singleton locks if the owning process is no longer running.
   */
  private cleanupStaleLocks(): void {
    cleanupStaleProfileLocks(this.config.userDataDir);
  }

  /**
   * Internal helper to launch a persistent browser context.
   * Attempts to use the installed Google Chrome channel first, falling back to bundled chromium.
   */
  private async launchContext(headless: boolean): Promise<BrowserContext> {
    if (!fs.existsSync(this.config.userDataDir)) {
      fs.mkdirSync(this.config.userDataDir, { recursive: true });
    }

    this.cleanupStaleLocks();

    const baseOptions: Record<string, unknown> = {
      headless,
      viewport: { width: 1280, height: 800 },
      args: ['--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation'],
    };

    let context: BrowserContext;
    try {
      context = await this.launcher.launchPersistentContext(this.config.userDataDir, {
        ...baseOptions,
        channel: 'chrome',
      });
    } catch {
      // Fallback to standard chromium if Chrome channel is not found or fails
      context = await this.launcher.launchPersistentContext(
        this.config.userDataDir,
        baseOptions
      );
    }

    this.context = context;

    context.once('close', () => {
      if (this.context === context) {
        this.context = null;
        this.page = null;
      }
    });

    return context;
  }

  /**
   * Gets an existing open page, or creates a new one.
   * If the context is not running or has crashed, launches a new persistent context.
   */
  public async getOrCreatePage(): Promise<Page> {
    // Check if existing context and page are alive and valid
    if (this.context && this.page && !this.page.isClosed()) {
      try {
        this.context.pages();
        return this.page;
      } catch {
        this.context = null;
        this.page = null;
      }
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        // If context is alive, check if any open page exists or create a new page
        if (this.context) {
          try {
            const pages = this.context.pages().filter((p) => !p.isClosed());
            if (pages.length > 0) {
              this.page = pages[0];
              return this.page;
            }
            this.page = await this.context.newPage();
            return this.page;
          } catch {
            this.context = null;
            this.page = null;
          }
        }

        // Launch new context using configured headless setting
        const context = await this.launchContext(this.config.headless);
        const pages = context.pages().filter((p) => !p.isClosed());
        this.page = pages.length > 0 ? pages[0] : await context.newPage();
        return this.page;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Launches an interactive non-headless Chrome window to allow the user
   * to complete login or Cloudflare verification, and waits until the window is closed.
   */
  public async launchLogin(targetUrl?: string): Promise<void> {
    // If context is already open, close it first to allow interactive non-headless session
    if (this.context) {
      await this.close();
    }

    const context = await this.launchContext(false);
    const pages = context.pages().filter((p) => !p.isClosed());
    const page = pages.length > 0 ? pages[0] : await context.newPage();
    this.page = page;

    try {
      const url = targetUrl || this.config.arenaBaseUrl;
      await page.goto(url);

      // Keep browser open until user closes the window or exit signal is received
      await new Promise<void>((resolve) => {
        let resolved = false;
        const onDone = () => {
          if (!resolved) {
            resolved = true;
            process.removeListener('SIGINT', onDone);
            process.removeListener('SIGTERM', onDone);
            resolve();
          }
        };

        process.once('SIGINT', onDone);
        process.once('SIGTERM', onDone);
        context.once('close', onDone);

        page.once('close', () => {
          // If no more open pages remain in context, resolve
          try {
            const remaining = context.pages().filter((p) => !p.isClosed());
            if (remaining.length === 0) {
              onDone();
            }
          } catch {
            onDone();
          }
        });
      });
    } finally {
      // Flush cookies/session to disk and ensure clean context state
      await this.close();
    }
  }

  /**
   * Closes the active browser context and cleans up references.
   */
  public async close(): Promise<void> {
    if (this.context) {
      const ctx = this.context;
      this.context = null;
      this.page = null;
      try {
        await ctx.close();
      } catch {
        // Ignore any errors during context close
      }
    }
  }
}
