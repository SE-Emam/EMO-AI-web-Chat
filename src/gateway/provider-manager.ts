import { chromium } from 'playwright';
import type { ArenaDriver, ChatMessage } from '../types.js';
import type { GatewayConfigFile, ProviderConfig, ProviderRuntimeState, ProviderStatus, WebProviderId } from './types.js';
import { WEB_PROVIDER_IDS } from './types.js';
import { providerSpec } from '../arena/providers.js';
import type { GatewayConfigStore } from './config-store.js';
import { BrowserManager } from '../browser/manager.js';
import { DefaultArenaDriver } from '../arena/driver.js';
import { ZaiWebDriver } from '../arena/zai-web-driver.js';
import { ClaudeWebDriver } from '../arena/claude-web-driver.js';
import { TencentAiWebDriver } from '../arena/tencent-ai-web-driver.js';
import { GeminiWebDriver } from '../arena/gemini-web-driver.js';
import { QwenWebDriver } from '../arena/qwen-web-driver.js';

type Factory = (cfg: ProviderConfig) => ArenaDriver | Promise<ArenaDriver>;

const PROVIDER_META: Record<WebProviderId, { name: string; matches: (model: string) => boolean; defaultFactory: Factory }> = {
  'arena-browser': {
    name: providerSpec('arena-browser').name,
    matches: (_m) => true,
    defaultFactory: (cfg) => {
      const browserManager = new BrowserManager({
        userDataDir: String(cfg.settings.userDataDir || ''),
        arenaBaseUrl: String(cfg.settings.baseUrl || 'https://arena.ai'),
        headless: cfg.settings.headless !== false,
      });
      return new DefaultArenaDriver(browserManager);
    },
  },
  'zai-web': {
    name: providerSpec('zai-web').name,
    matches: (m) => providerSpec('zai-web').prefixes.some((p) => m.startsWith(p)) || m.startsWith('glm-'),
    defaultFactory: (cfg) => new ZaiWebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || 'https://chat.z.ai'),
      headless: cfg.settings.headless === true ? true : false,
      timeoutMs: Number(cfg.settings.timeoutMs || 180000),
      captchaWaitMs: Number(cfg.settings.captchaWaitMs || 180000),
    }),
  },
  'claude-web': {
    name: providerSpec('claude-web').name,
    matches: (m) => providerSpec('claude-web').prefixes.some((p) => m.startsWith(p)),
    defaultFactory: (cfg) => new ClaudeWebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || 'https://claude.ai'),
      headless: cfg.settings.headless === true ? true : false,
      timeoutMs: Number(cfg.settings.timeoutMs || 300000),
    }),
  },
  'tencent-ai-web': {
    name: providerSpec('tencent-ai-web').name,
    matches: (m) => providerSpec('tencent-ai-web').prefixes.some((p) => m.startsWith(p)),
    defaultFactory: (cfg) => new TencentAiWebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || 'https://aistudio.tencent.ai'),
      headless: cfg.settings.headless === true ? true : false,
      timeoutMs: Number(cfg.settings.timeoutMs || 300000),
    }),
  },
  'gemini-web': {
    name: providerSpec('gemini-web').name,
    matches: (m) => providerSpec('gemini-web').prefixes.some((p) => m.startsWith(p)),
    defaultFactory: (cfg) => new GeminiWebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || 'https://gemini.google.com'),
      headless: cfg.settings.headless === true ? true : false,
      timeoutMs: Number(cfg.settings.timeoutMs || 300000),
    }),
  },
  'qwen-web': {
    name: providerSpec('qwen-web').name,
    matches: (m) => providerSpec('qwen-web').prefixes.some((p) => m.startsWith(p)),
    defaultFactory: (cfg) => new QwenWebDriver({
      enabled: true,
      userDataDir: String(cfg.settings.userDataDir || ''),
      baseUrl: String(cfg.settings.baseUrl || 'https://chat.qwen.ai'),
      headless: cfg.settings.headless === true ? true : false,
      timeoutMs: Number(cfg.settings.timeoutMs || 300000),
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

  constructor(opts: { store: GatewayConfigStore; config: GatewayConfigFile; now?: () => number; factories?: Partial<Record<WebProviderId, Factory>> }) {
    this.store = opts.store;
    this.config = opts.config;
    this.now = opts.now ?? (() => Date.now());
    this.factories = opts.factories ?? {};
    for (const id of WEB_PROVIDER_IDS) this.runtimes.set(id, { status: 'stopped', runtimeMsAcc: 0 });
  }

  async init(): Promise<void> {
    // ensure all providers exist in config
    for (const id of WEB_PROVIDER_IDS) if (!this.config.providers[id]) {
      this.config.providers[id] = { enabled: false, settings: {}, availableModels: [], selectedModels: [] };
    }
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

  async saveConfig(): Promise<void> {
    await this.store.save(this.config);
  }

  listStates(): ProviderRuntimeState[] {
    return WEB_PROVIDER_IDS.map((id) => this.getState(id));
  }

  getState(id: WebProviderId): ProviderRuntimeState {
    const cfg = this.providerConfig(id);
    const rt = this.runtime(id);
    const runningMs = rt.startedAt ? this.now() - rt.startedAt : 0;
    return {
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
    };
  }

  async updateProvider(id: WebProviderId, patch: { enabled?: boolean; settings?: Record<string, unknown>; selectedModels?: string[]; availableModels?: string[] }): Promise<ProviderRuntimeState> {
    const cfg = this.providerConfig(id);
    if (patch.enabled != null) cfg.enabled = patch.enabled;
    if (patch.settings) {
      const ALLOWED = new Set(['baseUrl', 'userDataDir', 'headless', 'timeoutMs', 'captchaWaitMs']);
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
          const str = String(s);
          const home = (process.env.HOME || '');
          const canonical = str.startsWith('~/') && home ? home + str.slice(1) : str;
          const expectedPrefix = home ? home + '/.arena-webbridge/' : '/.arena-webbridge/';
          if (canonical !== expectedPrefix.replace(/\/$/, '') && !canonical.startsWith(expectedPrefix)) continue;
          filtered[k] = canonical;
        } else if (k === 'timeoutMs' || k === 'captchaWaitMs') {
          const n = Number(s);
          if (!Number.isFinite(n)) continue;
          filtered[k] = Math.min(600_000, Math.max(1_000, n));
        } else if (k === 'headless') {
          filtered[k] = !!s;
        } else {
          filtered[k] = s;
        }
      }
      cfg.settings = { ...(cfg.settings || {}), ...filtered };
    }
    if (patch.selectedModels) cfg.selectedModels = uniq(patch.selectedModels.map(String).map((s) => s.slice(0, 128))).slice(0, 500);
    if (patch.availableModels) cfg.availableModels = uniq(patch.availableModels.map(String).map((s) => s.slice(0, 128))).slice(0, 500);
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

  async refreshModels(id: WebProviderId): Promise<ProviderRuntimeState> {
    return this.withLock(id, async () => {
      const rt = this.runtime(id);
      const cfg = this.providerConfig(id);
      let driver = rt.driver;
      let temp = false;
      try {
        if (!driver) {
          const factory = this.factories[id] ?? PROVIDER_META[id].defaultFactory;
          driver = await factory(cfg);
          temp = true;
        }
        const listed = await driver.listModels();
        cfg.availableModels = uniq([...(cfg.availableModels || []), ...listed]);
        rt.lastError = undefined;
      } catch (e) {
        rt.lastError = e instanceof Error ? e.message : String(e);
      } finally {
        if (temp) try { await driver?.close?.(); } catch {}
      }
      return this.getState(id);
    });
  }

  private findProviderForModel(model: string): WebProviderId | undefined {
    const cleaned = model.trim().toLowerCase();
    // Prefer specific (non-catch-all) providers first.
    const order: WebProviderId[] = [...WEB_PROVIDER_IDS.filter((id) => id !== 'arena-browser'), 'arena-browser'];
    for (const id of order) {
      const cfg = this.providerConfig(id);
      if (!cfg?.enabled) continue;
      if (!PROVIDER_META[id].matches(cleaned)) continue;
      if ((cfg.selectedModels || []).some((m) => m.toLowerCase() === cleaned || m === model.trim())) return id;
      // also allow selected by raw equality
      if ((cfg.selectedModels || []).includes(model.trim())) return id;
    }
    // if selected somewhere but matching logic missed due to case/prefix details, check all enabled
    for (const id of order) {
      const cfg = this.providerConfig(id);
      if (!cfg?.enabled) continue;
      if ((cfg.selectedModels || []).includes(model.trim())) return id;
    }
    return undefined;
  }

  isModelEnabled(model: string): boolean {
    return this.findProviderForModel(model) != null;
  }

  getActiveDriver(): ArenaDriver {
    return {
      listModels: async () => {
        const out: string[] = [];
        for (const id of WEB_PROVIDER_IDS) {
          const cfg = this.providerConfig(id);
          if (!cfg?.enabled) continue;
          for (const m of cfg.selectedModels || []) if (!out.includes(m)) out.push(m);
        }
        return out;
      },
      sendMessage: async (model: string, messages: ChatMessage[], onChunk?: (chunk: string) => void, signal?: AbortSignal) => {
        const id = this.findProviderForModel(model);
        if (!id) throw new Error(`Model "${model}" is not enabled or not selected in the gateway UI.`);
        const rt = this.runtime(id);
        if (rt.status !== 'running' || !rt.driver) {
          throw new Error(`Provider "${PROVIDER_META[id].name}" is not running. Start it in the gateway UI.`);
        }
        return rt.driver.sendMessage(model, messages, onChunk, signal);
      },
      close: async () => { await this.close(); },
    };
  }

  private loginUrl(id: WebProviderId): string {
    const base = String(this.providerConfig(id).settings.baseUrl || '');
    switch (id) {
      case 'arena-browser': return base || 'https://arena.ai';
      case 'zai-web': return base || 'https://chat.z.ai';
      case 'claude-web': return (base || 'https://claude.ai').replace(/\/$/, '') + '/login';
      case 'tencent-ai-web': return base || 'https://aistudio.tencent.ai/';
      case 'gemini-web': return (base || 'https://gemini.google.com').replace(/\/$/, '') + '/app';
      case 'qwen-web': return base || 'https://chat.qwen.ai/';
    }
  }

  async login(id: WebProviderId): Promise<ProviderRuntimeState> {
    return this.withLock(id, async () => {
      // Stop running driver to release profile lock.
      const rt = this.runtime(id);
      if (rt.startedAt) { rt.runtimeMsAcc += this.now() - rt.startedAt; rt.startedAt = undefined; }
      try { await rt.driver?.close?.(); } catch {}
      rt.driver = undefined;
      rt.status = 'stopped';

      const cfg = this.providerConfig(id);
      const userDataDir = String(cfg.settings.userDataDir || '');
      if (!userDataDir) throw new Error(`Provider ${id} has no userDataDir configured.`);
      const context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chrome',
        headless: false,
        viewport: { width: 1280, height: 900 },
        args: ['--disable-blink-features=AutomationControlled'],
        ignoreDefaultArgs: ['--enable-automation'],
      });
      try {
        const page = context.pages()[0] || await context.newPage();
        await page.goto(this.loginUrl(id), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await Promise.race([
          new Promise<void>((resolve) => context.on('close', () => resolve())),
          new Promise<never>((_rej, reject) => setTimeout(() => reject(new Error('Login timed out after 120s. Close the browser window or retry.')), 120_000)),
        ]);
      } finally {
        try { await context.close(); } catch {}
      }

      cfg.enabled = true;
      // Auto-pull models after login.
      try {
        const factory = this.factories[id] ?? PROVIDER_META[id].defaultFactory;
        const driver = await factory(cfg);
        try {
          const listed = await driver.listModels();
          cfg.availableModels = uniq([...(cfg.availableModels || []), ...listed]);
          if (!cfg.selectedModels?.length) cfg.selectedModels = [...cfg.availableModels];
          rt.lastError = undefined;
        } finally {
          try { await driver.close?.(); } catch {}
        }
      } catch (e) {
        rt.lastError = e instanceof Error ? e.message : String(e);
        // keep enabled; login may have succeeded even if model pull failed
      }
      await this.saveConfig().catch(() => {});
      return this.getState(id);
    });
  }

  async close(): Promise<void> {
    for (const id of WEB_PROVIDER_IDS) await this.stop(id).catch(() => {});
  }
}
