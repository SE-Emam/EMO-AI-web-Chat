import { chromium, type BrowserContext, type Page } from 'playwright';
import type { ArenaDriver, ChatMessage, ZaiWebConfig } from '../types.js';
import { formatMessages } from './models.js';
import { ZaiDriver } from './zai-driver.js';
import { DEFAULT_ZAI_WEB_BASE_URL } from '../config.js';

/** Assistant-message containers used by the chat.z.ai (Svelte) UI. */
const ASSISTANT_QUERY = '.chat-assistant';
const PROSE_QUERY = '.markdown-prose';
const CAPTCHA_MARKERS = ['drag the slider', 'security verification'];

/**
 * Arena-driver-compatible client for the z.ai **web chat** (chat.z.ai).
 *
 * - Drives a real, persistent Chrome profile (separate from the Arena profile) that
 *   holds a signed-in session — see scripts/login-zai-web.sh.
 * - Runs HEADED by default so the human can solve the Aliyun slider captcha by hand
 *   in the visible window when it appears (security design: captcha = human task).
 * - Exposes glm-5.3-flash free of charge (no API key), streaming deltas through onChunk.
 */
export class ZaiWebDriver implements ArenaDriver {
  private readonly config: ZaiWebConfig;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(config: ZaiWebConfig) {
    this.config = config;
  }

  async listModels(): Promise<string[]> {
    return ['glm-5.3-flash', 'glm-5.3-flashx'];
  }

  async sendMessage(
    model: string,
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const page = await this.ensurePage(signal);

    console.log(`[ZaiWeb] Preparing chat.z.ai for a new prompt...`);
    await this.prepareNewChat(page, signal);

    const prompt = formatMessages(messages);
    const input = page.locator('#chat-input').first();
    const inputReady = await input
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!inputReady) {
      throw new Error(
        'z.ai web chat did not show the prompt input. Session may have expired — run scripts/login-zai-web.sh once (headfully) to refresh it.'
      );
    }
    await input.click().catch(() => {});
    // Type with a slight delay to keep interaction telemetry human-ish.
    await this.humanFill(page, input, prompt);

    const send = page.locator('.sendMessageButton').first();
    await send.click().catch(() => {});
    console.log(`[ZaiWeb] Prompt submitted. Waiting for the assistant...`);

    let lastText = '';
    let stablePolls = 0;
    let sawAnyText = false;
    const startedAt = Date.now();
    let captchaNotified = false;
    while (Date.now() - startedAt < this.config.timeoutMs) {
      if (signal?.aborted) {
        await this.clickStop(page);
        throw new Error('Request was aborted');
      }

      await page.waitForTimeout(400);

      // Aliyun slider captcha: SECURITY BY DESIGN the captcha is solved by the human,
      // in the visible Chrome window. The automation pauses and resumes automatically
      // once verification completes (and never attempts to bypass it programmatically).
      const captchaActive = await this.isCaptchaBlocking(page);
      if (captchaActive) {
        if (!captchaNotified) {
          captchaNotified = true;
          console.log(
            `\n⏳ [ZaiWeb] Security verification required — please solve the slider in the Chrome window.\n` +
              `    Automation resumes automatically as soon as you complete it (waiting up to ${Math.round(this.config.captchaWaitMs / 1000)}s).\n`
          );
        }
        continue;
      }
      if (captchaNotified && !captchaActive) {
        captchaNotified = false;
        console.log(`✅ [ZaiWeb] Verification complete — resuming.`);
      }

      const botText = await this.getLatestBotText(page);
      const cleaned = this.stripThinkingLabel(botText);
      if (cleaned && cleaned !== lastText) {
        if (!sawAnyText) {
          console.log(`[ZaiWeb] First tokens visible... streaming.`);
        }
        sawAnyText = true;
        if (onChunk && cleaned.startsWith(lastText)) {
          onChunk(cleaned.slice(lastText.length));
        }
        lastText = cleaned;
      }

      const generating = await this.isGenerating(page);
      if (sawAnyText && !generating && lastText.length > 0) {
        stablePolls++;
        if (stablePolls >= 3) {
          return lastText;
        }
      } else {
        stablePolls = 0;
      }

      if (await this.isRateLimited(page)) {
        throw new Error(
          'z.ai web chat rate/message limit reached. Wait a moment and retry.'
        );
      }
    }

