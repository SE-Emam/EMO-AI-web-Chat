import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCorrectionMessage,
  buildRequestHint,
  buildToolCallBlock,
  classifyPath,
  extractAnnouncedTools,
  findLocalPath,
  looksLikeToolRefusal,
  pickFileTool,
  withHintSection,
} from '../../src/gateway/agent-tool-bridge.js';
import { injectToolsInstruction } from '../../src/server/tool-interpreter.js';
import type { ChatMessage } from '../../src/types.js';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read',
      description: 'Read a file from the filesystem',
      parameters: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list',
      description: 'List files and directories',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Run a shell command',
      parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    },
  },
];

function injected(userText: string, tools = TOOLS): ChatMessage[] {
  const msgs: ChatMessage[] = [{ role: 'user', content: userText }];
  return injectToolsInstruction(msgs, tools as any, 'auto') as ChatMessage[];
}

describe('agent tool bridge', () => {
  it('extracts the tools the gateway announced', () => {
    const tools = extractAnnouncedTools(injected('read /tmp/x'));
    expect(tools.map((t) => t.name)).toEqual(['read', 'list', 'bash']);
  });

  it('finds an absolute local path in the task', () => {
    expect(findLocalPath('Read the files in /Users/me/Desktop/Doctor-Car')).toBe('/Users/me/Desktop/Doctor-Car');
    expect(findLocalPath('read /etc/hosts.')).toBe('/etc/hosts');
    expect(findLocalPath('no path here')).toBeNull();
    expect(findLocalPath('relative/path.txt')).toBeNull();
  });

  it('classifies what a path really is', () => {
    expect(classifyPath(os.tmpdir())).toBe('directory');
    expect(classifyPath(path.join(os.tmpdir(), 'nope-' + Date.now()))).toBe('missing');
  });

  it('picks the reader for a file and the lister for a directory', () => {
    const tools = extractAnnouncedTools(injected('x'));
    expect(pickFileTool(tools, 'file')?.tool.name).toBe('read');
    expect(pickFileTool(tools, 'file')?.arg).toBe('filePath');
    expect(pickFileTool(tools, 'directory')?.tool.name).toBe('list');
    expect(pickFileTool(tools, 'directory')?.arg).toBe('path');
  });

  it('builds the exact call for a real path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-'));
    const file = path.join(dir, 'notes.md');
    fs.writeFileSync(file, '# hello');
    const call = buildRequestHint(injected(`read ${file}`));
    expect(call?.tool).toBe('read');
    expect(call?.arg).toBe('filePath');
    expect(call?.block).toContain('```tool_call');
    expect(call?.block).toContain(file);
    const call2 = buildRequestHint(injected(`list ${dir}`));
    expect(call2?.tool).toBe('list');
    expect(call2?.arg).toBe('path');
  });

  it('does not force a call when a tool already ran', () => {
    const msgs = injected('read /tmp/x');
    msgs.push({ role: 'tool', content: 'the content' } as ChatMessage);
    expect(buildRequestHint(msgs)).toBeNull();
  });

  it('does not force a call when no path is named', () => {
    expect(buildRequestHint(injected('summarize the project'))).toBeNull();
  });

  it('still calls for a path that does not exist yet', () => {
    const missing = '/Users/me/Desktop/not-there-yet';
    const call = buildRequestHint(injected(`read ${missing}`));
    expect(call?.tool).toBe('list');
    expect(call?.path).toBe(missing);
    const missingFile = '/Users/me/Desktop/not-there-yet.md';
    const call2 = buildRequestHint(injected(`read ${missingFile}`));
    expect(call2?.tool).toBe('read');
  });

  it('inserts the hint at the end of the tool-mode system message', () => {
    const msgs = injected('read /tmp/x');
    const withHint = withHintSection(msgs, buildToolCallBlock('read', 'filePath', '/tmp/x'));
    const sys = withHint.find((m) => m.role === 'system') as ChatMessage;
    const content = String(sys.content);
    expect(content.indexOf('### THE TOOL CALL TO EMIT NOW')).toBeGreaterThan(
      content.indexOf('### TOOL CALLING MODE (MANDATORY'),
    );
    expect(content.indexOf('### THE TOOL CALL TO EMIT NOW')).toBeGreaterThan(
      content.indexOf('Available tools (JSON schemas)'),
    );
    // the mode heading must stay intact
    expect(content).toContain('### TOOL CALLING MODE (MANDATORY - ACTIVE NOW)');
  });

  it('recognizes the refusals a web model produces', () => {
    expect(looksLikeToolRefusal('The file environment connection is interrupted.')).toBe(true);
    expect(looksLikeToolRefusal('read_file has not been exposed in the executable tool list')).toBe(true);
    expect(looksLikeToolRefusal('The file wasn\'t found at the specified path: /x')).toBe(true);
    expect(looksLikeToolRefusal('ظهرت مشكلة في الاتصال ببيئة الملفات المحلية')).toBe(true);
    expect(looksLikeToolRefusal('لم أتمكن من قراءة محتوياته')).toBe(true);
    expect(looksLikeToolRefusal('Doctor Car is a car diagnostic web application.')).toBe(false);
    expect(looksLikeToolRefusal('')).toBe(false);
  });

  it('never asks for a call when a call is already there', () => {
    expect(looksLikeToolRefusal('```tool_call\n{"name":"read"}\n```')).toBe(false);
  });

  it('the correction carries the neutral marker and the concrete call', () => {
    const call = buildToolCallBlock('read', 'filePath', '/tmp/x');
    const msg = buildCorrectionMessage(call, extractAnnouncedTools(injected('read /tmp/x')));
    expect(msg).toContain('The tools announced in this request are available now');
    expect(msg).toContain('"name":"read"');
    expect(msg).toContain('/tmp/x');
  });

  it('the correction without a concrete call lists the announced tools', () => {
    const msg = buildCorrectionMessage(null, extractAnnouncedTools(injected('read /tmp/x')));
    expect(msg).toContain('read(filePath)');
    expect(msg).toContain('list(path)');
  });
});
