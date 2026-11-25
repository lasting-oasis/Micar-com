// The bench (DESIGN.md section 8): the standard tests a magazine runs, on flat dry asphalt, with the car's own systems
// as fitted and the reference drivers of drivers.ts at the wheel.
//  - accel: drag launches. The launch driver searches its launch speed and its shift speed for the best quarter mile,
//    as a test driver does over a session, and the bench reports that run: 0-30, 0-60, 0-100 from the first movement,
//    0-60 with the first foot left out, and the whole timeslip.
//  - brake: full pedal from 3 mph above 60 and above 70 mph; the distance from 60 (70) mph to rest.
//  - skidpad: the best full-lap average of speed^2 / radius on a 300 ft and a 200 ft circle before the car runs 1.5 m
//    wide: found with the speed rising slowly, then taken as testers take it, a lap at the fastest speed held.
//  - topSpeed: flat out until the car stops gaining speed, or its governor holds it.
//  - dyno: the engine's peaks, read off its own full-throttle table.
// Everything is a pure function of the model: the same model gives the same figures on every machine.
import type { BenchResult, BenchTest, Controls, Timeslip, VehicleModel, VehicleState } from './types';
import type { Driver } from './drivers';
import { brakeDriver, circleDriver, cruiseDriver, drivenWheels, flatOutDriver, launchDriver } from './drivers';
import { staticLoads } from './chassis';
import { enginePeaks } from './engine';
import { G, PI, datan2 } from './math';
import { FLAT, defaultControls } from './state';
import { autoShift } from './systems';
import { tyreMuY } from './tyre';
import { FT, HP, LBFT, MPH, RPM } from './units';
import { STEP, SUBSTEPS, createVehicle, step, stepWith } from './vehicle';

/* ------------------------------------------------------------------ the bench's fixed figures */

/** The quarter mile and the other timeslip marks, m from where the car stood. */
export const QUARTER_MILE = 1320 * FT;
/** The one-foot rollout before a drag strip's clock (and a magazine's rollout 0-60) starts, m. */
export const ROLLOUT = 1 * FT;
/** Trap speeds are averaged over the last 66 ft before the eighth and the quarter. */
export const TRAP = 66 * FT;
/**
 * The car is moving once its speed passes this, m/s, for good: a launch reaches it within a millisecond, while a car
 * standing on its brakes against its converter, its tyres winding up a fraction of a millimetre, never does.
 */
export const MOVING = 0.01;
/** The launch driver's shift speeds, as shares of the car's own full-throttle shift points. */
export const SHIFT_SHARES: readonly number[] = [0.96, 0.98, 1, 1.02, 1.04];
/** The launch speeds it tries: this many, evenly from LAUNCH_LOW x idle to LAUNCH_HIGH x redline. */
export const LAUNCH_COUNT = 5;
/** The lowest launch speed tried, as a multiple of idle. */
export const LAUNCH_LOW = 1.3;
/** The highest launch speed tried, as a share of redline. */
export const LAUNCH_HIGH = 0.75;
/** A braking test starts this far above the speed it is timed from, m/s (3 mph). */
export const BRAKE_LEAD = 3 * MPH;
/** The radius of a 300 ft skidpad circle, m (Car and Driver's). */
export const SKIDPAD_300 = 150 * FT;
/** The radius of a 200 ft skidpad circle, m (Motor Trend's). */
export const SKIDPAD_200 = 100 * FT;
/** On the skidpad the speed aimed at rises this much each second, m/s. */
export const SKIDPAD_RISE = 0.05;
/** ...until the car runs this far wide of the circle, m. */
export const SKIDPAD_WIDE = 1.5;
/** Top speed: flat out until the gain in speed over a second falls below this, m/s^2. */
export const TOP_SPEED_SETTLED = 0.01;

