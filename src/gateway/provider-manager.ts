import { chromium, type BrowserContext } from 'playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import os from 'node:os';
import type { ArenaDriver, ChatMessage } from '../types.js';
import type { ApiKeyItem, CustomAgent, CustomUpstreamProvider, GatewayConfigFile, ProviderAccount, ProviderAuthInfo, ProviderConfig, ProviderDiscoveryState, ProviderDiscoveryStatus, ProviderMetaState, ProviderRuntimeState, ProviderStatus, RouterGroup, RouterGroupTarget, WebProviderId } from './types.js';
import { WEB_PROVIDER_IDS } from './types.js';
import { matchesProvider, providerSpec } from '../arena/providers.js';
import type { GatewayConfigStore } from './config-store.js';
import { BrowserManager, cleanupStaleProfileLocks } from '../browser/manager.js';
import { DefaultArenaDriver } from '../arena/driver.js';
import { ZaiWebDriver } from '../arena/zai-web-driver.js';
import { ClaudeWebDriver } from '../arena/claude-web-driver.js';
import { TencentAiWebDriver } from '../arena/tencent-ai-web-driver.js';
import { GeminiWebDriver } from '../arena/gemini-web-driver.js';
import { QwenWebDriver } from '../arena/qwen-web-driver.js';
import {
  ChatGPTWebDriver,
  GrokWebDriver,
  KimiWebDriver,
  MiniMaxWebDriver,
  LongCatWebDriver,
  Llm7WebDriver,
  KiwiWebDriver,
  DeepSeekWebDriver,
  MistralWebDriver,
} from '../arena/web-drivers.js';
import { detectDiskProfileAuth, detectPageAuth, readGoogleProfilePreferences } from './auth-detector.js';
import { isBlockedSsrfHost, maskLiteralSecrets, sanitizeUserDataDir } from './security.js';
import { getProviderCapabilities } from './provider-capabilities.js';
import { buildProviderCardView } from './provider-card-view.js';
import {
  checkProviderConnection,
  type ConnectionProbeOptions,
  type ProviderConnectionReport,
} from './provider-connection.js';
import {
  discoverProviderModels,
  type ModelDiscoveryOutcome,
} from './provider-model-discovery.js';
import type { ModelDiscoveryService, ProviderDiscoveryReport } from './discovery/service.js';
import type { DiscoveryScheduler } from './discovery/scheduler.js';
import { getDiscoveryAdapter } from './discovery/adapters.js';

type Factory = (cfg: ProviderConfig) => ArenaDriver | Promise<ArenaDriver>;

// Web-provider metadata derives names, prefixes, baseUrls and timeouts from
// WEB_PROVIDERS (src/arena/providers.ts) — no URL literals here.
const PROVIDER_META: Record<WebProviderId, { name: string; matches: (model: string) => boolean; defaultFactory: Factory }> = {
  'arena-browser': {
    name: providerSpec('arena-browser').name,
    matches: (m) => matchesProvider('arena-browser', m),
    defaultFactory: (cfg) => {
      const browserManager = new BrowserManager({
        userDataDir: String(cfg.settings.userDataDir || ''),
        arenaBaseUrl: String(cfg.settings.baseUrl || providerSpec('arena-browser').defaultBaseUrl),
        headless: cfg.settings.headless !== false,
      });
      return new DefaultArenaDriver(browserManager);
    },
  },
  'zai-web': {
    name: providerSpec('zai-web').name,
    matches: (m) => matchesProvider('zai-web', m),
    defaultFactory: (cfg) => new ZaiWebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || providerSpec('zai-web').defaultBaseUrl),
      headless: cfg.settings.headless !== false,
      privacyMode: cfg.settings.privacyMode === true,
      timeoutMs: Number(cfg.settings.timeoutMs || providerSpec('zai-web').defaultTimeoutMs),
      captchaWaitMs: Number(cfg.settings.captchaWaitMs || providerSpec('zai-web').defaultCaptchaWaitMs || providerSpec('zai-web').defaultTimeoutMs),
    }),
  },
  'claude-web': {
    name: providerSpec('claude-web').name,
    matches: (m) => matchesProvider('claude-web', m),
    defaultFactory: (cfg) => new ClaudeWebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || providerSpec('claude-web').defaultBaseUrl),
      headless: cfg.settings.headless !== false,
      privacyMode: cfg.settings.privacyMode === true,
      timeoutMs: Number(cfg.settings.timeoutMs || providerSpec('claude-web').defaultTimeoutMs),
    }),
  },
  'tencent-ai-web': {
    name: providerSpec('tencent-ai-web').name,
    matches: (m) => matchesProvider('tencent-ai-web', m),
    defaultFactory: (cfg) => new TencentAiWebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || providerSpec('tencent-ai-web').defaultBaseUrl),
      headless: cfg.settings.headless !== false,
      privacyMode: cfg.settings.privacyMode === true,
      timeoutMs: Number(cfg.settings.timeoutMs || providerSpec('tencent-ai-web').defaultTimeoutMs),
    }),
  },
  'gemini-web': {
    name: providerSpec('gemini-web').name,
    matches: (m) => matchesProvider('gemini-web', m),
    defaultFactory: (cfg) => new GeminiWebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || providerSpec('gemini-web').defaultBaseUrl),
      headless: cfg.settings.headless !== false,
      privacyMode: cfg.settings.privacyMode === true,
      timeoutMs: Number(cfg.settings.timeoutMs || providerSpec('gemini-web').defaultTimeoutMs),
    }),
  },
  'qwen-web': {
    name: providerSpec('qwen-web').name,
    matches: (m) => matchesProvider('qwen-web', m),
    defaultFactory: (cfg) => new QwenWebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || providerSpec('qwen-web').defaultBaseUrl),
      headless: cfg.settings.headless !== false,
      privacyMode: cfg.settings.privacyMode === true,
      timeoutMs: Number(cfg.settings.timeoutMs || providerSpec('qwen-web').defaultTimeoutMs),
    }),
  },
  'chatgpt-web': {
    name: providerSpec('chatgpt-web').name,
    matches: (m) => matchesProvider('chatgpt-web', m),
    defaultFactory: (cfg) => new ChatGPTWebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || providerSpec('chatgpt-web').defaultBaseUrl),
      headless: cfg.settings.headless !== false,
      privacyMode: cfg.settings.privacyMode === true,
      timeoutMs: Number(cfg.settings.timeoutMs || providerSpec('chatgpt-web').defaultTimeoutMs),
    }),
  },
  'grok-web': {
    name: providerSpec('grok-web').name,
    matches: (m) => matchesProvider('grok-web', m),
    defaultFactory: (cfg) => new GrokWebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || providerSpec('grok-web').defaultBaseUrl),
      headless: cfg.settings.headless !== false,
      privacyMode: cfg.settings.privacyMode === true,
      timeoutMs: Number(cfg.settings.timeoutMs || providerSpec('grok-web').defaultTimeoutMs),
    }),
  },
  'kimi-web': {
    name: providerSpec('kimi-web').name,
    matches: (m) => matchesProvider('kimi-web', m),
    defaultFactory: (cfg) => new KimiWebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || providerSpec('kimi-web').defaultBaseUrl),
      headless: cfg.settings.headless !== false,
      privacyMode: cfg.settings.privacyMode === true,
      timeoutMs: Number(cfg.settings.timeoutMs || providerSpec('kimi-web').defaultTimeoutMs),
    }),
  },
  'minimax-web': {
    name: providerSpec('minimax-web').name,
    matches: (m) => matchesProvider('minimax-web', m),
    defaultFactory: (cfg) => new MiniMaxWebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || providerSpec('minimax-web').defaultBaseUrl),
      headless: cfg.settings.headless !== false,
      privacyMode: cfg.settings.privacyMode === true,
      timeoutMs: Number(cfg.settings.timeoutMs || providerSpec('minimax-web').defaultTimeoutMs),
    }),
  },
  'longcat-web': {
    name: providerSpec('longcat-web').name,
    matches: (m) => matchesProvider('longcat-web', m),
    defaultFactory: (cfg) => new LongCatWebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || providerSpec('longcat-web').defaultBaseUrl),
      headless: cfg.settings.headless !== false,
      privacyMode: cfg.settings.privacyMode === true,
      timeoutMs: Number(cfg.settings.timeoutMs || providerSpec('longcat-web').defaultTimeoutMs),
    }),
  },
  'llm7-web': {
    name: providerSpec('llm7-web').name,
    matches: (m) => matchesProvider('llm7-web', m),
    defaultFactory: (cfg) => new Llm7WebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || providerSpec('llm7-web').defaultBaseUrl),
      headless: cfg.settings.headless !== false,
      privacyMode: cfg.settings.privacyMode === true,
      timeoutMs: Number(cfg.settings.timeoutMs || providerSpec('llm7-web').defaultTimeoutMs),
    }),
  },
  'kiwi-web': {
    name: providerSpec('kiwi-web').name,
    matches: (m) => matchesProvider('kiwi-web', m),
    defaultFactory: (cfg) => new KiwiWebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || providerSpec('kiwi-web').defaultBaseUrl),
      headless: cfg.settings.headless !== false,
      privacyMode: cfg.settings.privacyMode === true,
      timeoutMs: Number(cfg.settings.timeoutMs || providerSpec('kiwi-web').defaultTimeoutMs),
    }),
  },
  'deepseek-web': {
    name: providerSpec('deepseek-web').name,
    matches: (m) => matchesProvider('deepseek-web', m),
    defaultFactory: (cfg) => new DeepSeekWebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || providerSpec('deepseek-web').defaultBaseUrl),
      headless: cfg.settings.headless !== false,
      privacyMode: cfg.settings.privacyMode === true,
      timeoutMs: Number(cfg.settings.timeoutMs || providerSpec('deepseek-web').defaultTimeoutMs),
    }),
  },
  'mistral-web': {
    name: providerSpec('mistral-web').name,
    matches: (m) => matchesProvider('mistral-web', m),
    defaultFactory: (cfg) => new MistralWebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || providerSpec('mistral-web').defaultBaseUrl),
      headless: cfg.settings.headless !== false,
      privacyMode: cfg.settings.privacyMode === true,
      timeoutMs: Number(cfg.settings.timeoutMs || providerSpec('mistral-web').defaultTimeoutMs),
    }),
  },
};

interface Runtime {
  status: ProviderStatus;
  startedAt?: number;
  lastStartedAt?: string;
  lastStoppedAt?: string;
  runtimeMsAcc: number;
  lastError?: string;
  driver?: ArenaDriver;
  op?: Promise<void>;
  latencyMs?: number;
  requestCount?: number;
  /** Outcome of the last real connection check (in-memory, freshest). */
  connection?: ProviderConnectionReport;
}

