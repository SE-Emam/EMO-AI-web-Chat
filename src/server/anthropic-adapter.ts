import type { ChatMessage } from '../types.js';

/**
 * Anthropic message content block.
 */
export interface AnthropicContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

/**
 * Message object in an Anthropic messages request.
 */
export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

/**
 * Anthropic /v1/messages request payload.
 */
export interface AnthropicMessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicContentBlock[];
  max_tokens?: number;
  stream?: boolean;
  temperature?: number;
  metadata?: unknown;
  stop_sequences?: string[];
  top_p?: number;
  top_k?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  [key: string]: unknown;
}

/**
 * Anthropic response content block — text or tool_use.
 */
export type AnthropicResponseContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

/**
 * Anthropic usage counts.
 */
export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}

/**
 * Anthropic /v1/messages non-streaming response format.
 */
export interface AnthropicMessageResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicResponseContentBlock[];
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

/**
 * Extracts raw string text from Anthropic content (string or block array).
 */
export function extractTextContent(
  content: string | AnthropicContentBlock[] | undefined | null
): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block) continue;
      if (block.type === 'text' || typeof block.text === 'string') {
        parts.push(block.text || '');
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        const inputStr = block.input !== undefined ? JSON.stringify(block.input) : '{}';
        parts.push(`[Tool Use: ${block.name}${block.id ? ` (id=${block.id})` : ''}]\n${inputStr}`);
      } else if (block.type === 'tool_result') {
        const resultText =
          typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
              ? extractTextContent(block.content as AnthropicContentBlock[])
              : '';
        parts.push(`[Tool Result${block.tool_use_id ? ` (tool_use_id=${block.tool_use_id})` : ''}]\n${resultText}`);
      }
    }
    return parts.join('\n');
  }
  return '';
}

/**
 * Parses and validates an Anthropic /v1/messages request body.
 */
export function parseAnthropicRequest(body: unknown): AnthropicMessagesRequest {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid request: request body must be an object');
  }
  const req = body as Partial<AnthropicMessagesRequest>;
  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    throw new Error('Invalid request: "messages" is required and must be a non-empty array');
  }
  return {
    model: typeof req.model === 'string' && req.model.trim() ? req.model.trim() : 'claude-3-5-sonnet',
    messages: req.messages,
    system: req.system,
    max_tokens: req.max_tokens,
    stream: Boolean(req.stream),
    temperature: req.temperature,
    ...req,
  };
}

/**
 * Normalizes Anthropic's native tool_choice into the internal (OpenAI-style)
 * resolution input. Explicit protocol conversion — Anthropic uses:
 * - {type:'auto'}            → auto
 * - {type:'any'}             → required
 * - {type:'tool', name}      → specific tool
 * - {type:'none'}            → none (future-proof)
 * A plain string passes through unchanged.
 */
export function normalizeAnthropicToolChoice(toolChoice: unknown): unknown {
  if (toolChoice === undefined || toolChoice === null) return undefined;
  if (typeof toolChoice === 'string') return toolChoice;
  if (typeof toolChoice === 'object') {
    const tc = toolChoice as Record<string, unknown>;
    if (tc.type === 'auto') return 'auto';
    if (tc.type === 'any') return 'required';
    if (tc.type === 'none') return 'none';
    if (tc.type === 'tool' && typeof tc.name === 'string') {
      return { type: 'function', function: { name: tc.name } };
    }
  }
  return 'auto';
}

/**
 * Converts Anthropic messages and optional system message into standard ChatMessage[] for ArenaDriver.
 * If system is provided, prepends { role: 'system', content: ... }.
 */
export function convertAnthropicMessages(
  messages: AnthropicMessage[],
  system?: string | AnthropicContentBlock[]
): ChatMessage[] {  const result: ChatMessage[] = [];

  const systemText = extractTextContent(system);
  if (systemText && systemText.trim().length > 0) {
    result.push({
      role: 'system',
      content: systemText,
    });
  }

  for (const msg of messages) {
    result.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: extractTextContent(msg.content),
    });
  }

  return result;
}

