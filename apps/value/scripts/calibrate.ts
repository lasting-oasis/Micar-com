// Fits the engine to the real listing samples.
//
// For each model with a sample in src/data/listing-samples.json, finds the
// residual5 (share of a new one's price after five years) that minimises the
// engine's error against real dealer asking prices, using each listing's own
// trim sticker when it is on file. Also fits one global trimRetention. Writes
// src/data/calibration.json, which models.ts applies at load.
//
// With --dealer it also fits models nobody has read samples for from Searlo's dealer listings
// (data/searlo/listings.jsonl, from scripts/searlo_listings.py; vehicle data by Searlo), which stay out of src/ so
// the site never bundles them. Off by default: in review such fits did not hold up on listings they were not fitted
// to (no better in other cities or on the hand-read samples, worse on older model years), so none ship. DEALER below
// holds the limits that review found a dealer-only fit needs.
//
// Run: npx tsx scripts/calibrate.ts              (refits the curve on the hand-read samples, then each sampled model)
//      npx tsx scripts/calibrate.ts --keep-curve (keeps the shipped curve; refits each model's residual only)
//      npx tsx scripts/calibrate.ts --dealer     (also adds the dealer-only fits that pass every limit in DEALER)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import samples from '../src/data/listing-samples.json';
import shipped from '../src/data/calibration.json';
import { MODELS, typicalMsrp } from '../src/engine/models';
import { baseMsrp, matchStickerTrim, resolveStickerTrim, stickerFor } from '../src/engine/stickers';
import { CURVE, valuate, type Inputs } from '../src/engine/valuation';
import type { Region } from '../src/engine/data';

const ASOF = new Date(2026, 9, 28);
const MARKET_INDEX = 0.179; // the national snapshot on the sample date

const REGION: Record<string, Region> = {
  CA: 'West', WA: 'West', OR: 'West', NV: 'West', UT: 'West', CO: 'West', ID: 'West', MT: 'West', WY: 'West', AK: 'West', HI: 'West',
  AZ: 'Southwest', NM: 'Southwest', TX: 'Southwest', OK: 'Southwest',
  FL: 'Southeast', GA: 'Southeast', NC: 'Southeast', SC: 'Southeast', VA: 'Southeast', AL: 'Southeast', MS: 'Southeast', TN: 'Southeast', KY: 'Southeast', LA: 'Southeast', AR: 'Southeast', WV: 'Southeast', MD: 'Southeast', DE: 'Southeast', DC: 'Southeast',
  NY: 'Northeast', NJ: 'Northeast', PA: 'Northeast', MA: 'Northeast', CT: 'Northeast', RI: 'Northeast', VT: 'Northeast', NH: 'Northeast', ME: 'Northeast',
  OH: 'Midwest', IL: 'Midwest', IN: 'Midwest', MI: 'Midwest', WI: 'Midwest', MN: 'Midwest', IA: 'Midwest', MO: 'Midwest', KS: 'Midwest', NE: 'Midwest', ND: 'Midwest', SD: 'Midwest',
};
const regionOf = (location: string): Region => REGION[(location.match(/,\s*([A-Z]{2})\b/) ?? [])[1] ?? ''] ?? 'Southeast';

type Obs = { year: number; trim: string; price: number; miles: number; region: Region; msrp: number; baseMsrp?: number; stickerKnown: boolean; asOf: Date; dealer: boolean };

// Searlo's dealer listings, one search per line. Only used cars with a mileage: the engine prices a car in Good
// condition, and certified ones ask more for the warranty (in review the engine missed them by a median -5.8%,
// used ones by -0.9%).
type DealerListing = { year: number; trim: string; price: number; miles: number | null; condition: string; location: string };
const DEALER_FILE = new URL('../data/searlo/listings.jsonl', import.meta.url);
const dealerRows: { make: string; model: string; city: string; fetched: string; listings: DealerListing[] }[] = existsSync(DEALER_FILE)
  ? readFileSync(DEALER_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];
