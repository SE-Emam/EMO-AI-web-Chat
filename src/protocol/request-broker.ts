/**
 * Claim-once request broker (chat-on-steroids request-broker principle).
 *
 * An opt-in idempotency layer keyed by (apiKey scope, providerId, X-Request-Id).
 * The first begin() claims the key and is allowed to execute; any concurrent
 * or later begin() with the same key is denied and served the recorded
 * outcome instead — across PROCESSES, because every read-modify-write cycle
 * runs inside a cross-process ProcessLock (atomic writes alone cannot stop
 * two workers from both reading "absent" and both proceeding).
 *
 * Outcome semantics (owner ruling #5 — binding):
 *  - complete(result)          → 'completed'; small results are replayable.
 *  - fail({retryable})         → 'failed'  ... ONLY before markSent().
 *  - after markSent()          → ANY failure is upgraded to 'unconfirmed',
 *    even if the caller passes retryable:true (the override is logged).
 *    Rationale: once the message may have reached the web chat, a blind
 *    re-execution can duplicate real side effects in the user's account.
 *  - markUnconfirmed(reason)   → 'unconfirmed' with the reason recorded.
 *
 * Replay semantics:
 *  - completed + cached result (≤256KB JSON) → served as a stored replay.
 *    For SSE the stored payload is re-broadcast as chunks with the
 *    `x-emo-replay: true` marker — it is a REPLAY OF A STORED RESULT, not a
 *    live execution; documented in IMPLEMENTATION_REPORT.md.
 *  - completed but result too large to cache → denied (409-style) with state.
 *  - running → denied (still in progress).
 *  - unconfirmed → denied with the reason; the client must verify on the web
 *    side before re-issuing.
 *  - failed (pre-send only) → the claim is released; retry is allowed.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { readJson, writeJsonAtomic } from '../sessions/durable-store.js';
import { ProcessLock } from '../sessions/process-lock.js';

export type RequestState = 'running' | 'completed' | 'failed' | 'unconfirmed';

export interface BrokerEntry {
  key: string;
  sessionKey: string | null;
  state: RequestState;
  result?: unknown;
  reason?: string;
  createdAt: number;
  updatedAt: number;
}

interface BrokerFile {
  version: 1;
  entries: BrokerEntry[];
}

/** Results larger than this (serialized JSON bytes) are not cached for replay. */
const MAX_RESULT_BYTES = 256 * 1024;
/** Entries older than this are evicted. */
const ENTRY_TTL_MS = 24 * 3600_000;
/** Hard cap on stored entries. */
const MAX_ENTRIES = 2000;

export function defaultBrokerStorePath(): string {
  return path.join(os.homedir(), '.arena-webbridge', 'state', 'request-broker.json');
}

/**
 * Scope key: sha1(apiKeyScope + providerId + requestId). Two clients with
 * different API keys (or different providers) using the same X-Request-Id
 * value never collide.
 */
export function brokerKey(apiKeyScope: string, providerId: string, requestId: string): string {
  return createHash('sha1').update(`${apiKeyScope}\u0000${providerId}\u0000${requestId}`).digest('hex');
}

export interface SentController {
  /** Result cache is capped; oversized results are recorded state-only. */
  complete(result: unknown): Promise<void>;
  /**
   * Records a failure. Before send: honors retryable (releases the claim).
   * After send: ALWAYS upgraded to unconfirmed — a possible duplicate send
   * must never be blindly retried. Passing retryable:true after send is
   * ignored and logged.
   */
  fail(opts: { retryable?: boolean; error?: string }): Promise<void>;
  /** Explicit uncertainty: the message may or may not have gone through. */
  markUnconfirmed(reason: string): Promise<void>;
  /** Internal: called when the request has been accepted for sending. */
  markSent(): void;
}

export type Begin =
  | { allowed: true; state: 'running'; complete: SentController['complete']; fail: SentController['fail']; markUnconfirmed: SentController['markUnconfirmed']; markSent: () => void }
  | { allowed: false; state: RequestState; result?: unknown; reason?: string };

export class RequestBroker {
  private readonly storePath: string;
  private readonly lock: ProcessLock;

  constructor(storePath: string = defaultBrokerStorePath(), lock?: ProcessLock) {
    this.storePath = storePath;
    this.lock = lock || new ProcessLock({ lockDir: path.join(path.dirname(storePath), 'locks') });
  }

