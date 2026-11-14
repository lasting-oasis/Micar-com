// Smoke test for the data diet (docs/superpowers/specs/2026-11-14-world-data-diet-design.md), against a running server
// (production build): two browsers, both guests in the Strip, each in a rental. The watcher sits at the hub's spawn; the
// mover is put 14 m in front of it, on its left, and moved across to its right a metre each 100 ms. The watcher's page
// draws the mover (its name tag) and follows it. Screenshots of the watcher at 1280 px (left, then right) and at 375 px
// go to e2e/out/diet-*.png. Exits 1 on a failed assertion or a page error. Software GL (swiftshader), so every step
// waits on the page's own state.
//   pnpm --filter @micar/sim build && NODE_ENV=production PORT=3301 pnpm --filter @micar/sim start &
//   BASE=http://localhost:3301/ pnpm --filter @micar/sim exec node e2e/diet.smoke.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.BASE || 'http://localhost:3301/').replace(/\/?$/, '/');
const OUT = fileURLToPath(new URL('./out/', import.meta.url)); mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const W = 2; // world units per metre (world/units.ts WORLD_PER_M)
const SPAWN = { x: 0, z: 30, h: Math.PI }; // the hub's spawn (strip/hub.json), facing -Z
const errs = [];
const fail = (m) => { throw new Error(m); };
const ok = (c, m) => { if (!c) fail('ASSERT: ' + m); console.log('ok  ' + m); };

/** A browser of its own, a guest in the Strip in a rented car. */
async function guest(name, viewport) {
  const browser = await chromium.launch({ args: ARGS });
  const p = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  p.setDefaultTimeout(60000);
  await p.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('cds.graphics', 'low'); } catch {} });
  p.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(m.text())) errs.push(`${name} console.error: ${m.text()}`); });
  p.on('pageerror', e => errs.push(`${name} pageerror: ${e.message}`));
  await p.goto(BASE + 'strip', { waitUntil: 'domcontentloaded' });
  await p.fill('input[type=text], input:not([type])', name);
  await p.getByRole('button', { name: /Race as guest/i }).click();
  await p.waitForFunction(() => !!window.__micar && window.__micar.money() === 500, null, { timeout: 90000 });
  await p.waitForSelector('[aria-label="Rental counter"]', { timeout: 60000 });
  ok(await p.evaluate(() => window.__micar.rent('ronin')), `${name} rented a car`);
  await p.waitForFunction(() => window.__micar.money() === 0, null, { timeout: 20000 });
  await p.waitForTimeout(1500);
  await p.waitForFunction(() => window.__micar.drive(), null, { timeout: 60000, polling: 1000 });
  ok(true, `${name} is in the car`);
  return { browser, p, name };
}
/** Puts a guest's car at (x, z) metres in the Strip, heading h (physics: forward = (sin h, cos h)). */
const place = (g, x, z, h) => g.p.evaluate(([x, z, r]) => window.__micar.place(x, z, r), [x * W, z * W, h + Math.PI]);

let code = 0;
const watcher = await guest('Watcher', { width: 1280, height: 720 });
const mover = await guest('Mover', { width: 480, height: 400 });
try {
  ok(await place(watcher, SPAWN.x, SPAWN.z, SPAWN.h), 'the watcher sits at the spawn, facing -Z');
  // the mover, 14 m ahead of the watcher, crosses its view: the camera looks along -Z, so +X is to its right
  const across = (dx) => place(mover, SPAWN.x + dx, SPAWN.z - 14, SPAWN.h - Math.PI / 2);
  for (let dx = -7; dx <= -5; dx++) { ok(await across(dx), `the mover is ${-dx} m left of the watcher's line, 14 m ahead`); await mover.p.waitForTimeout(100); }
  await watcher.p.waitForFunction(() => window.__micar.stripPlayers().length === 1, null, { timeout: 30000 });
  ok(true, 'the watcher draws one other player in the Strip (the mover)');
  await watcher.p.waitForTimeout(1500);
  await watcher.p.screenshot({ path: OUT + 'diet-1280-left.png' });
  for (let dx = -4; dx <= 7; dx++) { await across(dx); await mover.p.waitForTimeout(100); }
  ok(true, 'the mover crossed to 7 m right of the line, a metre each 100 ms');
  await watcher.p.waitForTimeout(1500);
  await watcher.p.screenshot({ path: OUT + 'diet-1280-right.png' });
  ok(await watcher.p.evaluate(() => window.__micar.stripPlayers().length) === 1, 'still drawn after it moved across');
  // the same at 375 px (a phone, portrait), the mover back near the middle
  await watcher.p.setViewportSize({ width: 375, height: 812 });
  for (let dx = 6; dx >= 2; dx--) { await across(dx); await mover.p.waitForTimeout(100); }
  await watcher.p.waitForTimeout(1500);
  await watcher.p.screenshot({ path: OUT + 'diet-375.png' });
  ok(await watcher.p.evaluate(() => window.__micar.stripPlayers().length) === 1, 'drawn at 375 px too');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
} catch (e) {
  console.error(String(e?.stack || e));
  if (errs.length) console.error(errs.join('\n'));
  code = 1;
} finally {
  await watcher.browser.close(); await mover.browser.close();
}
process.exit(code);
