/**
 * Task 11 — Profile Owner IPC (loopback HTTP transport).
 *
 * TDD Step 1 (failing-first unit tests): the transport modules
 * `src/ipc/profile-owner-transport.ts` do not exist yet — every test below
 * must FAIL on the missing import until Step 2 implements them.
 *
 * Security contract under test (owner mandatory mod #4):
 *  - loopback 127.0.0.1 only, ephemeral port;
 *  - per-process random token, compared timing-safe;
 *  - 401 without / with a wrong token;
 *  - 413 when the request exceeds the size limit;
 *  - client refuses non-loopback endpoints and redirects;
 *  - sidecar token file written with mode 0600 (POSIX).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startOwnerIpcServer, forwardToOwner } from '../../src/ipc/profile-owner-transport.js';

interface ServerHandle {
  endpoint: string;
  token: string;
  close(): Promise<void>;
}

const dirs: string[] = [];
const servers: ServerHandle[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close().catch(() => {});
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const TOKEN_HEADER = 'x-emo-ipc-token';

function makeEnv() {
  const d = mkdtempSync(path.join(tmpdir(), 'emo-ipc-'));
  dirs.push(d);
  const stateRoot = path.join(d, 'state');
  const brokerStorePath = path.join(stateRoot, 'request-broker.json');
  return { dir: d, stateRoot, brokerStorePath };
}

async function startServer(extraHooks: Record<string, unknown> = {}): Promise<ServerHandle & { env: ReturnType<typeof makeEnv> }> {
  const env = makeEnv();
  const handle = await startOwnerIpcServer({
    profileDir: path.join(env.dir, 'profile'),
    ownerInstanceId: 'owner-A',
    epoch: 'epoch-A1',
    stateRoot: env.stateRoot,
    brokerStorePath: env.brokerStorePath,
    hooks: {
      validate: () => 'ok' as const,
      execute: async (_cmd: unknown, onChunk: (chunk: string) => void) => {
        onChunk('hello ');
        onChunk('world');
        return { content: 'hello world' };
      },
      onAccepted: () => {},
      ...extraHooks,
    },
  });
  const s = { ...handle, close: handle.close };
  servers.push(s);
  return { ...s, env };
}

const basePayload = () => ({
  protocolVersion: 1,
  profileDir: '/profiles/p1',
  ownerInstanceId: 'owner-A',
  epoch: 'epoch-A1',
  forwardId: 'fwd-1',
  broker: { key: 'k1', apiKeyScope: 'scope', providerId: 'chatgpt-web', requestId: 'req-1' },
  model: 'gpt-x',
  messages: [{ role: 'user', content: 'hi' }],
  sessionKey: 'sess-1',
  stream: false,
});

describe('profile-owner-transport (Task 11 step 1 — unit)', () => {
  it('starts on 127.0.0.1 with an ephemeral port and writes the sidecar token file with mode 0600', async () => {
    const { endpoint, token, env } = await startServer();
    expect(endpoint.startsWith('http://127.0.0.1:')).toBe(true);
    expect(endpoint).not.toMatch(/:(80|443)$/);
    const sidecarPath = path.join(env.stateRoot, 'owner-ipc', `${path.basename(env.dir)}.json`);
    // The sidecar must exist somewhere under stateRoot/owner-ipc/ — we discover by listing
    const ownerDir = path.join(env.stateRoot, 'owner-ipc');
    const files = existsSync(ownerDir) ? (await import('node:fs')).readdirSync(ownerDir) : [];
    expect(files.length).toBe(1);
    const sidecar = path.join(ownerDir, files[0]!);
    const st = statSync(sidecar);
    // POSIX only: 0600 = 384
    if (process.platform !== 'win32') expect((st.mode & 0o777)).toBe(0o600);
    const data = JSON.parse(readFileSync(sidecar, 'utf8'));
    expect(data.token).toBe(token);
    expect(data.endpoint).toBe(endpoint);
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it('rejects a request with NO token (401)', async () => {
    const { endpoint } = await startServer();
    const res = await fetch(`${endpoint}/emo-ipc/v1/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(basePayload()),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a request with a WRONG token (401, timing-safe compare)', async () => {
    const { endpoint } = await startServer();
    const res = await fetch(`${endpoint}/emo-ipc/v1/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TOKEN_HEADER]: 'a'.repeat(64) },
      body: JSON.stringify(basePayload()),
    });
    expect(res.status).toBe(401);
  });

  it('accepts a request with the CORRECT token and returns accepted + content', async () => {
    const { endpoint, token } = await startServer();
    const { content, accepted } = await forwardToOwner(endpoint, token, basePayload());
    expect(accepted).toBe(true);
    expect(content).toBe('hello world');
  });

  it('rejects an oversized request body with 413', async () => {
    const { endpoint, token } = await startServer();
    const big = basePayload();
    (big as Record<string, unknown>).messages = [{ role: 'user', content: 'x'.repeat(17 * 1024 * 1024) }];
    const res = await fetch(`${endpoint}/emo-ipc/v1/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TOKEN_HEADER]: token },
      body: JSON.stringify(big),
    });
    expect(res.status).toBe(413);
  });

  it('client refuses to forward to a NON-loopback endpoint', async () => {
    await expect(
      forwardToOwner('http://10.0.0.5:9999', 'tok', basePayload())
    ).rejects.toThrow(/loopback/i);
  });

  it('client refuses to follow redirects (302 → error, never replayed elsewhere)', async () => {
    const { token } = await startServer();
    // A loopback endpoint that redirects — must be refused, not followed.
    const http = await import('node:http');
    const redirecter = http.createServer((_req, res) => {
      res.writeHead(302, { location: 'http://127.0.0.1:1/steal-token-here' });
      res.end();
    });
    await new Promise<void>((r) => redirecter.listen(0, '127.0.0.1', r));
    const addr = redirecter.address() as { port: number };
    try {
      await expect(
        forwardToOwner(`http://127.0.0.1:${addr.port}`, token, basePayload())
      ).rejects.toThrow(/redirect/i);
    } finally {
      await new Promise<void>((r) => redirecter.close(() => r()));
    }
  });

  it('execute hook failure after accepted → error event, not a crash', async () => {
    const { endpoint, token } = await startServer({
      execute: async () => { throw new Error('driver exploded'); },
    });
    const { content, accepted } = await forwardToOwner(endpoint, token, basePayload());
    expect(accepted).toBe(true);
    expect(content).toBe('');
  });

  it('duplicate forwardId at the OWNER → 409 already_attached and NO second execution (defense-in-depth)', async () => {
    let execCount = 0;
    const seen = new Set<string>();
    const { endpoint, token } = await startServer({
      onAccepted: (cmd: { forwardId: string }) => {
        if (seen.has(cmd.forwardId)) throw new Error('duplicate_forward');
        seen.add(cmd.forwardId);
      },
      execute: async () => { execCount += 1; return { content: 'ran' }; },
    });
    const p1 = { ...basePayload(), forwardId: 'dup-1' };
    const first = await forwardToOwner(endpoint, token, p1);
    expect(first.accepted).toBe(true);
    await expect(forwardToOwner(endpoint, token, p1)).rejects.toThrow(/already_attached/);
    expect(execCount).toBe(1); // the duplicate never started a second execution
  });
});
