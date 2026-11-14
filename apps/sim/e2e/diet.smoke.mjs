// Smoke test for the data diet (docs/superpowers/specs/2026-11-14-world-data-diet-design.md), against a running server
// (production build, started with SMOKE=1 so a new dealer has a starter car). Two browsers at a time, each moved by
// `window.__micar.place`:
// 1. The Strip: two guests in rentals. The watcher sits at the hub's spawn; the mover is put 14 m ahead on its left and
//    moved across to its right, a metre each 100 ms. The watcher's page draws the mover where it was put (its name tag:
//    the Strip draws other players as name tags only, as it did before this change) and follows it across.
// 2. The town: two dealers in their starter cars, the same crossing 20 m ahead on the road to the gate. The watcher's
//    page draws the mover (its dealer) where it was put.
// Each check reads where the page draws the other player (`window.__micar.drawnAt`). Screenshots of the watcher, at
// 1280 px and at 375 px, go to e2e/out/diet-*.png. Exits 1 on a failed assertion or a page error. Software GL
// (swiftshader), so every step waits on the page's own state.
//   pnpm --filter @micar/sim build && SMOKE=1 NODE_ENV=production PORT=3301 pnpm --filter @micar/sim start &
//   BASE=http://localhost:3301/ pnpm --filter @micar/sim exec node e2e/diet.smoke.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.BASE || 'http://localhost:3301/').replace(/\/?$/, '/');
const OUT = fileURLToPath(new URL('./out/', import.meta.url)); mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const W = 2; // world units per metre (world/units.ts WORLD_PER_M)
const errs = [];
const fail = (m) => { throw new Error(m); };
const ok = (c, m) => { if (!c) fail('ASSERT: ' + m); console.log('ok  ' + m); };

