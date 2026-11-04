import * as THREE from 'three';
import { CELL, uvIn, swatchUV, type Rect, type Swatch } from './carAtlas';

// Procedural car bodies. Every body style is described by a few profile curves
// (bottom, shoulder line, plan shape, wheel arches, greenhouse), and the mesh is
// built from cross-sections along the car (a loft), so the surfaces are smoothly
// curved and the wheel arches are real openings. Lamps, grilles and plates are
// thin patches projected onto the body. Built once per style and shared by every
// car of that style; only the paint material differs per car. Each style also gets
// a far version (~300 triangles, 2 draws) for cars far from the camera.
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
        this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
        if (uvs) this.uv.push(uvs[0][0], uvs[0][1], uvs[1][0], uvs[1][1], uvs[2][0], uvs[2][1]);
        else {
            const l = Math.sqrt(l2), n: V3 = [nx / l, ny / l, nz / l];
            const ua = r.uv(a, n), ub = r.uv(b, n), uc = r.uv(c, n);
            this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
        }
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

// Exact numeric key of a position at 1 mm (0.001 unit) resolution (|coords| < 65 units)
const posKey = (x: number, y: number, z: number) =>
    (Math.round(x * 1000) + 65536) * 17179869184 + (Math.round(y * 1000) + 65536) * 131072 + (Math.round(z * 1000) + 65536);

/** Indexed vertex buffer that merges identical (position, normal, uv) corners. */
class Out {
    p: number[] = []; n: number[] = []; uv: number[] = []; idx: number[] = [];
    private map = new Map<number, number[]>();
    add(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) {
        const k = posKey(x, y, z);
        let list = this.map.get(k);
        if (!list) this.map.set(k, list = []);
        for (const i of list) {
            if (Math.abs(this.n[i * 3] - nx) < 1e-3 && Math.abs(this.n[i * 3 + 1] - ny) < 1e-3 && Math.abs(this.n[i * 3 + 2] - nz) < 1e-3
                && Math.abs(this.uv[i * 2] - u) < 1e-5 && Math.abs(this.uv[i * 2 + 1] - v) < 1e-5) { this.idx.push(i); return; }
        }
        const i = this.p.length / 3;
        this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v);
        list.push(i); this.idx.push(i);
    }
}

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
    const keys = new Float64Array(nT * 3);
    const map = new Map<number, number[]>();
    for (let t = 0; t < nT; t++) for (let v = 0; v < 3; v++) {
        const i = t * 9 + v * 3, k = posKey(P[i], P[i + 1], P[i + 2]);
        keys[t * 3 + v] = k;
        let l = map.get(k); if (!l) map.set(k, l = []); l.push(t);
    }
    const cosC = Math.cos(creaseDeg * Math.PI / 180);
    for (let t = 0; t < nT; t++) {
        const out = outs[soup.slot[t]];
        const tx = fn[t * 3], ty = fn[t * 3 + 1], tz = fn[t * 3 + 2];
        for (let v = 0; v < 3; v++) {
            const i = t * 9 + v * 3;
            let sx = 0, sy = 0, sz = 0;
            for (const s of map.get(keys[t * 3 + v])!) {
                if (fn[s * 3] * tx + fn[s * 3 + 1] * ty + fn[s * 3 + 2] * tz >= cosC) { sx += fw[s * 3]; sy += fw[s * 3 + 1]; sz += fw[s * 3 + 2]; }
            }
            const l = Math.hypot(sx, sy, sz) || 1;
            out.add(P[i], P[i + 1], P[i + 2], sx / l, sy / l, sz / l, soup.uv[t * 6 + v * 2], soup.uv[t * 6 + v * 2 + 1]);
        }
    }
}

function toGeometry(o: Out, withUV: boolean): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(o.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(o.n), 3));
    if (withUV) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(o.uv), 2));
    const n = o.p.length / 3;
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(o.idx) : new Uint16Array(o.idx), 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
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
    side: 'glass' | 'b' | 'c';                         // side window glass, black pillar, or painted pillar
    slant?: number;                                    // move the bottom of the side back by this much (slanted pillar edge)
};
/** Greenhouse (cabin glass and pillars): from the windscreen base to the rear glass base. */
export type GhSpec = {
    roof: Curve;   // height of the roof / glass at the centre line, by z (at or below the shoulder at both ends)
    rail: Curve;   // half-width at the roof rail
    plan: Curve;   // plan curvature: centre ahead of the corners by this much (windscreen +, rear glass -)
    marks: GhMark[];
};
/**
 * An end of the body (nose or tail). Seen from above the corners are rounded from x0
 * out to the full width; the middle bulges out by `bulge` (0 = flat), blending away
 * over `len`. `rake` leans the end face back by that much per unit of height.
 */
