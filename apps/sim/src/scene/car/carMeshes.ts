import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildWheelGeometry } from './carGeometry';
import { WORLD_PER_M } from '../../world/units';
import { gltfLoader, type Loader } from '../../world/strip/park';
import { getAssetBase } from '../../world/strip/district';

// Car models drawn from their own 3D model (a mesh body) instead of the lofted body of their style.
//
// Each model is a Draco .glb in public/cars/<id>.glb: metres, glTF axes (X right, Y up, nose toward -Z), tyres on
// y = 0. Its node `body` (~24k triangles) and `far` (~600) each hold three primitives, in materials `paint`, `glass`
// and `dark`; `body`'s extras.micar (a JSON string) holds the sizes and the wheels. The model's own wheels are fused
// to the body and painted dark: the sim's wheels are drawn over them, at the positions in the extras.
// A model is fetched the first time a car of it is built, once, and cached; until it arrives (and if it never does)
// the car shows its lofted body.

/** The models that have a file in public/cars (the pilot). */
export const MESH_MODELS: ReadonlySet<string> = new Set([
    'toyota-camry', 'honda-civic', 'ford-mustang', 'chevrolet-camaro', 'bmw-4-series',
    'honda-fit', 'toyota-rav4', 'chevrolet-tahoe', 'honda-odyssey', 'ford-f-150',
]);
const MAKE_IDS: Record<string, string> = { chevy: 'chevrolet' };
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** The model file id of a car (e.g. Chevy Tahoe → chevrolet-tahoe), or null when it has no model file. */
export function carMeshId(make?: string | null, model?: string | null): string | null {
    if (!make || !model) return null;
    const m = slug(make);
    const id = (MAKE_IDS[m] ?? m) + '-' + slug(model);
    return MESH_MODELS.has(id) ? id : null;
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
    halos: THREE.BufferGeometry;    // empty: mesh bodies have no lamp glows yet
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
        for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
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
    const { front, rear } = ex.wheels;
    const tw = ex.tyre_width * S, R = front.r * S;
    const wheelPos = ([[-1, front], [1, front], [-1, rear], [1, rear]] as const)
        .map(([sx, w]) => new THREE.Vector3(sx * (w.x_out * S - tw / 2), w.y * S, w.z * S));
    const rs = rear.r / front.r;
    const halos = new THREE.BufferGeometry();
    for (const [a, n] of [['position', 3], ['color', 3], ['lampDir', 1]] as const) halos.setAttribute(a, new THREE.Float32BufferAttribute([], n));
    const bb = near.paint.boundingBox!;
    return {
        id: ex.id, paint: near.paint, glass: near.glass!, dark: near.dark, farPaint: far.paint,
        farDark: far.glass ? mergeAll([far.glass, far.dark]) : far.dark,
        wheel: buildWheelGeometry(R, tw, R * 0.66), wheelBlur: buildWheelGeometry(R, tw, R * 0.66, true),
        wheelPos, wheelScale: [1, 1, rs, rs], wheelR: R, tyreW: tw, halos,
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
            for (const mg of ready.values()) if (mg) for (const g of [mg.paint, mg.glass, mg.dark, mg.farPaint, mg.farDark, mg.wheel, mg.wheelBlur]) g.dispose();
        },
    };
}
let active: CarMeshCache | null = null;
/** The session's mesh bodies (from public/cars, through the circuits' Draco loader). */
export const carMeshes = (): CarMeshCache => active ??= makeCarMeshCache(gltfLoader(() => import('three-stdlib'), getAssetBase), getAssetBase);
/** Use another cache (tests). */
export const setCarMeshCache = (c: CarMeshCache | null) => { active = c; };

let darkMat: THREE.MeshStandardMaterial | null = null;
/** The mesh bodies' black trim (bumpers, grilles, tyres fused to the body): the models have no UVs for the atlas. */
export const meshDarkMaterial = () => darkMat ??= new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
export const disposeMeshDarkMaterial = () => { darkMat?.dispose(); darkMat = null; };
