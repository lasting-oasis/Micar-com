// The driveline against what a vehicle engineer expects of one: a locked clutch is rigid and a slipping one carries
// its capacity, an open differential splits torque evenly whatever the grip, a brake holds a wheel dead still, a shift
// takes its time and its share of drive, a converter multiplies torque at stall, a CVT holds the engine at its power
// peak, and the losses go the way power flows. The tyres are stood in for by forces set by hand each substep (and,
// where the car has to move, by a point-mass car on a road, below). Wheels carry no load unless a test says so, so
// rolling resistance stays out of the torque bookkeeping.
import { describe, expect, it } from 'vitest';
import type { Controls, DrivelineModel, EngineModel, VehicleModel, VehicleState } from './types';
import type { EngineSpec } from './engine';
import { AIR_ENERGY, buildEngine, enginePeaks, engineTorque } from './engine';
import { drivelineStep } from './driveline';
import { rollingResistance } from './tyre';
import { fixtureModel } from './fixtures';
import { G as GRAVITY, HASH_START, RHO_AIR, hashNumber, rng } from './math';
import { createState, defaultControls } from './state';
import { HP, LBFT, RPM } from './units';

const H = 1 / 480;
// The fixture car: a 1,600 kg rear-drive coupe, six-speed manual (3.5, 2.1, 1.5, ...), 3.7 final drive, 92% efficient,
// a 0.28 kg m^2 engine idling at 73 rad/s, wheels of 1.3 (front) and 1.4 (rear) kg m^2 on 0.33 m tyres, a 700 N m clutch.
const FINAL = 3.7, FIRST = 3.5, SECOND = 2.1, THIRD = 1.5, ETA = 0.92, IE = 0.28, JR = 1.4, R = 0.33;

const ctl = (over: Partial<Controls> = {}): Controls => ({ ...defaultControls(), ...over });
const rel = (a: number, b: number): number => Math.abs(a / b - 1);

function car(driveline: Partial<DrivelineModel> = {}, engine?: EngineModel): VehicleModel {
  return engine ? fixtureModel({ driveline, engine }) : fixtureModel({ driveline });
}

/** The driven wheels' mean speed, each axle weighted by its share of drive. */
function drivenMean(s: VehicleState): number {
  const d = s.model.driveline, w = s.wheelOmega;
  const f = d.layout === 'FWD' ? 1 : d.layout === 'RWD' ? 0 : d.centre.frontShare;
  return f * 0.5 * (w[0] + w[1]) + (1 - f) * 0.5 * (w[2] + w[3]);
}

/** Puts the car in a gear with every wheel rolling at v (m/s) and the engine turning with them, clutch closed. */
function rolling(s: VehicleState, gear: number, v: number): void {
  const m = s.model, d = m.driveline;
  for (let i = 0; i < 4; i++) s.wheelOmega[i] = v / (i < 2 ? m.tyreFront.radius : m.tyreRear.radius);
  s.gear = gear; s.gearNext = gear; s.shiftTimer = 0;
  s.ratio = gear > 0 ? d.gears[gear - 1] : 0;
  s.engineOmega = s.ratio * d.finalDrive * drivenMean(s);
}

/** The torque the driveline gave each wheel in the last substep, N m: what turned the wheel faster plus what its tyre took. */
function wheelTorques(s: VehicleState, before: Float64Array): number[] {
  const m = s.model, out = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const J = i < 2 ? m.wheelInertiaFront : m.wheelInertiaRear, r = i < 2 ? m.tyreFront.radius : m.tyreRear.radius;
    out[i] = J * (s.wheelOmega[i] - before[i]) / H + s.wheelFx[i] * r;
  }
  return out;
}

/** One substep with the given tyre forces held; returns the driveline's torque into each wheel. */
function once(s: VehicleState, c: Controls, gear: number, throttle: number, fx: readonly number[] = [0, 0, 0, 0]): number[] {
  const before = Float64Array.from(s.wheelOmega);
  for (let i = 0; i < 4; i++) s.wheelFx[i] = fx[i];
  drivelineStep(s, c, gear, throttle, H);
  return wheelTorques(s, before);
}

/**
 * A point-mass car on a flat road standing in for the tyres and the body: each tyre pushes with a force that grows
 * with its slip speed (4,000 N per m/s, about a real tyre's slip stiffness at 20 m/s) up to its grip, and the car
 * carries the pushes, less its drag, as a whole.
 */
type Road = { v: number; mass: number };
function tyresOn(s: VehicleState, road: Road): void {
  const cap = 1.1 * road.mass * GRAVITY / 4;
  for (let i = 0; i < 4; i++) {
    const r = i < 2 ? s.model.tyreFront.radius : s.model.tyreRear.radius;
    const f = 4000 * (s.wheelOmega[i] * r - road.v);
    s.wheelFx[i] = f > cap ? cap : f < -cap ? -cap : f;
  }
}
function bodyOn(s: VehicleState, road: Road): void {
  let push = 0;
  for (let i = 0; i < 4; i++) push += s.wheelFx[i];
  const drag = 0.5 * RHO_AIR * s.model.aero.dragArea * road.v * Math.abs(road.v);
  road.v += (push - drag) / road.mass * H;
}
function driveOn(s: VehicleState, c: Controls, gear: number, throttle: number, road: Road, seconds: number, each?: () => void): void {
  const n = Math.round(seconds / H);
  for (let k = 0; k < n; k++) {
    tyresOn(s, road);
    drivelineStep(s, c, gear, throttle, H);
    bodyOn(s, road);
    if (each) each();
  }
}

