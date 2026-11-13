import { describe, it, expect } from 'vitest';
import { discoverModelsFromEmbeddedCatalog } from '../../../src/gateway/discovery/embedded-strategy.js';
import { discoverModelsFromDom } from '../../../src/gateway/discovery/dom-strategy.js';
import { discoverModelsFromNetwork, extractModelIds } from '../../../src/gateway/discovery/network-strategy.js';
import { getDiscoveryAdapter } from '../../../src/gateway/discovery/adapters.js';
import { fixturePage, type ElementFixture } from './fixture-page.js';

const ctx = (page: any) => ({ page, settleMs: 0, now: () => Date.parse('2026-11-13T00:00:00.000Z') });

describe('Embedded-catalog strategy (the provider\'s own page payload)', () => {
  it('extracts the model catalog a provider embeds in its page', async () => {
    const adapter = getDiscoveryAdapter('mistral-web')!;
    const html =
      '<html><body><script>self.__next_f.push([1,"{\\"vcw_model_catalog\\":{\\"models\\":[{\\"model\\":\\"mistral-large-4-0\\",\\"label\\":\\"Mistral Large 4\\"},{\\"model\\":\\"zai-glm-5-3\\",\\"label\\":\\"GLM-5.3\\"}]}}"])</script></body></html>';
    const page = fixturePage([]);
    (page as any).content = async () => html;
    (page as any).evaluate = async (fn: any, arg: any) => {
      // Emulate the browser-side extraction over the given HTML.
      const scope = String(arg?.html ?? html);
      const out: any[] = [];
      const idRe = /\\?"model\\?"\s*:\s*\\?"([^"\\]{1,80})\\?"/g;
      let m: RegExpExecArray | null;
      while ((m = idRe.exec(scope)) !== null) {
        const objStart = scope.lastIndexOf('{', m.index);
        const objEnd = scope.indexOf('}', m.index);
        const obj = scope.slice(objStart, objEnd + 1);
        const lm = /\\?"label\\?"\s*:\s*\\?"([^"\\]{1,120})\\?"/.exec(obj);
        out.push({ id: m[1], label: lm ? lm[1] : m[1] });
      }
      return out;
    };
    const result = await discoverModelsFromEmbeddedCatalog('mistral-web', adapter.embedded!, ctx(page));
    expect(result.failureReason).toBeUndefined();
    expect(result.models.map((m) => m.providerModelId)).toEqual(['mistral-large-4-0', 'zai-glm-5-3']);
    expect(result.models[0].displayName).toBe('Mistral Large 4');
  });

  it('reports a failure when the page carries no catalog', async () => {
    const adapter = getDiscoveryAdapter('mistral-web')!;
    const page = fixturePage([]);
    (page as any).evaluate = async () => [];
    const result = await discoverModelsFromEmbeddedCatalog('mistral-web', adapter.embedded!, ctx(page));
    expect(result.failureReason).toBe('model_picker_not_found');
    expect(result.models).toEqual([]);
  });
});

describe('Provider model ids read from the provider\'s OWN requests', () => {
  it('tencent-ai-web: reads modelName + label from the model tab info response', async () => {
    const adapter = getDiscoveryAdapter('tencent-ai-web')!;
    const body = JSON.stringify({
      code: 0,
      data: {
        tabs: {
          tabLanguage: [
            { modelName: 'hy4-g', title: 'Hy4', label: 'Hy4', subLabel: 'Latest Flagship Model', tag: 'New' },
            { modelName: 'hy3-g', title: 'Hy3', label: 'Hy3' },
          ],
        },
      },
    });
    const result = await discoverModelsFromNetwork(
      'tencent-ai-web',
      adapter.network!,
      ctx(fixturePage([])),
      [{ url: 'https://api.hy.tencent.ai/api/vision_platform/public/auditOpenAPI/model/modelTabInfo', status: 200, body }],
    );
    expect(result.failureReason).toBeUndefined();
    expect(result.models.map((m) => m.providerModelId)).toEqual(['hy4-g', 'hy3-g']);
    expect(result.models[0].displayName).toBe('Hy4');
  });

  it('deepseek-web: reads model_type + name from the provider settings request', async () => {
    const adapter = getDiscoveryAdapter('deepseek-web')!;
    const body = JSON.stringify({
      code: 0,
      data: {
        biz_data: {
          settings: {
            model_configs: {
              value: [
                { model_type: 'default', name: 'Instant', enabled: true },
                { model_type: 'expert', name: 'Expert', enabled: false },
                { model_type: 'vision', name: 'Vision', enabled: false },
              ],
            },
          },
        },
      },
    });
    const result = await discoverModelsFromNetwork(
      'deepseek-web',
      adapter.network!,
      ctx(fixturePage([])),
      [{ url: 'https://chat.deepseek.com/api/v0/client/settings?scope=model', status: 200, body }],
    );
    expect(result.models.map((m) => m.providerModelId)).toEqual(['default', 'expert', 'vision']);
    expect(result.models[0].displayName).toBe('Instant');
  });

  it('ignores a response whose ids do not match the provider pattern', () => {
    const cfg = { urlPatterns: [], idKeys: ['model_type'], idPattern: '^(default|expert)$', minModels: 1 };
    const { ids } = extractModelIds({ a: { model_type: 'other' }, b: { model_type: 'default' } }, cfg);
    expect(ids).toEqual(['default']);
  });
});