// Limits on how long any run may go, s of simulated time, so that a car that cannot finish a test ends it.
const ACCEL_LIMIT = 120;
const BRAKE_LIMIT = 30;
const SKIDPAD_LIMIT = 400;
const TOP_SPEED_LIMIT = 400;
// Seconds of cruise before a braking test, so the car is settled at its speed on its springs.
const CRUISE_TIME = 1;
// A skidpad lap counts only once the car has been on the circle this long, s: the driver has found the line.
const SKIDPAD_SETTLE = 3;
// Starting speeds tried on the skidpad, as shares of the lateral acceleration the tyres' friction allows at their
// static loads: high first (a short run), lower if the car does not lap the circle settled before it runs wide.
const SKIDPAD_STARTS: readonly number[] = [0.7, 0.55, 0.4];
// Settled laps a skidpad run must complete before the car runs wide for its best lap to count: the best lap is then
// one driven on the line at a steadily rising speed, not the start's transient.
const SKIDPAD_LAPS = 2;
// The rising run sets a moment aside every SNAP_EVERY s while the car is within SNAP_ON_LINE m of the circle. A held run
// taken up from one settles for HOLD_SETTLE s before its lap is timed; HOLD_TRIES of them close on the fastest.
const SNAP_EVERY = 0.5;
const SNAP_ON_LINE = 0.3;
const HOLD_SETTLE = 1;
const HOLD_TRIES = 6;

/* ------------------------------------------------------------------ running a car */

/**
 * Copies every number of one car's state into another's (the same model's), typed arrays element by element, and the
 * gearbox controller's pedal kept beside it, so a run set aside can be taken up again exactly where it was.
 */
export function copyState(from: VehicleState, to: VehicleState): void {
  to.time = from.time; to.x = from.x; to.y = from.y; to.hx = from.hx; to.hy = from.hy;
  to.u = from.u; to.v = from.v; to.r = from.r; to.ax = from.ax; to.ay = from.ay;
  to.heave = from.heave; to.pitch = from.pitch; to.roll = from.roll;
  to.heaveRate = from.heaveRate; to.pitchRate = from.pitchRate; to.rollRate = from.rollRate;
  to.wheelOmega.set(from.wheelOmega); to.wheelLoad.set(from.wheelLoad); to.wheelFx.set(from.wheelFx); to.wheelFy.set(from.wheelFy);
  to.wheelMz.set(from.wheelMz); to.wheelDefX.set(from.wheelDefX); to.wheelDefY.set(from.wheelDefY);
  to.wheelSlipRatio.set(from.wheelSlipRatio); to.wheelSlipTan.set(from.wheelSlipTan); to.wheelSteer.set(from.wheelSteer);
  to.wheelBrake.set(from.wheelBrake);
  to.engineOmega = from.engineOmega; to.boost = from.boost; to.engineTorque = from.engineTorque;
  to.clutchTorque = from.clutchTorque; to.clutchLocked = from.clutchLocked;
  to.gear = from.gear; to.gearNext = from.gearNext; to.shiftTimer = from.shiftTimer; to.ratio = from.ratio;
  to.absActive.set(from.absActive); to.tcsActive = from.tcsActive; to.escActive = from.escActive; to.limiterActive = from.limiterActive;
  to.absHold.set(from.absHold); to.tcsCut = from.tcsCut; to.tcsBrake.set(from.tcsBrake); to.nitrousLeft = from.nitrousLeft;
  to.distance = from.distance; to.energyUsed = from.energyUsed; to.shiftPedal = from.shiftPedal;
}

/** A bench in progress: one car, one controls record, the substep count every step is cut into. */
type Rig = { s: VehicleState; c: Controls; substeps: number };

function rig(model: VehicleModel, substeps: number): Rig {
  return { s: createVehicle(model), c: defaultControls(), substeps };
}

function advance(r: Rig, d: Driver, nitrous = false): void {
  d.control(r.s, r.c);
  if (nitrous) r.c.nitrous = true;
  if (r.substeps === SUBSTEPS) step(r.s, r.c, FLAT); else stepWith(r.s, r.c, FLAT, r.substeps);
}

/** Where a value crossing `target` between two samples lies between them, 0 to 1. */
function between(a: number, b: number, target: number): number {
  const d = b - a;
  return d !== 0 ? (target - a) / d : 1;
}

/**
 * Sets a standing car rolling straight (or round a curve of yaw rate r) at u m/s: each wheel turning with the road
 * under it, the gear the car would choose at a part throttle, the engine turning with it.
 */
