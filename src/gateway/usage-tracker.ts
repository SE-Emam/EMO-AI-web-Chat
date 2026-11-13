import type { UsageCounters, UsageSnapshot } from './types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface RequestLogEntry {
  id: string;
  timestamp: string;
  timeStr: string;
  model: string;
  stream: boolean;
  promptChars: number;
  completionChars: number;
  tokensEstimated: number;
  durationMs: number;
  /** undefined while the request is still in flight. */
  ok?: boolean;
  clientAgent?: string;
  error?: string;
}

function zero(): UsageCounters {
  return { requests: 0, chatRequests: 0, streamRequests: 0, completions: 0, errors: 0, promptChars: 0, completionChars: 0 };
}

export class UsageTracker {
  private readonly now: () => number;
  private readonly heartbeatTimeoutMs: number;
  private readonly gatewayStartedAtMs: number;
  private lifetime: UsageCounters = zero();
  private session: UsageCounters = zero();
  private lastHeartbeatAt?: number;
  private sessionResetAt?: string;
  private sessionWasActive = false;
  private recentRequests: RequestLogEntry[] = [];
  private pendingRequests = new Map<string, { startTime: number; model: string; stream: boolean; promptChars: number; clientAgent?: string }>();
  private readonly persistPath?: string;
  private persistTimer?: ReturnType<typeof setTimeout>;
  private usageListeners = new Set<() => void>();

  constructor(opts?: { heartbeatTimeoutMs?: number; now?: () => number; persistPath?: string }) {
    this.now = opts?.now ?? (() => Date.now());
    this.heartbeatTimeoutMs = opts?.heartbeatTimeoutMs ?? 15000;
    this.gatewayStartedAtMs = this.now();
    this.persistPath = opts?.persistPath;
    this.loadPersistedRequests();
  }

  // Subscribe to usage-log changes. The gateway SSE endpoint forwards these to
  // the UI so live traffic is reflected the instant a request starts/ends,
  // mirroring EasyCLIProxyAPI's push-based usage subscription.
  onUsageChange(listener: () => void): () => void {
    this.usageListeners.add(listener);
    return () => { this.usageListeners.delete(listener); };
  }

  private notifyUsageListeners(): void {
    for (const listener of this.usageListeners) {
      try { listener(); } catch { /* listener errors must not break tracking */ }
    }
  }

  // Durable recent-request log: survives gateway restarts so a bound agent's
  // traffic is never wiped by a process restart (durable-inbox equivalent).
  private loadPersistedRequests(): void {
    if (!this.persistPath) return;
    try {
      const raw = fs.readFileSync(this.persistPath, 'utf8');
      const parsed = JSON.parse(raw) as { entries?: RequestLogEntry[] };
      if (!Array.isArray(parsed.entries)) return;
      this.recentRequests = parsed.entries
        .filter((e) => e && typeof e.id === 'string' && typeof e.timestamp === 'string')
        .slice(0, 100)
        .map((e) => (e.ok === undefined ? { ...e, ok: false, error: 'interrupted by gateway restart' } : e));
    } catch { /* missing or corrupt file: start empty */ }
  }

