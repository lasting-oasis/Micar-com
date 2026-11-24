// A car's limit lap on a racing line (DESIGN.md section 14): the fastest the car itself can go round, with no driver
// in the loop.
//
// First its envelope: how hard it can accelerate, brake and corner at each speed, measured once on the bench through
// the core's own step, so that everything the car is (its engine and gears, its tyres on their loads, its brakes and
// ABS, its lift or downforce, its drag) is in it and nothing about the car is assumed here:
//  - acceleration: the bench's launch driver from rest to top speed (an expert's foot on the traction, the car's own
//    shift points); at each speed, the speed gained over the time it took, so a shift's lost drive is in it;
//  - braking: the bench's brake driver at full pedal, ABS as fitted, from near top speed to rest;
//  - cornering: at a ladder of speeds from 10 m/s to most of its top speed, the constant-speed steer ramp of ISO 4138
//    (the throttle holds the speed, the lock goes on slowly), and the most lateral acceleration across the path the
//    car held before it stopped rising or the car began to spin. The speeds spread the figures, so lift or
//    downforce shows. The same runs give the car's handling diagram: the lock it took for each lateral acceleration
//    at each speed, which is how a driver who knows the car steers it (pilot.ts).
// Then a lap: the speed each point of the line allows on its own (the corner speed), a forward pass that accelerates
// out of every corner as hard as the grip left over from cornering lets the car (a friction ellipse), and a backward
// pass that brakes into every corner the same way. The lower of the two at each point is the limit speed profile, and
// its time round is the limit lap.
//
// Measuring an envelope runs the car for a few minutes of simulated time (about half a second of computing); a lap on
// it takes a millisecond. Both are pure functions of their inputs: the same car and line give the same bits anywhere.
import type { Controls, VehicleModel, VehicleState } from './types';
import type { RacingLine } from './line';
import { indexAt, wrap } from './line';
import { frictionLimit, launchSpeeds, setRolling } from './bench';
import { CRUISE_I, CRUISE_P, brakeDriver, cruiseDriver, holdingGear, launchDriver, restControls } from './drivers';
import type { Driver } from './drivers';
import { G, datan, tableAt } from './math';
import { FLAT, defaultControls } from './state';
import { STEP, createVehicle, step } from './vehicle';

/* ------------------------------------------------------------------ the envelope */

/**
 * What a car can do at each speed, in g, tabulated every `dv` m/s from 0 (index k is speed k dv): its flat-out
 * acceleration (net of drag, shifts included), its braking at full pedal, and the most lateral acceleration it holds in
 * a steady corner. `topSpeed` is the most it reached flat out, m/s; `corners` are the cornering measurements the
 * lateral table is drawn through (see Corner).
 */
export type Envelope = {
  dv: number;
  accel: Float64Array; brake: Float64Array; lateral: Float64Array;
  topSpeed: number;
  corners: Corner[];
};

/**
 * One steady-cornering measurement: the speed (m/s), the most lateral acceleration held there (g), and the handling
 * diagram at that speed: `steer[j]` is the road wheels' angle (rad) the car took to corner at j x STEER_STEP g, as
 * far as it got, `reach` being the last j it got to (NaN beyond).
 */
export type Corner = { speed: number; g: number; steer: Float64Array; reach: number };

/** The envelope's speed step, m/s. */
export const ENVELOPE_DV = 1;
/** The speeds cornering is measured at, m/s (those up to CORNER_TOP_SHARE of the car's top speed): a hairpin's to a fast sweeper's. */
export const CORNER_SPEEDS: readonly number[] = [10, 14, 19, 25, 32, 40, 50, 62, 76];
/** Cornering is measured only at speeds up to this share of top speed: the car must have power to spare to hold its speed in a corner. */
export const CORNER_TOP_SHARE = 0.85;
/** The handling diagram's step in lateral acceleration, g. */
export const STEER_STEP = 0.05;
// The diagram reaches this far, g: past any road tyre.
const STEER_MOST = 1.6;

