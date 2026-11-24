// The reference drivers (DESIGN.md section 8): the hands and feet the bench puts in a car. Each one reads the car's
// state once a step and sets the controls for the next, as a test driver does, and nothing else: no driver changes the
// car. Like an expert who knows his car, the launch and circle drivers also read its model (its tyres' grip, its
// engine's torque). They are deterministic (no clock, no random source), so a bench run gives the same bits on every
// machine.
//
//  - launchDriver: a drag launch. It stages the car (a converter car on the brake, at the launch speed, as high as the
//    brakes hold), lets it go, asks the engine for the torque the driven tyres can take with a feel for the wheelspin
//    on top, as an expert's right foot does, and changes up at the shift speed it was given.
//  - brakeDriver: full pedal, nothing else; ABS as fitted does the rest.
//  - cruiseDriver: holds a speed in a straight line.
//  - circleDriver: holds a circle with the steering while the speed rises slowly or is held (the skidpad).
//  - flatOutDriver: full throttle, the car's own gear choice (the top-speed run).
//
// A driver is made once per run (it may allocate then) and its control() allocates nothing.
import type { Controls, VehicleModel, VehicleState } from './types';
import { AUTO_GEAR } from './types';
import { wheelRoadSpeed } from './brakes';
import { engineTorque } from './engine';
import { datan, dcos, dsin } from './math';
import { shiftUpOmega } from './systems';
import { peakSlipRatio, peakSlipTan, tyreMuX } from './tyre';

/** Something that drives: once a step, it reads the car and sets the controls for the next step. */
export type Driver = {
  /** Sets c from what the car s is doing now. */
  control(s: VehicleState, c: Controls): void;
};

/** Seconds between two calls of a driver: the core's step (vehicle.ts STEP). A driver acts once a step. */
export const DRIVER_STEP = 1 / 120;

/** Sets every control to rest, keeping the controls object: no pedal, no steer, the car's systems on, its own gears. */
export function restControls(c: Controls): void {
  c.steer = 0; c.throttle = 0; c.brake = 0; c.handbrake = 0; c.clutch = 0; c.gear = AUTO_GEAR; c.autoClutch = true;
  c.abs = true; c.tcs = true; c.esc = true; c.launchOmega = 0; c.nitrous = false;
}

/* ------------------------------------------------------------------ reading the driven wheels */

/** The first and last wheel index the gearbox drives: 2 and 3 for rear drive, 0 and 1 for front drive, all four for all-wheel drive. */
export function drivenWheels(model: VehicleModel): { first: number; last: number } {
  const layout = model.driveline.layout;
  return { first: layout === 'RWD' ? 2 : 0, last: layout === 'FWD' ? 1 : 3 };
}

/**
 * Road speed, m/s, below which wheelspin is judged against this speed: pulling away there is no road speed to take a
 * ratio of. The same floor the car's own traction control uses.
 */
export const SLIP_FLOOR = 1;

/**
 * How far the most-spinning driven wheel is past its tyre's peak, as a share of the peak slip ratio (1 at the peak),
 * judged from its speed against the road under it in the direction the gear drives: what a driver feels through the
 * seat and hears from the tyres, and what a traction-control unit measures.
 */
export function worstDrivenSlip(s: VehicleState, grip: number): number {
  const m = s.model, layout = m.driveline.layout;
  const first = layout === 'RWD' ? 2 : 0, last = layout === 'FWD' ? 1 : 3;
  const dir = s.gear < 0 ? -1 : 1;
  let worst = 0;
  for (let i = first; i <= last; i++) {
    const tyre = i < 2 ? m.tyreFront : m.tyreRear;
    let peak = peakSlipRatio(tyre, s.wheelLoad[i], grip);
    if (peak < 1e-6) peak = 1e-6;
    const road = wheelRoadSpeed(s, i);
    const size = road < 0 ? -road : road;
    const share = dir * (s.wheelOmega[i] * tyre.radius - road) / (size > SLIP_FLOOR ? size : SLIP_FLOOR) / peak;
    if (share > worst) worst = share;
  }
  return worst;
}

