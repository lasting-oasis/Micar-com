// Smoke test for the Strip, against a running server (production build) started with SMOKE=1 (a new player is given a
// starter car, so no auction window is needed): town -> gate -> Strip -> drag -> results -> Garage -> a performance part.
//   pnpm --filter @micar/sim build && SMOKE=1 NODE_ENV=production PORT=3123 pnpm --filter @micar/sim start &
// A second run follows: a guest at /strip rents a car at the counter ($500 -> $0), races the drag, and the rental is returned.
// A third, when the server and this script were both started with the same TESTER_KEY (any throwaway value of 8+ characters):
// tester mode on a phone-sized screen, from the key typed after the name to the Garage and back.
//   BASE=http://localhost:3123/ pnpm --filter @micar/sim exec node e2e/strip.smoke.mjs
// Exits 1 on any failed assertion or page error. Software GL (swiftshader), so it runs headless with no display; the game
// is slow there (~3 fps), so the drag waits on the results card, not on a clock.
import { chromium, devices } from 'playwright';

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

  // 2. a car: close the guide, get into the starter car (SMOKE=1)
  await p.locator('button:text-is("✕")').last().click({ timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(500);
  const inCar = await p.waitForFunction(() => window.__micar.drive(), null, { timeout: 60000, polling: 1000 }).then(() => true, () => false);
  if (!inCar) fail('no car to drive: start the server with SMOKE=1 (a new player is then given a starter car)');
  ok(true, 'got into the starter car');

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
  ok(await M(() => window.__micar.startEvent('royal_drag')), 'started the drag (royal_drag, the Monza quarter mile)');
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

  // 7. buy a performance part through the menu: a stat bar changes and the money drops
  const barState = () => p.locator('div.grid.grid-cols-12').evaluateAll(els => els.map(e => e.parentElement.innerText.replace(/\s+/g, ' ').trim() + ' | ' + [...e.children].map(i => i.className.includes('bg-market') ? '#' : '.').join('')));
  const before = await barState(), cash0 = await M(() => window.__micar.money());
  await p.locator('[role=option]', { hasText: 'Performance' }).first().click();
  await p.waitForTimeout(500);
  await p.locator('[role=option]', { hasText: 'Engine' }).first().click();
  await p.waitForTimeout(500);
  const forSale = p.locator('[role=option]', { hasText: '$1,800' }).first(); // Engine, street tier (stage 1)
  ok(await forSale.count() === 1, 'the Engine menu lists the $1,800 street engine');
  await forSale.click(); // a mouse click selects the row and buys it
  await p.waitForFunction(c => window.__micar.money() < c, cash0, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const after = await barState(), cash1 = await M(() => window.__micar.money());
  ok(cash1 < cash0, `buying the part took money ($${cash0} -> $${cash1})`);
  const changed = before.filter((b, i) => b !== after[i]);
  ok(changed.length > 0, `a stat bar changed (${changed.length}: ${before.find((b, i) => b !== after[i])} -> ${after.find((b, i) => b !== before[i])})`);

  // 8. the guest path: /strip -> "Race as guest" -> rent at the counter -> drag -> "Rental returned" -> no car left
  await p.close(); // one renderer at a time: swiftshader is slow
  const g = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  g.setDefaultTimeout(30000);
  await g.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('cds.graphics', 'low'); } catch {} });
  g.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(m.text())) errs.push('guest console.error: ' + m.text()); });
  g.on('pageerror', e => errs.push('guest pageerror: ' + e.message));
  const G = (fn, arg) => g.evaluate(fn, arg);
  await g.goto(BASE.replace(/\/?$/, '/') + 'strip', { waitUntil: 'domcontentloaded' });
  await g.fill('input[type=text], input:not([type])', 'GuestBot');
  await g.getByRole('button', { name: /Race as guest/i }).click();
  await g.waitForFunction(() => !!window.__micar, null, { timeout: 90000 });
  ok(true, 'the guest joined the Strip (window.__micar)');
  await g.waitForFunction(() => window.__micar.money() === 500, null, { timeout: 30000 });
  ok(await G(() => window.__micar.money()) === 500, 'the guest starts with $500');
  await g.waitForSelector('[aria-label="Rental counter"]', { timeout: 60000 });
  ok(true, 'the rental counter is up');
  ok(await G(() => window.__micar.rent('ronin')), 'rented the coupe at the counter');
  await g.waitForFunction(() => window.__micar.money() === 0, null, { timeout: 20000 });
  ok(await G(() => window.__micar.money()) === 0, 'the rental cost $500 (money 500 -> 0)');
  await g.waitForTimeout(1500);
  const gotCar = await g.waitForFunction(() => window.__micar.drive(), null, { timeout: 60000, polling: 1000 }).then(() => true, () => false);
  ok(gotCar, 'got into the rental');
  ok(await G(() => window.__micar.startEvent('royal_drag')), 'started the guest drag (royal_drag)');
  await g.setViewportSize({ width: 480, height: 270 });
  await g.waitForTimeout(1000);
  await g.keyboard.down('KeyW');
  const g0 = Date.now(); let gdone = false;
  while (!gdone && Date.now() - g0 < 240000) {
    await g.waitForTimeout(150);
    const q = await G(() => window.__micar.pose());
    if (q.gear >= 1 && q.rpm > q.redline * 0.8) { await g.keyboard.down('ShiftLeft'); await g.waitForTimeout(500); await g.keyboard.up('ShiftLeft'); }
    gdone = await G(() => document.body.textContent.includes('Continue [Enter]'));
  }
  await g.keyboard.up('KeyW');
  await g.setViewportSize({ width: 960, height: 540 });
  await g.waitForTimeout(2000);
  ok(gdone, `the guest's results card appeared (${Math.round((Date.now() - g0) / 1000)} s wall clock)`);
  const gcard = await G(() => document.body.innerText);
  const onHand = /Rental returned\s*—\s*\$([\d,]+) on hand/.exec(gcard);
  ok(!!onHand, 'the results card says "Rental returned"');
  const prize = /\+\$([\d,]+)/.exec(gcard);
  ok(!!prize || /No prize/.test(gcard), 'the card reports the prize (a figure or "No prize")');
  const prizeN = prize ? Number(prize[1].replace(/,/g, '')) : 0; // no prize shown = $0
  ok(Number(onHand[1].replace(/,/g, '')) === prizeN, `the card's money on hand equals the prize ($${prizeN})`);
  await g.keyboard.press('Enter'); await g.waitForTimeout(1500);
  const gm = await G(() => window.__micar.money());
  ok(gm === prizeN, `the guest's money is the prize paid ($${gm})`);
  const held = await G(() => window.__micar.cars());
  ok(held.length === 0, `the rental is gone from the inventory (${held.length} cars)`);

  // 9. tester mode: "Name#key" at /strip -> every car, money that refills -> the Garage from the pause menu -> swap.
  //    The key is never printed. Phone-sized, where the Garage's "Drive" once sat under the menu column.
  const KEY = process.env.TESTER_KEY;
  if (!KEY) console.log('skip the tester run: no TESTER_KEY was given to this script');
  else {
    await g.close();
    const t = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    t.setDefaultTimeout(60000);
    await t.addInitScript(() => { try { localStorage.setItem('cds.graphics', 'low'); } catch {} });
    t.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(m.text())) errs.push('tester console.error: ' + m.text().split(KEY).join('<key>')); });
    t.on('pageerror', e => errs.push('tester pageerror: ' + e.message.split(KEY).join('<key>')));
    const T = (fn, arg) => t.evaluate(fn, arg);
    await t.goto(BASE.replace(/\/?$/, '/') + 'strip', { waitUntil: 'domcontentloaded' });
    await t.fill('input[type=text]', `TestBot#${KEY}`);
    await t.getByRole('button', { name: /Race as guest/i }).click();
    const counter = t.locator('[aria-label="Rental counter"]');
    await counter.waitFor({ timeout: 90000 });
    await t.waitForFunction(() => window.__micar.money() === 1000000, null, { timeout: 30000 });
    ok(true, 'the key after the name made a tester: $1,000,000 at the counter');
    ok(await T(() => localStorage.getItem('micar.name')) === 'TestBot', 'the key did not become part of the name');
    ok(!(await t.content()).includes(KEY), 'the key is nowhere on the page');
    await counter.getByRole('button', { name: /Chevy Corvette/i }).click();
    await t.waitForFunction(() => window.__micar.pose().driving === true, null, { timeout: 120000 });
    ok(true, 'took a Corvette from the list and is driving it');
    await t.waitForTimeout(1500);
    await t.keyboard.press('Escape');
    await t.getByRole('button', { name: 'Garage', exact: true }).click();
    await t.waitForSelector('[role=dialog][aria-label="Garage"]');
    await t.waitForSelector('div.grid.grid-cols-12', { timeout: 120000 });
    await t.locator('[role=option]', { hasText: 'Performance' }).first().click();
    await t.waitForTimeout(500);
    await t.locator('[role=option]', { hasText: 'Engine' }).first().click();
    await t.waitForTimeout(500);
    await t.locator('[role=option]', { hasText: '$9,800' }).first().click(); // Engine, extreme tier: a stage 3 part
    await t.locator('[role=option]', { hasText: 'Extreme' }).filter({ hasText: 'Equipped' }).waitFor({ timeout: 30000 });
    ok(true, 'the pause menu opened the Garage, and the top engine ($9,800, stage 3) went on');
    await t.getByRole('button', { name: 'Drive' }).first().click();
    await t.waitForSelector('[role=dialog][aria-label="Garage"]', { state: 'detached' });
    ok(await T(() => window.__micar.pose().driving === true), '"Drive" left the Garage: back in the car');
    await t.waitForTimeout(1500);
    await t.keyboard.press('Escape');
    await t.getByRole('button', { name: 'Swap car', exact: true }).click();
    await counter.waitFor({ timeout: 120000 });
    await t.waitForFunction(() => window.__micar.money() === 1000000, null, { timeout: 30000 });
    ok(true, '"Swap car" is back at the counter, the money full again');
  }

  // 10. the phone's stick controls: a guest on a phone-sized touch screen rents a car and drives it with the sticks
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
    const m = await ctx.newPage();
    m.setDefaultTimeout(60000);
    await m.addInitScript(() => { try { localStorage.setItem('cds.graphics', 'low'); } catch {} });
    m.on('pageerror', e => errs.push('phone pageerror: ' + e.message));
    await m.goto(BASE.replace(/\/?$/, '/') + 'strip', { waitUntil: 'domcontentloaded' });
    await m.fill('input[type=text]', 'Thumbs');
    await m.getByRole('button', { name: /Race as guest/i }).click();
    const counter = m.locator('[aria-label="Rental counter"]');
    await counter.waitFor({ timeout: 90000 });
    await counter.getByRole('button', { name: /Ronin GT/i }).click(); // by name: the counter's first row is "Challenge a friend"
    await m.waitForFunction(() => window.__micar.pose().driving === true, null, { timeout: 120000 });
    ok(await m.getByRole('slider', { name: 'Steering' }).isVisible() && await m.getByRole('slider', { name: 'Gas and brake' }).isVisible(), 'a phone drives with the steering and gas sticks');
    ok(!(await m.locator('[data-k="thr"]').isVisible()), 'the old buttons are hidden');
    const r = await m.getByRole('slider', { name: 'Gas and brake' }).boundingBox();
    const cdp = await ctx.newCDPSession(m), gx = r.x + r.width / 2, gy = r.y + r.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: gx, y: gy, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: gx, y: r.y, id: 1 }] });
    await m.waitForFunction(() => window.__micar.pose().speed > 0.5, null, { timeout: 30000 });
    ok(true, 'pushing the gas stick up drives the car');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await ctx.close();
  }

  ok(errs.length === 0, 'no page errors');
} catch (e) {
  code = 1; console.error('FAIL: ' + e.message);
} finally {
  if (errs.length) { code = 1; console.error('PAGE ERRORS:\n' + errs.join('\n')); }
  await browser.close();
}
console.log(code ? 'SMOKE FAILED' : 'SMOKE PASSED');
process.exit(code);
