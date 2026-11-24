// The bench on the fixture coupe (1,600 kg, rear drive, summer tyres, 300 kW, six-speed manual), checked against what
// the physics says each test must give: a stop from the tyres' own friction with the load moved forward, a top speed
// where the engine's full-throttle torque through the best gear meets drag and rolling resistance, a skidpad figure
// under the tyres' friction limit, and a launch at the rear tyres' traction limit.
import { describe, expect, it } from 'vitest';
import type { BenchResult, PhysicsSheet, VehicleModel } from './types';
import { MOVING, copyState, frictionLimit, launchSpeeds, runBench, setRolling, skidpadAt, topSpeedOf } from './bench';
import { sheetById } from './data/sheets';
import { brakeDriver, cruiseDriver } from './drivers';
import { resolveModel } from './resolve';
import { enginePeaks, engineTorque } from './engine';
import { fixtureModel } from './fixtures';
import { G, RHO_AIR } from './math';
import { shiftUpOmega } from './systems';
import { FLAT, defaultControls } from './state';
import { tyreMuX } from './tyre';
import { FT, HP, LBFT, MPH, RPM } from './units';
import { createVehicle, hashState, step } from './vehicle';

const fixture = fixtureModel();
const bench = runBench(fixture);

/**
 * The deceleration, m/s^2, when every tyre brakes at its peak friction: a = sum mu_x(Fz) Fz / m, with Fz moved forward
 * by m a h / L (solved by repeating it: the load moved depends on the deceleration).
 */
function frictionStop(m: VehicleModel): number {
  const c = m.chassis, L = c.a + c.b;
  let a = 9;
  for (let k = 0; k < 50; k++) {
    const shift = c.mass * a * c.cgHeight / L;
    const front = 0.5 * (c.mass * G * c.b / L + shift), rear = 0.5 * (c.mass * G * c.a / L - shift);
    a = 2 * (tyreMuX(m.tyreFront, front, 1) * front + tyreMuX(m.tyreRear, rear, 1) * rear) / c.mass;
  }
  return a;
}

/**
 * The speed, m/s, where full-throttle drive in the best gear meets the road load: air drag, the tyres' rolling
 * resistance, and the driven tyres' own slip (the wheels turn that much faster than the car, so the engine does too).
 */
function flatOutSpeed(m: VehicleModel): number {
  const d = m.driveline, e = m.engine, c = m.chassis, R = m.tyreRear.radius;
  const rearLoad = 0.5 * c.mass * G * c.a / (c.a + c.b);
  let top = 0;
  for (let v = 1; v < 150; v += 0.005) {
    const resist = 0.5 * RHO_AIR * m.aero.dragArea * v * v + m.tyreRear.rollRes * c.mass * G;
    const slip = 0.5 * resist / (m.tyreRear.cKappaPerFz * rearLoad);
    let drive = 0;
    for (let g = 0; g < d.gears.length; g++) {
      const G2 = d.gears[g] * d.finalDrive, w = v * (1 + slip) / R * G2;
      drive = Math.max(drive, engineTorque(e, w, 1, 1) * G2 * d.efficiency / R);
    }
    if (drive >= resist) top = v;
  }
  return top;
}

describe('braking', () => {
  const ideal = frictionStop(fixture);

  it('the friction a 1,600 kg car on summer tyres can brake with is about 1.09 g', () => {
    expect(ideal / G).toBeGreaterThan(1.05);
    expect(ideal / G).toBeLessThan(1.12);
  });

  it('stops from 60 mph within a few percent of the distance its tyres allow (ABS gives a little back)', () => {
    const best = (60 * MPH) * (60 * MPH) / (2 * ideal) / FT;          // about 110 ft
    expect(bench.braking60).toBeGreaterThan(0.98 * best);            // drag helps a little, ABS never beats the tyres
    expect(bench.braking60).toBeLessThan(1.08 * best);
    expect(bench.braking60).toBeGreaterThan(100);
    expect(bench.braking60).toBeLessThan(125);
  });

  it('needs (70/60)^2 as far from 70 mph, a little less for the extra drag', () => {
    const ratio = bench.braking70 / bench.braking60;
    expect(ratio).toBeGreaterThan(1.30);
    expect(ratio).toBeLessThan(1.37);   // (7/6)^2 = 1.361
  });
});

