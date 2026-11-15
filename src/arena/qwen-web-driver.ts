import { chromium, type BrowserContext, type Page } from 'playwright';
import type { ArenaDriver, ChatMessage, QwenWebConfig } from '../types.js';
import { cleanupStaleProfileLocks } from '../browser/manager.js';
import { formatMessages } from './models.js';
import { DEFAULT_QWEN_WEB_BASE_URL } from '../config.js';
import { providerSessionRouter } from './provider-session-router.js';

const COMPOSER = 'textarea.message-input-textarea, textarea[placeholder*="help you"], textarea[placeholder*="How can I"]';
const SEND = 'button.send-button[aria-label="Send"], .message-input-right-button-send button, button[aria-label*="Send"]';
const NEW_CHAT = 'button[aria-label="New Chat"], button:has-text("New Chat")';
const ASSISTANT = '.qwen-chat-message-assistant';
const ANSWER = '.response-message-content.phase-answer, .response-message-content.t2t.phase-answer, .qwen-chat-message-assistant .markdown-body, .qwen-chat-message-assistant .response-message-content';

/**
 * Qwen (chat.qwen.ai) web-session driver.
 *
 * - Dedicated persistent Chrome profile.
 * - Headed recommended for login/verification solved by the human.
 * - Model routing: explicit prefixes to avoid conflicts with Qwen API model names:
 *     qwen-web:<model>  or  qwenweb:<model>
 *   `qwen-web:default` keeps the session's current model.
 */
export const QWEN_WEB_CANONICAL_MODELS: readonly string[] = [
  'qwen-web:default',
  'qwen-web:qwen-3.7-plus',
  'qwen-web:qwen-2.5-max',
  'qwen-web:qwen-2.5-plus',
  'qwen-web:qwen-2.5-coder-32b',
];

import { SerializedSessionSendQueue, STANDALONE_SERIALIZED_NOTES, type DriverCapabilities } from './driver-capabilities.js';

export class QwenWebDriver implements ArenaDriver {
  private readonly config: QwenWebConfig;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  /** declared serialized session lane (single shared page → global serialization). */
  private readonly sendQueue = new SerializedSessionSendQueue();

  constructor(config: QwenWebConfig) {
    this.config = config;
  }

  async listModels(): Promise<string[]> {
    return [...QWEN_WEB_CANONICAL_MODELS];
  }

  async sendMessage(
    model: string,
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
    sessionKey = 'default'
  ): Promise<string> {
    return this.sendQueue.run('QwenWeb', sessionKey, () =>
      this.sendMessageSerialized(model, messages, onChunk, signal, sessionKey)
    );
  }

  getCapabilities(): DriverCapabilities {
    return {
      sessionSupport: 'serialized-per-session',
      persistentConversation: false,
      streaming: true,
      toolCalling: false,
      notes: STANDALONE_SERIALIZED_NOTES,
    };
  }

  /** breaker key half: the durable profile this driver runs against. */
  getProfileDir(): string {
    return this.config.userDataDir;
  }

  private async sendMessageSerialized(
    model: string,
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
    _sessionKey = 'default'
  ): Promise<string> {
    if (signal?.aborted) throw new Error('Request was aborted');
    const page = await this.ensurePage();
    const base = (this.config.baseUrl || DEFAULT_QWEN_WEB_BASE_URL).replace(/\/$/, '');

    const shouldRotate = providerSessionRouter.shouldRotate('qwen-web');
    const currentUrl = page.url() || '';
    const isNew = !currentUrl || currentUrl === 'about:blank' || !currentUrl.includes('qwen.ai');
    if (shouldRotate || isNew) {
      if (shouldRotate) {
        providerSessionRouter.rotateSession('qwen-web', 'turn_limit_reached');
      }
      console.log('[QwenWeb] Navigating to chat.qwen.ai (fresh session)...');
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch((e) =>
        console.log('[QwenWeb] goto error:', e.message)
      );
      await page.waitForTimeout(2500);
      await this.assertAuthenticated(page);
      await this.startNewChatIfPossible(page).catch(() => {});
      await page.waitForTimeout(700);
    } else {
      console.log(`[QwenWeb] Continuing active session in existing chat (${currentUrl})...`);
    }

    const beforeCount = await page.locator(ASSISTANT).count().catch(() => 0);
    const prompt = formatMessages(messages);
    await this.fillComposer(page, prompt, signal);
    await this.clickSend(page, signal);
    const result = await this.waitForResponse(page, beforeCount, onChunk, signal);
    providerSessionRouter.recordTurn('qwen-web', page.url(), result.length);
    return result;
  }

  private async assertAuthenticated(page: Page): Promise<void> {
    const url = page.url();
    if (/\/auth\b|\/login\b|\/signin\b/i.test(url)) {
      throw new Error(
        'Qwen session is not authenticated (login URL). Run login from the management UI (http://127.0.0.1:8989) or run "npm run login", then retry. Profile: ' +
          this.config.userDataDir
      );
    }
    const state = await page.evaluate(() => {
      const body = (document.body?.innerText || '').slice(0, 8000);
      const hasComposer = !!document.querySelector('textarea.message-input-textarea, textarea[placeholder*="help you"], textarea[placeholder*="How can I"]');
      const hasAuthChrome = /New Chat|All chats|Projects|Upgrade|Log out|退出/i.test(body);
      const hasLoginCta = /(^|\n)\s*(Log in|Sign up)\s*(\n|$)/i.test(body);
      return { hasComposer, hasAuthChrome, hasLoginCta };
    }).catch(() => ({ hasComposer: false, hasAuthChrome: false, hasLoginCta: false }));
    if (!state.hasComposer && !state.hasAuthChrome && state.hasLoginCta) {
      throw new Error(
        'Qwen session is not authenticated. Run login from the management UI (http://127.0.0.1:8989) or run "npm run login", then retry. Profile: ' +
          this.config.userDataDir
      );
    }
  }

