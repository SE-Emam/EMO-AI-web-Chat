import { describe, it, expect } from 'vitest';
import {
  injectToolsInstruction,
  parseToolCallsFromResponse,
} from '../../src/server/tool-interpreter.js';
import type { ChatMessage } from '../../src/types.js';

describe('ToolInterpreter', () => {
  it('injects tool definitions into system message when tools are provided', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'What is the content of package.json?' },
    ];
    const tools = [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Reads a file from disk',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      },
    ];

    const updated = injectToolsInstruction(messages, tools);
    expect(updated).toHaveLength(3);
    expect(updated[0].role).toBe('system');
    expect(updated[0].content).toContain('TOOL CALLING MODE (MANDATORY');
    expect(updated[0].content).toContain('```tool_call');
    expect(updated[0].content).toContain('read_file');
    // The nudge must be its OWN message — never appended to the client's user
    // message, or the driver's stored transcript diverges from the client's
    // next request and continuation breaks on every such turn.
    expect(updated[1]).toEqual(messages[0]);
    expect(updated[2].role).toBe('user');
    expect(updated[2].content).toContain('IMPORTANT (override): Tools are available NOW');
    expect(messages[0].content).not.toContain('IMPORTANT (override)');
  });

  it('parses fenced tool_call block correctly from response text', () => {
    const modelOutput = `
I will read package.json for you.
\`\`\`tool_call
{"name": "read_file", "arguments": {"path": "package.json"}}
\`\`\`
Let me know if you need anything else.
`;

    const result = parseToolCallsFromResponse(modelOutput);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].function.name).toBe('read_file');
    expect(JSON.parse(result.toolCalls![0].function.arguments)).toEqual({
      path: 'package.json',
    });
    expect(result.cleanText).toContain('I will read package.json for you.');
    expect(result.cleanText).not.toContain('```tool_call');
  });

  it('parses XML style <tool_call> block correctly', () => {
    const modelOutput = `
Checking the directory:
<tool_call>
{"name": "list_files", "arguments": {"dir": "./src"}}
</tool_call>
`;

    const result = parseToolCallsFromResponse(modelOutput);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls![0].function.name).toBe('list_files');
  });

  it('returns hasToolCalls: false when no tool call is present', () => {
    const modelOutput = 'Here is the normal explanation of your code.';
    const result = parseToolCallsFromResponse(modelOutput);
    expect(result.hasToolCalls).toBe(false);
    expect(result.cleanText).toBe(modelOutput);
  });

  it('recovers a tool call with a mangled closing fence (stray char after ```)', () => {
    // Real failure seen live: closing fence rendered as "``)" — the fenced-block
    // regex fails, previously losing the whole call.
    const modelOutput = [
      'سأفحص المشروع.',
      '```tool_call',
      '{"name":"shell","arguments":{"command":"pwd","workdir":"/tmp"}}',
      '``)',
    ].join('\n');
    const result = parseToolCallsFromResponse(modelOutput);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls![0].function.name).toBe('shell');
    expect(JSON.parse(result.toolCalls![0].function.arguments).command).toBe('pwd');
  });

  it('recovers a stream-cut tool call (JSON braces never closed)', () => {
    const modelOutput = '```tool_call\n{"name":"read_file","arguments":{"path":"src/index.ts"}';
    const result = parseToolCallsFromResponse(modelOutput);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls![0].function.name).toBe('read_file');
  });
});
