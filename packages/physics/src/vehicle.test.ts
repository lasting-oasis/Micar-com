// The whole car on the fixture coupe: a 1,600 kg rear-drive car on summer tyres (about 400 hp at 7,000 rpm, a 3.5
// first gear and a 3.7 final drive, 0.33 m tyres, a 2.7 m wheelbase with the centre of gravity 1.25 m behind the front
// axle and 0.52 m up), driven on flat dry asphalt unless a test says otherwise.
import { describe, expect, it } from 'vitest';
import type { Controls, SurfaceSample, TyreParams, VehicleState, WorldQuery } from './types';
import { AUTO_GEAR } from './types';
import { fixtureModel } from './fixtures';
import { G, rng } from './math';
import { FLAT, createState, createTelemetry, defaultControls } from './state';
import { peakSlipRatio, peakSlipTan, tyreForces, tyreMuX, tyreMuY } from './tyre';
import { MPH, RPM } from './units';
import { STEP, SUBSTEPS, applyImpulse, createVehicle, hashState, placeVehicle, step, stepWith, telemetry } from './vehicle';
import { proofSheet } from './golden';
import { resolveModel } from './resolve';

const KMH = 1 / 3.6;
const ctl = (over: Partial<Controls> = {}): Controls => ({ ...defaultControls(), ...over });
const fresh = (): VehicleState => createVehicle(fixtureModel());
const seconds = (t: number): number => Math.round(t / STEP);

/** Sets the car rolling straight at v (m/s): wheels turning with the road, the engine with them in a gear that keeps it under 55% of redline. */
function rollingAt(s: VehicleState, v: number): void {
  const m = s.model, d = m.driveline;
  s.u = v;
  for (let i = 0; i < 4; i++) s.wheelOmega[i] = v / (i < 2 ? m.tyreFront.radius : m.tyreRear.radius);
  let g = 1;
  while (g < d.gears.length && d.gears[g - 1] * d.finalDrive * s.wheelOmega[2] > 0.55 * m.engine.redline) g++;
  s.gear = g; s.gearNext = g; s.ratio = d.gears[g - 1];
  s.engineOmega = s.ratio * d.finalDrive * s.wheelOmega[2];
}

/** Kinetic energy of the car's moving parts, J: the body's motion and yaw and the four wheels' spin. */
function kinetic(s: VehicleState): number {
  const m = s.model, w = s.wheelOmega;
  return 0.5 * m.chassis.mass * (s.u * s.u + s.v * s.v) + 0.5 * m.chassis.izz * s.r * s.r
    + 0.5 * m.wheelInertiaFront * (w[0] * w[0] + w[1] * w[1]) + 0.5 * m.wheelInertiaRear * (w[2] * w[2] + w[3] * w[3]);
}

const SCALARS = ['time', 'x', 'y', 'hx', 'hy', 'u', 'v', 'r', 'ax', 'ay', 'heave', 'pitch', 'roll', 'heaveRate', 'pitchRate', 'rollRate',
  'engineOmega', 'boost', 'engineTorque', 'clutchTorque', 'clutchLocked', 'gear', 'gearNext', 'shiftTimer', 'ratio',
  'tcsActive', 'escActive', 'limiterActive', 'tcsCut', 'nitrousLeft', 'distance', 'energyUsed', 'shiftPedal'] as const;
const ARRAYS = ['wheelOmega', 'wheelLoad', 'wheelFx', 'wheelFy', 'wheelMz', 'wheelDefX', 'wheelDefY', 'wheelSlipRatio', 'wheelSlipTan',
  'wheelSteer', 'wheelBrake', 'absActive', 'absHold', 'tcsBrake'] as const;

/** Every number in the state, by name. */
function numbers(s: VehicleState): Map<string, number> {
  const out = new Map<string, number>();
  for (const k of SCALARS) out.set(k, s[k]);
  for (const k of ARRAYS) s[k].forEach((x, i) => out.set(`${k}[${i}]`, x));
  return out;
}

