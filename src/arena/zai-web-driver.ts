import { chromium, type BrowserContext, type Page } from 'playwright';
import type { ArenaDriver, ChatMessage, ZaiWebConfig } from '../types.js';
import { cleanupStaleProfileLocks } from '../browser/manager.js';
import { formatMessages } from './models.js';
import { ZaiDriver } from './zai-driver.js';
import { DEFAULT_ZAI_WEB_BASE_URL } from '../config.js';
import { providerSessionRouter } from './provider-session-router.js';
import { SerializedSessionSendQueue, STANDALONE_SERIALIZED_NOTES, type DriverCapabilities } from './driver-capabilities.js';

/** Assistant-message containers used by the chat.z.ai (Svelte) UI. */
const ASSISTANT_QUERY = '.chat-assistant';
const PROSE_QUERY = '.markdown-prose';
const CAPTCHA_MARKERS = ['drag the slider', 'security verification'];

/**
 * Arena-driver-compatible client for the z.ai **web chat** (chat.z.ai).
 *
 * - Drives a real, persistent Chrome profile (separate from the Arena profile) that
 *   holds a signed-in session — login via gateway UI or npm run login.
 * - Runs HEADED by default so the human can solve the Aliyun slider captcha by hand
 *   in the visible window when it appears (security design: captcha = human task).
 * - Exposes glm-5.3-flash free of charge (no API key), streaming deltas through onChunk.
 */
export class ZaiWebDriver implements ArenaDriver {
  private readonly config: ZaiWebConfig;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  /**
   * declared serialized session lane. A single browser page cannot
   * serve concurrent chats: same-session AND cross-session requests
   * serialize (the sessionKey is accepted and logged, never silently
   * dropped — declared in getCapabilities()).
   */
  private readonly sendQueue = new SerializedSessionSendQueue();

  constructor(config: ZaiWebConfig) {
    this.config = config;
  }

  async listModels(): Promise<string[]> {
    // Models exposed by chat.z.ai web UI (verified via model picker)
    return ['zai-web:default', 'glm-4.5-flash', 'glm-5.3-flash', 'glm-5.3', 'glm-5.2', 'glm-4.7-flash'];
  }

