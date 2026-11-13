import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerMcpServer } from '../../src/server/mcp-server.js';
import {
  WORKSPACE_TOOLS,
  callWorkspaceTool,
  defaultWorkspaceContext,
  isInside,
  resolveWorkspacePath,
} from '../../src/server/workspace-tools.js';

describe('Workspace file tools', () => {
  let dir: string;
  let ctx: ReturnType<typeof defaultWorkspaceContext>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-tools-'));
    await fs.writeFile(path.join(dir, 'a.txt'), 'line1\nline2\nline3\n');
    await fs.mkdir(path.join(dir, 'sub'), { recursive: true });
    await fs.writeFile(path.join(dir, 'sub', 'b.ts'), 'const x = 1;\n');
    ctx = defaultWorkspaceContext([dir]);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reads a file', async () => {
    const r = await callWorkspaceTool('read_file', { path: path.join(dir, 'a.txt') }, ctx);
    expect(r.content).toContain('line1');
    expect(r.content).toContain('line3');
  });

  it('reads a file relative to the workspace root', async () => {
    const r = await callWorkspaceTool('read_file', { path: 'a.txt' }, ctx);
    expect(r.content).toContain('line2');
  });

  it('writes a file (creating parents)', async () => {
    const target = path.join(dir, 'deep', 'nested', 'new.txt');
    const r = await callWorkspaceTool('write_file', { path: target, content: 'hello' }, ctx);
    expect(r.content).toContain('Wrote');
    expect(await fs.readFile(target, 'utf8')).toBe('hello');
  });

  it('edits a file by exact match and refuses an ambiguous match', async () => {
    const target = path.join(dir, 'e.txt');
    await fs.writeFile(target, 'aaa bbb aaa');
    await expect(callWorkspaceTool('edit_file', { path: target, old_string: 'aaa', new_string: 'x' }, ctx)).rejects.toThrow(/appears 2 times/);
    const r = await callWorkspaceTool('edit_file', { path: target, old_string: 'aaa bbb', new_string: 'x' }, ctx);
    expect(r.content).toContain('Edited');
    expect(await fs.readFile(target, 'utf8')).toBe('x aaa');
  });

  it('lists a directory and the codebase tree', async () => {
    const dirList = await callWorkspaceTool('list_directory', { path: dir }, ctx);
    expect(dirList.content).toContain('a.txt');
    const tree = await callWorkspaceTool('list_codebase', { path: dir }, ctx);
    expect(tree.content).toContain('sub/');
    expect(tree.content).toContain('sub/b.ts');
  });

  it('searches files with a regular expression', async () => {
    const r = await callWorkspaceTool('search_files', { path: dir, regex: 'const x' }, ctx);
    expect(r.content).toContain('b.ts');
  });

  it('moves and deletes files', async () => {
    await callWorkspaceTool('move_file', { source_path: path.join(dir, 'a.txt'), destination_path: path.join(dir, 'moved.txt') }, ctx);
    expect(await fs.readFile(path.join(dir, 'moved.txt'), 'utf8')).toContain('line1');
    await callWorkspaceTool('delete_file', { path: path.join(dir, 'moved.txt') }, ctx);
    await expect(fs.stat(path.join(dir, 'moved.txt'))).rejects.toThrow();
  });

  it('REFUSES a path outside the workspace', async () => {
    await expect(callWorkspaceTool('read_file', { path: '/etc/passwd' }, ctx)).rejects.toThrow(/outside the allowed workspace/);
    await expect(callWorkspaceTool('read_file', { path: '../../etc/passwd' }, ctx)).rejects.toThrow(/outside the allowed workspace/);
  });

  it('REFUSES a symlink that escapes the workspace', async () => {
    const link = path.join(dir, 'escape.txt');
    await fs.symlink('/etc/passwd', link).catch(() => {});
    await expect(callWorkspaceTool('read_file', { path: link }, ctx)).rejects.toThrow(/outside the allowed workspace/);
  });

  it('redacts secrets from .env-like files', async () => {
    const envFile = path.join(dir, '.env');
    await fs.writeFile(envFile, 'OPENAI_API_KEY=sk-secret-value-here\nNORMAL=1\n');
    const r = await callWorkspaceTool('read_file', { path: envFile }, ctx);
    expect(r.content).not.toContain('sk-secret-value-here');
    expect(r.content).toContain('[redacted]');
  });

  it('exposes the expected tool set', () => {
    const names = WORKSPACE_TOOLS.map((t) => t.name);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('list_directory');
    expect(names).toContain('search_files');
  });

  it('path containment helper', () => {
    expect(isInside('/a/b/c', '/a/b')).toBe(true);
    expect(isInside('/a/bc', '/a/b')).toBe(false);
    expect(isInside('/a/b', '/a/b')).toBe(true);
  });

  it('rejects an unknown tool', async () => {
    await expect(callWorkspaceTool('rm_rf', {}, ctx)).rejects.toThrow(/TOOL_DISABLED: rm_rf/);
  });
});

