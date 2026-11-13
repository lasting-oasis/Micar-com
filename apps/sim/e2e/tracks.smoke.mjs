// Smoke test for the circuits' look (race UI stage 2), against a running server started as for strip.smoke.mjs.
// For each of four lap races, a new guest rents a car and starts it (leaving a race hands the rental back, so one
// guest cannot simply start the next): on the grid while the lights come on (the gantry, grandstand and pits), then
// teleported to two places on the lap. It screenshots each, logs what the frame drew, and leaves the race from the
// pause menu. Budgets: 100 draw calls and 500k triangles a frame on a circuit (the old Monaco scenery
// drew 90).
//   BASE=http://localhost:3123/ VIEW=desktop|phone pnpm --filter @micar/sim exec node e2e/tracks.smoke.mjs
// Exits 1 on any failed assertion or page error.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = (process.env.BASE || 'http://localhost:3123/').replace(/\/?$/, '/');
const VIEW = process.env.VIEW || 'desktop';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const OUT = new URL('./out/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const W = 2; // render units per metre (world/units.ts WORLD_PER_M)
const errs = [];
const fail = (m) => { throw new Error(m); };
const ok = (c, m) => { if (!c) fail('ASSERT: ' + m); console.log('ok  ' + m); };
const views = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const RACES = [['harbour_gp', 'monaco'], ['figure8_gp', 'suzuka'], ['ardennes_gp', 'spa'], ['royal_gp', 'monza']].filter(([e]) => !ONLY || ONLY.includes(e));

async function routeOf(tid, eid) {
  const track = await (await fetch(BASE + 'strip/tracks/' + tid + '.json')).json();
  const R = track.routes[eid], off = track.offset;
  const pts = R.pts.map(([x, z]) => [x + off[0], z + off[1]]); if (R.loop) pts.push(pts[0]);
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const LAP = cum[cum.length - 1];
  const at = (s) => {
    s = ((s % LAP) + LAP) % LAP; let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const a = pts[i - 1], b = pts[i], k = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, h: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  };
  return { LAP, at };
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

/** One lap race with a new guest: the hub (first race only), the grid, two places on the lap; then leave it. */
async function race(eid, tid) {
  const ctx = await browser.newContext(views[VIEW]);
  const g = await ctx.newPage(); g.setDefaultTimeout(60000);
  await g.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('cds.graphics', 'low'); } catch {} });
  g.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(m.text())) errs.push('console.error: ' + m.text()); });
  g.on('pageerror', e => errs.push('pageerror: ' + e.message));
  const G = (fn, arg) => g.evaluate(fn, arg);
  const shot = async (name) => { await g.screenshot({ path: OUT + name + '.png', timeout: 120000 }); console.log('shot ' + name); };
  const settle = (ms) => g.waitForTimeout(ms);

  await g.goto(BASE + 'strip', { waitUntil: 'domcontentloaded' });
  await g.fill('input[type=text], input:not([type])', 'TrackBot' + eid.slice(0, 3));
  await g.getByRole('button', { name: /Race as guest/i }).click();
  await g.waitForFunction(() => !!window.__micar, null, { timeout: 120000 });
  await g.waitForFunction(() => window.__micar.money() === 500, null, { timeout: 30000 });
  await g.waitForSelector('[aria-label="Rental counter"]', { timeout: 90000 });
  ok(await G(() => window.__micar.rent('ronin')), 'rented the coupe');
  ok(await g.waitForFunction(() => window.__micar.drive(), null, { timeout: 90000, polling: 1000 }).then(() => true, () => false), 'in the rental');
  if (eid === RACES[0][0]) { await settle(2500); await shot(`track-hub-${VIEW}`); }   // the hub keeps its sunny look

  const { LAP, at } = await routeOf(tid, eid);
  ok(await G(e => window.__micar.startEvent(e), eid), 'started ' + eid);
  ok(await g.waitForFunction(() => !!window.__micar.event(), null, { timeout: 120000, polling: 100 }).then(() => true, () => false), eid + ' loaded and on the grid');
  await g.waitForFunction(() => (window.__micar.event()?.lit ?? 0) >= 3 || window.__micar.event()?.state === 'race', null, { timeout: 60000, polling: 100 });
  await settle(1500); await shot(`track-${eid}-grid-${VIEW}`);
  await g.waitForFunction(() => window.__micar.event()?.state === 'race', null, { timeout: 120000, polling: 100 });
  for (const f of [0.3, 0.65]) {
    const p = at(LAP * f);
    await G(([x, z, r]) => window.__micar.place(x, z, r), [p.x * W, p.z * W, p.h + Math.PI]);
    await settle(2500);
    const d = await G(() => window.__micar.drawn());
    console.log(`drawn ${eid} @${f}: ${d.calls} calls, ${d.triangles} triangles`);
    ok(d.calls <= 100 && d.triangles <= 500000, `${eid} @${f} inside the frame budget`);
    await shot(`track-${eid}-lap${Math.round(f * 100)}-${VIEW}`);
  }
  await g.keyboard.press('Escape');
  await g.waitForSelector('text=Paused', { timeout: 30000 });
  await g.locator('text=Leave race').click();
  ok(await g.waitForFunction(() => !window.__micar.event(), null, { timeout: 30000, polling: 100 }).then(() => true, () => false), 'left ' + eid);
  await ctx.close();
}

let code = 0;
try {
  for (const [eid, tid] of RACES) await race(eid, tid);
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log('TRACKS SMOKE PASSED');
} catch (e) {
  console.error(String(e && e.stack || e)); if (errs.length) console.error(errs.slice(0, 5).join('\n')); code = 1;
} finally { await browser.close(); process.exit(code); }
