import type { FastifyInstance, FastifyRequest } from 'fastify';
import { globalHumanSessionManager, type HumanSession } from './human-session.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { CustomAgent, DetectedAgent, GatewayConfigFile, WebProviderId } from '../gateway/types.js';
import { WEB_PROVIDER_IDS } from '../gateway/types.js';
import type { ProviderManager } from '../gateway/provider-manager.js';
import type { UsageTracker } from '../gateway/usage-tracker.js';
import { isValidApiKey } from '../gateway/security.js';
import { registerMcpServer } from './mcp-server.js';
import { mcpTunnelServer } from './mcp-tunnel-server.js';
import { configureMcpServers, mcpTargets } from '../gateway/mcp-auto-config.js';
import { globalApprovalManager } from './approval-manager.js';

function isProviderId(v: string): v is WebProviderId {
  return (WEB_PROVIDER_IDS as string[]).includes(v);
}

let cachedAgents: { at: number; list: DetectedAgent[] } | null = null;

async function safeWriteWithBackup(filePath: string, content: string): Promise<string | undefined> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  let backupPath: string | undefined;
  if (fs.existsSync(filePath)) {
    backupPath = `${filePath}.bak`;
    try {
      fs.copyFileSync(filePath, backupPath);
    } catch {}
  }
  fs.writeFileSync(filePath, content, 'utf8');
  return backupPath;
}

