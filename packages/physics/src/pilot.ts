// A pilot (DESIGN.md section 14): a driver for a real core car on a racing line, as Controls each step, the way the
// bench's drivers drive (drivers.ts): it reads the car once a step and sets the controls for the next, and never
// touches the car itself.
//
//  - Steering: the line's curvature a little ahead (feed-forward: it knows the road it is coming to), plus a
//    correction of how far it is off the line and how far its path points off the line's direction, which it sees
//    only after its reaction time and carries forward over it as a driver does; the curvature that asks for is turned
//    into lock through the car's own handling diagram (lap.ts steerFor: the lock it took for each lateral acceleration
//    at each speed on the bench), as a driver who knows the car steers it. The correction is critically damped and
//    gentler the slower the reaction, so the delay does not set it weaving. What it feels through the seat, the car
//    turning more or less than the curvature it asked for, it answers at once: lock off (to opposite lock, catching a
//    slide) when the car rotates too much, lock on when too little. Never more lock than the outer front tyre's peak
//    slip angle, as an expert (drivers.ts circleDriver).
//  - Pedals: they follow the pilot's own speed profile, the limit lap's worked out with only `skill` of the car's
//    cornering and braking (lap.ts lapOn), a little ahead so the brakes come on in time; the throttle and the brake
//    are set from the acceleration that asks for, through the car's own drag and brake sizes, with a correction for
//    the speed error. A tyre worked past its peak on its combined slip (the brush's use: slip ratio and slip angle each
//    over its peak, added as a vector) eases the pedal that put it there: the throttle for a driven or a rear tyre, the
//    brake for any. In a car with traction control the throttle eases only for a tyre that is also cornering: in a
//    straight line a driver floors it and lets the system hold the wheelspin (easing the pedal there, an automatic
//    reads a lighter foot, changes up, and kicks down again when the foot returns). The car's own systems stay as
//    fitted.
//  - Gears: a manual's it chooses, the lowest gear that keeps the engine under the car's own full-throttle shift point
//    for it (systems.ts shiftUpOmega), with GEAR_DOWN to spare after a change down, held until the engine reaches that
//    point: changed down on the brakes, ready to pull out of the corner, never hunting. (Left to the car's own logic a
//    manual changes up on a closed throttle and then kicks down through several gears out of every corner, each shift
//    costing its drive for a third of a second.) Any other box is left in drive to choose for itself, as a driver
//    leaves an automatic.
//  - The person: skill (0.80 to 0.98 of the envelope), reaction time (0.10 to 0.20 s) and precision (0.7 to 1) all
//    come from a seed (math.ts rng). Imprecision is a slow drift of where on the track it aims (up to 1 m at
//    precision 0 off the line) and of how much below its profile it drives (up to 8%), changing every 80 m of track:
//    mistakes cost time, they never gain it. Its aim stays inside the line's own band less EDGE_SPARE m for each
//    second of its reaction time: a driver who is slower to correct leaves himself more room where the line runs to
//    the edge of the road.
//  - It never changes speed because of anyone else: close racing comes from matching cars by class.
//
// A pilot is made once per car and line (it allocates then); its step allocates nothing.
import type { Controls, VehicleModel, VehicleState } from './types';
import type { Driver } from './drivers';
import type { Envelope, LapProfile } from './lap';
import type { PathPlace, RacingLine } from './line';
import { restControls } from './drivers';
import { alongAt, envelopeAt, lapOn, speedAt, steerFor } from './lap';
import { createPlace, curvatureAt, placeOnLine } from './line';
import { G, RHO_AIR, datan, datan2, rng } from './math';
import { peakSlipRatio, peakSlipTan } from './tyre';
import { prepareShiftPoints, shiftUpOmega } from './systems';
import { STEP } from './vehicle';

/* ------------------------------------------------------------------ the person */

/**
 * Who is driving: `skill`, the share of the car's cornering and braking it uses (0.80 to 0.98); `reaction`, the
 * seconds before it corrects what it sees the car do (0.10 to 0.20, a skilled driver's); `precision`, how exactly it
 * holds its line and its speed (0.7 to 1, 1 exact); and the seed they and its imprecision come from.
 */
