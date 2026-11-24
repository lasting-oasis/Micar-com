// The parts catalogue and builds (DESIGN.md 11) on the four proof cars (golden.ts) and the GT-R's researched sheet:
// an empty build is no build; the order parts are listed in changes nothing; every part changes exactly the physical
// numbers its row names, by the row's amounts; the refusals; then, on the bench, what a tuner expects of the parts,
// each range stated with its reason before it is run; and every Garage build carries over to a finite car.
import { describe, expect, it } from 'vitest';
import type { Build, PhysicsSheet, Setup, VehicleModel } from './types';
import { DRIVER_MASS, LOADED_RADIUS_RATIO, TYRE_CATEGORY, tyreReferenceLoad } from './classes';
import { sheetById } from './data/sheets';
import { circleDriver, worstDrivenSlip } from './drivers';
import { boostStep, enginePeaks, engineTorque } from './engine';
import { goldenLog, proofSheet } from './golden';
import { G, P_AMBIENT, PI } from './math';
import { PARTS, buildCardMods, describeBuild, fits, legacyBuild, partById } from './parts';
import { resolveModel } from './resolve';
import { runBench, setRolling, skidpadAt } from './bench';
import { emptySheet } from './sheet';
import { FLAT, defaultControls } from './state';
import { HP, MPH, PSI, RPM } from './units';
import { createVehicle, step } from './vehicle';

const GTR = '2024-nissan-gt-r-nismo';
const CARS = ['sedan', 'sports', 'coupe', 'pickup', 'gtr'] as const;
type Car = (typeof CARS)[number];

function sheetOf(car: Car): PhysicsSheet {
  if (car !== 'gtr') return proofSheet(car);
  const s = sheetById(GTR);
  if (s === null) throw new Error('the GT-R sheet is missing');
  return s;
}

function build(ids: readonly string[], setup: Setup = {}): Build {
  return { parts: ids.map((id) => ({ id })), setup };
}

function fitted(sheet: PhysicsSheet, ids: readonly string[], setup: Setup = {}): VehicleModel {
  return resolveModel(sheet, build(ids, setup)).model;
}

/** Every value in a model by its path: numbers, table entries, kinds and nulls. */
function flat(x: unknown, key = '', out = new Map<string, unknown>()): Map<string, unknown> {
  if (x instanceof Float64Array) x.forEach((v, i) => out.set(`${key}.${i}`, v));
  else if (Array.isArray(x)) x.forEach((v, i) => flat(v, `${key}.${i}`, out));
  else if (x !== null && typeof x === 'object') for (const k of Object.keys(x).sort()) flat((x as Record<string, unknown>)[k], key === '' ? k : `${key}.${k}`, out);
  else out.set(key, x);
  return out;
}

/** The paths whose values differ between two models (a value that appears or goes counts). */
function changed(a: VehicleModel, b: VehicleModel): string[] {
  const fa = flat(a), fb = flat(b), out: string[] = [];
  for (const k of new Set([...fa.keys(), ...fb.keys()])) if (!Object.is(fa.get(k), fb.get(k))) out.push(k);
  return out.sort();
}

function sameBits(a: VehicleModel, b: VehicleModel): void {
  const fa = flat(a), fb = flat(b);
  expect([...fb.keys()]).toEqual([...fa.keys()]);
  let n = 0;
  for (const [k, v] of fa) { expect(Object.is(fb.get(k), v), k).toBe(true); n++; }
  expect(n).toBeGreaterThan(300);
}

const peakHp = (m: VehicleModel): number => runBench(m, 'dyno').peakHp;

/* ------------------------------------------------------------------ builds and the stock car */

describe('a build fits on the stock car without disturbing it', () => {
  it('an empty build gives the same model, bit for bit, as no build, on every proof car and the GT-R', () => {
    for (const car of CARS) {
      const stock = resolveModel(sheetOf(car)).model;
      sameBits(stock, resolveModel(sheetOf(car), { parts: [], setup: {} }).model);
      // Tier 0 everywhere and every slider centred is the car as delivered.
      const garage = legacyBuild({ engine: 0, ecu: 0, turbo: 0, trans: 0, susp: 0, nos: 0, tires: 0, brakes: 0, weight: 0 }, { turbo: 0, nitrous: 0, aero: 0, bias: 0, ride: 0, stiff: 0, steer: 0, gears: 0 }, sheetOf(car));
      expect(garage).toEqual({ parts: [], setup: {} });
      sameBits(stock, resolveModel(sheetOf(car), garage).model);
    }
  });

  it('the order the parts are listed in changes nothing: they go on in the catalogue\'s order', () => {
    const lists: Record<Car, string[]> = {
      sedan: ['weight-2', 'tune-2', 'intake-1', 'exhaust-1', 'springs-2', 'tyres-max-performance', 'brakes-2', 'aero-rear-1', 'lsd-1', 'tyres-wide-1', 'nitrous-1'],
      sports: ['aero-front-2', 'cams-2', 'turbo-kit-2', 'exhaust-2', 'tune-1', 'arb-2', 'weight-3', 'tyres-track', 'clutch-2', 'gearbox-1'],
      coupe: ['supercharger-kit-2', 'intake-1', 'shifter-1', 'gearbox-2', 'lsd-2', 'tyres-wide-1', 'tyres-track', 'wheels-light-1', 'brakes-3', 'springs-3'],
      pickup: ['tune-3', 'fuel-1', 'intercooler-1', 'turbo-upgrade-2', 'exhaust-2', 'tyres-summer', 'weight-1', 'arb-1', 'brakes-1', 'flywheel-1'],
      gtr: ['tune-2', 'exhaust-2', 'exhaust-1', 'intake-1', 'turbo-upgrade-1', 'weight-2', 'tyres-track', 'springs-1', 'aero-rear-2', 'nitrous-3'],
    };
    for (const car of CARS) {
      const ids = lists[car];
      const forward = fitted(sheetOf(car), ids);
      const report = describeBuild(sheetOf(car), build(ids));
      expect(report.parts.filter((p) => !p.fitted).map((p) => `${p.id}: ${p.reason}`), car).toEqual([]);
      // Reversed, and every rotation: always the same bits.
      sameBits(forward, fitted(sheetOf(car), [...ids].reverse()));
      for (let k = 1; k < ids.length; k++) sameBits(forward, fitted(sheetOf(car), [...ids.slice(k), ...ids.slice(0, k)]));
      // And not the stock car: the parts did something.
      expect(changed(resolveModel(sheetOf(car)).model, forward).length, car).toBeGreaterThan(20);
    }
  });

  it('a build never touches the sheet it is fitted to, and two builds share nothing', () => {
    const s = proofSheet('coupe'), before = JSON.stringify(s);
    const a = fitted(s, ['turbo-kit-2', 'tyres-track', 'weight-3']);
    expect(JSON.stringify(s)).toBe(before);
    const b = fitted(s, ['turbo-kit-2', 'tyres-track', 'weight-3']);
    (a.engine.air as NonNullable<typeof a.engine.air>).pressureRatio[40] = 9;
    a.chassis.mass = 1;
    expect(b.engine.air?.pressureRatio[40]).not.toBe(9);
    expect(b.chassis.mass).toBeGreaterThan(1000);
  });
});

/* ------------------------------------------------------------------ each part's row, exactly */

type Model = VehicleModel;
type Key = string | RegExp;

const TABLES: Key[] = [/^engine\.(wot|offBoost)\.\d+$/];
const SPECIFIC: Key = /^engine\.air\.specific\.\d+$/;
const PRESSURE: Key = /^engine\.air\.pressureRatio\.\d+$/;
const REDLINE: Key[] = ['engine.redline', 'engine.limiterBand'];
const BODY: Key[] = ['chassis.mass', 'chassis.sprungMass', 'chassis.cgHeight', 'chassis.izz', 'chassis.ixx', 'chassis.iyy'];
const SPLIT: Key[] = ['chassis.a', 'chassis.b'];
const TYRES: Key[] = [/^tyre(Front|Rear)\./, 'brakes.maxTorqueFront', 'brakes.maxTorqueRear'];

/** Speed over the stock redline at table point i: the x of section 11's breathing curves. */
const xOf = (stock: Model, i: number): number => i * stock.engine.dOmega / stock.engine.redline;

