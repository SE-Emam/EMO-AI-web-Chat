/**
 * Single source of truth for web provider registry (C1 fix).
 * Derives: gateway PROVIDER_META matching, CLI routing predicates, and docs.
 *
 * Scope: only web-scraping providers (persistent Chrome profile + baseUrl).
 * The Z.AI REST API (`https://api.z.ai/api/paas/v4/`, `config.zai`) is
 * intentionally NOT in this registry — it is not a web session. Its
 * defaults (`DEFAULT_ZAI_BASE_URL`, `DEFAULT_ZAI_MODEL`,
 * `DEFAULT_ZAI_MODEL_PREFIXES` in `src/config.ts`, and the `zai-api`
 * route in `src/cli.ts`) remain canonical there and are documented
 * as excluded, not duplicated, copies.
 */
import type { WebProviderId } from '../gateway/types.js';

export interface ProviderSpec {
  id: WebProviderId;
  name: string;
  /** Model ID prefixes that route to this provider (lowercase). */
  prefixes: string[];
  defaultBaseUrl: string;
  defaultTimeoutMs: number;
  /** Persistent Chrome profile directory name (sibling of ~/.arena-webbridge/). */
  profileDir: string;
  /** Extra captcha-wait default (only providers with an Aliyun-style slider). */
  defaultCaptchaWaitMs?: number;
  /** Extra predicate (e.g. zai-web also matches bare glm-* for fallback). */
  alsoMatches?: (model: string) => boolean;
}

export const WEB_PROVIDERS: readonly ProviderSpec[] = [
  { id: 'arena-browser', name: 'Arena Browser', prefixes: [], defaultBaseUrl: 'https://arena.ai', defaultTimeoutMs: 300_000, profileDir: 'chrome-profile' },
  { id: 'zai-web', name: 'ZAI Web', prefixes: ['zai-web:'], defaultBaseUrl: 'https://chat.z.ai', defaultTimeoutMs: 180_000, profileDir: 'zai-profile', defaultCaptchaWaitMs: 180_000, alsoMatches: (m) => m.startsWith('glm-') },
  { id: 'claude-web', name: 'Claude Web', prefixes: ['claude-web:', 'claudeai:'], defaultBaseUrl: 'https://claude.ai', defaultTimeoutMs: 300_000, profileDir: 'claude-profile' },
  { id: 'tencent-ai-web', name: 'Tencent AI Studio Web', prefixes: ['tencent-ai:', 'tencentai:'], defaultBaseUrl: 'https://aistudio.tencent.ai', defaultTimeoutMs: 300_000, profileDir: 'tencent-ai-profile' },
  { id: 'gemini-web', name: 'Gemini Web', prefixes: ['gemini-web:', 'geminiweb:'], defaultBaseUrl: 'https://gemini.google.com', defaultTimeoutMs: 300_000, profileDir: 'gemini-profile' },
  { id: 'qwen-web', name: 'Qwen Web', prefixes: ['qwen-web:', 'qwenweb:'], defaultBaseUrl: 'https://chat.qwen.ai', defaultTimeoutMs: 300_000, profileDir: 'qwen-profile' },
] as const;

export function matchesProvider(id: WebProviderId, model: string): boolean {
  const spec = WEB_PROVIDERS.find((p) => p.id === id);
  if (!spec) return false;
  if (id === 'arena-browser') return true;
  const m = model.trim().toLowerCase();
  if (spec.prefixes.some((p) => m.startsWith(p))) return true;
  if (spec.alsoMatches?.(m)) return true;
  return false;
}

export function providerSpec(id: WebProviderId): ProviderSpec {
  const spec = WEB_PROVIDERS.find((p) => p.id === id);
  if (!spec) throw new Error(`Unknown web provider: ${id}`);
  return spec;
}