export type PilotTraits = { seed: number; skill: number; reaction: number; precision: number };

/** The range of skill a seed gives. */
export const SKILL_LOW = 0.8;
export const SKILL_HIGH = 0.98;
/** The range of reaction time a seed gives, s. */
export const REACTION_LOW = 0.1;
export const REACTION_HIGH = 0.2;
/** The range of precision a seed gives. */
export const PRECISION_LOW = 0.7;
export const PRECISION_HIGH = 1;

/** A pilot's skill, reaction time and precision from a seed: the same seed gives the same pilot on every machine. */
export function pilotTraits(seed: number): PilotTraits {
  const r = rng(seed);
  // One draw each, in this order.
  const skill = SKILL_LOW + (SKILL_HIGH - SKILL_LOW) * r();
  const reaction = REACTION_LOW + (REACTION_HIGH - REACTION_LOW) * r();
  const precision = PRECISION_LOW + (PRECISION_HIGH - PRECISION_LOW) * r();
  return { seed, skill, reaction, precision };
}

/* ------------------------------------------------------------------ how it drives: the fixed figures */

/**
 * How quickly the correction acts: its rate gain (1/s, on the drift across the line) is this over the reaction time
 * plus PATH_LAG, the time the car's path takes to answer the wheel at speed (its slip angle has to build). Kept to
 * well under a radian of phase at the loop's crossover, so a delayed correction does not overshoot.
 */
export const CROSSOVER = 1;
export const PATH_LAG = 0.25;
/**
 * Lock added per rad/s the car rotates less than the curvature it asked for asks (speed x curvature), as a share of
 * the lock that rotation would take at that speed (wheelbase over speed): the gain of the loop through the car is
 * about this, whatever the speed. Felt, so answered without the reaction time.
 */
export const YAW_GAIN = 3;
/** The corrections are worked at no less than this speed, m/s: below it a metre off would ask for an absurd turn. */
export const CORRECT_MIN_SPEED = 5;
/** The curvature steered for is read this far ahead, s of travel: what the steering and the tyres take to respond. */
export const STEER_AHEAD = 0.05;
/** The speed aimed at is read this far ahead, s of travel: what the brakes and the engine take to respond. */
export const PEDAL_AHEAD = 0.25;
/** Acceleration asked for per m/s of speed error, 1/s. */
export const SPEED_GAIN = 2;
/** Throttle added per m of accumulated speed error (its integral), so cornering drag does not leave it slow. */
export const SPEED_INTEGRAL = 0.05;
/**
 * A tyre's combined use (1 at its peak) above which the pilot eases the pedal working it, and how much it takes off per
 * unit of use beyond that: a driver feels the car go light and lifts a little before it lets go.
 */
export const USE_LIMIT = 0.95;
export const USE_EASE = 3;
/** With traction control fitted, a tyre counts for the throttle only once its slip angle is this share of its peak: it is cornering. */
export const CORNERING = 0.3;
/**
 * Room a pilot leaves inside the line's band, m per second of its reaction time (0.2 to 0.4 m): about what its
 * placement wanders where the line runs to the edge, which grows with how late it corrects.
 */
export const EDGE_SPARE = 2;
/** After a change down, the engine turns at no more than this share of the new gear's shift point. */
export const GEAR_DOWN = 0.8;
/** Imprecision: the aim drifts up to this far off the line at precision 0, m, and the speed up to this share below the profile. */
export const DRIFT_OFFSET = 1;
export const DRIFT_SLOW = 0.08;
/** ...each changing smoothly from one value to the next over this much track, m. */
export const DRIFT_SPACING = 80;
// Mixed into a pilot's seed for the stream its imprecision draws from (any odd constant: a different sequence).
const DRIFT_STREAM = 0x5bd1e995;

/* ------------------------------------------------------------------ the pilot */

