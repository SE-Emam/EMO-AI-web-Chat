import type { Server as HttpServer } from 'node:http';

/**
 * Graceful shutdown for the Fastify HTTP server.
 *
 * Production incident (PID 91170, 2026-11-12): the old gateway received
 * SIGTERM, released browser/port/ownership, but never exited — it parked in
 * uv__io_poll for 10+ hours. Fastify 5 already closes IDLE keep-alive
 * connections during close (forceCloseConnections defaults to 'idle'), so the
 * blocker was an ACTIVE hijacked reply (an SSE/streaming handler that never
 * called reply.raw.end()) which keeps its socket "active" forever and makes
 * app.close() await it indefinitely.
 *
 * Shutdown sequence (user-approved design — deliberately NOT
 * forceCloseConnections:true applied blindly, which would abort in-flight
 * requests):
 *
 *  1. close idle keep-alive connections immediately (they hold no work),
 *  2. keep reaping idle connections during the grace window: Fastify's own
 *     'idle' mode calls closeIdleConnections() only ONCE, at the moment close
 *     starts — a socket that becomes idle AFTER that (e.g. an in-flight
 *     request that finishes mid-drain) would otherwise block server 'close'
 *     until the 72s keepAliveTimeout. Periodic reaping lets shutdown finish
 *     cleanly as soon as in-flight work completes,
 *  3. after the grace window (drainTimeoutMs), force-close ALL remaining
 *     connections (server.closeAllConnections) as an anti-hang guard, so
 *     shutdown always terminates — even when a hijacked stream is wedged
 *     permanently.
 */

export interface GracefulShutdownResult {
  /** true when the final force-close timer had to fire (some work was aborted). */
  forced: boolean;
  /** true when server.closeIdleConnections() was available and invoked. */
  idleClosed: boolean;
  /** Wall-clock duration of the whole close sequence. */
  drainedMs: number;
}

/**
 * Structural minimal contract so both a full FastifyInstance and a custom
 * serverFactory product ({ listen, close }) can be shut down gracefully.
 */
export interface CloseableServer {
  /** Underlying Node HTTP server (absent on minimal factory products). */
  server?: HttpServer;
  close(): Promise<unknown>;
}

export interface GracefulShutdownOptions {
  /** Grace window for in-flight requests before connections are force-closed. Default: 10_000. */
  drainTimeoutMs?: number;
}

/**
 * Closes a Fastify instance without ever hanging.
 *
 * Safe to call more than once (idempotent): a second call resolves with a
 * result instead of throwing even when the instance is already closed.
 */
export async function closeServerGracefully(
  app: CloseableServer,
  options: GracefulShutdownOptions = {}
): Promise<GracefulShutdownResult> {
  const drainTimeoutMs = options.drainTimeoutMs ?? 10_000;
  const startedAt = Date.now();
  const server = app.server as HttpServer | undefined;

  // 1) Idle keep-alives carry no in-flight work — close them right away.
  let idleClosed = false;
  if (server && typeof server.closeIdleConnections === 'function') {
    try {
      server.closeIdleConnections();
      idleClosed = true;
    } catch {
      idleClosed = false;
    }
  }

  // 2) Start the real close; in-flight requests drain normally.
  //    (Errors — e.g. instance already closed on a repeated call — are
  //    swallowed so shutdown is resolve-once safe.)
  const closePromise = app
    .close()
    .then(() => true, () => true);

  // 3) Anti-hang guard: after the grace window, force-close every remaining
  //    connection (active hijacked replies included). The timer is unref'd so
  //    a shutdown race with process.exit can never be held open by it alone.
  let forced = false;
  const forceTimer = setTimeout(() => {
    forced = true;
    if (server && typeof server.closeAllConnections === 'function') {
      try {
        server.closeAllConnections();
      } catch {
        // socket teardown races are non-fatal here; close() still resolves
      }
    }
  }, drainTimeoutMs);
  forceTimer.unref?.();

  // Continuous idle reaping during the drain window (Fastify reaps once, at
  // close start only). Sockets that go idle mid-drain — a completed in-flight
  // request's keep-alive, for example — are closed on the next tick so
  // server 'close' (and thus app.close()) resolves promptly, without force.
  const reapTimer = setInterval(() => {
    if (server && typeof server.closeIdleConnections === 'function') {
      try {
        server.closeIdleConnections();
      } catch {
        // server already closed — nothing left to reap
      }
    }
  }, 500);
  reapTimer.unref?.();

  try {
    await closePromise;
  } finally {
    clearTimeout(forceTimer);
    clearInterval(reapTimer);
  }

  return { forced, idleClosed, drainedMs: Date.now() - startedAt };
}
