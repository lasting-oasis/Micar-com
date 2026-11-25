// Opponents on the same physics (packages/physics DESIGN.md section 14), driven through the race runner exactly as
// the Strip drives it: a tick is input, postStep, update at 1/60 s, the player idle on its grid place. With the switch
// on, each computer racer is the player's car on the core with a seeded pilot: it laps a real circuit of the game
// inside its skill band of that car's own limit lap and never beats it; the same seed gives the same race; the drag
// strip's cars run their lanes on the core; what the scene, the HUD and the standings read is kept current. With the
// switch off the old AI runs, untouched.
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FLAT, createPilot, createPlace, createVehicle, defaultControls, limitLap, pilotTraits, placeOnTrack, placeVehicle, racingLine, runBench, step } from '@micar/physics';
import type { VehicleModel } from '@micar/physics';
import { EventRunner, playerAccel, playerTopMs, type ActiveEvent, type EventFx, type Racer } from '../strip/events';
import { TRACKS, trackLoaded } from '../strip/district';
import { readTrackSync, setTrackDir } from '../strip/districtNode';
import { routePoint, routeProgress } from '../strip/routes';
import { collideCar, makeAI, stepAI } from '../strip/ai';
import { carParams, makeVehicle, NO_INPUT, resetVehicle } from '../physics';
import { ARCHETYPES, EVENTS, STOCK_CFG, TUNE_DEF, type EventDef } from '../data';
import { coreModelFor } from './model';
import { circuitLine, envelopeOf, modelFromParams, seededRandom } from './opponents';
import { resetDrivingMode } from './switch';

beforeAll(() => { setTrackDir(path.resolve(process.cwd(), 'public/strip/tracks')); for (const t of TRACKS) readTrackSync(t.id); });
afterEach(() => { delete (globalThis as { location?: unknown }).location; resetDrivingMode(); vi.restoreAllMocks(); });

const LONG = 240_000;
const ev = (id: string): EventDef => EVENTS.find(e => e.id === id)!;
const sedan = () => carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF);
/** The player's car as the page would hand it to the runner: the Ronin GT rental, stock, on the core. */
const ronin = (): VehicleModel => coreModelFor({ make: 'Ronin', model: 'GT', rental: true }, STOCK_CFG.perf, TUNE_DEF).model;
const fx = (): EventFx => ({ banner: () => {}, sfx: () => {}, spawnRacerMesh: () => ({}), disposeMesh: () => {}, placeCp: () => {}, stage: () => 1, styleRating: () => 0 });
const runner = (car: (() => VehicleModel) | null = ronin): EventRunner => {
  const r = new EventRunner(makeVehicle(sedan()), [], fx(), sedan);
  if (car) r.coreCar = car;
  return r;
};
const DT = 1 / 60;
const tick = (r: EventRunner): void => { r.input(NO_INPUT, DT); r.postStep(DT); r.update(DT); };
/** Through the count to the green. */
const toGreen = (r: EventRunner): ActiveEvent => { const a = r.active!; while (a.state === 'count') tick(r); return a; };
/** Until every computer racer is home (or `most` seconds of racing). */
function raceOut(r: EventRunner, most = 900): ActiveEvent {
  const a = toGreen(r);
  for (let i = 0; i < most * 60 && a.racers.some(R => !R.done); i++) tick(r);
  return a;
}
const lapsOf = (a: ActiveEvent, R: Racer): { last: number | null; best: number | null; laps: number } =>
  ({ last: a.timing!.last(R.key!), best: a.timing!.best(R.key!), laps: a.timing!.laps(R.key!) });

