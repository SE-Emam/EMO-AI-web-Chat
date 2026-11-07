import type {
  ChatCompletionChunk,
  ChatCompletionChunkChoice,
  ChatCompletionResponse,
  ModelListResponse,
} from '../types.js';

/**
 * Formats a single Server-Sent Events (SSE) data line for an OpenAI streaming chunk.
 *
 * @param id Unique ID for the chat completion (e.g. chatcmpl-xxx)
 * @param model Model identifier
 * @param textDelta New token/text content chunk
 * @param finishReason Finish reason ('stop', 'length', etc.) or null
 * @param created Optional unix timestamp in seconds
 * @returns SSE formatted string: "data: {...}\n\n"
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
    finish_reason: (finishReason as 'stop' | 'length' | 'content_filter' | null) ?? null,
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
  created?: number
): ChatCompletionResponse {
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
        },
        finish_reason: 'stop',
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
