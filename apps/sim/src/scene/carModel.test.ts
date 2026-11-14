import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

// carModel draws its shared textures on canvases and builds the lofted bodies from the atlas: stand-ins for both, so
// the mesh-body path can be checked without a browser
vi.mock('./car/carAtlas', async (orig) => ({ ...(await orig<object>()), getCarAtlas: () => ({ map: null, orm: null, emissive: null }), stepCarAtlas: () => true, disposeCarAtlas: () => {} }));
vi.mock('./car/carStyles', async () => {
    const T = await import('three');
    const box = () => new T.BoxGeometry(1, 1, 1);
    const geo = {
        paint: box(), trim: box(), glass: box(), wheel: box(), wheelBlur: box(), farPaint: box(), farTrim: box(),
        halos: (() => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute([0, 1, -4, 0, 1, 4], 3)); g.setAttribute('color', new T.Float32BufferAttribute([1, 1, 1, 1, 1, 1], 3)); g.setAttribute('lampDir', new T.Float32BufferAttribute([-1, 1], 1)); return g; })(),
        beamZ: -4.5, wheelPos: [[-1.5, -2.9], [1.5, -2.9], [-1.5, 2.7], [1.5, 2.7]].map(([x, z]) => new T.Vector3(x, 0.68, z)),
        smokePos: new T.Vector3(0, 1.5, -3.5), length: 9.4, width: 3.6, height: 3,
    };
    return { getStyleGeometry: () => geo, isStyleBuilt: () => true, stepStyle: () => true, disposeStyleGeometries: () => {} };
});
const ctx = new Proxy({}, { get: (_t, k) => k === 'createImageData' ? (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })
    : k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {} });
vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx, width: 0, height: 0 }) });

import { CAR_BODY_CHANGE, applyCarPaint, buildCarModel, carFrameTick, disposeCarModel, precompileCarsTick, setCarLights, syncCarWheels, updateCarLights, updateCars } from './carModel';
import { makeCarMeshCache, setCarMeshCache, type MicarExtras } from './car/carMeshes';

const EXTRAS: MicarExtras = {
    id: 'toyota-camry', category: 'sedan', length: 4.8, width: 2.0, height: 1.5, belt_height: 1.0, tyre_width: 0.22,
    wheels: { front: { z: -1.4, r: 0.35, y: 0.35, x_out: 0.98 }, rear: { z: 1.3, r: 0.42, y: 0.42, x_out: 0.96 } },
};
const fakeGltf = () => {
    const root = new THREE.Group();
    for (const name of ['body', 'far']) {
        const g = new THREE.Group(); g.name = name;
        for (const mat of ['paint', 'glass', 'dark']) { const geo = new THREE.BoxGeometry(2, 1.5, 4.8); geo.translate(0, 0.75, 0); g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: mat }))); }
        if (name === 'body') g.userData = { micar: JSON.stringify(EXTRAS) };
        root.add(g);
    }
    return root;
};

type Parts = { body: THREE.Mesh; trim: THREE.Mesh; glass: THREE.Mesh; wheelMesh: THREE.InstancedMesh; farBody: THREE.Mesh; farTrim: THREE.Mesh; halos: THREE.Points; length: number; width: number; mesh: string | null };
const partsOf = (g: THREE.Object3D) => g.userData.car as Parts;
const zLen = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox!.max.z - g.boundingBox!.min.z; };
const wheelAt = (p: Parts, i: number) => { const m = new THREE.Matrix4(); p.wheelMesh.getMatrixAt(i, m); const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(pos, q, s); return { pos, q, s }; };