export type EndSpec = { x0: number; bulge: number; len: number; rake: number };

export interface BodySpec {
    noseZ: number; tailZ: number; hw: number;      // ends, half of the body width
    front: EndSpec; rear: EndSpec;
    wheelR: number; tyreW: number; rimR: number; wheelX: number; axles: [number, number];
    archR: number; archY: number; archP: number;   // arch radius, centre height, roundness (2 = round, 3+ = squarer)
    bottom: Curve; shoulder: Curve; crown: Curve;  // by z: underbody height, top of the sides, crown of hood/deck
    widest: number;                                // height of the widest point, as a fraction of the side
    tumble: number; rS: number; rL: number; rLip: number; sillIn: number; ledge: number; wellDepth: number;
    cabin: [number, number];                       // z range under the greenhouse (interior)
    bed?: { z0: number; z1: number; floorY: number; railW: number };
    flare?: number;                                // black plastic band around the wheel arches
    cladding?: number;                             // black plastic up the lower side to this height above the sill
    railR: number; roofCrown: number;
    gh: GhSpec;
}

// ---------------------------------------------------------------------------------
// Lower body cross-section: 13 points from the bottom centre round the right side to
// the top centre (mirrored for the left side).
//  0 bottom centre · 1-2 inner wall of the wheel well · 3-4 rocker / arch lip ·
//  5 widest point (or a flare's top edge) · 6-8 shoulder · 9-12 top (hood, deck) or the open bed (U shape)
type Mode = { arch?: 'in' | 'out'; top?: 'crown' | 'bed' };

const planHW = (e: EndSpec, hwMax: number, d: number) => {
    const Rp = hwMax - e.x0;
    if (d >= Rp) return hwMax;
    return e.x0 + Math.sqrt(Math.max(0, Rp * Rp - (Rp - Math.max(0, d)) ** 2));
};
export const halfWidthAt = (s: BodySpec, z: number) =>
    Math.min(planHW(s.front, s.hw, z - s.noseZ), planHW(s.rear, s.hw, s.tailZ - z));

/** How far a point of the section at z is pushed along z by the plan bulge and rake of the ends. */
export function endOffset(s: BodySpec, z: number, x: number, y: number) {
    let off = 0;
    const F = s.front, df = z - s.noseZ;
    if (df < F.len) {
        const w = (1 - Math.max(0, df) / F.len) ** 2, ax = Math.min(1, Math.abs(x) / F.x0);
        off += w * (-F.bulge * (1 - ax * ax) ** 2 + F.rake * (y - s.bottom.at(s.noseZ)));
    }
    const R = s.rear, dr = s.tailZ - z;
    if (dr < R.len) {
        const w = (1 - Math.max(0, dr) / R.len) ** 2, ax = Math.min(1, Math.abs(x) / R.x0);
        off += w * (R.bulge * (1 - ax * ax) ** 2 - R.rake * (y - s.bottom.at(s.tailZ)));
    }
    return off;
}

