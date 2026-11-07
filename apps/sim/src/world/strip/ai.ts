// AI drivers and collisions (pure, mesh-free, metres). Ported from Night Tuner 05-world.js.
// The mesh `m` and `tag` are opaque handles owned by the renderer; visibility toggling lives there.
import { clamp, syncBody, type Vehicle } from '../physics';
import { buildRoute, routePoint, routeProgress, type Pt, type Route } from './routes';
import { wanderFrom, extendWander } from './roadGraph';

export type AI = {
  x: number; z: number; h: number; v: number; s: number; lane: number;
  route: Route | null; path: Pt[] | null;
  vmax: number; acc: number; brk: number; stun: number; nm: number; laps: number; done: boolean; ft: number | null;
  kind: 'traffic' | 'rival' | 'racer'; name: string; wander: boolean; score: number; hold: boolean; parked: boolean; steer: number; cool: number;
  m?: unknown; tag?: unknown;
};

export function makeAI(opts: Partial<AI> = {}): AI {
  return Object.assign({ x: 0, z: 0, h: 0, v: 0, s: 0, lane: 3.2, route: null, path: null, vmax: 13, acc: 5, brk: 8, stun: 0, nm: 0, laps: 0, done: false, ft: null, kind: 'traffic' as const, name: '', wander: false, score: 0, hold: false, parked: false, steer: 0, cool: 0 }, opts) as AI;
}

export function setWander(A: AI, at: Pt): void {
  A.path = wanderFrom(at, 400); A.route = buildRoute(A.path, false); A.s = 0; A.wander = true; A.done = false; A.parked = false;
  const p = routePoint(A.route, 0); A.x = p.x - p.tz * A.lane; A.z = p.z + p.tx * A.lane; A.h = Math.atan2(p.tx, p.tz); A.v = 0;
}

export function parkAI(A: AI): void { A.parked = true; A.x = -1e4; A.z = -1e4; }

export function stepAI(A: AI, dt: number, playerS: number | null, _stage: number): void {
  if (A.hold || A.done || A.parked || !A.route) return;
  if (A.wander && A.path && A.s > A.route.len - 60) {
    let k = 0, bd = Infinity;
    for (let i = 0; i < A.path.length; i++) { const d = (A.path[i][0] - A.x) ** 2 + (A.path[i][1] - A.z) ** 2; if (d < bd) { bd = d; k = i; } }
    A.path = extendWander(A.path.slice(Math.max(0, k - 2)), 400); A.route = buildRoute(A.path, false); A.s = routeProgress(A.route, A.x, A.z, 0, 60).s;
  }
  const rt = A.route, la = 7 + A.v * .5;
  const p = routePoint(rt, A.s + la); const tx = p.x - p.tz * A.lane, tz = p.z + p.tx * A.lane;
  const want = Math.atan2(tx - A.x, tz - A.z); let dh = want - A.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  const steer = clamp(dh * 1.8, -.6, .6); A.steer += (steer - A.steer) * Math.min(1, dt * 8); A.h += clamp(A.v * Math.tan(A.steer) / 2.6, -2.5, 2.5) * dt;
  let vT = A.vmax; let pa = Math.atan2(p.tx, p.tz);
  for (let d = 10; d <= 150; d += 10) {
    const q = routePoint(rt, A.s + la + d); const qa = Math.atan2(q.tx, q.tz); let turn = qa - pa; turn = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))); pa = qa;
    if (turn > .12) { const vc = Math.sqrt(150 / turn) + 1.5; vT = Math.min(vT, Math.sqrt(vc * vc + 2 * A.brk * .85 * Math.max(0, d - 8))); }
  }
  if (Math.abs(dh) > .6) vT = Math.min(vT, 7);
  if (A.kind === 'racer' && playerS != null) { const gap = A.s - playerS; if (gap < -70) vT *= 1.22; else if (gap < -25) vT *= 1.08; else if (gap > 60) vT *= .86; }
  if (A.stun > 0) { A.stun -= dt; vT = Math.min(vT, A.v * .9); }
  if (A.v < vT) A.v = Math.min(vT, A.v + A.acc * dt); else A.v = Math.max(vT, A.v - A.brk * dt);
  A.x += Math.sin(A.h) * A.v * dt; A.z += Math.cos(A.h) * A.v * dt;
  A.s = routeProgress(rt, A.x, A.z, A.s + A.v * dt, 40).s;
  A.nm = Math.max(0, A.nm - dt);
}

export function separateAIs(list: AI[]): void {
  for (let i = 0; i < list.length; i++) {
    const a = list[i]; if (a.parked || a.done) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]; if (b.parked || b.done) continue;
      const dx = a.x - b.x, dz = a.z - b.z; if (Math.abs(dx) > 4 || Math.abs(dz) > 4) continue;
      const d = Math.hypot(dx, dz);
      if (d < 3.8 && d > 1e-4) {
        const p = (3.8 - d) / 2; a.x += dx / d * p; a.z += dz / d * p; b.x -= dx / d * p; b.z -= dz / d * p;
        if (a.kind === 'racer' && b.kind === 'racer') { if (a.s < b.s) a.v *= .97; else b.v *= .97; }
      }
    }
  }
}

