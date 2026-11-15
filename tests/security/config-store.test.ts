import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  GatewayConfigStore,
  defaultGatewayConfig,
  generateSecureApiKey,
  maskApiKey,
} from '../../src/gateway/config-store.js';

describe('GatewayConfigStore Security & Resilience', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'emo-cfg-test-'));
    configPath = path.join(tmpDir, 'gateway.json');
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  test('generateSecureApiKey creates random keys with specified prefix and no hardcoded static tokens', () => {
    const adminKey = generateSecureApiKey('emo_adm_');
    const mcpKey = generateSecureApiKey('emo_mcp_');

    assert.ok(adminKey.startsWith('emo_adm_'));
    assert.ok(mcpKey.startsWith('emo_mcp_'));
    assert.ok(adminKey.length >= 32);
    assert.ok(mcpKey.length >= 32);
    assert.notEqual(adminKey, mcpKey);
    assert.notEqual(adminKey, 'emo.web');
    assert.notEqual(mcpKey, 'emo.web');
  });

  test('maskApiKey masks secrets safely without leaking full token', () => {
    assert.equal(maskApiKey(''), '[empty]');
    assert.equal(maskApiKey('short'), '[masked]');
    assert.equal(maskApiKey('emo_adm_1234567890abcdef'), 'emo_...cdef');
  });

  test('load() on non-existing file initializes secure default and saves with safe permissions', async () => {
    const store = new GatewayConfigStore(configPath);
    const cfg = await store.load();

    assert.ok(cfg.gateway.apiKey.startsWith('emo_adm_'));
    assert.ok(cfg.gateway.mcpApiKey?.startsWith('emo_mcp_'));
    assert.notEqual(cfg.gateway.apiKey, 'emo.web');

    const stat = await fs.stat(configPath);
    // On POSIX systems, verify file mode has no world/group read permissions (0600)
    const mode = stat.mode & 0o777;
    assert.equal(mode & 0o077, 0, 'Config file must not be group/world accessible');
  });

  test('load() on corrupted JSON halts safely, creates forensic backup, and does not overwrite secrets', async () => {
    await fs.writeFile(configPath, '{ "gateway": { "apiKey": "secret-never-lose", INVALID_JSON', 'utf8');

    const store = new GatewayConfigStore(configPath);
    await assert.rejects(
      async () => {
        await store.load();
      },
      /CORRUPTED_CONFIG/
    );

    // Verify a forensic backup file was generated
    const dirEntries = await fs.readdir(tmpDir);
    const backup = dirEntries.find((e) => e.startsWith('gateway.json.corrupted.'));
    assert.ok(backup, 'Forensic backup must be created');

    const backupContent = await fs.readFile(path.join(tmpDir, backup), 'utf8');
    assert.ok(backupContent.includes('secret-never-lose'));
  });

  test('persists generated keys on subsequent reloads', async () => {
    const store = new GatewayConfigStore(configPath);
    const cfg1 = await store.load();
    const store2 = new GatewayConfigStore(configPath);
    const cfg2 = await store2.load();

    assert.equal(cfg1.gateway.apiKey, cfg2.gateway.apiKey);
    assert.equal(cfg1.gateway.mcpApiKey, cfg2.gateway.mcpApiKey);
  });
});
