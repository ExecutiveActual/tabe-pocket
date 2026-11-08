// Screenshots at iPhone landscape size with simulated safe-area insets (notch sides + home indicator):
//   node scripts/shots.mjs <name> "<query>" [clickSelector...]   -> shots/<name>.png
// e.g. node scripts/shots.mjs v1_1-noon "seed=3&day=2&hour=12"
import puppeteer from 'puppeteer-core';
import { resolve } from 'path';
const [name, query = '', ...clicks] = process.argv.slice(2);
const INSET = '47,0,47,21';   // iPhone 14-class landscape: 47 px each side, 21 px home indicator
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
const url = 'file://' + resolve('dist/index.html') + '?' + query + (query.includes('inset=') ? '' : '&inset=' + INSET);
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
await page.goto(url, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));
for (const c of clicks) { await page.click(c); await new Promise((r) => setTimeout(r, 400)); }
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `shots/${name}.png` });
const t = await page.evaluate(() => { const t0 = performance.now(); let n = 0; return new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); }); });
console.log(`shots/${name}.png  (~${Math.round(t)} fps headless)`);
await browser.close();
