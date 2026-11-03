import * as THREE from 'three';
import type { WorldContext } from './context';
import { GeoBuilder, type UVFn } from './meshBuilder';
import { PAINT_U, ROAD_ATLAS_LENGTH, ROAD_ATLAS_LOT_U, ROAD_ATLAS_ROAD_U, seededRandom } from '../textures';
import type { PlantKind } from './vegetation';

// Streets: asphalt with painted markings, concrete gutters and raised curbs, sidewalk bands
// (tree lawn, sidewalk, back lawn, a grass slope down to the open ground), junctions with
// rounded corners, crosswalks and stop lines, plus street lights, street trees and shrubs.
// Every layer is one mesh per material for the whole street network.

// ---- Cross-section of a 25 m street (metres from the centre line) -------------------------
export const HALF = 12.5;                         // kerb line
const CURB = 0.3;                                 // kerb width (top 0.12 m above the road)
const GUTTER = 0.45;                              // concrete gutter pan in front of the kerb
const LAWN1: [number, number] = [12.8, 15.3];     // tree lawn (street trees, lights)
const WALK: [number, number] = [15.3, 19.8];      // sidewalk
const LAWN2: [number, number] = [19.8, 22.5];     // back lawn (shrubs)
const BAND = 22.5;                                // back of the sidewalk band
const BERM = 1.0;                                 // grass slope down to the open ground
const R = 5;                                      // kerb radius at junction corners
const CORNER = BAND - HALF;                       // corner squares are 10 x 10 m
export const Y = { road: 0.03, gutter: 0.036, paint: 0.038, drain: 0.043, lawn: 0.13, walk: 0.14, curb: 0.15, apron: 0.045 };

// Markings
const YEL = 0.13, YEL_W = 0.12;                   // double yellow centre line
const LANE = 3.85, LANE_W = 0.12;                 // dashed lane lines (3 m dash, 9 m gap)
const EDGE = 7.53, EDGE_W = 0.15;                 // solid edge lines; parking lane outside them
const DASH = 3, PERIOD = 12;
// Approach to a junction, from the junction box: crosswalk, gap, stop line
const CW0 = R + 0.5, CW1 = CW0 + 3, STOP0 = CW1 + 1.0, STOP1 = STOP0 + 0.45;

type Axis = 'x' | 'z';
type End = 'junction' | 'open';
type BandEnd = 'corner' | 'open' | 'apron';
/** World (x, z) of a point `a` along and `d` across a road whose centre line is at `c`. */
const W = (axis: Axis, c: number, a: number, d: number): [number, number] => (axis === 'z' ? [c + d, a] : [a, c + d]);

// UVs into the asphalt atlas: the road cross-section, a clean column for junction boxes, and
// the sealed column for lots and driveways.
const roadUV = (axis: Axis, c: number): UVFn => (x, _y, z) => {
    const d = axis === 'z' ? x - c : z - c, a = axis === 'z' ? z : x;
    return [ROAD_ATLAS_ROAD_U * (d + HALF) / (2 * HALF), a / ROAD_ATLAS_LENGTH];
};
const junctionUV: UVFn = (x, _y, z) => [ROAD_ATLAS_ROAD_U * (HALF + 0.45) / (2 * HALF), (x + z) / ROAD_ATLAS_LENGTH];
export const lotUV: UVFn = (x, _y, z) => [ROAD_ATLAS_LOT_U, (0.7 * x + 0.3 * z) / ROAD_ATLAS_LENGTH];
export const paintUV = (c: keyof typeof PAINT_U): UVFn => () => [PAINT_U[c], 0.5];

