/**
 * TabScheduler — session-aware scheduling on top of the existing TabWorkerPool
 * (Task 6, plan v2). The Pool keeps ownership of the page cap, waiters and
 * tab specs (proven by its existing tests) — we do NOT build a second pool.
 * What the Scheduler adds is what the Pool lacks:
 *
 *  - session binding: Map<sessionKey, {tab, lease, lastUsedAt, inFlight}> so a
 *    session returns to ITS OWN chat page;
 *  - in-process leases (TTL, renewed on use) marking a binding as recently
 *    active;
 *  - LRU eviction policy: when the pool is at its cap and a new session needs
 *    a page, the OLDEST binding with no in-flight request and no active lease
 *    is evicted — its conversation URL is saved FIRST (via onEvict), then the
 *    page is closed to free the slot. The evicted session re-binds from that
 *    URL on its next request (the driver resumes from sessionChatUrl).
 *
 * Independent web drivers (zai/qwen/gemini/claude in their own files) keep the
 * legacy single-page queue — documented limitation, plan v2 Task 6.
 */
import type { Page } from 'playwright';
import { TabWorkerPool, type PooledWorkerTab } from '../arena/tab-worker-pool.js';

export interface Lease {
  resource: string;
  expiresAt: number;
}

/** Minimal in-process lease table (single gateway process scope). */
export class LeaseTable {
  private readonly leases = new Map<string, Lease>();

  constructor(private readonly ttlMs = 5 * 60_000) {}

  acquire(resource: string): Lease {
    const lease: Lease = { resource, expiresAt: Date.now() + this.ttlMs };
    this.leases.set(resource, lease);
    return lease;
  }

  /** Explicit hold with a custom TTL (e.g. background automation). */
  hold(resource: string, ttlMs: number): Lease {
    const lease: Lease = { resource, expiresAt: Date.now() + ttlMs };
    this.leases.set(resource, lease);
    return lease;
  }

  renew(resource: string): Lease | null {
    const lease = this.leases.get(resource);
    if (!lease || lease.expiresAt < Date.now()) {
      this.leases.delete(resource);
      return null;
    }
    lease.expiresAt = Date.now() + this.ttlMs;
    return lease;
  }

  active(resource: string): Lease | null {
    const lease = this.leases.get(resource);
    if (!lease) return null;
    if (lease.expiresAt < Date.now()) {
      this.leases.delete(resource);
      return null;
    }
    return lease;
  }

  release(resource: string): void {
    this.leases.delete(resource);
  }
}

interface Binding {
  tab: PooledWorkerTab;
  lease: Lease | null;
  lastUsedAt: number;
  inFlight: boolean;
}

export interface TabSchedulerOptions {
  leaseTtlMs?: number;
  /** Persists the conversation URL BEFORE the page is closed. */
  onEvict?: (sessionKey: string, conversationUrl: string | null) => Promise<void> | void;
}

export class TabScheduler {
  private readonly bindings = new Map<string, Binding>();
  private readonly leases: LeaseTable;
  private readonly onEvict?: TabSchedulerOptions['onEvict'];
  /** Requests currently blocked in pool.acquire (they must receive a page handoff). */
  private pendingAcquisitions = 0;

  constructor(private readonly pool: TabWorkerPool, options: TabSchedulerOptions = {}) {
    this.leases = new LeaseTable(options.leaseTtlMs ?? 5 * 60_000);
    this.onEvict = options.onEvict;
  }

  get bindingCount(): number {
    return this.bindings.size;
  }

