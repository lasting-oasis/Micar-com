import { describe, expect, it } from 'vitest';
import { AUTO_GEAR, createTelemetry, defaultControls, telemetry } from '@micar/physics';
import type { Controls } from '@micar/physics';
import { ASSISTS, DEFAULT_PRESET, applyAssists, assistMemory, frontPeakSlip, type AssistPreset, type DriverWish } from './assists';
import { CoreDriver } from './driver';
import { specFor, STOCK_CFG, TUNE_DEF } from '../data';
import { NO_INPUT, type Input } from '../physics';
import type { DriveOpts } from '../driver';

const DT = 1 / 120;
const ronin = { make: 'Ronin', model: 'GT', rental: true };
const opts = (): DriveOpts => ({ drift: false, fuel: () => 100, burn: () => {}, collide: () => 0 });
const wish = (o: Partial<DriverWish> = {}): DriverWish => ({ steer: 0, steerMul: 1, throttle: 0, brake: 0, handbrake: 0, gear: AUTO_GEAR, nitrous: false, drift: false, ...o });

// A car rolling straight at `speed` m/s under a preset.
function rolling(preset: AssistPreset, speed: number): CoreDriver {
  const d = new CoreDriver(ronin, specFor(ronin), { cfg: STOCK_CFG, tune: TUNE_DEF }, { x: 0, z: 0, h: 0 }, { preset });
  d.V.u = speed; d.V.vz = speed; // set rolling from outside, as a respawn at speed would be
  d.stepFrame(1 / 120, NO_INPUT, opts());
  // the wheels catch the road in a few metres
  const I: Input = { ...NO_INPUT, fwd: 0.25 };
  for (let i = 0; i < 60; i++) d.stepFrame(1 / 60, I, opts());
  return d;
}

// The largest front slip angle over a full-lock turn, as a share of the tyres' peak slip at their load then.
function worstFrontSlip(d: CoreDriver, seconds: number): { worst: number; turned: number } {
  const tel = createTelemetry(), I: Input = { ...NO_INPUT, fwd: 0.25, steer: -1 }; // full left
  const h0 = d.V.h;
  let worst = 0;
  for (let f = 0; f < seconds * 60; f++) {
    d.stepFrame(1 / 60, I, opts());
    telemetry(d.s, tel);
    const pk = frontPeakSlip(d.s), slip = Math.max(Math.abs(tel.wheelSlipAngle[0]), Math.abs(tel.wheelSlipAngle[1]));
    if (slip / pk > worst) worst = slip / pk;
  }
  return { worst, turned: d.V.h - h0 };
}

