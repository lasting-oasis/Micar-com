// Calibration and the check against tests (DESIGN.md section 8 and the plan of record's section 7).
// Only two things may ever be fitted to a test: the tyres' grip scale, to the car's skidpad figure, inside its tyre
// category's range; and the drag area, to an ungoverned top speed, only when no drag figure and no coast-down is on
// file. Everything else the bench says is a prediction, and checkSheet compares those predictions with the tests on
// the sheet at the plan's tolerances.
import type { BenchResult, PhysicsSheet, Sourced } from './types';
import { skidpadAt, topSpeedOf } from './bench';
import { tyreGripScaleRange } from './classes';
import { resolveLayout, resolveModel, resolveTyres } from './resolve';
import { MPH } from './units';

/** A comparison of one bench figure with the test on the sheet. error = model - real, in the check's unit; it passes when |error| <= tolerance. */
export type Check = { name: string; unit: string; real: number; model: number; error: number; tolerance: number; pass: boolean };

/** The skidpad diameter, ft, a test figure is taken as when the sheet does not say (Car and Driver's circle). */
export const DEFAULT_SKIDPAD_FT = 300;
/** Grip calibration stops once the bench's skidpad is this close to the test, g. */
export const GRIP_CLOSE = 0.001;
/** Drag calibration stops once the bench's top speed is this close to the test, mph. */
export const TOP_SPEED_CLOSE = 0.1;
/** The most bench runs a fit takes before it settles for the closest it found. */
export const FIT_RUNS = 8;
/** The smallest drag area, m^2, a fit may reach: well under a streamlined coupe's 0.5. */
export const DRAG_AREA_MIN = 0.15;
/** The largest drag area, m^2, a fit may reach: well over a box van's 1.5. */
export const DRAG_AREA_MAX = 3;

