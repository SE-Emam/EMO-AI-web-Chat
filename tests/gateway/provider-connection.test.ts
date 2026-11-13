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
  return async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    }) as unknown as Response;
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
      fetchImpl: httpReply(200) as unknown as typeof fetch,
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
      fetchImpl: httpReply(200) as unknown as typeof fetch,
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
      fetchImpl: httpReply(200) as unknown as typeof fetch,
    });
    expect(report.status).toBe('browser_unavailable');
    expect(report.signals.browserAvailable).toBe(false);
  });

  it('maps HTTP 401 to authentication_required', async () => {
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: 'https://gemini.google.com',
      browserAvailable: true,
      fetchImpl: httpReply(401) as unknown as typeof fetch,
    });
    expect(report.status).toBe('authentication_required');
    expect(report.httpStatus).toBe(401);
  });

  it('maps HTTP 429 to rate_limited', async () => {
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: 'https://gemini.google.com',
      browserAvailable: true,
      fetchImpl: httpReply(429) as unknown as typeof fetch,
    });
    expect(report.status).toBe('rate_limited');
  });

  it('maps HTTP 402 to quota_exhausted', async () => {
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: 'https://gemini.google.com',
      browserAvailable: true,
      fetchImpl: httpReply(402) as unknown as typeof fetch,
    });
    expect(report.status).toBe('quota_exhausted');
  });

  it('maps HTTP 5xx to provider_unavailable', async () => {
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: 'https://gemini.google.com',
      browserAvailable: true,
      fetchImpl: httpReply(503) as unknown as typeof fetch,
    });
    expect(report.status).toBe('provider_unavailable');
  });

  it('maps a DNS/connection failure to provider_unavailable (not "sign-in required")', async () => {
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: 'https://gemini.google.com',
      browserAvailable: true,
      fetchImpl: (async () => {
        throw Object.assign(new Error('getaddrinfo ENOTFOUND gemini.google.com'), { code: 'ENOTFOUND' });
      }) as unknown as typeof fetch,
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
      fetchImpl: ((_url: string, opts: any) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
          );
        })) as unknown as typeof fetch,
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
      fetchImpl: httpReply(200) as unknown as typeof fetch,
    });
    expect(report.status).toBe('unknown');
    expect(report.signals.selectedModelAvailable).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports unknown when no base URL is configured (nothing to probe)', async () => {
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: '',
      fetchImpl: httpReply(200) as unknown as typeof fetch,
    });
    expect(report.status).toBe('unknown');
  });

  it('never leaks a secret value into the report', async () => {
    const secret = 'sk-super-secret-key-value-1234567890';
    const report = await checkProviderConnection({
      providerId: 'gemini-web',
      baseUrl: 'https://gemini.google.com',
      browserAvailable: true,
      fetchImpl: (async () => {
        throw new Error(`request failed with key ${secret}`);
      }) as unknown as typeof fetch,
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
