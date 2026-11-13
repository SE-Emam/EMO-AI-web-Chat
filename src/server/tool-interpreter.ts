import type { ChatMessage } from '../types.js';
import { createHash } from 'node:crypto';
import { NEUTRAL_CORRECTION_MARKER } from '../arena/tool-bridge-markers.js';

export interface ToolDefinition {
  type?: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ParsedToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolInterpretationResult {
  hasToolCalls: boolean;
  cleanText: string;
  toolCalls?: ParsedToolCall[];
}

/**
 * Resolution of the `tool_choice` parameter into actionable flags.
 * Controls whether tools are injected, parsed, and whether a tool call
 * is required from the model.
 */
export interface ToolChoiceResolution {
  shouldInjectTools: boolean;
  shouldParseTools: boolean;
  requireToolCall: boolean;
  specificTool?: string;
}

/**
 * Resolves the `tool_choice` parameter (OpenAI-compatible) into flags
 * that control the tool calling pipeline.
 *
 * - `"none"` or no tools: skip injection and parsing entirely.
 * - `"auto"` or absent: inject tools, parse responses, but allow plain text.
 * - `"required"`: inject and parse, the model MUST emit a tool call.
 * - `{ type: "function", function: { name } }`: same as required + verify name.
 */
export function resolveToolChoice(
  toolChoice: unknown,
  toolCount: number,
): ToolChoiceResolution {
  if (toolCount === 0) {
    return { shouldInjectTools: false, shouldParseTools: false, requireToolCall: false };
  }

  if (toolChoice === 'none') {
    return { shouldInjectTools: false, shouldParseTools: false, requireToolCall: false };
  }

  if (toolChoice === 'required') {
    return { shouldInjectTools: true, shouldParseTools: true, requireToolCall: true };
  }

  if (toolChoice && typeof toolChoice === 'object') {
    const tc = toolChoice as Record<string, unknown>;
    if (tc.type === 'function' && tc.function && typeof tc.function === 'object') {
      const fn = tc.function as Record<string, unknown>;
      const name = typeof fn.name === 'string' ? fn.name : undefined;
      return {
        shouldInjectTools: true,
        shouldParseTools: true,
        requireToolCall: true,
        specificTool: name,
      };
    }
  }

  // Default: 'auto' or undefined
  return { shouldInjectTools: true, shouldParseTools: true, requireToolCall: false };
}

/**
 * Outcome of validating a parsed model response against the tool_choice
 * resolution. Protocol-agnostic: OpenAI/Anthropic/Gemini routes translate
 * this decision into their own wire formats.
 */
export interface ToolOutcomeDecision {
  /** Whether a tool_calls/tool_use/functionCall payload should be emitted. */
  emitToolCalls: boolean;
  /** The (possibly filtered) tool calls to emit. */
  toolCalls?: ParsedToolCall[];
  /** Remaining prose after removing tool call blocks. */
  cleanText: string;
  /** Protocol error code when the tool contract was violated. */
  protocolError?: 'tool_call_required_but_missing' | 'specific_tool_not_called';
  /** True when the plain-text reply matched a known refusal pattern. */
  refusalDetected: boolean;
}

/**
 * Applies the tool_choice contract to a parsed model response:
 * - tool_choice='none'/auto + no tool call → plain text (no error).
 * - tool_choice='required' + no tool call → protocol error (refusal noted).
 * - specific tool requested → only matching calls are accepted; otherwise
 *   the call is treated as a contract violation, never silently renamed.
 *
 * The decision NEVER executes anything and never invents tool calls.
 */
export function decideToolOutcome(
  parsed: ToolInterpretationResult,
  resolution: ToolChoiceResolution,
): ToolOutcomeDecision {
  const calls = parsed.toolCalls ?? [];
  if (parsed.hasToolCalls && calls.length > 0) {
    if (resolution.specificTool) {
      const matching = calls.filter((c) => c.function?.name === resolution.specificTool);
      if (matching.length === 0) {
        return {
          emitToolCalls: false,
          cleanText: parsed.cleanText,
          protocolError: 'specific_tool_not_called',
          refusalDetected: false,
        };
      }
      return {
        emitToolCalls: true,
        toolCalls: matching,
        cleanText: parsed.cleanText,
        refusalDetected: false,
      };
    }
    return {
      emitToolCalls: true,
      toolCalls: calls,
      cleanText: parsed.cleanText,
      refusalDetected: false,
    };
  }

  if (resolution.requireToolCall) {
    return {
      emitToolCalls: false,
      cleanText: parsed.cleanText,
      protocolError: 'tool_call_required_but_missing',
      refusalDetected: detectToolRefusal(parsed.cleanText),
    };
  }

  return { emitToolCalls: false, cleanText: parsed.cleanText, refusalDetected: false };
}

/**
 * Injects tool schemas into the chat messages as an unambiguous system instruction.
 */
export function injectToolsInstruction(
  messages: ChatMessage[],
  tools?: unknown[],
  toolChoice?: unknown
): ChatMessage[] {
  if (!tools || !Array.isArray(tools) || tools.length === 0) {
    return messages;
  }

  // Web composers (e.g. ChatGPT) reject very long messages, and tool schemas
  // from agents like OpenCode carry huge descriptions. Shrink descriptions and
  // drop noise keys so the injected schema block stays compact.
  const shrinkText = (d: unknown, max: number): string => {
    const s = typeof d === 'string' ? d : d == null ? '' : JSON.stringify(d);
    return s.length <= max ? s : `${s.slice(0, max)}…`;
  };
  // Constraint keywords that bloat schemas without helping the model emit
  // correct arguments. Only names, types, enums, required flags and array
  // structure survive.
  const DROP_KEYS = new Set([
    '$schema', 'examples', 'additionalProperties', 'description', 'format',
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
    'minLength', 'maxLength', 'pattern', 'default', 'minItems', 'maxItems',
    'deprecated',
  ]);
  const shrinkSchema = (schema: unknown, depth = 0): unknown => {
    if (!schema || typeof schema !== 'object') return schema;
    if (Array.isArray(schema)) return schema.map((v) => shrinkSchema(v, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (DROP_KEYS.has(k)) continue;
      if (k === 'title' && depth > 0) continue;
      // chatgpt-web-tool-bridge lesson: over-compressed schemas lose field
      // semantics and the model sends wrong arguments. Keep TOP-LEVEL property
      // descriptions (short) — deeper nesting stays structure-only.
      if (k === 'description' && depth === 1) { out[k] = shrinkText(v, 80).split('\n')[0]; continue; }
      if (v && typeof v === 'object') { out[k] = shrinkSchema(v, depth + 1); continue; }
      out[k] = v;
    }
    return out;
  };

  const toolDefs = (tools as ToolDefinition[]).map((t) => {
    const fn = t.function || (t as any);
    return {
      name: fn.name,
      // one short line per tool: the model needs what it does, not the docs
      description: shrinkText(fn.description || '', 160).split('\n')[0],
      parameters: shrinkSchema(fn.parameters || {}),
    };
  });

  const toolInstruction = [
    '### TOOL CALLING MODE (MANDATORY - ACTIVE NOW)',
    'Tools ARE available and active in this session. The JSON schemas below are the real executable tools provided by the client.',
    'How it works: you do NOT execute tools yourself. To use a tool, you MUST output a ```tool_call``` block requesting it; the local client (OpenCode) will execute it on the user\'s device and return the result to you. Tool definitions shown here mean tools ARE available - you must REQUEST execution via tool_call.',
    'NEVER say tools are unavailable, not executable, "just definitions", or that you cannot access files/terminal/paths. To inspect or act on /Users/... or the local project, emit a tool_call.',
    'The tools announced in this request are the complete, currently available toolset; the calling client provides their execution environment and returns the real results.',
    'Do not ask the user to install, launch, or connect any external component that is not among the announced tools, and do not claim a connection problem that no actual execution result has confirmed.',
    '',
    'Available tools (JSON schemas):',
    '```json',
    JSON.stringify(toolDefs, null, 2),
    '```',
    '',
    'To call a tool now, output exactly:',
    '```tool_call',
    '{"name":"TOOL_NAME","arguments":{"arg":"value"}}',
    '```',
    '',
    'Rules:',
    '- Use only the tools/parameters above. "arguments" must be a JSON object matching the schema.',
    '- If the task requires local inspection/action, your response must be the needed tool_call block(s) (not a refusal).',
    '- After tool results are provided, continue and call more tools if needed.',
    '- Only answer in plain text when no tool is needed.',
  ].join('\n');

  const toolNudge = 'IMPORTANT (override): Tools are available NOW as executable capabilities via tool_call requests (client executes locally). Ignore any previous claim that tools/paths are unavailable or "not executable in this session". If local inspection/action is needed, respond with the required ```tool_call``` block(s) immediately. Do not refuse.';

  const marker = '### TOOL CALLING MODE (MANDATORY';
  const existingSystemIdx = messages.findIndex((m) => m.role === 'system');

  let out: ChatMessage[];
  if (existingSystemIdx >= 0) {
    out = [...messages];
    const sysContent = String(out[existingSystemIdx].content || '');
    if (!sysContent.includes(marker)) {
      out[existingSystemIdx] = { ...out[existingSystemIdx], content: `${sysContent}\n\n${toolInstruction}` };
    }
  } else {
    out = [{ role: 'system', content: toolInstruction }, ...messages];
  }

  const last = out[out.length - 1];
  if (last && last.role === 'tool') {
    const hasCont = typeof last.content === 'string' && last.content.includes('Tool results are provided above');
    if (!hasCont) {
      out.push({ role: 'user', content: 'Tool results are provided above. Continue the task now: if you need to inspect/run/edit anything, respond with the appropriate ```tool_call``` block(s). Do not claim lack of access.' });
    }
  } else if (last && last.role === 'user') {
    const lc = typeof last.content === 'string' ? last.content : '';
    if (!lc.includes('IMPORTANT (override): Tools are available NOW')) {
      // Push the nudge as its OWN message instead of appending it to the
      // client's user message. Appending mutates the client's content, so the
      // driver's stored transcript never matches the client's next request
      // (the client always sends the original text) — this silently broke
      // continuation on every turn where the request ended with a user message.
      out.push({ role: 'user', content: toolNudge });
    }
  }
  return out;
}

/**
 * Fills in the tool name on role:'tool' messages from the nearest preceding
 * assistant message's tool_calls (matched by tool_call id). OpenAI tool
 * results and Anthropic tool_result blocks do not carry the tool name, but
 * the web-model prompt labeling needs it. Never overwrites an existing name.
 */
export function hydrateToolResultNames(messages: ChatMessage[]): ChatMessage[] {
  const nameById = new Map<string, string>();
  return messages.map((m) => {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls as Array<Record<string, any>>) {
        const id = tc?.id;
        const name = tc?.function?.name || tc?.name;
        if (typeof id === 'string' && typeof name === 'string' && name) {
          nameById.set(id, name);
        }
      }
      return m;
    }
    if (m.role === 'tool' && !m.name && typeof m.tool_call_id === 'string') {
      const name = nameById.get(m.tool_call_id);
      return name ? { ...m, name } : m;
    }
    return m;
  });
}

