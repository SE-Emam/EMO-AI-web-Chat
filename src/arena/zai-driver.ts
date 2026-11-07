import type { ArenaDriver, ChatMessage, ZaiConfig } from '../types.js';
import { ZAI_MODELS, normalizeZaiModel, mapZaiRateLimitError } from './zai-models.js';

/**
 * OpenAI-over-HTTP driver that talks directly to the Z.AI (Zhipu) chat completions API.
 *
 * No browser involved: Z.AI exposes an officially OpenAI-compatible endpoint, so both
 * streaming and non-streaming requests are plain `fetch` calls. Streaming responses
 * are standard SSE (`data: {...}` lines terminated by `data: [DONE]`).
 */
export class ZaiDriver implements ArenaDriver {
  private readonly config: ZaiConfig;

  constructor(config: ZaiConfig) {
    // Ensure base URL ends with a slash so `${baseUrl}chat/completions` works either way.
    this.config = {
      ...config,
      baseUrl: config.baseUrl.endsWith('/') ? config.baseUrl : `${config.baseUrl}/`,
    };
  }

  async listModels(): Promise<string[]> {
    return [...ZAI_MODELS];
  }

  async sendMessage(
    model: string,
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    // Resolve GLM-ish requests onto the Z.AI catalog; unknown ids fall back to the default.
    const normalized = normalizeZaiModel(model);
    const targetModel = ZAI_MODELS.includes(normalized) ? normalized : this.config.defaultModel;
    const body = this.buildRequestBody(targetModel, messages);

    const response = await fetch(`${this.config.baseUrl}chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });

    if (!response.ok || !response.body) {
      await this.throwApiError(response);
    }

    let accumulated = '';
    let buffer = '';
    const decoder = new TextDecoder();

    for await (const rawChunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      if (signal?.aborted) {
        throw new Error('Request was aborted');
      }

      buffer += decoder.decode(rawChunk, { stream: true });

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');

        if (!line || !line.startsWith('data:')) {
          continue;
        }

        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          return accumulated;
        }

        let parsed: {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue; // Ignore malformed keep-alive/comment lines
        }

        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          accumulated += delta;
          if (onChunk) {
            onChunk(delta);
          }
        }
      }
    }

    return accumulated;
  }

  /**
   * Builds the Z.AI request body, normalizing OpenAI parameters that Z.AI restricts
   * (temperature must be 0..1, response_format limited to text/json_object).
   */
  private buildRequestBody(model: string, messages: ChatMessage[]): Record<string, unknown> {
    const outgoing = messages.map((msg) => {
      const m: { role: string; content: string; name?: string } = {
        role: msg.role,
        content: msg.content,
      };
      if (msg.name) {
        m.name = msg.name;
      }
      return m;
    });

    return {
      model,
      messages: outgoing,
      // GLM-5.x flash models force thinking on; harmless for other models.
      thinking: { type: 'enabled' },
    };
  }

  /**
   * Converts a non-OK Z.AI response into an error carrying OpenAI-compatible
   * statusCode/type information. Z.AI error code 1302 maps to 429 (user rate limit),
   * 1305 maps to 503 (platform overload).
   */
  private async throwApiError(response: Response): Promise<never> {
    let message = `Z.AI request failed with HTTP ${response.status}`;
    let code: string | undefined;
    try {
      const text = await response.text();
      const parsed = JSON.parse(text) as {
        error?: { message?: string; code?: string | number };
        message?: string;
      };
      if (parsed?.error?.message) {
        message = parsed.error.message;
        const parsedCode = parsed.error.code;
        code = parsedCode !== undefined ? String(parsedCode) : undefined;
      } else if (parsed?.message) {
        message = parsed.message;
      }
    } catch {
      // Keep default message if body is not JSON
    }

    const err = new Error(message) as Error & { statusCode?: number; type?: string };
    if (response.status === 429 || code === '1302') {
      err.statusCode = 429;
      err.type = 'rate_limit_error';
      err.message = mapZaiRateLimitError(message);
    } else if (response.status >= 500 || code === '1305') {
      err.statusCode = 503;
      err.type = 'server_error';
      err.message = `Z.AI platform temporarily unavailable (overloaded). Please retry shortly.`;
    } else if (response.status === 401) {
      err.statusCode = 401;
      err.type = 'authentication_error';
      err.message = 'Z.AI rejected the API key. Check ZAI_API_KEY.';
    }

    throw err;
  }
}
