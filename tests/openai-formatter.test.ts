import { describe, it, expect } from 'vitest';
import {
  formatChatCompletionChunk,
  formatDoneChunk,
  formatChatCompletionResponse,
  formatModelList,
} from '../src/server/openai-formatter.js';

describe('OpenAI Formatter', () => {
  describe('formatChatCompletionChunk', () => {
    it('should format a stream chunk with text delta', () => {
      const id = 'chatcmpl-test-123';
      const model = 'gpt-4o';
      const textDelta = 'Hello world';

      const sseString = formatChatCompletionChunk(id, model, textDelta);

      expect(sseString.startsWith('data: ')).toBe(true);
      expect(sseString.endsWith('\n\n')).toBe(true);

      const jsonStr = sseString.slice(6, -2);
      const chunk = JSON.parse(jsonStr);

      expect(chunk.id).toBe(id);
      expect(chunk.object).toBe('chat.completion.chunk');
      expect(chunk.model).toBe(model);
      expect(typeof chunk.created).toBe('number');
      // Created timestamp should be in seconds
      expect(chunk.created).toBeLessThan(10000000000);
      expect(chunk.choices).toEqual([
        {
          index: 0,
          delta: { content: 'Hello world' },
          finish_reason: null,
        },
      ]);
    });

    it('should format an empty text delta with empty delta object', () => {
      const id = 'chatcmpl-test-empty';
      const model = 'claude-3-sonnet';

      const sseString = formatChatCompletionChunk(id, model, '');
      const jsonStr = sseString.slice(6, -2);
      const chunk = JSON.parse(jsonStr);

      expect(chunk.choices[0].delta).toEqual({});
      expect(chunk.choices[0].finish_reason).toBeNull();
    });

    it('should format a chunk with finish_reason', () => {
      const id = 'chatcmpl-test-finish';
      const model = 'claude-3-opus';

      const sseString = formatChatCompletionChunk(id, model, '', 'stop');
      const jsonStr = sseString.slice(6, -2);
      const chunk = JSON.parse(jsonStr);

      expect(chunk.choices[0].delta).toEqual({});
      expect(chunk.choices[0].finish_reason).toBe('stop');
    });

    it('should accept custom created timestamp if provided', () => {
      const sseString = formatChatCompletionChunk('id', 'model', 'text', null, 1700000000);
      const jsonStr = sseString.slice(6, -2);
      const chunk = JSON.parse(jsonStr);

      expect(chunk.created).toBe(1700000000);
    });
  });

  describe('formatDoneChunk', () => {
    it('should return exact data: [DONE]\\n\\n', () => {
      const result = formatDoneChunk();
      expect(result).toBe('data: [DONE]\n\n');
    });
  });

  describe('formatChatCompletionResponse', () => {
    it('should format a complete non-streaming chat completion response', () => {
      const id = 'chatcmpl-res-123';
      const model = 'meta-llama-3';
      const content = 'This is the complete assistant response.';

      const before = Math.floor(Date.now() / 1000);
      const response = formatChatCompletionResponse(id, model, content);
      const after = Math.floor(Date.now() / 1000);

      expect(response.id).toBe(id);
      expect(response.object).toBe('chat.completion');
      expect(response.model).toBe(model);
      expect(response.created).toBeGreaterThanOrEqual(before);
      expect(response.created).toBeLessThanOrEqual(after);
      expect(response.choices).toEqual([
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
          },
          finish_reason: 'stop',
        },
      ]);
      expect(response.usage).toEqual({
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      });
    });

    it('should correctly calculate usage tokens if provided', () => {
      const response = formatChatCompletionResponse(
        'chatcmpl-res-tokens',
        'gpt-4o',
        'response content',
        15,
        42
      );

      expect(response.usage).toEqual({
        prompt_tokens: 15,
        completion_tokens: 42,
        total_tokens: 57,
      });
    });
  });

  describe('formatModelList', () => {
    it('should format an empty list of models', () => {
      const response = formatModelList([]);
      expect(response).toEqual({
        object: 'list',
        data: [],
      });
    });

    it('should format an array of model IDs into ModelListResponse', () => {
      const modelIds = ['gpt-4o', 'claude-3-5-sonnet', 'gemini-1.5-pro'];
      const response = formatModelList(modelIds);

      expect(response).toEqual({
        object: 'list',
        data: [
          {
            id: 'gpt-4o',
            object: 'model',
            created: 1700000000,
            owned_by: 'arena',
          },
          {
            id: 'claude-3-5-sonnet',
            object: 'model',
            created: 1700000000,
            owned_by: 'arena',
          },
          {
            id: 'gemini-1.5-pro',
            object: 'model',
            created: 1700000000,
            owned_by: 'arena',
          },
        ],
      });
    });
  });
});