export function lowerSection(s: BodySpec, z: number, mode: Mode = {}): V2[] {
    const hw = halfWidthAt(s, z);
    const k = Math.min(1, hw / 0.9); // insets shrink if an end is very narrow
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
        if (s.flare && mode.arch !== 'out' && dz < s.archR + s.flare) yFlare = Math.max(yFlare, s.archY + (s.archR + s.flare) * se(dz / (s.archR + s.flare)));
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
    else if (s.cladding) y6 = Math.min(Math.max(yB + s.cladding, yLow + 0.03), yS - rS - 0.03); // ... or the cladding's
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
function lowerSamples(s: BodySpec, far = false): Sample[] {
    const special: Sample[] = [];
    const plain: number[] = [];
    const ends = (e: EndSpec, from: number, dir: number) => {
        const Rp = s.hw - e.x0;
        for (const a of far ? [45, 90] : [15, 30, 45, 60, 75, 90]) plain.push(from + dir * Rp * (1 - Math.cos(a * Math.PI / 180)));
        if (!far && (e.bulge || e.rake)) for (const f of [0.3, 0.6]) plain.push(from + dir * e.len * f);
    };
    ends(s.front, s.noseZ, 1);
    ends(s.rear, s.tailZ, -1);
    if (!far) for (const zc of s.axles) {
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
    const near = (z: number) => all.some(o => Math.abs(o.z - z) < (far ? 0.25 : 0.006));
    for (const z of plain.sort((a, b) => a - b)) if (z > s.noseZ && z < s.tailZ && !near(z)) all.push({ z, mode: {} });
    all.sort((a, b) => a.z - b.z);
    // no long gaps (the hood and deck curve)
    const maxGap = far ? 2.2 : 0.8;
    const out: Sample[] = [];
    for (let i = 0; i < all.length; i++) {
        out.push(far ? { z: all[i].z, mode: { ...all[i].mode, arch: 'out' } } : all[i]);
        const next = all[i + 1];
        if (!next) break;
        const gap = next.z - all[i].z, n = Math.ceil(gap / maxGap);
        for (let j = 1; j < n; j++) out.push({ z: all[i].z + gap * j / n, mode: far ? { arch: 'out' } : {} });
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
        case 3: case 4: return (s.flare && nearArch(s.flare)) || s.cladding ? trim('blackMatte') : R_PAINT;
        case 5: case 6: case 7: case 8: return R_PAINT;
        default:
            if (inBed) return { slot: TRIM, uv: bedUV };
            if (inCabin) return trim('interior');             // floor of the cabin at the belt line
            return R_PAINT;
    }
}

/** Fill an end section (a flat-ish face, bulged and raked by endOffset). */
function capEnd(soup: Soup, s: BodySpec, P: V2[], z: number, dir: number, r: Route) {
    const loop: V2[] = [...P, ...P.slice(1, -1).reverse().map(([x, y]) => [-x, y] as V2)];
    const cy = (P[0][1] + P[P.length - 1][1]) / 2;
    const c: V3 = [0, cy, z + endOffset(s, z, 0, cy)];
    const at = (q: V2): V3 => [q[0], q[1], z + endOffset(s, z, q[0], q[1])];
    for (let j = 0; j < loop.length; j++) soup.triF(c, at(loop[j]), at(loop[(j + 1) % loop.length]), [0, 0, dir], r);
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
                const a0: V3 = [A[i][0] * sd, A[i][1], za + endOffset(s, za, A[i][0], A[i][1])];
                const a1: V3 = [A[i + 1][0] * sd, A[i + 1][1], za + endOffset(s, za, A[i + 1][0], A[i + 1][1])];
                const b0: V3 = [B[i][0] * sd, B[i][1], zb + endOffset(s, zb, B[i][0], B[i][1])];
                const b1: V3 = [B[i + 1][0] * sd, B[i + 1][1], zb + endOffset(s, zb, B[i + 1][0], B[i + 1][1])];
                if (sd > 0) { soup.tri(a0, a1, b0, r); soup.tri(a1, b1, b0, r); }
                else { soup.tri(a0, b0, a1, r); soup.tri(a1, b0, b1, r); }
            }
        }
    }
    capEnd(soup, s, secs[0], samples[0].z, -1, R_PAINT);
    capEnd(soup, s, secs[secs.length - 1], samples[samples.length - 1].z, 1, R_PAINT);
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

function ghRoute(g: GhMark, seg: number, glass: Route): Route {
    switch (seg) {
        case 0: return trim('blackGloss');
        case 1: return g.side === 'glass' ? glass : g.side === 'b' ? trim('blackGloss') : R_PAINT;
        case 2: return g.side === 'c' ? R_PAINT : trim('blackGloss');
        case 3: case 4: return R_PAINT;
        default: return g.zone === 'ws' || g.zone === 'bl' || g.zone === 'backGlass' ? glass : R_PAINT;
    }
}

function ghSampleZs(s: BodySpec, refineOn: boolean) {
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
        if (refineOn && i < marks.length - 1) {
            const a = marks[i].z, b = marks[i + 1].z, n = Math.max(1, Math.round((b - a) / 0.9));
            for (let j = 0; j < n; j++) { const z0 = a + (b - a) * j / n, z1 = a + (b - a) * (j + 1) / n; refine(z0, z1, 0); if (j < n - 1) zs.push(z1); }
        }
    }
    return zs.sort((a, b) => a - b);
}
const markAt = (s: BodySpec, z: number) => { let m = s.gh.marks[0]; for (const k of s.gh.marks) if (k.z <= z + 1e-6) m = k; return m; };

