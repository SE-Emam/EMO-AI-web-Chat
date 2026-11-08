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

export const DEFAULT_CLAUDE_WEB_BASE_URL = 'https://claude.ai';
export const DEFAULT_CLAUDE_WEB_USER_DATA_DIR = path.join(
  os.homedir(),
  '.arena-webbridge',
  'claude-profile'
);
export const DEFAULT_CLAUDE_WEB_TIMEOUT_MS = 300_000;

export const DEFAULT_TENCENT_AI_WEB_BASE_URL = 'https://aistudio.tencent.ai';
export const DEFAULT_TENCENT_AI_WEB_USER_DATA_DIR = path.join(
  os.homedir(),
  '.arena-webbridge',
  'tencent-ai-profile'
);
export const DEFAULT_TENCENT_AI_WEB_TIMEOUT_MS = 300_000;

export const DEFAULT_GEMINI_WEB_BASE_URL = 'https://gemini.google.com';
export const DEFAULT_GEMINI_WEB_USER_DATA_DIR = path.join(
  os.homedir(),
  '.arena-webbridge',
  'gemini-profile'
);
export const DEFAULT_GEMINI_WEB_TIMEOUT_MS = 300_000;

export const DEFAULT_QWEN_WEB_BASE_URL = 'https://chat.qwen.ai';
export const DEFAULT_QWEN_WEB_USER_DATA_DIR = path.join(
  os.homedir(),
  '.arena-webbridge',
  'qwen-profile'
);
export const DEFAULT_QWEN_WEB_TIMEOUT_MS = 300_000;

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

  // Claude web-session (claude.ai scraping); enabled via CLAUDE_WEB_ENABLED=1 or override
  const envClaudeWebEnabled = process.env.CLAUDE_WEB_ENABLED;
  const claudeWebEnabled =
    overrides?.claudeWeb?.enabled ?? (envClaudeWebEnabled === '1' || envClaudeWebEnabled === 'true');
  const claudeWebTimeoutRaw = process.env.CLAUDE_WEB_TIMEOUT_MS
    ? parseInt(process.env.CLAUDE_WEB_TIMEOUT_MS, 10)
    : undefined;
  const claudeWebHeadless =
    process.env.CLAUDE_WEB_HEADLESS !== undefined
      ? process.env.CLAUDE_WEB_HEADLESS === 'true'
      : undefined;
  const claudeWeb: Config['claudeWeb'] | undefined = claudeWebEnabled
    ? {
        enabled: true,
        userDataDir:
          overrides?.claudeWeb?.userDataDir !== undefined
            ? resolveHomePath(overrides.claudeWeb.userDataDir)
            : (process.env.CLAUDE_WEB_USER_DATA_DIR
                ? resolveHomePath(process.env.CLAUDE_WEB_USER_DATA_DIR)
                : DEFAULT_CLAUDE_WEB_USER_DATA_DIR),
        baseUrl:
          overrides?.claudeWeb?.baseUrl ??
          process.env.CLAUDE_WEB_BASE_URL ??
          DEFAULT_CLAUDE_WEB_BASE_URL,
        headless: overrides?.claudeWeb?.headless ?? claudeWebHeadless ?? false,
        timeoutMs:
          overrides?.claudeWeb?.timeoutMs ??
          (claudeWebTimeoutRaw && !isNaN(claudeWebTimeoutRaw)
            ? claudeWebTimeoutRaw
            : DEFAULT_CLAUDE_WEB_TIMEOUT_MS),
      }
    : overrides?.claudeWeb;

  // Tencent AI Studio web-session (aistudio.tencent.ai / Hy AI Studio); enabled via TENCENT_AI_WEB_ENABLED=1
  const envTencentAiWebEnabled = process.env.TENCENT_AI_WEB_ENABLED;
  const tencentAiWebEnabled =
    overrides?.tencentAiWeb?.enabled ?? (envTencentAiWebEnabled === '1' || envTencentAiWebEnabled === 'true');
  const tencentAiWebTimeoutRaw = process.env.TENCENT_AI_WEB_TIMEOUT_MS
    ? parseInt(process.env.TENCENT_AI_WEB_TIMEOUT_MS, 10)
    : undefined;
  const tencentAiWebHeadless =
    process.env.TENCENT_AI_WEB_HEADLESS !== undefined
      ? process.env.TENCENT_AI_WEB_HEADLESS === 'true'
      : undefined;
  const tencentAiWeb: Config['tencentAiWeb'] | undefined = tencentAiWebEnabled
    ? {
        enabled: true,
        userDataDir:
          overrides?.tencentAiWeb?.userDataDir !== undefined
            ? resolveHomePath(overrides.tencentAiWeb.userDataDir)
            : (process.env.TENCENT_AI_WEB_USER_DATA_DIR
                ? resolveHomePath(process.env.TENCENT_AI_WEB_USER_DATA_DIR)
                : DEFAULT_TENCENT_AI_WEB_USER_DATA_DIR),
        baseUrl:
          overrides?.tencentAiWeb?.baseUrl ??
          process.env.TENCENT_AI_WEB_BASE_URL ??
          DEFAULT_TENCENT_AI_WEB_BASE_URL,
        headless: overrides?.tencentAiWeb?.headless ?? tencentAiWebHeadless ?? false,
        timeoutMs:
          overrides?.tencentAiWeb?.timeoutMs ??
          (tencentAiWebTimeoutRaw && !isNaN(tencentAiWebTimeoutRaw)
            ? tencentAiWebTimeoutRaw
            : DEFAULT_TENCENT_AI_WEB_TIMEOUT_MS),
      }
    : overrides?.tencentAiWeb;

  // Gemini web-session (gemini.google.com); enabled via GEMINI_WEB_ENABLED=1
  const envGeminiWebEnabled = process.env.GEMINI_WEB_ENABLED;
  const geminiWebEnabled =
    overrides?.geminiWeb?.enabled ?? (envGeminiWebEnabled === '1' || envGeminiWebEnabled === 'true');
  const geminiWebTimeoutRaw = process.env.GEMINI_WEB_TIMEOUT_MS
    ? parseInt(process.env.GEMINI_WEB_TIMEOUT_MS, 10)
    : undefined;
  const geminiWebHeadless =
    process.env.GEMINI_WEB_HEADLESS !== undefined
      ? process.env.GEMINI_WEB_HEADLESS === 'true'
      : undefined;
  const geminiWeb: Config['geminiWeb'] | undefined = geminiWebEnabled
    ? {
        enabled: true,
        userDataDir:
          overrides?.geminiWeb?.userDataDir !== undefined
            ? resolveHomePath(overrides.geminiWeb.userDataDir)
            : (process.env.GEMINI_WEB_USER_DATA_DIR
                ? resolveHomePath(process.env.GEMINI_WEB_USER_DATA_DIR)
                : DEFAULT_GEMINI_WEB_USER_DATA_DIR),
        baseUrl:
          overrides?.geminiWeb?.baseUrl ??
          process.env.GEMINI_WEB_BASE_URL ??
          DEFAULT_GEMINI_WEB_BASE_URL,
        headless: overrides?.geminiWeb?.headless ?? geminiWebHeadless ?? false,
        timeoutMs:
          overrides?.geminiWeb?.timeoutMs ??
          (geminiWebTimeoutRaw && !isNaN(geminiWebTimeoutRaw)
            ? geminiWebTimeoutRaw
            : DEFAULT_GEMINI_WEB_TIMEOUT_MS),
      }
    : overrides?.geminiWeb;

  // Qwen web-session (chat.qwen.ai); enabled via QWEN_WEB_ENABLED=1
  const envQwenWebEnabled = process.env.QWEN_WEB_ENABLED;
  const qwenWebEnabled =
    overrides?.qwenWeb?.enabled ?? (envQwenWebEnabled === '1' || envQwenWebEnabled === 'true');
  const qwenWebTimeoutRaw = process.env.QWEN_WEB_TIMEOUT_MS
    ? parseInt(process.env.QWEN_WEB_TIMEOUT_MS, 10)
    : undefined;
  const qwenWebHeadless =
    process.env.QWEN_WEB_HEADLESS !== undefined
      ? process.env.QWEN_WEB_HEADLESS === 'true'
      : undefined;
  const qwenWeb: Config['qwenWeb'] | undefined = qwenWebEnabled
    ? {
        enabled: true,
        userDataDir:
          overrides?.qwenWeb?.userDataDir !== undefined
            ? resolveHomePath(overrides.qwenWeb.userDataDir)
            : (process.env.QWEN_WEB_USER_DATA_DIR
                ? resolveHomePath(process.env.QWEN_WEB_USER_DATA_DIR)
                : DEFAULT_QWEN_WEB_USER_DATA_DIR),
        baseUrl:
          overrides?.qwenWeb?.baseUrl ??
          process.env.QWEN_WEB_BASE_URL ??
          DEFAULT_QWEN_WEB_BASE_URL,
        headless: overrides?.qwenWeb?.headless ?? qwenWebHeadless ?? false,
        timeoutMs:
          overrides?.qwenWeb?.timeoutMs ??
          (qwenWebTimeoutRaw && !isNaN(qwenWebTimeoutRaw)
            ? qwenWebTimeoutRaw
            : DEFAULT_QWEN_WEB_TIMEOUT_MS),
      }
    : overrides?.qwenWeb;

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
    claudeWeb,
    tencentAiWeb,
    geminiWeb,
    qwenWeb,
  };
}
