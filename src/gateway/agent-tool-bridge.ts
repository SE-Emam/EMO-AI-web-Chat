/**
 * The agent ↔ web-model tool bridge.
 *
 * A web model (ChatGPT in a browser) never receives the agent's tools as
 * objects — it receives them as TEXT: a JSON schema block plus a
 * "output a ```tool_call``` block" protocol. The model frequently ignores
 * that protocol and answers with prose instead ("the file environment is
 * disconnected", "the path isn't present in the current filesystem"), and
 * the local agent then reports a broken file environment that does not exist.
 *
 * Two local, side-effect-free mechanisms:
 *
 *  1. PRE-EMPT — when the task names a local path and a matching file tool
 *     is announced, the prompt carries the EXACT tool_call block to emit.
 *     The model only has to copy it.
 *  2. REPAIR — when the model answered with prose instead of a tool call,
 *     one corrective turn is sent in the same web chat with the same block.
 *
 * Neither mechanism executes anything: the block is a REQUEST. The client's
 * own tool does the work and the result comes back through the normal
 * agent loop.
 * 
 * Fact-only environment block (Phase 1): Replaces judgmental language with
 * facts about the workspace, tools, and execution model.
 */
import fs from 'node:fs';
import { NEUTRAL_CORRECTION_MARKER } from '../arena/tool-bridge-markers.js';
import type { ChatMessage } from '../types.js';

/** The marker injectToolsInstruction() writes into the system message. */
export const TOOL_MODE_MARKER = '### TOOL CALLING MODE (MANDATORY';

export interface AnnouncedTool {
  name: string;
  description: string;
  parameters: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
    [k: string]: unknown;
  };
}

export interface ToolCallBlock {
  /** The tool the agent announced (the client executes it). */
  tool: string;
  /** The argument property that carries the path. */
  arg: string;
  /** The path the tool has to work on. */
  path: string;
  /** The ```tool_call``` block, ready to emit. */
  block: string;
  /** The tool_call payload (without the fence). */
  payload: { name: string; arguments: Record<string, unknown> };
}

/**
 * Extracts the tool schemas the gateway announced to the web model.
 * The injected instruction carries them as a ```json block.
 */
export function extractAnnouncedTools(messages: ChatMessage[]): AnnouncedTool[] {
  const sources: string[] = [];
  for (const m of messages || []) {
    const content = typeof m?.content === 'string' ? m.content : '';
    if (content.includes(TOOL_MODE_MARKER) || content.includes('Available tools (JSON schemas)')) {
      sources.push(content);
    }
  }
  const out: AnnouncedTool[] = [];
  const seen = new Set<string>();
  for (const src of sources) {
    const fence = /```json\s*([\s\S]*?)```/i.exec(src);
    if (!fence) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fence[1]);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const raw of parsed) {
      const t = raw as any;
      const name = typeof t?.name === 'string' ? t.name : '';
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({
        name,
        description: typeof t.description === 'string' ? t.description : '',
        parameters: (t.parameters && typeof t.parameters === 'object' ? t.parameters : {}) as AnnouncedTool['parameters'],
      });
    }
  }
  return out;
}

/**
 * Finds the local path a task talks about.
 * Only absolute paths are considered — a relative path cannot be resolved
 * against the agent's working directory.
 */
export function findLocalPath(text: string): string | null {
  if (!text || typeof text !== 'string') return null;
  const re = /(^|[\s"'`([{])((?:\/(?:Users|home|Volumes|private|tmp|opt|var|mnt|media|srv|etc|Applications)\/)[^\s"'`,;:)\]]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    let p = match[2];
    // Trailing punctuation is never part of a path.
    p = p.replace(/[.,;:!?)\]]+$/, '');
    if (p.length > 1 && p !== '/') return p;
  }
  return null;
}

/** What a local path actually is on this machine. */
export type PathKind = 'directory' | 'file' | 'missing';

export function classifyPath(path: string): PathKind {
  try {
    const st = fs.statSync(path);
    if (st.isDirectory()) return 'directory';
    if (st.isFile()) return 'file';
  } catch {
    /* not readable / not there */
  }
  return 'missing';
}

