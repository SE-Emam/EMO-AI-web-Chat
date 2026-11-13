/**
 * Task 11 step 3 — ownership ledger IPC extension (TDD: failing first).
 *
 * Adds OPTIONAL ipc fields to ProfileOwnershipEntry (backward compatible —
 * old ledger files without them must load fine) and updateIpcEndpoint().
 * The endpoint is advertised only via these fields; there is no parallel
 * ledger (owner constraint).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OwnershipLedger } from '../../src/sessions/ownership-ledger.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const makeLedger = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'emo-own-ipc-'));
  dirs.push(d);
  const store = path.join(d, 'profile-ownership.json');
  return { dir: d, store, ledger: new OwnershipLedger(store) };
};

describe('OwnershipLedger IPC extension (Task 11 step 3)', () => {
  it('updateIpcEndpoint writes ipcEndpoint/protocolVersion/startedAt for the OWNER only', async () => {
    const { ledger, store } = makeLedger();
    await ledger.claimProfile('/profiles/p1', 'owner-A', 'epoch-A1');
    const ok = await ledger.updateIpcEndpoint('/profiles/p1', 'owner-A', 'http://127.0.0.1:54321');
    expect(ok).toBe(true);
    const entry = ledger.get('/profiles/p1');
    expect(entry?.ipcEndpoint).toBe('http://127.0.0.1:54321');
    expect(entry?.protocolVersion).toBe(1);
    expect(typeof entry?.startedAt).toBe('number');
    void store;
  });

  it('updateIpcEndpoint refuses a non-owner (never disowns / never moves the claim)', async () => {
    const { ledger } = makeLedger();
    await ledger.claimProfile('/profiles/p1', 'owner-A', 'epoch-A1');
    const ok = await ledger.updateIpcEndpoint('/profiles/p1', 'owner-B', 'http://127.0.0.1:54321');
    expect(ok).toBe(false);
    expect(ledger.get('/profiles/p1')?.ipcEndpoint).toBeUndefined();
  });

  it('an OLD ledger file without IPC fields loads and claims without breaking', async () => {
    const { dir, store, ledger } = makeLedger();
    // Legacy v1 file: entries lack ipcEndpoint/protocolVersion/startedAt.
    writeFileSync(
      store,
      JSON.stringify({
        version: 1,
        entries: [{ profileDir: '/profiles/legacy', ownerInstanceId: 'ghost', pid: 999999999, epoch: 'e0', heartbeatAt: Date.now() - 60_000 }],
      })
    );
    // Reading the legacy entry must not throw.
    expect(ledger.get('/profiles/legacy')?.ownerInstanceId).toBe('ghost');
    // A new claim (dead pid → stolen) still works beside it.
    const r = await ledger.claimProfile('/profiles/new', 'owner-N', 'epoch-N1');
    expect(r.status).toBe('acquired');
    void dir;
  });

  it('profile dir paths are normalized (realpath): a symlinked path and its real path are the SAME profile', async () => {
    const { dir, ledger } = makeLedger();
    // macOS: /var/... is an alias of /private/var/... — realpath both sides.
    const { realpathSync } = await import('node:fs');
    const base = realpathSync(dir);
    const real = path.join(base, 'profiles', 'real');
    mkdirSync(real, { recursive: true });
    const link = path.join(base, 'profiles', 'link');
    symlinkSync(real, link);
    const a = await ledger.claimProfile(link, 'owner-A', 'e1');
    expect(a.status).toBe('acquired');
    // Same physical profile claimed via its real path → busy, same owner.
    const b = await ledger.claimProfile(real, 'owner-B', 'e2');
    expect(b.status).toBe('busy');
    if (b.status === 'busy') expect(b.owner.ownerInstanceId).toBe('owner-A');
    const entry = ledger.get(real);
    expect(entry?.profileDir).toBe(real);
    void dir;
  });
});
