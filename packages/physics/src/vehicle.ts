// The whole car (DESIGN.md section 2). createVehicle sets a car down at rest; step advances it 1/120 s as four
// substeps in which every part moves together in a fixed order: the controls reach the wheels, the air and the loads
// are worked out, each tyre makes its force, the brakes and the car's own systems act, the driveline turns the engine
// and the wheels, the body moves, the suspension follows, and the tyres' slip states catch up with what happened.
// Beside it: telemetry for the game and the bench, an impulse for collisions, and a hash of the whole state that
// replays, ghosts and server re-runs compare.
//
// The step allocates nothing. It works in module-level scratch that every substep overwrites before it reads, so it
// is not re-entrant, which costs nothing: JavaScript runs one car's step at a time.
import type { Controls, SurfaceSample, Telemetry, TyreParams, VehicleModel, VehicleState, WorldQuery } from './types';
import type { AeroOut } from './aero';
import type { TyreOut } from './tyre';
import { aeroForces, roadLoad } from './aero';
import { brakeTorques } from './brakes';
import { staticLoads, steerAngles, suspensionStep, wheelLoads } from './chassis';
import { drivelineStep, surfaceRolling } from './driveline';
import { G, HASH_START, datan, datan2, dcos, dsin, hashNumber } from './math';
import { createState } from './state';
import { autoShift, limiterCut, stabilityControl, tractionControl } from './systems';
import { elasticShare, lowSpeedDamping, lowSpeedFade, maxDeflectionX, maxDeflectionY, peakSlipRatio, peakSlipTan, relaxStep, tyreForces, tyreMuY } from './tyre';
import { RPM } from './units';

/** Seconds one step advances the car: 120 steps a second, the game's own rate. */
export const STEP = 1 / 120;
/** Substeps in a step: tyres, wheels, driveline and body all run at 480 Hz. */
export const SUBSTEPS = 4;
// stepWith's ceiling: 1/120 s in 1024 substeps is under 10 microseconds each, far finer than any figure needs.
const MAX_SUBSTEPS = 1024;

/* ------------------------------------------------------------------ scratch, refilled every substep */

const tyreOut: TyreOut = { fx: 0, fy: 0, mz: 0, use: 0 };
const air: AeroOut = { drag: 0, liftFront: 0, liftRear: 0 };
const surface: SurfaceSample = { height: 0, gradX: 0, gradY: 0, grip: 1, rolling: 1 };
/** The surface grip under each wheel (what brakes.ts and systems.ts read). */
const grip = new Float64Array(4);
// Each wheel's place in the body (x forward, y left), m, and the cosine and sine of its steer angle.
const posX = new Float64Array(4);
const posY = new Float64Array(4);
const steerCos = new Float64Array(4);
const steerSin = new Float64Array(4);
// Each wheel centre's speed along the wheel (Vx), the contact patch's slip speed along the wheel (Vx - omega R) and
// across it (Vy), m/s.
const rollSpeed = new Float64Array(4);
const slipX = new Float64Array(4);
const slipY = new Float64Array(4);
/** How much of its grip each tyre's slip states asked for this substep (1 at the peak). */
const brushUse = new Float64Array(4);
// Each tyre's push on the body in body axes, N, and its yaw moment about the centre of gravity, N m.
const pushX = new Float64Array(4);
const pushY = new Float64Array(4);
const turnZ = new Float64Array(4);
// The mean slope under the car this substep (rise over run along world X and Y).
let slopeX = 0;
let slopeY = 0;

// The share of grip each tyre used in the last substep, per car, for telemetry. It is an output, not state (nothing
// in the next step reads it), so it lives beside the state rather than in it and the hash leaves it out.
const GRIP_USE = new WeakMap<VehicleState, Float64Array>();

/* ------------------------------------------------------------------ making and placing a car */

/**
 * A new car for a model, standing at rest at the origin facing +X: each wheel carrying its static share of the
 * weight, the tyres undeflected, the engine idling, first gear selected. Its model's shift points are worked out
 * here (by createState), outside the step.
 */
