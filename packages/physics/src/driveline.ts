// The driveline (DESIGN.md 5.2): engine, clutch or torque converter, gearbox, differentials, centre coupling and
// brakes, advanced together once a substep.
//
// Each body (the engine and the four wheels) first takes its own torques for the substep: the engine its brake
// torque, each wheel its tyre's reaction. Then whatever joins them is solved as a speed constraint with a torque
// limit, by sequential impulses: each constraint in turn applies the impulse that makes its two sides turn together,
// keeping a running total clamped to what it can carry (a clutch's capacity, a differential's locking torque, a
// brake's torque with the tyre's rolling resistance), and the passes repeat until they agree. So a locked clutch or a
// held brake is exact rather than a stiff spring, and a slipping one carries exactly its limit, at any time step.
//
// A torque converter is not a constraint (its torque follows the two speeds smoothly) until its lock-up clutch closes.
// A shift drops drive to the gearbox's hold share while the ratio changes at half time and the engine is brought to
// the new gear's speed. Everything here runs in the step: plain arithmetic on module-level scratch, nothing allocated.
import type { Controls, DiffModel, DrivelineModel, EngineModel, VehicleModel, VehicleState } from './types';
import { AUTO_GEAR } from './types';
import { AIR_ENERGY, boostStep, engineTorque } from './engine';
import { PI, tableAt } from './math';
import { rollingResistance } from './tyre';

// Sequential-impulse passes a substep (DESIGN.md 5.2): at least 8, then on until the impulses settle, at most 64.
// Eight leave ordinary cases where they were; the rest is for constraints that fight each other (a locked centre, an
// open differential and the brakes' limits), where a small residual each substep would show as a slow, steady creep.
const MIN_PASSES = 8;
const MAX_PASSES = 64;
// The passes stop once no accumulated impulse moves by more than this in a pass, N m s. It has to be this tight: an
// impulse left over leaves a wheel turning at about that over its inertia each substep, and a car that should be held
// would creep by it. It is a few bits above the rounding of a held car's impulses (about 1 N m s).
const SETTLED = 1e-12;
// Auto-clutch: it starts to bite at 15% over idle (or at the launch speed the driver holds) and is fully closed a
// quarter of that speed higher, so the engine pulls away just above idle instead of stalling or flaring.
const BITE_OVER_IDLE = 1.15;
const ENGAGE_SPAN = 0.25;
// With the pedal up and the car at a walk (5 km/h) the auto-clutch opens, as a driver's left foot would.
const WALKING_PACE = 1.4;
const THROTTLE_CLOSED = 0.02;
// A CVT's target engine speed on a closed throttle, over idle: low enough to be quiet, high enough not to lug.
const CVT_FLOOR_OVER_IDLE = 1.3;
// A converter's lock-up clutch never closes with the turbine below 1.5 x idle and opens again below 1.25 x idle: a
// locked converter would otherwise drag the engine under idle as the car slows. The gap stops it hunting.
const LOCK_OVER_IDLE = 1.5;
const UNLOCK_OVER_IDLE = 1.25;
// Nitrous kits arm through a window switch from about 40% of redline: below it the shot would be power over a small
// engine speed (a torque spike that breaks parts) and the charge is too slow to burn it cleanly.
const NITROUS_WINDOW = 0.4;
// Petrol's stoichiometric air-fuel ratio by mass: a full-throttle mixture burns about this much air per kg of fuel.
const STOICHIOMETRIC = 14.7;
// Pumping mean effective pressure against a closed throttle (DESIGN.md 5.1), Pa: the share of closed-throttle drag
// that is not friction, needed to tell indicated work (what fuel pays for) from brake work.
const PUMPING_MEP = 35e3;
const FOUR_PI = 4 * PI;
// Floating-point slack on the shift timer, as a share of the substep, so that a shift of whole substeps ends on time.
const TIMER_SLACK = 1e-9;
// An accumulated impulse this close to its limit counts as at the limit: the clutch is slipping.
const SATURATED = 1 - 1e-12;

// What joins the engine to the wheels in a substep.
const FREE = 0;    // nothing: neutral, or a clutch fully open
const LOCK = 1;    // a clutch, a converter's lock-up clutch or a direct drive: a speed constraint with a torque limit
const FLUID = 2;   // an unlocked torque converter: torque from the two speeds
const SHIFT = 3;   // mid-shift: a share of the engine's torque reaches the wheels while the engine is brought to speed

