/**
 * Workspace file tools — the capability the gateway lends to the agents it
 * binds (Cline, VS Code, OpenCode, Hermes, ChatGPT, …).
 *
 * SAFETY & HARDENING:
 *  - DEFAULT DENY: If no workspace roots are authorized, all file operations
 *    are immediately rejected with OUTSIDE_WORKSPACE.
 *  - SYMLINK PROTECTION: Every path and symlink target is verified with realpathSync
 *    to prevent symlink traversal attacks.
 *  - SENSITIVE FILES: .env*, *.pem, *.key, id_rsa*, .ssh/*, .aws/* and system credentials
 *    are blocked by default.
 *  - SECRET REDACTION: Secret tokens, passwords, and API keys are redacted before
 *    leaving the module in both read_file and search_files.
 *  - 1-BASED OFFSET: read_file lines offset is strictly 1-based (offset: 1 is the first line).
 *  - ATOMIC WRITES: write_file and edit_file write to .tmp before atomic rename.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { globalTerminalService } from './terminal-service.js';
import type { ApprovalManager } from './approval-manager.js';
export { redactSecretsInText } from './secret-redaction.js';
import { redactSecretsInText } from './secret-redaction.js';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface WorkspaceToolContext {
  /** Absolute directories the tools may touch. Empty means DEFAULT DENY. */
  roots: string[];
  /** Root used to resolve relative paths. */
  defaultRoot: string;
  /** Maximum bytes a single read may return. */
  maxReadBytes?: number;
  /** Optional approval manager for requiring user approval on mutating tools. */
  approvalManager?: ApprovalManager;
  /** Name of the client agent calling the tool. */
  clientIdentity?: string;
}

export interface WorkspaceToolResult {
  content: string;
  isError?: boolean;
  structured?: unknown;
}

const MAX_READ_BYTES = 400_000;
const MAX_LIST_ENTRIES = 500;
const MAX_SEARCH_RESULTS = 200;

// Blocked sensitive file patterns
const SENSITIVE_FILE_REGEX = /(^|\/)(\.env(\..+)?|.*\.pem|.*\.key|.*\.pfx|.*\.p12|id_rsa.*|id_ed25519.*|id_ecdsa.*|credentials(\..+)?|secrets?(\..+)?|\.git-credentials|\.netrc)$/i;
const SENSITIVE_DIR_REGEX = /(^|\/)(\.ssh|\.aws|\.gnupg|\.kube|\.docker)(\/|$)/i;

export function isSensitiveFile(targetPath: string): boolean {
  const norm = targetPath.replace(/\\/g, '/');
  const base = path.basename(norm);
  if (base === '.env.example' || base === '.env.sample' || base === '.env.template') {
    return false;
  }
  return SENSITIVE_FILE_REGEX.test(base) || SENSITIVE_DIR_REGEX.test(norm);
}

// redactSecretsInText re-exported from ./secret-redaction.js