  async sendMessage(
    model: string,
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
    sessionKey = 'default'
  ): Promise<string> {
    return this.sendQueue.run('ZaiWeb', sessionKey, () =>
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
    const page = await this.ensurePage(signal);

    const shouldRotate = providerSessionRouter.shouldRotate('zai-web');
    if (shouldRotate) {
      providerSessionRouter.rotateSession('zai-web', 'turn_limit_reached');
      console.log(`[ZaiWeb] Preparing chat.z.ai for a fresh session...`);
      await this.prepareNewChat(page, signal);
    } else {
      console.log(`[ZaiWeb] Continuing active session in existing chat...`);
    }
    await this.selectModel(page, model).catch((e: Error) =>
      console.log(`[ZaiWeb] Model selection skipped (${model}): ${e.message}`)
    );

    const prompt = formatMessages(messages);
    const input = page.locator('#chat-input').first();
    const inputReady = await input
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!inputReady) {
      throw new Error(
        'z.ai web chat did not show the prompt input. Session may have expired — login via gateway UI (http://127.0.0.1:8989) or npm run login to refresh it.'
      );
    }
    await input.click().catch(() => {});
    await this.humanFill(page, input, prompt);
    await page.waitForTimeout(250);

    // Confirm text landed in the input (Svelte-controlled inputs can ignore programmatic fills).
    const inputValue = await this.readInputValue(page).catch(() => '');
    if (!inputValue.includes(prompt.slice(0, Math.min(20, prompt.length)))) {
      console.log(`[ZaiWeb] Input did not reflect prompt; retrying fill via keyboard...`);
      await input.click({ clickCount: 3 }).catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await page.keyboard.insertText(prompt).catch(() => input.fill(prompt).catch(() => {}));
      await page.waitForTimeout(250);
    }

    const submitted = await this.submitPrompt(page);
    if (!submitted) {
      throw new Error(
        'z.ai web chat: message could not be submitted (send button/Enter had no effect). Check the browser window.'
      );
    }
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
          providerSessionRouter.recordTurn('zai-web', page.url(), lastText.length);
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
      console.log(`[ZaiWeb] Launching persistent browser (headless=${this.config.headless !== false})...`);
      cleanupStaleProfileLocks(this.config.userDataDir);
      const baseOptions: Record<string, unknown> = {
        headless: this.config.headless !== false,
        viewport: { width: 1280, height: 800 },
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
   * Fills the prompt input reliably. For agent traffic (Hermes) prompts can be long;
   * character-by-character typing is too slow and causes apparent hangs/timeouts.
   * We prefer fast insertion and rely on post-fill verification + submit retries.
   */
  private async humanFill(page: Page, input: import('playwright').Locator, text: string): Promise<void> {
    await input.click().catch(() => {});
    await input.fill('').catch(() => {});
    // Fast path: insertText works well for large prompts and Svelte inputs in headed mode.
    try {
      await page.keyboard.insertText(text);
    } catch {
      try {
        await input.fill(text);
      } catch {
        // Last resort: chunked type without per-keystroke delay
        const step = Math.max(1, Math.floor(text.length / 20));
        for (let i = 0; i < text.length; i += step) {
          await input.type(text.slice(i, i + step)).catch(() => {});
        }
      }
    }
    await page.waitForTimeout(200);
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

  /** Best-effort: pick the requested model from chat.z.ai's model picker. */
  private async selectModel(page: Page, model: string): Promise<void> {
    const labelMap: Record<string, string> = {
      'glm-5.3-flash': 'GLM-5.3-Flash',
      'glm-5.3': 'GLM-5.3',
      'glm-5.2': 'GLM-5.2',
    };
    const want = labelMap[model.trim().toLowerCase()];
    if (!want) return;

    // If already selected, nothing to do.
    const current = await page
      .locator('button, div')
      .filter({ hasText: /^GLM-5\.\d/ })
      .first()
      .innerText()
      .catch(() => '');
    if (current.replace(/\s+/g, ' ').trim().includes(want)) return;

    // Open the model picker (current model indicator near the input area).
    const trigger = page.locator(`text=${want}`).first();
    if ((await trigger.count().catch(() => 0)) > 0) return; // somehow visible as selected
    const opener = page.locator('text=/GLM-5\\.\\d/i').first();
    await opener.click({ timeout: 4000 });
    await page.waitForTimeout(700);

    // Click the desired option in the opened list.
    const option = page.locator('button, [role="menuitem"], [role="option"]').filter({ hasText: want }).first();
    if ((await option.count().catch(() => 0)) === 0) {
      await page.keyboard.press('Escape').catch(() => {});
      throw new Error(`model option "${want}" not found`);
    }
    await option.click({ timeout: 4000 });
    await page.waitForTimeout(500);
  }

  private async readInputValue(page: Page): Promise<string> {
    return await page.evaluate(() => {
      const el = document.querySelector('#chat-input') as
        | HTMLTextAreaElement
        | HTMLInputElement
        | HTMLElement
        | null;
      if (!el) return '';
      if ('value' in el && typeof (el as any).value === 'string') return (el as any).value as string;
      return (el.innerText || el.textContent || '').toString();
    });
  }

  private async assistantThreadCount(page: Page): Promise<number> {
    return await page.locator(ASSISTANT_QUERY).count().catch(() => 0);
  }

  /** Submits the prompt via send button, retrying with Enter if needed. */
  private async submitPrompt(page: Page): Promise<boolean> {
    const beforeThreads = await this.assistantThreadCount(page);

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt === 0) {
        const send = page.locator('.sendMessageButton').first();
        await send.scrollIntoViewIfNeeded().catch(() => {});
        await send.click({ force: false }).catch(() => send.click({ force: true }).catch(() => {}));
      } else if (attempt === 1) {
        await page.locator('#chat-input').first().click().catch(() => {});
        await page.keyboard.press('Enter').catch(() => {});
      } else {
        await page.locator('#chat-input').first().click().catch(() => {});
        await page.keyboard.press('Control+Enter').catch(() => page.keyboard.press('Meta+Enter').catch(() => {}));
      }

      // Evidence of submission: input cleared, generating state, or new assistant thread.
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(350);
        const val = await this.readInputValue(page).catch(() => 'x');
        const cleared = !val || val.trim().length === 0;
        const generating = await this.isGenerating(page);
        const threads = await this.assistantThreadCount(page);
        if (cleared || generating || threads > beforeThreads) {
          return true;
        }
      }
      console.log(`[ZaiWeb] Submit attempt ${attempt + 1} did not take effect; retrying...`);
    }
    return false;
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