describe('a car set down', () => {
  it('stands on its static loads with the engine idling in first gear', () => {
    const s = fresh(), ch = s.model.chassis;
    const L = ch.a + ch.b;
    // Front axle m g b / L = 8,426 N, rear m g a / L = 7,264 N, shared equally across each axle.
    expect(s.wheelLoad[0]).toBeCloseTo(0.5 * ch.mass * G * ch.b / L, 6);
    expect(s.wheelLoad[0]).toBeCloseTo(4213, 0);
    expect(s.wheelLoad[1]).toBe(s.wheelLoad[0]);
    expect(s.wheelLoad[2]).toBeCloseTo(3632, 0);
    expect(s.wheelLoad[0] + s.wheelLoad[1] + s.wheelLoad[2] + s.wheelLoad[3]).toBeCloseTo(ch.mass * G, 6);
    expect(s.engineOmega / RPM).toBeCloseTo(697, 0);   // the fixture's 73 rad/s idle
    expect(s.gear).toBe(1);
    expect(s.ratio).toBe(3.5);
    expect(s.u).toBe(0);
    expect(s.hx).toBe(1);
  });

  it('sets a CVT down in its lowest gearing whichever way round its two end ratios are listed, and it pulls away the same', () => {
    const cvt = (gears: number[]): VehicleState => createVehicle(fixtureModel({ driveline: {
      transmission: 'cvt', gears: new Float64Array(gears), launch: 'converter', shiftTime: 0, shiftTorqueHold: 1, cvtRatioRate: 2,
      converter: { stallOmega: 2100 * RPM, torqueRatio: 1.9, couplingRatio: 0.88, lockGear: 1 },
    } }));
    const a = cvt([2.6, 0.45]), b = cvt([0.45, 2.6]);
    expect(a.ratio).toBe(2.6);
    expect(b.ratio).toBe(2.6);
    const c = ctl({ throttle: 1 });
    let atA = 0, atB = 0;
    for (let k = 0; k < seconds(15) && !(atA && atB); k++) {
      step(a, c, FLAT); step(b, c, FLAT);
      if (!atA && a.u >= 60 * MPH) atA = a.time;
      if (!atB && b.u >= 60 * MPH) atB = b.time;
    }
    expect(atA).toBeGreaterThan(3);
    expect(atA).toBeLessThan(8);
    expect(atB).toBe(atA);
  });

  it('stays at rest for a minute with nothing pressed, and with the brake held', () => {
    for (const c of [ctl(), ctl({ brake: 1 })]) {
      const s = fresh();
      let worstSpeed = 0, worstYaw = 0;
      for (let k = 0; k < seconds(60); k++) {
        step(s, c, FLAT);
        worstSpeed = Math.max(worstSpeed, Math.hypot(s.u, s.v));
        worstYaw = Math.max(worstYaw, Math.abs(s.r));
      }
      expect(Math.hypot(s.x, s.y)).toBeLessThan(0.001);     // within a millimetre
      expect(worstSpeed).toBeLessThan(0.001);                // never a millimetre a second
      expect(worstYaw).toBeLessThan(1e-6);                   // no creeping yaw
      expect(Math.abs(s.hy)).toBeLessThan(1e-9);
      expect(Math.abs(s.engineOmega / s.model.engine.idle - 1)).toBeLessThan(0.02);   // still idling
      expect(s.time).toBeCloseTo(60, 9);
    }
  });

  it('after a slide it springs back no further than its tyres\' elastic give, and rests with the tyres unwound', () => {
    // A sliding patch carries the sliding force; the rubber is bent only as far as carries that force on the sticking
    // side of the curve (its elastic give, found here from tyreForces itself at the load each tyre had when the car
    // stopped). Whatever the patch slid beyond that is distance, not a spring. So a car stopped from a slide springs
    // back by about the largest give and no further, and at rest each tyre keeps only half the spread of the four gives
    // (the more loaded tyres bent further; the body settles where their pushes balance).
    const out = { fx: 0, fy: 0, mz: 0, use: 0 };
    const elastic = (tyre: TyreParams, fz: number, lateral: boolean): number => {
      const peak = lateral ? peakSlipTan(tyre, fz, 1) : peakSlipRatio(tyre, fz, 1);
      const force = (x: number): number => { tyreForces(tyre, fz, lateral ? 0 : x, lateral ? x : 0, 0, 1, out); return lateral ? out.fy : out.fx; };
      const slide = tyre.slideRatio * force(peak);   // the far sliding share of the peak force
      let lo = 0, hi = peak;
      for (let k = 0; k < 60; k++) { const mid = 0.5 * (lo + hi); if (force(mid) < slide) lo = mid; else hi = mid; }
      return lo * (lateral ? tyre.relaxLat : tyre.relaxLong);
    };
    const run = (s: VehicleState, c: Controls, lateral: boolean): void => {
      const m = s.model, gives = [0, 0, 0, 0];
      let stop = NaN, least = Infinity;
      for (let k = 0; k < seconds(10); k++) {
        const loads = Array.from(s.wheelLoad);
        step(s, c, FLAT);
        const along = lateral ? s.y : s.x, speed = lateral ? s.v : s.u;
        if (stop !== stop && speed <= 0) {
          stop = along;
          for (let i = 0; i < 4; i++) gives[i] = elastic(i < 2 ? m.tyreFront : m.tyreRear, loads[i], lateral);
        }
        if (stop === stop) least = Math.min(least, along);
      }
      const what = lateral ? 'slid sideways' : 'braked';
      const most = Math.max(...gives), spread = most - Math.min(...gives);
      expect(stop, what).toBeGreaterThan(0.4);
      expect(stop - least, `${what}: sprang back ${stop - least} m against a give of ${most} m`).toBeLessThan(1.1 * most);
      const def = lateral ? s.wheelDefY : s.wheelDefX;
      for (let i = 0; i < 4; i++) expect(Math.abs(def[i]), `${what}: wheel ${i} at rest, against half the spread ${spread / 2}`).toBeLessThan(0.55 * spread + 1e-4);
    };
    // Sideways at 3 m/s in neutral, nothing pressed (gives of 34 to 43 mm).
    const side = fresh();
    side.gear = 0; side.gearNext = 0; side.ratio = 0; side.v = 3;
    run(side, ctl({ gear: 0 }), true);
    // Stopped by the brakes from 20 m/s, the wheels locking below ABS's cut-off, then held on the brakes (about 12 mm).
    const braked = fresh();
    rollingAt(braked, 20);
    run(braked, ctl({ brake: 1 }), false);
  });

  it('springs back on its tyres when nudged on the brakes, and settles where it stood', () => {
    // 5 cm/s forward on four held wheels: the tyres' standstill springs (4 x 412 kN/m against 1,600 kg, about 5 Hz),
    // critically damped, take it about half a millimetre and bring it home without swinging past.
    const s = fresh(), c = ctl({ brake: 1 });
    for (let k = 0; k < seconds(1); k++) step(s, c, FLAT);
    applyImpulse(s, 1600 * 0.05, 0, s.x, s.y);
    let furthest = 0, behind = 0;
    for (let k = 0; k < seconds(2); k++) {
      step(s, c, FLAT);
      furthest = Math.max(furthest, s.x);
      behind = Math.min(behind, s.x);
    }
    expect(furthest).toBeGreaterThan(0.0002);
    expect(furthest).toBeLessThan(0.0015);
    expect(-behind).toBeLessThan(0.1 * furthest);           // no ringing back past where it stood
    expect(Math.abs(s.x)).toBeLessThan(0.00001);            // home to a hundredth of a millimetre
    expect(Math.abs(s.u)).toBeLessThan(0.0001);
  });

  it('rolls freely on its wheels at walking pace with nothing pressed, and the tyres stop a sideways drift', () => {
    // Pushed at 0.5 m/s forward and 0.2 m/s sideways, clutch open, no brake: the wheels roll with the road (no
    // chatter from the tyres' low-speed damping against a light free wheel) and the tyres take the sideways speed out
    // within a few millimetres, as a parked car's would.
    const s = fresh(), c = ctl(), R = s.model.tyreFront.radius;
    s.u = 0.5; s.v = 0.2;
    let worstSkid = 0, at2 = NaN;
    for (let k = 0; k < seconds(5); k++) {
      step(s, c, FLAT);
      if (k === seconds(2) - 1) at2 = s.u;
      if (s.time > 0.1 && s.u > 0.05) for (let i = 0; i < 4; i++) worstSkid = Math.max(worstSkid, Math.abs(s.wheelOmega[i] * R - s.u));
    }
    // The wheels start still, so the push is first shared with their spin (the tyres keep m u + sum J omega / R), then
    // only rolling resistance slows it: 0.0095 g, also shared with the wheels' spin, 0.18 m/s in 2 s.
    const m = s.model, rotating = 2 * m.wheelInertiaFront / R ** 2 + 2 * m.wheelInertiaRear / m.tyreRear.radius ** 2;
    const share = m.chassis.mass / (m.chassis.mass + rotating);
    const lost = 0.5 * (1 - share) + 0.0095 * G * share * 2;
    expect(0.5 - at2).toBeGreaterThan(0.95 * lost);
    expect(0.5 - at2).toBeLessThan(1.05 * lost);
    expect(worstSkid).toBeLessThan(0.005);                // every wheel within 5 mm/s of the road
    expect(Math.abs(s.y)).toBeLessThan(0.002);
    expect(Math.abs(s.v)).toBeLessThan(1e-6);
  });

  it('a car let roll slowly in neutral on the flat comes to rest in the time and distance rolling resistance gives', () => {
    // Rolling resistance is friction, not a damper: from 1 m/s at 0.0095 g (less a little for the wheels' spin) the
    // car stops in about 11 s after about 5.5 m, and from 0.3 m/s in about 3.3 s after half a metre. Then it stays.
    for (const v0 of [1, 0.3]) {
      const s = fresh(), c = ctl({ gear: 0 }), m = s.model;
      s.gear = 0; s.gearNext = 0; s.ratio = 0; s.u = v0;
      for (let i = 0; i < 4; i++) s.wheelOmega[i] = v0 / (i < 2 ? m.tyreFront.radius : m.tyreRear.radius);
      const rotating = 2 * m.wheelInertiaFront / m.tyreFront.radius ** 2 + 2 * m.wheelInertiaRear / m.tyreRear.radius ** 2;
      const decel = 0.0095 * G * m.chassis.mass / (m.chassis.mass + rotating);
      const time = v0 / decel, far = v0 * v0 / (2 * decel);
      for (let k = 0; k < seconds(1.2 * time + 1); k++) step(s, c, FLAT);
      const x = s.x;
      expect(Math.abs(s.u), `from ${v0} m/s`).toBeLessThan(1e-6);
      expect(x, `from ${v0} m/s`).toBeGreaterThan(0.95 * far);
      expect(x, `from ${v0} m/s`).toBeLessThan(1.05 * far);
      for (let k = 0; k < seconds(30); k++) step(s, c, FLAT);
      expect(Math.abs(s.x - x) * 1000, `from ${v0} m/s: mm crept after stopping`).toBeLessThan(0.1);
    }
  });
});

