import type { ArenaDriver, ChatMessage } from '../types.js';
import path from 'node:path';
import { ProfileBusyError } from './profile-busy-error.js';
import {
  classifyFailure,
  ProviderFailureError,
  ResilienceRegistry,
  type ProviderFailure,
  type ProviderFailureCode,
} from './provider-failures.js';
import { BreakerRegistry } from './circuit-breaker.js';

/**
 * A named backend route with a model-ID predicate. Requests walk the chain in
 * order and the first driver whose predicate matches handles them; if it fails
 * with a recoverable error, the next matching route gets the request.
 */
export interface DriverRoute {
  name: string;
  driver: ArenaDriver;
  matches: (model: string) => boolean;
}

/** Non-retryable failures we don't want to re-attempt on another backend. */
const ABORT_NON_RETRYABLE = ['Request was aborted'];

export interface RoutingResilienceOptions {
  /** Task 14 — per-(route,profileDir) circuit breakers (refuse NEW requests on OPEN routes). */
  breakers?: BreakerRegistry;
  /** Task 14 — process-local last-failure/last-success memory for /health. */
  registry?: ResilienceRegistry;
}

/**
 * Task 14 — policy codes that are NEVER failed over: no silent provider or
 * account switching, and usage limits are never bypassed by routing.
 * A failure after a possible send (sent=true) is handled by the same rule
 * through its non-retryable classification (failover would duplicate send).
 */
const NO_FAILOVER: ReadonlySet<ProviderFailureCode> = new Set([
  'AUTH_REQUIRED',
  'QUOTA_EXHAUSTED',
  'RATE_LIMITED',
  'PROFILE_OWNER_UNAVAILABLE',
  'NETWORK_UNKNOWN_AFTER_SEND',
  'CONVERSATION_RESTORE_FAILED',
  'UI_SELECTOR_CHANGED',
  'GENERATION_STALLED',
]);

export class RoutingDriver implements ArenaDriver {
  private readonly routes: DriverRoute[];
  private readonly breakers?: BreakerRegistry;
  private readonly registry?: ResilienceRegistry;

  constructor(routes: DriverRoute[], options: RoutingResilienceOptions = {}) {
    this.routes = routes;
    this.breakers = options.breakers;
    this.registry = options.registry;
  }

  async listModels(): Promise<string[]> {
    const results = await Promise.all(
      this.routes.map((r) => r.driver.listModels().catch(() => [] as string[]))
    );
    // Preserve chain order (z.ai before arena) while de-duplicating.
    const out: string[] = [];
    for (const list of results) {
      for (const m of list) {
        if (!out.includes(m)) out.push(m);
      }
    }
    return out;
  }

