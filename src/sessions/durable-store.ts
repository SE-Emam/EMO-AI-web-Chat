/**
 * Durable JSON storage with atomic replacement.
 *
 * The rename step is atomic on the same filesystem, so a crash mid-write can
 * never leave a half-written target file . Cross-process *mutual exclusion* of read-modify-write cycles is
 * NOT provided here — use ProcessLock around the whole cycle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Reads a JSON file; returns null when missing or corrupt (silent recovery). */
export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Writes JSON atomically: tmp file in the same directory, then rename. */
export function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, file);
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* already renamed */ }
  }
}
