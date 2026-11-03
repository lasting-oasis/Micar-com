import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, uvIn, swatchUV, type Rect, type Swatch } from './carAtlas';

// Procedural car bodies. Every body style is described by a few profile curves
// (bottom, shoulder line, plan shape, wheel arches, greenhouse), and the mesh is
// built from cross-sections along the car (a loft), so the surfaces are smoothly
// curved and the wheel arches are real openings. Lamps, grilles and plates are
// thin patches projected onto the body. Built once per style and shared by every
// car of that style; only the paint material differs per car.
//
// Car space: nose toward -Z (the direction the game drives), +X = right, +Y up,
// about 2 world units per metre.

export type V2 = [number, number];
export type V3 = [number, number, number];
export const PAINT = 0, TRIM = 1, GLASS = 2;

type Route = { slot: number; uv: (p: V3, n: V3) => V2 };
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const flatUV = (s: Swatch) => { const uv = swatchUV(s); return () => uv; };
const ZERO_UV = (): V2 => [0, 0];
const R_PAINT: Route = { slot: PAINT, uv: ZERO_UV };
const R_GLASS: Route = { slot: GLASS, uv: (p) => [p[2] * 0.35, p[1] * 0.35] };
const trim = (s: Swatch): Route => ({ slot: TRIM, uv: flatUV(s) });

// ---------------------------------------------------------------------------------
// Triangle soup with a material slot per triangle; normals are worked out at the end
// (smooth across gentle bends, sharp at creases).
class Soup {
    p: number[] = []; uv: number[] = []; slot: number[] = [];
    tri(a: V3, b: V3, c: V3, r: Route, uvs?: [V2, V2, V2]) {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l2 = nx * nx + ny * ny + nz * nz;
        if (l2 < 1e-14) return; // degenerate
        const l = Math.sqrt(l2), n: V3 = [nx / l, ny / l, nz / l];
        this.p.push(...a, ...b, ...c);
        const [ua, ub, uc] = uvs ?? [r.uv(a, n), r.uv(b, n), r.uv(c, n)];
        this.uv.push(...ua, ...ub, ...uc);
        this.slot.push(r.slot);
    }
    /** Triangle wound so its front faces `facing`. */
    triF(a: V3, b: V3, c: V3, facing: V3, r: Route, uvs?: [V2, V2, V2]) {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const d = (uy * vz - uz * vy) * facing[0] + (uz * vx - ux * vz) * facing[1] + (ux * vy - uy * vx) * facing[2];
        if (d >= 0) this.tri(a, b, c, r, uvs); else this.tri(a, c, b, r, uvs ? [uvs[0], uvs[2], uvs[1]] : undefined);
    }
    quadF(a: V3, b: V3, c: V3, d: V3, facing: V3, r: Route, uvs?: [V2, V2, V2, V2]) {
        this.triF(a, b, c, facing, r, uvs ? [uvs[0], uvs[1], uvs[2]] : undefined);
        this.triF(a, c, d, facing, r, uvs ? [uvs[0], uvs[2], uvs[3]] : undefined);
    }
}

class Out { p: number[] = []; n: number[] = []; uv: number[] = []; }

/** Smooth normals across edges bent less than `creaseDeg`, then sort triangles into slots. */
function flush(soup: Soup, creaseDeg: number, outs: Out[]) {
    const P = soup.p, nT = P.length / 9;
    const fn = new Float32Array(nT * 3), fw = new Float32Array(nT * 3);
    for (let t = 0; t < nT; t++) {
        const o = t * 9;
        const ux = P[o + 3] - P[o], uy = P[o + 4] - P[o + 1], uz = P[o + 5] - P[o + 2];
        const vx = P[o + 6] - P[o], vy = P[o + 7] - P[o + 1], vz = P[o + 8] - P[o + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        fw[t * 3] = nx; fw[t * 3 + 1] = ny; fw[t * 3 + 2] = nz;
        fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l;
    }
    const key = (i: number) => `${Math.round(P[i] * 1e4)},${Math.round(P[i + 1] * 1e4)},${Math.round(P[i + 2] * 1e4)}`;
    const map = new Map<string, number[]>();
    for (let t = 0; t < nT; t++) for (let v = 0; v < 3; v++) {
        const k = key(t * 9 + v * 3); let l = map.get(k); if (!l) map.set(k, l = []); l.push(t);
    }
    const cosC = Math.cos(creaseDeg * Math.PI / 180);
    for (let t = 0; t < nT; t++) {
        const out = outs[soup.slot[t]];
        for (let v = 0; v < 3; v++) {
            const i = t * 9 + v * 3;
            let sx = 0, sy = 0, sz = 0;
            for (const s of map.get(key(i))!) {
                if (fn[s * 3] * fn[t * 3] + fn[s * 3 + 1] * fn[t * 3 + 1] + fn[s * 3 + 2] * fn[t * 3 + 2] >= cosC) {
                    sx += fw[s * 3]; sy += fw[s * 3 + 1]; sz += fw[s * 3 + 2];
                }
            }
            const l = Math.hypot(sx, sy, sz) || 1;
            out.p.push(P[i], P[i + 1], P[i + 2]);
            out.n.push(sx / l, sy / l, sz / l);
            out.uv.push(soup.uv[t * 6 + v * 2], soup.uv[t * 6 + v * 2 + 1]);
        }
    }
}

function toGeometry(o: Out, withUV: boolean): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(o.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(o.n, 3));
    if (withUV) g.setAttribute('uv', new THREE.Float32BufferAttribute(o.uv, 2));
    const m = mergeVertices(g, 1e-4);
    g.dispose();
    m.computeBoundingBox(); m.computeBoundingSphere();
    return m;
}

