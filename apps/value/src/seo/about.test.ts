// The two plain pages that say what MiCar is and how a value is worked out, and the data files beside them.
// What they must never do is claim more than is true: nothing on MiCar is independently verified today.
import { describe, expect, it } from 'vitest';
import { EMPTY_REGISTRY, addEvent, createPassport, emptySpec, gradePassport, certify, publicPassport, snapshotOf, appendSnapshot, GRADE_WEIGHTS } from '@micar/engine';
import calibrationFile from '../data/calibration.json';
import { ACCIDENTS, CONDITIONS, TITLES } from '../engine/data';
import { valuate, type Inputs } from '../engine/valuation';
import { aboutPageHtml, fitTotals, methodJson, methodPageHtml, passportSchemaJson, type Calibration, type SiteCounts } from './about';
import { ABOUT_URL, METHOD_URL } from './pages';

const env = { css: ':root{}', footer: '<footer class="mc-foot"></footer>' };
const cal = calibrationFile as unknown as Calibration;
const counts: SiteCounts = { models: 526, makes: 52, modelYears: 3853, trims: 26452, manufacturerYears: 170 };
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('the fit totals', () => {
  it('are worked out from calibration.json itself', () => {
    const f = fitTotals(cal);
    expect(f.models).toBe(cal.models.length);
    expect(f.listings).toBe(cal.models.reduce((n, m) => n + m.n, 0));
    expect(f.mae).toBeGreaterThan(0.03);
    expect(f.mae).toBeLessThan(0.15);
    for (const m of cal.models) { expect(m.mae).toBeLessThanOrEqual(f.worst.mae); expect(m.mae).toBeGreaterThanOrEqual(f.best.mae); }
  });
});

describe('the method page', () => {
  const html = methodPageHtml(counts, cal, env), t = text(html), f = fitTotals(cal);

  it('is a readable page with one description, a canonical URL and valid JSON-LD', () => {
    expect(html).toContain('<h1>How MiCar works out a value</h1>');
    expect(html).toContain(`<link rel="canonical" href="${METHOD_URL}" />`);
    expect(html.match(/<meta name="description"/g)).toHaveLength(1);
    for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)) expect(() => JSON.parse(m[1])).not.toThrow();
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('says it is an estimate from asking prices, and how many models have no measured error', () => {
    expect(t).toContain('It is not an offer to buy, not an appraisal of a particular car, and not a live market price.');
    expect(t).toContain('asking prices, not sale prices');
    expect(t).toContain(`${counts.models - f.models} of ${counts.models} models are not fitted to listings at all`);
    expect(t).toContain(`${f.models} models was fitted to ${f.listings.toLocaleString('en-US')} real listings`);
    expect(t).toContain(`${(f.mae * 100).toFixed(1)}% on average`);
    expect(t).toContain('MiCar looks up no title history, reads no odometer and inspects nothing.');
  });

  it('lists every fitted model with its listings and its error', () => {
    for (const m of cal.models) expect(html, m.model).toContain(`<td>${`${m.make} ${m.model}`.replace(/&/g, '&amp;')}</td><td>${m.n}</td>`);
    expect(html.match(/<tr><td>[^<]+<\/td><td>\d+<\/td><td>\d+%<\/td>/g)).toHaveLength(cal.models.length);
  });

  it('prints the changes the engine really applies', () => {
    const base: Inputs = { make: 'Honda', model: 'Civic', trim: 'LX', body: 'Sedan', msrp: 20250, year: 2019, mileage: 60000, condition: 'Good', title: 'Clean', accident: 'None', region: 'West', market: 'normal', marketIndex: null, listings: null, urgency: 'none', comps: [] };
    const at = new Date('2026-11-14T12:00:00Z');
    const pp = (over: Partial<Inputs>) => valuate({ ...base, ...over }, at).privateParty;
    const shown = (m: number) => (m === 1 ? 'no change' : `${m > 1 ? '+' : '−'}${Math.abs((m - 1) * 100).toFixed(1).replace(/\.0$/, '')}%`);
    for (const o of TITLES) {
      expect(html).toContain(`<td>${o.name}</td><td>${shown(o.mult)}</td>`);
      expect(pp({ title: o.name }) / pp({})).toBeCloseTo(o.mult, 6);
    }
    for (const o of ACCIDENTS) {
      expect(html).toContain(`<td>${o.label}</td><td>${shown(o.mult)}</td>`);
      expect(pp({ accident: o.name }) / pp({})).toBeCloseTo(o.mult, 6);
    }
    for (const o of CONDITIONS) {
      expect(html).toContain(`<td>${o.name}</td><td>${shown(o.mult)}</td>`);
      expect(pp({ condition: o.name }) / pp({})).toBeCloseTo(o.mult, 6);
    }
    // the other figures the page states in words
    expect(pp({ urgency: 'month' }) / pp({})).toBeCloseTo(0.97, 6);
    expect(pp({ urgency: 'week' }) / pp({})).toBeCloseTo(0.93, 6);
    expect(t).toContain('3% off to sell within a month, 7% off within a week');
    expect(pp({ mileage: 0 }) / pp({ mileage: valuate(base, at).expectedMiles })).toBeCloseTo(1.12, 6);
    expect(t).toContain('each 1,000 below adds 0.4%, to at most 12%');
    expect(t).toContain('12,000 miles a year is expected');
  });

  it('gives the same figures as data', () => {
    const j = JSON.parse(JSON.stringify(methodJson(counts, cal, '2026-11-14T00:00:00.000Z')));
    expect(j.kind).toBe('estimate');
    expect(j.coverage).toEqual({ models: counts.models, fittedToListings: f.models, notFitted: counts.models - f.models });
    expect(j.fit.models).toHaveLength(cal.models.length);
    expect(j.fit.listings).toBe(f.listings);
    expect(j.title.map((o: { value: string; multiplier: number }) => [o.value, o.multiplier])).toEqual(TITLES.map((o) => [o.name, o.mult]));
    expect(j.accident.map((o: { label: string }) => o.label)).toEqual(['None reported', 'Minor reported', 'Major reported']);
    expect(JSON.stringify(j)).toMatch(/checked no record/);
  });
});