describe('with the switch on, circuit opponents are core cars driven by seeded pilots', () => {
  it('each laps the Harbour GP inside its skill band of its own car\'s limit lap (1/0.98 to 1/0.80 of it) and never beats it', () => {
    const r = runner(), model = ronin();
    r.start(ev('harbour_gp'), { core: true, seed: 3 });
    const a = raceOut(r), field = a.core!;
    expect(field).toBeTruthy();
    expect(field.model).toBe(model); // the player's own car: the field is of the player's class
    const limit = field.limit.lapTime;
    // The Ronin GT round the Harbour (3.29 km of centreline, its racing line 3.24 km) at its limit: about two minutes.
    expect(limit).toBeGreaterThan(110);
    expect(limit).toBeLessThan(140);
    expect(a.racers).toHaveLength(3);
    for (const R of a.racers) {
      const car = R.core!, { skill } = car.traits, t = lapsOf(a, R);
      expect(skill).toBeGreaterThanOrEqual(0.8);
      expect(skill).toBeLessThanOrEqual(0.98);
      expect(R.done, R.name).toBe(true);
      expect(t.laps, R.name).toBe(2);
      // Lap 2 is a flying lap, as the limit lap is; lap 1 starts standing on the grid and is slower still.
      const flying = t.last!, first = R.ft! - flying;
      expect(flying / limit, `${R.name} at skill ${skill.toFixed(3)}`).toBeGreaterThanOrEqual(1 / 0.98);
      expect(flying / limit, `${R.name} at skill ${skill.toFixed(3)}`).toBeLessThanOrEqual(1 / 0.8);
      expect(first).toBeGreaterThan(flying);
      // Its own plan (the limit lap at its skill) is no faster than the car's limit, and it drives within 6% of it.
      expect(car.pilot.plan.lapTime).toBeGreaterThanOrEqual(limit);
      expect(flying / car.pilot.plan.lapTime).toBeLessThan(1.06);
    }
    // More skill is more speed: the most skilled pilot's flying lap is the quickest of the three.
    const bySkill = [...a.racers].sort((p, q) => q.core!.traits.skill - p.core!.traits.skill);
    const flying = bySkill.map(R => lapsOf(a, R).last!);
    expect(flying[0]).toBeLessThan(flying[2]);
  }, LONG);

  it('two races with the same seed give the same grid, names, finishing order and times; another seed another race', () => {
    const run = (seed: number) => {
      const r = runner();
      r.start(ev('harbour_gp'), { core: true, seed });
      const a = raceOut(r);
      const order = r.standings().filter(p => !p.me).map(p => `${p.name}:${p.ft}`);
      return { order, laps: a.racers.map(R => [R.key, R.name, R.ft, lapsOf(a, R).last]), player: [r.PV.x, r.PV.z], seed: a.seed };
    };
    const one = run(11), two = run(11), other = run(12);
    expect(one.seed).toBe(11);
    expect(two).toEqual(one);
    expect(one.order).toHaveLength(3);
    for (const p of one.order) expect(Number(p.split(':')[1])).toBeGreaterThan(200); // every one home, two laps of ~2 min
    expect(other.laps).not.toEqual(one.laps);
  }, LONG);

  it('no rubber band: the player 1.3 km ahead or 0.7 km behind (the same spot on the lap) leaves the race the same to the bit; the old AI\'s is not', () => {
    // After the green the player's car is put where none of the field gets to in 40 s, 2600 m round the Harbour's
    // 3293 m lap, and its race distance set either to 2600 (far ahead: the old AI sped up 22% for it) or to the same
    // spot a lap earlier, -693 (far behind: the old AI slowed by 14%). The core's racers see one and the same world.
    const run = (core: boolean, ahead: boolean) => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const r = runner();
      r.start(ev('harbour_gp'), { core, seed: 5 });
      const a = toGreen(r), at = ahead ? 2600 : 2600 - a.route.len, p = routePoint(a.route, at);
      resetVehicle(r.PV, p.x, p.z, Math.atan2(p.tx, p.tz));
      a.pS = at;
      for (let i = 0; i < 40 * 60; i++) tick(r);
      expect(Math.abs(a.pS - at)).toBeLessThan(1);
      return a.racers.map(R => [R.key, R.s, R.x, R.z, R.v]);
    };
    const ahead = run(true, true), behind = run(true, false);
    expect(behind).toEqual(ahead);
    // 40 s from a standing start through the Harbour's opening corners: 700 m and more (it laps at about 24 m/s).
    for (const R of ahead) expect(R[1] as number).toBeGreaterThan(700);
    // The same check catches a rubber band: the old AI's field is far apart in the two.
    const oldAhead = run(false, true), oldBehind = run(false, false);
    expect((oldAhead[0][1] as number) - (oldBehind[0][1] as number)).toBeGreaterThan(100);
  }, LONG);

  it('keeps every field the scene, the map and the standings read: place, heading, speed, wheel angle, route distance, an estimate', () => {
    const r = runner();
    r.start(ev('harbour_gp'), { core: true, seed: 2 });
    const a = toGreen(r);
    expect(a.racers.every(R => R.hold === false)).toBe(true);
    const last = a.racers.map(R => R.s);
    for (let i = 0; i < 30 * 60; i++) {
      const before = a.racers.map(R => ({ x: R.x, z: R.z }));
      tick(r);
      a.racers.forEach((R, k) => {
        // Distance along the route as the old AI kept it: from its own place, cumulative, never going back much.
        expect(Math.abs(R.s - routeProgress(a.route, R.x, R.z, R.s, 10).s)).toBeLessThan(1.01);
        expect(R.s).toBeGreaterThan(last[k] - 1);
        last[k] = R.s;
        // v is the speed along h, never negative; h points where it goes (once under way).
        expect(R.v).toBeGreaterThanOrEqual(0);
        const dx = R.x - before[k].x, dz = R.z - before[k].z, moved = Math.hypot(dx, dz);
        if (R.v > 5 && moved > 0.05) expect((dx * Math.sin(R.h) + dz * Math.cos(R.h)) / moved).toBeGreaterThan(0.95);
        expect(Math.abs(R.steer)).toBeLessThanOrEqual(R.core!.s.model.chassis.maxSteer + 1e-9);
      });
    }
    // 30 s in from a standing start, every one is past the opening corners (500 m) and running at road speed.
    for (const R of a.racers) { expect(R.s).toBeGreaterThan(500); expect(R.v).toBeGreaterThan(5); }
    // The positions board: the idle player last, the leader with no gap, the others a gap in seconds behind it.
    const st = r.standings();
    expect(st[st.length - 1].me).toBe(true);
    expect(st[0].gap ?? null).toBeNull();
    for (const p of st.slice(1, 3)) { expect(typeof p.key).toBe('string'); expect(p.gap).toBeGreaterThanOrEqual(0); expect(p.gap).toBeLessThan(30); }
    // The runner's estimate for a racer not home (the rest of the way at 0.8 vmax) is the rest at the speed it laps at.
    for (const R of a.racers) expect(0.8 * R.vmax).toBeCloseTo(a.core!.line.centreLength / R.core!.pilot.plan.lapTime, 6);
  }, LONG);

  it('the player\'s car pushing one (strip/ai.ts collideCar) moves and slows the real car behind it', () => {
    const r = runner();
    r.start(ev('harbour_gp'), { core: true, seed: 4 });
    const a = toGreen(r);
    for (let i = 0; i < 20 * 60; i++) tick(r);
    const R = a.racers[0], car = R.core!;
    const u0 = car.s.u;
    // The player's car dropped onto it from behind at 40 m/s.
    const V = r.PV; resetVehicle(V, R.x - 2.2 * Math.sin(R.h), R.z - 2.2 * Math.cos(R.h), R.h);
    V.u = 40; V.vx = 40 * Math.sin(R.h); V.vz = 40 * Math.cos(R.h);
    const x0 = R.x, z0 = R.z;
    expect(collideCar(V, R)).toBeGreaterThan(0);
    const pushed = Math.hypot(R.x - x0, R.z - z0);
    expect(pushed).toBeGreaterThan(0);
    a.core!.frame(a.racers, 0, null); // a frame with no time: the push is read in, nothing else moves
    expect(Math.hypot(car.s.y - x0, car.s.x - z0)).toBeCloseTo(pushed, 9);
    expect(car.s.u).toBeCloseTo(0.85 * u0, 9);
  }, LONG);

  it('reads the switch as the adapter does: ?physics=core in the address puts the racers on the core; a challenge has none to put', () => {
    (globalThis as { location?: unknown }).location = { search: '?physics=core' };
    const r = runner();
    r.start(ev('harbour_gp'));
    expect(r.active!.core).toBeTruthy();
    expect(r.active!.racers.every(R => !!R.core)).toBe(true);
    expect(Number.isInteger(r.active!.seed)).toBe(true);
    const net = { slot: 0, others: [{ id: 'p2', name: 'Bo', slot: 1, color: '#fff', style: 'coupe' }], goAt: () => null, now: () => 0 };
    r.start(ev('harbour_gp'), { net });
    expect(r.active!.core ?? null).toBeNull();
    expect(r.active!.racers.every(R => R.remote && !R.core)).toBe(true);
  }, LONG);

  it('unset, the racers drive the player\'s drawn figures resolved by the core (its old-model Params\' spec)', () => {
    const r = runner(null);
    r.start(ev('harbour_gp'), { core: true, seed: 1 });
    expect(r.active!.core!.model).toBe(modelFromParams(sedan()));
    const m = r.active!.core!.model;
    // The sedan archetype's 1540 kg and its 2.63 m wheelbase, one to one, as a drawn car is resolved.
    expect(m.chassis.mass).toBeCloseTo(1540, 6);
    expect(m.chassis.a + m.chassis.b).toBeCloseTo(2.63, 2);
  }, LONG);
});