/**
 * A pilot: a Driver for one car on one line. Besides driving it reports its plan (the speed profile it drives to),
 * where it is against the line, the distance it has driven along the line since it started (`progress`: laps times
 * the line's length plus the way into this lap, from the line's point 0; a car that starts behind the line starts a
 * little below zero), the speed it is aiming at, and the aim's offset from the line, m.
 */
export type Pilot = Driver & {
  readonly traits: PilotTraits;
  readonly plan: LapProfile;
  readonly place: PathPlace;
  readonly progress: number;
  readonly target: number;
  readonly aim: number;
};

// Everything a pilot holds, made once: the figures it works from and its memory from step to step.
type Mind = {
  model: VehicleModel; line: RacingLine; env: Envelope; plan: LapProfile; traits: PilotTraits;
  place: PathPlace;
  // Car figures an expert knows: wheelbase, full lock, drag area over mass, road load over mass, rolling resistance as
  // an acceleration, full pedal as a deceleration.
  wheelbase: number; maxSteer: number; dragPerMass: number; roadA: number; roadB: number; rolling: number; brakeFull: number;
  // The correction's gains (1/s on the drift, 1/s^2 on the offset); the ring of what it saw over its reaction time
  // (offset from the aim, path angle off the line's direction).
  rateGain: number; offsetGain: number; seenOffset: Float64Array; seenAngle: Float64Array; head: number; started: boolean;
  // Where it is: the last point index, distance into the lap, progress.
  hint: number; lastS: number; progress: number;
  // The speed control's integral, m.
  held: number;
  // Gears: whether it chooses them (a manual), the driven tyres' radius, the gear asked for last (0 before the first).
  stepped: boolean; drivenRadius: number; gear: number;
  // Imprecision: the seeded source, the two knots either side (progress where each sits, and their values).
  draw: () => number; knot: number; offsetA: number; offsetB: number; slowA: number; slowB: number;
  // What it is doing now.
  target: number; aim: number;
};

/**
 * A pilot for a car (its model), on a racing line, with the car's envelope (lap.ts measureEnvelope) and a person
 * (pilotTraits, or any traits: skill is held to 0.5 to 1, reaction to 0 to 1 s, precision to 0 to 1). It works out
 * its own speed profile at its skill and sets its imprecision going from its seed.
 */
export function createPilot(model: VehicleModel, line: RacingLine, env: Envelope, traits: PilotTraits): Pilot {
  const skill = clamp(traits.skill, 0.5, 1), reaction = clamp(traits.reaction, 0, 1), precision = clamp(traits.precision, 0, 1);
  const person: PilotTraits = { seed: traits.seed, skill, reaction, precision };
  const plan = lapOn(line, env, skill);
  // The car's shift points are worked out once per model, here, so that reading them in the step allocates nothing.
  prepareShiftPoints(model);
  const ch = model.chassis, L = ch.a + ch.b;
  const delay = Math.round(reaction / STEP);
  // Critically damped: the offset gain is a quarter of the rate gain squared.
  const rateGain = CROSSOVER / (reaction + PATH_LAG);
  // Its imprecision draws from a second stream of its seed, so that it does not repeat the draws that set its traits.
  const draw = rng((traits.seed ^ DRIFT_STREAM) >>> 0);
  const mind: Mind = {
    model, line, env, plan, traits: person, place: createPlace(),
    wheelbase: L, maxSteer: ch.maxSteer,
    dragPerMass: 0.5 * RHO_AIR * model.aero.dragArea / ch.mass, roadA: model.aero.roadLoadA / ch.mass, roadB: model.aero.roadLoadB / ch.mass,
    rolling: G * 0.5 * (model.tyreFront.rollRes + model.tyreRear.rollRes),
    brakeFull: 2 * (model.brakes.maxTorqueFront / model.tyreFront.radius + model.brakes.maxTorqueRear / model.tyreRear.radius) / ch.mass,
    rateGain, offsetGain: 0.25 * rateGain * rateGain, seenOffset: new Float64Array(delay + 1), seenAngle: new Float64Array(delay + 1), head: 0, started: false,
    hint: -1, lastS: 0, progress: 0, held: 0,
    stepped: model.driveline.gears.length > 1 && model.driveline.transmission === 'manual',
    drivenRadius: model.driveline.layout === 'FWD' ? model.tyreFront.radius : model.tyreRear.radius, gear: 0,
    draw, knot: 0, offsetA: 0, offsetB: 0, slowA: 0, slowB: 0,
    target: 0, aim: 0,
  };
  // The first two knots of its imprecision, at the start and DRIFT_SPACING on.
  mind.offsetA = driftOffset(mind); mind.slowA = driftSlow(mind);
  mind.offsetB = driftOffset(mind); mind.slowB = driftSlow(mind);
  const pilot = {
    traits: person, plan, place: mind.place, progress: 0, target: 0, aim: 0,
    control(s: VehicleState, c: Controls): void {
      think(mind, s, c);
      pilot.progress = mind.progress;
      pilot.target = mind.target;
      pilot.aim = mind.aim;
    },
  };
  return pilot;
}

