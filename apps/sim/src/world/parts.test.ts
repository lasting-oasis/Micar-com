import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STOCK_CFG, STYLES } from './data';
import { anchorsFor, attachParts, disposeParts, replaceWheels, syncKitLod, TINT } from './parts';

describe('parts on the lofted bodies', () => {
  it('every body style has anchors inside its body', () => { for (const s of STYLES) { const a = anchorsFor(s); expect(a.noseZ).toBeLessThan(0); expect(a.tailZ).toBeGreaterThan(0); expect(a.roofY).toBeGreaterThan(a.hoodY); expect(a.hoodY).toBeGreaterThan(a.sillY); expect(a.scale).toBeGreaterThan(1.5); } });
  it('a full kit stays within 0.6 world units of the body box', () => { const car = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(3.7, 2.9, 9.6)); car.add(body); const r = attachParts(car, { ...STOCK_CFG, front: 3, rear: 2, skirts: 2, spoiler: 4, hood: 3, roof: 1, vinyl: 2, neon: '#22e5ff', hydraulics: 1 }, 'sedan', 3); const bb = new THREE.Box3().setFromObject(car); expect(bb.min.z).toBeGreaterThan(-4.8 - 0.6); expect(bb.max.z).toBeLessThan(4.8 + 0.6); expect(bb.max.y).toBeLessThan(2.9 + 1.2); expect(r.neonLight).not.toBeNull(); });
  it('replaceWheels puts four wheels at the axles', () => { const car = new THREE.Group(); const a = anchorsFor('truck'); const w = replaceWheels(car, STOCK_CFG, a, 0); expect(w.length).toBe(4); const zs = w.map(o => Math.round(o.parent!.position.z * 10) / 10); expect(zs.filter(z => z === Math.round(a.axles[0] * 10) / 10).length).toBe(2); });
  it('tint and finish reach a lofted car, and come back off on dispose', () => {
    const car = new THREE.Group();
    const bodyMat = new THREE.MeshPhysicalMaterial({ metalness: .5, roughness: .3, clearcoat: 0, clearcoatRoughness: 0 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.7, 2.9, 9.6), bodyMat);
    const glassMat = new THREE.MeshStandardMaterial({ transparent: true, opacity: .72 });
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), glassMat);
    const wheelMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 4);
    const halos = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3)).setAttribute('lampDir', new THREE.Float32BufferAttribute([], 1)));
    const pivots = [0, 1, 2, 3].map(() => new THREE.Object3D()), wheels = pivots.map(p => { const w = new THREE.Object3D(); p.add(w); return w; });
    car.add(body, glass, wheelMesh, halos);
    car.userData.car = { body, glass, wheelMesh, pivots, wheels, halos, far: false };
    const r = attachParts(car, { ...STOCK_CFG, tint: 3, finish: 'candy' }, 'sedan', 0);
    const g = glass.material as THREE.MeshStandardMaterial;
    expect(g).not.toBe(glassMat); expect(g.opacity).toBe(TINT[3]); expect(glassMat.opacity).toBe(.72);
    expect(bodyMat.metalness).toBe(.88); expect(bodyMat.roughness).toBe(.12); expect(bodyMat.clearcoat).toBe(1);
    car.userData.car.far = true; syncKitLod(car); expect(r.root.visible).toBe(false);
    disposeParts(r);
    expect(glass.material).toBe(glassMat); expect(glassMat.opacity).toBe(.72);
    expect(bodyMat.metalness).toBe(.5); expect(bodyMat.roughness).toBe(.3); expect(bodyMat.clearcoat).toBe(0); expect(bodyMat.clearcoatRoughness).toBe(0);
  });
});
