import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createCli, checkProfileStatus } from '../src/cli.js';
import { KNOWN_ARENA_MODELS } from '../src/arena/models.js';

describe('CLI - checkProfileStatus', () => {
  const tmpDir = path.join(os.tmpdir(), `cli-status-test-${Date.now()}`);

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should return exists: false and hasSessionData: false when directory does not exist', () => {
    const nonExistent = path.join(tmpDir, 'does-not-exist');
    const status = checkProfileStatus(nonExistent);

    expect(status.exists).toBe(false);
    expect(status.hasSessionData).toBe(false);
  });

  it('should return exists: true and hasSessionData: false when directory is empty', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const status = checkProfileStatus(tmpDir);

    expect(status.exists).toBe(true);
    expect(status.hasSessionData).toBe(false);
  });

  it('should return exists: true and hasSessionData: true when Default/Cookies or session files exist', () => {
    const cookiesDir = path.join(tmpDir, 'Default', 'Network');
    fs.mkdirSync(cookiesDir, { recursive: true });
    fs.writeFileSync(path.join(cookiesDir, 'Cookies'), 'dummy-cookie-data');

    const status = checkProfileStatus(tmpDir);

    expect(status.exists).toBe(true);
    expect(status.hasSessionData).toBe(true);
    expect(status.details?.hasCookies).toBe(true);
  });
});