/**
 * The ground's rolling-resistance factor under each wheel (SurfaceSample.rolling: 1 on asphalt, more on sand or
 * gravel) for the next drivelineStep only. vehicle.ts writes it from the world each substep, because drivelineStep's
 * fixed signature has no room for it; drivelineStep puts it back to 1 once used, so a caller that never writes it gets
 * asphalt.
 */
export const surfaceRolling = new Float64Array([1, 1, 1, 1]);

// Per-wheel scratch (0 FL, 1 FR, 2 RL, 3 RR), refilled every substep.
const inertia = new Float64Array(4);
const invJ = new Float64Array(4);
const radius = new Float64Array(4);
/** Each wheel's weight in the driven-wheel mean speed: half its axle's share of drive. */
const weight = new Float64Array(4);
/** Torque given to each wheel by an unlocked converter or a shift, N m, before the constraints. */
const drive = new Float64Array(4);
// Accumulated impulses this substep, N m s: per brake, per axle's differential, the clutch, the engine's stop, the
// centre coupling.
const brakeAcc = new Float64Array(4);
/** Each wheel's brake and rolling-resistance limit this substep, N m s. */
const brakeLim = new Float64Array(4);
const diffAcc = new Float64Array(2);
let clutchAcc = 0;
let ratchetAcc = 0;
let centreAcc = 0;
// The shift in progress this substep: 0 none, 1 still in the old gear, 2 in the new; and the seconds left in that phase.
let shiftPhase = 0;
let shiftLeft = 0;

/**
 * Advances the engine, the wheels and the gearbox by one substep of h seconds. It works out the engine's torque (with
 * nitrous when the controls ask and the bottle has some), gives the engine and each wheel their own torques (the
 * tyre's reaction from s.wheelFx), then solves the clutch (or converter lock-up, or direct drive), the differentials,
 * the centre coupling and the brakes (s.wheelBrake, with each tyre's rolling resistance) together as speed
 * constraints. It starts and runs shifts toward gearWanted, moves a CVT's ratio, builds boost, and books fuel or
 * battery energy.
 * throttle is the pedal after traction control and the limiter, 0 to 1.
 */