const dealerByModel = new Map<string, { fetched: string; city: string; listing: DealerListing }[]>();
for (const r of dealerRows) for (const l of r.listings ?? []) {
  if (l.condition !== 'used' || l.miles == null || l.miles < 100) continue;
  const k = `${r.make}|${r.model}`;
  (dealerByModel.get(k) ?? dealerByModel.set(k, []).get(k)!).push({ fetched: r.fetched, city: r.city, listing: l });
}

/** The real asking prices for a model: the hand-read samples, and unless curatedOnly, Searlo's dealer listings. */
function observations(make: string, model: string, curatedOnly = false): Obs[] {
  const set = samples.find((s) => s.make === make && s.model === model);
  const info = MODELS.find((m) => m.make === make && m.model === model);
  const out: Obs[] = [];
  // A dealer listing counts only when its trim names a sticker on file. Falling back to the base trim's sticker
  // prices a Corvette Z06 as a 1LT (in review, 357 of 512 sticker-priced listings fell back).
  if (!curatedOnly) for (const { fetched, city, listing: l } of dealerByModel.get(`${make}|${model}`) ?? []) {
    const st = stickerFor(make, model, l.year);
    const trim = st && matchStickerTrim(st.year, [l.trim], info?.body);
    if (!st || !trim) continue;
    // the dealer's own city when the listing has one, else the metro the search was for
    out.push({ year: l.year, trim: l.trim, price: l.price, miles: l.miles!, region: regionOf(l.location || city), msrp: trim.msrp, baseMsrp: baseMsrp(st.year), stickerKnown: true, asOf: new Date(`${fetched}T12:00:00`), dealer: true });
  }
  if (!set) return out;
  for (const page of set.samples) {
    const st = stickerFor(make, model, page.year);
    for (const l of page.listings) {
      let msrp: number, baseM: number | undefined, known = false;
      if (st) {
        const t = resolveStickerTrim(st.year, [l.trim, page.trimFilter], info?.body);
        msrp = t.msrp; baseM = baseMsrp(st.year); known = true;
      } else if (info) {
        msrp = typicalMsrp(info, page.year);
      } else continue;
      out.push({ year: page.year, trim: l.trim || page.trimFilter, price: l.price, miles: l.miles, region: regionOf(l.location), msrp, baseMsrp: baseM, stickerKnown: known, asOf: ASOF, dealer: false });
    }
  }
  return out;
}

function errors(make: string, model: string, body: string, obs: Obs[]): number[] {
  return obs.map((o) => {
    const input: Inputs = {
      make, model, trim: o.trim, body, msrp: o.msrp, baseMsrp: o.baseMsrp, year: o.year, mileage: o.miles,
      condition: 'Good', title: 'Clean', accident: 'None', region: o.region,
      market: 'normal', marketIndex: MARKET_INDEX, listings: null, urgency: 'none', comps: [],
    };
    return (valuate(input, o.asOf).dealerRetail - o.price) / o.price;
  });
}

const SHRINK_K = 8; // pseudo-listings at the prior guess
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
const mae = (xs: number[]) => xs.reduce((a, e) => a + Math.abs(e), 0) / (xs.length || 1);

type Fit = { make: string; model: string; n: number; dropped: number; residual5: number; guess: number; mae: number; medianBias: number; byYear: Record<string, { n: number; median: number }>; stickers: number; dealer?: number };
// How a dealer-only fit did against the limits in DEALER; never written to calibration.json.
type Check = { raw: number; heldOut: number; dropShare: number; oldShare: number };

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const shrink = (r5: number, n: number, guess: number) => round3((n * r5 + SHRINK_K * guess) / (n + SHRINK_K));

