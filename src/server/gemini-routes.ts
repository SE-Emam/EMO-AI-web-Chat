import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { isValidApiKey } from '../gateway/security.js';
import type { ArenaDriver, ChatMessage } from '../types.js';
import type { UsageTracker } from '../gateway/usage-tracker.js';
import type { RequestBroker } from '../protocol/request-broker.js';
import { detectClientAgent } from './app.js';
import { chatSessionKey } from './chat-session-key.js';
import {
  payloadFingerprint,
  beginBrokeredRequest,
  completeBrokered,
  failBrokered,
  markSentBrokered,
  type BrokeredClaim,
} from './request-broker-helpers.js';
import {
  convertGeminiContents,
  convertGeminiContentsWithTools,
  normalizeGeminiToolConfig,
  formatGeminiResponse,
  formatGeminiFunctionCallResponse,
  formatGeminiSSE,
  formatGeminiDeltaChunk,
  formatGeminiFinalChunk,
  formatGeminiError,
  formatGeminiModelList,
  type GeminiGenerateContentRequest,
} from './gemini-adapter.js';
import { injectToolsInstruction, parseToolCallsFromResponse, resolveToolChoice, decideToolOutcome, hydrateToolResultNames } from './tool-interpreter.js';

export interface GeminiRoutesOptions {
  getDriver: () => ArenaDriver;
  tracker?: UsageTracker;
  requireApiKey?: boolean;
  apiKey?: string;
  getValidApiKeys?: () => string[];
  getScopedGroup?: (key: string) => { name: string } | undefined;
  /**
   * Task 12 — the ONE shared RequestBroker instance (same store + ProcessLock
   * as the OpenAI/Anthropic paths). When present, opt-in idempotency via
   * X-Request-Id applies to /v1beta generateContent routes; absent →
   * behavior unchanged (no forced idempotency).
   */
  broker?: RequestBroker;
}

export function extractGeminiApiKey(req: FastifyRequest): string | undefined {
  const xGoogKey = req.headers['x-goog-api-key'];
  if (typeof xGoogKey === 'string' && xGoogKey.trim()) {
    return xGoogKey.trim();
  }
  if (Array.isArray(xGoogKey) && xGoogKey[0]?.trim()) {
    return xGoogKey[0].trim();
  }

  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
    if (auth.trim()) return auth.trim();
  }

  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey.trim()) {
    return xApiKey.trim();
  }
  if (Array.isArray(xApiKey) && xApiKey[0]?.trim()) {
    return xApiKey[0].trim();
  }

  const query = req.query as Record<string, unknown> | undefined;
  if (query && typeof query.key === 'string' && query.key.trim()) {
    return query.key.trim();
  }

  return undefined;
}

export function getGeminiValidKeys(opts: GeminiRoutesOptions): string[] {
  const keys: string[] = [];
  if (opts.apiKey && opts.apiKey.trim()) {
    keys.push(opts.apiKey.trim());
  }
  if (opts.getValidApiKeys) {
    const extra = opts.getValidApiKeys();
    if (Array.isArray(extra)) {
      keys.push(...extra.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim()));
    }
  }
  return keys;
}

export function isGeminiAuthorized(req: FastifyRequest, opts: GeminiRoutesOptions): boolean {
  if (opts.requireApiKey === false) return true;
  const shouldCheck =
    opts.requireApiKey === true ||
    (opts.requireApiKey === undefined && Boolean(opts.apiKey || opts.getValidApiKeys));
  if (!shouldCheck) return true;

  const provided = extractGeminiApiKey(req);
  if (!provided) return false;

  const validKeys = getGeminiValidKeys(opts);
  if (validKeys.length === 0) return false;
  return isValidApiKey(provided, validKeys);
}

function promptChars(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages) n += String(m.content || '').length;
  return n;
}

/**
 * Task 12 — serves a stored broker result as a NATIVE Gemini response.
 * The stored `nativeReplay` (the exact object the first execution returned)
 * is replayed as-is for JSON; for SSE the native chunk sequence is rebuilt
 * from the stored text with the SAME formatters (candidates/content/parts
 * delta + final chunk with finishReason). Chunking of a replay is a single
 * delta (timing/slicing of the original stream is not preserved —
 * documented). An OpenAI/Anthropic body can never be returned here: the
 * payload comes from this protocol's own complete() only.
 */
