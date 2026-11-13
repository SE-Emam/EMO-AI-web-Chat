/**
 * Provider Capability Contract — Providers & Models audit.
 *
 * ONE declarative source of truth for what a provider can actually do:
 *
 *   connectionType        'web'  → persistent Chrome profile + website scraping
 *                         'api'  → OpenAI/Anthropic/Gemini-compatible HTTP API
 *
 *   modelDiscoveryMode    'api'              → live discovery against the provider's
 *                                            own models endpoint (HTTP, cheap)
 *                         'web-ui'           → live discovery by reading the
 *                                            provider's model picker in the web UI
 *                         'configured-catalog'→ NO live endpoint exists; the list is
 *                                            the adapter's declared catalog
 *                         'unsupported'      → no discovery at all
 *
 * The contract exists so the UI never has to invent a success state:
 * a provider that cannot be discovered LIVE says so, and the button either
 * performs a real operation (catalog re-sync) or is explicitly disabled.
 *
 * IMPORTANT (honesty rule): `canRefreshModels` means "the refresh button
 * performs a REAL, verifiable operation". It does NOT mean "live discovery".
 * `isLiveDiscovery` is the separate, explicit flag for that.
 */
import type { WebProviderId } from './types.js';
import { WEB_PROVIDER_IDS } from './types.js';

export type ProviderConnectionType = 'web' | 'api';

export type ModelDiscoveryMode =
  | 'api'
  | 'web-ui'
  | 'web-ui-live-discovery'
  | 'configured-catalog'
  | 'unsupported';

export type ModelDiscoverySource =
  | 'live-api'
  | 'live-web-ui'
  | 'web-ui'
  | 'web-ui-dom'
  | 'web-ui-network'
  | 'configured-catalog'
  | 'none';

export interface ProviderCapabilities {
  id: string;
  /** Display name (mirrors the provider registry name). */
  name: string;
  /** How this provider is reached. */
  connectionType: ProviderConnectionType;
  /** How (or whether) models can be discovered. */
  modelDiscoveryMode: ModelDiscoveryMode;
  /** Where the currently displayed model list actually comes from. */
  modelDiscoverySource: ModelDiscoverySource;
  /** The refresh button performs a real, verifiable operation. */
  canRefreshModels: boolean;
  /** The refresh reaches the provider over the network. */
  isLiveDiscovery: boolean;
  /** A real connection probe can be executed for this provider. */
  canTestConnection: boolean;
  /** i18n key: where the model list comes from. */
  modelsSourceNoteKey: string;
  /** i18n key: how the connection is verified. */
  connectionCheckNoteKey: string;
}

/**
 * Every registered WEB provider today drives a persistent Chrome profile.
 * The contract declares them as `web-ui-live-discovery`: their model list is
 * read from the PROVIDER'S OWN WEBSITE during an authorized browser session
 * (the provider's model picker and/or the model request the provider's own
 * page makes), never from a static catalog.
 *
 * A provider whose discovery could not be proven yet still reports the
 * failure honestly (`model_picker_not_found`, `discovery_unsupported`, …)
 * instead of silently serving a static list.
 *
 * A provider with a real discovery endpoint must be declared explicitly here
 * (`modelDiscoveryMode: 'api'`) — never silently assumed.
 */