/**
 * Converts an entire AnthropicMessagesRequest into ChatMessage[].
 */
export function convertAnthropicRequestToChatMessages(
  request: AnthropicMessagesRequest
): ChatMessage[] {
  return convertAnthropicMessages(request.messages, request.system);
}

// Aliases for message conversion
export const parseAnthropicMessages = convertAnthropicMessages;
export const anthropicMessagesToChatMessages = convertAnthropicMessages;

/**
 * Formats a non-streaming Anthropic message response.
 */
export function formatAnthropicMessageResponse(
  id: string,
  model: string,
  text: string,
  inputTokens = 0,
  outputTokens = 0,
  stopReason: string | null = 'end_turn',
  stopSequence: string | null = null
): AnthropicMessageResponse {
  const formattedId = id.startsWith('msg_') ? id : `msg_${id}`;
  return {
    id: formattedId,
    type: 'message',
    role: 'assistant',
    model,
    content: [
      {
        type: 'text',
        text,
      },
    ],
    stop_reason: stopReason,
    stop_sequence: stopSequence,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  };
}

// Alias for response formatting
export const formatAnthropicResponse = formatAnthropicMessageResponse;

/**
 * Formats a generic Anthropic SSE event string.
 */
export function formatAnthropicSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Formats an Anthropic `message_start` SSE event.
 */
export function formatAnthropicMessageStart(
  id: string,
  model: string,
  inputTokens = 0
): string {
  const formattedId = id.startsWith('msg_') ? id : `msg_${id}`;
  return formatAnthropicSSE('message_start', {
    type: 'message_start',
    message: {
      id: formattedId,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens,
        output_tokens: 1,
      },
    },
  });
}

/**
 * Formats an Anthropic `content_block_start` SSE event.
 */
export function formatAnthropicContentBlockStart(
  index = 0,
  text = ''
): string {
  return formatAnthropicSSE('content_block_start', {
    type: 'content_block_start',
    index,
    content_block: {
      type: 'text',
      text,
    },
  });
}

/**
 * Formats an Anthropic `content_block_delta` SSE event.
 */
export function formatAnthropicContentBlockDelta(
  index = 0,
  textDelta: string
): string {
  return formatAnthropicSSE('content_block_delta', {
    type: 'content_block_delta',
    index,
    delta: {
      type: 'text_delta',
      text: textDelta,
    },
  });
}

/**
 * Formats an Anthropic `content_block_stop` SSE event.
 */
export function formatAnthropicContentBlockStop(index = 0): string {
  return formatAnthropicSSE('content_block_stop', {
    type: 'content_block_stop',
    index,
  });
}

/**
 * Formats an Anthropic `message_delta` SSE event.
 */
export function formatAnthropicMessageDelta(
  stopReason: string = 'end_turn',
  outputTokens = 0
): string {
  return formatAnthropicSSE('message_delta', {
    type: 'message_delta',
    delta: {
      stop_reason: stopReason,
      stop_sequence: null,
    },
    usage: {
      output_tokens: outputTokens,
    },
  });
}

/**
 * Formats an Anthropic `message_stop` SSE event.
 */
export function formatAnthropicMessageStop(): string {
  return formatAnthropicSSE('message_stop', {
    type: 'message_stop',
  });
}

/**
 * Formats an Anthropic SSE error event.
 */
export function formatAnthropicError(
  message: string,
  type = 'api_error'
): string {
  return formatAnthropicSSE('error', {
    type: 'error',
    error: {
      type,
      message,
    },
  });
}

/**
 * Formats an Anthropic ping SSE event.
 */
export function formatAnthropicPing(): string {
  return formatAnthropicSSE('ping', {
    type: 'ping',
  });
}

