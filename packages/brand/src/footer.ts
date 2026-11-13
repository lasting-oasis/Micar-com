// The shared site footer: its links, its words in both languages, and the static renderers.
// Plain data and strings, no React: each app renders FOOTER_COLUMNS with its own React and useLang,
// and the static /garage/ page (no React, no dictionary; it forwards to the Garage in the app) is generated from footerHtml.
import { SHOP_URL, SITE_URL, WORLD_URL } from './doors';

export type FooterLang = 'en' | 'es';
export type FooterText = Record<FooterLang, string>;
export type FooterLink = { id: string; label: FooterText; href: string; soon?: boolean; external?: boolean };
export type FooterColumn = { id: string; title: FooterText; blurb?: FooterText; links: FooterLink[] };

export const REPO_URL = 'https://github.com/lasting-oasis/Micar-com';

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    id: 'micar',
    title: { en: 'MiCar', es: 'MiCar' },
    blurb: {
      en: 'Said MEE-car. One brand: the value, the card, the garage, the world. Charlotte, NC.',
      es: 'Se dice MI-car. Una marca: el valor, la tarjeta, el garaje, el mundo. Charlotte, NC.',
    },
    links: [{ id: 'home', label: { en: 'Home', es: 'Inicio' }, href: SITE_URL }],
  },
  {
    id: 'value',
    title: { en: 'Value', es: 'Valor' },
    links: [
      { id: 'value', label: { en: 'Value a car', es: 'Calcular el valor' }, href: `${SITE_URL}#/value` },
      { id: 'sheet', label: { en: 'Window sheet', es: 'Hoja de ventana' }, href: `${SITE_URL}#/sticker` },
      { id: 'grade', label: { en: 'The grade', es: 'La calificación' }, href: `${SITE_URL}#grade` },
    ],
  },
  {
    id: 'world',
    title: { en: 'World', es: 'Mundo' },
    links: [
      { id: 'world', label: { en: 'MiCar World', es: 'MiCar World' }, href: WORLD_URL },
      { id: 'strip', label: { en: 'Enter the Strip', es: 'Entra al Strip' }, href: `${WORLD_URL}strip` },
      { id: 'shop', label: { en: 'MiCar Shop', es: 'MiCar Shop' }, href: SHOP_URL },
      { id: 'garage', label: { en: 'Garage', es: 'Garaje' }, href: `${SITE_URL}#/garage` },
    ],
  },
  {
    id: 'about',
    title: { en: 'About', es: 'Acerca de' },
    links: [
      { id: 'built', label: { en: "How it's built", es: 'Cómo está hecho' }, href: REPO_URL, external: true },
      { id: 'keyholder', label: { en: 'Keyholder', es: 'Keyholder' }, href: `${SITE_URL}#keyholder` },
    ],
  },
];

export const FOOTER_SOON: FooterText = { en: 'soon', es: 'pronto' };
export const FOOTER_ESTIMATES: FooterText = {
  en: 'Values are estimates, not appraisals or offers to buy.',
  es: 'Los valores son estimaciones, no avalúos ni ofertas de compra.',
};

/** The credit Searlo's open-source plan asks for, wherever its dealer-listing data is used: the same words in both
 *  languages, since it is the name of their credit line. */
export const DATA_CREDIT = { label: 'Vehicle data by Searlo', href: 'https://searlo.tech/' } as const;

export function footerCopyright(year: number): string {
  return `© ${year} MiCar`;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

export function footerHtml(lang: FooterLang, year: number): string {
  const cols = FOOTER_COLUMNS.map((col) => {
    const links = col.links
      .map((l) => {
        const ext = l.external ? ' target="_blank" rel="noreferrer"' : '';
        const soon = l.soon ? `<em>${esc(FOOTER_SOON[lang])}</em>` : '';
        return `<a href="${esc(l.href)}"${ext}>${esc(l.label[lang])}${soon}</a>`;
      })
      .join('');
    const blurb = col.blurb ? `<p class="mc-foot-blurb">${esc(col.blurb[lang])}</p>` : '';
    return `<div class="mc-foot-col"><p class="mc-foot-h">${esc(col.title[lang])}</p>${blurb}<div class="mc-foot-links">${links}</div></div>`;
  }).join('');
  const credit = `<a class="mc-foot-credit" href="${esc(DATA_CREDIT.href)}" target="_blank" rel="noreferrer">${esc(DATA_CREDIT.label)}</a>`;
  const legal = `<div class="mc-foot-legal"><span>${esc(footerCopyright(year))}</span><span>${esc(FOOTER_ESTIMATES[lang])}</span>${credit}</div>`;
  return `<footer class="mc-foot"><div class="mc-foot-in"><div class="mc-foot-cols">${cols}</div>${legal}</div></footer>`;
}

// Runs inline on the Garage page. Same order as value's i18n: ?lang=, then nexus.lang, then the browser's language.
// Receives location, localStorage, navigator and document as parameters (so tests can fake them).
export const GARAGE_LANG_SCRIPT = `(function () {
  var lang = null;
  try {
    var q = new URLSearchParams(location.search).get('lang');
    if (q === 'en' || q === 'es') lang = q;
  } catch (e) {}
  if (!lang) {
    try {
      var s = localStorage.getItem('nexus.lang');
      if (s === 'en' || s === 'es') lang = s;
    } catch (e) {}
  }
  if (!lang) {
    var n = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    lang = /^es\\b/i.test(n) ? 'es' : 'en';
  }
  if (lang === 'es') {
    var en = document.getElementById('mc-foot-en');
    var es = document.getElementById('mc-foot-es');
    if (en) en.hidden = true;
    if (es) es.hidden = false;
  }
})();`;

const CSS_MARKER = '/* css */';
const FOOTER_MARKER = '<!-- footer -->';

export function garagePageHtml(template: string, css: string, year: number): string {
  if (!template.includes(FOOTER_MARKER)) throw new Error(`garage template has no ${FOOTER_MARKER} marker`);
  if (!template.includes(CSS_MARKER)) throw new Error(`garage template has no ${CSS_MARKER} marker`);
  const block =
    `<div id="mc-foot-en">${footerHtml('en', year)}</div>` +
    `<div id="mc-foot-es" lang="es" hidden>${footerHtml('es', year)}</div>` +
    `<script>${GARAGE_LANG_SCRIPT}</script>`;
  return template.replace(CSS_MARKER, () => css).replace(FOOTER_MARKER, () => block);
}