// ---------------------------------------------------------------------------------
/** Monotone cubic interpolation through knots (no overshoot). */
export class Curve {
    private xs: number[]; private ys: number[]; private ms: number[];
    constructor(knots: V2[]) {
        this.xs = knots.map(k => k[0]); this.ys = knots.map(k => k[1]);
        const n = knots.length, d: number[] = [], m = new Array(n).fill(0);
        for (let i = 0; i < n - 1; i++) d.push((this.ys[i + 1] - this.ys[i]) / (this.xs[i + 1] - this.xs[i]));
        if (n > 1) {
            m[0] = d[0]; m[n - 1] = d[n - 2];
            for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
            for (let i = 0; i < n - 1; i++) {
                if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
                const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
                if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
            }
        }
        this.ms = m;
    }
    at(x: number): number {
        const { xs, ys, ms } = this, n = xs.length;
        if (x <= xs[0]) return ys[0];
        if (x >= xs[n - 1]) return ys[n - 1];
        let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
        const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * ms[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * ms[i + 1];
    }
}

/** Where the greenhouse changes what it is made of, front to back (applies until the next mark). */
export type GhMark = {
    z: number;
    zone: 'ws' | 'roof' | 'bl' | 'back' | 'backGlass'; // what the top surface is: windscreen, roof, rear glass ...
    side: 'glass' | 'b' | 'c';                         // side window glass, black B-pillar, or painted C-pillar
    slant?: number;                                    // move the bottom of the side back by this much (slanted pillar edge)
};
/** Greenhouse (cabin glass and pillars): from the windscreen base to the rear glass base. */
export type GhSpec = {
    roof: Curve;   // height of the roof / glass at the centre line, by z (at or below the shoulder at both ends)
    rail: Curve;   // half-width at the roof rail
    plan: Curve;   // plan curvature: centre ahead of the corners by this much (windscreen +, rear glass -)
    marks: GhMark[];
};

export interface BodySpec {
    noseZ: number; tailZ: number; hw: number;      // ends, half of the body width
    front: { bulge: number; x0: number };          // plan shape: centre bulge, where the corner rounding starts
    rear: { bulge: number; x0: number };
    wheelR: number; tyreW: number; rimR: number; wheelX: number; axles: [number, number];
    archR: number; archY: number; archP: number;   // arch radius, centre height, roundness (2 = round, 3+ = squarer)
    bottom: Curve; shoulder: Curve; crown: Curve;  // by z: underbody height, top of the sides, crown of hood/deck
    widest: number;                                // height of the widest point, as a fraction of the side
    tumble: number; rS: number; rL: number; rLip: number; sillIn: number; ledge: number; wellDepth: number;
    cabin: [number, number];                       // z range under the greenhouse (interior)
    bed?: { z0: number; z1: number; floorY: number; railW: number };
    flare?: number;                                // black plastic band around the wheel arches
    railR: number; roofCrown: number;
    gh: GhSpec;
}

// ---------------------------------------------------------------------------------
// Lower body cross-section: 13 points from the bottom centre round the right side to
// the top centre (mirrored for the left side).
//  0 bottom centre · 1-2 inner wall of the wheel well · 3-4 rocker / arch lip ·
//  5 widest point (or a flare's top edge) · 6-8 shoulder · 9-12 top (hood, deck) or the open bed (U shape)
type Mode = { arch?: 'in' | 'out'; top?: 'crown' | 'bed' };

const planHW = (bulge: number, x0: number, hwMax: number, d: number) => {
    if (d <= 0) return bulge > 0 ? 0 : x0;
    const Rp = hwMax - x0;
    if (bulge > 0 && d < bulge) return x0 * Math.sqrt(d / bulge);
    const e = d - bulge;
    if (e >= Rp) return hwMax;
    return x0 + Math.sqrt(Math.max(0, Rp * Rp - (Rp - e) ** 2));
};
export const halfWidthAt = (s: BodySpec, z: number) =>
    Math.min(planHW(s.front.bulge, s.front.x0, s.hw, z - s.noseZ), planHW(s.rear.bulge, s.rear.x0, s.hw, s.tailZ - z));

export function lowerSection(s: BodySpec, z: number, mode: Mode = {}): V2[] {
    const hw = halfWidthAt(s, z);
    const k = Math.min(1, hw / 0.9); // insets shrink toward the nose / tail tip
    const yB = s.bottom.at(z);
    const yS = s.shoulder.at(z);
    const crown = s.crown.at(z) * k;
    const se = (u: number) => Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, u), s.archP)), 1 / s.archP);
    let yA = yB, yFlare = -1;
    for (const zc of s.axles) {
        const dz = Math.abs(z - zc);
        const inside = mode.arch === 'in' ? dz <= s.archR + 1e-6 : mode.arch === 'out' ? false : dz < s.archR - 1e-6;
        if (inside) yA = Math.max(yA, s.archY + s.archR * se(dz / s.archR));
        // top edge of the black flare: the arch outline grown by the flare width
        if (s.flare && dz < s.archR + s.flare) yFlare = Math.max(yFlare, s.archY + (s.archR + s.flare) * se(dz / (s.archR + s.flare)));
    }
    const inArch = yA > yB + 1e-4;
    const rL = (inArch ? s.rLip : s.rL) * k, tumble = s.tumble * k, sillIn = s.sillIn * k;
    const yLow = yA + rL;
    const rS = Math.max(0.01, Math.min(s.rS * k, (yS - yLow) * 0.45));
    // The side is one smooth curve x(y): widest at yW, tucking in toward the sill and
    // the shoulder. Every section's side points lie on it, so the arches cut into the
    // same surface instead of reshaping it.
    const yW = yB + s.widest * (yS - yB);
    const sideAt = (y: number) => y < yW
        ? hw - sillIn * ((yW - y) / Math.max(1e-6, yW - yB)) ** 2
        : hw - tumble * Math.min(1, (y - yW) / Math.max(1e-6, yS - yW)) ** 2;
    let y6: number;
    if (yFlare > 0) y6 = Math.min(Math.max(yFlare, yLow + 0.03), yS - rS - 0.03); // point 5 = the flare's top edge
    else { y6 = yW; if (y6 < yLow + 0.03 || y6 > yS - rS - 0.03) y6 = (yLow + yS - rS) / 2; }
    const x4 = sideAt(yLow), x6 = sideAt(yS - rS);
    const xw = Math.max(0, hw - s.wellDepth);
    const P: V2[] = [
        [0, yB],
        [xw, yB],
        [xw, yA],
        [Math.max(xw, x4 - rL), yA],
        [x4, yLow],
        [sideAt(y6), y6],
        [x6, yS - rS],
        [x6 - rS * 0.293, yS - rS * 0.293],
        [x6 - rS, yS],
    ];
    const x9 = P[8][0];
    const top = mode.top ?? (s.bed && z > s.bed.z0 && z < s.bed.z1 ? 'bed' : 'crown');
    if (top === 'bed' && s.bed) {
        const xi = Math.max(0, x9 - s.bed.railW);
        P.push([xi, yS - 0.015], [xi, s.bed.floorY + 0.06], [Math.max(0, xi - 0.06), s.bed.floorY], [0, s.bed.floorY]);
    } else {
        const xl = Math.max(0, x9 - s.ledge * k);
        const yt = (x: number) => yS + crown * (1 - (x / Math.max(1e-6, x9)) ** 2);
        P.push([xl, yt(xl)], [x9 * 0.55, yt(x9 * 0.55)], [x9 * 0.2, yt(x9 * 0.2)], [0, yS + crown]);
    }
    return P;
}

