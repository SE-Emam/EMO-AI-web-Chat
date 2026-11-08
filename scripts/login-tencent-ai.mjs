import { chromium } from 'playwright';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const profile = path.join(os.homedir(), '.arena-webbridge', 'tencent-ai-profile');
fs.mkdirSync(profile, { recursive: true });
const url = process.argv[2] || 'https://aistudio.tencent.ai/';
console.log('Opening Tencent AI Studio login with profile:', profile);
console.log('Complete login/verification in the browser, then CLOSE the browser window to save the session.');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'],
});
let page = context.pages()[0];
if (!page) page = await context.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' }).catch((e) => console.log('[login] goto error:', e.message));
console.log('[login] Browser is open. Waiting for you to close it...');
await new Promise((resolve) => context.on('close', resolve));
console.log('Session saved to', profile);
