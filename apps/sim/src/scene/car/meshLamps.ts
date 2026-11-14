import * as THREE from 'three';
import { HALO_HEAD, HALO_TAIL, type V3 } from './carGeometry';
import { swatchUV, type Swatch } from './carAtlas';
import { WORLD_PER_M } from '../../world/units';

// Head and tail lamps for a car drawn from its own 3D model. The models carry no lamp data, so the lamps are fitted to
// the model's shape when it loads: a rectangle per lamp, placed as the lofted body of the car's style places it (as a
// share of the nose's or tail's half-width, below the belt), then lowered or pulled in until the whole rectangle lies on
// the surface of the nose or tail. The lens is drawn just proud of that surface with the lofted cars' own lamp swatches,
// so it lights with their trim materials (on, brake, reverse) and needs no shader of its own; each lens cell is lifted
// where the body stands out between the grid's points, so no part of it sinks into the body. The far version gets the
// same lenses seated on its own, simpler body. The night glow sits a little in front of each lens.

const S = WORLD_PER_M;
/** Per style, from the lofted bodies: head lamp inner and outer edge (share of the nose's half-width) and half-height
 *  (metres), then the same for the tail lamp. */
const LAMP: Record<string, [number, number, number, number, number, number]> = {
    sedan: [.28, .86, .055, .30, .86, .09], coupe: [.29, .86, .06, .33, .86, .07], sports: [.49, .86, .05, .28, .86, .08],
    hatchback: [.25, .86, .055, .63, .86, .125], suv: [.42, .86, .065, .48, .86, .075], van: [.28, .86, .07, .72, .86, .15],
    truck: [.6, .86, .115, .8, .86, .22],
};
const COLS = 6, ROWS = 2;   // the lens grid: 7 x 3 points a side
const OUT = 0.06;           // the lens stands this far (world units) in front of the surface
const REV = 1;              // the tail lamp's inner column (of 6) is the reverse lamp
const MAX_LIFT = 0.05 * S;  // a cell is lifted at most this far over what stands out in front of it (a bumper lip may)
/** A lens cell's corners (u along x, v along y), in the order its quad is drawn; its edges and the fold between its triangles. */
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]] as const;
const EDGES = [[CORNERS[0], CORNERS[1]], [CORNERS[1], CORNERS[2]], [CORNERS[2], CORNERS[3]], [CORNERS[3], CORNERS[0]], [CORNERS[0], CORNERS[2]]] as const;

export type LampRect = { x: number; y: number; x0: number; x1: number; y0: number; y1: number; z: number[] };
export type MeshLamps = {
    head: LampRect | null; tail: LampRect | null;
    lamps: THREE.BufferGeometry | null;    // the lenses on the body they were fitted to
    farLamps: THREE.BufferGeometry | null; // the same lenses seated on the far body (null: no far body given, or it is empty)
    halos: THREE.BufferGeometry;
};

/** The surface of one end of a body: its z at (x, y) (the nose's front-most or the tail's back-most; NaN where none); the
 *  body's vertices near that end inside an x/y box; and the points where its triangles' edges cross an x/y segment. */
type EndSurface = {
    z: (x: number, y: number) => number;
    vertices: (x0: number, x1: number, y0: number, y1: number, f: (x: number, y: number, z: number) => void) => void;
    crossings: (ax: number, ay: number, bx: number, by: number, f: (x: number, y: number, z: number) => void) => void;
};
type Body = { minZ: number; maxZ: number; end: (dir: number) => EndSurface };

/** A body's paint and dark parts as a surface, or null when it has no paint. Its ends are built when first asked for:
 *  the triangles near the end, bucketed on an x/y grid so a lookup tests only a few. */