type Sample = { z: number; mode: Mode };
function lowerSamples(s: BodySpec): Sample[] {
    const special: Sample[] = [];
    const plain: number[] = [];
    const ends = (bulge: number, x0: number, from: number, dir: number) => {
        const Rp = s.hw - x0;
        if (bulge > 0) for (let i = 0; i <= 3; i++) plain.push(from + dir * bulge * (i / 3) ** 2);
        else plain.push(from);
        for (let a = 15; a <= 90; a += 15) plain.push(from + dir * (bulge + Rp * (1 - Math.cos(a * Math.PI / 180))));
    };
    ends(s.front.bulge, s.front.x0, s.noseZ, 1);
    ends(s.rear.bulge, s.rear.x0, s.tailZ, -1);
    for (const zc of s.axles) {
        special.push({ z: zc - s.archR, mode: { arch: 'out' } }, { z: zc - s.archR, mode: { arch: 'in' } });
        for (let i = 1; i < 10; i++) plain.push(zc - s.archR * Math.cos(i * Math.PI / 10));
        special.push({ z: zc + s.archR, mode: { arch: 'in' } }, { z: zc + s.archR, mode: { arch: 'out' } });
        if (s.flare) plain.push(zc - s.archR - s.flare, zc + s.archR + s.flare);
    }
    plain.push(s.cabin[0], s.cabin[1]);
    if (s.bed) special.push({ z: s.bed.z0, mode: { top: 'crown' } }, { z: s.bed.z0, mode: { top: 'bed' } },
        { z: s.bed.z1, mode: { top: 'bed' } }, { z: s.bed.z1, mode: { top: 'crown' } });
    // the ends close the body: always keep them; drop other samples that nearly repeat one
    const all: Sample[] = [...special, { z: s.noseZ, mode: {} }, { z: s.tailZ, mode: {} }];
    const near = (z: number) => all.some(o => Math.abs(o.z - z) < 0.006);
    for (const z of plain.sort((a, b) => a - b)) if (z > s.noseZ && z < s.tailZ && !near(z)) all.push({ z, mode: {} });
    all.sort((a, b) => a.z - b.z);
    // no long gaps (the hood and deck curve)
    const out: Sample[] = [];
    for (let i = 0; i < all.length; i++) {
        out.push(all[i]);
        const next = all[i + 1];
        if (!next) break;
        const gap = next.z - all[i].z, n = Math.ceil(gap / 0.8);
        for (let j = 1; j < n; j++) out.push({ z: all[i].z + gap * j / n, mode: {} });
    }
    return out;
}