  async sendMessage(
    model: string,
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
    sessionKey?: string
  ): Promise<string> {
    if (signal?.aborted) throw new Error('Request was aborted');
    const cleaned = model.trim().toLowerCase();
    const candidates = this.routes.filter((r) => r.matches(cleaned));

    if (candidates.length === 0) {
      throw new Error(`No provider configured can serve model "${model}"`);
    }

    let lastError: unknown;
    for (const route of candidates) {
      // Task 14 — breaker gate: an OPEN circuit refuses NEW requests only;
      // in-flight requests are never touched (no cancellation anywhere).
      const profileDir = route.driver.getProfileDir?.() ?? route.name;
      const breaker = this.breakers?.forProvider(route.name, profileDir);
      if (breaker && !(await breaker.canAccept())) {
        console.log(`[RoutingDriver] ${route.name} skipped: circuit OPEN for profile ${profileDir === route.name ? '-' : profileDir}`);
        lastError = lastError ?? new Error(`circuit_open: ${route.name} is temporarily unavailable (breaker open)`);
        continue;
      }
      try {
        const result = await route.driver.sendMessage(model, messages, onChunk, signal, sessionKey);
        this.registry?.recordSuccess(route.name, profileDir);
        await breaker?.recordSuccess();
        return result;
      } catch (err: unknown) {
        if (signal?.aborted) {
          throw new Error('Request was aborted');
        }
        // Ownership conflict: NEVER converted into a provider switch — the
        // busy 503 must surface (or be forwarded to the owner upstream by
        // OwnerRoutingDriver), otherwise a second browser could start.
        if (err instanceof ProfileBusyError) throw err;

        // Task 14 — classification (failure info survives the route).
        const failure: ProviderFailure =
          err instanceof ProviderFailureError ? err.failure : classifyFailure(err, { phase: 'pre-send', sent: false });
        this.registry?.recordFailure(route.name, profileDir, failure.code, {
          sent: failure.sent,
          confirmed: failure.confirmedResult,
        });

        // Policy codes: NO failover, NO breaker count (never healed by
        // switching; usage limits never bypassed by routing).
        if (NO_FAILOVER.has(failure.code)) {
          throw err instanceof ProviderFailureError ? err : new ProviderFailureError(failure, err instanceof Error ? err.message : String(err));
        }

        const e = err as { statusCode?: number; message?: string };
        const msg = err instanceof Error ? err.message : String(err);
        const status = e?.statusCode;
        // Legacy rule (preserved): fail-fast on non-retryable client/auth
        // errors (4xx except 429) — do not mask them by failing over.
        const isNonRetryableAuth = status === 401 || status === 403 || (status !== undefined && status >= 400 && status < 500 && status !== 429);
        const isNonRetryableMsg = ABORT_NON_RETRYABLE.some((m) => msg === m)
          || /Invalid or missing API key|authentication_error|Invalid request|messages.*required/i.test(msg);
        if (isNonRetryableAuth || isNonRetryableMsg) throw err;

        // Breaker counts transient failures only (BREAKER_COUNTABLE inside).
        await breaker?.record(failure.code);

        if (!failure.retryable) {
          // Unconfirmed/unknown after a possible send etc.: never re-sent,
          // never failed over; RATE_LIMITED surfaces a suggested retry time.
          if (failure.retryAfterMs !== undefined) {
            throw new ProviderFailureError(
              failure,
              `${failure.code}: too early to retry — Retry-After honored, try again in ~${Math.ceil(failure.retryAfterMs / 1000)}s (no automatic re-send was performed)`
            );
          }
          throw err instanceof ProviderFailureError ? err : new ProviderFailureError(failure, msg);
        }
        lastError = err;
        console.log(
          `[RoutingDriver] ${route.name} failed for model ${model}: ${msg}. Trying next provider...`
        );
      }
    }

    throw lastError ?? new Error('All providers failed');
  }

  async close(): Promise<void> {
    const closed = new Set<ArenaDriver>();
    for (const r of this.routes) {
      if (closed.has(r.driver)) continue;
      closed.add(r.driver);
      if (r.driver.close) {
        await r.driver.close().catch(() => {});
      }
    }
  }

  /**
   * Task 14 — /health section (LOCAL state only). Never contacts a provider:
   * provider state is always 'not_checked' unless something else actually
   * verified it. Profile directories are redacted to their basename.
   */
  resilienceSnapshot(): Array<{
    name: string;
    profileId: string;
    providerState: 'not_checked';
    breakerState: string;
    lastFailureCode?: string;
    lastFailureAt?: number;
    lastFailureSent?: boolean;
    lastSuccessAt?: number;
  }> {
    const snap = this.registry?.snapshot() ?? {};
    return this.routes.map((r) => {
      const profileDir = r.driver.getProfileDir?.() ?? r.name;
      const breaker = this.breakers?.forProvider(r.name, profileDir);
      const entry = snap[`${r.name}::${profileDir}`];
      return {
        name: r.name,
        profileId: path.basename(profileDir),
        providerState: 'not_checked' as const,
        breakerState: breaker ? breaker.state() : 'disabled',
        lastFailureCode: entry?.lastFailureCode,
        lastFailureAt: entry?.lastFailureAt,
        lastFailureSent: entry?.lastFailureSent,
        lastSuccessAt: entry?.lastSuccessAt,
      };
    });
  }
}
