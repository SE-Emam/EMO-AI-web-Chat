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
import { createHash, randomBytes } from 'node:crypto';
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
  /**
   * Task 11 — durable one-time execution reservation (owner mandatory mod
   * #1/#5). Records WHO actually executes the request in the owner process,
   * separating: claimed at receiver / reached owner / send started /
   * finished. Never a state-name substitute; a duplicate IPC command can
   * never start a second execution.
   */
  attachment?: ExecutionAttachment;
  /** Task 12 — payload fingerprint (sha256 over ALL execution-affecting options + protocol). Optional for backward compat. */
  fingerprint?: string;
}

export interface ExecutionAttachment {
  executorInstanceId: string;
  executorEpoch: string;
  executorPid: number;
  forwardId: string;
  /** Guards every later state update; a wrong identity/token is a logged no-op. */
  executionToken: string;
  attachedAt: number;
  /** When the actual send to the web chat started (markSent). Null before. */
  sentAt: number | null;
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

/** Liveness probe (same semantics as the ownership ledger's). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === 'EPERM';
  }
}

export interface AttachExecutor {
  executorInstanceId: string;
  executorEpoch: string;
  executorPid: number;
  forwardId: string;
}

/** Proof carried on every attached-controller call; a mismatch is a logged no-op. */
export interface ExecutorProof {
  executorInstanceId: string;
  executionToken: string;
}

export interface AttachedController {
  complete(result: unknown, proof: ExecutorProof): Promise<void>;
  fail(opts: { retryable?: boolean; error?: string }, proof: ExecutorProof): Promise<void>;
  markUnconfirmed(reason: string, proof: ExecutorProof): Promise<void>;
  markSent(proof: ExecutorProof): Promise<void>;
}

export type AttachResult =
  | { attached: true; attachment: ExecutionAttachment; controller: AttachedController }
  | { attached: false; reason: 'already_attached'; attachment?: ExecutionAttachment }
  | { attached: false; reason: 'not_found' | 'not_running' };

export type SettleOutcome =
  | { outcome: 'failed_retryable'; cleared?: boolean }
  | { outcome: 'unconfirmed' }
  | { outcome: 'completed' };

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
  | { allowed: false; state: RequestState; result?: unknown; reason?: string; /** Task 12 — same key + different payload fingerprint: explicit conflict, never a silent replay. */ conflict?: boolean };

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