/** The tools every bound agent can use. */
export const WORKSPACE_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description:
      'Read one file from the local workspace and return its content. The path may be ABSOLUTE inside an approved workspace root or relative to a root. Line offset is 1-based (first line is 1). Sensitive credential files are blocked and secrets are redacted.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path inside an approved workspace root, or a path relative to a root.' },
        offset: { type: 'number', description: 'First line to read (1-based, where 1 is the first line).' },
        limit: { type: 'number', description: 'Maximum number of lines to read.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write a file atomically (creating it when needed) and return the number of bytes written.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path, or a path relative to the workspace root.' },
        content: { type: 'string', description: 'The full new content of the file.' },
        approval_id: { type: 'string', description: 'Optional approval token if required.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace an exact string inside a file atomically. The old string must exist exactly once (unless replace_all is set).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' },
        approval_id: { type: 'string', description: 'Optional approval token if required.' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'list_directory',
    description:
      'List the entries of one folder (name, type and size). The path must stay inside an approved workspace root.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path inside an approved workspace root, or a path relative to a root.' } },
      required: ['path'],
    },
  },
  {
    name: 'list_codebase',
    description: 'List the project tree below a directory (files and folders).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        recursive: { type: 'boolean' },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_directory',
    description: 'Create a directory (including missing parents).',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'move_file',
    description: 'Move or rename a file or directory inside the approved workspace.',
    parameters: {
      type: 'object',
      properties: {
        source_path: { type: 'string' },
        destination_path: { type: 'string' },
        approval_id: { type: 'string', description: 'Optional approval token if required.' },
      },
      required: ['source_path', 'destination_path'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file inside the approved workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        approval_id: { type: 'string', description: 'Optional approval token if required.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description: 'Search the workspace for a regular expression. Secrets are automatically redacted from search output.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Starting directory.' },
        regex: { type: 'string', description: 'Regular expression to search for.' },
        file_pattern: { type: 'string', description: 'Only search files matching this glob (e.g. *.ts).' },
      },
      required: ['path', 'regex'],
    },
  },
  {
    name: 'exec_command',
    description: 'Execute an approved CLI command inside the workspace (git, npm, npx, node, tsc, python3, etc.).',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Approved executable name (e.g. git, npm, tsc).' },
        args: { type: 'array', items: { type: 'string' }, description: 'Command arguments.' },
        working_directory: { type: 'string', description: 'Directory inside authorized workspace roots.' },
        timeout_ms: { type: 'number', description: 'Timeout in ms (default 30000).' },
        approval_id: { type: 'string', description: 'Approval ID approved by local user.' },
      },
      required: ['command'],
    },
  },
];