describe('full throttle from rest', () => {
  type Run = { s: VehicleState; at60: number; at100: number; firstGearG: number; worstSlip: number; frontUse: number; rearUse: number; worstGrip: number };
  function launch(substeps: number): Run {
    const s = fresh(), c = ctl({ throttle: 1 });
    const out = createTelemetry();
    let at60 = 0, at100 = 0, firstGearG = 0, worstSlip = 0, frontUse = 0, rearUse = 0, samples = 0, worstGrip = 0;
    for (let k = 0; k < seconds(20) && !(at60 && at100); k++) {
      stepWith(s, c, FLAT, substeps);
      for (const i of [2, 3]) {
        expect(Number.isFinite(s.wheelSlipRatio[i])).toBe(true);
        worstSlip = Math.max(worstSlip, Math.abs(s.wheelSlipRatio[i]));
      }
      // Each tyre's force against its friction ellipse, from the very first metre (where the low-speed damper works).
      for (let i = 0; i < 4; i++) {
        const p = i < 2 ? s.model.tyreFront : s.model.tyreRear, fz = s.wheelLoad[i];
        const nx = s.wheelFx[i] / (tyreMuX(p, fz, 1) * fz), ny = s.wheelFy[i] / (tyreMuY(p, fz, 1) * fz);
        worstGrip = Math.max(worstGrip, Math.sqrt(nx * nx + ny * ny));
      }
      if (s.gear === 1 && s.u > 3 && s.shiftTimer === 0) {
        firstGearG = Math.max(firstGearG, s.ax / G);
        telemetry(s, out);
        frontUse += out.wheelUse[0]; rearUse += out.wheelUse[2]; samples++;
      }
      if (!at60 && s.u >= 60 * MPH) at60 = s.time;
      if (!at100 && s.u >= 100 * KMH) at100 = s.time;
    }
    return { s, at60, at100, firstGearG, worstSlip, frontUse: frontUse / samples, rearUse: rearUse / samples, worstGrip };
  }
  const run = launch(SUBSTEPS);

  it('drives it forward along +X, straight', () => {
    expect(run.s.x).toBeGreaterThan(30);
    expect(Math.abs(run.s.y)).toBeLessThan(0.001);
    expect(Math.abs(run.s.hy)).toBeLessThan(1e-6);
  });

  it('reaches 60 mph in 3 to 8 seconds, as a 400 hp, 1,600 kg rear-drive car does', () => {
    expect(run.at60).toBeGreaterThan(3);
    expect(run.at60).toBeLessThan(8);
  });

  it('is traction-limited in first gear: about mu g (a / L) / (1 - mu h / L) on the driven rear axle', () => {
    // Rear-drive traction limit with the load moving back: mu 1.10 on the rear tyres gives 0.65 g. Traction control
    // holds the rear tyres near their peak, so the car runs a few percent under it, never over.
    const m = run.s.model, ch = m.chassis, L = ch.a + ch.b;
    const rearLoad = 0.5 * ch.mass * G * ch.a / L * 1.25;
    const mu = tyreMuX(m.tyreRear, rearLoad, 1);
    const limit = mu * (ch.a / L) / (1 - mu * ch.cgHeight / L);
    expect(limit).toBeCloseTo(0.65, 1);
    expect(run.firstGearG).toBeGreaterThan(0.9 * limit);
    expect(run.firstGearG).toBeLessThan(1.02 * limit);
    // The driven tyres work at their peak; the steered ones just roll.
    expect(run.rearUse).toBeGreaterThan(0.8);
    expect(run.rearUse).toBeLessThan(1.6);
    expect(run.frontUse).toBeLessThan(0.1);
  });

  it('never asks a tyre for more than its grip, even pulling away from a standstill', () => {
    expect(run.worstGrip).toBeGreaterThan(0.95);            // the driven tyres did work at their limit
    expect(run.worstGrip).toBeLessThan(1 + 1e-9);
  });

  it('keeps the driven wheels slip ratio finite and within a few peak slips', () => {
    const peak = peakSlipRatio(run.s.model.tyreRear, 4000, 1);
    expect(run.worstSlip).toBeGreaterThan(0.5 * peak);       // it did spin them up to the peak
    expect(run.worstSlip).toBeLessThan(3 * peak + 1e-12);
  });

  it('gives the same 0 to 100 km/h with 8 substeps as with 4, to within 1%', () => {
    const fine = launch(8);
    expect(run.at100).toBeGreaterThan(3);
    expect(Math.abs(fine.at100 / run.at100 - 1)).toBeLessThan(0.01);
    // ...and the 8 substeps really were 8: after a second the two runs differ in their last bits. (Were the count
    // ignored, the comparison above would be of a run with itself.)
    const a = fresh(), b = fresh(), c = ctl({ throttle: 1 });
    for (let k = 0; k < seconds(1); k++) { stepWith(a, c, FLAT, 4); stepWith(b, c, FLAT, 8); }
    expect(hashState(b)).not.toBe(hashState(a));
    expect(a.time).toBeCloseTo(b.time, 12);
  });
});

