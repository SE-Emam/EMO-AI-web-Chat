import type { ChatMessage } from '../types.js';

export const DEFAULT_MODEL = 'claude-3-5-sonnet';

export const KNOWN_ARENA_MODELS: readonly string[] = [
  'claude-3-5-sonnet',
  'claude-3-7-sonnet',
  'claude-3-opus',
  'claude-3-haiku',
  'gpt-4o',
  'gpt-4o-mini',
  'o1',
  'o1-mini',
  'o3-mini',
  'deepseek-r1',
  'deepseek-v3',
  'gemini-2.0-flash',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'qwen-2.5-max',
  'qwen-2.5-72b-instruct',
  'llama-3.3-70b-instruct',
  'llama-3.1-405b-instruct',
  'mistral-large-2411',
];

export const MODEL_ALIASES: Record<string, string> = {
  auto: DEFAULT_MODEL,
  default: DEFAULT_MODEL,
  claude: DEFAULT_MODEL,
  'claude-3.5-sonnet': 'claude-3-5-sonnet',
  'claude-3-5-sonnet-latest': 'claude-3-5-sonnet',
  'claude-3.7-sonnet': 'claude-3-7-sonnet',
  'claude-3-7-sonnet-latest': 'claude-3-7-sonnet',
  'claude-3-sonnet': 'claude-3-5-sonnet',
  'claude-3-opus-latest': 'claude-3-opus',
  'gpt-4': 'gpt-4o',
  'gpt-4-turbo': 'gpt-4o',
  'chatgpt-4o': 'gpt-4o',
  'chatgpt-4o-latest': 'gpt-4o',
  'deepseek-reasoner': 'deepseek-r1',
  'deepseek-chat': 'deepseek-v3',
  deepseek: 'deepseek-r1',
  'gemini-pro': 'gemini-1.5-pro',
  'gemini-flash': 'gemini-2.0-flash',
  gemini: 'gemini-2.0-flash',
  qwen: 'qwen-2.5-max',
  'o1-preview': 'o1',
};

/**
 * Resolves a user-provided model name or alias to the closest Arena canonical model ID.
 */
export function resolveModelAlias(model: string): string {
  if (!model || !model.trim()) {
    return DEFAULT_MODEL;
  }

  let cleaned = model.trim().toLowerCase();

  if (cleaned === 'auto' || cleaned === 'default') {
    return DEFAULT_MODEL;
  }

  // Strip provider prefix if present (e.g. openai/gpt-4o -> gpt-4o)
  if (cleaned.includes('/')) {
    const parts = cleaned.split('/');
    cleaned = parts[parts.length - 1];
  }

  // Check alias table first
  if (MODEL_ALIASES[cleaned]) {
    return MODEL_ALIASES[cleaned];
  }

  // Check if directly in known models
  if (KNOWN_ARENA_MODELS.includes(cleaned)) {
    return cleaned;
  }

  // Strip date snapshots (e.g. -20241022, -2024-08-06)
  const dateStripped = cleaned.replace(/-\d{4}-?\d{2}-?\d{2}$/, '');
  if (MODEL_ALIASES[dateStripped]) {
    return MODEL_ALIASES[dateStripped];
  }
  if (KNOWN_ARENA_MODELS.includes(dateStripped)) {
    return dateStripped;
  }

  // Replace dots with hyphens (e.g. claude-3.5-sonnet -> claude-3-5-sonnet)
  const dotNormalized = dateStripped.replace(/(\d+)\.(\d+)/g, '$1-$2');
  if (MODEL_ALIASES[dotNormalized]) {
    return MODEL_ALIASES[dotNormalized];
  }
  if (KNOWN_ARENA_MODELS.includes(dotNormalized)) {
    return dotNormalized;
  }

  // Partial match against known models (e.g. "r1" -> "deepseek-r1")
  const partialMatch = KNOWN_ARENA_MODELS.find(
    (m) => m === dotNormalized || m.endsWith(`-${dotNormalized}`)
  );
  if (partialMatch) {
    return partialMatch;
  }

  return dotNormalized;
}

/**
 * Formats ChatMessage array into a single cohesive conversational prompt string.
 */
export function formatMessages(messages: ChatMessage[]): string {
  if (!messages || messages.length === 0) {
    return '';
  }

  if (messages.length === 1 && messages[0].role === 'user') {
    return messages[0].content;
  }

  const parts: string[] = [];
  for (const msg of messages) {
    const content = msg.content.trim();
    if (!content) continue;

    if (msg.role === 'system') {
      parts.push(`System: ${content}`);
    } else if (msg.role === 'user') {
      parts.push(`User: ${content}`);
    } else if (msg.role === 'assistant') {
      parts.push(`Assistant: ${content}`);
    }
  }

  return parts.join('\n\n');
}