// Acceleration: the run stops once the speed gains less than this over a second clear of shifts (m/s^2), as the
// bench's top-speed run does, or at the time limit (s).
const SETTLED = 0.01;
const ACCEL_LIMIT = 240;
// Braking starts from this share of top speed, after a second's cruise there to settle the car on its springs.
const BRAKE_FROM = 0.95;
const BRAKE_LIMIT = 30;
// Cornering: a second straight at the speed, then the road wheels' angle rises at a rate that would reach the
// kinematic angle for the tyres' friction limit at that speed, plus RAMP_EXTRA rad, in RAMP_TIME s; the throttle holds
// the speed (proportional and integral, as the bench's cruise driver). The lateral acceleration across the path is
// smoothed over TAU s and counted while the speed is held within HELD and the body's slip angle is under SLIDING rad.
// The run ends when the smoothed figure has fallen to FALLEN of the best, the slip angle passes SPUN rad (it is
// spinning), the lock is all used, or at the time limit (s).
const RAMP_EXTRA = 0.05;
const RAMP_TIME = 15;
const TAU = 0.3;
const HELD = 0.03;
const SLIDING = 0.12;
const SPUN = 0.35;
const FALLEN = 0.95;
const CORNER_LIMIT = 45;

/**
 * Measures a car's envelope on the bench: flat-out acceleration from rest to top speed, full braking from near top
 * speed to rest, and steady cornering at speeds from 10 m/s up to 85% of its top speed, all through the core's own
 * step on flat dry asphalt with the car's systems as fitted (stability control off in the corners, as testers run a
 * skidpad).
 */
export function measureEnvelope(model: VehicleModel): Envelope {
  const dv = ENVELOPE_DV;
  const run = accelRun(model, dv);
  const size = Math.ceil(run.top / dv) + 2;
  const accel = new Float64Array(size), brake = new Float64Array(size), lateral = new Float64Array(size);
  // Acceleration at each speed from the times the speed passed each step: the speed gained over the time it took,
  // centred on the speed (so the table integrates back to the run's own times).
  const T = run.times;
  for (let k = 0; k < size; k++) {
    const lo = k > 0 ? k - 1 : 0, hi = k + 1;
    accel[k] = hi < T.length && T[hi] === T[hi] && T[lo] === T[lo] && T[hi] > T[lo] ? (hi - lo) * dv / (T[hi] - T[lo]) / G : 0;
  }
  const D = brakeRun(model, BRAKE_FROM * run.top, dv);
  let lowest = -1, highest = -1;
  for (let k = 0; k < size; k++) {
    const lo = k > 0 ? k - 1 : 0, hi = k + 1;
    if (hi < D.length && D[hi] === D[hi] && D[lo] === D[lo] && D[lo] > D[hi]) {
      brake[k] = (hi - lo) * dv / (D[lo] - D[hi]) / G;
      if (lowest < 0) lowest = k;
      highest = k;
    }
  }
  if (lowest < 0) throw new Error(`${model.id}: the braking run timed nothing`);
  // Above the speed the run started from, the braking measured at the top of the run (drag only adds to it up
  // there); below the last step it timed, the figure at that step.
  for (let k = highest + 1; k < size; k++) brake[k] = brake[highest];
  for (let k = 0; k < lowest; k++) brake[k] = brake[lowest];
  const corners: Corner[] = [];
  const limit = frictionLimit(model);
  for (const v of CORNER_SPEEDS) {
    if (v > CORNER_TOP_SHARE * run.top) continue;
    const c = cornerRun(model, v, limit);
    if (c.g > 0) corners.push(c);
  }
  if (corners.length === 0) throw new Error(`${model.id}: no steady corner could be held`);
  // Cornering at each speed: straight lines between the measurements, the nearest one's figure beyond them.
  for (let k = 0; k < size; k++) {
    const v = k * dv;
    let g = corners[0].g;
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i];
      if (v >= a.speed) {
        const b = i + 1 < corners.length ? corners[i + 1] : null;
        g = b !== null && v < b.speed ? a.g + (b.g - a.g) * (v - a.speed) / (b.speed - a.speed) : a.g;
      }
    }
    lateral[k] = g;
  }
  return { dv, accel, brake, lateral, topSpeed: run.top, corners };
}

/** A car on the bench with its controls, driven by a driver: one step. */
function drive(s: VehicleState, c: Controls, d: Driver): void {
  d.control(s, c);
  step(s, c, FLAT);
}

/**
 * Flat out from rest with the bench's launch driver (at the middle of the launch speeds the bench tries, the car's own
 * shift points): the time the speed first passed each step of dv (index 0: the first movement), and the top speed.
 */
