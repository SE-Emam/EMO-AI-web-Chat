import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { GatewayConfigStore, defaultGatewayConfig } from '../../src/gateway/config-store.js';
import { ProviderManager } from '../../src/gateway/provider-manager.js';
import { registerGatewayRoutes } from '../../src/server/gateway-routes.js';
import { globalApprovalManager } from '../../src/server/approval-manager.js';
import { globalHumanSessionManager } from '../../src/server/human-session.js';

describe('Real Fastify Integration: Human Session & CSRF Approval Hardening', () => {
  let tmpDir: string;
  let configStore: GatewayConfigStore;
  let manager: ProviderManager;
  let appApiKeyRequired: FastifyInstance;
  let appApiKeyDisabled: FastifyInstance;

  const adminKey = 'emo_adm_masterSecretKey123456789';
  const mcpKey = 'emo_mcp_clientSecretKey123456789';

  before(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'emo-human-session-test-'));
    const configPath = path.join(tmpDir, 'gateway.json');
    configStore = new GatewayConfigStore(configPath);

    const initialConfig = defaultGatewayConfig();
    initialConfig.gateway.apiKey = adminKey;
    initialConfig.gateway.adminApiKey = adminKey;
    initialConfig.gateway.mcpApiKey = mcpKey;
    initialConfig.gateway.requireApiKey = true;
    initialConfig.gateway.apiKeys = [
      { id: 'key-admin', name: 'Admin', key: adminKey, scope: 'admin' as const, enabled: true, createdAt: new Date().toISOString() },
      { id: 'key-mcp', name: 'MCP', key: mcpKey, scope: 'mcp' as const, enabled: true, createdAt: new Date().toISOString() },
    ];
    await configStore.save(initialConfig);
    manager = new ProviderManager({ store: configStore, config: initialConfig });
    await manager.init();

    // 1. Fastify app with requireApiKey = true
    appApiKeyRequired = Fastify({ logger: false });
    registerGatewayRoutes(appApiKeyRequired, {
      manager,
      tracker: {} as any,
      getGatewayConfig: () => manager.getConfig(),
      updateGatewayConfig: (cfg) => manager.updateConfig(cfg),
    });

    // 2. Fastify app with requireApiKey = false
    appApiKeyDisabled = Fastify({ logger: false });
    registerGatewayRoutes(appApiKeyDisabled, {
      manager,
      tracker: {} as any,
      getGatewayConfig: () => ({ ...manager.getConfig(), gateway: { ...manager.getConfig().gateway, requireApiKey: false } }),
      updateGatewayConfig: (cfg) => manager.updateConfig(cfg),
    });

    await appApiKeyRequired.ready();
    await appApiKeyDisabled.ready();
  });

  after(async () => {
    await appApiKeyRequired.close();
    await appApiKeyDisabled.close();
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  test('Attack 1: requireApiKey = true with MCP Key attempting approval is rejected', async () => {
    const req = globalApprovalManager.createRequest({
      toolName: 'exec_command',
      clientIdentity: 'agent:mcp',
      target: 'rm -rf /',
      args: { command: 'rm' },
    });

    const res = await appApiKeyRequired.inject({
      method: 'POST',
      url: `/api/gateway/approvals/${req.id}/approve`,
      headers: {
        authorization: `Bearer ${mcpKey}`,
      },
    });

    assert.equal(res.statusCode, 401);
    const body = res.json();
    assert.match(body.error.message, /HUMAN_SESSION_REQUIRED/);
  });

  test('Attack 2: requireApiKey = true with Admin Key but without human session is rejected', async () => {
    const req = globalApprovalManager.createRequest({
      toolName: 'delete_file',
      clientIdentity: 'agent:runner',
      target: 'config.json',
      args: { path: 'config.json' },
    });

    const res = await appApiKeyRequired.inject({
      method: 'POST',
      url: `/api/gateway/approvals/${req.id}/approve`,
      headers: {
        authorization: `Bearer ${adminKey}`,
      },
    });

    assert.equal(res.statusCode, 401);
    const body = res.json();
    assert.match(body.error.message, /HUMAN_SESSION_REQUIRED/);
  });

  test('Attack 3: requireApiKey = false without human session is strictly rejected', async () => {
    const req = globalApprovalManager.createRequest({
      toolName: 'write_file',
      clientIdentity: 'agent:writer',
      target: 'malicious.js',
      args: { path: 'malicious.js' },
    });

    const res = await appApiKeyDisabled.inject({
      method: 'POST',
      url: `/api/gateway/approvals/${req.id}/approve`,
      headers: {},
    });

    assert.equal(res.statusCode, 401);
    const body = res.json();
    assert.match(body.error.message, /HUMAN_SESSION_REQUIRED/);
  });

  test('Attack 4: Request body spoofing (actor: local_user) is rejected', async () => {
    const req = globalApprovalManager.createRequest({
      toolName: 'exec_command',
      clientIdentity: 'agent:test',
      target: 'echo hi',
      args: { command: 'echo' },
    });

    const res = await appApiKeyDisabled.inject({
      method: 'POST',
      url: `/api/gateway/approvals/${req.id}/approve`,
      body: { actor: 'local_user' },
    });

    assert.equal(res.statusCode, 401);
    assert.match(res.json().error.message, /HUMAN_SESSION_REQUIRED/);
  });

  test('Attack 5: Request body spoofing (actor: admin:master) is rejected', async () => {
    const req = globalApprovalManager.createRequest({
      toolName: 'exec_command',
      clientIdentity: 'agent:test',
      target: 'echo hi',
      args: { command: 'echo' },
    });

    const res = await appApiKeyDisabled.inject({
      method: 'POST',
      url: `/api/gateway/approvals/${req.id}/approve`,
      body: { actor: 'admin:master' },
    });

    assert.equal(res.statusCode, 401);
    assert.match(res.json().error.message, /HUMAN_SESSION_REQUIRED/);
  });

  test('Attack 6: Header spoofing (X-Client-Agent: local_admin) is rejected', async () => {
    const req = globalApprovalManager.createRequest({
      toolName: 'exec_command',
      clientIdentity: 'agent:test',
      target: 'echo hi',
      args: { command: 'echo' },
    });

    const res = await appApiKeyDisabled.inject({
      method: 'POST',
      url: `/api/gateway/approvals/${req.id}/approve`,
      headers: {
        'x-client-agent': 'local_admin',
      },
    });

    assert.equal(res.statusCode, 401);
    assert.match(res.json().error.message, /HUMAN_SESSION_REQUIRED/);
  });

  test('Attack 7: Agent attempting to use Admin API Key or MCP Key to create human session is rejected', async () => {
    const resBody = await appApiKeyRequired.inject({
      method: 'POST',
      url: '/api/gateway/session/login',
      body: { apiKey: adminKey },
    });
    assert.equal(resBody.statusCode, 403);
    assert.match(resBody.json().error.message, /AGENT_LOGIN_PROHIBITED/);

    const resHeader = await appApiKeyRequired.inject({
      method: 'POST',
      url: '/api/gateway/session/login',
      headers: { authorization: `Bearer ${adminKey}` },
    });
    assert.equal(resHeader.statusCode, 403);
    assert.match(resHeader.json().error.message, /AGENT_LOGIN_PROHIBITED/);

    const resMcp = await appApiKeyRequired.inject({
      method: 'POST',
      url: '/api/gateway/session/login',
      body: { apiKey: mcpKey },
    });
    assert.equal(resMcp.statusCode, 403);
    assert.match(resMcp.json().error.message, /AGENT_LOGIN_PROHIBITED/);
  });

  test('Attack 8: Cross-origin request (sec-fetch-site: cross-site) is rejected on session endpoints', async () => {
    const res = await appApiKeyRequired.inject({
      method: 'POST',
      url: '/api/gateway/session/login',
      headers: { 'sec-fetch-site': 'cross-site' },
      body: { passcode: globalHumanSessionManager.getLocalOperatorPasscode() },
    });
    assert.equal(res.statusCode, 403);
    assert.match(res.json().error.message, /CROSS_SITE_PROHIBITED/);
  });

  test('Attack 9: CSRF protection: Approval with valid session cookie but MISSING CSRF token fails with 403', async () => {
    const session = globalHumanSessionManager.createSession('human:local_operator');
    const sessionCookie = `emo_session_id=${session.id}`;

    const req = globalApprovalManager.createRequest({
      toolName: 'write_file',
      clientIdentity: 'agent:test',
      target: 'app.ts',
      args: { path: 'app.ts' },
    });

    const approveRes = await appApiKeyRequired.inject({
      method: 'POST',
      url: `/api/gateway/approvals/${req.id}/approve`,
      headers: {
        cookie: sessionCookie,
      },
    });

    assert.equal(approveRes.statusCode, 403);
    assert.match(approveRes.json().error.message, /CSRF_VALIDATION_FAILED/);
  });

  test('Attack 10: CSRF protection: Tampered CSRF token fails with 403', async () => {
    const session = globalHumanSessionManager.createSession('human:local_operator');
    const req = globalApprovalManager.createRequest({
      toolName: 'write_file',
      clientIdentity: 'agent:test',
      target: 'app.ts',
      args: { path: 'app.ts' },
    });

    const approveRes = await appApiKeyRequired.inject({
      method: 'POST',
      url: `/api/gateway/approvals/${req.id}/approve`,
      headers: {
        cookie: `emo_session_id=${session.id}`,
        'x-csrf-token': 'tampered_csrf_token_value_here',
      },
    });

    assert.equal(approveRes.statusCode, 403);
    assert.match(approveRes.json().error.message, /CSRF_VALIDATION_FAILED/);
  });

  test('Attack 11: CSRF token from another session is rejected with 403', async () => {
    const sessionA = globalHumanSessionManager.createSession('human:operator_a');
    const sessionB = globalHumanSessionManager.createSession('human:operator_b');

    const req = globalApprovalManager.createRequest({
      toolName: 'write_file',
      clientIdentity: 'agent:test',
      target: 'test.ts',
      args: { path: 'test.ts' },
    });

    const approveRes = await appApiKeyRequired.inject({
      method: 'POST',
      url: `/api/gateway/approvals/${req.id}/approve`,
      headers: {
        cookie: `emo_session_id=${sessionA.id}`,
        'x-csrf-token': sessionB.csrfToken,
      },
    });

    assert.equal(approveRes.statusCode, 403);
    assert.match(approveRes.json().error.message, /CSRF_VALIDATION_FAILED/);
  });

  test('Legitimate Flow: Interactive local operator login sets HttpOnly cookie without leaking sessionId in JSON, obtains CSRF via dedicated endpoint and approves', async () => {
    const passcode = globalHumanSessionManager.getLocalOperatorPasscode();
    const loginRes = await appApiKeyRequired.inject({
      method: 'POST',
      url: '/api/gateway/session/login',
      body: { passcode },
    });
    assert.equal(loginRes.statusCode, 200);
    const loginData = loginRes.json();
    assert.equal(loginData.ok, true);
    // Crucial: sessionId is NOT leaked in the JSON response body
    assert.equal(loginData.sessionId, undefined);
    assert.equal(loginData.csrfToken, undefined);

    const setCookie = loginRes.headers['set-cookie'] as string;
    assert.ok(setCookie);
    assert.match(setCookie, /emo_session_id=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);

    const match = setCookie.match(/emo_session_id=([a-f0-9]+)/);
    assert.ok(match);
    const cookie = `emo_session_id=${match[1]}`;

    // Obtain CSRF token securely via dedicated endpoint using HttpOnly cookie
    const csrfRes = await appApiKeyRequired.inject({
      method: 'GET',
      url: '/api/gateway/session/csrf',
      headers: { cookie },
    });
    assert.equal(csrfRes.statusCode, 200);
    const csrfToken = csrfRes.json().csrfToken;
    assert.ok(csrfToken);

    // Request approval
    const req = globalApprovalManager.createRequest({
      toolName: 'write_file',
      clientIdentity: 'agent:test',
      target: 'allowed.ts',
      args: { path: 'allowed.ts', content: 'export const x = 1;' },
    });

    const approveRes = await appApiKeyRequired.inject({
      method: 'POST',
      url: `/api/gateway/approvals/${req.id}/approve`,
      headers: {
        cookie,
        'x-csrf-token': csrfToken,
      },
    });

    assert.equal(approveRes.statusCode, 200);
    const body = approveRes.json();
    assert.equal(body.ok, true);
    assert.equal(body.approval.status, 'approved');
    assert.ok(body.approval.decisionBy.startsWith('human:local_operator:'));
  });

  test('Session lifecycle: Logout invalidates session immediately', async () => {
    const session = globalHumanSessionManager.createSession('human:local_operator');

    const logoutRes = await appApiKeyRequired.inject({
      method: 'POST',
      url: '/api/gateway/session/logout',
      headers: {
        cookie: `emo_session_id=${session.id}`,
      },
    });
    assert.equal(logoutRes.statusCode, 200);

    const req = globalApprovalManager.createRequest({
      toolName: 'exec_command',
      clientIdentity: 'agent:test',
      target: 'ls',
      args: { command: 'ls' },
    });

    const approveRes = await appApiKeyRequired.inject({
      method: 'POST',
      url: `/api/gateway/approvals/${req.id}/approve`,
      headers: {
        cookie: `emo_session_id=${session.id}`,
        'x-csrf-token': session.csrfToken,
      },
    });

    assert.equal(approveRes.statusCode, 401);
    assert.match(approveRes.json().error.message, /HUMAN_SESSION_EXPIRED|HUMAN_SESSION_REQUIRED/);
  });
});
