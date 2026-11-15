import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { redactSecretsInText } from './secret-redaction.js';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'consumed';

export interface ApprovalRequest {
  id: string;
  toolName: string;
  clientIdentity: string;
  target: string;
  cwd: string;
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
  private consumingLocks = new Set<string>();

  constructor(options?: { defaultTtlMs?: number }) {
    this.defaultTtlMs = options?.defaultTtlMs ?? 120_000; // 2 minutes TTL
  }

  static computeBindingHash(params: {
    toolName: string;
    clientIdentity: string;
    target: string;
    cwd?: string;
    args: unknown;
  }): string {
    const raw = params.args && typeof params.args === 'object' ? (params.args as Record<string, unknown>) : {};
    const { approval_id: _ignored, ...filtered } = raw;
    const sortedKeys = Object.keys(filtered).sort();
    const sortedArgs: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      sortedArgs[k] = filtered[k];
    }
    const payload = {
      toolName: params.toolName,
      clientIdentity: params.clientIdentity,
      target: params.target,
      cwd: params.cwd || '',
      args: sortedArgs,
    };
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  createRequest(params: {
    toolName: string;
    clientIdentity: string;
    target: string;
    cwd?: string;
    args: unknown;
    ttlMs?: number;
    details?: Record<string, unknown>;
  }): ApprovalRequest {
    const id = randomUUID();
    const now = Date.now();
    const ttl = params.ttlMs ?? this.defaultTtlMs;
    const nonce = randomBytes(16).toString('hex');
    const cwd = params.cwd || '';

    const argsHash = ApprovalManager.computeBindingHash({
      toolName: params.toolName,
      clientIdentity: params.clientIdentity,
      target: params.target,
      cwd,
      args: params.args,
    });

    const safeDetails: Record<string, unknown> = {};
    if (params.details) {
      for (const [k, v] of Object.entries(params.details)) {
        safeDetails[k] = typeof v === 'string' ? redactSecretsInText(v) : v;
      }
    }

    const req: ApprovalRequest = {
      id,
      toolName: params.toolName,
      clientIdentity: params.clientIdentity,
      target: params.target,
      cwd,
      argsHash,
      nonce,
      details: safeDetails,
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
      details: { cwd, expiresAt: req.expiresAt },
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

  approve(id: string, actor: string): ApprovalRequest {
    // SECURITY: Strictly require admin identity. Never accept client/agent identities
    const cleanActor = String(actor || '').trim();
    if (!cleanActor.startsWith('admin:') && cleanActor !== 'local_admin_session') {
      throw new Error(
        `SECURITY_VIOLATION: Approvals cannot be performed by agent or untrusted entity "${cleanActor}". Admin authentication required, self-approval by agents is strictly forbidden.`
      );
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
    req.decisionBy = cleanActor;
    req.decisionAt = Date.now();

    this.logAudit({
      approvalId: id,
      toolName: req.toolName,
      clientIdentity: req.clientIdentity,
      target: req.target,
      decision: 'approved',
      details: { actor: cleanActor },
    });

    return { ...req };
  }

  reject(id: string, actor: string): ApprovalRequest {
    const cleanActor = String(actor || '').trim();
    if (!cleanActor.startsWith('admin:') && cleanActor !== 'local_admin_session') {
      throw new Error(
        `SECURITY_VIOLATION: Rejections cannot be performed by agent or untrusted entity "${cleanActor}". Admin authentication required, rejection by agents is strictly forbidden.`
      );
    }

    const req = this.requests.get(id);
    if (!req) throw new Error(`APPROVAL_NOT_FOUND: Request "${id}" not found.`);
    if (req.status !== 'pending') {
      throw new Error(`INVALID_APPROVAL_STATE: Cannot reject request in state "${req.status}".`);
    }

    req.status = 'rejected';
    req.decisionBy = cleanActor;
    req.decisionAt = Date.now();

    this.logAudit({
      approvalId: id,
      toolName: req.toolName,
      clientIdentity: req.clientIdentity,
      target: req.target,
      decision: 'rejected',
      details: { actor: cleanActor },
    });

    return { ...req };
  }

  consume(params: {
    id: string;
    toolName: string;
    clientIdentity: string;
    target: string;
    cwd?: string;
    args: unknown;
  }): boolean {
    const { id, toolName, clientIdentity, target, cwd, args } = params;

    // Mutex lock against concurrent consumption race conditions
    if (this.consumingLocks.has(id)) {
      return false;
    }
    this.consumingLocks.add(id);

    try {
      const req = this.requests.get(id);
      if (!req) return false;
      if (req.status !== 'approved') return false;
      if (Date.now() > req.expiresAt) {
        req.status = 'expired';
        return false;
      }

      // Check tool binding
      if (req.toolName !== toolName) {
        this.logAudit({
          approvalId: id,
          toolName,
          clientIdentity,
          target,
          decision: 'failed',
          details: { reason: `TOOL_MISMATCH: requested for ${req.toolName}, attempted for ${toolName}` },
        });
        return false;
      }

      // Check target binding
      if (req.target !== target) {
        this.logAudit({
          approvalId: id,
          toolName,
          clientIdentity,
          target,
          decision: 'failed',
          details: { reason: `TARGET_MISMATCH: requested for ${req.target}, attempted for ${target}` },
        });
        return false;
      }

      // Check client identity binding
      if (req.clientIdentity !== clientIdentity) {
        this.logAudit({
          approvalId: id,
          toolName,
          clientIdentity,
          target,
          decision: 'failed',
          details: { reason: `CLIENT_MISMATCH: requested by ${req.clientIdentity}, attempted by ${clientIdentity}` },
        });
        return false;
      }

      // Check full cryptographic binding hash (args + cwd + target + toolName)
      const currentHash = ApprovalManager.computeBindingHash({
        toolName,
        clientIdentity,
        target,
        cwd,
        args,
      });

      if (currentHash !== req.argsHash) {
        this.logAudit({
          approvalId: id,
          toolName,
          clientIdentity,
          target,
          decision: 'failed',
          details: { reason: 'ARGUMENTS_MISMATCH: arguments or parameters tampered after approval' },
        });
        return false;
      }

      // Atomic single-use state transition
      req.status = 'consumed';
      this.logAudit({
        approvalId: id,
        toolName,
        clientIdentity,
        target,
        decision: 'executed',
      });
      return true;
    } finally {
      this.consumingLocks.delete(id);
    }
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
