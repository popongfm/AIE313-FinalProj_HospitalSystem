// Screenshots of every page for visual review: desktop and mobile, light and dark.
// Run: PLAYWRIGHT_PATH=<playwright> [CHARTJS_PATH=<chart.umd.js>] node web/tests/screens.mjs   → web/tests/screens/<page>-<width>-<scheme>.png
import { mkdir } from 'node:fs/promises';
import { loadPlaywright, startServer, newMockedContext } from './harness.mjs';

const OUT = new URL('./screens/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });
const { chromium } = loadPlaywright();
const server = await startServer();
const browser = await chromium.launch();
const SIZES = [{ width: 1280, height: 860 }, { width: 390, height: 844, isMobile: true }];
const written = [];

async function signIn(page, email) {
  await page.goto(server.base + '/index.html');
  await page.evaluate(() => localStorage.removeItem('mock_session'));
  await page.goto(server.base + '/index.html');
  await page.fill('#email', email); await page.fill('#password', 'secret1'); await page.click('#login');
  await page.waitForURL('**/app.html*'); await page.waitForSelector('#t');
}

for (const size of SIZES) {
  for (const colorScheme of ['light', 'dark']) {
    const { isMobile, ...viewport } = size;
    const ctx = await newMockedContext(browser, { viewport, isMobile: !!isMobile, colorScheme, deviceScaleFactor: 1, reducedMotion: 'reduce' });   // reduced motion: scroll-reveal content is visible in full-page shots
    // CHARTJS_PATH=<chart.umd.js>: draw real charts instead of the test stub
    if (process.env.CHARTJS_PATH) await ctx.route('**/cdnjs.cloudflare.com/**', (r) => r.fulfill({ contentType: 'text/javascript', path: process.env.CHARTJS_PATH }));
    const page = await ctx.newPage();
    const shot = async (name) => {
      await page.waitForTimeout(350);   // fonts, drawer transition
      const path = `${OUT}${name}-${viewport.width}-${colorScheme}.png`;
      await page.screenshot({ path, fullPage: true }); written.push(path);
    };
    await page.goto(server.base + '/index.html'); await shot('index');
    await page.goto(server.base + '/register.html'); await shot('register');

    await signIn(page, 'a@b.th');
    await page.waitForSelector('#list table'); await shot('data');
    await page.click('#new'); await shot('drawer');
    await page.reload(); await page.waitForSelector('#list table');
    await page.click('[data-tab=views]'); await page.waitForSelector('#v');
    await page.selectOption('#v', 'v_inventory_stock_status'); await page.waitForSelector('#out table'); await shot('views');
    await page.click('[data-tab=dash]'); await page.waitForSelector('#panel h3'); await shot('dash');
    await page.click('[data-tab=chat]'); await page.waitForSelector('#q');
    await page.fill('#q', 'มีแพทย์กี่คน'); await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#log').textContent.includes('มีแพทย์ 8 คน')); await shot('chat');

    await signIn(page, 'pt@b.th');
    await page.selectOption('#t', 'booking'); await page.waitForFunction(() => document.querySelector('#list').textContent !== 'กำลังโหลด...');
    await shot('patient-booking');
    await ctx.close();
  }
}
console.log(written.join('\n'));
await browser.close(); server.close();
