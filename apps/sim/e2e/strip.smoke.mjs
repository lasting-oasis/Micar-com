// Smoke test for the Strip, against a running server (production build): town -> gate -> Strip -> drag -> results -> Garage.
//   pnpm --filter @micar/sim build && PORT=3123 pnpm --filter @micar/sim start &
//   BASE=http://localhost:3123/ pnpm --filter @micar/sim exec node e2e/strip.smoke.mjs
// Exits 1 on any failed assertion or page error. Software GL (swiftshader), so it runs headless with no display; the game
// is slow there (~3 fps), so the drag waits on the results card, not on a clock.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:3123/';
const NAME = 'SmokeBot';
const errs = [];
const fail = (m) => { throw new Error(m); };
const ok = (c, m) => { if (!c) fail('ASSERT: ' + m); console.log('ok  ' + m); };

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let code = 0;
try {
  const p = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  p.setDefaultTimeout(30000);
  await p.addInitScript(() => { try { localStorage.setItem('cds.graphics', 'low'); } catch {} });
  p.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(m.text())) errs.push('console.error: ' + m.text()); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  const M = (fn, arg) => p.evaluate(fn, arg);
  const pose = () => M(() => window.__micar.pose());

  // 1. the front door: a name, Enter
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.fill('input[placeholder="e.g. Queen City Motors"]', NAME);
  await p.click('button[type=submit]');
  await p.waitForFunction(() => !!window.__micar, null, { timeout: 90000 });
  ok(true, 'the world loaded (window.__micar)');
  await p.waitForTimeout(8000);

  // 2. a car: close the guide, buy at the auction, get in
  await p.locator('button:text-is("✕")').last().click({ timeout: 20000 }).catch(() => {});
  await p.locator('button:has-text("GLOBAL AUCTION")').first().click();
  await p.waitForTimeout(1500);
  if (!(await p.locator('button:has-text("Pay Cash")').count())) fail('no car to buy: the auction is only open 8:00-17:00 game time (the first ~4.5 minutes after the server starts); restart the server with a fresh data dir');
  await p.locator('button:has-text("Pay Cash")').first().click();
  await p.waitForTimeout(1500);
  await p.keyboard.press('Tab');
  await p.waitForTimeout(500);
  ok(await M(() => window.__micar.drive()), 'got into a car');

  // 3. W for 3 s moves it
  const a = await pose();
  await p.keyboard.down('KeyW'); await p.waitForTimeout(3000); await p.keyboard.up('KeyW');
  const b = await pose();
  ok(Math.hypot(b.x - a.x, b.z - a.z) > 0.5, `W moved the car (${Math.hypot(b.x - a.x, b.z - a.z).toFixed(1)} units)`);

  // 4. the gate, then the Strip
  ok(await M(() => window.__micar.place(0, 1715, Math.PI)), 'placed the car on the gate ring');
  await p.waitForTimeout(2500);
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => window.__micar.district() === 'strip', null, { timeout: 60000 });
  ok(true, 'Enter on the gate put us in the Strip');

  // 5. a drag race: hold W, shift (clutch) at the redline, until the results card shows
  ok(await M(() => window.__micar.startEvent('dr1')), 'started the drag (dr1)');
  await p.setViewportSize({ width: 480, height: 270 }); // fewer pixels, faster frames
  await p.waitForTimeout(1000);
  await p.keyboard.down('KeyW');
  const t0 = Date.now(); let done = false;
  while (!done && Date.now() - t0 < 240000) {
    await p.waitForTimeout(150);
    const q = await pose();
    if (q.gear >= 1 && q.rpm > q.redline * 0.8) { await p.keyboard.down('ShiftLeft'); await p.waitForTimeout(500); await p.keyboard.up('ShiftLeft'); }
    done = await M(() => document.body.textContent.includes('Continue [Enter]'));
  }
  await p.keyboard.up('KeyW');
  await p.setViewportSize({ width: 960, height: 540 });
  await p.waitForTimeout(2000);
  ok(done, `the results card appeared (${Math.round((Date.now() - t0) / 1000)} s wall clock)`);
  const card = await M(() => document.body.innerText);
  ok(/\bYou\b/.test(card), 'the results card lists "You"');
  await p.keyboard.press('Enter'); await p.waitForTimeout(1500); // Continue

  // 6. back to town, the Garage's stat panel has five bars
  await M(() => window.__micar.exitStrip());
  await p.waitForFunction(() => window.__micar.district() === 'town');
  ok(await M(() => window.__micar.openGarage()), 'opened the Garage menu');
  await p.waitForSelector('div.grid.grid-cols-12', { timeout: 60000 });
  const bars = await p.locator('div.grid.grid-cols-12').count();
  ok(bars === 5, `the Garage stat panel has 5 bars (found ${bars})`);

  ok(errs.length === 0, 'no page errors');
} catch (e) {
  code = 1; console.error('FAIL: ' + e.message);
} finally {
  if (errs.length) { code = 1; console.error('PAGE ERRORS:\n' + errs.join('\n')); }
  await browser.close();
}
console.log(code ? 'SMOKE FAILED' : 'SMOKE PASSED');
process.exit(code);
