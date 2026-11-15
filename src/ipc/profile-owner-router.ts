/**
 * Profile Owner Router (owner mandatory mods #3/#4).
 *
 * Intercepts ProfileBusyError and forwards the request over the loopback IPC
 * channel to the process that actually owns the browser profile:
 *
 *   Gateway 2 → Router → Owner Gateway 1 → Playwright → Chat
 *
 * Refusal rules (each rethrows the ORIGINAL ProfileBusyError — no takeover,
 * no silent provider/account switch):
 *  - no advertised IPC endpoint (endpoint written only after the server listens);
 *  - ledger entry no longer matches the busy error's owner/epoch (stale epoch);
 *  - owner pid dead;
 *  - shared-state proof fails: the receiver and the owner must use the SAME
 *    normalized broker store + state root, otherwise Idempotency claims
 *    would be false .
 *
 * Forward failure handling is decided from the DURABLE broker store via
 * settleForwardFailure — an IPC timeout alone NEVER allows re-execution
 * (owner mandatory mods #1/#2).
 */
import { createHash } from 'node:crypto';
import type { ChatMessage } from '../types.js';
import { ProfileBusyError } from '../arena/profile-busy-error.js';
import {
  defaultOwnershipStorePath,
  OwnershipLedger,
} from '../sessions/ownership-ledger.js';
import {
  forwardToOwner,
  normalizeProfileDir,
  readOwnerIpcSidecar,
  startOwnerIpcServer,
  IPC_PROTOCOL_VERSION,
  IPC_DEFAULTS,
  type IpcCommandPayload,
  type OwnerIpcHooks,
  type OwnerIpcServerHandle,
} from './profile-owner-transport.js';
import { defaultBrokerStorePath } from '../protocol/request-broker.js';
import type {
  AttachedController,
  AttachExecutor,
  ExecutionAttachment,
} from '../protocol/request-broker.js';
import type { ArenaDriver } from '../types.js';

/**
 * dynamic owner-routing wrapper .
 *
 * Wraps the driver resolution at the ACTUAL provider/profile selection point.
 * The resolver is called PER REQUEST (never a captured static driver), so it
 * reflects `manager.getActiveDriver()` AFTER account switches, RoutingDriver
 * chains, and the start() path. On ProfileBusyError it forwards to the
 * owning process; if routing is not safely possible the ORIGINAL busy error
 * propagates (legacy 503 behavior — no takeover, no silent switch).
 */
export class OwnerRoutingDriver implements ArenaDriver {
  constructor(
    private readonly opts: {
      resolve: () => ArenaDriver;
      router: ProfileOwnerRouter;
      nextForwardId: () => string;
      /** Request-scoped receiver broker context (claim-once happens at the receiver). */
      getBrokerContext?: () => ForwardBrokerContext | null;
    }
  ) {}

  listModels(): Promise<string[]> {
    return this.opts.resolve().listModels();
  }

  async sendMessage(
    model: string,
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
    sessionKey?: string
  ): Promise<string> {
    if (signal?.aborted) throw new Error('Request was aborted');
    const driver = this.opts.resolve();
    try {
      return await driver.sendMessage(model, messages, onChunk, signal, sessionKey);
    } catch (err: unknown) {
      if (err instanceof ProfileBusyError) {
        return await this.opts.router.routeToOwner(
          err,
          {
            model, messages, sessionKey, onChunk, signal,
            broker: this.opts.getBrokerContext?.() ?? undefined,
          },
          this.opts.nextForwardId()
        );
      }
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.opts.resolve().close?.();
  }
}

/** Receiver-side broker reservation context (per request, via AsyncLocalStorage in app.ts). */
export interface ForwardBrokerContext {
  key: string;
  apiKeyScope: string;
  providerId: string;
  requestId: string;
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === 'EPERM';
  }
}

export interface ForwardCommand {
  model: string;
  messages: ChatMessage[];
  sessionKey?: string;
  onChunk?: (chunk: string) => void;
  signal?: AbortSignal;
  /** Receiver-side broker reservation (claim-once happens at the receiver). */
  broker?: { key: string; apiKeyScope: string; providerId: string; requestId: string };
  stream?: boolean;
}

/** Raised when the forward itself failed; carries the durable settle outcome. */
export class ForwardedExecutionError extends Error {
  statusCode: number;
  settleOutcome: 'failed_retryable' | 'unconfirmed' | 'completed';
  constructor(message: string, outcome: 'failed_retryable' | 'unconfirmed' | 'completed') {
    super(message);
    this.name = 'ForwardedExecutionError';
    this.statusCode = outcome === 'unconfirmed' ? 409 : 502;
    this.settleOutcome = outcome;
  }
}

export class ProfileOwnerRouter {
  private readonly stateRoot: string;
  private readonly brokerStorePath: string;
  private readonly ledger: OwnershipLedger;

  constructor(opts: { stateRoot: string; brokerStorePath: string; ledgerPath?: string }) {
    this.stateRoot = opts.stateRoot;
    this.brokerStorePath = opts.brokerStorePath;
    this.ledger = new OwnershipLedger(opts.ledgerPath ?? defaultOwnershipStorePath());
  }

