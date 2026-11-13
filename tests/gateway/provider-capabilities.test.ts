import { describe, it, expect } from 'vitest';
import { WEB_PROVIDER_IDS, type WebProviderId } from '../../src/gateway/types.js';
import { WEB_PROVIDERS } from '../../src/arena/providers.js';
import {
  getProviderCapabilities,
  listProviderCapabilities,
  isLiveDiscoveryProvider,
} from '../../src/gateway/provider-capabilities.js';
import {
  buildProviderCardView,
  buildModelItems,
  buildRefreshAction,
  buildTestAction,
  CONNECTION_STATUS_LABEL_KEYS,
  MODEL_SOURCE_LABEL_KEYS,
} from '../../src/gateway/provider-card-view.js';

describe('Provider Capability Contract', () => {
  it('declares a capability for EVERY registered provider (no provider can be forgotten)', () => {
    expect(WEB_PROVIDER_IDS.length).toBeGreaterThan(0);
    for (const id of WEB_PROVIDER_IDS) {
      const caps = getProviderCapabilities(id);
      expect(caps, id).toBeTruthy();
      expect(caps.id).toBe(id);
      expect(caps.name).toBeTruthy();
      expect(['web', 'api']).toContain(caps.connectionType);
      expect(['api', 'web-ui', 'web-ui-live-discovery', 'configured-catalog', 'unsupported']).toContain(caps.modelDiscoveryMode);
      expect(typeof caps.canRefreshModels).toBe('boolean');
      expect(typeof caps.canTestConnection).toBe('boolean');
      expect(typeof caps.isLiveDiscovery).toBe('boolean');
      expect(caps.modelsSourceNoteKey).toBeTruthy();
      expect(caps.connectionCheckNoteKey).toBeTruthy();
    }
    expect(listProviderCapabilities().length).toBe(WEB_PROVIDER_IDS.length);
  });

  it('covers exactly the providers in the web registry', () => {
    const registryIds = WEB_PROVIDERS.map((p) => p.id).sort();
    expect(listProviderCapabilities().map((c) => c.id).sort()).toEqual(registryIds);
  });

  it('declares EVERY web provider as a live web-UI discovery provider', () => {
    for (const id of WEB_PROVIDER_IDS) {
      const caps = getProviderCapabilities(id);
      // No web provider may fall back to a static catalog any more.
      expect(caps.modelDiscoveryMode, id).toBe('web-ui-live-discovery');
      expect(caps.modelDiscoverySource, id).toBe('web-ui');
      expect(caps.isLiveDiscovery, id).toBe(true);
      expect(caps.canRefreshModels, id).toBe(true);
    }
    expect(isLiveDiscoveryProvider('gemini-web')).toBe(true);
  });

  it('treats an unknown/custom (API) provider as a live /models provider', () => {
    const caps = getProviderCapabilities('custom_abc');
    expect(caps.connectionType).toBe('api');
    expect(caps.modelDiscoveryMode).toBe('api');
    expect(caps.isLiveDiscovery).toBe(true);
    expect(caps.canRefreshModels).toBe(true);
    expect(caps.canTestConnection).toBe(true);
  });

  it('builds a card view for EVERY registered provider with an enabled, labelled action', () => {
    for (const id of WEB_PROVIDER_IDS) {
      const caps = getProviderCapabilities(id);
      const view = buildProviderCardView({
        id,
        name: caps.name,
        status: 'stopped',
        enabled: false,
        runtimeMs: 0,
        availableModels: [],
        selectedModels: [],
        settings: {},
        capabilities: caps,
      } as any);
      expect(view.refresh.labelKey, id).toBeTruthy();
      expect(view.test.labelKey, id).toBeTruthy();
      expect(view.models.sourceLabelKey, id).toBeTruthy();
      expect(view.connection.labelKey, id).toBeTruthy();
      expect(view.refresh.disabled, id).toBe(false);
      expect(view.test.disabled, id).toBe(false);
    }
  });

  it('disables and explains the refresh action when discovery is unsupported', () => {
    const action = buildRefreshAction({
      id: 'x',
      name: 'x',
      connectionType: 'web',
      modelDiscoveryMode: 'unsupported',
      modelDiscoverySource: 'none',
      canRefreshModels: false,
      isLiveDiscovery: false,
      canTestConnection: true,
      modelsSourceNoteKey: 'modelsSourceNone',
      connectionCheckNoteKey: 'connCheckWebProfile',
    });
    expect(action.disabled).toBe(true);
    expect(action.labelKey).toBe('btnDiscoveryUnsupported');
    expect(action.reasonKey).toBeTruthy();
  });

  it('marks a selected-but-unavailable model as unavailable (never as a healthy option)', () => {
    const { items, availableCount, selectedCount } = buildModelItems(
      ['a', 'b'],
      ['b', 'gone'],
    );
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'gone']);
    expect(items.find((i) => i.id === 'gone')?.available).toBe(false);
    expect(items.find((i) => i.id === 'gone')?.selected).toBe(true);
    expect(items.find((i) => i.id === 'a')?.available).toBe(true);
    expect(availableCount).toBe(2);
    expect(selectedCount).toBe(2);
  });

  it('maps every connection status to a distinct label and tone', () => {
    const statuses = [
      'connected',
      'authentication_required',
      'rate_limited',
      'quota_exhausted',
      'provider_unavailable',
      'browser_unavailable',
      'timeout',
      'unsupported',
      'unknown',
    ] as const;
    const labels = new Set<string>();
    for (const s of statuses) {
      expect(CONNECTION_STATUS_LABEL_KEYS[s], s).toBeTruthy();
      labels.add(CONNECTION_STATUS_LABEL_KEYS[s]);
    }
    expect(labels.size).toBe(statuses.length);
  });

  it('maps every model discovery source to a distinct label', () => {
    expect(MODEL_SOURCE_LABEL_KEYS['configured-catalog']).toBe('modelsSourceConfiguredCatalog');
    expect(MODEL_SOURCE_LABEL_KEYS['live-api']).toBe('modelsSourceLiveApi');
    expect(MODEL_SOURCE_LABEL_KEYS.none).toBe('modelsSourceNone');
  });
});