function bodyOf(paint: THREE.BufferGeometry, dark: THREE.BufferGeometry): Body | null {
    const P = paint.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!P || P.count < 3) return null;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < P.count; i++) { const z = P.getZ(i); if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
    const L = maxZ - minZ;
    if (!(L > 0)) return null;
    const CELL = .1 * S, slab = Math.max(.2 * L, .7 * S);
    const key = (ix: number, iy: number) => (ix + 2048) * 4096 + iy + 2048;
    const build = (dir: number): EndSurface => {
        const tris: number[] = [], grid = new Map<number, number[]>();
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
                    const k = key(ix, iy); let list = grid.get(k); if (!list) grid.set(k, list = []); list.push(o);
                }
            }
        }
        /** Each triangle in the buckets an x/y box touches, once. */
        const near = (x0: number, x1: number, y0: number, y1: number, f: (o: number) => void) => {
            const seen = new Set<number>();
            for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) for (let iy = Math.floor(y0 / CELL); iy <= Math.floor(y1 / CELL); iy++) {
                const list = grid.get(key(ix, iy));
                if (list) for (const o of list) if (!seen.has(o)) { seen.add(o); f(o); }
            }
        };
        return {
            z: (x, y) => {
                const list = grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL)));
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
            },
            vertices: (x0, x1, y0, y1, f) => near(x0, x1, y0, y1, o => {
                for (let q = o * 9; q < o * 9 + 9; q += 3) {
                    const x = tris[q], y = tris[q + 1];
                    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) f(x, y, tris[q + 2]);
                }
            }),
            crossings: (ax, ay, bx, by, f) => near(Math.min(ax, bx), Math.max(ax, bx), Math.min(ay, by), Math.max(ay, by), o => {
                const rx = bx - ax, ry = by - ay;
                for (let e = 0; e < 3; e++) {
                    const p = o * 9 + e * 3, q = o * 9 + (e + 1) % 3 * 3;
                    const sx = tris[q] - tris[p], sy = tris[q + 1] - tris[p + 1], den = rx * sy - ry * sx;
                    if (Math.abs(den) < 1e-12) continue;
                    const t = ((tris[p] - ax) * sy - (tris[p + 1] - ay) * sx) / den, u = ((tris[p] - ax) * ry - (tris[p + 1] - ay) * rx) / den;
                    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) f(ax + t * rx, ay + t * ry, tris[p + 2] + u * (tris[q + 2] - tris[p + 2]));
                }
            }),
        };
    };
    const ends = new Map<number, EndSurface>();
    return { minZ, maxZ, end: (dir) => { let s = ends.get(dir); if (!s) ends.set(dir, s = build(dir)); return s; } };
}

/** Fit the lamps of a model from its `paint` and `dark` geometry (car space, world units, nose toward -Z), its style and
 *  belt height (world units); `far`: its far version's paint and dark, to seat the far lenses on. A lamp that cannot be
 *  fitted is left out; this never throws. */
