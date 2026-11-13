/**
 * Minimal DOM/VM harness that executes the REAL gateway UI script
 * (src/gateway/ui.ts) so the provider card behaviour can be asserted —
 * no mocks of the code under test, only of the browser primitives.
 */
import vm from 'node:vm';
import { registerGatewayUi } from '../../src/gateway/ui.js';

export interface FetchCall {
  url: string;
  method: string;
  body?: any;
}

export interface FetchReply {
  ok?: boolean;
  status?: number;
  json?: any;
  text?: string;
}

export type FetchHandler = (call: FetchCall) => FetchReply | Promise<FetchReply>;

class FakeElement {
  tagName: string;
  id = '';
  innerHTML = '';
  textContent = '';
  className = '';
  value = '';
  checked = false;
  disabled = false;
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  parent: FakeElement | null = null;
  onclick: ((ev?: any) => any) | null = null;
  onchange: ((ev?: any) => any) | null = null;
  classList = {
    add: () => {},
    remove: () => {},
    contains: () => false,
    toggle: () => {},
  };

  constructor(tag = 'div') {
    this.tagName = tag;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeElement): FakeElement {
    this.children = this.children.filter((c) => c !== child);
    return child;
  }

  remove(): void {
    this.parent?.removeChild(this);
  }

  setAttribute(key: string, value: string): void {
    this.attributes[key] = value;
    if (key === 'id') this.id = value;
  }

  getAttribute(key: string): string | null {
    return this.attributes[key] ?? null;
  }

  addEventListener(): void {}

  focus(): void {}

  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  }

  getElementsByTagName(): FakeElement[] {
    return [];
  }

  scrollIntoView(): void {}

  get offsetWidth(): number {
    return 0;
  }

  get offsetHeight(): number {
    return 0;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return queryAll(this, selector);
  }

  querySelector(selector: string): FakeElement | null {
    return queryAll(this, selector)[0] ?? null;
  }

  closest(selector: string): FakeElement | null {
    if (selector === '.provider-card' && this.className.includes('provider-card')) return this;
    return this.parent;
  }
}

/** Parses the fake DOM out of an HTML string (attributes + inline text). */
function parseTags(html: string): FakeElement[] {
  const out: FakeElement[] = [];
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*\/?>/g;
  const openTags: FakeElement[] = [];
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const el = new FakeElement(m[1]);
    const attrRe = /([a-zA-Z-]+)(?:="([^"]*)")?/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(m[2] || ''))) {
      const name = a[1];
      const value = a[2] ?? '';
      el.setAttribute(name, value);
      if (name.startsWith('data-')) el.dataset[name.slice(5)] = value;
      if (name === 'type' && value === 'checkbox') el.checked = /checked/.test(m[2] || '');
      if (name === 'disabled') el.disabled = true;
    }
    out.push(el);
    openTags.push(el);
    // The inline text that follows the opening tag belongs to this element.
    const nextTag = html.indexOf('<', tagRe.lastIndex);
    const textEnd = nextTag === -1 ? html.length : nextTag;
    el.textContent = html.slice(tagRe.lastIndex, textEnd).trim();
  }
  return out;
}

/** Cached parse of an element's innerHTML (so handler bindings survive). */
function parsedFor(el: FakeElement): FakeElement[] {
  const cache = (el as any).__parsed as { html: string; els: FakeElement[] } | undefined;
  if (cache && cache.html === el.innerHTML) return cache.els;
  const els = parseTags(el.innerHTML);
  for (const parsed of els) parsed.parent = el;
  (el as any).__parsed = { html: el.innerHTML, els };
  return els;
}

function queryAll(root: FakeElement, selector: string): FakeElement[] {
  const all: FakeElement[] = [];
  const walk = (el: FakeElement) => {
    for (const child of el.children) {
      all.push(...parsedFor(child));
      walk(child);
    }
  };
  walk(root);

  if (selector === '[data-act]') {
    return all.filter((el) => el.dataset.act !== undefined);
  }
  if (selector.includes('input[type=checkbox]')) {
    return all.filter((el) => el.dataset.model !== undefined);
  }
  return [];
}

export interface UiHarness {
  ctx: any;
  fetchCalls: FetchCall[];
  setFetchHandler(handler: FetchHandler): void;
  renderProvidersGrid(providers: any[], force?: boolean): void;
  gridHtml(): string;
  cardHtml(providerId: string): string;
  toasts(): Array<{ text: string; type: 'info' | 'error' }>;
  click(action: string, providerId: string): Promise<void>;
  buttonState(action: string, providerId: string): { label: string; disabled: boolean } | null;
}

