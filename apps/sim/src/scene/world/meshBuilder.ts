import * as THREE from 'three';

// Builds one BufferGeometry from many flat pieces (paving, paint, curbs), so a whole road
// layer becomes one mesh (and, after the static batcher, one draw call per material).

type V3 = [number, number, number];
type UV = [number, number];
export type UVFn = (x: number, y: number, z: number) => UV;
const zeroUV: UVFn = () => [0, 0];

export class GeoBuilder {
    private pos: number[] = [];
    private nor: number[] = [];
    private uvs: number[] = [];
    private idx: number[] = [];

    get empty() { return this.idx.length === 0; }

    /** A planar convex polygon (fan), turned to face `normal`; `uv` maps a world point to UVs. */
    poly(points: V3[], normal: V3, uv: UVFn = zeroUV) {
        if (points.length < 3) return;
        // Newell's method: the polygon's normal, robust to collinear corners
        let cx = 0, cy = 0, cz = 0;
        points.forEach((p, i) => {
            const q = points[(i + 1) % points.length];
            cx += (p[1] - q[1]) * (p[2] + q[2]); cy += (p[2] - q[2]) * (p[0] + q[0]); cz += (p[0] - q[0]) * (p[1] + q[1]);
        });
        const flip = cx * normal[0] + cy * normal[1] + cz * normal[2] < 0;
        const base = this.pos.length / 3;
        for (const p of points) {
            this.pos.push(p[0], p[1], p[2]);
            this.nor.push(normal[0], normal[1], normal[2]);
            this.uvs.push(...uv(p[0], p[1], p[2]));
        }
        for (let i = 1; i < points.length - 1; i++) {
            if (flip) this.idx.push(base, base + i + 1, base + i);
            else this.idx.push(base, base + i, base + i + 1);
        }
    }

    /** Flat, upward-facing convex polygon at height y. */
    flat(pts: [number, number][], y: number, uv: UVFn = zeroUV) {
        this.poly(pts.map(([x, z]) => [x, y, z] as V3), [0, 1, 0], uv);
    }

    /** Flat axis-aligned rectangle. */
    rect(x0: number, z0: number, x1: number, z1: number, y: number, uv: UVFn = zeroUV) {
        this.flat([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], y, uv);
    }

    /** Flat strip of `width` along the segment (x1,z1)-(x2,z2), with square ends extended by `cap`. */
    strip(x1: number, z1: number, x2: number, z2: number, width: number, y: number, uv: UVFn = zeroUV, cap = 0) {
        const len = Math.hypot(x2 - x1, z2 - z1);
        if (len < 1e-6) return;
        const dx = (x2 - x1) / len, dz = (z2 - z1) / len, nx = -dz * width / 2, nz = dx * width / 2;
        const ax = x1 - dx * cap, az = z1 - dz * cap, bx = x2 + dx * cap, bz = z2 + dz * cap;
        this.flat([[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]], y, uv);
    }

    /** Vertical quad from (x1,z1) to (x2,z2) between heights y0 and y1, facing the side (nx, nz). */
    wall(x1: number, z1: number, x2: number, z2: number, y0: number, y1: number, nx: number, nz: number, uv: UVFn = zeroUV) {
        this.poly([[x1, y0, z1], [x2, y0, z2], [x2, y1, z2], [x1, y1, z1]], [nx, 0, nz], uv);
    }

    /** Quad strip between two polylines at heights (a sloped band such as a grass berm). */
    band(inner: [number, number][], yIn: number, outer: [number, number][], yOut: number, uv: UVFn = zeroUV) {
        for (let i = 0; i + 1 < inner.length; i++) {
            const p: V3[] = [[inner[i][0], yIn, inner[i][1]], [inner[i + 1][0], yIn, inner[i + 1][1]], [outer[i + 1][0], yOut, outer[i + 1][1]], [outer[i][0], yOut, outer[i][1]]];
            // normal of a gentle slope: mostly up
            const ex = p[1][0] - p[0][0], ez = p[1][2] - p[0][2], fx = p[3][0] - p[0][0], fy = p[3][1] - p[0][1], fz = p[3][2] - p[0][2];
            let n: V3 = [-ez * fy, ez * fx - ex * fz, ex * fy]; // (p1 - p0) x (p3 - p0)
            const l = Math.hypot(n[0], n[1], n[2]) || 1;
            n = [n[0] / l, n[1] / l, n[2] / l];
            if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
            this.poly(p, n, uv);
        }
    }

