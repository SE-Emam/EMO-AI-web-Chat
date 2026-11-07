import type { Page, Locator } from 'playwright';
import { loadConfig } from '../config.js';
import type { ArenaDriver, ChatMessage, Config } from '../types.js';
import type { BrowserManager } from '../browser/manager.js';
import { ARENA_SELECTORS } from './selectors.js';
import {
  DEFAULT_MODEL,
  KNOWN_ARENA_MODELS,
  resolveModelAlias,
  formatMessages,
} from './models.js';

/**
 * Playwright-based driver for automating conversations on arena.ai direct chat.
 */
export class DefaultArenaDriver implements ArenaDriver {
  private browserManager: BrowserManager;
  private config: Config;

  constructor(browserManager: BrowserManager, config?: Partial<Config>) {
    this.browserManager = browserManager;
    this.config = config ? loadConfig(config) : browserManager.config;
  }

  /**
   * Lists available Arena models.
   */
  async listModels(): Promise<string[]> {
    return [...KNOWN_ARENA_MODELS];
  }

  /**
   * Sends a chat prompt to Arena direct chat and streams the response text.
   */
  async sendMessage(
    model: string,
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    if (signal?.aborted) {
      throw new Error('Request was aborted');
    }

    console.log(`[ArenaDriver] Starting sendMessage with model: ${model}`);
    const resolvedModel = resolveModelAlias(model);
    const prompt = formatMessages(messages);
    console.log(`[ArenaDriver] Getting page...`);
    const page = await this.browserManager.getOrCreatePage();
    console.log(`[ArenaDriver] Page URL is: ${page.url ? page.url() : ''}`);

    // Check for Cloudflare challenge before doing anything
    await this.checkCloudflare(page);

    // Ensure we are on a clean direct chat page
    const directChatUrl = `${this.config.arenaBaseUrl}/text/direct`;
    console.log(`[ArenaDriver] Preparing direct chat page...`);
    await page.goto(directChatUrl, { waitUntil: 'commit' }).catch((e) =>
      console.log('[ArenaDriver] goto error:', e.message)
    );
    await this.waitForPageReady(page);

    // Check for Cloudflare challenge after navigation
    await this.checkCloudflare(page);

    // Dismiss terms of use / privacy modal if present
    await this.dismissTermsModal(page);

    // Switch to Direct Chat tab if visible
    await this.switchToDirectChatTab(page);

    // Select model only if explicitly requested (not auto/default)
    if (
      model &&
      model !== 'auto' &&
      model !== 'default' &&
      resolvedModel !== DEFAULT_MODEL
    ) {
      console.log(`[ArenaDriver] Selecting model: ${resolvedModel}`);
      await this.selectModel(page, resolvedModel);
    }

    // Wait for prompt input to be visible and ready
    console.log(`[ArenaDriver] Finding prompt input...`);
    const inputLoc = await this.findPromptInput(page);
    await inputLoc.waitFor?.({ state: 'visible', timeout: 10000 }).catch(() => {});
    if (page.waitForTimeout) {
      await page.waitForTimeout(1000);
    }

    await inputLoc.click?.().catch(() => {});
    await inputLoc.fill(prompt);
    if (page.waitForTimeout) {
      await page.waitForTimeout(300);
    }
    console.log(`[ArenaDriver] Filled prompt. Finding send button...`);

    // Click send button
    const sendLoc = await this.findSendButton(page);
    let sent = false;
    const isEnabled =
      typeof sendLoc?.isEnabled === 'function'
        ? await sendLoc.isEnabled().catch(() => false)
        : true;
    if (
      sendLoc &&
      (await sendLoc.isVisible().catch(() => false)) &&
      isEnabled
    ) {
      console.log(`[ArenaDriver] Clicking send button...`);
      await sendLoc.click().catch((e) => console.log('[ArenaDriver] click send error:', e.message));
      sent = true;
    }
    if (!sent) {
      console.log(`[ArenaDriver] Pressing enter on prompt input...`);
      await inputLoc.press?.('Enter').catch(() => {});
    }

    // If terms modal popped up after clicking send, dismiss and retry send
    await this.dismissTermsModal(page);

    await page.screenshot?.({ path: '/tmp/arena-driver-state.png' }).catch(() => {});
    console.log(`[ArenaDriver] Saved screenshot to /tmp/arena-driver-state.png. Entering streamResponse...`);
    // Stream response until generation completes or abort is signaled
    return this.streamResponse(page, onChunk, signal);
  }

