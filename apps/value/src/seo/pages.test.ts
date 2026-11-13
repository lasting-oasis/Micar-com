import { describe, expect, it } from 'vitest';
import stickers from '../data/stickers.json';
import { bodyPhrase, buildModelPages, escapeHtml, indexPageHtml, jsonLd, llmsTxt, modelPageHtml, robotsTxt, sitemapXml, slugify, SITE_URL, valueLink, yearSpan, type Sticker } from './pages';

const env = { css: ':root{}', footer: '<footer class="mc-foot"></footer>' };
const t = (trim: string, msrp: number) => ({ trim, msrp });

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
      const html = modelPageHtml(p, env);
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
      const lead = modelPageHtml(p, env).match(/<p>The .*? is (an? [^.]+)\. MiCar/)?.[1];
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
    for (const p of pages) expect(modelPageHtml(p, env)).toContain(tag);
  });

  it('writes a single model year once, never as a range of one', () => {
    expect(yearSpan(2024, 2024)).toBe('2024');
    expect(yearSpan(2010, 2026)).toBe('2010–2026');
    const pages = buildModelPages(stickers as unknown as Sticker[]);
    const index = indexPageHtml(pages, env);
    expect(index).not.toMatch(/(\d{4})–\1\b/);
    for (const p of pages) {
      const html = modelPageHtml(p, env);
      expect(html).not.toMatch(/(\d{4})–\1\b/);
      expect(html, p.slug).not.toMatch(/for \d{4} model years/);                 // one year is "the 2024 model year"
      expect(html).toContain(p.years.length === 1 ? `for the ${p.years[0].year} model year,` : `model years,`);
    }
  });

  it('describes each model as a Car, never as an offer: MiCar sells no cars, and MSRPs are past sticker prices', () => {
    const pages = buildModelPages(stickers as unknown as Sticker[]);
    for (const p of pages) {
      const ld = [...modelPageHtml(p, env).matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
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
    expect(sitemap.match(/<url>/g)).toHaveLength(pages.length + 2);
    expect(robotsTxt()).toContain(`Sitemap: ${SITE_URL}sitemap.xml`);
    expect(llmsTxt(pages)).toMatch(/^# MiCar\n\n> /);
    expect(llmsTxt(pages)).toContain(`${SITE_URL}cars/`);
  });
});
