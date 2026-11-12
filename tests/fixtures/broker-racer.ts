import { appendFile } from 'node:fs/promises';
import { RequestBroker, brokerKey } from '../../src/protocol/request-broker.js';

// Two real processes claim the SAME (apiKey, provider, requestId) key at the
// same instant. Exactly one must be allowed to execute; the other must be
// denied with the claim state. The winner stays alive ~1.2s so both racers
// genuinely overlap.
const [storePath, outFile, id] = process.argv.slice(2);
const broker = new RequestBroker(storePath!);
const key = brokerKey('racer-scope', 'chatgpt-web', 'racer-request-id');
const b = await broker.begin(key, 'racer-session');
if (b.allowed) {
  await appendFile(outFile!, `ALLOWED:${id}\n`);
  // Simulate executing the request; then record completion.
  await new Promise((r) => setTimeout(r, 1200));
  await b.complete({ content: 'winner result' });
} else {
  await appendFile(outFile!, `DENIED:${id}:${b.state}\n`);
}
