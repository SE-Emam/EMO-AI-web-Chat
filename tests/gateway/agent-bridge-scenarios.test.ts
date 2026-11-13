/**
 * Agent bridge scenario regression matrix (Phase 7).
 *
 * Tests the agent ↔ web-model tool bridge with a matrix of:
 * - Agents: OpenCode (12 tools), Cline (6 tools)
 * - Path types: file, directory, search
 * - Languages: EN, AR
 * 
 * Expected result: All scenarios emit tool_calls and receive proper results.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildToolCallBlock,
  buildFactOnlyEnvironmentBlock,
  buildContinuationBlock,
  withFactOnlyEnvironment,
  withContinuationBlock,
  extractAnnouncedTools,
  findLocalPath,
  classifyPath,
  pickFileTool,
  repairArguments,
  validateToolArguments,
  looksLikeToolRefusal,
  buildRequestHint,
  buildWorkspaceRootCall,
} from '../../src/gateway/agent-tool-bridge.js';
import type { ChatMessage, AnnouncedTool } from '../../src/types.js';

// Sample tools for OpenCode (12 tools)
const OPENCODE_TOOLS: AnnouncedTool[] = [
  {
    name: 'read_file',
    description: 'Read one file from the local workspace and return its content.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path inside an approved workspace root.' },
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
    description: 'Replace an exact string inside a file.',
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
    description: 'List the entries of one folder (name, type and size).',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path inside an approved workspace root.' } },
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
  {
    name: 'read_directory',
    description: 'Read all files in a directory and return their contents.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path inside an approved workspace root.' } },
      required: ['path'],
    },
  },
  {
    name: 'write_directory',
    description: 'Write multiple files to a directory.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the directory.' },
        files: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } } } },
      },
      required: ['path', 'files'],
    },
  },
  {
    name: 'copy_file',
    description: 'Copy a file to a new location.',
    parameters: {
      type: 'object',
      properties: {
        source_path: { type: 'string' },
        destination_path: { type: 'string' },
      },
      required: ['source_path', 'destination_path'],
    },
  },
];

// Sample tools for Cline (6 tools)
const CLINE_TOOLS: AnnouncedTool[] = [
  {
    name: 'read_file',
    description: 'Read one file from the local workspace and return its content.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path inside an approved workspace root.' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'list_directory',
    description: 'List the entries of one folder (name, type and size).',
    parameters: {
      type: 'object',
      properties: { dirPath: { type: 'string', description: 'Absolute path inside an approved workspace root.' } },
      required: ['dirPath'],
    },
  },
  {
    name: 'write_file',
    description: 'Write a file (creating it when needed) and return the number of bytes written.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path, or a path relative to the workspace root.' },
        content: { type: 'string', description: 'The full new content of the file.' },
      },
      required: ['filePath', 'content'],
    },
  },
  {
    name: 'create_directory',
    description: 'Create a directory (including missing parents).',
    parameters: {
      type: 'object',
      properties: { dirPath: { type: 'string' } },
      required: ['dirPath'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace an exact string inside a file.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' },
      },
      required: ['filePath', 'old_string', 'new_string'],
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
      },
      required: ['path', 'regex'],
    },
  },
];

describe('Agent Bridge Scenarios', () => {
  const testRoots = ['/Users/emamabdullaziz/Desktop', '/Users/emamabdullaziz/Projects'];
  
  describe('OpenCode Scenarios', () => {
    const tools = OPENCODE_TOOLS;
    
    it('EN - File scenario', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: '### TOOL CALLING MODE (MANDATORY)\n\nAvailable tools (JSON schemas):\n```json\n[\n  {\n    "name": "read_file",\n    "description": "Read one file from the local workspace and return its content.",\n    "parameters": {\n      "type": "object",\n      "properties": {\n        "path": { "type": "string", "description": "Absolute path inside an approved workspace root." }\n      },\n      "required": ["path"]\n    }\n  }\n]\n```' },
        { role: 'user', content: 'Read the file /Users/emamabdullaziz/Desktop/README.md' }
      ];
      
      // Test fact-only environment block
      const withEnv = withFactOnlyEnvironment(messages, tools, testRoots);
      expect(withEnv).toHaveLength(2);
      expect(withEnv[0].content).toContain('WORKSPACE ENVIRONMENT');
      
      // Test request hint
      const hint = buildRequestHint(messages);
      expect(hint).toBeTruthy();
      expect(hint?.tool).toBe('read_file');
      expect(hint?.arg).toBe('path');
      expect(hint?.path).toBe('/Users/emamabdullaziz/Desktop/README.md');
      
      // Test tool call block
      const block = buildToolCallBlock('read_file', 'path', '/Users/emamabdullaziz/Desktop/README.md');
      expect(block.tool).toBe('read_file');
      expect(block.arg).toBe('path');
      expect(block.path).toBe('/Users/emamabdullaziz/Desktop/README.md');
      expect(block.block).toContain('```tool_call');
      expect(block.block).toContain('read_file');
      expect(block.block).toContain('path');
      expect(block.block).toContain('/Users/emamabdullaziz/Desktop/README.md');
    });
    
    it('AR - File scenario', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: '### TOOL CALLING MODE (MANDATORY)\n\nAvailable tools (JSON schemas):\n```json\n[\n  {\n    "name": "read_file",\n    "description": "Read one file from the local workspace and return its content.",\n    "parameters": {\n      "type": "object",\n      "properties": {\n        "path": { "type": "string", "description": "Absolute path inside an approved workspace root." }\n      },\n      "required": ["path"]\n    }\n  }\n]\n```' },
        { role: 'user', content: 'اقرأ الملف /Users/emamabdullaziz/Desktop/README.md' }
      ];
      
      // Test fact-only environment block
      const withEnv = withFactOnlyEnvironment(messages, tools, testRoots);
      expect(withEnv).toHaveLength(2);
      expect(withEnv[0].content).toContain('WORKSPACE ENVIRONMENT');
      
      // Test request hint
      const hint = buildRequestHint(messages);
      expect(hint).toBeTruthy();
      expect(hint?.tool).toBe('read_file');
      expect(hint?.arg).toBe('path');
      expect(hint?.path).toBe('/Users/emamabdullaziz/Desktop/README.md');
    });
    
    it('EN - Directory scenario', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: '### TOOL CALLING MODE (MANDATORY)\n\nAvailable tools (JSON schemas):\n```json\n[\n  {\n    "name": "list_directory",\n    "description": "List the entries of one folder (name, type and size).",\n    "parameters": {\n      "type": "object",\n      "properties": {\n        "path": { "type": "string", "description": "Absolute path inside an approved workspace root." }\n      },\n      "required": ["path"]\n    }\n  }\n]\n```' },
        { role: 'user', content: 'List the contents of /Users/emamabdullaziz/Desktop' }
      ];
      
      const hint = buildRequestHint(messages);
      expect(hint).toBeTruthy();
      expect(hint?.tool).toBe('list_directory');
      expect(hint?.arg).toBe('path');
      expect(hint?.path).toBe('/Users/emamabdullaziz/Desktop');
    });
    
    it('EN - Search scenario', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: '### TOOL CALLING MODE (MANDATORY)\n\nAvailable tools (JSON schemas):\n```json\n[\n  {\n    "name": "search_files",\n    "description": "Search the workspace for a regular expression and return the matching lines.",\n    "parameters": {\n      "type": "object",\n      "properties": {\n        "path": { "type": "string", "description": "Directory to search in." },\n        "regex": { "type": "string", "description": "Regular expression to search for." }\n      },\n      "required": ["path", "regex"]\n    }\n  }\n]\n```' },
        { role: 'user', content: 'Search for "TODO" in /Users/emamabdullaziz/Desktop' }
      ];
      
      // For search, we need to pick the tool manually since it has two required params
      const picked = pickFileTool(tools, 'directory');
      expect(picked).toBeTruthy();
      // The pickFileTool will pick list_directory for directory type, not search_files
      expect(picked?.tool.name).toBe('list_directory');
      
      const hint = buildRequestHint(messages);
      // Search won't be picked by buildRequestHint because it requires regex too
      expect(hint).toBeNull();
    });
  });
  
  describe('Cline Scenarios', () => {
    const tools = CLINE_TOOLS;
    
    it('EN - File scenario (different parameter name)', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: '### TOOL CALLING MODE (MANDATORY)\n\nAvailable tools (JSON schemas):\n```json\n[\n  {\n    "name": "read_file",\n    "description": "Read one file from the local workspace and return its content.",\n    "parameters": {\n      "type": "object",\n      "properties": {\n        "filePath": { "type": "string", "description": "Absolute path inside an approved workspace root." }\n      },\n      "required": ["filePath"]\n    }\n  }\n]\n```' },
        { role: 'user', content: 'Read the file /Users/emamabdullaziz/Desktop/README.md' }
      ];
      
      // Test argument repair - model might use "path" instead of "filePath"
      const badArgs = { path: '/Users/emamabdullaziz/Desktop/README.md' };
      const repaired = repairArguments(badArgs, tools[0]);
      expect(repaired.changed).toBe(true);
      expect(repaired.args.filePath).toBe('/Users/emamabdullaziz/Desktop/README.md');
      
      // Test validation
      const validated = validateToolArguments(repaired.args, tools[0]);
      expect(validated.valid).toBe(true);
      // This should be false because the args are now valid
      expect(validated.changed).toBe(false);
    });
    
    it('EN - Directory scenario (different parameter name)', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: '### TOOL CALLING MODE (MANDATORY)\n\nAvailable tools (JSON schemas):\n```json\n[\n  {\n    "name": "list_directory",\n    "description": "List the entries of one folder (name, type and size).",\n    "parameters": {\n      "type": "object",\n      "properties": {\n        "dirPath": { "type": "string", "description": "Absolute path inside an approved workspace root." }\n      },\n      "required": ["dirPath"]\n    }\n  }\n]\n```' },
        { role: 'user', content: 'List the contents of /Users/emamabdullaziz/Desktop' }
      ];
      
      const hint = buildRequestHint(messages);
      expect(hint).toBeTruthy();
      expect(hint?.tool).toBe('list_directory');
      expect(hint?.arg).toBe('dirPath');
      expect(hint?.path).toBe('/Users/emamabdullaziz/Desktop');
    });
  });
  
  describe('Tool Refusal Detection', () => {
    it('Detects English refusals', () => {
      const refusal1 = 'I could not access the file because the connection failed';
      const refusal2 = 'The file environment is disconnected';
      const refusal3 = 'Please upload the file instead';
      
      expect(looksLikeToolRefusal(refusal1)).toBe(true);
      expect(looksLikeToolRefusal(refusal2)).toBe(true);
      expect(looksLikeToolRefusal(refusal3)).toBe(true);
    });
    
    it('Detects Arabic refusals', () => {
      const refusal1 = 'لم أتمكن من الوصول إلى الملف';
      const refusal2 = 'المسار غير موجود في البيئة';
      
      expect(looksLikeToolRefusal(refusal1)).toBe(true);
      expect(looksLikeToolRefusal(refusal2)).toBe(true);
    });
    
    it('Does not detect valid tool calls', () => {
      const valid1 = '```tool_call\n{"name":"read_file","arguments":{"path":"/Users/emamabdullaziz/Desktop/README.md"}}\n```';
      const valid2 = 'Here is the content of the file:\n```\nHello World\n```';
      
      expect(looksLikeToolRefusal(valid1)).toBe(false);
      expect(looksLikeToolRefusal(valid2)).toBe(false);
    });
  });
  
  describe('Continuation Scenarios', () => {
    it('Builds continuation after tool result', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: '### TOOL CALLING MODE (MANDATORY)' },
        { role: 'user', content: 'List the files in /Users/emamabdullaziz/Desktop' },
        { 
          role: 'tool', 
          content: 'README.md\npackage.json\nsrc/\ntests/\n' 
        }
      ];
      
      const continuation = buildContinuationBlock(
        buildToolCallBlock('read_file', 'path', '/Users/emamabdullaziz/Desktop/README.md'),
        OPENCODE_TOOLS
      );
      
      expect(continuation).toContain('TOOL RESULT AND CONTINUATION');
      expect(continuation).toContain('The tool result above is the actual output from the client machine');
      expect(continuation).toContain('read_file');
      expect(continuation).toContain('path');
    });
    
    it('Handles workspace root call when no path is specified', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: '### TOOL CALLING MODE (MANDATORY)' },
        { role: 'user', content: 'What files are available?' }
      ];
      
      const rootCall = buildWorkspaceRootCall(OPENCODE_TOOLS, testRoots);
      expect(rootCall).toBeTruthy();
      expect(rootCall?.tool).toBe('list_directory');
      expect(rootCall?.arg).toBe('path');
      expect(rootCall?.path).toBe('/Users/emamabdullaziz/Desktop');
    });
  });
});