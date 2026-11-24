import { describe, expect, it } from 'vitest';
import type { BodyClass, Drivetrain, Induction, PhysicsSheet, Powertrain, Source, Sourced, VehicleModel } from './types';
import { BODY_CLASSES, CHASSIS_CLASS, SUSPENSION_GRADE, TYRE_CATEGORY, tyreGripScaleRange } from './classes';
import { rollGradient } from './chassis';
import { enginePeaks, engineTorque } from './engine';
import { G, PI, RHO_AIR } from './math';
import {
  CLASS_BLANK, applySetup, powerLimitedSpeed, resolveEngineSpec, resolveLayout, resolveModel, resolveTyres,
} from './resolve';
import { emptySheet } from './sheet';
import { tyreMuX, tyreMuY } from './tyre';
import { HP, IN, LB, LBF, LBFT, MPH, PSI, RPM, SQFT } from './units';

// Every sheet here is built in the test from an empty one, its figures marked illustrative: none is data about a real car.
const SRC: Source = { kind: 'illustrative', name: 'resolve.test' };
function n<T>(value: T): Sourced<T> { return { value, source: SRC }; }
function blank(bodyClass: BodyClass, year = 2020): PhysicsSheet {
  return emptySheet(`test-${bodyClass}`, { year, make: 'Test', model: bodyClass, trim: '', bodyClass });
}
const DEG = PI / 180;

/** A sheet with what a row of the game's car table gives: power, weight, the engine in words, drive, 0-60 and a rated top speed. */
function tableSheet(bodyClass: BodyClass, drive: Drivetrain, f: { hp: number; lb: number; litres?: number; cyl?: number; induction?: Induction; powertrain?: Powertrain; mph: number }): PhysicsSheet {
  const s = blank(bodyClass);
  s.horsepower = n(f.hp);
  s.curbWeightLb = n(f.lb);
  if (f.litres !== undefined) s.displacementL = n(f.litres);
  if (f.cyl !== undefined) s.cylinders = n(f.cyl);
  if (f.induction !== undefined) s.induction = n(f.induction);
  s.powertrain = n(f.powertrain ?? 'gasoline');
  s.drivetrain = n(drive);
  s.topSpeedMph = n(f.mph);
  s.topSpeedGoverned = n(true);
  s.tests.zeroToSixtySec = n(7);
  return s;
}

// What a typical member of each class would show in the table.
const TABLE: Record<BodyClass, { hp: number; lb: number; litres: number; cyl: number; induction: Induction; mph: number }> = {
  sports: { hp: 450, lb: 3400, litres: 4.0, cyl: 6, induction: 'natural', mph: 190 },
  coupe: { hp: 460, lb: 3800, litres: 5.0, cyl: 8, induction: 'natural', mph: 155 },
  sedan: { hp: 203, lb: 3300, litres: 2.5, cyl: 4, induction: 'natural', mph: 130 },
  hatchback: { hp: 158, lb: 2900, litres: 2.0, cyl: 4, induction: 'natural', mph: 125 },
  wagon: { hp: 182, lb: 3650, litres: 2.5, cyl: 4, induction: 'natural', mph: 125 },
  suv: { hp: 203, lb: 3500, litres: 2.5, cyl: 4, induction: 'natural', mph: 120 },
  van: { hp: 280, lb: 4450, litres: 3.5, cyl: 6, induction: 'natural', mph: 115 },
  pickup: { hp: 400, lb: 4900, litres: 3.5, cyl: 6, induction: 'twin-turbo', mph: 107 },
  offroad: { hp: 285, lb: 4450, litres: 3.6, cyl: 6, induction: 'natural', mph: 99 },
};
const DRIVES: readonly Drivetrain[] = ['FWD', 'RWD', 'AWD', '4WD'];

/**
 * A fictional sports coupe with every main figure on file: 400 hp turbo six, 3,500 lb, 53% on the nose, an
 * eight-speed automatic, summer tyres, governed at 155 mph.
 */
function fullSheet(): PhysicsSheet {
  const s = emptySheet('test-full', { year: 2022, make: 'Test', model: 'Full', trim: 'GT', bodyClass: 'coupe' });
  s.curbWeightLb = n(3500); s.weightDistFrontPct = n(53);
  s.wheelbaseIn = n(107); s.trackFrontIn = n(62.5); s.trackRearIn = n(63); s.lengthIn = n(188); s.widthIn = n(75); s.heightIn = n(54);
  s.cgHeightIn = n(19.5);
  s.powertrain = n('gasoline'); s.induction = n('turbo'); s.engineLocation = n('front');
  s.displacementL = n(3.0); s.cylinders = n(6);
  s.horsepower = n(400); s.horsepowerRpm = n(6250); s.torqueLbFt = n(380); s.torqueRpmLow = n(1800); s.torqueRpmHigh = n(5000);
  s.redlineRpm = n(7000); s.boostPsi = n(17);
  s.drivetrain = n('RWD'); s.transmissionType = n('automatic');
  s.gearRatios = n([5.0, 3.2, 2.14, 1.72, 1.31, 1.0, 0.82, 0.64]); s.finalDriveRatio = n(3.15);
  s.diffFront = n('open'); s.diffRear = n('open');
  s.tyreFront = n('255/35R19'); s.tyreRear = n('275/35R19'); s.tyreCategory = n('summer');
  s.dragCoefficient = n(0.30); s.frontalAreaSqFt = n(23); s.liftCoefficientFront = n(0.05); s.liftCoefficientRear = n(0.04);
  s.steeringRatio = n(14.5); s.turningCircleFt = n(38);
  s.suspensionGrade = n('sport');
  s.topSpeedMph = n(155); s.topSpeedGoverned = n(true);
  s.abs = n(true); s.tractionControl = n(true); s.stabilityControl = n(true); s.launchControl = n(false);
  return s;
}

/** Every number in a value, with its path, in a fixed order. */
function numbers(x: unknown, path: string, out: [string, number][]): [string, number][] {
  if (typeof x === 'number') out.push([path, x]);
  else if (x instanceof Float64Array) x.forEach((v, i) => out.push([`${path}[${i}]`, v]));
  else if (Array.isArray(x)) x.forEach((v, i) => numbers(v, `${path}[${i}]`, out));
  else if (x !== null && typeof x === 'object') for (const k of Object.keys(x).sort()) numbers((x as Record<string, unknown>)[k], path === '' ? k : `${path}.${k}`, out);
  return out;
}

/** The model's parameters as the basis record names them: each piece's fields, or the field itself. */
function parameterKeys(m: VehicleModel): string[] {
  const keys: string[] = [];
  const rec = m as unknown as Record<string, unknown>;
  for (const top of Object.keys(rec)) {
    if (top === 'id' || top === 'name') continue;
    const v = rec[top];
    if (v !== null && typeof v === 'object' && !(v instanceof Float64Array)) for (const k of Object.keys(v)) keys.push(`${top}.${k}`);
    else keys.push(top);
  }
  return keys.sort();
}

