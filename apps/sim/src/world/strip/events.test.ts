import path from 'node:path';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { DRAG_LANES, EventRunner, sortStandings, type EventFx, type NetField, type Racer } from './events';
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
  return { cps, banners, sounds, spawned, disposed, banner: t => { banners.push(t); }, sfx: n => { sounds.push(n); }, spawnRacerMesh: (cfg, who) => { const m = { cfg, who }; spawned.push(m); return m; }, disposeMesh: m => { disposed.push(m); }, placeCp: (p, t) => { if (p) cps.push(t); }, stage: () => 1, styleRating: () => 0 };
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

describe('a challenge: the other cars are people', () => {
  // the clock the racers share, and the green light on it (null until the server has named it)
  let clock = 0, go: number | null = null;
  beforeEach(() => { clock = 0; go = null; });
  const field = (over: Partial<NetField> = {}): NetField => ({
    slot: 2,
    others: [{ id: 'p2', name: 'Ana', slot: 0, color: '#ffd23f', style: 'coupe' }, { id: 'p3', name: 'Bo', slot: 1, color: '#2a9df4', style: 'coupe' }],
    goAt: () => go, now: () => clock, ...over,
  });
  /** `seconds` of updates at `hz` a second, the clock moving with them */
  function tickClock(r: EventRunner, seconds: number, hz = 60): void {
    const dt = 1 / hz;
    for (let i = 0; i < Math.round(seconds * hz); i++) { clock += 1000 / hz; r.input(NO_INPUT, dt); r.postStep(dt); r.update(dt); }
  }
  /** a challenge on `e`, past its green light (at 5 s) */
  function racing(e: EventDef, over: Partial<NetField> = {}): EventRunner {
    const r = runner(e); go = 5000; r.start(e, { net: field(over) }); tickClock(r, 5.1);
    expect(r.active!.state).toBe('race');
    return r;
  }
  const people = (r: EventRunner) => r.active!.racers as Racer[];
  /** where a car stands against the start line: metres along the route's direction, and to its right */
  function gridPlace(r: EventRunner, at: { x: number; z: number }) {
    const p0 = routePoint(r.active!.route, 0);
    return { along: (at.x - p0.x) * p0.tx + (at.z - p0.z) * p0.tz, right: (at.x - p0.x) * -p0.tz + (at.z - p0.z) * p0.tx };
  }

  it('a challenge spawns only the people', () => {
    const r = runner(circuit), fx = r.fx as StubFx; r.start(circuit, { net: field() });
    expect(fx.spawned.map(m => { const s = m as { cfg: { color: string }; who: { name: string; style: string } }; return [s.who.name, s.who.style, s.cfg.color]; }))
      .toEqual([['Ana', 'coupe', '#ffd23f'], ['Bo', 'coupe', '#2a9df4']]);
    expect(people(r).map(p => [p.name, p.remote, p.pid, p.kind])).toEqual([['Ana', true, 'p2', 'racer'], ['Bo', true, 'p3', 'racer']]);
    expect(people(r).every(p => r.ais.includes(p))).toBe(true); // the scene draws what is in the AI list
    const d = runner(drag), dfx = d.fx as StubFx; d.start(drag, { net: field() });
    expect(d.active!.drag.ai).toEqual([]);
    expect(dfx.spawned).toHaveLength(2);
  });
  it('everyone stands on the place the room gave', () => {
    const r = runner(circuit); r.start(circuit, { net: field({ slot: 2 }) });
    const me = gridPlace(r, r.PV), [ana, bo] = people(r).map(p => gridPlace(r, p));
    expect(me.along).toBeCloseTo(-8, 4); expect(me.right).toBeCloseTo(-3, 4);  // the third place: back row, left
    expect(ana.along).toBeCloseTo(0, 4); expect(ana.right).toBeCloseTo(-3, 4); // the first
    expect(bo.along).toBeCloseTo(0, 4); expect(bo.right).toBeCloseTo(3, 4);    // the second
    for (let i = 0; i < 20; i++) { const again = runner(circuit); again.start(circuit, { net: field({ slot: 2 }) }); expect(gridPlace(again, again.PV).along).toBeCloseTo(-8, 4); } // never a random place
    const d = runner(drag); d.start(drag, { net: field({ slot: 3 }) });
    const lane = (at: { x: number; z: number }) => { const g = d.active!.drag; return (at.x - g.p0!.x) * g.right[0] + (at.z - g.p0!.z) * g.right[1]; };
    expect(lane(d.PV)).toBeCloseTo(DRAG_LANES[3], 4);
    expect(people(d).map(p => lane(p))).toEqual([DRAG_LANES[0], DRAG_LANES[1]].map(v => expect.closeTo(v, 4)));
    expect(d.active!.drag.lane).toBe(3);
  });
  it('it waits for the green light', () => {
    const r = runner(sprint), fx = r.fx as StubFx; r.start(sprint, { net: field() });
    const x = r.PV.x, z = r.PV.z;
    tickClock(r, 10);
    expect(r.active!.state).toBe('count');
    expect(fx.banners).toEqual([]); expect(fx.sounds).toEqual([]); // no count, no beep, until there is an instant to count to
    expect(r.PV.x).toBe(x); expect(r.PV.z).toBe(z);
  });
  it('goes at the named instant whatever the frame rate', () => {
    for (const hz of [60, 5]) {
      clock = 0; go = 5000;
      const r = runner(sprint), fx = r.fx as StubFx; r.start(sprint, { net: field() });
      let wentAt = -1;
      for (let i = 0; i < 8 * hz && wentAt < 0; i++) { tickClock(r, 1 / hz, hz); if (r.active!.state === 'race') wentAt = clock; }
      expect(wentAt).toBeGreaterThanOrEqual(5000);
      expect(wentAt - 1000 / hz).toBeLessThan(5000); // the first update at or after the instant, not one later
      expect(fx.banners).toEqual(['3', '2', '1', 'GO']);
      expect(fx.sounds).toEqual(['beep', 'beep', 'beep', 'go']);
    }
  });
  it('a green light named late still goes at its instant', () => {
    const r = runner(sprint), fx = r.fx as StubFx; r.start(sprint, { net: field() });
    tickClock(r, 2); go = 2500; // named with half a second to go: the count joins at 1
    tickClock(r, 1);
    expect(r.active!.state).toBe('race');
    expect(fx.banners).toEqual(['1', 'GO']);
  });
  it('the race clock is the wall clock', () => {
    const r = racing(sprint);
    clock = 5000 + 12_500; r.update(1 / 60);
    expect(r.active!.time).toBeCloseTo(12.5, 6);
  });
  it('the cap does not end a challenge', () => {
    const r = racing(sprint); // a 4.3 km sprint is capped at 600 s when raced against the computer
    clock = 5000 + 605_000; r.update(1 / 60);
    expect(r.active!.state).toBe('race');
  });
  it('the others are ranked by their progress, and nobody is stepped', () => {
    const r = racing(sprint), a = r.active!, [ana, bo] = people(r);
    ana.s = a.pS + 50; bo.s = a.pS - 20;
    expect(r.standings().map(p => p.name)).toEqual(['Ana', 'You', 'Bo']);
    const at = [ana.x, ana.z, bo.x, bo.z];
    tickClock(r, 2);
    expect([ana.x, ana.z, bo.x, bo.z]).toEqual(at); // their browsers drive them, not this one
  });
  it('onFinish fires once at the line, with the wall time', () => {
    const r = racing(sprint); let n = 0; r.onFinish = () => { n++; };
    clock = 5000 + 61_000;
    teleportToEnd(r); r.update(1 / 60);
    expect(r.active!.state).toBe('done');
    expect(n).toBe(1);
    expect(r.active!.pFt).toBeCloseTo(61, 6);
    tickClock(r, 2);
    expect(n).toBe(1);
    expect(people(r).every(p => p.ft === null && !p.estimated)).toBe(true); // nobody's time is guessed: the room has the real ones
  });
  it('a blown engine in a challenge drag ends it once, failed', () => {
    const r = racing(drag); let n = 0; r.onFinish = () => { n++; };
    r.PV.overRev = 2; r.update(1 / 60); tickClock(r, 1);
    expect(n).toBe(1);
    expect(r.active!.fail).toBe('Engine blown'); expect(r.active!.pFt).toBeNull();
  });
  it('remoteDone records a finish, or parks a racer who is out', () => {
    const r = racing(sprint), [ana, bo] = people(r);
    r.remoteDone('p2', 31.2);
    expect(ana).toMatchObject({ ft: 31.2, done: true, parked: false });
    r.remoteDone('p3', null);
    expect(bo).toMatchObject({ ft: null, done: true, parked: true });
    r.remoteDone('nobody', 1);
    expect(r.standings().map(p => [p.name, p.ft ?? null])).toEqual([['Ana', 31.2], ['You', null], ['Bo', null]]);
  });
  it("a drag's standings list the people", () => {
    const r = racing(drag);
    expect(r.standings().map(p => p.name).sort()).toEqual(['Ana', 'Bo', 'You']);
  });
  it("cleanup disposes every racer's mesh and takes them off the AI list", () => {
    const r = racing(circuit), fx = r.fx as StubFx, racers = people(r).slice();
    r.cleanup();
    expect(new Set(fx.disposed)).toEqual(new Set(fx.spawned)); expect(fx.disposed).toHaveLength(2);
    expect(racers.some(p => r.ais.includes(p))).toBe(false);
  });
  it('without a challenge onFinish still fires once, and the computer still races', () => {
    const r = runner(sprint), fx = r.fx as StubFx; let n = 0; r.onFinish = () => { n++; };
    r.start(sprint); tick(r, 4); teleportToEnd(r); tick(r, 0.5);
    expect(n).toBe(1);
    expect(fx.spawned).toHaveLength(3);
    expect(r.active!.racers.every(p => p.ft !== null)).toBe(true); // the computer's unfinished cars get an estimated time, as before
  });
});
