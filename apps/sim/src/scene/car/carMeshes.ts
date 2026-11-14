import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildWheelGeometry } from './carGeometry';
import { meshLamps } from './meshLamps';
import { WORLD_PER_M } from '../../world/units';
import { gltfLoader, type Loader } from '../../world/strip/park';
import { getAssetBase } from '../../world/strip/district';
import { CAR_MODELS, modelIdOf, rowByGameName } from '../../carModels';

// Car models drawn from their own 3D model (a mesh body) instead of the lofted body of their style.
//
// Each model is a Draco .glb in public/cars/<id>.glb: metres, glTF axes (X right, Y up, nose toward -Z), tyres on
// y = 0. Its node `body` (~24k triangles) and `far` (~600) each hold three primitives, in materials `paint`, `glass`
// and `dark`; `body`'s extras.micar (a JSON string) holds the sizes and the wheels. The model's own wheels are fused
// to the body and painted dark: the sim's wheels are drawn over them, at the positions in the extras.
// A model is fetched the first time a car of it is built, once, and cached; until it arrives (and if it never does)
// the car shows its lofted body.

/** The models that have a file in public/cars (the finished ones: carModels.json). */
export const MESH_MODELS: ReadonlySet<string> = new Set(CAR_MODELS.map(r => r.id));
/** The model file id of a car, by its real name (Chevy Tahoe → chevrolet-tahoe) or its game name (Akura ABX →
 *  acura-adx), or null when it has no model file. */
export function carMeshId(make?: string | null, model?: string | null): string | null {
    if (!make || !model) return null;
    const id = modelIdOf(make.trim().toLowerCase() === 'chevy' ? 'Chevy' : make, model);
    return MESH_MODELS.has(id) ? id : rowByGameName(make, model)?.id ?? null;
}
export const carMeshUrl = (id: string, base: string) => base + 'cars/' + id + '.glb';

// ---------------------------------------------------------------------------------
export type MicarWheel = { z: number; r: number; y: number; x_out: number };
export type MicarExtras = {
    id: string; category: string; length: number; width: number; height: number; belt_height: number; tyre_width: number;
    wheels: { front: MicarWheel; rear: MicarWheel };
};
const num = (v: unknown, what: string) => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('micar extras: bad ' + what); return v; };
/** The extras.micar of a model's body node (the JSON string, or already parsed). Throws when a size or wheel is missing. */
export function parseMicar(raw: unknown): MicarExtras {
    const o = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown> | null;
    if (!o || typeof o !== 'object') throw new Error('micar extras: not an object');
    for (const k of ['length', 'width', 'height', 'belt_height', 'tyre_width']) num(o[k], k);
    const w = o.wheels as Record<string, Record<string, unknown>> | undefined;
    if (!w || !w.front || !w.rear) throw new Error('micar extras: no wheels');
    for (const a of ['front', 'rear']) for (const k of ['z', 'r', 'y', 'x_out']) num(w[a][k], a + '.' + k);
    return o as unknown as MicarExtras;
}

// ---------------------------------------------------------------------------------
/** The geometry set of a mesh body, in car space at world scale (2 units per metre), like a lofted style's. */
export type MeshGeometry = {
    id: string;
    paint: THREE.BufferGeometry; glass: THREE.BufferGeometry; dark: THREE.BufferGeometry;
    farPaint: THREE.BufferGeometry; farDark: THREE.BufferGeometry; // the far version: its glass is drawn dark
    wheel: THREE.BufferGeometry; wheelBlur: THREE.BufferGeometry;
    wheelPos: THREE.Vector3[];      // FL, FR, RL, RR wheel centres
    wheelScale: number[];           // per wheel: its radius over the wheel geometry's (front and rear tyres differ)
    wheelR: number; tyreW: number;  // the wheel geometry's radius (the front tyre's) and width
    halos: THREE.BufferGeometry;    // the night glow in front of each lamp (meshLamps), as the lofted bodies' halos
    lamps: THREE.BufferGeometry | null; // the lamp lenses fitted to the model (meshLamps; null: none could be fitted)
    smokePos: THREE.Vector3; beamZ: number;
    length: number; width: number; height: number;
};

const S = WORLD_PER_M;
/** The `paint`, `glass` and `dark` geometry under one node, baked to car space at world scale. */
/** `needGlass`: false for a far version, whose windows may be too small to have kept. */
function partsUnder(root: THREE.Object3D, node: THREE.Object3D, needGlass: boolean) {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const scale = new THREE.Matrix4().makeScale(S, S, S);
    const out: Record<string, THREE.BufferGeometry[]> = { paint: [], glass: [], dark: [] };
    node.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const name = (Array.isArray(m.material) ? m.material[0] : m.material)?.name ?? '';
        const key = Object.keys(out).find(k => name === k || name.startsWith(k + '.'));
        if (!key) return;
        const g = m.geometry.clone();
        for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a); // (glass gets UVs below)
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(scale, new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)));
        out[key].push(g);
    });
    const one = (k: string, need: boolean) => {
        if (!out[k].length) { if (need) throw new Error(`car model: no ${k} in ${node.name}`); return null; }
        return mergeAll(out[k]);
    };
    return { paint: one('paint', true)!, glass: one('glass', needGlass), dark: one('dark', true)! };
}
/** The models have no UVs: give the glass a projected set (seen from its side, front or top, whichever it faces most),
 *  so a wreck's cracked-glass texture shows on it. About 0.3 of the crack picture per world unit. */
