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

export type ArenaMode = 'direct' | 'agent' | 'side-by-side';

export interface ArenaTarget {
  /** Arena UI mode / route family. */
  mode: ArenaMode;
  /** True when the caller used an explicit mode prefix (arena/..., direct:, agent:, side-by-side:). */
  explicit: boolean;
  /** Underlying model token for direct/agent, or primary model for side-by-side. */
  model: string;
  /** Resolved model tokens for side-by-side (A, B). */
  models?: [string, string];
  /** Original input. */
  raw: string;
  /**
   * For direct mode: navigate to /text/direct?model=<id>. Only enabled for explicit
   * namespaced targets so legacy plain model IDs keep the previous URL behavior/tests.
   */
  useModelParam: boolean;
}

function stripArenaNamespace(input: string): { mode: ArenaMode | null; rest: string; explicit: boolean } {
  const raw = input.trim();
  const lower = raw.toLowerCase();
  const colonModes: Array<[string, ArenaMode]> = [
    ['side-by-side:', 'side-by-side'],
    ['side_by_side:', 'side-by-side'],
    ['sbs:', 'side-by-side'],
    ['agent:', 'agent'],
    ['direct:', 'direct'],
  ];
  for (const [prefix, mode] of colonModes) {
    if (lower.startsWith(prefix)) {
      return { mode, rest: raw.slice(prefix.length), explicit: true };
    }
  }
  // arena/<mode>/... or arena/<mode>?...
  if (lower.startsWith('arena/')) {
    const after = raw.slice('arena/'.length);
    const m = after.match(/^(direct|agent|side-by-side|side_by_side|sbs)(?:[/?](.*))?$/i);
    if (m) {
      const modeToken = m[1].toLowerCase();
      const mode: ArenaMode =
        modeToken === 'agent' ? 'agent' : modeToken === 'direct' ? 'direct' : 'side-by-side';
      return { mode, rest: (m[2] ?? '').trim(), explicit: true };
    }
    // arena/<model> treated as direct explicit
    return { mode: 'direct', rest: after.trim(), explicit: true };
  }
  return { mode: null, rest: raw, explicit: false };
}

function parseSideBySideModels(rest: string): [string, string] | null {
  const cleaned = rest.replace(/^\?model=/i, '').trim();
  if (!cleaned) return null;
  const sep = cleaned.includes('+') ? '+' : cleaned.includes('|') ? '|' : cleaned.includes(',') ? ',' : null;
  if (!sep) return null;
  const parts = cleaned.split(sep).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts[1]];
  return null;
}

/**
 * Parses an Arena target from a user/model string. Supports backward-compatible
 * plain model IDs (direct mode) and explicit mode prefixes:
 * - arena/direct/<model> or direct:<model>
 * - arena/agent/<model> or agent:<model>
 * - arena/side-by-side/<modelA>+<modelB> or side-by-side:<modelA>+<modelB>
 */
export function parseArenaTarget(model: string): ArenaTarget {
  const raw = (model ?? '').toString();
  const { mode: parsedMode, rest, explicit } = stripArenaNamespace(raw);
  const mode = parsedMode ?? 'direct';

  if (mode === 'side-by-side') {
    const pair = parseSideBySideModels(rest);
    if (!pair) {
      return { mode, explicit, model: rest || 'auto', raw, useModelParam: false };
    }
    return { mode, explicit, model: pair[0], models: pair, raw, useModelParam: false };
  }

  const modelToken = rest.replace(/^\?model=/i, '').trim() || (explicit ? 'auto' : raw);
  return {
    mode,
    explicit,
    model: modelToken,
    raw,
    useModelParam: mode === 'direct' && explicit && !!rest.replace(/^\?model=/i, '').trim(),
  };
}

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
 * Preserves tool-calling turns so web models can see tool invocations and results.
 */
export function formatMessages(messages: ChatMessage[]): string {
  if (!messages || messages.length === 0) {
    return '';
  }

  const hasTooling = messages.some((m) => m.role === 'tool' || (Array.isArray((m as any).tool_calls) && (m as any).tool_calls.length > 0));
  if (!hasTooling && messages.length === 1 && messages[0].role === 'user') {
    const raw = (messages[0] as any).content;
    return typeof raw === 'string' ? raw : String(raw ?? '');
  }

  const toolNameById = new Map<string, string>();
  for (const msg of messages) {
    const calls = (msg as any).tool_calls;
    if (msg.role === 'assistant' && Array.isArray(calls)) {
      for (const tc of calls) {
        const id = String(tc?.id || '');
        const name = String(tc?.function?.name || tc?.name || 'tool');
        if (id) toolNameById.set(id, name);
      }
    }
  }

  const parts: string[] = [];
  for (const msg of messages) {
    const rawContent = (msg as any).content;
    let content = '';
    if (typeof rawContent === 'string') content = rawContent.trim();
    else if (rawContent == null) content = '';
    else if (Array.isArray(rawContent)) {
      content = rawContent.map((p: any) => {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object') {
          if (typeof p.text === 'string') return p.text;
          if (p.type === 'text' && typeof p.text === 'string') return p.text;
          if (typeof p.content === 'string') return p.content;
        }
        try { return JSON.stringify(p); } catch { return String(p); }
      }).join('\n').trim();
    } else {
      try { content = JSON.stringify(rawContent).trim(); } catch { content = String(rawContent).trim(); }
    }

    if (msg.role === 'system') {
      if (content) parts.push(`System: ${content}`);
      continue;
    }
    if (msg.role === 'user') {
      if (content) parts.push(`User: ${content}`);
      continue;
    }
    if (msg.role === 'assistant') {
      const calls = (msg as any).tool_calls;
      if (Array.isArray(calls) && calls.length > 0) {
        const callLines = calls.map((tc: any) => {
          const name = String(tc?.function?.name || tc?.name || 'tool');
          let args = tc?.function?.arguments ?? tc?.arguments ?? tc?.input ?? {};
          if (typeof args !== 'string') {
            try { args = JSON.stringify(args); } catch { args = String(args); }
          }
          const id = tc?.id ? ` (id: ${tc.id})` : '';
          return `- ${name}${id}\n  arguments: ${args}`;
        });
        const block = `Assistant requested tool call(s):\n${callLines.join('\n')}`;
        parts.push(content ? `Assistant: ${content}\n\n${block}` : block);
      } else if (content) {
        parts.push(`Assistant: ${content}`);
      }
      continue;
    }
    if (msg.role === 'tool') {
      const id = String((msg as any).tool_call_id || (msg as any).toolCallId || '');
      const name = (id && toolNameById.get(id)) || String((msg as any).name || 'tool');
      const label = id ? `Tool result (${name}, id: ${id})` : `Tool result (${name})`;
      parts.push(`${label}:\n${content}`);
      continue;
    }
    if (content) parts.push(`${String(msg.role)}: ${content}`);
  }

  return parts.join('\n\n');
}
