import * as THREE from 'three';
import type { WorldContext } from './context';
import { GeoBuilder, type UVFn } from './meshBuilder';
import { CELL, type PackedMesh } from './cells';
import { PAINT_U, ROAD_ATLAS_GRAVEL_U, ROAD_ATLAS_LENGTH, ROAD_ATLAS_LOT_U, ROAD_ATLAS_ROAD_U, seededRandom } from '../textures';
import type { PlantKind } from './vegetation';

// The town's streets: asphalt with painted markings (four lanes, a double yellow centre
// line, crosswalks and stop lines at the junctions), concrete gutters and curbs, sidewalk
// bands (tree lawn, sidewalk, back lawn, a grass slope down to the open ground), rounded
// junction corners, driveway crossings, plus street lights, traffic signals, stop signs,
// street furniture, street trees and shrubs. Everything goes into the town's shared,
// cell-packed layers (see cells.ts): one draw call per material for the whole network.
//
// Everything that moves stays at y = 0, so every walkable or drivable surface is within
// 4 cm of the road (2 world units per metre): road 0.03, sidewalks 0.10, driveway
// crossings 0.04, lawns 0.09; only the narrow curb top stands at 0.13. The curb still reads as a
// curb through its concrete band, the gutter pan in front of it and a shadow line.

// ---- Cross-section of a 25-unit street (units from the centre line) -------------------
export const HALF = 12.5;                         // curb face
const CURB_W = 0.3;                               // curb top (15 cm)
const GUTTER = 11.9;                              // concrete gutter pan from here to the curb
const SHADE = 12.32;                              // dark line at the foot of the curb
const LAWN1: [number, number] = [HALF + CURB_W, 15.3]; // tree lawn (street trees, lights)
const WALK: [number, number] = [15.3, 19.8];      // sidewalk
export const BAND = 22.5;                         // back of the sidewalk band (back lawn 19.8..22.5)
const BERM = 1.2;                                 // grass slope down to the open ground
const R = 8;                                      // curb radius at junction corners
export const Y = { road: 0.03, gutter: 0.034, paint: 0.037, drain: 0.04, apron: 0.04, lawn: 0.09, walk: 0.1, curb: 0.13 };

// Markings: double yellow centre line, dashed lane lines (3 m dash, 9 m gap), edge lines
const YEL0 = 0.1, YEL1 = 0.3;
const LANE_D = 6.0, LANE_W = 0.2, DASH = 6, PERIOD = 24;
const EDGE0 = 11.6, EDGE1 = 11.85;
// Approach to a junction, from the junction box: crosswalk (continental bars), stop line
const CW0 = 1.0, CW1 = 7.0, STOP0 = 8.2, STOP1 = 8.8;
const LAMP_D = HALF + CURB_W + 0.45;
const TREE_D = (LAWN1[0] + LAWN1[1]) / 2;

type Axis = 'x' | 'z';
type V2 = [number, number];
/** World (x, z) of a point `a` along and `d` across a road whose centre line is at `c`. */
const W = (axis: Axis, c: number, a: number, d: number): V2 => (axis === 'z' ? [c + d, a] : [a, c + d]);

// UVs into the asphalt atlas: the road cross-section, a clean column (junctions, track),
// the sealed column (lots, driveways) and gravel.
const roadUV = (axis: Axis, c: number, half = HALF): UVFn => (x, _y, z) => {
    const d = axis === 'z' ? x - c : z - c, a = axis === 'z' ? z : x;
    return [ROAD_ATLAS_ROAD_U * (d + half) / (2 * half), a / ROAD_ATLAS_LENGTH];
};
export const cleanUV: UVFn = (x, _y, z) => [ROAD_ATLAS_ROAD_U * (HALF + 0.45) / (2 * HALF), (x + z) / ROAD_ATLAS_LENGTH];
export const lotUV: UVFn = (x, _y, z) => [ROAD_ATLAS_LOT_U, (0.7 * x + 0.3 * z) / ROAD_ATLAS_LENGTH];
export const gravelUV: UVFn = (x, _y, z) => [ROAD_ATLAS_GRAVEL_U, (0.6 * x + 0.4 * z) / ROAD_ATLAS_LENGTH];
export const paintUV = (c: keyof typeof PAINT_U): UVFn => () => [PAINT_U[c], 0.5];
export { roadUV };

