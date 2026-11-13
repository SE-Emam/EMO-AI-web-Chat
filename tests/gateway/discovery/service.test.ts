import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModelDiscoveryService } from '../../../src/gateway/discovery/service.js';
import { ModelSnapshotStore } from '../../../src/gateway/discovery/snapshot-store.js';
import { NotificationStore } from '../../../src/gateway/discovery/notification-store.js';
import { DiscoveryScheduler } from '../../../src/gateway/discovery/scheduler.js';
import { ProcessLock } from '../../../src/sessions/process-lock.js';
import type { DiscoveryRunner, DiscoverySessionOptions } from '../../../src/gateway/discovery/runner.js';
import type { ModelDiscoveryResult } from '../../../src/gateway/discovery/types.js';

const NOW = Date.parse('2026-11-13T00:00:00.000Z');

function model(id: string, name = id) {
  return { providerModelId: id, displayName: name, identityConfidence: 'stable-id' as const };
}

class FakeRunner implements DiscoveryRunner {
  readonly calls: DiscoverySessionOptions[] = [];
  results = new Map<string, ModelDiscoveryResult>();
  defaultResult: ModelDiscoveryResult | null = null;

  async run(options: DiscoverySessionOptions) {
    this.calls.push(options);
    const result = this.results.get(options.providerId) ?? this.defaultResult;
    return {
      providerId: options.providerId,
      captured: [],
      result:
        result ?? {
          providerId: options.providerId,
          source: 'web-ui-dom',
          complete: true,
          discoveredAt: new Date(NOW).toISOString(),
          models: [model('m1')],
        },
    };
  }
}

