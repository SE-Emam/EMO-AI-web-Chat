/**
 * DOM discovery strategy — reads the model list the provider RENDERS.
 *
 * The strategy is configuration-driven (per provider) so the extraction logic
 * itself is written once and unit-tested against DOM fixtures:
 *
 *   1. detect a login wall            -> authentication_required
 *   2. open the model picker          -> model_picker_not_found when absent
 *   3. wait for the options to appear -> timeout / site_layout_changed
 *   4. expand pagination + virtual scroll so the WHOLE list is read
 *   5. read each option's stable id and display name
 *
 * A stable id is only reported when it was found in one of the provider's
 * declared id attributes. Otherwise the model is recorded as
 * `display-name-only` and is NOT presented as executable.
 */
import type {
  DiscoveryContext,
  DiscoveryLocator,
  DomDiscoveryConfig,
  ModelDiscoveryResult,
  RawModelOption,
} from './types.js';

function normalize(text: string | null | undefined): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * A login wall proves the session is not usable for discovery.
 *
 * Only STRONG evidence counts: a sign-in URL, a visible password field or a
 * visible sign-in form. A "Log in" BUTTON in the site header is not a login
 * wall — almost every site renders one even for signed-in users, and
 * treating it as a wall would hide working discovery.
 */
async function detectLoginWall(page: DiscoveryContext['page'], selectors: string[] | undefined): Promise<boolean> {
  try {
    const url = page.url();
    if (/\/(login|signin|sign-in|auth|account\/signin)(\/|\?|$)/i.test(url)) return true;
  } catch {
    /* ignore */
  }
  const strong = [
    'input[type="password"]',
    'form[action*="login" i]',
    'form[action*="signin" i]',
    '[class*="login__dialog" i]',
    '[class*="login-dialog" i]',
    '[data-testid*="login" i]',
  ];
  for (const sel of [...strong, ...(selectors || [])]) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0 && (await loc.isVisible())) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/**
 * Reads the option elements currently present in the DOM.
 *
 * The FIRST selector that yields options is the primary source. The remaining
 * selectors are merged in, but ONLY for options that carry a stable id the
 * primary set did not contain — this keeps providers that split their list
 * across markup variants (e.g. `role=menuitemradio` + `role=menuitem`)
 * complete, without letting a broad fallback selector inject items that
 * carry no model id.
 */
async function readOptions(page: DiscoveryContext['page'], config: DomDiscoveryConfig): Promise<RawModelOption[]> {
  const out: RawModelOption[] = [];
  const seen = new Set<string>();
  const seenIds = new Set<string>();
  let primaryFound = false;

  for (const sel of config.optionSelectors) {
    let locator: DiscoveryLocator;
    try {
      locator = page.locator(sel);
      const count = await locator.count();
      if (count === 0) continue;
      const items = await locator.all();
      const collected: RawModelOption[] = [];
      for (const item of items) {
        const option = await readOption(item, config);
        if (!option) continue;
        collected.push(option);
      }
      if (collected.length === 0) continue;
      if (!primaryFound) {
        primaryFound = true;
        for (const option of collected) {
          const key = option.stableId || option.label.toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          if (option.stableId) seenIds.add(option.stableId);
          out.push(option);
        }
        continue;
      }
      // Secondary selectors may only contribute items with a NEW stable id.
      for (const option of collected) {
        if (!option.stableId) continue;
        if (seenIds.has(option.stableId)) continue;
        seenIds.add(option.stableId);
        seen.add(option.stableId);
        out.push(option);
      }
    } catch {
      /* try the next selector */
    }
  }
  return out;
}

/** Extracts one option's stable id, label and metadata. */
async function readOption(locator: DiscoveryLocator, config: DomDiscoveryConfig): Promise<RawModelOption | null> {
  let label = '';
  try {
    if (config.labelExtraction === 'attribute' && config.labelAttribute) {
      label = normalize(await locator.getAttribute(config.labelAttribute));
    }
    if (!label && config.labelSelector) {
      const inner = locator.locator(config.labelSelector).first();
      if ((await inner.count()) > 0) label = normalize(await inner.textContent());
    }
    if (!label) label = normalize(await locator.textContent());
  } catch {
    return null;
  }
  if (!label) return null;

  let stableId: string | undefined;
  let idSource: string | undefined;
  for (const attr of config.idAttributes) {
    try {
      const value = normalize(await locator.getAttribute(attr));
      if (value) {
        stableId = value;
        idSource = attr;
        break;
      }
    } catch {
      /* ignore */
    }
  }

  const metadata: Record<string, unknown> = {};
  for (const attr of config.metadataAttributes || []) {
    try {
      const value = await locator.getAttribute(attr);
      if (value != null && value !== '') metadata[attr] = value.slice(0, 200);
    } catch {
      /* ignore */
    }
  }

  return { stableId, label, metadata, idSource };
}

/** Scrolls a virtualised container to the bottom, repeatedly. */
async function drainVirtualScroll(page: DiscoveryContext['page'], config: DomDiscoveryConfig): Promise<void> {
  const selectors = config.scrollContainerSelectors || [];
  if (selectors.length === 0) return;
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) === 0) continue;
      for (let i = 0; i < 12; i++) {
        const before = await loc.evaluate((el) => el.scrollHeight ?? 0);
        await loc.evaluate((el) => {
          (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
        });
        await page.waitForTimeout(150);
        const after = await loc.evaluate((el) => el.scrollHeight ?? 0);
        if (after === before) break;
      }
    } catch {
      /* best effort */
    }
  }
}