/** Layers being built; `finish` turns them into meshes (one per material). */
export function createGroundLayers(ctx: WorldContext) {
    const asphalt = new GeoBuilder(), concrete = new GeoBuilder(), paint = new GeoBuilder(), grass = new GeoBuilder();
    const finish = (parent: THREE.Object3D = ctx.scene) => {
        const add = (b: GeoBuilder, mat: THREE.Material, cast: boolean) => {
            if (b.empty) return;
            const m = new THREE.Mesh(b.build(), mat);
            m.receiveShadow = true; m.castShadow = cast;
            parent.add(m);
            if (parent === ctx.scene) ctx.environmentDisposables.push(m);
        };
        add(asphalt, ctx.ground.asphalt, false);
        add(concrete, ctx.ground.concrete, false);
        add(paint, ctx.ground.paint, false);
        add(grass, ctx.ground.lawn, false);
    };
    return { asphalt, concrete, paint, grass, finish };
}
export type GroundLayers = ReturnType<typeof createGroundLayers>;

type Rect = [number, number, number, number]; // x0, z0, x1, z1
const inRects = (x: number, z: number, rects: Rect[], pad = 0) => rects.some(([x0, z0, x1, z1]) => x > x0 - pad && x < x1 + pad && z > z0 - pad && z < z1 + pad);