/** A 2.0 litre unboosted four: 158 hp at 6,500 rpm, 138 lb ft at 4,200 rpm, 6,700 rpm redline. */
const FOUR: EngineSpec = {
  kind: 'na', displacementL: 2.0, cylinders: 4, peakPower: 158 * HP, peakPowerOmega: 6500 * RPM,
  peakTorque: 138 * LBFT, peakTorqueOmegaLow: 4200 * RPM, peakTorqueOmegaHigh: 4200 * RPM,
  redline: 6700 * RPM, idle: 750 * RPM, boostPa: 0, inertia: 0.16, curve: null,
};
/** A 350 kW, 660 N m traction motor turning to 18,000 rpm. */
const MOTOR: EngineSpec = {
  kind: 'electric', displacementL: 0, cylinders: 0, peakPower: 350e3, peakPowerOmega: 350e3 / 660, peakTorque: 660,
  peakTorqueOmegaLow: 0, peakTorqueOmegaHigh: 350e3 / 660, redline: 18000 * RPM, idle: 0, boostPa: 0, inertia: 0.05, curve: null,
};
/** An eight-speed automatic behind a converter stalling at 2,300 rpm, multiplying 1.9, locking from second. */
const AUTOMATIC: Partial<DrivelineModel> = {
  transmission: 'automatic', gears: new Float64Array([4.7, 3.1, 2.1, 1.67, 1.29, 1.0, 0.84, 0.67]), finalDrive: 3.2,
  efficiency: 0.9, shiftTime: 0.25, shiftTorqueHold: 0.6, launch: 'converter',
  converter: { stallOmega: 2300 * RPM, torqueRatio: 1.9, couplingRatio: 0.88, lockGear: 2 },
};

describe('the clutch', () => {
  it('a locked clutch keeps the engine at ratio x final drive x the driven wheels, to 1e-9 rad/s, while the car pulls', () => {
    const s = createState(car());
    const road = { v: 15, mass: 1600 };
    rolling(s, 3, 15);
    let worst = 0, locked = 0, n = 0;
    driveOn(s, ctl(), 3, 1, road, 2, () => {
      worst = Math.max(worst, Math.abs(s.engineOmega - s.ratio * FINAL * drivenMean(s)));
      locked += s.clutchLocked; n++;
    });
    expect(n).toBe(960);
    expect(locked).toBe(n);
    expect(worst).toBeLessThan(1e-9);
    // 3rd gear and 430 N m pull the coupe at about 4 m/s^2: two seconds take it well past 20 m/s.
    expect(road.v).toBeGreaterThan(20);
    expect(s.engineOmega).toBeGreaterThan(THIRD * FINAL * 20 / R);
  });

  it('with the wheels in the air, full throttle in first spins engine and wheels up together at T / (Ie + sum J / (eff G^2))', () => {
    const s = createState(car());
    const G = FIRST * FINAL;   // 12.95
    s.engineOmega = 300; s.wheelOmega[2] = 300 / G; s.wheelOmega[3] = 300 / G;
    let impulse = 0;
    const start = s.engineOmega;
    for (let k = 0; k < 24; k++) { once(s, ctl(), 1, 1); impulse += s.engineTorque * H; }
    // Two 1.4 kg m^2 wheels seen through 12.95:1 (and the 92% box) add only 0.018 kg m^2 to the engine's 0.28.
    const referred = IE + 2 * JR / (ETA * G * G);
    expect(referred).toBeCloseTo(0.2981, 4);
    expect(rel(s.engineOmega - start, impulse / referred)).toBeLessThan(0.02);
    expect(s.engineOmega).toBeCloseTo(G * drivenMean(s), 9);
    // About 1,450 rad/s^2: the engine gains some 70 rad/s in 50 ms.
    expect(s.engineOmega - start).toBeGreaterThan(60);
  });

  it('a slipping clutch carries exactly capacity x engagement, whichever way it slips', () => {
    // Half a pedal on a 700 N m clutch: 350 N m. The engine is floored with the wheels held still.
    const s = createState(car());
    s.engineOmega = 500;
    for (let i = 0; i < 4; i++) s.wheelBrake[i] = 1e6;
    once(s, ctl({ autoClutch: false, clutch: 0.5 }), 1, 1);
    expect(s.clutchTorque).toBeCloseTo(350, 9);
    expect(s.clutchLocked).toBe(0);
    expect(s.engineOmega).toBeCloseTo(500 + (s.engineTorque - 350) * H / IE, 9);
    expect(s.wheelOmega[2]).toBe(0);

    // A bump start: the wheels turn the idling engine through the clutch, never with more than the clutch holds,
    // even fully closed (it would take some 40,000 N m to bring the engine to the wheels' speed in one substep).
    for (const pedal of [0.5, 0]) {
      const t = createState(car());
      t.engineOmega = 80; t.wheelOmega[2] = 30; t.wheelOmega[3] = 30;
      once(t, ctl({ autoClutch: false, clutch: pedal }), 1, 0);
      const cap = 700 * (1 - pedal);
      expect(t.clutchTorque).toBeCloseTo(-cap, 9);
      expect(t.engineOmega).toBeCloseTo(80 + (t.engineTorque + cap) * H / IE, 9);
      expect(t.engineOmega).toBeLessThan(FIRST * FINAL * drivenMean(t));
    }
  });

  it('with the auto-clutch, no throttle and the car at rest, the engine idles and the wheels get nothing', () => {
    const s = createState(car());
    const road = { v: 0, mass: 1600 };
    s.engineOmega = 50;   // below idle: the idle governor brings it up
    let drive = 0;
    driveOn(s, ctl(), 1, 0, road, 3, () => { drive = Math.max(drive, Math.abs(s.clutchTorque)); });
    expect(rel(s.engineOmega, s.model.engine.idle)).toBeLessThan(0.05);
    expect(drive).toBe(0);
    for (let i = 0; i < 4; i++) expect(s.wheelOmega[i]).toBe(0);
    expect(road.v).toBe(0);
  });

  it('a floored launch on the auto-clutch slips the clutch within its bite band and moves the car off', () => {
    // Bite at 1.15 x idle (84 rad/s), fully closed a quarter higher (105 rad/s): the 700 N m clutch then holds the
    // engine's 430, so it can only slip below that.
    const s = createState(car());
    const road = { v: 0, mass: 1600 };
    let slipping = 0, fastest = 0;
    driveOn(s, ctl(), 1, 1, road, 1, () => {
      if (s.clutchLocked === 0 && s.clutchTorque > 0) { slipping++; fastest = Math.max(fastest, s.engineOmega); }
    });
    expect(slipping).toBeGreaterThan(0);
    expect(fastest).toBeGreaterThan(1.15 * 73);
    expect(fastest).toBeLessThanOrEqual(1.25 * 1.15 * 73 + 1);
    expect(s.clutchLocked).toBe(1);
    expect(road.v).toBeGreaterThan(2);
  });

  it('with launchOmega set the clutch bites at that speed instead: a launch from 4,000 rpm', () => {
    const s = createState(car());
    const road = { v: 0, mass: 1600 };
    const launch = 4000 * RPM;
    let fastest = 0;
    driveOn(s, ctl({ launchOmega: launch }), 1, 1, road, 0.4, () => {
      if (s.clutchLocked === 0 && s.clutchTorque > 0) fastest = Math.max(fastest, s.engineOmega);
    });
    expect(fastest).toBeGreaterThan(launch);
    expect(fastest).toBeLessThanOrEqual(1.25 * launch + 1);
  });
});

