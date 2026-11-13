/**
 * Embedded-catalog strategy — reads the model list a provider embeds in its
 * own page payload.
 *
 * Some providers ship their catalog inside the page's own data (Next.js RSC
 * payload, embedded JSON state). That data is produced by the provider during
 * the authorized browser session, so reading it is the same kind of evidence
 * as reading the model picker — but it is more precise, because the entries
 * carry the provider's real model ids.
 *
 * The payload is JSON escaped inside a script tag, so the extraction tolerates
 * the escaped form (`\"model\":\"…\"`).
 */
import type { DiscoveryContext, ModelDiscoveryResult } from './types.js';

export interface EmbeddedCatalogConfig {
  /** A marker that precedes the catalog inside the page payload. */
  marker: string;
  /** Key holding the model id inside an entry. */
  idKey: string;
  /** Key holding the display label inside an entry. */
  labelKey: string;
  /** Every accepted id must match this pattern. */
  idPattern?: string;
  /** Minimum number of plausible ids before the payload is accepted. */
  minModels?: number;
}

/**
 * Runs the extraction inside the page (the escaped payload is easiest to
 * handle where it lives).
 */
async function extractInPage(
  page: DiscoveryContext['page'],
  config: EmbeddedCatalogConfig,
): Promise<Array<{ id: string; label: string }>> {
  const result = await page.evaluate<Array<{ id: string; label: string }>>(
    `(() => {
      const cfg = ${JSON.stringify({ marker: config.marker, idKey: config.idKey, labelKey: config.labelKey })};
      const html = document.documentElement ? document.documentElement.outerHTML : '';
      const at = html.indexOf(cfg.marker);
      if (at < 0) return [];
      const scope = html.slice(at, at + 400000);
      const idKey = cfg.idKey.replace(/[.*+?^$()|[\\]{}]/g, '\\\\$&');
      const labelKey = cfg.labelKey.replace(/[.*+?^$()|[\\]{}]/g, '\\\\$&');
      // The payload is JSON-escaped inside a script tag: both \\"model\\" and
      // "model" must match.
      const idRe = new RegExp('(?:\\\\\\\\")?' + idKey + '(?:\\\\\\\\")?\\\\s*:\\\\s*(?:\\\\\\\\")?([^"\\\\\\\\]{1,80})(?:\\\\\\\\")?', 'g');
      const labelRe = new RegExp('(?:\\\\\\\\")?' + labelKey + '(?:\\\\\\\\")?\\\\s*:\\\\s*(?:\\\\\\\\")?([^"\\\\\\\\]{1,120})(?:\\\\\\\\")?', 'g');
      const out = [];
      const seen = new Set();
      let m;
      while ((m = idRe.exec(scope)) !== null) {
        const id = m[1];
        if (!id || seen.has(id)) continue;
        // The label belongs to the same object: look inside the object that
        // holds this id (bounded window).
        const objStart = scope.lastIndexOf('{', m.index);
        const objEnd = scope.indexOf('}', m.index);
        const obj = objStart >= 0 && objEnd > objStart ? scope.slice(objStart, objEnd + 1) : '';
        const lm = labelRe.exec(obj);
        const label = lm ? lm[1] : id;
        seen.add(id);
        out.push({ id, label });
        if (out.length > 80) break;
      }
      return out;
    })()`,
  );
  return Array.isArray(result) ? result : [];
}

/**
 * Runs the embedded-catalog strategy for one provider.
 */
export async function discoverModelsFromEmbeddedCatalog(
  providerId: string,
  config: EmbeddedCatalogConfig,
  ctx: DiscoveryContext,
): Promise<ModelDiscoveryResult> {
  const now = ctx.now ?? Date.now;
  const discoveredAt = new Date(now()).toISOString();

  const fail = (reason: ModelDiscoveryResult['failureReason'], detail: string): ModelDiscoveryResult => ({
    providerId,
    source: 'web-ui-network',
    complete: false,
    discoveredAt,
    models: [],
    failureReason: reason,
    detail,
    strategy: 'network',
  });

  let entries: Array<{ id: string; label: string }>;
  try {
    entries = await extractInPage(ctx.page, config);
  } catch (e) {
    return fail('unknown', `Could not read the embedded catalog: ${(e as Error).message}`);
  }

  const pattern = config.idPattern ? new RegExp(config.idPattern, 'i') : null;
  const models = entries
    .filter((e) => e.id && (!pattern || pattern.test(e.id)))
    .map((e) => ({
      providerModelId: e.id,
      displayName: e.label || e.id,
      metadata: { origin: 'embedded-catalog' },
      identityConfidence: 'stable-id' as const,
    }));

  if (models.length < (config.minModels ?? 1)) {
    return fail(
      'model_picker_not_found',
      'The page did not expose a model catalog in its own embedded payload.',
    );
  }

  return {
    providerId,
    source: 'web-ui-network',
    complete: true,
    discoveredAt,
    models,
    strategy: 'network',
    detail: `Read ${models.length} model ids from the provider's own embedded catalog`,
  };
}