function lowerRoute(s: BodySpec, a: Sample, b: Sample, seg: number, bedUV: Route['uv']): Route | null {
    const isStep = Math.abs(a.z - b.z) < 1e-6;
    const zm = (a.z + b.z) / 2;
    const nearArch = (m: number) => s.axles.some(zc => Math.abs(zm - zc) < s.archR + m);
    const inCabin = zm > s.cabin[0] && zm < s.cabin[1];
    const bed = s.bed;
    const inBed = !!bed && ((zm > bed.z0 && zm < bed.z1) || (isStep && (Math.abs(zm - bed.z0) < 1e-6 || Math.abs(zm - bed.z1) < 1e-6)));
    switch (seg) {
        case 0: return null;                                   // underbody (never seen)
        case 1: return trim('under');                          // inner wall of the wheel well
        case 2: return isStep ? trim('under') : null;          // ends of the wheel well (its ceiling is never seen)
        case 3: case 4: return s.flare && nearArch(s.flare) ? trim('blackMatte') : R_PAINT;
        case 5: case 6: case 7: case 8: return R_PAINT;
        default:
            if (inBed) return { slot: TRIM, uv: bedUV };
            if (inCabin) return trim('interior');             // floor of the cabin at the belt line
            return R_PAINT;
    }
}

function buildLower(s: BodySpec, soup: Soup) {
    const samples = lowerSamples(s);
    const secs = samples.map(sm => lowerSection(s, sm.z, sm.mode));
    const bed = s.bed;
    const bedUV: Route['uv'] = (p, n) => {
        if (!bed) return [0, 0];
        const v = clamp01((p[2] - bed.z0) / (bed.z1 - bed.z0));
        if (Math.abs(n[1]) > 0.7) return uvIn(CELL.bed, clamp01(0.5 + p[0] / (2 * s.hw)), v);
        if (Math.abs(n[0]) > 0.7) return uvIn(CELL.bed, clamp01((p[1] - bed.floorY) / 1.4), v);
        return uvIn(CELL.bed, clamp01(0.5 + p[0] / (2 * s.hw)), clamp01((p[1] - bed.floorY) / 1.4));
    };
    for (let k = 0; k < samples.length - 1; k++) {
        const A = secs[k], B = secs[k + 1], za = samples[k].z, zb = samples[k + 1].z;
        for (let i = 0; i < A.length - 1; i++) {
            const r = lowerRoute(s, samples[k], samples[k + 1], i, bedUV);
            if (!r) continue;
            for (const sd of [1, -1]) {
                const a0: V3 = [A[i][0] * sd, A[i][1], za], a1: V3 = [A[i + 1][0] * sd, A[i + 1][1], za];
                const b0: V3 = [B[i][0] * sd, B[i][1], zb], b1: V3 = [B[i + 1][0] * sd, B[i + 1][1], zb];
                if (sd > 0) { soup.tri(a0, a1, b0, r); soup.tri(a1, b1, b0, r); }
                else { soup.tri(a0, b0, a1, r); soup.tri(a1, b0, b1, r); }
            }
        }
    }
    // flat ends (truck nose, tailgate): fill the end section
    const cap = (P: V2[], z: number, dir: number) => {
        const loop: V2[] = [...P, ...P.slice(1, -1).reverse().map(([x, y]) => [-x, y] as V2)];
        const cy = (P[0][1] + P[P.length - 1][1]) / 2;
        const c: V3 = [0, cy, z];
        for (let j = 0; j < loop.length; j++) {
            const q0 = loop[j], q1 = loop[(j + 1) % loop.length];
            soup.triF(c, [q0[0], q0[1], z], [q1[0], q1[1], z], [0, 0, dir], R_PAINT);
        }
    };
    if (s.front.bulge <= 0) cap(secs[0], samples[0].z, -1);
    if (s.rear.bulge <= 0) cap(secs[secs.length - 1], samples[samples.length - 1].z, 1);
}