describe('with the switch on, drag-strip opponents run the same way on a straight line', () => {
  it('each runs the Royal Park quarter in its own lane, no quicker than its car\'s own best quarter mile plus its reaction, and within a second of it', () => {
    const r = runner(), model = ronin();
    r.start(ev('royal_drag'), { core: true, seed: 6 });
    const a = toGreen(r), d = a.drag, lanes = [-6, -2, 2, 6];
    let worstLane = 0;
    for (let i = 0; i < 40 * 60 && d.ai.some(o => o.ft == null); i++) {
      tick(r);
      for (const o of d.ai) worstLane = Math.max(worstLane, Math.abs((o.V.x - d.p0!.x) * d.right[0] + (o.V.z - d.p0!.z) * d.right[1] - lanes[o.lane]));
    }
    const quarter = runBench(model).timeslip.quarter;
    expect(quarter).toBeGreaterThan(12);
    expect(quarter).toBeLessThan(16);
    expect(d.ai).toHaveLength(3);
    for (const o of d.ai) {
      expect(o.core).toBeTruthy();
      expect(o.react).toBeGreaterThanOrEqual(0.1);
      expect(o.react).toBeLessThanOrEqual(0.2);
      expect(o.ft, o.name).not.toBeNull();
      expect(o.estimated).toBeUndefined();
      expect(o.ft! - o.react, o.name).toBeGreaterThan(quarter);
      expect(o.ft! - o.react, o.name).toBeLessThan(quarter + 1);
      // At the line: 90 to 110 mph in a car that traps at about 98, the V the scene draws from moving with it.
      expect(o.V.u / 0.44704).toBeGreaterThan(90);
      expect(o.V.u / 0.44704).toBeLessThan(110);
      expect(o.s).toBeGreaterThanOrEqual(a.route.len);
    }
    // Its own steering holds it in its lane: under 10 cm off it all the way.
    expect(worstLane).toBeLessThan(0.1);
  }, LONG);

  it('the same seed gives the same lanes, reactions and times', () => {
    const run = (seed: number) => {
      const r = runner();
      r.start(ev('royal_drag'), { core: true, seed });
      const a = toGreen(r);
      for (let i = 0; i < 40 * 60 && a.drag.ai.some(o => o.ft == null); i++) tick(r);
      return a.drag.ai.map(o => [o.lane, o.name, o.react, o.ft]);
    };
    expect(run(9)).toEqual(run(9));
    expect(run(9)).not.toEqual(run(10));
  }, LONG);
});

