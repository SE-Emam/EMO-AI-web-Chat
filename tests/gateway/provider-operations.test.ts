import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WEB_PROVIDER_IDS, type WebProviderId } from '../../src/gateway/types.js';
import { GatewayConfigStore, defaultGatewayConfig } from '../../src/gateway/config-store.js';
import { ProviderManager } from '../../src/gateway/provider-manager.js';
import type { ProviderConnectionReport } from '../../src/gateway/provider-connection.js';
import type { ArenaDriver, ChatMessage } from '../../src/types.js';

function fakeDriver(models: string[]): ArenaDriver {
  return {
    async listModels() {
      return models;
    },
    async sendMessage(_m: string, _msg: ChatMessage[]) {
      return '';
    },
    async close() {},
  } as ArenaDriver;
}

function report(status: ProviderConnectionReport['status']): ProviderConnectionReport {
  return {
    providerId: 'x',
    status,
    labelKey: 'connStatusUnknown',
    tone: 'muted',
    checkedAt: '2026-11-12T12:00:00.000Z',
    latencyMs: 7,
    detail: 'probe result',
    signals: {
      providerSiteReachable: status === 'connected',
      browserAvailable: true,
      profilePresent: true,
      authenticated: status === 'connected',
      driverRunning: false,
      selectedModelAvailable: true,
      gatewayReachable: true,
    },
  };
}

describe('Provider operations (refresh + connection) across EVERY registered provider', () => {
  let dir: string;
  let store: GatewayConfigStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prov-ops-'));
    store = new GatewayConfigStore(path.join(dir, 'gateway.json'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('has a working refresh for EVERY registered provider (replaces the list, keeps a valid selection)', async () => {
    const config = defaultGatewayConfig();
    const factories: any = {};
    for (const id of WEB_PROVIDER_IDS) {
      factories[id] = () => fakeDriver([`${id}:alpha`, `${id}:beta`]);
      config.providers[id].availableModels = [`${id}:alpha`, `${id}:old-stale`];
      config.providers[id].selectedModels = [`${id}:alpha`, `${id}:old-stale`];
    }
    const mgr = new ProviderManager({ store, config, factories });
    await mgr.init();

    for (const id of WEB_PROVIDER_IDS) {
      const outcome = await mgr.refreshModelsReport(id as WebProviderId);
      expect(outcome.ok, id).toBe(true);
      expect(outcome.models, id).toEqual([`${id}:alpha`, `${id}:beta`]);
      expect(outcome.models, id).not.toContain(`${id}:old-stale`);
      expect(outcome.keptSelected, id).toEqual([`${id}:alpha`]);
      expect(outcome.droppedSelected, id).toEqual([`${id}:old-stale`]);

      const state = mgr.getState(id as WebProviderId);
      expect(state.availableModels, id).toEqual([`${id}:alpha`, `${id}:beta`]);
      expect(state.selectedModels, id).toEqual([`${id}:alpha`]);
      expect(state.meta?.modelsSource, id).toBe('configured-catalog');
      expect(state.meta?.lastModelsRefreshAt, id).toBeTruthy();
      expect(state.meta?.lastModelsRefreshCount, id).toBe(2);
      expect(state.meta?.lastModelsError, id).toBeUndefined();
    }
  });

  it('persists the REAL connection outcome (status + timestamp) for every provider', async () => {
    const config = defaultGatewayConfig();
    const mgr = new ProviderManager({
      store,
      config,
      factories: {} as any,
      connectionProbe: async (opts) => ({ ...report('authentication_required'), providerId: opts.providerId }),
    });
    await mgr.init();

    for (const id of WEB_PROVIDER_IDS) {
      const res = await mgr.checkConnection(id as WebProviderId);
      expect(res.status, id).toBe('authentication_required');
      const state = mgr.getState(id as WebProviderId);
      expect(state.meta?.lastConnectionStatus, id).toBe('authentication_required');
      expect(state.meta?.lastConnectionCheckAt, id).toBeTruthy();
      expect(state.card?.connection.status, id).toBe('authentication_required');
      expect(state.card?.connection.labelKey, id).toBe('connStatusAuthenticationRequired');
    }
  });

  it('never reports ok=true for a provider that is not actually connected', async () => {
    const config = defaultGatewayConfig();
    const mgr = new ProviderManager({
      store,
      config,
      factories: {} as any,
      connectionProbe: async (opts) => ({ ...report('provider_unavailable'), providerId: opts.providerId }),
    });
    await mgr.init();
    const res = await mgr.ping('gemini-web');
    expect(res.ok).toBe(false);
    expect(res.report.status).toBe('provider_unavailable');
  });

  it('reports ok=true only for a verified connected provider', async () => {
    const config = defaultGatewayConfig();
    const mgr = new ProviderManager({
      store,
      config,
      factories: {} as any,
      connectionProbe: async (opts) => ({ ...report('connected'), providerId: opts.providerId }),
    });
    await mgr.init();
    const res = await mgr.ping('gemini-web');
    expect(res.ok).toBe(true);
    expect(res.latencyMs).toBe(7);
  });

  it('keeps the previous model list when the discovery fails, for every provider', async () => {
    const config = defaultGatewayConfig();
    const factories: any = {};
    for (const id of WEB_PROVIDER_IDS) {
      factories[id] = () => ({
        async listModels() {
          throw new Error('ui selector changed');
        },
        async sendMessage() {
          return '';
        },
        async close() {},
      } as unknown as ArenaDriver);
      config.providers[id].availableModels = [`${id}:keep`];
      config.providers[id].selectedModels = [`${id}:keep`];
    }
    const mgr = new ProviderManager({ store, config, factories });
    await mgr.init();

    for (const id of WEB_PROVIDER_IDS) {
      const outcome = await mgr.refreshModelsReport(id as WebProviderId);
      expect(outcome.ok, id).toBe(false);
      expect(outcome.error, id).toMatch(/selector changed/i);
      const state = mgr.getState(id as WebProviderId);
      expect(state.availableModels, id).toEqual([`${id}:keep`]);
      expect(state.selectedModels, id).toEqual([`${id}:keep`]);
      expect(state.meta?.lastModelsError, id).toMatch(/selector changed/i);
    }
  });

  it('does not let a browser save resurrect model ids the provider dropped', async () => {
    const config = defaultGatewayConfig();
    config.providers['gemini-web'] = {
      ...config.providers['gemini-web'],
      availableModels: ['gemini-web:default'],
      selectedModels: ['gemini-web:default'],
    };
    const mgr = new ProviderManager({ store, config, factories: {} as any });
    await mgr.init();
    // The UI now only PATCHes the selection — the available list is owned by
    // the discovery operation.
    await mgr.updateProvider('gemini-web', { selectedModels: ['gemini-web:default'] });
    expect(mgr.getState('gemini-web').availableModels).toEqual(['gemini-web:default']);
  });
});
