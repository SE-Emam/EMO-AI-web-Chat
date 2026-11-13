/**
 * P2 — Unsupported External Dependency Claims (TDD: failing first).
 *
 * Owner locked rules encoded here:
 *  - neutral instruction: announced tools are the complete toolset; the
 *    calling client provides the execution environment; never request an
 *    undeclared external component; never claim a connection problem no
 *    execution result confirmed. The wrong claim text and the external
 *    project name must NEVER appear in EMO instructions or corrections;
 *  - corrective policy: none → nothing; auto → plain text allowed, ONE
 *    neutral correction only when the model claims the execution
 *    environment is unavailable despite announced tools; required/specific
 *    → ONE neutral correction attempt before the protocol error; specific
 *    never accepts a different tool; max one attempt per request; never
 *    re-send an already-emitted tool call; never correct when real
 *    execution evidence (tool result / dispatcher transport failure) exists;
 *  - lifecycle states are derived from DISPATCHER EVIDENCE, never from the
 *    model's text alone;
 *  - history: unsupported assistant claims are identifiable ONLY when no
 *    real execution failure is proven; user messages, real tool calls,
 *    real results and real errors are never dropped or rewritten.
 *
 * Mock web model only — no real provider, no live messages.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Real RequestBroker semantics redirected to a throwaway store (the unknown
// -fate guarantee is proven against the REAL broker, not a mock).
vi.mock('../../src/protocol/request-broker.js', async (importOriginal) => {
  const actual: typeof import('../../src/protocol/request-broker.js') = await importOriginal();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emo-p2-broker-'));
  class RedirectedRequestBroker extends actual.RequestBroker {
    constructor(storePath?: string, lock?: any) {
      super(storePath ?? path.join(dir, 'request-broker.json'), lock);
    }
  }
  return { ...actual, RequestBroker: RedirectedRequestBroker };
});

import { createServer } from '../../src/server/app.js';
import type { ArenaDriver, Config, ChatMessage } from '../../src/types.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import {
  injectToolsInstruction,
  detectToolRefusal,
  detectUnsupportedDependencyClaim,
  shouldAttemptNeutralCorrection,
  buildNeutralCorrectionMessage,
  deriveToolLifecycleState,
  isUnsupportedAssistantClaim,
  resolveToolChoice,
  decideToolOutcome,
  parseToolCallsFromResponse,
} from '../../src/server/tool-interpreter.js';
import { ToolPipelineLogger } from '../../src/server/tool-pipeline-logger.js';
import { NEUTRAL_CORRECTION_MARKER, isNeutralCorrectionMessage, stripNeutralCorrections } from '../../src/arena/tool-bridge-markers.js';

const READ_TOOL = {
  type: 'function' as const,
  function: {
    name: 'read',
    description: 'Read a file',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
};

const TOOL_CALL_TEXT = '```tool_call\n{"name":"read","arguments":{"path":"package.json"}}\n```';
const CLAIM_TEXT = 'The connection to the local agent is inactive. Please restart the external tunnel component and I will retry reading the file.';
const PLAIN_REFUSAL = 'I cannot help with that.';

const config: Config = { ...DEFAULT_CONFIG };

// ---------------------------------------------------------------------------
// A. Instructions (§4 / §8)
// ---------------------------------------------------------------------------

describe('neutral tool instruction (P2)', () => {
  const msgs: ChatMessage[] = [{ role: 'user', content: 'Read package.json' }];
  const injected = injectToolsInstruction(msgs, [READ_TOOL], 'auto');
  const sys = injected.find((m) => m.role === 'system');
  const text = String(sys?.content ?? '');

  it('states the announced tools are the complete toolset and the calling client provides the execution environment', () => {
    expect(text).toMatch(/complete, currently available toolset/i);
    expect(text).toMatch(/calling client provides (their|the) execution environment/i);
  });

  it('forbids requesting undeclared external components and unconfirmed connection claims', () => {
    expect(text).toMatch(/do not ask the user to install, launch, or connect any external component/i);
    expect(text).toMatch(/do not claim a connection problem that no actual execution result has confirmed/i);
  });

  it('NEVER contains the external project name or the wrong refusal text', () => {
    expect(text.toLowerCase()).not.toContain('chat on steroids');
    expect(text.toLowerCase()).not.toContain('tunnel');
    expect(text).not.toContain('I cannot connect to OpenCode');
  });

  it('is not duplicated when injected twice (marker dedupe)', () => {
    const twice = injectToolsInstruction(injected, [READ_TOOL], 'auto');
    const sys2 = twice.find((m) => m.role === 'system');
    const t2 = String(sys2?.content ?? '');
    expect(t2.match(/### TOOL CALLING MODE \(MANDATORY/g)?.length ?? 0).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B. Claim detection (§6)
// ---------------------------------------------------------------------------

describe('detectUnsupportedDependencyClaim', () => {
  it('detects external-component requirements and execution-channel claims', () => {
    expect(detectUnsupportedDependencyClaim(CLAIM_TEXT).detected).toBe(true);
    expect(detectUnsupportedDependencyClaim('Please open the local client and reconnect the service.').detected).toBe(true);
    expect(detectUnsupportedDependencyClaim('The bridge connection is down; restart it.').detected).toBe(true);
  });

  it('does NOT flag plain refusals, ordinary answers, or real tool results', () => {
    expect(detectUnsupportedDependencyClaim(PLAIN_REFUSAL).detected).toBe(false);
    expect(isUnsupportedAssistantClaim({ role: 'assistant', content: 'Here is the file content: 42' }, { hasExecutionFailure: false })).toBe(false);
    expect(detectUnsupportedDependencyClaim('I could not read the file because it does not exist.').detected).toBe(false);
  });

  it('returns a safe fingerprint (hash), never the raw text', () => {
    const r = detectUnsupportedDependencyClaim(CLAIM_TEXT);
    expect(r.fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(r)).not.toContain('tunnel');
  });

  it('the pre-existing refusal detector still fires on its own known phrasing', () => {
    expect(detectToolRefusal('I cannot connect to OpenCode because the tunnel client is down.')).toBe(true);
    expect(detectToolRefusal(PLAIN_REFUSAL)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C. Corrective policy (§5)
// ---------------------------------------------------------------------------

describe('shouldAttemptNeutralCorrection (P2 policy)', () => {
  const auto = resolveToolChoice('auto', 1);
  const required = resolveToolChoice('required', 1);
  const claim = detectUnsupportedDependencyClaim(CLAIM_TEXT);
  const plainDecision = { emitToolCalls: false, cleanText: 'x', refusalDetected: false };
  const toolDecision = { emitToolCalls: true, toolCalls: [], cleanText: '', refusalDetected: false };

  it('auto + claim (no execution evidence) → exactly one neutral correction', () => {
    expect(shouldAttemptNeutralCorrection({
      resolution: auto, decision: plainDecision, claim, refusalDetected: false,
      hasToolResultEvidence: false, transportFailureObserved: false, alreadyAttempted: false,
    })).toBe(true);
    expect(shouldAttemptNeutralCorrection({
      resolution: auto, decision: plainDecision, claim, refusalDetected: false,
      hasToolResultEvidence: false, transportFailureObserved: false, alreadyAttempted: true,
    })).toBe(false); // max one per request
  });

  it('auto + plain answer (no claim) → NO correction (plain text allowed)', () => {
    expect(shouldAttemptNeutralCorrection({
      resolution: auto, decision: plainDecision,
      claim: { detected: false, category: 'none', fingerprint: '' },
      refusalDetected: false, hasToolResultEvidence: false, transportFailureObserved: false, alreadyAttempted: false,
    })).toBe(false);
  });

  it('required + refusal/claim → one correction before the protocol error', () => {
    expect(shouldAttemptNeutralCorrection({
      resolution: required, decision: { ...plainDecision, refusalDetected: true }, claim,
      refusalDetected: true, hasToolResultEvidence: false, transportFailureObserved: false, alreadyAttempted: false,
    })).toBe(true);
  });

  it('never corrects when real execution evidence exists (tool result / transport failure)', () => {
    expect(shouldAttemptNeutralCorrection({
      resolution: auto, decision: plainDecision, claim, refusalDetected: false,
      hasToolResultEvidence: true, transportFailureObserved: false, alreadyAttempted: false,
    })).toBe(false);
    expect(shouldAttemptNeutralCorrection({
      resolution: auto, decision: plainDecision, claim, refusalDetected: false,
      hasToolResultEvidence: false, transportFailureObserved: true, alreadyAttempted: false,
    })).toBe(false);
  });

  it('never re-sends an already-emitted tool call', () => {
    expect(shouldAttemptNeutralCorrection({
      resolution: required, decision: toolDecision, claim, refusalDetected: false,
      hasToolResultEvidence: false, transportFailureObserved: false, alreadyAttempted: false,
    })).toBe(false);
  });

  it('neutral correction message is neutral: no external project name, no wrong claim repetition', () => {
    const nudge = buildNeutralCorrectionMessage();
    expect(nudge.toLowerCase()).not.toContain('tunnel');
    expect(nudge.toLowerCase()).not.toContain('reconnect');
    expect(nudge.toLowerCase()).not.toContain('chat on steroids');
    expect(nudge).toMatch(/announced tools/i);
    expect(nudge).toMatch(/```tool_call/);
  });
});

// ---------------------------------------------------------------------------
// D. Lifecycle states from dispatcher evidence (§6)
// ---------------------------------------------------------------------------

describe('deriveToolLifecycleState (P2)', () => {
  const auto = resolveToolChoice('auto', 1);
  const parsed = parseToolCallsFromResponse(TOOL_CALL_TEXT);
  const noCall = parseToolCallsFromResponse('plain');

  it('tools announced + no call + model claim, no dispatcher evidence → MODEL_DID_NOT_EMIT_TOOL_CALL (claim unproven)', () => {
    const s = deriveToolLifecycleState({
      toolsAnnounced: true, parsed: noCall, resolution: auto,
      transportFailureObserved: false, dispatchObserved: false,
      executionConfirmed: false, executionFailed: false, resultReceived: false,
      modelClaimDetected: true,
    });
    expect(s.state).toBe('MODEL_DID_NOT_EMIT_TOOL_CALL');
    expect(s.claimUnproven).toBe(true);
    expect(s.transportFailureConfirmed).toBe(false);
  });

  it('dispatcher-confirmed transport failure → TRANSPORT_FAILURE_CONFIRMED (kept as real)', () => {
    const s = deriveToolLifecycleState({
      toolsAnnounced: true, parsed: noCall, resolution: auto,
      transportFailureObserved: true, dispatchObserved: false,
      executionConfirmed: false, executionFailed: false, resultReceived: false,
    });
    expect(s.state).toBe('TRANSPORT_FAILURE_CONFIRMED');
    expect(s.transportFailureConfirmed).toBe(true);
  });

  it('parsed → dispatch → confirmed → result received progression', () => {
    const base = { toolsAnnounced: true, parsed, resolution: auto, transportFailureObserved: false, modelClaimDetected: false };
    expect(deriveToolLifecycleState({ ...base, dispatchObserved: false }).state).toBe('TOOL_CALL_PARSED');
    expect(deriveToolLifecycleState({ ...base, dispatchObserved: true }).state).toBe('TOOL_DISPATCH_STARTED');
    expect(deriveToolLifecycleState({ ...base, dispatchObserved: true, executionConfirmed: true }).state).toBe('TOOL_EXECUTION_CONFIRMED');
    expect(deriveToolLifecycleState({ ...base, dispatchObserved: true, executionConfirmed: true, resultReceived: true }).state).toBe('TOOL_RESULT_RECEIVED');
    expect(deriveToolLifecycleState({ ...base, dispatchObserved: true, executionFailed: true }).state).toBe('TOOL_EXECUTION_FAILED');
  });
});

// ---------------------------------------------------------------------------
// E. History handling (§7) — pure, conservative
// ---------------------------------------------------------------------------

describe('isUnsupportedAssistantClaim (P2 history policy)', () => {
  it('flags an assistant claim only when no real execution failure is proven', () => {
    const msg: ChatMessage = { role: 'assistant', content: CLAIM_TEXT };
    expect(isUnsupportedAssistantClaim(msg, { hasExecutionFailure: false })).toBe(true);
    expect(isUnsupportedAssistantClaim(msg, { hasExecutionFailure: true })).toBe(false);
  });

  it('never flags user messages, tool results, or security refusals', () => {
    expect(isUnsupportedAssistantClaim({ role: 'user', content: CLAIM_TEXT }, { hasExecutionFailure: false })).toBe(false);
    expect(isUnsupportedAssistantClaim({ role: 'tool', tool_call_id: 'c1', content: 'real output' }, { hasExecutionFailure: false })).toBe(false);
    expect(isUnsupportedAssistantClaim({ role: 'assistant', content: PLAIN_REFUSAL }, { hasExecutionFailure: false })).toBe(false);
  });

  it('is pure: never mutates the input message', () => {
    const msg: ChatMessage = { role: 'assistant', content: CLAIM_TEXT };
    const snapshot = JSON.stringify(msg);
    isUnsupportedAssistantClaim(msg, { hasExecutionFailure: false });
    expect(JSON.stringify(msg)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// H. Concurrency + idempotency (§8)
// ---------------------------------------------------------------------------

describe('P2 concurrency + idempotency', () => {
  let driverCalls = 0;
  let replies: string[] = [];

  const makeDriver = (): ArenaDriver => ({
    listModels: async () => ['web-model'],
    sendMessage: async () => {
      driverCalls += 1;
      return replies.shift() ?? 'done';
    },
  });

  const post = (app: any, sessionId: string, requestId?: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'x-chat-session-id': sessionId, ...(requestId ? { 'x-request-id': requestId } : {}) },
      payload: {
        model: 'web-model',
        messages: [{ role: 'user', content: 'Read package.json using the read tool.' }],
        tools: [READ_TOOL],
      },
    });

  beforeEach(() => {
    driverCalls = 0;
    replies = [];
  });

  it('two SEPARATE sessions each get their own single correction (no cross-talk)', async () => {
    replies = [CLAIM_TEXT, TOOL_CALL_TEXT, CLAIM_TEXT, TOOL_CALL_TEXT];
    const app = createServer(makeDriver(), config);
    await post(app, 'sess-A');
    await post(app, 'sess-B');
    expect(driverCalls).toBe(4); // 2 per request, never more
  });

  it('two CONCURRENT requests each get at most one correction', async () => {
    replies = [CLAIM_TEXT, TOOL_CALL_TEXT, CLAIM_TEXT, TOOL_CALL_TEXT];
    const app = createServer(makeDriver(), config);
    const [a, b] = await Promise.all([post(app, 'sess-C'), post(app, 'sess-D')]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(driverCalls).toBe(4);
  });

  it('unknown-fate failure (after send) → the SAME X-Request-Id is NOT blindly re-sent', async () => {
    const failing: ArenaDriver = {
      listModels: async () => ['web-model'],
      sendMessage: async () => {
        throw new Error('network dropped after the message was sent');
      },
    };
    const app = createServer(failing, config);
    const first = await post(app, 'sess-E', 'req-p2-1');
    expect(first.statusCode).toBeGreaterThanOrEqual(500);
    const second = await post(app, 'sess-E', 'req-p2-1');
    // The broker refuses a blind replay of an unconfirmed request.
    expect(second.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// E2. Correction channel: marker + stored-history alignment (§5 / §7)
// ---------------------------------------------------------------------------

describe('neutral correction channel (P2)', () => {
  it('the correction message carries the shared marker', () => {
    expect(buildNeutralCorrectionMessage()).toContain(NEUTRAL_CORRECTION_MARKER);
  });

  it('the marker identifies ONLY EMO corrections — user messages and tool results are untouched', () => {
    expect(isNeutralCorrectionMessage({ role: 'user', content: buildNeutralCorrectionMessage() })).toBe(true);
    expect(isNeutralCorrectionMessage({ role: 'user', content: 'Read package.json' })).toBe(false);
    expect(isNeutralCorrectionMessage({ role: 'tool', content: 'FILE CONTENT' })).toBe(false);
    expect(isNeutralCorrectionMessage({ role: 'assistant', content: buildNeutralCorrectionMessage() })).toBe(false);
  });

  it('stripping corrections keeps every client message (user/tool call/tool result)', () => {
    const history = [
      { role: 'user', content: 'Read package.json' },
      { role: 'assistant', content: '' },
      { role: 'user', content: buildNeutralCorrectionMessage() },
      { role: 'tool', content: 'FILE CONTENT' },
    ];
    const stripped = stripNeutralCorrections(history);
    expect(stripped.length).toBe(3);
    expect(stripped.some((m) => m.role === 'tool')).toBe(true);
    expect(stripped[0].content).toBe('Read package.json');
    expect(stripped.some((m) => String(m.content).includes(NEUTRAL_CORRECTION_MARKER))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F. Structured events (§11)
// ---------------------------------------------------------------------------

describe('ToolPipelineLogger (P2 events)', () => {
  it('emits the new events with correlationId and safe claim payloads', () => {
    const events: Array<Record<string, unknown>> = [];
    const log = new ToolPipelineLogger('corr-1', (e) => events.push({ ...e }));
    log.toolAvailableInRequest(1);
    log.unsupportedDependencyClaimDetected('abc123', 'external_component_required');
    log.neutralCorrectionAttempted('claim_detected');
    log.transportFailureConfirmed('driver_timeout');
    const names = events.map((e) => e.event);
    expect(names).toEqual([
      'tool_available_in_request',
      'unsupported_dependency_claim_detected',
      'neutral_correction_attempted',
      'transport_failure_confirmed',
    ]);
    for (const e of events) expect(e.correlationId).toBe('corr-1');
    const claimEvt = events[1] as { fingerprint?: string; category?: string };
    expect(claimEvt.fingerprint).toBe('abc123');
    expect(claimEvt.category).toBe('external_component_required');
  });
});

// ---------------------------------------------------------------------------
// G. Route-level policy over HTTP with a scripted mock web model
// ---------------------------------------------------------------------------

describe('OpenAI route — corrective policy (P2, mock web model)', () => {
  let driverReplies: string[] = [];
  let driverCalls = 0;
  let lastMessages: ChatMessage[] = [];

  const makeDriver = (): ArenaDriver => ({
    listModels: async () => ['web-model'],
    sendMessage: async (_m: string, messages: ChatMessage[]) => {
      driverCalls += 1;
      lastMessages = messages;
      return driverReplies.shift() ?? 'done';
    },
  });

  beforeEach(() => {
    driverReplies = [];
    driverCalls = 0;
    lastMessages = [];
  });

  const post = (app: any, extra: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'web-model',
        messages: [{ role: 'user', content: 'Read package.json using the read tool.' }],
        tools: [READ_TOOL],
        ...extra,
      },
    });

  it('auto + claim → ONE neutral correction, then the tool call is emitted (driver called twice)', async () => {
    driverReplies = [CLAIM_TEXT, TOOL_CALL_TEXT];
    const app = createServer(makeDriver(), config);
    const res = await post(app);
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.choices[0].finish_reason).toBe('tool_calls');
    expect(data.choices[0].message.tool_calls[0].function.name).toBe('read');
    expect(driverCalls).toBe(2);
    // The correction is a neutral user message — no wrong claim repetition.
    const nudge = lastMessages.filter((m) => m.role === 'user' && String(m.content).includes('announced tools'));
    expect(nudge.length).toBe(1);
    expect(String(nudge[0].content).toLowerCase()).not.toContain('tunnel');
  });

  it('auto + claim + still refuses → exactly one correction, then plain text (no second retry)', async () => {
    driverReplies = [CLAIM_TEXT, CLAIM_TEXT];
    const app = createServer(makeDriver(), config);
    const res = await post(app);
    expect(res.statusCode).toBe(200);
    expect(driverCalls).toBe(2); // never a third call
    const data = JSON.parse(res.body);
    expect(data.choices[0].message.tool_calls).toBeUndefined();
  });

  it('auto + plain answer (no claim) → NO correction (driver called once)', async () => {
    driverReplies = ['Here is a plain answer.'];
    const app = createServer(makeDriver(), config);
    const res = await post(app);
    expect(res.statusCode).toBe(200);
    expect(driverCalls).toBe(1);
  });

  it('required + claim → one correction, then protocol error if still no tool call (never success)', async () => {
    driverReplies = [CLAIM_TEXT, CLAIM_TEXT];
    const app = createServer(makeDriver(), config);
    const res = await post(app, { tool_choice: 'required' });
    expect(res.statusCode).toBe(400);
    expect(driverCalls).toBe(2);
    const data = JSON.parse(res.body);
    expect(data.error.type).toBe('tool_call_required_but_missing');
    expect(res.body).not.toContain('tunnel');
  });

  it('required + claim → correction succeeds → tool call emitted (not an error)', async () => {
    driverReplies = [CLAIM_TEXT, TOOL_CALL_TEXT];
    const app = createServer(makeDriver(), config);
    const res = await post(app, { tool_choice: 'required' });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.choices[0].finish_reason).toBe('tool_calls');
  });

  it('specific tool + correction yields a DIFFERENT tool → protocol error specific_tool_not_called', async () => {
    driverReplies = [CLAIM_TEXT, '```tool_call\n{"name":"shell","arguments":{"command":"ls"}}\n```'];
    const app = createServer(makeDriver(), config);
    const res = await post(app, { tool_choice: { type: 'function', function: { name: 'read' } } });
    expect(res.statusCode).toBe(400);
    const data = JSON.parse(res.body);
    expect(data.error.type).toBe('specific_tool_not_called');
  });

  it('tool result evidence present → NO correction even when the model claims a channel problem', async () => {
    driverReplies = [CLAIM_TEXT];
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
        tools: [READ_TOOL],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(driverCalls).toBe(1); // real execution evidence → no corrective retry
  });

  it('the correction request keeps the assistant turn (prefix alignment) and adds ONE neutral user message', async () => {
    driverReplies = [CLAIM_TEXT, TOOL_CALL_TEXT];
    const app = createServer(makeDriver(), config);
    await post(app);
    const assistants = lastMessages.filter((m) => m.role === 'assistant');
    expect(assistants.length).toBe(1);
    expect(String(assistants[0].content)).toContain('external'); // the model's own reply (never re-sent as a prompt)
    const corrections = lastMessages.filter((m) => m.role === 'user' && String(m.content).includes(NEUTRAL_CORRECTION_MARKER));
    expect(corrections.length).toBe(1);
    // The correction is recognised as an EMO-issued message (excluded from
    // the stored client history so the next client turn still continues).
    expect(isNeutralCorrectionMessage(corrections[0])).toBe(true);
  });

  it('emitted tool call is never re-sent (driver called once when the first reply already has a call)', async () => {
    driverReplies = [TOOL_CALL_TEXT];
    const app = createServer(makeDriver(), config);
    const res = await post(app);
    expect(res.statusCode).toBe(200);
    expect(driverCalls).toBe(1);
  });
});
