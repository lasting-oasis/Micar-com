// The car's own electronics (DESIGN.md section 6, and "Shifting" in 5.2): traction control, stability control, the
// speed governor, and the shift logic of a car that chooses its own gears. Each acts only when the car has it and
// the driver leaves it on. Everything but prepareShiftPoints runs inside the step: plain arithmetic, nothing
// allocated (the shift points are worked out once per model and kept in a module-level WeakMap).
import type { Controls, EngineModel, VehicleModel, VehicleState } from './types';
import { AUTO_GEAR } from './types';
import { G, tableAt } from './math';
import { wheelRoadSpeed } from './brakes';
import { cornerStiffness, peakSlipRatio, tyreMuX, tyreMuY } from './tyre';

/* ------------------------------------------------------------------ traction control */

/** Traction control cuts the throttle while a driven wheel's slip is beyond this many peak slips... */
export const TCS_CUT_SLIP = 1.3;
/** ...and gives it back once every driven wheel is within the peak again. Between the two the cut holds. */
export const TCS_RESTORE_SLIP = 1;
/** Time constant of the cut, s: fast, as an ignition and throttle cut is. */
export const TCS_CUT_TAU = 0.05;
/** Time constant of giving the throttle back, s: slower, so the wheels do not flare again at once. */
export const TCS_RESTORE_TAU = 0.15;
/**
 * Road speed, m/s, below which wheelspin is judged against this speed instead of the road's: pulling away there is
 * no road speed to take a ratio of, so about 0.15 m/s of wheel speed over the road is let through at a standstill.
 */
export const TCS_SLIP_FLOOR = 1;

/**
 * The brake half of traction control (the "brake-based" or "electronic differential lock" action every system since
 * Bosch's ASR has had, and most cars keep with stability control switched off): a driven wheel spinning past this many
 * peak slips, and past its partner on the axle, is braked, so that the differential sends the torque its brake holds
 * to the partner. It acts before the engine half (TCS_CUT_SLIP), so a single spinning wheel is mostly caught by the
 * brake and the cut that follows is later and shallower (DESIGN.md 6).
 */
export const TCS_BRAKE_SLIP = 1.15;
/** The brake's aim grows with the spin beyond TCS_BRAKE_SLIP and reaches the partner's whole grip torque this many peak slips further on. */
export const TCS_BRAKE_SPAN = 1;
/** Time constant of the brake pressure the hydraulic unit builds and releases, s. */
export const TCS_BRAKE_TAU = 0.05;
// Below this many N m with nothing asked, the brake is released: the return is asymptotic and "off" must be exact.
const TCS_BRAKE_ZERO = 0.5;

// A share this close to 1 is 1: the return is asymptotic and "not acting" must be reachable exactly.
const FULL = 0.999;

function approach(x: number, target: number, h: number, tau: number): number {
  const k = h / tau;
  return (x + target * k) / (1 + k);
}

/**
 * How far wheel i spins beyond the road under it, m/s, in the direction its gear drives. The unit reads wheelspin as a
 * real one does, from the wheel's speed against the road under it: the tyre's own slip state lags that by its
 * relaxation length and stops counting at three peaks, so a unit that read it would go on acting long after the wheel
 * had stopped spinning.
 */
function spinSpeed(s: VehicleState, i: number, dir: number): number {
  const tyre = i < 2 ? s.model.tyreFront : s.model.tyreRear;
  return dir * (s.wheelOmega[i] * tyre.radius - wheelRoadSpeed(s, i));
}

/** The spin speed, m/s, at which wheel i's tyre gives its peak drive: its peak slip on this surface times the road speed (at least TCS_SLIP_FLOOR). */
function peakSpinSpeed(s: VehicleState, i: number, grip: number): number {
  const tyre = i < 2 ? s.model.tyreFront : s.model.tyreRear;
  let peak = peakSlipRatio(tyre, s.wheelLoad[i], grip);
  if (peak < 1e-6) peak = 1e-6;
  const road = wheelRoadSpeed(s, i);
  const size = road < 0 ? -road : road;
  return peak * (size > TCS_SLIP_FLOOR ? size : TCS_SLIP_FLOOR);
}

