import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { GatewayConfigFile, ProviderConfig, RouterGroup, RouterGroupTarget, UiSettings, WebProviderId } from './types.js';
import { WEB_PROVIDER_IDS } from './types.js';
import { providerSpec } from '../arena/providers.js';

function generateApiKey(): string {
  return randomBytes(24).toString('base64url').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || randomBytes(16).toString('hex');
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
  // baseUrl/timeout/profile derive from WEB_PROVIDERS (src/arena/providers.ts).
  // Only headless + seed models remain here (gateway-store-local concerns).
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
        availableModels: ['llm7-web:default', 'llm7-web:claude-3-7-sonnet', 'llm7-web:gpt-4o'],
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
        availableModels: ['deepseek-web:default', 'deepseek-web:deepseek-chat', 'deepseek-web:deepseek-reasoner'],
        selectedModels: ['deepseek-web:default'],
      };
    case 'mistral-web':
      return {
        ...base,
        settings: { baseUrl: spec.defaultBaseUrl, headless: true, privacyMode: false, userDataDir, timeoutMs: spec.defaultTimeoutMs },
        availableModels: ['mistral-web:default', 'mistral-web:mistral-large-latest', 'mistral-web:mistral-small-latest', 'mistral-web:codestral-latest', 'mistral-web:pixtral-large-latest'],
        selectedModels: ['mistral-web:default'],
      };
  }
}

