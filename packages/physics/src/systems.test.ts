import { describe, expect, it } from 'vitest';
import type { Controls, VehicleModel, VehicleState } from './types';
import type { FixtureParts } from './fixtures';
import type { TyreOut } from './tyre';
import { AUTO_GEAR } from './types';
import { autoShift, hasShiftPoints, limiterCut, prepareShiftPoints, shiftUpOmega, stabilityControl, tractionControl } from './systems';
import { fixtureModel } from './fixtures';
import { G, tableAt } from './math';
import { createState, defaultControls } from './state';
import { maxDeflectionX, peakSlipRatio, relaxStep, tyreForces, tyreMuX, tyreMuY } from './tyre';

// The fixture: a 1,600 kg rear-drive coupe on summer tyres (0.33 m radius, peak braking or driving slip near 12%),
// wheelbase 2.70 m, a 7,000 rpm V8 (idle 697 rpm) and a six-speed manual: 3.50 2.10 1.50 1.15 0.92 0.76, final drive 3.70.
const H = 1 / 480;
const DRY = new Float64Array([1, 1, 1, 1]);
const RPM = Math.PI / 30;
const KMH = 1 / 3.6;

/** The fixture moving straight at a speed, wheels rolling, its weight on them as at rest. */
function car(speed: number, parts: FixtureParts = {}): VehicleState {
  const s = createState(fixtureModel(parts));
  const c = s.model.chassis, L = c.a + c.b;
  s.wheelLoad[0] = s.wheelLoad[1] = 0.5 * c.mass * G * c.b / L;
  s.wheelLoad[2] = s.wheelLoad[3] = 0.5 * c.mass * G * c.a / L;
  s.u = speed;
  for (let i = 0; i < 4; i++) s.wheelOmega[i] = speed / radius(s, i);
  return s;
}
function radius(s: VehicleState, i: number): number { return (i < 2 ? s.model.tyreFront : s.model.tyreRear).radius; }
function controls(over: Partial<Controls> = {}): Controls { return { ...defaultControls(), ...over }; }
function peakOf(s: VehicleState, i: number): number { return peakSlipRatio(i < 2 ? s.model.tyreFront : s.model.tyreRear, s.wheelLoad[i], 1); }

/* ------------------------------------------------------------------ traction control */

/** Spins wheel i so it turns faster than the road by `share` peak slips, in the direction its gear drives (its tyre's slip state with it). */
function spin(s: VehicleState, i: number, share: number): void {
  const dir = s.gear < 0 ? -1 : 1, slip = dir * share * peakOf(s, i);
  s.wheelOmega[i] = (s.u + slip * Math.max(Math.abs(s.u), 1)) / radius(s, i);
  s.wheelSlipRatio[i] = slip;
}
function tcsFor(s: VehicleState, c: Controls, seconds: number): number {
  let cut = 1;
  const n = Math.round(seconds / H);
  for (let k = 0; k < n; k++) {
    s.wheelBrake.fill(0);   // as brakeTorques leaves them each substep with no pedal
    cut = tractionControl(s, c, DRY, H);
  }
  return cut;
}