// Aliases matching prompt conventions
export const formatMessageStartChunk = formatAnthropicMessageStart;
export const formatContentBlockStartChunk = formatAnthropicContentBlockStart;
export const formatContentBlockDeltaChunk = formatAnthropicContentBlockDelta;
export const formatContentBlockStopChunk = formatAnthropicContentBlockStop;
export const formatMessageDeltaChunk = formatAnthropicMessageDelta;
export const formatMessageStopChunk = formatAnthropicMessageStop;

/**
 * Formats a non-streaming Anthropic response containing tool_use blocks.
 */
export function formatAnthropicToolUseResponse(
  id: string,
  model: string,
  cleanText: string | undefined,
  toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>,
  inputTokens = 0,
  outputTokens = 0,
): AnthropicMessageResponse {
  const formattedId = id.startsWith('msg_') ? id : `msg_${id}`;
  const content: AnthropicResponseContentBlock[] = [];
  if (cleanText) {
    content.push({ type: 'text', text: cleanText });
  }
  for (const tc of toolCalls) {
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
    content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
  }
  return {
    id: formattedId,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

/**
 * Formats SSE events for streaming Anthropic tool_use blocks.
 */
export function formatAnthropicToolUseSSE(
  toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>,
  startIndex: number,
): string {
  let out = '';
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    const idx = startIndex + i;
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
    out += formatAnthropicSSE('content_block_start', {
      type: 'content_block_start',
      index: idx,
      content_block: { type: 'tool_use', id: tc.id, name: tc.function.name, input: {} },
    });
    out += formatAnthropicSSE('content_block_delta', {
      type: 'content_block_delta',
      index: idx,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
    });
    out += formatAnthropicSSE('content_block_stop', {
      type: 'content_block_stop',
      index: idx,
    });
  }
  return out;
}

/**
 * Converts Anthropic tool_use/tool_result blocks into standard ChatMessage[]
 * with proper role and structured fields. This preserves tool call IDs and
 * maintains the tool calling protocol chain.
 */
export function convertAnthropicMessagesWithTools(
  messages: AnthropicMessage[],
  system?: string | AnthropicContentBlock[],
): ChatMessage[] {
  const result: ChatMessage[] = [];

  const systemText = extractTextContent(system);
  if (systemText && systemText.trim().length > 0) {
    result.push({ role: 'system', content: systemText });
  }

  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const textParts: string[] = [];
      const toolCalls: unknown[] = [];
      for (const block of msg.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          textParts.push(block.text);
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          toolCalls.push({
            id: block.id || `call_anth_${Date.now()}`,
            type: 'function',
            function: {
              name: block.name,
              arguments: block.input !== undefined ? JSON.stringify(block.input) : '{}',
            },
          });
        }
      }
      if (toolCalls.length > 0) {
        result.push({
          role: 'assistant',
          content: textParts.join('\n'),
          tool_calls: toolCalls,
        });
      } else {
        result.push({ role: 'assistant', content: textParts.join('\n') });
      }
    } else if (msg.role === 'user' && Array.isArray(msg.content)) {
      // Check for tool_result blocks
      const textParts: string[] = [];
      const toolResults: Array<{ tool_call_id: string; content: string }> = [];
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          const resultText =
            typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? extractTextContent(block.content as AnthropicContentBlock[])
                : '';
          toolResults.push({
            tool_call_id: String(block.tool_use_id || ''),
            content: resultText,
          });
        } else if (block.type === 'text' && typeof block.text === 'string') {
          textParts.push(block.text);
        }
      }
      // Emit tool results as role: 'tool' messages
      for (const tr of toolResults) {
        result.push({
          role: 'tool',
          content: tr.content,
          tool_call_id: tr.tool_call_id,
        });
      }
      // Emit remaining text as user message
      if (textParts.length > 0) {
        result.push({ role: 'user', content: textParts.join('\n') });
      }
    } else {
      result.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: extractTextContent(msg.content),
      });
    }
  }

  return result;
}
