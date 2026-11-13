// Writes data/searlo/models.json, the list scripts/searlo_listings.py searches: every model the value page offers,
// the hand-set (most common) models first, then the rest newest first, so a run that stops early has done the ones
// most people look up. Run: npx tsx scripts/searlo-models.ts
import { writeFileSync } from 'node:fs';
import { MODELS } from '../src/engine/models';
import { STICKERS } from '../src/engine/stickers';

const sticker = new Set(STICKERS.map((s) => `${s.make}|${s.model}`));
const allYears = MODELS.flatMap((m) => m.years ?? []);
const PAGE_YEARS = Array.from({ length: Math.max(...allYears) - Math.min(...allYears) + 1 }, (_, i) => Math.min(...allYears) + i);
const rows = MODELS.map((m, i) => ({
  make: m.make,
  model: m.model,
  // "718 Cayman / Boxster": the first name is the one dealers list it under
  query: m.model.split(' / ')[0].trim(),
  // a hand-set model with no year list (F-250 Super Duty, Silverado 2500HD, Ram 2500) gets every year the page offers,
  // so the year filter still applies to its listings
  years: m.years?.length ? m.years : PAGE_YEARS,
  handSet: m.source !== 'epa',
  sticker: sticker.has(`${m.make}|${m.model}`),
  order: i,
}));
rows.sort((a, b) => Number(b.handSet) - Number(a.handSet) || (b.years.at(-1) ?? 0) - (a.years.at(-1) ?? 0) || a.order - b.order);
writeFileSync(new URL('../data/searlo/models.json', import.meta.url), JSON.stringify(rows.map(({ order, ...r }) => r)) + '\n');
console.log(`${rows.length} models, ${rows.filter((r) => r.handSet).length} hand-set, ${rows.filter((r) => !r.sticker).length} without stickers`);