// A test figure on file that is a finite positive number, or null.
function figure(f: Sourced<number> | null): number | null {
  if (f === null) return null;
  const v = f.value;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** A copy of a sheet with its own calibration and tests records, so writing either never touches the original. */
function copySheet(sheet: PhysicsSheet): PhysicsSheet {
  return { ...sheet, tests: { ...sheet.tests }, calibration: { ...sheet.calibration } };
}

/**
 * The sheet as its tests were run: where the tests carry the scale weight of the car that ran them (tests.testWeightLb,
 * and its front share when given), that is the curb weight; the resolver adds the driver, who was in the car for the
 * runs. A check compares like with like: on a curb weight from the listings, or the class blank where none is on file,
 * the bench car is not the car that was timed (the Raptor and the Tacoma ran at the pickup blank's 5,071 lb against
 * test trucks of 5,947 and 4,794 lb). A sheet without a test weight comes back as it is.
 */
export function asTested(sheet: PhysicsSheet): PhysicsSheet {
  const w = sheet.tests.testWeightLb;
  if (figure(w) === null) return sheet;
  const out = copySheet(sheet);
  out.curbWeightLb = w;
  const front = sheet.tests.testWeightDistFrontPct;
  if (figure(front) !== null) out.weightDistFrontPct = front;
  return out;
}

/**
 * Finds x in [lo, hi] where f(x) = 0 for an increasing f, by bracketed secant steps (regula falsi, Illinois version):
 * it keeps the root between two points as bisection does, and gets there in a few runs because each figure is close
 * to proportional to what is fitted. Stops within `close` of zero or after FIT_RUNS runs, and returns the best x. When
 * f has the same sign at both ends the root is past the range: it returns that end.
 */
function fit(f: (x: number) => number, lo: number, hi: number, start: number, close: number): { x: number; miss: number } {
  let fLo = f(lo);
  if (fLo >= 0) return { x: lo, miss: fLo };
  let fHi = f(hi);
  if (fHi <= 0) return { x: hi, miss: fHi };
  let best = Math.abs(fLo) < Math.abs(fHi) ? { x: lo, miss: fLo } : { x: hi, miss: fHi };
  let x = start > lo && start < hi ? start : 0.5 * (lo + hi), side = 0;
  for (let k = 2; k < FIT_RUNS; k++) {
    const fx = f(x);
    if (Math.abs(fx) < Math.abs(best.miss)) best = { x, miss: fx };
    if (Math.abs(fx) <= close) break;
    if (fx < 0) { lo = x; fLo = fx; if (side === -1) fHi *= 0.5; side = -1; }
    else { hi = x; fHi = fx; if (side === 1) fLo *= 0.5; side = 1; }
    x = lo - fLo * (hi - lo) / (fHi - fLo);
    if (!(x > lo && x < hi)) x = 0.5 * (lo + hi);
  }
  return best;
}

/**
 * Whether the sheet's drag may be fitted, and to what (mph): only when it has no drag coefficient and no coast-down,
 * and it gives a top speed (the sheet's own, else the test's) that the resolved car is not governed at.
 */
export function dragTarget(sheet: PhysicsSheet): number | null {
  if (figure(sheet.dragCoefficient) !== null || figure(sheet.roadLoadC) !== null) return null;
  const top = figure(sheet.topSpeedMph) !== null ? figure(sheet.topSpeedMph) : figure(sheet.tests.topSpeedMph);
  if (top === null) return null;
  if (sheet.topSpeedGoverned !== null && sheet.topSpeedGoverned.value === true) return null;
  const lim = resolveModel(sheet).model.systems.limiterSpeed;
  return Number.isFinite(lim) && lim <= top * MPH + 2 * MPH ? null : top;
}

/**
 * A copy of the sheet with its calibration set (DESIGN.md 8); the original is not changed.
 *  - With a skidpad test on file: the tyre grip scale that makes the bench's skidpad, on the test's circle (300 ft when
 *    the sheet does not say), meet it. The scale stays inside the tyre category's range; if the range stops it, it
 *    stays at the edge, and checkSheet reports the skidpad miss that is left.
 *  - With no drag coefficient, no coast-down and an ungoverned top speed on file (dragTarget): the drag area that
 *    makes the bench's top speed meet it.
 * Either is null when there is nothing to fit it to.
 */
export function calibrate(sheet: PhysicsSheet): PhysicsSheet {
  const out = copySheet(sheet);
  out.calibration.tyreGripScale = null;
  out.calibration.dragAreaM2 = null;

  const g = figure(sheet.tests.skidpadG);
  if (g !== null) {
    const diameter = figure(sheet.tests.skidpadDiameterFt) ?? DEFAULT_SKIDPAD_FT;
    const category = resolveTyres(sheet, resolveLayout(sheet), {}).category;
    const range = tyreGripScaleRange(category);
    const skid = (scale: number): number => {
      out.calibration.tyreGripScale = scale;
      return skidpadAt(resolveModel(out).model, diameter) - g;
    };
    // The first guess: the skidpad figure is close to proportional to the tyres' friction.
    out.calibration.tyreGripScale = 1;
    const at1 = skidpadAt(resolveModel(out).model, diameter);
    const start = at1 > 0 ? g / at1 : 1;
    out.calibration.tyreGripScale = fit(skid, range.min, range.max, start, GRIP_CLOSE).x;
  }

  const top = dragTarget(out);
  if (top !== null) {
    const speed = (area: number): number => {
      out.calibration.dragAreaM2 = area;
      return top - topSpeedOf(resolveModel(out).model).mph;   // rises with drag area, as fit() wants
    };
    // The first guess: top speed goes as the cube root of power over drag area.
    const base = resolveModel(out).model.aero.dragArea;
    const now = topSpeedOf(resolveModel(out).model).mph;
    const start = now > 0 ? base * (now / top) * (now / top) * (now / top) : base;
    out.calibration.dragAreaM2 = fit(speed, DRAG_AREA_MIN, DRAG_AREA_MAX, start, TOP_SPEED_CLOSE).x;
  }
  return out;
}

/* ------------------------------------------------------------------ the check */

/** The plan of record's tolerances (section 7): 0-60 7% or 0.3 s, whichever is larger; quarter mile and trap 4%; braking 7%; top speed 4%, or 1 mph for a governed car; skidpad 0.04 g. */
export const TOLERANCE = Object.freeze({
  zeroToSixtyShare: 0.07, zeroToSixtySec: 0.3, quarterShare: 0.04, trapShare: 0.04, brakingShare: 0.07,
  topSpeedShare: 0.04, governedMph: 1, skidpadG: 0.04,
});

function check(name: string, unit: string, real: number, model: number, tolerance: number): Check {
  const error = model - real;
  return { name, unit, real, model, error, tolerance, pass: Number.isFinite(model) && Math.abs(error) <= tolerance };
}

/**
 * Compares a bench result with the tests on the sheet, at the plan of record's tolerances: 0-60 (with the one-foot
 * rollout left out when the test did), the quarter mile and its trap speed, 60-0 and 70-0 braking, top speed (1 mph
 * either side when the governor sets it), and the skidpad on the nearer of the bench's two circles. A figure the car
 * was calibrated on is not a prediction, so it is checked only when the calibration could not meet it (the grip scale
 * held at its category's edge, the drag area at its limit): then the miss that is left is reported.
 */
export function checkSheet(sheet: PhysicsSheet, bench: BenchResult): Check[] {
  const t = sheet.tests, T = TOLERANCE, out: Check[] = [];
  const z = figure(t.zeroToSixtySec);
  if (z !== null) {
    const rollout = t.rollout !== null && t.rollout.value === true;
    out.push(check(rollout ? '0-60 mph (rollout)' : '0-60 mph', 's', z, rollout ? bench.zeroToSixtyRollout : bench.zeroToSixty,
      Math.max(T.zeroToSixtyShare * z, T.zeroToSixtySec)));
  }
  const q = figure(t.quarterMileSec);
  if (q !== null) out.push(check('quarter mile', 's', q, bench.timeslip.quarter, T.quarterShare * q));
  const trap = figure(t.quarterMileMph);
  if (trap !== null) out.push(check('trap speed', 'mph', trap, bench.timeslip.trapMph, T.trapShare * trap));
  const b60 = figure(t.braking60to0Ft);
  if (b60 !== null) out.push(check('60-0 mph', 'ft', b60, bench.braking60, T.brakingShare * b60));
  const b70 = figure(t.braking70to0Ft);
  if (b70 !== null) out.push(check('70-0 mph', 'ft', b70, bench.braking70, T.brakingShare * b70));
  const top = figure(t.topSpeedMph);
  if (top !== null) {
    const c = check('top speed', 'mph', top, bench.topSpeed, bench.topSpeedGoverned ? T.governedMph : T.topSpeedShare * top);
    const fitted = sheet.calibration.dragAreaM2 !== null && (figure(sheet.topSpeedMph) === null || figure(sheet.topSpeedMph) === top);
    if (!fitted || !c.pass) out.push(fitted ? { ...c, name: 'top speed (drag fitted to it)' } : c);
  }
  const skid = figure(t.skidpadG);
  if (skid !== null) {
    const diameter = figure(t.skidpadDiameterFt) ?? DEFAULT_SKIDPAD_FT;
    const small = Math.abs(diameter - 200) < Math.abs(diameter - 300);
    const c = check(`skidpad ${small ? 200 : 300} ft`, 'g', skid, small ? bench.skidpad200 : bench.skidpad300, T.skidpadG);
    const fitted = sheet.calibration.tyreGripScale !== null;
    if (!fitted || !c.pass) out.push(fitted ? { ...c, name: `${c.name} (grip fitted to it)` } : c);
  }
  return out;
}

/* ------------------------------------------------------------------ the fleet */

/** The plan of record's fleet-wide limits (section 7): the median 0-60 error across the validated cars, as a share of the real figure... */
export const MEDIAN_ZERO_TO_SIXTY = 0.04;
/** ...and the median quarter-mile time error. */
export const MEDIAN_QUARTER = 0.03;
/** Two cars further apart than this on a published figure (|a - b| / the smaller) must come out in the same order. */
export const ORDER_GAP = 0.1;

// The middle of a list of numbers (the mean of the middle two for an even count), or null for none. Sorted by value
// with a numeric comparator, so the order never depends on how the engine compares strings.
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b), mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : 0.5 * (s[mid - 1] + s[mid]);
}

