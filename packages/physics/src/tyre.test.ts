import { describe, expect, it } from 'vitest';
import type { TyreParams } from './types';
import type { TyreOut } from './tyre';
import {
  cornerStiffness, lowSpeedDamping, lowSpeedFade, maxDeflectionX, maxDeflectionY, peakSlipRatio, peakSlipTan, relaxStep,
  rollingResistance, tyreForces, tyreMuX, tyreMuY,
} from './tyre';
import { fixtureTyre } from './fixtures';
import { parseTyreSize } from './units';

const DEG = Math.PI / 180;
const H = 1 / 480;
const out: TyreOut = { fx: 0, fy: 0, mz: 0, use: 0 };
// A summer tyre (245 section, the table's summer figures) on its 4,000 N reference load.
const summer = fixtureTyre();

function lateral(p: TyreParams, fz: number, slipAngleDeg: number, grip = 1, slide = 0): number {
  tyreForces(p, fz, 0, Math.tan(slipAngleDeg * DEG), slide, grip, out);
  return out.fy;
}
function longitudinal(p: TyreParams, fz: number, slipRatio: number, grip = 1, slide = 0): number {
  tyreForces(p, fz, slipRatio, 0, slide, grip, out);
  return out.fx;
}
/** The slip angle (deg) where a sweep finds the most lateral force, and that force. */
function lateralPeak(p: TyreParams, fz: number, grip = 1): { at: number; force: number } {
  let at = 0, force = 0;
  for (let i = 1; i <= 6000; i++) { const a = i * 0.005, f = lateral(p, fz, a, grip); if (f > force) { force = f; at = a; } }
  return { at, force };
}
/** The slip ratio where a sweep finds the most driving force, and that force. */
function longitudinalPeak(p: TyreParams, fz: number, grip = 1): { at: number; force: number } {
  let at = 0, force = 0;
  for (let i = 1; i <= 10000; i++) { const k = i * 0.0001, f = longitudinal(p, fz, k, grip); if (f > force) { force = f; at = k; } }
  return { at, force };
}

// DESIGN.md section 7's starting values for each tyre category, on a size typical of it. fz0 by the resolver's rule.
const CATEGORIES: [string, string, number, number, number, number, number, number, number, number, number, number][] = [
  //  name               size            muY0  muX/  load  slide fall  Ca/Fz Ck/Fz relaxY relaxX rollRes
  ['all-season',      '225/60R17',     0.92, 1.08, 0.12, 0.80, 1.2, 13, 16, 0.55, 0.20, 0.0085],
  ['summer',          '245/40ZR18',    1.02, 1.10, 0.13, 0.82, 1.2, 16, 19, 0.50, 0.18, 0.0095],
  ['max-performance', '275/35ZR19',    1.12, 1.12, 0.14, 0.83, 1.3, 19, 22, 0.45, 0.16, 0.0105],
  ['track',           '305/30ZR19',    1.28, 1.12, 0.15, 0.85, 1.5, 22, 25, 0.40, 0.15, 0.012],
  ['all-terrain',     'LT265/70R17',   0.80, 1.05, 0.10, 0.80, 1.0, 10, 13, 0.65, 0.25, 0.011],
  ['winter',          '215/60R16',     0.78, 1.05, 0.10, 0.80, 1.0, 10, 13, 0.65, 0.25, 0.011],
  ['drag',            '275/60R15',     1.00, 1.55, 0.10, 0.85, 1.0, 12, 20, 0.60, 0.22, 0.014],
];
function categoryTyre(row: (typeof CATEGORIES)[number]): TyreParams {
  const [, size, muY0, muXRatio, loadSens, slideRatio, slideFall, caPerFz, cKappaPerFz, relaxLat, relaxLong, rollRes] = row;
  const s = parseTyreSize(size);
  if (!s) throw new Error(`unreadable size ${size}`);
  const fz0 = Math.min(7500, Math.max(3000, 4000 * (s.width / 0.225) * (2 * s.radius / 0.66)));
  return {
    radius: 0.97 * s.radius, width: s.width, fz0, muY0, muXRatio, loadSens, slideRatio, slideFall,
    cAlpha0: caPerFz * fz0, fzStiffPeak: 2.2 * fz0, cKappaPerFz, relaxLat, relaxLong, rollRes, trail0: 0.03,
  };
}