function breathing(stock: Model, a: Model, b: Model, gain: (x: number) => number): void {
  const s0 = a.engine.air?.specific, s1 = b.engine.air?.specific;
  if (s0 === undefined || s1 === undefined) throw new Error('no air model');
  for (let i = 1; i < s0.length; i++) expect(s1[i] / s0[i], `point ${i}`).toBeCloseTo(gain(xOf(stock, i)), 12);
}

/** kg added (negative: taken off) and where: share of it on the front axle, or 'centre' for none moving the split. */
function massAdded(a: Model, b: Model, kg: number, front: number | 'centre'): void {
  const ca = a.chassis, cb = b.chassis;
  expect(cb.mass - ca.mass).toBeCloseTo(kg, 9);
  if (front === 'centre') { expect(cb.a).toBe(ca.a); expect(cb.b).toBe(ca.b); return; }
  const frontLoad = (c: typeof ca): number => c.mass * c.b / c.wheelbase;
  expect(frontLoad(cb) - frontLoad(ca)).toBeCloseTo(kg * front, 6);
}

/** A corner's sprung mass, ride frequency (Hz) and damping ratio, as a suspension engineer works them out. */
function ride(m: Model, front: boolean): { hz: number; zeta: number } {
  const c = m.chassis, share = c.b / c.wheelbase;
  const corner = 0.5 * (front ? c.mass * share - c.unsprungFront : c.mass * (1 - share) - c.unsprungRear);
  const k = front ? c.springFront : c.springRear, d = front ? c.damperFront : c.damperRear;
  return { hz: Math.sqrt(k / corner) / (2 * PI), zeta: d / (2 * Math.sqrt(k * corner)) };
}

type PartCase = { id: string; car: Car; base?: string[]; keys: Key[]; amounts: (stock: Model, a: Model, b: Model) => void };

const kit = (psi: number) => (stock: Model, a: Model, b: Model): void => {
  const air = b.engine.air;
  if (air === null) throw new Error('no air model');
  expect(b.engine.kind).toBe('turbo');
  expect(Math.max(...air.pressureRatio)).toBeCloseTo(1 + psi * PSI / P_AMBIENT, 12);
  expect(air.intercooler).toBe(0.7);
  expect(air.compressorEff).toBe(0.72);
  expect(air.blowerDrive).toBe(0);
  expect(b.engine.boost?.tauRef).toBe(0.45);
  // No boost at idle; full boost by half the stock redline.
  expect(air.pressureRatio[Math.floor(stock.engine.idle / stock.engine.dOmega)]).toBe(1);
  expect(air.pressureRatio[Math.ceil(0.5 * stock.engine.redline / stock.engine.dOmega)]).toBeCloseTo(1 + psi * PSI / P_AMBIENT, 12);
  expect(Number.isFinite(air.maxAirflow)).toBe(true);
  massAdded(a, b, psi === 6 ? 22 : psi === 9 ? 28 : 35, 1);   // on the front engine, at the front axle
};

const blower = (psi: number, kg: number) => (stock: Model, a: Model, b: Model): void => {
  const air = b.engine.air;
  if (air === null) throw new Error('no air model');
  const gauge = psi * PSI / P_AMBIENT;
  expect(b.engine.kind).toBe('supercharged');
  expect(b.engine.boost).toBeNull();
  expect(Math.max(...air.pressureRatio)).toBeCloseTo(1 + gauge, 12);
  // Six tenths of its boost at idle already, and growing with speed.
  expect(air.pressureRatio[Math.floor(stock.engine.idle / stock.engine.dOmega)]).toBeCloseTo(1 + 0.6 * gauge, 12);
  expect(air.blowerDrive).toBe(0.12);
  expect(air.intercooler).toBe(0.7);
  massAdded(a, b, kg, 1);
};

const upgrade = (airflow: number, lag: number, later: number, kg: number) => (_s: Model, a: Model, b: Model): void => {
  const a0 = a.engine.air, b0 = b.engine.air;
  if (a0 === null || b0 === null) throw new Error('no air model');
  expect(b0.maxAirflow / a0.maxAirflow).toBeCloseTo(airflow, 12);
  expect((b.engine.boost?.tauRef ?? 0) / (a.engine.boost?.tauRef ?? 1)).toBeCloseTo(lag, 12);
  // The speed where boost first reaches half its peak moves up by `later` (within a table step).
  const half = (pr: Float64Array): number => {
    const target = 1 + 0.5 * (Math.max(...pr) - 1);
    for (let i = 1; i < pr.length; i++) if (pr[i] >= target) return (i - 1 + (target - pr[i - 1]) / (pr[i] - pr[i - 1])) * a.engine.dOmega;
    return NaN;
  };
  expect(Math.abs(half(b0.pressureRatio) / half(a0.pressureRatio) - later)).toBeLessThan(0.02);
  expect(Math.max(...b0.pressureRatio)).toBe(Math.max(...a0.pressureRatio));   // the same boost, later
  massAdded(a, b, kg, 1);
};

const tuneNa = (k: number, rpm: number) => (stock: Model, a: Model, b: Model): void => {
  breathing(stock, a, b, () => k);
  expect((b.engine.redline - a.engine.redline) / RPM).toBeCloseTo(rpm, 9);
};

const tuneBoost = (add: number) => (_s: Model, a: Model, b: Model): void => {
  const p0 = a.engine.air?.pressureRatio, p1 = b.engine.air?.pressureRatio;
  if (p0 === undefined || p1 === undefined) throw new Error('no air model');
  const g0 = Math.max(...p0) - 1;
  expect(Math.max(...p1) - 1 - g0).toBeCloseTo(add, 12);                     // the peak raised by so much of an atmosphere
  for (let i = 0; i < p0.length; i++) expect((p1[i] - 1) * g0).toBeCloseTo((p0[i] - 1) * (g0 + add), 12);   // the same shape
  expect(b.engine.redline).toBe(a.engine.redline);
};

const categoryOf = (cat: keyof typeof TYRE_CATEGORY) => (_s: Model, a: Model, b: Model): void => {
  const t = TYRE_CATEGORY[cat];
  for (const axle of ['tyreFront', 'tyreRear'] as const) {
    const before = a[axle], after = b[axle];
    expect(after.muY0).toBeCloseTo(t.muY0, 12);   // the proof cars are not calibrated: grip scale 1
    expect([after.muXRatio, after.loadSens, after.slideRatio, after.slideFall, after.cKappaPerFz, after.relaxLat, after.relaxLong, after.rollRes])
      .toEqual([t.muXRatio, t.loadSens, t.slideRatio, t.slideFall, t.cKappaPerFz, t.relaxLat, t.relaxLong, t.rollRes]);
    expect(after.cAlpha0 / after.fz0).toBeCloseTo(t.cAlphaPerFz, 9);
    expect([after.radius, after.width, after.fz0]).toEqual([before.radius, before.width, before.fz0]);   // the same size
  }
};

const springs = (f: number, dz: number, drop: number) => (stock: Model, a: Model, b: Model): void => {
  for (const front of [true, false]) {
    const r0 = ride(stock, front), r1 = ride(b, front);
    expect(r1.hz / r0.hz).toBeCloseTo(f, 9);
    expect(r1.zeta - r0.zeta).toBeCloseTo(dz, 9);
  }
  expect(a.chassis.sprungCgHeight - b.chassis.sprungCgHeight).toBeCloseTo(drop, 12);
  expect(b.chassis.mass).toBe(a.chassis.mass);
};

const weight = (share: number, points: number) => (_s: Model, a: Model, b: Model): void => {
  expect((b.chassis.mass - DRIVER_MASS) / (a.chassis.mass - DRIVER_MASS)).toBeCloseTo(1 - share, 12);
  expect(b.chassis.unsprungFront + b.chassis.unsprungRear).toBe(a.chassis.unsprungFront + a.chassis.unsprungRear);
  expect(b.chassis.b / b.chassis.wheelbase - a.chassis.b / a.chassis.wheelbase).toBeCloseTo(points, 12);
};

