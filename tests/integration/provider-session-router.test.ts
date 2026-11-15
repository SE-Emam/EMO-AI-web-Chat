import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderSessionRouter } from '../../src/arena/provider-session-router.js';

describe('Real Integration: Provider Session Router & Turn Rotation', () => {
  test('Enforces a single active session per provider across sequential requests', () => {
    const router = new ProviderSessionRouter({ defaultMaxTurns: 5 });
    const provider = 'chatgpt-web';

    const session1 = router.getActiveSession(provider);
    assert.equal(session1.providerId, provider);
    assert.equal(session1.turnCount, 0);
    assert.equal(session1.status, 'active');

    const session2 = router.getActiveSession(provider);
    assert.equal(session1.sessionKey, session2.sessionKey);
    assert.equal(session2.status, 'active');
  });

  test('Tracks turn count and rotates conversation cleanly when maxTurns is reached', () => {
    const router = new ProviderSessionRouter({ defaultMaxTurns: 3 });
    const provider = 'claude-web';

    const initialSession = router.getActiveSession(provider);
    const initialKey = initialSession.sessionKey;

    // Turn 1
    assert.equal(router.shouldRotate(provider), false);
    router.recordTurn(provider, 'https://claude.ai/chat/123', 500);
    assert.equal(router.getActiveSession(provider).turnCount, 1);

    // Turn 2
    assert.equal(router.shouldRotate(provider), false);
    router.recordTurn(provider, 'https://claude.ai/chat/123', 600);
    assert.equal(router.getActiveSession(provider).turnCount, 2);

    // Turn 3 (reaches maxTurns: 3)
    router.recordTurn(provider, 'https://claude.ai/chat/123', 700);
    assert.equal(router.getActiveSession(provider).turnCount, 3);
    assert.equal(router.shouldRotate(provider), true);

    // Rotate session
    const { oldSession, newSession } = router.rotateSession(provider, 'turn_limit_reached');
    assert.equal(oldSession.sessionKey, initialKey);
    assert.equal(oldSession.status, 'rotated');
    assert.notEqual(newSession.sessionKey, initialKey);
    assert.equal(newSession.turnCount, 0);
    assert.equal(newSession.status, 'active');
    assert.equal(router.shouldRotate(provider), false);

    // Active session is now the new rotated session
    const currentSession = router.getActiveSession(provider);
    assert.equal(currentSession.sessionKey, newSession.sessionKey);
  });

  test('Concurrent requests maintain a single coherent active session', async () => {
    const router = new ProviderSessionRouter({ defaultMaxTurns: 20 });
    const provider = 'gemini-web';

    const results = await Promise.all(
      Array.from({ length: 15 }, async () => {
        return router.getActiveSessionKey(provider);
      })
    );

    const firstKey = results[0];
    for (const key of results) {
      assert.equal(key, firstKey);
    }
  });

  test('Different providers maintain completely isolated active sessions', () => {
    const router = new ProviderSessionRouter({ defaultMaxTurns: 10 });

    const keyChatGPT = router.getActiveSessionKey('chatgpt-web');
    const keyClaude = router.getActiveSessionKey('claude-web');
    const keyDeepSeek = router.getActiveSessionKey('deepseek-web');

    assert.notEqual(keyChatGPT, keyClaude);
    assert.notEqual(keyClaude, keyDeepSeek);
    assert.notEqual(keyChatGPT, keyDeepSeek);
  });

  test('Manual session close archives session and initiates a clean new session', () => {
    const router = new ProviderSessionRouter({ defaultMaxTurns: 10 });
    const provider = 'qwen-web';

    const sessionA = router.getActiveSession(provider);
    router.recordTurn(provider, 'https://chat.qwenlm.ai/c/1', 200);

    router.closeSession(provider);

    const sessionB = router.getActiveSession(provider);
    assert.notEqual(sessionA.sessionKey, sessionB.sessionKey);
    assert.equal(sessionB.turnCount, 0);
  });
});
