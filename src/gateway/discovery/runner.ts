/**
 * Browser runner for live model discovery.
 *
 * SAFETY RULES enforced here:
 *  - the provider's OWN profile is used (the same one the drivers use), so
 *    the discovery sees exactly what the user sees;
 *  - a second browser is NEVER opened on a profile that is already in use:
 *    the ownership ledger is consulted, the in-process driver state is
 *    consulted, and Chrome's own profile lock is the final gate;
 *  - the browser runs HEADLESS, so no window appears and the user's active
 *    chat tab is never touched;
 *  - no message is ever sent, no cookie is written, no logout happens;
 *  - the profile lock is released as soon as the scan ends.
 */
import { chromium, type BrowserContext, type Page } from 'playwright';
import { OwnershipLedger } from '../../sessions/ownership-ledger.js';
import { cleanupStaleProfileLocks } from '../../browser/manager.js';
import { getDiscoveryAdapter } from './adapters.js';
import { discoverModelsFromDom } from './dom-strategy.js';
import { discoverModelsFromNetwork, type CapturedResponse } from './network-strategy.js';
import { discoverModelsFromEmbeddedCatalog } from './embedded-strategy.js';
import type {
  DiscoveryPage,
  ModelDiscoveryResult,
  WebModelDiscoveryAdapter,
} from './types.js';

export interface DiscoverySessionOptions {
  providerId: string;
  /** The persistent Chrome profile directory for this provider. */
  userDataDir: string;
  /** True when the provider's driver currently holds the profile in-process. */
  driverRunning?: boolean;
  /**
   * Run the browser headless. Defaults to the provider's own setting —
   * some providers refuse a headless browser (CDN challenge), so a provider
   * configured as headful must be scanned headful.
   */
  headless?: boolean;
  /** How long the whole session may take. */
  timeoutMs?: number;
  /** How long the page may take to render before the picker is looked for. */
  settleMs?: number;
  signal?: AbortSignal;
  now?: () => number;
  /** Executable override (tests / environments with a custom browser). */
  executablePath?: string;
  /** Use the installed Google Chrome channel (matches the drivers). */
  useChromeChannel?: boolean;
}

export interface DiscoverySessionResult {
  providerId: string;
  result: ModelDiscoveryResult;
  captured: CapturedResponse[];
}

/** Pluggable so unit tests never touch a real browser or profile. */
export interface DiscoveryRunner {
  run(options: DiscoverySessionOptions): Promise<DiscoverySessionResult>;
}

/** Wraps a Playwright page in the narrow surface the adapters need. */
function wrapPage(page: Page): DiscoveryPage {
  return {
    raw: page,
    goto: async (url, opts) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts?.timeout ?? 45_000 });
    },
    url: () => page.url(),
    title: () => page.title(),
    locator: (selector: string) => {
      const loc = page.locator(selector);
      return {
        count: () => loc.count(),
        first: () => wrapLocator(loc.first()),
        nth: (index: number) => wrapLocator(loc.nth(index)),
        all: async () => (await loc.all()).map(wrapLocator),
        locator: (childSelector: string) => wrapLocator(loc.first().locator(childSelector)),
        click: (opts) => loc.click(opts as any),
        isVisible: () => loc.first().isVisible(),
        textContent: () => loc.first().textContent(),
        getAttribute: (name: string) => loc.first().getAttribute(name),
        waitFor: (opts) => loc.first().waitFor(opts as any),
        evaluate: (fn: any, arg?: any) => loc.first().evaluate(fn as any, arg),
      };
    },
    waitForTimeout: (ms: number) => page.waitForTimeout(ms),
    content: () => page.content(),
    evaluate: (fn: any, arg?: any) => page.evaluate(fn as any, arg),
  };
}

