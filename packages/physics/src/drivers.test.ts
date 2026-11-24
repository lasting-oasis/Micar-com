// The reference drivers on the fixture coupe (1,600 kg, rear drive, summer tyres, 300 kW, six-speed manual), and a
// converter automatic made from it: each drives as the bench needs, and the car responds as physics says it must.
import { describe, expect, it } from 'vitest';
import type { Controls, VehicleModel, VehicleState } from './types';
import { AUTO_GEAR } from './types';
import { setRolling } from './bench';
import {
  CIRCLE_ENGINE_SHARE, STAGE_TIME, brakeDriver, circleDriver, crankTorqueFor, cruiseDriver, flatOutDriver, holdingGear,
  launchDriver, restControls, stageSpeed, tractionLimit, worstDrivenSlip,
} from './drivers';
import { fixtureModel } from './fixtures';
import { G } from './math';
import { FLAT, defaultControls } from './state';
import { peakSlipRatio, tyreMuX } from './tyre';
import { RPM } from './units';
import { STEP, createVehicle, hashState, step, telemetry } from './vehicle';
import { createTelemetry } from './state';

const fixture = fixtureModel();
const automatic = (): VehicleModel => fixtureModel({ driveline: {
  transmission: 'automatic', launch: 'converter', shiftTime: 0.25, shiftTorqueHold: 0.6, efficiency: 0.9,
  converter: { stallOmega: 2300 * RPM, torqueRatio: 1.9, couplingRatio: 0.88, lockGear: 2 },
} });
const seconds = (t: number): number => Math.round(t / STEP);

describe('reading the driven wheels', () => {
  it('a wheel rolling with the road is not slipping; one turning 10% fast at 20 m/s is 0.1 over a peak slip of about 0.12', () => {
    const s = createVehicle(fixture);
    setRolling(s, 20, 0);
    expect(worstDrivenSlip(s, 1)).toBeLessThan(1e-9);
    s.wheelOmega[3] *= 1.1;
    const peak = peakSlipRatio(fixture.tyreRear, s.wheelLoad[3], 1);
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThan(0.14);
    expect(worstDrivenSlip(s, 1)).toBeCloseTo(0.1 / peak, 9);
    // The front wheels are not driven on this car: their spin is not wheelspin.
    s.wheelOmega[3] /= 1.1; s.wheelOmega[0] *= 1.3;
    expect(worstDrivenSlip(s, 1)).toBeLessThan(1e-9);
  });

  it('the drive the tyres can take: the driven axle\'s friction, or the split the centre allows', () => {
    const s = createVehicle(fixture);
    const muF = (i: number): number => tyreMuX(i < 2 ? fixture.tyreFront : fixture.tyreRear, s.wheelLoad[i], 1) * s.wheelLoad[i];
    const front = muF(0) + muF(1), rear = muF(2) + muF(3);
    expect(tractionLimit(s)).toBeCloseTo(rear, 9);                       // rear drive: about 8,200 N
    expect(rear).toBeGreaterThan(7800);
    const fixed = createVehicle(fixtureModel({ driveline: { layout: 'AWD', centre: { kind: 'fixed', frontShare: 0.4, lockTorque: 0 } } }));
    expect(tractionLimit(fixed)).toBeCloseTo(Math.min(front / 0.4, rear / 0.6), 9);   // the rear saturates first
    const coupled = createVehicle(fixtureModel({ driveline: { layout: 'AWD', centre: { kind: 'coupling', frontShare: 0, lockTorque: 2000 } } }));
    expect(tractionLimit(coupled)).toBeCloseTo(rear + Math.min(front, 2000 / fixture.tyreFront.radius), 9);
  });

  it('the crank torque for a drive force: through first gear\'s 12.95:1 and the box\'s 92%, plus spinning the engine up with the car', () => {
    const s = createVehicle(fixture);
    s.clutchLocked = 1;
    const G2 = 3.5 * 3.7, R = fixture.tyreRear.radius;
    expect(crankTorqueFor(s, 8000, 5)).toBeCloseTo(8000 * R / (G2 * 0.92) + 0.28 * G2 * 5 / R, 9);   // 222 + 55 N m
    s.ratio = 0;
    expect(crankTorqueFor(s, 8000, 5)).toBe(Infinity);
  });
});

