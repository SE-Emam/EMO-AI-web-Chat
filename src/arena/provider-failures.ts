/**
 * centralized provider failure classification + secret-free
 * diagnostics + process-local resilience memory.
 *
 * Owner locked rules (directive §2/§3/§4/§7):
 *  - TEN explicit failure codes; every classification result carries
 *    code/phase/sent/confirmedResult/retryable/markUnconfirmed;
 *  - CORE RULE: an error may NEVER be converted to retryable without
 *    checking the execution phase and the send marker. Pre-send retry is
 *    allowed only when non-execution is PROVEN. After a possible send, an
 *    unknown result means the request is UNCONFIRMED and is never
 *    auto-re-sent merely because the client got no reply;
 *  - RATE_LIMITED / QUOTA_EXHAUSTED require TRUSTWORTHY evidence (a clear
 *    code, an HTTP status, or a confirmed page marker) — NEVER vague
 *    message text alone; quota exhaustion is NOT a temporary rate limit;
 *  - Retry-After is honored only when valid (positive seconds or a future
 *    HTTP date) and within a configurable maximum wait;
 *  - timeouts are phase-aware: a timeout while awaiting with no provable
 *    result is NETWORK_UNKNOWN_AFTER_SEND (unconfirmed) — the total timeout
 *    must never re-execute a sent message;
 *  - AUTH_REQUIRED / QUOTA_EXHAUSTED / RATE_LIMITED are policy-guarded, not
 *    transient: they are excluded from BREAKER_COUNTABLE and never healed
 *    by silent provider/account switching.
 */
import { createHash } from 'node:crypto';

export type ProviderFailureCode =
  | 'AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'QUOTA_EXHAUSTED'
  | 'NETWORK_TIMEOUT'
  | 'NETWORK_UNKNOWN_AFTER_SEND'
  | 'GENERATION_STALLED'
  | 'UI_SELECTOR_CHANGED'
  | 'CONVERSATION_RESTORE_FAILED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROFILE_OWNER_UNAVAILABLE';

export type ExecutionPhase = 'pre-send' | 'post-send' | 'awaiting' | 'restore' | 'quota';

export interface FailureContext {
  /** Execution phase at failure time (default: pre-send). */
  phase?: ExecutionPhase;
  /** Did the send plausibly happen? (caller's send marker / markSent). */
  sent?: boolean;
  /** Is a result PROVABLE (broker completed, confirmed page marker)? */
  confirmedResult?: boolean;
  /** Raw Retry-After evidence (seconds string/number or HTTP date). */
  retryAfter?: string | number | null;
  /** HTTP status if the error carries one. */
  status?: number;
  /** Confirmed page marker observed in the provider UI/API response. */
  pageMarker?: string | null;
}

export interface ProviderFailure {
  code: ProviderFailureCode;
  phase: ExecutionPhase;
  sent: boolean;
  confirmedResult: boolean;
  /** Safe to AUTO-retry (pre-send + proven non-execution only). */
  retryable: boolean;
  /** Record the request as unconfirmed in the broker/session state. */
  markUnconfirmed: boolean;
  /** Honored Retry-After wait (ms) when trustworthy evidence exists. */
  retryAfterMs?: number;
  detail?: string;
}

/** Default cap for an honored Retry-After wait (conservative: 10 minutes). */
export const DEFAULT_RETRY_AFTER_MAX_WAIT_MS = 10 * 60_000;

/** Conservative default total wait before refusing to keep honoring waits. */
const MAX_RETRY_AFTER_MS_HARD_CAP = 24 * 60 * 60_000;

/**
 * Failures that COUNT toward opening a circuit breaker: the transient
 * network/stall/infrastructure family ONLY. AUTH_REQUIRED, QUOTA_EXHAUSTED
 * and RATE_LIMITED are policy conditions (credentials/usage limits) — they
 * are never "healed" by retrying or switching, so they never open circuits.
 */
export const BREAKER_COUNTABLE: ReadonlySet<ProviderFailureCode> = new Set([
  'NETWORK_TIMEOUT',
  'NETWORK_UNKNOWN_AFTER_SEND',
  'GENERATION_STALLED',
  'UI_SELECTOR_CHANGED',
  'CONVERSATION_RESTORE_FAILED',
  'PROVIDER_UNAVAILABLE',
  'PROFILE_OWNER_UNAVAILABLE',
]);

const DEFAULT_MAX_WAIT = DEFAULT_RETRY_AFTER_MAX_WAIT_MS;