describe('friction and stiffness follow the load', () => {
  it('friction falls as load rises (load sensitivity 0.13) and stays within its band', () => {
    expect(tyreMuY(summer, 4000, 1)).toBeCloseTo(1.02, 12);          // the quoted figure at the reference load
    expect(tyreMuY(summer, 8000, 1)).toBeCloseTo(0.8874, 12);        // 13% less at twice the load
    expect(tyreMuY(summer, 2000, 1)).toBeCloseTo(1.0863, 12);        // 6.5% more at half
    expect(tyreMuX(summer, 4000, 1)).toBeCloseTo(1.122, 12);         // braking and driving grip 10% above cornering grip
    expect(tyreMuY(summer, 60000, 1)).toBeCloseTo(0.55 * 1.02, 12);  // a silly load cannot take friction below 55%
    expect(tyreMuY(summer, 4000, 0.5)).toBeCloseTo(0.51, 12);        // a road with half the grip
  });
  it('cornering stiffness is 64 kN/rad (1,117 N/deg) at 4 kN, peaks at 8.8 kN and grows more slowly than load', () => {
    expect(cornerStiffness(summer, 4000)).toBeCloseTo(64000, 6);
    expect(cornerStiffness(summer, 4000) * DEG).toBeCloseTo(1117, 0);
    expect(Math.abs(cornerStiffness(summer, 6000) - 79075)).toBeLessThan(1);
    let best = 0, at = 0;
    for (let fz = 100; fz <= 20000; fz += 100) { const c = cornerStiffness(summer, fz); if (c > best) { best = c; at = fz; } }
    expect(at).toBe(8800);
    expect(cornerStiffness(summer, 8000) / cornerStiffness(summer, 4000)).toBeLessThan(1.5);
    expect(cornerStiffness(summer, 0)).toBe(0);
  });
});

