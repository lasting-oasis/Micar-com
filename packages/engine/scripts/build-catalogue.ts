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
// A research file may carry `reviews`: a second reader's verdict on every figure of every record, made by trying to
// refute it. Where a record has one, a figure the review contradicted, or found to belong to another configuration,
// is left out, and a figure it could not confirm is kept only when it comes from the maker, a government agency or
// a named instrumented test. A listing site's figure nobody could confirm is left out. A blank is a correct entry.
//
// A file marked `"supplement": true` holds further figures for vehicles another file already describes: a later,
// narrower search for what the first one could not source. It is read after every other file and only ever fills a
// blank. A figure already in the catalogue is never replaced by it. Its figures go through the same review rule.
//
//   pnpm --filter @micar/value exec tsx ../../packages/engine/scripts/build-catalogue.ts
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptySpec, parseSpec, setSpecField } from '../src/specs';
import type { BodyClass, BrakeGrade, CatalogueEntry, Source, SpecField, SuspensionGrade, VehicleSpec } from '../src/types';

type Field = { key: string; number?: number; text?: string; publisher: string; url: string; sourceKind: string; basis: string; note?: string };
type Rec = { id: string; year: number; make: string; model: string; trim: string; bodyClass: string; fields: Field[] };
type Review = { id: string; checks: { key: string; verdict: 'confirmed' | 'contradicted' | 'unconfirmed' | 'wrong-configuration' }[] };
type File = { gathered: string; supplement?: boolean; records: Rec[]; reviews?: Review[] };
/** Further figures for a vehicle, from a supplement file. */
type More = { fields: Field[]; gathered: string; review?: Review };

/** The sources whose figure stands when a second reader could find nothing either way. */
const PRIMARY = ['manufacturer', 'agency', 'test'];

/** The figures a review takes out of a record: the key, and why. */
function refused(rec: { fields: Field[] }, review: Review | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!review) return out;
  const verdicts = new Map(review.checks.map((c) => [c.key, c.verdict]));
  for (const f of rec.fields) {
    const verdict = verdicts.get(f.key);
    if (verdict === 'contradicted') out[f.key] = 'The second reader found a different figure for this configuration.';
    else if (verdict === 'wrong-configuration') out[f.key] = 'The second reader found the figure belongs to another configuration.';
    else if (verdict === undefined) out[f.key] = 'The second reader gave no verdict on it.';
    else if (verdict === 'unconfirmed' && PRIMARY.indexOf(f.sourceKind) === -1) out[f.key] = 'A listing site’s figure the second reader could not confirm.';
  }
  return out;
}

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
  // The second batch names the engine and gearbox in the trim; the sheet carries those in fields of their own.
  '2024-toyota-tacoma-trd-off-road': { model: 'Tacoma', trim: 'TRD Off-Road Double Cab 4x4' },
  '2024-jeep-wrangler-rubicon': { model: 'Wrangler', trim: 'Rubicon 4-Door' },
  '2024-ford-f-150-raptor': { model: 'F-150', trim: 'Raptor SuperCrew' },
  '2024-tesla-model-3-long-range-awd': { model: 'Model 3', trim: 'Long Range AWD' },
  '2024-ford-mustang-gt': { model: 'Mustang', trim: 'GT Fastback' },
  '2024-chevrolet-corvette-stingray-z51': { model: 'Corvette', trim: 'Stingray Coupe Z51' },
  '2024-mazda-mx-5-miata-club': { model: 'MX-5 Miata', trim: 'Club' },
  '2024-toyota-camry-le': { model: 'Camry', trim: 'LE' },
  '2024-subaru-outback-premium': { model: 'Outback', trim: 'Premium' },
  '2024-toyota-rav4-xle-awd': { model: 'RAV4', trim: 'XLE AWD' },
  '2024-porsche-911-carrera': { model: '911', trim: 'Carrera Coupe' },
  '2024-honda-odyssey-ex-l': { model: 'Odyssey', trim: 'EX-L' },
  '2024-volkswagen-golf-gti-s': { model: 'Golf GTI', trim: 'S' },
};