/** What is wrong with a model: any NaN, and any zero or negative where the physics needs a positive number. */
function problems(m: VehicleModel): string[] {
  const bad: string[] = [];
  for (const [path, v] of numbers(m, '', [])) if (Number.isNaN(v)) bad.push(`${path} is NaN`);
  const c = m.chassis;
  const positive: [string, number][] = [
    ['mass', c.mass], ['sprungMass', c.sprungMass], ['unsprungFront', c.unsprungFront], ['unsprungRear', c.unsprungRear],
    ['a', c.a], ['b', c.b], ['wheelbase', c.wheelbase], ['trackFront', c.trackFront], ['trackRear', c.trackRear],
    ['cgHeight', c.cgHeight], ['sprungCgHeight', c.sprungCgHeight], ['unsprungHeightFront', c.unsprungHeightFront], ['unsprungHeightRear', c.unsprungHeightRear],
    ['izz', c.izz], ['ixx', c.ixx], ['iyy', c.iyy], ['springFront', c.springFront], ['springRear', c.springRear],
    ['damperFront', c.damperFront], ['damperRear', c.damperRear], ['maxSteer', c.maxSteer], ['steerRatio', c.steerRatio],
    ['wheelInertiaFront', m.wheelInertiaFront], ['wheelInertiaRear', m.wheelInertiaRear],
    ['engine.inertia', m.engine.inertia], ['engine.redline', m.engine.redline], ['engine.limiterBand', m.engine.limiterBand],
    ['engine.dOmega', m.engine.dOmega], ['engine.peakPower', enginePeaks(m.engine).power],
    ['finalDrive', m.driveline.finalDrive], ['efficiency', m.driveline.efficiency], ['reverse', m.driveline.reverse],
    ['clutchCapacity', m.driveline.clutchCapacity], ['brakeFront', m.brakes.maxTorqueFront], ['brakeRear', m.brakes.maxTorqueRear],
    ['handbrake', m.brakes.handbrakeTorque], ['dragArea', m.aero.dragArea], ['limiterSpeed', m.systems.limiterSpeed],
  ];
  for (const t of [m.tyreFront, m.tyreRear]) {
    for (const [k, v] of Object.entries(t)) if (k !== 'rollRes' && !(v > 0)) bad.push(`tyre.${k} = ${v}`);
    if (!(t.rollRes >= 0)) bad.push(`tyre.rollRes = ${t.rollRes}`);
  }
  for (const [k, v] of positive) if (!(v > 0)) bad.push(`${k} = ${v}`);
  for (const [k, v] of [['arbFront', c.arbFront], ['arbRear', c.arbRear], ['antiDive', c.antiDive], ['antiSquat', c.antiSquat]] as const) if (!(v >= 0 && Number.isFinite(v))) bad.push(`${k} = ${v}`);
  if (m.engine.kind !== 'electric' && !(m.engine.idle > 0)) bad.push('idle');
  if (!(m.driveline.efficiency < 1)) bad.push('efficiency not below 1');
  const g = m.driveline.gears;
  if (g.length === 0) bad.push('no gears');
  for (let i = 0; i < g.length; i++) if (!(g[i] > 0) || (i > 0 && !(g[i] < g[i - 1]))) bad.push(`gear ${i + 1} = ${g[i]}`);
  for (const table of [m.engine.wot, m.engine.offBoost, m.engine.friction]) for (const v of table) if (!Number.isFinite(v)) bad.push('engine table');
  return bad;
}

/** Ride frequency of an axle's sprung mass on its two springs, Hz. */
function rideHz(spring: number, sprungAxleMass: number): number { return Math.sqrt(2 * spring / sprungAxleMass) / (2 * PI); }

/* ------------------------------------------------------------------ published units to SI */

describe('published units become SI once, exactly', () => {
  it('a 3,500 lb coupe 107 in long between the axles weighs 1,662.57 kg with its driver and spans 2.718 m', () => {
    const { model: m } = resolveModel(fullSheet());
    expect(m.chassis.mass).toBe(3500 * LB + 75);
    expect(m.chassis.mass).toBeCloseTo(1662.573295, 6);
    expect(m.chassis.wheelbase).toBe(107 * IN);
    expect(m.chassis.wheelbase).toBeCloseTo(2.7178, 10);
    expect(m.chassis.trackFront).toBeCloseTo(1.5875, 10);
    expect(m.chassis.trackRear).toBeCloseTo(1.6002, 10);
    expect(m.chassis.cgHeight).toBeCloseTo(0.4953, 10);    // 19.5 in
    expect(m.chassis.steerRatio).toBe(14.5);
  });

  it('400 hp at 6,250 rpm is 298.3 kW at 654.5 rad/s; 380 lb ft is 515.2 N m; 17 psi of boost is 117.2 kPa; 7,000 rpm is 733.0 rad/s', () => {
    const s = fullSheet();
    const spec = resolveEngineSpec(s, resolveLayout(s), {});
    expect(spec.peakPower).toBe(400 * HP);
    expect(spec.peakPower).toBeCloseTo(298279.95, 2);
    expect(spec.peakPowerOmega).toBeCloseTo(654.498, 3);
    expect(spec.peakTorque).toBe(380 * LBFT);
    expect(spec.peakTorque).toBeCloseTo(515.211, 3);
    expect(spec.peakTorqueOmegaLow).toBeCloseTo(1800 * PI / 30, 12);
    expect(spec.peakTorqueOmegaHigh).toBeCloseTo(523.599, 3);
    expect(spec.boostPa).toBe(17 * PSI);
    expect(spec.boostPa).toBeCloseTo(117210.9, 1);
    expect(spec.redline).toBeCloseTo(733.038, 3);
    expect(spec.displacementL).toBe(3.0);
    expect(spec.kind).toBe('turbo');
  });

  it('a 255/35R19 rolls on 0.3206 m loaded (0.97 of its 0.3306 m free radius) and is 0.255 m wide; Cd 0.30 on 23 sq ft is 0.641 m^2', () => {
    const { model: m } = resolveModel(fullSheet());
    expect(m.tyreFront.width).toBe(0.255);
    expect(m.tyreFront.radius).toBeCloseTo(0.97 * (19 * 0.0254 / 2 + 0.255 * 0.35), 12);
    expect(m.tyreFront.radius).toBeCloseTo(0.3206335, 7);
    expect(m.tyreRear.width).toBe(0.275);
    expect(m.aero.dragArea).toBeCloseTo(0.30 * 23 * SQFT, 12);
    expect(m.aero.dragArea).toBeCloseTo(0.6410, 4);
    expect(m.aero.liftAreaFront).toBeCloseTo(0.05 * 23 * SQFT, 12);
    expect(m.systems.limiterSpeed).toBe(155 * MPH);      // 69.29 m/s
    expect(m.systems.limiterSpeed).toBeCloseTo(69.291, 3);
  });

  it('a 38 ft turning circle on a 107 in wheelbase gives about 33 degrees of lock at the front wheels', () => {
    const { model: m } = resolveModel(fullSheet());
    // The outer front wheel sweeps 5.79 m; the rear axle's centre then turns on 4.31 m.
    expect(m.chassis.maxSteer / DEG).toBeGreaterThan(31);
    expect(m.chassis.maxSteer / DEG).toBeLessThan(35);
    const none = resolveModel(blank('sedan')).model;
    expect(none.chassis.maxSteer).toBe(0.6);   // 34 degrees when the sheet has no turning circle
  });
});

