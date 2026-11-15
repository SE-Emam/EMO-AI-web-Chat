import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  callWorkspaceTool,
  resolveWorkspacePath,
  type WorkspaceToolContext,
} from '../../src/server/workspace-tools.js';

describe('Deep Symlink Traversal Protection', () => {
  let tmpRoot: string;
  let workspaceDir: string;
  let outsideDir: string;
  let ctx: WorkspaceToolContext;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'emo-symlink-test-'));
    workspaceDir = path.join(tmpRoot, 'workspace');
    outsideDir = path.join(tmpRoot, 'outside');

    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });

    // File outside the workspace
    await fs.writeFile(path.join(outsideDir, 'external_secret.txt'), 'SUPER_SECRET_EXTERNAL_CONTENT', 'utf8');
    await fs.writeFile(path.join(outsideDir, 'other.txt'), 'TARGET_MATCH_FIND_ME', 'utf8');

    ctx = {
      roots: [workspaceDir],
      defaultRoot: workspaceDir,
    };
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  test('search_files: skips directory symlink pointing outside authorized workspace', async () => {
    // Create symlink inside workspace pointing to outside directory
    const dirSymlink = path.join(workspaceDir, 'external_dir_link');
    await fs.symlink(outsideDir, dirSymlink, 'dir');

    // Normal workspace file
    await fs.writeFile(path.join(workspaceDir, 'inside.txt'), 'normal content inside workspace', 'utf8');

    // Search for regex matching file in outsideDir
    const res = await callWorkspaceTool('search_files', { path: '.', regex: 'TARGET_MATCH_FIND_ME' }, ctx);

    // External symlinked directory must NOT be traversed
    assert.equal(res.content, '(no matches)');
    assert.equal((res.structured as any).count, 0);
  });

  test('search_files: skips file symlink pointing outside authorized workspace', async () => {
    // Create symlink inside workspace pointing to external file
    const fileSymlink = path.join(workspaceDir, 'symlinked_secret.txt');
    await fs.symlink(path.join(outsideDir, 'external_secret.txt'), fileSymlink, 'file');

    const res = await callWorkspaceTool('search_files', { path: '.', regex: 'SUPER_SECRET_EXTERNAL_CONTENT' }, ctx);

    // External symlinked file must NOT be read or reported
    assert.equal(res.content, '(no matches)');
    assert.equal((res.structured as any).count, 0);
  });

  test('read_file: blocks symlink pointing outside authorized workspace', async () => {
    const fileSymlink = path.join(workspaceDir, 'leak_outside.txt');
    await fs.symlink(path.join(outsideDir, 'external_secret.txt'), fileSymlink, 'file');

    await assert.rejects(
      async () => callWorkspaceTool('read_file', { path: 'leak_outside.txt' }, ctx),
      /OUTSIDE_WORKSPACE.*Symbolic link.*points outside/
    );
  });

  test('resolveWorkspacePath: blocks symlink resolving outside roots', () => {
    const symlinkPath = path.join(workspaceDir, 'escape.txt');
    fsSync.symlinkSync(path.join(outsideDir, 'external_secret.txt'), symlinkPath);

    assert.throws(
      () => resolveWorkspacePath('escape.txt', ctx),
      /OUTSIDE_WORKSPACE.*Symbolic link.*points outside/
    );
  });

  test('Internal symlinks pointing inside workspace are permitted', async () => {
    const targetFile = path.join(workspaceDir, 'legit.txt');
    await fs.writeFile(targetFile, 'Legitimate workspace data', 'utf8');

    const internalSymlink = path.join(workspaceDir, 'alias.txt');
    await fs.symlink(targetFile, internalSymlink, 'file');

    const res = await callWorkspaceTool('read_file', { path: 'alias.txt' }, ctx);
    assert.ok(res.content.includes('Legitimate workspace data'));
  });
});
