// Screenshot helper: node tools/shot.mjs <path-with-query> <out.png> [width height]
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PKG || 'playwright');
const root = path.resolve(import.meta.dirname, '..');
const [, , url, out, w = '1440', h = '900', setup = ''] = process.argv;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html';
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}${url}`);
try { await page.waitForFunction(() => window.__done, null, { timeout: 60000 }); console.log(JSON.stringify(await page.evaluate(() => window.__done)).slice(0, 1500)); } catch (e) { console.log('no __done:', e.message.slice(0, 100)); }
if (setup) { await page.evaluate(setup); await page.waitForTimeout(+(process.env.SHOT_WAIT || 900)); }
await page.waitForTimeout(300);
await page.screenshot({ path: out });
await browser.close(); server.close();
