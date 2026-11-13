/**
 * Notification centre for model changes.
 *
 * Notifications are DURABLE (they survive a gateway restart), support
 * read/unread, and are de-duplicated: the same change is never notified
 * twice, no matter how many scans see it.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ModelChange, ModelChangeNotification } from './types.js';

const DEFAULT_FILE = path.join(os.homedir(), '.arena-webbridge', 'provider-model-notifications.json');
const MAX_NOTIFICATIONS = 500;

export interface NotificationFileShape {
  version: 1;
  updatedAt: string;
  notifications: ModelChangeNotification[];
}

/** Stable identity of a change — the dedupe key. */
export function notificationDedupeKey(change: ModelChange): string {
  const id = change.providerModelId || `name:${change.displayName.toLowerCase()}`;
  const base = `${change.providerId}|${change.type}|${id}`;
  // A rename is a new event only when the new name differs.
  const suffix = change.type === 'model_renamed' ? `|${change.displayName}` : '';
  return createHash('sha1').update(`${base}${suffix}`).digest('hex').slice(0, 24);
}

export class NotificationStore {
  readonly path: string;
  private cache: NotificationFileShape | null = null;

  constructor(filePath?: string) {
    this.path = filePath ?? DEFAULT_FILE;
  }

  private empty(): NotificationFileShape {
    return { version: 1, updatedAt: new Date(0).toISOString(), notifications: [] };
  }

  async load(): Promise<NotificationFileShape> {
    if (this.cache) return this.cache;
    try {
      const text = await fs.readFile(this.path, 'utf8');
      const parsed = JSON.parse(text) as NotificationFileShape;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.notifications)) {
        this.cache = parsed;
        return parsed;
      }
    } catch {
      /* nothing yet */
    }
    this.cache = this.empty();
    return this.cache;
  }

  async list(options: { providerId?: string; unreadOnly?: boolean; limit?: number } = {}): Promise<ModelChangeNotification[]> {
    const file = await this.load();
    let items = file.notifications.slice().reverse();
    if (options.providerId) items = items.filter((n) => n.providerId === options.providerId);
    if (options.unreadOnly) items = items.filter((n) => !n.read);
    if (options.limit) items = items.slice(0, options.limit);
    return items;
  }

  async unreadCount(providerId?: string): Promise<number> {
    const items = await this.list({ providerId, unreadOnly: true });
    return items.length;
  }

  /**
   * Creates a notification for a change, unless an identical one already
   * exists (dedupe). Returns the notification, or null when it was a
   * duplicate.
   */
  async notify(input: {
    change: ModelChange;
    providerName: string;
    source: ModelChangeNotification['source'];
  }): Promise<ModelChangeNotification | null> {
    const file = await this.load();
    const dedupeKey = notificationDedupeKey(input.change);
    const existing = file.notifications.find((n) => n.dedupeKey === dedupeKey);
    if (existing) return null;

    const notification: ModelChangeNotification = {
      id: randomUUID(),
      providerId: input.change.providerId,
      providerName: input.providerName,
      type: input.change.type,
      displayName: input.change.displayName,
      previousDisplayName: input.change.previousDisplayName,
      providerModelId: input.change.providerModelId,
      detectedAt: input.change.detectedAt,
      source: input.source,
      link: `#providers/${encodeURIComponent(input.change.providerId)}`,
      read: false,
      dedupeKey,
    };
    file.notifications.push(notification);
    if (file.notifications.length > MAX_NOTIFICATIONS) {
      file.notifications = file.notifications.slice(file.notifications.length - MAX_NOTIFICATIONS);
    }
    file.updatedAt = new Date().toISOString();
    await this.persist(file);
    return notification;
  }

  async markRead(id: string, read = true): Promise<boolean> {
    const file = await this.load();
    const item = file.notifications.find((n) => n.id === id);
    if (!item) return false;
    item.read = read;
    file.updatedAt = new Date().toISOString();
    await this.persist(file);
    return true;
  }

  async markAllRead(providerId?: string): Promise<number> {
    const file = await this.load();
    let count = 0;
    for (const n of file.notifications) {
      if (providerId && n.providerId !== providerId) continue;
      if (n.read) continue;
      n.read = true;
      count++;
    }
    if (count > 0) {
      file.updatedAt = new Date().toISOString();
      await this.persist(file);
    }
    return count;
  }

  async clear(providerId?: string): Promise<number> {
    const file = await this.load();
    const before = file.notifications.length;
    file.notifications = providerId
      ? file.notifications.filter((n) => n.providerId !== providerId)
      : [];
    const removed = before - file.notifications.length;
    if (removed > 0) {
      file.updatedAt = new Date().toISOString();
      await this.persist(file);
    }
    return removed;
  }

  private async persist(file: NotificationFileShape): Promise<void> {
    await fs.mkdir(path.dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { await fs.chmod(tmp, 0o600); } catch {}
    await fs.rename(tmp, this.path);
    try { await fs.chmod(this.path, 0o600); } catch {}
    this.cache = file;
  }

  invalidate(): void {
    this.cache = null;
  }
}