/** The argument property that carries a path. */
const PATH_ARG_RE = /^(?:abs(?:olute)?_?path|file_?path|dir(?:ectory)?_?path|folder_?path|path|file|filename|dir|folder|target)$/i;

/**
 * The string property of a tool that carries a path.
 * Returns null when the tool has no such property (e.g. a pattern tool).
 */
export function pathArgumentOf(tool: AnnouncedTool): string | null {
  const props = tool.parameters?.properties || {};
  const required = new Set((tool.parameters?.required || []).map((r) => String(r)));
  const candidates = Object.keys(props).filter((k) => {
    const type = props[k]?.type;
    return type === 'string' || type === undefined;
  });
  const ordered = [
    ...candidates.filter((k) => PATH_ARG_RE.test(k)),
    ...candidates.filter((k) => !PATH_ARG_RE.test(k)),
  ];
  for (const key of ordered) {
    if (required.has(key)) return key;
  }
  return ordered[0] || null;
}

/**
 * Picks the announced tool that fits the task: a reader for a file, a
 * lister for a directory. Only tools that take a path are considered.
 */
export function pickFileTool(tools: AnnouncedTool[], kind: 'file' | 'directory'): { tool: AnnouncedTool; arg: string } | null {
  const scored: { tool: AnnouncedTool; arg: string; score: number }[] = [];
  for (const tool of tools) {
    const arg = pathArgumentOf(tool);
    if (!arg) continue;
    const name = tool.name.toLowerCase();
    const desc = tool.description.toLowerCase();
    let score = 0;
    if (kind === 'file') {
      if (/read|cat|open|view|content/.test(name)) score += 6;
      else if (/read.*file|file.*content|contents? of|read the/.test(desc)) score += 4;
      if (/read_file|readfile|read/.test(name)) score += 2;
      if (/write|edit|patch|delete|remove|create|move/.test(name)) score -= 8;
      if (/list|ls|dir|glob|find|walk|tree/.test(name)) score -= 6;
    } else {
      if (/list|ls|dir|tree/.test(name)) score += 6;
      else if (/list.*director|director.*entr|folder|files? in/.test(desc)) score += 4;
      if (/list_directory|list_dir|list_files|ls/.test(name)) score += 2;
      if (/read|cat|open|view/.test(name)) score -= 4;
      if (/write|edit|patch|delete|remove|create|move/.test(name)) score -= 8;
    }
    if (score > 0) scored.push({ tool, arg, score });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  return { tool: scored[0].tool, arg: scored[0].arg };
}

/** Builds the ```tool_call``` block for a tool + path. */
export function buildToolCallBlock(toolName: string, argName: string, path: string): ToolCallBlock {
  const payload = { name: toolName, arguments: { [argName]: path } };
  return {
    tool: toolName,
    arg: argName,
    path,
    payload,
    block: '```tool_call\n' + JSON.stringify(payload) + '\n```',
  };
}

/**
 * The hint that goes into the prompt: the exact block to emit, and nothing
 * that could be read as "the file environment is broken".
 *
 * Facts only (the rule copied from chat-on-steroids): a line that tells the
 * model how to JUDGE its situation is not a fact, and a model told how to
 * judge answers with a refusal instead of a call. The protocol itself — the
 * shape of the request — is not a judgment and stays.
 */
export function buildHintSection(call: ToolCallBlock, phase: 'first' | 'next' = 'first'): string {
  if (phase === 'next') {
    // The turn that follows a tool result: a tool HAS run, so the first
    // phase's wording ("nothing has been executed") would contradict the
    // result that is right there.
    return [
      '### THE NEXT TOOL CALL',
      'The tool has run and its result is above.',
      'The next call for this task is this block, and nothing else:',
      call.block,
    ].join('\n');
  }
  return [
    '### THE TOOL CALL TO EMIT NOW',
    'No tool has run yet: nothing has been executed, so nothing can have failed.',
    'The client runs the tool on this machine and returns the real result. To get that result, output exactly this block, and nothing else:',
    call.block,
    '',
    'The next request for this task has the same shape, after the result arrives.',
  ].join('\n');
}

/**
 * Fact-only environment block (Phase 1): Builds a system message block with
 * facts about the workspace, tools, and execution model — no judgments.
 */
export function buildFactOnlyEnvironmentBlock(tools: AnnouncedTool[], roots: string[]): string {
  const toolList = tools
    .slice(0, 12)
    .map((t) => {
      const required = (t.parameters?.required || []).map(String);
      const props = Object.keys(t.parameters?.properties || {});
      const shown = required.length ? required : props.slice(0, 2);
      return `${t.name}${shown.length ? `(${shown.join(', ')})` : ''}`;
    })
    .join(', ');

  return [
    '### WORKSPACE ENVIRONMENT',
    '',
    'Approved workspace roots:',
    ...roots.map((root, i) => `${i + 1}. ${root}`),
    '',
    'Available tools in this request:',
    toolList || 'None',
    '',
    'Tool execution model:',
    '- The client executes tools on this machine and returns real results',
    '- Tools are not executed until explicitly requested in a ```tool_call``` block',
    '- Use full project paths under an approved root',
    '- A tool result is the actual output from the client',
    '',
    'Instructions:',
    '- Output a ```tool_call``` block to request a tool',
    '- The tool runs on the client machine and returns its result',
    '- Continue with the task after receiving the result',
  ].join('\n');
}

/**
 * The corrective text for a model that answered with prose instead of a
 * tool call.
 *
 * It goes into the SYSTEM message: a ```tool_call``` block inside a user
 * message is read by the web model as quoted text and ignored — the same
 * block in the system prompt is executed (measured: 4/4 with the block in
 * the system message, 0/1 with it in a user message).
 */
export function buildCorrectionMessage(
  call: ToolCallBlock | null,
  tools: AnnouncedTool[],
  attempt = 1,
  phase: 'first' | 'next' = 'first'
): string {
  const catalog = tools
    .map((t) => {
      const required = (t.parameters?.required || []).map(String);
      const props = Object.keys(t.parameters?.properties || {});
      const shown = required.length ? required : props.slice(0, 2);
      return `${t.name}${shown.length ? `(${shown.join(', ')})` : ''}`;
    })
    .slice(0, 12)
    .join(', ');
  // The opening line rotates: the same rejected sentence twice in a row is
  // what a model refuses to move away from (the same reason CoS rotates
  // its "continue" texts).
  const opening =
    attempt <= 1
      ? `${NEUTRAL_CORRECTION_MARKER}, and the calling client provides their execution environment.`
      : attempt <= 2
        ? `The tools of this request are still the ones announced with it, and the client still runs them on this machine.`
        : `FINAL INSTRUCTION: You MUST use the tools. Do not claim environment problems — the tools work and you are required to use them now.`;
  const lines = [opening];
  if (phase === 'next') {
    // The turn that follows a tool result: a tool HAS run, so the first
    // phase's wording would contradict the result that is right there.
    lines.push('### THE NEXT TOOL CALL', 'The tool has run and its result is above.');
    if (call) {
      lines.push('The next call for this task is this block, and nothing else:', call.block);
      lines.push('A tool error names the reason it failed.');
      return lines.join('\n');
    }
    lines.push('The next call for this task has this shape, and nothing else:');
  } else {
    lines.push(
      '### THE TOOL CALL TO EMIT NOW',
      attempt <= 1
        ? 'No tool has run yet: nothing has been executed, so nothing can have failed.'
        : attempt <= 2
          ? 'The tool has not been requested yet: nothing has been executed, so nothing can have failed.'
          : 'You are required to use the tools now. No more excuses.',
    );
  }
  if (call) {
    lines.push(
      'The client runs the tool on this machine and returns the real result. To get that result, output exactly this block, and nothing else:',
      call.block,
    );
  } else {
    lines.push(
      `The client runs the tool on this machine and returns the real result. To get that result, output one call in this shape, using one of the tools of this request (${catalog || 'none'}):`,
      '```tool_call',
      '{"name":"TOOL_NAME","arguments":{"arg":"value"}}',
      '```',
    );
  }
  lines.push('A tool error names the reason it failed.');
  if (attempt >= 3) {
    lines.push('DO NOT claim environment problems. The tools work. Use them now.');
  }
  return lines.join('\n');
}

/**
 * The next call after a tool result.
 *
 * A turn that follows a tool result is the turn where the NEXT call is
 * made. Without a concrete call the model narrates the result ("I
 * attempted to read them, but the connection failed") instead of acting on
 * it, so the call is derived from what the result listed: the first file
 * of the folder the task named.
 */
export function buildContinuationCall(messages: ChatMessage[], tools: AnnouncedTool[]): ToolCallBlock | null {
  const results = (messages || []).filter((m) => m?.role === 'tool');
  const last = results[results.length - 1];
  const content = typeof last?.content === 'string' ? last.content : '';
  if (!content.trim()) return null;
  const dir = findTaskPath(messages);
  if (!dir || classifyPath(dir) !== 'directory') return null;
  const names = content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/[\s(,]/)[0])
    .filter(Boolean);
  if (!names.length) return null;
  // A file before a folder: a name with an extension is a file.
  const file = names.find((n) => /\.[A-Za-z0-9]{1,12}$/.test(n)) || names[0];
  const path = file.startsWith('/') ? file : `${dir.replace(/\/+$/, '')}/${file}`;
  const picked = pickFileTool(tools, 'file');
  if (!picked) return null;
  return buildToolCallBlock(picked.tool.name, picked.arg, path);
}