describe('the about page', () => {
  const html = aboutPageHtml(counts, cal, env), t = text(html);

  it('is a readable page with one description, a canonical URL and valid JSON-LD', () => {
    expect(html).toContain('<h1>What MiCar is</h1>');
    expect(html).toContain(`<link rel="canonical" href="${ABOUT_URL}" />`);
    expect(html.match(/<meta name="description"/g)).toHaveLength(1);
    for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)) expect(() => JSON.parse(m[1])).not.toThrow();
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('covers every part of MiCar', () => {
    for (const id of ['value', 'garage', 'grade', 'evidence', 'public', 'world', 'dealers', 'shops', 'data']) expect(html).toContain(`id="${id}"`);
    for (const word of ['MiCar ID', 'MC-XXXX-XXXX-XXXC', 'passport', 'collectible card', 'MiCar World', 'window sheet', 'MiCar Shop']) expect(t).toContain(word);
  });

  it('says plainly that nothing is checked, and sells no verification', () => {
    expect(t).toContain('What is checked today: nothing.');
    expect(t).toContain('no car on MiCar is Verified or Certified');
    expect(html).toContain('<td>Verified</td><td>An independent party has checked its identity, and its mileage or its records.</td><td>Not yet: no verifier is connected</td>');
    expect(html).toContain('<td>Certified</td><td>An independent inspector has examined the vehicle in person.</td><td>Not yet: no verifier is connected</td>');
    expect(t).toContain("in the visitor's own browser, and nowhere else");
    expect(t).not.toMatch(/Keyholder|\$39|certificate every quarter/);
  });

  it('prints the grade weights the engine uses, and they add up', () => {
    expect(Object.values(GRADE_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(html).toContain('<td>20%</td><td>55 of 100</td>');          // identity
    expect(html).toContain('<td>15%</td><td>0 of 100</td>');           // verification: an owner alone scores nothing
  });
});

describe('the passport schema', () => {
  // a small checker for the subset of JSON Schema the file uses: types, enums, required, no extra keys, arrays
  const check = (schema: any, value: unknown, at: string): string[] => {
    const out: string[] = [];
    if (schema.enum) { if (!schema.enum.includes(value)) out.push(`${at}: ${JSON.stringify(value)} is not one of the listed values`); return out; }
    const types: string[] = [].concat(schema.type ?? []);
    const is = (ty: string) => (ty === 'null' ? value === null : ty === 'integer' ? Number.isInteger(value) : ty === 'array' ? Array.isArray(value) : ty === 'object' ? typeof value === 'object' && value !== null && !Array.isArray(value) : typeof value === ty);
    if (types.length && !types.some(is)) { out.push(`${at}: wrong type`); return out; }
    if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) out.push(`${at}: ${value} does not match ${schema.pattern}`);
    if (Array.isArray(value) && schema.items) value.forEach((v, i) => out.push(...check(schema.items, v, `${at}[${i}]`)));
    if (schema.properties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const k of schema.required ?? []) if (!(k in value)) out.push(`${at}: ${k} is missing`);
      for (const [k, v] of Object.entries(value)) {
        if (!(k in schema.properties)) out.push(`${at}: ${k} is not in the schema`);
        else out.push(...check(schema.properties[k], v, `${at}.${k}`));
      }
    }
    return out;
  };

  const ok = <T,>(r: { ok: true; value: T } | { ok: false; reason: string }): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
  const build = () => {
    const owner = 'G-TEST', now = '2026-11-14T10:00:00.000Z', by = { now, by: owner };
    let p = ok(createPassport({ micarId: 'MC-0000-0000-0000', now, ownerId: owner, spec: emptySpec({ year: 2019, make: 'Honda', model: 'Civic', trim: 'LX', bodyClass: 'sedan' }), color: 'Blue', vin: '', eventId: 'e0' }));
    p = ok(addEvent(p, { id: 'e1', type: 'mileage', date: '2026-11-01', mileage: 61234, title: 'Odometer', note: 'private note', attachments: [{ id: 'f1', kind: 'photo', name: 'secret-name.jpg', mime: 'image/jpeg', size: 10, sha256: null }], visibility: 'public' }, by));
    p = ok(addEvent(p, { id: 'e2', type: 'maintenance', date: '2026-11-02', mileage: null, title: 'Oil change', note: '', attachments: [{ id: 'f2', kind: 'receipt', name: 'r.pdf', mime: 'application/pdf', size: 10, sha256: null }], visibility: 'private', shop: 'Secret Shop', cost: 80, work: 'service', system: null, parts: '' }, by));
    const report = gradePassport(p, EMPTY_REGISTRY, '2026-11-14');
    const level = certify(p, report, EMPTY_REGISTRY, '2026-11-14').level;
    return appendSnapshot(p, snapshotOf(report, level, { id: 's1', at: now, reason: 'test', events: p.events.length }));
  };

  it('describes what publicPassport() really returns', () => {
    let passport;
    try { passport = build(); } catch (e) { throw new Error(`the test passport could not be built: ${(e as Error).message}`); }
    const view = JSON.parse(JSON.stringify(publicPassport(passport, EMPTY_REGISTRY, '2026-11-14')));
    expect(check(passportSchemaJson(), view, 'passport')).toEqual([]);
    expect(view.events.length).toBeGreaterThanOrEqual(3);
    expect(view.snapshots.length).toBe(1);
    expect(view.events.every((e: { verified: boolean }) => e.verified === false)).toBe(true);   // no verifier is connected
    expect(JSON.stringify(view)).not.toMatch(/secret|private note|Secret Shop|61234/i);
  });

  it('refuses a view with something added or missing', () => {
    const view = JSON.parse(JSON.stringify(publicPassport(build(), EMPTY_REGISTRY, '2026-11-14')));
    expect(check(passportSchemaJson(), { ...view, vin: '1HGBH41JXMN109186' }, 'passport')).toEqual(['passport: vin is not in the schema']);
    const { micarId: _gone, ...rest } = view;
    expect(check(passportSchemaJson(), rest, 'passport')).toEqual(['passport: micarId is missing']);
  });

  it('says no endpoint serves passports', () => {
    expect(passportSchemaJson().description).toMatch(/No MiCar endpoint serves these today/);
  });
});