export function createVehicle(model: VehicleModel): VehicleState {
  const s = createState(model);
  staticLoads(model.chassis, s.wheelLoad);
  s.engineOmega = model.engine.idle;
  s.gear = 1;
  s.gearNext = 1;
  s.shiftTimer = 0;
  s.ratio = restingRatio(model);
  GRIP_USE.set(s, new Float64Array(4));
  return s;
}

// The ratio a stopped car's box sits at in first: a stepped box's first gear; a CVT's lowest gearing (the larger of
// its two end ratios, whichever order the model lists them in), where it comes to rest as the car stops.
function restingRatio(model: VehicleModel): number {
  const d = model.driveline, g = d.gears;
  if (g.length === 0) return 0;
  if ((d.transmission === 'cvt' || d.transmission === 'ecvt') && g.length > 1) return g[0] > g[1] ? g[0] : g[1];
  return g[0];
}

/**
 * Moves a car to a world position and heading (any length; it is normalised) and stops it there, as a reset or a
 * respawn does: the body, wheels, tyres and suspension at rest, the engine back at idle, the systems' memory cleared.
 * The gear stays as it was (any shift in progress completes at once; a CVT goes back to its lowest gearing); time,
 * distance, fuel and nitrous carry on.
 */
export function placeVehicle(s: VehicleState, x: number, y: number, hx: number, hy: number): void {
  const len = Math.sqrt(hx * hx + hy * hy);
  s.x = x; s.y = y;
  if (len > 0) { s.hx = hx / len; s.hy = hy / len; } else { s.hx = 1; s.hy = 0; }
  s.u = 0; s.v = 0; s.r = 0; s.ax = 0; s.ay = 0;
  s.heave = 0; s.pitch = 0; s.roll = 0; s.heaveRate = 0; s.pitchRate = 0; s.rollRate = 0;
  for (let i = 0; i < 4; i++) {
    s.wheelOmega[i] = 0; s.wheelFx[i] = 0; s.wheelFy[i] = 0; s.wheelMz[i] = 0;
    s.wheelDefX[i] = 0; s.wheelDefY[i] = 0; s.wheelSlipRatio[i] = 0; s.wheelSlipTan[i] = 0;
    s.wheelBrake[i] = 0; s.absActive[i] = 0; s.absHold[i] = 1; s.tcsBrake[i] = 0;
  }
  staticLoads(s.model.chassis, s.wheelLoad);
  s.engineOmega = s.model.engine.idle; s.boost = 0; s.engineTorque = 0; s.clutchTorque = 0; s.clutchLocked = 0;
  if (s.shiftTimer > 0) s.gear = s.gearNext;
  s.gearNext = s.gear; s.shiftTimer = 0;
  const t = s.model.driveline.transmission;
  if ((t === 'cvt' || t === 'ecvt') && s.gear > 0) s.ratio = restingRatio(s.model);
  s.tcsActive = 0; s.escActive = 0; s.limiterActive = 0; s.tcsCut = 1;
  const use = GRIP_USE.get(s);
  if (use !== undefined) for (let i = 0; i < 4; i++) use[i] = 0;
}

/* ------------------------------------------------------------------ the step */

/** Advances the car by one step (1/120 s) on the ground the world describes, with the driver's controls held through it. */
export function step(s: VehicleState, c: Controls, world: WorldQuery): void {
  stepWith(s, c, world, SUBSTEPS);
}

/**
 * Advances the car by the same 1/120 s as step, cut into another number of substeps (whole, at least 1). The bench
 * uses it to show that no figure depends on the substep.
 */
export function stepWith(s: VehicleState, c: Controls, world: WorldQuery, substeps: number): void {
  let n = Math.floor(substeps);
  if (!(n >= 1)) n = 1;
  // A count past any use (Infinity, say) would hang the caller rather than refine anything.
  if (n > MAX_SUBSTEPS) n = MAX_SUBSTEPS;
  const h = STEP / n;
  const use = GRIP_USE.get(s);
  for (let k = 0; k < n; k++) substep(s, c, world, h, use);
}