const brakes = (k: number, kgPerCorner: number) => (_s: Model, a: Model, b: Model): void => {
  expect(b.brakes.maxTorqueFront / a.brakes.maxTorqueFront).toBeCloseTo(k, 12);
  expect(b.brakes.maxTorqueRear / a.brakes.maxTorqueRear).toBeCloseTo(k, 12);
  expect(b.chassis.unsprungFront - a.chassis.unsprungFront).toBeCloseTo(2 * kgPerCorner, 12);
  expect(b.chassis.sprungMass).toBe(a.chassis.sprungMass);
};

const aero = (axle: 'front' | 'rear', lift: number, drag: number, kg: number) => (_s: Model, a: Model, b: Model): void => {
  const key = axle === 'front' ? 'liftAreaFront' : 'liftAreaRear';
  expect(b.aero[key] - a.aero[key]).toBeCloseTo(lift, 12);
  expect(b.aero.dragArea - a.aero.dragArea).toBeCloseTo(drag, 12);
  massAdded(a, b, kg, axle === 'front' ? 1 : 0);
};

const nitrous = (hp: number) => (_s: Model, a: Model, b: Model): void => {
  expect(a.nitrous).toBeNull();
  expect(b.nitrous?.power).toBeCloseTo(hp * HP, 9);
  expect(b.nitrous?.bottleMass).toBe(4.5);
  expect(b.nitrous?.flow).toBeCloseTo(0.36 * (hp / 100) / 10, 12);   // 0.36 kg per 100 hp per 10 s
  massAdded(a, b, 16, 0);   // in the tail
};