function uniq(arr: string[]): string[] {
  const out: string[] = [];
  for (const x of arr) if (x && !out.includes(x)) out.push(x);
  return out;
}

export class ProviderManager {
  private readonly store: GatewayConfigStore;
  private config: GatewayConfigFile;
  private readonly now: () => number;
  private readonly factories: Partial<Record<WebProviderId, Factory>>;
  private readonly runtimes = new Map<WebProviderId, Runtime>();
  private readonly rrCounters = new Map<string, number>();
  /** Injectable connection probe (tests must never hit the real network). */
  private readonly connectionProbe: (opts: ConnectionProbeOptions) => Promise<ProviderConnectionReport>;
  /** Live model discovery (optional — attached by the gateway bootstrap). */
  private discoveryService: ModelDiscoveryService | null = null;
  private discoveryScheduler: DiscoveryScheduler | null = null;
  /** The last discovery report per provider (in-memory, freshest). */
  private readonly discoveryReports = new Map<WebProviderId, ProviderDiscoveryReport>();

  constructor(opts: { store: GatewayConfigStore; config: GatewayConfigFile; now?: () => number; factories?: Partial<Record<WebProviderId, Factory>>; connectionProbe?: (opts: ConnectionProbeOptions) => Promise<ProviderConnectionReport> }) {
    this.store = opts.store;
    this.config = opts.config;
    this.now = opts.now ?? (() => Date.now());
    this.factories = opts.factories ?? {};
    this.connectionProbe = opts.connectionProbe ?? checkProviderConnection;
    for (const id of WEB_PROVIDER_IDS) this.runtimes.set(id, { status: 'stopped', runtimeMsAcc: 0 });
  }

  async init(): Promise<void> {
    // ensure all providers exist in config
    for (const id of WEB_PROVIDER_IDS) {
      if (!this.config.providers[id]) {
        this.config.providers[id] = { enabled: false, settings: {}, availableModels: [], selectedModels: [] };
      }
      const cfg = this.config.providers[id];
      const userDataDir = String(cfg.settings.userDataDir || '');
      if (userDataDir && (!cfg.auth || !cfg.auth.isLoggedIn)) {
        const diskAuth = detectDiskProfileAuth(userDataDir);
        if (diskAuth?.isLoggedIn) {
          cfg.auth = {
            isLoggedIn: true,
            accountName: diskAuth.name || cfg.auth?.accountName,
            accountEmail: diskAuth.email || cfg.auth?.accountEmail,
            avatarUrl: diskAuth.avatar || cfg.auth?.avatarUrl,
            lastCheckedAt: new Date().toISOString(),
            authMethod: diskAuth.authMethod || cfg.auth?.authMethod || 'session',
          };
        }
      }

      // Initialize & sync multi-accounts structure
      if (!Array.isArray(cfg.accounts) || cfg.accounts.length === 0) {
        if (cfg.auth?.accountEmail || cfg.auth?.isLoggedIn) {
          cfg.accounts = [{
            id: 'acc_default',
            name: cfg.auth.accountName || cfg.auth.accountEmail || 'الحساب الافتراضي',
            email: cfg.auth.accountEmail || 'جلسة متصفح نشطة',
            avatarUrl: cfg.auth.avatarUrl,
            isLoggedIn: Boolean(cfg.auth.isLoggedIn),
            active: true,
            userDataDir: userDataDir,
            lastLoginAt: cfg.auth.lastLoginAt,
          }];
          cfg.activeAccountId = 'acc_default';
        } else {
          cfg.accounts = [];
        }
      } else {
        for (const acc of cfg.accounts) {
          const accDir = acc.userDataDir || (acc.active ? userDataDir : '');
          if (accDir && !acc.isLoggedIn) {
            const dAuth = detectDiskProfileAuth(accDir);
            if (dAuth?.isLoggedIn) {
              acc.isLoggedIn = true;
              if (dAuth.email && (!acc.email || acc.email === 'جلسة متصفح نشطة')) acc.email = dAuth.email;
              if (dAuth.name && (!acc.name || acc.name === 'الحساب الافتراضي')) acc.name = dAuth.name;
            }
          }
        }
        let activeAcc = cfg.accounts.find((a) => a.active) || cfg.accounts.find((a) => a.id === cfg.activeAccountId);
        if (!activeAcc && cfg.accounts.length > 0) {
          activeAcc = cfg.accounts[0];
          activeAcc.active = true;
        }
        if (activeAcc) {
          for (const a of cfg.accounts) a.active = (a.id === activeAcc.id);
          cfg.activeAccountId = activeAcc.id;
        }
      }
    }

    // Repair any malformed custom provider URLs (e.g., "http:/localhost:11434/v1") and auto-sync real models if empty/default
    if (Array.isArray(this.config.gateway.customProviders)) {
      let dirty = false;
      for (const cp of this.config.gateway.customProviders) {
        if (cp.baseUrl) {
          try {
            const fixedUrl = this.normalizeCustomProviderBaseUrl(cp.baseUrl);
            if (fixedUrl !== cp.baseUrl) {
              cp.baseUrl = fixedUrl;
              dirty = true;
            }
          } catch {}
        }
        const realModels = (cp.models || []).filter((m) => m && m !== 'default');
        if (realModels.length === 0 && cp.baseUrl) {
          try {
            const fetched = await this.fetchCustomProviderModels(cp.baseUrl, cp.apiKey);
            if (fetched.length > 0) {
              cp.models = fetched;
              dirty = true;
            }
          } catch {}
        }
      }
      if (dirty) {
        await this.saveConfig().catch(() => {});
      }
    }

    await this.ensureRouterGroupKeys();
  }

  private runtime(id: WebProviderId): Runtime {
    let r = this.runtimes.get(id);
    if (!r) { r = { status: 'stopped', runtimeMsAcc: 0 }; this.runtimes.set(id, r); }
    return r;
  }

  private providerConfig(id: WebProviderId): ProviderConfig {
    return this.config.providers[id];
  }

  getConfig(): GatewayConfigFile {
    return this.config;
  }

  isServiceRunning(): boolean {
    return this.config.gateway.serviceEnabled !== false;
  }

  async setServiceRunning(running: boolean): Promise<boolean> {
    this.config.gateway.serviceEnabled = running;
    await this.saveConfig();
    return running;
  }

  async saveConfig(): Promise<void> {
    await this.store.save(this.config);
  }

  listStates(): ProviderRuntimeState[] {
    return WEB_PROVIDER_IDS.map((id) => this.getState(id));
  }

  /** True when the provider's driver currently holds its browser profile. */
  isDriverRunning(id: WebProviderId): boolean {
    return this.runtime(id).status === 'running';
  }

  /** The persistent Chrome profile directory configured for a provider. */
  profileDirFor(id: WebProviderId): string {
    return String(this.providerConfig(id).settings.userDataDir || '');
  }

  /**
   * Attaches the live model discovery service + scheduler.
   * The provider manager stays the single entry point for the UI.
   */
  attachDiscovery(service: ModelDiscoveryService, scheduler?: DiscoveryScheduler): void {
    this.discoveryService = service;
    this.discoveryScheduler = scheduler ?? null;
  }

  getDiscoveryService(): ModelDiscoveryService | null {
    return this.discoveryService;
  }

  getDiscoveryScheduler(): DiscoveryScheduler | null {
    return this.discoveryScheduler;
  }

  /**
   * Runs a live model discovery for one provider.
   * The scan uses the provider's OWN browser profile and never disturbs a
   * live driver session (the runner defers in that case).
   */
  async discoverModels(id: WebProviderId): Promise<ProviderDiscoveryReport | null> {
    if (!this.discoveryService) return null;
    const report = await this.discoveryService.discover(id);
    this.discoveryReports.set(id, report);
    return report;
  }

  /** The live-discovery state of a provider (for the card). */
  async discoveryState(id: WebProviderId): Promise<ProviderDiscoveryState> {
    const adapter = getDiscoveryAdapter(id);
    const proven = Boolean(adapter?.verified);
    const report = this.discoveryReports.get(id);
    const service = this.discoveryService;

    let lastSuccessAt: string | undefined;
    let modelCount: number | undefined;
    let unreadChanges = 0;
    if (service) {
      const snapshot = await service.snapshot(id).catch(() => null);
      lastSuccessAt = snapshot?.lastSuccessfulScanAt;
      modelCount = snapshot?.models.length;
      unreadChanges = await service.unreadCount(id).catch(() => 0);
    }

    let status: ProviderDiscoveryStatus = 'never_scanned';
    if (!adapter) status = 'unsupported';
    else if (report) {
      if (report.status === 'discovered') status = 'active';
      else if (report.deferred) status = 'deferred';
      else if (report.failureReason === 'authentication_required') status = 'needs_login';
      else if (report.failureReason === 'discovery_unsupported') status = 'unsupported';
      else status = 'error';
    } else if (!proven) {
      status = 'unsupported';
    }

    return {
      status,
      lastScanAt: report?.discoveredAt,
      lastSuccessAt,
      modelCount,
      newModelCount: report?.changes.filter((c) => c.type === 'model_added' || c.type === 'model_restored').length,
      source: report?.source,
      failureReason: report?.failureReason,
      detail: report?.detail ?? (report?.status === 'discovered' ? undefined : adapter?.blocker),
      unreadChanges,
      proven,
    };
  }

  /** The last discovery report of a provider (for the change list). */
  lastDiscoveryReport(id: WebProviderId): ProviderDiscoveryReport | null {
    return this.discoveryReports.get(id) ?? null;
  }

  /**
   * The provider state INCLUDING the live discovery state.
   * The discovery state needs async access (snapshot store + unread count),
   * so the API layer uses this instead of the synchronous `getState`.
   */
  async getStateWithDiscovery(id: WebProviderId): Promise<ProviderRuntimeState> {
    const state = this.getState(id);
    try {
      state.discovery = await this.discoveryState(id);
    } catch {
      state.discovery = undefined;
    }
    state.card = buildProviderCardView(state);
    return state;
  }