  private schedulePersist(): void {
    if (!this.persistPath) return;
    const target = this.persistPath;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, JSON.stringify({ savedAt: new Date().toISOString(), entries: this.recentRequests.slice(0, 100) }));
      } catch { /* best effort */ }
    }, 800);
    // Do not hold the process open just for a pending persist.
    this.persistTimer.unref?.();
  }

  heartbeat(): void {
    const n = this.now();
    this.lastHeartbeatAt = n;
    this.sessionWasActive = true;
  }

  recordRequestStart(input: { id?: string; model: string; stream: boolean; promptChars: number; clientAgent?: string }): string {
    this.lifetime.requests += 1;
    this.lifetime.chatRequests += 1;
    if (input.stream) this.lifetime.streamRequests += 1;
    this.lifetime.promptChars += Math.max(0, input.promptChars || 0);
    this.session.requests += 1;
    this.session.chatRequests += 1;
    if (input.stream) this.session.streamRequests += 1;
    this.session.promptChars += Math.max(0, input.promptChars || 0);

    const reqId = input.id || Math.random().toString(36).slice(2, 10);
    this.pendingRequests.set(reqId, {
      startTime: this.now(),
      model: input.model,
      stream: input.stream,
      promptChars: Math.max(0, input.promptChars || 0),
      clientAgent: input.clientAgent,
    });
    // Log the request the moment it ARRIVES (still in flight) so the live
    // panel reflects real traffic instantly — not only after the upstream
    // finishes generating.
    const d = new Date(this.now());
    const timeStr = d.toTimeString().split(' ')[0] || d.toISOString();
    this.recentRequests.unshift({
      id: reqId,
      timestamp: d.toISOString(),
      timeStr,
      model: input.model,
      stream: input.stream,
      promptChars: Math.max(0, input.promptChars || 0),
      completionChars: 0,
      tokensEstimated: Math.max(1, Math.round(Math.max(0, input.promptChars || 0) / 4)),
      durationMs: 0,
      ok: undefined,
      clientAgent: input.clientAgent || 'API Client',
    });
    if (this.recentRequests.length > 100) {
      this.recentRequests.length = 100;
    }
    this.schedulePersist();
    this.notifyUsageListeners();
    return reqId;
  }

  /**
   * Task 14 — additive /health metric: requests currently in flight
   * (started but not yet ended). Never mutates tracking state.
   */
  inFlightCount(): number {
    return this.pendingRequests.size;
  }

  recordRequestEnd(input: { id?: string; ok: boolean; completionChars?: number; error?: string }): void {    const chars = Math.max(0, input.completionChars || 0);
    if (input.ok) {
      this.lifetime.completions += 1;
      this.lifetime.completionChars += chars;
      this.session.completions += 1;
      this.session.completionChars += chars;
    } else {
      this.lifetime.errors += 1;
      this.session.errors += 1;
    }

    if (input.id && this.pendingRequests.has(input.id)) {
      const p = this.pendingRequests.get(input.id)!;
      this.pendingRequests.delete(input.id);
      const durationMs = Math.max(1, this.now() - p.startTime);
      const tokensEstimated = Math.max(1, Math.round((p.promptChars + chars) / 4));
      // Update the entry created at request start (keeps the arrival timestamp
      // as the truthful moment the request happened).
      const entry = this.recentRequests.find((r) => r.id === input.id);
      if (entry) {
        entry.completionChars = chars;
        entry.tokensEstimated = tokensEstimated;
        entry.durationMs = durationMs;
        entry.ok = input.ok;
        entry.error = input.error;
      } else {
        const d = new Date(this.now());
        const timeStr = d.toTimeString().split(' ')[0] || d.toISOString();
        this.recentRequests.unshift({
          id: input.id,
          timestamp: d.toISOString(),
          timeStr,
          model: p.model,
          stream: p.stream,
          promptChars: p.promptChars,
          completionChars: chars,
          tokensEstimated,
          durationMs,
          ok: input.ok,
          clientAgent: p.clientAgent || 'API Client',
          error: input.error,
        });
      }
      if (this.recentRequests.length > 100) {
        this.recentRequests.length = 100;
      }
      this.schedulePersist();
      this.notifyUsageListeners();
    }
  }

  getRecentRequests(): RequestLogEntry[] {
    return [...this.recentRequests];
  }

  clearRecentRequests(): void {
    this.recentRequests = [];
    this.schedulePersist();
    this.notifyUsageListeners();
  }

  snapshot(now = this.now()): UsageSnapshot {
    const active = this.lastHeartbeatAt != null && now - this.lastHeartbeatAt <= this.heartbeatTimeoutMs;
    if (!active && (this.sessionWasActive || this.lastHeartbeatAt == null)) {
      // Reset session once when entering inactive state (covers never-heartbeated and expired).
      if (this.sessionResetAt == null || this.sessionWasActive) {
        this.session = zero();
        this.sessionResetAt = new Date(now).toISOString();
      }
      this.sessionWasActive = false;
    }
    return {
      gatewayStartedAt: new Date(this.gatewayStartedAtMs).toISOString(),
      sessionActive: active,
      sessionResetAt: this.sessionResetAt,
      lastHeartbeatAt: this.lastHeartbeatAt != null ? new Date(this.lastHeartbeatAt).toISOString() : undefined,
      lifetime: { ...this.lifetime },
      session: { ...this.session },
    };
  }
}
