// Backtest: engine vs. real dealer asking prices for Honda Civics.
// Listings were read from TrueCar search pages on 2026-10-28; stickers from
// Honda's official pricing releases. Run with: npx vitest run backtest-civic
import { expect, it } from 'vitest';
import { MODELS, typicalMsrp } from './models';
import { CURVE, valuate, type Inputs } from './valuation';

const asOf = new Date(2026, 9, 28);
const civic = MODELS.find((m) => m.make === 'Honda' && m.model === 'Civic')!;

type Case = { year: number; trim: string; msrp: number; listings: [price: number, miles: number][] };
const CASES: Case[] = [
  { year: 2016, trim: 'LX CVT', msrp: 19440, listings: [[15675, 86008], [10070, 174890], [10383, 183889], [14125, 99404], [16073, 44084], [13988, 118605], [12488, 145452], [15178, 83646], [13845, 111064], [6795, 284017], [8295, 136166], [14378, 101524], [13999, 119211], [11274, 156788]] },
  { year: 2019, trim: 'LX CVT', msrp: 20250, listings: [[12045, 105642], [16476, 99290], [13022, 159860], [13998, 83832], [9264, 201511], [18291, 40636], [18716, 42349], [15584, 95076], [16921, 87305], [14600, 119220], [17739, 80040], [17695, 87493], [12490, 71531], [10149, 157447]] },
  { year: 2022, trim: 'Sport', msrp: 23300, listings: [[17813, 87202], [23208, 29365], [21072, 39110], [22985, 47209], [21486, 55848], [21683, 37594], [20655, 80580], [20833, 53000], [22367, 44544], [22514, 38612], [25387, 27724], [24188, 38582], [21170, 69195]] },
  { year: 2023, trim: 'Touring', msrp: 30050, listings: [[28426, 26068], [26373, 26243], [24575, 15722], [24326, 42158], [25241, 36201], [26038, 34568], [23797, 63226], [25119, 47694], [26170, 20945], [17987, 137400], [24676, 37334], [25643, 35995], [29231, 35313], [24377, 49345]] },
];

const base: Omit<Inputs, 'msrp' | 'year' | 'mileage'> = {
  make: 'Honda', model: 'Civic', trim: '', body: 'Sedan', condition: 'Good', title: 'Clean', accident: 'None',
  region: 'Southeast', market: 'normal', marketIndex: 0.179, listings: null, urgency: 'none', comps: [],
};

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;

function run(label: string, msrpOf: (c: Case) => number) {
  console.log(`\n=== ${label} ===`);
  const allErr: number[] = [];
  for (const c of CASES) {
    const errs = c.listings.map(([price, miles]) => {
      const r = valuate({ ...base, msrp: msrpOf(c), year: c.year, mileage: miles }, asOf);
      return (r.dealerRetail - price) / price;
    });
    allErr.push(...errs);
    const med = median(errs), mae = errs.reduce((a, e) => a + Math.abs(e), 0) / errs.length;
    console.log(`${c.year} Civic ${c.trim.padEnd(8)} MSRP used $${msrpOf(c).toLocaleString().padStart(6)} · ${String(errs.length).padStart(2)} listings · engine vs asking: median ${pct(med).padStart(7)} · mean abs ${pct(mae).padStart(6)}`);
  }
  console.log(`ALL ${allErr.length} listings: median ${pct(median(allErr))} · mean abs error ${pct(allErr.reduce((a, e) => a + Math.abs(e), 0) / allErr.length)}`);
}

it('backtest', () => {
  console.log('\nEngine prefill vs real sticker:');
  for (const c of CASES) {
    const pre = typicalMsrp(civic, c.year);
    console.log(`${c.year} ${c.trim.padEnd(8)} real $${c.msrp.toLocaleString()} · prefill $${pre.toLocaleString()} · ${pct((pre - c.msrp) / c.msrp)}`);
  }
  const shipped = { ...CURVE };
  const original = civic.residual5;
  // The engine before this backtest: old sticker as the basis, front-loaded curve.
  Object.assign(CURVE, { inflation: 0, decay: 0.85, driveOff: 0.4 });
  run('A. Before calibration, engine prefill MSRP (no inflation basis, decay 0.85)', (c) => typicalMsrp(civic, c.year));
  run('B. Before calibration, real sticker MSRP', (c) => c.msrp);
  Object.assign(CURVE, shipped);
  run('D. Engine as now shipped (inflation basis, calibrated curve), real sticker MSRP', (c) => c.msrp);
  run('E. Engine as now shipped, prefill MSRP', (c) => typicalMsrp(civic, c.year));

  // Grid search: inflation basis on, vary curve shape and residual.
  console.log('\n=== Grid (real sticker, inflation basis) : residual5 × decay → overall median / MAE, and per-year medians ===');
  const results: { r5: number; decay: number; mae: number; med: number; line: string }[] = [];
  for (const inflation of [0.03]) for (const decay of [0.85, 0.92, 1.0, 1.05]) for (const r5 of [0.58, 0.62, 0.66, 0.70]) {
    Object.assign(CURVE, { inflation, decay });
    civic.residual5 = r5;
    const errs: number[] = []; const perYear: string[] = [];
    for (const c of CASES) {
      const e = c.listings.map(([price, miles]) => (valuate({ ...base, msrp: c.msrp, year: c.year, mileage: miles }, asOf).dealerRetail - price) / price);
      errs.push(...e); perYear.push(`${c.year}:${pct(median(e))}`);
    }
    const mae = errs.reduce((a, e) => a + Math.abs(e), 0) / errs.length;
    results.push({ r5, decay, mae, med: median(errs), line: `r5 ${r5} decay ${decay}: median ${pct(median(errs)).padStart(6)} MAE ${pct(mae).padStart(6)} · ${perYear.join(' ')}` });
  }
  results.sort((a, b) => a.mae - b.mae);
  for (const r of results) console.log(r.line);
  civic.residual5 = original;
  Object.assign(CURVE, shipped);

  // Per-listing detail for the 2016 LX at the best setting, to see the mileage slope.
  Object.assign(CURVE, { inflation: 0.03, decay: results[0].decay });
  civic.residual5 = results[0].r5;
  console.log(`\n2016 Civic LX detail (best grid point r5 ${results[0].r5}, decay ${results[0].decay}, real MSRP $19,440): miles → asking vs engine retail`);
  for (const [price, miles] of CASES[0].listings) {
    const r = valuate({ ...base, msrp: 19440, year: 2016, mileage: miles }, asOf);
    console.log(`${miles.toLocaleString().padStart(8)} mi → asking $${price.toLocaleString().padStart(6)} · engine $${Math.round(r.dealerRetail).toLocaleString().padStart(6)} · ${pct((r.dealerRetail - price) / price).padStart(7)}`);
  }
  civic.residual5 = original;
  Object.assign(CURVE, shipped);

  // Regression guard: with real stickers the shipped engine must stay within
  // 10% mean absolute error and 5% median bias on these listings.
  const errs = CASES.flatMap((c) => c.listings.map(([price, miles]) => (valuate({ ...base, msrp: c.msrp, year: c.year, mileage: miles }, asOf).dealerRetail - price) / price));
  expect(errs.reduce((a, e) => a + Math.abs(e), 0) / errs.length).toBeLessThan(0.10);
  expect(Math.abs(median(errs))).toBeLessThan(0.05);
});
