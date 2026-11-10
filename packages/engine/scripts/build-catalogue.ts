// Builds src/data/catalogue.ts from the research records in data/research/*.json.
//
// The records are kept as the researchers returned them. This script is the only place they are edited, and every
// edit is written down here: which research key feeds which specification field, which figures are left out and why,
// and the two grades (suspension, brakes) that are read from a description rather than given as a figure.
//
// Every figure becomes `kind: 'reference'` with the publisher and URL the search gave: page fetching was not
// available when the records were gathered, so nothing in them was checked against a primary document. Prices are
// dropped: the engine carries none.
//
//   pnpm --filter @micar/value exec tsx ../../packages/engine/scripts/build-catalogue.ts
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptySpec, parseSpec, setSpecField } from '../src/specs';
import type { BodyClass, BrakeGrade, CatalogueEntry, Source, SpecField, SuspensionGrade, VehicleSpec } from '../src/types';

type Field = { key: string; number?: number; text?: string; publisher: string; url: string; sourceKind: string; basis: string; note?: string };
type Rec = { id: string; year: number; make: string; model: string; trim: string; bodyClass: string; fields: Field[] };
type File = { gathered: string; records: Rec[] };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BODY: Record<string, BodyClass> = {
  'sports-car': 'sports', hypercar: 'sports', coupe: 'coupe', sedan: 'sedan', hatchback: 'hatchback', wagon: 'wagon', suv: 'suv',
  'off-road-suv': 'offroad', pickup: 'pickup', 'heavy-duty-pickup': 'pickup', minivan: 'van',
};

/** Research key -> specification field, for keys that map one to one. */
const DIRECT: Record<string, SpecField> = {
  engineDescription: 'engine', displacementL: 'displacementL', cylinders: 'cylinders', horsepower: 'horsepower', torqueLbFt: 'torqueLbFt',
  transmission: 'transmission', transmissionType: 'transmissionType', drivetrain: 'drivetrain', curbWeightLb: 'curbWeightLb',
  zeroToSixtySec: 'zeroToSixtySec', topSpeedMph: 'topSpeedMph', epaCityMpg: 'cityMpg', epaHighwayMpg: 'highwayMpg', epaCombinedMpg: 'combinedMpg',
  epaCombinedMpge: 'combinedMpg', evRangeMiles: 'evRangeMiles', lateralGripG: 'lateralGripG', braking60to0Ft: 'braking60to0Ft', braking70to0Ft: 'braking70to0Ft',
  groundClearanceIn: 'groundClearanceIn', construction: 'construction', powertrainWarrantyYears: 'warrantyPowertrainYears',
  powertrainWarrantyMiles: 'warrantyPowertrainMiles', productionUnits: 'productionUnits',
};
const INDUCTION: Record<string, string> = {
  'naturally-aspirated': 'natural', turbocharged: 'turbo', 'twin-turbocharged': 'twin-turbo', 'quad-turbocharged': 'quad-turbo', supercharged: 'supercharged',
};
const BASIS: Record<string, string> = {
  'manufacturer-claim': 'The maker’s figure', 'government-rating': 'A government rating', 'measured-test': 'A measured test', republished: 'Republished by a listing site',
};

/** The site's model names, where the research used a longer one. */
const IDENTITY: Record<string, { model: string; trim: string }> = {
  '2024-honda-civic-sedan-lx': { model: 'Civic', trim: 'Sedan LX' },
  '2024-toyota-prius-le-fwd': { model: 'Prius', trim: 'LE' },
};

/** Figures left out of the catalogue, and why. */
const LEFT_OUT: Record<string, Record<string, string>> = {
  '2024-toyota-prius-le-fwd': {
    torqueLbFt: 'The only torque figure found belongs to the front motor-generator, not to the hybrid system, so it cannot stand beside the system horsepower.',
    suspensionFront: 'The only description found is for another configuration.',
    suspensionRear: 'The only description found is for another configuration.',
  },
};