/* ------------------------------------------------------------------ the chassis */

describe('the chassis stands as statics says it must', () => {
  it('the driven mass is the curb weight plus a 75 kg driver', () => {
    const weights = [2200, 3000, 3500, 5600];
    for (const lb of weights) {
      const s = blank('sedan'); s.curbWeightLb = n(lb);
      expect(resolveModel(s).model.chassis.mass, `${lb} lb`).toBeCloseTo(lb * 0.45359237 + 75, 10);
    }
    expect(resolveModel(blank('pickup')).model.chassis.mass).toBe(CLASS_BLANK.pickup.curbKg + 75);
  });

  it('sprung mass at its height plus each axle\'s unsprung mass at its wheel centre is the whole car at its centre of gravity', () => {
    const sheets = [fullSheet(), ...BODY_CLASSES.map((c) => blank(c)), ...BODY_CLASSES.map((c) => tableSheet(c, 'AWD', TABLE[c]))];
    expect(sheets.length).toBe(19);
    for (const s of sheets) {
      const c = resolveModel(s).model.chassis;
      const moment = c.sprungMass * c.sprungCgHeight + c.unsprungFront * c.unsprungHeightFront + c.unsprungRear * c.unsprungHeightRear;
      expect(Math.abs(moment / (c.mass * c.cgHeight) - 1), s.id).toBeLessThan(1e-12);
      expect(c.sprungMass + c.unsprungFront + c.unsprungRear, s.id).toBeCloseTo(c.mass, 9);
      expect(c.sprungCgHeight, s.id).toBeGreaterThan(c.cgHeight);       // the wheels sit lower than the body
    }
  });

  it('a + b is the wheelbase and b / L is the published 53% on the nose; a blank front-drive sedan carries 60%', () => {
    const c = resolveModel(fullSheet()).model.chassis;
    expect(Math.abs((c.a + c.b) / c.wheelbase - 1)).toBeLessThan(1e-15);
    expect(c.b / c.wheelbase).toBeCloseTo(0.53, 12);
    expect(c.a).toBeCloseTo(2.7178 * 0.47, 12);
    const sedan = resolveModel(blank('sedan')).model.chassis;
    expect(sedan.b / sedan.wheelbase).toBeCloseTo(0.60, 12);
    const mid = blank('sports'); mid.engineLocation = n('mid');
    const m = resolveModel(mid).model.chassis;
    expect(m.b / m.wheelbase).toBeCloseTo(0.41, 12);
  });

  it('each axle bounces at its class\'s ride frequency and is damped at its damping ratio: a sedan 1.2 and 1.35 Hz at 0.30, a sport suspension 15% quicker', () => {
    for (const s of [blank('sedan'), fullSheet()]) {
      const c = resolveModel(s).model.chassis;
      const row = CHASSIS_CLASS[s.identity.bodyClass], grade = SUSPENSION_GRADE[s.suspensionGrade?.value ?? 'standard'];
      const front = c.mass * c.b / c.wheelbase - c.unsprungFront, rear = c.mass * c.a / c.wheelbase - c.unsprungRear;
      expect(rideHz(c.springFront, front), s.id).toBeCloseTo(row.rideHzFront * grade.rideScale, 9);
      expect(rideHz(c.springRear, rear), s.id).toBeCloseTo(row.rideHzRear * grade.rideScale, 9);
      // Damping ratio of one corner: c / (2 sqrt(k m)).
      expect(c.damperFront / (2 * Math.sqrt(c.springFront * front / 2)), s.id).toBeCloseTo(row.dampingRatio + grade.dampingAdd, 9);
      expect(c.damperRear / (2 * Math.sqrt(c.springRear * rear / 2)), s.id).toBeCloseTo(row.dampingRatio + grade.dampingAdd, 9);
    }
    const sedan = resolveModel(blank('sedan')).model.chassis;
    expect(rideHz(sedan.springFront, sedan.mass * sedan.b / sedan.wheelbase - sedan.unsprungFront)).toBeCloseTo(1.2, 9);
  });

  it('the body rolls at its class\'s gradient (a sedan 5 deg/g) or a little less, and the front carries more of the roll stiffness than of the weight, except on front drive, where it carries its weight share', () => {
    let exact = 0;
    for (const bc of BODY_CLASSES) {
      const c = resolveModel(blank(bc)).model.chassis;
      const want = CHASSIS_CLASS[bc].rollGradient;
      const got = rollGradient(c);
      // Where an axle's springs alone pass its share the bar there is 0 and the other keeps the split: a little less roll.
      expect(got / want, bc).toBeGreaterThan(0.78);
      expect(got / want, bc).toBeLessThan(1 + 1e-9);
      if (Math.abs(got / want - 1) < 1e-9) exact++;
      const kf = 0.5 * c.springFront * c.trackFront * c.trackFront + c.arbFront;
      const kr = 0.5 * c.springRear * c.trackRear * c.trackRear + c.arbRear;
      const share = c.b / c.wheelbase;
      const margin = resolveModel(blank(bc)).model.driveline.layout === 'FWD' ? 0 : CHASSIS_CLASS[bc].rollShareOverWeight;
      expect(kf / (kf + kr), bc).toBeCloseTo(share + margin, 9);
      expect(c.arbFront, bc).toBeGreaterThanOrEqual(0);
      expect(c.arbRear, bc).toBeGreaterThanOrEqual(0);
    }
    expect(exact).toBeGreaterThanOrEqual(5);   // the family cars hit it on the nose
    expect(rollGradient(resolveModel(blank('sedan')).model.chassis) * G / DEG).toBeCloseTo(5.0, 6);
  });

  it('yaw inertia is the class\'s dynamic index times m a b; a mid-size sedan pitches and rolls with 2,000 to 3,500 and 700 to 1,300 kg m^2 about its axes', () => {
    const c = resolveModel(blank('sedan')).model.chassis;
    expect(c.izz / (c.mass * c.a * c.b)).toBeCloseTo(1.0, 12);
    expect(c.ixx).toBeGreaterThan(700);
    expect(c.ixx).toBeLessThan(1300);
    expect(c.iyy).toBeGreaterThan(2000);
    expect(c.iyy).toBeLessThan(3500);
  });

  it('a pickup carries its weight 0.3 m higher than a sports car and its tyres grip a third less', () => {
    const truck = resolveModel(tableSheet('pickup', 'RWD', TABLE.pickup)).model;
    const sports = resolveModel(tableSheet('sports', 'RWD', TABLE.sports)).model;
    expect(truck.chassis.cgHeight - sports.chassis.cgHeight).toBeGreaterThan(0.25);
    expect(truck.chassis.cgHeight).toBeCloseTo(0.41 * 1.90, 9);     // 0.78 m
    expect(sports.chassis.cgHeight).toBeCloseTo(0.37 * 1.28, 9);    // 0.47 m
    // Static stability factor, track over twice the height: about 1.1 for a truck (NHTSA's tippier band), 1.7 for a sports car.
    expect(truck.chassis.trackFront / (2 * truck.chassis.cgHeight)).toBeLessThan(1.2);
    expect(sports.chassis.trackFront / (2 * sports.chassis.cgHeight)).toBeGreaterThan(1.5);
    // Peak friction of a front tyre at its own static load.
    const load = (m: VehicleModel): number => 0.5 * m.chassis.mass * G * m.chassis.b / m.chassis.wheelbase;
    const muTruck = tyreMuY(truck.tyreFront, load(truck), 1), muSports = tyreMuY(sports.tyreFront, load(sports), 1);
    expect(muTruck).toBeLessThan(0.85);
    expect(muSports).toBeGreaterThan(1.05);
    expect(muTruck / muSports).toBeLessThan(0.75);
  });
});

