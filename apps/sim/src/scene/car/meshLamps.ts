import * as THREE from 'three';
import { HALO_HEAD, HALO_TAIL, type V3 } from './carGeometry';
import { swatchUV, type Swatch } from './carAtlas';
import { WORLD_PER_M } from '../../world/units';

// Head and tail lamps for a car drawn from its own 3D model. The models carry no lamp data, so the lamps are fitted to
// the model's shape when it loads: a rectangle per lamp, placed as the lofted body of the car's style places it (as a
// share of the nose's or tail's half-width, below the belt), then lowered or pulled in until the whole rectangle lies on
// the surface of the nose or tail. The lens is drawn just proud of that surface with the lofted cars' own lamp swatches,
// so it lights with their trim materials (on, brake, reverse) and needs no shader of its own; the night glow sits a
// little in front of each lens.

const S = WORLD_PER_M;
/** Per style, from the lofted bodies: head lamp inner and outer edge (share of the nose's half-width) and half-height
 *  (metres), then the same for the tail lamp. */
const LAMP: Record<string, [number, number, number, number, number, number]> = {
    sedan: [.28, .86, .055, .30, .86, .09], coupe: [.29, .86, .06, .33, .86, .07], sports: [.49, .86, .05, .28, .86, .08],
    hatchback: [.25, .86, .055, .63, .86, .125], suv: [.42, .86, .065, .48, .86, .075], van: [.28, .86, .07, .72, .86, .15],
    truck: [.6, .86, .115, .8, .86, .22],
};
const COLS = 6, ROWS = 2; // the lens grid: 7 x 3 points a side
const OUT = 0.06;         // the lens stands this far (world units) in front of the surface
const REV = 1;            // the tail lamp's inner column (of 6) is the reverse lamp

export type LampRect = { x: number; y: number; x0: number; x1: number; y0: number; y1: number; z: number[] };
export type MeshLamps = { head: LampRect | null; tail: LampRect | null; lamps: THREE.BufferGeometry | null; halos: THREE.BufferGeometry };

/** Fit the lamps of a model from its `paint` and `dark` geometry (car space, world units, nose toward -Z), its style and
 *  belt height (world units). A lamp that cannot be fitted is left out; this never throws. */