/** A browser of its own, its errors collected under `name`. */
async function open(name, viewport) {
  const browser = await chromium.launch({ args: ARGS });
  const p = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  p.setDefaultTimeout(60000);
  await p.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('cds.graphics', 'low'); } catch {} });
  p.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(m.text())) errs.push(`${name} console.error: ${m.text()}`); });
  p.on('pageerror', e => errs.push(`${name} pageerror: ${e.message}`));
  return { browser, p, name };
}
/** A guest in the Strip, in a rented car. */
async function guest(name, viewport) {
  const g = await open(name, viewport), p = g.p;
  await p.goto(BASE + 'strip', { waitUntil: 'domcontentloaded' });
  await p.fill('input[type=text], input:not([type])', name);
  await p.getByRole('button', { name: /Race as guest/i }).click();
  await p.waitForFunction(() => !!window.__micar && window.__micar.money() === 500, null, { timeout: 90000 });
  await p.waitForSelector('[aria-label="Rental counter"]', { timeout: 60000 });
  ok(await p.evaluate(() => window.__micar.rent('ronin')), `${name} rented a car`);
  await p.waitForFunction(() => window.__micar.money() === 0, null, { timeout: 20000 });
  await p.waitForTimeout(1500);
  await p.waitForFunction(() => window.__micar.drive(), null, { timeout: 60000, polling: 1000 });
  ok(true, `${name} is in the car, in the Strip`);
  return g;
}
/** A dealer in the town, in its starter car. */
async function dealer(name, viewport) {
  const d = await open(name, viewport), p = d.p;
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.fill('input[placeholder="e.g. Queen City Motors"]', name);
  await p.click('button[type=submit]');
  await p.waitForFunction(() => !!window.__micar, null, { timeout: 90000 });
  await p.waitForTimeout(8000);
  await p.locator('button:text-is("✕")').last().click({ timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(500);
  await p.waitForFunction(() => window.__micar.drive(), null, { timeout: 60000, polling: 1000 });
  ok(await p.evaluate(() => window.__micar.district()) === 'town', `${name} is in its starter car, in the town`);
  return d;
}
/** Puts a page's car at (x, z) metres of its district, heading h (physics: forward = (sin h, cos h)). */
const place = (g, x, z, h) => g.p.evaluate(([x, z, r]) => window.__micar.place(x, z, r), [x * W, z * W, h + Math.PI]);
/** Where `watcher` draws the player called `name` (world units), once its drawing has caught up. */
const drawn = async (watcher, name) => { await watcher.p.waitForTimeout(1500); return watcher.p.evaluate((n) => window.__micar.drawnAt(n), name); };
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
/** The mover crosses the watcher's view `ahead` metres in front of it, from x = `from` to `to` metres, a metre each 100 ms. */
async function cross(mover, at, ahead, from, to) {
  const step = Math.sign(to - from);
  for (let x = from; x !== to + step; x += step) { await place(mover, at.x + x, at.z + ahead * Math.cos(at.h), at.h - Math.PI / 2); await mover.p.waitForTimeout(100); }
}

let code = 0;
const opened = [];
try {
  // 1. the Strip
  const watcher = await guest('Watcher', { width: 1280, height: 720 }); opened.push(watcher);
  const mover = await guest('Mover', { width: 480, height: 400 }); opened.push(mover);
  const SPAWN = { x: 0, z: 30, h: Math.PI }; // the hub's spawn (strip/hub.json), facing -Z: ahead is -Z, its right is +X
  ok(await place(watcher, SPAWN.x, SPAWN.z, SPAWN.h), 'the Strip watcher sits at the spawn, facing -Z');
  await cross(mover, SPAWN, 14, -7, -5);
  await watcher.p.waitForFunction(() => window.__micar.stripPlayers().length === 1, null, { timeout: 30000 });
  let at = await drawn(watcher, 'Mover');
  ok(!!at && near(at.x, (SPAWN.x - 5) * W) && near(at.z, (SPAWN.z - 14) * W), `the watcher draws the mover's tag where it was put, 5 m left (x ${at?.x?.toFixed(1)}, z ${at?.z?.toFixed(1)})`);
  await watcher.p.screenshot({ path: OUT + 'diet-1280-left.png' });
  await cross(mover, SPAWN, 14, -4, 7);
  at = await drawn(watcher, 'Mover');
  ok(!!at && near(at.x, (SPAWN.x + 7) * W) && near(at.z, (SPAWN.z - 14) * W), `the tag followed it across, 7 m right (x ${at?.x?.toFixed(1)}, z ${at?.z?.toFixed(1)})`);
  await watcher.p.screenshot({ path: OUT + 'diet-1280-right.png' });
  await watcher.p.setViewportSize({ width: 375, height: 812 }); // a phone, portrait
  await cross(mover, SPAWN, 14, 6, 2);
  at = await drawn(watcher, 'Mover');
  ok(!!at && near(at.x, (SPAWN.x + 2) * W), `at 375 px too (x ${at?.x?.toFixed(1)})`);
  await watcher.p.screenshot({ path: OUT + 'diet-375.png' });
  for (const g of opened.splice(0)) await g.browser.close();

  // 2. the town
  const townWatcher = await dealer('TownWatcher', { width: 1280, height: 720 }); opened.push(townWatcher);
  const townMover = await dealer('TownMover', { width: 480, height: 400 }); opened.push(townMover);
  const ROAD = { x: 0, z: 800, h: 0 }; // on the road to the gate (GATE at z 1715 units), facing +Z: ahead is +Z, its right is -X
  ok(await place(townWatcher, ROAD.x, ROAD.z, ROAD.h), 'the town watcher sits on the road to the gate, facing +Z');
  await cross(townMover, ROAD, 20, 7, 5);
  await townWatcher.p.waitForFunction(() => !!window.__micar.drawnAt('TownMover'), null, { timeout: 30000 });
  at = await drawn(townWatcher, 'TownMover');
  ok(!!at && near(at.x, (ROAD.x + 5) * W) && near(at.z, (ROAD.z + 20) * W), `the town watcher draws the other dealer where it was put (x ${at?.x?.toFixed(1)}, z ${at?.z?.toFixed(1)})`);
  await townWatcher.p.screenshot({ path: OUT + 'diet-town-1280-left.png' });
  await cross(townMover, ROAD, 20, 4, -7);
  at = await drawn(townWatcher, 'TownMover');
  ok(!!at && near(at.x, (ROAD.x - 7) * W) && near(at.z, (ROAD.z + 20) * W), `and follows it across the road (x ${at?.x?.toFixed(1)}, z ${at?.z?.toFixed(1)})`);
  await townWatcher.p.screenshot({ path: OUT + 'diet-town-1280-right.png' });
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
} catch (e) {
  console.error(String(e?.stack || e));
  if (errs.length) console.error(errs.join('\n'));
  code = 1;
} finally {
  for (const g of opened) await g.browser.close();
}
process.exit(code);
