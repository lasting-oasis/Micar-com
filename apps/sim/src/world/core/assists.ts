// The assist layer (packages/physics DESIGN.md section 13): one layer for every car, in three presets. It shapes what
// the driver asks for (steering, throttle, gears, the car's systems) into the core's Controls. It never touches the
// car's physics: the model, its tyres and its systems are the same under every preset; only the inputs differ.
//
//   Casual    steering held just under the front tyres' peak slip at the present speed, steering that slows with
//             road speed, counter-steer help, ABS, traction and stability control on, automatic gears, and the
//             throttle eased while the driven wheels spin.
//   Standard  (the default) the same steering limit a little looser, no throttle easing, the car's own systems on,
//             the gears the driver chose.
//   Pure      the wheel goes where it is put; systems as the driver sets them; manual gears if chosen.
// The steering limit holds the front at its peak only while the car is cornering: once the rear slides past its peak
// slip angle, or the car turns faster than any steady corner at its speed lets it, the side of the limit that would
// push it further round closes in toward the way the front axle is going, so the front stops feeding the rotation.
// In a drift (the drift event, the X toggle, the Drift button) stability and traction control are off, and Casual
// stops easing the throttle: a slide is what is wanted. Standard's limit then lets the slide grow to DRIFT_ROOM times
// as far before it closes in; Casual's closes in as ever, so it still stops the spin.
import type { Controls, Telemetry, VehicleModel, VehicleState } from '@micar/physics';
import { AUTO_GEAR, G, SLIDE_FROM, SLIDE_FULL, peakSlipRatio, peakSlipTan, rearSlip } from '@micar/physics';

// The tyre's own peak slips (tyre.ts), read on dry asphalt (surface grip 1): the slip the driver feels and the assists
// hold to is the tyre's; on a slippery surface the car's own systems still guard the peak.
const DRY = 1;

/** The three presets. */
export type AssistPreset = 'casual' | 'standard' | 'pure';
/** Standard, as DESIGN.md section 13 makes it. */
export const DEFAULT_PRESET: AssistPreset = 'standard';

/** The car's own systems as the driver has them switched (Pure only; the other presets keep them on). */
export type SystemsChoice = { abs: boolean; tcs: boolean; esc: boolean };

/** What one preset does. */
export type AssistConfig = {
  /** Steering lock as a share of the front tyres' peak slip angle, measured from the way the front axle is going; null: no limit. */
  slipShare: number | null;
  /** Steering speed, share of full lock a second, toward the input and back to centre; at road speed u it is divided by (1 + u / fallSpeed). */
  steerRate: number; returnRate: number; fallSpeed: number;
  /** Counter-steer help: road-wheel angle added per radian of the body's slip angle (0: none). */
  counterSteer: number;
  /** Ease the throttle while a driven wheel spins past its tyre's peak. */
  easeThrottle: boolean;
  /** Automatic gears whatever the driver chose. */
  autoGears: boolean;
  /** The car's systems: always on, or as the driver sets them. */
  systems: 'on' | 'driver';
  /** In a drift, how many times further than otherwise the steering limit lets the rear slide (and the car turn) before it closes in. */
  driftRoom: number;
};

/**
 * The car's yaw rate as a share of the most a steady corner at its speed can hold (its tyres' friction times g over the
 * speed), at which the steering limit starts to close in on the side that turns it further, and at which it is closed.
 */
export const SPIN_FROM = 1;
export const SPIN_FULL = 1.5;
/** Standard's drift room (AssistConfig.driftRoom): a slide of about 0.5 rad is held before the limit closes in. */
export const DRIFT_ROOM = 2.5;

