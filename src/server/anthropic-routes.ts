import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { isValidApiKey } from '../gateway/security.js';
import type { ArenaDriver, ChatMessage } from '../types.js';
import type { UsageTracker } from '../gateway/usage-tracker.js';
import { detectClientAgent } from './app.js';
import { chatSessionKey } from './chat-session-key.js';
import {
  convertAnthropicMessages,
  formatAnthropicMessageResponse,
  formatAnthropicMessageStart,
  formatAnthropicContentBlockStart,
  formatAnthropicContentBlockDelta,
  formatAnthropicContentBlockStop,
  formatAnthropicMessageDelta,
  formatAnthropicMessageStop,
  formatAnthropicError,
  type AnthropicMessagesRequest,
} from './anthropic-adapter.js';

export interface AnthropicRoutesOptions {
  getDriver: () => ArenaDriver;
  tracker?: UsageTracker;
  requireApiKey?: boolean;
  apiKey?: string;
  getValidApiKeys?: () => string[];
  getScopedGroup?: (key: string) => { name: string } | undefined;
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

    const chatMessages = convertAnthropicMessages(body.messages, body.system);
    const pChars = promptChars(chatMessages);
    const clientAgent = detectClientAgent(req, 'Claude Code');
    opts.tracker?.recordRequestStart({ id, model, stream: Boolean(body.stream), promptChars: pChars, clientAgent });
    let completionChars = 0;

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
          await driver.sendMessage(
            model,
            chatMessages,
            (chunk: string) => {
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
        } catch (err: unknown) {
          const error = err as { statusCode?: number; type?: string; message?: string };
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

      const fullResponse = await driver.sendMessage(
        model,
        chatMessages,
        undefined,
        abortController.signal,
        chatSessionKey(req, body, chatMessages)
      );
      completionChars = String(fullResponse || '').length;
      opts.tracker?.recordRequestEnd({ id, ok: true, completionChars });

      const inTokens = Math.max(1, Math.ceil(pChars / 4));
      const outTokens = Math.max(1, Math.ceil(completionChars / 4));

      reply.header('anthropic-version', '2023-06-01');
      return reply.status(200).send(
        formatAnthropicMessageResponse(id, model, fullResponse, inTokens, outTokens)
      );
    } catch (err: unknown) {
      const error = err as { statusCode?: number; type?: string; message?: string };
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