/**
 * The plan's two fleet medians over a set of cars' checks (one checkSheet table a car): the median of |error| / real
 * over the 0-60 checks (with or without the rollout), and over the quarter-mile time checks. Null when no car has the
 * figure. A car without a finite model figure counts as an infinite error.
 */
export function fleetMedians(tables: Check[][]): { zeroToSixty: number | null; quarter: number | null } {
  const z: number[] = [], q: number[] = [];
  for (const t of tables) {
    for (const c of t) {
      const share = Number.isFinite(c.error) && c.real > 0 ? Math.abs(c.error) / c.real : Infinity;
      if (c.name === '0-60 mph' || c.name === '0-60 mph (rollout)') z.push(share);
      else if (c.name === 'quarter mile') q.push(share);
    }
  }
  return { zeroToSixty: median(z), quarter: median(q) };
}

/**
 * The plan's ordering criterion: for every check name (each kept apart: 60-0 from 70-0, a rollout 0-60 from one
 * without), every pair of cars whose published figures are more than ORDER_GAP apart must come out of the bench in
 * the same order. Returns one line for each pair that does not (a tie in the model counts as not), in a fixed order.
 */
export function orderInversions(cars: { id: string; checks: Check[] }[]): string[] {
  const names: string[] = [];
  for (const car of cars) for (const c of car.checks) if (names.indexOf(c.name) < 0) names.push(c.name);
  names.sort();
  const out: string[] = [];
  for (const name of names) {
    const rows: { id: string; c: Check }[] = [];
    for (const car of cars) for (const c of car.checks) if (c.name === name) rows.push({ id: car.id, c });
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i].c, b = rows[j].c;
        const small = Math.min(a.real, b.real);
        if (!(small > 0) || !(Math.abs(a.real - b.real) / small > ORDER_GAP)) continue;
        const real = Math.sign(a.real - b.real), model = Math.sign(a.model - b.model);
        if (real !== model) {
          out.push(`${name}: ${rows[i].id} ${a.real} against ${rows[j].id} ${b.real} on test, but ${a.model} against ${b.model} on the bench`);
        }
      }
    }
  }
  return out;
}