/**
 * Parses a Retry-After value. Returns the wait in ms, or null when the value
 * is absent, invalid (negative/zero/garbage/past date), or beyond the
 * configurable maximum wait (never auto-wait indefinitely).
 */
export function parseRetryAfter(
  value: string | number | null | undefined,
  opts: { maxWaitMs?: number; now?: () => number } = {}
): number | null {
  if (value === null || value === undefined) return null;
  const maxWaitMs = Math.min(Math.max(0, opts.maxWaitMs ?? DEFAULT_MAX_WAIT), MAX_RETRY_AFTER_MS_HARD_CAP);
  const now = opts.now ?? Date.now;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    const ms = Math.round(value * 1000);
    return ms > 0 && ms <= maxWaitMs ? ms : null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const sec = Number(trimmed);
    if (sec <= 0) return null;
    const ms = Math.round(sec * 1000);
    return ms > 0 && ms <= maxWaitMs ? ms : null;
  }
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return null; // unparseable date
  const delta = when - now();
  if (delta <= 0) return null; // already past — nothing to wait for
  return delta <= maxWaitMs ? delta : null;
}

/** The network-family codes whose result provability decides unconfirmed. */
const NETWORK_FAMILY: ReadonlySet<ProviderFailureCode> = new Set([
  'NETWORK_TIMEOUT',
  'GENERATION_STALLED',
]);

const AUTH_MESSAGE =
  /not authenticated|unauthenticated|please log in|log ?in required|log ?in\b|session expired|login expired|redirected to .*\/(auth|login)/i;
const AUTH_TOKEN = /unauthorized|authentication_error|permission_denied|invalid_api_key|invalid_apikey/i;
const RATE_TOKEN = /rate_limit/i; // clear provider code shape (e.g. rate_limit_error) — NOT vague prose
const QUOTA_TOKEN = /insufficient_quota|quota_exceeded|billing_hard_limit|credit_balance|payment_required/i;
const TIMEOUT_MESSAGE = /\btimed?\s*out\b|timeout\b|etimedout/i;
const ABORT_MESSAGE = /request was aborted|operation was aborted/i;
const STALL_MESSAGE = /generation stalled|stalled?: no output/i;
const SELECTOR_MESSAGE = /\bselector\b|\blocator\b/i;
const OWNER_MESSAGE = /profile owner unavailable|owner unavailable|claim refused|profile is owned/i;

const isAbort = (e: unknown): boolean => {
  const name = (e as { name?: string })?.name ?? '';
  return name === 'AbortError' || ABORT_MESSAGE.test((e as Error)?.message ?? '');
};

/**
 * Evidence-first detection: explicit structured codes → HTTP status →
 * confirmed page markers → message text (message text may only establish
 * auth/selector/stall/owner/timeout/abort facts — NEVER rate/quota).
 */
function detectCode(e: unknown, ctx: FailureContext): ProviderFailureCode {
  const err = e as { code?: unknown; type?: unknown; status?: unknown; name?: string; message?: string };
  const codeStr = typeof err.code === 'string' ? err.code : typeof err.type === 'string' ? (err.type as string) : '';
  const message = err?.message ?? '';

  // 1. Structured provider/API codes (trustworthy by construction).
  if (codeStr) {
    if (QUOTA_TOKEN.test(codeStr)) return 'QUOTA_EXHAUSTED';
    if (RATE_TOKEN.test(codeStr)) return 'RATE_LIMITED';
    if (AUTH_TOKEN.test(codeStr)) return 'AUTH_REQUIRED';
    if (/etimedout|timeout/i.test(codeStr)) return 'NETWORK_TIMEOUT';
  }

  // 2. HTTP status evidence.
  const status = ctx.status ?? (typeof err.status === 'number' ? err.status : undefined);
  if (status === 402) return 'QUOTA_EXHAUSTED';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 401 || status === 403) return 'AUTH_REQUIRED';

  // 3. Confirmed page markers (explicitly observed, not prose).
  const marker = ctx.pageMarker ?? '';
  if (marker === 'rate_limit' || marker === '429') return 'RATE_LIMITED';
  if (marker === 'quota_exhausted') return 'QUOTA_EXHAUSTED';
  if (marker === 'auth_required' || marker === 'login_page') return 'AUTH_REQUIRED';
  if (marker === 'generation_stalled') return 'GENERATION_STALLED';

  // 4. Message-text facts (only for non-usage-limit families).
  if (SELECTOR_MESSAGE.test(message) && TIMEOUT_MESSAGE.test(message)) return 'UI_SELECTOR_CHANGED';
  if (err.name === 'ProfileBusyError' || OWNER_MESSAGE.test(message)) return 'PROFILE_OWNER_UNAVAILABLE';
  if (STALL_MESSAGE.test(message)) return 'GENERATION_STALLED';
  if (AUTH_MESSAGE.test(message)) return 'AUTH_REQUIRED';
  if (TIMEOUT_MESSAGE.test(message)) return 'NETWORK_TIMEOUT';
  if (/econnrefused|enotfound|econnreset|eai_again|network error|socket hang up|net::err/i.test(message)) {
    return 'PROVIDER_UNAVAILABLE';
  }
  if (isAbort(e)) return 'ABORT' as unknown as ProviderFailureCode; // resolved in phase step
  if (status !== undefined && status >= 500) return 'PROVIDER_UNAVAILABLE';
  return 'PROVIDER_UNAVAILABLE';
}