function accelRun(model: VehicleModel, dv: number): { times: Float64Array; top: number } {
  const s = createVehicle(model), c = defaultControls();
  const speeds = launchSpeeds(model);
  const d = launchDriver(model, speeds[speeds.length >> 1], 1);
  // Room for every step of speed up to 200 m/s, past any road car's top speed.
  const times = new Float64Array(Math.ceil(200 / dv) + 2).fill(NaN);
  const window = Math.round(1 / STEP), held = new Float64Array(window);
  let k = 0, calm = 0, top = 0, next = 0, u0 = s.u, t0 = s.time;
  while (s.time < ACCEL_LIMIT) {
    drive(s, c, d);
    const u = s.u;
    // The first movement is the speed passing 1 cm/s; then each step of dv, between two samples.
    if (next === 0 && u > 0.01) { times[0] = t0 + STEP * (0.01 - u0) / (u - u0); next = 1; }
    while (next > 0 && next < times.length && u >= next * dv) { times[next] = t0 + STEP * (next * dv - u0) / (u - u0); next++; }
    if (u > top) top = u;
    const old = held[k % window];
    held[k % window] = u;
    k++;
    // Settled is judged only under way: a converter car stands on its brake for a second before it is let go.
    calm = s.shiftTimer > 0 || u < 1 ? 0 : calm + 1;
    if (k > window && calm > window && (u - old) / (window * STEP) < SETTLED) break;
    u0 = u; t0 = s.time;
  }
  return { times, top };
}

/**
 * Full pedal from `from` m/s (after a second's cruise there) to rest: the time the speed first fell to each step of dv,
 * index k for speed k dv (NaN above the start).
 */
function brakeRun(model: VehicleModel, from: number, dv: number): Float64Array {
  const s = createVehicle(model), c = defaultControls();
  setRolling(s, from, 0);
  const cruise = cruiseDriver(from);
  while (s.time < 1) drive(s, c, cruise);
  const times = new Float64Array(Math.ceil(from / dv) + 2).fill(NaN);
  const d = brakeDriver();
  // The first step timed is the one below the speed the pedal goes down at (the cruise holds it within a little).
  let u0 = s.u, t0 = s.time, next = Math.floor(s.u / dv);
  if (next >= times.length) next = times.length - 1;
  const end = s.time + BRAKE_LIMIT;
  while (s.time < end && next >= 0) {
    drive(s, c, d);
    const u = s.u > 0 ? s.u : 0;
    while (next >= 0 && u <= next * dv) { times[next] = u0 > u ? t0 + STEP * (u0 - next * dv) / (u0 - u) : s.time; next--; }
    u0 = u; t0 = s.time;
  }
  return times;
}

/**
 * The most lateral acceleration, g, the car holds at speed v (m/s), and its handling diagram there: ISO 4138's
 * constant-speed steer ramp. The car runs straight for a second, then the lock goes on slowly while the throttle holds
 * the speed, one gear held (the one a driver picks for it), stability control off as testers run it. The figure is the
 * force across the path over the mass (the accelerometer's two readings turned through the body's slip angle),
 * smoothed, at its most while the speed was held and the car was not sliding: a car that understeers runs out of
 * front grip and the figure falls; one that oversteers starts to spin. The lock for each step of lateral acceleration
 * is taken as the smoothed figure passes it, less the lock added while the smoothing caught up (the ramp's rate times
 * its time constant). `limit` is the tyres' friction limit, m/s^2, which only sets how fast the lock goes on.
 */
function cornerRun(model: VehicleModel, v: number, limit: number): Corner {
  const s = createVehicle(model), c = defaultControls(), ch = model.chassis, L = ch.a + ch.b;
  setRolling(s, v, 0);
  const gear = holdingGear(model, v);
  const rate = (L * limit / (v * v) + RAMP_EXTRA) / RAMP_TIME;
  const steer = new Float64Array(Math.floor(STEER_MOST / STEER_STEP) + 1).fill(NaN);
  steer[0] = 0;
  let held = 0, smooth = 0, best = 0, level = 1;
  while (s.time < CORNER_LIMIT) {
    restControls(c);
    c.esc = false;
    c.gear = gear;
    const angle = s.time > 1 ? rate * (s.time - 1) : 0;
    if (angle >= ch.maxSteer) break;
    c.steer = angle / ch.maxSteer;
    const err = v - s.u;
    held += err * STEP;
    if (held > 2 / CRUISE_I) held = 2 / CRUISE_I; else if (held < -2 / CRUISE_I) held = -2 / CRUISE_I;
    const th = CRUISE_P * err + CRUISE_I * held;
    c.throttle = th > 1 ? 1 : th > 0 ? th : 0;
    step(s, c, FLAT);
    const speed = Math.sqrt(s.u * s.u + s.v * s.v);
    if (!(speed > 0.5 * v)) break;
    // Across the path: the body's lateral acceleration turned through its slip angle (sin and cos from the speeds).
    const across = (s.ay * s.u - s.ax * s.v) / speed;
    smooth += (across - smooth) * STEP / TAU;
    const slip = s.u > 0 ? Math.abs(s.v) / s.u : Infinity;
    if (slip > SPUN) break;
    if (Math.abs(speed - v) < HELD * v && slip < SLIDING) {
      if (smooth > best) best = smooth;
      while (level < steer.length && smooth >= level * STEER_STEP * G) {
        const lag = angle - rate * TAU;
        steer[level] = lag > 0 ? lag : 0;
        level++;
      }
    }
    if (best > 0.3 * limit && smooth < FALLEN * best) break;
  }
  return { speed: v, g: best / G, steer, reach: level - 1 };
}

