/**
 * Fixture-driven fake page for discovery adapter tests.
 *
 * Each provider gets its OWN fixture describing the markup that provider
 * actually uses (captured from the live site) — there is deliberately no
 * shared "generic" fixture that would pretend one adapter fits all sites.
 */
import type { DiscoveryLocator, DiscoveryPage } from '../../../src/gateway/discovery/types.js';

export interface ElementFixture {
  /** Selectors that resolve to this element. */
  selectors: string[];
  text?: string;
  attrs?: Record<string, string>;
  visible?: boolean;
  /** Child elements (used to model a clean label inside an option). */
  children?: ElementFixture[];
  /** When set, clicking this element reveals `reveals` (a picker opening). */
  reveals?: string[];
  /** When set, clicking this element hides `hides` (a picker that closes). */
  hides?: string[];
  /** Scroll container behaviour for virtual scrolling. */
  scroll?: { height: number; grows?: boolean };
}

export class FakeLocator implements DiscoveryLocator {
  constructor(
    private readonly elements: ElementFixture[],
    private readonly page: FakePage,
    private readonly index = 0,
  ) {}

  private get self(): ElementFixture | undefined {
    return this.elements[this.index];
  }

  async count(): Promise<number> {
    return this.elements.length;
  }

  first(): DiscoveryLocator {
    return new FakeLocator(this.elements, this.page, 0);
  }

  nth(index: number): DiscoveryLocator {
    return new FakeLocator(this.elements, this.page, index);
  }

  async all(): Promise<DiscoveryLocator[]> {
    return this.elements.map((_e, i) => new FakeLocator(this.elements, this.page, i));
  }

  locator(selector: string): DiscoveryLocator {
    const el = this.self;
    const children = (el?.children || []).filter((c) => c.selectors.includes(selector));
    return new FakeLocator(children, this.page, 0);
  }

  async click(): Promise<void> {
    const el = this.self;
    if (!el) throw new Error('element not found');
    if (el.reveals) this.page.reveal(el.reveals);
    if (el.hides) this.page.hide(el.hides);
  }

  async isVisible(): Promise<boolean> {
    return this.self?.visible !== false;
  }

  async textContent(): Promise<string | null> {
    return this.self?.text ?? null;
  }

  async getAttribute(name: string): Promise<string | null> {
    const el = this.self;
    if (!el) return null;
    return el.attrs?.[name] ?? null;
  }

  async waitFor(): Promise<void> {
    /* fixtures are static */
  }

  async evaluate<R = unknown>(fn: string | ((el: Element) => R), _arg?: unknown): Promise<R> {
    const el = this.self;
    if (!el) return null as unknown as R;
    if (typeof fn === 'string') {
      // e.g. `el => el.scrollHeight`
      return (el.scroll?.height ?? 0) as unknown as R;
    }
    const fake = {
      scrollHeight: el.scroll?.height ?? 0,
      get scrollTop() {
        return 0;
      },
      set scrollTop(_v: number) {
        /* virtual scroll simulation */
      },
    };
    return (fn as (x: unknown) => R)(fake);
  }
}

export class FakePage implements DiscoveryPage {
  private readonly active = new Set<string>();
  private readonly hidden = new Set<string>();

  constructor(private readonly elements: ElementFixture[]) {}

  /** Reveals the elements behind the given selectors (simulates opening a picker). */
  reveal(selectors: string[]): void {
    for (const s of selectors) this.active.add(s);
  }

  /** Makes a selector visible (e.g. a login wall appears). */
  activate(selectors: string[]): void {
    this.reveal(selectors);
  }

  /** Hides the given selectors (e.g. a picker that closed). */
  hide(selectors: string[]): void {
    for (const s of selectors) this.hidden.add(s);
  }

  private matches(selector: string): ElementFixture[] {
    if (this.hidden.has(selector)) return [];
    return this.elements.filter(
      (e) => e.selectors.includes(selector) && (e.visible !== false || this.active.has(selector)),
    );
  }

  async goto(): Promise<void> {}

  url(): string {
    return 'https://fixture.local/chat';
  }

  async title(): Promise<string> {
    return 'Fixture';
  }

  locator(selector: string): DiscoveryLocator {
    return new FakeLocator(this.matches(selector), this);
  }

  async waitForTimeout(): Promise<void> {}

  async content(): Promise<string> {
    return '';
  }

  async evaluate<R>(fn: string | ((...args: any[]) => R), arg?: unknown): Promise<R> {
    if (typeof fn === 'string') return '' as unknown as R;
    // Provide a minimal `document` so page-level reads (body text) work.
    const document = { body: { innerText: this.bodyText() } };
    try {
      const compiled = new Function('document', 'arg', `return (${(fn as any).toString()})(arg);`);
      return compiled(document, arg) as R;
    } catch {
      return undefined as unknown as R;
    }
  }

  /** The visible text of the page (used by the signed-out detection). */
  bodyText(): string {
    return this.elements.map((e) => e.text || '').join(' | ');
  }
}

/** Builds a fixture page from a compact description. */
export function fixturePage(elements: ElementFixture[]): FakePage {
  return new FakePage(elements);
}
