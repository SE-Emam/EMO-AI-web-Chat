import { describe, it, expect } from 'vitest';
import { createServer } from '../../src/server/app.js';
import type { ArenaDriver, Config } from '../../src/types.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import http from 'node:http';

/**
 * P1 — Graceful shutdown (TDD).
 *
 * Production incident (PID 91170, 2026-11-12): SIGTERM released the browser,
 * port and ownership, but the process never exited (10+ hours parked in
 * uv__io_poll). Root cause CONFIRMED by experiment (/tmp/hang-experiment.ts):
 * Fastify 5.12.8 already defaults forceCloseConnections to 'idle', so idle
 * keep-alives do NOT block app.close(). What blocks it is an ACTIVE hijacked
 * reply (our SSE/streaming handlers call reply.hijack() and only reply.raw.end()
 * when the stream finishes) — a never-ended hijacked reply keeps the socket
 * "active" forever and app.close() awaits it indefinitely.
 *
 * Contract (user-approved design — NOT blind forceCloseConnections:true):
 *  1. idle keep-alive connections are closed immediately (never abort
 *     in-flight work),
 *  2. in-flight requests get a grace window (drainTimeoutMs) to COMPLETE,
 *  3. a final force-close timer (server.closeAllConnections) guarantees
 *     shutdown terminates even when a stream/reply never ends.
 */

const config: Config = { ...DEFAULT_CONFIG };

function makeDriver(reply = 'ok'): ArenaDriver {
  return {
    listModels: async () => ['m'],
    sendMessage: async () => reply,
  };
}

/** Opens a keep-alive connection, performs one request, and LEAVES the socket open (idle). */
async function openIdleKeepAlive(port: number): Promise<http.Agent> {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  await new Promise<void>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/health', agent },
      (res) => {
        res.resume();
        res.on('end', resolve);
      }
    );
    req.on('error', reject);
    req.end();
  });
  return agent;
}

/**
 * Reproduces the production incident: a hijacked streaming reply that writes
 * data but NEVER calls reply.raw.end() — the socket stays "active" forever.
 */
async function openStuckStream(port: number): Promise<http.ClientRequest> {
  const req = http.get({ host: '127.0.0.1', port, path: '/stuck-stream' }, (res) => {
    res.resume();
  });
  await new Promise((r) => setTimeout(r, 300)); // let it reach the hijacked handler
  return req;
}

function getPort(app: { server: { address(): unknown } }): number {
  return (app.server.address() as { port: number }).port;
}

describe('graceful shutdown (P1)', () => {
  it('RED-baseline: plain app.close() is BLOCKED by a hijacked never-ending reply (documents the incident)', async () => {
    const app = createServer(makeDriver(), config);
    app.get('/stuck-stream', async (_req, reply) => {
      reply.hijack();
      reply.raw.setHeader('content-type', 'text/event-stream');
      reply.raw.write('data: hello\n\n');
      // never ends — like a wedged SSE stream in production
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = getPort(app);
    const stuck = await openStuckStream(port);
    try {
      let resolved = false;
      const closePromise = app.close().then(() => { resolved = true; });
      await Promise.race([closePromise, new Promise((r) => setTimeout(r, 1200))]);
      // Document current (broken) behavior: close did NOT resolve within 1.2s
      expect(resolved).toBe(false);
      // unblock for the rest of the suite
      (app.server as any).closeAllConnections?.();
      await Promise.race([closePromise, new Promise((r) => setTimeout(r, 2000))]);
    } finally {
      stuck.destroy();
    }
  });

  it('idle keep-alive connection does NOT block graceful shutdown (regression guard)', async () => {
    const { closeServerGracefully } = await import('../../src/server/graceful-shutdown.js');
    const app = createServer(makeDriver(), config);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = getPort(app);
    const agent = await openIdleKeepAlive(port);
    try {
      const t0 = Date.now();
      const result = await closeServerGracefully(app, { drainTimeoutMs: 1500 });
      const elapsed = Date.now() - t0;
      expect(elapsed).toBeLessThan(4000);
      expect(result.forced).toBe(false);
      expect(result.idleClosed).toBe(true);
    } finally {
      agent.destroy();
    }
  });

  it('hijacked never-ending stream does NOT block graceful shutdown (forced after grace window)', async () => {
    const { closeServerGracefully } = await import('../../src/server/graceful-shutdown.js');
    const app = createServer(makeDriver(), config);
    app.get('/stuck-stream', async (_req, reply) => {
      reply.hijack();
      reply.raw.setHeader('content-type', 'text/event-stream');
      reply.raw.write('data: hello\n\n');
      // never ends — the exact production hang
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = getPort(app);
    const stuck = await openStuckStream(port);
    try {
      const t0 = Date.now();
      const result = await closeServerGracefully(app, { drainTimeoutMs: 1000 });
      const elapsed = Date.now() - t0;
      expect(elapsed).toBeLessThan(6000); // grace (1s) + force, not hours
      expect(result.forced).toBe(true);
    } finally {
      stuck.destroy();
    }
  });

  it('in-flight request COMPLETES during shutdown (grace window preserves it)', async () => {
    const { closeServerGracefully } = await import('../../src/server/graceful-shutdown.js');
    const slowDriver: ArenaDriver = {
      listModels: async () => ['m'],
      sendMessage: async () => {
        await new Promise((r) => setTimeout(r, 800));
        return 'slow-completed';
      },
    };
    const app = createServer(slowDriver, config);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = getPort(app);

    const reqPromise = new Promise<string>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST', headers: { 'content-type': 'application/json' } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve(body));
        }
      );
      req.on('error', reject);
      req.end(JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }));
    });
    await new Promise((r) => setTimeout(r, 150)); // request reaches the driver

    const closePromise = closeServerGracefully(app, { drainTimeoutMs: 5000 });
    const body = await reqPromise;
    expect(body).toContain('slow-completed');
    const result = await closePromise;
    expect(result.forced).toBe(false);
  });

  it('stuck driver beyond the grace window → forced close guarantees termination', async () => {
    const { closeServerGracefully } = await import('../../src/server/graceful-shutdown.js');
    const neverDriver: ArenaDriver = {
      listModels: async () => ['m'],
      sendMessage: () => new Promise(() => {}), // never resolves
    };
    const app = createServer(neverDriver, config);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = getPort(app);

    const reqPromise = new Promise<void>((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST', headers: { 'content-type': 'application/json' } },
        (res) => { res.resume(); res.on('end', resolve); res.on('close', resolve); }
      );
      req.on('error', () => resolve());
      req.end(JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }));
    });
    await new Promise((r) => setTimeout(r, 150));

    const t0 = Date.now();
    const result = await closeServerGracefully(app, { drainTimeoutMs: 1000 });
    const elapsed = Date.now() - t0;
    await reqPromise;
    expect(elapsed).toBeLessThan(6000);
    expect(result.forced).toBe(true);
  });

  it('shutdown is idempotent-safe: closing twice does not hang or throw', async () => {
    const { closeServerGracefully } = await import('../../src/server/graceful-shutdown.js');
    const app = createServer(makeDriver(), config);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const first = await closeServerGracefully(app, { drainTimeoutMs: 1000 });
    expect(first.forced).toBe(false);
    await expect(closeServerGracefully(app, { drainTimeoutMs: 1000 })).resolves.toBeDefined();
  });
});
