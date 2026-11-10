// Tests for specs.ts, the one door through which loose input becomes a specification.
// Most of them are refusals: what a form, an imported file or another app's record may not turn into a figure.
import { describe, expect, it } from 'vitest';
import { SPEC_RANGES } from './rules';
import type { NumericSpecField } from './rules';
import {
  CHOICE_FIELDS, NUMERIC_FIELDS, SOURCE_KIND_LABELS, SPEC_FIELD_LABELS, SPEC_FIELD_UNITS, TEXT_FIELDS,
  bodyClassFromSimStyle, bodyClassFromValueBody, checkIdentity, clearSpecField, emptySpec, ownerSource, parseSpec, setSpecField, sourceCounts, sourced,
} from './specs';
import type { SpecIssue } from './specs';
import { BODY_CLASSES } from './types';
import type { BrakeGrade, Construction, Drivetrain, Induction, Powertrain, Source, SourceKind, SpecField, SuspensionGrade, TransmissionType, VehicleIdentity, VehicleSpec } from './types';

const THIS_YEAR = 2026;
const TODAY = '2026-11-10';

/** Freezes a fixture all the way down, so code that writes to its input throws instead of passing quietly. */
function frozen<T>(v: T): T {
  if (typeof v === 'object' && v !== null) {
    Object.freeze(v);
    for (const k of Object.keys(v)) frozen((v as Record<string, unknown>)[k]);
  }
  return v;
}

// Sources of every kind. The publishers are made up: these are fixtures, not data about a real vehicle.
const maker: Source = frozen({ kind: 'manufacturer', name: 'Maker press kit (test fixture)', url: 'https://example.com/press/gt-r-nismo?year=2024#specs', asOf: TODAY, note: 'as printed' });
const agency: Source = frozen({ kind: 'agency', name: 'Fuel economy agency (test fixture)', url: 'http://example.gov/feg', asOf: TODAY });
const magazine: Source = frozen({ kind: 'test', name: 'Road test (test fixture)', asOf: '2025-03-02' });
const ref: Source = frozen({ kind: 'reference', name: 'test fixture', asOf: TODAY });
const owner: Source = frozen({ kind: 'owner', asOf: TODAY });
const demo: Source = frozen({ kind: 'illustrative' });

const identity: VehicleIdentity = frozen({ year: 2024, make: 'Nissan', model: 'GT-R', trim: 'NISMO', bodyClass: 'sports' });
const blank: VehicleSpec = frozen(emptySpec(identity));

// A specification with all thirty fields filled, written out in the order the module writes them, so the round trip
// through JSON covers every field and every kind of source.
const full: VehicleSpec = frozen({
  identity: { year: 2024, make: 'Nissan', model: 'GT-R', trim: 'NISMO', bodyClass: 'sports' },
  engine: { value: '3.8L twin-turbo V6', source: maker },
  powertrain: { value: 'gasoline', source: maker },
  induction: { value: 'twin-turbo', source: maker },
  displacementL: { value: 3.8, source: maker },
  cylinders: { value: 6, source: maker },
  horsepower: { value: 600, source: maker },
  torqueLbFt: { value: 481, source: maker },
  transmission: { value: '6-speed dual-clutch', source: maker },
  transmissionType: { value: 'dual-clutch', source: maker },
  drivetrain: { value: 'AWD', source: maker },
  curbWeightLb: { value: 3867, source: ref },
  zeroToSixtySec: { value: 2.9, source: magazine },
  topSpeedMph: { value: 196, source: ref },
  topSpeedGoverned: { value: false, source: ref },
  combinedMpg: { value: 18, source: agency },
  cityMpg: { value: 16, source: agency },
  highwayMpg: { value: 22, source: agency },
  evRangeMiles: { value: 25, source: demo },
  lateralGripG: { value: 1.02, source: magazine },
  braking60to0Ft: { value: 97, source: magazine },
  braking70to0Ft: { value: 145, source: magazine },
  groundClearanceIn: { value: 4.3, source: ref },
  construction: { value: 'unibody', source: ref },
  suspension: { value: 'double wishbone front, multi-link rear', source: maker },
  suspensionGrade: { value: 'sport', source: ref },
  brakes: { value: '410 mm carbon-ceramic front, 390 mm rear', source: maker },
  brakeGrade: { value: 'carbon-ceramic', source: ref },
  warrantyPowertrainMiles: { value: 60000, source: maker },
  warrantyPowertrainYears: { value: 5, source: maker },
  productionUnits: { value: 300, source: owner },
});

// The fields by kind, written out here rather than read from the module, so a list that loses an entry there
// cannot quietly shorten a loop here. Every field comes from the fixture above, which the compiler keeps complete,
// and the numeric ones from the ranges in rules.ts.
const ALL_FIELDS = Object.keys(full).filter((k): k is SpecField => k !== 'identity');
const RANGED = Object.keys(SPEC_RANGES) as NumericSpecField[];
const WHOLE: readonly NumericSpecField[] = ['cylinders', 'productionUnits'];
const WORDS = ['engine', 'transmission', 'suspension', 'brakes'] as const;
const CHOICES = ['powertrain', 'induction', 'transmissionType', 'drivetrain', 'construction', 'suspensionGrade', 'brakeGrade'] as const;
const KINDS: readonly SourceKind[] = ['manufacturer', 'agency', 'test', 'reference', 'owner', 'illustrative'];
const ALLOWED: Record<(typeof CHOICES)[number], readonly string[]> = {
  powertrain: ['gasoline', 'diesel', 'hybrid', 'plug-in-hybrid', 'electric'],
  induction: ['natural', 'turbo', 'twin-turbo', 'quad-turbo', 'supercharged', 'twincharged'],
  transmissionType: ['manual', 'automatic', 'dual-clutch', 'cvt', 'ecvt', 'single-speed'],
  drivetrain: ['FWD', 'RWD', 'AWD', '4WD'],
  construction: ['unibody', 'body-on-frame'],
  suspensionGrade: ['standard', 'sport', 'adaptive', 'offroad'],
  brakeGrade: ['standard', 'performance', 'carbon-ceramic'],
};
const isWhole = (field: NumericSpecField): boolean => WHOLE.indexOf(field) >= 0;
const rangeRule = (field: NumericSpecField): string => `must be a ${isWhole(field) ? 'whole number' : 'number'} from ${SPEC_RANGES[field][0]} to ${SPEC_RANGES[field][1]}`;

const valueOf = (spec: VehicleSpec, field: SpecField): unknown => { const cell = spec[field]; return cell === null ? null : cell.value; };
const sourceOf = (spec: VehicleSpec, field: SpecField): Source | null => { const cell = spec[field]; return cell === null ? null : cell.source; };
/** The source a figure ends up with when it is set with the loose source given. */
const cleaned = (source: unknown): Source | null => sourceOf(setSpecField(blank, 'horsepower', 600, source as Source).spec, 'horsepower');
/** What JSON storage hands back: plain data, loosely typed so a test can spoil it. */
const stored = (spec: VehicleSpec) => JSON.parse(JSON.stringify(spec)) as Record<string, unknown> & Record<SpecField, { value: unknown; source: Record<string, unknown> }> & { identity: Record<string, unknown> };

const SOURCE_RULE = 'source kind must be one of manufacturer, agency, test, reference, owner, illustrative';

