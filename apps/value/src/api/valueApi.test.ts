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
    expect(b.assumed).toEqual(['Defaults used where not given: market Auto, urgency No rush, annual 12,000 miles a year.']);   // every other input was given
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
    const clamped = call('id=honda-civic&year=2019&mileage=60000&annual=99000').body as Body;
    expect(clamped.assumed.join(' ')).toMatch(/Miles a year 99,000 taken as 30,000/);
    expect(clamped.inputs.annualMiles).toBe(30000);
    // not a number, zero or below: refused, not guessed (the calculator reads 0 as "not given", the API would not)
    for (const a of ['lots', '0', '0.0', '-0', '-5', '']) {
      const r = call(`id=honda-civic&year=2019&mileage=60000&annual=${a}`);
      expect(r.status, a).toBe(400);
      expect((r.body as Body).errors.annual, a).toMatch(/miles a year/i);
    }
    const plain = call('id=honda-civic&year=2019&mileage=60000').body as Body;
    expect(plain.forecastUsd[5].mileage).toBe(60000 + 5 * 12000);
    expect(plain.assumed.join(' ')).toMatch(/annual 12,000 miles a year/);
    // every accepted figure, clamped or not, forecasts as the calculator does when it opens the link
    for (const a of ['1000', '2999.5', '3000', '25000', '30000', '99000']) {
      const r = call(`id=honda-civic&year=2019&mileage=60000&annual=${a}`).body as Body;
      expect(r.ok, a).toBe(true);
      const f = defaults(now);
      for (const [k, v] of new URL(r.links.app).searchParams) if ((URL_KEYS as string[]).includes(k)) (f as Record<string, string>)[k] = v;
      const calc = Math.min(30000, Math.max(3000, Number(f.annual) || 12000));
      expect(r.inputs.annualMiles, a).toBe(calc);
      expect(r.forecastUsd, a).toEqual(forecast(parse(f, now).inputs!, 5, calc, now).map((x) => ({ year: Number(x.year), privateParty: x.value, low: x.low, high: x.high, mileage: x.mileage })));
    }
  });

  it('does not read zip: it moves no number (it only seeds the calculator\'s own listings search)', () => {
    const base = 'id=honda-civic&year=2019&mileage=60000';
    for (const z of ['28202', '2820', 'abc']) {
      const r = call(`${base}&zip=${z}`);
      expect(r.status, z).toBe(200);
      expect((r.body as Body).valueUsd).toEqual((call(base).body as Body).valueUsd);
      expect(new URL((r.body as Body).links.app).searchParams.has('zip')).toBe(false);
    }
    expect(openApiJson().paths['/value'].get.parameters.map((p: Body) => p.name)).not.toContain('zip');
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

  it('reads market and urgency as the calculator names them (any case), and refuses anything else instead of a default', () => {
    const base = 'id=honda-civic&year=2019&mileage=60000';
    const tight = call(`${base}&market=Tight`).body as Body, lower = call(`${base}&market=tight`).body as Body;
    expect(lower.valueUsd).toEqual(tight.valueUsd);                              // "tight" is Tight, not a silent Auto
    expect(new URL(lower.links.app).searchParams.get('market')).toBe('Tight');  // and the link spells it as the calculator does
    expect(lower.inputs.marketChoice).toBe('Tight');
    const week = call(`${base}&urgency=this week`).body as Body;
    expect(week.inputs.urgency).toBe('This week');
    expect(week.valueUsd).toEqual((call(`${base}&urgency=This week`).body as Body).valueUsd);
    expect(week.valueUsd.tradeIn).toBeLessThan((call(base).body as Body).valueUsd.tradeIn);
    for (const [q, field, msg] of [['market=Hot', 'market', /Auto, Soft, Normal, Tight/], ['urgency=asap', 'urgency', /No rush, Within a month, This week/],
      ['listings=many', 'listings', /whole number/], ['listings=-3', 'listings', /whole number/], ['listings=5000', 'listings', /whole number/]] as const) {
      const r = call(`${base}&${q}`);
      expect(r.status, q).toBe(400);
      expect((r.body as Body).errors[field], q).toMatch(msg);
    }
    expect((call(`${base}&listings=12`).body as Body).inputs.listings).toBe(12);
  });

  it('says which asking prices it read from comps, or that it could read none', () => {
    const base = 'id=honda-civic&year=2019&mileage=60000';
    const spaced = call(`${base}&comps=15000, 17500`).body as Body;
    expect(spaced.inputs.comps).toEqual([15000, 17500]);
    expect(spaced.assumed.join(' ')).toMatch(/Asking prices read from comps: \$15,000, \$17,500/);
    const joined = call(`${base}&comps=15000,17500`).body as Body;                  // the calculator reads this as one number
    expect(joined.ok).toBe(true);
    expect(joined.inputs.comps).toEqual([]);
    expect(joined.assumed.join(' ')).toMatch(/No asking prices could be read from comps "15000,17500"/);
    expect(joined.valueUsd).toEqual((call(base).body as Body).valueUsd);
  });

  it('answers in the shape openapi.json publishes: every 200 checked against the Value schema, every refusal against Error', () => {
    const doc = openApiJson();
    // the small part of JSON Schema the document uses: $ref, type (incl. integer and null), enum, const, required,
    // properties, items, minimum and maximum
    const check = (v: unknown, s: Body, at: string, out: string[]): void => {
      if (s.$ref) return check(v, s.$ref.split('/').slice(1).reduce((o: Body, k: string) => o[k], doc), at, out);
      const types: string[] = s.type ? [].concat(s.type) : [];
      const is = (t: string) => t === 'null' ? v === null : t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' && Number.isFinite(v)
        : t === 'array' ? Array.isArray(v) : t === 'object' ? typeof v === 'object' && v !== null && !Array.isArray(v) : typeof v === t;
      if (types.length && !types.some(is)) return void out.push(`${at}: ${JSON.stringify(v)} is not ${types.join('|')}`);
      if (s.enum && !s.enum.includes(v)) out.push(`${at}: ${JSON.stringify(v)} not in ${JSON.stringify(s.enum)}`);
      if ('const' in s && v !== s.const) out.push(`${at}: ${JSON.stringify(v)} is not ${JSON.stringify(s.const)}`);
      if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum) out.push(`${at}: ${v} < ${s.minimum}`);
      if (typeof v === 'number' && s.maximum !== undefined && v > s.maximum) out.push(`${at}: ${v} > ${s.maximum}`);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const k of s.required ?? []) if (!(k in (v as Body))) out.push(`${at}.${k}: missing`);
        for (const [k, sub] of Object.entries(s.properties ?? {})) if (k in (v as Body)) check((v as Body)[k], sub as Body, `${at}.${k}`, out);
      }
      if (Array.isArray(v) && s.items) v.forEach((x, i) => check(x, s.items, `${at}[${i}]`, out));
    };
    const value = doc.paths['/value'].get.responses as Body;
    const out: string[] = [];
    for (const q of ['id=honda-civic&year=2019&mileage=60000', 'make=toyota&model=camry&year=2021', 'id=tesla-model-3&year=2020&mileage=40000.7',
      'id=honda-civic&year=2019&mileage=60000&market=soft&listings=12&urgency=within a month&comps=15000, 17500&annual=99000',
      'make=Zork&model=Blaster&year=2019&msrp=30000&mileage=50000&body=Sedan', 'id=ford-f-150&year=2018&mileage=90000&condition=Fair&region=West&accident=Minor']) {
      const r = call(q);
      expect(r.status, q).toBe(200);
      check(r.body, value['200'].content['application/json'].schema, q, out);
    }
    for (const [q, status] of [['year=2019', 400], ['id=nope&year=2019', 404], ['id=honda-civic&year=2019&market=Hot', 400], ['make=Honda&model=Civic&trim=Si?&year=2019', 400]] as const) {
      const r = call(q);
      expect(r.status, q).toBe(status);
      check(r.body, value[String(status)].content['application/json'].schema, q, out);
    }
    expect(out).toEqual([]);
    // and the checker does catch a response that breaks the schema
    const good = call('id=honda-civic&year=2019&mileage=60000').body as Body, bad: string[] = [];
    const broken = { ...good, valueUsd: { ...good.valueUsd, tradeIn: 12825.5 }, inputs: { ...good.inputs, condition: 'Shiny' }, links: undefined };
    delete (broken as Body).links;
    check(broken, value['200'].content['application/json'].schema, 'broken', bad);
    expect(bad).toEqual(expect.arrayContaining(['broken.links: missing', 'broken.inputs.condition: "Shiny" not in ["Excellent","Good","Fair","Poor"]', 'broken.valueUsd.tradeIn: 12825.5 is not integer']));
  });

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
    const exl = call('make=Honda&model=Civic&trim=ex-l&year=2019&mileage=40000').body as Body;
    expect(exl.car.trim).toBe('EX-L');                                          // EX-L, not EX: the exact name wins
    expect(exl.assumed[0]).toMatch(/Civic EX-L/);
    expect((call('make=Honda&model=Civic&trim=ex&year=2019&mileage=40000').body as Body).car.trim).toBe('EX');
    expect((call('make=Honda&model=Civic&trim=tour&year=2019&mileage=40000').body as Body).car.trim).toBe('Touring');   // a prefix, as the calculator reads it
    // a year with no trims on file at all (Civic stickers start in 2010): a named trim cannot be checked, so it is
    // refused too, unless the caller gives msrp; with no trim the typical sticker is used, as before, and says so
    const old = call('id=honda-civic&year=2005&mileage=150000&trim=Bogus');
    expect(old.status).toBe(400);
    expect((old.body as Body).errors.trim).toMatch(/No trims on file for the 2005 Honda Civic/);
    expect((call('id=honda-civic&year=2005&mileage=150000&trim=Bogus&msrp=15000').body as Body).car.trim).toBe('Bogus');
    const typical = call('id=honda-civic&year=2005&mileage=150000').body as Body;
    expect(typical.ok).toBe(true);
    expect(typical.assumed[0]).toMatch(/Rough typical sticker/);
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