  /**
   * Task 14 — additive /health metric: entry counts per request state,
   * READ-ONLY (never creates or mutates the store).
   */
  countByState(): { running: number; completed: number; failed: number; unconfirmed: number } {
    const file = readJson<BrokerFile>(this.storePath);
    const counts = { running: 0, completed: 0, failed: 0, unconfirmed: 0 };
    if (!file || !Array.isArray(file.entries)) return counts;
    for (const e of file.entries) {
      if (e.state in counts) counts[e.state as keyof typeof counts] += 1;
    }
    return counts;
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
   *
   * Task 12 — payload fingerprint: when the caller supplies one and the
   * existing entry ALSO stores one, any mismatch is an explicit CONFLICT for
   * EVERY state (running/completed/failed/unconfirmed) — the same
   * X-Request-Id was reused with a different request; a silent replay would
   * return the wrong response body. A legacy entry WITHOUT a stored
   * fingerprint must NOT claim diff-detection it cannot do: it is served by
   * the pre-existing state semantics (documented backward compat).
   */
  async begin(key: string, sessionKey: string | null = null, fingerprint?: string): Promise<Begin> {
    return this.lock.withLock(this.storePath, async () => {
      const file = await this.load();
      const existing = file.entries.find((e) => e.key === key);
      if (existing) {
        if (
          fingerprint !== undefined &&
          existing.fingerprint !== undefined &&
          existing.fingerprint !== fingerprint
        ) {
          return {
            allowed: false,
            state: existing.state,
            conflict: true,
            reason: 'idempotency_key_reused_with_different_request',
          } as Begin;
        }
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
        ...(fingerprint !== undefined ? { fingerprint } : {}),
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

  // ---- Task 11: atomic one-time execution attachment (shared durable store) ----

  private cacheResult(entry: BrokerEntry, result: unknown): void {
    let bytes = 0;
    try {
      bytes = Buffer.byteLength(JSON.stringify(result));
    } catch {
      bytes = Infinity;
    }
    if (bytes <= MAX_RESULT_BYTES) entry.result = result;
    // else: state recorded, result intentionally not cached (too large).
  }

  private attachedProofOk(entry: BrokerEntry, proof?: ExecutorProof): boolean {
    const att = entry.attachment;
    if (!att) return false;
    if (!proof || att.executorInstanceId !== proof.executorInstanceId || att.executionToken !== proof.executionToken) {
      // Documented refusal: logged WITHOUT any secret (key prefix + mismatch kind only).
      console.log(
        `[request-broker] WARNING: state update REFUSED for ${entry.key.slice(0, 12)}… — executor identity/execution-token mismatch (possible duplicate or forged controller); no-op.`
      );
      return false;
    }
    return true;
  }

  private attachedController(key: string): AttachedController {
    const update = (proof: ExecutorProof, fn: (entry: BrokerEntry) => void) =>
      this.lock.withLock(this.storePath, async () => {
        const file = await this.load();
        const entry = file.entries.find((e) => e.key === key);
        if (!entry) return;
        if (!this.attachedProofOk(entry, proof)) return;
        fn(entry);
        entry.updatedAt = Date.now();
        writeJsonAtomic(this.storePath, file);
      });
    return {
      complete: (result, proof) => update(proof, (entry) => {
        entry.state = 'completed';
        this.cacheResult(entry, result);
      }),
      fail: (opts, proof) => update(proof, (entry) => {
        // With a durable ExecutionAttachment, the OWNER's sentAt is the
        // authoritative send evidence: the receiver may have conservatively
        // marked sent BEFORE the forward (Task 10 policy), which must not
        // mask a pre-send owner failure.
        const sent = entry.attachment?.sentAt != null;
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
      }),
      markUnconfirmed: (reason, proof) => update(proof, (entry) => {
        entry.state = 'unconfirmed';
        entry.reason = reason;
      }),
      markSent: (proof) => update(proof, (entry) => {
        if (entry.attachment && entry.attachment.sentAt === null) entry.attachment.sentAt = Date.now();
        // Legacy flag: the plain (unattached) fail() path must also upgrade after send.
        (entry as any).sent = true;
      }),
    };
  }

  /**
   * Atomic ONE-TIME execution reservation (owner mandatory mod #1).
   * Runs entirely under the cross-process ProcessLock over the SHARED store:
   * the first caller wins; a duplicate IPC command (different executor or a
   * new forwardId) is refused with already_attached and must NOT start a
   * second execution; the SAME forwardId from the SAME executor is an
   * idempotent re-acknowledgement of the SAME reservation (same token).
   */
  async attachForExecution(key: string, executor: AttachExecutor): Promise<AttachResult> {
    return this.lock.withLock(this.storePath, async () => {
      const file = await this.load();
      const entry = file.entries.find((e) => e.key === key);
      if (!entry) return { attached: false, reason: 'not_found' } as AttachResult;
      if (entry.state !== 'running') return { attached: false, reason: 'not_running' } as AttachResult;
      const existing = entry.attachment;
      if (existing) {
        if (existing.executorInstanceId === executor.executorInstanceId && existing.forwardId === executor.forwardId) {
          return { attached: true, attachment: existing, controller: this.attachedController(key) } as AttachResult;
        }
        return { attached: false, reason: 'already_attached', attachment: existing } as AttachResult;
      }
      const attachment: ExecutionAttachment = {
        executorInstanceId: executor.executorInstanceId,
        executorEpoch: executor.executorEpoch,
        executorPid: executor.executorPid,
        forwardId: executor.forwardId,
        executionToken: randomBytes(16).toString('hex'),
        attachedAt: Date.now(),
        sentAt: null,
      };
      entry.attachment = attachment;
      entry.updatedAt = Date.now();
      writeJsonAtomic(this.storePath, file);
      return { attached: true, attachment, controller: this.attachedController(key) } as AttachResult;
    });
  }

  /**
   * Durable truth after a forward failure (owner mandatory mod #1/#2).
   * Called by the RECEIVER when its IPC call to the owner failed/ended
   * ambiguously. The decision ALWAYS comes from the durable store — an IPC
   * timeout alone NEVER allows re-execution.
   */
  async settleForwardFailure(key: string, _opts: { executorPid: number }): Promise<SettleOutcome> {
    return this.lock.withLock(this.storePath, async () => {
      const file = await this.load();
      const entry = file.entries.find((e) => e.key === key);
      if (!entry) return { outcome: 'failed_retryable' } as SettleOutcome;
      if (entry.state === 'completed') return { outcome: 'completed' } as SettleOutcome;
      const att = entry.attachment;
      if (!att) {
        entry.state = 'failed';
        entry.reason = 'forwarded execution failed before reaching the owner — retry allowed';
        entry.updatedAt = Date.now();
        writeJsonAtomic(this.storePath, file);
        return { outcome: 'failed_retryable' } as SettleOutcome;
      }
      if (att.sentAt != null) {
        entry.state = 'unconfirmed';
        entry.reason = 'forwarded execution possibly started sending — outcome unknown';
        entry.updatedAt = Date.now();
        writeJsonAtomic(this.storePath, file);
        return { outcome: 'unconfirmed' } as SettleOutcome;
      }
      if (pidAlive(att.executorPid)) {
        // Owner may be executing right now — never touch the claim.
        return { outcome: 'unconfirmed' } as SettleOutcome;
      }
      delete entry.attachment;
      entry.state = 'failed';
      entry.reason = 'owner died before markSent — attachment cleared, retry allowed';
      entry.updatedAt = Date.now();
      writeJsonAtomic(this.storePath, file);
      return { outcome: 'failed_retryable', cleared: true } as SettleOutcome;
    });
  }

  /** Receiver-side explicit uncertainty (e.g. IPC channel dropped after accepted). */
  async markUnconfirmedByKey(key: string, reason: string): Promise<boolean> {
    return this.lock.withLock(this.storePath, async () => {
      const file = await this.load();
      const entry = file.entries.find((e) => e.key === key);
      if (!entry) return false;
      entry.state = 'unconfirmed';
      entry.reason = reason;
      entry.updatedAt = Date.now();
      writeJsonAtomic(this.storePath, file);
      return true;
    });
  }
}
