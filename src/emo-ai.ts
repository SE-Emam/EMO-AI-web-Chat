#!/usr/bin/env node
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { GatewayConfigStore } from './gateway/config-store.js';
import { UsageTracker } from './gateway/usage-tracker.js';
import { ProviderManager } from './gateway/provider-manager.js';
import { ModelSnapshotStore } from './gateway/discovery/snapshot-store.js';
import { NotificationStore } from './gateway/discovery/notification-store.js';
import { ModelDiscoveryService } from './gateway/discovery/service.js';
import { PlaywrightDiscoveryRunner } from './gateway/discovery/runner.js';
import { DiscoveryScheduler } from './gateway/discovery/scheduler.js';
import { getProviderCapabilities } from './gateway/provider-capabilities.js';
import { WEB_PROVIDER_IDS } from './gateway/types.js';
import { createServer } from './server/app.js';
import { closeServerGracefully } from './server/graceful-shutdown.js';

function help(): void {
  console.log(`EMO-AI — local web gateway with browser management UI

Usage:
  EMO-AI                Start gateway and open management UI
  EMO-AI --help         Show this help
  EMO-AI --no-open      Start without opening browser

Outputs:
  base uri: mac.ai/v1
  api: emo.web

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
  const tracker = new UsageTracker({
    heartbeatTimeoutMs: config.ui.heartbeatTimeoutMs,
    persistPath: path.join(os.homedir(), '.arena-webbridge', 'gateway-recent.json'),
  });
  const manager = new ProviderManager({ store, config });
  await manager.init();

  // ---- Live web model discovery -------------------------------------
  // The scheduler reads each provider's OWN website through its own browser
  // profile (headless, read-only) and reports the changes it finds.
  const discoverySettings = config.ui.discovery ?? {
    enabled: true,
    intervalMs: 12 * 60 * 60 * 1000,
    concurrency: 1,
    timeoutMs: 120_000,
  };
  const discoveryService = new ModelDiscoveryService({
    runner: new PlaywrightDiscoveryRunner(),
    snapshots: new ModelSnapshotStore(),
    notifications: new NotificationStore(),
    providerName: (id) => getProviderCapabilities(id).name,
    profileDirFor: (id) => manager.profileDirFor(id as (typeof WEB_PROVIDER_IDS)[number]),
    driverRunning: (id) => manager.isDriverRunning(id as (typeof WEB_PROVIDER_IDS)[number]),
    headlessFor: (id) => manager.getConfig().providers[id as (typeof WEB_PROVIDER_IDS)[number]]?.settings?.headless !== false,
    // A successful discovery REPLACES the provider's model list — otherwise
    // the card would keep showing the static catalog.
    applyDiscoveredModels: async (id, models, source) => {
      await manager.applyDiscoveredModels(id as (typeof WEB_PROVIDER_IDS)[number], models, source);
    },
  });
  const discoveryScheduler = new DiscoveryScheduler({
    service: discoveryService,
    providerIds: [...WEB_PROVIDER_IDS],
    intervalMs: discoverySettings.intervalMs,
    concurrency: discoverySettings.concurrency,
    timeoutMs: discoverySettings.timeoutMs,
  });
  manager.attachDiscovery(discoveryService, discoveryScheduler);
  if (discoverySettings.enabled) {
    discoveryScheduler.start();
    console.log(
      `model discovery: scheduled every ${Math.round(discoverySettings.intervalMs / 60000)} min for ${WEB_PROVIDER_IDS.length} providers`,
    );
  } else {
    console.log('model discovery: automatic sweeps are disabled (manual scans still work)');
  }

  const app = createServer({ mode: 'gateway', manager, tracker, gatewayConfig: config });
  await app.listen({ port: config.gateway.port, host: config.gateway.host });
  const uiUrl = `http://${config.gateway.host}:${config.gateway.port}/`;
  console.log('EMO-AI gateway ready');
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
    console.log('\nStopping EMO-AI gateway...');
    await closeServerGracefully(app, { drainTimeoutMs: 10_000 }).catch(() => {});
    await manager.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