describe('with the switch off nothing changes', () => {
  it('by default (nothing in the address, nothing stored) the racers are the old kinematic AI, paced from the player\'s car on the old model', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const r = runner();
    r.start(ev('harbour_gp'));
    const a = r.active!;
    expect(a.core ?? null).toBeNull();
    expect(a.seed).toBeUndefined();
    expect(a.racers.every(R => !R.core)).toBe(true);
    // The old pace: vmax = top x (0.74 + 0.06 x stage) x U(0.96, 1.04), acc = the 0-100 mean x 1.1, brakes 10 m/s^2,
    // from two straight-line runs of the player's car on the old model (U at its middle here).
    const top = playerTopMs(sedan()), acc = playerAccel(sedan());
    expect(top).toBeGreaterThan(40);
    for (const R of a.racers) { expect(R.vmax).toBeCloseTo(top * 0.8, 12); expect(R.acc).toBeCloseTo(acc * 1.1, 12); expect(R.brk).toBe(10); }
    const old = new EventRunner(makeVehicle(sedan()), [], fx(), sedan);
    old.start(ev('harbour_gp'), { core: false });
    expect(a.racers.map(R => [R.vmax, R.acc, R.brk, R.x, R.z, R.name])).toEqual(old.active!.racers.map(R => [R.vmax, R.acc, R.brk, R.x, R.z, R.name]));
  });

  it('its racers move exactly as stepAI moves them, catch-up included', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const r = runner();
    r.start(ev('harbour_gp'), { core: false });
    const a = toGreen(r);
    for (let i = 0; i < 10 * 60; i++) tick(r);
    // Far ahead of the idle player (so the old catch-up slows them 14%): one frame by hand against one through the runner.
    const twins = a.racers.map(R => makeAI({ ...R }));
    tick(r);
    twins.forEach(T => stepAI(T, DT, a.pS, 1));
    for (let k = 0; k < twins.length; k++) {
      expect([a.racers[k].x, a.racers[k].z, a.racers[k].v]).toEqual([twins[k].x, twins[k].z, twins[k].v]);
    }
  });

  it('the drag strip\'s opponents are the old model\'s Vehicles, the player\'s Params detuned by stage, reacting 0.15 to 0.55 s after the green', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const r = runner();
    r.start(ev('royal_drag'));
    const d = r.active!.drag;
    expect(d.ai).toHaveLength(3);
    for (const o of d.ai) {
      expect(o.core).toBeUndefined();
      expect(o.react).toBeCloseTo(0.35, 12);
      expect(o.V.P.tqMul).toBeCloseTo(sedan().tqMul * (0.86 + 0.05 + 0.03), 12);
    }
  });
});

