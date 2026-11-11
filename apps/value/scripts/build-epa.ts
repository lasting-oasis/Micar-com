// Builds src/data/epa-lineup.json from data/epa/vehicles.csv (EPA fuel-economy list,
// fetched by .github/workflows/epa.yml) and data/kaggle/base-msrp.json.
//
// For each make the site offers, it records which model years each model was actually
// sold (2005 on), its body style, and, for models without a hand-set row in models.ts,
// a typical sticker from the Kaggle "Car Features and MSRP" base prices (2015-2017),
// or none (the engine then uses the make + body average).
//
//   npm run build:epa
import { readFileSync, writeFileSync } from 'node:fs';
import { MAKES } from '../src/engine/data';
import { ROW_KEYS } from '../src/engine/models';
import { MAKE_ALIAS, matches, norm, parseCsv } from './epa-shared';

const FIRST_YEAR = 2005;

const [head, ...body] = parseCsv(readFileSync('data/epa/vehicles.csv', 'utf8'));
const col = (k: string) => head.indexOf(k);
const [cY, cMake, cModel, cBase, cClass] = ['year', 'make', 'model', 'baseModel', 'VClass'].map(col);

const siteMakes = new Set(MAKES.map((m) => m.name));

function bodyOf(vclass: string): string {
  if (/Pickup/.test(vclass)) return 'Pickup Truck';
  if (/Minivan|Vans/.test(vclass)) return 'Minivan';
  if (/Sport Utility|Special Purpose/.test(vclass)) return 'SUV / Crossover';
  if (/Station Wagon/.test(vclass)) return 'Hatchback / Wagon';
  if (/Two Seaters|Minicompact/.test(vclass)) return 'Coupe / Sports';
  return 'Sedan';
}

type Entry = { make: string; model: string; body: string; years: number[]; typicalMsrp?: number; listed: boolean };
const kaggle: Record<string, number> = JSON.parse(readFileSync('data/kaggle/base-msrp.json', 'utf8'));
const out = new Map<string, Entry & { bodies: Map<string, number>; yrs: Set<number> }>();
const get = (make: string, model: string, listed: boolean) => {
  const k = `${make}|${model}`;
  if (!out.has(k)) out.set(k, { make, model, body: '', years: [], listed, bodies: new Map(), yrs: new Set() });
  return out.get(k)!;
};

const ours = ROW_KEYS; // [make, model][] from models.ts
for (const r of body) {
  if (r.length < head.length) continue;
  const year = Number(r[cY]);
  if (year < FIRST_YEAR) continue;
  const make = MAKE_ALIAS[r[cMake]] ?? r[cMake];
  if (!siteMakes.has(make)) continue;
  let hits = ours.filter(([mk, mo]) => mk === make && matches(mk, mo, r[cModel]));
  if (!hits.length && r[cBase]) hits = ours.filter(([mk, mo]) => mk === make && norm(mo) === norm(r[cBase]));
  const targets = hits.length ? hits.map(([, mo]) => get(make, mo, true)) : [get(make, r[cBase] || r[cModel], false)];
  for (const t of targets) { t.yrs.add(year); t.bodies.set(bodyOf(r[cClass]), (t.bodies.get(bodyOf(r[cClass])) ?? 0) + 1); }
}

// Leftover one-off EPA spellings of models already listed.
const SKIP = new Set(['Chevrolet|Silverado', 'GMC|Sierra']);
const lineup: Entry[] = [...out.values()].filter((e) => !SKIP.has(`${e.make}|${e.model}`)).map((e) => {
  const body = [...e.bodies.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const years = [...e.yrs].sort((a, b) => a - b);
  const typicalMsrp = e.listed ? undefined : kaggle[`${e.make}|${norm(e.model)}`];
  return { make: e.make, model: e.model, body, years, listed: e.listed, ...(typicalMsrp ? { typicalMsrp } : {}) };
}).sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model));

writeFileSync('src/data/epa-lineup.json', JSON.stringify(lineup));
const added = lineup.filter((e) => !e.listed);
console.log(`${lineup.length} models (${lineup.length - added.length} already listed, ${added.length} added; ${added.filter((e) => e.typicalMsrp).length} with a Kaggle base price)`);
const missing = ours.filter(([mk, mo]) => !out.has(`${mk}|${mo}`));
console.log(`listed models with no EPA match (${missing.length}):`, missing.map((m) => m.join(' ')).join(', '));
