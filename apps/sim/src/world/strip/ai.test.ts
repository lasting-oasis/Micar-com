import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { makeAI, setWander, stepAI, separateAIs, setWallZone, collideWalls, collideCar } from './ai';
import { nearestRoadPoint, type Pt } from './routes';
import { pointOnRoad } from './roadGraph';
import { HUB } from './district';
import { setTrackDir, readTrackSync } from './districtNode';
import { zoneWalls } from './zone';
import { makeVehicle, carParams, resetVehicle } from '../physics';
import { ARCHETYPES, STOCK_CFG, TUNE_DEF } from '../data';

const car = () => makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF));
const roadDist = (x: number, z: number) => { const q = nearestRoadPoint(x, z, HUB.roads); return Math.hypot(q.x - x, q.z - z); };
const WALL: Pt[][] = [[[0, -50], [0, 50]]];
setTrackDir(path.resolve(process.cwd(), 'public/strip/tracks'));

describe('strip AI and collisions', () => {
  it("a wandering AI advances along the hub's loop road", () => {
    const A = makeAI({ vmax: 12, acc: 5, brk: 8, kind: 'traffic', lane: 3.2 }); setWander(A, pointOnRoad('loop', 0));
    const s0 = A.s; for (let i = 0; i < 60 * 5; i++) stepAI(A, 1 / 60, null, 1);
    expect(A.s).toBeGreaterThan(s0 + 20); expect(Math.abs(A.v)).toBeGreaterThan(5); expect(roadDist(A.x, A.z)).toBeLessThan(8);
  });
  it('a long wander keeps extending without stalling', () => {
    const A = makeAI({ vmax: 12, acc: 5, brk: 8, kind: 'traffic', lane: 3.2 }); setWander(A, pointOnRoad('loop', 0));
    let dist = 0, px = A.x, pz = A.z, maxD = 0, maxStep = 0, maxDs = 0;
    for (let i = 0; i < 60 * 120; i++) { const s0 = A.s; stepAI(A, 1 / 60, null, 1); const st = Math.hypot(A.x - px, A.z - pz); maxStep = Math.max(maxStep, st); maxDs = Math.max(maxDs, A.s - s0); dist += st; px = A.x; pz = A.z; maxD = Math.max(maxD, roadDist(A.x, A.z)); }
    expect(maxStep).toBeLessThan(2); expect(maxDs).toBeLessThanOrEqual(20);
    expect(A.s).toBeGreaterThan(0); expect(A.route!.len).toBeGreaterThanOrEqual(400); expect(maxD).toBeLessThan(8); expect(dist).toBeGreaterThan(500);
  });
  it('separateAIs pushes two overlapping cars apart', () => { const a = makeAI({ x: 0, z: 0 }), b = makeAI({ x: 1, z: 0 }); separateAIs([a, b]); expect(b.x - a.x).toBeGreaterThan(3.7); });
  it('collideWalls pushes a car out of a wall and bounces it', () => {
    const V = car(); resetVehicle(V, 0.5, 0, 0); V.vx = -10; V.vz = 0; V.u = 0;
    const hit = collideWalls(V, WALL); expect(hit).toBeGreaterThan(0); expect(V.x).toBeGreaterThan(.98 - 1e-6); expect(V.vx).toBeGreaterThan(0);
  });
  it('no hit on open tarmac', () => { const V = car(); resetVehicle(V, 20, 0, 0); V.vx = -10; expect(collideWalls(V, WALL)).toBe(0); });
  it('the circuit cells are fenced', () => {
    const track = readTrackSync('bathurst'), b = track.bounds, [ox, oz] = track.offset;
    const V = car(); resetVehicle(V, b.minX + ox + 0.5, (b.minZ + b.maxZ) / 2 + oz, 0); V.vx = -10; V.vz = 0;
    expect(collideWalls(V, zoneWalls({ kind: 'track', track }))).toBeGreaterThan(0);
  });
  it("Suzuka's crossing has no wall", () => {
    const track = readTrackSync('suzuka'), pts = track.centre.pts, [ox, oz] = track.offset, n = pts.length;
    let bi = 0, bj = 0, bd = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 16; j < n; j++) { const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]); if (n - (j - i) > 15 && d < bd) { bd = d; bi = i; bj = j; } }
    expect(bd).toBeLessThan(3); expect(bj - bi).toBeGreaterThan(15);
    const walls = zoneWalls({ kind: 'track', track });
    for (const sg of [1, -1]) {
      const V = car(); resetVehicle(V, pts[bi][0] + ox, pts[bi][1] + oz, 0); V.vx = 0.1 * sg; V.vz = 0.1 * sg;
      const x0 = V.x, z0 = V.z; expect(collideWalls(V, walls)).toBe(0); expect(V.x).toBe(x0); expect(V.z).toBe(z0);
    }
  });
  it('collideCar stuns the AI and bounces the player', () => { const V = car(); resetVehicle(V, 0, 0, 0); V.vz = 15; V.u = 15; const A = makeAI({ x: 0, z: 2.5, h: 0, v: 0 }); const imp = collideCar(V, A); expect(imp).toBeGreaterThan(0); expect(A.stun).toBeGreaterThan(0); expect(V.vz).toBeLessThan(15); });
  it("setWallZone then collideWalls without an argument uses the zone's walls", () => {
    setWallZone(WALL); const V = car(); resetVehicle(V, 0.5, 0, 0); V.vx = -10; expect(collideWalls(V)).toBeGreaterThan(0);
    setWallZone([]); const W = car(); resetVehicle(W, 0.5, 0, 0); W.vx = -10; expect(collideWalls(W)).toBe(0);
  });
});
