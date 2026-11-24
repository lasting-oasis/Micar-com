// The game driven on the physics core (packages/physics DESIGN.md section 13). CoreDriver has the old Driver's surface
// (world/driver.ts): one Vehicle object that everything else reads and writes (walls, the race runner, the HUD, the
// sound, the camera), stepped at the same fixed 1/120 s from the render loop with the same fuel burn and collisions.
// Each sub-step:
//   1. reads from the Vehicle what the outside may have changed since the last one (a wall's push and bounce, the
//      race runner's pins and grid places, a respawn, a refill, a blown engine), sim to core: X = z, Y = x,
//      (hx, hy) = (cos h, sin h), u, v and r = w unchanged;
//   2. sorts the pedals as the old model does (the down pedal held at a standstill selects reverse) and turns the
//      Input into the core's Controls through the assist layer (assists.ts), steer = -Input.steer;
//   3. steps the core once (its own step is 1/120 s, in four substeps);
//   4. writes back every field a reader uses, in its old unit and sense, into the same Vehicle object.
// Race starts: while the race runner holds the car on the line, the brakes and the clutch are held and the throttle
// pedal sets the launch revs; at the green they are let go, and the clutch bites at those revs.
import { AUTO_GEAR, FLAT, createTelemetry, createVehicle, defaultControls, engineTorque, placeVehicle, setRolling, step, telemetry } from '@micar/physics';
import type { Controls, Telemetry, VehicleModel, VehicleState } from '@micar/physics';
import { makeVehicle, type Input, type Params, type Vehicle, type VehicleSpec } from '../physics';
import { FUEL_PER_MS, FUEL_PER_THR, MAX_FRAME, MAX_STEPS, STEP, type DriveOpts, type DriveState } from '../driver';
import { WORLD_PER_M } from '../units';
import { ASSISTS, DEFAULT_PRESET, applyAssists, assistMemory, peakSlipRatio, type AssistMemory, type AssistPreset, type DriverWish, type SystemsChoice } from './assists';
import { coreModelFor, type CoreCar, type CoreCarModel } from './model';
import { RPM, paramsFor, stepped } from './params';

const W = WORLD_PER_M;

/** The drive options with the race runner's hold: true while the runner holds the car on the start line (its count). */
export type CoreDriveOpts = DriveOpts & { held?: () => boolean };

/** What the scene needs of a driver, whichever model it drives on: world/driver.ts's Driver and CoreDriver both are one. */
export type DriverLike = {
  V: Vehicle;
  rebuild(spec: VehicleSpec, state: DriveState): void;
  place(x: number, z: number, h: number): void;
  stepFrame(dtFrame: number, input: Input, opts: DriveOpts): { impact: number; steps: number };
  pose(): { x: number; y: number; z: number; rotY: number };
};

// The old model's drive rules the readers were drawn for (world/physics.ts): the perfect-shift window
// (0.9 redline to redline + 150 rpm), the over-rev count (above redline + 100 rpm with the throttle down, the drag
// race blows the engine at 1.5 s), the blow-off valve's 0.4 s, the spin flags' 8/s and the accelerometer's 10/s.
const PERFECT_LO = 0.9, PERFECT_HI_RPM = 150, OVERREV_RPM = 100, OVERREV_MAX = 3, PERFECT_T = 1.2, BOV_T = 0.4;
const SPIN_RATE = 8, AX_RATE = 10;
/** A driven wheel counts as spinning (or locked) past this many times its tyre's peak slip ratio: the readers' spin flag. */
export const SPIN_PAST_PEAK = 1.5;
/** ... and its tread slides over the road at more than this, m/s (a walk). */
export const SPIN_SLIDE = 1.5;
/** The auto clutch bites at this share over idle when pulling away gently (the core's own bite is 1.15 x idle). */
const GENTLE_BITE = 1.15;
// Holding a converter car on the brake at the line: wheel speed (rad/s) that counts as creeping, and how fast the foot comes back.
const CREEP = 0.5, BACK_OFF = 0.97;

