/**
 * Profile-owner IPC transport (Task 11).
 *
 * A LOCAL-ONLY loopback HTTP channel (127.0.0.1, ephemeral port) that lets a
 * gateway process forward a chat execution to the process that actually owns
 * the browser profile. Never bound to a public interface.
 *
 * Security contract (owner mandatory mod #4 — binding):
 *  - per-process random 32-byte token, sent in `x-emo-ipc-token`;
 *  - the token is compared TIMING-SAFE (length-guarded timingSafeEqual);
 *  - requests larger than `maxBodyBytes` (default 16MB) are refused (413);
 *  - the client refuses non-loopback endpoints and NEVER follows redirects;
 *  - the sidecar token file is written with mode 0600 (POSIX; on Windows the
 *    platform default ACL of the user profile applies — documented in
 *    docs/superpowers/plans/2026-11-12-emo-multi-gateway-resilience.md);
 *  - tokens and conversation content are never logged here.
 *
 * Wire protocol (NDJSON, one JSON object per line):
 *   owner → receiver: {"type":"accepted"} | {"type":"chunk","text":"…"} |
 *                     {"type":"done","content":"…"} | {"type":"error","message":"…"}
 * `accepted` is emitted only AFTER the caller's onAccepted() hook returned
 * (the caller performs the atomic durable reservation BEFORE calling the
 * hook chain — order enforced by profile-owner-router).
 *
 * Backpressure (owner mandatory mod #4): every response write checks
 * `write() === false` and awaits `drain` before the next chunk. The idle
 * timeout is configurable and resets per chunk — there is deliberately NO
 * fixed total generation timeout in Task 11 (total timeouts belong to
 * Task 14's configurable providerTimeoutsMs).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createHash } from 'node:crypto';

export const IPC_PROTOCOL_VERSION = 1;
export const IPC_PATH = '/emo-ipc/v1/execute';
export const IPC_TOKEN_HEADER = 'x-emo-ipc-token';

export interface IpcCommandPayload {
  protocolVersion: number;
  profileDir: string;
  ownerInstanceId: string;
  epoch: string;
  forwardId: string;
  broker: { key: string; apiKeyScope: string; providerId: string; requestId: string };
  model: string;
  messages: unknown;
  sessionKey: string;
  stream: boolean;
}

export interface OwnerIpcHooks {
  /** Identity/epoch gate. Runs before `accepted` is emitted. */
  validate(cmd: IpcCommandPayload): 'ok' | 'stale_epoch' | 'unauthorized';
  /** The actual execution. Runs after `accepted`. `signal` aborts on client disconnect / idle timeout. */
  execute(cmd: IpcCommandPayload, onChunk: (text: string) => void, signal: AbortSignal): Promise<{ content: string }>;
  /**
   * Durable reservation hook (owner mandatory mods #1/#2): runs BEFORE
   * `accepted` is sent; receives the command so the owner can perform the
   * atomic attachForExecution. A thrown error here refuses the command with
   * 409 (e.g. duplicate forwardId → no second execution ever starts) — the
   * receiver then decides from the DURABLE broker store.
   */
  onAccepted(cmd: IpcCommandPayload): void | Promise<void>;
}

export interface OwnerIpcServerOptions {
  profileDir: string;
  ownerInstanceId: string;
  epoch: string;
  /** Root of the shared durable state (verified fingerprint goes into the sidecar). */
  stateRoot: string;
  /** Path of the shared RequestBroker store (verified fingerprint goes into the sidecar). */
  brokerStorePath: string;
  hooks: OwnerIpcHooks;
  maxBodyBytes?: number;
  /** Idle timeout BETWEEN chunks; resets per chunk. Default 10 minutes. */
  idleTimeoutMs?: number;
}

export interface OwnerIpcServerHandle {
  endpoint: string;
  token: string;
  close(): Promise<void>;
}

/** Normalizes a profile dir: realpath when it exists, else resolved absolute.
 * Robust across processes: when the dir itself does not exist yet (fresh
 * profile), the deepest EXISTING ancestor is realpathed and the remainder is
 * re-joined, so two processes naming the same not-yet-created profile still
 * agree on one canonical key. */
export function normalizeProfileDir(profileDir: string): string {
  const abs = path.resolve(profileDir);
  // Walk up until an EXISTING ancestor is found; realpath it and re-join the
  // remainder, so two processes naming the same not-yet-created profile
  // still agree on one canonical key.
  const root = path.parse(abs).root;
  const tail: string[] = [];
  let probe = abs;
  while (probe !== root) {
    try {
      return path.join(fs.realpathSync(probe), ...tail);
    } catch {
      tail.unshift(path.basename(probe));
      probe = path.dirname(probe);
    }
  }
  try {
    return path.join(fs.realpathSync(root), ...tail);
  } catch {
    return abs;
  }
}

/** Sidecar path for a normalized profile dir (name is a digest — no path leakage). */
export function ownerIpcSidecarPath(stateRoot: string, profileDir: string): string {
  const normalized = normalizeProfileDir(profileDir);
  const digest = createHash('sha1').update(normalized).digest('hex');
  return path.join(stateRoot, 'owner-ipc', `${digest}.json`);
}