const CASES: PartCase[] = [
  { id: 'turbo-kit-1', car: 'coupe', keys: ['engine.kind', /^engine\.boost/, PRESSURE, 'engine.air.intercooler', 'engine.air.compressorEff', 'engine.air.maxAirflow', ...TABLES, ...BODY, ...SPLIT], amounts: kit(6) },
  { id: 'turbo-kit-2', car: 'coupe', keys: ['engine.kind', /^engine\.boost/, PRESSURE, 'engine.air.intercooler', 'engine.air.compressorEff', 'engine.air.maxAirflow', ...TABLES, ...BODY, ...SPLIT], amounts: kit(9) },
  { id: 'turbo-kit-3', car: 'sedan', keys: ['engine.kind', /^engine\.boost/, PRESSURE, 'engine.air.intercooler', 'engine.air.compressorEff', 'engine.air.maxAirflow', ...TABLES, ...BODY, ...SPLIT], amounts: kit(13) },
  { id: 'supercharger-kit-1', car: 'coupe', keys: ['engine.kind', PRESSURE, 'engine.air.intercooler', 'engine.air.compressorEff', 'engine.air.blowerDrive', 'engine.air.maxAirflow', ...TABLES, ...BODY, ...SPLIT], amounts: blower(6, 22) },
  { id: 'supercharger-kit-2', car: 'coupe', keys: ['engine.kind', PRESSURE, 'engine.air.intercooler', 'engine.air.compressorEff', 'engine.air.blowerDrive', 'engine.air.maxAirflow', ...TABLES, ...BODY, ...SPLIT], amounts: blower(9, 28) },
  { id: 'supercharger-kit-3', car: 'sedan', keys: ['engine.kind', PRESSURE, 'engine.air.intercooler', 'engine.air.compressorEff', 'engine.air.blowerDrive', 'engine.air.maxAirflow', ...TABLES, ...BODY, ...SPLIT], amounts: blower(12, 35) },
  { id: 'turbo-upgrade-1', car: 'pickup', keys: ['engine.air.maxAirflow', 'engine.boost.tauRef', PRESSURE, ...TABLES, ...BODY, ...SPLIT], amounts: upgrade(1.35, 1.25, 1.10, 3) },
  { id: 'turbo-upgrade-2', car: 'gtr', keys: ['engine.air.maxAirflow', 'engine.boost.tauRef', PRESSURE, ...TABLES, ...BODY, ...SPLIT], amounts: upgrade(1.8, 1.6, 1.22, 6) },
  {
    id: 'intake-1', car: 'pickup', keys: [SPECIFIC, 'engine.air.maxAirflow', ...TABLES],
    amounts: (s, a, b) => { breathing(s, a, b, (x) => 1 + 0.012 * x * x); expect((b.engine.air?.maxAirflow ?? 0) / (a.engine.air?.maxAirflow ?? 1)).toBeCloseTo(1.10, 12); },
  },
  { id: 'exhaust-1', car: 'coupe', keys: [SPECIFIC, ...TABLES, ...BODY], amounts: (s, a, b) => { breathing(s, a, b, (x) => 1 + 0.015 * x * x); massAdded(a, b, -3, 'centre'); } },
  {
    id: 'exhaust-2', car: 'pickup', keys: [SPECIFIC, 'engine.air.maxAirflow', 'engine.boost.tauRef', 'engine.air.knockLimitPr', ...TABLES, ...BODY],
    amounts: (s, a, b) => {
      breathing(s, a, b, (x) => 1 + 0.035 * x * x);
      expect((b.engine.air?.maxAirflow ?? 0) / (a.engine.air?.maxAirflow ?? 1)).toBeCloseTo(1.12, 12);
      expect((b.engine.boost?.tauRef ?? 0) / (a.engine.boost?.tauRef ?? 1)).toBeCloseTo(0.88, 12);
      expect((b.engine.air?.knockLimitPr ?? 0) - (a.engine.air?.knockLimitPr ?? 0)).toBeCloseTo(0.1, 12);
      massAdded(a, b, -8, 'centre');
    },
  },
  {
    id: 'cams-1', car: 'coupe', keys: [SPECIFIC, ...REDLINE, 'engine.idle', ...TABLES],
    amounts: (s, a, b) => { breathing(s, a, b, (x) => 0.95 + 0.11 * x); expect((b.engine.redline - a.engine.redline) / RPM).toBeCloseTo(400, 9); expect((b.engine.idle - a.engine.idle) / RPM).toBeCloseTo(100, 9); },
  },
  {
    id: 'cams-2', car: 'sports', keys: [SPECIFIC, ...REDLINE, 'engine.idle', ...TABLES],
    amounts: (s, a, b) => { breathing(s, a, b, (x) => 0.90 + 0.20 * x); expect((b.engine.redline - a.engine.redline) / RPM).toBeCloseTo(800, 9); expect((b.engine.idle - a.engine.idle) / RPM).toBeCloseTo(250, 9); },
  },
  { id: 'internals-1', car: 'coupe', keys: REDLINE, amounts: (_s, a, b) => { expect((b.engine.redline - a.engine.redline) / RPM).toBeCloseTo(300, 9); } },
  { id: 'intercooler-1', car: 'pickup', keys: ['engine.air.intercooler', ...TABLES, ...BODY, ...SPLIT], amounts: (_s, a, b) => { expect(b.engine.air?.intercooler).toBe(0.85); massAdded(a, b, 4, 1); } },
  { id: 'fuel-1', car: 'pickup', keys: ['engine.air.knockLimitPr', SPECIFIC, ...TABLES], amounts: (s, a, b) => { expect(a.engine.air?.knockLimitPr).toBe(2.6); expect(b.engine.air?.knockLimitPr).toBe(3.3); breathing(s, a, b, () => 1.02); } },
  { id: 'tune-1', car: 'coupe', keys: [SPECIFIC, ...REDLINE, ...TABLES], amounts: tuneNa(1.025, 150) },
  { id: 'tune-2', car: 'coupe', base: ['intake-1', 'exhaust-1'], keys: [SPECIFIC, ...REDLINE, ...TABLES], amounts: tuneNa(1.035, 250) },
  { id: 'tune-3', car: 'sedan', base: ['intake-1', 'exhaust-2'], keys: [SPECIFIC, ...REDLINE, ...TABLES], amounts: tuneNa(1.04, 300) },
  { id: 'tune-1', car: 'pickup', keys: [PRESSURE, ...TABLES], amounts: tuneBoost(0.22) },
  { id: 'tune-2', car: 'gtr', base: ['exhaust-2'], keys: [PRESSURE, ...TABLES], amounts: tuneBoost(0.38) },
  { id: 'tune-3', car: 'pickup', base: ['intercooler-1', 'fuel-1'], keys: [PRESSURE, ...TABLES], amounts: tuneBoost(0.55) },
  { id: 'flywheel-1', car: 'coupe', keys: ['engine.inertia'], amounts: (_s, a, b) => { expect(b.engine.inertia / a.engine.inertia).toBeCloseTo(0.7, 12); } },
  { id: 'nitrous-1', car: 'coupe', keys: [/^nitrous/, ...BODY, ...SPLIT], amounts: nitrous(50) },
  { id: 'nitrous-2', car: 'sedan', keys: [/^nitrous/, ...BODY, ...SPLIT], amounts: nitrous(100) },
  { id: 'nitrous-3', car: 'pickup', keys: [/^nitrous/, ...BODY, ...SPLIT], amounts: nitrous(150) },
  { id: 'clutch-1', car: 'coupe', keys: ['driveline.clutchCapacity'], amounts: (_s, a, b) => { expect(b.driveline.clutchCapacity / a.driveline.clutchCapacity).toBeCloseTo(1.5, 12); } },
  { id: 'clutch-2', car: 'sedan', keys: ['driveline.clutchCapacity'], amounts: (_s, a, b) => { expect(b.driveline.clutchCapacity / a.driveline.clutchCapacity).toBeCloseTo(2.2, 12); } },
  { id: 'shifter-1', car: 'coupe', keys: ['driveline.shiftTime'], amounts: (_s, a, b) => { expect(b.driveline.shiftTime / a.driveline.shiftTime).toBeCloseTo(0.75, 12); } },
  {
    id: 'gearbox-1', car: 'coupe', keys: [/^driveline\.gears\.\d+$/],
    amounts: (_s, a, b) => {
      const g = b.driveline.gears, n = g.length;
      expect([g[0], g[n - 1]]).toEqual([a.driveline.gears[0], a.driveline.gears[n - 1]]);   // the same first and top
      for (let i = 1; i < n - 1; i++) expect(g[i] / g[i + 1]).toBeCloseTo(g[0] / g[1], 12);    // every step the same
    },
  },
  {
    id: 'gearbox-2', car: 'coupe', keys: [/^driveline\.gears\.\d+$/, 'driveline.shiftTime', 'driveline.shiftTorqueHold', ...BODY],
    amounts: (_s, a, b) => {
      expect(b.driveline.shiftTime).toBe(0.08);
      expect(b.driveline.shiftTorqueHold).toBe(0.5);
      const g = b.driveline.gears;
      expect(g[1] / g[2]).toBeCloseTo(g[0] / g[1], 12);
      massAdded(a, b, 10, 'centre');
    },
  },
  { id: 'lsd-1', car: 'sedan', keys: [/^driveline\.diffFront\./], amounts: (_s, a, b) => { expect(a.driveline.diffFront.kind).toBe('open'); expect(b.driveline.diffFront).toEqual({ kind: 'limited-slip', preload: 60, lockPerTorque: 0.25 }); } },
  { id: 'lsd-2', car: 'coupe', keys: [/^driveline\.diffRear\./], amounts: (_s, a, b) => { expect(a.driveline.diffRear.preload).toBe(60); expect(b.driveline.diffRear).toEqual({ kind: 'limited-slip', preload: 150, lockPerTorque: 0.5 }); } },
  { id: 'tyres-all-season', car: 'coupe', keys: TYRES, amounts: categoryOf('all-season') },
  { id: 'tyres-summer', car: 'sedan', keys: TYRES, amounts: categoryOf('summer') },
  { id: 'tyres-max-performance', car: 'sedan', keys: TYRES, amounts: categoryOf('max-performance') },
  { id: 'tyres-track', car: 'sports', keys: TYRES, amounts: categoryOf('track') },
  { id: 'tyres-all-terrain', car: 'coupe', keys: TYRES, amounts: categoryOf('all-terrain') },
  { id: 'tyres-drag', car: 'coupe', keys: TYRES, amounts: categoryOf('drag') },
  {
    id: 'tyres-wide-1', car: 'coupe', keys: [...TYRES, 'wheelInertiaFront', 'wheelInertiaRear'],
    amounts: (_s, a, b) => {
      for (const axle of ['tyreFront', 'tyreRear'] as const) {
        const t0 = a[axle], t1 = b[axle];
        expect(t1.width - t0.width).toBeCloseTo(0.020, 12);
        expect(t1.radius).toBe(t0.radius);
        expect(t1.fz0).toBeCloseTo(tyreReferenceLoad(t1.width, 2 * t1.radius / LOADED_RADIUS_RATIO), 9);
        expect(t1.fz0).toBeGreaterThan(t0.fz0);
        expect(t1.muY0).toBe(t0.muY0);
      }
      expect(b.wheelInertiaRear).toBeGreaterThan(a.wheelInertiaRear);
    },
  },
  {
    id: 'wheels-light-1', car: 'coupe', keys: ['chassis.unsprungFront', 'chassis.unsprungRear', 'wheelInertiaFront', 'wheelInertiaRear', ...BODY, ...SPLIT],
    amounts: (_s, a, b) => {
      expect(b.chassis.unsprungFront - a.chassis.unsprungFront).toBeCloseTo(-6, 12);
      expect(b.chassis.unsprungRear - a.chassis.unsprungRear).toBeCloseTo(-6, 12);
      expect(b.wheelInertiaFront / a.wheelInertiaFront).toBeCloseTo(0.85, 12);
      expect(b.wheelInertiaRear / a.wheelInertiaRear).toBeCloseTo(0.85, 12);
      expect(b.chassis.mass - a.chassis.mass).toBeCloseTo(-12, 9);
    },
  },
  ...([[1, 1.2, 0.06, 0.025], [2, 1.45, 0.12, 0.040], [3, 1.75, 0.18, 0.055]] as const).map(([n, f, dz, drop]): PartCase => ({
    id: `springs-${n}`, car: n === 2 ? 'sedan' : 'coupe',
    keys: ['chassis.springFront', 'chassis.springRear', 'chassis.damperFront', 'chassis.damperRear', 'chassis.sprungCgHeight', 'chassis.cgHeight', 'chassis.ixx', 'chassis.iyy'],
    amounts: springs(f, dz, drop),
  })),
  ...(['arb-1', 'arb-2'] as const).map((id): PartCase => ({
    id, car: 'sedan', keys: ['chassis.arbFront', 'chassis.arbRear'],
    amounts: (_s, a, b) => { expect(b.chassis.arbFront / a.chassis.arbFront).toBeCloseTo(1.3, 12); expect(b.chassis.arbRear / a.chassis.arbRear).toBeCloseTo(1.3, 12); },
  })),
  { id: 'weight-1', car: 'sedan', keys: [...BODY, ...SPLIT], amounts: weight(0.03, 0.003) },
  { id: 'weight-2', car: 'sports', keys: [...BODY, ...SPLIT], amounts: weight(0.07, 0.007) },
  { id: 'weight-3', car: 'coupe', keys: [...BODY, ...SPLIT], amounts: weight(0.12, 0.012) },
  { id: 'brakes-1', car: 'coupe', keys: ['brakes.maxTorqueFront', 'brakes.maxTorqueRear'], amounts: brakes(1.15, 0) },
  { id: 'brakes-2', car: 'coupe', keys: ['brakes.maxTorqueFront', 'brakes.maxTorqueRear', 'chassis.unsprungFront', ...BODY, ...SPLIT], amounts: brakes(1.4, 2) },
  { id: 'brakes-3', car: 'sedan', keys: ['brakes.maxTorqueFront', 'brakes.maxTorqueRear', 'chassis.unsprungFront', ...BODY, ...SPLIT], amounts: brakes(1.6, 3) },
  { id: 'aero-front-1', car: 'coupe', keys: ['aero.liftAreaFront', 'aero.dragArea', ...BODY, ...SPLIT], amounts: aero('front', -0.10, 0.012, 3) },
  { id: 'aero-front-2', car: 'sports', keys: ['aero.liftAreaFront', 'aero.dragArea', ...BODY, ...SPLIT], amounts: aero('front', -0.22, 0.03, 5) },
  { id: 'aero-rear-1', car: 'coupe', keys: ['aero.liftAreaRear', 'aero.dragArea', ...BODY, ...SPLIT], amounts: aero('rear', -0.18, 0.03, 6) },
  { id: 'aero-rear-2', car: 'gtr', keys: ['aero.liftAreaRear', 'aero.dragArea', ...BODY, ...SPLIT], amounts: aero('rear', -0.40, 0.07, 8) },
];

