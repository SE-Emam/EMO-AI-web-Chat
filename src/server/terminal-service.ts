import { spawn } from 'node:child_process';
import path from 'node:path';
import type { WorkspaceToolContext } from './workspace-tools.js';
import { resolveWorkspacePath } from './workspace-tools.js';
import { redactSecretsInText } from './secret-redaction.js';
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

const MAX_BUFFER_BYTES = 500_000; // 500 KB limit in bytes
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

export function validateCommandSafety(command: string, args: string[]): { safe: boolean; reason?: string } {
  const baseCmd = path.basename(command).toLowerCase();

  // 1. Check Allowlist
  if (!ALLOWED_EXECUTABLES.has(baseCmd)) {
    return {
      safe: false,
      reason: `COMMAND_NOT_ALLOWED: "${baseCmd}" is not in the allowed executables list (${Array.from(ALLOWED_EXECUTABLES).join(', ')}).`,
    };
  }

  // 2. Dangerous global patterns
  const cmdLine = `${baseCmd} ${args.join(' ')}`;
  for (const rx of DANGEROUS_PATTERNS) {
    if (rx.test(cmdLine)) {
      return { safe: false, reason: `SECURITY_VIOLATION: Command rejected due to dangerous pattern match (${rx}).` };
    }
  }

  // 3. Subcommand and argument safety policies
  if (baseCmd === 'node') {
    for (const a of args) {
      if (a === '-e' || a === '--eval' || a === '-p' || a === '--print') {
        return {
          safe: false,
          reason: 'SECURITY_VIOLATION: Arbitrary string code execution (-e/--eval/-p) in node is prohibited.',
        };
      }
    }
  }

  if (baseCmd === 'python' || baseCmd === 'python3') {
    for (const a of args) {
      if (a === '-c' || a === '-m' || a === '--command') {
        return {
          safe: false,
          reason: `SECURITY_VIOLATION: Arbitrary code execution (${a}) in python is prohibited.`,
        };
      }
    }
  }

  if (baseCmd === 'git') {
    const dangerousGitFlags = ['--upload-pack', '--receive-pack', '--exec-path'];
    for (const a of args) {
      if (dangerousGitFlags.some((f) => a.startsWith(f))) {
        return { safe: false, reason: `SECURITY_VIOLATION: Dangerous git flag "${a}" is prohibited.` };
      }
      if (a === 'config') {
        return { safe: false, reason: 'SECURITY_VIOLATION: Modifying git configuration via terminal is prohibited.' };
      }
    }
  }

  if (baseCmd === 'npm') {
    const dangerousNpmSubcommands = ['exec', 'init'];
    if (args.length > 0 && dangerousNpmSubcommands.includes(args[0])) {
      return { safe: false, reason: `SECURITY_VIOLATION: npm subcommand "${args[0]}" is prohibited.` };
    }
  }

  if (baseCmd === 'npx') {
    return { safe: false, reason: 'SECURITY_VIOLATION: npx arbitrary package execution is prohibited.' };
  }

  return { safe: true };
}

export function sanitizeEnv(baseEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const safe: Record<string, string> = {};
  const secretKeyPattern = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL|PRIVATE|SSH_|AWS_|GITHUB_)/i;

  for (const [k, v] of Object.entries(baseEnv)) {
    if (!v) continue;
    if (secretKeyPattern.test(k)) continue;
    safe[k] = v;
  }
  safe.PATH = baseEnv.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  safe.LANG = 'en_US.UTF-8';
  return safe;
}

export class TerminalService {
  private approvalManagerInstance?: ApprovalManager;
  constructor(approvalManager?: ApprovalManager) {
    this.approvalManagerInstance = approvalManager;
  }
  private get approvalManager(): ApprovalManager {
    return this.approvalManagerInstance || globalApprovalManager;
  }

  async executeCommand(
    params: ExecCommandParams,
    ctx: WorkspaceToolContext,
    clientIdentity = 'Agent'
  ): Promise<ExecCommandResult> {
    const rawCmd = String(params.command || '').trim();
    if (!rawCmd) {
      throw new Error('COMMAND_REQUIRED: The "command" field is required.');
    }

    const baseCmd = path.basename(rawCmd);
    if (rawCmd.includes('/') || rawCmd.includes('\\')) {
      throw new Error(`SECURITY_ERROR: Specifying binary paths is not allowed ("${rawCmd}"). Use standard command name.`);
    }

    const args = Array.isArray(params.args) ? params.args.map((a) => String(a)) : [];

    // Granular Subcommand & Argument Safety Verification
    const safety = validateCommandSafety(baseCmd, args);
    if (!safety.safe) {
      throw new Error(safety.reason || 'SECURITY_VIOLATION: Command rejected by security policy.');
    }

    // Validate working directory with Default Deny
    const targetDir = params.working_directory || ctx.defaultRoot || '.';
    const validatedCwd = resolveWorkspacePath(targetDir, ctx);

    const targetDescription = `${baseCmd} ${args.join(' ')}`.trim();

    // Enforce Approval
    const approvalId = params.approval_id ? String(params.approval_id).trim() : '';
    if (!approvalId) {
      const approvalReq = this.approvalManager.createRequest({
        toolName: 'exec_command',
        clientIdentity,
        target: targetDescription,
        cwd: validatedCwd,
        args: { command: baseCmd, args, working_directory: validatedCwd },
        details: { command: baseCmd, args, cwd: validatedCwd },
      });

      throw new Error(
        `APPROVAL_REQUIRED: Terminal execution of "${targetDescription}" requires explicit user approval. ` +
        `Approval ID: ${approvalReq.id}. Present this to the local user to approve.`
      );
    }

    // Verify and consume approval token (cryptographically bound, single-use)
    const consumed = this.approvalManager.consume({
      id: approvalId,
      toolName: 'exec_command',
      clientIdentity,
      target: targetDescription,
      cwd: validatedCwd,
      args: { command: baseCmd, args, working_directory: validatedCwd },
    });

    if (!consumed) {
      const req = this.approvalManager.getRequest(approvalId);
      const state = req ? req.status : 'not_found';
      throw new Error(
        `APPROVAL_DENIED: Approval ID "${approvalId}" is invalid, expired, tampered, or already consumed (Status: ${state}).`
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
        const currentBytes = Buffer.byteLength(stdoutBuffer, 'utf8');
        if (currentBytes < MAX_BUFFER_BYTES) {
          stdoutBuffer += chunk.toString('utf8');
          if (Buffer.byteLength(stdoutBuffer, 'utf8') >= MAX_BUFFER_BYTES) {
            stdoutBuffer += '\n[truncated: max buffer exceeded]';
            truncated = true;
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const currentBytes = Buffer.byteLength(stderrBuffer, 'utf8');
        if (currentBytes < MAX_BUFFER_BYTES) {
          stderrBuffer += chunk.toString('utf8');
          if (Buffer.byteLength(stderrBuffer, 'utf8') >= MAX_BUFFER_BYTES) {
            stderrBuffer += '\n[truncated: max buffer exceeded]';
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
          target: targetDescription,
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

        // Apply comprehensive secret redaction on terminal outputs
        const cleanStdout = redactSecretsInText(stdoutBuffer);
        const cleanStderr = redactSecretsInText(stderrBuffer);

        resolve({
          stdout: cleanStdout,
          stderr: cleanStderr,
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