    /**
     * Appends a three.js geometry (e.g. a low-poly cylinder) moved by `matrix`; its UVs are
     * replaced by `uv` when given (props pick a palette colour by UV).
     */
    geometry(src: THREE.BufferGeometry, matrix: THREE.Matrix4, uv?: [number, number]) {
        const g = src;
        const pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute, suv = g.attributes.uv as THREE.BufferAttribute | undefined;
        const nm = new THREE.Matrix3().getNormalMatrix(matrix);
        const v = new THREE.Vector3(), n = new THREE.Vector3();
        const base = this.pos.length / 3;
        for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
            n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
            this.pos.push(v.x, v.y, v.z);
            this.nor.push(n.x, n.y, n.z);
            if (uv) this.uvs.push(uv[0], uv[1]); else this.uvs.push(suv ? suv.getX(i) : 0, suv ? suv.getY(i) : 0);
        }
        const flip = matrix.determinant() < 0;
        if (g.index) {
            const ix = g.index;
            for (let i = 0; i < ix.count; i += 3) {
                const a = ix.getX(i) + base, b = ix.getX(i + 1) + base, c = ix.getX(i + 2) + base;
                if (flip) this.idx.push(a, c, b); else this.idx.push(a, b, c);
            }
        } else {
            for (let i = 0; i < pos.count; i += 3) {
                if (flip) this.idx.push(base + i, base + i + 2, base + i + 1); else this.idx.push(base + i, base + i + 1, base + i + 2);
            }
        }
    }

    /** Arbitrary indexed triangles with their own (smooth) normals. */
    mesh(points: V3[], normals: V3[], indices: number[], uv: UVFn = zeroUV) {
        const base = this.pos.length / 3;
        points.forEach((p, i) => {
            this.pos.push(p[0], p[1], p[2]);
            this.nor.push(normals[i][0], normals[i][1], normals[i][2]);
            this.uvs.push(...uv(p[0], p[1], p[2]));
        });
        for (const i of indices) this.idx.push(base + i);
    }

    /** The raw arrays (for packing several builders into one buffer). */
    export() { return { pos: this.pos, nor: this.nor, uv: this.uvs, idx: this.idx }; }

    build() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
        g.setIndex(this.idx);
        g.computeBoundingSphere();
        g.computeBoundingBox();
        return g;
    }
}

/** Clips a convex polygon to an axis-aligned rectangle (Sutherland–Hodgman). */
export const clipToRect = (poly: [number, number][], x0: number, z0: number, x1: number, z1: number) => {
    const clip = (pts: [number, number][], inside: (p: [number, number]) => boolean, cut: (a: [number, number], b: [number, number]) => [number, number]) => {
        const out: [number, number][] = [];
        pts.forEach((cur, i) => {
            const prev = pts[(i + pts.length - 1) % pts.length];
            if (inside(cur)) { if (!inside(prev)) out.push(cut(prev, cur)); out.push(cur); }
            else if (inside(prev)) out.push(cut(prev, cur));
        });
        return out;
    };
    const atX = (x: number) => (a: [number, number], b: [number, number]): [number, number] => [x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])];
    const atZ = (z: number) => (a: [number, number], b: [number, number]): [number, number] => [a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]), z];
    let p = poly;
    p = clip(p, q => q[0] >= x0, atX(x0)); if (p.length < 3) return p;
    p = clip(p, q => q[0] <= x1, atX(x1)); if (p.length < 3) return p;
    p = clip(p, q => q[1] >= z0, atZ(z0)); if (p.length < 3) return p;
    p = clip(p, q => q[1] <= z1, atZ(z1));
    return p;
};

