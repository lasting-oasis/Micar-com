// The plain-HTML pages in two languages. Text is written in English in the code and looked up at build time: first
// in the pages' own table (seo/es.ts), then in the site's (i18n-es.ts), so a label the app already translates reads
// the same on a plain page. A key is the English text, HTML and {placeholders} included. English pages are served at
// the site's root and Spanish ones under es/.
import { ES } from '../i18n-es';
import { SEO_ES } from './es';

export type Lang = 'en' | 'es';
export const LANGS: readonly Lang[] = ['en', 'es'];
/** Every English text a Spanish page asked for and found in neither table. The tests keep this empty. */
export const missed = new Set<string>();

const fill = (s: string, vars?: Record<string, string | number>) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

export type T = (en: string, vars?: Record<string, string | number>) => string;
export function tr(lang: Lang): T {
  return (en, vars) => {
    if (lang === 'en') return fill(en, vars);
    const es = SEO_ES[en] ?? ES[en];
    if (es === undefined) missed.add(en);
    return fill(es ?? en, vars);
  };
}

/** The folder a language's pages live in, with its slash: '' for English, 'es/' for Spanish. */
export const langDir = (lang: Lang): string => (lang === 'es' ? 'es/' : '');
/** The query that opens the app in a page's language ('' for English, the app's own default). */
export const appLang = (lang: Lang): string => (lang === 'es' ? '?lang=es' : '');
