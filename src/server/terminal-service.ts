import { spawn } from 'node:child_process';
import path from 'node:path';
import type { WorkspaceToolContext } from './workspace-tools.js';
import { resolveWorkspacePath } from './workspace-tools.js';
import { globalApprovalManager, type ApprovalManager } from './approval-manager.js';

export interface ExecCommandParams {
  command: string;
  args?: string[];
  working_directory?: string;
  timeout_ms?: number;
  approval_id?: string;
}

export interface ExecCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  approvalId?: string;
  truncated?: boolean;
}

const ALLOWED_EXECUTABLES = new Set([
  'git',
  'npm',
  'npx',
  'node',
  'tsc',
  'python3',
  'python',
  'cargo',
  'go',
  'make',
  'echo',
  'ls',
  'cat',
  'grep',
  'find',
  'pwd',
]);

const DANGEROUS_PATTERNS = [
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bchgrp\b/i,
  /\bmkfs\b/i,
  /\bdd\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\brm\s+-rf\b/i,
];

const MAX_BUFFER_BYTES = 500_000; // 500 KB
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

export function sanitizeEnv(baseEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const safe: Record<string, string> = {};
  const secretKeyPattern = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL|PRIVATE|SSH_|AWS_|GITHUB_)/i;

  for (const [k, v] of Object.entries(baseEnv)) {
    if (!v) continue;
    if (secretKeyPattern.test(k)) continue;
    safe[k] = v;
  }
  // Standard safe paths
  safe.PATH = baseEnv.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  safe.LANG = 'en_US.UTF-8';
  return safe;
}

export class TerminalService {
  constructor(private readonly approvalManager: ApprovalManager = globalApprovalManager) {}

  async executeCommand(
    params: ExecCommandParams,
    ctx: WorkspaceToolContext,
    clientIdentity = 'Agent'
  ): Promise<ExecCommandResult> {
    const rawCmd = String(params.command || '').trim();
    if (!rawCmd) {
      throw new Error('COMMAND_REQUIRED: The "command" field is required.');
    }

    // Security: reject shell paths and unapproved executables
    const baseCmd = path.basename(rawCmd);
    if (rawCmd.includes('/') || rawCmd.includes('\\')) {
      throw new Error(`SECURITY_ERROR: Specifying binary paths is not allowed ("${rawCmd}"). Use standard command name.`);
    }

    if (!ALLOWED_EXECUTABLES.has(baseCmd)) {
      throw new Error(
        `COMMAND_NOT_ALLOWED: "${baseCmd}" is not in the allowed executables list (${Array.from(ALLOWED_EXECUTABLES).join(', ')}).`
      );
    }

    const args = Array.isArray(params.args) ? params.args.map((a) => String(a)) : [];

    // Check for dangerous arguments
    const cmdLine = `${baseCmd} ${args.join(' ')}`;
    for (const rx of DANGEROUS_PATTERNS) {
      if (rx.test(cmdLine)) {
        throw new Error(`SECURITY_VIOLATION: Command rejected due to dangerous pattern match (${rx}).`);
      }
    }

    // Validate working directory with Default Deny
    const targetDir = params.working_directory || ctx.defaultRoot || '.';
    const validatedCwd = resolveWorkspacePath(targetDir, ctx);

    // Enforce Approval
    const approvalId = params.approval_id ? String(params.approval_id).trim() : '';
    if (!approvalId) {
      const approvalReq = this.approvalManager.createRequest({
        toolName: 'exec_command',
        clientIdentity,
        target: `${baseCmd} ${args.join(' ')} (cwd: ${validatedCwd})`,
        args: { command: baseCmd, args, working_directory: validatedCwd },
        details: { command: baseCmd, args, cwd: validatedCwd },
      });

      throw new Error(
        `APPROVAL_REQUIRED: Terminal execution of "${baseCmd} ${args.join(' ')}" requires explicit user approval. ` +
        `Approval ID: ${approvalReq.id}. Present this to the local user to approve.`
      );
    }

    // Verify and consume approval token (single-use)
    const consumed = this.approvalManager.consume(approvalId, {
      command: baseCmd,
      args,
      working_directory: validatedCwd,
    });

    if (!consumed) {
      const req = this.approvalManager.getRequest(approvalId);
      const state = req ? req.status : 'not_found';
      throw new Error(
        `APPROVAL_DENIED: Approval ID "${approvalId}" is invalid, expired, or already consumed (Status: ${state}).`
      );
    }

    const timeoutMs = Math.min(Math.max(Number(params.timeout_ms) || DEFAULT_TIMEOUT_MS, 1_000), MAX_TIMEOUT_MS);
    const start = Date.now();

    return new Promise<ExecCommandResult>((resolve, reject) => {
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let truncated = false;
      let killed = false;

      const child = spawn(baseCmd, args, {
        cwd: validatedCwd,
        env: sanitizeEnv(),
        shell: false, // CRITICAL: NEVER shell: true!
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 2_000);
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdoutBuffer.length < MAX_BUFFER_BYTES) {
          stdoutBuffer += chunk.toString('utf8');
          if (stdoutBuffer.length >= MAX_BUFFER_BYTES) {
            stdoutBuffer = stdoutBuffer.slice(0, MAX_BUFFER_BYTES) + '\n[truncated: max buffer exceeded]';
            truncated = true;
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrBuffer.length < MAX_BUFFER_BYTES) {
          stderrBuffer += chunk.toString('utf8');
          if (stderrBuffer.length >= MAX_BUFFER_BYTES) {
            stderrBuffer = stderrBuffer.slice(0, MAX_BUFFER_BYTES) + '\n[truncated: max buffer exceeded]';
            truncated = true;
          }
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        this.approvalManager.logAudit({
          approvalId,
          toolName: 'exec_command',
          clientIdentity,
          target: `${baseCmd} ${args.join(' ')}`,
          decision: 'failed',
          details: { error: err.message },
        });
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - start;
        if (killed) {
          return reject(new Error(`COMMAND_TIMEOUT: Command timed out after ${timeoutMs}ms.`));
        }

        resolve({
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
          exitCode: code,
          durationMs,
          approvalId,
          truncated,
        });
      });
    });
  }
}

export const globalTerminalService = new TerminalService();
