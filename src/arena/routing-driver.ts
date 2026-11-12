import type { ArenaDriver, ChatMessage } from '../types.js';

/**
 * A named backend route with a model-ID predicate. Requests walk the chain in
 * order and the first driver whose predicate matches handles them; if it fails
 * with a recoverable error, the next matching route gets the request.
 */
export interface DriverRoute {
  name: string;
  driver: ArenaDriver;
  matches: (model: string) => boolean;
}

/** Non-retryable failures we don't want to re-attempt on another backend. */
const ABORT_NON_RETRYABLE = ['Request was aborted'];

export class RoutingDriver implements ArenaDriver {
  private readonly routes: DriverRoute[];

  constructor(routes: DriverRoute[]) {
    this.routes = routes;
  }

  async listModels(): Promise<string[]> {
    const results = await Promise.all(
      this.routes.map((r) => r.driver.listModels().catch(() => [] as string[]))
    );
    // Preserve chain order (z.ai before arena) while de-duplicating.
    const out: string[] = [];
    for (const list of results) {
      for (const m of list) {
        if (!out.includes(m)) out.push(m);
      }
    }
    return out;
  }

  async sendMessage(
    model: string,
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
    sessionKey?: string
  ): Promise<string> {
    if (signal?.aborted) throw new Error('Request was aborted');
    const cleaned = model.trim().toLowerCase();
    const candidates = this.routes.filter((r) => r.matches(cleaned));

    if (candidates.length === 0) {
      throw new Error(`No provider configured can serve model "${model}"`);
    }

    let lastError: unknown;
    for (const route of candidates) {
      try {
        return await route.driver.sendMessage(model, messages, onChunk, signal, sessionKey);
      } catch (err: unknown) {
        if (signal?.aborted) {
          throw new Error('Request was aborted');
        }
        lastError = err;
        const e = err as { statusCode?: number; message?: string };
        const msg = err instanceof Error ? err.message : String(err);
        const status = e?.statusCode;
        // Fail-fast on non-retryable client/auth errors (4xx except 429) — do not mask them by failing over.
        const isNonRetryableAuth = status === 401 || status === 403 || (status !== undefined && status >= 400 && status < 500 && status !== 429);
        const isNonRetryableMsg = ABORT_NON_RETRYABLE.some((m) => msg === m)
          || /Invalid or missing API key|authentication_error|Invalid request|messages.*required/i.test(msg);
        if (isNonRetryableAuth || isNonRetryableMsg) throw err;
        console.log(
          `[RoutingDriver] ${route.name} failed for model ${model}: ${msg}. Trying next provider...`
        );
      }
    }

    throw lastError ?? new Error('All providers failed');
  }

  async close(): Promise<void> {
    const closed = new Set<ArenaDriver>();
    for (const r of this.routes) {
      if (closed.has(r.driver)) continue;
      closed.add(r.driver);
      if (r.driver.close) {
        await r.driver.close().catch(() => {});
      }
    }
  }
}
