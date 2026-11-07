import os from 'node:os';
import path from 'node:path';
import type { Config } from './types.js';

/**
 * Resolves a file path, expanding leading '~' to the user's home directory.
 */
export function resolveHomePath(filePath: string): string {
  if (filePath === '~') {
    return os.homedir();
  }
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return path.resolve(filePath);
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: Config = {
  port: 8989,
  host: '127.0.0.1',
  userDataDir: path.join(os.homedir(), '.arena-webbridge', 'chrome-profile'),
  arenaBaseUrl: 'https://arena.ai',
  headless: true,
};

export const DEFAULT_ZAI_BASE_URL = 'https://api.z.ai/api/paas/v4/';
export const DEFAULT_ZAI_MODEL = 'glm-5.3-flash';
export const DEFAULT_ZAI_MODEL_PREFIXES = ['glm-'];

export const DEFAULT_ZAI_WEB_BASE_URL = 'https://chat.z.ai';
export const DEFAULT_ZAI_WEB_USER_DATA_DIR = path.join(
  os.homedir(),
  '.arena-webbridge',
  'zai-profile'
);
export const DEFAULT_ZAI_WEB_TIMEOUT_MS = 180_000;
export const DEFAULT_ZAI_WEB_CAPTCHA_WAIT_MS = 180_000;

/**
 * Loads configuration with overrides from environment variables and explicit options.
 *
 * Precedence:
 * 1. Explicit overrides
 * 2. Environment variables (`PORT`, `HOST`, `USER_DATA_DIR`, `ARENA_BASE_URL`, `HEADLESS`,
 *    `ZAI_API_KEY`, `ZAI_BASE_URL`, `ZAI_DEFAULT_MODEL`)
 * 3. Default configuration
 */
export function loadConfig(overrides?: Partial<Config>): Config {
  const rawPort = process.env.ARENA_PORT || process.env.PORT;
  const envPort = rawPort ? parseInt(rawPort, 10) : undefined;
  const envHost = process.env.HOST;
  const envUserDataDir = process.env.USER_DATA_DIR
    ? resolveHomePath(process.env.USER_DATA_DIR)
    : undefined;
  const envArenaBaseUrl = process.env.ARENA_BASE_URL;
  const envHeadless =
    process.env.HEADLESS !== undefined
      ? process.env.HEADLESS === 'true'
      : undefined;

  // Z.AI provider is enabled when an API key is present (env or override)
  const zaiApiKey = overrides?.zai?.apiKey ?? process.env.ZAI_API_KEY;
  const zai: Config['zai'] | undefined = zaiApiKey
    ? {
        apiKey: zaiApiKey,
        baseUrl:
          overrides?.zai?.baseUrl ??
          process.env.ZAI_BASE_URL ??
          DEFAULT_ZAI_BASE_URL,
        defaultModel:
          overrides?.zai?.defaultModel ??
          process.env.ZAI_DEFAULT_MODEL ??
          DEFAULT_ZAI_MODEL,
        modelPrefixes:
          overrides?.zai?.modelPrefixes ?? DEFAULT_ZAI_MODEL_PREFIXES,
      }
    : overrides?.zai;

  // Z.AI web-session (chat.z.ai scraping); enabled via env ZAI_WEB_ENABLED=1 or override
  const envZaiWebEnabled = process.env.ZAI_WEB_ENABLED;
  const zaiWebEnabled =
    overrides?.zaiWeb?.enabled ?? (envZaiWebEnabled === '1' || envZaiWebEnabled === 'true');
  const zaiWebTimeoutRaw = process.env.ZAI_WEB_TIMEOUT_MS
    ? parseInt(process.env.ZAI_WEB_TIMEOUT_MS, 10)
    : undefined;
  const zaiWebCaptchaWaitRaw = process.env.ZAI_WEB_CAPTCHA_WAIT_MS
    ? parseInt(process.env.ZAI_WEB_CAPTCHA_WAIT_MS, 10)
    : undefined;
  const zaiWebHeadless =
    process.env.ZAI_WEB_HEADLESS !== undefined
      ? process.env.ZAI_WEB_HEADLESS === 'true'
      : undefined;
  const zaiWeb: Config['zaiWeb'] | undefined = zaiWebEnabled
    ? {
        enabled: true,
        userDataDir:
          overrides?.zaiWeb?.userDataDir !== undefined
            ? resolveHomePath(overrides.zaiWeb.userDataDir)
            : (process.env.ZAI_WEB_USER_DATA_DIR
                ? resolveHomePath(process.env.ZAI_WEB_USER_DATA_DIR)
                : DEFAULT_ZAI_WEB_USER_DATA_DIR),
        baseUrl:
          overrides?.zaiWeb?.baseUrl ??
          process.env.ZAI_WEB_BASE_URL ??
          DEFAULT_ZAI_WEB_BASE_URL,
        headless: overrides?.zaiWeb?.headless ?? zaiWebHeadless ?? false,
        timeoutMs: overrides?.zaiWeb?.timeoutMs ?? (zaiWebTimeoutRaw && !isNaN(zaiWebTimeoutRaw) ? zaiWebTimeoutRaw : DEFAULT_ZAI_WEB_TIMEOUT_MS),
        captchaWaitMs: overrides?.zaiWeb?.captchaWaitMs ?? (zaiWebCaptchaWaitRaw && !isNaN(zaiWebCaptchaWaitRaw) ? zaiWebCaptchaWaitRaw : DEFAULT_ZAI_WEB_CAPTCHA_WAIT_MS),
      }
    : overrides?.zaiWeb;

  return {
    port: overrides?.port ?? (envPort && !isNaN(envPort) ? envPort : DEFAULT_CONFIG.port),
    host: overrides?.host ?? envHost ?? DEFAULT_CONFIG.host,
    userDataDir:
      overrides?.userDataDir !== undefined
        ? resolveHomePath(overrides.userDataDir)
        : (envUserDataDir ?? DEFAULT_CONFIG.userDataDir),
    arenaBaseUrl: overrides?.arenaBaseUrl ?? envArenaBaseUrl ?? DEFAULT_CONFIG.arenaBaseUrl,
    headless: overrides?.headless ?? envHeadless ?? DEFAULT_CONFIG.headless,
    zai,
    zaiWeb,
  };
}
