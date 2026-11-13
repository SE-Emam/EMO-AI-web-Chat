/**
 * Per-provider discovery adapter tests.
 *
 * Every provider gets its OWN fixture, built from the markup that provider
 * really uses. A provider without a proven strategy must report the blocker
 * instead of returning models.
 */
import { describe, it, expect } from 'vitest';
import { discoverModelsFromDom } from '../../../src/gateway/discovery/dom-strategy.js';
import {
  discoverModelsFromNetwork,
  extractModelIds,
} from '../../../src/gateway/discovery/network-strategy.js';
import { DISCOVERY_ADAPTERS, getDiscoveryAdapter } from '../../../src/gateway/discovery/adapters.js';
import { WEB_PROVIDER_IDS } from '../../../src/gateway/types.js';
import { fixturePage, type ElementFixture } from './fixture-page.js';

const ctx = (page: any) => ({ page, settleMs: 0, now: () => Date.parse('2026-11-13T00:00:00.000Z') });

describe('Discovery adapters — DOM strategy (per provider fixtures)', () => {
  it('claude-web: reads stable model ids from [data-model-id]', async () => {
    const adapter = getDiscoveryAdapter('claude-web')!;
    const elements: ElementFixture[] = [
      { selectors: ['button[data-testid="model-selector-dropdown"]'], text: 'Sonnet 5.5 Medium', visible: true, reveals: ['[role="menuitemradio"][data-model-id]'] },
      { selectors: ['[role="menuitemradio"][data-model-id]'], text: 'Sonnet 5.5', attrs: { 'data-model-id': 'claude-sonnet-5-5', 'aria-checked': 'true' } },
      { selectors: ['[role="menuitemradio"][data-model-id]'], text: 'Haiku 5.5', attrs: { 'data-model-id': 'claude-haiku-5-5', 'aria-checked': 'false' } },
      { selectors: ['[role="menuitem"][data-model-id]'], text: 'Opus 5.5', attrs: { 'data-model-id': 'claude-opus-5-5' } },
    ];
    const result = await discoverModelsFromDom('claude-web', adapter.dom!, ctx(fixturePage(elements)));
    expect(result.failureReason).toBeUndefined();
    expect(result.complete).toBe(true);
    expect(result.models.map((m) => m.providerModelId)).toEqual([
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'claude-opus-5-5',
    ]);
    expect(result.models.every((m) => m.identityConfidence === 'stable-id')).toBe(true);
  });

  it('zai-web: reads model ids from data-value on model-item buttons', async () => {
    const adapter = getDiscoveryAdapter('zai-web')!;
    const elements: ElementFixture[] = [
      { selectors: ['button[aria-label="Select a model"]'], text: 'GLM-5.2', visible: true, reveals: ['button[aria-label="model-item"]'] },
      { selectors: ['button[aria-label="model-item"]'], text: 'GLM-5.3-Flash', attrs: { 'data-value': 'x-preview-l', 'data-selected': 'false' } },
      { selectors: ['button[aria-label="model-item"]'], text: 'GLM-5.3', attrs: { 'data-value': 'glm-5.3' } },
    ];
    const result = await discoverModelsFromDom('zai-web', adapter.dom!, ctx(fixturePage(elements)));
    expect(result.failureReason).toBeUndefined();
    expect(result.models.map((m) => m.providerModelId)).toEqual(['x-preview-l', 'glm-5.3']);
    expect(result.models[0].displayName).toBe('GLM-5.3-Flash');
  });

  it('qwen-web: reads the wms-list options and marks them display-name-only when no id exists', async () => {
    const adapter = getDiscoveryAdapter('qwen-web')!;
    const elements: ElementFixture[] = [
      { selectors: ['div[aria-label="Select Model"]'], text: 'Qwen3.7-Plus', visible: true, reveals: ['.wms-list__item[role="option"]'] },
      { selectors: ['.wms-list__item[role="option"]'], text: 'Qwen3.7-Plus', attrs: { 'aria-selected': 'true' } },
      { selectors: ['.wms-list__item[role="option"]'], text: 'Qwen4-Max-Preview', attrs: { 'aria-selected': 'false' } },
    ];
    const result = await discoverModelsFromDom('qwen-web', adapter.dom!, ctx(fixturePage(elements)));
    expect(result.failureReason).toBeUndefined();
    expect(result.models.map((m) => m.displayName)).toEqual(['Qwen3.7-Plus', 'Qwen4-Max-Preview']);
    // No stable id in the DOM -> the model is NOT presented as executable.
    expect(result.models.every((m) => m.identityConfidence === 'display-name-only')).toBe(true);
    expect(result.models.every((m) => !m.providerModelId)).toBe(true);
  });

  it('chatgpt-web: reads the model switcher options', async () => {
    const adapter = getDiscoveryAdapter('chatgpt-web')!;
    const elements: ElementFixture[] = [
      { selectors: ['button[data-testid="model-switcher"]'], text: 'Auto', visible: true, reveals: ['[role="menuitem"]'] },
      { selectors: ['[role="menuitem"]'], text: 'GPT-5.6', attrs: { 'data-model-slug': 'gpt-5-6' } },
      { selectors: ['[role="menuitem"]'], text: 'GPT-5.6 mini', attrs: { 'data-model-slug': 'gpt-5-6-mini' } },
    ];
    const result = await discoverModelsFromDom('chatgpt-web', adapter.dom!, ctx(fixturePage(elements)));
    expect(result.failureReason).toBeUndefined();
    expect(result.models.map((m) => m.providerModelId)).toEqual(['gpt-5-6', 'gpt-5-6-mini']);
  });

  it('reports model_picker_not_found when the provider page has no picker', async () => {
    const adapter = getDiscoveryAdapter('deepseek-web')!;
    const result = await discoverModelsFromDom('deepseek-web', adapter.dom!, ctx(fixturePage([])));
    expect(result.failureReason).toBe('model_picker_not_found');
    expect(result.complete).toBe(false);
    expect(result.models).toEqual([]);
  });

  it('reports authentication_required when a login wall is present', async () => {
    const adapter = getDiscoveryAdapter('claude-web')!;
    const elements: ElementFixture[] = [
      { selectors: ['form[action*="login" i]'], text: 'Sign in', visible: true },
    ];
    const result = await discoverModelsFromDom('claude-web', adapter.dom!, ctx(fixturePage(elements)));
    expect(result.failureReason).toBe('authentication_required');
    expect(result.models).toEqual([]);
  });

  it('does NOT treat a header "Log in" button as a login wall', async () => {
    const adapter = getDiscoveryAdapter('tencent-ai-web')!;
    const elements: ElementFixture[] = [
      // The site header always renders this — even for signed-in users.
      { selectors: ['button:has-text("Log in")'], text: 'Log in', visible: true },
      { selectors: ['div.home4-model-ctrl'], text: 'Hy4', visible: true, reveals: ['li.home4-model-ctrl__item'] },
      { selectors: ['li.home4-model-ctrl__item'], text: 'Hy4', attrs: { title: 'Hy4' } },
    ];
    const result = await discoverModelsFromDom('tencent-ai-web', adapter.dom!, ctx(fixturePage(elements)));
    expect(result.failureReason).toBeUndefined();
    expect(result.models.map((m) => m.displayName)).toEqual(['Hy4']);
  });

  it('reports authentication_required when the opened menu is a sign-in / paywall prompt', async () => {
    const adapter = getDiscoveryAdapter('grok-web')!;
    const elements: ElementFixture[] = [
      { selectors: ['button[aria-label^="Model:"]'], text: 'Fast', visible: true },
      // The menu shows the paywall upsell instead of the model list.
      { selectors: ['[role="menuitem"]:has-text("Sign in")'], text: 'Premium Unlock extended capabilities Sign in', visible: true },
    ];
    const result = await discoverModelsFromDom('grok-web', adapter.dom!, ctx(fixturePage(elements)));
    expect(result.failureReason).toBe('authentication_required');
    expect(result.models).toEqual([]);
  });

  it('reports authentication_required when the page has NO composer and asks for a sign-in', async () => {
    const adapter = getDiscoveryAdapter('tencent-ai-web')!;
    const elements: ElementFixture[] = [
      { selectors: ['div.home4-model-ctrl'], text: 'Hy4', visible: true },
      // The signed-out landing screen of the provider.
      { selectors: ['.anything'], text: 'Not logged in Log In' },
    ];
    const result = await discoverModelsFromDom('tencent-ai-web', adapter.dom!, ctx(fixturePage(elements)));
    expect(result.failureReason).toBe('authentication_required');
  });

  it('does NOT report a signed-out page when the composer is present', async () => {
    const adapter = getDiscoveryAdapter('tencent-ai-web')!;
    const elements: ElementFixture[] = [
      { selectors: ['div.home4-model-ctrl'], text: 'Hy4', visible: true },
      { selectors: ['.header'], text: 'Sign in' },
      // The chat composer is there -> the session works.
      { selectors: ['textarea'], text: 'Ask anything', visible: true },
    ];
    const result = await discoverModelsFromDom('tencent-ai-web', adapter.dom!, ctx(fixturePage(elements)));
    expect(result.failureReason).toBe('site_layout_changed');
  });

  it('reports site_layout_changed when the picker opens but exposes no options', async () => {
    const adapter = getDiscoveryAdapter('claude-web')!;
    const elements: ElementFixture[] = [
      { selectors: ['button[data-testid="model-selector-dropdown"]'], text: 'Sonnet', visible: true },
    ];
    const result = await discoverModelsFromDom('claude-web', adapter.dom!, ctx(fixturePage(elements)));
    expect(result.failureReason).toBe('site_layout_changed');
  });

  it('waits for the options to appear before declaring success', async () => {
    const adapter = getDiscoveryAdapter('claude-web')!;
    // The picker exists; the options only become visible after the click.
    const page = fixturePage([
      { selectors: ['button[data-testid="model-selector-dropdown"]'], text: 'Sonnet', visible: true, reveals: ['[role="menuitemradio"][data-model-id]'] },
      { selectors: ['[role="menuitemradio"][data-model-id]'], text: 'Sonnet 5.5', attrs: { 'data-model-id': 'claude-sonnet-5-5' }, visible: false },
    ]);
    const result = await discoverModelsFromDom('claude-web', adapter.dom!, ctx(page));
    expect(result.failureReason).toBeUndefined();
    expect(result.models.map((m) => m.providerModelId)).toEqual(['claude-sonnet-5-5']);
  });

  it('never lets an expansion SHRINK the list (a "more" control may close the picker)', async () => {
    const adapter = getDiscoveryAdapter('arena-browser')!;
    const elements: ElementFixture[] = [
      {
        selectors: ['button:has-text("Max")'],
        text: 'Max',
        visible: true,
        reveals: ['[role="listbox"] [role="option"]', 'button:has-text("More")'],
      },
      { selectors: ['[role="listbox"] [role="option"]'], text: 'glm-5.3-flash', attrs: { 'data-model-id': 'm-1' } },
      { selectors: ['[role="listbox"] [role="option"]'], text: 'gpt-6-luna-max', attrs: { 'data-model-id': 'm-2' } },
      // Clicking this "More" control CLOSES the picker (the options vanish).
      { selectors: ['button:has-text("More")'], text: 'More', visible: true, hides: ['[role="listbox"] [role="option"]'] },
    ];
    const result = await discoverModelsFromDom('arena-browser', adapter.dom!, ctx(fixturePage(elements)));
    expect(result.failureReason).toBeUndefined();
    expect(result.models.map((m) => m.providerModelId)).toEqual(['m-1', 'm-2']);
  });

  it('expands a paginated list ("More models") until it stops growing', async () => {
    const adapter = getDiscoveryAdapter('claude-web')!;
    const elements: ElementFixture[] = [
      { selectors: ['button[data-testid="model-selector-dropdown"]'], text: 'Sonnet', visible: true, reveals: ['[role="menuitemradio"][data-model-id]', '[role="menuitem"]:has-text("More models")'] },
      { selectors: ['[role="menuitemradio"][data-model-id]'], text: 'Sonnet', attrs: { 'data-model-id': 'claude-sonnet-5-5' } },
      { selectors: ['[role="menuitem"]:has-text("More models")'], text: 'More models', visible: true },
    ];
    const result = await discoverModelsFromDom('claude-web', adapter.dom!, ctx(fixturePage(elements)));
    expect(result.failureReason).toBeUndefined();
    expect(result.models.length).toBeGreaterThan(0);
  });
});

