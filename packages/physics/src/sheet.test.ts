import { describe, expect, it } from 'vitest';
import type { BodyClass, PhysicsSheet, SheetTests, SourceKind } from './types';
import type { AuthoredSpec, ResearchField, ResearchRecord, TableRow } from './sheet';
import {
  DRIVER_KG, LOADED_RADIUS_SHARE, TABLE_NOTE, emptySheet, isSetApart, readResearch, sheetFromAuthored, sheetFromResearch, sheetFromTable,
  sheetProblems, tableProblems, tyreSizeFor,
} from './sheet';
import { IN, LB, SQFT, parseTyreSize } from './units';
import { SHEETS, sheetById } from './data/sheets';

/* ------------------------------------------------------------------ helpers */

const GATHERED = '2026-11-14';

function record(fields: ResearchField[], over: Partial<ResearchRecord> = {}): ResearchRecord {
  return { id: 'test-car', year: 2024, make: 'Test', model: 'Car', trim: 'Test trim', bodyClass: 'coupe', gathered: GATHERED, fields, ...over };
}
function num(key: string, number: number, sourceKind = 'manufacturer'): ResearchField {
  return { key, number, publisher: `Publisher of ${key}`, url: `https://example.org/${key}`, sourceKind, note: `Note on ${key}` };
}
function txt(key: string, text: string, sourceKind = 'manufacturer'): ResearchField {
  return { key, text, publisher: `Publisher of ${key}`, url: `https://example.org/${key}`, sourceKind, note: `Note on ${key}` };
}
/** A field the second reader confirmed (every real record's figures carry a check mark; a test figure without one is set apart). */
function read2(f: ResearchField): ResearchField { return { ...f, check: 'confirmed' }; }
/** The sheet a record of these fields gives, on a coupe unless the record says otherwise. */
function read(fields: ResearchField[], over: Partial<ResearchRecord> = {}): PhysicsSheet { return sheetFromResearch(record(fields, over)); }
function droppedKeys(fields: ResearchField[], over: Partial<ResearchRecord> = {}): string[] { return sheetProblems(record(fields, over)).map((p) => p.key); }

/* ------------------------------------------------------------------ every key of the research format */

// A record with every key data/research/README.md lists. The figures are modelled on a 2024 GT-R NISMO, with the
// keys its real record lacks filled with plausible values: it is a fixture for the reader, not research.
type Expect = { key: string; path: string; field: ResearchField };
const FULL: Expect[] = [
  // size and mass
  { key: 'wheelbaseIn', path: 'wheelbaseIn', field: num('wheelbaseIn', 109.4, 'reference') },
  { key: 'trackFrontIn', path: 'trackFrontIn', field: num('trackFrontIn', 63.0, 'reference') },
  { key: 'trackRearIn', path: 'trackRearIn', field: num('trackRearIn', 62.6, 'reference') },
  { key: 'lengthIn', path: 'lengthIn', field: num('lengthIn', 184.6, 'reference') },
  { key: 'widthIn', path: 'widthIn', field: num('widthIn', 74.6, 'reference') },
  { key: 'heightIn', path: 'heightIn', field: num('heightIn', 53.9, 'reference') },
  { key: 'curbWeightLb', path: 'curbWeightLb', field: num('curbWeightLb', 3867) },
  { key: 'weightDistFrontPct', path: 'weightDistFrontPct', field: num('weightDistFrontPct', 54) },
  { key: 'groundClearanceIn', path: 'groundClearanceIn', field: num('groundClearanceIn', 4.1, 'reference') },
  { key: 'cgHeightIn', path: 'cgHeightIn', field: num('cgHeightIn', 18.1, 'agency') },
  // engine
  { key: 'powertrain', path: 'powertrain', field: txt('powertrain', 'gasoline') },
  { key: 'induction', path: 'induction', field: txt('induction', 'twin-turbo') },
  { key: 'engineLocation', path: 'engineLocation', field: txt('engineLocation', 'front') },
  { key: 'displacementL', path: 'displacementL', field: num('displacementL', 3.8) },
  { key: 'cylinders', path: 'cylinders', field: num('cylinders', 6) },
  { key: 'horsepower', path: 'horsepower', field: num('horsepower', 600) },
  { key: 'horsepowerRpm', path: 'horsepowerRpm', field: num('horsepowerRpm', 6800) },
  { key: 'torqueLbFt', path: 'torqueLbFt', field: num('torqueLbFt', 481) },
  { key: 'torqueRpmLow', path: 'torqueRpmLow', field: num('torqueRpmLow', 3600) },
  { key: 'torqueRpmHigh', path: 'torqueRpmHigh', field: num('torqueRpmHigh', 5600) },
  { key: 'redlineRpm', path: 'redlineRpm', field: num('redlineRpm', 7100, 'reference') },
  { key: 'boostPsi', path: 'boostPsi', field: num('boostPsi', 21.3, 'reference') },
  { key: 'compressionRatio', path: 'compressionRatio', field: num('compressionRatio', 9.0) },
  // driveline
  { key: 'drivetrain', path: 'drivetrain', field: txt('drivetrain', 'AWD') },
  { key: 'awdSystem', path: 'awdKind', field: txt('awdSystem', 'ATTESA E-TS: rear-biased, torque split 0:100 in normal driving, up to 50:50 front:rear') },
  { key: 'transmissionType', path: 'transmissionType', field: txt('transmissionType', '6-speed dual-clutch') },
  { key: 'gearRatios', path: 'gearRatios', field: { ...num('gearRatios', 0), number: undefined, numbers: [4.056, 2.301, 1.595, 1.248, 1.001, 0.796] } },
  { key: 'finalDriveRatio', path: 'finalDriveRatio', field: num('finalDriveRatio', 3.7, 'reference') },
  { key: 'differential', path: 'diffFront', field: txt('differential', 'limited-slip front and rear') },
  // tyres
  { key: 'tyreFront', path: 'tyreFront', field: txt('tyreFront', '255/40ZRF20') },
  { key: 'tyreRear', path: 'tyreRear', field: txt('tyreRear', '285/35ZRF20') },
  { key: 'tyreCategory', path: 'tyreCategory', field: txt('tyreCategory', 'max-performance', 'reference') },
  // air
  { key: 'dragCoefficient', path: 'dragCoefficient', field: num('dragCoefficient', 0.26) },
  { key: 'frontalAreaSqFt', path: 'frontalAreaSqFt', field: num('frontalAreaSqFt', 23.4, 'reference') },
  { key: 'liftCoefficientFront', path: 'liftCoefficientFront', field: num('liftCoefficientFront', -0.05, 'reference') },
  { key: 'liftCoefficientRear', path: 'liftCoefficientRear', field: num('liftCoefficientRear', -0.12, 'reference') },
  // steering
  { key: 'steeringRatio', path: 'steeringRatio', field: num('steeringRatio', 16.4) },
  { key: 'turningCircleFt', path: 'turningCircleFt', field: num('turningCircleFt', 37.4, 'reference') },
  // limits
  { key: 'topSpeedMph', path: 'topSpeedMph', field: num('topSpeedMph', 196, 'reference') },
  { key: 'topSpeedGoverned', path: 'topSpeedGoverned', field: txt('topSpeedGoverned', 'false') },
  // instrumented tests
  { key: 'test0to30Sec', path: 'tests.zeroToThirtySec', field: read2(num('test0to30Sec', 1.2, 'test')) },
  { key: 'test0to60Sec', path: 'tests.zeroToSixtySec', field: read2(num('test0to60Sec', 3.3, 'test')) },
  { key: 'test0to100Sec', path: 'tests.zeroToHundredSec', field: read2(num('test0to100Sec', 7.4, 'test')) },
  { key: 'testRollout', path: 'tests.rollout', field: txt('testRollout', 'true', 'test') },
  { key: 'testQuarterMileSec', path: 'tests.quarterMileSec', field: read2(num('testQuarterMileSec', 11.4, 'test')) },
  { key: 'testQuarterMileMph', path: 'tests.quarterMileMph', field: read2(num('testQuarterMileMph', 125, 'test')) },
  { key: 'testBraking60to0Ft', path: 'tests.braking60to0Ft', field: read2(num('testBraking60to0Ft', 104, 'test')) },
  { key: 'testBraking70to0Ft', path: 'tests.braking70to0Ft', field: read2(num('testBraking70to0Ft', 141, 'test')) },
  { key: 'testSkidpadG', path: 'tests.skidpadG', field: read2(num('testSkidpadG', 1.02, 'test')) },
  { key: 'testSkidpadDiameterFt', path: 'tests.skidpadDiameterFt', field: num('testSkidpadDiameterFt', 300, 'test') },
  { key: 'testTopSpeedMph', path: 'tests.topSpeedMph', field: read2(num('testTopSpeedMph', 193, 'test')) },
  { key: 'testWeightLb', path: 'tests.testWeightLb', field: read2(num('testWeightLb', 3950, 'test')) },
  { key: 'testWeightDistFrontPct', path: 'tests.testWeightDistFrontPct', field: read2(num('testWeightDistFrontPct', 54.3, 'test')) },
];
// Keys the format has that are not model inputs: the card shows them, or they cross-check another figure.
const NOT_INPUTS: ResearchField[] = [
  txt('engineDescription', '3.8-liter DOHC 24-valve twin-turbocharged V6 (VR38DETT)'), num('gearCount', 6),
  txt('tyreModel', 'Dunlop SP Sport Maxx GT600 DSST', 'reference'), num('brakeFrontDiscIn', 16.14), num('brakeRearDiscIn', 15.35),
  num('epaCombinedMpg', 18, 'agency'), num('epaCityMpg', 16, 'agency'), num('epaHighwayMpg', 22, 'agency'),
];
const README_KEYS = [
  'wheelbaseIn', 'trackFrontIn', 'trackRearIn', 'lengthIn', 'widthIn', 'heightIn', 'curbWeightLb', 'weightDistFrontPct', 'groundClearanceIn', 'cgHeightIn',
  'engineDescription', 'powertrain', 'induction', 'engineLocation', 'displacementL', 'cylinders', 'horsepower', 'horsepowerRpm', 'torqueLbFt', 'torqueRpmLow', 'torqueRpmHigh', 'redlineRpm', 'boostPsi', 'compressionRatio',
  'drivetrain', 'awdSystem', 'transmissionType', 'gearCount', 'gearRatios', 'finalDriveRatio', 'differential',
  'tyreFront', 'tyreRear', 'tyreModel', 'tyreCategory',
  'dragCoefficient', 'frontalAreaSqFt', 'liftCoefficientFront', 'liftCoefficientRear',
  'steeringRatio', 'turningCircleFt', 'brakeFrontDiscIn', 'brakeRearDiscIn',
  'topSpeedMph', 'topSpeedGoverned', 'epaCombinedMpg', 'epaCityMpg', 'epaHighwayMpg',
  'test0to30Sec', 'test0to60Sec', 'test0to100Sec', 'testRollout', 'testQuarterMileSec', 'testQuarterMileMph', 'testBraking60to0Ft', 'testBraking70to0Ft', 'testSkidpadG', 'testSkidpadDiameterFt', 'testTopSpeedMph', 'testWeightLb', 'testWeightDistFrontPct',
];