// One substep of h seconds, in the order DESIGN.md section 2 lays down.
function substep(s: VehicleState, c: Controls, world: WorldQuery, h: number, use: Float64Array | undefined): void {
  const m = s.model;

  // 1. Controls to actuators: the road wheels' steer angles, and the gear the car (or the driver) wants.
  steerAngles(s, c.steer);
  const gearWanted = autoShift(s, c);
  wheelGeometry(s);

  // 2. Air, at the forward speed the substep starts with.
  aeroForces(m.aero, s.u, air);

  // 3. Loads, from the last substep's accelerations.
  wheelLoads(s, air);

  // 4. The ground under each wheel, then each tyre's force from its slip states.
  sampleGround(s, world);
  wheelVelocities(s);
  for (let i = 0; i < 4; i++) {
    const p = tyreOf(m, i);
    const slide = Math.sqrt(slipX[i] * slipX[i] + slipY[i] * slipY[i]);
    tyreForces(p, s.wheelLoad[i], s.wheelSlipRatio[i], s.wheelSlipTan[i], slide, grip[i], tyreOut);
    s.wheelFx[i] = tyreOut.fx;
    s.wheelFy[i] = tyreOut.fy;
    s.wheelMz[i] = tyreOut.mz;
    brushUse[i] = tyreOut.use;
    if (use !== undefined) use[i] = tyreOut.use;
  }

  // 5. Systems: brakes and ABS, stability control (adds brake), traction control and the governor (cut the throttle).
  brakeTorques(s, c, grip, h);
  stabilityControl(s, c, grip, h);
  const tcs = tractionControl(s, c, grip, h);
  const governor = limiterCut(s);
  // The tyres' low-speed damping (DESIGN.md 3) joins their forces here, once the brakes are known: a held wheel
  // cannot take part of the damping in its spin, a free one can, and that changes how much damping is stable.
  for (let i = 0; i < 4; i++) lowSpeedDamp(s, i, h);

  // 6. Driveline: engine, clutch, gearbox, differentials, brakes and the four wheels' spin.
  const pedal = c.throttle > 0 ? (c.throttle < 1 ? c.throttle : 1) : 0;
  drivelineStep(s, c, gearWanted, pedal * tcs * governor, h);

  // 7. Body.
  moveBody(s, h);

  // 8. Suspension.
  suspensionStep(s, air, h);

  // 9. Tyre slip states, from the new body and wheel speeds.
  wheelVelocities(s);
  for (let i = 0; i < 4; i++) slipStates(s, i, h);

  // 10.
  s.time += h;
}

/**
 * Advances wheel i's two deflection states (DESIGN.md 3), clamped to three peak slips so a spinning or locked wheel
 * does not wind them up, and re-sticks a patch that has stopped sliding. While a patch slides its states run on past
 * the peak, but only the part that carries the sliding force is rubber bent; the rest is distance slid. At speed the
 * relaxation takes the excess out within a few relaxation lengths; near a standstill nothing does, so it would act as
 * a spring and push a car that had slid to rest back by up to three peak slips (tens of centimetres) and keep its tyres
 * wound against each other. So once the slip turns to unload the patch (the states start back toward zero) while they
 * are still past the peak, only the elastic share is kept (tyre.ts elasticShare: the same force on the sticking side,
 * so the force does not jump), blended in below the low-speed fade of rolling and sliding speed. During a slide,
 * nothing changes.
 */