/**
 * Brakes driven wheel i while it turns faster than its partner on the axle and spins past TCS_BRAKE_SLIP of its own
 * peak (spin speeds d, peak spin speed p, m/s), moving the torque held toward the aim with the pump's time constant,
 * never past full pedal pressure; adds it to s.wheelBrake. It compares the two wheels' speeds, as the wheel-speed
 * sensors of a real unit do: two wheels a limited-slip differential holds together are not braked against each other
 * because one of them is on a slippery patch.
 */
function brakeSpin(s: VehicleState, i: number, dOwn: number, pOwn: number, dOther: number, grip: Float64Array, h: number): void {
  const m = s.model, o = i ^ 1, front = i < 2;
  const tyre = front ? m.tyreFront : m.tyreRear;
  const floor = TCS_BRAKE_SLIP * pOwn;
  const excess = (dOwn - (dOther > floor ? dOther : floor)) / pOwn;
  let aim = 0;
  if (excess > 0) {
    const fz = s.wheelLoad[o];
    const partner = fz > 0 ? tyreMuX(tyre, fz, grip[o]) * fz * tyre.radius : 0;
    aim = (excess < TCS_BRAKE_SPAN ? excess / TCS_BRAKE_SPAN : 1) * partner;
  }
  let held = approach(s.tcsBrake[i], aim, h, TCS_BRAKE_TAU);
  if (aim === 0 && held < TCS_BRAKE_ZERO) held = 0;
  const pump = (front ? m.brakes.maxTorqueFront : m.brakes.maxTorqueRear) - s.wheelBrake[i];
  if (held > pump) held = pump > 0 ? pump : 0;
  s.tcsBrake[i] = held;
  s.wheelBrake[i] += held;
}

/**
 * Traction control. Its brake half (brakeSpin) brakes a driven wheel that turns faster than its partner on an axle
 * whose differential can send torque across, once it spins past 1.15 times its tyre's peak slip. Its engine half returns the throttle multiplier, 0 to 1: while a driven wheel
 * spins past 1.3 times its tyre's peak slip the cut deepens (0.05 s) toward the share that would bring that wheel back
 * to the peak; once every driven wheel is back within the peak the throttle is given back (0.15 s). The engine half
 * watches the worst wheel even while the brake works on it: an open differential sends the torque to the wheel that
 * spins, and a brake alone, by sending more to the wheel that grips, can push a car at its cornering limit into a
 * power slide. Off, or not fitted, it returns 1 and brakes nothing. Keeps its memory in s.tcsCut and s.tcsBrake, and
 * sets s.tcsActive while either half is acting.
 */