/* ------------------------------------------------------------------ the launch */

/**
 * The most drive force, N, the driven tyres can take now: each driven tyre's peak longitudinal friction at its present
 * load, added up the way the centre shares the drive (a fixed split is held to the axle that saturates first; a
 * coupling adds what it can pass to the other axle, up to its torque).
 */
export function tractionLimit(s: VehicleState): number {
  const m = s.model, d = m.driveline;
  let front = 0, rear = 0;
  for (let i = 0; i < 4; i++) {
    const tyre = i < 2 ? m.tyreFront : m.tyreRear, fz = s.wheelLoad[i];
    const f = fz > 0 ? tyreMuX(tyre, fz, 1) * fz : 0;
    if (i < 2) front += f; else rear += f;
  }
  if (d.layout === 'FWD') return front;
  if (d.layout === 'RWD') return rear;
  const c = d.centre;
  if (c.kind === 'fixed') {
    const f = c.frontShare;
    if (!(f > 0)) return rear;
    if (!(f < 1)) return front;
    const byFront = front / f, byRear = rear / (1 - f);
    return byFront < byRear ? byFront : byRear;
  }
  if (c.kind === 'coupling') {
    if (c.frontShare > 0.5) { const pass = c.lockTorque / m.tyreRear.radius; return front + (rear < pass ? rear : pass); }
    const pass = c.lockTorque / m.tyreFront.radius;
    return rear + (front < pass ? front : pass);
  }
  return front + rear;
}

/**
 * The crank torque, N m, that puts `force` N of drive at the driven tyres in the gear in hand: through the gearbox's
 * efficiency and a slipping converter's torque multiplication, plus, with the clutch locked, what spins the engine up
 * with the car at `accel` m/s^2. Infinity in neutral.
 */
export function crankTorqueFor(s: VehicleState, force: number, accel: number): number {
  const m = s.model, d = m.driveline, e = m.engine;
  const G = s.ratio * d.finalDrive;
  if (!(G > 0)) return Infinity;
  const f = d.layout === 'FWD' ? 1 : d.layout === 'RWD' ? 0 : d.centre.frontShare;
  const R = f * m.tyreFront.radius + (1 - f) * m.tyreRear.radius;
  const eff = d.efficiency > 0 && d.efficiency <= 1 ? d.efficiency : 1;
  let multiply = 1;
  const cv = d.converter;
  if (d.launch === 'converter' && cv !== null && s.clutchLocked !== 1 && s.engineOmega > 0 && cv.couplingRatio > 0) {
    const w = s.wheelOmega;
    const turbine = G * (0.5 * f * (w[0] + w[1]) + 0.5 * (1 - f) * (w[2] + w[3]));
    const sr = turbine > 0 ? turbine / s.engineOmega : 0;
    multiply = sr < cv.couplingRatio ? cv.torqueRatio + (1 - cv.torqueRatio) * sr / cv.couplingRatio : 1;
  }
  let T = force * R / (G * eff * multiply);
  if (s.clutchLocked === 1) T += e.inertia * G * accel / R;
  return T;
}

/** How fast the launch driver's feel corrects the throttle, per second for each peak slip of error. */
export const HAND_GAIN = 1.5;
/** The slip, in peak slips, the launch driver aims the driven wheels at: the peak of the tyre's force. */
export const HAND_TARGET = 1;
/** The most the feel takes off the throttle the driver's sense of the grip asks for: it corrects that sense, it does not replace it. */
export const HAND_FEEL_LOW = -0.5;
/** Seconds a converter car is held on the brake at its launch speed before it is let go. */
export const STAGE_TIME = 1.2;
/**
 * On the brake, a driven wheel turning faster than this, rad/s, means the brakes are no longer holding the drive (full
 * pedal is sized for stopping, at 1.3 g, not for holding a converter at stall): the driver eases the throttle by
 * STAGE_BACK_OFF each step until they hold again, as a driver stages a car no higher than its brakes allow.
 */
