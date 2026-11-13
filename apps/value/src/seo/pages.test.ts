import { describe, expect, it } from 'vitest';
import stickers from '../data/stickers.json';
import { buildModelPages, escapeHtml, indexPageHtml, jsonLd, llmsTxt, modelPageHtml, robotsTxt, sitemapXml, slugify, SITE_URL, valueLink, type Sticker } from './pages';

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
