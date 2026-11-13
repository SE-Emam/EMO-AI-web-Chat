import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServer } from '../../src/server/app.js';
import type { ArenaDriver, Config, ChatMessage } from '../../src/types.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import {
  decideToolOutcome,
  parseToolCallsFromResponse,
  resolveToolChoice,
} from '../../src/server/tool-interpreter.js';
import {
  convertAnthropicMessagesWithTools,
  formatAnthropicToolUseResponse,
  formatAnthropicToolUseSSE,
  normalizeAnthropicToolChoice,
} from '../../src/server/anthropic-adapter.js';
import {
  convertGeminiContentsWithTools,
  formatGeminiFunctionCallResponse,
  normalizeGeminiToolConfig,
} from '../../src/server/gemini-adapter.js';

// ---------------------------------------------------------------------------
// Shared fixtures — NO acceptance data (project name/version) is embedded:
// the pipeline must not know the answer, only carry tool results.
// ---------------------------------------------------------------------------

const READ_TOOL_OPENAI = {
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

const SHELL_TOOL_OPENAI = {
  type: 'function' as const,
  function: {
    name: 'shell',
    description: 'Run a command',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
  },
};

const TOOL_CALL_TEXT = '```tool_call\n{"name":"read","arguments":{"path":"package.json"}}\n```';
const PLAIN_TEXT = 'I cannot help with that.';
const REFUSAL_TEXT = 'I cannot connect to OpenCode because the tunnel client is down.';

// ---------------------------------------------------------------------------
// 1. decideToolOutcome — the unified tool_choice contract
// ---------------------------------------------------------------------------

describe('decideToolOutcome', () => {
  it('emits parsed tool calls under auto', () => {
    const parsed = parseToolCallsFromResponse(TOOL_CALL_TEXT);
    const decision = decideToolOutcome(parsed, resolveToolChoice('auto', 1));
    expect(decision.emitToolCalls).toBe(true);
    expect(decision.toolCalls).toHaveLength(1);
    expect(decision.toolCalls![0].function.name).toBe('read');
    expect(decision.protocolError).toBeUndefined();
  });

  it('plain text under auto is NOT an error (no forced tool use)', () => {
    const decision = decideToolOutcome(
      { hasToolCalls: false, cleanText: PLAIN_TEXT },
      resolveToolChoice('auto', 1)
    );
    expect(decision.emitToolCalls).toBe(false);
    expect(decision.protocolError).toBeUndefined();
  });

  it('plain text under required IS a protocol error', () => {
    const decision = decideToolOutcome(
      { hasToolCalls: false, cleanText: REFUSAL_TEXT },
      resolveToolChoice('required', 1)
    );
    expect(decision.emitToolCalls).toBe(false);
    expect(decision.protocolError).toBe('tool_call_required_but_missing');
    expect(decision.refusalDetected).toBe(true);
  });

  it('plain text under required without refusal wording still errors, refusal=false', () => {
    const decision = decideToolOutcome(
      { hasToolCalls: false, cleanText: PLAIN_TEXT },
      resolveToolChoice('required', 1)
    );
    expect(decision.protocolError).toBe('tool_call_required_but_missing');
    expect(decision.refusalDetected).toBe(false);
  });

  it('specific tool requested: matching calls are accepted', () => {
    const parsed = parseToolCallsFromResponse(TOOL_CALL_TEXT);
    const decision = decideToolOutcome(parsed, resolveToolChoice({ type: 'function', function: { name: 'read' } }, 1));
    expect(decision.emitToolCalls).toBe(true);
    expect(decision.toolCalls![0].function.name).toBe('read');
  });

  it('specific tool requested: mismatched call is a contract violation, not renamed', () => {
    const parsed = parseToolCallsFromResponse(
      '```tool_call\n{"name":"shell","arguments":{"command":"ls"}}\n```'
    );
    const decision = decideToolOutcome(parsed, resolveToolChoice({ type: 'function', function: { name: 'read' } }, 1));
    expect(decision.emitToolCalls).toBe(false);
    expect(decision.protocolError).toBe('specific_tool_not_called');
  });

  it('specific tool requested: mixed calls are filtered to the requested one', () => {
    const parsed = parseToolCallsFromResponse(
      `${TOOL_CALL_TEXT}\n\`\`\`tool_call\n{"name":"shell","arguments":{"command":"ls"}}\n\`\`\``
    );
    const decision = decideToolOutcome(parsed, resolveToolChoice({ type: 'function', function: { name: 'read' } }, 2));
    expect(decision.emitToolCalls).toBe(true);
    expect(decision.toolCalls).toHaveLength(1);
    expect(decision.toolCalls![0].function.name).toBe('read');
  });
});

// ---------------------------------------------------------------------------
// 2. Anthropic adapter — native tool_use/tool_result bridge
// ---------------------------------------------------------------------------

describe('Anthropic tool bridge (adapter)', () => {
  it('converts assistant tool_use blocks into ChatMessage tool_calls', () => {
    const messages = [
      { role: 'user' as const, content: 'Read it' },
      {
        role: 'assistant' as const,
        content: [
          { type: 'text', text: 'Let me read.' },
          { type: 'tool_use', id: 'toolu_1', name: 'read', input: { path: 'package.json' } },
        ],
      },
    ];
    const result = convertAnthropicMessagesWithTools(messages as any);
    expect(result).toHaveLength(2);
    expect(result[1].role).toBe('assistant');
    expect(result[1].tool_calls).toHaveLength(1);
    expect((result[1].tool_calls![0] as any).id).toBe('toolu_1');
    expect((result[1].tool_calls![0] as any).function.name).toBe('read');
    expect(JSON.parse((result[1].tool_calls![0] as any).function.arguments)).toEqual({ path: 'package.json' });
  });

  it('converts user tool_result blocks into role:tool messages with the original id', () => {
    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'FILE CONTENT HERE' },
          { type: 'text', text: 'Continue.' },
        ],
      },
    ];
    const result = convertAnthropicMessagesWithTools(messages as any);
    const toolMsg = result.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.tool_call_id).toBe('toolu_1');
    expect(toolMsg!.content).toBe('FILE CONTENT HERE');
    // remaining text stays a user message
    const userMsg = result.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('Continue.');
  });

  it('formatAnthropicToolUseResponse emits tool_use blocks and stop_reason tool_use', () => {
    const res = formatAnthropicToolUseResponse(
      'msg_1', 'm', 'Let me read.',
      [{ id: 'toolu_1', function: { name: 'read', arguments: '{"path":"package.json"}' } }],
      10, 5
    );
    expect(res.stop_reason).toBe('tool_use');
    const toolBlock = res.content.find((b) => b.type === 'tool_use') as any;
    expect(toolBlock).toBeDefined();
    expect(toolBlock.id).toBe('toolu_1');
    expect(toolBlock.name).toBe('read');
    expect(toolBlock.input).toEqual({ path: 'package.json' });
    expect(res.content[0]).toEqual({ type: 'text', text: 'Let me read.' });
  });

  it('formatAnthropicToolUseSSE emits content_block_start/delta/stop for tool_use', () => {
    const sse = formatAnthropicToolUseSSE(
      [{ id: 'toolu_2', function: { name: 'read', arguments: '{"path":"x"}' } }],
      1
    );
    expect(sse).toContain('"content_block_start"');
    expect(sse).toContain('"tool_use"');
    expect(sse).toContain('"input_json_delta"');
    expect(sse).toContain('toolu_2');
    expect(sse).toContain('"content_block_stop"');
  });

  it('normalizeAnthropicToolChoice maps native Anthropic tool_choice', () => {
    expect(normalizeAnthropicToolChoice(undefined)).toBeUndefined();
    expect(normalizeAnthropicToolChoice({ type: 'auto' })).toBe('auto');
    expect(normalizeAnthropicToolChoice({ type: 'any' })).toBe('required');
    expect(normalizeAnthropicToolChoice({ type: 'tool', name: 'read' })).toEqual({
      type: 'function', function: { name: 'read' },
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Gemini adapter — native functionCall/functionResponse bridge
// ---------------------------------------------------------------------------

describe('Gemini tool bridge (adapter)', () => {
  it('converts model functionCall parts into ChatMessage tool_calls', () => {
    const contents = [
      { role: 'user', parts: [{ text: 'Read it' }] },
      { role: 'model', parts: [{ functionCall: { name: 'read', args: { path: 'package.json' } } }] },
    ];
    const result = convertGeminiContentsWithTools(contents as any);
    expect(result[1].role).toBe('assistant');
    expect(result[1].tool_calls).toHaveLength(1);
    expect((result[1].tool_calls![0] as any).function.name).toBe('read');
    expect(JSON.parse((result[1].tool_calls![0] as any).function.arguments)).toEqual({ path: 'package.json' });
  });

  it('converts user functionResponse parts into role:tool messages', () => {
    const contents = [
      { role: 'user', parts: [{ functionResponse: { name: 'read', response: { result: 'DATA' } } }] },
    ];
    const result = convertGeminiContentsWithTools(contents as any);
    const toolMsg = result.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.name).toBe('read');
    expect(toolMsg!.content).toBe('{"result":"DATA"}');
  });

  it('formatGeminiFunctionCallResponse emits functionCall parts with STOP', () => {
    const res = formatGeminiFunctionCallResponse(
      'Checking.',
      [{ id: 'call_1', function: { name: 'read', arguments: '{"path":"package.json"}' } }],
      'gemini-test',
      { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }
    );
    expect(res.candidates[0].finishReason).toBe('STOP');
    const fcPart = res.candidates[0].content.parts.find((p: any) => p.functionCall) as any;
    expect(fcPart).toBeDefined();
    expect(fcPart.functionCall.name).toBe('read');
    expect(fcPart.functionCall.args).toEqual({ path: 'package.json' });
  });

  it('normalizeGeminiToolConfig maps native functionCallingConfig', () => {
    expect(normalizeGeminiToolConfig(undefined)).toBeUndefined();
    expect(normalizeGeminiToolConfig({ functionCallingConfig: { mode: 'AUTO' } })).toBe('auto');
    expect(normalizeGeminiToolConfig({ functionCallingConfig: { mode: 'ANY' } })).toBe('required');
    expect(normalizeGeminiToolConfig({ functionCallingConfig: { mode: 'NONE' } })).toBe('none');
    expect(normalizeGeminiToolConfig({ functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['read'] } })).toEqual({
      type: 'function', function: { name: 'read' },
    });
  });
});

// ---------------------------------------------------------------------------
// 4. OpenAI route — full bridge over HTTP with a mock web model
// ---------------------------------------------------------------------------

describe('OpenAI route tool bridge (mock web model)', () => {
  const config: Config = { ...DEFAULT_CONFIG };
  let lastDriverMessages: ChatMessage[] = [];
  let lastSessionKey: string | undefined;
  let driverReply: string = PLAIN_TEXT;

  const makeDriver = (): ArenaDriver => ({
    listModels: async () => ['web-model'],
    sendMessage: async (_model: string, messages: ChatMessage[], _onChunk?: (c: string) => void, _signal?: AbortSignal, sessionKey?: string) => {
      lastDriverMessages = messages;
      lastSessionKey = sessionKey;
      return driverReply;
    },
  });

  beforeEach(() => {
    lastDriverMessages = [];
    lastSessionKey = undefined;
    driverReply = PLAIN_TEXT;
  });

  it('model text tool_call → OpenAI tool_calls response; driver received injected instruction', async () => {
    driverReply = TOOL_CALL_TEXT;
    const app = createServer(makeDriver(), config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'web-model',
        messages: [{ role: 'user', content: 'Read package.json' }],
        tools: [READ_TOOL_OPENAI],
      },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.choices[0].finish_reason).toBe('tool_calls');
    const tc = data.choices[0].message.tool_calls[0];
    expect(tc.function.name).toBe('read');
    expect(JSON.parse(tc.function.arguments)).toEqual({ path: 'package.json' });
    // Injection happened BEFORE the driver call
    const sys = lastDriverMessages.find((m) => m.role === 'system');
    expect(String(sys?.content)).toContain('TOOL CALLING MODE');
    expect(String(sys?.content)).toContain('read');
  });

  it('tool result continuation: client tool message reaches the model as tool result + bridge note', async () => {
    driverReply = 'The project data has been read successfully.';
    const app = createServer(makeDriver(), config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'web-model',
        messages: [
          { role: 'user', content: 'Read package.json' },
          { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"package.json"}' } }] },
          { role: 'tool', tool_call_id: 'call_1', content: 'FILE CONTENT' },
        ],
        tools: [READ_TOOL_OPENAI],
      },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.choices[0].finish_reason).toBe('stop');
    // The tool result reached the driver as a role:tool message with its ID
    const toolMsg = lastDriverMessages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.tool_call_id).toBe('call_1');
    expect(toolMsg!.content).toBe('FILE CONTENT');
    expect(toolMsg!.name).toBe('read');
    // Continuation note appended
    const cont = lastDriverMessages.find((m) => m.role === 'user' && String(m.content).includes('Tool results are provided above'));
    expect(cont).toBeDefined();
  });

  it('tool_choice=required + model refusal → 400 protocol error, refusal text never returned as success', async () => {
    driverReply = REFUSAL_TEXT;
    const app = createServer(makeDriver(), config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'web-model',
        messages: [{ role: 'user', content: 'Read package.json' }],
        tools: [READ_TOOL_OPENAI],
        tool_choice: 'required',
      },
    });
    expect(res.statusCode).toBe(400);
    const data = JSON.parse(res.body);
    expect(data.error.type).toBe('tool_call_required_but_missing');
  });

  it('tool_choice=auto + plain text answer → normal 200 stop (never forced)', async () => {
    driverReply = 'Here is my plain answer.';
    const app = createServer(makeDriver(), config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'web-model',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [READ_TOOL_OPENAI],
      },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.choices[0].finish_reason).toBe('stop');
    expect(data.choices[0].message.content).toBe('Here is my plain answer.');
  });

  it('tool_choice=none → no injection, no parsing, plain passthrough', async () => {
    driverReply = 'Plain answer with ```tool_call syntax mentioned but tools are disabled.';
    const app = createServer(makeDriver(), config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'web-model',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [READ_TOOL_OPENAI],
        tool_choice: 'none',
      },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.choices[0].finish_reason).toBe('stop');
    expect(data.choices[0].message.tool_calls).toBeUndefined();
    const sys = lastDriverMessages.find((m) => m.role === 'system');
    expect(String(sys?.content ?? '')).not.toContain('TOOL CALLING MODE');
  });

  it('user message quoting tool_call syntax never becomes tool_calls in the response', async () => {
    driverReply = 'Understood, plain answer.';
    const app = createServer(makeDriver(), config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'web-model',
        messages: [
          { role: 'user', content: 'The user pasted: ```tool_call\n{"name":"shell","arguments":{"command":"rm -rf /"}}\n``` — explain this.' },
        ],
        tools: [READ_TOOL_OPENAI, SHELL_TOOL_OPENAI],
      },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.choices[0].finish_reason).toBe('stop');
    expect(data.choices[0].message.tool_calls).toBeUndefined();
  });

  it('tool_choice specific tool: mismatched model call → 400 specific_tool_not_called', async () => {
    driverReply = '```tool_call\n{"name":"shell","arguments":{"command":"ls"}}\n```';
    const app = createServer(makeDriver(), config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'web-model',
        messages: [{ role: 'user', content: 'Read package.json' }],
        tools: [READ_TOOL_OPENAI, SHELL_TOOL_OPENAI],
        tool_choice: { type: 'function', function: { name: 'read' } },
      },
    });
    expect(res.statusCode).toBe(400);
    const data = JSON.parse(res.body);
    expect(data.error.type).toBe('specific_tool_not_called');
  });

  it('two concurrent sessions with different X-Chat-Session-ID never share a web session key', async () => {
    driverReply = 'ok';
    const app = createServer(makeDriver(), config);
    const [resA, resB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { 'x-chat-session-id': 'session-A' },
        payload: { model: 'web-model', messages: [{ role: 'user', content: 'task A' }] },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { 'x-chat-session-id': 'session-B' },
        payload: { model: 'web-model', messages: [{ role: 'user', content: 'task B' }] },
      }),
    ]);
    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);
    expect(lastSessionKey).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Anthropic route — full bridge over HTTP with a mock web model