  private async startNewChatIfPossible(page: Page): Promise<void> {
    const btn = page.locator(NEW_CHAT).first();
    if ((await btn.count()) === 0) return;
    if (!(await btn.isVisible().catch(() => false))) return;
    await btn.click({ timeout: 5000 }).catch(() => {});
  }

  private async fillComposer(page: Page, text: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('Request was aborted');
    const ta = page.locator(COMPOSER).first();
    await ta.waitFor({ state: 'visible', timeout: 20_000 });
    await ta.click();
    await ta.fill('');
    await ta.fill(text);
    await page.waitForTimeout(300);
  }

  private async clickSend(page: Page, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('Request was aborted');
    const send = page.locator(SEND).first();
    await send.waitFor({ state: 'visible', timeout: 15_000 });
    for (let i = 0; i < 20; i++) {
      const disabled = await send.isDisabled().catch(() => false);
      const cls = (await send.getAttribute('class').catch(() => '')) || '';
      if (!disabled && !/\bdisabled\b/i.test(cls)) break;
      await page.waitForTimeout(150);
    }
    await send.click({ timeout: 10_000 }).catch(async (e) => {
      console.log('[QwenWeb] send click fallback:', e.message);
      await page.keyboard.press('Enter');
    });
  }

  private cleanText(text: string): string {
    return (text || '').trim();
  }

  private async waitForResponse(
    page: Page,
    beforeCount: number,
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const timeoutMs = this.config.timeoutMs ?? 300_000;
    const deadline = Date.now() + timeoutMs;
    let lastEmitted = '';
    let stableCount = 0;

    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('Request was aborted');
      await page.waitForTimeout(350);

      const snap = await page.evaluate(({ assistantSel, before }) => {
        const assistants = Array.from(document.querySelectorAll(assistantSel));
        const target = assistants.length > before ? assistants[assistants.length - 1] as HTMLElement : assistants[assistants.length - 1] as HTMLElement | undefined;
        // Prefer final answer phase; fall back to assistant text.
        const answer = target?.querySelector('.response-message-content.phase-answer, .response-message-content.t2t.phase-answer, .markdown-body, .response-message-content') as HTMLElement | null;
        const text = ((answer?.innerText || answer?.textContent || '') as string).trim();
        const fallback = ((target?.innerText || target?.textContent || '') as string).trim();
        // Stop/generating indicators: send button may become stop; look for stop-like controls.
        const stop = document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"], .stop-button, .message-input-right-button-send button[class*="stop"]');
        const generating = !!document.querySelector('[data-is-streaming="true"], .chat-response-message .loading, [class*="generating"]');
        return { count: assistants.length, text: text || fallback, hasAnswer: !!(text && text.length), hasStop: !!stop, generating, url: location.href };
      }, { assistantSel: ASSISTANT, before: beforeCount }).catch(() => ({ count: 0, text: '', hasAnswer: false, hasStop: false, generating: false, url: '' }));

      if (snap.count <= beforeCount && !snap.text) continue;
      // If we only have fallback text that includes "Thinking completed" but no phase-answer yet, wait for answer.
      let cleaned = this.cleanText(snap.text);
      if (!snap.hasAnswer && /Thinking completed|思考完成/i.test(cleaned)) {
        cleaned = '';
      }
      if (cleaned && cleaned !== lastEmitted) {
        const delta = cleaned.startsWith(lastEmitted)
          ? cleaned.slice(lastEmitted.length)
          : !lastEmitted
            ? cleaned
            : '';
        if (delta) {
          try { onChunk?.(delta); } catch { /* ignore */ }
        }
        lastEmitted = cleaned;
        stableCount = 0;
      } else if (cleaned) {
        stableCount++;
      }

      if (cleaned && !snap.hasStop && !snap.generating && stableCount >= 4) return cleaned;
      if (snap.url && /\/auth|login/i.test(snap.url)) {
        throw new Error(`Qwen session became unauthenticated. URL: ${snap.url}`);
      }
    }

    if (lastEmitted) return lastEmitted;
    throw new Error(`Qwen web response timed out after ${timeoutMs}ms. Profile: ${this.config.userDataDir}. If verification appeared, solve it in the headed browser and retry.`);
  }

  async close(): Promise<void> {
    try {
      await this.context?.close();
    } catch {
      // ignore
    }
    this.context = null;
    this.page = null;
  }

  private async ensurePage(): Promise<Page> {
    if (this.context && this.page && !this.page.isClosed()) {
      try {
        this.context.pages();
        return this.page;
      } catch {
        this.context = null;
        this.page = null;
      }
    }
    if (!this.context) {
      console.log(`[QwenWeb] Launching persistent browser (headless=${this.config.headless !== false})...`);
      cleanupStaleProfileLocks(this.config.userDataDir);
      const baseOptions: Record<string, unknown> = {
        headless: this.config.headless !== false,
        viewport: { width: 1280, height: 900 },
        args: ['--disable-blink-features=AutomationControlled'],
        ignoreDefaultArgs: ['--enable-automation'],
      };
      let ctx: BrowserContext;
      try {
        ctx = await chromium.launchPersistentContext(this.config.userDataDir, { ...baseOptions, channel: 'chrome' });
      } catch {
        ctx = await chromium.launchPersistentContext(this.config.userDataDir, baseOptions);
      }
      this.context = ctx;
      ctx.once?.('close', () => {
        if (this.context === ctx) {
          this.context = null;
          this.page = null;
        }
      });
    }
    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
    return this.page;
  }
}