export function setRolling(s: VehicleState, u: number, r: number): void {
  const m = s.model, ch = m.chassis, d = m.driveline;
  s.u = u; s.v = 0; s.r = r;
  const hf = 0.5 * ch.trackFront, hr = 0.5 * ch.trackRear;
  s.wheelOmega[0] = (u - r * hf) / m.tyreFront.radius;
  s.wheelOmega[1] = (u + r * hf) / m.tyreFront.radius;
  s.wheelOmega[2] = (u - r * hr) / m.tyreRear.radius;
  s.wheelOmega[3] = (u + r * hr) / m.tyreRear.radius;
  const c = defaultControls();
  c.throttle = 0.3;
  s.gear = 1;
  const g = autoShift(s, c);
  s.gear = g; s.gearNext = g; s.shiftTimer = 0;
  const { first, last } = drivenWheels(m);
  let wd = 0;
  for (let i = first; i <= last; i++) wd += s.wheelOmega[i];
  wd /= last - first + 1;
  const variator = d.transmission === 'cvt' || d.transmission === 'ecvt';
  if (variator && d.gears.length > 1) {
    const lo = Math.min(d.gears[0], d.gears[1]), hi = Math.max(d.gears[0], d.gears[1]);
    const want = wd > 0 && d.finalDrive > 0 ? 1.5 * m.engine.idle / (d.finalDrive * wd) : hi;
    s.ratio = want < lo ? lo : want > hi ? hi : want;
  } else s.ratio = d.gears.length > 0 ? d.gears[g - 1] : 0;
  const geared = s.ratio * d.finalDrive * wd;
  s.engineOmega = geared > m.engine.idle ? geared : m.engine.idle;
  s.clutchLocked = d.converter !== null && g >= d.converter.lockGear && geared > 1.5 * m.engine.idle ? 1 : 0;
}

/* ------------------------------------------------------------------ accel */

/** One drag run's figures, s and mph; NaN for a mark it did not reach. */
type AccelRun = {
  launchOmega: number; shiftOmega: number;
  moved: number; rolled: number;
  t30: number; t60: number; t100: number;
  marks: Float64Array;   // times at MARKS, s from the start of the run
};

// Distances, m, at which the run's time is taken: 60 ft, 330 ft, 594 ft, 660 ft, 1000 ft, 1254 ft, 1320 ft.
const MARKS: readonly number[] = [60 * FT, 330 * FT, 594 * FT, 660 * FT, 1000 * FT, 1254 * FT, 1320 * FT];
const M60 = 0, M330 = 1, M594 = 2, M660 = 3, M1000 = 4, M1254 = 5, M1320 = 6;

/**
 * One drag run with this launch speed and shift share. It ends at the quarter mile, or at 100 mph when `to100` (and
 * the quarter), or early once its clock has passed `beat` s (it cannot be the best run then). Null if it was cut short.
 * A nitrous kit is armed, as a drag racer runs one: the shot fires in its window at full throttle (and the card counts
 * it in the horsepower, rating.ts).
 */
function accelRun(model: VehicleModel, launchOmega: number, share: number, substeps: number, to100: boolean, beat: number): AccelRun | null {
  const r = rig(model, substeps);
  const d = launchDriver(model, launchOmega, share);
  const s = r.s, armed = model.nitrous !== null && model.nitrous.power > 0;
  const run: AccelRun = { launchOmega, shiftOmega: d.shiftOmega[0], moved: NaN, rolled: NaN, t30: NaN, t60: NaN, t100: NaN, marks: new Float64Array(MARKS.length).fill(NaN) };
  let x0 = s.x, u0 = s.u, t0 = s.time;
  let next = 0;
  while (s.time < ACCEL_LIMIT) {
    advance(r, d, armed);
    const x = s.x, u = s.u, t = s.time;
    // The first movement: the speed passing MOVING for the last time before the rollout (a creep that stops is not a start).
    if (run.rolled !== run.rolled) {
      if (u <= MOVING) run.moved = NaN;
      else if (run.moved !== run.moved) run.moved = t0 + STEP * between(u0, u, MOVING);
    }
    if (run.rolled !== run.rolled && x >= ROLLOUT) run.rolled = t0 + STEP * between(x0, x, ROLLOUT);
    if (run.t30 !== run.t30 && u >= 30 * MPH) run.t30 = t0 + STEP * between(u0, u, 30 * MPH);
    if (run.t60 !== run.t60 && u >= 60 * MPH) run.t60 = t0 + STEP * between(u0, u, 60 * MPH);
    if (run.t100 !== run.t100 && u >= 100 * MPH) run.t100 = t0 + STEP * between(u0, u, 100 * MPH);
    while (next < MARKS.length && x >= MARKS[next]) { run.marks[next] = t0 + STEP * between(x0, x, MARKS[next]); next++; }
    if (next === MARKS.length && (!to100 || run.t100 === run.t100)) break;
    if (run.rolled === run.rolled && t - run.rolled > beat) return null;
    x0 = x; u0 = u; t0 = t;
  }
  return run;
}

