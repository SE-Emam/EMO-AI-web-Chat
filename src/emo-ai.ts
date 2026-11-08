#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { GatewayConfigStore } from './gateway/config-store.js';
import { UsageTracker } from './gateway/usage-tracker.js';
import { ProviderManager } from './gateway/provider-manager.js';
import { createServer } from './server/app.js';

function help(): void {
  console.log(`EMO.ai — local web gateway with browser management UI

Usage:
  EMO.ai                Start gateway and open management UI
  EMO.ai --help         Show this help
  EMO.ai --no-open      Start without opening browser

Outputs:
  base uri: mac.ai/v1
  api: mac

Management UI opens in your browser (local, no admin/users).
OpenAI-compatible endpoints: /v1/models, /v1/chat/completions
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    help();
    return;
  }
  const open = !args.includes('--no-open');
  const store = new GatewayConfigStore();
  const config = await store.load();
  const tracker = new UsageTracker({ heartbeatTimeoutMs: config.ui.heartbeatTimeoutMs });
  const manager = new ProviderManager({ store, config });
  await manager.init();
  const app = createServer({ mode: 'gateway', manager, tracker, gatewayConfig: config });
  await app.listen({ port: config.gateway.port, host: config.gateway.host });
  const uiUrl = `http://${config.gateway.host}:${config.gateway.port}/`;
  console.log('EMO.ai gateway ready');
  console.log(`base uri: ${config.gateway.baseUriDisplay}`);
  console.log(`api: ${config.gateway.apiKey}`);
  console.log(`ui: ${uiUrl}`);
  console.log('Press Ctrl+C to stop.');
  if (open && process.platform === 'darwin') {
    spawn('open', [uiUrl], { stdio: 'ignore', detached: true }).unref();
  }
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nStopping EMO.ai gateway...');
    await manager.close().catch(() => {});
    await app.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
