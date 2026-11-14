import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TireSmoke } from './tireSmoke';

describe('tyre smoke', () => {
  it('moves to new contact points (another body) without dropping its material or the smoke in the air', () => {
    const car = new THREE.Group(), s = new TireSmoke(car, [new THREE.Vector3(1.5, 0, 2.7), new THREE.Vector3(-1.5, 0, 2.7)]);
    const pts = car.children[0] as THREE.Points, mat = pts.material as THREE.Material;
    let disposed = 0; mat.addEventListener('dispose', () => { disposed++; });
    s.update(.2, 1); // a burnout: smoke at the old wheels
    const pos = pts.geometry.getAttribute('position'), before = Array.from(pos.array as Float32Array);
    s.moveTo([new THREE.Vector3(1.74, 0, 2.6), new THREE.Vector3(-1.74, 0, 2.6)]);
    expect(disposed).toBe(0); expect(car.children[0]).toBe(pts);
    expect(Array.from(pos.array as Float32Array)).toEqual(before); // the puffs already out stay where they are
    for (let k = 0; k < 20; k++) s.update(.05, 1); // new puffs come from the new wheels
    let nearNew = 0;
    for (let i = 0; i < pos.count; i++) if (Math.abs(Math.abs(pos.getX(i)) - 1.74) < .25 && pos.getY(i) < .5) nearNew++;
    expect(nearNew).toBeGreaterThan(0);
    s.dispose(); expect(disposed).toBe(1);
  });
});
