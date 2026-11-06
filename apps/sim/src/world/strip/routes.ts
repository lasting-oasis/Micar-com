// The Strip's grid and routes (pure geometry, metres). Ported from Night Tuner 05-world.js.
import { clamp, type Vehicle } from '../physics';
import { RENTAL_BLOCK } from '../rental';

export const N = 8, CELL = 90, RW = 20, BL = CELL - RW, SPAN = N * CELL;

export type Node = [number, number];
export type Route = { pts: [number, number][]; cum: number[]; len: number; loop: boolean; nodes: Node[]; nodeS: number[] };

/** A block's solid footprint (metres); null outside the border ring and for the rental lot's block (open: the car is parked on it). */
export function blockRect(i: number, j: number): [number, number, number, number] | null { if (i < -1 || j < -1 || i > N || j > N) return null; if (i === RENTAL_BLOCK[0] && j === RENTAL_BLOCK[1]) return null; return [i < 0 ? -1e4 : i * CELL + RW / 2, j < 0 ? -1e4 : j * CELL + RW / 2, i >= N ? 1e4 : (i + 1) * CELL - RW / 2, j >= N ? 1e4 : (j + 1) * CELL - RW / 2]; }
export function nearestNode(x: number, z: number): Node { return [clamp(Math.round(x / CELL), 0, N), clamp(Math.round(z / CELL), 0, N)]; }
export function nodeNeighbors(i: number, j: number): Node[] { const r: Node[] = []; if (i > 0) r.push([i - 1, j]); if (i < N) r.push([i + 1, j]); if (j > 0) r.push([i, j - 1]); if (j < N) r.push([i, j + 1]); return r; }
export function gridPath(a: Node, b: Node): Node[] {
  const key = (n: Node): string => n[0] + ',' + n[1];
  const prev = new Map<string, Node | null>(); const q: Node[] = [a]; prev.set(key(a), null);
  while (q.length) { const c = q.shift() as Node; if (c[0] === b[0] && c[1] === b[1]) break; for (const n of nodeNeighbors(c[0], c[1])) { const k = key(n); if (!prev.has(k)) { prev.set(k, c); q.push(n); } } }
  const out: Node[] = []; let c: Node | null | undefined = prev.has(key(b)) ? b : null;
  while (c) { out.unshift(c); c = prev.get(key(c)); }
  return out;
}

/* routes: node list -> polyline with cut corners; s = distance along */
export function buildRoute(nodes: Node[], loop: boolean): Route {
  const pts: [number, number][] = [], R = 12, n = nodes.length, segs = loop ? n : n - 1;
  const dirAt = (k: number): [number, number] => { const A = nodes[k], B = nodes[(k + 1) % n]; return [Math.sign(B[0] - A[0]), Math.sign(B[1] - A[1])]; };
  for (let k = 0; k < segs; k++) {
    const A = nodes[k], B = nodes[(k + 1) % n], d = dirAt(k); const ax = A[0] * CELL, az = A[1] * CELL, bx = B[0] * CELL, bz = B[1] * CELL;
    const sc = (loop || k > 0) ? R : 0, ec = (loop || k < segs - 1) ? R : 0;
    pts.push([ax + d[0] * sc, az + d[1] * sc]); pts.push([bx - d[0] * ec, bz - d[1] * ec]);
    if (loop || k < segs - 1) {
      const d2 = dirAt((k + 1) % n);
      if (d2[0] !== d[0] || d2[1] !== d[1]) {
        const p0 = [bx - d[0] * R, bz - d[1] * R], p2 = [bx + d2[0] * R, bz + d2[1] * R];
        for (let q = 1; q < 4; q++) { const t = q / 4; pts.push([(1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * bx + t * t * p2[0], (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * bz + t * t * p2[1]]); }
      }
    }
  }
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  if (loop) { const a = pts[pts.length - 1], b = pts[0]; cum.push(cum[cum.length - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const route: Route = { pts, cum, len: cum[cum.length - 1], loop, nodes, nodeS: [] };
  route.nodeS = nodes.map((nd, k) => { if (k === 0) return 0; const x = nd[0] * CELL, z = nd[1] * CELL; let best = 0, bd = 1e9; for (let s = 0; s <= route.len; s += 2) { const p = routePoint(route, s); const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = s; } } return best; });
  return route;
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

export function snapToRoad(V: Vehicle): void {
  const ix = Math.round(V.x / CELL), iz = Math.round(V.z / CELL); const dx = Math.abs(V.x - ix * CELL), dz = Math.abs(V.z - iz * CELL);
  if (dx < dz) { V.x = ix * CELL; V.z = clamp(V.z, RW, SPAN - RW); V.h = Math.cos(V.h) >= 0 ? 0 : Math.PI; }
  else { V.z = iz * CELL; V.x = clamp(V.x, RW, SPAN - RW); V.h = Math.sin(V.h) >= 0 ? Math.PI / 2 : -Math.PI / 2; }
  V.u = V.v = V.w = V.vx = V.vz = 0; V.gear = 1;
}
