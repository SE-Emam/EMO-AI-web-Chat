import fs from 'node:fs';
import path from 'node:path';
import type { Page, BrowserContext } from 'playwright';
import type { ProviderAuthInfo, WebProviderId } from './types.js';

export interface ExtractedAuth {
  isLoggedIn: boolean;
  accountName?: string;
  accountEmail?: string;
  avatarUrl?: string;
  authMethod?: string;
}

/**
 * Reads Google SSO info saved in Chrome's Preferences without launching a browser.
 * Safe to call even when Chrome is running.
 */
export function readGoogleProfilePreferences(userDataDir: string): { email?: string; name?: string; avatar?: string } | null {
  try {
    const prefPath = path.join(userDataDir, 'Default', 'Preferences');
    if (!fs.existsSync(prefPath)) return null;
    const raw = fs.readFileSync(prefPath, 'utf8');
    const pref = JSON.parse(raw);
    if (Array.isArray(pref.account_info) && pref.account_info.length > 0) {
      const acc = pref.account_info[0];
      return {
        email: acc.email,
        name: acc.full_name || acc.given_name,
        avatar: acc.picture_url,
      };
    }
  } catch {}
  return null;
}

/**
 * Inspects a Chrome profile directory on disk (without launching a browser)
 * to check for Google SSO preferences or active Cookies / LocalStorage data.
 */
export function detectDiskProfileAuth(userDataDir: string): {
  isLoggedIn: boolean;
  email?: string;
  name?: string;
  avatar?: string;
  authMethod?: 'google' | 'cookies' | 'session';
} | null {
  if (!userDataDir || !fs.existsSync(userDataDir)) return null;
  const google = readGoogleProfilePreferences(userDataDir);
  if (google?.email) {
    return {
      isLoggedIn: true,
      email: google.email,
      name: google.name,
      avatar: google.avatar,
      authMethod: 'google',
    };
  }
  try {
    const cookiePaths = [
      path.join(userDataDir, 'Default', 'Cookies'),
      path.join(userDataDir, 'Default', 'Network', 'Cookies'),
      path.join(userDataDir, 'Cookies'),
    ];
    for (const cp of cookiePaths) {
      if (fs.existsSync(cp) && fs.statSync(cp).size > 8192) {
        return { isLoggedIn: true, authMethod: 'cookies' };
      }
    }
    const lsDir = path.join(userDataDir, 'Default', 'Local Storage', 'leveldb');
    if (fs.existsSync(lsDir)) {
      const files = fs.readdirSync(lsDir);
      const hasData = files.some((f) => {
        if (!f.endsWith('.ldb') && !f.endsWith('.log')) return false;
        try {
          return fs.statSync(path.join(lsDir, f)).size > 512;
        } catch {
          return false;
        }
      });
      if (hasData) {
        return { isLoggedIn: true, authMethod: 'session' };
      }
    }
  } catch {}
  return null;
}

/**
 * Inspects an active page / context to extract login status and account details.
 */
