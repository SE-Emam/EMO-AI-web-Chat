/**
 * Provider-specific discovery adapters.
 *
 * EVERY entry below is built from what was OBSERVED in that provider's own
 * page (live DOM + the provider's own network traffic), not from guesses.
 * Adapters that are not yet proven carry `verified: false` and a `blocker`
 * describing exactly what is missing — they report `discovery_unsupported`
 * instead of pretending to have discovered something.
 *
 * Selector provenance (measured, 2026-11-13):
 *  - claude-web    : `button[data-testid="model-selector-dropdown"]` →
 *                    `[role="menuitemradio"][data-model-id]` (claude-sonnet-5-5)
 *  - zai-web       : `button[aria-label="model-item"]` → `data-value` (glm-5.3)
 *  - qwen-web      : `div[aria-label="Select Model"]` → `.wms-list__item` +
 *                    the provider's own `GET /api/v2/models/`
 *  - chatgpt-web   : the provider's own `GET /backend-api/models` (slugs)
 *  - kimi-web      : the provider's own `GetAvailableModels` response
 *  - minimax-web   : the provider's own `/minimax-cloud/api/v1/config`
 *  - kiwi-web      : the provider's own `GET /v1/models`
 */
import type { WebProviderId } from '../types.js';
import type { WebModelDiscoveryAdapter } from './types.js';

const LOGIN_WALL: string[] = [
  'form[action*="login"]',
  'input[type="password"]',
  'button:has-text("Log in")',
  'button:has-text("Sign in")',
  'a[href*="signin"]',
  'a[href*="login"]',
];

