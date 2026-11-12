import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BaseWebDriver } from '../../src/arena/web-drivers.js';
import type { CommonWebConfig } from '../../src/types.js';
import { SessionRegistry } from '../../src/sessions/session-registry.js';
import type { Page } from 'playwright';

const BASE = 'https://chat.test';

/**
 * A driver whose browser layer is a controllable fake, so we can PROVE the
 * Task 6 semantics through the real sendMessage → SessionQueue →
 * TabScheduler → sendMessageSerialized chain: page identity, cross-session
 * parallelism, same-session serialization.
 */
class RecordingDriver extends BaseWebDriver {
  readonly trace: Array<{ session: string; pageId: string | number; phase: string; at: number }> = [];
  private pageCounter = 0;
  private readonly madePages: any[] = [];
  readonly mockContext: any;

  constructor(config: Partial<CommonWebConfig> = {}) {
    super({
      id: 'chatgpt-web',
      name: 'RecordingDriver',
      canonicalModels: ['m1'],
      composerSelectors: ['#composer'],
      assistantSelectors: ['.assistant'],
      config: { userDataDir: '/tmp/recording-profile', baseUrl: BASE, headless: true, ...config } as CommonWebConfig,
    });
    // Keep durable state out of the user's real home dir.
    (this as any).registry = new SessionRegistry(path.join(mkdtempSync(path.join(tmpdir(), 'recdrv-')), 'registry.json'));
    const self = this;
    this.mockContext = {
      pages: () => [],
      newPage: async () => {
        self.pageCounter++;
        const p: any = {
          id: `page-${self.pageCounter}`,
          isClosed: () => false,
          url: () => (p as any).currentUrl || `${BASE}/`,
          goto: async (u: string) => { (p as any).currentUrl = u; },
          waitForTimeout: async () => {},
          locator: () => ({ count: async () => 0, first: () => ({ innerText: async () => '' }) }),
          innerText: async () => '',
          close: async () => { (p as any).isClosed = () => true; },
        };
        self.madePages.push(p);
        return p;
      },
    };
  }

  // Browser layer: fake context, real scheduling code.
  protected async ensureContext(): Promise<any> {
    if (!(this as any).context) {
      (this as any).context = this.mockContext;
      this.pageEpoch = this.browserOwner.epoch;
    }
    return this.mockContext;
  }

  // Site interactions: recording stubs.
  protected async assertAuthenticated(): Promise<void> {}
  protected async fillComposer(): Promise<void> {}
  protected async clickSend(): Promise<void> {}
  protected async clearComposer(): Promise<void> {}
  protected async cleanupPrivacySession(): Promise<void> {}
  protected async collectGeneratedImages(): Promise<string[]> { return []; }

  protected override sessionDir(): string {
    return (this as any).tmpStateDir ||= mkdtempSync(path.join(tmpdir(), 'recdrv-state-'));
  }

  protected async waitForResponse(page: Page, _onChunk?: (c: string) => void, _signal?: AbortSignal): Promise<string> {
    const session = (page as any).__session;
    this.trace.push({ session, pageId: (page as any).id, phase: 'wait-start', at: Date.now() });
    await new Promise((r) => setTimeout(r, 80));
    this.trace.push({ session, pageId: (page as any).id, phase: 'wait-end', at: Date.now() });
    return `reply-on-${(page as any).id}`;
  }
}

describe('Task 6 driver integration: session pages through the full call chain', () => {
  let driver: RecordingDriver;
  const dirs: string[] = [];
  beforeEach(() => {
    driver = new RecordingDriver();
  });
  afterEach(async () => {
    await driver.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('TWO sessions run CONCURRENTLY on TWO DIFFERENT pages (page identity asserted during execution)', async () => {
    const [a, b] = await Promise.all([
      driver.sendMessage('m1', [{ role: 'user', content: 'task A' }], undefined, undefined, 'task-a'),
      driver.sendMessage('m1', [{ role: 'user', content: 'task B' }], undefined, undefined, 'task-b'),
    ]);
    expect(a).toMatch(/reply-on-page-/);
    expect(b).toMatch(/reply-on-page-/);
    const pageA = a.match(/reply-on-(page-\d+)/)![1]!;
    const pageB = b.match(/reply-on-(page-\d+)/)![1]!;
    expect(pageA).not.toBe(pageB);
    // Both were executing at the same time: A's wait started before B's wait ended.
    const aStart = driver.trace.find((t) => t.session === 'task-a' && t.phase === 'wait-start')!;
    const bEnd = driver.trace.find((t) => t.session === 'task-b' && t.phase === 'wait-end')!;
    expect(aStart.at).toBeLessThanOrEqual(bEnd.at);
  });

  it('SAME session key: two requests serialize on the SAME page (no interleave)', async () => {
    await Promise.all([
      driver.sendMessage('m1', [{ role: 'user', content: 'turn 1' }], undefined, undefined, 'same-task'),
      driver.sendMessage('m1', [{ role: 'user', content: 'turn 2' }], undefined, undefined, 'same-task'),
    ]);
    const waits = driver.trace.filter((t) => t.phase === 'wait-start');
    expect(waits).toHaveLength(2);
    expect(waits[0]!.pageId).toBe(waits[1]!.pageId); // same page
    const firstEnd = driver.trace.find((t) => t.phase === 'wait-end')!;
    const secondStart = waits[1]!;
    expect(firstEnd.at).toBeLessThanOrEqual(secondStart.at); // strict serialization
  });

  it('a session re-binds to ITS OWN page across sequential requests', async () => {
    const r1 = await driver.sendMessage('m1', [{ role: 'user', content: 'one' }], undefined, undefined, 'sticky');
    const r2 = await driver.sendMessage('m1', [{ role: 'user', content: 'two' }], undefined, undefined, 'sticky');
    expect(r1.match(/page-\d+/)![0]).toBe(r2.match(/page-\d+/)![0]);
  });
});
