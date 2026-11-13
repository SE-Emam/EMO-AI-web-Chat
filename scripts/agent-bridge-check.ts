#!/usr/bin/env node
/**
 * agent-bridge-check.ts — LIVE verification harness for the EMO.ai agent bridge.
 *
 * WHAT IT MEASURES
 * ----------------
 * The whole project depends on one thing: when an agent (OpenCode, Cline, ...)
 * announces its tools to the gateway, does the WEB MODEL (ChatGPT driven through
 * a real browser) actually emit an OpenAI-style tool call back — instead of
 * answering in prose and pretending the filesystem is unreachable?
 *
 * This harness talks to the gateway over HTTP ONLY (no browser code of its own):
 *
 *   POST http://127.0.0.1:8989/v1/chat/completions
 *   Authorization: Bearer <api key>
 *   { model, messages:[{role:'user',content:<task>}], tools:<tool set>,
 *     tool_choice:'auto', stream:false }
 *
 * Every scenario = (agent tool set) x (task). Each answer is classified as:
 *
 *   TOOL_CALL   a tool call was emitted, its name matches the expectation for
 *               the task, and its arguments validate against the tool schema
 *   WRONG_TOOL  a tool call was emitted, but the tool is not the expected one
 *   BAD_ARGS    the expected tool was called, but the arguments violate the
 *               tool schema (unknown property or missing required property)
 *   TEXT        the model answered in prose (no tool call at all)
 *   ERROR       the request failed (HTTP status, timeout, non-JSON body, ...)
 *
 * The exit code is non-zero when the TOOL_CALL rate is below --min-rate.
 *
 * SAFETY RULES ENFORCED HERE
 * ---------------------------
 *  - The gateway base URL MUST be a loopback address. The harness refuses to
 *    send anything to a non-local host, so it can never talk to a provider
 *    directly.
 *  - The API key is never printed, never included in the output and never
 *    written to disk. Any accidental occurrence of it in printed text is
 *    redacted.
 *  - Nothing is written to disk at all: no temp files, no caches.
 *
 * USAGE
 *   npx tsx scripts/agent-bridge-check.ts
 *   npx tsx scripts/agent-bridge-check.ts --scenarios opencode:dir-en
 *   npx tsx scripts/agent-bridge-check.ts --scenarios opencode:dir-en,cline:file-ar
 *   npx tsx scripts/agent-bridge-check.ts --timeout 600000 --min-rate 0.9
 *   npx tsx scripts/agent-bridge-check.ts --json
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'http://127.0.0.1:8989';
const DEFAULT_MODEL = 'chatgpt-web:default';
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MIN_RATE = 0.8;
const DEFAULT_API_KEY = 'emo.web';

/** The path used by the tasks — it must exist on this machine. */
const PROJECT_PATH = '/Users/emamabdullaziz/Desktop/Doctor-Car';
const PROJECT_FILE = `${PROJECT_PATH}/README.md`;

// ---------------------------------------------------------------------------
// Tool sets (mirroring the real agent clients, kept self-contained on purpose:
// this harness must not import from src/ so it stays independent of the code
// under test).
// ---------------------------------------------------------------------------

interface ToolParam {
  type: string;
  description?: string;
  items?: unknown;
  properties?: Record<string, ToolParam>;
  required?: string[];
}

interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, ToolParam>;
      required: string[];
    };
  };
}

function tool(
  name: string,
  description: string,
  properties: Record<string, ToolParam>,
  required: string[],
): ToolDef {
  return {
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
  };
}

const STR = (description: string): ToolParam => ({ type: 'string', description });
const NUM = (description: string): ToolParam => ({ type: 'number', description });
const BOOL = (description: string): ToolParam => ({ type: 'boolean', description });