/** The engine speed (rad/s) a hard launch is made at: where the full-throttle curve (off boost) first reaches 90% of its peak, held between 1.5 x idle and 0.6 x redline. 0 for an electric car. */
export function bestLaunch(m: VehicleModel): number {
  const e = m.engine;
  if (e.kind === 'electric' || m.driveline.launch === 'direct') return 0;
  const table = e.kind === 'turbo' || e.kind === 'supercharged' ? e.offBoost : e.wot;
  const top = Math.min(e.n - 1, Math.floor(e.redline / e.dOmega));
  let peak = 0;
  for (let i = 0; i <= top; i++) if (table[i] > peak) peak = table[i];
  let at = e.redline;
  for (let i = 0; i <= top; i++) if (table[i] >= 0.9 * peak) { at = i * e.dOmega; break; }
  return Math.max(1.5 * e.idle, Math.min(0.6 * e.redline, at));
}

/** Why a car cannot hold a power slide, or null when it can: front-wheel drive, or an engine that cannot spin the rear tyres in second gear. */
export function cannotDrift(m: VehicleModel): string | null {
  const d = m.driveline, ch = m.chassis;
  if (d.layout === 'FWD') return 'front-wheel drive';
  const rear = d.layout === 'RWD' ? 1 : d.centre.kind === 'fixed' ? 1 - d.centre.frontShare : 0.5;
  let peak = 0;
  for (let i = 0; i < m.engine.n; i++) if (m.engine.wot[i] > peak) peak = m.engine.wot[i];
  const g = d.gears.length > 1 ? d.gears[1] : d.gears.length > 0 ? d.gears[0] : 0;
  const push = peak * g * d.finalDrive * d.efficiency * rear / m.tyreRear.radius;
  const load = ch.mass * 9.80665 * ch.a / ch.wheelbase, grip = m.tyreRear.muY0 * m.tyreRear.muXRatio * load;
  return push > grip ? null : 'the engine cannot spin the rear tyres';
}

/** The core's model of the car, its state, and the game's Vehicle it fills: the adapter between the two. */
export class CoreDriver implements DriverLike {
  /** This driver drives on the core (world/driver.ts's Driver drives on the old model). */
  readonly kind = 'core' as const;
  V: Vehicle;
  /** The core's model of the car and its build, and the car's state. */
  core: CoreCarModel;
  s: VehicleState;
  /** The assist preset (DESIGN.md 13), and the systems as a Pure driver has them switched. */
  preset: AssistPreset = DEFAULT_PRESET;
  systems: SystemsChoice = { abs: true, tcs: true, esc: true };
  /** Told when a drift is asked of a car that cannot drift (the scene puts it on the banner). */
  notice: ((txt: string) => void) | null;

  private readonly car: CoreCar;
  private steerMul = 1;
  private readonly c: Controls = defaultControls();
  private readonly tel: Telemetry = createTelemetry();
  private readonly mem: AssistMemory = assistMemory();
  private readonly wish: DriverWish = { steer: 0, steerMul: 1, throttle: 0, brake: 0, handbrake: 0, gear: AUTO_GEAR, nitrous: false, drift: false };
  private acc = 0;
  private readonly I = {} as Input;
  private readonly res = { impact: 0, steps: 0 };
  private readonly out = { x: 0, y: 0, z: 0, rotY: 0 };
  // What this driver last wrote into the Vehicle: a field that differs at the next sub-step was changed outside.
  private lx = 0; private lz = 0; private lh = 0; private lu = 0; private lv = 0; private lw = 0;
  private lgear = 1; private lrpm = 0; private lboost = 0; private lnos = 0;
  // The pedals and the gear lever: reverse selected, the old model's 0.25 s hold that selects it, a manual's gear.
  private reverse = false; private revHold = 0; private want = 1; private wasManual = false;
  // The race start: held on the line, the foot coming back off a creeping converter car, the launch revs set.
  private holding = false; private backOff = 1; private launch = 0;
  private lastThrottle = 0; private lastDrift = false;