describe('an automatic choosing its own gears', () => {
  // The proof sedan's eight-speed and the proof pickup's ten-speed. A driver feeding the pedal in and out for wheelspin,
  // or easing it through a corner exit, is still asking for everything the car has: a gearbox controller reads the
  // pedal through a filter for that reason, and a launch never changes back down into the gear it has just left.
  const proof = (name: 'sedan' | 'pickup') => resolveModel(proofSheet(name)).model;
  for (const [dipTo, dipFor, every] of [[0, 0.25, 0.75], [0.2, 0.2, 0.6], [0.5, 0.3, 0.9], [0.75, 0.25, 0.5]] as const) {
    it(`flat out from rest with the pedal dipping to ${dipTo} for ${dipFor} s every ${every} s, it only ever changes up`, () => {
      for (const name of ['sedan', 'pickup'] as const) {
        const s = createVehicle(proof(name)), c = ctl({ gear: AUTO_GEAR });
        const seen: number[] = [s.gear];
        for (let k = 0; k < seconds(25) && s.u < 70 * MPH; k++) {
          c.throttle = (k * STEP) % every < dipFor ? dipTo : 1;
          step(s, c, FLAT);
          if (s.gear !== seen[seen.length - 1]) seen.push(s.gear);
        }
        expect(s.u, name).toBeGreaterThan(70 * MPH);
        for (let i = 1; i < seen.length; i++) expect(seen[i], `${name}: ${seen.join(' ')}`).toBeGreaterThan(seen[i - 1]);
      }
    });
  }
  it('lifted for good, it still changes up early as a light throttle asks, within a few seconds', () => {
    const s = createVehicle(proof('sedan')), c = ctl({ gear: AUTO_GEAR, throttle: 1 });
    while (s.u < 40 * MPH) step(s, c, FLAT);
    const flatOut = s.gear;
    c.throttle = 0.12;
    for (let k = 0; k < seconds(6); k++) step(s, c, FLAT);
    expect(s.gear).toBeGreaterThan(flatOut + 1);
  });
});

describe('steering', () => {
  const sides = (): { left: VehicleState; right: VehicleState } => {
    const left = fresh(), right = fresh();
    rollingAt(left, 15); rollingAt(right, 15);
    return { left, right };
  };

  it('full lock left at 15 m/s turns the car left', () => {
    const { left: s } = sides();
    const c = ctl({ steer: 1 });
    let lastY = 0, grew = 0, worstAy = 0;
    for (let k = 0; k < seconds(2); k++) {
      step(s, c, FLAT);
      if (s.y > lastY) grew++;
      lastY = s.y;
      worstAy = Math.max(worstAy, Math.abs(s.ay));
    }
    expect(grew).toBe(seconds(2));            // y grew every step
    expect(s.y).toBeGreaterThan(5);
    expect(s.r).toBeGreaterThan(0.3);
    expect(s.hy).toBeGreaterThan(0.3);
    expect(s.roll).toBeGreaterThan(0);        // a left turn rolls the car onto its right side
    expect(s.wheelLoad[1]).toBeGreaterThan(s.wheelLoad[0]);
    // Never more sideways than the tyres can give: mu about 1.0 to 1.1.
    expect(worstAy / G).toBeLessThan(1.1);
    expect(worstAy / G).toBeGreaterThan(0.5);
  });

  it('full lock right is the exact mirror image of full lock left', () => {
    const { left, right } = sides();
    const cl = ctl({ steer: 1 }), cr = ctl({ steer: -1 });
    // Mirrored across the car's centre line: y, v, r, hy, ay, roll and its rate, and every lateral wheel quantity
    // change sign; left and right wheels swap.
    const flip = new Set(['y', 'hy', 'v', 'r', 'ay', 'roll', 'rollRate']);
    const flipWheel = new Set(['wheelFy', 'wheelMz', 'wheelDefY', 'wheelSlipTan', 'wheelSteer']);
    const swap = [1, 0, 3, 2];
    let worst = 0, where = '';
    for (let k = 0; k < seconds(3); k++) {
      step(left, cl, FLAT); step(right, cr, FLAT);
      const a = numbers(left), b = numbers(right);
      for (const [name, x] of a) {
        const m = /^(\w+)\[(\d)\]$/.exec(name);
        let y: number;
        if (m) y = (flipWheel.has(m[1]) ? -1 : 1) * (b.get(`${m[1]}[${swap[Number(m[2])]}]`) as number);
        else y = (flip.has(name) ? -1 : 1) * (b.get(name) as number);
        const d = Math.abs(x - y);
        if (d > worst) { worst = d; where = `${name} at step ${k}`; }
      }
    }
    expect(left.y).toBeGreaterThan(5);
    expect(right.y).toBeLessThan(-5);
    expect(worst, where).toBeLessThan(1e-9);
  });
});

