import { describe, it, expect } from 'vitest';
import {
  discoverProviderModels,
  applyDiscoveryToSelection,
  normalizeModelIds,
} from '../../src/gateway/provider-model-discovery.js';
import type { ArenaDriver, ChatMessage } from '../../src/types.js';

function driverWith(models: string[] | (() => Promise<string[]>)): ArenaDriver {
  return {
    async listModels() {
      return typeof models === 'function' ? await models() : models;
    },
    async sendMessage(_m: string, _msg: ChatMessage[]) {
      return '';
    },
    async close() {},
  } as ArenaDriver;
}

describe('Provider model discovery', () => {
  it('reads the adapter catalog and REPLACES the previous list (stale ids disappear)', async () => {
    const outcome = await discoverProviderModels({
      providerId: 'gemini-web',
      driver: driverWith(['gemini-web:default', 'gemini-web:new']),
      previousAvailable: ['gemini-web:default', 'gemini-web:removed'],
      previousSelected: ['gemini-web:default'],
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.models).toEqual(['gemini-web:default', 'gemini-web:new']);
    expect(outcome.models).not.toContain('gemini-web:removed');
    expect(outcome.removedModels).toEqual(['gemini-web:removed']);
    expect(outcome.source).toBe('configured-catalog');
    expect(outcome.mode).toBe('configured-catalog');
    expect(outcome.discoveredAt).toBeTruthy();
  });

  it('keeps the selection while the model is available and prunes it when it is gone', async () => {
    const outcome = await discoverProviderModels({
      providerId: 'gemini-web',
      driver: driverWith(['gemini-web:default']),
      previousSelected: ['gemini-web:default', 'gemini-web:gone'],
    });
    expect(outcome.keptSelected).toEqual(['gemini-web:default']);
    expect(outcome.droppedSelected).toEqual(['gemini-web:gone']);
  });

  it('fails (and keeps the last good list) when the adapter returns an empty catalog', async () => {
    const outcome = await discoverProviderModels({
      providerId: 'gemini-web',
      driver: driverWith([]),
      previousAvailable: ['gemini-web:default'],
      previousSelected: ['gemini-web:default'],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/empty/i);
    expect(outcome.keptSelected).toEqual(['gemini-web:default']);
    expect(outcome.models).toEqual([]);
  });

  it('fails when the adapter throws, without pretending success', async () => {
    const outcome = await discoverProviderModels({
      providerId: 'gemini-web',
      driver: driverWith(async () => {
        throw new Error('selector missing');
      }),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/selector missing/i);
    expect(outcome.count).toBe(0);
  });

  it('fails with a timeout error when the adapter hangs', async () => {
    const outcome = await discoverProviderModels({
      providerId: 'gemini-web',
      timeoutMs: 1000,
      driver: driverWith(() => new Promise<string[]>(() => {})),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/timed out/i);
    expect(outcome.failureCode).toBe('NETWORK_TIMEOUT');
  });

  it('fails when the adapter is not available at all', async () => {
    const outcome = await discoverProviderModels({ providerId: 'gemini-web', driver: null });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/adapter/i);
  });

  it('rejects a malformed model list instead of storing invented ids', () => {
    expect(normalizeModelIds(['', '  ', 'ok-model', 42, null, 'ok-model'])).toEqual(['ok-model']);
    expect(normalizeModelIds('not-an-array')).toEqual([]);
    expect(normalizeModelIds(['x'.repeat(200)])).toEqual([]);
  });

  it('computes the selection intersection deterministically', () => {
    const r = applyDiscoveryToSelection(['a', 'b'], ['b', 'c', 'b']);
    expect(r.selected).toEqual(['b']);
    expect(r.keptSelected).toEqual(['b']);
    expect(r.droppedSelected).toEqual(['c']);
  });

  it('does not invent a discovery for an API provider routed through the wrong path', async () => {
    const outcome = await discoverProviderModels({ providerId: 'custom_xyz', driver: driverWith(['a']) });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/upstream models endpoint/i);
  });
});
