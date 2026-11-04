#!/usr/bin/env node
// Sprite pipeline driver: renders the procedural vehicle into per-part, per-frame layers (like 3DTuning's
// a{frame}_{x}_{y}.png layers) plus a manifest, using headless Chromium + three.js.
//   node tools/render-sprites.mjs --preview            # QA composites of a few frames/configs -> tools/preview/
//   node tools/render-sprites.mjs                      # full sprite set -> assets/sprites/ + manifest.json
//   node tools/render-sprites.mjs --frames 0,12 --parts body/stock,hood/stock   # subset
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PKG || 'playwright');
const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.error('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
await page.goto(`http://127.0.0.1:${port}/tools/render-page.html`);
await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
const info = await page.evaluate(() => window.__pipeline.init());
console.log(`vehicle: ${info.parts.length} parts, ${info.frames} frames`);

const t0 = Date.now();
if (flag('--preview')) {
  const outDir = path.join(root, 'tools', 'preview'); fs.mkdirSync(outDir, { recursive: true });
  const shots = JSON.parse(opt('--shots', JSON.stringify([
    { name: 'default_f0', k: 0, config: {} }, { name: 'default_f12', k: 12, config: {} }, { name: 'default_f24', k: 24, config: {} }, { name: 'default_f36', k: 36, config: {} },
    { name: 'offroad_f4', k: 4, config: { hood: 'vented', doors: 'tube', door_glass: 'full', roof: 'none', front_bumper: 'steel', rear_bumper: 'steel', front_flares: 'wide', rear_flares: 'wide', tire_fl: 'mt', tire_fr: 'mt', tire_rl: 'mt', tire_rr: 'mt', rim_fl: 'beadlock', rim_fr: 'beadlock', rim_rl: 'beadlock', rim_rr: 'beadlock', headlights: 'led', grille: 'mesh', mirrors: 'tow', steps: 'sliders', roof_rack: 'none', light_bar: 'led', snorkel: 'raised', antenna: 'whip' } },
    { name: 'soft_f20', k: 20, config: { roof: 'soft', doors: 'half', steps: 'tube', roof_rack: 'none', rim_fl: 'steel', rim_fr: 'steel', rim_rl: 'steel', rim_rr: 'steel' } },
  ])));
  for (const s of shots) {
    const url = await page.evaluate(({ config, k }) => window.__pipeline.preview(config, k), s);
    fs.writeFileSync(path.join(outDir, s.name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    console.log('preview', s.name);
  }
  if (flag('--bg')) { const b64 = await page.evaluate(() => window.__pipeline.renderBackground()); fs.writeFileSync(path.join(outDir, 'background.jpg'), Buffer.from(b64, 'base64')); console.log('preview background'); }
} else {
  const outDir = path.join(root, 'assets', 'sprites'); fs.mkdirSync(outDir, { recursive: true });
  const frames = opt('--frames', null) ? opt('--frames').split(',').map(Number) : [...Array(info.frames).keys()];
  const onlyParts = opt('--parts', null) ? opt('--parts').split(',') : null;
  const manifestPath = path.join(outDir, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) && (onlyParts || opt('--frames', null)) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { stage: { w: 1440, h: 900 }, frameCount: info.frames, startFrame: 0, format: 'webp', parts: {}, frames: [], dim: info.dim, defaultConfig: info.defaultConfig };
  manifest.partsMeta = Object.fromEntries(info.parts.map(p => [p.id, p]));
  if (!flag('--no-bg')) { const b64 = await page.evaluate(() => window.__pipeline.renderBackground()); fs.mkdirSync(path.join(root, 'assets', 'bg'), { recursive: true }); fs.writeFileSync(path.join(root, 'assets', 'bg', 'garage.jpg'), Buffer.from(b64, 'base64')); console.log('background written'); }
  let files = 0, bytes = 0;
  for (const k of frames) {
    const tk = Date.now();
    const res = await page.evaluate(({ k, onlyParts }) => window.__pipeline.renderFrame(k, onlyParts), { k, onlyParts });
    const frameEntry = manifest.frames[k] || { order: [], depth: {}, hubs: {} };
    frameEntry.hubs = res.hubs; frameEntry.coreDepth = +(res.coreDepth || 0).toFixed(3);
    for (const part of res.parts) {
      const pm = manifest.parts[part.id] || (manifest.parts[part.id] = { frames: {} });
      const fe = pm.frames[k] = {};
      if (part.depth !== undefined) frameEntry.depth[part.id] = +part.depth.toFixed(3);
      for (const [layer, L] of Object.entries(part.layers)) {
        const dir = path.join(outDir, part.id, layer); fs.mkdirSync(dir, { recursive: true });
        const fn = `f${String(k).padStart(2, '0')}_${L.x}_${L.y}.webp`;
        const buf = Buffer.from(L.data, 'base64'); fs.writeFileSync(path.join(dir, fn), buf); files++; bytes += buf.length;
        fe[layer] = [L.x, L.y, L.w, L.h];
      }
    }
    // z-order: farthest first (camera-space z ascending, i.e. most negative first)
    frameEntry.order = Object.entries(frameEntry.depth).sort((a, b) => a[1] - b[1]).map(e => e[0]);
    manifest.frames[k] = frameEntry;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    console.log(`frame ${k}: ${res.parts.length} parts in ${((Date.now() - tk) / 1000).toFixed(1)}s  (total ${files} files, ${(bytes / 1048576).toFixed(1)} MB)`);
  }
  console.log(`done: ${files} files, ${(bytes / 1048576).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await browser.close(); server.close();
