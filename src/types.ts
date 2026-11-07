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
  /** Max time to wait for one generation (including captcha auto-verification). */
  timeoutMs: number;
  /** Max seconds to wait for the Aliyun slider captcha to auto-pass. */
  captchaWaitMs: number;
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
  /** Optional Z.AI provider; when present, matching models bypass the Arena browser. */
  zai?: ZaiConfig;
  /** Optional Z.AI web-session provider (chat.z.ai scraping via persistent Chrome). */
  zaiWeb?: ZaiWebConfig;
}

/**
 * Message in an OpenAI chat completion conversation.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  name?: string;
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
}

/**
 * OpenAI Chat Completion choice in a non-streaming response.
 */
export interface ChatCompletionChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string;
  };
  finish_reason: 'stop' | 'length' | 'content_filter' | null;
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
  content?: string;
}

/**
 * OpenAI Chat Completion choice in a streaming chunk.
 */
export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkDelta;
  finish_reason: 'stop' | 'length' | 'content_filter' | null;
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
    signal?: AbortSignal
  ): Promise<string>;
  close?(): Promise<void>;
}