/** The presets' numbers. */
export const ASSISTS: Readonly<Record<AssistPreset, Readonly<AssistConfig>>> = {
  // Just under the peak (0.9 of it); a keyboard press takes 0.22 s to full lock at a standstill and about 0.8 s at
  // 100 km/h: a quick stab cannot throw the car past its grip.
  casual: { slipShare: 0.9, steerRate: 4.5, returnRate: 6, fallSpeed: 10, counterSteer: 0.8, easeThrottle: true, autoGears: true, systems: 'on', driftRoom: 1 },
  // A little past the peak (1.15 of it), so the front can be leant on; the old model's own steering speeds (7 and 10).
  standard: { slipShare: 1.15, steerRate: 7, returnRate: 10, fallSpeed: Infinity, counterSteer: 0, easeThrottle: false, autoGears: false, systems: 'on', driftRoom: DRIFT_ROOM },
  // The wheel goes where it is put, at once.
  pure: { slipShare: null, steerRate: Infinity, returnRate: Infinity, fallSpeed: Infinity, counterSteer: 0, easeThrottle: false, autoGears: false, systems: 'driver', driftRoom: 1 },
};

/** What the driver asks for in one sub-step, after the pedals have been sorted out (DriverWish is the assists' input). */
export type DriverWish = {
  /** -1 to 1, positive LEFT (the core's sense: the game's Input.steer negated). */
  steer: number;
  /** The Garage's steering slider as a multiple of lock per input: 0.8 (slow) to 1.2 (quick). */
  steerMul: number;
  throttle: number; brake: number; handbrake: number;
  /** -1 reverse, a forward gear (manual), or AUTO_GEAR. */
  gear: number;
  nitrous: boolean;
  /** A drift is on (event, toggle or button). */
  drift: boolean;
};

/** The layer's memory from one sub-step to the next. */
export type AssistMemory = { steer: number; ease: number };

/** A fresh memory: wheel straight, throttle not eased. */
export function assistMemory(): AssistMemory { return { steer: 0, ease: 1 }; }

/** The front tyres' peak slip angle, rad, at their present loads. */
export function frontPeakSlip(s: VehicleState): number {
  return Math.atan(peakSlipTan(s.model.tyreFront, 0.5 * (s.wheelLoad[0] + s.wheelLoad[1]), DRY));
}

/**
 * The road-wheel angles (rad, positive left) the steering limit allows: the front axle's course, plus and minus the
 * share of peak slip; on the side that turns the car the way it is turning round, closed in toward the course as its
 * rear slides past its peak slip angle (physics rearSlip, SLIDE_FROM to SLIDE_FULL of it) or as it turns faster than a
 * steady corner allows (SPIN_FROM to SPIN_FULL), each `room` times further in a drift. Closed all the way, the front
 * wheels point where the front axle is going and push neither way: the rear's grip straightens the car. (Held at the
 * front's peak there, a family sedan after a keyboard lane change wound itself into a 55 degree slide.) Null below the
 * speed where it applies.
 */
export function steerWindow(s: VehicleState, share: number, room = 1): { lo: number; hi: number; fade: number } | null {
  // At a walk the course angle means little and a car must reach full lock to park: the limit fades in from 3 to 6 m/s.
  const fade = Math.min(1, Math.max(0, (s.u - 3) / 3));
  if (!(fade > 0)) return null;
  const m = s.model, course = Math.atan2(s.v + m.chassis.a * s.r, s.u), lim = share * frontPeakSlip(s);
  // The rear sliding to the left (positive) turns the car round to the right: the bound below the course closes.
  const slip = rearSlip(s), slide = ramp(Math.abs(slip), SLIDE_FROM * room, SLIDE_FULL * room);
  const spin = ramp(Math.abs(s.r) * s.u / (0.5 * (m.tyreFront.muY0 + m.tyreRear.muY0) * G), SPIN_FROM * room, SPIN_FULL * room);
  const closeLo = Math.max(slip > 0 ? slide : 0, s.r < 0 ? spin : 0), closeHi = Math.max(slip < 0 ? slide : 0, s.r > 0 ? spin : 0);
  return { lo: course - lim * (1 - closeLo), hi: course + lim * (1 - closeHi), fade };
}

// 0 at or below `from`, 1 at or above `full`, in a straight line between.
function ramp(x: number, from: number, full: number): number {
  const k = (x - from) / (full - from);
  return k > 0 ? (k < 1 ? k : 1) : 0;
}

