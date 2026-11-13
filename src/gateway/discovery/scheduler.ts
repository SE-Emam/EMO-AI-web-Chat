/**
 * Discovery scheduler — periodic, staggered, restart-safe scanning.
 *
 * Properties:
 *  - providers are scanned one after another (staggered), never all at once;
 *  - a random jitter avoids every provider being hit at the same minute;
 *  - a per-provider timeout bounds every scan;
 *  - a provider that answers with a rate limit / is unavailable is backed off
 *    exponentially instead of being retried immediately;
 *  - a provider whose profile is busy (live user session) is SKIPPED, not
 *    failed — the scan is retried on the next tick;
 *  - the schedule is protected by a CROSS-PROCESS lock, so two gateway
 *    instances never run the same sweep;
 *  - the "last successful scan" time is persisted, so a restart does not
 *    re-scan every provider at once.
 */
import { ProcessLock } from '../../sessions/process-lock.js';
import type { ModelDiscoveryService, ProviderDiscoveryReport } from './service.js';

export interface SchedulerOptions {
  service: ModelDiscoveryService;
  /** Providers to watch. */
  providerIds: string[];
  /** Interval between sweeps (default 12h). */
  intervalMs?: number;
  /** Maximum number of providers scanned concurrently (default 1). */
  concurrency?: number;
  /** Per-provider scan timeout. */
  timeoutMs?: number;
  /** Random spread added to each provider's slot (default 10% of interval). */
  jitterRatio?: number;
  /** Lock that guarantees a single sweep across processes. */
  lock?: ProcessLock;
  /** Lock resource name. */
  lockResource?: string;
  now?: () => number;
  /** Injectable sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable randomness (tests). */
  random?: () => number;
  onReport?: (report: ProviderDiscoveryReport) => void;
}

export interface SchedulerState {
  /** Epoch ms of the last sweep start. */
  lastSweepAt: number;
  /** Epoch ms of the next sweep. */
  nextSweepAt: number;
  /** Per-provider backoff until (epoch ms). */
  backoffUntil: Record<string, number>;
  /** Per-provider last successful scan (epoch ms). */
  lastSuccessAt: Record<string, number>;
}

export const DEFAULT_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

export class DiscoveryScheduler {
  private readonly options: Required<
    Pick<SchedulerOptions, 'intervalMs' | 'concurrency' | 'timeoutMs' | 'jitterRatio' | 'lockResource'>
  > & SchedulerOptions;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private state: SchedulerState = { lastSweepAt: 0, nextSweepAt: 0, backoffUntil: {}, lastSuccessAt: {} };

  constructor(options: SchedulerOptions) {
    this.options = {
      intervalMs: options.intervalMs ?? DEFAULT_INTERVAL_MS,
      concurrency: Math.max(1, options.concurrency ?? 1),
      timeoutMs: options.timeoutMs ?? 120_000,
      jitterRatio: options.jitterRatio ?? 0.1,
      lockResource: options.lockResource ?? 'provider-model-discovery-sweep',
      ...options,
      lock: options.lock ?? new ProcessLock(),
    };
  }

  getState(): SchedulerState {
    return { ...this.state, backoffUntil: { ...this.state.backoffUntil }, lastSuccessAt: { ...this.state.lastSuccessAt } };
  }

  /** Restores the persisted state (so a restart does not re-scan everything). */
  restore(state: Partial<SchedulerState> | null | undefined): void {
    if (!state) return;
    this.state = {
      lastSweepAt: state.lastSweepAt || 0,
      nextSweepAt: state.nextSweepAt || 0,
      backoffUntil: { ...(state.backoffUntil || {}) },
      lastSuccessAt: { ...(state.lastSuccessAt || {}) },
    };
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private async sleep(ms: number): Promise<void> {
    if (this.options.sleep) return this.options.sleep(ms);
    return new Promise((r) => setTimeout(r, ms));
  }

  private random(): number {
    return (this.options.random ?? Math.random)();
  }

  /** True when the provider is currently in a backoff window. */
  isBackedOff(providerId: string): boolean {
    return (this.state.backoffUntil[providerId] || 0) > this.now();
  }

  /**
   * Scans the providers that are due. Never runs two sweeps at once, and
   * never runs two sweeps in two processes at the same time.
   */
  async sweep(options: { force?: boolean } = {}): Promise<ProviderDiscoveryReport[]> {
    if (this.running) return [];
    this.running = true;
    const reports: ProviderDiscoveryReport[] = [];
    const lock = this.options.lock!;
    try {
      await lock.withLock(this.options.lockResource, async () => {
        const now = this.now();
        this.state.lastSweepAt = now;

        const due = this.options.providerIds.filter((id) => {
          if (options.force) return true;
          if (this.isBackedOff(id)) return false;
          const last = this.state.lastSuccessAt[id] || 0;
          return now - last >= this.options.intervalMs;
        });

        // Stagger the providers: each one waits a little longer than the last.
        const stagger = Math.max(0, Math.floor((this.options.intervalMs * this.options.jitterRatio) / Math.max(1, due.length)));
        let slot = 0;

        for (const providerId of due) {
          if (this.options.concurrency <= 1) {
            const wait = slot * stagger + Math.floor(this.random() * Math.max(1, stagger));
            if (wait > 0) await this.sleep(wait);
            slot++;
          }
          if (this.options.service.isScanning(providerId)) continue;

          const report = await this.options.service.discover(providerId, { timeoutMs: this.options.timeoutMs });
          reports.push(report);
          this.options.onReport?.(report);

          if (report.status === 'discovered') {
            this.state.lastSuccessAt[providerId] = this.now();
            delete this.state.backoffUntil[providerId];
          } else if (report.deferred) {
            // Postponed, not failed: retry on the next tick without backoff.
            delete this.state.backoffUntil[providerId];
          } else {
            this.applyBackoff(providerId);
          }
        }
        this.state.nextSweepAt = this.now() + this.options.intervalMs;
      });
    } catch {
      // The lock is held by another process — this instance simply skips.
    } finally {
      this.running = false;
    }
    return reports;
  }

  /** Exponential backoff for a provider that failed or was rate limited. */
  applyBackoff(providerId: string): void {
    const previous = this.state.backoffUntil[providerId] || 0;
    const now = this.now();
    const base = Math.max(this.options.intervalMs, 60_000);
    const current = Math.max(0, previous - now);
    const next = Math.min(MAX_BACKOFF_MS, Math.max(base, current * 2 || base));
    this.state.backoffUntil[providerId] = now + next;
  }

  /** Starts the periodic sweep. */
  start(): void {
    if (this.timer) return;
    const tick = async () => {
      try {
        await this.sweep();
      } catch {
        /* never let the timer kill the process */
      }
    };
    const delay = Math.max(1000, this.options.intervalMs);
    this.timer = setInterval(() => void tick(), delay);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Runs a scan for one provider right now (the card's manual button). */
  async scanNow(providerId: string): Promise<ProviderDiscoveryReport | null> {
    if (!this.options.providerIds.includes(providerId)) return null;
    const report = await this.options.service.discover(providerId, { timeoutMs: this.options.timeoutMs });
    this.options.onReport?.(report);
    if (report.status === 'discovered') {
      this.state.lastSuccessAt[providerId] = this.now();
      delete this.state.backoffUntil[providerId];
    }
    return report;
  }
}
