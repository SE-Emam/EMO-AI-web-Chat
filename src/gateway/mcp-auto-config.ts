/**
 * Writes the gateway's MCP server into the agents' OWN configuration files.
 *
 * Until now the UI only produced a snippet to copy by hand — which is why
 * Roo/Cline had an EMPTY `mcpServers` object and therefore had no file
 * tools at all. This module writes the entry into the file each agent
 * actually reads, keeping a backup of the previous content.
 *
 * The transport is `mcp-remote` (stdio) for every client except OpenCode,
 * whose remote MCP transport is documented with headers. A stdio server is
 * understood by every MCP client, so one shape works everywhere.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const MCP_SERVER_NAME = 'emo.web';

export interface McpTarget {
  id: string;
  name: string;
  /** The file the client reads. */
  file: string;
  /** Where the server entry goes inside that file. */
  kind: 'opencode' | 'mcpServers' | 'vscodeSettings' | 'zed' | 'continue' | 'openclaw';
  /** Some clients only accept a stdio server. */
  stdioOnly?: boolean;
}

export interface McpTargetResult {
  id: string;
  name: string;
  path: string;
  status: 'written' | 'skipped' | 'failed';
  message: string;
  backupPath?: string;
}

/** The absolute path of npx (mcp-remote is started through it). */
export function npxPath(): string {
  try {
    const found = execFileSync('which', ['npx'], { encoding: 'utf8' }).trim();
    if (found) return found;
  } catch {
    /* not on PATH */
  }
  return 'npx';
}

