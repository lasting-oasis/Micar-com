// Smoke test for a challenge race, against a running server (production build): two browsers and one link.
//   pnpm --filter @micar/sim build && NODE_ENV=production PORT=3123 pnpm --filter @micar/sim start &
//   BASE=http://localhost:3123/ pnpm --filter @micar/sim exec node e2e/challenge.smoke.mjs
// The host makes a drag challenge at the rental counter and reads its link. The friend opens the link, sees who is
// challenging and to what, and joins. The host starts; both drive the quarter mile in the lent car; both results cards
// list both drivers; both are back in the waiting room with their $500 and no car, and the host can start again.
// Two browsers, not two tabs of one: a tab in the background is throttled, and the race is timed on the wall clock.
// Exits 1 on a failed assertion or a page error. Software GL (swiftshader), so it runs headless with no display; the
// game is slow there, so every step waits on the page's own state, never on a clock.
import { chromium } from 'playwright';

const BASE = (process.env.BASE || 'http://localhost:3123/').replace(/\/?$/, '/');
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const errs = [];
const fail = (m) => { throw new Error(m); };
const ok = (c, m) => { if (!c) fail('ASSERT: ' + m); console.log('ok  ' + m); };

/** A browser of its own with one small page (fewer pixels, faster frames), its errors collected under `who`. */
async function driver(who) {
  const browser = await chromium.launch({ args: ARGS });
  const p = await browser.newPage({ viewport: { width: 480, height: 400 }, deviceScaleFactor: 1 });
  p.setDefaultTimeout(60000);
  await p.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('cds.graphics', 'low'); } catch {} });
  p.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(m.text())) errs.push(`${who} console.error: ${m.text()}`); });
  p.on('pageerror', e => errs.push(`${who} pageerror: ${e.message}`));
  return { browser, p, who };
}
// what the page shows, as it is written (innerText would give it as styled: the cards' headings are upper-cased by CSS)
const text = (d) => d.p.evaluate(() => document.body.textContent);
const state = (d) => d.p.evaluate(() => ({ pose: window.__micar.pose(), event: window.__micar.event(), race: window.__micar.race(), money: window.__micar.money(), cars: window.__micar.cars().length }));

/** Hold the throttle and shift at the redline (a drag is always manual) until the results card is up. */
async function driveTheQuarter(d) {
  await d.p.keyboard.down('KeyW');
  const t0 = Date.now(); let card = false;
  while (!card && Date.now() - t0 < 420000) {
    await d.p.waitForTimeout(150);
    const q = await d.p.evaluate(() => window.__micar.pose());
    if (q.gear >= 1 && q.rpm > q.redline * 0.8) { await d.p.keyboard.down('ShiftLeft'); await d.p.waitForTimeout(500); await d.p.keyboard.up('ShiftLeft'); }
    card = await d.p.evaluate(() => /Waiting for the others|Continue \[Enter\]/.test(document.body.textContent));
  }
  await d.p.keyboard.up('KeyW');
  return { card, seconds: Math.round((Date.now() - t0) / 1000) };
}