// ---------------------------------------------------------------------------------
// Greenhouse: 8 points from the buried base up the side (seal, glass, frame), round
// the roof rail and across the roof / windscreen / rear glass to the centre line.
function ghPoints(s: BodySpec, z: number, slant: number): V3[] {
    const P = lowerSection(s, z);
    const xBase = P[9][0], yS = P[8][1];
    const yb = yS - 0.05;
    const yR = s.gh.roof.at(z);
    const h = yR - yS;
    const xR = Math.min(s.gh.rail.at(z), xBase);
    let pts: V2[];
    if (h <= 0.003) {
        const rr = s.railR;
        pts = [[xBase, yb], [xBase, yb], [xBase, yb], [xR, yb], [xR - rr * 0.293, yb], [xR - rr, yb], [(xR - rr) * 0.5, yb], [0, yb]];
    } else {
        const rr = Math.min(s.railR, h * 0.35), seal = Math.min(0.07, h * 0.15), frame = Math.min(0.05, h * 0.1);
        const crown = s.roofCrown * Math.min(1, h / 0.6);
        const yTop = yR - rr;
        const xAt = (y: number) => xBase + (xR - xBase) * clamp01((y - yb) / Math.max(1e-6, yTop - yb));
        pts = [[xBase, yb], [xAt(yS + seal), yS + seal], [xAt(yTop - frame), yTop - frame], [xR, yTop],
            [xR - rr * 0.293, yR - rr * 0.293], [xR - rr, yR], [(xR - rr) * 0.5, yR + crown * 0.75], [0, yR + crown]];
    }
    const xMax = Math.max(1e-6, xBase), plan = s.gh.plan.at(z);
    return pts.map(([x, y], i) => {
        let zz = z - plan * (1 - (x / xMax) ** 2);
        if (slant && i <= 2) zz += slant * (1 - clamp01((y - yb) / Math.max(1e-6, h)));
        return [x, y, zz];
    });
}

function ghRoute(g: GhMark, seg: number): Route {
    switch (seg) {
        case 0: return trim('blackGloss');
        case 1: return g.side === 'glass' ? R_GLASS : g.side === 'b' ? trim('blackGloss') : R_PAINT;
        case 2: return g.side === 'c' ? R_PAINT : trim('blackGloss');
        case 3: case 4: return R_PAINT;
        default: return g.zone === 'ws' || g.zone === 'bl' || g.zone === 'backGlass' ? R_GLASS : R_PAINT;
    }
}

function buildGreenhouse(s: BodySpec, soup: Soup) {
    const { roof, marks } = s.gh;
    // sections at every mark, plus more wherever the roof line bends (windscreen and rear glass ends)
    const zs: number[] = [];
    const refine = (a: number, b: number, depth: number) => {
        const m = (a + b) / 2;
        if (depth < 4 && b - a > 0.24 && Math.abs(roof.at(m) - (roof.at(a) + roof.at(b)) / 2) > 0.008) {
            refine(a, m, depth + 1); zs.push(m); refine(m, b, depth + 1);
        }
    };
    for (let i = 0; i < marks.length; i++) {
        zs.push(marks[i].z);
        if (i < marks.length - 1) {
            const a = marks[i].z, b = marks[i + 1].z, n = Math.max(1, Math.round((b - a) / 0.9));
            for (let j = 0; j < n; j++) { const z0 = a + (b - a) * j / n, z1 = a + (b - a) * (j + 1) / n; refine(z0, z1, 0); if (j < n - 1) zs.push(z1); }
        }
    }
    zs.sort((a, b) => a - b);
    const markAt = (z: number) => { let m = marks[0]; for (const k of marks) if (k.z <= z + 1e-6) m = k; return m; };
    const secs = zs.map(z => { const m = markAt(z); return ghPoints(s, z, Math.abs(m.z - z) < 1e-6 ? m.slant ?? 0 : 0); });
    for (let k = 0; k < secs.length - 1; k++) {
        const A = secs[k], B = secs[k + 1], mark = markAt(zs[k]);
        for (let i = 0; i < 7; i++) {
            const r = ghRoute(mark, i);
            for (const sd of [1, -1]) {
                const m = (p: V3): V3 => [p[0] * sd, p[1], p[2]];
                const a0 = m(A[i]), a1 = m(A[i + 1]), b0 = m(B[i]), b1 = m(B[i + 1]);
                if (sd > 0) { soup.tri(a0, a1, b0, r); soup.tri(a1, b1, b0, r); }
                else { soup.tri(a0, b0, a1, r); soup.tri(a1, b0, b1, r); }
            }
        }
    }
}

