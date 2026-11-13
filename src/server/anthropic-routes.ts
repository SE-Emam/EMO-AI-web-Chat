import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
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
  convertAnthropicMessages,
  convertAnthropicMessagesWithTools,
  normalizeAnthropicToolChoice,
  formatAnthropicMessageResponse,
  formatAnthropicToolUseResponse,
  formatAnthropicToolUseSSE,
  formatAnthropicMessageStart,
  formatAnthropicContentBlockStart,
  formatAnthropicContentBlockDelta,
  formatAnthropicContentBlockStop,
  formatAnthropicMessageDelta,
  formatAnthropicMessageStop,
  formatAnthropicError,
  type AnthropicMessagesRequest,
} from './anthropic-adapter.js';
import { injectToolsInstruction, parseToolCallsFromResponse, resolveToolChoice, decideToolOutcome, hydrateToolResultNames } from './tool-interpreter.js';

export interface AnthropicRoutesOptions {
  getDriver: () => ArenaDriver;
  tracker?: UsageTracker;
  requireApiKey?: boolean;
  apiKey?: string;
  getValidApiKeys?: () => string[];
  getScopedGroup?: (key: string) => { name: string } | undefined;
  /**
   * Task 12 — the ONE shared RequestBroker instance (same store + ProcessLock
   * as the OpenAI path). When present, opt-in idempotency via X-Request-Id
   * applies to /v1/messages; absent → behavior unchanged (no forced
   * idempotency).
   */
  broker?: RequestBroker;
}

function extractApiKey(req: FastifyRequest): string | undefined {
  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey.trim()) {
    return xApiKey.trim();
  }
  if (Array.isArray(xApiKey) && xApiKey[0]?.trim()) {
    return xApiKey[0].trim();
  }

  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
    if (auth.trim()) return auth.trim();
  }
  return undefined;
}

function getValidKeys(opts: AnthropicRoutesOptions): string[] {
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

function isAuthorized(req: FastifyRequest, opts: AnthropicRoutesOptions): boolean {
  if (opts.requireApiKey === false) return true;
  const shouldCheck =
    opts.requireApiKey === true ||
    (opts.requireApiKey === undefined && Boolean(opts.apiKey || opts.getValidApiKeys));
  if (!shouldCheck) return true;

  const provided = extractApiKey(req);
  if (!provided) return false;

  const validKeys = getValidKeys(opts);
  if (validKeys.length === 0) return false;
  return isValidApiKey(provided, validKeys);
}

function promptChars(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages) n += String(m.content || '').length;
  return n;
}

/**
 * Task 12 — serves a stored broker result as a NATIVE Anthropic response.
 * The stored `nativeReplay` (the exact object the first execution returned)
 * is replayed as-is for JSON; for SSE the native event sequence is rebuilt
 * from the stored text with the SAME formatters (message_start →
 * content_block_start/delta/stop → message_delta → message_stop). Chunking
 * of a replay is a single delta (timing/slicing of the original stream is
 * not preserved — documented). An OpenAI-shaped body can never be returned
 * here: the payload comes from this protocol's own complete() only.
 */
function serveAnthropicReplay(
  result: unknown,
  reply: FastifyReply,
  opts: { stream?: boolean },
  fallbackId: string,
  fallbackModel: string,
  pChars: number,
  tracker?: UsageTracker
): void {
  const stored = (result ?? {}) as {
    id?: string;
    model?: string;
    content?: string;
    nativeReplay?: { type?: string; id?: string; model?: string; text?: string; content?: Array<{ type: string; text?: string }> };
  };
  const rid = stored.nativeReplay?.id || stored.id || fallbackId;
  const rmodel = stored.model || fallbackModel;
  const text =
    (opts.stream ? stored.nativeReplay?.text : undefined) ??
    stored.nativeReplay?.content?.find((b) => b.type === 'text')?.text ??
    stored.content ??
    '';
  const inTokens = Math.max(1, Math.ceil(pChars / 4));
  const outTokens = Math.max(1, Math.ceil(String(text).length / 4));
  tracker?.recordRequestEnd({ id: rid, ok: true, completionChars: String(text).length });

  if (opts.stream) {
    reply.hijack();
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.setHeader('Access-Control-Allow-Headers', '*');
    reply.raw.setHeader('anthropic-version', '2023-06-01');
    reply.raw.setHeader('x-emo-replay', 'true');
    reply.raw.writeHead(200);
    // Replay of a STORED outcome — a single rebuilt delta, not a live run.
    reply.raw.write(formatAnthropicMessageStart(rid, rmodel, inTokens));
    reply.raw.write(formatAnthropicContentBlockStart(0, ''));
    reply.raw.write(formatAnthropicContentBlockDelta(0, String(text)));
    reply.raw.write(formatAnthropicContentBlockStop(0));
    reply.raw.write(formatAnthropicMessageDelta('end_turn', outTokens));
    reply.raw.write(formatAnthropicMessageStop());
    reply.raw.end();
    return;
  }

  let native = stored.nativeReplay;
  if (!native || typeof native !== 'object' || native.type !== 'message') {
    // Legacy/plain entries (no nativeReplay): rebuild from the stored text
    // with the native formatter — documented fallback, still Anthropic-format.
    native = formatAnthropicMessageResponse(rid, rmodel, String(stored.content ?? ''), inTokens, outTokens, 'end_turn');
  }
  reply.header('anthropic-version', '2023-06-01');
  reply.header('x-emo-replay', 'true');
  reply.send(native);
}