/** The launch speeds the driver tries, rad/s: LAUNCH_COUNT from 1.3 x idle to 0.75 x redline, a converter's capped at its stall speed, none repeated. One (0) for a car without an idling engine. */
export function launchSpeeds(model: VehicleModel): number[] {
  const e = model.engine, d = model.driveline;
  if (!(e.idle > 0) || e.kind === 'electric') return [0];
  const lo = LAUNCH_LOW * e.idle, hi = LAUNCH_HIGH * e.redline;
  const cap = d.launch === 'converter' && d.converter !== null ? d.converter.stallOmega : Infinity;
  const out: number[] = [];
  for (let k = 0; k < LAUNCH_COUNT; k++) {
    let w = LAUNCH_COUNT > 1 ? lo + (hi - lo) * k / (LAUNCH_COUNT - 1) : lo;
    if (w > cap) w = cap;
    if (out.indexOf(w) < 0) out.push(w);
  }
  return out;
}

/** Shift shares that give different shift speeds (a share past redline is redline, so several can coincide). */
function distinctShares(model: VehicleModel): number[] {
  const seen: string[] = [], out: number[] = [];
  for (const k of SHIFT_SHARES) {
    const key = Array.from(launchDriver(model, 0, k).shiftOmega).join(',');
    if (seen.indexOf(key) < 0) { seen.push(key); out.push(k); }
  }
  return out;
}

/** Ordered so that the car's own shift point is tried first, then outward: ties go to the plainest choice. */
function byNearness(shares: number[]): number[] {
  return shares.slice().sort((a, b) => Math.abs(a - 1) - Math.abs(b - 1) || a - b);
}

type AccelResult = Pick<BenchResult, 'zeroToThirty' | 'zeroToSixty' | 'zeroToHundred' | 'zeroToSixtyRollout' | 'timeslip' | 'launchRpm' | 'shiftRpm'>;

/**
 * The drag runs: the launch speed searched at the car's own shift points, then the shift speed searched at the best
 * launch, for the best quarter mile (the two barely interact: the launch is over before the first shift). The best
 * run is driven again on to 100 mph, and its figures are reported.
 */
function accel(model: VehicleModel, substeps: number): AccelResult {
  const quarter = (a: AccelRun): number => a.marks[M1320] - a.rolled;
  let best: AccelRun | null = null, bestShare = 1;
  for (const w of launchSpeeds(model)) {
    const run = accelRun(model, w, 1, substeps, false, best !== null ? quarter(best) : Infinity);
    if (run !== null && run.marks[M1320] === run.marks[M1320] && (best === null || quarter(run) < quarter(best))) best = run;
  }
  const launch = best !== null ? best.launchOmega : launchSpeeds(model)[0];
  for (const k of byNearness(distinctShares(model))) {
    if (k === 1) continue;
    const run = accelRun(model, launch, k, substeps, false, best !== null ? quarter(best) : Infinity);
    if (run !== null && run.marks[M1320] === run.marks[M1320] && (best === null || quarter(run) < quarter(best))) { best = run; bestShare = k; }
  }
  const final = accelRun(model, launch, bestShare, substeps, true, Infinity) as AccelRun;
  const m = final.marks, t0 = final.rolled;
  const timeslip: Timeslip = {
    sixtyFoot: m[M60] - t0, threeThirty: m[M330] - t0, eighth: m[M660] - t0, thousand: m[M1000] - t0, quarter: m[M1320] - t0,
    eighthMph: TRAP / (m[M660] - m[M594]) / MPH, trapMph: TRAP / (m[M1320] - m[M1254]) / MPH,
  };
  return {
    zeroToThirty: final.t30 - final.moved, zeroToSixty: final.t60 - final.moved, zeroToHundred: final.t100 - final.moved,
    zeroToSixtyRollout: final.t60 - final.rolled,
    timeslip,
    launchRpm: final.launchOmega / RPM,
    shiftRpm: Number.isFinite(final.shiftOmega) ? final.shiftOmega / RPM : 0,
  };
}