function buildGreenhouse(s: BodySpec, soup: Soup) {
    const zs = ghSampleZs(s, true);
    const secs = zs.map(z => { const m = markAt(s, z); return ghPoints(s, z, Math.abs(m.z - z) < 1e-6 ? m.slant ?? 0 : 0); });
    for (let k = 0; k < secs.length - 1; k++) {
        const A = secs[k], B = secs[k + 1], mark = markAt(s, zs[k]);
        for (let i = 0; i < 7; i++) {
            const r = ghRoute(mark, i, R_GLASS);
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
        const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}
// The sections every front / rear projection steps through (the same for every point: cached per body)
const SCAN_STEP = 0.06, SCAN_N = 59;
const scanCache = new WeakMap<BodySpec, { front: V2[][]; rear: V2[][] }>();
const scanSecs = (s: BodySpec) => {
    let c = scanCache.get(s);
    if (!c) {
        c = { front: [], rear: [] };
        for (let i = 0; i < SCAN_N; i++) { c.front.push(lowerSection(s, s.noseZ + i * SCAN_STEP)); c.rear.push(lowerSection(s, s.tailZ - i * SCAN_STEP)); }
        scanCache.set(s, c);
    }
    return c;
};
/** z of the body's front surface at (x, y), or NaN. */
export function frontZ(s: BodySpec, x: number, y: number) {
    const ax = Math.abs(x), secs = scanSecs(s).front;
    let i = 0;
    while (i < SCAN_N && !insideHalf(secs[i], ax, y)) i++;
    if (i === SCAN_N) return NaN;
    let hi = s.noseZ + i * SCAN_STEP, lo = hi - SCAN_STEP;
    if (i > 0) for (let k = 0; k < 7; k++) { const m = (lo + hi) / 2; if (insideHalf(lowerSection(s, m), ax, y)) hi = m; else lo = m; }
    return hi + endOffset(s, hi, ax, y);
}
/** z of the body's rear surface at (x, y), or NaN. */
export function rearZ(s: BodySpec, x: number, y: number) {
    const ax = Math.abs(x), secs = scanSecs(s).rear;
    let i = 0;
    while (i < SCAN_N && !insideHalf(secs[i], ax, y)) i++;
    if (i === SCAN_N) return NaN;
    let lo = s.tailZ - i * SCAN_STEP, hi = lo + SCAN_STEP;
    if (i > 0) for (let k = 0; k < 7; k++) { const m = (lo + hi) / 2; if (insideHalf(lowerSection(s, m), ax, y)) lo = m; else hi = m; }
    return lo + endOffset(s, lo, ax, y);
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
/** Height of the top surface (hood, roof, deck) at (z, x) and its z, for parts sitting on top. */
export function topY(s: BodySpec, z: number) { const P = lowerSection(s, z); return P[P.length - 1][1]; }

type DecalOpts = {
    r: Route; cell?: Rect; eps?: number; na?: number; nb?: number; mirror?: boolean; flipU?: boolean;
    far?: Swatch; // also show it on the far version, as a plain patch of this swatch
};
/** A patch laid on the body: `kind` front/rear (a = x, b = y) or side (a = z, b = y, right side). */
function decal(soup: Soup, s: BodySpec, kind: 'front' | 'rear' | 'side', a0: number, a1: number, b0: number, b1: number, o: DecalOpts) {
    const na = o.na ?? 4, nb = o.nb ?? 2, eps = o.eps ?? 0.012;
    // project the right-hand patch once; the left one is its mirror image
    const grid: (V3 | null)[][] = [], uvs: V2[][] = [];
    for (let i = 0; i <= na; i++) {
        grid.push([]); uvs.push([]);
        for (let j = 0; j <= nb; j++) {
            const a = a0 + (a1 - a0) * i / na, b = b0 + (b1 - b0) * j / nb;
            let p: V3 | null = null;
            if (kind === 'front') { const z = frontZ(s, a, b); if (!Number.isNaN(z)) p = [a, b, z - eps]; }
            else if (kind === 'rear') { const z = rearZ(s, a, b); if (!Number.isNaN(z)) p = [a, b, z + eps]; }
            else { const x = sideX(s, a, b); if (!Number.isNaN(x)) p = [x + eps, b, a]; }
            grid[i].push(p);
            const u = o.flipU ? 1 - i / na : i / na, v = j / nb;
            uvs[i].push(o.cell ? uvIn(o.cell, u, v) : o.r.uv([0, 0, 0], [0, 0, 1]));
        }
    }
    for (const sd of o.mirror ? [1, -1] : [1]) {
        const facing: V3 = kind === 'front' ? [0, 0, -1] : kind === 'rear' ? [0, 0, 1] : [sd, 0, 0];
        const m = (p: V3): V3 => [p[0] * sd, p[1], p[2]];
        for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) {
            const p00 = grid[i][j], p10 = grid[i + 1][j], p11 = grid[i + 1][j + 1], p01 = grid[i][j + 1];
            if (!p00 || !p10 || !p11 || !p01) continue;
            soup.quadF(m(p00), m(p10), m(p11), m(p01), facing, o.r, [uvs[i][j], uvs[i + 1][j], uvs[i + 1][j + 1], uvs[i][j + 1]]);
        }
    }
}

/** Box with chamfered edges (ch = 0: plain box), optionally rotated about X then Y around its centre. */
function cbox(soup: Soup, c: V3, h: V3, ch: number, r: Route, rotX = 0, rotY = 0) {
    const cx = Math.cos(rotX), sx = Math.sin(rotX), cy = Math.cos(rotY), sy = Math.sin(rotY);
    const T = (p: V3): V3 => {
        const y1 = p[1] * cx - p[2] * sx, z1 = p[1] * sx + p[2] * cx;
        const x2 = p[0] * cy + z1 * sy, z2 = -p[0] * sy + z1 * cy;
        return [c[0] + x2, c[1] + y1, c[2] + z2];
    };
    const Tn = (n: V3): V3 => { const t = T(n); return [t[0] - c[0], t[1] - c[1], t[2] - c[2]]; };
    const e = Math.min(ch, h[0] * 0.45, h[1] * 0.45, h[2] * 0.45);
    const pt = (sxx: number, syy: number, szz: number, axis: number): V3 => {
        const p: V3 = [sxx * (h[0] - e), syy * (h[1] - e), szz * (h[2] - e)];
        p[axis] = [sxx, syy, szz][axis] * h[axis];
        return T(p);
    };
    const S = [-1, 1];
    for (let axis = 0; axis < 3; axis++) for (const sgn of S) {
        const u = (axis + 1) % 3, v = (axis + 2) % 3;
        const q = (su: number, sv: number) => { const s3 = [0, 0, 0]; s3[axis] = sgn; s3[u] = su; s3[v] = sv; return pt(s3[0], s3[1], s3[2], axis); };
        const n: V3 = [0, 0, 0]; n[axis] = sgn;
        soup.quadF(q(-1, -1), q(1, -1), q(1, 1), q(-1, 1), Tn(n), r);
    }
    if (e <= 0) return;
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

/** Exhaust tip: an open tube along z (rear end at z1) with a dark inside. */
function exhaust(soup: Soup, x: number, y: number, z0: number, z1: number, rx: number, ry: number, seg = 10) {
    const outer = trim('chrome'), inner = trim('exhaustIn');
    const P = (a: number, z: number, k = 1): V3 => [x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k, z];
    for (let i = 0; i < seg; i++) {
        const a = i / seg * Math.PI * 2, b = (i + 1) / seg * Math.PI * 2, am = (a + b) / 2;
        soup.quadF(P(a, z0), P(b, z0), P(b, z1), P(a, z1), [Math.cos(am), Math.sin(am), 0], outer);
        soup.quadF(P(a, z1), P(b, z1), P(b, z1 - 0.01, 0.8), P(a, z1 - 0.01, 0.8), [0, 0, 1], outer);
        soup.triF([x, y, z1 - 0.06], P(a, z1 - 0.01, 0.8), P(b, z1 - 0.01, 0.8), [0, 0, 1], inner);
    }
}

// ---------------------------------------------------------------------------------
// Wheel: tyre + rim around the X axle, outer face toward +X. The rim face is textured
// with the spokes, so turning the wheel visibly turns the spokes; the blurred version
// (rim cell `rimBlur`) is shown while the wheel spins too fast for the eye.
export function buildWheelGeometry(R: number, w: number, rimR: number, blur = false, seg = 16): THREE.BufferGeometry {
    const soup = new Soup();
    const hw = w / 2;
    const rimTex = rimR + 0.015, rimCell = blur ? CELL.rimBlur : CELL.rim;
    const rimUV = (r: number, a: number): V2 => uvIn(rimCell, 0.5 + 0.5 * (r / rimTex) * Math.cos(a), 0.5 + 0.5 * (r / rimTex) * Math.sin(a));
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
// Far version: a coarse loft (no arch openings), opaque dark glass, octagonal wheels
// standing just proud of the sides, and the lamps as plain patches. Paint + 1 trim draw.
type Lamp = { kind: 'head' | 'tail'; x: number; y: number; z: number; hw: number; hh: number };
type FarPatch = { facing: V3; pts: V3[]; swatch: Swatch; mirror: boolean };
type FarBox = { c: V3; h: V3; swatch: Swatch };

function buildFar(s: BodySpec, lamps: Lamp[], patches: FarPatch[], boxes: FarBox[]) {
    const outs = [new Out(), new Out(), new Out()];
    const soup = new Soup();
    const samples = lowerSamples(s, true);
    const pick = [3, 5, 6, 8, 12]; // rocker, widest, upper side, shoulder, top centre
    const secs = samples.map(sm => { const P = lowerSection(s, sm.z, sm.mode); return pick.map(i => P[i]); });
    const dark = trim('blackMatte');
    for (let k = 0; k < samples.length - 1; k++) {
        const A = secs[k], B = secs[k + 1], za = samples[k].z, zb = samples[k + 1].z, zm = (za + zb) / 2;
        const inBed = !!s.bed && zm > s.bed.z0 && zm < s.bed.z1;
        for (let i = 0; i < pick.length - 1; i++) {
            const r = i === 3 && inBed ? dark : i === 0 && s.cladding ? dark : R_PAINT;
            for (const sd of [1, -1]) {
                const a0: V3 = [A[i][0] * sd, A[i][1], za + endOffset(s, za, A[i][0], A[i][1])];
                const a1: V3 = [A[i + 1][0] * sd, A[i + 1][1], za + endOffset(s, za, A[i + 1][0], A[i + 1][1])];
                const b0: V3 = [B[i][0] * sd, B[i][1], zb + endOffset(s, zb, B[i][0], B[i][1])];
                const b1: V3 = [B[i + 1][0] * sd, B[i + 1][1], zb + endOffset(s, zb, B[i + 1][0], B[i + 1][1])];
                if (sd > 0) { soup.tri(a0, a1, b0, r); soup.tri(a1, b1, b0, r); }
                else { soup.tri(a0, b0, a1, r); soup.tri(a1, b0, b1, r); }
            }
        }
    }
    capEnd(soup, s, secs[0], samples[0].z, -1, R_PAINT);
    capEnd(soup, s, secs[secs.length - 1], samples[samples.length - 1].z, 1, R_PAINT);
    // greenhouse: base, rail, roof edge, centre at the marks only; glass is opaque
    const gpick = [0, 3, 5, 7];
    const glass = trim('glassFar');
    const zs = ghSampleZs(s, false);
    const gs = zs.map(z => { const m = markAt(s, z); const G = ghPoints(s, z, Math.abs(m.z - z) < 1e-6 ? m.slant ?? 0 : 0); return gpick.map(i => G[i]); });
    for (let k = 0; k < gs.length - 1; k++) {
        const mk = markAt(s, zs[k]);
        for (let i = 0; i < 3; i++) {
            const r = i === 0 ? (mk.side === 'glass' || mk.side === 'b' ? glass : R_PAINT) : i === 1 ? R_PAINT
                : mk.zone === 'ws' || mk.zone === 'bl' || mk.zone === 'backGlass' ? glass : R_PAINT;
            for (const sd of [1, -1]) {
                const m = (p: V3): V3 => [p[0] * sd, p[1], p[2]];
                const a0 = m(gs[k][i]), a1 = m(gs[k][i + 1]), b0 = m(gs[k + 1][i]), b1 = m(gs[k + 1][i + 1]);
                if (sd > 0) { soup.tri(a0, a1, b0, r); soup.tri(a1, b1, b0, r); }
                else { soup.tri(a0, b0, a1, r); soup.tri(a1, b0, b1, r); }
            }
        }
    }
    // dark wheel wells behind the wheels (the far body has no arch openings)
    const well = trim('under');
    for (const zc of s.axles) for (const sd of [1, -1]) {
        const R = s.archR + (s.flare ?? 0), x = sd * (s.hw + 0.012), yb = s.bottom.at(zc);
        const se = (u: number) => Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, u), s.archP)), 1 / s.archP);
        const pts: V3[] = [[x, yb, zc + R]];
        for (let i = 0; i <= 6; i++) { const dz = R * Math.cos(i / 6 * Math.PI); pts.push([x, s.archY + R * se(Math.abs(dz) / R), zc + dz]); }
        pts.push([x, yb, zc - R]);
        const c: V3 = [x, Math.max(yb, s.archY - 0.1), zc];
        for (let i = 0; i < pts.length - 1; i++) soup.triF(c, pts[i], pts[i + 1], [sd, 0, 0], well);
    }
    // wheels: hexagonal discs with a tread band, the rim a smaller hexagon just in front
    const rub = trim('rubber'), rim = trim('rimFar');
    for (const zc of s.axles) for (const sd of [1, -1]) {
        const xo = sd * (s.hw + 0.03), xi = sd * (s.hw - s.tyreW + 0.05), xr = xo + sd * 0.01;
        const P = (a: number, x: number, k = 1): V3 => [x, s.wheelR + Math.sin(a) * s.wheelR * k, zc + Math.cos(a) * s.wheelR * k];
        for (let i = 0; i < 6; i++) {
            const a = (i + 0.5) / 6 * Math.PI * 2, b = (i + 1.5) / 6 * Math.PI * 2, am = (a + b) / 2;
            soup.quadF(P(a, xi), P(b, xi), P(b, xo), P(a, xo), [0, Math.sin(am), Math.cos(am)], rub);
            soup.triF([xo, s.wheelR, zc], P(a, xo), P(b, xo), [sd, 0, 0], rub);
            soup.triF([xr, s.wheelR, zc], P(a, xr, 0.66), P(b, xr, 0.66), [sd, 0, 0], rim);
        }
    }
    // the big details: grilles, intakes, plates, bumpers
    for (const f of patches) for (const sd of f.mirror ? [1, -1] : [1]) {
        const m = (p: V3): V3 => [p[0] * sd, p[1], p[2]];
        soup.quadF(m(f.pts[0]), m(f.pts[1]), m(f.pts[2]), m(f.pts[3]), [f.facing[0] * sd, f.facing[1], f.facing[2]], trim(f.swatch));
    }
    for (const b of boxes) cbox(soup, b.c, b.h, 0, trim(b.swatch));
    // lamps
    for (const l of lamps) for (const sd of [1, -1]) {
        const dir = l.kind === 'head' ? -1 : 1, z = l.z + dir * 0.02, x = l.x * sd;
        soup.quadF([x - l.hw, l.y - l.hh, z], [x + l.hw, l.y - l.hh, z], [x + l.hw, l.y + l.hh, z], [x - l.hw, l.y + l.hh, z], [0, 0, dir],
            trim(l.kind === 'head' ? 'lampHead' : 'lampTail'));
    }
    flush(soup, 40, outs);
    return { paint: toGeometry(outs[PAINT], false), trim: toGeometry(outs[TRIM], true) };
}

