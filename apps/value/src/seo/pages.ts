// Plain-HTML pages for search engines and AI readers. The app itself is a client-rendered SPA with hash routes,
// so a crawler that doesn't run JavaScript sees an empty <div id="root">. These pages are generated at build time
// (tools/build-seo.ts) from the same sticker data the app uses: one page per make/model, an index of every model,
// plus sitemap.xml, robots.txt and llms.txt. Pure functions only, so the tests can check the output as text.

export const SITE_URL = 'https://lasting-oasis.github.io/Micar-com/';

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

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const range = (lo: number, hi: number) => (lo === hi ? usd(lo) : `${usd(lo)}–${usd(hi)}`);

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

function shell(opts: { title: string; description: string; canonical: string; css: string; footer: string; jsonld: unknown[]; body: string }): string {
  const ld = opts.jsonld.map((x) => `<script type="application/ld+json">${jsonLd(x)}</script>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(opts.title)}</title>
<meta name="description" content="${escapeHtml(opts.description)}" />
<link rel="canonical" href="${escapeHtml(opts.canonical)}" />
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

export function modelPageHtml(p: ModelPage, env: PageEnv): string {
  const name = `${p.make} ${p.model}`;
  const newest = p.years[0];
  const oldest = p.years[p.years.length - 1];
  const span = newest.year === oldest.year ? String(newest.year) : `${oldest.year}–${newest.year}`;
  const allLow = Math.min(...p.years.map((y) => y.low));
  const allHigh = Math.max(...p.years.map((y) => y.high));
  const canonical = `${SITE_URL}cars/${p.slug}/`;
  const app = '../../';
  const description = `${name} (${p.body}) used values on MiCar: original sticker prices (MSRP) for ${span} model years, ${range(allLow, allHigh)} new, and a free calculator for trade-in, private-party and dealer retail value.`;
  const rows = p.years
    .map((y) => `<tr><td>${y.year}</td><td>${y.trims}</td><td>${range(y.low, y.high)}</td><td><a href="${escapeHtml(valueLink(app, p, y))}">Value a ${y.year}</a></td></tr>`)
    .join('\n');
  const body = `<p class="crumbs"><a href="${app}">MiCar</a> › <a href="../">All cars</a> › ${escapeHtml(p.make)}</p>
<h1>${escapeHtml(name)} values</h1>
<p>The ${escapeHtml(name)} is a ${escapeHtml(p.body.toLowerCase())}. MiCar has original window-sticker prices for ${p.years.length} model year${p.years.length === 1 ? '' : 's'} (${span}), from ${usd(allLow)} to ${usd(allHigh)} before destination. Pick a year to see what one is worth today: trade-in, private-party and dealer retail, with a price range and a five-year forecast. Free, no account.</p>
<a class="cta" href="${escapeHtml(valueLink(app, p, newest))}">Value my ${escapeHtml(name)}</a>
<h2>Original MSRP by model year</h2>
<table>
<thead><tr><th>Year</th><th>Trims</th><th>MSRP range (excl. destination)</th><th></th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<p class="muted">Sticker prices come from manufacturer and pricing sources gathered for MiCar; today's values are estimates computed in the app from the sticker price, age, mileage, condition and region.</p>`;
  const jsonld = [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name,
      brand: { '@type': 'Brand', name: p.make },
      category: p.body,
      url: canonical,
      offers: { '@type': 'AggregateOffer', priceCurrency: 'USD', lowPrice: allLow, highPrice: allHigh, offerCount: p.years.reduce((n, y) => n + y.trims, 0) },
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
  return shell({ title: `${name} values and original MSRP (${span}) | MiCar`, description, canonical, css: env.css, footer: env.footer, jsonld, body });
}

export function indexPageHtml(pages: ModelPage[], env: PageEnv): string {
  const byMake = new Map<string, ModelPage[]>();
  for (const p of pages) byMake.set(p.make, [...(byMake.get(p.make) ?? []), p]);
  const sections = [...byMake]
    .map(([make, ps]) => `<h2 id="${slugify(make)}">${escapeHtml(make)}</h2>\n<ul class="models">\n${ps.map((p) => `<li><a href="${p.slug}/">${escapeHtml(p.model)}</a> <span class="muted">${p.years[p.years.length - 1].year}–${p.years[0].year}</span></li>`).join('\n')}\n</ul>`)
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
    css: env.css,
    footer: env.footer,
    jsonld,
    body,
  });
}

export function sitemapXml(pages: ModelPage[], lastmod: string): string {
  const urls = [SITE_URL, `${SITE_URL}cars/`, ...pages.map((p) => `${SITE_URL}cars/${p.slug}/`)];
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

> MiCar (said MEE-car) is a free used-car value site. Type a car and it shows what it's worth today: trade-in, private-party and dealer retail, with a price range and a five-year forecast, worked out line by line from the original sticker price (MSRP), age, mileage, condition, title, accident history and region. No account. Dealers can print a window sheet with a QR code that opens the car's page.

The app at ${SITE_URL} runs in the browser (JavaScript, hash routes). For plain-HTML reading, use the pages below; each model page lists original MSRP by model year and links into the calculator.

## Key pages

- [All cars](${SITE_URL}cars/): ${pages.length} models from ${makes.length} makes, with links to every model page
- [Value calculator](${SITE_URL}#/value): the app; accepts query parameters make, model, trim, body, msrp, year, mileage, condition, title, accident, region, e.g. ${SITE_URL}?make=Honda&model=Civic&year=2019&msrp=20250#/value (MSRP in whole dollars, excluding destination)
- [Sitemap](${SITE_URL}sitemap.xml)

## Makes covered

${makes.join(', ')}

## Notes

- Values are estimates computed in the browser; sticker prices exclude destination charges.
- Source code: https://github.com/lasting-oasis/Micar-com
`;
}
