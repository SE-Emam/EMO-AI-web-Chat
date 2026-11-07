import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, Locator } from 'playwright';
import {
  DefaultArenaDriver,
  resolveModelAlias,
  formatMessages,
  KNOWN_ARENA_MODELS,
  DEFAULT_MODEL,
  ARENA_SELECTORS,
} from '../src/index.js';
import type { ChatMessage, Config } from '../src/types.js';
import { BrowserManager } from '../src/browser/manager.js';

interface MockLocatorOptions {
  count?: number;
  visible?: boolean;
  text?: string;
  texts?: string[];
  onFill?: (val: string) => void;
  onClick?: () => void;
}

function createMockLocator(opts: MockLocatorOptions = {}): Locator {
  const count = opts.count ?? 1;
  const visible = opts.visible ?? (count > 0);
  const text = opts.text ?? '';
  const texts = opts.texts ?? (text ? [text] : []);

  const loc: Partial<Locator> = {
    count: vi.fn().mockResolvedValue(count),
    isVisible: vi.fn().mockResolvedValue(visible),
    isEnabled: vi.fn().mockResolvedValue(true),
    innerText: vi.fn().mockResolvedValue(text),
    textContent: vi.fn().mockResolvedValue(text),
    allTextContents: vi.fn().mockResolvedValue(texts),
    fill: vi.fn().mockImplementation(async (val: string) => {
      opts.onFill?.(val);
    }),
    click: vi.fn().mockImplementation(async () => {
      opts.onClick?.();
    }),
    first: vi.fn().mockImplementation(() => loc as Locator),
    nth: vi.fn().mockImplementation(() => loc as Locator),
    locator: vi.fn().mockImplementation(() => loc as Locator),
    evaluate: vi.fn().mockResolvedValue(text),
  };

  return loc as unknown as Locator;
}

class FakePage {
  private currentUrl = 'about:blank';
  public locators = new Map<string, Locator>();
  public evaluations: Array<string | Function> = [];
  public gotoCalledWith: string | null = null;

  url(): string {
    return this.currentUrl;
  }

  async goto(url: string): Promise<null> {
    this.currentUrl = url;
    this.gotoCalledWith = url;
    return null;
  }

  setLocator(selector: string, locator: Locator) {
    this.locators.set(selector, locator);
  }

  locator(selector: string): Locator {
    if (this.locators.has(selector)) {
      return this.locators.get(selector)!;
    }
    // Return empty locator by default
    return createMockLocator({ count: 0, visible: false, text: '' });
  }

  async evaluate<R, Arg>(pageFunction: ((arg: Arg) => R) | string, arg?: Arg): Promise<R> {
    this.evaluations.push(pageFunction);
    if (typeof pageFunction === 'function') {
      return pageFunction(arg as Arg);
    }
    return undefined as unknown as R;
  }

  async waitForTimeout(_ms: number): Promise<void> {
    return Promise.resolve();
  }
}