export function tractionControl(s: VehicleState, c: Controls, grip: Float64Array, h: number): number {
  const m = s.model;
  if (!(m.systems.tcs && c.tcs)) {
    s.tcsCut = 1; s.tcsActive = 0;
    for (let i = 0; i < 4; i++) s.tcsBrake[i] = 0;
    return 1;
  }
  const layout = m.driveline.layout;
  const dir = s.gear < 0 ? -1 : 1;
  let worst = 0, braking = 0;
  for (let axle = 0; axle < 2; axle++) {
    const i = 2 * axle, j = i + 1;
    if ((axle === 0 && layout === 'RWD') || (axle === 1 && layout === 'FWD')) { s.tcsBrake[i] = 0; s.tcsBrake[j] = 0; continue; }
    const di = spinSpeed(s, i, dir), dj = spinSpeed(s, j, dir);
    const pi = peakSpinSpeed(s, i, grip[i]), pj = peakSpinSpeed(s, j, grip[j]);
    // The engine half judges each wheel against its own tyre's peak.
    if (di / pi > worst) worst = di / pi;
    if (dj / pj > worst) worst = dj / pj;
    if ((axle === 0 ? m.driveline.diffFront : m.driveline.diffRear).kind === 'locked') {
      // A locked axle turns both wheels together: braking one only fights the engine.
      s.tcsBrake[i] = 0; s.tcsBrake[j] = 0;
    } else {
      brakeSpin(s, i, di, pi, dj, grip, h);
      brakeSpin(s, j, dj, pj, di, grip, h);
      if (s.tcsBrake[i] > 0 || s.tcsBrake[j] > 0) braking = 1;
    }
  }
  let cut = s.tcsCut;
  if (worst > TCS_CUT_SLIP) {
    // Past the peak, the slip a wheel runs at grows with the torque it is given beyond what the tyre holds; scaling
    // the cut by peak / slip aims it at the torque the tyre can hold. The aim moves as the slip falls, so the cut
    // stops deepening as soon as the wheel is back near the peak, and holds there.
    cut = approach(cut, cut / worst, h, TCS_CUT_TAU);
  } else if (worst < TCS_RESTORE_SLIP) {
    cut = approach(cut, 1, h, TCS_RESTORE_TAU);
  }
  if (cut > FULL) cut = 1;
  s.tcsCut = cut;
  s.tcsActive = (cut < 1 && c.throttle > 0) || braking === 1 ? 1 : 0;
  return cut;
}

/* ------------------------------------------------------------------ stability control */

/** Stability control works only above this speed, m/s: below it a yaw-rate target from the steering means little and the car cannot spin. */
export const ESC_MIN_SPEED = 5;
/** The yaw target never asks for more than this share of what the tyres can hold sideways. */
export const ESC_LIMIT_SHARE = 0.9;
/** Yaw-rate error, rad/s, the system lets go before it brakes a wheel (about 3 deg/s)... */
export const ESC_BAND = 0.05;
/** ...plus this share of the target, so brisk driving is left alone. */
export const ESC_BAND_SHARE = 0.1;
/** The braking yaw moment is sized to take the error beyond the band out in this many seconds. */
export const ESC_TAU = 0.25;

/**
 * Stability control: compares the yaw rate with the one the steering asks for (a steady-state bicycle model with the
 * car's own understeer, never more than its tyres can hold) and, when the car rotates too much, brakes the outer
 * front wheel; when it rotates too little, the inner rear. The torque grows with the error beyond a band and is
 * added to s.wheelBrake, never more than that wheel's tyre has left after cornering. Sets s.escActive.
 */
