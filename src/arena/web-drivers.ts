import { chromium, type BrowserContext, type Page } from 'playwright';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { ArenaDriver, ChatMessage, CommonWebConfig } from '../types.js';
import type { WebProviderId } from '../gateway/types.js';
import { cleanupStaleProfileLocks } from '../browser/manager.js';
import { SessionRegistry } from '../sessions/session-registry.js';
import { OwnershipLedger } from '../sessions/ownership-ledger.js';
import { BrowserOwner } from '../browser/browser-owner.js';
import { TabScheduler } from '../browser/tab-scheduler.js';
import { TabWorkerPool } from './tab-worker-pool.js';
import { SessionQueue } from '../sessions/session-queue.js';
import { SCHEDULED_PER_SESSION_NOTES } from './driver-capabilities.js';
import { stripNeutralCorrections } from './tool-bridge-markers.js';
import { formatMessages, extractMessageText } from './models.js';
import { ProfileBusyError } from './profile-busy-error.js';
import { OwnerIpcManager } from '../ipc/profile-owner-router.js';
import { parseToolCallsFromResponse } from '../server/tool-interpreter.js';
import { providerSessionRouter } from './provider-session-router.js';

/**
 * Generated media (images created by the web chat) is downloaded here so it can
 * be handed back to the calling agent as a real file instead of being lost.
 */
const MEDIA_DIR = path.join(os.homedir(), '.arena-webbridge', 'media');

/**
 * Selectors for image-generation result tiles. ChatGPT renders each generated
 * image inside a gallery tile (data-web-image-tile / generated-image-preview);
 * the <img> itself is a blob: URL that must be read from inside the page.
 * Each driver opts in via `generatedImageSelectors`, so sites without image
 * generation are never scanned and cannot match unrelated <img> elements.
 */
const CHATGPT_GENERATED_IMAGE_SELECTORS = [
  '[data-testid="generated-image-gallery"] img',
  '[data-testid="generated-image-preview"] img',
  '[data-web-image-tile] img',
  'img[alt^="Generated image"]',
];

/**
 * Marker injected by injectToolsInstruction(); everything from here onward is
 * the compact tool protocol + tool schemas, while everything before it is the
 * client's (often enormous) agent harness prompt the web chat does not need.
 */
const TOOL_MODE_MARKER = '### TOOL CALLING MODE (MANDATORY';

/**
 * Builds the prompt for a NEW web chat session :
 * keep the tool-calling protocol from the injected system instruction, keep the
 * user's task, and reduce any replayed history (gateway restarted mid-task,
 * multi-turn client context) to a compact recap instead of pasting the whole
 * harness system prompt and full transcript — the #1 cause of
 * "The message you submitted was too long" followed by a session reset.
 */
function buildFreshChatPrompt(messages: ChatMessage[], aggressive: boolean): string {
  const caps = aggressive
    ? { user: 1200, userLast: 6000, assistant: 400, tool: 1000, sysPlain: 1500 }
    : { user: 1200, userLast: 9000, assistant: 800, tool: 2000, sysPlain: 4000 };
  const normContent = (c: unknown): string => extractMessageText(c);
  const cap = (s: string, max: number) => {
    if (s.length <= max) return s;
    const head = Math.floor(max * 0.75);
    const tail = Math.floor(max * 0.2);
    return `${s.slice(0, head)}\n[...truncated ${s.length - head - tail} chars...]\n${s.slice(-tail)}`;
  };

  const parts: string[] = [];
  const sys = messages.find((m: any) => m?.role === 'system');
  if (sys) {
    const s = normContent(sys.content);
    const idx = s.indexOf(TOOL_MODE_MARKER);
    parts.push(idx >= 0 ? s.slice(idx) : cap(s, caps.sysPlain));
  }

  const nonSystem = messages.filter((m: any) => m?.role !== 'system');
  if (nonSystem.length > 1) {
    parts.push(
      '[Bridge note: this task continues from a previous local agent session. ' +
      'Earlier steps were already executed locally; only a compact recap follows.]'
    );
  }

  const toolIdx = nonSystem.map((m: any, i: number) => (m.role === 'tool' ? i : -1)).filter((i: number) => i >= 0);
  const keepTool = new Set(toolIdx.slice(-2));
  let lastUserIdx = -1;
  for (let i = nonSystem.length - 1; i >= 0; i--) {
    if (nonSystem[i].role === 'user') { lastUserIdx = i; break; }
  }
  for (let i = 0; i < nonSystem.length; i++) {
    const m: any = nonSystem[i];
    const content = normContent(m.content);
    if (m.role === 'user') {
      parts.push(`User: ${cap(content, i === lastUserIdx ? caps.userLast : caps.user)}`);
    } else if (m.role === 'assistant') {
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
      if (calls.length > 0) {
        const names = calls.map((c: any) => c?.function?.name || c?.name).filter(Boolean).join(', ');
        parts.push(`Assistant: [requested local tool(s): ${names || '?'} — executed in the previous session]`);
      } else if (content) {
        parts.push(`Assistant: ${cap(content, caps.assistant)}`);
      }
    } else if (m.role === 'tool') {
      parts.push(keepTool.has(i) ? `Tool result: ${cap(content, caps.tool)}` : '[older tool result omitted]');
    }
  }
  return parts.filter(Boolean).join('\n\n');
}

/**
 * Per-role character caps for prompts submitted to a web composer. Web chats
 * (ChatGPT etc.) reject messages beyond their composer limit with
 * "The message you submitted was too long", which used to make every follow-up
 * look like a brand-new session because the send failed and continuation state
 * was reset. Compaction keeps the head (task) and tail (latest state) of long
 * content and drops the middle.
 */
function compactMessagesForWeb(messages: ChatMessage[], aggressive: boolean): ChatMessage[] {
  const caps = aggressive
    ? { system: 2200, user: 3500, assistant: 700, tool: 900, skipBelow: 0 }
    : { system: 6000, user: 9000, assistant: 1600, tool: 2400, skipBelow: 14000 };
  const normContent = (c: unknown): string => extractMessageText(c);
  const plain = messages.map((m: any) => normContent(m?.content));
  const total = plain.reduce((n, s) => n + s.length, 0);
  if (total <= caps.skipBelow) return messages;
  const cap = (s: string, max: number) => {
    if (s.length <= max) return s;
    const head = Math.floor(max * 0.7);
    const tail = Math.floor(max * 0.2);
    return `${s.slice(0, head)}\n[...truncated ${s.length - head - tail} chars...]\n${s.slice(-tail)}`;
  };
  return messages.map((m: any, i) => {
    let max: number;
    if (m?.role === 'system') max = caps.system;
    else if (m?.role === 'tool') max = caps.tool;
    else if (m?.role === 'assistant') max = caps.assistant;
    else max = i === messages.length - 1 ? caps.user * 2 : caps.user;
    return { ...m, content: cap(plain[i], max) };
  }) as ChatMessage[];
}

function mediaDir(): string {
  try {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
  } catch {
    // best effort
  }
  return MEDIA_DIR;
}