describe('Entries that are not models are dropped', () => {
  it('gemini-web: drops the "upsell" pseudo-mode', async () => {
    const adapter = getDiscoveryAdapter('gemini-web')!;
    const elements: ElementFixture[] = [
      { selectors: ['button[aria-label*="mode picker" i]'], text: 'Auto', visible: true, reveals: ['gem-menu-item[data-mode-id]'] },
      { selectors: ['gem-menu-item[data-mode-id]'], text: 'Auto', attrs: { 'data-mode-id': 'argon' } },
      { selectors: ['gem-menu-item[data-mode-id]'], text: 'Upgrade', attrs: { 'data-mode-id': 'upsell_MODE_CATEGORY_ULTRA' } },
    ];
    const result = await discoverModelsFromDom('gemini-web', adapter.dom!, ctx(fixturePage(elements)));
    expect(result.models.map((m) => m.providerModelId)).toEqual(['argon']);
  });
});

describe('Cookie/consent overlays are dismissed before the picker is opened', () => {
  it('grok-web: reads the model checkboxes after the cookie banner is dismissed', async () => {
    const adapter = getDiscoveryAdapter('grok-web')!;
    const page = fixturePage([
      // The cookie banner is dismissed first (it hides itself).
      {
        selectors: ['button:has-text("Accept All Cookies")'],
        text: 'Accept All Cookies',
        visible: true,
        hides: ['button:has-text("Accept All Cookies")'],
      },
      { selectors: ['button[aria-label^="Model:"]'], text: 'Fast', visible: true, reveals: ['[role="menuitemcheckbox"]'] },
      { selectors: ['[role="menuitemcheckbox"]'], text: 'Fast', attrs: { 'aria-checked': 'true' }, visible: false },
      { selectors: ['[role="menuitemcheckbox"]'], text: 'Build', attrs: { 'aria-checked': 'false' }, visible: false },
      { selectors: ['[role="menuitemcheckbox"]'], text: 'Auto', attrs: { 'aria-checked': 'false' }, visible: false },
    ]);
    const result = await discoverModelsFromDom('grok-web', adapter.dom!, ctx(page));
    // The banner was dismissed before the picker was opened.
    expect(page.isHidden('button:has-text("Accept All Cookies")')).toBe(true);
    expect(result.failureReason).toBeUndefined();
    expect(result.models.map((m) => m.displayName)).toEqual(['Fast', 'Build', 'Auto']);
    // Grok exposes no stable id -> the models are display-name-only.
    expect(result.models.every((m) => m.identityConfidence === 'display-name-only')).toBe(true);
    expect(result.models.every((m) => !m.providerModelId)).toBe(true);
  });

  it('tencent-ai-web: reads the model control options from the composer', async () => {
    const adapter = getDiscoveryAdapter('tencent-ai-web')!;
    const elements: ElementFixture[] = [
      { selectors: ['div.home4-model-ctrl'], text: 'Hy4 New', visible: true },
      { selectors: ['li.home4-model-ctrl__item'], text: 'Hy4', attrs: { title: 'Hy4' } },
      { selectors: ['li.home4-model-ctrl__item'], text: 'Hy3', attrs: { title: 'Hy3' } },
    ];
    const result = await discoverModelsFromDom('tencent-ai-web', adapter.dom!, ctx(fixturePage(elements)));
    expect(result.failureReason).toBeUndefined();
    expect(result.models.map((m) => m.displayName)).toEqual(['Hy4', 'Hy3']);
  });
});
