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
  parseArenaTarget,
} from './models.js';

/**
 * Playwright-based driver for automating conversations on emo.ai direct chat.
 */
export class DefaultArenaDriver implements ArenaDriver {
  private browserManager: BrowserManager;
  private config: Config;
  /** Serializes requests — Arena uses a shared browser page/session. */
  private queue: Promise<void> = Promise.resolve();

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
    const run = this.queue.then(() =>
      this.sendMessageSerialized(model, messages, onChunk, signal)
    );
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
    if (signal?.aborted) {
      throw new Error('Request was aborted');
    }

    console.log(`[ArenaDriver] Starting sendMessage with model: ${model}`);
    const target = parseArenaTarget(model);
    const prompt = formatMessages(messages);

    if (target.mode === 'side-by-side') {
      throw new Error(
        `Arena mode "side-by-side" has been disabled in this bridge (dual-response extraction was unreliable). Use a direct model (e.g. claude-3-7-sonnet or arena/direct/<model>) or agent:<model>.`
      );
    }

    if (target.mode === 'agent') {
      return this.runArenaTarget({
        targetMode: 'agent',
        url: `${this.config.arenaBaseUrl}/agent`,
        prompt,
        onChunk,
        signal,
      });
    }

    const modelToken = target.model;
    const resolvedModel = resolveModelAlias(modelToken);
    let directChatUrl = `${this.config.arenaBaseUrl}/text/direct`;
    if (target.useModelParam) {
      directChatUrl = `${directChatUrl}?model=${encodeURIComponent(resolvedModel)}`;
    }
    const shouldSelectModel =
      modelToken &&
      modelToken !== 'auto' &&
      modelToken !== 'default' &&
      resolvedModel !== DEFAULT_MODEL;
    return this.runArenaTarget({
      targetMode: 'direct',
      url: directChatUrl,
      prompt,
      resolvedModel: shouldSelectModel ? resolvedModel : undefined,
      onChunk,
      signal,
    });
  }

  private async runArenaTarget(opts: {
    targetMode: 'direct' | 'agent' | 'side-by-side';
    url: string;
    prompt: string;
    resolvedModel?: string;
    modelLabels?: [string, string];
    onChunk?: (chunk: string) => void;
    signal?: AbortSignal;
  }): Promise<string> {
    console.log(`[ArenaDriver] Getting page...`);
    const page = await this.browserManager.getOrCreatePage();
    console.log(`[ArenaDriver] Page URL is: ${page.url ? page.url() : ''}`);

    await this.checkCloudflare(page);

    console.log(`[ArenaDriver] Preparing ${opts.targetMode} page: ${opts.url}`);
    await page.goto(opts.url, { waitUntil: 'commit' }).catch((e) =>
      console.log('[ArenaDriver] goto error:', e.message)
    );
    await this.waitForPageReady(page);
    await this.checkCloudflare(page);
    await this.dismissTermsModal(page);

    if (opts.targetMode === 'direct') {
      await this.switchToDirectChatTab(page);
      if (opts.resolvedModel) {
        console.log(`[ArenaDriver] Selecting model: ${opts.resolvedModel}`);
        await this.selectModel(page, opts.resolvedModel);
      }
    }

    console.log(`[ArenaDriver] Finding prompt input...`);
    const inputLoc = await this.findPromptInput(page);
    await inputLoc.waitFor?.({ state: 'visible', timeout: 15000 }).catch(() => {});
    if (page.waitForTimeout) await page.waitForTimeout(800);

    await this.fillPromptInput(page, inputLoc, opts.prompt);
    if (page.waitForTimeout) await page.waitForTimeout(300);
    console.log(`[ArenaDriver] Filled prompt. Finding send button...`);

    const sendLoc = await this.findSendButton(page);
    let sent = false;
    const isEnabled =
      typeof sendLoc?.isEnabled === 'function'
        ? await sendLoc.isEnabled().catch(() => false)
        : true;
    if (sendLoc && (await sendLoc.isVisible().catch(() => false)) && isEnabled) {
      console.log(`[ArenaDriver] Clicking send button...`);
      await sendLoc.click().catch((e) => console.log('[ArenaDriver] click send error:', e.message));
      sent = true;
    }
    if (!sent) {
      console.log(`[ArenaDriver] Pressing enter on prompt input...`);
      await inputLoc.press?.('Enter').catch(() => {});
      await page.keyboard?.press?.('Enter').catch(() => {});
    }

    await this.dismissTermsModal(page);
    if (process.env.ARENA_DEBUG === '1') {
      console.log('[ArenaDriver] ARENA_DEBUG=1 — screenshot capture enabled');
      await page.screenshot?.({ path: '/tmp/arena-driver-state.png' }).catch(() => {});
    }
    console.log(`[ArenaDriver] Entering streamResponse...`);
    return this.streamResponse(page, opts.targetMode, opts.prompt, opts.modelLabels, opts.onChunk, opts.signal);
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

  private async fillPromptInput(page: Page, inputLoc: Locator, prompt: string): Promise<void> {
    await inputLoc.click?.().catch(() => {});
    // Textareas
    try {
      const tag = await inputLoc.evaluate?.((el: any) => (el && el.tagName ? el.tagName.toLowerCase() : ''));
      const editable = await inputLoc.evaluate?.((el: any) => !!(el && el.isContentEditable));
      if (tag === 'textarea' || tag === 'input') {
        await inputLoc.fill?.(prompt);
        return;
      }
      if (editable) {
        await page.keyboard?.press?.(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
        await page.keyboard?.press?.('Backspace').catch(() => {});
        await page.keyboard?.type?.(prompt, { delay: 5 } as any).catch(async () => {
          await inputLoc.evaluate?.((el: any, text: string) => {
            el.focus?.();
            if (el.isContentEditable) {
              document.execCommand?.('selectAll', false);
              document.execCommand?.('insertText', false, text);
              if (!(el.innerText || el.textContent || '').includes(text.slice(0, 20))) el.textContent = text;
            }
          }, prompt).catch(() => {});
        });
        return;
      }
    } catch {
      // fall through
    }
    await inputLoc.fill?.(prompt).catch(async () => {
      await page.keyboard?.type?.(prompt, { delay: 5 } as any).catch(() => {});
    });
  }

  private normalizeText(t: string): string {
    return (t || '').replace(/\s+/g, ' ').trim();
  }

  private async getAssistantTexts(
    page: Page,
    targetMode: 'direct' | 'agent' | 'side-by-side',
    prompt: string
  ): Promise<string[]> {
    const promptNorm = this.normalizeText(prompt).slice(0, 400);
    try {
      const texts = await page.evaluate?.((args: any) => {
        const { targetMode, promptNorm } = args || {};
        const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
        const p = norm(promptNorm || '');
        const els = Array.from(
          document.querySelectorAll('.prose, [data-message-author-role="assistant"], [data-testid="bot"], .bot-message')
        );
        const out: string[] = [];
        for (const el of els as HTMLElement[]) {
          if (el.closest('.bg-surface-raised')) continue;
          if (el.closest('.user-message')) continue;
          if (el.closest('[data-testid="user"]')) continue;
          if (el.closest('.not-prose')) continue;
          const t = norm(el.innerText || el.textContent || '');
          if (!t) continue;
          if (p && (t === p || t.startsWith(p) || p.startsWith(t))) continue;
          // Avoid echoing the full multi-turn prompt in agent/direct
          if (p && p.length > 40 && t.length > 40 && p.includes(t)) continue;
          out.push(t);
        }
        if (targetMode === 'side-by-side') {
          // return last two distinct non-empty assistant blocks
          const uniq: string[] = [];
          for (const t of out) if (!uniq.includes(t)) uniq.push(t);
          return uniq.slice(-2);
        }
        if (targetMode === 'agent') {
          const uniq: string[] = [];
          for (const t of out) if (!uniq.includes(t)) uniq.push(t);
          return uniq.length ? [uniq[uniq.length - 1]] : [];
        }
        return out.length ? [out[out.length - 1]] : [];
      }, { targetMode, promptNorm });
      if (Array.isArray(texts)) return texts.filter(Boolean);
    } catch {
      // fallback
    }

    // Locator fallback - single latest (keeps existing behavior for tests/mocks)
    const latest = await this.getLatestBotTextLegacy(page);
    return latest ? [latest] : [];
  }

  private async getLatestBotTextLegacy(page: Page): Promise<string> {
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
      if (typeof text === 'string') return text;
    } catch {}
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
          if (text) return text;
        }
      } catch {}
    }
    return '';
  }

  private async streamResponse(
    page: Page,
    targetMode: 'direct' | 'agent' | 'side-by-side' = 'direct',
    prompt = '',
    modelLabels?: [string, string],
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    let lastText = '';
    let sawGenerating = false;
    let stablePollCount = 0;
    // ~120ms per poll: direct/SBS ~84s, agent ~6 min for longer multi-step runs.
    const maxPolls = targetMode === 'agent' ? 3000 : 700;

    for (let poll = 0; poll < maxPolls; poll++) {
      if (signal?.aborted) {
        await this.tryClickStop(page);
        throw new Error('Request was aborted');
      }

      await this.checkRateLimit(page);
      await this.checkCloudflare(page);

      const generating = await this.isGenerating(page);
      const texts = await this.getAssistantTexts(page, targetMode, prompt);
      const currentText =
        targetMode === 'side-by-side'
          ? (texts.length >= 2
              ? `[A: ${modelLabels?.[0] || 'model-a'}]\n${texts[0]}\n\n[B: ${modelLabels?.[1] || 'model-b'}]\n${texts[1]}`
              : texts.length === 1
                ? `[A: ${modelLabels?.[0] || 'model-a'}]\n${texts[0]}\n\n[B: ${modelLabels?.[1] || 'model-b'}]\n(waiting for response...)`
                : '')
          : (texts[0] || '');

      if (poll % 10 === 0) {
        console.log(`[ArenaDriver] poll ${poll} mode=${targetMode}: generating=${generating}, sawGenerating=${sawGenerating}, parts=${texts.length}, currentText="${currentText.slice(0, 80)}", stable=${stablePollCount}`);
      }
      if (generating || currentText.length > 0) sawGenerating = true;

      if (currentText.length > lastText.length && currentText.startsWith(lastText)) {
        const delta = currentText.slice(lastText.length);
        lastText = currentText;
        stablePollCount = 0;
        onChunk?.(delta);
      } else if (currentText !== lastText && currentText.length > 0) {
        // non-monotonic change (common in SBS/agent) - emit full snapshot delta if streaming, but keep simple
        lastText = currentText;
        stablePollCount = 0;
      } else if (currentText.length > 0) {
        stablePollCount++;
      }

      const sbsReady = targetMode === 'side-by-side' ? texts.length >= 2 : true;
      if (
        (currentText.length > 0 && sbsReady && !generating && stablePollCount >= 6) ||
        (currentText.length > 0 && sbsReady && stablePollCount >= 18)
      ) {
        console.log(`[ArenaDriver] Generation completed! mode=${targetMode} parts=${texts.length} chars=${currentText.length}`);
        // If we never streamed chunks (snapshot mode) emit once
        if (onChunk && lastText === '' && currentText) onChunk(currentText);
        return currentText;
      }

      if (page.waitForTimeout) await page.waitForTimeout(120);
      else await new Promise((r) => setTimeout(r, 120));
    }

    // timeout: return best effort
    const texts = await this.getAssistantTexts(page, targetMode, prompt).catch(() => [] as string[]);
    if (targetMode === 'side-by-side') {
      if (texts.length >= 2) return `[A: ${modelLabels?.[0] || 'model-a'}]\n${texts[0]}\n\n[B: ${modelLabels?.[1] || 'model-b'}]\n${texts[1]}`;
      if (texts.length === 1) return `[A: ${modelLabels?.[0] || 'model-a'}]\n${texts[0]}\n\n[B: ${modelLabels?.[1] || 'model-b'}]\n(no response captured)`;
    }
    return texts[0] || '';
  }
}