export const STAGE_CREEP = 0.02;
/** The share of its throttle the staging foot keeps each step while a driven wheel turns on the brake (see STAGE_CREEP). */
export const STAGE_BACK_OFF = 0.9;
/** A converter car is staged no higher than this share of the engine speed at which its output would just beat the brakes. */
export const STAGE_MARGIN = 0.95;

/**
 * The engine speed, rad/s, a converter car is staged at on the brake: the launch speed asked for, but no higher than
 * the brakes hold (full pedal on the driven wheels against the stalled converter's output through first gear), and no
 * lower than idle.
 */
export function stageSpeed(model: VehicleModel, launchOmega: number): number {
  const e = model.engine, d = model.driveline, cv = d.converter;
  let want = launchOmega > e.idle ? launchOmega : e.idle;
  if (cv === null || !(cv.stallOmega > 0)) return want;
  const k = engineTorque(e, cv.stallOmega, 1, 1) / (cv.stallOmega * cv.stallOmega);
  const front = d.layout === 'FWD' || d.layout === 'AWD', rear = d.layout !== 'FWD';
  const brakes = 2 * ((front ? model.brakes.maxTorqueFront : 0) + (rear ? model.brakes.maxTorqueRear : 0));
  const G = (d.gears.length > 0 ? d.gears[0] : 0) * d.finalDrive;
  const eff = d.efficiency > 0 && d.efficiency <= 1 ? d.efficiency : 1;
  if (k > 0 && G > 0) {
    const hold = STAGE_MARGIN * Math.sqrt(brakes / (cv.torqueRatio * G * eff) / k);
    if (want > hold) want = hold;
  }
  return want > e.idle ? want : e.idle;
}

/** The throttle at which a stalled converter takes all the engine's torque at engine speed `want`: where it settles there. */
function stageThrottle(s: VehicleState, want: number): number {
  const m = s.model, e = m.engine, cv = m.driveline.converter;
  if (cv === null || !(cv.stallOmega > 0)) return 1;
  const pump = engineTorque(e, cv.stallOmega, 1, 1) / (cv.stallOmega * cv.stallOmega) * want * want;
  const t0 = engineTorque(e, want, 0, s.boost), t1 = engineTorque(e, want, 1, s.boost);
  const th = t1 > t0 ? (pump - t0) / (t1 - t0) : 1;
  return th < 0 ? 0 : th > 1 ? 1 : th;
}

/** A launch driver: what it settled on, besides driving. */
export type LaunchDriver = Driver & {
  /** Engine speed held at the start, rad/s (0: none, an electric car's direct drive). */
  readonly launchOmega: number;
  /** Engine speed, rad/s, at which it changes up from each gear (index 0 is first gear; Infinity in the top gear). */
  readonly shiftOmega: Float64Array;
  /** True once the car has been let go. */
  released: boolean;
};

/**
 * The bench's launch driver (DESIGN.md 8): an expert's drag launch at a given launch speed and shift speed.
 *  - A converter automatic is stood on the brake with the throttle trimmed to hold the engine at launchOmega (or at
 *    the converter's stall, if that is lower, or as high as the brakes hold the car), for STAGE_TIME, then let go. A clutch car is not: the auto-clutch is
 *    told to bite at launchOmega (Controls.launchOmega) and the throttle goes down at once, so it pulls away the
 *    moment the engine reaches that speed.
 *  - Once going, the throttle is the driver's traction control, as an expert's right foot is: it asks the engine for
 *    the torque the driven tyres can take at their present loads (tractionLimit, crankTorqueFor), and a feel for the
 *    wheelspin corrects that slowly, opening while the worst driven wheel slips less than its tyre's peak and closing
 *    while it slips more. Asking for the torque, rather than chasing the slip, keeps a slipping clutch steady.
 *  - It changes up when the engine reaches shiftShare times the car's own full-throttle shift point for that gear
 *    (systems.ts shiftUpOmega), never past redline. A car without gears to change stays in drive.
 * The car's own systems stay as fitted.
 */
