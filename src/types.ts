/**
 * Z.AI (Zhipu) provider configuration. Enabled when `apiKey` is set.
 */
export interface ZaiConfig {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  /** Model ID prefixes routed to the Z.AI provider (e.g. 'glm-'). */
  modelPrefixes: string[];
}

/**
 * Z.AI chat.z.ai web-session (scraping) provider. Reuses the Google/Email session
 * stored in a persistent Chrome profile. Headed mode (headless: false) strongly
 * recommended — Aliyun's anti-bot captcha auto-passes only with a real window.
 */
export interface ZaiWebConfig {
  enabled: boolean;
  userDataDir: string;
  baseUrl: string;
  headless: boolean;
  privacyMode?: boolean;
  /** Max time to wait for one generation (including captcha auto-verification). */
  timeoutMs: number;
  /** Max seconds to wait for the Aliyun slider captcha to auto-pass. */
  captchaWaitMs: number;
}

/**
 * Claude (claude.ai) web-session provider. Uses a dedicated persistent Chrome profile.
 * Headed mode recommended for login/hCaptcha/Cloudflare challenges solved by the human.
 */
export interface ClaudeWebConfig {
  enabled: boolean;
  userDataDir: string;
  baseUrl: string;
  headless: boolean;
  privacyMode?: boolean;
  /** Max time to wait for one generation. */
  timeoutMs: number;
}

/**
 * Tencent AI Studio (aistudio.tencent.ai / Hy AI Studio) web-session provider.
 * Uses a dedicated persistent Chrome profile. Headed mode recommended for login/verification.
 */
export interface TencentAiWebConfig {
  enabled: boolean;
  userDataDir: string;
  baseUrl: string;
  headless: boolean;
  privacyMode?: boolean;
  /** Max time to wait for one generation. */
  timeoutMs: number;
}

/**
 * Google Gemini (gemini.google.com) web-session provider.
 * Uses a dedicated persistent Chrome profile. Headed mode recommended for Google login/verification.
 */
export interface GeminiWebConfig {
  enabled: boolean;
  userDataDir: string;
  baseUrl: string;
  headless: boolean;
  privacyMode?: boolean;
  /** Max time to wait for one generation. */
  timeoutMs: number;
}

/**
 * Qwen (chat.qwen.ai) web-session provider.
 * Uses a dedicated persistent Chrome profile. Headed mode recommended for login/verification.
 */
export interface QwenWebConfig {
  enabled: boolean;
  userDataDir: string;
  baseUrl: string;
  headless: boolean;
  privacyMode?: boolean;
  /** Max time to wait for one generation. */
  timeoutMs: number;
}

export interface CommonWebConfig {
  enabled: boolean;
  userDataDir: string;
  baseUrl?: string;
  headless?: boolean;
  privacyMode?: boolean;
  timeoutMs?: number;
}

/**
 * Configuration for the Arena WebBridge service.
 */
export interface Config {
  port: number;
  host: string;
  userDataDir: string;
  arenaBaseUrl: string;
  headless: boolean;
  /**
   * Task 14 — phase-aware provider timeouts (ms), all configurable with
   * CONSERVATIVE defaults. `accept` = time for the provider to accept a send
   * (composer submit); `stall` = max silence while awaiting generation output
   * before a GENERATION_STALLED classification; `total` = hard ceiling for a
   * whole request — it must NEVER re-execute a message that was already sent
   * (a total-timeout after send is unconfirmed, not retried). These
   * declarative defaults are consumed by provider resilience logic; driver
   * level enforcement wiring is incremental and documented per task.
   */
  providerTimeoutsMs?: {
    accept?: number;
    stall?: number;
    total?: number;
  };
  privacyMode?: boolean;
  /** Optional Z.AI provider; when present, matching models bypass the Arena browser. */
  zai?: ZaiConfig;
  /** Optional Z.AI web-session provider (chat.z.ai scraping via persistent Chrome). */
  zaiWeb?: ZaiWebConfig;
  /** Optional Claude web-session provider (claude.ai scraping via persistent Chrome). */
  claudeWeb?: ClaudeWebConfig;
  /** Optional Tencent AI Studio web-session provider (aistudio.tencent.ai). */
  tencentAiWeb?: TencentAiWebConfig;
  /** Optional Gemini web-session provider (gemini.google.com). */
  geminiWeb?: GeminiWebConfig;
  /** Optional Qwen web-session provider (chat.qwen.ai). */
  qwenWeb?: QwenWebConfig;
  /** Optional ChatGPT web-session provider (chatgpt.com). */
  chatgptWeb?: CommonWebConfig;
  /** Optional Grok web-session provider (grok.com). */
  grokWeb?: CommonWebConfig;
  /** Optional Kimi web-session provider (kimi.com). */
  kimiWeb?: CommonWebConfig;
  /** Optional MiniMax web-session provider (agent.minimax.io). */
  minimaxWeb?: CommonWebConfig;
  /** Optional LongCat web-session provider (longcat.ai). */
  longcatWeb?: CommonWebConfig;
  /** Optional LLM7 web-session provider (llm7.chat). */
  llm7Web?: CommonWebConfig;
  /** Optional LLM Kiwi web-session provider (chat.llm.kiwi). */
  kiwiWeb?: CommonWebConfig;
  /** Optional DeepSeek web-session provider (chat.deepseek.com). */
  deepseekWeb?: CommonWebConfig;
  /** Optional Mistral web-session provider (chat.mistral.ai). */
  mistralWeb?: CommonWebConfig;
}