function clamp(x: number, lo: number, hi: number): number { return x < lo ? lo : x > hi ? hi : x === x ? x : lo; }

// A knot's aim offset (m, either side) and its slowing (share below the profile), one draw each, in that order.
function driftOffset(p: Mind): number { return (2 * p.draw() - 1) * (1 - p.traits.precision) * DRIFT_OFFSET; }
function driftSlow(p: Mind): number { return p.draw() * (1 - p.traits.precision) * DRIFT_SLOW; }

/* ------------------------------------------------------------------ each step */

// One step of the pilot: where it is, what it sees after its reaction time, then the wheel and the pedals.
function think(p: Mind, s: VehicleState, c: Controls): void {
  restControls(c);
  const line = p.line, place = p.place;
  placeOnLine(line, s.x, s.y, p.hint, place);
  p.hint = place.index;
  track(p, place.s);
  drift(p);
  const speed = Math.sqrt(s.u * s.u + s.v * s.v);
  // The aim: the line, shifted by its imprecision, and kept inside the line's own band less the room it leaves itself.
  const i = place.index, j = i + 1 < line.n ? i + 1 : 0;
  const onLine = line.offset[i] + (line.offset[j] - line.offset[i]) * place.frac;
  let room = line.width / 2 - line.margin - EDGE_SPARE * p.traits.reaction;
  if (room < 0) room = 0;
  const t = smoothstep(p);
  let aim = p.offsetA + (p.offsetB - p.offsetA) * t;
  if (onLine + aim > room) aim = room - onLine; else if (onLine + aim < -room) aim = -room - onLine;
  p.aim = aim;
  const offset = place.offset - aim;
  // How far the path points off the line's direction (the heading when barely moving).
  let fx = s.hx, fy = s.hy;
  if (speed > 1) { fx = s.u * s.hx - s.v * s.hy; fy = s.u * s.hy + s.v * s.hx; }
  const angle = datan2(place.tx * fy - place.ty * fx, place.tx * fx + place.ty * fy);
  see(p, offset, angle);
  steer(p, s, c, speed);
  pedals(p, s, c, speed, 1 - (p.slowA + (p.slowB - p.slowA) * t));
  if (p.stepped) c.gear = gearFor(p, s);
}

// The gear for the road speed: the lowest whose engine speed is under GEAR_DOWN of its full-throttle shift point, but
// the gear in hand is kept until its engine reaches its own shift point. Judged on the road speed, not the driven
// wheels', so wheelspin neither changes it up nor a locking wheel down; held through a shift under way.
function gearFor(p: Mind, s: VehicleState): number {
  const d = p.model.driveline, n = d.gears.length;
  if (s.shiftTimer > 0 && p.gear >= 1) return p.gear;
  const shaft = (s.u > 0 ? s.u : 0) / p.drivenRadius * d.finalDrive;
  let want = n;
  for (let g = 1; g <= n; g++) {
    if (d.gears[g - 1] * shaft < GEAR_DOWN * shiftUpOmega(p.model, g)) { want = g; break; }
  }
  const cur = p.gear;
  if (cur >= 1 && cur <= n && want > cur && d.gears[cur - 1] * shaft < shiftUpOmega(p.model, cur)) want = cur;
  p.gear = want;
  return want;
}