describe('an empty specification', () => {
  it('holds the identity and thirty fields, every one of them null', () => {
    const spec = emptySpec(identity);
    expect(spec.identity).toEqual(identity);
    expect(ALL_FIELDS).toHaveLength(30);
    expect(Object.keys(spec)).toEqual(['identity', ...ALL_FIELDS]);
    for (const field of ALL_FIELDS) expect(spec[field]).toBeNull();
  });

  it('keeps its own copy of the identity, not the object it was given', () => {
    const given = { ...identity };
    const spec = emptySpec(given);
    expect(spec.identity).not.toBe(given);
    given.model = 'Altima';
    expect(spec.identity.model).toBe('GT-R');
    expect(emptySpec(identity)).toEqual(emptySpec(identity));
  });
});

describe('the field tables', () => {
  it('sort every field into exactly one kind: number, text, choice or the limiter flag', () => {
    const sorted = [...NUMERIC_FIELDS, ...TEXT_FIELDS, ...Object.keys(CHOICE_FIELDS), 'topSpeedGoverned'];
    expect(new Set(sorted).size).toBe(sorted.length);
    expect([...sorted].sort()).toEqual([...ALL_FIELDS].sort());
    expect([...RANGED, ...WORDS, ...CHOICES, 'topSpeedGoverned'].sort()).toEqual([...ALL_FIELDS].sort());
  });

  it('list as numeric exactly the fields that have a range, in the order of the specification', () => {
    expect(NUMERIC_FIELDS).toEqual(RANGED);
    expect(NUMERIC_FIELDS).toEqual(ALL_FIELDS.filter((f) => (RANGED as string[]).indexOf(f) >= 0));
  });

  it('list engine, transmission, suspension and brakes as the fields described in words', () => {
    expect(TEXT_FIELDS).toEqual(['engine', 'transmission', 'suspension', 'brakes']);
    expect(TEXT_FIELDS).toEqual(WORDS);
  });

  it('give every choice field the values its type allows, typed for a form to build a select from', () => {
    const powertrains: readonly Powertrain[] = CHOICE_FIELDS.powertrain;
    const inductions: readonly Induction[] = CHOICE_FIELDS.induction;
    const gearboxes: readonly TransmissionType[] = CHOICE_FIELDS.transmissionType;
    const drivetrains: readonly Drivetrain[] = CHOICE_FIELDS.drivetrain;
    const constructions: readonly Construction[] = CHOICE_FIELDS.construction;
    const suspensions: readonly SuspensionGrade[] = CHOICE_FIELDS.suspensionGrade;
    const brakes: readonly BrakeGrade[] = CHOICE_FIELDS.brakeGrade;
    expect(powertrains).toEqual(['gasoline', 'diesel', 'hybrid', 'plug-in-hybrid', 'electric']);
    expect(inductions).toEqual(['natural', 'turbo', 'twin-turbo', 'quad-turbo', 'supercharged', 'twincharged']);
    expect(gearboxes).toEqual(['manual', 'automatic', 'dual-clutch', 'cvt', 'ecvt', 'single-speed']);
    expect(drivetrains).toEqual(['FWD', 'RWD', 'AWD', '4WD']);
    expect(constructions).toEqual(['unibody', 'body-on-frame']);
    expect(suspensions).toEqual(['standard', 'sport', 'adaptive', 'offroad']);
    expect(brakes).toEqual(['standard', 'performance', 'carbon-ceramic']);
    expect(CHOICE_FIELDS).toEqual(ALLOWED);
    expect(Object.keys(CHOICE_FIELDS)).toEqual(CHOICES);
  });

  it('label every field, in the order the specification lists them', () => {
    expect(Object.keys(SPEC_FIELD_LABELS)).toEqual(ALL_FIELDS);
    const labels = ALL_FIELDS.map((f) => SPEC_FIELD_LABELS[f]);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label).toMatch(/^[A-Z0-9][^\n]*[^.\s]$/);
  });

  it('use the words a form shows, which the apps’ dictionaries are keyed on', () => {
    expect(SPEC_FIELD_LABELS).toEqual({
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
    });
  });

  it('give a unit to the figures that are measured in one and to nothing else', () => {
    expect(SPEC_FIELD_UNITS).toEqual({
      displacementL: 'L', horsepower: 'hp', torqueLbFt: 'lb-ft', curbWeightLb: 'lb', zeroToSixtySec: 's', topSpeedMph: 'mph',
      combinedMpg: 'mpg', cityMpg: 'mpg', highwayMpg: 'mpg', evRangeMiles: 'mi', lateralGripG: 'g',
      braking60to0Ft: 'ft', braking70to0Ft: 'ft', groundClearanceIn: 'in',
    });
    // Counts, words, choices and the two warranty figures (whose labels already say miles and years) carry none.
    for (const field of [...WORDS, ...CHOICES, 'topSpeedGoverned', 'cylinders', 'productionUnits', 'warrantyPowertrainMiles', 'warrantyPowertrainYears'] as SpecField[]) {
      expect(SPEC_FIELD_UNITS[field]).toBeUndefined();
    }
  });

  it('say in plain words what each kind of source is', () => {
    expect(SOURCE_KIND_LABELS).toEqual({
      manufacturer: 'Manufacturer',
      agency: 'Government agency',
      test: 'Instrumented test',
      reference: 'Reference, not verified',
      owner: 'Entered by the owner',
      illustrative: 'Illustrative example',
    });
    expect(Object.keys(SOURCE_KIND_LABELS)).toEqual(KINDS);
  });
});

describe('a value with its source', () => {
  it('pairs the two and keeps its own copy of the source', () => {
    const source: Source = { kind: 'reference', name: 'test fixture' };
    const cell = sourced(600, source);
    expect(cell).toEqual({ value: 600, source: { kind: 'reference', name: 'test fixture' } });
    source.name = 'changed afterwards';
    expect(cell.source.name).toBe('test fixture');
    expect(sourced('AWD' as Drivetrain, ref).value).toBe('AWD');
    expect(sourced(false, ref)).toEqual({ value: false, source: ref });
  });

  it('marks what an owner types as the owner’s, with the day it was typed', () => {
    expect(ownerSource(TODAY)).toEqual({ kind: 'owner', asOf: TODAY });
    expect(Object.keys(ownerSource(TODAY))).toEqual(['kind', 'asOf']);
  });
});