function at(sheet: PhysicsSheet, path: string): { value: unknown; source: { kind: SourceKind; name?: string; url?: string; asOf?: string; note?: string } } | null {
  const [a, b] = path.split('.');
  const v = b === undefined ? (sheet as unknown as Record<string, unknown>)[a] : (sheet.tests as unknown as Record<string, unknown>)[b];
  return v as ReturnType<typeof at>;
}

describe('a research record with every key', () => {
  const full = record([...FULL.map((e) => e.field), ...NOT_INPUTS]);
  const reading = readResearch(full);
  const sheet = reading.sheet;

  it('covers every key of the research format, so none is left untested', () => {
    const keys = [...FULL.map((e) => e.key), ...NOT_INPUTS.map((f) => f.key)].sort();
    expect(keys).toEqual([...README_KEYS].sort());
  });

  it('keeps every figure in its published unit: 109.4 in, 3,867 lb, 600 hp at 6,800 rpm, 481 lb ft, 0.26 Cd', () => {
    // A sheet keeps the units its sources print; resolve.ts converts once. So each number comes through unchanged.
    for (const e of FULL) {
      if (e.field.number === undefined) continue;
      expect(at(sheet, e.path), e.key).not.toBeNull();
      expect(at(sheet, e.path)?.value, e.key).toBe(e.field.number);
    }
    expect(sheet.wheelbaseIn?.value).toBe(109.4);
    expect(sheet.curbWeightLb?.value).toBe(3867);
    expect(sheet.horsepower?.value).toBe(600);
    expect(sheet.horsepowerRpm?.value).toBe(6800);
    expect(sheet.torqueLbFt?.value).toBe(481);
    expect(sheet.dragCoefficient?.value).toBe(0.26);
    expect(sheet.tests.braking60to0Ft?.value).toBe(104);
  });

  it('reads the words and lists onto the right fields', () => {
    expect(sheet.powertrain?.value).toBe('gasoline');
    expect(sheet.induction?.value).toBe('twin-turbo');
    expect(sheet.engineLocation?.value).toBe('front');
    expect(sheet.drivetrain?.value).toBe('AWD');
    expect(sheet.awdKind?.value).toBe('rear-on-demand');     // 0:100 front:rear normally: the rear drives
    expect(sheet.transmissionType?.value).toBe('dual-clutch');
    expect(sheet.gearRatios?.value).toEqual([4.056, 2.301, 1.595, 1.248, 1.001, 0.796]);
    expect(sheet.diffFront?.value).toBe('limited-slip');
    expect(sheet.diffRear?.value).toBe('limited-slip');
    expect(sheet.tyreFront?.value).toBe('255/40ZRF20');
    expect(sheet.tyreRear?.value).toBe('285/35ZRF20');
    expect(sheet.tyreCategory?.value).toBe('max-performance');
    expect(sheet.topSpeedGoverned?.value).toBe(false);
    expect(sheet.tests.rollout?.value).toBe(true);
  });

  it('carries each figure\'s own source: kind, publisher, url, the day it was gathered and the note', () => {
    for (const e of FULL) {
      const v = at(sheet, e.path);
      expect(v, e.key).not.toBeNull();
      expect(v?.source, e.key).toEqual({ kind: e.field.sourceKind, name: `Publisher of ${e.key}`, url: `https://example.org/${e.key}`, asOf: GATHERED, note: `Note on ${e.key}` });
    }
    expect(sheet.tests.skidpadG?.source.kind).toBe('test');
    expect(sheet.cgHeightIn?.source.kind).toBe('agency');
  });

  it('leaves null only the fields no research key feeds, and names the keys that are not model inputs', () => {
    const nulls = (Object.keys(sheet) as (keyof PhysicsSheet)[]).filter((k) => sheet[k] === null).sort();
    expect(nulls).toEqual(['abs', 'brakeGrade', 'launchControl', 'roadLoadA', 'roadLoadB', 'roadLoadC', 'stabilityControl', 'suspensionGrade', 'torqueCurve', 'tractionControl']);
    expect((Object.keys(sheet.tests) as (keyof SheetTests)[]).filter((k) => sheet.tests[k] === null)).toEqual([]);
    expect(reading.dropped).toEqual([]);
    expect(reading.unused.slice().sort()).toEqual(NOT_INPUTS.map((f) => f.key).sort());
    expect(reading.used.length).toBe(FULL.length);
    expect(sheet.calibration).toEqual({ tyreGripScale: null, dragAreaM2: null });
    expect(sheet.identity).toEqual({ year: 2024, make: 'Test', model: 'Car', trim: 'Test trim', bodyClass: 'coupe' });
  });
});