  constructor(car: CoreCar, spec: VehicleSpec, state: DriveState, start: { x: number; z: number; h: number },
    extras: { adopt?: Vehicle; notice?: (txt: string) => void; preset?: AssistPreset } = {}) {
    this.car = car;
    this.notice = extras.notice ?? null;
    if (extras.preset) this.preset = extras.preset;
    this.core = coreModelFor(car, state.cfg.perf, state.tune);
    this.s = createVehicle(this.core.model);
    this.launch = bestLaunch(this.core.model);
    this.steerMul = steerMulOf(state);
    const P = paramsFor(this.core.model, spec, state.cfg.perf, state.tune);
    if (extras.adopt) {
      // Taking over a car the old model was driving: the same object, its place and speed kept.
      this.V = extras.adopt;
      this.V.P = P;
      this.V.nos = Math.min(Math.max(0, this.V.nos), P.nos.cap);
      placeVehicle(this.s, this.V.z, this.V.x, Math.cos(this.V.h), Math.sin(this.V.h));
      this.carryMotion(this.V.u, this.V.v, this.V.w, this.V.gear);
      this.s.nitrousLeft = this.nosMass(this.V.nos);
      this.writeBack(0);
    } else {
      this.V = makeVehicle(P);
      this.place(start.x, start.z, start.h);
    }
  }

  /** New parts or tune: the car keeps its place, speed and gear (DESIGN.md 13; world/driver.ts rebuild). */
  rebuild(spec: VehicleSpec, state: DriveState): void {
    const next = coreModelFor(this.car, state.cfg.perf, state.tune), V = this.V;
    this.steerMul = steerMulOf(state);
    if (next === this.core) return;
    const old = this.s;
    this.core = next;
    this.s = createVehicle(next.model);
    this.launch = bestLaunch(next.model);
    this.s.time = old.time; this.s.distance = old.distance; this.s.energyUsed = old.energyUsed;
    placeVehicle(this.s, old.x, old.y, old.hx, old.hy);
    const P = paramsFor(next.model, spec, state.cfg.perf, state.tune);
    V.P = P;
    V.nos = Math.min(V.nos, P.nos.cap);
    this.carryMotion(old.u, old.v, old.r, old.gear !== 0 ? old.gear : old.gearNext);
    this.s.nitrousLeft = this.nosMass(V.nos);
    this.writeBack(0);
  }

  /** Put the car at (x, z) metres facing h, stopped, in first gear, the engine idling (world/physics.ts resetVehicle). */
  place(x: number, z: number, h: number): void {
    const s = this.s, V = this.V;
    s.gear = 1; s.gearNext = 1; s.shiftTimer = 0;
    placeVehicle(s, z, x, Math.cos(h), Math.sin(h));
    if (stepped(s.model) && s.model.driveline.gears.length > 0) s.ratio = s.model.driveline.gears[0];
    this.resetPedals();
    V.x = x; V.z = z; V.h = h;
    V.u = V.v = V.w = V.vx = V.vz = V.ax = 0;
    V.steer = V.delta = V.beta = 0;
    V.overRev = 0; V.blown = false; V.hit = 0;
    this.writeBack(0);
    this.acc = 0;
  }

  /** Step the frame's worth of fixed 1/120 s sub-steps (dt clamped to 0.05 s, at most 6 steps), as world/driver.ts does. */
  stepFrame(dtFrame: number, input: Input, opts: DriveOpts): { impact: number; steps: number } {
    const V = this.V, I = Object.assign(this.I, input), held = (opts as CoreDriveOpts).held;
    this.acc += Math.min(MAX_FRAME, Math.max(0, dtFrame));
    let steps = 0, impact = 0;
    while (this.acc >= STEP - 1e-9 && steps < MAX_STEPS) {
      this.acc -= STEP;
      const J = opts.map ? opts.map(I, STEP) : I;
      const empty = opts.fuel() <= 0;
      if (empty) { if (V.gear === -1) J.back = 0; else J.fwd = 0; }
      this.subStep(J, opts.drift, held ? held() : false);
      if (!empty) opts.burn((FUEL_PER_THR * V.thr + FUEL_PER_MS * Math.abs(V.u)) * STEP);
      const imp = opts.collide(V); if (imp > impact) impact = imp;
      I.shiftUp = I.shiftDn = I.hop = false; // one-shot edges reach one sub-step
      steps++;
    }
    if (this.acc > STEP) this.acc = STEP;
    V.hit = impact;
    this.res.impact = impact; this.res.steps = steps;
    return this.res;
  }

