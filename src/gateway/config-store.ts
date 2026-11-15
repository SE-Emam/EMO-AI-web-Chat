import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
  ApiKeyItem,
  GatewayConfigFile,
  ProviderConfig,
  RouterGroup,
  RouterGroupTarget,
  UiSettings,
  WebProviderId,
} from './types.js';
import { WEB_PROVIDER_IDS } from './types.js';
import { providerSpec } from '../arena/providers.js';

export function generateSecureApiKey(prefix = 'emo_sec_'): string {
  return `${prefix}${randomBytes(24).toString('base64url').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)}`;
}

export function maskApiKey(key?: string): string {
  if (!key || typeof key !== 'string') return '[empty]';
  if (key.length <= 8) return '[masked]';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

const DEFAULT_FILE = path.join(os.homedir(), '.arena-webbridge', 'gateway.json');

function defaultProviderConfig(id: WebProviderId): ProviderConfig {
  const home = os.homedir();
  const spec = providerSpec(id);
  const base = {
    enabled: false,
    settings: {} as Record<string, unknown>,
    availableModels: [] as string[],
    selectedModels: [] as string[],
  };
  const userDataDir = path.join(home, '.arena-webbridge', spec.profileDir);
  switch (id) {
    case 'arena-browser':
      return {
        ...base,
        settings: { baseUrl: spec.defaultBaseUrl, headless: true, privacyMode: false, userDataDir },
        availableModels: ['auto'],
        selectedModels: ['auto'],
      };
    case 'zai-web':
      return {
        ...base,
        settings: { baseUrl: spec.defaultBaseUrl, headless: true, privacyMode: false, userDataDir, timeoutMs: spec.defaultTimeoutMs, captchaWaitMs: spec.defaultCaptchaWaitMs ?? spec.defaultTimeoutMs },
        availableModels: ['glm-4.5-flash', 'glm-5.3-flash', 'glm-5.3', 'glm-5.2', 'glm-4.7-flash'],
        selectedModels: ['glm-4.5-flash'],
      };
    case 'claude-web':
      return {
        ...base,
        settings: { baseUrl: spec.defaultBaseUrl, headless: true, privacyMode: false, userDataDir, timeoutMs: spec.defaultTimeoutMs },
        availableModels: ['claude-web:default', 'claude-web:claude-3-7-sonnet', 'claude-web:claude-3-5-sonnet', 'claude-web:claude-3-5-haiku'],
        selectedModels: ['claude-web:default'],
      };
    case 'tencent-ai-web':
      return {
        ...base,
        settings: { baseUrl: spec.defaultBaseUrl, headless: true, privacyMode: false, userDataDir, timeoutMs: spec.defaultTimeoutMs },
        availableModels: ['tencent-ai:default', 'tencent-ai:hy4'],
        selectedModels: ['tencent-ai:default'],
      };
    case 'gemini-web':
      return {
        ...base,
        settings: { baseUrl: spec.defaultBaseUrl, headless: true, privacyMode: false, userDataDir, timeoutMs: spec.defaultTimeoutMs },
        availableModels: ['gemini-web:default', 'gemini-web:gemini-auto', 'gemini-web:gemini-2.0-flash', 'gemini-web:gemini-1.5-pro'],
        selectedModels: ['gemini-web:default'],
      };
    case 'qwen-web':
      return {
        ...base,
        settings: { baseUrl: spec.defaultBaseUrl, headless: true, privacyMode: false, userDataDir, timeoutMs: spec.defaultTimeoutMs },
        availableModels: ['qwen-web:default', 'qwen-web:qwen-3.7-plus', 'qwen-web:qwen-2.5-max', 'qwen-web:qwen-2.5-plus'],
        selectedModels: ['qwen-web:default'],
      };
    case 'chatgpt-web':
      return {
        ...base,
        settings: { baseUrl: spec.defaultBaseUrl, headless: true, privacyMode: false, userDataDir, timeoutMs: spec.defaultTimeoutMs },
        availableModels: ['chatgpt-web:default', 'chatgpt-web:gpt-4o', 'chatgpt-web:gpt-4o-mini', 'chatgpt-web:o1', 'chatgpt-web:o3-mini'],
        selectedModels: ['chatgpt-web:default'],
      };
    case 'grok-web':
      return {
        ...base,
        settings: { baseUrl: spec.defaultBaseUrl, headless: true, privacyMode: false, userDataDir, timeoutMs: spec.defaultTimeoutMs },
        availableModels: ['grok-web:default', 'grok-web:grok-2', 'grok-web:grok-3', 'grok-web:grok-beta'],
        selectedModels: ['grok-web:default'],
      };
    case 'kimi-web':
      return {
        ...base,
        settings: { baseUrl: spec.defaultBaseUrl, headless: true, privacyMode: false, userDataDir, timeoutMs: spec.defaultTimeoutMs },
        availableModels: ['kimi-web:default', 'kimi-web:k1.5', 'kimi-web:kimi-latest'],
        selectedModels: ['kimi-web:default'],
      };
    case 'minimax-web':
      return {
        ...base,
        settings: { baseUrl: spec.defaultBaseUrl, headless: true, privacyMode: false, userDataDir, timeoutMs: spec.defaultTimeoutMs },
        availableModels: ['minimax-web:default', 'minimax-web:minimax-01', 'minimax-web:abab6.5s'],
        selectedModels: ['minimax-web:default'],
      };
    case 'longcat-web':
      return {
        ...base,
        settings: { baseUrl: spec.defaultBaseUrl, headless: true, privacyMode: false, userDataDir, timeoutMs: spec.defaultTimeoutMs },
        availableModels: ['longcat-web:default', 'longcat-web:auto'],
        selectedModels: ['longcat-web:default'],
      };
    case 'llm7-web':
      return {
        ...base,
        settings: { baseUrl: spec.defaultBaseUrl, headless: true, privacyMode: false, userDataDir, timeoutMs: spec.defaultTimeoutMs },
        availableModels: ['llm7-web:default', 'llm7-web:auto'],
        selectedModels: ['llm7-web:default'],
      };
    case 'kiwi-web':
      return {
        ...base,
        settings: { baseUrl: spec.defaultBaseUrl, headless: true, privacyMode: false, userDataDir, timeoutMs: spec.defaultTimeoutMs },
        availableModels: ['kiwi-web:default', 'kiwi-web:auto'],
        selectedModels: ['kiwi-web:default'],
      };
    case 'deepseek-web':
      return {
        ...base,
        settings: { baseUrl: spec.defaultBaseUrl, headless: true, privacyMode: false, userDataDir, timeoutMs: spec.defaultTimeoutMs },
        availableModels: ['deepseek-web:default', 'deepseek-web:deepseek-r1', 'deepseek-web:deepseek-chat', 'deepseek-web:deepseek-v3'],
        selectedModels: ['deepseek-web:default'],
      };
    case 'mistral-web':
      return {
        ...base,
        settings: { baseUrl: spec.defaultBaseUrl, headless: true, privacyMode: false, userDataDir, timeoutMs: spec.defaultTimeoutMs },
        availableModels: ['mistral-web:default', 'mistral-web:mistral-large-latest', 'mistral-web:pixtral-large-latest'],
        selectedModels: ['mistral-web:default'],
      };
  }
}

export function defaultGatewayConfig(): GatewayConfigFile {
  const masterKey = generateSecureApiKey('emo_adm_');
  const mcpKey = generateSecureApiKey('emo_mcp_');
  const now = new Date().toISOString();
  const providers = {} as Record<WebProviderId, ProviderConfig>;
  for (const id of WEB_PROVIDER_IDS) providers[id] = defaultProviderConfig(id);
  return {
    version: 1,
    gateway: {
      port: 8989,
      host: '127.0.0.1',
      baseUriDisplay: 'emo-web.ai/v1',
      apiKey: masterKey,
      adminApiKey: masterKey,
      mcpApiKey: mcpKey,
      requireApiKey: true,
      serviceEnabled: true,
      apiKeys: [
        {
          id: 'key-admin',
          name: 'Master Admin Key',
          key: masterKey,
          scope: 'admin',
          createdAt: now,
          enabled: true,
        },
        {
          id: 'key-mcp-default',
          name: 'Default MCP Client Key',
          key: mcpKey,
          scope: 'mcp',
          createdAt: now,
          enabled: true,
        },
      ],
      customProviders: [],
      customAgents: [],
    },
    ui: {
      heartbeatTimeoutMs: 15000,
      mcp: { workspaceRoots: defaultMcpWorkspaceRoots() },
      agentBridge: { environmentBlock: false, repairRefusals: true, maxAttempts: 3, enforceExpectedCall: true },
      discovery: {
        enabled: true,
        intervalMs: 12 * 60 * 60 * 1000,
        concurrency: 1,
        timeoutMs: 120_000,
        runOnStartup: true,
        checkConnectionsOnStartup: true,
        startupDelayMs: 4000,
      },
    },
    providers,
    routerGroups: [],
  };
}

/**
 * Default workspace root for agent file tools.
 * Default Deny: returns Desktop if it exists, otherwise empty array []
 * (NEVER defaults to entire home directory!).
 */
export function defaultMcpWorkspaceRoots(): string[] {
  const home = os.homedir();
  const desktop = path.join(home, 'Desktop');
  try {
    if (fsSync.existsSync(desktop) && fsSync.statSync(desktop).isDirectory()) {
      return [desktop];
    }
  } catch {}
  return []; // Default Deny
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function mergeProvider(defaults: ProviderConfig, raw: unknown): ProviderConfig {
  if (!isObject(raw)) return defaults;
  const settings = isObject(raw.settings) ? { ...defaults.settings, ...raw.settings } : defaults.settings;
  const rawAvail = Array.isArray(raw.availableModels) ? raw.availableModels.filter((x): x is string => typeof x === 'string') : null;
  const availableModels = rawAvail !== null ? [...new Set(rawAvail)] : defaults.availableModels;
  const rawSelected = Array.isArray(raw.selectedModels) ? raw.selectedModels.filter((x): x is string => typeof x === 'string') : null;
  const selectedModels = rawSelected !== null
    ? (rawSelected.length === 0 && availableModels.length === 0 ? defaults.selectedModels : rawSelected)
    : defaults.selectedModels;
  const auth = isObject(raw.auth) ? (raw.auth as any) : defaults.auth;
  const accounts = Array.isArray(raw.accounts) ? (raw.accounts as any[]) : defaults.accounts;
  const activeAccountId = typeof raw.activeAccountId === 'string' ? raw.activeAccountId : defaults.activeAccountId;
  const meta = isObject(raw.meta) ? { ...(defaults.meta || {}), ...(raw.meta as any) } : defaults.meta;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaults.enabled,
    settings,
    availableModels,
    selectedModels,
    auth,
    accounts,
    activeAccountId,
    meta,
  };
}

function mergeRouterGroupTarget(raw: unknown): RouterGroupTarget | undefined {
  if (!isObject(raw)) return undefined;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
  const providerId = typeof raw.providerId === 'string' && raw.providerId.trim() ? raw.providerId.trim() : '';
  const model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : '';
  const kind = raw.kind === 'custom' ? 'custom' : 'web';
  if (!id || !providerId || !model) return undefined;
  const accountId = typeof raw.accountId === 'string' && raw.accountId.trim() ? raw.accountId.trim() : undefined;
  return { id, kind, providerId, model, accountId };
}

function mergeRouterGroup(raw: unknown): RouterGroup | undefined {
  if (!isObject(raw)) return undefined;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '';
  if (!id || !name) return undefined;
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : true;
  const strategy = raw.strategy === 'round-robin' ? 'round-robin' : 'sequential';
  const targets = Array.isArray(raw.targets)
    ? raw.targets.map(mergeRouterGroupTarget).filter((t): t is RouterGroupTarget => !!t)
    : [];
  const icon = typeof raw.icon === 'string' ? raw.icon : undefined;
  const apiKey = typeof raw.apiKey === 'string' && raw.apiKey.trim() ? raw.apiKey.trim() : undefined;
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString();
  return { id, name, icon, enabled, strategy, targets, apiKey, createdAt, updatedAt };
}

function mergeConfig(defaults: GatewayConfigFile, raw: unknown): GatewayConfigFile {
  if (!isObject(raw)) return defaults;
  const gateway = isObject(raw.gateway) ? raw.gateway : {};
  const rawUi = isObject(raw.ui) ? raw.ui : {};
  const ui: UiSettings = {
    heartbeatTimeoutMs:
      typeof rawUi.heartbeatTimeoutMs === 'number'
        ? Math.max(3000, rawUi.heartbeatTimeoutMs)
        : defaults.ui.heartbeatTimeoutMs,
    discovery: {
      enabled:
        typeof (rawUi.discovery as any)?.enabled === 'boolean'
          ? (rawUi.discovery as any).enabled
          : defaults.ui.discovery?.enabled ?? true,
      intervalMs:
        typeof (rawUi.discovery as any)?.intervalMs === 'number'
          ? Math.max(60_000, (rawUi.discovery as any).intervalMs)
          : defaults.ui.discovery?.intervalMs ?? 12 * 60 * 60 * 1000,
      concurrency:
        typeof (rawUi.discovery as any)?.concurrency === 'number'
          ? Math.min(4, Math.max(1, (rawUi.discovery as any).concurrency))
          : defaults.ui.discovery?.concurrency ?? 1,
      timeoutMs:
        typeof (rawUi.discovery as any)?.timeoutMs === 'number'
          ? Math.min(600_000, Math.max(10_000, (rawUi.discovery as any).timeoutMs))
          : defaults.ui.discovery?.timeoutMs ?? 120_000,
      runOnStartup:
        typeof (rawUi.discovery as any)?.runOnStartup === 'boolean'
          ? (rawUi.discovery as any).runOnStartup
          : defaults.ui.discovery?.runOnStartup ?? true,
      checkConnectionsOnStartup:
        typeof (rawUi.discovery as any)?.checkConnectionsOnStartup === 'boolean'
          ? (rawUi.discovery as any).checkConnectionsOnStartup
          : defaults.ui.discovery?.checkConnectionsOnStartup ?? true,
      startupDelayMs:
        typeof (rawUi.discovery as any)?.startupDelayMs === 'number'
          ? Math.min(60_000, Math.max(0, (rawUi.discovery as any).startupDelayMs))
          : defaults.ui.discovery?.startupDelayMs ?? 4000,
    },
  };
  const providers = { ...defaults.providers } as Record<WebProviderId, ProviderConfig>;
  if (isObject(raw.providers)) {
    for (const id of WEB_PROVIDER_IDS) providers[id] = mergeProvider(defaults.providers[id], raw.providers[id]);
  }
  const routerGroups = Array.isArray((raw as any).routerGroups)
    ? (raw as any).routerGroups.map(mergeRouterGroup).filter((g: RouterGroup | undefined): g is RouterGroup => !!g)
    : (defaults.routerGroups || []);

  const loadedApiKey = typeof gateway.apiKey === 'string' && gateway.apiKey.trim() ? gateway.apiKey.trim() : defaults.gateway.apiKey;
  const loadedAdminKey = typeof gateway.adminApiKey === 'string' && gateway.adminApiKey.trim() ? gateway.adminApiKey.trim() : loadedApiKey;
  const loadedMcpKey = typeof gateway.mcpApiKey === 'string' && gateway.mcpApiKey.trim() ? gateway.mcpApiKey.trim() : defaults.gateway.mcpApiKey;

  return {
    version: 1,
    gateway: {
      port: typeof gateway.port === 'number' ? gateway.port : defaults.gateway.port,
      host: typeof gateway.host === 'string' ? gateway.host : defaults.gateway.host,
      baseUriDisplay: typeof gateway.baseUriDisplay === 'string' ? gateway.baseUriDisplay : defaults.gateway.baseUriDisplay,
      apiKey: loadedApiKey,
      adminApiKey: loadedAdminKey,
      mcpApiKey: loadedMcpKey,
      requireApiKey: typeof gateway.requireApiKey === 'boolean' ? gateway.requireApiKey : defaults.gateway.requireApiKey,
      serviceEnabled: typeof gateway.serviceEnabled === 'boolean' ? gateway.serviceEnabled : true,
      apiKeys: Array.isArray(gateway.apiKeys) && gateway.apiKeys.length > 0 ? (gateway.apiKeys as ApiKeyItem[]) : defaults.gateway.apiKeys,
      customProviders: Array.isArray(gateway.customProviders) ? gateway.customProviders : defaults.gateway.customProviders,
      customAgents: Array.isArray(gateway.customAgents) ? gateway.customAgents : (defaults.gateway.customAgents || []),
    },
    ui: {
      ...ui,
      agentBridge: {
        environmentBlock: (rawUi.agentBridge as any)?.environmentBlock === true,
        repairRefusals: (rawUi.agentBridge as any)?.repairRefusals !== false,
        maxAttempts: Math.max(1, Math.min(4, Number((rawUi.agentBridge as any)?.maxAttempts) || 3)),
        enforceExpectedCall: (rawUi.agentBridge as any)?.enforceExpectedCall !== false,
      },
      mcp: {
        workspaceRoots: (() => {
          if (Array.isArray((rawUi.mcp as any)?.workspaceRoots)) {
            return ((rawUi.mcp as any).workspaceRoots as unknown[])
              .filter((r: unknown): r is string => typeof r === 'string' && r.trim().length > 0)
              .slice(0, 20)
              .map((r) => r.trim());
          }
          return defaults.ui.mcp?.workspaceRoots ?? defaultMcpWorkspaceRoots();
        })(),
        openaiTunnelUrl: typeof (rawUi.mcp as any)?.openaiTunnelUrl === 'string'
          ? (rawUi.mcp as any).openaiTunnelUrl.trim()
          : undefined,
        tunnelToken: typeof (rawUi.mcp as any)?.tunnelToken === 'string'
          ? (rawUi.mcp as any).tunnelToken.trim()
          : undefined,
      },
    },
    providers,
    routerGroups,
  };
}


export function isLegacyInsecureKey(key?: string): boolean {
  if (!key || typeof key !== 'string') return false;
  const clean = key.trim();
  return clean === 'emo.web' || clean === 'sk-local' || clean === 'default' || clean === 'emo.ai';
}

export function migrateConfigKeys(config: GatewayConfigFile): { migrated: boolean; config: GatewayConfigFile } {
  let migrated = false;
  const cfg = JSON.parse(JSON.stringify(config)) as GatewayConfigFile;
  const now = new Date().toISOString();

  let adminKey = cfg.gateway.adminApiKey || cfg.gateway.apiKey;
  if (!adminKey || isLegacyInsecureKey(adminKey)) {
    adminKey = generateSecureApiKey("emo_adm_");
    migrated = true;
  }

  let mcpKey = cfg.gateway.mcpApiKey;
  if (!mcpKey || isLegacyInsecureKey(mcpKey)) {
    mcpKey = generateSecureApiKey("emo_mcp_");
    migrated = true;
  }

  cfg.gateway.apiKey = adminKey;
  cfg.gateway.adminApiKey = adminKey;
  cfg.gateway.mcpApiKey = mcpKey;

  const rawApiKeys = Array.isArray(cfg.gateway.apiKeys) ? cfg.gateway.apiKeys : [];
  const filteredApiKeys: ApiKeyItem[] = [];
  const seenKeys = new Set<string>();

  for (const item of rawApiKeys) {
    if (!item || !item.key || isLegacyInsecureKey(item.key)) {
      migrated = true;
      continue;
    }
    const cleanKey = String(item.key).trim();
    // Key Deduplication
    if (seenKeys.has(cleanKey)) {
      migrated = true;
      continue;
    }
    seenKeys.add(cleanKey);

    // Strict Scope check: Never escalate missing or unknown scope to admin
    if (!item.scope || !["admin", "mcp", "group", "all"].includes(item.scope)) {
      item.enabled = false;
      item.scope = "group";
      migrated = true;
    }
    filteredApiKeys.push(item);
  }

  if (!filteredApiKeys.some((k) => k.key === adminKey)) {
    filteredApiKeys.unshift({
      id: "key-admin",
      name: "Master Admin Key",
      key: adminKey,
      scope: "admin",
      createdAt: now,
      enabled: true,
    });
    migrated = true;
  }

  if (!filteredApiKeys.some((k) => k.key === mcpKey)) {
    filteredApiKeys.push({
      id: "key-mcp-default",
      name: "Default MCP Client Key",
      key: mcpKey,
      scope: "mcp",
      createdAt: now,
      enabled: true,
    });
    migrated = true;
  }

  cfg.gateway.apiKeys = filteredApiKeys;
  (cfg.gateway as any).migrationVersion = 2;
  return { migrated, config: cfg };
}

export class GatewayConfigStore {
  readonly path: string;
  constructor(filePath?: string) {
    this.path = filePath ?? DEFAULT_FILE;
  }

  async load(): Promise<GatewayConfigFile> {
    try {
      const text = await fs.readFile(this.path, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (parseErr) {
        const corruptedBackup = `${this.path}.corrupted.${Date.now()}`;
        try {
          await fs.writeFile(corruptedBackup, text, { encoding: 'utf8', mode: 0o600 });
        } catch {}
        throw new Error(
          `CORRUPTED_CONFIG: Configuration file at ${this.path} contains invalid JSON. ` +
          `A recovery backup was created at ${corruptedBackup}. System halted safely to prevent secret loss.`
        );
      }
      const defaults = defaultGatewayConfig();
      const merged = mergeConfig(defaults, parsed);
      const { migrated, config: migratedConfig } = migrateConfigKeys(merged);
      if (migrated) {
        const migrationBackup = `${this.path}.migration-backup.${Date.now()}`;
        try {
          await fs.writeFile(migrationBackup, text, { encoding: 'utf8', mode: 0o600 });
        } catch {}
        await this.save(migratedConfig);
        return migratedConfig;
      }
      return merged;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        const defaults = defaultGatewayConfig();
        await this.save(defaults);
        return defaults;
      }
      if (err.code === 'EACCES') {
        throw new Error(
          `PERMISSION_DENIED: Cannot read configuration file at ${this.path}. ` +
          `Check filesystem permissions (must be readable by current user).`
        );
      }
      throw err;
    }
  }

  async save(config: GatewayConfigFile): Promise<void> {
    const dir = path.dirname(this.path);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    try { await fs.chmod(dir, 0o700); } catch {}
    const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    const data = JSON.stringify(
      {
        version: 1,
        gateway: config.gateway,
        ui: config.ui,
        providers: config.providers,
        routerGroups: config.routerGroups || [],
      },
      null,
      2
    );
    await fs.writeFile(tmp, data, { encoding: 'utf8', mode: 0o600 });
    try { await fs.chmod(tmp, 0o600); } catch {}
    await fs.rename(tmp, this.path);
    try { await fs.chmod(this.path, 0o600); } catch {}
  }
}
