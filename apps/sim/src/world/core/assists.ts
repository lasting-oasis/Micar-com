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
// In a drift (the drift event, the X toggle, the Drift button) stability and traction control are off, and Casual
// stops easing the throttle: a slide is what is wanted.
import type { Controls, Telemetry, TyreParams, VehicleModel, VehicleState } from '@micar/physics';
import { AUTO_GEAR } from '@micar/physics';

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
};

/** The presets' numbers. */
export const ASSISTS: Readonly<Record<AssistPreset, Readonly<AssistConfig>>> = {
  // Just under the peak (0.9 of it); a keyboard press takes 0.22 s to full lock at a standstill and about 0.8 s at
  // 100 km/h: a quick stab cannot throw the car past its grip.
  casual: { slipShare: 0.9, steerRate: 4.5, returnRate: 6, fallSpeed: 10, counterSteer: 0.8, easeThrottle: true, autoGears: true, systems: 'on' },
  // A little past the peak (1.15 of it), so the front can be leant on; the old model's own steering speeds (7 and 10).
  standard: { slipShare: 1.15, steerRate: 7, returnRate: 10, fallSpeed: Infinity, counterSteer: 0, easeThrottle: false, autoGears: false, systems: 'on' },
  // The wheel goes where it is put, at once.
  pure: { slipShare: null, steerRate: Infinity, returnRate: Infinity, fallSpeed: Infinity, counterSteer: 0, easeThrottle: false, autoGears: false, systems: 'driver' },
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

// The tyre's friction and stiffness as tyre.ts works them out (SHAPE 2, friction held to 0.55 to 1.25 of the reference
// figure). @micar/physics does not export tyre.ts's peakSlipTan or peakSlipRatio, so the two are worked out here from
// the same TyreParams by the same formulas.
const SHAPE = 2;
function muY(p: TyreParams, fz: number): number {
  const base = p.muY0, mu = base * (1 - p.loadSens * (fz / p.fz0 - 1));
  return mu < 0.55 * base ? 0.55 * base : mu > 1.25 * base ? 1.25 * base : mu;
}

/** Tangent of the slip angle at which a tyre's side force peaks, on dry asphalt, at this load (tyre.ts peakSlipTan). */
export function peakSlipTan(p: TyreParams, fz: number): number {
  const load = fz > 0 ? fz : 0, n0 = p.fz0 / p.fzStiffPeak, n = load / p.fzStiffPeak;
  const perLoad = p.cAlpha0 * (1 + n0 * n0) / (p.fz0 * (1 + n * n));
  return perLoad > 0 ? SHAPE * muY(p, load) / perLoad : 0;
}

/** Slip ratio at which a tyre's driving force peaks, on dry asphalt, at this load (tyre.ts peakSlipRatio). */
export function peakSlipRatio(p: TyreParams, fz: number): number {
  return p.cKappaPerFz > 0 ? SHAPE * muY(p, fz > 0 ? fz : 0) * p.muXRatio / p.cKappaPerFz : 0;
}

/** The front tyres' peak slip angle, rad, at their present loads. */
export function frontPeakSlip(s: VehicleState): number {
  return Math.atan(peakSlipTan(s.model.tyreFront, 0.5 * (s.wheelLoad[0] + s.wheelLoad[1])));
}

/** The road-wheel angles (rad, positive left) the steering limit allows: the front axle's course, plus and minus the share of peak slip. Null below the speed where it applies. */
export function steerWindow(s: VehicleState, share: number): { lo: number; hi: number; fade: number } | null {
  // At a walk the course angle means little and a car must reach full lock to park: the limit fades in from 3 to 6 m/s.
  const fade = Math.min(1, Math.max(0, (s.u - 3) / 3));
  if (!(fade > 0)) return null;
  const course = Math.atan2(s.v + s.model.chassis.a * s.r, s.u), lim = share * frontPeakSlip(s);
  return { lo: course - lim, hi: course + lim, fade };
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
    const w = steerWindow(s, cfg.slipShare);
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
      const p = i < 2 ? m.tyreFront : m.tyreRear, pk = peakSlipRatio(p, s.wheelLoad[i]);
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