/* ------------------------------------------------------------------ brake */

/**
 * Distance, ft, from `fromMph` to rest under full pedal, ABS as fitted: the car cruises at 3 mph more, then the pedal
 * goes down, and the distance is counted from the moment it passes fromMph to where it comes to rest.
 */
function brakeRun(model: VehicleModel, fromMph: number, substeps: number): number {
  const r = rig(model, substeps), s = r.s;
  const from = fromMph * MPH, start = from + BRAKE_LEAD;
  setRolling(s, start, 0);
  const cruise = cruiseDriver(start);
  while (s.time < CRUISE_TIME) advance(r, cruise);
  const brake = brakeDriver();
  let x0 = s.x, u0 = s.u, at = NaN, far = s.x;
  const end = s.time + BRAKE_LIMIT;
  while (s.time < end) {
    advance(r, brake);
    if (at !== at && s.u <= from) at = x0 + (s.x - x0) * between(u0, s.u, from);
    if (s.x > far) far = s.x;
    if (s.u <= 0) return (far - at) / FT;
    x0 = s.x; u0 = s.u;
  }
  return NaN;
}

/* ------------------------------------------------------------------ skidpad */

/** The lateral acceleration, m/s^2, the car's tyres' peak friction allows at their static loads: the skidpad's upper bound. */
export function frictionLimit(model: VehicleModel): number {
  const loads = new Float64Array(4);
  staticLoads(model.chassis, loads);
  let f = 0;
  for (let i = 0; i < 4; i++) f += tyreMuY(i < 2 ? model.tyreFront : model.tyreRear, loads[i], 1) * loads[i];
  return f / model.chassis.mass;
}

/**
 * The skidpad figure, g, on a circle of this radius (m): the best full-lap average of speed^2 / radius (from the lap
 * time on the circle, as testers take it) before the car runs 1.5 m wide.
 * The speed aimed at rises 0.05 m/s each second from a little under the tyres' friction limit (lower if the car cannot
 * lap the circle settled there) until the car runs wide. A lap driven while the speed rises averages half a lap's rise
 * below the speed it ends at (3 to 4% of the figure), and a tester's figure is a lap at a speed held: so the driver
 * then takes the run up again from where it stood on the line, steady at that speed, at the fastest of those moments
 * that still holds a full lap within 1.5 m (halving the gap each time), and the best lap of all is the figure.
 */
function skidpadRun(model: VehicleModel, radius: number, substeps: number): number {
  const limit = frictionLimit(model);
  let ramp: CircleRun | null = null;
  for (const share of SKIDPAD_STARTS) {
    const run = circleRun(model, radius, Math.sqrt(share * limit * radius), substeps, null);
    if (run.laps >= SKIDPAD_LAPS) { ramp = run; break; }
  }
  if (ramp === null) return NaN;
  let best = ramp.best;
  const snaps = ramp.snaps;
  // Moments on the line, from about a lap before the car ran wide: the earliest should hold, the latest may not.
  let lo = snaps.length - 1;
  while (lo > 0 && ramp.ended - snaps[lo - 1].s.time < snaps[lo - 1].lap) lo--;
  let hi = snaps.length;
  for (let k = 0; k < HOLD_TRIES && hi - lo > 1; k++) {
    const mid = k === 0 ? lo : (lo + hi) >> 1;
    const held = circleRun(model, radius, 0, substeps, snaps[mid]);
    // A held run counts only with a timed lap; its figure replaces the best only when it is a number and better.
    if (held.laps >= 1 && held.best > 0) { if (!(held.best <= best)) best = held.best; if (k > 0) lo = mid; }
    else if (k === 0) break;   // not even the earliest holds: the ramp's lap stands
    else hi = mid;
  }
  return best;
}