/**
 * Continuation block after tool results (Phase 3): Provides a fact-only
 * continuation message when a tool result has been received.
 */
export function buildContinuationBlock(call: ToolCallBlock | null, tools: AnnouncedTool[]): string {
  const catalog = tools
    .slice(0, 12)
    .map((t) => {
      const required = (t.parameters?.required || []).map(String);
      const props = Object.keys(t.parameters?.properties || {});
      const shown = required.length ? required : props.slice(0, 2);
      return `${t.name}${shown.length ? `(${shown.join(', ')})` : ''}`;
    })
    .join(', ');

  const lines = [
    '### TOOL RESULT AND CONTINUATION',
    '',
    'The tool result above is the actual output from the client machine.',
    'To continue with this task, request the next tool:',
  ];

  if (call) {
    lines.push('The next call for this task is this block:', call.block);
  } else {
    lines.push(
      'Request one call in this shape, using one of the available tools:',
      '```tool_call',
      '{"name":"TOOL_NAME","arguments":{"arg":"value"}}',
      '```'
    );
  }

  lines.push(
    'Available tools:',
    catalog || 'None',
    '',
    'The tool runs on the client machine and returns its actual result.',
  );

  return lines.join('\n');
}

/**
 * Puts the corrective text into the system message that carries the tool
 * instruction. A missing system message is created.
 */
