import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { validateCommandSafety, TerminalService } from '../../src/server/terminal-service.js';
import { ApprovalManager } from '../../src/server/approval-manager.js';
import type { WorkspaceToolContext } from '../../src/server/workspace-tools.js';

describe('Real Integration: Granular Terminal Command Policies & Process Safety', () => {
  let tmpRoot: string;
  let ctx: WorkspaceToolContext;
  let approvalMgr: ApprovalManager;
  let terminal: TerminalService;

  before(async () => {
    tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'emo-terminal-test-'));
    approvalMgr = new ApprovalManager({ defaultTtlMs: 30_000 });
    terminal = new TerminalService(approvalMgr);
    ctx = {
      roots: [tmpRoot],
      defaultRoot: tmpRoot,
      approvalManager: approvalMgr,
      clientIdentity: 'agent:terminal_tester',
    };
  });

  after(async () => {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  });

  test('Blocks node script execution (node <script>) by default', () => {
    const res = validateCommandSafety('node', ['index.js']);
    assert.equal(res.safe, false);
    assert.match(res.reason!, /Arbitrary script execution \(node <script>\) is prohibited/);
  });

  test('Blocks python script execution (python <script>) by default', () => {
    const res = validateCommandSafety('python3', ['script.py']);
    assert.equal(res.safe, false);
    assert.match(res.reason!, /Arbitrary script execution \(python <script>\) is prohibited/);
  });

  test('Blocks arbitrary npm script execution (npm run <arbitrary>)', () => {
    const res = validateCommandSafety('npm', ['run', 'deploy_backdoor']);
    assert.equal(res.safe, false);
    assert.match(res.reason!, /Arbitrary npm script execution/);
  });

  test('Blocks npm exec and npx arbitrary package execution', () => {
    const execRes = validateCommandSafety('npm', ['exec', 'malicious-pkg']);
    assert.equal(execRes.safe, false);
    assert.match(execRes.reason!, /npm exec arbitrary package execution is prohibited/);

    const npxRes = validateCommandSafety('npx', ['rimraf', '/']);
    assert.equal(npxRes.safe, false);
    assert.match(npxRes.reason!, /npx arbitrary package execution is prohibited/);
  });

  test('Blocks dangerous git flags and configuration modification', () => {
    assert.equal(validateCommandSafety('git', ['config', 'user.name', 'hacker']).safe, false);
    assert.equal(validateCommandSafety('git', ['--upload-pack', '/usr/bin']).safe, false);
    assert.equal(validateCommandSafety('git', ['-c', 'core.pager=cat', 'status']).safe, false);
  });

  test('Approved safe development commands provide correct policy metadata', () => {
    const gitStatus = validateCommandSafety('git', ['status']);
    assert.equal(gitStatus.safe, true);
    assert.equal(gitStatus.executesCode, false);
    assert.equal(gitStatus.usesNetwork, false);

    const npmTest = validateCommandSafety('npm', ['test']);
    assert.equal(npmTest.safe, true);
    assert.equal(npmTest.executesCode, true);
    assert.equal(npmTest.runsHooksOrScripts, true);

    const npmTypecheck = validateCommandSafety('npm', ['run', 'typecheck']);
    assert.equal(npmTypecheck.safe, true);
    assert.equal(npmTypecheck.executesCode, true);

    const npmInstall = validateCommandSafety('npm', ['install']);
    assert.equal(npmInstall.safe, true);
    assert.equal(npmInstall.installsDependencies, true);
    assert.equal(npmInstall.usesNetwork, true);
  });

  test('Approval binding protects against argument tampering on approved commands', async () => {
    // 1. Request approval for git status
    let approvalId = '';
    try {
      await terminal.executeCommand({ command: 'git', args: ['status'] }, ctx);
    } catch (e: any) {
      const match = e.message.match(/Approval ID: ([a-f0-9-]+)/);
      if (match) approvalId = match[1];
    }
    assert.ok(approvalId);

    // 2. Operator approves git status
    approvalMgr.approve(approvalId, 'human:local_operator:audit_admin');

    // 3. Consuming with modified argument (git log) cryptographically fails
    await assert.rejects(
      async () =>
        terminal.executeCommand(
          { command: 'git', args: ['log'], approval_id: approvalId },
          ctx
        ),
      /APPROVAL_DENIED/
    );
  });
});
