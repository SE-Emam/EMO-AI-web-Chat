/**
 * Task 14 — circuit breaker keyed by (providerId, profileDir).
 *
 * Owner locked rules:
 *  - CLOSED admits normally; OPEN refuses NEW requests only — in-flight
 *    requests are NEVER cancelled (the breaker exposes no cancellation);
 *  - after a configurable recovery period, HALF_OPEN allows exactly ONE
 *    controlled probe; a successful probe closes the circuit, a failed one
 *    re-opens it;
 *  - only transient failures (BREAKER_COUNTABLE) count; AUTH_REQUIRED,
 *    QUOTA_EXHAUSTED and RATE_LIMITED are policy conditions and NEVER open
 *    a circuit (they are never healed by retrying or by switching);
 *  - unknown/user-input/tool-error codes are ignored by record();
 *  - cross-process: the probe is a LEASE in a ProcessLock-guarded state
 *    file (pid + token + TTL with dead-pid takeover) so two Gateway
 *    processes can never hold concurrent HALF_OPEN probes for the same
 *    profile;
 *  - state is durable across breaker instances/processes on the same store
 *    path; different keys share a store file but keep isolated state.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ProcessLock } from '../sessions/process-lock.js';
import { BREAKER_COUNTABLE, type ProviderFailureCode } from './provider-failures.js';

export type BreakerState = 'closed' | 'open' | 'half_open';

interface ProbeLease {
  pid: number;
  ownerInstanceId: string;
  token: string;
  acquiredAt: number;
}

interface BreakerRecord {
  state: BreakerState;
  failures: number;
  openedAt?: number;
  probe?: ProbeLease;
}

const blank = (): BreakerRecord => ({ state: 'closed', failures: 0 });

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === 'EPERM'; // exists but not signalable — treat as alive
  }
}

export interface CircuitBreakerOptions {
  providerId: string;
  profileDir: string;
  /** Countable failures before opening (default 5). */
  threshold?: number;
  /** Open → probe-eligible period (default 30s). */
  recoveryMs?: number;
  /** Durable state file shared across processes (recommended). */
  storePath?: string;
  /** Probe lease TTL before another process may take it over (default 60s). */
  probeLeaseTtlMs?: number;
  now?: () => number;
}

export interface ProbeResult {
  granted: boolean;
  reason?: 'closed' | 'recovering' | 'probe_in_progress';
  token?: string;
}

export class CircuitBreaker {
  readonly providerId: string;
  readonly profileDir: string;
  readonly storePath?: string;
  private readonly threshold: number;
  private readonly recoveryMs: number;
  private readonly probeLeaseTtlMs: number;
  private readonly now: () => number;
  private readonly lock: ProcessLock | null;
  private mem: BreakerRecord = blank();

  constructor(options: CircuitBreakerOptions) {
    this.providerId = options.providerId;
    this.profileDir = options.profileDir;
    this.storePath = options.storePath;
    this.threshold = Math.max(1, options.threshold ?? 5);
    this.recoveryMs = Math.max(0, options.recoveryMs ?? 30_000);
    this.probeLeaseTtlMs = Math.max(1000, options.probeLeaseTtlMs ?? 60_000);
    this.now = options.now ?? Date.now;
    this.lock = options.storePath ? new ProcessLock({ lockDir: path.join(path.dirname(options.storePath), 'breaker-locks') }) : null;
  }

  get key(): string {
    return `${this.providerId}::${this.profileDir}`;
  }

  /** Resource name for the shared store lock (one file may hold many keys). */
  private resource(): string {
    return `breaker:${this.storePath ?? 'memory'}`;
  }

  private readStore(): BreakerRecord {
    if (!this.storePath) return this.mem;
    try {
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8')) as Record<string, BreakerRecord>;
      return raw[this.key] ? { ...blank(), ...raw[this.key] } : blank();
    } catch {
      return blank();
    }
  }