/**
 * Message in an OpenAI chat completion conversation.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

/**
 * OpenAI Chat Completion Request payload.
 */
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  stop?: string | string[];
  user?: string;
  tools?: unknown[];
  tool_choice?: unknown;
}

/**
 * OpenAI Chat Completion choice in a non-streaming response.
 */
export interface ChatCompletionChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string;
    tool_calls?: unknown[];
  };
  finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | null;
}

/**
 * OpenAI Chat Completion non-streaming response.
 */
export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI Chat Completion delta object for streaming chunks.
 */
export interface ChatCompletionChunkDelta {
  role?: 'assistant';
  content?: string | null;
  tool_calls?: unknown[];
}

/**
 * OpenAI Chat Completion choice in a streaming chunk.
 */
export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkDelta;
  finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | null;
}

/**
 * OpenAI Chat Completion streaming chunk.
 */
export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
}

/**
 * Model Information schema compatible with OpenAI /v1/models.
 */
export interface ModelInfo {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

/**
 * List models response schema compatible with OpenAI /v1/models.
 */
export interface ModelListResponse {
  object: 'list';
  data: ModelInfo[];
}

/**
 * Abstract driver interface for interacting with the Arena direct chat web page.
 */
export interface ArenaDriver {
  listModels(): Promise<string[]>;
  sendMessage(
    model: string,
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
    sessionKey?: string
  ): Promise<string>;
  close?(): Promise<void>;
  /**
   * Task 13 — declared session capabilities (owner locked decisions). A
   * driver that cannot isolate/restore MUST declare its real pattern; a
   * sessionKey is either used safely or refused loudly — never silently
   * ignored. Optional so non-web drivers are not forced to declare what
   * they do not have.
   */
  getCapabilities?(): import('./arena/driver-capabilities.js').DriverCapabilities;
  /**
   * Task 14 — the durable profile directory this driver runs against (used
   * as the circuit-breaker key half: providerId + profileDir). Optional so
   * API-only drivers can return undefined; callers fall back to the route
   * name.
   */
  getProfileDir?(): string | undefined;
}

/**
 * Swarm and Subagent coordination types.
 */
export type SwarmWorkerRole = 'coordinator' | 'architect' | 'coder' | 'reviewer' | 'tester' | 'custom';

export interface SwarmWorkerConfig {
  role: SwarmWorkerRole;
  name?: string;
  provider?: string;
  task?: string;
  systemPrompt?: string;
}

export interface SwarmTaskSlice {
  id: string;
  role: SwarmWorkerRole;
  name: string;
  provider: string;
  goal: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface SwarmRequest {
  goal: string;
  /** Global system instructions applied to all swarm workers (in addition to role prompts). */
  systemInstructions?: string;
  mode?: 'pipeline' | 'parallel' | 'auto';
  workers?: SwarmWorkerConfig[];
  stream?: boolean;
}

export interface SwarmResult {
  id: string;
  goal: string;
  mode: 'pipeline' | 'parallel' | 'auto';
  status: 'completed' | 'failed' | 'partial';
  slices: SwarmTaskSlice[];
  synthesis: string;
  durationMs: number;
}

export interface SwarmEvent {
  type: 'swarm:start' | 'worker:start' | 'worker:chunk' | 'worker:done' | 'worker:error' | 'swarm:synthesis' | 'swarm:done';
  swarmId: string;
  taskId?: string;
  role?: SwarmWorkerRole;
  provider?: string;
  message?: string;
  chunk?: string;
  timestamp: number;
}
