/**
 * Task 14 — circuit-breaker probe race fixture (REAL child processes).
 *
 * Parent mode: spawns TWO real child processes that race `startProbe` on the
 * SAME breaker store at the same time, then prints ONE JSON line:
 *   { results: [{ granted, state, role }, ...] }
 * Prober mode (env BREAKER_PROBE_ROLE=prober): performs the probe and prints
 * its own JSON line.
 *
 * Owner rule under test: never two concurrent HALF_OPEN probes for the same
 * (providerId, profileDir) across processes.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const storePath = process.argv[2];
if (!storePath) {
  console.error('usage: breaker-probe-racer.ts <storePath>');
  process.exit(1);
}

if (process.env.BREAKER_PROBE_ROLE === 'prober') {
  const { CircuitBreaker } = await import('../../src/arena/circuit-breaker.js');
  const b = new CircuitBreaker({
    providerId: 'chatgpt-web',
    profileDir: '/pX',
    storePath,
    threshold: 3,
    recoveryMs: 50,
  });
  const r = await b.startProbe();
  // Hold the probe lease long enough for BOTH racers to overlap in time —
  // exiting immediately would look like a crashed prober (dead pid), which
  // is legitimately takeover-able and would defeat the race.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  console.log(JSON.stringify({ granted: r.granted, state: b.state(), role: process.pid }));
  process.exit(0);
}

const self = fileURLToPath(import.meta.url);
const children = [0, 1].map(
  () =>
    spawn(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), self, storePath], {
      env: { ...process.env, BREAKER_PROBE_ROLE: 'prober' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
);

const results = await Promise.all(
  children.map(
    (child) =>
      new Promise<{ granted: boolean; state: string; role: number }>((resolve, reject) => {
        let out = '';
        child.stdout!.on('data', (d) => (out += String(d)));
        child.on('exit', (code) => {
          if (code !== 0) return reject(new Error(`prober exited ${code}: ${out}`));
          resolve(JSON.parse(out.trim().split('\n').pop()!));
        });
      })
  )
);

console.log(JSON.stringify({ results }));
process.exit(0);