function fitModel(make: string, model: string, trimRetention: number, step = 0.005, curatedOnly = false): (Fit & { check?: Check }) | null {
  const info = MODELS.find((m) => m.make === make && m.model === model);
  if (!info) return null;
  const guess = info.residual5Guess;
  const errorsAt = (r5: number, obs: Obs[]) => {
    info.residual5 = r5;
    CURVE.trimRetention = trimRetention;
    return errors(make, model, info.body, obs);
  };
  const search = (obs: Obs[]) => {
    let best = { r5: guess, mae: Infinity };
    for (let r5 = 0.3; r5 <= 0.92; r5 += step) {
      const m = mae(errorsAt(r5, obs));
      if (m < best.mae) best = { r5: round3(r5), mae: m };
    }
    return best.r5;
  };
  try {
    let obs = observations(make, model, curatedOnly);
    if (obs.length < 8) return null;
    // First pass, then drop listings the engine misses by more than 35% (damaged,
    // branded, mis-trimmed) and fit again.
    let raw = search(obs);
    const errs = errorsAt(raw, obs);
    const keep = obs.filter((_, i) => Math.abs(errs[i]) <= 0.35);
    const dropped = obs.length - keep.length;
    // too few left once the outliers are out (an exotic whose listings are all special editions): no fit
    if (keep.length < 8) return null;
    obs = keep;
    if (dropped) raw = search(obs);
    // Shrink toward the prior guess in proportion to sample size, so a model with
    // ~20 listings (round-2 samples) can't swing far on a few odd cars. With 80
    // listings the fit keeps ~91% weight; with 20, ~71%.
    const r5 = shrink(raw, obs.length, guess);
    const finalErrs = errorsAt(r5, obs);
    const byYear: Fit['byYear'] = {};
    obs.forEach((o) => { (byYear[o.year] ??= { n: 0, median: 0 }); byYear[o.year].n++; });
    for (const y of Object.keys(byYear)) byYear[y].median = round3(median(finalErrs.filter((_, i) => obs[i].year === Number(y))));
    const dealer = obs.filter((o) => o.dealer).length;
    const fit: Fit & { check?: Check } = { make, model, n: obs.length, dropped, residual5: r5, guess, mae: round3(mae(finalErrs)), medianBias: round3(median(finalErrs)), byYear, stickers: obs.filter((o) => o.stickerKnown).length, ...(dealer ? { dealer } : {}) };
    if (!curatedOnly) {
      // Out of sample: each fifth of the listings scored by a fit made without it. That mean miss replaces the
      // in-sample one, so the site's "typical miss" for the model is measured on listings it was not fitted to.
      const heldOut: number[] = [];
      for (let f = 0; f < 5; f++) {
        const train = obs.filter((_, i) => i % 5 !== f);
        heldOut.push(...errorsAt(shrink(search(train), train.length, guess), obs.filter((_, i) => i % 5 === f)));
      }
      fit.mae = round3(mae(heldOut));
      fit.check = { raw, heldOut: fit.mae, dropShare: dropped / (obs.length + dropped), oldShare: obs.filter((o) => o.asOf.getFullYear() - o.year >= 3).length / obs.length };
    }
    return fit;
  } finally {
    info.residual5 = guess; // restore; the override is applied from calibration.json at load
  }
}

// The hand-read samples are the authority: the curve and every model that has them are fitted on them alone.
const curated = samples.map((s) => ({ make: s.make, model: s.model }));
const isCurated = (make: string, model: string) => curated.some((c) => c.make === make && c.model === model);
const weighted = (fits: Fit[]) => fits.reduce((a, f) => a + f.mae * f.n, 0) / (fits.reduce((a, f) => a + f.n, 0) || 1);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// Global curve shape and trim retention: coarse search over all models at once,
// with each model's residual re-fitted inside every combination.
let best = { driveOff: CURVE.driveOff, decay: CURVE.decay, tr: CURVE.trimRetention, total: Infinity };
const quick = process.argv.includes('--quick');
const keepCurve = process.argv.includes('--keep-curve');
const grid = keepCurve
  ? { driveOff: [shipped.curve.driveOff], decay: [shipped.curve.decay], tr: [shipped.trimRetention] }
  : quick
  ? { driveOff: [CURVE.driveOff], decay: [CURVE.decay], tr: [0.6, 0.8, 1.0] }
  : { driveOff: [2.0, 2.4, 2.8, 3.2, 3.6, 4.0], decay: [1.05, 1.1, 1.15, 1.2], tr: [0.4, 0.5, 0.6, 0.7, 0.8] };