describe('the identity', () => {
  const good = { year: 2024, make: 'Nissan', model: 'GT-R', trim: 'NISMO', bodyClass: 'sports' };
  const reasonOf = (input: unknown, thisYear = THIS_YEAR): string | null => { const r = checkIdentity(input, thisYear); return r.ok ? null : r.reason; };

  it('is accepted when year, make, model and body class are in order', () => {
    expect(checkIdentity(good, THIS_YEAR)).toEqual({ ok: true, value: good });
  });

  it('comes back as a new object with only the five parts of an identity', () => {
    const input = frozen({ ...good, vin: 'JN1AR5EF0EM270001', price: 220990 });
    const result = checkIdentity(input, THIS_YEAR);
    expect(result).toStrictEqual({ ok: true, value: good });
    expect(result.ok && result.value).not.toBe(input);
    expect(input).toEqual({ ...good, vin: 'JN1AR5EF0EM270001', price: 220990 });
  });

  it('takes a year from 1886 to next year and no other', () => {
    expect(reasonOf({ ...good, year: 1886 })).toBeNull();
    expect(reasonOf({ ...good, year: THIS_YEAR + 1 })).toBeNull();
    for (const year of [1885, THIS_YEAR + 2, 0, -2024, 24, 20240]) {
      expect(reasonOf({ ...good, year })).toBe('year must be a whole number from 1886 to 2027');
    }
    expect(reasonOf({ ...good, year: 2031 }, 2030)).toBeNull();
    expect(reasonOf({ ...good, year: 2032 }, 2030)).toBe('year must be a whole number from 1886 to 2031');
  });

  it('refuses a year that is not a whole number', () => {
    for (const year of [2024.5, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, '', 'last year', '2024.5', '20x4', true, [2024], { value: 2024 }]) {
      expect(reasonOf({ ...good, year })).toBe('year must be a whole number from 1886 to 2027');
    }
  });

  it('reads a year typed into a form as the number it spells', () => {
    expect(checkIdentity({ ...good, year: ' 2024 ' }, THIS_YEAR)).toEqual({ ok: true, value: good });
  });

  it('needs a make and a model', () => {
    for (const empty of ['', '   ', '\n\t', '\u0000', null, undefined]) {
      expect(reasonOf({ ...good, make: empty })).toBe('make is missing');
      expect(reasonOf({ ...good, model: empty })).toBe('model is missing');
    }
    for (const notText of [911, true, ['GT-R'], { name: 'GT-R' }]) {
      expect(reasonOf({ ...good, make: notText })).toBe('make must be text');
      expect(reasonOf({ ...good, model: notText })).toBe('model must be text');
    }
  });

  it('cleans make and model and clips them to 60 characters', () => {
    const result = checkIdentity({ ...good, make: '  Nissan\u0000 \n', model: 'G'.repeat(200) }, THIS_YEAR);
    expect(result).toEqual({ ok: true, value: { ...good, make: 'Nissan', model: 'G'.repeat(60) } });
  });

  it('lets the trim be empty or missing, and clips it to 80 characters', () => {
    expect(checkIdentity({ ...good, trim: '' }, THIS_YEAR)).toEqual({ ok: true, value: { ...good, trim: '' } });
    expect(checkIdentity({ year: 2024, make: 'Nissan', model: 'GT-R', bodyClass: 'sports' }, THIS_YEAR)).toEqual({ ok: true, value: { ...good, trim: '' } });
    expect(checkIdentity({ ...good, trim: null }, THIS_YEAR)).toEqual({ ok: true, value: { ...good, trim: '' } });
    expect(checkIdentity({ ...good, trim: ' NISMO\tSpecial  Edition ' }, THIS_YEAR)).toEqual({ ok: true, value: { ...good, trim: 'NISMO Special Edition' } });
    expect(checkIdentity({ ...good, trim: 'T'.repeat(200) }, THIS_YEAR)).toEqual({ ok: true, value: { ...good, trim: 'T'.repeat(80) } });
  });

  it('refuses a trim that is not text rather than drop it', () => {
    for (const trim of [392, false, ['NISMO'], { name: 'NISMO' }]) expect(reasonOf({ ...good, trim })).toBe('trim must be text');
  });

  it('takes each of the nine body classes and nothing else', () => {
    for (const bodyClass of BODY_CLASSES) expect(checkIdentity({ ...good, bodyClass }, THIS_YEAR)).toEqual({ ok: true, value: { ...good, bodyClass } });
    for (const bodyClass of ['truck', 'Sedan', 'SUV / Crossover', 'convertible', '', null, undefined, 3, ['sedan'], 'constructor']) {
      expect(reasonOf({ ...good, bodyClass })).toBe('body class must be one of sports, coupe, sedan, hatchback, wagon, suv, offroad, pickup, van');
    }
  });

  it('refuses anything that is not an identity at all', () => {
    for (const input of [null, undefined, 'Nissan GT-R', 2024, true, [], [good]]) {
      expect(reasonOf(input)).toBe('a vehicle needs a year, a make, a model and a body class');
    }
  });

  it('changes nothing when it checks an identity it has already checked', () => {
    const rough = [
      { year: '1999', make: '  Mercedes-Benz\t', model: 'C 43\u0000 AMG', trim: ' ', bodyClass: 'sedan' },
      { year: 2027, make: 'm'.repeat(59) + ' tail', model: 'M'.repeat(59) + '\u{1F600}', trim: 't'.repeat(79) + ' tail', bodyClass: 'offroad' },
    ];
    expect(checkIdentity(rough[0], THIS_YEAR)).toStrictEqual({ ok: true, value: { year: 1999, make: 'Mercedes-Benz', model: 'C 43 AMG', trim: '', bodyClass: 'sedan' } });
    expect(checkIdentity(rough[1], THIS_YEAR)).toStrictEqual({ ok: true, value: { year: 2027, make: 'm'.repeat(59), model: 'M'.repeat(59), trim: 't'.repeat(79), bodyClass: 'offroad' } });
    for (const input of rough) {
      const first = checkIdentity(input, THIS_YEAR);
      expect(first.ok && checkIdentity(first.value, THIS_YEAR)).toStrictEqual(first);
    }
  });

  it('names the first thing wrong, in the order year, make, model, trim, body class', () => {
    const wrong = { year: 1700, make: '', model: '', trim: 7, bodyClass: 'boat' };
    expect(reasonOf(wrong)).toBe('year must be a whole number from 1886 to 2027');
    expect(reasonOf({ ...wrong, year: 2024 })).toBe('make is missing');
    expect(reasonOf({ ...wrong, year: 2024, make: 'Nissan' })).toBe('model is missing');
    expect(reasonOf({ ...wrong, year: 2024, make: 'Nissan', model: 'GT-R' })).toBe('trim must be text');
    expect(reasonOf({ ...wrong, year: 2024, make: 'Nissan', model: 'GT-R', trim: '' })).toMatch(/^body class must be one of /);
  });
});

