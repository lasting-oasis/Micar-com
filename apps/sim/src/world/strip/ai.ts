// AI drivers and collisions (pure, mesh-free, metres). Ported from Night Tuner 05-world.js.
// The mesh `m` and `tag` are opaque handles owned by the renderer; visibility toggling lives there.
import { clamp, syncBody, type Vehicle } from '../physics';
import { CELL, blockRect, buildRoute, nodeNeighbors, routePoint, routeProgress, type Node, type Route } from './routes';

export type AI = {
  x: number; z: number; h: number; v: number; s: number; lane: number;
  route: Route | null; path: Node[] | null;
  vmax: number; acc: number; brk: number; stun: number; nm: number; laps: number; done: boolean; ft: number | null;
  kind: 'traffic' | 'rival' | 'racer'; name: string; wander: boolean; score: number; hold: boolean; parked: boolean; steer: number; cool: number;
  m?: unknown; tag?: unknown;
};

export function makeAI(opts: Partial<AI> = {}): AI {
  return Object.assign({ x: 0, z: 0, h: 0, v: 0, s: 0, lane: 3.2, route: null, path: null, vmax: 13, acc: 5, brk: 8, stun: 0, nm: 0, laps: 0, done: false, ft: null, kind: 'traffic' as const, name: '', wander: false, score: 0, hold: false, parked: false, steer: 0, cool: 0 }, opts) as AI;
}

export function wanderPath(path: Node[], len: number): Node[] {
  while (path.length < len) {
    const A = path[path.length - 1], Pv = path[path.length - 2];
    let opts = nodeNeighbors(A[0], A[1]).filter(n => !Pv || n[0] !== Pv[0] || n[1] !== Pv[1]);
    if (!opts.length) opts = nodeNeighbors(A[0], A[1]);
    let pick: Node | null = null;
    if (Pv && Math.random() < .6) { const st = [A[0] + (A[0] - Pv[0]), A[1] + (A[1] - Pv[1])]; pick = opts.find(n => n[0] === st[0] && n[1] === st[1]) || null; }
    if (!pick) pick = opts[Math.floor(Math.random() * opts.length)];
    path.push(pick);
  }
  return path;
}

export function setWander(A: AI, start: Node): void {
  A.path = wanderPath([start], 5); A.route = buildRoute(A.path, false); A.s = 0; A.wander = true; A.done = false; A.parked = false;
  const p = routePoint(A.route, 0); A.x = p.x - p.tz * A.lane; A.z = p.z + p.tx * A.lane; A.h = Math.atan2(p.tx, p.tz); A.v = 0;
}

export function parkAI(A: AI): void { A.parked = true; A.x = -1e4; A.z = -1e4; }

export function stepAI(A: AI, dt: number, playerS: number | null, _stage: number): void {
  if (A.hold || A.done || A.parked || !A.route) return;
  if (A.wander && A.path && A.s > A.route.len - CELL * 1.5) { A.path = wanderPath(A.path.slice(-3), 7); A.route = buildRoute(A.path, false); A.s = routeProgress(A.route, A.x, A.z, CELL * 1.5, CELL * 2).s; }
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

export function collideBlocks(V: Vehicle): number {
  let hit = 0;
  for (const off of [1.25, -1.25]) {
    const r = .98; let cx = V.x + Math.sin(V.h) * off, cz = V.z + Math.cos(V.h) * off;
    const bi = Math.floor(cx / CELL), bj = Math.floor(cz / CELL);
    for (let i = bi - 1; i <= bi + 1; i++) for (let j = bj - 1; j <= bj + 1; j++) {
      const R = blockRect(i, j); if (!R) continue;
      const qx = Math.max(R[0], Math.min(cx, R[2])), qz = Math.max(R[1], Math.min(cz, R[3]));
      const dx = cx - qx, dz = cz - qz, d = Math.hypot(dx, dz);
      if (d < r) {
        let nx: number, nz: number, pen: number;
        if (d > 1e-4) { nx = dx / d; nz = dz / d; pen = r - d; }
        else { const o = [cx - R[0], R[2] - cx, cz - R[1], R[3] - cz], m = Math.min(...o), ix = o.indexOf(m); nx = ix === 0 ? -1 : ix === 1 ? 1 : 0; nz = ix === 2 ? -1 : ix === 3 ? 1 : 0; pen = m + r; }
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
