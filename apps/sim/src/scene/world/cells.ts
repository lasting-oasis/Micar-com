import * as THREE from 'three';
import { GeoBuilder } from './meshBuilder';

// Culling in cells, packed into few draw calls.
//
// Scenery that is spread over the whole map (street paving, lamps, furniture, trees) is
// grouped by grid cell. A few times a second, with whatever camera is drawing the main
// scene, every cell is tested against the view (and the sun's shadow box), and the
// visible cells are *packed* into one mesh per material / plant type: merged geometry
// by rewriting its index buffer, instanced plants by rewriting their instance buffers.
// So far-off and out-of-view cells cost nothing, and the draw-call count stays at one
// per material or plant type however many cells are in view. Plants also switch per
// cell between a full model and a cheap far version.

export const CELL = 150;
export const cellKeyOf = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
/** Beyond this distance (from the camera to a cell's edge) plants use their far version. */
export const NEAR_DISTANCE = 375;

export type CullView = {
    frustum: THREE.Frustum;          // the camera's view, widened (the camera turns between updates)
    shadow: THREE.Frustum | null;    // the sun's shadow box (High graphics)
    camPos: THREE.Vector3;
};
export interface Culled { cull(view: CullView, force: boolean): void }
/** Something updated before every render of the main scene (cheap work only). */
export interface PerFrame { frame(camera: THREE.Camera): void }

const isVisible = (s: THREE.Sphere, view: CullView, margin: number) => {
    const r = s.radius;
    s.radius = r + margin;
    const vis = view.frustum.intersectsSphere(s) || (!!view.shadow && view.shadow.intersectsSphere(s));
    s.radius = r;
    return vis;
};

/**
 * Calls every registered item with the current view, just before each render of the
 * main scene (from the scene's onBeforeRender, so before three.js decides what to draw
 * and uploads changed buffers). Updates when the camera has moved or turned noticeably,
 * or every 300 ms.
 */
export class CullingDriver {
    private items: Culled[] = [];
    private lastCam: THREE.Camera | null = null;
    private lastPos = new THREE.Vector3(1e9, 0, 0);
    private lastDir = new THREE.Vector3();
    private lastAt = -1e9;
    private dirty = true;
    private sun: THREE.DirectionalLight | null = null;
    private readonly wide = new THREE.PerspectiveCamera();
    private readonly view: CullView = { frustum: new THREE.Frustum(), shadow: null, camPos: new THREE.Vector3() };
    private readonly m = new THREE.Matrix4();
    private readonly dir = new THREE.Vector3();

    constructor(scene: THREE.Scene) {
        const driver = this, before = scene.onBeforeRender;
        // (three.js calls a scene's onBeforeRender with the render target as 4th argument)
        scene.onBeforeRender = function (this: THREE.Scene, renderer: THREE.WebGLRenderer, sc: THREE.Scene, camera: THREE.Camera, ...rest: unknown[]) {
            (before as (...a: unknown[]) => void).call(this, renderer, sc, camera, ...rest);
            if (rest[0]) return; // (not for renders into a texture)
            driver.update(renderer, scene, camera);
            for (const f of driver.perFrame) f.frame(camera);
        } as unknown as THREE.Scene['onBeforeRender'];
    }

    readonly perFrame: PerFrame[] = [];
    register(item: Culled) { this.items.push(item); this.dirty = true; }
    /** Something changed (e.g. plants added): repack on the next render. */
    invalidate() { this.dirty = true; }

    private update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
        if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return;
        const cam = camera as THREE.PerspectiveCamera;
        const now = performance.now();
        cam.getWorldDirection(this.dir);
        const moved = cam !== this.lastCam || cam.position.distanceToSquared(this.lastPos) > 64 || this.dir.dot(this.lastDir) < 0.996;
        if (!this.dirty && !moved && now - this.lastAt < 300) return;
        if (!this.dirty && cam === this.lastCam && now - this.lastAt < 120) return; // a few times a second at most while moving
        const force = this.dirty;
        this.dirty = false;
        this.lastCam = cam; this.lastPos.copy(cam.position); this.lastDir.copy(this.dir); this.lastAt = now;

        // the view, widened so turning between updates doesn't reveal unpacked cells
        this.wide.copy(cam);
        this.wide.fov = Math.min(150, cam.fov * 1.2);
        this.wide.updateProjectionMatrix();
        this.view.frustum.setFromProjectionMatrix(this.m.multiplyMatrices(this.wide.projectionMatrix, cam.matrixWorldInverse));
        this.view.camPos.copy(cam.position);
        // the sun's shadow box (as of the last frame: it follows the player)
        if (!this.sun) scene.traverse(o => { if (!this.sun && (o as THREE.DirectionalLight).isDirectionalLight) this.sun = o as THREE.DirectionalLight; });
        this.view.shadow = renderer.shadowMap.enabled && this.sun?.castShadow ? this.sun.shadow.getFrustum() : null;
        for (const item of this.items) item.cull(this.view, force);
    }
}

