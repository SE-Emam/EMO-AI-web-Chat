import { randomUUID } from 'node:crypto';
import type {
  ArenaDriver,
  ChatMessage,
  ChatCompletionRequest,
  SwarmEvent,
  SwarmRequest,
  SwarmResult,
  SwarmTaskSlice,
  SwarmWorkerConfig,
  SwarmWorkerRole,
} from '../types.js';
import {
  SWARM_ROLE_PROFILES,
  formatRolePrompt,
  type SwarmRoleProfile,
} from './swarm-roles.js';

export class SwarmCoordinator {
  private readonly driver: ArenaDriver;
  private readonly sessions = new Map<string, SwarmResult>();

  constructor(driver: ArenaDriver) {
    this.driver = driver;
  }

  /**
   * Return recent swarm sessions.
   */
  listSessions(): SwarmResult[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.durationMs - a.durationMs);
  }

  getSession(id: string): SwarmResult | undefined {
    return this.sessions.get(id);
  }

  /**
   * Returns all available swarm subagent role definitions, system instructions, and skills.
   */
  listRoles(): SwarmRoleProfile[] {
    return Object.values(SWARM_ROLE_PROFILES);
  }

  /**
   * Returns profile definition for a specific role.
   */
  getRole(role: SwarmWorkerRole): SwarmRoleProfile {
    return SWARM_ROLE_PROFILES[role] || SWARM_ROLE_PROFILES.custom;
  }

  /**
   * Resolves the best available model for a given worker role.
   */
  private async resolveModelForRole(role: SwarmWorkerRole, preferred?: string): Promise<string> {
    if (preferred && preferred.trim() && preferred !== 'auto') {
      return preferred.trim();
    }

    let availableModels: string[] = [];
    try {
      availableModels = await this.driver.listModels();
    } catch {
      availableModels = [];
    }

    const profile = SWARM_ROLE_PROFILES[role] || SWARM_ROLE_PROFILES.custom;
    for (const candidate of profile.fallbackModels) {
      if (candidate === 'auto') break;
      if (availableModels.includes(candidate)) {
        return candidate;
      }
      // The gateway exposes plain model names (e.g. "claude-3-7-sonnet"), while
      // fallback candidates may carry a provider prefix — match on the bare name.
      const bare = candidate.includes(':') ? candidate.slice(candidate.indexOf(':') + 1) : candidate;
      const matched = availableModels.find((m) => m.toLowerCase() === bare.toLowerCase())
        || availableModels.find((m) => m.toLowerCase().startsWith(bare.toLowerCase()));
      if (matched) return matched;
    }

    // Default to the first available model, or 'auto'
    return availableModels[0] || 'auto';
  }

  /**
   * Default plan generation: constructs default role slices for the user's goal.
   */
  planSlices(goal: string, customWorkers?: SwarmWorkerConfig[]): SwarmTaskSlice[] {
    if (customWorkers && customWorkers.length > 0) {
      return customWorkers.map((w, idx) => ({
        id: `slice-${idx + 1}-${randomUUID().slice(0, 8)}`,
        role: w.role,
        name: w.name || `${SWARM_ROLE_PROFILES[w.role]?.title || 'Worker'} #${idx + 1}`,
        provider: w.provider || 'auto',
        goal: w.task || goal,
        status: 'pending',
      }));
    }

    return [
      {
        id: `slice-1-${randomUUID().slice(0, 8)}`,
        role: 'architect',
        name: SWARM_ROLE_PROFILES.architect.title,
        provider: 'auto',
        goal: `Analyze architecture, formulate data schemas, define system boundaries, and identify constraints for: "${goal}"`,
        status: 'pending',
      },
      {
        id: `slice-2-${randomUUID().slice(0, 8)}`,
        role: 'coder',
        name: SWARM_ROLE_PROFILES.coder.title,
        provider: 'auto',
        goal: `Implement complete, robust, production-grade code adhering strictly to the architecture for: "${goal}"`,
        status: 'pending',
      },
      {
        id: `slice-3-${randomUUID().slice(0, 8)}`,
        role: 'reviewer',
        name: SWARM_ROLE_PROFILES.reviewer.title,
        provider: 'auto',
        goal: `Perform a comprehensive security, vulnerability, race-condition, and code quality audit for: "${goal}"`,
        status: 'pending',
      },
      {
        id: `slice-4-${randomUUID().slice(0, 8)}`,
        role: 'tester',
        name: SWARM_ROLE_PROFILES.tester.title,
        provider: 'auto',
        goal: `Author comprehensive unit, integration, and boundary test cases for: "${goal}"`,
        status: 'pending',
      },
    ];
  }

  /**
   * Executes a single worker task slice with comprehensive role instructions and skills.
   */
  private async executeSlice(
    slice: SwarmTaskSlice,
    contextHistory: ChatMessage[],
    swarmId: string,
    onEvent?: (event: SwarmEvent) => void,
    signal?: AbortSignal,
    systemInstructions?: string
  ): Promise<string> {
    slice.status = 'running';
    slice.startedAt = Date.now();

    const resolvedModel = await this.resolveModelForRole(slice.role, slice.provider);
    slice.provider = resolvedModel;

    onEvent?.({
      type: 'worker:start',
      swarmId,
      taskId: slice.id,
      role: slice.role,
      provider: resolvedModel,
      message: `Starting ${slice.name} on model [${resolvedModel}]...`,
      timestamp: Date.now(),
    });

    const { systemPrompt, userPrompt } = formatRolePrompt({
      role: slice.role,
      taskGoal: slice.goal,
      workerName: slice.name,
      globalSystemInstructions: systemInstructions,
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...contextHistory,
      { role: 'user', content: userPrompt },
    ];

    let fullResult = '';
    try {
      fullResult = await this.driver.sendMessage(
        resolvedModel,
        messages,
        (chunk: string) => {
          fullResult += chunk;
          onEvent?.({
            type: 'worker:chunk',
            swarmId,
            taskId: slice.id,
            role: slice.role,
            provider: resolvedModel,
            chunk,
            timestamp: Date.now(),
          });
        },
        signal,
        // Session key with AGENT IDENTITY: every worker of the swarm gets its OWN web chat;
        // two workers of the same role never merge into one conversation.
        `swarm-${swarmId}-${slice.role}-${slice.id}`
      );

      slice.status = 'completed';
      slice.result = fullResult;
      slice.completedAt = Date.now();

      onEvent?.({
        type: 'worker:done',
        swarmId,
        taskId: slice.id,
        role: slice.role,
        provider: resolvedModel,
        message: `${slice.name} completed successfully (${((Date.now() - slice.startedAt) / 1000).toFixed(1)}s)`,
        timestamp: Date.now(),
      });

      return fullResult;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      slice.status = 'failed';
      slice.error = errorMsg;
      slice.completedAt = Date.now();

      onEvent?.({
        type: 'worker:error',
        swarmId,
        taskId: slice.id,
        role: slice.role,
        provider: resolvedModel,
        message: `${slice.name} failed: ${errorMsg}`,
        timestamp: Date.now(),
      });

      throw err;
    }
  }

  /**
   * Synthesizes all completed subagent deliverables into a final unified result.
   */
  private buildSynthesis(goal: string, slices: SwarmTaskSlice[]): string {
    const sections: string[] = [];
    sections.push(`# Autonomous Swarm Synthesis Report`);
    sections.push(`**Goal:** ${goal}`);
    sections.push(`**Completed Subagents:** ${slices.filter((s) => s.status === 'completed').length} / ${slices.length}\n`);

    for (const slice of slices) {
      sections.push(`---\n## Subagent Deliverable: ${slice.name} [@${slice.role.toUpperCase()}]`);
      sections.push(`**Assigned Model:** \`${slice.provider}\` | **Status:** ${slice.status.toUpperCase()}`);
      if (slice.result) {
        sections.push(`\n${slice.result.trim()}`);
      } else if (slice.error) {
        sections.push(`\n> ⚠️ **Worker Execution Failed:** ${slice.error}`);
      }
      sections.push('');
    }

    sections.push(`---\n## Executive Summary of Accomplishments`);
    sections.push(`All specialized subagents completed their assignments in parallel orchestration.`);
    return sections.join('\n');
  }

  /**
   * Runs the full swarm orchestration.
   */
  async executeSwarm(
    request: SwarmRequest,
    onEvent?: (event: SwarmEvent) => void,
    signal?: AbortSignal
  ): Promise<SwarmResult> {
    const swarmId = `swarm-${randomUUID()}`;
    const t0 = Date.now();
    const mode = request.mode || 'auto';
    const slices = this.planSlices(request.goal, request.workers);
    const systemInstructions = typeof (request as any).systemInstructions === 'string' ? String((request as any).systemInstructions).trim() : '';

    onEvent?.({
      type: 'swarm:start',
      swarmId,
      message: `Swarm Coordinator initialized with ${slices.length} subagents in [${mode}] mode.`,
      timestamp: Date.now(),
    });

    if (mode === 'parallel') {
      // Execute all workers concurrently
      await Promise.allSettled(
        slices.map((slice) => this.executeSlice(slice, [], swarmId, onEvent, signal, systemInstructions))
      );
    } else {
      // Pipeline / Auto mode:
      // 1. Architect runs first
      const architectSlice = slices.find((s) => s.role === 'architect') || slices[0];
      let architectOutput = '';
      if (architectSlice) {
        try {
          architectOutput = await this.executeSlice(architectSlice, [], swarmId, onEvent, signal, systemInstructions);
        } catch {}
      }

      // 2. Coder runs with Architect's context
      const coderSlice = slices.find((s) => s.role === 'coder');
      let coderOutput = '';
      if (coderSlice) {
        const coderContext: ChatMessage[] = architectOutput
          ? [{ role: 'assistant', content: `[Architect Blueprint]:\n${architectOutput}` }]
          : [];
        try {
          coderOutput = await this.executeSlice(coderSlice, coderContext, swarmId, onEvent, signal, systemInstructions);
        } catch {}
      }

      // 3. Reviewer and Tester run in parallel with Code & Architecture context
      const remainingSlices = slices.filter((s) => s.id !== architectSlice?.id && s.id !== coderSlice?.id);
      const sharedContext: ChatMessage[] = [];
      if (architectOutput) sharedContext.push({ role: 'assistant', content: `[Architect Blueprint]:\n${architectOutput}` });
      if (coderOutput) sharedContext.push({ role: 'assistant', content: `[Implementation Code]:\n${coderOutput}` });

      await Promise.allSettled(
        remainingSlices.map((slice) => this.executeSlice(slice, sharedContext, swarmId, onEvent, signal, systemInstructions))
      );
    }

    const synthesis = this.buildSynthesis(request.goal, slices);
    const hasFailures = slices.some((s) => s.status === 'failed');
    const allFailed = slices.every((s) => s.status === 'failed');

    const result: SwarmResult = {
      id: swarmId,
      goal: request.goal,
      mode,
      status: allFailed ? 'failed' : hasFailures ? 'partial' : 'completed',
      slices,
      synthesis,
      durationMs: Date.now() - t0,
    };

    this.sessions.set(swarmId, result);

    onEvent?.({
      type: 'swarm:synthesis',
      swarmId,
      message: synthesis,
      timestamp: Date.now(),
    });

    onEvent?.({
      type: 'swarm:done',
      swarmId,
      message: `Swarm session finished in ${(result.durationMs / 1000).toFixed(1)}s with status: ${result.status}`,
      timestamp: Date.now(),
    });

    return result;
  }

  /**
   * Adapts the swarm orchestration into an OpenAI-compatible Chat Completion interface.
   */
  async executeAsChatCompletion(
    request: ChatCompletionRequest,
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const userPrompt = request.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n\n') || 'Autonomous Multi-Agent Task';

    let mode: 'pipeline' | 'parallel' | 'auto' = 'auto';
    const m = (request.model || '').toLowerCase();
    if (m.includes('parallel')) mode = 'parallel';
    if (m.includes('pipeline')) mode = 'pipeline';

    let accumulatedStream = '';

    const emitChunk = (text: string) => {
      accumulatedStream += text;
      onChunk?.(text);
    };

    emitChunk(`🚀 **[Swarm Coordinator]** Starting autonomous multi-agent swarm...\n\n`);

    const result = await this.executeSwarm(
      {
        goal: userPrompt,
        mode,
        stream: !!request.stream,
      },
      (event: SwarmEvent) => {
        if (event.type === 'worker:start') {
          emitChunk(`\n🤖 **Subagent [${event.role?.toUpperCase()} | ${event.provider}]**: ${event.message}\n`);
        } else if (event.type === 'worker:chunk' && event.chunk) {
          emitChunk(event.chunk);
        } else if (event.type === 'worker:done') {
          emitChunk(`\n✨ **${event.message}**\n\n`);
        }
      },
      signal
    );

    emitChunk(`\n\n${result.synthesis}`);
    return result.synthesis;
  }
}