// ---------------------------------------------------------------------------------
// Projection onto the body (for lamps, grilles, seams, handles ...)
function insideHalf(P: V2[], x: number, y: number) {
    let inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const [xi, yi] = P[i], [xj, yj] = P[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}
/** z of the body's front surface at (x, y), or NaN. */
export function frontZ(s: BodySpec, x: number, y: number) {
    const ax = Math.abs(x);
    let lo = s.noseZ, hi = NaN;
    for (let z = s.noseZ; z <= s.noseZ + 4; z += 0.05) { if (insideHalf(lowerSection(s, z), ax, y)) { hi = z; break; } lo = z; }
    if (Number.isNaN(hi)) return NaN;
    for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (insideHalf(lowerSection(s, m), ax, y)) hi = m; else lo = m; }
    return hi;
}
/** z of the body's rear surface at (x, y), or NaN. */
export function rearZ(s: BodySpec, x: number, y: number) {
    const ax = Math.abs(x);
    let hi = s.tailZ, lo = NaN;
    for (let z = s.tailZ; z >= s.tailZ - 4; z -= 0.05) { if (insideHalf(lowerSection(s, z), ax, y)) { lo = z; break; } hi = z; }
    if (Number.isNaN(lo)) return NaN;
    for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (insideHalf(lowerSection(s, m), ax, y)) lo = m; else hi = m; }
    return lo;
}
/** Outermost x of the body side at (z, y). */
export function sideX(s: BodySpec, z: number, y: number) {
    const P = lowerSection(s, z);
    let best = NaN;
    for (let i = 3; i < P.length - 1; i++) {
        const [x0, y0] = P[i], [x1, y1] = P[i + 1];
        if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) {
            const x = x0 + (x1 - x0) * (y - y0) / (y1 - y0);
            if (!(best >= x)) best = x;
        }
    }
    return best;
}

type DecalOpts = { r: Route; cell?: Rect; eps?: number; na?: number; nb?: number; mirror?: boolean; flipU?: boolean };
/** A patch laid on the body: `kind` front/rear (a = x, b = y) or side (a = z, b = y, right side). */
function decal(soup: Soup, s: BodySpec, kind: 'front' | 'rear' | 'side', a0: number, a1: number, b0: number, b1: number, o: DecalOpts) {
    const na = o.na ?? 4, nb = o.nb ?? 2, eps = o.eps ?? 0.012;
    const sides = o.mirror ? [1, -1] : [1];
    for (const sd of sides) {
        const grid: (V3 | null)[][] = [], uvs: V2[][] = [];
        for (let i = 0; i <= na; i++) {
            grid.push([]); uvs.push([]);
            for (let j = 0; j <= nb; j++) {
                const a = a0 + (a1 - a0) * i / na, b = b0 + (b1 - b0) * j / nb;
                let p: V3 | null = null;
                if (kind === 'front') { const z = frontZ(s, a, b); if (!Number.isNaN(z)) p = [a * sd, b, z - eps]; }
                else if (kind === 'rear') { const z = rearZ(s, a, b); if (!Number.isNaN(z)) p = [a * sd, b, z + eps]; }
                else { const x = sideX(s, a, b); if (!Number.isNaN(x)) p = [(x + eps) * sd, b, a]; }
                grid[i].push(p);
                const u = o.flipU ? 1 - i / na : i / na, v = j / nb;
                uvs[i].push(o.cell ? uvIn(o.cell, u, v) : o.r.uv([0, 0, 0], [0, 0, 1]));
            }
        }
        const facing: V3 = kind === 'front' ? [0, 0, -1] : kind === 'rear' ? [0, 0, 1] : [sd, 0, 0];
        for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) {
            const p00 = grid[i][j], p10 = grid[i + 1][j], p11 = grid[i + 1][j + 1], p01 = grid[i][j + 1];
            if (!p00 || !p10 || !p11 || !p01) continue;
            soup.quadF(p00, p10, p11, p01, facing, o.r, [uvs[i][j], uvs[i + 1][j], uvs[i + 1][j + 1], uvs[i][j + 1]]);
        }
    }
}