export function meshLamps(paint: THREE.BufferGeometry, dark: THREE.BufferGeometry, style: string, belt: number): MeshLamps {
    const none = (): MeshLamps => ({ head: null, tail: null, lamps: null, halos: halos([]) });
    const P = paint.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!P || P.count < 3) return none();
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < P.count; i++) { const z = P.getZ(i); if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
    const L = maxZ - minZ;
    if (!(L > 0)) return none();

    // the ends' half-width (paint within 12% of the length; the mirrors are further back) and top (within 5%, near the middle)
    const end = (dir: number) => {
        const at = (z: number, f: number) => dir < 0 ? z < minZ + f * L : z > maxZ - f * L;
        let hw = 0, top = 0, topAll = 0;
        for (let i = 0; i < P.count; i++) if (at(P.getZ(i), .12)) hw = Math.max(hw, Math.abs(P.getX(i)));
        for (let i = 0; i < P.count; i++) if (at(P.getZ(i), .05)) {
            topAll = Math.max(topAll, P.getY(i));
            if (Math.abs(P.getX(i)) < .5 * hw + .3 * S) top = Math.max(top, P.getY(i));
        }
        return { hw, top: top || topAll }; // (an end with no vertex near the middle, e.g. a plain box: its top anywhere)
    };

    // the end surfaces: the triangles near each end, bucketed on an x/y grid so a lookup tests only a few
    const CELL = .1 * S, slab = Math.max(.2 * L, .7 * S);
    const surface = (dir: number) => {
        const tris: number[] = [], grid = new Map<number, number[]>();
        const key = (ix: number, iy: number) => ix * 4096 + iy;
        for (const g of [paint, dark]) {
            const p = g.getAttribute('position') as THREE.BufferAttribute | undefined, idx = g.getIndex();
            if (!p) continue;
            const n = idx ? idx.count : p.count, v = (k: number) => idx ? idx.getX(k) : k;
            for (let t = 0; t + 2 < n; t += 3) {
                const a = v(t), b = v(t + 1), c = v(t + 2);
                const za = p.getZ(a), zb = p.getZ(b), zc = p.getZ(c);
                if (dir < 0 ? Math.min(za, zb, zc) > minZ + slab : Math.max(za, zb, zc) < maxZ - slab) continue;
                const o = tris.length / 9;
                tris.push(p.getX(a), p.getY(a), za, p.getX(b), p.getY(b), zb, p.getX(c), p.getY(c), zc);
                const x0 = Math.floor(Math.min(p.getX(a), p.getX(b), p.getX(c)) / CELL), x1 = Math.floor(Math.max(p.getX(a), p.getX(b), p.getX(c)) / CELL);
                const y0 = Math.floor(Math.min(p.getY(a), p.getY(b), p.getY(c)) / CELL), y1 = Math.floor(Math.max(p.getY(a), p.getY(b), p.getY(c)) / CELL);
                for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
                    const k = key(ix + 2048, iy + 2048); let list = grid.get(k); if (!list) grid.set(k, list = []); list.push(o);
                }
            }
        }
        /** The surface's z at (x, y): the nose's front-most (dir -1) or the tail's back-most (+1); NaN where none. */
        return (x: number, y: number) => {
            const list = grid.get(key(Math.floor(x / CELL) + 2048, Math.floor(y / CELL) + 2048));
            let best = NaN;
            if (list) for (const o of list) {
                const q = o * 9, ax = tris[q], ay = tris[q + 1], bx = tris[q + 3], by = tris[q + 4], cx = tris[q + 6], cy = tris[q + 7];
                const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
                if (Math.abs(d) < 1e-12) continue;
                const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, l3 = 1 - l1 - l2;
                if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
                const z = l1 * tris[q + 2] + l2 * tris[q + 5] + l3 * tris[q + 8];
                if (Number.isNaN(best) || (dir < 0 ? z < best : z > best)) best = z;
            }
            return best;
        };
    };

    const spec = LAMP[style] ?? LAMP.sedan;
    /** A lamp rectangle that lies on the surface (every grid point hit, none deeper than `cap`), lowered then pulled in until it does. */
    const fit = (dir: number, hw: number, x0f: number, x1f: number, top: number, hh: number, cap: number): LampRect | null => {
        if (!(hw > 0)) return null;
        const zAt = surface(dir), endZ = dir < 0 ? minZ : maxZ;
        for (let pull = 0; pull < 5; pull++) for (let drop = 0; drop < 10; drop++) {
            const x1 = (x1f - pull * .05) * hw, x0 = Math.min(x0f * hw, x1 - .12 * S), y1 = top - drop * .03 * S, y0 = y1 - 2 * hh;
            if (y0 <= 0 || x0 <= 0) continue;
            const z: number[] = [];
            let ok = true;
            for (const sd of [1, -1]) for (let k = 0; k <= ROWS && ok; k++) for (let i = 0; i <= COLS && ok; i++) {
                const zz = zAt(sd * (x0 + (x1 - x0) * i / COLS), y0 + (y1 - y0) * k / ROWS);
                if (Number.isNaN(zz) || Math.abs(zz - endZ) > cap) ok = false; else z.push(zz);
            }
            if (ok) return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, x0, x1, y0, y1, z };
        }
        return null;
    };
    const f = end(-1), r = end(1);
    const head = fit(-1, f.hw, spec[0], spec[1], Math.min(f.top - .08 * S, belt - .1 * S), spec[2] * S, .6 * S);
    const tail = fit(1, r.hw, spec[3], spec[4], Math.min(r.top, belt) - .04 * S, spec[5] * S, .45 * S);
    if (!head && !tail) return none();

    // the lenses: one quad per grid cell (so the reverse lamp's columns are a swatch of their own), facing out of their end
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], index: number[] = [];
    const lens = (r: LampRect, dir: number) => {
        let n = 0;
        for (const sd of [1, -1]) {
            const zAt = (i: number, k: number) => r.z[n + k * (COLS + 1) + i] + dir * OUT;
            for (let k = 0; k < ROWS; k++) for (let i = 0; i < COLS; i++) {
                const sw: Swatch = dir < 0 ? 'lampHead' : i < REV ? 'lampRev' : 'lampTail', [u, v] = swatchUV(sw);
                const b = pos.length / 3;
                for (const [di, dk] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
                    pos.push(sd * (r.x0 + (r.x1 - r.x0) * (i + di) / COLS), r.y0 + (r.y1 - r.y0) * (k + dk) / ROWS, zAt(i + di, k + dk));
                    nor.push(0, 0, dir); uv.push(u, v);
                }
                // counter-clockwise seen from outside: x grows with i on the right side (sd 1), shrinks on the left
                if (sd * dir > 0) index.push(b, b + 1, b + 2, b, b + 2, b + 3); else index.push(b, b + 2, b + 1, b, b + 3, b + 2);
            }
            n += (ROWS + 1) * (COLS + 1);
        }
    };
    if (head) lens(head, -1);
    if (tail) lens(tail, 1);
    const lamps = new THREE.BufferGeometry();
    lamps.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    lamps.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    lamps.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    lamps.setIndex(index);
    lamps.computeBoundingBox(); lamps.computeBoundingSphere();

    // the night glow: a point a little in front of each lens's middle
    const glow: [V3, V3, number][] = [];
    const mid = (r: LampRect) => r.z[ROWS / 2 * (COLS + 1) + COLS / 2];
    for (const [r, dir] of [[head, -1], [tail, 1]] as const) if (r) for (const sd of [1, -1]) glow.push([[sd * r.x, r.y, mid(r) + dir * .12], dir < 0 ? HALO_HEAD : HALO_TAIL, dir]);
    return { head, tail, lamps, halos: halos(glow) };
}

/** The night-glow points (position, colour, the way each lamp faces) in the form the lofted bodies' halos have. */
function halos(points: [V3, V3, number][]): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap(p => p[0]), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(points.flatMap(p => p[1]), 3));
    g.setAttribute('lampDir', new THREE.Float32BufferAttribute(points.map(p => p[2]), 1));
    g.computeBoundingSphere();
    return g;
}