describe('the assist layer', () => {
  it('Standard is the default', () => { expect(DEFAULT_PRESET).toBe('standard'); });

  it('Casual keeps the front tyres just short of their peak slip on full lock at 90 km/h; Pure lets them go far past it', () => {
    const casual = worstFrontSlip(rolling('casual', 25), 2);
    const pure = worstFrontSlip(rolling('pure', 25), 2);
    expect(casual.worst).toBeLessThanOrEqual(1.0);   // never past the peak (the limit is 0.9 of it)
    expect(casual.worst).toBeGreaterThan(0.7);       // and close to it: the car is cornering, not barely turning
    expect(casual.turned).toBeGreaterThan(0.8);      // 0.8 rad of heading in 2 s: still turns hard
    expect(pure.worst).toBeGreaterThan(2);           // full lock is about 34 degrees: the fronts are sliding
  });

  it('Standard holds the same limit a little looser than Casual', () => {
    expect(ASSISTS.standard.slipShare!).toBeGreaterThan(ASSISTS.casual.slipShare!);
    const standard = worstFrontSlip(rolling('standard', 25), 2);
    expect(standard.worst).toBeLessThanOrEqual(1.3);
    expect(standard.worst).toBeGreaterThan(0.9);
  });

  it('Pure passes the input through: steering, pedals, gear, nitrous and the systems as the driver set them', () => {
    const d = rolling('pure', 20), c: Controls = defaultControls(), tel = createTelemetry();
    telemetry(d.s, tel);
    tel.wheelSlipRatio.fill(3); // wildly spinning driven wheels change nothing in Pure
    const w = wish({ steer: 0.73, throttle: 0.6, brake: 0.2, handbrake: 1, gear: 3, nitrous: true });
    applyAssists(ASSISTS.pure, w, d.s, tel, assistMemory(), { abs: false, tcs: false, esc: true }, c, DT);
    expect(c).toMatchObject({ steer: 0.73, throttle: 0.6, brake: 0.2, handbrake: 1, gear: 3, nitrous: true, abs: false, tcs: false, esc: true });
    // and the CoreDriver hands the game's steering to it negated (+1 right in the game is -1 in the core), at once
    const I: Input = { ...NO_INPUT, steer: 0.5 };
    d.stepFrame(1 / 120, I, opts());
    expect(d.V.steer).toBeCloseTo(-0.5, 12);
  });

  it('Casual eases the throttle while the driven wheels spin and gives it back when they grip; Standard does not', () => {
    const d = rolling('casual', 10), tel = createTelemetry();
    telemetry(d.s, tel);
    const spin = createTelemetry(); spin.wheelSlipRatio.fill(0.6); // four or five times a road tyre's peak
    const run = (preset: AssistPreset, t: typeof tel, steps: number, mem = assistMemory()) => {
      const c = defaultControls();
      for (let i = 0; i < steps; i++) applyAssists(ASSISTS[preset], wish({ throttle: 1 }), d.s, t, mem, { abs: true, tcs: true, esc: true }, c, DT);
      return { c, mem };
    };
    const eased = run('casual', spin, 30);
    expect(eased.c.throttle).toBeLessThan(0.5);                       // a quarter of a second of wheelspin
    expect(run('casual', tel, 60, eased.mem).c.throttle).toBe(1);     // half a second of grip: all of it back
    expect(run('standard', spin, 30).c.throttle).toBe(1);
    // nor in a drift, where a spinning rear is the point
    const c = defaultControls(), mem = assistMemory();
    for (let i = 0; i < 30; i++) applyAssists(ASSISTS.casual, wish({ throttle: 1, drift: true }), d.s, spin, mem, { abs: true, tcs: true, esc: true }, c, DT);
    expect(c.throttle).toBe(1);
  });

  it('Casual shifts for the driver and keeps the systems on; a drift turns traction and stability control off in every preset', () => {
    const d = rolling('casual', 10), tel = createTelemetry(), c = defaultControls();
    const off = { abs: false, tcs: false, esc: false };
    applyAssists(ASSISTS.casual, wish({ gear: 3 }), d.s, tel, assistMemory(), off, c, DT);
    expect(c.gear).toBe(AUTO_GEAR);
    expect([c.abs, c.tcs, c.esc]).toEqual([true, true, true]);
    applyAssists(ASSISTS.casual, wish({ gear: -1 }), d.s, tel, assistMemory(), off, c, DT);
    expect(c.gear).toBe(-1);                                          // reverse is reverse
    applyAssists(ASSISTS.standard, wish({ gear: 3 }), d.s, tel, assistMemory(), off, c, DT);
    expect(c.gear).toBe(3);                                           // Standard: the gear the driver chose
    for (const p of ['casual', 'standard', 'pure'] as const) {
      applyAssists(ASSISTS[p], wish({ drift: true }), d.s, tel, assistMemory(), { abs: true, tcs: true, esc: true }, c, DT);
      expect([c.tcs, c.esc]).toEqual([false, false]);
      expect(c.abs).toBe(true);
    }
  });

  it('Standard: a keyboard lane change at 100 and 120 km/h leaves a front-drive family sedan settled once the wheel is let go (at most 0.2 rad of body slip)', () => {
    // Steer one way for half a second, the other for half a second, then hands off at half throttle. The limit held
    // the hands-off wheel at its edge, the front at its peak toward the slide: the Camry wound itself up to 0.96 rad
    // (1.2 rad at 120 km/h) and lost half its speed; with the wheel simply let go it stays under 0.1 rad.
    const camry = { make: 'Toyota', model: 'Camry', bodyStyle: 'sedan' };
    for (const kmh of [100, 120]) {
      for (const preset of ['standard', 'pure'] as const) {
        const d = new CoreDriver(camry, specFor(camry), { cfg: STOCK_CFG, tune: TUNE_DEF }, { x: 0, z: 0, h: 0 }, { preset });
        for (let t = 0; d.V.u * 3.6 < kmh && t < 25; t += 1 / 60) d.stepFrame(1 / 60, { ...NO_INPUT, fwd: 1 }, opts());
        let worst = 0;
        const legs: [number, number][] = [[0.5, -1], [0.5, 1], [3, 0]];
        for (const [secs, steer] of legs) {
          for (let f = 0; f < secs * 60; f++) { d.stepFrame(1 / 60, { ...NO_INPUT, steer, fwd: 0.5 }, opts()); worst = Math.max(worst, Math.abs(d.V.beta)); }
        }
        expect(worst, `${preset} at ${kmh} km/h`).toBeLessThan(0.2);
        expect(Math.abs(d.V.beta), `${preset} at ${kmh} km/h, 3 s after`).toBeLessThan(0.02);
        expect(d.V.u * 3.6, `${preset} at ${kmh} km/h`).toBeGreaterThan(0.75 * kmh);
      }
    }
  });

  it('Casual in a drift (stability and traction control off) does not spin in a steady corner the bare car takes cleanly, and is about as steady as Pure', () => {
    // Held at 70 km/h with half lock and 0.6 throttle for 3 s, then hands off: the limit held the front at its peak and
    // the rear let go, so the rental spun at 2.9 s; Pure, its front past its peak, stayed under 0.1 rad.
    const ronin = { make: 'Ronin', model: 'GT', rental: true }, drift = (): DriveOpts => ({ ...opts(), drift: true });
    const worst: Record<string, number> = {};
    for (const preset of ['casual', 'pure'] as const) {
      const d = new CoreDriver(ronin, specFor(ronin), { cfg: STOCK_CFG, tune: TUNE_DEF }, { x: 0, z: 0, h: 0 }, { preset });
      for (let t = 0; d.V.u * 3.6 < 70 && t < 25; t += 1 / 60) d.stepFrame(1 / 60, { ...NO_INPUT, fwd: 1 }, drift());
      let w = 0;
      for (let f = 0; f < 180; f++) { d.stepFrame(1 / 60, { ...NO_INPUT, steer: -0.5, fwd: 0.6 }, drift()); w = Math.max(w, Math.abs(d.V.beta)); }
      for (let f = 0; f < 120; f++) { d.stepFrame(1 / 60, NO_INPUT, drift()); w = Math.max(w, Math.abs(d.V.beta)); }
      expect(d.V.u, preset).toBeGreaterThan(10); // still driving forward, not spun round
      worst[preset] = w;
    }
    expect(worst.casual).toBeLessThan(0.2);
    expect(worst.casual).toBeLessThan(worst.pure + 0.05);
  });

  it('Standard in a drift lets a power slide build and holds it: half a radian and more, no spin', () => {
    // A drift is wanted there (and scored past 0.17 rad): the limit closes in only beyond DRIFT_ROOM times its usual slide.
    const ronin = { make: 'Ronin', model: 'GT', rental: true }, drift = (): DriveOpts => ({ ...opts(), drift: true });
    const d = new CoreDriver(ronin, specFor(ronin), { cfg: STOCK_CFG, tune: TUNE_DEF }, { x: 0, z: 0, h: 0 }, { preset: 'standard' });
    for (let t = 0; d.V.u * 3.6 < 60 && t < 25; t += 1 / 60) d.stepFrame(1 / 60, { ...NO_INPUT, fwd: 1 }, drift());
    let w = 0;
    for (let f = 0; f < 180; f++) { d.stepFrame(1 / 60, { ...NO_INPUT, steer: -1, fwd: 1 }, drift()); w = Math.max(w, Math.abs(d.V.beta)); }
    expect(w).toBeGreaterThan(0.4);
    expect(w).toBeLessThan(1.0);
    expect(d.V.u).toBeGreaterThan(5);
  });

  it('Casual steering slows with road speed: a keyboard press reaches full lock several times quicker parked than at 100 km/h', () => {
    const toFull = (speed: number) => {
      const d = rolling('casual', 0), mem = assistMemory(), c = defaultControls(), tel = createTelemetry();
      d.s.u = speed;
      let n = 0;
      while (mem.steer < 0.999 && n < 1000) { applyAssists(ASSISTS.casual, wish({ steer: 1 }), d.s, tel, mem, { abs: true, tcs: true, esc: true }, c, DT); n++; }
      return n * DT;
    };
    const parked = toFull(0), fast = toFull(27.8);
    expect(parked).toBeLessThan(0.3);
    expect(fast).toBeGreaterThan(3 * parked);
  });
});
