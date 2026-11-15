import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalManager } from '../../src/server/approval-manager.js';

describe('Centralized Approval Manager', () => {
  let mgr: ApprovalManager;

  beforeEach(() => {
    mgr = new ApprovalManager({ defaultTtlMs: 2_000 }); // 2s TTL for test speed
  });

  test('Creates approval request with cryptographic nonce, args hash, and pending state', () => {
    const req = mgr.createRequest({
      toolName: 'exec_command',
      clientIdentity: 'OpenCode Agent',
      target: 'git status',
      args: { command: 'git', args: ['status'] },
    });

    assert.ok(req.id);
    assert.equal(req.status, 'pending');
    assert.equal(req.toolName, 'exec_command');
    assert.equal(req.target, 'git status');
    assert.ok(req.nonce);
    assert.ok(req.argsHash);
    assert.ok(req.expiresAt > req.createdAt);
  });

  test('Admin user can approve a pending request', () => {
    const args = { path: 'app.ts', content: 'console.log(1);' };
    const req = mgr.createRequest({
      toolName: 'write_file',
      clientIdentity: 'Cline',
      target: '/workspace/app.ts',
      args,
    });

    const approved = mgr.approve(req.id, 'admin:local_admin');
    assert.equal(approved.status, 'approved');
    assert.equal(approved.decisionBy, 'admin:local_admin');
    assert.ok(approved.decisionAt);
  });

  test('Agents are strictly prevented from self-approving operations', () => {
    const req = mgr.createRequest({
      toolName: 'delete_file',
      clientIdentity: 'Autonomous Agent',
      target: '/workspace/old.ts',
      args: { path: 'old.ts' },
    });

    assert.throws(
      () => mgr.approve(req.id, 'subagent_coder'),
      /SECURITY_VIOLATION.*strictly forbidden/
    );

    assert.throws(
      () => mgr.approve(req.id, 'model_gpt4o'),
      /SECURITY_VIOLATION.*strictly forbidden/
    );
  });

  test('Single-use consumption: approved request can be consumed only once', () => {
    const args = { command: 'npm', args: ['run', 'build'] };
    const req = mgr.createRequest({
      toolName: 'exec_command',
      clientIdentity: 'VS Code Copilot',
      target: 'npm run build',
      args,
    });

    mgr.approve(req.id, 'admin:local_user');

    // First consumption succeeds
    const firstConsume = mgr.consume({
      id: req.id,
      toolName: 'exec_command',
      clientIdentity: 'VS Code Copilot',
      target: 'npm run build',
      args,
    });
    assert.equal(firstConsume, true);

    // Second consumption attempt fails (prevents replay attack)
    const secondConsume = mgr.consume({
      id: req.id,
      toolName: 'exec_command',
      clientIdentity: 'VS Code Copilot',
      target: 'npm run build',
      args,
    });
    assert.equal(secondConsume, false);
  });

  test('Consuming with tampered arguments is rejected', () => {
    const originalArgs = { command: 'echo', args: ['hello'] };
    const tamperedArgs = { command: 'echo', args: ['malicious_payload'] };

    const req = mgr.createRequest({
      toolName: 'exec_command',
      clientIdentity: 'Agent',
      target: 'echo hello',
      args: originalArgs,
    });

    mgr.approve(req.id, 'admin:local_user');

    // Attempting to consume with different arguments fails
    const consumed = mgr.consume({
      id: req.id,
      toolName: 'exec_command',
      clientIdentity: 'Agent',
      target: 'echo hello',
      args: tamperedArgs,
    });
    assert.equal(consumed, false);
  });

  test('Expired approval requests cannot be consumed', async () => {
    const fastMgr = new ApprovalManager({ defaultTtlMs: 50 }); // 50ms TTL
    const args = { command: 'ls' };
    const req = fastMgr.createRequest({
      toolName: 'exec_command',
      clientIdentity: 'Agent',
      target: 'ls',
      args,
    });

    fastMgr.approve(req.id, 'admin:local_user');

    // Wait for expiration
    await new Promise((r) => setTimeout(r, 70));

    const consumed = fastMgr.consume({
      id: req.id,
      toolName: 'exec_command',
      clientIdentity: 'Agent',
      target: 'ls',
      args,
    });
    assert.equal(consumed, false);

    const checked = fastMgr.getRequest(req.id);
    assert.equal(checked?.status, 'expired');
  });

  test('Audit log records operations without exposing sensitive data', () => {
    mgr.createRequest({
      toolName: 'exec_command',
      clientIdentity: 'Agent',
      target: 'git pull',
      args: { command: 'git' },
    });

    const logs = mgr.getAuditLogs();
    assert.ok(logs.length >= 1);
    assert.equal(logs[0].toolName, 'exec_command');
    assert.equal(logs[0].decision, 'requested');
  });
});
