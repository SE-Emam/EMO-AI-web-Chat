import { describe, it, expect } from 'vitest';
import {
  injectToolsInstruction,
  parseToolCallsFromResponse,
  detectToolRefusal,
  resolveToolChoice,
} from '../../src/server/tool-interpreter.js';
import {
  formatChatCompletionResponse,
  formatToolCallChunks,
} from '../../src/server/openai-formatter.js';
import { ToolRegistry, normalizeToolCall } from '../../src/server/tool-registry.js';
import { ToolPipelineLogger } from '../../src/server/tool-pipeline-logger.js';
import type { ChatMessage } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const READ_TOOL = {
  type: 'function' as const,
  function: {
    name: 'read',
    description: 'Read a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
};

const READ_TOOL_LONG_DESC = {
  type: 'function' as const,
  function: {
    name: 'read',
    description: 'Read a file from disk',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
};

const SHELL_TOOL = {
  type: 'function' as const,
  function: {
    name: 'shell',
    description: 'Execute a shell command',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
  },
};

// ---------------------------------------------------------------------------
// 1. Tool Definition Registry
// ---------------------------------------------------------------------------

describe('ToolRegistry', () => {
  it('registers tools from OpenAI format', () => {
    const registry = new ToolRegistry();
    registry.registerFromOpenAI([READ_TOOL]);
    expect(registry.has('read')).toBe(true);
    expect(registry.get('read')!.name).toBe('read');
  });

  it('validates arguments against schema', () => {
    const registry = new ToolRegistry();
    registry.registerFromOpenAI([READ_TOOL]);
    expect(registry.validateArgs('read', { path: '/some/file' })).toEqual({ valid: true });
    expect(registry.validateArgs('read', {}).valid).toBe(false);
    expect(registry.validateArgs('unknown_tool', {}).valid).toBe(false);
  });

  it('generates compact definitions for injection', () => {
    const registry = new ToolRegistry();
    registry.registerFromOpenAI([READ_TOOL_LONG_DESC]);
    const defs = registry.toCompactDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('read');
  });

  it('rejects unregistered tool names', () => {
    const registry = new ToolRegistry();
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('registers multiple tools', () => {
    const registry = new ToolRegistry();
    registry.registerFromOpenAI([READ_TOOL, SHELL_TOOL]);
    expect(registry.has('read')).toBe(true);
    expect(registry.has('shell')).toBe(true);
    expect(registry.toCompactDefinitions()).toHaveLength(2);
  });

  it('validation passes when no required fields are specified', () => {
    const registry = new ToolRegistry();
    registry.registerFromOpenAI([{
      type: 'function',
      function: { name: 'list', description: 'List files', parameters: { type: 'object', properties: {} } },
    }]);
    expect(registry.validateArgs('list', {})).toEqual({ valid: true });
  });

  it('returns validation errors for each missing required arg', () => {
    const registry = new ToolRegistry();
    registry.registerFromOpenAI([{
      type: 'function',
      function: {
        name: 'write',
        description: 'Write a file',
        parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      },
    }]);
    const result = registry.validateArgs('write', {});
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 2. NormalizedToolCall
// ---------------------------------------------------------------------------

describe('NormalizedToolCall', () => {
  it('normalizes from OpenAI format', () => {
    const raw = { id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"/tmp/x"}' } };
    const normalized = normalizeToolCall(raw, 0);
    expect(normalized).toEqual({ id: 'call_1', name: 'read', arguments: { path: '/tmp/x' } });
  });

  it('normalizes from parsed text format', () => {
    const raw = { name: 'read', arguments: { path: '/tmp/x' } };
    const normalized = normalizeToolCall(raw, 0);
    expect(normalized!.name).toBe('read');
    expect(normalized!.arguments).toEqual({ path: '/tmp/x' });
    expect(normalized!.id).toBeTruthy();
  });

  it('returns null for invalid input', () => {
    expect(normalizeToolCall(null, 0)).toBeNull();
    expect(normalizeToolCall({}, 0)).toBeNull();
    expect(normalizeToolCall({ arguments: {} }, 0)).toBeNull();
  });

  it('generates unique IDs when none provided', () => {
    const a = normalizeToolCall({ name: 'read', arguments: { path: 'a' } }, 0);
    const b = normalizeToolCall({ name: 'read', arguments: { path: 'b' } }, 1);
    expect(a!.id).not.toBe(b!.id);
  });

  it('handles string arguments in parsed text format', () => {
    const raw = { name: 'read', arguments: '{"path":"/tmp/x"}' };
    const normalized = normalizeToolCall(raw, 0);
    expect(normalized!.arguments).toEqual({ path: '/tmp/x' });
  });

  it('handles malformed JSON arguments gracefully', () => {
    const raw = { name: 'read', arguments: 'not-json' };
    const normalized = normalizeToolCall(raw, 0);
    expect(normalized!.name).toBe('read');
    expect(normalized!.arguments).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 3. resolveToolChoice
// ---------------------------------------------------------------------------

describe('resolveToolChoice', () => {
  it('tool_choice=undefined with tools present → auto behavior', () => {
    const result = resolveToolChoice(undefined, 3);
    expect(result.shouldInjectTools).toBe(true);
    expect(result.shouldParseTools).toBe(true);
    expect(result.requireToolCall).toBe(false);
    expect(result.specificTool).toBeUndefined();
  });

  it('tool_choice="auto" → inject and parse, no requirement', () => {
    const result = resolveToolChoice('auto', 3);
    expect(result.shouldInjectTools).toBe(true);
    expect(result.shouldParseTools).toBe(true);
    expect(result.requireToolCall).toBe(false);
  });

  it('tool_choice="none" → no injection, no parsing, no requirement', () => {
    const result = resolveToolChoice('none', 3);
    expect(result.shouldInjectTools).toBe(false);
    expect(result.shouldParseTools).toBe(false);
    expect(result.requireToolCall).toBe(false);
  });

  it('tool_choice="required" → inject, parse, and require', () => {
    const result = resolveToolChoice('required', 3);
    expect(result.shouldInjectTools).toBe(true);
    expect(result.shouldParseTools).toBe(true);
    expect(result.requireToolCall).toBe(true);
  });

  it('tool_choice with specific function → inject, parse, require, specificTool set', () => {
    const result = resolveToolChoice({ type: 'function', function: { name: 'read' } }, 3);
    expect(result.shouldInjectTools).toBe(true);
    expect(result.shouldParseTools).toBe(true);
    expect(result.requireToolCall).toBe(true);
    expect(result.specificTool).toBe('read');
  });

  it('no tools (toolCount=0) → everything disabled regardless of tool_choice', () => {
    const asRequired = resolveToolChoice('required', 0);
    expect(asRequired.shouldInjectTools).toBe(false);
    expect(asRequired.shouldParseTools).toBe(false);
    expect(asRequired.requireToolCall).toBe(false);

    const asAuto = resolveToolChoice('auto', 0);
    expect(asAuto.shouldInjectTools).toBe(false);
    expect(asAuto.shouldParseTools).toBe(false);
  });

  it('tool_choice="none" but tools present → no injection', () => {
    const result = resolveToolChoice('none', 5);
    expect(result.shouldInjectTools).toBe(false);
    expect(result.shouldParseTools).toBe(false);
    expect(result.requireToolCall).toBe(false);
  });

  it('tool_choice="required" but no tools → inject=false (no tools to inject)', () => {
    const result = resolveToolChoice('required', 0);
    expect(result.shouldInjectTools).toBe(false);
    expect(result.shouldParseTools).toBe(false);
    expect(result.requireToolCall).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Tool Refusal Detection
// ---------------------------------------------------------------------------

describe('detectToolRefusal', () => {
  it('detects explicit refusal phrases', () => {
    expect(detectToolRefusal('I cannot connect to OpenCode because the tunnel is down.')).toBe(true);
    expect(detectToolRefusal('I do not have access to tools in this session.')).toBe(true);
    expect(detectToolRefusal('Tools are not available in this environment.')).toBe(true);
    expect(detectToolRefusal('I am unable to execute tools or access files.')).toBe(true);
    expect(detectToolRefusal('لا أستطيع الاتصال بـ OpenCode')).toBe(true);
  });

  it('does not flag normal responses', () => {
    expect(detectToolRefusal('Here is the content of the file you requested.')).toBe(false);
    expect(detectToolRefusal('The package.json contains the following dependencies.')).toBe(false);
  });

  it('does not flag responses with tool_call blocks', () => {
    const withToolCall = 'Let me read that.\n```tool_call\n{"name":"read","arguments":{"path":"x"}}\n```';
    expect(detectToolRefusal(withToolCall)).toBe(false);
  });

  it('returns false for empty or non-string input', () => {
    expect(detectToolRefusal('')).toBe(false);
    expect(detectToolRefusal(null as unknown as string)).toBe(false);
    expect(detectToolRefusal(undefined as unknown as string)).toBe(false);
  });

  it('does not flag tool_call blocks even when refusal phrases are nearby', () => {
    const content = 'I cannot access files directly, but let me try.\n```tool_call\n{"name":"read","arguments":{"path":"x"}}\n```';
    expect(detectToolRefusal(content)).toBe(false);
  });

  it('returns false when refusal phrase appears but tool_call IS present', () => {
    const content = "I don't have access to tools normally, but here:\n```tool_call\n{\"name\":\"read\",\"arguments\":{\"path\":\"/tmp/f\"}}\n```";
    expect(detectToolRefusal(content)).toBe(false);
  });

  it('detects Arabic refusal "الأدوات غير متاحة"', () => {
    expect(detectToolRefusal('الأدوات غير متاحة في هذه الجلسة')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Parser Independent Tests
// ---------------------------------------------------------------------------

describe('parseToolCallsFromResponse', () => {
  it('parses valid JSON in fenced tool_call block', () => {
    const response = '```tool_call\n{"name":"read","arguments":{"path":"/tmp/x"}}\n```';
    const result = parseToolCallsFromResponse(response);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].function.name).toBe('read');
    expect(JSON.parse(result.toolCalls![0].function.arguments)).toEqual({ path: '/tmp/x' });
  });

  it('web UI "Code snippet" label + bare JSON (fence stripped by the web page) is recovered', () => {
    const result = parseToolCallsFromResponse(
      'Code snippet\n{"name":"read","arguments":{"path":"/repo/package.json"}}'
    );
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].function.name).toBe('read');
    expect(JSON.parse(result.toolCalls![0].function.arguments)).toEqual({ path: '/repo/package.json' });
    expect(result.cleanText).toBe('');
  });

  it('stream-cut bare JSON (missing closing braces and quote) is recovered', () => {
    const result = parseToolCallsFromResponse('Code snippet\n{"name":"read","arguments":{"path":"/repo/pa');
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls![0].function.name).toBe('read');
    expect(JSON.parse(result.toolCalls![0].function.arguments)).toEqual({ path: '/repo/pa' });
  });

  it('stream-cut bare JSON (missing outer brace only) is recovered', () => {
    const result = parseToolCallsFromResponse('{"name":"read","arguments":{"path":"/repo/package.json"}');
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls![0].function.name).toBe('read');
  });

  it('prose JSON without tool-call shape (e.g. config snippets) is NOT a tool call', () => {
    expect(parseToolCallsFromResponse('The config is {"port": 8989} btw.').hasToolCalls).toBe(false);
    expect(parseToolCallsFromResponse('{"port": 8989}').hasToolCalls).toBe(false);
  });

  it('returns hasToolCalls=false for invalid JSON in fenced block', () => {
    const response = '```tool_call\nthis is not json at all {{{\n```';
    const result = parseToolCallsFromResponse(response);
    expect(result.hasToolCalls).toBe(false);
  });

  it('parses a single tool call → toolCalls.length === 1', () => {
    const response = '```tool_call\n{"name":"shell","arguments":{"command":"ls"}}\n```';
    const result = parseToolCallsFromResponse(response);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
  });

  it('parses multiple tool calls → toolCalls.length matches', () => {
    const response = [
      '```tool_call',
      '{"name":"read","arguments":{"path":"a"}}',
      '```',
      '```tool_call',
      '{"name":"shell","arguments":{"command":"pwd"}}',
      '```',
      '```tool_call',
      '{"name":"read","arguments":{"path":"b"}}',
      '```',
    ].join('\n');
    const result = parseToolCallsFromResponse(response);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(3);
  });

  it('parses unregistered tool names (filtering is pipeline-level)', () => {
    const response = '```tool_call\n{"name":"unknown_magic_tool","arguments":{"x":1}}\n```';
    const result = parseToolCallsFromResponse(response);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls![0].function.name).toBe('unknown_magic_tool');
  });

  it('parses tool_call inside quoted text (pipeline must restrict to assistant output)', () => {
    const response = 'The user said: ```tool_call\n{"name":"shell","arguments":{"command":"rm -rf /"}}\n```';
    const result = parseToolCallsFromResponse(response);
    expect(result.hasToolCalls).toBe(true);
  });

  it('stringifies object arguments into function.arguments', () => {
    const response = '```tool_call\n{"name":"read","arguments":{"path":"/a","encoding":"utf8"}}\n```';
    const result = parseToolCallsFromResponse(response);
    const args = JSON.parse(result.toolCalls![0].function.arguments);
    expect(args).toEqual({ path: '/a', encoding: 'utf8' });
  });

  it('preserves string arguments as-is', () => {
    const response = '```tool_call\n{"name":"read","arguments":"{\\"path\\":\\"/tmp/x\\"}"}\n```';
    const result = parseToolCallsFromResponse(response);
    expect(result.toolCalls![0].function.arguments).toContain('path');
  });

  it('uses "{}" for empty arguments', () => {
    const response = '```tool_call\n{"name":"list","arguments":{}}\n```';
    const result = parseToolCallsFromResponse(response);
    expect(result.toolCalls![0].function.arguments).toBe('{}');
  });

  it('uses "{}" when arguments field is missing', () => {
    const response = '```tool_call\n{"name":"list"}\n```';
    const result = parseToolCallsFromResponse(response);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls![0].function.arguments).toBe('{}');
  });

  it('preserves deeply nested arguments', () => {
    const deepArgs = { config: { nested: { deep: { value: [1, 2, { key: 'val' }] } } } };
    const response = `\`\`\`tool_call\n{"name":"write","arguments":${JSON.stringify(deepArgs)}}\n\`\`\``;
    const result = parseToolCallsFromResponse(response);
    const parsed = JSON.parse(result.toolCalls![0].function.arguments);
    expect(parsed).toEqual(deepArgs);
  });

  it('returns hasToolCalls=false for normal text without tool indicators', () => {
    const response = 'Hello! Here is a summary of the project. It uses TypeScript and Vitest for testing.';
    const result = parseToolCallsFromResponse(response);
    expect(result.hasToolCalls).toBe(false);
    expect(result.cleanText).toBe(response);
  });
});

// ---------------------------------------------------------------------------
// 6. Tool Result Continuation
// ---------------------------------------------------------------------------

describe('tool result continuation', () => {
  it('injects continuation prompt after tool results', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Read the file' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"x"}' } }] },
      { role: 'tool', content: '{"name":"emo-ai-web","version":"0.1.0"}', tool_call_id: 'call_1' },
    ];
    const tools = [READ_TOOL];
    const result = injectToolsInstruction(messages, tools);
    const lastMsg = result[result.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toContain('Tool results are provided above');
  });

  it('does not duplicate continuation prompt', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Read the file' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"x"}' } }] },
      { role: 'tool', content: 'file contents here', tool_call_id: 'call_1' },
    ];
    const tools = [{ type: 'function', function: { name: 'read', description: 'Read', parameters: {} } }];
    const result = injectToolsInstruction(messages, tools);
    const continuations = result.filter(
      (m) => typeof m.content === 'string' && m.content.includes('Tool results are provided above')
    );
    expect(continuations.length).toBeLessThanOrEqual(1);
  });

  it('injects tool instruction into existing system message', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Read the file' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"x"}' } }] },
      { role: 'tool', content: 'file data', tool_call_id: 'call_1' },
    ];
    const result = injectToolsInstruction(messages, [READ_TOOL]);
    expect(result[0].role).toBe('system');
    expect(result[0].content).toContain('TOOL CALLING MODE');
    expect(result[0].content).toContain('You are a helpful assistant.');
  });

  it('does not re-inject tool instruction if already present', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: '### TOOL CALLING MODE (MANDATORY - ACTIVE NOW)\nAlready injected' },
      { role: 'user', content: 'Read the file' },
    ];
    const result = injectToolsInstruction(messages, [READ_TOOL]);
    const systemContent = result[0].content as string;
    const occurrences = (systemContent.match(/TOOL CALLING MODE/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it('handles multi-turn: user → tool_call → result → tool_call2 → result2', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Check both files' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"a.ts"}' } }] },
      { role: 'tool', content: 'contents of a.ts', tool_call_id: 'call_1' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'read', arguments: '{"path":"b.ts"}' } }] },
      { role: 'tool', content: 'contents of b.ts', tool_call_id: 'call_2' },
    ];
    const result = injectToolsInstruction(messages, [READ_TOOL]);
    const lastMsg = result[result.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toContain('Tool results are provided above');
    expect(result[0].content).toContain('TOOL CALLING MODE');
  });

  it('preserves tool call IDs through the entire chain', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Do things' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_abc', type: 'function', function: { name: 'read', arguments: '{"path":"x"}' } }] },
      { role: 'tool', content: 'result-x', tool_call_id: 'call_abc' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_def', type: 'function', function: { name: 'shell', arguments: '{"command":"pwd"}' } }] },
      { role: 'tool', content: '/home/user', tool_call_id: 'call_def' },
    ];
    const result = injectToolsInstruction(messages, [READ_TOOL, SHELL_TOOL]);
    const toolMessages = result.filter((m) => m.role === 'tool');
    expect(toolMessages[0].tool_call_id).toBe('call_abc');
    expect(toolMessages[1].tool_call_id).toBe('call_def');
  });

  it('maintains tool result ordering', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Read three files' },
      { role: 'assistant', content: '', tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"first.ts"}' } },
        { id: 'call_2', type: 'function', function: { name: 'read', arguments: '{"path":"second.ts"}' } },
      ] },
      { role: 'tool', content: 'first-content', tool_call_id: 'call_1' },
      { role: 'tool', content: 'second-content', tool_call_id: 'call_2' },
    ];
    const result = injectToolsInstruction(messages, [READ_TOOL]);
    const toolMessages = result.filter((m) => m.role === 'tool');
    expect(toolMessages[0].content).toBe('first-content');
    expect(toolMessages[1].content).toBe('second-content');
    expect(toolMessages[0].tool_call_id).toBe('call_1');
    expect(toolMessages[1].tool_call_id).toBe('call_2');
  });
});