function slipStates(s: VehicleState, i: number, h: number): void {
  const p = tyreOf(s.model, i), fz = s.wheelLoad[i], g = grip[i];
  const vx = slipX[i], vy = slipY[i];
  const x0 = s.wheelDefX[i], y0 = s.wheelDefY[i];
  let defX = relaxStep(x0, vx, rollSpeed[i], p.relaxLong, maxDeflectionX(p, fz, g), h);
  let defY = relaxStep(y0, vy, rollSpeed[i], p.relaxLat, maxDeflectionY(p, fz, g), h);
  const slide = Math.sqrt(vx * vx + vy * vy);
  const fade = lowSpeedFade(rollSpeed[i]) * lowSpeedFade(slide);
  if (fade > 0 && fz > 0 && g > 0) {
    // The states as shares of the deflection at the peak, so that a use of 1 is the peak (tyreForces' p).
    const dx = p.relaxLong * peakSlipRatio(p, fz, g), dy = p.relaxLat * peakSlipTan(p, fz, g);
    const ax = x0 / dx, ay = y0 / dy, bx = defX / dx, by = defY / dy;
    const before = Math.sqrt(ax * ax + ay * ay), after = Math.sqrt(bx * bx + by * by);
    // def' = -Vs: the slip unloads the patch when it points the states back toward zero.
    const unloading = ax * vx / dx + ay * vy / dy > 0;
    if (before > 1 && after > 1 && unloading) {
      const k = 1 - fade * (1 - elasticShare(p, after, slide));
      defX *= k;
      defY *= k;
    }
  }
  s.wheelDefX[i] = defX;
  s.wheelDefY[i] = defY;
  s.wheelSlipRatio[i] = defX / p.relaxLong;
  s.wheelSlipTan[i] = defY / p.relaxLat;
}

// Front tyres on wheels 0 and 1, rear on 2 and 3.
function tyreOf(m: VehicleModel, i: number): TyreParams { return i < 2 ? m.tyreFront : m.tyreRear; }

// Where each wheel sits on the body, and its steer angle's cosine and sine, for this substep.
function wheelGeometry(s: VehicleState): void {
  const ch = s.model.chassis;
  const hf = 0.5 * ch.trackFront, hr = 0.5 * ch.trackRear;
  posX[0] = ch.a; posX[1] = ch.a; posX[2] = -ch.b; posX[3] = -ch.b;
  posY[0] = hf; posY[1] = -hf; posY[2] = hr; posY[3] = -hr;
  for (let i = 0; i < 4; i++) {
    const d = s.wheelSteer[i];
    steerCos[i] = d === 0 ? 1 : dcos(d);
    steerSin[i] = d === 0 ? 0 : dsin(d);
  }
}

// Asks the world what lies under each wheel's contact patch: its grip, and the slope, averaged over the four.
function sampleGround(s: VehicleState, world: WorldQuery): void {
  let gx01 = 0, gx23 = 0, gy01 = 0, gy23 = 0;
  for (let i = 0; i < 4; i++) {
    const X = s.x + s.hx * posX[i] - s.hy * posY[i];
    const Y = s.y + s.hy * posX[i] + s.hx * posY[i];
    // Defaults first, so a world that fills only some fields gets flat dry asphalt for the rest.
    surface.height = 0; surface.gradX = 0; surface.gradY = 0; surface.grip = 1; surface.rolling = 1;
    world.surfaceAt(X, Y, surface);
    // No grip (or a nonsense figure) is no friction at all, not a negative one.
    grip[i] = surface.grip > 0 ? surface.grip : 0;
    // The ground's rolling resistance under this wheel, for the driveline (not a number: asphalt; below zero: none).
    const rolling = surface.rolling;
    surfaceRolling[i] = rolling === rolling ? (rolling > 0 ? rolling : 0) : 1;
    const gx = surface.gradX === surface.gradX ? surface.gradX : 0;
    const gy = surface.gradY === surface.gradY ? surface.gradY : 0;
    if (i < 2) { gx01 += gx; gy01 += gy; } else { gx23 += gx; gy23 += gy; }
  }
  // Pairwise sums so that a mirrored car sees exactly the mirrored slope.
  slopeX = 0.25 * (gx01 + gx23);
  slopeY = 0.25 * (gy01 + gy23);
}

// Each wheel centre's velocity in the wheel's own frame, and the contact patch's slip over the road.
function wheelVelocities(s: VehicleState): void {
  const m = s.model, u = s.u, v = s.v, r = s.r;
  for (let i = 0; i < 4; i++) {
    const vx = u - r * posY[i], vy = v + r * posX[i];
    const c = steerCos[i], sn = steerSin[i];
    const along = vx * c + vy * sn;
    rollSpeed[i] = along;
    slipX[i] = along - s.wheelOmega[i] * tyreOf(m, i).radius;
    slipY[i] = vy * c - vx * sn;
  }
}

