/**
 * Bulk job runner for the "scan everything" actions.
 *
 * A sweep over 15 providers takes minutes (each provider opens a browser),
 * so it must NOT be a single blocking HTTP request. The runner therefore
 * starts a background job that the UI polls for progress.
 */
export type BulkJobKind = 'discover' | 'connect';

export interface BulkJobResult {
  providerId: string;
  ok: boolean;
  status: string;
  detail?: string;
  models?: number;
}

export interface BulkJob {
  id: string;
  kind: BulkJobKind;
  running: boolean;
  /** True while the job waits for the user's consent (a visible browser). */
  awaitingConsent: boolean;
  /** True when the user postponed the job. */
  deferred?: boolean;
  total: number;
  done: number;
  /** The provider currently being processed. */
  current?: string;
  startedAt: string;
  finishedAt?: string;
  results: BulkJobResult[];
  error?: string;
}

export interface JobRunnerOptions {
  /** Runs one provider; must never throw. */
  runOne: (providerId: string) => Promise<{ ok: boolean; status: string; detail?: string; models?: number }>;
  now?: () => number;
  /** Pause between providers (keeps the provider servers happy). */
  delayMs?: number;
}

export class BulkJobRunner {
  private job: BulkJob | null = null;
  private running = false;
  /** True while a job exists (pending consent OR running). */
  private active = false;
  private pendingIds: string[] = [];
  private readonly options: JobRunnerOptions;

  constructor(options: JobRunnerOptions) {
    this.options = options;
  }

  /** The current job (null when nothing ran yet). */
  get(): BulkJob | null {
    return this.job;
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Starts a job. If one is already running the running one is returned (the
   * user does not start two sweeps at once).
   */
  start(
    kind: BulkJobKind,
    providerIds: string[],
    opts: { requireConsent?: boolean } = {},
  ): BulkJob {
    // A pending (awaiting consent) job must not be replaced by a new one.
    if (this.active && this.job) return this.job;
    const now = this.options.now ?? Date.now;
    this.job = {
      id: `job-${now()}`,
      kind,
      running: true,
      awaitingConsent: opts.requireConsent === true,
      total: providerIds.length,
      done: 0,
      startedAt: new Date(now()).toISOString(),
      results: [],
    };
    this.pendingIds = providerIds;
    this.active = true;
    if (this.job.awaitingConsent) {
      // The job waits for the user's consent — nothing is opened yet.
      this.running = false;
      return this.job;
    }
    this.running = true;
    void this.execute(providerIds);
    return this.job;
  }

  /** The user approved opening a visible browser — the job starts now. */
  approve(): boolean {
    if (!this.job || !this.job.awaitingConsent) return false;
    this.job.awaitingConsent = false;
    this.running = true;
    void this.execute(this.pendingIds);
    return true;
  }

  /** The user postponed the job — nothing is opened. */
  defer(): boolean {
    if (!this.job || !this.job.awaitingConsent) return false;
    this.job.awaitingConsent = false;
    this.job.deferred = true;
    this.job.running = false;
    this.job.finishedAt = new Date((this.options.now ?? Date.now)()).toISOString();
    this.running = false;
    this.active = false;
    return true;
  }

  private async execute(providerIds: string[]): Promise<void> {
    const delayMs = this.options.delayMs ?? 0;
    for (const providerId of providerIds) {
      if (this.job) this.job.current = providerId;
      try {
        const result = await this.options.runOne(providerId);
        this.job?.results.push({ providerId, ...result });
      } catch (e) {
        this.job?.results.push({
          providerId,
          ok: false,
          status: 'unknown',
          detail: e instanceof Error ? e.message : String(e),
        });
      }
      this.job && (this.job.done += 1);
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
    if (this.job) {
      this.job.running = false;
      this.job.current = undefined;
      this.job.finishedAt = new Date((this.options.now ?? Date.now)()).toISOString();
    }
    this.running = false;
    this.active = false;
  }
}