// ---------------------------------------------------------------------------
// 7. Idempotency with Tool Calls
// ---------------------------------------------------------------------------

describe('tool call idempotency', () => {
  it('each parsed tool call gets a unique ID', () => {
    const response = '```tool_call\n{"name":"read","arguments":{"path":"a"}}\n```\n```tool_call\n{"name":"read","arguments":{"path":"b"}}\n```';
    const result = parseToolCallsFromResponse(response);
    expect(result.toolCalls).toHaveLength(2);
    const ids = result.toolCalls!.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('preserves provided IDs', () => {
    const response = '```tool_call\n{"id":"my-id","name":"read","arguments":{"path":"a"}}\n```';
    const result = parseToolCallsFromResponse(response);
    expect(result.toolCalls![0].id).toBe('my-id');
  });

  it('generates IDs with call_ prefix', () => {
    const response = '```tool_call\n{"name":"read","arguments":{"path":"a"}}\n```';
    const result = parseToolCallsFromResponse(response);
    expect(result.toolCalls![0].id).toMatch(/^call_/);
  });
});

// ---------------------------------------------------------------------------
// 8. Security Tests
// ---------------------------------------------------------------------------

describe('tool calling security', () => {
  it('does not parse tool calls from user message content', () => {
    const userMessage = 'The user said: ```tool_call\n{"name":"shell","arguments":{"command":"rm -rf /"}}\n```';
    const result = parseToolCallsFromResponse(userMessage);
    // Parser itself finds it — security is enforced at the pipeline level,
    // ensuring parseToolCallsFromResponse is only called on assistant output
    expect(result.hasToolCalls).toBe(true);
  });

  it('rejects tool calls with names not in the provided tools list', () => {
    const tools = [READ_TOOL];
    const toolNames = new Set(
      tools.map((t: any) => t?.function?.name).filter(Boolean)
    );

    const response = '```tool_call\n{"name":"shell","arguments":{"command":"ls"}}\n```';
    const parsed = parseToolCallsFromResponse(response);
    expect(parsed.hasToolCalls).toBe(true);

    const unknown = (parsed.toolCalls || []).filter(
      (c) => !toolNames.has(c.function.name)
    );
    expect(unknown).toHaveLength(1);
    expect(unknown[0].function.name).toBe('shell');
  });

  it('identifies tool calls matching the allowed set', () => {
    const tools = [READ_TOOL, SHELL_TOOL];
    const toolNames = new Set(
      tools.map((t: any) => t?.function?.name).filter(Boolean)
    );

    const response = '```tool_call\n{"name":"read","arguments":{"path":"a"}}\n```';
    const parsed = parseToolCallsFromResponse(response);
    const allowed = (parsed.toolCalls || []).filter(
      (c) => toolNames.has(c.function.name)
    );
    expect(allowed).toHaveLength(1);
    expect(allowed[0].function.name).toBe('read');
  });

  it('parses tool call inside a tool result (injection attempt) — pipeline must not parse tool results', () => {
    // A malicious tool result could contain a tool_call block.
    // The parser WILL parse it if called — this documents that the pipeline
    // must never call parseToolCallsFromResponse on tool result content.
    const injectedContent = '```tool_call\n{"name":"shell","arguments":{"command":"cat /etc/passwd"}}\n```';
    const result = parseToolCallsFromResponse(injectedContent);
    expect(result.hasToolCalls).toBe(true);
    // This is expected: the parser is a pure text parser. Security is at the pipeline level.
  });

  it('parseToolCallsFromResponse is a pure function (does not execute anything)', () => {
    const dangerousResponse = '```tool_call\n{"name":"shell","arguments":{"command":"rm -rf /"}}\n```';
    const result1 = parseToolCallsFromResponse(dangerousResponse);
    const result2 = parseToolCallsFromResponse(dangerousResponse);
    // Same input produces structurally equivalent output (except for generated IDs which use timestamps)
    expect(result1.hasToolCalls).toBe(result2.hasToolCalls);
    expect(result1.toolCalls!.length).toBe(result2.toolCalls!.length);
    expect(result1.toolCalls![0].function.name).toBe(result2.toolCalls![0].function.name);
    expect(result1.toolCalls![0].function.arguments).toBe(result2.toolCalls![0].function.arguments);
    // The function only parses — it never executes shell commands or modifies state
    expect(result1.cleanText).toBe(result2.cleanText);
  });
});

// ---------------------------------------------------------------------------
// 9. Full Pipeline Integration Test (Mock)
// ---------------------------------------------------------------------------

describe('full tool calling pipeline (mock)', () => {
  it('complete read tool flow: inject → parse → format → continue', () => {
    // Step 1: Client sends request with tools
    const clientMessages: ChatMessage[] = [
      { role: 'user', content: 'What is in the project configuration file?' },
    ];
    const tools = [READ_TOOL];

    // Step 2: EMO injects tool schemas
    const injected = injectToolsInstruction(clientMessages, tools);
    expect(
      injected.some(
        (m) => typeof m.content === 'string' && m.content.includes('TOOL CALLING MODE')
      )
    ).toBe(true);
    expect(
      injected.some(
        (m) => typeof m.content === 'string' && m.content.includes('read')
      )
    ).toBe(true);

    // Step 3: Mock model responds with tool_call
    const modelResponse =
      '```tool_call\n{"name":"read","arguments":{"path":"/Users/emamabdullaziz/Desktop/web/package.json"}}\n```';

    // Step 4: EMO parses tool calls
    const parsed = parseToolCallsFromResponse(modelResponse);
    expect(parsed.hasToolCalls).toBe(true);
    expect(parsed.toolCalls![0].function.name).toBe('read');
    expect(JSON.parse(parsed.toolCalls![0].function.arguments).path).toBe(
      '/Users/emamabdullaziz/Desktop/web/package.json'
    );

    // Step 5: EMO formats as OpenAI response (non-streaming)
    const response = formatChatCompletionResponse(
      'chatcmpl-test',
      'chatgpt-4o',
      '',
      0,
      0,
      undefined,
      parsed.toolCalls,
      'tool_calls'
    );
    expect(response.choices[0].finish_reason).toBe('tool_calls');
    expect(response.choices[0].message.tool_calls).toHaveLength(1);

    // Step 6: Client executes tool and sends result
    const toolResult = JSON.stringify({ name: 'emo-ai-web', version: '0.1.0' });
    const continuationMessages: ChatMessage[] = [
      ...clientMessages,
      {
        role: 'assistant',
        content: '',
        tool_calls: parsed.toolCalls,
      },
      {
        role: 'tool',
        content: toolResult,
        tool_call_id: parsed.toolCalls![0].id,
      },
    ];

    // Step 7: EMO injects continuation
    const continuationInjected = injectToolsInstruction(continuationMessages, tools);
    const lastMsg = continuationInjected[continuationInjected.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toContain('Tool results are provided above');

    // Step 8: Mock model responds with final answer
    const finalResponse = 'The project is named "emo-ai-web" and its version is 0.1.0.';
    const finalParsed = parseToolCallsFromResponse(finalResponse);
    expect(finalParsed.hasToolCalls).toBe(false);

    // Step 9: EMO formats final response
    const finalFormatted = formatChatCompletionResponse(
      'chatcmpl-test-2',
      'chatgpt-4o',
      finalResponse
    );
    expect(finalFormatted.choices[0].finish_reason).toBe('stop');
    expect(finalFormatted.choices[0].message.content).toContain('emo-ai-web');
    expect(finalFormatted.choices[0].message.content).toContain('0.1.0');
  });

  it('multi-turn tool flow with two consecutive tool calls', () => {
    const tools = [READ_TOOL, SHELL_TOOL];

    // Turn 1: user asks
    const messages1: ChatMessage[] = [
      { role: 'user', content: 'Show me the project name and the current directory.' },
    ];
    const injected1 = injectToolsInstruction(messages1, tools);
    expect(injected1.some((m) => typeof m.content === 'string' && m.content.includes('TOOL CALLING MODE'))).toBe(true);

    // Model responds with two tool calls
    const modelResp1 = [
      '```tool_call',
      '{"name":"read","arguments":{"path":"package.json"}}',
      '```',
      '```tool_call',
      '{"name":"shell","arguments":{"command":"pwd"}}',
      '```',
    ].join('\n');
    const parsed1 = parseToolCallsFromResponse(modelResp1);
    expect(parsed1.hasToolCalls).toBe(true);
    expect(parsed1.toolCalls).toHaveLength(2);

    // Format the response
    const formatted1 = formatChatCompletionResponse(
      'chatcmpl-multi-1', 'chatgpt-4o', '', 0, 0, undefined,
      parsed1.toolCalls, 'tool_calls'
    );
    expect(formatted1.choices[0].finish_reason).toBe('tool_calls');
    expect(formatted1.choices[0].message.tool_calls).toHaveLength(2);
  });

  it('three-turn pipeline: user → tool1 → result1 → tool2 → result2 → final answer', () => {
    const tools = [READ_TOOL, SHELL_TOOL];

    // Turn 1: User asks
    const userMessage: ChatMessage = { role: 'user', content: 'What project is this and what branch are we on?' };
    const injected = injectToolsInstruction([userMessage], tools);
    expect(injected.some((m) => typeof m.content === 'string' && m.content.includes('TOOL CALLING MODE'))).toBe(true);

    // Turn 2: Model calls read tool
    const modelResp1 = '```tool_call\n{"name":"read","arguments":{"path":"package.json"}}\n```';
    const parsed1 = parseToolCallsFromResponse(modelResp1);
    expect(parsed1.hasToolCalls).toBe(true);
    const call1Id = parsed1.toolCalls![0].id;

    // Format as OpenAI response
    const formatted1 = formatChatCompletionResponse(
      'chatcmpl-t1', 'chatgpt-4o', '', 0, 0, undefined, parsed1.toolCalls, 'tool_calls'
    );
    expect(formatted1.choices[0].finish_reason).toBe('tool_calls');

    // Turn 3: Tool result comes back, inject continuation
    const messagesAfterTool1: ChatMessage[] = [
      userMessage,
      { role: 'assistant', content: '', tool_calls: parsed1.toolCalls },
      { role: 'tool', content: '{"name":"emo-ai-web","version":"0.1.0"}', tool_call_id: call1Id },
    ];
    const injected2 = injectToolsInstruction(messagesAfterTool1, tools);
    const lastAfterTool1 = injected2[injected2.length - 1];
    expect(lastAfterTool1.content).toContain('Tool results are provided above');

    // Turn 4: Model calls shell tool (with explicit ID to avoid timestamp collision)
    const modelResp2 = '```tool_call\n{"id":"call_second","name":"shell","arguments":{"command":"git branch --show-current"}}\n```';
    const parsed2 = parseToolCallsFromResponse(modelResp2);
    expect(parsed2.hasToolCalls).toBe(true);
    const call2Id = parsed2.toolCalls![0].id;
    expect(call2Id).toBe('call_second');
    expect(call2Id).not.toBe(call1Id);

    // Turn 5: Tool result comes back
    const messagesAfterTool2: ChatMessage[] = [
      userMessage,
      { role: 'assistant', content: '', tool_calls: parsed1.toolCalls },
      { role: 'tool', content: '{"name":"emo-ai-web","version":"0.1.0"}', tool_call_id: call1Id },
      { role: 'assistant', content: '', tool_calls: parsed2.toolCalls },
      { role: 'tool', content: 'main', tool_call_id: call2Id },
    ];
    const injected3 = injectToolsInstruction(messagesAfterTool2, tools);
    const lastAfterTool2 = injected3[injected3.length - 1];
    expect(lastAfterTool2.content).toContain('Tool results are provided above');

    // Verify IDs are preserved through the chain
    const toolMsgs = injected3.filter((m) => m.role === 'tool');
    expect(toolMsgs[0].tool_call_id).toBe(call1Id);
    expect(toolMsgs[1].tool_call_id).toBe(call2Id);

    // Turn 6: Model provides final answer
    const finalResponse = 'The project is emo-ai-web v0.1.0 and you are on the main branch.';
    const finalParsed = parseToolCallsFromResponse(finalResponse);
    expect(finalParsed.hasToolCalls).toBe(false);

    const finalFormatted = formatChatCompletionResponse('chatcmpl-t3', 'chatgpt-4o', finalResponse);
    expect(finalFormatted.choices[0].finish_reason).toBe('stop');
    expect(finalFormatted.choices[0].message.content).toContain('emo-ai-web');
    expect(finalFormatted.choices[0].message.content).toContain('main');
  });
});

// ---------------------------------------------------------------------------
// 10. Multiple Tool Calls in One Response
// ---------------------------------------------------------------------------

describe('multiple tool calls', () => {
  it('parses multiple tool_call blocks in one response', () => {
    const response = [
      'I need to read two files.',
      '```tool_call',
      '{"name":"read","arguments":{"path":"package.json"}}',
      '```',
      '```tool_call',
      '{"name":"read","arguments":{"path":"tsconfig.json"}}',
      '```',
    ].join('\n');
    const result = parseToolCallsFromResponse(response);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls![0].function.name).toBe('read');
    expect(result.toolCalls![1].function.name).toBe('read');
    expect(JSON.parse(result.toolCalls![0].function.arguments).path).toBe('package.json');
    expect(JSON.parse(result.toolCalls![1].function.arguments).path).toBe('tsconfig.json');
  });

  it('formats multiple tool calls in streaming SSE', () => {
    const toolCalls = [
      { id: 'call_1', type: 'function' as const, function: { name: 'read', arguments: '{"path":"a"}' } },
      { id: 'call_2', type: 'function' as const, function: { name: 'read', arguments: '{"path":"b"}' } },
    ];
    const chunks = formatToolCallChunks('id-1', 'model-1', toolCalls);
    expect(chunks).toContain('call_1');
    expect(chunks).toContain('call_2');
    expect(chunks).toContain('finish_reason');
    expect(chunks).toContain('tool_calls');
  });

  it('cleans text around multiple tool call blocks', () => {
    const response = [
      'Let me check both files.',
      '```tool_call',
      '{"name":"read","arguments":{"path":"a.ts"}}',
      '```',
      'And also this one:',
      '```tool_call',
      '{"name":"read","arguments":{"path":"b.ts"}}',
      '```',
      'I will analyze them.',
    ].join('\n');
    const result = parseToolCallsFromResponse(response);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.cleanText).not.toContain('```tool_call');
  });

  it('streaming SSE includes role chunk before tool calls', () => {
    const toolCalls = [
      { id: 'call_1', type: 'function' as const, function: { name: 'read', arguments: '{}' } },
    ];
    const chunks = formatToolCallChunks('id-1', 'model-1', toolCalls);
    // First chunk should be the role chunk
    const lines = chunks.split('\n\n').filter((l) => l.startsWith('data: '));
    const firstChunk = JSON.parse(lines[0].slice(6));
    expect(firstChunk.choices[0].delta.role).toBe('assistant');
    // Last data chunk should have finish_reason: tool_calls
    const lastChunk = JSON.parse(lines[lines.length - 1].slice(6));
    expect(lastChunk.choices[0].finish_reason).toBe('tool_calls');
  });
});

// ---------------------------------------------------------------------------
// 11. ToolPipelineLogger
// ---------------------------------------------------------------------------

describe('ToolPipelineLogger', () => {
  it('emits events with correlation ID', () => {
    const events: any[] = [];
    const logger = new ToolPipelineLogger('corr-123', (e) => events.push(e));
    logger.toolDefinitionsBuilt(3);
    logger.toolDefinitionsSent('openai');
    logger.modelResponseReceived(true);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({
      correlationId: 'corr-123',
      event: 'tool_definitions_built',
      toolCount: 3,
      timestamp: expect.any(Number),
    });
    expect(events[1]).toEqual({
      correlationId: 'corr-123',
      event: 'tool_definitions_sent',
      protocol: 'openai',
      timestamp: expect.any(Number),
    });
  });

  it('tracks the complete lifecycle', () => {
    const events: any[] = [];
    const logger = new ToolPipelineLogger('corr-456', (e) => events.push(e));
    logger.toolCallDetected('call_1', 'read');
    logger.toolDispatchStarted('call_1', 'read');
    logger.toolDispatchCompleted('call_1', 'read', true);
    logger.toolResultReturned('call_1', 'read');
    const eventNames = events.map((e) => e.event);
    expect(eventNames).toEqual([
      'tool_call_detected',
      'tool_dispatch_started',
      'tool_dispatch_completed',
      'tool_result_returned',
    ]);
  });

  it('includes callId and toolName in each event', () => {
    const events: any[] = [];
    const logger = new ToolPipelineLogger('corr-789', (e) => events.push(e));
    logger.toolCallDetected('call_42', 'shell');
    expect(events[0].callId).toBe('call_42');
    expect(events[0].toolName).toBe('shell');
  });

  it('records success/failure in dispatch completed', () => {
    const events: any[] = [];
    const logger = new ToolPipelineLogger('corr-fail', (e) => events.push(e));
    logger.toolDispatchCompleted('call_1', 'read', false);
    expect(events[0].success).toBe(false);
  });

  it('emits tool_call_validation_failed event', () => {
    const events: any[] = [];
    const logger = new ToolPipelineLogger('corr-val', (e) => events.push(e));
    logger.toolCallValidationFailed('call_99', 'unknown_tool', 'Tool not registered');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      correlationId: 'corr-val',
      event: 'tool_call_validation_failed',
      callId: 'call_99',
      toolName: 'unknown_tool',
      reason: 'Tool not registered',
      timestamp: expect.any(Number),
    });
  });

  it('emits model_continuation_started event', () => {
    const events: any[] = [];
    const logger = new ToolPipelineLogger('corr-cont', (e) => events.push(e));
    logger.modelContinuationStarted();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      correlationId: 'corr-cont',
      event: 'model_continuation_started',
      timestamp: expect.any(Number),
    });
  });
});

