import type { ChatMessage } from '../types.js';

/**
 * Single part within a Gemini content object.
 */
export interface GeminiPart {
  text?: string;
  [key: string]: unknown;
}

/**
 * Message / content item in a Gemini generateContent request.
 */
export interface GeminiContent {
  role?: 'user' | 'model' | string;
  parts: GeminiPart[];
  [key: string]: unknown;
}

/**
 * System instruction structure in a Gemini request.
 */
export interface GeminiSystemInstruction {
  role?: string;
  parts?: GeminiPart[];
  text?: string;
  [key: string]: unknown;
}

/**
 * Generation configuration parameters.
 */
export interface GeminiGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  [key: string]: unknown;
}

/**
 * Payload for Gemini generateContent / streamGenerateContent.
 */
export interface GeminiGenerateContentRequest {
  contents: GeminiContent[];
  systemInstruction?: GeminiSystemInstruction | string;
  generationConfig?: GeminiGenerationConfig;
  safetySettings?: unknown[];
  tools?: unknown[];
  model?: string;
  [key: string]: unknown;
}

/**
 * Token usage counts reported by Gemini.
 */
export interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

/**
 * Candidate content object returned by Gemini.
 */
export interface GeminiCandidateContent {
  parts: Array<{ text: string } | { functionCall: { name: string; args?: Record<string, unknown> } }>;
  role: 'model';
}

/**
 * Candidate choice in a Gemini response.
 */
export interface GeminiCandidate {
  content: GeminiCandidateContent;
  finishReason?: string | null;
  index: number;
}

/**
 * Non-streaming response structure for Gemini generateContent.
 */
export interface GeminiGenerateContentResponse {
  candidates: GeminiCandidate[];
  usageMetadata: GeminiUsageMetadata;
  modelVersion: string;
}

/**
 * Extracts plain text from an array of Gemini parts or a single string.
 */
export function extractGeminiPartsText(
  parts?: GeminiPart[] | string | null
): string {
  if (typeof parts === 'string') return parts;
  if (Array.isArray(parts)) {
    const out: string[] = [];
    for (const p of parts) {
      if (!p) continue;
      if (typeof p.text === 'string') {
        out.push(p.text);
      } else if (p.functionCall && typeof p.functionCall === 'object') {
        const fc = p.functionCall as { name?: string; args?: unknown };
        if (fc.name) {
          out.push(`[Function Call: ${fc.name}]\n${JSON.stringify(fc.args ?? {})}`);
        }
      } else if (p.functionResponse && typeof p.functionResponse === 'object') {
        const fr = p.functionResponse as { name?: string; response?: unknown };
        if (fr.name) {
          out.push(`[Function Response: ${fr.name}]\n${JSON.stringify(fr.response ?? {})}`);
        }
      }
    }
    return out.join('\n');
  }
  return '';
}

export const extractTextFromParts = extractGeminiPartsText;

/**
 * Extracts plain text from systemInstruction (parts, text property, or string).
 */
export function extractSystemInstructionText(
  instruction?: GeminiSystemInstruction | string | null
): string {
  if (typeof instruction === 'string') return instruction;
  if (instruction && typeof instruction === 'object') {
    if (Array.isArray(instruction.parts)) {
      return extractGeminiPartsText(instruction.parts);
    }
    if (typeof instruction.text === 'string') {
      return instruction.text;
    }
  }
  return '';
}

/**
 * Validates and parses a raw Gemini generateContent request body.
 */
export function parseGeminiRequest(body: unknown): GeminiGenerateContentRequest {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid request: request body must be an object');
  }
  const req = body as Partial<GeminiGenerateContentRequest>;
  if (!Array.isArray(req.contents) || req.contents.length === 0) {
    throw new Error('Invalid request: "contents" is required and must be a non-empty array');
  }
  return {
    ...req,
    contents: req.contents,
    systemInstruction: req.systemInstruction,
    generationConfig: req.generationConfig,
  };
}

/**
 * Converts Gemini contents and optional systemInstruction into standard ChatMessage[].
 * - Gemini 'model' -> 'assistant'
 * - Gemini 'user' -> 'user' (or default if role is missing)
 * - Prepends systemInstruction as 'system' role
 */