/** Box with chamfered edges, optionally rotated about X then Y around its centre. */
function cbox(soup: Soup, c: V3, h: V3, ch: number, r: Route, rotX = 0, rotY = 0) {
    const cx = Math.cos(rotX), sx = Math.sin(rotX), cy = Math.cos(rotY), sy = Math.sin(rotY);
    const T = (p: V3): V3 => {
        const y1 = p[1] * cx - p[2] * sx, z1 = p[1] * sx + p[2] * cx;
        const x2 = p[0] * cy + z1 * sy, z2 = -p[0] * sy + z1 * cy;
        return [c[0] + x2, c[1] + y1, c[2] + z2];
    };
    const Tn = (n: V3): V3 => { const t = T(n); return [t[0] - c[0], t[1] - c[1], t[2] - c[2]]; };
    const e = Math.min(ch, h[0] * 0.45, h[1] * 0.45, h[2] * 0.45);
    // corner (sx,sy,sz) -> its three chamfer points on the x, y and z faces
    const pt = (sxx: number, syy: number, szz: number, axis: number): V3 => {
        const p: V3 = [sxx * (h[0] - e), syy * (h[1] - e), szz * (h[2] - e)];
        p[axis] = [sxx, syy, szz][axis] * h[axis];
        return T(p);
    };
    const S = [-1, 1];
    for (let axis = 0; axis < 3; axis++) for (const sgn of S) {
        // face perpendicular to axis
        const u = (axis + 1) % 3, v = (axis + 2) % 3;
        const q = (su: number, sv: number) => { const s3 = [0, 0, 0]; s3[axis] = sgn; s3[u] = su; s3[v] = sv; return pt(s3[0], s3[1], s3[2], axis); };
        const n: V3 = [0, 0, 0]; n[axis] = sgn;
        soup.quadF(q(-1, -1), q(1, -1), q(1, 1), q(-1, 1), Tn(n), r);
    }
    // edge bevels
    for (let axis = 0; axis < 3; axis++) {
        const u = (axis + 1) % 3, v = (axis + 2) % 3;
        for (const su of S) for (const sv of S) {
            const s3a = [0, 0, 0], s3b = [0, 0, 0];
            s3a[axis] = -1; s3b[axis] = 1; s3a[u] = s3b[u] = su; s3a[v] = s3b[v] = sv;
            const n: V3 = [0, 0, 0]; n[u] = su; n[v] = sv;
            soup.quadF(pt(s3a[0], s3a[1], s3a[2], u), pt(s3b[0], s3b[1], s3b[2], u), pt(s3b[0], s3b[1], s3b[2], v), pt(s3a[0], s3a[1], s3a[2], v), Tn(n), r);
        }
    }
    for (const a of S) for (const b of S) for (const d of S) soup.triF(pt(a, b, d, 0), pt(a, b, d, 1), pt(a, b, d, 2), Tn([a, b, d]), r);
}

/** Flat ring (double-sided), centre c, axis tilted back from vertical by `tilt`. */
function ring(soup: Soup, c: V3, r0: number, r1: number, tilt: number, r: Route, seg = 10) {
    const P = (rad: number, a: number): V3 => {
        const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
        return [c[0] + x, c[1] + y * Math.cos(tilt), c[2] + y * Math.sin(tilt)];
    };
    const n: V3 = [0, Math.sin(tilt), -Math.cos(tilt)];
    for (let i = 0; i < seg; i++) {
        const a = i / seg * Math.PI * 2, b = (i + 1) / seg * Math.PI * 2;
        soup.quadF(P(r0, a), P(r1, a), P(r1, b), P(r0, b), n, r);
        soup.quadF(P(r0, a), P(r1, a), P(r1, b), P(r0, b), [-n[0], -n[1], -n[2]], r);
    }
}