/* ------------------------------------------------------------------ what is left out */

describe('figures that are left out, and named', () => {
  it('drops a refuted figure, a figure that is not a plain number and words that name nothing, keeping the rest', () => {
    const fields = [
      { ...num('wheelbaseIn', 107.1), check: 'refuted' },
      txt('curbWeightLb', 'about 3,800 lb'),         // a unit inside the figure: not read, never guessed
      txt('drivetrain', '2WD'),                       // which axle?
      txt('tyreFront', 'Pilot Sport 4S'),             // a tyre name is not a size
      num('horsepower', 460, 'manufacturer'),
      { ...num('torqueLbFt', 420), check: 'confirmed' },
    ];
    const sheet = read(fields);
    expect(sheet.wheelbaseIn).toBeNull();
    expect(sheet.curbWeightLb).toBeNull();
    expect(sheet.drivetrain).toBeNull();
    expect(sheet.tyreFront).toBeNull();
    expect(sheet.horsepower?.value).toBe(460);
    expect(sheet.torqueLbFt?.value).toBe(420);
    const problems = sheetProblems(record(fields));
    expect(problems.map((p) => p.key)).toEqual(['wheelbaseIn', 'drivetrain', 'curbWeightLb', 'tyreFront']);
    expect(problems[0].reason).toMatch(/refuted/);
    expect(problems.find((p) => p.key === 'curbWeightLb')?.value).toBe('about 3,800 lb');
  });

  it('reads a plain number written as text, but not one with a unit', () => {
    expect(read([txt('finalDriveRatio', '3.73:1')]).finalDriveRatio?.value).toBe(3.73);
    expect(read([txt('curbWeightLb', '3,867')]).curbWeightLb?.value).toBe(3867);
    expect(read([txt('wheelbaseIn', '2779 mm')]).wheelbaseIn).toBeNull();
  });

  it('leaves out a 9,000 lb sedan, a 40:1 final drive and a 700 rpm redline, and names each', () => {
    const fields = [num('curbWeightLb', 9000), num('finalDriveRatio', 40), num('redlineRpm', 700), num('horsepower', 300)];
    const sheet = read(fields, { bodyClass: 'sedan' });
    expect(sheet.curbWeightLb).toBeNull();
    expect(sheet.finalDriveRatio).toBeNull();
    expect(sheet.redlineRpm).toBeNull();
    expect(sheet.horsepower?.value).toBe(300);
    const problems = sheetProblems(record(fields, { bodyClass: 'sedan' }));
    expect(problems.map((p) => p.key).sort()).toEqual(['curbWeightLb', 'finalDriveRatio', 'redlineRpm']);
    expect(problems.find((p) => p.key === 'curbWeightLb')?.reason).toMatch(/sedan/);
    expect(problems.every((p) => /outside/.test(p.reason))).toBe(true);
  });

  it('judges a figure against the car it belongs to: a 9,000 lb electric pickup and an 18,000 rpm motor are real', () => {
    // A GMC Hummer EV pickup weighs about 9,000 lb; an electric motor spins to 18,000 rpm; neither fits a petrol sedan.
    expect(read([num('curbWeightLb', 9000)], { bodyClass: 'pickup' }).curbWeightLb?.value).toBe(9000);
    expect(read([txt('powertrain', 'battery electric'), num('redlineRpm', 18000)]).redlineRpm?.value).toBe(18000);
    expect(read([txt('powertrain', 'gasoline'), num('redlineRpm', 18000)]).redlineRpm).toBeNull();
    expect(read([num('finalDriveRatio', 9.04)]).finalDriveRatio?.value).toBe(9.04);   // a single-speed electric reduction
    expect(read([num('wheelbaseIn', 2779)]).wheelbaseIn).toBeNull();                 // millimetres in an inch field
  });

  it('drops the engine speeds that contradict the published peaks: 600 hp at 3,000 rpm needs 1,050 lb ft', () => {
    // P = T omega: at its power peak an engine makes P / omega of torque, never more than its peak torque.
    const fields = [num('horsepower', 600), num('torqueLbFt', 481), num('horsepowerRpm', 3000), num('torqueRpmLow', 3600)];
    const sheet = read(fields);
    expect(sheet.horsepowerRpm).toBeNull();
    expect(sheet.horsepower?.value).toBe(600);
    expect(sheet.torqueLbFt?.value).toBe(481);
    expect(sheet.torqueRpmLow?.value).toBe(3600);
    expect(sheetProblems(record(fields))[0].reason).toMatch(/1050 lb ft/);
    // And torque at a speed where it would be more than the peak power: 481 lb ft at 7,000 rpm is 641 hp.
    expect(read([num('horsepower', 600), num('torqueLbFt', 481), num('torqueRpmHigh', 7000)]).torqueRpmHigh).toBeNull();
  });

  it('drops figures that cannot all be one car: 1.9 L cylinders, a wheelbase as long as the car, ratios that miss a gear', () => {
    const engine = read([num('displacementL', 3.8), num('cylinders', 2)]);
    expect(engine.displacementL).toBeNull();
    expect(engine.cylinders).toBeNull();
    const body = read([num('wheelbaseIn', 184.6), num('lengthIn', 109.4)]);
    expect(body.wheelbaseIn).toBeNull();
    expect(body.lengthIn).toBeNull();
    const ratios = (numbers: number[]): ResearchField => ({ ...num('gearRatios', 0), number: undefined, numbers });
    expect(read([num('gearCount', 6), ratios([4.056, 2.301, 1.595, 1.248, 1.001])]).gearRatios).toBeNull();
    expect(read([ratios([0.796, 1.001, 1.248, 1.595, 2.301, 4.056])]).gearRatios).toBeNull();   // top gear first
    // A CVT's two ends are not a gear count.
    expect(read([txt('transmissionType', 'CVT'), num('gearCount', 7), ratios([2.631, 0.378])]).gearRatios?.value).toEqual([2.631, 0.378]);
  });

  it('drops a key on file twice with two figures, and keeps one on file twice with the same figure', () => {
    const twice = [num('curbWeightLb', 3832), num('curbWeightLb', 3900)];
    expect(read(twice).curbWeightLb).toBeNull();
    expect(droppedKeys(twice)).toEqual(['curbWeightLb', 'curbWeightLb']);
    const same = readResearch(record([num('curbWeightLb', 3832), num('curbWeightLb', 3832, 'reference')]));
    expect(same.sheet.curbWeightLb?.value).toBe(3832);
    expect(same.sheet.curbWeightLb?.source.kind).toBe('manufacturer');   // the first source
    expect(same.dropped).toEqual([]);
  });

  it('drops a key the format does not have, and refuses a record whose body class the class tables do not know', () => {
    expect(droppedKeys([num('zeroToSixty', 4.1)])).toEqual(['zeroToSixty']);
    expect(() => sheetFromResearch(record([], { bodyClass: 'spaceship' }))).toThrow(/body class/);
    expect(read([], { bodyClass: 'pickup truck' }).identity.bodyClass).toBe('pickup');
  });

  it('reads an off-road SUV as the off-road class, whose blank sheet is a 4WD six', () => {
    for (const words of ['off-road-suv', 'Off-road SUV', 'off-road sport utility vehicle']) expect(read([], { bodyClass: words }).identity.bodyClass, words).toBe('offroad');
  });

  it('takes an unknown source kind as the weakest claim, reference', () => {
    const r = readResearch(record([num('horsepower', 300, 'magazine')]));
    expect(r.sheet.horsepower?.source.kind).toBe('reference');
    expect(r.notes.map((n) => n.key)).toEqual(['horsepower']);
  });
});

