// The fastest a legal car can cover each Strip event, on the physics core (rubric F3: "every floor is the fastest legal
// build's bench run with a stated margin"). Used by scripts/build-floors.ts, which writes the table the server reads
// (world/floors.json), and by the tests that hold that table to the core. Never run by the server or the page: it
// measures every legal car, fully built, for a minute or more.
//
// A legal car is any car a player can drive in an event: every model the world's catalogue sells (each on the sheet
// it drives on, model.ts coreSheetFor), and the rental fleet. Fully built is every performance part at its top tier;
// the Garage's sliders are tried at their middle and at the ends that can make a car quicker in a straight line or
// round a lap (more nitrous, shorter or longer gearing, the turbo sooner or harder, the most downforce).
//
// Each run is a bound no driver can beat on that car:
//  - a drag (the quarter or the half mile): the bench's launch at each of its launch speeds, flat out with the nitrous
//    armed from the start, the time from the car's first movement to the distance of the event's route (the game's
//    time also holds the driver's reaction to the green, which only adds to it);
//  - a lap event: the car's limit lap on the circuit's racing line (lap.ts: its whole envelope, no driver in the loop),
//    a flying lap, times the laps; for a route that is part of a circuit (a sprint, a drift sector), the limit
//    profile's time over that part, entered at the limit lap's own speed there (a standing start only adds to it).
//  - round a lap the car's envelope has its nitrous all the way (nitrousAccel: the bottle never empty), and the line is
//    the widest inside the walls (corridorLine: the road and its run-off), not the opponents' line on the road.
// The old model is still the game's default and the server cannot tell which model a run was driven on, so each car
// is also bounded on the old model (oldDragSeconds, oldEnvelope: its nitrous all the way, its perfect-shift bonus all
// the way, both axles at their friction at once), and the fastest of all is the event's run. The margin the server
// keeps under it (world/floors.ts FLOOR_MARGIN) is for what no run here holds.
import { FLAT, G, createPlace, createVehicle, defaultControls, launchDriver, launchSpeeds, limitLap, measureEnvelope, placeOnLine, racingLine, step } from '@micar/physics';
import type { Envelope, LapProfile, RacingLine, VehicleModel } from '@micar/physics';
import { CAR_CATALOG } from '../../carCatalog';
import { EVENTS, FLEET_NAMES, specFor, type EventDef } from '../data';
import { NO_INPUT, carParams, makeVehicle, stepVehicle, type Input, type Params, type PerfCfg, type Tune } from '../physics';
import { routeFor, trackLoaded, trackOfEvent, type TrackData } from '../strip/district';
import { coreModelFor, coreSheetFor, type CoreCar } from './model';

/** Every performance part at its top tier. */
export const FULL_BUILD: Readonly<PerfCfg> = { engine: 3, ecu: 3, turbo: 3, trans: 3, susp: 3, nos: 3, tires: 3, brakes: 3, weight: 3 };

/** The Garage's sliders tried on a fully built car: the middle, and each end that can make a car quicker. */
export const TUNES_TRIED: readonly Readonly<Tune>[] = [
  { turbo: 0, nitrous: 0, aero: 0, bias: 0, ride: 0, stiff: 0, steer: 0, gears: 0 },
  { turbo: 0, nitrous: 1, aero: 0, bias: 0, ride: 0, stiff: 0, steer: 0, gears: 0 },
  { turbo: 0, nitrous: 1, aero: 0, bias: 0, ride: 0, stiff: 0, steer: 0, gears: 1 },
  { turbo: 0, nitrous: 1, aero: 0, bias: 0, ride: 0, stiff: 0, steer: 0, gears: -1 },
  { turbo: 1, nitrous: 1, aero: 0, bias: 0, ride: 0, stiff: 0, steer: 0, gears: 0 },
  { turbo: -1, nitrous: 1, aero: 0, bias: 0, ride: 0, stiff: 0, steer: 0, gears: 0 },
  { turbo: 0, nitrous: 0, aero: 1, bias: 0, ride: 1, stiff: 1, steer: 0, gears: 0 },
];

