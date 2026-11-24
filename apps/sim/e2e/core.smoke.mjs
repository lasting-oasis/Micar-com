// Smoke test for driving on the physics core (packages/physics DESIGN.md section 13), against a running server
// (production build) started with SMOKE=1 as for strip.smoke.mjs (a new player is given a starter car):
//   pnpm --filter @micar/sim build && SMOKE=1 NODE_ENV=production PORT=3123 pnpm --filter @micar/sim start &
//   BASE=http://localhost:3123/ pnpm --filter @micar/sim exec node e2e/core.smoke.mjs
// The game is opened with ?physics=core: the starter car is driven forward for a few seconds and then turned left,
// and the test checks the car moved and turned, the HUD's speed and rev needle moved with it (read off the HUD
// canvas as it draws), the car panel's speed changed, and the console stayed clean. Then the same address without the
// switch gets the old model. Exits 1 on any failed assertion or page error. Software GL (swiftshader), so it runs
// headless; the game is slow there (a few frames a second, each at most 0.05 s of driving), so it drives on a clock
// long enough for that.
import { chromium } from 'playwright';

const BASE = (process.env.BASE || 'http://localhost:3123/').replace(/\/?$/, '/');
const errs = [];
const fail = (m) => { throw new Error(m); };
const ok = (c, m) => { if (!c) fail('ASSERT: ' + m); console.log('ok  ' + m); };
const NET = /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/;

// What the driving HUD (world/hud.ts) draws: the speed number before its unit, and the rev needle's angle (the line
// stroked in the needle's colour and width). Read off the 2D canvas calls, so it is what the player sees.
const watchHud = () => {
  const P = CanvasRenderingContext2D.prototype, fillText = P.fillText, lineTo = P.lineTo;
  const hud = window.__hud = { speed: null, needle: null, draws: 0 };
  let last = null;
  P.fillText = function (t, x, y, ...rest) {
    const s = String(t);
    if (/^(mph|km\/h)$/i.test(s) && last !== null) { hud.speed = last; hud.draws++; }
    last = s;
    return fillText.call(this, t, x, y, ...rest);
  };
  P.lineTo = function (x, y) {
    if (this.lineWidth === 3 && String(this.strokeStyle).toLowerCase() === '#ff3b5c') hud.needle = Math.atan2(y, x);
    return lineTo.call(this, x, y);
  };
};