describe('every part changes exactly the numbers its row names, by the row\'s amounts', () => {
  it('the cases below cover every part in the catalogue', () => {
    const covered = new Set(CASES.map((c) => c.id));
    expect(PARTS.map((p) => p.id).filter((id) => !covered.has(id))).toEqual([]);
    expect(PARTS.length).toBe(53);
  });

  for (const c of CASES) {
    it(`${c.id} on the ${c.car}${c.base ? ` (with ${c.base.join(', ')})` : ''}`, () => {
      const sheet = sheetOf(c.car), base = c.base ?? [];
      expect(fits(sheet, build(base), c.id)).toBeNull();
      const stock = resolveModel(sheet).model, a = fitted(sheet, base), b = fitted(sheet, [...base, c.id]);
      const moved = changed(a, b);
      expect(moved.length).toBeGreaterThan(0);
      const stray = moved.filter((k) => !c.keys.some((p) => (typeof p === 'string' ? p === k : p.test(k))));
      expect(stray).toEqual([]);
      c.amounts(stock, a, b);
      // Whatever the part touched is an estimate until the parts exam says otherwise.
      const { basis } = resolveModel(sheet, build([...base, c.id]));
      const top = moved[0].split('.').slice(0, 2).join('.');
      if (basis[top] !== undefined) expect(basis[top], top).toBe('estimated');
    });
  }
});

/* ------------------------------------------------------------------ refusals */

function electricSheet(): PhysicsSheet {
  const s = emptySheet('test-ev', { year: 2023, make: 'Illustrative', model: 'Electric sedan', trim: 'RWD', bodyClass: 'sedan' });
  const n = <T,>(value: T) => ({ value, source: { kind: 'illustrative' as const } });
  s.powertrain = n('electric'); s.drivetrain = n('RWD'); s.curbWeightLb = n(4000); s.horsepower = n(283); s.torqueLbFt = n(310);
  return s;
}

describe('a part the car cannot take is refused, with the reason', () => {
  it('a turbo kit on an electric car', () => {
    const ev = electricSheet();
    for (const id of ['turbo-kit-1', 'supercharger-kit-2', 'tune-1', 'intake-1', 'nitrous-1', 'flywheel-1', 'clutch-1', 'gearbox-1', 'shifter-1']) {
      expect(fits(ev, build([]), id), id).toMatch(/electric|motor|single-speed|manual/);
    }
    const stock = resolveModel(ev).model, kitted = fitted(ev, ['turbo-kit-2', 'weight-1']);
    expect(kitted.engine.kind).toBe('electric');
    expect(kitted.chassis.mass).toBeLessThan(stock.chassis.mass);   // what it can take still goes on
    const report = describeBuild(ev, build(['turbo-kit-2', 'weight-1']));
    expect(report.parts.map((p) => [p.id, p.fitted])).toEqual([['turbo-kit-2', false], ['weight-1', true]]);
    expect(report.parts[0].reason).toMatch(/electric/);
  });

  it('two induction kits: the first in the catalogue goes on, the second is refused, whatever order they were listed in', () => {
    const s = proofSheet('coupe');
    expect(fits(s, build(['turbo-kit-2']), 'supercharger-kit-1')).toMatch(/second induction/);
    expect(fits(s, build(['supercharger-kit-1']), 'turbo-kit-3')).toMatch(/second induction/);
    for (const ids of [['turbo-kit-2', 'supercharger-kit-1'], ['supercharger-kit-1', 'turbo-kit-2']]) {
      const report = describeBuild(s, build(ids));
      expect(report.parts.map((p) => [p.id, p.fitted])).toEqual([['turbo-kit-2', true], ['supercharger-kit-1', false]]);
      expect(fitted(s, ids).engine.kind).toBe('turbo');
    }
    sameBits(fitted(s, ['turbo-kit-2', 'supercharger-kit-1']), fitted(s, ['turbo-kit-2']));
    // A factory-boosted engine takes no kit, and a turbo upgrade needs a factory turbo.
    expect(fits(proofSheet('pickup'), build([]), 'turbo-kit-1')).toMatch(/boosted from the factory/);
    expect(fits(s, build([]), 'turbo-upgrade-1')).toMatch(/factory turbo/);
  });

  it('tune-3 without intercooler-1 and fuel-1 acts as the rule says', () => {
    const pickup = proofSheet('pickup');
    expect(fits(pickup, build([]), 'tune-3')).toMatch(/intercooler-1 and fuel-1/);
    expect(fits(pickup, build(['intercooler-1']), 'tune-3')).toMatch(/intercooler-1 and fuel-1/);
    expect(fits(pickup, build(['intercooler-1', 'fuel-1']), 'tune-3')).toBeNull();
    // Refused, it changes nothing: the build is the build without it.
    sameBits(fitted(pickup, ['tune-3', 'fuel-1']), fitted(pickup, ['fuel-1']));
    // The Garage's ECU at tier 3 brings fuel-1 and the highest tune whose needs are met: tune-3 with an intercooler,
    // else tune-2 with headers, else tune-1.
    const ids = (perf: Record<string, number>): string[] => legacyBuild(perf, {}, pickup).parts.map((p) => p.id);
    expect(ids({ ecu: 3 })).toEqual(['fuel-1', 'tune-1']);
    expect(ids({ ecu: 3, engine: 2 })).toEqual(['intake-1', 'exhaust-1', 'exhaust-2', 'cams-1', 'fuel-1', 'tune-2']);
    expect(ids({ ecu: 3, turbo: 1 })).toEqual(['intercooler-1', 'fuel-1', 'tune-3']);
    // On an unboosted engine tune-2 and tune-3 need intake and exhaust.
    const coupe = proofSheet('coupe');
    expect(fits(coupe, build(['intake-1']), 'tune-2')).toMatch(/intake-1 and an exhaust part/);
    expect(legacyBuild({ ecu: 2 }, {}, coupe).parts.map((p) => p.id)).toEqual(['tune-1']);
    expect(legacyBuild({ ecu: 2, engine: 1 }, {}, coupe).parts.map((p) => p.id)).toEqual(['intake-1', 'exhaust-1', 'tune-2']);
  });

  it('and the rest: a part with nothing to work on, a place already taken, a part twice, a part not in the catalogue', () => {
    const sedan = proofSheet('sedan'), coupe = proofSheet('coupe');
    expect(fits(sedan, build([]), 'shifter-1')).toMatch(/manual/);                 // an automatic
    expect(fits(sedan, build([]), 'intercooler-1')).toMatch(/not boosted/);
    expect(fits(sedan, build(['turbo-kit-1']), 'intercooler-1')).toBeNull();       // the kit comes first in the order
    expect(fits(coupe, build([]), 'lsd-1')).toMatch(/as strong/);                  // the coupe has a street limited-slip
    expect(fits(coupe, build([]), 'tyres-summer')).toMatch(/summer tyres already/);
    expect(fits(coupe, build(['tune-1']), 'tune-1')).toMatch(/fitted already/);
    expect(fits(coupe, build(['springs-1']), 'springs-3')).toMatch(/same place/);
    expect(fits(coupe, build(['tyres-track']), 'tyres-drag')).toMatch(/same place/);
    expect(fits(coupe, build(['tyres-track']), 'tyres-wide-1')).toBeNull();        // a width goes with any category
    expect(fits(coupe, build([]), 'turbo-kit-9')).toMatch(/not in the catalogue/);
    const report = describeBuild(coupe, { parts: [{ id: 'arb-1' }, { id: 'nonsense' }, { id: 'arb-2' }], setup: {} });
    expect(report.parts.map((p) => [p.id, p.fitted])).toEqual([['arb-1', true], ['arb-2', false], ['nonsense', false]]);
  });
});

/* ------------------------------------------------------------------ describing a build */

