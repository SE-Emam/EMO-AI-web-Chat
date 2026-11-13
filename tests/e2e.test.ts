import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/server/app.js';
import type { ArenaDriver, ChatMessage } from '../src/types.js';
import { KNOWN_ARENA_MODELS, resolveModelAlias } from '../src/arena/models.js';

const execFileAsync = promisify(execFile);

describe('End-to-End HTTP Integration & Gateway Compatibility', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  // Custom mock driver that records invocations and supports customizable responses
  let mockDriver: ArenaDriver;
  let sendMessageHandler: (
    model: string,
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal
  ) => Promise<string>;

  beforeAll(async () => {
    sendMessageHandler = async (
      model: string,
      messages: ChatMessage[],
      onChunk?: (chunk: string) => void
    ) => {
      const resolved = resolveModelAlias(model);
      const lastMsg = messages[messages.length - 1]?.content || '';

      if (onChunk) {
        // Stream simulated tokens
        const tokens = ['The', ' answer', ' to', ' "', lastMsg, '"', ' is', ' 42.'];
        for (const token of tokens) {
          onChunk(token);
        }
      }
      return `The answer to "${lastMsg}" is 42.`;
    };

    mockDriver = {
      listModels: async () => [...KNOWN_ARENA_MODELS],
      sendMessage: async (model, messages, onChunk, signal) =>
        sendMessageHandler(model, messages, onChunk, signal),
    };

    // Spin up Fastify on an ephemeral port (port: 0)
    app = createServer(mockDriver);
    await app.listen({ port: 0, host: '127.0.0.1' });

    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 8989;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Health & Status Endpoints', () => {
    it('GET / returns 200 with service name', async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');

      const data = await res.json();
      expect(data).toEqual({
        status: 'ok',
        service: 'emo-ai-web',
      });
    });

    it('GET /health returns 200 with service status', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');

      const data = await res.json();
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

  describe('2. CORS Headers & Preflight', () => {
    it('OPTIONS /v1/chat/completions handles CORS preflight with 204', async () => {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
      expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
    });

    it('OPTIONS /v1/models handles CORS preflight with 204', async () => {
      const res = await fetch(`${baseUrl}/v1/models`, {
        method: 'OPTIONS',
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });
  });

  describe('3. Models List (GET /v1/models)', () => {
    it('returns models compliant with OpenAI schema', async () => {
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: {
          Authorization: 'Bearer sk-gateway-token-12345',
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('access-control-allow-origin')).toBe('*');

      const body = await res.json();
      expect(body.object).toBe('list');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(19);

      // Verify each model item schema
      for (const model of body.data) {
        expect(typeof model.id).toBe('string');
        expect(model.id.length).toBeGreaterThan(0);
        expect(model.object).toBe('model');
        expect(typeof model.created).toBe('number');
        expect(model.owned_by).toBe('arena');
      }

      // Verify presence of canonical models
      const ids = body.data.map((m: { id: string }) => m.id);
      expect(ids).toContain('claude-3-7-sonnet');
      expect(ids).toContain('claude-3-5-sonnet');
      expect(ids).toContain('deepseek-r1');
      expect(ids).toContain('gpt-4o');
      expect(ids).toContain('gemini-2.0-flash');
      expect(ids).toContain('qwen-2.5-max');
    });

    it('returns 500 with OpenAI error format if driver fails', async () => {
      const failingDriver: ArenaDriver = {
        listModels: async () => {
          throw new Error('Database connection failed');
        },
        sendMessage: async () => '',
      };

      const failingApp = createServer(failingDriver);
      await failingApp.listen({ port: 0, host: '127.0.0.1' });
      const failPort = (failingApp.server.address() as { port: number }).port;

      const res = await fetch(`http://127.0.0.1:${failPort}/v1/models`);
      expect(res.status).toBe(500);

      const data = await res.json();
      expect(data).toHaveProperty('error');
      expect(data.error.message).toBe('Database connection failed');
      expect(data.error.type).toBe('server_error');

      await failingApp.close();
    });
  });

  describe('4. Non-Streaming Chat Completion (POST /v1/chat/completions)', () => {
    it('returns 200 with full OpenAI Chat Completion JSON response', async () => {
      const payload = {
        model: 'claude-3-7-sonnet',
        messages: [
          { role: 'system', content: 'You are a test assistant.' },
          { role: 'user', content: 'What is 2+2?' },
        ],
        stream: false,
        temperature: 0.7,
      };

      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-gateway-key-xyz',
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('access-control-allow-origin')).toBe('*');

      const data = await res.json();

      // Check standard OpenAI chat completion response schema
      expect(data.id).toMatch(/^chatcmpl-[a-f0-9-]+$/);
      expect(data.object).toBe('chat.completion');
      expect(typeof data.created).toBe('number');
      expect(data.created).toBeGreaterThan(0);
      expect(data.model).toBe('claude-3-7-sonnet');

      expect(Array.isArray(data.choices)).toBe(true);
      expect(data.choices).toHaveLength(1);
      expect(data.choices[0].index).toBe(0);
      expect(data.choices[0].finish_reason).toBe('stop');
      expect(data.choices[0].message).toEqual({
        role: 'assistant',
        content: 'The answer to "What is 2+2?" is 42.',
      });

      expect(data.usage).toBeDefined();
      expect(typeof data.usage.prompt_tokens).toBe('number');
      expect(typeof data.usage.completion_tokens).toBe('number');
      expect(typeof data.usage.total_tokens).toBe('number');
    });

    it('defaults to non-streaming when stream field is omitted', async () => {
      const payload = {
        model: 'deepseek-r1',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.object).toBe('chat.completion');
      expect(data.choices[0].message.role).toBe('assistant');
    });

    it('handles model aliases properly in chat request', async () => {
      const payload = {
        model: 'claude-3.5-sonnet',
        messages: [{ role: 'user', content: 'Alias test' }],
      };

      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.model).toBe('claude-3.5-sonnet');
      expect(data.choices[0].message.content).toContain('Alias test');
    });
  });

  describe('5. Streaming Chat Completion SSE (POST /v1/chat/completions stream: true)', () => {
    it('returns SSE event stream with valid chunks terminating in [DONE]', async () => {
      const payload = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Stream test' }],
        stream: true,
      };

      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-gateway-token',
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(res.headers.get('connection')).toBe('keep-alive');
      expect(res.headers.get('access-control-allow-origin')).toBe('*');

      expect(res.body).toBeDefined();

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let rawBuffer = '';
      const sseChunks: any[] = [];
      let doneReceived = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        rawBuffer += decoder.decode(value, { stream: true });

        // Split by SSE message boundary
        const lines = rawBuffer.split('\n\n');
        rawBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const dataContent = trimmed.slice(6);
          if (dataContent === '[DONE]') {
            doneReceived = true;
          } else {
            sseChunks.push(JSON.parse(dataContent));
          }
        }
      }

      if (rawBuffer.trim().startsWith('data: ')) {
        const dataContent = rawBuffer.trim().slice(6);
        if (dataContent === '[DONE]') {
          doneReceived = true;
        } else {
          sseChunks.push(JSON.parse(dataContent));
        }
      }

      expect(doneReceived).toBe(true);
      expect(sseChunks.length).toBeGreaterThan(0);

      // Verify chunk structure
      let aggregatedText = '';
      let finishReasonObserved = false;

      for (const chunk of sseChunks) {
        expect(chunk.id).toMatch(/^chatcmpl-[a-f0-9-]+$/);
        expect(chunk.object).toBe('chat.completion.chunk');
        expect(typeof chunk.created).toBe('number');
        expect(chunk.model).toBe('gpt-4o');
        expect(Array.isArray(chunk.choices)).toBe(true);
        expect(chunk.choices).toHaveLength(1);
        expect(chunk.choices[0].index).toBe(0);

        if (chunk.choices[0].delta?.content) {
          aggregatedText += chunk.choices[0].delta.content;
        }

        if (chunk.choices[0].finish_reason === 'stop') {
          finishReasonObserved = true;
        }
      }

      expect(aggregatedText).toBe('The answer to "Stream test" is 42.');
      expect(finishReasonObserved).toBe(true);
    });
  });

  describe('6. Error Handling & Validation', () => {
    it('returns 400 when body is missing or empty', async () => {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data).toHaveProperty('error');
      expect(data.error.type).toBe('invalid_request_error');
      expect(data.error.message).toContain('messages');
    });

    it('returns 400 when messages is empty array', async () => {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [] }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.type).toBe('invalid_request_error');
    });

    it('returns 400 when messages is not an array', async () => {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: 'not an array' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.type).toBe('invalid_request_error');
    });

    it('returns 500 when driver fails in non-streaming mode', async () => {
      const savedHandler = sendMessageHandler;
      sendMessageHandler = async () => {
        throw new Error('Arena rate limited or session expired');
      };

      try {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'test' }],
          }),
        });

        expect(res.status).toBe(500);
        const data = await res.json();
        expect(data.error).toBeDefined();
        expect(data.error.message).toBe('Arena rate limited or session expired');
        expect(data.error.type).toBe('server_error');
      } finally {
        sendMessageHandler = savedHandler;
      }
    });

    it('returns 500 when driver fails in streaming mode before headers are sent', async () => {
      const savedHandler = sendMessageHandler;
      sendMessageHandler = async () => {
        throw new Error('Immediate stream failure');
      };

      try {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'test' }],
            stream: true,
          }),
        });

        expect(res.status).toBe(500);
        const data = await res.json();
        expect(data.error.message).toBe('Immediate stream failure');
        expect(data.error.type).toBe('server_error');
      } finally {
        sendMessageHandler = savedHandler;
      }
    });

    it('emits error chunk when driver fails after stream has begun', async () => {
      const savedHandler = sendMessageHandler;
      sendMessageHandler = async (_model, _messages, onChunk) => {
        if (onChunk) {
          onChunk('Starting...');
        }
        throw new Error('Mid-stream disconnection');
      };

      try {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'test' }],
            stream: true,
          }),
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/event-stream');

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let bodyText = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bodyText += decoder.decode(value);
        }

        expect(bodyText).toContain('Starting...');
        expect(bodyText).toContain('Mid-stream disconnection');
      } finally {
        sendMessageHandler = savedHandler;
      }
    });
  });

  describe('7. Client Abort / Cancellation Handling', () => {
    it('aborts driver execution when client cancels HTTP request mid-stream', async () => {
      let abortedSignalObserved = false;
      const savedHandler = sendMessageHandler;

      sendMessageHandler = async (_model, _messages, onChunk, signal) => {
        if (onChunk) {
          onChunk('Initial chunk');
        }

        return new Promise<string>((resolve, reject) => {
          signal?.addEventListener('abort', () => {
            abortedSignalObserved = true;
            reject(new Error('Request aborted by client'));
          });

          // Simulate long wait
          setTimeout(() => resolve('Completed late'), 2000);
        });
      };

      try {
        const controller = new AbortController();
        const fetchPromise = fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'slow request' }],
            stream: true,
          }),
          signal: controller.signal,
        });

        const res = await fetchPromise;
        expect(res.status).toBe(200);
        const reader = res.body!.getReader();

        // Abort mid-stream reading
        controller.abort();

        await expect(reader.read()).rejects.toThrow();
        // Give Fastify time to process socket close
        await new Promise((r) => setTimeout(r, 100));

        expect(abortedSignalObserved).toBe(true);
      } finally {
        sendMessageHandler = savedHandler;
      }
    });
  });

  describe('8. Gateway Payload Compatibility', () => {
    it('accepts typical Emo-AI-Gateway / New API payload with extra metadata', async () => {
      const gatewayPayload = {
        model: 'openai/gpt-4o',
        messages: [
          { role: 'system', content: 'You are a test assistant.' },
          { role: 'user', content: 'Hello gateway' },
        ],
        stream: false,
        temperature: 0.8,
        top_p: 0.95,
        max_tokens: 2048,
        presence_penalty: 0,
        frequency_penalty: 0,
        user: 'emo-user-42',
        stream_options: {
          include_usage: true,
        },
      };

      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-gateway-token-custom',
          'X-Request-Id': 'gateway-req-12345',
        },
        body: JSON.stringify(gatewayPayload),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.object).toBe('chat.completion');
      expect(data.choices[0].message.role).toBe('assistant');
      expect(data.choices[0].message.content).toContain('Hello gateway');
    });
  });

  describe('9. Runner Scripts & CLI Binary Execution', () => {
    it('executes ./scripts/login-arena-web.sh --help successfully', async () => {
      const { stdout } = await execFileAsync('./scripts/login-arena-web.sh', ['--help']);
      expect(stdout).toContain('webbridge login');
      expect(stdout).toContain('--user-data-dir');
    });

    it('executes ./scripts/run-arena-web.sh --help successfully', async () => {
      const { stdout } = await execFileAsync('./scripts/run-arena-web.sh', ['--help']);
      expect(stdout).toContain('webbridge serve');
      expect(stdout).toContain('--port');
    });

    it('executes dist/cli.js models --json and returns valid JSON array', async () => {
      const { stdout } = await execFileAsync('node', ['./dist/cli.js', 'models', '--json']);
      const parsed = JSON.parse(stdout);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toContain('claude-3-7-sonnet');
    });

    it('executes dist/cli.js status --json and returns status schema', async () => {
      const { stdout } = await execFileAsync('node', ['./dist/cli.js', 'status', '--json']);
      const parsed = JSON.parse(stdout);
      expect(parsed).toHaveProperty('userDataDir');
      expect(parsed).toHaveProperty('exists');
      expect(parsed).toHaveProperty('hasSessionData');
    });
  });
});

