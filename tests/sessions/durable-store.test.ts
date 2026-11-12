import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readJson, writeJsonAtomic } from '../../src/sessions/durable-store.js';

describe('durable-store', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const makeDir = () => {
    const d = mkdtempSync(path.join(tmpdir(), 'emo-store-'));
    dirs.push(d);
    return d;
  };

  it('returns null for a missing file', () => {
    const dir = makeDir();
    expect(readJson(path.join(dir, 'nope.json'))).toBeNull();
  });

  it('returns null for a corrupt/truncated file instead of throwing', () => {
    const dir = makeDir();
    const file = path.join(dir, 'bad.json');
    writeFileSync(file, '{"key": "value"'); // truncated JSON
    expect(readJson(file)).toBeNull();
  });

  it('writes atomically: final file exists, no tmp files left behind', () => {
    const dir = makeDir();
    const file = path.join(dir, 'state.json');
    writeJsonAtomic(file, { a: 1, nested: { b: [1, 2] } });
    expect(readJson(file)).toEqual({ a: 1, nested: { b: [1, 2] } });
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('replaces an existing value and creates missing parent directories', () => {
    const dir = makeDir();
    const file = path.join(dir, 'deep', 'sub', 'state.json');
    writeJsonAtomic(file, { v: 1 });
    writeJsonAtomic(file, { v: 2 });
    expect(readJson(file)).toEqual({ v: 2 });
    expect(mkdirSync.name).toBe('mkdirSync'); // sanity: helper available
  });
});