describe('describeBuild says what each part changed, in words and numbers', () => {
  it('a turbo kit, headers and track tyres on the coupe', () => {
    const report = describeBuild(proofSheet('coupe'), build(['tyres-track', 'exhaust-2', 'turbo-kit-1'], { brakeBias: 0.6 }));
    expect(report.parts.map((p) => p.id)).toEqual(['turbo-kit-1', 'exhaust-2', 'tyres-track']);
    const words = (id: string): string => (report.parts.find((p) => p.id === id)?.changed ?? []).join('; ');
    expect(words('turbo-kit-1')).toMatch(/engine: unboosted to turbocharged/);
    expect(words('turbo-kit-1')).toMatch(/peak power: 480 to \d{3} hp \(\+\d+\.\d%\)/);
    expect(words('turbo-kit-1')).toMatch(/full boost: 0\.0 to 6\.0 psi/);
    expect(words('turbo-kit-1')).toMatch(/mass as driven: 1844 to 1866 kg/);
    expect(words('exhaust-2')).toMatch(/turbo spool time at 3,000 rpm: 0\.45 to 0\.40 s/);
    expect(words('tyres-track')).toMatch(/tyres: summer to track/);
    expect(words('tyres-track')).toMatch(/front brake torque/);
    for (const p of report.parts) { expect(p.does.length).toBeGreaterThan(10); expect(p.card).not.toBeNull(); }
    expect(report.setup.join('; ')).toMatch(/front brake torque/);
    expect(report.setup.join('; ')).toMatch(/brake bias set without brakes-2/);
  });

  it('a setup field with nothing to act on is said so, and a clutch the build is past is a warning', () => {
    const report = describeBuild(proofSheet('sedan'), build(['turbo-kit-3'], { diffLock: 1.5, nitrousPower: 1.2, pressureFront: 1.1, camberRear: 1.5 }));
    const setup = report.setup.join('; ');
    expect(setup).toMatch(/no limited-slip part/);
    expect(setup).toMatch(/no nitrous kit/);
    expect(setup).toMatch(/tyre pressure: not modelled/);
    expect(setup).toMatch(/camber: not modelled/);
    expect(report.warnings.join('; ')).toMatch(/past the clutch/);
    expect(describeBuild(proofSheet('sedan'), build(['turbo-kit-3', 'clutch-2'])).warnings).toEqual([]);
  });

  it('each part carries its place in the card engine\'s modification table, and a build gives one fitment per category', () => {
    // @micar/engine modifications.ts MODS: the categories a card can carry.
    const categories = ['engine', 'ecu', 'intake-exhaust', 'turbo', 'supercharger', 'nitrous', 'transmission', 'suspension', 'tires', 'brakes', 'weight', 'aero', 'offroad', 'eco'];
    for (const p of PARTS) { expect(categories, p.id).toContain(p.card.category); expect([1, 2, 3]).toContain(p.card.tier); }
    expect(partById('turbo-kit-3')?.card).toEqual({ category: 'turbo', tier: 3 });
    const mods = buildCardMods(proofSheet('coupe'), build(['intake-1', 'exhaust-2', 'cams-2', 'internals-1', 'tyres-track', 'tyres-wide-1', 'weight-2']));
    expect(mods).toEqual([
      { category: 'intake-exhaust', tier: 2 }, { category: 'engine', tier: 3 }, { category: 'tires', tier: 3 }, { category: 'weight', tier: 2 },
    ]);
  });
});

/* ------------------------------------------------------------------ on the bench */