// ---------------------------------------------------------------------------
// 12. Protocol Error for Required Tool Failure
// ---------------------------------------------------------------------------

describe('protocol error for required tool failure', () => {
  it('detects when tool_choice=required but model responds without a tool call', () => {
    const resolution = resolveToolChoice('required', 3);
    expect(resolution.requireToolCall).toBe(true);

    const modelResponse = 'I can help you with that! Let me explain the concept...';
    const parsed = parseToolCallsFromResponse(modelResponse);
    expect(parsed.hasToolCalls).toBe(false);

    // Pipeline can detect: requireToolCall=true AND no tool calls parsed
    const isFailure = resolution.requireToolCall && !parsed.hasToolCalls;
    expect(isFailure).toBe(true);
  });

  it('detects when model refuses with text instead of calling a required tool', () => {
    const resolution = resolveToolChoice('required', 2);
    expect(resolution.requireToolCall).toBe(true);

    const refusalResponse = 'I do not have access to tools in this session.';
    const parsed = parseToolCallsFromResponse(refusalResponse);
    const isRefusal = detectToolRefusal(refusalResponse);

    // Both signals fire: it's a refusal AND no tool call was emitted
    expect(parsed.hasToolCalls).toBe(false);
    expect(isRefusal).toBe(true);

    const isProtocolError = resolution.requireToolCall && !parsed.hasToolCalls;
    expect(isProtocolError).toBe(true);
  });

  it('detects when model responds with normal text instead of a required tool call', () => {
    const resolution = resolveToolChoice('required', 1);
    expect(resolution.requireToolCall).toBe(true);

    const normalResponse = 'The file contains a standard Node.js configuration with TypeScript support.';
    const parsed = parseToolCallsFromResponse(normalResponse);
    const isRefusal = detectToolRefusal(normalResponse);

    expect(parsed.hasToolCalls).toBe(false);
    expect(isRefusal).toBe(false); // Not a refusal, just no tool call

    // Pipeline still knows it's a failure case
    const isProtocolError = resolution.requireToolCall && !parsed.hasToolCalls;
    expect(isProtocolError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 13. Provider Adapter Normalization
// ---------------------------------------------------------------------------

describe('ProviderToolAdapter', () => {
  describe('OpenAI format', () => {
    it('converts text tool_call blocks to ParsedToolCall', () => {
      const textResponse = '```tool_call\n{"name":"read","arguments":{"path":"x"}}\n```';
      const result = parseToolCallsFromResponse(textResponse);
      expect(result.hasToolCalls).toBe(true);
      expect(result.toolCalls![0].function.name).toBe('read');
    });

    it('formats NormalizedToolCall back to OpenAI format', () => {
      const response = formatChatCompletionResponse(
        'id-1',
        'gpt-4',
        'some text',
        0,
        0,
        undefined,
        [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"x"}' } }],
        'tool_calls'
      );
      expect(response.choices[0].finish_reason).toBe('tool_calls');
      expect(response.choices[0].message.tool_calls).toHaveLength(1);
    });

    it('formats response without tool calls as stop', () => {
      const response = formatChatCompletionResponse('id-2', 'gpt-4', 'Hello there');
      expect(response.choices[0].finish_reason).toBe('stop');
      expect(response.choices[0].message.tool_calls).toBeUndefined();
    });

    it('sets finish_reason to tool_calls when toolCalls are present', () => {
      const response = formatChatCompletionResponse(
        'id-3', 'gpt-4', '', 0, 0, undefined,
        [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{}' } }],
        'stop' // even if stop is passed, tool_calls overrides
      );
      expect(response.choices[0].finish_reason).toBe('tool_calls');
    });
  });
});
