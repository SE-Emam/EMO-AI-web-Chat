/**
 * Cross-process mutual exclusion via O_EXCL lock files.
 *
 * core principle (browser-control.ts): a claim is exclusive by
 * construction, and a dead owner's claim can be taken over — a live owner's
 * can never be. `open(path, 'wx')` fails with EEXIST when ANY process already
 * holds the lock, which is the only primitive the OS guarantees atomically
 * across processes; atomic file *writes* alone do not (two writers can each
 * read "absent" and both proceed).
 */
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ProcessLockOptions {
  /** Directory holding lock files. */
  lockDir?: string;
  /** How long a contender waits before failing loudly. */
  waitTimeoutMs?: number;
  /** How long a lock file must sit before its dead owner is taken over. */
  staleTtlMs?: number;
  /** Base delay between acquire attempts (jittered). */
  retryDelayMs?: number;
}

export interface LockHandle {
  release(): void;
  /** Absolute path of the lock file (diagnostics). */
  readonly file: string;
}

interface LockContents {
  pid: number;
  ownerInstanceId: string;
  acquiredAt: number;
}

const DEFAULT_LOCK_DIR = () => path.join(os.homedir(), '.arena-webbridge', 'state', 'locks');

/** Absolute path of the lock file for a resource (shared with tests). */
export function lockFilePathFor(lockDir: string, resource: string): string {
  const hash = createHash('sha1').update(resource).digest('hex').slice(0, 20);
  return path.join(lockDir, `${hash}.lock`);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === 'EPERM'; // exists but not signalable — treat as alive
  }
}

export class ProcessLock {
  private readonly lockDir: string;
  private readonly waitTimeoutMs: number;
  private readonly staleTtlMs: number;
  private readonly retryDelayMs: number;
  /** Stable within this process instance; identifies us in lock files. */
  readonly ownerInstanceId: string;

  constructor(options: Partial<ProcessLockOptions> = {}) {
    this.lockDir = options.lockDir || DEFAULT_LOCK_DIR();
    this.waitTimeoutMs = options.waitTimeoutMs ?? 10_000;
    this.staleTtlMs = options.staleTtlMs ?? 5_000;
    this.retryDelayMs = options.retryDelayMs ?? 50;
    this.ownerInstanceId = `${process.pid}-${randomUUID().slice(0, 8)}`;
  }

  private lockFile(resource: string): string {
    return lockFilePathFor(this.lockDir, resource);
  }

  /**
   * One atomic attempt. Returns a handle, or null when someone else (a live
   * owner) holds the resource.
   */
  tryAcquire(resource: string): LockHandle | null {
    const file = this.lockFile(resource);
    fs.mkdirSync(this.lockDir, { recursive: true });
    let fd: number;
    try {
      // 'x' flag: O_EXCL — creation is exclusive across processes.
      fd = fs.openSync(file, 'wx');
    } catch (e: any) {
      if (e?.code !== 'EEXIST') throw e;
      // Someone holds it. Steal ONLY if the holder is provably dead
      // (crash leftovers) or its record is unreadable.
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as LockContents;
        const holderDead = !pidAlive(raw.pid);
        const holderOld = Date.now() - (raw.acquiredAt || 0) > this.staleTtlMs;
        if (holderDead && holderOld) {
          try {
            fs.rmSync(file, { force: true });
          } catch {
            return null; // someone else stole it between check and delete
          }
          fd = fs.openSync(file, 'wx');
        } else {
          return null;
        }
      } catch {
        return null; // unreadable/contended — do not guess
      }
    }
    const contents: LockContents = { pid: process.pid, ownerInstanceId: this.ownerInstanceId, acquiredAt: Date.now() };
    fs.writeFileSync(fd, JSON.stringify(contents));
    fs.closeSync(fd);
    let released = false;
    return {
      file,
      release: () => {
        if (released) return;
        released = true;
        // : a lock file may only be deleted when
        // its contents PROVE we still own it. Unreadable/corrupt contents, or
        // a different ownerInstanceId, mean someone else may hold (or have
        // re-created) this lock — deleting it could let two processes believe
        // they hold the same resource. We log loudly and leave the file.
        let current: LockContents | null = null;
        try {
          current = JSON.parse(fs.readFileSync(file, 'utf8')) as LockContents;
        } catch {
          console.log(
            `[ProcessLock] WARNING: cannot safely release lock "${file}" — contents unreadable/corrupt; ` +
            `leaving the file in place (dead-owner steal is still possible after ${this.staleTtlMs}ms).`
          );
          return;
        }
        if (!current || current.ownerInstanceId !== this.ownerInstanceId) {
          console.log(
            `[ProcessLock] WARNING: lock "${file}" is not owned by ${this.ownerInstanceId} ` +
            `(owner=${current?.ownerInstanceId ?? 'unknown'}) — refusing to delete another owner's lock.`
          );
          return;
        }
        try {
          fs.rmSync(file, { force: true });
        } catch { /* gone already */ }
      },
    };
  }

  /** Runs fn while holding the exclusive cross-process lock; release is guaranteed. */
  async withLock<T>(resource: string, fn: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + this.waitTimeoutMs;
    let handle: LockHandle | null = null;
    let delay = this.retryDelayMs;
    while (Date.now() < deadline) {
      handle = this.tryAcquire(resource);
      if (handle) break;
      const jitter = Math.random() * this.retryDelayMs;
      await new Promise((r) => setTimeout(r, delay + jitter));
      delay = Math.min(delay * 1.5, 500);
    }
    if (!handle) {
      throw new Error(`ProcessLock: resource "${resource}" is busy (lock held by another live process, waited ${this.waitTimeoutMs}ms)`);
    }
    try {
      return await fn();
    } finally {
      handle.release();
    }
  }
}
