import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ArenaDriver, ChatCompletionRequest, Config } from '../types.js';
import { loadConfig } from '../config.js';
import {
  formatChatCompletionChunk,
  formatChatCompletionResponse,
  formatDoneChunk,
  formatModelList,
} from './openai-formatter.js';

/**
 * Creates and configures the Fastify server instance with OpenAI-compatible routes.
 *
 * @param driver An implementation of ArenaDriver to process model operations and prompts.
 * @param config Optional configuration settings (falls back to loaded config).
 * @returns Configured FastifyInstance.
 */
export function createServer(driver: ArenaDriver, config?: Partial<Config>): FastifyInstance {
  loadConfig(config);

  const app = Fastify({
    logger: false,
  });

  // Enable permissive CORS for local agent and browser consumption
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') {
      return reply.status(204).send();
    }
  });

  // Health check routes
  const healthHandler = async () => ({
    status: 'ok',
    service: 'arena-web-api',
  });

  app.get('/', healthHandler);
  app.get('/health', healthHandler);

  // Models route: GET /v1/models
  app.get('/v1/models', async (_request, reply) => {
    try {
      const models = await driver.listModels();
      return reply.send(formatModelList(models));
    } catch (err: unknown) {
      const error = err as { statusCode?: number; type?: string; message?: string };
      const statusCode = error.statusCode || 500;
      return reply.status(statusCode).send({
        error: {
          message: error.message || 'Failed to list models',
          type: error.type || 'server_error',
        },
      });
    }
  });

  // Chat completions route: POST /v1/chat/completions
  app.post('/v1/chat/completions', async (request, reply) => {
    const body = request.body as Partial<ChatCompletionRequest> | undefined;

    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      return reply.status(400).send({
        error: {
          message: 'Invalid request: "messages" is required and must be a non-empty array',
          type: 'invalid_request_error',
        },
      });
    }

    const model = body.model && body.model.trim() ? body.model.trim() : 'auto';
    const id = `chatcmpl-${randomUUID()}`;

    // Manage request lifecycle and cancellation
    const abortController = new AbortController();
    const onClose = () => {
      if (!reply.raw.writableEnded) {
        abortController.abort();
      }
    };
    request.raw.on('close', onClose);
    if (request.signal) {
      request.signal.addEventListener('abort', () => abortController.abort());
    }

    if (body.stream) {
      let headersSent = false;
      const ensureHeaders = () => {
        if (!headersSent) {
          headersSent = true;
          reply.hijack();
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
        }
      };

      try {
        await driver.sendMessage(
          model,
          body.messages,
          (chunk: string) => {
            ensureHeaders();
            reply.raw.write(formatChatCompletionChunk(id, model, chunk));
          },
          abortController.signal
        );

        ensureHeaders();
        reply.raw.write(formatChatCompletionChunk(id, model, '', 'stop'));
        reply.raw.write(formatDoneChunk());
        reply.raw.end();
      } catch (err: unknown) {
        const error = err as { statusCode?: number; type?: string; message?: string };
        if (!headersSent) {
          const statusCode = error.statusCode || 500;
          return reply.status(statusCode).send({
            error: {
              message: error.message || 'Stream processing failed',
              type: error.type || 'server_error',
            },
          });
        } else {
          reply.raw.write(
            `data: ${JSON.stringify({
              error: {
                message: error.message || 'Stream processing failed',
                type: error.type || 'server_error',
              },
            })}\n\n`
          );
          reply.raw.end();
        }
      } finally {
        request.raw.off('close', onClose);
      }
      return;
    }

    // Non-streaming completion
    try {
      const fullResponse = await driver.sendMessage(
        model,
        body.messages,
        undefined,
        abortController.signal
      );
      return reply.send(formatChatCompletionResponse(id, model, fullResponse));
    } catch (err: unknown) {
      const error = err as { statusCode?: number; type?: string; message?: string };
      const statusCode = error.statusCode || 500;
      return reply.status(statusCode).send({
        error: {
          message: error.message || 'Chat completion failed',
          type: error.type || 'server_error',
        },
      });
    } finally {
      request.raw.off('close', onClose);
    }
  });

  return app;
}