describe('differentials', () => {
  // Second gear, clutch closed, both rear wheels at 20 rad/s. The left rear is on ice (no force); the right rear's
  // tyre holds it back with 2,500 N (825 N m).
  const ICE: readonly number[] = [0, 0, 0, 2500];
  function onIce(diffRear: DrivelineModel['diffRear']): { first: number[]; s: VehicleState } {
    const s = createState(car({ diffRear }));
    rolling(s, 2, 20 * R);
    const first = once(s, ctl(), 2, 0.6, ICE);
    for (let k = 0; k < 143; k++) once(s, ctl(), 2, 0.6, ICE);
    return { first, s };
  }

  it('an open differential gives both driven wheels the same torque even with one on ice, and the ice wheel runs away', () => {
    const { first, s } = onIce({ kind: 'open', preload: 0, lockPerTorque: 0 });
    expect(first[2]).toBeGreaterThan(50);
    expect(rel(first[2], first[3])).toBeLessThan(1e-9);
    expect(s.wheelOmega[2] - s.wheelOmega[3]).toBeGreaterThan(20);
  });

  it('a locked differential keeps both wheels at the same speed and sends the gripping wheel the torque', () => {
    const { first, s } = onIce({ kind: 'locked', preload: Infinity, lockPerTorque: 0 });
    expect(Math.abs(s.wheelOmega[2] - s.wheelOmega[3])).toBeLessThan(1e-9);
    expect(first[3] - first[2]).toBeGreaterThan(800);
  });

  it('a limited-slip one sits between: its locking torque (60 N m + 0.25 x axle torque) moves to the slower wheel', () => {
    const lsd = onIce({ kind: 'limited-slip', preload: 60, lockPerTorque: 0.25 });
    const open = onIce({ kind: 'open', preload: 0, lockPerTorque: 0 });
    const [, , left, right] = lsd.first;
    expect(right - left).toBeCloseTo(60 + 0.25 * (left + right), 6);
    // A torque bias ratio of about 1.67 plus the preload, not 1 (open) and not unlimited (locked).
    expect(right / left).toBeGreaterThan(1.67);
    expect(right / left).toBeLessThan(2.5);
    const slip = lsd.s.wheelOmega[2] - lsd.s.wheelOmega[3], openSlip = open.s.wheelOmega[2] - open.s.wheelOmega[3];
    expect(slip).toBeGreaterThan(1);
    expect(slip).toBeLessThan(openSlip);
  });
});

describe('differentials at the front, and behind a coupling', () => {
  const LSD: DrivelineModel['diffFront'] = { kind: 'limited-slip', preload: 60, lockPerTorque: 0.25 };
  /** Holds the given tyre forces for 0.3 s from 20 m/s in second, clutch closed; returns the first substep's wheel torques and the state. */
  function hold(d: Partial<DrivelineModel>, fx: readonly number[]): { first: number[]; s: VehicleState } {
    const s = createState(car(d));
    rolling(s, 2, 20 * R);
    const first = once(s, ctl(), 2, 0.6, fx);
    for (let k = 0; k < 143; k++) once(s, ctl(), 2, 0.6, fx);
    return { first, s };
  }

  it('a front-drive car\'s front limited-slip, with the left front on ice, moves its 60 N m + 0.25 x axle torque to the right', () => {
    const { first, s } = hold({ layout: 'FWD', diffFront: LSD }, [0, 2500, 0, 0]);
    const [left, right] = first;
    expect(left).toBeGreaterThan(50);
    expect(right - left).toBeCloseTo(60 + 0.25 * (left + right), 6);
    expect(s.wheelOmega[0] - s.wheelOmega[1]).toBeGreaterThan(1);
  });

  it('a front-drive car\'s locked front differential keeps both front wheels together and sends the gripping one the torque', () => {
    const { first, s } = hold({ layout: 'FWD', diffFront: { kind: 'locked', preload: Infinity, lockPerTorque: 0 } }, [0, 2500, 0, 0]);
    expect(Math.abs(s.wheelOmega[0] - s.wheelOmega[1])).toBeLessThan(1e-9);
    expect(first[1] - first[0]).toBeGreaterThan(800);
  });

  it('behind a coupling, a rear limited-slip locks with the torque its axle really gets: the clutch\'s, less what the coupling sends forward', () => {
    // Rear-driven with a coupling to the front (lockTorque 2,000 N m), the left rear on ice. The coupling takes some of
    // the drive to the front axle; the rear differential's lock follows what is left, not the gearbox's whole output.
    const awd: Partial<DrivelineModel> = {
      layout: 'AWD', centre: { kind: 'coupling', frontShare: 0, lockTorque: 2000 }, efficiency: 0.88,
      diffRear: { kind: 'limited-slip', preload: 60, lockPerTorque: 0.25 },
    };
    const { first } = hold(awd, [1500, 1500, 0, 2500]);
    const [fl, fr, left, right] = first;
    expect(fl + fr).toBeGreaterThan(100);                     // the coupling did send drive forward
    expect(right - left).toBeCloseTo(60 + 0.25 * (left + right), 6);
    // Against the gearbox's whole output the lock would be larger: the coupling's share matters.
    const s = createState(car(awd));
    rolling(s, 2, 20 * R);
    once(s, ctl(), 2, 0.6, [1500, 1500, 0, 2500]);
    const output = s.clutchTorque * 2.1 * 3.7 * 0.88;
    expect(60 + 0.25 * output - (right - left)).toBeGreaterThan(0.25 * 0.5 * (fl + fr));
  });
});