  /** The car group's transform in world units (lofted bodies face -Z). One reused object. */
  pose(): { x: number; y: number; z: number; rotY: number } {
    const o = this.out, V = this.V;
    o.x = V.x * W; o.y = 0; o.z = V.z * W; o.rotY = V.h + Math.PI;
    return o;
  }

  /** One sub-step of 1/120 s with the input as the race runner and the fuel tank left it. */
  subStep(J: Input, drift: boolean, held: boolean): void {
    const s = this.s, c = this.c, m = s.model, V = this.V, dt = STEP;
    this.syncIn();
    const cfg = ASSISTS[this.preset];

    // The pedals, as the old model has them: the up pedal drives and the down pedal brakes; the down pedal held alone
    // for 0.25 s near a standstill selects reverse and then drives backward; the up pedal near a standstill selects drive.
    let thr: number, brk: number;
    if (this.reverse) {
      thr = J.back; brk = J.fwd;
      if (s.u > -0.8 && J.fwd > 0 && !J.back) { this.reverse = false; this.want = 1; thr = J.fwd; brk = 0; }
    } else {
      thr = J.fwd; brk = J.back;
      if (s.u < 0.8 && J.back > 0 && !J.fwd) {
        this.revHold += dt;
        if (this.revHold > 0.25) { this.reverse = true; thr = J.back; brk = 0; }
      } else this.revHold = 0;
    }

    // The gear lever: a manual's shift edges (first from reverse, reverse from first at a walk), else the car's own.
    const n = stepped(m) ? m.driveline.gears.length : 1, manual = J.manual && !cfg.autoGears;
    V.perfect = false;
    if (manual) {
      if (!this.wasManual) this.want = s.gear >= 1 ? s.gear : 1;
      if (J.shiftUp) {
        if (this.reverse) { this.reverse = false; this.want = 1; }
        else if (this.want < n && s.shiftTimer <= 0) {
          const rpm = this.tel.rpm, red = V.P.redline;
          if (rpm > red * PERFECT_LO && rpm <= red + PERFECT_HI_RPM) { V.perfectT = PERFECT_T; V.perfect = true; V.perfectN = (V.perfectN || 0) + 1; }
          this.want++; V.shiftFlash = 0.25;
        }
      }
      if (J.shiftDn && s.shiftTimer <= 0) {
        if (this.want > 1) this.want--;
        else if (!this.reverse && Math.abs(s.u) < 1.5) this.reverse = true;
      }
    } else this.want = s.gear >= 1 ? s.gear : 1;
    this.wasManual = manual;

    const w = this.wish;
    w.steer = -J.steer; w.steerMul = this.steerMul;
    w.throttle = thr; w.brake = brk; w.handbrake = J.hb ? 1 : 0; w.nitrous = J.nos; w.drift = drift;
    w.gear = this.reverse ? -1 : manual ? this.want : AUTO_GEAR;
    applyAssists(cfg, w, s, this.tel, this.mem, this.systems, c, dt);
    c.autoClutch = true; c.clutch = 0;
    // Pulling away: the auto clutch bites at revs the pedal sets, from a gentle 1.15 x idle to a hard launch's (an
    // auto clutch left at the core's own bite would bog a manual car at idle).
    const bite = GENTLE_BITE * m.engine.idle;
    c.launchOmega = this.launch > bite ? bite + Math.max(0, Math.min(1, thr)) * (this.launch - bite) : 0;

    if (held) this.holdAtLine(J.fwd);
    else if (this.holding) this.holding = false;
    // The race runner blew the engine: no drive (not even an automatic's creep) until the page mends it.
    if (V.blown) { c.throttle = 0; c.gear = 0; }
    if (drift && !this.lastDrift && this.notice) {
      const why = cannotDrift(m);
      if (why) this.notice(`This car cannot drift: ${why}`);
    }
    this.lastDrift = drift;

    const left = s.nitrousLeft, dist = s.distance;
    step(s, c, FLAT);
    telemetry(s, this.tel);
    this.afterStep(dt, left, dist, thr, J);
  }

