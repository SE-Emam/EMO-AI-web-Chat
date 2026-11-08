import { describe, it, expect } from 'vitest';
import { ZaiDriver } from '../src/arena/zai-driver.js';
import { DEFAULT_ZAI_BASE_URL } from '../src/config.js';

// Live Z.AI test — gated by ZAI_API_KEY. Skipped in CI / without a key.
const LIVE = !!process.env.ZAI_API_KEY;

describe.skipIf(!LIVE)('Z.AI live driver (gated)', () => {
  it('streams a short completion via api.z.ai', async () => {
    const driver = new ZaiDriver({
      apiKey: process.env.ZAI_API_KEY!,
      baseUrl: process.env.ZAI_BASE_URL || DEFAULT_ZAI_BASE_URL,
      defaultModel: process.env.ZAI_DEFAULT_MODEL || 'glm-5.3-flash',
      modelPrefixes: ['glm-'],
    });
    const chunks: string[] = [];
    const out = await driver.sendMessage(
      'glm-5.3-flash',
      [{ role: 'user', content: 'ping' }],
      (c) => chunks.push(c),
    );
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    expect(chunks.join('')).toBe(out);
  }, 60000);

  it('rejects invalid key with 401 mapped to authentication_error', async () => {
    const driver = new ZaiDriver({
      apiKey: 'definitely-invalid-key',
      baseUrl: DEFAULT_ZAI_BASE_URL,
      defaultModel: 'glm-5.3-flash',
      modelPrefixes: ['glm-'],
    });
    await expect(
      driver.sendMessage('glm-5.3-flash', [{ role: 'user', content: 'hi' }]),
    ).rejects.toMatchObject({ statusCode: 401 });
  }, 60000);
});