// ---- Painted lettering ("STOP", "DELIVERY") from straight strokes --------------------------
// Letters in a unit box (x right, y up), squarish like road stencils. Painted elongated
// along the viewing direction, as real road lettering is, so it reads at a low angle.
const FONT: Record<string, [number, number][][]> = {
    A: [[[0, 0], [0, 0.72], [0.5, 1], [1, 0.72], [1, 0]], [[0, 0.46], [1, 0.46]]],
    C: [[[1, 0.82], [0.8, 1], [0, 1], [0, 0], [0.8, 0], [1, 0.18]]],
    D: [[[0, 0], [0, 1], [0.7, 1], [1, 0.78], [1, 0.22], [0.7, 0], [0, 0]]],
    E: [[[1, 1], [0, 1], [0, 0], [1, 0]], [[0, 0.5], [0.78, 0.5]]],
    F: [[[1, 1], [0, 1], [0, 0]], [[0, 0.52], [0.78, 0.52]]],
    G: [[[1, 0.82], [0.8, 1], [0, 1], [0, 0], [1, 0], [1, 0.45], [0.55, 0.45]]],
    H: [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0.5], [1, 0.5]]],
    I: [[[0.5, 0], [0.5, 1]]],
    K: [[[0, 0], [0, 1]], [[1, 1], [0, 0.45]], [[0.35, 0.6], [1, 0]]],
    L: [[[0, 1], [0, 0], [1, 0]]],
    N: [[[0, 0], [0, 1], [1, 0], [1, 1]]],
    O: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
    P: [[[0, 0], [0, 1], [1, 1], [1, 0.48], [0, 0.48]]],
    R: [[[0, 0], [0, 1], [1, 1], [1, 0.5], [0, 0.5]], [[0.45, 0.5], [1, 0]]],
    S: [[[1, 1], [0, 1], [0, 0.52], [1, 0.48], [1, 0], [0, 0]]],
    T: [[[0, 1], [1, 1]], [[0.5, 1], [0.5, 0]]],
    U: [[[0, 1], [0, 0], [1, 0], [1, 1]]],
    V: [[[0, 1], [0.5, 0], [1, 1]]],
    W: [[[0, 1], [0.22, 0], [0.5, 0.6], [0.78, 0], [1, 1]]],
    X: [[[0, 0], [1, 1]], [[0, 1], [1, 0]]],
    Y: [[[0, 1], [0.5, 0.5], [1, 1]], [[0.5, 0.5], [0.5, 0]]],
};

/**
 * Paints `text` centred on (cx, cz), readable by someone facing (fx, fz) (letter tops point
 * that way). Letter size w x h metres, stroke width in metres.
 */
export function paintText(b: GeoBuilder, text: string, cx: number, cz: number, fx: number, fz: number,
    w: number, h: number, stroke: number, y: number, uv: UVFn) {
    const fl = Math.hypot(fx, fz); fx /= fl; fz /= fl;
    const rx = -fz, rz = fx; // reader's right
    const gap = w * 0.38;
    const widthOf = (ch: string) => (ch === 'I' ? stroke : w);
    const chars = [...text];
    const total = chars.reduce((sum, ch) => sum + widthOf(ch), 0) + (chars.length - 1) * gap;
    const s = stroke / 2;
    let lx0 = -total / 2;
    chars.forEach(ch => {
        const strokes = FONT[ch], lw = widthOf(ch), x0 = lx0;
        lx0 += lw + gap;
        if (!strokes) return;
        // keep the strokes inside the letter box: inset by half a stroke
        const at = ([px, py]: [number, number]): [number, number] => {
            const lx = x0 + s + px * (lw - stroke), ly = -h / 2 + s + py * (h - stroke);
            return [cx + rx * lx + fx * ly, cz + rz * lx + fz * ly];
        };
        strokes.forEach(line => {
            for (let k = 0; k + 1 < line.length; k++) {
                const [ax, az] = at(line[k]), [bx, bz] = at(line[k + 1]);
                b.strip(ax, az, bx, bz, stroke, y, uv, s);
            }
        });
    });
}