/** The files of the agents that support MCP, in the order they matter. */
export function mcpTargets(home = os.homedir()): McpTarget[] {
  const codeGlobal = path.join(home, 'Library/Application Support/Code/User/globalStorage');
  return [
    {
      id: 'opencode',
      name: 'OpenCode',
      file: path.join(home, '.config/opencode/opencode.json'),
      kind: 'opencode',
    },
    {
      id: 'roocode',
      name: 'Roo Code',
      file: path.join(codeGlobal, 'rooveterinaryinc.roo-cline/settings/mcp_settings.json'),
      kind: 'mcpServers',
    },
    {
      id: 'cline',
      name: 'Cline',
      file: path.join(codeGlobal, 'saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
      kind: 'mcpServers',
    },
    {
      id: 'vscode',
      name: 'VS Code',
      file: path.join(home, 'Library/Application Support/Code/User/settings.json'),
      kind: 'vscodeSettings',
    },
    {
      id: 'cursor',
      name: 'Cursor',
      file: path.join(home, '.cursor/mcp.json'),
      kind: 'mcpServers',
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      file: path.join(home, '.codeium/windsurf/mcp_config.json'),
      kind: 'mcpServers',
      stdioOnly: true,
    },
    {
      id: 'zed',
      name: 'Zed',
      file: path.join(home, '.config/zed/settings.json'),
      kind: 'zed',
      stdioOnly: true,
    },
    {
      id: 'claudecode',
      name: 'Claude Code',
      file: path.join(home, '.claude.json'),
      kind: 'mcpServers',
      stdioOnly: true,
    },
    {
      id: 'claudedesktop',
      name: 'Claude Desktop',
      file: path.join(home, 'Library/Application Support/Claude/claude_desktop_config.json'),
      kind: 'mcpServers',
      stdioOnly: true,
    },
    {
      id: 'continue',
      name: 'Continue',
      file: path.join(home, '.continue/config.json'),
      kind: 'continue',
      stdioOnly: true,
    },
    {
      id: 'kiro',
      name: 'Kiro',
      file: path.join(home, '.kiro/settings/mcp.json'),
      kind: 'mcpServers',
      stdioOnly: true,
    },
    {
      id: 'openclaw',
      name: 'OpenClaw',
      file: path.join(home, '.openclaw/openclaw.json'),
      kind: 'openclaw',
      stdioOnly: true,
    },
  ];
}

/** The stdio (mcp-remote) server entry every MCP client understands. */
export function stdioEntry(mcpUrl: string, apiKey: string): Record<string, unknown> {
  return {
    command: npxPath(),
    args: ['-y', 'mcp-remote', mcpUrl, '--header', `Authorization: Bearer ${apiKey}`],
    env: {
      GATEWAY_BASE_URL: mcpUrl.replace(/\/mcp\/?$/, '/v1'),
      GATEWAY_API_KEY: apiKey,
    },
  };
}

/** The native HTTP server entry (OpenCode's remote transport). */
export function httpEntry(mcpUrl: string, apiKey: string): Record<string, unknown> {
  return {
    type: 'remote',
    url: mcpUrl,
    headers: { Authorization: `Bearer ${apiKey}` },
    enabled: true,
  };
}

function readJson(file: string): any {
  try {
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Merges the server entry into the agent's configuration file. */
export function mergeMcpEntry(
  target: McpTarget,
  data: any,
  mcpUrl: string,
  apiKey: string
): { data: any; entry: Record<string, unknown> } {
  const entry =
    target.kind === 'opencode' && !target.stdioOnly
      ? httpEntry(mcpUrl, apiKey)
      : stdioEntry(mcpUrl, apiKey);
  const next = data && typeof data === 'object' ? data : {};

  if (target.kind === 'opencode') {
    next.mcp = next.mcp && typeof next.mcp === 'object' ? next.mcp : {};
    next.mcp.servers = next.mcp.servers && typeof next.mcp.servers === 'object' ? next.mcp.servers : {};
    next.mcp.servers[MCP_SERVER_NAME] = entry;
    return { data: next, entry };
  }
  if (target.kind === 'vscodeSettings') {
    next.mcp = next.mcp && typeof next.mcp === 'object' ? next.mcp : {};
    next.mcp.servers = next.mcp.servers && typeof next.mcp.servers === 'object' ? next.mcp.servers : {};
    next.mcp.servers[MCP_SERVER_NAME] = {
      type: 'http',
      url: mcpUrl,
      headers: { Authorization: `Bearer ${apiKey}` },
    };
    return { data: next, entry: next.mcp.servers[MCP_SERVER_NAME] };
  }
  if (target.kind === 'zed') {
    next.context_servers = next.context_servers && typeof next.context_servers === 'object' ? next.context_servers : {};
    const stdio = stdioEntry(mcpUrl, apiKey) as any;
    next.context_servers[MCP_SERVER_NAME] = {
      source: 'custom',
      command: {
        path: stdio.command,
        args: stdio.args,
        env: stdio.env,
      },
    };
    return { data: next, entry: next.context_servers[MCP_SERVER_NAME] };
  }
  if (target.kind === 'openclaw') {
    // OpenClaw validates its config strictly: an unknown key stops the
    // gateway from starting. Only the documented MCP keys are written.
    next.mcp = next.mcp && typeof next.mcp === 'object' ? next.mcp : {};
    next.mcp.servers = next.mcp.servers && typeof next.mcp.servers === 'object' ? next.mcp.servers : {};
    const stdio = stdioEntry(mcpUrl, apiKey) as any;
    next.mcp.servers[MCP_SERVER_NAME] = {
      command: stdio.command,
      args: stdio.args,
      env: stdio.env,
    };
    return { data: next, entry: next.mcp.servers[MCP_SERVER_NAME] };
  }
  if (target.kind === 'continue') {
    const list = Array.isArray(next.mcpServers) ? next.mcpServers : [];
    const stdio = stdioEntry(mcpUrl, apiKey) as any;
    const filtered = list.filter((s: any) => s && s.name !== MCP_SERVER_NAME);
    filtered.push({ name: MCP_SERVER_NAME, ...stdio });
    next.mcpServers = filtered;
    return { data: next, entry: filtered[filtered.length - 1] };
  }
  // mcpServers (Roo, Cline, Cursor, Windsurf, Claude Code/Desktop, Kiro)
  next.mcpServers = next.mcpServers && typeof next.mcpServers === 'object' ? next.mcpServers : {};
  next.mcpServers[MCP_SERVER_NAME] = entry;
  return { data: next, entry };
}

/**
 * Writes the MCP server into one agent's configuration file.
 * The previous content is kept as a `.bak` file next to it.
 */
export function configureMcpTarget(
  target: McpTarget,
  mcpUrl: string,
  apiKey: string
): McpTargetResult {
  const base: McpTargetResult = {
    id: target.id,
    name: target.name,
    path: target.file,
    status: 'skipped',
    message: '',
  };
  try {
    const existed = fs.existsSync(target.file);
    const data = readJson(target.file);
    const { data: next } = mergeMcpEntry(target, data, mcpUrl, apiKey);
    fs.mkdirSync(path.dirname(target.file), { recursive: true });
    let backupPath: string | undefined;
    if (existed) {
      backupPath = `${target.file}.bak`;
      fs.copyFileSync(target.file, backupPath);
    }
    fs.writeFileSync(target.file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return {
      ...base,
      status: 'written',
      message: existed
        ? `تم ربط خادم MCP في ${target.name} (نسخة احتياطية: ${backupPath})`
        : `تم إنشاء إعداد ${target.name} وربط خادم MCP فيه`,
      backupPath,
    };
  } catch (e) {
    return {
      ...base,
      status: 'failed',
      message: `تعذّر ربط ${target.name}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Writes the MCP server into every agent that supports it.
 *
 * `only` limits the run to the given agent ids. `installed` (the ids of the
 * agents actually present on this machine) keeps the run away from agents
 * that are not there — an agent that is not installed is reported as
 * skipped, never silently configured.
 */
export function configureMcpServers(opts: {
  mcpUrl: string;
  apiKey: string;
  only?: string[];
  installed?: string[];
  home?: string;
}): { results: McpTargetResult[]; written: number; failed: number; skipped: number } {
  const targets = mcpTargets(opts.home);
  const installed = opts.installed ? new Set(opts.installed) : null;
  const results: McpTargetResult[] = [];
  for (const target of targets) {
    const wanted = opts.only?.length ? opts.only.includes(target.id) : true;
    const present = !installed || installed.has(target.id) || fs.existsSync(target.file);
    if (!wanted) {
      results.push({
        id: target.id,
        name: target.name,
        path: target.file,
        status: 'skipped',
        message: 'لم يُطلب ربط هذا الوكيل.',
      });
      continue;
    }
    if (!present) {
      results.push({
        id: target.id,
        name: target.name,
        path: target.file,
        status: 'skipped',
        message: `${target.name} غير مثبّت على هذا الجهاز — لم يُلمس ملفه.`,
      });
      continue;
    }
    results.push(configureMcpTarget(target, opts.mcpUrl, opts.apiKey));
  }
  return {
    results,
    written: results.filter((r) => r.status === 'written').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
  };
}
