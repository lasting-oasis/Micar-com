// How far the shipped engine is from Searlo's real dealer asking prices (data/searlo/listings.jsonl): the error of
// its dealer-retail value against each used listing, per model and overall, the same measure calibrate.ts minimises.
// Certified cars are left out, as in calibrate.ts --dealer: they ask more for the warranty than a Good car is worth.
// "Matched" counts only listings whose trim names a sticker on file; the rest are priced as the base trim.
// Run before and after a calibration to see what it changed: npx tsx scripts/dealer-check.ts [--all]
import { readFileSync } from 'node:fs';
import { MODELS, typicalMsrp } from '../src/engine/models';
import { CALIBRATION } from '../src/engine/models';
import { baseMsrp, matchStickerTrim, resolveStickerTrim, stickerFor } from '../src/engine/stickers';
import { CURVE, valuate, type Inputs } from '../src/engine/valuation';
import type { Region } from '../src/engine/data';

Object.assign(CURVE, { driveOff: CALIBRATION.curve.driveOff, decay: CALIBRATION.curve.decay, trimRetention: CALIBRATION.trimRetention });
const REGION: Record<string, Region> = {};
for (const s of 'CA WA OR NV UT CO ID MT WY AK HI'.split(' ')) REGION[s] = 'West';
for (const s of 'AZ NM TX OK'.split(' ')) REGION[s] = 'Southwest';
for (const s of 'FL GA NC SC VA AL MS TN KY LA AR WV MD DE DC'.split(' ')) REGION[s] = 'Southeast';
for (const s of 'NY NJ PA MA CT RI VT NH ME'.split(' ')) REGION[s] = 'Northeast';
for (const s of 'OH IL IN MI WI MN IA MO KS NE ND SD'.split(' ')) REGION[s] = 'Midwest';
const regionOf = (loc: string): Region => REGION[(loc.match(/,\s*([A-Z]{2})\b/) ?? [])[1] ?? ''] ?? 'Southeast';
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };

type Row = { make: string; model: string; city: string; fetched: string; listings: { year: number; trim: string; price: number; miles: number | null; condition: string; location: string }[] };
const rows: Row[] = readFileSync(new URL('../data/searlo/listings.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const by = new Map<string, { fetched: string; city: string; l: Row['listings'][number] }[]>();
for (const r of rows) for (const l of r.listings) if (l.condition === 'used' && l.miles != null && l.miles >= 100) (by.get(`${r.make}|${r.model}`) ?? by.set(`${r.make}|${r.model}`, []).get(`${r.make}|${r.model}`)!).push({ fetched: r.fetched, city: r.city, l });

const all: number[] = [], kept: number[] = [], matched: number[] = [];
const lines: string[] = [];
for (const [k, obs] of by) {
  if (obs.length < 8 && !process.argv.includes('--all')) continue;
  const [make, model] = k.split('|');
  const info = MODELS.find((m) => m.make === make && m.model === model);
  if (!info) continue;
  const errs = obs.map(({ fetched, city, l }) => {
    const st = stickerFor(make, model, l.year);
    const trim = st && matchStickerTrim(st.year, [l.trim], info.body);
    const msrp = trim ? trim.msrp : st ? resolveStickerTrim(st.year, [l.trim], info.body).msrp : typicalMsrp(info, l.year);
    const input: Inputs = { make, model, trim: l.trim, body: info.body, msrp, baseMsrp: st ? baseMsrp(st.year) : undefined, year: l.year, mileage: l.miles!, condition: 'Good', title: 'Clean', accident: 'None', region: regionOf(l.location || city), market: 'normal', marketIndex: CALIBRATION.marketIndex, listings: null, urgency: 'none', comps: [] };
    const err = (valuate(input, new Date(`${fetched}T12:00:00`)).dealerRetail - l.price) / l.price;
    if (trim && Math.abs(err) <= 0.35) matched.push(err);
    return err;
  });
  all.push(...errs);
  const k35 = errs.filter((e) => Math.abs(e) <= 0.35);
  kept.push(...k35);
  const mae = k35.reduce((a, e) => a + Math.abs(e), 0) / (k35.length || 1);
  lines.push(`${`${make} ${model}`.padEnd(30)} ${String(obs.length).padStart(3)} listings  MAE ${(mae * 100).toFixed(1).padStart(5)}%  bias ${(median(k35) * 100).toFixed(1).padStart(6)}%  ${info.calibrated ? 'calibrated' : ''}`);
}
const mae = (xs: number[]) => xs.reduce((a, e) => a + Math.abs(e), 0) / (xs.length || 1);
if (process.argv.includes('--models')) console.log(lines.sort().join('\n'));
console.log(`${by.size} models with dealer listings; checked ${all.length} listings: within 35% ${kept.length}; MAE of those ${(mae(kept) * 100).toFixed(1)}%, median bias ${(median(kept) * 100).toFixed(1)}%; MAE of all ${(mae(all) * 100).toFixed(1)}%`);
console.log(`matched trims: ${matched.length} of those within 35%; MAE ${(mae(matched) * 100).toFixed(1)}%, median bias ${(median(matched) * 100).toFixed(1)}%`);