/* ------------------------------------------------------------------ every pilot on every circuit */

/**
 * A pilot alone in the player's car (the Ronin GT, as above) from a standing start 10 m behind a circuit's line, for
 * two laps: the furthest any wheel's contact patch went past the edge of the road as the game draws it (its
 * centreline's ribbon, the track's own width), m, and where (metres into the lap, and the lap).
 */
function lonePilot(trackId: string, traits: ReturnType<typeof pilotTraits>): { beyond: number; at: number; lap: number } {
  const track = trackLoaded(trackId as never)!, model = ronin(), line = circuitLine(track), env = envelopeOf(model);
  const pts = track.centre.pts, X = new Float64Array(pts.length), Y = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i++) { X[i] = pts[i][1] + track.offset[1]; Y[i] = pts[i][0] + track.offset[0]; }
  // The road: the drawn centreline, resampled, with no line laid on it (no margin, no relaxation).
  const road = racingLine(X, Y, track.centre.width, 0, 2, 0);
  const pilot = createPilot(model, line, env, traits), s = createVehicle(model), c = defaultControls();
  let i = line.n - 1;
  while (line.s[i] > line.length - 10) i--;
  placeVehicle(s, line.x[i], line.y[i], line.tx[i], line.ty[i]);
  const ch = model.chassis, wx = [ch.a, ch.a, -ch.b, -ch.b], wy = [ch.trackFront / 2, -ch.trackFront / 2, ch.trackRear / 2, -ch.trackRear / 2];
  const place = createPlace(), hints = [-1, -1, -1, -1];
  let beyond = -Infinity, where = 0;
  for (let k = 0; k < 120 * 900 && pilot.progress < 2 * line.length; k++) {
    pilot.control(s, c);
    step(s, c, FLAT);
    for (let w = 0; w < 4; w++) {
      placeOnTrack(road, s.x + s.hx * wx[w] - s.hy * wy[w], s.y + s.hy * wx[w] + s.hx * wy[w], hints[w], place);
      hints[w] = place.index;
      const b = Math.abs(place.offset) - road.width / 2;
      if (b > beyond) { beyond = b; where = pilot.progress; }
    }
  }
  return { beyond, at: ((where % line.length) + line.length) % line.length, lap: Math.floor(where / line.length) + 1 };
}

