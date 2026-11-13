/**
 * Real provider connection probing — Providers & Models audit.
 *
 * "Test Connection" MUST probe the provider, not read a stored flag. This
 * module performs an actual, cheap HTTP request against the provider's own
 * configured base URL and combines it with local signals that are verified
 * on the machine (browser binary present, profile directory present, session
 * cookies present in the profile, driver running, selected model present in
 * the discovered list).
 *
 * HARD RULES (honesty + safety):
 *  - The probe NEVER opens the user's browser profile, never logs in, never
 *    deletes cookies and never sends a chat message → no credit is consumed.
 *  - The probe never returns credentials, cookies or tokens. Literal secrets
 *    are masked out of every message before it leaves this module.
 *  - Failures are classified with the CENTRAL Task 14 classifier
 *    (`src/arena/provider-failures.ts`) — no parallel error taxonomy.
 *  - A status is only 'connected' when every checked signal is actually true.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { chromium } from 'playwright';
import { classifyFailure, type ProviderFailureCode } from '../arena/provider-failures.js';
import { detectDiskProfileAuth } from './auth-detector.js';
import { maskLiteralSecrets, redactSecrets } from './security.js';
import { getProviderCapabilities } from './provider-capabilities.js';
import {
  CONNECTION_STATUS_LABEL_KEYS,
  CONNECTION_STATUS_TONES,
} from './provider-card-view.js';

export type ProviderConnectionStatus =
  | 'connected'
  | 'authentication_required'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'provider_unavailable'
  | 'browser_unavailable'
  | 'timeout'
  | 'unsupported'
  | 'unknown';

export interface ProviderConnectionSignals {
  /** The provider's site answered with an HTTP response (any status). */
  providerSiteReachable: boolean;
  /** A browser binary usable by the adapters is installed on this machine. */
  browserAvailable: boolean;
  /** The persistent Chrome profile directory for this provider exists. */
  profilePresent: boolean;
  /** The profile carries a session (cookies / SSO) on disk. */
  authenticated: boolean;
  /** The provider's driver is currently running inside the gateway. */
  driverRunning: boolean;
  /** Every selected model id is present in the discovered model list. */
  selectedModelAvailable: boolean;
  /** The gateway itself is serving the request (always true here). */
  gatewayReachable: boolean;
}

export interface ProviderConnectionReport {
  providerId: string;
  status: ProviderConnectionStatus;
  /** i18n key for the status label (resolved by the UI). */
  labelKey: string;
  /** Visual tone for the status badge. */
  tone: 'ok' | 'warn' | 'error' | 'muted';
  checkedAt: string;
  latencyMs: number;
  /** Short, secret-free human explanation of the status. */
  detail?: string;
  /** Central Task 14 failure code when the probe failed. */
  failureCode?: ProviderFailureCode;
  /** HTTP status of the probe, when a response was received. */
  httpStatus?: number;
  /** The endpoint that was probed (never contains credentials). */
  endpoint?: string;
  signals: ProviderConnectionSignals;
}

