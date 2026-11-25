// The parts exam (DESIGN.md 11, last paragraph). Each page of data/exam is a set of documented real builds: one car,
// one change, a measurement before and after. For every case with enough physical detail, the stock car is built
// (its researched sheet when there is one; else a sheet of its maker's published figures, the resolver's class
// estimates for the rest), the catalogue part or parts closest to the change are fitted (build.setup carrying a size
// the catalogue lets a setup set: boost, shot, axle ratio), both cars are run on the bench, and the measured figure
// before the change times the bench's ratio, after over before, must land on the measured figure after it:
//   peak power and torque within 5% (a ratio, so crank against wheel figures cancels), quarter mile, eighth mile and
//   trap speed within 4%, skidpad within 0.04 g, braking within 7%, 0-60 within the validation's band (7% or 0.3 s).
// That ratio is the card's own rule (DESIGN.md 12: the published figure times built over stock), so a pass here is a
// part whose effect on the road and on the card agrees with the real build. A band the model cannot meet honestly is
// recorded as a miss (RECORDED_MISSES) and EXAM.md says why it stands; the case then fails if it misses anything else,
// or meets a recorded band again, so the suite stays green and still shows a change either way. Every case on every page is either examined here or listed with
// the reason it cannot be, so a case added to the data cannot be passed over unseen.
import { afterAll, describe, expect, it } from 'vitest';
import type {
  AwdKind, BodyClass, Build, Drivetrain, Induction, PhysicsSheet, Powertrain, Setup, Source, TransmissionType,
  TyreCategory, VehicleModel,
} from './types';
import { TOLERANCE } from './calibrate';
import { launchSpeeds, runBench, setRolling, skidpadAt } from './bench';
import { weightFrontShare } from './classes';
import { launchDriver } from './drivers';
import { P_AMBIENT } from './math';
import { sheetById } from './data/sheets';
import { CLASS_BLANK, resolveModel } from './resolve';
import { emptySheet } from './sheet';
import { FLAT, defaultControls } from './state';
import { FT, HP, LBFT, MPH, PSI } from './units';
import { createVehicle, step } from './vehicle';

/* ------------------------------------------------------------------ the exam pages */

type Figures = Record<string, unknown>;
type ExamCase = {
  car: string; change: string; measure: string; check?: string; publisher: string; url: string;
  physical: Figures; before: Figures; after: Figures; stockPublished?: Figures;
};
type ExamPage = { id: string; topic: string; cases: ExamCase[] };

const RAW = import.meta.glob('../data/exam/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const PAGES: Record<string, ExamPage> = {};
for (const path of Object.keys(RAW).sort()) {
  const page = JSON.parse(RAW[path]) as ExamPage;
  PAGES[page.id] = page;
}

function examCase(page: string, index: number): ExamCase {
  const p = PAGES[page];
  if (p === undefined) throw new Error(`no exam page ${page}`);
  const c = p.cases[index];
  if (c === undefined) throw new Error(`no case ${index} on ${page}`);
  return c;
}

/** A number the record must hold: a renamed or missing field fails the case rather than passing it by default. */
function numberIn(figures: Figures | undefined, key: string, where: string): number {
  const x = figures !== undefined ? figures[key] : undefined;
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`${where}: ${key} is not a number`);
  return x;
}

/* ------------------------------------------------------------------ stock sheets */

/** A maker's rating as widely published: the exam pages carry few stock figures, so these are listed in EXAM.md to be read again. */
const MAKER: Source = { kind: 'reference', name: 'maker\'s published rating, supplied for the parts exam (EXAM.md lists each one)' };
/** A figure read from the exam record itself (its stock figures, its car line, its physical detail). */
const RECORD: Source = { kind: 'test', name: 'data/exam record' };

type Stock = Partial<{
  curbLb: number; frontPct: number; wheelbaseIn: number; litres: number; cylinders: number; powertrain: Powertrain;
  induction: Induction; hp: number; hpRpm: number; torque: number; torqueRpmLow: number; torqueRpmHigh: number;
  redline: number; boostPsi: number; drive: Drivetrain; awd: AwdKind; transmission: TransmissionType; gears: number[];
  finalDrive: number; tyreFront: string; tyreRear: string; tyres: TyreCategory;
}>;

/** A sheet from published figures; `fromRecord` names the figures that came from the exam record rather than the maker. */
function stockSheet(id: string, year: number, make: string, model: string, trim: string, bodyClass: BodyClass, f: Stock, fromRecord: readonly (keyof Stock)[] = []): PhysicsSheet {
  const s = emptySheet(id, { year, make, model, trim, bodyClass });
  const src = (k: keyof Stock): Source => (fromRecord.indexOf(k) >= 0 ? RECORD : MAKER);
  const n = (k: keyof Stock): { value: number; source: Source } | null => {
    const x = f[k];
    return typeof x === 'number' ? { value: x, source: src(k) } : null;
  };
  s.curbWeightLb = n('curbLb'); s.weightDistFrontPct = n('frontPct'); s.wheelbaseIn = n('wheelbaseIn');
  s.displacementL = n('litres'); s.cylinders = n('cylinders');
  s.horsepower = n('hp'); s.horsepowerRpm = n('hpRpm'); s.torqueLbFt = n('torque');
  s.torqueRpmLow = n('torqueRpmLow'); s.torqueRpmHigh = n('torqueRpmHigh'); s.redlineRpm = n('redline'); s.boostPsi = n('boostPsi');
  s.finalDriveRatio = n('finalDrive');
  s.powertrain = { value: f.powertrain !== undefined ? f.powertrain : 'gasoline', source: src('powertrain') };
  if (f.induction !== undefined) s.induction = { value: f.induction, source: src('induction') };
  if (f.drive !== undefined) s.drivetrain = { value: f.drive, source: src('drive') };
  if (f.awd !== undefined) s.awdKind = { value: f.awd, source: src('awd') };
  if (f.transmission !== undefined) s.transmissionType = { value: f.transmission, source: src('transmission') };
  if (f.gears !== undefined) s.gearRatios = { value: f.gears.slice(), source: src('gears') };
  if (f.tyreFront !== undefined) s.tyreFront = { value: f.tyreFront, source: src('tyreFront') };
  if (f.tyreRear !== undefined) s.tyreRear = { value: f.tyreRear, source: src('tyreRear') };
  if (f.tyres !== undefined) s.tyreCategory = { value: f.tyres, source: src('tyres') };
  return s;
}