  /** Direct state lookup (diagnostics / tests). */
  get(key: string): BrokerEntry | null {
    const file = readJson<BrokerFile>(this.storePath);
    if (!file || !Array.isArray(file.entries)) return null;
    return file.entries.find((e) => e.key === key) ?? null;
  }

  private async load(): Promise<BrokerFile> {
    const data = readJson<BrokerFile>(this.storePath);
    const file: BrokerFile = data && Array.isArray(data.entries) ? data : { version: 1, entries: [] };
    // TTL + cap maintenance happens on every mutation cycle, inside the lock.
    const now = Date.now();
    const before = file.entries.length;
    file.entries = file.entries.filter((e) => now - (e.updatedAt || e.createdAt || 0) < ENTRY_TTL_MS);
    if (file.entries.length > MAX_ENTRIES) {
      file.entries = file.entries.slice(file.entries.length - MAX_ENTRIES);
    }
    if (file.entries.length !== before) writeJsonAtomic(this.storePath, file);
    return file;
  }

  /**
   * Claims the request key. Cross-process atomic: the entire
   * check-and-claim runs under the ProcessLock, so two racing processes can
   * never both observe "absent".
   */
  async begin(key: string, sessionKey: string | null = null): Promise<Begin> {
    return this.lock.withLock(this.storePath, async () => {
      const file = await this.load();
      const existing = file.entries.find((e) => e.key === key);
      if (existing) {
        if (existing.state === 'failed') {
          // Pre-send failure: safe to retry — release the claim.
          file.entries = file.entries.filter((e) => e !== existing);
          writeJsonAtomic(this.storePath, file);
        } else {
          return {
            allowed: false,
            state: existing.state,
            ...(existing.state === 'completed' && existing.result !== undefined ? { result: existing.result } : {}),
            ...(existing.reason ? { reason: existing.reason } : {}),
          } as Begin;
        }
      }
      const entry: BrokerEntry = {
        key,
        sessionKey,
        state: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      file.entries.push(entry);
      writeJsonAtomic(this.storePath, file);
      return {
        allowed: true,
        state: 'running' as const,
        complete: (result: unknown) => this.finish(key, 'completed', result),
        fail: (opts: { retryable?: boolean; error?: string }) => this.fail(key, opts),
        markUnconfirmed: (reason: string) => this.finish(key, 'unconfirmed', undefined, reason),
        /**
         * Marks the point after which ANY failure becomes unconfirmed. The
         * flag is persisted so even a crash+restart keeps the semantics.
         */
        markSent: () => {
          this.markSentPersisted(key).catch(() => {});
        },
      };
    });
  }

  private async markSentPersisted(key: string): Promise<void> {
    await this.lock.withLock(this.storePath, async () => {
      const file = await this.load();
      const entry = file.entries.find((e) => e.key === key);
      if (!entry) return;
      (entry as any).sent = true;
      entry.updatedAt = Date.now();
      writeJsonAtomic(this.storePath, file);
    });
  }

  private async finish(key: string, state: 'completed' | 'unconfirmed', result?: unknown, reason?: string): Promise<void> {
    await this.lock.withLock(this.storePath, async () => {
      const file = await this.load();
      const entry = file.entries.find((e) => e.key === key);
      if (!entry) return;
      entry.state = state;
      entry.updatedAt = Date.now();
      if (reason !== undefined) entry.reason = reason;
      if (state === 'completed' && result !== undefined) {
        let bytes = 0;
        try {
          bytes = Buffer.byteLength(JSON.stringify(result));
        } catch {
          bytes = Infinity;
        }
        if (bytes <= MAX_RESULT_BYTES) entry.result = result;
        // else: state recorded, result intentionally not cached (too large).
      }
      writeJsonAtomic(this.storePath, file);
    });
  }

  private async fail(key: string, opts: { retryable?: boolean; error?: string }): Promise<void> {
    await this.lock.withLock(this.storePath, async () => {
      const file = await this.load();
      const entry = file.entries.find((e) => e.key === key);
      if (!entry) return;
      const sent = (entry as any).sent === true;
      if (sent) {
        if (opts.retryable) {
          console.log(
            `[request-broker] WARNING: retryable=true requested AFTER send for ${key.slice(0, 12)}… — upgraded to unconfirmed (override logged)`
          );
        }
        entry.state = 'unconfirmed';
        entry.reason = opts.error || 'failure after possible send — outcome unknown';
      } else {
        entry.state = 'failed';
        entry.reason = opts.error || 'failed before send';
      }
      entry.updatedAt = Date.now();
      writeJsonAtomic(this.storePath, file);
    });
  }
}
