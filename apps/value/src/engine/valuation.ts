import {
  ACCIDENTS, BODY_STYLES, CONDITIONS, MAKES, TITLES, regionAdjustment,
  type Region,
} from './data';

export const MILES_PER_YEAR = 12_000;

export type Inputs = {
  make: string;
  model: string;
  body: string;
  msrp: number;
  year: number;
  mileage: number;
  condition: string;
  title: string;
  accident: string;
  region: Region;
};

export type Step = { label: string; detail: string; value: number; delta: number };

export type Valuation = {
  tradeIn: number;
  privateParty: number;
  dealerRetail: number;
  range: { low: number; high: number };
  bandPct: number;
  confidence: 'High' | 'Medium' | 'Low';
  confidenceReasons: string[];
  ageYears: number;
  expectedMiles: number;
  steps: Step[];
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Vehicle age in years. Model years go on sale ~the fall before, so a
 * 2026 model is roughly half a year old in spring 2026. */
export function vehicleAge(modelYear: number, asOf: Date): number {
  const fractional = asOf.getFullYear() + asOf.getMonth() / 12;
  return clamp(fractional - (modelYear - 0.25), 0, 60);
}

const DECAY = 0.85; // each year loses ~15% less than the year before
const DRIVE_OFF = 0.4; // titling hit, as a fraction of the first year's loss

/** Share of MSRP kept after `age` years for a car losing `firstYearLoss`
 * in its first year, before mileage/condition. */
export function curveShare(firstYearLoss: number, age: number): number {
  if (age <= 0) return 1;
  // Drive-off hit: the car stops being "new" the moment it's titled.
  let share = 1 - firstYearLoss * DRIVE_OFF;
  const whole = Math.floor(age);
  for (let k = 0; k < whole; k++) share *= 1 - firstYearLoss * Math.pow(DECAY, k);
  share *= Math.pow(1 - firstYearLoss * Math.pow(DECAY, whole), age - whole);
  return share;
}

/** First-year loss rate that makes the curve land on `residual5` at year 5. */
export function lossForResidual(residual5: number): number {
  let lo = 0, hi = 0.6;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (curveShare(mid, 5) > residual5) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Multiplier for miles above/below the expected 12k per year. Scales with
 * the car's value, so a $90k car loses more dollars per extra mile than a $20k one. */
export function mileageFactor(mileage: number, expected: number): number {
  const delta = mileage - expected;
  if (delta > 0) return Math.max(0.5, Math.exp(-0.0055 * (delta / 1000)));
  return 1 + Math.min(0.12, 0.004 * (-delta / 1000));
}

export function valuate(input: Inputs, asOf: Date = new Date()): Valuation {
  const make = MAKES.find((m) => m.name === input.make) ?? MAKES[MAKES.length - 1];
  const body = BODY_STYLES.find((b) => b.name === input.body) ?? BODY_STYLES[0];
  const cond = CONDITIONS.find((c) => c.name === input.condition) ?? CONDITIONS[1];
  const title = TITLES.find((t) => t.name === input.title) ?? TITLES[0];
  const accident = ACCIDENTS.find((a) => a.name === input.accident) ?? ACCIDENTS[0];

  const msrp = Math.max(0, input.msrp);
  const age = vehicleAge(input.year, asOf);
  const expectedMiles = Math.round(age * MILES_PER_YEAR);
  const residual5 = clamp(make.residual5 + body.adj, 0.25, 0.85);
  const firstYearLoss = lossForResidual(residual5);

  const steps: Step[] = [];
  let v = msrp;
  const push = (label: string, detail: string, next: number) => {
    steps.push({ label, detail, value: next, delta: next - v });
    v = next;
  };
  steps.push({ label: 'Original MSRP', detail: `${input.year} ${make.name}`, value: msrp, delta: 0 });

  const titled = age > 0 || input.mileage > 0;
  push(
    'Age depreciation',
    `${age.toFixed(1)} yrs old · this make/body keeps ~${Math.round(residual5 * 100)}% after 5 yrs`,
    titled ? msrp * curveShare(firstYearLoss, Math.max(age, 0.05)) : msrp,
  );
  const mf = mileageFactor(input.mileage, expectedMiles);
  const milesDiff = input.mileage - expectedMiles;
  push(
    'Mileage',
    milesDiff >= 0
      ? `${Math.abs(milesDiff).toLocaleString()} mi above the ${expectedMiles.toLocaleString()} expected`
      : `${Math.abs(milesDiff).toLocaleString()} mi below the ${expectedMiles.toLocaleString()} expected`,
    v * mf,
  );
  push('Condition', cond.name, v * cond.mult);
  if (title.mult !== 1) push('Title status', title.name, v * title.mult);
  if (accident.mult !== 1) push('Accident history', accident.name, v * accident.mult);
  const reg = regionAdjustment(input.region, make, body);
  if (reg !== 0) push('Regional demand', `${input.region} (${reg > 0 ? '+' : ''}${Math.round(reg * 100)}%)`, v * (1 + reg));

  const floor = Math.max(500, msrp * 0.03);
  const ceiling = msrp * 0.98;
  const pp = clamp(v, Math.min(floor, ceiling), Math.max(ceiling, 0));

  // Dealer spread: cheaper cars carry a bigger percentage margin; rough cars
  // cost more to recondition, which comes out of the trade-in offer.
  const margin = clamp(0.18 - pp / 400_000, 0.08, 0.16);
  const tradeIn = Math.max(Math.min(floor, pp) * 0.6, pp - cond.recon - pp * margin);
  const dealerRetail = pp + pp * margin * 0.9 + cond.recon * 0.25;

  // Uncertainty band
  const reasons: string[] = [];
  let band = 0.05 + Math.min(0.06, age * 0.006);
  if (age > 8) reasons.push('Older vehicles vary more by individual history');
  if (title.name !== 'Clean') { band += 0.05; reasons.push(`${title.name} titles sell in a thin, unpredictable market`); }
  if (accident.name === 'Major') { band += 0.03; reasons.push('Structural damage values vary widely'); }
  if (make.name === 'Other') { band += 0.03; reasons.push('Brand-level retention is generic for "Other" makes'); }
  if (!input.model.trim()) { band += 0.02; reasons.push('Adding a model and trim narrows the estimate'); }
  if (Math.abs(milesDiff) > 40_000) { band += 0.02; reasons.push('Mileage is far from typical for this age'); }
  if (cond.name === 'Poor') { band += 0.03; reasons.push('Repair costs on rough cars are hard to predict'); }
  band = Math.min(0.22, band);
  const confidence = band <= 0.09 ? 'High' : band <= 0.14 ? 'Medium' : 'Low';
  if (reasons.length === 0) reasons.push('Typical mileage, clean history and a well-known brand');

  return {
    tradeIn,
    privateParty: pp,
    dealerRetail,
    range: { low: pp * (1 - band), high: pp * (1 + band) },
    bandPct: band,
    confidence,
    confidenceReasons: reasons,
    ageYears: age,
    expectedMiles,
    steps,
  };
}

/** Private-party value projected forward, assuming `milesPerYear` of driving. */
export function forecast(input: Inputs, years: number, milesPerYear: number, asOf: Date = new Date()) {
  const out: { year: string; value: number; low: number; high: number; mileage: number }[] = [];
  for (let i = 0; i <= years; i++) {
    const at = new Date(asOf.getFullYear() + i, asOf.getMonth(), 1);
    const mileage = input.mileage + i * milesPerYear;
    const r = valuate({ ...input, mileage }, at);
    out.push({
      year: String(at.getFullYear()),
      value: Math.round(r.privateParty),
      low: Math.round(r.range.low),
      high: Math.round(r.range.high),
      mileage,
    });
  }
  return out;
}