describe('braking', () => {
  it('full pedal from 30 m/s stops it in 40 to 60 m, and it then stays stopped', () => {
    const s = fresh(), c = ctl({ brake: 1 });
    rollingAt(s, 30);
    let stoppedAt = -1, stopX = 0;
    for (let k = 0; k < seconds(10) && stoppedAt < 0; k++) {
      step(s, c, FLAT);
      if (s.u <= 0) { stoppedAt = s.time; stopX = s.x; }
    }
    // Tyre-limited: 30^2 / (2 mu g) with mu about 1.1 is 42 m; ABS gives back a little.
    expect(stoppedAt).toBeGreaterThan(0);
    expect(stopX).toBeGreaterThan(40);
    expect(stopX).toBeLessThan(60);
    // The tyres give back their braking deflection (a few centimetres) within a second, then it is held.
    let back = 0;
    for (let k = 0; k < seconds(1); k++) { step(s, c, FLAT); back = Math.max(back, stopX - s.x); }
    expect(back).toBeLessThan(0.05);
    const held = s.x;
    let worstSpeed = 0;
    for (let k = 0; k < seconds(10); k++) { step(s, c, FLAT); worstSpeed = Math.max(worstSpeed, Math.abs(s.u)); }
    expect(Math.abs(s.x - held)).toBeLessThan(0.001);
    expect(worstSpeed).toBeLessThan(0.001);
    expect(s.wheelOmega.every((w) => w === 0)).toBe(true);   // the brakes hold every wheel exactly
  });
});

describe('energy', () => {
  it('with no input from 30 m/s, the car\'s kinetic energy never rises from one step to the next', () => {
    const s = fresh(), c = ctl();
    rollingAt(s, 30);
    const start = kinetic(s);
    let last = start, rises = 0;
    for (let k = 0; k < seconds(60); k++) {
      step(s, c, FLAT);
      const e = kinetic(s);
      if (e > last) rises++;
      last = e;
    }
    expect(rises).toBe(0);
    // Drag, rolling resistance and engine braking took most of it (720 kJ at the start).
    expect(start).toBeGreaterThan(7e5);
    expect(last).toBeLessThan(0.2 * start);
  });
});

describe('the state hash', () => {
  function drive(s: VehicleState, steps: number, seed: number, change?: { at: number; steer: number }): void {
    const rand = rng(seed), c = ctl();
    for (let k = 0; k < steps; k++) {
      if (k % 60 === 0) { c.throttle = rand(); c.steer = 2 * rand() - 1; c.brake = rand() < 0.2 ? rand() : 0; }
      if (change && k === change.at) {
        const was = c.steer;
        c.steer = change.steer;
        step(s, c, FLAT);
        c.steer = was;
      } else step(s, c, FLAT);
    }
  }

  it('is the same for two cars given the same controls for 2000 steps, and differs after one differing control', () => {
    const a = fresh(), b = fresh(), d = fresh();
    drive(a, 2000, 7);
    drive(b, 2000, 7);
    drive(d, 2000, 7, { at: 1000, steer: 0.123 });
    expect(a.u).toBeGreaterThan(5);           // it really drove
    expect(hashState(a)).toBe(hashState(b));
    expect(hashState(a)).not.toBe(hashState(d));
    expect(Number.isInteger(hashState(a))).toBe(true);
    expect(hashState(a)).toBeGreaterThanOrEqual(0);
    expect(hashState(a)).toBeLessThan(2 ** 32);
  });

  it('changes when any single number in the state changes, typed array elements included', () => {
    const s = fresh();
    drive(s, 300, 3);
    const base = hashState(s);
    let checked = 0;
    for (const k of SCALARS) {
      const was = s[k];
      s[k] = was === 0 ? 1e-300 : was * (1 + 2 ** -52);
      expect(hashState(s), k).not.toBe(base);
      s[k] = was;
      checked++;
    }
    for (const k of ARRAYS) {
      for (let i = 0; i < 4; i++) {
        const was = s[k][i];
        s[k][i] = was === 0 ? 1e-300 : was * (1 + 2 ** -52);
        expect(hashState(s), `${k}[${i}]`).not.toBe(base);
        s[k][i] = was;
        checked++;
      }
    }
    expect(hashState(s)).toBe(base);
    expect(checked).toBe(SCALARS.length + 4 * ARRAYS.length);
  });
});

describe('the state is the car', () => {
  it('a copy of every field of a VehicleState is the same car: the same hash, and the same gear and speed a second on', () => {
    // The pedal the gearbox controller reads was kept beside the state: a copy of every field had none of it, hashed
    // differently, and a second at 0.3 of the pedal later the original was in fifth and the copy in seventh.
    const m = resolveModel(proofSheet('sedan')).model, a = createVehicle(m), c = defaultControls();
    c.gear = AUTO_GEAR; c.throttle = 1;
    while (a.u < 50 * MPH) step(a, c, FLAT);
    for (const b of [createVehicle(m), createState(m)]) {
      const from = a as unknown as Record<string, unknown>, to = b as unknown as Record<string, unknown>;
      for (const k of Object.keys(from)) {
        const v = from[k];
        if (v instanceof Float64Array) (to[k] as Float64Array).set(v); else to[k] = v;
      }
      expect(hashState(b)).toBe(hashState(a));
    }
    const b = createState(m), from = a as unknown as Record<string, unknown>, to = b as unknown as Record<string, unknown>;
    for (const k of Object.keys(from)) { const v = from[k]; if (v instanceof Float64Array) (to[k] as Float64Array).set(v); else to[k] = v; }
    c.throttle = 0.3;
    for (let k = 0; k < 120; k++) { step(a, c, FLAT); step(b, c, FLAT); }
    expect(b.gear).toBe(a.gear);
    expect(b.u).toBe(a.u);
    expect(hashState(b)).toBe(hashState(a));
  });
});

describe('random driving', () => {
  it('20,000 steps of seeded random controls give no NaN, no runaway and finite wheel speeds', () => {
    const s = fresh(), rand = rng(20261124), c = ctl();
    let hold = 0, fastest = 0, hardestYaw = 0;
    for (let k = 0; k < 20000; k++) {
      if (hold-- <= 0) {
        // Held for a quarter to two seconds, so the car gets somewhere: throttle mostly, some braking, a little
        // handbrake, gears chosen by the car mostly and sometimes by hand (reverse and neutral included).
        hold = 30 + Math.floor(rand() * 210);
        c.steer = rand() < 0.4 ? 0 : 2 * rand() - 1;
        c.throttle = rand() < 0.75 ? Math.sqrt(rand()) : 0;
        c.brake = rand() < 0.2 ? rand() : 0;
        c.handbrake = rand() < 0.05 ? 1 : 0;
        const g = rand();
        c.gear = g < 0.85 ? AUTO_GEAR : g < 0.88 ? -1 : g < 0.9 ? 0 : 1 + Math.floor(rand() * 6);
        c.abs = rand() < 0.85; c.tcs = rand() < 0.85; c.esc = rand() < 0.85;
      }
      step(s, c, FLAT);
      for (const [name, x] of numbers(s)) if (!Number.isFinite(x)) expect.fail(`${name} is ${x} at step ${k}`);
      const speed = Math.hypot(s.u, s.v);
      expect(speed).toBeLessThan(120);
      fastest = Math.max(fastest, speed);
      hardestYaw = Math.max(hardestYaw, Math.abs(s.r));
    }
    // It was really driven: up to speed, round corners, a good distance.
    expect(fastest).toBeGreaterThan(15);
    expect(hardestYaw).toBeGreaterThan(0.3);
    expect(s.distance).toBeGreaterThan(1000);
  });
});