export function drivelineStep(s: VehicleState, c: Controls, gearWanted: number, throttle: number, h: number): void {
  if (!(h > 0)) return;
  const m = s.model, d = m.driveline, e = m.engine, w = s.wheelOmega;
  const th = throttle > 0 ? (throttle < 1 ? throttle : 1) : 0;
  const electric = e.kind === 'electric';
  const eta = d.efficiency > 0 && d.efficiency < 1 ? d.efficiency : 1;
  const invIe = e.inertia > 0 ? 1 / e.inertia : 0;
  wheelScratch(m);
  const front = frontShare(d);
  weight[0] = 0.5 * front; weight[1] = weight[0];
  weight[2] = 0.5 * (1 - front); weight[3] = weight[2];

  // 1. The gear. A request starts a shift; the box changes ratio at half time. A CVT moves its ratio instead.
  advanceGear(s, d, gearWanted, h);
  let wd = 0, rim = 0;
  for (let i = 0; i < 4; i++) { wd += weight[i] * w[i]; rim += weight[i] * w[i] * radius[i]; }
  if (isCvt(d) && s.gear > 0) cvtRatio(s, d, e, th, wd, h);
  else s.ratio = gearRatio(d, s.gear);
  const G = s.ratio * d.finalDrive;

  // 2. The engine's torque at its present speed, then its boost and the fuel it burns doing so.
  const wE = s.engineOmega;
  const T = engineTorque(e, wE, th, s.boost) + (electric ? 0 : nitrousTorque(s, c, e, th, wE, h));
  s.boost = boostStep(e, s.boost, wE, th, h);
  bookEnergy(s, e, T, th, wE, h);

  // 3. What joins the engine to the wheels this substep.
  let mode = FREE, limit = 0, hold = 1, pump = 0;
  for (let i = 0; i < 4; i++) drive[i] = 0;
  if (G !== 0 && G === G) {
    const hold0 = d.shiftTorqueHold > 0 ? (d.shiftTorqueHold < 1 ? d.shiftTorqueHold : 1) : 0;
    const cv = d.launch === 'converter' ? d.converter : null;
    if (cv !== null) {
      const turbine = G * wd;
      if (shiftPhase !== 0) {
        // Between gears that both run locked, the lock-up stays shut through the shift (as modern boxes do) and the
        // shift is a clutch shift; below them the converter carries it and lets the engine find its own speed.
        hold = hold0;
        const lg = cv.lockGear;
        mode = s.gear > 0 && s.gear >= lg && s.gearNext >= lg && turbine >= UNLOCK_OVER_IDLE * e.idle ? SHIFT : FLUID;
      } else if (converterLocked(s, d, e, cv, turbine, wE, th)) {
        mode = LOCK; limit = capacity(d) * h;
      } else mode = FLUID;
      if (mode === FLUID) {
        pump = pumpTorque(e, cv, wE, turbine);
        const turbineTorque = pump * torqueRatio(cv, wE, turbine);
        spread(turbineTorque * hold * G, turbineTorque >= 0 ? eta : 1 / eta);
      }
    } else if (shiftPhase !== 0) {
      mode = SHIFT; hold = hold0;
    } else {
      mode = LOCK; limit = clutchLimit(s, c, d, e, electric, G, wd, rim, th) * h;
    }
    if (mode === SHIFT) spread(hold * T * G, T >= 0 ? eta : 1 / eta);
  }

  // 4. Each body's own torques, explicitly. Mid-shift the engine's speed is set below instead.
  if (mode !== SHIFT) s.engineOmega = wE + (T - pump) * h * invIe;
  for (let i = 0; i < 4; i++) w[i] += (drive[i] - s.wheelFx[i] * radius[i]) * h * invJ[i];

  // 5. The constraints, by sequential impulses. The brakes go first in every pass, so that from the first pass on it
  // is known which wheels a brake is holding: to the other constraints such a wheel is immovable (its brake takes
  // whatever they push it with, up to its torque), and each of them hands its push straight to that brake.
  clutchAcc = 0; ratchetAcc = 0; centreAcc = 0; diffAcc[0] = 0; diffAcc[1] = 0;
  // Rolling resistance acts on the wheel (the tyre's hysteresis) and reaches the car through the tyre's force. It is
  // friction, so it is solved with the brake as one limit (DESIGN.md 3): all of it against a rolling wheel, as much as
  // stops a slowing one and no more, nothing on a wheel at rest. The ground under the wheel scales it.
  for (let i = 0; i < 4; i++) {
    const roll = rollingResistance(i < 2 ? m.tyreFront : m.tyreRear, s.wheelLoad[i], surfaceRolling[i]) * radius[i];
    surfaceRolling[i] = 1;
    const brake = s.wheelBrake[i] > 0 ? s.wheelBrake[i] : 0;
    brakeAcc[i] = 0;
    brakeLim[i] = (brake + roll) * h;
  }
  const frontDiff = d.layout !== 'RWD' && d.diffFront.kind !== 'open';
  const rearDiff = d.layout !== 'FWD' && d.diffRear.kind !== 'open';
  const coupled = d.layout === 'AWD' && d.centre.kind === 'coupling' && d.centre.lockTorque > 0;
  // The coupling's limit as a force at the road (solveCentre works in road speed): its torque at the axle it feeds.
  const centreLimit = coupled ? d.centre.lockTorque / (front > 0.5 ? radius[2] : radius[0]) * h : 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const c0 = clutchAcc, r0 = ratchetAcc, q0 = centreAcc, d0 = diffAcc[0], d1 = diffAcc[1];
    const b0 = brakeAcc[0], b1 = brakeAcc[1], b2 = brakeAcc[2], b3 = brakeAcc[3];
    for (let i = 0; i < 4; i++) if (brakeLim[i] > 0) solveBrake(w, i, brakeLim[i]);
    if (mode === LOCK) solveClutch(s, G, invIe, eta, limit);
    if (!electric && mode !== SHIFT) solveRatchet(s, invIe);
    if (frontDiff) solveDiff(w, 0, diffLock(d.diffFront, axleTorque(0, mode, G, eta, front, coupled, h)) * h);
    if (rearDiff) solveDiff(w, 1, diffLock(d.diffRear, axleTorque(1, mode, G, eta, front, coupled, h)) * h);
    if (coupled) solveCentre(w, centreLimit);
    if (pass + 1 < MIN_PASSES) continue;
    let moved = change(clutchAcc, c0);
    moved = wider(moved, change(ratchetAcc, r0)); moved = wider(moved, change(centreAcc, q0));
    moved = wider(moved, change(diffAcc[0], d0)); moved = wider(moved, change(diffAcc[1], d1));
    moved = wider(moved, change(brakeAcc[0], b0)); moved = wider(moved, change(brakeAcc[1], b1));
    moved = wider(moved, change(brakeAcc[2], b2)); moved = wider(moved, change(brakeAcc[3], b3));
    if (!(moved > SETTLED)) break;
  }

  // 6. Mid-shift the engine is brought to the speed the gear in hand wants (the old one in the first half, the new
  // one in the second), arriving as its phase ends: a rev-matched shift, with the driver's or the box's own hand.
  if (mode === SHIFT) {
    let target = 0;
    for (let i = 0; i < 4; i++) target += weight[i] * w[i];
    target *= G;
    const floor = electric ? 0 : e.idle;
    if (e.redline > floor && target > e.redline) target = e.redline;
    if (target < floor) target = floor;
    s.engineOmega = wE + (target - wE) * (shiftLeft > h ? h / shiftLeft : 1);
  }

  s.engineTorque = T;
  s.clutchTorque = mode === LOCK ? clutchAcc / h : mode === FLUID ? pump : mode === SHIFT ? hold * T : 0;
  s.clutchLocked = mode === LOCK && !(Math.abs(clutchAcc) >= limit * SATURATED) ? 1 : 0;
}