describe('Arena Models & Aliases', () => {
  describe('resolveModelAlias', () => {
    it('returns DEFAULT_MODEL when given auto or default', () => {
      expect(resolveModelAlias('auto')).toBe(DEFAULT_MODEL);
      expect(resolveModelAlias('default')).toBe(DEFAULT_MODEL);
      expect(resolveModelAlias('')).toBe(DEFAULT_MODEL);
      expect(resolveModelAlias('   ')).toBe(DEFAULT_MODEL);
    });

    it('resolves exact known models in lower or mixed case', () => {
      expect(resolveModelAlias('gpt-4o')).toBe('gpt-4o');
      expect(resolveModelAlias('GPT-4O')).toBe('gpt-4o');
      expect(resolveModelAlias('claude-3-5-sonnet')).toBe('claude-3-5-sonnet');
      expect(resolveModelAlias('Claude-3-7-Sonnet')).toBe('claude-3-7-sonnet');
      expect(resolveModelAlias('deepseek-r1')).toBe('deepseek-r1');
    });

    it('strips provider prefixes', () => {
      expect(resolveModelAlias('openai/gpt-4o')).toBe('gpt-4o');
      expect(resolveModelAlias('anthropic/claude-3-5-sonnet')).toBe('claude-3-5-sonnet');
      expect(resolveModelAlias('deepseek-ai/deepseek-r1')).toBe('deepseek-r1');
      expect(resolveModelAlias('google/gemini-2.0-flash')).toBe('gemini-2.0-flash');
      expect(resolveModelAlias('meta-llama/llama-3.3-70b-instruct')).toBe('llama-3.3-70b-instruct');
    });

    it('strips date snapshots', () => {
      expect(resolveModelAlias('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet');
      expect(resolveModelAlias('claude-3-7-sonnet-20250219')).toBe('claude-3-7-sonnet');
      expect(resolveModelAlias('gpt-4o-2024-08-06')).toBe('gpt-4o');
      expect(resolveModelAlias('gpt-4o-mini-2024-07-18')).toBe('gpt-4o-mini');
    });

    it('normalizes dot notation to dashes', () => {
      expect(resolveModelAlias('claude-3.5-sonnet')).toBe('claude-3-5-sonnet');
      expect(resolveModelAlias('claude-3.7-sonnet')).toBe('claude-3-7-sonnet');
    });

    it('maps known aliases like deepseek-reasoner and o1-preview', () => {
      expect(resolveModelAlias('deepseek-reasoner')).toBe('deepseek-r1');
      expect(resolveModelAlias('deepseek-chat')).toBe('deepseek-v3');
      expect(resolveModelAlias('o1-preview')).toBe('o1');
      expect(resolveModelAlias('chatgpt-4o-latest')).toBe('gpt-4o');
    });

    it('falls back to cleaned name if unknown model', () => {
      expect(resolveModelAlias('custom/my-fine-tune-model')).toBe('my-fine-tune-model');
    });
  });

  describe('KNOWN_ARENA_MODELS', () => {
    it('contains major arena models', () => {
      expect(KNOWN_ARENA_MODELS).toContain('claude-3-5-sonnet');
      expect(KNOWN_ARENA_MODELS).toContain('claude-3-7-sonnet');
      expect(KNOWN_ARENA_MODELS).toContain('gpt-4o');
      expect(KNOWN_ARENA_MODELS).toContain('deepseek-r1');
      expect(KNOWN_ARENA_MODELS).toContain('gemini-2.0-flash');
      expect(KNOWN_ARENA_MODELS).toContain('qwen-2.5-max');
    });
  });
});

describe('Prompt Formatting (formatMessages)', () => {
  it('returns empty string for empty message list', () => {
    expect(formatMessages([])).toBe('');
  });

  it('returns plain content for a single user message without prefix', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'What is 2 + 2?' }];
    expect(formatMessages(messages)).toBe('What is 2 + 2?');
  });

  it('formats system prompt and single user message', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a concise mathematician.' },
      { role: 'user', content: 'What is 5 * 5?' },
    ];
    const formatted = formatMessages(messages);
    expect(formatted).toContain('System: You are a concise mathematician.');
    expect(formatted).toContain('User: What is 5 * 5?');
  });

  it('formats multi-turn conversation with User and Assistant labels', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Be helpful.' },
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there! How can I help?' },
      { role: 'user', content: 'Tell me a joke.' },
    ];
    const formatted = formatMessages(messages);
    expect(formatted).toBe(
      'System: Be helpful.\n\nUser: Hello!\n\nAssistant: Hi there! How can I help?\n\nUser: Tell me a joke.'
    );
  });
});

describe('Arena Selectors', () => {
  it('contains necessary selector groups', () => {
    expect(ARENA_SELECTORS.promptInput.length).toBeGreaterThan(0);
    expect(ARENA_SELECTORS.sendButton.length).toBeGreaterThan(0);
    expect(ARENA_SELECTORS.stopButton.length).toBeGreaterThan(0);
    expect(ARENA_SELECTORS.botMessage.length).toBeGreaterThan(0);
    expect(ARENA_SELECTORS.cloudflareChallenge.length).toBeGreaterThan(0);
  });
});