/** True when `child` is inside `parent`. */
export function isInside(child: string, parent: string): boolean {
  const normChild = path.resolve(child);
  const normParent = path.resolve(parent);
  const rel = path.relative(normParent, normChild);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolves the real path on filesystem, handling non-existing tails safely.
 */
export function realPathForCheck(p: string): string {
  let probe = path.resolve(p);
  const tail: string[] = [];
  for (let i = 0; i < 40; i++) {
    try {
      const real = fs.realpathSync(probe);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      tail.push(path.basename(probe));
      probe = parent;
    }
  }
  return path.resolve(p);
}

/**
 * Resolves a path and proves it stays inside the allowed roots.
 * Enforces DEFAULT DENY when roots are empty.
 * Prevents null bytes and symlink traversal out of bounds.
 */
export function resolveWorkspacePath(input: string, ctx: WorkspaceToolContext): string {
  // 1. DEFAULT DENY
  if (!ctx.roots || ctx.roots.length === 0) {
    throw new Error(
      'OUTSIDE_WORKSPACE: No workspace roots are authorized (Default Deny). Please configure authorized workspace folders in Gateway Settings.'
    );
  }

  const raw = String(input || '').trim();
  if (!raw) throw new Error('path is required');

  // 2. Reject null bytes and path corruption
  if (raw.includes('\0')) {
    throw new Error('INVALID_PATH: Null byte detected in path.');
  }

  // 3. Resolve absolute target
  const abs = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(ctx.defaultRoot || ctx.roots[0], raw);

  // 4. Resolve real paths
  const realRoots = ctx.roots.map((r) => realPathForCheck(r));
  const realTarget = realPathForCheck(abs);

  let isSymlink = false;
  try {
    isSymlink = fs.lstatSync(abs).isSymbolicLink();
  } catch {}

  // 5. Containment check on real paths
  const ok = realRoots.some((root) => isInside(realTarget, root));
  if (!ok) {
    if (isSymlink) {
      throw new Error(
        `OUTSIDE_WORKSPACE: Symbolic link "${raw}" points outside the authorized workspace (${realTarget}). Access denied.`
      );
    }
    throw new Error(
      `OUTSIDE_WORKSPACE: "${raw}" is outside the allowed workspace (${ctx.roots.join(', ')}). The other tools still work.`
    );
  }

  // 6. Symlink traversal check for existing symlinks
  try {
    const lstat = fs.lstatSync(abs);
    if (lstat.isSymbolicLink()) {
      const symTarget = fs.realpathSync(abs);
      const symInside = realRoots.some((root) => isInside(symTarget, root));
      if (!symInside) {
        throw new Error(
          `OUTSIDE_WORKSPACE: Symbolic link "${raw}" points outside the authorized workspace (${symTarget}). Access denied.`
        );
      }
    }
  } catch (err: any) {
    if (err.message?.includes('OUTSIDE_WORKSPACE')) throw err;
    // Target might not exist yet (e.g. for write_file)
  }

  return abs;
}

async function statOrNull(p: string): Promise<fs.Stats | null> {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

const BINARY_EXTENSIONS = new Set([
  '.pdf', '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt',
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp', '.tiff',
  '.zip', '.tar', '.gz', '.7z', '.rar',
  '.mp3', '.mp4', '.wav', '.mov', '.avi',
  '.exe', '.bin', '.dylib', '.so', '.dll',
]);

/** Executes one workspace tool. */
export async function callWorkspaceTool(
  name: string,
  rawArgs: unknown,
  ctx: WorkspaceToolContext
): Promise<WorkspaceToolResult> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
  const str = (k: string): string => String(args[k] ?? '');

  switch (name) {
    case 'read_file': {
      const file = resolveWorkspacePath(str('path'), ctx);

      // Sensitive file check
      if (isSensitiveFile(file)) {
        throw new Error(
          `ACCESS_DENIED: Access to sensitive credential file is blocked: ${path.basename(file)}`
        );
      }

      const st = await statOrNull(file);
      if (!st) throw new Error(`FILE_NOT_FOUND: ${file}`);
      if (st.isDirectory()) throw new Error(`IS_A_DIRECTORY: ${file} is a directory — use list_directory.`);

      const ext = path.extname(file).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) {
        return {
          content: `[Binary document: ${ext.replace(/^\./, '').toUpperCase()}, size: ${st.size} bytes. Direct text viewing is not supported.]`,
          structured: { path: file, bytes: st.size, isBinary: true, format: ext },
        };
      }

      const maxBytes = ctx.maxReadBytes ?? MAX_READ_BYTES;
      const handle = await fsp.open(file, 'r');
      try {
        const size = Math.min(st.size, maxBytes);
        const buffer = Buffer.alloc(size);
        await handle.read(buffer, 0, size, 0);

        // Check for binary data
        for (let i = 0; i < Math.min(size, 512); i++) {
          if (buffer[i] === 0) {
            return {
              content: `[Binary file detected, size: ${st.size} bytes. Text rendering skipped.]`,
              structured: { path: file, bytes: st.size, isBinary: true },
            };
          }
        }

        let text = buffer.toString('utf8');
        const offset = Number(args.offset || 0);
        const limit = Number(args.limit || 0);

        if (offset > 0 || limit > 0) {
          const lines = text.split('\n');
          // 1-BASED OFFSET FIX: offset 1 is index 0
          const start = offset > 0 ? Math.max(0, offset - 1) : 0;
          const end = limit > 0 ? start + limit : lines.length;
          text = lines.slice(start, end).join('\n');
        }

        text = redactSecretsInText(text);
        const truncated = st.size > maxBytes;
        return {
          content:
            text +
            (truncated
              ? `\n\n[truncated: the file is ${st.size} bytes, only the first ${maxBytes} were returned]`
              : ''),
          structured: { path: file, bytes: st.size, truncated },
        };
      } finally {
        await handle.close();
      }
    }

    case 'write_file': {
      const file = resolveWorkspacePath(str('path'), ctx);

      if (isSensitiveFile(file)) {
        throw new Error(
          `ACCESS_DENIED: Modifying sensitive credential file is blocked: ${path.basename(file)}`
        );
      }

      // Check approval if required
      if (ctx.approvalManager) {
        const approvalId = args.approval_id ? String(args.approval_id).trim() : '';
        if (!approvalId) {
          const req = ctx.approvalManager.createRequest({
            toolName: 'write_file',
            clientIdentity: ctx.clientIdentity || 'Agent',
            target: file,
            args,
            details: { path: file, bytes: Buffer.byteLength(String(args.content || ''), 'utf8') },
          });
          throw new Error(
            `APPROVAL_REQUIRED: Operation write_file on "${file}" requires approval. Approval ID: ${req.id}`
          );
        }
        const ok = ctx.approvalManager.consume({
          id: approvalId,
          toolName: 'write_file',
          clientIdentity: ctx.clientIdentity || 'Agent',
          target: file,
          args,
        });
        if (!ok) {
          throw new Error(`APPROVAL_DENIED: Approval ID "${approvalId}" is invalid, expired, or already consumed.`);
        }
      }

      const content = typeof args.content === 'string' ? args.content : '';
      await fsp.mkdir(path.dirname(file), { recursive: true });

      // ATOMIC WRITE
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fsp.writeFile(tmp, content, 'utf8');
      await fsp.rename(tmp, file);

      return {
        content: `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${file}`,
        structured: { path: file, bytes: Buffer.byteLength(content, 'utf8') },
      };
    }

    case 'edit_file': {
      const file = resolveWorkspacePath(str('path'), ctx);

      if (isSensitiveFile(file)) {
        throw new Error(
          `ACCESS_DENIED: Modifying sensitive credential file is blocked: ${path.basename(file)}`
        );
      }

      if (ctx.approvalManager) {
        const approvalId = args.approval_id ? String(args.approval_id).trim() : '';
        if (!approvalId) {
          const req = ctx.approvalManager.createRequest({
            toolName: 'edit_file',
            clientIdentity: ctx.clientIdentity || 'Agent',
            target: file,
            args,
            details: { path: file },
          });
          throw new Error(
            `APPROVAL_REQUIRED: Operation edit_file on "${file}" requires approval. Approval ID: ${req.id}`
          );
        }
        const ok = ctx.approvalManager.consume({
          id: approvalId,
          toolName: 'edit_file',
          clientIdentity: ctx.clientIdentity || 'Agent',
          target: file,
          args,
        });
        if (!ok) {
          throw new Error(`APPROVAL_DENIED: Approval ID "${approvalId}" is invalid, expired, or already consumed.`);
        }
      }

      const oldStr = typeof args.old_string === 'string' ? args.old_string : '';
      const newStr = typeof args.new_string === 'string' ? args.new_string : '';
      if (!oldStr) throw new Error('old_string is required');

      const original = await fsp.readFile(file, 'utf8');
      const occurrences = original.split(oldStr).length - 1;
      if (occurrences === 0) throw new Error(`old_string was not found in ${file}`);
      if (occurrences > 1 && args.replace_all !== true) {
        throw new Error(
          `old_string appears ${occurrences} times in ${file} — provide more context or set replace_all.`
        );
      }

      const updated =
        args.replace_all === true ? original.split(oldStr).join(newStr) : original.replace(oldStr, newStr);

      // ATOMIC WRITE
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fsp.writeFile(tmp, updated, 'utf8');
      await fsp.rename(tmp, file);

      return { content: `Edited ${file}`, structured: { path: file, occurrences } };
    }

    case 'list_directory': {
      const dir = resolveWorkspacePath(str('path') || '.', ctx);
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const rows = await Promise.all(
        entries.slice(0, MAX_LIST_ENTRIES).map(async (e) => {
          const full = path.join(dir, e.name);
          const st = e.isDirectory() ? null : await statOrNull(full);
          return `${e.isDirectory() ? 'dir ' : 'file'}  ${e.name}${st ? `  (${st.size} bytes)` : ''}`;
        })
      );
      return {
        content: rows.length ? rows.join('\n') : '(empty directory)',
        structured: { path: dir, count: entries.length },
      };
    }

    case 'list_codebase': {
      const dir = resolveWorkspacePath(str('path') || '.', ctx);
      const recursive = args.recursive !== false;
      const lines: string[] = [];
      const walk = async (current: string, depth: number): Promise<void> => {
        if (lines.length >= MAX_LIST_ENTRIES || depth > 6) return;
        let entries: fs.Dirent[];
        try {
          entries = await fsp.readdir(current, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (lines.length >= MAX_LIST_ENTRIES) return;
          if (e.name.startsWith('.') && e.name !== '.env.example') continue;
          const full = path.join(current, e.name);
          const rel = path.relative(dir, full) || e.name;
          if (e.isDirectory()) {
            lines.push(`${rel}/`);
            if (recursive) await walk(full, depth + 1);
          } else {
            lines.push(rel);
          }
        }
      };
      await walk(dir, 0);
      return {
        content: lines.length ? lines.join('\n') : '(empty)',
        structured: { path: dir, count: lines.length },
      };
    }

    case 'create_directory': {
      const dir = resolveWorkspacePath(str('path'), ctx);
      await fsp.mkdir(dir, { recursive: true });
      return { content: `Created directory ${dir}`, structured: { path: dir } };
    }

    case 'move_file': {
      const from = resolveWorkspacePath(str('source_path'), ctx);
      const to = resolveWorkspacePath(str('destination_path'), ctx);

      if (isSensitiveFile(from) || isSensitiveFile(to)) {
        throw new Error('ACCESS_DENIED: Moving sensitive credential files is blocked.');
      }

      if (ctx.approvalManager) {
        const approvalId = args.approval_id ? String(args.approval_id).trim() : '';
        if (!approvalId) {
          const req = ctx.approvalManager.createRequest({
            toolName: 'move_file',
            clientIdentity: ctx.clientIdentity || 'Agent',
            target: `${from} → ${to}`,
            args,
            details: { from, to },
          });
          throw new Error(
            `APPROVAL_REQUIRED: Operation move_file requires approval. Approval ID: ${req.id}`
          );
        }
        const ok = ctx.approvalManager.consume({
          id: approvalId,
          toolName: 'move_file',
          clientIdentity: ctx.clientIdentity || 'Agent',
          target: `${from} → ${to}`,
          args,
        });
        if (!ok) {
          throw new Error(`APPROVAL_DENIED: Approval ID "${approvalId}" is invalid, expired, or already consumed.`);
        }
      }

      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.rename(from, to);
      return { content: `Moved ${from} → ${to}`, structured: { from, to } };
    }

    case 'delete_file': {
      const file = resolveWorkspacePath(str('path'), ctx);

      if (isSensitiveFile(file)) {
        throw new Error('ACCESS_DENIED: Deleting sensitive credential files is blocked.');
      }

      if (ctx.approvalManager) {
        const approvalId = args.approval_id ? String(args.approval_id).trim() : '';
        if (!approvalId) {
          const req = ctx.approvalManager.createRequest({
            toolName: 'delete_file',
            clientIdentity: ctx.clientIdentity || 'Agent',
            target: file,
            args,
            details: { path: file },
          });
          throw new Error(
            `APPROVAL_REQUIRED: Operation delete_file on "${file}" requires approval. Approval ID: ${req.id}`
          );
        }
        const ok = ctx.approvalManager.consume({
          id: approvalId,
          toolName: 'delete_file',
          clientIdentity: ctx.clientIdentity || 'Agent',
          target: file,
          args,
        });
        if (!ok) {
          throw new Error(`APPROVAL_DENIED: Approval ID "${approvalId}" is invalid, expired, or already consumed.`);
        }
      }

      const st = await statOrNull(file);
      if (!st) throw new Error(`FILE_NOT_FOUND: ${file}`);
      if (st.isDirectory()) {
        throw new Error(`IS_A_DIRECTORY: ${file} is a directory — refusing to delete it recursively.`);
      }
      await fsp.unlink(file);
      return { content: `Deleted ${file}`, structured: { path: file } };
    }

    case 'search_files': {
      const dir = resolveWorkspacePath(str('path') || '.', ctx);
      const source = String(args.regex || '');
      let rx: RegExp;
      try {
        rx = new RegExp(source, 'i');
      } catch {
        throw new Error(`Invalid regular expression: ${source}`);
      }
      const filePattern = args.file_pattern ? String(args.file_pattern) : null;
      const results: string[] = [];
      const realRoots = ctx.roots.map((r) => realPathForCheck(r));

      const walk = async (current: string): Promise<void> => {
        if (results.length >= MAX_SEARCH_RESULTS) return;
        let entries: fs.Dirent[];
        try {
          entries = await fsp.readdir(current, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (results.length >= MAX_SEARCH_RESULTS) return;
          if (e.name.startsWith('.') || e.name === 'node_modules') continue;
          const full = path.join(current, e.name);

          // Deep Symlink Traversal Protection
          let realEntry: string;
          try {
            realEntry = fs.realpathSync(full);
          } catch {
            continue;
          }
          const inside = realRoots.some((root) => isInside(realEntry, root));
          if (!inside) {
            // Target is outside authorized workspace roots (symlink traversal blocked)
            continue;
          }

          let isDir = false;
          try {
            const st = fs.statSync(full);
            isDir = st.isDirectory();
          } catch {
            continue;
          }

          if (isDir) {
            await walk(full);
            continue;
          }
          if (filePattern && !e.name.includes(filePattern.replace(/^\*|\$/g, ''))) continue;

          // Skip searching inside sensitive files
          if (isSensitiveFile(full) || isSensitiveFile(realEntry)) continue;

          let content: string;
          try {
            content = await fsp.readFile(full, 'utf8');
          } catch {
            continue;
          }
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (!rx.test(lines[i])) continue;
            // REDACT SECRETS FROM SEARCH OUTPUT
            const safeLine = redactSecretsInText(lines[i].trim().slice(0, 200));
            results.push(`${full}:${i + 1}: ${safeLine}`);
            if (results.length >= MAX_SEARCH_RESULTS) return;
          }
        }
      };
      await walk(dir);
      return {
        content: results.length ? results.join('\n') : '(no matches)',
        structured: { path: dir, count: results.length },
      };
    }

    case 'exec_command': {
      const cmdResult = await globalTerminalService.executeCommand(
        {
          command: str('command'),
          args: Array.isArray(args.args) ? (args.args as string[]) : undefined,
          working_directory: str('working_directory') || undefined,
          timeout_ms: typeof args.timeout_ms === 'number' ? args.timeout_ms : undefined,
          approval_id: str('approval_id') || undefined,
        },
        ctx,
        ctx.clientIdentity || 'Agent'
      );

      return {
        content:
          cmdResult.stdout || cmdResult.stderr
            ? `${cmdResult.stdout}${cmdResult.stderr ? '\n[STDERR]\n' + cmdResult.stderr : ''}`
            : '(command completed with no output)',
        structured: cmdResult,
        isError: cmdResult.exitCode !== 0,
      };
    }

    default:
      throw new Error(`TOOL_DISABLED: ${name} is not one of the tools this server offers.`);
  }
}

/**
 * The default context. If roots is empty or not provided, it initializes
 * with empty roots (DEFAULT DENY) rather than falling back to entire home directory.
 */
export function defaultWorkspaceContext(roots?: string[]): WorkspaceToolContext {
  const list = (roots && roots.length ? roots : [])
    .filter((r) => typeof r === 'string' && r.trim().length > 0)
    .map((r) => path.resolve(r.trim()));

  return {
    roots: list,
    defaultRoot: list[0] || '',
  };
}