export function stabilityControl(s: VehicleState, c: Controls, grip: Float64Array, _h: number): void {
  s.escActive = 0;
  const m = s.model;
  if (!(m.systems.esc && c.esc)) return;
  const u = s.u;
  if (!(u > ESC_MIN_SPEED)) return;
  const ch = m.chassis, L = ch.a + ch.b;

  // The car's own understeer gradient, rad per m/s^2, from its tyres' cornering stiffness at the static loads:
  // K = m / L (b / C_front - a / C_rear). The reference never oversteers: no stability system aims at a spin.
  const fzFront = 0.5 * ch.mass * G * ch.b / L, fzRear = 0.5 * ch.mass * G * ch.a / L;
  const cFront = 2 * cornerStiffness(m.tyreFront, fzFront), cRear = 2 * cornerStiffness(m.tyreRear, fzRear);
  let kus = cFront > 0 && cRear > 0 ? (ch.mass / L) * (ch.b / cFront - ch.a / cRear) : 0;
  if (kus < 0) kus = 0;
  const steer = 0.5 * (s.wheelSteer[0] + s.wheelSteer[1]);
  let target = u * steer / (L + kus * u * u);

  // What the tyres can hold sideways on this surface with these loads (downforce included): sum of mu Fz over m.
  let sideways = 0;
  for (let k = 0; k < 4; k++) {
    const fz = s.wheelLoad[k];
    if (fz > 0) sideways += tyreMuY(k < 2 ? m.tyreFront : m.tyreRear, fz, grip[k]) * fz;
  }
  if (!(sideways > 0)) return; // in the air: braking a wheel turns nothing
  const rMax = ESC_LIMIT_SHARE * sideways / (ch.mass * u);
  if (target > rMax) target = rMax; else if (target < -rMax) target = -rMax;

  const err = s.r - target;
  const excess = Math.abs(err) - (ESC_BAND + ESC_BAND_SHARE * Math.abs(target));
  if (!(excess > 0)) return;
  // err > 0: the car yaws too far left, so it needs a moment to the right, which braking a right-hand wheel gives.
  // Rotating more than wanted the way it already turns is oversteer: brake the front (which also eases the front
  // tyre's grip on the line). Rotating less is understeer: brake the rear, which the front tyres then turn about.
  const toRight = err > 0;
  const oversteer = err * s.r > 0;
  const i = oversteer ? (toRight ? 1 : 0) : (toRight ? 3 : 2);
  const front = i < 2;
  const tyre = front ? m.tyreFront : m.tyreRear;
  const halfTrack = 0.5 * (front ? ch.trackFront : ch.trackRear);
  // Torque whose force at the road, acting half a track out, makes the yaw moment that removes the excess in ESC_TAU.
  let add = ch.izz * excess / ESC_TAU / halfTrack * tyre.radius;
  // The pump can raise one caliper to full pedal pressure, no further...
  const pump = (front ? m.brakes.maxTorqueFront : m.brakes.maxTorqueRear) - s.wheelBrake[i];
  if (add > pump) add = pump;
  // ...and the system never asks a tyre for more braking than the grip it has left after cornering (the friction
  // ellipse): a wheel pushed past its peak would lose its side grip too and the correction with it.
  const fz = s.wheelLoad[i];
  if (!(fz > 0)) return;
  const muY = tyreMuY(tyre, fz, grip[i]);
  const lateral = muY > 0 ? s.wheelFy[i] / (muY * fz) : 1;
  const left = 1 - lateral * lateral;
  const spare = left > 0 ? muY * tyre.muXRatio * fz * Math.sqrt(left) * tyre.radius - s.wheelBrake[i] : 0;
  if (add > spare) add = spare;
  if (!(add > 0)) return;
  s.wheelBrake[i] += add;
  s.escActive = 1;
}

/* ------------------------------------------------------------------ the governor */

/**
 * The governor fades the throttle out over this many m/s, centred on the limited speed. A governor regulates to its
 * set speed: with the whole fade below it, a car settled short of it by as much of the band as the throttle it needed
 * (1.2 to 1.8 mph for a car governed at 80 to 95% of its flat-out speed); centred, it settles within a few tenths of a
 * m/s either side, as real ones do.
 */
export const LIMITER_BAND = 1;

/** The speed governor: the throttle multiplier, 1 up to half a band below the car's limited speed, falling straight to 0 half a band above it. Sets s.limiterActive. */
export function limiterCut(s: VehicleState): number {
  let share = (s.model.systems.limiterSpeed + 0.5 * LIMITER_BAND - s.u) / LIMITER_BAND;
  share = share > 1 ? 1 : share > 0 ? share : 0;
  s.limiterActive = share < 1 ? 1 : 0;
  return share;
}

/* ------------------------------------------------------------------ the shift logic */

/** Kicks down when the lower gear would put the engine below this share of that gear's shift point. */
export const DOWNSHIFT_SHARE = 0.85;
/**
 * The most driven-wheel slip the shift logic takes at face value; past it (or past the tyre's own peak, if lower) a
 * wheel counts at road speed. It keeps 1 / (1 + cap) above DOWNSHIFT_SHARE, so that a change up made with the wheels
 * at the cap never asks for the gear back.
 */