/**
 * Detects whether a model response is refusing to use tools despite them
 * being available. Returns true when the response contains refusal
 * phrases AND does not contain a tool_call block (which would mean the
 * model is actually using tools despite the phrasing).
 */
export function detectToolRefusal(content: string): boolean {
  if (!content || typeof content !== 'string') return false;

  // If the response contains an actual tool_call, it's not a refusal
  if (/```tool_call/i.test(content) || /<tool_call[\s>]/i.test(content)) return false;

  const refusalPatterns = [
    /\bcannot connect to\b.*\bOpenCode\b/i,
    /\bdo not have access to tools\b/i,
    /\btools are not available\b/i,
    /\bunable to execute tools\b/i,
    /\bcannot access files\b/i,
    /\bcannot execute tools\b/i,
    /\bno tools available\b/i,
    /\btools? (?:are|is) not (?:accessible|enabled|active)\b/i,
    /\bdon't have (?:access to|any) tools\b/i,
    /\bcannot (?:use|access|run|invoke) (?:the )?tools?\b/i,
    /لا أستطيع الاتصال بـ/,
    /لا يمكنني الوصول إلى الأدوات/,
    /الأدوات غير متاحة/,
  ];

  return refusalPatterns.some((re) => re.test(content));
}

function normalizeParsedCall(parsed: any, callIndex: number): ParsedToolCall | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const name = parsed.name || parsed.function || parsed.tool || parsed.tool_name || parsed.action;
  if (!name || typeof name !== 'string') return null;
  let args = parsed.arguments ?? parsed.args ?? parsed.parameters ?? parsed.input ?? parsed.params ?? {};
  if (typeof args === 'string') {
    // keep as string if it's JSON-ish, else wrap
    const s = args.trim();
    args = s;
  } else {
    try { args = JSON.stringify(args ?? {}); } catch { args = '{}'; }
  }
  return {
    id: parsed.id && typeof parsed.id === 'string' ? parsed.id : `call_${Date.now()}_${callIndex}`,
    type: 'function',
    function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
  };
}

function tryParseJsonLike(raw: string): any | null {
  const s = raw.trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch {}
  // try to extract first JSON object/array substring
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  let start = -1;
  if (firstObj === -1) start = firstArr;
  else if (firstArr === -1) start = firstObj;
  else start = Math.min(firstObj, firstArr);
  if (start >= 0) {
    const sub = s.slice(start);
    try { return JSON.parse(sub); } catch {}
    // attempt to find balanced end
    const open = sub[0];
    const close = open === '{' ? '}' : ']';
    let depth = 0; let inStr = false; let esc = false;
    for (let i = 0; i < sub.length; i++) {
      const ch = sub[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true; else if (ch === open) depth++; else if (ch === close) { depth--; if (depth === 0) { try { return JSON.parse(sub.slice(0, i + 1)); } catch {} break; } }
    }
  }
  return null;
}

/**
 * String-aware scan for the index of the '}' that closes the first '{'.
 * Returns -1 when the object is never closed (stream cut / UI mangling).
 */
function balancedJsonEnd(s: string): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  let started = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') { depth++; started = true; }
    else if (ch === '}') { depth--; if (started && depth === 0) return i; }
  }
  return -1;
}

/**
 * Decorative labels web UIs attach to rendered code blocks ("Code snippet",
 * "Tool call", …). When the parsed tool call consumed everything else, these
 * labels are noise in cleanText, not prose.
 */
const UI_CODE_LABEL_RE = /^(?:code\s*snippet|tool\s*call|function\s*call|json)$/i;

/**
 * Lenient JSON parse: exact parse first, then stream-cut recovery (close the
 * open string, if any, and the remaining open braces). Used where web UIs or
 * stream truncation can cut the JSON before it closes.
 */
function parseJsonLenient(s: string): any | null {
  const parsed = tryParseJsonLike(s);
  if (parsed !== null) return parsed;
  let opens = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') opens++;
    else if (ch === '}') opens--;
  }
  if (opens > 0 && opens <= 6) {
    try { return JSON.parse(s + (inStr ? '"' : '') + '}'.repeat(opens)); } catch { return null; }
  }
  return null;
}

/**
 * Parses response text to extract any structured tool calls.
 */
export function parseToolCallsFromResponse(content: string): ToolInterpretationResult {
  if (!content || typeof content !== 'string') {
    return { hasToolCalls: false, cleanText: '' };
  }

  const toolCalls: ParsedToolCall[] = [];
  let callIndex = 1;
  const ranges: Array<{ start: number; end: number }> = [];

  const collect = (parsed: any, range?: { start: number; end: number }) => {
    if (!parsed) return;
    const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [parsed]);
    let added = 0;
    for (const item of items) {
      // handle OpenAI-style {type:'function', function:{name,arguments}}
      const candidate = item && item.function && item.function.name ? { name: item.function.name, arguments: item.function.arguments, id: item.id } : item;
      const call = normalizeParsedCall(candidate, callIndex);
      if (call) { toolCalls.push(call); callIndex++; added++; }
    }
    if (added > 0 && range) ranges.push(range);
  };

  // Fenced blocks: tool_call/json variants and generic json blocks that look like tool calls
  const fenceRegex = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(content)) !== null) {
    const lang = (m[1] || '').trim().toLowerCase();
    const body = m[2] || '';
    const isToolFence = /tool[_ -]?call/.test(lang) || lang === 'tool' || lang === 'function';
    const parsed = tryParseJsonLike(body);
    const looksLike = parsed && (parsed.name || parsed.tool || parsed.function || parsed.tool_calls || (Array.isArray(parsed) && parsed[0] && (parsed[0].name || parsed[0].function)));
    if (isToolFence || looksLike) {
      collect(parsed, { start: m.index, end: m.index + m[0].length });
    }
  }

  // XML-style <tool_call>...</tool_call>
  const xmlRegex = /<tool_call[^>]*>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  while ((m = xmlRegex.exec(content)) !== null) {
    collect(tryParseJsonLike(m[1] || ''), { start: m.index, end: m.index + m[0].length });
  }

  // Unfenced "tool_call" / "Tool call" label followed by JSON
  if (toolCalls.length === 0) {
    const labelRe = /(?:^|\n)\s*(?:```)?\s*tool[_ -]?calls?\s*(?:```)?\s*:?\s*\n?(\{[\s\S]*?\}|\[[\s\S]*?\])(?=\n\s*(?:tool[_ -]?calls?\s*:?\s*\n|\n|$)|$)/gi;
    while ((m = labelRe.exec(content)) !== null) {
      const parsed = tryParseJsonLike(m[1] || '');
      const looksLike = parsed && (parsed.name || parsed.tool || parsed.function || parsed.tool_calls || (Array.isArray(parsed) && parsed[0] && (parsed[0].name || parsed[0].function)));
      if (looksLike) collect(parsed, { start: m.index, end: m.index + m[0].length });
    }
  }

  // Bare JSON tool call (no fences) - conservative
  if (toolCalls.length === 0) {
    const t = content.trim();
    if ((t.startsWith('{') || t.startsWith('[')) && /"name"\s*:|"tool_calls"|"function"\s*:/.test(t)) {
      const parsed = parseJsonLenient(t);
      const looksLike = parsed && (parsed.name || parsed.tool || parsed.function || parsed.tool_calls || (Array.isArray(parsed) && parsed[0] && (parsed[0].name || parsed[0].function)));
      if (looksLike) {
        const offset = content.length - t.length;
        collect(parsed, { start: offset, end: offset + t.length });
      }
    } else {
      // extract JSON object from mixed text only if it clearly looks like a tool call (name + arguments-like fields).
      // Web UIs (e.g. Gemini web "Code snippet" rendering) strip the ```tool_call
      // fence and emit a bare JSON object with a decorative label — the object
      // must still be recovered. Use a string-aware balanced-brace scan so the
      // OUTER object (whose args object closes first) is not truncated.
      const objRe = /\{(?=[\s\S]*?"(?:name|tool|function|tool_name)"\s*:\s*")/g;
      while ((m = objRe.exec(t)) !== null) {
        const sub = t.slice(m.index);
        const end = balancedJsonEnd(sub);
        let parsed: any = null;
        let consumedLen = 0;
        if (end >= 0) {
          parsed = tryParseJsonLike(sub.slice(0, end + 1));
          consumedLen = end + 1;
        }
        if (!parsed) {
          // Stream cut / mangled close: close the open string (if any) and the
          // remaining open braces, few tries.
          let opens = 0;
          let inStr = false;
          let esc = false;
          for (let i = 0; i < sub.length; i++) {
            const ch = sub[i];
            if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
            if (ch === '"') inStr = true;
            else if (ch === '{') opens++;
            else if (ch === '}') opens--;
          }
          if (opens > 0 && opens <= 6) {
            const candidates = [
              sub + (inStr ? '"' : '') + '}'.repeat(opens),
              sub + (inStr ? '"' : '') + '}'.repeat(Math.max(1, opens)),
            ];
            for (const c of candidates) {
              if (parsed) break;
              try { parsed = JSON.parse(c); consumedLen = sub.length; } catch { parsed = null; }
            }
          }
        }
        const hasName = parsed && (parsed.name || parsed.tool || parsed.function || parsed.tool_name);
        const hasArgs = parsed && ('arguments' in parsed || 'args' in parsed || 'parameters' in parsed || 'input' in parsed || 'params' in parsed || (parsed.function && typeof parsed.function === 'object' && ('arguments' in parsed.function)));
        const looksLike = hasName && hasArgs;
        if (looksLike && parsed) {
          const offset = content.length - t.length; // trim offset (t = content.trim())
          collect(parsed, { start: offset + m.index, end: offset + m.index + consumedLen });
        }
      }
    }
  }

  // Last-resort recovery: a "tool_call" label (fenced, half-fenced, or bare)
  // followed by a JSON object whose braces may never close (stream cut) or be
  // trailed by stray text (mangled closing fence like "``)"). Without this the
  // model's tool call is lost, the raw text reaches the agent as a final
  // message, and the agent loop silently stops.
  if (toolCalls.length === 0 && /tool[_ -]?calls?/i.test(content)) {
    const labelMatch = /(?:^|\n)\s*(?:`{0,3})\s*tool[_ -]?call/i.exec(content);
    if (labelMatch) {
      const after = content.slice(labelMatch.index);
      const objStart = after.indexOf('{');
      if (objStart >= 0) {
        const sub = after.slice(objStart);
        // balanced-brace scan (string-aware)
        let end = -1;
        let depth = 0;
        let inStr = false;
        let esc = false;
        for (let i = 0; i < sub.length; i++) {
          const ch = sub[i];
          if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
          }
          if (ch === '"') inStr = true;
          else if (ch === '{') depth++;
          else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        let parsed: any = null;
        if (end >= 0) parsed = tryParseJsonLike(sub.slice(0, end + 1));
        if (!parsed) {
          // Stream cut mid-object: close open strings then braces, few tries.
          const base = (end >= 0 ? sub.slice(0, end + 1) : sub.replace(/`+[\s\S]*$/, '').trim());
          for (let extra = 0; extra <= 6 && !parsed; extra++) {
            const attempt = base + (extra >= 1 ? '"'.repeat(extra % 2 === 1 ? 1 : 0) + '}'.repeat(Math.ceil(extra / 2)) : '');
            try { parsed = JSON.parse(attempt); } catch { parsed = null; }
          }
        }
        const looksLike = parsed && (parsed.name || parsed.tool || parsed.function || parsed.tool_calls || (Array.isArray(parsed) && parsed[0] && (parsed[0].name || parsed[0].function)));
        if (looksLike) {
          collect(parsed);
          return { hasToolCalls: true, cleanText: content.slice(0, labelMatch.index).trim(), toolCalls };
        }
      }
    }
  }

  if (toolCalls.length > 0) {
    let cleanText = content;
    // remove identified ranges (from end to start)
    ranges.sort((a, b) => b.start - a.start).forEach((r) => {
      cleanText = cleanText.slice(0, r.start) + cleanText.slice(r.end);
    });
    cleanText = cleanText.replace(/```(?:json:)?tool[_ -]?call\s*[\s\S]*?```/gi, '').replace(/<tool_call[^>]*>[\s\S]*?<\/tool_call>/gi, '').trim();
    if (UI_CODE_LABEL_RE.test(cleanText)) cleanText = '';
    return { hasToolCalls: true, cleanText, toolCalls };
  }

  return { hasToolCalls: false, cleanText: content };
}