function copySheet(s: PhysicsSheet): PhysicsSheet {
  return JSON.parse(JSON.stringify(s)) as PhysicsSheet;
}

// The engines the cases share (maker's ratings).
const ECOBOOST_23: Stock = { litres: 2.3, cylinders: 4, induction: 'turbo', hp: 310, hpRpm: 5500, torque: 320, torqueRpmLow: 3000, drive: 'RWD' };
const TYPE_R: Stock = { litres: 2.0, cylinders: 4, induction: 'turbo', hp: 306, hpRpm: 6500, torque: 295, torqueRpmLow: 2500, torqueRpmHigh: 4500, redline: 7000, drive: 'FWD', transmission: 'manual' };
const CIVIC_SI: Stock = { litres: 1.5, cylinders: 4, induction: 'turbo', hp: 205, hpRpm: 5700, torque: 192, torqueRpmLow: 2100, torqueRpmHigh: 5000, redline: 6500, drive: 'FWD', transmission: 'manual' };
const GR_SUPRA: Stock = { litres: 3.0, cylinders: 6, induction: 'turbo', hp: 335, hpRpm: 5000, torque: 365, torqueRpmLow: 1600, torqueRpmHigh: 4500, drive: 'RWD', transmission: 'automatic' };
const FA20: Stock = { litres: 2.0, cylinders: 4, induction: 'natural', hpRpm: 7000, torqueRpmLow: 6400, torqueRpmHigh: 6600, redline: 7400, drive: 'RWD', transmission: 'manual', curbLb: 2762, tyreFront: '215/45R17', tyreRear: '215/45R17' };
const COYOTE_2018: Stock = { litres: 5.0, cylinders: 8, induction: 'natural', hp: 460, hpRpm: 7000, torque: 420, torqueRpmLow: 4600, redline: 7500, drive: 'RWD', transmission: 'automatic' };
/** Ford's 10R80 ten-speed automatic. */
const TEN_R80 = [4.696, 2.985, 2.146, 1.769, 1.520, 1.275, 1.000, 0.854, 0.689, 0.636];
const STROKER_347: Stock = { litres: 5.69, cylinders: 8, induction: 'natural', hp: 441, hpRpm: 6500, torque: 405, torqueRpmLow: 5000, drive: 'RWD' };

/** Weight added (negative: taken off) to a sheet's curb weight: at the rear axle (a load in a pickup's bed), or at the centre of gravity. */
function withWeight(s: PhysicsSheet, lb: number, at: 'rear axle' | 'centre'): PhysicsSheet {
  const t = copySheet(s);
  if (s.curbWeightLb === null) throw new Error(`${s.id}: no curb weight to add to`);
  const w = s.curbWeightLb.value;
  t.curbWeightLb = { value: w + lb, source: RECORD };
  if (at === 'rear axle') {
    const location = s.engineLocation !== null ? s.engineLocation.value : 'front';
    const drive = s.drivetrain !== null ? s.drivetrain.value : CLASS_BLANK[s.identity.bodyClass].drive;
    const share = s.weightDistFrontPct !== null ? s.weightDistFrontPct.value / 100 : weightFrontShare(location, drive, s.identity.bodyClass);
    t.weightDistFrontPct = { value: 100 * share * w / (w + lb), source: RECORD };
  }
  return t;
}

/* ------------------------------------------------------------------ what is measured, and the bench's reading of it */

type Figure = 'power' | 'torque' | 'quarter' | 'trap' | 'eighth' | 'zeroToSixty' | 'skidpad' | 'braking60' | 'braking70';
/** The exam record's keys for each figure, in the order tried. */
const KEYS: Record<Figure, readonly string[]> = {
  power: ['wheelHp', 'hp', 'crankHp'], torque: ['wheelTorqueLbFt', 'torqueLbFt'], quarter: ['quarterMileSec'],
  trap: ['quarterMileMph'], eighth: ['eighthMileSec'], zeroToSixty: ['zeroToSixtySec'], skidpad: ['skidpadG'],
  braking60: ['braking60to0Ft'], braking70: ['braking70to0Ft'],
};
const UNIT: Record<Figure, string> = {
  power: 'hp', torque: 'lb ft', quarter: 's', trap: 'mph', eighth: 's', zeroToSixty: 's', skidpad: 'g', braking60: 'ft', braking70: 'ft',
};
/** DESIGN.md 11: peak power and torque within 5% of the measured figure after the change. */
const POWER_SHARE = 0.05;

/** The band, in the figure's own unit, around the measured figure after the change. */
function band(f: Figure, after: number): number {
  switch (f) {
    case 'power': case 'torque': return POWER_SHARE * after;
    case 'quarter': case 'eighth': return TOLERANCE.quarterShare * after;
    case 'trap': return TOLERANCE.trapShare * after;
    case 'skidpad': return TOLERANCE.skidpadG;
    case 'braking60': case 'braking70': return TOLERANCE.brakingShare * after;
    case 'zeroToSixty': return Math.max(TOLERANCE.zeroToSixtyShare * after, TOLERANCE.zeroToSixtySec);
    default: return NaN;
  }
}

/**
 * A dyno pull with the nitrous armed, as a chassis dyno runs one: full throttle in third from 20 mph to the redline,
 * traction control off, the engine's brake torque (the shot's torque in it) read each step. Peak power and peak
 * torque over the pull. A car without a kit gives its own curve.
 */
function nitrousPull(m: VehicleModel): { power: number; torque: number } {
  const car = createVehicle(m);
  setRolling(car, 20 * MPH, 0);
  const c = defaultControls();
  c.throttle = 1; c.gear = Math.min(3, m.driveline.gears.length); c.nitrous = true; c.tcs = false;
  let power = 0, torque = 0;
  for (let k = 0; k < 120 * 30 && car.engineOmega < 0.995 * m.engine.redline; k++) {
    step(car, c, FLAT);
    if (car.engineOmega > 1.2 * m.engine.idle) {
      if (car.engineTorque * car.engineOmega > power) power = car.engineTorque * car.engineOmega;
      if (car.engineTorque > torque) torque = car.engineTorque;
    }
  }
  return { power: power / HP, torque: torque / LBFT };
}

/**
 * The bench's drag run with the nitrous button held from the start (the bench's own drivers never press it): the
 * bench's launch driver at each of its launch speeds, the best quarter mile kept. Times from the one-foot rollout, as
 * a strip's clock; 0-60 from the first movement; trap speeds over the last 66 ft.
 */
