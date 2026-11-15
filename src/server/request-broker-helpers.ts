/**
 * SHARED idempotency layer over the ONE RequestBroker
 * (src/protocol/request-broker.ts — same store, ProcessLock,
 * ExecutionAttachment, markSent/complete/fail/markUnconfirmed semantics).
 *
 * There is deliberately NO per-protocol broker logic here beyond scope
 * framing: every protocol (OpenAI/Anthropic/Gemini) goes through the exact
 * same begin → execute | replay | conflict | denied lifecycle. Response
 * ADAPTERS (native body/SSE formatting) stay per-protocol by design —
 * they live in anthropic-adapter.ts / gemini-adapter.ts / app.ts.
 *
 * Scope (owner requirement #4): apiKeyScope + effective provider + requestId
 * + PROTOCOL. The protocol is part of the key's provider field
 * ('<protocol>:<providerId>') so a Gemini client can never be served an
 * Anthropic body for the same X-Request-Id value — cross-protocol replay is
 * impossible by construction. OpenAI keeps its legacy standalone path
 * (app.ts); its behavior is untouched.
 *
 * Fingerprint policy (owner requirement #3): the fingerprint is computed by
 * the CALLER over the protocol-specific body via payloadFingerprint()
 * (canonical: stable object key order, preserved array order, protocol
 * identity included, no secrets). The broker stores it and returns an
 * explicit CONFLICT when the same key is re-issued with a different
 * payload. Legacy entries without a stored fingerprint NEVER claim
 * diff-detection — they are served by the pre-existing state semantics
 * (documented backward compat, tested).
 */
import { createHash } from 'node:crypto';
import { brokerKey, type Begin, type SentController } from '../protocol/request-broker.js';
import type { RequestBroker } from '../protocol/request-broker.js';

export type BrokerProtocol = 'openai' | 'anthropic' | 'gemini';

/**
 * Canonical JSON: object keys sorted recursively (stable across property
 * insertion order), array order PRESERVED (message order is semantic).
 * Covers ALL fields in the body — any field that could change execution
 * (options, generation params, tool definitions, stream flag…) is part of
 * the fingerprint, and dropping a behavior-affecting field is impossible by
 * construction. Secrets are never part of request bodies (auth lives in
 * headers); nothing here logs the body.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
}

/**
 * Stable payload fingerprint: sha256(protocol \0 canonical-body). Includes
 * the protocol identity so the same JSON shape under two protocols can
 * never alias. Clients without X-Request-Id never reach this (no forced
 * idempotency — see beginBrokeredRequest).
 */
export function payloadFingerprint(body: unknown, protocol: BrokerProtocol): string {
  return createHash('sha256').update(`${protocol}\u0000${canonicalize(body)}`).digest('hex');
}

/**
 * Protocol-scoped broker key: brokerKey(apiKeyScope, '<protocol>:<providerId>',
 * requestId). Same X-Request-Id across protocols/API keys/providers →
 * different keys; within one protocol the existing (scope, provider,
 * requestId) isolation is unchanged.
 */
export function brokerScopedKey(args: {
  protocol: BrokerProtocol;
  apiKeyScope: string;
  providerId: string;
  requestId: string;
}): string {
  return brokerKey(args.apiKeyScope, `${args.protocol}:${args.providerId}`, args.requestId);
}

export type BrokeredClaim =
  /** No X-Request-Id → no forced idempotency; caller proceeds normally (trace id only). */
  | { kind: 'none' }
  /** Caller may execute; controller wires markSent/complete/fail/markUnconfirmed. */
  | { kind: 'execute'; key: string; controller: Pick<SentController, 'complete' | 'fail' | 'markUnconfirmed'> & { markSent: () => void } }
  /** Stored native result exists → serve the stored replay (per-protocol adapter formats it). */
  | { kind: 'replay'; key: string; result: unknown }
  /** Same key + different payload → explicit conflict (owner requirement #3). */
  | { kind: 'conflict'; key: string; state: string; reason: string }
  /** Duplicate while running / unconfirmed result / oversized completed result. */
  | { kind: 'denied'; key: string; state: string; reason?: string };

export interface BeginBrokeredArgs {
  protocol: BrokerProtocol;
  apiKeyScope: string;
  providerId: string;
  /** X-Request-Id from the client; null/absent → kind 'none' (opt-out semantics preserved). */
  requestId: string | null;
  /** payloadFingerprint of the request body (when a requestId exists). */
  fingerprint?: string;
  broker: RequestBroker;
  sessionKey?: string | null;
}

const OVERSIZED_REPLAY_REASON = 'completed result too large to replay — verify the outcome on the provider side, then re-issue with a NEW X-Request-Id';

/**
 * The one lifecycle every protocol shares. Cross-process atomic (the broker
 * runs the whole check-and-claim under its ProcessLock).
 */
export async function beginBrokeredRequest(args: BeginBrokeredArgs): Promise<BrokeredClaim> {
  if (!args.requestId) {
    // Owner requirement #4: never force idempotency onto clients that did
    // not opt in; the internal trace id is NOT an idempotency guarantee.
    return { kind: 'none' };
  }
  const key = brokerScopedKey({
    protocol: args.protocol,
    apiKeyScope: args.apiKeyScope,
    providerId: args.providerId,
    requestId: args.requestId,
  });
  const b: Begin = await args.broker.begin(key, args.sessionKey ?? null, args.fingerprint);
  if (b.allowed) {
    return { kind: 'execute', key, controller: b };
  }
  if (b.conflict) {
    return {
      kind: 'conflict',
      key,
      state: b.state,
      reason: b.reason || 'idempotency_key_reused_with_different_request',
    };
  }
  if (b.state === 'completed' && b.result !== undefined) {
    return { kind: 'replay', key, result: b.result };
  }
  if (b.state === 'completed') {
    // Completed but the result exceeded MAX_RESULT_BYTES → state-only entry.
    return { kind: 'denied', key, state: b.state, reason: OVERSIZED_REPLAY_REASON };
  }
  return { kind: 'denied', key, state: b.state, reason: b.reason };
}

/** Records the execution outcome on an 'execute' claim (store-once). */
export async function completeBrokered(
  claim: BrokeredClaim & { kind: 'execute' },
  result: unknown,
): Promise<void> {
  await claim.controller.complete(result);
}

/** Records a failure on an 'execute' claim (pre-send retry / post-send unconfirmed per broker policy). */
export async function failBrokered(
  claim: BrokeredClaim & { kind: 'execute' },
  opts: { retryable?: boolean; error?: string },
): Promise<void> {
  await claim.controller.fail(opts);
}

/** Marks the point after which any failure becomes unconfirmed (possible duplicate send). */
export function markSentBrokered(claim: BrokeredClaim & { kind: 'execute' }): void {
  claim.controller.markSent();
}

/** Explicit uncertainty: the request may or may not have reached the provider. */
export async function markUnconfirmedBrokered(
  claim: BrokeredClaim & { kind: 'execute' },
  reason: string,
): Promise<void> {
  await claim.controller.markUnconfirmed(reason);
}
