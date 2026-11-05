import { describe, it, expect } from 'vitest';
import { blockRect, buildRoute, gridPath, routePoint, routeProgress } from './routes';

describe('strip routes', () => {
  it('a 3x3-cell square loop is about 4 sides long with cut corners', () => { const r = buildRoute([[2,2],[2,5],[5,5],[5,2]], true); expect(r.len).toBeGreaterThan(4 * 270 - 60); expect(r.len).toBeLessThan(4 * 270); expect(r.nodeS[0]).toBe(0); expect(r.nodeS[1]).toBeGreaterThan(250); });
  it('routePoint wraps on a loop and clamps on a sprint', () => { const loop = buildRoute([[2,2],[2,5],[5,5],[5,2]], true), sp = buildRoute([[0,4],[5,4]], false); const p = routePoint(loop, loop.len + 5), q = routePoint(loop, 5); expect(p.x).toBeCloseTo(q.x, 3); expect(routePoint(sp, 1e6).x).toBeCloseTo(sp.pts[sp.pts.length - 1][0], 3); });
  it('routeProgress finds the nearest point near the guess', () => { const r = buildRoute([[0,4],[5,4]], false); const p = routePoint(r, 123); expect(routeProgress(r, p.x, p.z - 1, 100).s).toBeCloseTo(123, 0); });
  it('gridPath walks the grid', () => { const p = gridPath([0,0],[2,1]); expect(p[0]).toEqual([0,0]); expect(p[p.length-1]).toEqual([2,1]); expect(p.length).toBe(4); });
  it('blockRect is null outside the border ring', () => { expect(blockRect(-2, 0)).toBeNull(); expect(blockRect(0, 0)).toEqual([10, 10, 80, 80]); });
});