describe('brakes', () => {
  it('full brake torque holds a stopped wheel at exactly zero against a small drive torque', () => {
    // A clutch at a tenth carries 70 N m: 417 N m at each rear wheel, against 1,145 N m of full rear brake.
    const s = createState(car());
    const b = s.model.brakes;
    s.wheelBrake[0] = b.maxTorqueFront; s.wheelBrake[1] = b.maxTorqueFront;
    s.wheelBrake[2] = b.maxTorqueRear; s.wheelBrake[3] = b.maxTorqueRear;
    s.engineOmega = 300;
    const c = ctl({ autoClutch: false, clutch: 0.9 });
    for (let k = 0; k < 480; k++) {
      once(s, c, 1, 0.5);
      expect(s.clutchTorque).toBeCloseTo(70, 9);
      for (let i = 0; i < 4; i++) expect(s.wheelOmega[i]).toBe(0);
    }
    expect(70 * FIRST * FINAL * ETA / 2).toBeLessThan(b.maxTorqueRear);
  });

  it('a spinning wheel slows at brake torque / inertia, comes to rest and stays there', () => {
    const s = createState(car());
    const b = s.model.brakes;
    for (let i = 0; i < 4; i++) s.wheelOmega[i] = 40;
    s.wheelBrake[0] = b.maxTorqueFront; s.wheelBrake[1] = b.maxTorqueFront;
    s.wheelBrake[2] = b.maxTorqueRear; s.wheelBrake[3] = b.maxTorqueRear;
    once(s, ctl(), 0, 0);
    expect(s.wheelOmega[2]).toBeCloseTo(40 - b.maxTorqueRear * H / JR, 9);
    // 40 rad/s on 1.4 kg m^2 against 1,145 N m: stopped within 49 ms.
    for (let k = 0; k < 96; k++) once(s, ctl(), 0, 0);
    for (let k = 0; k < 480; k++) {
      once(s, ctl(), 0, 0);
      for (let i = 0; i < 4; i++) expect(s.wheelOmega[i]).toBe(0);
    }
  });
});

describe('shifting', () => {
  /** Full throttle in 2nd at 18 m/s, then a request for 3rd: what the wheels got through the shift and how it ended. */
  function shift(over: Partial<DrivelineModel>): { s: VehicleState; road: Road; steps: number; changedAt: number; worst: number; drive: number } {
    const s = createState(car(over));
    const road = { v: 18, mass: 1600 };
    rolling(s, 2, 18);
    driveOn(s, ctl(), 2, 1, road, 0.05);
    const hold = s.model.driveline.shiftTorqueHold;
    let steps = 0, changedAt = -1, worst = 0, drive = 0;
    do {
      const before = Float64Array.from(s.wheelOmega);
      tyresOn(s, road);
      drivelineStep(s, ctl(), 3, 1, H);
      bodyOn(s, road);
      const t = wheelTorques(s, before), atWheels = t[2] + t[3];
      const expected = hold * s.engineTorque * s.ratio * FINAL * ETA;
      worst = Math.max(worst, Math.abs(atWheels - expected));
      drive = Math.max(drive, Math.abs(atWheels));
      if (changedAt < 0 && s.gear === 3) changedAt = steps;
      steps++;
    } while (s.shiftTimer > 0 && steps < 1000);
    return { s, road, steps, changedAt, worst, drive };
  }

  it('a dual-clutch shift takes its 80 ms, keeps 90% of the drive, changes gear at half time and ends locked in 3rd', () => {
    const r = shift({ transmission: 'dual-clutch', shiftTime: 0.08, shiftTorqueHold: 0.9 });
    expect(Math.abs(r.steps * H - 0.08)).toBeLessThanOrEqual(H);
    expect(Math.abs((r.changedAt + 1) * H - 0.04)).toBeLessThanOrEqual(H);
    expect(r.drive).toBeGreaterThan(2000);           // about 0.9 x 400 N m x 7.8 x 0.92 at the wheels
    expect(r.worst).toBeLessThan(1e-6);
    const s = r.s;
    expect(s.gear).toBe(3);
    expect(rel(s.engineOmega, THIRD * FINAL * drivenMean(s))).toBeLessThan(0.01);
    tyresOn(s, r.road);
    drivelineStep(s, ctl(), 3, 1, H);
    expect(s.clutchLocked).toBe(1);
    expect(s.shiftTimer).toBe(0);
  });

  it('a manual shift takes its 0.3 s with the clutch open: no drive at all until it is done', () => {
    const r = shift({});
    expect(Math.abs(r.steps * H - 0.3)).toBeLessThanOrEqual(H);
    expect(Math.abs((r.changedAt + 1) * H - 0.15)).toBeLessThanOrEqual(H);
    expect(r.drive).toBeLessThan(1e-9);
    expect(rel(r.s.engineOmega, THIRD * FINAL * drivenMean(r.s))).toBeLessThan(0.01);
    // The engine came down from 2nd's speed to 3rd's: 2.1 / 1.5 = 1.4 times slower at the same road speed.
    expect(r.s.engineOmega).toBeLessThan(SECOND * FINAL * drivenMean(r.s) / 1.3);
  });

  it('a request mid-shift waits: the box finishes the shift it is in', () => {
    const s = createState(car());
    rolling(s, 2, 15);
    once(s, ctl(), 3, 0.5);
    expect(s.gearNext).toBe(3);
    for (let k = 0; k < 10; k++) once(s, ctl(), 4, 0.5);
    expect(s.gearNext).toBe(3);
  });
});