  private writeStore(record: BreakerRecord): void {
    if (!this.storePath) {
      this.mem = record;
      return;
    }
    let all: Record<string, BreakerRecord> = {};
    try {
      all = JSON.parse(fs.readFileSync(this.storePath, 'utf8')) as Record<string, BreakerRecord>;
    } catch {
      all = {};
    }
    all[this.key] = record;
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.tmp-${process.pid}-${randomUUID().slice(0, 6)}`;
    fs.writeFileSync(tmp, JSON.stringify(all));
    fs.renameSync(tmp, this.storePath); // atomic swap
  }

  private locked<T>(fn: (record: BreakerRecord) => Promise<T> | T): Promise<T> {
    if (!this.lock) return Promise.resolve(fn(this.mem));
    return this.lock.withLock(this.resource(), async () => fn(this.readStore())) as Promise<T>;
  }

  /** Current state (durable when a store path is configured). */
  state(): BreakerState {
    return this.readStore().state;
  }

  /** May a NEW request start? In-flight requests are never affected. */
  async canAccept(): Promise<boolean> {
    return this.locked((rec) => {
      const now = this.now();
      if (rec.state === 'open') {
        // Probe eligibility is claimed via startProbe; ordinary traffic stays refused.
        return false;
      }
      if (rec.state === 'half_open') {
        const probe = rec.probe;
        if (probe && pidAlive(probe.pid) && now - probe.acquiredAt < this.probeLeaseTtlMs) return false;
        return false; // even with a dead probe, admission waits for a fresh probe
      }
      return true;
    });
  }

  /** Records an outcome. Only BREAKER_COUNTABLE codes count. */
  async record(code: ProviderFailureCode): Promise<void> {
    if (!BREAKER_COUNTABLE.has(code)) return; // policy codes / unknowns never open circuits
    await this.locked((rec) => {
      rec.failures += 1;
      if (rec.state === 'half_open' || rec.failures >= this.threshold) {
        rec.state = 'open';
        rec.openedAt = this.now();
        rec.probe = undefined;
      }
      this.writeStore(rec);
    });
  }

  /** A success closes the circuit and resets the counter. */
  async recordSuccess(): Promise<void> {
    await this.locked((rec) => {
      rec.state = 'closed';
      rec.failures = 0;
      rec.openedAt = undefined;
      rec.probe = undefined;
      this.writeStore(rec);
    });
  }

  /**
   * Claims the single HALF_OPEN probe. Grants at most ONE live lease per key
   * across ALL processes: a live probe (alive pid, unexpired TTL) refuses;
   * a dead/expired lease is taken over.
   */
  async startProbe(): Promise<ProbeResult> {
    return this.locked((rec): ProbeResult => {
      const now = this.now();
      if (rec.state === 'closed') return { granted: false, reason: 'closed' };
      if (rec.state === 'open') {
        if (rec.openedAt === undefined || now - rec.openedAt < this.recoveryMs) {
          return { granted: false, reason: 'recovering' };
        }
      }
      const probe = rec.probe;
      if (probe && pidAlive(probe.pid) && now - probe.acquiredAt < this.probeLeaseTtlMs) {
        return { granted: false, reason: 'probe_in_progress' };
      }
      const lease: ProbeLease = { pid: process.pid, ownerInstanceId: this.lock?.ownerInstanceId ?? 'in-process', token: randomUUID().slice(0, 12), acquiredAt: now };
      rec.state = 'half_open';
      rec.probe = lease;
      this.writeStore(rec);
      return { granted: true, token: lease.token };
    });
  }

  /** Completes the probe: success closes, failure re-opens. */
  async completeProbe(success: boolean): Promise<void> {
    await this.locked((rec) => {
      if (rec.state !== 'half_open') return;
      rec.probe = undefined;
      if (success) {
        rec.state = 'closed';
        rec.failures = 0;
        rec.openedAt = undefined;
      } else {
        rec.state = 'open';
        rec.openedAt = this.now();
      }
      this.writeStore(rec);
    });
  }
}

/**
 * Process-wide registry of breakers (one per (providerId, profileDir) key),
 * sharing one durable store. /health reads states from here.
 */
export class BreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly storePath: string,
    private readonly defaults: { threshold?: number; recoveryMs?: number } = {}
  ) {}

  forProvider(providerId: string, profileDir: string, overrides: { threshold?: number; recoveryMs?: number } = {}): CircuitBreaker {
    const key = `${providerId}::${profileDir}`;
    let b = this.breakers.get(key);
    if (!b) {
      b = new CircuitBreaker({
        providerId,
        profileDir,
        storePath: this.storePath,
        threshold: overrides.threshold ?? this.defaults.threshold,
        recoveryMs: overrides.recoveryMs ?? this.defaults.recoveryMs,
      });
      this.breakers.set(key, b);
    }
    return b;
  }

  /** All known breaker states for /health (durable records + live keys). */
  states(): Array<{ providerId: string; profileDir: string; state: BreakerState; failures: number }> {
    const out: Array<{ providerId: string; profileDir: string; state: BreakerState; failures: number }> = [];
    // Live keys in this process.
    for (const [key, b] of this.breakers) {
      const [providerId, profileDir] = key.split('::');
      out.push({ providerId, profileDir, state: b.state(), failures: (b as unknown as { readStore(): BreakerRecord }).readStore().failures });
    }
    return out;
  }
}
