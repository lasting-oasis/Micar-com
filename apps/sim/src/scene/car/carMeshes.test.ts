import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { CAR_CATALOG } from '../../carCatalog';
import {
    MESH_MODELS, carMeshId, carMeshUrl, parseMicar, meshGeometryFrom, makeCarMeshCache, type MicarExtras,
} from './carMeshes';

// a sample of finished models (every one is checked below): the pilot's that stayed finished
const SAMPLE = ['toyota-camry', 'honda-civic', 'chevrolet-camaro', 'bmw-4-series', 'honda-fit', 'chevrolet-tahoe', 'honda-odyssey', 'ford-f-150'];
const publicDir = fileURLToPath(new URL('../../../public/', import.meta.url));

/** The JSON chunk of a .glb file. */
const glbJson = (path: string) => {
    const b = readFileSync(path);
    expect(b.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
    const len = b.readUInt32LE(12);
    expect(b.readUInt32LE(16)).toBe(0x4e4f534a); // 'JSON'
    return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
};

const EXTRAS: MicarExtras = {
    id: 'test-car', category: 'sedan', length: 4.8, width: 2.0, height: 1.5, belt_height: 1.0, tyre_width: 0.22,
    wheels: { front: { z: -1.4, r: 0.35, y: 0.35, x_out: 0.98 }, rear: { z: 1.3, r: 0.42, y: 0.42, x_out: 0.96 } },
};
/** A stand-in for what GLTFLoader gives for one of these files: nodes `body` and `far`, each a group of three meshes. */
const fakeGltf = (extras: unknown = EXTRAS) => {
    const root = new THREE.Group();
    const node = (name: string, size: number) => {
        const g = new THREE.Group(); g.name = name;
        for (const mat of ['paint', 'glass', 'dark']) {
            // a box 4.8 m long (z), 2 m wide, standing on y = 0, nose toward -Z
            const geo = new THREE.BoxGeometry(2, 1.5, size); geo.translate(0, 0.75, 0);
            const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: mat })); m.name = name + '_' + mat;
            g.add(m);
        }
        return g;
    };
    const body = node('body', 4.8); body.userData = { micar: JSON.stringify(extras) };
    root.add(body, node('far', 4.8));
    return root;
};

describe('which cars have their own model', () => {
    it('the finished models include the pilot ones, but not the two since marked flawed (back in Blender)', () => {
        for (const id of SAMPLE) expect(MESH_MODELS.has(id)).toBe(true);
        expect(MESH_MODELS.has('ford-mustang')).toBe(false); expect(MESH_MODELS.has('toyota-rav4')).toBe(false);
    });
    it('names a car by make and model the way the model files are named', () => {
        expect(carMeshId('Toyota', 'Camry')).toBe('toyota-camry');
        expect(carMeshId('Chevy', 'Tahoe')).toBe('chevrolet-tahoe');
        expect(carMeshId('BMW', '4 Series')).toBe('bmw-4-series');
        expect(carMeshId('Ford', 'F-150')).toBe('ford-f-150');
        expect(carMeshId('honda', 'odyssey')).toBe('honda-odyssey');
    });
    it('cars without a model file keep the lofted body (no request for a file that is not there)', () => {
        expect(carMeshId('Toyota', 'Supra')).toBeNull();
        expect(carMeshId('Ford', 'Ranger')).toBeNull();
        expect(carMeshId(undefined, 'Camry')).toBeNull();
        expect(carMeshId('Toyota', undefined)).toBeNull();
    });
    it('every pilot model is a car of the world\'s catalog', () => {
        const ids = Object.entries(CAR_CATALOG).flatMap(([make, ms]) => ms.map(m => carMeshId(make, m.model))).filter(Boolean);
        for (const id of SAMPLE) expect(ids).toContain(id);
    });
    it('serves the files from the sim\'s static assets', () => {
        expect(carMeshUrl('toyota-camry', '/')).toBe('/cars/toyota-camry.glb');
        expect(carMeshUrl('honda-fit', '/base/')).toBe('/base/cars/honda-fit.glb');
    });
});