function drivenRange(m: VehicleModel): [number, number] {
  const l = m.driveline.layout;
  return l === 'FWD' ? [0, 1] : l === 'RWD' ? [2, 3] : [0, 3];
}

/**
 * Turns one sub-step's wish into the core's controls under a preset. `dt` is the sub-step (1/120 s); `tel` is the
 * telemetry of the step before. Writes steer, throttle, brake, handbrake, gear, nitrous and the three systems;
 * leaves clutch, autoClutch and launchOmega to the caller (they belong to the race start and the pulling away).
 */
export function applyAssists(cfg: AssistConfig, wish: DriverWish, s: VehicleState, tel: Telemetry, mem: AssistMemory,
  systems: SystemsChoice, c: Controls, dt: number): void {
  const m = s.model, maxSteer = m.chassis.maxSteer > 0 ? m.chassis.maxSteer : 0.6, speed = Math.abs(s.u);

  // Steering speed: toward the input, or back toward the centre, at the preset's rate (slower at speed in Casual).
  const target = Math.max(-1, Math.min(1, wish.steer));
  const back = Math.abs(target) < Math.abs(mem.steer) || target * mem.steer < 0;
  const rate = (back ? cfg.returnRate : cfg.steerRate) / (1 + speed / cfg.fallSpeed);
  const step = rate * dt;
  mem.steer = step >= 2 || !(step === step) ? target : mem.steer + Math.max(-step, Math.min(step, target - mem.steer));

  // The road-wheel angle the driver asks for: the steering slider scales lock per input, the rack stops it at full lock.
  let delta = Math.max(-maxSteer, Math.min(maxSteer, mem.steer * wish.steerMul * maxSteer));
  if (cfg.counterSteer > 0 && s.u > 0) {
    // Into the slide by the body's slip angle (the old model's assist, beta = atan2(v, max(|u|, 1.2))), fading in from 3 to 8 m/s.
    const beta = Math.atan2(s.v, Math.max(speed, 1.2));
    delta += cfg.counterSteer * Math.min(1, Math.max(0, (s.u - 3) / 5)) * beta;
  }
  if (cfg.slipShare !== null) {
    const w = steerWindow(s, cfg.slipShare, wish.drift ? cfg.driftRoom : 1);
    if (w) {
      const held = delta < w.lo ? w.lo : delta > w.hi ? w.hi : delta;
      delta += w.fade * (held - delta);
    }
  }
  c.steer = Math.max(-1, Math.min(1, delta / maxSteer));

  // Throttle: Casual eases it while the driven wheels spin past their tyres' peak (a forward launch or exit), and
  // gives it back over half a second once they grip.
  let throttle = wish.throttle;
  if (cfg.easeThrottle && !wish.drift) {
    const [first, last] = drivenRange(m);
    let over = 0;
    for (let i = first; i <= last; i++) {
      const p = i < 2 ? m.tyreFront : m.tyreRear, pk = peakSlipRatio(p, s.wheelLoad[i] > 0 ? s.wheelLoad[i] : 0, DRY);
      const k = pk > 0 ? tel.wheelSlipRatio[i] / pk : 0;
      if (k > over) over = k;
    }
    if (over > 1.25 && wish.throttle > 0) mem.ease = Math.max(0.25, mem.ease - dt * 6 * (over - 1.25));
    else mem.ease = Math.min(1, mem.ease + dt * 2);
    throttle *= mem.ease;
  } else mem.ease = 1;
  c.throttle = throttle;
  c.brake = wish.brake;
  c.handbrake = wish.handbrake;
  c.nitrous = wish.nitrous;

  // Gears: Casual is always automatic; reverse is reverse in every preset.
  c.gear = cfg.autoGears && wish.gear !== -1 ? AUTO_GEAR : wish.gear;

  // Systems: on (Casual, Standard) or as the driver has them (Pure); a drift turns stability and traction control off.
  const own = cfg.systems === 'on';
  c.abs = own ? true : systems.abs;
  c.tcs = !wish.drift && (own ? true : systems.tcs);
  c.esc = !wish.drift && (own ? true : systems.esc);
}