export async function detectPageAuth(id: WebProviderId, page: Page, context: BrowserContext): Promise<ExtractedAuth> {
  const url = page.url();
  const cookies = await context.cookies().catch(() => []);

  switch (id) {
    case 'claude-web': {
      const isLoginUrl = /\/login|\/signup|\/sso/i.test(url);
      const hasSessionCookie = cookies.some((c) => (c.name === 'sessionKey' || c.name === 'sessionKeyLC') && c.domain.includes('claude.ai'));

      let accountEmail: string | undefined;
      let accountName: string | undefined;

      if (!isLoginUrl) {
        const account = await page.evaluate(async () => {
          try {
            const res = await fetch('/api/auth/current_account');
            if (res.ok) return await res.json();
          } catch {}
          return null;
        }).catch(() => null);

        if (account?.email_address) {
          accountEmail = account.email_address;
          accountName = account.full_name;
        }
      }

      return {
        isLoggedIn: (!isLoginUrl && hasSessionCookie) || Boolean(accountEmail),
        accountEmail,
        accountName,
        authMethod: 'session',
      };
    }

    case 'gemini-web': {
      const isLoginUrl = /accounts\.google\.com|\/signin|ServiceLogin/i.test(url);
      const hasGoogleSid = cookies.some((c) => (c.name === '__Secure-1PSID' || c.name === 'SID' || c.name === '__Secure-1PSIDTS') && c.domain.includes('google'));

      let accountName: string | undefined;
      let accountEmail: string | undefined;

      if (!isLoginUrl) {
        const ariaLabel = await page
          .locator('a[aria-label*="Google Account"], a[aria-label*="حساب Google"], button[aria-label*="Google Account"]')
          .first()
          .getAttribute('aria-label')
          .catch(() => null);

        if (ariaLabel) {
          const match = ariaLabel.match(/Google Account:\s*([^\n\r(]+?)(?:\s*\(([^)]+@[\w.-]+)\))?/);
          accountName = match?.[1]?.trim();
          accountEmail = match?.[2]?.trim();
        }
      }

      const hasComposer = !isLoginUrl && await page.locator('.ql-editor[contenteditable="true"], rich-textarea, textarea[aria-label*="prompt" i]').count().catch(() => 0) > 0;
      return {
        isLoggedIn: !isLoginUrl && (hasGoogleSid || Boolean(accountEmail) || hasComposer),
        accountName,
        accountEmail,
        authMethod: 'google',
      };
    }

    case 'zai-web': {
      const token = await page.evaluate(() => localStorage.getItem('token')).catch(() => null);
      let accountEmail: string | undefined;
      let isLoggedIn = false;

      if (token) {
        try {
          const parts = token.split('.');
          if (parts.length >= 2) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
            if (payload?.email) {
              accountEmail = payload.email;
              isLoggedIn = true;
            }
          }
        } catch {}
      }

      return {
        isLoggedIn,
        accountEmail,
        authMethod: 'jwt',
      };
    }

    case 'qwen-web': {
      const isLoginUrl = /\/auth\b|\/login\b|\/signin\b/i.test(url);
      const hasToken = await page.evaluate(() => Boolean(localStorage.getItem('token'))).catch(() => false);
      const hasAuthCookie = cookies.some((c) => c.name === 'auth-session' || c.name === 'refresh_token');

      return {
        isLoggedIn: !isLoginUrl && (hasToken || hasAuthCookie),
        authMethod: 'jwt',
      };
    }

    case 'arena-browser': {
      const hasAuthCookie = cookies.some((c) => c.name.startsWith('arena-auth-'));
      const isLoginUrl = /\/login|\/signin|\/auth/i.test(url);
      return {
        isLoggedIn: !isLoginUrl && hasAuthCookie,
        authMethod: 'cookies',
      };
    }

    case 'tencent-ai-web': {
      const isLoginUrl = /weixin\.qq\.com|graph\.qq\.com|\/login/i.test(url);
      const hasCookie = cookies.some((c) => c.name === 'uin' || c.name === 'hy_token' || c.name === 'token' || c.name.includes('yb_'));
      const hasLoginBtn = await page.locator('.agent-dialogue__tool__login, button:has-text("Log In"), button:has-text("登录")').count().catch(() => 0);
      const isChatUrl = url.includes('/chat');
      const isLoggedIn = !isLoginUrl && (hasCookie || (isChatUrl && hasLoginBtn === 0));
      return {
        isLoggedIn,
        authMethod: 'cookies',
      };
    }

    case 'chatgpt-web': {
      const isLoginUrl = /\/auth\/|\/login/i.test(url) || /auth0\.openai\.com/i.test(url);
      const hasSession = cookies.some((c) =>
        c.name.includes('session-token') ||
        c.name === '__Secure-next-auth.session-token' ||
        c.name === 'oai-did' ||
        c.name === '_puid'
      );
      const hasLoginUi = await page.locator('button[data-testid="login-button"], a[href*="/auth/login"], button:has-text("Log in"), button:has-text("Sign in")').count().catch(() => 0);
      return {
        isLoggedIn: !isLoginUrl && (hasSession || (hasLoginUi === 0 && /chatgpt\.com/i.test(url))),
        authMethod: 'session',
      };
    }

    case 'grok-web': {
      const isLoginUrl = /\/auth\b|\/login\b|\/signin\b/i.test(url);
      const hasAuth = cookies.some((c) => c.name.includes('sso') || c.name.includes('auth'));
      return {
        isLoggedIn: !isLoginUrl && hasAuth,
        authMethod: 'cookies',
      };
    }

    case 'kimi-web': {
      const isLoginUrl = /\/login\b/i.test(url);
      const hasToken = await page.evaluate(() => Boolean(localStorage.getItem('kimi-token') || localStorage.getItem('access_token'))).catch(() => false);
      return {
        isLoggedIn: !isLoginUrl && hasToken,
        authMethod: 'jwt',
      };
    }

    case 'minimax-web': {
      const isLoginUrl = /\/login\b/i.test(url);
      const hasToken = await page.evaluate(() => Boolean(localStorage.getItem('token') || localStorage.getItem('auth_token'))).catch(() => false);
      return {
        isLoggedIn: !isLoginUrl && hasToken,
        authMethod: 'jwt',
      };
    }

    case 'longcat-web':
    case 'llm7-web':
    case 'kiwi-web': {
      const isLoginUrl = /\/login\b|\/signin\b|\/auth\b/i.test(url);
      const hasAuthCookie = cookies.some((c) => /session|token|auth|login|user/i.test(c.name));
      const hasLoginUi = await page.locator('button:has-text("Log in"), button:has-text("Sign in"), a:has-text("Log in"), a:has-text("Sign in"), button:has-text("تسجيل الدخول")').count().catch(() => 0);
      return {
        isLoggedIn: !isLoginUrl && (hasAuthCookie || hasLoginUi === 0),
        authMethod: hasAuthCookie ? 'cookies' : 'session',
      };
    }

    case 'deepseek-web': {
      const isLoginUrl = /\/login\b|\/sign_in\b/i.test(url);
      const hasToken = await page.evaluate(() => Boolean(localStorage.getItem('userToken'))).catch(() => false);
      const hasCookie = cookies.some((c) => c.name.includes('ds_') || c.name.includes('token') || c.name.includes('session'));
      return {
        isLoggedIn: !isLoginUrl && (hasToken || hasCookie),
        authMethod: 'jwt',
      };
    }

    case 'mistral-web': {
      const isLoginUrl = /\/auth\b|\/login\b|\/signin\b/i.test(url);
      const hasCookie = cookies.some((c) => c.name.includes('mistral') || c.name.includes('session') || c.name.includes('token'));
      return {
        isLoggedIn: !isLoginUrl && hasCookie,
        authMethod: 'session',
      };
    }
  }
}