export function withCorrectionSection(messages: ChatMessage[], correction: string): ChatMessage[] {
  const out = [...(messages || [])];
  const idx = out.findIndex((m) => m?.role === 'system' && typeof m.content === 'string' && m.content.includes(TOOL_MODE_MARKER));
  if (idx < 0) {
    const plain = out.findIndex((m) => m?.role === 'system');
    if (plain >= 0) {
      out[plain] = { ...out[plain], content: `${String(out[plain].content || '')}\n\n${correction}` };
      return out;
    }
    out.unshift({ role: 'system', content: correction });
    return out;
  }
  out[idx] = { ...out[idx], content: `${String(out[idx].content || '')}\n\n${correction}` };
  return out;
}

/**
 * Adds fact-only environment block to the system message (Phase 1).
 */
export function withFactOnlyEnvironment(messages: ChatMessage[], tools: AnnouncedTool[], roots: string[]): ChatMessage[] {
  const block = buildFactOnlyEnvironmentBlock(tools, roots);
  return withSystemBlock(messages, block);
}

/**
 * Adds continuation block after tool results (Phase 3).
 */
export function withContinuationBlock(messages: ChatMessage[], call: ToolCallBlock | null, tools: AnnouncedTool[]): ChatMessage[] {
  const block = buildContinuationBlock(call, tools);
  return withSystemBlock(messages, block);
}

/**
 * Appends a block to the system message that carries the tool instruction.
 */
export function withSystemBlock(messages: ChatMessage[], block: string): ChatMessage[] {
  const out = [...(messages || [])];
  const idx = out.findIndex((m) => m?.role === 'system' && typeof m.content === 'string' && m.content.includes(TOOL_MODE_MARKER));
  if (idx < 0) {
    const plain = out.findIndex((m) => m?.role === 'system');
    if (plain >= 0) {
      out[plain] = { ...out[plain], content: `${String(out[plain].content || '')}\n\n${block}` };
      return out;
    }
    out.unshift({ role: 'system', content: block });
    return out;
  }
  out[idx] = { ...out[idx], content: `${String(out[idx].content || '')}\n\n${block}` };
  return out;
}

