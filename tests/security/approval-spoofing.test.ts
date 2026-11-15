import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalManager } from '../../src/server/approval-manager.js';

describe('Approval Spoofing & Cryptographic Binding Verification', () => {
  let mgr: ApprovalManager;

  beforeEach(() => {
    mgr = new ApprovalManager({ defaultTtlMs: 5_000 });
  });

  test('Actor spoofing: non-admin actor cannot approve or reject operations', () => {
    const req = mgr.createRequest({
      toolName: 'exec_command',
      clientIdentity: 'Autonomous Agent',
      target: 'git push',
      args: { command: 'git', args: ['push'] },
    });

    // Untrusted entities and agent self-approvals are strictly rejected
    const invalidActors = ['local_user', 'subagent_coder', 'model_gpt4o', 'agent:cline', 'anonymous', ''];
    for (const actor of invalidActors) {
      assert.throws(
        () => mgr.approve(req.id, actor),
        /SECURITY_VIOLATION/
      );
      assert.throws(
        () => mgr.reject(req.id, actor),
        /SECURITY_VIOLATION/
      );
    }

    // Only authorized admin identity can approve
    const approved = mgr.approve(req.id, 'admin:master_key_1');
    assert.equal(approved.status, 'approved');
    assert.equal(approved.decisionBy, 'admin:master_key_1');
  });

  test('Argument tampering: consuming with modified arguments fails cryptographically', () => {
    const originalArgs = { command: 'npm', args: ['test'] };
    const tamperedArgs = { command: 'npm', args: ['run', 'malicious_script'] };

    const req = mgr.createRequest({
      toolName: 'exec_command',
      clientIdentity: 'TestAgent',
      target: 'npm test',
      args: originalArgs,
    });

    mgr.approve(req.id, 'admin:sec_admin');

    // Tampered payload fails
    const tamperedResult = mgr.consume({
      id: req.id,
      toolName: 'exec_command',
      clientIdentity: 'TestAgent',
      target: 'npm test',
      args: tamperedArgs,
    });
    assert.equal(tamperedResult, false);

    // Request is still approved and not consumed
    const reqAfter = mgr.getRequest(req.id);
    assert.equal(reqAfter?.status, 'approved');

    // Consuming with original payload succeeds
    const legitResult = mgr.consume({
      id: req.id,
      toolName: 'exec_command',
      clientIdentity: 'TestAgent',
      target: 'npm test',
      args: originalArgs,
    });
    assert.equal(legitResult, true);
  });

  test('Tool mismatch tampering: cannot consume approval with different toolName', () => {
    const args = { path: 'file.txt' };
    const req = mgr.createRequest({
      toolName: 'read_file',
      clientIdentity: 'Agent',
      target: 'file.txt',
      args,
    });

    mgr.approve(req.id, 'admin:user');

    // Attempting to consume for delete_file instead of read_file fails
    const result = mgr.consume({
      id: req.id,
      toolName: 'delete_file',
      clientIdentity: 'Agent',
      target: 'file.txt',
      args,
    });
    assert.equal(result, false);
  });

  test('Target tampering: cannot consume approval for a different file or command', () => {
    const args = { path: 'allowed.txt' };
    const req = mgr.createRequest({
      toolName: 'delete_file',
      clientIdentity: 'Agent',
      target: 'allowed.txt',
      args,
    });

    mgr.approve(req.id, 'admin:user');

    // Attempting to consume on a sensitive target
    const result = mgr.consume({
      id: req.id,
      toolName: 'delete_file',
      clientIdentity: 'Agent',
      target: 'production_database.sqlite',
      args,
    });
    assert.equal(result, false);
  });

  test('Client identity tampering: agent B cannot consume approval requested for agent A', () => {
    const args = { command: 'echo', args: ['hello'] };
    const req = mgr.createRequest({
      toolName: 'exec_command',
      clientIdentity: 'AuthorizedAgent_A',
      target: 'echo hello',
      args,
    });

    mgr.approve(req.id, 'admin:user');

    // Rogue agent B tries to steal the approval token
    const result = mgr.consume({
      id: req.id,
      toolName: 'exec_command',
      clientIdentity: 'RogueAgent_B',
      target: 'echo hello',
      args,
    });
    assert.equal(result, false);
  });

  test('Replay attack: token cannot be consumed a second time', () => {
    const args = { command: 'git', args: ['status'] };
    const req = mgr.createRequest({
      toolName: 'exec_command',
      clientIdentity: 'Agent',
      target: 'git status',
      args,
    });

    mgr.approve(req.id, 'admin:user');

    const first = mgr.consume({
      id: req.id,
      toolName: 'exec_command',
      clientIdentity: 'Agent',
      target: 'git status',
      args,
    });
    assert.equal(first, true);

    // Replay attempt
    const second = mgr.consume({
      id: req.id,
      toolName: 'exec_command',
      clientIdentity: 'Agent',
      target: 'git status',
      args,
    });
    assert.equal(second, false);
  });
});