/**
 * The road wheels' angle (rad, left positive) the car takes to follow a curvature k (1/m, left positive) steadily at
 * speed v (m/s), from its handling diagram: the kinematic angle for the curvature (wheelbase m times curvature) plus
 * the understeer the diagram measured at that lateral acceleration, read between the measured speeds (the nearest
 * one's beyond them). Past the most lateral acceleration the diagram reached, its understeer there. Allocates nothing.
 */
export function steerFor(env: Envelope, wheelbase: number, v: number, k: number): number {
  const kk = k < 0 ? -k : k, a = v * v * kk / G, corners = env.corners, n = corners.length;
  let extra: number;
  if (n === 0) extra = 0;
  else if (!(v > corners[0].speed)) extra = understeerAt(corners[0], wheelbase, a);
  else if (!(v < corners[n - 1].speed)) extra = understeerAt(corners[n - 1], wheelbase, a);
  else {
    let i = 0;
    while (i + 2 < n && corners[i + 1].speed <= v) i++;
    const lo = corners[i], hi = corners[i + 1], t = (v - lo.speed) / (hi.speed - lo.speed);
    extra = understeerAt(lo, wheelbase, a) + (understeerAt(hi, wheelbase, a) - understeerAt(lo, wheelbase, a)) * t;
  }
  const angle = datan(wheelbase * kk) + extra;
  return k < 0 ? -angle : angle;
}

// The understeer in one corner's diagram at lateral acceleration a (g): the lock it took less the kinematic lock for
// that lateral acceleration at its speed (held at the last level it reached).
function understeerAt(c: Corner, wheelbase: number, a: number): number {
  let at = a / STEER_STEP, lock: number;
  if (!(at < c.reach)) { at = c.reach; lock = c.steer[c.reach]; }
  else {
    const j = Math.floor(at);
    lock = c.steer[j] + (c.steer[j + 1] - c.steer[j]) * (at - j);
  }
  return lock - datan(wheelbase * at * STEER_STEP * G / (c.speed * c.speed));
}

/** An envelope figure (g) at a speed (m/s): straight lines between the table's speeds, the end figure beyond them. */
export function envelopeAt(table: Float64Array, env: Envelope, v: number): number {
  return tableAt(table, env.dv, v);
}

/* ------------------------------------------------------------------ the lap */

/**
 * A speed profile round a racing line: the speed at each point of the line (m/s), the acceleration along and across
 * the path there (m/s^2), the time from point 0 to each point (s) and the time round (s). `grip` is the share of the
 * envelope's cornering and braking it was worked out with (1 for the car's limit).
 */
export type LapProfile = {
  line: RacingLine;
  grip: number;
  speed: Float64Array; along: Float64Array; across: Float64Array; time: Float64Array;
  lapTime: number;
};

// The corner-speed search halves its bracket this many times: far below a millimetre per second.
const BISECT = 60;

/**
 * The speed a point of curvature k (1/m) allows on its own: the most at which v^2 |k| is no more than the cornering
 * the envelope gives at v (times grip), and never more than the car's top speed.
 */
export function cornerSpeed(env: Envelope, k: number, grip: number): number {
  const top = env.topSpeed, kk = k < 0 ? -k : k;
  if (top * top * kk <= grip * envelopeAt(env.lateral, env, top) * G) return top;
  let lo = 0, hi = top;
  for (let i = 0; i < BISECT; i++) {
    const v = 0.5 * (lo + hi);
    if (v * v * kk <= grip * envelopeAt(env.lateral, env, v) * G) lo = v; else hi = v;
  }
  return lo;
}

