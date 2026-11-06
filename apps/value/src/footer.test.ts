// The shared footer's data and static renderers (packages/brand). Reads Door.tsx and footer.css with ?raw, not node:fs,
// because tsc -b compiles value's tests without Node types.
import { describe, expect, it } from 'vitest';
import { SITE_URL } from '@micar/brand';
import {
  FOOTER_COLUMNS,
  FOOTER_ESTIMATES,
  FOOTER_SOON,
  GARAGE_LANG_SCRIPT,
  REPO_URL,
  footerCopyright,
  footerHtml,
  garagePageHtml,
  type FooterLang,
} from '@micar/brand/footer';
import footerCss from '@micar/brand/footer.css?raw';
import doorSource from './door/Door.tsx?raw';
import indexCss from './index.css?raw';
import buildSite from '../../../tools/build-site.sh?raw';
import { routeFromHash } from './route';

const links = FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => ({ col: c.id, ...l })));
const find = (id: string) => links.find((l) => l.id === id)!;

describe('footer data', () => {
  it("footer links match the spec's table", () => {
    expect(links.map((l) => [l.col, l.id, l.href])).toEqual([
      ['micar', 'home', 'https://lasting-oasis.github.io/Micar-com/'],
      ['value', 'value', 'https://lasting-oasis.github.io/Micar-com/#/value'],
      ['value', 'sheet', 'https://lasting-oasis.github.io/Micar-com/#/sticker'],
      ['value', 'grade', 'https://lasting-oasis.github.io/Micar-com/#grade'],
      ['world', 'world', 'https://micar-sim.onrender.com/'],
      ['world', 'strip', 'https://micar-sim.onrender.com/strip'],
      ['world', 'shop', 'https://micar-sim.onrender.com/shop'],
      ['world', 'garage', 'https://lasting-oasis.github.io/Micar-com/garage/'],
      ['about', 'built', 'https://github.com/lasting-oasis/Micar-com'],
      ['about', 'keyholder', 'https://lasting-oasis.github.io/Micar-com/#keyholder'],
    ]);
    expect(FOOTER_COLUMNS.map((c) => c.id)).toEqual(['micar', 'value', 'world', 'about']);
    expect(REPO_URL).toBe('https://github.com/lasting-oasis/Micar-com');
  });

  it('every label has both languages', () => {
    const texts = [
      ...FOOTER_COLUMNS.flatMap((c) => [c.title, ...(c.blurb ? [c.blurb] : []), ...c.links.map((l) => l.label)]),
      FOOTER_SOON,
      FOOTER_ESTIMATES,
    ];
    for (const t of texts) {
      expect(t.en.trim()).not.toBe('');
      expect(t.es.trim()).not.toBe('');
    }
  });

  it('exact copy', () => {
    expect(find('built').label.es).toBe('Cómo está hecho');
    expect(find('strip').label.es).toBe('Entra al Strip');
    expect(find('home').label.es).toBe('Inicio');
    const blurb = FOOTER_COLUMNS[0].blurb!;
    expect(blurb.en).toBe('Said MEE-car. One brand: the value, the card, the garage, the world. Charlotte, NC.');
    expect(blurb.es).toBe('Se dice MI-car. Una marca: el valor, la tarjeta, el garaje, el mundo. Charlotte, NC.');
    expect(FOOTER_ESTIMATES.en).toBe('Values are estimates, not appraisals or offers to buy.');
    expect(FOOTER_ESTIMATES.es).toBe('Los valores son estimaciones, no avalúos ni ofertas de compra.');
    expect(FOOTER_SOON).toEqual({ en: 'soon', es: 'pronto' });
  });

  it('only the source link opens a new tab, only Garage is soon', () => {
    expect(links.filter((l) => l.external).map((l) => l.id)).toEqual(['built']);
    expect(links.filter((l) => l.soon).map((l) => l.id)).toEqual(['garage']);
  });

  it('site routes resolve', () => {
    const routes = links.filter((l) => l.href.startsWith(`${SITE_URL}#/`));
    expect(routes.length).toBeGreaterThan(0);
    for (const l of routes) {
      expect(routeFromHash(l.href.slice(SITE_URL.length), '').view, l.href).not.toBe('door');
    }
  });

  it('door sections exist', () => {
    const anchors = links.filter((l) => /^#[A-Za-z]/.test(l.href.slice(SITE_URL.length)));
    expect(anchors.length).toBeGreaterThan(0);
    for (const l of anchors) {
      const id = l.href.slice(SITE_URL.length + 1);
      expect(doorSource, l.href).toContain(`id="${id}"`);
    }
  });

  it('footerCopyright', () => {
    expect(footerCopyright(2031)).toBe('© 2031 MiCar');
  });
});

describe('footerHtml', () => {
  it('renders Spanish', () => {
    const html = footerHtml('es', 2031);
    expect(html.startsWith('<footer class="mc-foot">')).toBe(true);
    for (const l of links) {
      expect(html).toContain(`href="${l.href}"`);
      expect(html).toContain(l.label.es.replace(/'/g, '&#39;'));
    }
    expect(html).toContain('© 2031 MiCar');
    expect(html).toContain(FOOTER_ESTIMATES.es);
    expect(html).toContain('<em>pronto</em>');
    expect(html).not.toContain('The grade');
  });

  it('renders English and escapes text', () => {
    const html = footerHtml('en', 2031);
    expect(html).toContain('How it&#39;s built');
    expect(html).not.toContain("How it's built");
    expect(html).toContain('<em>soon</em>');
    // The escaper covers all five characters; check it through a label that carries them.
    const tricky = FOOTER_COLUMNS[0].links[0].label;
    const saved = tricky.en;
    tricky.en = `<a href="x">&'</a>`;
    try {
      expect(footerHtml('en', 2031)).toContain('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    } finally {
      tricky.en = saved;
    }
  });

  it('the source link opens a new tab safely', () => {
    expect(footerHtml('en', 2031)).toContain(`<a href="${REPO_URL}" target="_blank" rel="noreferrer">`);
  });
});

describe('garagePageHtml', () => {
  const template = '<style>/* css */</style><!-- footer -->';

  it('inlines the css and both footers, Spanish hidden, plus the script', () => {
    const html = garagePageHtml(template, '.x{content:"$&"}', 2031);
    expect(html.match(/<footer class="mc-foot">/g)).toHaveLength(2);
    expect(html).toContain('<div id="mc-foot-en"><footer class="mc-foot">');
    expect(html).toContain('<div id="mc-foot-es" hidden><footer class="mc-foot">');
    expect(html).toContain('<style>.x{content:"$&"}</style>');
    expect(html).toContain(`<script>${GARAGE_LANG_SCRIPT}</script>`);
    expect(html).not.toContain('<!-- footer -->');
  });

  it('throws without its markers', () => {
    expect(() => garagePageHtml('<style>/* css */</style>', '', 2031)).toThrow(/footer/);
    expect(() => garagePageHtml('<!-- footer -->', '', 2031)).toThrow(/css/);
  });
});

describe('GARAGE_LANG_SCRIPT', () => {
  function run(opts: { search?: string; stored?: string | 'throw'; browser?: string }): FooterLang {
    const hidden: Record<string, boolean> = { 'mc-foot-en': false, 'mc-foot-es': true };
    const document = { getElementById: (id: string) => ({ set hidden(v: boolean) { hidden[id] = v; } }) };
    const localStorage = {
      getItem: (k: string) => {
        if (opts.stored === 'throw') throw new Error('blocked');
        return k === 'nexus.lang' ? (opts.stored ?? null) : null;
      },
    };
    const navigator = { languages: [opts.browser ?? 'en-US'], language: opts.browser ?? 'en-US' };
    new Function('location', 'localStorage', 'navigator', 'document', GARAGE_LANG_SCRIPT)({ search: opts.search ?? '' }, localStorage, navigator, document);
    return hidden['mc-foot-es'] === false && hidden['mc-foot-en'] === true ? 'es' : 'en';
  }

  it('?lang beats storage and browser', () => expect(run({ search: '?lang=es', stored: 'en', browser: 'en-US' })).toBe('es'));
  it('stored language beats the browser', () => expect(run({ stored: 'es', browser: 'en-US' })).toBe('es'));
  it('browser Spanish', () => expect(run({ browser: 'es-MX' })).toBe('es'));
  it('browser English', () => expect(run({ browser: 'en-US' })).toBe('en'));
  it('blocked storage does not throw', () => expect(run({ stored: 'throw', browser: 'en-US' })).toBe('en'));
});

describe('footer.css', () => {
  it('has safe-area padding, print rule and no bare .mc-foot p', () => {
    expect(footerCss).toContain('safe-area-inset-left');
    expect(footerCss).toContain('safe-area-inset-right');
    expect(footerCss).toContain('@media print');
    expect(footerCss).not.toMatch(/\.mc-foot\s+p\b/);
  });
});

describe('value index.css', () => {
  it('bleed cancels the body padding', () => {
    const rule = indexCss.match(/\.mc-foot-bleed\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('margin-left: calc(-1 * max(16px, env(safe-area-inset-left, 0px)))');
    expect(rule).toContain('margin-right: calc(-1 * max(16px, env(safe-area-inset-right, 0px)))');
    expect(rule).not.toContain('100vw');
  });
});

describe('build-site.sh', () => {
  it("the Garage link's page is really built", () => {
    const lines = buildSite.split(/\r?\n/);
    expect(lines.some((l) => !l.trimStart().startsWith('#') && l.includes('tools/build-garage.ts'))).toBe(true);
    expect(lines.some((l) => l.includes(`grep -q '<footer class="mc-foot"' site/garage/index.html`))).toBe(true);
  });
});
