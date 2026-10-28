// Merges the research JSON (data/research/**) into the two files the app and
// the calibration read: src/data/stickers.json and src/data/listing-samples.json.
// Run: npx tsx scripts/build-data.ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (dir: string) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: f, json: JSON.parse(readFileSync(join(ROOT, dir, f), 'utf8')) }));

type RawSticker = { make: string; model: string; body: string; note?: string; gaps?: string[]; years: { year: number; destination?: number | null; trims: { trim: string; msrp: number; config?: string; note?: string }[]; source: string; source_type: string; note?: string }[] };
type RawListings = { make: string; model: string; gaps?: string[]; samples: { year: number; trim_filter: string; source: string; fetched: string; page_average: number | null; listings: { price: number; miles: number; location?: string; trim?: string; body?: string; note?: string }[] }[] };

const problems: string[] = [];
const stickers = read('data/research/stickers').map(({ file, json }) => {
  const s = json as RawSticker;
  const years = (s.years ?? [])
    .filter((y) => Number.isInteger(y.year) && y.year >= 2010 && y.year <= 2027)
    .map((y) => {
      const trims = (y.trims ?? [])
        .filter((t) => t && typeof t.trim === 'string' && Number.isFinite(Number(t.msrp)) && Number(t.msrp) >= 5000 && Number(t.msrp) <= 200000)
        .map((t) => ({ trim: t.trim.trim(), msrp: Math.round(Number(t.msrp)), config: (t.config ?? '').trim(), note: (t.note ?? '').trim() }));
      if (!trims.length) problems.push(`${file}: ${y.year} has no usable trims`);
      // Base trim first: cheapest configuration of the first listed trim.
      return { year: y.year, destination: y.destination ?? null, trims, source: y.source, sourceType: y.source_type === 'manufacturer' ? 'manufacturer' : 'secondary', note: (y.note ?? '').trim() };
    })
    .filter((y) => y.trims.length)
    .sort((a, b) => a.year - b.year);
  return { make: s.make, model: s.model, body: s.body, note: s.note ?? '', gaps: s.gaps ?? [], years };
});

const samples = read('data/research/listings').map(({ file, json }) => {
  const s = json as RawListings;
  const out = (s.samples ?? []).map((p) => ({
    year: p.year, trimFilter: p.trim_filter, source: p.source, fetched: p.fetched, pageAverage: p.page_average ?? null,
    listings: (p.listings ?? [])
      .filter((l) => Number.isFinite(Number(l.price)) && Number.isFinite(Number(l.miles)) && Number(l.price) >= 1500 && Number(l.miles) >= 100)
      .map((l) => ({ price: Math.round(Number(l.price)), miles: Math.round(Number(l.miles)), location: l.location ?? '', trim: (l.trim ?? p.trim_filter ?? '').trim(), body: l.body ?? '', note: l.note ?? '' })),
  })).filter((p) => p.listings.length);
  if (!out.length) problems.push(`${file}: no usable samples`);
  return { make: s.make, model: s.model, gaps: s.gaps ?? [], samples: out };
});

writeFileSync(join(ROOT, 'src/data/stickers.json'), JSON.stringify(stickers, null, 1) + '\n');
writeFileSync(join(ROOT, 'src/data/listing-samples.json'), JSON.stringify(samples, null, 1) + '\n');
const nSticker = stickers.reduce((a, s) => a + s.years.reduce((b, y) => b + y.trims.length, 0), 0);
const nList = samples.reduce((a, s) => a + s.samples.reduce((b, p) => b + p.listings.length, 0), 0);
console.log(`${stickers.length} models with stickers (${nSticker} trim-year prices), ${samples.length} models with samples (${nList} listings)`);
for (const p of problems) console.warn('!', p);
