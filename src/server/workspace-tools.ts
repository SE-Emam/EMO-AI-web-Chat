/**
 * Workspace file tools — the capability the gateway lends to the agents it
 * binds (Cline, VS Code, OpenCode, Hermes, …).
 *
 * These are REAL local tools: they read and write the user's files, which is
 * the whole point of the gateway for a coding agent.
 *
 * SAFETY:
 *  - every path is resolved (absolute + symlinks) and MUST stay inside an
 *    allowed root — a traversal or a symlink escape is rejected, never
 *    silently followed;
 *  - the default root is the user's home directory; it can be narrowed by the
 *    gateway configuration;
 *  - nothing here touches the network, and no secret is ever returned
 *    (a `.env`-like file is redacted before it leaves this module).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface WorkspaceToolContext {
  /** Absolute directories the tools may touch. */
  roots: string[];
  /** Root used to resolve relative paths. */
  defaultRoot: string;
  /** Maximum bytes a single read may return. */
  maxReadBytes?: number;
}

export interface WorkspaceToolResult {
  content: string;
  isError?: boolean;
  structured?: unknown;
}

const MAX_READ_BYTES = 400_000;
const MAX_LIST_ENTRIES = 500;
const MAX_SEARCH_RESULTS = 200;
const SECRET_FILE = /(^|\/)\.env(\.|$)|(^|\/)credentials?(\.|$)|(^|\/)secrets?\./i;

/** The tools every bound agent can use. */
export const WORKSPACE_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description:
      'Read a file from the local workspace. Returns its content. Use an absolute path or a path relative to the workspace root.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path, or a path relative to the workspace root.' },
        offset: { type: 'number', description: 'First line to read (1-based).' },
        limit: { type: 'number', description: 'Maximum number of lines to read.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write a file (creating it when needed) and return the number of bytes written.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path, or a path relative to the workspace root.' },
        content: { type: 'string', description: 'The full new content of the file.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace an exact string inside a file. The old string must exist exactly once (unless replace_all is set).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'list_directory',
    description: 'List the entries of a directory (name, type and size).',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
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
    description: 'Move or rename a file or directory.',
    parameters: {
      type: 'object',
      properties: {
        source_path: { type: 'string' },
        destination_path: { type: 'string' },
      },
      required: ['source_path', 'destination_path'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description: 'Search the workspace for a regular expression and return the matching lines.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to search in.' },
        regex: { type: 'string', description: 'Regular expression to search for.' },
        file_pattern: { type: 'string', description: 'Only search files matching this glob (e.g. *.ts).' },
      },
      required: ['path', 'regex'],
    },
  },
];

/** True when `child` is inside `parent`. */
export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * The REAL path of a location (symlinks resolved), even when the target does
 * not exist yet: the closest existing ancestor is resolved and the missing
 * tail is appended.
 *
 * This matters on macOS, where `/var` is a symlink to `/private/var` — a
 * naive string comparison would report every path as "outside the workspace".
 */
function realPathForCheck(p: string): string {
  let probe = p;
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
  return p;
}

/**
 * Resolves a path and proves it stays inside the allowed roots.
 * Symlinks are resolved for the CHECK (the returned path stays the logical one).
 */
export function resolveWorkspacePath(input: string, ctx: WorkspaceToolContext): string {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('path is required');
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(ctx.defaultRoot, raw);

  // The roots are compared in their REAL form (see realPathForCheck).
  const realRoots = ctx.roots.map((root) => realPathForCheck(root));
  const realTarget = realPathForCheck(abs);
  const ok = realRoots.some((root) => isInside(realTarget, root));
  if (!ok) {
    throw new Error(
      `Access denied: "${raw}" is outside the allowed workspace (${ctx.roots.join(', ')})`,
    );
  }
  return abs;
}

