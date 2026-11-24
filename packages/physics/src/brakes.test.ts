import { describe, expect, it } from 'vitest';
import type { Controls, VehicleModel, VehicleState } from './types';
import type { FixtureParts } from './fixtures';
import type { TyreOut } from './tyre';
import { brakeTorques } from './brakes';
import { fixtureModel } from './fixtures';
import { G } from './math';
import { createState, defaultControls } from './state';
import { maxDeflectionX, peakSlipRatio, relaxStep, tyreForces, tyreMuX } from './tyre';

// The fixture: a 1,600 kg rear-drive coupe on summer tyres (0.33 m radius), whose brakes at full pedal are worth
// 1.3 g, 66% of it at the front: 2,221 N m at each front wheel, 1,144 N m at each rear. Handbrake 1,800 N m a rear wheel.
const H = 1 / 480;
const DRY = new Float64Array([1, 1, 1, 1]);
const KMH = 1 / 3.6;

/** The fixture moving straight at a speed with its wheels rolling and its weight on them as at rest. */
function rolling(speed: number, parts: FixtureParts = {}): VehicleState {
  const s = createState(fixtureModel(parts));
  const c = s.model.chassis, L = c.a + c.b;
  s.wheelLoad[0] = s.wheelLoad[1] = 0.5 * c.mass * G * c.b / L;
  s.wheelLoad[2] = s.wheelLoad[3] = 0.5 * c.mass * G * c.a / L;
  s.u = speed;
  for (let i = 0; i < 4; i++) s.wheelOmega[i] = speed / (i < 2 ? s.model.tyreFront : s.model.tyreRear).radius;
  return s;
}
/** Makes wheel i turn slower than the road by a share of the road speed (0.3: 30% braking slip), its tyre's slip state with it. */
function slipWheel(s: VehicleState, i: number, slip: number): void {
  s.wheelOmega[i] = s.u * (1 - slip) / (i < 2 ? s.model.tyreFront : s.model.tyreRear).radius;
  s.wheelSlipRatio[i] = s.u >= 0 ? -slip : slip;
}
function pedal(brake: number, over: Partial<Controls> = {}): Controls { return { ...defaultControls(), brake, ...over }; }
function full(s: VehicleState, i: number): number { return i < 2 ? s.model.brakes.maxTorqueFront : s.model.brakes.maxTorqueRear; }
function run(s: VehicleState, c: Controls, seconds: number): void {
  const n = Math.round(seconds / H);
  for (let k = 0; k < n; k++) brakeTorques(s, c, DRY, H);
}
function peakOf(s: VehicleState, i: number): number { return peakSlipRatio(i < 2 ? s.model.tyreFront : s.model.tyreRear, s.wheelLoad[i], DRY[i]); }

describe('the pedal', () => {
  it('at full pedal with no wheel slipping each wheel gets its full torque: 2,221 N m front, 1,144 N m rear, 1.3 g in all', () => {
    const s = rolling(100 * KMH);
    run(s, pedal(1), 0.2);
    expect(s.wheelBrake[0]).toBeCloseTo(s.model.brakes.maxTorqueFront, 9);
    expect(s.wheelBrake[1]).toBeCloseTo(s.model.brakes.maxTorqueFront, 9);
    expect(s.wheelBrake[2]).toBeCloseTo(s.model.brakes.maxTorqueRear, 9);
    expect(s.wheelBrake[3]).toBeCloseTo(s.model.brakes.maxTorqueRear, 9);
    expect(s.wheelBrake[0]).toBeCloseTo(2221, 0);
    expect(s.wheelBrake[2]).toBeCloseTo(1144, 0);
    // Torque over radius, summed and divided by weight: the deceleration the brakes alone are worth.
    let force = 0;
    for (let i = 0; i < 4; i++) force += s.wheelBrake[i] / s.model.tyreFront.radius;
    expect(force / (s.model.chassis.mass * G)).toBeCloseTo(1.3, 6);
    expect(Array.from(s.absActive)).toEqual([0, 0, 0, 0]);
  });

  it('torque follows the pedal: 40% pedal, 40% of the torque; no pedal, none', () => {
    const s = rolling(80 * KMH);
    run(s, pedal(0.4), 0.05);
    for (let i = 0; i < 4; i++) expect(s.wheelBrake[i]).toBeCloseTo(0.4 * full(s, i), 9);
    run(s, pedal(0), 0.05);
    for (let i = 0; i < 4; i++) expect(s.wheelBrake[i]).toBe(0);
  });
});