// ---------------------------------------------------------------------------------
// Wheel: tyre + rim around the X axle, outer face toward +X. The rim face is textured
// with the spokes, so turning the wheel visibly turns the spokes.
export function buildWheelGeometry(R: number, w: number, rimR: number, seg = 16): THREE.BufferGeometry {
    const soup = new Soup();
    const hw = w / 2;
    const rimTex = rimR + 0.015;
    const rimUV = (r: number, a: number): V2 => uvIn(CELL.rim, 0.5 + 0.5 * (r / rimTex) * Math.cos(a), 0.5 + 0.5 * (r / rimTex) * Math.sin(a));
    // profile (r, x, tyre v | -1 for rim): inner shoulder → tread → outer sidewall → rim lip → dish
    const prof: [number, number, number][] = [
        [R - 0.13, -hw, 0.02], [R, -hw + 0.1, 0.3], [R, hw - 0.1, 0.6], [R - 0.13, hw, 0.8], [rimR + 0.05, hw - 0.012, 0.97],
        [rimR + 0.012, hw - 0.018, -1], [rimR - 0.02, hw - 0.025, -1], [rimR - 0.045, hw - 0.09, -1],
    ];
    const tyre: Route = { slot: TRIM, uv: ZERO_UV };
    const V = (r: number, x: number, a: number): V3 => [x, Math.cos(a) * r, Math.sin(a) * r];
    for (let i = 0; i < prof.length - 1; i++) {
        const [r0, x0, v0] = prof[i], [r1, x1, v1] = prof[i + 1];
        const nr = x1 - x0, nx = -(r1 - r0); // outward normal in the (r, x) plane
        for (let k = 0; k < seg; k++) {
            const a = k / seg * Math.PI * 2, b = (k + 1) / seg * Math.PI * 2, am = (a + b) / 2;
            const facing: V3 = [nx, Math.cos(am) * nr, Math.sin(am) * nr];
            const uvq: [V2, V2, V2, V2] = v0 >= 0 && v1 >= 0
                ? [uvIn(CELL.tyre, k / seg, 1 - v0), uvIn(CELL.tyre, (k + 1) / seg, 1 - v0), uvIn(CELL.tyre, (k + 1) / seg, 1 - v1), uvIn(CELL.tyre, k / seg, 1 - v1)]
                : v0 >= 0 ? [swatchUV('rubber'), swatchUV('rubber'), rimUV(r1, b), rimUV(r1, a)]
                : [rimUV(r0, a), rimUV(r0, b), rimUV(r1, b), rimUV(r1, a)];
            soup.quadF(V(r0, x0, a), V(r0, x0, b), V(r1, x1, b), V(r1, x1, a), facing, tyre, uvq);
        }
    }
    // rim face: a shallow cone out to the hub
    const [rf, xf] = [prof[prof.length - 1][0], prof[prof.length - 1][1]];
    const hub: V3 = [hw - 0.04, 0, 0];
    for (let k = 0; k < seg; k++) {
        const a = k / seg * Math.PI * 2, b = (k + 1) / seg * Math.PI * 2;
        soup.triF(hub, V(rf, xf, a), V(rf, xf, b), [1, 0, 0], tyre, [rimUV(0, 0), rimUV(rf, a), rimUV(rf, b)]);
    }
    const out = [new Out(), new Out(), new Out()];
    flush(soup, 62, out);
    return toGeometry(out[TRIM], true);
}

// ---------------------------------------------------------------------------------
export type StyleGeometry = {
    paint: THREE.BufferGeometry; trim: THREE.BufferGeometry; glass: THREE.BufferGeometry; wheel: THREE.BufferGeometry;
    wheelPos: THREE.Vector3[];      // FL, FR, RL, RR wheel centres
    smokePos: THREE.Vector3;        // over the engine
    length: number; width: number; height: number;
};

type Extras = (soup: Soup, s: BodySpec, t: Tools) => void;
type Tools = { decal: typeof decal; cbox: typeof cbox; ring: typeof ring; trim: typeof trim; R_PAINT: Route; frontZ: typeof frontZ; rearZ: typeof rearZ; sideX: typeof sideX };
const TOOLS: Tools = { decal, cbox, ring, trim, R_PAINT, frontZ, rearZ, sideX };

export function buildStyleGeometry(s: BodySpec, extras: Extras, smokeY: number): StyleGeometry {
    const outs = [new Out(), new Out(), new Out()];
    const body = new Soup(); buildLower(s, body); flush(body, 38, outs);
    const gh = new Soup(); buildGreenhouse(s, gh); flush(gh, 38, outs);
    const ex = new Soup(); extras(ex, s, TOOLS); flush(ex, 40, outs);
    const paint = toGeometry(outs[PAINT], false);
    const bb = paint.boundingBox!;
    return {
        paint, trim: toGeometry(outs[TRIM], true), glass: toGeometry(outs[GLASS], true),
        wheel: buildWheelGeometry(s.wheelR, s.tyreW, s.rimR),
        wheelPos: [[-1, 0], [1, 0], [-1, 1], [1, 1]].map(([sx, a]) => new THREE.Vector3(sx * s.wheelX, s.wheelR, s.axles[a])),
        smokePos: new THREE.Vector3(0, smokeY, s.axles[0] - 0.6),
        length: bb.max.z - bb.min.z, width: bb.max.x - bb.min.x, height: bb.max.y,
    };
}