describe('the model files', () => {
    for (const id of MESH_MODELS) it(id + ': a body and a far version, each in paint, glass and dark, with wheels in its extras', () => {
        const path = publicDir + 'cars/' + id + '.glb';
        expect(existsSync(path)).toBe(true);
        const j = glbJson(path);
        expect(j.extensionsRequired).toContain('KHR_draco_mesh_compression');
        const names = j.nodes.map((n: { name: string }) => n.name);
        expect(names).toEqual(expect.arrayContaining(['body', 'far']));
        for (const nm of ['body', 'far']) {
            const node = j.nodes.find((n: { name: string }) => n.name === nm);
            const mats = j.meshes[node.mesh].primitives.map((p: { material: number }) => j.materials[p.material].name);
            // the near body has all three; a far version may have no glass (the Mustang's: its windows are too small)
            if (nm === 'body') expect(mats.sort()).toEqual(['dark', 'glass', 'paint']);
            else expect(mats).toEqual(expect.arrayContaining(['dark', 'paint']));
        }
        const ex = parseMicar(j.nodes.find((n: { name: string }) => n.name === 'body').extras.micar);
        expect(ex.id).toBe(id);
        expect(ex.length).toBeGreaterThan(2.4); expect(ex.length).toBeLessThan(6.5); // (a Smart Fortwo is 2.7 m)
        expect(ex.wheels.front.z).toBeLessThan(0); expect(ex.wheels.rear.z).toBeGreaterThan(0); // nose toward -Z
    });
});

describe('reading the extras', () => {
    it('takes the JSON string or an object', () => {
        expect(parseMicar(JSON.stringify(EXTRAS)).wheels.rear.r).toBe(0.42);
        expect(parseMicar(EXTRAS).tyre_width).toBe(0.22);
    });
    it('refuses extras without wheels or sizes', () => {
        expect(() => parseMicar('not json')).toThrow();
        expect(() => parseMicar({ ...EXTRAS, wheels: undefined })).toThrow();
        expect(() => parseMicar({ ...EXTRAS, wheels: { front: EXTRAS.wheels.front } })).toThrow();
        expect(() => parseMicar({ ...EXTRAS, length: 'long' })).toThrow();
    });
});

describe('the geometry set built from a model', () => {
    const mg = meshGeometryFrom(fakeGltf());
    it('is in world units: 2 per metre', () => {
        const bb = new THREE.Box3().setFromBufferAttribute(mg.paint.getAttribute('position') as THREE.BufferAttribute);
        expect(bb.max.z - bb.min.z).toBeCloseTo(9.6, 5);
        expect(bb.max.y).toBeCloseTo(3, 5); expect(bb.min.y).toBeCloseTo(0, 5);
        expect(mg.length).toBeCloseTo(9.6); expect(mg.width).toBeCloseTo(4); expect(mg.height).toBeCloseTo(3);
        expect(mg.beamZ).toBeCloseTo(-4.8, 5);
    });
    it('has the paint, the glass, the dark trim and a far version (paint, and glass merged into the dark)', () => {
        for (const g of [mg.paint, mg.glass, mg.dark, mg.farPaint, mg.farDark]) {
            expect(g.getAttribute('position').count).toBeGreaterThan(0);
            expect(g.getAttribute('normal')).toBeTruthy();
        }
        const n = (g: THREE.BufferGeometry) => g.index ? g.index.count : g.getAttribute('position').count;
        expect(n(mg.farDark)).toBe(2 * n(mg.farPaint)); // far glass + far dark, the two boxes the same size as the paint
    });
    it('places the sim\'s wheels from the extras, the tyre\'s outer face at x_out', () => {
        const tw = 0.22 * 2;
        const [fl, fr, rl, rr] = mg.wheelPos;
        expect(fl.x).toBeCloseTo(-(0.98 * 2 - tw / 2)); expect(fr.x).toBeCloseTo(0.98 * 2 - tw / 2);
        expect(rl.x).toBeCloseTo(-(0.96 * 2 - tw / 2)); expect(rr.x).toBeCloseTo(0.96 * 2 - tw / 2);
        expect(fl.y).toBeCloseTo(0.7); expect(rl.y).toBeCloseTo(0.84);
        expect(fl.z).toBeCloseTo(-2.8); expect(rr.z).toBeCloseTo(2.6);
        // one wheel geometry sized for the front tyres; the rear ones scaled to their own radius
        const wb = new THREE.Box3().setFromBufferAttribute(mg.wheel.getAttribute('position') as THREE.BufferAttribute);
        expect(wb.max.y).toBeCloseTo(0.7, 2);
        expect(wb.max.x - wb.min.x).toBeCloseTo(tw, 2);
        expect(wb.max.x).toBeCloseTo(tw / 2, 2); // outer face toward +X
        expect(mg.wheelScale).toEqual([1, 1, 0.42 / 0.35, 0.42 / 0.35].map(v => expect.closeTo(v, 6)));
        expect(mg.wheelBlur.getAttribute('position').count).toBeGreaterThan(0);
    });
    it('gives the glass UVs (the models have none), so the cracked glass of a wreck shows; the paint and trim need none', () => {
        const uv = mg.glass.getAttribute('uv');
        expect(uv).toBeTruthy(); expect(uv.count).toBe(mg.glass.getAttribute('position').count);
        let lo = Infinity, hi = -Infinity; for (let i = 0; i < uv.count; i++) { lo = Math.min(lo, uv.getX(i)); hi = Math.max(hi, uv.getX(i)); }
        expect(hi - lo).toBeGreaterThan(0.5); // spread over the glass, not one texel
        expect(mg.paint.getAttribute('uv')).toBeUndefined();
    });
    it('puts the engine smoke over the front axle and has no lamp glows yet', () => {
        expect(mg.smokePos.z).toBeLessThan(-2.8);
        expect(mg.smokePos.y).toBeCloseTo(2);
        expect(mg.halos.getAttribute('position').count).toBe(0);
    });
    it('copes with a node transform the loader left on the meshes', () => {
        const root = fakeGltf(); root.getObjectByName('body')!.position.set(0, 0, 0.5);
        const g = meshGeometryFrom(root);
        const bb = new THREE.Box3().setFromBufferAttribute(g.paint.getAttribute('position') as THREE.BufferAttribute);
        expect(bb.min.z).toBeCloseTo(-3.8, 5);
    });
    it('a far version without glass is still a far version (its dark trim alone)', () => {
        const root = fakeGltf(); const f = root.getObjectByName('far')!; f.remove(f.children[1]);
        const g = meshGeometryFrom(root);
        const n = (x: THREE.BufferGeometry) => x.index ? x.index.count : x.getAttribute('position').count;
        expect(n(g.farDark)).toBe(n(g.farPaint));
    });
    it("refuses a model without a body, a far version or one of the near body's three materials", () => {
        const noFar = fakeGltf(); noFar.remove(noFar.getObjectByName('far')!);
        expect(() => meshGeometryFrom(noFar)).toThrow(/far/);
        const noGlass = fakeGltf(); const b = noGlass.getObjectByName('body')!; b.remove(b.children[1]);
        expect(() => meshGeometryFrom(noGlass)).toThrow(/glass/);
        expect(() => meshGeometryFrom(fakeGltf({ id: 'x' }))).toThrow();
    });
});