export function launchDriver(model: VehicleModel, launchOmega: number, shiftShare: number): LaunchDriver {
  const e = model.engine, d = model.driveline;
  const n = d.gears.length;
  const stepped = d.transmission !== 'cvt' && d.transmission !== 'ecvt' && d.transmission !== 'single-speed';
  const shiftOmega = new Float64Array(n > 0 ? n : 1);
  for (let g = 1; g <= shiftOmega.length; g++) {
    let at = Infinity;
    if (stepped && g < n) {
      at = shiftShare * shiftUpOmega(model, g);
      if (at > e.redline) at = e.redline;
    }
    shiftOmega[g - 1] = at;
  }
  const converter = d.launch === 'converter';
  const mass = model.chassis.mass;
  const { first, last } = drivenWheels(model);
  let gear = 1, throttle = 1, staged = 0, feel = 0, backOff = 1;
  const staging = converter ? stageSpeed(model, launchOmega) : 0;
  const driver: LaunchDriver = {
    launchOmega, shiftOmega, released: !converter,
    control(s: VehicleState, c: Controls): void {
      restControls(c);
      c.gear = gear;
      if (!driver.released) {
        // On the brake: the throttle at which the converter's pump, held still, takes all the engine's torque at the
        // speed staged, so the engine settles there without overshooting (a converter at full throttle stops at its
        // stall speed). If a driven wheel turns all the same, the foot comes back until the brakes hold.
        c.brake = 1;
        throttle = stageThrottle(s, staging);
        let creeping = false;
        for (let i = first; i <= last; i++) if (Math.abs(s.wheelOmega[i]) > STAGE_CREEP) creeping = true;
        if (creeping) backOff *= STAGE_BACK_OFF;
        throttle *= backOff;
        c.throttle = throttle;
        staged += DRIVER_STEP;
        if (staged >= STAGE_TIME) driver.released = true;
        return;
      }
      c.launchOmega = converter ? 0 : launchOmega;
      // Up a gear at the shift speed (a request mid-shift would be ignored, so wait for the box).
      if (stepped && gear < n && s.shiftTimer === 0 && s.gear === gear && s.engineOmega >= shiftOmega[gear - 1]) gear++;
      c.gear = gear;
      // The right foot: the throttle that asks the engine for the torque the tyres can take, and a correction from the
      // feel of the wheelspin (it never adds past full throttle, so it is ready the moment the tyres are the limit).
      const grip = tractionLimit(s);
      const want = crankTorqueFor(s, grip, grip / mass);
      const t0 = engineTorque(e, s.engineOmega, 0, s.boost), t1 = engineTorque(e, s.engineOmega, 1, s.boost);
      const ask = t1 > want && t1 > t0 ? (want - t0) / (t1 - t0) : 1;
      feel += DRIVER_STEP * HAND_GAIN * (HAND_TARGET - worstDrivenSlip(s, 1));
      if (ask + feel > 1) feel = 1 - ask;
      if (feel < HAND_FEEL_LOW) feel = HAND_FEEL_LOW;
      throttle = ask + feel;
      throttle = throttle < 0 ? 0 : throttle > 1 ? 1 : throttle;
      c.throttle = throttle;
    },
  };
  return driver;
}

/* ------------------------------------------------------------------ straight-line drivers */

/** Full throttle in a straight line with the car choosing its own gears and its systems as fitted: the top-speed run. */
export function flatOutDriver(): Driver {
  return {
    control(_s: VehicleState, c: Controls): void {
      restControls(c);
      c.throttle = 1;
    },
  };
}

/** Full brake pedal in a straight line, throttle closed, the car's own ABS as fitted: the braking test. */
export function brakeDriver(): Driver {
  return {
    control(_s: VehicleState, c: Controls): void {
      restControls(c);
      c.brake = 1;
    },
  };
}

