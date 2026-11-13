/**
 * Discovery service — the orchestrator.
 *
 * Flow for one provider:
 *   scan (runner) → compare (diff engine) → persist (snapshot store)
 *                → notify (notification store) → report
 *
 * Invariants:
 *  - a failed/incomplete scan NEVER replaces the last good snapshot;
 *  - the FIRST scan of a provider is a BASELINE (no notification storm);
 *  - a removal is only reported after two consecutive complete scans;
 *  - every change produces at most one durable notification.
 */
import { diffSnapshots, RemovalConfirmation } from './diff-engine.js';
import { ModelSnapshotStore } from './snapshot-store.js';
import { NotificationStore } from './notification-store.js';
import type {
  DiscoveredWebModel,
  DiscoveryFailureReason,
  DiscoverySource,
  ModelChange,
  ModelChangeNotification,
} from './types.js';
import type { DiscoveryRunner } from './runner.js';

export interface DiscoveryServiceOptions {
  runner: DiscoveryRunner;
  snapshots: ModelSnapshotStore;
  notifications: NotificationStore;
  /** Display name of a provider (for notifications). */
  providerName: (providerId: string) => string;
  /** The persistent Chrome profile directory of a provider. */
  profileDirFor: (providerId: string) => string;
  /** True when the provider's driver currently holds its browser profile. */
  driverRunning?: (providerId: string) => boolean;
  /**
   * Whether the provider is configured to run headful. Some providers refuse
   * a headless browser (CDN challenge) — the scan must use the same mode as
   * the provider itself.
   */
  headlessFor?: (providerId: string) => boolean;
  /**
   * Writes the DISCOVERED models into the provider's own model list.
   *
   * Without this the card keeps showing the static catalog and the discovery
   * would only update a snapshot nobody sees. The provider manager owns the
   * configuration, so it performs the write.
   */
  applyDiscoveredModels?: (
    providerId: string,
    models: DiscoveredWebModel[],
    source: string,
  ) => Promise<void>;
  now?: () => number;
}

export type DiscoveryStatus = 'discovered' | 'failed' | 'deferred' | 'unsupported';

export interface ProviderDiscoveryReport {
  providerId: string;
  status: DiscoveryStatus;
  /** True when a visible browser window is needed (and the user must approve). */
  needsHeadedConsent?: boolean;
  source: DiscoverySource;
  complete: boolean;
  discoveredAt: string;
  /** Every model the provider listed. */
  models: DiscoveredWebModel[];
  /** Models with a stable, executable id. */
  executableModels: string[];
  /** Models known only by their display name (never presented as executable). */
  displayNameOnlyModels: string[];
  failureReason?: DiscoveryFailureReason;
  detail?: string;
  changes: ModelChange[];
  baseline: boolean;
  notificationsCreated: number;
  snapshotHash?: string;
  lastSuccessfulScanAt?: string;
  /** True when the scan was postponed instead of failing. */
  deferred: boolean;
}

export class ModelDiscoveryService {
  private readonly removals = new RemovalConfirmation();
  private readonly inFlight = new Set<string>();
  private readonly options: DiscoveryServiceOptions;

  constructor(options: DiscoveryServiceOptions) {
    this.options = options;
  }

  /** True when a scan for this provider is already running. */
  isScanning(providerId: string): boolean {
    return this.inFlight.has(providerId);
  }

