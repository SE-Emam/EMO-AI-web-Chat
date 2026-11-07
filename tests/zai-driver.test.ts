import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZaiDriver } from '../src/arena/zai-driver.js';
import { RoutingDriver } from '../src/arena/routing-driver.js';
import { loadConfig, DEFAULT_ZAI_BASE_URL } from '../src/config.js';
import { ZAI_MODELS, isZaiModel, normalizeZaiModel } from '../src/arena/zai-models.js';

function sseResponse(lines: string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + '\n'));
      }
      controller.close();
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    body: stream,
    text: async () => lines.join('\n'),
  } as unknown as Response;
}

function jsonErrorResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    body: null,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('ZAiDriver', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listModels returns the Z.AI catalog', async () => {
    const driver = new ZaiDriver({ apiKey: 'k', baseUrl: DEFAULT_ZAI_BASE_URL, defaultModel: 'glm-5.3-flash', modelPrefixes: ['glm-'] });
    const models = await driver.listModels();
    expect(models).toContain('glm-5.3-flash');
    expect(models).toContain('glm-4.7-flash');
  });

  it('non-streaming send accumulates delta content and POSTs the right payload', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"role":"assistant","content":"Hel"}}]}',
        'data: {"choices":[{"delta":{"content":"lo"}}]}',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        'data: [DONE]',
      ])
    );

    const driver = new ZaiDriver({ apiKey: 'k', baseUrl: DEFAULT_ZAI_BASE_URL, defaultModel: 'glm-5.3-flash', modelPrefixes: ['glm-'] });
    const result = await driver.sendMessage('glm-5.3-flash', [
      { role: 'user', content: 'hi' },
    ]);

    expect(result).toBe('Hello world');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.z.ai/api/paas/v4/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('glm-5.3-flash');
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('streams chunks through onChunk', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"A"}}]}',
        'data: {"choices":[{"delta":{"content":"B"}}]}',
        'data: [DONE]',
      ])
    );

    const driver = new ZaiDriver({ apiKey: 'k', baseUrl: DEFAULT_ZAI_BASE_URL, defaultModel: 'glm-5.3-flash', modelPrefixes: ['glm-'] });
    const chunks: string[] = [];
    await driver.sendMessage('glm-5.3-flash', [{ role: 'user', content: 'x' }], (c) => chunks.push(c));

    expect(chunks).toEqual(['A', 'B']);
  });

  it('normalizes a base URL without trailing slash', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]'])
    );

    const driver = new ZaiDriver({ apiKey: 'k', baseUrl: 'https://api.z.ai/api/paas/v4', defaultModel: 'glm-5.3-flash', modelPrefixes: ['glm-'] });
    await driver.sendMessage('glm-5.3-flash', [{ role: 'user', content: 'x' }]);

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.z.ai/api/paas/v4/chat/completions');
  });

  it('maps Z.AI 1302 error to 429 rate_limit_error', async () => {
    fetchMock.mockResolvedValue(
      jsonErrorResponse(400, { error: { message: 'user limit reached', code: '1302' } })
    );

    const driver = new ZaiDriver({ apiKey: 'k', baseUrl: DEFAULT_ZAI_BASE_URL, defaultModel: 'glm-5.3-flash', modelPrefixes: ['glm-'] });
    await expect(
      driver.sendMessage('glm-5.3-flash', [{ role: 'user', content: 'x' }])
    ).rejects.toMatchObject({ statusCode: 429, type: 'rate_limit_error' });
  });

  it('maps Z.AI HTTP 401 to authentication error', async () => {
    fetchMock.mockResolvedValue(
      jsonErrorResponse(401, { error: { message: 'invalid api key' } })
    );

    const driver = new ZaiDriver({ apiKey: 'bad', baseUrl: DEFAULT_ZAI_BASE_URL, defaultModel: 'glm-5.3-flash', modelPrefixes: ['glm-'] });
    await expect(
      driver.sendMessage('glm-5.3-flash', [{ role: 'user', content: 'x' }])
    ).rejects.toMatchObject({ statusCode: 401, type: 'authentication_error' });
  });

  it('falls back to default model for unknown GLM-ish ids', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]'])
    );

    const driver = new ZaiDriver({ apiKey: 'k', baseUrl: DEFAULT_ZAI_BASE_URL, defaultModel: 'glm-5.3-flash', modelPrefixes: ['glm-'] });
    await driver.sendMessage('glm-unknown-thing', [{ role: 'user', content: 'x' }]);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).model).toBe('glm-5.3-flash');
  });
});

