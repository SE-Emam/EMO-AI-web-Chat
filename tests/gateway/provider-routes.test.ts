import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerGatewayRoutes } from '../../src/server/gateway-routes.js';
import { GatewayConfigStore, defaultGatewayConfig } from '../../src/gateway/config-store.js';
import { ProviderManager } from '../../src/gateway/provider-manager.js';
import { UsageTracker } from '../../src/gateway/usage-tracker.js';
import { WEB_PROVIDER_IDS } from '../../src/gateway/types.js';
import { CONNECTION_STATUS_LABEL_KEYS } from '../../src/gateway/provider-card-view.js';
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
    labelKey: CONNECTION_STATUS_LABEL_KEYS[status],
    tone: 'muted',
    checkedAt: '2026-11-12T12:00:00.000Z',
    latencyMs: 3,
    detail: 'probe',
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

describe('Providers & Models HTTP API', () => {
  let dir: string;
  let store: GatewayConfigStore;
  let app: any;
  let mgr: ProviderManager;
  let connectionStatus: ProviderConnectionReport['status'];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-routes-'));
    store = new GatewayConfigStore(path.join(dir, 'gateway.json'));
    connectionStatus = 'connected';
    const config = defaultGatewayConfig();
    const factories: any = {};
    for (const id of WEB_PROVIDER_IDS) factories[id] = () => fakeDriver([`${id}:alpha`]);
    mgr = new ProviderManager({
      store,
      config,
      factories,
      connectionProbe: async (opts) => ({ ...report(connectionStatus), providerId: opts.providerId }),
    });
    await mgr.init();
    app = Fastify({ logger: false });
    registerGatewayRoutes(app, {
      manager: mgr,
      tracker: new UsageTracker(),
      getGatewayConfig: () => mgr.getConfig(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('exposes capabilities, persisted meta and the card view for EVERY provider in /status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/gateway/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.providers.length).toBe(WEB_PROVIDER_IDS.length);
    for (const p of body.providers) {
      expect(p.capabilities, p.id).toBeTruthy();
      expect(p.capabilities.id, p.id).toBe(p.id);
      expect(p.card, p.id).toBeTruthy();
      expect(p.card.refresh.labelKey, p.id).toBeTruthy();
      expect(p.card.test.labelKey, p.id).toBeTruthy();
      expect(p.card.models.sourceLabelKey, p.id).toBeTruthy();
      expect(p.meta, p.id).toBeTruthy();
      expect(p.settings.userDataDir, p.id).toBe('[redacted]');
    }
  });

  it('refresh returns the discovery outcome and REPLACES the model list', async () => {
    mgr.getConfig().providers['gemini-web'].availableModels = ['gemini-web:old'];
    mgr.getConfig().providers['gemini-web'].selectedModels = ['gemini-web:old'];
    const res = await app.inject({ method: 'POST', url: '/api/gateway/providers/gemini-web/refresh' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.outcome.ok).toBe(true);
    expect(body.outcome.count).toBe(1);
    expect(body.outcome.source).toBe('configured-catalog');
    expect(body.state.availableModels).toEqual(['gemini-web:alpha']);
    expect(body.state.availableModels).not.toContain('gemini-web:old');
    expect(body.state.meta.lastModelsRefreshAt).toBeTruthy();
  });

  it('refresh returns a NON-2xx and no success when the discovery fails', async () => {
    const broken = new ProviderManager({
      store,
      config: defaultGatewayConfig(),
      factories: {
        'gemini-web': () => ({
          async listModels() {
            throw new Error('ui selector changed');
          },
          async sendMessage() {
            return '';
          },
          async close() {},
        } as unknown as ArenaDriver),
      } as any,
    });
    await broken.init();
    broken.getConfig().providers['gemini-web'].availableModels = ['gemini-web:keep'];
    const app2 = Fastify({ logger: false });
    registerGatewayRoutes(app2, {
      manager: broken,
      tracker: new UsageTracker(),
      getGatewayConfig: () => broken.getConfig(),
    });
    await app2.ready();
    const res = await app2.inject({ method: 'POST', url: '/api/gateway/providers/gemini-web/refresh' });
    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.outcome.ok).toBe(false);
    expect(body.outcome.error).toMatch(/selector changed/i);
    // The last good list is kept.
    expect(body.state.availableModels).toEqual(['gemini-web:keep']);
    await app2.close();
  });

  it('connection returns the REAL report (not a boolean)', async () => {
    connectionStatus = 'authentication_required';
    const res = await app.inject({ method: 'POST', url: '/api/gateway/providers/gemini-web/connection' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.report.status).toBe('authentication_required');
    expect(body.report.labelKey).toBe('connStatusAuthenticationRequired');
    expect(body.report.checkedAt).toBeTruthy();
    expect(body.state.meta.lastConnectionStatus).toBe('authentication_required');
    expect(body.state.meta.lastConnectionCheckAt).toBeTruthy();
  });

  it('ping delegates to the same real probe (kept for backwards compatibility)', async () => {
    connectionStatus = 'provider_unavailable';
    const res = await app.inject({ method: 'POST', url: '/api/gateway/providers/gemini-web/ping' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.report.status).toBe('provider_unavailable');
    expect(body.report.failureCode).toBeUndefined();
  });

  it('rejects an unknown provider id', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/gateway/providers/not-a-provider/refresh' });
    expect(res.statusCode).toBe(400);
  });

  it('does not let the browser write the available model list back (only the selection)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/gateway/providers/gemini-web',
      payload: { selectedModels: ['gemini-web:alpha'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().selectedModels).toEqual(['gemini-web:alpha']);
  });
});
