import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { ProcessLock } from '../../src/sessions/process-lock.js';

// Serial: two processes contend for the same resource; both must run
// (one after the other) because the wait window is long enough.
const [resource, outFile, id] = process.argv.slice(2);
const lock = new ProcessLock({ lockDir: path.dirname(outFile!), waitTimeoutMs: 20_000 });
await lock.withLock(resource!, async () => {
  await appendFile(outFile!, `ENTER:${id}\n`);
  await new Promise((r) => setTimeout(r, 300));
  return 'ok';
});