// ---------------------------------------------------------------------------------
/** Night glow colours of the head and tail lamps. */
export const HALO_HEAD: V3 = [1, 0.93, 0.8], HALO_TAIL: V3 = [1, 0.1, 0.06];

export type StyleGeometry = {
    paint: THREE.BufferGeometry; trim: THREE.BufferGeometry; glass: THREE.BufferGeometry;
    wheel: THREE.BufferGeometry; wheelBlur: THREE.BufferGeometry;
    farPaint: THREE.BufferGeometry; farTrim: THREE.BufferGeometry;
    halos: THREE.BufferGeometry;    // glow points in front of the head / tail lamps (position + colour)
    beamZ: number;                  // where the headlight beam starts (just ahead of the nose)
    wheelPos: THREE.Vector3[];      // FL, FR, RL, RR wheel centres
    smokePos: THREE.Vector3;        // over the engine
    length: number; width: number; height: number;
};

type Extras = (soup: Soup, s: BodySpec, t: Tools) => void;
type Tools = {
    decal: typeof decal; cbox: typeof cbox; ring: typeof ring; trim: typeof trim; exhaust: typeof exhaust; R_PAINT: Route;
    frontZ: typeof frontZ; rearZ: typeof rearZ; sideX: typeof sideX; topY: typeof topY;
    /** Register a lamp (centre of a right-hand lamp, half sizes) for the far version and the night glow. */
    lamp: (kind: 'head' | 'tail', x: number, y: number, hw: number, hh: number) => void;
    /** A plain box shown only on the far version (e.g. a bumper that is a separate part). */
    farBox: (c: V3, h: V3, swatch: Swatch) => void;
    /** A flat front / rear patch at a fixed z shown only on the far version (e.g. a plate). */
    farQuad: (dir: number, x0: number, x1: number, y0: number, y1: number, z: number, swatch: Swatch) => void;
};