describe('numeric fields', () => {
  it('accept both ends of their range, every one of them', () => {
    for (const field of RANGED) {
      for (const end of SPEC_RANGES[field]) {
        const out = setSpecField(blank, field, end, ref);
        expect(out.issue).toBeNull();
        expect(out.spec[field]).toEqual({ value: end, source: ref });
      }
    }
  });

  it('refuse a value below or above their range, every one of them, and the field stays as it was', () => {
    for (const field of RANGED) {
      const [lo, hi] = SPEC_RANGES[field];
      const step = isWhole(field) ? 1 : 0.001;
      const held = setSpecField(blank, field, lo, ref).spec;
      for (const outside of [lo - step, hi + step, -1, hi * 10]) {
        const onEmpty = setSpecField(blank, field, outside, owner);
        expect(onEmpty.issue).toEqual({ field, reason: rangeRule(field) });
        expect(onEmpty.spec[field]).toBeNull();
        const onHeld = setSpecField(held, field, outside, owner);
        expect(onHeld.issue).toEqual({ field, reason: rangeRule(field) });
        expect(onHeld.spec[field]).toEqual({ value: lo, source: ref });
      }
    }
  });

  it('state the range in the refusal, so the form can show it at the field', () => {
    expect(setSpecField(blank, 'horsepower', 30000, owner).issue).toEqual({ field: 'horsepower', reason: 'must be a number from 10 to 3000' });
    expect(setSpecField(blank, 'lateralGripG', 0.1, owner).issue).toEqual({ field: 'lateralGripG', reason: 'must be a number from 0.3 to 2' });
    expect(setSpecField(blank, 'cylinders', 17, owner).issue).toEqual({ field: 'cylinders', reason: 'must be a whole number from 0 to 16' });
    expect(setSpecField(blank, 'productionUnits', 0, owner).issue).toEqual({ field: 'productionUnits', reason: 'must be a whole number from 1 to 50000000' });
  });

  it('are never clipped into range', () => {
    const out = setSpecField(blank, 'horsepower', 3001, owner);
    expect(out.spec.horsepower).toBeNull();
    expect(setSpecField(blank, 'zeroToSixtySec', 0.5, owner).spec.zeroToSixtySec).toBeNull();
  });

  it('refuse cylinders and units built that are not whole numbers', () => {
    for (const field of WHOLE) {
      for (const fraction of [4.5, 6.000001, '4.5']) {
        const out = setSpecField(blank, field, fraction, owner);
        expect(out.issue).toEqual({ field, reason: rangeRule(field) });
        expect(out.spec[field]).toBeNull();
      }
      expect(setSpecField(blank, field, 6, owner).spec[field]).toEqual({ value: 6, source: owner });
      expect(setSpecField(blank, field, '6.0', owner).spec[field]).toEqual({ value: 6, source: owner });
    }
  });

  it('keep a fraction where a fraction is a figure', () => {
    expect(valueOf(setSpecField(blank, 'zeroToSixtySec', 2.9, owner).spec, 'zeroToSixtySec')).toBe(2.9);
    expect(valueOf(setSpecField(blank, 'displacementL', 3.799, owner).spec, 'displacementL')).toBe(3.799);
    expect(valueOf(setSpecField(blank, 'horsepower', 158.5, owner).spec, 'horsepower')).toBe(158.5);
    expect(valueOf(setSpecField(blank, 'warrantyPowertrainYears', 7.5, owner).spec, 'warrantyPowertrainYears')).toBe(7.5);
  });

  it('read a numeric string as the number it spells, because forms hand over strings', () => {
    const spelled: [SpecField, string, number][] = [
      ['horsepower', '600', 600], ['zeroToSixtySec', ' 2.9 ', 2.9], ['zeroToSixtySec', '2.90', 2.9], ['horsepower', '0600', 600],
      ['lateralGripG', '.5', 0.5], ['cylinders', '5.', 5], ['cylinders', '+12', 12], ['torqueLbFt', '\t481\n', 481],
    ];
    for (const [field, typed, figure] of spelled) {
      const out = setSpecField(blank, field, typed, owner);
      expect(out.issue).toBeNull();
      expect(out.spec[field]).toStrictEqual({ value: figure, source: owner });
    }
  });

  it('refuse anything else that is not a finite number', () => {
    const notNumbers = [
      Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '', '   ', 'six hundred', '600hp', '600 hp', '6 00', '1e3', '6E2', '0x258', '0b11', '1,234', '2,9',
      'Infinity', 'NaN', '--600', '6.0.0', '.', '+', '６００', true, false, [], [600], {}, { value: 600 }, () => 600,
    ];
    for (const value of notNumbers) {
      const out = setSpecField(blank, 'horsepower', value, owner);
      expect(out.issue).toEqual({ field: 'horsepower', reason: 'must be a number from 10 to 3000' });
      expect(out.spec.horsepower).toBeNull();
    }
  });

  it('never take an empty box, a blank, a list or a yes or no for the number it could be coerced into', () => {
    // Number('') and Number([]) are 0, Number(true) is 1 and Number([6]) is 6: all inside these ranges, none of them a figure.
    for (const field of ['cylinders', 'warrantyPowertrainMiles', 'warrantyPowertrainYears'] as const) {
      for (const value of ['', '   ', '\n', [], false, true, [6], ['6'], '0x8', '0b11', '0o7', '1e1']) {
        const out = setSpecField(blank, field, value, owner);
        expect(out.issue).toEqual({ field, reason: rangeRule(field) });
        expect(out.spec[field]).toBeNull();
      }
    }
  });

  it('never read a comma as a decimal point or as a thousands separator', () => {
    // "2,9" is 2.9 in Madrid and "3,867" is 3867 in Detroit. The engine cannot know which was meant, so it refuses both.
    const typed: [NumericSpecField, string][] = [
      ['zeroToSixtySec', '2,9'], ['displacementL', '3,8'], ['lateralGripG', '1,02'], ['curbWeightLb', '3,867'],
      ['warrantyPowertrainMiles', '60,000'], ['evRangeMiles', '1,000'], ['productionUnits', '1,500'], ['horsepower', '1.234,5'],
    ];
    for (const [field, text] of typed) {
      const out = setSpecField(blank, field, text, owner);
      expect(out.issue).toEqual({ field, reason: rangeRule(field) });
      expect(out.spec[field]).toBeNull();
    }
  });

  it('still hold a numeric string to the range', () => {
    expect(setSpecField(blank, 'horsepower', '3001', owner).issue).toEqual({ field: 'horsepower', reason: 'must be a number from 10 to 3000' });
    expect(setSpecField(blank, 'horsepower', '-600', owner).issue).toEqual({ field: 'horsepower', reason: 'must be a number from 10 to 3000' });
    expect(setSpecField(blank, 'horsepower', '9'.repeat(400), owner).issue).toEqual({ field: 'horsepower', reason: 'must be a number from 10 to 3000' });
  });

  it('store a negative zero as zero', () => {
    expect(Object.is(valueOf(setSpecField(blank, 'cylinders', -0, owner).spec, 'cylinders'), 0)).toBe(true);
    expect(Object.is(valueOf(setSpecField(blank, 'warrantyPowertrainMiles', '-0', owner).spec, 'warrantyPowertrainMiles'), 0)).toBe(true);
  });
});

describe('text fields', () => {
  it('clip over-long text to 120 characters', () => {
    for (const field of WORDS) {
      const out = setSpecField(blank, field, 'x'.repeat(500), owner);
      expect(out.issue).toBeNull();
      expect(valueOf(out.spec, field)).toBe('x'.repeat(120));
      expect(valueOf(setSpecField(blank, field, 'y'.repeat(120), owner).spec, field)).toBe('y'.repeat(120));
    }
  });

  it('have control characters removed and runs of white space squeezed to one space', () => {
    const out = setSpecField(blank, 'engine', '  3.8L\u0000 twin-turbo\tV6\r\n\u007f\u001b[31m ', owner);
    expect(out.issue).toBeNull();
    expect(out.spec.engine).toEqual({ value: '3.8L twin-turbo V6 [31m', source: owner });
    for (const field of WORDS) {
      const value = valueOf(setSpecField(blank, field, 'a\u0001b\u0008c\u001fd\u007fe', owner).spec, field) as string;
      expect(value).toBe('a b c d e');
    }
  });

  it('never end a clipped text in a space or in half a character', () => {
    const cutAfterSpace = setSpecField(blank, 'suspension', 'a'.repeat(119) + ' and the rest', owner);
    expect(cutAfterSpace.spec.suspension).toEqual({ value: 'a'.repeat(119), source: owner });
    const cutInsideEmoji = setSpecField(blank, 'suspension', 'a'.repeat(119) + '\u{1F600} and the rest', owner);
    expect(cutInsideEmoji.spec.suspension).toEqual({ value: 'a'.repeat(119), source: owner });
    const emojiThatFits = setSpecField(blank, 'suspension', 'a'.repeat(118) + '\u{1F600} and the rest', owner);
    expect(emojiThatFits.spec.suspension).toEqual({ value: 'a'.repeat(118) + '\u{1F600}', source: owner });
  });

  it('are cleared by empty text, with no issue', () => {
    const held = setSpecField(blank, 'engine', '3.8L twin-turbo V6', ref).spec;
    for (const empty of ['', '   ', '\n\t ', '\u0000\u0007']) {
      const out = setSpecField(held, 'engine', empty, owner);
      expect(out.issue).toBeNull();
      expect(out.spec.engine).toBeNull();
    }
  });

  it('refuse a value that is not text and stay as they were', () => {
    const held = setSpecField(blank, 'engine', '3.8L twin-turbo V6', ref).spec;
    for (const field of WORDS) {
      for (const value of [42, 0, true, false, ['V6'], { text: 'V6' }]) {
        const out = setSpecField(held, field, value, owner);
        expect(out.issue).toEqual({ field, reason: 'must be text' });
        expect(out.spec).toEqual(held);
      }
    }
  });
});