/** Throttle per m/s of speed error, for holding a speed. */
export const CRUISE_P = 0.25;
/** Throttle per m of accumulated distance error (the integral of the speed error), so a held speed has no offset. */
export const CRUISE_I = 0.08;

/**
 * Holds a speed (m/s) in a straight line with the throttle, braking gently if well over it: the run-up to a braking
 * test. The car chooses its own gears.
 */
export function cruiseDriver(speed: number): Driver {
  let held = 0;
  return {
    control(s: VehicleState, c: Controls): void {
      restControls(c);
      const err = speed - s.u;
      held += err * DRIVER_STEP;
      if (held > 2 / CRUISE_I) held = 2 / CRUISE_I; else if (held < -2 / CRUISE_I) held = -2 / CRUISE_I;
      const th = CRUISE_P * err + CRUISE_I * held;
      c.throttle = th > 1 ? 1 : th > 0 ? th : 0;
      if (err < -1) c.brake = 0.1 * (-err - 1) < 0.5 ? 0.1 * (-err - 1) : 0.5;
    },
  };
}

/* ------------------------------------------------------------------ the circle */

/**
 * A circle driver. Besides driving, it reports where the car is against the circle, and it keeps its whole memory in
 * plain fields (the speed it aims at and its two integrals), so a run can be set aside and taken up again exactly.
 */
export type CircleDriver = Driver & {
  /** How far the car's centre of gravity is outside the circle, m (negative inside), at the last call. */
  wide: number;
  /** The speed it was aiming at, m/s, at the last call. */
  target: number;
  /** The speed aimed at: v0 m/s at time t0 (NaN until the first call: then the car's own time), rising `rise` m/s each second up to `cap`. */
  t0: number; v0: number; rise: number; cap: number;
  /** The speed control's integral of speed error, m, and the steering's trim, rad. */
  held: number; trim: number;
};

/** Look-ahead along the circle, s of travel, for the steering: the point the driver looks at. */
export const LOOK_AHEAD_TIME = 0.5;
/** ...never nearer than this, m. */
export const LOOK_AHEAD_MIN = 4;
/** Steer angle added per m of running wide per second (the integral of the steering), rad. */
export const CIRCLE_TRIM = 0.03;
/** On the circle the driver holds the gear that puts the engine nearest this share of redline at the starting speed. */
export const CIRCLE_ENGINE_SHARE = 0.5;

/**
 * The gear a driver holds for a steady speed u (m/s): the one that turns the engine nearest half its redline, as a
 * tester picks a gear for a skidpad and stays in it (a shift mid-corner upsets the car). 1 for a car without gears to
 * change.
 */
export function holdingGear(model: VehicleModel, u: number): number {
  const d = model.driveline, n = d.gears.length;
  if (d.transmission === 'cvt' || d.transmission === 'ecvt' || d.transmission === 'single-speed' || n < 2) return 1;
  const radius = d.layout === 'FWD' ? model.tyreFront.radius : model.tyreRear.radius;
  const want = CIRCLE_ENGINE_SHARE * model.engine.redline, wheel = u / radius;
  let best = 1, miss = Infinity;
  for (let g = 1; g <= n; g++) {
    const off = Math.abs(d.gears[g - 1] * d.finalDrive * wheel - want);
    if (off < miss) { miss = off; best = g; }
  }
  return best;
}

/**
 * Holds a circle of `radius` m about (cx, cy), driving round it anticlockwise (turning left), while the speed it aims at
 * rises by `rise` m/s each second from `v0` (DESIGN.md 8's skidpad: 0.05 m/s each second) up to `cap` (Infinity for
 * no cap), where it is held.
 * Steering: pure pursuit, as a driver looks ahead: the point half a second ahead on the circle, from the rear axle,
 * gives the curvature to steer for (Ackermann geometry, datan(wheelbase x curvature)), and a slow trim adds the steer
 * an understeering car needs to stay on the line. Speed: the throttle holds the speed aimed at (proportional and
 * integral), the brake only if well over it. One gear held throughout (holdingGear at v0), stability control off (as
 * testers run it), the rest of its systems as fitted.
 */
