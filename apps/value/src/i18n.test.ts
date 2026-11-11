// Spanish coverage. Fails when the code, a data table or the engine produces English text
// that the Spanish table can't translate, or when a translation drops or invents a {placeholder}.
import { describe, expect, it } from 'vitest';
import { ACCIDENTS, BODY_STYLES, CONDITIONS, MAKES, REGIONS, SEGMENT_LABELS, TITLES } from './engine/data';
import { describe as describeListings, type ParseResult } from './engine/listings';
import { marketNote } from './engine/market';
import { CALIBRATION, MODELS } from './engine/models';
import { TRAIT_NOTES } from './engine/models';
import { prefillMsrp } from './engine/prefill';
import { STICKERS } from './engine/stickers';
import { RAISE_BY_VERIFIER, RAISE_IN_GARAGE } from './door/card';
import { valuate, type Inputs } from './engine/valuation';
import { DEFAULT_WARRANTY, FEATURES, FEATURE_GROUPS } from './car/record';
import { MARKET_OPTIONS, URGENCY_OPTIONS, defaults, parse } from './urlState';
import { ES, ES_ENGINE } from './i18n-es';

const sources = import.meta.glob(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./i18n*'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('Spanish table', () => {
  it('has every string the code passes to t() or tx()', () => {
    const pat = /\b(?:t|tx)\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\$])*)`)/g;
    const missing: string[] = [];
    let found = 0;
    for (const [file, src] of Object.entries(sources)) {
      for (const m of src.matchAll(pat)) {
        const key = (m[1] ?? m[2] ?? m[3]).replace(/\\(['"\\])/g, '$1');
        found++;
        if (!(key in ES)) missing.push(`${file}: ${key}`);
      }
    }
    expect(found).toBeGreaterThan(250);
    expect(missing).toEqual([]);
  });

  it('keeps the same placeholders in every translation', () => {
    const bad = Object.entries(ES).filter(([en, es]) => placeholders(en) !== placeholders(es)).map(([en]) => en);
    expect(bad).toEqual([]);
  });

  it('has every label that comes from a data table', () => {
    const keys = [
      ...CONDITIONS.flatMap((o) => [o.name, o.desc]), ...TITLES.flatMap((o) => [o.name, o.desc]), ...ACCIDENTS.flatMap((o) => [o.name, o.desc]),
      ...BODY_STYLES.map((b) => b.name), ...REGIONS, ...Object.values(SEGMENT_LABELS),
      ...MARKET_OPTIONS.filter((o) => o.value !== 'auto').flatMap((o) => [o.name, o.desc]), 'Auto', ...URGENCY_OPTIONS.flatMap((o) => [o.name, o.desc]),
      ...FEATURES.map((f) => f.label), ...FEATURE_GROUPS, DEFAULT_WARRANTY, 'Enter a 5-digit ZIP first.', 'Lookup failed.',
      ...Object.values(TRAIT_NOTES),
      // The home page's starting grade: how each category it cannot know is raised.
      RAISE_IN_GARAGE, RAISE_BY_VERIFIER,
    ];
    expect(keys.filter((k) => !(k in ES))).toEqual([]);
    expect(MAKES.some((m) => m.name === 'Other')).toBe(true);
  });
});

describe('engine text in Spanish', () => {
  const now = new Date('2026-11-03');
  const untranslated: string[] = [];
  const check = (kind: keyof typeof ES_ENGINE, s: string) => { if (ES_ENGINE[kind](s) === s) untranslated.push(`${kind}: ${s}`); };

  it('translates every ledger line, reason and driver across a sweep of cars and settings', () => {
    const picks = [
      ...MODELS.filter((m, i) => !m.source && i % 3 === 0),
      ...MODELS.filter((m) => m.calibrated),
      ...MODELS.filter((m) => m.source === 'epa').slice(0, 12),
    ];
    const markets = ['auto', 'soft', 'normal', 'tight'] as const;
    let n = 0;
    for (const [i, m] of picks.entries()) {
      for (const [j, year] of [2012, 2019, 2025].entries()) {
        const k = i + j;
        const mk = markets[k % 4];
        const input: Inputs = {
          make: k % 17 === 0 ? 'Other' : m.make, model: k % 11 === 0 ? '' : m.model, trim: '', body: BODY_STYLES[k % BODY_STYLES.length].name,
          msrp: 20000 + (k % 9) * 7000, year, mileage: [500, 30000, 160000, 0][k % 4], baseMsrp: k % 2 ? 18000 : undefined,
          condition: CONDITIONS[k % 4].name, title: TITLES[k % 3].name, accident: ACCIDENTS[k % 3].name, region: REGIONS[k % 5],
          market: mk === 'auto' ? 'normal' : mk, marketIndex: mk === 'auto' ? 0.4 : null,
          marketNote: mk === 'auto' ? marketNote() : undefined,
          listings: [null, 3, 10, 60][k % 4], urgency: (['none', 'month', 'week'] as const)[k % 3],
          comps: [[], [21000], [19000, 21000, 23000, 900000]][k % 3],
        };
        const v = valuate(input, now);
        n++;
        v.steps.forEach((s, idx) => {
          if (!(s.label in ES)) untranslated.push(`label: ${s.label}`);
          if (idx === 0 && input.model) return; // "2019 Honda Civic" is a name
          for (const part of s.detail.split(' · ')) check('detail', part);
        });
        v.confidenceReasons.forEach((r) => check('reason', r));
        v.drivers.forEach((d) => check('driver', d));
      }
    }
    expect(n).toBeGreaterThan(150);
    expect([...new Set(untranslated)]).toEqual([]);
  });

  it('translates the market note, the MSRP hint and form errors', () => {
    const auto = MARKET_OPTIONS.find((o) => o.value === 'auto')!;
    check('market', auto.desc);
    check('detail', marketNote());
    // every sticker source format, every model with prices on file
    for (const set of STICKERS) for (const y of set.years.slice(0, 3)) {
      const p = prefillMsrp(set.make, set.model, y.year, y.trims[0].trim);
      if (p) check('prefill', p.label);
    }
    const typical = MODELS.find((m) => m.source === 'epa')!;
    check('prefill', prefillMsrp(typical.make, typical.model, 2015, '')!.label);
    const { errors } = parse({ ...defaults(now), msrp: '5', year: '1980', mileage: '-4', listings: 'x', zip: '123' }, now);
    expect(Object.keys(errors).sort()).toEqual(['listings', 'mileage', 'msrp', 'year', 'zip']);
    Object.values(errors).forEach((e) => check('error', e!));
    expect([...new Set(untranslated)]).toEqual([]);
  });

  it('translates the pasted-listings summary', () => {
    const listing = (year?: number, miles?: number) => ({ price: 20000, year, miles }) as ParseResult['listings'][number];
    const skip = (a: number, b: number, c: number, d: number) => ({ otherModels: a, otherYears: b, payments: c, duplicates: d });
    const results = [
      { listings: [], resultCount: null, source: null, skipped: skip(0, 0, 0, 0) },
      { listings: [listing(2019, 40000)], resultCount: null, source: null, skipped: skip(1, 1, 1, 1) },
      { listings: [listing(2017, 50000), listing(2020, 30000), listing()], resultCount: 340, source: 'Cars.com', skipped: skip(2, 3, 4, 5) },
    ] as unknown as ParseResult[];
    for (const r of results) for (const part of describeListings(r, 'Civic').split(' · ')) check('listings', part);
    expect(ES_ENGINE.listings(describeListings(results[2], 'Civic'))).toBe('3 anuncios de 340 en Cars.com · Civic 2017–2020 · precio pedido mediano $20,000 · millaje mediano 40k mi · se omitieron 2 de otros modelos, 3 de otros años, 4 cifras de pago o descuento, 5 duplicados');
    expect([...new Set(untranslated)]).toEqual([]);
  });

  it('reads naturally on a real example', () => {
    expect(ES_ENGINE.detail('4.4 yrs old · this model typically sells for ~64% of a new one\'s price after 5 yrs · trim content above the base car keeps 50% of that'))
      .toBe('4.4 años de antigüedad · este modelo suele venderse por ~64% del precio de uno nuevo a los 5 años · el equipamiento por encima de la versión base conserva el 50% de eso');
    expect(ES_ENGINE.detail('2019 Other Sedan')).toBe('Sedán de otra marca 2019');
    expect(ES_ENGINE.reason('Resale curve fitted to 55 real Civic listings (typical miss 7%)')).toBe('Curva de reventa ajustada con 55 anuncios reales del Civic (error típico del 7%)');
    expect(CALIBRATION.models.length).toBeGreaterThan(0);
  });
});
