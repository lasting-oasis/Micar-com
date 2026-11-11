// Building and checking specifications.
// This is the only door through which loose input (a form, an imported file, another app's record) becomes a
// VehicleSpec, so its job is refusal: a value that is not a figure is never stored as one. A number outside its range
// is refused, not clipped into it. A figure without a source of a known kind is refused. Text is cleaned and cut to
// length. What is refused leaves the specification as it was and comes back as an issue the caller can show at the field.
// Every function returns new objects and leaves what it was given untouched.
import { SPEC_RANGES } from './rules';
import type { NumericSpecField } from './rules';
import { BODY_CLASSES } from './types';
import type {
  BodyClass, BrakeGrade, Construction, Drivetrain, Induction, Powertrain, Result, Source, SourceKind, Sourced, SpecField,
  SuspensionGrade, TransmissionType, VehicleIdentity, VehicleSpec,
} from './types';
import { clipText, isIsoDate, isNumber } from './util';

/* ------------------------------------------------------------------- limits ---- */

/** The first model year there is: the year of the first motor car. */
const FIRST_YEAR = 1886;
/** Longest make and longest model, in characters. */
const MAKE_MODEL_MAX = 60;
const TRIM_MAX = 80;
/** Longest description in words: engine, transmission, suspension, brakes. */
const TEXT_MAX = 120;
const SOURCE_NAME_MAX = 80;
const SOURCE_URL_MAX = 300;
const SOURCE_NOTE_MAX = 300;

/* ------------------------------------------------------------------- tables ---- */

/** English labels for forms and sheets, in the order a specification lists its fields. The apps translate them. */
export const SPEC_FIELD_LABELS: Record<SpecField, string> = {
  engine: 'Engine',
  powertrain: 'Powertrain',
  induction: 'Induction',
  displacementL: 'Displacement',
  cylinders: 'Cylinders',
  horsepower: 'Horsepower',
  torqueLbFt: 'Torque',
  transmission: 'Transmission',
  transmissionType: 'Transmission type',
  drivetrain: 'Drivetrain',
  curbWeightLb: 'Curb weight',
  zeroToSixtySec: '0-60 mph',
  topSpeedMph: 'Top speed',
  topSpeedGoverned: 'Top speed is electronically limited',
  combinedMpg: 'Combined economy',
  cityMpg: 'City economy',
  highwayMpg: 'Highway economy',
  evRangeMiles: 'Electric range',
  lateralGripG: 'Skidpad grip',
  braking60to0Ft: 'Braking 60-0 mph',
  braking70to0Ft: 'Braking 70-0 mph',
  groundClearanceIn: 'Ground clearance',
  construction: 'Construction',
  suspension: 'Suspension',
  suspensionGrade: 'Suspension grade',
  brakes: 'Brakes',
  brakeGrade: 'Brake grade',
  warrantyPowertrainMiles: 'Powertrain warranty (miles)',
  warrantyPowertrainYears: 'Powertrain warranty (years)',
  productionUnits: 'Units built',
};

/**
 * The unit each figure is written in, for the fields that have one. Counts, descriptions and choices have none, and
 * neither do the two warranty figures, whose labels already say miles and years. Economy is MPG, or MPGe for an
 * electric powertrain: the unit here is the plain one.
 */
export const SPEC_FIELD_UNITS: Partial<Record<SpecField, string>> = {
  displacementL: 'L',
  horsepower: 'hp',
  torqueLbFt: 'lb-ft',
  curbWeightLb: 'lb',
  zeroToSixtySec: 's',
  topSpeedMph: 'mph',
  combinedMpg: 'mpg',
  cityMpg: 'mpg',
  highwayMpg: 'mpg',
  evRangeMiles: 'mi',
  lateralGripG: 'g',
  braking60to0Ft: 'ft',
  braking70to0Ft: 'ft',
  groundClearanceIn: 'in',
};

/** What each kind of source is, in the words shown beside a figure. */
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  manufacturer: 'Manufacturer',
  agency: 'Government agency',
  test: 'Instrumented test',
  reference: 'Reference, not verified',
  owner: 'Entered by the owner',
  illustrative: 'Illustrative example',
};

/**
 * A list that names every member of a union, checked by the compiler: leave a member out, or name one the type does
 * not have, and this file stops compiling. It keeps the lists below in step with types.ts and rules.ts.
 */