/**
 * Core classification: detect → then apply the phase/send-marker rules.
 * Nothing becomes retryable without proven non-execution.
 */
export function classifyFailure(err: unknown, ctx: FailureContext = {}): ProviderFailure {
  const phase: ExecutionPhase = ctx.phase ?? 'pre-send';
  const sent = ctx.sent ?? false;
  const confirmedResult = ctx.confirmedResult ?? false;

  let code: ProviderFailureCode;
  let retryAfterMs: number | undefined;
  let abort = false;

  if (err instanceof ProviderFailureError) {
    // Already classified upstream (e.g. by a driver): preserve the code,
    // but the caller's phase/send knowledge still governs state decisions.
    code = err.failure.code;
    retryAfterMs = err.failure.retryAfterMs;
    abort = false;
  } else {
    const detected = detectCode(err, ctx);
    if ((detected as string) === 'ABORT') {
      abort = true;
      code = 'PROVIDER_UNAVAILABLE'; // provisional; resolved below by phase
    } else {
      code = detected;
    }
    if (code === 'RATE_LIMITED') {
      retryAfterMs = parseRetryAfter(ctx.retryAfter) ?? undefined;
    }
  }

  // Restore phase: any failure while restoring a conversation is a restore
  // failure (no automatic new conversation, no auto retry, nothing sent yet).
  if (phase === 'restore' && code !== 'AUTH_REQUIRED' && code !== 'QUOTA_EXHAUSTED' && code !== 'RATE_LIMITED') {
    return { code: 'CONVERSATION_RESTORE_FAILED', phase, sent, confirmedResult, retryable: false, markUnconfirmed: false, detail: 'conversation restore failed' };
  }

  // Client abort resolution (owner decision: unknown-provenance aborts are
  // never silently retried).
  if (abort) {
    if (sent && !confirmedResult) {
      return { code: 'NETWORK_UNKNOWN_AFTER_SEND', phase, sent, confirmedResult, retryable: false, markUnconfirmed: true, detail: 'aborted after a possible send' };
    }
    return { code: 'PROVIDER_UNAVAILABLE', phase, sent, confirmedResult, retryable: false, markUnconfirmed: false, detail: 'aborted before send' };
  }

  // Network family: a possible send without a provable result is UNKNOWN
  // (the total timeout must never re-execute a sent message).
  if (code === 'NETWORK_TIMEOUT' && sent && !confirmedResult) {
    return { code: 'NETWORK_UNKNOWN_AFTER_SEND', phase, sent, confirmedResult, retryable: false, markUnconfirmed: true, detail: 'send happened; result unprovable' };
  }

  // A stall keeps its own code: the outcome is unconfirmed when nothing
  // provable exists, but it is never silently turned into an unknown.
  if (code === 'GENERATION_STALLED') {
    return { code, phase, sent, confirmedResult, retryable: false, markUnconfirmed: sent && !confirmedResult };
  }

  // Usage/credentials policies: never auto-retry, never auto-switch; after a
  // possible send the outcome is unconfirmed (kept code, unconfirmed state).
  if (code === 'AUTH_REQUIRED' || code === 'QUOTA_EXHAUSTED' || code === 'RATE_LIMITED') {
    return {
      code,
      phase,
      sent,
      confirmedResult,
      retryable: false,
      markUnconfirmed: sent && !confirmedResult,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    };
  }

  // Proven non-execution network failures: pre-send retry is safe.
  if (code === 'NETWORK_TIMEOUT' || code === 'PROVIDER_UNAVAILABLE') {
    const retryable = !sent && phase === 'pre-send';
    return { code, phase, sent, confirmedResult, retryable, markUnconfirmed: false };
  }

  // The rest (stall handled above; selector/owner/unknown-after-send) never
  // auto-retry: retrying does not repair selectors, owners, or unknowns.
  return { code, phase, sent, confirmedResult, retryable: false, markUnconfirmed: code === 'NETWORK_UNKNOWN_AFTER_SEND' ? true : false };
}