describe('CLI - Command parsing and execution', () => {
  let logs: string[];
  let errors: string[];
  let tableLogs: unknown[];

  const mockLogger = {
    log: (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    },
    error: (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    },
    table: (data: unknown) => {
      tableLogs.push(data);
    },
  };

  beforeEach(() => {
    logs = [];
    errors = [];
    tableLogs = [];
  });

  it('should execute login command and invoke launchLogin', async () => {
    const mockLaunchLogin = vi.fn().mockResolvedValue(undefined);
    const mockBrowserManager = {
      launchLogin: mockLaunchLogin,
      close: vi.fn().mockResolvedValue(undefined),
    };

    const mockBrowserFactory = vi.fn().mockReturnValue(mockBrowserManager);

    const program = createCli({
      browserManagerFactory: mockBrowserFactory,
      logger: mockLogger,
      exitOverride: true,
    });

    await program.parseAsync([
      'node',
      'webbridge',
      'login',
      '--url',
      'https://custom.arena.ai',
      '--user-data-dir',
      '/tmp/custom-profile',
    ]);

    expect(mockBrowserFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        arenaBaseUrl: 'https://custom.arena.ai',
        userDataDir: '/tmp/custom-profile',
      })
    );
    expect(mockLaunchLogin).toHaveBeenCalledWith('https://custom.arena.ai');
    expect(logs.some((msg) => msg.includes('Opening browser for Arena login and Cloudflare verification'))).toBe(true);
  });

  it('should execute serve command with custom options', async () => {
    const mockListen = vi.fn().mockResolvedValue('http://127.0.0.1:9090');
    const mockApp = {
      listen: mockListen,
      close: vi.fn().mockResolvedValue(undefined),
    };
    const mockBrowserManager = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    const mockDriver = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    const mockBrowserFactory = vi.fn().mockReturnValue(mockBrowserManager);
    const mockDriverFactory = vi.fn().mockReturnValue(mockDriver);
    const mockServerFactory = vi.fn().mockReturnValue(mockApp);

    const program = createCli({
      browserManagerFactory: mockBrowserFactory,
      driverFactory: mockDriverFactory,
      serverFactory: mockServerFactory,
      logger: mockLogger,
      exitOverride: true,
    });

    await program.parseAsync([
      'node',
      'webbridge',
      'serve',
      '--port',
      '9090',
      '--host',
      '0.0.0.0',
      '--user-data-dir',
      '/tmp/serve-profile',
      '--headless',
      'false',
    ]);

    expect(mockBrowserFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 9090,
        host: '0.0.0.0',
        userDataDir: '/tmp/serve-profile',
        headless: false,
      })
    );
    expect(mockDriverFactory).toHaveBeenCalledWith(
      mockBrowserManager,
      expect.objectContaining({ port: 9090, host: '0.0.0.0' })
    );
    expect(mockServerFactory).toHaveBeenCalledWith(
      mockDriver,
      expect.objectContaining({ port: 9090, host: '0.0.0.0' })
    );
    expect(mockListen).toHaveBeenCalledWith({ port: 9090, host: '0.0.0.0' });
    expect(logs.some((msg) => msg.includes('Arena WebBridge listening at http://0.0.0.0:9090/v1'))).toBe(true);
  });

  it('should default to serve command when no subcommand is provided', async () => {
    const mockListen = vi.fn().mockResolvedValue('http://127.0.0.1:8989');
    const mockApp = {
      listen: mockListen,
      close: vi.fn().mockResolvedValue(undefined),
    };
    const mockBrowserManager = { close: vi.fn().mockResolvedValue(undefined) };
    const mockDriver = { close: vi.fn().mockResolvedValue(undefined) };

    const program = createCli({
      browserManagerFactory: vi.fn().mockReturnValue(mockBrowserManager),
      driverFactory: vi.fn().mockReturnValue(mockDriver),
      serverFactory: vi.fn().mockReturnValue(mockApp),
      logger: mockLogger,
      exitOverride: true,
    });

    await program.parseAsync(['node', 'webbridge', '--port', '8989']);

    expect(mockListen).toHaveBeenCalledWith({ port: 8989, host: '127.0.0.1' });
    expect(logs.some((msg) => msg.includes('Arena WebBridge listening at http://127.0.0.1:8989/v1'))).toBe(true);
  });

  it('should list models in tabular format by default', async () => {
    const program = createCli({
      logger: mockLogger,
      exitOverride: true,
    });

    await program.parseAsync(['node', 'webbridge', 'models']);

    // Check either table was called or logs contain models
    const hasModelsInTable = tableLogs.length > 0;
    const hasModelsInLogs = logs.some((msg) => msg.includes('claude-3-5-sonnet'));
    expect(hasModelsInTable || hasModelsInLogs).toBe(true);
  });

  it('should list models in JSON format with --json flag', async () => {
    const program = createCli({
      logger: mockLogger,
      exitOverride: true,
    });

    await program.parseAsync(['node', 'webbridge', 'models', '--json']);

    const jsonLog = logs.find((msg) => msg.includes('claude-3-5-sonnet'));
    expect(jsonLog).toBeDefined();
    const parsed = JSON.parse(jsonLog!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toEqual(expect.arrayContaining([...KNOWN_ARENA_MODELS]));
  });

  it('should check profile status with status command', async () => {
    const tmpDir = path.join(os.tmpdir(), `cli-status-cmd-${Date.now()}`);
    fs.mkdirSync(path.join(tmpDir, 'Default', 'Network'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'Default', 'Network', 'Cookies'), 'dummy-data');

    try {
      const program = createCli({
        logger: mockLogger,
        exitOverride: true,
      });

      await program.parseAsync(['node', 'webbridge', 'status', '--user-data-dir', tmpDir]);

      expect(logs.some((msg) => msg.includes('Profile Directory:'))).toBe(true);
      expect(logs.some((msg) => msg.includes('Session Data:') || msg.includes('Cookies'))).toBe(true);
    } finally {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });

  it('should list models with formatted string if logger.table is not provided', async () => {
    const loggerWithoutTable = {
      log: (msg: unknown) => logs.push(String(msg)),
      error: (msg: unknown) => errors.push(String(msg)),
    };

    const program = createCli({
      logger: loggerWithoutTable,
      exitOverride: true,
    });

    await program.parseAsync(['node', 'webbridge', 'models']);
    expect(logs.some((msg) => msg.includes('claude-3-5-sonnet'))).toBe(true);
  });

  it('should propagate error when login fails', async () => {
    const mockLaunchLogin = vi.fn().mockRejectedValue(new Error('Browser crashed'));
    const mockBrowserManager = {
      launchLogin: mockLaunchLogin,
      close: vi.fn().mockResolvedValue(undefined),
    };

    const program = createCli({
      browserManagerFactory: vi.fn().mockReturnValue(mockBrowserManager),
      logger: mockLogger,
      exitOverride: true,
    });

    await expect(
      program.parseAsync(['node', 'webbridge', 'login'])
    ).rejects.toThrow('Browser crashed');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should output json status when status command is called with --json', async () => {
    const nonExistent = path.join(os.tmpdir(), `non-existent-${Date.now()}`);
    const program = createCli({
      logger: mockLogger,
      exitOverride: true,
    });

    await program.parseAsync(['node', 'webbridge', 'status', '--user-data-dir', nonExistent, '--json']);

    const jsonLog = logs.find((msg) => msg.includes('"exists"'));
    expect(jsonLog).toBeDefined();
    const parsed = JSON.parse(jsonLog!);
    expect(parsed.exists).toBe(false);
    expect(parsed.hasSessionData).toBe(false);
  });
});