describe('a collision impulse', () => {
  it('sideways at the nose yaws the car the way it is pushed, by J d / Izz', () => {
    const s = fresh(), ch = s.model.chassis;
    // 1,600 N s to the left, 2 m ahead of the centre of gravity: 1 m/s sideways and 3,200 / 2,784 = 1.15 rad/s to the left.
    applyImpulse(s, 0, 1600, 2, 0);
    expect(s.u).toBeCloseTo(0, 12);
    expect(s.v).toBeCloseTo(1, 12);
    expect(s.r).toBeCloseTo(1600 * 2 / ch.izz, 12);
    expect(s.r).toBeCloseTo(1.149, 3);
    // The same blow at the tail swings the nose the other way.
    const t = fresh();
    applyImpulse(t, 0, 1600, -2, 0);
    expect(t.r).toBeCloseTo(-1.149, 3);
  });

  it('works in world axes whichever way the car faces, and a blow through the centre of gravity only shoves it', () => {
    const s = fresh();
    placeVehicle(s, 10, 20, 0, 3);                          // facing +Y (heading normalised)
    expect(s.hx).toBe(0);
    expect(s.hy).toBe(1);
    // World +X is the car's right: pushed right at the nose, it moves right and yaws right.
    applyImpulse(s, 1600, 0, 10, 22);
    expect(s.v).toBeCloseTo(-1, 12);
    expect(s.r).toBeLessThan(-1);
    const t = fresh();
    applyImpulse(t, 800, 0, 0, 0);                          // along the heading, through the centre of gravity
    expect(t.u).toBeCloseTo(0.5, 12);
    expect(t.v).toBe(0);
    expect(t.r).toBe(0);
  });

  it('placeVehicle sets the car down there, stopped', () => {
    const s = fresh(), c = ctl({ throttle: 1, steer: 0.3 });
    for (let k = 0; k < seconds(3); k++) step(s, c, FLAT);
    placeVehicle(s, -5, 7, 1, 1);
    expect(s.x).toBe(-5);
    expect(s.y).toBe(7);
    expect(s.hx).toBeCloseTo(Math.SQRT1_2, 15);
    expect(s.u).toBe(0);
    expect(s.r).toBe(0);
    expect(s.wheelOmega.every((w) => w === 0)).toBe(true);
    expect(s.engineOmega).toBe(s.model.engine.idle);
    const quiet = ctl();
    for (let k = 0; k < seconds(5); k++) step(s, quiet, FLAT);
    expect(Math.hypot(s.x + 5, s.y - 7)).toBeLessThan(0.001);
  });
});

describe('telemetry', () => {
  it('reports rpm, gear, accelerations in g and per-wheel values that match the state', () => {
    const s = fresh(), c = ctl({ throttle: 1, steer: 0.1 });
    const out = createTelemetry();
    for (let k = 0; k < seconds(2.5); k++) step(s, c, FLAT);
    telemetry(s, out);
    expect(out.rpm).toBeCloseTo(s.engineOmega * 30 / Math.PI, 9);
    expect(out.rpm).toBeGreaterThan(1500);
    expect(out.rpm).toBeLessThan(7500);
    expect(out.gear).toBe(s.gear);
    expect(out.accelLong).toBeCloseTo(s.ax / 9.80665, 12);
    expect(out.accelLat).toBeCloseTo(s.ay / 9.80665, 12);
    expect(out.accelLong).toBeGreaterThan(0.3);             // pulling hard
    expect(out.speed).toBeCloseTo(Math.hypot(s.u, s.v), 12);
    expect(out.yawRate).toBe(s.r);
    expect(out.sideslip).toBeCloseTo(Math.atan2(s.v, s.u), 9);
    expect(out.roll).toBe(s.roll);
    expect(out.pitch).toBe(s.pitch);
    expect(out.throttleTorque).toBe(s.engineTorque);
    expect(out.shifting).toBe(s.shiftTimer > 0);
    for (let i = 0; i < 4; i++) {
      expect(out.wheelLoad[i]).toBe(s.wheelLoad[i]);
      expect(out.wheelSlipRatio[i]).toBe(s.wheelSlipRatio[i]);
      expect(out.wheelSpeed[i]).toBe(s.wheelOmega[i]);
      expect(out.wheelSlipAngle[i]).toBeCloseTo(Math.atan(s.wheelSlipTan[i]), 9);
      expect(out.wheelUse[i]).toBeGreaterThanOrEqual(0);
    }
    // The wheels carry the car's weight (less a little lift at this speed).
    const total = out.wheelLoad[0] + out.wheelLoad[1] + out.wheelLoad[2] + out.wheelLoad[3];
    expect(total / (s.model.chassis.mass * G)).toBeGreaterThan(0.98);
    expect(total / (s.model.chassis.mass * G)).toBeLessThanOrEqual(1 + 1e-12);
    // Accelerating, the rear axle carries more than at rest.
    expect(out.wheelLoad[2] + out.wheelLoad[3]).toBeGreaterThan(2 * 3632);
    expect(out.absActive).toBe(false);
    expect(out.nitrousLeft).toBe(0);
  });

  it('reads the clutch as locked when the engine turns with the wheels, and fully slipping when they are still', () => {
    const s = fresh(), out = createTelemetry();
    telemetry(s, out);
    expect(out.clutchSlip).toBe(1);                        // idling, the car not moving
    rollingAt(s, 20);
    telemetry(s, out);
    expect(Math.abs(out.clutchSlip)).toBeLessThan(1e-12);  // engine geared exactly to the rear wheels
  });
});