describe('the force curve', () => {
  it('starts with the cornering stiffness and the slip stiffness as its slopes', () => {
    for (const [fz, ca, ck] of [[4000, 64000, 76000], [6000, 79075, 114000], [2500, 44660, 47500]]) {
      const a = 1e-5, k = 1e-5;
      expect(Math.abs(lateral(summer, fz, a / DEG) / a / ca - 1)).toBeLessThan(2e-4);
      expect(Math.abs(longitudinal(summer, fz, k) / k / ck - 1)).toBeLessThan(2e-4);
      // The road's grip sets where the tyre saturates, not how stiff it is.
      expect(Math.abs(lateral(summer, fz, a / DEG, 0.5) / a / ca - 1)).toBeLessThan(2e-4);
    }
  });

  it('rises as g(p) = 2p - p^2 to its peak (DESIGN.md 3, K = 2): first slope the stiffness, the peak at 2 mu / C', () => {
    // Pure slip at a share p of the peak slip gives mu Fz g(p), along each direction.
    const fz = 4000, muX = tyreMuX(summer, fz, 1), muY = tyreMuY(summer, fz, 1);
    expect(muX).toBeCloseTo(1.02 * 1.1, 12);
    // The peak formulas: 2 muX / cKappaPerFz and 2 muY Fz / Ca.
    expect(peakSlipRatio(summer, fz, 1)).toBeCloseTo(2 * 1.122 / 19, 12);              // 0.118
    expect(peakSlipTan(summer, fz, 1)).toBeCloseTo(2 * muY * fz / cornerStiffness(summer, fz), 12);
    expect(peakSlipTan(summer, fz, 1)).toBeCloseTo(2 * 1.02 * 4000 / 64000, 12);         // 0.1275, 7.27 degrees
    const g = [[0.25, 0.4375], [0.5, 0.75], [0.75, 0.9375], [1, 1]];
    for (const [p, want] of g) {
      tyreForces(summer, fz, p * peakSlipRatio(summer, fz, 1), 0, 0, 1, out);
      expect(out.fx / (muX * fz), `fx at p = ${p}`).toBeCloseTo(want, 12);
      expect(out.use).toBeCloseTo(p, 12);
      tyreForces(summer, fz, 0, p * peakSlipTan(summer, fz, 1), 0, 1, out);
      expect(out.fy / (muY * fz), `fy at p = ${p}`).toBeCloseTo(want, 12);
      // The aligning moment fades as trail0 (1 - p)^2: a quarter of trail0 at p = 0.5.
      expect(out.mz, `mz at p = ${p}`).toBeCloseTo(-summer.trail0 * (1 - p) * (1 - p) * out.fy, 12);
    }
    // The first slope is the stiffness itself: 19 x 4,000 N per unit slip, 64,000 N per radian.
    tyreForces(summer, fz, 1e-7, 0, 0, 1, out);
    expect(out.fx / 1e-7 / (19 * fz)).toBeCloseTo(1, 5);
    tyreForces(summer, fz, 0, 1e-7, 0, 1, out);
    expect(out.fy / 1e-7 / 64000).toBeCloseTo(1, 5);
  });

  it('peaks between 5 and 12 degrees and between 0.08 and 0.20 slip ratio for every tyre category', () => {
    for (const row of CATEGORIES) {
      const p = categoryTyre(row);
      for (const share of [0.6, 1, 1.4]) {
        const fz = share * p.fz0;
        const lat = lateralPeak(p, fz), lon = longitudinalPeak(p, fz);
        const label = `${row[0]} at ${Math.round(fz)} N`;
        expect(lat.at, label).toBeGreaterThanOrEqual(5);
        expect(lat.at, label).toBeLessThanOrEqual(12);
        expect(lon.at, label).toBeGreaterThanOrEqual(0.08);
        expect(lon.at, label).toBeLessThanOrEqual(0.2);
        // The sweep finds the peak where the model says it is (the ABS and the assists aim there) ...
        expect(Math.abs(Math.atan(peakSlipTan(p, fz, 1)) / DEG - lat.at), label).toBeLessThan(0.01);
        expect(Math.abs(peakSlipRatio(p, fz, 1) - lon.at), label).toBeLessThan(1.5e-4);
        // ... and the peak force is the friction coefficient times the load.
        expect(lat.force / (tyreMuY(p, fz, 1) * fz), label).toBeCloseTo(1, 5);
        expect(lon.force / (tyreMuX(p, fz, 1) * fz), label).toBeCloseTo(1, 5);
      }
    }
    // The summer tyre on its reference load: 4,080 N of cornering force at 7.3 degrees, 4,488 N of drive at 0.118.
    const lat = lateralPeak(summer, 4000), lon = longitudinalPeak(summer, 4000);
    expect(lat.at).toBeCloseTo(7.27, 1);
    expect(lat.force).toBeCloseTo(4080, 2);
    expect(lon.at).toBeCloseTo(0.118, 3);
    expect(lon.force).toBeCloseTo(4488, 2);
  });

  it('on a road with half the grip the tyre saturates at half the force and half the slip', () => {
    const dry = lateralPeak(summer, 4000, 1), wet = lateralPeak(summer, 4000, 0.5);
    expect(wet.force / dry.force).toBeCloseTo(0.5, 5);
    expect(Math.tan(wet.at * DEG) / Math.tan(dry.at * DEG)).toBeCloseTo(0.5, 2);
  });

  it('falls after the peak and settles at the sliding share far past it, less the faster it slides', () => {
    const peak = 1.02 * 4000, peakX = 1.122 * 4000;
    // Past the peak the force only falls.
    const top = lateralPeak(summer, 4000).at;
    let last = lateral(summer, 4000, top), falls = 0;
    for (let a = top + 0.25; a <= 60; a += 0.5) { const f = lateral(summer, 4000, a); expect(f).toBeLessThan(last); last = f; falls++; }
    expect(falls).toBeGreaterThan(90);
    // A wheel locked under braking (slip -1) brakes at 82% of the peak; a tyre sliding sideways at 60 degrees, the same.
    expect(-longitudinal(summer, 4000, -1) / peakX).toBeLessThan(0.83);
    expect(lateral(summer, 4000, 60) / peak).toBeCloseTo(0.82, 2);
    expect(-longitudinal(summer, 4000, -1) / peakX).toBeGreaterThan(0.82);
    // Sliding at 10 m/s costs another 4 points, at 40 m/s 16; the floor, 60% of the sliding share, comes past 82 m/s.
    expect(lateral(summer, 4000, 60, 1, 10) / peak).toBeCloseTo(0.78, 2);
    expect(lateral(summer, 4000, 60, 1, 40) / peak).toBeCloseTo(0.66, 2);
    expect(lateral(summer, 4000, 60, 1, 100) / peak).toBeCloseTo(0.6 * 0.82, 2);
    expect(lateral(summer, 4000, 60, 1, 200)).toBe(lateral(summer, 4000, 60, 1, 100));
    // Sliding speed does nothing while part of the patch still grips.
    expect(lateral(summer, 4000, 3, 1, 10)).toBe(lateral(summer, 4000, 3, 1, 0));
  });

  it('keeps every mix of slips inside the friction ellipse', () => {
    let worst = 0, n = 0;
    for (const fz of [800, 4000, 9000]) for (const grip of [1, 0.45]) for (const slide of [0, 6]) {
      for (let k = -1; k <= 1.0001; k += 0.02) for (let a = -40; a <= 40; a += 1) {
        tyreForces(summer, fz, k, Math.tan(a * DEG), slide, grip, out);
        const e = (out.fx / (tyreMuX(summer, fz, grip) * fz)) * (out.fx / (tyreMuX(summer, fz, grip) * fz))
          + (out.fy / (tyreMuY(summer, fz, grip) * fz)) * (out.fy / (tyreMuY(summer, fz, grip) * fz));
        if (e > worst) worst = e;
        n++;
      }
    }
    expect(n).toBeGreaterThan(50000);
    expect(worst).toBeLessThanOrEqual(1 + 1e-12);
    expect(worst).toBeGreaterThan(0.999);   // and it does reach the edge
  });

  it('shares one grip budget: braking in a corner costs cornering force', () => {
    tyreForces(summer, 4000, 0, Math.tan(4 * DEG), 0, 1, out);
    const cornering = out.fy;
    tyreForces(summer, 4000, -0.08, Math.tan(4 * DEG), 0, 1, out);
    expect(out.fy).toBeLessThan(0.85 * cornering);
    expect(out.fx).toBeLessThan(-2000);
  });

  it('is continuous in force and slope where sticking turns to sliding (p = 1)', () => {
    const fz = 4000, e = 1e-5;
    // Pure cornering, pure braking, and a mix (the slip vector at 35 degrees between them).
    const dirs: [number, number][] = [[0, 1], [-1, 0], [-Math.cos(35 * DEG), Math.sin(35 * DEG)]];
    for (const [cx, cy] of dirs) {
      // Scale the slip vector to the length where the whole patch starts to slide.
      const kx = cx * peakSlipRatio(summer, fz, 1), ty = cy * peakSlipTan(summer, fz, 1);
      const at = (s: number): number => {
        tyreForces(summer, fz, kx * s, ty * s, 3, 1, out);
        return Math.sqrt(out.fx * out.fx + out.fy * out.fy);
      };
      tyreForces(summer, fz, kx, ty, 3, 1, out);
      expect(out.use).toBeCloseTo(1, 12);
      const below = at(1 - e), above = at(1 + e);
      expect(Math.abs(above - below)).toBeLessThan(1e-6 * 4000);
      // The slope on each side, per unit of the scale: next to nothing beside the slope at the start.
      const start = (at(1e-6) - at(0)) / 1e-6;
      const slopeBelow = (at(1 - e) - at(1 - 2 * e)) / e, slopeAbove = (at(1 + 2 * e) - at(1 + e)) / e;
      expect(Math.abs(slopeBelow)).toBeLessThan(1e-3 * start);
      expect(Math.abs(slopeAbove)).toBeLessThan(1e-3 * start);
      // Not trivially flat: a fifth of the way back the force is still clearly climbing.
      expect((at(0.8) - at(0.8 - e)) / e).toBeGreaterThan(0.03 * start);
    }
  });

  it('gives clearly less than double the grip for double the load', () => {
    const one = lateralPeak(summer, 4000), two = lateralPeak(summer, 8000);
    expect(two.force / one.force).toBeLessThan(1.85);
    expect(two.force / one.force).toBeGreaterThan(1.6);
    expect(two.force).toBeCloseTo(7099, 0);                          // 0.887 x 8,000 N, against 4,080 N
    const oneX = longitudinalPeak(summer, 4000), twoX = longitudinalPeak(summer, 8000);
    expect(twoX.force / oneX.force).toBeLessThan(1.85);
  });

  it('is odd: slip one way gives exactly the opposite force and moment of slip the other way', () => {
    let checked = 0;
    const a: TyreOut = { fx: 0, fy: 0, mz: 0, use: 0 }, b: TyreOut = { fx: 0, fy: 0, mz: 0, use: 0 };
    for (let k = 0.003; k <= 1.2; k *= 1.31) {
      tyreForces(summer, 4300, k, 0, 2, 1, a); tyreForces(summer, 4300, -k, 0, 2, 1, b);
      expect(b.fx).toBe(-a.fx); expect(b.use).toBe(a.use); expect(a.fx).toBeGreaterThan(0);
      checked++;
    }
    for (let deg = 0.05; deg <= 50; deg *= 1.27) {
      const t = Math.tan(deg * DEG);
      tyreForces(summer, 4300, 0, t, 2, 1, a); tyreForces(summer, 4300, 0, -t, 2, 1, b);
      expect(b.fy).toBe(-a.fy); expect(b.mz).toBe(-a.mz); expect(a.fy).toBeGreaterThan(0);
      // Mixed with braking, mirroring the slip angle mirrors the cornering force and keeps the braking force.
      tyreForces(summer, 4300, -0.05, t, 2, 1, a); tyreForces(summer, 4300, -0.05, -t, 2, 1, b);
      expect(b.fy).toBe(-a.fy); expect(b.fx).toBe(a.fx);
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('gives no force and no NaN with no load or no grip', () => {
    for (const fz of [0, -250, -0]) for (const k of [0, 0.1, -1, 40]) for (const t of [0, 0.2, -3]) {
      out.fx = 1; out.fy = 1; out.mz = 1; out.use = 1;
      tyreForces(summer, fz, k, t, 5, 1, out);
      expect([out.fx, out.fy, out.mz, out.use]).toEqual([0, 0, 0, 0]);
    }
    tyreForces(summer, 4000, -0.3, 0.2, 5, 0, out);
    expect([out.fx, out.fy, out.mz, out.use]).toEqual([0, 0, 0, 0]);
    // A wheel just touching the road: tiny, finite forces.
    tyreForces(summer, 1e-9, 0.5, 0.5, 5, 1, out);
    for (const v of [out.fx, out.fy, out.mz, out.use]) expect(Number.isFinite(v)).toBe(true);
    expect(Math.abs(out.fx)).toBeLessThan(1e-8);
    // What the systems and the clamp read stays finite on a wheel in the air.
    for (const v of [peakSlipRatio(summer, 0, 1), peakSlipTan(summer, 0, 1), maxDeflectionX(summer, 0, 1), maxDeflectionY(summer, 0, 1)]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
    expect(lowSpeedDamping(summer, 0, 400)).toBe(0);
    expect(rollingResistance(summer, 0, 1)).toBe(0);
  });
});

describe('the aligning moment', () => {
  it('acts through a 30 mm pneumatic trail at small slip, peaks near 2 degrees, and is gone at the force peak', () => {
    tyreForces(summer, 4000, 0, Math.tan(0.0001 * DEG), 0, 1, out);
    expect(out.mz / out.fy).toBeCloseTo(-0.03, 5);   // turns the wheel back toward straight
    let best = 0, at = 0;
    for (let a = 0.01; a <= 7.27; a += 0.01) { tyreForces(summer, 4000, 0, Math.tan(a * DEG), 0, 1, out); if (-out.mz > best) { best = -out.mz; at = a; } }
    expect(at).toBeGreaterThan(1.5);
    expect(at).toBeLessThan(3);
    expect(best).toBeCloseTo(0.25 * 0.03 * 4080, 0);   // 30.6 N m: a quarter of trail x peak force
    // At and past the peak there is nothing left to feel.
    tyreForces(summer, 4000, 0, peakSlipTan(summer, 4000, 1), 0, 1, out);
    expect(Math.abs(out.mz)).toBeLessThan(1e-9);
    tyreForces(summer, 4000, 0, Math.tan(15 * DEG), 0, 1, out);
    expect(Math.abs(out.mz)).toBe(0);
  });
});

describe('the slip states', () => {
  it('build to 63% of the steady slip after rolling one relaxation length, and settle at the usual slip', () => {
    // Rolling at 20 m/s with the patch drifting left at 0.6 m/s: a steady slip angle of 1.7 degrees.
    const relax = summer.relaxLat, v = 20, vs = 0.6, steady = -vs * relax / v, big = 1;
    let def = 0;
    const steps = Math.round(relax / (v * H));   // 12 substeps to roll 0.5 m
    for (let i = 0; i < steps; i++) def = relaxStep(def, vs, v, relax, big, H);
    expect(def / steady).toBeGreaterThan(0.6);   // the substep lags the exact 63.2% by a little
    expect(def / steady).toBeLessThan(0.64);
    // A finer step converges on 1 - 1/e, and the share depends on distance rolled, not on time.
    for (const speed of [5, 30]) {
      const fine = H / 100, n = Math.round(relax / (speed * fine));
      let d = 0;
      for (let i = 0; i < n; i++) d = relaxStep(d, vs, speed, relax, big, fine);
      expect(d / (-vs * relax / speed)).toBeCloseTo(1 - 1 / Math.E, 2);
    }
    for (let i = 0; i < 480; i++) def = relaxStep(def, vs, v, relax, big, H);
    expect(def / relax).toBeCloseTo(-vs / v, 12);   // slip tan = -Vsy / |Vx|: -0.03
    // The longitudinal state the same way: driving at 10% slip (the wheel 2 m/s faster than the road at 20 m/s).
    let dx = 0;
    for (let i = 0; i < 480; i++) dx = relaxStep(dx, -2, 20, summer.relaxLong, big, H);
    expect(dx / summer.relaxLong).toBeCloseTo(0.1, 12);
  });

  it('hold the car like a spring at a standstill: restoring force that grows with displacement', () => {
    const fz = 4000;
    // Push the contact patch forward by 1 mm (slip speed 0.48 m/s for one substep) with the wheel held.
    const pushed = (mm: number): number => {
      const def = relaxStep(0, mm / 1000 / H, 0, summer.relaxLong, maxDeflectionX(summer, fz, 1), H);
      tyreForces(summer, fz, def / summer.relaxLong, 0, 0, 1, out);
      return out.fx;
    };
    const k = 19 * 4000 / 0.18;   // 422 kN/m: slip stiffness over relaxation length
    expect(pushed(1)).toBeLessThan(0);                         // pulls back
    expect(-pushed(1) / 0.001 / k).toBeCloseTo(1, 1);          // 422 N for the millimetre
    expect(pushed(2) / pushed(1)).toBeGreaterThan(1.9);        // twice the push, about twice the pull
    expect(pushed(-1)).toBe(-pushed(1));
    // Sideways: 128 kN/m (cornering stiffness over relaxation length).
    const defY = relaxStep(0, 0.002 / H, 0, summer.relaxLat, maxDeflectionY(summer, fz, 1), H);
    tyreForces(summer, fz, 0, defY / summer.relaxLat, 0, 1, out);
    expect(out.fy).toBeLessThan(0);
    expect(-out.fy / 0.002 / (64000 / 0.5)).toBeCloseTo(1, 1);
    // Standing still with nothing moving, the deflection (and the force holding the car) does not change at all.
    let held = -0.0009;
    for (let i = 0; i < 4800; i++) held = relaxStep(held, 0, 0, summer.relaxLong, 1, H);
    expect(held).toBe(-0.0009);
  });

  it('clamp a sideways slide so its deflection does not wind up either, and the slide keeps only its sliding share', () => {
    for (const fz of [1500, 4000, 7000]) {
      const max = maxDeflectionY(summer, fz, 1);
      expect(max).toBeCloseTo(summer.relaxLat * 3 * peakSlipTan(summer, fz, 1), 12);   // three peak slips' worth
      // A 30 degree slide at 20 m/s: 17.3 m/s rolling, 10 m/s across.
      let def = 0;
      for (let i = 0; i < 480; i++) { def = relaxStep(def, 10, 17.32, summer.relaxLat, max, H); expect(Math.abs(def)).toBeLessThanOrEqual(max); }
      expect(def).toBe(-max);
      tyreForces(summer, fz, 0, def / summer.relaxLat, 10, 1, out);
      const share = -out.fy / (tyreMuY(summer, fz, 1) * fz);
      expect(share, `${fz} N`).toBeGreaterThan(0.6);
      expect(share, `${fz} N`).toBeLessThan(0.85);   // the sliding share, not the peak
      // It lets go within a few relaxation lengths.
      let rolled = 0;
      while (Math.abs(def) > 0.01 * max) { def = relaxStep(def, 0, 10, summer.relaxLat, max, H); rolled += 10 * H; }
      expect(rolled, `${fz} N`).toBeLessThan(6 * summer.relaxLat);
    }
  });

  it('clamp a spinning wheel so its deflection does not wind up', () => {
    const fz = 4000, max = maxDeflectionX(summer, fz, 1);
    expect(max).toBeCloseTo(0.18 * 3 * peakSlipRatio(summer, fz, 1), 12);   // 64 mm: three peak slips' worth
    // Wheelspin from rest: the tread passes the road at 25 m/s while the car has not moved.
    let def = 0;
    for (let i = 0; i < 480; i++) { def = relaxStep(def, -25, 0, summer.relaxLong, max, H); expect(def).toBeLessThanOrEqual(max); }
    expect(def).toBe(max);
    tyreForces(summer, fz, def / summer.relaxLong, 0, 25, 1, out);
    expect(out.fx / (1.122 * fz)).toBeGreaterThan(0.6);   // a spinning tyre still pushes, at its sliding share
    expect(out.fx / (1.122 * fz)).toBeLessThan(0.85);
    // Once the car rolls with the wheel no longer spinning, it lets go within a few relaxation lengths, not hundreds.
    let rolled = 0;
    while (def > 0.01 * max) { def = relaxStep(def, 0, 10, summer.relaxLong, max, H); rolled += 10 * H; }
    expect(rolled).toBeLessThan(6 * summer.relaxLong);
  });
});

describe('low-speed damping', () => {
  it('critically damps a corner of the car on its tyre (5 Hz, 26 kN s/m for a 400 kg corner)', () => {
    const m = 400, fz = m * 9.80665;
    const c = lowSpeedDamping(summer, fz, m);
    const k = 19 * fz / 0.18;                                     // the stiffer, longitudinal spring
    expect(Math.sqrt(k / m) / (2 * Math.PI)).toBeCloseTo(5.1, 1);
    expect(c).toBeCloseTo(2 * Math.sqrt(k * m), 6);
    expect(c / 1000).toBeCloseTo(25.74, 1);
    // A braked corner nudged 2 mm forward, released, in both directions: with the damping it comes back without
    // ringing; without it, it swings right through.
    const run = (damping: number, along: 'x' | 'y'): { overshoot: number; after: number } => {
      const relax = along === 'x' ? summer.relaxLong : summer.relaxLat;
      const max = along === 'x' ? maxDeflectionX(summer, fz, 1) : maxDeflectionY(summer, fz, 1);
      let x = 0.002, v = 0, def = -0.002, overshoot = 0;
      for (let i = 0; i < 720; i++) {
        if (along === 'x') tyreForces(summer, fz, def / relax, 0, Math.abs(v), 1, out);
        else tyreForces(summer, fz, 0, def / relax, Math.abs(v), 1, out);
        const f = (along === 'x' ? out.fx : out.fy) - damping * lowSpeedFade(v) * v;
        v += f / m * H;
        x += v * H;
        def = relaxStep(def, v, along === 'x' ? v : 0, relax, max, H);
        if (-x > overshoot) overshoot = -x;
      }
      return { overshoot, after: Math.abs(x) };
    };
    for (const along of ['x', 'y'] as const) {
      const damped = run(c, along), free = run(0, along);
      expect(damped.overshoot).toBeLessThan(0.02 * 0.002);
      expect(damped.after).toBeLessThan(0.01 * 0.002);           // settled within a second and a half
      expect(free.overshoot).toBeGreaterThan(0.5 * 0.002);
    }
  });

  it('fades out by 1.5 m/s', () => {
    expect(lowSpeedFade(0)).toBe(1);
    expect(lowSpeedFade(0.75)).toBe(0.5);
    expect(lowSpeedFade(-0.75)).toBe(0.5);
    expect(lowSpeedFade(1.5)).toBe(0);
    expect(lowSpeedFade(30)).toBe(0);
  });
});

describe('rolling resistance', () => {
  it('is about 1% of the load, scaled by the ground, and none without load or on a nonsense surface', () => {
    expect(rollingResistance(summer, 4000, 1)).toBeCloseTo(0.0095 * 4000, 12);   // 38 N
    expect(rollingResistance(summer, 4000, 2.5) / rollingResistance(summer, 4000, 1)).toBeCloseTo(2.5, 12);
    expect(rollingResistance(summer, -10, 1)).toBe(0);
    expect(rollingResistance(summer, 4000, -1)).toBe(0);
  });
});

describe('the step path', () => {
  it('tyreForces allocates nothing: a million calls write only the four fields of out', () => {
    const params = Object.freeze({ ...summer });                // any write to the tyre would throw
    const target: TyreOut = Object.seal({ fx: 0, fy: 0, mz: 0, use: 0 });   // as would a new field
    const writes = { fx: 0, fy: 0, mz: 0, use: 0, other: 0 };
    const watched = new Proxy(target, {
      set(t, key, value) {
        if (key === 'fx' || key === 'fy' || key === 'mz' || key === 'use') writes[key]++; else writes.other++;
        return Reflect.set(t, key, value);
      },
    });
    const probe = (): number[] => { tyreForces(params, 4100, -0.07, 0.05, 1.3, 0.93, target); return [target.fx, target.fy, target.mz, target.use]; };
    const before = probe();
    const n = 1000000;
    for (let i = 0; i < n; i++) {
      const s = (i % 2001) / 1000 - 1;
      tyreForces(params, 500 + (i % 97) * 90, s, s * 0.7 - 0.2, i % 13, 0.4 + (i % 7) * 0.1, watched);
    }
    expect(writes).toEqual({ fx: n, fy: n, mz: n, use: n, other: 0 });
    expect(Object.keys(target)).toEqual(['fx', 'fy', 'mz', 'use']);
    // No hidden state: the same inputs give the same bits after a million other calls.
    expect(probe()).toEqual(before);
  });
});