/* ------------------------------------------------------------------ the car's numbers, once a substep */

/** Fills the per-wheel inertia and radius scratch from the model. */
function wheelScratch(m: VehicleModel): void {
  const jf = m.wheelInertiaFront, jr = m.wheelInertiaRear;
  inertia[0] = jf; inertia[1] = jf; inertia[2] = jr; inertia[3] = jr;
  for (let i = 0; i < 4; i++) invJ[i] = inertia[i] > 0 ? 1 / inertia[i] : 0;
  radius[0] = m.tyreFront.radius; radius[1] = radius[0];
  radius[2] = m.tyreRear.radius; radius[3] = radius[2];
}

/** The front axle's share of the drive coming out of the gearbox: all of it, none of it, or the centre's split. */
function frontShare(d: DrivelineModel): number {
  if (d.layout === 'FWD') return 1;
  if (d.layout === 'RWD') return 0;
  const f = d.centre.frontShare;
  return f > 0 ? (f < 1 ? f : 1) : 0;
}

function isCvt(d: DrivelineModel): boolean { return d.transmission === 'cvt' || d.transmission === 'ecvt'; }

/** The clutch's (or lock-up clutch's) torque capacity, N m. */
function capacity(d: DrivelineModel): number { return d.clutchCapacity > 0 ? d.clutchCapacity : 0; }

/** Writes an output torque into the four wheels' drive by their weights, with the loss in the direction power flows. */
function spread(out: number, eff: number): void {
  for (let i = 0; i < 4; i++) drive[i] = out * weight[i] * eff;
}

/* ------------------------------------------------------------------ gear, ratio, shift */

/** The highest forward gear: a CVT and a single-speed have one forward "gear", whatever their ratio does. */
function topGear(d: DrivelineModel): number {
  return isCvt(d) ? 1 : d.gears.length;
}

/**
 * The signed ratio of a stepped gear: engine turns per turn of the final drive's input. Reverse is negative, so the
 * engine keeps turning forward while the wheels turn back; neutral is 0.
 */
function gearRatio(d: DrivelineModel, gear: number): number {
  const n = d.gears.length;
  if (gear === 0 || n === 0) return 0;
  if (gear < 0) return -(d.reverse > 0 ? d.reverse : d.gears[0]);
  return d.gears[(gear < n ? gear : n) - 1];
}

/**
 * Takes the gear wanted and runs the shift timer. A request while no shift is running starts one (or changes gear at
 * once when the box has no shift time); the gear and ratio change when half the time is left; a request mid-shift
 * waits for it to end. Neutral is the exception: the box has only to open its clutch, so it is taken at once, even
 * mid-shift (a shift into neutral would otherwise drive the wheels through the old gear for half its time). Leaves the
 * phase and the time left in it for the rest of the substep.
 */
function advanceGear(s: VehicleState, d: DrivelineModel, gearWanted: number, h: number): void {
  const top = topGear(d);
  let want = s.shiftTimer > 0 ? s.gearNext : s.gear;
  if (gearWanted !== AUTO_GEAR && gearWanted === gearWanted) {
    const g = Math.round(gearWanted);
    want = g < -1 ? -1 : g > top ? top : g;
  }
  shiftPhase = 0; shiftLeft = 0;
  if (want === 0) { s.gear = 0; s.gearNext = 0; s.shiftTimer = 0; return; }
  if (!(s.shiftTimer > 0)) {
    s.shiftTimer = 0;
    if (want !== s.gear && d.shiftTime > 0) { s.gearNext = want; s.shiftTimer = d.shiftTime; }
    else { s.gear = want; s.gearNext = want; return; }
  }
  const left = s.shiftTimer;
  const half = d.shiftTime > 0 ? 0.5 * d.shiftTime : 0;
  const slack = TIMER_SLACK * h;
  if (s.gear !== s.gearNext && left - h <= half + slack) s.gear = s.gearNext;
  if (s.gear !== s.gearNext) { shiftPhase = 1; shiftLeft = left - half; }
  else { shiftPhase = 2; shiftLeft = left; }
  s.shiftTimer = left - h > slack ? left - h : 0;
}

