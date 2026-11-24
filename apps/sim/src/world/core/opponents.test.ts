// Opponents on the same physics (packages/physics DESIGN.md section 14), driven through the race runner exactly as
// the Strip drives it: a tick is input, postStep, update at 1/60 s, the player idle on its grid place. With the switch
// on, each computer racer is the player's car on the core with a seeded pilot: it laps a real circuit of the game
// inside its skill band of that car's own limit lap and never beats it; the same seed gives the same race; the drag
// strip's cars run their lanes on the core; what the scene, the HUD and the standings read is kept current. With the
// switch off the old AI runs, untouched.
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runBench } from '@micar/physics';
import type { VehicleModel } from '@micar/physics';
import { EventRunner, playerAccel, playerTopMs, type ActiveEvent, type EventFx, type Racer } from '../strip/events';
import { TRACKS } from '../strip/district';
import { readTrackSync, setTrackDir } from '../strip/districtNode';
import { routePoint, routeProgress } from '../strip/routes';
import { collideCar, makeAI, stepAI } from '../strip/ai';
import { carParams, makeVehicle, NO_INPUT, resetVehicle } from '../physics';
import { ARCHETYPES, EVENTS, STOCK_CFG, TUNE_DEF, type EventDef } from '../data';
import { coreModelFor } from './model';
import { modelFromParams, seededRandom } from './opponents';
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