describe('ABS', () => {
  it('a summer tyre peaks near 12% braking slip, so 30% is far past it', () => {
    const s = rolling(25);
    expect(peakOf(s, 0)).toBeGreaterThan(0.09);
    expect(peakOf(s, 0)).toBeLessThan(0.15);
  });

  it('dumps a front wheel that slips far past the peak within a few substeps, and only that wheel', () => {
    const s = rolling(25);
    const c = pedal(1);
    slipWheel(s, 0, 0.3);
    brakeTorques(s, c, DRY, H);
    expect(s.wheelBrake[0]).toBeLessThan(full(s, 0));
    expect(s.absActive[0]).toBe(1);
    brakeTorques(s, c, DRY, H); brakeTorques(s, c, DRY, H);
    expect(s.wheelBrake[0]).toBeLessThan(0.85 * full(s, 0));
    run(s, c, 0.1);
    // 0.1 s is over three time constants of 0.03 s: almost all the pressure is out.
    expect(s.wheelBrake[0]).toBeLessThan(0.05 * full(s, 0));
    expect(s.absActive[0]).toBe(1);
    for (let i = 1; i < 4; i++) { expect(s.wheelBrake[i]).toBeCloseTo(full(s, i), 9); expect(s.absActive[i]).toBe(0); }
  });

  it('builds the pressure back once the wheel has spun up, more slowly than it let it out, and then stops acting', () => {
    const s = rolling(25);
    const c = pedal(1);
    slipWheel(s, 0, 0.3);
    run(s, c, 0.1);
    slipWheel(s, 0, 0.03);
    run(s, c, 0.05);
    const after50ms = s.wheelBrake[0] / full(s, 0);
    // A 0.08 s build: about 45% back after 50 ms (a 0.03 s dump would have been near 80%).
    expect(after50ms).toBeGreaterThan(0.3);
    expect(after50ms).toBeLessThan(0.65);
    expect(s.absActive[0]).toBe(1);
    run(s, c, 0.7);
    expect(s.wheelBrake[0]).toBe(full(s, 0));
    expect(s.absActive[0]).toBe(0);
  });

  it('between 0.75 and 1.15 times the peak slip, where the tyre gives 94% of its grip or more, it builds only slowly, feeling for the peak', () => {
    const dumped = (): VehicleState => { const s = rolling(25); slipWheel(s, 1, 0.3); run(s, pedal(1), 0.02); return s; };
    const near = dumped(), below = dumped();
    const start = near.wheelBrake[1];
    expect(start).toBeLessThan(0.6 * full(near, 1));
    expect(start).toBeGreaterThan(0.2 * full(near, 1));
    slipWheel(near, 1, peakOf(near, 1));        // at the peak: inside the band
    slipWheel(below, 1, 0.3 * peakOf(below, 1)); // well under it: the wheel has spun up
    run(near, pedal(1), 0.1);
    run(below, pedal(1), 0.1);
    const nearGain = near.wheelBrake[1] - start, belowGain = below.wheelBrake[1] - start;
    expect(nearGain).toBeGreaterThan(0);
    expect(nearGain).toBeLessThan(0.5 * belowGain);
  });

  it('switched off by the driver, it never cuts the torque, however hard the wheels lock', () => {
    const s = rolling(30);
    const c = pedal(1, { abs: false });
    for (let i = 0; i < 4; i++) slipWheel(s, i, 1);
    for (let k = 0; k < 480; k++) {
      brakeTorques(s, c, DRY, H);
      for (let i = 0; i < 4; i++) { expect(s.wheelBrake[i]).toBe(full(s, i)); expect(s.absActive[i]).toBe(0); }
    }
  });

  it('on a car built without it, it never cuts the torque, whatever the driver asks', () => {
    const s = rolling(30, { systems: { abs: false } });
    const c = pedal(1, { abs: true });
    for (let i = 0; i < 4; i++) slipWheel(s, i, 1);
    for (let k = 0; k < 480; k++) {
      brakeTorques(s, c, DRY, H);
      for (let i = 0; i < 4; i++) { expect(s.wheelBrake[i]).toBe(full(s, i)); expect(s.absActive[i]).toBe(0); }
    }
  });

  it('lets the pedal through at a crawl and at rest, so the brake holds a stopped car', () => {
    const s = rolling(0);
    const c = pedal(1);
    // At a standstill the slip state is the tyre's spring leaning against the brake, not slip.
    for (let i = 0; i < 4; i++) slipWheel(s, i, 1);
    run(s, c, 0.5);
    for (let i = 0; i < 4; i++) expect(s.wheelBrake[i]).toBe(full(s, i));
    s.u = 1.5;
    run(s, c, 0.5);
    for (let i = 0; i < 4; i++) expect(s.wheelBrake[i]).toBe(full(s, i));
  });

  it('on ice, where the peak slip is smaller, it acts at a smaller slip than on dry asphalt', () => {
    const ice = new Float64Array([0.15, 0.15, 0.15, 0.15]);
    const s = rolling(20);
    const icePeak = peakSlipRatio(s.model.tyreFront, s.wheelLoad[0], 0.15);
    expect(icePeak).toBeLessThan(0.3 * peakOf(s, 0));
    slipWheel(s, 0, 0.05); // under half the dry peak, three times the icy one
    brakeTorques(s, pedal(1), DRY, H);
    expect(s.wheelBrake[0]).toBe(full(s, 0));
    brakeTorques(s, pedal(1), ice, H);
    expect(s.wheelBrake[0]).toBeLessThan(full(s, 0));
  });
});