export function circleDriver(model: VehicleModel, cx: number, cy: number, radius: number, v0: number, rise: number, cap = Infinity): CircleDriver {
  const ch = model.chassis, L = ch.a + ch.b;
  const gear = holdingGear(model, v0);
  const driver: CircleDriver = {
    wide: 0, target: v0, t0: NaN, v0, rise, cap, held: 0, trim: 0,
    control(s: VehicleState, c: Controls): void {
      restControls(c);
      c.esc = false;
      c.gear = gear;
      if (driver.t0 !== driver.t0) driver.t0 = s.time;
      let target = driver.v0 + driver.rise * (s.time - driver.t0);
      if (target > driver.cap) target = driver.cap;
      driver.target = target;
      // Where the car is against the circle.
      const dx = s.x - cx, dy = s.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      driver.wide = dist - radius;
      // The point ahead on the circle, from the rear axle.
      const qx = s.x - ch.b * s.hx, qy = s.y - ch.b * s.hy;
      const ex = qx - cx, ey = qy - cy;
      const el = Math.sqrt(ex * ex + ey * ey);
      const ux = el > 0 ? ex / el : 1, uy = el > 0 ? ey / el : 0;
      const speed = s.u > 1 ? s.u : 1;
      let ahead = LOOK_AHEAD_TIME * speed;
      if (ahead < LOOK_AHEAD_MIN) ahead = LOOK_AHEAD_MIN;
      // Arc `ahead` further on, anticlockwise: the unit radius turned through ahead / radius.
      const phi = ahead / radius, cosP = dcos(phi), sinP = dsin(phi);
      const tx = cx + radius * (ux * cosP - uy * sinP), ty = cy + radius * (ux * sinP + uy * cosP);
      // That point in the car's own axes, and the curvature that reaches it (pure pursuit).
      const px = tx - qx, py = ty - qy;
      const fwd = px * s.hx + py * s.hy, left = py * s.hx - px * s.hy;
      const d2 = fwd * fwd + left * left;
      const curvature = d2 > 0 ? 2 * left / d2 : 0;
      // An expert never winds on lock past the outer front tyre's peak slip angle: past it more lock only scrubs, and
      // the front lets go. That angle is the direction the outer front wheel travels plus its tyre's peak slip angle.
      const yo = -0.5 * ch.trackFront, vxo = s.u - s.r * yo, vyo = s.v + s.r * ch.a;
      const travel = vxo > 0.1 ? datan(vyo / vxo) : 0;
      const limit = travel + datan(peakSlipTan(model.tyreFront, s.wheelLoad[1], 1));
      let angle = datan(L * curvature) + driver.trim;
      if (angle > limit) angle = limit;
      else driver.trim += CIRCLE_TRIM * driver.wide * DRIVER_STEP;
      const most = 0.5 * ch.maxSteer;
      if (driver.trim > most) driver.trim = most; else if (driver.trim < -most) driver.trim = -most;
      c.steer = ch.maxSteer > 0 ? angle / ch.maxSteer : 0;
      if (c.steer > 1) c.steer = 1; else if (c.steer < -1) c.steer = -1;
      // Speed.
      const err = target - s.u;
      let held = driver.held + err * DRIVER_STEP;
      if (held > 2 / CRUISE_I) held = 2 / CRUISE_I; else if (held < -2 / CRUISE_I) held = -2 / CRUISE_I;
      driver.held = held;
      const th = CRUISE_P * err + CRUISE_I * held;
      c.throttle = th > 1 ? 1 : th > 0 ? th : 0;
      if (err < -1) c.brake = 0.1 * (-err - 1) < 0.5 ? 0.1 * (-err - 1) : 0.5;
    },
  };
  return driver;
}