describe('MCP server endpoint', () => {
  let dir: string;
  let app: any;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-'));
    await fs.writeFile(path.join(dir, 'hello.txt'), 'hi from the workspace\n');
    app = Fastify({ logger: false });
    registerMcpServer(app, {
      isValidApiKey: (k) => k === 'emo.web',
      workspaceRoots: [dir],
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const rpc = (method: string, params: unknown = {}, id: unknown = 1) => ({
    method: 'POST',
    url: '/mcp',
    headers: { 'content-type': 'application/json', authorization: 'Bearer emo.web' },
    payload: { jsonrpc: '2.0', id, method, params },
  });

  it('rejects a request without a valid API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    });
    expect(res.statusCode).toBe(401);
  });

  it('initializes', async () => {
    const res = await app.inject(rpc('initialize', { protocolVersion: '2025-06-18' }));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.serverInfo.name).toBe('emo-ai-workspace');
    expect(body.result.capabilities.tools).toBeTruthy();
  });

  it('publishes server instructions that name the approved root', async () => {
    const res = await app.inject(rpc('initialize'));
    const instructions = res.json().result.instructions as string;
    expect(typeof instructions).toBe('string');
    expect(instructions.length).toBeGreaterThan(0);
    expect(instructions).toContain(path.resolve(dir));
    expect(instructions.length).toBeLessThan(1200);
  });

  it('lists the workspace tools', async () => {
    const res = await app.inject(rpc('tools/list'));
    const tools = res.json().result.tools as any[];
    expect(tools.length).toBeGreaterThan(5);
    expect(tools.find((t) => t.name === 'read_file')).toBeTruthy();
  });

  it('annotates the read-only tools as read-only and the write tools as writes', async () => {
    const res = await app.inject(rpc('tools/list'));
    const tools = res.json().result.tools as any[];
    const byName = (name: string) => tools.find((t) => t.name === name);

    expect(byName('read_file').annotations.readOnlyHint).toBe(true);
    expect(byName('list_directory').annotations.readOnlyHint).toBe(true);
    expect(byName('write_file').annotations.readOnlyHint).toBe(false);

    expect(byName('delete_file').annotations.destructiveHint).toBe(true);
    expect(byName('read_file').annotations.destructiveHint).toBe(false);
    expect(byName('list_directory').annotations.destructiveHint).toBe(false);
  });

  it('keeps the tool input schemas intact', async () => {
    const res = await app.inject(rpc('tools/list'));
    const tools = res.json().result.tools as any[];
    const readFile = tools.find((t) => t.name === 'read_file');
    expect(readFile.inputSchema.properties.path).toBeTruthy();
    expect(readFile.inputSchema.required).toContain('path');
  });

  it('calls read_file and returns the REAL file content', async () => {
    const res = await app.inject(
      rpc('tools/call', { name: 'read_file', arguments: { path: path.join(dir, 'hello.txt') } }),
    );
    const body = res.json();
    expect(body.result.isError).toBeFalsy();
    expect(body.result.content[0].text).toContain('hi from the workspace');
  });

  it('refuses to read outside the workspace', async () => {
    const res = await app.inject(rpc('tools/call', { name: 'read_file', arguments: { path: '/etc/passwd' } }));
    const body = res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('outside the allowed workspace');
  });

  it('answers an unknown method with a JSON-RPC error', async () => {
    const res = await app.inject(rpc('nope/nope'));
    expect(res.json().error.code).toBe(-32601);
  });

  it('accepts the FULL header form ("Authorization: Bearer <key>") that MCP clients send', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json', authorization: 'Authorization: Bearer emo.web' },
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.serverInfo.name).toBe('emo-ai-workspace');
  });

  it('accepts the plain "Bearer <key>" form', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json', authorization: 'Bearer emo.web' },
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    });
    expect(res.statusCode).toBe(200);
  });

  it('exposes a status endpoint for diagnostics', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/mcp/status',
      headers: { authorization: 'Bearer emo.web' },
    });
    expect(res.json().ok).toBe(true);
    expect(res.json().tools).toContain('read_file');
  });
});