const WCELL = 40;
type WallHash = { segs: number[]; cells: Map<number, number[]> };
let extraWalls: Pt[][] | null = null;
let extraHash: WallHash = { segs: [], cells: new Map() };
let zoneHash: WallHash = { segs: [], cells: new Map() };
const ck = (i: number, j: number): number => i * 100003 + j;

function buildHash(walls: Pt[][]): WallHash {
  const segs: number[] = [], cells = new Map<number, number[]>();
  for (const w of walls) for (let k = 0; k + 1 < w.length; k++) {
    const id = segs.length / 4; segs.push(w[k][0], w[k][1], w[k + 1][0], w[k + 1][1]);
    const i0 = Math.floor(Math.min(w[k][0], w[k + 1][0]) / WCELL), i1 = Math.floor(Math.max(w[k][0], w[k + 1][0]) / WCELL);
    const j0 = Math.floor(Math.min(w[k][1], w[k + 1][1]) / WCELL), j1 = Math.floor(Math.max(w[k][1], w[k + 1][1]) / WCELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const key = ck(i, j); const l = cells.get(key); if (l) l.push(id); else cells.set(key, [id]); }
  }
  return { segs, cells };
}

export function setWallZone(walls: Pt[][]): void { zoneHash = buildHash(walls); }

export function collideWalls(V: Vehicle, walls?: Pt[][]): number {
  if (walls && walls !== extraWalls) { extraWalls = walls; extraHash = buildHash(walls); }
  const H = walls ? extraHash : zoneHash; let hit = 0;
  for (const off of [1.25, -1.25]) {
    const r = .98; let cx = V.x + Math.sin(V.h) * off, cz = V.z + Math.cos(V.h) * off;
    const i0 = Math.floor((cx - r) / WCELL), i1 = Math.floor((cx + r) / WCELL), j0 = Math.floor((cz - r) / WCELL), j1 = Math.floor((cz + r) / WCELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = H.cells.get(ck(i, j)); if (!l) continue;
      for (const id of l) {
        const ax = H.segs[id * 4], az = H.segs[id * 4 + 1], bx = H.segs[id * 4 + 2], bz = H.segs[id * 4 + 3];
        const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez;
        const t = L2 > 1e-12 ? clamp(((cx - ax) * ex + (cz - az) * ez) / L2, 0, 1) : 0;
        const qx = ax + ex * t, qz = az + ez * t, dx = cx - qx, dz = cz - qz, d = Math.hypot(dx, dz);
        if (d >= r) continue;
        let nx: number, nz: number;
        if (d > 1e-4) { nx = dx / d; nz = dz / d; } else { const L = Math.sqrt(L2) || 1; nx = -ez / L; nz = ex / L; }
        const pen = r - d;
        V.x += nx * pen; V.z += nz * pen; cx += nx * pen; cz += nz * pen;
        const vn = V.vx * nx + V.vz * nz;
        if (vn < 0) { V.vx -= 1.3 * vn * nx; V.vz -= 1.3 * vn * nz; V.vx *= .92; V.vz *= .92; V.w += off * (nx * Math.cos(V.h) - nz * Math.sin(V.h)) * (-vn) * .05; hit = Math.max(hit, -vn); }
      }
    }
  }
  if (hit > 0) syncBody(V);
  return hit;
}

export function collideCar(V: Vehicle, A: AI): number {
  if (A.parked) return 0;
  if (Math.abs(V.x - A.x) > 7 || Math.abs(V.z - A.z) > 7) return 0;
  let imp = 0; const fx = Math.sin(V.h), fz = Math.cos(V.h), ax = Math.sin(A.h), az = Math.cos(A.h);
  for (const po of [1.2, -1.2]) for (const co of [1.2, -1.2]) {
    const px = V.x + fx * po, pz = V.z + fz * po, cx = A.x + ax * co, cz = A.z + az * co;
    const dx = px - cx, dz = pz - cz, d = Math.hypot(dx, dz);
    if (d < 2.1 && d > 1e-4) {
      const nx = dx / d, nz = dz / d, pen = 2.1 - d;
      V.x += nx * pen * .6; V.z += nz * pen * .6; A.x -= nx * pen * .4; A.z -= nz * pen * .4;
      const rvn = (V.vx - ax * A.v) * nx + (V.vz - az * A.v) * nz;
      if (rvn < 0) { V.vx -= 1.4 * rvn * nx; V.vz -= 1.4 * rvn * nz; A.v *= .85; A.stun = Math.max(A.stun, 1.2); V.w += po * (nx * Math.cos(V.h) - nz * Math.sin(V.h)) * (-rvn) * .04; imp = Math.max(imp, -rvn); }
    }
  }
  if (imp > 0) syncBody(V);
  return imp;
}
