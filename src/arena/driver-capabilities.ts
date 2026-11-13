/**
 * Task 13 — declared driver capabilities (owner locked decisions).
 *
 * The session pattern is an EXPLICIT declared value, never a bare boolean
 * and never something a driver may silently fake:
 *
 *   'per-session-page'       each session gets its OWN page (TabScheduler),
 *                            conversations persist and are restored.
 *   'serialized-per-session' sessionKey is ACCEPTED and threaded; requests
 *                            serialize (same-session AND cross-session when
 *                            a single shared page exists); context is
 *                            carried per request (full history) — no
 *                            web-side conversation persistence.
 *   'single-session-only'    the driver refuses concurrent/multi-session use
 *                            explicitly.
 *   'unsupported'            no session semantics at all — declared loudly,
 *                            never a silent sessionKey ignore.
 *
 * The matrix in docs/provider-capabilities.md is generated FROM these
 * declarations + the runnable tests (tests/arena/driver-capabilities.test.ts)
 * — it is never filled from assumptions.
 */
import type { ChatMessage } from '../types.js';

export type SessionSupport =
  | 'per-session-page'
  | 'serialized-per-session'
  | 'single-session-only'
  | 'unsupported';

export interface DriverCapabilities {
  sessionSupport: SessionSupport;
  /** The driver saves/restores a web-side conversation URL across requests. */
  persistentConversation: boolean;
  /** The driver emits incremental deltas through onChunk. */
  streaming: boolean;
  /** The DRIVER itself parses/emits tool calls (route-level tool interpreter is out of scope here). */
  toolCalling: boolean;
  /** Short factual constraints, written from code — no marketing. */
  notes: string;
}

/**
 * Shared serialization lane for the standalone single-page drivers
 * (zai/qwen/gemini/claude web). EXACTLY the semantics their promise-queue
 * pattern had before Task 13 — one browser page cannot serve concurrent
 * chats — with the sessionKey made explicit instead of silently dropped.
 * Same-session requests serialize; DIFFERENT sessions serialize too, because
 * they share the one page (declared in capabilities.notes, not hidden).
 * Errors never poison the lane.
 */
export class SerializedSessionSendQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(label: string, sessionKey: string, fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(() => {
      console.log(`[${label}] session=${sessionKey.slice(0, 24)}`);
      return fn();
    });
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

/** Standard notes for the four standalone single-page web drivers. */
export const STANDALONE_SERIALIZED_NOTES =
  'single shared browser page: same-session AND cross-session requests serialize; every request starts a fresh web chat and carries the FULL conversation history in the prompt (context is restored per request, no web-side conversation URL persistence); sessionKey is accepted and serialized but never fakes per-session pages.';

/** Standard notes for the BaseWebDriver-scheduled drivers (chatgpt/tencent/…). */
export const SCHEDULED_PER_SESSION_NOTES =
  'per-session pages via TabScheduler over the existing TabWorkerPool (same session = serial lane, different sessions = parallel own pages); durable SessionState + SessionRegistry restore the conversation URL after a gateway restart.';
