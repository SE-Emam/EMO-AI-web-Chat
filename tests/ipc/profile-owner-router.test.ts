/**
 * Task 11 step 5 — OwnerRoutingDriver with a DYNAMIC resolver (owner
 * mandatory mod #3) + ProfileBusyError interception + no silent provider
 * fail-over on ownership conflicts.
 *
 * TDD: failing first. The router module and ProfileBusyError do not exist.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OwnerRoutingDriver, ProfileOwnerRouter } from '../../src/ipc/profile-owner-router.js';
import { ProfileBusyError } from '../../src/arena/profile-busy-error.js';
import { RoutingDriver, type DriverRoute } from '../../src/arena/routing-driver.js';
import { startOwnerIpcServer } from '../../src/ipc/profile-owner-transport.js';
import { OwnershipLedger } from '../../src/sessions/ownership-ledger.js';
import type { ArenaDriver, ChatMessage } from '../../src/types.js';

const dirs: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close().catch(() => {});
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const makeMockDriver = (name: string, calls: string[]) => ({
  name,
  listModels: async () => [name],
  sendMessage: async (_m: string, _msgs: ChatMessage[], onChunk?: (c: string) => void) => {
    calls.push(name);
    onChunk?.(`chunk-from-${name}`);
    return `content-from-${name}`;
  },
  close: async () => { calls.push(`closed-${name}`); },
}) as ArenaDriver & { name: string };

const busyError = (over: Partial<ProfileBusyError> = {}) =>
  new ProfileBusyError(
    '503 profile in use by another gateway process: profile "/p1" is owned by owner=owner-A',
    { profileDir: '/p1', ownerInstanceId: 'owner-A', pid: process.pid, epoch: 'epoch-A1', heartbeatAt: Date.now(), ...over }
  );

describe('OwnerRoutingDriver (dynamic resolver)', () => {
  it('resolver is called PER REQUEST — driver switching between requests is reflected', async () => {
    const calls: string[] = [];
    const d1 = makeMockDriver('driver-1', calls);
    const d2 = makeMockDriver('driver-2', calls);
    let current = d1;
    const owner = new OwnerRoutingDriver({
      resolve: () => current,
      router: new ProfileOwnerRouter({ stateRoot: '/nonexistent-state-root', brokerStorePath: '/nonexistent-broker.json' }),
      nextForwardId: (() => { let i = 0; return () => `fwd-${++i}`; })(),
    });
    const msgs: ChatMessage[] = [{ role: 'user', content: 'hi' }];
    expect(await owner.sendMessage('m', msgs)).toBe('content-from-driver-1');
    current = d2; // account switch between requests
    expect(await owner.sendMessage('m', msgs)).toBe('content-from-driver-2');
    expect(calls).toEqual(['driver-1', 'driver-2']);
  });

  it('listModels and close delegate to the CURRENTLY resolved driver', async () => {
    const calls: string[] = [];
    const d1 = makeMockDriver('driver-1', calls);
    const owner = new OwnerRoutingDriver({
      resolve: () => d1,
      router: new ProfileOwnerRouter({ stateRoot: '/x', brokerStorePath: '/x.json' }),
      nextForwardId: () => 'fwd-x',
    });
    expect(await owner.listModels()).toEqual(['driver-1']);
    await owner.close();
    expect(calls).toContain('closed-driver-1');
  });
});

describe('ProfileBusyError interception → forward to owner', () => {
  it('live owner + live endpoint + shared store → forwards over real IPC, local driver NOT called', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'emo-router-'));
    dirs.push(d);
    const stateRoot = path.join(d, 'state');
    const brokerStorePath = path.join(stateRoot, 'request-broker.json');
    const profileDir = path.join(d, 'profile');
    const ledger = new OwnershipLedger(path.join(stateRoot, 'profile-ownership.json'));
    await ledger.claimProfile(profileDir, 'owner-A', 'epoch-A1');
    const server = await startOwnerIpcServer({
      profileDir, ownerInstanceId: 'owner-A', epoch: 'epoch-A1', stateRoot, brokerStorePath,
      hooks: {
        validate: () => 'ok' as const,
        execute: async (_cmd, onChunk) => { onChunk('owner'); onChunk(' executed'); return { content: 'owner executed' }; },
        onAccepted: () => {},
      },
    });
    servers.push(server);
    await ledger.updateIpcEndpoint(profileDir, 'owner-A', server.endpoint);

    const localCalls: string[] = [];
    const router = new ProfileOwnerRouter({
      stateRoot,
      brokerStorePath,
      ledgerPath: path.join(stateRoot, 'profile-ownership.json'),
    });
    const owner = new OwnerRoutingDriver({
      resolve: () => makeMockDriver('local-should-not-run', localCalls),
      router,
      nextForwardId: () => 'fwd-1',
    });
    // The local driver throws ProfileBusyError (as ensureContext would).
    const localBusy: ArenaDriver = {
      listModels: async () => [],
      sendMessage: async () => { throw busyError({ profileDir }); },
    };
    const guarded = new OwnerRoutingDriver({ resolve: () => localBusy, router, nextForwardId: () => 'fwd-1' });
    const chunks: string[] = [];
    const content = await guarded.sendMessage('model-x', [{ role: 'user', content: 'hi' }], (c) => chunks.push(c), undefined, 'sess-1');
    expect(content).toBe('owner executed');
    expect(chunks).toEqual(['owner', ' executed']); // chunk order preserved across IPC
    expect(localCalls).toEqual([]); // never executed locally
    void owner;
  });

  it('live owner but NO advertised endpoint → rethrows the ORIGINAL ProfileBusyError (no takeover, no silent switch)', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'emo-router2-'));
    dirs.push(d);
    const router = new ProfileOwnerRouter({ stateRoot: path.join(d, 'state'), brokerStorePath: path.join(d, 'state', 'request-broker.json') });
    const localCalls: string[] = [];
    const guarded = new OwnerRoutingDriver({
      resolve: () => ({
        listModels: async () => [],
        sendMessage: async () => { localCalls.push('busy'); throw busyError(); },
      }),
      router,
      nextForwardId: () => 'fwd-1',
    });
    await expect(guarded.sendMessage('m', [{ role: 'user', content: 'hi' }])).rejects.toThrow(ProfileBusyError);
    expect(localCalls).toEqual(['busy']);
  });

  it('shared-state mismatch (receiver uses a DIFFERENT broker store) → refuses to route, rethrows busy', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'emo-router3-'));
    dirs.push(d);
    const stateRoot = path.join(d, 'state');
    const brokerStorePath = path.join(stateRoot, 'request-broker.json');
    const profileDir = path.join(d, 'profile');
    const ledger = new OwnershipLedger(path.join(stateRoot, 'profile-ownership.json'));
    await ledger.claimProfile(profileDir, 'owner-A', 'epoch-A1');
    const server = await startOwnerIpcServer({
      profileDir, ownerInstanceId: 'owner-A', epoch: 'epoch-A1', stateRoot, brokerStorePath,
      hooks: { validate: () => 'ok' as const, execute: async () => ({ content: 'should-not-happen' }), onAccepted: () => {} },
    });
    servers.push(server);
    await ledger.updateIpcEndpoint(profileDir, 'owner-A', server.endpoint);
    // Router configured against a DIFFERENT (non-shared) broker store.
    const otherDir = mkdtempSync(path.join(tmpdir(), 'emo-router3b-'));
    dirs.push(otherDir);
    const router = new ProfileOwnerRouter({
      stateRoot: otherDir,
      brokerStorePath: path.join(otherDir, 'request-broker.json'),
      ledgerPath: path.join(stateRoot, 'profile-ownership.json'),
    });
    const guarded = new OwnerRoutingDriver({
      resolve: () => ({ listModels: async () => [], sendMessage: async () => { throw busyError({ profileDir }); } }),
      router,
      nextForwardId: () => 'fwd-1',
    });
    await expect(guarded.sendMessage('m', [{ role: 'user', content: 'hi' }])).rejects.toThrow(ProfileBusyError);
  });
});

describe('RoutingDriver: ownership conflict NEVER fails over', () => {
  it('ProfileBusyError inside a route chain aborts the chain (second provider not tried)', async () => {
    const calls: string[] = [];
    const busy: ArenaDriver = {
      listModels: async () => ['m1'],
      sendMessage: async () => { calls.push('busy-provider'); throw busyError(); },
    };
    const fallback: ArenaDriver = {
      listModels: async () => ['m1'],
      sendMessage: async () => { calls.push('fallback'); return 'fallback-content'; },
    };
    const routes: DriverRoute[] = [
      { name: 'chatgpt', driver: busy, matches: () => true },
      { name: 'zai', driver: fallback, matches: () => true },
    ];
    const rd = new RoutingDriver(routes);
    await expect(rd.sendMessage('m1', [{ role: 'user', content: 'hi' }])).rejects.toThrow(ProfileBusyError);
    expect(calls).toEqual(['busy-provider']);
  });
});