async function open(browser, query, name) {
  const p = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  p.setDefaultTimeout(30000);
  await p.addInitScript(() => { try { localStorage.setItem('cds.graphics', 'low'); localStorage.setItem('micar.carPanel', 'open'); } catch {} });
  await p.addInitScript(watchHud);
  p.on('console', m => { if (m.type() === 'error' && !NET.test(m.text())) errs.push(`${name} console.error: ` + m.text()); });
  p.on('pageerror', e => errs.push(`${name} pageerror: ` + e.message));
  await p.goto(BASE + query, { waitUntil: 'domcontentloaded' });
  await p.fill('input[placeholder="e.g. Queen City Motors"]', name);
  await p.click('button[type=submit]');
  await p.waitForFunction(() => !!window.__micar, null, { timeout: 90000 });
  await p.waitForTimeout(8000);
  await p.locator('button:text-is("✕")').last().click({ timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(500);
  const inCar = await p.waitForFunction(() => window.__micar.drive(), null, { timeout: 60000, polling: 1000 }).then(() => true, () => false);
  if (!inCar) fail('no car to drive: start the server with SMOKE=1 (a new player is then given a starter car)');
  return p;
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let code = 0;
try {
  // 1. ?physics=core: the starter car is on the core
  const p = await open(browser, '?physics=core', 'CoreBot');
  const M = (fn, arg) => p.evaluate(fn, arg);
  const pose = () => M(() => window.__micar.pose());
  const hud = () => M(() => ({ ...window.__hud, panel: document.querySelector('[data-car-panel] .font-mono')?.textContent ?? null }));
  const a = await pose();
  ok(a.driving && a.physics === 'core', `got into the starter car on the physics core (physics: ${a.physics})`);
  ok(a.redline > 3000 && a.redline < 12000, `the HUD's redline is in rev/min (${a.redline})`);
  await p.waitForFunction(() => window.__hud.draws > 3 && window.__hud.needle !== null, null, { timeout: 30000 });
  const h0 = await hud();
  console.log(`    at rest: speed ${a.speed.toFixed(2)} m/s, ${a.rpm} rpm, gear ${a.gear}; HUD speed "${h0.speed}", needle ${h0.needle.toFixed(3)} rad, panel "${h0.panel}"`);

  // 2. forward: W until the car has a few seconds of driving in it (the frames are slow), then W and A (left)
  const fps = await M(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); }));
  const simPerSecond = Math.min(1, fps * 0.05);   // a frame drives at most 0.05 s
  const wall = (simSeconds) => Math.min(60000, Math.ceil(simSeconds / simPerSecond * 1000));
  console.log(`    ${fps.toFixed(1)} frames a second: ${simPerSecond.toFixed(2)} s of driving a second`);
  await p.keyboard.down('KeyW');
  let peakRpm = 0;
  for (const t0 = Date.now(); Date.now() - t0 < wall(3);) { await p.waitForTimeout(250); peakRpm = Math.max(peakRpm, (await pose()).rpm); }
  const b = await pose(), h1 = await hud();
  console.log(`    after W: speed ${b.speed.toFixed(2)} m/s, ${b.rpm} rpm (peak ${peakRpm}), gear ${b.gear}; HUD speed "${h1.speed}", needle ${h1.needle.toFixed(3)} rad, panel "${h1.panel}"`);
  ok(Math.hypot(b.x - a.x, b.z - a.z) > 2, `W moved the car (${Math.hypot(b.x - a.x, b.z - a.z).toFixed(1)} units)`);
  ok(b.speed > 1, `it is rolling forward (${b.speed.toFixed(1)} m/s)`);
  ok(peakRpm > a.rpm + 500, `the revs rose (${a.rpm} -> ${peakRpm} rpm)`);
  ok(h1.speed !== h0.speed && Number(h1.speed) > 0, `the HUD's speed changed ("${h0.speed}" -> "${h1.speed}")`);
  ok(Math.abs(h1.needle - h0.needle) > 0.05, `the HUD's rev needle moved (${h0.needle.toFixed(3)} -> ${h1.needle.toFixed(3)} rad)`);
  ok(h1.panel !== h0.panel, `the car panel's speed changed ("${h0.panel}" -> "${h1.panel}" mph)`);
  await p.keyboard.down('KeyA');
  await p.waitForTimeout(wall(2.5));
  await p.keyboard.up('KeyA'); await p.keyboard.up('KeyW');
  const c = await pose();
  const turned = c.rotY - b.rotY, moved = Math.hypot(c.x - b.x, c.z - b.z);
  console.log(`    after W+A: heading ${b.rotY.toFixed(3)} -> ${c.rotY.toFixed(3)} rad, moved ${moved.toFixed(1)} units, speed ${c.speed.toFixed(2)} m/s, ${c.rpm} rpm`);
  ok(moved > 2, `the car kept going through the turn (${moved.toFixed(1)} units)`);
  ok(turned > 0.1, `A turned it left: the heading grew (${turned.toFixed(2)} rad)`);
  ok(errs.length === 0, 'no console errors on the core');
  await p.close();

  // 3. the same address without the switch drives the old model
  const q = await open(browser, '', 'ClassicBot');
  const k = await q.evaluate(() => window.__micar.pose());
  ok(k.driving && k.physics === 'classic', `without ?physics=core the car is on the old model (physics: ${k.physics})`);
  await q.close();

  ok(errs.length === 0, 'no page errors');
} catch (e) {
  code = 1; console.error('FAIL: ' + e.message);
} finally {
  if (errs.length) { code = 1; console.error('PAGE ERRORS:\n' + errs.join('\n')); }
  await browser.close();
}
console.log(code ? 'SMOKE FAILED' : 'SMOKE PASSED');
process.exit(code);