describe('traction control', () => {
  it('cuts the throttle within a tenth of a second when a driven rear wheel spins at 2.5 times its peak slip, and says so', () => {
    const s = car(10);
    const c = controls({ throttle: 1 });
    spin(s, 2, 2.5);
    expect(tractionControl(s, c, DRY, H)).toBeLessThan(1);
    expect(s.tcsActive).toBe(1);
    expect(tcsFor(s, c, 0.1)).toBeLessThan(0.5);
    expect(s.tcsActive).toBe(1);
  });

  it('gives the throttle back once the wheel grips again, more slowly than it took it, and then stops acting', () => {
    const s = car(10);
    const c = controls({ throttle: 1 });
    spin(s, 2, 2.5);
    const cut = tcsFor(s, c, 0.1);
    spin(s, 2, 0.5);
    const back = tcsFor(s, c, 0.05);
    // A 0.15 s return: about a quarter of the way back after 50 ms.
    expect(back).toBeGreaterThan(cut);
    expect(back - cut).toBeLessThan(0.4 * (1 - cut));
    expect(tcsFor(s, c, 1.2)).toBe(1);
    expect(s.tcsActive).toBe(0);
  });

  it('holds its cut while the slip sits between the peak and 1.3 times it, where the tyre gives 98% or more', () => {
    const s = car(10);
    const c = controls({ throttle: 1 });
    spin(s, 2, 2); spin(s, 3, 2);
    const cut = tcsFor(s, c, 0.05);
    expect(cut).toBeLessThan(0.9);
    spin(s, 2, 1.15); spin(s, 3, 1.15);
    expect(tcsFor(s, c, 0.5)).toBeCloseTo(cut, 12);
  });

  it('brakes one driven wheel spinning past its partner on an open differential before the engine half acts', () => {
    // The inside wheel of a corner, light and spinning at 1.25 peak slips (past the brake's 1.15, short of the cut's
    // 1.3) while the outside one grips at its peak: the differential splits torque evenly, so the brake on the spinning
    // wheel is what lets the gripping one push. The throttle is left alone.
    const s = car(20, { driveline: { layout: 'FWD' } });
    s.wheelLoad[0] = 1700; s.wheelLoad[1] = 6700;
    const c = controls({ throttle: 1 });
    spin(s, 0, 1.25); spin(s, 1, 1);
    let cut = 1;
    for (let k = 0; k < Math.round(0.25 / H); k++) {
      for (let i = 0; i < 4; i++) s.wheelBrake[i] = 0;   // as brakeTorques leaves them with no pedal
      cut = tractionControl(s, c, DRY, H);
    }
    expect(cut).toBe(1);
    expect(s.tcsActive).toBe(1);
    // Aim: (1.25 - 1.15) of a 1-peak span times the partner's grip torque, mu_x Fz R; 5 time constants in, within 1%.
    const aim = 0.1 * tyreMuX(s.model.tyreFront, 6700, 1) * 6700 * s.model.tyreFront.radius;
    expect(s.tcsBrake[0]).toBeGreaterThan(0.99 * aim);
    expect(s.tcsBrake[0]).toBeLessThanOrEqual(aim);
    expect(s.wheelBrake[0]).toBe(s.tcsBrake[0]);
    expect(s.tcsBrake[1]).toBe(0);
    expect(s.wheelBrake[1]).toBe(0);
  });

  it('builds the brake at the pump\'s rate (0.05 s) and lets it go to exactly nothing once the wheel grips', () => {
    const s = car(20);
    const c = controls({ throttle: 1 });
    spin(s, 2, 1.65);
    const first = (() => { s.wheelBrake.fill(0); tractionControl(s, c, DRY, H); return s.tcsBrake[2]; })();
    for (let k = 0; k < Math.round(0.05 / H) - 1; k++) { s.wheelBrake.fill(0); tractionControl(s, c, DRY, H); }
    const aim = 0.5 * tyreMuX(s.model.tyreRear, s.wheelLoad[3], 1) * s.wheelLoad[3] * s.model.tyreRear.radius;
    expect(first / aim).toBeCloseTo((H / 0.05) / (1 + H / 0.05), 9);   // one implicit substep: k / (1 + k), about 4%
    expect(s.tcsBrake[2] / aim).toBeGreaterThan(0.6);       // one time constant: 1 - 1/e, implicit at this step
    expect(s.tcsBrake[2] / aim).toBeLessThan(0.66);
    spin(s, 2, 0.5);
    for (let k = 0; k < Math.round(1 / H); k++) { s.wheelBrake.fill(0); tractionControl(s, c, DRY, H); }
    expect(s.tcsBrake[2]).toBe(0);
    expect(s.tcsActive).toBe(0);
  });

  it('past 1.3 peak slips both halves act: the brake on the spinning wheel, the engine for it as well', () => {
    const s = car(20);
    spin(s, 2, 2.5);
    expect(tcsFor(s, controls({ throttle: 1 }), 0.1)).toBeLessThan(0.5);
    expect(s.tcsBrake[2]).toBeGreaterThan(0);
    expect(s.tcsBrake[3]).toBe(0);
    // Never past full pedal pressure on that caliper.
    const t = car(20, { brakes: { maxTorqueRear: 50 } });
    spin(t, 2, 2.5);
    tcsFor(t, controls({ throttle: 1 }), 0.1);
    expect(t.tcsBrake[2]).toBe(50);
  });

  it('brakes neither wheel when both spin alike, or on a locked axle: the engine is cut instead', () => {
    const s = car(20);
    spin(s, 2, 2); spin(s, 3, 2);
    expect(tcsFor(s, controls({ throttle: 1 }), 0.1)).toBeLessThan(0.9);
    expect(s.tcsBrake[2]).toBe(0); expect(s.tcsBrake[3]).toBe(0);
    const locked = car(20, { driveline: { diffRear: { kind: 'locked', preload: 0, lockPerTorque: 0 } } });
    spin(locked, 2, 1.8);
    expect(tcsFor(locked, controls({ throttle: 1 }), 0.1)).toBeLessThan(0.9);
    expect(locked.tcsBrake[2]).toBe(0);
  });

  it('watches only the driven wheels: a spinning front wheel on a rear-drive car is not its business; on a front-drive car it is', () => {
    const rwd = car(10);
    spin(rwd, 0, 3);
    expect(tcsFor(rwd, controls({ throttle: 1 }), 0.2)).toBe(1);
    const fwd = car(10, { driveline: { layout: 'FWD' } });
    spin(fwd, 0, 3);
    expect(tcsFor(fwd, controls({ throttle: 1 }), 0.2)).toBeLessThan(0.5);
  });

  it('switched off, or not fitted, never cuts', () => {
    const off = car(10);
    spin(off, 2, 5); spin(off, 3, 5);
    for (let k = 0; k < 240; k++) { expect(tractionControl(off, controls({ throttle: 1, tcs: false }), DRY, H)).toBe(1); expect(off.tcsActive).toBe(0); }
    const none = car(10, { systems: { tcs: false } });
    spin(none, 2, 5); spin(none, 3, 5);
    for (let k = 0; k < 240; k++) { expect(tractionControl(none, controls({ throttle: 1 }), DRY, H)).toBe(1); expect(none.tcsActive).toBe(0); }
    const lone = car(10);
    spin(lone, 2, 1.25);
    tcsFor(lone, controls({ throttle: 1 }), 0.1);
    expect(lone.tcsBrake[2]).toBeGreaterThan(0);
    tractionControl(lone, controls({ throttle: 1, tcs: false }), DRY, H);
    expect(Array.from(lone.tcsBrake)).toEqual([0, 0, 0, 0]);
  });

  it('reads wheelspin backing up the other way: in reverse a wheel spinning backward is cut, one braking is not', () => {
    const s = car(-3);
    s.gear = -1;
    spin(s, 2, 3);
    expect(tcsFor(s, controls({ throttle: 1, gear: -1 }), 0.1)).toBeLessThan(0.5);
    const t = car(-3);
    t.gear = -1;
    spin(t, 2, -3);
    expect(tcsFor(t, controls({ throttle: 1, gear: -1 }), 0.1)).toBe(1);
  });
});

