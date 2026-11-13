import { appendFile } from 'node:fs/promises';
import { RequestBroker } from '../../src/protocol/request-broker.js';
import {
  beginBrokeredRequest,
  completeBrokered,
} from '../../src/server/request-broker-helpers.js';

// Task 12 — REAL-process racer over the unified helpers layer.
//
// Usage: broker-fingerprint-racer <store> <outFile> <mode> <id> <provider>
//        <requestId> <fingerprint> [resultText] [skipWait]
//
// Modes: 'claim' (overlaps 1.2s so racers genuinely collide) and
// 'claim-now' (records and settles immediately). Every outcome is appended
// as ONE line so the parent test can assert cross-process semantics:
//   ALLOWED:<id> | DENIED:<id>:<state>:<reason> | CONFLICT:<id> | REPLAY:<id>:<json>
const [storePath, outFile, mode, id, provider, rid, fingerprint, resultText, skipWait] = process.argv.slice(2);

const broker = new RequestBroker(storePath!);
const claim = await beginBrokeredRequest({
  protocol: 'anthropic',
  apiKeyScope: 'racer-scope',
  providerId: provider!,
  requestId: rid!,
  fingerprint,
  broker,
});

if (claim.kind === 'execute') {
  await appendFile(outFile!, `ALLOWED:${id}\n`);
  if (mode === 'claim' && skipWait !== '1') {
    // Stay alive so a concurrent racer genuinely overlaps this execution.
    await new Promise((r) => setTimeout(r, 1200));
  }
  const oversize = resultText === '__OVERSIZE__';
  await completeBrokered(claim, oversize
    ? { content: 'x'.repeat(300 * 1024) }
    : {
        content: resultText ?? 'winner result',
        nativeReplay: { id: `msg_${id}`, model: provider, content: [{ type: 'text', text: resultText ?? 'winner result' }] },
      });
} else if (claim.kind === 'denied') {
  await appendFile(outFile!, `DENIED:${id}:${claim.state}:${claim.reason ?? ''}\n`);
} else if (claim.kind === 'conflict') {
  await appendFile(outFile!, `CONFLICT:${id}\n`);
} else if (claim.kind === 'replay') {
  await appendFile(outFile!, `REPLAY:${id}:${JSON.stringify(claim.result)}\n`);
} else {
  await appendFile(outFile!, `NONE:${id}\n`);
}
