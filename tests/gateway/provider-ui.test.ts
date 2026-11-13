import { describe, it, expect, beforeEach } from 'vitest';
import { createUiHarness, type UiHarness } from './ui-harness.js';
import { WEB_PROVIDER_IDS } from '../../src/gateway/types.js';
import { getProviderCapabilities } from '../../src/gateway/provider-capabilities.js';

function providerState(id: string, overrides: Record<string, unknown> = {}): any {
  const caps = getProviderCapabilities(id);
  return {
    id,
    name: caps.name,
    status: 'stopped',
    enabled: false,
    availableModels: [],
    selectedModels: [],
    settings: { headless: true },
    accounts: [],
    isLoggedIn: false,
    capabilities: caps,
    meta: {},
    card: {
      refresh: {
        labelKey: caps.isLiveDiscovery ? 'btnFetchModelsLive' : 'btnLoadCatalog',
        busyLabelKey: 'btnWorking',
        disabled: !caps.canRefreshModels,
        isLive: caps.isLiveDiscovery,
      },
      test: {
        labelKey: 'btnTestConnection',
        busyLabelKey: 'btnWorking',
        disabled: !caps.canTestConnection,
        isLive: true,
      },
      models: {
        sourceLabelKey: caps.modelsSourceNoteKey,
        tone: 'muted',
        items: [] as Array<{ id: string; selected: boolean; available: boolean }>,
        availableCount: 0,
        selectedCount: 0,
      },
      connection: { labelKey: 'connStatusNeverChecked', tone: 'muted' },
      discovery: {
        status: 'never_scanned',
        labelKey: 'discoveryNeverScanned',
        tone: 'muted',
        unreadChanges: 0,
        proven: true,
      },
    },
    ...overrides,
  };
}

