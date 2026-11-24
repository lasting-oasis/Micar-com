// Opponents on the same physics as the player (packages/physics DESIGN.md section 14). With the switch on (switch.ts),
// every computer racer in a Strip event is a real car of the physics core driven by a pilot (pilot.ts): the car the
// player drives, so the field is of the player's class and the race is decided by driving; its racing line from the
// circuit's centreline and width (line.ts); its own limit lap from that car's envelope (lap.ts); a skill, a reaction
// time and a precision seeded per opponent from the race's seed. Nobody's speed depends on the gap to anyone.
//
// The race runner (strip/events.ts) and everything that draws or times a racer keep reading the old AI's fields
// (strip/ai.ts AI): x, z in metres, h in radians (0 faces +Z, never wrapped), v in m/s along h, s cumulative metres
// along the route by routeProgress, steer as the front wheels' angle. A CoreField writes them from its cars after
// each frame, as the old AI did, and reads back what the outside changed in between (the player's car pushing one:
// strip/ai.ts collideCar moves x, z and takes 15% off v).
//
// Coordinates: the core's world plane is X = z, Y = x, heading (cos h, sin h), as the player's adapter has it
// (driver.ts). Each car is stepped at the core's own 1/120 s; the runner calls once a frame with that frame's time
// (0 to 0.05 s), and the remainder carries to the next frame, so the cars move the same whatever the frame rate.
//
// Racers keep apart: a car closing on another on its path steers round it where the road is straight (it never lifts
// for it), and two cars that do touch are pushed apart, as the old AI's were.
import {
  EDGE_SPARE, FLAT, STEP, arc, centrelineFrom, createPilot, createPlace, createVehicle, defaultControls, limitLap, measureEnvelope,
  pilotTraits, placeOnTrack, placeVehicle, racingLine, resolveModel, sheetFromAuthored, step, straight,
} from '@micar/physics';
import type { AuthoredSpec, BodyClass, Controls, Envelope, LapProfile, PathPlace, Pilot, PilotTraits, RacingLine, VehicleModel, VehicleState } from '@micar/physics';
import { ARCHETYPES, FLEET_NAMES, type BodyStyle } from '../data';
import type { Params, Vehicle, VehicleSpec } from '../physics';
import { routeProgress, type Route } from '../strip/routes';
import type { TrackData } from '../strip/district';
import { bestLaunch } from './driver';
import { FLEET_CLASS, STYLE_CLASS } from './model';
import { RPM } from './params';

/* ------------------------------------------------------------------ the race's dice */

/**
 * A seeded source of numbers from 0 to 1 (mulberry32, the same generator the core's math.ts uses): the same seed gives
 * the same sequence on every machine. Every draw that decides a race with the switch on comes from one of these.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh race seed, for a race nobody asked to replay. */
export function newSeed(): number { return Math.floor(Math.random() * 4294967296) >>> 0; }

/* ------------------------------------------------------------------ what is worked out once */

const envelopes = new WeakMap<VehicleModel, Envelope>();
/**
 * A car's envelope (lap.ts measureEnvelope: about half a second of computing), measured once per model and kept: the
 * same car and build give the same model object back (model.ts coreModelFor), so a car's first race pays for it.
 */
export function envelopeOf(model: VehicleModel): Envelope {
  let e = envelopes.get(model);
  if (!e) { e = measureEnvelope(model); envelopes.set(model, e); }
  return e;
}

/** Measure a car's envelope ahead of its first race (when the player gets into it, say), so the start does not wait for it. */
export function prewarmOpponents(model: VehicleModel): void { envelopeOf(model); }

const circuitLines = new WeakMap<TrackData, RacingLine>();
/**
 * A circuit's racing line (line.ts racingLine) from its centreline and width, in the core's plane (X = z, Y = x, the
 * track's offset applied): built once per loaded track. Every route of a circuit (its laps, its sprint, its drift
 * sector) runs along that centreline in the same direction, so the one line serves them all.
 */