const every = <U extends string>() => <L extends readonly U[]>(list: L & ([U] extends [L[number]] ? unknown : never)): readonly U[] => list;

/** The fields that hold a number: exactly those with a range in SPEC_RANGES (rules.ts), in the order of the specification. */
export const NUMERIC_FIELDS: readonly NumericSpecField[] = every<NumericSpecField>()([
  'displacementL', 'cylinders', 'horsepower', 'torqueLbFt', 'curbWeightLb', 'zeroToSixtySec', 'topSpeedMph', 'combinedMpg', 'cityMpg',
  'highwayMpg', 'evRangeMiles', 'lateralGripG', 'braking60to0Ft', 'braking70to0Ft', 'groundClearanceIn', 'warrantyPowertrainMiles',
  'warrantyPowertrainYears', 'productionUnits',
] as const);

/** The numeric fields that count things, so only a whole number is a figure. */
const WHOLE_FIELDS: readonly NumericSpecField[] = ['cylinders', 'productionUnits'];

type TextField = 'engine' | 'transmission' | 'suspension' | 'brakes';
type FlagField = 'topSpeedGoverned';
type ChoiceField = 'powertrain' | 'induction' | 'transmissionType' | 'drivetrain' | 'construction' | 'suspensionGrade' | 'brakeGrade';

/** The fields that describe something in words. */
export const TEXT_FIELDS: readonly SpecField[] = every<TextField>()(['engine', 'transmission', 'suspension', 'brakes'] as const);

/** The one field that is true or false. */
const FLAG_FIELDS = every<FlagField>()(['topSpeedGoverned'] as const);

/**
 * Each choice field with the values it accepts, in the order a form should offer them. A list is typed by its field
 * (CHOICE_FIELDS.drivetrain is a list of Drivetrain), so a select can be built from it without a cast.
 */
export const CHOICE_FIELDS: { readonly [F in ChoiceField]: readonly NonNullable<VehicleSpec[F]>['value'][] } = {
  powertrain: every<Powertrain>()(['gasoline', 'diesel', 'hybrid', 'plug-in-hybrid', 'electric'] as const),
  induction: every<Induction>()(['natural', 'turbo', 'twin-turbo', 'quad-turbo', 'supercharged', 'twincharged'] as const),
  transmissionType: every<TransmissionType>()(['manual', 'automatic', 'dual-clutch', 'cvt', 'ecvt', 'single-speed'] as const),
  drivetrain: every<Drivetrain>()(['FWD', 'RWD', 'AWD', '4WD'] as const),
  construction: every<Construction>()(['unibody', 'body-on-frame'] as const),
  suspensionGrade: every<SuspensionGrade>()(['standard', 'sport', 'adaptive', 'offroad'] as const),
  brakeGrade: every<BrakeGrade>()(['standard', 'performance', 'carbon-ceramic'] as const),
};

/** Every field of a specification, in order. The label table is the one the compiler keeps complete. */
const SPEC_FIELDS = Object.keys(SPEC_FIELD_LABELS) as SpecField[];
const SOURCE_KINDS = Object.keys(SOURCE_KIND_LABELS) as SourceKind[];

/* ------------------------------------------------------------------ reading ---- */

/** A value a field can hold. */
type FieldValue = number | string | boolean;

const refuse = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** True when v is one of the list. Lists are searched, never indexed by name, so 'constructor' or '__proto__' is just another unknown word. */
const among = (list: readonly unknown[], v: unknown): boolean => list.indexOf(v) >= 0;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// The kind of a field. readValue below tries these in turn and treats what is left as a choice, which compiles only
// while the four kinds between them cover every field of a specification: a new field has to be sorted into one.
const isNumeric = (field: SpecField): field is NumericSpecField => among(NUMERIC_FIELDS, field);
const isText = (field: SpecField): field is TextField => among(TEXT_FIELDS, field);
const isFlag = (field: SpecField): field is FlagField => among(FLAG_FIELDS, field);


/** Plain decimal notation and nothing else: digits with at most one point, and an optional sign. No exponent, no hex, no separators. */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * A finite number from a number, or from a string that spells one in plain decimal notation ("600", " 2.9 "): forms
 * hand over strings. Anything else is null: an empty string, "1e3", "0x10", "1,234", true, an array.
 */