/**
 * Registers Anthropic /v1/messages protocol adapter routes on the Fastify instance.
 */
export function registerAnthropicRoutes(
  app: FastifyInstance,
  opts: AnthropicRoutesOptions
): void {
  app.options('/v1/messages', async (_req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    reply.header(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-Api-Key, x-api-key, anthropic-version, anthropic-beta'
    );
    return reply.status(204).send();
  });

  app.post('/v1/messages', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isAuthorized(req, opts)) {
      return reply.status(401).send({
        type: 'error',
        error: {
          type: 'authentication_error',
          message: 'Invalid or missing API key',
        },
      });
    }

    const body = req.body as Partial<AnthropicMessagesRequest> | undefined;
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      return reply.status(400).send({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'Invalid request: "messages" is required and must be a non-empty array',
        },
      });
    }

    let model = body.model && body.model.trim() ? body.model.trim() : 'claude-3-5-sonnet';
    const providedKey = extractApiKey(req);
    const scopedGroup = providedKey && opts.getScopedGroup ? opts.getScopedGroup(providedKey) : undefined;
    if (scopedGroup?.name) {
      if (model.toLowerCase() !== 'auto' && model.toLowerCase() !== scopedGroup.name.toLowerCase()) {
        return reply.status(403).send({
          type: 'error',
          error: {
            type: 'permission_error',
            message: `This API key is scoped to router group "${scopedGroup.name}". Use model "${scopedGroup.name}".`,
          },
        });
      }
      model = scopedGroup.name;
      (body as any).model = model;
    }
    const id = `msg_${randomUUID().replace(/-/g, '')}`;
    const abortController = new AbortController();
    const onSocketClose = () => {
      if (!reply.raw.writableEnded) abortController.abort();
    };
    req.raw.socket?.on('close', onSocketClose);
    req.raw.on('aborted', () => abortController.abort());

    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    const internalToolChoice = normalizeAnthropicToolChoice(body.tool_choice);
    const toolRes = hasTools ? resolveToolChoice(internalToolChoice, body.tools!.length) : { shouldInjectTools: false, shouldParseTools: false, requireToolCall: false } as const;
    // Convert messages — use tool-aware conversion when tools are present
    // to preserve tool_use/tool_result blocks as proper ChatMessage fields.
    let chatMessages = hasTools
      ? convertAnthropicMessagesWithTools(body.messages, body.system)
      : convertAnthropicMessages(body.messages, body.system);
    if (toolRes.shouldInjectTools) {
      // Convert Anthropic tool format to OpenAI format for injection
      const openaiTools = (body.tools as any[]).map((t: any) => ({
        type: 'function' as const,
        function: {
          name: t.name || t?.function?.name,
          description: t.description || t?.function?.description || '',
          parameters: t.input_schema || t.parameters || t?.function?.parameters || {},
        },
      }));
      chatMessages = hydrateToolResultNames(chatMessages);
      chatMessages = injectToolsInstruction(chatMessages, openaiTools, internalToolChoice);
    }
    const pChars = promptChars(chatMessages);
    const clientAgent = detectClientAgent(req, 'Claude Code');
    opts.tracker?.recordRequestStart({ id, model, stream: Boolean(body.stream), promptChars: pChars, clientAgent });
    let completionChars = 0;

    // ---- Task 12: unified claim-once broker (opt-in via X-Request-Id) ----
    // The fingerprint is computed over the EFFECTIVE body (after scoped-group
    // model coercion) so it covers every execution-affecting input. The claim
    // runs BEFORE any driver lookup: failures before the send still release
    // the claim (retryable), while anything after markSent() is unconfirmed.
    const requestIdHeader = String(req.headers['x-request-id'] || '').trim();
    const apiKeyScope = providedKey || 'anon';
    let brokeredClaim: BrokeredClaim | null = null;
    if (opts.broker && requestIdHeader) {
      const claim = await beginBrokeredRequest({
        protocol: 'anthropic',
        apiKeyScope,
        providerId: model,
        requestId: requestIdHeader,
        fingerprint: payloadFingerprint(body, 'anthropic'),
        broker: opts.broker,
        sessionKey: chatSessionKey(req, body, chatMessages),
      });
      if (claim.kind === 'conflict') {
        return reply.status(409).send({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: `idempotency_key_reused_with_different_request: request id "${requestIdHeader}" was already used with a different payload; refusing to replay a non-matching result.`,
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
          type: 'error',
          error: {
            type: 'request_already_claimed',
            message,
            state: claim.state,
            ...(claim.reason ? { reason: claim.reason } : {}),
          },
        });
      }
      if (claim.kind === 'replay') {
        serveAnthropicReplay(claim.result, reply, body, id, model, pChars, opts.tracker);
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

      if (body.stream) {
        let headersSent = false;
        let started = false;
        const inTokens = Math.max(1, Math.ceil(pChars / 4));

        const ensureHeaders = () => {
          if (!headersSent) {
            headersSent = true;
            reply.hijack();
            reply.raw.setHeader('Content-Type', 'text/event-stream');
            reply.raw.setHeader('Cache-Control', 'no-cache');
            reply.raw.setHeader('Connection', 'keep-alive');
            reply.raw.setHeader('Access-Control-Allow-Origin', '*');
            reply.raw.setHeader('Access-Control-Allow-Headers', '*');
            reply.raw.setHeader('anthropic-version', '2023-06-01');
            reply.raw.writeHead(200);
          }
        };

        const ensureStarted = () => {
          ensureHeaders();
          if (!started) {
            started = true;
            reply.raw.write(formatAnthropicMessageStart(id, model, inTokens));
            reply.raw.write(formatAnthropicContentBlockStart(0, ''));
          }
        };

        try {
          // The send is INITIATED here: any later failure is unconfirmed.
          if (brokeredClaim?.kind === 'execute') markSentBrokered(brokeredClaim);
          let streamFull = '';
          if (toolRes.shouldParseTools) {
            // Buffer when tools are present so tool_use blocks can be detected
            // and emitted as native Anthropic content blocks.
            await driver.sendMessage(
              model,
              chatMessages,
              (chunk: string) => { streamFull += chunk; },
              abortController.signal,
              chatSessionKey(req, body, chatMessages)
            );
            completionChars = String(streamFull || '').length;
            const toolResult = parseToolCallsFromResponse(streamFull);
            const decision = decideToolOutcome(toolResult, toolRes);
            ensureHeaders();
            if (decision.emitToolCalls && decision.toolCalls) {
              const outTokens = Math.max(1, Math.ceil(completionChars / 4));
              reply.raw.write(formatAnthropicMessageStart(id, model, inTokens));
              let blockIdx = 0;
              if (decision.cleanText) {
                reply.raw.write(formatAnthropicContentBlockStart(blockIdx, ''));
                reply.raw.write(formatAnthropicContentBlockDelta(blockIdx, decision.cleanText));
                reply.raw.write(formatAnthropicContentBlockStop(blockIdx));
                blockIdx++;
              }
              reply.raw.write(formatAnthropicToolUseSSE(decision.toolCalls as any, blockIdx));
              reply.raw.write(formatAnthropicMessageDelta('tool_use', outTokens));
              reply.raw.write(formatAnthropicMessageStop());
              reply.raw.end();
              opts.tracker?.recordRequestEnd({ id, ok: true, completionChars });
              brokerComplete({
                id,
                model,
                content: streamFull,
                cleanText: decision.cleanText,
                toolCalls: decision.toolCalls,
                nativeReplay: formatAnthropicToolUseResponse(
                  id, model, decision.cleanText || undefined,
                  decision.toolCalls as any, inTokens, outTokens
                ),
              });
            } else if (decision.protocolError) {
              // tool contract violated (required / specific tool missing).
              reply.raw.write(
                formatAnthropicError(
                  `Model did not produce a required tool call. tool_choice was "required".`,
                  'invalid_request_error'
                )
              );
              reply.raw.end();
              brokerFail(decision.protocolError);
            } else {
              const outTokens = Math.max(1, Math.ceil(completionChars / 4));
              reply.raw.write(formatAnthropicMessageStart(id, model, inTokens));
              reply.raw.write(formatAnthropicContentBlockStart(0, ''));
              reply.raw.write(formatAnthropicContentBlockDelta(0, String(streamFull)));
              reply.raw.write(formatAnthropicContentBlockStop(0));
              reply.raw.write(formatAnthropicMessageDelta('end_turn', outTokens));
              reply.raw.write(formatAnthropicMessageStop());
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
            await driver.sendMessage(
              model,
              chatMessages,
              (chunk: string) => {
                streamFull += chunk;
                completionChars += chunk.length;
                ensureStarted();
                reply.raw.write(formatAnthropicContentBlockDelta(0, chunk));
              },
              abortController.signal,
              chatSessionKey(req, body, chatMessages)
            );

            ensureStarted();
            const outTokens = Math.max(1, Math.ceil(completionChars / 4));
            reply.raw.write(formatAnthropicContentBlockStop(0));
            reply.raw.write(formatAnthropicMessageDelta('end_turn', outTokens));
            reply.raw.write(formatAnthropicMessageStop());
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
          const error = err as { statusCode?: number; type?: string; message?: string };
          brokerFail(error.message || 'Stream processing failed');
          opts.tracker?.recordRequestEnd({ id, ok: false, completionChars, error: error.message });
          if (!headersSent) {
            return reply.status(error.statusCode || 500).send({
              type: 'error',
              error: {
                type: error.type || 'api_error',
                message: error.message || 'Stream processing failed',
              },
            });
          }
          if (!reply.raw.destroyed && reply.raw.writable) {
            reply.raw.write(
              formatAnthropicError(
                error.message || 'Stream processing failed',
                error.type || 'api_error'
              )
            );
            reply.raw.end();
          }
        }
        return;
      }

      if (brokeredClaim?.kind === 'execute') markSentBrokered(brokeredClaim);
      const fullResponse = await driver.sendMessage(
        model,
        chatMessages,
        undefined,
        abortController.signal,
        chatSessionKey(req, body, chatMessages)
      );

      const inTokens = Math.max(1, Math.ceil(pChars / 4));

      // Tool call detection (native Anthropic tool_use bridge)
      if (toolRes.shouldParseTools) {
        const toolResult = parseToolCallsFromResponse(String(fullResponse || ''));
        const decision = decideToolOutcome(toolResult, toolRes);
        if (decision.emitToolCalls && decision.toolCalls) {
          completionChars = String(decision.cleanText || fullResponse || '').length;
          opts.tracker?.recordRequestEnd({ id, ok: true, completionChars });
          const outTokens = Math.max(1, Math.ceil(completionChars / 4));
          const native = formatAnthropicToolUseResponse(
            id, model, decision.cleanText || undefined,
            decision.toolCalls as any, inTokens, outTokens
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
          reply.header('anthropic-version', '2023-06-01');
          return reply.status(200).send(native);
        }
        if (decision.protocolError) {
          opts.tracker?.recordRequestEnd({ id, ok: false, completionChars: 0, error: decision.protocolError });
          brokerFail(decision.protocolError);
          return reply.status(400).send({
            type: 'error',
            error: {
              type: 'invalid_request_error',
              message: 'Model did not produce a required tool call. tool_choice was "required".',
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
        nativeReplay: formatAnthropicMessageResponse(id, model, fullResponse, inTokens, outTokens),
      });

      reply.header('anthropic-version', '2023-06-01');
      return reply.status(200).send(
        formatAnthropicMessageResponse(id, model, fullResponse, inTokens, outTokens)
      );
    } catch (err: unknown) {
      const error = err as { statusCode?: number; type?: string; message?: string };
      brokerFail(error.message || 'Message processing failed');
      opts.tracker?.recordRequestEnd({ id, ok: false, completionChars, error: error.message });
      return reply.status(error.statusCode || 500).send({
        type: 'error',
        error: {
          type: error.type || 'api_error',
          message: error.message || 'Message processing failed',
        },
      });
    } finally {
      req.raw.socket?.off('close', onSocketClose);
    }
  });

  app.post('/v1/messages/count_tokens', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isAuthorized(req, opts)) {
      return reply.status(401).send({
        type: 'error',
        error: {
          type: 'authentication_error',
          message: 'Invalid or missing API key',
        },
      });
    }

    const body = req.body as Partial<AnthropicMessagesRequest> | undefined;
    if (!body || !Array.isArray(body.messages)) {
      return reply.status(400).send({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'Invalid request: "messages" is required and must be an array',
        },
      });
    }

    const chatMessages = convertAnthropicMessages(body.messages, body.system);
    const pChars = promptChars(chatMessages);
    return reply.send({ input_tokens: Math.max(1, Math.ceil(pChars / 4)) });
  });
}