describe('loading on demand, once', () => {
    const flush = () => new Promise(r => setTimeout(r, 0));
    it('fetches each model once, however many cars ask, and hands every car the same geometry', async () => {
        const urls: string[] = [];
        const cache = makeCarMeshCache(async url => { urls.push(url); return fakeGltf(); }, () => '/');
        expect(cache.request('toyota-camry')).toBeNull(); // not loaded yet: the car shows its lofted body
        expect(cache.request('toyota-camry')).toBeNull();
        const a = await cache.when('toyota-camry');
        const b = cache.request('toyota-camry');
        expect(a).toBeTruthy(); expect(b).toBe(a);
        expect(urls).toEqual(['/cars/toyota-camry.glb']);
        cache.request('honda-fit'); await flush();
        expect(urls).toEqual(['/cars/toyota-camry.glb', '/cars/honda-fit.glb']);
    });
    it('a model that fails to load leaves the car lofted and is not fetched again', async () => {
        let n = 0;
        const cache = makeCarMeshCache(async () => { n++; throw new Error('404'); }, () => '/');
        expect(await cache.when('honda-fit')).toBeNull();
        expect(cache.request('honda-fit')).toBeNull();
        await flush();
        expect(n).toBe(1);
    });
    it('a model whose file is malformed fails the same way', async () => {
        const cache = makeCarMeshCache(async () => new THREE.Group(), () => '/');
        expect(await cache.when('honda-fit')).toBeNull();
    });
    it('frees the GPU copies when the world closes but keeps the parsed models for the next one', async () => {
        const cache = makeCarMeshCache(async () => fakeGltf(), () => '/');
        const mg = (await cache.when('toyota-rav4'))!;
        let freed = 0; mg.paint.addEventListener('dispose', () => freed++);
        cache.dispose();
        expect(freed).toBe(1);
        expect(cache.request('toyota-rav4')).toBe(mg);
    });
});