/** The engine's speed of peak power up to redline, rad/s, read off its full-throttle table. */
function powerPeakOmega(e: EngineModel): number {
  const dw = e.dOmega, last = e.n - 1;
  let top = dw > 0 ? Math.floor(e.redline / dw) : 0;
  if (top > last) top = last;
  let best = 0, at = e.redline;
  for (let i = 1; i <= top; i++) {
    const p = e.wot[i] * i * dw;
    if (p > best) { best = p; at = i * dw; }
  }
  return at;
}

/** The engine speed a CVT aims for: the power peak at full throttle, falling to 1.3 x idle as the throttle closes. */
function cvtTargetOmega(e: EngineModel, th: number): number {
  const floor = CVT_FLOOR_OVER_IDLE * e.idle;
  return floor + th * (powerPeakOmega(e) - floor);
}

/**
 * Moves a CVT's ratio, at up to cvtRatioRate, toward the one that puts the engine at its target speed at the present
 * wheel speed, within the box's range (gears = its two ends, in either order). From standstill that is the lowest
 * gearing; the ratio starts to move once the wheels are fast enough for the target.
 */
function cvtRatio(s: VehicleState, d: DrivelineModel, e: EngineModel, th: number, wd: number, h: number): void {
  const a = d.gears.length > 0 ? d.gears[0] : 0, b = d.gears.length > 1 ? d.gears[1] : a;
  const lo = a < b ? a : b, hi = a < b ? b : a;
  let r = s.ratio;
  // Coming out of neutral or reverse the box starts from its lowest gearing, as it would have rested there.
  if (!(r >= lo && r <= hi)) r = r > hi || !(r > 0) ? hi : lo;
  let want = hi;
  const fd = d.finalDrive;
  if (wd > 0 && fd > 0) {
    want = cvtTargetOmega(e, th) / (fd * wd);
    if (want > hi) want = hi; else if (want < lo) want = lo;
  }
  const step = d.cvtRatioRate > 0 ? d.cvtRatioRate * h : Infinity;
  s.ratio = want > r + step ? r + step : want < r - step ? r - step : want;
}

/* ------------------------------------------------------------------ clutch and converter */

/**
 * How far an automated clutch is closed, 0 to 1 (DESIGN.md 5.2). The bite speed is 1.15 x idle, or the launch speed
 * the driver holds if higher. It applies only to pulling away: below the road speed at which the lowest gear turns
 * the engine at the bite speed, the clutch closes with engine speed over the bite (fully a quarter of it higher, or
 * once the gear in hand turns the engine past that at the present wheel speed: taking the larger keeps it closed
 * through the moment the slipping clutch catches the wheels, rather than letting it snap open and shut there). Above
 * that road speed it is closed, whatever gear is in, so the launch speed a driver keeps set does not slip the clutch
 * after every shift. With the pedal up at a walk it opens.
 */
function autoEngagement(s: VehicleState, c: Controls, d: DrivelineModel, e: EngineModel, G: number, wd: number, rim: number, th: number): number {
  let bite = BITE_OVER_IDLE * e.idle;
  if (c.launchOmega > bite) bite = c.launchOmega;
  if (!(bite > 0)) return 1;   // an electric motor needs no clutch
  if (th <= THROTTLE_CLOSED && Math.abs(rim) < WALKING_PACE) return 0;
  // The road speed at which the lowest gearing (the largest ratio: a CVT lists its two ends in either order) turns the
  // engine at the bite speed, against the car's own speed over the ground, through the driven wheels' radius.
  let rd = 0;
  for (let i = 0; i < 4; i++) rd += weight[i] * radius[i];
  let low = 0;
  for (let i = 0; i < d.gears.length; i++) if (d.gears[i] > low) low = d.gears[i];
  const G1 = low * d.finalDrive;
  if (G1 > 0 && s.u * G1 >= bite * rd) return 1;
  const geared = G * wd;
  const speed = s.engineOmega > geared ? s.engineOmega : geared;
  const x = (speed - bite) / (ENGAGE_SPAN * bite);
  return x > 0 ? (x < 1 ? x : 1) : 0;
}

