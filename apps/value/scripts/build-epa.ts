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

const FIRST_YEAR = 2005;

function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); out.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}

const [head, ...body] = parseCsv(readFileSync('data/epa/vehicles.csv', 'utf8'));
const col = (k: string) => head.indexOf(k);
const [cY, cMake, cModel, cBase, cClass] = ['year', 'make', 'model', 'baseModel', 'VClass'].map(col);

// EPA make names -> site make names.
const MAKE_ALIAS: Record<string, string> = { MINI: 'Mini', smart: 'Smart', 'McLaren Automotive': 'McLaren' };
const siteMakes = new Set(MAKES.map((m) => m.name));

function bodyOf(vclass: string): string {
  if (/Pickup/.test(vclass)) return 'Pickup Truck';
  if (/Minivan|Vans/.test(vclass)) return 'Minivan';
  if (/Sport Utility|Special Purpose/.test(vclass)) return 'SUV / Crossover';
  if (/Station Wagon/.test(vclass)) return 'Hatchback / Wagon';
  if (/Two Seaters|Minicompact/.test(vclass)) return 'Coupe / Sports';
  return 'Sedan';
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
// How EPA spells some of our models. Default: our model's words are the first words of the EPA name.
const MATCH: Record<string, RegExp> = {
  'Mazda|Mazda3': /^(mazda ?)?3( |$)/i,
  'Mazda|CX-5': /^cx-5/i,
  'Toyota|GR86': /^(gr ?)?86/i,
  'Mazda|MX-5 Miata': /^mx-5/i,
  'Chevrolet|Bolt EV': /^bolt(?! euv)/i,
  'Chrysler|300': /(^| )300/i,
  'Chevrolet|Silverado 1500': /^silverado(?!.*(2500|3500|hd))/i,
  'GMC|Sierra 1500': /^sierra(?!.*(2500|3500|hd))/i,
  'Ram|1500': /^(ram )?1500/i,
  'Kia|Forte / K4': /^(forte|k4)/i,
  'Porsche|718 Cayman / Boxster': /^(718 )?(cayman|boxster|spyder|gt4)/i,
  'Mercedes-Benz|GLA': /^(amg )?gla\d*/i,
  'Mercedes-Benz|GLB': /^(amg )?glb\d*/i,
  'Mercedes-Benz|GLC': /^(amg )?glc\d*/i,
  'Mercedes-Benz|GLE': /^(amg )?gle\d*/i,
  'Mercedes-Benz|GLS': /^(amg )?gls\d*/i,
  'Mercedes-Benz|C-Class': /^(amg )?c ?\d{2,3}/i,
  'Mercedes-Benz|E-Class': /^(amg )?e ?\d{2,3}/i,
  'Mercedes-Benz|S-Class': /^(amg )?s ?\d{2,3}/i,
};
function matches(make: string, ours: string, epaModel: string): boolean {
  const re = MATCH[`${make}|${ours}`];
  if (re) return re.test(epaModel);
  const a = words(ours), b = words(epaModel);
  return a.every((w, i) => b[i] === w);
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