  getState(id: WebProviderId): ProviderRuntimeState {
    const cfg = this.providerConfig(id);
    const rt = this.runtime(id);
    const runningMs = rt.startedAt ? this.now() - rt.startedAt : 0;
    const meta: ProviderMetaState = {
      ...(cfg.meta || {}),
    };
    const state: ProviderRuntimeState = {
      id,
      name: PROVIDER_META[id].name,
      status: rt.status,
      enabled: !!cfg.enabled,
      startedAt: rt.startedAt ? new Date(rt.startedAt).toISOString() : undefined,
      lastStartedAt: rt.lastStartedAt,
      lastStoppedAt: rt.lastStoppedAt,
      runtimeMs: rt.runtimeMsAcc + runningMs,
      lastError: rt.lastError,
      availableModels: [...(cfg.availableModels || [])],
      selectedModels: [...(cfg.selectedModels || [])],
      settings: { ...(cfg.settings || {}) },
      auth: cfg.auth,
      isLoggedIn: Boolean(cfg.auth?.isLoggedIn),
      accountName: cfg.auth?.accountName,
      accountEmail: cfg.auth?.accountEmail,
      accounts: cfg.accounts ? [...cfg.accounts] : [],
      activeAccountId: cfg.activeAccountId || (cfg.accounts?.[0]?.id),
      latencyMs: rt.latencyMs,
      requestCount: rt.requestCount || 0,
      capabilities: getProviderCapabilities(id),
      meta,
      connection: rt.connection,
    };
    state.card = buildProviderCardView(state);
    return state;
  }

  async addAccount(id: WebProviderId, account: { name: string; email: string; userDataDir?: string }): Promise<ProviderRuntimeState> {
    const cfg = this.providerConfig(id);
    if (!Array.isArray(cfg.accounts)) cfg.accounts = [];
    const accId = 'acc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const home = process.env.HOME || os.homedir() || '';
    const fallbackDir = `${home}/.arena-webbridge/${id}-profile-${accId}`;
    const defDir = sanitizeUserDataDir(account.userDataDir, fallbackDir);
    const shouldBeActive = cfg.accounts.length === 0 || !cfg.accounts.some((a) => a.active);
    const newAcc: ProviderAccount = {
      id: accId,
      name: account.name.trim() || account.email.trim(),
      email: account.email.trim(),
      isLoggedIn: false,
      active: shouldBeActive,
      userDataDir: defDir,
      addedAt: new Date().toISOString(),
    };
    cfg.accounts.push(newAcc);
    if (newAcc.active) {
      cfg.activeAccountId = accId;
      cfg.auth = {
        isLoggedIn: false,
        accountName: newAcc.name,
        accountEmail: newAcc.email,
        lastCheckedAt: new Date().toISOString(),
      };
      cfg.settings.userDataDir = defDir;
    }
    await this.saveConfig();
    return this.getState(id);
  }

  async switchAccount(id: WebProviderId, accountId: string): Promise<ProviderRuntimeState> {
    const cfg = this.providerConfig(id);
    if (!Array.isArray(cfg.accounts)) return this.getState(id);
    const target = cfg.accounts.find((a) => a.id === accountId)
      || ((accountId === 'acc_def' || accountId === 'acc_default') ? cfg.accounts[0] : undefined);
    if (!target) throw new Error(`Account "${accountId}" not found for provider "${id}".`);

    // Stop current runtime if running so profile lock is released
    await this.stop(id);

    for (const a of cfg.accounts) a.active = (a.id === target.id);
    cfg.activeAccountId = target.id;
    if (target.userDataDir) {
      cfg.settings.userDataDir = target.userDataDir;
    }
    cfg.auth = {
      isLoggedIn: target.isLoggedIn,
      accountName: target.name,
      accountEmail: target.email,
      avatarUrl: target.avatarUrl,
      lastLoginAt: target.lastLoginAt,
      lastCheckedAt: new Date().toISOString(),
    };
    await this.saveConfig();
    return this.getState(id);
  }

  async removeAccount(id: WebProviderId, accountId: string): Promise<ProviderRuntimeState> {
    const cfg = this.providerConfig(id);
    if (!Array.isArray(cfg.accounts)) cfg.accounts = [];
    const removed = cfg.accounts.find((a) => a.id === accountId);
    const wasActive = Boolean(removed?.active || cfg.activeAccountId === accountId);
    if (accountId === 'acc_def' || accountId === 'acc_default') {
      cfg.accounts = cfg.accounts.filter((a) => a.id !== accountId && a.id !== 'acc_def' && a.id !== 'acc_default');
    } else {
      cfg.accounts = cfg.accounts.filter((a) => a.id !== accountId);
    }
    if (cfg.accounts.length === 0) {
      cfg.activeAccountId = undefined;
      cfg.auth = undefined;
      await this.saveConfig();
    } else if (wasActive || !cfg.accounts.some((a) => a.active)) {
      const next = cfg.accounts.find((a) => a.enabled !== false) || cfg.accounts[0];
      if (next) await this.switchAccount(id, next.id);
      else await this.saveConfig();
    } else {
      await this.saveConfig();
    }
    return this.getState(id);
  }

  async toggleAccount(id: WebProviderId, accountId: string, enabled: boolean): Promise<ProviderRuntimeState> {
    const cfg = this.providerConfig(id);
    if (!Array.isArray(cfg.accounts)) cfg.accounts = [];
    const acc = cfg.accounts.find((a) => a.id === accountId)
      || ((accountId === 'acc_def' || accountId === 'acc_default') ? cfg.accounts[0] : undefined);
    if (!acc) throw new Error(`Account "${accountId}" not found for provider "${id}".`);
    acc.enabled = enabled;
    if (!enabled && acc.active) {
      const next = cfg.accounts.find((a) => a.id !== acc.id && a.enabled !== false);
      if (next) {
        await this.switchAccount(id, next.id);
      } else {
        acc.active = false;
        cfg.activeAccountId = undefined;
        cfg.auth = undefined;
        await this.saveConfig();
      }
    } else {
      await this.saveConfig();
    }
    return this.getState(id);
  }

  /**
   * REAL connection check.
   *
   * Probes the provider itself over HTTP and combines the result with verified
   * local signals (browser binary, profile directory, session on disk, driver
   * state, model availability). It never reports "connected" without evidence
   * and never collapses distinct failures into a single boolean.
   */
  async checkConnection(id: WebProviderId): Promise<ProviderConnectionReport> {
    return this.withLock(id, async () => {
      const cfg = this.providerConfig(id);
      const rt = this.runtime(id);
      const report = await this.connectionProbe({
        providerId: id,
        baseUrl: String(cfg.settings.baseUrl || ''),
        profileDir: String(cfg.settings.userDataDir || ''),
        driverRunning: rt.status === 'running',
        selectedModels: [...(cfg.selectedModels || [])],
        availableModels: [...(cfg.availableModels || [])],
      });
      rt.connection = report;
      rt.latencyMs = report.latencyMs;
      cfg.meta = {
        ...(cfg.meta || {}),
        lastConnectionCheckAt: report.checkedAt,
        lastConnectionStatus: report.status,
        lastConnectionDetail: report.detail,
        lastConnectionLatencyMs: report.latencyMs,
      };
      await this.saveConfig().catch(() => {});
      return report;
    });
  }

  /**
   * Backwards-compatible alias of {@link checkConnection}.
   * `ok` is true ONLY for a verified 'connected' report.
   */
  async ping(id: WebProviderId): Promise<{
    ok: boolean;
    latencyMs: number;
    state: ProviderRuntimeState;
    report: ProviderConnectionReport;
  }> {
    const report = await this.checkConnection(id);
    const state = this.getState(id);
    return { ok: report.status === 'connected', latencyMs: report.latencyMs, state, report };
  }

  async checkAuth(id: WebProviderId): Promise<ProviderRuntimeState> {
    const cfg = this.providerConfig(id);
    const userDataDir = String(cfg.settings.userDataDir || '');
    if (userDataDir) {
      const diskAuth = detectDiskProfileAuth(userDataDir);
      if (diskAuth?.isLoggedIn) {
        cfg.auth = {
          isLoggedIn: true,
          accountName: diskAuth.name || cfg.auth?.accountName,
          accountEmail: diskAuth.email || cfg.auth?.accountEmail,
          avatarUrl: diskAuth.avatar || cfg.auth?.avatarUrl,
          lastCheckedAt: new Date().toISOString(),
          authMethod: diskAuth.authMethod || cfg.auth?.authMethod || 'session',
        };
        if (!Array.isArray(cfg.accounts) || cfg.accounts.length === 0) {
          cfg.accounts = [{
            id: 'acc_default',
            name: cfg.auth.accountName || cfg.auth.accountEmail || 'الحساب الافتراضي',
            email: cfg.auth.accountEmail || 'جلسة متصفح نشطة',
            avatarUrl: cfg.auth.avatarUrl,
            isLoggedIn: true,
            active: true,
            userDataDir,
          }];
          cfg.activeAccountId = 'acc_default';
        } else {
          const activeAcc = cfg.accounts.find((a) => a.active) || cfg.accounts[0];
          if (activeAcc) {
            activeAcc.isLoggedIn = true;
            if (diskAuth.email && (!activeAcc.email || activeAcc.email === 'جلسة متصفح نشطة')) activeAcc.email = diskAuth.email;
            if (diskAuth.name && (!activeAcc.name || activeAcc.name === 'الحساب الافتراضي')) activeAcc.name = diskAuth.name;
          }
        }
        await this.saveConfig().catch(() => {});
      }
    }
    return this.getState(id);
  }