/** The torque the clutch can carry this substep, N m: capacity times how far it is closed; a direct drive, no limit. */
function clutchLimit(s: VehicleState, c: Controls, d: DrivelineModel, e: EngineModel, electric: boolean, G: number, wd: number, rim: number, th: number): number {
  const cap = capacity(d);
  let x: number;
  if (d.launch === 'direct') {
    if (electric || !(e.idle > 0)) return Infinity;
    // A combustion engine on a direct drive (a power-split hybrid's eCVT) cannot be held at the wheels' speed from
    // standstill: its motors let it slip as an automated clutch would.
    x = autoEngagement(s, c, d, e, G, wd, rim, th);
  } else if (c.autoClutch) {
    x = autoEngagement(s, c, d, e, G, wd, rim, th);
  } else {
    const pedal = c.clutch > 0 ? (c.clutch < 1 ? c.clutch : 1) : 0;
    x = 1 - pedal;
  }
  return x > 0 ? cap * x : 0;
}

/**
 * Whether a converter's lock-up clutch is closed this substep. It closes from lockGear up once the turbine runs near
 * the engine (speed ratio past couplingRatio), or, in a CVT, once the ratio starts to move (the turbine has reached the
 * engine's target speed); it stays closed until the turbine falls toward idle or the box drops below lockGear.
 */
function converterLocked(s: VehicleState, d: DrivelineModel, e: EngineModel, cv: NonNullable<DrivelineModel['converter']>, turbine: number, wE: number, th: number): boolean {
  if (!(s.gear > 0) || s.gear < cv.lockGear) return false;
  if (s.clutchLocked === 1) return turbine >= UNLOCK_OVER_IDLE * e.idle;
  if (!(turbine >= LOCK_OVER_IDLE * e.idle)) return false;
  if (wE > 0 && turbine > cv.couplingRatio * wE) return true;
  return isCvt(d) && turbine >= cvtTargetOmega(e, th);
}

/**
 * Torque the converter's pump takes from the engine, N m (DESIGN.md 5.2): k x engine^2 x (1 - speed ratio), with k
 * set so that at the stall speed it equals the engine's full-throttle torque there, so a stalled converter holds a
 * floored engine at stallOmega. Written as k x engine x (engine - turbine), it needs no division and turns negative
 * on the overrun, when the wheels drive the engine. A turbine turning backward counts as stalled.
 */
function pumpTorque(e: EngineModel, cv: NonNullable<DrivelineModel['converter']>, wE: number, turbine: number): number {
  const stall = cv.stallOmega;
  if (!(stall > 0) || !(wE > 0)) return 0;
  const atStall = engineTorque(e, stall, 1, 1);
  if (!(atStall > 0)) return 0;
  const t = turbine > 0 ? turbine : 0;
  return atStall / (stall * stall) * wE * (wE - t);
}

/** The converter's torque multiplication: torqueRatio at stall falling straight to 1 at the coupling point, 1 beyond. */
function torqueRatio(cv: NonNullable<DrivelineModel['converter']>, wE: number, turbine: number): number {
  const cr = cv.couplingRatio;
  if (!(wE > 0) || !(cr > 0)) return 1;
  const sr = turbine > 0 ? turbine / wE : 0;
  return sr < cr ? cv.torqueRatio + (1 - cv.torqueRatio) * sr / cr : 1;
}

/* ------------------------------------------------------------------ engine extras: nitrous, fuel */

/**
 * Nitrous torque this substep, N m, and the bottle it empties. Its power is power / speed, in proportion to the pedal
 * (a progressive controller), from the window switch up, cut with the engine's own limiter, and only while there is
 * nitrous left: the last substep's shot is what the bottle still holds.
 */
function nitrousTorque(s: VehicleState, c: Controls, e: EngineModel, th: number, wE: number, h: number): number {
  const n = s.model.nitrous;
  if (n === null || !c.nitrous || !(s.nitrousLeft > 0) || !(th > 0) || !(n.power > 0)) return 0;
  if (!(wE > 0) || !(wE >= NITROUS_WINDOW * e.redline)) return 0;
  let share = th;
  if (wE > e.redline) {
    const k = e.limiterBand > 0 ? 1 - (wE - e.redline) / e.limiterBand : 0;
    share *= k > 0 ? k : 0;
  }
  if (!(share > 0)) return 0;
  const use = n.flow * share * h;
  if (use >= s.nitrousLeft) { share *= s.nitrousLeft / use; s.nitrousLeft = 0; }
  else s.nitrousLeft -= use;
  return n.power * share / wE;
}