describe('an all-wheel-drive car on different tyre sizes front and rear', () => {
  // The GT-R sheet: 255/40 front and 285/35 rear give loaded radii of 0.3453 and 0.3431 m, joined by a 2,000 N m
  // coupling. Its transfer gearing is matched to its tyres, so the coupling holds the axles' road speeds together; it
  // must not wind them against each other (which would hold the rears 0.6% slip past the fronts under braking, where
  // brake-force distribution would then trim the rear brakes away for the whole stop).
  const sheet = (): PhysicsSheet => { const s = sheetById('2024-nissan-gt-r-nismo'); if (s === null) throw new Error('no GT-R sheet'); return s; };
  const built = resolveModel(sheet()).model;
  const matched = resolveModel(sheet()).model;
  matched.tyreRear.radius = matched.tyreFront.radius;

  it('stops from 60 mph within 1% of the same car on equal radii, its rear brakes no more trimmed than that car\'s', () => {
    expect(built.driveline.centre.kind).toBe('coupling');
    expect(built.tyreRear.radius).toBeLessThan(0.995 * built.tyreFront.radius);
    const a = runBench(built, 'brake'), b = runBench(matched, 'brake');
    expect(Math.abs(a.braking60 / b.braking60 - 1), `${a.braking60} ft against ${b.braking60}`).toBeLessThan(0.01);
    expect(Math.abs(a.braking70 / b.braking70 - 1), `${a.braking70} ft against ${b.braking70}`).toBeLessThan(0.01);
    // How far brake-force distribution holds the rear brakes back through the stop (above 3 m/s): the mean and the
    // least of the two rear wheels' hold factors, against the same car on matched tyres.
    const hold = (m: VehicleModel): { mean: number; least: number } => {
      const s = createVehicle(m), c = defaultControls(), brake = brakeDriver();
      setRolling(s, 60 * MPH, 0);
      let sum = 0, n = 0, least = 1;
      while (s.u > 3) { brake.control(s, c); step(s, c, FLAT); sum += s.absHold[2] + s.absHold[3]; n += 2; least = Math.min(least, s.absHold[2], s.absHold[3]); }
      return { mean: sum / n, least };
    };
    const ours = hold(built), theirs = hold(matched);
    expect(Math.abs(ours.mean - theirs.mean), `mean rear hold ${ours.mean} against ${theirs.mean}`).toBeLessThan(0.05);
    expect(Math.abs(ours.least - theirs.least), `least rear hold ${ours.least} against ${theirs.least}`).toBeLessThan(0.05);
  });

  it('cruising at 60 mph, both axles push forward: the coupling does not set one against the other', () => {
    const s = createVehicle(built), c = defaultControls(), cruise = cruiseDriver(60 * MPH);
    setRolling(s, 60 * MPH, 0);
    for (let k = 0; k < 1200; k++) { cruise.control(s, c); step(s, c, FLAT); }
    expect(Math.abs(s.u / (60 * MPH) - 1)).toBeLessThan(0.01);
    expect(c.brake).toBe(0);
    for (let i = 0; i < 4; i++) expect(s.wheelFx[i], `wheel ${i}`).toBeGreaterThan(0);
  });
});

describe('top speed', () => {
  it('flat out, it settles where full-throttle drive in the best gear meets drag and rolling resistance', () => {
    const v = flatOutSpeed(fixture);
    expect(v / MPH).toBeGreaterThan(150);
    expect(bench.topSpeed / (v / MPH)).toBeGreaterThan(0.985);
    expect(bench.topSpeed / (v / MPH)).toBeLessThan(1.01);
    expect(bench.topSpeedGoverned).toBe(false);
  });

  it('governed a little under its flat-out speed, it tops out at its governor within the plan\'s 1 mph', () => {
    for (const share of [0.8, 0.9]) {
      const set = share * bench.topSpeed;
      const t = topSpeedOf(fixtureModel({ systems: { limiterSpeed: set * MPH } }));
      expect(t.governed).toBe(true);
      expect(Math.abs(t.mph - set)).toBeLessThan(1);
    }
  });
});

describe('skidpad', () => {
  it('corners under the friction its tyres have at their static loads, and not far under it', () => {
    const limit = frictionLimit(fixture) / G;
    expect(limit).toBeCloseTo(1.02, 1);
    expect(bench.skidpad300).toBeLessThan(limit);
    // Load moving to the outer tyres costs grip (load sensitivity), and one axle saturates before the other.
    expect(bench.skidpad300).toBeGreaterThan(0.85 * limit);
  });

  it('gives about the same figure on a 200 ft circle as on a 300 ft one', () => {
    expect(Math.abs(bench.skidpad200 / bench.skidpad300 - 1)).toBeLessThan(0.05);
  });

  it('corners harder on stickier tyres, in proportion to the friction', () => {
    const sticky = fixtureModel({ tyreFront: { muY0: 1.12 }, tyreRear: { muY0: 1.12 } });
    const gain = skidpadAt(sticky, 300) / bench.skidpad300;
    expect(gain).toBeGreaterThan(1.05);
    expect(gain).toBeLessThan(1.12);   // 1.12 / 1.02 = 1.098
  });
});