async function detectLocalAgents(manager?: ProviderManager, force = false): Promise<DetectedAgent[]> {
  if (!force && cachedAgents && Date.now() - cachedAgents.at < 60_000) {
    return cachedAgents.list;
  }
  const home = os.homedir();
  // --- Evidence helpers ---------------------------------------------------
  // `installed: true` must be backed by hard evidence only:
  //   1. an executable actually found on disk in a bin directory, or
  //   2. a real .app bundle, or
  //   3. a real executable file at a known install location.
  // Loose config directories (e.g. ~/.gemini, ~/.config/pi) are NOT proof of
  // installation and must never set installed=true.
  const existingFile = (p: string): string | undefined => {
    try { return fs.statSync(p).isFile() ? p : undefined; } catch { return undefined; }
  };
  const existingDir = (p: string): string | undefined => {
    try { return fs.statSync(p).isDirectory() ? p : undefined; } catch { return undefined; }
  };
  // VS Code extension install dirs (~/.vscode/extensions/<publisher>.<name>-<version>)
  const findVscodeExtension = (prefixes: string[]): string | undefined => {
    const extRoot = path.join(home, '.vscode/extensions');
    let entries: string[] = [];
    try { entries = fs.readdirSync(extRoot); } catch { return undefined; }
    for (const prefix of prefixes) {
      const hit = entries.find((e) => e.toLowerCase().startsWith(prefix.toLowerCase()) && existingDir(path.join(extRoot, e)));
      if (hit) return path.join(extRoot, hit);
    }
    return undefined;
  };

  // --- Real filesystem scan -----------------------------------------------
  // Instead of trusting fixed paths (which miss non-standard installs and
  // GUI processes with a limited PATH), actually enumerate:
  //   * every .app bundle in /Applications and ~/Applications
  //   * every executable in all PATH dirs plus common extra bin dirs
  //     (/opt/homebrew/bin, ~/.local/bin, ~/.cargo/bin, nvm node bins, ...)
  const apps: { name: string; full: string }[] = [];
  for (const dir of ['/Applications', path.join(home, 'Applications')]) {
    let entries: string[] = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const e of entries) {
      if (!e.toLowerCase().endsWith('.app')) continue;
      const full = path.join(dir, e);
      if (existingDir(full)) apps.push({ name: e, full });
    }
  }

  const binDirs = Array.from(new Set<string>([
    ...(process.env.PATH || '').split(':').filter(Boolean),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(home, '.local/bin'),
    path.join(home, 'bin'),
    path.join(home, '.cargo/bin'),
    path.join(home, '.opencode/bin'),
    path.join(home, '.gemini/bin'),
    path.join(home, '.codex/bin'),
    path.join(home, '.t3/bin'),
  ]));
  try {
    const nvmRoot = path.join(home, '.nvm/versions/node');
    for (const v of fs.readdirSync(nvmRoot)) binDirs.push(path.join(nvmRoot, v, 'bin'));
  } catch {}
  const bins = new Map<string, string>();
  for (const dir of binDirs) {
    let entries: string[] = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const e of entries) {
      const key = e.toLowerCase();
      if (bins.has(key)) continue;
      const full = path.join(dir, e);
      if (existingFile(full)) bins.set(key, full);
    }
  }

  // App-name match: keyword words must match a contiguous run of exact tokens
  // anywhere in the app name ('sillytavern' matches 'Fake SillyTavern Test.app'
  // and 'T3 Code (Beta).app', but 'code' does NOT match 'Codex.app' and 'jan'
  // does NOT match 'January.app' because token equality is required).
  const matchApp = (...keywords: string[]): string | undefined => {
    for (const a of apps) {
      const toks = a.name.toLowerCase().replace(/\.app$/, '').split(/[^a-z0-9]+/).filter(Boolean);
      for (const kw of keywords) {
        const words = kw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        if (words.length === 0 || words.length > toks.length) continue;
        for (let start = 0; start <= toks.length - words.length; start++) {
          if (words.every((w, i) => toks[start + i] === w)) return a.full;
        }
      }
    }
    return undefined;
  };
  // Binary-name match: exact filename lookup across all scanned bin dirs.
  const matchBin = (...names: string[]): string | undefined => {
    for (const n of names) {
      const hit = bins.get(n.toLowerCase());
      if (hit) return hit;
    }
    return undefined;
  };

  const opencodeFallback = path.join(home, '.opencode/bin/opencode');
  const opencodePath = matchBin('opencode') || existingFile(opencodeFallback) || matchApp('opencode');
  const cursorPath = matchBin('cursor') || matchApp('cursor');
  const vscodePath = matchBin('code') || matchApp('visual studio code', 'vscode');
  const windsurfPath = matchBin('windsurf') || matchApp('windsurf');

  const hermesLocalBin = path.join(home, '.local/bin/hermes');
  const hermesPath = matchBin('hermes') || existingFile(hermesLocalBin) || matchApp('hermes');

  const agyLocal = path.join(home, '.gemini/bin/agy');
  const antigravityPath = matchBin('agy') || existingFile(agyLocal) || matchApp('antigravity');

  const geminiBin = path.join(home, '.gemini/bin/gemini');
  const geminiPath = matchBin('gemini') || existingFile(geminiBin);

  const codexBin = path.join(home, '.codex/bin/codex');
  const codexPath = matchBin('codex') || existingFile(codexBin) || matchApp('codex');

  const t3Bin = path.join(home, '.t3/bin/t3');
  const t3Path = matchBin('t3') || existingFile(t3Bin) || matchApp('t3 code', 't3');

  const lobehubPath = matchApp('lobehub', 'lobe chat', 'lobechat');
  const janPath = matchApp('jan', 'jan ai');
  const anythingllmPath = matchApp('anythingllm');
  const librechatPath = matchBin('librechat') || matchApp('librechat');
  const zedPath = matchBin('zed') || matchApp('zed');
  const piPath = matchBin('pi') || matchApp('pi');
  const alphacodePath = matchBin('alphacode', 'alpha-code') || matchApp('alpha code', 'alphacode');
  const kiroPath = matchBin('kiro', 'kilo') || matchApp('kiro', 'kilo');
  const pythonPath = matchBin('python3', 'python') || undefined;

  // OpenClaw (the multi-channel gateway/agent runtime): the binary, its
  // config or its state database are the evidence — a config file alone is
  // not proof of an install, but the state database is.
  const openclawConf = path.join(home, '.openclaw/openclaw.json');
  const openclawState = existingFile(path.join(home, '.openclaw/state/openclaw.sqlite'));
  const openclawPath = matchBin('openclaw') || existingFile(path.join(home, '.openclaw/bin/openclaw')) || matchApp('openclaw');

  // Continue / Roo Code are VS Code extensions: real evidence = extension dir in ~/.vscode/extensions
  const continuePath = matchBin('continue') || findVscodeExtension(['continue.continue']);
  const rooPath = matchBin('roo', 'roo-code') || findVscodeExtension(['rooveterinaryinc.roo-cline']);
  const aiderPath = matchBin('aider', 'aider-chat') || existingFile(path.join(home, '.local/bin/aider'));
  // SillyTavern is usually a git clone: require actual install markers inside the folder
  const sillytavernDir = existingDir(path.join(home, 'SillyTavern')) || existingDir(path.join(home, '.config/sillytavern'));
  const sillytavernPath = matchBin('sillytavern')
    || matchApp('sillytavern', 'silly tavern')
    || (sillytavernDir && fs.existsSync(path.join(sillytavernDir, 'package.json')) && fs.existsSync(path.join(sillytavernDir, 'server.js')) ? sillytavernDir : undefined);
  const openwebuiPath = matchBin('open-webui', 'openwebui') || matchApp('open webui', 'openwebui', 'open-webui');
  const difyPath = matchBin('dify') || matchApp('dify');
  const flowisePath = matchBin('flowise') || matchApp('flowise');
  const n8nPath = matchBin('n8n') || matchApp('n8n');
  const copilotPath = matchBin('copilot') || matchApp('microsoft copilot', 'copilot') || findVscodeExtension(['github.copilot']);

  // Check configuration markers
  const opencodeConf = path.join(home, '.config/opencode/opencode.json');
  let opencodeConfigured = false;
  try {
    if (fs.existsSync(opencodeConf)) {
      const txt = fs.readFileSync(opencodeConf, 'utf8');
      opencodeConfigured = txt.includes(':8989') || txt.includes('emo-gateway') || txt.includes('emo.web');
    }
  } catch {}

  const hermesConf = path.join(home, '.hermes/config.yaml');
  let hermesConfigured = false;
  try {
    if (fs.existsSync(hermesConf)) {
      const txt = fs.readFileSync(hermesConf, 'utf8');
      hermesConfigured = txt.includes(':8989') || txt.includes('emo-gateway') || txt.includes('emo.web');
    }
  } catch {}

  const anythingllmConf = path.join(home, 'Library/Application Support/anythingllm-desktop/storage/.env');
  let anythingllmConfigured = false;
  try {
    if (fs.existsSync(anythingllmConf)) {
      const txt = fs.readFileSync(anythingllmConf, 'utf8');
      anythingllmConfigured = txt.includes(':8989') || txt.includes('emo.web');
    }
  } catch {}

  const list: DetectedAgent[] = [
    {
      id: 'opencode',
      name: 'OpenCode',
      icon: '💻',
      installed: Boolean(opencodePath),
      path: opencodePath,
      configPath: fs.existsSync(opencodeConf) ? opencodeConf : undefined,
      isConfigured: opencodeConfigured,
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'cli',
    },
    {
      id: 'openclaw',
      name: 'OpenClaw',
      icon: '🐾',
      installed: Boolean(openclawPath || openclawState),
      path: openclawPath,
      configPath: fs.existsSync(openclawConf) ? openclawConf : undefined,
      isConfigured: (() => {
        try {
          if (!fs.existsSync(openclawConf)) return false;
          const txt = fs.readFileSync(openclawConf, 'utf8');
          return txt.includes(':8989') || txt.includes('emo.web');
        } catch {
          return false;
        }
      })(),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'cli',
    },
    {
      id: 'claudecode',
      name: 'Claude Code',
      icon: '✳️',
      // Only a real `claude` executable on disk proves installation.
      // ~/.claude.json alone is a leftover config file, NOT install evidence.
      installed: Boolean(matchBin('claude')),
      path: matchBin('claude'),
      configPath: fs.existsSync(path.join(home, '.claude.json')) ? path.join(home, '.claude.json') : undefined,
      canAutoConfigure: true,
      protocol: 'anthropic',
      category: 'cli',
    },
    {
      id: 'cursor',
      name: 'Cursor',
      icon: '⚡',
      installed: Boolean(cursorPath),
      path: cursorPath,
      configPath: path.join(home, 'Library/Application Support/Cursor/User/settings.json'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'ide',
    },
    {
      id: 'vscode',
      name: 'VS Code (Cline / Continue)',
      icon: '📘',
      installed: Boolean(vscodePath),
      path: vscodePath,
      configPath: path.join(home, 'Library/Application Support/Code/User/settings.json'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'ide',
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      icon: '🏄',
      installed: Boolean(windsurfPath),
      path: windsurfPath,
      configPath: path.join(home, 'Library/Application Support/Windsurf/User/settings.json'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'ide',
    },
    {
      id: 'hermes',
      name: 'DeepSeek Hermes Agent',
      icon: '🤖',
      installed: Boolean(hermesPath),
      path: hermesPath,
      configPath: fs.existsSync(hermesConf) ? hermesConf : undefined,
      isConfigured: hermesConfigured,
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'agent',
    },
    {
      id: 'antigravity',
      name: 'Google Antigravity (agy)',
      icon: '🪐',
      installed: Boolean(antigravityPath),
      path: antigravityPath,
      configPath: path.join(home, '.gemini/config/config.json'),
      canAutoConfigure: true,
      protocol: 'gemini',
      category: 'ide',
    },
    {
      id: 'gemini',
      name: 'Gemini CLI',
      icon: '✨',
      installed: Boolean(geminiPath),
      path: geminiPath,
      configPath: path.join(home, '.gemini/config/config.json'),
      canAutoConfigure: true,
      protocol: 'gemini',
      category: 'cli',
    },
    {
      id: 'codex',
      name: 'Codex CLI / IDE',
      icon: '📜',
      installed: Boolean(codexPath),
      path: codexPath,
      configPath: path.join(home, '.codex/config.toml'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'cli',
    },
    {
      id: 't3',
      name: 'T3 Code',
      icon: '🔺',
      installed: Boolean(t3Path),
      path: t3Path,
      configPath: path.join(home, '.t3/userdata/settings.json'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'ide',
    },
    {
      id: 'lobehub',
      name: 'LobeHub',
      icon: '🧩',
      installed: Boolean(lobehubPath),
      path: lobehubPath,
      configPath: path.join(home, 'Library/Application Support/LobeHub'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'app',
    },
    {
      id: 'jan',
      name: 'Jan AI',
      icon: '🤖',
      installed: Boolean(janPath),
      path: janPath,
      configPath: path.join(home, 'Library/Application Support/Jan/data/settings.json'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'app',
    },
    {
      id: 'anythingllm',
      name: 'AnythingLLM',
      icon: '🔮',
      installed: Boolean(anythingllmPath),
      path: anythingllmPath,
      configPath: fs.existsSync(anythingllmConf) ? anythingllmConf : undefined,
      isConfigured: anythingllmConfigured,
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'app',
    },
    {
      id: 'librechat',
      name: 'LibreChat',
      icon: '💬',
      installed: Boolean(librechatPath),
      path: librechatPath,
      configPath: path.join(home, '.config/librechat/librechat.yaml'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'app',
    },
    {
      id: 'zed',
      name: 'Zed (z code)',
      icon: '⚡',
      installed: Boolean(zedPath),
      path: zedPath,
      configPath: path.join(home, '.config/zed/settings.json'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'ide',
    },
    {
      id: 'pi',
      name: 'PI Agent',
      icon: '🥧',
      installed: Boolean(piPath),
      path: piPath,
      configPath: path.join(home, '.config/pi/config.json'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'agent',
    },
    {
      id: 'alphacode',
      name: 'AlphaCode',
      icon: '🅰️',
      installed: Boolean(alphacodePath),
      path: alphacodePath,
      configPath: path.join(home, '.config/alphacode/config.json'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'agent',
    },
    {
      id: 'kiro',
      name: 'Kiro Code / Kilo Code',
      icon: '🎯',
      installed: Boolean(kiroPath),
      path: kiroPath,
      configPath: path.join(home, '.kiro/config.json'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'ide',
    },
    {
      id: 'python',
      name: 'Python SDK / Scripts',
      icon: '🐍',
      installed: Boolean(pythonPath),
      path: pythonPath,
      configPath: path.join(home, '.emo_gateway.env'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'cli',
    },
    {
      id: 'openwebui',
      name: 'Open WebUI',
      icon: '🌐',
      installed: Boolean(openwebuiPath),
      path: openwebuiPath,
      configPath: path.join(home, '.config/open-webui/config.json'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'app',
    },
    {
      id: 'dify',
      name: 'Dify',
      icon: '🧪',
      installed: Boolean(difyPath),
      path: difyPath,
      configPath: path.join(home, '.config/dify/.env'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'app',
    },
    {
      id: 'flowise',
      name: 'Flowise',
      icon: '🔀',
      installed: Boolean(flowisePath),
      path: flowisePath,
      configPath: path.join(home, '.config/flowise/.env'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'app',
    },
    {
      id: 'n8n',
      name: 'n8n',
      icon: '⚙️',
      installed: Boolean(n8nPath),
      path: n8nPath,
      configPath: path.join(home, '.n8n/config'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'app',
    },
    {
      id: 'continue',
      name: 'Continue',
      icon: '➕',
      installed: Boolean(continuePath),
      path: continuePath,
      configPath: path.join(home, 'Library/Application Support/Code/User/settings.json'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'ide',
    },
    {
      id: 'roocode',
      name: 'Roo Code',
      icon: '🦘',
      installed: Boolean(rooPath),
      path: rooPath,
      configPath: path.join(home, 'Library/Application Support/Code/User/settings.json'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'ide',
    },
    {
      id: 'aider',
      name: 'Aider',
      icon: '🏺',
      installed: Boolean(aiderPath),
      path: aiderPath,
      configPath: path.join(home, '.aider.conf.yml'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'cli',
    },
    {
      id: 'copilot',
      name: 'Microsoft Copilot',
      icon: '🪟',
      installed: Boolean(copilotPath),
      path: copilotPath,
      configPath: undefined,
      canAutoConfigure: false,
      protocol: 'openai',
      category: 'app',
    },
    {
      id: 'sillytavern',
      name: 'SillyTavern',
      icon: '🎭',
      installed: Boolean(sillytavernPath),
      path: sillytavernPath,
      configPath: path.join(home, 'SillyTavern/config.yaml'),
      canAutoConfigure: true,
      protocol: 'openai',
      category: 'app',
    },
  ];

  if (manager) {
    const customAgents = manager.listCustomAgents();
    for (const ca of customAgents) {
      list.push({
        id: ca.id,
        name: ca.name,
        icon: ca.icon || '🤖',
        installed: true,
        path: ca.command || undefined,
        configPath: ca.configPath || undefined,
        canAutoConfigure: true,
        protocol: ca.protocol || 'openai',
        category: 'custom',
        isCustom: true,
      });
    }
  }

  cachedAgents = { at: Date.now(), list };
  return list;
}

/**
 * Writes an agent's own configuration so it talks to this gateway.
 *
 * `home` is overridable so the whole matrix can be verified against a
 * temporary directory instead of the user's real agent settings.
 */
export async function autoConfigureAgent(
  agentId: string,
  manager: ProviderManager,
  port = 8989,
  apiKey = '',
  home: string = os.homedir()
): Promise<{
  success: boolean;
  message: string;
  configPath?: string;
  backupPath?: string;
  configuredSettings?: Record<string, unknown>;
}> {
  const origin = `http://127.0.0.1:${port}`;
  const baseUrlV1 = `${origin}/v1`;

  switch (agentId) {
    case 'opencode': {
      const confPath = path.join(home, '.config/opencode/opencode.json');
      let data: any = {};
      try {
        if (fs.existsSync(confPath)) {
          data = JSON.parse(fs.readFileSync(confPath, 'utf8'));
        }
      } catch {}
      if (!data || typeof data !== 'object') data = {};
      if (!data.provider || typeof data.provider !== 'object') data.provider = {};
      data.provider['emo-gateway'] = {
        name: 'EMO.ai Gateway',
        npm: '@ai-sdk/openai-compatible',
        options: {
          baseURL: baseUrlV1,
          apiKey: apiKey,
        },
        models: {
          'claude-web:default': { name: 'Claude Web' },
          'chatgpt-web:default': { name: 'ChatGPT Web' },
          'gemini-web:default': { name: 'Gemini Web' },
          'deepseek-web:default': { name: 'DeepSeek Web' },
          'zai-web:default': { name: 'Z.AI Web' },
        },
      };
      const bak = await safeWriteWithBackup(confPath, JSON.stringify(data, null, 2));
      return {
        success: true,
        message: 'تم ربط وتفعيل OpenCode بنجاح في opencode.json عبر emo-gateway',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'openclaw': {
      // OpenClaw reads ~/.openclaw/openclaw.json (JSON5 — plain JSON is
      // valid JSON5) and refuses to start on an unknown key, so only the
      // documented keys are written and the rest of the file is kept.
      const confPath = path.join(home, '.openclaw/openclaw.json');
      let data: any = {};
      try {
        if (fs.existsSync(confPath)) {
          data = JSON.parse(fs.readFileSync(confPath, 'utf8'));
        }
      } catch {}
      if (!data || typeof data !== 'object') data = {};

      const models = [
        { id: 'chatgpt-web-default', name: 'ChatGPT Web' },
        { id: 'claude-web-default', name: 'Claude Web' },
        { id: 'gemini-web-default', name: 'Gemini Web' },
        { id: 'deepseek-web-default', name: 'DeepSeek Web' },
        { id: 'zai-web-default', name: 'Z.AI Web' },
      ];
      data.models = data.models && typeof data.models === 'object' ? data.models : {};
      data.models.mode = 'merge';
      data.models.providers = data.models.providers && typeof data.models.providers === 'object' ? data.models.providers : {};
      data.models.providers.emo = {
        baseUrl: baseUrlV1,
        apiKey: apiKey,
        api: 'openai-completions',
        name: 'EMO.ai Gateway',
        models,
      };
      data.agents = data.agents && typeof data.agents === 'object' ? data.agents : {};
      data.agents.defaults = data.agents.defaults && typeof data.agents.defaults === 'object' ? data.agents.defaults : {};
      data.agents.defaults.model = data.agents.defaults.model && typeof data.agents.defaults.model === 'object'
        ? data.agents.defaults.model
        : {};
      data.agents.defaults.model.primary = 'emo/chatgpt-web-default';

      const bak = await safeWriteWithBackup(confPath, JSON.stringify(data, null, 2));
      return {
        success: true,
        message: 'تم ربط OpenClaw بنجاح في openclaw.json عبر مزوّد emo (openai-completions)',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'anythingllm': {
      const storageDir = path.join(home, 'Library/Application Support/anythingllm-desktop/storage');
      const envPath = path.join(storageDir, '.env');
      let lines: string[] = [];
      try {
        if (fs.existsSync(envPath)) {
          lines = fs.readFileSync(envPath, 'utf8').split('\n');
        }
      } catch {}

      const setVar = (key: string, val: string) => {
        const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
        const entry = `${key}='${val}'`;
        if (idx >= 0) lines[idx] = entry;
        else lines.push(entry);
      };

      setVar('LLM_PROVIDER', 'generic-openai');
      setVar('GENERIC_OPEN_AI_BASE_PATH', baseUrlV1);
      setVar('GENERIC_OPEN_AI_API_KEY', apiKey);
      setVar('GENERIC_OPEN_AI_MODEL_PREF', 'claude-web:default');
      setVar('GENERIC_OPEN_AI_MAX_TOKENS', '8192');

      const bak = await safeWriteWithBackup(envPath, lines.join('\n'));
      return {
        success: true,
        message: 'تم تفعيل Generic OpenAI في AnythingLLM بنجاح للاتصال بالبوابة',
        configPath: envPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'hermes': {
      const confPath = path.join(home, '.hermes/config.yaml');
      const envPath = path.join(home, '.hermes/.env');
      let yamlText = '';
      try {
        if (fs.existsSync(confPath)) {
          yamlText = fs.readFileSync(confPath, 'utf8');
        }
      } catch {}

      const newProvider = {
        api_key: apiKey,
        api_mode: 'chat_completions',
        base_url: baseUrlV1,
        model: 'claude-web:default',
        name: 'emo-gateway',
        models: {
          'claude-web:default': {},
          'chatgpt-web:default': {},
          'gemini-web:default': {},
          'deepseek-web:default': {},
        },
      };

      let bak: string | undefined;
      if (!yamlText.trim()) {
        // A fresh install has no config yet: the provider block is created.
        yamlText = `custom_providers: [${JSON.stringify(newProvider)}]\n`;
        bak = await safeWriteWithBackup(confPath, yamlText);
      } else if (yamlText.includes('custom_providers:')) {
        yamlText = yamlText.replace(/custom_providers:\s*\[(.*?)\]/s, (match) => {
          try {
            const arr = JSON.parse(match.replace(/^custom_providers:\s*/, ''));
            const filtered = arr.filter((p: any) => p.name !== 'emo-gateway' && !p.base_url?.includes(':8989'));
            filtered.unshift(newProvider);
            return `custom_providers: ${JSON.stringify(filtered)}`;
          } catch {
            return `custom_providers: [${JSON.stringify(newProvider)}]`;
          }
        });
        bak = await safeWriteWithBackup(confPath, yamlText);
      } else if (yamlText.trim()) {
        yamlText += `\ncustom_providers: [${JSON.stringify(newProvider)}]\n`;
        bak = await safeWriteWithBackup(confPath, yamlText);
      }

      if (fs.existsSync(path.dirname(envPath))) {
        let envText = '';
        try { if (fs.existsSync(envPath)) envText = fs.readFileSync(envPath, 'utf8'); } catch {}
        const envLines = envText.split('\n').filter(l => !l.startsWith('OPENAI_BASE_URL=') && !l.startsWith('OPENAI_API_KEY='));
        envLines.push(`OPENAI_BASE_URL=${baseUrlV1}`);
        envLines.push(`OPENAI_API_KEY=${apiKey}`);
        await safeWriteWithBackup(envPath, envLines.join('\n'));
      }

      return {
        success: true,
        message: 'تم ربط DeepSeek Hermes Agent وتحديث custom_providers بنجاح',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'jan': {
      const confPath = path.join(home, 'Library/Application Support/Jan/data/settings.json');
      let data: any = {};
      try {
        if (fs.existsSync(confPath)) {
          data = JSON.parse(fs.readFileSync(confPath, 'utf8'));
        }
      } catch {}
      if (!data['model-provider']) {
        // A fresh install has no provider list yet: it is created with the
        // gateway as the active OpenAI-compatible provider.
        data['model-provider'] = JSON.stringify({
          state: {
            providers: [
              {
                active: true,
                persist: true,
                provider: 'openai',
                base_url: baseUrlV1,
                settings: [{ key: 'api_key', controller_props: { value: apiKey } }],
              },
            ],
          },
        });
      }
      if (data && typeof data['model-provider'] === 'string') {
        try {
          const mp = JSON.parse(data['model-provider']);
          if (mp && mp.state && Array.isArray(mp.state.providers)) {
            const openai = mp.state.providers.find((p: any) => p.provider === 'openai');
            if (openai) {
              openai.base_url = baseUrlV1;
              openai.active = true;
            } else {
              mp.state.providers.push({
                active: true,
                persist: true,
                provider: 'openai',
                base_url: baseUrlV1,
                settings: [{ key: 'api_key', controller_props: { value: apiKey } }],
              });
            }
            data['model-provider'] = JSON.stringify(mp);
          }
        } catch {}
      }
      const bak = await safeWriteWithBackup(confPath, JSON.stringify(data, null, 2));
      return {
        success: true,
        message: 'تم ربط Jan AI وتحديث مزود OpenAI بنجاح',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'zed': {
      const confPath = path.join(home, '.config/zed/settings.json');
      let data: any = {};
      try {
        if (fs.existsSync(confPath)) {
          data = JSON.parse(fs.readFileSync(confPath, 'utf8'));
        }
      } catch {}
      if (!data.language_models) data.language_models = {};
      data.language_models.openai = {
        api_url: baseUrlV1,
        available_models: [
          { name: 'claude-web:default', max_tokens: 8192 },
          { name: 'chatgpt-web:default', max_tokens: 8192 },
          { name: 'gemini-web:default', max_tokens: 8192 },
          { name: 'deepseek-web:default', max_tokens: 8192 },
        ],
      };
      const bak = await safeWriteWithBackup(confPath, JSON.stringify(data, null, 2));
      return {
        success: true,
        message: 'تم ربط محرّر Zed بنجاح في ~/.config/zed/settings.json',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'vscode': {
      const confPath = path.join(home, 'Library/Application Support/Code/User/settings.json');
      let data: any = {};
      try {
        if (fs.existsSync(confPath)) {
          data = JSON.parse(fs.readFileSync(confPath, 'utf8'));
        }
      } catch {}
      data['continue.apiBase'] = baseUrlV1;
      data['cline.openAiBaseUrl'] = baseUrlV1;
      data['cline.openAiApiKey'] = apiKey;
      data['roo-cline.openAiBaseUrl'] = baseUrlV1;
      data['roo-cline.openAiApiKey'] = apiKey;
      const bak = await safeWriteWithBackup(confPath, JSON.stringify(data, null, 4));
      return {
        success: true,
        message: 'تم تحديث إعدادات VS Code لإضافات Cline و Continue و Roo Code بنجاح',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'copilot': {
      // GitHub Copilot Chat is a VS Code extension: it reads the same user
      // settings, and its MCP registry is the "mcp.servers" section that
      // the MCP auto-configure writes.
      const confPath = path.join(home, 'Library/Application Support/Code/User/settings.json');
      let data: any = {};
      try {
        if (fs.existsSync(confPath)) {
          data = JSON.parse(fs.readFileSync(confPath, 'utf8'));
        }
      } catch {}
      if (!data || typeof data !== 'object') data = {};
      // Copilot Chat talks to an OpenAI-compatible endpoint through a custom
      // model entry; the API key travels with it.
      data['github.copilot.chat.customOllamaModels'] = [
        { name: 'EMO.ai Gateway', endpoint: baseUrlV1, model: 'chatgpt-web:default' },
      ];
      data['github.copilot.chat.ollamaApiKey'] = apiKey;
      const bak = await safeWriteWithBackup(confPath, JSON.stringify(data, null, 4));
      return {
        success: true,
        message: 'تم تحديث إعدادات VS Code لتضمين GitHub Copilot Chat',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'cursor': {
      const confPath = path.join(home, 'Library/Application Support/Cursor/User/settings.json');
      let data: any = {};
      try {
        if (fs.existsSync(confPath)) {
          data = JSON.parse(fs.readFileSync(confPath, 'utf8'));
        }
      } catch {}
      data['cursor.general.openaiOverrideBaseUrl'] = baseUrlV1;
      data['cursor.general.openaiApiKey'] = apiKey;
      const bak = await safeWriteWithBackup(confPath, JSON.stringify(data, null, 2));
      return {
        success: true,
        message: 'تم ربط محرّر Cursor بالبوابة بنجاح',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'windsurf': {
      const confPath = path.join(home, 'Library/Application Support/Windsurf/User/settings.json');
      let data: any = {};
      try {
        if (fs.existsSync(confPath)) {
          data = JSON.parse(fs.readFileSync(confPath, 'utf8'));
        }
      } catch {}
      data['windsurf.openAiBaseUrl'] = baseUrlV1;
      data['windsurf.openAiApiKey'] = apiKey;
      const bak = await safeWriteWithBackup(confPath, JSON.stringify(data, null, 2));
      return {
        success: true,
        message: 'تم ربط محرّر Windsurf بنجاح',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 't3': {
      const confPath = path.join(home, '.t3/userdata/settings.json');
      let data: any = {};
      try {
        if (fs.existsSync(confPath)) {
          data = JSON.parse(fs.readFileSync(confPath, 'utf8'));
        }
      } catch {}
      if (!data.providerInstances) data.providerInstances = {};
      data.providerInstances.emoGateway = {
        driver: 'opencode',
        displayName: 'EMO Gateway',
        enabled: true,
        baseURL: baseUrlV1,
        apiKey: apiKey,
      };
      const bak = await safeWriteWithBackup(confPath, JSON.stringify(data, null, 2));
      return {
        success: true,
        message: 'تم ربط T3 Code بنجاح في ~/.t3/userdata/settings.json',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'codex': {
      const confPath = path.join(home, '.codex/config.toml');
      let txt = '';
      try {
        if (fs.existsSync(confPath)) txt = fs.readFileSync(confPath, 'utf8');
      } catch {}
      const block = `\n[providers.emo_gateway]\nbase_url = "${baseUrlV1}"\napi_key = "${apiKey}"\nenabled = true\n`;
      if (!txt.includes('[providers.emo_gateway]')) {
        txt += block;
      } else {
        txt = txt.replace(/\[providers\.emo_gateway\][\s\S]*?(?=\n\[|$)/, block.trim());
      }
      const bak = await safeWriteWithBackup(confPath, txt);
      return {
        success: true,
        message: 'تم ربط Codex بنجاح في ~/.codex/config.toml',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'antigravity': {
      const confPath = path.join(home, '.gemini/config/config.json');
      const envPath = path.join(home, '.gemini/antigravity.env');
      let data: any = {};
      try {
        if (fs.existsSync(confPath)) data = JSON.parse(fs.readFileSync(confPath, 'utf8'));
      } catch {}
      data.gateway = { baseURL: baseUrlV1, apiKey, enabled: true };
      const bak = await safeWriteWithBackup(confPath, JSON.stringify(data, null, 2));
      await safeWriteWithBackup(envPath, `export OPENAI_BASE_URL="${baseUrlV1}"\nexport OPENAI_API_KEY="${apiKey}"\nexport GEMINI_API_ENDPOINT="${origin}"\n`);
      return {
        success: true,
        message: 'تم ربط Antigravity (agy) وتفعيل تكوين البوابة بنجاح',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'gemini': {
      const scriptPath = path.join(home, '.gemini_gateway.sh');
      const content = `#!/bin/sh\nexport GOOGLE_GEMINI_ENDPOINT="${origin}"\nexport GEMINI_API_KEY="${apiKey}"\nexport OPENAI_BASE_URL="${baseUrlV1}"\nexport OPENAI_API_KEY="${apiKey}"\n`;
      const bak = await safeWriteWithBackup(scriptPath, content);
      return {
        success: true,
        message: 'تم إنشاء سكربت تفعيل Gemini CLI في ~/.gemini_gateway.sh',
        configPath: scriptPath,
        backupPath: bak,
        configuredSettings: { endpoint: origin, apiKey },
      };
    }

    case 'claudecode': {
      const confPath = path.join(home, '.claude.json');
      const scriptPath = path.join(home, '.claude_gateway.sh');
      let data: any = {};
      try {
        if (fs.existsSync(confPath)) data = JSON.parse(fs.readFileSync(confPath, 'utf8'));
      } catch {}
      if (!data.gateway) data.gateway = {};
      data.gateway = { baseURL: origin, apiKey };
      const bak = await safeWriteWithBackup(confPath, JSON.stringify(data, null, 2));
      await safeWriteWithBackup(scriptPath, `export ANTHROPIC_BASE_URL="${origin}"\nexport ANTHROPIC_API_KEY="${apiKey}"\n`);
      return {
        success: true,
        message: 'تم ربط Claude Code وتكوين ANTHROPIC_BASE_URL بنجاح',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: origin, apiKey },
      };
    }

    case 'librechat': {
      const confPath = path.join(home, '.config/librechat/librechat.yaml');
      const yaml = `version: 1.0.8\nendpoints:\n  custom:\n    - name: "EMO.ai Gateway"\n      apiKey: "${apiKey}"\n      baseURL: "${baseUrlV1}"\n      models:\n        default: ["claude-web:default", "chatgpt-web:default", "gemini-web:default"]\n`;
      const bak = await safeWriteWithBackup(confPath, yaml);
      return {
        success: true,
        message: 'تم ربط LibreChat بنجاح في ~/.config/librechat/librechat.yaml',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'pi': {
      const confPath = path.join(home, '.config/pi/config.json');
      const data = { baseURL: baseUrlV1, apiKey, activeModel: 'claude-web:default' };
      const bak = await safeWriteWithBackup(confPath, JSON.stringify(data, null, 2));
      return {
        success: true,
        message: 'تم ربط وتكوين PI Agent بنجاح في ~/.config/pi/config.json',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'alphacode': {
      const confPath = path.join(home, '.config/alphacode/config.json');
      const data = { api_url: baseUrlV1, api_key: apiKey };
      const bak = await safeWriteWithBackup(confPath, JSON.stringify(data, null, 2));
      return {
        success: true,
        message: 'تم ربط AlphaCode بنجاح في ~/.config/alphacode/config.json',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'kiro': {
      const confPath = path.join(home, '.kiro/config.json');
      const data = { baseURL: baseUrlV1, apiKey };
      const bak = await safeWriteWithBackup(confPath, JSON.stringify(data, null, 2));
      return {
        success: true,
        message: 'تم ربط Kiro Code / Kilo Code بنجاح في ~/.kiro/config.json',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'lobehub': {
      const confPath = path.join(home, 'Library/Application Support/LobeHub/gateway-config.json');
      const data = { openai: { endpoint: baseUrlV1, apiKey } };
      const bak = await safeWriteWithBackup(confPath, JSON.stringify(data, null, 2));
      return {
        success: true,
        message: 'تم ربط وتكوين LobeHub بنجاح في gateway-config.json',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'python': {
      const envPath = path.join(home, '.emo_gateway.env');
      const content = `export OPENAI_BASE_URL="${baseUrlV1}"\nexport OPENAI_API_KEY="${apiKey}"\nexport ANTHROPIC_BASE_URL="${origin}"\n`;
      const bak = await safeWriteWithBackup(envPath, content);
      return {
        success: true,
        message: 'تم إنشاء ملف البيئة ~/.emo_gateway.env لاستخدامه في Python بنجاح',
        configPath: envPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'openwebui': {
      const confPath = path.join(home, '.config/open-webui/config.json');
      let data: any = {};
      try {
        if (fs.existsSync(confPath)) data = JSON.parse(fs.readFileSync(confPath, 'utf8'));
      } catch {}
      if (!data.ollama) data.ollama = {};
      if (!data.openai) data.openai = {};
      data.openai.api_base = baseUrlV1;
      data.openai.api_key = apiKey;
      data.openai.enabled = true;
      const bak = await safeWriteWithBackup(confPath, JSON.stringify(data, null, 2));
      const envPath = path.join(home, '.config/open-webui/.env');
      await safeWriteWithBackup(envPath, `OPENAI_API_BASE_URL=${baseUrlV1}\nOPENAI_API_KEY=${apiKey}\n`);
      return {
        success: true,
        message: 'تم ربط Open WebUI بالبوابة بنجاح في config.json و .env',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'dify': {
      const confPath = path.join(home, '.config/dify/.env');
      let lines: string[] = [];
      try {
        if (fs.existsSync(confPath)) lines = fs.readFileSync(confPath, 'utf8').split('\n');
      } catch {}
      const setVar = (key: string, val: string) => {
        const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
        const entry = `${key}=${val}`;
        if (idx >= 0) lines[idx] = entry;
        else lines.push(entry);
      };
      setVar('OPENAI_API_BASE', baseUrlV1);
      setVar('OPENAI_API_KEY', apiKey);
      const bak = await safeWriteWithBackup(confPath, lines.join('\n'));
      return {
        success: true,
        message: 'تم ربط Dify بالبوابة بنجاح في .env',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'flowise': {
      const confPath = path.join(home, '.config/flowise/.env');
      let lines: string[] = [];
      try {
        if (fs.existsSync(confPath)) lines = fs.readFileSync(confPath, 'utf8').split('\n');
      } catch {}
      const setVar = (key: string, val: string) => {
        const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
        const entry = `${key}=${val}`;
        if (idx >= 0) lines[idx] = entry;
        else lines.push(entry);
      };
      setVar('OPENAI_API_BASE', baseUrlV1);
      setVar('OPENAI_API_KEY', apiKey);
      const bak = await safeWriteWithBackup(confPath, lines.join('\n'));
      return {
        success: true,
        message: 'تم ربط Flowise بالبوابة بنجاح في .env',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'n8n': {
      const confPath = path.join(home, '.n8n/config');
      let txt = '';
      try {
        if (fs.existsSync(confPath)) txt = fs.readFileSync(confPath, 'utf8');
      } catch {}
      txt += `\n# EMO.ai Gateway\nN8N_OPENAI_API_BASE=${baseUrlV1}\nN8N_OPENAI_API_KEY=${apiKey}\n`;
      const bak = await safeWriteWithBackup(confPath, txt);
      return {
        success: true,
        message: 'تم ربط n8n بالبوابة بنجاح في ~/.n8n/config',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'continue': {
      const vscodePath = path.join(home, 'Library/Application Support/Code/User/settings.json');
      let vscodeData: any = {};
      try {
        if (fs.existsSync(vscodePath)) vscodeData = JSON.parse(fs.readFileSync(vscodePath, 'utf8'));
      } catch {}
      vscodeData['continue.apiBase'] = baseUrlV1;
      vscodeData['continue.apiKey'] = apiKey;
      vscodeData['continue.model'] = 'claude-web:default';
      const bak = await safeWriteWithBackup(vscodePath, JSON.stringify(vscodeData, null, 4));

      const contPath = path.join(home, '.continue/config.json');
      let contData: any = {};
      try {
        if (fs.existsSync(contPath)) contData = JSON.parse(fs.readFileSync(contPath, 'utf8'));
      } catch {}
      if (!Array.isArray(contData.models)) contData.models = [];
      const emoModel = {
        title: 'EMO Gateway',
        provider: 'openai',
        model: 'claude-web:default',
        apiBase: baseUrlV1,
        apiKey: apiKey,
      };
      const idx = contData.models.findIndex((m: any) => m && (m.title === 'EMO Gateway' || m.apiBase === baseUrlV1));
      if (idx >= 0) contData.models[idx] = { ...contData.models[idx], ...emoModel };
      else contData.models.unshift(emoModel);
      await safeWriteWithBackup(contPath, JSON.stringify(contData, null, 2));

      return {
        success: true,
        message: 'تم ربط Continue بالبوابة بنجاح في إعدادات VS Code و ~/.continue/config.json',
        configPath: contPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'roocode': {
      const confPath = path.join(home, 'Library/Application Support/Code/User/settings.json');
      let data: any = {};
      try {
        if (fs.existsSync(confPath)) data = JSON.parse(fs.readFileSync(confPath, 'utf8'));
      } catch {}
      data['roo-cline.openAiBaseUrl'] = baseUrlV1;
      data['roo-cline.openAiApiKey'] = apiKey;
      data['roo-cline.model'] = 'claude-web:default';
      const bak = await safeWriteWithBackup(confPath, JSON.stringify(data, null, 4));
      return {
        success: true,
        message: 'تم ربط إضافة Roo Code في VS Code بالبوابة بنجاح',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'aider': {
      const confPath = path.join(home, '.aider.conf.yml');
      let txt = '';
      try {
        if (fs.existsSync(confPath)) txt = fs.readFileSync(confPath, 'utf8');
      } catch {}
      const setYaml = (key: string, val: string) => {
        const re = new RegExp(`^${key}:.*$`, 'm');
        const line = `${key}: ${val}`;
        if (re.test(txt)) txt = txt.replace(re, line);
        else txt += (txt.endsWith('\n') || txt === '' ? '' : '\n') + line + '\n';
      };
      setYaml('openai-api-base', baseUrlV1);
      setYaml('openai-api-key', apiKey);
      setYaml('model', 'openai/claude-web:default');
      const bak = await safeWriteWithBackup(confPath, txt.trimEnd() + '\n');
      return {
        success: true,
        message: 'تم ربط Aider بالبوابة بنجاح في ~/.aider.conf.yml',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    case 'sillytavern': {
      const confPath = path.join(home, 'SillyTavern/config.yaml');
      let txt = '';
      try {
        if (fs.existsSync(confPath)) txt = fs.readFileSync(confPath, 'utf8');
      } catch {}
      const gatewayBlock = `\n# EMO.ai Gateway\ngateway:\n  openai_base_url: ${baseUrlV1}\n  openai_api_key: ${apiKey}\n`;
      txt += gatewayBlock;
      const bak = await safeWriteWithBackup(confPath, txt);
      return {
        success: true,
        message: 'تم ربط SillyTavern بالبوابة بنجاح في ~/SillyTavern/config.yaml',
        configPath: confPath,
        backupPath: bak,
        configuredSettings: { baseURL: baseUrlV1, apiKey },
      };
    }

    default: {
      const custom = manager.listCustomAgents().find((c) => c.id === agentId);
      if (custom) {
        const targetPath = custom.configPath && custom.configPath.trim()
          ? custom.configPath.trim()
          : path.join(home, `.config/${agentId}/gateway.json`);
        const targetUrl = custom.protocol === 'anthropic' ? origin : (custom.protocol === 'gemini' ? origin : baseUrlV1);
        const data = {
          name: custom.name,
          protocol: custom.protocol,
          baseURL: targetUrl,
          apiKey,
          updatedAt: new Date().toISOString(),
        };
        const bak = await safeWriteWithBackup(targetPath, JSON.stringify(data, null, 2));
        return {
          success: true,
          message: `تم ربط الوكيل المخصص ${custom.name} بنجاح في ${targetPath}`,
          configPath: targetPath,
          backupPath: bak,
          configuredSettings: { baseURL: targetUrl, apiKey },
        };
      }
      return {
        success: false,
        message: `تعذّر التعرّف على طريقة الربط التلقائي للوكيل: ${agentId}`,
      };
    }
  }
}

export function registerGatewayRoutes(app: FastifyInstance, opts: {
  manager: ProviderManager;
  tracker: UsageTracker;
  getGatewayConfig: () => GatewayConfigFile;
}): void {
  // --- MCP endpoint -----------------------------------------------------
  // The agent bindings (Cline, VS Code, OpenCode, Hermes, …) are pointed at
  // http://127.0.0.1:<port>/mcp for LOCAL FILE ACCESS. This is what makes
  // that URL real — without it every agent tool call failed with a broken
  // workspace connection.
  registerMcpServer(app, {
    resolveKeyAuth: (key) => opts.manager.resolveKeyAuth(key),
    isValidApiKey: (key) => isValidApiKey(key, opts.manager.getValidApiKeys()),
    apiKey: opts.getGatewayConfig().gateway.apiKey,
    // Read LIVE so a change of the workspace root applies immediately.
    workspaceRoots: () => opts.getGatewayConfig().ui?.mcp?.workspaceRoots || [],
  });

  app.post('/api/gateway/heartbeat', async () => {
    opts.tracker.heartbeat();
    return { ok: true };
  });

  // Live push channel (EasyCLIProxyAPI-style subscription, adapted): the server
  // emits a `usage` event the moment a request starts or ends. The UI listens
  // via EventSource and refreshes instantly; status polling remains the HTTP
  // compatibility fallback. Protected by the same API-key hook as other
  // /api/gateway/* routes (UI passes ?key=).
  app.get('/api/gateway/events', async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
    });
    reply.raw.write('retry: 2000\n\n');
    const pushUsage = () => {
      try {
        if (!reply.raw.writableEnded) reply.raw.write('event: usage\ndata: {}\n\n');
      } catch { /* client gone */ }
    };
    const offUsage = opts.tracker.onUsageChange(pushUsage);
    const ping = setInterval(() => {
      try {
        if (!reply.raw.writableEnded) reply.raw.write(': ping\n\n');
      } catch { /* client gone */ }
    }, 25000);
    req.raw.on('close', () => {
      offUsage();
      clearInterval(ping);
      try { reply.raw.end(); } catch { /* already closed */ }
    });
  });

  app.get('/api/gateway/status', async () => {
    const cfg = opts.getGatewayConfig();
    const manager = opts.manager as unknown as {
      getStateWithDiscovery?: (id: string) => Promise<any>;
      getDiscoveryService?: () => { unreadCount(): Promise<number> } | null;
    };
    const states = await Promise.all(
      opts.manager.listStates().map(async (p) => {
        if (typeof manager.getStateWithDiscovery === 'function') {
          return manager.getStateWithDiscovery(p.id);
        }
        return opts.manager.getState(p.id);
      }),
    );
    const providers = states.map((p) => ({
      ...p,
      settings: (() => { const { userDataDir: _ud, ...rest } = (p.settings || {}) as Record<string, unknown>; void _ud; return { ...rest, userDataDir: '[redacted]' }; })(),
    }));
    const discovery = typeof manager.getDiscoveryService === 'function' ? manager.getDiscoveryService() : null;
    const unreadNotifications = discovery ? await discovery.unreadCount() : 0;
    return {
      gateway: {
        baseUriDisplay: cfg.gateway.baseUriDisplay,
        api: cfg.gateway.apiKey,
        host: cfg.gateway.host,
        port: cfg.gateway.port,
        serviceRunning: opts.manager.isServiceRunning(),
      },
      serviceRunning: opts.manager.isServiceRunning(),
      usage: opts.tracker.snapshot(),
      providers,
      unreadNotifications,
      customProviders: (cfg.gateway.customProviders || []).map((cp) => ({
        id: cp.id,
        name: cp.name,
        enabled: cp.enabled,
        models: cp.models,
      })),
      recentRequests: opts.tracker.getRecentRequests(),
    };
  });

  app.post('/api/gateway/service-toggle', async () => {
    const current = opts.manager.isServiceRunning();
    const next = !current;
    await opts.manager.setServiceRunning(next);
    return { serviceRunning: next };
  });

  app.post('/api/gateway/recent-requests/clear', async () => {
    opts.tracker.clearRecentRequests();
    return { ok: true };
  });

  /**
   * Live web model discovery for one provider: reads the provider's OWN
   * website and reports what changed.
   */
  app.post('/api/gateway/providers/:id/discover', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    const service = opts.manager.getDiscoveryService();
    if (!service) {
      return reply.status(503).send({ error: { message: 'Model discovery is not enabled on this gateway.' } });
    }
    /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
    try {
      const report = await opts.manager.discoverModels(id);
      if (!report) {
        return reply.status(503).send({ error: { message: 'Model discovery is not enabled on this gateway.' } });
      }
      const state = await opts.manager.getStateWithDiscovery(id);
      return { ok: report.status === 'discovered', report, state };
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: { message: e instanceof Error ? e.message : String(e) },
      });
    }
  });

  /** The change history of a provider (from the notification centre). */
  app.get('/api/gateway/discovery/notifications', async (req) => {
    const query = (req.query || {}) as { providerId?: string; unreadOnly?: string; limit?: string };
    const service = opts.manager.getDiscoveryService();
    if (!service) return { notifications: [], unreadCount: 0 };
    const notifications = await service.notifications({
      providerId: query.providerId,
      unreadOnly: query.unreadOnly === 'true',
      limit: query.limit ? Number(query.limit) : undefined,
    });
    const unreadCount = await service.unreadCount();
    return { notifications, unreadCount };
  });

  app.post('/api/gateway/discovery/notifications/:notificationId/read', async (req, reply) => {
    const { notificationId } = req.params as { notificationId: string };
    const body = (req.body || {}) as { read?: boolean };
    const service = opts.manager.getDiscoveryService();
    if (!service) return reply.status(503).send({ error: { message: 'Model discovery is not enabled.' } });
    const ok = await service.markRead(notificationId, body.read !== false);
    return { ok, unreadCount: await service.unreadCount() };
  });

  app.post('/api/gateway/discovery/notifications/read-all', async (req) => {
    const body = (req.body || {}) as { providerId?: string };
    const service = opts.manager.getDiscoveryService();
    if (!service) return { marked: 0, unreadCount: 0 };
    const marked = await service.markAllRead(body.providerId);
    return { marked, unreadCount: await service.unreadCount() };
  });

  /** The last discovery report of a provider (what changed, in detail). */
  app.get('/api/gateway/providers/:id/discovery', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    const service = opts.manager.getDiscoveryService();
    if (!service) return reply.status(503).send({ error: { message: 'Model discovery is not enabled.' } });
    const snapshot = await service.snapshot(id);
    const report = opts.manager.lastDiscoveryReport(id);
    const notifications = await service.notifications({ providerId: id, limit: 50 });
    return { snapshot, report, notifications, state: await opts.manager.getStateWithDiscovery(id) };
  });

  app.post('/api/gateway/providers/:id/start', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    return opts.manager.start(id);
  });
  app.post('/api/gateway/providers/:id/stop', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    return opts.manager.stop(id);
  });
  app.post('/api/gateway/providers/:id/refresh', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    try {
      const outcome = await opts.manager.refreshModelsReport(id);
      const state = opts.manager.getState(id);
      if (!outcome.ok) {
        // A failed discovery is NOT a success: report it as a failure and keep
        // the last good model list on the provider.
        return reply.status(502).send({
          ok: false,
          error: { message: outcome.error || 'Model discovery failed' },
          outcome,
          state,
        });
      }
      return { ok: true, outcome, state };
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: { message: e instanceof Error ? e.message : String(e) },
      });
    }
  });
  app.post('/api/gateway/providers/:id/login', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    const body = (req.body || {}) as { accountId?: string };
    try {
      return await opts.manager.login(id, typeof body.accountId === 'string' ? body.accountId : undefined);
    } catch (e) {
      return reply.status(500).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });
  app.get('/api/gateway/agents/detect', async (req) => {
    const query = (req.query || {}) as { rescan?: string };
    const force = query.rescan === 'true' || query.rescan === '1';
    const agents = await detectLocalAgents(opts.manager, force);
    return { agents, scannedAt: new Date().toISOString() };
  });

  app.post('/api/gateway/agents/rescan', async () => {
    const agents = await detectLocalAgents(opts.manager, true);
    const installed = agents.filter((a) => a.installed).length;
    const configured = agents.filter((a) => a.isConfigured).length;
    return {
      agents,
      scannedAt: new Date().toISOString(),
      summary: { total: agents.length, installed, configured },
    };
  });

  app.post('/api/gateway/agents/custom', async (req, reply) => {
    const body = (req.body || {}) as {
      name?: string;
      id?: string;
      icon?: string;
      protocol?: 'openai' | 'anthropic' | 'gemini';
      command?: string;
      configPath?: string;
      notes?: string;
    };
    if (!body.name || !body.name.trim()) {
      return reply.status(400).send({ error: { message: 'اسم الوكيل مطلوب' } });
    }
    try {
      const item = await opts.manager.addCustomAgent({ ...body, name: body.name.trim() });
      cachedAgents = null;
      return { agent: item, success: true };
    } catch (e) {
      return reply.status(500).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.delete('/api/gateway/agents/custom/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const ok = await opts.manager.deleteCustomAgent(id);
      cachedAgents = null;
      return { ok, success: ok };
    } catch (e) {
      return reply.status(500).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.post('/api/gateway/agents/:id/auto-configure', async (req, reply) => {
    const { id } = req.params as { id: string };
    const cfg = opts.getGatewayConfig();
    const port = cfg.gateway.port || 8989;
    const apiKey = cfg.gateway.apiKey || '';
    try {
      // Honest guard: never bind an agent that is not actually installed.
      const agents = await detectLocalAgents(opts.manager, true);
      const agent = agents.find((a) => a.id === id);
      if (agent && !agent.installed && !agent.isCustom) {
        return {
          success: false,
          message: `الوكيل «${agent.name}» غير مثبت على هذا الجهاز — لا يمكن الربط التلقائي. ثبّت الوكيل أولاً ثم أعد المحاولة.`,
        };
      }
      const result = await autoConfigureAgent(id, opts.manager, port, apiKey);
      if (result.success) {
        cachedAgents = null;
      }
      return result;
    } catch (e) {
      return reply.status(500).send({
        success: false,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post('/api/gateway/providers/:id/ping', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    try {
      const report = await opts.manager.checkConnection(id);
      return { ok: report.status === 'connected', report, state: opts.manager.getState(id) };
    } catch (e) {
      return reply.status(500).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  /**
   * Starts a background sweep that discovers the models of EVERY provider.
   * It takes minutes (each provider opens its own browser), so it runs in the
   * background and the UI polls /api/gateway/discovery/job for the progress.
   */
  app.post('/api/gateway/discovery/sweep', async (req, reply) => {
    const body = (req.body || {}) as { approved?: boolean };
    // Without an explicit approval the sweep only CREATES a pending job —
    // the UI asks the user before any browser is opened.
    const job = opts.manager.startDiscoverySweep({ requireConsent: body.approved !== true });
    if (!job) {
      return reply.status(503).send({ error: { message: 'Model discovery is not enabled on this gateway.' } });
    }
    return { started: true, awaitingConsent: job.awaitingConsent, job };
  });

  /**
   * The user's answer to "the browser will open to update the models".
   * approved=true lets the sweep open a visible browser; approved=false
   * postpones it.
   */
  app.post('/api/gateway/discovery/consent', async (req, reply) => {
    const body = (req.body || {}) as { approved?: boolean };
    const approved = body.approved === true;
    opts.manager.setHeadedConsent(approved);
    return { approved, job: opts.manager.getBulkJob() };
  });

  /** Starts a background sweep that checks the CONNECTION of every provider. */
  app.post('/api/gateway/discovery/check-all', async (req, reply) => {
    const job = opts.manager.startConnectionSweep();
    if (!job) {
      return reply.status(503).send({ error: { message: 'Connection checks are not enabled on this gateway.' } });
    }
    return { started: true, job };
  });

  /**
   * The workspace roots the agent file tools may touch.
   * Changing them applies immediately (the MCP server reads them per request).
   */
  app.get('/api/gateway/mcp/workspace', async () => {
    const cfg = opts.getGatewayConfig();
    return {
      roots: cfg.ui?.mcp?.workspaceRoots || [],
      defaultRoot: (cfg.ui?.mcp?.workspaceRoots || [])[0] || null,
    };
  });

  /**
   * The agents that support MCP and the file each of them reads.
   * The UI uses it to show what is already linked.
   */
  app.get('/api/gateway/mcp/targets', async () => {
    const cfg = opts.getGatewayConfig();
    const port = cfg.gateway.port || 8989;
    const targets = mcpTargets().map((t) => {
      let linked = false;
      try {
        if (fs.existsSync(t.file)) {
          const raw = JSON.parse(fs.readFileSync(t.file, 'utf8'));
          linked = Boolean(
            raw?.mcp?.servers?.['emo.web'] ||
              raw?.mcpServers?.['emo.web'] ||
              raw?.context_servers?.['emo.web'] ||
              (Array.isArray(raw?.mcpServers) && raw.mcpServers.some((s: any) => s?.name === 'emo.web')) ||
              raw?.mcp?.servers?.['emo.web'],
          );
        }
      } catch {
        linked = false;
      }
      return { id: t.id, name: t.name, path: t.file, linked };
    });
    return { targets, mcpUrl: `http://127.0.0.1:${port}/mcp` };
  });

  /**
   * Writes the MCP server into the agents' OWN configuration files — the
   * step that turns "here is a snippet" into "the agent has the tools".
   */
  app.post('/api/gateway/mcp/auto-configure', async (req, reply) => {
    const body = (req.body || {}) as { agentIds?: unknown };
    const cfg = opts.getGatewayConfig();
    const port = cfg.gateway.port || 8989;
    const apiKey = cfg.gateway.apiKey || '';
    const only = Array.isArray(body.agentIds)
      ? body.agentIds.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
      : undefined;
    try {
      const agents = await detectLocalAgents(opts.manager, false);
      const installed = agents.filter((a) => a.installed || a.isCustom).map((a) => a.id);
      const out = configureMcpServers({
        mcpUrl: `http://127.0.0.1:${port}/mcp`,
        apiKey,
        only,
        installed,
      });
      return { ...out, success: out.failed === 0 };
    } catch (e) {
      return reply.status(500).send({
        success: false,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.patch('/api/gateway/mcp/workspace', async (req, reply) => {
    const body = (req.body || {}) as { roots?: unknown };
    if (!Array.isArray(body.roots)) {
      return reply.status(400).send({ error: { message: 'roots must be an array of directories' } });
    }
    const roots = body.roots
      .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
      .map((r) => path.resolve(r.trim()))
      .slice(0, 20);
    const invalid = roots.filter((r) => !fs.existsSync(r) || !fs.statSync(r).isDirectory());
    if (invalid.length) {
      return reply.status(400).send({ error: { message: `Not a directory: ${invalid.join(', ')}` } });
    }
    const cfg = opts.getGatewayConfig();
    cfg.ui = cfg.ui || ({} as any);
    cfg.ui.mcp = { ...(cfg.ui.mcp || {}), workspaceRoots: roots };
    await opts.manager.saveConfig();
    return { ok: true, roots };
  });

  /**
   * Tunnel configuration for MCP:
   * Supports OpenAI Platform Organization Tunnels (https://platform.openai.com/settings/organization/tunnels)
   * or a custom public HTTPS tunnel endpoint.
   */
  app.get('/api/gateway/mcp/tunnel', async () => {
    const cfg = opts.getGatewayConfig();
    const port = cfg.gateway.port || 8989;
    const state = mcpTunnelServer.getState();
    const openaiTunnelUrl = cfg.ui?.mcp?.openaiTunnelUrl || '';
    const tunnelId = cfg.ui?.mcp?.tunnelId || '';
    const tunnelToken = cfg.ui?.mcp?.tunnelToken || '';
    const tunnelAutoStart = Boolean(cfg.ui?.mcp?.tunnelAutoStart);
    const localMcpUrl = `http://127.0.0.1:${port}/mcp`;
    const effectivePublicMcp = state.publicMcpUrl || (openaiTunnelUrl ? (openaiTunnelUrl.endsWith('/mcp') ? openaiTunnelUrl : `${openaiTunnelUrl.replace(/\/$/, '')}/mcp`) : null);

    return {
      active: state.status === 'running' || Boolean(effectivePublicMcp),
      status: state.status,
      provider: state.provider,
      openaiTunnelUrl: openaiTunnelUrl || null,
      tunnelId: tunnelId || null,
      tunnelToken: tunnelToken ? '***' : null,
      tunnelAutoStart,
      localMcpUrl,
      publicMcpUrl: effectivePublicMcp,
      startedAt: state.startedAt,
      error: state.error,
      helpUrl: 'https://platform.openai.com/settings/organization/tunnels',
    };
  });

  app.post('/api/gateway/mcp/tunnel', async (req, reply) => {
    const body = (req.body || {}) as { openaiTunnelUrl?: unknown; tunnelToken?: unknown; tunnelId?: unknown; tunnelAutoStart?: unknown };
    const cfg = opts.getGatewayConfig();
    cfg.ui = cfg.ui || ({} as any);
    const existingMcp = cfg.ui.mcp || { workspaceRoots: [] };
    const rawUrl = typeof body.openaiTunnelUrl === 'string' ? body.openaiTunnelUrl.trim() : undefined;
    const rawToken = typeof body.tunnelToken === 'string' ? body.tunnelToken.trim() : undefined;
    const rawTunnelId = typeof body.tunnelId === 'string' ? body.tunnelId.trim() : undefined;
    const rawAutoStart = typeof body.tunnelAutoStart === 'boolean' ? body.tunnelAutoStart : undefined;

    cfg.ui.mcp = {
      ...existingMcp,
      openaiTunnelUrl: rawUrl !== undefined ? rawUrl : existingMcp.openaiTunnelUrl,
      tunnelToken: rawToken !== undefined ? rawToken : existingMcp.tunnelToken,
      tunnelId: rawTunnelId !== undefined ? rawTunnelId : existingMcp.tunnelId,
      tunnelAutoStart: rawAutoStart !== undefined ? rawAutoStart : existingMcp.tunnelAutoStart,
    };
    await opts.manager.saveConfig();
    const port = cfg.gateway.port || 8989;
    const resolvedUrl = cfg.ui.mcp.openaiTunnelUrl;
    const publicMcpUrl = resolvedUrl ? (resolvedUrl.endsWith('/mcp') ? resolvedUrl : `${resolvedUrl.replace(/\/$/, '')}/mcp`) : null;
    return {
      ok: true,
      openaiTunnelUrl: cfg.ui.mcp.openaiTunnelUrl || null,
      publicMcpUrl,
      localMcpUrl: `http://127.0.0.1:${port}/mcp`,
    };
  });

  app.post('/api/gateway/mcp/tunnel/start', async (req, reply) => {
    const body = (req.body || {}) as { provider?: string; customUrl?: string; tunnelId?: string; token?: string };
    const cfg = opts.getGatewayConfig();
    const port = cfg.gateway.port || 8989;
    const customUrl = body.customUrl || cfg.ui?.mcp?.openaiTunnelUrl;
    const tunnelId = body.tunnelId || cfg.ui?.mcp?.tunnelId;
    const token = body.token || cfg.ui?.mcp?.tunnelToken;
    const provider = (body.provider as any) || (tunnelId || customUrl ? 'openai' : 'cloudflared');
    const gatewayApiKey = cfg.gateway.apiKey;
    try {
      const state = await mcpTunnelServer.start({ provider, customUrl, tunnelId, port, token, gatewayApiKey });
      return { ok: true, state };
    } catch (e) {
      return reply.status(500).send({ ok: false, error: (e as Error).message });
    }
  });

  app.post('/api/gateway/mcp/tunnel/stop', async () => {
    const state = await mcpTunnelServer.stop();
    return { ok: true, state };
  });

  /** The progress of the running (or last) bulk job. */
  app.get('/api/gateway/discovery/job', async () => {
    return { job: opts.manager.getBulkJob() };
  });

  /**
   * Real connection check for one provider (same probe as /ping, clearer name + report shape).
   */
  app.post('/api/gateway/providers/:id/connection', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    try {
      const report = await opts.manager.checkConnection(id);
      return { ok: report.status === 'connected', report, state: opts.manager.getState(id) };
    } catch (e) {
      return reply.status(500).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.post('/api/gateway/providers/:id/check-auth', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    return opts.manager.checkAuth(id);
  });
  app.patch('/api/gateway/providers/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    const body = (req.body || {}) as any;
    try {
      const state = await opts.manager.updateProvider(id, {
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        settings: body.settings && typeof body.settings === 'object' ? body.settings : undefined,
        selectedModels: Array.isArray(body.selectedModels) ? body.selectedModels : undefined,
        availableModels: Array.isArray(body.availableModels) ? body.availableModels : undefined,
        auth: body.auth && typeof body.auth === 'object' ? body.auth : undefined,
        accountEmail: typeof body.accountEmail === 'string' ? body.accountEmail : undefined,
        accountName: typeof body.accountName === 'string' ? body.accountName : undefined,
      });
      return state;
    } catch (e) {
      return reply.status(500).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.post('/api/gateway/providers/:id/accounts', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    const body = (req.body || {}) as { name?: string; email?: string; userDataDir?: string };
    if (!body.email) return reply.status(400).send({ error: { message: 'Email is required' } });
    try {
      return await opts.manager.addAccount(id, {
        name: body.name || body.email,
        email: body.email,
        userDataDir: body.userDataDir,
      });
    } catch (e) {
      return reply.status(500).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.post('/api/gateway/providers/:id/accounts/:accId/activate', async (req, reply) => {
    const { id, accId } = req.params as { id: string; accId: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    try {
      return await opts.manager.switchAccount(id, accId);
    } catch (e) {
      return reply.status(500).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.patch('/api/gateway/providers/:id/accounts/:accId', async (req, reply) => {
    const { id, accId } = req.params as { id: string; accId: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    const body = (req.body || {}) as { enabled?: boolean };
    if (typeof body.enabled !== 'boolean') return reply.status(400).send({ error: { message: 'enabled boolean required' } });
    try {
      return await opts.manager.toggleAccount(id, accId, body.enabled);
    } catch (e) {
      return reply.status(500).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.delete('/api/gateway/providers/:id/accounts/:accId', async (req, reply) => {
    const { id, accId } = req.params as { id: string; accId: string };
    if (!isProviderId(id)) return reply.status(400).send({ error: { message: 'Unknown provider' } });
    try {
      return await opts.manager.removeAccount(id, accId);
    } catch (e) {
      return reply.status(500).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  // API Key Management routes
  app.get('/api/gateway/keys', async () => {
    return { keys: opts.manager.listApiKeys() };
  });

  app.post('/api/gateway/keys', async (req, reply) => {
    const body = (req.body || {}) as { name?: string; key?: string };
    try {
      const item = await opts.manager.addApiKey(body.name || '', body.key);
      return { key: item };
    } catch (e) {
      return reply.status(500).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.delete('/api/gateway/keys/:keyId', async (req, reply) => {
    const { keyId } = req.params as { keyId: string };
    try {
      const ok = await opts.manager.deleteApiKey(keyId);
      return { ok };
    } catch (e) {
      return reply.status(500).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.patch('/api/gateway/keys/:keyId', async (req, reply) => {
    const { keyId } = req.params as { keyId: string };
    const body = (req.body || {}) as { enabled?: boolean };
    if (typeof body.enabled !== 'boolean') return reply.status(400).send({ error: { message: 'enabled boolean required' } });
    try {
      const item = await opts.manager.toggleApiKey(keyId, body.enabled);
      return { key: item };
    } catch (e) {
      return reply.status(500).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  // Custom Upstream Provider routes
  app.get('/api/gateway/custom-providers', async () => {
    return { providers: opts.manager.listCustomProviders() };
  });

  app.post('/api/gateway/custom-providers/verify', async (req, reply) => {
    const body = (req.body || {}) as {
      baseUrl?: string;
      apiKey?: string;
      providerId?: string;
      testModel?: string;
    };
    let baseUrl = body.baseUrl;
    let apiKey = body.apiKey;
    let testModel = body.testModel;

    if (body.providerId && !baseUrl) {
      const existing = opts.manager.listCustomProviders().find((p) => p.id === body.providerId);
      if (!existing) {
        return reply.status(404).send({ error: { message: 'المزود المخصص غير موجود' } });
      }
      baseUrl = existing.baseUrl;
      apiKey = existing.apiKey;
      testModel = testModel || existing.models?.[0];
    }

    if (!baseUrl) {
      return reply.status(400).send({ error: { message: 'يرجى إدخال رابط Base URL أولاً' } });
    }

    try {
      const result = await opts.manager.verifyCustomProviderConnection({
        baseUrl,
        apiKey,
        testModel,
      });
      if (body.providerId && result.ok) {
        const existing = opts.manager.listCustomProviders().find((p) => p.id === body.providerId);
        if (existing) {
          const cleanExistingModels = (existing.models || []).filter((m) => m && m !== 'default');
          const nextModels = cleanExistingModels.length > 0 ? cleanExistingModels : result.models;
          await opts.manager.updateCustomProvider(body.providerId, {
            baseUrl: existing.baseUrl,
            models: nextModels,
          });
        }
      }
      return result;
    } catch (e) {
      return reply.status(400).send({
        ok: false,
        error: { message: e instanceof Error ? e.message : String(e) },
      });
    }
  });

  app.post('/api/gateway/custom-providers/fetch-models', async (req, reply) => {
    const body = (req.body || {}) as { baseUrl?: string; apiKey?: string; name?: string };
    if (!body.baseUrl) return reply.status(400).send({ error: { message: 'يرجى إدخال رابط Base URL أولاً' } });
    try {
      const result = await opts.manager.fetchCustomProviderModelsWithMeta(body.baseUrl, body.apiKey, body.name);
      return result;
    } catch (e) {
      return reply.status(400).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.post('/api/gateway/custom-providers', async (req, reply) => {
    const body = (req.body || {}) as { name?: string; baseUrl?: string; apiKey?: string; models?: string[] };
    if (!body.baseUrl) return reply.status(400).send({ error: { message: 'baseUrl is required' } });
    try {
      const item = await opts.manager.addCustomProvider({
        name: body.name || 'Custom Upstream',
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
        models: body.models,
      });
      return { provider: item };
    } catch (e) {
      return reply.status(500).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.post('/api/gateway/custom-providers/:providerId/refresh', async (req, reply) => {
    const { providerId } = req.params as { providerId: string };
    try {
      const item = await opts.manager.refreshCustomProviderModels(providerId);
      return { provider: item };
    } catch (e) {
      return reply.status(400).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.delete('/api/gateway/custom-providers/:providerId', async (req, reply) => {
    const { providerId } = req.params as { providerId: string };
    try {
      const ok = await opts.manager.deleteCustomProvider(providerId);
      return { ok };
    } catch (e) {
      return reply.status(500).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.patch('/api/gateway/custom-providers/:providerId', async (req, reply) => {
    const { providerId } = req.params as { providerId: string };
    const body = (req.body || {}) as {
      enabled?: boolean;
      models?: string[];
      name?: string;
      baseUrl?: string;
      apiKey?: string;
    };
    try {
      const item = await opts.manager.updateCustomProvider(providerId, body);
      return { provider: item };
    } catch (e) {
      return reply.status(500).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  // Router Groups
  app.get('/api/gateway/router/groups', async () => {
    return { groups: opts.manager.listRouterGroups() };
  });

  app.post('/api/gateway/router/groups', async (req, reply) => {
    try {
      const group = await opts.manager.createRouterGroup((req.body || {}) as any);
      return { group };
    } catch (e) {
      return reply.status(400).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.patch('/api/gateway/router/groups/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const group = await opts.manager.updateRouterGroup(id, (req.body || {}) as any);
      if (!group) return reply.status(404).send({ error: { message: 'المجموعة غير موجودة' } });
      return { group };
    } catch (e) {
      return reply.status(400).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.delete('/api/gateway/router/groups/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const ok = await opts.manager.deleteRouterGroup(id);
      return { ok };
    } catch (e) {
      return reply.status(500).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.post('/api/gateway/router/groups/:id/test', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await opts.manager.testRouterGroup(id);
    } catch (e) {
      return reply.status(400).send({ error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });

  function parseCookies(header?: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!header || typeof header !== 'string') return result;
    const parts = header.split(';');
    for (const part of parts) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        result[key] = decodeURIComponent(val);
      }
    }
    return result;
  }

  function extractHumanSession(req: FastifyRequest): HumanSession | null {
    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies['emo_session_id'] || (typeof req.headers['x-session-token'] === 'string' ? req.headers['x-session-token'].trim() : undefined);
    if (!sessionToken) return null;
    return globalHumanSessionManager.getSession(sessionToken);
  }

  function authenticateHumanSession(req: FastifyRequest): { ok: boolean; session?: HumanSession; error?: string; status?: number } {
    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies['emo_session_id'] || (typeof req.headers['x-session-token'] === 'string' ? req.headers['x-session-token'].trim() : undefined);
    if (!sessionToken) {
      return {
        ok: false,
        status: 401,
        error: 'HUMAN_SESSION_REQUIRED: Approval actions require an active, authenticated local human session. Agents and API keys cannot self-approve operations.',
      };
    }

    const session = globalHumanSessionManager.getSession(sessionToken);
    if (!session) {
      return {
        ok: false,
        status: 401,
        error: 'HUMAN_SESSION_EXPIRED: The local human session is invalid or expired. Please log in again.',
      };
    }

    // Strict CSRF verification for state-changing approval operations
    const csrfHeader = (req.headers['x-csrf-token'] || req.headers['x-csrftoken']) as string | undefined;
    if (!globalHumanSessionManager.validateCsrf(session, csrfHeader)) {
      return {
        ok: false,
        status: 403,
        error: 'CSRF_VALIDATION_FAILED: Invalid or missing CSRF token on state-changing approval request.',
      };
    }

    return { ok: true, session };
  }

  // --- Human Session Authentication Endpoints ---
  app.post('/api/gateway/session/login', async (req, reply) => {
    const body = (req.body || {}) as { apiKey?: string };
    
    let isAdmin = false;
    if (body.apiKey && opts.manager && typeof (opts.manager as any).resolveKeyAuth === 'function') {
      const auth = (opts.manager as any).resolveKeyAuth(body.apiKey);
      if (auth.valid && (auth.scope === 'admin' || auth.scope === 'all')) {
        isAdmin = true;
      }
    } else if ((req as any).authKeyInfo?.valid && ((req as any).authKeyInfo?.scope === 'admin' || (req as any).authKeyInfo?.scope === 'all')) {
      isAdmin = true;
    }

    if (!isAdmin) {
      return reply.status(401).send({
        error: {
          message: 'INVALID_CREDENTIALS: An admin-scoped API key is required to bootstrap a local human session.',
          code: 'AUTH_FAILED',
        },
      });
    }

    const session = globalHumanSessionManager.createSession('human:local_operator');
    const isSecure = req.protocol === 'https';
    reply.header(
      'Set-Cookie',
      `emo_session_id=${session.id}; Path=/api/gateway/; HttpOnly; SameSite=Strict${isSecure ? '; Secure' : ''}; Max-Age=3600`
    );

    return {
      ok: true,
      sessionId: session.id,
      csrfToken: session.csrfToken,
      actor: session.actor,
      expiresAt: session.expiresAt,
    };
  });

  app.post('/api/gateway/session/logout', async (req, reply) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies['emo_session_id'] || (typeof req.headers['x-session-token'] === 'string' ? req.headers['x-session-token'].trim() : undefined);
    if (sessionToken) {
      globalHumanSessionManager.destroySession(sessionToken);
    }
    reply.header(
      'Set-Cookie',
      'emo_session_id=; Path=/api/gateway/; HttpOnly; SameSite=Strict; Max-Age=0'
    );
    return { ok: true };
  });

  app.get('/api/gateway/session/me', async (req) => {
    const session = extractHumanSession(req);
    if (!session) {
      return { authenticated: false };
    }
    return {
      authenticated: true,
      actor: session.actor,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    };
  });

  // --- Centralized Approval Manager Routes ---
  app.get('/api/gateway/approvals', async (req) => {
    const q = (req.query || {}) as { status?: string };
    return {
      requests: globalApprovalManager.listRequests(q.status as any),
    };
  });

  app.get('/api/gateway/approvals/audit', async (req) => {
    const q = (req.query || {}) as { limit?: string };
    const limit = q.limit ? Number(q.limit) : 100;
    return {
      auditLogs: globalApprovalManager.getAuditLogs(limit),
    };
  });

  app.post('/api/gateway/approvals/:id/approve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const auth = authenticateHumanSession(req);
    if (!auth.ok || !auth.session) {
      return reply.status(auth.status || 401).send({ error: { message: auth.error } });
    }

    try {
      const result = globalApprovalManager.approve(id, auth.session.actor);
      return { ok: true, approval: result };
    } catch (e) {
      return reply.status(400).send({ error: { message: (e as Error).message } });
    }
  });

  app.post('/api/gateway/approvals/:id/reject', async (req, reply) => {
    const { id } = req.params as { id: string };
    const auth = authenticateHumanSession(req);
    if (!auth.ok || !auth.session) {
      return reply.status(auth.status || 401).send({ error: { message: auth.error } });
    }

    try {
      const result = globalApprovalManager.reject(id, auth.session.actor);
      return { ok: true, approval: result };
    } catch (e) {
      return reply.status(400).send({ error: { message: (e as Error).message } });
    }
  });
}