/**
 * Low-speed damping for wheel i (DESIGN.md 3): below 1.5 m/s of rolling speed the standstill spring gets a damper,
 * -c Vs, critical for the corner's share of the car's mass (its load over g). It is taken implicitly, so that it
 * settles the slip speed without overshooting: across the wheel only the body moves; along it the wheel's own spin
 * moves too, unless the brake holds the wheel. A free wheel is so light against the tyre's damping (about 12 kg at
 * its rim for a 400 kg corner) that an explicit damper would throw it back and forth. The damper is part of the
 * tyre, so the force with it stays within the friction the brush leaves: the peak while the patch sticks, the
 * sliding force once it slides.
 */
function lowSpeedDamp(s: VehicleState, i: number, h: number): void {
  const fade = lowSpeedFade(rollSpeed[i]);
  const fz = s.wheelLoad[i];
  if (!(fade > 0) || !(fz > 0) || !(grip[i] > 0)) return;
  const m = s.model, p = tyreOf(m, i);
  const corner = fz / G;
  const c = lowSpeedDamping(p, fz, corner) * fade;
  if (!(c > 0)) return;
  const fx0 = s.wheelFx[i], fy0 = s.wheelFy[i];
  const body = h / corner;
  const dy = -c * slipY[i] / (1 + c * body);
  let dx = -c * slipX[i] / (1 + c * body);
  const J = i < 2 ? m.wheelInertiaFront : m.wheelInertiaRear, R = p.radius;
  // The brake holds the wheel this substep if it can stop the spin it has and carry the tyre's torque with it.
  const held = s.wheelBrake[i] * h >= J * Math.abs(s.wheelOmega[i]) + Math.abs(fx0 + dx) * R * h;
  if (!held && J > 0) dx = -c * slipX[i] / (1 + c * (body + R * R * h / J));
  const muY = tyreMuY(p, fz, grip[i]), muX = muY * p.muXRatio;
  if (!(muX > 0) || !(muY > 0)) return;
  const fxLimit = muX * fz, fyLimit = muY * fz;
  let limit = 1;
  if (brushUse[i] > 1) {
    const bx = fx0 / fxLimit, by = fy0 / fyLimit;
    limit = Math.sqrt(bx * bx + by * by);
  }
  let fx = fx0 + dx, fy = fy0 + dy;
  const nx = fx / fxLimit, ny = fy / fyLimit;
  const n = Math.sqrt(nx * nx + ny * ny);
  if (n > limit) { const k = limit / n; fx *= k; fy *= k; }
  s.wheelFx[i] = fx;
  s.wheelFy[i] = fy;
}

/**
 * The body (DESIGN.md 2, step 7): each tyre's force turned into the body by its steer angle, their sum and yaw moment
 * (aligning moments included), drag, the coast-down's road load and gravity along the slope. s.ax and s.ay are what
 * an accelerometer reads (every force but gravity, over the mass): the load transfer follows them, so a car parked
 * on a hill carries more on its downhill axle. Then u, v and r advance together from their old values, the heading
 * turns by r h and is renormalised, and the car moves.
 */
