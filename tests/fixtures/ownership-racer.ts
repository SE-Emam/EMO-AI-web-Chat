import { appendFile } from 'node:fs/promises';
import { OwnershipLedger } from '../../src/sessions/ownership-ledger.js';

// Two real processes contend for the same browser profile simultaneously.
// Exactly one must acquire; the other must be refused with owner details.
// The winner STAYS ALIVE holding the claim for 1.5s so the contender sees a
// live owner (exiting early would make the claim stale and stealable).
const [storePath, outFile, id] = process.argv.slice(2);
const ledger = new OwnershipLedger(storePath!);
const result = await ledger.claimProfile('/shared/browser-profile', `racer-${id}`);
if (result.status === 'acquired' || result.status === 'stolen') {
  await appendFile(outFile!, `ACQUIRED:${id}\n`);
  await new Promise((r) => setTimeout(r, 1500));
} else {
  await appendFile(outFile!, `BUSY:${id}:${(result as any).owner?.ownerInstanceId ?? 'unknown'}\n`);
}
