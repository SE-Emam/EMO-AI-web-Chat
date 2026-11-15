import { randomUUID, createHash, randomBytes } from 'node:crypto';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'consumed';

export interface ApprovalRequest {
  id: string;
  toolName: string;
  clientIdentity: string;
  target: string;
  argsHash: string;
  nonce: string;
  details: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
  status: ApprovalStatus;
  decisionBy?: string;
  decisionAt?: number;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  approvalId?: string;
  toolName: string;
  clientIdentity: string;
  target: string;
  decision: 'requested' | 'approved' | 'rejected' | 'executed' | 'failed';
  affectedPaths?: string[];
  details?: Record<string, unknown>;
}

export class ApprovalManager {
  private requests = new Map<string, ApprovalRequest>();
  private auditLogs: AuditLogEntry[] = [];
  private readonly defaultTtlMs: number;

  constructor(options?: { defaultTtlMs?: number }) {
    this.defaultTtlMs = options?.defaultTtlMs ?? 120_000; // 2 minutes TTL
  }

  static hashArgs(args: unknown): string {
    const raw = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
    // Exclude approval_id itself from the hash if present so hash matches pre- and post-approval
    const { approval_id: _ignored, ...filtered } = raw;
    const sortedKeys = Object.keys(filtered).sort();
    const sortedObj: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      sortedObj[k] = filtered[k];
    }
    return createHash('sha256').update(JSON.stringify(sortedObj)).digest('hex');
  }

  createRequest(params: {
    toolName: string;
    clientIdentity: string;
    target: string;
    args: unknown;
    ttlMs?: number;
    details?: Record<string, unknown>;
  }): ApprovalRequest {
    const id = randomUUID();
    const now = Date.now();
    const ttl = params.ttlMs ?? this.defaultTtlMs;
    const nonce = randomBytes(16).toString('hex');
    const argsHash = ApprovalManager.hashArgs(params.args);

    const req: ApprovalRequest = {
      id,
      toolName: params.toolName,
      clientIdentity: params.clientIdentity,
      target: params.target,
      argsHash,
      nonce,
      details: params.details || {},
      createdAt: now,
      expiresAt: now + ttl,
      status: 'pending',
    };

    this.requests.set(id, req);
    this.logAudit({
      approvalId: id,
      toolName: params.toolName,
      clientIdentity: params.clientIdentity,
      target: params.target,
      decision: 'requested',
      details: { expiresAt: req.expiresAt },
    });

    return { ...req };
  }

  getRequest(id: string): ApprovalRequest | null {
    const req = this.requests.get(id);
    if (!req) return null;
    if (req.status === 'pending' && Date.now() > req.expiresAt) {
      req.status = 'expired';
    }
    return { ...req };
  }

  listRequests(status?: ApprovalStatus): ApprovalRequest[] {
    const now = Date.now();
    const results: ApprovalRequest[] = [];
    for (const req of this.requests.values()) {
      if (req.status === 'pending' && now > req.expiresAt) {
        req.status = 'expired';
      }
      if (!status || req.status === status) {
        results.push({ ...req });
      }
    }
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  approve(id: string, actor = 'local_user'): ApprovalRequest {
    const actorLower = actor.toLowerCase();
    if (actorLower.includes('agent') || actorLower.includes('subagent') || actorLower.includes('model')) {
      throw new Error('SECURITY_VIOLATION: Agents are strictly forbidden from self-approving operations.');
    }
    const req = this.requests.get(id);
    if (!req) throw new Error(`APPROVAL_NOT_FOUND: Request "${id}" not found.`);
    if (req.status === 'pending' && Date.now() > req.expiresAt) {
      req.status = 'expired';
    }
    if (req.status !== 'pending') {
      throw new Error(`INVALID_APPROVAL_STATE: Cannot approve request in state "${req.status}".`);
    }

    req.status = 'approved';
    req.decisionBy = actor;
    req.decisionAt = Date.now();

    this.logAudit({
      approvalId: id,
      toolName: req.toolName,
      clientIdentity: req.clientIdentity,
      target: req.target,
      decision: 'approved',
      details: { actor },
    });

    return { ...req };
  }

  reject(id: string, actor = 'local_user'): ApprovalRequest {
    const req = this.requests.get(id);
    if (!req) throw new Error(`APPROVAL_NOT_FOUND: Request "${id}" not found.`);
    if (req.status !== 'pending') {
      throw new Error(`INVALID_APPROVAL_STATE: Cannot reject request in state "${req.status}".`);
    }

    req.status = 'rejected';
    req.decisionBy = actor;
    req.decisionAt = Date.now();

    this.logAudit({
      approvalId: id,
      toolName: req.toolName,
      clientIdentity: req.clientIdentity,
      target: req.target,
      decision: 'rejected',
      details: { actor },
    });

    return { ...req };
  }

  consume(id: string, args: unknown): boolean {
    const req = this.requests.get(id);
    if (!req) return false;
    if (req.status !== 'approved') return false;
    if (Date.now() > req.expiresAt) {
      req.status = 'expired';
      return false;
    }

    const currentHash = ApprovalManager.hashArgs(args);
    if (currentHash !== req.argsHash) {
      this.logAudit({
        approvalId: id,
        toolName: req.toolName,
        clientIdentity: req.clientIdentity,
        target: req.target,
        decision: 'failed',
        details: { reason: 'ARGUMENTS_MISMATCH' },
      });
      return false;
    }

    // Mark single-use consumption
    req.status = 'consumed';
    this.logAudit({
      approvalId: id,
      toolName: req.toolName,
      clientIdentity: req.clientIdentity,
      target: req.target,
      decision: 'executed',
    });
    return true;
  }

  logAudit(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): void {
    const record: AuditLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.auditLogs.push(record);
    if (this.auditLogs.length > 1000) {
      this.auditLogs.shift();
    }
  }

  getAuditLogs(limit = 100): AuditLogEntry[] {
    return this.auditLogs.slice(-limit).reverse();
  }
}

export const globalApprovalManager = new ApprovalManager();