export const SHIFT_SLIP_CAP = 0.15;
/** At a light throttle a gear is changed up so the next one lands the engine at this many times idle. */
export const LIGHT_LAND = 1.75;
/** Throttle at or below which the light-throttle points apply; between it and FULL_THROTTLE the points move in proportion. */
export const LIGHT_THROTTLE = 0.1;
/** Throttle at or above which the full-throttle shift points apply. */
export const FULL_THROTTLE = 0.9;

/**
 * A gearbox controller reads the pedal through a filter, not as it stands: a press counts within about this many
 * seconds (a stamp still kicks down at once, as a driver expects)...
 */
export const SHIFT_PEDAL_RISE = 0.1;
/**
 * ...and a lift only after about this many. A driver feeding the pedal in and out for wheelspin, or easing it through
 * a corner exit, is still asking for all the car has; read as it stands, each dip moved the shift points down to the
 * light-throttle ones and each return moved them back, so the box changed up on the dip and kicked down on the return
 * (the proof sedan went 1-4-1-4-1-5 on a launch). A lift held for good still reads as a light throttle within a few
 * seconds, and the box changes up early as it should.
 */
export const SHIFT_PEDAL_FALL = 1.5;

/**
 * The pedal as the gearbox controller reads it after h more seconds of the driver's pedal (clamped to 0 to 1), from
 * what it read before: a first-order lag, quick to follow a press and slow to follow a lift. Implicit, so it is the
 * same filter at any substep. vehicle.ts keeps it for each car and hands autoShift this, not the raw pedal.
 */
export function shiftPedalStep(read: number, pedal: number, h: number): number {
  const p = pedal > 0 ? (pedal < 1 ? pedal : 1) : 0;
  const k = h / (p > read ? SHIFT_PEDAL_RISE : SHIFT_PEDAL_FALL);
  return (read + p * k) / (1 + k);
}

// Per model: the full-throttle up-shift speed of each gear, then the light-throttle one, rad/s (2n numbers).
const SHIFT_POINTS = new WeakMap<VehicleModel, Float64Array>();

function choosesRatio(model: VehicleModel): boolean {
  const t = model.driveline.transmission;
  return t === 'cvt' || t === 'ecvt' || t === 'single-speed';
}

// The engine speed, at most redline, of the most power on the full-throttle curve.
function powerPeakOmega(e: EngineModel): number {
  let best = 0, at = e.redline;
  for (let i = 1; i < e.n; i++) {
    const w = i * e.dOmega;
    if (w > e.redline) break;
    const p = e.wot[i] * w;
    if (p > best) { best = p; at = w; }
  }
  const atRedline = tableAt(e.wot, e.dOmega, e.redline) * e.redline;
  return atRedline > best ? e.redline : at;
}

// Engine speed in a gear at which the next gear (k = its ratio over this one's, under 1) gives as much wheel torque:
// T(w) = k T(k w), the same as equal power at the same road speed. Above the power peak, where the search starts,
// this gear's power falls as the next one's rises, so the first crossing is the point. Redline if there is none.
function crossover(e: EngineModel, k: number, from: number): number {
  const step = e.dOmega / 8;
  if (!(step > 0)) return e.redline;
  let lo = from;
  if (tableAt(e.wot, e.dOmega, lo) - k * tableAt(e.wot, e.dOmega, k * lo) <= 0) return lo;
  for (let w = from + step; ; w += step) {
    let hi = w < e.redline ? w : e.redline;
    if (tableAt(e.wot, e.dOmega, hi) - k * tableAt(e.wot, e.dOmega, k * hi) <= 0) {
      for (let j = 0; j < 50; j++) {
        const mid = 0.5 * (lo + hi);
        if (tableAt(e.wot, e.dOmega, mid) - k * tableAt(e.wot, e.dOmega, k * mid) <= 0) hi = mid; else lo = mid;
      }
      return hi;
    }
    if (hi >= e.redline) return e.redline;
    lo = hi;
  }
}

