import { describe, it, expect } from 'vitest';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('EMO.ai launcher', () => {
  it('prints help with gateway outputs', async () => {
    const tsx = path.join(projectRoot, 'node_modules/.bin/tsx');
    const exe = fs.existsSync(tsx) ? tsx : npx;
    const args = fs.existsSync(tsx)
      ? [path.join(projectRoot, 'src/emo-ai.ts'), '--help']
      : ['--yes', 'tsx', path.join(projectRoot, 'src/emo-ai.ts'), '--help'];
    const { stdout } = await execFileAsync(exe, args, {
      cwd: projectRoot,
      env: process.env,
      timeout: 30000,
    });
    expect(stdout).toMatch(/EMO\.ai|gateway/i);
    expect(stdout).toContain('mac.ai/v1');
    expect(stdout).toContain('mac');
  }, 45000);

  it('has executable scripts/EMO.ai wrapper', async () => {
    const p = path.join(projectRoot, 'scripts/EMO.ai');
    const stat = fs.statSync(p);
    expect(stat.isFile()).toBe(true);
    // executable bit on unix
    expect((stat.mode & 0o111) !== 0).toBe(true);
  });
});
