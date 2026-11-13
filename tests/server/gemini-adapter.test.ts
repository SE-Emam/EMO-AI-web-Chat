import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ArenaDriver, ChatMessage } from '../../src/types.js';
import {
  extractGeminiPartsText,
  extractTextFromParts,
  extractSystemInstructionText,
  parseGeminiRequest,
  convertGeminiContents,
  convertGeminiRequestToChatMessages,
  formatGeminiResponse,
  formatGeminiSSE,
  formatGeminiDeltaChunk,
  formatGeminiFinalChunk,
  formatGeminiStreamChunk,
  formatGeminiError,
  formatGeminiModelList,
  type GeminiGenerateContentRequest,
} from '../../src/server/gemini-adapter.js';
import {
  registerGeminiRoutes,
  extractGeminiApiKey,
  isGeminiAuthorized,
} from '../../src/server/gemini-routes.js';
import { createServer } from '../../src/server/app.js';
import { UsageTracker } from '../../src/gateway/usage-tracker.js';

function parseSSEEvents(raw: string): Array<{ data: any }> {
  const events: Array<{ data: any }> = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const jsonStr = line.slice(6).trim();
      if (jsonStr) {
        try {
          events.push({ data: JSON.parse(jsonStr) });
        } catch {
          // ignore malformed lines
        }
      }
    }
  }
  return events;
}

