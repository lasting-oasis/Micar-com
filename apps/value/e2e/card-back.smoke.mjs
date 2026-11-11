// Smoke test for the card back, in a real browser, against the built value app.
//   pnpm --filter @micar/value build && pnpm --filter @micar/value smoke:card
// It serves apps/value/dist itself (or uses BASE=http://... if given), opens #/garage/card-backs and checks what
// vitest cannot: that the shaders compile and draw, that the artwork is the right way up and its colours untouched,
// that tilting changes the picture and stopping stops the drawing, that closing the view hands the WebGL context
// back, and that a still stands in where the card cannot be drawn. Then it parks a car and opens that car's back.
//
// Software GL (swiftshader), so it runs headless with no display. That says nothing about speed, and nothing
// about iOS Safari: those are tried on a real phone. Not wired into ci.yml; run it by hand before a pull request.
// Screenshots go to apps/value/e2e/out/ (ignored by git). Exits 1 on any failed check or page error.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(HERE, '..', 'dist');
const OUT = join(HERE, 'out');
const FOILS = ['gloss', 'holo', 'rainbow', 'prismatic'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };

const fail = (message) => { throw new Error(message); };
const ok = (condition, message) => { if (!condition) fail('ASSERT: ' + message); console.log('ok  ' + message); };
const errors = [];
/** What a page may say on its console without it counting against the run. A step that provokes a warning names it here first. */
const expected = [];

// ---- the built site, served from here ----
function serve() {
  try { statSync(join(DIST, 'index.html')); } catch { fail(`no build at ${DIST}: run "pnpm --filter @micar/value build" first`); }
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    const file = join(DIST, path === '' ? 'index.html' : path);
    try {
      if (!file.startsWith(DIST)) throw new Error('outside');
      const body = readFileSync(file);
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}

// ---- looking at the picture ----
// A screenshot of an element, shrunk in the page to a small grid of colours (no image library needed here).
// crop is [left, top, width, height] as fractions of the element; the result is `across` wide.
async function look(page, locator, crop = [0, 0, 1, 1], across = 48, name = null) {
  const png = await locator.screenshot();
  if (name) writeFileSync(join(OUT, name + '.png'), png);
  return page.evaluate(async ({ data, crop, across }) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const [left, top, width, height] = [crop[0] * image.width, crop[1] * image.height, crop[2] * image.width, crop[3] * image.height];
    const down = Math.max(1, Math.round((across * height) / width));
    const canvas = document.createElement('canvas');
    canvas.width = across; canvas.height = down;
    const pen = canvas.getContext('2d');
    pen.imageSmoothingQuality = 'high';
    pen.drawImage(image, left, top, width, height, 0, 0, across, down);
    return { across, down, rgba: Array.from(pen.getImageData(0, 0, across, down).data) };
  }, { data: png.toString('base64'), crop, across });
}
/** The middle `share` of the master artwork (the WebP the site ships), shrunk the same way. */
function artwork(page, across, down, share) {
  return page.evaluate(async ({ across, down, share }) => {
    const image = new Image();
    image.src = 'cards/back.webp';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = across; canvas.height = down;
    const pen = canvas.getContext('2d');
    pen.imageSmoothingQuality = 'high';
    const edge = (1 - share) / 2;
    pen.drawImage(image, image.width * edge, image.height * edge, image.width * share, image.height * share, 0, 0, across, down);
    return { across, down, rgba: Array.from(pen.getImageData(0, 0, across, down).data) };
  }, { across, down, share });
}
/** The middle `share` of a box given as fractions: clear of the card's rim, its bevel and its rounded corners. */
const middle = ([left, top, width, height], share) => [left + (width * (1 - share)) / 2, top + (height * (1 - share)) / 2, width * share, height * share];
const luma = (grid) => { const out = []; for (let i = 0; i < grid.rgba.length; i += 4) out.push(0.2126 * grid.rgba[i] + 0.7152 * grid.rgba[i + 1] + 0.0722 * grid.rgba[i + 2]); return out; };
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
const spread = (grid) => { const l = luma(grid), m = mean(l); return Math.sqrt(mean(l.map((v) => (v - m) ** 2))); };
/** Mean difference between two grids, in levels of 255, over red, green and blue. */
function differ(a, b) {
  if (a.rgba.length !== b.rgba.length) return 255;
  let sum = 0, n = 0;
  for (let i = 0; i < a.rgba.length; i += 4) for (let c = 0; c < 3; c++) { sum += Math.abs(a.rgba[i + c] - b.rgba[i + c]); n += 1; }
  return sum / n;
}
function correlation(a, b) {
  const x = luma(a), y = luma(b), mx = mean(x), my = mean(y);
  let top = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) { top += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
  return top / Math.sqrt(dx * dy);
}
const flipped = (grid, how) => {
  const rgba = new Array(grid.rgba.length);
  for (let row = 0; row < grid.down; row++) for (let col = 0; col < grid.across; col++) {
    const from = ((how === 'upside down' ? grid.down - 1 - row : row) * grid.across + (how === 'mirrored' ? grid.across - 1 - col : col)) * 4;
    for (let c = 0; c < 4; c++) rgba[(row * grid.across + col) * 4 + c] = grid.rgba[from + c];
  }
  return { ...grid, rgba };
};
const colour = (grid) => [0, 1, 2].map((c) => { let sum = 0; for (let i = c; i < grid.rgba.length; i += 4) sum += grid.rgba[i]; return sum / (grid.rgba.length / 4); });