describe('Discovery adapters — network strategy (per provider fixtures)', () => {
  it('chatgpt-web: extracts slugs from the provider\'s own /backend-api/models payload', async () => {
    const adapter = getDiscoveryAdapter('chatgpt-web')!;
    const body = JSON.stringify({ models: [{ slug: 'gpt-5-6', name: 'GPT-5.6' }, { slug: 'gpt-5-6-mini', name: 'GPT-5.6 mini' }] });
    const result = await discoverModelsFromNetwork(
      'chatgpt-web',
      adapter.network!,
      ctx(fixturePage([])),
      [{ url: 'https://chatgpt.com/backend-api/models?iim=false', status: 200, body }],
    );
    expect(result.failureReason).toBeUndefined();
    expect(result.models.map((m) => m.providerModelId)).toEqual(['gpt-5-6', 'gpt-5-6-mini']);
    expect(result.models[0].displayName).toBe('GPT-5.6');
  });

  it('qwen-web: extracts ids from the provider\'s own /api/v2/models payload', async () => {
    const adapter = getDiscoveryAdapter('qwen-web')!;
    const body = JSON.stringify({ data: [{ id: 'qwen3.7-plus' }, { id: 'qwen3.8-max' }] });
    const result = await discoverModelsFromNetwork(
      'qwen-web',
      adapter.network!,
      ctx(fixturePage([])),
      [{ url: 'https://chat.qwen.ai/api/v2/models/', status: 200, body }],
    );
    expect(result.models.map((m) => m.providerModelId)).toEqual(['qwen3.7-plus', 'qwen3.8-max']);
  });

  it('kimi-web: extracts ids from the GetAvailableModels payload', async () => {
    const adapter = getDiscoveryAdapter('kimi-web')!;
    const body = JSON.stringify({ data: { models: [{ id: 'k28-instant' }, { id: 'k3d1-agent' }] } });
    const result = await discoverModelsFromNetwork(
      'kimi-web',
      adapter.network!,
      ctx(fixturePage([])),
      [{ url: 'https://www.kimi.com/apiv2/kimi.gateway.config.v1.ConfigService/GetAvailableModels', status: 200, body }],
    );
    expect(result.models.map((m) => m.providerModelId)).toEqual(['k28-instant', 'k3d1-agent']);
  });

  it('minimax-web: extracts model_id values from the provider config payload', async () => {
    const adapter = getSecurityFreeAdapter('minimax-web');
    const body = JSON.stringify({ config: { chatModel: { model_id: 'MiniMax-M3.1-Flash' }, agentModel: { model_id: 'MiniMax-M3' } } });
    const result = await discoverModelsFromNetwork(
      'minimax-web',
      adapter,
      ctx(fixturePage([])),
      [{ url: 'https://agent.minimax.io/minimax-cloud/api/v1/config?device_platform=web', status: 200, body }],
    );
    expect(result.models.map((m) => m.providerModelId)).toEqual(['MiniMax-M3.1-Flash', 'MiniMax-M3']);
  });

  it('kiwi-web: extracts ids from the provider\'s own /v1/models payload', async () => {
    const adapter = getDiscoveryAdapter('kiwi-web')!;
    const body = JSON.stringify({ data: [{ id: 'minimax-m2.5' }, { id: 'nemotron-3-ultra' }] });
    const result = await discoverModelsFromNetwork(
      'kiwi-web',
      adapter.network!,
      ctx(fixturePage([])),
      [{ url: 'https://chat.llm.kiwi/v1/models', status: 200, body }],
    );
    expect(result.models.map((m) => m.providerModelId)).toEqual(['minimax-m2.5', 'nemotron-3-ultra']);
  });

  it('ignores unrelated JSON in the page traffic (ads, flags, telemetry)', async () => {
    const adapter = getDiscoveryAdapter('chatgpt-web')!;
    const result = await discoverModelsFromNetwork(
      'chatgpt-web',
      adapter.network!,
      ctx(fixturePage([])),
      [
        { url: 'https://chatgpt.com/backend-api/sentinel/chat-requirements/prepare', status: 200, body: JSON.stringify({ ads: [{ id: 'ad-1' }, { id: 'ad-2' }] }) },
      ],
    );
    expect(result.failureReason).toBe('model_picker_not_found');
    expect(result.models).toEqual([]);
  });

  it('rejects a payload whose ids do not match the provider id pattern', () => {
    const config = { urlPatterns: [], idKeys: ['id'], idPattern: '^gpt-', minModels: 1 };
    const { ids } = extractModelIds({ data: [{ id: 'not-a-gpt' }, { id: 'also-wrong' }] }, config);
    expect(ids).toEqual([]);
  });

  it('fails cleanly on invalid JSON', () => {
    const adapter = getDiscoveryAdapter('qwen-web')!;
    const result = discoverModelsFromNetwork(
      'qwen-web',
      adapter.network!,
      ctx(fixturePage([])),
      [{ url: 'https://chat.qwen.ai/api/v2/models/', status: 200, body: '<html>not json</html>' }],
    );
    return expect(result).resolves.toMatchObject({ failureReason: 'model_picker_not_found' });
  });
});