let code = 0;
const host = await driver('host'), friend = await driver('friend');
try {
  // 1. the host: the Strip as a guest, then a challenge at the rental counter
  await host.p.goto(BASE + 'strip', { waitUntil: 'domcontentloaded' });
  await host.p.fill('input[type=text]', 'HostBot');
  await host.p.getByRole('button', { name: /Race as guest/i }).click();
  await host.p.waitForSelector('[aria-label="Rental counter"]', { timeout: 120000 });
  await host.p.getByRole('button', { name: 'Challenge a friend' }).click();
  await host.p.getByRole('button', { name: /Drag: Royal Park Quarter/ }).click();
  await host.p.getByRole('button', { name: 'Get the link' }).click();
  await host.p.waitForSelector('[aria-label="Waiting room"]');
  const link = await host.p.locator('input[aria-label="Send this link"]').inputValue();
  ok(/\/strip\?race=[A-Z2-9]{6}$/.test(link), `the host has a link to send (${link})`);
  ok(new URL(host.p.url()).searchParams.get('race') === new URL(link).searchParams.get('race'), "the host's own address carries the room: a reload comes back to it");

  // 2. the friend opens the link: the invitation, then the same waiting room
  await friend.p.goto(link, { waitUntil: 'domcontentloaded' });
  await friend.p.waitForSelector('text=challenged you');
  const invite = await text(friend);
  ok(/HostBot challenged you/i.test(invite) && /Drag: Royal Park Quarter/.test(invite) && /Ronin GT/.test(invite), 'the link opens on the invitation: who, which race, which car');
  await friend.p.fill('input[type=text]', 'FriendBot');
  await friend.p.getByRole('button', { name: 'Join the race' }).click();
  await friend.p.waitForSelector('[aria-label="Waiting room"]', { timeout: 120000 });
  ok(/Waiting for HostBot to start/.test(await text(friend)), 'the friend is in the waiting room, waiting for the host');

  // 3. the host sees the friend and starts
  await host.p.waitForSelector('[aria-label="Waiting room"] >> text=FriendBot');
  ok(true, 'the host sees the friend arrive');
  await host.p.getByRole('button', { name: 'Start race' }).click();

  // 4. both are put on the grid in the lent car, and the one green light sends both off
  for (const d of [host, friend]) {
    await d.p.waitForFunction(() => window.__micar.pose().driving === true && window.__micar.event()?.id === 'royal_drag', null, { timeout: 180000 });
    ok(true, `${d.who}: on the grid of the quarter mile, in a car`);
  }
  for (const d of [host, friend]) {
    await d.p.waitForFunction(() => window.__micar.event()?.state === 'race', null, { timeout: 180000 });
    const s = await state(d);
    ok(s.cars === 1 && s.money === 500, `${d.who}: racing in a lent car that cost nothing (1 car, $${s.money})`);
    ok(s.race?.phase === 'racing' && s.race.me === 'racing', `${d.who}: the room says it is racing`);
  }
  const runs = await Promise.all([host, friend].map(driveTheQuarter));
  for (const [i, d] of [host, friend].entries()) ok(runs[i].card, `${d.who}: a results card came up (${runs[i].seconds} s wall clock)`);

  // 5. the race closes: both cards list both drivers, with a time each; then back to the waiting room, nothing won or lost
  for (const d of [host, friend]) {
    await d.p.waitForFunction(() => document.body.textContent.includes('Continue [Enter]'), null, { timeout: 180000 });
    const card = await d.p.evaluate(() => document.body.innerText); // line by line, so a time is not run into a name
    ok(/HostBot/.test(card) && /FriendBot/.test(card), `${d.who}: the card lists both drivers`);
    ok((card.match(/\b\d+(?::\d\d)?\.\d\d\b/g) ?? []).length >= 2, `${d.who}: both have a time`);
    ok(/you won|place 2 of 2/i.test(card), `${d.who}: the card says where this driver finished`);
  }
  const titles = await Promise.all([host, friend].map(async d => (/You won/.test(await text(d)) ? 'won' : 'second')));
  ok(titles.filter(x => x === 'won').length === 1, `one of the two won (${titles.join(', ')})`);
  for (const d of [host, friend]) {
    await d.p.keyboard.press('Enter');
    await d.p.waitForSelector('[aria-label="Waiting room"]', { timeout: 60000 });
    const s = await state(d);
    ok(/Last race/.test(await text(d)), `${d.who}: back in the waiting room, the last race on it`);
    ok(s.money === 500 && s.cars === 0, `${d.who}: nothing won or lost ($${s.money}, ${s.cars} cars)`);
    ok(s.race?.phase === 'open' && s.pose.driving === false, `${d.who}: the room is open again`);
  }
  ok(await host.p.getByRole('button', { name: 'Start race' }).isEnabled(), 'the host can start the next one');

  // 6. the friend leaves: back at the counter, and the address forgets the room
  await friend.p.getByRole('button', { name: 'Leave' }).click();
  await friend.p.waitForSelector('[aria-label="Rental counter"]');
  ok(!new URL(friend.p.url()).searchParams.has('race'), "the friend left: the room is out of the address");
  await host.p.waitForFunction(() => window.__micar.race()?.members === 1);
  ok(true, 'the host sees the friend go');

  ok(errs.length === 0, 'no page errors');
} catch (e) {
  code = 1; console.error('FAIL: ' + e.message);
  for (const d of [host, friend]) { try { console.error(`${d.who} state: ${JSON.stringify(await state(d))}`); console.error(`${d.who} page: ${(await text(d)).replace(/\s+/g, ' ').slice(0, 300)}`); } catch { /* the page is gone */ } }
} finally {
  if (errs.length) { code = 1; console.error('PAGE ERRORS:\n' + errs.join('\n')); }
  await host.browser.close(); await friend.browser.close();
}
console.log(code ? 'CHALLENGE SMOKE FAILED' : 'CHALLENGE SMOKE PASSED');
process.exit(code);
