// Smoke test for the lap-race UI (race UI stage 1a), against a running server started as for strip.smoke.mjs.
// A guest rents a car and starts Harbour GP. The test checks the five start lights, then teleports the car along the
// route in short hops: the game is ~3 fps on software GL, far too slow to drive two laps. At 1440x900 it also times a
// lap, pauses (the session card) and resumes. At 844x390 (a phone, landscape) it leaves the race from the pause menu
// and checks free roam is back; at 390x844 (a phone, portrait, in Spanish) it stops after the HUD screenshot.
// Screenshots are written to e2e/out/.
// VIEW=results races both laps in 30 m hops (inside the game's 45 m progress window) to the results table.
//   BASE=http://localhost:3123/ VIEW=desktop|results|phone|portrait pnpm --filter @micar/sim exec node e2e/race.smoke.mjs
// Exits 1 on any failed assertion or page error.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = (process.env.BASE || 'http://localhost:3123/').replace(/\/?$/, '/');
const VIEW = process.env.VIEW || 'desktop';
const OUT = new URL('./out/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const W = 2; // render units per metre (world/units.ts WORLD_PER_M)
const errs = [];
const fail = (m) => { throw new Error(m); };
const ok = (c, m) => { if (!c) fail('ASSERT: ' + m); console.log('ok  ' + m); };
const views = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  results: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  portrait: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

// Harbour GP's route, in metres, as the game builds it (the track file's points plus the track's offset)
const track = await (await fetch(BASE + 'strip/tracks/monaco.json')).json();
const R = track.routes.harbour_gp, off = track.offset;
const pts = R.pts.map(([x, z]) => [x + off[0], z + off[1]]);
if (R.loop) pts.push(pts[0]);
const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
const LAP = cum[cum.length - 1];
const at = (s) => {
  s = ((s % LAP) + LAP) % LAP; let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i], k = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
  return { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, h: Math.atan2(b[0] - a[0], b[1] - a[1]) };
};

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let code = 0;
try {
  const ctx = await browser.newContext(views[VIEW]);
  const g = await ctx.newPage(); g.setDefaultTimeout(60000);
  await g.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('cds.graphics', 'low'); } catch {} });
  g.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(m.text())) errs.push('console.error: ' + m.text()); });
  g.on('pageerror', e => errs.push('pageerror: ' + e.message));
  const G = (fn, arg) => g.evaluate(fn, arg);
  const ev = () => G(() => window.__micar.event());
  const shot = async (name) => { await g.screenshot({ path: OUT + name + '.png', timeout: 120000 }); console.log('shot ' + name); };

  await g.goto(BASE + 'strip', { waitUntil: 'domcontentloaded' });
  await g.fill('input[type=text], input:not([type])', 'RaceBot');
  await g.getByRole('button', { name: /Race as guest/i }).click();
  await g.waitForFunction(() => !!window.__micar, null, { timeout: 120000 });
  await g.waitForFunction(() => window.__micar.money() === 500, null, { timeout: 30000 });
  await g.waitForSelector('[aria-label="Rental counter"]', { timeout: 90000 });
  ok(await G(() => window.__micar.rent('ronin')), 'rented the coupe');
  ok(await g.waitForFunction(() => window.__micar.drive(), null, { timeout: 90000, polling: 1000 }).then(() => true, () => false), 'in the rental');
  if (VIEW === 'portrait') await G(() => { localStorage.setItem('cds_lang', 'es'); window.dispatchEvent(new CustomEvent('micar-langchange')); });

  ok(await G(() => window.__micar.startEvent('harbour_gp')), 'started Harbour GP');
  // a circuit away from the hub is loaded first: the event exists once its file is in
  ok(await g.waitForFunction(() => !!window.__micar.event(), null, { timeout: 120000, polling: 100 }).then(() => true, () => false), 'Harbour GP loaded and on the grid');
  let maxLit = 0, shotLights = false;
  for (let i = 0; i < 600; i++) {
    const e = await ev(); if (!e) fail('the event went away during the count');
    if (e.state === 'race') break;
    maxLit = Math.max(maxLit, e.lit ?? 0);
    if (!shotLights && e.lit >= 3) { shotLights = true; await shot(`lights-${VIEW}`); }
    await g.waitForTimeout(200);
  }
  ok((await ev()).state === 'race', `the lights went out (most seen lit: ${maxLit})`);
  ok(maxLit >= 4, 'the lights came on one by one (4 or 5 seen at the poll rate)');
  ok((await ev()).timed, 'the race is timed');

  const HOP = VIEW === 'results' ? 30 : 15;
  const hop = async (to) => {
    for (let s = (await ev()).pS; s < to; s += HOP) {
      const p = at(s + HOP); await G(([x, z, r]) => window.__micar.place(x, z, r), [p.x * W, p.z * W, p.h + Math.PI]);
      await g.waitForFunction(t => (window.__micar.event()?.pS ?? 1e9) >= t || window.__micar.event()?.state !== 'race', s + 10, { timeout: 15000, polling: 50 }).catch(() => {});
      if ((await ev())?.state !== 'race') return;
    }
  };
  if (VIEW !== 'results') { await hop(LAP * 0.4); await shot(`hud-${VIEW}`); }
  if (VIEW === 'phone') {
    // leaving from the pause menu ends the race and puts the car back in free roam
    await g.keyboard.press('Escape');
    await g.waitForSelector('text=Paused', { timeout: 30000 });
    await g.locator('text=Leave race').click();
    ok(await g.waitForFunction(() => !window.__micar.event(), null, { timeout: 30000, polling: 100 }).then(() => true, () => false), 'leaving the race returns to free roam');
  }
  if (VIEW === 'desktop') {
    await hop(LAP * 1.05);
    ok((await ev()).laps >= 1, 'a lap was timed');
    await g.keyboard.press('Escape');
    await g.waitForSelector('text=Paused', { timeout: 30000 });
    ok(await g.locator('text=Position').count() > 0, 'the pause shows the session card');
    await shot('pause-desktop');
    await g.keyboard.press('Escape');
    await g.waitForFunction(() => !document.body.innerText.includes('Leave race'), null, { timeout: 30000 });
  }
  if (VIEW === 'results') {
    await hop(LAP * 2 + 40);
    await g.waitForSelector('text=Best lap', { timeout: 120000 });
    ok(true, 'the results show the timing table');
    await shot('results-desktop');
    // a guest races in a rental, which goes back when the race ends: Race again is then hidden (it needs a car)
    const rentalBack = await g.locator('text=Rental returned').count() > 0, again = await g.locator('text=Race again').count() > 0;
    ok(rentalBack ? !again : again, rentalBack ? 'a returned rental hides Race again' : 'the results offer Race again');
  }
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log('RACE SMOKE PASSED');
} catch (e) {
  console.error(String(e && e.stack || e)); if (errs.length) console.error(errs.slice(0, 5).join('\n')); code = 1;
} finally { await browser.close(); process.exit(code); }
