import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { isValidApiKey } from '../gateway/security.js';
import type { ArenaDriver, ChatMessage } from '../types.js';
import type { UsageTracker } from '../gateway/usage-tracker.js';
import { detectClientAgent } from './app.js';
import { chatSessionKey } from './chat-session-key.js';
import {
  convertGeminiContents,
  formatGeminiResponse,
  formatGeminiDeltaChunk,
  formatGeminiFinalChunk,
  formatGeminiError,
  formatGeminiModelList,
  type GeminiGenerateContentRequest,
} from './gemini-adapter.js';

export interface GeminiRoutesOptions {
  getDriver: () => ArenaDriver;
  tracker?: UsageTracker;
  requireApiKey?: boolean;
  apiKey?: string;
  getValidApiKeys?: () => string[];
  getScopedGroup?: (key: string) => { name: string } | undefined;
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

    const chatMessages = convertGeminiContents(body.contents, body.systemInstruction);
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
          const sendFn = driver.sendMessage.bind(driver) as any;
          let streamResult: string | undefined;

          if (sendFn.length === 1) {
            streamResult = await sendFn({
              model,
              messages: chatMessages,
              stream: true,
              onChunk: (chunk: string) => {
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
        } catch (err: unknown) {
          const error = err as { statusCode?: number; status?: string; message?: string };
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

      completionChars = String(fullResponse || '').length;
      opts.tracker?.recordRequestEnd({ id, ok: true, completionChars });

      const inTokens = Math.max(1, Math.ceil(pChars / 4));
      const outTokens = Math.max(1, Math.ceil(completionChars / 4));

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