  // The runner holds the car on the line: both brakes on, a clutch car's clutch pedal down, and the throttle pedal
  // setting the revs from idle to a hard launch's, which the right foot holds. A converter car is held on the brake
  // alone (its foot comes back if the driven wheels creep); an electric car simply waits.
  private holdAtLine(pedal: number): void {
    const s = this.s, c = this.c, m = s.model, e = m.engine, d = m.driveline;
    if (!this.holding) { this.holding = true; this.backOff = 1; }
    this.reverse = false; this.revHold = 0;
    c.gear = c.gear === -1 ? AUTO_GEAR : c.gear;
    c.brake = 1; c.handbrake = 1; c.nitrous = false;
    if (this.launch <= 0) { c.throttle = 0; return; }
    const p = Math.max(0, Math.min(1, pedal)), target = e.idle + p * (this.launch - e.idle);
    if (d.launch === 'clutch') { c.autoClutch = false; c.clutch = 1; }
    c.launchOmega = target;
    if (p <= 0) { c.throttle = 0; return; }
    // The throttle at which the engine, unloaded, makes no torque at the target (it settles there), and a correction
    // for the speed it is off by.
    const t0 = engineTorque(e, target, 0, s.boost), t1 = engineTorque(e, target, 1, s.boost);
    const hold = t1 > t0 ? -t0 / (t1 - t0) : 0;
    let th = hold + 4 * (target - s.engineOmega) / target;
    if (d.launch === 'converter') {
      let creeping = false;
      for (let i = 0; i < 4; i++) if (Math.abs(s.wheelOmega[i]) > CREEP) creeping = true;
      if (creeping) this.backOff *= BACK_OFF;
      th = th * this.backOff;
    }
    c.throttle = Math.max(0, Math.min(1, th));
  }

  // Everything the outside may have written since this driver's last sub-step, into the core's state.
  private syncIn(): void {
    const V = this.V, s = this.s;
    const stopped = V.u === 0 && V.v === 0 && V.w === 0;
    const dx = V.x - this.lx, dz = V.z - this.lz;
    if (dx * dx + dz * dz > 4 && stopped) {
      // Moved more than 2 m and stopped: a grid place, a respawn, a snap to the road (resetVehicle, snapToRoad).
      placeVehicle(s, V.z, V.x, Math.cos(V.h), Math.sin(V.h));
      this.resetPedals();
    } else {
      if (dx !== 0 || dz !== 0) { s.x = V.z; s.y = V.x; }
      if (V.h !== this.lh) { s.hx = Math.cos(V.h); s.hy = Math.sin(V.h); }
      if (V.u !== this.lu || V.v !== this.lv || V.w !== this.lw) {
        // A wall's bounce, a car's push, the runner's pins: the body's speeds change at once; the wheels keep turning
        // and their tyres take it up as slip, unless the car was stopped dead (held on the line, put somewhere).
        s.u = V.u; s.v = V.v; s.r = V.w;
        if (stopped) this.stopWheels();
      }
    }
    if (V.gear !== this.lgear) {
      if (V.gear === -1) this.reverse = true;
      else {
        const n = stepped(s.model) ? s.model.driveline.gears.length : 1, g = Math.max(1, Math.min(n, Math.round(V.gear) || 1));
        this.reverse = false; this.want = g; s.gear = g; s.gearNext = g; s.shiftTimer = 0;
      }
    }
    if (V.rpm !== this.lrpm && V.rpm > 0) s.engineOmega = V.rpm * RPM;
    if (V.boost !== this.lboost) s.boost = Math.max(0, Math.min(1, V.boost));
    if (V.nos !== this.lnos) s.nitrousLeft = this.nosMass(V.nos);
  }