/** Where the card lies on its stage when flat, as fractions of the stage: the renderer's own framing rule. */
function cardOn(stage) {
  const shape = 63 / 87.86, aspect = stage.width / stage.height;
  const tall = Math.min(0.72, (0.84 * aspect) / shape), wide = (tall * shape) / aspect;
  return [(1 - wide) / 2, (1 - tall) / 2, wide, tall];
}

// ---- the page ----
const frames = (page) => page.evaluate(() => window.__frames);
/** Waits until the page has asked for no frame for `quiet` milliseconds. Says how many it asked for meanwhile. */
async function rest(page, quiet = 500, limit = 30000) {
  const start = await frames(page), began = Date.now();
  let last = start, since = Date.now();
  while (Date.now() - since < quiet) {
    if (Date.now() - began > limit) fail(`the page was still asking for frames after ${limit} ms`);
    await page.waitForTimeout(100);
    const now = await frames(page);
    if (now !== last) { last = now; since = Date.now(); }
  }
  return last - start;
}
const tile = (page, foil) => page.locator('.gar-backtile').nth(FOILS.indexOf(foil));
async function open(page, foil) {
  await tile(page, foil).click();
  await page.waitForSelector('dialog.gar-cardback[open] .gar-holo canvas');
  await rest(page);
}
async function close(page) {
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog.gar-cardback', { state: 'detached' });
}
const stage = (page) => page.locator('dialog.gar-cardback .gar-holo');
const contexts = (page) => page.evaluate(() => ({ made: window.__contexts.length, live: window.__contexts.filter((gl) => !gl.isContextLost()).length }));

/** Counts the frames the page asks for and remembers every WebGL context it makes. Runs before the site's own code. */
function instrument() {
  window.__frames = 0;
  window.__contexts = [];
  const request = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => { window.__frames += 1; return request(callback); };
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    if (window.__noWebGL && /^webgl/.test(kind)) return null;
    const context = getContext.call(this, kind, ...rest);
    if (context && /^webgl/.test(kind) && !window.__contexts.includes(context)) window.__contexts.push(context);
    return context;
  };
}

async function newPage(browser, options = {}, before = null) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, ...options });
  page.setDefaultTimeout(30000);
  page.on('console', (message) => {
    const text = message.text();
    if (/GPU stall due to ReadPixels/.test(text)) return;                                  // the screenshots themselves, under software GL
    if (expected.some((pattern) => pattern.test(text))) return;
    if (message.type() === 'error' || /WebGL|context/i.test(text)) errors.push(`console.${message.type()}: ${text}`);
  });
  page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
  if (before) await page.addInitScript(before);
  await page.addInitScript(instrument);
  return page;
}

