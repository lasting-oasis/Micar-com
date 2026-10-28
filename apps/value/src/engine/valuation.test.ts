import { describe, expect, it } from 'vitest';
import { MAKES } from './data';
import { forecast, mileageFactor, valuate, type Inputs } from './valuation';

const asOf = new Date(2026, 9, 15); // Oct 2026
const base: Inputs = {
  make: 'Toyota', model: 'Camry SE', body: 'Sedan', msrp: 35000, year: 2022,
  mileage: 48000, condition: 'Good', title: 'Clean', accident: 'None', region: 'Southeast',
};

describe('valuate', () => {
  it('produces ordered trade-in < private party < retail', () => {
    const r = valuate(base, asOf);
    expect(r.tradeIn).toBeLessThan(r.privateParty);
    expect(r.privateParty).toBeLessThan(r.dealerRetail);
    expect(r.range.low).toBeLessThan(r.privateParty);
    expect(r.range.high).toBeGreaterThan(r.privateParty);
  });

  it('applies a drive-off hit to a current-model-year car', () => {
    const r = valuate({ ...base, year: 2026, mileage: 5000 }, asOf);
    expect(r.privateParty / 35000).toBeLessThan(0.92);
    expect(r.privateParty / 35000).toBeGreaterThan(0.75);
  });

  it('luxury brands lose value faster than economy brands', () => {
    const toyota = valuate(base, asOf).privateParty / 35000;
    const bmw = valuate({ ...base, make: 'BMW', msrp: 60000 }, asOf).privateParty / 60000;
    expect(bmw).toBeLessThan(toyota);
  });

  it('scales the mileage penalty with vehicle value', () => {
    const cheapLow = valuate({ ...base, msrp: 20000 }, asOf).privateParty;
    const cheapHigh = valuate({ ...base, msrp: 20000, mileage: 90000 }, asOf).privateParty;
    const pricyLow = valuate({ ...base, msrp: 90000 }, asOf).privateParty;
    const pricyHigh = valuate({ ...base, msrp: 90000, mileage: 90000 }, asOf).privateParty;
    expect(pricyLow - pricyHigh).toBeGreaterThan((cheapLow - cheapHigh) * 3);
  });

  it('caps the low-mileage bonus', () => {
    expect(mileageFactor(0, 200000)).toBeCloseTo(1.12);
  });

  it('never goes below a scrap floor or above MSRP', () => {
    const junk = valuate({ ...base, year: 1998, mileage: 400000, condition: 'Poor', title: 'Salvage' }, asOf);
    expect(junk.privateParty).toBeGreaterThanOrEqual(500);
    const mint = valuate({ ...base, year: 2026, mileage: 0, condition: 'Excellent' }, asOf);
    expect(mint.privateParty).toBeLessThanOrEqual(35000 * 0.98);
  });

  it('widens the range for salvage titles', () => {
    expect(valuate({ ...base, title: 'Salvage' }, asOf).bandPct).toBeGreaterThan(valuate(base, asOf).bandPct);
  });

  it('handles empty MSRP without NaN', () => {
    const r = valuate({ ...base, msrp: 0 }, asOf);
    expect(Number.isFinite(r.privateParty)).toBe(true);
  });

  it('forecast declines year over year', () => {
    const f = forecast(base, 5, 12000, asOf);
    expect(f).toHaveLength(6);
    for (let i = 1; i < f.length; i++) expect(f[i].value).toBeLessThan(f[i - 1].value);
  });

  it('every make gives a sane value', () => {
    for (const m of MAKES) {
      const r = valuate({ ...base, make: m.name }, asOf);
      expect(r.privateParty / 35000).toBeGreaterThan(0.3);
      expect(r.privateParty / 35000).toBeLessThan(0.8);
    }
  });
});