export function writeOwnerIpcSidecar(
  stateRoot: string,
  profileDir: string,
  data: { endpoint: string; token: string; ownerInstanceId: string; epoch: string; stateRoot: string; brokerStorePath: string; protocolVersion: number }
): string {
  const file = ownerIpcSidecarPath(stateRoot, profileDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Includes state fingerprints so a receiver can PROVE shared durable state
  // before routing (owner mandatory mod #4) — paths normalized first.
  const body = {
    ...data,
    stateRootNormalized: normalizeProfileDir(data.stateRoot),
    brokerStorePathNormalized: normalizeProfileDir(data.brokerStorePath),
    stateRootHash: sha1(normalizeProfileDir(data.stateRoot)),
    brokerStoreHash: sha1(normalizeProfileDir(data.brokerStorePath)),
  };
  // O_TRUNC + 0600 in one atomic open; chmod after in case the file pre-existed.
  const fd = fs.openSync(file, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(body));
  } finally {
    fs.closeSync(fd);
  }
  try { fs.chmodSync(file, 0o600); } catch { /* platform best-effort */ }
  return file;
}

function sha1(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function timingSafeTokenMatch(a: string | undefined, b: string): boolean {
  if (typeof a !== 'string' || a.length === 0) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Reads a body with a hard size cap; rejects with a 413 marker when exceeded. */
function readBody(req: http.IncomingMessage, maxBytes: number): Promise<{ body: string; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts: Buffer[] = [];
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        parts.length = 0;
        return;
      }
      parts.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => resolve({ body: Buffer.concat(parts).toString('utf8'), tooLarge }));
  });
}

/** One NDJSON line with explicit backpressure: await when the socket buffers. */
function writeNdjson(res: http.ServerResponse, obj: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    let ok = false;
    const onErr = (e: Error) => { if (!ok) { ok = true; reject(e); } };
    res.write(JSON.stringify(obj) + '\n', () => {
      res.off('error', onErr);
      if (!ok) { ok = true; resolve(); }
    });
    res.once('error', onErr);
  });
}

function flushDrain(res: http.ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    if ((res as unknown as { writableNeedDrain?: boolean }).writableNeedDrain) res.once('drain', () => resolve());
    else resolve();
  });
}

export async function startOwnerIpcServer(opts: OwnerIpcServerOptions): Promise<OwnerIpcServerHandle> {
  const token = crypto.randomBytes(32).toString('hex');
  const maxBodyBytes = opts.maxBodyBytes ?? 16 * 1024 * 1024;
  const idleTimeoutMs = opts.idleTimeoutMs ?? 10 * 60 * 1000;

  const server = http.createServer(async (req, res) => {
    // Local-only guard at the socket level as well (belt and suspenders with the bind address).
    const remote = req.socket.remoteAddress ?? '';
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
      res.writeHead(403).end();
      return;
    }
    if (req.method !== 'POST' || !req.url?.startsWith(IPC_PATH)) {
      res.writeHead(404).end();
      return;
    }
    if (!timingSafeTokenMatch(req.headers[IPC_TOKEN_HEADER] as string | undefined, token)) {
      res.writeHead(401).end();
      return;
    }
    const { body, tooLarge } = await readBody(req, maxBodyBytes);
    if (tooLarge) {
      res.writeHead(413).end();
      return;
    }
    let payload: IpcCommandPayload;
    try {
      payload = JSON.parse(body) as IpcCommandPayload;
      if (!payload || typeof payload !== 'object' || payload.protocolVersion !== IPC_PROTOCOL_VERSION || !payload.broker || typeof payload.forwardId !== 'string') {
        res.writeHead(400).end();
        return;
      }
    } catch {
      res.writeHead(400).end();
      return;
    }

    let verdict: 'ok' | 'stale_epoch' | 'unauthorized';
    try {
      verdict = opts.hooks.validate(payload);
    } catch {
      res.writeHead(500).end();
      return;
    }
    if (verdict === 'stale_epoch') {
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'stale_epoch' }));
      return;
    }
    if (verdict === 'unauthorized') {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    // Reservation hook FIRST (durable, done by the owner hooks), then accepted.
    try {
      await opts.hooks.onAccepted(payload);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      // 409: the reservation was refused (duplicate forwardId / already
      // attached) — NO execution starts; the receiver settles durably.
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'already_attached', message }));
      return;
    }

    res.writeHead(200, { 'content-type': 'application/x-emo-ndjson', 'cache-control': 'no-store' });

    // Abort execution when the receiver disconnects or the idle timeout fires.
    const abort = new AbortController();
    let closed = false;
    req.on('close', () => {
      if (!closed) { closed = true; abort.abort(); }
    });

    // Idle watchdog: reset per chunk, never a fixed total timeout.
    let idleTimer: NodeJS.Timeout | null = null;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!closed) { closed = true; abort.abort(); res.destroy(); }
      }, idleTimeoutMs);
      if (typeof idleTimer.unref === 'function') idleTimer.unref();
    };
    resetIdle();

    try {
      await writeNdjson(res, { type: 'accepted' });
      await flushDrain(res);
      const result = await opts.hooks.execute(
        payload,
        async (text: string) => {
          if (closed) return;
          await writeNdjson(res, { type: 'chunk', text });
          await flushDrain(res);
          resetIdle();
        },
        abort.signal
      );
      if (!closed) {
        await writeNdjson(res, { type: 'done', content: result?.content ?? '' });
        await flushDrain(res);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (!closed) {
        try {
          await writeNdjson(res, { type: 'error', message });
          await flushDrain(res);
        } catch { /* socket gone */ }
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      closed = true;
      res.end();
    }
  });

  const endpoint: string = await new Promise((resolve, reject) => {
    server.once('error', reject);
    // Bind to loopback ONLY.
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') reject(new Error('IPC server failed to bind'));
      else resolve(`http://127.0.0.1:${addr.port}`);
    });
  });

  // The endpoint is advertised ONLY after the server is actually listening.
  const sidecar = writeOwnerIpcSidecar(opts.stateRoot, opts.profileDir, {
    endpoint,
    token,
    ownerInstanceId: opts.ownerInstanceId,
    epoch: opts.epoch,
    stateRoot: opts.stateRoot,
    brokerStorePath: opts.brokerStorePath,
    protocolVersion: IPC_PROTOCOL_VERSION,
  });

  return {
    endpoint,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        try { fs.rmSync(sidecar, { force: true }); } catch { /* best effort */ }
        server.close(() => resolve());
      }),
  };
}