export function convertGeminiContents(
  contents: GeminiContent[],
  systemInstruction?: GeminiSystemInstruction | string
): ChatMessage[] {
  const result: ChatMessage[] = [];

  const systemText = extractSystemInstructionText(systemInstruction);
  if (systemText && systemText.trim().length > 0) {
    result.push({
      role: 'system',
      content: systemText.trim(),
    });
  }

  for (const item of contents) {
    const role: 'user' | 'assistant' = item.role === 'model' ? 'assistant' : 'user';
    const content = extractGeminiPartsText(item.parts);
    result.push({
      role,
      content,
    });
  }

  return result;
}

/**
 * Converts a GeminiGenerateContentRequest into ChatMessage[].
 */
export function convertGeminiRequestToChatMessages(
  request: GeminiGenerateContentRequest
): ChatMessage[] {
  return convertGeminiContents(request.contents, request.systemInstruction);
}

// Aliases matching prompt and codebase conventions
export const parseGeminiMessages = convertGeminiContents;
export const geminiMessagesToChatMessages = convertGeminiContents;

/**
 * Formats a non-streaming Gemini generateContent response.
 */
export function formatGeminiResponse(
  text: string,
  model: string,
  usageMetadata?: Partial<GeminiUsageMetadata>,
  finishReason = 'STOP'
): GeminiGenerateContentResponse {
  const promptTokens = usageMetadata?.promptTokenCount ?? 0;
  const candidatesTokens = usageMetadata?.candidatesTokenCount ?? 0;
  const totalTokens =
    usageMetadata?.totalTokenCount ?? (promptTokens + candidatesTokens);

  return {
    candidates: [
      {
        content: {
          parts: [{ text }],
          role: 'model',
        },
        finishReason,
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: promptTokens,
      candidatesTokenCount: candidatesTokens,
      totalTokenCount: totalTokens,
    },
    modelVersion: model,
  };
}

/**
 * Formats a generic SSE data event (`data: <json>\n\n`).
 */
export function formatGeminiSSE(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Formats an intermediate streaming delta chunk.
 * finishReason is omitted or null, with delta text in parts: [{ text: "<chunk>" }]
 */
export function formatGeminiDeltaChunk(
  deltaText: string,
  model: string,
  index = 0
): string {
  return formatGeminiSSE({
    candidates: [
      {
        content: {
          parts: [{ text: deltaText }],
          role: 'model',
        },
        index,
      },
    ],
    modelVersion: model,
  });
}

/**
 * Formats the final streaming chunk with finishReason: "STOP" and usageMetadata.
 */
export function formatGeminiFinalChunk(
  model: string,
  usageMetadata: GeminiUsageMetadata,
  finishReason = 'STOP',
  index = 0
): string {
  return formatGeminiSSE({
    candidates: [
      {
        content: {
          parts: [{ text: '' }],
          role: 'model',
        },
        finishReason,
        index,
      },
    ],
    usageMetadata,
    modelVersion: model,
  });
}

export interface FormatGeminiStreamChunkOptions {
  text?: string;
  model: string;
  finishReason?: string | null;
  usageMetadata?: GeminiUsageMetadata;
  index?: number;
}

/**
 * Flexible streaming chunk formatter for intermediate or final chunks.
 */
export function formatGeminiStreamChunk(
  opts: FormatGeminiStreamChunkOptions
): string {
  const candidate: Record<string, unknown> = {
    content: {
      parts: [{ text: opts.text ?? '' }],
      role: 'model',
    },
    index: opts.index ?? 0,
  };
  if (opts.finishReason !== undefined && opts.finishReason !== null) {
    candidate.finishReason = opts.finishReason;
  }
  const payload: Record<string, unknown> = {
    candidates: [candidate],
    modelVersion: opts.model,
  };
  if (opts.usageMetadata) {
    payload.usageMetadata = opts.usageMetadata;
  }
  return formatGeminiSSE(payload);
}

/**
 * Formats an SSE error event.
 */
export function formatGeminiError(
  message: string,
  code = 500,
  status = 'INTERNAL'
): string {
  return formatGeminiSSE({
    error: {
      code,
      message,
      status,
    },
  });
}

/**
 * Formats a list of model IDs into Gemini /v1beta/models response format.
 */
export function formatGeminiModelList(models: string[]): {
  models: Array<{
    name: string;
    displayName: string;
    supportedGenerationMethods: string[];
  }>;
} {
  return {
    models: models.map((id) => {
      const cleanId = id.startsWith('models/') ? id.slice('models/'.length) : id;
      return {
        name: `models/${cleanId}`,
        displayName: cleanId,
        supportedGenerationMethods: ['generateContent', 'countTokens'],
      };
    }),
  };
}

/**
 * Normalizes Gemini's native tool_config.functionCallingConfig into the
 * internal (OpenAI-style) resolution input. Explicit protocol conversion:
 * - {functionCallingConfig:{mode:'AUTO'}}                     → auto
 * - {functionCallingConfig:{mode:'ANY'}}                      → required
 * - {functionCallingConfig:{mode:'NONE'}}                     → none
 * - {functionCallingConfig:{mode:'ANY',allowedFunctionNames}} → specific tool
 */
export function normalizeGeminiToolConfig(toolConfig: unknown): unknown {
  if (!toolConfig || typeof toolConfig !== 'object') return undefined;
  const cfg = (toolConfig as { functionCallingConfig?: { mode?: string; allowedFunctionNames?: string[] } }).functionCallingConfig;
  if (!cfg) return undefined;
  const mode = (cfg.mode || 'AUTO').toUpperCase();
  if (mode === 'NONE') return 'none';
  if (mode === 'ANY') {
    if (Array.isArray(cfg.allowedFunctionNames) && cfg.allowedFunctionNames.length > 0) {
      return { type: 'function', function: { name: cfg.allowedFunctionNames[0] } };
    }
    return 'required';
  }
  return 'auto';
}

/**
 * Converts Gemini contents into ChatMessage[] preserving the function calling
 * protocol: functionCall parts become assistant.tool_calls and functionResponse
 * parts become role:'tool' messages with their call identity intact.
 */
export function convertGeminiContentsWithTools(
  contents: GeminiContent[],
  systemInstruction?: GeminiSystemInstruction | string,
): ChatMessage[] {
  const result: ChatMessage[] = [];

  const systemText = extractSystemInstructionText(systemInstruction);
  if (systemText && systemText.trim().length > 0) {
    result.push({ role: 'system', content: systemText.trim() });
  }

  for (const item of contents) {
    const isModel = item.role === 'model';
    const textParts: string[] = [];
    const toolCalls: unknown[] = [];
    const toolResponses: Array<{ name: string; response: string }> = [];

    for (const p of item.parts || []) {
      if (!p) continue;
      if (typeof p.text === 'string') {
        textParts.push(p.text);
      } else if (p.functionCall && typeof p.functionCall === 'object') {
        const fc = p.functionCall as { name?: string; args?: unknown };
        if (fc.name) {
          toolCalls.push({
            id: `call_gemini_${Date.now()}_${toolCalls.length + 1}`,
            type: 'function',
            function: {
              name: fc.name,
              arguments: JSON.stringify(fc.args ?? {}),
            },
          });
        }
      } else if (p.functionResponse && typeof p.functionResponse === 'object') {
        const fr = p.functionResponse as { name?: string; response?: unknown };
        if (fr.name) {
          toolResponses.push({ name: fr.name, response: JSON.stringify(fr.response ?? {}) });
        }
      }
    }

    if (isModel && toolCalls.length > 0) {
      result.push({ role: 'assistant', content: textParts.join('\n'), tool_calls: toolCalls });
    } else if (!isModel && toolResponses.length > 0) {
      for (const tr of toolResponses) {
        result.push({ role: 'tool', content: tr.response, name: tr.name });
      }
      if (textParts.length > 0) {
        result.push({ role: 'user', content: textParts.join('\n') });
      }
    } else {
      result.push({
        role: isModel ? 'assistant' : 'user',
        content: textParts.join('\n'),
      });
    }
  }

  return result;
}

/**
 * Formats a non-streaming Gemini response containing functionCall parts.
 * The real Gemini API returns finishReason 'STOP' with functionCall parts.
 */
export function formatGeminiFunctionCallResponse(
  cleanText: string | undefined,
  toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>,
  model: string,
  usageMetadata?: Partial<GeminiUsageMetadata>,
): GeminiGenerateContentResponse {
  const parts: GeminiCandidateContent['parts'] = [];
  if (cleanText) parts.push({ text: cleanText });
  for (const tc of toolCalls) {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
    parts.push({ functionCall: { name: tc.function.name, args } } as any);
  }
  const promptTokens = usageMetadata?.promptTokenCount ?? 0;
  const candidatesTokens = usageMetadata?.candidatesTokenCount ?? 0;
  const totalTokens = usageMetadata?.totalTokenCount ?? (promptTokens + candidatesTokens);
  return {
    candidates: [
      {
        content: { parts, role: 'model' },
        finishReason: 'STOP',
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: promptTokens,
      candidatesTokenCount: candidatesTokens,
      totalTokenCount: totalTokens,
    },
    modelVersion: model,
  };
}
