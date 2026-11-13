import type { ArenaDriver } from '../types.js';
import type { ProviderCapabilities } from './provider-capabilities.js';
import type { ProviderCardView } from './provider-card-view.js';
import type { ProviderConnectionReport, ProviderConnectionStatus } from './provider-connection.js';
import type { ModelDiscoveryMode, ModelDiscoverySource } from './provider-capabilities.js';

export type WebProviderId =
  | 'arena-browser'
  | 'zai-web'
  | 'claude-web'
  | 'tencent-ai-web'
  | 'gemini-web'
  | 'qwen-web'
  | 'chatgpt-web'
  | 'grok-web'
  | 'kimi-web'
  | 'minimax-web'
  | 'longcat-web'
  | 'llm7-web'
  | 'kiwi-web'
  | 'deepseek-web'
  | 'mistral-web';

export const WEB_PROVIDER_IDS: WebProviderId[] = [
  'arena-browser',
  'zai-web',
  'claude-web',
  'tencent-ai-web',
  'gemini-web',
  'qwen-web',
  'chatgpt-web',
  'grok-web',
  'kimi-web',
  'minimax-web',
  'longcat-web',
  'llm7-web',
  'kiwi-web',
  'deepseek-web',
  'mistral-web',
];

export type ProviderStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface ProviderAccount {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  isLoggedIn: boolean;
  active: boolean;
  enabled?: boolean;
  userDataDir?: string;
  addedAt?: string;
  lastLoginAt?: string;
}

export interface ProviderAuthInfo {
  isLoggedIn: boolean;
  accountName?: string;
  accountEmail?: string;
  avatarUrl?: string;
  lastLoginAt?: string;
  lastCheckedAt?: string;
  authMethod?: string;
}

export interface ProviderConfig {
  enabled: boolean;
  settings: Record<string, unknown>;
  availableModels: string[];
  selectedModels: string[];
  auth?: ProviderAuthInfo;
  accounts?: ProviderAccount[];
  activeAccountId?: string;
  /**
   * Persisted, verified facts about this provider (not guesses):
   * where the model list came from, when it was last refreshed, and the
   * outcome + timestamp of the last real connection check.
   */
  meta?: ProviderMetaState;
}

/**
 * The persisted half of the unified provider state. Every field is written
 * ONLY by a real operation (a discovery attempt or a connection probe) —
 * never by the UI and never optimistically.
 */
export interface ProviderMetaState {
  /** Where the stored model list actually came from. */
  modelsSource?: ModelDiscoverySource;
  /** The discovery mode that produced the stored list. */
  modelsDiscoveryMode?: ModelDiscoveryMode;
  /** ISO timestamp of the last discovery ATTEMPT (successful or not). */
  lastModelsRefreshAt?: string;
  /** Number of models the last successful discovery returned. */
  lastModelsRefreshCount?: number;
  /** Secret-free reason of the last failed discovery. */
  lastModelsError?: string;
  /** ISO timestamp of the last real connection check. */
  lastConnectionCheckAt?: string;
  /** Status of the last real connection check. */
  lastConnectionStatus?: ProviderConnectionStatus;
  /** Secret-free detail of the last real connection check. */
  lastConnectionDetail?: string;
  /** Latency of the last real connection check (ms). */
  lastConnectionLatencyMs?: number;
}

export interface ApiKeyItem {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  lastUsedAt?: string;
  enabled: boolean;
}

export interface CustomUpstreamProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  models: string[];
  createdAt: string;
}

export interface CustomAgent {
  id: string;
  name: string;
  icon?: string;
  protocol: 'openai' | 'anthropic' | 'gemini';
  command?: string;
  configPath?: string;
  notes?: string;
  createdAt: string;
}

export interface DetectedAgent {
  id: string;
  name: string;
  icon: string;
  installed: boolean;
  path?: string;
  configPath?: string;
  isConfigured?: boolean;
  canAutoConfigure?: boolean;
  protocol?: 'openai' | 'anthropic' | 'gemini';
  category?: 'ide' | 'agent' | 'app' | 'cli' | 'custom';
  isCustom?: boolean;
}

export interface GatewaySettings {
  port: number;
  host: string;
  baseUriDisplay: string;
  apiKey: string;
  requireApiKey: boolean;
  serviceEnabled?: boolean;
  apiKeys?: ApiKeyItem[];
  customProviders?: CustomUpstreamProvider[];
  customAgents?: CustomAgent[];
}