/**
 * The speed profile of a car round a line from its envelope: the limit lap with grip 1, or a driver's lap who uses
 * `grip` of the car's cornering and braking (and its full power where the tyres have grip to spare). The corner speed
 * of every point; then from the slowest point, once round forward, accelerating as hard as the envelope allows within
 * what cornering leaves of the tyres (a friction ellipse), and once round backward, braking the same way; the lower of
 * the two at each point. Time between points at a constant acceleration.
 */
export function lapOn(line: RacingLine, env: Envelope, grip = 1): LapProfile {
  const n = line.n, k = line.k;
  const cap = new Float64Array(n), v = new Float64Array(n);
  let start = 0;
  for (let i = 0; i < n; i++) {
    cap[i] = cornerSpeed(env, k[i], grip);
    if (cap[i] < cap[start]) start = i;
  }
  // Forward: out of the slowest corner, as hard as the car can, round to it again.
  v[start] = cap[start];
  for (let m = 0; m < n; m++) {
    const i = (start + m) % n, j = i + 1 < n ? i + 1 : 0;
    const a = G * envelopeAt(env.accel, env, v[i]) * ellipse(env, v[i], k[i], grip);
    const w = Math.sqrt(v[i] * v[i] + 2 * a * gap(line, i));
    v[j] = w < cap[j] ? w : cap[j];
  }
  // Backward: into every corner, braking as hard as the car can, from the slowest corner round to it again.
  for (let m = 0; m < n; m++) {
    const j = (start - m + n) % n, i = j > 0 ? j - 1 : n - 1;
    const b = G * grip * envelopeAt(env.brake, env, v[j]) * ellipse(env, v[j], k[j], grip);
    const w = Math.sqrt(v[j] * v[j] + 2 * b * gap(line, i));
    if (w < v[i]) v[i] = w;
  }
  const along = new Float64Array(n), across = new Float64Array(n), time = new Float64Array(n);
  let t = 0;
  for (let i = 0; i < n; i++) {
    const j = i + 1 < n ? i + 1 : 0, ds = gap(line, i);
    time[i] = t;
    along[i] = ds > 0 ? (v[j] * v[j] - v[i] * v[i]) / (2 * ds) : 0;
    across[i] = v[i] * v[i] * k[i];
    const mean = v[i] + v[j];
    t += mean > 0 ? 2 * ds / mean : Infinity;
  }
  return { line, grip, speed: v, along, across, time, lapTime: t };
}

/** The limit lap: the car's whole envelope, no driver in the loop. */
export function limitLap(line: RacingLine, env: Envelope): LapProfile {
  return lapOn(line, env, 1);
}

// Distance from point i of the line to the next, m.
function gap(line: RacingLine, i: number): number {
  return (i + 1 < line.n ? line.s[i + 1] : line.length) - line.s[i];
}

// The share of the tyres' longitudinal grip left at speed v on curvature k: sqrt(1 - (ay / cornering)^2), the friction
// ellipse (0 when cornering takes it all).
function ellipse(env: Envelope, v: number, k: number, grip: number): number {
  const cap = grip * envelopeAt(env.lateral, env, v) * G;
  if (!(cap > 0)) return 0;
  const used = v * v * (k < 0 ? -k : k) / cap;
  return used < 1 ? Math.sqrt(1 - used * used) : 0;
}

/**
 * Reads a profile at a distance s along its line (m, wrapped round the lap): the speed there (m/s), in a straight line
 * between points. `hint` is a point index at or before s to start from (negative: search).
 */
export function speedAt(p: LapProfile, s: number, hint: number): number {
  return readAt(p, p.speed, s, hint);
}

/** The acceleration along the path a profile asks for at a distance s along its line, m/s^2 (see speedAt). */
export function alongAt(p: LapProfile, s: number, hint: number): number {
  return readAt(p, p.along, s, hint);
}

function readAt(p: LapProfile, table: Float64Array, s: number, hint: number): number {
  const line = p.line, n = line.n, d = wrap(s, line.length);
  const i = indexAt(line.s, line.length, n, d, hint);
  const j = i + 1 < n ? i + 1 : 0, seg = gap(line, i);
  const t = seg > 0 ? (d - line.s[i]) / seg : 0;
  return table[i] + (table[j] - table[i]) * t;
}