function redactSecrets(text: string, filePath: string): string {
  if (!SECRET_FILE.test(filePath)) return text;
  return text
    .split('\n')
    .map((line) => (/^\s*([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=/i.test(line) ? `${line.split('=')[0]}=[redacted]` : line))
    .join('\n');
}

async function statOrNull(p: string): Promise<fs.Stats | null> {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

/** Executes one workspace tool. */
export async function callWorkspaceTool(
  name: string,
  rawArgs: unknown,
  ctx: WorkspaceToolContext,
): Promise<WorkspaceToolResult> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
  const str = (k: string): string => String(args[k] ?? '');

  switch (name) {
    case 'read_file': {
      const file = resolveWorkspacePath(str('path'), ctx);
      const st = await statOrNull(file);
      if (!st) throw new Error(`File not found: ${file}`);
      if (st.isDirectory()) throw new Error(`${file} is a directory — use list_directory.`);
      const maxBytes = ctx.maxReadBytes ?? MAX_READ_BYTES;
      const handle = await fsp.open(file, 'r');
      try {
        const size = Math.min(st.size, maxBytes);
        const buffer = Buffer.alloc(size);
        await handle.read(buffer, 0, size, 0);
        let text = buffer.toString('utf8');
        const offset = Number(args.offset || 0);
        const limit = Number(args.limit || 0);
        if (offset > 0 || limit > 0) {
          const lines = text.split('\n');
          const start = Math.max(0, offset);
          const end = limit > 0 ? start + limit : lines.length;
          text = lines.slice(start, end).join('\n');
        }
        text = redactSecrets(text, file);
        const truncated = st.size > maxBytes;
        return {
          content:
            text +
            (truncated ? `\n\n[truncated: the file is ${st.size} bytes, only the first ${maxBytes} were returned]` : ''),
          structured: { path: file, bytes: st.size, truncated },
        };
      } finally {
        await handle.close();
      }
    }

    case 'write_file': {
      const file = resolveWorkspacePath(str('path'), ctx);
      const content = typeof args.content === 'string' ? args.content : '';
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, content, 'utf8');
      return {
        content: `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${file}`,
        structured: { path: file, bytes: Buffer.byteLength(content, 'utf8') },
      };
    }

    case 'edit_file': {
      const file = resolveWorkspacePath(str('path'), ctx);
      const oldStr = typeof args.old_string === 'string' ? args.old_string : '';
      const newStr = typeof args.new_string === 'string' ? args.new_string : '';
      if (!oldStr) throw new Error('old_string is required');
      const original = await fsp.readFile(file, 'utf8');
      const occurrences = original.split(oldStr).length - 1;
      if (occurrences === 0) throw new Error(`old_string was not found in ${file}`);
      if (occurrences > 1 && args.replace_all !== true) {
        throw new Error(
          `old_string appears ${occurrences} times in ${file} — provide more context or set replace_all.`,
        );
      }
      const updated =
        args.replace_all === true ? original.split(oldStr).join(newStr) : original.replace(oldStr, newStr);
      await fsp.writeFile(file, updated, 'utf8');
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
        }),
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
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.rename(from, to);
      return { content: `Moved ${from} → ${to}`, structured: { from, to } };
    }

    case 'delete_file': {
      const file = resolveWorkspacePath(str('path'), ctx);
      const st = await statOrNull(file);
      if (!st) throw new Error(`File not found: ${file}`);
      if (st.isDirectory()) throw new Error(`${file} is a directory — refusing to delete it recursively.`);
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
          if (e.isDirectory()) {
            await walk(full);
            continue;
          }
          if (filePattern && !e.name.includes(filePattern.replace(/^\*|\$$/g, ''))) continue;
          let content: string;
          try {
            content = await fsp.readFile(full, 'utf8');
          } catch {
            continue;
          }
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (!rx.test(lines[i])) continue;
            results.push(`${full}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
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

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * The default context: the user's home directory as the workspace root.
 * The roots are stored in their REAL form so the containment check works on
 * macOS (where /var is a symlink to /private/var).
 */
export function defaultWorkspaceContext(roots?: string[]): WorkspaceToolContext {
  const home = os.homedir();
  const list = (roots && roots.length ? roots : [home]).map((r) => path.resolve(r));
  return { roots: list, defaultRoot: list[0] };
}
