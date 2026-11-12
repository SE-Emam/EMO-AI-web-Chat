import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { ProcessLock } from '../../src/sessions/process-lock.js';

// Racer: two processes contend for the same resource simultaneously.
// Winner holds the lock ~1.5s and appends WINNER:<id>; the contender's short
// wait window expires and appends LOSER:<id>. Exactly one winner is expected.
const [resource, outFile, id] = process.argv.slice(2);
const lock = new ProcessLock({ lockDir: path.dirname(outFile), waitTimeoutMs: 700 });
try {
  await lock.withLock(resource!, async () => {
    await new Promise((r) => setTimeout(r, 1500));
    await appendFile(outFile!, `WINNER:${id}\n`);
    return 'ok';
  });
} catch {
  await appendFile(outFile!, `LOSER:${id}\n`);
}
