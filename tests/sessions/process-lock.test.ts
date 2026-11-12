import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { ProcessLock, lockFilePathFor } from '../../src/sessions/process-lock.js';

const tsxBin = path.resolve('node_modules/.bin/tsx');

describe('ProcessLock', () => {
  const dirs: string[] = [];
  const children: ChildProcess[] = [];
  afterEach(() => {
    for (const c of children.splice(0)) c.kill();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const makeDir = () => {
    const d = mkdtempSync(path.join(tmpdir(), 'emo-lock-'));
    dirs.push(d);
    return d;
  };

  it('grants exclusive access to a concurrent contender within the same process', async () => {
    const dir = makeDir();
    const lock = new ProcessLock({ lockDir: dir });
    const handle = await lock.tryAcquire('res-a');
    expect(handle).not.toBeNull();
    const contender = await lock.tryAcquire('res-a');
    expect(contender).toBeNull();
    handle!.release();
    const after = await lock.tryAcquire('res-a');
    expect(after).not.toBeNull();
    after!.release();
  });

  it('releases the lock even when the callback throws (try/finally semantics)', async () => {
    const dir = makeDir();
    const lock = new ProcessLock({ lockDir: dir });
    await expect(
      lock.withLock('res-err', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    const again = await lock.tryAcquire('res-err');
    expect(again).not.toBeNull();
    again!.release();
  });

  it('steals a stale lock whose owning process is dead', async () => {
    const dir = makeDir();
    // Handcraft a lock file owned by a PID that does not exist, at the path
    // the lock would actually use for resource "stale".
    const lockFile = lockFilePathFor(dir, 'stale');
    writeFileSync(lockFile, JSON.stringify({ pid: 999999999, ownerInstanceId: 'ghost', acquiredAt: Date.now() - 60_000 }));
    const lock = new ProcessLock({ lockDir: dir });
    const stolen = await lock.tryAcquire('stale');
    expect(stolen).not.toBeNull();
    stolen!.release();
  });

  it('does NOT steal a lock held by a live process (the current process)', async () => {
    const dir = makeDir();
    const lockFile = lockFilePathFor(dir, 'live');
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, ownerInstanceId: 'someone-else', acquiredAt: Date.now() }));
    const lock = new ProcessLock({ lockDir: dir, waitTimeoutMs: 300 });
    await expect(lock.withLock('live', async () => 'x')).rejects.toThrow(/busy/i);
    // Cleanup for afterEach
    rmSync(lockFile, { force: true });
  });

  it('exactly ONE of two real child processes claims the same resource simultaneously', async () => {
    const dir = makeDir();
    const outFile = path.join(dir, 'racer.out');
    const resource = 'shared-resource';
    const racerScript = path.resolve('tests/fixtures/lock-racer.ts');
    const tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs');
    const proc = (id: string) =>
      spawn(process.execPath, [tsxCli, racerScript, resource, outFile, id], {
        stdio: 'ignore',
      });
    const a = proc('A');
    const b = proc('B');
    children.push(a, b);
    const exited = await Promise.all([
      new Promise<number>((res) => a.on('exit', (c) => res(c ?? 1))),
      new Promise<number>((res) => b.on('exit', (c) => res(c ?? 1))),
    ]);
    expect(exited).toEqual([0, 0]);
    const out = readFileSync(outFile, 'utf8');
    const winners = out.split('\n').filter((l) => l.startsWith('WINNER:'));
    const losers = out.split('\n').filter((l) => l.startsWith('LOSER:'));
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(existsSync(path.join(dir, 'shared-resource.lock'))).toBe(false);
  });

  it('two real child processes run under the lock one after the other (serialized, both succeed)', async () => {
    const dir = makeDir();
    const outFile = path.join(dir, 'serial.out');
    const racerScript = path.resolve('tests/fixtures/lock-serial.ts');
    const tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs');
    const a = spawn(process.execPath, [tsxCli, racerScript, 'serial-resource', outFile, 'A'], { stdio: 'ignore' });
    const b = spawn(process.execPath, [tsxCli, racerScript, 'serial-resource', outFile, 'B'], { stdio: 'ignore' });
    children.push(a, b);
    const exited = await Promise.all([
      new Promise<number>((res) => a.on('exit', (c) => res(c ?? 1))),
      new Promise<number>((res) => b.on('exit', (c) => res(c ?? 1))),
    ]);
    expect(exited).toEqual([0, 0]);
    const lines = readFileSync(outFile, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]!.startsWith('ENTER:')).toBe(true);
    expect(lines[1]!.startsWith('ENTER:')).toBe(true);
  }, 30_000);

  // ---- Task 10: release may only delete a lock it can PROVE it owns ----

  it('Task 10: releases a lock whose ownerInstanceId matches (correct ownership)', async () => {
    const dir = makeDir();
    const lock = new ProcessLock({ lockDir: dir });
    const handle = lock.tryAcquire('own-res')!;
    expect(handle).not.toBeNull();
    const file = lockFilePathFor(dir, 'own-res');
    expect(existsSync(file)).toBe(true);
    handle.release();
    expect(existsSync(file)).toBe(false); // proven owner → deleted
  });

  it('Task 10: does NOT delete the lock when ownerInstanceId belongs to someone else', async () => {
    const dir = makeDir();
    const lock = new ProcessLock({ lockDir: dir });
    const handle = lock.tryAcquire('foreign-res')!;
    const file = lockFilePathFor(dir, 'foreign-res');
    // Simulate the file having been taken over / rewritten by another owner.
    writeFileSync(file, JSON.stringify({ pid: process.pid, ownerInstanceId: 'someone-else', acquiredAt: Date.now() }));
    handle.release();
    expect(existsSync(file)).toBe(true); // another owner's lock survives
    expect(JSON.parse(readFileSync(file, 'utf8')).ownerInstanceId).toBe('someone-else');
    rmSync(file, { force: true }); // test cleanup
  });

  it('Task 10: does NOT auto-delete a CORRUPT lock file on release', async () => {
    const dir = makeDir();
    const lock = new ProcessLock({ lockDir: dir });
    const handle = lock.tryAcquire('corrupt-res')!;
    const file = lockFilePathFor(dir, 'corrupt-res');
    writeFileSync(file, '{"pid": 1, "ownerInstan'); // truncated/corrupt
    handle.release();
    expect(existsSync(file)).toBe(true); // unreadable → never guessed, never deleted
  });

  it('Task 10: does NOT delete a lock that cannot be verified (missing ownerInstanceId)', async () => {
    const dir = makeDir();
    const lock = new ProcessLock({ lockDir: dir });
    const handle = lock.tryAcquire('unverifiable-res')!;
    const file = lockFilePathFor(dir, 'unverifiable-res');
    writeFileSync(file, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() })); // no ownerInstanceId
    handle.release();
    expect(existsSync(file)).toBe(true); // ownership not provable → file stays
    rmSync(file, { force: true }); // test cleanup
  });

  it('Task 10: after a refused (unverifiable) release, the dead-owner steal path still works', async () => {
    const dir = makeDir();
    const lock = new ProcessLock({ lockDir: dir, staleTtlMs: 50 });
    const handle = lock.tryAcquire('recovery-res')!;
    const file = lockFilePathFor(dir, 'recovery-res');
    writeFileSync(file, 'garbage-not-json'); // becomes corrupt while we "own" it
    handle.release(); // refused — file left in place
    expect(existsSync(file)).toBe(true);
    // Recovery: a fresh contender takes over the DEAD owner's leftover (pid of
    // this test process would be alive, so handcraft a dead pid record first).
    writeFileSync(file, JSON.stringify({ pid: 999999999, ownerInstanceId: 'ghost', acquiredAt: Date.now() - 60_000 }));
    const contender = new ProcessLock({ lockDir: dir });
    const stolen = contender.tryAcquire('recovery-res');
    expect(stolen).not.toBeNull(); // recovery never blocked forever
    stolen!.release();
  });
});