const WEB_PROVIDER_CAPABILITIES: Record<WebProviderId, Omit<ProviderCapabilities, 'id' | 'name'>> = {
  'arena-browser': {
    connectionType: 'web',
    modelDiscoveryMode: 'web-ui-live-discovery',
    modelDiscoverySource: 'web-ui',
    canRefreshModels: true,
    isLiveDiscovery: true,
    canTestConnection: true,
    modelsSourceNoteKey: 'modelsSourceConfiguredCatalog',
    connectionCheckNoteKey: 'connCheckWebProfile',
  },
  'zai-web': {
    connectionType: 'web',
    modelDiscoveryMode: 'web-ui-live-discovery',
    modelDiscoverySource: 'web-ui',
    canRefreshModels: true,
    isLiveDiscovery: true,
    canTestConnection: true,
    modelsSourceNoteKey: 'modelsSourceConfiguredCatalog',
    connectionCheckNoteKey: 'connCheckWebProfile',
  },
  'claude-web': {
    connectionType: 'web',
    modelDiscoveryMode: 'web-ui-live-discovery',
    modelDiscoverySource: 'web-ui',
    canRefreshModels: true,
    isLiveDiscovery: true,
    canTestConnection: true,
    modelsSourceNoteKey: 'modelsSourceConfiguredCatalog',
    connectionCheckNoteKey: 'connCheckWebProfile',
  },
  'tencent-ai-web': {
    connectionType: 'web',
    modelDiscoveryMode: 'web-ui-live-discovery',
    modelDiscoverySource: 'web-ui',
    canRefreshModels: true,
    isLiveDiscovery: true,
    canTestConnection: true,
    modelsSourceNoteKey: 'modelsSourceConfiguredCatalog',
    connectionCheckNoteKey: 'connCheckWebProfile',
  },
  'gemini-web': {
    connectionType: 'web',
    modelDiscoveryMode: 'web-ui-live-discovery',
    modelDiscoverySource: 'web-ui',
    canRefreshModels: true,
    isLiveDiscovery: true,
    canTestConnection: true,
    modelsSourceNoteKey: 'modelsSourceConfiguredCatalog',
    connectionCheckNoteKey: 'connCheckWebProfile',
  },
  'qwen-web': {
    connectionType: 'web',
    modelDiscoveryMode: 'web-ui-live-discovery',
    modelDiscoverySource: 'web-ui',
    canRefreshModels: true,
    isLiveDiscovery: true,
    canTestConnection: true,
    modelsSourceNoteKey: 'modelsSourceConfiguredCatalog',
    connectionCheckNoteKey: 'connCheckWebProfile',
  },
  'chatgpt-web': {
    connectionType: 'web',
    modelDiscoveryMode: 'web-ui-live-discovery',
    modelDiscoverySource: 'web-ui',
    canRefreshModels: true,
    isLiveDiscovery: true,
    canTestConnection: true,
    modelsSourceNoteKey: 'modelsSourceConfiguredCatalog',
    connectionCheckNoteKey: 'connCheckWebProfile',
  },
  'grok-web': {
    connectionType: 'web',
    modelDiscoveryMode: 'web-ui-live-discovery',
    modelDiscoverySource: 'web-ui',
    canRefreshModels: true,
    isLiveDiscovery: true,
    canTestConnection: true,
    modelsSourceNoteKey: 'modelsSourceConfiguredCatalog',
    connectionCheckNoteKey: 'connCheckWebProfile',
  },
  'kimi-web': {
    connectionType: 'web',
    modelDiscoveryMode: 'web-ui-live-discovery',
    modelDiscoverySource: 'web-ui',
    canRefreshModels: true,
    isLiveDiscovery: true,
    canTestConnection: true,
    modelsSourceNoteKey: 'modelsSourceConfiguredCatalog',
    connectionCheckNoteKey: 'connCheckWebProfile',
  },
  'minimax-web': {
    connectionType: 'web',
    modelDiscoveryMode: 'web-ui-live-discovery',
    modelDiscoverySource: 'web-ui',
    canRefreshModels: true,
    isLiveDiscovery: true,
    canTestConnection: true,
    modelsSourceNoteKey: 'modelsSourceConfiguredCatalog',
    connectionCheckNoteKey: 'connCheckWebProfile',
  },
  'longcat-web': {
    connectionType: 'web',
    modelDiscoveryMode: 'web-ui-live-discovery',
    modelDiscoverySource: 'web-ui',
    canRefreshModels: true,
    isLiveDiscovery: true,
    canTestConnection: true,
    modelsSourceNoteKey: 'modelsSourceConfiguredCatalog',
    connectionCheckNoteKey: 'connCheckWebProfile',
  },
  'llm7-web': {
    connectionType: 'web',
    modelDiscoveryMode: 'web-ui-live-discovery',
    modelDiscoverySource: 'web-ui',
    canRefreshModels: true,
    isLiveDiscovery: true,
    canTestConnection: true,
    modelsSourceNoteKey: 'modelsSourceConfiguredCatalog',
    connectionCheckNoteKey: 'connCheckWebProfile',
  },
  'kiwi-web': {
    connectionType: 'web',
    modelDiscoveryMode: 'web-ui-live-discovery',
    modelDiscoverySource: 'web-ui',
    canRefreshModels: true,
    isLiveDiscovery: true,
    canTestConnection: true,
    modelsSourceNoteKey: 'modelsSourceConfiguredCatalog',
    connectionCheckNoteKey: 'connCheckWebProfile',
  },
  'deepseek-web': {
    connectionType: 'web',
    modelDiscoveryMode: 'web-ui-live-discovery',
    modelDiscoverySource: 'web-ui',
    canRefreshModels: true,
    isLiveDiscovery: true,
    canTestConnection: true,
    modelsSourceNoteKey: 'modelsSourceConfiguredCatalog',
    connectionCheckNoteKey: 'connCheckWebProfile',
  },
  'mistral-web': {
    connectionType: 'web',
    modelDiscoveryMode: 'web-ui-live-discovery',
    modelDiscoverySource: 'web-ui',
    canRefreshModels: true,
    isLiveDiscovery: true,
    canTestConnection: true,
    modelsSourceNoteKey: 'modelsSourceConfiguredCatalog',
    connectionCheckNoteKey: 'connCheckWebProfile',
  },
};