/**
 * Build a style's geometry in a few steps (each `yield` is a good place to let a frame
 * be drawn), so building a style never stalls the game for long.
 */
export function* buildStyleGeometry(s: BodySpec, extras: Extras, smokeY: number): Generator<void, StyleGeometry, void> {
    const outs = [new Out(), new Out(), new Out()];
    const body = new Soup(); buildLower(s, body);
    yield;
    flush(body, 38, outs);
    yield;
    const gh = new Soup(); buildGreenhouse(s, gh); flush(gh, 38, outs);
    yield;
    const lamps: Lamp[] = [], farPatches: FarPatch[] = [], farBoxes: FarBox[] = [];
    const tools: Tools = {
        decal: (soup, s, kind, a0, a1, b0, b1, o) => {
            decal(soup, s, kind, a0, a1, b0, b1, o);
            if (!o.far) return;
            const at = (a: number, b: number): V3 | null => {
                if (kind === 'side') { const x = sideX(s, a, b); return Number.isNaN(x) ? null : [x + 0.04, b, a]; }
                const z = kind === 'front' ? frontZ(s, a, b) : rearZ(s, a, b);
                return Number.isNaN(z) ? null : [a, b, z + (kind === 'front' ? -0.04 : 0.04)];
            };
            const pts = [at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)];
            if (pts.every(p => p)) farPatches.push({ facing: kind === 'front' ? [0, 0, -1] : kind === 'rear' ? [0, 0, 1] : [1, 0, 0], pts: pts as V3[], swatch: o.far, mirror: !!o.mirror });
        },
        cbox, ring, trim, exhaust, R_PAINT, frontZ, rearZ, sideX, topY,
        farBox: (c, h, swatch) => { farBoxes.push({ c, h, swatch }); },
        farQuad: (dir, x0, x1, y0, y1, z, swatch) => {
            const zz = z + dir * 0.02;
            farPatches.push({ facing: [0, 0, dir], pts: [[x0, y0, zz], [x1, y0, zz], [x1, y1, zz], [x0, y1, zz]], swatch, mirror: false });
        },
        lamp: (kind, x, y, hw, hh) => {
            const z = kind === 'head' ? frontZ(s, x, y) : rearZ(s, x, y);
            if (!Number.isNaN(z)) lamps.push({ kind, x, y, z, hw, hh });
        },
    };
    const ex = new Soup(); extras(ex, s, tools);
    yield;
    flush(ex, 40, outs);
    yield;
    const paint = toGeometry(outs[PAINT], false);
    const bb = paint.boundingBox!;
    const far = buildFar(s, lamps, farPatches, farBoxes);
    yield;
    // night glow: one point per lamp and side, a little in front of the lens
    const hp: number[] = [], hc: number[] = [], hd: number[] = [];
    for (const l of lamps) for (const sd of [1, -1]) {
        const dir = l.kind === 'head' ? -1 : 1;
        hp.push(l.x * sd, l.y, l.z + dir * 0.12);
        hc.push(...(l.kind === 'head' ? HALO_HEAD : HALO_TAIL));
        hd.push(dir); // the way the lamp faces (-1 forward, +1 back): seen only from that side
    }
    const halos = new THREE.BufferGeometry();
    halos.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3));
    halos.setAttribute('color', new THREE.Float32BufferAttribute(hc, 3));
    halos.setAttribute('lampDir', new THREE.Float32BufferAttribute(hd, 1));
    halos.computeBoundingSphere();
    return {
        paint, trim: toGeometry(outs[TRIM], true), glass: toGeometry(outs[GLASS], true),
        wheel: buildWheelGeometry(s.wheelR, s.tyreW, s.rimR), wheelBlur: buildWheelGeometry(s.wheelR, s.tyreW, s.rimR, true),
        farPaint: far.paint, farTrim: far.trim, halos, beamZ: bb.min.z,
        wheelPos: [[-1, 0], [1, 0], [-1, 1], [1, 1]].map(([sx, a]) => new THREE.Vector3(sx * s.wheelX, s.wheelR, s.axles[a])),
        smokePos: new THREE.Vector3(0, smokeY, s.axles[0] - 0.6),
        length: bb.max.z - bb.min.z, width: 2 * s.hw, height: bb.max.y,
    };
}