/**
 * Books the substep's fuel, kg (or an electric motor's shaft energy, J, negative while it regenerates). Fuel follows
 * air: indicated work (brake torque plus friction and pumping, which the fuel also pays for) over AIR_ENERGY is the
 * air the engine breathed, and a stoichiometric mixture burns a fourteen-point-seven-th of that in fuel.
 */
function bookEnergy(s: VehicleState, e: EngineModel, T: number, th: number, wE: number, h: number): void {
  if (!(wE > 0)) return;
  if (e.kind === 'electric') { s.energyUsed += T * wE * h; return; }
  const pumping = PUMPING_MEP * e.displacement / FOUR_PI;
  const indicated = T + tableAt(e.friction, e.dOmega, wE) + pumping * (1 - th);
  if (indicated > 0) s.energyUsed += indicated * wE * h / (AIR_ENERGY * STOICHIOMETRIC);
}

/* ------------------------------------------------------------------ the constraints */

/**
 * The clutch: engine speed = G x the driven wheels' weighted mean speed. Its impulse L (N m s at the engine) takes
 * L / Ie off the engine and gives each driven wheel G x weight x L x eff / J, where eff is the efficiency while the
 * engine drives and its inverse on the overrun, so the box loses power whichever way it flows. Because eff changes at
 * L = 0 the solve is piecewise: if the step would carry L across zero, the rest of it is solved on the other side.
 */
function solveClutch(s: VehicleState, G: number, invIe: number, eta: number, limit: number): void {
  const w = s.wheelOmega;
  const wd = weight[0] * w[0] + weight[1] * w[1] + weight[2] * w[2] + weight[3] * w[3];
  const C = s.engineOmega - G * wd;
  // A held wheel does not move under the clutch (its brake takes the push), so it adds nothing to the give.
  let sumW2 = 0;
  for (let i = 0; i < 4; i++) sumW2 += weight[i] * weight[i] * loose(i);
  const g2 = G * G * sumW2;
  const kDrive = invIe + g2 * eta, kOver = invIe + g2 / eta;
  if (!(kDrive > 0)) return;
  const old = clutchAcc;
  let next: number;
  if (old > 0 || (old === 0 && C >= 0)) {
    next = old + C / kDrive;
    if (next < 0) next = (C + old * kDrive) / kOver;
  } else {
    next = old + C / kOver;
    if (next > 0) next = (C + old * kOver) / kDrive;
  }
  if (next > limit) next = limit; else if (next < -limit) next = -limit;
  s.engineOmega -= (next - old) * invIe;
  const dw = G * (next * (next >= 0 ? eta : 1 / eta) - old * (old >= 0 ? eta : 1 / eta));
  for (let i = 0; i < 4; i++) w[i] += dw * weight[i] * invJ[i];
  clutchAcc = next;
  for (let i = 0; i < 4; i++) if (weight[i] > 0) rehold(w, i);
}

/**
 * A combustion engine cannot be turned backward: when something drags it below zero it stops there and the stopped
 * engine holds (the clutch then slips at its limit or holds the wheels). One-sided, so it never pulls the engine down.
 */
function solveRatchet(s: VehicleState, invIe: number): void {
  if (!(invIe > 0)) return;
  const want = ratchetAcc - s.engineOmega / invIe;
  if (want > 0) { s.engineOmega = 0; ratchetAcc = want; return; }
  s.engineOmega -= ratchetAcc * invIe;
  ratchetAcc = 0;
}

/**
 * Torque going into an axle's differential this substep, N m (its size): the clutch's (or converter's, or shift's)
 * share for that axle, plus what the centre coupling moves into or out of it. A limited-slip locks in proportion.
 */
function axleTorque(a: number, mode: number, G: number, eta: number, front: number, coupled: boolean, h: number): number {
  let t: number;
  if (mode === LOCK) t = clutchAcc / h * G * (clutchAcc >= 0 ? eta : 1 / eta) * (a === 0 ? front : 1 - front);
  else t = drive[2 * a] + drive[2 * a + 1];
  // The coupling's impulse is a force at the road (solveCentre): times each axle's radius, the torque it moves.
  if (coupled) t += a === 0 ? -centreAcc * radius[0] / h : centreAcc * radius[2] / h;
  return t < 0 ? -t : t;
}

