import { chromium, type BrowserContext, type Page } from 'playwright';
import type { ArenaDriver, ChatMessage, GeminiWebConfig } from '../types.js';
import { formatMessages } from './models.js';
import { DEFAULT_GEMINI_WEB_BASE_URL } from '../config.js';

const EDITOR = '.ql-editor[contenteditable="true"][aria-label*="prompt"], .ql-editor[contenteditable="true"], rich-textarea .ql-editor[contenteditable="true"]';
const SEND = 'button[aria-label="Send message"], button[aria-label*="Send message"], button[mattooltip="Send message"]';
const NEW_CHAT = '[data-testid="new-chat-button"], button[aria-label*="New chat"], a[aria-label*="New chat"]';
const MODEL_MENU = '[data-testid="bard-mode-menu-button"], button[aria-label*="mode picker"]';
const MODEL_RESPONSE = 'model-response';
const MODEL_CONTENT = 'model-response message-content, model-response .model-response-text message-content, model-response .markdown, model-response structured-content-container';

/**
 * Google Gemini (gemini.google.com) web-session driver.
 *
 * - Dedicated persistent Chrome profile.
 * - Headed recommended for Google login/2FA/verification solved by the human.
 * - Model routing: explicit prefixes only to avoid hijacking gemini-* API names:
 *     gemini-web:<model>  or  geminiweb:<model>
 *   `gemini-web:default` keeps the session's current model.
 */
export class GeminiWebDriver implements ArenaDriver {
  private readonly config: GeminiWebConfig;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  /** Serializes requests — a single browser page cannot serve concurrent chats safely. */
  private queue: Promise<void> = Promise.resolve();

  constructor(config: GeminiWebConfig) {
    this.config = config;
  }

  async listModels(): Promise<string[]> {
    return ['gemini-web:default'];
  }