/** Separate ground meshes (one per material) for something built after the town, e.g. a dealership lot. */
export function createGroundLayers(ctx: WorldContext) {
    const asphalt = new GeoBuilder(), concrete = new GeoBuilder(), paint = new GeoBuilder(), grass = new GeoBuilder();
    const finish = (parent: THREE.Object3D = ctx.scene) => {
        const add = (b: GeoBuilder, mat: THREE.Material) => {
            if (b.empty) return;
            const m = new THREE.Mesh(b.build(), mat);
            m.receiveShadow = true; m.castShadow = false;
            parent.add(m);
            if (parent === ctx.scene) ctx.environmentDisposables.push(m);
        };
        add(asphalt, ctx.ground.asphalt);
        add(concrete, ctx.ground.concrete);
        add(paint, ctx.ground.paint);
        add(grass, ctx.ground.lawn);
    };
    return { asphalt, concrete, paint, grass, finish };
}
export type GroundLayers = ReturnType<typeof createGroundLayers>;

/** Splits [a0, a1] at multiples of the cell size, so each piece lies in one cell along the road. */
export const chunks = (a0: number, a1: number): V2[] => {
    const out: V2[] = [];
    for (let s = a0; s < a1 - 1e-6;) {
        const e = Math.min(a1, (Math.floor(s / CELL + 1e-9) + 1) * CELL);
        out.push([s, e]);
        s = e;
    }
    return out;
};

type Rect = [number, number, number, number]; // x0, z0, x1, z1
/** Areas trees, lamps and furniture keep out of. */
export class KeepOut {
    private rects: Rect[] = [];
    private circles: [number, number, number][] = [];
    rect(x0: number, z0: number, x1: number, z1: number) { this.rects.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]); return this; }
    circle(x: number, z: number, r: number) { this.circles.push([x, z, r]); return this; }
    blocked(x: number, z: number, r = 0) {
        for (const [x0, z0, x1, z1] of this.rects) if (x > x0 - r && x < x1 + r && z > z0 - r && z < z1 + r) return true;
        for (const [cx, cz, cr] of this.circles) if ((x - cx) ** 2 + (z - cz) ** 2 < (cr + r) ** 2) return true;
        return false;
    }
}

/** Lot slots the server hands out face the z = 200 street at these x (driveways 30 wide). */
export const LOT_DRIVEWAYS = [0, 250, 500];
/** Test drives leave each lot straight up x = lotX: nothing is placed in these corridors. */
export const DRIVE_CORRIDORS = [0, 250, 500, 750, 1000];

/**
 * Builds every street of the town. Returns the areas the streets take up (for the
 * trees and groves the city scatters around them).
 */
