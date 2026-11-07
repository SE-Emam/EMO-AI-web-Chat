import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, DEFAULT_CONFIG } from '../src/config.js';

describe('Config Loader', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clean relevant env vars before each test
    delete process.env.PORT;
    delete process.env.ARENA_PORT;
    delete process.env.HOST;
    delete process.env.USER_DATA_DIR;
    delete process.env.ARENA_BASE_URL;
    delete process.env.HEADLESS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should load default configuration when no env vars or overrides are set', () => {
    const config = loadConfig();

    const expectedUserDataDir = path.join(os.homedir(), '.arena-webbridge', 'chrome-profile');

    expect(config.port).toBe(8989);
    expect(config.host).toBe('127.0.0.1');
    expect(config.userDataDir).toBe(expectedUserDataDir);
    expect(config.arenaBaseUrl).toBe('https://arena.ai');
    expect(config.headless).toBe(true);
  });

  it('should override port via ARENA_PORT environment variable', () => {
    process.env.ARENA_PORT = '9999';
    const config = loadConfig();
    expect(config.port).toBe(9999);
  });

  it('should override configuration via environment variables', () => {
    process.env.PORT = '9090';
    process.env.HOST = '0.0.0.0';
    process.env.USER_DATA_DIR = '/tmp/test-profile';
    process.env.ARENA_BASE_URL = 'https://staging.arena.ai';
    process.env.HEADLESS = 'false';

    const config = loadConfig();

    expect(config.port).toBe(9090);
    expect(config.host).toBe('0.0.0.0');
    expect(config.userDataDir).toBe('/tmp/test-profile');
    expect(config.arenaBaseUrl).toBe('https://staging.arena.ai');
    expect(config.headless).toBe(false);
  });

  it('should expand tilde (~) in USER_DATA_DIR environment variable', () => {
    process.env.USER_DATA_DIR = '~/custom/profile';

    const config = loadConfig();
    const expectedPath = path.join(os.homedir(), 'custom/profile');

    expect(config.userDataDir).toBe(expectedPath);
  });

  it('should prioritize explicit overrides over environment variables and defaults', () => {
    process.env.PORT = '9090';
    process.env.HOST = '0.0.0.0';

    const config = loadConfig({
      port: 7070,
      host: '10.0.0.1',
      headless: false,
    });

    expect(config.port).toBe(7070);
    expect(config.host).toBe('10.0.0.1');
    expect(config.headless).toBe(false);
  });

  it('should export DEFAULT_CONFIG matching specifications', () => {
    expect(DEFAULT_CONFIG.port).toBe(8989);
    expect(DEFAULT_CONFIG.host).toBe('127.0.0.1');
    expect(DEFAULT_CONFIG.arenaBaseUrl).toBe('https://arena.ai');
    expect(DEFAULT_CONFIG.headless).toBe(true);
  });
});