function serveGeminiReplay(
  result: unknown,
  reply: FastifyReply,
  opts: { stream?: boolean },
  fallbackModel: string,
  pChars: number,
  tracker?: UsageTracker
): void {
  const stored = (result ?? {}) as {
    id?: string;
    model?: string;
    content?: string;
    nativeReplay?: {
      candidates?: Array<{
        content?: { parts?: Array<Record<string, unknown>> };
      }>;
    };
  };
  const rmodel = stored.model || fallbackModel;
  const text =
    (opts.stream ? (stored.nativeReplay as { text?: string })?.text : undefined) ??
    stored.nativeReplay?.candidates?.[0]?.content?.parts?.[0]?.text ??
    stored.content ??
    '';
  const inTokens = Math.max(1, Math.ceil(pChars / 4));
  const outTokens = Math.max(1, Math.ceil(String(text).length / 4));
  tracker?.recordRequestEnd({
    id: stored.id || '',
    ok: true,
    completionChars: String(text).length,
  });

  if (opts.stream) {
    const streamText = String((stored.nativeReplay as { text?: string })?.text ?? stored.content ?? '');
    reply.hijack();
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.setHeader('Access-Control-Allow-Headers', '*');
    reply.raw.setHeader('x-emo-replay', 'true');
    reply.raw.writeHead(200);
    // Replay of a STORED outcome — a single rebuilt delta, not a live run.
    reply.raw.write(formatGeminiDeltaChunk(streamText, rmodel));
    reply.raw.write(
      formatGeminiFinalChunk(
        rmodel,
        {
          promptTokenCount: inTokens,
          candidatesTokenCount: outTokens,
          totalTokenCount: inTokens + outTokens,
        },
        'STOP'
      )
    );
    reply.raw.end();
    return;
  }

  let native = stored.nativeReplay;
  if (!native || typeof native !== 'object' || !Array.isArray(native.candidates)) {
    // Legacy/plain entries (no nativeReplay): rebuild from the stored text
    // with the native formatter — documented fallback, still Gemini-format.
    native = formatGeminiResponse(
      String(stored.content ?? ''),
      rmodel,
      {
        promptTokenCount: inTokens,
        candidatesTokenCount: outTokens,
        totalTokenCount: inTokens + outTokens,
      },
      'STOP'
    );
  }
  reply.header('x-emo-replay', 'true');
  reply.send(native);
}

interface ParsedModelAction {
  model: string;
  action: 'generateContent' | 'streamGenerateContent' | 'countTokens';
}

function parseModelAction(rawParam: string | undefined): ParsedModelAction | null {
  if (!rawParam) return null;
  let raw = rawParam.trim();
  while (raw.startsWith('models/')) {
    raw = raw.slice('models/'.length);
  }

  if (raw.endsWith(':generateContent')) {
    let model = raw.slice(0, -':generateContent'.length);
    if (model.startsWith('models/')) model = model.slice('models/'.length);
    return { model, action: 'generateContent' };
  }
  if (raw.endsWith(':streamGenerateContent')) {
    let model = raw.slice(0, -':streamGenerateContent'.length);
    if (model.startsWith('models/')) model = model.slice('models/'.length);
    return { model, action: 'streamGenerateContent' };
  }
  if (raw.endsWith(':countTokens')) {
    let model = raw.slice(0, -':countTokens'.length);
    if (model.startsWith('models/')) model = model.slice('models/'.length);
    return { model, action: 'countTokens' };
  }
  return null;
}

/**
 * Registers Google Gemini /v1beta protocol adapter routes on the Fastify instance.
 */
