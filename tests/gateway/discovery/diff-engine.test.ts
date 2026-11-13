import { describe, it, expect } from 'vitest';
import { diffSnapshots, RemovalConfirmation } from '../../../src/gateway/discovery/diff-engine.js';
import type { DiscoveredWebModel, ProviderModelSnapshot } from '../../../src/gateway/discovery/types.js';

function model(id: string, name = id, metadata?: Record<string, unknown>): DiscoveredWebModel {
  return {
    providerModelId: id,
    displayName: name,
    metadata,
    identityConfidence: 'stable-id',
  };
}

function snapshot(providerId: string, models: ReturnType<typeof model>[], overrides: Partial<ProviderModelSnapshot> = {}): ProviderModelSnapshot {
  return {
    providerId,
    discoverySource: 'web-ui',
    discoveredAt: '2026-11-13T00:00:00.000Z',
    lastSuccessfulScanAt: '2026-11-13T00:00:00.000Z',
    snapshotVersion: 1,
    models,
    completeness: 'complete',
    snapshotHash: 'hash',
    ...overrides,
  };
}

describe('Model diff engine', () => {
  it('detects a NEW model', () => {
    const diff = diffSnapshots({
      providerId: 'claude-web',
      previous: snapshot('claude-web', [model('a')]),
      current: snapshot('claude-web', [model('a'), model('b')]),
      complete: true,
    });
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0].type).toBe('model_added');
    expect(diff.changes[0].providerModelId).toBe('b');
  });

  it('detects a REMOVED model (only when confirmed)', () => {
    const diff = diffSnapshots({
      providerId: 'claude-web',
      previous: snapshot('claude-web', [model('a'), model('b')]),
      current: snapshot('claude-web', [model('a')]),
      complete: true,
      confirmedRemovals: ['b'],
    });
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0].type).toBe('model_removed');
    expect(diff.changes[0].providerModelId).toBe('b');
  });

  it('does NOT report a removal that was not confirmed by two scans', () => {
    const diff = diffSnapshots({
      providerId: 'claude-web',
      previous: snapshot('claude-web', [model('a'), model('b')]),
      current: snapshot('claude-web', [model('a')]),
      complete: true,
      confirmedRemovals: [],
    });
    expect(diff.changes.filter((c) => c.type === 'model_removed')).toHaveLength(0);
  });

  it('never reports a removal from an INCOMPLETE scan', () => {
    const diff = diffSnapshots({
      providerId: 'claude-web',
      previous: snapshot('claude-web', [model('a'), model('b')]),
      current: snapshot('claude-web', [model('a')], { completeness: 'partial' }),
      complete: false,
      confirmedRemovals: ['b'],
    });
    expect(diff.changes.filter((c) => c.type === 'model_removed')).toHaveLength(0);
  });

  it('detects a RENAMED model (stable id, new display name)', () => {
    const diff = diffSnapshots({
      providerId: 'claude-web',
      previous: snapshot('claude-web', [model('claude-sonnet-5-5', 'Sonnet 5.5')]),
      current: snapshot('claude-web', [model('claude-sonnet-5-5', 'Sonnet 5.6')]),
      complete: true,
    });
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0].type).toBe('model_renamed');
    expect(diff.changes[0].previousDisplayName).toBe('Sonnet 5.5');
    expect(diff.changes[0].displayName).toBe('Sonnet 5.6');
    expect(diff.changes[0].uncertain).toBe(false);
  });

  it('marks a rename as uncertain when the model has no stable id', () => {
    const previous = snapshot('claude-web', [
      { providerModelId: undefined, displayName: 'Fast', identityConfidence: 'display-name-only' as const },
    ]);
    const current = snapshot('claude-web', [
      { providerModelId: undefined, displayName: 'Turbo', identityConfidence: 'display-name-only' as const },
    ]);
    const diff = diffSnapshots({ providerId: 'claude-web', previous, current, complete: true });
    // Without a stable id the "rename" cannot be attributed — it is not claimed.
    expect(diff.changes.filter((c) => c.type === 'model_renamed')).toHaveLength(0);
  });

  it('detects METADATA changes', () => {
    const diff = diffSnapshots({
      providerId: 'claude-web',
      previous: snapshot('claude-web', [model('a', 'A', { tier: 'standard' })]),
      current: snapshot('claude-web', [model('a', 'A', { tier: 'pro' })]),
      complete: true,
    });
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0].type).toBe('model_metadata_changed');
    expect(diff.changes[0].previousMetadata).toEqual({ tier: 'standard' });
    expect(diff.changes[0].newMetadata).toEqual({ tier: 'pro' });
  });

  it('detects a RESTORED model (it was missing and is back)', () => {
    const diff = diffSnapshots({
      providerId: 'claude-web',
      previous: snapshot('claude-web', [model('a')]),
      current: snapshot('claude-web', [model('a'), model('b')]),
      complete: true,
      pendingRemovals: [model('b')],
    });
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0].type).toBe('model_restored');
  });

  it('treats the FIRST scan as a baseline (no changes at all)', () => {
    const diff = diffSnapshots({
      providerId: 'claude-web',
      previous: null,
      current: snapshot('claude-web', [model('a'), model('b')]),
      complete: true,
    });
    expect(diff.isBaseline).toBe(true);
    expect(diff.changes).toHaveLength(0);
  });
});

describe('Removal confirmation', () => {
  it('confirms a removal only after two consecutive complete scans', () => {
    const state = new RemovalConfirmation();
    expect(state.observe('p', [model('x')])).toEqual([]);
    expect(state.observe('p', [model('x')])).toEqual([model('x')]);
  });

  it('does not confirm a model that came back', () => {
    const state = new RemovalConfirmation();
    state.observe('p', [model('x')]);
    state.reconcile('p', [model('x')]);
    expect(state.observe('p', [model('x')])).toEqual([]);
  });

  it('tracks the pending set per provider', () => {
    const state = new RemovalConfirmation();
    state.observe('p1', [model('x')]);
    state.observe('p2', [model('y')]);
    expect(state.pendingFor('p1')).toEqual([model('x')]);
    expect(state.pendingFor('p2')).toEqual([model('y')]);
  });

  it('forgets a model that is confirmed removed', () => {
    const state = new RemovalConfirmation();
    state.observe('p', [model('x')]);
    state.observe('p', [model('x')]);
    expect(state.pendingFor('p')).toEqual([]);
  });
});
