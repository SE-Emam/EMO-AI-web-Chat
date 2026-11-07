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

/**
 * Loads configuration with overrides from environment variables and explicit options.
 *
 * Precedence:
 * 1. Explicit overrides
 * 2. Environment variables (`PORT`, `HOST`, `USER_DATA_DIR`, `ARENA_BASE_URL`, `HEADLESS`)
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

  return {
    port: overrides?.port ?? (envPort && !isNaN(envPort) ? envPort : DEFAULT_CONFIG.port),
    host: overrides?.host ?? envHost ?? DEFAULT_CONFIG.host,
    userDataDir:
      overrides?.userDataDir !== undefined
        ? resolveHomePath(overrides.userDataDir)
        : (envUserDataDir ?? DEFAULT_CONFIG.userDataDir),
    arenaBaseUrl: overrides?.arenaBaseUrl ?? envArenaBaseUrl ?? DEFAULT_CONFIG.arenaBaseUrl,
    headless: overrides?.headless ?? envHeadless ?? DEFAULT_CONFIG.headless,
  };
}