export function registerGeminiRoutes(
  app: FastifyInstance,
  opts: GeminiRoutesOptions
): void {
  const sendCors = (reply: FastifyReply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-Goog-Api-Key, x-goog-api-key, X-Api-Key, x-api-key'
    );
    return reply.status(204).send();
  };

  app.options('/v1beta/models', async (_req, reply) => sendCors(reply));
  app.options('/v1beta/models/:modelAction', async (_req, reply) => sendCors(reply));
  app.options('/v1beta/models/*', async (_req, reply) => sendCors(reply));
  app.options('/v1beta/:modelAction', async (_req, reply) => sendCors(reply));
  app.options('/v1beta/*', async (_req, reply) => sendCors(reply));

  app.get('/v1beta/models', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isGeminiAuthorized(req, opts)) {
      return reply.status(401).send({
        error: {
          code: 401,
          message: 'Invalid or missing API key',
          status: 'UNAUTHENTICATED',
        },
      });
    }

    try {
      const providedKey = extractGeminiApiKey(req);
      const scopedGroup = providedKey && opts.getScopedGroup ? opts.getScopedGroup(providedKey) : undefined;
      if (scopedGroup?.name) {
        return reply.status(200).send(formatGeminiModelList([scopedGroup.name]));
      }
      const driver = opts.getDriver();
      const rawModels = driver ? await driver.listModels() : [];
      return reply.status(200).send(formatGeminiModelList(rawModels));
    } catch (err: unknown) {
      const error = err as { statusCode?: number; status?: string; message?: string };
      return reply.status(error.statusCode || 500).send({
        error: {
          code: error.statusCode || 500,
          message: error.message || 'Failed to list models',
          status: error.status || 'INTERNAL',
        },
      });
    }
  });

  app.get(
    '/v1beta/models/:modelName',
    async (
      req: FastifyRequest<{ Params: { modelName: string } }>,
      reply: FastifyReply
    ) => {
      if (!isGeminiAuthorized(req, opts)) {
        return reply.status(401).send({
          error: {
            code: 401,
            message: 'Invalid or missing API key',
            status: 'UNAUTHENTICATED',
          },
        });
      }

      let cleanId = req.params.modelName || '';
      if (cleanId.startsWith('models/')) cleanId = cleanId.slice('models/'.length);
      const providedKey = extractGeminiApiKey(req);
      const scopedGroup = providedKey && opts.getScopedGroup ? opts.getScopedGroup(providedKey) : undefined;
      if (scopedGroup?.name && cleanId.toLowerCase() !== scopedGroup.name.toLowerCase()) {
        return reply.status(403).send({
          error: {
            code: 403,
            message: `This API key is scoped to router group "${scopedGroup.name}".`,
            status: 'PERMISSION_DENIED',
          },
        });
      }
      if (scopedGroup?.name) cleanId = scopedGroup.name;
      return reply.status(200).send({
        name: `models/${cleanId}`,
        displayName: cleanId,
        supportedGenerationMethods: ['generateContent', 'countTokens'],
      });
    }
  );

  const handleGenerateContent = async (
    req: FastifyRequest,
    reply: FastifyReply,
    modelActionParam?: string
  ) => {
    if (!isGeminiAuthorized(req, opts)) {
      return reply.status(401).send({
        error: {
          code: 401,
          message: 'Invalid or missing API key',
          status: 'UNAUTHENTICATED',
        },
      });
    }

    const target = parseModelAction(modelActionParam);
    if (!target) {
      return reply.status(404).send({
        error: {
          code: 404,
          message: 'Unsupported endpoint or action',
          status: 'NOT_FOUND',
        },
      });
    }

    const body = req.body as Partial<GeminiGenerateContentRequest> | undefined;
    if (!body || !Array.isArray(body.contents) || body.contents.length === 0) {
      return reply.status(400).send({
        error: {
          code: 400,
          message: 'Invalid request: "contents" is required and must be a non-empty array',
          status: 'INVALID_ARGUMENT',
        },
      });
    }

    let model = target.model.trim();
    if (!model) {
      model =
        typeof body.model === 'string' && body.model.trim()
          ? body.model.trim()
          : 'gemini-1.5-flash';
    }
    if (model.startsWith('models/')) {
      model = model.slice('models/'.length);
    }
    const providedKey = extractGeminiApiKey(req);
    const scopedGroup = providedKey && opts.getScopedGroup ? opts.getScopedGroup(providedKey) : undefined;
    if (scopedGroup?.name) {
      if (model.toLowerCase() !== 'auto' && model.toLowerCase() !== scopedGroup.name.toLowerCase() && model !== 'gemini-1.5-flash') {
        // allow default fallback only to be coerced; reject explicit different models
      }
      if (model.toLowerCase() !== 'auto' && model.toLowerCase() !== scopedGroup.name.toLowerCase() && !(model === 'gemini-1.5-flash' && (!body.model || !String(body.model).trim()))) {
        return reply.status(403).send({
          error: {
            code: 403,
            message: `This API key is scoped to router group "${scopedGroup.name}". Use model "${scopedGroup.name}".`,
            status: 'PERMISSION_DENIED',
          },
        });
      }
      model = scopedGroup.name;
    }

    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    const internalToolChoice = normalizeGeminiToolConfig((body as any).tool_config);
    const toolRes = hasTools ? resolveToolChoice(internalToolChoice, body.tools!.length) : { shouldInjectTools: false, shouldParseTools: false, requireToolCall: false } as const;
    // Convert messages — use tool-aware conversion when tools are present
    // to preserve functionCall/functionResponse parts as proper ChatMessage fields.
    let chatMessages = hasTools
      ? convertGeminiContentsWithTools(body.contents, body.systemInstruction)
      : convertGeminiContents(body.contents, body.systemInstruction);
    if (toolRes.shouldInjectTools) {
      // Convert Gemini functionDeclarations to OpenAI format for injection
      const openaiTools: unknown[] = [];
      for (const t of body.tools as any[]) {
        for (const fd of t?.functionDeclarations || []) {
          openaiTools.push({
            type: 'function' as const,
            function: {
              name: fd.name,
              description: fd.description || '',
              parameters: fd.parameters || {},
            },
          });
        }
      }
      chatMessages = hydrateToolResultNames(chatMessages);
      chatMessages = injectToolsInstruction(chatMessages, openaiTools, internalToolChoice);
    }
    const pChars = promptChars(chatMessages);

    if (target.action === 'countTokens') {
      const inTokens = Math.max(1, Math.ceil(pChars / 4));
      return reply.status(200).send({
        totalTokens: inTokens,
      });
    }

    const query = req.query as Record<string, unknown> | undefined;
    const isStream =
      target.action === 'streamGenerateContent' || query?.alt === 'sse';

    const abortController = new AbortController();
    const onSocketClose = () => {
      if (!reply.raw.writableEnded) abortController.abort();
    };
    req.raw.socket?.on('close', onSocketClose);
    req.raw.on('aborted', () => abortController.abort());

    const id = `gemini_${randomUUID().replace(/-/g, '')}`;
    const clientAgent = detectClientAgent(req, 'Gemini CLI');
    opts.tracker?.recordRequestStart({
      id,
      model,
      stream: Boolean(isStream),
      promptChars: pChars,
      clientAgent,
    });
    let completionChars = 0;

    // ---- Task 12: unified claim-once broker (opt-in via X-Request-Id) ----
    // Same lifecycle as the Anthropic/OpenAI paths over the SAME broker
    // instance. The fingerprint covers the EFFECTIVE body (post model
    // coercion). countTokens/GET routes are not executions → never claimed.
    const requestIdHeader = String(req.headers['x-request-id'] || '').trim();
    const apiKeyScope = providedKey || 'anon';
    let brokeredClaim: BrokeredClaim | null = null;
    if (opts.broker && requestIdHeader) {
      const claim = await beginBrokeredRequest({
        protocol: 'gemini',
        apiKeyScope,
        providerId: model,
        requestId: requestIdHeader,
        fingerprint: payloadFingerprint(body, 'gemini'),
        broker: opts.broker,
        sessionKey: chatSessionKey(req, body, chatMessages),
      });
      if (claim.kind === 'conflict') {
        return reply.status(409).send({
          error: {
            code: 409,
            message: `idempotency_key_reused_with_different_request: request id "${requestIdHeader}" was already used with a different payload; refusing to replay a non-matching result.`,
            status: 'ABORTED',
          },
        });
      }
      if (claim.kind === 'denied') {
        const message =
          claim.state === 'running'
            ? `Request ${requestIdHeader} is already in progress (claim-once). Poll or wait for the original request to finish.`
            : claim.state === 'unconfirmed'
              ? `Request ${requestIdHeader} ended UNCONFIRMED: the message may have already been sent to the web chat (${claim.reason || 'unknown reason'}). Verify on the web side before re-issuing; do NOT blindly retry.`
              : claim.state === 'completed'
                ? `Request ${requestIdHeader} completed earlier but its result was too large to replay.`
                : `Request ${requestIdHeader} is ${claim.state}.`;
        return reply.status(409).send({
          error: {
            code: 409,
            message,
            status: 'ALREADY_EXISTS',
            state: claim.state,
            ...(claim.reason ? { reason: claim.reason } : {}),
          },
        });
      }
      if (claim.kind === 'replay') {
        serveGeminiReplay(claim.result, reply, { stream: isStream }, model, pChars, opts.tracker);
        return;
      }
      if (claim.kind === 'execute') brokeredClaim = claim;
      // kind 'none' → no X-Request-Id → proceed exactly as before.
    }
    const brokerFail = (message: string) => {
      if (brokeredClaim?.kind === 'execute') {
        void failBrokered(brokeredClaim, { retryable: true, error: message }).catch(() => {});
      }
    };
    const brokerComplete = (result: unknown) => {
      if (brokeredClaim?.kind === 'execute') {
        void completeBrokered(brokeredClaim, result).catch(() => {});
      }
    };

    try {
      const driver = opts.getDriver();
      if (!driver) {
        throw new Error('No active driver available');
      }

      if (isStream) {
        let headersSent = false;
        const ensureHeaders = () => {
          if (!headersSent) {
            headersSent = true;
            reply.hijack();
            reply.raw.setHeader('Content-Type', 'text/event-stream');
            reply.raw.setHeader('Cache-Control', 'no-cache');
            reply.raw.setHeader('Connection', 'keep-alive');
            reply.raw.setHeader('Access-Control-Allow-Origin', '*');
            reply.raw.setHeader('Access-Control-Allow-Headers', '*');
            reply.raw.writeHead(200);
          }
        };

        try {
          // The send is INITIATED here: any later failure is unconfirmed.
          if (brokeredClaim?.kind === 'execute') markSentBrokered(brokeredClaim);
          let streamFull = '';
          const sendFn = driver.sendMessage.bind(driver) as any;
          let streamResult: string | undefined;

          if (toolRes.shouldParseTools) {
            // Buffer when tools are present so functionCall parts can be
            // detected and emitted as native Gemini parts.
            if (sendFn.length === 1) {
              streamResult = await sendFn({
                model,
                messages: chatMessages,
                stream: true,
                onChunk: (chunk: string) => { streamFull += chunk; },
                signal: abortController.signal,
              });
            } else {
              streamResult = await driver.sendMessage(
                model,
                chatMessages,
                (chunk: string) => { streamFull += chunk; },
                abortController.signal,
                chatSessionKey(req, body, chatMessages)
              );
            }
            if (completionChars === 0 && streamResult && streamResult.length > 0) {
              completionChars = streamResult.length;
              streamFull += streamResult;
            } else {
              completionChars = String(streamFull || '').length;
            }
            ensureHeaders();
            const toolResult = parseToolCallsFromResponse(String(streamFull || ''));
            const decision = decideToolOutcome(toolResult, toolRes);
            const inTokens = Math.max(1, Math.ceil(pChars / 4));
            const outTokens = Math.max(1, Math.ceil(completionChars / 4));
            const usage = {
              promptTokenCount: inTokens,
              candidatesTokenCount: outTokens,
              totalTokenCount: inTokens + outTokens,
            };
            if (decision.emitToolCalls && decision.toolCalls) {
              const native = formatGeminiFunctionCallResponse(
                decision.cleanText || undefined,
                decision.toolCalls as any,
                model,
                usage
              );
              reply.raw.write(formatGeminiSSE({ ...native, candidates: [{ ...native.candidates[0], finishReason: undefined, index: 0 }] }));
              reply.raw.write(
                formatGeminiFinalChunk(model, usage, 'STOP')
              );
              reply.raw.end();
              opts.tracker?.recordRequestEnd({ id, ok: true, completionChars });
              brokerComplete({
                id,
                model,
                content: streamFull,
                cleanText: decision.cleanText,
                toolCalls: decision.toolCalls,
                nativeReplay: formatGeminiFunctionCallResponse(
                  decision.cleanText || undefined,
                  decision.toolCalls as any,
                  model,
                  usage
                ),
              });
            } else if (decision.protocolError) {
              reply.raw.write(
                formatGeminiError(
                  'Model did not produce a required tool call. tool_choice was "required".',
                  400,
                  'INVALID_ARGUMENT'
                )
              );
              reply.raw.end();
              brokerFail(decision.protocolError);
            } else {
              if (streamFull) reply.raw.write(formatGeminiDeltaChunk(streamFull, model));
              reply.raw.write(formatGeminiFinalChunk(model, usage, 'STOP'));
              reply.raw.end();
              opts.tracker?.recordRequestEnd({ id, ok: true, completionChars });
              brokerComplete({
                id,
                model,
                content: streamFull,
                nativeReplay: { id, model, text: streamFull },
              });
            }
          } else {
            if (sendFn.length === 1) {
              streamResult = await sendFn({
                model,
                messages: chatMessages,
                stream: true,
                onChunk: (chunk: string) => {
                  streamFull += chunk;
                  completionChars += chunk.length;
                  ensureHeaders();
                  reply.raw.write(formatGeminiDeltaChunk(chunk, model));
                },
                signal: abortController.signal,
              });
            } else {
              streamResult = await driver.sendMessage(
                model,
                chatMessages,
                (chunk: string) => {
                  streamFull += chunk;
                  completionChars += chunk.length;
                  ensureHeaders();
                  reply.raw.write(formatGeminiDeltaChunk(chunk, model));
                },
                abortController.signal,
                chatSessionKey(req, body, chatMessages)
              );
            }

            ensureHeaders();
            if (completionChars === 0 && streamResult && streamResult.length > 0) {
              completionChars = streamResult.length;
              streamFull += streamResult;
              reply.raw.write(formatGeminiDeltaChunk(streamResult, model));
            }

            const inTokens = Math.max(1, Math.ceil(pChars / 4));
            const outTokens = Math.max(1, Math.ceil(completionChars / 4));

            reply.raw.write(
              formatGeminiFinalChunk(
                model,
                {
                  promptTokenCount: inTokens,
                  candidatesTokenCount: outTokens,
                  totalTokenCount: inTokens + outTokens,
                },
                'STOP'
              )
            );
            reply.raw.end();
            opts.tracker?.recordRequestEnd({ id, ok: true, completionChars });
            brokerComplete({
              id,
              model,
              content: streamFull,
              // Native replay payload for this protocol (Task 12 decision):
              // SSE replays are rebuilt from {id, model, text} via the native
              // formatters — chunk slicing of the original stream is not kept.
              nativeReplay: { id, model, text: streamFull },
            });
          }
        } catch (err: unknown) {
          const error = err as { statusCode?: number; status?: string; message?: string };
          brokerFail(error.message || 'Stream processing failed');
          opts.tracker?.recordRequestEnd({ id, ok: false, completionChars, error: error.message });
          if (!headersSent) {
            return reply.status(error.statusCode || 500).send({
              error: {
                code: error.statusCode || 500,
                message: error.message || 'Stream processing failed',
                status: error.status || 'INTERNAL',
              },
            });
          }
          if (!reply.raw.destroyed && reply.raw.writable) {
            reply.raw.write(
              formatGeminiError(
                error.message || 'Stream processing failed',
                error.statusCode || 500,
                error.status || 'INTERNAL'
              )
            );
            reply.raw.end();
          }
        }
        return;
      }

      const sendFn = driver.sendMessage.bind(driver) as any;
      let fullResponse: string;

      // The send is INITIATED here: any later failure is unconfirmed.
      if (brokeredClaim?.kind === 'execute') markSentBrokered(brokeredClaim);
      if (sendFn.length === 1) {
        fullResponse = await sendFn({
          model,
          messages: chatMessages,
          stream: false,
          signal: abortController.signal,
        });
      } else {
        fullResponse = await driver.sendMessage(
          model,
          chatMessages,
          undefined,
          abortController.signal,
          chatSessionKey(req, body, chatMessages)
        );
      }

      const inTokens = Math.max(1, Math.ceil(pChars / 4));

      // Tool call detection (native Gemini functionCall bridge)
      if (toolRes.shouldParseTools) {
        const toolResult = parseToolCallsFromResponse(String(fullResponse || ''));
        const decision = decideToolOutcome(toolResult, toolRes);
        if (decision.emitToolCalls && decision.toolCalls) {
          completionChars = String(decision.cleanText || fullResponse || '').length;
          opts.tracker?.recordRequestEnd({ id, ok: true, completionChars });
          const outTokens = Math.max(1, Math.ceil(completionChars / 4));
          const usage = {
            promptTokenCount: inTokens,
            candidatesTokenCount: outTokens,
            totalTokenCount: inTokens + outTokens,
          };
          const native = formatGeminiFunctionCallResponse(
            decision.cleanText || undefined,
            decision.toolCalls as any,
            model,
            usage
          );
          brokerComplete({
            id,
            model,
            content: fullResponse,
            cleanText: decision.cleanText,
            toolCalls: decision.toolCalls,
            // Native replay payload: the EXACT object this protocol returned.
            nativeReplay: native,
          });
          return reply.status(200).send(native);
        }
        if (decision.protocolError) {
          opts.tracker?.recordRequestEnd({ id, ok: false, completionChars: 0, error: decision.protocolError });
          brokerFail(decision.protocolError);
          return reply.status(400).send({
            error: {
              code: 400,
              message: 'Model did not produce a required tool call. tool_choice was "required".',
              status: 'INVALID_ARGUMENT',
            },
          });
        }
      }

      completionChars = String(fullResponse || '').length;
      opts.tracker?.recordRequestEnd({ id, ok: true, completionChars });
      const outTokens = Math.max(1, Math.ceil(completionChars / 4));

      brokerComplete({
        id,
        model,
        content: fullResponse,
        // Native replay payload: the EXACT object this protocol returned.
        nativeReplay: formatGeminiResponse(
          fullResponse,
          model,
          {
            promptTokenCount: inTokens,
            candidatesTokenCount: outTokens,
            totalTokenCount: inTokens + outTokens,
          },
          'STOP'
        ),
      });

      return reply.status(200).send(
        formatGeminiResponse(
          fullResponse,
          model,
          {
            promptTokenCount: inTokens,
            candidatesTokenCount: outTokens,
            totalTokenCount: inTokens + outTokens,
          },
          'STOP'
        )
      );
    } catch (err: unknown) {
      const error = err as { statusCode?: number; status?: string; message?: string };
      brokerFail(error.message || 'Message processing failed');
      opts.tracker?.recordRequestEnd({ id, ok: false, completionChars, error: error.message });
      return reply.status(error.statusCode || 500).send({
        error: {
          code: error.statusCode || 500,
          message: error.message || 'Message processing failed',
          status: error.status || 'INTERNAL',
        },
      });
    } finally {
      req.raw.socket?.off('close', onSocketClose);
    }
  };

  app.post(
    '/v1beta/models/:modelAction',
    async (
      req: FastifyRequest<{ Params: { modelAction: string } }>,
      reply: FastifyReply
    ) => {
      return handleGenerateContent(req, reply, req.params.modelAction);
    }
  );

  app.post(
    '/v1beta/models/*',
    async (
      req: FastifyRequest<{ Params: { '*': string } }>,
      reply: FastifyReply
    ) => {
      return handleGenerateContent(req, reply, req.params['*']);
    }
  );

  app.post(
    '/v1beta/:modelAction',
    async (
      req: FastifyRequest<{ Params: { modelAction: string } }>,
      reply: FastifyReply
    ) => {
      return handleGenerateContent(req, reply, req.params.modelAction);
    }
  );
}
