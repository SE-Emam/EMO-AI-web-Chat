/**
 * Provider model discovery — Providers & Models audit.
 *
 * A refresh must be a REAL operation with a REAL, explicit source. This
 * module owns the contract of that operation:
 *
 *   - the resulting list REPLACES the previous list (stale ids disappear),
 *   - the user's selection is preserved while it is still available and is
 *     pruned (with a report) when the provider dropped the model,
 *   - a failed/empty/unsupported discovery NEVER wipes the last good list and
 *     NEVER reports success,
 *   - the source of the list is always stated (live API / live web UI /
 *     configured catalog) so the UI cannot imply a live fetch that did not
 *     happen.
 */
import type { ArenaDriver } from '../types.js';
import type { ProviderFailureCode } from '../arena/provider-failures.js';
import {
  getProviderCapabilities,
  type ModelDiscoveryMode,
  type ModelDiscoverySource,
} from './provider-capabilities.js';

export interface ModelDiscoveryOutcome {
  ok: boolean;
  providerId: string;
  /** The freshly discovered model ids (empty when the discovery failed). */
  models: string[];
  /** Number of discovered models. */
  count: number;
  /** Where the list really came from. */
  source: ModelDiscoverySource;
  /** The discovery mode that was executed. */
  mode: ModelDiscoveryMode;
  /** ISO timestamp of the attempt. */
  discoveredAt: string;
  /** Ids present in the previous list that are gone now. */
  removedModels: string[];
  /** Selected ids that remain available (kept as-is). */
  keptSelected: string[];
  /** Selected ids that are no longer available (pruned). */
  droppedSelected: string[];
  /**
   * True when the provider had NO selection and the whole discovered catalog
   * was selected as the documented default. Never true when the user already
   * had a selection (that one is preserved, not replaced).
   */
  autoSelected?: boolean;
  /** Secret-free failure reason. */
  error?: string;
  /** Central Task 14 failure code when the discovery failed. */
  failureCode?: ProviderFailureCode;
}

export interface DiscoveryOptions {
  providerId: string;
  /** The adapter whose catalog is read (configured-catalog mode). */
  driver?: ArenaDriver | null;
  /** Previously stored model ids. */
  previousAvailable?: string[];
  /** Previously stored selection. */
  previousSelected?: string[];
  /** Per-operation timeout. */
  timeoutMs?: number;
  now?: () => number;
}

/** Normalizes + validates a raw model id list coming from any source. */
export function normalizeModelIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id) continue;
    if (id.length > 128) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error(`Discovery timed out after ${timeoutMs}ms`), { name: 'TimeoutError' }));
    }, timeoutMs);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Computes the post-discovery model lists.
 * - available = the newly discovered ids (replaces the old list)
 * - selection = previous selection ∩ new list (pruned when the model is gone)
 */
export function applyDiscoveryToSelection(
  discovered: string[],
  previousSelected: string[] = [],
): { selected: string[]; keptSelected: string[]; droppedSelected: string[] } {
  const available = new Set(discovered);
  const keptSelected: string[] = [];
  const droppedSelected: string[] = [];
  for (const id of previousSelected) {
    if (available.has(id)) {
      if (!keptSelected.includes(id)) keptSelected.push(id);
    } else if (!droppedSelected.includes(id)) {
      droppedSelected.push(id);
    }
  }
  return { selected: keptSelected, keptSelected, droppedSelected };
}

/**
 * Runs the discovery for one provider according to its capability contract.
 *
 * `configured-catalog` — reads the adapter's declared catalog (the ids the
 * adapter can really route). It is a REAL operation (the stored list is
 * replaced by the adapter's current catalog) but it is NOT live discovery and
 * the outcome says so.
 */
export async function discoverProviderModels(
  opts: DiscoveryOptions,
): Promise<ModelDiscoveryOutcome> {
  const now = opts.now ?? Date.now;
  const discoveredAt = new Date(now()).toISOString();
  const caps = getProviderCapabilities(opts.providerId);
  const previousAvailable = opts.previousAvailable || [];
  const previousSelected = opts.previousSelected || [];
  const timeoutMs = Math.max(1000, opts.timeoutMs ?? 15000);

  const fail = (
    error: string,
    failureCode?: ProviderFailureCode,
    source: ModelDiscoverySource = 'none',
  ): ModelDiscoveryOutcome => ({
    ok: false,
    providerId: opts.providerId,
    models: [],
    count: 0,
    source,
    mode: caps.modelDiscoveryMode,
    discoveredAt,
    removedModels: [],
    keptSelected: previousSelected,
    droppedSelected: [],
    error,
    failureCode,
  });

  if (caps.modelDiscoveryMode === 'unsupported') {
    return fail('Live model discovery is not supported for this provider.');
  }

  if (caps.modelDiscoveryMode === 'web-ui') {
    // No provider declares this mode yet. It must fail loudly rather than
    // silently degrading into a "configured catalog" success.
    return fail('Web UI model discovery is declared but not implemented for this provider.');
  }

  if (caps.modelDiscoveryMode === 'api') {
    // API providers are handled by the upstream fetch path (see
    // ProviderManager.fetchCustomProviderModelsWithMeta) — reaching it from
    // here would bypass the credential handling.
    return fail('API model discovery must run through the upstream models endpoint.');
  }

  // configured-catalog
  const driver = opts.driver;
  if (!driver || typeof driver.listModels !== 'function') {
    return fail('No provider adapter is available to read the model catalog from.', 'PROVIDER_UNAVAILABLE');
  }

  let raw: unknown;
  try {
    raw = await withTimeout(Promise.resolve(driver.listModels()), timeoutMs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const timedOut = (err as { name?: string })?.name === 'TimeoutError' || /timed out/i.test(message);
    return fail(
      timedOut ? `Model catalog read timed out after ${timeoutMs}ms.` : `Model catalog read failed: ${message}`,
      timedOut ? 'NETWORK_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
      'configured-catalog',
    );
  }

  const models = normalizeModelIds(raw);
  if (models.length === 0) {
    // An empty catalog is a failure, not a success — the last good list stays.
    return fail('The provider adapter returned an empty model catalog.', 'PROVIDER_UNAVAILABLE', 'configured-catalog');
  }

  const availableSet = new Set(models);
  const removedModels = previousAvailable.filter((m) => !availableSet.has(m));
  const { keptSelected, droppedSelected } = applyDiscoveryToSelection(models, previousSelected);

  return {
    ok: true,
    providerId: opts.providerId,
    models,
    count: models.length,
    source: 'configured-catalog',
    mode: 'configured-catalog',
    discoveredAt,
    removedModels,
    keptSelected,
    droppedSelected,
  };
}