function readNumber(v: unknown): number | null {
  let n = v;
  if (typeof v === 'string') {
    const text = v.trim();
    if (!DECIMAL.test(text)) return null;
    n = Number(text);
  }
  if (!isNumber(n)) return null;
  // Negative zero is zero: it would come back from JSON as 0 and no longer equal what was stored.
  return n === 0 ? 0 : n;
}

/**
 * clipText, made safe to run twice. clipText trims before it cuts, so a cut can leave a space at the end, or the
 * first half of a character that takes two code units (an emoji). Both are dropped here, which means cleaning a clean
 * value changes nothing: a specification read back from storage is the one that was stored.
 */
const cleanText = (v: unknown, max: number): string => clipText(v, max).replace(/[\s\uD800-\uDBFF]+$/, '');

/**
 * True when something was given for a part of the identity that has to be text, and it is not text. Nothing given
 * (null or undefined) is not that: it reads as an empty name, which is then reported as missing. A number is never
 * quietly turned into a name.
 */
const isNotText = (v: unknown): boolean => v !== null && v !== undefined && typeof v !== 'string';

const SOURCE_RULE = `source kind must be one of ${SOURCE_KINDS.join(', ')}`;

/**
 * A source from anything, or null when it has no known kind. The name and the note are cleaned and cut to length;
 * the address is kept only when it starts with https:// or http:// and is at most 300 characters (a longer one is
 * dropped, not cut); the day is kept only when it is a real day. Anything else the input carries is left behind.
 */
function cleanSource(input: unknown): Source | null {
  if (!isRecord(input)) return null;
  // Each part is read once, so what is checked is what is kept.
  const { kind, url, asOf } = input;
  if (!among(SOURCE_KINDS, kind)) return null;
  const source: Source = { kind: kind as SourceKind };
  const name = cleanText(input.name, SOURCE_NAME_MAX);
  if (name !== '') source.name = name;
  if (typeof url === 'string' && /^https?:\/\//.test(url) && url.length <= SOURCE_URL_MAX) source.url = url;
  if (isIsoDate(asOf)) source.asOf = asOf;
  const note = cleanText(input.note, SOURCE_NOTE_MAX);
  if (note !== '') source.note = note;
  return source;
}

/** What a field makes of a raw value: the clean value, null when nothing was given, or a refusal with its reason. */
function readValue(field: SpecField, raw: unknown): Result<FieldValue | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (isNumeric(field)) {
    const [lo, hi] = SPEC_RANGES[field];
    const whole = among(WHOLE_FIELDS, field);
    const n = readNumber(raw);
    if (n === null || n < lo || n > hi || (whole && !Number.isInteger(n))) return refuse(`must be a ${whole ? 'whole number' : 'number'} from ${lo} to ${hi}`);
    return { ok: true, value: n };
  }
  if (isText(field)) {
    if (typeof raw !== 'string') return refuse('must be text');
    const text = cleanText(raw, TEXT_MAX);
    return { ok: true, value: text === '' ? null : text };
  }
  if (isFlag(field)) return typeof raw === 'boolean' ? { ok: true, value: raw } : refuse('must be true or false');
  const allowed: readonly string[] = CHOICE_FIELDS[field];
  return among(allowed, raw) ? { ok: true, value: raw as string } : refuse(`must be one of ${allowed.join(', ')}`);
}

/**
 * One field's value and source through the checks, the same whoever asks: a form (setSpecField) or a stored file
 * (parseSpec). The answer is the cell to store, null for an empty field, or the one reason it was refused. The value
 * is judged first, so a field that is wrong twice over reports its value.
 */
function checkCell(field: SpecField, value: unknown, source: unknown): Result<Sourced<FieldValue> | null> {
  const read = readValue(field, value);
  if (!read.ok) return read;
  if (read.value === null) return { ok: true, value: null };
  const clean = cleanSource(source);
  return clean === null ? refuse(SOURCE_RULE) : { ok: true, value: { value: read.value, source: clean } };
}

/* ----------------------------------------------------------------- building ---- */

/**
 * A problem with one field, or with the identity, in plain English. A field's reason reads after its label and is one of:
 *   "must be a number from 10 to 3000"      the field's own range; "a whole number" for cylinders and units built
 *   "must be text"
 *   "must be one of FWD, RWD, AWD, 4WD"     the field's own values
 *   "must be true or false"
 *   "source kind must be one of manufacturer, agency, test, reference, owner, illustrative"
 *   "must be a value with its source"       parseSpec only: a figure stored bare, without its source
 *   "is not a field of the specification"
 * With field 'identity' the reason is one of checkIdentity's.
 */