/* A standing start in first gear, substep by substep as the vehicle step does: loads with the steady transfer
 * m ax h / L, tyre forces from the slip states, traction control, the wheels, the body, the slip states. The engine
 * gives its 430 N m peak through 3.50 x 3.70 at 92%: 2,560 N m a rear wheel, half again what the tyre can take; each
 * rear wheel carries half the engine's inertia through the gearing. */
const tyreOut: TyreOut = { fx: 0, fy: 0, mz: 0, use: 0 };
type Launch = { accel: number; ideal: number; slip: number };
function launch(tcs: boolean, grip = 1): Launch {
  const model = fixtureModel();
  const s = createState(model);
  const c = controls({ throttle: 1, tcs, gear: 1 });
  const g = new Float64Array([grip, grip, grip, grip]);
  const ch = model.chassis, L = ch.a + ch.b, d = model.driveline;
  const G1 = d.gears[0] * d.finalDrive;
  const drive = 430 * G1 * d.efficiency / 2;
  const jRear = model.wheelInertiaRear + model.engine.inertia * G1 * G1 / 2;
  const fx = new Float64Array(4), slide = new Float64Array(4);
  let accel = 0, slip = 0, n = 0;
  for (let k = 0; k < 3 * 480; k++) {
    const transfer = ch.mass * s.ax * ch.cgHeight / L;
    s.wheelLoad[0] = s.wheelLoad[1] = 0.5 * (ch.mass * G * ch.b / L - transfer);
    s.wheelLoad[2] = s.wheelLoad[3] = 0.5 * (ch.mass * G * ch.a / L + transfer);
    for (let i = 0; i < 4; i++) {
      tyreForces(i < 2 ? model.tyreFront : model.tyreRear, s.wheelLoad[i], s.wheelSlipRatio[i], 0, slide[i], grip, tyreOut);
      fx[i] = tyreOut.fx;
    }
    const cut = tractionControl(s, c, g, H);
    let sum = 0;
    for (let i = 0; i < 4; i++) {
      const torque = i < 2 ? 0 : cut * drive;
      s.wheelOmega[i] += (torque - fx[i] * radius(s, i)) * H / (i < 2 ? model.wheelInertiaFront : jRear);
      sum += fx[i];
    }
    s.ax = sum / ch.mass;
    s.u += s.ax * H;
    if (k >= 480) { accel += s.ax; slip += s.wheelSlipRatio[2] / peakSlipRatio(model.tyreRear, s.wheelLoad[2], grip); n++; }
    for (let i = 0; i < 4; i++) {
      const p = i < 2 ? model.tyreFront : model.tyreRear;
      const vs = s.u - s.wheelOmega[i] * p.radius;
      slide[i] = Math.abs(vs);
      s.wheelSlipRatio[i] = relaxStep(s.wheelSlipRatio[i] * p.relaxLong, vs, s.u, p.relaxLong, maxDeflectionX(p, s.wheelLoad[i], grip), H) / p.relaxLong;
    }
  }
  // The most the rear tyres can push: both at their peak, with the load the push itself moves onto them.
  let ideal = 5;
  for (let k = 0; k < 200; k++) {
    const rear = 0.5 * (ch.mass * G * ch.a / L + ch.mass * ideal * ch.cgHeight / L);
    ideal = 2 * tyreMuX(model.tyreRear, rear, grip) * rear / ch.mass;
  }
  return { accel: accel / n, ideal, slip: slip / n };
}

