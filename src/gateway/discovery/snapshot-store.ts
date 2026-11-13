/**
 * Durable snapshot store for live model discovery.
 *
 * Holds, per provider, the LAST SUCCESSFUL model list. Rules:
 *  - a failed or incomplete scan NEVER replaces a good snapshot;
 *  - writes are atomic (temp file + rename) so a crash cannot corrupt it;
 *  - the file lives beside the other gateway state and contains NO
 *    credentials, cookies or account data — only model ids and names.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ProviderModelSnapshot, DiscoveredWebModel } from './types.js';

const DEFAULT_DIR = path.join(os.homedir(), '.arena-webbridge');
const DEFAULT_FILE = path.join(DEFAULT_DIR, 'provider-model-snapshots.json');

export interface SnapshotFileShape {
  version: 1;
  updatedAt: string;
  providers: Record<string, ProviderModelSnapshot>;
}

/** Stable hash of the model ids — a cheap "did anything change?" marker. */
export function hashSnapshot(models: DiscoveredWebModel[]): string {
  const ids = models
    .map((m) => `${m.providerModelId || ''}:${m.displayName}`)
    .sort()
    .join('|');
  return createHash('sha1').update(ids).digest('hex').slice(0, 16);
}

export class ModelSnapshotStore {
  readonly path: string;
  private cache: SnapshotFileShape | null = null;

  constructor(filePath?: string) {
    this.path = filePath ?? DEFAULT_FILE;
  }

  private empty(): SnapshotFileShape {
    return { version: 1, updatedAt: new Date(0).toISOString(), providers: {} };
  }

  async load(): Promise<SnapshotFileShape> {
    if (this.cache) return this.cache;
    try {
      const text = await fs.readFile(this.path, 'utf8');
      const parsed = JSON.parse(text) as SnapshotFileShape;
      if (parsed && parsed.version === 1 && parsed.providers && typeof parsed.providers === 'object') {
        this.cache = parsed;
        return parsed;
      }
    } catch {
      /* no snapshot yet */
    }
    this.cache = this.empty();
    return this.cache;
  }

  async get(providerId: string): Promise<ProviderModelSnapshot | null> {
    const file = await this.load();
    return file.providers[providerId] ?? null;
  }

  async list(): Promise<ProviderModelSnapshot[]> {
    const file = await this.load();
    return Object.values(file.providers);
  }

  /**
   * Stores a NEW successful snapshot. A snapshot is only written when the
   * scan was COMPLETE — a partial list never replaces a good one.
   */
  async saveSuccessful(input: {
    providerId: string;
    source: ProviderModelSnapshot['discoverySource'];
    models: DiscoveredWebModel[];
    completeness: 'complete' | 'partial';
    discoveredAt: string;
  }): Promise<ProviderModelSnapshot> {
    const file = await this.load();
    const previous = file.providers[input.providerId];
    const snapshot: ProviderModelSnapshot = {
      providerId: input.providerId,
      discoverySource: input.source,
      discoveredAt: input.discoveredAt,
      lastSuccessfulScanAt: input.discoveredAt,
      lastAttemptAt: input.discoveredAt,
      snapshotVersion: (previous?.snapshotVersion ?? 0) + 1,
      models: input.models,
      completeness: input.completeness,
      snapshotHash: hashSnapshot(input.models),
    };
    file.providers[input.providerId] = snapshot;
    file.updatedAt = new Date().toISOString();
    await this.persist(file);
    return snapshot;
  }

  /**
   * Records that a scan was ATTEMPTED without replacing the last successful
   * snapshot (the models array and the hash stay untouched).
   */
  async markAttempt(providerId: string, attemptedAt: string): Promise<void> {
    const file = await this.load();
    const previous = file.providers[providerId];
    if (!previous) return;
    previous.lastAttemptAt = attemptedAt;
    file.updatedAt = new Date().toISOString();
    await this.persist(file);
  }

  /** Atomic write: temp file + rename. */
  private async persist(file: SnapshotFileShape): Promise<void> {
    await fs.mkdir(path.dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { await fs.chmod(tmp, 0o600); } catch {}
    await fs.rename(tmp, this.path);
    try { await fs.chmod(this.path, 0o600); } catch {}
    this.cache = file;
  }

  /** Test helper: drop the in-process cache. */
  invalidate(): void {
    this.cache = null;
  }
}