  /**
   * Runs a live discovery for one provider and applies the results.
   */
  async discover(
    providerId: string,
    opts: { timeoutMs?: number; allowHeadedFallback?: boolean } = {},
  ): Promise<ProviderDiscoveryReport> {
    const now = this.options.now ?? Date.now;
    const discoveredAt = new Date(now()).toISOString();

    if (this.inFlight.has(providerId)) {
      return {
        providerId,
        status: 'deferred',
        deferred: true,
        source: 'none',
        complete: false,
        discoveredAt,
        models: [],
        executableModels: [],
        displayNameOnlyModels: [],
        changes: [],
        baseline: false,
        notificationsCreated: 0,
        failureReason: 'deferred',
        detail: 'A discovery scan for this provider is already running.',
      };
    }

    this.inFlight.add(providerId);
    try {
      const profileDir = this.options.profileDirFor(providerId);
      const driverRunning = this.options.driverRunning?.(providerId) ?? false;

      const session = await this.options.runner.run({
        providerId,
        userDataDir: profileDir,
        driverRunning,
        headless: this.options.headlessFor?.(providerId) ?? true,
        timeoutMs: opts.timeoutMs,
        // A manual scan may retry with a visible browser window; the
        // background scheduler never does.
        allowHeadedFallback: opts.allowHeadedFallback === true,
        now,
      });
      const result = session.result;

      const previous = await this.options.snapshots.get(providerId);
      const models = result.models || [];
      const complete = Boolean(result.complete) && models.length > 0;

      if (!complete) {
        // Failed or partial: keep the last good snapshot, only record the attempt.
        await this.options.snapshots.markAttempt(providerId, discoveredAt);
        const deferred = result.failureReason === 'deferred';
        const status: DiscoveryStatus = deferred
          ? 'deferred'
          : result.failureReason === 'discovery_unsupported'
            ? 'unsupported'
            : 'failed';
        return {
          providerId,
          status,
          deferred,
          needsHeadedConsent: result.needsHeadedConsent === true,
          source: result.source,
          complete: false,
          discoveredAt,
          models: [],
          executableModels: [],
          displayNameOnlyModels: [],
          failureReason: result.failureReason,
          detail: result.detail,
          changes: [],
          baseline: !previous,
          notificationsCreated: 0,
          snapshotHash: previous?.snapshotHash,
          lastSuccessfulScanAt: previous?.lastSuccessfulScanAt,
        };
      }

      // ---- successful scan -------------------------------------------
      const snapshot = await this.options.snapshots.saveSuccessful({
        providerId,
        source: result.source,
        models,
        completeness: 'complete',
        discoveredAt,
      });

      // ---- change detection ------------------------------------------
      // The "known" set is the stored snapshot PLUS the models that were
      // already missing once (pending confirmation) — otherwise a removal
      // could never be confirmed, because the model is gone from the
      // snapshot after the first missing scan.
      const currentModels = models;
      const currentKeys = new Set(currentModels.map(modelKey));
      const pendingBefore = this.removals.pendingFor(providerId);
      const knownModels = [...(previous?.models || []), ...pendingBefore];
      const knownKeys = new Set(knownModels.map(modelKey));
      const missing = knownModels.filter((m) => !currentKeys.has(modelKey(m)));
      const confirmedRemovals = this.removals.observe(providerId, missing);

      const diff = diffSnapshots({
        providerId,
        previous: previous ?? null,
        current: snapshot,
        pendingRemovals: pendingBefore,
        confirmedRemovals: confirmedRemovals.map((m) => modelKey(m)),
        complete: true,
        now,
      });

      // Models that are back are no longer pending.
      this.removals.reconcile(providerId, currentModels);

      // ---- publish the discovered list to the provider ---------------
      // The snapshot is the history; the provider's own list is what the card
      // (and the router) use — it MUST be refreshed, otherwise the card keeps
      // showing the old static catalog.
      if (this.options.applyDiscoveredModels) {
        try {
          await this.options.applyDiscoveredModels(providerId, models, result.source);
        } catch {
          /* the snapshot is still saved; the list update is best effort */
        }
      }

      // ---- notifications ---------------------------------------------
      let notificationsCreated = 0;
      if (!diff.isBaseline) {
        for (const change of diff.changes) {
          const notification = await this.options.notifications.notify({
            change,
            providerName: this.options.providerName(providerId),
            source: result.source,
          });
          if (notification) notificationsCreated++;
        }
      }

      const executableModels = models
        .filter((m) => m.identityConfidence === 'stable-id' && m.providerModelId)
        .map((m) => m.providerModelId as string);
      const displayNameOnlyModels = models
        .filter((m) => m.identityConfidence !== 'stable-id')
        .map((m) => m.displayName);

      return {
        providerId,
        status: 'discovered',
        deferred: false,
        source: result.source,
        complete: true,
        discoveredAt,
        models,
        executableModels,
        displayNameOnlyModels,
        changes: diff.changes,
        baseline: diff.isBaseline,
        notificationsCreated,
        snapshotHash: snapshot.snapshotHash,
        lastSuccessfulScanAt: snapshot.lastSuccessfulScanAt,
        detail: result.detail,
      };
    } finally {
      this.inFlight.delete(providerId);
    }
  }

  /** The stored snapshot of a provider (for the UI). */
  async snapshot(providerId: string) {
    return this.options.snapshots.get(providerId);
  }

  /** All stored snapshots. */
  async snapshots() {
    return this.options.snapshots.list();
  }

  /** The notifications of the notification centre. */
  async notifications(options: { providerId?: string; unreadOnly?: boolean; limit?: number } = {}) {
    return this.options.notifications.list(options);
  }

  async unreadCount(providerId?: string): Promise<number> {
    return this.options.notifications.unreadCount(providerId);
  }

  async markRead(id: string, read = true): Promise<boolean> {
    return this.options.notifications.markRead(id, read);
  }

  async markAllRead(providerId?: string): Promise<number> {
    return this.options.notifications.markAllRead(providerId);
  }
}

function modelKey(model: DiscoveredWebModel): string {
  return model.providerModelId || `name:${model.displayName.toLowerCase()}`;
}

export type { ModelChangeNotification };
