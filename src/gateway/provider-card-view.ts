/**
 * Provider card view model — Providers & Models audit.
 *
 * The card must show ONE coherent truth about a provider, derived from ONE
 * source (the provider state), and never invent a success. This module turns
 * the raw provider state into the exact view model the UI renders:
 *
 *   - which label each button carries (live "Fetch Models" vs "Reload
 *     catalog" vs a disabled "Unsupported"),
 *   - whether the button is disabled and WHY,
 *   - which tone the connection status has,
 *   - the model list with per-item `selected` / `available` flags, so a model
 *     that the provider no longer offers is shown as UNAVAILABLE instead of
 *     being presented as a healthy option.
 *
 * Everything here is pure and unit-tested; the browser script only renders.
 */
import type {
  ModelDiscoverySource,
  ProviderCapabilities,
} from './provider-capabilities.js';
import type { ProviderConnectionStatus } from './provider-connection.js';
import type { ProviderMetaState, ProviderRuntimeState } from './types.js';

export type CardTone = 'ok' | 'warn' | 'error' | 'muted';

export const CONNECTION_STATUS_LABEL_KEYS: Record<ProviderConnectionStatus, string> = {
  connected: 'connStatusConnected',
  authentication_required: 'connStatusAuthenticationRequired',
  rate_limited: 'connStatusRateLimited',
  quota_exhausted: 'connStatusQuotaExhausted',
  provider_unavailable: 'connStatusProviderUnavailable',
  browser_unavailable: 'connStatusBrowserUnavailable',
  timeout: 'connStatusTimeout',
  unsupported: 'connStatusUnsupported',
  unknown: 'connStatusUnknown',
};

export const CONNECTION_STATUS_TONES: Record<ProviderConnectionStatus, CardTone> = {
  connected: 'ok',
  authentication_required: 'warn',
  rate_limited: 'warn',
  quota_exhausted: 'warn',
  provider_unavailable: 'error',
  browser_unavailable: 'error',
  timeout: 'error',
  unsupported: 'muted',
  unknown: 'muted',
};

export const MODEL_SOURCE_LABEL_KEYS: Record<ModelDiscoverySource, string> = {
  'live-api': 'modelsSourceLiveApi',
  'live-web-ui': 'modelsSourceLiveWebUi',
  'web-ui': 'modelsSourceLiveWebUi',
  'web-ui-dom': 'modelsSourceLiveWebUi',
  'web-ui-network': 'modelsSourceLiveWebUi',
  'configured-catalog': 'modelsSourceConfiguredCatalog',
  none: 'modelsSourceNone',
};

export const DISCOVERY_STATUS_LABEL_KEYS: Record<
  'never_scanned' | 'active' | 'unsupported' | 'needs_login' | 'deferred' | 'error',
  string
> = {
  never_scanned: 'discoveryNeverScanned',
  active: 'discoveryActive',
  unsupported: 'discoveryUnsupported',
  needs_login: 'discoveryNeedsLogin',
  deferred: 'discoveryDeferred',
  error: 'discoveryError',
};

export const DISCOVERY_STATUS_TONES: Record<
  'never_scanned' | 'active' | 'unsupported' | 'needs_login' | 'deferred' | 'error',
  CardTone
> = {
  never_scanned: 'muted',
  active: 'ok',
  unsupported: 'muted',
  needs_login: 'warn',
  deferred: 'warn',
  error: 'error',
};

export interface ProviderCardAction {
  /** i18n key of the button label. */
  labelKey: string;
  /** i18n key shown while the action runs. */
  busyLabelKey: string;
  /** The action cannot be executed for this provider. */
  disabled: boolean;
  /** i18n key explaining WHY the action is unavailable. */
  reasonKey?: string;
  /** The action reaches the provider over the network. */
  isLive: boolean;
}

export interface ProviderCardModelItem {
  id: string;
  selected: boolean;
  available: boolean;
}

export interface ProviderCardView {
  refresh: ProviderCardAction;
  test: ProviderCardAction;
  models: {
    sourceLabelKey: string;
    tone: CardTone;
    lastRefreshAt?: string;
    lastRefreshCount?: number;
    lastError?: string;
    items: ProviderCardModelItem[];
    availableCount: number;
    selectedCount: number;
  };
  connection: {
    status?: ProviderConnectionStatus;
    labelKey: string;
    tone: CardTone;
    checkedAt?: string;
    detail?: string;
    detailKey?: string;
    detailParams?: Record<string, string | number>;
    latencyMs?: number;
  };
  /** Live web discovery state (real scans only). */
  discovery: {
    status: 'never_scanned' | 'active' | 'unsupported' | 'needs_login' | 'deferred' | 'error';
    labelKey: string;
    tone: CardTone;
    lastScanAt?: string;
    lastSuccessAt?: string;
    modelCount?: number;
    newModelCount?: number;
    sourceLabelKey?: string;
    failureReason?: string;
    detail?: string;
    unreadChanges: number;
    proven: boolean;
  };
}

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  id: 'unknown',
  name: 'unknown',
  connectionType: 'web',
  modelDiscoveryMode: 'unsupported',
  modelDiscoverySource: 'none',
  canRefreshModels: false,
  isLiveDiscovery: false,
  canTestConnection: false,
  modelsSourceNoteKey: 'modelsSourceNone',
  connectionCheckNoteKey: 'connCheckWebProfile',
};

