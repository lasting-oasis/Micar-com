import { describe, it, expect } from 'vitest';
import { makeAI, setWander, stepAI, separateAIs, collideBlocks, collideCar } from './ai';
import { blockRect } from './routes';
import { makeVehicle, carParams, resetVehicle } from '../physics';
import { ARCHETYPES, STOCK_CFG, TUNE_DEF } from '../data';

describe('strip AI and collisions', () => {
  it('a wandering AI advances along its route', () => { const A = makeAI({ vmax: 12, acc: 5, brk: 8, kind: 'traffic', lane: 3.2 }); setWander(A, [2,2]); const s0 = A.s; for (let i = 0; i < 60 * 5; i++) stepAI(A, 1/60, null, 1); expect(A.s).toBeGreaterThan(s0 + 20); expect(Math.abs(A.v)).toBeGreaterThan(5); });
  it('separateAIs pushes two overlapping cars apart', () => { const a = makeAI({ x: 0, z: 0 }), b = makeAI({ x: 1, z: 0 }); separateAIs([a, b]); expect(b.x - a.x).toBeGreaterThan(3.7); });
  it('collideBlocks pushes a car out of a building and slows it', () => { const V = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF)); resetVehicle(V, 45, 8.5, 0); V.vx = 0; V.vz = 10; V.u = 10; const hit = collideBlocks(V); expect(hit).toBeGreaterThan(0); expect(blockRect(0,0)).not.toBeNull(); const R = blockRect(0,0)!; expect(V.x < R[0] || V.x > R[2] || V.z < R[1] || V.z > R[3]).toBe(true); });
  it('collideCar stuns the AI and bounces the player', () => { const V = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF)); resetVehicle(V, 0, 0, 0); V.vz = 15; V.u = 15; const A = makeAI({ x: 0, z: 2.5, h: 0, v: 0 }); const imp = collideCar(V, A); expect(imp).toBeGreaterThan(0); expect(A.stun).toBeGreaterThan(0); expect(V.vz).toBeLessThan(15); });
});