describe('Discovery adapter registry', () => {
  it('has an adapter for EVERY registered web provider', () => {
    for (const id of WEB_PROVIDER_IDS) {
      const adapter = getDiscoveryAdapter(id);
      expect(adapter, id).toBeTruthy();
      expect(adapter!.providerId).toBe(id);
      expect(adapter!.entryUrl).toMatch(/^https:\/\//);
      expect(adapter!.strategies.length).toBeGreaterThan(0);
    }
    expect(Object.keys(DISCOVERY_ADAPTERS).length).toBe(WEB_PROVIDER_IDS.length);
  });

  it('marks unproven adapters with a blocker instead of pretending', () => {
    for (const id of WEB_PROVIDER_IDS) {
      const adapter = getDiscoveryAdapter(id)!;
      if (!adapter.verified) {
        expect(adapter.blocker, id).toBeTruthy();
        expect(adapter.blocker!.length).toBeGreaterThan(20);
      }
    }
  });

  it('reports the proven providers', () => {
    const proven = WEB_PROVIDER_IDS.filter((id) => getDiscoveryAdapter(id)!.verified);
    expect(proven).toContain('claude-web');
    expect(proven).toContain('chatgpt-web');
    expect(proven).toContain('qwen-web');
    expect(proven).toContain('zai-web');
    expect(proven).toContain('kimi-web');
    expect(proven).toContain('minimax-web');
    expect(proven).toContain('kiwi-web');
  });
});

/** Small helper so the minimax test does not depend on the adapter's internals. */
function getSecurityFreeAdapter(providerId: string) {
  const adapter = getDiscoveryAdapter(providerId)!;
  return adapter.network!;
}