export function circuitLine(track: TrackData): RacingLine {
  let line = circuitLines.get(track);
  if (!line) {
    const pts = track.centre.pts, n = pts.length, ox = track.offset[0], oz = track.offset[1];
    const X = new Float64Array(n), Y = new Float64Array(n);
    for (let i = 0; i < n; i++) { X[i] = pts[i][1] + oz; Y[i] = pts[i][0] + ox; }
    line = racingLine(X, Y, track.centre.width);
    circuitLines.set(track, line);
  }
  return line;
}

const fallbackModels = new WeakMap<VehicleSpec, VehicleModel>();
/**
 * The core's model of the car whose old-model Params these are, when nothing better is known: its drawn figures
 * (Params.spec, an authored record) resolved stock through sheetFromAuthored, as model.ts does for a rental. Used only
 * when the race runner has not been told the player's own core model.
 */
export function modelFromParams(P: Params): VehicleModel {
  const spec = P.spec;
  let m = fallbackModels.get(spec);
  if (!m) {
    const fleet = FLEET_NAMES[spec.name];
    const bodyClass: BodyClass = fleet ? FLEET_CLASS[fleet] : spec.id in ARCHETYPES ? STYLE_CLASS[spec.id as BodyStyle] : 'coupe';
    const authored: AuthoredSpec = { id: `opponent-${spec.id}`, name: spec.name, drive: spec.drive, mass: spec.mass, a: spec.a, b: spec.b, h: spec.h,
      cd: spec.cd, area: spec.area, redline: spec.redline, r: spec.r, fin: spec.fin, gears: spec.gears.slice(), tq: spec.tq.map(q => [q[0], q[1]] as [number, number]) };
    m = resolveModel(sheetFromAuthored(authored, bodyClass)).model;
    fallbackModels.set(spec, m);
  }
  return m;
}

/* ------------------------------------------------------------------ the fixed figures */

/** Two cars this far apart side to side, centre to centre, m, clear each other. */
export const PASS_CLEAR = 2.4;
/** ... and one passing another aims this far to its side, m. */
export const PASS_SIDE = 2.7;
/** How far ahead a car looks for one in its way: this many metres, plus PASS_TIME seconds of the speed it closes at. */
export const PASS_LOOK = 8;
export const PASS_TIME = 1.5;
/** How quickly it moves across to pass and back, m/s: a lane change over a couple of seconds. */
export const PASS_RATE = 1.5;
/**
 * Passing is done where the road is straight: a car moves off its line by more than PASS_CORNER m only while its line
 * bends no tighter than PASS_BEND (1/m, a 150 m radius) for the next PASS_AHEAD s of travel and 20 m. In a corner
 * the cars run in single file on their lines, as drivers do (off the line in a corner is off the speed the plan
 * holds there).
 */
export const PASS_BEND = 1 / 150;
export const PASS_AHEAD = 1.5;
export const PASS_CORNER = 0.8;
/** Two cars touch when any of their two circles (at PASS_BODY m ahead of and behind the centre) come within CONTACT m. */
export const CONTACT = 2.1;
const PASS_BODY = 1.2;

/* ------------------------------------------------------------------ one car */

/** The old AI's fields a core racer keeps current (strip/ai.ts AI). */
export type RacerLike = {
  x: number; z: number; h: number; v: number; s: number; steer: number; vmax: number;
  hold: boolean; done: boolean; parked: boolean; route: Route | null;
};

/** The player's car as the opponents see it: where it is and how fast it goes (the old Vehicle's fields). */
export type PlayerLike = { x: number; z: number; u: number };

/**
 * One computer racer on the core: its car, the controls it sets, its pilot, who it is, and what it last wrote into
 * its racer (to see what the outside changed since).
 */
export class CoreRacer {
  readonly s: VehicleState;
  readonly c: Controls = defaultControls();
  readonly pilot: Pilot;
  readonly traits: PilotTraits;
  /** Seconds of its reaction left after the green before it moves. */
  wait: number;
  /** How far it has moved off its line to pass someone, m (left positive), where that is heading, and the side it chose (0: none). */
  pass = 0; passWant = 0; passSide = 0;
  /** Where it is against the track this step (distance along the centreline, offset from it). */
  readonly place: PathPlace = createPlace();
  hint = -1;
  private readonly launch: number;
  private lx = 0; private lz = 0; private lv = 0;

