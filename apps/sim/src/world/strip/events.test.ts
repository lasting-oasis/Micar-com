import { describe, it, expect } from 'vitest';
import { EventRunner, sortStandings, type EventFx } from './events';
import { makeAI, setWander, type AI } from './ai';
import { routePoint } from './routes';
import { makeVehicle, carParams, resetVehicle, NO_INPUT } from '../physics';
import { ARCHETYPES, EVENTS, STOCK_CFG, TUNE_DEF, type EventDef } from '../data';

const ev = (id: string): EventDef => EVENTS.find(e => e.id === id)!;
const sprint = ev('sp1'), drag = ev('dr1'), circuit = ev('ci1');
const sedan = () => carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF);

function stubFx(): EventFx & { banners: string[]; sounds: string[] } {
  const banners: string[] = [], sounds: string[] = [];
  return { banners, sounds, banner: t => { banners.push(t); }, sfx: n => { sounds.push(n); }, spawnRacerMesh: () => ({}), disposeMesh: () => {}, placeCp: () => {}, stage: () => 1, styleRating: () => 0 };
}
function runner(_ev: EventDef): EventRunner {
  const ais: AI[] = [];
  for (let i = 0; i < 6; i++) { const A = makeAI({ kind: 'traffic', vmax: 12, acc: 5, brk: 8, lane: 3.2 }); setWander(A, [1 + i, 1 + (i % 3)]); ais.push(A); }
  const R = makeAI({ kind: 'rival', vmax: 16, acc: 6, brk: 10, lane: 3.2, name: 'Rico' }); setWander(R, [4, 4]); ais.push(R);
  return new EventRunner(makeVehicle(sedan()), ais, stubFx(), sedan);
}
function tick(r: EventRunner, seconds: number): void {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds * 60); i++) { r.input(NO_INPUT, dt); r.postStep(dt); r.update(dt); }
}
/* Progress along a route is tracked incrementally (routeProgress searches ±45 m around the last s each step),
   so a single jump to the last node is not seen as progress. "Teleport" in 20 m hops along the route,
   one update per hop, ending exactly at the last node. */
function teleportToEnd(r: EventRunner): void {
  const a = r.active!, route = a.route, last = route.nodes[route.nodes.length - 1];
  for (let s = a.pS; s < route.len; s += 20) { const p = routePoint(route, s); resetVehicle(r.PV, p.x, p.z, Math.atan2(p.tx, p.tz)); r.update(1 / 60); if (r.active!.state !== 'race') return; }
  resetVehicle(r.PV, last[0] * 90, last[1] * 90, r.PV.h);
}

describe('strip events', () => {
  it('a sprint counts down, then races, then finishes when the player passes the last node', () => { const r = runner(sprint); r.start(sprint); expect(r.active!.state).toBe('count'); tick(r, 4); expect(r.active!.state).toBe('race'); teleportToEnd(r); tick(r, 0.5); expect(r.active!.state).toBe('done'); const res = r.results()!; expect(res.pos).toBeGreaterThanOrEqual(1); expect(res.failed).toBeNull(); });
  it('standings put a DNF last and sort finishers by time', () => { const list = [{ name: 'a', ft: 30 }, { name: 'You', me: true, ft: 25 }, { name: 'b', ft: null, s: 100 }]; expect(sortStandings(list, 'sprint').map(p => p.name)).toEqual(['You', 'a', 'b']); });
  it('drift sorts by score', () => { expect(sortStandings([{ name: 'a', score: 10 }, { name: 'You', me: true, score: 40 }], 'drift')[0].name).toBe('You'); });
  it('a blown engine fails a drag race', () => { const r = runner(drag); r.start(drag); tick(r, 4); r.PV.overRev = 2; r.update(1/60); expect(r.active!.fail).toBe('Engine blown'); expect(r.results()!.failed).toBe('Engine blown'); });
  it('cleanup removes racers from the AI list and restores traffic', () => { const r = runner(circuit); r.start(circuit); const n = r.ais.length; r.cleanup(); expect(r.active).toBeNull(); expect(r.ais.length).toBeLessThan(n); expect(r.ais.every(a => !a.parked)).toBe(true); });
});