/* ------------------------------------------------------------------ the six table figures are enough */

describe('the six table figures are enough for a whole car', () => {
  it('every class with every drive resolves to a complete, finite model with nothing zero that must be positive', () => {
    let count = 0;
    for (const bc of BODY_CLASSES) {
      for (const drive of DRIVES) {
        const m = resolveModel(tableSheet(bc, drive, TABLE[bc])).model;
        expect(problems(m), `${bc} ${drive}`).toEqual([]);
        expect(m.driveline.layout, `${bc} ${drive}`).toBe(drive === '4WD' ? 'AWD' : drive);
        count++;
      }
    }
    expect(count).toBe(36);
  });

  it('so does a blank sheet of every class, an electric car and a hybrid of every class, and a car with no figures but a displacement', () => {
    let count = 0;
    for (const bc of BODY_CLASSES) {
      const variants: PhysicsSheet[] = [blank(bc)];
      const ev = tableSheet(bc, 'AWD', { hp: 350, lb: 4300, powertrain: 'electric', mph: 130 }); variants.push(ev);
      const hybrid = tableSheet(bc, 'FWD', { hp: 196, lb: 3500, litres: 2.5, cyl: 4, powertrain: 'hybrid', mph: 115 }); variants.push(hybrid);
      const litres = blank(bc); litres.displacementL = n(2.0); variants.push(litres);
      for (const s of variants) { expect(problems(resolveModel(s).model), `${bc} ${s.powertrain?.value ?? 'blank'}`).toEqual([]); count++; }
    }
    expect(count).toBe(36);
  });

  it('the published power survives into the engine within 0.5% for every table car', () => {
    let count = 0;
    for (const bc of BODY_CLASSES) {
      const m = resolveModel(tableSheet(bc, 'RWD', TABLE[bc])).model;
      expect(Math.abs(enginePeaks(m.engine).power / (TABLE[bc].hp * HP) - 1), bc).toBeLessThan(0.005);
      count++;
    }
    expect(count).toBe(9);
  });
});

/* ------------------------------------------------------------------ basis */

describe('every parameter says how it was reached', () => {
  it('every parameter of the model has a basis, and nothing else does', () => {
    for (const s of [blank('van'), fullSheet(), tableSheet('pickup', '4WD', TABLE.pickup)]) {
      const { model, basis } = resolveModel(s);
      const keys = parameterKeys(model);
      expect(keys.length, s.id).toBe(104);
      expect(Object.keys(basis).sort(), s.id).toEqual(keys);
      for (const k of keys) expect(['sourced', 'derived', 'calibrated', 'estimated'], k).toContain(basis[k]);
    }
  });

  it('a blank sheet is estimated through and through', () => {
    for (const bc of BODY_CLASSES) {
      const { basis } = resolveModel(blank(bc));
      const notEstimated = Object.entries(basis).filter(([, b]) => b !== 'estimated').map(([k]) => k);
      expect(notEstimated, bc).toEqual([]);
      expect(Object.keys(basis).length, bc).toBe(104);
    }
  });

  it('a full sheet\'s main figures are sourced, what is worked out from them derived, and only the class tables\' figures estimated', () => {
    const { basis } = resolveModel(fullSheet());
    const sourced = [
      'chassis.mass', 'chassis.wheelbase', 'chassis.trackFront', 'chassis.trackRear', 'chassis.cgHeight', 'chassis.steerRatio',
      'tyreFront.width', 'tyreRear.width', 'engine.kind', 'engine.displacement', 'engine.cylinders', 'engine.redline',
      'driveline.layout', 'driveline.transmission', 'driveline.gears', 'driveline.finalDrive', 'driveline.diffFront', 'driveline.diffRear',
      'systems.abs', 'systems.tcs', 'systems.esc', 'systems.launchControl', 'systems.limiterSpeed',
    ];
    const derived = [
      'chassis.a', 'chassis.b', 'chassis.maxSteer', 'tyreFront.radius', 'tyreFront.fz0', 'chassis.unsprungHeightFront',
      'engine.wot', 'engine.offBoost', 'engine.n', 'aero.dragArea', 'aero.liftAreaFront', 'aero.liftAreaRear', 'driveline.launch',
    ];
    for (const k of sourced) expect(basis[k], k).toBe('sourced');
    for (const k of derived) expect(basis[k], k).toBe('derived');
    for (const k of ['chassis.springFront', 'chassis.arbRear', 'chassis.izz', 'tyreFront.muY0', 'tyreFront.loadSens', 'engine.friction', 'brakes.maxTorqueFront', 'driveline.efficiency'])
      expect(basis[k], k).toBe('estimated');
  });

  it('a calibrated grip scale and a calibrated drag area are marked calibrated; a drag figure on file outranks the calibration', () => {
    const s = blank('coupe');
    s.calibration.tyreGripScale = 1.03; s.calibration.dragAreaM2 = 0.66;
    const { model, basis } = resolveModel(s);
    expect(basis['tyreFront.muY0']).toBe('calibrated');
    expect(basis['aero.dragArea']).toBe('calibrated');
    expect(model.aero.dragArea).toBe(0.66);
    expect(model.tyreFront.muY0).toBeCloseTo(1.02 * 1.03, 12);
    s.dragCoefficient = n(0.31); s.frontalAreaSqFt = n(22);
    const with_ = resolveModel(s);
    expect(with_.basis['aero.dragArea']).toBe('derived');
    expect(with_.model.aero.dragArea).toBeCloseTo(0.31 * 22 * SQFT, 12);
  });
});

/* ------------------------------------------------------------------ tyres and air */

