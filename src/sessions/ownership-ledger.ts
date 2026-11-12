/**
 * Cross-process ownership ledger for browser profiles (chat-on-steroids
 * browser-control.ts principle: exclusive, verifiable ownership; a dead
 * owner's claim is taken over, a live owner's is never overwritten, and only
 * the owner itself may release).
 *
 * POLICY (documented, v2 plan): exclusive ownership — exactly one gateway
 * process owns a given browser profile. Another process is refused safely
 * with the owner's details (ownerInstanceId/pid/heartbeatAt) and a retry
 * hint. Cross-process request ROUTING to the owning process is NOT
 * implemented in this iteration; this is stated honestly in
 * IMPLEMENTATION_REPORT.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readJson, writeJsonAtomic } from './durable-store.js';
import { ProcessLock } from './process-lock.js';

export interface ProfileOwnershipEntry {
  profileDir: string;
  ownerInstanceId: string;
  pid: number;
  epoch: string;
  heartbeatAt: number;
}

export type ClaimResult =
  | { status: 'acquired' }
  | { status: 'stolen'; previousOwner: ProfileOwnershipEntry }
  | { status: 'busy'; owner: ProfileOwnershipEntry; /** Live owner whose heartbeat lagged — suspicion signal, never a takeover. */ staleHeartbeat?: boolean };

export function defaultOwnershipStorePath(): string {
  return path.join(os.homedir(), '.arena-webbridge', 'state', 'profile-ownership.json');
}

/** Heartbeats older than this are treated as abandoned. */
const HEARTBEAT_TTL_MS = 30_000;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === 'EPERM';
  }
}

export class OwnershipLedger {
  private readonly storePath: string;
  private readonly lock: ProcessLock;

  constructor(storePath: string = defaultOwnershipStorePath(), lock?: ProcessLock) {
    this.storePath = storePath;
    this.lock = lock || new ProcessLock({ lockDir: path.join(path.dirname(storePath), 'locks') });
  }

  private async load(): Promise<{ version: 1; entries: ProfileOwnershipEntry[] }> {
    const data = readJson<{ version: 1; entries: ProfileOwnershipEntry[] }>(this.storePath);
    return data && Array.isArray(data.entries) ? data : { version: 1, entries: [] };
  }

  get(profileDir: string): ProfileOwnershipEntry | null {
    const data = readJson<{ entries: ProfileOwnershipEntry[] }>(this.storePath);
    return data?.entries.find((e) => e.profileDir === profileDir) ?? null;
  }

  async claimProfile(profileDir: string, ownerInstanceId: string, epoch: string = ''): Promise<ClaimResult> {
    return this.lock.withLock(this.storePath, async () => {
      const file = await this.load();
      const existing = file.entries.find((e) => e.profileDir === profileDir);
      if (existing) {
        // Takeover rule (owner ruling, 2026-11-12): ONLY proven death enables
        // stealing. A stale heartbeat does NOT prove death — the owner may be
        // mid-generation on a web turn that outlasts the heartbeat TTL.
        // Stealing from a LIVE owner would put two browsers on one profile —
        // the exact conflict ownership exists to prevent.
        const ownerDead = !pidAlive(existing.pid);
        const heartbeatStale = Date.now() - existing.heartbeatAt > HEARTBEAT_TTL_MS;
        if (ownerDead) {
          file.entries = file.entries.filter((e) => e !== existing);
          const entry: ProfileOwnershipEntry = { profileDir, ownerInstanceId, pid: process.pid, epoch, heartbeatAt: Date.now() };
          file.entries.push(entry);
          writeJsonAtomic(this.storePath, file);
          return { status: 'stolen', previousOwner: existing } as ClaimResult;
        }
        if (heartbeatStale) {
          // Live but lagging: raise suspicion, never take over. Surfaced to
          // the caller (and logs) as a warning signal for monitoring.
          console.log(
            `[ownership-ledger] WARNING: profile "${profileDir}" owner ${existing.ownerInstanceId} (pid ${existing.pid}) is ALIVE but heartbeat is stale ` +
            `(${Math.round((Date.now() - existing.heartbeatAt) / 1000)}s > ${HEARTBEAT_TTL_MS / 1000}s TTL) — refusing takeover, reporting busy.`
          );
          return { status: 'busy', owner: existing, staleHeartbeat: true } as ClaimResult;
        }
        return { status: 'busy', owner: existing } as ClaimResult;
      }
      const entry: ProfileOwnershipEntry = { profileDir, ownerInstanceId, pid: process.pid, epoch, heartbeatAt: Date.now() };
      file.entries.push(entry);
      writeJsonAtomic(this.storePath, file);
      return { status: 'acquired' } as ClaimResult;
    });
  }

  /** Refreshes the heartbeat; only meaningful for the owner. */
  async heartbeat(profileDir: string, ownerInstanceId: string, epoch?: string): Promise<boolean> {
    return this.lock.withLock(this.storePath, async () => {
      const file = await this.load();
      const entry = file.entries.find((e) => e.profileDir === profileDir);
      if (!entry || entry.ownerInstanceId !== ownerInstanceId) return false;
      entry.heartbeatAt = Date.now();
      if (epoch) entry.epoch = epoch;
      writeJsonAtomic(this.storePath, file);
      return true;
    });
  }

  /** ONLY the owner can release its own claim. */
  async releaseProfile(profileDir: string, ownerInstanceId: string): Promise<boolean> {
    return this.lock.withLock(this.storePath, async () => {
      const file = await this.load();
      const entry = file.entries.find((e) => e.profileDir === profileDir);
      if (!entry || entry.ownerInstanceId !== ownerInstanceId) return false;
      file.entries = file.entries.filter((e) => e !== entry);
      writeJsonAtomic(this.storePath, file);
      return true;
    });
  }
}
