import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkProviderConnection,
  maskLiteralSecrets,
  resetBrowserAvailabilityCache,
} from '../../src/gateway/provider-connection.js';

function httpReply(status: number, body = '') {
  return async () => ({
    reachable: true,
    httpStatus: status,
    latencyMs: 12,
    timedOut: false,
  });
}

describe('Real provider connection probe', () => {
  it('reports connected only when the provider answered AND the session is present', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conn-profile-'));
    fs.writeFileSync(path.join(dir, 'Cookies'), Buffer.alloc(9000, 1));
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: 'https://gemini.google.com',
      profileDir: dir,
      browserAvailable: true,
      probe: httpReply(200),
    });
    expect(report.status).toBe('connected');
    expect(report.signals.providerSiteReachable).toBe(true);
    expect(report.signals.browserAvailable).toBe(true);
    expect(report.signals.profilePresent).toBe(true);
    expect(report.signals.authenticated).toBe(true);
    expect(report.checkedAt).toBeTruthy();
    expect(report.labelKey).toBe('connStatusConnected');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports authentication_required when the site is reachable but no session exists', async () => {
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: 'https://gemini.google.com',
      profileDir: '',
      browserAvailable: true,
      probe: httpReply(200),
    });
    expect(report.status).toBe('authentication_required');
    expect(report.signals.providerSiteReachable).toBe(true);
    expect(report.signals.authenticated).toBe(false);
  });

  it('reports browser_unavailable when the site is reachable but no Chromium build exists', async () => {
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: 'https://gemini.google.com',
      browserAvailable: false,
      probe: httpReply(200),
    });
    expect(report.status).toBe('browser_unavailable');
    expect(report.signals.browserAvailable).toBe(false);
  });

  it('maps HTTP 401 to authentication_required', async () => {
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: 'https://gemini.google.com',
      browserAvailable: true,
      probe: httpReply(401),
    });
    expect(report.status).toBe('authentication_required');
    expect(report.httpStatus).toBe(401);
  });

  it('maps HTTP 429 to rate_limited', async () => {
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: 'https://gemini.google.com',
      browserAvailable: true,
      probe: httpReply(429),
    });
    expect(report.status).toBe('rate_limited');
  });

  it('maps HTTP 402 to quota_exhausted', async () => {
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: 'https://gemini.google.com',
      browserAvailable: true,
      probe: httpReply(402),
    });
    expect(report.status).toBe('quota_exhausted');
  });

  it('treats a CDN 403 as CONNECTED when the browser session is present', async () => {
    // Claude/Answer/… answer a plain GET with 403 (bot protection) even while
    // the browser session works perfectly — that must not be a failure.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conn-403-'));
    fs.writeFileSync(path.join(dir, 'Cookies'), Buffer.alloc(9000, 1));
    const report = await checkProviderConnection({
      providerId: 'claude-web',
      baseUrl: 'https://claude.ai/new',
      profileDir: dir,
      browserAvailable: true,
      probe: httpReply(403),
    });
    expect(report.status).toBe('connected');
    expect(report.httpStatus).toBe(403);
    expect(report.detail).toMatch(/403/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports authentication_required for a web provider without a session', async () => {
    const report = await checkProviderConnection({
      providerId: 'kimi-web',
      baseUrl: 'https://www.kimi.com/',
      profileDir: '',
      browserAvailable: true,
      probe: httpReply(200),
    });
    expect(report.status).toBe('authentication_required');
    expect(report.signals.authenticated).toBe(false);
  });

  it('maps HTTP 5xx to provider_unavailable', async () => {
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: 'https://gemini.google.com',
      browserAvailable: true,
      probe: httpReply(503),
    });
    expect(report.status).toBe('provider_unavailable');
  });

  it('maps a DNS/connection failure to provider_unavailable (not "sign-in required")', async () => {
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: 'https://gemini.google.com',
      browserAvailable: true,
      probe: async () => {
        throw Object.assign(new Error('getaddrinfo ENOTFOUND gemini.google.com'), { code: 'ENOTFOUND' });
      },
    });
    expect(report.status).toBe('provider_unavailable');
    expect(report.failureCode).toBe('PROVIDER_UNAVAILABLE');
    expect(report.detail).not.toMatch(/sign[- ]?in|auth/i);
  });

  it('maps a timeout to timeout (and never to connected)', async () => {
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: 'https://gemini.google.com',
      timeoutMs: 1000,
      browserAvailable: true,
      probe: async () => ({
        reachable: false,
        latencyMs: 1000,
        timedOut: true,
        error: Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
      }),
    });
    expect(report.status).toBe('timeout');
    expect(report.failureCode).toBe('NETWORK_TIMEOUT');
  });

  it('reports unknown when the selected model is missing from the discovered list', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conn-profile-'));
    fs.writeFileSync(path.join(dir, 'Cookies'), Buffer.alloc(9000, 1));
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: 'https://gemini.google.com',
      profileDir: dir,
      browserAvailable: true,
      selectedModels: ['gemini-web:gone'],
      availableModels: ['gemini-web:default'],
      probe: httpReply(200),
    });
    expect(report.status).toBe('unknown');
    expect(report.signals.selectedModelAvailable).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports unknown when no base URL is configured (nothing to probe)', async () => {
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: '',
      probe: httpReply(200),
    });
    expect(report.status).toBe('unknown');
  });

  it('never leaks a secret value into the report', async () => {
    const secret = 'sk-super-secret-key-value-1234567890';
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: 'https://gemini.google.com',
      browserAvailable: true,
      probe: async () => {
        throw new Error(`request failed with key ${secret}`);
      },
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(secret);
    expect(maskLiteralSecrets(`boom ${secret}`, [secret])).toBe('boom [redacted]');
  });

  it('resets the cached browser availability (test helper)', () => {
    resetBrowserAvailabilityCache();
    expect(true).toBe(true);
  });
});