/** One car per sheet a legal car drives on: the rental fleet and the world's catalogue, named as the world names them. */
export function legalCars(): { name: string; car: CoreCar }[] {
  const out: { name: string; car: CoreCar }[] = [], seen = new Set<string>();
  for (const fleet of Object.keys(FLEET_NAMES)) {
    const [make, ...rest] = fleet.split(' ');
    const car: CoreCar = { make, model: rest.join(' '), rental: true };
    const id = coreSheetFor(car).sheet.id;
    if (!seen.has(id)) { seen.add(id); out.push({ name: fleet, car }); }
  }
  for (const [make, rows] of Object.entries(CAR_CATALOG)) for (const r of rows) {
    const car: CoreCar = { make, model: r.model, bodyStyle: r.style };
    const choice = coreSheetFor(car), id = `${choice.sheet.id}|${choice.bodyClass}`;
    if (!seen.has(id)) { seen.add(id); out.push({ name: `${make} ${r.model}`, car }); }
  }
  return out;
}

/** Seconds from the car's first movement to `metres` flat out from a standing start, the nitrous armed: the best of the bench's launch speeds. */
export function dragSeconds(model: VehicleModel, metres: number): number {
  let best = Infinity;
  for (const w of launchSpeeds(model)) {
    const d = launchDriver(model, w, 1), s = createVehicle(model), c = defaultControls();
    let moved = NaN;
    for (let k = 0; k < 120 * 60 && s.time - (moved === moved ? moved : 0) < best; k++) {
      d.control(s, c);
      c.nitrous = true;
      const x0 = s.x;
      step(s, c, FLAT);
      if (moved !== moved && s.u > 0.05) moved = s.time;
      if (s.x - 0 >= metres) {
        // The instant it crossed, between the last two steps.
        const t = s.time - (s.x - metres) / Math.max(1e-9, s.x - x0) * (1 / 120);
        best = Math.min(best, t - (moved === moved ? moved : 0));
        break;
      }
    }
  }
  return best;
}

/** The time a limit profile takes from distance `from` to `to` along its line (m, the way round it runs), at its own speeds. */
export function profileSeconds(p: LapProfile, from: number, to: number): number {
  const line = p.line, L = line.length;
  let a = ((from % L) + L) % L, b = ((to % L) + L) % L;
  const at = (s: number): number => {
    // the time from point 0 to distance s, in a straight line between points
    let i = 0;
    while (i + 1 < line.n && line.s[i + 1] <= s) i++;
    const j = i + 1 < line.n ? i + 1 : 0, seg = (j === 0 ? L : line.s[j]) - line.s[i];
    const tj = j === 0 ? p.lapTime : p.time[j];
    return p.time[i] + (seg > 0 ? (tj - p.time[i]) * (s - line.s[i]) / seg : 0);
  };
  const ta = at(a), tb = at(b);
  return tb >= ta ? tb - ta : p.lapTime - ta + tb;
}

/** Where a game position (x, z m) falls along a circuit's line, m from its point 0. */
function alongLine(line: RacingLine, x: number, z: number): number {
  const place = createPlace();
  placeOnLine(line, z, x, -1, place);
  return place.s;
}

/**
 * The time a profile takes over `metres` of its line from distance `from` (m), at its own speeds, round as many laps as
 * that takes.
 */
export function profileOver(p: LapProfile, from: number, metres: number): number {
  const L = p.line.length;
  let t = 0, left = metres;
  while (left >= L) { t += p.lapTime; left -= L; }
  return t + profileSeconds(p, from, from + left);
}

/** How far a car may run from a circuit's centreline before its body meets a wall, m: half the corridor between the walls (the median over the track, its run-off included). */
export function corridorHalf(track: TrackData): number {
  const c = track.centre.pts, d: number[] = [];
  for (const w of track.walls) for (const q of w) {
    let best = Infinity;
    for (const p of c) { const dx = q[0] - p[0], dz = q[1] - p[1]; const r = dx * dx + dz * dz; if (r < best) best = r; }
    d.push(Math.sqrt(best));
  }
  if (d.length === 0) return track.centre.width / 2;
  d.sort((x, y) => x - y);
  return Math.max(track.centre.width / 2, d[d.length >> 1]);
}