describe('with the switch on, every seeded pilot keeps its wheels on the road', () => {
  it('the pilot that ran 6 m wide on the Harbour GP (seed 2265367787: skill 0.968, reaction 0.187 s, precision 0.9675) brakes for the left-hander 300-360 m past the line on lap 2 and stays on the road there', () => {
    const traits = pilotTraits(2265367787);
    expect(traits.skill).toBeCloseTo(0.968, 3);
    expect(traits.reaction).toBeCloseTo(0.187, 3);
    expect(traits.precision).toBeCloseTo(0.9675, 4);
    const model = ronin(), track = trackLoaded('monaco')!, line = circuitLine(track), road = (() => {
      const pts = track.centre.pts, X = new Float64Array(pts.length), Y = new Float64Array(pts.length);
      for (let i = 0; i < pts.length; i++) { X[i] = pts[i][1] + track.offset[1]; Y[i] = pts[i][0] + track.offset[0]; }
      return racingLine(X, Y, track.centre.width, 0, 2, 0);
    })();
    const pilot = createPilot(model, line, envelopeOf(model), traits), s = createVehicle(model), c = defaultControls();
    placeVehicle(s, line.x[0], line.y[0], line.tx[0], line.ty[0]);
    const ch = model.chassis, wx = [ch.a, ch.a, -ch.b, -ch.b], wy = [ch.trackFront / 2, -ch.trackFront / 2, ch.trackRear / 2, -ch.trackRear / 2];
    const place = createPlace(), hints = [-1, -1, -1, -1];
    let beyond = -Infinity, over = -Infinity, braked = 0, overZone = -Infinity;
    for (let k = 0; k < 120 * 400 && pilot.progress < line.length + 380; k++) {
      pilot.control(s, c);
      const inLap = pilot.progress - line.length;
      // The approach and the corner on lap 2: from 150 m (the braking zone opens) to 380 m past the line.
      const inCorner = inLap > 150 && inLap < 380;
      if (inCorner) braked = Math.max(braked, c.brake);
      // Through the braking zone and at the corner itself, how far over the speed it planned for there.
      if (inLap > 150 && inLap < 360) overZone = Math.max(overZone, Math.hypot(s.u, s.v) - pilot.target);
      if (inLap > 300 && inLap < 360) over = Math.max(over, Math.hypot(s.u, s.v) - pilot.target);
      step(s, c, FLAT);
      if (!inCorner) continue;
      for (let w = 0; w < 4; w++) {
        placeOnTrack(road, s.x + s.hx * wx[w] - s.hy * wy[w], s.y + s.hy * wx[w] + s.hx * wy[w], hints[w], place);
        hints[w] = place.index;
        beyond = Math.max(beyond, Math.abs(place.offset) - road.width / 2);
      }
    }
    // It brakes to its plan: well into the pedal in the sweeper, never more than 1 m/s over the speed it planned from
    // the braking zone to the corner (it let the brake off for 30 m there, fell 3-4 m/s behind its plan and stood on
    // the pedal to catch up: a pilot that keeps to its plan all the way never needs to), and at the corner within
    // 1 m/s of it (it arrived 3-4 m/s over); and all four wheels stay on the road from the braking zone through the
    // corner (it ran 6 m past the edge).
    expect(braked).toBeGreaterThan(0.4);
    expect(overZone).toBeLessThan(1);
    expect(over).toBeLessThan(1);
    expect(beyond).toBeLessThan(0);
  }, LONG);

  it('pilots across the skill band (0.80 to 0.98), in the Ronin GT, keep all four wheels on the road on every circuit of the game for two laps', () => {
    // Seeds whose skills spread over the band, slowest first, and the Harbour GP's pilot that ran wide.
    const seeds = [307, 184, 253, 58, 91, 244, 120, 43, 2265367787];
    const skills = seeds.map(seed => pilotTraits(seed).skill);
    expect(Math.min(...skills)).toBeLessThan(0.81);
    expect(Math.max(...skills)).toBeGreaterThan(0.975);
    const off: string[] = [];
    for (const t of TRACKS) {
      for (const seed of seeds) {
        const traits = pilotTraits(seed), r = lonePilot(t.id, traits);
        if (!(r.beyond < 0)) off.push(`${t.id} seed ${seed} (skill ${traits.skill.toFixed(3)}): ${r.beyond.toFixed(2)} m past the edge ${r.at.toFixed(0)} m into lap ${r.lap}`);
      }
    }
    expect(off).toEqual([]);
  }, 30 * 60_000);
});

