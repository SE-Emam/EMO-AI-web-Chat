/**
 * Network discovery strategy — reads the model list the PROVIDER ITSELF
 * fetches while its chat page loads.
 *
 * This is NOT an invented endpoint: the runner records the responses the
 * provider's own page requested during the authorized browser session, and
 * the adapter declares which of those observed requests carries the model
 * list (verified against the live site). When the provider exposes a stable
 * same-origin model endpoint, the strategy can also replay exactly that
 * request from inside the page (same session, same cookies).
 *
 * A payload is only accepted when it yields at least `minModels` ids that
 * match the provider's declared id pattern — this keeps unrelated JSON in
 * the page traffic (ads, feature flags, telemetry) out of the result.
 */
import type {
  DiscoveryContext,
  ModelDiscoveryResult,
  NetworkDiscoveryConfig,
} from './types.js';

export interface CapturedResponse {
  url: string;
  status: number;
  body: string;
  contentType?: string;
}

function collectStrings(value: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 8) return out;
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, depth + 1, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, depth + 1, out);
  }
  return out;
}

/** Walks the payload and returns the richest plausible model-id array. */
export function extractModelIds(
  payload: unknown,
  config: NetworkDiscoveryConfig,
): { ids: string[]; names: Map<string, string> } {
  const names = new Map<string, string>();
  const candidates = new Map<string, number>();

  const pattern = config.idPattern ? new RegExp(config.idPattern, 'i') : null;
  const nameKeys = ['name', 'display_name', 'displayName', 'title', 'label', 'description'];

  const consider = (id: string, name?: string) => {
    const trimmed = String(id ?? '').trim();
    if (!trimmed || trimmed.length > 120) return;
    if (/\s/.test(trimmed) && !name) return;
    if (pattern && !pattern.test(trimmed)) return;
    candidates.set(trimmed, (candidates.get(trimmed) || 0) + 1);
    if (name && !names.has(trimmed)) names.set(trimmed, String(name).slice(0, 120));
  };

  const visit = (node: unknown, depth: number) => {
    if (depth > 8 || node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) {
        if (typeof item === 'string') {
          consider(item);
        } else if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          for (const key of config.idKeys) {
            const raw = obj[key];
            if (typeof raw === 'string' && raw.trim()) {
              let name: string | undefined;
              for (const nk of nameKeys) {
                if (typeof obj[nk] === 'string' && obj[nk]) {
                  name = obj[nk] as string;
                  break;
                }
              }
              consider(raw, name);
              break;
            }
          }
        }
      }
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      // The payload may hold a SINGLE model object (not a list).
      for (const key of config.idKeys) {
        const raw = obj[key];
        if (typeof raw === 'string' && raw.trim()) {
          let name: string | undefined;
          for (const nk of nameKeys) {
            if (typeof obj[nk] === 'string' && obj[nk]) {
              name = obj[nk] as string;
              break;
            }
          }
          consider(raw, name);
          break;
        }
      }
      for (const value of Object.values(obj)) visit(value, depth + 1);
    }
  };

  visit(payload, 0);

  const min = config.minModels ?? 1;
  const ids = [...candidates.keys()].filter((id) => (candidates.get(id) || 0) >= 1);
  if (ids.length < min) return { ids: [], names };
  return { ids, names };
}

/** Finds the first captured response that matches the provider's patterns. */
export function findModelPayload(
  captured: CapturedResponse[],
  config: NetworkDiscoveryConfig,
): { response: CapturedResponse; ids: string[]; names: Map<string, string> } | null {
  // NO declared pattern means NO network source: matching every response
  // would happily invent models out of unrelated page traffic.
  if (config.urlPatterns.length === 0) return null;
  for (const response of captured) {
    if (response.status >= 400) continue;
    if (!config.urlPatterns.some((p) => response.url.includes(p))) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      continue;
    }
    const { ids, names } = extractModelIds(parsed, config);
    if (ids.length === 0) continue;
    return { response, ids, names };
  }
  return null;
}

/**
 * Runs the network strategy.
 *
 * `captured` holds the responses the provider's own page requested while it
 * was loading (recorded by the runner).
 */
export async function discoverModelsFromNetwork(
  providerId: string,
  config: NetworkDiscoveryConfig,
  ctx: DiscoveryContext,
  captured: CapturedResponse[] = [],
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

  // 1. Replay the provider's own same-origin model request from the page.
  for (const path of config.replayPaths || []) {
    try {
      const body = await ctx.page.evaluate<string>(
        `(async (p) => { try { const r = await fetch(p, { credentials: 'include', headers: { 'Accept': 'application/json' } }); return await r.text(); } catch (e) { return ''; } })(${JSON.stringify(path)})`,
      );
      if (!body) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        continue;
      }
      const { ids, names } = extractModelIds(parsed, config);
      if (ids.length === 0) continue;
      return {
        providerId,
        source: 'web-ui-network',
        complete: true,
        discoveredAt,
        models: ids.map((id) => ({
          providerModelId: id,
          displayName: names.get(id) || id,
          metadata: { origin: 'replay', path },
          identityConfidence: 'stable-id' as const,
        })),
        strategy: 'network',
        detail: `Read ${ids.length} model ids from the provider's own ${path}`,
      };
    } catch {
      /* try the next path */
    }
  }

  // 2. Fall back to the payloads the page itself fetched.
  const found = findModelPayload(captured, config);
  if (!found) {
    return fail(
      'model_picker_not_found',
      'The provider page did not expose a model list in its own network traffic.',
    );
  }

  return {
    providerId,
    source: 'web-ui-network',
    complete: true,
    discoveredAt,
    models: found.ids.map((id) => ({
      providerModelId: id,
      displayName: found.names.get(id) || id,
      metadata: { origin: 'observed', url: found.response.url.slice(0, 200) },
      identityConfidence: 'stable-id' as const,
    })),
    strategy: 'network',
    detail: `Read ${found.ids.length} model ids from ${found.response.url.slice(0, 120)}`,
  };
}
