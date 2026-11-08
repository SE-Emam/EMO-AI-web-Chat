import { chromium, type BrowserContext, type Page } from 'playwright';
import type { ArenaDriver, ChatMessage, TencentAiWebConfig } from '../types.js';
import { formatMessages } from './models.js';
import { DEFAULT_TENCENT_AI_WEB_BASE_URL } from '../config.js';

/**
 * Tencent AI Studio (aistudio.tencent.ai / Hy AI Studio) web-session driver.
 *
 * - Dedicated persistent Chrome profile (separate from Arena/ZAI/Claude).
 * - Headed recommended for login/verification solved by the human.
 * - Model routing: use explicit prefixes to avoid conflicts:
 *     tencent-ai:<model>  or  tencentai:<model>
 *   `tencent-ai:default` keeps the session's current model.
 *
 * NOTE: Chat selectors (send, assistant response, streaming, model picker) require
 * authenticated capture from a live session and may need refinement.
 */
export class TencentAiWebDriver implements ArenaDriver {
  private readonly config: TencentAiWebConfig;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  /** Serializes requests — a single browser page cannot serve concurrent chats safely. */
  private queue: Promise<void> = Promise.resolve();

  constructor(config: TencentAiWebConfig) {
    this.config = config;
  }

  async listModels(): Promise<string[]> {
    return ['tencent-ai:default'];
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
    const base = (this.config.baseUrl || DEFAULT_TENCENT_AI_WEB_BASE_URL).replace(/\/$/, '');

    // NotImplemented fast-path BEFORE launching a browser (avoid profile-lock churn on stub).
    // Keep message actionable: run the login/capture helper first.
    throw new Error(
      'Tencent AI Studio (aistudio.tencent.ai) driver is not implemented yet (authenticated chat selectors pending capture). ' +
        'Run login helper, capture authenticated chat UI selectors (composer/send/stream/assistant response/model), then implement driver. ' +
        `Profile: ${this.config.userDataDir}`
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
      console.log(`[TencentAI] Launching persistent Chrome (headless=${this.config.headless})...`);
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