describe('traction control on a full-throttle standing start', () => {
  const withTcs = launch(true), without = launch(false);

  it('the rear tyres of this car can push it at about 0.55 g', () => {
    expect(withTcs.ideal / G).toBeGreaterThan(0.45);
    expect(withTcs.ideal / G).toBeLessThan(0.65);
  });

  it('with traction control the driven wheels work near their peak slip and the car gets at least 92% of what the tyres allow', () => {
    expect(withTcs.slip).toBeGreaterThan(0.7);
    expect(withTcs.slip).toBeLessThan(1.5);
    expect(withTcs.accel).toBeGreaterThan(0.92 * withTcs.ideal);
    expect(withTcs.accel).toBeLessThan(withTcs.ideal);
  });

  it('without it the wheels spin far past the peak and the car pulls harder with it than without', () => {
    expect(without.slip).toBeGreaterThan(2);
    expect(withTcs.accel).toBeGreaterThan(1.05 * without.accel);
  });

  it('on a wet road (grip 0.5) it still holds the wheels near the peak', () => {
    const wet = launch(true, 0.5);
    expect(wet.slip).toBeLessThan(1.5);
    expect(wet.accel).toBeGreaterThan(0.9 * wet.ideal);
  });
});

/* ------------------------------------------------------------------ stability control */

/** The fixture at 25 m/s (90 km/h) with its front wheels steered, yawing at r. */
function cornering(steer: number, r: number, parts: FixtureParts = {}): VehicleState {
  const s = car(25, parts);
  s.wheelSteer[0] = s.wheelSteer[1] = steer;
  s.r = r;
  return s;
}
/** The yaw moment, N m (left positive), the brake torque at the four wheels makes on the car through the tyres. */
function brakeYawMoment(s: VehicleState): number {
  const ch = s.model.chassis;
  let m = 0;
  for (let i = 0; i < 4; i++) {
    const y = (i === 0 || i === 2 ? 0.5 : -0.5) * (i < 2 ? ch.trackFront : ch.trackRear);
    // A braking force F backward at (x, y) gives Mz = -y * (-F).
    m += y * s.wheelBrake[i] / radius(s, i);
  }
  return m;
}
// At 25 m/s on dry asphalt the tyres hold about 10 m/s^2 sideways: a yaw rate of 0.40 rad/s; the system aims at 90% of it.
const LIMIT_R = 0.36;