function computeShiftPoints(model: VehicleModel): Float64Array {
  const e = model.engine, gears = model.driveline.gears, n = gears.length;
  const points = new Float64Array(2 * n);
  const geared = !choosesRatio(model);
  const peak = powerPeakOmega(e);
  for (let g = 1; g <= n; g++) {
    let full = e.redline, light = e.redline;
    const k = g < n ? gears[g] / gears[g - 1] : 0;
    if (geared && k > 0 && k < 1) {
      full = crossover(e, k, peak);
      light = LIGHT_LAND * e.idle / k;
      if (light > full) light = full;
    }
    points[g - 1] = full;
    points[n + g - 1] = light;
  }
  return points;
}

// The points for a model outside the step: worked out and kept on first use if it was never prepared.
function pointsFor(model: VehicleModel): Float64Array {
  let points = SHIFT_POINTS.get(model);
  if (points === undefined) {
    points = computeShiftPoints(model);
    SHIFT_POINTS.set(model, points);
  }
  return points;
}

/** Whether a model's shift points have been worked out (createState and prepareShiftPoints do it, outside the step). */
export function hasShiftPoints(model: VehicleModel): boolean {
  return SHIFT_POINTS.has(model);
}

/**
 * Works out, once for a model and outside the step, where its gearbox changes up: at full throttle, the engine speed
 * at which the next gear gives more wheel torque (read off the engine's full-throttle table; never past redline),
 * and at a light throttle, early enough that the next gear lands the engine at 1.75 times idle. Call it again after
 * changing the model's gears or engine tables.
 */
export function prepareShiftPoints(model: VehicleModel): void {
  SHIFT_POINTS.set(model, computeShiftPoints(model));
}

/** The engine speed, rad/s, at which the car changes up from this gear at full throttle. Redline for the top gear, for a gear it does not have, and for a car without gears to change. */
export function shiftUpOmega(model: VehicleModel, gear: number): number {
  const n = model.driveline.gears.length, g = Math.round(gear);
  if (!(g >= 1 && g <= n)) return model.engine.redline;
  return pointsFor(model)[g - 1];
}

/**
 * The gear the car wants. A request through the controls is taken as it is (a cvt, ecvt or single-speed car has
 * only drive, neutral and reverse), except that a box other than a manual will not go into a gear that would turn
 * the engine past redline at the present speed: it goes as far down as it can and takes the rest as the car slows. Left to the car (AUTO_GEAR): up once the engine reaches the shift point for the
 * throttle (full throttle: where the next gear pulls harder; light throttle: early), down when the lower gear would
 * still sit below 85% of its own point, so a stamp on the pedal kicks down as far as it usefully can and, at a steady
 * throttle, a gear just changed up from is not wanted back. The speed it judges by is the driven wheels', except that
 * a wheel spinning or locked past its tyre's peak counts at the road's speed: wheelspin neither changes it up early
 * nor, as the wheels catch the road in the shift, back down; locked wheels do not drop it to first. Always a forward
 * gear the box has, and while a shift is under way, the gear being shifted to.
 */