/* ------------------------------------------------------------------ like with like: what a test figure is a check of */

/** A test figure as a tester printed it, with the note and the second reader's checkNote the research format carries. */
function test(key: string, number: number, publisher: string, url: string, note = 'Read from a search summary.', checkNote = ''): ResearchField {
  return { key, number, publisher, url, sourceKind: 'test', note, checkNote, check: 'confirmed' } as ResearchField;
}
const OWN = 'https://example.org/own-test', OTHER = 'https://example.org/other-test';

describe('test figures that are not a check of this configuration, set apart', () => {
  it('sets apart a figure whose note says the test car was another configuration, trim or model year with other hardware, and every figure of that same test', () => {
    for (const note of [
      'CONFIGURATION MISMATCH (options): the test car had the Performance Package.',
      'TRIM MISMATCH: the Limited rides on 19-inch tyres and weighs more.',
      'OTHER TRIM, TEST YEAR NOT STATED: a Limited, not a Premium.',
      'NOT a 2024 car: same engine, but before the 2024 front limited-slip differential and aero changes.',
    ]) {
      const r = readResearch(record([
        test('test0to60Sec', 4.8, 'Edmunds', OWN, note),
        test('testQuarterMileSec', 12.7, 'Edmunds', OWN, 'Same run.'),
        test('testBraking60to0Ft', 107, 'Car and Driver', OTHER),
      ]));
      expect(r.sheet.tests.zeroToSixtySec, note).toBeNull();
      expect(r.sheet.tests.quarterMileSec, note).toBeNull();                 // the same test car
      expect(r.sheet.tests.braking60to0Ft?.value, note).toBe(107);          // another test, of this configuration
      const apart = r.dropped.filter(isSetApart);
      expect(apart.map((p) => p.key), note).toEqual(['test0to60Sec', 'testQuarterMileSec']);
      expect(apart[1].reason, note).toMatch(/test0to60Sec/);
    }
  });

  it('sets apart a second-hand figure the second reader found fails the same-configuration rule, and only that figure', () => {
    const r = readResearch(record([
      test('test0to60Sec', 7.9, 'Car and Driver', OWN, 'Same powertrain.', 'A same-generation car with the same powertrain.'),
      test('testSkidpadG', 0.88, 'Car and Driver', OWN, 'An SE figure.', 'As a check on the LE\'s grip it does not meet the README\'s same-configuration rule.'),
    ]));
    expect(r.sheet.tests.zeroToSixtySec?.value).toBe(7.9);
    expect(r.sheet.tests.skidpadG).toBeNull();
    expect(r.dropped.filter(isSetApart).map((p) => p.key)).toEqual(['testSkidpadG']);
  });

  it('sets apart a test figure nobody second-read (no check mark), and keeps a confirmed or an unconfirmed one', () => {
    // The F-150 Raptor's nine test figures came in after the second reads and carry no check mark: they were checks
    // all the same, and one calibrated its grip. A figure nobody tried to refute is not evidence (the parts exam's rule).
    const unread = { ...test('test0to60Sec', 5.2, 'Car and Driver', OWN), check: undefined } as ResearchField;
    const r = readResearch(record([
      unread,
      { ...test('testQuarterMileSec', 13.9, 'Car and Driver', OWN), check: 'unconfirmed' } as ResearchField,
      test('testSkidpadG', 0.69, 'Car and Driver', OWN),
    ]));
    expect(r.sheet.tests.zeroToSixtySec).toBeNull();
    expect(r.sheet.tests.quarterMileSec?.value).toBe(13.9);
    expect(r.sheet.tests.skidpadG?.value).toBe(0.69);
    const apart = r.dropped.filter(isSetApart);
    expect(apart.map((p) => p.key)).toEqual(['test0to60Sec']);
    expect(apart[0].reason).toMatch(/second-read/);
  });

  it('reads the real F-150 Raptor record: none of its test figures is a check (none was second-read)', () => {
    const raptor = sheetById('2024-ford-f-150-raptor')!;
    for (const [k, v] of Object.entries(raptor.tests)) {
      if (k === 'rollout' || k === 'skidpadDiameterFt') continue;
      expect(v, k).toBeNull();
    }
    const tacoma = sheetById('2024-toyota-tacoma-trd-off-road')!;
    expect(tacoma.tests.skidpadG).toBeNull();
    expect(tacoma.tests.braking70to0Ft).toBeNull();
    expect(tacoma.tests.zeroToSixtySec?.value).toBe(7.0);
  });

  it('keeps a figure whose note only mentions another test, session or model year beside it', () => {
    const r = readResearch(record([
      test('testSkidpadG', 0.99, 'Edmunds', OWN, 'This run. Earlier research\'s 0.96 g belonged to a 2022 car (different model year).'),
      test('testBraking70to0Ft', 171, 'Car and Driver', OTHER, 'This is a different test session of the same configuration.'),
    ]));
    expect(r.sheet.tests.skidpadG?.value).toBe(0.99);
    expect(r.sheet.tests.braking70to0Ft?.value).toBe(171);
    expect(r.dropped.filter(isSetApart)).toEqual([]);
  });
});