// Progress along the line: the change in distance into the lap, taken the short way round.
function track(p: Mind, at: number): void {
  const L = p.line.length;
  if (!p.started) {
    p.progress = at < 0.5 * L ? at : at - L;
    p.lastS = at;
    return;
  }
  let d = at - p.lastS;
  if (d < -0.5 * L) d += L; else if (d > 0.5 * L) d -= L;
  p.progress += d;
  p.lastS = at;
}

// Past the next knot of its imprecision, draw the one after it.
function drift(p: Mind): void {
  while (p.progress >= (p.knot + 1) * DRIFT_SPACING) {
    p.knot++;
    p.offsetA = p.offsetB; p.slowA = p.slowB;
    p.offsetB = driftOffset(p); p.slowB = driftSlow(p);
  }
}

// How far between its two knots the pilot is, eased in and out so the drift turns smoothly.
function smoothstep(p: Mind): number {
  let t = (p.progress - p.knot * DRIFT_SPACING) / DRIFT_SPACING;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}

// What it saw `delay` steps ago: the ring takes this step's view and gives back the oldest. Before its first step
// it has seen only this.
function see(p: Mind, offset: number, angle: number): void {
  const n = p.seenOffset.length;
  if (!p.started) {
    for (let k = 0; k < n; k++) { p.seenOffset[k] = offset; p.seenAngle[k] = angle; }
    p.started = true;
  }
  p.seenOffset[p.head] = offset;
  p.seenAngle[p.head] = angle;
  p.head = p.head + 1 < n ? p.head + 1 : 0;
}

// The wheel: the curvature ahead and the delayed correction, through the car's handling diagram; never past the outer
// front tyre's peak slip angle.
function steer(p: Mind, s: VehicleState, c: Controls, speed: number): void {
  const m = p.model, ch = m.chassis, place = p.place;
  // The oldest in the ring is what it saw `delay` steps ago.
  const seenOffset = p.seenOffset[p.head], seenAngle = p.seenAngle[p.head];
  // As a driver does with what he saw a moment ago, it carries the offset on by the drift it saw, over its reaction time.
  const offsetNow = seenOffset + p.traits.reaction * speed * seenAngle;
  const v = speed > CORRECT_MIN_SPEED ? speed : CORRECT_MIN_SPEED;
  const ahead = curvatureAt(p.line, place.s + STEER_AHEAD * speed, place.index);
  // The curvature wanted: the line's ahead, less a pull back toward the aim of offsetGain x offset plus rateGain x
  // drift (speed x angle), as a lateral acceleration over speed squared.
  const want = ahead - p.offsetGain * offsetNow / (v * v) - p.rateGain * seenAngle / v;
  let angle = steerFor(p.env, p.wheelbase, speed, want) + YAW_GAIN * p.wheelbase / v * (v * want - s.r);
  // An expert never winds on lock past the outer front tyre's peak slip angle (drivers.ts circleDriver), either way.
  if (s.u > 2) {
    const hf = 0.5 * ch.trackFront, vy = s.v + s.r * ch.a;
    const right = datan(vy / (s.u + s.r * hf)) + datan(peakSlipTan(m.tyreFront, s.wheelLoad[1], 1));
    const left = datan(vy / (s.u - s.r * hf)) - datan(peakSlipTan(m.tyreFront, s.wheelLoad[0], 1));
    if (angle > right) angle = right; else if (angle < left) angle = left;
  }
  let st = p.maxSteer > 0 ? angle / p.maxSteer : 0;
  if (st > 1) st = 1; else if (st < -1) st = -1;
  c.steer = st;
}

