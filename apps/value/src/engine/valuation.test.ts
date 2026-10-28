import { describe, expect, it } from 'vitest';
import { MAKES } from './data';
import { MODELS, typicalMsrp } from './models';
import { forecast, mileageFactor, supplyAdjustment, valuate, type Inputs } from './valuation';

const asOf = new Date(2026, 9, 15); // Oct 2026
const base: Inputs = {
  make: 'Toyota', model: 'Camry', trim: 'SE', body: 'Sedan', msrp: 30000, year: 2022,
  mileage: 48000, condition: 'Good', title: 'Clean', accident: 'None', region: 'Southeast',
  market: 'normal', listings: null, urgency: 'none', comps: [],
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
    expect(r.privateParty / 30000).toBeLessThan(0.92);
    expect(r.privateParty / 30000).toBeGreaterThan(0.75);
  });

  it('uses model-level resale: a 4Runner holds value far better than a Malibu', () => {
    const runner = valuate({ ...base, model: '4Runner', body: 'SUV / Crossover', msrp: 45000 }, asOf);
    const malibu = valuate({ ...base, make: 'Chevrolet', model: 'Malibu', msrp: 27000 }, asOf);
    expect(runner.privateParty / 45000).toBeGreaterThan(malibu.privateParty / 27000 + 0.15);
    expect(runner.modelKnown && malibu.modelKnown).toBe(true);
  });

  it('falls back to make + body for an unlisted model', () => {
    const r = valuate({ ...base, model: '' }, asOf);
    expect(r.modelKnown).toBe(false);
    expect(r.confidenceReasons.join()).toMatch(/listed model/);
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
    const mint = valuate({ ...base, year: 2026, mileage: 0, condition: 'Excellent', listings: 1, market: 'tight' }, asOf);
    expect(mint.privateParty).toBeLessThanOrEqual(30000 * 0.98);
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

  it('every listed model and make gives a sane value', () => {
    for (const m of MODELS) {
      const r = valuate({ ...base, make: m.make, model: m.model, body: m.body, msrp: m.typicalMsrp }, asOf);
      expect(r.privateParty / m.typicalMsrp, m.model).toBeGreaterThan(0.25);
      expect(r.privateParty / m.typicalMsrp, m.model).toBeLessThan(0.85);
    }
    for (const m of MAKES) {
      const r = valuate({ ...base, make: m.name, model: '' }, asOf);
      expect(r.privateParty / 30000).toBeGreaterThan(0.3);
    }
    expect(typicalMsrp(MODELS[0], 2022)).toBeLessThan(MODELS[0].typicalMsrp);
  });
});

describe('market layer', () => {
  it('more listings nearby lowers the price, fewer raises it', () => {
    const few = valuate({ ...base, listings: 2 }, asOf).privateParty;
    const typical = valuate({ ...base, listings: 10 }, asOf).privateParty;
    const many = valuate({ ...base, listings: 40 }, asOf).privateParty;
    expect(few).toBeGreaterThan(typical);
    expect(typical).toBeGreaterThan(many);
    expect(valuate({ ...base, listings: 10 }, asOf).privateParty).toBeCloseTo(valuate(base, asOf).privateParty, 0);
  });

  it('fleet-heavy models get undercut harder than reliability models', () => {
    expect(supplyAdjustment(40, 0.085)).toBeLessThan(supplyAdjustment(40, 0.04));
    const enclave = { ...base, make: 'Buick', model: 'Enclave', body: 'SUV / Crossover', msrp: 45000 };
    const civic = { ...base, make: 'Honda', model: 'Civic', msrp: 26000 };
    const enclaveDrop = 1 - valuate({ ...enclave, listings: 40 }, asOf).privateParty / valuate(enclave, asOf).privateParty;
    const civicDrop = 1 - valuate({ ...civic, listings: 40 }, asOf).privateParty / valuate(civic, asOf).privateParty;
    expect(enclaveDrop).toBeGreaterThan(civicDrop * 1.5);
  });

  it('a soft market hurts luxury and EVs more than a Civic', () => {
    const civic = { ...base, make: 'Honda', model: 'Civic', msrp: 26000 };
    const bmw = { ...base, make: 'BMW', model: '5 Series', msrp: 60000 };
    const civicSwing = 1 - valuate({ ...civic, market: 'soft' }, asOf).privateParty / valuate(civic, asOf).privateParty;
    const bmwSwing = 1 - valuate({ ...bmw, market: 'soft' }, asOf).privateParty / valuate(bmw, asOf).privateParty;
    expect(bmwSwing).toBeGreaterThan(civicSwing * 1.4);
    expect(valuate({ ...civic, market: 'tight' }, asOf).privateParty).toBeGreaterThan(valuate(civic, asOf).privateParty);
  });

  it('needing to sell fast discounts the price', () => {
    const r0 = valuate(base, asOf).privateParty;
    expect(valuate({ ...base, urgency: 'month' }, asOf).privateParty).toBeLessThan(r0);
    expect(valuate({ ...base, urgency: 'week' }, asOf).privateParty).toBeLessThan(valuate({ ...base, urgency: 'month' }, asOf).privateParty);
  });

  it('comps pull the estimate toward the market, more with more comps', () => {
    const model = valuate(base, asOf).privateParty;
    const one = valuate({ ...base, comps: [model * 1.2] }, asOf);
    const five = valuate({ ...base, comps: [model * 1.2, model * 1.18, model * 1.22, model * 1.2, model * 1.19] }, asOf);
    expect(one.privateParty).toBeGreaterThan(model);
    expect(five.privateParty).toBeGreaterThan(one.privateParty);
    expect(five.privateParty).toBeLessThan(model * 1.2); // asking → sale discount
    expect(five.bandPct).toBeLessThan(one.bandPct);
    expect(five.compsUsed).toBe(5);
    expect(one.modelEstimate).toBeCloseTo(model, 0);
  });

  it('ignores comps that are wildly off', () => {
    const r = valuate({ ...base, comps: [500, 22000, 900000] }, asOf);
    expect(r.compsUsed).toBe(1);
    expect(r.compsIgnored).toBe(2);
  });

  it('forecast keeps the comp anchor', () => {
    const plain = forecast(base, 5, 12000, asOf);
    const anchored = forecast({ ...base, comps: [plain[0].value * 1.2, plain[0].value * 1.2, plain[0].value * 1.2] }, 5, 12000, asOf);
    for (let i = 0; i < plain.length; i++) expect(anchored[i].value).toBeGreaterThan(plain[i].value);
  });
});