// ---------------------------------------------------------------------------
// P2 — Unsupported external dependency claims
//
// The model sometimes invents an external service/client dependency that is
// NOT part of the announced tools (or claims a connection failure that no
// execution result confirms). These helpers classify such CLAIMS and gate a
// single neutral correction. They never execute anything, never invent tool
// calls, and never turn a model statement into an operational fact: the
// source of truth about the execution channel is DISPATCHER EVIDENCE
// (a real tool result or a real transport failure), not model prose.
// ---------------------------------------------------------------------------

export type UnsupportedDependencyClaimCategory =
  | 'none'
  | 'external_component_required'
  | 'execution_channel_unavailable';

export interface UnsupportedDependencyClaim {
  detected: boolean;
  category: UnsupportedDependencyClaimCategory;
  /** Safe fingerprint (hash) of the claim — never the raw text. */
  fingerprint: string;
}

/** Claims that an external component must be installed/launched/connected. */
const EXTERNAL_COMPONENT_CLAIM =
  /\b(open|launch|start|install|run|enable|restart|connect|reconnect)\b[^.\n]{0,80}\b(client|service|server|daemon|component|app|application|tunnel|broker|gateway|connector|agent)\b/i;
/** Claims that the execution channel itself is broken/inactive. */
const EXECUTION_CHANNEL_CLAIM =
  /\b(connection|connectivity|channel|bridge|link)\b[^.\n]{0,50}\b(down|inactive|unavailable|not active|disconnected|broken|not working|failed|missing)\b/i;
