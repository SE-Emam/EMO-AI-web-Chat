import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { RequestBroker, brokerKey } from '../../src/protocol/request-broker.js';

describe('RequestBroker', () => {
  const dirs: string[] = [];
  const children: ChildProcess[] = [];
  afterEach(() => {
    for (const c of children.splice(0)) c.kill();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const make = () => {
    const d = mkdtempSync(path.join(tmpdir(), 'emo-broker-'));
    dirs.push(d);
    return { dir: d, broker: new RequestBroker(path.join(d, 'request-broker.json')) };
  };

  it('first begin → allowed; complete() stores the result; replay returns it', async () => {
    const { broker } = make();
    const key = brokerKey('api-scope-1', 'chatgpt-web', 'req-1');
    const b = await broker.begin(key, 'task-abc');
    if (!b.allowed) throw new Error('first begin must be allowed');
    expect(b.state).toBe('running');
    await b.complete({ content: 'the answer', model: 'chatgpt-web:default' });
    const replay = await broker.begin(key, 'task-abc');
    expect(replay.allowed).toBe(false);
    expect(replay.state).toBe('completed');
    expect((replay.result as any)?.content).toBe('the answer');
  });

  it('fail BEFORE send with retryable=true → failed state, replay allowed again', async () => {
    const { broker } = make();
    const key = brokerKey('s', 'p', 'req-pre-fail');
    const b = await broker.begin(key, 't');
    if (!b.allowed) throw new Error('expected allowed');
    await b.fail({ retryable: true, error: 'connection refused before send' });
    const replay = await broker.begin(key, 't');
    expect(replay.allowed).toBe(true); // nothing was sent — safe to retry
    expect(broker.get(key)?.state).toBe('running');
  });

  it('fail AFTER send is upgraded to unconfirmed EVEN IF caller says retryable (override logged)', async () => {
    const { broker } = make();
    const key = brokerKey('s', 'p', 'req-post-send');
    const b = await broker.begin(key, 't');
    if (!b.allowed) throw new Error('expected allowed');
    b.markSent(); // the message may now be in ChatGPT
    await b.fail({ retryable: true, error: 'timeout while generating' });
    const entry = broker.get(key);
    expect(entry?.state).toBe('unconfirmed');
    expect(entry?.reason).toContain('timeout');
    const replay = await broker.begin(key, 't');
    expect(replay.allowed).toBe(false);
    expect(replay.state).toBe('unconfirmed');
  });

  it('markUnconfirmed → 409-style state, never auto-retried', async () => {
    const { broker } = make();
    const key = brokerKey('s', 'p', 'req-unconf');
    const b = await broker.begin(key, 't');
    if (!b.allowed) throw new Error('expected allowed');
    b.markSent();
    await b.markUnconfirmed('client disconnected mid-stream');
    const replay = await broker.begin(key, 't');
    expect(replay.allowed).toBe(false);
    expect(replay.state).toBe('unconfirmed');
    expect(broker.get(key)?.reason).toContain('mid-stream');
  });

  it('result larger than the cache cap is NOT stored for replay (kept as marker)', async () => {
    const { broker } = make();
    const key = brokerKey('s', 'p', 'req-big');
    const b = await broker.begin(key, 't');
    if (!b.allowed) throw new Error('expected allowed');
    await b.complete({ content: 'x'.repeat(300_000) });
    const entry = broker.get(key);
    expect(entry?.state).toBe('completed');
    expect(entry?.result).toBeUndefined(); // too big to cache
  });

  it('client scope isolation: same X-Request-Id from two apiKeys do not collide', async () => {
    const { broker } = make();
    const k1 = brokerKey('client-A', 'chatgpt-web', 'shared-id');
    const k2 = brokerKey('client-B', 'chatgpt-web', 'shared-id');
    const b1 = await broker.begin(k1, 't');
    expect(b1.allowed).toBe(true);
    const b2 = await broker.begin(k2, 't');
    expect(b2.allowed).toBe(true); // separate scope → separate claim
    const b3 = await broker.begin(k1, 't');
    expect(b3.allowed).toBe(false); // same scope → blocked
  });

  it('TWO REAL PROCESSES claim the same requestId: exactly one is allowed', async () => {
    const { dir } = make();
    const store = path.join(dir, 'request-broker.json');
    const outFile = path.join(dir, 'racer.out');
    const script = path.resolve('tests/fixtures/broker-racer.ts');
    const run = (id: string) =>
      spawn(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), script, store, outFile, id], { stdio: 'ignore' });
    const a = run('A');
    const b = run('B');
    children.push(a, b);
    const codes = await Promise.all([
      new Promise<number>((res) => a.on('exit', (c) => res(c ?? 1))),
      new Promise<number>((res) => b.on('exit', (c) => res(c ?? 1))),
    ]);
    expect(codes).toEqual([0, 0]);
    const out = readFileSync(outFile, 'utf8');
    expect(out.split('\n').filter((l) => l.startsWith('ALLOWED:'))).toHaveLength(1);
    expect(out.split('\n').filter((l) => l.startsWith('DENIED:'))).toHaveLength(1);
  }, 30_000);

  it('persists across a restart (new instance replays the same state)', async () => {
    const { dir } = make();
    const store = path.join(dir, 'request-broker.json');
    const b1 = new RequestBroker(store);
    const key = brokerKey('s', 'p', 'req-restart');
    const b = await b1.begin(key, 't');
    if (!b.allowed) throw new Error('expected allowed');
    b.markSent();
    await b.complete({ content: 'done' });
    const b2 = new RequestBroker(store);
    const replay = await b2.begin(key, 't');
    expect(replay.allowed).toBe(false);
    expect(replay.state).toBe('completed');
  });

  it('corrupt store is silently recovered (fresh claims allowed)', async () => {
    const { dir } = make();
    const store = path.join(dir, 'request-broker.json');
    writeFileSync(store, '{"version": 1, "entries": ['); // truncated
    const broker = new RequestBroker(store);
    const b = await broker.begin(brokerKey('s', 'p', 'req-after-corrupt'), 't');
    expect(b.allowed).toBe(true);
  });
});