describe('the body takes every tyre\'s moment', () => {
  it('the yaw rate changes by the tyres\' forces times their lever arms plus their aligning moments, over Izz', () => {
    // Rolling straight at 20 m/s with the front tyres deflected sideways (as if just steered): one substep later the
    // yaw rate has moved by sum(x Fy - y Fx + Mz) / Izz x h. The aligning moments turn the car back against the
    // side force; leaving them out would be a measurable error.
    const s = fresh(), c = ctl({ gear: 0 }), m = s.model, ch = m.chassis;
    rollingAt(s, 20);
    s.gear = 0; s.gearNext = 0; s.ratio = 0;
    for (const i of [0, 1]) { s.wheelDefY[i] = 0.04 * m.tyreFront.relaxLat; s.wheelSlipTan[i] = 0.04; }
    const r0 = s.r;
    stepWith(s, c, FLAT, 1);
    const h = STEP, x = [ch.a, ch.a, -ch.b, -ch.b], y = [ch.trackFront / 2, -ch.trackFront / 2, ch.trackRear / 2, -ch.trackRear / 2];
    let moment = 0, aligning = 0;
    for (let i = 0; i < 4; i++) { moment += x[i] * s.wheelFy[i] - y[i] * s.wheelFx[i]; aligning += s.wheelMz[i]; }
    expect(aligning).toBeLessThan(0);                      // the front tyres' trail turns them back to the right
    expect(Math.abs(aligning / moment)).toBeGreaterThan(0.01);
    expect((s.r - r0) / h).toBeCloseTo((moment + aligning) / ch.izz, 9);
    expect(Math.abs((s.r - r0) / h - moment / ch.izz)).toBeGreaterThan(0.005 * Math.abs(moment / ch.izz));
  });
});

describe('a locked wheel sliding', () => {
  it('grips less the faster it slides: a locked tyre gives the friction tyreForces gives at its own sliding speed', () => {
    // Full brake from 30 m/s with ABS off: the wheels lock and slide at the car's speed, where sliding friction is
    // 0.004 x 25 = 10 points lower than at a crawl (DESIGN.md 3). The force on the car is that one, not the slow one.
    const s = fresh(), c = ctl({ brake: 1, abs: false });
    rollingAt(s, 30);
    for (let k = 0; k < seconds(0.6); k++) step(s, c, FLAT);
    const out = { fx: 0, fy: 0, mz: 0, use: 0 };
    let locked = 0;
    for (let i = 0; i < 4; i++) {
      if (s.wheelOmega[i] !== 0) continue;
      locked++;
      const p = i < 2 ? s.model.tyreFront : s.model.tyreRear;
      tyreForces(p, s.wheelLoad[i], s.wheelSlipRatio[i], s.wheelSlipTan[i], Math.abs(s.u), 1, out);
      const sliding = out.fx;
      tyreForces(p, s.wheelLoad[i], s.wheelSlipRatio[i], s.wheelSlipTan[i], 0, 1, out);
      const slow = out.fx;
      expect(Math.abs(slow / sliding - 1), `wheel ${i}`).toBeGreaterThan(0.08);
      expect(Math.abs(s.wheelFx[i] / sliding - 1), `wheel ${i}: ${s.wheelFx[i]} against ${sliding}`).toBeLessThan(0.01);
    }
    expect(locked).toBe(4);
    expect(s.u).toBeGreaterThan(20);
  });
});

describe('on ground sloping across the car', () => {
  const slope = (gx: number, gy: number): WorldQuery => ({
    surfaceAt(x: number, y: number, out: SurfaceSample): void { out.height = gx * x + gy * y; out.gradX = gx; out.gradY = gy; out.grip = 1; out.rolling = 1; },
  });

  it('held on the brakes on a 10% slope rising to its left, it leans on its downhill (right) wheels and settles a few mm downhill', () => {
    const s = fresh(), c = ctl({ brake: 1 }), ch = s.model.chassis;
    for (let k = 0; k < seconds(10); k++) step(s, c, slope(0, 0.1));
    expect(s.ay / G).toBeCloseTo(0.1, 6);                   // the tyres push it uphill: to the left
    expect(s.y).toBeLessThan(0);                            // it settled downhill, on its tyres' give
    expect(s.y).toBeGreaterThan(-0.01);
    const left = s.wheelLoad[0] + s.wheelLoad[2], right = s.wheelLoad[1] + s.wheelLoad[3];
    expect(right).toBeGreaterThan(left);
    // m g grade h over each track, shared by roll stiffness: in all, m g 0.1 h / track moves to the right side.
    const moved = (right - left) / 2, expected = ch.mass * G * 0.1 * ch.cgHeight / (0.5 * (ch.trackFront + ch.trackRear));
    expect(Math.abs(moved / expected - 1)).toBeLessThan(0.05);
    expect(Math.abs(s.u) + Math.abs(s.v)).toBeLessThan(1e-4);
  });

  it('facing 45 degrees up a 10% slope, it reads the grade along and across itself and leans on its downhill (left) side', () => {
    const s = fresh(), c = ctl({ brake: 1 }), k45 = Math.SQRT1_2;
    placeVehicle(s, 0, 0, 1, 1);
    for (let k = 0; k < seconds(10); k++) step(s, c, slope(0.1, 0));
    // It turns a hair on its tyres' give (front and rear springs differ), so the grade it reads moves with that.
    expect(Math.abs(s.hy / s.hx - 1)).toBeLessThan(1e-3);
    expect(s.ax / G).toBeCloseTo(0.1 * k45, 4);             // nose uphill: the tyres push it forward
    expect(s.ay / G).toBeCloseTo(-0.1 * k45, 4);            // downhill is to its left: they push it right
    expect(s.wheelLoad[0] + s.wheelLoad[2]).toBeGreaterThan(s.wheelLoad[1] + s.wheelLoad[3]);
    expect(s.wheelLoad[2] + s.wheelLoad[3]).toBeGreaterThan(s.model.chassis.mass * G * s.model.chassis.a / (s.model.chassis.a + s.model.chassis.b));
    expect(s.x).toBeLessThan(0);                            // it settled downhill
    expect(s.x).toBeGreaterThan(-0.01);
    // The same heading on a slope rising toward +Y: nose uphill again, and now uphill is to its left.
    const t = fresh();
    placeVehicle(t, 0, 0, 1, 1);
    for (let k = 0; k < seconds(10); k++) step(t, c, slope(0, 0.1));
    expect(t.ax / G).toBeCloseTo(0.1 * k45, 4);
    expect(t.ay / G).toBeCloseTo(0.1 * k45, 4);
    expect(t.wheelLoad[1] + t.wheelLoad[3]).toBeGreaterThan(t.wheelLoad[0] + t.wheelLoad[2]);
    expect(t.y).toBeLessThan(0);
  });
});