/** A moment of a skidpad run set aside: the car, its driver's memory, and how long a lap took then (s). */
type CircleSnap = { s: VehicleState; d: { t0: number; v0: number; rise: number; held: number; trim: number; target: number }; lap: number };

/**
 * What one run round the circle found: its best full lap (g), how many settled laps it drove, when it ended, and the
 * moments set aside while the car was on the line.
 */
type CircleRun = { best: number; laps: number; ended: number; snaps: CircleSnap[] };

/**
 * One run round the circle. From a standing start on the circle at v0 (`from` null), the speed aimed at rising
 * SKIDPAD_RISE each second, setting aside a moment every SNAP_EVERY s while the car is on the line; or taken up from a
 * moment set aside, the speed held where it was then, ending after one settled lap. Laps are timed from the angle swept
 * round the circle's centre (samples of time and angle, one a step) once the driver has settled. It ends when the car
 * runs 1.5 m wide (or stops), or at the time limit.
 */
function circleRun(model: VehicleModel, radius: number, v0: number, substeps: number, from: CircleSnap | null): CircleRun {
  const r = rig(model, substeps), s = r.s;
  const cx = 0, cy = radius;
  // A held run holds the gear the car was in at the moment taken up (the one a driver picks for that speed).
  const d = circleDriver(model, cx, cy, radius, from === null ? v0 : from.d.v0, SKIDPAD_RISE);
  let settle = SKIDPAD_SETTLE;
  if (from === null) setRolling(s, v0, v0 / radius);
  else {
    copyState(from.s, s);
    d.t0 = s.time; d.v0 = from.d.target; d.rise = 0; d.held = from.d.held; d.trim = from.d.trim;
    settle = s.time + HOLD_SETTLE;
  }
  const size = Math.ceil(SKIDPAD_LIMIT / STEP) + 1;
  const times = new Float64Array(size), angles = new Float64Array(size);
  const snaps: CircleSnap[] = [];
  let n = 0, tail = 0, best = NaN, nextSnap = settle;
  let last = datan2(s.y - cy, s.x - cx), swept = 0;
  const end = s.time + SKIDPAD_LIMIT;
  while (s.time < end) {
    advance(r, d);
    const a = datan2(s.y - cy, s.x - cx);
    let da = a - last;
    if (da > PI) da -= 2 * PI; else if (da < -PI) da += 2 * PI;
    swept += da; last = a;
    if (Math.abs(d.wide) > SKIDPAD_WIDE || !(s.u > 0)) break;
    if (s.time < settle) continue;
    if (from === null && s.time >= nextSnap && Math.abs(d.wide) <= SNAP_ON_LINE) {
      const keep = createVehicle(model);
      copyState(s, keep);
      snaps.push({ s: keep, d: { t0: d.t0, v0: d.v0, rise: d.rise, held: d.held, trim: d.trim, target: d.target }, lap: 2 * PI * radius / s.u });
      nextSnap = s.time + SNAP_EVERY;
    }
    times[n] = s.time; angles[n] = swept; n++;
    // The latest full lap: the sample one turn back, between two samples.
    const back = swept - 2 * PI;
    if (angles[0] > back) continue;
    while (tail + 1 < n && angles[tail + 1] <= back) tail++;
    if (tail + 1 >= n) continue;
    const t0 = times[tail] + (times[tail + 1] - times[tail]) * between(angles[tail], angles[tail + 1], back);
    const lap = s.time - t0;
    const g = 4 * PI * PI * radius / (lap * lap) / G;
    if (!(g <= best)) best = g;
    if (from !== null) break;   // a held run needs its one lap
  }
  // Laps are counted on the samples taken, not on the angle swept: the step on which the car runs wide is swept but
  // not sampled, and a lap that ended on it was counted with no time (the Corvette Z51's 300 ft figure came out NaN
  // under the old friction table, and its grip was then fitted to nothing).
  return { best, laps: n > 0 ? Math.floor((angles[n - 1] - angles[0]) / (2 * PI)) : 0, ended: s.time, snaps };
}