function nitrousDrag(m: VehicleModel): { quarter: number; trap: number; eighth: number; zeroToSixty: number } {
  let best = { quarter: Infinity, trap: NaN, eighth: NaN, zeroToSixty: NaN };
  const marks = [594 * FT, 660 * FT, 1254 * FT, 1320 * FT];
  for (const w of launchSpeeds(m)) {
    const car = createVehicle(m), d = launchDriver(m, w, 1), c = defaultControls();
    const at = [NaN, NaN, NaN, NaN];
    let x0 = car.x, u0 = car.u, t0 = car.time, rolled = NaN, moved = NaN, sixty = NaN, k = 0;
    while (k < marks.length && car.time < 60) {
      d.control(car, c);
      c.nitrous = true;
      step(car, c, FLAT);
      const t = car.time, x = car.x, u = car.u;
      if (moved !== moved && u > 0.01) moved = t0 + (t - t0) * (0.01 - u0) / (u - u0);
      if (rolled !== rolled && x >= FT) rolled = t0 + (t - t0) * (FT - x0) / (x - x0);
      if (sixty !== sixty && u >= 60 * MPH) sixty = t0 + (t - t0) * (60 * MPH - u0) / (u - u0);
      while (k < marks.length && x >= marks[k]) { at[k] = t0 + (t - t0) * (marks[k] - x0) / (x - x0); k++; }
      x0 = x; u0 = u; t0 = t;
    }
    const quarter = at[3] - rolled;
    if (quarter < best.quarter) best = { quarter, trap: 66 * FT / (at[3] - at[2]) / MPH, eighth: at[1] - rolled, zeroToSixty: sixty - moved };
  }
  return best;
}

/* ------------------------------------------------------------------ the cases examined */

type Examined = {
  page: string; index: number;
  /** The stock car, as built for this case. */
  stock: () => PhysicsSheet;
  /** Parts already on the car before the change (the case's own baseline), and the build after it (made from the stock sheet when it depends on the car). */
  before: Build; after: Build | ((stock: PhysicsSheet) => Build);
  /** A change the catalogue has no part for (weight added or taken off) made to the sheet instead. */
  afterSheet?: (stock: PhysicsSheet) => PhysicsSheet;
  figures: readonly Figure[];
  /** The change is a nitrous kit: the dyno pull and the drag run are made with the button held. */
  nitrous?: boolean;
  skidpadFt?: number;
  /** How the stock car and the change were read, in one line (EXAM.md has the long form). */
  how: string;
};

const build = (ids: readonly string[], setup: Setup = {}): Build => ({ parts: ids.map((id) => ({ id })), setup });
/** tune-1 raises full boost by 0.22 of an atmosphere (DESIGN.md 11). */
const TUNE_1_RISE = 0.22;

/**
 * tune-1 with the boost the case measured after it: the setup's boost target, as a multiple of what tune-1 alone
 * gives on this car's resolved stock engine (whose boost is the case's own figure when it has one, else the class's).
 */
function tuneTo(stock: PhysicsSheet, psiAfter: number, parts: readonly string[] = ['tune-1']): Build {
  const e = resolveModel(stock).model.engine, air = e.air;
  if (air === null) throw new Error(`${stock.id}: no air model to tune`);
  let prStock = 1;
  for (let i = 0; i < e.n; i++) if (air.pressureRatio[i] > prStock) prStock = air.pressureRatio[i];
  return build(parts, { boostTarget: (psiAfter * PSI / P_AMBIENT) / (prStock - 1 + TUNE_1_RISE) });
}

const TUNE = 'tune-turbo-engine', INTAKE = 'intake-exhaust', NOS = 'nitrous', BLOWER = 'supercharger-on-v8';
const HANDLING = 'suspension-handling', TYRES = 'tyres-skidpad-braking', WEIGHT = 'weight-reduction', GEARS = 'gearing-final-drive';

/** The Mustang EcoBoost: the maker's rating, or the record's own when it prints one (case 1); the stock boost when given. */
function ecoBoost(year: number, index: number): PhysicsSheet {
  const c = examCase(TUNE, index), where = `tune ${index}`;
  const f: Stock = { ...ECOBOOST_23 };
  const fromRecord: (keyof Stock)[] = [];
  if (c.stockPublished !== undefined) {
    const p = c.stockPublished;
    f.hp = numberIn(p, 'crankHp', where); f.hpRpm = numberIn(p, 'crankHpAtRpm', where);
    f.torque = numberIn(p, 'crankTorqueLbFt', where); f.torqueRpmLow = numberIn(p, 'crankTorqueAtRpm', where);
    fromRecord.push('hp', 'hpRpm', 'torque', 'torqueRpmLow');
  }
  if (typeof c.physical.boostPsiBefore === 'number') { f.boostPsi = c.physical.boostPsiBefore; fromRecord.push('boostPsi'); }
  return stockSheet(`exam-${year}-ford-mustang-ecoboost`, year, 'Ford', 'Mustang', 'EcoBoost (2.3L turbo I4)', 'coupe', f, fromRecord);
}
/** The FA20 flat-four: its rating is the record's own stock figures. */
function fa20(id: string, year: number, make: string, model: string, index: number): PhysicsSheet {
  const p = examCase(INTAKE, index).stockPublished, where = `intake ${index}`;
  return stockSheet(id, year, make, model, 'FA20', 'sports', { ...FA20, hp: numberIn(p, 'crankHp', where), torque: numberIn(p, 'crankTorqueLbFt', where) }, ['hp', 'torque']);
}
const typeR = (): PhysicsSheet => stockSheet('exam-2018-honda-civic-type-r', 2018, 'Honda', 'Civic', 'Type R (FK8)', 'hatchback', TYPE_R);
const supra = (): PhysicsSheet => stockSheet('exam-2020-toyota-gr-supra', 2020, 'Toyota', 'GR Supra', '3.0 (B58)', 'sports', GR_SUPRA);
/** The 2018 GT with the 10R80: the 3.55 axle is the gearing record's ratio before its change. */
const mustang2018 = (): PhysicsSheet => stockSheet('exam-2018-ford-mustang-gt', 2018, 'Ford', 'Mustang', 'GT (5.0L V8, 10R80)', 'coupe', { ...COYOTE_2018, gears: TEN_R80, finalDrive: numberIn(examCase(GEARS, 1).physical, 'axleRatioBefore', 'gears 1'), curbLb: 3705 }, ['finalDrive']);
/** The 347 stroker was run as an engine: its record's figures, a coupe's class figures for the car around it (none is read by a dyno pull). The year only decides which driver aids are standard. */
const stroker = (): PhysicsSheet => stockSheet('exam-ford-347-stroker', 1990, 'Ford', '347 stroker small-block', 'engine on a dyno (a coupe\'s class figures for the rest)', 'coupe', STROKER_347, ['litres', 'hp', 'hpRpm', 'torque', 'torqueRpmLow']);