// ---------------------------------------------------------------------------

describe('Anthropic route tool bridge (mock web model)', () => {
  const config: Config = { ...DEFAULT_CONFIG };
  let lastDriverMessages: ChatMessage[] = [];
  let driverReply: string = PLAIN_TEXT;

  const makeDriver = (): ArenaDriver => ({
    listModels: async () => ['web-model'],
    sendMessage: async (_model: string, messages: ChatMessage[]) => {
      lastDriverMessages = messages;
      return driverReply;
    },
  });

  beforeEach(() => {
    lastDriverMessages = [];
    driverReply = PLAIN_TEXT;
  });

  it('model text tool_call → native tool_use response with stop_reason tool_use', async () => {
    driverReply = TOOL_CALL_TEXT;
    const app = createServer(makeDriver(), config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: {
        model: 'web-model',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Read package.json' }],
        tools: [{ name: 'read', description: 'Read a file', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }],
      },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.stop_reason).toBe('tool_use');
    const toolBlock = data.content.find((b: any) => b.type === 'tool_use');
    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe('read');
    expect(toolBlock.input).toEqual({ path: 'package.json' });
    // Anthropic tool schema was converted and injected
    const sys = lastDriverMessages.find((m) => m.role === 'system');
    expect(String(sys?.content)).toContain('TOOL CALLING MODE');
  });

  it('tool_result block in user content → driver receives role:tool with original id', async () => {
    driverReply = 'The file has been read.';
    const app = createServer(makeDriver(), config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: {
        model: 'web-model',
        max_tokens: 100,
        messages: [
          { role: 'user', content: 'Read package.json' },
          { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'read', input: { path: 'package.json' } }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'FILE CONTENT' }] },
        ],
        tools: [{ name: 'read', description: 'Read a file', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }],
      },
    });
    expect(res.statusCode).toBe(200);
    const toolMsg = lastDriverMessages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.tool_call_id).toBe('toolu_1');
    expect(toolMsg!.content).toBe('FILE CONTENT');
  });

  it('tool_choice {type:any} + refusal → 400 protocol error', async () => {
    driverReply = REFUSAL_TEXT;
    const app = createServer(makeDriver(), config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: {
        model: 'web-model',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Read it' }],
        tools: [{ name: 'read', description: 'Read', input_schema: {} }],
        tool_choice: { type: 'any' },
      },
    });
    expect(res.statusCode).toBe(400);
    const data = JSON.parse(res.body);
    expect(data.error.type).toBe('invalid_request_error');
    expect(data.error.message).toContain('required tool call');
  });

  it('tool_choice {type:tool,name} mismatch → 400 specific_tool_not_called semantics (message indicates required tool)', async () => {
    driverReply = '```tool_call\n{"name":"shell","arguments":{"command":"ls"}}\n```';
    const app = createServer(makeDriver(), config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: {
        model: 'web-model',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Read it' }],
        tools: [
          { name: 'read', description: 'Read', input_schema: {} },
          { name: 'shell', description: 'Shell', input_schema: {} },
        ],
        tool_choice: { type: 'tool', name: 'read' },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('no tool_choice + plain text → normal end_turn response', async () => {
    driverReply = 'Plain Claude-style answer.';
    const app = createServer(makeDriver(), config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: {
        model: 'web-model',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ name: 'read', description: 'Read', input_schema: {} }],
      },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.stop_reason).toBe('end_turn');
    expect(data.content[0].text).toBe('Plain Claude-style answer.');
  });
});

