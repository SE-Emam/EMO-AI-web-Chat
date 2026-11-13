import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GatewayConfigStore, defaultGatewayConfig } from '../../src/gateway/config-store.js';
import { ProviderManager } from '../../src/gateway/provider-manager.js';

describe('Multi-Account Provider Management', () => {
  let dir: string;
  let store: GatewayConfigStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-acc-'));
    store = new GatewayConfigStore(path.join(dir, 'gateway.json'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('adds, switches, and removes multiple accounts per provider', async () => {
    const config = defaultGatewayConfig();
    // Use fresh isolated dir for this provider
    config.providers['claude-web'].settings.userDataDir = path.join(dir, 'claude-fresh');
    config.providers['claude-web'].auth = undefined;
    config.providers['claude-web'].accounts = [];
    config.providers['claude-web'].activeAccountId = undefined;

    const mgr = new ProviderManager({ store, config });
    await mgr.init();

    // 1. Add first account
    let state = await mgr.addAccount('claude-web', {
      name: 'Work Account',
      email: 'work@example.com',
    });
    expect(state.accounts?.length).toBe(1);
    expect(state.accounts?.[0].email).toBe('work@example.com');
    expect(state.activeAccountId).toBe(state.accounts?.[0].id);

    // 2. Add second account
    state = await mgr.addAccount('claude-web', {
      name: 'Personal Account',
      email: 'personal@example.com',
    });
    expect(state.accounts?.length).toBe(2);
    const firstAccId = state.accounts![0].id;
    const secondAccId = state.accounts![1].id;

    // First account remains active
    expect(state.activeAccountId).toBe(firstAccId);

    // 3. Switch active account to second account
    state = await mgr.switchAccount('claude-web', secondAccId);
    expect(state.activeAccountId).toBe(secondAccId);
    expect(state.accountEmail).toBe('personal@example.com');

    // Verify written to disk
    const reloaded = await store.load();
    expect(reloaded.providers['claude-web'].activeAccountId).toBe(secondAccId);
    expect(reloaded.providers['claude-web'].accounts?.length).toBe(2);

    // 4. Remove second account (active) -> automatically falls back to first account
    state = await mgr.removeAccount('claude-web', secondAccId);
    expect(state.accounts?.length).toBe(1);
    expect(state.activeAccountId).toBe(firstAccId);
    expect(state.accountEmail).toBe('work@example.com');
  });
});