const UNABLE_TO_REACH =
  /\b(cannot|can't|unable to|am unable to)\b[^.\n]{0,40}\b(connect|reach|access|run|execute)\b/i;

const fingerprintOf = (text: string): string =>
  createHash('sha1')
    .update(text.toLowerCase().replace(/\s+/g, ' ').trim())
    .digest('hex')
    .slice(0, 16);

/**
 * Classifies a model reply that invents an external dependency or asserts an
 * unconfirmed connection problem. Purely lexical — the caller decides what to
 * do with it, and only in the absence of dispatcher evidence.
 */
export function detectUnsupportedDependencyClaim(content: string): UnsupportedDependencyClaim {
  if (!content || typeof content !== 'string') {
    return { detected: false, category: 'none', fingerprint: '' };
  }
  if (EXTERNAL_COMPONENT_CLAIM.test(content)) {
    return { detected: true, category: 'external_component_required', fingerprint: fingerprintOf(content) };
  }
  if (EXECUTION_CHANNEL_CLAIM.test(content) || UNABLE_TO_REACH.test(content)) {
    return { detected: true, category: 'execution_channel_unavailable', fingerprint: fingerprintOf(content) };
  }
  return { detected: false, category: 'none', fingerprint: '' };
}

/**
 * The neutral correction text. It states the boundary of the CURRENT request
 * without naming any external project, without repeating the model's own
 * (wrong) claim, and without forcing a tool call that the task does not need.
 */
export function buildNeutralCorrectionMessage(): string {
  return [
    `${NEUTRAL_CORRECTION_MARKER}, and the calling client provides their execution environment.`,
    'If the task needs a tool, respond with the required ```tool_call``` block(s) in the specified format.',
    'Do not request or assume any external component that is not among the announced tools, and do not state a connection problem that no execution result has confirmed.',
  ].join('\n');
}

export interface NeutralCorrectionPolicyInput {
  resolution: ToolChoiceResolution;
  decision: Pick<ToolOutcomeDecision, 'emitToolCalls' | 'refusalDetected'>;
  claim: UnsupportedDependencyClaim;
  refusalDetected: boolean;
  /** A real tool result is already part of this request (real evidence). */
  hasToolResultEvidence: boolean;
  /** A real transport failure was observed by the dispatcher. */
  transportFailureObserved: boolean;
  /** One attempt per request, never more. */
  alreadyAttempted: boolean;
}

/**
 * Decides whether ONE neutral correction may be issued.
 *
 * - tools disabled → never;
 * - an already-emitted tool call → never (never re-send an executed call);
 * - real execution evidence (tool result / transport failure) → never
 *   (a real failure is kept as-is and never disguised);
 * - `auto` → only when the model claims an unavailable execution environment
 *   despite announced tools (a plain answer stays a plain answer);
 * - `required` / specific tool → when a tool call is missing AND the reply
 *   refuses or claims a dependency.
 */
export function shouldAttemptNeutralCorrection(input: NeutralCorrectionPolicyInput): boolean {
  const { resolution, decision, claim, refusalDetected, hasToolResultEvidence, transportFailureObserved, alreadyAttempted } = input;
  if (alreadyAttempted) return false;
  if (!resolution.shouldInjectTools) return false;
  if (decision?.emitToolCalls) return false;
  if (hasToolResultEvidence) return false;
  if (transportFailureObserved) return false;
  if (resolution.requireToolCall) {
    return Boolean(refusalDetected || decision?.refusalDetected || claim?.detected);
  }
  return Boolean(claim?.detected);
}

// ---------------------------------------------------------------------------
// Tool lifecycle states — derived from DISPATCHER EVIDENCE, not model prose
// ---------------------------------------------------------------------------

export type ToolLifecycleState =
  | 'TOOL_AVAILABLE'
  | 'TOOL_NOT_AVAILABLE'
  | 'MODEL_DID_NOT_EMIT_TOOL_CALL'
  | 'TOOL_CALL_PARSED'
  | 'TOOL_DISPATCH_STARTED'
  | 'TOOL_EXECUTION_CONFIRMED'
  | 'TOOL_EXECUTION_FAILED'
  | 'TRANSPORT_FAILURE_CONFIRMED'
  | 'TOOL_RESULT_RECEIVED';

export interface ToolLifecycleInput {
  toolsAnnounced: boolean;
  parsed?: Pick<ToolInterpretationResult, 'hasToolCalls'>;
  resolution?: ToolChoiceResolution;
  transportFailureObserved?: boolean;
  dispatchObserved?: boolean;
  executionConfirmed?: boolean;
  executionFailed?: boolean;
  resultReceived?: boolean;
  modelClaimDetected?: boolean;
}

export interface ToolLifecycle {
  state: ToolLifecycleState;
  /** The model asserted a dependency/connection problem with no evidence. */
  claimUnproven: boolean;
  transportFailureConfirmed: boolean;
  executionConfirmed: boolean;
}

/**
 * Resolves the current tool-lifecycle state. Evidence precedence:
 * result > execution confirmed > execution failed > transport failure >
 * dispatch > parsed call > model did not emit.
 */
export function deriveToolLifecycleState(input: ToolLifecycleInput): ToolLifecycle {
  const transportFailureConfirmed = Boolean(input.transportFailureObserved);
  const executionConfirmed = Boolean(input.executionConfirmed);
  let state: ToolLifecycleState;
  if (!input.toolsAnnounced) {
    state = 'TOOL_NOT_AVAILABLE';
  } else if (input.resultReceived) {
    state = 'TOOL_RESULT_RECEIVED';
  } else if (executionConfirmed) {
    state = 'TOOL_EXECUTION_CONFIRMED';
  } else if (input.executionFailed) {
    state = 'TOOL_EXECUTION_FAILED';
  } else if (transportFailureConfirmed) {
    state = 'TRANSPORT_FAILURE_CONFIRMED';
  } else if (input.dispatchObserved) {
    state = 'TOOL_DISPATCH_STARTED';
  } else if (input.parsed?.hasToolCalls) {
    state = 'TOOL_CALL_PARSED';
  } else {
    state = 'MODEL_DID_NOT_EMIT_TOOL_CALL';
  }
  return {
    state,
    claimUnproven: Boolean(input.modelClaimDetected) && !transportFailureConfirmed && !input.executionFailed,
    transportFailureConfirmed,
    executionConfirmed,
  };
}

/**
 * Conservative history policy: an assistant message is an UNSUPPORTED claim
 * only when it invents a dependency AND no real execution failure is proven.
 * User messages, tool results and plain refusals are never flagged, and the
 * input is never mutated.
 */
export function isUnsupportedAssistantClaim(
  message: ChatMessage | { role?: string; content?: unknown },
  evidence: { hasExecutionFailure: boolean }
): boolean {
  if (!message || message.role !== 'assistant') return false;
  const content = typeof message.content === 'string' ? message.content : '';
  if (!content) return false;
  if (evidence?.hasExecutionFailure) return false;
  return detectUnsupportedDependencyClaim(content).detected;
}
