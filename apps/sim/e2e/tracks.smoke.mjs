// Smoke test for the circuits' look (race UI stage 2) and the Races menu (1b), against a running server started as
// for strip.smoke.mjs. For each lap race, a new guest rents a car and starts it (leaving a race hands the rental back,
// so one guest cannot simply start the next) through the Races menu: T on a desktop, the Race button on a phone; the
// circuit (arrows, or a tap), then the event. An event the new guest's stage has not reached shows locked and Start
// does nothing; that race starts through the smoke's hook instead. Then on the grid while the lights come on (the
// gantry, grandstand and pits), and teleported to two places on the lap. It screenshots each (the menu's two steps on
// the first race, a portrait phone too), logs what the frame drew, and leaves the race from the pause menu. Budgets:
// 100 draw calls and 500k triangles a frame on a circuit (the old Monaco scenery drew 90).
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
const RACES = [['harbour_gp', 'monaco'], ['figure8_gp', 'suzuka'], ['ardennes_gp', 'spa'], ['royal_gp', 'monza'], ['lagoons_sprint', 'interlagos'], ['drylagoon_x', 'laguna']].filter(([e]) => !ONLY || ONLY.includes(e));

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
  await viaMenu(g, eid, tid, eid === RACES[0][0], { G, shot, settle });
  ok(await g.waitForFunction(() => !!window.__micar.event(), null, { timeout: 120000, polling: 100 }).then(() => true, () => false), eid + ' loaded and on the grid');
  await g.waitForFunction(() => (window.__micar.event()?.lit ?? 0) >= 3 || window.__micar.event()?.state === 'race', null, { timeout: 60000, polling: 100 });
  // the circuit's model is drawn, textured: its scenery meshes are in and the asphalt has its picture
  const model = await g.waitForFunction(() => { const c = window.__micar.circuit(); return c && c.asphaltMap ? c : null; }, null, { timeout: 60000, polling: 250 })
    .then(h => h.jsonValue(), () => null);
  console.log(`model ${eid}: ${JSON.stringify(model)}`);
  ok(!!model && model.id === tid && model.meshes >= 12 && model.asphaltMap, `${tid} model drawn with its textures`);
  await settle(1500); await shot(`track-${eid}-grid-${VIEW}`);
  await g.waitForFunction(() => window.__micar.event()?.state === 'race', null, { timeout: 120000, polling: 100 });
  // the menu never opens during a live race (T on a desktop; on a phone its button is hidden)
  if (VIEW === 'phone') ok(!(await g.locator('button[aria-label="Races"]').isVisible()), 'no Race button during a race');
  else { await g.keyboard.press('t'); await settle(600); ok(!(await g.locator('[data-races]').count()), 'T does not open the menu during a race'); }
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
  if (VIEW !== 'phone') { await g.keyboard.press('t'); await settle(400); ok(!(await g.locator('[data-races]').count()), 'T does not open the menu over the pause menu'); }
  await g.locator('text=Leave race').click();
  ok(await g.waitForFunction(() => !window.__micar.event(), null, { timeout: 30000, polling: 100 }).then(() => true, () => false), 'left ' + eid);
  await ctx.close();
}

/**
 * Start a race through the Races menu: T on a desktop, the Race button on a phone; the circuit (the arrows, or a tap,
 * then Continue), then the event (the arrows, or a tap, then Start). `shots`: screenshot both steps (and, on a phone,
 * the circuit step in portrait). A desktop also checks the menu keeps its keys from the game: W held while it is open
 * does not drive the car once T has closed it. An event the guest's stage has not reached shows locked: Start does
 * nothing, the menu is closed and the race starts through the smoke's hook (the circuit's look is still checked).
 */
