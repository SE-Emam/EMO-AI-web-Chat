import type {
  ChatCompletionChunk,
  ChatCompletionChunkChoice,
  ChatCompletionResponse,
  ModelListResponse,
} from '../types.js';

/**
 * Formats a single Server-Sent Events (SSE) data line for an OpenAI streaming chunk.
 */
export function formatChatCompletionChunk(
  id: string,
  model: string,
  textDelta: string,
  finishReason?: string | null,
  created?: number
): string {
  const choice: ChatCompletionChunkChoice = {
    index: 0,
    delta: textDelta ? { content: textDelta } : {},
    finish_reason: (finishReason as 'stop' | 'length' | 'content_filter' | 'tool_calls' | null) ?? null,
  };

  const chunk: ChatCompletionChunk = {
    id,
    object: 'chat.completion.chunk',
    created: created ?? Math.floor(Date.now() / 1000),
    model,
    choices: [choice],
  };

  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * Formats SSE chunks for streamed tool calls (OpenAI-compatible).
 */
export function formatToolCallChunks(
  id: string,
  model: string,
  toolCalls: Array<{ id: string; type?: string; function: { name: string; arguments: string } }>,
  created?: number
): string {
  const ts = created ?? Math.floor(Date.now() / 1000);
  let out = '';
  // role chunk
  out += `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: ts, model, choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] })}\n\n`;
  toolCalls.forEach((tc, i) => {
    out += `data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', created: ts, model,
      choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: tc.id, type: tc.type || 'function', function: { name: tc.function.name, arguments: tc.function.arguments || '' } }] }, finish_reason: null }]
    })}\n\n`;
  });
  out += `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: ts, model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`;
  return out;
}

/**
 * Formats the final SSE termination chunk indicator.
 *
 * @returns "data: [DONE]\n\n"
 */
export function formatDoneChunk(): string {
  return 'data: [DONE]\n\n';
}

/**
 * Formats a non-streaming OpenAI Chat Completion response.
 *
 * @param id Unique ID for the chat completion
 * @param model Model identifier
 * @param fullContent Complete assistant output message content
 * @param promptTokens Optional prompt token count (defaults to 0)
 * @param completionTokens Optional completion token count (defaults to 0)
 * @param created Optional unix timestamp in seconds
 * @returns ChatCompletionResponse object
 */
export function formatChatCompletionResponse(
  id: string,
  model: string,
  fullContent: string,
  promptTokens = 0,
  completionTokens = 0,
  created?: number,
  toolCalls?: unknown[],
  finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls' = 'stop'
): ChatCompletionResponse {
  const hasTools = Array.isArray(toolCalls) && toolCalls.length > 0;
  return {
    id,
    object: 'chat.completion',
    created: created ?? Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: fullContent,
          ...(hasTools ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: hasTools ? 'tool_calls' : finishReason,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

/**
 * Formats a list of model identifiers into OpenAI /v1/models response schema.
 *
 * @param models Array of model IDs
 * @returns ModelListResponse object
 */
export function formatModelList(models: string[]): ModelListResponse {
  return {
    object: 'list',
    data: models.map((m) => ({
      id: m,
      object: 'model',
      created: 1700000000,
      owned_by: 'arena',
    })),
  };
}