export function meshLamps(paint: THREE.BufferGeometry, dark: THREE.BufferGeometry, style: string, belt: number,
    far?: { paint: THREE.BufferGeometry; dark: THREE.BufferGeometry }): MeshLamps {
    const none = (): MeshLamps => ({ head: null, tail: null, lamps: null, farLamps: null, halos: halos([]) });
    const body = bodyOf(paint, dark);
    if (!body) return none();
    const { minZ, maxZ } = body, L = maxZ - minZ, P = paint.getAttribute('position') as THREE.BufferAttribute;

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

    const spec = LAMP[style] ?? LAMP.sedan;
    /** A lamp rectangle that lies on the surface (every grid point hit, none deeper than `cap`), lowered then pulled in until it does. */
    const fit = (dir: number, hw: number, x0f: number, x1f: number, top: number, hh: number, cap: number): LampRect | null => {
        if (!(hw > 0)) return null;
        const zAt = body.end(dir).z, endZ = dir < 0 ? minZ : maxZ;
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
    const f = end(-1), r = end(1), HEAD_CAP = .6 * S, TAIL_CAP = .45 * S;
    const head = fit(-1, f.hw, spec[0], spec[1], Math.min(f.top - .08 * S, belt - .1 * S), spec[2] * S, HEAD_CAP);
    const tail = fit(1, r.hw, spec[3], spec[4], Math.min(r.top, belt) - .04 * S, spec[5] * S, TAIL_CAP);
    if (!head && !tail) return none();

    const fitted: Fitted[] = [];
    if (head) fitted.push([head, -1, HEAD_CAP]);
    if (tail) fitted.push([tail, 1, TAIL_CAP]);
    const near = lenses(fitted, body, false);
    const farBody = far ? bodyOf(far.paint, far.dark) : null;

    // the night glow: a point a little in front of each lens's middle (and of any lift there)
    const glow: [V3, V3, number][] = [];
    const mid = (r: LampRect) => r.z[ROWS / 2 * (COLS + 1) + COLS / 2];
    fitted.forEach(([r, dir], j) => { for (const sd of [1, -1]) glow.push([[sd * r.x, r.y, mid(r) + dir * (.12 + near.lift[j])], dir < 0 ? HALO_HEAD : HALO_TAIL, dir]); });
    return { head, tail, lamps: near.geometry, farLamps: farBody ? lenses(fitted, farBody, true).geometry : null, halos: halos(glow) };
}

/** A fitted lamp: its rectangle, the way it faces (-1 nose, 1 tail) and how deep its surface may lie behind the end. */
type Fitted = [LampRect, number, number];

/** The lens quads of the fitted lamps on `body`: one per grid cell (so the reverse lamp's columns are a swatch of their
 *  own), facing out of their end, in two groups: the head lenses (material 0), then the tail lenses (material 1, which
 *  glow on their own: carModel.ts), OUT in front of the surface at the grid's points and lifted (up to MAX_LIFT) where the
 *  body stands out between them. `reseat`: take each grid point's depth from this body (the far version's), and leave out
 *  a cell where it has no surface under a corner (its vertices stay, so the layout matches the near lenses'). `lift`: the
 *  most any cell of each lamp was lifted. */
function lenses(fitted: Fitted[], body: Body, reseat: boolean): { geometry: THREE.BufferGeometry; lift: number[] } {
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], index: number[] = [], lift: number[] = [];
    let heads = 0; // the head lenses' index count (the fitted lamps come head first)
    for (const [r, dir, cap] of fitted) {
        const s = body.end(dir), endZ = dir < 0 ? body.minZ : body.maxZ;
        let n = 0, most = 0;
        for (const sd of [1, -1]) {
            const X = (i: number) => sd * (r.x0 + (r.x1 - r.x0) * i / COLS), Y = (k: number) => r.y0 + (r.y1 - r.y0) * k / ROWS;
            let seated = true; // (reseating: whether every corner of the cell found the body)
            const gz = (i: number, k: number) => {
                let z = r.z[n + k * (COLS + 1) + i];
                if (reseat) { const zz = s.z(X(i), Y(k)); if (!Number.isNaN(zz) && Math.abs(zz - endZ) <= cap) z = zz; else seated = false; }
                return z + dir * OUT;
            };
            for (let k = 0; k < ROWS; k++) for (let i = 0; i < COLS; i++) {
                const xa = X(i), xb = X(i + 1), ya = Y(k), yb = Y(k + 1);
                seated = true;
                const zc = [gz(i, k), gz(i + 1, k), gz(i + 1, k + 1), gz(i, k + 1)];
                // how far the body stands out in front of the cell as it is drawn (two triangles folded along 0-2): the body
                // is flat between its vertices and edges, so the most is at a vertex inside the cell, where an edge of the
                // body crosses the cell's edges or fold, or at a corner. That is how far the cell must rise.
                let need = 0;
                const check = (x: number, y: number, z: number) => {
                    const u = (x - xa) / (xb - xa), v = (y - ya) / (yb - ya);
                    const lz = u >= v ? zc[0] + u * (zc[1] - zc[0]) + v * (zc[2] - zc[1]) : zc[0] + v * (zc[3] - zc[0]) + u * (zc[2] - zc[3]);
                    need = Math.max(need, OUT - dir * (lz - z));
                };
                s.vertices(Math.min(xa, xb), Math.max(xa, xb), ya, yb, check);
                for (const [a, b] of EDGES) s.crossings(xa + (xb - xa) * a[0], ya + (yb - ya) * a[1], xa + (xb - xa) * b[0], ya + (yb - ya) * b[1], check);
                for (const [u, v] of CORNERS) { const x = xa + (xb - xa) * u, y = ya + (yb - ya) * v, z = s.z(x, y); if (!Number.isNaN(z)) check(x, y, z); }
                const up = Math.min(need, MAX_LIFT);
                most = Math.max(most, up);
                const sw: Swatch = dir < 0 ? 'lampHead' : i < REV ? 'lampRev' : 'lampTail', [su, sv] = swatchUV(sw);
                const b = pos.length / 3;
                CORNERS.forEach(([di, dk], j) => {
                    pos.push(X(i + di), Y(k + dk), zc[j] + dir * up);
                    nor.push(0, 0, dir); uv.push(su, sv);
                });
                // counter-clockwise seen from outside: x grows with i on the right side (sd 1), shrinks on the left. A cell the
                // far body has no surface under (its nose cut back, say) is left out, rather than drawn in the air.
                if (!seated) continue;
                if (sd * dir > 0) index.push(b, b + 1, b + 2, b, b + 2, b + 3); else index.push(b, b + 2, b + 1, b, b + 3, b + 2);
            }
            n += (ROWS + 1) * (COLS + 1);
        }
        lift.push(most);
        if (dir < 0) heads = index.length;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(index);
    geometry.addGroup(0, heads, 0); geometry.addGroup(heads, index.length - heads, 1);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return { geometry, lift };
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
