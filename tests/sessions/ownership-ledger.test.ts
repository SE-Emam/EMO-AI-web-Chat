import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { OwnershipLedger } from '../../src/sessions/ownership-ledger.js';

const tsxCli = () => path.resolve('node_modules/tsx/dist/cli.mjs');

describe('OwnershipLedger', () => {
  const dirs: string[] = [];
  const children: ChildProcess[] = [];
  afterEach(() => {
    for (const c of children.splice(0)) c.kill();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const makeLedger = () => {
    const d = mkdtempSync(path.join(tmpdir(), 'emo-own-'));
    dirs.push(d);
    return { dir: d, ledger: new OwnershipLedger(path.join(d, 'profile-ownership.json')) };
  };

  it('first claim acquires', async () => {
    const { ledger } = makeLedger();
    const r = await ledger.claimProfile('/profiles/p1', 'owner-1');
    expect(r.status).toBe('acquired');
  });

  it('a DEAD pid claim is stolen', async () => {
    const { dir, ledger } = makeLedger();
    const store = path.join(dir, 'profile-ownership.json');
    // Handcraft a claim by a dead process, aged past the heartbeat TTL.
    const now = Date.now();
    writeFileSync(
      store,
      JSON.stringify({
        version: 1,
        entries: [{ profileDir: '/profiles/p2', ownerInstanceId: 'ghost', pid: 999999999, epoch: 'e1', heartbeatAt: now - 60_000 }],
      })
    );
    const r = await ledger.claimProfile('/profiles/p2', 'owner-2');
    expect(r.status).toBe('stolen');
    const entry = ledger.get('/profiles/p2');
    expect(entry?.ownerInstanceId).toBe('owner-2');
  });

  it('a LIVE pid with a STALE heartbeat is NEVER stolen (busy — owner ruling: stale heartbeat ≠ death)', async () => {
    const { dir, ledger } = makeLedger();
    const store = path.join(dir, 'profile-ownership.json');
    // LIVE pid (this process) whose heartbeat is 120s old — e.g. a long
    // ChatGPT turn in progress. Another claimant must NOT take over.
    writeFileSync(
      store,
      JSON.stringify({
        version: 1,
        entries: [{ profileDir: '/profiles/p3', ownerInstanceId: 'slow-owner', pid: process.pid, epoch: 'e1', heartbeatAt: Date.now() - 120_000 }],
      })
    );
    const r = await ledger.claimProfile('/profiles/p3', 'owner-3');
    expect(r.status).toBe('busy');
    expect((r as any).owner?.ownerInstanceId).toBe('slow-owner');
    // The lag is surfaced as a warning signal, not as ownership loss.
    expect((r as any).staleHeartbeat).toBe(true);
    expect(ledger.get('/profiles/p3')?.ownerInstanceId).toBe('slow-owner'); // claim intact
  });

  it('a DEAD pid is stolen even with a FRESH heartbeat (only proven death enables takeover)', async () => {
    const { dir, ledger } = makeLedger();
    const store = path.join(dir, 'profile-ownership.json');
    writeFileSync(
      store,
      JSON.stringify({
        version: 1,
        entries: [{ profileDir: '/profiles/p3b', ownerInstanceId: 'crashed-owner', pid: 999999999, epoch: 'e1', heartbeatAt: Date.now() }],
      })
    );
    const r = await ledger.claimProfile('/profiles/p3b', 'owner-3b');
    expect(r.status).toBe('stolen');
  });

  it('a LIVE recent claim from another owner is busy WITH owner details', async () => {
    const { ledger } = makeLedger();
    await ledger.claimProfile('/profiles/p4', 'owner-live');
    const r = await ledger.claimProfile('/profiles/p4', 'owner-other');
    expect(r.status).toBe('busy');
    expect((r as any).owner?.ownerInstanceId).toBe('owner-live');
    expect((r as any).owner?.pid).toBe(process.pid);
  });

  it('release by a NON-owner is rejected; by the owner succeeds', async () => {
    const { ledger } = makeLedger();
    await ledger.claimProfile('/profiles/p5', 'owner-real');
    const wrong = await ledger.releaseProfile('/profiles/p5', 'owner-imposter');
    expect(wrong).toBe(false);
    expect(ledger.get('/profiles/p5')?.ownerInstanceId).toBe('owner-real');
    const right = await ledger.releaseProfile('/profiles/p5', 'owner-real');
    expect(right).toBe(true);
    expect(ledger.get('/profiles/p5')).toBeNull();
  });

  it('heartbeat refreshes the claim', async () => {
    const { ledger } = makeLedger();
    await ledger.claimProfile('/profiles/p6', 'owner-hb');
    const before = ledger.get('/profiles/p6')!.heartbeatAt;
    await new Promise((r) => setTimeout(r, 15));
    await ledger.heartbeat('/profiles/p6', 'owner-hb');
    expect(ledger.get('/profiles/p6')!.heartbeatAt).toBeGreaterThan(before);
  });

  it('TWO REAL PROCESSES: one acquires, the other is refused with owner info', async () => {
    const { dir } = makeLedger();
    const outFile = path.join(dir, 'racer.out');
    const script = path.resolve('tests/fixtures/ownership-racer.ts');
    const run = (id: string) => spawn(process.execPath, [tsxCli(), script, path.join(dir, 'profile-ownership.json'), outFile, id], { stdio: 'ignore' });
    const a = run('A');
    const b = run('B');
    children.push(a, b);
    await Promise.all([
      new Promise<number>((res) => a.on('exit', (c) => res(c ?? 1))),
      new Promise<number>((res) => b.on('exit', (c) => res(c ?? 1))),
    ]).then((codes) => {
      expect(codes).toEqual([0, 0]);
    });
    const out = readFileSync(outFile, 'utf8');
    expect(out.split('\n').filter((l) => l.startsWith('ACQUIRED:'))).toHaveLength(1);
    expect(out.split('\n').filter((l) => l.startsWith('BUSY:'))).toHaveLength(1);
  }, 30_000);
});
