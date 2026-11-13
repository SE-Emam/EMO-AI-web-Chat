import { BaseWebDriver } from './web-drivers.js';
import type { ArenaDriver, TencentAiWebConfig } from '../types.js';

/**
 * Tencent AI Studio (aistudio.tencent.ai) web-session driver.
 *
 * - Drives the Tencent AI Studio chat web interface.
 * - Dedicated persistent Chrome profile (separate from Arena/ChatGPT/Claude).
 * - Email / WeChat / QQ login support in headed mode.
 */
export class TencentAiWebDriver extends BaseWebDriver implements ArenaDriver {
  constructor(config: TencentAiWebConfig) {
    // The provider's site is https://aistudio.tencent.ai/ — the previous
    // build silently rewrote that URL to yuanbao.tencent.com, which pointed
    // the driver at a DIFFERENT product than the one the user works with.
    const baseUrl = config.baseUrl || 'https://aistudio.tencent.ai/';

    super({
      id: 'tencent-ai-web',
      name: 'Tencent web',
      config: {
        ...config,
        baseUrl,
      },
      canonicalModels: [
        'tencent-ai:default',
        'tencent-ai:hunyuan',
        'tencent-ai:yuanbao',
        'tencent-ai:hy4',
      ],
      composerSelectors: [
        'div.ql-editor[contenteditable="true"]',
        'div[contenteditable="true"]',
        'textarea.agent-chat__input',
        'textarea[placeholder*="输入"]',
        'textarea[placeholder*="Ask"]',
        'textarea',
      ],
      sendSelectors: [
        'button.agent-chat__send-btn',
        'div[aria-label*="发送"]',
        'button[aria-label*="发送"]',
        'button:has-text("发送")',
        'button[type="submit"]',
        '.yb-icon-send',
      ],
      assistantSelectors: [
        '.agent-chat__bubble--assistant',
        '.yb-chat-item--assistant',
        '.agent-dialogue__message--assistant',
        'div.markdown-body',
        'div.agent-markdown',
        'div.prose',
      ],
      loginKeywords: /weixin\.qq\.com|graph\.qq\.com/i,
    });
  }
}
