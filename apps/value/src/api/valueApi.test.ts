import { describe, expect, it } from 'vitest';
import { forecast, valuate } from '../engine/valuation';
import { parse, defaults, URL_KEYS } from '../urlState';
import { cacheControlFor, queryOf, resolveCar, valueQuery } from './valueApi';
import stickers from '../data/stickers.json';
import epaFile from '../data/epa-configs.json';
import { buildCarRecords, openApiJson, type ApiSticker, type EpaFile } from '../seo/api';

const now = new Date('2026-11-13T12:00:00Z');
const call = (q: string) => valueQuery(new URLSearchParams(q), now);
type Body = Record<string, any>;

describe('value api', () => {
  it('gives the same numbers as the calculator for the same link', () => {
    const r = call('make=Honda&model=Civic&trim=LX&body=Sedan&year=2019&msrp=20250&mileage=48000&condition=Good&title=Clean&accident=None&region=Southeast');
    expect(r.status).toBe(200);
    const form = { ...defaults(now), make: 'Honda', model: 'Civic', trim: 'LX', body: 'Sedan', year: '2019', msrp: '20250', mileage: '48000' };
    const v = valuate(parse(form, now).inputs!, now);
    const b = r.body as Body;
    const r0 = Math.round;
    expect(b.valueUsd).toEqual({ tradeIn: r0(v.tradeIn), privateParty: r0(v.privateParty), dealerRetail: r0(v.dealerRetail), range: { low: r0(v.range.low), high: r0(v.range.high) } });
    expect(Number.isInteger(b.valueUsd.privateParty)).toBe(true);
    expect(b.assumed).toEqual([]);
    expect(b.forecastUsd).toHaveLength(6);
    expect(new URL(b.links.app).hash).toBe('#/value');
  });

  it('its calculator link carries every input it used, so the link opens on the same numbers', () => {
    // read the link exactly as the calculator does (readUrl: defaults, then every URL key it knows, cut to 120 chars)
    const fromLink = (link: string) => {
      const q = new URL(link).searchParams; const f = defaults(now);
      for (const k of URL_KEYS) { const v = q.get(k); if (v !== null) f[k] = v.slice(0, 120); }
      return valuate(parse(f, now).inputs!, now);
    };
    const r0 = Math.round;
    for (const q of ['id=honda-civic&year=2019&mileage=60000', 'make=toyota&model=camry&year=2021',
      'id=honda-civic&year=2019&mileage=60000&market=Tight', 'id=honda-civic&year=2019&mileage=60000&listings=3',
      'id=honda-civic&year=2019&mileage=60000&urgency=This week', 'id=honda-civic&year=2019&mileage=60000&comps=15000, 17500',
      'id=honda-civic&year=2019&mileage=60000&zip=28202&market=Soft&listings=12&urgency=Within a month&comps=$15k 16900',
      'make=Zork&model=Blaster&year=2019&msrp=30000&mileage=50000&body=Sedan&condition=Fair&region=West']) {
      const b = call(q).body as Body;
      expect(b.ok, q).toBe(true);
      const v = fromLink(b.links.app);
      expect({ q, ...b.valueUsd }).toEqual({ q, tradeIn: r0(v.tradeIn), privateParty: r0(v.privateParty), dealerRetail: r0(v.dealerRetail), range: { low: r0(v.range.low), high: r0(v.range.high) } });
    }
  });

  it('forecasts at the miles a year the caller gives, as the calculator does, and its link carries them', () => {
    const b = call('id=honda-civic&year=2019&mileage=60000&annual=25000').body as Body;
    expect(b.ok).toBe(true);
    const f = defaults(now);
    for (const [k, v] of new URL(b.links.app).searchParams) if ((URL_KEYS as string[]).includes(k)) (f as Record<string, string>)[k] = v;
    expect(f.annual).toBe('25000');
    const annual = Math.min(30000, Math.max(3000, Number(f.annual) || 12000));     // App.tsx: the calculator's clamp
    const want = forecast(parse(f, now).inputs!, 5, annual, now);
    expect(b.forecastUsd).toEqual(want.map((x) => ({ year: Number(x.year), privateParty: x.value, low: x.low, high: x.high, mileage: x.mileage })));
    expect(b.forecastUsd[5].mileage).toBe(60000 + 5 * 25000);
    // the calculator clamps: 99,000 a year forecasts at 30,000, and a missing or bad figure at 12,000
    expect((call('id=honda-civic&year=2019&mileage=60000&annual=99000').body as Body).forecastUsd[5].mileage).toBe(60000 + 5 * 30000);
    expect((call('id=honda-civic&year=2019&mileage=60000&annual=lots').body as Body).forecastUsd[5].mileage).toBe(60000 + 5 * 12000);
    expect((call('id=honda-civic&year=2019&mileage=60000').body as Body).forecastUsd[5].mileage).toBe(60000 + 5 * 12000);
  });

  it('fills the same MSRP as the data API for every model year it lists (case-only duplicate spellings included)', () => {
    const records = buildCarRecords(stickers as unknown as ApiSticker[], epaFile as unknown as EpaFile);
    const misses: string[] = [];
    for (const r of records) for (const y of r.years) {
      const b = call(`id=${r.id}&year=${y.year}&mileage=50000`).body as Body;
      if (!b.ok || b.inputs.msrpUsd !== y.msrpUsd.low) misses.push(`${r.id} ${y.year}: data ${y.msrpUsd.low}, value ${b.ok ? b.inputs.msrpUsd : JSON.stringify(b.errors)}`);
    }
    expect(misses).toEqual([]);
    const gt = call('id=maserati-granturismo&year=2026&mileage=5000').body as Body;
    expect(gt.inputs.msrpUsd).toBe(160545);
    expect(gt.assumed[0]).toMatch(/^MSRP \$160,545: Sticker/);
  }, 120_000);

  it('documents msrp and mileage as numbers, since a decimal is accepted (and echoed) like the calculator accepts it', () => {
    const b = call('id=tesla-model-3&year=2020&mileage=40000.7').body as Body;
    expect(b.ok).toBe(true);
    const value = openApiJson().paths['/value'].get;
    const params = Object.fromEntries(value.parameters.map((p: Body) => [p.name, p.schema.type]));
    expect(params).toMatchObject({ msrp: 'number', mileage: 'number', annual: 'number' });
    const schema = openApiJson().components.schemas.Value.properties;
    expect(schema.forecastUsd.items.properties.mileage.type).toBe('number');
    expect(b.forecastUsd[0].mileage).toBe(40000.7);
  });

  it('refuses a trim it has no sticker for, instead of pricing it as the base trim', () => {
    const r = call('make=Honda&model=Civic&trim=Si?&year=2019&mileage=60000');
    expect(r.status).toBe(400);
    const e = (r.body as Body).errors.trim as string;
    expect(e).toMatch(/No 2019 Honda Civic trim called "Si\?"/);
    expect(e).toMatch(/\bLX\b/);                                                // it lists the trims on file
    expect(e).toMatch(/or give msrp/);
    // a trim on file, in any case or spelling the calculator's own matching accepts, is priced as that trim
    expect((call('make=Honda&model=Civic&trim=sport&year=2020&mileage=40000').body as Body).car.trim).toBe('Sport');
    expect((call('make=Honda&model=Civic&trim=ex-l&year=2019&mileage=40000').body as Body).ok).toBe(true);
    // with the caller's own MSRP the trim is only a label, as in the calculator
    const own = call('make=Honda&model=Civic&trim=Si?&year=2019&mileage=60000&msrp=25200').body as Body;
    expect(own.ok).toBe(true);
    expect(own.car.trim).toBe('Si?');
    expect(own.inputs.msrpUsd).toBe(25200);
    // no trim given: the cheapest, and it says so
    const base = call('make=Honda&model=Civic&year=2019&mileage=60000').body as Body;
    expect(base.car.trim).toBe('LX');
    expect(base.assumed[0]).toMatch(/^MSRP \$20,250: Sticker for the 2019 Civic LX/);
  });

  it('reads the whole query, a literal "?" in a value included (the server hands it the raw URL)', () => {
    const q = queryOf('/api/v1/value?make=Honda&model=Civic&trim=Si?&year=2019&mileage=60000');
    expect(q.get('trim')).toBe('Si?');
    expect(q.get('year')).toBe('2019');
    expect(q.get('mileage')).toBe('60000');
    expect([...queryOf('/api/v1/value').keys()]).toEqual([]);
    expect(queryOf('/api/v1/value?id=honda-civic&year=2019&id=x').get('id')).toBe('honda-civic');
  });

  it('lets answers be cached for an hour, but never a server failure', () => {
    expect(cacheControlFor(200)).toBe('public, max-age=3600');
    expect(cacheControlFor(400)).toBe('public, max-age=3600');                 // the same query always gets the same refusal
    expect(cacheControlFor(404)).toBe('public, max-age=3600');
    expect(cacheControlFor(500)).toBe('no-store');
    expect(cacheControlFor(503)).toBe('no-store');
  });

  it('accepts loose spelling or a data-API id, and fills MSRP and mileage it can, saying so', () => {
    expect(resolveCar({ make: 'honda', model: 'CIVIC' })).toMatchObject({ make: 'Honda', model: 'Civic' });
    const r = call('id=honda-civic&year=2019');
    expect(r.status).toBe(200);
    const b = r.body as Body;
    expect(b.car).toMatchObject({ make: 'Honda', model: 'Civic', trim: 'LX', year: 2019, body: 'Sedan' });
    expect(b.inputs.msrpUsd).toBe(20250);
    expect(b.assumed.join(' ')).toMatch(/MSRP \$20,250/);
    expect(b.assumed.join(' ')).toMatch(/Mileage taken as/);
    expect(b.valueUsd.tradeIn).toBeLessThan(b.valueUsd.privateParty);
    expect(b.valueUsd.privateParty).toBeLessThan(b.valueUsd.dealerRetail);
  });

  it('refuses with field messages instead of guessing', () => {
    expect(call('').status).toBe(400);
    expect(call('id=no-such-car&year=2019').status).toBe(404);
    const bad = call('make=Honda&model=Civic&year=1800&mileage=-5&condition=Shiny');
    expect(bad.status).toBe(400);
    expect((bad.body as Body).errors.condition).toMatch(/Excellent, Good, Fair, Poor/);
    expect((bad.body as Body).errors.year).toBeTruthy();
    expect((bad.body as Body).errors.mileage).toBeTruthy();
  });

  it('values an unlisted car only with an MSRP, and says it used general depreciation', () => {
    expect(call('make=Zzz&model=Qq&year=2020').status).toBe(400);
    const r = call('make=Zzz&model=Qq&year=2020&msrp=30000&mileage=40000');
    expect(r.status).toBe(200);
    const b = r.body as Body;
    expect(b.modelKnown).toBe(false);
    expect(b.assumed.join(' ')).toMatch(/general depreciation/);
    expect(JSON.stringify(b)).not.toMatch(/NaN|null,"privateParty"/);
  });
});
