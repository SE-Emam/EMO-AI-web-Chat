import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server/app.js';
import type { GatewayConfigFile, KeyAuthResult, RouterGroup } from '../../src/gateway/types.js';
import type { ArenaDriver } from '../../src/types.js';

describe('Key Scope Enforcement & Authorization Isolation', () => {
  const adminKey = 'emo_adm_test_master_key_123';
  const mcpKey = 'emo_mcp_test_client_key_456';
  const groupKey = 'emo_grp_test_router_key_789';
  const disabledKey = 'emo_dis_test_disabled_key_000';

  const mockGroup: RouterGroup = {
    id: 'group-fast',
    name: 'Fast Group',
    enabled: true,
    strategy: 'fallback',
    targets: [],
    apiKey: groupKey,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockConfig: GatewayConfigFile = {
    version: 1,
    gateway: {
      port: 8989,
      host: '127.0.0.1',
      requireApiKey: true,
      apiKey: adminKey,
      adminApiKey: adminKey,
      mcpApiKey: mcpKey,
      apiKeys: [
        { id: 'key-admin', name: 'Master', key: adminKey, scope: 'admin', enabled: true },
        { id: 'key-mcp-default', name: 'MCP', key: mcpKey, scope: 'mcp', enabled: true },
        { id: 'key-disabled', name: 'Disabled', key: disabledKey, scope: 'admin', enabled: false },
      ],
    },
    routerGroups: [mockGroup],
  };

  const mockDriver: ArenaDriver = {
    async sendMessage() {
      return { id: 'mock', content: 'hello', choices: [{ message: { role: 'assistant', content: 'hello' } }] };
    },
    async listModels() {
      return [{ id: 'Fast Group', name: 'Fast Group' }, { id: 'gpt-4o', name: 'gpt-4o' }];
    },
  };

  const mockManager: any = {
    resolveKeyAuth(key?: string): KeyAuthResult {
      if (!key) return { valid: false, scope: 'group', error: 'KEY_INVALID' };
      const clean = key.trim();
      if (clean === adminKey) return { valid: true, keyId: 'key-admin', scope: 'admin' };
      if (clean === mcpKey) return { valid: true, keyId: 'key-mcp-default', scope: 'mcp' };
      if (clean === groupKey) return { valid: true, keyId: 'group-fast', scope: 'group', scopedGroup: mockGroup };
      if (clean === disabledKey) return { valid: false, keyId: 'key-disabled', scope: 'admin', error: 'KEY_DISABLED' };
      return { valid: false, scope: 'group', error: 'KEY_INVALID' };
    },
    getValidApiKeys() {
      return [adminKey, mcpKey, groupKey];
    },
    getGroupForApiKey(k: string) {
      if (k === groupKey) return mockGroup;
      return undefined;
    },
    getActiveDriver() {
      return mockDriver;
    },
    listCustomProviders() {
      return [];
    },
    listCustomAgents() {
      return [];
    },
    getConfig() {
      return mockConfig;
    },
  };

  const mockTracker: any = {
    heartbeat() {},
    recordTokens() {},
    recordRequestStart() {
      return () => {};
    },
    recordRequestEnd() {},
    recordUsage() {},
  };

  let app: FastifyInstance;

  before(async () => {
    app = createServer({
      mode: 'gateway',
      manager: mockManager,
      tracker: mockTracker,
      gatewayConfig: mockConfig,
    });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  // --- 1. Gateway Management Routes (/api/gateway/*) ---
  test('Admin key can access management API (/api/gateway/heartbeat)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/gateway/heartbeat',
      headers: { Authorization: `Bearer ${adminKey}` },
    });
    assert.equal(res.statusCode, 200);
  });

  test('MCP key is blocked on management API with 403 INSUFFICIENT_SCOPE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/gateway/heartbeat',
      headers: { Authorization: `Bearer ${mcpKey}` },
    });
    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.equal(body.error.code, 'INSUFFICIENT_SCOPE');
  });

  test('Scoped router group key is blocked on management API with 403 INSUFFICIENT_SCOPE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/gateway/heartbeat',
      headers: { Authorization: `Bearer ${groupKey}` },
    });
    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.equal(body.error.code, 'INSUFFICIENT_SCOPE');
  });

  // --- 2. Unified MCP Endpoint (/mcp) ---
  test('MCP key can access MCP endpoint (/mcp)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { Authorization: `Bearer ${mcpKey}` },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.ok(body.result.tools);
  });

  test('Admin key is blocked on MCP endpoint (/mcp) with 403 INSUFFICIENT_SCOPE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { Authorization: `Bearer ${adminKey}` },
      payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    });
    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.equal(body.error.code, 'INSUFFICIENT_SCOPE');
  });

  test('Scoped router group key is blocked on MCP endpoint with 403 INSUFFICIENT_SCOPE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { Authorization: `Bearer ${groupKey}` },
      payload: { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
    });
    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.equal(body.error.code, 'INSUFFICIENT_SCOPE');
  });

  // --- 3. Model Completion Routes (/v1/chat/completions) ---
  test('Admin key can access model completions (/v1/chat/completions)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { Authorization: `Bearer ${adminKey}` },
      payload: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
    });
    assert.equal(res.statusCode, 200);
  });

  test('Scoped router group key can access model completions (/v1/chat/completions)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { Authorization: `Bearer ${groupKey}` },
      payload: { model: 'Fast Group', messages: [{ role: 'user', content: 'hi' }] },
    });
    assert.equal(res.statusCode, 200);
  });

  test('MCP key is blocked on model completions with 403 INSUFFICIENT_SCOPE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { Authorization: `Bearer ${mcpKey}` },
      payload: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
    });
    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.equal(body.error.code, 'INSUFFICIENT_SCOPE');
  });

  // --- 4. Invalid and Disabled Keys ---
  test('Disabled key is rejected with 401 Unauthorized', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { Authorization: `Bearer ${disabledKey}` },
      payload: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
    });
    assert.equal(res.statusCode, 401);
  });

  test('Revoked or legacy key (emo.web) is rejected with 401 Unauthorized', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/gateway/heartbeat',
      headers: { Authorization: 'Bearer emo.web' },
    });
    assert.equal(res.statusCode, 401);
  });
});
