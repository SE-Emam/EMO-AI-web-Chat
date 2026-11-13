/**
 * Model diff engine — compares two snapshots and classifies the changes.
 *
 * Rules that are enforced here (not in the caller):
 *  - a PARTIAL scan never produces removals (absence is not evidence);
 *  - a removal must be confirmed by TWO consecutive complete scans before it
 *    is reported as removed (a temporarily missing model is not a deletion);
 *  - a model that comes back is reported as RESTORED, not as "added";
 *  - a rename is only claimed when the stable id is unchanged and only the
 *    display name moved; a display-name-only model is reported as UNCERTAIN;
 *  - metadata changes are only claimed for metadata we can actually compare.
 */
import type {
  DiscoveredWebModel,
  ModelChange,
  ModelDiffResult,
  ProviderModelSnapshot,
} from './types.js';

export interface DiffInput {
  providerId: string;
  previous: ProviderModelSnapshot | null;
  current: ProviderModelSnapshot;
  /**
   * Models that were missing in the PREVIOUS complete scan (missing once).
   * A model from this list that is still missing now has been missing in two
   * consecutive complete scans -> that is a confirmed removal.
   */
  pendingRemovals?: DiscoveredWebModel[];
  /**
   * Models whose removal has already been confirmed (kept for callers that
   * track the confirmation themselves).
   */
  confirmedRemovals?: string[];
  /** True when the current scan was complete. */
  complete: boolean;
  now?: () => number;
}

function key(model: DiscoveredWebModel): string {
  return model.providerModelId || `name:${model.displayName.toLowerCase()}`;
}

function sameMetadata(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
  const left = a || {};
  const right = b || {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const k of keys) {
    if (JSON.stringify(left[k] ?? null) !== JSON.stringify(right[k] ?? null)) return false;
  }
  return true;
}

/**
 * Computes the change list between two snapshots.
 */
export function diffSnapshots(input: DiffInput): ModelDiffResult {
  const now = input.now ?? Date.now;
  const detectedAt = new Date(now()).toISOString();
  const { previous, current } = input;
  const complete = input.complete && current.completeness === 'complete';

  if (!previous) {
    // Baseline scan: the list becomes the reference, nothing is "new" yet.
    return { providerId: input.providerId, changes: [], complete, isBaseline: true, detectedAt };
  }

  const changes: ModelChange[] = [];
  const previousByKey = new Map(previous.models.map((m) => [key(m), m]));
  const currentByKey = new Map(current.models.map((m) => [key(m), m]));
  const pendingModels = input.pendingRemovals || [];
  const pendingKeys = new Set(pendingModels.map((m) => key(m)));
  const confirmed = new Set(input.confirmedRemovals || []);

  // --- Added / Restored -------------------------------------------------
  for (const [id, model] of currentByKey) {
    if (previousByKey.has(id)) continue;
    const wasPending = pendingKeys.has(id);
    changes.push({
      providerId: input.providerId,
      type: wasPending ? 'model_restored' : 'model_added',
      providerModelId: model.providerModelId,
      displayName: model.displayName,
      detectedAt,
      evidence: wasPending
        ? 'The model was missing in the previous complete scan and is listed again now.'
        : 'The model is not present in the previous snapshot.',
    });
  }

  // --- Removed ---------------------------------------------------------
  // A removal is only claimed from a COMPLETE scan, and only for a model
  // that was already missing in the previous complete scan (two consecutive
  // complete scans). A model that simply is not in the snapshot yet (it was
  // already dropped after the first missing scan) is taken from the pending
  // list, which is exactly the "missing twice" evidence.
  if (complete) {
    const reported = new Set<string>();
    for (const model of pendingModels) {
      const id = key(model);
      if (currentByKey.has(id)) continue; // it came back -> restored
      if (reported.has(id)) continue;
      reported.add(id);
      changes.push({
        providerId: input.providerId,
        type: 'model_removed',
        providerModelId: model.providerModelId,
        displayName: model.displayName,
        detectedAt,
        evidence: confirmed.has(id)
          ? 'The model was missing in two consecutive complete scans.'
          : 'The model was missing in the previous complete scan and is still missing.',
      });
    }
    // Models that were present in the snapshot and are gone now, and whose
    // removal was explicitly confirmed by the caller.
    for (const [id, model] of previousByKey) {
      if (currentByKey.has(id)) continue;
      if (!confirmed.has(id)) continue;
      if (reported.has(id)) continue;
      reported.add(id);
      changes.push({
        providerId: input.providerId,
        type: 'model_removed',
        providerModelId: model.providerModelId,
        displayName: model.displayName,
        detectedAt,
        evidence: 'The model is no longer listed by the provider.',
      });
    }
  }

  // --- Renamed / metadata changed --------------------------------------
  for (const [id, model] of currentByKey) {
    const before = previousByKey.get(id);
    if (!before) continue;

    if (before.displayName !== model.displayName) {
      // A rename can only be claimed when the stable id is trustworthy.
      const stable = Boolean(model.providerModelId) && model.identityConfidence === 'stable-id';
      changes.push({
        providerId: input.providerId,
        type: 'model_renamed',
        providerModelId: model.providerModelId,
        displayName: model.displayName,
        previousDisplayName: before.displayName,
        detectedAt,
        uncertain: !stable,
        evidence: stable
          ? 'The stable model id is unchanged and only the display name moved.'
          : 'Only the display name changed and the model has no stable id — the rename cannot be confirmed.',
      });
    }

    if (!sameMetadata(before.metadata, model.metadata)) {
      changes.push({
        providerId: input.providerId,
        type: 'model_metadata_changed',
        providerModelId: model.providerModelId,
        displayName: model.displayName,
        previousDisplayName: before.displayName,
        previousMetadata: before.metadata,
        newMetadata: model.metadata,
        detectedAt,
        evidence: 'The provider exposes different metadata for this model.',
      });
    }
  }

  return { providerId: input.providerId, changes, complete, isBaseline: false, detectedAt };
}

/**
 * Tracks models that were missing in the previous COMPLETE scan. A model is
 * only reported as removed after it was missing twice in a row.
 *
 * The pending set keeps the MODEL (not just its id) so the change report can
 * still name a model that has already disappeared from the stored snapshot.
 */
export class RemovalConfirmation {
  private readonly pending = new Map<string, Map<string, DiscoveredWebModel>>();

  private bucket(providerId: string): Map<string, DiscoveredWebModel> {
    let b = this.pending.get(providerId);
    if (!b) {
      b = new Map<string, DiscoveredWebModel>();
      this.pending.set(providerId, b);
    }
    return b;
  }

  /**
   * Records the models that are missing from a complete scan.
   * Returns the models whose removal is now CONFIRMED (missing twice).
   */
  observe(providerId: string, missing: DiscoveredWebModel[]): DiscoveredWebModel[] {
    const bucket = this.bucket(providerId);
    const confirmed: DiscoveredWebModel[] = [];
    for (const model of missing) {
      const id = key(model);
      if (bucket.has(id)) {
        confirmed.push(model);
        bucket.delete(id);
      } else {
        bucket.set(id, model);
      }
    }
    return confirmed;
  }

  /** The models that are missing but not confirmed yet. */
  pendingFor(providerId: string): DiscoveredWebModel[] {
    return [...this.bucket(providerId).values()];
  }

  /** Clears the pending state for models that are back. */
  reconcile(providerId: string, present: DiscoveredWebModel[]): void {
    const bucket = this.bucket(providerId);
    for (const model of present) bucket.delete(key(model));
  }

  reset(): void {
    this.pending.clear();
  }
}
