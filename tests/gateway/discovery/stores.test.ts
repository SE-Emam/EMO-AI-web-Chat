import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModelSnapshotStore, hashSnapshot } from '../../../src/gateway/discovery/snapshot-store.js';
import { NotificationStore, notificationDedupeKey } from '../../../src/gateway/discovery/notification-store.js';
import type { ModelChange } from '../../../src/gateway/discovery/types.js';

describe('Model snapshot store', () => {
  let dir: string;
  let store: ModelSnapshotStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-store-'));
    store = new ModelSnapshotStore(path.join(dir, 'provider-model-snapshots.json'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('stores a successful snapshot with all required fields', async () => {
    const models = [{ providerModelId: 'a', displayName: 'A', identityConfidence: 'stable-id' as const }];
    const snapshot = await store.saveSuccessful({
      providerId: 'claude-web',
      source: 'web-ui-dom',
      models,
      completeness: 'complete',
      discoveredAt: '2026-11-13T00:00:00.000Z',
    });
    expect(snapshot.providerId).toBe('claude-web');
    expect(snapshot.discoverySource).toBe('web-ui-dom');
    expect(snapshot.discoveredAt).toBe('2026-11-13T00:00:00.000Z');
    expect(snapshot.lastSuccessfulScanAt).toBe('2026-11-13T00:00:00.000Z');
    expect(snapshot.snapshotVersion).toBe(1);
    expect(snapshot.models).toHaveLength(1);
    expect(snapshot.completeness).toBe('complete');
    expect(snapshot.snapshotHash).toBeTruthy();
  });

  it('persists across store instances (durable)', async () => {
    await store.saveSuccessful({
      providerId: 'claude-web',
      source: 'web-ui-dom',
      models: [{ providerModelId: 'a', displayName: 'A', identityConfidence: 'stable-id' as const }],
      completeness: 'complete',
      discoveredAt: '2026-11-13T00:00:00.000Z',
    });
    const reloaded = new ModelSnapshotStore(path.join(dir, 'provider-model-snapshots.json'));
    const snapshot = await reloaded.get('claude-web');
    expect(snapshot?.models).toHaveLength(1);
  });

  it('does NOT replace a good snapshot when a later attempt fails', async () => {
    await store.saveSuccessful({
      providerId: 'claude-web',
      source: 'web-ui-dom',
      models: [{ providerModelId: 'a', displayName: 'A', identityConfidence: 'stable-id' as const }],
      completeness: 'complete',
      discoveredAt: '2026-11-13T00:00:00.000Z',
    });
    await store.markAttempt('claude-web', '2026-11-13T06:00:00.000Z');
    const snapshot = await store.get('claude-web');
    expect(snapshot?.models).toHaveLength(1);
    expect(snapshot?.lastSuccessfulScanAt).toBe('2026-11-13T00:00:00.000Z');
    expect(snapshot?.lastAttemptAt).toBe('2026-11-13T06:00:00.000Z');
    expect(snapshot?.snapshotVersion).toBe(1);
  });

  it('bumps the snapshot version on every successful scan', async () => {
    for (let i = 0; i < 3; i++) {
      await store.saveSuccessful({
        providerId: 'p',
        source: 'web-ui-dom',
        models: [{ providerModelId: `m${i}`, displayName: `M${i}`, identityConfidence: 'stable-id' as const }],
        completeness: 'complete',
        discoveredAt: new Date(1700000000000 + i).toISOString(),
      });
    }
    expect((await store.get('p'))?.snapshotVersion).toBe(3);
  });

  it('hashes the model set deterministically', () => {
    const a = [{ providerModelId: 'x', displayName: 'X', identityConfidence: 'stable-id' as const }];
    const b = [{ providerModelId: 'x', displayName: 'X', identityConfidence: 'stable-id' as const }];
    expect(hashSnapshot(a)).toBe(hashSnapshot(b));
    const c = [{ providerModelId: 'y', displayName: 'Y', identityConfidence: 'stable-id' as const }];
    expect(hashSnapshot(a)).not.toBe(hashSnapshot(c));
  });

  it('writes atomically (no partial file left behind)', async () => {
    await store.saveSuccessful({
      providerId: 'p',
      source: 'web-ui-dom',
      models: [],
      completeness: 'complete',
      discoveredAt: new Date().toISOString(),
    });
    const files = await fs.readdir(dir);
    expect(files.filter((f) => f.includes('.tmp'))).toHaveLength(0);
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'provider-model-snapshots.json'), 'utf8'));
    expect(raw.version).toBe(1);
  });

  it('stores NO credentials or cookies', async () => {
    await store.saveSuccessful({
      providerId: 'p',
      source: 'web-ui-dom',
      models: [{ providerModelId: 'a', displayName: 'A', identityConfidence: 'stable-id' as const }],
      completeness: 'complete',
      discoveredAt: new Date().toISOString(),
    });
    const raw = await fs.readFile(path.join(dir, 'provider-model-snapshots.json'), 'utf8');
    expect(raw).not.toMatch(/cookie|authorization|password|api[-_]?key/i);
  });
});