function moveBody(s: VehicleState, h: number): void {
  const m = s.model, ch = m.chassis;
  for (let i = 0; i < 4; i++) {
    const fx = s.wheelFx[i], fy = s.wheelFy[i], c = steerCos[i], sn = steerSin[i];
    const bx = fx * c - fy * sn, by = fx * sn + fy * c;
    pushX[i] = bx;
    pushY[i] = by;
    turnZ[i] = posX[i] * by - posY[i] * bx + s.wheelMz[i];
  }
  // Left and right first, then the axles: a mirrored car adds the same numbers in the same pairs, so it mirrors exactly.
  const fx = (pushX[0] + pushX[1]) + (pushX[2] + pushX[3]) + air.drag + roadLoad(m.aero, s.u);
  const fy = (pushY[0] + pushY[1]) + (pushY[2] + pushY[3]);
  const mz = (turnZ[0] + turnZ[1]) + (turnZ[2] + turnZ[3]);
  const ax = fx / ch.mass, ay = fy / ch.mass;
  // Gravity along the road: the slope along the body's x and y. The model's wheel loads are m g whatever the slope, so
  // taking m g times the gradient (not times its sine) keeps the ratio of push to load, and with it the grade at
  // which a braked car starts to slide, exactly right.
  const hx = s.hx, hy = s.hy;
  const downX = -G * (slopeX * hx + slopeY * hy);
  const downY = -G * (slopeY * hx - slopeX * hy);
  const u = s.u, v = s.v, r = s.r;
  s.u = u + (ax + downX + v * r) * h;
  s.v = v + (ay + downY - u * r) * h;
  s.r = r + (ch.izz > 0 ? mz / ch.izz : 0) * h;
  s.ax = ax;
  s.ay = ay;
  // Turn the heading through r h, then put it back on the unit circle so rounding cannot stretch it over a race.
  const turn = s.r * h;
  const ct = dcos(turn), st = dsin(turn);
  let nhx = hx * ct - hy * st, nhy = hx * st + hy * ct;
  const len = Math.sqrt(nhx * nhx + nhy * nhy);
  nhx /= len; nhy /= len;
  s.hx = nhx;
  s.hy = nhy;
  const nu = s.u, nv = s.v;
  s.x += (nu * nhx - nv * nhy) * h;
  s.y += (nu * nhy + nv * nhx) * h;
  s.distance += Math.sqrt(nu * nu + nv * nv) * h;
}

/* ------------------------------------------------------------------ outside the step */

/**
 * A collision's impulse (N s, world axes) at a world point: changes the body's forward and sideways speed and its yaw
 * rate at once, as a blow does. The wheels keep turning; their tyres take it up as slip.
 */
export function applyImpulse(s: VehicleState, jx: number, jy: number, atX: number, atY: number): void {
  const ch = s.model.chassis, hx = s.hx, hy = s.hy;
  // The impulse and its lever arm from the centre of gravity, in body axes.
  const jf = jx * hx + jy * hy, jl = jy * hx - jx * hy;
  const dX = atX - s.x, dY = atY - s.y;
  const rf = dX * hx + dY * hy, rl = dY * hx - dX * hy;
  if (ch.mass > 0) { s.u += jf / ch.mass; s.v += jl / ch.mass; }
  if (ch.izz > 0) s.r += (rf * jl - rl * jf) / ch.izz;
}

/**
 * Fills a telemetry record from the state (allocates nothing): speeds, accelerations in g, the body's attitude, engine
 * speed in rpm, gear, boost, the engine's torque, clutch slip, each wheel's load, slip ratio, slip angle (rad, positive
 * when the tyre pushes left), speed (rad/s) and grip in use, and which systems are acting.
 */
export function telemetry(s: VehicleState, out: Telemetry): void {
  const u = s.u, v = s.v;
  out.speed = Math.sqrt(u * u + v * v);
  out.u = u;
  out.v = v;
  out.accelLong = s.ax / G;
  out.accelLat = s.ay / G;
  out.yawRate = s.r;
  // Measured against the way the body points whichever way it rolls, so reversing straight is no sideslip.
  out.sideslip = u === 0 && v === 0 ? 0 : datan2(v, Math.abs(u));
  out.roll = s.roll;
  out.pitch = s.pitch;
  out.heave = s.heave;
  out.rpm = s.engineOmega / RPM;
  out.gear = s.gear;
  out.boost = s.boost;
  out.throttleTorque = s.engineTorque;
  out.clutchSlip = clutchSlip(s);
  out.shifting = s.shiftTimer > 0;
  const use = GRIP_USE.get(s);
  for (let i = 0; i < 4; i++) {
    out.wheelLoad[i] = s.wheelLoad[i];
    out.wheelSlipRatio[i] = s.wheelSlipRatio[i];
    out.wheelSlipAngle[i] = datan(s.wheelSlipTan[i]);
    out.wheelSpeed[i] = s.wheelOmega[i];
    out.wheelUse[i] = use !== undefined ? use[i] : dryUse(s, i);
  }
  out.absActive = s.absActive[0] > 0 || s.absActive[1] > 0 || s.absActive[2] > 0 || s.absActive[3] > 0;
  out.tcsActive = s.tcsActive > 0;
  out.escActive = s.escActive > 0;
  out.limiterActive = s.limiterActive > 0;
  out.nitrousLeft = s.nitrousLeft;
}

