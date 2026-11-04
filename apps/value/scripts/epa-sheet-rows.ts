// Rows for the sheet's "EPA lineup" tab (also exports/epa-lineup.csv).
import { writeFileSync } from 'node:fs';
import { MODELS, yearRanges } from '../src/engine/models';
import stickers from '../src/data/stickers.json';

const onFile = new Map<string, number>();
for (const s of stickers as { make: string; model: string; years: unknown[] }[]) onFile.set(`${s.make}|${s.model}`, s.years.length);
const rows: (string | number)[][] = [['Make', 'Model', 'Body style', 'Years sold (EPA)', 'First year', 'Last year', 'On the site as', 'Real sticker years on file']];
for (const m of [...MODELS].sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model))) {
  const y = m.years ?? [];
  rows.push([m.make, m.model, m.body, y.length ? yearRanges(y) : 'not rated', y[0] ?? '', y[y.length - 1] ?? '',
    m.source ? 'EPA list, estimated' : m.calibrated ? 'Researched' : 'Hand-set', onFile.get(`${m.make}|${m.model}`) ?? 0]);
}
const cell = (v: string | number) => (typeof v === 'number' ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
writeFileSync('exports/epa-lineup.csv', rows.map((r) => r.map(cell).join(',')).join('\n') + '\n');
// Sheets: keep number-like names as text.
process.stdout.write(JSON.stringify(rows.map((r) => r.map((v) => (typeof v === 'string' && /^[\d.]+$/.test(v) ? `'${v}` : v)))));
