/**
 * Live Web Model Discovery — core contracts.
 *
 * The goal of this layer is ONE honest, verifiable path from "the provider's
 * website" to "the models the provider actually offers right now".
 *
 * Hard rules encoded in these types:
 *  - a discovery result always states its SOURCE and whether it is COMPLETE;
 *  - a model is only reported as executable when a STABLE id was read from
 *    the site (`identityConfidence: 'stable-id'`); a display name alone is
 *    reported as `display-name-only` and is never presented as executable;
 *  - a failure is always one of the explicit reasons below — never a silent
 *    empty list and never a fallback to a static catalog.
 */
import type { Page } from 'playwright';
import type { EmbeddedCatalogConfig } from './embedded-strategy.js';

export type DiscoverySource = 'web-ui' | 'web-ui-dom' | 'web-ui-network' | 'api' | 'none';

/**
 * Why a discovery attempt did not produce a usable list.
 * `deferred` is NOT a failure — it means the scan was postponed because it
 * could not run safely right now (an active user session owns the browser).
 */
export type DiscoveryFailureReason =
  | 'authentication_required'
  | 'model_picker_not_found'
  | 'discovery_unsupported'
  | 'site_layout_changed'
  | 'partial_discovery'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'timeout'
  | 'deferred'
  | 'unknown';

export type IdentityConfidence = 'stable-id' | 'display-name-only';

export interface DiscoveredWebModel {
  /** The executable model id, when the site exposes one. */
  providerModelId?: string;
  /** The human-readable name shown on the site. */
  displayName: string;
  /** Extra verifiable facts read from the same option element. */
  metadata?: Record<string, unknown>;
  /** Whether `providerModelId` is a stable, executable id. */
  identityConfidence: IdentityConfidence;
}

export interface ModelDiscoveryResult {
  providerId: string;
  source: DiscoverySource;
  /** True when the whole list was read (not just the visible slice). */
  complete: boolean;
  discoveredAt: string;
  models: DiscoveredWebModel[];
  /** Set when the attempt failed. */
  failureReason?: DiscoveryFailureReason;
  /** Secret-free human explanation. */
  detail?: string;
  /** Which strategy produced the list. */
  strategy?: 'dom' | 'network' | 'api';
}

/** A candidate model option as read from the DOM (already normalised). */
export interface RawModelOption {
  /** Stable id read from the option element (value / data-*). */
  stableId?: string;
  /** The visible label. */
  label: string;
  /** Everything else worth keeping (description, badge, selected flag…). */
  metadata?: Record<string, unknown>;
  /** Where the stable id came from (for auditability). */
  idSource?: string;
}

/**
 * The narrow page surface the discovery adapters need. Keeping it small
 * makes the adapters testable against DOM fixtures without a real browser.
 */
export interface DiscoveryLocator {
  count(): Promise<number>;
  first(): DiscoveryLocator;
  nth(index: number): DiscoveryLocator;
  all(): Promise<DiscoveryLocator[]>;
  /** A child locator (used to read a clean label out of an option). */
  locator(selector: string): DiscoveryLocator;
  click(options?: { timeout?: number; force?: boolean }): Promise<void>;
  isVisible(): Promise<boolean>;
  textContent(): Promise<string | null>;
  getAttribute(name: string): Promise<string | null>;
  waitFor(options?: { state?: string; timeout?: number }): Promise<void>;
  evaluate<R = unknown>(fn: string | ((el: Element) => R), arg?: unknown): Promise<R>;
}

export interface DiscoveryPage {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<void>;
  url(): string;
  title(): Promise<string>;
  locator(selector: string): DiscoveryLocator;
  waitForTimeout(ms: number): Promise<void>;
  content(): Promise<string>;
  /** Runs a function inside the page (same-origin session context). */
  evaluate<R = unknown>(fn: string | ((...args: any[]) => R), arg?: unknown): Promise<R>;
  /** The real Playwright page, when available. */
  raw?: Page;
}

export interface DiscoveryContext {
  page: DiscoveryPage;
  signal?: AbortSignal;
  /** How long the whole attempt may take. */
  timeoutMs?: number;
  /** Milliseconds to wait for the picker/list to materialise. */
  settleMs?: number;
  now?: () => number;
}

/** One strategy a provider can use to read its model list. */
export type DiscoveryStrategy = 'dom' | 'network' | 'embedded' | 'api';