    throw new Error(`z.ai web chat timed out after ${this.config.timeoutMs} ms`);
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

  /**
   * Removes the collapsed reasoning-toggle label ("Thought Process…") that the UI
   * renders above the actual answer, in its known localized spellings.
   */
  private stripThinkingLabel(text: string): string {
    if (!text) return text;
    return text
      .replace(
        /^\s*(thought\s*process|thinking\s*(\.\.\.|…)?|يفكر\s*(\.\.\.|…)?|تفكير\s*(\.\.\.|…)?)\s*\n+\s*/i,
        ''
      )
      .trim();
  }

  // -----
  // Browser context management (mirrors BrowserManager's anti-detection approach)
  // -----
  private async ensurePage(signal?: AbortSignal): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    if (!this.context) {
      console.log(`[ZaiWeb] Launching persistent Chrome (headless=${this.config.headless})...`);
      this.context = await chromium.launchPersistentContext(this.config.userDataDir, {
        channel: 'chrome',
        headless: this.config.headless,
        viewport: { width: 1280, height: 800 },
        args: ['--disable-blink-features=AutomationControlled'],
        ignoreDefaultArgs: ['--enable-automation'],
      });
    }

    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
    return this.page;
  }

  /**
   * Ensures a fresh, ready chat page: load home, remove onboarding tour overlays
   * (driver.js), then click "New Chat" so previous messages never leak into the
   * next extraction.
   */
  private async prepareNewChat(page: Page, signal?: AbortSignal): Promise<void> {
    const url = this.config.baseUrl || DEFAULT_ZAI_WEB_BASE_URL;
    console.log(`[ZaiWeb] Navigating to: ${url}`);
    await page
      .goto(url, { waitUntil: 'domcontentloaded' })
      .catch((e: Error) => console.log(`[ZaiWeb] goto error: ${e.message}`));

    // Wait for hydration on slow networks (double-check captcha on the landing page)
    const ready = await page
      .locator('#chat-input')
      .first()
      .waitFor({ state: 'visible', timeout: 25_000 })
      .then(() => true)
      .catch(() => false);
    console.log(`[ZaiWeb] Prompt input ready: ${ready}`);

    await this.dismissTourOverlay(page);
    await this.clickNewChat(page);
    await this.dismissTourOverlay(page);
  }

  private async dismissTourOverlay(page: Page): Promise<void> {
    try {
      for (let i = 0; i < 4; i++) {
        const hasOverlay = await page
          .locator('.driver-overlay, #driver-popover-content')
          .count()
          .catch(() => 0);
        if (!hasOverlay) return;
        // Prefer "Skip"/"Next" buttons of the driver popover, then Escape, then hard-remove.
        const skipClicked = await page
          .locator('#driver-popover-content button')
          .first()
          .click()
          .then(() => true)
          .catch(() => false);
        if (!skipClicked) {
          await page.keyboard.press('Escape').catch(() => {});
        }
        await page.waitForTimeout(400);
        await page.evaluate(() => {
          document.querySelector('.driver-overlay')?.remove();
          document.querySelector('#driver-popover-content')?.remove();
          document.querySelectorAll('.driver-1719536130333-overlay').forEach((e) => e.remove());
        });
      }
    } catch {
      // Non-fatal
    }
  }

  private async clickNewChat(page: Page): Promise<void> {
    const newChat = page
      .locator('.navNewChat, [aria-label="New Chat"]')
      .first();
    if ((await newChat.count().catch(() => 0)) > 0) {
      await newChat.click().catch(() => {});
      await page.waitForTimeout(800);
    }
  }

  /**
   * Clicks into the box then types with small randomized delays. The final Enter
   * is not used for submission (button click follows) to keep the flow explicit.
   */
  private async humanFill(page: Page, input: import('playwright').Locator, text: string): Promise<void> {
    await input.fill('').catch(() => {});
    if (this.config.headless) {
      await input.fill(text).catch(() => {});
      await page.waitForTimeout(300);
      return;
    }
    // Chunked typing: reasonably fast while producing real key events.
    const step = Math.max(1, Math.floor(text.length / 40));
    for (let i = 0; i < text.length; i += step) {
      await input.type(text.slice(i, i + step), { delay: 20 }).catch(() => {
        // Fallback: fill everything if typing fails midway
        return input.fill(text);
      });
    }
    await page.waitForTimeout(300);
  }

  /**
   * The last assistant message on the open thread. The chat.z.ai DOM nests the
   * rendered answer inside `.chat-assistant` → `.markdown-prose`; the "Thought
   * Process" collapsible lives outside those prose nodes and is not included.
   */
  private async getLatestBotText(page: Page): Promise<string> {
    try {
      return await page.evaluate(
        ({ threadSel, proseSel }) => {
          const PLACEHOLDER = /^(thinking|تفكير|يفكر)(\s*(\.\.\.|…))?\s*$/i;
          if (typeof document === 'undefined') return '';
          const threads = Array.from(document.querySelectorAll(threadSel));
          if (threads.length === 0) return '';
          const lastThread = threads[threads.length - 1];
          const proseNodes = Array.from(lastThread.querySelectorAll(proseSel));
          const parts: string[] = [];
          for (const node of proseNodes) {
            // Skip nodes rendered inside thinking/summary-style components
            const cls = (node.className || '').toString().toLowerCase();
            if (/thought|thinking/.test(cls)) continue;
            const txt = ((node as HTMLElement).innerText || '').trim();
            if (!txt || PLACEHOLDER.test(txt)) continue;
            parts.push(txt);
          }
          return parts.join('\n\n');
        },
        { threadSel: ASSISTANT_QUERY, proseSel: PROSE_QUERY }
      );
    } catch {
      return '';
    }
  }

  /**
   * Generating state: the round send button turns into a black "Stop" square while
   * the three-dot typing indicator is present.
   */
  private async isGenerating(page: Page): Promise<boolean> {
    try {
      return await page.evaluate(() => {
        const btn = document.querySelector('.sendMessageButton');
        if (!btn) return false;
        const style = window.getComputedStyle(btn);
        // The stop state is a solid dark button; otherwise it is a light arrow button.
        return style.backgroundColor && /rgb\((\d+),/i.test(style.backgroundColor)
          ? parseInt(style.backgroundColor.match(/rgb\((\d+),/i)![1], 10) < 100
          : false;
      });
    } catch {
      return false;
    }
  }

  private async clickStop(page: Page): Promise<void> {
    try {
      const btn = page.locator('.sendMessageButton').first();
      if ((await btn.count().catch(() => 0)) > 0) {
        await btn.click().catch(() => {});
      }
    } catch {
      // ignore
    }
  }

  private async isRateLimited(page: Page): Promise<boolean> {
    try {
      return await page.evaluate((markers: string[]) => {
        const text = document.body.innerText || '';
        return markers.some((m) =>
          text.includes(m)
        );
      }, ['rate limit', 'too many requests', 'capacity limit', 'insufficient']);
    } catch {
      return false;
    }
  }

  private async isCaptchaBlocking(page: Page): Promise<boolean> {
    try {
      return await page.evaluate((markers: string[]) => {
        if (typeof document === 'undefined') return false;
        const text = document.body.innerText || '';
        return markers.some((m) => text.includes(m));
      }, CAPTCHA_MARKERS);
    } catch {
      return false;
    }
  }
}

export type { ZaiDriver };