/* ------------------------------------------------------------------ top speed */

/** Flat out from rest until the speed stops rising (gaining under 0.01 m/s^2 over a second clear of any shift) or the governor holds it. */
function topSpeedRun(model: VehicleModel, substeps: number): { mph: number; governed: boolean } {
  const r = rig(model, substeps), s = r.s;
  const d = flatOutDriver();
  const window = Math.round(1 / STEP);
  const speeds = new Float64Array(window);
  let k = 0, calm = 0, top = 0;
  while (s.time < TOP_SPEED_LIMIT) {
    advance(r, d);
    const old = speeds[k % window];
    speeds[k % window] = s.u;
    k++;
    calm = s.shiftTimer > 0 ? 0 : calm + 1;
    if (s.u > top) top = s.u;
    if (k > window && calm > window && (s.u - old) / (window * STEP) < TOP_SPEED_SETTLED) break;
  }
  const lim = model.systems.limiterSpeed;
  const governed = Number.isFinite(lim) && s.limiterActive === 1 && top > lim - 2;
  return { mph: top / MPH, governed };
}

/* ------------------------------------------------------------------ single tests, for calibration */

/** The skidpad figure, g, on a circle this many feet across: the bench's skidpad run (calibrate.ts fits grip to it). */
export function skidpadAt(model: VehicleModel, diameterFt: number): number {
  return skidpadRun(model, 0.5 * diameterFt * FT, SUBSTEPS);
}

/** The bench's top-speed run: mph, and whether the governor set it (calibrate.ts fits drag to it). */
export function topSpeedOf(model: VehicleModel): { mph: number; governed: boolean } {
  return topSpeedRun(model, SUBSTEPS);
}

/* ------------------------------------------------------------------ the whole bench */

function emptyResult(): BenchResult {
  return {
    zeroToThirty: NaN, zeroToSixty: NaN, zeroToHundred: NaN, zeroToSixtyRollout: NaN,
    timeslip: { sixtyFoot: NaN, threeThirty: NaN, eighth: NaN, thousand: NaN, quarter: NaN, eighthMph: NaN, trapMph: NaN },
    launchRpm: NaN, shiftRpm: NaN, braking60: NaN, braking70: NaN, skidpad300: NaN, skidpad200: NaN,
    topSpeed: NaN, topSpeedGoverned: false, peakHp: NaN, peakHpRpm: NaN, peakTorqueLbFt: NaN, peakTorqueRpm: NaN,
  };
}

/**
 * Runs the bench on a model: the whole of it, or one test. A figure from a test not run is NaN. Flat dry asphalt,
 * the car's systems as fitted (stability control off on the skidpad), the reference drivers at the wheel.
 */
export function runBench(model: VehicleModel, test: BenchTest = 'all'): BenchResult {
  return runBenchWith(model, test, SUBSTEPS);
}

/** The same bench with every 1/120 s step cut into another number of substeps: how the bench shows no figure depends on it. */
export function runBenchWith(model: VehicleModel, test: BenchTest, substeps: number): BenchResult {
  const out = emptyResult();
  const all = test === 'all';
  if (all || test === 'accel') Object.assign(out, accel(model, substeps));
  if (all || test === 'brake') {
    out.braking60 = brakeRun(model, 60, substeps);
    out.braking70 = brakeRun(model, 70, substeps);
  }
  if (all || test === 'skidpad') {
    out.skidpad300 = skidpadRun(model, SKIDPAD_300, substeps);
    out.skidpad200 = skidpadRun(model, SKIDPAD_200, substeps);
  }
  if (all || test === 'topSpeed') {
    const t = topSpeedRun(model, substeps);
    out.topSpeed = t.mph; out.topSpeedGoverned = t.governed;
  }
  if (all || test === 'dyno') {
    const p = enginePeaks(model.engine);
    out.peakHp = p.power / HP; out.peakHpRpm = p.powerOmega / RPM;
    out.peakTorqueLbFt = p.torque / LBFT; out.peakTorqueRpm = p.torqueOmega / RPM;
  }
  return out;
}