export function defaultGatewayConfig(): GatewayConfigFile {
  const providers = {} as Record<WebProviderId, ProviderConfig>;
  for (const id of WEB_PROVIDER_IDS) providers[id] = defaultProviderConfig(id);
  return {
    version: 1,
    gateway: {
      port: 8989,
      host: '127.0.0.1',
      baseUriDisplay: 'emo-web.ai/v1',
      apiKey: 'emo.web',
      requireApiKey: true,
      serviceEnabled: true,
      apiKeys: [
        {
          id: 'key-default',
          name: 'Default Master Key',
          key: 'emo.web',
          createdAt: new Date().toISOString(),
          enabled: true,
        },
      ],
      customProviders: [],
      customAgents: [],
    },
    ui: { heartbeatTimeoutMs: 15000 },
    providers,
    routerGroups: [],
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function mergeProvider(defaults: ProviderConfig, raw: unknown): ProviderConfig {
  if (!isObject(raw)) return defaults;
  const settings = isObject(raw.settings) ? { ...defaults.settings, ...raw.settings } : defaults.settings;
  const rawAvail = Array.isArray(raw.availableModels) ? raw.availableModels.filter((x): x is string => typeof x === 'string') : null;
  // The STORED list wins verbatim: re-adding the seed catalog here would
  // resurrect model ids the provider (or the user) no longer has.
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

function mergeRouterTarget(raw: unknown): RouterGroupTarget | undefined {
  if (!isObject(raw)) return undefined;
  const kind = raw.kind === 'web' || raw.kind === 'custom' ? raw.kind : undefined;
  const providerId = typeof raw.providerId === 'string' ? raw.providerId.trim() : '';
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
  if (!kind || !providerId || !model || !id) return undefined;
  const accountId = typeof raw.accountId === 'string' && raw.accountId.trim() ? raw.accountId.trim() : undefined;
  return { id, kind, providerId, model, ...(accountId ? { accountId } : {}) };
}

function mergeRouterGroup(raw: unknown): RouterGroup | undefined {
  if (!isObject(raw)) return undefined;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!id || !name) return undefined;
  const strategy = raw.strategy === 'round-robin' ? 'round-robin' : 'sequential';
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : true;
  const targets = Array.isArray(raw.targets)
    ? raw.targets.map(mergeRouterTarget).filter((t): t is RouterGroupTarget => !!t)
    : [];
  const icon = typeof raw.icon === 'string' && raw.icon.trim() ? raw.icon.trim().slice(0, 8) : undefined;
  const apiKey = typeof raw.apiKey === 'string' && raw.apiKey.trim() ? raw.apiKey.trim() : undefined;
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt;
  return { id, name, ...(icon ? { icon } : {}), ...(apiKey ? { apiKey } : {}), enabled, strategy, targets, createdAt, updatedAt };
}

function mergeConfig(defaults: GatewayConfigFile, raw: unknown): GatewayConfigFile {
  if (!isObject(raw)) return defaults;
  const gateway = isObject(raw.gateway) ? { ...defaults.gateway, ...raw.gateway } : defaults.gateway;
  const rawUi = isObject(raw.ui) ? raw.ui : {};
  const ui: UiSettings = {
    heartbeatTimeoutMs:
      typeof rawUi.heartbeatTimeoutMs === 'number' ? rawUi.heartbeatTimeoutMs : defaults.ui.heartbeatTimeoutMs,
    discovery: {
      enabled:
        typeof (rawUi.discovery as any)?.enabled === 'boolean'
          ? (rawUi.discovery as any).enabled
          : defaults.ui.discovery?.enabled ?? true,
      intervalMs:
        typeof (rawUi.discovery as any)?.intervalMs === 'number'
          ? Math.min(7 * 24 * 60 * 60 * 1000, Math.max(60_000, (rawUi.discovery as any).intervalMs))
          : defaults.ui.discovery?.intervalMs ?? 12 * 60 * 60 * 1000,
      concurrency:
        typeof (rawUi.discovery as any)?.concurrency === 'number'
          ? Math.min(4, Math.max(1, (rawUi.discovery as any).concurrency))
          : defaults.ui.discovery?.concurrency ?? 1,
      timeoutMs:
        typeof (rawUi.discovery as any)?.timeoutMs === 'number'
          ? Math.min(600_000, Math.max(10_000, (rawUi.discovery as any).timeoutMs))
          : defaults.ui.discovery?.timeoutMs ?? 120_000,
    },
  };
  const providers = { ...defaults.providers } as Record<WebProviderId, ProviderConfig>;
  if (isObject(raw.providers)) {
    for (const id of WEB_PROVIDER_IDS) providers[id] = mergeProvider(defaults.providers[id], raw.providers[id]);
  }
  const routerGroups = Array.isArray((raw as any).routerGroups)
    ? (raw as any).routerGroups.map(mergeRouterGroup).filter((g: RouterGroup | undefined): g is RouterGroup => !!g)
    : (defaults.routerGroups || []);
  return {
    version: 1,
    gateway: {
      port: typeof gateway.port === 'number' ? gateway.port : defaults.gateway.port,
      host: typeof gateway.host === 'string' ? gateway.host : defaults.gateway.host,
      baseUriDisplay: typeof gateway.baseUriDisplay === 'string' ? gateway.baseUriDisplay : defaults.gateway.baseUriDisplay,
      apiKey: typeof gateway.apiKey === 'string' ? gateway.apiKey : defaults.gateway.apiKey,
      requireApiKey: typeof gateway.requireApiKey === 'boolean' ? gateway.requireApiKey : defaults.gateway.requireApiKey,
      serviceEnabled: typeof gateway.serviceEnabled === 'boolean' ? gateway.serviceEnabled : true,
      apiKeys: Array.isArray(gateway.apiKeys) ? gateway.apiKeys : defaults.gateway.apiKeys,
      customProviders: Array.isArray(gateway.customProviders) ? gateway.customProviders : defaults.gateway.customProviders,
      customAgents: Array.isArray(gateway.customAgents) ? gateway.customAgents : (defaults.gateway.customAgents || []),
    },
    ui: {
      heartbeatTimeoutMs: typeof ui.heartbeatTimeoutMs === 'number' ? ui.heartbeatTimeoutMs : defaults.ui.heartbeatTimeoutMs,
    },
    providers,
    routerGroups,
  };
}

export class GatewayConfigStore {
  readonly path: string;
  constructor(filePath?: string) {
    this.path = filePath ?? DEFAULT_FILE;
  }

  async load(): Promise<GatewayConfigFile> {
    const defaults = defaultGatewayConfig();
    try {
      const text = await fs.readFile(this.path, 'utf8');
      return mergeConfig(defaults, JSON.parse(text));
    } catch {
      return defaults;
    }
  }

  async save(config: GatewayConfigFile): Promise<void> {
    await fs.mkdir(path.dirname(this.path), { recursive: true, mode: 0o700 });
    try { await fs.chmod(path.dirname(this.path), 0o700); } catch {}
    const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    const data = JSON.stringify({
      version: 1,
      gateway: config.gateway,
      ui: config.ui,
      providers: config.providers,
      routerGroups: config.routerGroups || [],
    }, null, 2);
    await fs.writeFile(tmp, data, { encoding: 'utf8', mode: 0o600 });
    try { await fs.chmod(tmp, 0o600); } catch {}
    await fs.rename(tmp, this.path);
    try { await fs.chmod(this.path, 0o600); } catch {}
  }
}