/** Figures left out of the catalogue, and why. */
const LEFT_OUT: Record<string, Record<string, string>> = {
  '2024-toyota-prius-le-fwd': {
    torqueLbFt: 'The only torque figure found belongs to the front motor-generator, not to the hybrid system, so it cannot stand beside the system horsepower.',
    suspensionFront: 'The only description found is for another configuration.',
    suspensionRear: 'The only description found is for another configuration.',
  },
  '2024-toyota-tacoma-trd-off-road': {
    curbWeightLb: 'The only figure is a test weight, and nothing the publisher wrote ties the truck tested to this cab and transmission.',
  },
  '2024-ford-mustang-gt': {
    curbWeightLb: 'Read from a preliminary sheet by inference about its columns, and the other figures in circulation differ: the second reader advised leaving it out.',
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

function build(rec: Rec, gathered: string, review: Review | undefined, more: More[]): CatalogueEntry {
  const body = BODY[rec.bodyClass];
  if (!body) throw new Error(`${rec.id}: unknown body class ${rec.bodyClass}`);
  const named = IDENTITY[rec.id] ?? { model: rec.model, trim: rec.trim };
  let spec: VehicleSpec = emptySpec({ year: rec.year, make: rec.make, model: named.model, trim: named.trim, bodyClass: body });
  const skip = { ...refused(rec, review), ...(LEFT_OUT[rec.id] ?? {}) };
  const byKey = new Map(rec.fields.map((f) => [f.key, f]));
  let when = gathered;
  const sourceOf = (f: Field, extra = ''): Source => ({
    kind: 'reference', name: clip(f.publisher, 80), url: f.url, asOf: when,
    note: clip([extra, BASIS[f.basis] ?? '', f.note ?? ''].filter(Boolean).join('. ').replace(/\.\./g, '.'), 300),
  });
  const set = (field: SpecField, value: unknown, source: Source) => {
    const done = setSpecField(spec, field, value, source);
    if (done.issue) throw new Error(`${rec.id}: ${field} refused: ${done.issue.reason}`);
    spec = done.spec;
  };

  /** Writes one researched figure onto the sheet. With `blankOnly`, a field that already has a figure is left alone. */
  const put = (f: Field, blankOnly: boolean) => {
    const value = f.number ?? f.text;
    if (value === undefined || f.key === 'baseMsrpUsd') return;
    const field: SpecField | null = DIRECT[f.key] ?? (f.key === 'aspiration' ? 'induction' : f.key === 'fuelType' ? 'powertrain' : f.key === 'topSpeedGoverned' ? 'topSpeedGoverned' : null);
    if (field === null || (blankOnly && spec[field] !== null)) return;
    if (f.key === 'aspiration') { if (INDUCTION[String(value)]) set('induction', INDUCTION[String(value)], sourceOf(f)); }
    else if (f.key === 'topSpeedGoverned') set('topSpeedGoverned', String(value).toLowerCase() === 'yes', sourceOf(f));
    else set(field, value, sourceOf(f, f.key === 'epaCombinedMpge' ? 'MPGe' : ''));
  };

  for (const f of rec.fields) if (!skip[f.key]) put(f, false);
  // Front and rear descriptions become one line each for suspension and brakes.
  for (const [field, front, rear] of [['suspension', 'suspensionFront', 'suspensionRear'], ['brakes', 'brakesFront', 'brakesRear']] as const) {
    const a = skip[front] ? undefined : byKey.get(front), b = skip[rear] ? undefined : byKey.get(rear);
    const text = [a?.text ? `Front: ${a.text}` : '', b?.text ? `Rear: ${b.text}` : ''].filter(Boolean).join('. ');
    const from = a ?? b;
    if (text && from) set(field, clip(text, 120), sourceOf(from));
  }
  // What a later, narrower search added: blanks only, under the same review rule.
  for (const extra of more) {
    const out = { ...refused(extra, extra.review), ...(LEFT_OUT[rec.id] ?? {}) };
    when = extra.gathered;
    for (const f of extra.fields) if (!out[f.key]) put(f, true);
  }
  when = gathered;
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
const files = readdirSync(dir).filter((n) => n.endsWith('.json')).sort().map((name) => JSON.parse(readFileSync(resolve(dir, name), 'utf8')) as File);
// Supplements first, gathered by vehicle, so each vehicle is built once with everything known about it.
const more: Record<string, More[]> = {};
for (const file of files.filter((f) => f.supplement === true)) {
  for (const rec of file.records) (more[rec.id] ??= []).push({ fields: rec.fields, gathered: file.gathered, review: file.reviews?.filter((r) => r.id === rec.id)[0] });
}
const entries: CatalogueEntry[] = [];
for (const file of files.filter((f) => f.supplement !== true)) {
  for (const rec of file.records) {
    if (entries.some((e) => e.id === rec.id)) throw new Error(`${rec.id} appears twice`);
    entries.push(build(rec, file.gathered, file.reviews?.filter((r) => r.id === rec.id)[0], more[rec.id] ?? []));
  }
}
for (const id of Object.keys(more)) if (!entries.some((e) => e.id === id)) throw new Error(`${id}: a supplement for a vehicle no file describes`);
entries.sort((a, b) => (a.id < b.id ? -1 : 1));

const header = `// Generated by scripts/build-catalogue.ts from data/research/*.json. Do not edit by hand: edit the script and run it.
// Reference data: gathered from public sources through web search and not checked against a primary document.
import type { CatalogueEntry } from '../types';

export const CATALOGUE_DATA: readonly CatalogueEntry[] = `;
writeFileSync(resolve(root, 'src/data/catalogue.ts'), `${header}${JSON.stringify(entries, null, 2)};\n`);
console.log(`${entries.length} catalogue entries: ${entries.map((e) => e.id).join(', ')}`);
