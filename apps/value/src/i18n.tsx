// Site language: English (default) or Spanish.
// Text is written in English in the code and looked up in the Spanish table (src/i18n-es.ts)
// at render time. Text the pricing engine writes (ledger lines, confidence reasons, market
// note...) is translated by pattern through te.*, so the engine itself stays language-free.
// The first visit follows the browser's language; the EN/ESP switch is remembered.
import { Fragment, useSyncExternalStore, type ReactNode } from 'react';
import { periodLabel } from './engine/market';
import { ES, ES_ENGINE, ES_MONTHS, esBody } from './i18n-es';

export type Lang = 'en' | 'es';
const KEY = 'nexus.lang';

const fromQuery = (): Lang | null => { try { const q = new URLSearchParams(window.location.search).get('lang'); return q === 'en' || q === 'es' ? q : null; } catch { return null; } };
const fromStorage = (): Lang | null => { try { const s = localStorage.getItem(KEY); return s === 'en' || s === 'es' ? s : null; } catch { return null; } };
const fromBrowser = (): Lang => { try { return /^es\b/i.test(navigator.languages?.[0] ?? navigator.language ?? '') ? 'es' : 'en'; } catch { return 'en'; } };

let current: Lang = fromQuery() ?? fromStorage() ?? fromBrowser();
const listeners = new Set<() => void>();
const mark = () => { try { document.documentElement.lang = current; } catch { /* no DOM (tests) */ } };
mark();

export const getLang = (): Lang => current;
/** True once the viewer has picked a language themselves (the switch, or ?lang= in the link). */
export const langChosen = (): boolean => fromQuery() !== null || fromStorage() !== null;
/** Switch language. `remember: false` follows a car sheet's language without overriding the viewer's own choice later. */
export function setLang(lang: Lang, remember = true) {
  if (remember) { try { localStorage.setItem(KEY, lang); } catch { /* private window */ } }
  if (lang === current) return;
  current = lang;
  mark();
  listeners.forEach((f) => f());
}
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
/** Re-renders the caller when the language changes. The router calls it, so the whole page follows. */
export const useLang = (): Lang => useSyncExternalStore(subscribe, getLang, getLang);

const look = (en: string): string => (current === 'es' ? ES[en] ?? en : en);
const fill = (s: string, vars?: Record<string, string | number>) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

/** Translate an English string; {name} placeholders are filled from `vars`. */
export const t = (en: string, vars?: Record<string, string | number>): string => fill(look(en), vars);

/** Like t(), with React elements (bold numbers, links) dropped into the placeholders. */
export function tx(en: string, vars: Record<string, ReactNode>): ReactNode {
  return look(en).split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <Fragment key={i}>{vars[part]}</Fragment> : part));
}

const engine = (kind: keyof typeof ES_ENGINE) => (s: string): string => (current === 'es' && s ? ES_ENGINE[kind](s) : s);
/** Text written by the engine and data files, by where it comes from. English passes through. */
export const te = {
  label: engine('label'), detail: engine('detail'), reason: engine('reason'), driver: engine('driver'),
  listings: engine('listings'), prefill: engine('prefill'), error: engine('error'), market: engine('market'),
};

export const locale = (): string => (current === 'es' ? 'es-US' : 'en-US');
/** "November 2026" / "noviembre de 2026" */
export const monthYear = (d: Date): string => d.toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
/** A BLS data month ("2026-09") as "Sep 2026" / "sep 2026". */
export function period(p: string): string {
  if (current !== 'es') return periodLabel(p);
  const [y, m] = p.split('-').map(Number);
  return `${ES_MONTHS[(m || 1) - 1]} ${y}`;
}

const EN_BODY: Record<string, [short: string, one: string, many: string]> = {
  'Sedan': ['sedan', 'sedan', 'sedans'],
  'SUV / Crossover': ['SUV', 'SUV', 'SUVs'],
  'Pickup Truck': ['pickup', 'pickup', 'pickups'],
  'Coupe / Sports': ['coupe', 'coupe', 'coupes'],
  'Hatchback / Wagon': ['hatchback', 'hatchback or wagon', 'hatchbacks and wagons'],
  'Minivan': ['minivan', 'minivan', 'minivans'],
};

/** Ready-made phrases about a body style, so sentences agree in number and (in Spanish) gender. */
export type BodyWords = {
  /** Bar label: "Typical SUV" / "SUV típica" */
  typical: string;
  /** "a typical SUV" / "una SUV típica" */
  typicalOne: string;
  /** "SUVs" / "las SUV" */
  group: string;
  /** Bar label: "Honda SUVs" / "SUV de Honda" */
  makeGroup: string;
  /** In a sentence: "Honda SUVs" / "las SUV de Honda" */
  makeGroupIn: string;
};
export function bodyWords(body: string, make: string): BodyWords {
  if (current === 'es') return esBody(body, make);
  const [short, one, many] = EN_BODY[body] ?? ['car', 'car', 'cars'];
  return { typical: `Typical ${short}`, typicalOne: `a typical ${one}`, group: many, makeGroup: `${make} ${many}`, makeGroupIn: `${make} ${many}` };
}