describe('the launch driver', () => {
  function launch(model: VehicleModel, launchRpm: number, share: number, until: (s: VehicleState) => boolean, each?: (s: VehicleState, c: Controls) => void): VehicleState {
    const s = createVehicle(model), c = defaultControls(), d = launchDriver(model, launchRpm * RPM, share);
    for (let k = 0; k < seconds(40) && !until(s); k++) { d.control(s, c); step(s, c, FLAT); if (each) each(s, c); }
    return s;
  }

  it('a clutch car stands still until the engine reaches the launch speed, then the clutch bites there', () => {
    let firstMove = NaN;
    launch(fixture, 4000, 1, (s) => s.time > 1, (s) => { if (firstMove !== firstMove && s.x > 1e-4) firstMove = s.engineOmega / RPM; });
    expect(firstMove).toBeGreaterThan(4000);
    expect(firstMove).toBeLessThan(4000 * 1.25);
  });

  it('a converter car is held on the brake at its launch speed, as high as the brakes hold it, then let go', () => {
    const model = automatic();
    const at = (launchRpm: number): { s: VehicleState; c: Controls; d: ReturnType<typeof launchDriver> } => {
      const s = createVehicle(model), c = defaultControls(), d = launchDriver(model, launchRpm * RPM, 1);
      for (let k = 0; k < seconds(STAGE_TIME) - 1; k++) { d.control(s, c); step(s, c, FLAT); }
      return { s, c, d };
    };
    // Just over idle the brakes hold the converter's small torque: the engine is at the launch speed, the car still.
    const low = at(1000);
    expect(low.d.released).toBe(false);
    expect(low.c.brake).toBe(1);
    expect(low.s.engineOmega / RPM).toBeGreaterThan(950);
    expect(low.s.engineOmega / RPM).toBeLessThan(1050);
    expect(Math.abs(low.s.x)).toBeLessThan(1e-4);
    // Asked for 1,800 rpm, the rear brakes (34% of a 1.3 g pedal) cannot hold the converter there: the driver stages
    // as high as they hold, and the car does not creep off the line.
    const high = at(1800);
    const held = stageSpeed(model, 1800 * RPM);
    expect(held / RPM).toBeGreaterThan(1050);
    expect(held / RPM).toBeLessThan(1300);
    expect(high.s.engineOmega / held).toBeGreaterThan(0.97);
    expect(high.s.engineOmega / held).toBeLessThan(1.01);
    expect(Math.abs(high.s.x)).toBeLessThan(1e-4);
    for (let k = 0; k < 3; k++) { high.d.control(high.s, high.c); step(high.s, high.c, FLAT); }
    expect(high.d.released).toBe(true);
    expect(high.c.brake).toBe(0);
  });

  it('works the driven tyres at their peak in first gear: the car pulls at their traction limit and the tyres use about all of their grip', () => {
    const out = createTelemetry();
    let use = 0, samples = 0, accel = 0;
    launch(fixture, 1000, 1, (s) => s.gear > 1, (s) => {
      if (s.time > 0.8 && s.shiftTimer === 0) {
        telemetry(s, out);
        use += 0.5 * (out.wheelUse[2] + out.wheelUse[3]); accel += s.ax; samples++;
      }
    });
    const c = fixture.chassis, L = c.a + c.b;
    const rear = 0.5 * c.mass * G * c.a / L * 1.3;
    const mu = tyreMuX(fixture.tyreRear, rear, 1);
    const limit = mu * G * (c.a / L) / (1 - mu * c.cgHeight / L);
    expect(samples).toBeGreaterThan(50);
    expect(use / samples).toBeGreaterThan(0.85);
    expect(use / samples).toBeLessThan(1.15);
    expect(accel / samples / limit).toBeGreaterThan(0.93);
    expect(accel / samples / limit).toBeLessThan(1.02);
  });

  it('changes up when the engine reaches the shift speed it was given', () => {
    const d = launchDriver(fixture, 1000 * RPM, 0.96);
    const at: number[] = [];
    const s = createVehicle(fixture), c = defaultControls();
    for (let k = 0; k < seconds(20) && s.gear < 4; k++) {
      const before = c.gear;
      d.control(s, c);
      if (c.gear !== before && before !== AUTO_GEAR && c.gear > before) at.push(s.engineOmega);
      step(s, c, FLAT);
    }
    expect(at.length).toBeGreaterThanOrEqual(2);
    for (let g = 0; g < at.length; g++) {
      expect(at[g] / d.shiftOmega[g]).toBeGreaterThanOrEqual(1);
      expect(at[g] / d.shiftOmega[g]).toBeLessThan(1.02);   // within a step's worth of revs
    }
  });

  it('is deterministic: the same launch twice gives the same state, bit for bit', () => {
    const a = launch(fixture, 3000, 1, (s) => s.time > 6), b = launch(fixture, 3000, 1, (s) => s.time > 6);
    expect(hashState(a)).toBe(hashState(b));
    expect(a.x).toBeGreaterThan(50);
  });
});