  /**
   * Closes the underlying browser context.
   */
  async close(): Promise<void> {
    await this.browserManager.close();
  }

  private async dismissTermsModal(page: Page): Promise<void> {
    try {
      for (const sel of ARENA_SELECTORS.termsAgree) {
        const loc = page.locator(sel);
        if (
          (await loc.count().catch(() => 0)) > 0 &&
          (await loc.first().isVisible().catch(() => false))
        ) {
          await loc.first().click().catch(() => {});
          await page.waitForTimeout?.(500).catch(() => {});
          break;
        }
      }
    } catch {
      // Ignore terms modal dismissal errors
    }
  }

  private async waitForPageReady(page: Page): Promise<void> {
    try {
      if (typeof page.title === 'function') {
        for (let i = 0; i < 15; i++) {
          const title = (await page.title().catch(() => '')) || '';
          if (title && !title.includes('Just a moment')) {
            break;
          }
          if (page.waitForTimeout) {
            await page.waitForTimeout(1000);
          }
        }
      }
      if (page.waitForTimeout) {
        await page.waitForTimeout(1000);
      }
    } catch {
      // Ignore
    }
  }

  private async checkCloudflare(page: Page): Promise<void> {
    for (const sel of ARENA_SELECTORS.cloudflareChallenge) {
      try {
        const loc = page.locator(sel);
        const count = await loc.count();
        if (count > 0) {
          const visible = await loc.first().isVisible();
          if (visible) {
            throw new Error(
              "Cloudflare Turnstile challenge detected on Arena. Please run 'webbridge login' or open the browser in non-headless mode to solve the verification."
            );
          }
        }
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.message.includes('Cloudflare Turnstile challenge detected')
        ) {
          throw err;
        }
      }
    }
  }

  private async switchToDirectChatTab(page: Page): Promise<void> {
    try {
      for (const sel of ARENA_SELECTORS.directChatTab) {
        const loc = page.locator(sel);
        if (
          (await loc.count().catch(() => 0)) > 0 &&
          (await loc.first().isVisible().catch(() => false))
        ) {
          await loc.first().click().catch(() => {});
          break;
        }
      }
    } catch {
      // Ignore tab switch errors
    }
  }

  private async selectModel(page: Page, targetModel: string): Promise<void> {
    try {
      for (const sel of ARENA_SELECTORS.modelDropdown) {
        const loc = page.locator(sel);
        if (
          (await loc.count().catch(() => 0)) > 0 &&
          (await loc.first().isVisible().catch(() => false))
        ) {
          const dropdown = loc.first();
          await dropdown.click().catch(() => {});

          for (const optSel of ARENA_SELECTORS.dropdownOption(targetModel)) {
            const optLoc = page.locator(optSel);
            if ((await optLoc.count().catch(() => 0)) > 0) {
              await optLoc.first().click().catch(() => {});
              return;
            }
          }

          // If dropdown supports text fill
          await dropdown.fill?.(targetModel).catch(() => {});
          await page.keyboard?.press?.('Escape').catch(() => {});
          return;
        }
      }
    } catch {
      // Ignore model select errors
    }
  }

  private async findPromptInput(page: Page): Promise<Locator> {
    for (const sel of ARENA_SELECTORS.promptInput) {
      try {
        const loc = page.locator(sel);
        if (
          (await loc.count().catch(() => 0)) > 0 &&
          (await loc.first().isVisible().catch(() => false))
        ) {
          return loc.first();
        }
      } catch {
        // Continue searching
      }
    }
    const fallback = page.locator(ARENA_SELECTORS.promptInput[0]).first();
    await fallback.waitFor?.({ state: 'visible', timeout: 5000 }).catch(() => {});
    return fallback;
  }

  private async findSendButton(page: Page): Promise<Locator | null> {
    for (const sel of ARENA_SELECTORS.sendButton) {
      try {
        const loc = page.locator(sel);
        if (
          (await loc.count().catch(() => 0)) > 0 &&
          (await loc.first().isVisible().catch(() => false))
        ) {
          return loc.first();
        }
      } catch {
        // Continue searching
      }
    }
    return null;
  }

  private async tryClickStop(page: Page): Promise<void> {
    try {
      for (const sel of ARENA_SELECTORS.stopButton) {
        const loc = page.locator(sel);
        if (
          (await loc.count().catch(() => 0)) > 0 &&
          (await loc.first().isVisible().catch(() => false))
        ) {
          await loc.first().click().catch(() => {});
          break;
        }
      }
    } catch {
      // Ignore error when clicking stop
    }
  }

  private async checkRateLimit(page: Page): Promise<void> {
    try {
      const isRateLimited = await page.evaluate?.(() => {
        if (typeof document === 'undefined') return false;
        const text = document.body ? document.body.innerText : '';
        return (
          text.includes("You've reached a rate limit") ||
          text.includes('rate limit. Please try again')
        );
      });
      if (isRateLimited) {
        const error = new Error(
          "You've reached a rate limit on Arena. Please try again in a moment."
        ) as Error & { statusCode?: number; type?: string };
        error.statusCode = 429;
        error.type = 'rate_limit_error';
        throw error;
      }
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err as { statusCode?: number }).statusCode === 429
      ) {
        throw err;
      }
    }
  }

  private async isGenerating(page: Page): Promise<boolean> {
    try {
      for (const sel of ARENA_SELECTORS.stopButton) {
        const loc = page.locator(sel);
        if (
          (await loc.count().catch(() => 0)) > 0 &&
          (await loc.first().isVisible().catch(() => false))
        ) {
          return true;
        }
      }
    } catch {
      // Ignore error
    }
    return false;
  }

  private async getLatestBotText(page: Page): Promise<string> {
    try {
      const text = await page.evaluate?.(() => {
        if (typeof document === 'undefined') return undefined;
        const proseElements = Array.from(
          document.querySelectorAll('.prose, [data-testid="bot"], .bot-message')
        );
        const botElements = proseElements.filter((el) => {
          return (
            !el.closest('.bg-surface-raised') &&
            !el.closest('.user-message') &&
            !el.closest('[data-testid="user"]')
          );
        });
        if (botElements.length > 0) {
          const last = botElements[botElements.length - 1];
          return (last as HTMLElement).innerText || '';
        }
        return '';
      });
      if (typeof text === 'string') {
        return text;
      }
    } catch {
      // Continue to locator fallback (for unit tests where evaluate throws or is not configured)
    }

    for (const sel of ARENA_SELECTORS.botMessage) {
      try {
        const loc = page.locator(sel);
        const count = await loc.count().catch(() => 0);
        if (count > 0) {
          const last =
            typeof loc.nth === 'function'
              ? loc.nth(count - 1)
              : typeof loc.first === 'function'
                ? loc.first()
                : loc;
          const text = (await last.innerText().catch(() => '')) || '';
          if (text) {
            return text;
          }
        }
      } catch {
        // Continue searching
      }
    }
    return '';
  }

  private async streamResponse(
    page: Page,
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    let lastLength = 0;
    let accumulatedText = '';
    let sawGenerating = false;
    let stablePollCount = 0;
    const maxPolls = 600; // ~60 seconds timeout (at 100ms interval)

    for (let poll = 0; poll < maxPolls; poll++) {
      if (signal?.aborted) {
        await this.tryClickStop(page);
        throw new Error('Request was aborted');
      }

      await this.checkRateLimit(page);
      await this.checkCloudflare(page);

      const generating = await this.isGenerating(page);
      const currentText = await this.getLatestBotText(page);
      if (poll % 10 === 0) {
        console.log(`[ArenaDriver] poll ${poll}: generating=${generating}, sawGenerating=${sawGenerating}, currentText="${currentText}", accum="${accumulatedText}", stable=${stablePollCount}`);
      }
      if (generating || currentText.length > 0) {
        sawGenerating = true;
      }

      if (currentText.length > lastLength) {
        const delta = currentText.slice(lastLength);
        lastLength = currentText.length;
        accumulatedText = currentText;
        stablePollCount = 0;
        onChunk?.(delta);
      } else if (accumulatedText.length > 0) {
        stablePollCount++;
      }

      // Generation is done if:
      // 1. Text is accumulated, no stop button is active, and text has been stable for 5 polls (500ms)
      // 2. OR text has been stable for >= 15 polls (1.5s)
      if (
        (accumulatedText.length > 0 && !generating && stablePollCount >= 5) ||
        (accumulatedText.length > 0 && stablePollCount >= 15)
      ) {
        console.log(`[ArenaDriver] Generation completed! Returning accumulated text (${accumulatedText.length} chars)`);
        break;
      }

      if (page.waitForTimeout) {
        await page.waitForTimeout(100);
      } else {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    return accumulatedText;
  }
}