describe('Gemini Protocol Adapter (/v1beta/*)', () => {
  describe('extractGeminiPartsText & extractSystemInstructionText', () => {
    it('returns raw string when parts is a string', () => {
      expect(extractGeminiPartsText('Hello Gemini')).toBe('Hello Gemini');
      expect(extractTextFromParts('Hello Gemini')).toBe('Hello Gemini');
    });

    it('joins text parts with newlines', () => {
      const parts = [{ text: 'Part 1' }, { text: 'Part 2' }];
      expect(extractGeminiPartsText(parts)).toBe('Part 1\nPart 2');
    });

    it('filters out non-text parts or undefined text', () => {
      const parts = [
        { text: 'Valid text' },
        { inlineData: { mimeType: 'image/png' } } as any,
        { text: undefined },
      ];
      expect(extractGeminiPartsText(parts)).toBe('Valid text');
    });

    it('returns empty string for null, undefined, or empty array', () => {
      expect(extractGeminiPartsText(null)).toBe('');
      expect(extractGeminiPartsText(undefined)).toBe('');
      expect(extractGeminiPartsText([])).toBe('');
    });

    it('preserves functionCall and functionResponse parts in structured text', () => {
      const parts = [
        { text: 'Calling tool' },
        { functionCall: { name: 'run_test', args: { file: 'app.ts' } } },
        { functionResponse: { name: 'run_test', response: { ok: true } } },
      ];
      const text = extractGeminiPartsText(parts);
      expect(text).toContain('Calling tool');
      expect(text).toContain('[Function Call: run_test]');
      expect(text).toContain('[Function Response: run_test]');
    });

    it('extracts systemInstruction text from string, parts array, or text property', () => {
      expect(extractSystemInstructionText('Be concise')).toBe('Be concise');
      expect(
        extractSystemInstructionText({
          parts: [{ text: 'You are an AI.' }, { text: 'Answer accurately.' }],
        })
      ).toBe('You are an AI.\nAnswer accurately.');
      expect(extractSystemInstructionText({ text: 'Single instruction' })).toBe(
        'Single instruction'
      );
      expect(extractSystemInstructionText(null)).toBe('');
      expect(extractSystemInstructionText(undefined)).toBe('');
    });
  });

  describe('parseGeminiRequest', () => {
    it('parses valid payload with contents and optional fields', () => {
      const payload: GeminiGenerateContentRequest = {
        contents: [{ role: 'user', parts: [{ text: 'Explain gravity' }] }],
        systemInstruction: { parts: [{ text: 'Think physics' }] },
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 500,
          topP: 0.9,
          topK: 40,
        },
      };
      const parsed = parseGeminiRequest(payload);
      expect(parsed.contents).toHaveLength(1);
      expect(parsed.generationConfig?.temperature).toBe(0.5);
      expect(parsed.generationConfig?.maxOutputTokens).toBe(500);
      expect(parsed.generationConfig?.topP).toBe(0.9);
      expect(parsed.generationConfig?.topK).toBe(40);
    });

    it('throws error when request body is not an object or contents is missing/empty', () => {
      expect(() => parseGeminiRequest(null)).toThrow(/request body must be an object/i);
      expect(() => parseGeminiRequest({})).toThrow(/"contents" is required/i);
      expect(() => parseGeminiRequest({ contents: [] })).toThrow(/"contents" is required/i);
      expect(() => parseGeminiRequest({ contents: 'not-an-array' as any })).toThrow(
        /"contents" is required/i
      );
    });
  });

  describe('convertGeminiContents & convertGeminiRequestToChatMessages', () => {
    it('converts single user turn', () => {
      const contents = [{ role: 'user', parts: [{ text: 'Hello' }] }];
      const messages = convertGeminiContents(contents);

      expect(messages).toEqual([{ role: 'user', content: 'Hello' }]);
    });

    it('defaults role to "user" when role is omitted or unrecognized', () => {
      const contents = [{ parts: [{ text: 'Hello default role' }] }];
      const messages = convertGeminiContents(contents);

      expect(messages).toEqual([{ role: 'user', content: 'Hello default role' }]);
    });

    it('maps Gemini "model" role to "assistant"', () => {
      const contents = [{ role: 'model', parts: [{ text: 'I am Gemini' }] }];
      const messages = convertGeminiContents(contents);

      expect(messages).toEqual([{ role: 'assistant', content: 'I am Gemini' }]);
    });

    it('converts multi-turn conversation preserving order', () => {
      const contents = [
        { role: 'user', parts: [{ text: 'What is 2+2?' }] },
        { role: 'model', parts: [{ text: 'It is 4.' }] },
        { role: 'user', parts: [{ text: 'And multiply by 3?' }] },
      ];
      const messages = convertGeminiContents(contents);

      expect(messages).toEqual([
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: 'It is 4.' },
        { role: 'user', content: 'And multiply by 3?' },
      ]);
    });

    it('prepends systemInstruction as role "system" when provided', () => {
      const contents = [{ role: 'user', parts: [{ text: 'Hi' }] }];
      const systemInstruction = { parts: [{ text: 'Be helpful and polite.' }] };
      const messages = convertGeminiContents(contents, systemInstruction);

      expect(messages).toEqual([
        { role: 'system', content: 'Be helpful and polite.' },
        { role: 'user', content: 'Hi' },
      ]);
    });

    it('prepends string systemInstruction as role "system"', () => {
      const req: GeminiGenerateContentRequest = {
        contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
        systemInstruction: 'Act as a code assistant.',
      };
      const messages = convertGeminiRequestToChatMessages(req);

      expect(messages).toEqual([
        { role: 'system', content: 'Act as a code assistant.' },
        { role: 'user', content: 'Hi' },
      ]);
    });

    it('does not prepend system message when systemInstruction is empty or whitespace', () => {
      const contents = [{ role: 'user', parts: [{ text: 'Hi' }] }];
      const messages = convertGeminiContents(contents, '   ');

      expect(messages).toEqual([{ role: 'user', content: 'Hi' }]);
    });
  });

  describe('Response Formatting', () => {
    it('formats non-streaming response matching Gemini specification', () => {
      const res = formatGeminiResponse(
        'The answer is 42.',
        'gemini-1.5-flash',
        { promptTokenCount: 15, candidatesTokenCount: 8, totalTokenCount: 23 },
        'STOP'
      );

      expect(res).toEqual({
        candidates: [
          {
            content: {
              parts: [{ text: 'The answer is 42.' }],
              role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 15,
          candidatesTokenCount: 8,
          totalTokenCount: 23,
        },
        modelVersion: 'gemini-1.5-flash',
      });
    });

    it('formats streaming delta chunk with delta text and omitted/null finishReason', () => {
      const chunkStr = formatGeminiDeltaChunk('Streaming delta', 'gemini-1.5-pro');
      expect(chunkStr).toMatch(/^data: /);
      expect(chunkStr.endsWith('\n\n')).toBe(true);

      const parsed = JSON.parse(chunkStr.slice(6).trim());
      expect(parsed.candidates[0].content.parts[0].text).toBe('Streaming delta');
      expect(parsed.candidates[0].content.role).toBe('model');
      expect(parsed.candidates[0].finishReason).toBeUndefined();
      expect(parsed.modelVersion).toBe('gemini-1.5-pro');
    });

    it('formats final streaming chunk with finishReason: STOP and usageMetadata', () => {
      const finalStr = formatGeminiFinalChunk(
        'gemini-1.5-pro',
        { promptTokenCount: 20, candidatesTokenCount: 30, totalTokenCount: 50 },
        'STOP'
      );
      expect(finalStr).toMatch(/^data: /);

      const parsed = JSON.parse(finalStr.slice(6).trim());
      expect(parsed.candidates[0].finishReason).toBe('STOP');
      expect(parsed.candidates[0].content.role).toBe('model');
      expect(parsed.usageMetadata).toEqual({
        promptTokenCount: 20,
        candidatesTokenCount: 30,
        totalTokenCount: 50,
      });
      expect(parsed.modelVersion).toBe('gemini-1.5-pro');
    });

    it('formats generic stream chunk via formatGeminiStreamChunk', () => {
      const delta = formatGeminiStreamChunk({
        text: 'Hello',
        model: 'gemini-1.5-flash',
      });
      const parsedDelta = JSON.parse(delta.slice(6).trim());
      expect(parsedDelta.candidates[0].content.parts[0].text).toBe('Hello');
      expect(parsedDelta.candidates[0].finishReason).toBeUndefined();

      const final = formatGeminiStreamChunk({
        text: '',
        model: 'gemini-1.5-flash',
        finishReason: 'STOP',
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
      });
      const parsedFinal = JSON.parse(final.slice(6).trim());
      expect(parsedFinal.candidates[0].finishReason).toBe('STOP');
      expect(parsedFinal.usageMetadata.totalTokenCount).toBe(7);
    });

    it('formats SSE error message', () => {
      const errStr = formatGeminiError('Rate limit exceeded', 429, 'RESOURCE_EXHAUSTED');
      const parsed = JSON.parse(errStr.slice(6).trim());
      expect(parsed.error).toEqual({
        code: 429,
        message: 'Rate limit exceeded',
        status: 'RESOURCE_EXHAUSTED',
      });
    });

    it('formats model list response', () => {
      const list = formatGeminiModelList(['gemini-1.5-flash', 'models/gemini-1.5-pro']);
      expect(list.models).toEqual([
        {
          name: 'models/gemini-1.5-flash',
          displayName: 'gemini-1.5-flash',
          supportedGenerationMethods: ['generateContent', 'countTokens'],
        },
        {
          name: 'models/gemini-1.5-pro',
          displayName: 'gemini-1.5-pro',
          supportedGenerationMethods: ['generateContent', 'countTokens'],
        },
      ]);
    });
  });

  describe('Fastify Gemini Routes Handling', () => {
    let mockDriver: ArenaDriver;
    let tracker: UsageTracker;

    beforeEach(() => {
      tracker = new UsageTracker();
      mockDriver = {
        listModels: vi.fn().mockResolvedValue(['gemini-1.5-flash', 'gemini-1.5-pro']),
        sendMessage: vi.fn().mockImplementation(
          async (
            _model: string,
            _messages: ChatMessage[],
            onChunk?: (chunk: string) => void
          ) => {
            if (onChunk) {
              onChunk('Hello');
              onChunk(' from');
              onChunk(' Gemini stream!');
            }
            return 'Hello from Gemini stream!';
          }
        ),
      };
    });

    function createTestApp(opts?: {
      requireApiKey?: boolean;
      apiKey?: string;
      getValidApiKeys?: () => string[];
    }) {
      const app: FastifyInstance = Fastify({ logger: false });
      registerGeminiRoutes(app, {
        getDriver: () => mockDriver,
        tracker,
        ...opts,
      });
      return app;
    }

    it('returns 400 when body has missing or empty contents', async () => {
      const app = createTestApp();
      let res = await app.inject({
        method: 'POST',
        url: '/v1beta/models/gemini-1.5-flash:generateContent',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      const json1 = JSON.parse(res.body);
      expect(json1.error.message).toMatch(/contents/i);
      expect(json1.error.status).toBe('INVALID_ARGUMENT');

      res = await app.inject({
        method: 'POST',
        url: '/v1beta/models/gemini-1.5-flash:generateContent',
        payload: { contents: [] },
      });
      expect(res.statusCode).toBe(400);
      const json2 = JSON.parse(res.body);
      expect(json2.error.status).toBe('INVALID_ARGUMENT');
    });

    it('returns 404 when endpoint action is unrecognized', async () => {
      const app = createTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1beta/models/gemini-1.5-flash:unknownAction',
        payload: {
          contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        },
      });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.status).toBe('NOT_FOUND');
    });

    it('handles non-streaming POST /v1beta/models/:modelName:generateContent successfully', async () => {
      const app = createTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1beta/models/gemini-1.5-flash:generateContent',
        payload: {
          systemInstruction: { parts: [{ text: 'System rule' }] },
          contents: [{ role: 'user', parts: [{ text: 'What is AI?' }] }],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.modelVersion).toBe('gemini-1.5-flash');
      expect(body.candidates[0].finishReason).toBe('STOP');
      expect(body.candidates[0].content.parts[0].text).toBe('Hello from Gemini stream!');
      expect(body.usageMetadata.promptTokenCount).toBeGreaterThan(0);
      expect(body.usageMetadata.candidatesTokenCount).toBeGreaterThan(0);
      expect(body.usageMetadata.totalTokenCount).toBe(
        body.usageMetadata.promptTokenCount + body.usageMetadata.candidatesTokenCount
      );

      expect(mockDriver.sendMessage).toHaveBeenCalledWith(
        'gemini-1.5-flash',
        [
          { role: 'system', content: 'System rule' },
          { role: 'user', content: 'What is AI?' },
        ],
        undefined,
        expect.any(AbortSignal),
        expect.any(String)
      );
    });

    it('handles streaming POST /v1beta/models/:modelName:streamGenerateContent', async () => {
      const app = createTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1beta/models/gemini-1.5-pro:streamGenerateContent',
        payload: {
          contents: [{ role: 'user', parts: [{ text: 'Tell a story' }] }],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');

      const events = parseSSEEvents(res.body);
      expect(events.length).toBeGreaterThanOrEqual(4); // 3 deltas + 1 final STOP

      expect(events[0].data.candidates[0].content.parts[0].text).toBe('Hello');
      expect(events[1].data.candidates[0].content.parts[0].text).toBe(' from');
      expect(events[2].data.candidates[0].content.parts[0].text).toBe(' Gemini stream!');

      const finalEvent = events[events.length - 1];
      expect(finalEvent.data.candidates[0].finishReason).toBe('STOP');
      expect(finalEvent.data.usageMetadata).toBeDefined();
      expect(finalEvent.data.usageMetadata.totalTokenCount).toBeGreaterThan(0);
      expect(finalEvent.data.modelVersion).toBe('gemini-1.5-pro');

      expect(mockDriver.sendMessage).toHaveBeenCalledWith(
        'gemini-1.5-pro',
        [{ role: 'user', content: 'Tell a story' }],
        expect.any(Function),
        expect.any(AbortSignal),
        expect.any(String)
      );
    });

    it('handles alternative route POST /v1beta/:modelName:generateContent', async () => {
      const app = createTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1beta/gemini-1.5-flash:generateContent',
        payload: {
          contents: [{ role: 'user', parts: [{ text: 'Alternative route test' }] }],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.modelVersion).toBe('gemini-1.5-flash');
      expect(mockDriver.sendMessage).toHaveBeenCalledWith(
        'gemini-1.5-flash',
        [{ role: 'user', content: 'Alternative route test' }],
        undefined,
        expect.any(AbortSignal),
        expect.any(String)
      );
    });

    it('handles alternative route POST /v1beta/:modelName:streamGenerateContent', async () => {
      const app = createTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1beta/gemini-1.5-flash:streamGenerateContent',
        payload: {
          contents: [{ role: 'user', parts: [{ text: 'Alternative stream test' }] }],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      const events = parseSSEEvents(res.body);
      expect(events.length).toBeGreaterThan(1);
    });

    it('handles duplicate models/ prefix gracefully in URL', async () => {
      const app = createTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1beta/models/models/gemini-1.5-flash:generateContent',
        payload: {
          contents: [{ role: 'user', parts: [{ text: 'Prefix test' }] }],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(mockDriver.sendMessage).toHaveBeenCalledWith(
        'gemini-1.5-flash',
        [{ role: 'user', content: 'Prefix test' }],
        undefined,
        expect.any(AbortSignal),
        expect.any(String)
      );
    });

    it('triggers streaming when alt=sse query parameter is provided on generateContent', async () => {
      const app = createTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1beta/models/gemini-1.5-flash:generateContent?alt=sse',
        payload: {
          contents: [{ role: 'user', parts: [{ text: 'SSE param test' }] }],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      const events = parseSSEEvents(res.body);
      expect(events.length).toBeGreaterThan(0);
    });

    it('handles countTokens action', async () => {
      const app = createTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1beta/models/gemini-1.5-flash:countTokens',
        payload: {
          contents: [{ role: 'user', parts: [{ text: 'One two three four' }] }],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.totalTokens).toBeGreaterThan(0);
    });

    it('handles GET /v1beta/models to list available models in Gemini format', async () => {
      const app = createTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/v1beta/models',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.models).toEqual([
        {
          name: 'models/gemini-1.5-flash',
          displayName: 'gemini-1.5-flash',
          supportedGenerationMethods: ['generateContent', 'countTokens'],
        },
        {
          name: 'models/gemini-1.5-pro',
          displayName: 'gemini-1.5-pro',
          supportedGenerationMethods: ['generateContent', 'countTokens'],
        },
      ]);
    });

    it('handles GET /v1beta/models/:modelName for single model metadata', async () => {
      const app = createTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/v1beta/models/gemini-1.5-flash',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.name).toBe('models/gemini-1.5-flash');
      expect(body.displayName).toBe('gemini-1.5-flash');
      expect(body.supportedGenerationMethods).toContain('generateContent');
    });

    it('handles OPTIONS preflight with CORS headers', async () => {
      const app = createTestApp();
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/v1beta/models/gemini-1.5-flash:generateContent',
      });

      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-methods']).toContain('POST');
      expect(res.headers['access-control-allow-headers']).toContain('x-goog-api-key');
    });

    describe('Authentication methods', () => {
      it('rejects unauthenticated requests when requireApiKey is true', async () => {
        const app = createTestApp({
          requireApiKey: true,
          apiKey: 'secret-gemini-key',
        });

        const res = await app.inject({
          method: 'POST',
          url: '/v1beta/models/gemini-1.5-flash:generateContent',
          payload: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
          },
        });

        expect(res.statusCode).toBe(401);
        const body = JSON.parse(res.body);
        expect(body.error.code).toBe(401);
        expect(body.error.status).toBe('UNAUTHENTICATED');
      });

      it('accepts valid key via x-goog-api-key header', async () => {
        const app = createTestApp({
          requireApiKey: true,
          apiKey: 'secret-gemini-key',
        });

        const res = await app.inject({
          method: 'POST',
          url: '/v1beta/models/gemini-1.5-flash:generateContent',
          headers: {
            'x-goog-api-key': 'secret-gemini-key',
          },
          payload: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
          },
        });

        expect(res.statusCode).toBe(200);
      });

      it('accepts valid key via Authorization: Bearer <key>', async () => {
        const app = createTestApp({
          requireApiKey: true,
          apiKey: 'secret-gemini-key',
        });

        const res = await app.inject({
          method: 'POST',
          url: '/v1beta/models/gemini-1.5-flash:generateContent',
          headers: {
            authorization: 'Bearer secret-gemini-key',
          },
          payload: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
          },
        });

        expect(res.statusCode).toBe(200);
      });

      it('accepts valid key via query parameter key=<key>', async () => {
        const app = createTestApp({
          requireApiKey: true,
          apiKey: 'secret-gemini-key',
        });

        const res = await app.inject({
          method: 'POST',
          url: '/v1beta/models/gemini-1.5-flash:generateContent?key=secret-gemini-key',
          payload: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
          },
        });

        expect(res.statusCode).toBe(200);
      });

      it('accepts valid key from getValidApiKeys() list', async () => {
        const app = createTestApp({
          requireApiKey: true,
          getValidApiKeys: () => ['multi-key-1', 'multi-key-2'],
        });

        const res = await app.inject({
          method: 'POST',
          url: '/v1beta/models/gemini-1.5-flash:generateContent',
          headers: {
            'x-goog-api-key': 'multi-key-2',
          },
          payload: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
          },
        });

        expect(res.statusCode).toBe(200);
      });

      it('rejects invalid key', async () => {
        const app = createTestApp({
          requireApiKey: true,
          apiKey: 'correct-key',
        });

        const res = await app.inject({
          method: 'POST',
          url: '/v1beta/models/gemini-1.5-flash:generateContent',
          headers: {
            'x-goog-api-key': 'wrong-key',
          },
          payload: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
          },
        });

        expect(res.statusCode).toBe(401);
      });
    });

    describe('Driver failure & error responses', () => {
      it('returns 500 when driver fails in non-streaming mode', async () => {
        mockDriver.sendMessage = vi.fn().mockRejectedValue(new Error('Driver timeout'));
        const app = createTestApp();

        const res = await app.inject({
          method: 'POST',
          url: '/v1beta/models/gemini-1.5-flash:generateContent',
          payload: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
          },
        });

        expect(res.statusCode).toBe(500);
        const body = JSON.parse(res.body);
        expect(body.error.code).toBe(500);
        expect(body.error.message).toBe('Driver timeout');
        expect(body.error.status).toBe('INTERNAL');
      });

      it('returns 500 when driver fails immediately before stream starts', async () => {
        mockDriver.sendMessage = vi
          .fn()
          .mockRejectedValue(new Error('Stream rejected immediately'));
        const app = createTestApp();

        const res = await app.inject({
          method: 'POST',
          url: '/v1beta/models/gemini-1.5-flash:streamGenerateContent',
          payload: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
          },
        });

        expect(res.statusCode).toBe(500);
        const body = JSON.parse(res.body);
        expect(body.error.message).toBe('Stream rejected immediately');
      });

      it('writes SSE error chunk if driver fails mid-stream after chunks sent', async () => {
        mockDriver.sendMessage = vi.fn().mockImplementation(
          async (
            _model: string,
            _msgs: ChatMessage[],
            onChunk?: (chunk: string) => void
          ) => {
            if (onChunk) onChunk('Partial response');
            throw new Error('Connection broke mid-stream');
          }
        );
        const app = createTestApp();

        const res = await app.inject({
          method: 'POST',
          url: '/v1beta/models/gemini-1.5-flash:streamGenerateContent',
          payload: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
          },
        });

        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('Connection broke mid-stream');
        const events = parseSSEEvents(res.body);
        const errEvent = events.find((e) => e.data.error);
        expect(errEvent).toBeDefined();
        expect(errEvent?.data.error.message).toBe('Connection broke mid-stream');
      });
    });

    describe('Full Gateway Integration with createServer()', () => {
      it('successfully calls Gemini endpoints via createServer() instance', async () => {
        const app = createServer(mockDriver);

        // Test GET /v1beta/models
        const modelsRes = await app.inject({
          method: 'GET',
          url: '/v1beta/models',
        });
        expect(modelsRes.statusCode).toBe(200);
        const modelsBody = JSON.parse(modelsRes.body);
        expect(modelsBody.models).toHaveLength(2);

        // Test POST /v1beta/models/gemini-1.5-flash:generateContent
        const genRes = await app.inject({
          method: 'POST',
          url: '/v1beta/models/gemini-1.5-flash:generateContent',
          payload: {
            contents: [{ role: 'user', parts: [{ text: 'End to end test' }] }],
          },
        });
        expect(genRes.statusCode).toBe(200);
        const genBody = JSON.parse(genRes.body);
        expect(genBody.candidates[0].finishReason).toBe('STOP');
        expect(genBody.modelVersion).toBe('gemini-1.5-flash');

        // Test POST /v1beta/models/gemini-1.5-flash:streamGenerateContent
        const streamRes = await app.inject({
          method: 'POST',
          url: '/v1beta/models/gemini-1.5-flash:streamGenerateContent',
          payload: {
            contents: [{ role: 'user', parts: [{ text: 'Stream end to end' }] }],
          },
        });
        expect(streamRes.statusCode).toBe(200);
        expect(streamRes.headers['content-type']).toContain('text/event-stream');
      });

      it('accepts x-goog-api-key and ?key= in gateway mode with requireApiKey: true', async () => {
        const fakeManager: any = {
          getActiveDriver: () => mockDriver,
          isServiceRunning: () => true,
          getValidApiKeys: () => ['emo.web', 'custom-gem-key'],
          listStates: () => [],
        };
        const app = createServer({
          mode: 'gateway',
          manager: fakeManager,
          tracker,
          gatewayConfig: {
            version: 1,
            gateway: {
              port: 8989,
              host: '127.0.0.1',
              baseUriDisplay: 'mac.ai/v1',
              apiKey: 'emo.web',
              requireApiKey: true,
            },
            ui: { heartbeatTimeoutMs: 15000 },
            providers: {} as any,
          },
        });

        // Unauthenticated should return Gemini-formatted 401
        const unauthRes = await app.inject({
          method: 'POST',
          url: '/v1beta/models/gemini-1.5-flash:generateContent',
          payload: { contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] },
        });
        expect(unauthRes.statusCode).toBe(401);
        expect(JSON.parse(unauthRes.body).error.status).toBe('UNAUTHENTICATED');

        // Authenticated via x-goog-api-key
        const headerRes = await app.inject({
          method: 'POST',
          url: '/v1beta/models/gemini-1.5-flash:generateContent',
          headers: { 'x-goog-api-key': 'custom-gem-key' },
          payload: { contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] },
        });
        expect(headerRes.statusCode).toBe(200);

        // Authenticated via ?key= query param
        const queryRes = await app.inject({
          method: 'POST',
          url: '/v1beta/models/gemini-1.5-flash:generateContent?key=emo.web',
          payload: { contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] },
        });
        expect(queryRes.statusCode).toBe(200);
      });
    });
  });
});