const EXAMINED: readonly Examined[] = [
  /* ---- an ECU tune on a factory turbo engine: tune-1, at the boost the case measured when it gives one */
  {
    page: TUNE, index: 0, figures: ['power', 'torque'],
    stock: () => ecoBoost(2015, 0),
    before: build([]), after: (s) => tuneTo(s, numberIn(examCase(TUNE, 0).physical, 'boostPsiAfter', 'tune 0')),
    how: 'tune-1 set to the 25 psi measured (20 psi stock, from the record)',
  },
  {
    page: TUNE, index: 1, figures: ['power', 'torque'],
    stock: () => ecoBoost(2017, 1),
    before: build([]), after: (s) => tuneTo(s, numberIn(examCase(TUNE, 1).physical, 'boostPsiAfter', 'tune 1')),
    how: 'tune-1 set to the 22.93 psi measured (21 psi stock)',
  },
  { page: TUNE, index: 2, figures: ['power', 'torque'], stock: () => ecoBoost(2016, 2), before: build([]), after: build(['tune-1']), how: 'tune-1; boost not given' },
  { page: TUNE, index: 3, figures: ['power', 'torque'], stock: supra, before: build([]), after: (s) => tuneTo(s, numberIn(examCase(TUNE, 3).physical, 'boostPsiAfter', 'tune 3')), how: 'tune-1 set to the 21 psi measured after (stock boost not given: the class\'s 1.0 bar)' },
  { page: TUNE, index: 4, figures: ['power', 'torque'], stock: supra, before: build([]), after: build(['tune-1']), how: 'tune-1; boost not given' },
  { page: TUNE, index: 5, figures: ['power', 'torque'], stock: typeR, before: build([]), after: build(['tune-1']), how: 'tune-1; boost not given' },
  {
    page: TUNE, index: 6, figures: ['power', 'torque'],
    stock: () => stockSheet('exam-2019-honda-civic-si', 2019, 'Honda', 'Civic', 'Si', 'sedan', { ...CIVIC_SI, boostPsi: numberIn(examCase(TUNE, 6).physical, 'boostPsiBefore', 'tune 6') }, ['boostPsi']),
    before: build([]), after: (s) => tuneTo(s, numberIn(examCase(TUNE, 6).physical, 'boostPsiAfter', 'tune 6')),
    how: 'tune-1 set to the 22.49 psi measured (18.87 psi stock)',
  },
  {
    page: TUNE, index: 7, figures: ['zeroToSixty', 'quarter', 'trap'],
    stock: () => stockSheet('exam-2015-volkswagen-golf-r', 2015, 'Volkswagen', 'Golf R', 'Mk7 US, DSG', 'hatchback', { litres: 2.0, cylinders: 4, induction: 'turbo', hp: 292, hpRpm: 5400, torque: 280, torqueRpmLow: 1800, torqueRpmHigh: 5500, redline: 6500, drive: 'AWD', awd: 'front-on-demand', transmission: 'dual-clutch', curbLb: 3340, tyreFront: '235/35R19', tyreRear: '235/35R19', tyres: 'summer' }),
    before: build([]), after: build(['tune-1']),
    how: 'tune-1 (APR Stage I); 0-60 without rollout, as the case\'s table gives it',
  },
  {
    page: TUNE, index: 8, figures: ['zeroToSixty', 'quarter'],
    stock: () => stockSheet('exam-2022-volkswagen-golf-r', 2022, 'Volkswagen', 'Golf R', 'Mk8 US, DSG', 'hatchback', { litres: 2.0, cylinders: 4, induction: 'turbo', hp: 315, hpRpm: 5600, torque: 295, torqueRpmLow: 2100, torqueRpmHigh: 5350, redline: 6500, drive: 'AWD', awd: 'front-on-demand', transmission: 'dual-clutch', curbLb: 3435, tyreFront: '235/35R19', tyreRear: '235/35R19', tyres: 'summer' }),
    before: build([]), after: build(['tune-1']),
    how: 'tune-1 (a plug-in module sold as the equivalent of a stage 1)',
  },
  {
    page: TUNE, index: 9, figures: ['power'],
    stock: () => stockSheet('exam-2015-volkswagen-gti', 2015, 'Volkswagen', 'GTI', 'Mk7 (2.0T)', 'hatchback', { litres: 2.0, cylinders: 4, induction: 'turbo', hp: 210, hpRpm: 6200, torque: 258, torqueRpmLow: 1500, torqueRpmHigh: 4500, drive: 'FWD' }),
    before: build(['intake-1']), after: build(['intake-1', 'tune-1']),
    how: 'intake-1 on both runs, as the case had it; tune-1 for the Stage 1+ software',
  },

  /* ---- an intake or a cat-back alone, on the stock calibration */
  { page: INTAKE, index: 0, figures: ['power', 'torque'], stock: typeR, before: build([]), after: build(['intake-1']), how: 'intake-1' },
  { page: INTAKE, index: 1, figures: ['power', 'torque'], stock: typeR, before: build([]), after: build(['exhaust-1']), how: 'exhaust-1 (cat-back)' },
  {
    page: INTAKE, index: 2, figures: ['power', 'torque'],
    stock: () => stockSheet('exam-2010-chevrolet-camaro-ss-l99', 2010, 'Chevrolet', 'Camaro', 'SS (L99, 6L80E)', 'coupe', { litres: 6.2, cylinders: 8, induction: 'natural', hp: numberIn(examCase(INTAKE, 2).stockPublished, 'crankHp', 'intake 2'), hpRpm: 5900, torque: 410, torqueRpmLow: 4300, drive: 'RWD', transmission: 'automatic' }, ['hp']),
    before: build([]), after: build(['intake-1']), how: 'intake-1',
  },
  {
    page: INTAKE, index: 3, figures: ['power', 'torque'],
    stock: () => fa20('exam-subaru-brz', 2013, 'Subaru', 'BRZ', 3),
    before: build([]), after: build(['exhaust-1']), how: 'exhaust-1 (cat-back)',
  },
  {
    page: INTAKE, index: 4, figures: ['power', 'torque'],
    stock: () => fa20('exam-2015-scion-fr-s', 2015, 'Scion', 'FR-S', 4),
    before: build(['turbo-kit-1']), after: build(['turbo-kit-1', 'exhaust-1']),
    how: 'turbo-kit-1 (6 psi, the smallest kit: its boost is not given) on both runs; exhaust-1 for the JBA cat-back',
  },
  {
    page: INTAKE, index: 5, figures: ['power', 'torque'],
    stock: () => stockSheet('exam-2017-honda-civic-si', 2017, 'Honda', 'Civic', 'Si', 'sedan', CIVIC_SI),
    before: build([]), after: build(['intake-1']), how: 'intake-1',
  },

  /* ---- nitrous: the kit at its shot, the dyno pull and the strip with the button held */
  {
    page: NOS, index: 0, figures: ['power', 'torque'], nitrous: true,
    stock: () => stockSheet('exam-2011-ford-mustang-gt', 2011, 'Ford', 'Mustang', 'GT (5.0L)', 'coupe', { litres: 5.0, cylinders: 8, induction: 'natural', hp: 412, hpRpm: 6500, torque: 390, torqueRpmLow: 4250, redline: 7000, drive: 'RWD' }),
    before: build(['intake-1', 'exhaust-1', 'exhaust-2', 'tune-2']),
    after: build(['intake-1', 'exhaust-1', 'exhaust-2', 'tune-2', 'nitrous-2'], { nitrousPower: 0.75 }),
    how: 'the car\'s intake, full exhaust and tune as intake-1, exhaust-1 and -2, tune-2 on both runs; nitrous-2 set to the 75 hp shot',
  },
  { page: NOS, index: 2, figures: ['power', 'torque'], nitrous: true, stock: stroker, before: build([]), after: build(['nitrous-2']), how: 'nitrous-2 (100 hp)' },
  { page: NOS, index: 3, figures: ['power', 'torque'], nitrous: true, stock: stroker, before: build([]), after: build(['nitrous-3']), how: 'nitrous-3 (150 hp)' },
  {
    page: NOS, index: 6, figures: ['quarter'], nitrous: true,
    stock: () => stockSheet('exam-2005-ford-mustang-gt', 2005, 'Ford', 'Mustang', 'GT (4.6L 3V)', 'coupe', { litres: 4.6, cylinders: 8, induction: 'natural', hp: 300, hpRpm: 5750, torque: 320, torqueRpmLow: 4500, redline: 6250, drive: 'RWD', curbLb: 3483, tyreFront: '235/55R17', tyreRear: '235/55R17', tyres: 'all-season' }),
    before: build([]), after: build(['nitrous-2']),
    how: 'nitrous-2 (100 hp); gearbox not given (the class\'s)',
  },

  /* ---- a supercharger kit whose boost is given */
  {
    page: BLOWER, index: 2, figures: ['power', 'torque'],
    stock: mustang2018,
    before: build([]),
    after: build(['supercharger-kit-2', 'exhaust-1'], { boostTarget: numberIn(examCase(BLOWER, 2).physical, 'boostPsiAfter', 'supercharger 2') / 9 }),
    how: 'supercharger-kit-2 set to the 10 psi measured; exhaust-1 for the cat-delete pipes',
  },

  /* ---- springs and bars on the skidpad */
  {
    page: HANDLING, index: 0, figures: ['skidpad'], skidpadFt: numberIn(examCase(HANDLING, 0).physical, 'skidpadDiameterFt', 'handling 0'),
    stock: () => stockSheet('exam-2010-chevrolet-camaro-ss', 2010, 'Chevrolet', 'Camaro', 'SS (LS3, manual)', 'coupe', { litres: 6.2, cylinders: 8, induction: 'natural', hp: 426, hpRpm: 5900, torque: 420, torqueRpmLow: 4600, drive: 'RWD', transmission: 'manual', curbLb: 3860, frontPct: 52, wheelbaseIn: 112.3, tyreFront: '245/45R20', tyreRear: '275/40R20', tyres: 'summer' }),
    before: build([]), after: build(['springs-1', 'arb-2']),
    how: 'springs-1 for the lowering springs, arb-2 for the adjustable bars (the subframe brace has no part)',
  },

  /* ---- tyres alone */
  {
    page: TYRES, index: 0, figures: ['skidpad', 'braking70'], skidpadFt: 300,
    stock: () => stockSheet('exam-2017-ford-fusion-sport', 2017, 'Ford', 'Fusion', 'Sport (2.7L V6 twin-turbo)', 'sedan', { litres: 2.7, cylinders: 6, induction: 'twin-turbo', hp: 325, hpRpm: 5500, torque: 380, torqueRpmLow: 3500, drive: 'AWD', transmission: 'automatic', curbLb: 3989, tyreFront: '235/40R19', tyreRear: '235/40R19', tyres: 'all-season' }),
    before: build([]), after: build(['tyres-summer']),
    how: 'tyres-summer; Car and Driver\'s 300 ft skidpad',
  },
  {
    page: TYRES, index: 2, figures: ['skidpad', 'braking70'], skidpadFt: 300,
    stock: () => stockSheet('exam-2025-ford-maverick-lobo', 2025, 'Ford', 'Maverick', 'Lobo (2.0L turbo)', 'pickup', { litres: 2.0, cylinders: 4, induction: 'turbo', hp: 250, hpRpm: 5500, torque: 277, torqueRpmLow: 3000, drive: 'AWD', transmission: 'automatic', tyres: 'all-season' }),
    before: build([]), after: build(['tyres-summer']),
    how: 'tyres-summer; weight and tyre size not given (the class\'s)',
  },

  /* ---- weight: no part adds weight or takes a given number of pounds off, so the sheet's curb weight carries it */
  {
    page: WEIGHT, index: 0, figures: ['zeroToSixty', 'quarter', 'trap'],
    stock: () => stockSheet('exam-2025-ram-1500-tungsten', 2025, 'Ram', '1500', 'Tungsten (3.0L twin-turbo I6)', 'pickup', { litres: 3.0, cylinders: 6, induction: 'twin-turbo', hp: 540, torque: 521, drive: '4WD', transmission: 'automatic', curbLb: 5900 }, ['hp']),
    before: build([]), after: build([]), afterSheet: (s) => withWeight(s, numberIn(examCase(WEIGHT, 0).physical, 'poundsAdded', 'weight 0'), 'rear axle'),
    how: 'the 1,000 lb in the bed added over the rear axle',
  },
  {
    page: WEIGHT, index: 1, figures: ['zeroToSixty', 'quarter', 'trap'],
    stock: () => stockSheet('exam-2024-ford-f-150-powerboost', 2024, 'Ford', 'F-150', 'Platinum PowerBoost (3.5L twin-turbo V6 hybrid)', 'pickup', { litres: 3.5, cylinders: 6, powertrain: 'hybrid', induction: 'twin-turbo', hp: 430, torque: 570, drive: '4WD', transmission: 'automatic', curbLb: 5700 }, ['hp']),
    before: build([]), after: build([]), afterSheet: (s) => withWeight(s, numberIn(examCase(WEIGHT, 1).physical, 'poundsAdded', 'weight 1'), 'rear axle'),
    how: 'the 1,000 lb in the bed added over the rear axle',
  },
  {
    page: WEIGHT, index: 2, figures: ['zeroToSixty', 'quarter', 'trap'],
    stock: () => stockSheet('exam-2024-gmc-sierra-denali-ultimate', 2024, 'GMC', 'Sierra 1500', 'Denali Ultimate (6.2L V8)', 'pickup', { litres: 6.2, cylinders: 8, induction: 'natural', hp: 420, hpRpm: 5600, torque: 460, torqueRpmLow: 4100, drive: '4WD', transmission: 'automatic', curbLb: 5550 }, ['hp']),
    before: build([]), after: build([]), afterSheet: (s) => withWeight(s, numberIn(examCase(WEIGHT, 2).physical, 'poundsAdded', 'weight 2'), 'rear axle'),
    how: 'the 1,000 lb in the bed added over the rear axle',
  },
  {
    page: WEIGHT, index: 3, figures: ['eighth'],
    stock: () => stockSheet('exam-ford-crown-victoria-p71', 2008, 'Ford', 'Crown Victoria', 'Police Interceptor (4.6L, 4R75E)', 'sedan', { litres: 4.6, cylinders: 8, induction: 'natural', hp: 250, hpRpm: 4900, torque: 297, torqueRpmLow: 4000, drive: 'RWD', transmission: 'automatic', gears: [2.84, 1.55, 1.0, 0.70], finalDrive: 3.27, curbLb: numberIn(examCase(WEIGHT, 3).before, 'weightLb', 'weight 3'), tyreFront: '235/55R17', tyreRear: '235/55R17' }, ['curbLb']),
    before: build([]), after: build([]), afterSheet: (s) => withWeight(s, -numberIn(examCase(WEIGHT, 3).physical, 'poundsRemoved', 'weight 3'), 'centre'),
    how: '1,005 lb taken off at the centre of gravity (where it came from is not given)',
  },
  /* ---- a final-drive change: the setup's final drive, no part */
  {
    page: GEARS, index: 1, figures: ['quarter'],
    stock: mustang2018,
    before: build([]),
    after: build([], { finalDrive: numberIn(examCase(GEARS, 1).physical, 'axleRatioAfter', 'gears 1') / numberIn(examCase(GEARS, 1).physical, 'axleRatioBefore', 'gears 1') }),
    how: 'the setup\'s final drive from 3.55 to 3.15',
  },
];