function imageExtension(contentType: string, src: string): string {
  const t = (contentType || '').toLowerCase();
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  if (t.includes('webp')) return 'webp';
  if (t.includes('gif')) return 'gif';
  if (t.includes('svg')) return 'svg';
  if (t.includes('png')) return 'png';
  const m = /\.(png|jpe?g|webp|gif|svg)(?:[?#]|$)/i.exec(src || '');
  if (m) return m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  return 'png';
}

export interface WebDriverOptions {
  id: WebProviderId;
  name: string;
  config: CommonWebConfig;
  canonicalModels: string[];
  composerSelectors: string[];
  sendSelectors: string[];
  assistantSelectors: string[];
  /**
   * Selectors that count the chat's own user turns. When set, every send is
   * verified as *accepted* (a new user turn appears, or the composer clears).
   * "Typed into the composer" and "accepted by the site" are different facts —
   * without this check a silently failed send waits blind for a reply that
   * never comes .
   */
  userTurnSelectors?: string[];
  /** Opt-in selectors for generated-image tiles (empty = feature disabled). */
  generatedImageSelectors?: string[];
  loginKeywords?: RegExp;
}

/** Per-task durable state: transcript of what was sent + the bound web chat. */
export interface SessionState {
  lastSentMessages: ChatMessage[];
  sessionChatUrl: string | null;
  restored: boolean;
}

export class BaseWebDriver implements ArenaDriver {
  protected readonly options: WebDriverOptions;
  protected context: BrowserContext | null = null;
  protected page: Page | null = null;
  /** Serializes requests — a single browser page cannot serve concurrent chats safely. */
  protected queue: Promise<void> = Promise.resolve();

  /**
   * Per-task session store . Keyed by the client's
   * X-Chat-Session-ID header or a stable task fingerprint.
   */
  protected sessionStates = new Map<string, SessionState>();
  /** Session state of the request currently being processed. */
  protected session: SessionState | null = null;
  /** Durable correlation metadata mirror (provider/profile/conversation). */
  protected readonly registry = new SessionRegistry();
  /** Exclusive per-process browser ownership (declared policy: one process owns a profile; others are refused). */
  protected readonly browserOwner = new BrowserOwner();
  protected readonly ownershipLedger = new OwnershipLedger();
  /** Epoch captured when the current page was produced; used to detect stale workers. */
  protected pageEpoch: string = this.browserOwner.epoch;
  /** True after a successful claim of this driver's profile. */
  protected claimedProfile = false;
  /** Per-session execution lanes : same session = serial, different = parallel. */
  protected readonly sessionQueues = new SessionQueue();
  /** Session→page scheduling over the existing TabWorkerPool . */
  protected tabScheduler: TabScheduler | null = null;

  constructor(options: WebDriverOptions) {
    this.options = options;
  }

  protected sessionDir(): string {
    return path.join(os.homedir(), '.arena-webbridge', 'state', 'driver-sessions');
  }

  protected sessionStateFile(key: string): string {
    const safe = createHash('sha1').update(key).digest('hex').slice(0, 16);
    return path.join(this.sessionDir(), `${this.options.id}__${safe}.json`);
  }

  protected legacySessionStateFile(): string {
    return path.join(this.sessionDir(), `${this.options.id}.json`);
  }

  protected getOrCreateSession(key: string): SessionState {
    let st = this.sessionStates.get(key);
    if (!st) {
      st = { lastSentMessages: [], sessionChatUrl: null, restored: false };
      this.sessionStates.set(key, st);
    }
    if (!st.restored) {
      this.restoreSessionState(key, st);
      st.restored = true;
    }
    return st;
  }

  protected saveSessionState(key: string, st: SessionState): void {
    try {
      const file = this.sessionStateFile(key);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({ savedAt: Date.now(), sessionKey: key, chatUrl: st.sessionChatUrl, lastSentMessages: st.lastSentMessages })
      );
      // Registry mirror : the durable correlation metadata — provider,
      // profile, conversation — readable by any process and by the final
      // report. Best-effort: transcript storage stays the source of truth.
      const current = this.registry.get(this.options.id, key);
      this.registry
        .upsert({
          sessionKey: key,
          providerId: this.options.id,
          profileId: path.basename(this.options.config.userDataDir || 'profile'),
          conversationUrl: st.sessionChatUrl,
          conversationId: null,
          lastRequestId: null,
          savedAt: Date.now(),
          version: (current?.version || 0) + 1,
        })
        .catch(() => {});
    } catch {
      // best effort
    }
  }

  protected restoreSessionState(key: string, st: SessionState): void {
    const load = (file: string): any => {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return null;
      }
    };
    let data = load(this.sessionStateFile(key));
    if (!data) data = load(this.legacySessionStateFile());
    if (!data || !Array.isArray(data.lastSentMessages) || data.lastSentMessages.length === 0) return;
    if (Date.now() - (data.savedAt || 0) > 7 * 24 * 3600_000) return;
    st.lastSentMessages = data.lastSentMessages;
    st.sessionChatUrl = typeof data.chatUrl === 'string' && data.chatUrl ? data.chatUrl : null;
    console.log(
      `[${this.options.name}] Restored persisted session state (${st.lastSentMessages.length} message(s), chat: ${st.sessionChatUrl || 'n/a'})`
    );
  }

  protected clearSessionState(key: string): void {
    try {
      fs.rmSync(this.sessionStateFile(key), { force: true });
    } catch {
      // best effort
    }
    const st = this.sessionStates.get(key);
    if (st) {
      st.sessionChatUrl = null;
      st.lastSentMessages = [];
    }
  }

  /** Joined CSS selector for generated-image tiles, or '' when unsupported. */
  protected get generatedImageSelector(): string {
    return (this.options.generatedImageSelectors && this.options.generatedImageSelectors.length
      ? this.options.generatedImageSelectors
      : []
    ).join(', ');
  }

  async listModels(): Promise<string[]> {
    return [...this.options.canonicalModels];
  }

  async sendMessage(
    model: string,
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
    sessionKey = 'default'
  ): Promise<string> {
    // per-session lanes instead of one global queue — requests for the
    // SAME session serialize; requests for DIFFERENT sessions run in parallel
    // on their own pages (scheduler-bound).
    return this.sessionQueues.run(sessionKey, () =>
      this.sendMessageSerialized(model, messages, onChunk, signal, sessionKey)
    );
  }

  /**
   * declared capabilities: per-session pages over the scheduler,
   * durable conversation state restored from the session registry.
   */
  getCapabilities(): import('./driver-capabilities.js').DriverCapabilities {
    return {
      sessionSupport: 'per-session-page',
      persistentConversation: true,
      streaming: true,
      toolCalling: false,
      notes: SCHEDULED_PER_SESSION_NOTES,
    };
  }

  /** breaker key half: the durable profile this driver runs against. */
  getProfileDir(): string | undefined {
    return this.options.config.userDataDir;
  }

  protected async sendMessageSerialized(
    _model: string,
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
    sessionKey = 'default'
  ): Promise<string> {
    if (signal?.aborted) throw new Error('Request was aborted');
    const providerId = this.options.id || 'default';
    const isAutoFingerprint = /^task-[0-9a-f]{16}$/.test(sessionKey);
    const isExplicitCustomSession = Boolean(sessionKey && sessionKey !== 'default' && !isAutoFingerprint);

    if (providerSessionRouter.shouldRotate(providerId)) {
      console.log(`[${this.options.name}] Active session reached turn limit. Rotating to clean conversation.`);
      const oldKey = providerSessionRouter.getActiveSessionKey(providerId);
      this.clearSessionState(oldKey);
      providerSessionRouter.rotateSession(providerId, 'turn_limit_reached');
    }

    const effectiveSessionKey = isExplicitCustomSession
      ? sessionKey
      : providerSessionRouter.getActiveSessionKey(providerId);

    // the session's OWN page, from the scheduler — never a shared
    // driver-level page. Two sessions can run concurrently on different pages.
    const base0 = (this.options.config.baseUrl || '').replace(/\/$/, '');
    const ctx = await this.ensureContext();
    if (!this.tabScheduler) this.tabScheduler = new TabScheduler(new TabWorkerPool(ctx, { maxTabs: (this.options.config as any).maxTabs || 1 }));
    const page = await this.tabScheduler.acquireFor(effectiveSessionKey, base0 || undefined);
    // Diagnostic tag: which web page served which session (also used by tests
    // to assert page identity during concurrent execution).
    (page as any).__session = effectiveSessionKey;
    try {
    // Ownership housekeeping : heartbeat the profile claim with every
    // request so a live gateway is never mistaken for a stale one, and refuse
    // to operate on a page from a dead browser incarnation (stale worker).
    if (this.claimedProfile) {
      await this.ownershipLedger
        .heartbeat(this.options.config.userDataDir || 'profile', this.browserOwner.id, this.browserOwner.epoch)
        .catch(() => {});
    }
    if (!this.browserOwner.verify(page, this.pageEpoch)) {
      throw new Error(`${this.options.name}: page is stale or closed (browser incarnation changed) — retry the request to get a fresh page.`);
    }
    // Bind this request to its per-task session (restores durable state on
    // first use so a task that outlived a gateway restart resumes the same
    // web chat instead of a new one). Local binding — parallel sessions each
    // get their own SessionState; no shared mutable driver field.
    const st = this.getOrCreateSession(effectiveSessionKey);
    console.log(`[${this.options.name}] session=${effectiveSessionKey.slice(0, 24)}`);
    // The tool interpreter injects a SYNTHETIC user note ("Tool results are
    // provided above...") into every request. The client will never send that
    // message itself, so storing or comparing it corrupts the continuation
    // prefix and forces a brand-new web session on every turn. Track only
    // real client messages; the note remains prompt content.
    const isBridgeNote = (m: ChatMessage) =>
      m?.role === 'user' &&
      typeof (m as any)?.content === 'string' &&
      (/Tool results are provided above/.test(String((m as any).content)) ||
       /IMPORTANT \(override\): Tools are available NOW/.test(String((m as any).content)));
    const trackedMessages = messages.filter((m) => !isBridgeNote(m));
    let base = (this.options.config.baseUrl || '').replace(/\/$/, '');
    if (this.options.config.privacyMode && (this.options.id === 'chatgpt-web' || base.includes('chatgpt.com'))) {
      try {
        const u = new URL(base);
        u.searchParams.set('temporary-chat', 'true');
        base = u.toString();
      } catch {
        base = `${base}/?temporary-chat=true`;
      }
    }

    const normArgs = (a: any) => {
      if (typeof a === 'string') { try { return JSON.stringify(JSON.parse(a)); } catch { return a; } }
      try { return JSON.stringify(a ?? {}); } catch { return '{}'; }
    };
    const normTC = (tcs: any[]) => (tcs || []).map((tc: any) => ({
      type: tc?.type || 'function',
      function: {
        name: tc?.function?.name || tc?.name || '',
        arguments: normArgs(tc?.function?.arguments ?? tc?.arguments ?? {}),
      },
    }));
    const normContent = (c: any) => extractMessageText(c);
    const msgKey = (m: any) => {
      if (!m) return m;
      if (m.role === 'system') {
        let txt = normContent(m.content);
        const idx = txt.indexOf(TOOL_MODE_MARKER);
        if (idx >= 0) txt = txt.slice(0, idx).trim();
        const corrIdx = txt.indexOf('### CORRECTION');
        if (corrIdx >= 0) txt = txt.slice(0, corrIdx).trim();
        return { role: 'system', content: txt };
      }
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        // ignore textual content differences (raw web text vs cleaned/empty) when tool calls match
        return { role: 'assistant', tool_calls: normTC(m.tool_calls) };
      }
      if (m.role === 'tool') {
        return { role: 'tool', tool_call_id: m.tool_call_id || m.toolCallId || '', name: m.name || '' };
      }
      if (m.role === 'assistant') {
        return { role: 'assistant' };
      }
      return { role: m.role, content: normContent(m.content) };
    };
    const isContinuation = (() => {
      try {
        const prev = st?.lastSentMessages || [];
        if (!prev.length) return false;
        const matchLen = Math.min(trackedMessages.length, prev.length);
        if (matchLen === 0) return false;

        const a = trackedMessages.slice(0, matchLen).map(msgKey);
        const b = prev.slice(0, matchLen).map(msgKey);
        for (let i = 0; i < a.length; i++) {
          if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
            const roleA = (trackedMessages[i] as any)?.role;
            const roleB = (prev[i] as any)?.role;
            const rolesA = trackedMessages.slice(0, matchLen).map((x) => (x as any)?.role).join(',');
            const rolesB = prev.slice(0, matchLen).map((x) => (x as any)?.role).join(',');
            const prevA = String(normContent((trackedMessages[i] as any)?.content)).slice(0, 200);
            const prevB = String(normContent((prev[i] as any)?.content)).slice(0, 200);
            console.log(
              `[${this.options.name}] Continuation check: no (first diff at index ${i}: client ${roleA} vs stored ${roleB})\n` +
              `[${this.options.name}]   client roles: ${rolesA}\n` +
              `[${this.options.name}]   stored roles: ${rolesB}\n` +
              `[${this.options.name}]   client content[${i}]: ${JSON.stringify(prevA)}\n` +
              `[${this.options.name}]   stored content[${i}]: ${JSON.stringify(prevB)}`
            );
            return false;
          }
        }
        return true;
      } catch {
        return false;
      }
    })();

    const sameOrigin = (() => {
      try {
        return page.url() && base && new URL(page.url()).origin === new URL(base).origin;
      } catch {
        return false;
      }
    })();

    // Delta continuation in the page we're already on.
    const canContinue = isContinuation && sameOrigin && !page.isClosed() && this.options.config.privacyMode !== true;
    // Same task but the browser/page was relaunched (e.g. gateway restart):
    // resume the persisted web chat URL instead of starting a brand-new chat.
    let resumedChat = false;
    if (
      !canContinue &&
      isContinuation &&
      st?.sessionChatUrl &&
      !page.isClosed() &&
      this.options.config.privacyMode !== true
    ) {
      console.log(`[${this.options.name}] Resuming persisted web chat: ${st?.sessionChatUrl}`);
      const ok = await page
        .goto(st?.sessionChatUrl || '', { waitUntil: 'domcontentloaded', timeout: 60_000 })
        .then(() => true)
        .catch((e) => {
          console.log(`[${this.options.name}] Resume goto failed: ${e.message}`);
          return false;
        });
      if (ok) {
        await page.waitForTimeout(2500);
        try {
          await this.assertAuthenticated(page);
          st.sessionChatUrl = page.url();
          resumedChat = true;
        } catch {
          resumedChat = false;
        }
      }
      if (!resumedChat) {
        console.log(`[${this.options.name}] Persisted web chat is gone — starting a fresh session.`);
        st.lastSentMessages = [];
        this.clearSessionState(effectiveSessionKey);
      }
    }

    let promptMessages = messages;

    if (canContinue || resumedChat) {
      promptMessages = trackedMessages.length > st.lastSentMessages.length
        ? trackedMessages.slice(st.lastSentMessages.length)
        : [trackedMessages[trackedMessages.length - 1]];
      console.log(`[${this.options.name}] Continuing existing chat session (+${promptMessages.length} message(s))...`);
    } else {
      st.lastSentMessages = [];
      this.clearSessionState(effectiveSessionKey);
      console.log(`[${this.options.name}] Navigating to ${base}...`);
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch((e) =>
        console.log(`[${this.options.name}] goto error:`, e.message)
      );
      await page.waitForTimeout(2000);
      await this.assertAuthenticated(page);
    }

    const toolBridgeNote =
      '\n\n[Bridge instruction: Tool results are provided above. Continue the task. If another local action is needed, respond with the required ```tool_call``` block(s) now. Do not claim you lack access.]';
    const inSameChat = canContinue || resumedChat;
    let prompt: string;
    if (inSameChat) {
      // Delta only: the web chat already holds the earlier conversation, so
      // re-sending it (like web gateway never does) just overflows the
      // composer and forces a brand-new session on every turn.
      prompt = formatMessages(compactMessagesForWeb(promptMessages, false));
      if (promptMessages.some((m) => m.role === 'tool')) prompt += toolBridgeNote;
    } else {
      // Fresh web session: never paste the client's full agent harness system
      // prompt. Chat-on-steroids principle — the web model needs only the tool
      // protocol plus the actual task, with prior steps as a compact recap.
      prompt = buildFreshChatPrompt(messages, false);
      if (prompt.length > 14000) prompt = buildFreshChatPrompt(messages, true);
    }
    console.log(`[${this.options.name}] Prompt: ${prompt.length} chars (${inSameChat ? 'delta' : 'fresh session'})`);

    // Send + verify the site actually ACCEPTED the message, with a too-long
    // retry and one not-accepted retry. "Typed into the composer",
    // "submitted" and "accepted by ChatGPT" are different facts; a silently
    // failed send must fail fast instead of waiting on a reply that never comes.
    const userTurnSelector = (this.options.userTurnSelectors || []).join(', ');
    const sendOnce = async (text: string): Promise<'accepted' | 'too-long' | 'not-accepted'> => {
      const beforeUser = userTurnSelector
        ? await page.locator(userTurnSelector).count().catch(() => 0)
        : 0;
      await this.fillComposer(page, text, signal);
      await this.clickSend(page, signal);
      const deadline = Date.now() + 9000;
      while (Date.now() < deadline) {
        if (signal?.aborted) throw new Error('Request was aborted');
        await page.waitForTimeout(500);
        const body = await page.innerText('body').catch(() => '');
        if (/message you submitted was too long|too long,?\s*please edit/i.test(body)) return 'too-long';
        if (userTurnSelector) {
          const afterUser = await page.locator(userTurnSelector).count().catch(() => 0);
          if (afterUser > beforeUser) return 'accepted';
          // ChatGPT clears the composer the moment it accepts a send.
          const composerText = await page
            .locator(this.options.composerSelectors.join(', '))
            .first()
            .innerText()
            .catch(() => 'keep');
          if (composerText.trim() === '') return 'accepted';
        } else {
          // No per-site user-turn selectors: keep the legacy behavior (only the
          // composer's own too-long rejection is detected).
          await page.waitForTimeout(500);
          return 'accepted';
        }
      }
      return 'not-accepted';
    };
    const assistantSelector = this.options.assistantSelectors.join(', ');
    const imageSelector = this.generatedImageSelector;
    const beforeCount = await page.locator(assistantSelector).count().catch(() => 0);
    const beforeImages = imageSelector
      ? await page.locator(imageSelector).count().catch(() => 0)
      : 0;
    let sendStatus = await sendOnce(prompt);
    if (sendStatus === 'too-long') {
      console.log(`[${this.options.name}] Web rejected prompt as too long (${prompt.length} chars) — retrying with compacted prompt...`);
      prompt = inSameChat
        ? formatMessages(compactMessagesForWeb(promptMessages, true)) + (promptMessages.some((m) => m.role === 'tool') ? toolBridgeNote : '')
        : buildFreshChatPrompt(messages, true);
      await this.clearComposer(page, signal);
      sendStatus = await sendOnce(prompt);
      if (sendStatus === 'too-long') {
        throw new Error(
          `${this.options.name}: prompt rejected as too long even after compaction (${prompt.length} chars). ` +
          `Start a new task/session so the agent re-sends a smaller context.`
        );
      }
    }
    if (sendStatus === 'not-accepted') {
      console.log(`[${this.options.name}] Send was not accepted — retrying once (clear + refill + send)...`);
      await this.clearComposer(page, signal);
      sendStatus = await sendOnce(prompt);
    }
    if (sendStatus !== 'accepted') {
      throw new Error(
        `${this.options.name}: the web chat did not accept the message (no new user turn and the composer did not clear). URL: ${page.url()}`
      );
    }

    let result = '';
    let correctiveRetryUsed = false;
    try {
      result = await this.waitForResponse(page, onChunk, signal, beforeCount, beforeImages, imageSelector);
      // Post-wait verification : if the browser was relaunched or the
      // page closed while we waited, the collected text is not trustworthy —
      // fail loudly instead of returning a ghost reply.
      if (!this.browserOwner.verify(page, this.pageEpoch)) {
        throw new Error(`${this.options.name}: browser/page became stale while waiting for the response — result discarded.`);
      }
      // Corrective retry (chatgpt-web-tool-bridge lesson): if the model clearly
      // ATTEMPTED a tool call but the block is malformed/cut, never hand the raw
      // protocol text to the agent as a final answer — ask the same web chat to
      // re-emit it properly, once.
      if (
        result &&
        /tool[_ -]?call/i.test(result) &&
        !parseToolCallsFromResponse(result).hasToolCalls &&
        (canContinue || resumedChat) &&
        !correctiveRetryUsed
      ) {
        correctiveRetryUsed = true;
        console.log(`[${this.options.name}] Malformed tool_call detected — sending corrective retry in the same chat...`);
        const corrective =
          'Your previous reply contained a ```tool_call``` block but it was malformed or truncated, so it could not be executed. ' +
          'Re-emit the SAME call now as one clean block exactly in this shape:\n```tool_call\n{"name":"TOOL_NAME","arguments":{...}}\n```\nNo commentary before or after the block.';
        promptMessages = [...promptMessages, { role: 'user', content: corrective } as ChatMessage];
        const corrStatus = await sendOnce(corrective);
        if (corrStatus === 'accepted') {
          result = await this.waitForResponse(page, undefined, signal, beforeCount, beforeImages, imageSelector);
        }
      }
      // Normalize assistant shape: if the web reply contains tool calls, record them so the next client turn
      // (which sends assistant.tool_calls) can be recognized as a continuation.
      // The interpreter owns ALL parsing logic (single source of truth) — the old
      // inline copy here drifted and lost tool calls on mangled/truncated fences.
      let assistantForHistory: any = { role: 'assistant', content: result };
      try {
        const interpretation = parseToolCallsFromResponse(result || '');
        const calls = (interpretation.toolCalls || []).map((c, i) => ({
          id: c.id || `call_hist_${Date.now()}_${i + 1}`,
          type: 'function',
          function: {
            name: c.function?.name || (c as any).name,
            arguments: typeof (c.function?.arguments ?? (c as any).arguments) === 'string'
              ? (c.function?.arguments ?? (c as any).arguments)
              : JSON.stringify((c.function?.arguments ?? (c as any).arguments) ?? {}),
          },
        }));
        if (calls.length > 0) {
          assistantForHistory = {
            role: 'assistant',
            content: interpretation.cleanText || result,
            tool_calls: calls,
          };
        } else if (/tool[_ -]?call/i.test(result || '')) {
          // The model tried to call a tool but parsing failed — surface it in the
          // log instead of silently returning raw protocol text to the agent.
          console.log(
            `[${this.options.name}] WARNING: reply contains "tool_call" but none parsed (len=${(result || '').length}). Tail: ${(result || '').slice(-250)}`
          );
        }
      } catch {}
      // P2: a neutral correction issued by EMO itself is NOT client history —
      // it must not shift the stored prefix, or the next client turn would
      // no longer match it (breaking the conversation continuation).
      st.lastSentMessages = [...stripNeutralCorrections(trackedMessages).map((m) => ({ ...(m as any) })), assistantForHistory];
      // Durable: the web chat + transcript survive gateway restarts, so the
      // same agent task keeps the same web session across restarts.
      if (this.options.config.privacyMode !== true) {
        const url = page.url();
        if (url && url !== 'about:blank') st.sessionChatUrl = url;
        this.saveSessionState(sessionKey, st);
      }
    } catch (e) {
      // Keep the durable state on turn failure (CoS principle): the web chat
      // still holds the full context, so a client retry of the same request
      // matches the stored prefix and continues with a small delta in the SAME
      // chat. Clearing here forced every retry into an expensive full-prompt
      // fresh session (and duplicated the whole context in a new web chat).
      // Stale state is self-healing: a different conversation fails the prefix
      // check and starts fresh anyway.
      throw e;
    }

    // Any images the chat created are downloaded and appended as file links so
    // they reach the agent instead of staying inside the browser window.
    const images = await this.collectGeneratedImages(page, beforeImages, imageSelector);
    let text = result;
    if (images.length) {
      const block = images.map((f) => `![generated image](file://${f})`).join('\n');
      text = text ? `${text}\n\n${block}` : block;
      try { onChunk?.(`${result ? '\n\n' : ''}${block}`); } catch {}
    }

    if (this.options.config.privacyMode) {
      await this.cleanupPrivacySession(page).catch(() => {});
      st.lastSentMessages = [];
      this.clearSessionState(effectiveSessionKey);
    }

    providerSessionRouter.recordTurn(providerId, page.url(), text.length);
    return text;
    } finally {
      // always give the page back to the scheduler (LRU bookkeeping;
      // the page stays bound to this session unless someone else needs it).
      await this.tabScheduler?.release(effectiveSessionKey).catch(() => {});
    }
  }

  protected async assertAuthenticated(page: Page): Promise<void> {
    const url = page.url();
    const regex = this.options.loginKeywords || /\/login|\/signin|\/signup|\/auth/i;
    if (regex.test(url)) {
      const err = new Error(
        `${this.options.name} session is not authenticated (redirected to ${url}). Please log in via the dashboard. Profile: ${this.options.config.userDataDir}`
      );
      (err as any).statusCode = 401;
      (err as any).type = 'authentication_error';
      throw err;
    }

    if (url.includes('__cf_chl_') || url.includes('challenge-platform')) {
      const err = new Error(
        `Cloudflare Turnstile challenge detected on ${this.options.name}. ` +
        `Please disable Headless Mode (الوضع الخفي) in provider settings or log in via the dashboard in a visible browser window.`
      );
      (err as any).statusCode = 403;
      (err as any).type = 'cf_turnstile_detected';
      throw err;
    }

    if (this.options.id === 'tencent-ai-web') {
      const hasLogin = await page.locator('.agent-dialogue__tool__login, .t-dialog:has-text("登录"), .t-dialog:has-text("Log In")').count().catch(() => 0);
      if (hasLogin > 0) {
        const err = new Error(
          `${this.options.name} is not logged in. Please click 'تسجيل الدخول' in the dashboard to scan the WeChat/QQ QR code.`
        );
        (err as any).statusCode = 401;
        (err as any).type = 'authentication_error';
        throw err;
      }
    }
  }

  protected async clearComposer(page: Page, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('Request was aborted');
    const selector = this.options.composerSelectors.join(', ');
    const composer = page.locator(selector).first();
    await composer.click().catch(() => {});
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.waitForTimeout(200);
  }

  protected async fillComposer(page: Page, text: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('Request was aborted');
    const selector = this.options.composerSelectors.join(', ');
    const composer = page.locator(selector).first();
    try {
      await composer.waitFor({ state: 'visible', timeout: 20_000 });
    } catch (e) {
      const url = page.url();
      const title = await page.title().catch(() => '');
      if (url.includes('__cf_chl_') || /just a moment|checking your browser|security verification/i.test(title)) {
        const err = new Error(
          `Cloudflare/Security verification detected on ${this.options.name}. ` +
          `Please disable Headless Mode (الوضع الخفي) in settings or log in via dashboard in a visible browser window.`
        );
        (err as any).statusCode = 403;
        (err as any).type = 'cf_turnstile_detected';
        throw err;
      }
      const pageText = await page.innerText('body').catch(() => '');
      if (/log in|sign in|sign up|登录|注册/i.test(pageText) && !/prompt|ask|chat/i.test(pageText)) {
        const err = new Error(
          `${this.options.name} session is not logged in. Please click 'تسجيل الدخول' in the dashboard to sign in.`
        );
        (err as any).statusCode = 401;
        (err as any).type = 'authentication_error';
        throw err;
      }
      const err = new Error(
        `Could not find input box on ${this.options.name} (URL: ${url}). Please make sure you are logged in and headless mode is configured correctly.`
      );
      (err as any).statusCode = 502;
      (err as any).type = 'bad_gateway';
      throw err;
    }
    await composer.click();
    await page.waitForTimeout(150);

    // Try standard fill first (for textarea)
    let filled = false;
    try {
      await composer.fill(text, { timeout: 3000 });
      filled = true;
    } catch {
      // For rich-text editors (ProseMirror, TipTap, contenteditable)
    }

    if (!filled) {
      // Clear contenteditable
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await page.keyboard.insertText(text).catch(async () => {
        await page.evaluate(({ sel, val }) => {
          const el = document.querySelector(sel);
          if (el) {
            el.textContent = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, { sel: selector, val: text });
      });
    }

    await page.waitForTimeout(300);
  }

  protected async clickSend(page: Page, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('Request was aborted');
    // A visible Stop control means the site is still generating and the Send
    // button is gone; pressing Enter now silently drops the message. Wait for
    // the current generation to settle first.
    const stopBtn = page.locator('button[aria-label*="Stop"], button[data-testid*="stop"]').first();
    for (let i = 0; i < 10; i++) {
      if ((await stopBtn.count().catch(() => 0)) === 0) break;
      await page.waitForTimeout(500);
    }
    const selector = this.options.sendSelectors.join(', ');
    const send = page.locator(selector).first();
    const count = await send.count().catch(() => 0);

    if (count > 0 && await send.isVisible().catch(() => false)) {
      // Wait if disabled
      for (let i = 0; i < 20; i++) {
        const disabled = await send.isDisabled().catch(() => false);
        if (!disabled) break;
        await page.waitForTimeout(150);
      }
      try {
        await send.click({ timeout: 5000 });
        return;
      } catch (e) {
        console.log(`[${this.options.name}] Send click failed, pressing Enter:`, (e as Error).message);
      }
    }

    await page.keyboard.press('Enter');
  }

  protected async waitForResponse(
    page: Page,
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
    beforeCount = 0,
    beforeImages = 0,
    imageSelector = ''
  ): Promise<string> {
    const timeoutMs = this.options.config.timeoutMs ?? 300_000;
    const deadline = Date.now() + timeoutMs;
    const assistantSelector = this.options.assistantSelectors.join(', ');
    let lastEmitted = '';
    let lastSignature = '';
    let stableCount = 0;
    let sawAssistant = false;
    let poll = 0;
    let lastSnapshot: { count: number; text: string; hasStop: boolean; url: string; imageCount: number } | null = null;
    // Silence guard: an accepted send whose page shows NO generation activity
    // (no stop button, no new assistant turn, unchanged last turn) for a full
    // minute is not a slow model — it is a silent send failure or a usage-cap
    // banner. Fail fast with a diagnostic instead of a 5-minute blind wait.
    const SILENCE_MS = 60_000;
    let silenceStart = Date.now();
    let silenceWarned = false;

    const countImages = async () =>
      imageSelector ? page.locator(imageSelector).count().catch(() => 0) : 0;

    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('Request was aborted');
      await page.waitForTimeout(400);

      const snapshot = await page
        .evaluate(
          ({ sel, imgSel }) => {
            const msgs = Array.from(document.querySelectorAll(sel));
            const last = msgs[msgs.length - 1] as HTMLElement | undefined;
            const text = (last?.innerText || '').trim();
            const stop = document.querySelector('button[aria-label*="Stop"], button[data-testid*="stop"]');
            return {
              count: msgs.length,
              text,
              hasStop: !!stop,
              url: location.href,
              imageCount: imgSel ? document.querySelectorAll(imgSel).length : 0,
            };
          },
          { sel: assistantSelector, imgSel: imageSelector }
        )
        .catch(() => ({ count: 0, text: '', hasStop: false, url: '', imageCount: 0 }));
      lastSnapshot = snapshot;
      poll++;

      // Silence-guard bookkeeping: silence = no new assistant turn, no visible
      // generation, and the last turn's text unchanged from what the page had
      // before/at send time.
      if (!sawAssistant && !snapshot.hasStop) {
        if (Date.now() - silenceStart >= SILENCE_MS) {
          const body = await page.innerText('body').catch(() => '');
          const capHint =
            /you'?ve hit|usage cap|reached our limit|message limit|rate limit|upgrade your plan/i.exec(body)?.[0] || '';
          console.log(
            `[${this.options.name}] WARNING: accepted send produced no reply activity for ${Math.round(SILENCE_MS / 1000)}s` +
              `(n=${snapshot.count} chars=${snapshot.text.length} stop=false)${capHint ? ` — page hint: "${capHint}"` : ''}`
          );
          throw new Error(
            `${this.options.name}: send was accepted but the page showed no reply activity for ${Math.round(SILENCE_MS / 1000)}s` +
              (capHint ? ` (site hint: ${capHint})` : '') +
              `. Possibly a usage cap, a silent send failure, or a site error. URL: ${page.url()}`
          );
        }
        if (!silenceWarned && Date.now() - silenceStart >= SILENCE_MS / 2) {
          silenceWarned = true;
          console.log(
            `[${this.options.name}] no reply activity for ${Math.round(SILENCE_MS / 2000)}s (no new turn, no stop button) — will fail fast at ${Math.round(SILENCE_MS / 1000)}s`
          );
        }
      } else {
        silenceStart = Date.now();
        silenceWarned = false;
      }

      // CoS principle: "a turn is finished only when the page says so". Log what
      // the page reports so an invisible reply (stale selectors, silent send
      // failure) is diagnosable from the gateway log instead of a blind wait.
      if (poll % 10 === 0) {
        console.log(
          `[${this.options.name}] poll: n=${snapshot.count} chars=${snapshot.text.length} stop=${snapshot.hasStop} imgs=${snapshot.imageCount} url=${(snapshot.url || '').slice(0, 90)}`
        );
      }

      const hasNewImages = snapshot.imageCount > beforeImages;
      if (snapshot.count <= beforeCount && !snapshot.text && !hasNewImages) continue;
      if (snapshot.count > beforeCount || (beforeCount === 0 && snapshot.count > 0) || hasNewImages) {
        sawAssistant = true;
      }
      const cleaned = sawAssistant ? snapshot.text : '';

      if (cleaned && cleaned !== lastEmitted) {
        const delta = cleaned.startsWith(lastEmitted)
          ? cleaned.slice(lastEmitted.length)
          : !lastEmitted
            ? cleaned
            : '';
        if (delta) {
          try { onChunk?.(delta); } catch {}
        }
        lastEmitted = cleaned;
      }

      // Response is considered finished once both the text and the number of
      // generated images stop changing for ~2s and no stop button is visible.
      const signature = `${cleaned}::${snapshot.imageCount}`;
      if (sawAssistant && signature === lastSignature) stableCount++;
      else stableCount = 0;
      lastSignature = signature;

      if (sawAssistant && (cleaned || hasNewImages) && !snapshot.hasStop && stableCount >= 5) {
        // Image generation can land a moment after the caption text; give it a
        // short grace window before declaring the turn finished.
        await page.waitForTimeout(1200);
        const afterImages = await countImages();
        if (afterImages > snapshot.imageCount) {
          stableCount = 0;
          continue;
        }
        return cleaned;
      }

      if (snapshot.url && /\/login|\/signin|\/signup/i.test(snapshot.url)) {
        const err = new Error(`${this.options.name} session became unauthenticated. URL: ${snapshot.url}`);
        (err as any).statusCode = 401;
        (err as any).type = 'authentication_error';
        throw err;
      }

      if (this.options.id === 'tencent-ai-web' && !sawAssistant) {
        const hasLogin = await page.locator('.agent-dialogue__tool__login, .t-dialog:has-text("登录"), .t-dialog:has-text("Log In")').count().catch(() => 0);
        if (hasLogin > 0) {
          const err = new Error(
            `${this.options.name} is not logged in. Please click 'تسجيل الدخول' in the dashboard to scan the WeChat/QQ QR code.`
          );
          (err as any).statusCode = 401;
          (err as any).type = 'authentication_error';
          throw err;
        }
      }
    }

    if (lastEmitted) return lastEmitted;
    console.log(
      `[${this.options.name}] Response timed out — last page state: n=${lastSnapshot?.count} chars=${(lastSnapshot?.text || '').length} stop=${lastSnapshot?.hasStop} url=${(lastSnapshot?.url || '').slice(0, 90)}`
    );
    throw new Error(`${this.options.name} response timed out after ${timeoutMs}ms.`);
  }

  /**
   * Downloads any generated images that appeared after `alreadyKnown` tiles and
   * returns their absolute file paths. Images are read from inside the page so
   * blob: URLs and authenticated CDN links both work.
   */
  protected async collectGeneratedImages(
    page: Page,
    alreadyKnown: number,
    imageSelector = ''
  ): Promise<string[]> {
    const saved: string[] = [];
    try {
      if (!imageSelector) return saved;
      const sources: string[] = await page.evaluate(
        (sel) =>
          Array.from(document.querySelectorAll(sel))
            .map((el) => (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src || '')
            .filter(Boolean),
        imageSelector
      );
      const fresh = sources.slice(Math.max(0, alreadyKnown));
      for (let i = 0; i < fresh.length; i++) {
        const src = fresh[i];
        if (!src) continue;
        const data = await page
          .evaluate(async (url) => {
            try {
              const res = await fetch(url, { credentials: 'include' });
              if (!res.ok) return null;
              const bytes = new Uint8Array(await res.arrayBuffer());
              if (!bytes.length) return null;
              let binary = '';
              const chunk = 0x8000;
              for (let k = 0; k < bytes.length; k += chunk) {
                binary += String.fromCharCode(...bytes.subarray(k, k + chunk));
              }
              return { b64: btoa(binary), type: res.headers.get('content-type') || '' };
            } catch {
              return null;
            }
          }, src)
          .catch(() => null);
        if (!data?.b64) {
          console.log(`[${this.options.name}] Could not read generated image (${src.slice(0, 60)}...)`);
          continue;
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const file = path.join(mediaDir(), `${this.options.id}-${stamp}-${i + 1}.${imageExtension(data.type, src)}`);
        fs.writeFileSync(file, Buffer.from(data.b64, 'base64'));
        saved.push(file);
        console.log(`[${this.options.name}] Saved generated image -> ${file}`);
      }
    } catch (e) {
      console.log(`[${this.options.name}] Image capture failed:`, (e as Error).message);
    }
    return saved;
  }

  protected async cleanupPrivacySession(page: Page): Promise<void> {
    try {
      console.log(`[${this.options.name}] Privacy Mode: performing session cleanup...`);
      const deleteBtn = page.locator('button[aria-label*="Delete"], button[aria-label*="Clear"], button[data-testid*="delete"], [aria-label*="حذف"], [aria-label*="مسح"]').first();
      if ((await deleteBtn.count().catch(() => 0)) > 0 && (await deleteBtn.isVisible().catch(() => false))) {
        await deleteBtn.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
        const confirmBtn = page.locator('button:has-text("Delete"), button:has-text("Confirm"), button:has-text("حذف"), button:has-text("تأكيد")').first();
        if ((await confirmBtn.count().catch(() => 0)) > 0 && (await confirmBtn.isVisible().catch(() => false))) {
          await confirmBtn.click({ timeout: 2000 }).catch(() => {});
        }
      }
      const base = (this.options.config.baseUrl || '').replace(/\/$/, '');
      if (base) {
        await page.goto(base, { waitUntil: 'commit', timeout: 5000 }).catch(() => {});
      }
    } catch (e) {
      console.log(`[${this.options.name}] Privacy cleanup error:`, (e as Error).message);
    }
  }

  async close(): Promise<void> {
    try {
      await this.context?.close();
    } catch {}
    this.context = null;
    this.page = null;
    if (this.claimedProfile) {
      const profileDir = this.options.config.userDataDir || 'profile';
      await OwnerIpcManager.stopForProfile(profileDir).catch(() => {});
      await this.ownershipLedger.releaseProfile(profileDir, this.browserOwner.id).catch(() => {});
      this.claimedProfile = false;
    }
  }

  protected async ensurePage(): Promise<Page> {
    await this.ensureContext();
    const pages = this.context!.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context!.newPage();
    this.pageEpoch = this.browserOwner.epoch;
    return this.page;
  }

  /** Lazily launches the persistent context, claiming profile ownership . */
  protected async ensureContext(): Promise<BrowserContext> {
    if (this.context) {
      try {
        this.context.pages();
        return this.context;
      } catch {
        this.context = null;
        this.page = null;
      }
    }
    console.log(`[${this.options.name}] Launching persistent browser (headless=${this.options.config.headless !== false})...`);
    cleanupStaleProfileLocks(this.options.config.userDataDir);
    const baseOptions: Record<string, unknown> = {
      headless: this.options.config.headless !== false,
      viewport: { width: 1280, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation'],
    };
    let ctx: BrowserContext;
    try {
      ctx = await chromium.launchPersistentContext(this.options.config.userDataDir, {
        ...baseOptions,
        channel: 'chrome',
      });
    } catch {
      ctx = await chromium.launchPersistentContext(this.options.config.userDataDir, baseOptions);
    }
    // Browser ownership : a new context is a new browser incarnation
    // — bump the epoch and claim exclusive ownership of the profile. A live
    // claim from ANOTHER gateway process refuses the request safely (503
    // policy) instead of letting two processes drive the same profile.
    this.browserOwner.bumpEpoch();
    const profileDir = this.options.config.userDataDir || 'profile';
    const claim = await this.ownershipLedger.claimProfile(profileDir, this.browserOwner.id, this.browserOwner.epoch);
    if (claim.status === 'busy') {
      try { await ctx.close(); } catch {}
      // structured busy error (same external 503 semantics; the
      // ProfileOwnerRouter can now FORWARD to the owner instead of failing).
      throw new ProfileBusyError(
        `503 profile in use by another gateway process: profile "${profileDir}" is owned by ` +
        `owner=${claim.owner.ownerInstanceId} pid=${claim.owner.pid} heartbeatAt=${new Date(claim.owner.heartbeatAt).toISOString()}. ` +
        `Retry later or stop the other gateway process.`,
        {
          profileDir,
          ownerInstanceId: claim.owner.ownerInstanceId,
          pid: claim.owner.pid,
          epoch: claim.owner.epoch,
          heartbeatAt: claim.owner.heartbeatAt,
          staleHeartbeat: claim.staleHeartbeat,
        }
      );
    }
    this.claimedProfile = true;
    this.pageEpoch = this.browserOwner.epoch;
    // advertise the loopback IPC channel for this profile (routing
    // requests from other gateway processes to THIS owner process). Startup
    // failure degrades to the legacy safe-busy behavior — never fatal.
    try {
      await OwnerIpcManager.ensureForProfile({
        profileDir,
        ownerInstanceId: this.browserOwner.id,
        epoch: this.browserOwner.epoch,
        ledger: this.ownershipLedger,
        resolve: () => this as unknown as ArenaDriver,
      });
    } catch (e: unknown) {
      console.log(`[${this.options.name}] owner IPC channel unavailable (routing disabled): ${(e as Error).message}`);
    }
    if (claim.status === 'stolen') {
      console.log(`[${this.options.name}] Profile ownership taken over from dead/stale owner pid=${claim.previousOwner.pid}`);
    }
    this.context = ctx;
    // per-session tab scheduling on top of the existing pool. The
    // scheduler keeps session→page bindings and LRU-evicts idle sessions
    // (saving their conversation URL first) when the page cap is reached.
    const maxTabs = (this.options.config as any).maxTabs || 1;
    this.tabScheduler = new TabScheduler(new TabWorkerPool(ctx, { maxTabs }), {
      onEvict: async (evictedKey, url) => {
        // Persist the conversation URL BEFORE the page is freed so the
        // evicted session re-binds to the same web chat on its next request.
        const st = this.sessionStates.get(evictedKey);
        if (st && url) st.sessionChatUrl = url;
        try {
          if (url) this.saveSessionState(evictedKey, st || { lastSentMessages: [], sessionChatUrl: url, restored: true });
        } catch {}
      },
    });
    ctx.once?.('close', () => {
      if (this.context === ctx) {
        this.context = null;
        this.page = null;
        this.tabScheduler = null;
      }
      // Only the owner releases its own claim.
      if (this.claimedProfile) {
        this.ownershipLedger.releaseProfile(profileDir, this.browserOwner.id).catch(() => {});
        this.claimedProfile = false;
      }
    });
    return ctx;
  }
}

// 1. ChatGPT Web Driver
export class ChatGPTWebDriver extends BaseWebDriver {
  constructor(config: CommonWebConfig) {
    super({
      id: 'chatgpt-web',
      name: 'ChatGPT Web',
      config: { ...config, baseUrl: config.baseUrl || 'https://chatgpt.com' },
      canonicalModels: [
        'chatgpt-web:default',
        'chatgpt-web:gpt-4o',
        'chatgpt-web:gpt-4o-mini',
        'chatgpt-web:o1',
        'chatgpt-web:o3-mini',
      ],
      composerSelectors: [
        '#prompt-textarea',
        'textarea[placeholder*="Ask ChatGPT"]',
        'textarea.x-default-marker',
        'div[contenteditable="true"]',
        'textarea',
      ],
      sendSelectors: [
        'button[data-testid="send-button"]',
        'button[aria-label="Send prompt"]',
        'button[aria-label="Send message"]',
        'button[aria-label*="Send"]',
      ],
      assistantSelectors: [
        // New ChatGPT DOM (Nov 2026): each assistant turn is rendered inside a
        // DilRenderer root marked with data-dil-response.
        '[data-dil-response]',
        '[data-message-author-role="assistant"]',
        'div.agent-turn',
        'div.markdown',
      ],
      // Per chatgpt-turn-signals: turns are sections with data-turn="user".
      userTurnSelectors: ['[data-message-author-role="user"]', 'section[data-turn="user"]'],
      // ChatGPT is currently the only provider whose generated images we know
      // how to locate in the DOM; other drivers leave this empty.
      generatedImageSelectors: CHATGPT_GENERATED_IMAGE_SELECTORS,
    });
  }
}

// 2. Grok Web Driver
export class GrokWebDriver extends BaseWebDriver {
  constructor(config: CommonWebConfig) {
    super({
      id: 'grok-web',
      name: 'Grok Web',
      config: { ...config, baseUrl: config.baseUrl || 'https://grok.com' },
      canonicalModels: [
        'grok-web:default',
        'grok-web:grok-2',
        'grok-web:grok-3',
        'grok-web:grok-beta',
      ],
      composerSelectors: [
        'div.tiptap.ProseMirror[aria-label="Ask Grok anything"]',
        'div.tiptap.ProseMirror',
        'textarea[placeholder*="Ask Grok"]',
        'textarea',
      ],
      sendSelectors: [
        'button[data-testid="chat-submit"]',
        'button[aria-label="Submit"]',
        'button[aria-label="Send message"]',
      ],
      assistantSelectors: [
        'div[data-testid*="message"]',
        '.message-bubble',
        'div.prose',
        '.response',
      ],
    });
  }
}

// 3. Kimi Web Driver
export class KimiWebDriver extends BaseWebDriver {
  constructor(config: CommonWebConfig) {
    super({
      id: 'kimi-web',
      name: 'Kimi Web',
      config: { ...config, baseUrl: config.baseUrl || 'https://www.kimi.com/build' },
      canonicalModels: [
        'kimi-web:default',
        'kimi-web:k1.5',
        'kimi-web:kimi-latest',
      ],
      composerSelectors: [
        'div.chat-input-editor',
        'div.chat-input-editor[contenteditable="true"]',
        'div.chat-input',
        'textarea',
      ],
      sendSelectors: [
        'button[aria-label*="发送"]',
        'button.send-button',
        'button[type="submit"]',
      ],
      assistantSelectors: [
        '.chat-message-assistant',
        '.segment-content',
        'div.markdown',
      ],
    });
  }
}

// 4. MiniMax Web Driver
export class MiniMaxWebDriver extends BaseWebDriver {
  constructor(config: CommonWebConfig) {
    super({
      id: 'minimax-web',
      name: 'MiniMax Web',
      config: { ...config, baseUrl: config.baseUrl || 'https://agent.minimax.io/' },
      canonicalModels: [
        'minimax-web:default',
        'minimax-web:minimax-01',
        'minimax-web:abab6.5s',
      ],
      composerSelectors: [
        'div.tiptap.ProseMirror[data-testid="message-textarea"]',
        'div.tiptap.ProseMirror',
        'textarea',
      ],
      sendSelectors: [
        'button[aria-label*="Send"]',
        'button[type="submit"]',
        'button.send-btn',
      ],
      assistantSelectors: [
        '.agent-message',
        '.assistant-msg',
        'div.markdown',
        'div.prose',
      ],
    });
  }
}

// 5. LongCat Web Driver
export class LongCatWebDriver extends BaseWebDriver {
  constructor(config: CommonWebConfig) {
    super({
      id: 'longcat-web',
      name: 'LongCat Web',
      config: { ...config, baseUrl: config.baseUrl || 'https://longcat.ai/chat/' },
      canonicalModels: [
        'longcat-web:default',
        'longcat-web:auto',
      ],
      composerSelectors: [
        'div.tiptap.ProseMirror',
        'textarea',
        '[contenteditable="true"]',
      ],
      sendSelectors: [
        'button[aria-label*="Send"]',
        'button[type="submit"]',
        'button:has-text("Send")',
      ],
      assistantSelectors: [
        '.chat-response',
        '.message-assistant',
        'div.prose',
        'div.markdown',
      ],
    });
  }
}

// 6. LLM7 Web Driver
export class Llm7WebDriver extends BaseWebDriver {
  constructor(config: CommonWebConfig) {
    super({
      id: 'llm7-web',
      name: 'LLM7 Web',
      config: { ...config, baseUrl: config.baseUrl || 'https://llm7.chat/' },
      canonicalModels: [
        'llm7-web:default',
        'llm7-web:claude-3-7-sonnet',
        'llm7-web:gpt-4o',
      ],
      composerSelectors: [
        'textarea.aui-composer-input',
        'textarea[placeholder*="Send a message"]',
        'textarea',
      ],
      sendSelectors: [
        'button[aria-label="Send message"]',
        'button:has-text("Send message")',
        'button[type="submit"]',
      ],
      assistantSelectors: [
        '.aui-message-assistant',
        '[data-role="assistant"]',
        'div.prose',
        'div.markdown',
      ],
    });
  }
}

// 7. LLM Kiwi Web Driver
export class KiwiWebDriver extends BaseWebDriver {
  constructor(config: CommonWebConfig) {
    super({
      id: 'kiwi-web',
      name: 'LLM Kiwi Web',
      config: { ...config, baseUrl: config.baseUrl || 'https://chat.llm.kiwi/' },
      canonicalModels: [
        'kiwi-web:default',
        'kiwi-web:auto',
      ],
      composerSelectors: [
        'textarea[placeholder*="Type a message"]',
        'textarea.text-md',
        'textarea',
      ],
      sendSelectors: [
        'button[aria-label*="Send"]',
        'button[type="submit"]',
        'button:has-text("Send")',
      ],
      assistantSelectors: [
        '.chat-message-assistant',
        '.chat-message',
        'div.markdown',
        'div.prose',
      ],
    });
  }
}

// 8. DeepSeek Web Driver
export class DeepSeekWebDriver extends BaseWebDriver {
  constructor(config: CommonWebConfig) {
    super({
      id: 'deepseek-web',
      name: 'DeepSeek Web',
      config: { ...config, baseUrl: config.baseUrl || 'https://chat.deepseek.com' },
      canonicalModels: [
        'deepseek-web:default',
        'deepseek-web:deepseek-chat',
        'deepseek-web:deepseek-reasoner',
      ],
      composerSelectors: [
        'textarea#chat-input',
        'textarea[placeholder*="DeepSeek"]',
        'textarea[placeholder*="Message"]',
        'textarea',
        '[contenteditable="true"]',
      ],
      sendSelectors: [
        'div[role="button"][aria-label*="Send"]',
        'button[aria-label*="Send"]',
        'button:has-text("Send")',
        'div.chat-input-send-button',
      ],
      assistantSelectors: [
        '.ds-markdown',
        '.chat-message-assistant',
        'div.prose',
        'div.markdown',
      ],
    });
  }
}

// 9. Mistral Web Driver (Le Chat)
export class MistralWebDriver extends BaseWebDriver {
  constructor(config: CommonWebConfig) {
    super({
      id: 'mistral-web',
      name: 'Mistral Web',
      config: { ...config, baseUrl: config.baseUrl || 'https://chat.mistral.ai' },
      canonicalModels: [
        'mistral-web:default',
        'mistral-web:mistral-large-latest',
        'mistral-web:mistral-small-latest',
        'mistral-web:codestral-latest',
        'mistral-web:pixtral-large-latest',
      ],
      composerSelectors: [
        'textarea[placeholder*="Ask Le Chat"]',
        'textarea[placeholder*="Type a message"]',
        'textarea',
        '[contenteditable="true"]',
      ],
      sendSelectors: [
        'button[aria-label="Send prompt"]',
        'button[aria-label*="Send"]',
        'button[type="submit"]',
        'button:has-text("Send")',
      ],
      assistantSelectors: [
        '[data-testid="assistant-message"]',
        '.assistant-message',
        'div.prose',
        'div.markdown',
      ],
    });
  }
}