describe('with the switch on, every circuit is raced at the speed its corners allow', () => {
  it('each circuit\'s racing line is a curve a car can follow: no tighter than a 5 m radius anywhere, and the limit lap never slower than 5 m/s', () => {
    // Where a drawn centreline turns tighter than the line's room (the Eifel GP's 72 degrees in 6 m, COTA's 5 m
    // radius) the line folded into a cusp of 0.12 m radius: the limit lap crawled there at 1.0 m/s and every pilot
    // drove in circles at it for minutes.
    const model = ronin(), env = envelopeOf(model);
    for (const t of TRACKS) {
      const line = circuitLine(trackLoaded(t.id)!), lap = limitLap(line, env);
      let tightest = 0, slowest = Infinity;
      for (let i = 0; i < line.n; i++) { tightest = Math.max(tightest, Math.abs(line.k[i])); slowest = Math.min(slowest, lap.speed[i]); }
      expect(1 / tightest, `${t.id}: tightest radius`).toBeGreaterThan(5);
      expect(slowest, `${t.id}: slowest point of the limit lap`).toBeGreaterThan(5);
    }
  }, LONG);

  it('the Eifel GP (seed 3) is a race: every opponent finishes its two laps, its flying lap inside the skill band (1/0.98 to 1/0.80 of the limit lap)', () => {
    // It ran 376-761 s laps against a 167 s limit lap, and the race's time cap ended it with two racers not home.
    const r = runner();
    r.start(ev('eifel_gp'), { core: true, seed: 3 });
    const a = raceOut(r), limit = a.core!.limit.lapTime;
    for (const R of a.racers) {
      const t = lapsOf(a, R), skill = R.core!.traits.skill;
      expect(R.done, R.name).toBe(true);
      expect(t.last! / limit, `${R.name} at skill ${skill.toFixed(3)}`).toBeGreaterThanOrEqual(1 / 0.98);
      expect(t.last! / limit, `${R.name} at skill ${skill.toFixed(3)}`).toBeLessThanOrEqual(1 / 0.8);
    }
  }, LONG);

  it('the Ardennes GP (seeds 4, 5, 7, 8): the most skilled opponent is the quickest, and every flying lap is inside the skill band (1/0.98 to 1/0.80 of the limit lap)', () => {
    // The pilot at the top of the band (0.96-0.98) spun off in Spa's fast corners and finished last, up to 1.305 x
    // the limit lap, out of its band; the slower pilots did not.
    for (const seed of [4, 5, 7, 8]) {
      const r = runner();
      r.start(ev('ardennes_gp'), { core: true, seed });
      const a = raceOut(r), limit = a.core!.limit.lapTime;
      for (const R of a.racers) {
        const t = lapsOf(a, R), skill = R.core!.traits.skill;
        expect(R.done, `seed ${seed} ${R.name}`).toBe(true);
        expect(t.last! / limit, `seed ${seed} ${R.name} at skill ${skill.toFixed(3)}`).toBeGreaterThanOrEqual(1 / 0.98);
        expect(t.last! / limit, `seed ${seed} ${R.name} at skill ${skill.toFixed(3)}`).toBeLessThanOrEqual(1 / 0.8);
      }
      const bySkill = [...a.racers].sort((p, q) => q.core!.traits.skill - p.core!.traits.skill);
      const best = bySkill[0], lap = (R: Racer) => lapsOf(a, R).last!;
      for (const R of bySkill.slice(1)) expect(lap(best), `seed ${seed}: ${best.name} (${best.core!.traits.skill.toFixed(3)}) against ${R.name} (${R.core!.traits.skill.toFixed(3)})`).toBeLessThan(lap(R));
    }
  }, LONG);
});