/* ------------------------------------------------------------------ the cases that cannot be examined, and why */

const NOT_EXAMINED: Readonly<Record<string, string>> = {
  [`${GEARS} 0`]: 'the car is not identified (generation, engine and gearbox unknown, and the gearbox changes what a 3.42 means); only a 60-ft pair is measured',
  [`${GEARS} 2`]: 'the car, its engine and its turbo kit are not identified, and the run before the change ran out of revs before the line',
  [`${GEARS} 3`]: 'the ratio before the change and the tyre size are not given',
  [`${NOS} 1`]: 'the shot is not given ("nearly 100 hp"), the quarter mile with nitrous is not given, and the second reader could not settle that the kit was the only change',
  [`${NOS} 4`]: 'more than one change: the 10.60 pass came with a custom calibration and drag radials as well as the kit',
  [`${NOS} 5`]: 'not second-read (no check mark): the exam takes confirmed and unconfirmed cases only',
  [`${NOS} 7`]: 'the car is not identified',
  [`${BLOWER} 0`]: 'the kit\'s boost is not given (a kit\'s size in the catalogue is its boost); EXAM.md shows what kit-3 predicts',
  [`${BLOWER} 1`]: 'the kit\'s boost is not given and unspecified supporting mods went on with it',
  [`${BLOWER} 3`]: 'the kit\'s boost is not given and the baseline is another car (the shop\'s typical stock C7)',
  [`${BLOWER} 4`]: 'the kit\'s boost is not given',
  [`${BLOWER} 5`]: 'the kit\'s boost is not given',
  [`${BLOWER} 6`]: 'the kit\'s boost is not given (a retailer\'s 7-8 psi is not tied to this car) and the after figures are unverified',
  [`${HANDLING} 1`]: 'a slalom time: the bench runs no slalom, and the parts on the car are not named',
  [`${TYRES} 1`]: 'wet-surface stops: the bench brakes on dry asphalt',
  [`${WEIGHT} 4`]: 'the generation (Mk7 or Mk8) is not given, the doors came off (the aero changed) and new seats went in; 0-62 mph only',
  [`${WEIGHT} 5`]: 'the weight removed is not given (about 10% per one summary, about 200 lb per another), the 0-60 before is an average and after a best run, and the stop 30 ft shorter is more than the weight alone gives: the record says the case cannot be scored precisely',
  [`${WEIGHT} 6`]: 'the weight removed is not given, and taking the body panels off changed the aero',
};