/**
 * Detects a signed-out page: it asks the user to sign in AND it has no chat
 * composer at all. A site header that always shows a "Sign in" link does not
 * trigger this (the composer is present on a working session).
 */
async function detectSignedOutPage(
  page: DiscoveryContext['page'],
  composerSelectors: string[] | undefined,
): Promise<boolean> {
  const composers = composerSelectors || [
    'textarea',
    '[contenteditable="true"]',
    'input[type="text"]',
    'form[data-testid*="composer" i]',
  ];
  for (const sel of composers) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0 && (await loc.isVisible())) return false;
    } catch {
      /* ignore */
    }
  }
  try {
    const text = await page.evaluate<string>(() => (document.body ? document.body.innerText : ''));
    return /(^|\W)(sign in|log in|not logged in|sign up to continue|please log in)(\W|$)/i.test(String(text || ''));
  } catch {
    return false;
  }
}

/**
 * Detects an opened menu that is really a paywall / sign-in prompt.
 * (Providers such as Grok show "Premium — Unlock extended capabilities — Sign
 * in" inside the model menu when the session is not authenticated.)
 */
async function detectSignInPrompt(page: DiscoveryContext['page']): Promise<boolean> {
  const selectors = [
    '[role="menuitem"]:has-text("Sign in")',
    '[role="menuitem"]:has-text("Log in")',
    '[role="menuitem"]:has-text("Unlock")',
    '[role="menu"]:has-text("Sign in")',
    '[role="dialog"]:has-text("Sign in")',
    'button[aria-label="Select model"]',
  ];
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0 && (await loc.isVisible())) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/**
 * Runs the DOM strategy for one provider.
 */
export async function discoverModelsFromDom(
  providerId: string,
  config: DomDiscoveryConfig,
  ctx: DiscoveryContext,
): Promise<ModelDiscoveryResult> {
  const now = ctx.now ?? Date.now;
  const discoveredAt = new Date(now()).toISOString();
  const page = ctx.page;

  const fail = (reason: ModelDiscoveryResult['failureReason'], detail: string): ModelDiscoveryResult => ({
    providerId,
    source: 'web-ui-dom',
    complete: false,
    discoveredAt,
    models: [],
    failureReason: reason,
    detail,
    strategy: 'dom',
  });

  if (await detectLoginWall(page, config.loginWallSelectors)) {
    return fail('authentication_required', 'The provider is showing a sign-in page — the browser session is not authenticated.');
  }

  // 1. Open the picker.
  let opened = false;
  for (const sel of config.openPickerSelectors) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) === 0) continue;
      if (!(await loc.isVisible())) continue;
      await loc.click({ timeout: 8000, force: true });
      opened = true;
      break;
    } catch {
      /* try the next selector */
    }
  }
  if (!opened) {
    return fail(
      'model_picker_not_found',
      'No model picker control was found on the provider page — the layout may have changed.',
    );
  }

  // 2. Let the list render.
  const settleMs = ctx.settleMs ?? 1200;
  await page.waitForTimeout(settleMs);

  // 3. Expand pagination ("more models" etc.) until the list stops growing.
  const maxExpansions = config.maxExpansions ?? 6;
  let options = await readOptions(page, config);
  for (let i = 0; i < maxExpansions; i++) {
    const selectors = config.expandSelectors || [];
    let expanded = false;
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first();
        if ((await loc.count()) === 0) continue;
        if (!(await loc.isVisible())) continue;
        await loc.click({ timeout: 5000, force: true });
        expanded = true;
        break;
      } catch {
        /* ignore */
      }
    }
    if (!expanded) break;
    await page.waitForTimeout(Math.min(1500, settleMs));
    await drainVirtualScroll(page, config);
    const next = await readOptions(page, config);
    // NEVER let an expansion SHRINK the list: some "more" controls close the
    // picker, and a shorter list must never overwrite the one we read.
    if (next.length <= options.length) break;
    options = next;
  }

  // 4. Final virtual-scroll drain so late rows are materialised.
  await drainVirtualScroll(page, config);
  const finalOptions = await readOptions(page, config);
  if (finalOptions.length > options.length) options = finalOptions;

  if (options.length === 0) {
    // The picker opened but showed nothing. If the opened menu is a PAYWALL
    // / sign-in prompt, that is an authentication problem — not a layout
    // change — and must be reported as such.
    const signIn =
      (await detectSignInPrompt(page)) ||
      (await detectSignedOutPage(page, config.composerSelectors));
    if (signIn) {
      return fail(
        'authentication_required',
        'The provider asks for a sign-in before it shows its model list — the browser session is not authenticated.',
      );
    }
    return fail(
      'site_layout_changed',
      'The model picker opened but no model options could be read — the provider markup may have changed.',
    );
  }

  const models = options.map((o) => ({
    providerModelId: o.stableId,
    displayName: o.label,
    metadata: {
      ...(o.metadata || {}),
      ...(o.idSource ? { idSource: o.idSource } : {}),
    },
    identityConfidence: (o.stableId ? 'stable-id' : 'display-name-only') as
      | 'stable-id'
      | 'display-name-only',
  }));

  return {
    providerId,
    source: 'web-ui-dom',
    complete: true,
    discoveredAt,
    models,
    strategy: 'dom',
  };
}
