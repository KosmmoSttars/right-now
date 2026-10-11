// Screenshots the running app in a real headless Edge with the GPU on (the built-in
// browser pane is often hidden, which stops requestAnimationFrame and WebGL).
//
// Usage: node scripts/frames.mjs <url> <outPrefix> <ms,ms,...> [width] [height]
// STEPS='click:.selector;key:m;wait:500' runs actions before the timed shots.
// Each shot is taken at the given ms after the page (and STEPS) settled.
import { chromium } from '@playwright/test';

const [, , url, prefix, times = '0', w = '1440', h = '900'] = process.argv;
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? 'msedge',
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: Number(process.env.DPR ?? 1),
  isMobile: !!process.env.MOBILE,
  hasTouch: !!process.env.MOBILE,
  reducedMotion: process.env.REDUCED ? 'reduce' : 'no-preference',
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text().slice(0, 400)}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector(process.env.READY ?? '.app[data-phase="ready"]', { timeout: 60000 });

for (const step of (process.env.STEPS ?? '').split(';').filter(Boolean)) {
  const [kind, ...rest] = step.split(':');
  const arg = rest.join(':');
  if (kind === 'click') await page.locator(arg).first().click();
  else if (kind === 'key') await page.keyboard.press(arg);
  else if (kind === 'wait') await page.waitForTimeout(Number(arg));
  else if (kind === 'type') await page.keyboard.type(arg, { delay: 40 });
  else if (kind === 'eval') await page.evaluate(arg);
  else if (kind === 'mouse') {
    const [x, y] = arg.split(',').map(Number);
    await page.mouse.move(x, y);
  } else if (kind === 'clickat') {
    const [x, y] = arg.split(',').map(Number);
    await page.mouse.click(x, y);
  }
}

const start = Date.now();
for (const ms of times.split(',').map(Number)) {
  const wait = start + ms - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: `${prefix}-${String(ms).padStart(5, '0')}.png` });
}
if (process.env.FPS) {
  const fps = await page.evaluate(() => new Promise((r) => {
    let n = 0;
    const t0 = performance.now();
    const f = () => (++n, performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r((n * 1000) / (performance.now() - t0)));
    requestAnimationFrame(f);
  }));
  console.log('fps', fps.toFixed(1));
}
if (errors.length) console.log('console:\n' + [...new Set(errors)].join('\n'));
await browser.close();