// The pedals: the acceleration the plan asks for a little ahead, plus a correction for the speed error, through the
// car's drag and its brakes' size; then eased where a tyre is past its peak.
function pedals(p: Mind, s: VehicleState, c: Controls, speed: number, slack: number): void {
  const place = p.place, at = place.s + PEDAL_AHEAD * speed;
  const target = slack * speedAt(p.plan, at, place.index);
  p.target = target;
  const err = target - speed;
  let held = p.held + err * STEP;
  if (held > 2 / SPEED_INTEGRAL) held = 2 / SPEED_INTEGRAL; else if (held < -2 / SPEED_INTEGRAL) held = -2 / SPEED_INTEGRAL;
  p.held = held;
  const want = slack * slack * alongAt(p.plan, at, place.index) + SPEED_GAIN * err;
  // What slows the car with no pedal: drag, the coast-down's road load, the tyres' rolling resistance.
  const resist = p.dragPerMass * speed * speed + p.roadA + p.roadB * speed + p.rolling;
  if (want > -resist) {
    const full = G * envelopeAt(p.env.accel, p.env, speed) + resist;
    let th = full > 0 ? (want + resist) / full : 1;
    th += SPEED_INTEGRAL * held;
    th = th < 0 ? 0 : th > 1 ? 1 : th;
    // Ease off for a driven or a rear tyre past its peak.
    const used = throttleUse(s);
    if (used > USE_LIMIT) th *= ease(USE_EASE * (used - USE_LIMIT));
    c.throttle = th;
  } else {
    let br = p.brakeFull > 0 ? (-want - resist) / p.brakeFull : 1;
    br = br < 0 ? 0 : br > 1 ? 1 : br;
    const used = brakeUse(s);
    if (used > USE_LIMIT) br *= ease(USE_EASE * (used - USE_LIMIT));
    c.brake = br;
    if (held > 0) p.held = 0;
  }
}

// 1 - x, never below 0.
function ease(x: number): number { return x < 1 ? 1 - x : 0; }

// How much of its grip tyre i is using, 1 at its peak: its slip ratio and slip angle each over the slip at which it
// alone would peak, added as a vector (tyre.ts: the brush's p). Judged as on dry asphalt: what the pilot feels is the
// slip, and on a slippery surface the car's own systems still guard the peak.
function use(s: VehicleState, i: number): number {
  const m = s.model, tyre = i < 2 ? m.tyreFront : m.tyreRear, fz = s.wheelLoad[i];
  const kp = peakSlipRatio(tyre, fz, 1), ap = peakSlipTan(tyre, fz, 1);
  const x = kp > 0 ? s.wheelSlipRatio[i] / kp : 0, y = ap > 0 ? s.wheelSlipTan[i] / ap : 0;
  return Math.sqrt(x * x + y * y);
}

// The most-used tyre the throttle works: the driven ones, and the rear ones (drive or not, a rear past its peak is the
// car beginning to turn round). With traction control fitted, only a tyre that is also cornering (CORNERING of its
// peak slip angle or more) counts: straight-line wheelspin is the system's to hold.
function throttleUse(s: VehicleState): number {
  const m = s.model, tcs = m.systems.tcs;
  let worst = 0;
  for (let i = m.driveline.layout === 'RWD' ? 2 : 0; i < 4; i++) {
    if (tcs && cornering(s, i) < CORNERING) continue;
    const u = use(s, i);
    if (u > worst) worst = u;
  }
  return worst;
}

// Tyre i's slip angle as a share of the one at which it alone would peak.
function cornering(s: VehicleState, i: number): number {
  const m = s.model, tyre = i < 2 ? m.tyreFront : m.tyreRear, ap = peakSlipTan(tyre, s.wheelLoad[i], 1);
  const y = ap > 0 ? s.wheelSlipTan[i] / ap : 0;
  return y < 0 ? -y : y;
}

// The most-used tyre of the four, under braking.
function brakeUse(s: VehicleState): number {
  let worst = 0;
  for (let i = 0; i < 4; i++) { const u = use(s, i); if (u > worst) worst = u; }
  return worst;
}