describe('on the bench, the changes a tuner would expect', () => {
  it('a tune: 10 to 25% more peak power on a turbo engine, 2 to 5% on an unboosted one', () => {
    // Turbo: tune-1 raises full boost by 0.22 atm, about 11% more pressure on a one-bar engine; after the extra heat of
    // compression the charge is about 9.5% denser, and brake power rises a little faster than indicated because
    // friction stays where it was. Tuners see 10 to 25% from a stage-1 map on a turbo engine.
    for (const car of ['pickup', 'gtr'] as const) {
      const gain = peakHp(fitted(sheetOf(car), ['tune-1'])) / peakHp(resolveModel(sheetOf(car)).model) - 1;
      expect(gain, car).toBeGreaterThan(0.10);
      expect(gain, car).toBeLessThan(0.25);
    }
    // Unboosted: timing and fuel worth 2.5% of indicated torque, a little more at the crank; a higher redline adds
    // little where the power peak sits below it. Tuners see 2 to 5% from a map alone on an unboosted engine.
    for (const car of ['sedan', 'sports', 'coupe'] as const) {
      const gain = peakHp(fitted(sheetOf(car), ['tune-1'])) / peakHp(resolveModel(sheetOf(car)).model) - 1;
      expect(gain, car).toBeGreaterThan(0.02);
      expect(gain, car).toBeLessThan(0.05);
    }
  });

  it('a 9 psi turbo kit on an unboosted engine: 35 to 60% more peak power', () => {
    // Bolt-on 8 to 10 psi kits on modern unboosted fours and V8s make 35 to 60% more at the crank (the brief's band).
    // The charge is 52% denser at 9 psi through the kit's cooler (0.7) and compressor (0.72): that much more indicated
    // torque, less the timing a high-compression engine gives up to knock, while friction stays what it was.
    const gains: Record<string, string> = {};
    for (const car of ['sedan', 'sports', 'coupe'] as const) {
      const gain = peakHp(fitted(sheetOf(car), ['turbo-kit-2'])) / peakHp(resolveModel(sheetOf(car)).model) - 1;
      if (!(gain > 0.35 && gain < 0.60)) gains[car] = `+${(100 * gain).toFixed(1)}%`;
    }
    expect(gains).toEqual({});
  });

  it('...and the kit\'s turbo lags: at 3,000 rpm a stamp on the throttle takes a third of a second or more to bring 90% of its torque', () => {
    // A turbo builds boost with a time constant of about 0.45 s at 3,000 rpm (DESIGN.md 5.1), so 90% of the boosted
    // torque comes after a good fraction of a second; the unboosted engine has all of it at once.
    const coupe = proofSheet('coupe'), w = 3000 * RPM, h = 1 / 480;
    const timeTo90 = (m: VehicleModel): number => {
      let boost = 0, t = 0;
      for (let k = 0; k < 5000; k++) boost = boostStep(m.engine, boost, w, 1, h);   // spooled
      const full = engineTorque(m.engine, w, 1, boost);
      boost = 0;
      while (engineTorque(m.engine, w, 1, boost) < 0.9 * full && t < 10) { boost = boostStep(m.engine, boost, w, 1, h); t += h; }
      return t;
    };
    expect(timeTo90(resolveModel(coupe).model)).toBe(0);
    const lag = timeTo90(fitted(coupe, ['turbo-kit-2']));
    expect(lag).toBeGreaterThan(0.33);
    expect(lag).toBeLessThan(3);
  });

  it('weight-3 cuts the quarter-mile time and raises the trap speed by about what the hp-per-weight rule says', () => {
    // The rule: at constant power v^3 grows as P d / m, so trap speed goes as (P / W)^(1/3) and ET as its inverse.
    // weight-3 takes 11.5% off the mass as driven: the rule says ET -4.0%, trap +4.2%. A real car gets half to all of
    // that: the flywheel, wheels and shafts it still spins up weigh what they did, and a shift costs the lighter car
    // as much time. So: between half and 1.1 times the rule's change, on the cars whose launch is not traction-limited.
    for (const car of ['sedan', 'sports', 'pickup'] as const) {
      const s = proofSheet(car), stock = resolveModel(s).model, light = fitted(s, ['weight-3']);
      const rule = Math.cbrt(light.chassis.mass / stock.chassis.mass);
      const a = runBench(stock, 'accel').timeslip, b = runBench(light, 'accel').timeslip;
      const et = 1 - b.quarter / a.quarter, trap = b.trapMph / a.trapMph - 1;
      expect(et / (1 - rule), `${car} ET`).toBeGreaterThan(0.5);
      expect(et / (1 - rule), `${car} ET`).toBeLessThan(1.1);
      expect(trap / (1 / rule - 1), `${car} trap`).toBeGreaterThan(0.5);
      expect(trap / (1 / rule - 1), `${car} trap`).toBeLessThan(1.1);
    }
    // The rear-drive V8 coupe on summer tyres spins them in the first two gears: a lighter car puts less load on them,
    // so its launch is no better, and its manual's shifts (0.3 s with no drive) cost the lighter car more speed to the
    // air. It still runs quicker and faster, by less than the rule.
    const s = proofSheet('coupe'), a = runBench(resolveModel(s).model, 'accel').timeslip, b = runBench(fitted(s, ['weight-3']), 'accel').timeslip;
    expect(b.quarter).toBeLessThan(a.quarter);
    expect(b.trapMph).toBeGreaterThan(a.trapMph);
  });

  it('track tyres raise the skidpad figure and shorten 60-0', () => {
    // All-season to track on the sedan: 39% more friction at the reference load (0.92 to 1.28), a little less of it
    // kept as load rises (load sensitivity 0.15 against 0.12), so the skidpad rises 25 to 40%. Braking friction rises
    // 44% (1.08 x 0.92 to 1.12 x 1.28), and distance goes as its inverse less what ABS gives back: 60-0 falls 20 to 35%.
    const s = proofSheet('sedan'), stock = resolveModel(s).model, track = fitted(s, ['tyres-track']);
    const g0 = skidpadAt(stock, 300), g1 = skidpadAt(track, 300);
    expect(g1 / g0).toBeGreaterThan(1.25);
    expect(g1 / g0).toBeLessThan(1.40);
    const d0 = runBench(stock, 'brake').braking60, d1 = runBench(track, 'brake').braking60;
    expect(1 - d1 / d0).toBeGreaterThan(0.20);
    expect(1 - d1 / d0).toBeLessThan(0.35);
  });

  it('brakes-1 to brakes-3 leave a single 60-0 within 1.5%: the tyres limit a first stop', () => {
    // Stock brakes already lock any of these tyres with a margin for ABS to find the peak; more torque only lets ABS
    // cut harder. A first stop is the tyres', so a bigger brake changes it by no more than the bench's own scatter.
    for (const car of ['sedan', 'sports', 'coupe', 'pickup'] as const) {
      const s = proofSheet(car), d0 = runBench(resolveModel(s).model, 'brake').braking60;
      for (const id of ['brakes-1', 'brakes-2', 'brakes-3']) {
        const d = runBench(fitted(s, [id]), 'brake').braking60;
        expect(Math.abs(d / d0 - 1), `${car} ${id}`).toBeLessThan(0.015);
      }
    }
  });

  it('lsd-1 on the rear-drive coupe pulls out of a slow corner at least as fast as an open differential', () => {
    // A driver holding a 25 m corner at 20 mph in second, traction control off, feeds in the throttle by the feel of
    // the wheelspin (the bench's launch hand): an open differential spins the unloaded inside wheel and holds the
    // throttle back; a limited-slip shares the drive and lets more of it go to the road.
    const exit = (ids: string[]): { u: number; distance: number } => {
      const s = proofSheet('coupe');
      s.diffRear = { value: 'open', source: { kind: 'illustrative' } };
      const m = fitted(s, ids), car = createVehicle(m), R = 25, v0 = 9;
      setRolling(car, v0, v0 / R);
      const d = circleDriver(m, 0, R, R, v0, 0, v0), c = defaultControls();
      for (let k = 0; k < 120 * 6; k++) { d.control(car, c); c.gear = 2; c.tcs = false; step(car, c, FLAT); }
      let th = c.throttle;
      const from = car.distance;
      for (let k = 0; k < 120 * 3; k++) {
        d.control(car, c); c.gear = 2; c.tcs = false; c.brake = 0;
        th += (1 / 120) * 2 * (1 - worstDrivenSlip(car, 1));
        th = th < 0 ? 0 : th > 1 ? 1 : th;
        c.throttle = th;
        step(car, c, FLAT);
      }
      return { u: car.u, distance: car.distance - from };
    };
    const open = exit([]), lsd = exit(['lsd-1']);
    expect(open.u).toBeGreaterThan(12);   // it did pull out: from 9 m/s
    expect(lsd.u).toBeGreaterThanOrEqual(open.u);
    expect(lsd.distance).toBeGreaterThanOrEqual(open.distance);
  });

  it('nitrous-2 adds close to 100 hp while the bottle lasts, and nothing once it is empty', () => {
    // A dyno pull on the road in third from 30 mph: brake power against engine speed with and without the button.
    // The kit's controller gives its full shot at full throttle: 95 to 101 hp more across the pull.
    const m = fitted(proofSheet('coupe'), ['nitrous-2']);
    const pull = (button: boolean, car = createVehicle(m)): { rpm: number[]; hp: number[] } => {
      setRolling(car, 30 * MPH, 0);
      const c = defaultControls(); c.throttle = 1; c.gear = 3; c.nitrous = button; c.tcs = false;
      const rpm: number[] = [], hp: number[] = [];
      for (let k = 0; k < 120 * 15 && car.engineOmega < 0.97 * m.engine.redline; k++) {
        step(car, c, FLAT); rpm.push(car.engineOmega / RPM); hp.push(car.engineTorque * car.engineOmega / HP);
      }
      return { rpm, hp };
    };
    const at = (r: { rpm: number[]; hp: number[] }, x: number): number => {
      for (let i = 1; i < r.rpm.length; i++) if (r.rpm[i] >= x) return r.hp[i - 1] + (r.hp[i] - r.hp[i - 1]) * (x - r.rpm[i - 1]) / (r.rpm[i] - r.rpm[i - 1]);
      return NaN;
    };
    const off = pull(false), on = pull(true);
    for (const x of [3500, 4500, 5500, 6500, 7000]) {
      expect(at(on, x) - at(off, x), `${x} rpm`).toBeGreaterThan(95);
      expect(at(on, x) - at(off, x), `${x} rpm`).toBeLessThan(101);
    }
    // Flat out with the button held until the 4.5 kg bottle is empty (a full shot uses 0.036 kg/s: two minutes or more).
    const car = createVehicle(m), c = defaultControls(); c.throttle = 1; c.nitrous = true;
    while (car.nitrousLeft > 0 && car.time < 600) step(car, c, FLAT);
    expect(car.nitrousLeft).toBe(0);
    expect(car.time).toBeGreaterThan(4.5 / 0.036);
    const empty = pull(true, car);
    for (const x of [3500, 5500, 7000]) expect(Math.abs(at(empty, x) - at(off, x)), `${x} rpm`).toBeLessThan(0.5);
  });

  it('springs and bars cut body roll; a lower car corners harder; bars move the skidpad figure little', () => {
    // Steady roll on a 50 m circle at half a g, as a magazine photographs it: stiffer springs and bars take roll out,
    // each step of springs more than the last.
    const rollPerG = (m: VehicleModel): number => {
      const car = createVehicle(m), R = 50, v = Math.sqrt(0.5 * G * R);
      setRolling(car, v, v / R);
      const d = circleDriver(m, 0, R, R, v, 0, v), c = defaultControls();
      let roll = 0, ay = 0;
      for (let k = 0; k < 120 * 8; k++) { d.control(car, c); step(car, c, FLAT); if (k >= 120 * 6) { roll += car.roll; ay += car.ay; } }
      return (roll / ay) * G * 180 / PI;
    };
    for (const car of ['sedan', 'coupe'] as const) {
      const s = proofSheet(car), r0 = rollPerG(resolveModel(s).model);
      const r = [1, 2, 3].map((n) => rollPerG(fitted(s, [`springs-${n}`])));
      expect(r[0], car).toBeLessThan(r0);
      expect(r[1], car).toBeLessThan(r[0]);
      expect(r[2], car).toBeLessThan(r[1]);
      expect(rollPerG(fitted(s, ['arb-1'])), car).toBeLessThan(r0);
    }
    // The skidpad. Lowering the centre of gravity cuts the load transfer that every corner costs, so coilovers at
    // their 40 mm drop corner harder than the same coilovers set back to the stock height. Bars only move load
    // transfer between the axles, so they raise the figure by nothing to speak of (at most 0.005 g); springs, which
    // also move it, keep the figure within 0.03 g of stock.
    for (const car of ['sedan', 'coupe'] as const) {
      const s = proofSheet(car), g0 = skidpadAt(resolveModel(s).model, 300);
      const low = skidpadAt(fitted(s, ['springs-2']), 300), high = skidpadAt(fitted(s, ['springs-2'], { rideHeightDrop: -0.040 }), 300);
      expect(low, car).toBeGreaterThan(high);
      expect(skidpadAt(fitted(s, ['arb-1']), 300), car).toBeLessThan(g0 + 0.005);
      expect(Math.abs(low - g0), car).toBeLessThan(0.03);
    }
  });
});