// How far the clutch (or converter) slips, as a share of engine speed: 0 locked, 1 with the driven wheels still and
// the engine turning, negative when the wheels drive the engine. 0 in neutral, where the gearbox carries nothing.
function clutchSlip(s: VehicleState): number {
  const d = s.model.driveline, w = s.wheelOmega;
  const G2 = s.ratio * d.finalDrive;
  if (G2 === 0 || !(s.engineOmega > 0)) return 0;
  const f = d.layout === 'FWD' ? 1 : d.layout === 'RWD' ? 0 : d.centre.frontShare;
  const driven = f * 0.5 * (w[0] + w[1]) + (1 - f) * 0.5 * (w[2] + w[3]);
  return (s.engineOmega - G2 * driven) / s.engineOmega;
}

// A tyre's grip in use worked out from its slip states on dry asphalt, for a state that was not made by createVehicle
// (so has no record of the surface it last ran on).
function dryUse(s: VehicleState, i: number): number {
  tyreForces(tyreOf(s.model, i), s.wheelLoad[i], s.wheelSlipRatio[i], s.wheelSlipTan[i], 0, 1, tyreOut);
  return tyreOut.use;
}

/**
 * A 32-bit hash of every number in the state, typed arrays element by element, in a fixed order: two runs that hash
 * the same have the same bits everywhere. The model is not hashed (it does not change in a run).
 */
export function hashState(s: VehicleState): number {
  let h = HASH_START;
  h = hashNumber(h, s.time);
  h = hashNumber(h, s.x); h = hashNumber(h, s.y); h = hashNumber(h, s.hx); h = hashNumber(h, s.hy);
  h = hashNumber(h, s.u); h = hashNumber(h, s.v); h = hashNumber(h, s.r);
  h = hashNumber(h, s.ax); h = hashNumber(h, s.ay);
  h = hashNumber(h, s.heave); h = hashNumber(h, s.pitch); h = hashNumber(h, s.roll);
  h = hashNumber(h, s.heaveRate); h = hashNumber(h, s.pitchRate); h = hashNumber(h, s.rollRate);
  h = hashArray(h, s.wheelOmega);
  h = hashArray(h, s.wheelLoad);
  h = hashArray(h, s.wheelFx);
  h = hashArray(h, s.wheelFy);
  h = hashArray(h, s.wheelMz);
  h = hashArray(h, s.wheelDefX);
  h = hashArray(h, s.wheelDefY);
  h = hashArray(h, s.wheelSlipRatio);
  h = hashArray(h, s.wheelSlipTan);
  h = hashArray(h, s.wheelSteer);
  h = hashArray(h, s.wheelBrake);
  h = hashNumber(h, s.engineOmega); h = hashNumber(h, s.boost); h = hashNumber(h, s.engineTorque);
  h = hashNumber(h, s.clutchTorque); h = hashNumber(h, s.clutchLocked);
  h = hashNumber(h, s.gear); h = hashNumber(h, s.gearNext); h = hashNumber(h, s.shiftTimer); h = hashNumber(h, s.ratio);
  h = hashArray(h, s.absActive);
  h = hashNumber(h, s.tcsActive); h = hashNumber(h, s.escActive); h = hashNumber(h, s.limiterActive);
  h = hashArray(h, s.absHold);
  h = hashNumber(h, s.tcsCut);
  h = hashArray(h, s.tcsBrake);
  h = hashNumber(h, s.nitrousLeft);
  h = hashNumber(h, s.distance); h = hashNumber(h, s.energyUsed);
  return h;
}

// Folds a typed array's length and then each element, so arrays of different lengths cannot hash alike.
function hashArray(h: number, a: Float64Array): number {
  let k = hashNumber(h, a.length);
  for (let i = 0; i < a.length; i++) k = hashNumber(k, a[i]);
  return k;
}