describe('stability control', () => {
  it('brakes the outer front wheel (the right one in a left turn) when the car yaws far more than the steering asks', () => {
    const s = cornering(0.03, 0.8);
    stabilityControl(s, controls(), DRY, H);
    expect(s.wheelBrake[1]).toBeGreaterThan(200);
    expect(s.wheelBrake[0]).toBe(0); expect(s.wheelBrake[2]).toBe(0); expect(s.wheelBrake[3]).toBe(0);
    expect(s.escActive).toBe(1);
    expect(brakeYawMoment(s)).toBeLessThan(0);
  });

  it('brakes the inner rear wheel (the left one in a left turn) when the car yaws far less than the steering asks', () => {
    const s = cornering(0.06, 0.05);
    stabilityControl(s, controls(), DRY, H);
    expect(s.wheelBrake[2]).toBeGreaterThan(200);
    expect(s.wheelBrake[0]).toBe(0); expect(s.wheelBrake[1]).toBe(0); expect(s.wheelBrake[3]).toBe(0);
    expect(brakeYawMoment(s)).toBeGreaterThan(0);
  });

  it('does the mirror image in a right turn: the left front for oversteer, the right rear for understeer', () => {
    const over = cornering(-0.03, -0.8);
    stabilityControl(over, controls(), DRY, H);
    expect(over.wheelBrake[0]).toBeGreaterThan(200);
    expect(over.wheelBrake[1] + over.wheelBrake[2] + over.wheelBrake[3]).toBe(0);
    const under = cornering(-0.06, -0.05);
    stabilityControl(under, controls(), DRY, H);
    expect(under.wheelBrake[3]).toBeGreaterThan(200);
    expect(under.wheelBrake[0] + under.wheelBrake[1] + under.wheelBrake[2]).toBe(0);
  });

  it('catches a spin the driver is counter-steering: yawing left with the wheels turned right, it brakes the right front', () => {
    const s = cornering(-0.05, 0.7);
    stabilityControl(s, controls(), DRY, H);
    expect(s.wheelBrake[1]).toBeGreaterThan(200);
    expect(brakeYawMoment(s)).toBeLessThan(0);
  });

  it('does nothing in a straight line, nor in a corner taken as the steering asks', () => {
    const straight = cornering(0, 0);
    stabilityControl(straight, controls(), DRY, H);
    expect(Array.from(straight.wheelBrake)).toEqual([0, 0, 0, 0]);
    expect(straight.escActive).toBe(0);
    // 0.02 rad of steer at 25 m/s on a 2.70 m wheelbase: a steady yaw rate of about 0.18 rad/s (a 135 m radius).
    const steady = cornering(0.02, 0.18);
    stabilityControl(steady, controls(), DRY, H);
    expect(Array.from(steady.wheelBrake)).toEqual([0, 0, 0, 0]);
  });

  it('leaves a car cornering at its limit alone however far past it the wheels are turned: it aims at what the tyres can hold', () => {
    const s = cornering(0.25, LIMIT_R);
    stabilityControl(s, controls(), DRY, H);
    expect(Array.from(s.wheelBrake)).toEqual([0, 0, 0, 0]);
    // The same steering, the car going straight on: that is understeer, and it acts.
    const plough = cornering(0.25, 0.1);
    stabilityControl(plough, controls(), DRY, H);
    expect(plough.wheelBrake[2]).toBeGreaterThan(0);
  });

  it('brakes harder the further the car strays, up to what the tyre can take', () => {
    let last = 0;
    for (const r of [0.5, 0.55, 0.6, 0.65, 0.7]) {
      const s = cornering(0.03, r);
      stabilityControl(s, controls(), DRY, H);
      expect(s.wheelBrake[1]).toBeGreaterThan(last);
      last = s.wheelBrake[1];
    }
    // Far out, it stops at the right front tyre's own braking grip: 1.11 x 4,213 N x 0.33 m = 1,549 N m, short of
    // the 2,221 N m the brake could make.
    const wild = cornering(0.03, 3);
    stabilityControl(wild, controls(), DRY, H);
    const tyre = wild.model.tyreFront;
    expect(wild.wheelBrake[1]).toBeCloseTo(tyreMuX(tyre, wild.wheelLoad[1], 1) * wild.wheelLoad[1] * tyre.radius, 6);
    expect(wild.wheelBrake[1]).toBeLessThan(wild.model.brakes.maxTorqueFront);
  });

  it('never asks a tyre for braking it has no grip left to give: a front tyre already at its cornering limit gets none', () => {
    const s = cornering(0.03, 0.8);
    s.wheelFy[1] = tyreMuY(s.model.tyreFront, s.wheelLoad[1], 1) * s.wheelLoad[1];
    stabilityControl(s, controls(), DRY, H);
    expect(s.wheelBrake[1]).toBe(0);
    // Half its grip used sideways leaves sqrt(1 - 0.25) = 87% of its braking grip.
    const half = cornering(0.03, 3);
    half.wheelFy[1] = 0.5 * tyreMuY(half.model.tyreFront, half.wheelLoad[1], 1) * half.wheelLoad[1];
    stabilityControl(half, controls(), DRY, H);
    const tyre = half.model.tyreFront;
    expect(half.wheelBrake[1]).toBeLessThanOrEqual(Math.sqrt(0.75) * tyreMuX(tyre, half.wheelLoad[1], 1) * half.wheelLoad[1] * tyre.radius + 1e-9);
  });

  it('switched off, not fitted, or at a crawl, it does nothing', () => {
    const off = cornering(0.03, 0.8);
    stabilityControl(off, controls({ esc: false }), DRY, H);
    expect(Array.from(off.wheelBrake)).toEqual([0, 0, 0, 0]);
    const none = cornering(0.03, 0.8, { systems: { esc: false } });
    stabilityControl(none, controls(), DRY, H);
    expect(Array.from(none.wheelBrake)).toEqual([0, 0, 0, 0]);
    const slow = cornering(0.03, 0.8);
    slow.u = 3;
    stabilityControl(slow, controls(), DRY, H);
    expect(Array.from(slow.wheelBrake)).toEqual([0, 0, 0, 0]);
  });

  it('adds to what the pedal asks rather than replacing it', () => {
    const s = cornering(0.03, 0.8);
    s.wheelBrake[0] = s.wheelBrake[1] = 500; s.wheelBrake[2] = s.wheelBrake[3] = 250;
    stabilityControl(s, controls(), DRY, H);
    expect(s.wheelBrake[1]).toBeGreaterThan(700);
    expect(s.wheelBrake[0]).toBe(500);
  });
});

/* ------------------------------------------------------------------ the governor */

