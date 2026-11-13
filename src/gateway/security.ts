import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

/**
 * Constant-time comparison between two secret strings (such as API keys).
 * Uses SHA-256 digest to normalize lengths before timingSafeEqual,
 * preventing length-leakage timing attacks (CWE-208).
 */
export function safeCompareKeys(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (!a || !b) return false;
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * Checks if a provided key matches any of the valid keys in constant-time.
 */
export function isValidApiKey(providedKey: unknown, validKeys: string[]): boolean {
  if (typeof providedKey !== 'string' || !providedKey.trim()) return false;
  let matched = false;
  for (const validKey of validKeys) {
    if (safeCompareKeys(providedKey, validKey)) {
      matched = true;
    }
  }
  return matched;
}

/**
 * Detects whether a hostname or IP is a sensitive cloud metadata or link-local address (CWE-918).
 * Blocks AWS/GCP/Azure/Alibaba metadata endpoints while permitting localhost and standard LAN IPs.
 */
export function isBlockedSsrfHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').trim();
  if (!h) return true;

  // Cloud metadata hostnames
  if (h === 'metadata.google.internal' || h === 'metadata' || h === 'instance-data') {
    return true;
  }

  // IPv4 Link-Local (169.254.0.0/16) and Alibaba Cloud metadata (100.100.100.200)
  if (/^169\.254\.\d+\.\d+$/.test(h) || h === '100.100.100.200') {
    return true;
  }

  // IPv6 Link-Local (fe80::/10)
  if (/^fe[89ab][0-9a-f]:/i.test(h)) {
    return true;
  }

  return false;
}

/**
 * Sanitizes and validates a browser userDataDir to ensure it stays strictly
 * inside ~/.arena-webbridge/ or the specified sandbox root (CWE-73).
 */
export function sanitizeUserDataDir(inputDir?: string, fallbackDefault?: string): string {
  const home = process.env.HOME || os.homedir() || '';
  const baseAllowed = home ? path.resolve(home, '.arena-webbridge') : path.resolve('/tmp/.arena-webbridge');

  if (!inputDir || typeof inputDir !== 'string' || !inputDir.trim()) {
    return fallbackDefault || path.join(baseAllowed, `profile-${Date.now().toString(36)}`);
  }

  let resolved = inputDir.trim();
  if (resolved.startsWith('~/')) {
    resolved = path.resolve(home, resolved.slice(2));
  } else {
    resolved = path.resolve(resolved);
  }

  const rel = path.relative(baseAllowed, resolved);
  // If the path escapes ~/.arena-webbridge via '..' or root, force it inside baseAllowed
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    const safeBaseName = path.basename(resolved).replace(/[^a-zA-Z0-9._-]/g, '_') || `profile-${Date.now().toString(36)}`;
    return path.join(baseAllowed, safeBaseName);
  }

  return resolved;
}

/**
 * Secret patterns to mask before prompts are sent to external web sessions.
 */
const SECRET_PATTERNS = [
  // Anthropic Keys (must be checked before generic sk-)
  { name: 'ANTHROPIC_API_KEY', regex: /sk-ant-[A-Za-z0-9_-]{32,}/g },
  // OpenAI Keys (sk- or sk-proj-, excluding sk-ant-)
  { name: 'OPENAI_API_KEY', regex: /sk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  // GitHub Tokens
  { name: 'GITHUB_TOKEN', regex: /gh[pousr]_[A-Za-z0-9_]{36,}/g },
  // AWS Access Keys
  { name: 'AWS_ACCESS_KEY', regex: /AKIA[0-9A-Z]{16}/g },
  // Google API Keys
  { name: 'GOOGLE_API_KEY', regex: /AIza[0-9A-Za-z_-]{35}/g },
  // Private Keys (PEM)
  { name: 'PRIVATE_KEY', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  // Generic password/secret assignments in text / .env
  { name: 'ENV_SECRET', regex: /(?:PASSWORD|SECRET|ACCESS_TOKEN|PRIVATE_KEY)\s*[:=]\s*["']?([A-Za-z0-9!@#$%^&*()_+=-]{8,})["']?/gi },
];

export interface RedactionResult {
  redactedText: string;
  secretsCount: number;
  mapping: Record<string, string>;
}

/**
 * Redacts known secret patterns from the text and returns replacement placeholders.
 */
export function redactSecrets(text: string): RedactionResult {
  if (!text || typeof text !== 'string') {
    return { redactedText: text, secretsCount: 0, mapping: {} };
  }

  let redactedText = text;
  const mapping: Record<string, string> = {};
  let counter = 0;

  for (const { name, regex } of SECRET_PATTERNS) {
    redactedText = redactedText.replace(regex, (match) => {
      counter++;
      const placeholder = `{{REDACTED_${name}_${counter}}}`;
      mapping[placeholder] = match;
      return placeholder;
    });
  }

  return {
    redactedText,
    secretsCount: counter,
    mapping,
  };
}

/**
 * Masks literal secret values (e.g. the exact API key we were given) out of
 * any text. Pattern-based redaction above cannot catch a provider that echoes
 * the key back inside an error message.
 */
export function maskLiteralSecrets(text: string, secrets: Array<string | undefined>): string {
  let out = typeof text === 'string' ? text : String(text ?? '');
  for (const secret of secrets) {
    if (!secret || typeof secret !== 'string' || secret.length < 6) continue;
    out = out.split(secret).join('[redacted]');
  }
  return out;
}

/**
 * Restores redacted placeholders in a response with their original secret values.
 */
export function restoreSecrets(text: string, mapping: Record<string, string>): string {
  if (!text || typeof text !== 'string' || !mapping || Object.keys(mapping).length === 0) {
    return text;
  }

  let restored = text;
  for (const [placeholder, original] of Object.entries(mapping)) {
    restored = restored.replaceAll(placeholder, original);
  }
  return restored;
}
