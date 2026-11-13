/**
 * Task 11 — RECEIVER GATEWAY child process fixture (real Node process).
 *
 * Usage: node tsx tests/fixtures/ipc-gateway-process.ts '<json-args>'
 * Args: {profileDir, ledgerPath, stateRoot, brokerStorePath, requestId,
 *        apiKeyScope?, providerId?, sessionKey?, stream?, forwardId,
 *        mode: 'forward' | 'forward-twice' | 'probe-claim'}
 *
 * 'forward': broker begin() (claim-once AT THE RECEIVER), then
 *   ProfileOwnerRouter.routeToOwner with a local driver that throws
 *   ProfileBusyError (as ensureContext would). Prints ONE JSON line result.
 * 'forward-twice': same forwardId re-sent — must never start a second
 *   execution (owner-side duplicate refusal + durable settle).
 * 'probe-claim': attempts ledger.claimProfile and prints the ClaimResult.
 */
import { OwnershipLedger } from '../../src/sessions/ownership-ledger.js';
import { ProfileBusyError } from '../../src/arena/profile-busy-error.js';
import { ProfileOwnerRouter } from '../../src/ipc/profile-owner-router.js';
import { normalizeProfileDir } from '../../src/ipc/profile-owner-transport.js';
import { RequestBroker, brokerKey } from '../../src/protocol/request-broker.js';
import type { ClaimResult } from '../../src/sessions/ownership-ledger.js';

function print(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function main(): Promise<void> {
  const args = JSON.parse(process.argv[2] ?? '{}');
  const ledger = new OwnershipLedger(args.ledgerPath);
  const router = new ProfileOwnerRouter({
    stateRoot: args.stateRoot,
    brokerStorePath: args.brokerStorePath,
    ledgerPath: args.ledgerPath,
  });

  if (args.mode === 'probe-claim') {
    const result: ClaimResult = await ledger.claimProfile(args.profileDir, `probe-${process.pid}`, args.epoch ?? 'probe-epoch');
    print({ probed: result });
    process.exit(0);
  }

  const normalized = normalizeProfileDir(args.profileDir);
  const entry = ledger.get(normalized);
  if (!entry) {
    print({ ok: false, error: 'no-ledger-entry' });
    process.exit(0);
  }
  const busy = new ProfileBusyError(
    `503 profile in use by another gateway process: profile "${args.profileDir}"`,
    {
      profileDir: args.profileDir,
      ownerInstanceId: entry.ownerInstanceId,
      pid: entry.pid,
      epoch: entry.epoch,
      heartbeatAt: entry.heartbeatAt,
    }
  );

  const broker = new RequestBroker(args.brokerStorePath);
  const scope = args.apiKeyScope ?? 'test-scope';
  const providerId = args.providerId ?? 'chatgpt-web';
  const key = brokerKey(scope, providerId, args.requestId);

  const attempt = async (forwardId: string) => {
    const begin = await broker.begin(key, args.sessionKey ?? null);
    if (!begin.allowed) {
      return {
        ok: false,
        error: 'begin_denied',
        state: begin.state,
        reason: begin.reason,
        result: (begin as { result?: unknown }).result ?? null,
      };
    }
    const chunks: string[] = [];
    try {
      const content = await router.routeToOwner(
        busy,
        {
          model: 'mock-model',
          messages: [{ role: 'user', content: 'hello' }],
          sessionKey: args.sessionKey,
          onChunk: (c: string) => chunks.push(c),
          stream: !!args.stream,
          broker: { key, apiKeyScope: scope, providerId, requestId: args.requestId },
        },
        forwardId
      );
      await begin.complete({ content });
      return { ok: true, content, chunks };
    } catch (e: unknown) {
      const err = e as { message?: string; settleOutcome?: string };
      const msg = e instanceof Error ? e.message : String(e);
      // Receiver-side durable decision (never in-memory only).
      const settle = await broker.settleForwardFailure(key, { executorPid: entry.pid }).catch(() => null);
      return {
        ok: false,
        error: msg,
        settleOutcome: err.settleOutcome ?? settle?.outcome ?? null,
        state: broker.get(key)?.state ?? null,
        chunks,
      };
    }
  };

  const first = await attempt(args.forwardId);
  if (args.mode === 'forward-twice') {
    // Re-send the SAME forwardId — idempotent re-acknowledgement rules apply.
    const second = await attempt(args.forwardId);
    print({ first, second });
  } else {
    print(first);
  }
  process.exit(0);
}

main().catch((e: unknown) => {
  print({ ok: false, error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