describe('brake-force distribution', () => {
  it('trims a rear wheel that slips more than the fronts, and leaves the fronts alone', () => {
    const s = rolling(25);
    const c = pedal(1);
    // Both well inside the peak, so ABS alone would do nothing: the rear has simply been given too much for its load.
    slipWheel(s, 0, 0.03); slipWheel(s, 1, 0.03);
    slipWheel(s, 2, 0.08); slipWheel(s, 3, 0.08);
    expect(0.08).toBeLessThan(0.75 * peakOf(s, 2));
    brakeTorques(s, c, DRY, H);
    expect(s.wheelBrake[2]).toBeLessThan(full(s, 2));
    run(s, c, 0.2);
    expect(s.wheelBrake[2]).toBeLessThan(0.5 * full(s, 2));
    expect(s.wheelBrake[3]).toBeLessThan(0.5 * full(s, 3));
    expect(s.wheelBrake[0]).toBe(full(s, 0));
    expect(s.wheelBrake[1]).toBe(full(s, 1));
    // Well back under the fronts' slip: the pressure comes back.
    slipWheel(s, 2, 0.01); slipWheel(s, 3, 0.01);
    run(s, c, 0.8);
    expect(s.wheelBrake[2]).toBe(full(s, 2));
    expect(s.wheelBrake[3]).toBe(full(s, 3));
  });

  it('leaves a rear wheel alone in a light stop, where it is nowhere near locking', () => {
    const s = rolling(25);
    slipWheel(s, 0, 0.01); slipWheel(s, 1, 0.01);
    slipWheel(s, 2, 0.025); slipWheel(s, 3, 0.025);
    run(s, pedal(0.3), 0.5);
    expect(s.wheelBrake[2]).toBeCloseTo(0.3 * full(s, 2), 9);
  });

  it('gives a trimmed rear its full share back once the pedal is let up', () => {
    const s = rolling(25);
    slipWheel(s, 0, 0.03); slipWheel(s, 1, 0.03);
    slipWheel(s, 2, 0.08); slipWheel(s, 3, 0.08);
    run(s, pedal(1), 0.2);
    expect(s.absHold[2]).toBeLessThan(0.5);
    for (let i = 0; i < 4; i++) slipWheel(s, i, 0);
    run(s, pedal(0), 0.6);
    run(s, pedal(0.3), 1 / 480);
    expect(s.wheelBrake[2]).toBeCloseTo(0.3 * full(s, 2), 9);
  });

  it('is part of the ABS unit: with ABS off the rear gets the pedal whatever it slips', () => {
    const s = rolling(25);
    const c = pedal(1, { abs: false });
    slipWheel(s, 0, 0.03); slipWheel(s, 1, 0.03);
    slipWheel(s, 2, 0.08); slipWheel(s, 3, 0.08);
    run(s, c, 0.2);
    expect(s.wheelBrake[2]).toBe(full(s, 2));
  });
});

