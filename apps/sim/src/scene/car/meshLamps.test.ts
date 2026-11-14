import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { meshLamps } from './meshLamps';
import { HALO_HEAD, HALO_TAIL } from './carGeometry';
import { swatchUV } from './carAtlas';

const S = 2; // world units per metre
/** A stand-in body: a box `l` x `w` x `h` metres on y = 0, nose toward -Z, at world scale; `shear` slopes the nose back. */
const box = (l = 4.8, w = 1.9, h = 1.45, shear = 0) => {
    const g = new THREE.BoxGeometry(w * S, h * S, l * S, 8, 8, 8); g.translate(0, h * S / 2, 0);
    if (shear) { const p = g.getAttribute('position'); for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0) p.setZ(i, p.getZ(i) + shear * p.getY(i)); }
    g.computeVertexNormals();
    return g;
};
const empty = () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([], 3)); g.setIndex([]); return g; };

describe('lamps fitted to a model from its own shape', () => {
    const fit = meshLamps(box(), empty(), 'sedan', 1.0 * S);
    it('puts a head lamp and a tail lamp on each side, on the nose and the tail, below the belt', () => {
        expect(fit.head).not.toBeNull(); expect(fit.tail).not.toBeNull();
        expect(fit.head!.y).toBeLessThan(1.0 * S); expect(fit.tail!.y).toBeLessThan(1.0 * S);
        expect(fit.head!.x).toBeGreaterThan(0); expect(fit.head!.x).toBeLessThan(0.95 * S);
    });
    it('draws the lenses just proud of the body: head lamps at the nose facing forward, tail lamps at the tail facing back', () => {
        const g = fit.lamps!, p = g.getAttribute('position'), n = g.getAttribute('normal');
        expect(g.getIndex()!.count).toBeGreaterThan(0);
        let front = 0, back = 0;
        for (let i = 0; i < p.count; i++) {
            const z = p.getZ(i);
            if (z < 0) { front++; expect(z).toBeLessThan(-2.4 * S); expect(z).toBeGreaterThan(-2.4 * S - 0.1); expect(n.getZ(i)).toBeCloseTo(-1); }
            else { back++; expect(z).toBeGreaterThan(2.4 * S); expect(z).toBeLessThan(2.4 * S + 0.1); expect(n.getZ(i)).toBeCloseTo(1); }
        }
        expect(front).toBeGreaterThan(0); expect(back).toBeGreaterThan(0);
        // every triangle faces out of its end (both sides, the mirrored one too)
        const idx = g.getIndex()!, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        for (let t = 0; t < idx.count; t += 3) {
            a.fromBufferAttribute(p, idx.getX(t)); b.fromBufferAttribute(p, idx.getX(t + 1)); c.fromBufferAttribute(p, idx.getX(t + 2));
            const nz = b.clone().sub(a).cross(c.clone().sub(a)).z;
            expect(Math.sign(nz)).toBe(Math.sign(a.z));
        }
    });
    it('paints them with the lamp swatches the lofted cars use (head lamp, tail lamp and a reverse lamp)', () => {
        const uv = fit.lamps!.getAttribute('uv'), seen = new Set<string>();
        for (let i = 0; i < uv.count; i++) seen.add(uv.getX(i).toFixed(4) + ',' + uv.getY(i).toFixed(4));
        for (const sw of ['lampHead', 'lampTail', 'lampRev'] as const) expect(seen).toContain(swatchUV(sw).map(v => v.toFixed(4)).join(','));
    });
    it('glows at night where the lamps are: one point per lamp and side, head white facing forward, tail red facing back', () => {
        const h = fit.halos, p = h.getAttribute('position'), col = h.getAttribute('color'), dir = h.getAttribute('lampDir');
        expect(p.count).toBe(4);
        for (let i = 0; i < 4; i++) {
            const head = dir.getX(i) < 0;
            expect([col.getX(i), col.getY(i), col.getZ(i)]).toEqual((head ? HALO_HEAD : HALO_TAIL).map(v => expect.closeTo(v, 5)));
            expect(Math.sign(p.getZ(i))).toBe(head ? -1 : 1);
            expect(Math.abs(p.getZ(i))).toBeGreaterThan(2.4 * S);
        }
        expect(new Set([0, 1, 2, 3].map(i => Math.sign(p.getX(i)))).size).toBe(2); // both sides
    });
    it('follows a sloped nose: the head lenses sit on it, not in the air in front of it', () => {
        const sloped = meshLamps(box(4.8, 1.9, 1.45, 0.3), empty(), 'sedan', 1.0 * S);
        expect(sloped.head).not.toBeNull(); // (the head lamp did fit: the checks below are not vacuous)
        const p = sloped.lamps!.getAttribute('position');
        let front = 0;
        for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0) { front++; expect(p.getZ(i)).toBeCloseTo(-2.4 * S + 0.3 * p.getY(i) - 0.06, 1); }
        expect(front).toBeGreaterThan(0);
    });
    it('a body with no surface where a tail lamp goes gets head lamps only, and never throws', () => {
        // an open tail: the box without its back face (BoxGeometry's group 4, +Z); its sides and top are edge-on from behind
        const g = box(), gr = g.groups[4], idx = Array.from(g.getIndex()!.array);
        g.setIndex(idx.filter((_, i) => i < gr.start || i >= gr.start + gr.count));
        const r = meshLamps(g, empty(), 'sedan', 1.0 * S);
        expect(r.head).not.toBeNull(); expect(r.tail).toBeNull();
        expect(r.halos.getAttribute('position').count).toBe(2);
        expect(() => meshLamps(empty(), empty(), 'nonsense', 2)).not.toThrow();
        // a style the table does not know fits as a sedan (on a real body, not only on an empty one)
        const odd = meshLamps(box(), empty(), 'nonsense', 1.0 * S), sedan = meshLamps(box(), empty(), 'sedan', 1.0 * S);
        expect(odd.head).not.toBeNull(); expect(odd.head).toEqual(sedan.head); expect(odd.tail).toEqual(sedan.tail);
        expect(meshLamps(empty(), empty(), 'nonsense', 2).lamps).toBeNull();
    });
    it('fits a body whose ends have no vertex near the middle (a plain box: corners only)', () => {
        const plain = new THREE.BoxGeometry(1.9 * S, 1.45 * S, 4.8 * S); plain.translate(0, 1.45 * S / 2, 0);
        const r = meshLamps(plain, empty(), 'sedan', 1.0 * S);
        expect(r.head).not.toBeNull(); expect(r.tail).not.toBeNull(); expect(r.halos.getAttribute('position').count).toBe(4);
    });
    it('is quick: a 24k-triangle body fits in well under a frame', () => {
        const big = box(4.8, 1.9, 1.45); // 8 segments a side; the models have ~24k triangles: use a denser box
        const dense = new THREE.BoxGeometry(1.9 * S, 1.45 * S, 4.8 * S, 40, 40, 40); dense.translate(0, 1.45 * S / 2, 0);
        meshLamps(dense, big, 'suv', 1.1 * S); // (the first call also compiles the code: ~20 ms in node)
        let ms = Infinity; // the fastest of five (other test files run alongside and share the CPU)
        for (let k = 0; k < 5; k++) { const t = performance.now(); meshLamps(dense, big, 'suv', 1.1 * S); ms = Math.min(ms, performance.now() - t); }
        expect(dense.getIndex()!.count / 3).toBeGreaterThan(19000);
        expect(ms).toBeLessThan(40); // ~3-5 ms in node; generous for a slow CI runner
    });
});
