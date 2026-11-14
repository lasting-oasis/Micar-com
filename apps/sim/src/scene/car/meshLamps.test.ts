import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { meshLamps } from './meshLamps';
import { HALO_HEAD, HALO_TAIL } from './carGeometry';
import { swatchUV } from './carAtlas';

const S = 2; // world units per metre
/** A stand-in body: a box `l` x `w` x `h` metres on y = 0, nose toward -Z, at world scale; `shear` slopes the nose back;
 *  `ridge` (metres) raises fine upright ridges, 6.5 cm apart, on both ends (so they stand out between the lens grid's points). */
const box = (l = 4.8, w = 1.9, h = 1.45, shear = 0, ridge = 0) => {
    const g = new THREE.BoxGeometry(w * S, h * S, l * S, ridge ? 128 : 8, 8, 8); g.translate(0, h * S / 2, 0);
    const p = g.getAttribute('position');
    if (shear) for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0) p.setZ(i, p.getZ(i) + shear * p.getY(i));
    if (ridge) for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i);
        if (Math.abs(Math.abs(z) - l * S / 2) < 1e-6) p.setZ(i, z + Math.sign(z) * ridge * S * (0.5 + 0.5 * Math.sin(2 * Math.PI * p.getX(i) / (0.065 * S))));
    }
    g.computeVertexNormals();
    return g;
};
const empty = () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([], 3)); g.setIndex([]); return g; };
/** How far each lens cell stands in front of `body` (world units), sampled over its two triangles as they are drawn: the
 *  body's first surface seen from in front of the nose (head lenses) or behind the tail (tail lenses). One list per cell. */