describe('a tester\'s known practice, when the record does not say', () => {
  it('times a Car and Driver or MotorTrend 0-60 from the one-foot rollout, and an Edmunds, MotorWeek or Consumer Reports one from rest', () => {
    const cases: [string, boolean][] = [
      ['Car and Driver', true], ['Car and Driver (syndicated on Yahoo Autos)', true], ['MotorTrend', true], ['Motor Trend', true],
      ['Edmunds', false], ['MotorWeek', false], ['Consumer Reports', false],
    ];
    for (const [publisher, rollout] of cases) {
      const r = readResearch(record([test('test0to60Sec', 6.1, publisher, OWN)]));
      expect(r.sheet.tests.rollout?.value, publisher).toBe(rollout);
      expect(r.sheet.tests.rollout?.source.note, publisher).toMatch(/practice/);
      expect(r.notes.map((n) => n.key), publisher).toContain('testRollout');
    }
  });

  it('puts a Car and Driver skidpad on its 300 ft circle and a MotorTrend or Edmunds one on 200 ft', () => {
    for (const [publisher, ft] of [['Car and Driver', 300], ['MotorTrend', 200], ['Edmunds', 200]] as const) {
      const r = readResearch(record([test('testSkidpadG', 0.95, publisher, OWN)]));
      expect(r.sheet.tests.skidpadDiameterFt?.value, publisher).toBe(ft);
    }
    // A tester whose circle is not known leaves it to the check's default.
    expect(read([test('testSkidpadG', 0.95, 'Some Magazine', OWN)]).tests.skidpadDiameterFt).toBeNull();
  });

  it('claims no practice for a tester it does not know: its 0-60 rollout is left unknown, with no note saying otherwise', () => {
    // An unknown tester was given "times from rest every 0-60 it publishes", a sourced-looking claim with nothing
    // behind it (Road & Track, for one, keeps the rollout in).
    for (const publisher of ['Some Magazine', 'Road & Track']) {
      const r = readResearch(record([test('test0to60Sec', 4.1, publisher, OWN)]));
      expect(r.sheet.tests.rollout, publisher).toBeNull();
      expect(r.notes.map((n) => n.key), publisher).not.toContain('testRollout');
    }
  });

  it('never overrides what the record says, and adds nothing where there is no 0-60 or skidpad figure', () => {
    const own = read([test('test0to60Sec', 4.2, 'Car and Driver', OWN), { ...txt('testRollout', 'false'), sourceKind: 'test' }, test('testSkidpadG', 0.9, 'Edmunds', OWN), test('testSkidpadDiameterFt', 300, 'Edmunds', OWN)]);
    expect(own.tests.rollout?.value).toBe(false);
    expect(own.tests.skidpadDiameterFt?.value).toBe(300);
    const none = read([test('testQuarterMileSec', 12.7, 'Car and Driver', OWN)]);
    expect(none.tests.rollout).toBeNull();
    expect(none.tests.skidpadDiameterFt).toBeNull();
  });
});

/* ------------------------------------------------------------------ words to the sheet's enums */

type Case = { key: string; text: string; field: keyof PhysicsSheet; want: unknown; drive?: string };
const WORDS: Case[] = [
  { key: 'induction', text: 'twin-turbocharged', field: 'induction', want: 'twin-turbo' },
  { key: 'induction', text: 'Bi-Turbo', field: 'induction', want: 'twin-turbo' },
  { key: 'induction', text: 'twin-scroll turbocharged', field: 'induction', want: 'turbo' },    // one turbo, divided housing
  { key: 'induction', text: 'TwinPower Turbo', field: 'induction', want: 'turbo' },
  { key: 'induction', text: 'naturally aspirated', field: 'induction', want: 'natural' },
  { key: 'induction', text: 'Supercharged (Roots-type)', field: 'induction', want: 'supercharged' },
  { key: 'induction', text: 'turbocharged and supercharged', field: 'induction', want: 'twincharged' },
  { key: 'induction', text: 'N/A', field: 'induction', want: null },                       // naturally aspirated, or not applicable?
  { key: 'transmissionType', text: '8-speed dual-clutch', field: 'transmissionType', want: 'dual-clutch' },
  { key: 'transmissionType', text: '7-speed PDK', field: 'transmissionType', want: 'dual-clutch' },
  { key: 'transmissionType', text: '6-speed manual with automatic rev-matching', field: 'transmissionType', want: 'manual' },
  { key: 'transmissionType', text: '10-speed automatic with manual shift mode', field: 'transmissionType', want: 'automatic' },
  { key: 'transmissionType', text: 'Automatic (AM-S6)', field: 'transmissionType', want: null },   // the EPA's automated-manual code
  { key: 'transmissionType', text: 'eCVT', field: 'transmissionType', want: 'ecvt' },
  { key: 'transmissionType', text: 'Lineartronic CVT', field: 'transmissionType', want: 'cvt' },
  { key: 'transmissionType', text: 'single-speed reduction', field: 'transmissionType', want: 'single-speed' },
  { key: 'drivetrain', text: '4WD', field: 'drivetrain', want: '4WD' },
  { key: 'drivetrain', text: 'part-time four-wheel drive', field: 'drivetrain', want: '4WD' },
  { key: 'drivetrain', text: 'All-Wheel Drive', field: 'drivetrain', want: 'AWD' },
  { key: 'drivetrain', text: 'rear-wheel drive', field: 'drivetrain', want: 'RWD' },
  { key: 'drivetrain', text: 'FWD', field: 'drivetrain', want: 'FWD' },
  { key: 'drivetrain', text: '2WD', field: 'drivetrain', want: null },
  { key: 'powertrain', text: 'gasoline', field: 'powertrain', want: 'gasoline' },
  { key: 'powertrain', text: 'Hybrid (gasoline-electric)', field: 'powertrain', want: 'hybrid' },
  { key: 'powertrain', text: 'plug-in hybrid', field: 'powertrain', want: 'plug-in-hybrid' },
  { key: 'powertrain', text: 'battery electric', field: 'powertrain', want: 'electric' },
  { key: 'powertrain', text: '48V mild hybrid', field: 'powertrain', want: null },
  { key: 'engineLocation', text: 'front mid-engine', field: 'engineLocation', want: 'front' },
  { key: 'engineLocation', text: 'front-engine with rear transaxle', field: 'engineLocation', want: 'front' },
  { key: 'engineLocation', text: 'mid-engine', field: 'engineLocation', want: 'mid' },
  { key: 'engineLocation', text: 'rear-engine, rear-wheel drive', field: 'engineLocation', want: 'rear' },
  { key: 'tyreCategory', text: 'max-performance', field: 'tyreCategory', want: 'max-performance' },
  { key: 'tyreCategory', text: 'Max Performance Summer', field: 'tyreCategory', want: 'max-performance' },
  { key: 'tyreCategory', text: 'Ultra High Performance All-Season', field: 'tyreCategory', want: 'all-season' },
  { key: 'tyreCategory', text: 'Streetable Track & Competition', field: 'tyreCategory', want: 'track' },
  { key: 'tyreCategory', text: 'all-terrain', field: 'tyreCategory', want: 'all-terrain' },
  { key: 'tyreCategory', text: 'Michelin Pilot Sport 4S', field: 'tyreCategory', want: null },   // a name, not a category
  { key: 'awdSystem', text: 'ATTESA E-TS, rear-biased, torque split 0:100 in normal driving, up to 50:50 front:rear', field: 'awdKind', want: 'rear-on-demand', drive: 'AWD' },
  { key: 'awdSystem', text: 'Haldex on-demand coupling, front-wheel-drive based', field: 'awdKind', want: 'front-on-demand', drive: 'AWD' },
  { key: 'awdSystem', text: 'Torsen centre differential, 40:60 front:rear', field: 'awdKind', want: 'fixed', drive: 'AWD' },
  { key: 'awdSystem', text: 'part-time 4WD with 2-speed transfer case', field: 'awdKind', want: 'part-time', drive: '4WD' },
  { key: 'awdSystem', text: 'Intelligent All-Wheel Drive', field: 'awdKind', want: null, drive: 'AWD' },
  { key: 'awdSystem', text: 'on-demand all-wheel drive', field: 'awdKind', want: null, drive: 'AWD' },   // on demand of which axle?
  { key: 'differential', text: 'limited-slip differential', field: 'diffRear', want: 'limited-slip', drive: 'RWD' },
  { key: 'differential', text: 'limited-slip differential', field: 'diffFront', want: null, drive: 'RWD' },
  { key: 'differential', text: 'limited-slip differential', field: 'diffRear', want: null, drive: 'AWD' },   // which axle?
  { key: 'differential', text: 'electronic limited-slip rear differential', field: 'diffRear', want: 'active', drive: 'RWD' },
  { key: 'differential', text: 'electronically controlled locking rear differential', field: 'diffRear', want: 'open', drive: '4WD' },
  { key: 'differential', text: 'XDS electronic differential lock', field: 'diffFront', want: 'open', drive: 'FWD' },
  { key: 'differential', text: 'open front, Torsen limited-slip rear', field: 'diffFront', want: 'open', drive: 'AWD' },
  { key: 'differential', text: 'open front, Torsen limited-slip rear', field: 'diffRear', want: 'limited-slip', drive: 'AWD' },
  { key: 'differential', text: 'available limited-slip differential', field: 'diffRear', want: null, drive: 'RWD' },
];