describe('Providers & Models page — provider card UI (real gateway UI script)', () => {
  it('never hides the card body behind a hover (the actions must always be reachable)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../src/gateway/ui.ts', import.meta.url), 'utf8');
    const start = src.indexOf('.provider-card-body{');
    const end = src.indexOf('.providers-filter-bar{');
    expect(start).toBeGreaterThan(0);
    const css = src.slice(start, end);
    // A collapsed body (max-height:0 / pointer-events:none) made every card
    // action unreachable unless the mouse happened to hover the card.
    expect(css).not.toMatch(/max-height:\s*0/);
    expect(css).not.toMatch(/pointer-events:\s*none/);
    expect(css).not.toMatch(/opacity:\s*0/);
  });

  it('renders the three status tiles (live discovery, connection, models)', async () => {
    ui.renderProvidersGrid([providerState('gemini-web')]);
    const html = ui.cardHtml('gemini-web');
    expect(html).toContain('provider-status-grid');
    expect(html).toContain('الاكتشاف الحيّ');
    expect(html).toContain('الاتصال');
    expect(html).toContain('النماذج');
  });

  let ui: UiHarness;

  beforeEach(() => {
    ui = createUiHarness();
    ui.fetchCalls.length = 0;
  });

  it('renders a card for EVERY registered provider with a models and a test button', () => {
    const providers = WEB_PROVIDER_IDS.map((id) => providerState(id));
    ui.renderProvidersGrid(providers);
    for (const id of WEB_PROVIDER_IDS) {
      const html = ui.cardHtml(id);
      expect(html, `card for ${id}`).toContain('data-id="' + id + '"');
      expect(html, `refresh button for ${id}`).toContain('data-act="refreshModels"');
      expect(html, `test button for ${id}`).toContain('data-act="testConnection"');
    }
  });

  it('labels the refresh button as a LIVE discovery for the web providers', () => {
    ui.renderProvidersGrid(WEB_PROVIDER_IDS.map((id) => providerState(id)));
    // Every web provider is now discovered live from its own website.
    expect(ui.buttonState('refreshModels', 'gemini-web')?.label).toBe('جلب النماذج');
  });

  it('shows the live-discovery state on every provider card', () => {
    const p = providerState('gemini-web');
    p.card.discovery = {
      status: 'active',
      labelKey: 'discoveryActive',
      tone: 'ok',
      modelCount: 7,
      newModelCount: 2,
      lastSuccessAt: '2026-11-13T00:00:00.000Z',
      unreadChanges: 1,
      proven: true,
    };
    ui.renderProvidersGrid([p]);
    const html = ui.cardHtml('gemini-web');
    expect(html).toContain('الاكتشاف الحيّ: يعمل');
    expect(html).toContain('7 نموذج مكتشف');
    expect(html).toContain('+2 جديد');
    // The timestamp is rendered as a readable local time (not a raw ISO blob).
    expect(html).toMatch(/\d{1,2}:\d{2}/);
  });

  it('offers Discover / Check Changes / View Changes on every card', () => {
    ui.renderProvidersGrid(WEB_PROVIDER_IDS.map((id) => providerState(id)));
    for (const id of WEB_PROVIDER_IDS) {
      const html = ui.cardHtml(id);
      expect(html, id).toContain('data-act="discoverModels"');
      expect(html, id).toContain('data-act="checkChanges"');
      expect(html, id).toContain('data-act="viewChanges"');
    }
  });

  it('Discover Models really calls the discovery endpoint', async () => {
    ui.renderProvidersGrid([providerState('gemini-web')]);
    ui.setFetchHandler(() => ({
      ok: true,
      status: 200,
      json: {
        ok: true,
        report: {
          status: 'discovered',
          models: [{ providerModelId: 'gemini-3', displayName: 'Gemini 3' }],
          changes: [{ type: 'model_added', providerModelId: 'gemini-3', displayName: 'Gemini 3' }],
        },
      },
    }));
    await ui.click('discoverModels', 'gemini-web');
    const call = ui.fetchCalls.find((c) => c.url.includes('/discover'));
    expect(call, 'the discovery endpoint must be called').toBeTruthy();
    expect(call?.url).toContain('/api/gateway/providers/gemini-web/discover');
    expect(call?.method).toBe('POST');
  });

  it('keeps a PERSISTENT result line on the card after the action (not just a toast)', async () => {
    ui.renderProvidersGrid([providerState('gemini-web')]);
    ui.setFetchHandler(() => ({
      ok: true,
      status: 200,
      json: {
        ok: true,
        report: {
          status: 'discovered',
          source: 'web-ui-dom',
          models: [{ providerModelId: 'g3', displayName: 'Gemini 3' }],
          changes: [],
        },
      },
    }));
    await ui.click('discoverModels', 'gemini-web');
    // The grid is re-rendered with the outcome (as the live page does).
    ui.renderProvidersGrid([providerState('gemini-web')]);
    const html = ui.cardHtml('gemini-web');
    // The outcome stays ON THE CARD (the toast disappears after 3s).
    expect(html).toContain('provider-result-line');
    expect(html).toContain('اكتمل الاكتشاف');
  });

  it('shows a FAILED connection result on the card as well', async () => {
    ui.renderProvidersGrid([providerState('claude-web')]);
    ui.setFetchHandler(() => ({
      ok: true,
      status: 200,
      json: { ok: false, report: { status: 'authentication_required', labelKey: 'connStatusAuthenticationRequired', latencyMs: 12, detail: 'no session' } },
    }));
    await ui.click('testConnection', 'claude-web');
    ui.renderProvidersGrid([providerState('claude-web')]);
    const html = ui.cardHtml('claude-web');
    expect(html).toContain('provider-result-line error');
    expect(html).toContain('يلزم تسجيل الدخول');
  });

  it('never reports success when the discovery failed', async () => {
    ui.renderProvidersGrid([providerState('gemini-web')]);
    ui.setFetchHandler(() => ({
      ok: true,
      status: 200,
      json: {
        ok: false,
        report: { status: 'failed', failureReason: 'model_picker_not_found', detail: 'No model picker was found', models: [], changes: [] },
      },
    }));
    await ui.click('discoverModels', 'gemini-web');
    const toasts = ui.toasts();
    expect(toasts.some((t) => t.type === 'error')).toBe(true);
    expect(toasts.some((t) => t.type === 'error' && t.text.includes('No model picker was found'))).toBe(true);
    expect(toasts.filter((t) => t.type === 'info').length).toBe(0);
  });

  it('reports a deferred discovery as deferred, not as a failure', async () => {
    ui.renderProvidersGrid([providerState('gemini-web')]);
    ui.setFetchHandler(() => ({
      ok: true,
      status: 200,
      json: {
        ok: false,
        report: { status: 'deferred', deferred: true, detail: 'profile busy', models: [], changes: [] },
      },
    }));
    await ui.click('discoverModels', 'gemini-web');
    const texts = ui.toasts().map((t) => t.text).join(' ');
    expect(texts).toContain('profile busy');
  });

  it('Fetch Models really calls the refresh endpoint with the right provider id', async () => {
    ui.renderProvidersGrid([providerState('gemini-web')]);
    ui.setFetchHandler(() => ({
      ok: true,
      status: 200,
      json: { ok: true, outcome: { ok: true, count: 4, source: 'configured-catalog', models: ['a', 'b', 'c', 'd'] } },
    }));
    await ui.click('refreshModels', 'gemini-web');
    const call = ui.fetchCalls.find((c) => c.url.includes('/refresh'));
    expect(call, 'the refresh endpoint must be called').toBeTruthy();
    expect(call?.url).toContain('/api/gateway/providers/gemini-web/refresh');
    expect(call?.method).toBe('POST');
  });

  it('shows a SUCCESS result only when the server reported a real discovery', async () => {
    ui.renderProvidersGrid([providerState('gemini-web')]);
    ui.setFetchHandler(() => ({
      ok: true,
      status: 200,
      json: { ok: true, outcome: { ok: true, count: 3, source: 'configured-catalog' } },
    }));
    await ui.click('refreshModels', 'gemini-web');
    const toasts = ui.toasts();
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts.every((t) => t.type === 'info')).toBe(true);
    expect(toasts.map((t) => t.text).join(' ')).toContain('3');
  });

  it('shows an ERROR (never a success) when the discovery failed, and keeps the previous list', async () => {
    const previous = providerState('gemini-web', {
      availableModels: ['gemini-web:default'],
      selectedModels: ['gemini-web:default'],
    });
    previous.card.models.items = [{ id: 'gemini-web:default', selected: true, available: true }];
    previous.card.models.availableCount = 1;
    ui.renderProvidersGrid([previous]);
    expect(ui.cardHtml('gemini-web')).toContain('gemini-web:default');

    ui.setFetchHandler(() => ({
      ok: false,
      status: 502,
      json: { ok: false, error: { message: 'catalog read failed' }, outcome: { ok: false, error: 'catalog read failed' } },
    }));
    await ui.click('refreshModels', 'gemini-web');

    const toasts = ui.toasts();
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts.some((t) => t.type === 'error')).toBe(true);
    expect(toasts.some((t) => t.type === 'error' && t.text.includes('catalog read failed'))).toBe(true);
    // No success toast at all.
    expect(toasts.filter((t) => t.type === 'info').length).toBe(0);
  });

  it('does not clear the model list when the refresh request fails at the network level', async () => {
    const previous = providerState('gemini-web', {
      availableModels: ['gemini-web:default'],
      selectedModels: ['gemini-web:default'],
    });
    previous.card.models.items = [{ id: 'gemini-web:default', selected: true, available: true }];
    ui.renderProvidersGrid([previous]);
    ui.setFetchHandler(() => {
      throw new Error('network down');
    });
    await ui.click('refreshModels', 'gemini-web');
    expect(ui.cardHtml('gemini-web')).toContain('gemini-web:default');
    expect(ui.toasts().some((t) => t.type === 'error')).toBe(true);
  });

  it('Test Connection really calls the connection endpoint (not a stored flag)', async () => {
    ui.renderProvidersGrid([providerState('claude-web')]);
    ui.setFetchHandler(() => ({
      ok: true,
      status: 200,
      json: { ok: true, report: { status: 'connected', labelKey: 'connStatusConnected', latencyMs: 42 } },
    }));
    await ui.click('testConnection', 'claude-web');
    const call = ui.fetchCalls.find((c) => c.url.includes('/connection'));
    expect(call, 'the connection endpoint must be called').toBeTruthy();
    expect(call?.url).toContain('/api/gateway/providers/claude-web/connection');
    expect(call?.method).toBe('POST');
  });

  it('reports the distinct connection statuses instead of collapsing them into connected/disconnected', async () => {
    ui.renderProvidersGrid([providerState('claude-web')]);
    ui.setFetchHandler(() => ({
      ok: true,
      status: 200,
      json: { ok: false, report: { status: 'authentication_required', labelKey: 'connStatusAuthenticationRequired', latencyMs: 10 } },
    }));
    await ui.click('testConnection', 'claude-web');
    const texts = ui.toasts().map((t) => t.text).join(' ');
    expect(texts).toContain('يلزم تسجيل الدخول');
    expect(texts).not.toContain('متصل');
  });

  it('shows a connection FAILURE as an error when the probe itself fails', async () => {
    ui.renderProvidersGrid([providerState('claude-web')]);
    ui.setFetchHandler(() => {
      throw new Error('probe exploded');
    });
    await ui.click('testConnection', 'claude-web');
    expect(ui.toasts().some((t) => t.type === 'error')).toBe(true);
  });

  it('marks a selected model that the provider no longer offers as unavailable', () => {
    const p = providerState('kimi-web', {
      availableModels: ['kimi-web:default'],
      selectedModels: ['kimi-web:default', 'kimi-web:removed-model'],
    });
    p.card.models.items = [
      { id: 'kimi-web:default', selected: true, available: true },
      { id: 'kimi-web:removed-model', selected: true, available: false },
    ];
    p.card.models.availableCount = 1;
    ui.renderProvidersGrid([p]);
    const html = ui.cardHtml('kimi-web');
    expect(html).toContain('kimi-web:removed-model');
    expect(html).toContain('model-stale');
    expect(html).toContain('غير متاح');
  });

  it('renders the connection status and the models source from the provider state', () => {
    const p = providerState('mistral-web');
    p.card.connection = {
      status: 'provider_unavailable',
      labelKey: 'connStatusProviderUnavailable',
      tone: 'error',
      checkedAt: '2026-11-12T10:00:00.000Z',
      detail: 'Provider is unreachable: ECONNREFUSED',
    };
    p.card.models = {
      sourceLabelKey: 'modelsSourceConfiguredCatalog',
      tone: 'warn',
      lastRefreshAt: '2026-11-12T09:00:00.000Z',
      lastRefreshCount: 5,
      items: [],
      availableCount: 0,
      selectedCount: 0,
    };
    ui.renderProvidersGrid([p]);
    const html = ui.cardHtml('mistral-web');
    expect(html).toContain('المزوّد غير متاح');
    expect(html).toContain('ECONNREFUSED');
    expect(html).toContain('قائمة مُهيّأة');
    expect(html).toMatch(/\d{1,2}:\d{2}/);
  });

  it('does not render a model that the provider never offered (no invented ids)', () => {
    const p = providerState('deepseek-web');
    p.card.models.items = [{ id: 'deepseek-web:default', selected: true, available: true }];
    ui.renderProvidersGrid([p]);
    const html = ui.cardHtml('deepseek-web');
    expect(html).toContain('deepseek-web:default');
    expect(html).not.toContain('deepseek-web:invented-model');
  });

  it('renders the model-change notification centre with the unread badge', async () => {
    ui.setFetchHandler((call) => {
      if (call.url.includes('/discovery/notifications')) {
        return {
          ok: true,
          status: 200,
          json: {
            unreadCount: 2,
            notifications: [
              {
                id: 'n1',
                providerId: 'gemini-web',
                providerName: 'Gemini Web',
                type: 'model_added',
                displayName: 'Gemini 4',
                detectedAt: '2026-11-13T00:00:00.000Z',
                source: 'web-ui-dom',
                link: '#providers/gemini-web',
                read: false,
                dedupeKey: 'k1',
              },
              {
                id: 'n2',
                providerId: 'claude-web',
                providerName: 'Claude Web',
                type: 'model_renamed',
                displayName: 'Sonnet 5.6',
                previousDisplayName: 'Sonnet 5.5',
                detectedAt: '2026-11-13T00:00:00.000Z',
                source: 'web-ui-dom',
                link: '#providers/claude-web',
                read: true,
                dedupeKey: 'k2',
              },
            ],
          },
        };
      }
      return { ok: true, status: 200, json: {} };
    });
    await ui.ctx.loadModelNotifications();
    const panel = await ui.ctx.document.getElementById('modelNotificationsPanel');
    expect(panel.innerHTML).toContain('Gemini Web');
    expect(panel.innerHTML).toContain('تم اكتشاف نموذج جديد');
    expect(panel.innerHTML).toContain('Sonnet 5.6');
    expect(panel.innerHTML).toContain('Sonnet 5.5 → Sonnet 5.6');
    const badge = await ui.ctx.document.getElementById('modelNotifUnreadBadge');
    expect(badge.textContent).toBe('2');
    expect(badge.style.display).not.toBe('none');
  });

  it('asks for consent BEFORE a visible browser is opened (approve / postpone)', async () => {
    // The server reports that a visible browser is needed for this provider.
    ui.setFetchHandler(() => ({
      ok: true,
      status: 200,
      json: {
        ok: false,
        report: {
          status: 'failed',
          failureReason: 'model_picker_not_found',
          needsHeadedConsent: true,
          detail: 'a visible browser window is needed',
          models: [],
          changes: [],
        },
      },
    }));
    ui.renderProvidersGrid([providerState('claude-web')]);
    await ui.click('discoverModels', 'claude-web');

    // The consent dialog is shown with both answers.
    const modal = await ui.ctx.document.getElementById('browserConsentModal');
    expect((modal as any).style.display).toBe('flex');
    // The wording the user sees.
    expect(ui.ctx.t('consentTitle')).toContain('سيتم فتح المتصفح لتحديث النماذج');
    expect(ui.ctx.t('consentApprove')).toBe('موافق');
    expect(ui.ctx.t('consentDefer')).toBe('تأجيل لاحقًا');
    // The dialog really exists in the page markup with both buttons.
    const fs = await import('node:fs');
    const page = fs.readFileSync(new URL('../../src/gateway/ui.ts', import.meta.url), 'utf8');
    expect(page).toContain('id="browserConsentModal"');
    expect(page).toContain('onclick="answerBrowserConsent(true)"');
    expect(page).toContain('onclick="answerBrowserConsent(false)"');

    // Answering "postpone" closes it and opens nothing.
    await ui.ctx.answerBrowserConsent(false);
    const after = await ui.ctx.document.getElementById('browserConsentModal');
    expect((after as any).style.display).toBe('none');
  });

  it('never opens a visible browser without an explicit approval', async () => {
    const calls: any[] = [];
    ui.setFetchHandler((call) => {
      calls.push(call);
      return { ok: true, status: 200, json: { ok: true, report: { status: 'discovered', models: [], changes: [] } } };
    });
    ui.renderProvidersGrid([providerState('gemini-web')]);
    await ui.click('discoverModels', 'gemini-web');
    // The scan request carries NO headed permission by default.
    const discoverCall = calls.find((c) => c.url.includes('/discover'));
    expect(discoverCall).toBeTruthy();
    expect(discoverCall?.body?.allowHeadedFallback).toBeFalsy();
  });

  it('prevents a double click from starting a second operation on the same card', async () => {
    ui.renderProvidersGrid([providerState('gemini-web')]);
    const releases: Array<() => void> = [];
    const gate = new Promise<void>((r) => {
      releases.push(r);
    });
    const resolveFetch = () => {
      for (const r of releases) r();
    };
    ui.setFetchHandler(async (call) => {
      if (call.url.includes('/refresh')) {
        await gate;
        return { ok: true, status: 200, json: { ok: true, outcome: { ok: true, count: 1, source: 'configured-catalog' } } };
      }
      return { ok: true, status: 200, json: {} };
    });

    const first = ui.click('refreshModels', 'gemini-web');
    // Let the first click reach the fetch call.
    await new Promise((r) => setTimeout(r, 5));
    const second = ui.click('refreshModels', 'gemini-web');
    resolveFetch?.();
    await Promise.all([first, second]);

    const refreshCalls = ui.fetchCalls.filter((c) => c.url.includes('/refresh'));
    expect(refreshCalls.length).toBe(1);
  });

  it('disables the refresh button while the operation is running', async () => {
    ui.renderProvidersGrid([providerState('gemini-web')]);
    const releases: Array<() => void> = [];
    const gate = new Promise<void>((r) => {
      releases.push(r);
    });
    const resolveFetch = () => {
      for (const r of releases) r();
    };
    ui.setFetchHandler(async (call) => {
      if (call.url.includes('/refresh')) {
        await gate;
        return { ok: true, status: 200, json: { ok: true, outcome: { ok: true, count: 1, source: 'configured-catalog' } } };
      }
      return { ok: true, status: 200, json: {} };
    });
    const running = ui.click('refreshModels', 'gemini-web');
    await new Promise((r) => setTimeout(r, 5));
    expect(ui.buttonState('refreshModels', 'gemini-web')?.disabled).toBe(true);
    expect(ui.buttonState('refreshModels', 'gemini-web')?.label).toBe('جارٍ التنفيذ…');
    resolveFetch?.();
    await running;
  });
});
