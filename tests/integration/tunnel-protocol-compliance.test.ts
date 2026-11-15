import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import { OpenAiTunnelPoller, DedicatedMcpProxy } from '../../src/server/mcp-tunnel-server.js';

describe('Real Integration: OpenAI Secure Tunnel Protocol & Port Isolation', () => {
  let mockControlPlane: http.Server;
  let controlPlanePort: number;
  let localMcpApp: FastifyInstance;
  let localMcpPort: number;

  const tunnelId = 'tun_test_12345';
  const apiKey = 'sk-proj-testOpenAiKey123456';
  const expectedShardToken = 'shard_token_abc_xyz_789';

  const responsesReceived = new Map<string, { body: any; headers: http.IncomingHttpHeaders }>();
  let pollCount = 0;

  before(async () => {
    // 1. Mock Local MCP Server
    localMcpApp = Fastify({ logger: false });
    localMcpApp.post('/mcp', async (req) => {
      const body = req.body as any;
      if (body?.method === 'tools/list') {
        return { jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'read_file' }] } };
      }
      return { jsonrpc: '2.0', id: body?.id ?? 1, result: { content: 'Executed successfully' } };
    });
    await localMcpApp.listen({ port: 0, host: '127.0.0.1' });
    const mcpAddr = localMcpApp.server.address() as any;
    localMcpPort = mcpAddr.port;

    // 2. Mock OpenAI Control Plane
    mockControlPlane = http.createServer(async (req, res) => {
      const url = req.url || '';

      if (req.method === 'GET' && url.includes(`/v1/tunnels/${tunnelId}/poll`)) {
        pollCount++;
        // Verify capability header
        assert.equal(req.headers['x-tunnel-client-capabilities'], 'wrong-cluster-v1');
        assert.equal(req.headers['authorization'], `Bearer ${apiKey}`);

        if (pollCount === 1) {
          // Deliver JSON-RPC command
          res.writeHead(200, { 'Content-Type': 'application/json', 'x-tunnel-polling-token': 'token_alpha' });
          res.end(
            JSON.stringify({
              commands: [
                {
                  request_id: 'req_001',
                  shard_token: expectedShardToken,
                  command_type: 'jsonrpc',
                  channel: 'test-channel',
                  response_timeout: 30,
                  headers: { 'mcp-session-id': 'sess_123' },
                  jsonrpc: { jsonrpc: '2.0', id: 42, method: 'tools/list', params: {} },
                },
              ],
            })
          );
          return;
        }

        if (pollCount === 2) {
          // Deliver session termination command
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              commands: [
                {
                  request_id: 'req_002',
                  shard_token: 'shard_term_456',
                  command_type: 'session_termination',
                  response_timeout: 30,
                },
              ],
            })
          );
          return;
        }

        if (pollCount === 3) {
          // Deliver unknown command type
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              commands: [
                {
                  request_id: 'req_003',
                  shard_token: 'shard_unk_999',
                  command_type: 'unknown_vendor_op',
                  response_timeout: 30,
                },
              ],
            })
          );
          return;
        }

        // Subsequent polls: 204 No Content
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'POST' && url.includes(`/v1/tunnels/${tunnelId}/response`)) {
        const headers = req.headers;
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => {
          const body = JSON.parse(data);
          responsesReceived.set(body.request_id, { body, headers });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      mockControlPlane.listen(0, '127.0.0.1', () => {
        controlPlanePort = (mockControlPlane.address() as any).port;
        resolve();
      });
    });
  });

  after(async () => {
    await localMcpApp.close();
    await new Promise((r) => mockControlPlane.close(r));
  });

  const waitForResponse = async (reqId: string, maxWaitMs = 3000) => {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (responsesReceived.has(reqId)) {
        return responsesReceived.get(reqId)!;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`Timeout waiting for response to ${reqId}`);
  };

  test('OpenAI Tunnel Poller: executes JSON-RPC command and delivers response adhering to protocol.md', async () => {
    let currentStatus = 'stopped';
    const poller = new OpenAiTunnelPoller(
      tunnelId,
      apiKey,
      localMcpPort,
      `http://127.0.0.1:${controlPlanePort}`,
      undefined,
      (status) => {
        currentStatus = status;
      }
    );

    try {
      poller.start();

      // 1. Verify JSON-RPC execution and response
      const res1 = await waitForResponse('req_001');
      assert.equal(currentStatus, 'running');
      assert.equal(res1.body.request_id, 'req_001');
      assert.equal(res1.body.channel, 'test-channel');
      assert.equal(res1.body.resp_code, 200);
      assert.equal(res1.body.resp_type, 'jsonrpc');
      assert.deepEqual(res1.body.resp_json, {
        jsonrpc: '2.0',
        id: 42,
        result: { tools: [{ name: 'read_file' }] },
      });

      // CRITICAL PROTOCOL REQUIREMENTS:
      // a. Shard token MUST be sent in X-Tunnel-Shard-Token header
      assert.equal(res1.headers['x-tunnel-shard-token'], expectedShardToken);
      // b. Shard token MUST NOT be in JSON body
      assert.equal(res1.body.shard_token, undefined);
      // c. Capabilities header MUST be sent in response
      assert.equal(res1.headers['x-tunnel-client-capabilities'], 'wrong-cluster-v1');

      // 2. Verify Session Termination command handling
      const res2 = await waitForResponse('req_002');
      assert.equal(res2.body.request_id, 'req_002');
      assert.equal(res2.body.resp_type, 'session_termination');
      assert.equal(res2.headers['x-tunnel-shard-token'], 'shard_term_456');

      // 3. Verify Unknown Command Type rejection with 400
      const res3 = await waitForResponse('req_003');
      assert.equal(res3.body.request_id, 'req_003');
      assert.equal(res3.body.resp_code, 400);
      assert.equal(res3.body.resp_type, 'error');
    } finally {
      poller.stop();
    }
  });

  test('DedicatedMcpProxy: Exposes ONLY /mcp and /health, completely blocks management & completions', async () => {
    const proxy = new DedicatedMcpProxy();
    const proxyPort = await proxy.start(localMcpPort);
    assert.ok(proxyPort > 0);

    try {
      // 1. Health check: 200 OK
      const healthRes = await fetch(`http://127.0.0.1:${proxyPort}/health`);
      assert.equal(healthRes.status, 200);
      const healthBody = await healthRes.json();
      assert.equal(healthBody.ok, true);

      // 2. MCP request: 200 OK (proxied to backend)
      const mcpRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      assert.equal(mcpRes.status, 200);

      // 3. Management endpoint: 403 Forbidden
      const mgmtRes = await fetch(`http://127.0.0.1:${proxyPort}/api/gateway/heartbeat`);
      assert.equal(mgmtRes.status, 403);
      const mgmtBody = await mgmtRes.json();
      assert.match(mgmtBody.error.message, /TUNNEL_ACCESS_DENIED/);

      // 4. Model completion endpoint: 403 Forbidden
      const chatRes = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`);
      assert.equal(chatRes.status, 403);

      // 5. Dashboard UI: 403 Forbidden
      const uiRes = await fetch(`http://127.0.0.1:${proxyPort}/`);
      assert.equal(uiRes.status, 403);

      // 6. Header spoofing attack: Sending Host: localhost, CF-Ray, etc. cannot bypass isolation
      const spoofedRes = await fetch(`http://127.0.0.1:${proxyPort}/api/gateway/approvals`, {
        headers: {
          Host: 'localhost',
          'X-Forwarded-Host': '127.0.0.1',
          'CF-Ray': 'fake-cf-ray',
          'CF-Connecting-IP': '127.0.0.1',
        },
      });
      assert.equal(spoofedRes.status, 403);
    } finally {
      proxy.stop();
    }
  });
});
