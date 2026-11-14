// Plain-HTML pages for search engines and AI readers. The app itself is a client-rendered SPA with hash routes,
// so a crawler that doesn't run JavaScript sees an empty <div id="root">. These pages are generated at build time
// (tools/build-seo.ts) from the same sticker data the app uses: one page per make/model, an index of every model,
// plus sitemap.xml, robots.txt and llms.txt. Pure functions only, so the tests can check the output as text.
// The site is a GitHub Pages project site, served under /Micar-com/. Crawlers read robots.txt only at a host's root
// (lasting-oasis.github.io/robots.txt, which this repository does not publish), so the robots.txt written here takes
// effect only if the site moves to a domain of its own. Every page links the sitemap from its <head>, but that is a hint
// major search engines do not read: until then the sitemap reaches them only by being submitted to them directly.

import type { CarRecord, CarSpec, CarYear } from './api';

export const SITE_URL = 'https://lasting-oasis.github.io/Micar-com/';
/** The two plain-HTML pages that say what MiCar is and how a value is worked out (about.ts writes them). */
export const ABOUT_URL = `${SITE_URL}about/`;
export const METHOD_URL = `${SITE_URL}method/`;

export type StickerTrim = { trim: string; msrp: number };
export type StickerYear = { year: number; trims: StickerTrim[] };
export type Sticker = { make: string; model: string; body: string; years: StickerYear[] };

/** One model year: trim count, MSRP range, and the cheapest trim (the calculator link opens on it). */
export type YearRow = { year: number; trims: number; low: number; high: number; baseTrim: string };
export type ModelPage = { slug: string; make: string; model: string; body: string; years: YearRow[] };

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** JSON for a <script type="application/ld+json"> block: `<` is escaped so no string can close the script tag. */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * One page per make/model slug. The data has a few case-only duplicates (e.g. "370Z" and "370z"); they share a
 * slug, so they're merged: for a year both carry, the entry with more trims wins. The first spelling seen is kept.
 * Years with no priced trims are dropped; a model left with no years gets no page.
 */
export function buildModelPages(stickers: Sticker[]): ModelPage[] {
  const bySlug = new Map<string, { make: string; model: string; body: string; years: Map<number, StickerTrim[]> }>();
  for (const s of stickers) {
    const slug = slugify(`${s.make} ${s.model}`);
    if (!slug) continue;
    let entry = bySlug.get(slug);
    if (!entry) bySlug.set(slug, (entry = { make: s.make, model: s.model, body: s.body, years: new Map() }));
    for (const y of s.years) {
      const priced = y.trims.filter((t) => Number.isFinite(t.msrp) && t.msrp > 0);
      if (priced.length > (entry.years.get(y.year)?.length ?? 0)) entry.years.set(y.year, priced);
    }
  }
  const pages: ModelPage[] = [];
  for (const [slug, e] of bySlug) {
    const years = [...e.years]
      .filter(([, t]) => t.length > 0)
      .map(([year, t]) => {
        const base = t.reduce((a, b) => (b.msrp < a.msrp ? b : a));
        return { year, trims: t.length, low: base.msrp, high: Math.max(...t.map((x) => x.msrp)), baseTrim: base.trim };
      })
      .sort((a, b) => b.year - a.year);
    if (years.length) pages.push({ slug, make: e.make, model: e.model, body: e.body, years });
  }
  return pages.sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model));
}

export const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const range = (lo: number, hi: number) => (lo === hi ? usd(lo) : `${usd(lo)}–${usd(hi)}`);

/** A span of model years: one year once ("2024"), more as a range ("2010–2026"). */
export function yearSpan(first: number, last: number): string {
  return first === last ? String(first) : `${first}–${last}`;
}

/** The model years MiCar has, as runs of consecutive years ("2010–2012, 2024"), so a span never claims a year it lacks. */
export function yearRuns(years: number[]): string {
  const ys = [...new Set(years)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < ys.length; ) {
    let j = i;
    while (j + 1 < ys.length && ys[j + 1] === ys[j] + 1) j++;
    runs.push(yearSpan(ys[i], ys[j]));
    i = j + 1;
  }
  return runs.join(', ');
}