function wrapLocator(loc: any) {
  return {
    count: () => loc.count(),
    first: () => wrapLocator(loc.first()),
    nth: (index: number) => wrapLocator(loc.nth(index)),
    all: async () => (await loc.all()).map(wrapLocator),
    locator: (childSelector: string) => wrapLocator(loc.locator(childSelector)),
    click: (opts: any) => loc.click(opts),
    isVisible: () => loc.isVisible(),
    textContent: () => loc.textContent(),
    getAttribute: (name: string) => loc.getAttribute(name),
    waitFor: (opts: any) => loc.waitFor(opts),
    evaluate: (fn: any, arg?: any) => loc.evaluate(fn, arg),
  };
}

/** The real runner: headless Chrome on the provider's own profile. */
export class PlaywrightDiscoveryRunner implements DiscoveryRunner {
  private readonly ledger: OwnershipLedger;

  constructor(opts: { ledger?: OwnershipLedger } = {}) {
    this.ledger = opts.ledger ?? new OwnershipLedger();
  }

  async run(options: DiscoverySessionOptions): Promise<DiscoverySessionResult> {
    const now = options.now ?? Date.now;
    const adapter = getDiscoveryAdapter(options.providerId);
    const fail = (
      reason: ModelDiscoveryResult['failureReason'],
      detail: string,
    ): DiscoverySessionResult => ({
      providerId: options.providerId,
      captured: [],
      result: {
        providerId: options.providerId,
        source: 'none',
        complete: false,
        discoveredAt: new Date(now()).toISOString(),
        models: [],
        failureReason: reason,
        detail,
      },
    });

    if (!adapter) {
      return fail('discovery_unsupported', `No discovery adapter is registered for "${options.providerId}".`);
    }
    if (!options.userDataDir) {
      return fail('discovery_unsupported', 'No browser profile is configured for this provider.');
    }

    // 1. Never fight another gateway instance (or our own live driver) for
    //    the profile: the ownership ledger is exclusive.
    const profileDir = options.userDataDir;
    const ownerId = `discovery-${process.pid}`;
    let claim: { status: string; owner?: any; staleHeartbeat?: boolean } | null = null;
    try {
      claim = await this.ledger.claimProfile(profileDir, ownerId, `ep-${now()}`);
    } catch {
      claim = null;
    }
    if (claim && claim.status === 'busy') {
      return fail(
        'deferred',
        `The profile is owned by another session (pid ${claim.owner?.pid ?? 'unknown'}) — the scan was postponed.`,
      );
    }

    // 2. Never open a second browser on a profile this process is already using.
    if (options.driverRunning) {
      try {
        await this.ledger.releaseProfile(profileDir, ownerId).catch(() => {});
      } catch {}
      return fail(
        'deferred',
        'The provider driver currently holds this browser profile — the scan was postponed to avoid disturbing the live session.',
      );
    }

    // 3. Launch headless on the provider's own profile.
    cleanupStaleProfileLocks(profileDir);
    const captured: CapturedResponse[] = [];
    let ctx: BrowserContext | null = null;
    try {
      const launchOptions: Record<string, unknown> = {
        headless: options.headless !== false,
        viewport: { width: 1440, height: 900 },
        args: ['--disable-blink-features=AutomationControlled'],
        ignoreDefaultArgs: ['--enable-automation'],
      };
      if (options.executablePath) launchOptions.executablePath = options.executablePath;
      else if (options.useChromeChannel !== false) launchOptions.channel = 'chrome';

      ctx = await chromium.launchPersistentContext(profileDir, launchOptions as any);
    } catch (e) {
      const message = (e as Error).message;
      const locked = /ProcessSingleton|existing browser session|Opening in existing|profile.*lock|SingletonLock/i.test(message);
      return fail(
        locked ? 'deferred' : 'provider_unavailable',
        locked
          ? 'The browser profile is currently open in another Chrome instance — the scan was postponed.'
          : `Could not start the browser for discovery: ${message.split('\n')[0]}`,
      );
    }

    try {
      const page = ctx.pages()[0] || (await ctx.newPage());
      page.on('response', (res) => {
        void (async () => {
          try {
            const url = res.url();
            const ct = res.headers()['content-type'] || '';
            if (!/json|text|javascript/i.test(ct)) return;
            if (res.status() >= 400) return;
            const body = await res.text().catch(() => '');
            if (!body || body.length > 8_000_000) return;
            captured.push({ url, status: res.status(), body, contentType: ct });
          } catch {
            /* ignore */
          }
        })();
      });

      await page.goto(adapter.entryUrl, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs ?? 45_000 });
      // The chat UIs are SPAs — give them time to render the composer and the
      // model control before the picker is looked for.
      await page.waitForTimeout(options.settleMs ?? 9000);

      // A CDN challenge page means the provider refused the browser session.
      const title = (await page.title().catch(() => '')) || '';
      if (/just a moment|attention required|checking your browser/i.test(title)) {
        return {
          providerId: options.providerId,
          captured,
          result: {
            providerId: options.providerId,
            source: 'none',
            complete: false,
            discoveredAt: new Date(now()).toISOString(),
            models: [],
            failureReason: 'provider_unavailable',
            detail:
              'The provider showed an anti-bot challenge page. Run the provider without headless mode so the browser behaves like a normal session.',
          },
        };
      }

      const discoveryPage = wrapPage(page);
      const ctxArgs = {
        page: discoveryPage,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        settleMs: 2500,
        now,
      };

      let best: ModelDiscoveryResult | null = null;
      let bestStable = -1;
      const failures: ModelDiscoveryResult[] = [];

      for (const strategy of adapter.strategies) {
        if (options.signal?.aborted) break;
        let attempt: ModelDiscoveryResult | null = null;
        if (strategy === 'dom' && adapter.dom) {
          attempt = await discoverModelsFromDom(options.providerId, adapter.dom, ctxArgs);
        } else if (strategy === 'network' && adapter.network && adapter.network.urlPatterns.length > 0) {
          attempt = await discoverModelsFromNetwork(options.providerId, adapter.network, ctxArgs, captured);
        } else if (strategy === 'embedded' && adapter.embedded) {
          attempt = await discoverModelsFromEmbeddedCatalog(options.providerId, adapter.embedded, ctxArgs);
        }
        if (!attempt) continue;

        if (attempt.failureReason) {
          failures.push(attempt);
          continue;
        }
        // A result with STABLE ids is strictly better than one that only has
        // display names (only those can be executed by the driver).
        const stable = attempt.models.filter((m) => m.identityConfidence === 'stable-id' && m.providerModelId).length;
        if (stable > bestStable) {
          bestStable = stable;
          best = attempt;
        }
      }

      // No strategy succeeded -> report the most specific failure.
      if (!best) {
        const specific = failures.find((f) => f.failureReason !== 'model_picker_not_found');
        const chosen = specific || failures[0];
        if (chosen) return { providerId: options.providerId, captured, result: chosen };
      }

      const result: ModelDiscoveryResult = best ?? {
        providerId: options.providerId,
        source: 'none',
        complete: false,
        discoveredAt: new Date(now()).toISOString(),
        models: [],
        failureReason: 'discovery_unsupported',
        detail: 'No discovery strategy produced a result for this provider.',
      };

      return { providerId: options.providerId, result, captured };
    } catch (e) {
      const message = (e as Error).message || String(e);
      const timedOut = /timeout/i.test(message);
      return {
        providerId: options.providerId,
        captured,
        result: {
          providerId: options.providerId,
          source: 'none',
          complete: false,
          discoveredAt: new Date(now()).toISOString(),
          models: [],
          failureReason: timedOut ? 'timeout' : 'provider_unavailable',
          detail: timedOut ? 'The provider page did not load in time.' : `Discovery failed: ${message.split('\n')[0]}`,
        },
      };
    } finally {
      try { await ctx?.close(); } catch {}
      // Release the profile claim so other work (and later scans) can use it.
      try { await this.ledger.releaseProfile(profileDir, ownerId).catch(() => {}); } catch {}
    }
  }
}
