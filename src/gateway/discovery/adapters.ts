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
      labelExtraction: 'text',
      metadataAttributes: ['data-test-id', 'role'],
      loginWallSelectors: ['form[action*="signin" i]', 'input[type="password"]'],
    },
  },

  'tencent-ai-web': {
    providerId: 'tencent-ai-web',
    entryUrl: 'https://aistudio.tencent.ai/',
    strategies: ['dom', 'network'],
    verified: false,
    blocker:
      'The "Switch model" trigger was located, but the registered local profile is not signed in to yuanbao ("Not logged in"), so the model submenu cannot be opened. A signed-in profile is required.',
    dom: {
      openPickerSelectors: [
        'button[aria-label="Switch model"]',
        '[data-thinking-mode-switcher-trigger]',
        'div.mode-select-open',
      ],
      optionSelectors: ['[role="menuitemradio"]', '[role="option"]', '.mode-select-item', 'li'],
      idAttributes: ['data-model-id', 'value', 'data-value'],
      labelExtraction: 'text',
      loginWallSelectors: ['form[action*="login" i]', 'input[type="password"]'],
    },
    network: {
      // The provider's own traffic was inspected: `/api/info/public/general`
      // carries ASSET urls (COS buckets), NOT a model list — matching it
      // would invent models. It is deliberately not used as a model source.
      urlPatterns: [],
      idKeys: ['model_id', 'modelId', 'id', 'name'],
      idPattern: '^(hunyuan-|turbo|deepseek|step|gemini|gpt)',
      minModels: 2,
      replayPaths: [],
    },
  },

  'grok-web': {
    providerId: 'grok-web',
    entryUrl: 'https://grok.com/',
    strategies: ['dom', 'network'],
    verified: false,
    blocker:
      'The model control (button[aria-label^="Model:"]) opens, but an anonymous session only sees the paywall upsell ("Premium - Unlock extended capabilities - Sign in"). The real model list requires a signed-in Grok profile.',
    dom: {
      openPickerSelectors: [
        'button[aria-label^="Model:"]',
        'button[aria-label^="Model"]',
        'button[aria-haspopup="menu"][class*="model" i]',
      ],
      // Only entries that carry a model id count — the paywall / "Unlock"
      // upsell must never be reported as a model.
      optionSelectors: [
        '[role="menuitemradio"][data-value]',
        '[role="menuitem"][data-model-id]',
        '[role="option"][data-model-id]',
      ],
      idAttributes: ['data-model-id', 'data-value', 'value'],
      labelExtraction: 'text',
      loginWallSelectors: ['form[action*="signin" i]', 'input[type="password"]'],
    },
    network: {
      urlPatterns: ['/rest/app-chat/', '/api/'],
      idKeys: ['modelName', 'model_name', 'id', 'slug'],
      idPattern: '^(grok|xai)',
      minModels: 1,
      replayPaths: [],
    },
  },

  'arena-browser': {
    providerId: 'arena-browser',
    entryUrl: 'https://arena.ai/text/direct',
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
    strategies: ['dom', 'network'],
    verified: false,
    blocker:
      'The site redirects to a Google sign-in page before the chat UI renders, so the model list can only be read with a signed-in DeepSeek account.',
    dom: {
      openPickerSelectors: ['#model-switcher', 'button[aria-haspopup="menu"]', '[class*="model" i]'],
      optionSelectors: ['[role="option"]', '[role="menuitem"]', 'li'],
      idAttributes: ['data-model-id', 'value', 'data-value'],
      labelExtraction: 'text',
      loginWallSelectors: ['form[action*="login" i]', 'input[type="password"]'],
    },
    network: {
      urlPatterns: ['/api/v0', '/api/models'],
      idKeys: ['model', 'model_id', 'id'],
      idPattern: '^(deepseek)',
      minModels: 1,
      replayPaths: [],
    },
  },

  'mistral-web': {
    providerId: 'mistral-web',
    entryUrl: 'https://chat.mistral.ai/',
    strategies: ['dom', 'network'],
    verified: false,
    blocker:
      'The chat UI loads, but the only menu it exposes is the reasoning toggle (Fast / Think) — the model list itself is behind a sign-in. A signed-in Mistral account is required.',
    dom: {
      openPickerSelectors: ['button[aria-haspopup="menu"]', '[class*="model" i]', 'select'],
      optionSelectors: ['[role="option"]', '[role="menuitemradio"]', 'option'],
      idAttributes: ['value', 'data-model-id', 'data-value'],
      labelExtraction: 'text',
      loginWallSelectors: ['form[action*="signin" i]', 'input[type="password"]'],
    },
    network: {
      urlPatterns: ['/api/models', '/v1/models', '/api/v1/agents'],
      idKeys: ['id', 'name', 'model'],
      idPattern: '^(mistral|magistral|devstral|codestral|pixtral|ministral)',
      minModels: 1,
      replayPaths: [],
    },
  },

  'longcat-web': {
    providerId: 'longcat-web',
    entryUrl: 'https://longcat.ai/chat/',
    strategies: ['dom', 'network'],
    verified: false,
    blocker:
      'The configured base URL (https://longcat.ai/chat/) redirects to the public landing page instead of the chat app, and the landing page exposes no model picker. The real chat entry URL still has to be identified.',
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