// ---------------------------------------------------------------------------
// Argument repair — the model's call must run on the client's side
// ---------------------------------------------------------------------------

/** A property that carries a path. */
function isPathProperty(name: string): boolean {
  return /^(?:abs(?:olute)?_?path|file_?path|dir(?:ectory)?_?path|folder_?path|path|file|filename|dir|folder|target)$/i.test(name);
}

/** A value that looks like a local path. */
function looksLikePath(value: unknown): boolean {
  return typeof value === 'string' && /^[.~]?\//.test(value.trim());
}

/**
 * The arguments a client can actually execute.
 *
 * A model that writes its own call often names the argument differently
 * from the announced schema (`path` where the tool wants `filePath`). The
 * client then rejects the call and the agent reports a broken tool. Only
 * unambiguous renames are applied, and nothing is invented.
 */
export function repairArguments(
  args: Record<string, unknown>,
  tool: AnnouncedTool
): { args: Record<string, unknown>; changed: boolean } {
  const props = Object.keys(tool.parameters?.properties || {});
  if (!props.length) return { args, changed: false };
  const required = new Set((tool.parameters?.required || []).map(String));
  const out: Record<string, unknown> = {};
  let changed = false;

  for (const [key, value] of Object.entries(args || {})) {
    if (props.includes(key)) {
      out[key] = value;
      continue;
    }
    // An unknown key: give it to the declared path property when the value
    // is a path and that property is still free.
    const pathProp = props.find((p) => isPathProperty(p) && out[p] === undefined);
    const single = props.length === 1 ? props[0] : undefined;
    if (pathProp && looksLikePath(value)) {
      out[pathProp] = value;
      changed = true;
      continue;
    }
    if (single && required.has(single) && typeof value === 'string') {
      out[single] = value;
      changed = true;
      continue;
    }
    // Otherwise the key is noise for this tool: drop it.
    changed = true;
  }

  // A required property that is still missing: take it from the remaining
  // values, but only when there is exactly one candidate.
  for (const prop of required) {
    if (out[prop] !== undefined) continue;
    const candidates = Object.entries(out).filter(([k]) => !props.includes(k));
    if (candidates.length === 1 && typeof candidates[0][1] === 'string') {
      out[prop] = candidates[0][1];
      delete out[candidates[0][0]];
      changed = true;
    }
  }
  return { args: out, changed };
}

/**
 * Validates tool arguments against the announced schema.
 * Returns corrected arguments and whether they changed.
 */
export function validateToolArguments(
  args: Record<string, unknown>,
  tool: AnnouncedTool
): { args: Record<string, unknown>; valid: boolean; changed: boolean } {
  const props = tool.parameters?.properties || {};
  const required = new Set((tool.parameters?.required || []).map(String));
  const out: Record<string, unknown> = {};
  let changed = false;
  let valid = true;

  // Validate known properties
  for (const [key, value] of Object.entries(args || {})) {
    if (props[key]) {
      // Type validation (basic)
      const expectedType = props[key].type || 'string';
      if (expectedType === 'string' && typeof value !== 'string') {
        valid = false;
        continue;
      }
      if (expectedType === 'number' && typeof value !== 'number') {
        valid = false;
        continue;
      }
      if (expectedType === 'boolean' && typeof value !== 'boolean') {
        valid = false;
        continue;
      }
      out[key] = value;
      continue;
    }
  }

  // Check for required properties
  for (const prop of required) {
    if (out[prop] === undefined) {
      valid = false;
      // Try to fill from remaining values
      const candidates = Object.entries(args).filter(([k]) => !props[k]);
      if (candidates.length === 1 && typeof candidates[0][1] === 'string') {
        out[prop] = candidates[0][1];
        delete out[candidates[0][0]];
        changed = true;
      }
    }
  }

  return { args: out, valid, changed };
}

/**
 * Rewrites the tool calls in a reply so the client's schema matches.
 * Only the fenced ```tool_call``` blocks are touched, and only when the
 * arguments really change.
 */