describe('choice fields', () => {
  it('accept each value their type allows', () => {
    for (const field of CHOICES) {
      const values = ALLOWED[field];
      expect(values.length).toBeGreaterThanOrEqual(2);
      expect(new Set(values).size).toBe(values.length);
      for (const value of values) {
        const out = setSpecField(blank, field, value, ref);
        expect(out.issue).toBeNull();
        expect(out.spec[field]).toEqual({ value, source: ref });
      }
    }
  });

  it('refuse anything else, naming the values allowed, and stay as they were', () => {
    for (const field of CHOICES) {
      const values = ALLOWED[field];
      const held = setSpecField(blank, field, values[0], ref).spec;
      for (const value of ['steam', values[0].toUpperCase() + '!', ` ${values[0]}`, '', 0, 1, true, [values[0]], { value: values[0] }, 'constructor', 'length']) {
        const out = setSpecField(held, field, value, owner);
        expect(out.issue).toEqual({ field, reason: `must be one of ${values.join(', ')}` });
        expect(out.spec[field]).toEqual({ value: values[0], source: ref });
      }
    }
  });

  it('are matched exactly, capitals included', () => {
    expect(setSpecField(blank, 'drivetrain', 'awd', owner).issue).toEqual({ field: 'drivetrain', reason: 'must be one of FWD, RWD, AWD, 4WD' });
    expect(setSpecField(blank, 'powertrain', 'Electric', owner).issue).toEqual({ field: 'powertrain', reason: 'must be one of gasoline, diesel, hybrid, plug-in-hybrid, electric' });
    // A value of another field's type is not one of this field's.
    expect(setSpecField(blank, 'brakeGrade', 'sport', owner).issue).toEqual({ field: 'brakeGrade', reason: 'must be one of standard, performance, carbon-ceramic' });
  });
});

describe('the limiter flag', () => {
  it('accepts true and false and nothing else', () => {
    expect(setSpecField(blank, 'topSpeedGoverned', true, ref).spec.topSpeedGoverned).toEqual({ value: true, source: ref });
    expect(setSpecField(blank, 'topSpeedGoverned', false, ref).spec.topSpeedGoverned).toEqual({ value: false, source: ref });
    const held = setSpecField(blank, 'topSpeedGoverned', true, ref).spec;
    for (const value of ['true', 'false', 'yes', 'on', '', 1, 0, [], {}, [true]]) {
      const out = setSpecField(held, 'topSpeedGoverned', value, owner);
      expect(out.issue).toEqual({ field: 'topSpeedGoverned', reason: 'must be true or false' });
      expect(out.spec.topSpeedGoverned).toEqual({ value: true, source: ref });
    }
  });
});

describe('sources', () => {
  it('are refused when their kind is not a known one, and the field stays as it was', () => {
    const held = setSpecField(blank, 'horsepower', 565, ref).spec;
    for (const bad of [{ kind: 'forum' }, { kind: 'Manufacturer' }, { kind: ' owner' }, { kind: '' }, { kind: null }, { kind: ['owner'] }, {}, { name: 'Maker press kit' }, null, undefined, 'manufacturer', 42, ['owner'], { kind: 'constructor' }]) {
      for (const spec of [blank, held]) {
        const out = setSpecField(spec, 'horsepower', 600, bad as unknown as Source);
        expect(out.issue).toEqual({ field: 'horsepower', reason: SOURCE_RULE });
        expect(out.spec).toEqual(spec);
      }
    }
  });

  it('are accepted for each of the six kinds', () => {
    for (const kind of KINDS) {
      const out = setSpecField(blank, 'horsepower', 600, { kind });
      expect(out.issue).toBeNull();
      expect(out.spec.horsepower).toStrictEqual({ value: 600, source: { kind } });
    }
  });

  it('keep a clean source exactly as it was given', () => {
    for (const source of [maker, agency, magazine, ref, owner, demo]) expect(cleaned(source)).toStrictEqual(source);
  });

  it('have the publisher’s name cleaned and clipped to 80 characters', () => {
    expect(cleaned({ kind: 'test', name: '  Road\u0000 test \n magazine ' })).toStrictEqual({ kind: 'test', name: 'Road test magazine' });
    expect(cleaned({ kind: 'test', name: 'n'.repeat(200) })).toStrictEqual({ kind: 'test', name: 'n'.repeat(80) });
    for (const name of ['', '   ', 42, null, { text: 'Road test' }]) expect(cleaned({ kind: 'test', name })).toStrictEqual({ kind: 'test' });
  });

  it('keep a web address only when it starts with https:// or http://', () => {
    // An address is judged by its scheme and its length and by nothing else: one that passes is kept exactly as given.
    for (const url of ['https://example.com/a?b=c#d', 'http://example.com', 'https://example.com/tested/2024 gt-r']) {
      expect(cleaned({ kind: 'reference', url })).toStrictEqual({ kind: 'reference', url });
    }
    const without = [
      'example.com', 'www.example.com/specs', '//example.com/specs', 'ftp://example.com/file', 'file:///etc/passwd', 'mailto:someone@example.com',
      'HTTPS://EXAMPLE.COM', ' https://example.com', 'https:/example.com', 'https:example.com', 'http//example.com', 'ahttp://example.com', '', 42, null, ['https://example.com'], { href: 'https://example.com' },
    ];
    for (const url of without) expect(cleaned({ kind: 'reference', name: 'test fixture', url })).toStrictEqual({ kind: 'reference', name: 'test fixture' });
  });

  it('drop a javascript: address, however it is dressed', () => {
    const scripts = [
      'javascript:alert(1)', 'JavaScript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)', '\tjavascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)',
      '\u0000javascript:alert(1)', 'javascript://example.com/%0Aalert(1)', 'javascript:https://example.com', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)',
    ];
    for (const url of scripts) {
      const out = setSpecField(blank, 'horsepower', 600, { kind: 'reference', url });
      expect(out.issue).toBeNull();
      expect(out.spec.horsepower).toStrictEqual({ value: 600, source: { kind: 'reference' } });
    }
  });

  it('drop a web address longer than 300 characters rather than cut it', () => {
    const stem = 'https://example.com/';
    const atLimit = stem + 'a'.repeat(300 - stem.length);
    expect(atLimit).toHaveLength(300);
    expect(cleaned({ kind: 'reference', url: atLimit })).toStrictEqual({ kind: 'reference', url: atLimit });
    expect(cleaned({ kind: 'reference', url: atLimit + 'a' })).toStrictEqual({ kind: 'reference' });
  });

  it('keep the day they were read only when it is a real day', () => {
    expect(cleaned({ kind: 'owner', asOf: '2024-02-29' })).toStrictEqual({ kind: 'owner', asOf: '2024-02-29' });
    for (const asOf of ['2026-02-30', '2026-13-01', '11/10/2026', '2026-11-10T14:03:00.000Z', ' 2026-11-10', '', 20261110, null, {}]) {
      expect(cleaned({ kind: 'owner', asOf })).toStrictEqual({ kind: 'owner' });
    }
  });

  it('have their note cleaned and clipped to 300 characters', () => {
    expect(cleaned({ kind: 'reference', note: ' read from a\tsearch result;\npage not opened ' })).toStrictEqual({ kind: 'reference', note: 'read from a search result; page not opened' });
    expect(cleaned({ kind: 'reference', note: 'n'.repeat(1000) })).toStrictEqual({ kind: 'reference', note: 'n'.repeat(300) });
    for (const note of ['', ' \n ', 7, null, ['a note']]) expect(cleaned({ kind: 'reference', note })).toStrictEqual({ kind: 'reference' });
  });

  it('carry nothing but kind, name, url, asOf and note', () => {
    const loose = { kind: 'manufacturer', name: 'Maker press kit (test fixture)', url: 'https://example.com/press', asOf: TODAY, note: 'as printed', publisher: 'someone', verified: true, price: 220990 };
    expect(cleaned(loose)).toStrictEqual({ kind: 'manufacturer', name: 'Maker press kit (test fixture)', url: 'https://example.com/press', asOf: TODAY, note: 'as printed' });
    expect(Object.keys(cleaned(loose) as Source)).toEqual(['kind', 'name', 'url', 'asOf', 'note']);
  });

  it('are copied into the specification, so a later change to the caller’s object changes nothing', () => {
    const mine: Source = { kind: 'owner', asOf: TODAY };
    const out = setSpecField(blank, 'horsepower', 600, mine);
    expect(sourceOf(out.spec, 'horsepower')).not.toBe(mine);
    mine.kind = 'manufacturer';
    mine.name = 'not what the owner typed';
    expect(out.spec.horsepower).toStrictEqual({ value: 600, source: { kind: 'owner', asOf: TODAY } });
  });
});

