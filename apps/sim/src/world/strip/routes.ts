// The Strip's routes: arbitrary polylines in metres (pure geometry).
import { clamp, type Vehicle } from '../physics';

export type Pt = [number, number];
export type RoadData = { id: string; pts: Pt[]; loop: boolean; width: number };
export type Route = { pts: Pt[]; cum: number[]; len: number; loop: boolean; cps: number[] };

/** A polyline -> route; s = distance along. cps (checkpoint distances) default: loop -> [0]; else [0, len]. */
export function buildRoute(pts: Pt[], loop: boolean, cps?: number[]): Route {
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  if (loop) { const a = pts[pts.length - 1], b = pts[0]; cum.push(cum[cum.length - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const len = cum[cum.length - 1];
  return { pts, cum, len, loop, cps: cps ?? (loop ? [0] : [0, len]) };
}
export function routePoint(route: Route, s: number): { x: number; z: number; tx: number; tz: number } {
  const L = route.len; if (route.loop) s = ((s % L) + L) % L; else s = clamp(s, 0, L);
  const pts = route.pts, cum = route.cum, n = pts.length;
  let lo = 0, hi = cum.length - 1; while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  const p0 = pts[lo], p1 = pts[(lo + 1) % n], segL = cum[lo + 1] - cum[lo] || 1, t = (s - cum[lo]) / segL;
  return { x: p0[0] + (p1[0] - p0[0]) * t, z: p0[1] + (p1[1] - p0[1]) * t, tx: (p1[0] - p0[0]) / segL, tz: (p1[1] - p0[1]) / segL };
}
export function routeProgress(route: Route, x: number, z: number, sGuess: number, span = 50): { s: number; d: number } {
  let best = sGuess, bd = 1e9;
  for (let s = sGuess - span; s <= sGuess + span; s += 2.5) { const p = routePoint(route, s); const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = s; } }
  for (let s = best - 2.5; s <= best + 2.5; s += .5) { const p = routePoint(route, s); const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = s; } }
  return { s: route.loop ? best : clamp(best, 0, route.len), d: bd };
}

export function cpPoint(route: Route, k: number): { x: number; z: number } { const p = routePoint(route, route.cps[k % route.cps.length]); return { x: p.x, z: p.z }; }

/** Closest point on any road: coarse scan of each road's points, then refine on the two adjacent segments (wrapping on loops). */
export function nearestRoadPoint(x: number, z: number, roads: RoadData[]): { x: number; z: number; tx: number; tz: number; road: RoadData; s: number } {
  let bd = Infinity, bi = 0, bk = 0;
  for (let i = 0; i < roads.length; i++) { const pts = roads[i].pts; for (let k = 0; k < pts.length; k++) { const d = (pts[k][0] - x) ** 2 + (pts[k][1] - z) ** 2; if (d < bd) { bd = d; bi = i; bk = k; } } }
  const road = roads[bi], pts = road.pts, n = pts.length, route = roadRoute(road);
  bd = Infinity; let out = { x: pts[bk][0], z: pts[bk][1], tx: 1, tz: 0, road, s: route.cum[bk] };
  const segs: number[] = [];
  if (road.loop) segs.push((bk - 1 + n) % n, bk); else { if (bk > 0) segs.push(bk - 1); if (bk < n - 1) segs.push(bk); }
  for (const a of segs) {
    const p0 = pts[a], p1 = pts[(a + 1) % n], dx = p1[0] - p0[0], dz = p1[1] - p0[1], L2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - p0[0]) * dx + (z - p0[1]) * dz) / L2, 0, 1), px = p0[0] + dx * t, pz = p0[1] + dz * t, d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < bd) { const L = Math.sqrt(L2); bd = d; out = { x: px, z: pz, tx: dx / L, tz: dz / L, road, s: route.cum[a] + t * L }; }
  }
  return out;
}
export function snapToRoad(V: Vehicle, roads: RoadData[]): void {
  const q = nearestRoadPoint(V.x, V.z, roads); V.x = q.x; V.z = q.z;
  const hx = Math.sin(V.h), hz = Math.cos(V.h);
  V.h = hx * q.tx + hz * q.tz >= 0 ? Math.atan2(q.tx, q.tz) : Math.atan2(-q.tx, -q.tz);
  V.u = V.v = V.w = V.vx = V.vz = 0; V.gear = 1;
}
export function offsetPts(pts: Pt[], offset: Pt): Pt[] { return pts.map((p): Pt => [p[0] + offset[0], p[1] + offset[1]]); }
const routeCache = new WeakMap<RoadData, Route>();
export function roadRoute(road: RoadData): Route { let r = routeCache.get(road); if (!r) { r = buildRoute(road.pts, road.loop); routeCache.set(road, r); } return r; }
