import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MCP_SERVER_NAME,
  configureMcpServers,
  configureMcpTarget,
  mcpTargets,
  mergeMcpEntry,
} from '../../src/gateway/mcp-auto-config.js';

describe('mcp auto configuration', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-home-'));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('knows the file every agent reads', () => {
    const targets = mcpTargets(home);
    const ids = targets.map((t) => t.id);
    expect(ids).toContain('opencode');
    expect(ids).toContain('roocode');
    expect(ids).toContain('cline');
    expect(targets.find((t) => t.id === 'opencode')?.file).toBe(path.join(home, '.config/opencode/opencode.json'));
  });

  it('writes the opencode remote server with the auth header', () => {
    const target = mcpTargets(home).find((t) => t.id === 'opencode')!;
    const result = configureMcpTarget(target, 'http://127.0.0.1:8989/mcp', 'emo.web');
    expect(result.status).toBe('written');
    const data = JSON.parse(fs.readFileSync(target.file, 'utf8'));
    const entry = data.mcp.servers[MCP_SERVER_NAME];
    expect(entry.type).toBe('remote');
    expect(entry.url).toBe('http://127.0.0.1:8989/mcp');
    expect(entry.headers.Authorization).toBe('Bearer emo.web');
  });

  it('writes an mcpServers entry for roo/cline and keeps the old content', () => {
    const target = mcpTargets(home).find((t) => t.id === 'roocode')!;
    fs.mkdirSync(path.dirname(target.file), { recursive: true });
    fs.writeFileSync(target.file, JSON.stringify({ mcpServers: {}, keepMe: 1 }, null, 2));
    const result = configureMcpTarget(target, 'http://127.0.0.1:8989/mcp', 'emo.web');
    expect(result.status).toBe('written');
    expect(result.backupPath).toBeTruthy();
    const data = JSON.parse(fs.readFileSync(target.file, 'utf8'));
    expect(data.keepMe).toBe(1);
    expect(data.mcpServers[MCP_SERVER_NAME].args).toContain('http://127.0.0.1:8989/mcp');
    expect(data.mcpServers[MCP_SERVER_NAME].args.join(' ')).toContain('Authorization: Bearer emo.web');
    // the backup holds the previous content
    const backup = JSON.parse(fs.readFileSync(result.backupPath!, 'utf8'));
    expect(backup.mcpServers).toEqual({});
  });

  it('never touches the entries it does not own', () => {
    const target = mcpTargets(home).find((t) => t.id === 'cursor')!;
    fs.mkdirSync(path.dirname(target.file), { recursive: true });
    fs.writeFileSync(target.file, JSON.stringify({ mcpServers: { other: { command: 'x' } } }, null, 2));
    configureMcpTarget(target, 'http://127.0.0.1:8989/mcp', 'emo.web');
    const data = JSON.parse(fs.readFileSync(target.file, 'utf8'));
    expect(data.mcpServers.other).toEqual({ command: 'x' });
    expect(data.mcpServers[MCP_SERVER_NAME]).toBeTruthy();
  });

  it('writes the vscode settings and the zed context server', () => {
    const vscode = mcpTargets(home).find((t) => t.id === 'vscode')!;
    configureMcpTarget(vscode, 'http://127.0.0.1:8989/mcp', 'emo.web');
    const vs = JSON.parse(fs.readFileSync(vscode.file, 'utf8'));
    expect(vs.mcp.servers[MCP_SERVER_NAME].url).toBe('http://127.0.0.1:8989/mcp');

    const zed = mcpTargets(home).find((t) => t.id === 'zed')!;
    configureMcpTarget(zed, 'http://127.0.0.1:8989/mcp', 'emo.web');
    const zd = JSON.parse(fs.readFileSync(zed.file, 'utf8'));
    expect(zd.context_servers[MCP_SERVER_NAME].command.args).toContain('http://127.0.0.1:8989/mcp');
  });

  it('writes every target at once', () => {
    const out = configureMcpServers({
      mcpUrl: 'http://127.0.0.1:8989/mcp',
      apiKey: 'emo.web',
      home,
    });
    expect(out.failed).toBe(0);
    expect(out.written).toBe(mcpTargets(home).length);
  });

  it('merges without losing the agent own settings', () => {
    const { data } = mergeMcpEntry(
      { id: 'x', name: 'X', file: '', kind: 'opencode' },
      { mcp: { servers: { keep: { type: 'local', command: ['x'] } } }, model: 'gpt' },
      'http://127.0.0.1:8989/mcp',
      'emo.web',
    );
    expect(data.mcp.servers.keep).toBeTruthy();
    expect(data.mcp.servers[MCP_SERVER_NAME]).toBeTruthy();
    expect(data.model).toBe('gpt');
  });
});
