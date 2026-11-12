import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionRegistry, type EmoSessionRecord } from '../../src/sessions/session-registry.js';

describe('SessionRegistry', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const makeStore = () => {
    const d = mkdtempSync(path.join(tmpdir(), 'emo-registry-'));
    dirs.push(d);
    return path.join(d, 'session-registry.json');
  };

  const rec = (over: Partial<EmoSessionRecord> = {}): EmoSessionRecord => ({
    sessionKey: 'task-abc',
    providerId: 'chatgpt-web',
    profileId: 'chatgpt-profile',
    conversationUrl: 'https://chatgpt.com/c/11111111-2222-3333-4444-555555555555',
    conversationId: '11111111-2222-3333-4444-555555555555',
    lastRequestId: null,
    savedAt: Date.now(),
    version: 1,
    ...over,
  });

  it('upsert then get returns the record', async () => {
    const store = makeStore();
    const reg = new SessionRegistry(store);
    await reg.upsert(rec());
    expect(reg.get('chatgpt-web', 'task-abc')).toMatchObject({ sessionKey: 'task-abc', version: 1 });
  });

  it('a NEWER version wins', async () => {
    const store = makeStore();
    const reg = new SessionRegistry(store);
    await reg.upsert(rec({ version: 1, conversationUrl: 'https://chatgpt.com/c/old' }));
    await reg.upsert(rec({ version: 2, conversationUrl: 'https://chatgpt.com/c/new' }));
    expect(reg.get('chatgpt-web', 'task-abc')?.conversationUrl).toContain('/c/new');
  });

  it('an OLDER version is REJECTED (last-write-wins only with a newer version)', async () => {
    const store = makeStore();
    const reg = new SessionRegistry(store);
    await reg.upsert(rec({ version: 5, conversationUrl: 'https://chatgpt.com/c/five' }));
    await reg.upsert(rec({ version: 3, conversationUrl: 'https://chatgpt.com/c/three' }));
    expect(reg.get('chatgpt-web', 'task-abc')?.conversationUrl).toContain('/c/five');
  });

  it('persists across a restart (a fresh instance reads the same store)', async () => {
    const store = makeStore();
    const reg1 = new SessionRegistry(store);
    await reg1.upsert(rec({ conversationUrl: 'https://chatgpt.com/c/survives' }));
    const reg2 = new SessionRegistry(store);
    expect(reg2.get('chatgpt-web', 'task-abc')?.conversationUrl).toContain('/c/survives');
  });

  it('get for an unknown session returns null', async () => {
    const store = makeStore();
    const reg = new SessionRegistry(store);
    expect(reg.get('chatgpt-web', 'nope')).toBeNull();
  });

  it('trims beyond the cap (oldest evicted) — cap is injectable for test speed', async () => {
    const store = makeStore();
    const reg = new SessionRegistry(store, undefined, 50);
    for (let i = 0; i < 55; i++) {
      await reg.upsert(rec({ sessionKey: `bulk-${i}`, savedAt: 1_000 + i, version: 1 }));
    }
    expect(reg.get('chatgpt-web', 'bulk-0')).toBeNull(); // oldest evicted
    expect(reg.get('chatgpt-web', 'bulk-54')).not.toBeNull(); // newest kept
  });

  it('attachRequest records the lastRequestId', async () => {
    const store = makeStore();
    const reg = new SessionRegistry(store);
    await reg.upsert(rec());
    await reg.attachRequest('chatgpt-web', 'task-abc', 'req-77');
    expect(reg.get('chatgpt-web', 'task-abc')?.lastRequestId).toBe('req-77');
  });

  it('conversationId is derived from the conversation URL when possible', async () => {
    const store = makeStore();
    const reg = new SessionRegistry(store);
    await reg.upsert(rec({ conversationUrl: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', conversationId: '' as any }));
    expect(reg.get('chatgpt-web', 'task-abc')?.conversationId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    await reg.upsert(rec({ sessionKey: 'no-url', conversationUrl: null as any, conversationId: '' as any }));
    expect(reg.get('chatgpt-web', 'no-url')?.conversationId).toBeNull();
  });
});
