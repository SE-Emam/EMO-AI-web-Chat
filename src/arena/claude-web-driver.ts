import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import type { ArenaDriver, ChatMessage, ClaudeWebConfig } from '../types.js';
import { formatMessages } from './models.js';
import { DEFAULT_CLAUDE_WEB_BASE_URL } from '../config.js';

const COMPOSER = '[data-testid="chat-input"][contenteditable="true"], div.ProseMirror[contenteditable="true"]';
const SEND = 'button[data-testid="chat-input-send"], button[aria-label="Send message"]';
const MODEL_DROPDOWN = 'button[data-testid="model-selector-dropdown"]';
const ASSISTANT_MSG = '[data-testid="assistant-message"]';
const ASSISTANT_PROSE = `${ASSISTANT_MSG} .prose`;

/**
 * Claude (claude.ai) web-session driver.
 *
 * - Dedicated persistent Chrome profile (separate from Arena/Z.AI).
 * - Headed recommended for login/hCaptcha/Cloudflare challenges solved by the human.
 * - Model routing: use explicit prefixes to avoid Arena claude-* conflicts:
 *     claude-web:<model>  or  claudeai:<model>
 *   `claude-web:default` keeps the session's current model.
 */
export class ClaudeWebDriver implements ArenaDriver {
  private readonly config: ClaudeWebConfig;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  /** Serializes requests — a single browser page cannot serve concurrent chats safely. */
  private queue: Promise<void> = Promise.resolve();

  constructor(config: ClaudeWebConfig) {
    this.config = config;
  }