export function repairToolCallArguments(text: string, tools: AnnouncedTool[]): string {
  if (!text || !tools.length) return text;
  const byName = new Map(tools.map((t) => [t.name, t]));
  let out = text;
  let changed = false;
  const fence = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) {
    const body = m[2] || '';
    let parsed: any;
    try {
      parsed = JSON.parse(body.trim());
    } catch {
      continue;
    }
    const name = parsed?.name || parsed?.function?.name;
    const tool = name ? byName.get(String(name)) : undefined;
    if (!tool) continue;
    const rawArgs = parsed.arguments ?? parsed.args ?? parsed.parameters ?? {};
    let args: Record<string, unknown>;
    try {
      args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs || {});
    } catch {
      continue;
    }
    const repaired = repairArguments(args, tool);
    const validated = validateToolArguments(repaired.args, tool);
    if (!validated.valid) {
      // If validation fails, try to fix it
      const fixed = validateToolArguments(args, tool);
      if (fixed.valid) {
        const next = { ...parsed, arguments: fixed.args };
        const replacement = '```' + m[1] + '\n' + JSON.stringify(next) + '\n```';
        out = out.replace(m[0], replacement);
        changed = true;
      }
    } else if (repaired.changed) {
      const next = { ...parsed, arguments: repaired.args };
      const replacement = '```' + m[1] + '\n' + JSON.stringify(next) + '\n```';
      out = out.replace(m[0], replacement);
      changed = true;
    }
  }
  return out;
}

/**
 * True when the reply reads like "I could not use the tools" rather than an
 * answer. Deliberately broad: a missed tool call costs one extra turn,
 * while a missed refusal costs the agent its file access.
 */
