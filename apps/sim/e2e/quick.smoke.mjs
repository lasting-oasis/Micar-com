// Smoke test for a quick race (Part 2, Task 8), against a running server (production build): no link, three browsers.
//   pnpm --filter @micar/sim build && NODE_ENV=production PORT=3123 pnpm --filter @micar/sim start &
//   BASE=http://localhost:3123/ VIEW=desktop SHOT_LANG=en pnpm --filter @micar/sim exec node e2e/quick.smoke.mjs
// The host opens Quick race at the rental counter and picks Harbour: a quick room of the Harbour GP in the Ronin GT, and
// alone in it, no countdown. A third visitor, the camera, opens Quick race, sees "1 waiting" on Harbour (photographed),
// picks it and lands in the same room, whose countdown begins (photographed); it leaves, and the countdown stops. The
// friend picks Harbour: the countdown begins again, and the race starts by itself, nobody pressing Start. Both are on
// the grid of the Harbour GP in the lent car and race; each quits from the pause menu; both see the race on the room's
// Last race with both names, and the room counts down to its next race. With RACE=0 it stops after the photographs.
// VIEW: desktop (1280 x 800) or phone (375 x 812, touch); SHOT_LANG: en or es, for the camera's photographs (it reads and
// clicks in English, and switches only to photograph). Photographs go to SHOTS (default e2e/out/).
// Software GL (swiftshader), so it runs headless with no display; every step waits on the page's own state.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = (process.env.BASE || 'http://localhost:3123/').replace(/\/?$/, '/');
const VIEW = process.env.VIEW === 'phone' ? 'phone' : 'desktop';
const LANG = process.env.SHOT_LANG === 'es' ? 'es' : 'en'; // not LANG: that is the shell's locale
const RACE = process.env.RACE !== '0';
const SHOTS = (process.env.SHOTS || 'e2e/out/').replace(/\/?$/, '/');
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const VIEWS = {
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
// the camera's two screens, in the language photographed (i18n.tsx)
const WORDS = { en: { card: 'Pick a circuit', room: 'Starts in' }, es: { card: 'Elija un circuito', room: 'Empieza en' } };
const errs = [];
const fail = (m) => { throw new Error(m); };
const ok = (c, m) => { if (!c) fail('ASSERT: ' + m); console.log('ok  ' + m); };

/** A browser of its own (fewer pixels for the two who race), its errors collected under `who`. */
async function driver(who, context = { viewport: { width: 480, height: 400 }, deviceScaleFactor: 1 }) {
  const browser = await chromium.launch({ args: ARGS });
  const p = await (await browser.newContext(context)).newPage();
  p.setDefaultTimeout(60000);
  await p.addInitScript(() => { try { if (!sessionStorage.getItem('smoke')) { localStorage.clear(); sessionStorage.setItem('smoke', '1'); } localStorage.setItem('cds.graphics', 'low'); } catch {} });
  p.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(m.text())) errs.push(`${who} console.error: ${m.text()}`); });
  p.on('pageerror', e => errs.push(`${who} pageerror: ${e.message}`));
  return { browser, p, who };
}
const text = (d) => d.p.evaluate(() => document.body.textContent);
const state = (d) => d.p.evaluate(() => ({ pose: window.__micar.pose(), event: window.__micar.event(), race: window.__micar.race(), money: window.__micar.money(), cars: window.__micar.cars().length }));
/** The Strip as a guest, at the rental counter. */
async function enter(d, name) {
  await d.p.goto(BASE + 'strip', { waitUntil: 'domcontentloaded' });
  await d.p.fill('input[type=text]', name);
  await d.p.getByRole('button', { name: /Race as guest/i }).click();
  await d.p.waitForSelector('[aria-label="Rental counter"]', { timeout: 120000 });
}
/** Quick race at the counter, then a circuit: into its quick room. */
async function quickRace(d, track) {
  await d.p.getByRole('button', { name: 'Quick race' }).click();
  await d.p.waitForSelector('[aria-label="Pick a circuit"]');
  await d.p.click(`[data-track="${track}"]`);
  await d.p.waitForSelector('[aria-label="Waiting room"]');
}
/** The page in another language, until `back()`: what the camera photographs. */
const speak = (d, lang) => d.p.evaluate((l) => { localStorage.setItem('cds_lang', l); window.dispatchEvent(new CustomEvent('micar-langchange')); }, lang);
async function photograph(d, name, words) {
  await speak(d, LANG);
  await d.p.waitForFunction((w) => document.body.textContent.includes(w), words);
  await d.p.waitForTimeout(400); // a frame or two of the scene behind the card
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}quick-${name}-${VIEW}-${LANG}.png`;
  await d.p.screenshot({ path });
  console.log(`shot ${path}`);
  await speak(d, 'en');
}
const countdown = (d) => d.p.evaluate(() => document.querySelector('[role="timer"]')?.textContent ?? null);
const quit = async (d) => { await d.p.keyboard.press('Escape'); await d.p.getByRole('button', { name: /Leave race/i }).click(); };

let code = 0;
const host = await driver('host'), cam = await driver(`camera (${VIEW}, ${LANG})`, VIEWS[VIEW]);
let friend = null;
try {
  // 1. the host opens Harbour's quick room: the Harbour GP in the Ronin GT, and alone in it, nothing counts down
  await enter(host, 'Ana');
  await quickRace(host, 'monaco');
  let t = await text(host);
  ok(/Circuit: Harbour GP/.test(t) && /Ronin GT/.test(t), 'the host is in a quick room of the Harbour GP in the Ronin GT');
  ok(/Anyone racing here joins this room/.test(t), 'the waiting room says that anyone racing here joins it');
  ok(await countdown(host) === null && !/Change the race/i.test(t), 'alone in it: no countdown, and no way to change its race');

  // 2. the camera: Quick race lists the ten circuits, every one open, Harbour with one waiting; photographed
  await enter(cam, 'Cam');
  await cam.p.getByRole('button', { name: 'Quick race' }).click();
  await cam.p.waitForSelector('[aria-label="Pick a circuit"]');
  await cam.p.waitForFunction(() => /1 waiting/.test(document.querySelector('[data-track="monaco"]')?.textContent ?? ''), null, { timeout: 20000 });
  const order = await cam.p.evaluate(() => [...document.querySelectorAll('[data-track]')].map(b => b.getAttribute('data-track') + (b.disabled ? ':locked' : '')));
  ok(order.join() === 'spa,monza,silverstone,suzuka,nurburgring,monaco,interlagos,cota,laguna,bathurst',
    `ten circuits in the Races menu's order, every one open to a guest at stage 1 (${order.join(' ')})`);
  ok(!/Stage/.test(await cam.p.evaluate(() => document.querySelector('[aria-label="Pick a circuit"]')?.textContent ?? '')), 'no stage lock anywhere on the card');
  await photograph(cam, 'card', WORDS[LANG].card);

  // 3. the camera picks Harbour: the same room, and its countdown begins; photographed; it leaves and the count stops
  await cam.p.click('[data-track="monaco"]');
  await cam.p.waitForSelector('[aria-label="Waiting room"]');
  await cam.p.waitForFunction(() => !!document.querySelector('[role="timer"]'));
  const room = await cam.p.evaluate(() => window.__micar.race());
  ok(room?.members === 2 && room.code === (await host.p.evaluate(() => window.__micar.race()?.code)), 'the camera landed in the host\'s room, by picking the same circuit');
  const cs = await countdown(cam);
  ok(/^Starts in (\d+) s$/.test(cs) && +cs.match(/\d+/)[0] <= 30 && +cs.match(/\d+/)[0] >= 20, `the second to arrive starts the countdown: "${cs}"`);
  await host.p.waitForFunction(() => !!document.querySelector('[role="timer"]'));
  ok(!(await host.p.getByRole('button', { name: 'Change the race' }).count()) && await host.p.getByRole('button', { name: 'Start race' }).isEnabled(),
    'the host, its first member, may start it early, but not change it');
  await photograph(cam, 'room', WORDS[LANG].room);
  await cam.p.getByRole('button', { name: 'Leave', exact: true }).click();
  await cam.p.waitForSelector('[aria-label="Rental counter"]');
  await host.p.waitForFunction(() => window.__micar.race()?.members === 1 && !document.querySelector('[role="timer"]'));
  ok(true, 'the camera left: the host is alone again, and the countdown stopped');
  await cam.browser.close();

  if (RACE) {
    // 4. the friend picks Harbour: the countdown begins again, and the race starts by itself
    friend = await driver('friend');
    await enter(friend, 'Ben');
    await quickRace(friend, 'monaco');
    await host.p.waitForFunction(() => !!document.querySelector('[role="timer"]'));
    ok(true, 'the friend arrived: the countdown began again');
    for (const d of [host, friend]) {
      await d.p.waitForFunction(() => window.__micar.pose().driving === true && window.__micar.event()?.id === 'harbour_gp', null, { timeout: 180000 });
      ok(true, `${d.who}: on the grid of the Harbour GP, nobody having pressed Start`);
    }
    for (const d of [host, friend]) {
      await d.p.waitForFunction(() => window.__micar.event()?.state === 'race', null, { timeout: 180000 });
      const s = await state(d);
      ok(s.cars === 1 && s.money === 500 && s.race?.phase === 'racing' && s.race.me === 'racing', `${d.who}: racing in a lent car that cost nothing ($${s.money})`);
    }
    // a few seconds of racing, then out by the pause menu: the friend first, then the host, the last one out
    const from = await Promise.all([host, friend].map(async d => (await state(d)).event.pS));
    await Promise.all([host, friend].map(async d => { await d.p.keyboard.down('KeyW'); await d.p.waitForTimeout(4000); await d.p.keyboard.up('KeyW'); }));
    for (const [i, d] of [host, friend].entries()) { const to = (await state(d)).event.pS; ok(to > from[i] + 1, `${d.who}: drove down the circuit (${from[i].toFixed(1)} m to ${to.toFixed(1)} m)`); }
    await quit(friend);
    await friend.p.waitForSelector('[aria-label="Waiting room"]', { timeout: 60000 });
    await quit(host);
    await host.p.waitForFunction(() => document.body.textContent.includes('Continue [Enter]'), null, { timeout: 60000 });
    ok(/Did not finish/i.test(await text(host)), 'the host quit last: the card says how the race ended');
    await host.p.keyboard.press('Enter');
    await host.p.waitForSelector('[aria-label="Waiting room"]', { timeout: 60000 });
    // 5. the room carries on: both on its Last race, nothing won or lost, and it counts down to the next race
    for (const d of [host, friend]) {
      await d.p.waitForFunction(() => window.__micar.race()?.phase === 'open' && window.__micar.cars().length === 0);
      t = await text(d);
      ok(/Last race/.test(t) && /Ana/.test(t) && /Ben/.test(t), `${d.who}: the room's Last race lists both drivers`);
      ok((await state(d)).money === 500, `${d.who}: nothing won or lost`);
      await d.p.waitForFunction(() => !!document.querySelector('[role="timer"]'));
      ok(true, `${d.who}: the room counts down to its next race`);
    }
    await friend.p.getByRole('button', { name: 'Leave', exact: true }).click();
    await friend.p.waitForSelector('[aria-label="Rental counter"]');
    await host.p.waitForFunction(() => window.__micar.race()?.members === 1 && !document.querySelector('[role="timer"]'));
    ok(true, 'the friend left: the host is alone, and the countdown stopped');
  }

  ok(errs.length === 0, 'no page errors');
  console.log(`QUICK SMOKE PASSED (${VIEW}, ${LANG}${RACE ? '' : ', photographs only'})`);
} catch (e) {
  code = 1;
  console.error('FAIL:', e.message);
  for (const d of [host, friend].filter(Boolean)) {
    try { console.error(`${d.who} state:`, JSON.stringify(await state(d))); console.error(`${d.who} page: `, (await text(d)).slice(0, 400)); } catch { /* gone */ }
  }
  if (errs.length) console.error(errs.join('\n'));
  console.error('QUICK SMOKE FAILED');
} finally {
  for (const d of [host, cam, friend].filter(Boolean)) await d.browser.close().catch(() => {});
}
process.exit(code);
