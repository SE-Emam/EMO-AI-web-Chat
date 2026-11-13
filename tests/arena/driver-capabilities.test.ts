/**
 * Task 13 — driver capabilities matrix (TDD: failing first).
 *
 * Owner locked decisions implemented here:
 *  - DriverCapabilities declares the session pattern as an explicit value
 *    ('per-session-page' | 'serialized-per-session' | 'single-session-only' |
 *    'unsupported') — NOT bare booleans;
 *  - a driver that cannot isolate/restore either implements a SAFE path or
 *    refuses multi-session use — it must NEVER silently ignore sessionKey;
 *  - the matrix (docs/provider-capabilities.md) is filled from code +
 *    runnable tests, not assumptions.
 *
 * No browser is launched and no real account is touched: these driver
 * constructors only store config, and sessionKey threading is asserted via
 * a stubbed serialized layer.
 */
import { describe, it, expect, vi } from 'vitest';
import { ZaiWebDriver } from '../../src/arena/zai-web-driver.js';
import { QwenWebDriver } from '../../src/arena/qwen-web-driver.js';
import { GeminiWebDriver } from '../../src/arena/gemini-web-driver.js';
import { ClaudeWebDriver } from '../../src/arena/claude-web-driver.js';
import { TencentAiWebDriver } from '../../src/arena/tencent-ai-web-driver.js';
import { ChatGPTWebDriver } from '../../src/arena/web-drivers.js';
import {
  SerializedSessionSendQueue,
  type DriverCapabilities,
} from '../../src/arena/driver-capabilities.js';
import type { ChatMessage } from '../../src/types.js';

const webCfg = (userDataDir = '/tmp/emo-cap-profile') => ({
  enabled: true,
  userDataDir,
  baseUrl: '',
  headless: true,
  timeoutMs: 30_000,
} as any);

const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'hi' }];

const expectCapabilities = (caps: DriverCapabilities | undefined, expected: Partial<DriverCapabilities>) => {
  expect(caps).toBeDefined();
  expect(caps!.sessionSupport).toBe(expected.sessionSupport);
  expect(caps!.persistentConversation).toBe(expected.persistentConversation);
  expect(caps!.streaming).toBe(expected.streaming);
  expect(caps!.toolCalling).toBe(expected.toolCalling);
  expect(typeof caps!.notes).toBe('string');
  expect(caps!.notes.length).toBeGreaterThan(0);
};

describe('driver capabilities declarations (Task 13)', () => {
  it('standalone single-page drivers (zai/qwen/gemini/claude) declare serialized-per-session, no web-side persistence', () => {
    for (const driver of [
      new ZaiWebDriver(webCfg()),
      new QwenWebDriver(webCfg()),
      new GeminiWebDriver(webCfg()),
      new ClaudeWebDriver(webCfg()),
    ]) {
      expectCapabilities((driver as any).getCapabilities?.(), {
        sessionSupport: 'serialized-per-session',
        persistentConversation: false,
        streaming: true,
        toolCalling: false,
      });
    }
  });

  it('full-schedule drivers (chatgpt-web, tencent-ai-web) declare per-session-page WITH persistence', () => {
    expectCapabilities(new ChatGPTWebDriver(webCfg()).getCapabilities?.(), {
      sessionSupport: 'per-session-page',
      persistentConversation: true,
      streaming: true,
      toolCalling: false,
    });
    expectCapabilities(new TencentAiWebDriver(webCfg()).getCapabilities?.(), {
      sessionSupport: 'per-session-page',
      persistentConversation: true,
      streaming: true,
      toolCalling: false,
    });
  });

  it('standalone drivers ACCEPT sessionKey (no silent ignore): it reaches the serialized layer', async () => {
    for (const Driver of [ZaiWebDriver, QwenWebDriver, GeminiWebDriver, ClaudeWebDriver]) {
      const driver = new Driver(webCfg()) as any;
      const serialized = vi.fn(async () => 'ok');
      driver.sendMessageSerialized = serialized;
      await driver.sendMessage('model-x', MESSAGES, undefined, undefined, 'sess-A');
      const args = serialized.mock.calls[0];
      expect(args[args.length - 1]).toBe('sess-A'); // sessionKey threaded to the deepest layer
    }
  });

  it('SerializedSessionSendQueue: same session serializes; different sessions ALSO serialize (one shared page); results/errors propagate', async () => {
    const q = new SerializedSessionSendQueue();
    const order: string[] = [];
    const gate = { release: () => {} };
    let releaseFn!: () => void;
    const blocked = new Promise<void>((r) => (releaseFn = r));
    gate.release = releaseFn;

    const p1 = q.run('log', 'sess-1', async () => {
      order.push('s1-start');
      await blocked; // hold the lane
      order.push('s1-end');
      return 'one';
    });
    const p2 = q.run('log', 'sess-2', async () => {
      order.push('s2-start'); // must NOT appear before s1-end (single page!)
      return 'two';
    });
    const p3 = q.run('log', 'sess-1', async () => {
      order.push('s1b-start');
      return 'three';
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(order).toEqual(['s1-start']); // everything waits behind the shared page
    gate.release();
    expect(await p1).toBe('one');
    expect(await p2).toBe('two');
    expect(await p3).toBe('three');
    expect(order).toEqual(['s1-start', 's1-end', 's2-start', 's1b-start']);

    // Errors do not poison the lane.
    await expect(q.run('log', 's', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(q.run('log', 's', async () => 'after-error')).resolves.toBe('after-error');
  });
});
