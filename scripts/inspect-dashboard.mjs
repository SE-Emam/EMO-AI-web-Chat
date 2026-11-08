import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const consoleMessages = [];
  page.on('console', msg => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => consoleMessages.push(`[PAGE_ERROR] ${err.message}`));
  
  await page.goto('http://127.0.0.1:8989/');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/tmp/dashboard_live.png', fullPage: true });

  const baseUri = await page.locator('#baseUri').textContent();
  const apiKey = await page.locator('#apiKey').textContent();
  const gwStatus = await page.locator('#gwStatus').textContent();
  const gwUptime = await page.locator('#gwUptime').textContent();
  const sActive = await page.locator('#sActive').textContent();
  const sReq = await page.locator('#sReq').textContent();
  const sOk = await page.locator('#sOk').textContent();
  const sErr = await page.locator('#sErr').textContent();

  const cardDetails = await page.locator('#providers .card').evaluateAll(elements => {
    return elements.map(el => {
      const title = el.querySelector('h3')?.textContent?.trim() || '';
      const badges = Array.from(el.querySelectorAll('.badge')).map(b => b.textContent.trim());
      const buttons = Array.from(el.querySelectorAll('button')).map(b => b.textContent.trim());
      const models = Array.from(el.querySelectorAll('label')).map(l => l.textContent.trim());
      return { title, badges, buttons, models };
    });
  });

  console.log(JSON.stringify({
    gateway: { baseUri, apiKey, gwStatus, gwUptime, sActive, sReq, sOk, sErr },
    providersCount: cardDetails.length,
    providers: cardDetails,
    consoleMessages
  }, null, 2));

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