/**
 * The figures the model misses, case by case, each with its reason in EXAM.md: kept in view, not left red. A case's
 * misses must be exactly these, so a new miss fails it, and so does a recorded one the model now meets (the record
 * and EXAM.md are then brought up to date). Every other case must meet every band.
 */
const RECORDED_MISSES: Readonly<Record<string, readonly Figure[]>> = {
  [`${TUNE} 1`]: ['power', 'torque'],
  [`${TUNE} 2`]: ['power'],
  [`${TUNE} 3`]: ['power', 'torque'],
  [`${TUNE} 4`]: ['power'],
  [`${TUNE} 5`]: ['torque'],
  [`${TUNE} 7`]: ['zeroToSixty', 'quarter', 'trap'],
  [`${TUNE} 9`]: ['power'],
  [`${INTAKE} 2`]: ['power', 'torque'],
  [`${INTAKE} 4`]: ['power', 'torque'],
  [`${NOS} 2`]: ['torque'],
  [`${NOS} 3`]: ['torque'],
  [`${BLOWER} 2`]: ['torque'],
};

/* ------------------------------------------------------------------ running a case */

type Row = { page: string; index: number; figure: Figure; before: number; after: number; modelBefore: number; modelAfter: number; predicted: number; error: number; band: number; pass: boolean };
const ROWS: Row[] = [];