describe('the torque converter', () => {
  it('at stall it multiplies the engine torque by its torque ratio, 1.9', () => {
    const s = createState(car(AUTOMATIC));
    const stall = 2300 * RPM;
    s.engineOmega = stall;
    const t = once(s, ctl(), 1, 1);
    const G = 4.7 * 3.2;
    // Sized so that the pump takes exactly the engine's full-throttle torque at the stall speed.
    expect(s.clutchTorque).toBeCloseTo(engineTorque(s.model.engine, stall, 1, 1), 9);
    expect((t[2] + t[3]) / (G * 0.9 * s.clutchTorque)).toBeCloseTo(1.9, 9);
    expect(s.clutchLocked).toBe(0);
  });

  it('floored with the wheels held, it holds the engine at its stall speed, 2,300 rpm', () => {
    const s = createState(car(AUTOMATIC));
    for (let i = 0; i < 4; i++) s.wheelBrake[i] = 1e6;
    for (let k = 0; k < 1440; k++) once(s, ctl(), 1, 1);
    expect(rel(s.engineOmega, 2300 * RPM)).toBeLessThan(0.02);
    for (let i = 0; i < 4; i++) expect(s.wheelOmega[i]).toBe(0);
  });

  it('it creeps the car off at idle with the brake released, and locks up once in second at speed', () => {
    const s = createState(car(AUTOMATIC));
    const road = { v: 0, mass: 1600 };
    driveOn(s, ctl(), 1, 0, road, 2);
    expect(road.v).toBeGreaterThan(0.2);
    const t = createState(car(AUTOMATIC));
    const r2 = { v: 15, mass: 1600 };
    rolling(t, 2, 15);
    driveOn(t, ctl(), 2, 0.3, r2, 0.5);
    expect(t.clutchLocked).toBe(1);
    expect(t.engineOmega).toBeCloseTo(3.1 * 3.2 * drivenMean(t), 9);
  });
});