let urls: string[] = [];
let release: () => void = () => {};
/** A loader that waits until the test lets it finish, so the lofted fallback can be seen first. */
const deferred = () => makeCarMeshCache(url => { urls.push(url); return new Promise(res => { release = () => res(fakeGltf()); }); }, () => '/');
// every test starts with the Camry already loaded (each one runs alone too); a test that needs a load installs its own cache
let loaded: ReturnType<typeof makeCarMeshCache>;
beforeAll(async () => { loaded = makeCarMeshCache(async () => fakeGltf(), () => '/'); await loaded.when('toyota-camry'); });
beforeEach(() => { urls = []; setCarMeshCache(loaded); });

describe('a car with its own model', () => {
    it('shows the lofted body while its model loads, then its own body, glass, dark trim, wheels and far version', async () => {
        setCarMeshCache(deferred());
        const { group } = buildCarModel('sedan', '#ff0000', 100, 100, 'toyota-camry');
        const c = partsOf(group);
        let changed = 0; group.addEventListener(CAR_BODY_CHANGE as never, () => { changed++; });
        expect(c.mesh).toBeNull();
        expect(zLen(c.body.geometry)).toBeCloseTo(1); // the stand-in lofted sedan
        expect(urls).toEqual(['/cars/toyota-camry.glb']);
        release(); await new Promise(r => setTimeout(r, 0));
        expect(c.mesh).toBe('toyota-camry');
        expect(changed).toBe(1); // so the Garage and the driven car fit their kit again
        expect(zLen(c.body.geometry)).toBeCloseTo(9.6, 4);
        expect(zLen(c.glass.geometry)).toBeCloseTo(9.6, 4);
        expect(zLen(c.trim.geometry)).toBeCloseTo(9.6, 4);
        expect(zLen(c.farBody.geometry)).toBeCloseTo(9.6, 4);
        expect(c.length).toBeCloseTo(9.6); expect(c.width).toBeCloseTo(4); // the contact shadow follows the model
        // the dark parts have no UVs: a plain black material, not the atlas trim
        const dark = c.trim.material as THREE.MeshStandardMaterial;
        expect(dark.map).toBeNull(); expect(dark.color.getHex()).toBeLessThan(0x202020);
        expect(c.farTrim.material).toBe(dark);
        // the per-car paint is kept on the new body and the far version
        expect((c.body.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('ff0000');
        expect(c.farBody.material).toBe(c.body.material);
        disposeCarModel(group);
    });

    it('a second car of the same model gets it at once, without a second fetch', () => {
        const { group } = buildCarModel('sedan', '#00ff00', 100, 100, 'toyota-camry');
        expect(partsOf(group).mesh).toBe('toyota-camry');
        expect(urls).toEqual([]);
        disposeCarModel(group);
    });

    it('keeps paint colour, rust, mud and broken glass working', () => {
        const { group, body } = buildCarModel('sedan', '#00ff00', 100, 100, 'toyota-camry');
        const c = partsOf(group), mat = body.material as THREE.MeshStandardMaterial;
        const u = mat.userData.carPaint as { carDirt: { value: number }; carRust: { value: number } };
        const clean = c.glass.material;
        applyCarPaint(body, '#3366cc', 20, true);
        expect(u.carRust.value).toBeGreaterThan(0); expect(u.carDirt.value).toBe(1);
        expect(c.glass.material).not.toBe(clean); // cracked glass on a wreck
        applyCarPaint(body, '#3366cc', 100, false);
        expect(u.carRust.value).toBe(0); expect(u.carDirt.value).toBe(0); expect(c.glass.material).toBe(clean);
        disposeCarModel(group);
    });

    it('places the wheels from the model, and they still roll and steer', () => {
        const { group, wheels, frontPivots } = buildCarModel('sedan', '#00ff00', 100, 100, 'toyota-camry');
        const c = partsOf(group);
        const fr = wheelAt(c, 1).pos, rl = wheelAt(c, 2);
        expect(fr.x).toBeCloseTo(0.98 * 2 - 0.22); expect(fr.z).toBeCloseTo(-2.8); expect(fr.y).toBeCloseTo(0.7);
        expect(rl.pos.x).toBeCloseTo(-(0.96 * 2 - 0.22)); expect(rl.pos.y).toBeCloseTo(0.84);
        expect(rl.s.x).toBeCloseTo(0.42 / 0.35); // the bigger rear tyres
        // the culling sphere is built from the placed wheels: it holds all four
        const sphere = c.wheelMesh.boundingSphere!;
        for (const i of [0, 1, 2, 3]) expect(sphere.containsPoint(wheelAt(c, i).pos)).toBe(true);
        frontPivots[0].rotation.y = 0.4; wheels[0].rotateX(0.3); syncCarWheels(group);
        const fl = wheelAt(c, 0);
        expect(fl.q.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.3);
        expect(fl.pos.z).toBeCloseTo(-2.8);
        disposeCarModel(group);
    });

    it('has no lamp glows yet: lights on leave the dark trim black and the glow hidden', () => {
        const { group } = buildCarModel('sedan', '#00ff00', 100, 100, 'toyota-camry');
        const c = partsOf(group), dark = c.trim.material;
        setCarLights(group, 'brake');
        expect(c.trim.material).toBe(dark); expect(c.farTrim.material).toBe(dark);
        expect(c.halos.visible).toBe(false);
        disposeCarModel(group);
    });

    it('lays the headlight beam on the road ahead of its own nose when driven at night', () => {
        const { group } = buildCarModel('sedan', '#00ff00', 100, 100, 'toyota-camry');
        const c = partsOf(group) as Parts & { tilt: THREE.Group };
        updateCarLights(1);
        updateCars(new THREE.Vector3(0, 5, 10), true, group);
        const beam = c.tilt.children.find(o => (o as THREE.Mesh).geometry instanceof THREE.PlaneGeometry) as THREE.Mesh;
        expect(beam).toBeTruthy(); expect(beam.visible).toBe(true);
        expect(beam.position.z).toBeCloseTo(-4.8 - 16.4, 4); // the model's nose (-4.8), not the lofted sedan's (-4.5)
        updateCarLights(1); // (the next frame's: the beam is made on the first night frame)
        expect((beam.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0);
        updateCarLights(0); updateCars(new THREE.Vector3(0, 5, 10), true, group);
        expect(beam.parent).toBeNull();
        disposeCarModel(group);
    });

    it('switches to its far version away from the camera', () => {
        const { group } = buildCarModel('sedan', '#00ff00', 100, 100, 'toyota-camry');
        const c = partsOf(group);
        const now = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 1e6); // past the 4-a-second LOD check
        updateCars(new THREE.Vector3(500, 0, 0), true, null);
        now.mockRestore();
        expect(c.body.visible).toBe(false); expect(c.wheelMesh.visible).toBe(false);
        expect(c.farBody.visible).toBe(true); expect(c.farTrim.visible).toBe(true);
        disposeCarModel(group);
    });

    it('a model arriving under a kit (wheel count 0) still culls its wheels by all four', async () => {
        setCarMeshCache(deferred());
        const { group } = buildCarModel('sedan', '#00ff00', 100, 100, 'toyota-camry');
        const c = partsOf(group);
        c.wheelMesh.count = 0; // what the Night Tuner kit's replaceWheels does
        release(); await new Promise(r => setTimeout(r, 0));
        expect(c.wheelMesh.count).toBe(0); // left as the kit set it
        c.wheelMesh.count = 4; // the kit comes off (removeWheels)
        for (const i of [0, 1, 2, 3]) expect(c.wheelMesh.boundingSphere!.containsPoint(wheelAt(c, i).pos)).toBe(true);
        disposeCarModel(group);
    });

    it('a car disposed before its model arrives is left alone', async () => {
        let done: () => void = () => {};
        setCarMeshCache(makeCarMeshCache(() => new Promise(res => { done = () => res(fakeGltf()); }), () => '/'));
        const { group } = buildCarModel('sedan', '#00ff00', 100, 100, 'honda-fit');
        const before = partsOf(group).body.geometry;
        disposeCarModel(group);
        done(); await new Promise(r => setTimeout(r, 0));
        expect(partsOf(group).body.geometry).toBe(before);
        expect(partsOf(group).mesh).toBeNull();
    });
});

describe('a car without its own model', () => {
    it('keeps the lofted body and asks for no file', () => {
        const { group } = buildCarModel('sedan', '#00ff00', 100, 100);
        const c = partsOf(group);
        expect(c.mesh).toBeNull(); expect(zLen(c.body.geometry)).toBeCloseTo(1);
        setCarLights(group, 'on');
        expect(c.trim.material).not.toBe(c.farBody.material);
        expect(urls).toEqual([]);
        disposeCarModel(group);
    });
});

describe('in a world that precompiles the car shaders', () => {
    it('a car with its own model keeps the lofted body until the precompile is done, so its first draw compiles nothing', async () => {
        setCarMeshCache(makeCarMeshCache(async () => fakeGltf(), () => '/'));
        const { group } = buildCarModel('sedan', '#00ff00', 100, 100, 'toyota-camry', true);
        await new Promise(r => setTimeout(r, 0)); // the model has loaded
        expect(partsOf(group).mesh).toBeNull();
        // a stand-in renderer: the precompile builds its probe, compiles, then draws it once
        const renderer = { compile() {}, render() {}, getScissorTest: () => false, getScissor: (v: THREE.Vector4) => v, setScissor() {}, setScissorTest() {}, shadowMap: { enabled: true, needsUpdate: false } } as unknown as THREE.WebGLRenderer;
        const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera();
        carFrameTick(); precompileCarsTick(renderer, scene, cam); // build + compile
        expect(partsOf(group).mesh).toBeNull();
        carFrameTick(); precompileCarsTick(renderer, scene, cam); // draw: done
        expect(partsOf(group).mesh).toBe('toyota-camry');
        // and once it is done, the next car gets its model at once
        const next = buildCarModel('sedan', '#0000ff', 100, 100, 'toyota-camry', true).group;
        expect(partsOf(next).mesh).toBe('toyota-camry');
        disposeCarModel(group); disposeCarModel(next);
    });
});

describe('when the player leaves the town before the precompile', () => {
    it('a model that arrives after the player left the town goes in at once (the hold is asked on arrival)', async () => {
        const { disposeSharedCarAssets } = await import('./carModel');
        disposeSharedCarAssets(); // no precompile done
        setCarMeshCache(deferred());
        let inTown = true;
        const { group } = buildCarModel('sedan', '#00ff00', 100, 100, 'honda-civic', () => inTown);
        inTown = false; // into the Strip while the model still loads
        release(); await new Promise(r => setTimeout(r, 0));
        expect(partsOf(group).mesh).not.toBeNull();
        disposeCarModel(group);
    });
    it('a held model waits for the precompile however long it takes, and goes in when the player leaves the town', async () => {
        const { disposeSharedCarAssets, releaseHeldCarBodies } = await import('./carModel');
        disposeSharedCarAssets(); // the precompile starts over: not done
        setCarMeshCache(makeCarMeshCache(async () => fakeGltf(), () => '/'));
        const t0 = performance.now();
        const { group } = buildCarModel('sedan', '#00ff00', 100, 100, 'honda-civic', true);
        await new Promise(r => setTimeout(r, 0));
        // a slow machine: a minute of frames and still no precompile done: no model yet (no shader stall)
        const s = vi.spyOn(performance, 'now').mockReturnValue(t0 + 60000); updateCars(new THREE.Vector3(), true, null); s.mockRestore();
        expect(partsOf(group).mesh).toBeNull();
        releaseHeldCarBodies(); // into the Strip: the town's precompile will not come
        expect(partsOf(group).mesh).not.toBeNull(); // (the stand-in model's extras name it toyota-camry)
        disposeCarModel(group);
    });
});