const OPENCODE_TOOLS: ToolDef[] = [
  tool('bash', 'Execute a bash command in the project directory.', { command: STR('The bash command to run.') }, ['command']),
  tool('edit', 'Replace an exact string in a file.', {
    filePath: STR('Absolute path to the file.'),
    oldString: STR('Text to replace.'),
    newString: STR('Replacement text.'),
  }, ['filePath', 'oldString', 'newString']),
  tool('glob', 'Find files matching a glob pattern.', {
    pattern: STR('Glob pattern, e.g. **/*.ts.'),
    path: STR('Directory to search in.'),
  }, ['pattern']),
  tool('grep', 'Search file contents with a regular expression.', {
    pattern: STR('Regular expression to search for.'),
    path: STR('Directory to search in.'),
  }, ['pattern']),
  tool('list', 'List the files and directories at a path.', {
    path: STR('Absolute path of the directory to list.'),
    recursive: BOOL('List recursively.'),
  }, ['path']),
  tool('patch', 'Apply a patch file to the project.', { path: STR('Absolute path of the patch file.') }, ['path']),
  tool('read', 'Read a file with an optional offset and limit.', {
    filePath: STR('Absolute path of the file to read.'),
    offset: NUM('Line offset to start reading from.'),
    limit: NUM('Maximum number of lines to read.'),
  }, ['filePath']),
  tool('read_file', 'Read the contents of a file.', { filePath: STR('Absolute path of the file to read.') }, ['filePath']),
  tool('todowrite', 'Create or update the todo list.', {
    todos: { type: 'array', description: 'The todo items.', items: { type: 'object' } },
  }, ['todos']),
  tool('todoread', 'Read the current todo list.', {}, []),
  tool('webfetch', 'Fetch a URL and return its content as text.', { url: STR('The URL to fetch.') }, ['url']),
  tool('write', 'Write content to a file.', {
    filePath: STR('Absolute path of the file to write.'),
    content: STR('The file content.'),
  }, ['filePath', 'content']),
];

const CLINE_TOOLS: ToolDef[] = [
  tool('read_file', 'Read the contents of a file.', { path: STR('Absolute path of the file to read.') }, ['path']),
  tool('list_files', 'List files and directories in a directory.', { path: STR('Absolute path of the directory.') }, ['path']),
  tool('list_codebase', 'List the codebase structure from a root directory.', { path: STR('Root directory of the codebase.') }, ['path']),
  tool('search_files', 'Search files with a regular expression.', {
    path: STR('Directory to search in.'),
    regex: STR('Regular expression to search for.'),
  }, ['path', 'regex']),
  tool('write_file', 'Write content to a file.', {
    path: STR('Absolute path of the file to write.'),
    content: STR('The file content.'),
  }, ['path', 'content']),
  tool('execute_command', 'Execute a shell command in the workspace.', { command: STR('The command to execute.') }, ['command']),
];

const TOOL_SETS: Record<string, ToolDef[]> = {
  opencode: OPENCODE_TOOLS,
  cline: CLINE_TOOLS,
};

/** Tool families used to judge whether the picked tool fits the task. */
const LISTING_TOOLS = ['list', 'list_files', 'list_codebase'];
const READING_TOOLS = ['read', 'read_file'];

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

interface Task {
  id: string;
  prompt: string;
  /** "dir" → a listing tool is expected, "file" → a reading tool is expected. */
  kind: 'dir' | 'file';
}

const TASKS: Task[] = [
  { id: 'dir-en', prompt: `Read the files in ${PROJECT_PATH}`, kind: 'dir' },
  { id: 'dir-ar', prompt: `اقرأ ملفات المشروع في ${PROJECT_PATH}`, kind: 'dir' },
  { id: 'file-en', prompt: `Read the file ${PROJECT_FILE}`, kind: 'file' },
  { id: 'file-ar', prompt: `اقرأ الملف ${PROJECT_FILE}`, kind: 'file' },
];

// ---------------------------------------------------------------------------
// Scenario matrix
// ---------------------------------------------------------------------------