function readings(m: VehicleModel, x: Examined): Record<Figure, number> {
  const out: Record<Figure, number> = { power: NaN, torque: NaN, quarter: NaN, trap: NaN, eighth: NaN, zeroToSixty: NaN, skidpad: NaN, braking60: NaN, braking70: NaN };
  const want = (f: Figure): boolean => x.figures.indexOf(f) >= 0;
  if (want('power') || want('torque')) {
    if (x.nitrous === true) { const p = nitrousPull(m); out.power = p.power; out.torque = p.torque; }
    else { const d = runBench(m, 'dyno'); out.power = d.peakHp; out.torque = d.peakTorqueLbFt; }
  }
  if (want('quarter') || want('trap') || want('eighth') || want('zeroToSixty')) {
    if (x.nitrous === true) Object.assign(out, nitrousDrag(m));
    else {
      const a = runBench(m, 'accel');
      out.quarter = a.timeslip.quarter; out.trap = a.timeslip.trapMph; out.eighth = a.timeslip.eighth; out.zeroToSixty = a.zeroToSixty;
    }
  }
  if (want('braking60') || want('braking70')) { const b = runBench(m, 'brake'); out.braking60 = b.braking60; out.braking70 = b.braking70; }
  if (want('skidpad')) out.skidpad = skidpadAt(m, x.skidpadFt !== undefined ? x.skidpadFt : 300);
  return out;
}

function measuredPair(c: ExamCase, f: Figure, where: string): { before: number; after: number } {
  for (const key of KEYS[f]) {
    if (typeof c.before[key] === 'number' && typeof c.after[key] === 'number') return { before: c.before[key] as number, after: c.after[key] as number };
  }
  throw new Error(`${where}: no measured ${f} before and after`);
}

function examine(x: Examined): Row[] {
  const c = examCase(x.page, x.index), where = `${x.page} ${x.index}`;
  const stock = x.stock();
  const m0 = resolveModel(stock, x.before).model;
  const after = typeof x.after === 'function' ? x.after(stock) : x.after;
  const m1 = resolveModel(x.afterSheet !== undefined ? x.afterSheet(stock) : stock, after).model;
  const r0 = readings(m0, x), r1 = readings(m1, x);
  const rows: Row[] = [];
  for (const f of x.figures) {
    const m = measuredPair(c, f, where);
    const predicted = m.before * r1[f] / r0[f];
    const error = predicted - m.after, tol = band(f, m.after);
    rows.push({ page: x.page, index: x.index, figure: f, before: m.before, after: m.after, modelBefore: r0[f], modelAfter: r1[f], predicted, error, band: tol, pass: Math.abs(error) <= tol });
  }
  return rows;
}

function say(r: Row): string {
  const digits = r.figure === 'skidpad' ? 3 : r.figure === 'power' || r.figure === 'torque' || r.figure === 'trap' || r.figure.startsWith('braking') ? 1 : 2;
  const pct = (a: number, b: number): string => `${a / b - 1 >= 0 ? '+' : ''}${(100 * (a / b - 1)).toFixed(1)}%`;
  return `${r.figure}: measured ${r.before} to ${r.after} ${UNIT[r.figure]} (${pct(r.after, r.before)}), bench ${pct(r.modelAfter, r.modelBefore)}, ` +
    `predicted ${r.predicted.toFixed(digits)} (${r.error >= 0 ? '+' : ''}${r.error.toFixed(digits)} against a band of ${r.band.toFixed(digits)})`;
}

/* ------------------------------------------------------------------ the exam */

describe('the parts exam covers every documented build', () => {
  it('every case on every page is examined here or listed with the reason it cannot be, never both', () => {
    expect(Object.keys(PAGES).sort()).toEqual([BLOWER, GEARS, INTAKE, NOS, HANDLING, TUNE, TYRES, WEIGHT].sort());
    const examined = new Set(EXAMINED.map((x) => `${x.page} ${x.index}`));
    expect(examined.size).toBe(EXAMINED.length);
    let cases = 0;
    for (const id of Object.keys(PAGES)) {
      PAGES[id].cases.forEach((c, i) => {
        cases++;
        const key = `${id} ${i}`, listed = NOT_EXAMINED[key] !== undefined;
        expect(examined.has(key) !== listed, `${key} (${c.car.slice(0, 60)}) must be examined or listed, not both`).toBe(true);
        // Only confirmed and unconfirmed cases are examined: a figure nobody second-read is not evidence.
        if (examined.has(key)) expect(['confirmed', 'unconfirmed'], key).toContain(c.check);
      });
    }
    // Nothing listed that is not on a page, and enough examined for the exam to say something.
    expect(EXAMINED.length + Object.keys(NOT_EXAMINED).length).toBe(cases);
    expect(EXAMINED.length).toBeGreaterThan(cases / 2);
    // A recorded miss is a figure an examined case measures.
    for (const [key, figures] of Object.entries(RECORDED_MISSES)) {
      const x = EXAMINED.find((e) => `${e.page} ${e.index}` === key);
      expect(x, `${key} has recorded misses but is not examined`).toBeDefined();
      for (const f of figures) expect(x!.figures, key).toContain(f);
    }
  });
});

