// Frame rate under different settings, in headless Edge with the GPU (dev aid).
// Usage: node scripts/perf.mjs <url>
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://localhost:3130/';
const browser = await chromium.launch({ channel: 'msedge', args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url);
await page.waitForSelector('.app[data-phase="ready"]', { timeout: 60000 });
await page.waitForFunction(() => window.__rn?.get().loaded >= window.__rn?.get().manifest?.count, null, { timeout: 120000 });
await page.waitForTimeout(5000);
const fps = () => page.evaluate(() => new Promise((r) => {
  let n = 0;
  const t0 = performance.now();
  const f = () => (++n, performance.now() - t0 < 2500 ? requestAnimationFrame(f) : r((n * 1000) / (performance.now() - t0)));
  requestAnimationFrame(f);
}));
const cases = (process.env.CASES ?? 'base').split('|');
for (const c of cases) {
  if (c !== 'base') await page.evaluate(c);
  await page.waitForTimeout(Number(process.env.SETTLE ?? 800));
  const f = await fps();
  const st = await page.evaluate(() => window.__rn.engine.drawStats());
  // rAF rate; a still view skips most frames on purpose, so read "rendered" too.
  const r = await page.evaluate(() => window.__rn.get().fps);
  console.log(f.toFixed(1).padStart(6), 'raf |', r.toFixed(1).padStart(5), 'rendered |', `${st.drawn}/${st.loaded}`, '|', c.slice(0, 70));
}
await browser.close();