for (const driveOff of grid.driveOff) for (const decay of grid.decay) for (const tr of grid.tr) {
  Object.assign(CURVE, { driveOff, decay });
  const fits = curated.map((t) => fitModel(t.make, t.model, tr, 0.01, true)).filter((f): f is Fit => !!f);
  const total = weighted(fits);
  if (total < best.total - 1e-6) best = { driveOff, decay, tr, total };
}
// Fine residual fit at the chosen curve.
Object.assign(CURVE, { driveOff: best.driveOff, decay: best.decay });
const curatedFits = curated.map((t) => fitModel(t.make, t.model, best.tr, 0.005, true)).filter((f): f is Fit => !!f);

// --dealer: models nobody has read samples for, fitted on Searlo's dealer listings, each kept only when it passes
// every limit review found such a fit needs. A big miss or move is usually a trim mix the stickers cannot see.
const DEALER = {
  maxHeldOut: 0.15, // mean miss on the listings each fold was not fitted to
  maxShift: 0.1, // the raw fit's distance from the prior guess (shrinkage hides most of it at small n)
  maxDropped: 0.2, // share of the listings missed by more than 35%
  minOld: 0.25, // share of the listings 3+ model years old: residual5 is the value at five years, not at one
};
const useDealer = process.argv.includes('--dealer');
const leftOut: string[] = [];
const dealerFits: Fit[] = [];
if (useDealer) for (const [k, used] of dealerByModel) {
  const [make, model] = k.split('|');
  if (isCurated(make, model) || used.length < 8) continue;
  const f = fitModel(make, model, best.tr);
  if (!f?.check) {
    leftOut.push(`${make} ${model} (no fit: fewer than 8 of its ${used.length} used listings have a matched trim and a miss within 35%)`);
    continue;
  }
  const c = f.check;
  const why = [
    c.heldOut > DEALER.maxHeldOut && `held-out miss ${pct(c.heldOut)}`,
    Math.abs(c.raw - f.guess) > DEALER.maxShift && `raw fit ${f.guess} -> ${c.raw}`,
    c.dropShare > DEALER.maxDropped && `${pct(c.dropShare)} missed by 35%+`,
    c.oldShare < DEALER.minOld && `${pct(c.oldShare)} 3+ years old`,
  ].filter(Boolean);
  delete f.check;
  if (why.length) leftOut.push(`${make} ${model} (${f.n} listings: ${why.join(', ')})`);
  else dealerFits.push(f);
}
const fits = [...curatedFits, ...dealerFits];

const out = {
  fittedAt: ASOF.toISOString().slice(0, 10),
  marketIndex: MARKET_INDEX,
  curve: { driveOff: best.driveOff, decay: best.decay },
  trimRetention: best.tr,
  models: fits,
};
writeFileSync(new URL('../src/data/calibration.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');

console.log(`curve: driveOff ${best.driveOff}, decay ${best.decay}, trimRetention ${best.tr} · weighted MAE ${pct(weighted(curatedFits))} over ${curatedFits.reduce((a, f) => a + f.n, 0)} hand-read listings\n`);
if (useDealer) console.log(`dealer-only fits: ${dealerFits.length}${dealerFits.length ? `, weighted held-out MAE ${pct(weighted(dealerFits))} over ${dealerFits.reduce((a, f) => a + f.n, 0)} listings` : ''}\n`);
if (leftOut.length) console.log(`dealer-only models left out (${leftOut.length}): ${leftOut.join('; ')}\n`);
console.log('model'.padEnd(28), 'n'.padStart(3), 'drop', 'guess', ' fit ', '  MAE', ' bias', ' by year');
for (const f of fits) {
  console.log(`${f.make} ${f.model}`.padEnd(28), String(f.n).padStart(3), String(f.dropped).padStart(4), f.guess.toFixed(2).padStart(5), f.residual5.toFixed(3).padStart(5), `${(f.mae * 100).toFixed(1)}%`.padStart(6), `${f.medianBias >= 0 ? '+' : ''}${(f.medianBias * 100).toFixed(1)}%`.padStart(6), ' ', Object.entries(f.byYear).map(([y, v]) => `${y}:${v.median >= 0 ? '+' : ''}${(v.median * 100).toFixed(0)}%`).join(' '));
}