/** Half the widest car's body, m: how close to a wall the middle of a car can run. */
export const BODY_HALF = 1.0;

const corridorLines = new WeakMap<TrackData, RacingLine>();
/**
 * The widest line a car can take round a circuit: the racing line laid in the whole corridor between its walls (the
 * road and its run-off), its body against the walls, in the core's plane as circuitLine has it. Faster than the
 * opponents' line, which keeps to the road: no driver can go round quicker inside the walls.
 */
export function corridorLine(track: TrackData): RacingLine {
  let line = corridorLines.get(track);
  if (!line) {
    const pts = track.centre.pts, n = pts.length, X = new Float64Array(n), Y = new Float64Array(n);
    for (let i = 0; i < n; i++) { X[i] = pts[i][1] + track.offset[1]; Y[i] = pts[i][0] + track.offset[0]; }
    line = racingLine(X, Y, 2 * corridorHalf(track), BODY_HALF);
    corridorLines.set(track, line);
  }
  return line;
}

/** A car's flat-out acceleration with its nitrous armed all the way, g at each m/s from 0 (the envelope's table step): the bench's launch, the bottle never empty. */
export function nitrousAccel(model: VehicleModel, env: Envelope): Float64Array {
  const out = Float64Array.from(env.accel);
  if (model.nitrous === null || !(model.nitrous.power > 0)) return out;
  const d = launchDriver(model, launchSpeeds(model)[0], 1), s = createVehicle(model), c = defaultControls();
  let u0 = 0, t0 = 0;
  for (let k = 0; k < 120 * 120; k++) {
    d.control(s, c);
    c.nitrous = true;
    s.nitrousLeft = model.nitrous.bottleMass;
    step(s, c, FLAT);
    const i = Math.floor(s.u / env.dv);
    if (s.u > u0 + env.dv && i < out.length) {
      const a = (s.u - u0) / (s.time - t0) / G;
      for (let j = Math.floor(u0 / env.dv); j <= i && j < out.length; j++) if (a > out[j]) out[j] = a;
      u0 = s.u; t0 = s.time;
    }
    if (k > 120 * 10 && s.u < u0 + 0.01 && s.time - t0 > 5) break;
  }
  return out;
}

/** The core's bound on an event for one car: seconds, as each run above explains. Needs the event's track loaded. */
export function eventSeconds(model: VehicleModel, ev: EventDef, envelope: Envelope = measureEnvelope(model), boosted: Envelope = { ...envelope, accel: nitrousAccel(model, envelope) }): number {
  const route = routeFor(ev.id);
  if (ev.type === 'drag') return dragSeconds(model, route.len);
  return lapSeconds(ev, boosted);
}

/** An event's lap or route time on the widest line inside the walls, for an envelope (a car's, or the old model's). */
export function lapSeconds(ev: EventDef, env: Envelope): number {
  const route = routeFor(ev.id), track = trackLoaded(trackOfEvent(ev.id))!;
  const line = corridorLine(track), lap = limitLap(line, env);
  if (ev.loop) return lap.lapTime * (ev.laps || 1);
  const p0 = route.pts[0];
  return profileOver(lap, alongLine(line, p0[0], p0[1]), route.len * line.length / line.centreLength);
}

/* ------------------------------------------------------------------ the old model, which is still the default */

/** The old model's Params of a car, fully built with these sliders (world/physics.ts carParams on world/data.ts specFor). */
export function oldParams(car: CoreCar, tune: Tune): Params {
  return carParams(specFor(car), FULL_BUILD as PerfCfg, tune);
}

