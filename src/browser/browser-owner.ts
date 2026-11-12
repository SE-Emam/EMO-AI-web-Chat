/**
 * Per-process browser ownership identity (chat-on-steroids principle: the
 * browser incarnation epoch invalidates every command issued against the
 * previous incarnation — a stale worker can never act on a page from a
 * browser it no longer owns).
 */
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { Page } from 'playwright';

export class BrowserOwner {
  /** Stable for this gateway process instance. */
  readonly id: string;
  private epochValue: string;

  constructor() {
    this.id = `owner-${process.pid}-${randomUUID().slice(0, 8)}`;
    this.epochValue = `ep-${randomUUID().slice(0, 12)}`;
  }

  /** Current browser incarnation. Bumps on every (re)launch of a context. */
  get epoch(): string {
    return this.epochValue;
  }

  /** Called when a new browser context is launched (browser relaunch). */
  bumpEpoch(): void {
    this.epochValue = `ep-${randomUUID().slice(0, 12)}`;
  }

  /**
   * Verifies the page still belongs to the current browser incarnation and is
   * alive. Used before/after every sensitive async operation so a stale worker
   * (whose browser was relaunched or whose page was closed) fails loudly
   * instead of operating on a ghost page.
   */
  verify(page: Page, epoch: string): boolean {
    if (epoch !== this.epochValue) return false;
    try {
      return !page.isClosed();
    } catch {
      return false;
    }
  }
}