export interface UiSettings {
  heartbeatTimeoutMs: number;
  /** Live web model discovery scheduler. */
  discovery?: DiscoverySettings;
}

export interface DiscoverySettings {
  /** Master switch for the automatic discovery sweep. */
  enabled: boolean;
  /** Interval between two sweeps (default 12h). */
  intervalMs: number;
  /** How many providers may be scanned concurrently (default 1). */
  concurrency: number;
  /** Per-provider scan timeout. */
  timeoutMs: number;
}

export type RouterTargetKind = 'web' | 'custom';

export interface RouterGroupTarget {
  id: string;
  kind: RouterTargetKind;
  providerId: string; // WebProviderId or custom provider id
  model: string;
  accountId?: string; // optional pinned account for web providers
}

export interface RouterGroup {
  id: string;
  name: string; // exposed as model name
  icon?: string;
  enabled: boolean;
  strategy: 'sequential' | 'round-robin';
  targets: RouterGroupTarget[];
  /** Per-group API key (auto-generated). Scoped: requests with this key are routed to this group. */
  apiKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayConfigFile {
  version: 1;
  gateway: GatewaySettings;
  ui: UiSettings;
  providers: Record<WebProviderId, ProviderConfig>;
  routerGroups?: RouterGroup[];
}

/**
 * The live-discovery state of a provider, as shown on its card.
 * Every field is written by a REAL scan — never by the UI.
 */
export type ProviderDiscoveryStatus =
  | 'never_scanned'
  | 'active'
  | 'unsupported'
  | 'needs_login'
  | 'deferred'
  | 'error';

export interface ProviderDiscoveryState {
  status: ProviderDiscoveryStatus;
  /** ISO timestamp of the last scan attempt (successful or not). */
  lastScanAt?: string;
  /** ISO timestamp of the last successful scan. */
  lastSuccessAt?: string;
  /** How many models the last successful scan found. */
  modelCount?: number;
  /** How many models are new since the previous scan. */
  newModelCount?: number;
  /** Where the model list came from (e.g. 'web-ui-dom'). */
  source?: string;
  /** Why the last scan failed (if it did). */
  failureReason?: string;
  /** Secret-free explanation of the last scan. */
  detail?: string;
  /** Unread change notifications for this provider. */
  unreadChanges?: number;
  /** True when the provider's discovery strategy is proven to work. */
  proven: boolean;
}

export interface ProviderRuntimeState {
  id: WebProviderId;
  name: string;
  status: ProviderStatus;
  enabled: boolean;
  startedAt?: string;
  lastStartedAt?: string;
  lastStoppedAt?: string;
  runtimeMs: number;
  lastError?: string;
  availableModels: string[];
  selectedModels: string[];
  settings: Record<string, unknown>;
  auth?: ProviderAuthInfo;
  isLoggedIn?: boolean;
  accountName?: string;
  accountEmail?: string;
  accounts?: ProviderAccount[];
  activeAccountId?: string;
  latencyMs?: number;
  requestCount?: number;
  /** Declared capabilities of this provider (what its buttons can really do). */
  capabilities?: ProviderCapabilities;
  /** Persisted, verified provider facts. */
  meta?: ProviderMetaState;
  /** The outcome of the last real connection check (in-memory, freshest). */
  connection?: ProviderConnectionReport;
  /** The rendered view model for this provider's card (one source of truth). */
  card?: ProviderCardView;
  /** The live-discovery state (real scans only). */
  discovery?: ProviderDiscoveryState;
}

export interface UsageCounters {
  requests: number;
  chatRequests: number;
  streamRequests: number;
  completions: number;
  errors: number;
  promptChars: number;
  completionChars: number;
}

export interface UsageSnapshot {
  gatewayStartedAt: string;
  sessionActive: boolean;
  sessionResetAt?: string;
  lastHeartbeatAt?: string;
  lifetime: UsageCounters;
  session: UsageCounters;
}

export interface GatewayContext {
  store: import('./config-store.js').GatewayConfigStore;
  config: GatewayConfigFile;
  manager: import('./provider-manager.js').ProviderManager;
  tracker: import('./usage-tracker.js').UsageTracker;
}

export type ManagedDriverFactory = () => ArenaDriver;