/** Builds the streets of the sample area: the main road from the lot's junction (z=200) to z=545. */
export function buildStreetscape(ctx: WorldContext) {
    const L = createGroundLayers(ctx);
    const rand = seededRandom(424242);

    // Footprints of buildings and parks next to the streets (trees and lamps keep clear)
    const occupied: Rect[] = [
        [-100, 210, -20, 270], [-21, 226, -15, 239], // auction house and its side entrance canopy
        [29, 313, 67, 347], [35, 258, 70, 292], [-66, 343, -30, 377], [-67, 268, -30, 302], // towers incl. entrance canopies
        [-56, 330, -34, 342], [-63, 389, -37, 411], [-56, 451, -34, 469], [37, 460, 63, 480], [34, 536, 56, 554], // pocket parks
    ];
    // Where a park's own lawn and kerb reach into a sidewalk band's back lawn
    const parkEdges: Rect[] = [[36.8, 459.8, 63.2, 480.2]];

    // ---- Road segments between junctions ----
    const segment = (axis: Axis, c: number, from: number, to: number, e0: End, e1: End) => {
        L.asphalt.flat([W(axis, c, from, -HALF), W(axis, c, to, -HALF), W(axis, c, to, HALF), W(axis, c, from, HALF)], Y.road, roadUV(axis, c));
        const p = (a0: number, a1: number, d0: number, d1: number, col: keyof typeof PAINT_U = 'white', y = Y.paint) => {
            if (a1 - a0 < 0.01) return;
            L.paint.flat([W(axis, c, a0, d0), W(axis, c, a1, d0), W(axis, c, a1, d1), W(axis, c, a0, d1)], y, paintUV(col));
        };
        const s0 = from + (e0 === 'junction' ? STOP1 : 0), s1 = to - (e1 === 'junction' ? STOP1 : 0);
        // double yellow centre line
        for (const sgn of [-1, 1]) p(s0, s1, sgn * YEL - YEL_W / 2, sgn * YEL + YEL_W / 2, 'yellow');
        // dashed lane lines, in step with the world grid so segments line up
        for (let k = Math.floor(s0 / PERIOD); k * PERIOD < s1; k++) {
            const a0 = Math.max(s0, k * PERIOD), a1 = Math.min(s1, k * PERIOD + DASH);
            for (const sgn of [-1, 1]) p(a0, a1, sgn * LANE - LANE_W / 2, sgn * LANE + LANE_W / 2);
        }
        // edge lines up to the crosswalks
        const c0 = from + (e0 === 'junction' ? CW1 : 0), c1 = to - (e1 === 'junction' ? CW1 : 0);
        for (const sgn of [-1, 1]) p(c0, c1, sgn * EDGE - EDGE_W / 2, sgn * EDGE + EDGE_W / 2);
        // crosswalks (continental bars) and the stop line on the approaching side
        // (traffic keeps right: heading toward smaller `a` on a z road means x > 0)
        const approach = (atFrom: boolean) => {
            const dir = atFrom ? 1 : -1, base = atFrom ? from : to;
            const side = (axis === 'z') === atFrom ? 1 : -1;
            const [cwA, cwB] = [base + dir * CW0, base + dir * CW1].sort((x, y) => x - y);
            for (let k = 0; k < 20; k++) { const d = -11.4 + k * 1.2; p(cwA, cwB, d - 0.3, d + 0.3); }
            const [stA, stB] = [base + dir * STOP0, base + dir * STOP1].sort((x, y) => x - y);
            const [dA, dB] = [side * (YEL + YEL_W / 2), side * (EDGE + EDGE_W / 2)].sort((x, y) => x - y);
            p(stA, stB, dA, dB);
        };
        if (e0 === 'junction') approach(true);
        if (e1 === 'junction') approach(false);
        // storm drains at the gutters and the odd manhole cover in the lanes
        for (let a = Math.ceil((from + 12) / 45) * 45 + 7; a < to - 12; a += 45) {
            for (const sgn of [-1, 1]) p(a, a + 0.95, sgn * (HALF - 0.52), sgn * (HALF - 0.05), 'dark', Y.drain);
        }
        for (let a = Math.ceil((from + 15) / 70) * 70 + 31; a < to - 15; a += 70) {
            const d = (Math.round(a / 70) % 2 ? 1 : -1) * 1.99, [mx, mz] = W(axis, c, a, d);
            L.paint.flat(Array.from({ length: 12 }, (_, i) => [mx + 0.38 * Math.cos(i * Math.PI / 6), mz + 0.38 * Math.sin(i * Math.PI / 6)] as [number, number]), Y.drain, paintUV('dark'));
        }
    };

    // ---- Kerbs and gutters along a road side (straight runs) ----
    const kerb = (axis: Axis, c: number, sgn: number, a0: number, a1: number, capA0 = false, capA1 = false) => {
        if (a1 - a0 < 0.01) return;
        const q = (d0: number, d1: number, y: number, b: GeoBuilder) => b.flat([W(axis, c, a0, sgn * d0), W(axis, c, a1, sgn * d0), W(axis, c, a1, sgn * d1), W(axis, c, a0, sgn * d1)], y);
        q(HALF, HALF + CURB, Y.curb, L.concrete);
        q(HALF - GUTTER, HALF, Y.gutter, L.concrete);
        const [x0, z0] = W(axis, c, a0, sgn * HALF), [x1, z1] = W(axis, c, a1, sgn * HALF);
        L.concrete.wall(x0, z0, x1, z1, Y.road, Y.curb, axis === 'z' ? -sgn : 0, axis === 'x' ? -sgn : 0);
        const cap = (a: number, dir: number) => {
            const [px, pz] = W(axis, c, a, sgn * HALF), [qx, qz] = W(axis, c, a, sgn * (HALF + CURB));
            L.concrete.wall(px, pz, qx, qz, Y.road, Y.curb, axis === 'x' ? dir : 0, axis === 'z' ? dir : 0);
        };
        if (capA0) cap(a0, -1);
        if (capA1) cap(a1, 1);
    };

    // ---- Sidewalk band along a road side ----
    const band = (axis: Axis, c: number, sgn: number, a0: number, a1: number, e0: BandEnd, e1: BandEnd) => {
        const gap = (e: BandEnd) => (e === 'corner' ? 2 : e === 'apron' ? 8 : 0);
        const l0 = a0 + gap(e0), l1 = a1 - gap(e1);
        const rect = (b: GeoBuilder, aa: number, ab: number, d0: number, d1: number, y: number) => {
            if (ab - aa < 0.01) return;
            b.flat([W(axis, c, aa, sgn * d0), W(axis, c, ab, sgn * d0), W(axis, c, ab, sgn * d1), W(axis, c, aa, sgn * d1)], y);
        };
        // full-width paving at the band's ends, then lawn | sidewalk | lawn
        rect(L.concrete, a0, l0, HALF + CURB, BAND, Y.walk);
        rect(L.concrete, l1, a1, HALF + CURB, BAND, Y.walk);
        rect(L.concrete, l0, l1, WALK[0], WALK[1], Y.walk);
        rect(L.grass, l0, l1, LAWN1[0], LAWN1[1], Y.lawn);
        // back lawn and slope, left out where a park's own lawn takes over
        const cuts: [number, number][] = [];
        parkEdges.forEach(([x0, z0, x1, z1]) => {
            const [px, pz] = W(axis, c, (l0 + l1) / 2, sgn * (LAWN2[0] + 0.5));
            if (axis === 'x' ? (pz > z0 && pz < z1) : (px > x0 && px < x1)) cuts.push(axis === 'x' ? [x0, x1] : [z0, z1]);
        });
        const spans: [number, number][] = [];
        let cur = a0;
        cuts.sort((p, q) => p[0] - q[0]).forEach(([u0, u1]) => { if (u0 > cur) spans.push([cur, Math.min(u0, a1)]); cur = Math.max(cur, u1); });
        if (cur < a1) spans.push([cur, a1]);
        spans.forEach(([s0, s1]) => {
            rect(L.grass, Math.max(s0, l0), Math.min(s1, l1), LAWN2[0], LAWN2[1], Y.lawn);
            // grass slope, mitred at corners so it meets the cross street's slope
            const m0 = s0 === a0 && e0 === 'corner' ? BERM : 0, m1 = s1 === a1 && e1 === 'corner' ? BERM : 0;
            L.grass.band([W(axis, c, s0, sgn * BAND), W(axis, c, s1, sgn * BAND)], Y.lawn, [W(axis, c, s0 + m0, sgn * (BAND + BERM)), W(axis, c, s1 - m1, sgn * (BAND + BERM))], 0);
            // walk edge where the park takes over
            if (s0 !== a0 || s1 !== a1) {
                for (const a of [s0, s1]) if (a !== a0 && a !== a1) {
                    const [px, pz] = W(axis, c, a, sgn * BAND), [qx, qz] = W(axis, c, a, sgn * (BAND + BERM));
                    L.grass.poly([[px, Y.lawn, pz], [qx, 0, qz], [px, 0, pz]], axis === 'x' ? [a === s0 ? -1 : 1, 0, 0] : [0, 0, a === s0 ? -1 : 1]);
                }
            }
        });
        // apron ends: the band's side faces toward the driveway apron
        const apronEnd = (a: number, dir: number) => {
            const n: [number, number] = axis === 'x' ? [dir, 0] : [0, dir];
            const [px, pz] = W(axis, c, a, sgn * (HALF + CURB)), [qx, qz] = W(axis, c, a, sgn * BAND), [bx, bz] = W(axis, c, a, sgn * (BAND + BERM));
            L.concrete.wall(px, pz, qx, qz, Y.apron, Y.walk, n[0], n[1]);
            L.grass.poly([[qx, Y.lawn, qz], [bx, 0, bz], [qx, 0, qz]], [n[0], 0, n[1]]);
        };
        if (e0 === 'apron') apronEnd(a0, -1);
        if (e1 === 'apron') apronEnd(a1, 1);
        return { lawnFrom: l0, lawnTo: l1 };
    };

    // ---- Junction box, rounded corners, corner plazas ----
    const ARC = 8;
    const junction = (jx: number, jz: number, corners: [number, number][]) => {
        L.asphalt.rect(jx - HALF, jz - HALF, jx + HALF, jz + HALF, Y.road, junctionUV);
        corners.forEach(([sx, sz]) => {
            const P: [number, number] = [jx + sx * HALF, jz + sz * HALF];
            const C: [number, number] = [jx + sx * (HALF + R), jz + sz * (HALF + R)];
            const dir = (t: number): [number, number] => [-sx * Math.cos(t * Math.PI / 2), -sz * Math.sin(t * Math.PI / 2)];
            const arc = (r: number) => Array.from({ length: ARC + 1 }, (_, i) => { const [vx, vz] = dir(i / ARC); return [C[0] + r * vx, C[1] + r * vz] as [number, number]; });
            const outer = arc(R), inner = arc(R - CURB);
            L.asphalt.flat([P, ...outer], Y.road, junctionUV);                       // fillet of road in the corner
            const F: [number, number] = [P[0] + sx * CORNER, P[1] + sz * CORNER];
            L.concrete.flat([F, [F[0], P[1]], ...[...outer].reverse(), [P[0], F[1]]], Y.walk); // corner plaza
            for (let i = 0; i < ARC; i++) {                                         // kerb along the arc
                L.concrete.flat([outer[i], outer[i + 1], inner[i + 1], inner[i]], Y.curb);
                const [vx, vz] = dir((i + 0.5) / ARC);
                L.concrete.wall(outer[i][0], outer[i][1], outer[i + 1][0], outer[i + 1][1], Y.road, Y.curb, vx, vz);
            }
        });
    };

    // ---- Lights, trees, shrubs ----
    const LAMP_D = HALF + CURB + 0.45;
    const lamps: { axis: Axis; c: number; sgn: number; a: number }[] = [];
    const lamp = (axis: Axis, c: number, sgn: number, a: number) => {
        const [x, z] = W(axis, c, a, sgn * LAMP_D);
        const [tx, tz] = W(axis, c, a, 0);
        const len = Math.hypot(tx - x, tz - z);
        ctx.lamps.add('street', x, z, (tx - x) / len, (tz - z) / len, Y.road);
        lamps.push({ axis, c, sgn, a });
    };
    const nearLamp = (axis: Axis, c: number, sgn: number, a: number, r: number) => lamps.some(l => l.axis === axis && l.c === c && l.sgn === sgn && Math.abs(l.a - a) < r);
    const plant = (kind: PlantKind, x: number, z: number, scale = 1) => { if (!inRects(x, z, occupied, 2)) ctx.plants.add(kind, x, z, rand, scale); };
    const streetTrees = (axis: Axis, c: number, sgn: number, l0: number, l1: number, spacing = 14) => {
        for (let a = l0 + 3; a <= l1 - 3; a += spacing) {
            const aa = a + (rand() - 0.5) * 2;
            if (nearLamp(axis, c, sgn, aa, 6.5)) continue;
            const [x, z] = W(axis, c, aa, sgn * ((LAWN1[0] + LAWN1[1]) / 2 + (rand() - 0.5) * 0.3));
            plant(rand() < 0.5 ? 'broadleaf' : 'roundleaf', x, z, 0.95 + rand() * 0.2);
        }
    };
    const shrubs = (axis: Axis, c: number, sgn: number, l0: number, l1: number) => {
        for (let a = l0 + 2; a <= l1 - 2; a += 13 + rand() * 7) {
            const n = 1 + Math.floor(rand() * 2);
            for (let i = 0; i < n; i++) {
                const [x, z] = W(axis, c, a + i * 1.6 + rand() * 0.4, sgn * (LAWN2[0] + 0.9 + rand() * 0.9));
                if (inRects(x, z, parkEdges)) continue;
                plant('bush', x, z, 0.8 + rand() * 0.45);
            }
        }
    };
    const backTrees = (axis: Axis, c: number, sgn: number, a0: number, a1: number) => {
        for (let a = a0 + 4; a < a1 - 4; a += 13 + rand() * 9) {
            const [x, z] = W(axis, c, a, sgn * (26 + rand() * 4));
            plant(rand() < 0.45 ? 'conifer' : rand() < 0.5 ? 'broadleaf' : 'roundleaf', x, z, 0.95 + rand() * 0.35);
        }
    };

    // ================= The sample: junction at z=200, main road, junction at z=500 =================
    // Junction 1 (0, 200): main road north, cross street east/west, the dealership driveway south.
    junction(0, 200, [[1, 1], [-1, 1]]);
    L.concrete.rect(-15, 200 - BAND, 15, 200 - HALF, Y.apron);                 // flush driveway crossing
    segment('x', 200, -52.5, -HALF, 'open', 'junction');
    segment('x', 200, HALF, 52.5, 'junction', 'open');
    kerb('x', 200, 1, -52.5, -HALF - R); kerb('x', 200, -1, -52.5, -15, false, true);
    kerb('x', 200, 1, HALF + R, 52.5); kerb('x', 200, -1, 15, 52.5, true, false);
    // (the north side of the west stub lies inside the auction house)
    const s4n = band('x', 200, 1, BAND, 52.5, 'corner', 'open');
    const s3s = band('x', 200, -1, -52.5, -15, 'open', 'apron');
    const s4s = band('x', 200, -1, 15, 52.5, 'apron', 'open');

    // Main road between the junctions
    segment('z', 0, 200 + HALF, 500 - HALF, 'junction', 'junction');
    kerb('z', 0, 1, 200 + HALF + R, 500 - HALF - R); kerb('z', 0, -1, 200 + HALF + R, 500 - HALF - R);
    const s1e = band('z', 0, 1, 200 + BAND, 500 - BAND, 'corner', 'corner');
    const s1w = band('z', 0, -1, 200 + BAND, 500 - BAND, 'corner', 'corner');

    // Junction 2 (0, 500): four ways
    junction(0, 500, [[1, 1], [-1, 1], [1, -1], [-1, -1]]);
    segment('z', 0, 500 + HALF, 545, 'junction', 'open');
    segment('x', 500, -52.5, -HALF, 'open', 'junction');
    segment('x', 500, HALF, 52.5, 'junction', 'open');
    for (const sgn of [-1, 1]) {
        kerb('z', 0, sgn, 500 + HALF + R, 545);
        kerb('x', 500, sgn, -52.5, -HALF - R);
        kerb('x', 500, sgn, HALF + R, 52.5);
    }
    const s2 = [1, -1].map(sgn => ({ sgn, b: band('z', 0, sgn, 500 + BAND, 545, 'corner', 'open') }));
    const s5 = [1, -1].map(sgn => ({ sgn, b: band('x', 500, sgn, -52.5, -BAND, 'open', 'corner') }));
    const s6 = [1, -1].map(sgn => ({ sgn, b: band('x', 500, sgn, BAND, 52.5, 'corner', 'open') }));

    // Street lights: staggered along the main road, one per cross-street side near the junctions
    [246, 291, 336, 381, 426, 471].forEach(a => lamp('z', 0, -1, a));
    [254, 299, 344, 389, 434, 466].forEach(a => lamp('z', 0, 1, a));
    lamp('x', 200, 1, 38); lamp('x', 200, -1, -34); lamp('x', 200, -1, 34);
    s5.forEach(({ sgn }) => lamp('x', 500, sgn, -38));
    s6.forEach(({ sgn }) => lamp('x', 500, sgn, 38));
    s2.forEach(({ sgn }) => lamp('z', 0, sgn, 534));

    // Street trees in the tree lawns, shrubs in the back lawns, a few trees behind
    streetTrees('z', 0, 1, s1e.lawnFrom, s1e.lawnTo);
    streetTrees('z', 0, -1, s1w.lawnFrom, s1w.lawnTo);
    streetTrees('x', 200, 1, s4n.lawnFrom, s4n.lawnTo);
    streetTrees('x', 200, -1, s3s.lawnFrom, s3s.lawnTo);
    streetTrees('x', 200, -1, s4s.lawnFrom, s4s.lawnTo);
    [...s2.map(s => ['z', 0, s] as const), ...s5.map(s => ['x', 500, s] as const), ...s6.map(s => ['x', 500, s] as const)]
        .forEach(([axis, c, { sgn, b }]) => streetTrees(axis, c, sgn, b.lawnFrom, b.lawnTo));
    shrubs('z', 0, 1, s1e.lawnFrom, s1e.lawnTo);
    shrubs('z', 0, -1, s1w.lawnFrom, s1w.lawnTo);
    shrubs('x', 200, -1, s4s.lawnFrom, s4s.lawnTo);
    shrubs('x', 200, -1, s3s.lawnFrom, s3s.lawnTo);
    s6.forEach(({ sgn, b }) => shrubs('x', 500, sgn, b.lawnFrom, b.lawnTo));
    backTrees('z', 0, 1, 222, 478);
    backTrees('z', 0, -1, 222, 478);
    backTrees('x', 200, -1, 18, 52);

    L.finish();
}

/** The sample's footprint: old roads, sidewalks, lamps and trees are left out here. */
export const STREETSCAPE_SAMPLE = { x0: -52.5, x1: 52.5, z0: 177.5, z1: 545, mainRoadHalfWidth: 35 };
