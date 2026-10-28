import {
  ACCIDENTS, BODY_STYLES, CONDITIONS, MAKES, TITLES, regionAdjustment,
  type Make, type Region,
} from './data';
import { findModel, TRAIT_NOTES, type Trait } from './models';

export const MILES_PER_YEAR = 12_000;
/** A "normal" number of similar cars listed within driving distance. */
export const TYPICAL_LISTINGS = 10;

export type MarketCondition = 'soft' | 'normal' | 'tight';
export type Urgency = 'none' | 'month' | 'week';

export type Inputs = {
  make: string;
  /** Model name from the MODELS table, or '' when not listed. */
  model: string;
  trim: string;
  body: string;
  msrp: number;
  year: number;
  mileage: number;
  condition: string;
  title: string;
  accident: string;
  region: Region;
  /** The used-car market cycle right now (used when marketIndex is null). */
  market: MarketCondition;
  /** Market cycle from the weekly national snapshot, -1 (very soft) to 1 (very tight); null = use `market`. */
  marketIndex: number | null;
  /** Short description of where marketIndex came from, for the ledger. */
  marketNote?: string;
  /** How many similar cars are listed nearby; null when unknown. */
  listings: number | null;
  /** How fast the car needs to sell. */
  urgency: Urgency;
  /** Asking prices seen for similar cars nearby. */
  comps: number[];
};

export type Step = { label: string; detail: string; value: number; delta: number };