describe('words to the sheet\'s kinds, read with care', () => {
  for (const c of WORDS) {
    it(`${c.key} "${c.text}"${c.drive ? ` on a ${c.drive} car` : ''} gives ${String(c.want)}`, () => {
      const fields = [txt(c.key, c.text)];
      if (c.drive !== undefined) fields.push(txt('drivetrain', c.drive));
      const v = read(fields)[c.field] as { value: unknown } | null;
      if (c.want === null) expect(v).toBeNull();
      else expect(v?.value).toBe(c.want);
    });
  }

  it('reads all-wheel-drive words only on a car that has all-wheel drive', () => {
    const fields = [txt('drivetrain', 'FWD'), txt('awdSystem', 'Haldex on-demand coupling, front-wheel-drive based')];
    expect(read(fields).awdKind).toBeNull();
    expect(droppedKeys(fields)).toEqual(['awdSystem']);
  });

  it('reads the real GT-R NISMO record: no figure dropped, its tests of 2017 and 2020 cars set apart, rear-driven on demand, a limited-slip differential at each end', () => {
    const files = import.meta.glob('../data/research/2024-nissan-gt-r-nismo.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const text = files['../data/research/2024-nissan-gt-r-nismo.json'];
    expect(typeof text).toBe('string');
    const r = readResearch(JSON.parse(text) as ResearchRecord);
    // Every figure is read; only its tests are set apart: MotorWeek's 2020 NISMO (no 2024 front limited-slip
    // differential or aero; the note says "NOT a 2024 car") and a forum's quote of MotorTrend's 2017 car.
    expect(r.dropped.filter((p) => !isSetApart(p))).toEqual([]);
    expect(r.dropped.filter(isSetApart).map((p) => p.key).sort()).toEqual(['test0to60Sec', 'testBraking60to0Ft', 'testQuarterMileMph', 'testQuarterMileSec', 'testSkidpadG']);
    expect(r.sheet.curbWeightLb?.value).toBe(3867);
    expect(r.sheet.weightDistFrontPct?.value).toBe(54);
    expect(r.sheet.awdKind?.value).toBe('rear-on-demand');
    expect(r.sheet.diffFront?.value).toBe('limited-slip');
    expect(r.sheet.diffRear?.value).toBe('limited-slip');
    expect(r.sheet.gearRatios?.value).toEqual([4.056, 2.301, 1.595, 1.248, 1.001, 0.796]);
    expect(r.sheet.tests.skidpadG).toBeNull();
    expect(r.sheet.horsepower?.source).toMatchObject({ kind: 'manufacturer', asOf: '2026-11-14' });
  });
});

/* ------------------------------------------------------------------ the game's car table */

describe('a row of the game\'s car table', () => {
  const m4: TableRow = { make: 'BMW', model: 'M4', bodyClass: 'coupe', engine: '3.0L Twin-Turbo I6', hp: 473, weightLb: 3800, zeroToSixty: 3.8, topSpeedMph: 155, drive: 'RWD' };

  it('reads "3.0L Twin-Turbo I6", 473 hp as a twin-turbo 3.0 L six', () => {
    const s = sheetFromTable(m4);
    expect(s.induction?.value).toBe('twin-turbo');
    expect(s.displacementL?.value).toBe(3.0);
    expect(s.cylinders?.value).toBe(6);
    expect(s.horsepower?.value).toBe(473);
    expect(s.curbWeightLb?.value).toBe(3800);
    expect(s.drivetrain?.value).toBe('RWD');
    expect(s.powertrain?.value).toBe('gasoline');
    expect(tableProblems(m4)).toEqual([]);
  });

  it('puts the 0-60 in tests only and the top speed as a governed one', () => {
    const s = sheetFromTable(m4);
    expect(s.tests.zeroToSixtySec?.value).toBe(3.8);
    expect(s.topSpeedMph?.value).toBe(155);
    expect(s.topSpeedGoverned?.value).toBe(true);
    const testsFilled = (Object.keys(s.tests) as (keyof SheetTests)[]).filter((k) => s.tests[k] !== null);
    expect(testsFilled).toEqual(['zeroToSixtySec']);
  });

  it('fills nothing the row does not say, and marks every figure as the unverified table', () => {
    const s = sheetFromTable(m4);
    const filled = (Object.keys(s) as (keyof PhysicsSheet)[]).filter((k) => k !== 'id' && k !== 'identity' && k !== 'tests' && k !== 'calibration' && s[k] !== null).sort();
    expect(filled).toEqual(['curbWeightLb', 'cylinders', 'displacementL', 'drivetrain', 'horsepower', 'induction', 'powertrain', 'topSpeedGoverned', 'topSpeedMph']);
    for (const k of filled) expect((s[k] as { source: unknown }).source, k).toEqual({ kind: 'reference', name: 'MiCar World car table', note: TABLE_NOTE });
    expect(s.tests.zeroToSixtySec?.source.note).toBe(TABLE_NOTE);
    expect(TABLE_NOTE).toBe('MiCar World car table: one common US trim stands for the model. Not verified.');
    expect(s.identity).toMatchObject({ make: 'BMW', model: 'M4', bodyClass: 'coupe' });
    expect(s.id).toBe('table-bmw-m4');
  });

  it('reads EcoBoost as turbocharged, Hybrid as a hybrid powertrain, and no boost word as natural', () => {
    const row = (engine: string, hp: number, weightLb: number, bodyClass: BodyClass): TableRow => ({ make: 'X', model: 'Y', bodyClass, engine, hp, weightLb, zeroToSixty: 7, topSpeedMph: 112, drive: 'FWD' });
    const f150 = sheetFromTable(row('2.7L EcoBoost V6', 325, 4700, 'pickup'));
    expect([f150.induction?.value, f150.displacementL?.value, f150.cylinders?.value]).toEqual(['turbo', 2.7, 6]);
    const prius = sheetFromTable(row('1.8L I4 Hybrid', 121, 3050, 'hatchback'));
    expect([prius.powertrain?.value, prius.induction?.value, prius.displacementL?.value, prius.cylinders?.value]).toEqual(['hybrid', 'natural', 1.8, 4]);
    const camry = sheetFromTable(row('2.5L I4', 203, 3340, 'sedan'));
    expect([camry.powertrain?.value, camry.induction?.value, camry.cylinders?.value]).toEqual(['gasoline', 'natural', 4]);
    const escape = sheetFromTable(row('1.5L EcoBoost I3', 181, 3300, 'suv'));
    expect([escape.induction?.value, escape.cylinders?.value]).toEqual(['turbo', 3]);
  });

  it('leaves out and names a figure outside any sane range', () => {
    const bad: TableRow = { ...m4, weightLb: 38000 };
    expect(sheetFromTable(bad).curbWeightLb).toBeNull();
    expect(tableProblems(bad).map((p) => p.key)).toEqual(['curbWeightLb']);
  });
});

/* ------------------------------------------------------------------ a drawn rental car */

// The five Strip rentals as the game draws them (apps/sim/src/world/data.ts).
const RENTALS: { spec: AuthoredSpec; body: BodyClass }[] = [
  { body: 'hatchback', spec: { id: 'civet', name: 'Civet R', drive: 'FWD', mass: 1180, a: 1.08, b: 1.42, h: 0.5, cd: 0.32, area: 2.0, redline: 7200, r: 0.31, fin: 4.3, gears: [3.4, 2.05, 1.42, 1.08, 0.86, 0.72], tq: [[1000, 135], [2500, 168], [4000, 186], [5500, 184], [6500, 172], [7300, 150]] } },
  { body: 'hatchback', spec: { id: 'kanjo', name: 'Kanjo S', drive: 'FWD', mass: 1020, a: 1.05, b: 1.4, h: 0.49, cd: 0.31, area: 1.9, redline: 8100, r: 0.3, fin: 4.4, gears: [3.5, 2.2, 1.55, 1.2, 0.98, 0.82], tq: [[1000, 110], [3000, 150], [5000, 170], [6500, 168], [7500, 160], [8200, 140]] } },
  { body: 'coupe', spec: { id: 'ronin', name: 'Ronin GT', drive: 'RWD', mass: 1340, a: 1.28, b: 1.32, h: 0.48, cd: 0.33, area: 2.05, redline: 7300, r: 0.32, fin: 4.0, gears: [3.55, 2.12, 1.5, 1.13, 0.9, 0.76], tq: [[1000, 175], [2500, 222], [4000, 252], [5500, 258], [6500, 242], [7400, 210]] } },
  { body: 'sedan', spec: { id: 'tsubasa', name: 'Tsubasa R4', drive: 'AWD', mass: 1540, a: 1.3, b: 1.33, h: 0.5, cd: 0.34, area: 2.1, redline: 7000, r: 0.32, fin: 3.9, gears: [3.6, 2.2, 1.55, 1.18, 0.95, 0.8], tq: [[1000, 210], [2500, 270], [4000, 305], [5500, 310], [6500, 290], [7100, 250]] } },
  { body: 'coupe', spec: { id: 'brute', name: 'Brute 440', drive: 'RWD', mass: 1720, a: 1.35, b: 1.4, h: 0.52, cd: 0.38, area: 2.3, redline: 6200, r: 0.34, fin: 3.7, gears: [3.0, 1.9, 1.4, 1.0, 0.8, 0.66], tq: [[1000, 330], [2000, 400], [3500, 440], [4500, 430], [5500, 390], [6300, 330]] } },
];

describe('a drawn rental car, one to one', () => {
  it('gives back a, b and r within 0.5% through the resolver\'s own rules', () => {
    expect(RENTALS.length).toBe(5);
    for (const { spec, body } of RENTALS) {
      const s = sheetFromAuthored(spec, body);
      const wheelbase = (s.wheelbaseIn?.value ?? NaN) * IN;
      const frontShare = (s.weightDistFrontPct?.value ?? NaN) / 100;
      const a = wheelbase * (1 - frontShare), b = wheelbase - a;          // DESIGN.md section 7: a = wheelbase (1 - frontShare)
      const size = parseTyreSize(s.tyreFront?.value ?? '');
      expect(size, spec.id).not.toBeNull();
      const r = LOADED_RADIUS_SHARE * (size?.radius ?? NaN);               // the loaded radius is 0.97 of the unloaded one
      expect(Math.abs(a / spec.a - 1), `${spec.id} a`).toBeLessThan(0.005);
      expect(Math.abs(b / spec.b - 1), `${spec.id} b`).toBeLessThan(0.005);
      expect(Math.abs(r / spec.r - 1), `${spec.id} r`).toBeLessThan(0.005);
      expect(s.tyreRear?.value).toBe(s.tyreFront?.value);
    }
  });

  it('Ronin GT: 2.60 m wheelbase (102.4 in), 50.8% on the front, on 225/45R18s', () => {
    const s = sheetFromAuthored(RENTALS[2].spec, 'coupe');
    expect(s.wheelbaseIn?.value).toBeCloseTo(102.362, 3);
    expect(s.weightDistFrontPct?.value).toBeCloseTo(50.77, 2);
    expect(s.tyreFront?.value).toBe('225/45R18');
    expect(s.cgHeightIn?.value).toBeCloseTo(18.90, 2);                   // 0.48 m
  });

  it('subtracts the 75 kg driver, so the driven mass is the drawn mass', () => {
    for (const { spec, body } of RENTALS) {
      const s = sheetFromAuthored(spec, body);
      expect((s.curbWeightLb?.value ?? NaN) * LB + DRIVER_KG, spec.id).toBeCloseTo(spec.mass, 9);
    }
    expect(sheetFromAuthored(RENTALS[2].spec, 'coupe').curbWeightLb?.value).toBeCloseTo(2788.8, 1);   // 1,265 kg
  });

  it('keeps the air, engine and gearing as drawn: Cd A, redline, torque curve in N m, ratios, drive', () => {
    for (const { spec, body } of RENTALS) {
      const s = sheetFromAuthored(spec, body);
      expect((s.dragCoefficient?.value ?? NaN) * (s.frontalAreaSqFt?.value ?? NaN) * SQFT, spec.id).toBeCloseTo(spec.cd * spec.area, 12);
      expect(s.cgHeightIn?.value ?? NaN).toBeCloseTo(spec.h / IN, 12);
      expect(s.redlineRpm?.value).toBe(spec.redline);
      expect(s.torqueCurve?.value).toEqual(spec.tq);
      expect(s.torqueCurve?.value).not.toBe(spec.tq);                        // a copy: the sheet does not share the game's arrays
      expect(s.gearRatios?.value).toEqual(spec.gears);
      expect(s.finalDriveRatio?.value).toBe(spec.fin);
      expect(s.drivetrain?.value).toBe(spec.drive);
      expect(s.horsepower).toBeNull();                                      // the curve stands for the engine
      expect(s.identity.bodyClass).toBe(body);
      for (const k of Object.keys(s) as (keyof PhysicsSheet)[]) {
        const v = s[k] as { source?: { kind: string } } | null;
        if (v !== null && typeof v === 'object' && v.source !== undefined) expect(v.source.kind, `${spec.id} ${k}`).toBe('illustrative');
      }
    }
  });

  it('synthesises a tyre a road car could wear: wider for a heavier car, 30 to 70 series', () => {
    const widths: number[] = [];
    for (const { spec } of RENTALS) {
      const size = parseTyreSize(tyreSizeFor(spec.r, spec.mass));
      expect(size).not.toBeNull();
      expect(size?.aspect ?? 0).toBeGreaterThanOrEqual(0.3);
      expect(size?.aspect ?? 1).toBeLessThanOrEqual(0.7);
      widths.push(size?.width ?? 0);
    }
    const byMass = RENTALS.map((x, i) => ({ m: x.spec.mass, w: widths[i] })).sort((p, q) => p.m - q.m);
    for (let i = 1; i < byMass.length; i++) expect(byMass[i].w).toBeGreaterThanOrEqual(byMass[i - 1].w);
    expect(byMass[0].w).toBe(0.195);   // the 1,020 kg Kanjo
    expect(byMass[4].w).toBe(0.245);   // the 1,720 kg Brute
  });
});

/* ------------------------------------------------------------------ the generated sheets (scripts/build-sheets.ts) */

describe('the researched sheets on file', () => {
  it('are sorted by id, one per id, and found by id', () => {
    expect(SHEETS.length).toBeGreaterThan(0);
    for (let i = 1; i < SHEETS.length; i++) expect(SHEETS[i - 1].id < SHEETS[i].id).toBe(true);
    for (const s of SHEETS) expect(sheetById(s.id)).toBe(s);
    expect(sheetById('no-such-car')).toBeNull();
  });

  it('hold the GT-R NISMO as its record reads: 3,867 lb, 600 hp, 255/40 front and 285/35 rear', () => {
    const gtr = sheetById('2024-nissan-gt-r-nismo');
    expect(gtr?.curbWeightLb?.value).toBe(3867);
    expect(gtr?.horsepower?.value).toBe(600);
    expect(gtr?.tyreFront?.value).toBe('255/40ZRF20');
    expect(gtr?.tyreRear?.value).toBe('285/35ZRF20');
    expect(gtr?.identity.bodyClass).toBe('coupe');
  });
});

/* ------------------------------------------------------------------ the empty sheet */

const SHEET_KEYS = [
  'id', 'identity',
  'curbWeightLb', 'weightDistFrontPct',
  'wheelbaseIn', 'trackFrontIn', 'trackRearIn', 'lengthIn', 'widthIn', 'heightIn', 'groundClearanceIn', 'cgHeightIn',
  'powertrain', 'induction', 'engineLocation', 'displacementL', 'cylinders',
  'horsepower', 'horsepowerRpm', 'torqueLbFt', 'torqueRpmLow', 'torqueRpmHigh', 'redlineRpm', 'boostPsi', 'compressionRatio', 'torqueCurve',
  'drivetrain', 'awdKind', 'transmissionType', 'gearRatios', 'finalDriveRatio', 'diffFront', 'diffRear',
  'tyreFront', 'tyreRear', 'tyreCategory',
  'dragCoefficient', 'frontalAreaSqFt', 'liftCoefficientFront', 'liftCoefficientRear', 'roadLoadA', 'roadLoadB', 'roadLoadC',
  'steeringRatio', 'turningCircleFt', 'suspensionGrade', 'brakeGrade',
  'topSpeedMph', 'topSpeedGoverned', 'abs', 'tractionControl', 'stabilityControl', 'launchControl',
  'tests', 'calibration',
] as const;
const TEST_KEYS = [
  'zeroToThirtySec', 'zeroToSixtySec', 'zeroToHundredSec', 'rollout', 'quarterMileSec', 'quarterMileMph',
  'braking60to0Ft', 'braking70to0Ft', 'skidpadG', 'skidpadDiameterFt', 'topSpeedMph', 'testWeightLb', 'testWeightDistFrontPct',
] as const;
// These two lines stop compiling (scripts/check.sh) the moment the types gain a field these lists do not name, or lose one they do.
const sheetKeysExact: [(typeof SHEET_KEYS)[number]] extends [keyof PhysicsSheet] ? ([keyof PhysicsSheet] extends [(typeof SHEET_KEYS)[number]] ? true : false) : false = true;
const testKeysExact: [(typeof TEST_KEYS)[number]] extends [keyof SheetTests] ? ([keyof SheetTests] extends [(typeof TEST_KEYS)[number]] ? true : false) : false = true;

describe('the empty sheet', () => {
  const identity = { year: 2024, make: 'Test', model: 'Car', trim: '', bodyClass: 'sedan' as const };
  const s = emptySheet('x', identity);

  it('has every key of the PhysicsSheet type and of its tests, no more and no fewer', () => {
    expect(sheetKeysExact).toBe(true);
    expect(testKeysExact).toBe(true);
    expect(Object.keys(s).sort()).toEqual([...SHEET_KEYS].sort());
    expect(Object.keys(s.tests).sort()).toEqual([...TEST_KEYS].sort());
  });

  it('holds no figure and nothing calibrated', () => {
    for (const k of SHEET_KEYS) if (k !== 'id' && k !== 'identity' && k !== 'tests' && k !== 'calibration') expect(s[k], k).toBeNull();
    for (const k of TEST_KEYS) expect(s.tests[k], k).toBeNull();
    expect(s.calibration).toEqual({ tyreGripScale: null, dragAreaM2: null });
    expect(s.id).toBe('x');
    expect(s.identity).toEqual(identity);
    expect(s.identity).not.toBe(identity);
  });
});