  async sendMessage(
    model: string,
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const run = this.queue.then(() => this.sendMessageSerialized(model, messages, onChunk, signal));
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async sendMessageSerialized(
    model: string,
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    if (signal?.aborted) throw new Error('Request was aborted');
    const page = await this.ensurePage();
    const base = (this.config.baseUrl || DEFAULT_GEMINI_WEB_BASE_URL).replace(/\/$/, '');

    console.log('[GeminiWeb] Navigating to gemini.google.com/app...');
    await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch((e) =>
      console.log('[GeminiWeb] goto error:', e.message)
    );
    await page.waitForTimeout(2500);
    await this.assertAuthenticated(page);
    await this.startNewChatIfPossible(page).catch(() => {});
    await page.waitForTimeout(800);
    await this.selectModelIfRequested(page, model, signal);

    const beforeCount = await page.locator(MODEL_RESPONSE).count().catch(() => 0);
    const prompt = formatMessages(messages);
    await this.fillComposer(page, prompt, signal);
    await this.clickSend(page, signal);
    return await this.waitForResponse(page, beforeCount, onChunk, signal);
  }

  private async assertAuthenticated(page: Page): Promise<void> {
    const url = page.url();
    if (/accounts\.google\.com|\/signin|ServiceLogin/i.test(url)) {
      throw new Error(
        'Gemini session is not authenticated (redirected to Google sign-in). Run: node scripts/login-gemini-web.mjs (complete login/2FA, close window), then retry. Profile: ' +
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

  private parseRequestedModel(model: string): string | null {
    const m = model.trim();
    const prefix = m.startsWith('gemini-web:') ? 'gemini-web:' : m.startsWith('geminiweb:') ? 'geminiweb:' : null;
    if (!prefix) return null;
    const rest = m.slice(prefix.length).trim();
    if (!rest || rest.toLowerCase() === 'default') return null;
    return rest;
  }

  private async selectModelIfRequested(page: Page, model: string, signal?: AbortSignal): Promise<void> {
    const requested = this.parseRequestedModel(model);
    if (!requested) return;
    if (signal?.aborted) throw new Error('Request was aborted');
    const menu = page.locator(MODEL_MENU).first();
    if ((await menu.count()) === 0) {
      console.log('[GeminiWeb] Model picker not found; continuing with current model.');
      return;
    }
    console.log(`[GeminiWeb] Attempting to select model: ${requested}`);
    await menu.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(700);
    const option = page.locator('[role="menuitem"],[role="option"],button,mat-option').filter({
      hasText: new RegExp(requested.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    }).first();
    if ((await option.count()) > 0) {
      await option.click({ timeout: 5000 }).catch((e) => console.log('[GeminiWeb] model option click failed:', e.message));
      await page.waitForTimeout(800);
    } else {
      console.log(`[GeminiWeb] No model option matched "${requested}"; continuing with current model.`);
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  private async fillComposer(page: Page, text: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('Request was aborted');
    const editor = page.locator(EDITOR).first();
    await editor.waitFor({ state: 'visible', timeout: 20_000 });
    await editor.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    try {
      await page.keyboard.insertText(text);
    } catch {
      await page.evaluate(({ selector, value }) => {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) return;
        el.focus();
        el.textContent = value;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      }, { selector: '.ql-editor[contenteditable="true"]', value: text });
    }
    await page.waitForTimeout(350);
  }

  private async clickSend(page: Page, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('Request was aborted');
    const send = page.locator(SEND).first();
    await send.waitFor({ state: 'visible', timeout: 15_000 });
    for (let i = 0; i < 20; i++) {
      const disabled = await send.isDisabled().catch(() => false);
      const ariaDisabled = await send.getAttribute('aria-disabled').catch(() => null);
      if (!disabled && ariaDisabled !== 'true') break;
      await page.waitForTimeout(150);
    }
    await send.click({ timeout: 10_000 }).catch(async (e) => {
      console.log('[GeminiWeb] send click fallback:', e.message);
      await page.keyboard.press('Enter');
    });
  }

  private cleanText(text: string): string {
    let t = (text || '').trim();
    t = t.replace(/^Gemini said\s*/i, '').trim();
    return t;
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

      const snap = await page.evaluate(({ sel, before }) => {
        const msgs = Array.from(document.querySelectorAll(sel));
        const target = msgs[msgs.length - 1] as HTMLElement | undefined;
        const content = target?.querySelector('message-content, .model-response-text, .markdown, structured-content-container') as HTMLElement | null;
        const text = ((content?.innerText || content?.textContent || target?.innerText || target?.textContent || '') as string).trim();
        const stop = document.querySelector('button[aria-label*="Stop"], button[aria-label*="Stop responding"], button[mattooltip*="Stop"]');
        const busy = !!document.querySelector('[aria-busy="true"], .response-container-footer [class*="loading"]');
        return { count: msgs.length, text, hasStop: !!stop, busy, url: location.href };
      }, { sel: MODEL_RESPONSE, before: beforeCount }).catch(() => ({ count: 0, text: '', hasStop: false, busy: false, url: '' }));

      if (snap.count <= beforeCount && !snap.text) continue;
      const cleaned = this.cleanText(snap.text);
      if (cleaned && cleaned !== lastEmitted) {
        const delta = cleaned.startsWith(lastEmitted) ? cleaned.slice(lastEmitted.length) : cleaned;
        if (delta) {
          try { onChunk?.(delta); } catch { /* ignore */ }
        }
        lastEmitted = cleaned;
        stableCount = 0;
      } else if (cleaned) {
        stableCount++;
      }

      if (cleaned && !snap.hasStop && !snap.busy && stableCount >= 4) return cleaned;
      if (snap.url && /accounts\.google\.com|\/signin/i.test(snap.url)) {
        throw new Error(`Gemini session became unauthenticated. URL: ${snap.url}`);
      }
    }

    if (lastEmitted) return lastEmitted;
    throw new Error(`Gemini web response timed out after ${timeoutMs}ms. Profile: ${this.config.userDataDir}. If verification appeared, solve it in the headed browser and retry.`);
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
    if (this.page && !this.page.isClosed()) return this.page;
    if (!this.context) {
      console.log(`[GeminiWeb] Launching persistent Chrome (headless=${this.config.headless})...`);
      this.context = await chromium.launchPersistentContext(this.config.userDataDir, {
        channel: 'chrome',
        headless: this.config.headless,
        viewport: { width: 1280, height: 900 },
        args: ['--disable-blink-features=AutomationControlled'],
        ignoreDefaultArgs: ['--enable-automation'],
      });
    }
    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
    return this.page;
  }
}