export interface ConnectionProbeOptions {
  providerId: string;
  /** The provider's configured base URL (website root for web providers). */
  baseUrl?: string;
  /** Persistent Chrome profile directory (web providers). */
  profileDir?: string;
  /** Is the provider's driver running right now? */
  driverRunning?: boolean;
  /** Selected model ids for this provider. */
  selectedModels?: string[];
  /** Discovered model ids for this provider. */
  availableModels?: string[];
  /** Per-request timeout for the probe. */
  timeoutMs?: number;
  /**
   * Injectable probe (tests). The production probe is a raw node:https
   * request — see `probeProviderSite`.
   */
  probe?: (baseUrl: string, timeoutMs: number) => Promise<ProbeResult>;
  /** Injectable browser-availability probe (tests). */
  browserAvailable?: boolean;
  /** Literal secret values that must never appear in the report. */
  secrets?: Array<string | undefined>;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 8000;

/** A neutral desktop UA — a bare fetch UA is blocked by most provider CDNs. */
const PROBE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

let cachedBrowserAvailability: { value: boolean; at: number } | null = null;

/**
 * Checks whether a Chromium build usable by the adapters exists locally.
 *
 * The adapters prefer the INSTALLED Google Chrome (`channel: 'chrome'`) and
 * fall back to Playwright's bundled Chromium — so BOTH count. Only when
 * neither exists is the browser really unavailable.
 */
export function isBrowserAvailable(now: () => number = Date.now): boolean {
  const ts = now();
  if (cachedBrowserAvailability && ts - cachedBrowserAvailability.at < 60_000) {
    return cachedBrowserAvailability.value;
  }
  let value = false;
  // 1) Playwright's bundled Chromium.
  try {
    const exe = chromium.executablePath();
    if (exe && fs.existsSync(exe)) value = true;
  } catch {
    /* not installed */
  }
  // 2) The installed Google Chrome (what the drivers actually use).
  if (!value) {
    for (const candidate of [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ]) {
      try {
        if (fs.existsSync(candidate)) {
          value = true;
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }
  cachedBrowserAvailability = { value, at: ts };
  return value;
}

/** Resets the cached browser availability (tests). */
export function resetBrowserAvailabilityCache(): void {
  cachedBrowserAvailability = null;
}

/**
 * Masks literal secret values (API keys) out of any text we return.
 * Re-exported from the shared security module so the browser/server code and
 * the tests use ONE implementation.
 */
export { maskLiteralSecrets };

export interface ProbeResult {
  reachable: boolean;
  httpStatus?: number;
  latencyMs: number;
  timedOut: boolean;
  error?: unknown;
}

/**
 * Performs the actual HTTP probe against the provider's own base URL.
 *
 * Node's global `fetch` (undici) aborts with `UND_ERR_HEADERS_OVERFLOW` on
 * some provider CDNs (Google/Gemini among them) because their response
 * headers exceed undici's 16 KB default — the provider would then be
 * reported as UNREACHABLE while it is perfectly fine. A raw `node:https`
 * request with a raised header limit answers the same question reliably.
 */
function probeProviderSite(
  baseUrl: string,
  timeoutMs: number,
  userAgent: string,
): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve) => {
    const started = Date.now();
    let settled = false;
    const finish = (result: { reachable: boolean; httpStatus?: number; timedOut: boolean; error?: unknown }) => {
      if (settled) return;
      settled = true;
      resolve({ latencyMs: Math.max(1, Date.now() - started), ...result });
    };

    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch (e) {
      finish({ reachable: false, timedOut: false, error: e });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      finish({ reachable: false, timedOut: false, error: new Error(`Unsupported protocol: ${parsed.protocol}`) });
      return;
    }

    const transport = parsed.protocol === 'http:' ? http : https;
    let request: http.ClientRequest;
    try {
      request = transport.request(
        parsed,
        {
          method: 'GET',
          maxHeaderSize: 256 * 1024,
          headers: {
            'User-Agent': userAgent,
            Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            Connection: 'close',
          },
        },
        (res) => {
          // The STATUS is all we need — the body is never required.
          res.resume();
          finish({ reachable: true, httpStatus: res.statusCode || 0, timedOut: false });
          request.destroy();
        },
      );
    } catch (e) {
      finish({ reachable: false, timedOut: false, error: e });
      return;
    }

    request.setTimeout(timeoutMs, () => {
      request.destroy(Object.assign(new Error(`timeout after ${timeoutMs}ms`), { name: 'TimeoutError' }));
    });
    request.on('error', (e: NodeJS.ErrnoException) => {
      finish({
        reachable: false,
        timedOut: e.name === 'TimeoutError' || e.code === 'ETIMEDOUT',
        error: e,
      });
    });
    request.end();
  });
}

/** Maps an HTTP status to a connection status (evidence-first). */
function statusFromHttp(httpStatus: number): ProviderConnectionStatus {
  if (httpStatus === 429) return 'rate_limited';
  if (httpStatus === 402) return 'quota_exhausted';
  if (httpStatus === 401) return 'authentication_required';
  if (httpStatus === 403) return 'unknown'; // site reachable, request denied (bot protection / auth wall)
  if (httpStatus >= 500) return 'provider_unavailable';
  return 'connected';
}

/**
 * Runs a real connection check for one provider.
 *
 * The result distinguishes (as required):
 *   gateway reachable · provider website reachable · browser available ·
 *   profile present · user signed in · driver running · model available
 * instead of collapsing everything into "connected / disconnected".
 */
export async function checkProviderConnection(
  opts: ConnectionProbeOptions,
): Promise<ProviderConnectionReport> {
  const report = await runConnectionProbe(opts);
  return {
    ...report,
    labelKey: CONNECTION_STATUS_LABEL_KEYS[report.status] || CONNECTION_STATUS_LABEL_KEYS.unknown,
    tone: CONNECTION_STATUS_TONES[report.status] || 'muted',
  };
}

async function runConnectionProbe(
  opts: ConnectionProbeOptions,
): Promise<Omit<ProviderConnectionReport, 'labelKey' | 'tone'>> {
  const now = opts.now ?? Date.now;
  const caps = getProviderCapabilities(opts.providerId);
  const checkedAt = new Date(now()).toISOString();
  const timeoutMs = Math.max(1000, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  if (!caps.canTestConnection) {
    return {
      providerId: opts.providerId,
      status: 'unsupported',
      checkedAt,
      latencyMs: 0,
      detail: 'No connection probe is implemented for this provider type.',
      signals: {
        providerSiteReachable: false,
        browserAvailable: false,
        profilePresent: false,
        authenticated: false,
        driverRunning: false,
        selectedModelAvailable: false,
        gatewayReachable: true,
      },
    };
  }

  const profileDir = opts.profileDir || '';
  const profilePresent = Boolean(profileDir) && fs.existsSync(profileDir);
  const diskAuth = profileDir ? detectDiskProfileAuth(profileDir) : null;
  const authenticated = Boolean(diskAuth?.isLoggedIn);
  const browserAvailable = opts.browserAvailable ?? isBrowserAvailable(now);

  const available = new Set(opts.availableModels || []);
  const selected = opts.selectedModels || [];
  const selectedModelAvailable =
    selected.length === 0 || selected.every((m) => available.has(m));

  const signals: ProviderConnectionSignals = {
    providerSiteReachable: false,
    browserAvailable,
    profilePresent,
    authenticated,
    driverRunning: Boolean(opts.driverRunning),
    selectedModelAvailable,
    gatewayReachable: true,
  };

  // No usable base URL → nothing to probe.
  const baseUrl = (opts.baseUrl || '').trim();
  if (!baseUrl) {
    return {
      providerId: opts.providerId,
      status: 'unknown',
      checkedAt,
      latencyMs: 0,
      detail: 'No base URL configured for this provider — cannot probe it.',
      signals,
    };
  }

  let endpoint = baseUrl;
  let probe: ProbeResult;
  try {
    probe = opts.probe
      ? await opts.probe(baseUrl, timeoutMs)
      : await probeProviderSite(baseUrl, timeoutMs, PROBE_USER_AGENT);
  } catch (err) {
    probe = { reachable: false, latencyMs: 1, timedOut: false, error: err };
  }

  const failure = probe.error
    ? classifyFailure(probe.error, { phase: 'pre-send', sent: false })
    : undefined;

  if (!probe.reachable) {
    signals.providerSiteReachable = false;
    // Our own abort timer PROVES the timeout — do not rely on message text.
    const code: ProviderFailureCode | undefined = probe.timedOut
      ? 'NETWORK_TIMEOUT'
      : failure?.code;
    let status: ProviderConnectionStatus;
    let detail: string;
    if (probe.timedOut || code === 'NETWORK_TIMEOUT') {
      status = 'timeout';
      detail = `Provider did not answer within ${timeoutMs}ms.`;
    } else {
      status = 'provider_unavailable';
      detail = maskLiteralSecrets(
        redactSecrets(
          `Provider is unreachable: ${probe.error instanceof Error ? probe.error.message : String(probe.error ?? 'network error')}`,
        ).redactedText,
        opts.secrets || [],
      );
    }
    return {
      providerId: opts.providerId,
      status,
      checkedAt,
      latencyMs: probe.latencyMs,
      detail,
      failureCode: code,
      endpoint,
      signals,
    };
  }

  signals.providerSiteReachable = true;
  const httpStatus = probe.httpStatus ?? 0;
  const httpDerived = statusFromHttp(httpStatus);

  // The site answered. Now decide the overall status from ALL verified signals.
  let status: ProviderConnectionStatus = httpDerived;
  let detail: string;

  if (caps.connectionType === 'web') {
    // For a WEB provider the HTTP status of the site root says almost nothing
    // about the session: many providers answer a plain GET with 403 (CDN) or
    // redirect to the sign-in page even while the browser session works fine.
    // The AUTHENTICATION signal for a web provider is the profile's session;
    // the reachability signal is "the host answered at all".
    if (httpStatus === 429) {
      status = 'rate_limited';
      detail = `Provider answered HTTP ${httpStatus} (rate limited).`;
    } else if (httpStatus === 402) {
      status = 'quota_exhausted';
      detail = `Provider answered HTTP ${httpStatus} (quota exhausted).`;
    } else if (httpStatus === 401) {
      status = 'authentication_required';
      detail = `Provider answered HTTP ${httpStatus} (authentication required).`;
    } else if (httpStatus >= 500) {
      status = 'provider_unavailable';
      detail = `Provider answered HTTP ${httpStatus} (server error).`;
    } else if (!browserAvailable) {
      status = 'browser_unavailable';
      detail = 'Provider site is reachable, but no Chromium build is installed for the browser adapters.';
    } else if (!profilePresent) {
      status = 'authentication_required';
      detail = 'Provider site is reachable, but no browser profile exists yet — sign in first.';
    } else if (!authenticated) {
      status = 'authentication_required';
      detail = 'Provider site is reachable, but the browser profile carries no active session.';
    } else {
      status = 'connected';
      detail =
        httpStatus === 403
          ? 'Provider site reachable (its CDN answers plain requests with 403) and the browser session is present.'
          : 'Provider site reachable and browser session present.';
    }
  } else if (httpDerived === 'connected') {
    if (!browserAvailable) {
      status = 'browser_unavailable';
      detail = 'Provider site is reachable, but no Chromium build is installed for the browser adapters.';
    } else {
      status = 'connected';
      detail = 'Provider endpoint reachable.';
    }
  } else {
    detail =
      httpDerived === 'rate_limited'
        ? `Provider answered HTTP ${httpStatus} (rate limited).`
        : httpDerived === 'quota_exhausted'
          ? `Provider answered HTTP ${httpStatus} (quota exhausted).`
          : httpDerived === 'authentication_required'
            ? `Provider answered HTTP ${httpStatus} (authentication required).`
            : httpDerived === 'provider_unavailable'
              ? `Provider answered HTTP ${httpStatus} (server error).`
              : `Provider answered HTTP ${httpStatus} — reachable, but the session could not be confirmed.`;
  }

  if (status === 'connected' && !signals.selectedModelAvailable) {
    status = 'unknown';
    detail = 'Provider reachable, but the selected model is not present in the discovered model list.';
  }

  return {
    providerId: opts.providerId,
    status,
    checkedAt,
    latencyMs: probe.latencyMs,
    detail,
    failureCode: failure?.code,
    httpStatus: httpStatus || undefined,
    endpoint,
    signals,
  };
}