export function buildRefreshAction(caps: ProviderCapabilities): ProviderCardAction {
  if (!caps.canRefreshModels) {
    return {
      labelKey: 'btnDiscoveryUnsupported',
      busyLabelKey: 'btnWorking',
      disabled: true,
      reasonKey: 'modelsDiscoveryUnsupportedNote',
      isLive: false,
    };
  }
  return {
    labelKey: caps.isLiveDiscovery ? 'btnFetchModelsLive' : 'btnLoadCatalog',
    busyLabelKey: 'btnWorking',
    disabled: false,
    reasonKey: caps.isLiveDiscovery ? undefined : 'modelsCatalogNotLiveNote',
    isLive: caps.isLiveDiscovery,
  };
}

export function buildTestAction(caps: ProviderCapabilities): ProviderCardAction {
  if (!caps.canTestConnection) {
    return {
      labelKey: 'btnTestConnectionUnsupported',
      busyLabelKey: 'btnWorking',
      disabled: true,
      reasonKey: 'connTestUnsupportedNote',
      isLive: true,
    };
  }
  return {
    labelKey: 'btnTestConnection',
    busyLabelKey: 'btnWorking',
    disabled: false,
    isLive: true,
  };
}

/**
 * Builds the model list shown on the card.
 * - `available` = the ids the provider currently offers (from the last
 *   successful discovery).
 * - `selected` = the ids the user picked.
 * - an id that is selected but NOT available is flagged `available: false`
 *   (rendered as "unavailable") instead of silently disappearing or being
 *   presented as a healthy option.
 */
export function buildModelItems(
  availableModels: string[] = [],
  selectedModels: string[] = [],
): { items: ProviderCardModelItem[]; availableCount: number; selectedCount: number } {
  const available = new Set(availableModels);
  const selected = new Set(selectedModels);
  const ids: string[] = [];
  for (const id of [...availableModels, ...selectedModels]) {
    if (typeof id !== 'string' || !id) continue;
    if (!ids.includes(id)) ids.push(id);
  }
  const items = ids.map((id) => ({
    id,
    selected: selected.has(id),
    available: available.has(id),
  }));
  return {
    items,
    availableCount: available.size,
    selectedCount: items.filter((i) => i.selected).length,
  };
}

/** Derives the models section of the card from the persisted meta + lists. */
export function buildModelsSection(
  meta: ProviderMetaState | undefined,
  availableModels: string[],
  selectedModels: string[],
): ProviderCardView['models'] {
  const source: ModelDiscoverySource = meta?.modelsSource || 'none';
  const { items, availableCount, selectedCount } = buildModelItems(availableModels, selectedModels);
  const tone: CardTone = meta?.lastModelsError
    ? 'error'
    : source === 'none'
      ? 'muted'
      : source === 'configured-catalog'
        ? 'warn'
        : 'ok';
  return {
    sourceLabelKey: MODEL_SOURCE_LABEL_KEYS[source] || MODEL_SOURCE_LABEL_KEYS.none,
    tone,
    lastRefreshAt: meta?.lastModelsRefreshAt,
    lastRefreshCount: meta?.lastModelsRefreshCount,
    lastError: meta?.lastModelsError,
    items,
    availableCount,
    selectedCount,
  };
}

/** Derives the connection section of the card. */
export function buildConnectionSection(
  meta: ProviderMetaState | undefined,
  connection?: {
    status?: ProviderConnectionStatus;
    checkedAt?: string;
    detail?: string;
    detailKey?: string;
    detailParams?: Record<string, string | number>;
    latencyMs?: number;
  },
): ProviderCardView['connection'] {
  const status = connection?.status || meta?.lastConnectionStatus;
  const labelKey = status
    ? CONNECTION_STATUS_LABEL_KEYS[status] || CONNECTION_STATUS_LABEL_KEYS.unknown
    : 'connStatusNeverChecked';
  const tone: CardTone = status ? CONNECTION_STATUS_TONES[status] || 'muted' : 'muted';
  return {
    status,
    labelKey,
    tone,
    checkedAt: connection?.checkedAt || meta?.lastConnectionCheckAt,
    detail: connection?.detail || meta?.lastConnectionDetail,
    detailKey: connection?.detailKey,
    detailParams: connection?.detailParams,
    latencyMs: connection?.latencyMs ?? meta?.lastConnectionLatencyMs,
  };
}

/** Builds the complete card view model for one provider. */
export function buildProviderCardView(state: ProviderRuntimeState): ProviderCardView {
  const caps = state.capabilities || DEFAULT_CAPABILITIES;
  const discovery = state.discovery;
  const discoveryStatus = discovery?.status ?? 'never_scanned';
  return {
    refresh: buildRefreshAction(caps),
    test: buildTestAction(caps),
    models: buildModelsSection(state.meta, state.availableModels || [], state.selectedModels || []),
    connection: buildConnectionSection(state.meta, state.connection),
    discovery: {
      status: discoveryStatus,
      labelKey: DISCOVERY_STATUS_LABEL_KEYS[discoveryStatus] || DISCOVERY_STATUS_LABEL_KEYS.never_scanned,
      tone: DISCOVERY_STATUS_TONES[discoveryStatus] || 'muted',
      lastScanAt: discovery?.lastScanAt,
      lastSuccessAt: discovery?.lastSuccessAt,
      modelCount: discovery?.modelCount,
      newModelCount: discovery?.newModelCount,
      sourceLabelKey: discovery?.source ? MODEL_SOURCE_LABEL_KEYS[discovery.source as ModelDiscoverySource] : undefined,
      failureReason: discovery?.failureReason,
      detail: discovery?.detail,
      unreadChanges: discovery?.unreadChanges || 0,
      proven: discovery?.proven ?? false,
    },
  };
}