  /**
   * Acquires the session's page: the bound page when alive (lease renewed),
   * otherwise a page from the pool — evicting an idle session first when the
   * pool is at its cap.
   */
  async acquireFor(sessionKey: string, targetUrl?: string): Promise<Page> {
    const bound = this.bindings.get(sessionKey);
    if (bound && !bound.tab.page.isClosed()) {
      bound.lease = this.leases.renew(sessionKey) || this.leases.acquire(sessionKey);
      bound.lastUsedAt = Date.now();
      bound.inFlight = true;
      return bound.tab.page;
    }
    if (bound) {
      // Dead page — forget the binding and the lease.
      this.leases.release(sessionKey);
      this.bindings.delete(sessionKey);
    }
    // At the cap? Make room by evicting the LRU idle session.
    if (this.pool.totalCount >= this.pool.capacity) {
      await this.evictOne(sessionKey);
    }
    this.pendingAcquisitions++;
    let tab: PooledWorkerTab;
    try {
      tab = await this.pool.acquire(targetUrl);
    } finally {
      this.pendingAcquisitions--;
    }
    // The pool may hand back a page still bound to another session (e.g. a
    // release handoff). Bindings are EXCLUSIVE: the previous owner loses it.
    for (const [other, b] of this.bindings) {
      if (other !== sessionKey && b.tab.page === tab.page) {
        this.leases.release(other);
        this.bindings.delete(other);
      }
    }
    const binding: Binding = {
      tab,
      lease: this.leases.acquire(sessionKey),
      lastUsedAt: Date.now(),
      inFlight: true,
    };
    this.bindings.set(sessionKey, binding);
    return tab.page;
  }

  /**
   * Marks the request done. The page STAYS exclusively bound to the session
   * (the whole point: the session returns to its own chat). It is only given
   * up when another session is actively waiting for a page (pool handoff) or
   * when the session is later evicted.
   */
  async release(sessionKey: string): Promise<void> {
    const bound = this.bindings.get(sessionKey);
    if (!bound) return;
    bound.inFlight = false;
    bound.lastUsedAt = Date.now();
    this.leases.release(sessionKey);
    if (bound.tab.page.isClosed()) {
      this.bindings.delete(sessionKey);
      return;
    }
    if (this.pendingAcquisitions > 0) {
      // Hand the page to the pool: a waiter is blocked in acquire() and will
      // bind it to its own session.
      this.pool.release(bound.tab.page);
      this.bindings.delete(sessionKey);
    }
    // else: keep the page bound exclusively to this session.
  }

  /**
   * Explicitly holds a lease on the session's page (e.g. background
   * automation working with this chat outside a normal request). A held lease
   * protects the binding from LRU eviction until it expires.
   */
  holdLease(sessionKey: string, ttlMs?: number): Lease | null {
    const bound = this.bindings.get(sessionKey);
    if (!bound) return null;
    const lease = ttlMs ? this.leases.hold(sessionKey, ttlMs) : this.leases.acquire(sessionKey);
    bound.lease = lease;
    return lease;
  }

  /** Evicts the oldest evictable binding (no in-flight, no active lease). */
  private async evictOne(neededBy: string): Promise<void> {
    const now = Date.now();
    let victim: { sessionKey: string; binding: Binding } | null = null;
    for (const [key, binding] of this.bindings) {
      if (key === neededBy) continue;
      if (binding.inFlight) continue;
      // The AUTHORITATIVE lease state lives in the table; binding.lease may be
      // a stale leftover object from a finished request.
      if (this.leases.active(key)) continue;
      if (!victim || binding.lastUsedAt < victim.binding.lastUsedAt) {
        victim = { sessionKey: key, binding };
      }
    }
    if (!victim) return; // everything protected — the pool's waiter logic applies
    const { sessionKey, binding } = victim;
    // 1. Save the conversation URL BEFORE freeing the page.
    let url: string | null = null;
    try {
      const u = binding.tab.page.url();
      url = u && u !== 'about:blank' ? u : null;
    } catch {}
    if (this.onEvict) {
      try {
        await this.onEvict(sessionKey, url);
      } catch {}
    }
    // 2. Free the slot: close the page, THEN release it back to the pool —
    // releasing an open page would leave it reusable by another session while
    // our binding map no longer tracks it. A closed release only clears the
    // pool's busy accounting.
    this.leases.release(sessionKey);
    this.bindings.delete(sessionKey);
    try {
      if (!binding.tab.page.isClosed()) await binding.tab.page.close();
    } catch {}
    this.pool.release(binding.tab.page);
  }
}
