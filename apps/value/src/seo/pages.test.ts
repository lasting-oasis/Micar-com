import { describe, expect, it } from 'vitest';
import stickers from '../data/stickers.json';
import epa from '../data/epa-configs.json';
import { buildCarRecords, type ApiSticker, type EpaFile } from './api';
import { ABOUT_URL, METHOD_URL, specPhrase, bodyPhrase, buildModelPages, escapeHtml, indexPageHtml, jsonLd, llmsTxt, modelPageHtml, robotsTxt, sitemapXml, slugify, SITE_URL, valueLink, yearRuns, yearSpan, type Sticker } from './pages';

const env = { css: ':root{}', footer: '<footer class="mc-foot"></footer>' };
const t = (trim: string, msrp: number) => ({ trim, msrp });
// the page as the site builds it: with the model's JSON record, so its trims, EPA configurations and sources are in the HTML
const records = new Map(buildCarRecords(stickers as unknown as ApiSticker[], epa as unknown as EpaFile).map((c) => [c.id, c]));
const full = (p: Parameters<typeof modelPageHtml>[0]) => modelPageHtml(p, env, records.get(p.slug));

describe('seo pages', () => {
  it('slugifies make and model', () => {
    expect(slugify('Mercedes-Benz C-Class')).toBe('mercedes-benz-c-class');
    expect(slugify('Citroën  2CV!')).toBe('citroen-2cv');
  });

  it('merges case-only duplicates, keeps the fuller year, drops empty years and models', () => {
    const data: Sticker[] = [
      { make: 'Nissan', model: '370Z', body: 'Coupe / Sports', years: [{ year: 2019, trims: [t('Base', 30090)] }, { year: 2018, trims: [] }] },
      { make: 'Nissan', model: '370z', body: 'Coupe / Sports', years: [{ year: 2019, trims: [t('Base', 30090), t('Nismo', 45790)] }] },
      { make: 'Ghost', model: 'Car', body: 'Sedan', years: [{ year: 2020, trims: [] }] },
    ];
    const pages = buildModelPages(data);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ slug: 'nissan-370z', model: '370Z' });
    expect(pages[0].years).toEqual([{ year: 2019, trims: 2, low: 30090, high: 45790, baseTrim: 'Base' }]);
  });

  it('builds a calculator link the app reads (query params, then #/value)', () => {
    const [p] = buildModelPages([{ make: 'Honda', model: 'Civic', body: 'Sedan', years: [{ year: 2019, trims: [t('EX', 23000), t('LX', 20650)] }] }]);
    const url = new URL(valueLink(SITE_URL, p, p.years[0]));
    expect(url.hash).toBe('#/value');
    expect(Object.fromEntries(url.searchParams)).toEqual({ make: 'Honda', model: 'Civic', body: 'Sedan', trim: 'LX', year: '2019', msrp: '20650' });
  });

  it('escapes HTML and keeps JSON-LD from closing its script tag', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(jsonLd({ n: '</script>' })).not.toContain('</script>');
  });

  it('every real model gets a readable page with text, a canonical URL and valid JSON-LD', () => {
    const pages = buildModelPages(stickers as unknown as Sticker[]);
    expect(pages.length).toBeGreaterThan(500);
    expect(new Set(pages.map((p) => p.slug)).size).toBe(pages.length);
    for (const p of pages) {
      const html = full(p);
      expect(html).toContain(`<h1>${escapeHtml(`${p.make} ${p.model}`)} values</h1>`);
      expect(html).toContain(`<link rel="canonical" href="${SITE_URL}cars/${p.slug}/" />`);
      expect(html.match(/<meta name="description"/g)).toHaveLength(1);
      for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)) expect(() => JSON.parse(m[1])).not.toThrow();
      expect(html).not.toMatch(/NaN|undefined|Infinity/);
    }
  });

  it('names every body style in the data as words, with the right article', () => {
    expect(bodyPhrase('Sedan')).toBe('a sedan');
    expect(bodyPhrase('SUV / Crossover')).toBe('an SUV or crossover');
    expect(bodyPhrase('Coupe / Sports')).toBe('a coupe or sports car');
    expect(bodyPhrase('Hatchback / Wagon')).toBe('a hatchback or wagon');
    expect(bodyPhrase('Pickup Truck')).toBe('a pickup truck');
    expect(bodyPhrase('Minivan')).toBe('a minivan');
    expect(bodyPhrase('Electric Utility')).toBe('an electric utility');           // a body the table does not know yet
    const bodies = new Set((stickers as unknown as Sticker[]).map((s) => s.body));
    for (const p of buildModelPages(stickers as unknown as Sticker[])) {
      const lead = full(p).match(/<p>The .*? is (an? [^.]+)\. MiCar/)?.[1];
      expect(lead, p.slug).toBe(bodyPhrase(p.body));
      expect(lead).not.toContain('/');                                         // the articles are pinned above
      expect(Object.values({ s: 'a sedan', u: 'an SUV or crossover', c: 'a coupe or sports car', h: 'a hatchback or wagon', p: 'a pickup truck', m: 'a minivan' })).toContain(lead);
    }
    expect(bodies.size).toBeGreaterThan(3);
  });

  it('links the sitemap from every page, since robots.txt under /Micar-com/ is not where crawlers look', () => {
    const pages = buildModelPages(stickers as unknown as Sticker[]);
    const tag = `<link rel="sitemap" type="application/xml" href="${SITE_URL}sitemap.xml" />`;
    expect(indexPageHtml(pages, env)).toContain(tag);
    for (const p of pages) expect(full(p)).toContain(tag);
  });

  it('promises EPA configurations only where the EPA lists them (a few models, like the Ram 2500, have none)', () => {
    const pages = buildModelPages(stickers as unknown as Sticker[]);
    const bare = modelPageHtml(pages.find((p) => p.slug === 'honda-civic')!, env);
    expect(bare).toContain("with the EPA's engine and drivetrain configurations where the EPA lists them");
    expect(llmsTxt(pages)).toMatch(/the EPA's engine, transmission, drive and fuel configurations where the EPA lists them/);
    // with the record, a year the EPA does not list says so and shows no empty list
    for (const p of pages) {
      const html = full(p);
      expect(html, p.slug).not.toMatch(/<ul>\s*<\/ul>/);
      for (const y of records.get(p.slug)!.years) if (!y.specs.length) expect(html, `${p.slug} ${y.year}`).toContain(`lists no configuration for the ${y.year} `);
    }
  });

  it('puts every trim, its MSRP, the EPA configurations and the price source in the HTML itself, not only in the JSON', () => {
    const pages = buildModelPages(stickers as unknown as Sticker[]);
    for (const p of pages) {
      const car = records.get(p.slug)!;
      const html = full(p);
      expect(html.match(/<h3 id="y\d{4}">/g), p.slug).toHaveLength(car.years.length);
      for (const y of car.years) {
        const from = html.indexOf(`<h3 id="y${y.year}">`), to = html.indexOf('<h3 id="y', from + 1);
        const part = html.slice(from, to < 0 ? undefined : to);
        for (const tr of y.trims) expect(part, `${p.slug} ${y.year} ${tr.name}`).toContain(`<td>${escapeHtml(tr.name)}</td>`);
        expect(part.match(/<tr><td>/g), `${p.slug} ${y.year}`).toHaveLength(y.trims.length);
        expect(part).toContain(`$${y.msrpUsd.low.toLocaleString('en-US')}`);
        for (const sp of y.specs) expect(part, `${p.slug} ${y.year}`).toContain(`<li>${escapeHtml(specPhrase(sp))}</li>`);
        if (y.source.url) expect(part, `${p.slug} ${y.year}`).toContain(`href="${escapeHtml(y.source.url)}"`);
        expect(part).toMatch(y.source.kind === 'manufacturer' ? /the manufacturer's own pricing/ : /a secondary pricing site|did not classify/);
        if (y.destinationUsd) expect(part).toContain(`Destination charge $${y.destinationUsd.toLocaleString('en-US')}`);
      }
    }
    const civic = full(pages.find((p) => p.slug === 'honda-civic')!);
    expect(civic).toContain('<td>Touring</td><td>$27,300</td>');
    expect(civic).toContain('<li>1.5 L 4-cyl, Automatic (AV-S7), Front-Wheel Drive, Premium Gasoline</li>');
  });

  it('says what a value rests on and that nothing is checked, and links the method page', () => {
    const pages = buildModelPages(stickers as unknown as Sticker[]);
    for (const p of pages.slice(0, 40)) {
      const html = full(p);
      expect(html).toContain('condition, title, reported accidents, region and the used-car market');
      expect(html).toContain('MiCar checks no record of any car.');
      expect(html).toContain('<a href="../../method/">');
      expect(html).not.toContain('from the sticker price, age, mileage, condition and region.');
    }
  });

  it('llms.txt describes the whole of MiCar and claims no verification', () => {
    const txt = llmsTxt(buildModelPages(stickers as unknown as Sticker[]));
    for (const word of ['Garage', 'MiCar ID', 'passport', 'grade', 'MiCar World', ABOUT_URL, METHOD_URL, 'passport.schema.json', 'method.json']) expect(txt).toContain(word);
    expect(txt).toContain('MiCar has checked no record and no verifier is connected yet');
    expect(txt).toContain('no lookup by VIN or by MiCar ID');
  });

  it('writes a single model year once, never as a range of one', () => {
    expect(yearSpan(2024, 2024)).toBe('2024');
    expect(yearSpan(2010, 2026)).toBe('2010–2026');
    const pages = buildModelPages(stickers as unknown as Sticker[]);
    const index = indexPageHtml(pages, env);
    expect(index).not.toMatch(/(\d{4})–\1\b/);
    for (const p of pages) {
      const html = full(p);
      expect(html).not.toMatch(/(\d{4})–\1\b/);
      expect(html, p.slug).not.toMatch(/for \d{4} model years/);                 // one year is "the 2024 model year"
      expect(html).toContain(p.years.length === 1 ? `for the ${p.years[0].year} model year,` : `model years,`);
    }
  });

  it('names the years MiCar has as runs, so a gap is never hidden inside a span', () => {
    expect(yearRuns([2024, 2012, 2011, 2010])).toBe('2010–2012, 2024');
    expect(yearRuns([2026, 2025, 2024, 2023, 2022, 2020, 2019])).toBe('2019–2020, 2022–2026');
    expect(yearRuns([2018])).toBe('2018');
    expect(yearRuns([2020, 2016, 2015])).toBe('2015–2016, 2020');
    const pages = buildModelPages(stickers as unknown as Sticker[]);
    const index = indexPageHtml(pages, env);
    for (const p of pages) {
      const runs = yearRuns(p.years.map((y) => y.year));
      const html = full(p);
      expect(html, p.slug).toContain(`(${runs})`);                               // the title and the lead sentence
      expect(html, p.slug).toContain(`for the ${runs} model year${p.years.length === 1 ? '' : 's'},`);
      expect(index, p.slug).toContain(`<a href="${p.slug}/">${escapeHtml(p.model)}</a> <span class="muted">${runs}</span>`);
      // every span written for this model covers only years MiCar has
      const have = new Set(p.years.map((y) => y.year));
      for (const m of html.matchAll(/\b(\d{4})–(\d{4})\b/g)) for (let y = +m[1]; y <= +m[2]; y++) expect(have.has(y), `${p.slug} ${m[0]}`).toBe(true);
    }
    const zdx = pages.find((p) => p.slug === 'acura-zdx');
    if (zdx) expect(full(zdx)).toContain('(2010–2012, 2024)');
  });

  it('gives a single price once: "at $X", never "from $X to $X"', () => {
    const one: Sticker[] = [{ make: 'Solo', model: 'One', body: 'Sedan', years: [{ year: 2020, trims: [t('Base', 35000)] }] }];
    const html = modelPageHtml(buildModelPages(one)[0], env);
    expect(html).toContain('at $35,000 before destination');
    expect(html).not.toMatch(/from (\$[\d,]+) to \1\b/);
    for (const p of buildModelPages(stickers as unknown as Sticker[])) expect(full(p), p.slug).not.toMatch(/from (\$[\d,]+) to \1\b/);
  });

  it('describes each model as a Car, never as an offer: MiCar sells no cars, and MSRPs are past sticker prices', () => {
    const pages = buildModelPages(stickers as unknown as Sticker[]);
    for (const p of pages) {
      const ld = [...full(p).matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
      expect(ld.map((x) => x['@type'])).toEqual(['Car', 'BreadcrumbList']);
      expect(ld[0]).toMatchObject({ name: `${p.make} ${p.model}`, brand: { '@type': 'Brand', name: p.make }, model: p.model, bodyType: p.body, url: `${SITE_URL}cars/${p.slug}/` });
      expect(JSON.stringify(ld)).not.toMatch(/"offers"|Offer"|"price|lowPrice|highPrice/);
    }
  });

  it('index, sitemap, robots and llms.txt point at every page', () => {
    const pages = buildModelPages(stickers as unknown as Sticker[]);
    const index = indexPageHtml(pages, env);
    const sitemap = sitemapXml(pages, '2026-11-13');
    for (const p of pages) {
      expect(index).toContain(`href="${p.slug}/"`);
      expect(sitemap).toContain(`<loc>${SITE_URL}cars/${p.slug}/</loc>`);
    }
    expect(sitemap.match(/<url>/g)).toHaveLength(pages.length + 4);
    for (const u of [ABOUT_URL, METHOD_URL]) expect(sitemap).toContain(`<loc>${u}</loc>`);
    expect(robotsTxt()).toContain(`Sitemap: ${SITE_URL}sitemap.xml`);
    expect(llmsTxt(pages)).toMatch(/^# MiCar\n\n> /);
    expect(llmsTxt(pages)).toContain(`${SITE_URL}cars/`);
  });
});