export type Valuation = {
  tradeIn: number;
  privateParty: number;
  dealerRetail: number;
  /** Private-party value before local comps were blended in. */
  modelEstimate: number;
  range: { low: number; high: number };
  bandPct: number;
  confidence: 'High' | 'Medium' | 'Low';
  confidenceReasons: string[];
  /** Plain-language reasons this model holds or loses value. */
  drivers: string[];
  traits: Trait[];
  modelKnown: boolean;
  compsUsed: number;
  compsIgnored: number;
  ageYears: number;
  expectedMiles: number;
  steps: Step[];
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Vehicle age in years, matching how depreciation studies count it: a model
 * year is treated as "born" mid-way through its name year, so a 2021 model is
 * five years old in mid-2026. */
export function vehicleAge(modelYear: number, asOf: Date): number {
  const fractional = asOf.getFullYear() + (asOf.getMonth() + 0.5) / 12;
  return clamp(fractional - (modelYear + 0.5), 0, 60);
}

const DECAY = 0.85; // each year loses ~15% less than the year before
const DRIVE_OFF = 0.4; // titling hit, as a fraction of the first year's loss

/** Share of MSRP kept after `age` years for a car losing `firstYearLoss`
 * in its first year, before mileage/condition. */
export function curveShare(firstYearLoss: number, age: number): number {
  if (age <= 0) return 1;
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

/** Traits assumed for a make when the model isn't in the table. */
function traitsForMake(make: Make): Trait[] {
  switch (make.segment) {
    case 'Economy': return ['reliability'];
    case 'Luxury': return ['luxury'];
    case 'EV': return ['ev'];
    case 'Truck': return ['truck'];
    case 'Performance': return ['enthusiast'];
    default: return [];
  }
}

/** How strongly a model reacts to oversupply and to the market cycle.
 * Fleet-heavy and luxury models swing more; reliability and enthusiast
 * models have a demand floor and swing less. */
export function elasticity(traits: Trait[]): { supply: number; market: number } {
  let supply = 0.055, market = 1.0;
  for (const t of traits) {
    if (t === 'fleet') { supply += 0.03; market += 0.15; }
    if (t === 'luxury') { supply += 0.015; market += 0.3; }
    if (t === 'ev') { supply += 0.02; market += 0.4; }
    if (t === 'reliability') { supply -= 0.015; market -= 0.2; }
    if (t === 'enthusiast') { supply -= 0.02; market -= 0.15; }
    if (t === 'truck') { supply -= 0.01; market -= 0.1; }
  }
  return { supply: clamp(supply, 0.025, 0.1), market: clamp(market, 0.6, 1.6) };
}

/** Price pressure from the number of similar cars listed nearby.
 * More listings than typical → sellers undercut each other; fewer → scarcity premium. */
export function supplyAdjustment(listings: number, supplySensitivity: number): number {
  const ratio = Math.max(1, listings) / TYPICAL_LISTINGS;
  return clamp(-supplySensitivity * Math.log(ratio), -0.18, 0.08);
}

const MARKET_SWING: Record<MarketCondition, number> = { soft: -0.07, normal: 0, tight: 0.07 };
const URGENCY_DISCOUNT: Record<Urgency, number> = { none: 0, month: -0.03, week: -0.07 };
/** Buyers typically pay a little under asking. */
const ASKING_TO_SALE = 0.96;

export function valuate(input: Inputs, asOf: Date = new Date()): Valuation {
  const make = MAKES.find((m) => m.name === input.make) ?? MAKES[MAKES.length - 1];
  const body = BODY_STYLES.find((b) => b.name === input.body) ?? BODY_STYLES[0];
  const cond = CONDITIONS.find((c) => c.name === input.condition) ?? CONDITIONS[1];
  const title = TITLES.find((t) => t.name === input.title) ?? TITLES[0];
  const accident = ACCIDENTS.find((a) => a.name === input.accident) ?? ACCIDENTS[0];
  const info = findModel(input.make, input.model);

  const msrp = Math.max(0, input.msrp);
  const age = vehicleAge(input.year, asOf);
  const expectedMiles = Math.round(age * MILES_PER_YEAR);
  // A listed model carries its own observed resale share; otherwise fall back to make + body.
  const residual5 = info ? info.residual5 : clamp(make.residual5 + body.adj, 0.25, 0.85);
  const traits = info ? info.traits : traitsForMake(make);
  const el = elasticity(traits);
  const firstYearLoss = lossForResidual(residual5);

  const steps: Step[] = [];
  let v = msrp;
  const push = (label: string, detail: string, next: number) => {
    steps.push({ label, detail, value: next, delta: next - v });
    v = next;
  };
  steps.push({ label: 'Original MSRP', detail: `${input.year} ${make.name} ${input.model || input.body}`.trim(), value: msrp, delta: 0 });

  const titled = age > 0 || input.mileage > 0;
  push(
    'Age and model resale',
    info
      ? `${age.toFixed(1)} yrs old · this model typically keeps ~${Math.round(residual5 * 100)}% of MSRP after 5 yrs`
      : `${age.toFixed(1)} yrs old · a ${make.name} ${body.name.toLowerCase()} typically keeps ~${Math.round(residual5 * 100)}% of MSRP after 5 yrs`,
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

  // Market layer: cycle, local supply, urgency.
  const baseSwing = input.marketIndex !== null ? clamp(input.marketIndex, -1, 1) * 0.07 : MARKET_SWING[input.market];
  const swing = baseSwing * el.market;
  if (Math.abs(swing) >= 0.0005) {
    const sensitivity = `this model swings ${el.market >= 1.15 ? 'more' : el.market <= 0.85 ? 'less' : 'about as much'} than average`;
    push(
      'Market conditions',
      input.marketIndex !== null
        ? `${input.marketNote ?? 'National used-car price trend'} · ${sensitivity}`
        : `${input.market === 'soft' ? 'Soft' : 'Tight'} used-car market · ${sensitivity}`,
      v * (1 + swing),
    );
  }
  if (input.listings !== null) {
    const adj = supplyAdjustment(input.listings, el.supply);
    push(
      'Local supply',
      `${input.listings} similar cars listed nearby · about ${TYPICAL_LISTINGS} is typical${el.supply >= 0.07 ? ' · this model gets undercut easily' : el.supply <= 0.04 ? ' · steady demand limits undercutting' : ''}`,
      v * (1 + adj),
    );
  }
  const urgency = URGENCY_DISCOUNT[input.urgency];
  if (urgency !== 0) push('Priced to sell', input.urgency === 'week' ? 'Needs to sell this week' : 'Needs to sell within a month', v * (1 + urgency));

  const floor = Math.max(500, msrp * 0.03);
  const ceiling = msrp * 0.98;
  const modelEstimate = clamp(v, Math.min(floor, ceiling), Math.max(ceiling, 0));
  v = modelEstimate;

  // Real asking prices pull the estimate toward the market, more so with more comps.
  const validComps = input.comps.filter((c) => c >= modelEstimate * 0.4 && c <= modelEstimate * 2.5);
  const compsIgnored = input.comps.length - validComps.length;
  let w = 0;
  if (validComps.length) {
    w = validComps.length / (validComps.length + 1.5);
    const med = median(validComps);
    push(
      'Local asking prices',
      `${validComps.length} comp${validComps.length > 1 ? 's' : ''}, median $${Math.round(med).toLocaleString()} asking · buyers usually pay ~${Math.round((1 - ASKING_TO_SALE) * 100)}% less`,
      modelEstimate * (1 - w) + med * ASKING_TO_SALE * w,
    );
  }
  const pp = v;

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
  if (!info) { band += 0.03; reasons.push(input.make === 'Other' ? 'Brand-level resale is generic for unlisted makes' : 'Pick a listed model to use model-specific resale data'); }
  if (Math.abs(milesDiff) > 40_000) { band += 0.02; reasons.push('Mileage is far from typical for this age'); }
  if (cond.name === 'Poor') { band += 0.03; reasons.push('Repair costs on rough cars are hard to predict'); }
  if (input.listings === null) { band += 0.01; reasons.push('Add how many similar cars are listed nearby to account for local supply'); }
  if (validComps.length) {
    band *= 1 - 0.5 * w;
    reasons.push(`Anchored on ${validComps.length} real asking price${validComps.length > 1 ? 's' : ''} you entered`);
  }
  if (compsIgnored) reasons.push(`${compsIgnored} asking price${compsIgnored > 1 ? 's' : ''} ignored as too far from the estimate (different trim or a typo?)`);
  band = clamp(band, 0.03, 0.22);
  const confidence = band <= 0.09 ? 'High' : band <= 0.14 ? 'Medium' : 'Low';
  if (reasons.length === 0) reasons.push('Typical mileage, clean history and a well-known model');

  const drivers = traits.map((t) => TRAIT_NOTES[t]);
  if (!drivers.length) drivers.push('Mainstream demand: holds value about as well as the average car.');

  return {
    tradeIn,
    privateParty: pp,
    dealerRetail,
    modelEstimate,
    range: { low: pp * (1 - band), high: pp * (1 + band) },
    bandPct: band,
    confidence,
    confidenceReasons: reasons,
    drivers,
    traits,
    modelKnown: !!info,
    compsUsed: validComps.length,
    compsIgnored,
    ageYears: age,
    expectedMiles,
    steps,
  };
}

/** Private-party value projected forward, assuming `milesPerYear` of driving.
 * Today's comps anchor the whole curve: the ratio of market to model price is carried forward. */
export function forecast(input: Inputs, years: number, milesPerYear: number, asOf: Date = new Date()) {
  const today = valuate(input, asOf);
  const anchor = today.modelEstimate > 0 ? today.privateParty / today.modelEstimate : 1;
  const base: Inputs = { ...input, comps: [] };
  const out: { year: string; value: number; low: number; high: number; mileage: number }[] = [];
  for (let i = 0; i <= years; i++) {
    const at = new Date(asOf.getFullYear() + i, asOf.getMonth(), 1);
    const mileage = input.mileage + i * milesPerYear;
    const r = valuate({ ...base, mileage }, at);
    out.push({
      year: String(at.getFullYear()),
      value: Math.round(r.privateParty * anchor),
      low: Math.round(r.privateParty * anchor * (1 - today.bandPct)),
      high: Math.round(r.privateParty * anchor * (1 + today.bandPct)),
      mileage,
    });
  }
  return out;
}
