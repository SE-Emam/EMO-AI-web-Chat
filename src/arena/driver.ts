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

    const resolvedModel = resolveModelAlias(model);
    const prompt = formatMessages(messages);
    const page = await this.browserManager.getOrCreatePage();

    // Check for Cloudflare challenge before doing anything
    await this.checkCloudflare(page);

    // Ensure we are on the arena direct chat page
    const directChatUrl = `${this.config.arenaBaseUrl}/?arena=direct`;
    const currentUrl = page.url ? page.url() : '';
    if (
      !currentUrl ||
      currentUrl === 'about:blank' ||
      !currentUrl.includes(this.config.arenaBaseUrl)
    ) {
      await page.goto(directChatUrl).catch(() => {});
    }

    // Check for Cloudflare challenge after navigation
    await this.checkCloudflare(page);

    // Switch to Direct Chat tab if visible
    await this.switchToDirectChatTab(page);

    // Select model if available
    await this.selectModel(page, resolvedModel);

    // Find and fill prompt input
    const inputLoc = await this.findPromptInput(page);
    await inputLoc.fill(prompt);

    // Click send button
    const sendLoc = await this.findSendButton(page);
    if (sendLoc) {
      await sendLoc.click();
    } else {
      await inputLoc.press?.('Enter').catch(() => {});
    }

    // Stream response until generation completes or abort is signaled
    return this.streamResponse(page, onChunk, signal);
  }

  /**
   * Closes the underlying browser context.
   */
  async close(): Promise<void> {
    await this.browserManager.close();
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
    return page.locator(ARENA_SELECTORS.promptInput[0]).first();
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

      await this.checkCloudflare(page);

      const generating = await this.isGenerating(page);
      if (generating) {
        sawGenerating = true;
      }

      const currentText = await this.getLatestBotText(page);

      if (signal?.aborted) {
        await this.tryClickStop(page);
        throw new Error('Request was aborted');
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
      // 1. We saw generation active and now stop button is gone and we have accumulated text
      // 2. OR text has been stable for multiple polls and not currently generating
      if (
        (sawGenerating && !generating && accumulatedText.length > 0) ||
        (accumulatedText.length > 0 && stablePollCount >= 10 && !generating)
      ) {
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