/** Thrown across route boundaries so the classification survives the throw. */
export class ProviderFailureError extends Error {
  readonly failure: ProviderFailure;
  constructor(failure: ProviderFailure, message?: string) {
    super(message ?? `${failure.code} (phase=${failure.phase}, sent=${failure.sent}, confirmedResult=${failure.confirmedResult})`);
    this.name = 'ProviderFailureError';
    this.failure = failure;
  }
}

// ---------------------------------------------------------------------------
// Secret-free diagnostics (§G)
// ---------------------------------------------------------------------------

const SECRET_FIELD = /api[-_]?key|authorization|bearer|cookie|token|secret|password|credential/i;
/** Chat-content carriers that must never land in logs. */
const CONTENT_FIELD = /\bmessages\b|\bprompt\b|\bcontent\b|\bcompletion\b|\bchat\b|\btext\b|\bbody\b/i;

function sanitize(value: unknown, key = ''): unknown {
  if (SECRET_FIELD.test(key)) return undefined;
  if (CONTENT_FIELD.test(key) && key !== 'sessionKey') return undefined;
  if (typeof value === 'string') {
    // Defensive: strip bearer/cookie-looking payloads inside values.
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
      .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]');
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, key));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const s = sanitize(v, k);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return value;
}

export interface DiagnosticsInput extends Record<string, unknown> {
  requestId?: string;
  sessionKey?: string;
  providerId?: string;
  profileId?: string;
  ownerInstanceId?: string;
  workerId?: string;
  epoch?: string;
  failureCode?: string;
  phase?: string;
  requestState?: string;
  durationMs?: number;
  sent?: boolean;
  confirmed?: boolean;
}

/** Uniform §G diagnostics: redacted sessionKey, no secrets, no chat content. */
export function buildDiagnostics(input: DiagnosticsInput): Record<string, unknown> {
  const clean = sanitize({ ...input }) as Record<string, unknown>;
  if (typeof input.sessionKey === 'string') {
    clean.sessionKey = input.sessionKey.slice(0, 24); // redacted prefix only
  }
  return clean;
}

/** Stable diagnostics identity for a request (secret-free). */
export function diagnosticFingerprint(requestId: string, providerId: string): string {
  return createHash('sha1').update(`${providerId}\0${requestId}`).digest('hex').slice(0, 16);
}

/** Stable snapshot for /health — one registry per process. */
let globalRegistry: ResilienceRegistry | undefined;
export function getGlobalResilienceRegistry(): ResilienceRegistry {
  return (globalRegistry ??= new ResilienceRegistry());
}

// ---------------------------------------------------------------------------
// ResilienceRegistry — process-local memory for /health (last failure/success)
// ---------------------------------------------------------------------------

export interface ProviderResilienceSnapshot {
  providerId: string;
  profileId: string;
  lastFailureCode?: string;
  lastFailureAt?: number;
  lastFailureSent?: boolean;
  lastFailureConfirmed?: boolean;
  lastSuccessAt?: number;
}

export class ResilienceRegistry {
  private readonly entries = new Map<string, ProviderResilienceSnapshot>();

  private key(providerId: string, profileId: string): string {
    return `${providerId}::${profileId}`;
  }

  recordFailure(providerId: string, profileId: string, code: string, meta: { sent?: boolean; confirmed?: boolean } = {}): void {
    const k = this.key(providerId, profileId);
    const prev = this.entries.get(k) ?? { providerId, profileId };
    this.entries.set(k, {
      ...prev,
      lastFailureCode: code,
      lastFailureAt: Date.now(),
      lastFailureSent: meta.sent,
      lastFailureConfirmed: meta.confirmed,
    });
  }

  recordSuccess(providerId: string, profileId: string): void {
    const k = this.key(providerId, profileId);
    const prev = this.entries.get(k) ?? { providerId, profileId };
    this.entries.set(k, { ...prev, lastSuccessAt: Date.now() });
  }

  snapshot(): Record<string, ProviderResilienceSnapshot> {
    return Object.fromEntries(this.entries);
  }
}