  /**
   * Tries to route to the owner. Returns the owner's final content, or
   * RETHROWS the original ProfileBusyError when routing is not safely
   * possible (the caller's fail-safe is the legacy busy behavior).
   */
  async routeToOwner(busy: ProfileBusyError, cmd: ForwardCommand, forwardId: string): Promise<string> {
    const profileDir = normalizeProfileDir(busy.details.profileDir);
    const entry = this.ledger.get(profileDir);
    const sidecar = readOwnerIpcSidecar(this.stateRoot, profileDir);

    // Shared durable state proof (owner mod #4): refuse rather than pretend.
    const myBrokerHash = sha1(normalizeProfileDir(this.brokerStorePath));
    if (!sidecar || sidecar.brokerStoreHash !== myBrokerHash) throw busy;
    if (!entry || entry.ownerInstanceId !== busy.details.ownerInstanceId) throw busy;
    if (entry.epoch !== busy.details.epoch) throw busy; // stale epoch — owner re-incarnated
    if (!entry.ipcEndpoint || entry.ipcEndpoint !== sidecar.endpoint) throw busy;
    if (!pidAlive(entry.pid)) throw busy; // dead owner → legacy recovery path, not forwarding

    const payload: IpcCommandPayload = {
      protocolVersion: IPC_PROTOCOL_VERSION,
      profileDir,
      ownerInstanceId: busy.details.ownerInstanceId,
      epoch: busy.details.epoch,
      forwardId,
      broker: cmd.broker ?? { key: '', apiKeyScope: '', providerId: '', requestId: forwardId },
      model: cmd.model,
      messages: cmd.messages,
      sessionKey: cmd.sessionKey ?? '',
      stream: !!cmd.stream,
    };

    let result;
    try {
      result = await forwardToOwner(sidecar.endpoint, sidecar.token, payload, {
        onChunk: cmd.onChunk,
        signal: cmd.signal,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'stale_epoch') throw busy;
      const outcome = await this.settleAfterForwardFailure(payload, entry.pid, msg);
      // A duplicate forward whose first execution already COMPLETED → replay
      // the stored result (idempotent re-acknowledgement; no re-execution).
      if (msg.includes('already_attached') && outcome === 'completed') {
        const stored = await this.readStoredResult(payload.broker?.key);
        if (stored !== undefined) return stored;
      }
      throw new ForwardedExecutionError(`owner forward failed: ${msg}`, outcome);
    }
    if (result.error !== undefined) {
      const outcome = await this.settleAfterForwardFailure(payload, entry.pid, result.error);
      throw new ForwardedExecutionError(`owner execution failed: ${result.error}`, outcome);
    }
    return result.content;
  }

  private async readStoredResult(key?: string): Promise<string | undefined> {
    if (!key) return undefined;
    try {
      const { RequestBroker } = await import('../protocol/request-broker.js');
      const broker = new RequestBroker(this.brokerStorePath);
      const entry = broker.get(key);
      const result = entry?.result as { content?: string } | undefined;
      if (typeof result?.content === 'string') return result.content;
      if (typeof entry?.result === 'string') return entry.result;
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async settleAfterForwardFailure(
    payload: IpcCommandPayload,
    ownerPid: number,
    reason: string
  ): Promise<'failed_retryable' | 'unconfirmed' | 'completed'> {
    const key = payload.broker?.key;
    if (!key) return 'failed_retryable';
    try {
      const { RequestBroker } = await import('../protocol/request-broker.js');
      const broker = new RequestBroker(this.brokerStorePath);
      const outcome = await broker.settleForwardFailure(key, { executorPid: ownerPid });
      return outcome.outcome === 'completed' ? 'completed' : outcome.outcome;
    } catch {
      void reason;
      return 'unconfirmed';
    }
  }
}

/**
 * OWNER-SIDE execution hooks : wires the loopback IPC server to the
 * local driver with the atomic durable reservation enforced:
 *
 *  1. validate: owner identity + epoch gate (stale commands refused);
 *  2. onAccepted: atomic attachForExecution on the SHARED broker store —
 *     first caller wins; a duplicate IPC command (same forwardId replayed or
 *     another executor) is refused → 409, NO second execution;
 *  3. execute: markSent (conservatively, right before the local driver may
 *     send), run the local driver (which owns the session queue), then
 *     complete/fail through the identity+token-guarded controller.
 */
export function createOwnerExecutionHooks(opts: {
  resolve: () => ArenaDriver;
  brokerStorePath: string;
  ownerInstanceId: string;
  epoch: string;
  pid: number;
  /** 'before-execute' (default): markSent fires before the local driver may send. 'manual': the host calls markSentIfPending itself. */
  markSentPolicy?: 'before-execute' | 'manual';
  /** Observability hook for hosts/fixtures (crash points, markers). */
  onAttached?: (cmd: IpcCommandPayload, attachment: ExecutionAttachment, controller: AttachedController) => void;
}): OwnerIpcHooks & { markSentIfPending(): Promise<void> } {
  const seenForwardIds = new Set<string>();
  let current: { attachment: ExecutionAttachment; controller: AttachedController } | null = null;
  let sentFired = false;

  const proof = (executionToken: string) => ({ executorInstanceId: opts.ownerInstanceId, executionToken });
  const loadBroker = async () => {
    const { RequestBroker } = await import('../protocol/request-broker.js');
    return new RequestBroker(opts.brokerStorePath);
  };

  return {
    validate: (cmd) =>
      cmd.epoch === opts.epoch && cmd.ownerInstanceId === opts.ownerInstanceId ? 'ok' : 'stale_epoch',

    onAccepted: async (cmd) => {
      if (seenForwardIds.has(cmd.forwardId)) {
        throw new Error('duplicate_forward: this IPC command was already reserved');
      }
      seenForwardIds.add(cmd.forwardId);
      const broker = await loadBroker();
      const executor: AttachExecutor = {
        executorInstanceId: opts.ownerInstanceId,
        executorEpoch: opts.epoch,
        executorPid: opts.pid,
        forwardId: cmd.forwardId,
      };
      if (cmd.broker?.key) {
        const r = await broker.attachForExecution(cmd.broker.key, executor);
        if (!r.attached) {
          throw new Error(`already_attached: ${r.reason}`);
        }
        current = { attachment: r.attachment, controller: r.controller };
        sentFired = false;
        opts.onAttached?.(cmd, r.attachment, r.controller);
      }
    },

    execute: async (cmd, onChunk, signal) => {
      let content: string;
      try {
        if (opts.markSentPolicy !== 'manual' && current && !sentFired) {
          await current.controller.markSent(proof(current.attachment.executionToken));
          sentFired = true;
        }
        content = await opts.resolve().sendMessage(
          cmd.model,
          (cmd.messages ?? []) as ChatMessage[],
          (c: string) => { void onChunk(c); },
          signal,
          cmd.sessionKey || undefined
        );
        if (current) {
          await current.controller.complete({ content }, proof(current.attachment.executionToken));
        }
        return { content };
      } catch (e: unknown) {
        if (current) {
          await current.controller
            .fail({ retryable: true, error: e instanceof Error ? e.message : String(e) }, proof(current.attachment.executionToken))
            .catch(() => {});
        }
        throw e;
      }
    },

    markSentIfPending: async () => {
      if (current && !sentFired) {
        await current.controller.markSent(proof(current.attachment.executionToken));
        sentFired = true;
      }
    },
  };
}

/**
 * OWNER-SIDE lifecycle : exactly ONE loopback IPC server per
 * (process, profile), started only AFTER the profile claim succeeded and
 * registered on the ledger entry only once it is actually listening.
 * Re-claim with a new epoch (browser re-incarnation) restarts the server.
 * Startup failure degrades to the legacy safe-busy behavior — never breaks
 * the driver.
 */
export class OwnerIpcManager {
  private static readonly running = new Map<string, { server: OwnerIpcServerHandle; epoch: string; ownerInstanceId: string }>();

  static async ensureForProfile(opts: {
    profileDir: string;
    ownerInstanceId: string;
    epoch: string;
    ledger: OwnershipLedger;
    resolve: () => ArenaDriver;
    stateRoot?: string;
    brokerStorePath?: string;
    ledgerPath?: string;
  }): Promise<void> {
    const key = normalizeProfileDir(opts.profileDir);
    const stateRoot = opts.stateRoot ?? IPC_DEFAULTS.stateRoot;
    const brokerStorePath = opts.brokerStorePath ?? defaultBrokerStorePath();
    const existing = OwnerIpcManager.running.get(key);
    if (existing && existing.epoch === opts.epoch && existing.ownerInstanceId === opts.ownerInstanceId) return;
    if (existing) await OwnerIpcManager.stopForProfile(opts.profileDir).catch(() => {});
    const hooks = createOwnerExecutionHooks({
      resolve: opts.resolve,
      brokerStorePath,
      ownerInstanceId: opts.ownerInstanceId,
      epoch: opts.epoch,
      pid: process.pid,
      markSentPolicy: 'before-execute',
    });
    const server = await startOwnerIpcServer({
      profileDir: opts.profileDir,
      ownerInstanceId: opts.ownerInstanceId,
      epoch: opts.epoch,
      stateRoot,
      brokerStorePath,
      hooks,
    });
    OwnerIpcManager.running.set(key, { server, epoch: opts.epoch, ownerInstanceId: opts.ownerInstanceId });
    await opts.ledger.updateIpcEndpoint(opts.profileDir, opts.ownerInstanceId, server.endpoint);
  }

  static async stopForProfile(profileDir: string): Promise<void> {
    const key = normalizeProfileDir(profileDir);
    const existing = OwnerIpcManager.running.get(key);
    if (!existing) return;
    OwnerIpcManager.running.delete(key);
    await existing.server.close().catch(() => {});
  }
}