const clearances = (lamps: THREE.BufferGeometry, body: THREE.BufferGeometry) => {
    const mesh = new THREE.Mesh(body, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const p = lamps.getAttribute('position'), n = lamps.getAttribute('normal'), idx = lamps.getIndex()!, cells: number[][] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), q = new THREE.Vector3(), ray = new THREE.Raycaster();
    for (let t = 0; t < idx.count; t += 3) {
        a.fromBufferAttribute(p, idx.getX(t)); b.fromBufferAttribute(p, idx.getX(t + 1)); c.fromBufferAttribute(p, idx.getX(t + 2));
        const dir = n.getZ(idx.getX(t)), out = cells[Math.floor(t / 6)] ??= [];
        for (let i = 0; i <= 5; i++) for (let j = 0; i + j <= 5; j++) {
            q.copy(a).multiplyScalar(1 - (i + j) / 5).addScaledVector(b, i / 5).addScaledVector(c, j / 5);
            ray.set(new THREE.Vector3(q.x, q.y, dir * 100), new THREE.Vector3(0, 0, -dir));
            const hit = ray.intersectObject(mesh)[0];
            if (hit) out.push(dir * (q.z - hit.point.z));
        }
    }
    return cells;
};

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
    it('comes in two groups, head lenses then tail lenses, so the tail ones can take a material of their own (near and far)', () => {
        const far = box(4.74); far.translate(0, 0, -0.07 * S);
        const r = meshLamps(box(), empty(), 'sedan', 1.0 * S, { paint: far, dark: empty() });
        for (const g of [r.lamps!, r.farLamps!]) {
            const idx = g.getIndex()!, p = g.getAttribute('position');
            expect(g.groups.map(x => x.materialIndex)).toEqual([0, 1]);
            expect(g.groups[0].start).toBe(0); expect(g.groups[1].start).toBe(g.groups[0].count);
            expect(g.groups[0].count).toBeGreaterThan(0); expect(g.groups[0].count + g.groups[1].count).toBe(idx.count);
            for (let t = 0; t < idx.count; t++) expect(Math.sign(p.getZ(idx.getX(t)))).toBe(t < g.groups[0].count ? -1 : 1); // head at the nose
        }
        // a model with tail lamps only: an empty head group, then its tail lenses
        const g = box(), gr = g.groups[5], idx = Array.from(g.getIndex()!.array); // an open nose (BoxGeometry's group 5, -Z)
        g.setIndex(idx.filter((_, i) => i < gr.start || i >= gr.start + gr.count));
        const tailOnly = meshLamps(g, empty(), 'sedan', 1.0 * S);
        expect(tailOnly.head).toBeNull(); expect(tailOnly.tail).not.toBeNull();
        expect(tailOnly.lamps!.groups[0].count).toBe(0); expect(tailOnly.lamps!.groups[1].count).toBe(tailOnly.lamps!.getIndex()!.count);
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
    it('stands clear of the body everywhere, not only at its grid points: a lens is lifted over a ridge between them', () => {
        const ridged = box(4.8, 1.9, 1.45, 0, 0.05); // 5 cm ridges: taller than the lens stands out (3 cm)
        const r = meshLamps(ridged, empty(), 'sedan', 1.0 * S);
        expect(r.head).not.toBeNull(); expect(r.tail).not.toBeNull();
        const cells = clearances(r.lamps!, ridged), all = cells.flat();
        expect(cells.length).toBe(48); expect(all.length).toBeGreaterThan(1000); // 12 cells per lamp and side
        expect(Math.min(...all)).toBeGreaterThan(0.06 - 0.005); // nowhere sunk into the body: OUT in front of it, give or take
        // and no cell lifted further than it must: each still comes within OUT of the body somewhere (to the samples' spacing)
        for (const c of cells) expect(Math.min(...c)).toBeLessThan(0.06 + 0.05);
        // a flat end needs no lift: the lenses stay OUT in front of it
        const flat = clearances(fit.lamps!, box()).flat();
        expect(Math.min(...flat)).toBeCloseTo(0.06, 3); expect(Math.max(...flat)).toBeCloseTo(0.06, 3);
    });
    it("seats the far version's lenses on the far body, in front of it where it stands out and back where it lies in", () => {
        const near = box(), far = box(4.74); far.translate(0, 0, -0.07 * S); // the far nose 4 cm ahead of the near one, its tail 10 cm in
        const r = meshLamps(near, empty(), 'sedan', 1.0 * S, { paint: far, dark: empty() });
        const ends = (g: THREE.BufferGeometry) => {
            const p = g.getAttribute('position'), head: number[] = [], tail: number[] = [];
            for (let i = 0; i < p.count; i++) (p.getZ(i) < 0 ? head : tail).push(p.getZ(i));
            return { head, tail };
        };
        const nz = ends(r.lamps!), fz = ends(r.farLamps!);
        expect(fz.head.length).toBe(nz.head.length); expect(fz.tail.length).toBe(nz.tail.length);
        for (const z of nz.head) expect(z).toBeCloseTo(-2.4 * S - 0.06, 3); // the near lenses on the near body, as before
        for (const z of fz.head) expect(z).toBeCloseTo(-2.44 * S - 0.06, 3); // the far ones on the far body: not hidden in it
        for (const z of fz.tail) expect(z).toBeCloseTo(2.3 * S + 0.06, 3); // nor standing 10 cm off it
        expect(Array.from(r.farLamps!.getAttribute('uv').array)).toEqual(Array.from(r.lamps!.getAttribute('uv').array)); // the same lenses
        expect(Math.min(...clearances(r.farLamps!, far).flat())).toBeGreaterThan(0.06 - 0.005);
        // a far body with no surface where the lamps are (too low to reach them): no far lens is drawn, rather than one in the air
        const low = meshLamps(near, empty(), 'sedan', 1.0 * S, { paint: box(4.74, 1.9, 0.4), dark: empty() });
        expect(low.farLamps!.getIndex()!.count).toBe(0);
        // nor where the far nose is cut back (its corners bevelled 1 m): those cells are left out, the rest are seated
        const cut = box(4.74); cut.translate(0, 0, -0.07 * S);
        const cp = cut.getAttribute('position');
        for (let i = 0; i < cp.count; i++) if (cp.getZ(i) < 0 && Math.abs(cp.getX(i)) > 0.6 * S) cp.setZ(i, cp.getZ(i) + 1.0 * S);
        const bevel = meshLamps(near, empty(), 'sedan', 1.0 * S, { paint: cut, dark: empty() });
        const bp = bevel.farLamps!.getAttribute('position'), bi = bevel.farLamps!.getIndex()!;
        expect(bi.count).toBeGreaterThan(0); expect(bi.count).toBeLessThan(r.farLamps!.getIndex()!.count);
        for (let t = 0; t < bi.count; t++) if (bp.getZ(bi.getX(t)) < 0) expect(Math.abs(bp.getX(bi.getX(t)))).toBeLessThanOrEqual(0.6 * S + 1e-6);
        // no far body: no far lenses (the near ones serve)
        expect(meshLamps(near, empty(), 'sedan', 1.0 * S).farLamps).toBeNull();
        expect(meshLamps(near, empty(), 'sedan', 1.0 * S, { paint: empty(), dark: empty() }).farLamps).toBeNull();
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