describe('a drift event with the switch on', () => {
  it('scores its core racers from the race\'s seed at any frame rate: the same seed gives the same scores at 60 and at 30 frames a second', () => {
    // Each racer drew from the seed once a frame, so the number of draws, and the scores, were the frame rate's.
    const scores = (fps: number): number[] => {
      const r = runner();
      r.start(ev('harbour_drift'), { core: true, seed: 3 });
      const a = r.active!, dt = 1 / fps;
      while (a.state === 'count') { r.input(NO_INPUT, dt); r.postStep(dt); r.update(dt); }
      for (let i = 0; i < 20 * fps; i++) { r.input(NO_INPUT, dt); r.postStep(dt); r.update(dt); }
      expect(a.core, 'core racers').toBeTruthy();
      return a.racers.map(R => R.score);
    };
    const at60 = scores(60), at30 = scores(30);
    expect(at60.length).toBeGreaterThan(0);
    expect(Math.max(...at60)).toBeGreaterThan(0);
    for (let i = 0; i < at60.length; i++) expect(Math.abs(at30[i] - at60[i]), `racer ${i}`).toBeLessThan(1e-6 * Math.max(1, at60[i]) + 1e-9);
  }, LONG);
});

describe('the race\'s dice', () => {
  it('a seed gives one sequence, spread evenly over 0 to 1', () => {
    const a = seededRandom(42), b = seededRandom(42), c = seededRandom(43);
    const xs = Array.from({ length: 4000 }, () => a());
    expect(Array.from({ length: 4000 }, () => b())).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    const mean = xs.reduce((p, q) => p + q, 0) / xs.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.02);
    const low = xs.filter(x => x < 0.25).length / xs.length;
    expect(Math.abs(low - 0.25)).toBeLessThan(0.03);
  });
});
