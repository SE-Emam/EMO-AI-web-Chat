import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  GatewayConfigStore,
  isLegacyInsecureKey,
  migrateConfigKeys,
} from '../../src/gateway/config-store.js';
import type { GatewayConfigFile } from '../../src/gateway/types.js';

describe('Config Migration & Insecure Key Revocation', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'emo-cfg-mig-'));
    configPath = path.join(tmpDir, 'gateway.json');
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  test('isLegacyInsecureKey correctly detects insecure static tokens', () => {
    assert.equal(isLegacyInsecureKey('emo.web'), true);
    assert.equal(isLegacyInsecureKey('sk-local'), true);
    assert.equal(isLegacyInsecureKey('default'), true);
    assert.equal(isLegacyInsecureKey('emo.ai'), true);

    // Cryptographic keys are not insecure legacy keys
    assert.equal(isLegacyInsecureKey('emo_adm_1234567890abcdef'), false);
    assert.equal(isLegacyInsecureKey('emo_mcp_1234567890abcdef'), false);
    assert.equal(isLegacyInsecureKey(''), false);
    assert.equal(isLegacyInsecureKey(undefined), false);
  });

  test('migrateConfigKeys automatically revokes emo.web and generates strong keys', () => {
    const legacyConfig = {
      gateway: {
        apiKey: 'emo.web',
        adminApiKey: 'emo.web',
        mcpApiKey: 'sk-local',
        apiKeys: [
          { id: 'old-1', name: 'Old Default', key: 'emo.web', scope: 'admin', enabled: true },
        ],
      },
    } as unknown as GatewayConfigFile;

    const { migrated, config } = migrateConfigKeys(legacyConfig);

    assert.equal(migrated, true);
    assert.ok(config.gateway.apiKey.startsWith('emo_adm_'));
    assert.ok(config.gateway.adminApiKey.startsWith('emo_adm_'));
    assert.ok(config.gateway.mcpApiKey.startsWith('emo_mcp_'));
    assert.notEqual(config.gateway.apiKey, 'emo.web');
    assert.notEqual(config.gateway.mcpApiKey, 'sk-local');

    // Insecure keys filtered out of apiKeys list
    assert.ok(!config.gateway.apiKeys.some((k) => k.key === 'emo.web'));
    assert.ok(!config.gateway.apiKeys.some((k) => k.key === 'sk-local'));

    // Admin and MCP keys added with correct scopes
    const adminEntry = config.gateway.apiKeys.find((k) => k.key === config.gateway.adminApiKey);
    const mcpEntry = config.gateway.apiKeys.find((k) => k.key === config.gateway.mcpApiKey);
    assert.ok(adminEntry);
    assert.equal(adminEntry.scope, 'admin');
    assert.ok(mcpEntry);
    assert.equal(mcpEntry.scope, 'mcp');
  });

  test('GatewayConfigStore.load() performs automatic migration and writes 0o600 backup', async () => {
    const legacyRaw = JSON.stringify({
      version: 1,
      gateway: {
        apiKey: 'emo.web',
        adminApiKey: 'emo.web',
      },
    }, null, 2);

    await fs.writeFile(configPath, legacyRaw, { encoding: 'utf8', mode: 0o600 });

    const store = new GatewayConfigStore(configPath);
    const loaded = await store.load();

    assert.ok(loaded.gateway.apiKey.startsWith('emo_adm_'));
    assert.notEqual(loaded.gateway.apiKey, 'emo.web');

    // Verify backup created
    const files = await fs.readdir(tmpDir);
    const backupFile = files.find((f) => f.includes('migration-backup'));
    assert.ok(backupFile, 'Migration backup file must be created');

    const backupStat = await fs.stat(path.join(tmpDir, backupFile));
    const mode = backupStat.mode & 0o777;
    assert.equal(mode, 0o600, 'Backup file must have 0o600 permissions');
  });
});
