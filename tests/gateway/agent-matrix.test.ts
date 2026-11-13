import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { autoConfigureAgent } from '../../src/server/gateway-routes.js';
import { configureMcpServers, mcpTargets } from '../../src/gateway/mcp-auto-config.js';
import type { ProviderManager } from '../../src/gateway/provider-manager.js';

/**
 * Every registered agent must end up pointed at this gateway: the provider
 * base URL + API key in its own settings, and — for the agents that speak
 * MCP — the gateway's file tools in its MCP registry.
 *
 * The whole matrix runs against a temporary HOME: the user's real agent
 * settings are never touched by the test.
 */
const AGENT_IDS = [
  'opencode',
  'openclaw',
  'claudecode',
  'cursor',
  'vscode',
  'windsurf',
  'hermes',
  'antigravity',
  'gemini',
  'codex',
  't3',
  'lobehub',
  'jan',
  'anythingllm',
  'librechat',
  'zed',
  'pi',
  'alphacode',
  'kiro',
  'python',
  'openwebui',
  'dify',
  'flowise',
  'n8n',
  'continue',
  'roocode',
  'aider',
  'sillytavern',
  'copilot',
];

/** A manager stub: the auto-configure only needs it for the file-based agents. */
const managerStub = {
  listCustomAgents: () => [],
  getValidApiKeys: () => ['emo.web'],
} as unknown as ProviderManager;

describe('the agent matrix', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-home-'));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('knows every registered agent', () => {
    // The list is the contract: an agent that is not in it is not bound.
    expect(AGENT_IDS.length).toBeGreaterThanOrEqual(28);
    expect(new Set(AGENT_IDS).size).toBe(AGENT_IDS.length);
  });

  for (const id of AGENT_IDS) {
    it(`binds ${id} to the gateway`, async () => {
      const result = await autoConfigureAgent(id, managerStub, 8989, 'emo.web', home);
      expect(result.success).toBe(true);
      expect(result.message).toBeTruthy();
      // The agent's own file must now carry the gateway address.
      const found = findGatewayReference(home);
      expect(found.length).toBeGreaterThan(0);
      expect(found.some((f) => f.includes('127.0.0.1:8989') || f.includes(':8989'))).toBe(true);
    });
  }

  it('gives every MCP-capable agent the gateway file tools', () => {
    const out = configureMcpServers({
      mcpUrl: 'http://127.0.0.1:8989/mcp',
      apiKey: 'emo.web',
      home,
    });
    expect(out.failed).toBe(0);
    // OpenCode, Roo/Cline, VS Code, Cursor, Windsurf, Zed, Claude Code,
    // Claude Desktop, Continue, Kiro and OpenClaw.
    expect(out.written).toBe(mcpTargets(home).length);
    for (const target of mcpTargets(home)) {
      const raw = fs.readFileSync(target.file, 'utf8');
      expect(raw).toContain('127.0.0.1:8989/mcp');
      expect(raw).toContain('emo.web');
    }
  });

  it('links openclaw with an OpenAI-compatible provider and its MCP server', async () => {
    await autoConfigureAgent('openclaw', managerStub, 8989, 'emo.web', home);
    configureMcpServers({ mcpUrl: 'http://127.0.0.1:8989/mcp', apiKey: 'emo.web', home, only: ['openclaw'] });
    const conf = JSON.parse(fs.readFileSync(path.join(home, '.openclaw/openclaw.json'), 'utf8'));
    expect(conf.models.providers.emo.baseUrl).toBe('http://127.0.0.1:8989/v1');
    expect(conf.models.providers.emo.api).toBe('openai-completions');
    expect(conf.agents.defaults.model.primary).toBe('emo/chatgpt-web-default');
    expect(conf.mcp.servers['emo.web'].args).toContain('http://127.0.0.1:8989/mcp');
  });
});

/** Every file under the temporary home that mentions the gateway. */
function findGatewayReference(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      try {
        const text = fs.readFileSync(full, 'utf8');
        if (text.includes('8989') || text.includes('emo.web')) out.push(text);
      } catch {
        /* not a text file */
      }
    }
  };
  walk(root);
  return out;
}
