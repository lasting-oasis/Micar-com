import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { meshGeometryFrom } from './carMeshes';

// The lamp lenses on every shipped model (public/cars/*.glb), measured independently of how meshLamps places them: from
// 1 m out along each lens triangle's normal, a ray back to the body; the gap is where the body's first surface is,
// behind the lens (+) or in front of it (-: the lens hidden). Near lenses against the near body, far lenses against the
// far body. The ceilings guard what the fitting achieves today (4f7fba0: 6 near and 9 far hidden lens triangles of
// ~34,500, 17 far ones more than 15 cm off the far body); a change that hides or floats more lenses fails here.

const CARS = join(dirname(fileURLToPath(import.meta.url)), '../../../public/cars');
const S = 2; // world units per metre

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

/** For each lens triangle: the gap (world units) to the first surface of `body` behind it, along its normal; Infinity:
 *  none within 2 m. The lenses face along z, so the rays are z-aligned: the body's triangles are bucketed on x/y once,
 *  and a ray tests its bucket's (three's Raycaster gives the same numbers, at ~6x the time). */
function gaps(lamps: THREE.BufferGeometry, body: THREE.BufferGeometry[]): number[] {
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
    const p = lamps.getAttribute('position'), n = lamps.getAttribute('normal'), idx = lamps.getIndex()!, out: number[] = [];
    for (let t = 0; t < idx.count; t += 3) {
        let x = 0, y = 0, z = 0;
        for (let k = 0; k < 3; k++) { const v = idx.getX(t + k); x += p.getX(v) / 3; y += p.getY(v) / 3; z += p.getZ(v) / 3; }
        const dir = Math.sign(n.getZ(idx.getX(t))), from = z + dir * S; // the ray starts 1 m out and runs back along -dir
        expect(Math.abs(n.getZ(idx.getX(t)))).toBeCloseTo(1, 6); // (z-aligned: else this shortcut does not hold)
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
        out.push(best - S);
    }
    return out;
}

describe('the lamp lenses on every shipped model', () => {
    it('stand clear of the body, near and far, and none hangs in the air off the far body', async () => {
        const hook = await dracoHook(), files = readdirSync(CARS).filter(f => f.endsWith('.glb')).sort();
        let tris = 0, nearHidden = 0, farHidden = 0, farOff = 0, both = 0;
        const headOnly: string[] = [], none: string[] = [];
        for (const f of files) {
            const buf = readFileSync(join(CARS, f)), loader = new GLTFLoader();
            loader.setDRACOLoader(hook as never);
            const gltf = await new Promise<{ scene: THREE.Object3D }>((res, rej) => loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res as never, rej));
            const mg = meshGeometryFrom(gltf.scene), lamps = mg.halos.getAttribute('position').count;
            if (lamps === 4) both++; else if (lamps === 2) headOnly.push(f); else none.push(f);
            if (!mg.lamps) continue;
            const near = gaps(mg.lamps, [mg.paint, mg.dark]), far = gaps(mg.farLamps ?? mg.lamps, [mg.farPaint, mg.farDark]);
            tris += near.length;
            nearHidden += near.filter(g => g < 0).length;
            farHidden += far.filter(g => g < 0).length;
            farOff += far.filter(g => Number.isFinite(g) && g > 0.15 * S).length;
        }
        console.log(`lens audit: ${files.length} models (${both} both lamps, head only: ${headOnly.join(' ') || 'none'}), ${tris} lens triangles; hidden near ${nearHidden}, far ${farHidden}; far over 15 cm off ${farOff}`);
        expect(files.length).toBeGreaterThanOrEqual(362);
        expect(none).toEqual([]);
        expect(headOnly).toEqual(['cadillac-xt6.glb']); // (a hole in its left rear: the Blender session's)
        expect(tris).toBeGreaterThan(34000);
        expect(nearHidden).toBeLessThanOrEqual(10); // today 6
        expect(farHidden).toBeLessThanOrEqual(15); // today 9
        expect(farOff).toBeLessThanOrEqual(30); // today 17
    }, 300000);
});