describe('Notification centre', () => {
  let dir: string;
  let store: NotificationStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notif-store-'));
    store = new NotificationStore(path.join(dir, 'provider-model-notifications.json'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const change = (over: Partial<ModelChange> = {}): ModelChange => ({
    providerId: 'claude-web',
    type: 'model_added',
    displayName: 'Sonnet 5.6',
    providerModelId: 'claude-sonnet-5-6',
    detectedAt: '2026-11-13T00:00:00.000Z',
    ...over,
  });

  it('creates a notification with the required fields', async () => {
    const n = await store.notify({ change: change(), providerName: 'Claude Web', source: 'web-ui-dom' });
    expect(n).toBeTruthy();
    expect(n!.providerName).toBe('Claude Web');
    expect(n!.displayName).toBe('Sonnet 5.6');
    expect(n!.type).toBe('model_added');
    expect(n!.detectedAt).toBe('2026-11-13T00:00:00.000Z');
    expect(n!.source).toBe('web-ui-dom');
    expect(n!.link).toContain('claude-web');
    expect(n!.read).toBe(false);
  });

  it('never creates the same notification twice', async () => {
    const first = await store.notify({ change: change(), providerName: 'Claude Web', source: 'web-ui-dom' });
    const second = await store.notify({ change: change(), providerName: 'Claude Web', source: 'web-ui-dom' });
    expect(first).toBeTruthy();
    expect(second).toBeNull();
    expect(await store.list()).toHaveLength(1);
  });

  it('treats a rename to a different name as a NEW notification', async () => {
    await store.notify({ change: change({ type: 'model_renamed', displayName: 'A' }), providerName: 'P', source: 'web-ui' });
    const second = await store.notify({ change: change({ type: 'model_renamed', displayName: 'B' }), providerName: 'P', source: 'web-ui' });
    expect(second).toBeTruthy();
  });

  it('marks a notification read / unread', async () => {
    const n = (await store.notify({ change: change(), providerName: 'P', source: 'web-ui' }))!;
    expect(await store.unreadCount()).toBe(1);
    await store.markRead(n.id);
    expect(await store.unreadCount()).toBe(0);
    await store.markRead(n.id, false);
    expect(await store.unreadCount()).toBe(1);
  });

  it('marks all notifications of a provider read', async () => {
    await store.notify({ change: change(), providerName: 'P', source: 'web-ui' });
    await store.notify({ change: change({ providerId: 'other', providerModelId: 'z' }), providerName: 'Q', source: 'web-ui' });
    expect(await store.markAllRead('claude-web')).toBe(1);
    expect(await store.unreadCount()).toBe(1);
    expect(await store.unreadCount('claude-web')).toBe(0);
  });

  it('survives a restart (durable)', async () => {
    await store.notify({ change: change(), providerName: 'P', source: 'web-ui' });
    const reloaded = new NotificationStore(path.join(dir, 'provider-model-notifications.json'));
    expect(await reloaded.list()).toHaveLength(1);
  });

  it('builds a stable dedupe key', () => {
    expect(notificationDedupeKey(change())).toBe(notificationDedupeKey(change()));
    expect(notificationDedupeKey(change())).not.toBe(notificationDedupeKey(change({ providerModelId: 'other' })));
  });

  it('lists newest first and filters by provider', async () => {
    await store.notify({ change: change({ providerModelId: 'a' }), providerName: 'P', source: 'web-ui' });
    await store.notify({ change: change({ providerId: 'qwen-web', providerModelId: 'b' }), providerName: 'Q', source: 'web-ui' });
    const all = await store.list();
    expect(all[0].providerId).toBe('qwen-web');
    expect(await store.list({ providerId: 'claude-web' })).toHaveLength(1);
  });
});