describe('tyres', () => {
  it('a grip scale outside the category\'s range is held at its edge: a summer tyre never leaves 0.94 to 1.10', () => {
    const range = tyreGripScaleRange('summer');
    const cases: [number, number][] = [[1.5, 1.10], [0.5, 0.94], [1.04, 1.02 * 1.04]];
    for (const [scale, mu] of cases) {
      const s = blank('coupe'); s.tyreCategory = n('summer'); s.calibration.tyreGripScale = scale;
      const sheetLayout = resolveLayout(s);
      const t = resolveTyres(s, sheetLayout, {});
      expect(t.front.muY0, `scale ${scale}`).toBeCloseTo(mu, 12);
      expect(t.rear.muY0, `scale ${scale}`).toBeCloseTo(mu, 12);
      expect(t.gripScale).toBeGreaterThanOrEqual(range.min);
      expect(t.gripScale).toBeLessThanOrEqual(range.max);
    }
    const none = resolveTyres(blank('coupe'), resolveLayout(blank('coupe')), {});
    expect(none.front.muY0).toBe(TYRE_CATEGORY.summer.muY0);
  });

  it('a 225 mm, 0.66 m tyre is rated 4,000 N and its cornering stiffness is the category\'s 16 per rad of it', () => {
    const s = blank('sedan'); s.tyreFront = n('225/45R18'); s.tyreCategory = n('summer');
    const t = resolveTyres(s, resolveLayout(s), {});
    // 225/45R18: 0.330 m free radius, 0.660 m tall.
    expect(t.front.fz0).toBeCloseTo(4000 * (2 * (18 * 0.0254 / 2 + 0.225 * 0.45)) / 0.66, 9);
    expect(t.front.cAlpha0 / t.front.fz0).toBeCloseTo(16, 12);
    expect(t.rear.width).toBe(0.225);    // one axle's size on file stands for both
  });
});

describe('air', () => {
  it('a coast-down replaces Cd x area: C = 0.022 lbf/mph^2 is a drag area of 0.80 m^2, A and B become the road load and the tyres roll free', () => {
    const s = blank('suv');
    s.dragCoefficient = n(0.33); s.frontalAreaSqFt = n(28);
    s.roadLoadA = n(35); s.roadLoadB = n(0.15); s.roadLoadC = n(0.022);
    const { model, basis } = resolveModel(s);
    expect(model.aero.dragArea).toBeCloseTo(2 * 0.022 * LBF / (MPH * MPH) / RHO_AIR, 12);
    expect(model.aero.dragArea).toBeCloseTo(0.7995, 4);
    expect(model.aero.roadLoadA).toBeCloseTo(35 * 4.4482216152605, 9);       // 155.7 N
    expect(model.aero.roadLoadB).toBeCloseTo(0.15 * 4.4482216152605 / 0.44704, 9);   // 1.49 N per m/s
    expect(model.tyreFront.rollRes).toBe(0);
    expect(model.tyreRear.rollRes).toBe(0);
    expect(basis['aero.dragArea']).toBe('derived');
    expect(basis['tyreFront.rollRes']).toBe('derived');
    // The same car without its coast-down: Cd x area and the all-season tyre's 0.0085.
    s.roadLoadA = null; s.roadLoadB = null; s.roadLoadC = null;
    const plain = resolveModel(s).model;
    expect(plain.aero.dragArea).toBeCloseTo(0.33 * 28 * SQFT, 12);
    expect(plain.aero.roadLoadA).toBe(0);
    expect(plain.tyreFront.rollRes).toBe(0.0085);
  });

  it('with no drag figure a car takes its class\'s drag area: a pickup pushes twice the air of a sports car', () => {
    const truck = resolveModel(blank('pickup')).model.aero.dragArea, sports = resolveModel(blank('sports')).model.aero.dragArea;
    expect(truck).toBe(1.15);
    expect(sports).toBe(0.58);
  });
});

/* ------------------------------------------------------------------ brakes */

describe('brakes', () => {
  it('full pedal is worth at least 1.3 g on the car\'s own tyres, split by the layout: 70% front on a front-driver, 66% on a front-engined rear-driver, 60% behind a mid engine', () => {
    const cases: [PhysicsSheet, number][] = [[blank('sedan'), 0.70], [fullSheet(), 0.66], [(() => { const s = blank('sports'); s.engineLocation = n('mid'); return s; })(), 0.60]];
    for (const bc of BODY_CLASSES) cases.push([tableSheet(bc, 'AWD', TABLE[bc]), 0.68]);
    expect(cases.length).toBe(12);
    for (const [s, share] of cases) {
      const m = resolveModel(s).model;
      const front = 2 * m.brakes.maxTorqueFront / m.tyreFront.radius, rear = 2 * m.brakes.maxTorqueRear / m.tyreRear.radius;
      expect((front + rear) / (m.chassis.mass * G), s.id).toBeGreaterThanOrEqual(1.3 - 1e-12);
      expect(front / (front + rear), s.id).toBeCloseTo(share, 12);
    }
  });

  it('...and each axle can brake its tyres past their peak in the best stop their category allows, at either end of the bias a setup may set', () => {
    // The ideal stop on the stickiest tyres of the category (its top grip): every tyre at its peak, at the load the
    // stop moves forward (m a h / L), plus the wheels' own spin (2 J a / R^2). The front axle at the most rearward
    // bias (the class share less 0.06) and the rear at the most forward (plus 0.06) must give 1.15 times that.
    const street = ['all-season', 'summer', 'max-performance', 'all-terrain', 'winter'] as const;
    let checked = 0;
    for (const bc of BODY_CLASSES) {
      for (const drive of ['FWD', 'RWD', 'AWD'] as const) {
        for (const category of street) {
          const sheet = tableSheet(bc, drive, TABLE[bc]);
          sheet.tyreCategory = n(category);
          const m = resolveModel(sheet).model, c = m.chassis, L = c.a + c.b, top = TYRE_CATEGORY[category].muY0Max;
          const tf = { ...m.tyreFront, muY0: top }, tr = { ...m.tyreRear, muY0: top };
          let a = 10, needF = 0, needR = 0;
          for (let k = 0; k < 60; k++) {
            const zf = 0.5 * c.mass * (G * c.b + a * c.cgHeight) / L, zr = 0.5 * c.mass * (G * c.a - a * c.cgHeight) / L;
            needF = 2 * tyreMuX(tf, zf, 1) * zf; needR = zr > 0 ? 2 * tyreMuX(tr, zr, 1) * zr : 0;
            a = (needF + needR) / c.mass;
          }
          needF += 2 * m.wheelInertiaFront * a / m.tyreFront.radius ** 2;
          needR += 2 * m.wheelInertiaRear * a / m.tyreRear.radius ** 2;
          const front = 2 * m.brakes.maxTorqueFront / m.tyreFront.radius, rear = 2 * m.brakes.maxTorqueRear / m.tyreRear.radius;
          const total = front + rear, share = front / total, label = `${bc} ${drive} on ${category}`;
          expect(total * (share - 0.06), label).toBeGreaterThanOrEqual(1.15 * needF * (1 - 1e-12));
          expect(total * (1 - share - 0.06), label).toBeGreaterThanOrEqual(1.15 * needR * (1 - 1e-12));
          checked++;
        }
      }
    }
    expect(checked).toBe(9 * 3 * 5);
  });
});

/* ------------------------------------------------------------------ engine */

