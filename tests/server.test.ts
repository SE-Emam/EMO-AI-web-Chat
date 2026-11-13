import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServer } from '../src/server/app.js';
import type { ArenaDriver, Config, ChatMessage } from '../src/types.js';
import { DEFAULT_CONFIG } from '../src/config.js';

describe('Fastify Server (createServer)', () => {
  let mockDriver: ArenaDriver;
  const config: Config = { ...DEFAULT_CONFIG };

  beforeEach(() => {
    mockDriver = {
      listModels: vi.fn().mockResolvedValue(['gpt-4o', 'claude-3-5-sonnet', 'gemini-1.5-pro']),
      sendMessage: vi.fn().mockImplementation(
        async (
          _model: string,
          _messages: ChatMessage[],
          onChunk?: (chunk: string) => void
        ) => {
          if (onChunk) {
            onChunk('Hello');
            onChunk(' world!');
          }
          return 'Hello world!';
        }
      ),
    };
  });

  describe('Health endpoints', () => {
    it('GET / returns 200 with service info', async () => {
      const app = createServer(mockDriver, config);
      const res = await app.inject({ method: 'GET', url: '/' });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        status: 'ok',
        service: 'emo-ai-web',
      });
    });

    it('GET /health returns 200 with service info', async () => {
      const app = createServer(mockDriver, config);
      const res = await app.inject({ method: 'GET', url: '/health' });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      // Task 14: /health expanded with LOCAL resilience state — the fixed
      // identity fields are asserted and the new sections must exist.
      expect(data.status).toBe('ok');
      expect(data.service).toBe('emo-ai-web');
      expect(data.gateway.alive).toBe(true);
      expect(data.providers).toEqual(expect.any(Array));
      expect(data.broker).toEqual(expect.any(Object));
      expect(data.requests).toEqual(expect.any(Object));
    });
  });

  describe('GET /v1/models', () => {
    it('returns list of models from driver in OpenAI format', async () => {
      const app = createServer(mockDriver, config);
      const res = await app.inject({ method: 'GET', url: '/v1/models' });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.object).toBe('list');
      const driverModels = data.data.filter((m: any) => !m.id.startsWith('swarm:'));
      expect(driverModels).toHaveLength(3);
      expect(driverModels[0].id).toBe('gpt-4o');
      expect(driverModels[0].object).toBe('model');
      expect(driverModels[1].id).toBe('claude-3-5-sonnet');
      expect(mockDriver.listModels).toHaveBeenCalledOnce();
    });

    it('handles driver error in /v1/models', async () => {
      mockDriver.listModels = vi.fn().mockRejectedValue(new Error('Driver failure'));
      const app = createServer(mockDriver, config);
      const res = await app.inject({ method: 'GET', url: '/v1/models' });

      expect(res.statusCode).toBe(500);
      const data = JSON.parse(res.body);
      expect(data.error).toBeDefined();
      expect(data.error.message).toBe('Driver failure');
      expect(data.error.type).toBe('server_error');
    });
  });

  describe('POST /v1/chat/completions (Validation)', () => {
    it('returns 400 when body has no messages', async () => {
      const app = createServer(mockDriver, config);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.body);
      expect(data.error).toBeDefined();
      expect(data.error.message).toMatch(/messages/i);
    });

    it('returns 400 when messages is empty array', async () => {
      const app = createServer(mockDriver, config);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { messages: [] },
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.body);
      expect(data.error).toBeDefined();
      expect(data.error.message).toMatch(/messages/i);
    });
  });

  describe('POST /v1/chat/completions (Non-streaming)', () => {
    it('handles non-streaming request with specified model', async () => {
      const app = createServer(mockDriver, config);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Say hello' }],
          stream: false,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.object).toBe('chat.completion');
      expect(data.model).toBe('gpt-4o');
      expect(data.choices).toHaveLength(1);
      expect(data.choices[0].message.role).toBe('assistant');
      expect(data.choices[0].message.content).toBe('Hello world!');
      expect(data.choices[0].finish_reason).toBe('stop');

      expect(mockDriver.sendMessage).toHaveBeenCalledWith(
        'gpt-4o',
        [{ role: 'user', content: 'Say hello' }],
        undefined,
        expect.any(AbortSignal),
        expect.any(String)
      );
    });

    it('defaults model to auto if omitted or empty', async () => {
      const app = createServer(mockDriver, config);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          messages: [{ role: 'user', content: 'Hi' }],
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.model).toBe('auto');
      expect(mockDriver.sendMessage).toHaveBeenCalledWith(
        'auto',
        [{ role: 'user', content: 'Hi' }],
        undefined,
        expect.any(AbortSignal),
        expect.any(String)
      );
    });

    it('returns 500 when driver throws in non-streaming', async () => {
      mockDriver.sendMessage = vi.fn().mockRejectedValue(new Error('Model timeout'));
      const app = createServer(mockDriver, config);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hi' }],
        },
      });

      expect(res.statusCode).toBe(500);
      const data = JSON.parse(res.body);
      expect(data.error.message).toBe('Model timeout');
      expect(data.error.type).toBe('server_error');
    });
  });

  describe('POST /v1/chat/completions (Streaming)', () => {
    it('returns SSE stream with chunks and [DONE]', async () => {
      const app = createServer(mockDriver, config);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Stream test' }],
          stream: true,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['connection']).toBe('keep-alive');

      const lines = res.body.split('\n\n').filter((l) => l.trim().length > 0);
      // We expect:
      // chunk 1: Hello
      // chunk 2: world!
      // chunk 3: finish_reason: stop
      // chunk 4: data: [DONE]
      expect(lines.length).toBeGreaterThanOrEqual(4);

      const chunk1 = JSON.parse(lines[0].replace(/^data: /, ''));
      expect(chunk1.object).toBe('chat.completion.chunk');
      expect(chunk1.choices[0].delta.content).toBe('Hello');

      const chunk2 = JSON.parse(lines[1].replace(/^data: /, ''));
      expect(chunk2.choices[0].delta.content).toBe(' world!');

      const chunk3 = JSON.parse(lines[2].replace(/^data: /, ''));
      expect(chunk3.choices[0].finish_reason).toBe('stop');

      expect(lines[3]).toBe('data: [DONE]');
    });

    it('returns 500 if driver rejects before stream chunks', async () => {
      mockDriver.sendMessage = vi.fn().mockRejectedValue(new Error('Stream initialization failed'));
      const app = createServer(mockDriver, config);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Stream fail test' }],
          stream: true,
        },
      });

      expect(res.statusCode).toBe(500);
      const data = JSON.parse(res.body);
      expect(data.error.message).toBe('Stream initialization failed');
    });

    it('writes error payload and closes stream if driver fails mid-stream', async () => {
      mockDriver.sendMessage = vi.fn().mockImplementation(
        async (_model, _messages, onChunk) => {
          onChunk?.('Initial chunk');
          throw new Error('Mid-stream disconnect');
        }
      );
      const app = createServer(mockDriver, config);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Mid-stream fail test' }],
          stream: true,
        },
      });

      expect(res.statusCode).toBe(200); // Headers already sent
      expect(res.body).toContain('Initial chunk');
      expect(res.body).toContain('Mid-stream disconnect');
    });
  });

  describe('CORS and Error propagation', () => {
    it('handles OPTIONS preflight with CORS headers', async () => {
      const app = createServer(mockDriver, config);
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/v1/chat/completions',
      });

      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-methods']).toContain('POST');
    });

    it('propagates custom error statusCode if present on thrown error', async () => {
      const customErr = new Error('Model not found');
      (customErr as any).statusCode = 404;
      mockDriver.sendMessage = vi.fn().mockRejectedValue(customErr);

      const app = createServer(mockDriver, config);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'unknown-model',
          messages: [{ role: 'user', content: 'Test' }],
        },
      });

      expect(res.statusCode).toBe(404);
      const data = JSON.parse(res.body);
      expect(data.error.message).toBe('Model not found');
    });
  });

  describe('Request cancellation', () => {
    it('passes abort signal to driver sendMessage', async () => {
      let receivedSignal: AbortSignal | undefined;
      mockDriver.sendMessage = vi.fn().mockImplementation(
        async (
          _model: string,
          _messages: ChatMessage[],
          _onChunk?: (chunk: string) => void,
          signal?: AbortSignal
        ) => {
          receivedSignal = signal;
          return 'ok';
        }
      );

      const app = createServer(mockDriver, config);
      await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Cancellation test' }],
        },
      });

      expect(receivedSignal).toBeDefined();
      expect(receivedSignal instanceof AbortSignal).toBe(true);
      expect(receivedSignal?.aborted).toBe(false);
    });
  });
});
