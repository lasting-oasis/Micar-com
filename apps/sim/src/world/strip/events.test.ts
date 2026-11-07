import path from 'node:path';
import { beforeAll, describe, it, expect } from 'vitest';
import { EventRunner, sortStandings, type EventFx } from './events';
import { makeAI, setWander, type AI } from './ai';
import { cpPoint, routePoint } from './routes';
import { routeFor, TRACKS } from './district';
import { readTrackSync, setTrackDir } from './districtNode';
import { pointOnRoad } from './roadGraph';
import { makeVehicle, carParams, resetVehicle, NO_INPUT } from '../physics';
import { ARCHETYPES, EVENTS, STOCK_CFG, TUNE_DEF, type EventDef } from '../data';

beforeAll(() => { setTrackDir(path.resolve(process.cwd(), 'public/strip/tracks')); for (const t of TRACKS) readTrackSync(t.id); });

const ev = (id: string): EventDef => EVENTS.find(e => e.id === id)!;
const sprint = ev('lagoons_sprint'), drag = ev('royal_drag'), circuit = ev('harbour_gp'), streetx = ev('drylagoon_x');
const sedan = () => carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF);

type StubFx = EventFx & { cps: ({ tx: number; tz: number } | undefined)[]; banners: string[]; sounds: string[]; spawned: unknown[]; disposed: unknown[] };
function stubFx(): StubFx {
  const cps: StubFx['cps'] = [], banners: string[] = [], sounds: string[] = [], spawned: unknown[] = [], disposed: unknown[] = [];
  return { cps, banners, sounds, spawned, disposed, banner: t => { banners.push(t); }, sfx: n => { sounds.push(n); }, spawnRacerMesh: () => { const m = {}; spawned.push(m); return m; }, disposeMesh: m => { disposed.push(m); }, placeCp: (p, t) => { if (p) cps.push(t); }, stage: () => 1, styleRating: () => 0 };
}
function runner(_ev: EventDef): EventRunner {
  const ais: AI[] = [];
  for (let i = 0; i < 6; i++) { const A = makeAI({ kind: 'traffic', vmax: 12, acc: 5, brk: 8, lane: 3.2 }); setWander(A, pointOnRoad('loop', i * 100)); ais.push(A); }
  const R = makeAI({ kind: 'rival', vmax: 16, acc: 6, brk: 10, lane: 3.2, name: 'Rico' }); setWander(R, pointOnRoad('loop', 450)); ais.push(R);
  return new EventRunner(makeVehicle(sedan()), ais, stubFx(), sedan);
}
function tick(r: EventRunner, seconds: number): void {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds * 60); i++) { r.input(NO_INPUT, dt); r.postStep(dt); r.update(dt); }
}
/* Progress along a route is tracked incrementally (routeProgress searches ±45 m around the last s each step),
   so a single jump to the last checkpoint is not seen as progress. "Teleport" in 20 m hops along the route,
   one update per hop, ending exactly at the last checkpoint. */
function teleportToEnd(r: EventRunner): void {
  const a = r.active!, route = a.route, last = cpPoint(route, route.cps.length - 1);
  for (let s = a.pS; s < route.len; s += 20) { const p = routePoint(route, s); resetVehicle(r.PV, p.x, p.z, Math.atan2(p.tx, p.tz)); r.update(1 / 60); if (r.active!.state !== 'race') return; }
  resetVehicle(r.PV, last.x, last.z, r.PV.h);
}