describe('the engine keeps its published peaks', () => {
  const engines: { label: string; set: (s: PhysicsSheet) => void; hp: number; lbft: number }[] = [
    { label: 'a 2.5 L four, 203 hp at 6,600 and 184 lb ft at 5,000', hp: 203, lbft: 184, set: (s) => { s.displacementL = n(2.5); s.cylinders = n(4); s.induction = n('natural'); s.horsepower = n(203); s.horsepowerRpm = n(6600); s.torqueLbFt = n(184); s.torqueRpmLow = n(5000); s.redlineRpm = n(6800); } },
    { label: 'a 2.0 L turbo four, 241 hp at 6,500 and 273 lb ft from 1,750 to 4,500', hp: 241, lbft: 273, set: (s) => { s.displacementL = n(2.0); s.cylinders = n(4); s.induction = n('turbo'); s.horsepower = n(241); s.horsepowerRpm = n(6500); s.torqueLbFt = n(273); s.torqueRpmLow = n(1750); s.torqueRpmHigh = n(4500); s.redlineRpm = n(6800); } },
    { label: 'a 6.2 L supercharged V8, 650 hp at 6,400 and 650 lb ft at 4,800', hp: 650, lbft: 650, set: (s) => { s.displacementL = n(6.2); s.cylinders = n(8); s.induction = n('supercharged'); s.horsepower = n(650); s.horsepowerRpm = n(6400); s.torqueLbFt = n(650); s.torqueRpmLow = n(4800); s.redlineRpm = n(6600); } },
    { label: 'a 3.0 L turbo diesel V6, 260 hp at 3,600 and 480 lb ft at 1,600', hp: 260, lbft: 480, set: (s) => { s.powertrain = n('diesel'); s.displacementL = n(3.0); s.cylinders = n(6); s.horsepower = n(260); s.horsepowerRpm = n(3600); s.torqueLbFt = n(480); s.torqueRpmLow = n(1600); s.redlineRpm = n(4800); } },
    { label: 'an electric motor, 283 hp and 307 lb ft', hp: 283, lbft: 307, set: (s) => { s.powertrain = n('electric'); s.horsepower = n(283); s.torqueLbFt = n(307); s.redlineRpm = n(16000); } },
    { label: 'the full sheet\'s 3.0 L turbo six', hp: 400, lbft: 380, set: () => undefined },
  ];
  for (const e of engines) {
    it(`${e.label}: both peaks within 0.5%`, () => {
      const s = e.label.startsWith('the full') ? fullSheet() : blank('sedan');
      e.set(s);
      const p = enginePeaks(resolveModel(s).model.engine);
      expect(Math.abs(p.power / (e.hp * HP) - 1)).toBeLessThan(0.005);
      expect(Math.abs(p.torque / (e.lbft * LBFT) - 1)).toBeLessThan(0.005);
      if (s.horsepowerRpm !== null) expect(Math.abs(p.powerOmega / (s.horsepowerRpm.value * RPM) - 1)).toBeLessThan(0.02);
    });
  }

  it('without a torque figure, the displacement at a typical mean effective pressure: a 2.5 L four makes about 245 N m, a 5.3 L V8 about 515', () => {
    const four = tableSheet('sedan', 'FWD', { hp: 203, lb: 3300, litres: 2.5, cyl: 4, induction: 'natural', mph: 130 });
    const v8 = tableSheet('pickup', 'RWD', { hp: 355, lb: 4900, litres: 5.3, cyl: 8, induction: 'natural', mph: 110 });
    const t4 = enginePeaks(resolveModel(four).model.engine).torque, t8 = enginePeaks(resolveModel(v8).model.engine).torque;
    expect(t4).toBeGreaterThan(235); expect(t4).toBeLessThan(265);
    expect(t8).toBeGreaterThan(495); expect(t8).toBeLessThan(540);
  });

  it('a diesel drags harder on a closed throttle than a petrol engine of the same size, at the same full-throttle curve', () => {
    const make = (pt: Powertrain): VehicleModel => {
      const s = blank('pickup'); s.powertrain = n(pt); s.induction = n('turbo'); s.displacementL = n(3.0); s.cylinders = n(6);
      s.horsepower = n(260); s.horsepowerRpm = n(3600); s.torqueLbFt = n(480); s.torqueRpmLow = n(1600); s.redlineRpm = n(4800);
      return resolveModel(s).model;
    };
    const diesel = make('diesel'), petrol = make('gasoline');
    const w = 3000 * RPM;
    expect(-engineTorque(diesel.engine, w, 0, 0)).toBeGreaterThan(1.2 * -engineTorque(petrol.engine, w, 0, 0));
    const pd = enginePeaks(diesel.engine), pp = enginePeaks(petrol.engine);
    expect(Math.abs(pd.power / pp.power - 1)).toBeLessThan(1e-6);
    expect(Math.abs(pd.torque / pp.torque - 1)).toBeLessThan(1e-6);
  });

  it('a drawn car\'s authored curve is the engine, its peaks read off it', () => {
    const s = blank('coupe');
    s.torqueCurve = n<[number, number][]>([[1000, 175], [2500, 222], [4000, 252], [5500, 258], [6500, 242], [7400, 210]]);
    s.redlineRpm = n(7300);
    const m = resolveModel(s).model;
    expect(m.engine.kind).toBe('na');
    expect(m.engine.air).toBeNull();
    const p = enginePeaks(m.engine);
    expect(p.torque).toBeCloseTo(258, 6);
    expect(p.torqueOmega).toBeCloseTo(5500 * RPM, 0);
  });
});

/* ------------------------------------------------------------------ driveline */