  constructor(model: VehicleModel, line: RacingLine, env: Envelope, traits: PilotTraits, x: number, z: number, fx: number, fz: number) {
    this.traits = traits;
    this.pilot = createPilot(model, line, env, traits);
    this.s = createVehicle(model);
    placeVehicle(this.s, z, x, fz, fx);
    this.wait = this.pilot.traits.reaction;
    this.launch = bestLaunch(model);
  }

  /** What the outside changed since this car last wrote its racer: a push moves the car, a speed taken off slows its body (its wheels keep turning and their tyres take it up). */
  syncIn(R: RacerLike): void {
    const s = this.s;
    if (R.x !== this.lx || R.z !== this.lz) { s.x += R.z - this.lz; s.y += R.x - this.lx; }
    if (R.v !== this.lv && this.lv > 0.1) { const k = R.v / this.lv; s.u *= k; s.v *= k; }
  }

  /** The racer's fields from the car, in the old AI's units and sense; its distance along the route by routeProgress, as the old AI found it. */
  writeBack(R: RacerLike, dt: number): void {
    const s = this.s;
    const h0 = Number.isFinite(R.h) ? R.h : 0, ch = Math.cos(h0), sh = Math.sin(h0);
    R.h = h0 + Math.atan2(ch * s.hy - sh * s.hx, ch * s.hx + sh * s.hy);
    R.x = s.y; R.z = s.x;
    R.v = s.u > 0 ? s.u : 0;
    R.steer = 0.5 * (s.wheelSteer[0] + s.wheelSteer[1]);
    if (R.route && dt > 0) R.s = routeProgress(R.route, R.x, R.z, R.s + R.v * dt, 40).s;
    this.lx = R.x; this.lz = R.z; this.lv = R.v;
  }

  /** One step of 1/120 s: the pilot drives toward its line moved `pass` metres to the side, and the core steps the car. */
  drive(line: RacingLine): void {
    const s = this.s, c = this.c, x0 = s.x, y0 = s.y;
    if (this.pass !== 0) {
      // The pilot is shown the car `pass` metres to the other side of where it is, so it steers to its line that far over.
      const i = this.place.index;
      s.x = x0 - this.pass * line.nx[i]; s.y = y0 - this.pass * line.ny[i];
    }
    this.pilot.control(s, c);
    s.x = x0; s.y = y0;
    // Pulling away, the clutch bites at a hard launch's revs, as the player's adapter lets it at full pedal.
    c.launchOmega = this.launch;
    step(s, c, FLAT);
  }
}

/* ------------------------------------------------------------------ the field */

/** A racer that may drive on the core: the old AI's fields, and its car when it has one. */
export type FieldRacer = RacerLike & { core?: CoreRacer; remote?: boolean };

/**
 * The computer racers of one lap race (circuit, sprint, street X or drift) on the core: the car they drive (the
 * player's), its envelope, the circuit's racing line, the route they are timed on and the race's seeded draws.
 */
export class CoreField {
  readonly model: VehicleModel;
  readonly env: Envelope;
  readonly line: RacingLine;
  readonly route: Route;
  /** The race's seeded draws (seededRandom): every pilot's seed, and the runner's grid, names and drift scores. */
  readonly rand: () => number;
  readonly cars: CoreRacer[] = [];
  private acc = 0;
  private readonly player = createPlace();
  private playerHint = -1;
  private limitCache: LapProfile | null = null;

  constructor(model: VehicleModel, line: RacingLine, route: Route, rand: () => number) {
    this.model = model;
    this.env = envelopeOf(model);
    this.line = line;
    this.route = route;
    this.rand = rand;
  }

  /** The car's limit lap on this circuit's line (lap.ts limitLap): the fastest it can go round, no driver in the loop. */
  get limit(): LapProfile {
    if (!this.limitCache) this.limitCache = limitLap(this.line, this.env);
    return this.limitCache;
  }

