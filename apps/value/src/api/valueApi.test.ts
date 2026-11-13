import { describe, expect, it } from 'vitest';
import { valuate } from '../engine/valuation';
import { parse, defaults } from '../urlState';
import { resolveCar, valueQuery } from './valueApi';

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
