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

export interface CommandPolicyMetadata {
  safe: boolean;
  reason?: string;
  executesCode?: boolean;
  usesNetwork?: boolean;
  installsDependencies?: boolean;
  runsHooksOrScripts?: boolean;
}

const ALLOWED_EXECUTABLES = new Set([
  'git',
  'npm',
  'npx',
  'node',
  'tsc',
  'python3',
  'python',
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

export function validateCommandSafety(command: string, args: string[]): CommandPolicyMetadata {
  const baseCmd = path.basename(command).toLowerCase();

  // 1. Check Allowlist first
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
  if (baseCmd === 'git') {
    const dangerousGitFlags = ['--upload-pack', '--receive-pack', '--exec-path', '--config-env'];
    for (const a of args) {
      if (dangerousGitFlags.some((f) => a.startsWith(f))) {
        return { safe: false, reason: `SECURITY_VIOLATION: Dangerous git flag "${a}" is prohibited.` };
      }
      if (a === '-c' || a.startsWith('-c=')) {
        return { safe: false, reason: 'SECURITY_VIOLATION: Passing arbitrary git -c configuration overrides is prohibited.' };
      }
      if (a === 'config') {
        return { safe: false, reason: 'SECURITY_VIOLATION: Modifying git configuration via terminal is prohibited.' };
      }
    }

    const sub = (args[0] || '').toLowerCase();
    const allowedGitSubs = ['status', 'diff', 'log', 'branch', 'rev-parse', 'show', 'tag', 'describe', 'remote', 'ls-remote'];
    if (sub && !allowedGitSubs.includes(sub)) {
      return { safe: false, reason: `SECURITY_VIOLATION: Git subcommand "${sub}" is not in the approved safe list.` };
    }

    const usesNetwork = sub === 'remote' || sub === 'ls-remote' || args.includes('ls-remote');
    return {
      safe: true,
      executesCode: false,
      usesNetwork,
      installsDependencies: false,
      runsHooksOrScripts: false,
    };
  }

  if (baseCmd === 'npm') {
    const sub = (args[0] || '').toLowerCase();
    const sub2 = (args[1] || '').toLowerCase();

    if (sub === 'exec') {
      return { safe: false, reason: 'SECURITY_VIOLATION: npm exec arbitrary package execution is prohibited.' };
    }
    if (sub === 'init') {
      return { safe: false, reason: 'SECURITY_VIOLATION: npm init is prohibited.' };
    }

    if (sub === 'test' || (sub === 'run' && sub2 === 'test')) {
      return {
        safe: true,
        executesCode: true,
        usesNetwork: false,
        installsDependencies: false,
        runsHooksOrScripts: true,
      };
    }
    if (sub === 'run' && sub2 === 'typecheck') {
      return {
        safe: true,
        executesCode: true,
        usesNetwork: false,
        installsDependencies: false,
        runsHooksOrScripts: false,
      };
    }
    if (sub === 'run' && sub2 === 'build') {
      return {
        safe: true,
        executesCode: true,
        usesNetwork: false,
        installsDependencies: false,
        runsHooksOrScripts: true,
      };
    }
    if (sub === 'run' && sub2 === 'lint') {
      return {
        safe: true,
        executesCode: true,
        usesNetwork: false,
        installsDependencies: false,
        runsHooksOrScripts: false,
      };
    }
    if (sub === 'ci' || sub === 'install') {
      return {
        safe: true,
        executesCode: true,
        usesNetwork: true,
        installsDependencies: true,
        runsHooksOrScripts: true,
      };
    }

    return {
      safe: false,
      reason: `SECURITY_VIOLATION: Arbitrary npm script execution ("${args.join(' ')}") is prohibited by policy.`,
    };
  }

  if (baseCmd === 'npx') {
    return { safe: false, reason: 'SECURITY_VIOLATION: npx arbitrary package execution is prohibited.' };
  }

  if (baseCmd === 'tsc') {
    return {
      safe: true,
      executesCode: false,
      usesNetwork: false,
      installsDependencies: false,
      runsHooksOrScripts: false,
    };
  }

  if (baseCmd === 'echo' || baseCmd === 'pwd' || baseCmd === 'ls' || baseCmd === 'cat' || baseCmd === 'grep' || baseCmd === 'find') {
    return {
      safe: true,
      executesCode: false,
      usesNetwork: false,
      installsDependencies: false,
      runsHooksOrScripts: false,
    };
  }

  if (baseCmd === 'node') {
    for (const a of args) {
      if (a === '-e' || a === '--eval' || a === '-p' || a === '--print') {
        return {
          safe: false,
          reason: 'SECURITY_VIOLATION: Arbitrary string code execution (-e/--eval/-p) in node is prohibited.',
        };
      }
    }
    return {
      safe: false,
      reason: 'SECURITY_VIOLATION: Arbitrary script execution (node <script>) is prohibited by policy.',
    };
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
    return {
      safe: false,
      reason: 'SECURITY_VIOLATION: Arbitrary script execution (python <script>) is prohibited by policy.',
    };
  }

  return {
    safe: false,
    reason: `COMMAND_NOT_ALLOWED: "${baseCmd}" is not in the allowed executables list or violates safety policy.`,
  };
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

    const approvalDetails = {
      command: baseCmd,
      args,
      cwd: validatedCwd,
      affectedPaths: [validatedCwd],
      executesCode: safety.executesCode ?? false,
      usesNetwork: safety.usesNetwork ?? false,
      installsDependencies: safety.installsDependencies ?? false,
      runsHooksOrScripts: safety.runsHooksOrScripts ?? false,
    };

    // Enforce Approval
    const approvalId = params.approval_id ? String(params.approval_id).trim() : '';
    if (!approvalId) {
      const approvalReq = this.approvalManager.createRequest({
        toolName: 'exec_command',
        clientIdentity,
        target: targetDescription,
        cwd: validatedCwd,
        args: { command: baseCmd, args, working_directory: validatedCwd },
        details: approvalDetails,
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
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let truncated = false;
      let killed = false;

      const child = spawn(baseCmd, args, {
        cwd: validatedCwd,
        env: sanitizeEnv(),
        shell: false, // CRITICAL: NEVER shell: true!
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const killProcessTree = (signal: NodeJS.Signals = 'SIGTERM') => {
        if (!child.pid) return;
        try {
          process.kill(-child.pid, signal);
        } catch {
          try {
            child.kill(signal);
          } catch {}
        }
      };

      const timer = setTimeout(() => {
        killed = true;
        killProcessTree('SIGTERM');
        setTimeout(() => {
          killProcessTree('SIGKILL');
        }, 1_500);
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdoutBytes >= MAX_BUFFER_BYTES) {
          if (!truncated) {
            truncated = true;
            stdoutBuffer += '\n[truncated: max buffer exceeded]';
          }
          child.stdout.pause();
          return;
        }
        const remaining = MAX_BUFFER_BYTES - stdoutBytes;
        const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        stdoutBuffer += slice.toString('utf8');
        stdoutBytes += slice.length;
        if (chunk.length > remaining) {
          truncated = true;
          stdoutBuffer += '\n[truncated: max buffer exceeded]';
          child.stdout.pause();
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrBytes >= MAX_BUFFER_BYTES) {
          if (!truncated) {
            truncated = true;
            stderrBuffer += '\n[truncated: max buffer exceeded]';
          }
          child.stderr.pause();
          return;
        }
        const remaining = MAX_BUFFER_BYTES - stderrBytes;
        const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        stderrBuffer += slice.toString('utf8');
        stderrBytes += slice.length;
        if (chunk.length > remaining) {
          truncated = true;
          stderrBuffer += '\n[truncated: max buffer exceeded]';
          child.stderr.pause();
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