  async updateProvider(id: WebProviderId, patch: {
    enabled?: boolean;
    settings?: Record<string, unknown>;
    selectedModels?: string[];
    availableModels?: string[];
    auth?: ProviderAuthInfo;
    accountEmail?: string;
    accountName?: string;
  }): Promise<ProviderRuntimeState> {
    const cfg = this.providerConfig(id);
    if (patch.enabled != null) cfg.enabled = patch.enabled;
    if (patch.settings) {
      const ALLOWED = new Set(['baseUrl', 'userDataDir', 'headless', 'privacyMode', 'timeoutMs', 'captchaWaitMs']);
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch.settings)) {
        if (!ALLOWED.has(k)) continue;
        if (v == null) continue;
        const s = typeof v === 'string' ? v.slice(0, 1024) : v;
        if (k === 'baseUrl') {
          const str = String(s);
          try {
            const u = new URL(str);
            if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(u.origin))) continue;
          } catch { continue; }
          filtered[k] = str.replace(/\/$/, '');
        } else if (k === 'userDataDir') {
          filtered[k] = sanitizeUserDataDir(String(s));
        } else if (k === 'timeoutMs' || k === 'captchaWaitMs') {
          const n = Number(s);
          if (!Number.isFinite(n)) continue;
          filtered[k] = Math.min(600_000, Math.max(1_000, n));
        } else if (k === 'headless' || k === 'privacyMode') {
          filtered[k] = !!s;
        } else {
          filtered[k] = s;
        }
      }
      cfg.settings = { ...(cfg.settings || {}), ...filtered };
    }
    if (patch.selectedModels) cfg.selectedModels = uniq(patch.selectedModels.map(String).map((s) => s.slice(0, 128))).slice(0, 500);
    if (patch.availableModels) cfg.availableModels = uniq(patch.availableModels.map(String).map((s) => s.slice(0, 128))).slice(0, 500);
    if (patch.auth) cfg.auth = { ...(cfg.auth || {}), ...patch.auth };
    if (patch.accountEmail != null || patch.accountName != null) {
      cfg.auth = {
        ...(cfg.auth || { isLoggedIn: true }),
        ...(patch.accountEmail != null ? { accountEmail: String(patch.accountEmail).trim() } : {}),
        ...(patch.accountName != null ? { accountName: String(patch.accountName).trim() } : {}),
      };
    }
    await this.saveConfig();
    return this.getState(id);
  }

  private async withLock<T>(id: WebProviderId, fn: () => Promise<T>): Promise<T> {
    const rt = this.runtime(id);
    const prev = rt.op ?? Promise.resolve();
    let release!: () => void;
    rt.op = new Promise<void>((r) => { release = r; });
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async start(id: WebProviderId): Promise<ProviderRuntimeState> {
    return this.withLock(id, async () => {
      const rt = this.runtime(id);
      if (rt.status === 'running' && rt.driver) return this.getState(id);
      rt.status = 'starting';
      rt.lastError = undefined;
      try {
        const cfg = this.providerConfig(id);
        const factory = this.factories[id] ?? PROVIDER_META[id].defaultFactory;
        rt.driver = await factory(cfg);
        rt.status = 'running';
        rt.startedAt = this.now();
        rt.lastStartedAt = new Date(rt.startedAt).toISOString();
        return this.getState(id);
      } catch (e) {
        rt.status = 'error';
        rt.lastError = e instanceof Error ? e.message : String(e);
        rt.driver = undefined;
        return this.getState(id);
      }
    });
  }

  async stop(id: WebProviderId): Promise<ProviderRuntimeState> {
    return this.withLock(id, async () => {
      const rt = this.runtime(id);
      if (rt.startedAt) {
        rt.runtimeMsAcc += this.now() - rt.startedAt;
        rt.startedAt = undefined;
      }
      try { await rt.driver?.close?.(); } catch {}
      rt.driver = undefined;
      rt.status = 'stopped';
      rt.lastStoppedAt = new Date(this.now()).toISOString();
      return this.getState(id);
    });
  }

  /**
   * Persists a discovery outcome with the CORRECT semantics:
   *  - success REPLACES the stored list (stale ids disappear),
   *  - an existing selection is preserved (pruned only when the provider
   *    dropped the model),
   *  - a provider that had NO selection gets the whole catalog as the
   *    documented default (reported via `autoSelected`),
   *  - failure keeps the last good list and records the reason.
   */
  private persistDiscovery(
    cfg: ProviderConfig,
    rt: Runtime,
    outcome: ModelDiscoveryOutcome,
    previousSelected: string[],
  ): void {
    cfg.meta = {
      ...(cfg.meta || {}),
      modelsSource: outcome.source,
      modelsDiscoveryMode: outcome.mode,
      lastModelsRefreshAt: outcome.discoveredAt,
    };
    if (outcome.ok) {
      cfg.availableModels = outcome.models;
      if (previousSelected.length === 0) {
        cfg.selectedModels = [...outcome.models];
        outcome.autoSelected = true;
        outcome.keptSelected = [...outcome.models];
      } else {
        cfg.selectedModels = outcome.keptSelected;
      }
      cfg.meta.lastModelsRefreshCount = outcome.count;
      cfg.meta.lastModelsError = undefined;
      rt.lastError = undefined;
    } else {
      cfg.meta.lastModelsError = outcome.error;
      cfg.meta.lastModelsRefreshCount = undefined;
      rt.lastError = outcome.error;
    }
  }

  /**
   * Refreshes a provider's model list with a REAL operation.
   *
   * Semantics (deliberately different from the previous "union" behaviour):
   *  - SUCCESS replaces the stored list, so ids the provider no longer has
   *    disappear instead of lingering forever;
   *  - the user's selection is preserved while the model is still available
   *    and pruned (reported back) when the provider dropped it;
   *  - FAILURE (timeout, empty catalog, unreachable adapter, unsupported
   *    discovery) keeps the LAST GOOD list and the current selection and
   *    reports the reason — it never reports a fake success.
   */
  async refreshModelsReport(id: WebProviderId): Promise<ModelDiscoveryOutcome> {
    return this.withLock(id, async () => {
      const rt = this.runtime(id);
      const cfg = this.providerConfig(id);
      const previousAvailable = [...(cfg.availableModels || [])];
      const previousSelected = [...(cfg.selectedModels || [])];
      let driver = rt.driver;
      let temp = false;

      const persistFailure = (error: string, failureCode?: ModelDiscoveryOutcome['failureCode']): ModelDiscoveryOutcome => {
        const outcome: ModelDiscoveryOutcome = {
          ok: false,
          providerId: id,
          models: [],
          count: 0,
          source: 'none',
          mode: getProviderCapabilities(id).modelDiscoveryMode,
          discoveredAt: new Date(this.now()).toISOString(),
          removedModels: [],
          keptSelected: previousSelected,
          droppedSelected: [],
          error,
          failureCode,
        };
        cfg.meta = {
          ...(cfg.meta || {}),
          lastModelsRefreshAt: outcome.discoveredAt,
          lastModelsError: error,
        };
        rt.lastError = error;
        return outcome;
      };

      try {
        if (!driver) {
          const factory = this.factories[id] ?? PROVIDER_META[id].defaultFactory;
          try {
            driver = await factory(cfg);
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            const outcome = persistFailure(`Could not initialize the provider adapter: ${message}`, 'PROVIDER_UNAVAILABLE');
            await this.saveConfig().catch(() => {});
            return outcome;
          }
          temp = true;
        }

        const outcome = await discoverProviderModels({
          providerId: id,
          driver,
          previousAvailable,
          previousSelected,
        });

        this.persistDiscovery(cfg, rt, outcome, previousSelected);
        await this.saveConfig().catch(() => {});
        return outcome;
      } finally {
        if (temp) try { await driver?.close?.(); } catch {}
      }
    });
  }

  async refreshModels(id: WebProviderId): Promise<ProviderRuntimeState> {
    await this.refreshModelsReport(id);
    return this.getState(id);
  }

  findTargetForModel(model: string): { providerId: WebProviderId; targetModel: string } | undefined {
    const raw = model.trim();
    const cleaned = raw.toLowerCase();
    const order: WebProviderId[] = [...WEB_PROVIDER_IDS.filter((id) => id !== 'arena-browser'), 'arena-browser'];

    // 1. Direct match with prefix or raw name in selectedModels of enabled providers
    for (const id of order) {
      const cfg = this.providerConfig(id);
      if (!cfg?.enabled) continue;
      const selected = cfg.selectedModels || [];
      const match = selected.find((m) => m.toLowerCase() === cleaned || m === raw);
      if (match) return { providerId: id, targetModel: match };
    }

    // 2. Strip provider prefixes from selectedModels and match bare name (e.g. user sends "gpt-4o", selected is "chatgpt-web:gpt-4o")
    for (const id of order) {
      const cfg = this.providerConfig(id);
      if (!cfg?.enabled) continue;
      const selected = cfg.selectedModels || [];
      for (const m of selected) {
        const colonIdx = m.indexOf(':');
        if (colonIdx > 0) {
          const bare = m.slice(colonIdx + 1).toLowerCase();
          if (bare === cleaned) return { providerId: id, targetModel: m };
        }
      }
    }

    // 3. User passes provider alias or short name, e.g. "chatgpt", "claude", "gemini", "qwen", "deepseek", "mistral", "grok"
    const aliasMap: Record<string, WebProviderId> = {
      chatgpt: 'chatgpt-web',
      'chatgpt-web': 'chatgpt-web',
      gpt: 'chatgpt-web',
      claude: 'claude-web',
      'claude-web': 'claude-web',
      gemini: 'gemini-web',
      'gemini-web': 'gemini-web',
      qwen: 'qwen-web',
      'qwen-web': 'qwen-web',
      deepseek: 'deepseek-web',
      'deepseek-web': 'deepseek-web',
      grok: 'grok-web',
      'grok-web': 'grok-web',
      kimi: 'kimi-web',
      'kimi-web': 'kimi-web',
      minimax: 'minimax-web',
      'minimax-web': 'minimax-web',
      longcat: 'longcat-web',
      'longcat-web': 'longcat-web',
      llm7: 'llm7-web',
      'llm7-web': 'llm7-web',
      kiwi: 'kiwi-web',
      'kiwi-web': 'kiwi-web',
      mistral: 'mistral-web',
      'mistral-web': 'mistral-web',
      zai: 'zai-web',
      'zai-web': 'zai-web',
      glm: 'zai-web',
      arena: 'arena-browser',
      'arena-browser': 'arena-browser',
    };
    if (aliasMap[cleaned]) {
      const pId = aliasMap[cleaned];
      const cfg = this.providerConfig(pId);
      if (cfg?.enabled && (cfg.selectedModels || []).length > 0) {
        return { providerId: pId, targetModel: cfg.selectedModels[0] };
      }
    }

    // 4. "auto" or "default"
    if (cleaned === 'auto' || cleaned === 'default') {
      const arenaCfg = this.providerConfig('arena-browser');
      if (arenaCfg?.enabled && (arenaCfg.selectedModels || []).includes('auto')) {
        return { providerId: 'arena-browser', targetModel: 'auto' };
      }
      for (const id of order) {
        const cfg = this.providerConfig(id);
        if (cfg?.enabled && (cfg.selectedModels || []).length > 0) {
          return { providerId: id, targetModel: cfg.selectedModels[0] };
        }
      }
    }

    return undefined;
  }

  findProviderForModel(model: string): WebProviderId | undefined {
    return this.findTargetForModel(model)?.providerId;
  }

  findCustomProviderForModel(model: string): { customProvider: CustomUpstreamProvider; targetModel: string } | undefined {
    const raw = model.trim();
    const cleaned = raw.toLowerCase();
    const list = this.config.gateway.customProviders || [];
    for (const cp of list) {
      if (!cp.enabled) continue;
      const models = cp.models || [];
      // Match `<customId>:<model>` or `<customName>:<model>`
      const prefixId = `${cp.id.toLowerCase()}:`;
      const prefixName = `${cp.name.trim().toLowerCase()}:`;
      if (cleaned.startsWith(prefixId)) {
        const sub = raw.slice(prefixId.length).trim() || models[0] || 'default';
        return { customProvider: cp, targetModel: sub };
      }
      if (cleaned.startsWith(prefixName)) {
        const sub = raw.slice(prefixName.length).trim() || models[0] || 'default';
        return { customProvider: cp, targetModel: sub };
      }
      const match = models.find((m) => m.toLowerCase() === cleaned || m === raw);
      if (match) {
        return { customProvider: cp, targetModel: match };
      }
    }
    return undefined;
  }

  private async sendCustomProviderMessage(
    custom: CustomUpstreamProvider,
    targetModel: string,
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const base = this.normalizeCustomProviderBaseUrl(custom.baseUrl);
    const { headers, isAnthropic } = this.buildCustomProviderAuthHeaders(base, custom.apiKey);
    headers['Content-Type'] = 'application/json';

    const endpoint = isAnthropic
      ? (/\/v\d+$/i.test(base) ? `${base}/messages` : `${base}/v1/messages`)
      : (/\/(v\d+[a-z0-9]*|openai)$/i.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`);

    const payload = isAnthropic
      ? {
          model: targetModel,
          max_tokens: 4096,
          messages: messages.map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          })),
        }
      : {
          model: targetModel,
          messages,
          stream: false,
        };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Custom provider "${custom.name}" returned HTTP ${res.status}: ${text || res.statusText}`);
      (err as any).statusCode = res.status;
      throw err;
    }
    const data = (await res.json()) as any;
    const content =
      data?.choices?.[0]?.message?.content ??
      data?.content?.[0]?.text ??
      data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      '';
    const textOut = String(content || '');
    if (textOut && onChunk) {
      onChunk(textOut);
    }
    return textOut;
  }

  // ── Router Groups ──────────────────────────────────────────────────────────

  private generateRouterGroupApiKey(): string {
    const used = new Set(this.getValidApiKeys());
    for (let i = 0; i < 20; i++) {
      const key = 'sk-rg-' + randomBytes(18).toString('hex');
      if (!used.has(key)) return key;
    }
    return 'sk-rg-' + randomBytes(24).toString('hex');
  }

  private async ensureRouterGroupKeys(): Promise<void> {
    if (!Array.isArray(this.config.routerGroups) || this.config.routerGroups.length === 0) return;
    let dirty = false;
    const used = new Set<string>();
    const master = String(this.config.gateway.apiKey || '').trim();
    if (master) used.add(master);
    for (const k of (this.config.gateway.apiKeys || [])) {
      const v = String(k?.key || '').trim();
      if (v) used.add(v);
    }
    for (const g of this.config.routerGroups) {
      const existing = typeof g.apiKey === 'string' ? g.apiKey.trim() : '';
      if (existing && !used.has(existing)) {
        g.apiKey = existing;
        used.add(existing);
        continue;
      }
      // missing or colliding -> generate a fresh one
      let fresh = '';
      for (let i = 0; i < 20; i++) {
        const cand = 'sk-rg-' + randomBytes(18).toString('hex');
        if (!used.has(cand)) { fresh = cand; break; }
      }
      if (!fresh) fresh = 'sk-rg-' + randomBytes(24).toString('hex');
      g.apiKey = fresh;
      used.add(fresh);
      dirty = true;
    }
    if (dirty) await this.saveConfig().catch(() => {});
  }

  getGroupForApiKey(key: string): RouterGroup | undefined {
    const k = String(key || '').trim();
    if (!k) return undefined;
    return (this.config.routerGroups || []).find((g) => g.enabled !== false && String(g.apiKey || '').trim() === k);
  }

  listRouterGroups(): RouterGroup[] {
    return Array.isArray(this.config.routerGroups) ? [...this.config.routerGroups] : [];
  }

  private isWebProviderId(id: string): id is WebProviderId {
    return (WEB_PROVIDER_IDS as string[]).includes(id);
  }

  private validateRouterGroupInput(input: Partial<RouterGroup>, excludeId?: string): { name: string; icon?: string; enabled: boolean; strategy: 'sequential' | 'round-robin'; targets: RouterGroupTarget[] } {
    const name = String(input.name ?? '').trim();
    if (!name) throw new Error('اسم المجموعة مطلوب.');
    if (name.length > 64) throw new Error('اسم المجموعة يجب ألا يتجاوز 64 حرفاً.');
    const dup = (this.config.routerGroups || []).find((g) => g.id !== excludeId && g.name.toLowerCase() === name.toLowerCase());
    if (dup) throw new Error(`اسم المجموعة "${name}" مستخدم بالفعل.`);
    const strategy: 'sequential' | 'round-robin' = input.strategy === 'round-robin' ? 'round-robin' : 'sequential';
    const enabled = typeof input.enabled === 'boolean' ? input.enabled : true;
    const icon = typeof input.icon === 'string' && input.icon.trim() ? input.icon.trim().slice(0, 8) : undefined;
    const rawTargets = Array.isArray(input.targets) ? input.targets : [];
    if (rawTargets.length < 1) throw new Error('أضف هدفاً واحداً على الأقل للمجموعة.');
    if (rawTargets.length > 50) throw new Error('الحد الأقصى 50 هدفاً لكل مجموعة.');
    const targets: RouterGroupTarget[] = rawTargets.map((t: any, idx: number) => {
      const kind = t?.kind === 'custom' ? 'custom' : (t?.kind === 'web' ? 'web' : null);
      if (!kind) throw new Error(`هدف #${idx + 1}: نوع المزود غير صالح.`);
      const providerId = String(t?.providerId || '').trim();
      const model = String(t?.model || '').trim().slice(0, 128);
      if (!providerId) throw new Error(`هدف #${idx + 1}: المزوّد مطلوب.`);
      if (!model) throw new Error(`هدف #${idx + 1}: النموذج مطلوب.`);
      const id = String(t?.id || '').trim() || randomUUID();
      const accountId = typeof t?.accountId === 'string' && t.accountId.trim() ? t.accountId.trim() : undefined;
      if (kind === 'web') {
        if (!this.isWebProviderId(providerId)) throw new Error(`هدف #${idx + 1}: المزوّد "${providerId}" غير معروف.`);
        if (accountId) {
          const cfg = this.providerConfig(providerId as WebProviderId);
          const acc = (cfg.accounts || []).find((a) => a.id === accountId);
          if (!acc) throw new Error(`هدف #${idx + 1}: الحساب المحدد لا يعود للمزوّد.`);
        }
      } else {
        const cp = (this.config.gateway.customProviders || []).find((p) => p.id === providerId);
        if (!cp) throw new Error(`هدف #${idx + 1}: المزوّد الخارجي غير موجود.`);
        if (accountId) throw new Error(`هدف #${idx + 1}: لا يدعم المزود الخارجي تثبيت حساب.`);
      }
      return { id, kind, providerId, model, ...(accountId ? { accountId } : {}) };
    });
    return { name, icon, enabled, strategy, targets };
  }

  async createRouterGroup(input: Partial<RouterGroup>): Promise<RouterGroup> {
    const v = this.validateRouterGroupInput(input);
    const now = new Date().toISOString();
    const apiKey = this.generateRouterGroupApiKey();
    const group: RouterGroup = { id: randomUUID(), name: v.name, ...(v.icon ? { icon: v.icon } : {}), enabled: v.enabled, strategy: v.strategy, targets: v.targets, apiKey, createdAt: now, updatedAt: now };
    if (!Array.isArray(this.config.routerGroups)) this.config.routerGroups = [];
    this.config.routerGroups.push(group);
    await this.saveConfig();
    return group;
  }

  async updateRouterGroup(id: string, patch: Partial<RouterGroup>): Promise<RouterGroup | undefined> {
    if (!Array.isArray(this.config.routerGroups)) this.config.routerGroups = [];
    const idx = this.config.routerGroups.findIndex((g) => g.id === id);
    if (idx < 0) return undefined;
    const current = this.config.routerGroups[idx];
    const merged: Partial<RouterGroup> = { ...current, ...patch };
    // keep immutable fields
    (merged as any).id = current.id;
    (merged as any).createdAt = current.createdAt;
    const v = this.validateRouterGroupInput(merged, id);
    const group: RouterGroup = { ...current, name: v.name, ...(v.icon ? { icon: v.icon } : {}), enabled: v.enabled, strategy: v.strategy, targets: v.targets, updatedAt: new Date().toISOString() };
    if (!v.icon) delete (group as any).icon;
    this.config.routerGroups[idx] = group;
    await this.saveConfig();
    return group;
  }

  async deleteRouterGroup(id: string): Promise<boolean> {
    if (!Array.isArray(this.config.routerGroups)) return false;
    const before = this.config.routerGroups.length;
    this.config.routerGroups = this.config.routerGroups.filter((g) => g.id !== id);
    if (this.config.routerGroups.length === before) return false;
    this.rrCounters.delete(id);
    await this.saveConfig();
    return true;
  }

  findRouterGroupForModel(model: string): RouterGroup | undefined {
    const name = String(model || '').trim().toLowerCase();
    if (!name) return undefined;
    return (this.config.routerGroups || []).find((g) => g.enabled && g.name.toLowerCase() === name);
  }

  private pickGroupTargetOrder(group: RouterGroup): RouterGroupTarget[] {
    const targets = group.targets || [];
    if (targets.length === 0) return [];
    if (group.strategy === 'round-robin') {
      const n = Math.max(0, this.rrCounters.get(group.id) || 0);
      this.rrCounters.set(group.id, n + 1);
      const start = n % targets.length;
      return [...targets.slice(start), ...targets.slice(0, start)];
    }
    return [...targets];
  }

  private async sendToWebTarget(
    providerId: WebProviderId,
    targetModel: string,
    accountId: string | undefined,
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
    sessionKey?: string
  ): Promise<string> {
    // Ensure correct account (inside provider lock) then run
    if (accountId) {
      const cfg = this.providerConfig(providerId);
      if (cfg.activeAccountId !== accountId) {
        await this.switchAccount(providerId, accountId);
      }
    }
    let rt = this.runtime(providerId);
    if (rt.status !== 'running' || !rt.driver) {
      await this.start(providerId);
      rt = this.runtime(providerId);
      if (rt.status !== 'running' || !rt.driver) {
        const err = new Error(`Provider "${PROVIDER_META[providerId].name}" failed to auto-start: ${rt.lastError || 'Unknown error'}`);
        (err as any).statusCode = 503;
        (err as any).type = 'service_unavailable';
        throw err;
      }
    }
    const t0 = this.now();
    rt.requestCount = (rt.requestCount || 0) + 1;
    try {
      const response = await rt.driver.sendMessage(targetModel, messages, onChunk, signal, sessionKey);
      rt.latencyMs = Math.max(1, this.now() - t0);
      return response;
    } catch (err) {
      rt.latencyMs = Math.max(1, this.now() - t0);
      throw err;
    }
  }

  private async sendToRouterTarget(target: RouterGroupTarget, messages: ChatMessage[], onChunk?: (chunk: string) => void, signal?: AbortSignal, sessionKey?: string): Promise<string> {
    if (target.kind === 'custom') {
      const cp = (this.config.gateway.customProviders || []).find((p) => p.id === target.providerId);
      if (!cp || !cp.enabled) throw new Error(`المزوّد الخارجي "${target.providerId}" غير متاح.`);
      return this.sendCustomProviderMessage(cp, target.model, messages, onChunk, signal);
    }
    if (!this.isWebProviderId(target.providerId)) throw new Error(`المزوّد "${target.providerId}" غير معروف.`);
    return this.sendToWebTarget(target.providerId, target.model, target.accountId, messages, onChunk, signal, sessionKey);
  }

  private async sendRouterGroupMessage(group: RouterGroup, messages: ChatMessage[], onChunk?: (chunk: string) => void, signal?: AbortSignal, sessionKey?: string): Promise<string> {
    const order = this.pickGroupTargetOrder(group);
    if (order.length === 0) {
      const err = new Error(`المجموعة "${group.name}" لا تحتوي أهدافاً.`);
      (err as any).statusCode = 400;
      throw err;
    }
    let lastErr: unknown;
    let emitted = false;
    const chunkGuard = (chunk: string) => {
      emitted = true;
      onChunk?.(chunk);
    };
    for (const target of order) {
      try {
        return await this.sendToRouterTarget(target, messages, onChunk ? chunkGuard : undefined, signal, sessionKey);
      } catch (e) {
        lastErr = e;
        // Failover only before first chunk (stream already started otherwise)
        if (emitted) throw e;
        if (signal?.aborted) throw e;
        continue;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'فشل جميع أهداف المجموعة.'));
  }

  async testRouterGroup(id: string): Promise<{ results: Array<{ targetId: string; ok: boolean; latencyMs?: number; error?: string }> }> {
    const group = (this.config.routerGroups || []).find((g) => g.id === id);
    if (!group) throw new Error('المجموعة غير موجودة.');
    const results: Array<{ targetId: string; ok: boolean; latencyMs?: number; error?: string }> = [];
    const testMsg: ChatMessage[] = [{ role: 'user', content: 'Reply with: OK' }];
    for (const target of group.targets || []) {
      const t0 = this.now();
      try {
        await this.sendToRouterTarget(target, testMsg, undefined, undefined);
        results.push({ targetId: target.id, ok: true, latencyMs: Math.max(1, this.now() - t0) });
      } catch (e) {
        results.push({ targetId: target.id, ok: false, latencyMs: Math.max(1, this.now() - t0), error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { results };
  }

  isModelEnabled(model: string): boolean {
    return this.findRouterGroupForModel(model) != null || this.findProviderForModel(model) != null || this.findCustomProviderForModel(model) != null;
  }

  getActiveDriver(): ArenaDriver {
    return {
      listModels: async () => {
        const out: string[] = [];
        for (const g of this.config.routerGroups || []) {
          if (g.enabled && g.name && !out.includes(g.name)) out.push(g.name);
        }
        for (const id of WEB_PROVIDER_IDS) {
          const cfg = this.providerConfig(id);
          if (!cfg?.enabled) continue;
          for (const m of cfg.selectedModels || []) if (!out.includes(m)) out.push(m);
        }
        for (const cp of this.config.gateway.customProviders || []) {
          if (!cp.enabled) continue;
          for (const m of cp.models || []) {
            if (m && !out.includes(m)) out.push(m);
          }
        }
        return out;
      },
      sendMessage: async (model: string, messages: ChatMessage[], onChunk?: (chunk: string) => void, signal?: AbortSignal, sessionKey?: string) => {
        const group = this.findRouterGroupForModel(model);
        if (group) {
          return this.sendRouterGroupMessage(group, messages, onChunk, signal, sessionKey);
        }
        const target = this.findTargetForModel(model);
        if (!target) {
          const customTarget = this.findCustomProviderForModel(model);
          if (customTarget) {
            return this.sendCustomProviderMessage(customTarget.customProvider, customTarget.targetModel, messages, onChunk, signal);
          }
          const err = new Error(`Model "${model}" is not enabled or not selected in the gateway UI.`);
          (err as any).statusCode = 404;
          (err as any).type = 'invalid_request_error';
          throw err;
        }
        return this.sendToWebTarget(target.providerId, target.targetModel, undefined, messages, onChunk, signal, sessionKey);
      },
      close: async () => { await this.close(); },
    };
  }

  private loginUrl(id: WebProviderId): string {
    const base = String(this.providerConfig(id).settings.baseUrl || providerSpec(id).defaultBaseUrl);
    switch (id) {
      case 'arena-browser': return base;
      case 'zai-web': return base;
      case 'claude-web': return base.replace(/\/$/, '') + '/login';
      case 'tencent-ai-web': return base.includes('aistudio.tencent.ai') ? 'https://yuanbao.tencent.com/chat' : (base.endsWith('/') ? base : base + '/');
      case 'gemini-web': return base.replace(/\/$/, '') + '/app';
      case 'qwen-web': return base.endsWith('/') ? base : base + '/';
      case 'chatgpt-web': return base;
      case 'grok-web': return base;
      case 'kimi-web': return base.includes('kimi.com') && !base.includes('/build') ? base.replace(/\/$/, '') + '/build' : base;
      case 'minimax-web': return base;
      case 'longcat-web': return base;
      case 'llm7-web': return base;
      case 'kiwi-web': return base;
      case 'deepseek-web': return base;
      case 'mistral-web': return base;
      default: return base;
    }
  }

  async login(id: WebProviderId, accountId?: string): Promise<ProviderRuntimeState> {
    return this.withLock(id, async () => {
      // Stop running driver to release profile lock.
      const rt = this.runtime(id);
      if (rt.startedAt) { rt.runtimeMsAcc += this.now() - rt.startedAt; rt.startedAt = undefined; }
      try { await rt.driver?.close?.(); } catch {}
      rt.driver = undefined;
      rt.status = 'stopped';

      const cfg = this.providerConfig(id);
      const targetAcc = accountId && Array.isArray(cfg.accounts)
        ? cfg.accounts.find((a) => a.id === accountId)
        : undefined;
      const userDataDir = String(targetAcc?.userDataDir || cfg.settings.userDataDir || '');
      if (!userDataDir) throw new Error(`Provider ${id} has no userDataDir configured.`);
      cleanupStaleProfileLocks(userDataDir);
      const loginLaunchOptions: Record<string, unknown> = {
        headless: false,
        viewport: { width: 1280, height: 900 },
        args: ['--disable-blink-features=AutomationControlled'],
        ignoreDefaultArgs: ['--enable-automation'],
      };
      let context: BrowserContext;
      try {
        context = await chromium.launchPersistentContext(userDataDir, {
          ...loginLaunchOptions,
          channel: 'chrome',
        });
      } catch {
        context = await chromium.launchPersistentContext(userDataDir, loginLaunchOptions);
      }

      let detectedAuth: { isLoggedIn: boolean; accountName?: string; accountEmail?: string } = { isLoggedIn: false };
      let pollInterval: ReturnType<typeof setInterval> | undefined;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

      try {
        const page = context.pages()[0] || await context.newPage();
        await page.goto(this.loginUrl(id), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

        const pollAuth = new Promise<void>((resolve) => {
          pollInterval = setInterval(async () => {
            if (context.pages().length === 0) {
              if (pollInterval) clearInterval(pollInterval);
              return resolve();
            }
            const auth = await detectPageAuth(id, page, context).catch(() => null);
            if (auth && auth.isLoggedIn) {
              detectedAuth = auth;
              // Keep the window open so the user can confirm/finish; close it manually when done.
              try {
                await page.evaluate(() => {
                  const prev = document.title || '';
                  if (!prev.startsWith('✅')) document.title = '✅ تم تسجيل الدخول - يمكنك إغلاق النافذة';
                }).catch(() => {});
              } catch {}
            }
          }, 2000);
        });

        await Promise.race([
          pollAuth,
          new Promise<void>((resolve) => context.on('close', () => resolve())),
          new Promise<never>((_rej, reject) => {
            timeoutTimer = setTimeout(
              () => reject(new Error('Login timed out after 180s. Close the browser window or retry.')),
              180_000
            );
          }),
        ]);

        if (!detectedAuth.isLoggedIn) {
          const finalAuth = await detectPageAuth(id, page, context).catch(() => null);
          if (finalAuth && finalAuth.isLoggedIn) detectedAuth = finalAuth;
        }
      } finally {
        if (pollInterval) clearInterval(pollInterval);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        try { await context.close(); } catch {}
      }

      if (!detectedAuth.accountEmail) {
        const googleAcc = readGoogleProfilePreferences(userDataDir);
        if (googleAcc?.email) {
          detectedAuth.accountEmail = googleAcc.email;
          detectedAuth.accountName ||= googleAcc.name;
          detectedAuth.isLoggedIn = true;
        }
      }

      // Update target or active account in accounts list
      if (!Array.isArray(cfg.accounts)) cfg.accounts = [];
      const effectiveAccId = targetAcc?.id || cfg.activeAccountId;
      let activeAcc = cfg.accounts.find((a) => a.id === effectiveAccId);
      if (!activeAcc) {
        activeAcc = {
          id: effectiveAccId || 'acc_default',
          name: detectedAuth.accountName || detectedAuth.accountEmail || 'Primary Account',
          email: detectedAuth.accountEmail || '',
          isLoggedIn: detectedAuth.isLoggedIn,
          active: true,
          userDataDir,
          lastLoginAt: new Date().toISOString(),
        };
        for (const a of cfg.accounts) a.active = false;
        cfg.accounts.push(activeAcc);
        cfg.activeAccountId = activeAcc.id;
      } else {
        activeAcc.isLoggedIn = detectedAuth.isLoggedIn;
        if (detectedAuth.accountEmail) activeAcc.email = detectedAuth.accountEmail;
        if (detectedAuth.accountName) activeAcc.name = detectedAuth.accountName;
        activeAcc.lastLoginAt = new Date().toISOString();
        if (targetAcc) {
          for (const a of cfg.accounts) a.active = (a.id === activeAcc.id);
          cfg.activeAccountId = activeAcc.id;
          cfg.settings.userDataDir = userDataDir;
        }
      }

      cfg.auth = {
        isLoggedIn: detectedAuth.isLoggedIn,
        accountName: detectedAuth.accountName || activeAcc.name,
        accountEmail: detectedAuth.accountEmail || activeAcc.email,
        lastLoginAt: detectedAuth.isLoggedIn ? new Date().toISOString() : cfg.auth?.lastLoginAt,
        lastCheckedAt: new Date().toISOString(),
      };
      cfg.enabled = true;

      // Auto-pull models after login — same semantics as the refresh button:
      // the discovered catalog REPLACES the stored list (no stale ids).
      try {
        const factory = this.factories[id] ?? PROVIDER_META[id].defaultFactory;
        const driver = await factory(cfg);
        try {
          const previousSelected = [...(cfg.selectedModels || [])];
          const outcome = await discoverProviderModels({
            providerId: id,
            driver,
            previousAvailable: [...(cfg.availableModels || [])],
            previousSelected,
          });
          this.persistDiscovery(cfg, rt, outcome, previousSelected);
        } finally {
          try { await driver.close?.(); } catch {}
        }
      } catch (e) {
        rt.lastError = e instanceof Error ? e.message : String(e);
      }
      await this.saveConfig().catch(() => {});
      return this.getState(id);
    });
  }

  listApiKeys(): ApiKeyItem[] {
    return [...(this.config.gateway.apiKeys || [])];
  }

  async addApiKey(name: string, customKey?: string): Promise<ApiKeyItem> {
    if (!Array.isArray(this.config.gateway.apiKeys)) this.config.gateway.apiKeys = [];
    const id = 'key_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const key = customKey && customKey.trim()
      ? customKey.trim()
      : 'sk-emo-' + randomBytes(16).toString('hex');
    const item: ApiKeyItem = {
      id,
      name: name.trim() || 'API Key ' + (this.config.gateway.apiKeys.length + 1),
      key,
      createdAt: new Date().toISOString(),
      enabled: true,
    };
    this.config.gateway.apiKeys.push(item);
    await this.saveConfig();
    return item;
  }

  async deleteApiKey(id: string): Promise<boolean> {
    if (!Array.isArray(this.config.gateway.apiKeys)) return false;
    const initialLen = this.config.gateway.apiKeys.length;
    this.config.gateway.apiKeys = this.config.gateway.apiKeys.filter((k) => k.id !== id);
    if (this.config.gateway.apiKeys.length !== initialLen) {
      await this.saveConfig();
      return true;
    }
    return false;
  }

  async toggleApiKey(id: string, enabled: boolean): Promise<ApiKeyItem | null> {
    if (!Array.isArray(this.config.gateway.apiKeys)) return null;
    const item = this.config.gateway.apiKeys.find((k) => k.id === id);
    if (!item) return null;
    item.enabled = enabled;
    await this.saveConfig();
    return item;
  }

  getValidApiKeys(): string[] {
    const keys: string[] = [];
    const masterKey = String(this.config.gateway.apiKey || '').trim();
    if (masterKey) keys.push(masterKey);
    if (Array.isArray(this.config.gateway.apiKeys)) {
      for (const k of this.config.gateway.apiKeys) {
        const cleanKey = String(k.key || '').trim();
        if (k.enabled && cleanKey && !keys.includes(cleanKey)) {
          keys.push(cleanKey);
        }
      }
    }
    if (Array.isArray(this.config.routerGroups)) {
      for (const g of this.config.routerGroups) {
        if (g.enabled === false) continue;
        const gk = String((g as any).apiKey || '').trim();
        if (gk && !keys.includes(gk)) keys.push(gk);
      }
    }
    return keys;
  }

  listCustomProviders(): CustomUpstreamProvider[] {
    return [...(this.config.gateway.customProviders || [])];
  }

  listCustomAgents(): CustomAgent[] {
    return [...(this.config.gateway.customAgents || [])];
  }

  async addCustomAgent(data: {
    name: string;
    id?: string;
    icon?: string;
    protocol?: 'openai' | 'anthropic' | 'gemini';
    command?: string;
    configPath?: string;
    notes?: string;
  }): Promise<CustomAgent> {
    if (!Array.isArray(this.config.gateway.customAgents)) this.config.gateway.customAgents = [];
    const id = (data.id && data.id.trim())
      ? data.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-')
      : 'agent_' + Date.now().toString(36);
    const existingIdx = this.config.gateway.customAgents.findIndex((a) => a.id === id);
    const item: CustomAgent = {
      id,
      name: data.name.trim() || 'Custom Agent',
      icon: data.icon?.trim() || '🤖',
      protocol: data.protocol || 'openai',
      command: data.command?.trim(),
      configPath: data.configPath?.trim(),
      notes: data.notes?.trim(),
      createdAt: new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      this.config.gateway.customAgents[existingIdx] = item;
    } else {
      this.config.gateway.customAgents.push(item);
    }
    await this.saveConfig();
    return item;
  }

  async deleteCustomAgent(id: string): Promise<boolean> {
    if (!Array.isArray(this.config.gateway.customAgents)) return false;
    const initialLen = this.config.gateway.customAgents.length;
    this.config.gateway.customAgents = this.config.gateway.customAgents.filter((a) => a.id !== id);
    if (this.config.gateway.customAgents.length !== initialLen) {
      await this.saveConfig();
      return true;
    }
    return false;
  }

  private normalizeCustomProviderBaseUrl(baseUrl: string): string {
    let rawBase = String(baseUrl || '').trim();
    if (!rawBase) {
      throw new Error('يرجى إدخال رابط Base URL أولاً');
    }
    // Fix common protocol typos such as "http:/localhost:11434/v1", "https:/api...", or "https://http:/..."
    rawBase = rawBase
      .replace(/^(https?:\/+)+(https?):\/+/i, '$2://')
      .replace(/^(https?):\/+/i, '$1://');

    if (!/^https?:\/\//i.test(rawBase)) {
      if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(rawBase)) {
        rawBase = 'http://' + rawBase;
      } else {
        rawBase = 'https://' + rawBase;
      }
    }
    // If localhost/127.0.0.1 was accidentally given https:// on standard local ports (11434, 1234, 8000, 8080), normalize to http://
    rawBase = rawBase.replace(/^https:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0):(11434|1234|8000|8080|5000)\b/i, 'http://$1:$2');

    try {
      const parsed = new URL(rawBase);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('البروتوكول غير مدعوم (يجب استخدام http أو https)');
      }
      if (isBlockedSsrfHost(parsed.hostname)) {
        throw new Error('الرابط محظور لأسباب أمنية (عناوين Link-Local وخدمات بيانات السحابة غير مسموح بها)');
      }
    } catch (e: any) {
      if (e?.message?.includes('محظور') || e?.message?.includes('البروتوكول')) throw e;
      throw new Error('صيغة الرابط غير صحيحة');
    }

    rawBase = rawBase
      .replace(/\/+$/, '')
      .replace(/\/(chat\/completions|completions|messages|responses|generateContent)$/i, '')
      .replace(/\/+$/, '');
    return rawBase;
  }

  private buildCustomProviderAuthHeaders(rawBase: string, apiKey?: string): {
    headers: Record<string, string>;
    isAnthropic: boolean;
    isGemini: boolean;
    cleanKey: string;
  } {
    const cleanKey = String(apiKey || '').trim();
    const isAnthropic = /anthropic\.com/i.test(rawBase);
    const isGemini = /googleapis\.com/i.test(rawBase) && !/\/openai$/i.test(rawBase);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'EMO-AI-Gateway/1.0',
    };
    if (cleanKey) {
      if (isAnthropic) {
        headers['x-api-key'] = cleanKey;
        headers['anthropic-version'] = '2023-06-01';
      } else if (isGemini) {
        headers['x-goog-api-key'] = cleanKey;
      } else {
        headers['Authorization'] = `Bearer ${cleanKey}`;
      }
    }
    return { headers, isAnthropic, isGemini, cleanKey };
  }

  private buildCustomProviderModelCandidateUrls(rawBase: string): string[] {
    const baseList: string[] = [];
    if (/\/models$/i.test(rawBase)) {
      baseList.push(rawBase);
    } else if (/\/(v\d+[a-z0-9]*|openai)$/i.test(rawBase)) {
      baseList.push(`${rawBase}/models`);
      const rootBase = rawBase.replace(/\/(v\d+[a-z0-9]*|openai)$/i, '');
      if (rootBase && rootBase !== rawBase) {
        baseList.push(`${rootBase}/api/tags`);
        baseList.push(`${rootBase}/models`);
      }
    } else {
      baseList.push(`${rawBase}/v1/models`);
      baseList.push(`${rawBase}/models`);
      baseList.push(`${rawBase}/api/tags`);
    }

    const expanded: string[] = [];
    for (const u of baseList) {
      expanded.push(u);
      if (/^https?:\/\/localhost\b/i.test(u)) {
        expanded.push(u.replace(/^(https?:\/\/)localhost\b/i, '$1127.0.0.1'));
      }
    }
    return [...new Set(expanded)];
  }

  private extractUpstreamErrorMessage(rawText: string, status: number, secrets: Array<string | undefined> = []): string {
    const trimmed = String(rawText || '').trim();
    if (!trimmed) return `HTTP ${status}`;
    try {
      const parsed = JSON.parse(trimmed) as any;
      const msg =
        parsed?.error?.message ||
        parsed?.message ||
        parsed?.detail ||
        (typeof parsed?.error === 'string' ? parsed.error : '');
      if (msg) return maskLiteralSecrets(`HTTP ${status}: ${String(msg).slice(0, 180)}`, secrets);
    } catch {
      // plain text
    }
    return maskLiteralSecrets(`HTTP ${status}: ${trimmed.slice(0, 160)}`, secrets);
  }

  async fetchCustomProviderModelsWithMeta(
    baseUrl: string,
    apiKey?: string,
    _name?: string,
  ): Promise<{ models: string[]; source: 'live'; endpoint: string; status: number; latencyMs: number }> {
    const rawBase = this.normalizeCustomProviderBaseUrl(baseUrl);
    const candidateUrls = this.buildCustomProviderModelCandidateUrls(rawBase);
    const { headers, isGemini, cleanKey } = this.buildCustomProviderAuthHeaders(rawBase, apiKey);

    let lastError = 'تعذر الوصول إلى نقطة نهاية النماذج (/models) على الخادم';
    for (const baseCandidate of candidateUrls) {
      const url = isGemini && cleanKey && !baseCandidate.includes('key=')
        ? `${baseCandidate}${baseCandidate.includes('?') ? '&' : '?'}key=${encodeURIComponent(cleanKey)}`
        : baseCandidate;
      const t0 = Date.now();
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 9000);
        let res: Response;
        try {
          res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
        const latencyMs = Math.max(1, Date.now() - t0);

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          lastError = this.extractUpstreamErrorMessage(errText, res.status, [cleanKey]);
          if (res.status === 401 || res.status === 403) {
            throw new Error(`رفض الخادم المصادقة (${lastError}) — تحقق من صحة مفتاح API`);
          }
          continue;
        }

        const data = (await res.json()) as any;
        const rawList: any[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.data)
            ? data.data
            : Array.isArray(data?.models)
              ? data.models
              : Array.isArray(data?.result)
                ? data.result
                : [];

        const extracted = rawList
          .map((item) => {
            if (typeof item === 'string') return item.trim();
            if (item && typeof item === 'object') {
              const id = item.id || item.model || item.name || '';
              return String(id).trim().replace(/^models\//, '');
            }
            return '';
          })
          .filter(Boolean);

        const unique = [...new Set(extracted)];
        if (unique.length > 0) {
          return {
            models: unique,
            source: 'live',
            endpoint: baseCandidate,
            status: res.status,
            latencyMs,
          };
        }
        lastError = `الخادم استجاب (HTTP ${res.status}) ولكن قائمة النماذج فارغة من ${baseCandidate}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('رفض الخادم المصادقة')) {
          throw err;
        }
        const safeMsg = maskLiteralSecrets(msg, [cleanKey]);
        lastError = safeMsg.includes('aborted') ? 'انتهت مهلة الاتصال بالخادم (Timeout 9s)' : safeMsg;
      }
    }

    throw new Error(`فشل جلب النماذج من الخادم: ${lastError}`);
  }

  async verifyCustomProviderConnection(opts: {
    baseUrl: string;
    apiKey?: string;
    testModel?: string;
  }): Promise<{
    ok: boolean;
    status: number;
    latencyMs: number;
    endpoint: string;
    modelsCount: number;
    models: string[];
    message: string;
    error?: string;
  }> {
    const rawBase = this.normalizeCustomProviderBaseUrl(opts.baseUrl);
    const candidateUrls = this.buildCustomProviderModelCandidateUrls(rawBase);
    const { headers, isAnthropic, isGemini, cleanKey } = this.buildCustomProviderAuthHeaders(rawBase, opts.apiKey);

    let lastStatus = 0;
    let lastLatency = 0;
    let lastEndpoint = candidateUrls[0] || rawBase;
    let lastError = 'تعذر الاتصال بالخادم';

    // Step 1: Test live /models endpoint(s)
    for (const baseCandidate of candidateUrls) {
      const url = isGemini && cleanKey && !baseCandidate.includes('key=')
        ? `${baseCandidate}${baseCandidate.includes('?') ? '&' : '?'}key=${encodeURIComponent(cleanKey)}`
        : baseCandidate;
      lastEndpoint = baseCandidate;
      const t0 = Date.now();
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 9000);
        let res: Response;
        try {
          res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
        const latencyMs = Math.max(1, Date.now() - t0);
        lastStatus = res.status;
        lastLatency = latencyMs;

        if (res.status === 401 || res.status === 403) {
          const errText = await res.text().catch(() => '');
          const detail = this.extractUpstreamErrorMessage(errText, res.status, [cleanKey]);
          return {
            ok: false,
            status: res.status,
            latencyMs,
            endpoint: baseCandidate,
            modelsCount: 0,
            models: [],
            message: `فشل التحقق من الاتصال: مفتاح API مرفوض (${detail})`,
            error: `فشل المصادقة (${detail})`,
          };
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          lastError = this.extractUpstreamErrorMessage(errText, res.status, [cleanKey]);
          continue;
        }

        const data = (await res.json()) as any;
        const rawList: any[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.data)
            ? data.data
            : Array.isArray(data?.models)
              ? data.models
              : Array.isArray(data?.result)
                ? data.result
                : [];

        const extracted = rawList
          .map((item) => {
            if (typeof item === 'string') return item.trim();
            if (item && typeof item === 'object') {
              const id = item.id || item.model || item.name || '';
              return String(id).trim().replace(/^models\//, '');
            }
            return '';
          })
          .filter(Boolean);

        const unique = [...new Set(extracted)];
        return {
          ok: true,
          status: res.status,
          latencyMs,
          endpoint: baseCandidate,
          modelsCount: unique.length,
          models: unique,
          message: unique.length > 0
            ? `الاتصال ناجح (HTTP ${res.status} · ${latencyMs}ms) — تم جلب ${unique.length} نموذج`
            : `الاتصال بالخادم ناجح (HTTP ${res.status} · ${latencyMs}ms)`,
        };
      } catch (err) {
        lastLatency = Math.max(1, Date.now() - t0);
        const msg = err instanceof Error ? err.message : String(err);
        lastError = msg.includes('aborted') ? 'انتهت مهلة الاتصال بالخادم (Timeout 9s)' : msg;
      }
    }

    // Step 2: If /models returned 404 or 405, probe chat/messages endpoint to check if server & key are alive
    if (lastStatus === 404 || lastStatus === 405) {
      const chatEndpoint = isAnthropic
        ? (/\/v\d+$/i.test(rawBase) ? `${rawBase}/messages` : `${rawBase}/v1/messages`)
        : (/\/(v\d+[a-z0-9]*|openai)$/i.test(rawBase) ? `${rawBase}/chat/completions` : `${rawBase}/v1/chat/completions`);
      const t0 = Date.now();
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        let res: Response;
        try {
          res = await fetch(chatEndpoint, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: opts.testModel || 'gpt-4o-mini',
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 1,
            }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        const latencyMs = Math.max(1, Date.now() - t0);
        if (res.status === 401 || res.status === 403) {
          const errText = await res.text().catch(() => '');
          const detail = this.extractUpstreamErrorMessage(errText, res.status, [cleanKey]);
          return {
            ok: false,
            status: res.status,
            latencyMs,
            endpoint: chatEndpoint,
            modelsCount: 0,
            models: [],
            message: `فشل التحقق من الاتصال: مفتاح API غير صالح (${detail})`,
            error: detail,
          };
        }
        if (res.ok || res.status === 400 || res.status === 422) {
          return {
            ok: true,
            status: res.status,
            latencyMs,
            endpoint: chatEndpoint,
            modelsCount: 0,
            models: [],
            message: `الخادم متصل والمفتاح مقبول (HTTP ${res.status} · ${latencyMs}ms عبر ${chatEndpoint}) — هذا المزود لا يعرض قائمة /models تلقائياً، يرجى كتابة اسم النموذج يدوياً`,
          };
        }
      } catch {
        // ignore fallback probe error
      }
    }

    return {
      ok: false,
      status: lastStatus,
      latencyMs: lastLatency,
      endpoint: lastEndpoint,
      modelsCount: 0,
      models: [],
      message: `فشل الاتصال بالخادم (${lastError})`,
      error: lastError,
    };
  }

  async fetchCustomProviderModels(baseUrl: string, apiKey?: string, name?: string): Promise<string[]> {
    const res = await this.fetchCustomProviderModelsWithMeta(baseUrl, apiKey, name);
    return res.models;
  }

  async addCustomProvider(data: { name: string; baseUrl: string; apiKey?: string; models?: string[] }): Promise<CustomUpstreamProvider> {
    if (!Array.isArray(this.config.gateway.customProviders)) this.config.gateway.customProviders = [];
    const id = 'custom_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const normalizedUrl = this.normalizeCustomProviderBaseUrl(data.baseUrl);
    let resolvedModels = Array.isArray(data.models)
      ? data.models.map((m) => String(m).trim()).filter((m) => Boolean(m) && m !== 'default')
      : [];
    if (resolvedModels.length === 0) {
      try {
        resolvedModels = await this.fetchCustomProviderModels(normalizedUrl, data.apiKey);
      } catch {
        // Keep empty if live fetch failed and user didn't enter models manually
        resolvedModels = [];
      }
    }
    const item: CustomUpstreamProvider = {
      id,
      name: data.name.trim() || 'Custom Upstream',
      baseUrl: normalizedUrl,
      apiKey: data.apiKey?.trim() || '',
      models: [...new Set(resolvedModels)],
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    this.config.gateway.customProviders.push(item);
    await this.saveConfig();
    return item;
  }

  async updateCustomProvider(
    id: string,
    patch: { enabled?: boolean; models?: string[]; name?: string; baseUrl?: string; apiKey?: string },
  ): Promise<CustomUpstreamProvider | null> {
    if (!Array.isArray(this.config.gateway.customProviders)) return null;
    const item = this.config.gateway.customProviders.find((p) => p.id === id);
    if (!item) return null;
    if (typeof patch.enabled === 'boolean') item.enabled = patch.enabled;
    if (typeof patch.name === 'string' && patch.name.trim()) item.name = patch.name.trim();
    if (typeof patch.baseUrl === 'string' && patch.baseUrl.trim()) {
      item.baseUrl = this.normalizeCustomProviderBaseUrl(patch.baseUrl);
    }
    if (typeof patch.apiKey === 'string') item.apiKey = patch.apiKey.trim();
    if (Array.isArray(patch.models)) {
      const cleaned = [...new Set(patch.models.map((m) => String(m).trim()).filter((m) => Boolean(m) && m !== 'default'))];
      if (cleaned.length > 0) item.models = cleaned;
    }
    await this.saveConfig();
    return item;
  }

  /**
   * Refreshes a custom (API) provider's model list from the LIVE /models
   * endpoint. The live list REPLACES the stored one so removed models
   * disappear; a failed fetch throws and leaves the stored list untouched.
   */
  async refreshCustomProviderModels(id: string): Promise<CustomUpstreamProvider> {
    if (!Array.isArray(this.config.gateway.customProviders)) {
      throw new Error('Custom provider not found');
    }
    const item = this.config.gateway.customProviders.find((p) => p.id === id);
    if (!item) throw new Error('Custom provider not found');
    const fetched = await this.fetchCustomProviderModels(item.baseUrl, item.apiKey);
    if (fetched.length === 0) {
      throw new Error('The upstream /models endpoint returned an empty model list — the previous list was kept.');
    }
    item.models = [...new Set(fetched)];
    await this.saveConfig();
    return item;
  }

  async deleteCustomProvider(id: string): Promise<boolean> {
    if (!Array.isArray(this.config.gateway.customProviders)) return false;
    const initialLen = this.config.gateway.customProviders.length;
    this.config.gateway.customProviders = this.config.gateway.customProviders.filter((p) => p.id !== id);
    if (this.config.gateway.customProviders.length !== initialLen) {
      await this.saveConfig();
      return true;
    }
    return false;
  }

  async toggleCustomProvider(id: string, enabled: boolean): Promise<CustomUpstreamProvider | null> {
    if (!Array.isArray(this.config.gateway.customProviders)) return null;
    const item = this.config.gateway.customProviders.find((p) => p.id === id);
    if (!item) return null;
    item.enabled = enabled;
    await this.saveConfig();
    return item;
  }

  async close(): Promise<void> {
    for (const id of WEB_PROVIDER_IDS) await this.stop(id).catch(() => {});
  }
}