export function looksLikeToolRefusal(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  if (/```tool_call/i.test(text) || /<tool_call[\s>]/i.test(text)) return false;
  const patterns = [
    // English
    /\bnot (?:been )?(?:exposed|available|present|listed|supported|enabled|reachable)\b/i,
    /\b(?:cannot|can't|unable to|could not|couldn't) (?:access|read|open|inspect|reach|connect to|use)\b/i,
    /\bno (?:tool|tools|file|path|directory) (?:is|are) (?:available|present|exposed|listed)\b/i,
    /\b(?:connection|connectivity|channel|bridge|tunnel|workspace|environment|filesystem|file environment|machine environment)[^.!?\n]{0,40}\b(?:timed out|timeout|error|failed|failure|unavailable|disconnected|not connected|broken|offline|inactive|interrupted|dropped|NOT_FOUND|not found)\b/i,
    /\b(?:connection|connectivity|environment|filesystem|workspace) (?:issue|problem|error)\b/i,
    /\b(?:not|wasn't|was not|isn't|is not) found (?:at|in) the (?:specified|current|given)?\s*path\b/i,
    /\bpath (?:isn't|is not|wasn't|was not) (?:present|found|valid|available)\b/i,
    /\b(?:please|kindly) (?:upload|attach|send|provide|zip|compress)\b/i,
    /\bi (?:attempted|tried|was able|could not|couldn't) to (?:access|read|open|inspect|connect)\b/i,
    /\bwhen (?:the|your) (?:environment|connection|workspace) (?:is|becomes) (?:connected|available)\b/i,
    /\bnot (?:actually )?(?:run|executed|executed yet)\b/i,
    // Arabic
    /مشكلة في الاتصال/,
    /انقطاع (?:الاتصال|التواصل|وصول)/,
    /تعذّر/,
    /تعذر/,
    /لم أتمكن/,
    /الأدوات غير متاحة/,
    /غير متاح(?:ة)?\s*(?:حاليًا|حالياً)?/,
    /لا أستطيع/,
    /توق[فت]?\s*الاتصال/,
    /(?:المسار|المجلد|الملف)\s*غير موجود/,
    /(?:ارفع|أرفق|أرسل)\s*(?:المجلد|الملف|مضغوط)/,
    /المسار غير موجود في بيئة/,
    /اتصال بيئة الجهاز/,
    /بيئة الجهاز/,
    /(?:على|في)\s*النظام\s*(?:الملف|المجلد)/,
    /(?:البيئة|بيئة)\s*(?:المشروع|الملفات|التنفيذ|العامل)/,
    /لم يتم(?: العثور)?[^.\n]{0,25}(?:على|بعد)/,
  ];
  return patterns.some((re) => re.test(text));
}

/**
 * The task text the model is asked about: the last REAL user message.
 * The gateway's own synthetic notes (the tool nudge, the bridge note) are
 * skipped — they never carry the task.
 */
export function lastUserText(messages: ChatMessage[]): string {
  const isSynthetic = (content: string) =>
    /Tool results are provided above/.test(content) ||
    /IMPORTANT \(override\): Tools are available NOW/.test(content);
  const users = (messages || []).filter(
    (m) => m?.role === 'user' && typeof m?.content === 'string' && !isSynthetic(String(m.content)),
  );
  const last = users[users.length - 1];
  return typeof last?.content === 'string' ? last.content : '';
}

/**
 * The local path the task is about. The last user message wins; an earlier
 * turn of the same task is used when the latest one names no path.
 */
export function findTaskPath(messages: ChatMessage[]): string | null {
  const isSynthetic = (content: string) =>
    /Tool results are provided above/.test(content) ||
    /IMPORTANT \(override\): Tools are available NOW/.test(content);
  const users = (messages || [])
    .filter((m) => m?.role === 'user' && typeof m?.content === 'string' && !isSynthetic(String(m.content)))
    .map((m) => String(m.content))
    .reverse();
  for (const text of users) {
    const path = findLocalPath(text);
    if (path) return path;
  }
  return null;
}

/**
 * Builds the tool-call hint for a request, or null when the request does
 * not name a local path (or no matching tool is announced).
 */
/**
 * Builds the tool-call hint for a request, or null when the request does
 * not name a local path (or no matching tool is announced).
 *
 * A path that does not exist yet still gets a call: the tool reports the
 * truth ("file not found") instead of the model inventing a broken file
 * environment.
 */
export function buildRequestHint(messages: ChatMessage[]): ToolCallBlock | null {
  const tools = extractAnnouncedTools(messages);
  if (!tools.length) return null;
  // A tool result in the conversation means a tool already ran: the model has
  // what it needs and must NOT be pushed into repeating the same call.
  if ((messages || []).some((m) => m?.role === 'tool')) return null;
  const text = lastUserText(messages);
  const path = findLocalPath(text);
  if (!path) return null;
  const kind = classifyPath(path);
  const wanted = kind === 'missing' ? guessPathKind(path) : kind;
  const picked = pickFileTool(tools, wanted === 'directory' ? 'directory' : 'file');
  if (!picked) return null;
  return buildToolCallBlock(picked.tool.name, picked.arg, path);
}

/**
 * A path that is not there yet: a name with an extension is a file, a bare
 * name is a folder.
 */
export function guessPathKind(path: string): 'file' | 'directory' {
  const base = path.split('/').pop() || '';
  return /\.[A-Za-z0-9]{1,12}$/.test(base) ? 'file' : 'directory';
}

/**
 * The call that starts a local inspection when the task names no path: list
 * the workspace root. Used by the repair only — the model has already
 * refused, so the task clearly needs the filesystem.
 */
export function buildWorkspaceRootCall(
  tools: AnnouncedTool[],
  roots: string[]
): ToolCallBlock | null {
  const root = (roots || []).find((r) => typeof r === 'string' && r.trim().length > 0);
  if (!root) return null;
  const picked = pickFileTool(tools, 'directory');
  if (!picked) return null;
  return buildToolCallBlock(picked.tool.name, picked.arg, root);
}

/**
 * Inserts the hint into the system message that carries the tool
 * instruction — at its END, right before the task. The model then reads the
 * exact call immediately above the request it has to fulfil.
 */
export function withHintSection(messages: ChatMessage[], call: ToolCallBlock, phase: 'first' | 'next' = 'first'): ChatMessage[] {
  const section = buildHintSection(call, phase);
  let changed = false;
  const out = (messages || []).map((m) => {
    if (changed || m?.role !== 'system') return m;
    const content = typeof m.content === 'string' ? m.content : '';
    if (!content.includes(TOOL_MODE_MARKER)) return m;
    changed = true;
    return { ...m, content: `${content}\n\n${section}` };
  });
  return changed ? out : messages;
}