/** The data's body styles as words in a sentence, with their article ("an SUV or crossover"). */
const BODY_WORDS: Record<string, string> = {
  'Sedan': 'a sedan',
  'SUV / Crossover': 'an SUV or crossover',
  'Coupe / Sports': 'a coupe or sports car',
  'Hatchback / Wagon': 'a hatchback or wagon',
  'Pickup Truck': 'a pickup truck',
  'Minivan': 'a minivan',
};
export function bodyPhrase(body: string): string {
  const known = BODY_WORDS[body];
  if (known) return known;
  const words = body.toLowerCase().replace(/\s*\/\s*/g, ' or ');
  return (/^[aeiou]/.test(words) ? 'an ' : 'a ') + words;
}

/** The calculator link the app already understands (urlState.ts): query params, then the #/value route. */
export function valueLink(base: string, p: ModelPage, row?: YearRow): string {
  const q = new URLSearchParams({ make: p.make, model: p.model, body: p.body });
  if (row) {
    q.set('trim', row.baseTrim);
    q.set('year', String(row.year));
    q.set('msrp', String(row.low));
  }
  return `${base}?${q.toString()}#/value`;
}

export function shell(opts: { title: string; description: string; canonical: string; css: string; footer: string; jsonld: unknown[]; body: string; json?: string }): string {
  const ld = opts.jsonld.map((x) => `<script type="application/ld+json">${jsonLd(x)}</script>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(opts.title)}</title>
<meta name="description" content="${escapeHtml(opts.description)}" />
<link rel="canonical" href="${escapeHtml(opts.canonical)}" />
${opts.json ? `<link rel="alternate" type="application/json" href="${escapeHtml(opts.json)}" />\n` : ''}<link rel="sitemap" type="application/xml" href="${SITE_URL}sitemap.xml" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="MiCar" />
<meta property="og:title" content="${escapeHtml(opts.title)}" />
<meta property="og:description" content="${escapeHtml(opts.description)}" />
<meta property="og:url" content="${escapeHtml(opts.canonical)}" />
<meta property="og:image" content="${SITE_URL}og.jpg" />
<meta name="theme-color" content="#0e1217" />
<link rel="icon" type="image/svg+xml" href="${SITE_URL}favicon.svg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600;700&display=swap" rel="stylesheet" />
${ld}
<style>${opts.css}
body{margin:0;background:var(--mc-night);color:var(--mc-ink);font-family:var(--mc-body);line-height:1.5}
main{max-width:860px;margin:0 auto;padding:24px 16px 48px}
a{color:var(--mc-paint)}
h1,h2{font-family:var(--mc-cond);letter-spacing:.01em;line-height:1.1}
h1{font-size:2.2rem;margin:.4em 0 .2em}
h3{font-family:var(--mc-cond);font-size:1.25rem;margin:1.4em 0 .2em}
li{margin:.2em 0}
.crumbs,.muted{color:var(--mc-haze);font-size:.9rem}
.cta{display:inline-block;background:var(--mc-paint);color:var(--mc-night);font-weight:600;padding:10px 16px;border-radius:8px;text-decoration:none;margin:12px 0}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--mc-line)}
th{color:var(--mc-haze);font-weight:500}
ul.models{columns:2 220px;padding-left:1.1em}
</style>
</head>
<body>
<main>
${opts.body}
</main>
${opts.footer}
</body>
</html>
`;
}

export type PageEnv = { css: string; footer: string };

/** One EPA configuration as words: "1.5 L 4-cyl, Automatic (AV-S7), Front-Wheel Drive, Premium Gasoline". */
export function specPhrase(s: CarSpec): string {
  const engine = [s.displacementL ? `${s.displacementL} L` : '', s.cylinders ? `${s.cylinders}-cyl` : ''].filter(Boolean).join(' ');
  return [engine, s.type, s.transmission, s.drive, s.fuel].filter(Boolean).join(', ');
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/** Where a model year's prices came from, in words, with the link when there is one. */
export function sourcePhrase(src: CarYear['source']): string {
  const kind = src.kind === 'manufacturer' ? "the manufacturer's own pricing" : src.kind === 'secondary' ? 'a secondary pricing site' : 'a source MiCar did not classify';
  return src.url ? `${kind} (<a href="${escapeHtml(src.url)}" rel="nofollow noopener">${escapeHtml(hostOf(src.url))}</a>)` : kind;
}

/**
 * One model year in full, as HTML a reader without JavaScript gets: every trim and its MSRP, the destination charge,
 * the EPA's configurations and where the prices came from. The same record as api/v1/cars/<id>.json, so the page
 * and the JSON cannot disagree.
 */
function yearDetailHtml(name: string, y: CarYear): string {
  const withConfig = y.trims.some((t) => t.config);
  const rows = y.trims.map((t) => `<tr><td>${escapeHtml(t.name)}</td>${withConfig ? `<td>${escapeHtml(t.config ?? '')}</td>` : ''}<td>${usd(t.msrpUsd)}</td></tr>`).join('\n');
  const specs = y.specs.length
    ? `<p>How the EPA lists the ${y.year} ${escapeHtml(name)} (engine, transmission, drive, fuel):</p>\n<ul>\n${y.specs.map((s) => `<li>${escapeHtml(specPhrase(s))}</li>`).join('\n')}\n</ul>`
    : `<p class="muted">The EPA's vehicle file lists no configuration for the ${y.year} ${escapeHtml(name)}.</p>`;
  return `<h3 id="y${y.year}">${y.year} ${escapeHtml(name)}</h3>
<p class="muted">${y.destinationUsd ? `Destination charge ${usd(y.destinationUsd)}, not included in the prices below. ` : ''}Prices from ${sourcePhrase(y.source)}.</p>
<table>
<thead><tr><th>Trim</th>${withConfig ? '<th>Configuration</th>' : ''}<th>Original MSRP</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
${specs}`;
}

export function modelPageHtml(p: ModelPage, env: PageEnv, car?: CarRecord): string {
  const name = `${p.make} ${p.model}`;
  const newest = p.years[0];
  const span = yearRuns(p.years.map((y) => y.year));
  const allLow = Math.min(...p.years.map((y) => y.low));
  const allHigh = Math.max(...p.years.map((y) => y.high));
  const canonical = `${SITE_URL}cars/${p.slug}/`;
  const app = '../../';
  const description = `${name} (${p.body}) used values on MiCar: original sticker prices (MSRP) for the ${span} model year${p.years.length === 1 ? '' : 's'}, ${range(allLow, allHigh)} new, and a free calculator for trade-in, private-party and dealer retail value.`;
  const rows = p.years
    .map((y) => `<tr><td>${y.year}</td><td>${y.trims}</td><td>${range(y.low, y.high)}</td><td><a href="${escapeHtml(valueLink(app, p, y))}">Value a ${y.year}</a></td></tr>`)
    .join('\n');
  const body = `<p class="crumbs"><a href="${app}">MiCar</a> › <a href="../">All cars</a> › ${escapeHtml(p.make)}</p>
<h1>${escapeHtml(name)} values</h1>
<p>The ${escapeHtml(name)} is ${escapeHtml(bodyPhrase(p.body))}. MiCar has original window-sticker prices for ${p.years.length} model year${p.years.length === 1 ? '' : 's'} (${span}), ${allLow === allHigh ? `at ${usd(allLow)}` : `from ${usd(allLow)} to ${usd(allHigh)}`} before destination. Pick a year to see what one is worth today: trade-in, private-party and dealer retail, with a price range and a five-year forecast. Free, no account.</p>
<a class="cta" href="${escapeHtml(valueLink(app, p, newest))}">Value my ${escapeHtml(name)}</a>
<h2>Original MSRP by model year</h2>
<table>
<thead><tr><th>Year</th><th>Trims</th><th>MSRP range (excl. destination)</th><th></th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
${car ? `<h2>Every trim, engine and price source</h2>\n${car.years.map((y) => yearDetailHtml(name, y)).join('\n')}\n` : ''}<p class="muted">${car ? 'The same figures are' : "Every trim and its MSRP, with the EPA's engine and drivetrain configurations where the EPA lists them, is"} also available as <a href="${SITE_URL}api/v1/cars/${p.slug}.json">JSON</a>. Sticker prices come from manufacturer and pricing sources gathered for MiCar, named for each model year. Today's values are estimates, not offers: the calculator works them out from the sticker price, age, mileage, condition, title, reported accidents, region and the used-car market, and from local supply and asking prices when you give them. MiCar checks no record of any car. <a href="${app}method/">How a value is worked out, and how far off it can be</a>.</p>`;
  // A Car, not a Product with offers: MiCar sells no cars, and the MSRPs are past sticker prices across many model
  // years, not prices anyone is asking. They stay in the page's table, where they read as what they are.
  const jsonld = [
    {
      '@context': 'https://schema.org',
      '@type': 'Car',
      name,
      brand: { '@type': 'Brand', name: p.make },
      model: p.model,
      bodyType: p.body,
      url: canonical,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'MiCar', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'All cars', item: `${SITE_URL}cars/` },
        { '@type': 'ListItem', position: 3, name, item: canonical },
      ],
    },
  ];
  return shell({ title: `${name} values and original MSRP (${span}) | MiCar`, description, canonical, css: env.css, footer: env.footer, jsonld, body, json: `${SITE_URL}api/v1/cars/${p.slug}.json` });
}

