import { describe, it, expect } from 'vitest';
import { buildEnvironmentBlock, buildContinuationBlock } from '../../src/gateway/agent-instructions.js';
import {
  buildCorrectionMessage,
  buildHintSection,
  buildToolCallBlock,
  extractAnnouncedTools,
} from '../../src/gateway/agent-tool-bridge.js';
import { injectToolsInstruction } from '../../src/server/tool-interpreter.js';
import type { ChatMessage } from '../../src/types.js';

/**
 * The instruction text the gateway adds to a request is read by a WEB model
 * that has its own safety checks. The rule copied from "chat-on-steroids":
 * every line states what IS — a rule about how the model should judge is
 * not a fact, and a model told how to judge answers with a refusal instead
 * of a tool call. These are the same denylists CoS keeps in its own test
 * suite (test/mcp-user-instructions.test.ts).
 */
const RULE_VOCABULARY =
  /never hallucinate a block|retry the identical call|keep using enabled tools|you can always use|not permission\./i;
const SELF_RANKING_VOCABULARY =
  /authority|guards? decide|under current guards|polic(y|ies)|\btrusted\b|succeeds when made again|changes no tool permission/i;

describe('the gateway instruction text states facts only', () => {
  const msgs: ChatMessage[] = injectToolsInstruction(
    [{ role: 'user', content: 'read /tmp/x' }],
    [
      { type: 'function', function: { name: 'read', description: 'Read a file', parameters: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'] } } },
    ] as any,
    'auto'
  ) as ChatMessage[];
  const tools = extractAnnouncedTools(msgs);
  const call = buildToolCallBlock('read', 'filePath', '/tmp/x');

  const blocks = [
    ['environment', buildEnvironmentBlock(tools, ['/Users/me/Desktop'])],
    ['continuation', buildContinuationBlock()],
    ['hint', buildHintSection(call)],
    ['correction', buildCorrectionMessage(call, tools)],
  ] as const;

  for (const [name, text] of blocks) {
    it(`the ${name} block carries no rule about how to judge`, () => {
      expect(text).not.toMatch(RULE_VOCABULARY);
      expect(text).not.toMatch(SELF_RANKING_VOCABULARY);
    });
  }

  it('the environment block names the approved folders and the tools', () => {
    const text = buildEnvironmentBlock(tools, ['/Users/me/Desktop']);
    expect(text).toContain('/Users/me/Desktop');
    expect(text).toContain('read(filePath)');
    expect(text).toContain('runs the tools on this machine');
  });

  it('the environment block says so when nothing is approved', () => {
    expect(buildEnvironmentBlock(tools, [])).toContain('No folder is approved');
  });

  it('the continuation block presents the result as the client output', () => {
    const text = buildContinuationBlock({ call: 'list({"path":"/tmp/x"})', result: 'README.md' });
    expect(text).toContain('list({"path":"/tmp/x"})');
    expect(text).toContain('README.md');
    expect(text).toContain('the real result, not a claim about one');
    expect(text).toContain('the block at the end of this message');
  });
});