export interface ForwardResult {
  accepted: boolean;
  content: string;
  /** Present when the owner reported an execution error after accepting. */
  error?: string;
}

export interface ForwardOptions {
  onChunk?: (text: string) => void;
  signal?: AbortSignal;
  /** Idle timeout BETWEEN lines; resets per line. Default 10 minutes. */
  idleTimeoutMs?: number;
}

/** True only for literal loopback http endpoints. */
function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export async function forwardToOwner(
  endpoint: string,
  token: string,
  payload: IpcCommandPayload,
  opts: ForwardOptions = {}
): Promise<ForwardResult> {
  // Owner mandatory mod #4: the CLIENT refuses non-loopback endpoints — a
  // token must never be sent off-machine.
  if (!isLoopbackEndpoint(endpoint)) {
    throw new Error(`refusing non-loopback IPC endpoint: ${endpoint}`);
  }
  const idleTimeoutMs = opts.idleTimeoutMs ?? 10 * 60 * 1000;
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });

  // Idle watchdog between NDJSON lines.
  let idleTimer: NodeJS.Timeout | null = setTimeout(() => controller.abort(), idleTimeoutMs);
  if (typeof idleTimer.unref === 'function') idleTimer.unref();
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs);
    if (typeof idleTimer.unref === 'function') idleTimer.unref();
  };

  let res: Response;
  try {
    res = await fetch(`${endpoint}${IPC_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [IPC_TOKEN_HEADER]: token },
      body: JSON.stringify(payload),
      // Redirects are refused, never followed.
      redirect: 'manual',
      signal: controller.signal,
    });
  } catch (e) {
    if (idleTimer) clearTimeout(idleTimer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
    throw e;
  }

  try {
    if (res.status >= 300 && res.status < 400) {
      throw new Error('owner IPC endpoint attempted a redirect — refused (loopback-only contract)');
    }
    if (res.status === 409) {
      let body = '';
      try { body = await res.text(); } catch { /* ignore */ }
      if (body.includes('stale_epoch')) throw new Error('stale_epoch');
      if (body.includes('already_attached')) throw new Error('already_attached');
      throw new Error('owner IPC conflict: 409');
    }
    if (res.status === 401 || res.status === 403) throw new Error(`owner IPC auth refused: ${res.status}`);
    if (res.status === 413) throw new Error('owner IPC payload too large: 413');
    if (!res.ok) throw new Error(`owner IPC refused: ${res.status}`);

    const acceptedLine = { accepted: false, content: '' };
    let error: string | undefined;
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let doneReading = false;
    while (!doneReading) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        resetIdle();
        let evt: { type?: string; text?: string; content?: string; message?: string };
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type === 'accepted') acceptedLine.accepted = true;
        else if (evt.type === 'chunk') { if (evt.text && opts.onChunk) opts.onChunk(evt.text); }
        else if (evt.type === 'done') acceptedLine.content = evt.content ?? '';
        else if (evt.type === 'error') { error = evt.message ?? 'owner execution error'; }
      }
      if (acceptedLine.accepted && (acceptedLine.content || error)) doneReading = true;
    }
    if (error !== undefined) return { ...acceptedLine, error };
    return acceptedLine;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}

/** Reads a sidecar token file (0600) for a normalized profile dir. */
export function readOwnerIpcSidecar(stateRoot: string, profileDir: string): {
  endpoint: string; token: string; ownerInstanceId: string; epoch: string;
  stateRootHash: string; brokerStoreHash: string; protocolVersion: number;
} | null {
  const file = ownerIpcSidecarPath(stateRoot, profileDir);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const IPC_DEFAULTS = { stateRoot: path.join(os.homedir(), '.arena-webbridge', 'state') };