  /**
   * A racer of this field: the car on its grid place (x, z m), facing the route's direction there (fx, fz, a unit
   * vector in the game's plane), with a pilot seeded from the race's draws. Its vmax becomes the average speed its own
   * plan laps at over 0.8, so the runner's estimate for a racer not yet home (the rest of the way at 0.8 vmax) is
   * the rest of the way at the speed it is lapping.
   */
  add(R: FieldRacer, x: number, z: number, fx: number, fz: number): CoreRacer {
    const traits = pilotTraits(Math.floor(this.rand() * 4294967296) >>> 0);
    const car = new CoreRacer(this.model, this.line, this.env, traits, x, z, fx, fz);
    R.core = car;
    R.vmax = this.line.centreLength / car.pilot.plan.lapTime / 0.8;
    car.writeBack(R, 0);
    this.cars.push(car);
    return car;
  }

  /**
   * One frame of the race for the field: what the outside did to each car read in, the cars stepped at 1/120 s for
   * the frame's time (the rest carried to the next frame), and their racers' fields written. A racer held (before the
   * green, after the player's finish), home or parked is not stepped and stands where it is, as the old AI did.
   */
  frame(racers: readonly FieldRacer[], dt: number, player: PlayerLike | null): void {
    for (const R of racers) if (R.core) R.core.syncIn(R);
    if (dt > 0) {
      this.acc += dt;
      while (this.acc >= STEP - 1e-9) { this.acc -= STEP; this.subStep(racers, player); }
    }
    for (const R of racers) if (R.core) R.core.writeBack(R, dt);
  }

  private subStep(racers: readonly FieldRacer[], player: PlayerLike | null): void {
    const line = this.line;
    for (const R of racers) {
      const car = R.core;
      if (!car || R.hold || R.done || R.parked) continue;
      placeOnTrack(line, car.s.x, car.s.y, car.hint, car.place);
      car.hint = car.place.index;
    }
    let pl: PathPlace | null = null;
    if (player) {
      placeOnTrack(line, player.z, player.x, this.playerHint, this.player);
      this.playerHint = this.player.index;
      pl = this.player;
    }
    for (const R of racers) {
      const car = R.core;
      if (!car || R.hold || R.done || R.parked) continue;
      if (car.wait > 0) { car.wait -= STEP; continue; }
      this.steerClear(car, racers, pl, player ? player.u : 0);
      car.drive(line);
    }
    this.contacts(racers);
  }

  // Where a car aims to be to pass: the most pressing car in its way ahead (closing on it, on its path) or alongside
  // (overlapping it), and a side of that car; back onto its own line when nobody is there. Its speed is never
  // changed: only its path.
  private steerClear(me: CoreRacer, racers: readonly FieldRacer[], pl: PathPlace | null, playerSpeed: number): void {
    // The room the pilot allows its own aim (pilot.ts): the line's band, less the spare its reaction time asks for.
    const line = this.line, room = line.width / 2 - line.margin - EDGE_SPARE * me.pilot.traits.reaction, half = room > 0 ? room : 0;
    const lineOff = line.offset[me.place.index] + me.pilot.aim;
    this.worst = Infinity; this.want = 0; this.side = 0;
    for (const R of racers) {
      const car = R.core;
      if (!car || car === me || R.done || R.parked) continue;
      this.consider(me, lineOff, half, car.place.s, car.place.offset, car.s.u);
    }
    if (pl) this.consider(me, lineOff, half, pl.s, pl.offset, playerSpeed);
    me.passSide = this.side;
    let want = this.worst < Infinity ? this.want : 0;
    // In a corner, single file: no further off the line than PASS_CORNER.
    if (this.bends(me)) want = want > PASS_CORNER ? PASS_CORNER : want < -PASS_CORNER ? -PASS_CORNER : want;
    // Never past the room the road leaves.
    if (lineOff + want > half) want = half - lineOff; else if (lineOff + want < -half) want = -half - lineOff;
    me.passWant = want;
    const d = want - me.pass, most = PASS_RATE * STEP;
    me.pass += d > most ? most : d < -most ? -most : d;
  }

