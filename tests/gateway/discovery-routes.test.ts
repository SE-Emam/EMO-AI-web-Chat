import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerGatewayRoutes } from '../../src/server/gateway-routes.js';
import { GatewayConfigStore, defaultGatewayConfig } from '../../src/gateway/config-store.js';
import { ProviderManager } from '../../src/gateway/provider-manager.js';
import { UsageTracker } from '../../src/gateway/usage-tracker.js';
import { ModelSnapshotStore } from '../../src/gateway/discovery/snapshot-store.js';
import { NotificationStore } from '../../src/gateway/discovery/notification-store.js';
import { ModelDiscoveryService } from '../../src/gateway/discovery/service.js';
import { DiscoveryScheduler } from '../../src/gateway/discovery/scheduler.js';
import type { DiscoveryRunner, DiscoverySessionOptions } from '../../src/gateway/discovery/runner.js';
import type { ModelDiscoveryResult } from '../../src/gateway/discovery/types.js';

function model(id: string, name = id) {
  return { providerModelId: id, displayName: name, identityConfidence: 'stable-id' as const };
}

class FakeRunner implements DiscoveryRunner {
  calls: DiscoverySessionOptions[] = [];
  result: ModelDiscoveryResult | null = null;
  async run(options: DiscoverySessionOptions) {
    this.calls.push(options);
    return {
      providerId: options.providerId,
      captured: [],
      result:
        this.result ?? {
          providerId: options.providerId,
          source: 'web-ui-dom',
          complete: true,
          discoveredAt: new Date().toISOString(),
          models: [model('m1')],
        },
    };
  }
}

describe('Live discovery HTTP API', () => {
  let dir: string;
  let app: any;
  let runner: FakeRunner;
  let manager: ProviderManager;
  let notifications: NotificationStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery-routes-'));
    const store = new GatewayConfigStore(path.join(dir, 'gateway.json'));
    const config = defaultGatewayConfig();
    runner = new FakeRunner();
    notifications = new NotificationStore(path.join(dir, 'notifications.json'));
    const service = new ModelDiscoveryService({
      runner,
      snapshots: new ModelSnapshotStore(path.join(dir, 'snapshots.json')),
      notifications,
      providerName: (id) => id,
      profileDirFor: () => '/tmp/profile',
      driverRunning: () => false,
      headlessFor: () => true,
    });
    manager = new ProviderManager({ store, config, factories: {} as any });
    await manager.init();
    manager.attachDiscovery(service, new DiscoveryScheduler({ service, providerIds: ['gemini-web'] }));
    app = Fastify({ logger: false });
    registerGatewayRoutes(app, {
      manager,
      tracker: new UsageTracker(),
      getGatewayConfig: () => manager.getConfig(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('runs a live discovery and returns the report + the new provider state', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/gateway/providers/gemini-web/discover' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.report.status).toBe('discovered');
    expect(body.report.models).toHaveLength(1);
    expect(body.state.discovery.status).toBe('active');
    expect(body.state.discovery.modelCount).toBe(1);
    expect(body.state.card.discovery.status).toBe('active');
    expect(runner.calls[0].providerId).toBe('gemini-web');
  });

  it('does NOT notify on the first scan (baseline) but DOES on the second', async () => {
    await app.inject({ method: 'POST', url: '/api/gateway/providers/gemini-web/discover' });
    expect((await notifications.list()).length).toBe(0);

    runner.result = {
      providerId: 'gemini-web',
      source: 'web-ui-dom',
      complete: true,
      discoveredAt: new Date().toISOString(),
      models: [model('m1'), model('m2', 'Model Two')],
    };
    const res = await app.inject({ method: 'POST', url: '/api/gateway/providers/gemini-web/discover' });
    expect(res.json().report.notificationsCreated).toBe(1);
    const list = await notifications.list();
    expect(list).toHaveLength(1);
    expect(list[0].displayName).toBe('Model Two');
    expect(list[0].link).toContain('gemini-web');
  });

  it('lists the notifications and tracks the unread count', async () => {
    await app.inject({ method: 'POST', url: '/api/gateway/providers/gemini-web/discover' });
    runner.result = {
      providerId: 'gemini-web',
      source: 'web-ui-dom',
      complete: true,
      discoveredAt: new Date().toISOString(),
      models: [model('m1'), model('m2')],
    };
    await app.inject({ method: 'POST', url: '/api/gateway/providers/gemini-web/discover' });

    const res = await app.inject({ method: 'GET', url: '/api/gateway/discovery/notifications' });
    expect(res.statusCode).toBe(200);
    expect(res.json().notifications).toHaveLength(1);
    expect(res.json().unreadCount).toBe(1);

    const id = res.json().notifications[0].id;
    const read = await app.inject({
      method: 'POST',
      url: `/api/gateway/discovery/notifications/${encodeURIComponent(id)}/read`,
      payload: { read: true },
    });
    expect(read.json().unreadCount).toBe(0);
  });

  it('exposes the discovery state of every provider in /status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/gateway/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.providers.length).toBeGreaterThan(0);
    for (const p of body.providers) {
      expect(p.discovery, p.id).toBeTruthy();
      expect(p.card.discovery, p.id).toBeTruthy();
      expect(p.card.discovery.labelKey, p.id).toBeTruthy();
    }
  });

  it('returns the snapshot + the change history of one provider', async () => {
    await app.inject({ method: 'POST', url: '/api/gateway/providers/gemini-web/discover' });
    const res = await app.inject({ method: 'GET', url: '/api/gateway/providers/gemini-web/discovery' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.snapshot.providerId).toBe('gemini-web');
    expect(body.snapshot.models).toHaveLength(1);
    expect(Array.isArray(body.notifications)).toBe(true);
  });

  it('rejects an unknown provider id', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/gateway/providers/nope/discover' });
    expect(res.statusCode).toBe(400);
  });
});
