// Writes the plain-HTML layer that search engines and AI readers can see without running JavaScript:
// site/cars/<make-model>/index.html for every model, site/cars/index.html, site/sitemap.xml, site/robots.txt, site/llms.txt,
// and the static JSON data API under site/api/v1/ (index.json, cars.json, cars/<id>.json, openapi.json).
// Run by build-site.sh from apps/value (pnpm --filter ... exec), so every path is resolved from this file, never from the cwd.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { footerHtml } from '../packages/brand/src/footer.ts';
import { apiIndexJson, buildCarRecords, carsListJson, openApiJson, type ApiSticker, type EpaFile } from '../apps/value/src/seo/api.ts';
import { buildModelPages, indexPageHtml, llmsTxt, modelPageHtml, robotsTxt, sitemapXml, type Sticker } from '../apps/value/src/seo/pages.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const write = (p: string, text: string) => {
  const out = resolve(root, 'site', p);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
};

const now = new Date();
const env = {
  css: read('packages/brand/src/tokens.css') + '\n' + read('packages/brand/src/footer.css'),
  footer: footerHtml('en', now.getFullYear()),
};
const stickers = JSON.parse(read('apps/value/src/data/stickers.json'));
const epa = JSON.parse(read('apps/value/src/data/epa-configs.json')) as EpaFile;
const pages = buildModelPages(stickers as Sticker[]);
const cars = buildCarRecords(stickers as ApiSticker[], epa);
const stamp = now.toISOString();
const json = (v: unknown) => JSON.stringify(v) + '\n';

for (const p of pages) write(`cars/${p.slug}/index.html`, modelPageHtml(p, env));
write('cars/index.html', indexPageHtml(pages, env));
write('sitemap.xml', sitemapXml(pages, now.toISOString().slice(0, 10)));
write('robots.txt', robotsTxt());
write('llms.txt', llmsTxt(pages));
for (const c of cars) write(`api/v1/cars/${c.id}.json`, json(c));
write('api/v1/cars.json', json(carsListJson(cars, stamp)));
write('api/v1/index.json', json(apiIndexJson(cars, epa, stamp)));
write('api/v1/openapi.json', JSON.stringify(openApiJson(), null, 2) + '\n');
console.log(`wrote ${pages.length} model pages, cars/index.html, sitemap.xml, robots.txt, llms.txt, ${cars.length} JSON records under api/v1/`);