describe('the handbrake', () => {
  it('acts on the rear wheels only, on top of the pedal', () => {
    const s = rolling(15);
    run(s, pedal(0, { handbrake: 1 }), 0.05);
    expect(Array.from(s.wheelBrake)).toEqual([0, 0, 1800, 1800]);
    run(s, pedal(0.5, { handbrake: 0.5 }), 0.05);
    expect(s.wheelBrake[0]).toBeCloseTo(0.5 * full(s, 0), 9);
    expect(s.wheelBrake[1]).toBeCloseTo(0.5 * full(s, 1), 9);
    expect(s.wheelBrake[2]).toBeCloseTo(0.5 * full(s, 2) + 900, 9);
    expect(s.wheelBrake[3]).toBeCloseTo(0.5 * full(s, 3) + 900, 9);
  });

  it('is not on the ABS circuit: it still locks the rears with ABS on, as a handbrake turn needs', () => {
    const s = rolling(15);
    slipWheel(s, 2, 1); slipWheel(s, 3, 1);
    run(s, pedal(0, { handbrake: 1 }), 0.5);
    expect(s.wheelBrake[2]).toBe(1800);
    expect(s.wheelBrake[3]).toBe(1800);
  });
});

/* A straight stop with the real tyre, worked through substep by substep as the vehicle step does: loads (static,
 * plus the steady transfer m ax h / L from the last substep), tyre forces from the slip states, the brakes, the wheels
 * (the brake as a friction constraint that can stop a wheel but never turn it backward), the body, then the slip
 * states. No drag, no rolling resistance: the tyres alone stop the car. */
const tyreOut: TyreOut = { fx: 0, fy: 0, mz: 0, use: 0 };
type Stop = { distance: number; frontLockedShare: number; rearLockedShare: number; frontSlip: number; rearSlip: number };
function straightStop(model: VehicleModel, abs: boolean, from: number, grip = 1, h = H): Stop {
  const s = createState(model);
  const c = pedal(1, { abs });
  const g = new Float64Array([grip, grip, grip, grip]);
  const ch = model.chassis, L = ch.a + ch.b;
  const fx = new Float64Array(4), slide = new Float64Array(4);
  s.u = from;
  for (let i = 0; i < 4; i++) s.wheelOmega[i] = from / (i < 2 ? model.tyreFront : model.tyreRear).radius;
  let distance = 0, fast = 0, frontLocked = 0, rearLocked = 0, frontSlip = 0, rearSlip = 0;
  for (let k = 0; k < 30 / h && s.u > 0.05; k++) {
    const transfer = ch.mass * s.ax * ch.cgHeight / L;
    s.wheelLoad[0] = s.wheelLoad[1] = 0.5 * (ch.mass * G * ch.b / L - transfer);
    s.wheelLoad[2] = s.wheelLoad[3] = 0.5 * (ch.mass * G * ch.a / L + transfer);
    for (let i = 0; i < 4; i++) {
      tyreForces(i < 2 ? model.tyreFront : model.tyreRear, s.wheelLoad[i], s.wheelSlipRatio[i], 0, slide[i], grip, tyreOut);
      fx[i] = tyreOut.fx;
    }
    brakeTorques(s, c, g, h);
    let sum = 0;
    for (let i = 0; i < 4; i++) {
      const p = i < 2 ? model.tyreFront : model.tyreRear, J = i < 2 ? model.wheelInertiaFront : model.wheelInertiaRear;
      let w = s.wheelOmega[i] - fx[i] * p.radius * h / J;
      const dw = s.wheelBrake[i] * h / J;
      w = w > dw ? w - dw : w < -dw ? w + dw : 0;
      s.wheelOmega[i] = w;
      sum += fx[i];
    }
    s.ax = sum / ch.mass;
    s.u += s.ax * h;
    distance += s.u * h;
    if (s.u > 5) {
      fast++;
      if (s.wheelOmega[0] * model.tyreFront.radius < 0.05 * s.u) frontLocked++;
      if (s.wheelOmega[2] * model.tyreRear.radius < 0.05 * s.u) rearLocked++;
      frontSlip -= s.wheelSlipRatio[0];
      rearSlip -= s.wheelSlipRatio[2];
    }
    for (let i = 0; i < 4; i++) {
      const p = i < 2 ? model.tyreFront : model.tyreRear;
      const slip = s.u - s.wheelOmega[i] * p.radius;
      slide[i] = Math.abs(slip);
      const def = relaxStep(s.wheelSlipRatio[i] * p.relaxLong, slip, s.u, p.relaxLong, maxDeflectionX(p, s.wheelLoad[i], grip), h);
      s.wheelSlipRatio[i] = def / p.relaxLong;
    }
  }
  return { distance, frontLockedShare: frontLocked / fast, rearLockedShare: rearLocked / fast, frontSlip: frontSlip / fast, rearSlip: rearSlip / fast };
}
/** The shortest stop the tyres allow: every wheel at its own peak, the load moved forward by that deceleration. */
function idealStop(model: VehicleModel, from: number, grip = 1): number {
  const ch = model.chassis, L = ch.a + ch.b;
  let a = G;
  for (let k = 0; k < 200; k++) {
    const transfer = ch.mass * a * ch.cgHeight / L;
    const front = 0.5 * (ch.mass * G * ch.b / L + transfer), rear = 0.5 * (ch.mass * G * ch.a / L - transfer);
    a = 2 * (tyreMuX(model.tyreFront, front, grip) * front + tyreMuX(model.tyreRear, rear, grip) * rear) / ch.mass;
  }
  return from * from / (2 * a);
}

