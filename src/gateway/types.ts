import type { ArenaDriver } from '../types.js';

export type WebProviderId =
  | 'arena-browser'
  | 'zai-web'
  | 'claude-web'
  | 'tencent-ai-web'
  | 'gemini-web'
  | 'qwen-web';

export const WEB_PROVIDER_IDS: WebProviderId[] = [
  'arena-browser',
  'zai-web',
  'claude-web',
  'tencent-ai-web',
  'gemini-web',
  'qwen-web',
];

export type ProviderStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface ProviderConfig {
  enabled: boolean;
  settings: Record<string, unknown>;
  availableModels: string[];
  selectedModels: string[];
}

export interface GatewaySettings {
  port: number;
  host: string;
  baseUriDisplay: string;
  apiKey: string;
  requireApiKey: boolean;
}

export interface UiSettings {
  heartbeatTimeoutMs: number;
}

export interface GatewayConfigFile {
  version: 1;
  gateway: GatewaySettings;
  ui: UiSettings;
  providers: Record<WebProviderId, ProviderConfig>;
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