describe('DefaultArenaDriver', () => {
  let fakePage: FakePage;
  let mockBrowserManager: BrowserManager;
  let driver: DefaultArenaDriver;

  beforeEach(() => {
    fakePage = new FakePage();
    mockBrowserManager = {
      config: {
        port: 3000,
        host: '127.0.0.1',
        userDataDir: '/tmp/test-profile',
        arenaBaseUrl: 'https://arena.ai',
        headless: true,
      },
      getOrCreatePage: vi.fn().mockResolvedValue(fakePage as unknown as Page),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as BrowserManager;

    driver = new DefaultArenaDriver(mockBrowserManager);
  });

  describe('listModels', () => {
    it('returns known models list', async () => {
      const models = await driver.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models).toContain('claude-3-5-sonnet');
      expect(models).toContain('gpt-4o');
      expect(models).toContain('deepseek-r1');
    });
  });

  describe('sendMessage', () => {
    it('throws immediately if AbortSignal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        driver.sendMessage('gpt-4o', [{ role: 'user', content: 'Hello' }], undefined, controller.signal)
      ).rejects.toThrow(/abort/i);
    });

    it('detects Cloudflare challenge and throws informative error', async () => {
      // Mock Cloudflare challenge iframe present
      fakePage.setLocator(
        ARENA_SELECTORS.cloudflareChallenge[0],
        createMockLocator({ count: 1, visible: true })
      );

      await expect(
        driver.sendMessage('gpt-4o', [{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow(/Cloudflare Turnstile challenge detected.*webbridge login/i);
    });

    it('navigates to direct chat, fills prompt, clicks send, and streams chunks', async () => {
      let filledPrompt = '';
      let sendClicked = false;

      // Mock textarea
      fakePage.setLocator(
        ARENA_SELECTORS.promptInput[0],
        createMockLocator({
          count: 1,
          visible: true,
          onFill: (val) => {
            filledPrompt = val;
          },
        })
      );

      // Mock send button
      fakePage.setLocator(
        ARENA_SELECTORS.sendButton[0],
        createMockLocator({
          count: 1,
          visible: true,
          onClick: () => {
            sendClicked = true;
          },
        })
      );

      // Bot message locator simulation with stream chunks
      let callCount = 0;
      const chunks = ['Paris', ' is the capital', ' of France.'];
      const botLocator: Partial<Locator> = {
        count: vi.fn().mockResolvedValue(1),
        isVisible: vi.fn().mockResolvedValue(true),
        first: vi.fn().mockImplementation(() => botLocator as Locator),
        nth: vi.fn().mockImplementation(() => botLocator as Locator),
        innerText: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) return 'Paris';
          if (callCount === 2) return 'Paris is the capital';
          return 'Paris is the capital of France.';
        }),
      };
      fakePage.setLocator(ARENA_SELECTORS.botMessage[0], botLocator as unknown as Locator);

      // Stop button locator simulation (active during generation, absent when done)
      let stopCheckCount = 0;
      const stopLocator: Partial<Locator> = {
        count: vi.fn().mockImplementation(async () => (stopCheckCount < 3 ? 1 : 0)),
        isVisible: vi.fn().mockImplementation(async () => {
          stopCheckCount++;
          return stopCheckCount < 3;
        }),
      };
      fakePage.setLocator(ARENA_SELECTORS.stopButton[0], stopLocator as unknown as Locator);

      const receivedChunks: string[] = [];
      const onChunk = (chunk: string) => {
        receivedChunks.push(chunk);
      };

      const result = await driver.sendMessage(
        'claude-3-5-sonnet',
        [{ role: 'user', content: 'What is the capital of France?' }],
        onChunk
      );

      expect(fakePage.gotoCalledWith).toBe('https://arena.ai/text/direct');
      expect(filledPrompt).toBe('What is the capital of France?');
      expect(sendClicked).toBe(true);
      expect(result).toBe('Paris is the capital of France.');
      expect(receivedChunks.join('')).toBe('Paris is the capital of France.');
    });

    it('aborts during generation and attempts to click stop button', async () => {
      let stopClicked = false;
      const controller = new AbortController();

      // Mock textarea and send button
      fakePage.setLocator(
        ARENA_SELECTORS.promptInput[0],
        createMockLocator({ count: 1, visible: true })
      );
      fakePage.setLocator(
        ARENA_SELECTORS.sendButton[0],
        createMockLocator({ count: 1, visible: true })
      );

      // Mock stop button
      fakePage.setLocator(
        ARENA_SELECTORS.stopButton[0],
        createMockLocator({
          count: 1,
          visible: true,
          onClick: () => {
            stopClicked = true;
          },
        })
      );

      // Bot message locator that triggers abort on first innerText read
      const botLocator: Partial<Locator> = {
        count: vi.fn().mockResolvedValue(1),
        isVisible: vi.fn().mockResolvedValue(true),
        first: vi.fn().mockImplementation(() => botLocator as Locator),
        nth: vi.fn().mockImplementation(() => botLocator as Locator),
        innerText: vi.fn().mockImplementation(async () => {
          controller.abort();
          return 'Partial text before abort';
        }),
      };
      fakePage.setLocator(ARENA_SELECTORS.botMessage[0], botLocator as unknown as Locator);

      await expect(
        driver.sendMessage(
          'gpt-4o',
          [{ role: 'user', content: 'Long question' }],
          undefined,
          controller.signal
        )
      ).rejects.toThrow(/abort/i);

      expect(stopClicked).toBe(true);
    });

    it('clicks direct chat tab and selects model if present on page', async () => {
      let tabClicked = false;
      let dropdownClicked = false;
      let optionClicked = false;

      fakePage.setLocator(
        ARENA_SELECTORS.directChatTab[0],
        createMockLocator({
          count: 1,
          visible: true,
          onClick: () => {
            tabClicked = true;
          },
        })
      );

      fakePage.setLocator(
        ARENA_SELECTORS.modelDropdown[0],
        createMockLocator({
          count: 1,
          visible: true,
          onClick: () => {
            dropdownClicked = true;
          },
        })
      );

      fakePage.setLocator(
        ARENA_SELECTORS.dropdownOption('gpt-4o')[0],
        createMockLocator({
          count: 1,
          visible: true,
          onClick: () => {
            optionClicked = true;
          },
        })
      );

      fakePage.setLocator(
        ARENA_SELECTORS.promptInput[0],
        createMockLocator({ count: 1, visible: true })
      );

      fakePage.setLocator(
        ARENA_SELECTORS.sendButton[0],
        createMockLocator({ count: 1, visible: true })
      );

      // Bot message locator
      const botLocator: Partial<Locator> = {
        count: vi.fn().mockResolvedValue(1),
        isVisible: vi.fn().mockResolvedValue(true),
        first: vi.fn().mockImplementation(() => botLocator as Locator),
        nth: vi.fn().mockImplementation(() => botLocator as Locator),
        innerText: vi.fn().mockResolvedValue('Response'),
      };
      fakePage.setLocator(ARENA_SELECTORS.botMessage[0], botLocator as unknown as Locator);

      // Stop locator - not generating
      fakePage.setLocator(
        ARENA_SELECTORS.stopButton[0],
        createMockLocator({ count: 0, visible: false })
      );

      const res = await driver.sendMessage('gpt-4o', [{ role: 'user', content: 'Hi' }]);
      expect(tabClicked).toBe(true);
      expect(dropdownClicked).toBe(true);
      expect(optionClicked).toBe(true);
      expect(res).toBe('Response');
    });

    it('falls back to pressing Enter on textarea when send button is not found', async () => {
      let enterPressed = false;

      const inputMock = createMockLocator({ count: 1, visible: true });
      (inputMock as any).press = vi.fn().mockImplementation(async (key: string) => {
        if (key === 'Enter') {
          enterPressed = true;
        }
      });
      fakePage.setLocator(ARENA_SELECTORS.promptInput[0], inputMock);

      // No send button
      for (const sel of ARENA_SELECTORS.sendButton) {
        fakePage.setLocator(sel, createMockLocator({ count: 0, visible: false }));
      }

      // Bot message locator
      const botLocator: Partial<Locator> = {
        count: vi.fn().mockResolvedValue(1),
        isVisible: vi.fn().mockResolvedValue(true),
        first: vi.fn().mockImplementation(() => botLocator as Locator),
        nth: vi.fn().mockImplementation(() => botLocator as Locator),
        innerText: vi.fn().mockResolvedValue('Enter response'),
      };
      fakePage.setLocator(ARENA_SELECTORS.botMessage[0], botLocator as unknown as Locator);

      const res = await driver.sendMessage('claude-3-5-sonnet', [
        { role: 'user', content: 'Test Enter' },
      ]);
      expect(enterPressed).toBe(true);
      expect(res).toBe('Enter response');
    });

    it('transmits formatted multi-turn messages into prompt textarea', async () => {
      let filledPrompt = '';

      fakePage.setLocator(
        ARENA_SELECTORS.promptInput[0],
        createMockLocator({
          count: 1,
          visible: true,
          onFill: (val) => {
            filledPrompt = val;
          },
        })
      );
      fakePage.setLocator(
        ARENA_SELECTORS.sendButton[0],
        createMockLocator({ count: 1, visible: true })
      );

      const botLocator: Partial<Locator> = {
        count: vi.fn().mockResolvedValue(1),
        isVisible: vi.fn().mockResolvedValue(true),
        first: vi.fn().mockImplementation(() => botLocator as Locator),
        nth: vi.fn().mockImplementation(() => botLocator as Locator),
        innerText: vi.fn().mockResolvedValue('Multi-turn response'),
      };
      fakePage.setLocator(ARENA_SELECTORS.botMessage[0], botLocator as unknown as Locator);

      await driver.sendMessage('claude-3-5-sonnet', [
        { role: 'system', content: 'You are an assistant.' },
        { role: 'user', content: 'Ping' },
        { role: 'assistant', content: 'Pong' },
        { role: 'user', content: 'Score?' },
      ]);

      expect(filledPrompt).toBe(
        'System: You are an assistant.\n\nUser: Ping\n\nAssistant: Pong\n\nUser: Score?'
      );
    });
  });

  describe('close', () => {
    it('delegates close to browser manager', async () => {
      await driver.close?.();
      expect(mockBrowserManager.close).toHaveBeenCalled();
    });
  });
});
