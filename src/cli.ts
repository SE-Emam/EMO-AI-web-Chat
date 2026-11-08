#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_ZAI_MODEL_PREFIXES, loadConfig, resolveHomePath } from './config.js';
import { matchesProvider } from './arena/providers.js';
import { BrowserManager } from './browser/manager.js';
import { DefaultArenaDriver } from './arena/driver.js';
import { ZaiDriver } from './arena/zai-driver.js';
import { RoutingDriver, type DriverRoute } from './arena/routing-driver.js';
import { createServer } from './server/app.js';
import { KNOWN_ARENA_MODELS } from './arena/models.js';
import type { ArenaDriver, Config } from './types.js';
import { ZAI_MODELS } from './arena/zai-models.js';
import { ZaiWebDriver } from './arena/zai-web-driver.js';
import { ClaudeWebDriver } from './arena/claude-web-driver.js';
import { TencentAiWebDriver } from './arena/tencent-ai-web-driver.js';
import { GeminiWebDriver } from './arena/gemini-web-driver.js';
import { QwenWebDriver } from './arena/qwen-web-driver.js';

export interface ProfileStatus {
  userDataDir: string;
  exists: boolean;
  hasSessionData: boolean;
  details?: {
    hasDefaultDir: boolean;
    hasCookies: boolean;
    hasLocalStorage: boolean;
    fileCount: number;
  };
}

/** Whether a Z.AI REST key is configured at process level (for CLI listings). */
function configHasZai(): boolean {
  return typeof process.env.ZAI_API_KEY === 'string' && process.env.ZAI_API_KEY.length > 0;
}

/**
 * Checks whether the Chrome user profile directory exists and contains persistent session data.
 */
export function checkProfileStatus(targetDir?: string): ProfileStatus {
  const dir = targetDir ? resolveHomePath(targetDir) : loadConfig().userDataDir;
  if (!fs.existsSync(dir)) {
    return {
      userDataDir: dir,
      exists: false,
      hasSessionData: false,
    };
  }

  const defaultDir = path.join(dir, 'Default');
  const hasDefaultDir = fs.existsSync(defaultDir);

  const cookiePaths = [
    path.join(dir, 'Default', 'Network', 'Cookies'),
    path.join(dir, 'Default', 'Cookies'),
    path.join(dir, 'Network', 'Cookies'),
    path.join(dir, 'Cookies'),
  ];
  const hasCookies = cookiePaths.some((p) => fs.existsSync(p));

  const storagePaths = [
    path.join(dir, 'Default', 'Local Storage'),
    path.join(dir, 'Local Storage'),
    path.join(dir, 'Default', 'Session Storage'),
    path.join(dir, 'Session Storage'),
  ];
  const hasLocalStorage = storagePaths.some((p) => fs.existsSync(p));

  let fileCount = 0;
  try {
    fileCount = fs.readdirSync(dir).length;
  } catch {}

  const hasSessionData = hasCookies || hasLocalStorage || (hasDefaultDir && fileCount > 1);

  return {
    userDataDir: dir,
    exists: true,
    hasSessionData,
    details: {
      hasDefaultDir,
      hasCookies,
      hasLocalStorage,
      fileCount,
    },
  };
}

export interface CliServices {
  browserManagerFactory?: (config?: Partial<Config>) => {
    launchLogin: (url?: string) => Promise<void>;
    close: () => Promise<void>;
  };
  driverFactory?: (browserManager: any, config?: Partial<Config>) => ArenaDriver;
  serverFactory?: (driver: ArenaDriver, config?: Partial<Config>) => {
    listen: (opts: { port: number; host: string }) => Promise<unknown>;
    close: () => Promise<unknown>;
  };
  logger?: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    table?: (data: unknown) => void;
  };
  exitOverride?: boolean;
}

/**
 * Creates and configures the Commander CLI program.
 */
