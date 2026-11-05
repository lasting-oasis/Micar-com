import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Driver, townCollider } from './driver';
import { ARCHETYPES, STOCK_CFG, TUNE_DEF } from './data';
import { NO_INPUT } from './physics';

describe('Driver', () => {
  it('clamps a slow frame to 6 sub-steps', () => { const d = new Driver(ARCHETYPES.sedan, { cfg: STOCK_CFG, tune: TUNE_DEF }, { x: 0, z: 0, h: 0 }); const r = d.stepFrame(0.5, { ...NO_INPUT, fwd: 1 }, { drift: false, fuel: () => 50, burn: () => {}, collide: () => 0 }); expect(r.steps).toBeLessThanOrEqual(6); });
  it('burns fuel at full throttle and coasts when empty', () => { const d = new Driver(ARCHETYPES.sedan, { cfg: STOCK_CFG, tune: TUNE_DEF }, { x: 0, z: 0, h: 0 }); let f = 100; for (let i = 0; i < 60 * 60; i++) d.stepFrame(1/60, { ...NO_INPUT, fwd: 1 }, { drift: false, fuel: () => f, burn: (b) => { f -= b; }, collide: () => 0 }); expect(f).toBeLessThan(100); expect(f).toBeGreaterThan(90); f = 0; const u0 = d.V.u; for (let i = 0; i < 60 * 5; i++) d.stepFrame(1/60, { ...NO_INPUT, fwd: 1 }, { drift: false, fuel: () => f, burn: () => {}, collide: () => 0 }); expect(d.V.u).toBeLessThan(u0); });
  it('a town box collider stops a 20 m/s car without launching it', () => { const col = townCollider([new THREE.Box3(new THREE.Vector3(-10, 0, 20), new THREE.Vector3(10, 10, 40))]); const d = new Driver(ARCHETYPES.sedan, { cfg: STOCK_CFG, tune: TUNE_DEF }, { x: 0, z: 0, h: 0 }); d.V.u = 20; d.V.vz = 20; for (let i = 0; i < 120; i++) d.stepFrame(1/60, NO_INPUT, { drift: false, fuel: () => 50, burn: () => {}, collide: col }); expect(Math.abs(d.V.u)).toBeLessThan(6); expect(d.V.z * 2).toBeLessThan(20.5); });
  it('pose converts to world units facing -Z', () => { const d = new Driver(ARCHETYPES.sedan, { cfg: STOCK_CFG, tune: TUNE_DEF }, { x: 3, z: 4, h: 0 }); expect(d.pose()).toEqual({ x: 6, y: 0, z: 8, rotY: Math.PI }); });

  // beyond the brief
  it('runs 120 Hz sub-steps and carries the remainder to the next frame', () => {
    const d = new Driver(ARCHETYPES.sedan, { cfg: STOCK_CFG, tune: TUNE_DEF }, { x: 0, z: 0, h: 0 });
    const o = { drift: false, fuel: () => 50, burn: () => {}, collide: () => 0 };
    let n = 0; for (let i = 0; i < 60; i++) n += d.stepFrame(1 / 60, NO_INPUT, o).steps;
    expect(n).toBeGreaterThanOrEqual(119); expect(n).toBeLessThanOrEqual(120);
  });
  it('passes a gear edge to one sub-step only', () => {
    const d = new Driver(ARCHETYPES.sedan, { cfg: STOCK_CFG, tune: TUNE_DEF }, { x: 0, z: 0, h: 0 });
    const seen: boolean[] = [];
    d.stepFrame(0.05, { ...NO_INPUT, manual: true, shiftUp: true }, { drift: false, fuel: () => 50, burn: () => {}, collide: () => 0, map: (I) => { seen.push(I.shiftUp); return I; } });
    expect(seen.filter(Boolean).length).toBe(1);
  });
  it('rebuild keeps the car where it is', () => {
    const d = new Driver(ARCHETYPES.sedan, { cfg: STOCK_CFG, tune: TUNE_DEF }, { x: 3, z: 4, h: 1 });
    const P0 = d.V.P; const perf = { ...STOCK_CFG.perf, engine: 3 as const };
    d.rebuild(ARCHETYPES.sedan, { cfg: { ...STOCK_CFG, perf }, tune: TUNE_DEF });
    expect(d.V.P).not.toBe(P0); expect(d.V.P.tqMul).toBeGreaterThan(P0.tqMul); expect([d.V.x, d.V.z, d.V.h]).toEqual([3, 4, 1]);
  });
  it('ignores empty and overhead boxes in the town', () => {
    const empty = new THREE.Box3(); const sign = new THREE.Box3(new THREE.Vector3(-10, 5, 0), new THREE.Vector3(10, 8, 40));
    const col = townCollider([empty, sign]);
    const d = new Driver(ARCHETYPES.sedan, { cfg: STOCK_CFG, tune: TUNE_DEF }, { x: 0, z: 5, h: 0 });
    expect(col(d.V)).toBe(0);
  });
});