interface Scenario {
  id: string;
  toolSetId: string;
  taskId: string;
  tools: ToolDef[];
  task: Task;
  /** Tool names that would satisfy this task, intersected with the tool set. */
  expectedTools: string[];
}

function expectedToolsFor(toolSetId: string, task: Task): string[] {
  const available = new Set(TOOL_SETS[toolSetId].map((t) => t.function.name));
  const family = task.kind === 'dir' ? LISTING_TOOLS : READING_TOOLS;
  return family.filter((name) => available.has(name));
}

const SCENARIOS: Scenario[] = Object.keys(TOOL_SETS).flatMap((toolSetId) =>
  TASKS.map((task) => ({
    id: `${toolSetId}:${task.id}`,
    toolSetId,
    taskId: task.id,
    tools: TOOL_SETS[toolSetId],
    task,
    expectedTools: expectedToolsFor(toolSetId, task),
  })),
);

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface Options {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  minRate: number;
  scenarios: string[] | null;
  json: boolean;
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/agent-bridge-check.ts [options]',
    '',
    'Options:',
    '  --scenarios <ids>   Comma separated scenario ids (e.g. opencode:dir-en,cline:file-ar).',
    '                     "all" runs every scenario (default).',
    '  --timeout <ms>      Per-request timeout in milliseconds (default 300000).',
    '  --min-rate <0..1>   Minimum TOOL_CALL rate required to exit 0 (default 0.8).',
    '  --json              Print the results as JSON instead of a table.',
    '  --base-url <url>    Gateway base URL (default http://127.0.0.1:8989, loopback only).',
    '  --model <id>        Model id to request (default chatgpt-web:default).',
    '  --help              Show this help.',
  ].join('\n');
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    apiKey: process.env.EMO_GATEWAY_API_KEY?.trim() || DEFAULT_API_KEY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    minRate: DEFAULT_MIN_RATE,
    scenarios: null,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error(`Missing value for ${arg}`);
      }
      return value;
    };
    switch (arg) {
      case '--scenarios':
      case '--scenario': {
        const raw = next();
        const ids = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
        opts.scenarios = ids.length === 1 && ids[0].toLowerCase() === 'all' ? null : ids;
        break;
      }
      case '--timeout': {
        const ms = Number(next());
        if (!Number.isFinite(ms) || ms <= 0) throw new Error(`Invalid --timeout value: ${ms}`);
        opts.timeoutMs = Math.floor(ms);
        break;
      }
      case '--min-rate': {
        const rate = Number(next());
        if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error(`Invalid --min-rate value: ${rate}`);
        opts.minRate = rate;
        break;
      }
      case '--base-url': opts.baseUrl = next(); break;
      case '--model': opts.model = next(); break;
      case '--json': opts.json = true; break;
      case '--help':
      case '-h':
        console.log(usage());
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Safety helpers
// ---------------------------------------------------------------------------

/** The harness only ever talks to a local gateway. */
function assertLoopback(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid --base-url: ${baseUrl}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || /^127\./.test(host);
  if (!loopback) {
    throw new Error(
      `Refusing to send requests to non-loopback host "${host}". ` +
        'This harness may only talk to the local gateway.',
    );
  }
  return url;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

type Status = 'TOOL_CALL' | 'WRONG_TOOL' | 'BAD_ARGS' | 'TEXT' | 'ERROR';

interface ScenarioResult {
  id: string;
  toolSet: string;
  task: string;
  status: Status;
  expectedTools: string[];
  toolName: string | null;
  arguments: unknown;
  argsValid: boolean | null;
  argsProblems: string[];
  text: string;
  httpStatus: number | null;
  durationMs: number;
  error: string | null;
}

interface GatewayResponse {
  httpStatus: number;
  bodyText: string;
  json: any;
}

/** Raised when a request exceeds --timeout. */
class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

// ---------------------------------------------------------------------------
// Gateway call
// ---------------------------------------------------------------------------

async function callGateway(opts: Options, scenario: Scenario): Promise<GatewayResponse> {
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const body = {
    model: opts.model,
    messages: [{ role: 'user', content: scenario.task.prompt }],
    tools: scenario.tools,
    tool_choice: 'auto',
    stream: false,
  };

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  // The deadline is enforced by a race, not only by the abort signal: undici
  // can keep a stalled response body pending long after `abort()` was called
  // (observed: a 300 s timeout that only surfaced after 910 s). The race
  // guarantees the harness always moves on at the deadline.
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(`timeout after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);
  });

  const request = (async (): Promise<GatewayResponse> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const bodyText = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(bodyText);
    } catch {
      json = null;
    }
    return { httpStatus: res.status, bodyText, json };
  })();

  try {
    return await Promise.race([request, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
    // The losing promise (the request) must not produce an unhandled rejection.
    request.catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function parseArguments(raw: unknown): { ok: boolean; value: Record<string, unknown>; problem: string | null } {
  if (raw === null || raw === undefined) return { ok: false, value: {}, problem: 'missing arguments' };
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return { ok: false, value: {}, problem: 'empty arguments string' };
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, value: {}, problem: 'arguments are not a JSON object' };
      }
      return { ok: true, value: parsed as Record<string, unknown>, problem: null };
    } catch {
      return { ok: false, value: {}, problem: 'arguments are not valid JSON' };
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { ok: true, value: raw as Record<string, unknown>, problem: null };
  }
  return { ok: false, value: {}, problem: 'arguments are not a JSON object' };
}

function validateArguments(
  toolDef: ToolDef | undefined,
  args: Record<string, unknown>,
): { valid: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!toolDef) {
    return { valid: false, problems: ['tool is not part of the announced tool set'] };
  }
  const schema = toolDef.function.parameters ?? { type: 'object', properties: {}, required: [] };
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  for (const key of Object.keys(args)) {
    if (!(key in properties)) {
      problems.push(`unknown argument "${key}" (allowed: ${Object.keys(properties).join(', ') || 'none'})`);
    }
  }
  for (const key of required) {
    if (!(key in args) || args[key] === undefined || args[key] === null) {
      problems.push(`missing required argument "${key}"`);
    }
  }
  return { valid: problems.length === 0, problems };
}

function classify(scenario: Scenario, gw: GatewayResponse): ScenarioResult {
  const base: ScenarioResult = {
    id: scenario.id,
    toolSet: scenario.toolSetId,
    task: scenario.taskId,
    status: 'ERROR',
    expectedTools: scenario.expectedTools,
    toolName: null,
    arguments: null,
    argsValid: null,
    argsProblems: [],
    text: '',
    httpStatus: gw.httpStatus,
    durationMs: 0,
    error: null,
  };

  if (gw.httpStatus < 200 || gw.httpStatus >= 300) {
    base.status = 'ERROR';
    base.error = `HTTP ${gw.httpStatus}: ${gw.bodyText.slice(0, 200)}`;
    return base;
  }
  if (!gw.json) {
    base.status = 'ERROR';
    base.error = `non-JSON response (HTTP ${gw.httpStatus}): ${gw.bodyText.slice(0, 200)}`;
    return base;
  }

  const choices = gw.json?.choices;
  const message = Array.isArray(choices) && choices.length > 0 ? choices[0]?.message : undefined;
  const rawCalls = message?.tool_calls;
  const content = typeof message?.content === 'string' ? message.content : '';

  if (Array.isArray(rawCalls) && rawCalls.length > 0) {
    const call = rawCalls[0];
    const name: string = call?.function?.name ?? '';
    const parsedArgs = parseArguments(call?.function?.arguments);
    const toolDef = scenario.tools.find((t) => t.function.name === name);
    const validation = validateArguments(toolDef, parsedArgs.value);

    base.toolName = name || null;
    base.arguments = parsedArgs.value;
    base.argsValid = validation.valid;
    base.argsProblems = validation.problems;
    base.text = content;

    if (!name || !toolDef) {
      base.status = 'WRONG_TOOL';
      base.error = `tool "${name}" is not in the announced tool set`;
      return base;
    }
    if (!scenario.expectedTools.includes(name)) {
      base.status = 'WRONG_TOOL';
      base.error = `expected one of [${scenario.expectedTools.join(', ')}], got "${name}"`;
      return base;
    }
    if (!parsedArgs.ok) {
      base.status = 'BAD_ARGS';
      base.error = parsedArgs.problem;
      return base;
    }
    if (!validation.valid) {
      base.status = 'BAD_ARGS';
      base.error = validation.problems.join('; ');
      return base;
    }
    base.status = 'TOOL_CALL';
    return base;
  }

  base.status = 'TEXT';
  base.text = content;
  return base;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1))}…`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function printTable(results: ScenarioResult[]): void {
  const rows: string[][] = results.map((r) => {
    let args = '-';
    if (r.arguments && typeof r.arguments === 'object' && !Array.isArray(r.arguments)) {
      const keys = Object.keys(r.arguments as Record<string, unknown>);
      args = keys.length === 0 ? '{}' : truncate(JSON.stringify(r.arguments), 60);
    } else if (typeof r.arguments === 'string') {
      args = truncate(r.arguments, 60);
    }
    let detail: string;
    if (r.status === 'TEXT') {
      detail = truncate(r.text || '(empty)', 100);
    } else if (r.error) {
      detail = truncate(r.error, 100);
    } else {
      detail = '';
    }
    return [r.id, r.status, r.toolName ?? '-', args || '-', detail];
  });

  const headers = ['SCENARIO', 'STATUS', 'TOOL', 'ARGUMENTS', 'DETAIL'];
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]): string =>
    cells.map((c, i) => (i === cells.length - 1 ? c : pad(c, widths[i]))).join('  ');

  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
}

function printSummary(results: ScenarioResult[], opts: Options): void {
  const total = results.length;
  const toolCalls = results.filter((r) => r.status === 'TOOL_CALL').length;
  const emitted = results.filter(
    (r) => r.status === 'TOOL_CALL' || r.status === 'WRONG_TOOL' || r.status === 'BAD_ARGS',
  ).length;
  const rate = total > 0 ? toolCalls / total : 0;
  const rawRate = total > 0 ? emitted / total : 0;
  const byStatus = new Map<string, number>();
  for (const r of results) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);

  console.log('');
  console.log('Summary');
  console.log('-------');
  console.log(`TOOL_CALL       ${toolCalls}/${total} (${(rate * 100).toFixed(1)}%)`);
  console.log(`raw tool calls  ${emitted}/${total} (${(rawRate * 100).toFixed(1)}%)  [includes WRONG_TOOL / BAD_ARGS]`);
  console.log(
    `by status       ${[...byStatus.entries()].sort().map(([k, v]) => `${k}=${v}`).join('  ') || '(none)'}`,
  );
  console.log(`min-rate        ${opts.minRate.toFixed(2)}`);
  console.log(`result          ${rate >= opts.minRate ? 'PASS' : 'FAIL'}`);
  const errors = results.filter((r) => r.status === 'ERROR');
  if (errors.length > 0) {
    console.log(
      `note            ${errors.length} scenario(s) failed with transport errors ` +
        `(${errors.map((e) => e.id).join(', ')}). Transport errors mean the request never ` +
        'reached the web model (gateway/browser restart, 503, timeout) — check the gateway ' +
        'log before reading them as tool-bridge failures.',
    );
  }
  if (rate < opts.minRate) {
    console.log(
      `The web model emitted a valid, expected tool call in only ${toolCalls}/${total} scenarios ` +
        `(below the required ${(opts.minRate * 100).toFixed(0)}%).`,
    );
  }
}

function redact(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.split(apiKey).join('***');
}

/** Last line of defence: the API key must never reach stdout/stderr. */
function redactResult(result: ScenarioResult, apiKey: string): ScenarioResult {
  return {
    ...result,
    text: redact(result.text, apiKey),
    error: result.error ? redact(result.error, apiKey) : null,
    argsProblems: result.argsProblems.map((p) => redact(p, apiKey)),
    arguments:
      typeof result.arguments === 'string'
        ? redact(result.arguments, apiKey)
        : result.arguments,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  let opts: Options;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    console.error('');
    console.error(usage());
    return 2;
  }

  try {
    assertLoopback(opts.baseUrl);
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    return 2;
  }

  let selected = SCENARIOS;
  if (opts.scenarios) {
    const known = new Set(SCENARIOS.map((s) => s.id));
    const unknown = opts.scenarios.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      console.error(`error: unknown scenario id(s): ${unknown.join(', ')}`);
      console.error(`available: ${[...known].join(', ')}`);
      return 2;
    }
    selected = SCENARIOS.filter((s) => opts.scenarios!.includes(s.id));
  }

  const log = (line: string): void => {
    if (opts.json) console.error(line);
    else console.log(line);
  };

  log(`agent-bridge-check · gateway ${opts.baseUrl} · model ${opts.model}`);
  log(`scenarios: ${selected.length}/${SCENARIOS.length} · timeout ${opts.timeoutMs}ms · min-rate ${opts.minRate}`);
  log('');

  const results: ScenarioResult[] = [];

  for (let i = 0; i < selected.length; i++) {
    const scenario = selected[i];
    log(`[${i + 1}/${selected.length}] → ${scenario.id} (${scenario.task.prompt}) …`);
    const started = Date.now();
    let result: ScenarioResult;
    try {
      const gw = await callGateway(opts, scenario);
      result = classify(scenario, gw);
    } catch (err) {
      const e = err as Error;
      const timedOut = e instanceof TimeoutError || e?.name === 'AbortError' || /abort/i.test(e?.message || '');
      result = {
        id: scenario.id,
        toolSet: scenario.toolSetId,
        task: scenario.taskId,
        status: 'ERROR',
        expectedTools: scenario.expectedTools,
        toolName: null,
        arguments: null,
        argsValid: null,
        argsProblems: [],
        text: '',
        httpStatus: null,
        durationMs: Date.now() - started,
        error: timedOut
          ? `timeout after ${opts.timeoutMs}ms`
          : `request failed: ${e?.message || String(e)}`,
      };
    }
    result.durationMs = Date.now() - started;
    results.push(redactResult(result, opts.apiKey));
    log(`    ${result.status} in ${(result.durationMs / 1000).toFixed(1)}s`);
  }

  const total = results.length;
  const toolCalls = results.filter((r) => r.status === 'TOOL_CALL').length;
  const rate = total > 0 ? toolCalls / total : 0;
  const passed = rate >= opts.minRate;

  if (opts.json) {
    const payload = {
      gateway: opts.baseUrl,
      model: opts.model,
      total,
      toolCalls,
      rate: Number(rate.toFixed(4)),
      minRate: opts.minRate,
      passed,
      results: results.map((r) => ({
        id: r.id,
        toolSet: r.toolSet,
        task: r.task,
        status: r.status,
        expectedTools: r.expectedTools,
        toolName: r.toolName,
        arguments: r.arguments,
        argsValid: r.argsValid,
        argsProblems: r.argsProblems,
        text: r.text.slice(0, 500),
        httpStatus: r.httpStatus,
        durationMs: r.durationMs,
        error: r.error,
      })),
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printTable(results);
    printSummary(results, opts);
  }

  return passed ? 0 : 1;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    console.error(`fatal: ${(err as Error)?.message || String(err)}`);
    process.exit(2);
  });
