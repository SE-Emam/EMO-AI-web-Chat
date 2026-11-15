import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server/app.js';
import type { ArenaDriver } from '../../src/types.js';

describe('Public Tunnel Exposure Isolation', () => {
  let app: FastifyInstance;

  // Mock driver
  const mockDriver: ArenaDriver = {
    async sendMessage() {
      return { id: 'mock', content: 'test', choices: [] };
    },
    async listModels() {
      return [];
    },
  };

  before(async () => {
    app = createServer(mockDriver);
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('Public tunnel request to /mcp is permitted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        host: 'random-subdomain.trycloudflare.com',
        'cf-connecting-ip': '203.0.113.195',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'ping' },
    });

    // 200 or 401 (if auth required) - but NOT 403 tunnel denied!
    assert.notEqual(res.statusCode, 403);
  });

  test('Public tunnel request to /health is permitted', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        host: 'random-subdomain.trycloudflare.com',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.ok(body.status === 'ok' || body.status === 'healthy');
  });

  test('Public tunnel request to /api/gateway/* is blocked with 403 Forbidden', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/gateway/config',
      headers: {
        host: 'random-subdomain.trycloudflare.com',
      },
    });

    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.equal(body.error.type, 'tunnel_access_denied');
    assert.ok(body.error.message.includes('TUNNEL_ACCESS_DENIED'));
  });

  test('Public tunnel request to /v1/chat/completions is blocked with 403 Forbidden', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'cf-ray': '8f1234567890-LHR',
        'content-type': 'application/json',
      },
      payload: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
    });

    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.equal(body.error.type, 'tunnel_access_denied');
  });

  test('Public tunnel request to management UI (/) is blocked with 403 Forbidden', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/',
      headers: {
        host: 'my-tunnel.ngrok-free.app',
      },
    });

    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.equal(body.error.type, 'tunnel_access_denied');
  });
});
