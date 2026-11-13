/**
 * MCP (Model Context Protocol) server — the endpoint the bound agents connect
 * to for LOCAL FILE ACCESS.
 *
 * The gateway generates an MCP configuration for every supported agent
 * (Cline, VS Code, OpenCode, Hermes, …) that points at `http://127.0.0.1:<port>/mcp`.
 * This module is what makes that URL real — before it existed the agent's MCP
 * client got a 404 and every tool call failed with "the local workspace
 * connection was interrupted".
 *
 * Transport: MCP Streamable HTTP (POST with JSON-RPC) plus a GET SSE stream
 * for clients that prefer the legacy transport. Both are served here.
 */
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  WORKSPACE_TOOLS,
  callWorkspaceTool,
  defaultWorkspaceContext,
  type WorkspaceToolContext,
} from './workspace-tools.js';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'emo-ai-workspace', version: '1.0.0' };

interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/**
 * MCP tool annotations.
 *
 * WHY: a client that sees no `readOnlyHint` treats the tool as a WRITE and
 * asks the user to confirm every single call — an agent that has to ask
 * permission to merely LOOK at a file is unusable. So the genuinely
 * read-only tools must declare it.
 *
 * `destructiveHint` is true ONLY where the tool can destroy something the
 * user would miss: write_file/edit_file overwrite the file content,
 * delete_file removes it, move_file removes the source and may replace the
 * destination. create_directory only ADDS, so it stays false.
 */
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
};

export interface McpServerOptions {
  /** Valid API keys (the same ones the OpenAI-compatible API accepts). */
  isValidApiKey?: (key: string) => boolean;
  /** The API key of this gateway (fallback when no validator is given). */
  apiKey?: string;
  /**
   * Restricts the tools to these roots (default: the user's Desktop).
   * A function is read on EVERY request so a setting change applies at once.
   */
  workspaceRoots?: string[] | (() => string[]);
}

function extractKey(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.trim()) {
    const h = header.trim();
    // The plain form: "Bearer <token>".
    const bearer = h.match(/^Bearer\s+(.+)$/i);
    if (bearer) return bearer[1].trim();
    // The FULL header form: "Authorization: Bearer <token>" — this is what
    // MCP clients send when the header is configured as a whole (mcp-remote
    // `--header "Authorization: Bearer <token>"`).
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

/** One short factual line per tool — what it does, and where it may act. */
const TOOL_LINES: Record<string, string> = {
  read_file: 'read_file: reads one file and returns its content',
  write_file: 'write_file: writes a file, creating or overwriting it',
  edit_file: 'edit_file: replaces one exact string inside a file',
  list_directory: 'list_directory: lists the entries of one folder',
  list_codebase: 'list_codebase: lists the project tree under a folder',
  create_directory: 'create_directory: creates a folder (with missing parents)',
  move_file: 'move_file: moves or renames a file or a folder',
  delete_file: 'delete_file: deletes one file',
  search_files: 'search_files: searches files for a regex and returns matching lines',
};

/**
 * The server instructions published in the `initialize` result.
 *
 * WHY: the model sees these once, before it knows anything about this
 * gateway, and they are the only place where the approved roots and the
 * path rules can be stated once instead of in every tool description.
 * They are read LIVE (the roots can change between two requests), so this
 * is a function and not a constant.
 */
function buildInstructions(ctx: WorkspaceToolContext, configuredRoots: string[]): string {
  const roots = configuredRoots.map((r) => path.resolve(r));
  const rootBlock = roots.length
    ? `Approved workspace roots (absolute paths):\n${roots.map((r) => `- ${r}`).join('\n')}`
    : `Approved workspace roots: None configured — the user's home directory (${path.resolve(ctx.defaultRoot)}) is the effective root.`;
  const lines = WORKSPACE_TOOLS.map((t) => `- ${TOOL_LINES[t.name] || `${t.name}: ${t.description}`} (approved roots)`);

  return [
    'Local file tools for the EMO.ai gateway. They act on the user\'s machine, inside the approved roots only.',
    rootBlock,
    'A path may be absolute inside an approved root, or relative to a root (the first root is the default).',
    'Nothing outside the approved roots can be read or written.',
    'Tools:',
    ...lines,
    '.env and credential files are never returned — their secret values come back as [redacted].',
  ].join('\n');
}

/** The MCP wire shape of a tool (the MCP schema calls `parameters` `inputSchema`). */
function mcpTools() {
  return WORKSPACE_TOOLS.map((t) => {
    const annotations = TOOL_ANNOTATIONS[t.name];
    return {
      name: t.name,
      title: annotations?.title || t.name,
      description: t.description,
      inputSchema: t.parameters,
      annotations: annotations
        ? {
            title: annotations.title,
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
  configuredRoots: string[],
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
 * Registers the MCP endpoint on the Fastify app.
 */
export function registerMcpServer(app: FastifyInstance, opts: McpServerOptions = {}): void {
  const rootsOf = (): string[] =>
    typeof opts.workspaceRoots === 'function' ? opts.workspaceRoots() : opts.workspaceRoots || [];
  const ctxOf = (): WorkspaceToolContext => defaultWorkspaceContext(rootsOf());

  const guard = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (isAuthorized(req, opts)) return true;
    reply.status(401).send({ error: { message: 'Invalid or missing API key', type: 'authentication_error' } });
    return false;
  };

  // --- Streamable HTTP: the JSON-RPC endpoint --------------------------
  app.post('/mcp', async (req, reply) => {
    if (!guard(req, reply)) return;

    const body = (req.body || {}) as any;
    const messages: any[] = Array.isArray(body) ? body : [body];
    const responses: any[] = [];

    for (const message of messages) {
      if (!message || typeof message !== 'object') continue;
      const id = message.id;
      const method = String(message.method || '');
      if (!method) continue;

      if (method.startsWith('notifications/')) {
        // A notification has no response body.
        continue;
      }
      try {
        const configured = rootsOf();
        const result = await handleRpc(
          method,
          (message.params || {}) as Record<string, unknown>,
          defaultWorkspaceContext(configured),
          configured,
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

  // --- SSE stream (clients that prefer the legacy transport) -------------
  app.get('/mcp', async (req, reply) => {
    if (!guard(req, reply)) return;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    // The endpoint event tells the client where to POST.
    reply.raw.write(`event: endpoint\ndata: ${JSON.stringify('/mcp')}\n\n`);

    const keepAlive = setInterval(() => {
      try {
        reply.raw.write(': keep-alive\n\n');
      } catch {
        /* client gone */
      }
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

  // --- A tiny status endpoint (useful for the UI + diagnostics) --------
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