describe('setting and clearing a field', () => {
  it('returns a new specification and leaves the one it was given untouched', () => {
    const before = frozen(setSpecField(blank, 'horsepower', 600, ref).spec);
    const text = JSON.stringify(before);
    const source = frozen({ kind: 'owner', asOf: TODAY, name: '  me  ', url: 'not a link' } as Source);
    const out = setSpecField(before, 'torqueLbFt', '481', source);
    expect(out.issue).toBeNull();
    expect(out.spec).not.toBe(before);
    expect(out.spec).toEqual({ ...before, torqueLbFt: { value: 481, source: { kind: 'owner', name: 'me', asOf: TODAY } } });
    expect(JSON.stringify(before)).toBe(text);
    expect(before.torqueLbFt).toBeNull();
    expect(source).toEqual({ kind: 'owner', asOf: TODAY, name: '  me  ', url: 'not a link' });
  });

  it('replaces a figure and its source together', () => {
    const first = setSpecField(blank, 'horsepower', 565, ref).spec;
    const second = setSpecField(first, 'horsepower', 600, maker);
    expect(second.issue).toBeNull();
    expect(second.spec.horsepower).toEqual({ value: 600, source: maker });
    expect(first.horsepower).toEqual({ value: 565, source: ref });
  });

  it('clears the field when the value is null or undefined, with no issue, whatever the source', () => {
    for (const field of ALL_FIELDS) {
      for (const nothing of [null, undefined]) {
        for (const source of [owner, { kind: 'forum' } as unknown as Source, undefined as unknown as Source]) {
          const out = setSpecField(full, field, nothing, source);
          expect(out.issue).toBeNull();
          expect(out.spec).toEqual({ ...full, [field]: null });
          expect(out.spec).toEqual(clearSpecField(full, field));
        }
      }
    }
  });

  it('hands back a new object even when it refuses, equal to the one it was given', () => {
    const held = frozen(setSpecField(blank, 'horsepower', 600, ref).spec);
    const out = setSpecField(held, 'horsepower', 'plenty', owner);
    const issue: SpecIssue | null = out.issue;
    expect(issue).toEqual({ field: 'horsepower', reason: 'must be a number from 10 to 3000' });
    expect(out.spec).not.toBe(held);
    expect(out.spec).toEqual(held);
  });

  it('gives the same answer twice', () => {
    expect(setSpecField(full, 'horsepower', ' 601 ', maker)).toEqual(setSpecField(full, 'horsepower', ' 601 ', maker));
    expect(setSpecField(full, 'horsepower', 99999, maker)).toEqual(setSpecField(full, 'horsepower', 99999, maker));
  });

  it('clearSpecField empties one field in a new object and leaves its input untouched', () => {
    const text = JSON.stringify(full);
    for (const field of ALL_FIELDS) {
      const out = clearSpecField(full, field);
      expect(out).not.toBe(full);
      expect(out[field]).toBeNull();
      expect(out).toEqual({ ...full, [field]: null });
    }
    expect(JSON.stringify(full)).toBe(text);
    const again = clearSpecField(blank, 'horsepower');
    expect(again).not.toBe(blank);
    expect(again).toEqual(blank);
  });

  it('refuses a field the specification does not have, and never lets the identity be overwritten or cleared', () => {
    for (const name of ['identity', 'msrp', 'Horsepower', 'toString', 'constructor', '__proto__', '']) {
      const out = setSpecField(full, name as SpecField, 600, owner);
      expect(out.issue).toEqual({ field: name, reason: 'is not a field of the specification' });
      expect(out.spec).toEqual(full);
      expect(Object.keys(out.spec)).toEqual(Object.keys(full));
      const cleared = clearSpecField(full, name as SpecField);
      expect(cleared).toEqual(full);
      expect(Object.keys(cleared)).toEqual(Object.keys(full));
      expect(setSpecField(full, name as SpecField, null, owner).spec).toEqual(full);
    }
  });
});