  // Every field a reader uses, in its old unit and sense.
  private afterStep(dt: number, nitrousBefore: number, distBefore: number, pedal: number, J: Input): void {
    const V = this.V, s = this.s, c = this.c, m = s.model, P = V.P;
    // Nitrous flowed this sub-step if the bottle went down. A real bottle holds minutes of shot and, as DESIGN.md 11
    // has it, stays empty until refilled (the race runner fills it at every start): the old model's slow refill of its
    // few seconds is not carried over.
    V.nosOn = s.nitrousLeft < nitrousBefore;
    // Blow-off: the throttle shut on a boosted turbo.
    if (m.engine.kind === 'turbo' && this.lastThrottle > 0.3 && c.throttle < 0.1 && s.boost > 0.5 && V.bov <= 0) V.bov = BOV_T;
    if (V.bov > 0) V.bov -= dt;
    this.lastThrottle = c.throttle;
    V.thr = V.blown ? pedal : c.throttle;
    V.brk = c.brake;
    V.hand = c.handbrake > 0;
    V.steer = c.steer;
    V.revHold = this.revHold;
    if (V.perfectT > 0) V.perfectT -= dt;
    if (V.shiftFlash > 0) V.shiftFlash -= dt;
    // Spin flags: an axle whose wheel spins or locks well past its tyre's peak slip, and visibly so (its tread moving
    // over the road at a walk or more: a car braked to a stop is not skidding), followed at 8/s.
    let f = 0, r = 0;
    for (let i = 0; i < 4; i++) {
      const p = i < 2 ? m.tyreFront : m.tyreRear, pk = peakSlipRatio(p, s.wheelLoad[i]);
      const slide = Math.abs(s.wheelOmega[i] * p.radius - s.u);
      if (pk > 0 && slide > SPIN_SLIDE && Math.abs(this.tel.wheelSlipRatio[i]) > SPIN_PAST_PEAK * pk) { if (i < 2) f = 1; else r = 1; }
    }
    const k = Math.min(1, dt * SPIN_RATE);
    V.spinF += (f - V.spinF) * k; V.spinR += (r - V.spinR) * k;
    // The old model's over-rev count, on the core's revs and the runner's 1.5 s.
    const rpm = this.tel.rpm;
    V.overRev = Math.max(0, Math.min(OVERREV_MAX, V.overRev + ((rpm > P.redline + OVERREV_RPM && c.throttle > 0 && s.shiftTimer <= 0) ? dt : -dt * 2)));
    let fx = 0;
    for (let i = 0; i < 4; i++) fx += s.wheelFx[i];
    V.Fdrive = fx;
    V.odo += Math.abs(s.distance - distBefore);
    hydStep(V, J, dt);
    this.writeBack(dt);
    V.top = Math.max(V.top, Math.abs(V.u));
  }

  // The state's place, speeds, engine and gear into the Vehicle (the fields the outside may write), and a note of them.
  private writeBack(dt: number): void {
    const V = this.V, s = this.s, m = s.model;
    // Heading: the core turns a unit vector; the game's h is an angle that is never wrapped, so it takes the turn.
    const h0 = Number.isFinite(V.h) ? V.h : 0, ch = Math.cos(h0), sh = Math.sin(h0);
    V.h = h0 + Math.atan2(ch * s.hy - sh * s.hx, ch * s.hx + sh * s.hy);
    V.x = s.y; V.z = s.x;
    V.u = s.u; V.v = s.v; V.w = s.r;
    V.vz = s.u * s.hx - s.v * s.hy; V.vx = s.u * s.hy + s.v * s.hx;
    V.ax += (s.ax - V.ax) * Math.min(1, dt * AX_RATE);
    V.beta = Math.atan2(s.v, Math.max(Math.abs(s.u), 1.2));
    V.delta = 0.5 * (s.wheelSteer[0] + s.wheelSteer[1]);
    V.rpm = Math.max(0, s.engineOmega / RPM);
    // -1 reverse, a forward gear; never 0 (the old model has no neutral and the HUD would print it): mid-shift into
    // neutral reads as the gear it is going to, or the last one.
    let g = s.gear;
    if (g === 0) g = s.gearNext !== 0 ? s.gearNext : this.lgear !== 0 ? this.lgear : 1;
    V.gear = g;
    V.shift = s.shiftTimer > 0 ? s.shiftTimer : 0;
    V.boost = m.engine.kind === 'turbo' || m.engine.kind === 'supercharged' ? Math.max(0, Math.min(1, s.boost)) : 0;
    V.nos = this.nosSeconds(s.nitrousLeft);
    this.lx = V.x; this.lz = V.z; this.lh = V.h; this.lu = V.u; this.lv = V.v; this.lw = V.w;
    this.lgear = V.gear; this.lrpm = V.rpm; this.lboost = V.boost; this.lnos = V.nos;
  }