export const DISCOVERY_ADAPTERS: Record<WebProviderId, WebModelDiscoveryAdapter> = {
  // ---------------------------------------------------------------------
  // PROVEN: stable model ids read from the provider's own page/traffic.
  // ---------------------------------------------------------------------
  'claude-web': {
    providerId: 'claude-web',
    entryUrl: 'https://claude.ai/new',
    strategies: ['dom'],
    verified: true,
    dom: {
      openPickerSelectors: [
        'button[data-testid="model-selector-dropdown"]',
        'button[data-cds="ModelSelector"]',
        'button[aria-label^="Model:"]',
      ],
      optionSelectors: [
        '[role="menuitemradio"][data-model-id]',
        '[role="menuitem"][data-model-id]',
        '[data-model-id]',
      ],
      idAttributes: ['data-model-id', 'value', 'data-value'],
      labelExtraction: 'text',
      metadataAttributes: ['aria-checked', 'data-model-id', 'role'],
      expandSelectors: ['[role="menuitem"]:has-text("More models")', 'button:has-text("More models")'],
      maxExpansions: 6,
      loginWallSelectors: ['form[action*="login" i]', 'input[type="password"]'],
    },
  },

  'zai-web': {
    providerId: 'zai-web',
    entryUrl: 'https://chat.z.ai',
    strategies: ['dom', 'network'],
    verified: true,
    dom: {
      openPickerSelectors: [
        'button[aria-label="Select a model"]',
        'button[id^="model-selector-input"]',
        'button[aria-haspopup="menu"][data-slot="dropdown-menu-trigger"]',
      ],
      optionSelectors: ['button[aria-label="model-item"]', '[aria-label="model-item"]'],
      idAttributes: ['data-value', 'value', 'data-model-id'],
      labelExtraction: 'text',
      metadataAttributes: ['data-selected', 'data-arrow-selected'],
      loginWallSelectors: ['form[action*="login" i]', 'input[type="password"]'],
    },
    network: {
      urlPatterns: ['/api/models'],
      idKeys: ['id', 'model_id', 'model'],
      idPattern: '^(glm-|x-preview|x-)',
      minModels: 1,
      replayPaths: ['/api/models'],
    },
  },

  'qwen-web': {
    providerId: 'qwen-web',
    entryUrl: 'https://chat.qwen.ai/',
    strategies: ['dom', 'network'],
    verified: true,
    dom: {
      openPickerSelectors: [
        'div[aria-label="Select Model"]',
        '[role="button"][aria-haspopup="listbox"]',
        '[aria-label="Select Model"]',
      ],
      optionSelectors: ['.wms-list__item[role="option"]', '[role="option"]'],
      idAttributes: ['data-model-id', 'value', 'data-value'],
      labelExtraction: 'attribute',
      labelAttribute: 'data-model-name',
      metadataAttributes: ['aria-selected'],
      loginWallSelectors: ['form[action*="login" i]', 'input[type="password"]'],
    },
    network: {
      urlPatterns: ['/api/v2/models'],
      idKeys: ['id', 'model_id', 'model'],
      idPattern: '^qwen',
      minModels: 1,
      replayPaths: ['/api/v2/models/'],
    },
  },

  'chatgpt-web': {
    providerId: 'chatgpt-web',
    entryUrl: 'https://chatgpt.com/',
    strategies: ['network', 'dom'],
    verified: true,
    network: {
      urlPatterns: ['/backend-api/models'],
      idKeys: ['slug', 'id', 'model'],
      idPattern: '^(gpt-|o[0-9]|chatgpt-)',
      minModels: 1,
      replayPaths: ['/backend-api/models?iim=false&include_icons=false&is_gizmo=false'],
    },
    dom: {
      openPickerSelectors: [
        'button[data-testid="model-switcher"]',
        'button[aria-haspopup="menu"]:has-text("Auto")',
        '[data-testid="model-switcher"]',
      ],
      optionSelectors: ['[role="menuitem"]', '[role="option"]', '[data-model-slug]'],
      idAttributes: ['data-model-slug', 'data-slug', 'value', 'data-value'],
      labelExtraction: 'text',
      loginWallSelectors: ['form[action*="login" i]', 'input[type="password"]'],
    },
  },

  'kimi-web': {
    providerId: 'kimi-web',
    entryUrl: 'https://www.kimi.com/',
    strategies: ['network', 'dom'],
    verified: true,
    network: {
      urlPatterns: ['GetAvailableModels'],
      idKeys: ['id', 'model_id', 'model'],
      idPattern: '^[a-z0-9][a-z0-9._-]{1,60}$',
      minModels: 1,
      replayPaths: [],
    },
    dom: {
      openPickerSelectors: ['[data-testid="model-select-trigger"]', 'button[aria-haspopup="listbox"]'],
      optionSelectors: ['[role="option"]', 'li'],
      idAttributes: ['data-model-id', 'value', 'data-value'],
      labelExtraction: 'text',
      loginWallSelectors: ['form[action*="login" i]', 'input[type="password"]'],
    },
  },

  'minimax-web': {
    providerId: 'minimax-web',
    entryUrl: 'https://agent.minimax.io/',
    strategies: ['network', 'dom'],
    verified: true,
    network: {
      urlPatterns: ['/minimax-cloud/api/v1/config'],
      idKeys: ['model_id', 'modelId', 'id', 'name'],
      idPattern: '^minimax',
      minModels: 1,
      replayPaths: [],
    },
    dom: {
      openPickerSelectors: ['button[aria-haspopup="menu"]', '[class*="model" i]'],
      optionSelectors: ['[role="menuitemradio"]', '[role="option"]', 'li'],
      idAttributes: ['data-model-id', 'value', 'data-value'],
      labelExtraction: 'text',
      loginWallSelectors: ['form[action*="login" i]', 'input[type="password"]'],
    },
  },

  'kiwi-web': {
    providerId: 'kiwi-web',
    entryUrl: 'https://chat.llm.kiwi/',
    strategies: ['network', 'dom'],
    verified: true,
    network: {
      urlPatterns: ['/v1/models'],
      idKeys: ['id', 'model', 'name'],
      idPattern: '^[a-z0-9][a-z0-9._-]{1,60}$',
      minModels: 1,
      replayPaths: ['/v1/models'],
    },
    dom: {
      openPickerSelectors: ['button[aria-haspopup="menu"]', '[class*="model" i]'],
      optionSelectors: ['[role="option"]', 'li'],
      idAttributes: ['value', 'data-value', 'data-model-id'],
      labelExtraction: 'text',
      loginWallSelectors: ['form[action*="login" i]', 'input[type="password"]'],
    },
  },

  // ---------------------------------------------------------------------
  // NOT YET PROVEN — the adapter reports the blocker instead of faking it.
  // The generic DOM/network strategies still run; when they cannot find a
  // model list the result is `model_picker_not_found` / `discovery_unsupported`
  // and the reason is shown on the card.
  // ---------------------------------------------------------------------
  'gemini-web': {
    providerId: 'gemini-web',
    entryUrl: 'https://gemini.google.com/app',
    strategies: ['dom'],
    verified: true,
    dom: {
      openPickerSelectors: [
        'button[aria-label*="mode picker" i]',
        'button[aria-label*="Open mode picker" i]',
        '.input-area-switch',
        'fieldset [role="combobox"]',
      ],
      // The model entries carry `data-mode-id` (e.g. "argon"); the
      // "Thinking level" entry is a SUBMENU and carries no model id, so it
      // never leaks into the model list.
      optionSelectors: ['gem-menu-item[data-mode-id][role="menuitemradio"]', 'gem-menu-item[data-mode-id]'],
      idAttributes: ['data-mode-id'],
      // Gemini lists an "upsell" pseudo-mode next to the real ones.
      excludeIdPatterns: ['^upsell_'],
      labelExtraction: 'text',
      metadataAttributes: ['data-test-id', 'role'],
      loginWallSelectors: ['form[action*="signin" i]', 'input[type="password"]'],
    },
  },

  'tencent-ai-web': {
    providerId: 'tencent-ai-web',
    entryUrl: 'https://aistudio.tencent.ai/',
    strategies: ['network', 'dom'],
    verified: true,
    network: {
      // The provider's OWN requests: the model tab info and the model list.
      urlPatterns: ['/auditOpenAPI/model/modelTabInfo', '/auditOpenAPI/model/list'],
      idKeys: ['modelName', 'model_name', 'model'],
      idPattern: '^(hy\\d|hunyuan)',
      minModels: 1,
      replayPaths: [],
    },
    dom: {
      // The model control in the composer (TDesign select).
      openPickerSelectors: ['div.home4-model-ctrl', '.t-select__wrap', '[class*="model-ctrl"]'],
      optionSelectors: ['li.home4-model-ctrl__item', 'li.t-select-option'],
      idAttributes: ['data-model-name', 'value'],
      labelExtraction: 'attribute',
      labelAttribute: 'title',
      metadataAttributes: ['data-tag'],
      loginWallSelectors: ['form[action*="login" i]', 'input[type="password"]'],
    },
  },

  'grok-web': {
    providerId: 'grok-web',
    entryUrl: 'https://grok.com/',
    strategies: ['dom'],
    verified: true,
    dom: {
      // The cookie banner blocks the model menu — dismiss it first.
      dismissSelectors: [
        'button:has-text("Accept All Cookies")',
        'button[aria-label="Dismiss cookie notice"]',
        'button[aria-label="Close"]',
      ],
      openPickerSelectors: ['button[aria-label^="Model:"]', 'button[aria-label^="Model"]'],
      // Grok's model entries are menu checkboxes ("Fast", "Build", "Auto",
      // "Expert", "Heavy") without a stable id attribute -> they are reported
      // as display-name-only, never as executable ids.
      optionSelectors: ['[role="menuitemcheckbox"]', '[role="menuitemradio"]'],
      idAttributes: ['data-model-id', 'data-value'],
      labelExtraction: 'text',
      loginWallSelectors: ['form[action*="signin" i]', 'input[type="password"]'],
    },
  },

  'arena-browser': {
    providerId: 'arena-browser',
    entryUrl: 'https://emo.ai/text/direct',
    strategies: ['dom'],
    verified: true,
    dom: {
      // The model control is the button showing the CURRENT model (the
      // modality list next to it is NOT a model list).
      openPickerSelectors: [
        'button:has-text("Max")',
        'button[aria-haspopup="dialog"]:not([aria-label])',
        '#model-dropdown',
      ],
      // The opened list is a cmdk listbox; every entry carries data-model-id.
      optionSelectors: [
        '[role="listbox"] [role="option"]',
        '[cmdk-item][role="option"]',
        '[role="option"][data-model-id]',
      ],
      idAttributes: ['data-model-id', 'data-value'],
      labelExtraction: 'text',
      labelSelector: 'span.font-mono',
      expandSelectors: ['button:has-text("More")'],
      maxExpansions: 4,
      loginWallSelectors: ['form[action*="login" i]', 'input[type="password"]'],
    },
  },

  'deepseek-web': {
    providerId: 'deepseek-web',
    entryUrl: 'https://chat.deepseek.com/',
    strategies: ['network', 'dom'],
    verified: true,
    network: {
      // The provider's OWN settings request that carries the model configs.
      urlPatterns: ['/api/v0/client/settings'],
      idKeys: ['model_type'],
      idPattern: '^(default|expert|vision|reasoning)$',
      minModels: 1,
      replayPaths: [],
    },
    dom: {
      openPickerSelectors: ['[class*="model" i]', 'button[aria-haspopup="menu"]'],
      optionSelectors: ['[role="menuitemradio"]', '[role="menuitem"]', 'li'],
      idAttributes: ['data-model-id', 'value', 'data-value'],
      labelExtraction: 'text',
      loginWallSelectors: ['form[action*="login" i]', 'input[type="password"]'],
    },
  },

  'mistral-web': {
    providerId: 'mistral-web',
    entryUrl: 'https://chat.mistral.ai/',
    strategies: ['embedded', 'dom'],
    verified: true,
    embedded: {
      // The provider embeds its own model catalog in the page payload
      // (vcw_model_catalog.models[] -> { model, label }).
      marker: 'vcw_model_catalog',
      idKey: 'model',
      labelKey: 'label',
      idPattern: '^(mistral|devstral|codestral|pixtral|ministral|magistral|voxtral|zai|glm)',
      minModels: 1,
    },
    dom: {
      openPickerSelectors: ['button[aria-label="Choose model"]'],
      optionSelectors: ['[role="menuitemradio"]', '[role="option"]'],
      idAttributes: ['data-model-id', 'value', 'data-value'],
      labelExtraction: 'text',
      loginWallSelectors: ['form[action*="signin" i]', 'input[type="password"]'],
    },
  },

  'longcat-web': {
    providerId: 'longcat-web',
    entryUrl: 'https://longcat.ai/chat/',
    strategies: ['dom', 'network'],
    verified: false,
    blocker:
      'The provider requires a mainland-China phone number to sign up, so no session could be created. The account cannot be verified from this machine until such a number is provided — the interface is used without an account for now.',
    dom: {
      openPickerSelectors: ['button[aria-haspopup="menu"]', '[class*="model" i]', '[class*="Model" i]'],
      optionSelectors: ['[role="option"]', '[role="menuitemradio"]', 'li'],
      idAttributes: ['value', 'data-model-id', 'data-value'],
      labelExtraction: 'text',
      loginWallSelectors: ['form[action*="login" i]', 'input[type="password"]'],
    },
    network: {
      urlPatterns: ['/api/', '/model'],
      idKeys: ['model', 'model_id', 'id', 'name'],
      idPattern: '^(longcat)',
      minModels: 1,
      replayPaths: [],
    },
  },

  'llm7-web': {
    providerId: 'llm7-web',
    entryUrl: 'https://llm7.chat/',
    strategies: ['dom', 'network'],
    verified: false,
    blocker:
      'The site did not answer within the timeout from this machine (ERR_CONNECTION_TIMED_OUT), so no model picker could be observed.',
    dom: {
      openPickerSelectors: ['button[aria-haspopup="menu"]', '[class*="model" i]'],
      optionSelectors: ['[role="option"]', '[role="menuitemradio"]', 'li'],
      idAttributes: ['value', 'data-model-id', 'data-value'],
      labelExtraction: 'text',
      loginWallSelectors: ['form[action*="login" i]', 'input[type="password"]'],
    },
    network: {
      urlPatterns: ['/v1/models', '/api/models'],
      idKeys: ['id', 'model', 'name'],
      idPattern: '^[a-z0-9][a-z0-9._-]{1,60}$',
      minModels: 1,
      replayPaths: ['/v1/models'],
    },
  },
};

export function getDiscoveryAdapter(providerId: string): WebModelDiscoveryAdapter | null {
  return (DISCOVERY_ADAPTERS as Record<string, WebModelDiscoveryAdapter>)[providerId] ?? null;
}

export function listDiscoveryAdapters(): WebModelDiscoveryAdapter[] {
  return Object.values(DISCOVERY_ADAPTERS);
}

export { LOGIN_WALL };
