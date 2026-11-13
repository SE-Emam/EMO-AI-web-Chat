import { describe, it, expect, vi } from 'vitest';
import { SwarmCoordinator } from '../../src/server/swarm-coordinator.js';
import type { ArenaDriver, ChatMessage, SwarmEvent } from '../../src/types.js';

describe('SwarmCoordinator', () => {
  const createMockDriver = (): ArenaDriver => {
    return {
      listModels: vi.fn().mockResolvedValue([
        'claude-web:claude-3-7-sonnet',
        'chatgpt-web:gpt-4o',
        'deepseek-web:deepseek-r1',
        'gemini-web:gemini-2.0-flash',
      ]),
      sendMessage: vi.fn().mockImplementation(async (model: string, messages: ChatMessage[], onChunk?: (chunk: string) => void) => {
        const role = messages[0]?.content.includes('Architect')
          ? 'ARCHITECT'
          : messages[0]?.content.includes('Engineer')
          ? 'CODER'
          : messages[0]?.content.includes('Auditor')
          ? 'REVIEWER'
          : 'TESTER';

        const mockResponse = `### [${role} Deliverable on ${model}]\nTask analysis completed. Implementation and review ready.`;
        onChunk?.(mockResponse);
        return mockResponse;
      }),
    };
  };

  it('plans default task slices for a given goal', () => {
    const driver = createMockDriver();
    const coordinator = new SwarmCoordinator(driver);

    const slices = coordinator.planSlices('Build a secure JWT authentication middleware');
    expect(slices).toHaveLength(4);
    expect(slices.map((s) => s.role)).toEqual(['architect', 'coder', 'reviewer', 'tester']);
    expect(slices[0].goal).toContain('JWT authentication');
  });

  it('executes swarm in auto/pipeline mode with context handoff', async () => {
    const driver = createMockDriver();
    const coordinator = new SwarmCoordinator(driver);

    const events: SwarmEvent[] = [];
    const result = await coordinator.executeSwarm(
      {
        goal: 'Design and test a rate-limiter',
        mode: 'pipeline',
      },
      (e) => events.push(e)
    );

    expect(result.status).toBe('completed');
    expect(result.slices).toHaveLength(4);
    expect(result.synthesis).toContain('Swarm Execution Report: Unified Deliverable');
    expect(result.synthesis).toContain('ARCHITECT');
    expect(result.synthesis).toContain('CODER');
    expect(result.synthesis).toContain('REVIEWER');
    expect(result.synthesis).toContain('TESTER');

    // Check events emitted
    expect(events.some((e) => e.type === 'swarm:start')).toBe(true);
    expect(events.some((e) => e.type === 'worker:start')).toBe(true);
    expect(events.some((e) => e.type === 'worker:done')).toBe(true);
    expect(events.some((e) => e.type === 'swarm:synthesis')).toBe(true);
    expect(events.some((e) => e.type === 'swarm:done')).toBe(true);

    // Verify driver was called for each slice
    expect(driver.sendMessage).toHaveBeenCalledTimes(4);
  });

  it('executes swarm in parallel mode concurrently', async () => {
    const driver = createMockDriver();
    const coordinator = new SwarmCoordinator(driver);

    const result = await coordinator.executeSwarm({
      goal: 'Audit repository security',
      mode: 'parallel',
      workers: [
        { role: 'reviewer', provider: 'deepseek-web:deepseek-r1', task: 'Scan for SQLi' },
        { role: 'tester', provider: 'gemini-web:gemini-2.0-flash', task: 'Write fuzz tests' },
      ],
    });

    expect(result.status).toBe('completed');
    expect(result.slices).toHaveLength(2);
    expect(driver.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('executes as OpenAI-compatible chat completion streaming', async () => {
    const driver = createMockDriver();
    const coordinator = new SwarmCoordinator(driver);

    const chunks: string[] = [];
    const response = await coordinator.executeAsChatCompletion(
      {
        model: 'swarm:auto',
        messages: [{ role: 'user', content: 'Create a resilient cache' }],
        stream: true,
      },
      (chunk) => chunks.push(chunk)
    );

    expect(chunks.length).toBeGreaterThan(0);
    expect(response).toContain('Swarm Execution Report: Unified Deliverable');
    expect(chunks.some((c) => c.includes('Swarm Coordinator'))).toBe(true);
  });
});