describe('acceleration', () => {
  const c = fixture.chassis, L = c.a + c.b;

  it('pulls away at the rear tyres\' traction limit, about mu g (a / L) / (1 - mu h / L)', () => {
    const rear = 0.5 * c.mass * G * c.a / L * 1.3;   // the rear's load at about 0.6 g
    const mu = tyreMuX(fixture.tyreRear, rear, 1);
    const limit = mu * G * (c.a / L) / (1 - mu * c.cgHeight / L);   // about 6.3 m/s^2
    const ideal = 30 * MPH / limit;
    expect(bench.zeroToThirty).toBeGreaterThan(ideal);
    expect(bench.zeroToThirty).toBeLessThan(1.15 * ideal);
  });

  it('times the rollout as the first foot: a few tenths of a second at that launch', () => {
    const foot = bench.zeroToSixty - bench.zeroToSixtyRollout;
    expect(foot).toBeGreaterThan(0.15);
    expect(foot).toBeLessThan(0.45);
  });

  it('writes a timeslip whose marks come in order and whose trap speed is the car\'s speed at the line', () => {
    const t = bench.timeslip;
    expect(t.sixtyFoot).toBeGreaterThan(1.5);
    expect(t.sixtyFoot).toBeLessThan(t.threeThirty);
    expect(t.threeThirty).toBeLessThan(t.eighth);
    expect(t.eighth).toBeLessThan(t.thousand);
    expect(t.thousand).toBeLessThan(t.quarter);
    expect(t.eighthMph).toBeLessThan(t.trapMph);
    // A quarter mile at a steadily falling acceleration averages well under its trap speed.
    expect(1320 * FT / t.quarter / MPH).toBeLessThan(0.75 * t.trapMph);
    expect(1320 * FT / t.quarter / MPH).toBeGreaterThan(0.5 * t.trapMph);
  });

  it('settles on one of the launch speeds it tried, and shifts within 4% of the car\'s own shift point', () => {
    const tried = launchSpeeds(fixture).map((w) => w / RPM);
    expect(tried.length).toBe(5);
    expect(tried.some((w) => Math.abs(w - bench.launchRpm) < 1e-6)).toBe(true);
    const own = shiftUpOmega(fixture, 1) / RPM;
    expect(bench.shiftRpm).toBeGreaterThanOrEqual(0.96 * own - 1e-6);
    expect(bench.shiftRpm).toBeLessThanOrEqual(Math.min(1.04 * own, fixture.engine.redline / RPM) + 1e-6);
  });

  it('starts the clock at the first movement: a launch reaches 0.01 m/s within a few milliseconds of moving at all', () => {
    expect(MOVING).toBe(0.01);
    // At the launch's 0.6 g, 0.01 m/s comes 1.7 ms after the start: the 0-60 is not shortened by it.
    expect(MOVING / (0.6 * G)).toBeLessThan(0.002);
  });
});

describe('the dyno', () => {
  it('reads the engine\'s own full-throttle table: peak power and torque in hp and lb ft, at their rpm', () => {
    const p = enginePeaks(fixture.engine);
    expect(bench.peakHp).toBeCloseTo(p.power / HP, 9);
    expect(bench.peakHpRpm).toBeCloseTo(p.powerOmega / RPM, 9);
    expect(bench.peakTorqueLbFt).toBeCloseTo(p.torque / LBFT, 9);
    expect(bench.peakTorqueRpm).toBeCloseTo(p.torqueOmega / RPM, 9);
    expect(bench.peakHp).toBeGreaterThan(380);   // the fixture's 289 kW at its 7,000 rpm limiter
  });
});

describe('setting a run aside', () => {
  it('copyState takes every number: the copy hashes the same and, driven on alike, stays the same bit for bit', () => {
    const a = createVehicle(fixture), c = defaultControls();
    c.throttle = 0.7; c.steer = 0.2;
    for (let k = 0; k < 300; k++) step(a, c, FLAT);
    const b = createVehicle(fixture);
    copyState(a, b);
    expect(hashState(b)).toBe(hashState(a));
    for (let k = 0; k < 300; k++) { step(a, c, FLAT); step(b, c, FLAT); }
    expect(hashState(b)).toBe(hashState(a));
    expect(a.u).toBeGreaterThan(10);
  });
});

describe('the bench as a whole', () => {
  it('runs one test alone, leaving the others NaN', () => {
    const b = runBench(fixture, 'brake');
    expect(b.braking60).toBe(bench.braking60);
    expect(b.zeroToSixty).toBeNaN();
    expect(b.skidpad300).toBeNaN();
    expect(b.topSpeed).toBeNaN();
  });

  it('gives the same figures, bit for bit, every time', () => {
    const again: BenchResult = runBench(fixture);
    expect(again).toEqual(bench);
  });
});