export function buildStreets(ctx: WorldContext, buildings: KeepOut) {
    const L = ctx.layers;
    const { furniture, city: propCells } = ctx.props;
    const rand = seededRandom(424242);
    const roads = new KeepOut();
    // things already standing (lamps, furniture) that trees keep clear of
    const placed = new KeepOut();
    const corridor = (x: number, z: number) => z > -620 && z < 620 && DRIVE_CORRIDORS.some(cx => Math.abs(x - cx) < 11);
    const free = (x: number, z: number, r: number) => !buildings.blocked(x, z, r) && !placed.blocked(x, z, r) && !corridor(x, z);

    // ---- Low-level pieces --------------------------------------------------------------
    const quad = (layer: PackedMesh, axis: Axis, c: number, a0: number, a1: number, d0: number, d1: number, y: number, uv?: UVFn) => {
        if (a1 - a0 < 1e-3 || Math.abs(d1 - d0) < 1e-4) return;
        for (const [s0, s1] of chunks(a0, a1)) {
            const [mx, mz] = W(axis, c, (s0 + s1) / 2, (d0 + d1) / 2);
            layer.at(mx, mz).flat([W(axis, c, s0, d0), W(axis, c, s1, d0), W(axis, c, s1, d1), W(axis, c, s0, d1)], y, uv);
        }
    };
    /** Vertical strip along the road at `d`, from y0 to y1, facing `face` (+1/-1) across the road. */
    const wallAlong = (layer: PackedMesh, axis: Axis, c: number, a0: number, a1: number, d: number, y0: number, y1: number, face: number) => {
        for (const [s0, s1] of chunks(a0, a1)) {
            const [x0, z0] = W(axis, c, s0, d), [x1, z1] = W(axis, c, s1, d);
            layer.at((x0 + x1) / 2, (z0 + z1) / 2).wall(x0, z0, x1, z1, y0, y1, axis === 'z' ? face : 0, axis === 'x' ? face : 0);
        }
    };
    /** Vertical strip across the road at `a`, from d0 to d1, facing `face` (+1/-1) along the road. */
    const wallAcross = (layer: PackedMesh, axis: Axis, c: number, a: number, d0: number, d1: number, y0: number, y1: number, face: number) => {
        const [x0, z0] = W(axis, c, a, d0), [x1, z1] = W(axis, c, a, d1);
        layer.at((x0 + x1) / 2, (z0 + z1) / 2).wall(x0, z0, x1, z1, y0, y1, axis === 'x' ? face : 0, axis === 'z' ? face : 0);
    };
    const paint = (axis: Axis, c: number, a0: number, a1: number, d0: number, d1: number, col: keyof typeof PAINT_U = 'white', y = Y.paint) =>
        quad(L.paint, axis, c, a0, a1, d0, d1, y, paintUV(col));

    // ---- Road surface and markings between a0 and a1 (junction ends get crosswalks) ----
    type End = { junction: number } | 'open';
    const segment = (axis: Axis, c: number, a0: number, a1: number, e0: End, e1: End) => {
        quad(L.asphalt, axis, c, a0, a1, -GUTTER, GUTTER, Y.road, roadUV(axis, c));
        const jc0 = e0 === 'open' ? null : e0.junction, jc1 = e1 === 'open' ? null : e1.junction;
        // double yellow, lane dashes (in step with the world grid) between the stop lines
        const s0 = jc0 === null ? a0 : jc0 + HALF + STOP1, s1 = jc1 === null ? a1 : jc1 - HALF - STOP1;
        for (const sgn of [-1, 1]) paint(axis, c, s0, s1, sgn * YEL0, sgn * YEL1, 'yellow');
        for (let k = Math.floor(s0 / PERIOD); k * PERIOD < s1; k++) {
            const d0 = Math.max(s0, k * PERIOD), d1 = Math.min(s1, k * PERIOD + DASH);
            if (d1 > d0) for (const sgn of [-1, 1]) paint(axis, c, d0, d1, sgn * (LANE_D - LANE_W / 2), sgn * (LANE_D + LANE_W / 2));
        }
        // edge lines up to the crosswalks
        const c0 = jc0 === null ? a0 : jc0 + HALF + CW1, c1 = jc1 === null ? a1 : jc1 - HALF - CW1;
        for (const sgn of [-1, 1]) paint(axis, c, c0, c1, sgn * EDGE0, sgn * EDGE1);
        // crosswalk and the stop line across the lanes heading into the junction
        const approach = (jc: number, dir: number) => {
            const at = (k: number) => jc + dir * (HALF + k);
            const [cA, cB] = [at(CW0), at(CW1)].sort((p, q) => p - q);
            for (let k = 0; k < 10; k++) { const d = -10.8 + k * 2.4; paint(axis, c, cA, cB, d - 0.6, d + 0.6); }
            const side = axis === 'z' ? dir : -dir; // traffic keeps right
            const [sA, sB] = [at(STOP0), at(STOP1)].sort((p, q) => p - q);
            const [dA, dB] = [side * YEL1, side * EDGE1].sort((p, q) => p - q);
            paint(axis, c, sA, sB, dA, dB);
        };
        if (jc0 !== null) approach(jc0, 1);
        if (jc1 !== null) approach(jc1, -1);
        // storm drains at the gutters and the odd manhole cover in the lanes
        for (let a = Math.ceil((a0 + 25) / 45) * 45 + 7; a < a1 - 25; a += 45) {
            for (const sgn of [-1, 1]) paint(axis, c, a, a + 1.6, sgn * (GUTTER + 0.05), sgn * (HALF - 0.08), 'dark', Y.drain);
        }
        for (let a = Math.ceil((a0 + 25) / 70) * 70 + 31; a < a1 - 25; a += 70) {
            const d = (Math.round(a / 70) % 2 ? 1 : -1) * 3.1, [mx, mz] = W(axis, c, a, d);
            L.paint.at(mx, mz).flat(Array.from({ length: 10 }, (_, i) => [mx + 0.8 * Math.cos(i * Math.PI / 5), mz + 0.8 * Math.sin(i * Math.PI / 5)] as V2), Y.drain, paintUV('dark'));
        }
    };

    // ---- One side of a street: the gutter pan, and a curb or a driveway crossing -------
    const side = (axis: Axis, c: number, sgn: number, a0: number, a1: number, kind: 'curb' | 'apron', cap0 = false, cap1 = false) => {
        if (a1 - a0 < 0.01) return;
        quad(L.concrete, axis, c, a0, a1, sgn * GUTTER, sgn * HALF, Y.gutter);
        if (kind === 'apron') { quad(L.concrete, axis, c, a0, a1, sgn * HALF, sgn * BAND, Y.apron); return; }
        paint(axis, c, a0, a1, sgn * SHADE, sgn * HALF, 'shade');
        quad(L.concrete, axis, c, a0, a1, sgn * HALF, sgn * (HALF + CURB_W), Y.curb);
        wallAlong(L.concrete, axis, c, a0, a1, sgn * HALF, Y.road, Y.curb, -sgn);
        wallAlong(L.concrete, axis, c, a0, a1, sgn * (HALF + CURB_W), Y.lawn, Y.curb, sgn);
        if (cap0) wallAcross(L.concrete, axis, c, a0, sgn * HALF, sgn * (HALF + CURB_W), Y.apron, Y.curb, -1);
        if (cap1) wallAcross(L.concrete, axis, c, a1, sgn * HALF, sgn * (HALF + CURB_W), Y.apron, Y.curb, 1);
    };

    // ---- Sidewalk band along a road side -------------------------------------------------
    type BandEnd = 'corner' | 'apron' | 'open';
    type BandOpts = { noBack?: V2[]; paved?: V2[] };
    const lawnSpans: { axis: Axis; c: number; sgn: number; a0: number; a1: number }[] = [];
    const band = (axis: Axis, c: number, sgn: number, a0: number, a1: number, e0: BandEnd, e1: BandEnd, opts: BandOpts = {}) => {
        const endPave = (e: BandEnd) => (e === 'corner' ? 2 : e === 'apron' ? 6 : 0);
        let l0 = Math.min(a1, a0 + endPave(e0)), l1 = Math.max(a0, a1 - endPave(e1));
        if (l0 > l1) l0 = l1 = (a0 + a1) / 2; // a short piece: all paved
        const D = (d: number) => sgn * d;
        quad(L.concrete, axis, c, a0, l0, D(LAWN1[0]), D(BAND), Y.walk);
        quad(L.concrete, axis, c, l1, a1, D(LAWN1[0]), D(BAND), Y.walk);
        quad(L.lawn, axis, c, l0, l1, D(LAWN1[0]), D(LAWN1[1]), Y.lawn);
        quad(L.concrete, axis, c, l0, l1, D(WALK[0]), D(WALK[1]), Y.walk);
        // back lawn (or paving where a frontage or a bus stop is paved), and the slope
        const minus = (spans: V2[], cut: V2[]) => cut.reduce((acc, [u0, u1]) => acc.flatMap(([p, q]): V2[] => (u1 <= p || u0 >= q ? [[p, q]] : [...(u0 > p ? [[p, u0] as V2] : []), ...(u1 < q ? [[u1, q] as V2] : [])])), spans);
        const noBack = opts.noBack ?? [], paved = opts.paved ?? [];
        minus([[l0, l1]], [...noBack, ...paved]).forEach(([p, q]) => quad(L.lawn, axis, c, p, q, D(WALK[1]), D(BAND), Y.lawn));
        paved.forEach(([p, q]) => quad(L.concrete, axis, c, Math.max(p, l0), Math.min(q, l1), D(WALK[1]), D(BAND), Y.walk));
        minus([[a0, a1]], noBack).forEach(([p, q]) => {
            for (const [s0, s1] of chunks(p, q)) {
                const [mx, mz] = W(axis, c, (s0 + s1) / 2, D(BAND));
                L.lawn.at(mx, mz).band([W(axis, c, s0, D(BAND)), W(axis, c, s1, D(BAND))], Y.lawn, [W(axis, c, s0, D(BAND + BERM)), W(axis, c, s1, D(BAND + BERM))], 0);
            }
        });
        // ends: a face down to the ground (open) or to the driveway crossing (apron)
        const end = (a: number, e: BandEnd, face: number) => {
            if (e === 'open') wallAcross(L.concrete, axis, c, a, D(HALF + CURB_W), D(BAND), 0, Y.walk, face);
            if (e === 'apron') wallAcross(L.concrete, axis, c, a, D(HALF + CURB_W), D(BAND), Y.apron, Y.walk, face);
        };
        end(a0, e0, -1); end(a1, e1, 1);
        lawnSpans.push({ axis, c, sgn, a0: l0, a1: l1 });
        roads.rect(...W(axis, c, a0, 0), ...W(axis, c, a1, D(BAND + BERM + 1)));
    };

    // ---- Junction box and its rounded corners ------------------------------------------
    const ARC = 8;
    const junction = (jx: number, jz: number, corners: V2[]) => {
        L.asphalt.at(jx, jz).rect(jx - HALF, jz - HALF, jx + HALF, jz + HALF, Y.road, cleanUV);
        roads.rect(jx - HALF, jz - HALF, jx + HALF, jz + HALF);
        corners.forEach(([sx, sz]) => {
            const C: V2 = [jx + sx * (HALF + R), jz + sz * (HALF + R)];
            const pt = (r: number, t: number): V2 => [C[0] - sx * r * Math.cos(t * Math.PI / 2), C[1] - sz * r * Math.sin(t * Math.PI / 2)];
            const arc = (r: number) => Array.from({ length: ARC + 1 }, (_, i) => pt(r, i / ARC));
            const at = (layer: PackedMesh) => layer.at(jx + sx * 17, jz + sz * 17);
            // road filling the corner up to the gutter, then gutter, curb shadow, curb
            at(L.asphalt).flat([[jx + sx * GUTTER, jz + sz * GUTTER], ...arc(R + HALF - GUTTER)], Y.road, cleanUV);
            const ring = (layer: PackedMesh, r0: number, r1: number, y: number, uv?: UVFn) => {
                const A = arc(r0), B = arc(r1);
                for (let i = 0; i < ARC; i++) at(layer).flat([A[i], A[i + 1], B[i + 1], B[i]], y, uv);
            };
            ring(L.concrete, R, R + HALF - GUTTER, Y.gutter);
            ring(L.paint, R, R + HALF - SHADE, Y.paint, paintUV('shade'));
            ring(L.concrete, R - CURB_W, R, Y.curb);
            const face = arc(R), back = arc(R - CURB_W);
            for (let i = 0; i < ARC; i++) {
                const t = (i + 0.5) / ARC, nx = -sx * Math.cos(t * Math.PI / 2), nz = -sz * Math.sin(t * Math.PI / 2);
                at(L.concrete).wall(face[i][0], face[i][1], face[i + 1][0], face[i + 1][1], Y.road, Y.curb, nx, nz);
                at(L.concrete).wall(back[i][0], back[i][1], back[i + 1][0], back[i + 1][1], Y.walk, Y.curb, -nx, -nz);
            }
            // corner plaza, and the grass slope round its outer corner
            const F: V2 = [jx + sx * BAND, jz + sz * BAND];
            at(L.concrete).flat([F, [F[0], jz + sz * (HALF + CURB_W)], ...[...back].reverse(), [jx + sx * (HALF + CURB_W), F[1]]], Y.walk);
            const G: V2 = [F[0] + sx * BERM, F[1] + sz * BERM];
            at(L.lawn).poly([[F[0], Y.lawn, F[1]], [G[0], 0, F[1]], [G[0], 0, G[1]]], [0, 1, 0]);
            at(L.lawn).poly([[F[0], Y.lawn, F[1]], [G[0], 0, G[1]], [F[0], 0, G[1]]], [0, 1, 0]);
            roads.rect(jx + sx * HALF, jz + sz * HALF, G[0] + sx, G[1] + sz);
        });
    };

    // ---- Lights, furniture, trees -------------------------------------------------------
    const lamp = (axis: Axis, c: number, sgn: number, a: number) => {
        const [x, z] = W(axis, c, a, sgn * LAMP_D);
        if (!free(x, z, 1.5)) return false;
        const [tx, tz] = W(axis, c, a, 0), len = Math.hypot(tx - x, tz - z);
        ctx.props.street(x, z, (tx - x) / len, (tz - z) / len, Y.road);
        placed.circle(x, z, 6);
        return true;
    };
    /** Lights every `step` along a road side between a0 and a1 (the two sides staggered). */
    const lamps = (axis: Axis, c: number, sgn: number, a0: number, a1: number, step = 70, offset = 0) => {
        const n = Math.max(1, Math.round((a1 - a0) / step));
        for (let i = 0; i < n; i++) {
            const a = a0 + ((i + 0.5 + offset) * (a1 - a0)) / n;
            // a light that would stand in someone's way moves along a little
            for (const da of [0, 5, -5, 10, -10]) if (lamp(axis, c, sgn, a + da)) break;
        }
    };
    const plant = (kind: PlantKind, x: number, z: number, r: number, scale = 1) => {
        if (!free(x, z, r)) return false;
        ctx.plants.add(kind, x, z, rand, scale);
        return true;
    };
    const streetTrees = (axis: Axis, c: number, sgn: number, a0: number, a1: number, kinds: PlantKind[], spacing = 24) => {
        for (let a = a0 + 4; a <= a1 - 4; a += spacing + (rand() - 0.5) * 3) {
            const [x, z] = W(axis, c, a, sgn * (TREE_D + (rand() - 0.5) * 0.3));
            plant(kinds[Math.floor(rand() * kinds.length)], x, z, 3, 0.95 + rand() * 0.15);
        }
    };
    const shrubs = (axis: Axis, c: number, sgn: number, a0: number, a1: number, noBack: V2[] = []) => {
        for (let a = a0 + 3; a <= a1 - 3; a += 30 + rand() * 20) {
            const n = 1 + Math.floor(rand() * 2);
            for (let i = 0; i < n; i++) {
                const aa = a + i * 2.2 + rand() * 0.5;
                if (noBack.some(([p, q]) => aa > p - 2 && aa < q + 2)) continue;
                const [x, z] = W(axis, c, aa, sgn * (WALK[1] + 1.2 + rand() * 0.6));
                plant('bush', x, z, 0.5, 0.8 + rand() * 0.4);
            }
        }
    };
    const backTrees = (axis: Axis, c: number, sgn: number, a0: number, a1: number, kinds: PlantKind[], spacing = 42) => {
        for (let a = a0 + 6; a < a1 - 6; a += spacing * (0.7 + rand() * 0.6)) {
            const [x, z] = W(axis, c, a, sgn * (BAND + BERM + 4 + rand() * 7));
            if (roads.blocked(x, z, 4)) continue;
            plant(kinds[Math.floor(rand() * kinds.length)], x, z, 5, 0.9 + rand() * 0.35);
        }
    };
    const signalAt = (jx: number, jz: number, fx: number, fz: number, lit: 'red' | 'green') => {
        // on the far right corner for traffic heading (fx, fz); the arm reaches over its lanes
        const rx = -fz, rz = fx; // the driver's right (traffic keeps right)
        const x = jx + (fx + rx) * 15.5, z = jz + (fz + rz) * 15.5;
        furniture.signal(propCells.at(x, z), x, z, -rx, -rz, 13.5, -fx, -fz, lit);
        placed.circle(x, z, 3);
    };
    const stuff = (x: number, z: number, r: number, put: (b: GeoBuilder) => void) => { put(propCells.at(x, z)); placed.circle(x, z, r); };

    // ===================================================================================
    // The network. Positions and widths are the old ones (the minimap, test drives and
    // race lines rely on them): the main road x = 0 from z = 200 to 1040, cross streets
    // at z = 200 and z = 500 from x = -500 to 500 (the east ends run on to x = 516, past the
    // last lot's driveway, to a barrier), junctions at (0, 200) and (0, 500).
    // ===================================================================================
    const J1 = 200, J2 = 500, MAIN_END = 1040, WEST = -500, EAST = 516;
    // the auction house stands on the z = 200 street's north edge, x -100..-20
    const AUC0 = -99;
    const lotAprons = LOT_DRIVEWAYS.map(x => [x - 15, x + 15] as V2);

    // Junction 1 (0, 200): main road north, cross street east and west, lot 0's driveway south
    junction(0, J1, [[1, 1], [-1, 1]]);
    segment('x', J1, WEST, -HALF, 'open', { junction: 0 });
    segment('x', J1, HALF, EAST, { junction: 0 }, 'open');
    // north side: curb all the way except in front of the auction house
    side('x', J1, 1, WEST, AUC0, 'curb', true, true);
    side('x', J1, 1, HALF + R, EAST, 'curb', false, true);
    band('x', J1, 1, WEST, AUC0, 'open', 'open');
    band('x', J1, 1, BAND, EAST, 'corner', 'open');
    // south side: curbs between the lots' driveway crossings (lot 0's is at the junction)
    {
        let a = WEST;
        for (const [p, q] of lotAprons) {
            side('x', J1, -1, a, p, 'curb', true, true);
            band('x', J1, -1, a, p, a === WEST ? 'open' : 'apron', 'apron');
            // the crossing (the junction box takes the middle of lot 0's)
            if (p < -HALF && q > HALF) { side('x', J1, -1, p, -HALF, 'apron'); side('x', J1, -1, HALF, q, 'apron'); quad(L.concrete, 'x', J1, -HALF, HALF, -HALF, -BAND, Y.apron); }
            else side('x', J1, -1, p, q, 'apron');
            roads.rect(p, J1 - BAND - 1, q, J1);
            placed.rect(p - 2, J1 - BAND - 1, q + 2, J1 - HALF);
            a = q;
        }
        side('x', J1, -1, a, EAST, 'curb', true, true);
        band('x', J1, -1, a, EAST, 'apron', 'open');
    }

    // Main road between the junctions and on to the speedway road
    segment('z', 0, J1 + HALF, J2 - HALF, { junction: J1 }, { junction: J2 });
    segment('z', 0, J2 + HALF, MAIN_END, { junction: J2 }, 'open');
    for (const sgn of [-1, 1]) {
        side('z', 0, sgn, J1 + HALF + R, J2 - HALF - R, 'curb');
        side('z', 0, sgn, J2 + HALF + R, MAIN_END, 'curb', false, true);
    }
    // the west side past the auction house is paved up to its wall (its side entrance opens onto it)
    band('z', 0, -1, J1 + BAND, J2 - BAND, 'corner', 'corner', { paved: [[J1 + BAND, 272]] });
    band('z', 0, 1, J1 + BAND, J2 - BAND, 'corner', 'corner', { paved: [[392, 408]] });
    band('z', 0, -1, J2 + BAND, MAIN_END, 'corner', 'open', { paved: [[632, 648]] });
    band('z', 0, 1, J2 + BAND, MAIN_END, 'corner', 'open');

    // Junction 2 (0, 500): four ways
    junction(0, J2, [[1, 1], [-1, 1], [1, -1], [-1, -1]]);
    segment('x', J2, WEST, -HALF, 'open', { junction: 0 });
    segment('x', J2, HALF, EAST, { junction: 0 }, 'open');
    // the park at (50, 470) reaches into the south side's back lawn
    const parkCut: V2[] = [[36.8, 63.2]];
    for (const sgn of [-1, 1]) {
        side('x', J2, sgn, WEST, -HALF - R, 'curb', true, false);
        side('x', J2, sgn, HALF + R, EAST, 'curb', false, true);
        band('x', J2, sgn, WEST, -BAND, 'open', 'corner');
        band('x', J2, sgn, BAND, EAST, 'corner', 'open', sgn < 0 ? { noBack: parkCut } : {});
    }
    roads.rect(-HALF, J1, HALF, MAIN_END).rect(WEST, J1 - HALF, EAST, J1 + HALF).rect(WEST, J2 - HALF, EAST, J2 + HALF);

    // ---- Street lights: every ~70 per side, the sides staggered ----
    lamps('z', 0, -1, J1 + 30, J2 - 30, 70, 0);
    lamps('z', 0, 1, J1 + 30, J2 - 30, 70, 0.5);
    lamps('z', 0, -1, J2 + 30, MAIN_END - 6, 70, 0);
    lamps('z', 0, 1, J2 + 30, MAIN_END - 6, 70, 0.5);
    for (const cz of [J1, J2]) {
        lamps('x', cz, 1, WEST + 6, -30, 70, cz === J1 ? 0 : 0.5);
        lamps('x', cz, -1, WEST + 6, -30, 70, cz === J1 ? 0.5 : 0);
        lamps('x', cz, 1, 30, EAST - 6, 70, 0.5);
        lamps('x', cz, -1, 30, EAST - 6, 70, 0);
    }

    // ---- Traffic signals at the main road's junctions, stop signs at the lot exits ----
    // (the main road has the green; the cross streets and lot 0's exit wait at red)
    signalAt(0, J1, 0, -1, 'green'); signalAt(0, J1, 1, 0, 'red'); signalAt(0, J1, -1, 0, 'red'); signalAt(0, J1, 0, 1, 'red');
    signalAt(0, J2, 0, -1, 'green'); signalAt(0, J2, 0, 1, 'green'); signalAt(0, J2, 1, 0, 'red'); signalAt(0, J2, -1, 0, 'red');
    LOT_DRIVEWAYS.slice(1).forEach(x => stuff(x - 17.5, J1 - 19.5, 1, b => furniture.stopSign(b, x - 17.5, J1 - 19.5, 0, -1)));
    // dead ends
    for (const [x, cz, dir] of [[WEST + 0.6, J1, -1], [WEST + 0.6, J2, -1], [EAST - 0.6, J1, 1], [EAST - 0.6, J2, 1]] as [number, number, number][]) {
        stuff(x, cz, 2, b => furniture.barrier(b, x, cz, dir, 0, 23));
    }
    // bus stops (shelter, bin, bench) on the main road
    const busStop = (sgn: number, a: number) => {
        const [x, z] = W('z', 0, a, sgn * 21.2);
        stuff(x, z, 8.5, b => furniture.busShelter(b, x, z, -sgn, 0));
        const [bx, bz] = W('z', 0, a + 6, sgn * 20.3);
        stuff(bx, bz, 1.5, b => furniture.bin(b, bx, bz));
    };
    busStop(1, 400); busStop(-1, 640);
    // corner bins, hydrants on the tree lawns, benches along the walks
    for (const [jx, jz, sx, sz] of [[0, J1, 1, 1], [0, J2, 1, 1], [0, J2, -1, -1], [0, J2, -1, 1]] as [number, number, number, number][]) {
        const x = jx + sx * 21, z = jz + sz * 17.2;
        stuff(x, z, 1.5, b => furniture.bin(b, x, z));
    }
    for (const [axis, c, sgn, a] of [['z', 0, 1, 236], ['z', 0, -1, 452], ['z', 0, 1, 566], ['z', 0, -1, 760], ['z', 0, 1, 905], ['x', J1, 1, 120], ['x', J1, -1, -170], ['x', J2, 1, -120], ['x', J2, -1, 160]] as [Axis, number, number, number][]) {
        const [x, z] = W(axis, c, a, sgn * (LAWN1[0] + 0.8));
        if (free(x, z, 1)) stuff(x, z, 2, b => furniture.hydrant(b, x, z));
    }
    for (const [axis, c, sgn, a] of [['z', 0, 1, 455], ['z', 0, 1, 545], ['z', 0, -1, 380], ['x', J2, 1, 60], ['x', J1, 1, 70]] as [Axis, number, number, number][]) {
        const [x, z] = W(axis, c, a, sgn * (WALK[1] + 0.9));
        const [fx, fz] = axis === 'z' ? [-sgn, 0] : [0, -sgn];
        if (free(x, z, 2)) stuff(x, z, 3, b => furniture.bench(b, x, z, fx, fz));
    }

    // ---- Trees: an avenue of one or two kinds per street, shrubs, trees behind ----
    const avenue: Record<string, PlantKind[]> = { main: ['broadleaf', 'broadleaf', 'roundleaf'], [J1]: ['roundleaf'], [J2]: ['broadleaf', 'roundleaf'] };
    lawnSpans.forEach(({ axis, c, sgn, a0, a1 }) => {
        streetTrees(axis, c, sgn, a0, a1, axis === 'z' ? avenue.main : avenue[c], axis === 'z' ? 24 : 27);
        shrubs(axis, c, sgn, a0, a1, axis === 'x' && c === J2 && sgn < 0 ? parkCut : []);
    });
    backTrees('z', 0, 1, J1 + BAND, MAIN_END, ['broadleaf', 'roundleaf', 'conifer']);
    backTrees('z', 0, -1, J1 + BAND, MAIN_END, ['broadleaf', 'roundleaf', 'conifer']);
    for (const cz of [J1, J2]) for (const sgn of [-1, 1]) {
        backTrees('x', cz, sgn, WEST, -BAND, ['conifer', 'broadleaf', 'roundleaf'], 50);
        backTrees('x', cz, sgn, BAND, EAST, ['conifer', 'broadleaf', 'roundleaf'], 50);
    }

    return { roads, placed, corridor };
}