  // The body set moving at the speeds given, the wheels and the engine with it, in the gear it was in (reverse, or a
  // forward gear the new box has: its top if it has fewer).
  private carryMotion(u: number, v: number, r: number, gear: number): void {
    const s = this.s, m = s.model, d = m.driveline;
    if (u !== 0 || r !== 0) setRolling(s, u, r);
    s.v = v;
    this.resetPedals();
    if (gear === -1) { this.reverse = true; s.gear = -1; s.gearNext = -1; }
    else if (gear >= 1 && stepped(m) && d.gears.length > 0) {
      const g = Math.min(Math.round(gear), d.gears.length);
      s.gear = g; s.gearNext = g; s.shiftTimer = 0; s.ratio = d.gears[g - 1];
      const l = d.layout, first = l === 'RWD' ? 2 : 0, last = l === 'FWD' ? 1 : 3;
      let wd = 0;
      for (let i = first; i <= last; i++) wd += s.wheelOmega[i];
      wd /= last - first + 1;
      const geared = s.ratio * d.finalDrive * wd;
      s.engineOmega = geared > m.engine.idle ? geared : m.engine.idle;
    }
    this.want = s.gear >= 1 ? s.gear : 1;
  }

  private stopWheels(): void {
    const s = this.s;
    for (let i = 0; i < 4; i++) { s.wheelOmega[i] = 0; s.wheelDefX[i] = 0; s.wheelDefY[i] = 0; s.wheelSlipRatio[i] = 0; s.wheelSlipTan[i] = 0; }
  }

  private resetPedals(): void {
    this.reverse = false; this.revHold = 0; this.want = 1; this.holding = false; this.backOff = 1;
    this.mem.steer = 0; this.mem.ease = 1;
  }

  // Nitrous between the core's kilograms and the game's seconds of shot.
  private nosSeconds(kg: number): number { const n = this.s.model.nitrous; return n !== null && n.flow > 0 ? kg / n.flow : 0; }
  private nosMass(seconds: number): number {
    const n = this.s.model.nitrous;
    return n !== null && n.flow > 0 ? Math.max(0, Math.min(n.bottleMass, seconds * n.flow)) : 0;
  }
}

/** The Garage's steering slider as lock per input (world/physics.ts carParams steerMul): 0.8 slow to 1.2 quick. */
function steerMulOf(state: DriveState): number {
  const t = state.tune?.steer;
  return 1 + 0.2 * (typeof t === 'number' && Number.isFinite(t) ? Math.max(-1, Math.min(1, t)) : 0);
}

/** The hydraulics kit's springs (world/physics.ts hydStep, unchanged): looks only, the car's physics never sees them. */
function hydStep(V: Vehicle, I: Input, dt: number): void {
  const H = V.hyd, k = 70, c = 9;
  const tf = I.hyd && I.hydF ? 1 : 0, tr = I.hyd && I.hydR ? 1 : 0, tl = I.hyd ? (I.hydL ? 1 : I.hydRt ? -1 : 0) : 0;
  if (I.hop && H.hop <= 0) { H.vf += 4.5; H.vr += 4.5; H.hop = 0.6; }
  if (H.hop > 0) H.hop -= dt;
  H.vf += (k * (tf * 0.3 - H.f) - c * H.vf) * dt; H.f += H.vf * dt;
  H.vr += (k * (tr * 0.3 - H.r) - c * H.vr) * dt; H.r += H.vr * dt;
  H.vl += (k * (tl * 0.25 - H.l) - c * H.vl) * dt; H.l += H.vl * dt;
}

/** Whether a driver drives on the core. */
export function isCoreDriver(d: DriverLike | null | undefined): d is CoreDriver {
  return !!d && (d as { kind?: string }).kind === 'core';
}

/** The P the driver keeps on its Vehicle (tests). */
export function paramsOf(d: DriverLike): Params { return d.V.P; }