/** Grades read from a description. The reason is kept with the figure. */
const GRADES: Record<string, { suspensionGrade?: [SuspensionGrade, string]; brakeGrade?: [BrakeGrade, string] }> = {
  '2024-nissan-gt-r-nismo': {
    suspensionGrade: ['sport', 'NISMO-tuned springs and dampers, per the suspension description.'],
    brakeGrade: ['carbon-ceramic', 'Carbon-ceramic rotors, per the brake description.'],
  },
  '2024-honda-civic-sedan-lx': {
    suspensionGrade: ['standard', 'A standard strut and multi-link layout, per the suspension description.'],
    brakeGrade: ['standard', 'Single-piston discs, per the brake description.'],
  },
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function build(rec: Rec, gathered: string): CatalogueEntry {
  const body = BODY[rec.bodyClass];
  if (!body) throw new Error(`${rec.id}: unknown body class ${rec.bodyClass}`);
  const named = IDENTITY[rec.id] ?? { model: rec.model, trim: rec.trim };
  let spec: VehicleSpec = emptySpec({ year: rec.year, make: rec.make, model: named.model, trim: named.trim, bodyClass: body });
  const skip = LEFT_OUT[rec.id] ?? {};
  const byKey = new Map(rec.fields.map((f) => [f.key, f]));
  const sourceOf = (f: Field, extra = ''): Source => ({
    kind: 'reference', name: clip(f.publisher, 80), url: f.url, asOf: gathered,
    note: clip([extra, BASIS[f.basis] ?? '', f.note ?? ''].filter(Boolean).join('. ').replace(/\.\./g, '.'), 300),
  });
  const set = (field: SpecField, value: unknown, source: Source) => {
    const done = setSpecField(spec, field, value, source);
    if (done.issue) throw new Error(`${rec.id}: ${field} refused: ${done.issue.reason}`);
    spec = done.spec;
  };

  for (const f of rec.fields) {
    if (skip[f.key] || f.key === 'baseMsrpUsd') continue;
    const value = f.number ?? f.text;
    if (value === undefined) continue;
    if (DIRECT[f.key]) set(DIRECT[f.key], value, sourceOf(f, f.key === 'epaCombinedMpge' ? 'MPGe' : ''));
    else if (f.key === 'aspiration') { if (INDUCTION[String(value)]) set('induction', INDUCTION[String(value)], sourceOf(f)); }
    else if (f.key === 'fuelType') set('powertrain', value, sourceOf(f));
    else if (f.key === 'topSpeedGoverned') set('topSpeedGoverned', String(value).toLowerCase() === 'yes', sourceOf(f));
  }
  // Front and rear descriptions become one line each for suspension and brakes.
  for (const [field, front, rear] of [['suspension', 'suspensionFront', 'suspensionRear'], ['brakes', 'brakesFront', 'brakesRear']] as const) {
    const a = skip[front] ? undefined : byKey.get(front), b = skip[rear] ? undefined : byKey.get(rear);
    const text = [a?.text ? `Front: ${a.text}` : '', b?.text ? `Rear: ${b.text}` : ''].filter(Boolean).join('. ');
    const from = a ?? b;
    if (text && from) set(field, clip(text, 120), sourceOf(from));
  }
  const grades = GRADES[rec.id] ?? {};
  if (grades.suspensionGrade && spec.suspension) set('suspensionGrade', grades.suspensionGrade[0], { ...spec.suspension.source, note: `Read from the description. ${grades.suspensionGrade[1]}` });
  if (grades.brakeGrade && spec.brakes) set('brakeGrade', grades.brakeGrade[0], { ...spec.brakes.source, note: `Read from the description. ${grades.brakeGrade[1]}` });

  // The entry must read back exactly through the engine's own parser.
  const round = parseSpec(JSON.parse(JSON.stringify(spec)), Number(gathered.slice(0, 4)));
  if (!round.spec || round.issues.length > 0 || JSON.stringify(round.spec) !== JSON.stringify(spec)) throw new Error(`${rec.id}: does not survive parseSpec: ${JSON.stringify(round.issues)}`);
  return {
    id: rec.id, spec, status: 'reference', asOf: gathered,
    note: 'Gathered from public sources through web search. No figure was checked against a primary document.',
  };
}

const dir = resolve(root, 'data/research');
const entries: CatalogueEntry[] = [];
for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
  const file = JSON.parse(readFileSync(resolve(dir, name), 'utf8')) as File;
  for (const rec of file.records) {
    if (entries.some((e) => e.id === rec.id)) throw new Error(`${rec.id} appears twice`);
    entries.push(build(rec, file.gathered));
  }
}
entries.sort((a, b) => (a.id < b.id ? -1 : 1));

const header = `// Generated by scripts/build-catalogue.ts from data/research/*.json. Do not edit by hand: edit the script and run it.
// Reference data: gathered from public sources through web search and not checked against a primary document.
import type { CatalogueEntry } from '../types';

export const CATALOGUE_DATA: readonly CatalogueEntry[] = `;
writeFileSync(resolve(root, 'src/data/catalogue.ts'), `${header}${JSON.stringify(entries, null, 2)};\n`);
console.log(`${entries.length} catalogue entries: ${entries.map((e) => e.id).join(', ')}`);