describe('RoutingDriver', () => {
  function makeFakeDriver(tag: string, opts: { fail?: Error; models?: string[] } = {}): ArenaDriver {
    return {
      listModels: vi.fn().mockResolvedValue(opts.models ?? [`${tag}-model`]),
      sendMessage: vi
        .fn()
        .mockRejectedValue(opts.fail ?? new Error('should not be called on ' + tag)),
      close: vi.fn().mockResolvedValue(undefined),
    };
  }

  const alwaysTrue: (m: string) => boolean = () => true;
  const glmOnly = (m: string) => m.startsWith('glm-');

  it('routes glm-* to the zai-web route before arena', async () => {
    const zaiWeb = makeFakeDriver('zaiWeb');
    zaiWeb.sendMessage = vi.fn().mockResolvedValue('web-answer');
    const arena = makeFakeDriver('arena');

    const routing = new RoutingDriver([
      { name: 'zai-web', driver: zaiWeb, matches: glmOnly },
      { name: 'arena', driver: arena, matches: alwaysTrue },
    ]);
    const result = await routing.sendMessage('glm-5.3-flash', [{ role: 'user', content: 'hi' }]);

    expect(result).toBe('web-answer');
    expect(zaiWeb.sendMessage).toHaveBeenCalledTimes(1);
    expect(arena.sendMessage).not.toHaveBeenCalled();
  });

  it('routes non-GLM models straight to arena', async () => {
    const arena = makeFakeDriver('arena');
    arena.sendMessage = vi.fn().mockResolvedValue('arena-answer');
    const zaiWeb = makeFakeDriver('zaiWeb');

    const routing = new RoutingDriver([
      { name: 'zai-web', driver: zaiWeb, matches: glmOnly },
      { name: 'arena', driver: arena, matches: alwaysTrue },
    ]);
    await routing.sendMessage('auto', [{ role: 'user', content: 'hi' }]);
    await routing.sendMessage('gpt-4o', [{ role: 'user', content: 'hi' }]);

    expect(arena.sendMessage).toHaveBeenCalledTimes(2);
    expect(zaiWeb.sendMessage).not.toHaveBeenCalled();
  });

  it('falls back to the next matching route when the first fails', async () => {
    const zaiApi = makeFakeDriver('zaiApi');
    const zaiWeb = makeFakeDriver('zaiWeb');
    zaiWeb.sendMessage = vi.fn().mockResolvedValue('web-answer');
    const arena = makeFakeDriver('arena');

    const routing = new RoutingDriver([
      { name: 'zai-api', driver: zaiApi, matches: glmOnly },
      { name: 'zai-web', driver: zaiWeb, matches: glmOnly },
      { name: 'arena', driver: arena, matches: alwaysTrue },
    ]);
    const result = await routing.sendMessage('glm-5.3-flash', [{ role: 'user', content: 'hi' }]);

    expect(result).toBe('web-answer');
    expect(zaiApi.sendMessage).toHaveBeenCalledTimes(1);
    expect(zaiWeb.sendMessage).toHaveBeenCalledTimes(1);
    expect(arena.sendMessage).not.toHaveBeenCalled();
  });

  it('throws the last error when every matching route fails', async () => {
    const zaiApi = makeFakeDriver('zaiApi');
    const arena = makeFakeDriver('arena', { fail: new Error('arena boom') });

    const routing = new RoutingDriver([
      { name: 'zai-api', driver: zaiApi, matches: glmOnly },
      { name: 'arena', driver: arena, matches: alwaysTrue },
    ]);

    await expect(
      routing.sendMessage('glm-5.3-flash', [{ role: 'user', content: 'hi' }])
    ).rejects.toThrow('arena boom');
  });

  it('aborts immediately without falling back', async () => {
    const zaiApi = makeFakeDriver('zaiApi');
    zaiApi.sendMessage = vi.fn().mockRejectedValue(new Error('Request was aborted'));
    const arena = makeFakeDriver('arena');
    arena.sendMessage = vi.fn().mockResolvedValue('x');

    const routing = new RoutingDriver([
      { name: 'zai-api', driver: zaiApi, matches: glmOnly },
      { name: 'arena', driver: arena, matches: alwaysTrue },
    ]);

    await expect(
      routing.sendMessage('glm-5.3-flash', [{ role: 'user', content: 'hi' }])
    ).rejects.toThrow('Request was aborted');
    expect(arena.sendMessage).not.toHaveBeenCalled();
  });

  it('merges model lists in chain order without duplicates', async () => {
    const zaiWeb = makeFakeDriver('zaiWeb', { models: ['glm-5.3-flash', 'glm-4.6'] });
    const arena = makeFakeDriver('arena', { models: ['claude-3-5-sonnet', 'glm-4.6'] });

    const routing = new RoutingDriver([
      { name: 'zai-web', driver: zaiWeb, matches: glmOnly },
      { name: 'arena', driver: arena, matches: alwaysTrue },
    ]);
    const models = await routing.listModels();

    expect(models).toEqual(['glm-5.3-flash', 'glm-4.6', 'claude-3-5-sonnet']);
  });

  it('closes all drivers in the chain once', async () => {
    const zaiWeb = makeFakeDriver('zaiWeb');
    const arena = makeFakeDriver('arena');
    const routing = new RoutingDriver([
      { name: 'zai-web', driver: zaiWeb, matches: glmOnly },
      { name: 'arena', driver: arena, matches: alwaysTrue },
    ]);

    await routing.close();

    expect(arena.close).toHaveBeenCalledTimes(1);
    expect(zaiWeb.close).toHaveBeenCalledTimes(1);
  });
});

