import type { UsageCounters, UsageSnapshot } from './types.js';

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

  constructor(opts?: { heartbeatTimeoutMs?: number; now?: () => number }) {
    this.now = opts?.now ?? (() => Date.now());
    this.heartbeatTimeoutMs = opts?.heartbeatTimeoutMs ?? 15000;
    this.gatewayStartedAtMs = this.now();
  }

  heartbeat(): void {
    const n = this.now();
    this.lastHeartbeatAt = n;
    this.sessionWasActive = true;
  }

  recordRequestStart(input: { model: string; stream: boolean; promptChars: number }): void {
    this.lifetime.requests += 1;
    this.lifetime.chatRequests += 1;
    if (input.stream) this.lifetime.streamRequests += 1;
    this.lifetime.promptChars += Math.max(0, input.promptChars || 0);
    this.session.requests += 1;
    this.session.chatRequests += 1;
    if (input.stream) this.session.streamRequests += 1;
    this.session.promptChars += Math.max(0, input.promptChars || 0);
  }

  recordRequestEnd(input: { ok: boolean; completionChars?: number }): void {
    const chars = Math.max(0, input.completionChars || 0);
    if (input.ok) {
      this.lifetime.completions += 1;
      this.lifetime.completionChars += chars;
      this.session.completions += 1;
      this.session.completionChars += chars;
    } else {
      this.lifetime.errors += 1;
      this.session.errors += 1;
    }
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
