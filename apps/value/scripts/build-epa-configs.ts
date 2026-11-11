// Builds src/data/epa-configs.json from data/epa/vehicles.csv: for each model the site lists and each model year,
// the configurations the EPA tested (displacement, cylinders, transmission, drive, fuel, hybrid or electric type).
// The Garage offers them when a car is parked, so its specification can start from the EPA's own record instead of
// from memory. The file has no fuel economy: epa.yml does not keep those columns.
//
//   npm run build:epa-configs -- 2026-11-01      (the day the CSV was fetched; printed into the file)
import { readFileSync, writeFileSync } from 'node:fs';
import { MAKES } from '../src/engine/data';
import { ROW_KEYS } from '../src/engine/models';
import { MAKE_ALIAS, matches, norm, parseCsv } from './epa-shared';

const FIRST_YEAR = 2005;
const asOf = process.argv[2] ?? '';
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('give the day the CSV was fetched, YYYY-MM-DD');

const [head, ...body] = parseCsv(readFileSync('data/epa/vehicles.csv', 'utf8'));
const col = (k: string) => head.indexOf(k);
const [cY, cMake, cModel, cBase, cDrive, cTrany, cDispl, cCyl, cFuel, cAtv] = ['year', 'make', 'model', 'baseModel', 'drive', 'trany', 'displ', 'cylinders', 'fuelType1', 'atvType'].map(col);
const siteMakes = new Set(MAKES.map((m) => m.name));

// One configuration is [displacement L or 0, cylinders or 0, transmission, drive, fuel, type]. They repeat across
// years and models, so each is stored once and model-years point at them by index.
const configs: (string | number)[][] = [];
const index = new Map<string, number>();
const models: Record<string, Record<string, number[]>> = {};

for (const r of body) {
  if (r.length < head.length) continue;
  const year = Number(r[cY]);
  if (year < FIRST_YEAR) continue;
  const make = MAKE_ALIAS[r[cMake]] ?? r[cMake];
  if (!siteMakes.has(make)) continue;
  // The same matching build-epa.ts uses, so a configuration lands on the model name the site shows.
  let hits = ROW_KEYS.filter(([mk, mo]) => mk === make && matches(mk, mo, r[cModel]));
  if (!hits.length && r[cBase]) hits = ROW_KEYS.filter(([mk, mo]) => mk === make && norm(mo) === norm(r[cBase]));
  const names = hits.length ? hits.map(([, mo]) => mo) : [r[cBase] || r[cModel]];
  const config = [Number(r[cDispl]) || 0, Number(r[cCyl]) || 0, r[cTrany], r[cDrive], r[cFuel], r[cAtv]];
  const key = config.join('|');
  if (!index.has(key)) { index.set(key, configs.length); configs.push(config); }
  const at = index.get(key)!;
  for (const model of names) {
    const years = (models[`${make}|${model}`] ??= {});
    const list = (years[String(year)] ??= []);
    if (!list.includes(at)) list.push(at);
  }
}
for (const years of Object.values(models)) for (const list of Object.values(years)) list.sort((a, b) => a - b);
const sorted = Object.fromEntries(Object.keys(models).sort().map((k) => [k, models[k]]));

writeFileSync('src/data/epa-configs.json', JSON.stringify({ source: 'EPA fueleconomy.gov vehicle file', url: 'https://www.fueleconomy.gov/feg/download.shtml', asOf, configs, models: sorted }));
console.log(`${Object.keys(sorted).length} models, ${Object.values(sorted).reduce((n, y) => n + Object.keys(y).length, 0)} model-years, ${configs.length} distinct configurations`);