describe('the driveline', () => {
  it('a hybrid is its system power through an eCVT, one unboosted engine moving off on its motor', () => {
    const m = resolveModel(tableSheet('hatchback', 'FWD', { hp: 121, lb: 3050, litres: 1.8, cyl: 4, powertrain: 'hybrid', mph: 112 })).model;
    expect(m.engine.kind).toBe('na');
    expect(m.driveline.transmission).toBe('ecvt');
    expect(m.driveline.launch).toBe('direct');
    expect(m.driveline.gears.length).toBe(2);
    expect(Math.abs(enginePeaks(m.engine).power / (121 * HP) - 1)).toBeLessThan(0.005);
  });

  it('an electric car has one reduction, joined direct, its motor under 88% of top speed at its 130 mph governor, and its axles driven by the weight each carries', () => {
    const m = resolveModel(tableSheet('sedan', 'AWD', { hp: 350, lb: 4300, powertrain: 'electric', mph: 130 })).model;
    const d = m.driveline;
    expect(m.engine.kind).toBe('electric');
    expect(d.transmission).toBe('single-speed');
    expect(d.launch).toBe('direct');
    expect(Array.from(d.gears)).toEqual([1]);
    expect(d.centre.kind).toBe('fixed');
    expect(d.centre.frontShare).toBeCloseTo(m.chassis.b / m.chassis.wheelbase, 12);
    const motorAtGovernor = 130 * MPH / m.tyreFront.radius * d.gears[0] * d.finalDrive;
    expect(motorAtGovernor / m.engine.redline).toBeLessThanOrEqual(0.88 + 1e-12);
    expect(d.finalDrive).toBeGreaterThan(5);
    expect(d.finalDrive).toBeLessThanOrEqual(9);
  });

  it('a governed car reaches its governor in top gear below redline; the gears step geometrically over the box\'s usual spread', () => {
    let count = 0;
    for (const bc of BODY_CLASSES) {
      const m = resolveModel(tableSheet(bc, 'RWD', TABLE[bc])).model;
      const d = m.driveline, g = d.gears;
      if (d.transmission !== 'automatic' && d.transmission !== 'dual-clutch' && d.transmission !== 'manual') continue;
      const top = g[g.length - 1];
      const engineAtGovernor = m.systems.limiterSpeed / m.tyreRear.radius * top * d.finalDrive;
      expect(engineAtGovernor / m.engine.redline, bc).toBeLessThanOrEqual(0.95 + 1e-12);
      // An eight-speed automatic spans 7 to 1 from first to top, a seven-speed dual-clutch 6 to 1, every step the same.
      expect(g.length, bc).toBe(d.transmission === 'automatic' ? 8 : 7);
      expect(g[0] / top, bc).toBeCloseTo(d.transmission === 'automatic' ? 7.0 : 6.0, 9);
      for (let i = 1; i < g.length - 1; i++) expect(g[i - 1] / g[i], bc).toBeCloseTo(g[i] / g[i + 1], 9);
      count++;
    }
    expect(count).toBe(9);
  });

  it('an ungoverned car is geared to make its top speed with the engine near its power peak', () => {
    const s = fullSheet();
    s.gearRatios = null; s.finalDriveRatio = null; s.topSpeedGoverned = n(false);
    const { model: m } = resolveModel(s);
    const d = m.driveline;
    const v = powerLimitedSpeed(d.efficiency * enginePeaks(m.engine).power, m.chassis, resolveTyres(s, resolveLayout(s), {}), m.aero);
    // 400 hp against 0.64 m^2 of drag: about 180 mph.
    expect(v / MPH).toBeGreaterThan(165);
    expect(v / MPH).toBeLessThan(195);
    const engine = v / m.tyreRear.radius * d.gears[d.gears.length - 1] * d.finalDrive;
    expect(Math.abs(engine / enginePeaks(m.engine).powerOmega - 1)).toBeLessThan(0.05);
    expect(engine).toBeLessThan(m.engine.redline);
    expect(m.systems.limiterSpeed).toBe(Infinity);
  });

  it('a CVT with no ratios on file spans 6.5 to 1, its highest ratio tall enough for the power peak at top speed, behind a converter that locks at once', () => {
    const s = tableSheet('suv', 'FWD', TABLE.suv); s.transmissionType = n('cvt');
    const d = resolveModel(s).model.driveline;
    expect(d.gears.length).toBe(2);
    expect(d.gears[0] / d.gears[1]).toBeCloseTo(6.5, 12);
    expect(d.gears[1]).toBeLessThanOrEqual(0.8);
    expect(d.launch).toBe('converter');
    expect(d.converter?.lockGear).toBe(1);
  });

  it('a pickup\'s automatic stalls at 2,000 rpm and multiplies 2.0; a sedan\'s at 2,300 rpm and 1.9', () => {
    const truck = resolveModel(tableSheet('pickup', 'RWD', TABLE.pickup)).model.driveline.converter;
    const sedan = resolveModel(tableSheet('sedan', 'FWD', TABLE.sedan)).model.driveline.converter;
    expect(truck?.stallOmega).toBeCloseTo(2000 * RPM, 12);
    expect(truck?.torqueRatio).toBe(2.0);
    expect(sedan?.stallOmega).toBeCloseTo(2300 * RPM, 12);
    expect(sedan?.torqueRatio).toBe(1.9);
  });

  it('all-wheel drive by layout: a transverse sedan is front-driven with a coupling, a coupe rear-driven with one, a 4WD truck locked, a fixed split as the sheet says', () => {
    const sedan = resolveModel(tableSheet('sedan', 'AWD', TABLE.sedan)).model.driveline.centre;
    expect(sedan).toEqual({ kind: 'coupling', frontShare: 1, lockTorque: 2000 });
    const coupe = resolveModel(tableSheet('coupe', 'AWD', TABLE.coupe)).model.driveline.centre;
    expect(coupe).toEqual({ kind: 'coupling', frontShare: 0, lockTorque: 2000 });
    const truck = resolveModel(tableSheet('pickup', '4WD', TABLE.pickup)).model.driveline.centre;
    expect(truck).toEqual({ kind: 'coupling', frontShare: 0, lockTorque: Infinity });
    const fixed = tableSheet('wagon', 'AWD', TABLE.wagon); fixed.awdKind = n('fixed');
    expect(resolveModel(fixed).model.driveline.centre).toEqual({ kind: 'fixed', frontShare: 0.4, lockTorque: 0 });
    // Two-wheel drive has no centre, and AWD loses 4 points of efficiency.
    const two = resolveModel(tableSheet('sedan', 'FWD', TABLE.sedan)).model.driveline;
    expect(two.centre.kind).toBe('none');
    expect(two.efficiency - resolveModel(tableSheet('sedan', 'AWD', TABLE.sedan)).model.driveline.efficiency).toBeCloseTo(0.04, 12);
  });

  it('a limited-slip rear on a sports car and a 460 hp coupe; open on a 300 hp coupe, a sedan and what the sheet says is open', () => {
    const rear = (s: PhysicsSheet): string => resolveModel(s).model.driveline.diffRear.kind;
    expect(rear(tableSheet('sports', 'RWD', TABLE.sports))).toBe('limited-slip');
    expect(rear(tableSheet('coupe', 'RWD', TABLE.coupe))).toBe('limited-slip');
    expect(rear(tableSheet('coupe', 'RWD', { hp: 300, lb: 3550, litres: 2.3, cyl: 4, induction: 'turbo', mph: 155 }))).toBe('open');
    expect(rear(tableSheet('sedan', 'RWD', TABLE.sedan))).toBe('open');
    expect(rear(fullSheet())).toBe('open');
    const lsd = resolveModel(tableSheet('sports', 'RWD', TABLE.sports)).model.driveline.diffRear;
    expect(lsd.preload).toBe(60);      // a street limited-slip: torque bias ratio 1.67
    expect(lsd.lockPerTorque).toBe(0.25);
  });

  it('the clutch holds 1.6 times the engine\'s peak torque', () => {
    const m = resolveModel(fullSheet()).model;
    expect(m.driveline.clutchCapacity / enginePeaks(m.engine).torque).toBeCloseTo(1.6, 12);
  });
});

/* ------------------------------------------------------------------ systems */