async function viaMenu(g, eid, tid, shots, { G, shot, settle }) {
  const phone = VIEW === 'phone', pressed = (k, id) => g.locator(`[data-${k}="${id}"][aria-pressed="true"]`).count();
  const open = async () => {
    if (phone) await g.locator('button[aria-label="Races"]').tap(); else await g.keyboard.press('t');
    await g.waitForSelector('[data-races="circuit"]', { timeout: 15000 });
    await g.waitForSelector('[data-races] [data-track-map]', { timeout: 30000 });       // the maps came in
  };
  await open();
  ok(true, 'the Races menu opened (' + (phone ? 'the Race button' : 'T') + ')');
  if (!phone) {
    const before = await G(() => window.__micar.pose());
    await g.keyboard.down('w'); await settle(300); await g.keyboard.press('t');
    await g.waitForSelector('[data-races]', { state: 'detached', timeout: 20000 });
    await settle(1200);
    const after = await G(() => window.__micar.pose());
    await g.keyboard.up('w');
    ok(Math.abs(after.speed) < 0.5 && Math.hypot(after.x - before.x, after.z - before.z) < 1, `W pressed in the menu did not reach the game (speed ${after.speed.toFixed(2)})`);
    await open();
  }
  if (phone) { if (!(await pressed('circuit', tid))) await g.locator(`[data-circuit="${tid}"]`).tap(); }   // a tap on the chosen card opens its events
  else for (let i = 0; i < 10 && !(await pressed('circuit', tid)); i++) await g.keyboard.press('ArrowRight');
  ok(await pressed('circuit', tid) === 1, tid + ' chosen in the menu');
  const name = await g.locator('[data-races-name]').innerText();
  ok(name.trim().length > 2, 'the circuit name shows: ' + name.trim());
  if (shots) {
    await settle(500); await shot(`races-circuit-${VIEW}`);
    if (phone) {
      const vp = g.viewportSize();
      await g.setViewportSize({ width: 390, height: 844 }); await settle(900); await shot('races-circuit-portrait');
      await g.setViewportSize({ width: 667, height: 375 }); await settle(900); await shot('races-circuit-667');
      await g.setViewportSize(vp); await settle(900);
    }
  }
  if (phone) await g.locator('[data-races-go]').tap(); else await g.keyboard.press('Enter');
  await g.waitForSelector('[data-races="event"]', { timeout: 20000 });
  if (phone) { if (!(await pressed('event', eid))) await g.locator(`[data-event="${eid}"]`).tap(); }
  else for (let i = 0; i < 6 && !(await pressed('event', eid)); i++) await g.keyboard.press('ArrowRight');
  ok(await pressed('event', eid) === 1, eid + ' chosen in the menu');
  const locked = /stage|etapa/i.test(await g.locator('[data-races-go]').innerText());   // innerText is in the button's capitals
  if (shots || locked) { await settle(400); await shot(locked ? `races-locked-${eid}-${VIEW}` : `races-event-${VIEW}`); }
  if (phone) await g.locator('[data-races-go]').tap(); else await g.keyboard.press('Enter');
  if (locked) {
    await g.waitForSelector('[data-races] [role=status]', { timeout: 20000 });
    await settle(1500);
    ok(!(await G(() => window.__micar.event())) && (await g.locator('[data-races]').count()) === 1, eid + ' is locked for a new guest: Start does nothing');
    if (phone) await g.locator('[data-races] [aria-label="Close"]').tap(); else { await g.keyboard.press('Escape'); await g.keyboard.press('Escape'); }
    await g.waitForSelector('[data-races]', { state: 'detached', timeout: 20000 });
    ok(await G(e => window.__micar.startEvent(e), eid), 'started ' + eid + ' (the hook)');
  } else {
    await g.waitForSelector('[data-races]', { state: 'detached', timeout: 20000 });
    ok(true, 'started ' + eid + ' from the menu');
  }
}

let code = 0;
try {
  for (const [eid, tid] of RACES) await race(eid, tid);
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log('TRACKS SMOKE PASSED');
} catch (e) {
  console.error(String(e && e.stack || e)); if (errs.length) console.error(errs.slice(0, 5).join('\n')); code = 1;
} finally { await browser.close(); process.exit(code); }