  // Whether a car's line bends tighter than PASS_BEND anywhere over the next PASS_AHEAD s of travel and 20 m.
  private bends(me: CoreRacer): boolean {
    const line = this.line, n = line.n, reach = 20 + PASS_AHEAD * (me.s.u > 0 ? me.s.u : 0);
    const from = line.s[me.place.index];
    for (let k = 0, i = me.place.index; k < n; k++, i = i + 1 < n ? i + 1 : 0) {
      let d = line.s[i] - from;
      if (d < 0) d += line.length;
      if (d > reach) return false;
      if (line.k[i] > PASS_BEND || line.k[i] < -PASS_BEND) return true;
    }
    return false;
  }

  // The most pressing so far this step (smaller is sooner), the pass offset it asks for and the side it passes on.
  private worst = Infinity;
  private want = 0;
  private side = 0;

  // One other car, at track distance `at` and offset `off` (m), moving at `speed` (m/s): in the way ahead (closing
  // on it, on this car's path) or alongside (overlapping it). Ahead, it is passed on the side chosen before, else on
  // this car's own side of it if clearly on one, else on the side with more road; alongside, this car keeps to its own
  // side. Never on a side the road has no room for.
  private consider(me: CoreRacer, lineOff: number, half: number, at: number, off: number, speed: number): void {
    const L = this.line.centreLength, path = lineOff + me.pass, myOff = me.place.offset;
    let g = at - me.place.s;
    if (g > 0.5 * L) g -= L; else if (g < -0.5 * L) g += L;
    const closing = me.s.u - speed;
    const beside = g > -4 && g < 4 && Math.abs(off - myOff) < PASS_CLEAR;
    const ahead = !beside && g > 0 && g < PASS_LOOK + PASS_TIME * (closing > 0 ? closing : 0) && closing > -0.5 && Math.abs(off - path) < PASS_CLEAR;
    if (!ahead && !beside) return;
    const urgency = beside ? 0 : g;
    if (urgency >= this.worst) return;
    this.worst = urgency;
    const mine = myOff >= off ? 1 : -1, roomy = half - off >= off + half ? 1 : -1;
    let side = beside ? mine : me.passSide !== 0 ? me.passSide : Math.abs(myOff - off) > 1 ? mine : roomy;
    if (Math.abs(off + side * PASS_SIDE) > half) side = -side;
    this.side = side;
    this.want = off + side * PASS_SIDE - lineOff;
  }

  // Cars that touch are pushed apart (see touch).
  private contacts(racers: readonly FieldRacer[]): void {
    const n = racers.length;
    for (let i = 0; i < n; i++) {
      const A = racers[i], a = A.core;
      if (!a || A.hold || A.done || A.parked) continue;
      for (let j = i + 1; j < n; j++) {
        const B = racers[j], b = B.core;
        if (!b || B.hold || B.done || B.parked) continue;
        touch(a.s, b.s);
      }
    }
  }
}