describe('a stop from 100 km/h on the real tyre', () => {
  const model = fixtureModel();
  const from = 100 * KMH;
  const ideal = idealStop(model, from);
  const withAbs = straightStop(model, true, from);
  const locked = straightStop(model, false, from);

  it('the tyres allow about 1.1 g: some 36 m from 100 km/h', () => {
    expect(from * from / (2 * ideal) / G).toBeGreaterThan(1.0);
    expect(from * from / (2 * ideal) / G).toBeLessThan(1.2);
    expect(ideal).toBeGreaterThan(33);
    expect(ideal).toBeLessThan(39);
  });

  it('with ABS the car stops within a few percent of the shortest stop the tyres allow, never shorter', () => {
    expect(withAbs.distance).toBeGreaterThan(1.005 * ideal);
    expect(withAbs.distance).toBeLessThan(1.05 * ideal);
  });

  it('without ABS this car locks all four wheels (its brakes are worth 1.3 g) and slides at least 15% farther', () => {
    expect(locked.frontLockedShare).toBeGreaterThan(0.9);
    expect(locked.rearLockedShare).toBeGreaterThan(0.85);
    expect(locked.distance).toBeGreaterThan(1.15 * withAbs.distance);
  });

  it('with ABS the front wheels keep turning, so the car can still be steered', () => {
    expect(withAbs.frontLockedShare).toBe(0);
  });

  it('with ABS the rear wheels, given 34% of the torque for some 27% of the load, never lock and slip no more than the fronts', () => {
    expect(withAbs.rearLockedShare).toBe(0);
    expect(withAbs.rearSlip).toBeLessThan(withAbs.frontSlip * 1.05);
    // Both work near the tyre's peak (about 12% slip), not timidly below it.
    expect(withAbs.frontSlip).toBeGreaterThan(0.08);
    expect(withAbs.rearSlip).toBeGreaterThan(0.07);
  });

  it('on a wet road (grip 0.6) and on packed snow (grip 0.3) ABS still stops within a few percent of what the tyres allow', () => {
    for (const grip of [0.6, 0.3]) {
      const best = idealStop(model, from, grip);
      const stop = straightStop(model, true, from, grip);
      expect(stop.distance).toBeGreaterThan(best);
      expect(stop.distance).toBeLessThan(1.05 * best);
      expect(stop.frontLockedShare).toBe(0);
    }
  });

  it('halving the substep moves the stop by less than 1%', () => {
    const fine = straightStop(model, true, from, 1, H / 2);
    expect(Math.abs(fine.distance / withAbs.distance - 1)).toBeLessThan(0.01);
  });
});

describe('a stop in reverse', () => {
  it('ABS reads slip the same way backing up: a locked wheel at 8 m/s in reverse is let go', () => {
    const s = rolling(-8);
    slipWheel(s, 0, 1);
    run(s, pedal(1), 0.1);
    expect(s.wheelBrake[0]).toBeLessThan(0.05 * full(s, 0));
    expect(s.wheelBrake[1]).toBe(full(s, 1));
  });
});