export type SpecIssue = { field: SpecField | 'identity'; reason: string };

/**
 * A specification with its identity and nothing else: every field is null until someone supplies it with a source.
 * The identity is copied as given and not checked: loose input goes through checkIdentity first.
 */
export function emptySpec(identity: VehicleIdentity): VehicleSpec {
  return {
    identity: { year: identity.year, make: identity.make, model: identity.model, trim: identity.trim, bodyClass: identity.bodyClass },
    engine: null,
    powertrain: null,
    induction: null,
    displacementL: null,
    cylinders: null,
    horsepower: null,
    torqueLbFt: null,
    transmission: null,
    transmissionType: null,
    drivetrain: null,
    curbWeightLb: null,
    zeroToSixtySec: null,
    topSpeedMph: null,
    topSpeedGoverned: null,
    combinedMpg: null,
    cityMpg: null,
    highwayMpg: null,
    evRangeMiles: null,
    lateralGripG: null,
    braking60to0Ft: null,
    braking70to0Ft: null,
    groundClearanceIn: null,
    construction: null,
    suspension: null,
    suspensionGrade: null,
    brakes: null,
    brakeGrade: null,
    warrantyPowertrainMiles: null,
    warrantyPowertrainYears: null,
    productionUnits: null,
  };
}

/**
 * A value paired with its source, for code that already holds checked data (a catalogue, a test). Nothing is checked
 * here: anything typed by a person or read from a file goes through setSpecField or parseSpec instead.
 */
export function sourced<T>(value: T, source: Source): Sourced<T> {
  return { value, source: { ...source } };
}

/** The source of a figure the owner typed in on the day given (YYYY-MM-DD). */
export const ownerSource: (asOf: string) => Source = (asOf) => ({ kind: 'owner', asOf });

/**
 * Checks a vehicle's identity from loose input. The year is a whole number from 1886 to the year after thisYear (a
 * year typed into a form may arrive as a string); make and model are text, cleaned and cut to 60 characters, and may
 * not be empty; the trim is cut to 80 and may be empty or missing; the body class is one of BODY_CLASSES. The answer
 * is a new object with those five parts and nothing else, or the first thing wrong, looked for in that order:
 * "a vehicle needs a year, a make, a model and a body class", "year must be a whole number from 1886 to 2027",
 * "make must be text", "make is missing", the same two for the model, "trim must be text", "body class must be one of ...".
 */
export function checkIdentity(input: unknown, thisYear: number): Result<VehicleIdentity> {
  if (!isRecord(input)) return refuse('a vehicle needs a year, a make, a model and a body class');
  const year = readNumber(input.year);
  if (year === null || !Number.isInteger(year) || year < FIRST_YEAR || year > thisYear + 1) return refuse(`year must be a whole number from ${FIRST_YEAR} to ${thisYear + 1}`);
  if (isNotText(input.make)) return refuse('make must be text');
  const make = cleanText(input.make, MAKE_MODEL_MAX);
  if (make === '') return refuse('make is missing');
  if (isNotText(input.model)) return refuse('model must be text');
  const model = cleanText(input.model, MAKE_MODEL_MAX);
  if (model === '') return refuse('model is missing');
  if (isNotText(input.trim)) return refuse('trim must be text');
  if (!among(BODY_CLASSES, input.bodyClass)) return refuse(`body class must be one of ${BODY_CLASSES.join(', ')}`);
  return { ok: true, value: { year, make, model, trim: cleanText(input.trim, TRIM_MAX), bodyClass: input.bodyClass as BodyClass } };
}

/**
 * Sets one field from loose input and returns a new specification; the one given is not touched.
 *
 * A number must be finite and inside the field's range in SPEC_RANGES (a string that spells a number in plain decimal
 * notation is read as that number); cylinders and units built must be whole. A description is cleaned and cut to 120
 * characters, and empty text clears the field. A choice must be one of CHOICE_FIELDS[field]; the limiter flag must be
 * true or false. The source must have a known kind and is stored as a cleaned copy.
 *
 * A value that fails is refused: the field stays as it was and the issue says why. Nothing is clipped into range.
 * null or undefined clears the field, as clearSpecField does. An empty string clears a description only: for a
 * number or a choice it is refused like anything else that is not one, so a form passes null for an emptied box.
 * A comma is never read as a decimal point or as a separator ("2,9" and "1,234" are refused): which one it means
 * depends on the language, and that is the form's to know.
 *
 * The specification returned is always a new object, also when the value was refused. The fields it did not change
 * are the same cells as before, which is safe because nothing in the engine writes to a specification.
 */