describe('reading a stored specification', () => {
  it('gives back a full specification unchanged after a trip through JSON, with no issues', () => {
    const text = JSON.stringify(full);
    const { spec, issues } = parseSpec(JSON.parse(text), THIS_YEAR);
    expect(issues).toEqual([]);
    expect(spec).toStrictEqual(full);
    expect(JSON.stringify(spec)).toBe(text);
  });

  it('gives back an empty specification unchanged too', () => {
    expect(parseSpec(JSON.parse(JSON.stringify(blank)), THIS_YEAR)).toStrictEqual({ spec: blank, issues: [] });
  });

  it('gives back unchanged whatever setSpecField built from loose input', () => {
    const loose: [SpecField, unknown, unknown][] = [
      ['engine', '  3.8L\u0000 twin-turbo   V6 ' + 'x'.repeat(200), { kind: 'manufacturer', name: 'n'.repeat(200), url: 'javascript:alert(1)', asOf: 'yesterday', note: 'o'.repeat(900) }],
      ['suspension', 'a'.repeat(119) + ' \u{1F600} tail', { kind: 'owner', asOf: TODAY, extra: 1 }],
      ['horsepower', ' 600 ', { kind: 'reference', name: 'a'.repeat(79) + ' b', url: 'https://example.com/x', note: 'c'.repeat(299) + ' d' }],
      ['cylinders', -0, { kind: 'illustrative', note: '' }],
      ['zeroToSixtySec', '2.90', { kind: 'test', name: '  Road test  ' }],
      ['drivetrain', 'AWD', { kind: 'agency', url: 'http://example.gov/' }],
      ['topSpeedGoverned', true, { kind: 'reference' }],
    ];
    let spec = emptySpec(identity);
    for (const [field, value, source] of loose) {
      const out = setSpecField(spec, field, value, source as Source);
      expect(out.issue).toBeNull();
      spec = out.spec;
    }
    const text = JSON.stringify(spec);
    const back = parseSpec(JSON.parse(text), THIS_YEAR);
    expect(back.issues).toEqual([]);
    expect(back.spec).toStrictEqual(spec);
    expect(JSON.stringify(back.spec)).toBe(text);
  });

  it('reads back unchanged whatever setSpecField let in, for every field and every sort of value', () => {
    const values: unknown[] = [
      0, -0, 1, 2, 6, 16, 25, 600, 2.9, 0.95, 1e9, -5, 4.5, Number.NaN, Number.POSITIVE_INFINITY,
      '600', ' 2.9 ', '6', '', ' ', 'abc', 'AWD', 'gasoline', 'standard', 'unibody', 'natural', 'manual', 'sport', true, false, [], {},
      'x'.repeat(500), 'a'.repeat(119) + ' b', 'a'.repeat(119) + '\u{1F600}', 'tab\tand\nnewline', '\u0000', '  padded  ', '\ud83d', 'half \ud83d inside',
    ];
    let kept = 0;
    let refused = 0;
    for (const field of ALL_FIELDS) {
      for (const value of values) {
        const out = setSpecField(blank, field, value, owner);
        if (out.issue !== null) {
          refused += 1;
          expect(out.issue.field).toBe(field);
          expect(out.spec).toStrictEqual(blank);
          continue;
        }
        if (out.spec[field] !== null) kept += 1;
        const back = parseSpec(JSON.parse(JSON.stringify(out.spec)), THIS_YEAR);
        expect(back).toStrictEqual({ spec: out.spec, issues: [] });
      }
    }
    expect(kept).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(500);
  });

  it('reads back unchanged whatever source setSpecField let in', () => {
    const parts: unknown[] = [
      undefined, null, '', ' ', 'plain', '  padded  ', 'n'.repeat(79) + ' tail', 'n'.repeat(299) + ' tail', 'n'.repeat(79) + '\u{1F600}', 'tab\tnew\nline\u0000', 42, {},
      'https://example.com/a b', 'http://example.com', ' https://example.com ', 'javascript:alert(1)', 'https://example.com/' + 'a'.repeat(400), TODAY, '2026-02-30',
    ];
    for (const kind of KINDS) {
      for (const part of parts) {
        const out = setSpecField(blank, 'horsepower', 600, { kind, name: part, url: part, asOf: part, note: part } as unknown as Source);
        expect(out.issue).toBeNull();
        expect(parseSpec(JSON.parse(JSON.stringify(out.spec)), THIS_YEAR)).toStrictEqual({ spec: out.spec, issues: [] });
      }
    }
  });

  it('keeps every figure at either end of its range through storage', () => {
    for (const end of [0, 1] as const) {
      let spec = emptySpec(identity);
      for (const field of RANGED) spec = setSpecField(spec, field, SPEC_RANGES[field][end], ref).spec;
      for (const field of RANGED) expect(valueOf(spec, field)).toBe(SPEC_RANGES[field][end]);
      expect(parseSpec(JSON.parse(JSON.stringify(spec)), THIS_YEAR)).toStrictEqual({ spec, issues: [] });
    }
  });

  it('returns no specification when the identity is bad, and says what is wrong with it', () => {
    const noYear = stored(full);
    noYear.identity.year = 1700;
    expect(parseSpec(noYear, THIS_YEAR)).toEqual({ spec: null, issues: [{ field: 'identity', reason: 'year must be a whole number from 1886 to 2027' }] });
    const noMake = stored(full);
    noMake.identity.make = '   ';
    expect(parseSpec(noMake, THIS_YEAR)).toEqual({ spec: null, issues: [{ field: 'identity', reason: 'make is missing' }] });
    const noClass = stored(full);
    noClass.identity.bodyClass = 'Coupe / Sports';
    expect(parseSpec(noClass, THIS_YEAR)).toEqual({ spec: null, issues: [{ field: 'identity', reason: 'body class must be one of sports, coupe, sedan, hatchback, wagon, suv, offroad, pickup, van' }] });
    const fromTheFuture = stored(full);
    expect(parseSpec(fromTheFuture, 2022)).toEqual({ spec: null, issues: [{ field: 'identity', reason: 'year must be a whole number from 1886 to 2023' }] });
  });

  it('returns no specification for input that is not one at all', () => {
    const missing = { spec: null, issues: [{ field: 'identity', reason: 'a vehicle needs a year, a make, a model and a body class' }] };
    for (const input of [null, undefined, '', 'a GT-R', 42, true, [], [stored(full)], {}, { horsepower: { value: 600, source: { kind: 'owner' } } }, { identity: null }, { identity: 'Nissan GT-R' }]) {
      expect(parseSpec(input, THIS_YEAR)).toEqual(missing);
    }
  });

  it('turns one bad field into null and one issue, and keeps the rest', () => {
    const spoiled = stored(full);
    spoiled.horsepower.value = 30000;
    const { spec, issues } = parseSpec(spoiled, THIS_YEAR);
    expect(issues).toEqual([{ field: 'horsepower', reason: 'must be a number from 10 to 3000' }]);
    expect(spec).toStrictEqual({ ...full, horsepower: null });
  });

  it('checks every field as setSpecField does, and lists the issues in the order of the specification', () => {
    const spoiled = stored(full);
    spoiled.productionUnits.value = 12.5;
    spoiled.brakeGrade.value = 'drum';
    spoiled.engine.value = 38;
    spoiled.topSpeedGoverned.value = 'no';
    spoiled.cityMpg.source = { kind: 'hearsay' };
    spoiled.torqueLbFt.source.kind = 'dealer';
    (spoiled as Record<string, unknown>).curbWeightLb = 3867;
    (spoiled as Record<string, unknown>).drivetrain = 'AWD';
    (spoiled as Record<string, unknown>).cylinders = [6];
    (spoiled as Record<string, unknown>).highwayMpg = { value: 22 };
    const { spec, issues } = parseSpec(spoiled, THIS_YEAR);
    expect(issues).toEqual([
      { field: 'engine', reason: 'must be text' },
      { field: 'cylinders', reason: 'must be a value with its source' },
      { field: 'torqueLbFt', reason: SOURCE_RULE },
      { field: 'drivetrain', reason: 'must be a value with its source' },
      { field: 'curbWeightLb', reason: 'must be a value with its source' },
      { field: 'topSpeedGoverned', reason: 'must be true or false' },
      { field: 'cityMpg', reason: SOURCE_RULE },
      { field: 'highwayMpg', reason: SOURCE_RULE },
      { field: 'brakeGrade', reason: 'must be one of standard, performance, carbon-ceramic' },
      { field: 'productionUnits', reason: 'must be a whole number from 1 to 50000000' },
    ]);
    expect(spec).toStrictEqual({
      ...full, engine: null, cylinders: null, torqueLbFt: null, drivetrain: null, curbWeightLb: null, topSpeedGoverned: null,
      cityMpg: null, highwayMpg: null, brakeGrade: null, productionUnits: null,
    });
  });

  it('reports one issue for a field that is wrong twice over', () => {
    const spoiled = stored(full);
    spoiled.horsepower.value = -5;
    spoiled.horsepower.source = { kind: 'hearsay' };
    expect(parseSpec(spoiled, THIS_YEAR).issues).toEqual([{ field: 'horsepower', reason: 'must be a number from 10 to 3000' }]);
  });

  it('leaves a field nobody supplied as null, without an issue', () => {
    const sparse = { identity: { ...identity }, horsepower: { value: 600, source: { kind: 'owner', asOf: TODAY } }, torqueLbFt: null, engine: { value: '', source: { kind: 'owner' } }, cylinders: { value: null, source: { kind: 'owner' } } };
    const { spec, issues } = parseSpec(sparse, THIS_YEAR);
    expect(issues).toEqual([]);
    expect(spec).toStrictEqual({ ...blank, horsepower: { value: 600, source: { kind: 'owner', asOf: TODAY } } });
  });

  it('cleans what it keeps: values, sources and the identity', () => {
    const loose = {
      identity: { year: '2024', make: ' Nissan ', model: 'GT-R\n', trim: 'NISMO', bodyClass: 'sports', nickname: 'Godzilla' },
      horsepower: { value: ' 600 ', source: { kind: 'reference', name: ' test\tfixture ', url: 'javascript:alert(1)', asOf: 'today', note: '', rank: 1 }, checked: true },
      engine: { value: ' 3.8L\u0000 twin-turbo V6 ', source: { kind: 'manufacturer', url: 'https://example.com/press' } },
      msrp: { value: 220990, source: { kind: 'manufacturer' } },
      notes: 'kept in a garage',
    };
    const { spec, issues } = parseSpec(loose, THIS_YEAR);
    expect(issues).toEqual([]);
    expect(spec).toStrictEqual({
      ...blank,
      engine: { value: '3.8L twin-turbo V6', source: { kind: 'manufacturer', url: 'https://example.com/press' } },
      horsepower: { value: 600, source: { kind: 'reference', name: 'test fixture' } },
    });
    expect(Object.keys(spec as VehicleSpec)).toEqual(Object.keys(blank));
  });

  it('writes the fields in the order of the specification, whatever order they were stored in', () => {
    const shuffled: Record<string, unknown> = {};
    for (const key of Object.keys(full).reverse()) shuffled[key] = JSON.parse(JSON.stringify((full as Record<string, unknown>)[key]));
    expect(Object.keys(shuffled)[0]).toBe('productionUnits');
    const { spec, issues } = parseSpec(shuffled, THIS_YEAR);
    expect(issues).toEqual([]);
    expect(JSON.stringify(spec)).toBe(JSON.stringify(full));
  });

  it('does not touch its input and shares nothing with it', () => {
    const input = stored(full);
    const text = JSON.stringify(input);
    const { spec } = parseSpec(frozen(stored(full)), THIS_YEAR);
    expect(spec).toStrictEqual(full);
    const parsed = parseSpec(input, THIS_YEAR).spec as VehicleSpec;
    expect(JSON.stringify(input)).toBe(text);
    input.identity.model = 'Altima';
    input.horsepower.value = 1;
    input.horsepower.source.name = 'changed afterwards';
    expect(parsed).toStrictEqual(full);
  });

  it('gives the same answer twice', () => {
    const spoiled = stored(full);
    spoiled.horsepower.value = 'plenty';
    expect(parseSpec(spoiled, THIS_YEAR)).toEqual(parseSpec(spoiled, THIS_YEAR));
  });
});

