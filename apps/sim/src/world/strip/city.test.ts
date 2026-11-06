import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildCity } from './city';
import { EVENTS } from '../data';
import { CELL, SPAN } from './routes';
import { WORLD_PER_M } from '../units';

describe('the Strip city', () => {
  it('buildCity places one marker per event, at the first node, in world units', () => {
    const c = buildCity(7);
    expect(c.markers.length).toBe(EVENTS.length);
    expect(c.markers[0].x).toBe(EVENTS[0].nodes[0][0] * CELL * WORLD_PER_M);
    expect(c.scene.children.length).toBeGreaterThan(10);
    c.dispose();
  });

  it('is built at world scale and is the same city for the same seed', () => {
    const size = (s: THREE.Scene) => { const b = new THREE.Box3(); s.traverse(o => { if ((o as THREE.Mesh).isMesh && o.name === 'blds') b.expandByObject(o); }); return b; };
    const a = buildCity(7), b = buildCity(7);
    const ba = size(a.scene), bb = size(b.scene);
    // the border blocks reach one cell past the grid on each side: ~ (SPAN + 2 CELL) metres
    expect(ba.max.x - ba.min.x).toBeGreaterThan(SPAN * WORLD_PER_M);
    expect(ba.max.x).toBeCloseTo(bb.max.x, 6); expect(ba.max.y).toBeCloseTo(bb.max.y, 6);
    for (const m of a.markers) expect(m.ring.position.x).toBe(m.x);
    a.dispose(); b.dispose();
  });

  it('dispose frees every geometry and material it made', () => {
    const c = buildCity(3);
    const geos = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>();
    c.scene.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) geos.add(m.geometry); if (m.material) ([] as THREE.Material[]).concat(m.material).forEach(x => mats.add(x)); });
    let gd = 0, md = 0;
    geos.forEach(g => g.addEventListener('dispose', () => gd++)); mats.forEach(m => m.addEventListener('dispose', () => md++));
    c.dispose();
    expect(gd).toBe(geos.size); expect(md).toBe(mats.size);
  });
});

describe('the rental lot block', () => {
  // block (7,7) spans x,z ∈ [640, 710] m; count the vertices of the block-filling meshes that fall inside it
  const inside = (c: ReturnType<typeof buildCity>) => {
    const lo = 640 * WORLD_PER_M - .01, hi = 710 * WORLD_PER_M + .01; let n = 0;
    for (const name of ['blds', 'slabs', 'parks', 'trees', 'signs']) {
      const m = c.scene.getObjectByName(name) as THREE.Mesh | undefined; if (!m) continue;
      const p = m.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); if (x > lo && x < hi && z > lo && z < hi) n++; }
    }
    return n;
  };
  it('buildCity(seed, [[7,7]]) leaves the reserved block empty asphalt; buildCity(seed) fills it', () => {
    const full = buildCity(1), lot = buildCity(1, [[7, 7]]);
    expect(inside(full)).toBeGreaterThan(0);
    expect(inside(lot)).toBe(0);
    full.dispose(); lot.dispose();
  });
  it('reserving a block leaves the rest of the city as it was', () => {
    const full = buildCity(1), lot = buildCity(1, [[7, 7]]);
    const n = (c: ReturnType<typeof buildCity>) => (c.scene.getObjectByName('poles') as THREE.Mesh).geometry.attributes.position.count;
    expect(n(lot)).toBe(n(full));
    const b = (c: ReturnType<typeof buildCity>) => new THREE.Box3().setFromObject(c.scene.getObjectByName('blds')!);
    expect(b(lot).max.y).toBeCloseTo(b(full).max.y, 6);
    full.dispose(); lot.dispose();
  });
});