describe('strip events', () => {
  it('an event quit without results is reported once; one with results is not', () => {
    const r = runner(sprint), quit: string[] = []; r.onAbandon = e => quit.push(e.id);
    r.start(sprint); tick(r, 1); r.quit(); r.cleanup(); expect(quit).toEqual(['lagoons_sprint']);
    r.start(drag); r.start(sprint); expect(quit).toEqual(['lagoons_sprint', 'royal_drag']); // a new start abandons the old one
    tick(r, 4); teleportToEnd(r); tick(r, 0.5); r.results(); r.cleanup(); expect(quit).toEqual(['lagoons_sprint', 'royal_drag']);
  });
  it('a sprint counts down, then races, then finishes when the player passes the last node', () => { const r = runner(sprint); r.start(sprint); expect(r.active!.state).toBe('count'); tick(r, 4); expect(r.active!.state).toBe('race'); teleportToEnd(r); tick(r, 0.5); expect(r.active!.state).toBe('done'); const res = r.results()!; expect(res.pos).toBeGreaterThanOrEqual(1); expect(res.failed).toBeNull(); });
  it('standings put a DNF last and sort finishers by time', () => { const list = [{ name: 'a', ft: 30 }, { name: 'You', me: true, ft: 25 }, { name: 'b', ft: null, s: 100 }]; expect(sortStandings(list, 'sprint').map(p => p.name)).toEqual(['You', 'a', 'b']); });
  it('drift sorts by score', () => { expect(sortStandings([{ name: 'a', score: 10 }, { name: 'You', me: true, score: 40 }], 'drift')[0].name).toBe('You'); });
  it('a blown engine fails a drag race', () => { const r = runner(drag); r.start(drag); tick(r, 4); r.PV.overRev = 2; r.update(1/60); expect(r.active!.fail).toBe('Engine blown'); expect(r.results()!.failed).toBe('Engine blown'); });
  it('cleanup removes racers from the AI list and restores traffic', () => { const r = runner(circuit); r.start(circuit); const n = r.ais.length; r.cleanup(); expect(r.active).toBeNull(); expect(r.ais.length).toBeLessThan(n); expect(r.ais.every(a => !a.parked)).toBe(true); });
  it('placeCp gets the route tangent as a unit vector', () => {
    const r = runner(circuit); const fx = r.fx as StubFx; r.start(circuit); tick(r, 4);
    expect(fx.cps.length).toBeGreaterThan(0);
    for (const t of fx.cps) { expect(t).toBeDefined(); expect(Math.hypot(t!.tx, t!.tz)).toBeCloseTo(1, 3); }
  });
  it('cleanup calls onCleanup once', () => { const r = runner(sprint); let n = 0; r.onCleanup = () => { n++; }; r.start(sprint); r.cleanup(); r.cleanup(); expect(n).toBe(1); });
  it('cleanup un-parks the traffic a no-traffic event parked and disposes every racer mesh', () => { const r = runner(streetx); const fx = r.fx as StubFx; r.start(streetx); expect(r.ais.some(a => a.parked)).toBe(true); expect(fx.spawned.length).toBe(3); r.cleanup(); expect(r.active).toBeNull(); expect(r.ais.every(a => !a.parked)).toBe(true); expect(fx.disposed.length).toBe(fx.spawned.length); expect(new Set(fx.disposed)).toEqual(new Set(fx.spawned)); });
  it('cleanup after a drag race restores parked traffic and disposes every drag car', () => { const r = runner(drag); const fx = r.fx as StubFx; r.start(drag); expect(r.ais.some(a => a.parked)).toBe(true); expect(fx.spawned.length).toBe(3); r.cleanup(); expect(r.active).toBeNull(); expect(r.ais.every(a => !a.parked)).toBe(true); expect(fx.disposed.length).toBe(fx.spawned.length); expect(new Set(fx.disposed)).toEqual(new Set(fx.spawned)); });
  it('a circuit counts its laps through the checkpoints', () => {
    const r = runner(circuit); r.start(circuit); tick(r, 4); expect(r.active!.state).toBe('race');
    const route = r.active!.route;
    for (let s = 0; s <= route.len * 2 + 20; s += 20) { const p = routePoint(route, s); resetVehicle(r.PV, p.x, p.z, Math.atan2(p.tx, p.tz)); r.update(1 / 60); if (r.active!.state !== 'race') break; }
    expect(r.active!.state).toBe('done'); tick(r, 1.5); expect(r.results()!.pos).toBeGreaterThanOrEqual(1);
  });
  it('a drag finishes at its length', () => {
    const r = runner(drag); r.start(drag); tick(r, 4); const a = r.active!, route = routeFor(drag.id);
    const p0 = a.drag.p0!; resetVehicle(r.PV, p0.x + a.drag.fwd[0] * route.len, p0.z + a.drag.fwd[1] * route.len, a.drag.dir); r.update(1 / 60);
    expect(a.state).toBe('done'); expect(r.results()!.failed).toBeNull();
  });
  it('a drift sector finishes at its last checkpoint', () => {
    const d = ev('harbour_drift'), r = runner(d); r.start(d); tick(r, 4); teleportToEnd(r); tick(r, 0.5); expect(r.active!.state).toBe('done');
  });
});

describe('the race cap', () => {
  it('is the larger of 600 s and 60 s plus 1 s per 8 m', async () => {
    const { raceCapS } = await import('./events');
    expect(raceCapS(402)).toBe(600);
    expect(raceCapS(13938)).toBeCloseTo(1802.25, 1);
  });
  it('a drag on a no-traffic event runs no lane traffic', () => {
    const r = runner(drag); r.start(drag); expect(drag.noTraffic).toBe(true); expect(r.active!.drag.trafficA).toHaveLength(0);
    expect(r.ais.filter(a => a.kind === 'traffic').every(a => a.parked)).toBe(true);
  });
});
