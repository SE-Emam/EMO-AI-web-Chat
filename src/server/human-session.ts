import { randomBytes, timingSafeEqual } from 'node:crypto';

export interface HumanSession {
  id: string;
  csrfToken: string;
  actor: string;
  createdAt: number;
  expiresAt: number;
  lastActiveAt: number;
}

export class HumanSessionManager {
  private sessions = new Map<string, HumanSession>();
  private readonly ttlMs: number;
  private readonly localOperatorPasscode: string;

  constructor(options?: { ttlMs?: number; passcode?: string }) {
    this.ttlMs = options?.ttlMs ?? 60 * 60 * 1000; // 1 hour session TTL
    this.localOperatorPasscode = options?.passcode || process.env.LOCAL_OPERATOR_SECRET || randomBytes(24).toString('hex');
  }

  getLocalOperatorPasscode(): string {
    return this.localOperatorPasscode;
  }

  verifyLocalOperatorPasscode(provided?: string): boolean {
    if (!provided || typeof provided !== 'string') return false;
    const clean = provided.trim();
    if (clean.length !== this.localOperatorPasscode.length) return false;
    try {
      const a = Buffer.from(clean, 'utf8');
      const b = Buffer.from(this.localOperatorPasscode, 'utf8');
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  createSession(actor = 'human:local_operator'): HumanSession {
    const id = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    const now = Date.now();

    const session: HumanSession = {
      id,
      csrfToken,
      actor: `${actor}:${id.slice(0, 8)}`,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      lastActiveAt: now,
    };

    this.sessions.set(id, session);
    return { ...session };
  }

  getSession(id: string): HumanSession | null {
    if (!id || typeof id !== 'string') return null;
    const cleanId = id.trim();
    const session = this.sessions.get(cleanId);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(cleanId);
      return null;
    }

    session.lastActiveAt = Date.now();
    return { ...session };
  }

  validateCsrf(session: HumanSession, providedCsrfToken?: string): boolean {
    if (!providedCsrfToken || typeof providedCsrfToken !== 'string') {
      return false;
    }
    const cleanProvided = providedCsrfToken.trim();
    if (cleanProvided.length !== session.csrfToken.length) {
      return false;
    }
    try {
      const a = Buffer.from(cleanProvided, 'utf8');
      const b = Buffer.from(session.csrfToken, 'utf8');
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  destroySession(id: string): boolean {
    if (!id || typeof id !== 'string') return false;
    return this.sessions.delete(id.trim());
  }

  cleanExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
      }
    }
  }
}

export const globalHumanSessionManager = new HumanSessionManager();