describe('the straight-line drivers', () => {
  it('flat out: full throttle, the car\'s own gears and systems', () => {
    const c = defaultControls();
    flatOutDriver().control(createVehicle(fixture), c);
    expect(c.throttle).toBe(1);
    expect(c.brake).toBe(0);
    expect(c.gear).toBe(AUTO_GEAR);
    expect(c.abs && c.tcs && c.esc).toBe(true);
  });

  it('braking: full pedal, throttle shut, ABS as fitted', () => {
    const c = defaultControls();
    c.throttle = 1;
    brakeDriver().control(createVehicle(fixture), c);
    expect(c.brake).toBe(1);
    expect(c.throttle).toBe(0);
    expect(c.abs).toBe(true);
  });

  it('cruise: holds 25 m/s within a few centimetres a second against drag and rolling resistance', () => {
    const s = createVehicle(fixture), c = defaultControls(), d = cruiseDriver(25);
    setRolling(s, 20, 0);
    for (let k = 0; k < seconds(20); k++) { d.control(s, c); step(s, c, FLAT); }
    expect(Math.abs(s.u - 25)).toBeLessThan(0.05);
    expect(c.throttle).toBeGreaterThan(0.05);   // it takes throttle to hold a speed
  });

  it('restControls puts every control back to rest', () => {
    const c = defaultControls();
    c.steer = 0.7; c.throttle = 1; c.brake = 1; c.handbrake = 1; c.gear = 3; c.esc = false; c.launchOmega = 400;
    restControls(c);
    expect(c).toEqual(defaultControls());
  });
});

describe('the circle driver', () => {
  it('holds a 50 m circle at 15 m/s: on the line within 0.2 m, at v^2 / r = 0.46 g, stability control off', () => {
    const R = 50, v = 15;
    const s = createVehicle(fixture), c = defaultControls(), d = circleDriver(fixture, 0, R, R, v, 0);
    setRolling(s, v, v / R);
    let worst = 0, ay = 0, n = 0;
    for (let k = 0; k < seconds(25); k++) {
      d.control(s, c); step(s, c, FLAT);
      if (s.time > 10) { worst = Math.max(worst, Math.abs(d.wide)); ay += s.ay; n++; }
    }
    expect(c.esc).toBe(false);
    expect(worst).toBeLessThan(0.2);
    expect(Math.abs(s.u - v)).toBeLessThan(0.1);
    expect(ay / n / G).toBeCloseTo(v * v / R / G, 1);
    expect(ay / n / (v * v / R)).toBeGreaterThan(0.97);
    expect(ay / n / (v * v / R)).toBeLessThan(1.03);
  });

  it('turns left round a centre on its left, and its speed rises as it was told', () => {
    const R = 40;
    const s = createVehicle(fixture), c = defaultControls(), d = circleDriver(fixture, 0, R, R, 10, 0.2);
    setRolling(s, 10, 10 / R);
    for (let k = 0; k < seconds(10); k++) { d.control(s, c); step(s, c, FLAT); }
    expect(c.steer).toBeGreaterThan(0);
    expect(s.r).toBeGreaterThan(0);
    expect(d.target).toBeCloseTo(10 + 0.2 * (s.time - STEP), 9);   // aimed at when it last looked, a step ago
    expect(Math.abs(s.u - 12)).toBeLessThan(0.3);
  });

  it('holds the gear that turns the engine nearest half its redline', () => {
    const v = 20, wheel = v / fixture.tyreRear.radius;
    const g = holdingGear(fixture, v);
    const miss = (k: number): number => Math.abs(fixture.driveline.gears[k - 1] * 3.7 * wheel - CIRCLE_ENGINE_SHARE * fixture.engine.redline);
    for (let k = 1; k <= 6; k++) expect(miss(g)).toBeLessThanOrEqual(miss(k));
    expect(g).toBe(3);   // 1.5 x 3.7 x 60.6 rad/s = 336 rad/s, near half of 733
  });
});
