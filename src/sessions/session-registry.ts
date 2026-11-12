/**
 * Durable, versioned registry of local sessions (chat-on-steroids
 * session/correlation.ts principle: session identity is durable metadata that
 * survives process restarts — the tab/page is a replaceable resource, never
 * the identity).
 *
 * All read-modify-write cycles run inside a cross-process ProcessLock, so two
 * gateway processes cannot silently overwrite each other's updates: the
 * in-lock compare-rejects-write-older rule is the concurrency guard. The
 * synchronous read path validates its cache against the file's mtime, so a
 * write by ANOTHER process is never served stale.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readJson, writeJsonAtomic } from './durable-store.js';
import { ProcessLock } from './process-lock.js';

export interface EmoSessionRecord {
  /** Stable client-side session identity (X-Chat-Session-ID / fingerprint). */
  sessionKey: string;
  /** Which web provider owns the session. */
  providerId: string;
  /** Which browser profile the session lives in (basename of userDataDir). */
  profileId: string;
  /** Bound web conversation URL, when the site exposes one. */
  conversationUrl: string | null;
  /** Conversation id parsed from conversationUrl (or null). */
  conversationId: string | null;
  lastRequestId: string | null;
  savedAt: number;
  /** Monotonic per-session revision; older writes are rejected. */
  version: number;
}

interface RegistryFile {
  version: 1;
  /** Insertion order == eviction order (LRU). */
  entries: EmoSessionRecord[];
}

const MAX_ENTRIES = 5000;

export function defaultRegistryStorePath(): string {
  return path.join(os.homedir(), '.arena-webbridge', 'state', 'session-registry.json');
}

/** Extracts `/c/<uuid>` style conversation ids from a web chat URL. */
export function conversationIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /\/c\/([0-9a-f-]{8,64})/i.exec(String(url));
  return m ? m[1]! : null;
}

export class SessionRegistry {
  private readonly storePath: string;
  private readonly lock: ProcessLock;
  private readonly maxEntries: number;
  private cache: RegistryFile | null = null;
  private cacheMtimeMs = -1;

  constructor(storePath: string = defaultRegistryStorePath(), lock?: ProcessLock, maxEntries = MAX_ENTRIES) {
    this.storePath = storePath;
    this.maxEntries = maxEntries;
    // Lock resource is the store path itself, so every process that touches
    // this registry serializes on the same resource.
    this.lock = lock || new ProcessLock({ lockDir: path.join(path.dirname(storePath), 'locks') });
  }

  /** Reads the store, serving the cache only when the file hasn't changed. */
  private cachedFile(): RegistryFile | null {
    let mtime: number;
    try {
      mtime = fs.statSync(this.storePath).mtimeMs;
      if (this.cache && mtime === this.cacheMtimeMs) return this.cache;
    } catch {
      return null; // file gone — treat as empty
    }
    const file = readJson<RegistryFile>(this.storePath);
    if (file && Array.isArray(file.entries)) {
      this.cache = file;
      this.cacheMtimeMs = mtime;
      return file;
    }
    return null;
  }

  /** Authoritative in-lock read. MUST be called while holding the lock. */
  private async load(): Promise<RegistryFile> {
    const data = readJson<RegistryFile>(this.storePath);
    const file: RegistryFile = data && Array.isArray(data.entries) ? data : { version: 1, entries: [] };
    this.cache = file;
    try { this.cacheMtimeMs = fs.statSync(this.storePath).mtimeMs; } catch { /* new file */ }
    return file;
  }

  private find(file: RegistryFile, providerId: string, sessionKey: string): EmoSessionRecord | undefined {
    return file.entries.find((e) => e.providerId === providerId && e.sessionKey === sessionKey);
  }

  async upsert(input: EmoSessionRecord): Promise<void> {
    await this.lock.withLock(this.storePath, async () => {
      const file = await this.load();
      const rec: EmoSessionRecord = {
        ...input,
        conversationUrl: input.conversationUrl ?? null,
        conversationId: input.conversationId || conversationIdFromUrl(input.conversationUrl),
      };
      const existing = this.find(file, input.providerId, input.sessionKey);
      if (existing) {
        if ((input.version ?? 0) < (existing.version ?? 0)) {
          // An older revision is stale by definition — never overwrite a newer
          // durable state (protects against out-of-order writers).
          return;
        }
        const idx = file.entries.indexOf(existing);
        file.entries.splice(idx, 1);
      }
      file.entries.push(rec);
      while (file.entries.length > this.maxEntries) file.entries.shift();
      writeJsonAtomic(this.storePath, file);
      this.cache = file;
      try { this.cacheMtimeMs = fs.statSync(this.storePath).mtimeMs; } catch { /* ignore */ }
    });
  }

  /** Fast read; cache is mtime-validated so foreign writes are never stale. */
  get(providerId: string, sessionKey: string): EmoSessionRecord | null {
    const file = this.cachedFile();
    if (!file) return null;
    return this.find(file, providerId, sessionKey) ?? null;
  }

  /** Authoritative read through the cross-process lock. */
  async getSync(providerId: string, sessionKey: string): Promise<EmoSessionRecord | null> {
    return this.lock.withLock(this.storePath, async () => {
      const file = await this.load();
      return this.find(file, providerId, sessionKey) ?? null;
    });
  }

  async attachRequest(providerId: string, sessionKey: string, requestId: string): Promise<void> {
    const existing = await this.getSync(providerId, sessionKey);
    if (!existing) return;
    await this.upsert({ ...existing, lastRequestId: requestId, savedAt: Date.now(), version: existing.version + 1 });
  }
}
