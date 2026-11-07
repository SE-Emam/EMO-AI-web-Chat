/**
 * DOM selectors for arena.ai direct chat (Gradio / Next.js UI).
 */
export const ARENA_SELECTORS = {
  directChatTab: [
    'button:has-text("Direct Chat")',
    'a:has-text("Direct Chat")',
    '[role="tab"]:has-text("Direct Chat")',
    'button:has-text("Direct")',
  ],
  modelDropdown: [
    '#model-dropdown',
    'div[data-testid="dropdown"]',
    'input[aria-autocomplete="list"]',
    'input[role="combobox"]',
    'select[name="model"]',
    '.model-select',
  ],
  dropdownOption: (modelName: string) => [
    `li[role="option"]:has-text("${modelName}")`,
    `li:has-text("${modelName}")`,
    `div[role="option"]:has-text("${modelName}")`,
    `div:has-text("${modelName}")`,
  ],
  promptInput: [
    'textarea[data-testid="textbox"]',
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="Type"]',
    'textarea[placeholder*="message"]',
    'textarea',
  ],
  sendButton: [
    'button#component-send',
    'button[data-testid="send-button"]',
    'button:has-text("Send")',
    'button:has-text("Submit")',
    'button[aria-label="Send"]',
  ],
  stopButton: [
    'button:has-text("Stop")',
    'button[aria-label*="Stop"]',
    'button.stop-btn',
    'button:has-text("Stop Generation")',
  ],
  clearButton: [
    'button:has-text("Clear")',
    'button:has-text("New Round")',
    'button:has-text("Reset")',
  ],
  botMessage: [
    'div[data-testid="bot"]',
    'div.message.bot',
    '.bot-message',
    'div[data-testid="chatbot"] .message.bot',
    '.chatbot .message:not(.user)',
  ],
  cloudflareChallenge: [
    'iframe[src*="challenges.cloudflare.com"]',
    'iframe[src*="turnstile"]',
    '#challenge-running',
    '#challenge-stage',
    '#cf-challenge-running',
    '.ray_id',
    'text="Verify you are human"',
    'text="Just a moment..."',
  ],
} as const;
