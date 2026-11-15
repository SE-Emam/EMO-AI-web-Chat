/**
 * ProviderSessionRouter manages active web conversation sessions across all providers.
 * Enforces a strict SINGLE ACTIVE SESSION per provider policy by default, routing
 * sequential requests to the same tab/conversation without spawning extra tabs.
 *
 * When an active session reaches its configured turn limit (maxTurns, default 20),
 * or encounters a fatal reset request, the router rotates to a clean session,
 * allowing the browser driver to archive the old conversation and navigate cleanly.
 */

export interface ProviderSession {
  sessionKey: string;
  providerId: string;
  turnCount: number;
  totalTokens: number;
  createdAt: number;
  lastUsedAt: number;
  conversationUrl?: string;
  maxTurns: number;
  status: 'active' | 'rotated' | 'closed';
}

export interface ProviderSessionRouterOptions {
  /** Maximum turns allowed in a single conversation session before rotating. Default: 20 */
  defaultMaxTurns?: number;
}

export class ProviderSessionRouter {
  private readonly activeSessions = new Map<string, ProviderSession>();
  private readonly defaultMaxTurns: number;
  private sessionCounter = 0;

  constructor(options: ProviderSessionRouterOptions = {}) {
    this.defaultMaxTurns = Math.max(1, options.defaultMaxTurns || 20);
  }

  /**
   * Returns the single active session for the given provider, initializing one if needed.
   */
  getActiveSession(providerId: string): ProviderSession {
    const existing = this.activeSessions.get(providerId);
    if (existing && existing.status === 'active') {
      return existing;
    }
    const sessionKey = `session-${providerId}-${Date.now()}-${++this.sessionCounter}`;
    const session: ProviderSession = {
      sessionKey,
      providerId,
      turnCount: 0,
      totalTokens: 0,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      maxTurns: this.defaultMaxTurns,
      status: 'active',
    };
    this.activeSessions.set(providerId, session);
    return session;
  }

  /**
   * Returns the stable session key for a provider.
   */
  getActiveSessionKey(providerId: string): string {
    return this.getActiveSession(providerId).sessionKey;
  }

  /**
   * True if the session has reached or exceeded its turn limit.
   */
  shouldRotate(providerId: string): boolean {
    const session = this.activeSessions.get(providerId);
    if (!session || session.status !== 'active') return false;
    return session.turnCount >= session.maxTurns;
  }

  /**
   * Rotates the provider to a fresh session, archiving the old one.
   */
  rotateSession(providerId: string, reason = 'turn_limit_reached'): { oldSession: ProviderSession; newSession: ProviderSession } {
    const oldSession = this.getActiveSession(providerId);
    oldSession.status = 'rotated';

    const newSessionKey = `session-${providerId}-${Date.now()}-${++this.sessionCounter}`;
    const newSession: ProviderSession = {
      sessionKey: newSessionKey,
      providerId,
      turnCount: 0,
      totalTokens: 0,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      maxTurns: oldSession.maxTurns,
      status: 'active',
    };
    this.activeSessions.set(providerId, newSession);
    console.log(`[ProviderSessionRouter] Rotated session for "${providerId}" (${reason}). Replaced ${oldSession.sessionKey} with ${newSessionKey}`);
    return { oldSession, newSession };
  }

  /**
   * Records a completed turn in the provider's active session.
   */
  recordTurn(providerId: string, url?: string, tokens = 0): { turnCount: number; shouldRotate: boolean } {
    const session = this.getActiveSession(providerId);
    session.turnCount++;
    session.totalTokens += tokens;
    session.lastUsedAt = Date.now();
    if (url) session.conversationUrl = url;

    return {
      turnCount: session.turnCount,
      shouldRotate: session.turnCount >= session.maxTurns,
    };
  }

  /**
   * Update the active conversation URL for a provider.
   */
  updateConversationUrl(providerId: string, url: string): void {
    const session = this.activeSessions.get(providerId);
    if (session) {
      session.conversationUrl = url;
    }
  }

  /**
   * Reset all sessions (used during teardown or restart).
   */
  resetAll(): void {
    this.activeSessions.clear();
  }
}

export const providerSessionRouter = new ProviderSessionRouter();