describe('the speed governor', () => {
  it('fades the throttle to nothing over 1 m/s centred on a 250 km/h limit', () => {
    const limit = 250 * KMH;
    const s = car(200 * KMH, { systems: { limiterSpeed: limit } });
    expect(limiterCut(s)).toBe(1);
    expect(s.limiterActive).toBe(0);
    s.u = limit - 0.5;
    expect(limiterCut(s)).toBe(1);
    s.u = limit - 0.25;
    expect(limiterCut(s)).toBeCloseTo(0.75, 9);
    expect(s.limiterActive).toBe(1);
    s.u = limit;
    expect(limiterCut(s)).toBeCloseTo(0.5, 9);
    s.u = limit + 0.3;
    expect(limiterCut(s)).toBeCloseTo(0.2, 9);
    s.u = limit + 0.5;
    expect(limiterCut(s)).toBe(0);
    s.u = limit + 3;
    expect(limiterCut(s)).toBe(0);
  });

  it('a car without a governor is never cut, at any speed', () => {
    const s = car(120);
    expect(limiterCut(s)).toBe(1);
    expect(s.limiterActive).toBe(0);
  });
});

/* ------------------------------------------------------------------ shifting */

/** A peakier version of the fixture's V8: 430 N m at 3,630 rpm, 226 kW (303 hp) at 6,025 rpm, 212 kW left at its 7,000 rpm redline. */
function peakyParts(): FixtureParts {
  const n = 72, dOmega = 12;
  const wot = new Float64Array(n);
  for (let i = 0; i < n; i++) { const x = i * dOmega / 380; wot[i] = 430 * (0.62 + 0.76 * x - 0.38 * x * x); }
  return { engine: { wot, offBoost: wot } };
}
/** The engine speed of the most power on the full-throttle table, read finely, up to redline. */
function powerPeak(model: VehicleModel): number {
  const e = model.engine;
  let best = 0, at = 0;
  for (let w = e.idle; w <= e.redline; w += 0.05) { const p = tableAt(e.wot, e.dOmega, w) * w; if (p > best) { best = p; at = w; } }
  return at;
}
function torqueAt(model: VehicleModel, w: number): number { return tableAt(model.engine.wot, model.engine.dOmega, w); }
/** Rolls the car so that the engine would turn at w in this gear (wheels and body together, no slip). */
function atEngineSpeed(s: VehicleState, gear: number, w: number): VehicleState {
  const d = s.model.driveline;
  const wheel = w / (d.gears[gear - 1] * d.finalDrive);
  for (let i = 0; i < 4; i++) s.wheelOmega[i] = wheel;
  s.u = wheel * radius(s, 2);
  s.gear = gear; s.gearNext = gear; s.shiftTimer = 0;
  return s;
}
const FULL = controls({ throttle: 1, gear: AUTO_GEAR });

describe('shift points', () => {
  it('this V8 still gains power at its 7,000 rpm redline, so at full throttle every gear is held to redline', () => {
    const model = fixtureModel();
    prepareShiftPoints(model);
    expect(powerPeak(model)).toBeGreaterThan(model.engine.redline - 1);
    for (let g = 1; g < 6; g++) {
      const up = shiftUpOmega(model, g);
      expect(up).toBeLessThanOrEqual(model.engine.redline);
      expect(up).toBeGreaterThanOrEqual(powerPeak(model) - 1);
    }
  });

  it('with power peaking at 6,025 rpm, each gear changes up between the power peak and redline, where the next gear pulls as hard', () => {
    const model = fixtureModel(peakyParts());
    prepareShiftPoints(model);
    const peak = powerPeak(model), gears = model.driveline.gears;
    expect(peak / RPM).toBeGreaterThan(5900);
    expect(peak / RPM).toBeLessThan(6150);
    let belowRedline = 0;
    for (let g = 1; g < 6; g++) {
      const up = shiftUpOmega(model, g), k = gears[g] / gears[g - 1];
      expect(up).toBeLessThanOrEqual(model.engine.redline);
      expect(up).toBeGreaterThanOrEqual(peak - 0.5);
      if (up < model.engine.redline - 1) {
        belowRedline++;
        // Wheel torque in this gear and in the next at the same road speed: equal at the point...
        expect(torqueAt(model, up) * gears[g - 1]).toBeCloseTo(torqueAt(model, k * up) * gears[g], 1);
        // ...this gear pulls harder below it, the next one above it.
        expect(torqueAt(model, 0.97 * up) * gears[g - 1]).toBeGreaterThan(torqueAt(model, 0.97 * k * up) * gears[g]);
        expect(torqueAt(model, 1.02 * up) * gears[g - 1]).toBeLessThan(torqueAt(model, 1.02 * k * up) * gears[g]);
      } else {
        // Held to redline: the next gear never pulls as hard below it.
        expect(torqueAt(model, up) * gears[g - 1]).toBeGreaterThan(torqueAt(model, k * up) * gears[g]);
      }
    }
    // The close upper ratios cross over below redline; the wide first-to-second step does not.
    expect(belowRedline).toBeGreaterThanOrEqual(2);
    expect(shiftUpOmega(model, 1)).toBe(model.engine.redline);
  });

  it('top gear, and a gear the box does not have, shift at redline', () => {
    const model = fixtureModel();
    expect(shiftUpOmega(model, 6)).toBe(model.engine.redline);
    expect(shiftUpOmega(model, 9)).toBe(model.engine.redline);
    expect(shiftUpOmega(model, 0)).toBe(model.engine.redline);
  });
});

