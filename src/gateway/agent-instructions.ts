/**
 * The environment facts the web model needs.
 *
 * Rule taken from "chat-on-steroids" and applied here: every line states
 * what IS, never how the model should judge it. A line that tells the model
 * how to behave ("never refuse", "do not claim") is not a fact — and a web
 * model that is told how to judge answers with a refusal instead of a call.
 * The facts are the approved folders, the announced tools and who executes
 * them.
 */
import type { AnnouncedTool } from './agent-tool-bridge.js';

/** One short line per tool: what it does, in the model's own words. */
function toolLine(tool: AnnouncedTool): string {
  const props = Object.keys(tool.parameters?.properties || {});
  const required = (tool.parameters?.required || []).map(String);
  const arg = required[0] || props[0];
  const desc = (tool.description || '').split('\n')[0].replace(/\s+/g, ' ').slice(0, 120);
  return `- ${tool.name}${arg ? `(${arg})` : ''}: ${desc || 'a local tool'}`;
}

/**
 * The environment block: the approved folders, the tools of THIS request,
 * and the fact that the client runs them.
 */
export function buildEnvironmentBlock(tools: AnnouncedTool[], roots: string[]): string {
  const folders = (roots || []).filter((r) => typeof r === 'string' && r.trim().length > 0);
  const lines = [
    '# Local environment',
    folders.length
      ? `Approved folders: ${folders.join(', ')}. A path outside them is not part of the workspace.`
      : 'No folder is approved for this request.',
    'The client runs the tools on this machine and returns the real result. A tool runs only when it is requested.',
    'The tools of this request:',
    ...tools.slice(0, 14).map(toolLine),
    'A tool error names the reason it failed.',
  ];
  return lines.join('\n');
}

/**
 * The block for the turn that carries a tool result.
 *
 * The result is the client's own output — it is labelled as such, because a
 * result that is not labelled is read as untrusted text (chat-on-steroids,
 * #1231). The call that produced it and its output are repeated next to
 * the next call, because a model that has to stitch the story together
 * from four separate places narrates the failure instead of acting.
 */
export function buildContinuationBlock(opts: { call?: string; result?: string } = {}): string {
  const lines = ['# Tool result'];
  if (opts.call) lines.push(`The call before this one was: ${opts.call}`);
  lines.push('Its output on this machine was:');
  if (opts.result) {
    const trimmed = opts.result.length > 600 ? `${opts.result.slice(0, 600)}\n[…]` : opts.result;
    lines.push(trimmed);
  }
  lines.push(
    'That output is the real result, not a claim about one.',
    'Continue the task from it. The next call for this task is the block at the end of this message, and nothing else.',
  );
  return lines.join('\n');
}
