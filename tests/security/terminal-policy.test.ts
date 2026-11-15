import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TerminalService, validateCommandSafety } from '../../src/server/terminal-service.js';
import { ApprovalManager } from '../../src/server/approval-manager.js';
import type { WorkspaceToolContext } from '../../src/server/workspace-tools.js';

describe('Terminal Subcommand Safety & Execution Policies', () => {
  let tmpRoot: string;
  let workspaceDir: string;
  let ctx: WorkspaceToolContext;
  let approvalMgr: ApprovalManager;
  let terminal: TerminalService;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'emo-term-pol-'));
    workspaceDir = path.join(tmpRoot, 'workspace');
    await fs.mkdir(workspaceDir, { recursive: true });

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

  test('Blocks arbitrary code execution flags in node (-e, --eval, -p)', () => {
    const e1 = validateCommandSafety('node', ['-e', 'process.exit(1)']);
    assert.equal(e1.safe, false);
    assert.ok(e1.reason?.includes('SECURITY_VIOLATION'));

    const e2 = validateCommandSafety('node', ['--eval', 'console.log(1)']);
    assert.equal(e2.safe, false);

    const e3 = validateCommandSafety('node', ['-p', 'process.env']);
    assert.equal(e3.safe, false);
  });

  test('Blocks arbitrary code execution in python (-c, -m, --command)', () => {
    const p1 = validateCommandSafety('python', ['-c', 'import os; os.system("id")']);
    assert.equal(p1.safe, false);
    assert.ok(p1.reason?.includes('SECURITY_VIOLATION'));

    const p2 = validateCommandSafety('python3', ['-m', 'http.server']);
    assert.equal(p2.safe, false);

    const p3 = validateCommandSafety('python', ['--command', 'print(1)']);
    assert.equal(p3.safe, false);
  });

  test('Blocks npx and dangerous npm subcommands', () => {
    const npxCheck = validateCommandSafety('npx', ['rimraf', '/']);
    assert.equal(npxCheck.safe, false);

    const npmExec = validateCommandSafety('npm', ['exec', 'malicious-pkg']);
    assert.equal(npmExec.safe, false);

    const npmInit = validateCommandSafety('npm', ['init', 'malicious']);
    assert.equal(npmInit.safe, false);

    // Safe npm subcommands remain allowed
    const npmRun = validateCommandSafety('npm', ['run', 'build']);
    assert.equal(npmRun.safe, true);

    const npmTest = validateCommandSafety('npm', ['test']);
    assert.equal(npmTest.safe, true);
  });

  test('Blocks git flags with code execution potential and config modification', () => {
    const g1 = validateCommandSafety('git', ['--upload-pack', '/bin/sh']);
    assert.equal(g1.safe, false);

    const g2 = validateCommandSafety('git', ['config', 'user.email', 'attacker@bad.com']);
    assert.equal(g2.safe, false);

    const g3 = validateCommandSafety('git', ['--exec-path=/tmp']);
    assert.equal(g3.safe, false);

    // Safe git status or log are allowed
    const gStatus = validateCommandSafety('git', ['status']);
    assert.equal(gStatus.safe, true);
  });

  test('Terminal output redaction masks secrets in stdout and stderr', async () => {
    // Request approval for echo command printing a secret
    let approvalId = '';
    const secretLine = 'MY_API_KEY=sk-proj-superSecretOpenAIKey123456789';
    try {
      await terminal.executeCommand({ command: 'echo', args: [secretLine] }, ctx);
    } catch (e: any) {
      const match = e.message.match(/Approval ID: ([a-f0-9-]+)/);
      if (match) approvalId = match[1];
    }
    assert.ok(approvalId);

    // Admin approves
    approvalMgr.approve(approvalId, 'admin:local_admin');

    // Execution completes with secrets redacted
    const res = await terminal.executeCommand(
      { command: 'echo', args: [secretLine], approval_id: approvalId },
      ctx
    );

    assert.ok(res.stdout.includes('[REDACTED_OPENAI_KEY]'));
    assert.ok(!res.stdout.includes('sk-proj-superSecretOpenAIKey123456789'));
  });
});
