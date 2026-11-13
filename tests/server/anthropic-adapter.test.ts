import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ArenaDriver, ChatMessage } from '../../src/types.js';
import {
  extractTextContent,
  parseAnthropicRequest,
  convertAnthropicMessages,
  convertAnthropicRequestToChatMessages,
  formatAnthropicMessageResponse,
  formatAnthropicMessageStart,
  formatAnthropicContentBlockStart,
  formatAnthropicContentBlockDelta,
  formatAnthropicContentBlockStop,
  formatAnthropicMessageDelta,
  formatAnthropicMessageStop,
  formatAnthropicError,
  formatAnthropicPing,
  formatMessageStartChunk,
  formatContentBlockStartChunk,
  formatContentBlockDeltaChunk,
  formatContentBlockStopChunk,
  formatMessageDeltaChunk,
  formatMessageStopChunk,
  type AnthropicMessagesRequest,
} from '../../src/server/anthropic-adapter.js';
import { registerAnthropicRoutes } from '../../src/server/anthropic-routes.js';
import { UsageTracker } from '../../src/gateway/usage-tracker.js';

describe('Anthropic Adapter & Protocol', () => {
  describe('extractTextContent', () => {
    it('returns raw string when content is string', () => {
      expect(extractTextContent('Hello world')).toBe('Hello world');
    });

    it('joins text blocks when content is an array of blocks', () => {
      const blocks = [
        { type: 'text', text: 'Line 1' },
        { type: 'text', text: 'Line 2' },
      ];
      expect(extractTextContent(blocks)).toBe('Line 1\nLine 2');
    });

    it('ignores non-text blocks or missing text fields', () => {
      const blocks = [
        { type: 'image', source: '...' },
        { type: 'text', text: 'Extracted text' },
        { type: 'other' },
      ];
      expect(extractTextContent(blocks)).toBe('Extracted text');
    });

    it('returns empty string for null, undefined, or empty array', () => {
      expect(extractTextContent(null)).toBe('');
      expect(extractTextContent(undefined)).toBe('');
      expect(extractTextContent([])).toBe('');
    });

    it('preserves tool_use and tool_result blocks in structured text format', () => {
      const blocks = [
        { type: 'text', text: 'Let me check that file.' },
        { type: 'tool_use', id: 'toolu_123', name: 'read_file', input: { path: 'src/index.ts' } },
        { type: 'tool_result', tool_use_id: 'toolu_123', content: 'export * from "./types.js";' },
      ];
      const extracted = extractTextContent(blocks);
      expect(extracted).toContain('Let me check that file.');
      expect(extracted).toContain('[Tool Use: read_file (id=toolu_123)]');
      expect(extracted).toContain('{"path":"src/index.ts"}');
      expect(extracted).toContain('[Tool Result (tool_use_id=toolu_123)]');
      expect(extracted).toContain('export * from "./types.js";');
    });
  });

  describe('parseAnthropicRequest', () => {
    it('parses valid payload with default model if missing', () => {
      const parsed = parseAnthropicRequest({
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(parsed.model).toBe('claude-3-5-sonnet');
      expect(parsed.messages).toHaveLength(1);
    });

    it('parses explicit model and parameters', () => {
      const parsed = parseAnthropicRequest({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1024,
        stream: true,
        temperature: 0.7,
      });
      expect(parsed.model).toBe('claude-3-opus-20240229');
      expect(parsed.max_tokens).toBe(1024);
      expect(parsed.stream).toBe(true);
      expect(parsed.temperature).toBe(0.7);
    });

    it('throws error when body is not an object or messages is missing/empty', () => {
      expect(() => parseAnthropicRequest(null)).toThrow(/request body must be an object/i);
      expect(() => parseAnthropicRequest({})).toThrow(/"messages" is required/i);
      expect(() => parseAnthropicRequest({ messages: [] })).toThrow(/"messages" is required/i);
    });
  });

  describe('convertAnthropicMessages', () => {
    it('converts single user message with string content', () => {
      const messages = [{ role: 'user' as const, content: 'Hello assistant' }];
      const result = convertAnthropicMessages(messages);

      expect(result).toEqual([
        { role: 'user', content: 'Hello assistant' },
      ]);
    });

    it('converts multi-turn conversation with content blocks', () => {
      const messages = [
        { role: 'user' as const, content: 'What is 1+1?' },
        { role: 'assistant' as const, content: [{ type: 'text', text: 'It is 2.' }] },
        { role: 'user' as const, content: [{ type: 'text', text: 'Thank you.' }] },
      ];
      const result = convertAnthropicMessages(messages);

      expect(result).toEqual([
        { role: 'user', content: 'What is 1+1?' },
        { role: 'assistant', content: 'It is 2.' },
        { role: 'user', content: 'Thank you.' },
      ]);
    });

    it('prepends system message when system is provided as string', () => {
      const messages = [{ role: 'user' as const, content: 'Hi' }];
      const system = 'You are a helpful coding assistant.';
      const result = convertAnthropicMessages(messages, system);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        role: 'system',
        content: 'You are a helpful coding assistant.',
      });
      expect(result[1]).toEqual({
        role: 'user',
        content: 'Hi',
      });
    });

    it('prepends system message when system is provided as block array', () => {
      const messages = [{ role: 'user' as const, content: 'Hi' }];
      const system = [
        { type: 'text', text: 'Primary system instructions.' },
        { type: 'text', text: 'Secondary system instructions.' },
      ];
      const result = convertAnthropicMessages(messages, system);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        role: 'system',
        content: 'Primary system instructions.\nSecondary system instructions.',
      });
      expect(result[1]).toEqual({
        role: 'user',
        content: 'Hi',
      });
    });

    it('does not prepend system message when system is empty or whitespace', () => {
      const messages = [{ role: 'user' as const, content: 'Hi' }];
      expect(convertAnthropicMessages(messages, '')).toEqual([
        { role: 'user', content: 'Hi' },
      ]);
      expect(convertAnthropicMessages(messages, '   ')).toEqual([
        { role: 'user', content: 'Hi' },
      ]);
      expect(convertAnthropicMessages(messages, undefined)).toEqual([
        { role: 'user', content: 'Hi' },
      ]);
    });

    it('convertAnthropicRequestToChatMessages converts whole request', () => {
      const request: AnthropicMessagesRequest = {
        model: 'claude-3-5-sonnet',
        system: 'System prompt',
        messages: [{ role: 'user', content: 'User prompt' }],
      };
      const result = convertAnthropicRequestToChatMessages(request);
      expect(result).toEqual([
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User prompt' },
      ]);
    });
  });

  describe('formatAnthropicMessageResponse (Non-streaming)', () => {
    it('formats a non-streaming Anthropic response according to spec', () => {
      const response = formatAnthropicMessageResponse(
        '12345678',
        'claude-3-5-sonnet',
        'This is the assistant response.',
        15,
        35
      );

      expect(response).toEqual({
        id: 'msg_12345678',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-5-sonnet',
        content: [
          {
            type: 'text',
            text: 'This is the assistant response.',
          },
        ],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 15,
          output_tokens: 35,
        },
      });
    });

    it('preserves id if already prefixed with msg_', () => {
      const response = formatAnthropicMessageResponse(
        'msg_abcde',
        'claude-3-opus',
        'Hello'
      );
      expect(response.id).toBe('msg_abcde');
    });
  });

  describe('SSE Chunks formatting', () => {
    function parseSSE(sse: string): { event: string; data: any } {
      const lines = sse.trim().split('\n');
      const eventLine = lines.find((l) => l.startsWith('event: '));
      const dataLine = lines.find((l) => l.startsWith('data: '));
      if (!eventLine || !dataLine) throw new Error(`Invalid SSE: ${sse}`);
      return {
        event: eventLine.replace('event: ', '').trim(),
        data: JSON.parse(dataLine.replace('data: ', '').trim()),
      };
    }

    it('formats message_start chunk', () => {
      const sse = formatMessageStartChunk('msg_test123', 'claude-3-5-sonnet', 42);
      expect(sse.endsWith('\n\n')).toBe(true);

      const parsed = parseSSE(sse);
      expect(parsed.event).toBe('message_start');
      expect(parsed.data).toEqual({
        type: 'message_start',
        message: {
          id: 'msg_test123',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-5-sonnet',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 42,
            output_tokens: 1,
          },
        },
      });
    });

    it('formats content_block_start chunk', () => {
      const sse = formatContentBlockStartChunk(0, '');
      const parsed = parseSSE(sse);

      expect(parsed.event).toBe('content_block_start');
      expect(parsed.data).toEqual({
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'text',
          text: '',
        },
      });
    });

    it('formats content_block_delta chunk', () => {
      const sse = formatContentBlockDeltaChunk(0, 'partial token chunk');
      const parsed = parseSSE(sse);

      expect(parsed.event).toBe('content_block_delta');
      expect(parsed.data).toEqual({
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: 'partial token chunk',
        },
      });
    });

    it('formats content_block_stop chunk', () => {
      const sse = formatContentBlockStopChunk(0);
      const parsed = parseSSE(sse);

      expect(parsed.event).toBe('content_block_stop');
      expect(parsed.data).toEqual({
        type: 'content_block_stop',
        index: 0,
      });
    });

    it('formats message_delta chunk', () => {
      const sse = formatMessageDeltaChunk('end_turn', 120);
      const parsed = parseSSE(sse);

      expect(parsed.event).toBe('message_delta');
      expect(parsed.data).toEqual({
        type: 'message_delta',
        delta: {
          stop_reason: 'end_turn',
          stop_sequence: null,
        },
        usage: {
          output_tokens: 120,
        },
      });
    });

    it('formats message_stop chunk', () => {
      const sse = formatMessageStopChunk();
      const parsed = parseSSE(sse);

      expect(parsed.event).toBe('message_stop');
      expect(parsed.data).toEqual({
        type: 'message_stop',
      });
    });

    it('formats error and ping chunks', () => {
      const errSse = formatAnthropicError('Test error', 'invalid_request_error');
      const parsedErr = parseSSE(errSse);
      expect(parsedErr.event).toBe('error');
      expect(parsedErr.data.error.message).toBe('Test error');

      const pingSse = formatAnthropicPing();
      const parsedPing = parseSSE(pingSse);
      expect(parsedPing.event).toBe('ping');
      expect(parsedPing.data.type).toBe('ping');
    });
  });

  describe('Fastify Route handling POST /v1/messages', () => {
    let mockDriver: ArenaDriver;
    let tracker: UsageTracker;

    beforeEach(() => {
      tracker = new UsageTracker();
      mockDriver = {
        listModels: vi.fn().mockResolvedValue(['claude-3-5-sonnet', 'claude-web:default']),
        sendMessage: vi.fn().mockImplementation(
          async (
            _model: string,
            _messages: ChatMessage[],
            onChunk?: (chunk: string) => void
          ) => {
            if (onChunk) {
              onChunk('Hello');
              onChunk(' from Anthropic');
              onChunk(' stream!');
            }
            return 'Hello from Anthropic stream!';
          }
        ),
      };
    });

    function createTestApp(opts?: { requireApiKey?: boolean; apiKey?: string; getValidApiKeys?: () => string[] }) {
      const app: FastifyInstance = Fastify({ logger: false });
      registerAnthropicRoutes(app, {
        getDriver: () => mockDriver,
        tracker,
        ...opts,
      });
      return app;
    }

    it('returns 400 when body has missing or empty messages', async () => {
      const app = createTestApp();
      let res = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.message).toMatch(/messages/i);

      res = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: { messages: [] },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).type).toBe('error');
    });

    it('handles non-streaming request successfully', async () => {
      const app = createTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'claude-3-5-sonnet',
          system: 'You are helpful.',
          messages: [{ role: 'user', content: 'Say hello' }],
          stream: false,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['anthropic-version']).toBe('2023-06-01');

      const body = JSON.parse(res.body);
      expect(body.id).toMatch(/^msg_/);
      expect(body.type).toBe('message');
      expect(body.role).toBe('assistant');
      expect(body.model).toBe('claude-3-5-sonnet');
      expect(body.stop_reason).toBe('end_turn');
      expect(body.content).toEqual([
        { type: 'text', text: 'Hello from Anthropic stream!' },
      ]);
      expect(body.usage.input_tokens).toBeGreaterThan(0);
      expect(body.usage.output_tokens).toBeGreaterThan(0);

      expect(mockDriver.sendMessage).toHaveBeenCalledWith(
        'claude-3-5-sonnet',
        [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Say hello' },
        ],
        undefined,
        expect.any(AbortSignal),
        expect.any(String)
      );
    });

    it('handles streaming request with SSE headers and chunks sequence', async () => {
      const app = createTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'claude-3-5-sonnet',
          messages: [{ role: 'user', content: 'Stream test' }],
          stream: true,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['connection']).toBe('keep-alive');

      const raw = res.body;
      const chunks = raw.split('\n\n').filter((c) => c.trim().length > 0);

      // Verify sequence of events
      expect(chunks.length).toBe(8); // message_start, content_block_start, 3x delta, content_block_stop, message_delta, message_stop
      expect(raw).toContain('event: message_start');
      expect(raw).toContain('event: content_block_start');
      expect(raw).toContain('event: content_block_delta');
      expect(raw).toContain('event: content_block_stop');
      expect(raw).toContain('event: message_delta');
      expect(raw).toContain('event: message_stop');

      // Verify delta content
      expect(raw).toContain('Hello');
      expect(raw).toContain(' from Anthropic');
      expect(raw).toContain(' stream!');
    });

    it('enforces authentication via x-api-key or Authorization Bearer when requireApiKey is true', async () => {
      const app = createTestApp({ requireApiKey: true, apiKey: 'secret-key-123' });

      // No key
      let res = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: { messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).type).toBe('error');

      // Wrong key
      res = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: { 'x-api-key': 'wrong-key' },
        payload: { messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(res.statusCode).toBe(401);

      // Valid x-api-key
      res = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: { 'x-api-key': 'secret-key-123' },
        payload: { messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(res.statusCode).toBe(200);

      // Valid Authorization: Bearer
      res = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: { authorization: 'Bearer secret-key-123' },
        payload: { messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(res.statusCode).toBe(200);
    });

    it('supports authentication with getValidApiKeys list', async () => {
      const app = createTestApp({
        requireApiKey: true,
        getValidApiKeys: () => ['multi-key-a', 'multi-key-b'],
      });

      let res = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: { 'x-api-key': 'multi-key-a' },
        payload: { messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(res.statusCode).toBe(200);

      res = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: { 'x-api-key': 'multi-key-b' },
        payload: { messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(res.statusCode).toBe(200);

      res = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: { 'x-api-key': 'invalid' },
        payload: { messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 500 when driver throws in non-streaming', async () => {
      mockDriver.sendMessage = vi.fn().mockRejectedValue(new Error('Driver failure'));
      const app = createTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          messages: [{ role: 'user', content: 'Hi' }],
        },
      });

      expect(res.statusCode).toBe(500);
      const data = JSON.parse(res.body);
      expect(data.type).toBe('error');
      expect(data.error.message).toBe('Driver failure');
    });

    it('returns 500 when driver rejects before stream starts', async () => {
      mockDriver.sendMessage = vi.fn().mockRejectedValue(new Error('Stream rejected immediately'));
      const app = createTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          messages: [{ role: 'user', content: 'Stream fail' }],
          stream: true,
        },
      });

      expect(res.statusCode).toBe(500);
      const data = JSON.parse(res.body);
      expect(data.type).toBe('error');
      expect(data.error.message).toBe('Stream rejected immediately');
    });

    it('emits error event and closes stream when driver fails mid-stream', async () => {
      mockDriver.sendMessage = vi.fn().mockImplementation(
        async (_m, _msgs, onChunk) => {
          onChunk?.('Initial chunk');
          throw new Error('Mid-stream connection lost');
        }
      );
      const app = createTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          messages: [{ role: 'user', content: 'Mid-stream fail' }],
          stream: true,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Initial chunk');
      expect(res.body).toContain('event: error');
      expect(res.body).toContain('Mid-stream connection lost');
    });

    it('records usage tracking on successful and failed requests', async () => {
      const app = createTestApp();
      await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          messages: [{ role: 'user', content: 'Hello tracker' }],
        },
      });

      const snapshot = tracker.snapshot();
      expect(snapshot.lifetime.requests).toBe(1);
      expect(snapshot.lifetime.completions).toBe(1);
    });

    it('supports OPTIONS preflight and count_tokens endpoint', async () => {
      const app = createTestApp();
      const optRes = await app.inject({
        method: 'OPTIONS',
        url: '/v1/messages',
      });
      expect(optRes.statusCode).toBe(204);

      const countRes = await app.inject({
        method: 'POST',
        url: '/v1/messages/count_tokens',
        payload: {
          messages: [{ role: 'user', content: 'Count my tokens' }],
        },
      });
      expect(countRes.statusCode).toBe(200);
      const countData = JSON.parse(countRes.body);
      expect(countData.input_tokens).toBeGreaterThan(0);
    });
  });
});
