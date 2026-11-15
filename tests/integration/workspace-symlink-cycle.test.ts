import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { callWorkspaceTool, type WorkspaceToolContext } from '../../src/server/workspace-tools.js';
import { ApprovalManager } from '../../src/server/approval-manager.js';

describe('Real Integration: Workspace Symlink Cycle Detection & Mandatory Approval for All File Mutations', () => {
  let tmpRoot: string;
  let outsideRoot: string;
  let ctx: WorkspaceToolContext;
  let approvalManager: ApprovalManager;

  before(async () => {
    tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'emo-workspace-test-'));
    outsideRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'emo-outside-test-'));

    approvalManager = new ApprovalManager({ defaultTtlMs: 30_000 });
    ctx = {
      roots: [tmpRoot],
      defaultRoot: tmpRoot,
      approvalManager,
      clientIdentity: 'agent:file_operator',
    };
  });

  after(async () => {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
    await fsp.rm(outsideRoot, { recursive: true, force: true });
  });

  test('create_directory WITHOUT approval is rejected with APPROVAL_REQUIRED', async () => {
    const targetDir = path.join(tmpRoot, 'new_dir_no_approval');

    await assert.rejects(
      async () =>
        callWorkspaceTool('create_directory', { path: targetDir }, ctx),
      /APPROVAL_REQUIRED.*create_directory/
    );

    assert.equal(fs.existsSync(targetDir), false);
  });

  test('create_directory WITH valid approval executes and creates directory', async () => {
    const targetDir = path.join(tmpRoot, 'new_dir_approved');

    // 1. Trigger approval request
    let approvalId = '';
    try {
      await callWorkspaceTool('create_directory', { path: targetDir }, ctx);
    } catch (e: any) {
      const match = e.message.match(/Approval ID: ([a-f0-9-]+)/);
      if (match) approvalId = match[1];
    }
    assert.ok(approvalId);

    // 2. Operator approves
    approvalManager.approve(approvalId, 'human:local_operator:sec_admin');

    // 3. Consumes approval and creates directory
    const res = await callWorkspaceTool(
      'create_directory',
      { path: targetDir, approval_id: approvalId },
      ctx
    );

    assert.match(res.content, /Created directory/);
    assert.equal(fs.existsSync(targetDir), true);
  });

  test('search_files handles directory symlink loop (cycle) safely without infinite recursion', async () => {
    const subDir = path.join(tmpRoot, 'cycle_test');
    await fsp.mkdir(subDir, { recursive: true });

    const testFile = path.join(subDir, 'hello.txt');
    await fsp.writeFile(testFile, 'TARGET_STRING_IN_CYCLE', 'utf8');

    // Create a circular directory symlink: subDir/loop -> subDir
    const cycleLink = path.join(subDir, 'loop');
    try {
      fs.symlinkSync(subDir, cycleLink, 'dir');
    } catch {}

    // search_files should visit once and not get stuck in infinite recursion
    const res = await callWorkspaceTool(
      'search_files',
      { path: subDir, regex: 'TARGET_STRING_IN_CYCLE' },
      ctx
    );

    assert.ok(res.content.includes('TARGET_STRING_IN_CYCLE'));
  });

  test('search_files rejects directory symlink pointing outside authorized workspace', async () => {
    const outsideFile = path.join(outsideRoot, 'secret_outside.txt');
    await fsp.writeFile(outsideFile, 'SECRET_OUTSIDE_WORKSPACE_DATA', 'utf8');

    const rogueLink = path.join(tmpRoot, 'rogue_link_dir');
    try {
      fs.symlinkSync(outsideRoot, rogueLink, 'dir');
    } catch {}

    const res = await callWorkspaceTool(
      'search_files',
      { path: tmpRoot, regex: 'SECRET_OUTSIDE' },
      ctx
    );

    // The outside secret must NEVER appear in the search results
    assert.equal(res.content.includes('SECRET_OUTSIDE_WORKSPACE_DATA'), false);
  });

  test('All file mutating operations enforce approval check (write_file, edit_file, delete_file, move_file)', async () => {
    const fileA = path.join(tmpRoot, 'file_a.txt');
    await fsp.writeFile(fileA, 'initial content', 'utf8');

    // 1. write_file
    await assert.rejects(
      async () => callWorkspaceTool('write_file', { path: fileA, content: 'new content' }, ctx),
      /APPROVAL_REQUIRED.*write_file/
    );

    // 2. edit_file
    await assert.rejects(
      async () => callWorkspaceTool('edit_file', { path: fileA, old_string: 'initial', new_string: 'edited' }, ctx),
      /APPROVAL_REQUIRED.*edit_file/
    );

    // 3. move_file
    const fileB = path.join(tmpRoot, 'file_b.txt');
    await assert.rejects(
      async () => callWorkspaceTool('move_file', { source_path: fileA, destination_path: fileB }, ctx),
      /APPROVAL_REQUIRED.*move_file/
    );

    // 4. delete_file
    await assert.rejects(
      async () => callWorkspaceTool('delete_file', { path: fileA }, ctx),
      /APPROVAL_REQUIRED.*delete_file/
    );
  });
});