  async listModels(): Promise<string[]> {
    return ['claude-web:default'];
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
    const base = (this.config.baseUrl || DEFAULT_CLAUDE_WEB_BASE_URL).replace(/\/$/, '');

    console.log('[ClaudeWeb] Navigating to claude.ai/new...');
    await page.goto(`${base}/new`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch((e) =>
      console.log('[ClaudeWeb] goto error:', e.message)
    );
    await page.waitForTimeout(2500);
    await this.assertAuthenticated(page);

    await this.selectModelIfRequested(page, model, signal);

    const prompt = formatMessages(messages);
    await this.fillComposer(page, prompt, signal);
    await this.clickSend(page, signal);

    return await this.waitForResponse(page, onChunk, signal);
  }

  private async assertAuthenticated(page: Page): Promise<void> {
    const url = page.url();
    if (/\/login|\/signup|\/sso/i.test(url)) {
      throw new Error(
        'claude.ai session is not authenticated (redirected to login). Run: node scripts/login-claude-web.mjs (complete login/hCaptcha, close window), then retry. Profile: ' +
          this.config.userDataDir
      );
    }
  }

  private parseRequestedModel(model: string): string | null {
    const m = model.trim();
    const prefix = m.startsWith('claude-web:') ? 'claude-web:' : m.startsWith('claudeai:') ? 'claudeai:' : null;
    if (!prefix) return null;
    const rest = m.slice(prefix.length).trim();
    if (!rest || rest.toLowerCase() === 'default') return null;
    return rest;
  }

  private async selectModelIfRequested(page: Page, model: string, signal?: AbortSignal): Promise<void> {
    const requested = this.parseRequestedModel(model);
    if (!requested) return;
    if (signal?.aborted) throw new Error('Request was aborted');
    const dropdown = page.locator(MODEL_DROPDOWN).first();
    if ((await dropdown.count()) === 0) {
      console.log('[ClaudeWeb] Model selector not found; continuing with current model.');
      return;
    }
    const current = ((await dropdown.getAttribute('aria-label').catch(() => '')) || '').toLowerCase();
    if (current.includes(requested.toLowerCase().replace(/[-_]+/g, ' '))) return;
    console.log(`[ClaudeWeb] Attempting to select model: ${requested}`);
    await dropdown.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
    // Best-effort: find a menu item/option containing the requested text.
    const needle = requested.toLowerCase();
    const option = page.locator('[role="menuitem"],[role="option"],button').filter({ hasText: new RegExp(requested.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
    if ((await option.count()) > 0) {
      await option.click({ timeout: 5000 }).catch((e) => console.log('[ClaudeWeb] model option click failed:', e.message));
      await page.waitForTimeout(800);
    } else {
      console.log(`[ClaudeWeb] No model option matched "${requested}" (needle=${needle}); continuing with current model.`);
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  private async fillComposer(page: Page, text: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('Request was aborted');
    const composer = page.locator(COMPOSER).first();
    await composer.waitFor({ state: 'visible', timeout: 20_000 });
    await composer.click();
    // Clear existing content (ProseMirror/tiptap).
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    // Prefer insertText for multiline/special chars; fallback to evaluate for stubborn editors.
    try {
      await composer.fill(text);
    } catch {
      try {
        await page.keyboard.insertText(text);
      } catch {
        await page.evaluate(({ selector, value }) => {
          const el = document.querySelector(selector) as HTMLElement | null;
          if (!el) return;
          el.focus();
          el.textContent = value;
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        }, { selector: COMPOSER, value: text });
      }
    }
    await page.waitForTimeout(300);
  }

  private async clickSend(page: Page, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('Request was aborted');
    const send = page.locator(SEND).first();
    await send.waitFor({ state: 'visible', timeout: 15_000 });
    // Wait briefly for send to become enabled after input.
    for (let i = 0; i < 20; i++) {
      const disabled = await send.isDisabled().catch(() => false);
      const ariaDisabled = await send.getAttribute('aria-disabled').catch(() => null);
      if (!disabled && ariaDisabled !== 'true') break;
      await page.waitForTimeout(150);
    }
    await send.click({ timeout: 10_000 }).catch(async (e) => {
      console.log('[ClaudeWeb] send click fallback:', e.message);
      await page.keyboard.press('Enter');
    });
  }

  private extractAssistantText(texts: string[]): string {
    // Latest assistant-message text may include "Claude responded:" prefix and action chrome.
    let t = (texts[texts.length - 1] || '').trim();
    t = t.replace(/^Claude responded:\s*/i, '').trim();
    // Strip trailing action-bar/time tokens commonly appended in innerText dumps.
    t = t.replace(/\n+(?:[\uE000-\uF8FF]|\s)*(?:just now|[\d]+\s*[smhd]|Copy|Retry|Good response|Bad response|Share).*$/is, '').trim();
    return t;
  }

  private async waitForResponse(
    page: Page,
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const timeoutMs = this.config.timeoutMs ?? 300_000;
    const deadline = Date.now() + timeoutMs;
    let lastEmitted = '';
    let stableCount = 0;
    let sawAssistant = false;

    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('Request was aborted');
      await page.waitForTimeout(350);

      const snapshot = await page.evaluate((sel) => {
        const msgs = Array.from(document.querySelectorAll(sel.msg));
        const last = msgs[msgs.length - 1] as HTMLElement | undefined;
        const prose = last?.querySelector('.prose') as HTMLElement | null;
        const text = (prose?.innerText || last?.innerText || '').trim();
        const streaming = last?.getAttribute('data-is-streaming') === 'true';
        const stop = document.querySelector('button[aria-label*="Stop"], button[data-testid*="stop"]');
        return { count: msgs.length, text, streaming, hasStop: !!stop, url: location.href };
      }, { msg: ASSISTANT_MSG }).catch(() => ({ count: 0, text: '', streaming: false, hasStop: false, url: '' }));

      if (snapshot.count > 0) sawAssistant = true;
      const cleaned = this.extractAssistantText([snapshot.text]);
      if (cleaned && cleaned !== lastEmitted) {
        const delta = cleaned.startsWith(lastEmitted) ? cleaned.slice(lastEmitted.length) : cleaned;
        if (delta) {
          try { onChunk?.(delta); } catch { /* ignore sink errors */ }
        }
        lastEmitted = cleaned;
        stableCount = 0;
      } else if (cleaned) {
        stableCount++;
      }

      const doneByState = sawAssistant && cleaned && !snapshot.streaming && !snapshot.hasStop && stableCount >= 4;
      if (doneByState) return cleaned;

      // If we navigated away unexpectedly (e.g. error page), surface it.
      if (snapshot.url && /\/login|\/error/i.test(snapshot.url)) {
        throw new Error(`Claude web session became unauthenticated or errored. URL: ${snapshot.url}`);
      }
    }

    if (lastEmitted) return lastEmitted;
    throw new Error(
      `Claude web response timed out after ${timeoutMs}ms. Profile: ${this.config.userDataDir}. ` +
        'If a challenge appeared, solve it in the headed browser and retry.'
    );
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
      console.log(`[ClaudeWeb] Launching persistent Chrome (headless=${this.config.headless})...`);
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