// ---------------------------------------------------------------------------
// 6. Gemini route — full bridge over HTTP with a mock web model
// ---------------------------------------------------------------------------

describe('Gemini route tool bridge (mock web model)', () => {
  const config: Config = { ...DEFAULT_CONFIG };
  let lastDriverMessages: ChatMessage[] = [];
  let driverReply: string = PLAIN_TEXT;

  const makeDriver = (): ArenaDriver => ({
    listModels: async () => ['web-model'],
    sendMessage: async (_model: string, messages: ChatMessage[]) => {
      lastDriverMessages = messages;
      return driverReply;
    },
  });

  beforeEach(() => {
    lastDriverMessages = [];
    driverReply = PLAIN_TEXT;
  });

  it('model text tool_call → native functionCall part in the response', async () => {
    driverReply = TOOL_CALL_TEXT;
    const app = createServer(makeDriver(), config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1beta/models/web-model:generateContent',
      payload: {
        contents: [{ role: 'user', parts: [{ text: 'Read package.json' }] }],
        tools: [{ functionDeclarations: [{ name: 'read', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }] }],
      },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    const fcPart = data.candidates[0].content.parts.find((p: any) => p.functionCall);
    expect(fcPart).toBeDefined();
    expect(fcPart.functionCall.name).toBe('read');
    expect(fcPart.functionCall.args).toEqual({ path: 'package.json' });
    const sys = lastDriverMessages.find((m) => m.role === 'system');
    expect(String(sys?.content)).toContain('TOOL CALLING MODE');
  });

  it('functionResponse part → driver receives role:tool message', async () => {
    driverReply = 'The file has been read.';
    const app = createServer(makeDriver(), config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1beta/models/web-model:generateContent',
      payload: {
        contents: [
          { role: 'user', parts: [{ text: 'Read it' }] },
          { role: 'model', parts: [{ functionCall: { name: 'read', args: { path: 'package.json' } } }] },
          { role: 'user', parts: [{ functionResponse: { name: 'read', response: { result: 'FILE CONTENT' } } }] },
        ],
        tools: [{ functionDeclarations: [{ name: 'read', description: 'Read', parameters: {} }] }],
      },
    });
    expect(res.statusCode).toBe(200);
    const toolMsg = lastDriverMessages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.name).toBe('read');
    expect(toolMsg!.content).toContain('FILE CONTENT');
  });

  it('tool_config mode ANY + refusal → 400 INVALID_ARGUMENT', async () => {
    driverReply = REFUSAL_TEXT;
    const app = createServer(makeDriver(), config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1beta/models/web-model:generateContent',
      payload: {
        contents: [{ role: 'user', parts: [{ text: 'Read it' }] }],
        tools: [{ functionDeclarations: [{ name: 'read', description: 'Read', parameters: {} }] }],
        tool_config: { functionCallingConfig: { mode: 'ANY' } },
      },
    });
    expect(res.statusCode).toBe(400);
    const data = JSON.parse(res.body);
    expect(data.error.status).toBe('INVALID_ARGUMENT');
    expect(data.error.message).toContain('required tool call');
  });

  it('tool_config mode NONE → no injection, plain response', async () => {
    driverReply = 'Plain Gemini-style answer.';
    const app = createServer(makeDriver(), config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1beta/models/web-model:generateContent',
      payload: {
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        tools: [{ functionDeclarations: [{ name: 'read', description: 'Read', parameters: {} }] }],
        tool_config: { functionCallingConfig: { mode: 'NONE' } },
      },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    const sys = lastDriverMessages.find((m) => m.role === 'system');
    expect(String(sys?.content ?? '')).not.toContain('TOOL CALLING MODE');
    expect(data.candidates[0].content.parts[0].text).toBe('Plain Gemini-style answer.');
  });
});