export function indexPageHtml(pages: ModelPage[], env: PageEnv): string {
  const byMake = new Map<string, ModelPage[]>();
  for (const p of pages) byMake.set(p.make, [...(byMake.get(p.make) ?? []), p]);
  const sections = [...byMake]
    .map(([make, ps]) => `<h2 id="${slugify(make)}">${escapeHtml(make)}</h2>\n<ul class="models">\n${ps.map((p) => `<li><a href="${p.slug}/">${escapeHtml(p.model)}</a> <span class="muted">${yearRuns(p.years.map((y) => y.year))}</span></li>`).join('\n')}\n</ul>`)
    .join('\n');
  const body = `<p class="crumbs"><a href="../">MiCar</a> › All cars</p>
<h1>Every car MiCar can value</h1>
<p>${pages.length} models from ${byMake.size} makes, each with original sticker prices by model year and a free used-car value calculator. <a href="../#/value">Open the calculator</a>.</p>
${sections}`;
  const jsonld = [
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Cars MiCar can value',
      numberOfItems: pages.length,
      itemListElement: pages.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: `${p.make} ${p.model}`, url: `${SITE_URL}cars/${p.slug}/` })),
    },
  ];
  return shell({
    title: 'Every car MiCar can value: used-car values and original MSRP by model | MiCar',
    description: `Browse ${pages.length} car models from ${byMake.size} makes with original sticker prices by year and a free trade-in, private-party and dealer retail value calculator.`,
    canonical: `${SITE_URL}cars/`,
    json: `${SITE_URL}api/v1/cars.json`,
    css: env.css,
    footer: env.footer,
    jsonld,
    body,
  });
}

