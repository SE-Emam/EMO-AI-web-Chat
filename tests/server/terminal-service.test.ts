import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TerminalService, sanitizeEnv } from '../../src/server/terminal-service.js';
import { ApprovalManager } from '../../src/server/approval-manager.js';
import type { WorkspaceToolContext } from '../../src/server/workspace-tools.js';

describe('Secure Terminal Service', () => {
  let tmpRoot: string;
  let workspaceDir: string;
  let outsideDir: string;
  let ctx: WorkspaceToolContext;
  let approvalMgr: ApprovalManager;
  let terminal: TerminalService;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'emo-term-test-'));
    workspaceDir = path.join(tmpRoot, 'workspace');
    outsideDir = path.join(tmpRoot, 'outside');

    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });

    ctx = {
      roots: [workspaceDir],
      defaultRoot: workspaceDir,
    };

    approvalMgr = new ApprovalManager();
    terminal = new TerminalService(approvalMgr);
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  test('Requires user approval: execution without approval_id throws APPROVAL_REQUIRED', async () => {
    await assert.rejects(
      async () =>
        terminal.executeCommand(
          { command: 'echo', args: ['hello'] },
          ctx,
          'TestAgent'
        ),
      /APPROVAL_REQUIRED.*Approval ID:/
    );

    const pending = approvalMgr.listRequests('pending');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].toolName, 'exec_command');
  });

  test('Executes safely when valid approval token is provided', async () => {
    // 1. Trigger approval requirement
    let approvalId = '';
    try {
      await terminal.executeCommand({ command: 'echo', args: ['Verified Execution'] }, ctx);
    } catch (err: any) {
      const match = err.message.match(/Approval ID: ([a-f0-9-]+)/);
      if (match) approvalId = match[1];
    }
    assert.ok(approvalId, 'Must generate approval ID');

    // 2. User approves the request
    approvalMgr.approve(approvalId, 'human:local_operator:test_session_1');

    // 3. Re-execute with approval_id
    const res = await terminal.executeCommand(
      { command: 'echo', args: ['Verified Execution'], approval_id: approvalId },
      ctx
    );

    assert.ok(res.stdout.includes('Verified Execution'));
    assert.equal(res.exitCode, 0);
  });

  test('Rejects unapproved binaries (curl, bash, rm, etc.) with COMMAND_NOT_ALLOWED', async () => {
    await assert.rejects(
      async () =>
        terminal.executeCommand({ command: 'curl', args: ['https://example.com'] }, ctx),
      /COMMAND_NOT_ALLOWED/
    );

    await assert.rejects(
      async () =>
        terminal.executeCommand({ command: '/bin/sh', args: ['-c', 'id'] }, ctx),
      /SECURITY_ERROR.*binary paths/
    );
  });

  test('Blocks dangerous command patterns (sudo, rm -rf)', async () => {
    await assert.rejects(
      async () =>
        terminal.executeCommand({ command: 'sudo', args: ['echo', '1'] }, ctx),
      /COMMAND_NOT_ALLOWED/
    );

    await assert.rejects(
      async () =>
        terminal.executeCommand({ command: 'echo', args: ['rm -rf /'] }, ctx),
      /SECURITY_VIOLATION.*dangerous pattern/
    );
  });

  test('Rejects working directory outside authorized workspace roots (Default Deny)', async () => {
    await assert.rejects(
      async () =>
        terminal.executeCommand(
          { command: 'echo', args: ['hi'], working_directory: outsideDir },
          ctx
        ),
      /OUTSIDE_WORKSPACE/
    );
  });

  test('Sanitizes environment variables to prevent secret leakage to child processes', () => {
    const dirtyEnv: NodeJS.ProcessEnv = {
      PATH: '/usr/bin:/bin',
      OPENAI_API_KEY: 'sk-secret-token-12345',
      AWS_SECRET_ACCESS_KEY: 'aws-secret-never-expose',
      DATABASE_PASSWORD: 'super-db-password',
      SAFE_VAR: 'visible-value',
    };

    const clean = sanitizeEnv(dirtyEnv);

    assert.equal(clean.SAFE_VAR, 'visible-value');
    assert.equal(clean.OPENAI_API_KEY, undefined);
    assert.equal(clean.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(clean.DATABASE_PASSWORD, undefined);
  });
});
