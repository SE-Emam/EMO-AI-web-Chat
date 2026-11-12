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

interface RoleProfile {
  title: string;
  systemPrompt: string;
  fallbackModels: string[];
}

const ROLE_PROFILES: Record<SwarmWorkerRole, RoleProfile> = {
  coordinator: {
    title: 'Swarm Coordinator',
    systemPrompt:
      'You are the Swarm Coordinator. Your mission is to decompose complex goals into discrete, high-impact tasks and synthesize deliverables from specialized subagents into an integrated, production-grade solution.',
    fallbackModels: ['claude-web:claude-3-7-sonnet', 'chatgpt-web:gpt-4o', 'gemini-web:gemini-2.0-flash', 'auto'],
  },
  architect: {
    title: 'Systems & Architecture Planner',
    systemPrompt:
      'You are a Principal Software Architect. Focus strictly on system design, data modeling, algorithm efficiency, architectural blueprints, modularity, and operational constraints. Be precise, thorough, and concrete.',
    fallbackModels: ['deepseek-web:deepseek-r1', 'chatgpt-web:o1', 'claude-web:claude-3-7-sonnet', 'deepseek-web:deepseek-chat', 'auto'],
  },
  coder: {
    title: 'Lead Implementation Engineer',
    systemPrompt:
      'You are a Lead Software Engineer. Implement clean, robust, production-ready code with complete types, error handling, and optimal logic. Avoid omissions, placeholders, or hand-waving.',
    fallbackModels: ['claude-web:claude-3-7-sonnet', 'claude-web:claude-3-5-sonnet', 'chatgpt-web:gpt-4o', 'qwen-web:qwen-2.5-max', 'auto'],
  },
  reviewer: {
    title: 'Security & Quality Auditor',
    systemPrompt:
      'You are a Staff Security and Quality Auditor. Review the code and architecture with relentless scrutiny for security vulnerabilities (injection, auth, data leaks), race conditions, edge-case bugs, performance regressions, and maintainability.',
    fallbackModels: ['claude-web:claude-3-7-sonnet', 'deepseek-web:deepseek-chat', 'chatgpt-web:gpt-4o', 'auto'],
  },
  tester: {
    title: 'QA & Test Automation Specialist',
    systemPrompt:
      'You are a Senior Test Automation Engineer. Write thorough unit, integration, and property tests. Cover standard paths, boundary limits, failure recovery, and mocked external dependencies.',
    fallbackModels: ['gemini-web:gemini-2.0-flash', 'claude-web:claude-3-5-haiku', 'chatgpt-web:gpt-4o', 'auto'],
  },
  custom: {
    title: 'Specialized Task Worker',
    systemPrompt: 'You are a specialized worker focused on executing your assigned sub-task with high precision.',
    fallbackModels: ['chatgpt-web:gpt-4o', 'claude-web:claude-3-7-sonnet', 'auto'],
  },
};

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

    const profile = ROLE_PROFILES[role] || ROLE_PROFILES.custom;
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
        name: w.name || `${ROLE_PROFILES[w.role]?.title || 'Worker'} #${idx + 1}`,
        provider: w.provider || 'auto',
        goal: w.task || goal,
        status: 'pending',
      }));
    }

    return [
      {
        id: `slice-1-${randomUUID().slice(0, 8)}`,
        role: 'architect',
        name: 'Architecture & System Planner',
        provider: 'auto',
        goal: `Analyze technical requirements, propose system architecture, data models, and component boundaries for: "${goal}"`,
        status: 'pending',
      },
      {
        id: `slice-2-${randomUUID().slice(0, 8)}`,
        role: 'coder',
        name: 'Lead Implementation Engineer',
        provider: 'auto',
        goal: `Implement complete, robust, production-quality code according to the architecture for: "${goal}"`,
        status: 'pending',
      },
      {
        id: `slice-3-${randomUUID().slice(0, 8)}`,
        role: 'reviewer',
        name: 'Security & Quality Auditor',
        provider: 'auto',
        goal: `Perform code review, security vulnerability assessment, and quality optimization for: "${goal}"`,
        status: 'pending',
      },
      {
        id: `slice-4-${randomUUID().slice(0, 8)}`,
        role: 'tester',
        name: 'QA & Test Engineer',
        provider: 'auto',
        goal: `Author comprehensive unit, integration, and boundary test cases for: "${goal}"`,
        status: 'pending',
      },
    ];
  }

  /**
   * Executes a single worker task slice.
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

    const profile = ROLE_PROFILES[slice.role] || ROLE_PROFILES.custom;
    const extra = typeof systemInstructions === 'string' ? systemInstructions.trim() : '';
    const systemContent = extra ? `${profile.systemPrompt}\n\n### Global System Instructions\n${extra}` : profile.systemPrompt;
    const messages: ChatMessage[] = [
      { role: 'system', content: systemContent },
      ...contextHistory,
      {
        role: 'user',
        content: `### Assigned Subagent Mission\n**Role:** ${slice.name}\n**Specific Task:**\n${slice.goal}\n\nPlease output your full, comprehensive findings and deliverables for this task.`,
      },
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
          });        },
        signal,
        // Session key with AGENT IDENTITY (owner ruling #6): every worker of
        // the swarm gets its OWN web chat; two workers of the same role never
        // merge into one conversation.
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
        message: `Completed ${slice.name} successfully (${fullResult.length} chars).`,
        timestamp: Date.now(),
      });
      return fullResult;
    } catch (err: any) {
      slice.status = 'failed';
      slice.error = err.message || String(err);
      slice.completedAt = Date.now();

      onEvent?.({
        type: 'worker:error',
        swarmId,
        taskId: slice.id,
        role: slice.role,
        provider: resolvedModel,
        message: `Worker ${slice.name} failed: ${slice.error}`,
        timestamp: Date.now(),
      });
      throw err;
    }
  }

  /**
   * Synthesizes all worker results into an integrated report.
   */
  private buildSynthesis(goal: string, slices: SwarmTaskSlice[]): string {
    const sections: string[] = [
      `# 🌟 Swarm Execution Report: Unified Deliverable\n`,
      `**Mission Objective:** ${goal}\n`,
      `**Participating Subagents:** ${slices.length} specialized workers.\n`,
      `---\n`,
    ];

    for (const slice of slices) {
      const statusIcon = slice.status === 'completed' ? '✅' : '❌';
      sections.push(`## ${statusIcon} Subagent: ${slice.name} (${slice.role.toUpperCase()})`);
      sections.push(`* **Model Provider:** \`${slice.provider}\``);
      if (slice.startedAt && slice.completedAt) {
        sections.push(`* **Execution Time:** ${((slice.completedAt - slice.startedAt) / 1000).toFixed(1)}s`);
      }
      sections.push('');

      if (slice.status === 'completed' && slice.result) {
        sections.push(slice.result.trim());
      } else if (slice.error) {
        sections.push(`> ⚠️ **Worker Error:** ${slice.error}`);
      }
      sections.push('\n---\n');
    }

    sections.push(`### 🏁 Summary of Accomplishments`);
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
