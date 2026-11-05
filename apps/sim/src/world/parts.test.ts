import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STOCK_CFG, STYLES } from './data';
import { anchorsFor, attachParts, replaceWheels } from './parts';

describe('parts on the lofted bodies', () => {
  it('every body style has anchors inside its body', () => { for (const s of STYLES) { const a = anchorsFor(s); expect(a.noseZ).toBeLessThan(0); expect(a.tailZ).toBeGreaterThan(0); expect(a.roofY).toBeGreaterThan(a.hoodY); expect(a.hoodY).toBeGreaterThan(a.sillY); expect(a.scale).toBeGreaterThan(1.5); } });
  it('a full kit stays within 0.6 world units of the body box', () => { const car = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(3.7, 2.9, 9.6)); car.add(body); const r = attachParts(car, { ...STOCK_CFG, front: 3, rear: 2, skirts: 2, spoiler: 4, hood: 3, roof: 1, vinyl: 2, neon: '#22e5ff', hydraulics: 1 }, 'sedan', 3); const bb = new THREE.Box3().setFromObject(car); expect(bb.min.z).toBeGreaterThan(-4.8 - 0.6); expect(bb.max.z).toBeLessThan(4.8 + 0.6); expect(bb.max.y).toBeLessThan(2.9 + 1.2); expect(r.neonLight).not.toBeNull(); });
  it('replaceWheels puts four wheels at the axles', () => { const car = new THREE.Group(); const a = anchorsFor('truck'); const w = replaceWheels(car, STOCK_CFG, a, 0); expect(w.length).toBe(4); const zs = w.map(o => Math.round(o.parent!.position.z * 10) / 10); expect(zs.filter(z => z === Math.round(a.axles[0] * 10) / 10).length).toBe(2); });
});
