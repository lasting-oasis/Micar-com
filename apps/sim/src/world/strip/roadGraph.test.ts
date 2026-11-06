import { describe, expect, it } from 'vitest';
import { HUB, SPAWN, TRACKS, type Pt } from './district';
import { nearestRoadPoint, roadRoute } from './routes';
import { extendWander, pointOnRoad, shortestPath, wanderFrom } from './roadGraph';

const plen = (p: Pt[]) => { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return s; };
const offRoad = (p: Pt) => { const q = nearestRoadPoint(p[0], p[1], HUB.roads); return Math.hypot(q.x - p[0], q.z - p[1]); };

describe('roadGraph', () => {
  it('the shortest path between two loop points follows the loop', () => {
    const path = shortestPath(pointOnRoad('loop', 0), pointOnRoad('loop', 300));
    expect(Math.abs(plen(path) - 300)).toBeLessThan(30);
  });
  it('every portal is reachable from the spawn', () => {
    for (const t of TRACKS) {
      const portal = HUB.portals[t.id];
      const path = shortestPath([SPAWN.x, SPAWN.z], portal);
      expect(path.length).toBeGreaterThanOrEqual(2);
      const q = nearestRoadPoint(portal[0], portal[1], HUB.roads), last = path[path.length - 1];
      expect(Math.hypot(last[0] - q.x, last[1] - q.z)).toBeLessThan(3);
    }
  });
  it('a GPS from the grass still finds a road', () => {
    const a = pointOnRoad('loop', 99), b = pointOnRoad('loop', 101), p = pointOnRoad('loop', 100);
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    const path = shortestPath([p[0] - dz / L * 40, p[1] + dx / L * 40], pointOnRoad('loop', 300));
    expect(offRoad(path[0])).toBeLessThan(0.5);
  });
  it('wanderFrom stays on the roads and is long enough', () => {
    for (let i = 0; i < 20; i++) {
      const w = wanderFrom(pointOnRoad('loop', 0), 400);
      expect(plen(w)).toBeGreaterThanOrEqual(400);
      for (const p of w) expect(offRoad(p)).toBeLessThan(0.5);
    }
  });
  it('extendWander keeps going', () => {
    const base = wanderFrom(pointOnRoad('loop', 0), 100), ext = extendWander(base, 200);
    expect(plen(ext)).toBeGreaterThanOrEqual(300);
    expect(ext.slice(0, base.length)).toEqual(base);
  });
  it('pointOnRoad wraps', () => {
    const len = roadRoute(HUB.roads.find((r) => r.id === 'loop')!).len;
    const a = pointOnRoad('loop', len + 10), b = pointOnRoad('loop', 10);
    expect(a[0]).toBeCloseTo(b[0], 6); expect(a[1]).toBeCloseTo(b[1], 6);
  });
});
