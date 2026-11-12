import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BrowserOwner } from '../../src/browser/browser-owner.js';

describe('BrowserOwner', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('epoch is stable and bumps on browser (re)launch', () => {
    const owner = new BrowserOwner();
    const e1 = owner.epoch;
    expect(owner.epoch).toBe(e1);
    owner.bumpEpoch();
    expect(owner.epoch).not.toBe(e1);
  });

  it('verify rejects a page from another epoch (stale worker detection)', () => {
    const owner = new BrowserOwner();
    const fakePage = { isClosed: () => false } as any;
    const epoch = owner.epoch;
    expect(owner.verify(fakePage, epoch)).toBe(true);
    owner.bumpEpoch(); // browser relaunched → old epoch is void
    expect(owner.verify(fakePage, epoch)).toBe(false);
  });

  it('verify rejects a closed page', () => {
    const owner = new BrowserOwner();
    const closedPage = { isClosed: () => true } as any;
    expect(owner.verify(closedPage, owner.epoch)).toBe(false);
  });

  it('id is stable and unique-ish per instance', () => {
    const a = new BrowserOwner();
    const b = new BrowserOwner();
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });
});