export function setSpecField(spec: VehicleSpec, field: SpecField, value: unknown, source: Source): { spec: VehicleSpec; issue: SpecIssue | null } {
  if (!among(SPEC_FIELDS, field)) return { spec: { ...spec }, issue: { field, reason: 'is not a field of the specification' } };
  const cell = checkCell(field, value, source);
  if (!cell.ok) return { spec: { ...spec }, issue: { field, reason: cell.reason } };
  return { spec: { ...spec, [field]: cell.value }, issue: null };
}

/** Empties one field and returns a new specification; the one given is not touched. The identity cannot be cleared. */
export function clearSpecField(spec: VehicleSpec, field: SpecField): VehicleSpec {
  return among(SPEC_FIELDS, field) ? { ...spec, [field]: null } : { ...spec };
}

/**
 * Reads a stored or imported specification, field by field, with the checks setSpecField applies. A bad identity
 * gives spec: null and one issue. A field that fails becomes null and one issue, and the rest is kept. A field that
 * is missing or null stays null without an issue (so does a cell whose value is null or empty text), and anything
 * the input carries beyond a specification is left out. The result is built from scratch, in the order of the
 * specification, and shares nothing with the input. A valid specification that went through JSON comes back equal
 * to itself, key for key, with no issues: JSON.stringify of the two gives the same text.
 */
export function parseSpec(input: unknown, thisYear: number): { spec: VehicleSpec | null; issues: SpecIssue[] } {
  const stored = isRecord(input) ? input : {};
  const identity = checkIdentity(stored.identity, thisYear);
  if (!identity.ok) return { spec: null, issues: [{ field: 'identity', reason: identity.reason }] };
  let spec = emptySpec(identity.value);
  const issues: SpecIssue[] = [];
  for (const field of SPEC_FIELDS) {
    const raw = stored[field];
    if (raw === null || raw === undefined) continue;
    const cell = isRecord(raw) ? checkCell(field, raw.value, raw.source) : refuse('must be a value with its source');
    if (cell.ok) spec = { ...spec, [field]: cell.value };
    else issues.push({ field, reason: cell.reason });
  }
  return { spec, issues };
}

/* ------------------------------------------------------------- other vocabularies ---- */

/** The body class for one of the value app's body styles ('Sedan', 'SUV / Crossover', ...). Anything else is a sedan. */
export function bodyClassFromValueBody(name: string): BodyClass {
  switch (name) {
    case 'Sedan': return 'sedan';
    case 'SUV / Crossover': return 'suv';
    case 'Pickup Truck': return 'pickup';
    case 'Coupe / Sports': return 'coupe';
    case 'Hatchback / Wagon': return 'hatchback';
    case 'Minivan': return 'van';
    default: return 'sedan';
  }
}

/** The body class for one of the sim's body styles ('sedan', 'truck', 'sports', ...). Anything else is a sedan, as in the sim itself. */
export function bodyClassFromSimStyle(style: string): BodyClass {
  switch (style) {
    case 'sedan': return 'sedan';
    case 'coupe': return 'coupe';
    case 'hatchback': return 'hatchback';
    case 'suv': return 'suv';
    case 'van': return 'van';
    case 'truck': return 'pickup';
    case 'sports': return 'sports';
    default: return 'sedan';
  }
}

/* ------------------------------------------------------------------- counting ---- */

/** How many fields rest on each kind of source. All six kinds are always present; an empty field counts for none. */
export function sourceCounts(spec: VehicleSpec): Record<SourceKind, number> {
  const counts: Record<SourceKind, number> = { manufacturer: 0, agency: 0, test: 0, reference: 0, owner: 0, illustrative: 0 };
  for (const field of SPEC_FIELDS) {
    const cell = spec[field];
    if (cell && among(SOURCE_KINDS, cell.source.kind)) counts[cell.source.kind] += 1;
  }
  return counts;
}