async function launch() {
  const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  // Playwright's own Chromium where it is installed (CI); the machine's Chrome where it is not.
  try { return await chromium.launch({ args }); } catch { return await chromium.launch({ channel: 'chrome', args }); }
}

mkdirSync(OUT, { recursive: true });
const site = process.env.BASE ? { base: process.env.BASE, close() {} } : await serve();
const browser = await launch();
let code = 0;
try {
  // ---- 1. the four backs, and each foil in the inspect view ----
  const page = await newPage(browser);
  await page.goto(site.base + '#/garage/card-backs', { waitUntil: 'networkidle' });
  ok(await page.locator('.gar-backtile').count() === 4, 'the four-backs page shows four backs');
  ok(await page.evaluate(() => [...document.querySelectorAll('.gar-backtile img')].every((img) => img.complete && img.naturalWidth === 720)), 'each of them is a still that loaded');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing scrolls sideways at 390 px');
  ok((await contexts(page)).made === 0, 'no WebGL context is made until a back is opened');

  const flat = {};
  for (const foil of FOILS) {
    await open(page, foil);
    const box = await stage(page).boundingBox();
    const card = cardOn(box);
    flat[foil] = await look(page, stage(page), card, 48, `${foil}-flat`);
    ok(spread(flat[foil]) > 25, `${foil}: the card is drawn (the picture is not blank)`);
    ok(await page.evaluate(() => document.activeElement?.closest('dialog') !== null), `${foil}: the keyboard is inside the dialog`);

    if (foil === 'gloss') {
      // The gloss card, flat, is the artwork and nothing else. Compared over the middle four fifths of the card.
      const face = await look(page, stage(page), middle(card, 0.8), 48);
      const art = await artwork(page, face.across, face.down, 0.8);
      const upright = correlation(face, art);
      ok(upright > 0.9, `gloss, flat: the picture is the artwork (correlation ${upright.toFixed(3)})`);
      ok(upright > correlation(face, flipped(art, 'upside down')) + 0.3, 'gloss, flat: the artwork is not upside down');
      ok(upright > correlation(face, flipped(art, 'mirrored')) + 0.3, 'gloss, flat: the artwork is not mirrored');
      const [shown, drawn] = [colour(face), colour(art)];
      const off = Math.max(...shown.map((v, i) => Math.abs(v / drawn[i] - 1)));
      ok(off < 0.03, `gloss, flat: the artwork's colours are untouched (mean colour within ${(off * 100).toFixed(1)}% of the master's)`);
      ok(differ(face, art) < 10, `gloss, flat: no veil over the artwork (mean difference ${differ(face, art).toFixed(1)} of 255)`);
    } else {
      ok(differ(flat[foil], flat.gloss) > 4, `${foil}: it does not look like gloss (mean difference ${differ(flat[foil], flat.gloss).toFixed(1)} of 255)`);
    }

    // tilt: the mouse over the right edge, then the top left
    await page.mouse.move(box.x + box.width * 0.96, box.y + box.height * 0.5);
    const moving = await rest(page);
    const right = await look(page, stage(page), card, 48, `${foil}-right`);
    ok(moving > 5, `${foil}: the card moves over several frames (${moving})`);
    ok(differ(right, flat[foil]) > 3, `${foil}: tilting changes the picture (mean difference ${differ(right, flat[foil]).toFixed(1)})`);
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.08);
    await rest(page);
    const corner = await look(page, stage(page), card, 48, `${foil}-toward-the-light`);
    ok(differ(corner, right) > 3, `${foil}: a different tilt gives a different picture (mean difference ${differ(corner, right).toFixed(1)})`);

    // the pointer leaves: the card comes back to flat, the same picture as before, and the page stops drawing
    await page.mouse.move(2, 2);
    await rest(page);
    const again = await look(page, stage(page), card, 48);
    ok(differ(again, flat[foil]) < 1.5, `${foil}: with the pointer gone the card is flat again (mean difference ${differ(again, flat[foil]).toFixed(2)})`);
    const before = await frames(page);
    await page.waitForTimeout(1500);
    ok(await frames(page) === before, `${foil}: at rest the page asks for no frames at all`);

    await close(page);
    ok(await page.locator('canvas').count() === 0, `${foil}: closing takes the canvas away`);
    ok((await contexts(page)).live === 0, `${foil}: and hands its WebGL context back`);
    ok(await page.evaluate((label) => document.activeElement?.getAttribute('aria-label') === label, await tile(page, foil).getAttribute('aria-label')), `${foil}: the keyboard is back on the back that was opened`);
  }
  ok(differ(flat.rainbow, flat.holo) > 4 && differ(flat.prismatic, flat.rainbow) > 4 && differ(flat.prismatic, flat.holo) > 4, 'the three foils do not look like each other');

  // ---- 2. a finger: a touch the browser cancels sends the card back to flat and stops the drawing ----
  await open(page, 'holo');
  const box = await stage(page).boundingBox();
  const touch = (type, x, y) => page.evaluate(({ type, x, y }) => {
    document.querySelector('.gar-holo canvas').dispatchEvent(new PointerEvent(type, { pointerId: 41, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true }));
  }, { type, x, y });
  await touch('pointerdown', box.x + box.width * 0.9, box.y + box.height * 0.2);
  await rest(page);
  const held = await look(page, stage(page), cardOn(box));
  ok(differ(held, flat.holo) > 3, 'a finger held on the card tilts it');
  await touch('pointercancel', box.x + box.width * 0.9, box.y + box.height * 0.2);
  await rest(page);
  ok(differ(await look(page, stage(page), cardOn(box)), flat.holo) < 1.5, 'a touch the browser cancels sends the card back to flat');
  const settled = await frames(page);
  await page.waitForTimeout(1500);
  ok(await frames(page) === settled, 'and the page stops asking for frames');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.gar-holo canvas')).touchAction === 'none'), 'in the inspect view the card keeps the gesture (touch-action: none)');
  ok(await page.evaluate(() => getComputedStyle(document.documentElement).overflow === 'hidden'), 'and the page behind it does not scroll');

  // ---- 3. the window changes size (a phone is turned) ----
  await page.setViewportSize({ width: 844, height: 390 });
  await rest(page);
  const turned = await stage(page).boundingBox();
  ok(spread(await look(page, stage(page), cardOn(turned), 48, 'holo-turned')) > 25, 'after the screen is turned the card is still drawn');
  ok(await page.evaluate(() => { const c = document.querySelector('.gar-holo canvas'); return Math.abs(c.width - c.clientWidth * devicePixelRatio) <= 1 && Math.abs(c.height - c.clientHeight * devicePixelRatio) <= 1; }), 'and its drawing is the size of its new place');
  await page.setViewportSize({ width: 390, height: 844 });
  await rest(page);
  await close(page);

  // ---- 4. opened and closed twenty times ----
  for (let i = 0; i < 20; i++) { await open(page, FOILS[i % 4]); await close(page); }
  await open(page, 'prismatic');
  const afterMany = await stage(page).boundingBox();
  ok(spread(await look(page, stage(page), cardOn(afterMany))) > 25, 'opened and closed twenty times, the card still draws');
  const tally = await contexts(page);
  ok(tally.live === 1, `only the open card holds a WebGL context (${tally.made} were made, ${tally.live} is live)`);

  // ---- 5. the context is lost and does not come back: the still takes over ----
  expected.push(/^MiCar card back: the WebGL context was lost and did not come back$/);     // the card says so, once, as it gives up
  await page.evaluate(() => window.__contexts[window.__contexts.length - 1].getExtension('WEBGL_lose_context').loseContext());
  await page.waitForSelector('dialog.gar-cardback .gar-holo img', { timeout: 3500 });
  ok(await page.locator('dialog.gar-cardback canvas').count() === 0, 'when the WebGL context is lost for good, the still takes the card\'s place within three seconds');
  ok(await page.locator('dialog.gar-cardback .gar-holo img').getAttribute('src').then((src) => /back-prismatic\.webp$/.test(src)), 'and it is the still of the same foil');
  ok(await page.locator('dialog.gar-cardback .gar-hint').count() === 0, 'and nobody is told to drag a picture');
  ok(await page.locator('dialog.gar-cardback button').isVisible(), 'and Close still works');
  await close(page);
  await page.close();

  // ---- 6. reduce motion: one frame, flat, and it does not tilt ----
  const calm = await newPage(browser, { reducedMotion: 'reduce' });
  await calm.goto(site.base + '#/garage/card-backs', { waitUntil: 'networkidle' });
  await open(calm, 'rainbow');
  const calmBox = await stage(calm).boundingBox();
  const still = await look(calm, stage(calm), cardOn(calmBox));
  ok(spread(still) > 25, 'with motion reduced the card is still drawn');
  await calm.mouse.move(calmBox.x + calmBox.width * 0.95, calmBox.y + calmBox.height * 0.1);
  await calm.waitForTimeout(800);
  ok(differ(await look(calm, stage(calm), cardOn(calmBox)), still) < 1, 'and it does not tilt');
  ok(await calm.locator('dialog.gar-cardback .gar-hint').count() === 0, 'and nobody is told to drag it');
  await calm.close();

  // ---- 7. no WebGL at all: stills, and no error ----
  const plain = await newPage(browser, {}, () => { window.__noWebGL = true; });
  await plain.goto(site.base + '#/garage/card-backs', { waitUntil: 'networkidle' });
  await tile(plain, 'holo').click();
  await plain.waitForSelector('dialog.gar-cardback[open] .gar-holo img');
  ok(await plain.locator('dialog.gar-cardback canvas').count() === 0 && await plain.evaluate(() => { const img = document.querySelector('dialog.gar-cardback .gar-holo img'); return img.complete && img.naturalWidth === 720; }), 'without WebGL the inspect view shows the still');
  await plain.close();

  // ---- 8. the real path: park a car, open its page, look at its card's back ----
  const garage = await newPage(browser, { viewport: { width: 1100, height: 900 } });
  await garage.goto(site.base + '?lang=en#/garage', { waitUntil: 'networkidle' });
  await garage.getByRole('button', { name: 'Park a car' }).click();
  await garage.getByRole('button', { name: 'Park it' }).click();        // the form's own example car; parking opens its page
  await garage.waitForFunction(() => /^#\/garage\/MC-/.test(location.hash));
  const opener = garage.getByRole('button', { name: 'Card back' });
  await opener.waitFor();
  const rarity = await garage.locator('.gar-side .gar-rar').first().innerText();
  await opener.click();
  await garage.waitForSelector('dialog.gar-cardback[open] .gar-holo canvas');
  await rest(garage);
  const label = await garage.locator('dialog.gar-cardback').getAttribute('aria-label');
  ok(/^Card back: \d{4} /.test(label), `a parked car's page opens its card's back ("${label}")`);
  ok((await garage.locator('.gar-cardback-name b').innerText()).toLowerCase() === rarity.toLowerCase(), `it names the card's own rarity (${rarity})`);
  const carBox = await stage(garage).boundingBox();
  ok(spread(await look(garage, stage(garage), cardOn(carBox), 48, 'car-page')) > 25, 'and draws it');
  await garage.getByRole('button', { name: 'Close' }).click();
  await garage.waitForSelector('dialog.gar-cardback', { state: 'detached' });
  ok(await garage.evaluate(() => document.activeElement?.textContent === 'Card back'), 'Close gives the keyboard back to the "Card back" button');
  await garage.close();

  // ---- 9. Spanish ----
  const es = await newPage(browser);
  await es.goto(site.base + '?lang=es#/garage/card-backs', { waitUntil: 'networkidle' });
  ok(await tile(es, 'holo').getAttribute('aria-label') === 'Mostrar el reverso: Holográfico estándar', 'the page speaks Spanish');
  await es.close();

  if (errors.length > 0) fail('the page reported errors:\n  ' + errors.join('\n  '));
  ok(true, 'no page reported an error');
} catch (error) {
  code = 1;
  console.error(String(error.message ?? error));
  if (errors.length > 0) console.error('page errors so far:\n  ' + errors.join('\n  '));
} finally {
  await browser.close();
  site.close();
}
process.exit(code);
