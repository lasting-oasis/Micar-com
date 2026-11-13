// Fits the engine to the real listing samples.
//
// For each model with a sample in src/data/listing-samples.json, finds the
// residual5 (share of a new one's price after five years) that minimises the
// engine's error against real dealer asking prices, using each listing's own
// trim sticker when it is on file. Also fits one global trimRetention. Writes
// src/data/calibration.json, which models.ts applies at load.
//
// Also fits every model with enough of Searlo's dealer listings (data/searlo/listings.jsonl,
// scripts/searlo_listings.py; vehicle data by Searlo). Those stay out of src/ so the site never bundles them.
//
// Run: npx tsx scripts/calibrate.ts             (refits the curve on the hand-read samples, then every model)
//      npx tsx scripts/calibrate.ts --keep-curve (keeps the shipped curve; refits each model's residual only)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import samples from '../src/data/listing-samples.json';
import shipped from '../src/data/calibration.json';
import { MODELS, typicalMsrp } from '../src/engine/models';
import { baseMsrp, resolveStickerTrim, stickerFor } from '../src/engine/stickers';
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

// Searlo's dealer listings, one search per line; the used and certified cars with a mileage only.
type DealerListing = { year: number; trim: string; price: number; miles: number | null; condition: string; location: string };
const DEALER_FILE = new URL('../data/searlo/listings.jsonl', import.meta.url);
const dealerRows: { make: string; model: string; fetched: string; listings: DealerListing[] }[] = existsSync(DEALER_FILE)
  ? readFileSync(DEALER_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];
const dealerByModel = new Map<string, { fetched: string; listing: DealerListing }[]>();
for (const r of dealerRows) for (const l of r.listings ?? []) {
  if (l.condition === 'new' || l.miles == null || l.miles < 100) continue;
  const k = `${r.make}|${r.model}`;
  (dealerByModel.get(k) ?? dealerByModel.set(k, []).get(k)!).push({ fetched: r.fetched, listing: l });
}