/** Seconds for the old model from its first movement to `metres`, flat out on automatic gears, the nitrous held on and its bottle never empty, with the perfect-shift torque bonus (1.1 x) held all the way. */
export function oldDragSeconds(P: Params, metres: number): number {
  const V = makeVehicle(P), I: Input = { ...NO_INPUT, fwd: 1, nos: true }, dt = 1 / 120;
  let t = 0, moved = NaN, x0 = 0;
  for (let k = 0; k < 120 * 60; k++) {
    V.nos = P.nos.cap; V.perfectT = 1;
    x0 = V.odo;
    stepVehicle(V, I, dt, false);
    t += dt;
    if (moved !== moved && V.u > 0.05) moved = t - dt;
    if (V.odo >= metres) return t - (V.odo - metres) / Math.max(1e-9, V.odo - x0) * dt - (moved === moved ? moved : 0);
  }
  return Infinity;
}

/**
 * The old model's envelope, as the core's lap needs one: its flat-out acceleration with the nitrous held on (and the
 * perfect-shift torque bonus it gives a manual shift, 1.1 x, all the way), its full-pedal braking, and the most
 * cornering its two axles can hold together (each axle's friction times its load, downforce included): every figure
 * at least what the old model can do, so its lap here is no slower than any driven on it.
 */
export function oldEnvelope(P: Params, dv = 1): Envelope {
  const V = makeVehicle(P), I: Input = { ...NO_INPUT, fwd: 1, nos: true }, dt = 1 / 120, m = P.mass, g = 9.81;
  const n = 120, accel = new Float64Array(n), brake = new Float64Array(n), lateral = new Float64Array(n);
  let top = 0, u0 = 0, t = 0, t0 = 0;
  for (let k = 0; k < 120 * 120; k++) {
    V.nos = P.nos.cap; V.perfectT = 1;
    stepVehicle(V, I, dt, false);
    t += dt;
    if (V.u > top) top = V.u;
    if (V.u > u0 + dv) {
      const a = (V.u - u0) / (t - t0) / g;
      for (let j = Math.floor(u0 / dv); j <= Math.floor(V.u / dv) && j < n; j++) accel[j] = Math.max(accel[j], a);
      u0 = V.u; t0 = t;
    }
    if (t - t0 > 5) break;
  }
  for (let j = 0; j < n; j++) {
    const v = j * dv, down = P.downK * v * v;
    const fz = m * g + down;
    // Both axles at their friction at once (the rear's 3% more), every newton of load on a tyre: a bound on cornering.
    lateral[j] = P.mu * 1.03 * fz / (m * g);
    // Full pedal (1.1 x brakeMu of the weight), and never more than the tyres hold: a bound on braking.
    brake[j] = Math.min(P.brakeMu * 1.1, P.mu * 1.03 * fz / (m * g));
  }
  return { dv, accel, brake, lateral, topSpeed: top, corners: [] };
}

/** The fastest legal build's run on each event: the seconds, the model, the car and the sliders that set it. */
export type FastestRun = { eventId: string; seconds: number; model: 'core' | 'classic'; car: string; tune: number };

/** Every legal car, fully built, every slider setting tried, on every event, on both driving models: the fastest run on each. Takes minutes. */
export function fastestRuns(log: (line: string) => void = () => {}): FastestRun[] {
  const best = new Map<string, FastestRun>();
  const offer = (run: FastestRun): void => { const hit = best.get(run.eventId); if (run.seconds > 0 && (!hit || run.seconds < hit.seconds)) best.set(run.eventId, run); };
  for (const { name, car } of legalCars()) {
    for (let k = 0; k < TUNES_TRIED.length; k++) {
      const model = coreModelFor(car, FULL_BUILD, TUNES_TRIED[k]).model, envelope = measureEnvelope(model);
      const boosted: Envelope = { ...envelope, accel: nitrousAccel(model, envelope) };
      const P = oldParams(car, TUNES_TRIED[k]), old = oldEnvelope(P);
      for (const ev of EVENTS) {
        offer({ eventId: ev.id, seconds: eventSeconds(model, ev, envelope, boosted), model: 'core', car: name, tune: k });
        const route = routeFor(ev.id);
        offer({ eventId: ev.id, seconds: ev.type === 'drag' ? oldDragSeconds(P, route.len) : lapSeconds(ev, old), model: 'classic', car: name, tune: k });
      }
    }
    log(name);
  }
  return EVENTS.map(ev => best.get(ev.id)!);
}