describe('z.ai config and helpers', () => {
  afterEach(() => {
    delete process.env.ZAI_API_KEY;
    delete process.env.ZAI_BASE_URL;
    delete process.env.ZAI_DEFAULT_MODEL;
  });

  it('loadConfig enables z.ai when ZAI_API_KEY env is set', () => {
    process.env.ZAI_API_KEY = 'test-key';
    const config = loadConfig();
    expect(config.zai).toBeDefined();
    expect(config.zai?.apiKey).toBe('test-key');
    expect(config.zai?.baseUrl).toBe('https://api.z.ai/api/paas/v4/');
    expect(config.zai?.defaultModel).toBe('glm-5.3-flash');
  });

  it('loadConfig leaves z.ai unset when no key', () => {
    const config = loadConfig();
    expect(config.zai).toBeUndefined();
  });

  it('loadConfig honors ZAI_BASE_URL and ZAI_DEFAULT_MODEL', () => {
    process.env.ZAI_API_KEY = 'k';
    process.env.ZAI_BASE_URL = 'https://example.com/v1';
    process.env.ZAI_DEFAULT_MODEL = 'glm-4.7-flash';
    const config = loadConfig();
    expect(config.zai?.baseUrl).toBe('https://example.com/v1');
    expect(config.zai?.defaultModel).toBe('glm-4.7-flash');
  });

  it('loadConfig enables the web-session provider via ZAI_WEB_ENABLED=1', () => {
    process.env.ZAI_WEB_ENABLED = '1';
    const config = loadConfig();
    expect(config.zaiWeb?.enabled).toBe(true);
    expect(config.zaiWeb?.baseUrl).toBe('https://chat.z.ai');
    expect(config.zaiWeb?.headless).toBe(false); // headed by default for manual captcha
    expect(config.zaiWeb?.userDataDir).toContain('zai-profile');
    delete process.env.ZAI_WEB_ENABLED;
  });

  it('web-session provider is disabled without env/override', () => {
    const config = loadConfig();
    expect(config.zaiWeb?.enabled).toBeFalsy();
  });

  it('isZaiModel detects GLM ids', () => {
    expect(isZaiModel('glm-5.3-flash')).toBe(true);
    expect(isZaiModel('glm-5.3')).toBe(true);
    expect(isZaiModel('GPT-4o')).toBe(false);
    expect(isZaiModel('claude-3-5-sonnet')).toBe(false);
    expect(isZaiModel('auto')).toBe(false);
  });
  it('normalizeZaiModel resolves aliases', () => {
    expect(normalizeZaiModel('glm')).toBe('glm-5.3-flash');
    expect(normalizeZaiModel('5.3-flash')).toBe('glm-5.3-flash');
    expect(normalizeZaiModel('glm-4.7-flash-20261022')).toBe('glm-4.7-flash');
    expect(normalizeZaiModel('glm-5.3')).toBe('glm-5.3');
  });

  it('ZAI catalog includes free models', () => {
    expect(ZAI_MODELS).toContain('glm-4.7-flash');
    expect(ZAI_MODELS).toContain('glm-4.5-flash');
  });
});