describe('Model discovery service', () => {
  let dir: string;
  let runner: FakeRunner;
  let snapshots: ModelSnapshotStore;
  let notifications: NotificationStore;
  let service: ModelDiscoveryService;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery-service-'));
    runner = new FakeRunner();
    snapshots = new ModelSnapshotStore(path.join(dir, 'snapshots.json'));
    notifications = new NotificationStore(path.join(dir, 'notifications.json'));
    service = new ModelDiscoveryService({
      runner,
      snapshots,
      notifications,
      providerName: (id) => id,
      profileDirFor: () => '/tmp/profile',
      now: () => NOW,
    });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('stores the FIRST scan as a baseline without notifying', async () => {
    const report = await service.discover('claude-web');
    expect(report.baseline).toBe(true);
    expect(report.changes).toHaveLength(0);
    expect(report.notificationsCreated).toBe(0);
    expect(await notifications.list()).toHaveLength(0);
    expect((await snapshots.get('claude-web'))?.models).toHaveLength(1);
  });

  it('notifies about a new model on the SECOND scan', async () => {
    await service.discover('claude-web');
    runner.results.set('claude-web', {
      providerId: 'claude-web',
      source: 'web-ui-dom',
      complete: true,
      discoveredAt: new Date(NOW + 1000).toISOString(),
      models: [model('m1'), model('m2', 'Model Two')],
    });
    const report = await service.discover('claude-web');
    expect(report.baseline).toBe(false);
    expect(report.changes).toHaveLength(1);
    expect(report.changes[0].type).toBe('model_added');
    expect(report.notificationsCreated).toBe(1);
    const list = await notifications.list();
    expect(list).toHaveLength(1);
    expect(list[0].displayName).toBe('Model Two');
    expect(list[0].link).toContain('claude-web');
  });

  it('never notifies twice about the same change', async () => {
    await service.discover('claude-web');
    runner.results.set('claude-web', {
      providerId: 'claude-web',
      source: 'web-ui-dom',
      complete: true,
      discoveredAt: new Date(NOW + 1000).toISOString(),
      models: [model('m1'), model('m2')],
    });
    await service.discover('claude-web');
    const second = await service.discover('claude-web');
    expect(second.notificationsCreated).toBe(0);
    expect(await notifications.list()).toHaveLength(1);
  });

  it('keeps the last good snapshot when a scan FAILS', async () => {
    await service.discover('claude-web');
    runner.results.set('claude-web', {
      providerId: 'claude-web',
      source: 'none',
      complete: false,
      discoveredAt: new Date(NOW + 1000).toISOString(),
      models: [],
      failureReason: 'provider_unavailable',
      detail: 'boom',
    });
    const report = await service.discover('claude-web');
    expect(report.status).toBe('failed');
    expect(report.failureReason).toBe('provider_unavailable');
    expect(report.models).toHaveLength(0);
    expect((await snapshots.get('claude-web'))?.models).toHaveLength(1);
  });

  it('reports a DEFERRED scan as deferred (not as a failure)', async () => {
    runner.results.set('claude-web', {
      providerId: 'claude-web',
      source: 'none',
      complete: false,
      discoveredAt: new Date(NOW).toISOString(),
      models: [],
      failureReason: 'deferred',
      detail: 'profile busy',
    });
    const report = await service.discover('claude-web');
    expect(report.status).toBe('deferred');
    expect(report.deferred).toBe(true);
    expect(report.failureReason).toBe('deferred');
  });

  it('reports UNSUPPORTED when the provider has no strategy', async () => {
    runner.results.set('claude-web', {
      providerId: 'claude-web',
      source: 'none',
      complete: false,
      discoveredAt: new Date(NOW).toISOString(),
      models: [],
      failureReason: 'discovery_unsupported',
    });
    const report = await service.discover('claude-web');
    expect(report.status).toBe('unsupported');
  });

  it('confirms a removal only after TWO complete scans', async () => {
    // Baseline with two models.
    runner.results.set('claude-web', {
      providerId: 'claude-web',
      source: 'web-ui-dom',
      complete: true,
      discoveredAt: new Date(NOW).toISOString(),
      models: [model('m1'), model('m2')],
    });
    await service.discover('claude-web');

    // m2 disappears (first complete scan) -> NOT removed yet.
    runner.results.set('claude-web', {
      providerId: 'claude-web',
      source: 'web-ui-dom',
      complete: true,
      discoveredAt: new Date(NOW + 1000).toISOString(),
      models: [model('m1')],
    });
    const first = await service.discover('claude-web');
    expect(first.changes.filter((c) => c.type === 'model_removed')).toHaveLength(0);

    // Second complete scan -> now it is a confirmed removal.
    const second = await service.discover('claude-web');
    expect(second.changes.filter((c) => c.type === 'model_removed')).toHaveLength(1);
    expect(second.changes.find((c) => c.type === 'model_removed')?.providerModelId).toBe('m2');
  });

  it('treats an EMPTY model list as a failed scan (the good snapshot survives)', async () => {
    runner.results.set('claude-web', {
      providerId: 'claude-web',
      source: 'web-ui-dom',
      complete: true,
      discoveredAt: new Date(NOW).toISOString(),
      models: [model('m1')],
    });
    await service.discover('claude-web');
    runner.results.set('claude-web', {
      providerId: 'claude-web',
      source: 'web-ui-dom',
      complete: true,
      discoveredAt: new Date(NOW + 1000).toISOString(),
      models: [],
    });
    const report = await service.discover('claude-web');
    expect(report.status).toBe('failed');
    expect((await snapshots.get('claude-web'))?.models).toHaveLength(1);
  });

  it('separates executable models from display-name-only models', async () => {
    runner.results.set('claude-web', {
      providerId: 'claude-web',
      source: 'web-ui-dom',
      complete: true,
      discoveredAt: new Date(NOW).toISOString(),
      models: [
        model('stable-1'),
        { providerModelId: undefined, displayName: 'Display Only', identityConfidence: 'display-name-only' as const },
      ],
    });
    const report = await service.discover('claude-web');
    expect(report.executableModels).toEqual(['stable-1']);
    expect(report.displayNameOnlyModels).toEqual(['Display Only']);
  });

  it('refuses to run two scans of the same provider at once', async () => {
    const releases: Array<() => void> = [];
    const gate = new Promise<void>((r) => {
      releases.push(r);
    });
    const release = () => {
      for (const r of releases) r();
    };
    runner.run = async (options) => {
      await gate;
      return {
        providerId: options.providerId,
        captured: [],
        result: {
          providerId: options.providerId,
          source: 'web-ui-dom',
          complete: true,
          discoveredAt: new Date(NOW).toISOString(),
          models: [model('m1')],
        },
      };
    };
    const first = service.discover('claude-web');
    const second = await service.discover('claude-web');
    expect(second.deferred).toBe(true);
    expect(second.detail).toMatch(/already running/i);
    release?.();
    await first;
  });
});

