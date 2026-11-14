import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CarFeelAdapter } from './carFeelAdapter';
import { carParams, makeVehicle } from '../world/physics';
import { ARCHETYPES, STOCK_CFG, TUNE_DEF } from '../world/data';

/** A car group as carModel builds it, as far as the adapter reads it: tilt, pivots (FL, FR, RL, RR) and wheels. */
const rig = () => {
  const g = new THREE.Group(), tilt = new THREE.Group();
  const pivots = [[-1.5, -2.9], [1.5, -2.9], [-1.5, 2.7], [1.5, 2.7]].map(([x, z]) => { const p = new THREE.Object3D(); p.position.set(x, .68, z); return p; });
  const wheels = pivots.map(p => { const w = new THREE.Object3D(); p.add(w); return w; });
  g.add(tilt); g.userData.car = { tilt, pivots, wheels };
  return { g, pivots };
};

describe('the driven car\'s feel', () => {
  it('a body swap (resetSmoke) moves the tyre smoke to the new rear wheels, keeping the smoke and its material', () => {
    const a = new CarFeelAdapter(), { g, pivots } = rig(), scene = new THREE.Scene(); scene.add(g);
    const V = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF));
    a.frame(g, V, 1 / 60, .68, 'town', scene, false);
    const smoke = g.children.find(o => o instanceof THREE.Points) as THREE.Points, mat = smoke.material as THREE.Material;
    let disposed = 0; mat.addEventListener('dispose', () => { disposed++; });
    const emitters = () => ((a as unknown as { smoke: { points: THREE.Vector3[] } }).smoke.points).map(p => [p.x, p.z]);
    expect(emitters()).toEqual([[-1.5, 2.7], [1.5, 2.7]]); // RL, RR (pivots 2 and 3)
    pivots[2].position.set(-1.74, .7, 2.6); pivots[3].position.set(1.74, .7, 2.6); // the model's wheels
    a.resetSmoke();
    expect(emitters()).toEqual([[-1.74, 2.6], [1.74, 2.6]]);
    a.frame(g, V, 1 / 60, .68, 'town', scene, false);
    expect(g.children.filter(o => o instanceof THREE.Points)).toEqual([smoke]); // not rebuilt
    expect(disposed).toBe(0);
    a.release(g); expect(disposed).toBe(1);
  });
  it('resetSmoke before any smoke exists does nothing', () => {
    expect(() => new CarFeelAdapter().resetSmoke()).not.toThrow();
  });
});
