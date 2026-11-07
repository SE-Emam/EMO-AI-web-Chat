/**
 * Z.AI model registry and error helpers.
 */

export const ZAI_MODELS: readonly string[] = [
  'glm-5.3-flash',
  'glm-5.3-flashx',
  'glm-5.3',
  'glm-5.2',
  'glm-5.1',
  'glm-5',
  'glm-4.7',
  'glm-4.6',
  'glm-4.7-flash',
  'glm-4.5-flash',
];

/** Models confirmed free of charge on the international Z.AI platform. */
export const ZAI_FREE_MODELS: readonly string[] = ['glm-4.7-flash', 'glm-4.5-flash'];

/**
 * Normalizes aliases like "glm" or a bare flash name onto canonical Z.AI model IDs.
 */
export function normalizeZaiModel(model: string): string {
  const cleaned = model.trim().toLowerCase();
  if (ZAI_MODELS.includes(cleaned)) {
    return cleaned;
  }
  if (cleaned === 'glm' || cleaned === 'zai') {
    return 'glm-5.3-flash';
  }
  // Date snapshots (e.g. glm-5.3-flash-20261022)
  const dateStripped = cleaned.replace(/-\d{4}-?\d{2}-?\d{2}$/, '');
  if (ZAI_MODELS.includes(dateStripped)) {
    return dateStripped;
  }
  // Partial match: "5.3-flash" -> "glm-5.3-flash"
  const partial = ZAI_MODELS.find((m) => m === `glm-${dateStripped}`);
  if (partial) {
    return partial;
  }
  return dateStripped;
}

/** Checks whether a model ID looks like a Z.AI/GLM model. */
export function isZaiModel(model: string): boolean {
  return /^glm(-|$)/.test(model.trim().toLowerCase());
}

/**
 * Builds a friendly message for Z.AI rate-limit errors (code 1302).
 */
export function mapZaiRateLimitError(original: string): string {
  return `${original} (Z.AI user rate limit reached — see z.ai/manage-apikey/rate-limits). Consider the free glm-4.7-flash / glm-4.5-flash models or retry shortly.`;
}