export function createCli(services: CliServices = {}): Command {
  const logger = services.logger || console;
  const program = new Command();

  if (services.exitOverride) {
    program.exitOverride();
  }

  program
    .name('webbridge')
    .description('OpenAI-compatible Web-to-API bridge for Arena (arena.ai)')
    .version('0.1.0');

  // Command: login
  program
    .command('login')
    .description('Open interactive browser for Arena login and Cloudflare verification')
    .option('--url <url>', 'Arena URL to navigate to for login')
    .option('--user-data-dir <dir>', 'Persistent browser profile directory')
    .action(async (options) => {
      const configOverrides: Partial<Config> = {};
      if (options.url) configOverrides.arenaBaseUrl = options.url;
      if (options.userDataDir) configOverrides.userDataDir = options.userDataDir;

      const config = loadConfig(configOverrides);
      const browserManager = services.browserManagerFactory
        ? services.browserManagerFactory(config)
        : new BrowserManager(config);

      logger.log(
        'Opening browser for Arena login and Cloudflare verification... Close the window or press Ctrl+C when done.'
      );

      try {
        await browserManager.launchLogin(options.url || config.arenaBaseUrl);
        logger.log('Browser session closed. Profile saved.');
      } catch (err) {
        logger.error('Login error:', err);
        throw err;
      }
    });

  // Command: serve (default command)
  program
    .command('serve', { isDefault: true })
    .description('Start the OpenAI-compatible HTTP API server')
    .option('-p, --port <port>', 'Port to listen on', (val) => parseInt(val, 10))
    .option('-h, --host <host>', 'Host address to bind')
    .option('--user-data-dir <dir>', 'Persistent browser profile directory')
    .option(
      '--headless <boolean>',
      'Run browser in headless mode (true/false)',
      (val: string) => val === 'true'
    )
    .action(async (options) => {
      const configOverrides: Partial<Config> = {};
      if (options.port !== undefined && !isNaN(options.port)) configOverrides.port = options.port;
      if (options.host !== undefined) configOverrides.host = options.host;
      if (options.userDataDir !== undefined) configOverrides.userDataDir = options.userDataDir;
      if (options.headless !== undefined) configOverrides.headless = options.headless;

      const config = loadConfig(configOverrides);
      const browserManager = services.browserManagerFactory
        ? services.browserManagerFactory(config)
        : new BrowserManager(config);

      const arenaDriver = services.driverFactory
        ? services.driverFactory(browserManager, config)
        : new DefaultArenaDriver(browserManager as BrowserManager, config);

      // Provider chain (first match wins, failures fall back to the next):
      // Prefixes/defaults are derived from WEB_PROVIDERS via matchesProvider()
      // (src/arena/providers.ts) — do not add new prefix literals here.
      //   claude-web:* / claudeai:* → claude.ai web session (if enabled) — explicit prefix avoids Arena claude-* conflict
      //   tencent-ai:* / tencentai:* → aistudio.tencent.ai web session (if enabled)
      //   gemini-web:* / geminiweb:* → gemini.google.com web session (if enabled) — explicit to avoid hijacking gemini-* API names
      //   glm-* → Z.AI REST API (if ZAI_API_KEY) → chat.z.ai web session (if enabled) → Arena browser
      //   else  → Arena browser directly
      // `zai-api` is excluded from the web registry by design (REST, not scraping);
      // its predicate derives from DEFAULT_ZAI_MODEL_PREFIXES in src/config.ts.
      // `zai-web` uses matchesProvider() so both `zai-web:*` and `glm-*` route here
      // (previously the CLI only matched `glm-*`, dropping the `zai-web:` prefix —
      // this unification fixes that drift and matches provider-manager behavior).
      const routes: DriverRoute[] = [];
      if (config.claudeWeb?.enabled) {
        console.log(`Claude web-session provider enabled (profile: ${config.claudeWeb.userDataDir}, headed=${!config.claudeWeb.headless}). Login/challenges are solved by you in the visible window. Use model prefix claude-web:<model> or claudeai:<model>.`);
        routes.push({
          name: 'claude-web',
          driver: new ClaudeWebDriver(config.claudeWeb),
          matches: (m) => matchesProvider('claude-web', m),
        });
      }
      if (config.tencentAiWeb?.enabled) {
        console.log(`Tencent AI Studio web-session provider enabled (profile: ${config.tencentAiWeb.userDataDir}, headed=${!config.tencentAiWeb.headless}). Login/verification solved by you in the visible window. Use model prefix tencent-ai:<model> or tencentai:<model>.`);
        routes.push({
          name: 'tencent-ai-web',
          driver: new TencentAiWebDriver(config.tencentAiWeb),
          matches: (m) => matchesProvider('tencent-ai-web', m),
        });
      }
      if (config.geminiWeb?.enabled) {
        console.log(`Gemini web-session provider enabled (profile: ${config.geminiWeb.userDataDir}, headed=${!config.geminiWeb.headless}). Google login/verification solved by you in the visible window. Use model prefix gemini-web:<model> or geminiweb:<model>.`);
        routes.push({
          name: 'gemini-web',
          driver: new GeminiWebDriver(config.geminiWeb),
          matches: (m) => matchesProvider('gemini-web', m),
        });
      }
      if (config.qwenWeb?.enabled) {
        console.log(`Qwen web-session provider enabled (profile: ${config.qwenWeb.userDataDir}, headed=${!config.qwenWeb.headless}). Login/verification solved by you in the visible window. Use model prefix qwen-web:<model> or qwenweb:<model>.`);
        routes.push({
          name: 'qwen-web',
          driver: new QwenWebDriver(config.qwenWeb),
          matches: (m) => matchesProvider('qwen-web', m),
        });
      }
      if (config.zai) {
        console.log(`Z.AI REST provider enabled (default: ${config.zai.defaultModel}). glm-* requests go direct to api.z.ai.`);
        routes.push({ name: 'zai-api', driver: new ZaiDriver(config.zai), matches: (m) => DEFAULT_ZAI_MODEL_PREFIXES.some((p) => m.startsWith(p)) });
      }
      if (config.zaiWeb?.enabled) {
        console.log(`Z.AI web-session provider enabled (profile: ${config.zaiWeb.userDataDir}, headed=${!config.zaiWeb.headless}). Captchas are solved by you in the visible window.`);
        routes.push({ name: 'zai-web', driver: new ZaiWebDriver(config.zaiWeb), matches: (m) => matchesProvider('zai-web', m) });
      }
      routes.push({ name: 'arena-browser', driver: arenaDriver, matches: (m) => matchesProvider('arena-browser', m) });

      let driver: ArenaDriver = new RoutingDriver(routes);

      const app = services.serverFactory
        ? services.serverFactory(driver, config)
        : createServer(driver, config);

      let cleaningUp = false;
      const cleanup = async () => {
        if (cleaningUp) return;
        cleaningUp = true;
        try {
          await app.close();
        } catch {}
        try {
          if (driver.close) {
            await driver.close();
          }
        } catch {}
        process.exit(0);
      };

      process.once('SIGINT', cleanup);
      process.once('SIGTERM', cleanup);

      await app.listen({ port: config.port, host: config.host });
      logger.log(`Arena WebBridge listening at http://${config.host}:${config.port}/v1`);
    });

  // Command: models
  const availableModels = (): string[] => Array.from(new Set([...ZAI_MODELS, ...KNOWN_ARENA_MODELS]));

  program
    .command('models')
    .description('List available models (Z.AI first when a key is configured, then Arena)')
    .option('--json', 'Output models in JSON format')
    .action((options) => {
      const zaiFirst = configHasZai();
      const list = zaiFirst ? availableModels() : KNOWN_ARENA_MODELS;
      if (options.json) {
        logger.log(JSON.stringify(list, null, 2));
      } else {
        if (logger.table) {
          logger.table(
            list.map((id, index) => ({
              '#': index + 1,
              'Model ID': id,
              Provider: (configHasZai() && ZAI_MODELS.includes(id)) ? 'z.ai' : 'arena',
            }))
          );
        } else {
          const rows = list.map(
            (id, index) => `${String(index + 1).padStart(2, ' ')}. ${id}`
          );
          logger.log(`Available Models (${list.length}):\n${rows.join('\n')}`);
        }
      }
    });

  // Command: status
  program
    .command('status')
    .description('Check browser profile and session status')
    .option('--user-data-dir <dir>', 'Persistent browser profile directory')
    .option('--json', 'Output status in JSON format')
    .action((options) => {
      const status = checkProfileStatus(options.userDataDir);
      if (options.json) {
        logger.log(JSON.stringify(status, null, 2));
        return;
      }

      logger.log('=== Arena WebBridge Profile Status ===');
      logger.log(`Profile Directory: ${status.userDataDir}`);
      logger.log(`Directory Exists:  ${status.exists ? 'Yes' : 'No'}`);
      logger.log(
        `Session Data:      ${
          status.hasSessionData
            ? 'Found (authenticated / active session)'
            : 'Not found (run "webbridge login" first)'
        }`
      );
      if (status.details) {
        logger.log(
          `Details:           DefaultDir=${status.details.hasDefaultDir}, Cookies=${status.details.hasCookies}, LocalStorage=${status.details.hasLocalStorage}, Files=${status.details.fileCount}`
        );
      }
    });

  return program;
}

const isDirectRun = (): boolean => {
  if (typeof process === 'undefined' || !process.argv || !process.argv[1]) {
    return false;
  }
  try {
    const entryPath = fs.existsSync(process.argv[1])
      ? fs.realpathSync(process.argv[1])
      : path.resolve(process.argv[1]);
    const thisPath = fs.realpathSync(fileURLToPath(import.meta.url));
    return entryPath === thisPath;
  } catch {
    return false;
  }
};

if (isDirectRun()) {
  const cli = createCli();
  cli.parseAsync(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