describe('the torque converter between stall and lock-up', () => {
  const G1 = 4.7 * 3.2, ETA2 = 0.9, IDLE = 73;
  /** The converter at a speed ratio sr in first (below lock-up): wheel torque over G x efficiency x pump torque, and that over the speed ratio. */
  function ratioAt(sr: number): { tr: number; pump: number } {
    const s = createState(car(AUTOMATIC));
    s.engineOmega = 3000 * RPM;
    for (let i = 0; i < 4; i++) s.wheelOmega[i] = sr * s.engineOmega / G1;
    const t = once(s, ctl(), 1, 0.5);
    expect(s.clutchLocked).toBe(0);
    return { tr: (t[2] + t[3]) / (G1 * (s.clutchTorque >= 0 ? ETA2 : 1 / ETA2) * s.clutchTorque), pump: s.clutchTorque };
  }

  it('multiplies torque by 1.9 at stall falling straight to 1 at the coupling point: 1.45 halfway', () => {
    expect(ratioAt(0.44).tr).toBeCloseTo(1.45, 9);
    expect(ratioAt(0.66).tr).toBeCloseTo(1.9 - 0.9 * 0.66 / 0.88, 9);
    expect(ratioAt(0.95).tr).toBeCloseTo(1, 9);
  });

  it('never gives out more power than it takes: torque ratio x speed ratio stays at or under 1 from stall to coupling', () => {
    for (let sr = 0.05; sr < 0.99; sr += 0.05) {
      const { tr, pump } = ratioAt(sr);
      expect(pump, `sr ${sr}`).toBeGreaterThan(0);
      expect(tr * sr, `sr ${sr}`).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('on the overrun, an unlocked converter lets the wheels drive the engine, and the box takes its loss from the wheels', () => {
    const { tr, pump } = ratioAt(1.3);
    expect(pump).toBeLessThan(0);
    expect(tr).toBeCloseTo(1, 9);   // wheel torque = pump x G / efficiency: more off the wheels than reaches the engine
  });

  it('locks up from its lock gear once the speed ratio passes the coupling point (0.88), and not before; never in first', () => {
    // A lock-up clutch strong enough to close the gap in one substep, so that engaging shows at once as locked.
    const at = (gear: number, sr: number): number => {
      const s = createState(car({ ...AUTOMATIC, clutchCapacity: 1e6 }));
      rolling(s, gear, 0);
      s.engineOmega = 2500 * RPM;
      for (let i = 0; i < 4; i++) s.wheelOmega[i] = sr * s.engineOmega / (AUTOMATIC.gears as Float64Array)[gear - 1] / 3.2;
      once(s, ctl(), gear, 0.3);
      return s.clutchLocked;
    };
    expect(at(2, 0.86)).toBe(0);
    expect(at(2, 0.90)).toBe(1);
    expect(at(3, 0.90)).toBe(1);
    expect(at(1, 0.95)).toBe(0);
  });

  it('a locked converter opens again as the turbine falls under 1.25 x idle, so a slowing car does not drag its engine down', () => {
    const at = (turbine: number): number => {
      const s = createState(car(AUTOMATIC));
      rolling(s, 3, 0);
      for (let i = 0; i < 4; i++) s.wheelOmega[i] = turbine / (2.1 * 3.2);
      s.engineOmega = turbine; s.clutchLocked = 1;
      once(s, ctl(), 3, 0);
      return s.clutchLocked;
    };
    expect(at(1.3 * IDLE)).toBe(1);
    expect(at(1.2 * IDLE)).toBe(0);
  });

  it('coasting in first, unlocked, on a closed throttle: the energy of car, wheels and engine never rises', () => {
    const s = createState(car(AUTOMATIC)), road = { v: 8, mass: 1600 };
    rolling(s, 1, 8);
    s.engineOmega = 2000 * RPM;
    const energy = (): number => {
      let e = 0.5 * road.mass * road.v * road.v + 0.5 * IE * s.engineOmega * s.engineOmega;
      for (let i = 0; i < 4; i++) e += 0.5 * (i < 2 ? 1.3 : JR) * s.wheelOmega[i] * s.wheelOmega[i];
      return e;
    };
    let before = energy(), rises = 0, k = 0;
    // While the wheels drive the engine (speed ratio over 1) and it is above its idle governor.
    for (; k < 4800 && s.engineOmega > 1.2 * IDLE && G1 * drivenMean(s) > s.engineOmega; k++) {
      tyresOn(s, road); drivelineStep(s, ctl(), 1, 0, H); bodyOn(s, road);
      expect(s.clutchLocked).toBe(0);
      const now = energy();
      if (now > before + 1e-9) rises++;
      before = now;
    }
    expect(k).toBeGreaterThan(100);
    expect(rises).toBe(0);
  });
});

describe('the CVT', () => {
  it('at full throttle it settles the engine at its power peak as the wheels speed up', () => {
    const e = buildEngine(FOUR);
    const peak = enginePeaks(e).powerOmega;   // about 6,500 rpm
    const s = createState(car({
      layout: 'FWD', transmission: 'cvt', gears: new Float64Array([2.6, 0.4]), finalDrive: 5.0, efficiency: 0.87,
      shiftTime: 0, shiftTorqueHold: 1, launch: 'converter', clutchCapacity: 300, cvtRatioRate: 1.5,
      converter: { stallOmega: 2100 * RPM, torqueRatio: 1.9, couplingRatio: 0.88, lockGear: 1 },
    }, e));
    const road = { v: 0, mass: 1400 };
    let controlling = 0, worst = 0, unlocked = 0;
    driveOn(s, ctl(), 1, 1, road, 15, () => {
      if (s.ratio < 2.6 * 0.99 && s.ratio > 0.4 * 1.01) {
        controlling++;
        worst = Math.max(worst, rel(s.engineOmega, peak));
        if (s.clutchLocked === 0) unlocked++;
      }
    });
    expect(controlling * H).toBeGreaterThan(5);
    expect(worst).toBeLessThan(0.03);
    expect(unlocked).toBe(0);
    expect(road.v).toBeGreaterThan(30);
  });
});

describe('a single-speed direct drive', () => {
  function ev(): VehicleState {
    return createState(car({
      transmission: 'single-speed', gears: new Float64Array([1]), finalDrive: 9, reverse: 1, launch: 'direct',
      shiftTime: 0, shiftTorqueHold: 1, efficiency: 0.94,
    }, buildEngine(MOTOR)));
  }

  it('keeps the motor at ratio x final drive x wheel speed, wheelspin and all', () => {
    const s = ev();
    const road = { v: 0, mass: 1600 };
    let worst = 0;
    driveOn(s, ctl(), 1, 1, road, 6, () => { worst = Math.max(worst, Math.abs(s.engineOmega - 9 * drivenMean(s))); });
    expect(worst).toBeLessThan(1e-9);
    expect(s.clutchLocked).toBe(1);
    expect(road.v).toBeGreaterThan(25);
  });

  it('stands still with no throttle: no creep', () => {
    const s = ev();
    const road = { v: 0, mass: 1600 };
    driveOn(s, ctl(), 1, 0, road, 2);
    expect(s.engineOmega).toBe(0);
    expect(road.v).toBe(0);
  });
});

describe('all-wheel drive', () => {
  it('a fixed centre splits the drive torque by its front share, 40:60', () => {
    const s = createState(car({ layout: 'AWD', centre: { kind: 'fixed', frontShare: 0.4, lockTorque: 0 } }));
    rolling(s, 2, 20 * R);
    const t = once(s, ctl(), 2, 1);
    const total = t[0] + t[1] + t[2] + t[3];
    expect(total).toBeGreaterThan(200);
    expect((t[0] + t[1]) / total).toBeCloseTo(0.4, 9);
    expect(t[0]).toBeCloseTo(t[1], 9);
    expect(t[2]).toBeCloseTo(t[3], 9);
  });

  it('an on-demand coupling sends the other axle up to its lock torque when the driven axle slips', () => {
    // Rear-driven, the rear on ice; the front tyres hold back with 4,000 N each (2,640 N m in all).
    const s = createState(car({ layout: 'AWD', centre: { kind: 'coupling', frontShare: 0, lockTorque: 2000 } }));
    rolling(s, 2, 20 * R);
    const t = once(s, ctl(), 2, 1, [4000, 4000, 0, 0]);
    expect(t[0] + t[1]).toBeCloseTo(2000, 6);
    expect(s.wheelOmega[2]).toBeGreaterThan(s.wheelOmega[0]);
    // Part-time four-wheel drive, engaged: front and rear turn together.
    const p = createState(car({ layout: 'AWD', centre: { kind: 'coupling', frontShare: 0, lockTorque: Infinity } }));
    rolling(p, 2, 20 * R);
    once(p, ctl(), 2, 1, [4000, 4000, 0, 0]);
    expect(Math.abs(0.5 * (p.wheelOmega[0] + p.wheelOmega[1]) - 0.5 * (p.wheelOmega[2] + p.wheelOmega[3]))).toBeLessThan(1e-9);
  });
});

describe('losses', () => {
  it('with efficiency below 1, less torque reaches the wheels than left the engine: 92% of it', () => {
    const s = createState(car());
    rolling(s, 2, 20 * R);
    const t = once(s, ctl(), 2, 1);
    const G = SECOND * FINAL;
    expect(s.clutchTorque).toBeGreaterThan(0);
    expect(t[2] + t[3]).toBeCloseTo(ETA * G * s.clutchTorque, 6);
    expect(t[2] + t[3]).toBeLessThan(G * s.clutchTorque);
  });

  it('on the overrun the engine brakes the wheels, and the box takes its loss from the wheels', () => {
    const s = createState(car());
    rolling(s, 3, 60 * R);
    const start = s.wheelOmega[2];
    const t = once(s, ctl(), 3, 0);
    const G = THIRD * FINAL;
    expect(s.engineTorque).toBeLessThan(-30);        // friction and pumping of a 5 litre engine at 3,200 rpm
    expect(s.clutchTorque).toBeLessThan(0);
    expect(t[2] + t[3]).toBeCloseTo(G * s.clutchTorque / ETA, 6);
    for (let k = 0; k < 239; k++) once(s, ctl(), 3, 0);
    expect(s.wheelOmega[2]).toBeLessThan(start - 1);
    expect(s.engineOmega).toBeCloseTo(G * drivenMean(s), 9);
  });

  it('a free wheel on the road slows only by its rolling resistance: 12.5 N m on a 4,000 N load, at any speed', () => {
    for (const omega of [30, 1, -1]) {
      const s = createState(car());
      for (let i = 0; i < 4; i++) { s.wheelLoad[i] = 4000; s.wheelOmega[i] = omega; }
      const t = once(s, ctl(), 0, 0);
      expect(t[2], `at ${omega} rad/s`).toBeCloseTo(-Math.sign(omega) * rollingResistance(s.model.tyreRear, 4000, 1) * R, 9);
      expect(t[2], `at ${omega} rad/s`).toBeCloseTo(-Math.sign(omega) * 0.0095 * 4000 * R, 9);
    }
    // Friction stops a slowing wheel and does not run it backward: one turning slower than the substep's worth of
    // rolling resistance ends at exactly zero.
    const slow = createState(car());
    for (let i = 0; i < 4; i++) { slow.wheelLoad[i] = 4000; slow.wheelOmega[i] = 0.5 * 0.0095 * 4000 * R * H / JR; }
    once(slow, ctl(), 0, 0);
    for (let i = 2; i < 4; i++) expect(slow.wheelOmega[i]).toBe(0);
    const still = createState(car());
    for (let i = 0; i < 4; i++) still.wheelLoad[i] = 4000;
    once(still, ctl(), 0, 0);
    for (let i = 0; i < 4; i++) expect(still.wheelOmega[i]).toBe(0);
  });
});

describe('nitrous', () => {
  /** A 100 hp shot from a small bottle, run on a dyno that holds the engine at `omega` in neutral. */
  function dyno(omega: number, button: boolean): { s: VehicleState; first: number; lasted: number; after: number } {
    const m = car();
    m.nitrous = { power: 100 * HP, bottleMass: 0.05, flow: 0.036 };   // 0.36 kg per 100 hp per 10 s
    const s = createState(m);
    let first = 0, lasted = 0, after = 0;
    for (let k = 0; k < 960; k++) {
      s.engineOmega = omega;
      const had = s.nitrousLeft;
      drivelineStep(s, ctl({ nitrous: button }), 0, 1, H);
      if (k === 0) first = s.engineTorque;
      if (had > 0 && s.nitrousLeft < had) lasted += H;
      after = s.engineTorque;
    }
    return { s, first, lasted, after };
  }

  it('adds its power while the bottle has some, empties the bottle, and stops', () => {
    const base = engineTorque(fixtureModel().engine, 500, 1, 0);
    const r = dyno(500, true);
    expect(r.first).toBeCloseTo(base + 100 * HP / 500, 9);   // 149 N m more at 4,775 rpm
    expect(Math.abs(r.lasted - 0.05 / 0.036)).toBeLessThanOrEqual(H);
    expect(r.s.nitrousLeft).toBe(0);
    expect(r.after).toBeCloseTo(base, 9);
  });

  it('does nothing without the button, or below its window switch', () => {
    const off = dyno(500, false);
    expect(off.s.nitrousLeft).toBe(0.05);
    expect(off.first).toBeCloseTo(engineTorque(fixtureModel().engine, 500, 1, 0), 9);
    const low = dyno(200, true);
    expect(low.s.nitrousLeft).toBe(0.05);
  });
});

describe('fuel and energy', () => {
  it('a petrol engine burns fuel for its airflow: about 230 g/kWh flat out, under a kg an hour at idle', () => {
    const s = createState(car());
    s.gear = 0; s.gearNext = 0;
    let fuel = 0, work = 0;
    for (let k = 0; k < 480; k++) {
      s.engineOmega = 500;
      const before = s.energyUsed;
      drivelineStep(s, ctl(), 0, 1, H);
      fuel += s.energyUsed - before;
      work += s.engineTorque * 500 * H;
    }
    const bsfc = fuel / work * 3.6e9;   // g per kWh
    expect(bsfc).toBeGreaterThan(220);
    expect(bsfc).toBeLessThan(300);
    // The air behind it: about 430 N m at the crank plus 40.5 N m of friction at 500 rad/s is 235 kW indicated, which
    // takes 0.20 kg of air a second, what a 5 litre engine breathes near its torque peak.
    expect(fuel * 14.7).toBeCloseTo((work + 40.5 * 500 * 1) / AIR_ENERGY, 9);
    expect(fuel * 14.7).toBeCloseTo(0.2046, 3);

    const idle = createState(car());
    idle.gear = 0; idle.gearNext = 0;
    for (let k = 0; k < 960; k++) drivelineStep(idle, ctl(), 0, 0, H);
    const start = idle.energyUsed;
    for (let k = 0; k < 480; k++) drivelineStep(idle, ctl(), 0, 0, H);
    const kgPerHour = (idle.energyUsed - start) * 3600;
    expect(kgPerHour).toBeGreaterThan(0.3);
    expect(kgPerHour).toBeLessThan(2);
  });

  it('an electric motor books its shaft energy in joules, and gives some back regenerating', () => {
    const s = createState(car({ transmission: 'single-speed', gears: new Float64Array([1]), finalDrive: 9, launch: 'direct' }, buildEngine(MOTOR)));
    s.gear = 0; s.gearNext = 0;
    let shaft = 0;
    for (let k = 0; k < 480; k++) {
      s.engineOmega = 300;
      drivelineStep(s, ctl(), 0, 1, H);
      shaft += s.engineTorque * 300 * H;
    }
    expect(s.energyUsed).toBeCloseTo(shaft, 6);
    expect(shaft).toBeCloseTo(198e3, -3);    // 660 N m at 300 rad/s for one second
    const used = s.energyUsed;
    s.engineOmega = 300;
    drivelineStep(s, ctl(), 0, 0, H);
    expect(s.energyUsed).toBeLessThan(used);
  });
});

describe('robustness', () => {
  function hashOf(s: VehicleState): number {
    let h = HASH_START;
    const scalars = [s.engineOmega, s.boost, s.engineTorque, s.clutchTorque, s.clutchLocked, s.gear, s.gearNext, s.shiftTimer, s.ratio, s.nitrousLeft, s.energyUsed];
    for (const x of scalars) h = hashNumber(h, x);
    for (let i = 0; i < 4; i++) h = hashNumber(h, s.wheelOmega[i]);
    return h;
  }
  function randomRun(seed: number): { hash: number; minEngine: number; s: VehicleState } {
    const m = car({ diffRear: { kind: 'limited-slip', preload: 60, lockPerTorque: 0.25 } });
    m.nitrous = { power: 75 * HP, bottleMass: 2, flow: 0.027 };
    const s = createState(m);
    const next = rng(seed);
    const c = ctl();
    let minEngine = Infinity;
    for (let k = 0; k < 4800; k++) {
      if (k % 60 === 0) {
        c.nitrous = next() < 0.3; c.autoClutch = next() < 0.8; c.clutch = next();
      }
      const gear = Math.floor(next() * 8) - 1;
      for (let i = 0; i < 4; i++) { s.wheelFx[i] = (next() - 0.3) * 6000; s.wheelBrake[i] = next() < 0.2 ? next() * 3000 : 0; s.wheelLoad[i] = 4000 * next(); }
      drivelineStep(s, c, k % 40 === 0 ? gear : 99, next(), H);
      minEngine = Math.min(minEngine, s.engineOmega);
    }
    return { hash: hashOf(s), minEngine, s };
  }

  it('the same inputs give the same bits, twice over', () => {
    const a = randomRun(7), b = randomRun(7);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(hashOf(createState(car())));
    expect(randomRun(8).hash).not.toBe(a.hash);
    // A combustion engine is never turned backward, whatever is done to it.
    expect(a.minEngine).toBeGreaterThanOrEqual(0);
  });

  it('every input zero makes no NaN, whatever the gearbox', () => {
    const zero: Controls = {
      steer: 0, throttle: 0, brake: 0, handbrake: 0, clutch: 0, gear: 0, autoClutch: false,
      abs: false, tcs: false, esc: false, launchOmega: 0, nitrous: false,
    };
    const models: VehicleModel[] = [
      car(), car(AUTOMATIC),
      car({ transmission: 'cvt', gears: new Float64Array([2.6, 0.4]), launch: 'converter', cvtRatioRate: 1.5, converter: { stallOmega: 220, torqueRatio: 1.9, couplingRatio: 0.88, lockGear: 1 } }),
      car({ transmission: 'ecvt', gears: new Float64Array([2.6, 0.4]), launch: 'direct', cvtRatioRate: 3 }),
      car({ transmission: 'single-speed', gears: new Float64Array([1]), finalDrive: 9, launch: 'direct' }, buildEngine(MOTOR)),
      car({ layout: 'AWD', centre: { kind: 'coupling', frontShare: 0, lockTorque: Infinity } }),
    ];
    for (const m of models) {
      const s = createState(m);
      s.engineOmega = 0; s.ratio = 0; s.gear = 0; s.gearNext = 0; s.boost = 0;
      for (const gear of [0, 1, -1]) {
        for (const h of [H, 0]) for (let k = 0; k < 240; k++) drivelineStep(s, zero, gear, 0, h);
      }
      const all = [s.engineOmega, s.boost, s.engineTorque, s.clutchTorque, s.clutchLocked, s.gear, s.gearNext, s.shiftTimer, s.ratio, s.nitrousLeft, s.energyUsed, ...s.wheelOmega];
      for (const x of all) expect(Number.isFinite(x)).toBe(true);
    }
  });

  it('reverse drives the wheels backward with the engine still turning forward', () => {
    const s = createState(car());
    const road = { v: 0, mass: 1600 };
    driveOn(s, ctl(), -1, 0.4, road, 1.5);
    expect(s.gear).toBe(-1);
    expect(road.v).toBeLessThan(-1);
    expect(s.wheelOmega[2]).toBeLessThan(0);
    expect(s.engineOmega).toBeGreaterThan(0);
  });
});
