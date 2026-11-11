import { describe, expect, it } from 'vitest';
import { CATALOGUE, EXAMPLES, catalogueEntry, catalogueMatch, findCatalogue } from './database';
import { baseStats, powerRating } from './normalize';
import { parseSpec } from './specs';
import { ATTRIBUTE_KEYS } from './types';
import type { Sourced, SpecField, VehicleSpec } from './types';
import { isIsoDate } from './util';

const fields = (spec: VehicleSpec): [SpecField, Sourced<unknown>][] =>
  (Object.keys(spec) as (keyof VehicleSpec)[]).filter((k): k is SpecField => k !== 'identity' && spec[k] !== null).map((k) => [k, spec[k] as Sourced<unknown>]);

describe('the reference catalogue', () => {
  it('holds real vehicles, each with a unique id', () => {
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(3);
    expect(new Set(CATALOGUE.map((e) => e.id)).size).toBe(CATALOGUE.length);
    for (const e of CATALOGUE) { expect(e.status).toBe('reference'); expect(isIsoDate(e.asOf)).toBe(true); expect(e.note).toMatch(/not|No figure/i); }
  });

  it('claims nothing it cannot back: every figure is reference data with a publisher and a link', () => {
    for (const e of CATALOGUE) {
      const cells = fields(e.spec);
      expect(cells.length, e.id).toBeGreaterThan(8);
      for (const [field, cell] of cells) {
        expect(cell.source.kind, `${e.id} ${field}`).toBe('reference');
        expect(cell.source.name, `${e.id} ${field}`).toBeTruthy();
        expect(cell.source.url, `${e.id} ${field}`).toMatch(/^https?:\/\//);
        // A figure is dated the day it was gathered: the entry's own day, or a later one when a narrower search filled a blank.
        expect(isIsoDate(cell.source.asOf), `${e.id} ${field}`).toBe(true);
        expect(cell.source.asOf >= e.asOf, `${e.id} ${field}`).toBe(true);
      }
    }
  });

  it('passes the engine’s own parser unchanged, so nothing in it is out of range', () => {
    for (const e of CATALOGUE) {
      const read = parseSpec(JSON.parse(JSON.stringify(e.spec)), 2026);
      expect(read.issues, e.id).toEqual([]);
      expect(read.spec, e.id).toEqual(e.spec);
    }
  });

  it('carries no price anywhere', () => {
    // A source's address is not the catalogue's own words: a review's URL can carry "price" in its slug.
    const words = JSON.stringify(CATALOGUE, (key, value: unknown) => (key === 'url' ? undefined : value));
    expect(words).not.toMatch(/msrp|price|"\$|usd/i);
  });

  it('scores the GT-R NISMO at exactly the brief’s example', () => {
    const gtr = catalogueEntry('2024-nissan-gt-r-nismo');
    expect(gtr).not.toBeNull();
    const layer = baseStats((gtr as NonNullable<typeof gtr>).spec);
    expect(ATTRIBUTE_KEYS.map((k) => layer.scores[k].value)).toEqual([950, 920, 880, 880, 650, 700, 500]);
    expect(layer.powerRating).toBe(783);
  });

  it('puts the Civic below the GT-R in performance and above it in reliability and efficiency', () => {
    const gtr = baseStats((catalogueEntry('2024-nissan-gt-r-nismo') as NonNullable<ReturnType<typeof catalogueEntry>>).spec).scores;
    const civic = baseStats((catalogueEntry('2024-honda-civic-sedan-lx') as NonNullable<ReturnType<typeof catalogueEntry>>).spec).scores;
    for (const k of ['power', 'speed', 'acceleration', 'handling'] as const) expect(gtr[k].value as number).toBeGreaterThan((civic[k].value as number) + 250);
    expect(civic.reliability.value as number).toBeGreaterThan(gtr.reliability.value as number);
    expect(civic.efficiency.value as number).toBeGreaterThan(gtr.efficiency.value as number);
  });

  it('leaves a score empty where the research found no figure, rather than fill it in', () => {
    // No source turned up for the Prius's induction, so its reliability is not rated.
    const prius = catalogueEntry('2024-toyota-prius-le-fwd');
    expect(prius).not.toBeNull();
    const spec = (prius as NonNullable<typeof prius>).spec;
    expect(spec.induction).toBeNull();
    expect(spec.torqueLbFt).toBeNull();
    const layer = baseStats(spec);
    expect(layer.scores.reliability.value).toBeNull();
    expect(layer.scores.reliability.missing).toContain('induction');
    expect(layer.powerRating).toBeNull();
    expect(layer.provisionalRating).not.toBeNull();
  });
});

describe('finding a vehicle', () => {
  it('ignores case and punctuation and knows Chevy is Chevrolet', () => {
    expect(findCatalogue({ make: 'nissan', model: 'gtr' }).map((e) => e.id)).toEqual(['2024-nissan-gt-r-nismo']);
    expect(findCatalogue({ make: 'Nissan', model: 'GT-R', year: 2024 })).toHaveLength(1);
    expect(findCatalogue({ make: 'Nissan', model: 'GT-R', year: 2019 })).toEqual([]);
    expect(findCatalogue({ make: 'Honda', model: 'Civic', trim: 'lx' })).toHaveLength(1);
    expect(findCatalogue({ make: 'Honda', model: 'Civic', trim: 'type r' })).toEqual([]);
    expect(findCatalogue({ make: 'Zork' })).toEqual([]);
    expect(findCatalogue({}).length).toBe(CATALOGUE.length);
    expect(catalogueEntry('nope')).toBeNull();
  });

  it('lists the newest first', () => {
    const years = findCatalogue({}).map((e) => e.spec.identity.year);
    expect(years).toEqual(years.slice().sort((a, b) => b - a));
  });
});

describe('recognising the catalogue’s own figures', () => {
  it('matches an entry copied as it stands, whoever is named as its source', () => {
    for (const entry of CATALOGUE) {
      expect(catalogueMatch(entry.spec)?.id).toBe(entry.id);
      // An owner who parks a car from the catalogue holds the same figures under their own name.
      const copy = JSON.parse(JSON.stringify(entry.spec)) as VehicleSpec;
      for (const field of Object.keys(copy) as (keyof VehicleSpec)[]) {
        const cell = copy[field];
        if (field !== 'identity' && cell !== null) (cell as Sourced<unknown>).source = { kind: 'owner' };
      }
      expect(catalogueMatch(copy)?.id).toBe(entry.id);
    }
  });

  it('does not match once any figure is changed, added or removed, or the identity differs', () => {
    const entry = CATALOGUE[0];
    const owner = { kind: 'owner' } as const;
    const hp = entry.spec.horsepower as Sourced<number>;
    expect(catalogueMatch({ ...entry.spec, horsepower: { value: hp.value + 1, source: hp.source } })).toBeNull();
    expect(catalogueMatch({ ...entry.spec, horsepower: null })).toBeNull();
    const empty = (Object.keys(entry.spec) as (keyof VehicleSpec)[]).filter((f) => f !== 'identity' && entry.spec[f] === null)[0] as SpecField | undefined;
    if (empty) expect(catalogueMatch({ ...entry.spec, [empty]: { value: empty === 'lateralGripG' ? 1.2 : 1, source: owner } } as VehicleSpec)).toBeNull();
    expect(catalogueMatch({ ...entry.spec, identity: { ...entry.spec.identity, trim: `${entry.spec.identity.trim} Special` } })).toBeNull();
    expect(catalogueMatch({ ...entry.spec, identity: { ...entry.spec.identity, year: entry.spec.identity.year - 1 } })).toBeNull();
  });
});

describe('the example vehicles', () => {
  it('are the brief’s two specimens, marked as placeholders', () => {
    expect(EXAMPLES.map((e) => `${e.identity.make} ${e.identity.model}`)).toEqual(['Nissan GT-R', 'Honda Civic']);
    for (const e of EXAMPLES) expect(e.note).toBe('Illustrative placeholder values, not verified manufacturer data.');
  });

  it('give the GT-R NISMO the brief’s values and a rating of 783', () => {
    expect(EXAMPLES[0].attributes).toEqual({ power: 950, speed: 920, acceleration: 880, handling: 880, durability: 650, reliability: 700, efficiency: 500 });
    expect(powerRating(EXAMPLES[0].attributes)).toBe(783);
  });

  it('give the Civic lower performance and higher reliability and efficiency', () => {
    const [gtr, civic] = EXAMPLES.map((e) => e.attributes);
    for (const k of ['power', 'speed', 'acceleration', 'handling'] as const) expect(civic[k]).toBeLessThan(gtr[k]);
    expect(civic.reliability).toBeGreaterThan(gtr.reliability);
    expect(civic.efficiency).toBeGreaterThan(gtr.efficiency);
    expect(powerRating(civic) as number).toBeLessThan(powerRating(gtr) as number);
  });
});
