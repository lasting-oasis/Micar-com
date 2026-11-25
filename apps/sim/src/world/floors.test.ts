// The server's impossible-run floors held to the physics (rubric F3): each event's floor is the fastest legal build's
// run on it, on the core and on the old model, less 10%. The table (floors.json) is worked out by
// scripts/build-floors.ts; these tests hold it to what the two models say now, show that no legal car is refused (the
// Mountain Half Mile the old fixed floor refused), and that an impossible run still is.
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { measureEnvelope } from '@micar/physics';
import type { Envelope } from '@micar/physics';
import { EVENTS } from './data';
import { TRACKS, routeFor } from './strip/district';
import { readTrackSync, setTrackDir } from './strip/districtNode';
import { FLOOR_MARGIN, fastestRun } from './floors';
import { COUNTDOWN_S, eventDistance, raceFloor, validateFinish } from './payout';
import { FULL_BUILD, TUNES_TRIED, dragSeconds, eventSeconds, lapSeconds, legalCars, nitrousAccel, oldDragSeconds, oldEnvelope, oldParams } from './core/floorRuns';
import { coreModelFor } from './core/model';

beforeAll(() => { setTrackDir(path.resolve(process.cwd(), 'public/strip/tracks')); for (const t of TRACKS) readTrackSync(t.id); });

const LONG = 300_000;
const finish = (eventId: string, time: number) => ({ eventId, pos: 1, time, score: 0, failed: false });
const carNamed = (name: string) => legalCars().find(c => c.name === name)!;

describe('the floors are the fastest legal build\'s run less 10%', () => {
  it('every event has a run set by a legal car, at an average speed a fully built car can hold, and its floor is that run less 10%', () => {
    const names = new Set(legalCars().map(c => c.name));
    expect(names.size).toBeGreaterThan(40);   // the rental fleet and the world's catalogue, one per sheet driven on
    for (const ev of EVENTS) {
      const run = fastestRun(ev.id)!;
      expect(run, ev.id).not.toBeNull();
      expect(names.has(run.car), `${ev.id}: ${run.car}`).toBe(true);
      expect(['core', 'classic']).toContain(run.model);
      expect(run.floor, ev.id).toBeCloseTo(run.fastest * (1 - FLOOR_MARGIN), 2);
      expect(raceFloor(ev), ev.id).toBe(run.floor);
      // From a quarter-mile drag's 44 m/s to a fast circuit's 61 m/s: a fully built car's averages, none past 75 m/s.
      const avg = eventDistance(ev) / run.fastest;
      expect(avg, ev.id).toBeGreaterThan(25);
      expect(avg, ev.id).toBeLessThan(75);
    }
  });

  it('each run is what the model says now for that car and build (within 3%): the table is not stale', () => {
    // Grouped by the car, model and sliders that set them, so each car is measured once.
    const groups = new Map<string, string[]>();
    for (const ev of EVENTS) {
      const run = fastestRun(ev.id)!, k = `${run.model}|${run.car}|${JSON.stringify(run.tune)}`;
      groups.set(k, [...(groups.get(k) ?? []), ev.id]);
    }
    for (const [k, ids] of groups) {
      const [model, name, tuneJson] = k.split('|'), tune = JSON.parse(tuneJson), { car } = carNamed(name);
      let core: { m: ReturnType<typeof coreModelFor>['model']; env: Envelope; boosted: Envelope } | null = null;
      let old: { P: ReturnType<typeof oldParams>; env: Envelope } | null = null;
      for (const id of ids) {
        const ev = EVENTS.find(e => e.id === id)!, run = fastestRun(id)!;
        let seconds: number;
        if (model === 'core') {
          if (!core) { const m = coreModelFor(car, FULL_BUILD, tune).model, env = measureEnvelope(m); core = { m, env, boosted: { ...env, accel: nitrousAccel(m, env) } }; }
          seconds = eventSeconds(core.m, ev, core.env, core.boosted);
        } else {
          if (!old) { const P = oldParams(car, tune); old = { P, env: oldEnvelope(P) }; }
          seconds = ev.type === 'drag' ? oldDragSeconds(old.P, routeFor(id).len) : lapSeconds(ev, old.env);
        }
        expect(Math.abs(seconds / run.fastest - 1), `${id}: ${run.model} ${run.car} now ${seconds.toFixed(2)} s, table ${run.fastest} s`).toBeLessThan(0.03);
      }
    }
  }, LONG);
});

describe('no legal car is refused, and an impossible run still is', () => {
  it('the Mountain Half Mile: a fully built Tsubasa R4 or Corvette is paid on either model; the old fixed floor (805 m at 50 m/s, 16.1 s) refused it', () => {
    const ev = EVENTS.find(e => e.id === 'mountain_drag')!, len = routeFor(ev.id).len, floor = raceFloor(ev);
    expect(len).toBeGreaterThan(800);
    let quickest = Infinity;
    for (const name of ['Tsubasa R4', 'Chevy Corvette']) {
      const { car } = carNamed(name);
      for (const tune of TUNES_TRIED) {
        const runs = [dragSeconds(coreModelFor(car, FULL_BUILD, tune).model, len), oldDragSeconds(oldParams(car, tune), len)];
        for (const t of runs) {
          quickest = Math.min(quickest, t);
          // The run's time is at or above the floor, and a finish in it, after the countdown and the run, is paid.
          expect(t, `${name}`).toBeGreaterThanOrEqual(floor);
          expect(validateFinish({ eventId: ev.id, startedAt: 0 }, finish(ev.id, t), (COUNTDOWN_S + t) * 1000 + 10).ok, name).toBe(true);
        }
      }
    }
    // The old rule would have refused the quickest of them as impossible.
    expect(quickest).toBeLessThan(len / 50);
  }, LONG);

  it('an impossible run is still refused: a quarter mile in 7 s, the Harbour GP in two minutes, the Ardennes GP at 75 m/s', () => {
    // Each finish arrives a second after the countdown and its own time have passed on the server's clock.
    const at = (id: string, t: number) => validateFinish({ eventId: id, startedAt: 0 }, finish(id, t), (COUNTDOWN_S + t + 1) * 1000).ok;
    expect(at('royal_drag', 7)).toBe(false);
    expect(at('harbour_gp', 120)).toBe(false);
    const ardennes = EVENTS.find(e => e.id === 'ardennes_gp')!;
    expect(at('ardennes_gp', eventDistance(ardennes) / 75)).toBe(false);
    // and each one's own floor is the line: a hair under it refused, on it paid
    for (const ev of EVENTS) {
      const f = raceFloor(ev);
      expect(at(ev.id, f - 0.01), ev.id).toBe(false);
      expect(at(ev.id, f), ev.id).toBe(true);
    }
  });
});
