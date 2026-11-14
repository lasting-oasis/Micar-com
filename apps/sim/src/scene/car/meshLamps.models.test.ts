import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { meshGeometryFrom } from './carMeshes';

// The lamp lenses on every shipped model (public/cars/*.glb), measured independently of how meshLamps places them: at 7
// points of each lens triangle, a ray from 1 m out along z (the way the lamp faces) back to the body; the gap is where
// the body's first surface is, behind the lens (+) or in front of it (-: the lens hidden there). Near lenses against the
// near body, far lenses against the far body. The ceilings guard what the fitting achieves today; a change that hides,
// floats, strands or drops more lenses fails here.

const CARS = join(dirname(fileURLToPath(import.meta.url)), '../../../public/cars');
const S = 2; // world units per metre
// The ceilings, in lens triangles of ~34,700 (today's counts at c9f6fac, then a margin): hidden in places (24 near, 30
// far), far off the far body (17) and stranded (3 near, 6 far)
const NEAR_HIDDEN = 36, FAR_HIDDEN = 45, FAR_OFF = 30, NEAR_NONE = 6, FAR_NONE = 10;

/** three's own Draco decoder (the one the game's DRACOLoader runs in a worker), in node: GLTFLoader's draco hook. */
async function dracoHook() {
    const req = createRequire(import.meta.url), dir = dirname(req.resolve('three/examples/jsm/libs/draco/draco_wasm_wrapper.js'));
    // (an emscripten script: in node it asks for `require` and `__dirname`)
    const factory = new Function('require', '__dirname', readFileSync(join(dir, 'draco_wasm_wrapper.js'), 'utf8') + '\nreturn DracoDecoderModule;')(req, dir);
    // (its module is a thenable that resolves to itself: wait for onModuleLoaded, never `await` it)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const draco: any = await new Promise(res => factory({ wasmBinary: readFileSync(join(dir, 'draco_decoder.wasm')), onModuleLoaded: res }));
    const types: Record<string, { new (b: ArrayBuffer, o: number, n: number): ArrayLike<number> & { slice(): unknown }; BYTES_PER_ELEMENT: number }> =
        { Float32Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array };
    const dt: Record<string, number> = { Float32Array: draco.DT_FLOAT32, Int8Array: draco.DT_INT8, Int16Array: draco.DT_INT16, Int32Array: draco.DT_INT32,
        Uint8Array: draco.DT_UINT8, Uint16Array: draco.DT_UINT16, Uint32Array: draco.DT_UINT32 };
    return {
        preload() { return this; },
        decodeDracoFile(buf: ArrayBuffer, done: (g: THREE.BufferGeometry) => void, ids: Record<string, number>, tmap: Record<string, string>) {
            const decoder = new draco.Decoder(), mesh = new draco.Mesh(), array = new Int8Array(buf);
            const st = decoder.DecodeArrayToMesh(array, array.byteLength, mesh);
            if (!st.ok()) throw new Error('draco: ' + st.error_msg());
            const g = new THREE.BufferGeometry();
            for (const name in ids) {
                const tn = tmap[name] in types ? tmap[name] : 'Float32Array', T = types[tn];
                const a = decoder.GetAttributeByUniqueId(mesh, ids[name]), nc = a.num_components(), nv = nc * mesh.num_points(), bl = nv * T.BYTES_PER_ELEMENT;
                const ptr = draco._malloc(bl);
                decoder.GetAttributeDataArrayForAllPoints(mesh, a, dt[tn], bl, ptr);
                g.setAttribute(name, new THREE.BufferAttribute(new T(draco.HEAPF32.buffer, ptr, nv).slice() as unknown as THREE.TypedArray, nc));
                draco._free(ptr);
            }
            const ni = mesh.num_faces() * 3, ptr = draco._malloc(ni * 4);
            decoder.GetTrianglesUInt32Array(mesh, ni * 4, ptr);
            g.setIndex(new THREE.BufferAttribute(new Uint32Array(draco.HEAPF32.buffer, ptr, ni).slice(), 1));
            draco._free(ptr); draco.destroy(mesh); draco.destroy(decoder);
            done(g);
        },
    };
}

/** For each lens triangle, at 7 points of it (its centre, and near each corner and each edge's middle): the gap (world
 *  units) to the first surface of `body` behind that point, along z: the axis the lamps face and are seen along (the lens
 *  facets themselves may tilt with the body); Infinity: none within 1 m either way. The rays being z-aligned, the body's
 *  triangles are bucketed on x/y once and a ray tests its bucket's (three's Raycaster gives the same numbers, slower). */
