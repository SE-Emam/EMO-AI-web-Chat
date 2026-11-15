/**
 * MCP (Model Context Protocol) server — the unified endpoint bound agents connect
 * to for LOCAL FILE & TERMINAL ACCESS.
 *
 * All agents (Cline, VS Code, OpenCode, Hermes, ChatGPT, etc.) share this single,
 * hardened MCP server endpoint at `http://127.0.0.1:<port>/mcp`.
 *
 * Hardening:
 *  - Default Deny workspace roots enforcement
 *  - Symlink traversal protection
 *  - Sensitive file blocking and secret redaction
 *  - Approval Manager integration for mutating operations and terminal commands
 *  - Single-use approval tokens
 */
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  WORKSPACE_TOOLS,
  callWorkspaceTool,
  defaultWorkspaceContext,
  type WorkspaceToolContext,
} from './workspace-tools.js';
import { globalApprovalManager, type ApprovalManager } from './approval-manager.js';
import type { KeyAuthResult } from '../gateway/types.js';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'emo-ai-workspace', version: '1.1.0' };

interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
  read_file: { title: 'Read File', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  list_directory: { title: 'List Directory', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  list_codebase: { title: 'List Codebase', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  search_files: { title: 'Search Files', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  write_file: { title: 'Write File', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  edit_file: { title: 'Edit File', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  create_directory: { title: 'Create Directory', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  move_file: { title: 'Move File', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  delete_file: { title: 'Delete File', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  exec_command: { title: 'Execute Command', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
};

export interface McpServerOptions {
  isValidApiKey?: (key: string) => boolean;
  resolveKeyAuth?: (key: string) => KeyAuthResult;
  apiKey?: string;
  workspaceRoots?: string[] | (() => string[]);
  approvalManager?: ApprovalManager;
  requireApproval?: boolean;
}

function extractKey(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.trim()) {
    const h = header.trim();
    const bearer = h.match(/^Bearer\s+(.+)$/i);
    if (bearer) return bearer[1].trim();
    const full = h.match(/^Authorization\s*:\s*(.+)$/i);
    if (full) {
      const inner = full[1].trim();
      const innerBearer = inner.match(/^Bearer\s+(.+)$/i);
      return innerBearer ? innerBearer[1].trim() : inner;
    }
    return h;
  }
  const q = (req.query || {}) as { key?: string };
  if (typeof q.key === 'string' && q.key) return q.key;
  const xKey = req.headers['x-api-key'];
  if (typeof xKey === 'string' && xKey) return xKey;
  return undefined;
}

function isAuthorized(req: FastifyRequest, opts: McpServerOptions): boolean {
  const provided = extractKey(req);
  if (!provided) return false;
  if (opts.isValidApiKey) return opts.isValidApiKey(provided);
  if (opts.apiKey) return provided === opts.apiKey;
  return true;
}

function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

const TOOL_LINES: Record<string, string> = {
  read_file: 'read_file: reads one file and returns its content',
  write_file: 'write_file: writes a file atomically, creating or overwriting it',
  edit_file: 'edit_file: replaces one exact string inside a file atomically',
  list_directory: 'list_directory: lists the entries of one folder',
  list_codebase: 'list_codebase: lists the project tree under a folder',
  create_directory: 'create_directory: creates a folder (with missing parents)',
  move_file: 'move_file: moves or renames a file or a folder',
  delete_file: 'delete_file: deletes one file',
  search_files: 'search_files: searches files for a regex and returns matching lines with secrets redacted',
  exec_command: 'exec_command: executes an approved terminal command within workspace with explicit approval',
};

function buildInstructions(ctx: WorkspaceToolContext, configuredRoots: string[]): string {
  const roots = configuredRoots.map((r) => path.resolve(r));
  const rootBlock = roots.length
    ? `Approved workspace roots (absolute paths):\n${roots.map((r) => `- ${r}`).join('\n')}`
    : `Approved workspace roots: NONE (Default Deny active). File access is blocked until workspace roots are added in Gateway Settings.`;
  const lines = WORKSPACE_TOOLS.map((t) => `- ${TOOL_LINES[t.name] || `${t.name}: ${t.description}`} (approved roots)`);

  return [
    'Local workspace tools for EMO.ai gateway. They act on the local machine inside approved roots only.',
    rootBlock,
    'A path may be absolute inside an approved root, or relative to a root.',
    'Nothing outside the approved roots can be accessed (Default Deny).',
    'Sensitive files (.env, private keys, credentials) are blocked by default.',
    'Tools:',
    ...lines,
    '',
    'Mutating operations (file writes/edits/deletions and terminal commands) require explicit approval tokens.',
  ].join('\n');
}

function mcpTools() {
  return WORKSPACE_TOOLS.map((tool) => {
    const annotations = TOOL_ANNOTATIONS[tool.name];
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
      annotations: annotations
        ? {
            readOnlyHint: annotations.readOnlyHint,
            destructiveHint: annotations.destructiveHint,
            idempotentHint: annotations.idempotentHint,
            openWorldHint: annotations.openWorldHint,
          }
        : { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    };
  });
}

/** Handles one JSON-RPC request object. */
async function handleRpc(
  method: string,
  params: Record<string, unknown>,
  ctx: WorkspaceToolContext,
  configuredRoots: string[]
): Promise<unknown> {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: true } },
        serverInfo: SERVER_INFO,
        instructions: buildInstructions(ctx, configuredRoots),
      };
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return undefined;
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: mcpTools() };
    case 'resources/list':
      return { resources: [] };
    case 'prompts/list':
      return { prompts: [] };
    case 'tools/call': {
      const name = String((params as any)?.name || '');
      const args = (params as any)?.arguments ?? {};
      try {
        const result = await callWorkspaceTool(name, args, ctx);
        return {
          content: [{ type: 'text', text: result.content }],
          structuredContent: result.structured,
          isError: result.isError === true,
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: `Error: ${(e as Error).message}` }],
          isError: true,
        };
      }
    }
    default:
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

/**
 * Registers the unified MCP endpoint on the Fastify app.
 */
export function registerMcpServer(app: FastifyInstance, opts: McpServerOptions = {}): void {
  const rootsOf = (): string[] =>
    typeof opts.workspaceRoots === 'function' ? opts.workspaceRoots() : opts.workspaceRoots || [];

  const ctxOf = (clientIdentity = 'Agent'): WorkspaceToolContext => {
    const base = defaultWorkspaceContext(rootsOf());
    return {
      ...base,
      approvalManager: opts.requireApproval === false ? undefined : (opts.approvalManager || globalApprovalManager),
      clientIdentity,
    };
  };

  const guard = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const provided = extractKey(req);
    if (!provided) {
      if (!opts.isValidApiKey && !opts.apiKey && !opts.resolveKeyAuth) return true;
      reply.status(401).send({ error: { message: 'Invalid or missing API key', type: 'authentication_error' } });
      return false;
    }

    if (opts.resolveKeyAuth) {
      const auth = opts.resolveKeyAuth(provided);
      if (!auth.valid) {
        reply.status(401).send({ error: { message: 'Invalid or missing API key', type: 'authentication_error' } });
        return false;
      }
      if (auth.scope === 'group') {
        reply.status(403).send({
          error: {
            message: 'Access denied: Scoped router group keys cannot access MCP tools.',
            code: 'INSUFFICIENT_SCOPE',
          },
        });
        return false;
      }
      (req as any).authKeyInfo = auth;
      return true;
    }

    if (opts.isValidApiKey) {
      if (opts.isValidApiKey(provided)) return true;
      reply.status(401).send({ error: { message: 'Invalid or missing API key', type: 'authentication_error' } });
      return false;
    }

    if (opts.apiKey) {
      if (provided === opts.apiKey) return true;
      reply.status(401).send({ error: { message: 'Invalid or missing API key', type: 'authentication_error' } });
      return false;
    }

    return true;
  };

  // --- Streamable HTTP: JSON-RPC endpoint --------------------------
  app.post('/mcp', async (req, reply) => {
    if (!guard(req, reply)) return;

    const body = (req.body || {}) as any;
    const messages: any[] = Array.isArray(body) ? body : [body];
    const responses: any[] = [];
    const clientIdentity = String(req.headers['x-client-agent'] || req.headers['user-agent'] || 'Agent');

    for (const message of messages) {
      if (!message || typeof message !== 'object') continue;
      const id = message.id;
      const method = String(message.method || '');
      if (!method) continue;

      if (method.startsWith('notifications/')) {
        continue;
      }
      try {
        const configured = rootsOf();
        const result = await handleRpc(
          method,
          (message.params || {}) as Record<string, unknown>,
          ctxOf(clientIdentity),
          configured
        );
        if (result !== undefined) responses.push(jsonRpcResult(id, result));
      } catch (e) {
        const err = e as Error & { code?: number };
        responses.push(jsonRpcError(id, err.code ?? -32603, err.message));
      }
    }

    if (responses.length === 0) {
      return reply.status(202).send();
    }
    return reply.send(responses.length === 1 ? responses[0] : responses);
  });

  // --- SSE stream transport ----------------------------------------------
  app.get('/mcp', async (req, reply) => {
    if (!guard(req, reply)) return;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    reply.raw.write(`event: endpoint\ndata: ${JSON.stringify('/mcp')}\n\n`);

    const keepAlive = setInterval(() => {
      try {
        reply.raw.write(': keep-alive\n\n');
      } catch {}
    }, 15_000);

    req.raw.on('close', () => {
      clearInterval(keepAlive);
      try {
        reply.raw.end();
      } catch {}
    });
  });

  // --- Session teardown -------------------------------------------------
  app.delete('/mcp', async (req, reply) => {
    if (!guard(req, reply)) return;
    return reply.status(204).send();
  });

  // --- Status and health diagnostics ------------------------------------
  app.get('/mcp/status', async (req, reply) => {
    if (!guard(req, reply)) return;
    return {
      ok: true,
      server: SERVER_INFO,
      protocolVersion: PROTOCOL_VERSION,
      tools: WORKSPACE_TOOLS.map((t) => t.name),
      roots: ctxOf().roots,
      defaultRoot: ctxOf().defaultRoot,
    };
  });
}