describe('body classes from the other apps', () => {
  it('maps the value app’s six body styles', () => {
    expect(bodyClassFromValueBody('Sedan')).toBe('sedan');
    expect(bodyClassFromValueBody('SUV / Crossover')).toBe('suv');
    expect(bodyClassFromValueBody('Pickup Truck')).toBe('pickup');
    expect(bodyClassFromValueBody('Coupe / Sports')).toBe('coupe');
    expect(bodyClassFromValueBody('Hatchback / Wagon')).toBe('hatchback');
    expect(bodyClassFromValueBody('Minivan')).toBe('van');
  });

  it('falls back to a sedan for a body style the value app does not have', () => {
    for (const name of ['', 'Convertible', 'sedan', 'SUV', 'suv', 'Pickup', 'pickup truck', ' Sedan', 'Minivan ', 'constructor', 'toString', '__proto__']) {
      expect(bodyClassFromValueBody(name)).toBe('sedan');
    }
    for (const notText of [undefined, null, 7, {}]) expect(bodyClassFromValueBody(notText as unknown as string)).toBe('sedan');
  });

  it('maps the sim’s seven body styles', () => {
    expect(bodyClassFromSimStyle('sedan')).toBe('sedan');
    expect(bodyClassFromSimStyle('coupe')).toBe('coupe');
    expect(bodyClassFromSimStyle('hatchback')).toBe('hatchback');
    expect(bodyClassFromSimStyle('suv')).toBe('suv');
    expect(bodyClassFromSimStyle('van')).toBe('van');
    expect(bodyClassFromSimStyle('truck')).toBe('pickup');
    expect(bodyClassFromSimStyle('sports')).toBe('sports');
  });

  it('falls back to a sedan for anything the sim does not call a style, as the sim itself does', () => {
    // 'wagon', 'pickup' and 'offroad' are classes of the engine but not styles of the sim, so they are unknown here.
    for (const style of ['', 'limo', 'Truck', 'SEDAN', 'wagon', 'pickup', 'offroad', 'sport', ' suv', 'constructor', 'toString', '__proto__']) {
      expect(bodyClassFromSimStyle(style)).toBe('sedan');
    }
    for (const notText of [undefined, null, 7, {}]) expect(bodyClassFromSimStyle(notText as unknown as string)).toBe('sedan');
  });

  it('only ever answers with a body class', () => {
    for (const input of ['Sedan', 'SUV / Crossover', 'Pickup Truck', 'Coupe / Sports', 'Hatchback / Wagon', 'Minivan', 'sedan', 'coupe', 'hatchback', 'suv', 'van', 'truck', 'sports', 'anything else']) {
      expect(BODY_CLASSES).toContain(bodyClassFromValueBody(input));
      expect(BODY_CLASSES).toContain(bodyClassFromSimStyle(input));
    }
  });
});

describe('counting sources', () => {
  it('counts the fields behind each kind of source', () => {
    expect(sourceCounts(full)).toStrictEqual({ manufacturer: 14, agency: 3, test: 4, reference: 7, owner: 1, illustrative: 1 });
  });

  it('answers with all six kinds, at zero for an empty specification', () => {
    expect(sourceCounts(blank)).toStrictEqual({ manufacturer: 0, agency: 0, test: 0, reference: 0, owner: 0, illustrative: 0 });
    expect(Object.keys(sourceCounts(blank))).toEqual(KINDS);
  });

  it('follows a field as it is set, replaced and cleared', () => {
    const typed = setSpecField(blank, 'horsepower', 600, owner).spec;
    expect(sourceCounts(typed)).toMatchObject({ owner: 1, manufacturer: 0 });
    const replaced = setSpecField(typed, 'horsepower', 600, maker).spec;
    expect(sourceCounts(replaced)).toMatchObject({ owner: 0, manufacturer: 1 });
    expect(sourceCounts(clearSpecField(replaced, 'horsepower'))).toMatchObject({ owner: 0, manufacturer: 0 });
  });

  it('counts only kinds it knows, and does not change the specification it counts', () => {
    const text = JSON.stringify(full);
    const odd = { ...full, horsepower: { value: 600, source: { kind: 'hearsay' } } } as unknown as VehicleSpec;
    expect(sourceCounts(odd)).toStrictEqual({ manufacturer: 13, agency: 3, test: 4, reference: 7, owner: 1, illustrative: 1 });
    expect(sourceCounts(full)).toEqual(sourceCounts(full));
    expect(JSON.stringify(full)).toBe(text);
  });

  it('counts a field that is missing altogether as an empty one', () => {
    const partial = { identity, horsepower: { value: 600, source: owner } } as unknown as VehicleSpec;
    expect(sourceCounts(partial)).toStrictEqual({ manufacturer: 0, agency: 0, test: 0, reference: 0, owner: 1, illustrative: 0 });
  });
});