describe('the car choosing its own gear', () => {
  const model = fixtureModel(peakyParts());
  prepareShiftPoints(model);

  it('at full throttle asks for the next gear just past the shift point, and not just before it', () => {
    for (let g = 1; g < 6; g++) {
      const up = shiftUpOmega(model, g);
      expect(autoShift(atEngineSpeed(createState(model), g, 1.005 * up), FULL)).toBe(g + 1);
      expect(autoShift(atEngineSpeed(createState(model), g, 0.97 * up), FULL)).toBe(g);
    }
  });

  it('kicks down when a stamp on the pedal finds the engine well below the point: sixth at 100 km/h becomes third', () => {
    const s = createState(model);
    const d = model.driveline;
    atEngineSpeed(s, 6, 100 * KMH / radius(s, 2) * d.gears[5] * d.finalDrive);
    expect(autoShift(s, controls({ throttle: 0.05 })) ).toBe(6);
    const g = autoShift(s, FULL);
    expect(g).toBeLessThan(6);
    const wheel = s.wheelOmega[2], shaft = wheel * d.finalDrive;
    // In the gear it picks the engine is under that gear's shift point; one lower it would be at 85% of that gear's point or more.
    expect(d.gears[g - 1] * shaft).toBeLessThan(shiftUpOmega(model, g));
    expect(d.gears[g - 2] * shaft).toBeGreaterThanOrEqual(0.85 * shiftUpOmega(model, g - 1));
    expect(g).toBe(3);
  });

  it('with a light throttle changes up early, landing the engine near 1,200 rpm, never below 1.5 times idle', () => {
    const s = createState(model);
    const d = model.driveline;
    for (let g = 1; g < 6; g++) {
      // Light throttle: change up from this gear at...
      let w = model.engine.idle;
      while (autoShift(atEngineSpeed(s, g, w), controls({ throttle: 0.05 })) <= g) w += 0.5;
      expect(autoShift(atEngineSpeed(s, g, w), controls({ throttle: 0.05 }))).toBe(g + 1);
      expect(w).toBeLessThan(0.5 * shiftUpOmega(model, g));
      const landed = w * d.gears[g] / d.gears[g - 1];
      expect(landed).toBeGreaterThan(1.5 * model.engine.idle);
      expect(landed / RPM).toBeGreaterThan(1100);
      expect(landed / RPM).toBeLessThan(1350);
    }
  });

  it('never hunts: in whatever gear it asks for, asked again it asks for the same', () => {
    const s = createState(model);
    let checked = 0;
    for (let start = 1; start <= 6; start++) {
      for (let speed = 0; speed <= 85; speed += 0.25) {
        for (const throttle of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
          const c = controls({ throttle });
          for (let i = 0; i < 4; i++) s.wheelOmega[i] = speed / radius(s, i);
          s.u = speed; s.gear = start; s.shiftTimer = 0;
          const g = autoShift(s, c);
          expect(g).toBeGreaterThanOrEqual(1);
          expect(g).toBeLessThanOrEqual(6);
          s.gear = g;
          expect(autoShift(s, c)).toBe(g);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(14000);
  });

  it('at full throttle from rest to 300 km/h it only ever changes up, through every gear in turn', () => {
    const s = createState(model);
    s.gear = 1;
    const seen: number[] = [1];
    for (let speed = 0; speed <= 300 * KMH; speed += 0.05) {
      for (let i = 0; i < 4; i++) s.wheelOmega[i] = speed / radius(s, i);
      s.u = speed;
      const g = autoShift(s, FULL);
      expect(g).toBeGreaterThanOrEqual(s.gear);
      if (g !== s.gear) seen.push(g);
      s.gear = g;
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('never asks for a gear outside first to sixth, whatever the wheels do', () => {
    const s = createState(model);
    for (const speed of [-40, -1, 0, 1e-9, 150, 1e4]) {
      for (let i = 0; i < 4; i++) s.wheelOmega[i] = speed / radius(s, i);
      for (let start = -1; start <= 6; start++) {
        s.gear = start;
        const g = autoShift(s, FULL);
        expect(g).toBeGreaterThanOrEqual(1);
        expect(g).toBeLessThanOrEqual(6);
      }
    }
  });

  it('judges a driven wheel spinning or locked past its tyre\'s peak at the road\'s speed, and one within it at its own', () => {
    for (const speed of [8, 20, 35]) {
      for (const throttle of [0.05, 0.5, 1]) {
        const s = car(speed, peakyParts()), c = controls({ throttle });
        s.gear = 3; s.gearNext = 3;
        const rolling = autoShift(s, c);
        // Spinning at three peak slips, or locked: the same gear as rolling with the road.
        spin(s, 2, 3); spin(s, 3, 3);
        expect(autoShift(s, c), `${speed} m/s, throttle ${throttle}, spinning`).toBe(rolling);
        s.wheelOmega[2] = 0; s.wheelOmega[3] = 0;
        expect(autoShift(s, c), `${speed} m/s, throttle ${throttle}, locked`).toBe(rolling);
      }
    }
    // Within the peak the wheels' own speed counts: at full throttle at the shift point plus 8% slip it changes up.
    const s = atEngineSpeed(createState(model), 2, 0.95 * shiftUpOmega(model, 2));
    for (let i = 0; i < 4; i++) s.wheelLoad[i] = 4000;
    for (const i of [2, 3]) s.wheelOmega[i] *= 1.08;
    expect(autoShift(s, FULL)).toBe(3);
  });

  it('takes a gear the driver asks for as asked, within what the box has', () => {
    const s = atEngineSpeed(createState(model), 2, 300);
    expect(autoShift(s, controls({ gear: 4 }))).toBe(4);
    expect(autoShift(s, controls({ gear: -1 }))).toBe(-1);
    expect(autoShift(s, controls({ gear: 0 }))).toBe(0);
    expect(autoShift(s, controls({ gear: 8 }))).toBe(6);
  });

  it('while a shift is under way, wants the gear being shifted to', () => {
    const s = atEngineSpeed(createState(model), 2, 300);
    s.gearNext = 3; s.shiftTimer = 0.1;
    expect(autoShift(s, FULL)).toBe(3);
  });

  it('a cvt, an ecvt and a single-speed car stay in drive at any speed, and give neutral or reverse only when asked', () => {
    for (const transmission of ['cvt', 'ecvt', 'single-speed'] as const) {
      const gears = transmission === 'single-speed' ? new Float64Array([9.0]) : new Float64Array([2.6, 0.4]);
      const m = fixtureModel({ driveline: { transmission, gears } });
      prepareShiftPoints(m);
      const s = createState(m);
      for (const speed of [0, 5, 20, 60]) {
        for (let i = 0; i < 4; i++) s.wheelOmega[i] = speed / radius(s, i);
        for (const throttle of [0, 0.5, 1]) expect(autoShift(s, controls({ throttle }))).toBe(1);
      }
      expect(autoShift(s, controls({ gear: -1 }))).toBe(-1);
      expect(autoShift(s, controls({ gear: 0 }))).toBe(0);
      expect(autoShift(s, controls({ gear: 3 }))).toBe(1);
      expect(shiftUpOmega(m, 1)).toBe(m.engine.redline);
    }
  });

  it('a state made by createState has its model\'s shift points ready, so the step never works them out (or allocates for them)', () => {
    const m = fixtureModel(peakyParts());
    expect(hasShiftPoints(m)).toBe(false);
    createState(m);
    expect(hasShiftPoints(m)).toBe(true);
    // A model the step meets unprepared (swapped into a state by hand) is not worked out there: it changes up at
    // redline until prepared, and the step leaves it unprepared.
    // A gear this engine changes up from well before redline, found on an identical prepared model.
    const twin = createState(fixtureModel(peakyParts())).model, red = twin.engine.redline;
    let g = 1;
    while (g < 5 && !(shiftUpOmega(twin, g) < 0.98 * red)) g++;
    const between = 0.5 * (shiftUpOmega(twin, g) + red);
    expect(between).toBeLessThan(0.99 * red);
    const s = createState(fixtureModel(peakyParts())), other = fixtureModel(peakyParts());
    s.model = other;
    atEngineSpeed(s, g, between);
    expect(autoShift(s, FULL)).toBe(g);                // unprepared: held to redline
    expect(hasShiftPoints(other)).toBe(false);
    atEngineSpeed(s, g, 1.001 * red);
    expect(autoShift(s, FULL)).toBe(g + 1);
    prepareShiftPoints(other);
    atEngineSpeed(s, g, between);
    expect(autoShift(s, FULL)).toBe(g + 1);            // prepared: at its own point
  });

  it('works the same for a model that was never prepared (the points are worked out on first use)', () => {
    const fresh = fixtureModel(peakyParts());
    for (let g = 1; g < 6; g++) expect(shiftUpOmega(fresh, g)).toBe(shiftUpOmega(model, g));
  });
});