/**
 * The most torque a differential can hold between its two wheels, N m: none when open, without limit when locked,
 * preload plus lockPerTorque x the torque through it for a limited-slip or active one (lockPerTorque 0.25 is a torque
 * bias ratio of 1.25 / 0.75 = 1.67).
 */
function diffLock(diff: DiffModel, axle: number): number {
  if (diff.kind === 'open') return 0;
  if (diff.kind === 'locked') return Infinity;
  const t = diff.preload + diff.lockPerTorque * axle;
  return t > 0 ? t : 0;
}

/**
 * A differential's lock: left speed = right speed. Its impulse P is the torque difference it makes between the two
 * wheels (half taken from the faster, half given to the slower), so that the limit is the locking torque itself.
 */
function solveDiff(w: Float64Array, a: number, limit: number): void {
  const l = 2 * a, r = l + 1;
  const k = 0.5 * (loose(l) + loose(r));
  if (!(k > 0)) return;
  const old = diffAcc[a];
  let next = old + (w[l] - w[r]) / k;
  if (next > limit) next = limit; else if (next < -limit) next = -limit;
  const half = 0.5 * (next - old);
  w[l] -= half * invJ[l];
  w[r] += half * invJ[r];
  diffAcc[a] = next;
  rehold(w, l); rehold(w, r);
}

/**
 * The centre coupling: the front axle's mean road speed (wheel speed x loaded radius) = the rear axle's, as a
 * transfer case geared to the car's own tyres keeps them (a car with smaller rear tyres has its gearing matched to
 * them; locking spin speeds instead would wind the two axles up against each other). Its impulse P is a force at the
 * road, N s, moved from the front axle to the rear (negative: rear to front), shared equally between each axle's
 * wheels, up to the coupling's torque at the axle it feeds over that axle's radius.
 */
function solveCentre(w: Float64Array, limit: number): void {
  const rf = radius[0], rr = radius[2];
  const k = 0.25 * (rf * rf * (loose(0) + loose(1)) + rr * rr * (loose(2) + loose(3)));
  if (!(k > 0)) return;
  const old = centreAcc;
  let next = old + (0.5 * rf * (w[0] + w[1]) - 0.5 * rr * (w[2] + w[3])) / k;
  if (next > limit) next = limit; else if (next < -limit) next = -limit;
  const half = 0.5 * (next - old);
  w[0] -= half * rf * invJ[0]; w[1] -= half * rf * invJ[1];
  w[2] += half * rr * invJ[2]; w[3] += half * rr * invJ[3];
  centreAcc = next;
  for (let i = 0; i < 4; i++) rehold(w, i);
}

/** A wheel its brake holds still: the brake has stopped it and has torque to spare, so a push moves it nowhere. */
function heldStill(i: number): boolean {
  const lim = brakeLim[i];
  return lim > 0 && (brakeAcc[i] < 0 ? -brakeAcc[i] : brakeAcc[i]) < lim * SATURATED;
}

/**
 * How freely wheel i turns under the other constraints, 1 / kg m^2: its inverse inertia, or 0 while its brake holds
 * it. Treating a held wheel as immovable, and handing each push on it to its brake at once (rehold), is what lets a
 * locked centre, an open differential and the brakes agree in a few passes instead of trading a residual for ever.
 */
function loose(i: number): number { return heldStill(i) ? 0 : invJ[i]; }

/** Gives the push a constraint has just put on a held wheel to its brake, which stops the wheel again up to its torque. */
function rehold(w: Float64Array, i: number): void {
  if (heldStill(i)) solveBrake(w, i, brakeLim[i]);
}

// How far an accumulated impulse moved in a pass, and the larger of two such moves (a NaN stays a NaN, which ends the
// passes rather than running them all on garbage).
function change(a: number, b: number): number { return a > b ? a - b : b - a; }
function wider(a: number, b: number): number { return b > a || b !== b ? b : a; }

/**
 * A brake: wheel speed = 0, up to its torque. When the brake can hold, the wheel is set to exactly zero (not
 * nearly: a held wheel must not creep), so a locked wheel stays locked and a car held on the brakes does not move.
 */
function solveBrake(w: Float64Array, i: number, limit: number): void {
  if (!(invJ[i] > 0)) return;
  const old = brakeAcc[i];
  const want = old + w[i] * inertia[i];
  if (want <= limit && want >= -limit) { brakeAcc[i] = want; w[i] = 0; return; }
  const next = want > 0 ? limit : -limit;
  w[i] -= (next - old) * invJ[i];
  brakeAcc[i] = next;
}
