import { chromium } from 'playwright';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const profile = path.join(os.homedir(), '.arena-webbridge', 'claude-profile');
fs.mkdirSync(profile, { recursive: true });
const url = process.argv[2] || 'https://claude.ai/login';
console.log('Opening Claude login with profile:', profile);
console.log('Complete login/hCaptcha in the browser, then CLOSE the browser window to save the session.');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'],
});
let page = context.pages()[0];
if (!page) page = await context.newPage();
page.on('close', () => console.log('[login] page closed'));
context.on('close', () => console.log('[login] context closed'));
await page.goto(url, { waitUntil: 'domcontentloaded' }).catch((e) => console.log('[login] goto error:', e.message));
console.log('[login] Browser is open. Waiting for you to close it...');
await new Promise((resolve) => {
  const done = () => resolve();
  context.on('close', done);
  // if all pages closed, keep context until user closes window; but don't force close
  setInterval(() => {
    try { if (!context.pages().length) console.log('[login] no pages, but context still open - close the Chrome window'); } catch {}
  }, 15000);
});
console.log('Session saved to', profile);