const NAMES: Record<WebProviderId, string> = {
  'arena-browser': 'Arena Web',
  'zai-web': 'ZAI Web',
  'claude-web': 'Claude Web',
  'tencent-ai-web': 'Tencent web',
  'gemini-web': 'Gemini Web',
  'qwen-web': 'Qwen Web',
  'chatgpt-web': 'ChatGPT Web',
  'grok-web': 'Grok Web',
  'kimi-web': 'Kimi Web',
  'minimax-web': 'MiniMax Web',
  'longcat-web': 'LongCat Web',
  'llm7-web': 'LLM7 Web',
  'kiwi-web': 'LLM Kiwi Web',
  'deepseek-web': 'DeepSeek Web',
  'mistral-web': 'Mistral Web',
};

const CAPABILITIES: Record<string, ProviderCapabilities> = {};
for (const id of WEB_PROVIDER_IDS) {
  const base = WEB_PROVIDER_CAPABILITIES[id];
  if (!base) {
    // A registered provider without a declared capability would make the UI
    // guess. Fail loudly at import time instead of shipping a fake button.
    throw new Error(`Provider capabilities missing for registered provider: ${id}`);
  }
  CAPABILITIES[id] = { id, name: NAMES[id] ?? id, ...base };
}

export function getProviderCapabilities(id: string): ProviderCapabilities {
  const found = CAPABILITIES[id];
  if (found) return found;
  // Unknown/custom provider ids are API upstreams by definition (they carry a
  // baseUrl + apiKey) — they use the live /models endpoint.
  return {
    id,
    name: id,
    connectionType: 'api',
    modelDiscoveryMode: 'api',
    modelDiscoverySource: 'live-api',
    canRefreshModels: true,
    isLiveDiscovery: true,
    canTestConnection: true,
    modelsSourceNoteKey: 'modelsSourceLiveApi',
    connectionCheckNoteKey: 'connCheckApiHealth',
  };
}

export function listProviderCapabilities(): ProviderCapabilities[] {
  return WEB_PROVIDER_IDS.map((id) => CAPABILITIES[id]);
}

/** True when the provider's models are fetched from the provider over the network. */
export function isLiveDiscoveryProvider(id: string): boolean {
  return getProviderCapabilities(id).isLiveDiscovery;
}