function gaps(lamps: THREE.BufferGeometry, body: THREE.BufferGeometry[]): number[][] {
    const CELL = 0.1 * S, tris: number[] = [], grid = new Map<number, number[]>(), key = (i: number, j: number) => (i + 4096) * 8192 + j + 4096;
    for (const g of body) {
        const p = g.getAttribute('position'), idx = g.getIndex(), n = idx ? idx.count : p.count;
        for (let t = 0; t + 2 < n; t += 3) {
            const o = tris.length / 9;
            for (let k = 0; k < 3; k++) { const v = idx ? idx.getX(t + k) : t + k; tris.push(p.getX(v), p.getY(v), p.getZ(v)); }
            const q = o * 9, x0 = Math.min(tris[q], tris[q + 3], tris[q + 6]), x1 = Math.max(tris[q], tris[q + 3], tris[q + 6]);
            const y0 = Math.min(tris[q + 1], tris[q + 4], tris[q + 7]), y1 = Math.max(tris[q + 1], tris[q + 4], tris[q + 7]);
            for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) {
                const k = key(i, j); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(o);
            }
        }
    }
    /** The gap at (x, y, z) on a lens facing `dir` (-1 nose, 1 tail): a ray from 1 m out, back along -dir. */
    const gapAt = (x: number, y: number, z: number, dir: number) => {
        const from = z + dir * S;
        let best = Infinity;
        for (const o of grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) {
            const q = o * 9, ax = tris[q], ay = tris[q + 1], bx = tris[q + 3], by = tris[q + 4], cx = tris[q + 6], cy = tris[q + 7];
            const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
            if (Math.abs(d) < 1e-12) continue; // edge-on to the ray
            const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, l3 = 1 - l1 - l2;
            if (l1 < 0 || l2 < 0 || l3 < 0) continue;
            const dist = dir * (from - (l1 * tris[q + 2] + l2 * tris[q + 5] + l3 * tris[q + 8])); // along the ray
            if (dist >= 0 && dist <= 2 * S && dist < best) best = dist;
        }
        return best - S;
    };
    // the sample points, as barycentric weights: the centre; near each corner and each edge's middle (5% in from the edge)
    const W = [[1 / 3, 1 / 3, 1 / 3], [.9, .05, .05], [.05, .9, .05], [.05, .05, .9], [.475, .475, .05], [.05, .475, .475], [.475, .05, .475]];
    const p = lamps.getAttribute('position'), n = lamps.getAttribute('normal'), idx = lamps.getIndex()!, out: number[][] = [];
    for (let t = 0; t < idx.count; t += 3) {
        const v = [0, 1, 2].map(k => idx.getX(t + k)), dir = Math.sign(n.getZ(v[0]));
        out.push(W.map(w => gapAt(
            w[0] * p.getX(v[0]) + w[1] * p.getX(v[1]) + w[2] * p.getX(v[2]),
            w[0] * p.getY(v[0]) + w[1] * p.getY(v[1]) + w[2] * p.getY(v[2]),
            w[0] * p.getZ(v[0]) + w[1] * p.getZ(v[1]) + w[2] * p.getZ(v[2]), dir)));
    }
    return out;
}
/** A lens triangle is hidden where any of its points has the body in front of it; off the body when its centre has the
 *  body more than 15 cm back; stranded when its centre has no body within 1 m (beside the body, or over a hole in it). */
const hidden = (g: number[]) => g.some(x => x < 0);
const off = (g: number[]) => Number.isFinite(g[0]) && g[0] > 0.15 * S;
const stranded = (g: number[]) => !Number.isFinite(g[0]);

describe('the lamp lenses on every shipped model', () => {
    it("stand clear of the body, near and far: hidden, far-off and off-body lenses stay under ceilings set at today's counts", async () => {
        const hook = await dracoHook(), files = readdirSync(CARS).filter(f => f.endsWith('.glb')).sort();
        let tris = 0, farTris = 0, nearHidden = 0, farHidden = 0, farOff = 0, nearNone = 0, farNone = 0, both = 0;
        const headOnly: string[] = [], other: string[] = [];
        for (const f of files) {
            const buf = readFileSync(join(CARS, f)), loader = new GLTFLoader();
            loader.setDRACOLoader(hook as never);
            const gltf = await new Promise<{ scene: THREE.Object3D }>((res, rej) => loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res as never, rej));
            const mg = meshGeometryFrom(gltf.scene), dirs = Array.from(mg.halos.getAttribute('lampDir').array as Float32Array);
            if (dirs.length === 4) both++; else if (dirs.length === 2 && dirs.every(d => d < 0)) headOnly.push(f); else other.push(f);
            if (!mg.lamps) continue;
            const near = gaps(mg.lamps, [mg.paint, mg.dark]), far = gaps(mg.farLamps ?? mg.lamps, [mg.farPaint, mg.farDark]);
            tris += near.length; farTris += far.length;
            nearHidden += near.filter(hidden).length; farHidden += far.filter(hidden).length;
            farOff += far.filter(off).length;
            nearNone += near.filter(stranded).length; farNone += far.filter(stranded).length;
        }
        console.log(`lens audit: ${files.length} models (${both} both lamps, head only: ${headOnly.join(' ') || 'none'}), lens triangles near ${tris}, far ${farTris}; `
            + `hidden in places near ${nearHidden}, far ${farHidden}; far, centre over 15 cm off ${farOff}; centre with no body within 1 m near ${nearNone}, far ${farNone}`);
        expect(files.length).toBeGreaterThanOrEqual(362);
        expect(other).toEqual([]); // (no model without lamps, nor with tail lamps only)
        expect(headOnly).toEqual(['cadillac-xt6.glb']); // (a hole in its left rear: the Blender session's)
        expect(tris).toBeGreaterThan(34000); // today 34,704
        expect(farTris).toBeGreaterThan(34000); // today 34,516: the far version keeps (nearly) all its lenses
        expect(nearHidden).toBeLessThanOrEqual(NEAR_HIDDEN);
        expect(farHidden).toBeLessThanOrEqual(FAR_HIDDEN);
        expect(farOff).toBeLessThanOrEqual(FAR_OFF);
        expect(nearNone).toBeLessThanOrEqual(NEAR_NONE);
        expect(farNone).toBeLessThanOrEqual(FAR_NONE);
    }, 300000);
});
