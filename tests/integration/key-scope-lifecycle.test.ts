import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { GatewayConfigStore, defaultGatewayConfig, migrateConfigKeys } from '../../src/gateway/config-store.js';
import { ProviderManager } from '../../src/gateway/provider-manager.js';
import type { ApiKeyItem, GatewayConfigFile, RouterGroup } from '../../src/gateway/types.js';

describe('Real Integration: API Key Scopes, Expiration & Lifecycle Verification', () => {
  let tmpDir: string;
  let configStore: GatewayConfigStore;
  let manager: ProviderManager;

  const validAdminKey = 'emo_adm_validAdminKey_111';
  const validMcpKey = 'emo_mcp_validMcpKey_222';
  const validAllKey = 'emo_all_validAllKey_333';
  const validGroupKey = 'emo_grp_validGroupKey_444';
  const expiredKey = 'emo_exp_expiredKey_555';
  const disabledKey = 'emo_dis_disabledKey_666';
  const missingScopeKey = 'emo_raw_missingScopeKey_777';
  const unknownScopeKey = 'emo_unk_unknownScopeKey_888';
  const invalidDateKey = 'emo_inv_invalidDateKey_999';

  before(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'emo-keys-test-'));
    const configPath = path.join(tmpDir, 'gateway.json');
    configStore = new GatewayConfigStore(configPath);

    const pastDate = new Date(Date.now() - 100_000).toISOString();
    const futureDate = new Date(Date.now() + 100_000).toISOString();

    const config: GatewayConfigFile = defaultGatewayConfig();
    config.gateway.apiKey = validAdminKey;
    config.gateway.adminApiKey = validAdminKey;
    config.gateway.mcpApiKey = validMcpKey;

    const routerGroup: RouterGroup = {
      id: 'grp-test',
      name: 'Test Group',
      enabled: true,
      strategy: 'fallback',
      targets: [{ id: 't1', kind: 'web', providerId: 'zai-web', model: 'glm-4.5-flash', weight: 1, priority: 1, enabled: true }],
      apiKey: validGroupKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    config.routerGroups = [routerGroup];

    config.gateway.apiKeys = [
      { id: 'k-admin', name: 'Admin Key', key: validAdminKey, scope: 'admin', enabled: true, createdAt: new Date().toISOString() },
      { id: 'k-mcp', name: 'MCP Key', key: validMcpKey, scope: 'mcp', enabled: true, createdAt: new Date().toISOString() },
      { id: 'k-all', name: 'All Scope Key', key: validAllKey, scope: 'all', enabled: true, createdAt: new Date().toISOString() },
      { id: 'k-exp', name: 'Expired Key', key: expiredKey, scope: 'admin', enabled: true, expiresAt: pastDate, createdAt: new Date().toISOString() },
      { id: 'k-dis', name: 'Disabled Key', key: disabledKey, scope: 'admin', enabled: false, createdAt: new Date().toISOString() },
      { id: 'k-missing', name: 'Missing Scope Key', key: missingScopeKey, enabled: true, createdAt: new Date().toISOString() } as any,
      { id: 'k-unknown', name: 'Unknown Scope Key', key: unknownScopeKey, scope: 'super_admin' as any, enabled: true, createdAt: new Date().toISOString() },
      { id: 'k-invdate', name: 'Invalid Date Key', key: invalidDateKey, scope: 'admin', enabled: true, expiresAt: 'not-a-valid-date', createdAt: new Date().toISOString() },
    ];

    await configStore.save(config);
    manager = new ProviderManager({ store: configStore, config });
    await manager.init();
  });

  after(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  test('Explicit Admin scope is resolved correctly', () => {
    const res = manager.resolveKeyAuth(validAdminKey);
    assert.equal(res.valid, true);
    assert.equal(res.scope, 'admin');
    assert.equal(res.keyId, 'k-admin');
  });

  test('Explicit MCP scope is resolved correctly', () => {
    const res = manager.resolveKeyAuth(validMcpKey);
    assert.equal(res.valid, true);
    assert.equal(res.scope, 'mcp');
    assert.equal(res.keyId, 'k-mcp');
  });

  test('Explicit All scope is resolved correctly', () => {
    const res = manager.resolveKeyAuth(validAllKey);
    assert.equal(res.valid, true);
    assert.equal(res.scope, 'all');
    assert.equal(res.keyId, 'k-all');
  });

  test('Scoped Router Group key is resolved correctly', () => {
    const res = manager.resolveKeyAuth(validGroupKey);
    assert.equal(res.valid, true);
    assert.equal(res.scope, 'group');
    assert.equal(res.keyId, 'group-grp-test');
  });

  test('Missing scope is strictly rejected (No default admin!)', () => {
    const res = manager.resolveKeyAuth(missingScopeKey);
    assert.equal(res.valid, false);
    assert.equal(res.error, 'KEY_INVALID');
  });

  test('Unknown scope is strictly rejected', () => {
    const res = manager.resolveKeyAuth(unknownScopeKey);
    assert.equal(res.valid, false);
    assert.equal(res.error, 'KEY_INVALID');
  });

  test('Expired key (expiresAt in past) is rejected with KEY_EXPIRED', () => {
    const res = manager.resolveKeyAuth(expiredKey);
    assert.equal(res.valid, false);
    assert.equal(res.error, 'KEY_EXPIRED');
  });

  test('Key with unparseable/corrupted expiresAt is rejected with KEY_EXPIRED', () => {
    const res = manager.resolveKeyAuth(invalidDateKey);
    assert.equal(res.valid, false);
    assert.equal(res.error, 'KEY_EXPIRED');
  });

  test('Disabled key (enabled: false) is rejected with KEY_DISABLED', () => {
    const res = manager.resolveKeyAuth(disabledKey);
    assert.equal(res.valid, false);
    assert.equal(res.error, 'KEY_DISABLED');
  });

  test('Revocation & deletion: deleteApiKey revokes key immediately and clears master bindings', async () => {
    const toDeleteKey = 'emo_adm_tempKeyToDelete_000';
    const created = await manager.addApiKey('Temp Key', toDeleteKey, 'admin');

    // Before deletion: valid
    assert.equal(manager.resolveKeyAuth(toDeleteKey).valid, true);

    // Perform deletion
    const ok = await manager.deleteApiKey(created.id);
    assert.equal(ok, true);

    // After deletion: immediately invalid
    const postRes = manager.resolveKeyAuth(toDeleteKey);
    assert.equal(postRes.valid, false);
    assert.equal(postRes.error, 'KEY_INVALID');
  });

  test('Disabled Router Group is rejected with KEY_DISABLED', async () => {
    const grp = manager.listRouterGroups().find((g) => g.id === 'grp-test');
    assert.ok(grp);
    await manager.updateRouterGroup('grp-test', { enabled: false });

    const res = manager.resolveKeyAuth(validGroupKey);
    assert.equal(res.valid, false);
    assert.equal(res.error, 'KEY_DISABLED');

    // Re-enable
    await manager.updateRouterGroup('grp-test', { enabled: true });
    assert.equal(manager.resolveKeyAuth(validGroupKey).valid, true);
  });

  test('Deduplication in config migration: duplicate keys are merged cleanly', () => {
    const cfg = defaultGatewayConfig();
    const dupKey = 'emo_sec_duplicate_token_123';
    cfg.gateway.apiKeys = [
      { id: 'k1', name: 'Key 1', key: dupKey, scope: 'admin', enabled: true, createdAt: new Date().toISOString() },
      { id: 'k2', name: 'Key 2 (Dup)', key: dupKey, scope: 'admin', enabled: true, createdAt: new Date().toISOString() },
    ];

    const { config: migrated } = migrateConfigKeys(cfg);
    const count = migrated.gateway.apiKeys?.filter((k) => k.key === dupKey).length;
    assert.equal(count, 1);
  });
});