export function autoShift(s: VehicleState, c: Controls): number {
  const model = s.model, d = model.driveline, n = d.gears.length;
  const asked = c.gear;
  if (choosesRatio(model)) return asked === -1 || asked === 0 ? asked : 1;
  if (asked !== AUTO_GEAR) {
    const g = Math.round(asked);
    if (g > n) return n;
    if (g < -1) return -1;
    if (!(g >= -1)) return 0; // not a number: neutral
    // A manual gives the driver the gear asked for, money shift and all. Any other box is shifted by its own
    // controller, which refuses a gear that would turn the engine past redline at the present speed and goes only as
    // far down as it can, taking the rest as the car slows (an unlocked converter would otherwise drag the engine to
    // two or three times its redline).
    if (g >= 1 && d.transmission !== 'manual') {
      const shaft = shaftSpeed(s), red = model.engine.redline;
      let k = g;
      while (k < n && d.gears[k - 1] * shaft > red) k++;
      return k;
    }
    return g;
  }
  if (s.shiftTimer > 0 && s.gearNext >= 1 && s.gearNext <= n) return s.gearNext;

  // Worked out outside the step (createState prepares them). A model met here unprepared is not worked out here,
  // which would allocate inside the step: it changes up at redline (upPoint) until it is prepared.
  const points = SHIFT_POINTS.get(model);
  // Speed of the gearbox's output, as the final drive turns it: the mean of the driven wheels. A driven wheel slipping
  // past its tyre's peak (spinning, or locked under the brakes) says nothing about the road speed the box should choose
  // a gear for, so it counts at the speed of the road under it instead; a box that read it would change up at walking
  // pace on a spinning wheel and back down as the wheels caught the road in the shift. Within the peak the wheel speed
  // itself counts, so a gear held to redline can still be left. The shift logic has no grip to hand, so the peak on a
  // dry road stands in (the highest it can be: less grip only lowers it).
  const shaft = shaftSpeed(s);

  let t = (c.throttle - LIGHT_THROTTLE) / (FULL_THROTTLE - LIGHT_THROTTLE);
  t = t > 1 ? 1 : t > 0 ? t : 0;
  let g = s.gear < 1 ? 1 : s.gear > n ? n : s.gear;
  // Up as far as the speed asks (an automatic skips gears when it has to), then down as far as there is room.
  // Whatever this returns, asked again in that gear it returns the same: the down test looks at the gear below
  // against 85% of its own point, which the up test has just left behind.
  const red = model.engine.redline;
  while (g < n && d.gears[g - 1] * shaft >= upPoint(points, red, n, g, t)) g++;
  while (g > 1 && d.gears[g - 2] * shaft < DOWNSHIFT_SHARE * upPoint(points, red, n, g - 1, t)) g--;
  return g;
}

/** The gearbox's output speed as the shift logic counts it, rad/s: the final drive times the driven wheels' mean (shiftWheelSpeed). */
function shaftSpeed(s: VehicleState): number {
  const d = s.model.driveline, layout = d.layout;
  const first = layout === 'RWD' ? 2 : 0, last = layout === 'FWD' ? 1 : 3;
  let wheels = 0;
  for (let i = first; i <= last; i++) wheels += shiftWheelSpeed(s, i);
  return d.finalDrive * wheels / (last - first + 1);
}

/**
 * Driven wheel i's speed as the shift logic counts it, rad/s: its own while its slip is within the tyre's peak, the
 * road's under it once past (either way). The peak is capped at SHIFT_SLIP_CAP so that a gear changed up from at its
 * point lands the next one above the kick-down share (1 / (1 + 0.15) = 0.87 > 0.85): no hunting at the boundary.
 */
function shiftWheelSpeed(s: VehicleState, i: number): number {
  const tyre = i < 2 ? s.model.tyreFront : s.model.tyreRear;
  const road = wheelRoadSpeed(s, i), size = road < 0 ? -road : road;
  let peak = peakSlipRatio(tyre, s.wheelLoad[i], 1);
  if (!(peak < SHIFT_SLIP_CAP)) peak = SHIFT_SLIP_CAP;
  const slip = (s.wheelOmega[i] * tyre.radius - road) / (size > TCS_SLIP_FLOOR ? size : TCS_SLIP_FLOOR);
  return slip > peak || slip < -peak ? road / tyre.radius : s.wheelOmega[i];
}

// The engine speed to change up from gear g at throttle share t (0 light, 1 full); redline without prepared points.
function upPoint(points: Float64Array | undefined, redline: number, n: number, g: number, t: number): number {
  if (points === undefined) return redline;
  const light = points[n + g - 1];
  return light + (points[g - 1] - light) * t;
}
