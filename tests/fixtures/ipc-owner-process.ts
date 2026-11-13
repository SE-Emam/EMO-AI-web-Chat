/**
 * Task 11 — OWNER child process fixture (real Node process, NO Playwright,
 * NO network, NO real ChatGPT).
 *
 * Usage: node tsx tests/fixtures/ipc-owner-process.ts '<json-args>'
 * Args: {profileDir, ledgerPath, stateRoot, brokerStorePath, ownerInstanceId,
 *        epoch, mode: 'normal'|'crash-before-send'|'crash-after-send',
 *        streamChunks?: string[], driverDelayMs?: number,
 *        sessionSerialize?: boolean, markerPath?: string}
 *
 * Behavior:
 *  - claims the profile in the ledger (real OwnershipLedger on temp store);
 *  - starts the real loopback IPC server (real src/ipc transport);
 *  - uses createOwnerExecutionHooks: atomic attachForExecution on the SHARED
 *    broker store + identity/epoch validation;
 *  - mock driver: per-session serialization (same sessionKey runs one after
 *    the other), different sessions run concurrently; records execution
 *    markers (start/end timestamps + sessionKey) to markerPath;
 *  - crash modes: exit WITHOUT/ WITH markSent to prove durable settle rules.
 * At the end prints ONE JSON line: {"ready":true, "endpoint": "..."}.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { OwnershipLedger } from '../../src/sessions/ownership-ledger.js';
import { startOwnerIpcServer, type IpcCommandPayload } from '../../src/ipc/profile-owner-transport.js';
import { createOwnerExecutionHooks } from '../../src/ipc/profile-owner-router.js';
import type { ChatMessage } from '../../src/types.js';

function print(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function main(): Promise<void> {
  const args = JSON.parse(process.argv[2] ?? '{}');
  const ledger = new OwnershipLedger(args.ledgerPath);
  const claim = await ledger.claimProfile(args.profileDir, args.ownerInstanceId, args.epoch);
  if (claim.status === 'busy') {
    print({ ready: false, reason: 'busy', owner: claim.owner });
    process.exit(1);
  }

  const markers: Array<{ ev: string; sessionKey: string; forwardId?: string; at: number }> = [];
  const record = (ev: string, sessionKey: string, forwardId?: string) => {
    const m = { ev, sessionKey, forwardId, at: Date.now() };
    markers.push(m);
    if (args.markerPath) {
      try { appendFileSync(args.markerPath, JSON.stringify(m) + '\n'); } catch { /* temp dir gone */ }
    }
  };

  // Mock driver: same-session requests serialize; different sessions overlap.
  const sessionChains = new Map<string, Promise<void>>();
  const mockDriver = {
    listModels: async () => ['mock-model'],
    sendMessage: async (
      _model: string,
      _messages: ChatMessage[],
      onChunk?: (c: string) => void,
      _signal?: AbortSignal,
      sessionKey?: string
    ): Promise<string> => {
      const sk = sessionKey || 'default';
      record('start', sk);
      const prev = sessionChains.get(sk) ?? Promise.resolve();
      const run = (async () => {
        if (args.sessionSerialize) await prev.catch(() => {});
        for (const c of args.streamChunks ?? ['mock-chunk-1', 'mock-chunk-2']) {
          if (args.driverDelayMs) await new Promise((r) => setTimeout(r, args.driverDelayMs));
          onChunk?.(c);
        }
        if (args.driverDelayMs) await new Promise((r) => setTimeout(r, args.driverDelayMs));
      })();
      sessionChains.set(sk, run);
      await run;
      record('end', sk);
      return `owner-content(${sk})`;
    },
    close: async () => {},
  };

  const mode = args.mode ?? 'normal';
  const hooks = createOwnerExecutionHooks({
    resolve: () => mockDriver,
    brokerStorePath: args.brokerStorePath,
    ownerInstanceId: args.ownerInstanceId,
    epoch: args.epoch,
    pid: process.pid,
    markSentPolicy: mode === 'normal' ? 'before-execute' : 'manual',
  });

  let lastController: { markSentIfPending(): Promise<void> } | null = null;
  const server = await startOwnerIpcServer({
    profileDir: args.profileDir,
    ownerInstanceId: args.ownerInstanceId,
    epoch: args.epoch,
    stateRoot: args.stateRoot,
    brokerStorePath: args.brokerStorePath,
    hooks: {
      validate: hooks.validate,
      onAccepted: async (cmd: IpcCommandPayload) => {
        await hooks.onAccepted(cmd);
        lastController = hooks;
      },
      execute: async (cmd, onChunk, signal) => {
        record('execute', cmd.sessionKey, cmd.forwardId);
        if (mode === 'crash-before-send') {
          // Owner dies AFTER attach, BEFORE markSent → must settle retryable.
          print({ ready: true, crashed: 'before-send' });
          setTimeout(() => process.exit(9), 5);
          await new Promise(() => {}); // never resolves; process exits
        }
        if (mode === 'crash-after-send') {
          // Owner dies AFTER markSent → must settle unconfirmed.
          await lastController?.markSentIfPending();
          print({ ready: true, crashed: 'after-send' });
          setTimeout(() => process.exit(9), 5);
          await new Promise(() => {});
        }
        const r = await hooks.execute(cmd, onChunk, signal);
        return r;
      },
    },
  });

  // Advertise the endpoint on the ledger entry (only after listening).
  await ledger.updateIpcEndpoint(args.profileDir, args.ownerInstanceId, server.endpoint);
  if (args.readyFile) writeFileSync(args.readyFile, JSON.stringify({ endpoint: server.endpoint }));
  print({ ready: true, endpoint: server.endpoint, pid: process.pid, claimStatus: claim.status });

  // Keep alive until killed. The heartbeat interval is configurable so
  // timing-sensitive items (e.g. stale-heartbeat probing) can hold an aged
  // value long enough to probe it deterministically.
  const hbMs = typeof args.heartbeatIntervalMs === 'number' ? args.heartbeatIntervalMs : 200;
  const keep = setInterval(() => {
    void ledger.heartbeat(args.profileDir, args.ownerInstanceId, args.epoch);
  }, hbMs);
  keep.unref?.();
  process.on('SIGTERM', async () => {
    clearInterval(keep);
    await server.close().catch(() => {});
    await ledger.releaseProfile(args.profileDir, args.ownerInstanceId).catch(() => {});
    process.exit(0);
  });
}

main().catch((e: unknown) => {
  print({ ready: false, error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