describe('Discovery scheduler', () => {
  let dir: string;
  let runner: FakeRunner;
  let service: ModelDiscoveryService;
  let scheduler: DiscoveryScheduler;
  let slept: number[];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery-sched-'));
    runner = new FakeRunner();
    service = new ModelDiscoveryService({
      runner,
      snapshots: new ModelSnapshotStore(path.join(dir, 'snapshots.json')),
      notifications: new NotificationStore(path.join(dir, 'notifications.json')),
      providerName: (id) => id,
      profileDirFor: () => '/tmp/profile',
      now: () => NOW,
    });
    slept = [];
    scheduler = new DiscoveryScheduler({
      service,
      providerIds: ['a', 'b'],
      intervalMs: 1000,
      timeoutMs: 500,
      jitterRatio: 0,
      lock: new ProcessLock({ lockDir: path.join(dir, 'locks') }),
      sleep: async (ms) => {
        slept.push(ms);
      },
      random: () => 0.5,
      now: () => NOW,
    });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('scans the providers automatically', async () => {
    const reports = await scheduler.sweep();
    expect(reports.length).toBe(2);
    expect(runner.calls.map((c) => c.providerId).sort()).toEqual(['a', 'b']);
  });

  it('does not scan the same provider twice in a row', async () => {
    await scheduler.sweep();
    runner.calls.length = 0;
    await scheduler.sweep();
    expect(runner.calls).toHaveLength(0);
  });

  it('supports a manual immediate scan', async () => {
    const report = await scheduler.scanNow('a');
    expect(report?.providerId).toBe('a');
    expect(runner.calls).toHaveLength(1);
  });

  it('refuses a manual scan of an unknown provider', async () => {
    expect(await scheduler.scanNow('zzz')).toBeNull();
  });

  it('backs off a provider that failed', async () => {
    runner.results.set('a', {
      providerId: 'a',
      source: 'none',
      complete: false,
      discoveredAt: new Date(NOW).toISOString(),
      models: [],
      failureReason: 'rate_limited',
    });
    await scheduler.sweep();
    expect(scheduler.isBackedOff('a')).toBe(true);
    runner.calls.length = 0;
    await scheduler.sweep();
    expect(runner.calls.find((c) => c.providerId === 'a')).toBeUndefined();
  });

  it('does NOT back off a provider that was merely deferred', async () => {
    runner.results.set('a', {
      providerId: 'a',
      source: 'none',
      complete: false,
      discoveredAt: new Date(NOW).toISOString(),
      models: [],
      failureReason: 'deferred',
    });
    await scheduler.sweep();
    expect(scheduler.isBackedOff('a')).toBe(false);
  });

  it('never runs two sweeps at the same time', async () => {
    const p1 = scheduler.sweep();
    const p2 = scheduler.sweep();
    await Promise.all([p1, p2]);
    // The second sweep is a no-op while the first is running.
    expect(runner.calls.length).toBeLessThanOrEqual(2);
  });

  it('restores its state so a restart does not rescan everything', async () => {
    await scheduler.sweep();
    const state = scheduler.getState();
    const restored = new DiscoveryScheduler({
      service,
      providerIds: ['a', 'b'],
      intervalMs: 1000,
      lock: new ProcessLock({ lockDir: path.join(dir, 'locks') }),
      sleep: async () => {},
      now: () => NOW,
    });
    restored.restore(state);
    runner.calls.length = 0;
    await restored.sweep();
    expect(runner.calls).toHaveLength(0);
  });

  it('respects a cross-process lock (a second instance does not sweep)', async () => {
    const lockDir = path.join(dir, 'locks');
    const lock = new ProcessLock({ lockDir });
    // A scheduler whose lock gives up quickly (like the real one does).
    const contending = new DiscoveryScheduler({
      service,
      providerIds: ['a', 'b'],
      intervalMs: 1000,
      lock: new ProcessLock({ lockDir, waitTimeoutMs: 150, retryDelayMs: 10 }),
      sleep: async () => {},
      now: () => NOW,
    });
    await lock.withLock('provider-model-discovery-sweep', async () => {
      runner.calls.length = 0;
      await contending.sweep();
      expect(runner.calls).toHaveLength(0);
    });
  });
});
