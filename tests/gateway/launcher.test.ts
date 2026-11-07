import { describe, it, expect } from 'vitest';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import fs from 'node:fs';

const execFileAsync = promisify(execFile);
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

describe('EMO.ai launcher', () => {
  it('prints help with gateway outputs', async () => {
    const { stdout } = await execFileAsync(npx, ['--yes', 'tsx', 'src/emo-ai.ts', '--help'], {
      cwd: '/Users/emamabdullaziz/Desktop/web',
      env: { ...process.env, PATH: `/Users/emamabdullaziz/.nvm/versions/node/v26.7.0/bin:${process.env.PATH}` },
      timeout: 30000,
    });
    expect(stdout).toMatch(/EMO\.ai|gateway/i);
    expect(stdout).toContain('mac.ai/v1');
    expect(stdout).toContain('mac');
  }, 45000);

  it('has executable scripts/EMO.ai wrapper', async () => {
    const stat = fs.statSync('/Users/emamabdullaziz/Desktop/web/scripts/EMO.ai');
    expect(stat.isFile()).toBe(true);
    // executable bit on unix
    expect((stat.mode & 0o111) !== 0).toBe(true);
  });
});
