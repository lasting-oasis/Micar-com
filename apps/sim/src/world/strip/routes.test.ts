import { describe, it, expect } from 'vitest';
import { buildRoute, cpPoint, nearestRoadPoint, offsetPts, roadRoute, routePoint, routeProgress, snapToRoad, type Pt, type RoadData } from './routes';
import { carParams, makeVehicle, resetVehicle } from '../physics';
import { ARCHETYPES, STOCK_CFG, TUNE_DEF } from '../data';

const SQ: Pt[] = [[0, 0], [100, 0], [100, 100], [0, 100]];

describe('strip routes', () => {
  it('a square polyline loop is 4 sides long', () => { const r = buildRoute(SQ, true); expect(r.len).toBeCloseTo(400, 6); expect(r.cps).toEqual([0]); });
  it('a sprint\'s default checkpoints are its ends', () => { expect(buildRoute([[0, 0], [300, 0]], false).cps).toEqual([0, 300]); });
  it('routePoint wraps on a loop and clamps on a sprint', () => {
    const loop = buildRoute(SQ, true), sp = buildRoute([[0, 0], [300, 0]], false);
    const p = routePoint(loop, loop.len + 5), q = routePoint(loop, 5);
    expect(p.x).toBeCloseTo(q.x, 3); expect(p.z).toBeCloseTo(q.z, 3);
    expect(routePoint(sp, 1e6).x).toBeCloseTo(sp.pts[sp.pts.length - 1][0], 3);
  });
  it('routeProgress finds the nearest point near the guess', () => { const r = buildRoute([[0, 0], [300, 0]], false); const p = routePoint(r, 123); expect(routeProgress(r, p.x, p.z - 1, 100).s).toBeCloseTo(123, 0); });
  it('cpPoint k wraps to the start on a loop', () => { const r = buildRoute(SQ, true, [0, 100, 200, 300]); const a = cpPoint(r, 4), b = routePoint(r, 0); expect(a.x).toBeCloseTo(b.x, 6); expect(a.z).toBeCloseTo(b.z, 6); });
  it('nearestRoadPoint snaps a point beside a road onto it', () => {
    const roads: RoadData[] = [{ id: 'ring', pts: SQ, loop: true, width: 12 }];
    const p = routePoint(roadRoute(roads[0]), 150), q = nearestRoadPoint(p.x - p.tz * 5, p.z + p.tx * 5, roads);
    expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeLessThan(0.5); expect(q.road.id).toBe('ring'); expect(Math.abs(q.s - 150)).toBeLessThan(1);
  });
  it('snapToRoad stops the car on the road facing along it', () => {
    const roads: RoadData[] = [{ id: 'ring', pts: SQ, loop: true, width: 12 }];
    const p = routePoint(roadRoute(roads[0]), 150);
    const V = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF));
    resetVehicle(V, p.x - p.tz * 5, p.z + p.tx * 5, Math.atan2(p.tx, p.tz) + 0.1); V.u = 10;
    snapToRoad(V, roads);
    const q = nearestRoadPoint(V.x, V.z, roads);
    expect(V.u).toBe(0); expect(Math.hypot(V.x - q.x, V.z - q.z)).toBeLessThan(0.5);
    expect(Math.abs(Math.cos(V.h - Math.atan2(q.tx, q.tz)))).toBeGreaterThan(0.99);
  });
  it('offsetPts adds the offset', () => { expect(offsetPts([[1, 2]], [10, 20])).toEqual([[11, 22]]); });
});