// Two cars' circles: each car is two circles PASS_BODY m ahead of and behind its centre, touching at CONTACT m apart.
// Where they overlap they are pushed apart, in inverse proportion to their masses, and nothing else: their speeds are
// left alone, so a touch puts no slip on their tyres. (A real impulse would, and a pilot feels a tyre past its peak
// and lets off the brake into the next corner; through the point of contact it would also spin the car, and a pilot
// drives round its line and cannot catch a car turned round. The old AI's separateAIs moved positions too.) A car
// that keeps pressing into the one ahead is held back by it, which costs it the speed it presses with.
function touch(a: VehicleState, b: VehicleState): void {
  const dx0 = a.x - b.x, dy0 = a.y - b.y;
  if (dx0 > 8 || dx0 < -8 || dy0 > 8 || dy0 < -8) return;
  const ma = a.model.chassis.mass, mb = b.model.chassis.mass, wa = mb / (ma + mb), wb = ma / (ma + mb);
  for (let p = 0; p < 2; p++) {
    for (let q = 0; q < 2; q++) {
      const oa = p === 0 ? PASS_BODY : -PASS_BODY, ob = q === 0 ? PASS_BODY : -PASS_BODY;
      const ax = a.x + a.hx * oa, ay = a.y + a.hy * oa, bx = b.x + b.hx * ob, by = b.y + b.hy * ob;
      const dx = ax - bx, dy = ay - by, d = Math.sqrt(dx * dx + dy * dy);
      if (!(d < CONTACT) || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d, pen = CONTACT - d;
      a.x += nx * pen * wa; a.y += ny * pen * wa; b.x -= nx * pen * wb; b.y -= ny * pen * wb;
    }
  }
}

/* ------------------------------------------------------------------ a drag-strip car */

const dragLines = new WeakMap<Route, Map<string, RacingLine>>();
/** Past the strip's end the line runs on this far before it turns, m: further than any car needs to stop. */
export const DRAG_RUNOFF = 400;
/** The turns that close a drag lane into a loop: wide enough that no road car's top speed is limited by them, m. */
export const DRAG_TURN = 2000;

/**
 * A drag lane as a racing line: the strip from its start (p0 moved `lane` metres to its right) straight on for its
 * length and DRAG_RUNOFF more, closed into a loop by two turns of DRAG_TURN m so that a pilot can drive it (a line is
 * a loop) and its plan along the strip is flat out. The line is the lane itself (no room to move across).
 */
export function dragLine(route: Route, p0: { x: number; z: number }, fwd: readonly [number, number], right: readonly [number, number], lane: number): RacingLine {
  let byLane = dragLines.get(route);
  if (!byLane) { byLane = new Map(); dragLines.set(route, byLane); }
  const key = `${lane}|${p0.x}|${p0.z}|${fwd[0]}|${fwd[1]}`;
  let line = byLane.get(key);
  if (!line) {
    const run = route.len + DRAG_RUNOFF, half = Math.PI;
    const c = centrelineFrom([straight(run), arc(DRAG_TURN, half), straight(run), arc(DRAG_TURN, half)], 2);
    // Local (along, left) to the core's plane: start at the lane's start, along the strip.
    const x0 = p0.x + right[0] * lane, z0 = p0.z + right[1] * lane;
    const X0 = z0, Y0 = x0, hx = fwd[1], hy = fwd[0];
    const n = c.x.length, X = new Float64Array(n), Y = new Float64Array(n);
    for (let i = 0; i < n; i++) { X[i] = X0 + c.x[i] * hx - c.y[i] * hy; Y[i] = Y0 + c.x[i] * hy + c.y[i] * hx; }
    line = racingLine(X, Y, 4, 2);
    byLane.set(key, line);
  }
  return line;
}

/**
 * A computer car on the drag strip on the core: the player's car on its lane, driven by a pilot (its reaction time
 * after the green, then flat out with its own feel for wheelspin and, in a manual, its own gear changes), its
 * display Vehicle (strip/events.ts DragCar.V) written from it each frame: x, z, h, u, and the engine's revs and gear.
 */
export class CoreDragCar {
  readonly car: CoreRacer;
  readonly line: RacingLine;
  private acc = 0;

  constructor(model: VehicleModel, line: RacingLine, seed: number, x: number, z: number, fx: number, fz: number) {
    this.line = line;
    this.car = new CoreRacer(model, line, envelopeOf(model), pilotTraits(seed >>> 0), x, z, fx, fz);
  }

  /** Seconds before it moves after the green: its reaction time. */
  get reaction(): number { return this.car.pilot.traits.reaction; }

  /** One frame after the green: stepped at 1/120 s for the frame's time (the rest carried on); its Vehicle written. */
  frame(V: Vehicle, dt: number): void {
    const car = this.car;
    if (dt > 0) {
      this.acc += dt;
      while (this.acc >= STEP - 1e-9) {
        this.acc -= STEP;
        if (car.wait > 0) { car.wait -= STEP; continue; }
        car.drive(this.line);
      }
    }
    const s = car.s;
    V.x = s.y; V.z = s.x;
    V.h = Math.atan2(s.hy, s.hx);
    V.u = s.u; V.v = s.v; V.w = s.r;
    V.vz = s.u * s.hx - s.v * s.hy; V.vx = s.u * s.hy + s.v * s.hx;
    V.rpm = s.engineOmega / RPM;
    V.gear = s.gear > 0 ? s.gear : s.gearNext > 0 ? s.gearNext : 1;
    V.shift = s.shiftTimer > 0 ? s.shiftTimer : 0;
    V.thr = car.c.throttle;
  }
}