describe('on a hill', () => {
  // A 10% grade rising along +X.
  const hill: WorldQuery = {
    surfaceAt(x: number, _y: number, out: SurfaceSample): void { out.height = 0.1 * x; out.gradX = 0.1; out.gradY = 0; out.grip = 1; out.rolling = 1; },
  };

  it('rolls back down with nothing pressed at g x grade, less the wheels\' inertia and rolling resistance', () => {
    const s = fresh(), m = s.model, c = ctl();
    for (let k = 0; k < seconds(3); k++) step(s, c, hill);
    const ch = m.chassis;
    const rotating = 2 * m.wheelInertiaFront / m.tyreFront.radius ** 2 + 2 * m.wheelInertiaRear / m.tyreRear.radius ** 2;
    const free = G * 0.1 * ch.mass / (ch.mass + rotating);                    // 0.95 m/s^2
    const resisted = free - m.tyreRear.rollRes * G * ch.mass / (ch.mass + rotating);
    const decel = -s.u / s.time;
    expect(s.x).toBeLessThan(-3);
    expect(decel).toBeLessThan(free);
    expect(decel).toBeGreaterThan(resisted - 0.01);
  });

  it('holds on the brakes, with its load moved onto the downhill axle by m g grade h / L', () => {
    const s = fresh(), ch = s.model.chassis, c = ctl({ brake: 1 });
    for (let k = 0; k < seconds(10); k++) step(s, c, hill);
    expect(Math.abs(s.x)).toBeLessThan(0.002);              // the tyres' deflection under the pull, no more
    expect(Math.abs(s.u)).toBeLessThan(0.0001);
    const L = ch.a + ch.b;
    const transfer = ch.mass * G * 0.1 * ch.cgHeight / L;    // 302 N off the front axle onto the rear
    expect(s.wheelLoad[2] + s.wheelLoad[3] - ch.mass * G * ch.a / L).toBeCloseTo(transfer, 0);
    expect(s.ax / G).toBeCloseTo(0.1, 6);                    // the accelerometer reads the grade
  });
});

describe('on soft ground', () => {
  // Sand or gravel: three times the rolling resistance of asphalt (SurfaceSample.rolling), the same grip.
  const sand: WorldQuery = {
    surfaceAt(_x: number, _y: number, out: SurfaceSample): void { out.height = 0; out.gradX = 0; out.gradY = 0; out.grip = 1; out.rolling = 3; },
  };

  it('a car coasting in neutral slows by the extra rolling resistance the ground puts on its tyres', () => {
    const coast = (world: WorldQuery): number => {
      const s = fresh(), c = ctl({ gear: 0 });
      s.gear = 0; s.gearNext = 0; s.ratio = 0;
      s.u = 10;
      for (let i = 0; i < 4; i++) s.wheelOmega[i] = 10 / (i < 2 ? s.model.tyreFront.radius : s.model.tyreRear.radius);
      for (let k = 0; k < seconds(2); k++) step(s, c, world);
      return s.u;
    };
    const m = fresh().model, ch = m.chassis;
    const rotating = 2 * m.wheelInertiaFront / m.tyreFront.radius ** 2 + 2 * m.wheelInertiaRear / m.tyreRear.radius ** 2;
    // Two more times the tyres' rolling resistance, 0.0095 m g, for 2 s, shared by the car and its wheels' spin.
    const extra = 2 * m.tyreRear.rollRes * G * ch.mass / (ch.mass + rotating) * 2;   // about 0.36 m/s
    const lost = coast(FLAT) - coast(sand);
    expect(lost).toBeGreaterThan(0.97 * extra);
    expect(lost).toBeLessThan(1.03 * extra);
  });
});

describe('allocation', () => {
  type Heap = { memoryUsage(): { heapUsed: number } };
  async function collector(): Promise<(() => void) | null> {
    // gc() without --expose-gc: switch the flag on and fetch it from a fresh context.
    try {
      const v8Name = 'node:v8', vmName = 'node:vm';
      const v8 = await import(/* @vite-ignore */ v8Name);
      const vm = await import(/* @vite-ignore */ vmName);
      v8.setFlagsFromString('--expose-gc');
      return vm.runInNewContext('gc') as () => void;
    } catch {
      return null;
    }
  }

  it('200,000 steps keep nothing: the heap does not grow and the state keeps its own arrays', async () => {
    // Measured as retained heap after a full collection (DESIGN.md rule 4 is about the source: no literals, closures or
    // spreads on the step's path; the engine's own number boxing is not the source's). Identity: every typed array in
    // the state and in a telemetry record is the same object before and after.
    const gc = await collector();
    expect(gc).not.toBeNull();
    const collect = gc as () => void;
    const proc = (globalThis as unknown as { process: Heap }).process;
    const s = fresh(), out = createTelemetry(), c = ctl();
    const arrays = ARRAYS.map((k) => s[k]);
    const outArrays = [out.wheelLoad, out.wheelSlipRatio, out.wheelSlipAngle, out.wheelSpeed, out.wheelUse];
    for (let k = 0; k < 2000; k++) { c.throttle = k % 400 < 300 ? 1 : 0; c.steer = k % 300 < 150 ? 0.3 : -0.3; step(s, c, FLAT); }
    collect(); collect();
    const before = proc.memoryUsage().heapUsed;
    for (let k = 0; k < 200000; k++) {
      c.throttle = k % 2400 < 1500 ? 1 : 0;
      c.brake = k % 2400 >= 1900 ? 0.6 : 0;
      c.steer = k % 900 < 450 ? 0.25 : -0.25;
      step(s, c, FLAT);
      telemetry(s, out);
    }
    collect(); collect();
    const grown = proc.memoryUsage().heapUsed - before;
    expect(s.distance).toBeGreaterThan(5000);
    expect(grown).toBeLessThan(2 * 1024 * 1024);
    ARRAYS.forEach((k, i) => { expect(s[k]).toBe(arrays[i]); expect(s[k].length).toBe(4); });
    const outNow = [out.wheelLoad, out.wheelSlipRatio, out.wheelSlipAngle, out.wheelSpeed, out.wheelUse];
    outNow.forEach((a, i) => expect(a).toBe(outArrays[i]));
  }, 120000);
});