function glassUVs(g: THREE.BufferGeometry) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = new Float32Array(p.count * 2), K = 0.3;
    for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
        const [u, v] = ax >= ay && ax >= az ? [p.getZ(i), p.getY(i)] : az >= ay ? [p.getX(i), p.getY(i)] : [p.getX(i), p.getZ(i)];
        uv[i * 2] = u * K; uv[i * 2 + 1] = v * K;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
/** Geometries as one (indexed ones made plain when they are mixed), with its bounds. */
function mergeAll(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const mixed = gs.some(g => g.index) && gs.some(g => !g.index);
    const g = gs.length === 1 ? gs[0] : mergeGeometries(mixed ? gs.map(x => x.index ? x.toNonIndexed() : x) : gs, false);
    if (!g) throw new Error('car model: could not merge its parts');
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
}
/** Build a mesh body's geometry set from a loaded model (what GLTFLoader gives). Throws when the model is malformed. */
export function meshGeometryFrom(root: THREE.Object3D): MeshGeometry {
    let bodyNode: THREE.Object3D | undefined, farNode: THREE.Object3D | undefined;
    root.traverse(o => {
        if (!bodyNode && o.name === 'body' && o.userData?.micar !== undefined) bodyNode = o;
        if (!farNode && o.name === 'far') farNode = o;
    });
    if (!bodyNode) throw new Error('car model: no body node with extras.micar');
    if (!farNode) throw new Error('car model: no far node');
    const ex = parseMicar(bodyNode.userData.micar);
    const near = partsUnder(root, bodyNode, true), far = partsUnder(root, farNode, false);
    glassUVs(near.glass!); // (the far glass is drawn dark: it needs none)
    const { front, rear } = ex.wheels;
    const tw = ex.tyre_width * S, R = front.r * S;
    const wheelPos = ([[-1, front], [1, front], [-1, rear], [1, rear]] as const)
        .map(([sx, w]) => new THREE.Vector3(sx * (w.x_out * S - tw / 2), w.y * S, w.z * S));
    const rs = rear.r / front.r;
    const { lamps, halos } = meshLamps(near.paint, near.dark, ex.category, ex.belt_height * S);
    const bb = near.paint.boundingBox!;
    return {
        id: ex.id, paint: near.paint, glass: near.glass!, dark: near.dark, farPaint: far.paint,
        farDark: far.glass ? mergeAll([far.glass, far.dark]) : far.dark,
        wheel: buildWheelGeometry(R, tw, R * 0.66), wheelBlur: buildWheelGeometry(R, tw, R * 0.66, true),
        wheelPos, wheelScale: [1, 1, rs, rs], wheelR: R, tyreW: tw, halos, lamps,
        smokePos: new THREE.Vector3(0, ex.belt_height * S, front.z * S - 0.6), beamZ: bb.min.z,
        length: ex.length * S, width: ex.width * S, height: ex.height * S,
    };
}

// ---------------------------------------------------------------------------------
export type CarMeshCache = {
    /** The model's geometry if loaded; otherwise starts loading it (once) and returns null. */
    request(id: string): MeshGeometry | null;
    /** The model's geometry once loaded (null if it failed); starts loading it if needed. */
    when(id: string): Promise<MeshGeometry | null>;
    /** Free the GPU copies (the world closed); the parsed models stay for the next world. */
    dispose(): void;
};
/** A cache of mesh bodies: each model fetched once with `load` from `base()`/cars/, a failure remembered (lofted body). */
export function makeCarMeshCache(load: Loader, base: () => string): CarMeshCache {
    const ready = new Map<string, MeshGeometry | null>();
    const pending = new Map<string, Promise<MeshGeometry | null>>();
    const when = (id: string): Promise<MeshGeometry | null> => {
        if (ready.has(id)) return Promise.resolve(ready.get(id)!);
        let p = pending.get(id);
        if (!p) {
            p = load(carMeshUrl(id, base())).then(meshGeometryFrom).catch(err => { console.warn('car model', id, err); return null; })
                .then(mg => { ready.set(id, mg); pending.delete(id); return mg; });
            pending.set(id, p);
        }
        return p;
    };
    return {
        request: id => { if (ready.has(id)) return ready.get(id)!; void when(id); return null; },
        when,
        dispose: () => {
            for (const mg of ready.values()) if (mg) for (const g of [mg.paint, mg.glass, mg.dark, mg.farPaint, mg.farDark, mg.wheel, mg.wheelBlur, mg.lamps]) g?.dispose();
        },
    };
}
let active: CarMeshCache | null = null;
/** The session's mesh bodies (from public/cars, through the circuits' Draco loader). */
export const carMeshes = (): CarMeshCache => active ??= makeCarMeshCache(gltfLoader(carLoaders, getAssetBase), getAssetBase);
/** Only the two loaders, three's own (a small chunk), not the whole three-stdlib bundle the circuits load (~2.4 MB): the
 *  town needs no more. */
const carLoaders = () => Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/loaders/DRACOLoader.js')])
    .then(([g, d]) => ({ GLTFLoader: g.GLTFLoader, DRACOLoader: d.DRACOLoader }) as unknown as Pick<typeof import('three-stdlib'), 'GLTFLoader' | 'DRACOLoader'>);
/** Use another cache (tests). */
export const setCarMeshCache = (c: CarMeshCache | null) => { active = c; };

let darkMat: THREE.MeshStandardMaterial | null = null;
/** The mesh bodies' black trim (bumpers, grilles, tyres fused to the body): the models have no UVs for the atlas. */
export const meshDarkMaterial = () => darkMat ??= new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
export const disposeMeshDarkMaterial = () => { darkMat?.dispose(); darkMat = null; };