/* ------------------------------------------------------------------ the Garage's builds */

describe('legacyBuild: the Garage\'s nine parts and eight sliders as real parts', () => {
  const KEYS = ['engine', 'ecu', 'turbo', 'trans', 'susp', 'nos', 'tires', 'brakes', 'weight'] as const;

  /** Every number in a model finite, but for the few that are infinite by meaning; masses and lengths positive. */
  function sound(m: VehicleModel, what: string): void {
    const infinite = /^(engine\.air\.maxAirflow|systems\.limiterSpeed|driveline\.diff(Front|Rear)\.preload|driveline\.centre\.lockTorque)$/;
    for (const [k, v] of flat(m)) if (typeof v === 'number' && !infinite.test(k)) expect(Number.isFinite(v), `${what} ${k}`).toBe(true);
    const c = m.chassis;
    for (const v of [c.mass, c.sprungMass, c.a, c.b, c.cgHeight, c.sprungCgHeight, c.izz, c.ixx, c.iyy, m.engine.redline, m.driveline.finalDrive]) expect(v > 0, what).toBe(true);
    expect(enginePeaks(m.engine).power, what).toBeGreaterThan(0);
  }

  it('every tier of every Garage part, with the sliders at -1, 0 and 1, resolves to a finite car on each proof car', () => {
    let n = 0;
    for (const car of ['sedan', 'sports', 'coupe', 'pickup'] as const) {
      const s = proofSheet(car);
      for (const key of KEYS) for (let tier = 0; tier <= 3; tier++) for (const v of [-1, 0, 1]) {
        const tune = { turbo: v, nitrous: v, aero: v, bias: v, ride: v, stiff: v, steer: v, gears: v };
        const b = legacyBuild({ [key]: tier }, tune, s);
        const report = describeBuild(s, b);
        expect(report.parts.filter((p) => !p.fitted).map((p) => p.id), `${car} ${key} ${tier}`).toEqual([]);   // only what fits
        sound(resolveModel(s, b).model, `${car} ${key} ${tier} ${v}`);
        n++;
      }
    }
    expect(n).toBe(4 * 9 * 4 * 3);
  });

  it('every part at tier 3 with every slider at an end drives the golden log without a NaN, then pulls away flat out', () => {
    const all = { engine: 3, ecu: 3, turbo: 3, trans: 3, susp: 3, nos: 3, tires: 3, brakes: 3, weight: 3 };
    const log = goldenLog();
    for (const car of CARS) {
      for (const v of [-1, 1]) {
        const m = resolveModel(sheetOf(car), legacyBuild(all, { turbo: v, nitrous: v, aero: v, bias: v, ride: v, stiff: v, steer: v, gears: v }, sheetOf(car))).model;
        sound(m, car);
        const s = createVehicle(m);
        for (let k = 0; k < 1200; k++) { const c = { ...log[k], nitrous: true }; step(s, c, FLAT); }
        for (const x of [s.x, s.y, s.u, s.v, s.r, s.engineOmega, s.roll, s.pitch]) expect(Number.isFinite(x), car).toBe(true);
        // Then straight, flat out with the systems on, for five seconds: any of these builds passes 45 mph.
        const c = defaultControls(); c.throttle = 1;
        for (let k = 0; k < 600; k++) step(s, c, FLAT);
        expect(s.u, `${car} ${v}`).toBeGreaterThan(20);
      }
    }
  });

  it('each tier is the preset section 11 gives, and the sliders become the setup', () => {
    const coupe = proofSheet('coupe'), pickup = proofSheet('pickup');
    const ids = (perf: Record<string, number>, s = coupe): string[] => legacyBuild(perf, {}, s).parts.map((p) => p.id);
    expect(ids({ engine: 1 })).toEqual(['intake-1', 'exhaust-1']);
    expect(ids({ engine: 2 })).toEqual(['intake-1', 'exhaust-1', 'exhaust-2', 'cams-1']);
    expect(ids({ engine: 3 })).toEqual(['intake-1', 'exhaust-1', 'exhaust-2', 'cams-2', 'internals-1', 'flywheel-1']);
    expect(ids({ turbo: 2 })).toEqual(['turbo-kit-2']);
    expect(ids({ turbo: 3 }, pickup)).toEqual(['turbo-upgrade-2', 'intercooler-1']);
    expect(ids({ trans: 1 })).toEqual(['clutch-1', 'shifter-1']);
    expect(ids({ trans: 2 })).toEqual(['clutch-1', 'shifter-1', 'gearbox-1']);            // the coupe has a limited-slip already
    expect(ids({ trans: 3 })).toEqual(['clutch-2', 'gearbox-2', 'lsd-2']);
    expect(ids({ trans: 2 }, pickup)).toEqual(['clutch-1', 'gearbox-1', 'lsd-1']);        // an automatic: no short shifter
    expect(ids({ susp: 3 })).toEqual(['springs-3', 'arb-2']);
    expect(ids({ tires: 1 })).toEqual(['tyres-max-performance']);                         // summer, one step stickier
    expect(ids({ tires: 2 }, pickup)).toEqual(['tyres-summer']);                          // all-terrain, two steps
    expect(ids({ tires: 3 }, pickup)).toEqual(['tyres-track']);
    expect(ids({ nos: 2, brakes: 1, weight: 3 })).toEqual(['nitrous-2', 'weight-3', 'brakes-1']);
    expect(ids({ engine: 3, ecu: 3, turbo: 3 }, electricSheet())).toEqual([]);

    const stock = resolveModel(coupe).model;
    const share = (m: VehicleModel): number => { const f = 2 * m.brakes.maxTorqueFront / m.tyreFront.radius, r = 2 * m.brakes.maxTorqueRear / m.tyreRear.radius; return f / (f + r); };
    const b = legacyBuild({ nos: 1 }, { turbo: 1, nitrous: -1, aero: 1, bias: 1, ride: 1, stiff: -1, steer: 1, gears: 1 }, coupe);
    expect(b.setup.boostTarget).toBeUndefined();                                         // an unboosted engine has no boost to trade
    expect(b.setup).toMatchObject({ nitrousPower: 0.7, aeroFront: -0.06, aeroRear: -0.12, rideHeightDrop: 0.02, springFront: 0.8, damperRear: 0.8, finalDrive: 1.12 });
    expect(b.setup.brakeBias).toBeCloseTo(share(stock) + 0.06, 12);
    const m = resolveModel(coupe, b).model;
    expect(share(m)).toBeCloseTo(share(stock) + 0.06, 9);
    expect(m.aero.dragArea - stock.aero.dragArea).toBeCloseTo(0.02, 12);                  // the modest lip and wing's drag
    expect(m.nitrous?.power).toBeCloseTo(0.7 * 50 * HP, 9);
    expect((m.nitrous?.bottleMass ?? 0) / (m.nitrous?.flow ?? 1)).toBeCloseTo(4.5 / (0.7 * 0.018), 6);   // a smaller shot lasts longer
    const t = legacyBuild({}, { turbo: 1 }, pickup).setup;
    expect(t).toEqual({ boostTarget: 1.04, spoolTime: 1.25 });                            // later and harder
    // Anything the Garage never stored reads as stock: a saved build from an older game, or junk.
    expect(legacyBuild({} as never, {} as never, coupe)).toEqual({ parts: [], setup: {} });
    expect(legacyBuild(null, undefined, coupe)).toEqual({ parts: [], setup: {} });
    expect(legacyBuild({ engine: 'x', ecu: NaN, turbo: 7 } as never, { aero: 'up', bias: Infinity } as never, coupe)).toEqual({ parts: [{ id: 'turbo-kit-3' }], setup: {} });
  });
});
