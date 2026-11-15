import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  callWorkspaceTool,
  defaultWorkspaceContext,
  isSensitiveFile,
  redactSecretsInText,
  resolveWorkspacePath,
  type WorkspaceToolContext,
} from '../../src/server/workspace-tools.js';

describe('Workspace Path Security & Default Deny', () => {
  let tmpRoot: string;
  let workspaceDir: string;
  let outsideDir: string;
  let ctx: WorkspaceToolContext;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'emo-ws-test-'));
    workspaceDir = path.join(tmpRoot, 'workspace');
    outsideDir = path.join(tmpRoot, 'outside');

    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });

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

  test('Default Deny: rejects all access if roots array is empty', async () => {
    const emptyCtx: WorkspaceToolContext = { roots: [], defaultRoot: '' };

    assert.throws(
      () => resolveWorkspacePath('sample.txt', emptyCtx),
      /OUTSIDE_WORKSPACE.*Default Deny/
    );

    await assert.rejects(
      async () => callWorkspaceTool('read_file', { path: 'sample.txt' }, emptyCtx),
      /OUTSIDE_WORKSPACE.*Default Deny/
    );
  });

  test('Permits reading files strictly inside authorized workspace', async () => {
    const file = path.join(workspaceDir, 'allowed.txt');
    await fs.writeFile(file, 'Hello Secure Workspace', 'utf8');

    const res = await callWorkspaceTool('read_file', { path: 'allowed.txt' }, ctx);
    assert.ok(res.content.includes('Hello Secure Workspace'));
  });

  test('Rejects path traversal attempts using ../', async () => {
    const secretFile = path.join(outsideDir, 'secret.txt');
    await fs.writeFile(secretFile, 'Forbidden data', 'utf8');

    await assert.rejects(
      async () => callWorkspaceTool('read_file', { path: '../outside/secret.txt' }, ctx),
      /OUTSIDE_WORKSPACE/
    );
  });

  test('Rejects paths containing null bytes', async () => {
    assert.throws(
      () => resolveWorkspacePath('test\0.txt', ctx),
      /INVALID_PATH.*Null byte/
    );
  });

  test('Rejects symlink pointing outside authorized workspace', async () => {
    const outsideTarget = path.join(outsideDir, 'target.txt');
    await fs.writeFile(outsideTarget, 'Confidential data outside', 'utf8');

    const symlinkPath = path.join(workspaceDir, 'symlink-outside.txt');
    try {
      fsSync.symlinkSync(outsideTarget, symlinkPath);
    } catch {
      return; // Skip if OS denies symlink creation
    }

    await assert.rejects(
      async () => callWorkspaceTool('read_file', { path: 'symlink-outside.txt' }, ctx),
      /OUTSIDE_WORKSPACE.*Symbolic link/
    );
  });

  test('Blocks access to sensitive files by default (.env, id_rsa, credentials)', async () => {
    const envFile = path.join(workspaceDir, '.env');
    const rsaFile = path.join(workspaceDir, 'id_rsa');
    await fs.writeFile(envFile, 'API_KEY=1234567890', 'utf8');
    await fs.writeFile(rsaFile, '-----BEGIN RSA PRIVATE KEY-----', 'utf8');

    assert.ok(isSensitiveFile('.env'));
    assert.ok(isSensitiveFile('.env.production'));
    assert.ok(isSensitiveFile('id_rsa'));
    assert.ok(isSensitiveFile('server.key'));
    assert.ok(isSensitiveFile('credentials.json'));
    assert.ok(!isSensitiveFile('.env.example'));

    await assert.rejects(
      async () => callWorkspaceTool('read_file', { path: '.env' }, ctx),
      /ACCESS_DENIED.*sensitive/
    );

    await assert.rejects(
      async () => callWorkspaceTool('read_file', { path: 'id_rsa' }, ctx),
      /ACCESS_DENIED.*sensitive/
    );
  });

  test('1-based offset in read_file: offset 1 starts at first line', async () => {
    const file = path.join(workspaceDir, 'lines.txt');
    await fs.writeFile(file, 'Line 1\nLine 2\nLine 3\nLine 4', 'utf8');

    const res1 = await callWorkspaceTool('read_file', { path: 'lines.txt', offset: 1, limit: 2 }, ctx);
    assert.equal(res1.content, 'Line 1\nLine 2');

    const res2 = await callWorkspaceTool('read_file', { path: 'lines.txt', offset: 2, limit: 2 }, ctx);
    assert.equal(res2.content, 'Line 2\nLine 3');
  });

  test('Redacts secrets from search_files output', async () => {
    const codeFile = path.join(workspaceDir, 'config.ts');
    await fs.writeFile(codeFile, 'const SECRET_TOKEN = "super_secret_token_12345";\nconst port = 8080;', 'utf8');

    const res = await callWorkspaceTool('search_files', { path: '.', regex: 'SECRET_TOKEN' }, ctx);
    assert.ok(res.content.includes('[REDACTED]'));
    assert.ok(!res.content.includes('super_secret_token_12345'));
  });

  test('Atomic file write: writes content correctly without leaving temp artifacts', async () => {
    const targetFile = path.join(workspaceDir, 'atomic.txt');
    const res = await callWorkspaceTool('write_file', { path: 'atomic.txt', content: 'Atomic Payload' }, ctx);

    assert.ok(res.content.includes('Wrote'));
    const content = await fs.readFile(targetFile, 'utf8');
    assert.equal(content, 'Atomic Payload');

    const files = await fs.readdir(workspaceDir);
    const tmpFiles = files.filter((f) => f.includes('.tmp'));
    assert.equal(tmpFiles.length, 0, 'No temporary files should linger after write');
  });
});