function extractMainScript(): string {
  let handler: ((req: any, reply: any) => any) | undefined;
  const app: any = {
    get(_p: string, h: any) {
      handler = h;
      return app;
    },
  };
  registerGatewayUi(app, { apiKey: 'emo.web' });
  let html = '';
  const reply: any = {
    type() {
      return reply;
    },
    send(body: string) {
      html = body;
    },
  };
  if (handler) handler({}, reply);
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  // The largest inline script is the application script.
  return scripts.sort((a, b) => b.length - a.length)[0] || '';
}

export function createUiHarness(): UiHarness {
  const source = extractMainScript();
  const fetchCalls: FetchCall[] = [];
  let fetchHandler: FetchHandler = () => ({ ok: true, status: 200, json: {} });

  const registry = new Map<string, FakeElement>();
  const getEl = (id: string): FakeElement => {
    let el = registry.get(id);
    if (!el) {
      el = new FakeElement('div');
      el.id = id;
      registry.set(id, el);
    }
    return el;
  };

  const documentStub: any = {
    getElementById: (id: string) => getEl(id),
    createElement: (tag: string) => new FakeElement(tag),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    documentElement: new FakeElement('html'),
    body: new FakeElement('body'),
    head: new FakeElement('head'),
  };

  const localStorageStub: any = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };

  const sandbox: any = {
    console,
    document: documentStub,
    localStorage: localStorageStub,
    navigator: { language: 'ar', userAgent: 'node' },
    location: { origin: 'http://127.0.0.1:8989', href: 'http://127.0.0.1:8989/' },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    queueMicrotask: () => {},
    fetch: async (url: string, opts: any = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      const call: FetchCall = { url: String(url), method };
      if (opts.body) {
        try {
          call.body = JSON.parse(String(opts.body));
        } catch {
          call.body = String(opts.body);
        }
      }
      fetchCalls.push(call);
      const reply = await fetchHandler(call);
      const status = reply.status ?? (reply.ok === false ? 400 : 200);
      const ok = reply.ok ?? status < 400;
      const text = reply.text ?? JSON.stringify(reply.json ?? {});
      return {
        ok,
        status,
        text: async () => text,
        json: async () => {
          try {
            return JSON.parse(text);
          } catch {
            return {};
          }
        },
      };
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.dispatchEvent = () => false;
  sandbox.getComputedStyle = () => ({ getPropertyValue: () => '' });
  sandbox.requestAnimationFrame = () => 0;
  sandbox.innerWidth = 1440;
  sandbox.innerHeight = 900;
  sandbox.scrollTo = () => {};
  sandbox.alert = () => {};
  sandbox.confirm = () => true;
  sandbox.prompt = () => null;
  sandbox.open = () => null;
  sandbox.history = { replaceState: () => {}, pushState: () => {} };
  sandbox.location = sandbox.location;
  sandbox.XMLHttpRequest = function () {
    return { open() {}, send() {}, setRequestHeader() {}, addEventListener() {} };
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(source, ctx, { filename: 'gateway-ui.js' });

  const grid = () => getEl('providersGrid');

  const collectActionElements = (): FakeElement[] => {
    const g = grid();
    return g.querySelectorAll('[data-act]');
  };

  const harness: UiHarness = {
    ctx,
    fetchCalls,
    setFetchHandler(handler) {
      fetchHandler = handler;
    },
    renderProvidersGrid(providers, force = true) {
      ctx.renderProvidersGrid(providers, force);
    },
    gridHtml() {
      return grid().children.map((c) => c.innerHTML).join('');
    },
    cardHtml(providerId) {
      const card = grid().children.find((c) => c.innerHTML.includes('data-id="' + providerId + '"'));
      return card ? card.innerHTML : '';
    },
    toasts() {
      const list = getEl('toastList');
      return list.children.map((el) => ({
        text: el.innerHTML.replace(/<[^>]+>/g, ' ').trim(),
        type: el.innerHTML.includes('⚠') ? ('error' as const) : ('info' as const),
      }));
    },
    async click(action, providerId) {
      const el = collectActionElements().find((e) => e.dataset.act === action && e.dataset.id === providerId);
      if (!el) throw new Error(`No element with data-act="${action}" for provider "${providerId}"`);
      if (!el.onclick) throw new Error(`Element data-act="${action}" has no click handler bound`);
      await el.onclick({ stopPropagation() {}, preventDefault() {} });
    },
    buttonState(action, providerId) {
      const el = collectActionElements().find((e) => e.dataset.act === action && e.dataset.id === providerId);
      if (!el) return null;
      return { label: el.textContent.replace(/<[^>]+>/g, '').trim(), disabled: el.disabled };
    },
  };

  return harness;
}