for (const page of [TUNE, INTAKE, NOS, BLOWER, HANDLING, TYRES, WEIGHT, GEARS]) {
  describe(`exam page ${page}`, () => {
    for (const x of EXAMINED) {
      if (x.page !== page) continue;
      const id = x.stock().identity;
      const recorded = RECORDED_MISSES[`${x.page} ${x.index}`] ?? [];
      it(`case ${x.index}, ${id.year} ${id.make} ${id.model} ${id.trim}: ${x.how}${recorded.length > 0 ? ` (recorded misses: ${recorded.join(', ')})` : ''}`, () => {
        const rows = examine(x);
        ROWS.push(...rows);
        expect(rows.length).toBe(x.figures.length);
        for (const r of rows) expect(Number.isFinite(r.predicted), say(r)).toBe(true);
        // Every figure of the case within its band but the misses EXAM.md records for it, and those still missing; a
        // miss is told with the measured change and the bench's.
        const missed = rows.filter((r) => !r.pass);
        expect(missed.map((r) => r.figure).sort(), missed.map(say).join('; ') || 'no misses').toEqual(recorded.slice().sort());
      });
    }
  });
}

/* ------------------------------------------------------------------ indicative only: kits whose boost is not given */

/**
 * The supercharger cases whose boost the record does not give are not examined (a kit's size in the catalogue is its
 * boost). EXAM.md still shows what each of the three kits predicts on them, and whether the torque rises as much as
 * the power: a centrifugal blower's boost grows with the square of engine speed, so it adds far less torque than power.
 * Printed with the table; nothing here is asserted.
 */
function mustangGt2024(): PhysicsSheet {
  const s = sheetById('2024-ford-mustang-gt');
  if (s === null) throw new Error('the 2024 Mustang GT sheet is missing');
  return copySheet(s);
}
/** The Dark Horse: the researched 2024 GT with the Dark Horse's own engine, gearbox and tyres (maker's figures). */
function darkHorse(): PhysicsSheet {
  const s = mustangGt2024();
  s.id = 'exam-2024-ford-mustang-dark-horse';
  s.identity = { ...s.identity, trim: 'Dark Horse (5.0L V8, 10R80)' };
  s.horsepower = { value: 500, source: MAKER }; s.horsepowerRpm = { value: 7250, source: MAKER };
  s.torqueLbFt = { value: 418, source: MAKER }; s.torqueRpmLow = { value: 4900, source: MAKER }; s.torqueRpmHigh = { value: 4900, source: MAKER };
  s.redlineRpm = { value: 7500, source: MAKER };
  s.transmissionType = { value: 'automatic', source: MAKER }; s.gearRatios = { value: TEN_R80.slice(), source: MAKER }; s.finalDriveRatio = { value: 3.73, source: MAKER };
  s.tyreFront = { value: '255/40R19', source: MAKER }; s.tyreRear = { value: '275/40R19', source: MAKER };
  return s;
}
const LT1: Stock = { litres: 6.2, cylinders: 8, induction: 'natural', hpRpm: 6000, torqueRpmLow: 4600, redline: 6600, drive: 'RWD' };
const INDICATIVE: readonly { index: number; stock: () => PhysicsSheet; accel: boolean }[] = [
  { index: 0, stock: darkHorse, accel: true },
  { index: 1, stock: mustangGt2024, accel: false },
  { index: 3, stock: () => stockSheet('exam-2017-chevrolet-corvette-grand-sport', 2017, 'Chevrolet', 'Corvette', 'Grand Sport (LT1)', 'sports', { ...LT1, hp: 460, torque: 465, transmission: 'automatic' }), accel: false },
  { index: 4, stock: () => stockSheet('exam-2017-chevrolet-corvette-grand-sport', 2017, 'Chevrolet', 'Corvette', 'Grand Sport (LT1)', 'sports', { ...LT1, hp: 460, torque: 465 }), accel: false },
  { index: 5, stock: () => stockSheet('exam-chevrolet-corvette-c7-stingray', 2014, 'Chevrolet', 'Corvette', 'Stingray (LT1)', 'sports', { ...LT1, hp: 455, torque: 460 }), accel: false },
  { index: 6, stock: () => stockSheet('exam-chevrolet-camaro-ss-lt1', 2016, 'Chevrolet', 'Camaro', 'SS (LT1)', 'coupe', { ...LT1, hp: 455, torque: 455, torqueRpmLow: 4400 }), accel: false },
];

function indicative(): string[] {
  const out: string[] = [];
  const pct = (x: number): string => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}%`;
  for (const k of INDICATIVE) {
    const c = examCase(BLOWER, k.index), s = k.stock();
    const m0 = resolveModel(s).model, d0 = runBench(m0, 'dyno');
    const a0 = k.accel ? runBench(m0, 'accel') : null;
    const said: string[] = [];
    for (const f of ['power', 'torque', 'zeroToSixty', 'quarter', 'trap'] as const) {
      for (const key of KEYS[f]) {
        if (typeof c.before[key] === 'number' && typeof c.after[key] === 'number') { said.push(`${f} ${pct((c.after[key] as number) / (c.before[key] as number) - 1)}`); break; }
      }
    }
    const kits: string[] = [];
    for (const step of [1, 2, 3]) {
      const m = resolveModel(s, build([`supercharger-kit-${step}`])).model, d = runBench(m, 'dyno');
      let line = `kit-${step} power ${pct(d.peakHp / d0.peakHp - 1)} torque ${pct(d.peakTorqueLbFt / d0.peakTorqueLbFt - 1)}`;
      if (a0 !== null) {
        const a = runBench(m, 'accel');
        line += ` 0-60 ${pct(a.zeroToSixty / a0.zeroToSixty - 1)} quarter ${pct(a.timeslip.quarter / a0.timeslip.quarter - 1)} trap ${pct(a.timeslip.trapMph / a0.timeslip.trapMph - 1)}`;
      }
      kits.push(line);
    }
    out.push(`not examined  ${BLOWER} ${k.index}: measured ${said.join(', ')}; ${kits.join('; ')}`);
  }
  return out;
}

// The whole table, for EXAM.md: EXAM_TABLE=1 npx vitest run src/exam.test.ts. The host's console and environment are
// not in the ES2020 library the package compiles against, so they are reached through globalThis (as car.test.ts does).
type Host = { console: { log(...args: unknown[]): void }; process?: { env?: Record<string, string | undefined> } };
const host = globalThis as unknown as Host;
afterAll(() => {
  if (host.process?.env?.EXAM_TABLE !== '1') return;
  const lines = ROWS.slice().sort((a, b) => a.page.localeCompare(b.page) || a.index - b.index).map((r) => `${r.pass ? 'pass' : 'MISS'}  ${r.page} ${r.index}: ${say(r)}`);
  host.console.log(lines.concat(indicative()).join('\n'));
});