describe('the car\'s own systems', () => {
  it('ABS, traction and stability control are fitted from the 2012 model year unless the sheet says otherwise', () => {
    const old = resolveModel(blank('sedan', 2011)).model.systems, current = resolveModel(blank('sedan', 2012)).model.systems;
    expect([old.abs, old.tcs, old.esc]).toEqual([false, false, false]);
    expect([current.abs, current.tcs, current.esc]).toEqual([true, true, true]);
    const said = blank('sedan', 2018); said.stabilityControl = n(false);
    expect(resolveModel(said).model.systems.esc).toBe(false);
  });

  it('the governor: as published when the sheet says governed; none when it says not; a family car\'s rated 120 mph taken as its governor, a coupe\'s 196 mph as the air\'s', () => {
    const governed = blank('sedan'); governed.topSpeedMph = n(124); governed.topSpeedGoverned = n(true);
    expect(resolveModel(governed).model.systems.limiterSpeed).toBeCloseTo(124 * MPH, 12);
    const free = blank('sedan'); free.topSpeedMph = n(124); free.topSpeedGoverned = n(false);
    expect(resolveModel(free).model.systems.limiterSpeed).toBe(Infinity);
    const family = blank('sedan'); family.topSpeedMph = n(120);
    expect(resolveModel(family).model.systems.limiterSpeed).toBeCloseTo(120 * MPH, 12);
    const fast = blank('coupe'); fast.topSpeedMph = n(196); fast.horsepower = n(600); fast.curbWeightLb = n(3900);
    expect(resolveModel(fast).model.systems.limiterSpeed).toBe(Infinity);
    expect(resolveModel(blank('sports')).model.systems.limiterSpeed).toBe(Infinity);
    expect(resolveModel(blank('pickup')).model.systems.limiterSpeed).toBeCloseTo(110 * MPH, 12);
  });
});

/* ------------------------------------------------------------------ setup */

describe('a build\'s setup', () => {
  it('scales bars, springs, dampers and final drive, adds lift area, shares the brakes anew at the same total, and lowers the body', () => {
    // A front-drive sedan with its weight, centre-of-gravity height and final drive on file: both axles carry a bar.
    const sheet = (): PhysicsSheet => { const s = tableSheet('sedan', 'FWD', TABLE.sedan); s.cgHeightIn = n(22); s.finalDriveRatio = n(3.5); return s; };
    const stock = resolveModel(sheet()).model;
    expect(stock.chassis.arbFront).toBeGreaterThan(1000);
    expect(stock.chassis.arbRear).toBeGreaterThan(1000);
    const { model: m, basis } = resolveModel(sheet(), {
      parts: [], setup: { arbFront: 1.3, arbRear: 0.8, springFront: 1.2, springRear: 1.1, damperFront: 1.25, damperRear: 1.15, finalDrive: 1.1, aeroFront: -0.1, aeroRear: -0.18, brakeBias: 0.6, rideHeightDrop: 0.025 },
    });
    const c = m.chassis, c0 = stock.chassis;
    expect(c.arbFront / c0.arbFront).toBeCloseTo(1.3, 12);
    expect(c.arbRear / c0.arbRear).toBeCloseTo(0.8, 12);
    expect(c.springFront / c0.springFront).toBeCloseTo(1.2, 12);
    expect(c.springRear / c0.springRear).toBeCloseTo(1.1, 12);
    expect(c.damperFront / c0.damperFront).toBeCloseTo(1.25, 12);
    expect(c.damperRear / c0.damperRear).toBeCloseTo(1.15, 12);
    expect(m.driveline.finalDrive).toBeCloseTo(3.5 * 1.1, 12);
    expect(m.aero.liftAreaFront).toBeCloseTo(stock.aero.liftAreaFront - 0.1, 12);
    expect(m.aero.liftAreaRear).toBeCloseTo(stock.aero.liftAreaRear - 0.18, 12);
    const front = 2 * m.brakes.maxTorqueFront / m.tyreFront.radius, rear = 2 * m.brakes.maxTorqueRear / m.tyreRear.radius;
    const total0 = 2 * stock.brakes.maxTorqueFront / stock.tyreFront.radius + 2 * stock.brakes.maxTorqueRear / stock.tyreRear.radius;
    expect(front / (front + rear)).toBeCloseTo(0.6, 12);
    expect((front + rear) / total0).toBeCloseTo(1, 12);
    // 25 mm off the body lowers the whole car's centre of gravity by the sprung share of it, about 22 mm.
    expect(c0.sprungCgHeight - c.sprungCgHeight).toBeCloseTo(0.025, 12);
    expect(c0.cgHeight - c.cgHeight).toBeCloseTo(0.025 * c.sprungMass / c.mass, 12);
    const moment = c.sprungMass * c.sprungCgHeight + c.unsprungFront * c.unsprungHeightFront + c.unsprungRear * c.unsprungHeightRear;
    expect(Math.abs(moment / (c.mass * c.cgHeight) - 1)).toBeLessThan(1e-12);
    expect(basis['chassis.cgHeight']).toBe('derived');        // a sourced height moved by a stated rule
    expect(basis['driveline.finalDrive']).toBe('derived');
    expect(basis['chassis.springFront']).toBe('estimated');
  });

  it('a setup that changes nothing leaves the car as it was, and applySetup never touches the class tables', () => {
    const a = resolveModel(fullSheet()).model, b = resolveModel(fullSheet(), { parts: [], setup: {} }).model;
    expect(numbers(b, '', [])).toEqual(numbers(a, '', []));
    const m = resolveModel(blank('sedan')).model;
    expect(() => applySetup(m, { springFront: 2, arbRear: 2 }, {})).not.toThrow();
    expect(resolveModel(blank('sedan')).model.chassis.springFront).toBeCloseTo(m.chassis.springFront / 2, 9);
  });
});

/* ------------------------------------------------------------------ determinism */

describe('the resolver is deterministic', () => {
  it('the same sheet twice gives the same bits in every number, and the sheet is left as it was', () => {
    const sheets = [fullSheet(), ...BODY_CLASSES.map((c) => tableSheet(c, '4WD', TABLE[c])), blank('offroad')];
    let compared = 0;
    for (const s of sheets) {
      const before = JSON.stringify(s);
      const one = resolveModel(s), two = resolveModel(s);
      const x = numbers(one.model, '', []), y = numbers(two.model, '', []);
      expect(x.length, s.id).toBe(y.length);
      expect(x.length, s.id).toBeGreaterThan(300);
      for (let i = 0; i < x.length; i++) {
        expect(x[i][0]).toBe(y[i][0]);
        expect(Object.is(x[i][1], y[i][1]), x[i][0]).toBe(true);
        compared++;
      }
      expect(two.basis).toEqual(one.basis);
      expect(JSON.stringify(s), s.id).toBe(before);
    }
    expect(compared).toBeGreaterThan(3000);
  });

  it('two resolved models share no mutable piece, so a part fitted to one never reaches the other', () => {
    const a = resolveModel(blank('coupe')).model, b = resolveModel(blank('coupe')).model;
    a.chassis.springFront *= 2; a.driveline.diffRear.preload = 999; a.driveline.centre.lockTorque = 5;
    a.engine.wot[10] = 0; if (a.driveline.converter !== null) a.driveline.converter.stallOmega = 1;
    expect(b.chassis.springFront).not.toBe(a.chassis.springFront);
    expect(b.driveline.diffRear.preload).not.toBe(999);
    expect(b.driveline.centre.lockTorque).not.toBe(5);
    expect(b.engine.wot[10]).toBeGreaterThan(0);
    expect(b.driveline.converter?.stallOmega).toBeGreaterThan(100);
  });
});

