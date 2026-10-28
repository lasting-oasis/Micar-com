// Turns the data files into row arrays for the Google Sheet
// ("Queen City MyCarValue · Sticker prices and used-price calibration").
// Run: npx tsx scripts/sheet-rows.ts > /tmp/sheet-rows.json
import { mkdirSync, writeFileSync } from 'node:fs';
import calibration from '../src/data/calibration.json';
import samples from '../src/data/listing-samples.json';
import stickers from '../src/data/stickers.json';
import { MODELS } from '../src/engine/models';

const fitted = new Map(calibration.models.map((c) => [`${c.make}|${c.model}`, c]));
const stickerYears = new Map(stickers.map((s) => [`${s.make}|${s.model}`, s.years.length]));

const models = [
  ['Make', 'Model', 'Body style', 'Traits', 'Typical sticker, 2025 ($, estimate)', 'Resale share after 5 yrs, guess', 'Resale share after 5 yrs, fitted', 'Listings used in fit', 'Mean abs. error of fit', 'Sticker years on file'],
  ...MODELS.map((m) => {
    const c = fitted.get(`${m.make}|${m.model}`);
    return [m.make, m.model, m.body, m.traits.join(', '), m.typicalMsrp, m.residual5Guess, c ? c.residual5 : '', c ? c.n : '', c ? c.mae : '', stickerYears.get(`${m.make}|${m.model}`) ?? 0];
  }),
];

// One row per trim. The year-level source note (which release, mid-year changes) is long and
// identical for every trim of a year, so it lives once per year on the Data Sources tab.
const stickerRows: (string | number)[][] = [
  ['Make', 'Model', 'Body style', 'Model year', 'Trim', 'Configuration', 'MSRP excl. destination ($)', 'Destination ($)', 'Source type', 'Trim note'],
];
for (const s of stickers) for (const y of s.years) for (const t of y.trims) {
  stickerRows.push([s.make, s.model, s.body, y.year, t.trim, t.config, t.msrp, y.destination ?? '', y.sourceType, t.note]);
}

const sampleRows: (string | number)[][] = [
  ['Make', 'Model', 'Model year', 'Trim', 'Asking price ($)', 'Miles', 'Location', 'Body', 'Note', 'Read on'],
];
for (const s of samples) for (const p of s.samples) for (const l of p.listings) {
  sampleRows.push([s.make, s.model, p.year, l.trim, l.price, l.miles, l.location, l.body, l.note, p.fetched]);
}

// Calibration: fitted numbers from the script, plus live formulas over the Used sample tab so the sample can be checked.
const calRows: (string | number)[][] = [
  ['Make', 'Model', 'Listings in fit', 'Dropped as outliers', 'Resale share, guess', 'Resale share, fitted', 'Mean abs. error', 'Median bias', 'Listings in sample (live)', 'Median asking, oldest year (live)', 'Median asking, newest year (live)', 'Trim content retention (global)', 'Fitted on'],
];
calibration.models.forEach((c, i) => {
  const r = i + 2;
  const years = Object.keys(c.byYear).map(Number).sort((a, b) => a - b);
  const lo = years[0], hi = years[years.length - 1];
  calRows.push([
    c.make, c.model, c.n, c.dropped, c.guess, c.residual5, c.mae, c.medianBias,
    `=COUNTIFS('Used sample'!$A:$A,$A${r},'Used sample'!$B:$B,$B${r})`,
    `=IFERROR(MEDIAN(FILTER('Used sample'!$E:$E,'Used sample'!$A:$A=$A${r},'Used sample'!$B:$B=$B${r},'Used sample'!$C:$C=${lo})),"")`,
    `=IFERROR(MEDIAN(FILTER('Used sample'!$E:$E,'Used sample'!$A:$A=$A${r},'Used sample'!$B:$B=$B${r},'Used sample'!$C:$C=${hi})),"")`,
    calibration.trimRetention, calibration.fittedAt,
  ]);
});

const sources: (string | number)[][] = [
  ['Written to', 'Source', 'Object', 'Obtained via', 'Query or request', 'Parameters', 'Run at', 'Requested by', 'Row count', 'Changes after retrieval', 'Notes'],
];
for (const s of stickers) for (const y of s.years) {
  sources.push([`Stickers (${y.year} ${s.make} ${s.model})`, y.sourceType === 'manufacturer' ? `${s.make} pricing release` : 'Published price list (secondary)', y.source, 'Read by Claude (one page fetch)', `${y.year} ${s.make} ${s.model} trims and MSRP`, 'MSRP excl. destination', '2026-10-28', '', y.trims.length, 'None; trims listed base to top', y.note]);
}
for (const s of samples) for (const p of s.samples) {
  sources.push([`Used sample (${p.year} ${s.make} ${s.model})`, 'TrueCar used-car search results', p.source, 'Read by Claude (one page fetch, no pagination)', `${p.year} ${s.make} ${s.model}, trim ${p.trimFilter}`, 'First page of results', p.fetched, '', p.listings.length, 'Listings without mileage skipped', p.pageAverage ? `Page states a model-wide average of $${p.pageAverage.toLocaleString()} (not year-specific; not used)` : '']);
}

// --csv <dir>: also write one CSV per tab (models, stickers, samples, sources) for the
// sheet to pull with IMPORTDATA from the public repo. Calibration has live formulas,
// so it is written through the Sheets API instead.
const csvAt = process.argv.indexOf('--csv');
if (csvAt > -1) {
  const dir = process.argv[csvAt + 1];
  const cell = (v: string | number) => (typeof v === 'number' ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = (rows: (string | number)[][]) => rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
  mkdirSync(dir, { recursive: true });
  for (const [name, rows] of Object.entries({ models, stickers: stickerRows, samples: sampleRows, sources })) writeFileSync(`${dir}/${name}.csv`, csv(rows));
}
process.stdout.write(JSON.stringify({ models, stickers: stickerRows, samples: sampleRows, calibration: calRows, sources }));