/** The real asking prices for a model: the hand-read samples, and unless curatedOnly, Searlo's dealer listings. */
function observations(make: string, model: string, curatedOnly = false): Obs[] {
  const set = samples.find((s) => s.make === make && s.model === model);
  const info = MODELS.find((m) => m.make === make && m.model === model);
  const out: Obs[] = [];
  const priced = (year: number, trims: (string | undefined)[]): { msrp: number; baseM?: number; known: boolean } | null => {
    const st = stickerFor(make, model, year);
    if (st) return { msrp: resolveStickerTrim(st.year, trims, info?.body).msrp, baseM: baseMsrp(st.year), known: true };
    return info ? { msrp: typicalMsrp(info, year), known: false } : null;
  };
  if (!curatedOnly) for (const { fetched, listing: l } of dealerByModel.get(`${make}|${model}`) ?? []) {
    const p = priced(l.year, [l.trim]);
    if (!p) continue;
    out.push({ year: l.year, trim: l.trim, price: l.price, miles: l.miles!, region: regionOf(l.location), msrp: p.msrp, baseMsrp: p.baseM, stickerKnown: p.known, asOf: new Date(`${fetched}T12:00:00`), dealer: true });
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

function fitModel(make: string, model: string, trimRetention: number, step = 0.005, curatedOnly = false): Fit | null {
  const info = MODELS.find((m) => m.make === make && m.model === model);
  if (!info) return null;
  let obs = observations(make, model, curatedOnly);
  if (obs.length < 8) return null;
  const guess = info.residual5Guess;
  const search = () => {
    let best = { r5: guess, mae: Infinity };
    for (let r5 = 0.3; r5 <= 0.92; r5 += step) {
      info.residual5 = r5;
      CURVE.trimRetention = trimRetention;
      const m = mae(errors(make, model, info.body, obs));
      if (m < best.mae) best = { r5: Math.round(r5 * 1000) / 1000, mae: m };
    }
    return best;
  };
  // First pass, then drop listings the engine misses by more than 35% (damaged,
  // branded, mis-trimmed) and fit again.
  let best = search();
  info.residual5 = best.r5;
  const errs = errors(make, model, info.body, obs);
  const keep = obs.filter((_, i) => Math.abs(errs[i]) <= 0.35);
  const dropped = obs.length - keep.length;
  obs = keep;
  if (dropped) best = search();
  // Shrink toward the prior guess in proportion to sample size, so a model with
  // ~20 listings (round-2 samples) can't swing far on a few odd cars. With 80
  // listings the fit keeps ~91% weight; with 20, ~71%.
  best.r5 = Math.round(((obs.length * best.r5 + SHRINK_K * guess) / (obs.length + SHRINK_K)) * 1000) / 1000;
  info.residual5 = best.r5;
  const finalErrs = errors(make, model, info.body, obs);
  const byYear: Fit['byYear'] = {};
  obs.forEach((o, i) => { (byYear[o.year] ??= { n: 0, median: 0 }); byYear[o.year].n++; });
  for (const y of Object.keys(byYear)) byYear[y].median = Math.round(median(finalErrs.filter((_, i) => obs[i].year === Number(y))) * 1000) / 1000;
  info.residual5 = guess; // restore; the override is applied from calibration.json at load
  const dealer = obs.filter((o) => o.dealer).length;
  return { make, model, n: obs.length, dropped, residual5: best.r5, guess, mae: Math.round(mae(finalErrs) * 1000) / 1000, medianBias: Math.round(median(finalErrs) * 1000) / 1000, byYear, stickers: obs.filter((o) => o.stickerKnown).length, ...(dealer ? { dealer } : {}) };
}

// The curve is fitted on the hand-read samples only (as before the dealer listings); every model with real prices,
// hand-read or dealer-listed, then gets its own residual.
const curated = samples.map((s) => ({ make: s.make, model: s.model }));
const targets = [...curated, ...[...dealerByModel.keys()].map((k) => { const [make, model] = k.split('|'); return { make, model }; })]
  .filter((t, i, all) => all.findIndex((u) => u.make === t.make && u.model === t.model) === i);
const weighted = (fits: Fit[]) => fits.reduce((a, f) => a + f.mae * f.n, 0) / fits.reduce((a, f) => a + f.n, 0);

// Global curve shape and trim retention: coarse search over all models at once,
// with each model's residual re-fitted inside every combination.
let best = { driveOff: CURVE.driveOff, decay: CURVE.decay, tr: CURVE.trimRetention, total: Infinity, fits: [] as Fit[] };
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
  if (total < best.total - 1e-6) best = { driveOff, decay, tr, total, fits };
}
// Fine residual fit at the chosen curve.
Object.assign(CURVE, { driveOff: best.driveOff, decay: best.decay });
const fits = targets.map((t) => fitModel(t.make, t.model, best.tr)).filter((f): f is Fit => !!f);
const bestTr = { tr: best.tr, total: weighted(fits), fits };

const out = {
  fittedAt: ASOF.toISOString().slice(0, 10),
  marketIndex: MARKET_INDEX,
  curve: { driveOff: best.driveOff, decay: best.decay },
  trimRetention: bestTr.tr,
  models: bestTr.fits,
};
writeFileSync(new URL('../src/data/calibration.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');

console.log(`curve: driveOff ${best.driveOff}, decay ${best.decay}, trimRetention ${bestTr.tr} · weighted MAE ${(bestTr.total * 100).toFixed(1)}% over ${fits.reduce((a, f) => a + f.n, 0)} listings\n`);
console.log('model'.padEnd(28), 'n'.padStart(3), 'drop', 'guess', ' fit ', '  MAE', ' bias', ' by year');
for (const f of bestTr.fits) {
  console.log(`${f.make} ${f.model}`.padEnd(28), String(f.n).padStart(3), String(f.dropped).padStart(4), f.guess.toFixed(2).padStart(5), f.residual5.toFixed(3).padStart(5), `${(f.mae * 100).toFixed(1)}%`.padStart(6), `${f.medianBias >= 0 ? '+' : ''}${(f.medianBias * 100).toFixed(1)}%`.padStart(6), ' ', Object.entries(f.byYear).map(([y, v]) => `${y}:${v.median >= 0 ? '+' : ''}${(v.median * 100).toFixed(0)}%`).join(' '));
}
