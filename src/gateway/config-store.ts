import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { GatewayConfigFile, ProviderConfig, WebProviderId } from './types.js';
import { WEB_PROVIDER_IDS } from './types.js';

const DEFAULT_FILE = path.join(os.homedir(), '.arena-webbridge', 'gateway.json');

function defaultProviderConfig(id: WebProviderId): ProviderConfig {
  const home = os.homedir();
  const base = {
    enabled: false,
    settings: {} as Record<string, unknown>,
    availableModels: [] as string[],
    selectedModels: [] as string[],
  };
  switch (id) {
    case 'arena-browser':
      return {
        ...base,
        settings: { baseUrl: 'https://arena.ai', headless: true, userDataDir: path.join(home, '.arena-webbridge', 'chrome-profile') },
        availableModels: ['auto'],
        selectedModels: ['auto'],
      };
    case 'zai-web':
      return {
        ...base,
        settings: { baseUrl: 'https://chat.z.ai', headless: false, userDataDir: path.join(home, '.arena-webbridge', 'zai-profile'), timeoutMs: 180000, captchaWaitMs: 180000 },
        availableModels: ['glm-4.5-flash'],
        selectedModels: ['glm-4.5-flash'],
      };
    case 'claude-web':
      return {
        ...base,
        settings: { baseUrl: 'https://claude.ai', headless: false, userDataDir: path.join(home, '.arena-webbridge', 'claude-profile'), timeoutMs: 300000 },
        availableModels: ['claude-web:default'],
        selectedModels: ['claude-web:default'],
      };
    case 'tencent-ai-web':
      return {
        ...base,
        settings: { baseUrl: 'https://aistudio.tencent.ai', headless: false, userDataDir: path.join(home, '.arena-webbridge', 'tencent-ai-profile'), timeoutMs: 300000 },
        availableModels: ['tencent-ai:default'],
        selectedModels: ['tencent-ai:default'],
      };
    case 'gemini-web':
      return {
        ...base,
        settings: { baseUrl: 'https://gemini.google.com', headless: false, userDataDir: path.join(home, '.arena-webbridge', 'gemini-profile'), timeoutMs: 300000 },
        availableModels: ['gemini-web:default'],
        selectedModels: ['gemini-web:default'],
      };
    case 'qwen-web':
      return {
        ...base,
        settings: { baseUrl: 'https://chat.qwen.ai', headless: false, userDataDir: path.join(home, '.arena-webbridge', 'qwen-profile'), timeoutMs: 300000 },
        availableModels: ['qwen-web:default'],
        selectedModels: ['qwen-web:default'],
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
      baseUriDisplay: 'mac.ai/v1',
      apiKey: 'mac',
      requireApiKey: true,
    },
    ui: { heartbeatTimeoutMs: 15000 },
    providers,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function mergeProvider(defaults: ProviderConfig, raw: unknown): ProviderConfig {
  if (!isObject(raw)) return defaults;
  const settings = isObject(raw.settings) ? { ...defaults.settings, ...raw.settings } : defaults.settings;
  const availableModels = Array.isArray(raw.availableModels) ? raw.availableModels.filter((x): x is string => typeof x === 'string') : defaults.availableModels;
  const selectedModels = Array.isArray(raw.selectedModels) ? raw.selectedModels.filter((x): x is string => typeof x === 'string') : defaults.selectedModels;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaults.enabled,
    settings,
    availableModels,
    selectedModels,
  };
}

function mergeConfig(defaults: GatewayConfigFile, raw: unknown): GatewayConfigFile {
  if (!isObject(raw)) return defaults;
  const gateway = isObject(raw.gateway) ? { ...defaults.gateway, ...raw.gateway } : defaults.gateway;
  const ui = isObject(raw.ui) ? { ...defaults.ui, ...raw.ui } : defaults.ui;
  const providers = { ...defaults.providers } as Record<WebProviderId, ProviderConfig>;
  if (isObject(raw.providers)) {
    for (const id of WEB_PROVIDER_IDS) providers[id] = mergeProvider(defaults.providers[id], raw.providers[id]);
  }
  return {
    version: 1,
    gateway: {
      port: typeof gateway.port === 'number' ? gateway.port : defaults.gateway.port,
      host: typeof gateway.host === 'string' ? gateway.host : defaults.gateway.host,
      baseUriDisplay: typeof gateway.baseUriDisplay === 'string' ? gateway.baseUriDisplay : defaults.gateway.baseUriDisplay,
      apiKey: typeof gateway.apiKey === 'string' ? gateway.apiKey : defaults.gateway.apiKey,
      requireApiKey: typeof gateway.requireApiKey === 'boolean' ? gateway.requireApiKey : defaults.gateway.requireApiKey,
    },
    ui: {
      heartbeatTimeoutMs: typeof ui.heartbeatTimeoutMs === 'number' ? ui.heartbeatTimeoutMs : defaults.ui.heartbeatTimeoutMs,
    },
    providers,
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
    await fs.mkdir(path.dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    const data = JSON.stringify({
      version: 1,
      gateway: config.gateway,
      ui: config.ui,
      providers: config.providers,
    }, null, 2);
    await fs.writeFile(tmp, data, 'utf8');
    await fs.rename(tmp, this.path);
  }
}
