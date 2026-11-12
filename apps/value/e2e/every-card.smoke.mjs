// Smoke test: every card on the site turns over to the card back. Against the built value app, in a real browser.
//   pnpm --filter @micar/value build && pnpm --filter @micar/value smoke:cards
// The home page: the bay's showcase (corner button; its tap still opens the inspect view), the small card in the
// statement, the big card, the small card in the grade section. The Garage: an example card, a parked car's tile
// (corner button; its tap still opens the car) and the car's own card. Not wired into ci.yml; run it by hand.
// Screenshots go to apps/value/e2e/out/. Exits 1 on any failed check or page error.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(HERE, '..', 'dist');
const OUT = join(HERE, 'out');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };
const errors = [];
const ok = (condition, message) => { if (!condition) throw new Error('ASSERT: ' + message); console.log('ok  ' + message); };

function serve() {
  statSync(join(DIST, 'index.html'));
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    const file = join(DIST, path === '' ? 'index.html' : path);
    try { response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file)); } catch { response.writeHead(404).end(); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}

/** True when the card is turned and its back's picture has loaded at a size worth looking at. */
const turned = (card) => card.evaluate(async (el) => {
  await new Promise((done) => setTimeout(done, 1000));                     // the turn takes under a second
  const img = el.querySelector('.sl-face.back .cb-card img');
  if (!el.classList.contains('flipped') || !img) return false;
  if (!img.complete) await img.decode().catch(() => {});
  return img.naturalWidth > 0 && img.getBoundingClientRect().width > 40;
});

async function turns(page, card, name, by) {
  await card.scrollIntoViewIfNeeded();
  ok(!(await card.evaluate((el) => el.classList.contains('flipped'))), `${name} starts on its front`);
  const front = await card.screenshot();
  await by();
  ok(await turned(card), `${name} turns over to the card back`);
  const back = await card.screenshot({ path: join(OUT, `every-${name.replace(/[^a-z]+/gi, '-')}.png`) });
  ok(!front.equals(back), `${name} shows a different face once turned`);
  await by();
  await page.waitForTimeout(900);
  ok(!(await card.evaluate((el) => el.classList.contains('flipped'))), `${name} turns back`);
}

mkdirSync(OUT, { recursive: true });
const site = process.env.BASE ? { base: process.env.BASE, close() {} } : await serve();
const browser = await chromium.launch({ args: ['--no-sandbox'] }).catch(() => chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] }));
let failed = false;
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport, hasTouch: label === 'phone' });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(site.base + '?lang=en', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Open the door' }).click();      // the form's own example car
    await page.locator('.showcase .slab').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);                                        // the door rolls up and the card lands

    const hero = page.locator('.showcase .slab');
    if (await hero.count() && await hero.isVisible()) {
      const cue = hero.locator('button.flip-cue');
      await turns(page, hero, `${label} showcase card`, () => cue.click());
      ok(await page.locator('.ins-slab').count() === 0, `${label}: turning the showcase card did not open the inspect view`);
    } else console.log(`--  ${label}: no showcase card on screen`);

    await turns(page, page.locator('.statement .slab'), `${label} statement card`, () => page.locator('.statement .slab').click());
    await turns(page, page.locator('.cardsec .slab'), `${label} big card`, () => page.locator('.cardsec .slab').click());
    await turns(page, page.locator('.sim-slab'), `${label} grade card`, () => page.locator('.sim-slab').click());
    const all = await page.locator('.slab').count();
    const cued = await page.locator('.slab:has(.flip-cue)').count();
    ok(all > 0 && all === cued, `${label}: all ${all} cards on the home page carry the turn mark`);

    await page.goto(site.base + '?lang=en#/garage', { waitUntil: 'networkidle' });
    const example = page.locator('.gar-card').first();
    await turns(page, example, `${label} example card`, () => example.click());
    await page.getByRole('button', { name: 'Park a car' }).click();
    await page.getByRole('button', { name: 'Park it' }).click();
    await page.waitForFunction(() => /^#\/garage\/MC-/.test(location.hash));
    const own = page.locator('.gar-card.live').first();
    await turns(page, own, `${label} car page card`, () => own.click());
    await page.goto(site.base + '?lang=en#/garage', { waitUntil: 'networkidle' });
    const tile = page.locator('.gar-turn').first();
    await turns(page, tile.locator('.gar-card'), `${label} garage tile`, () => tile.locator('button.flip-cue').click());
    ok(/#\/garage$/.test(page.url()), `${label}: turning the tile did not open the car`);
    const cards = await page.locator('.slab').count();
    const marked = await page.locator('.slab:has(.flip-cue), .gar-turn:has(> button.flip-cue) .slab').count();
    ok(cards > 0 && cards === marked, `${label}: all ${cards} cards in the Garage can be turned`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: nothing hangs off the side`);
    await page.close();
  }
  ok(errors.length === 0, 'no page reported an error' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { failed = true; console.error(String(e.message ?? e)); }
await browser.close(); site.close();
process.exit(failed ? 1 : 0);