export function sitemapXml(pages: ModelPage[], lastmod: string): string {
  const urls = [SITE_URL, ABOUT_URL, METHOD_URL, `${SITE_URL}cars/`, ...pages.map((p) => `${SITE_URL}cars/${p.slug}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${escapeHtml(u)}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}
</urlset>
`;
}

export function robotsTxt(): string {
  return `User-agent: *
Allow: /

Sitemap: ${SITE_URL}sitemap.xml
`;
}

export function llmsTxt(pages: ModelPage[]): string {
  const makes = [...new Set(pages.map((p) => p.make))];
  return `# MiCar

> MiCar (said MEE-car) treats a car as an asset with a record. It does three things on one site. It values a used car, free: trade-in, private-party and dealer retail, with a price range and a five-year forecast, worked out line by line from the original sticker price (MSRP), age, mileage, condition, title, accident history and region. It keeps a car in a Garage as a card with a MiCar ID, a passport of its history, a five-part grade and a collectible card. And it has MiCar World, a 3D town where the card's car is driven, tuned and raced. No account is needed. Everything about a single car is what its owner states: MiCar has checked no record and no verifier is connected yet.

The app at ${SITE_URL} runs in the browser (JavaScript, hash routes). For plain-HTML reading, use the pages below.

## Key pages

- [What MiCar is](${ABOUT_URL}): the calculator, the Garage (MiCar ID, passport, grade, card), the World, the pages for dealers and shops, and what is and is not checked today
- [How a value is worked out](${METHOD_URL}): every input and step, the accuracy measured against real listings model by model, and what the estimate does not know
- [All cars](${SITE_URL}cars/): ${pages.length} models from ${makes.length} makes; each model page lists every model year, every trim with its original MSRP, the EPA's engine and drivetrain configurations and the price source
- [Value calculator](${SITE_URL}#/value): the app; accepts query parameters make, model, trim, body, msrp, year, mileage, condition, title, accident, region, e.g. ${SITE_URL}?make=Honda&model=Civic&year=2019&msrp=20250#/value (MSRP in whole dollars, excluding destination)
- [The Garage](${SITE_URL}#/garage): the app; cars parked there are kept in the visitor's own browser and nowhere else
- [MiCar World](https://micar-sim.onrender.com/): the 3D town (JavaScript and WebGL)
- [Sitemap](${SITE_URL}sitemap.xml)

## Data API (JSON)

Free, read-only, no key. Static files rebuilt with every deploy, plus one live valuation endpoint; the format is in the OpenAPI file.

- [API index](${SITE_URL}api/v1/index.json): counts, sources and links
- [All models](${SITE_URL}api/v1/cars.json): id, make, model, body, years covered and MSRP range for each
- One model: ${SITE_URL}api/v1/cars/{id}.json, e.g. ${SITE_URL}api/v1/cars/honda-civic.json: every model year, every trim with its MSRP, destination charge, the EPA's engine, transmission, drive and fuel configurations where the EPA lists them, the price source, and a calculator link per year
- [OpenAPI 3.1 description](${SITE_URL}api/v1/openapi.json)
- [Valuation method as data](${SITE_URL}api/v1/method.json): the multipliers the engine applies and the measured error for each model fitted to listings
- [Vehicle record format](${SITE_URL}api/v1/passport.schema.json): JSON Schema of the public view of one car's passport (MiCar ID, identity, history entries, grades, card editions). No endpoint serves passports: they are kept on the owner's device until accounts open, so there is no lookup by VIN or by MiCar ID

## Valuation API (live)

- GET https://micar-sim.onrender.com/api/v1/value?id=honda-civic&year=2019&mileage=60000 returns today's trade-in, private-party and dealer retail value, a range, confidence, the line-by-line build-up and a five-year forecast. Same engine and parameters as the calculator; make and model work in place of id. MSRP and mileage are filled in when left out and listed under "assumed". Every answer says that the title, accidents, condition and mileage are self-declared: MiCar has checked no record. A rebuilt or salvage title is priced by a dealer's rule of thumb (rebuilt about 30-35% under the same car with a clean title, salvage about 40% under), and the answer carries a warning saying so. Free hosting: the first call after a quiet spell can take up to a minute.

## Makes covered

${makes.join(', ')}

## Notes

- Values are estimates, not offers and not appraisals; sticker prices exclude destination charges.
- A grade, a certification level and a card describe the record an owner has built, not an inspection. Nothing on MiCar is independently verified today.
- The site lives under ${SITE_URL}, so this file and the sitemap are there rather than at the host's root.
- Source code: https://github.com/lasting-oasis/Micar-com
`;
}
