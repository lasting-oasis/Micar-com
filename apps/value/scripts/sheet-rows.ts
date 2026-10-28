// Turns the data files into row arrays for the Google Sheet
// ("Queen City MyCarValue · Sticker prices and used-price calibration").
// Run: npx tsx scripts/sheet-rows.ts > /tmp/sheet-rows.json
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
    const guess = (c ? c : null) ? (calibration.models.find((x) => x.make === m.make && x.model === m.model) as { guess?: number } | undefined)?.guess ?? m.residual5 : m.residual5;
    return [m.make, m.model, m.body, m.traits.join(', '), m.typicalMsrp, guess, c ? c.residual5 : '', c ? c.n : '', c ? c.mae : '', stickerYears.get(`${m.make}|${m.model}`) ?? 0];
  }),
];

const stickerRows: (string | number)[][] = [
  ['Make', 'Model', 'Body style', 'Model year', 'Trim', 'Configuration', 'MSRP excl. destination ($)', 'Destination ($)', 'Source type', 'Source URL', 'Note'],
];
for (const s of stickers) for (const y of s.years) for (const t of y.trims) {
  stickerRows.push([s.make, s.model, s.body, `'${y.year}`, t.trim, t.config, t.msrp, y.destination ?? '', y.sourceType, y.source, [y.note, t.note].filter(Boolean).join(' ')]);
}

const sampleRows: (string | number)[][] = [
  ['Make', 'Model', 'Model year', 'Trim', 'Asking price ($)', 'Miles', 'Location', 'Body', 'Note', 'Page average ($)', 'Read on', 'Source URL'],
];
for (const s of samples) for (const p of s.samples) for (const l of p.listings) {
  sampleRows.push([s.make, s.model, `'${p.year}`, l.trim, l.price, l.miles, l.location, l.body, l.note, p.pageAverage ?? '', `'${p.fetched}`, p.source]);
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
    `=IFERROR(MEDIAN(FILTER('Used sample'!$E:$E,'Used sample'!$A:$A=$A${r},'Used sample'!$B:$B=$B${r},'Used sample'!$C:$C="${lo}")),"")`,
    `=IFERROR(MEDIAN(FILTER('Used sample'!$E:$E,'Used sample'!$A:$A=$A${r},'Used sample'!$B:$B=$B${r},'Used sample'!$C:$C="${hi}")),"")`,
    calibration.trimRetention, `'${calibration.fittedAt}`,
  ]);
});

const sources: (string | number)[][] = [
  ['Written to', 'Source', 'Object', 'Obtained via', 'Query or request', 'Parameters', 'Run at', 'Requested by', 'Row count', 'Changes after retrieval', 'Notes'],
];
for (const s of stickers) for (const y of s.years) {
  sources.push([`Stickers!A:K`, y.sourceType === 'manufacturer' ? `${s.make} pricing release` : 'Published price list (secondary)', y.source, 'Read by Claude (one page fetch)', `${y.year} ${s.make} ${s.model} trims and MSRP`, 'MSRP excl. destination', '2026-10-28', '', y.trims.length, 'None; trims listed base to top', y.note]);
}
for (const s of samples) for (const p of s.samples) {
  sources.push([`'Used sample'!A:L`, 'TrueCar used-car search results', p.source, 'Read by Claude (one page fetch, no pagination)', `${p.year} ${s.make} ${s.model}, trim ${p.trimFilter}`, 'First page of results', p.fetched, '', p.listings.length, 'Listings without mileage skipped', '']);
}

process.stdout.write(JSON.stringify({ models, stickers: stickerRows, samples: sampleRows, calibration: calRows, sources }));