export interface WebModelDiscoveryAdapter {
  providerId: string;
  /**
   * Where to open the chat UI. Must be a page the provider itself uses.
   */
  entryUrl: string;
  /** Which strategies this provider supports, most reliable first. */
  strategies: DiscoveryStrategy[];
  /** DOM strategy configuration. */
  dom?: DomDiscoveryConfig;
  /** Network strategy configuration (the provider's OWN model request). */
  network?: NetworkDiscoveryConfig;
  /** Embedded-catalog configuration (the provider's own page payload). */
  embedded?: EmbeddedCatalogConfig;
  /**
   * True when this provider's model list is proven to be discoverable.
   * A provider without proof must report `discovery_unsupported` instead of
   * pretending.
   */
  verified: boolean;
  /** What is missing to complete support (reported to the user). */
  blocker?: string;
}

export interface DomDiscoveryConfig {
  /** Selectors that open the model picker, most specific first. */
  openPickerSelectors: string[];
  /** Selectors for one model option inside the opened picker. */
  optionSelectors: string[];
  /** Attributes that may hold the stable model id, most trusted first. */
  idAttributes: string[];
  /** Selectors that reveal a "more models" / paginated list. */
  expandSelectors?: string[];
  /** Selectors that prove the page is a login wall. */
  loginWallSelectors?: string[];
  /**
   * Overlays that BLOCK the model picker (cookie banners, consent walls).
   * They are dismissed first so the picker can be opened.
   */
  dismissSelectors?: string[];
  /**
   * Selectors of the chat composer. When the page shows a sign-in prompt but
   * has NO composer, the session is not authenticated.
   */
  composerSelectors?: string[];
  /** Maximum number of "more" expansions (pagination / virtual scroll). */
  maxExpansions?: number;
  /** How the display name is read out of an option element. */
  labelExtraction?: 'text' | 'attribute';
  /**
   * Selector (inside the option) that holds the CLEAN display name, when the
   * option's own text carries extra markup (badges, descriptions).
   */
  labelSelector?: string;
  /** Attribute holding the display name when `labelExtraction` is 'attribute'. */
  labelAttribute?: string;
  /** Extra JSON-ish metadata to read from each option. */
  metadataAttributes?: string[];
  /** Virtual scrolling container (scrolled to the end repeatedly). */
  scrollContainerSelectors?: string[];
}

export interface NetworkDiscoveryConfig {
  /**
   * URL fragments of the provider's OWN requests that carry the model list.
   * These were observed in the provider's page traffic — they are not
   * invented endpoints.
   */
  urlPatterns: string[];
  /** JSON keys that may hold a model id (most trusted first). */
  idKeys: string[];
  /** Optional JSON paths to the array of models inside the payload. */
  arrayPaths?: string[];
  /** Minimum number of plausible ids before the payload is accepted. */
  minModels?: number;
  /** Regex every accepted id must match (keeps unrelated JSON out). */
  idPattern?: string;
  /**
   * Same-origin paths of the provider's own model request that can be
   * replayed from inside the page (same session, same cookies).
   */
  replayPaths?: string[];
}

/** The persisted snapshot of the last successful discovery. */
export interface ProviderModelSnapshot {
  providerId: string;
  discoverySource: DiscoverySource;
  discoveredAt: string;
  lastSuccessfulScanAt: string;
  lastAttemptAt?: string;
  snapshotVersion: number;
  models: DiscoveredWebModel[];
  /** True when the scan read the whole list. */
  completeness: 'complete' | 'partial';
  /** Hash of the model ids — a cheap change detector. */
  snapshotHash: string;
}

export type ModelChangeType =
  | 'model_added'
  | 'model_removed'
  | 'model_renamed'
  | 'model_metadata_changed'
  | 'model_restored';

export interface ModelChange {
  providerId: string;
  type: ModelChangeType;
  /** The stable id when known. */
  providerModelId?: string;
  /** Human name of the model (new name for renames). */
  displayName: string;
  /** Previous display name (renames / metadata changes). */
  previousDisplayName?: string;
  /** Previous metadata snapshot. */
  previousMetadata?: Record<string, unknown>;
  /** New metadata snapshot. */
  newMetadata?: Record<string, unknown>;
  /** ISO timestamp of the detection. */
  detectedAt: string;
  /** True when the change could not be attributed with certainty. */
  uncertain?: boolean;
  /** Why the change was detected (auditability). */
  evidence?: string;
}

export interface ModelDiffResult {
  providerId: string;
  changes: ModelChange[];
  /** True when the comparison was based on a COMPLETE scan. */
  complete: boolean;
  /** True when there was no previous snapshot (baseline scan). */
  isBaseline: boolean;
  detectedAt: string;
}

/** A user-visible notification about a model change. */
export interface ModelChangeNotification {
  id: string;
  providerId: string;
  providerName: string;
  type: ModelChangeType;
  /** Display name of the model. */
  displayName: string;
  previousDisplayName?: string;
  providerModelId?: string;
  detectedAt: string;
  source: DiscoverySource;
  /** UI deep link to the provider card. */
  link: string;
  read: boolean;
  /** Stable identity used to suppress duplicates. */
  dedupeKey: string;
}