type CellGeo = { b: GeoBuilder; start: number; count: number; sphere: THREE.Sphere };

/**
 * One merged mesh whose triangles are grouped by cell; only visible cells are drawn
 * (the index buffer is rewritten when the visible set changes).
 */
export class PackedMesh implements Culled {
    readonly mesh: THREE.Mesh;
    private cells = new Map<string, CellGeo>();
    private list: CellGeo[] = [];
    private master: Uint32Array | null = null;
    private active: THREE.BufferAttribute | null = null;
    private lastKey = '';
    private readonly visSphere = new THREE.Sphere();

    constructor(material: THREE.Material, { castShadow = false, receiveShadow = true, flatGround = false } = {}) {
        const g = new THREE.BufferGeometry();
        // Ground layers sort as flat ground (drawn last) from the start: see utils.groundLastOpaqueSort
        g.boundingBox = flatGround ? new THREE.Box3(new THREE.Vector3(-5000, 0, -5000), new THREE.Vector3(5000, 0.2, 5000)) : new THREE.Box3(new THREE.Vector3(-5000, 0, -5000), new THREE.Vector3(5000, 50, 5000));
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), -1);
        this.mesh = new THREE.Mesh(g, material);
        this.mesh.castShadow = castShadow;
        this.mesh.receiveShadow = receiveShadow;
        this.mesh.userData.dynamic = true; // never merged by the static batcher
        this.mesh.matrixAutoUpdate = false;
    }

    /** The builder for the cell containing (x, z): add geometry near that point only. */
    at(x: number, z: number) {
        const k = cellKeyOf(x, z);
        let c = this.cells.get(k);
        if (!c) { c = { b: new GeoBuilder(), start: 0, count: 0, sphere: new THREE.Sphere() }; this.cells.set(k, c); }
        return c.b;
    }

    /** Builds the merged geometry (once, before the first draw). */
    private finish() {
        const parts = [...this.cells.values()].map(c => ({ c, d: c.b.export() })).filter(p => p.d.idx.length);
        let nv = 0, ni = 0;
        parts.forEach(p => { nv += p.d.pos.length / 3; ni += p.d.idx.length; });
        const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
        let v = 0, i = 0;
        const box = new THREE.Box3(), p = new THREE.Vector3();
        for (const { c, d } of parts) {
            pos.set(d.pos, v * 3); nor.set(d.nor, v * 3); uv.set(d.uv, v * 2);
            for (let k = 0; k < d.idx.length; k++) idx[i + k] = d.idx[k] + v;
            box.makeEmpty();
            for (let k = 0; k < d.pos.length; k += 3) box.expandByPoint(p.set(d.pos[k], d.pos[k + 1], d.pos[k + 2]));
            box.getBoundingSphere(c.sphere);
            c.start = i; c.count = d.idx.length;
            v += d.pos.length / 3; i += d.idx.length;
            this.list.push(c);
        }
        this.cells.forEach(c => { c.b = null as unknown as GeoBuilder; }); // free the builders
        const g = this.mesh.geometry;
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        this.master = idx;
        this.active = new THREE.BufferAttribute(new Uint32Array(Math.max(3, ni)), 1);
        this.active.setUsage(THREE.DynamicDrawUsage);
        g.setIndex(this.active);
        g.setDrawRange(0, 0);
    }

    cull(view: CullView, force: boolean) {
        if (!this.master) this.finish();
        const vis = this.list.filter(c => isVisible(c.sphere, view, 20));
        const key = vis.map(c => c.start).join(',');
        if (!force && key === this.lastKey) return;
        this.lastKey = key;
        const a = this.active!, arr = a.array as Uint32Array;
        let n = 0;
        this.visSphere.makeEmpty();
        for (const c of vis) {
            arr.set(this.master!.subarray(c.start, c.start + c.count), n);
            n += c.count;
            this.visSphere.union(c.sphere);
        }
        // (an empty draw range would still issue an empty draw call: hide the mesh instead)
        this.mesh.visible = n > 0;
        if (n) { a.clearUpdateRanges(); a.addUpdateRange(0, n); a.needsUpdate = true; }
        this.mesh.geometry.setDrawRange(0, n);
        this.mesh.geometry.boundingSphere!.copy(this.visSphere);
    }
}
