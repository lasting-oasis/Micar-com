import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seededRandom, VEG_V } from '../textures';
import { NEAR_DISTANCE, type Culled, type CullingDriver, type CullView } from './cells';

// Trees, bushes and hedges for the whole world. One material (a leaf / needle / bark
// atlas, baked ambient occlusion in vertex colours, a colour per plant). Plants are kept
// per 100-unit grid cell; a few times a second the cells in view (or in the sun's shadow
// box) are packed into one instanced mesh per shape (full models for cells within ~375
// units), one shared mesh of cheap far versions (26 triangles) out to 750 units and one
// of distant versions (10 triangles) beyond. Sizes are real (2 units per metre).

export type PlantKind = 'broadleaf' | 'roundleaf' | 'conifer' | 'bush' | 'hedge';
type Shape = 'broadleaf' | 'conifer' | 'bush' | 'hedge';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// per-vertex jitter from the vertex's own position, so seam duplicates move together
const hash3 = (x: number, y: number, z: number) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };

/** Maps the geometry's own UVs into an atlas band and adds a white vertex colour. */
const toBand = (g: THREE.BufferGeometry, band: readonly [number, number], uRepeat: number) => {
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uRepeat, lerp(band[0], band[1], uv.getY(i)));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(uv.count * 3).fill(1), 3));
    return g;
};

/** A lumpy foliage blob: jittered sphere, normals bent away from the crown centre (soft, round shading). */
function foliageLump(r: number, cx: number, cy: number, cz: number, crown: THREE.Vector3, crownBottom: number, crownTop: number, w: number, h: number, flatten = 1) {
    const g = toBand(new THREE.SphereGeometry(r, w, h), VEG_V.leaf, 2);
    const pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute, col = g.attributes.color as THREE.BufferAttribute;
    const p = new THREE.Vector3(), n = new THREE.Vector3(), radial = new THREE.Vector3(), c = new THREE.Vector3(cx, cy, cz);
    for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i);
        const k = 1 + (hash3(p.x * 3.1 + cx, p.y * 3.1 + cy, p.z * 3.1 + cz) - 0.5) * 0.28;
        p.multiplyScalar(k); p.y *= flatten; p.add(c);
        pos.setXYZ(i, p.x, p.y, p.z);
        radial.copy(p).sub(crown).normalize();
        n.fromBufferAttribute(nor, i).multiplyScalar(0.4).addScaledVector(radial, 0.75).normalize();
        nor.setXYZ(i, n.x, n.y, n.z);
        // ambient occlusion: dark underneath and inside the crown, bright on top and outside
        const up = smooth(crownBottom, crownTop, p.y), out = Math.max(0, n.dot(radial));
        const ao = Math.min(1.05, 0.3 + 0.5 * up + 0.3 * out);
        col.setXYZ(i, ao, ao, ao);
    }
    return g;
}

function trunk(r0: number, r1: number, h: number, segs: number, y0 = 0, tilt?: { ax: number; az: number }) {
    const g = toBand(new THREE.CylinderGeometry(r1, r0, h, segs, 1, true), VEG_V.bark, 1);
    g.translate(0, h / 2, 0);
    if (tilt) { g.rotateZ(tilt.az); g.rotateX(tilt.ax); }
    g.translate(0, y0, 0);
    const pos = g.attributes.position as THREE.BufferAttribute, col = g.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) { const ao = 0.62 + 0.38 * smooth(0, 2.2, pos.getY(i)); col.setXYZ(i, ao, ao, ao); }
    return g;
}

function mergeParts(parts: THREE.BufferGeometry[], scale: number) {
    const g = mergeGeometries(parts, false)!;
    parts.forEach(p => p.dispose());
    g.scale(scale, scale, scale);
    g.computeBoundingSphere();
    return g;
}

/** Broad-leaved street tree (about 8.5 m): a trunk forking into a crown of clustered foliage. */
function broadleafGeometry(rand: () => number) {
    const parts: THREE.BufferGeometry[] = [];
    const trunkH = 3.6;
    parts.push(trunk(0.24, 0.15, trunkH, 6));
    for (let i = 0; i < 2; i++) { // two limbs into the crown
        const a = (i / 2) * Math.PI * 2 + rand() * 0.6, lean = 0.5 + rand() * 0.25;
        parts.push(trunk(0.11, 0.06, 1.9, 4, trunkH - 0.35, { ax: Math.sin(a) * lean, az: -Math.cos(a) * lean }));
    }
    const cy = trunkH + 2.9, crown = new THREE.Vector3(0, cy, 0);
    const lumps: [number, number, number, number, number, number][] = [
        [0, cy + 0.2, 0, 2.15, 5, 4], [1.05, cy - 0.9, 0.55, 1.65, 5, 4], [-1.1, cy - 0.6, -0.7, 1.65, 5, 4], [-0.2, cy + 0.6, 1.15, 1.6, 5, 4]];
    lumps.forEach(([x, y, z, r, w, h]) => parts.push(foliageLump(r, x, y, z, crown, cy - 2.6, cy + 2.8, w, h)));
    return mergeParts(parts, 1.8);
}

/** Conifer (about 10 m): stacked, drooping tiers of needles with ragged rims. */
function coniferGeometry() {
    const parts: THREE.BufferGeometry[] = [trunk(0.2, 0.12, 2.2, 5)];
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
        const t = i / (tiers - 1), r = lerp(2.5, 0.95, t), h = lerp(3.3, 2.6, t), y0 = 1.3 + i * 1.85, seg = 8;
        const cone = toBand(new THREE.ConeGeometry(r, h, seg, 1, true), VEG_V.needle, 2);
        cone.translate(0, y0 + h / 2, 0);
        const pos = cone.attributes.position as THREE.BufferAttribute, nor = cone.attributes.normal as THREE.BufferAttribute, col = cone.attributes.color as THREE.BufferAttribute;
        const n = new THREE.Vector3();
        for (let k = 0; k < pos.count; k++) {
            let x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
            const rim = Math.abs(y - y0) < 0.01;
            if (rim) { // ragged, drooping rim
                const j = hash3(x * 1.7, i, z * 1.7), sc = 0.82 + 0.3 * j;
                x *= sc; z *= sc; y -= 0.15 + 0.35 * j;
                pos.setXYZ(k, x, y, z);
            }
            const rl = Math.hypot(x, z) || 1;
            n.set(x / rl, 0.75, z / rl).normalize();
            nor.setXYZ(k, n.x, n.y, n.z);
            const ao = rim ? lerp(0.45, 0.62, t) : lerp(0.85, 1.05, t);
            col.setXYZ(k, ao, ao, ao);
        }
        parts.push(cone);
        const cap = toBand(new THREE.CircleGeometry(r * 0.85, seg).rotateX(Math.PI / 2), VEG_V.needle, 1);
        cap.translate(0, y0 - 0.12, 0);
        const cc = cap.attributes.color as THREE.BufferAttribute;
        for (let k = 0; k < cc.count; k++) cc.setXYZ(k, 0.35, 0.35, 0.35);
        parts.push(cap);
    }
    return mergeParts(parts, 2.2);
}

/** Low rounded shrub (about 1.2 m). */
function bushGeometry() {
    const parts: THREE.BufferGeometry[] = [];
    const crown = new THREE.Vector3(0, 0.3, 0);
    ([[0, 0.55, 0, 0.78], [0.6, 0.42, 0.2, 0.58], [-0.45, 0.45, -0.4, 0.6]] as [number, number, number, number][])
        .forEach(([x, y, z, r]) => parts.push(foliageLump(r, x, y, z, crown, 0, 1.25, 5, 3, 0.8)));
    return mergeParts(parts, 2.0);
}

/** Clipped hedge segment, 2 m long (along x), 1.1 m tall: a box with a rounded-off top. */
function hedgeGeometry() {
    const g = toBand(new THREE.BoxGeometry(4.2, 2.2, 1.7, 1, 1, 1), VEG_V.leaf, 1);
    g.translate(0, 1.1, 0);
    const pos = g.attributes.position as THREE.BufferAttribute, col = g.attributes.color as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y > 2) pos.setZ(i, pos.getZ(i) * 0.82); // narrower top
        const ao = y < 0.1 ? 0.45 : 0.95;
        col.setXYZ(i, ao, ao, ao);
        uv.setX(i, uv.getX(i) * 2);
    }
    g.computeVertexNormals();
    return g;
}

/** The far version of any plant: a lantern-shaped crown on a thin trunk, 1 unit tall (26 triangles). */
function farGeometry() {
    const pos: number[] = [], nor: number[] = [], uvs: number[] = [], col: number[] = [], idx: number[] = [];
    const vert = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, ao: number) => {
        pos.push(x, y, z); const l = Math.hypot(nx, ny, nz) || 1; nor.push(nx / l, ny / l, nz / l); uvs.push(u, v); col.push(ao, ao, ao);
        return pos.length / 3 - 1;
    };
    // trunk: 3 sides
    for (let i = 0; i < 3; i++) {
        const a0 = (i / 3) * Math.PI * 2, a1 = ((i + 1) / 3) * Math.PI * 2, r = 0.025;
        const b0 = vert(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a0), 0, Math.sin(a0), 0, VEG_V.bark[0], 0.6);
        const b1 = vert(Math.cos(a1) * r, 0, Math.sin(a1) * r, Math.cos(a1), 0, Math.sin(a1), 1, VEG_V.bark[0], 0.6);
        const t0 = vert(Math.cos(a0) * r, 0.32, Math.sin(a0) * r, Math.cos(a0), 0, Math.sin(a0), 0, VEG_V.bark[1], 0.9);
        const t1 = vert(Math.cos(a1) * r, 0.32, Math.sin(a1) * r, Math.cos(a1), 0, Math.sin(a1), 1, VEG_V.bark[1], 0.9);
        idx.push(b0, t0, b1, b1, t0, t1);
    }
    // crown: bottom point, two 5-vertex rings, top point
    const ring = (y: number, r: number, ao: number, v: number) => Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2;
        return vert(Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(a), (y - 0.55) * 1.2, Math.sin(a), i / 6, v, ao);
    });
    const bottom = vert(0, 0.24, 0, 0, -1, 0, 0.5, VEG_V.leaf[0], 0.32);
    const A = ring(0.42, 0.5, 0.62, lerp(VEG_V.leaf[0], VEG_V.leaf[1], 0.35)), B = ring(0.72, 0.4, 0.9, lerp(VEG_V.leaf[0], VEG_V.leaf[1], 0.75));
    const top = vert(0, 1, 0, 0, 1, 0, 0.5, VEG_V.leaf[1], 1.0);
    for (let i = 0; i < 5; i++) {
        const j = (i + 1) % 5;
        idx.push(bottom, A[j], A[i]);
        idx.push(A[i], A[j], B[i], B[i], A[j], B[j]);
        idx.push(B[i], B[j], top);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
}

/** The distant version: a five-sided double pyramid on the same frame as the far one (10 triangles). */
function distantGeometry() {
    const pos: number[] = [], nor: number[] = [], uvs: number[] = [], col: number[] = [], idx: number[] = [];
    const vert = (x: number, y: number, z: number, nx: number, ny: number, nz: number, v: number, ao: number) => {
        pos.push(x, y, z); const l = Math.hypot(nx, ny, nz) || 1; nor.push(nx / l, ny / l, nz / l); uvs.push(0.5, v); col.push(ao, ao, ao);
        return pos.length / 3 - 1;
    };
    const bottom = vert(0, 0.2, 0, 0, -1, 0, VEG_V.leaf[0], 0.35);
    const ring = Array.from({ length: 5 }, (_, i) => { const a = (i / 5) * Math.PI * 2; return vert(Math.cos(a) * 0.48, 0.5, Math.sin(a) * 0.48, Math.cos(a), 0.15, Math.sin(a), lerp(VEG_V.leaf[0], VEG_V.leaf[1], 0.5), 0.75); });
    const top = vert(0, 1, 0, 0, 1, 0, VEG_V.leaf[1], 1.0);
    for (let i = 0; i < 5; i++) { const j = (i + 1) % 5; idx.push(bottom, ring[j], ring[i], ring[i], ring[j], top); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
}

// Per kind: the shape, the far version's size (width, height in units at scale 1) and
// colour factor, and per-plant colour multipliers (linear): greens from yellowish to
// bluish, the odd red shrub.
const KINDS: Record<PlantKind, { shape: Shape; far: [number, number] | null; farTint: [number, number, number]; tints: [number, number, number][] }> = {
    broadleaf: { shape: 'broadleaf', far: [9.2, 16.9], farTint: [1, 1, 1], tints: [[1, 1, 1], [1.1, 1.05, 0.8], [0.85, 0.96, 0.86], [0.96, 1.02, 0.75], [1.16, 1.02, 0.68], [0.8, 0.9, 0.84]] },
    roundleaf: { shape: 'broadleaf', far: [9.2, 16.9], farTint: [1, 1, 1], tints: [[1, 1, 1], [1.08, 1.06, 0.78], [0.88, 0.98, 0.84], [1.0, 0.95, 0.85]] },
    conifer: { shape: 'conifer', far: [8.4, 20.5], farTint: [0.66, 0.78, 0.82], tints: [[1, 1, 1], [0.86, 0.95, 1.02], [0.92, 1.02, 0.9], [1.05, 1.04, 0.95]] },
    bush: { shape: 'bush', far: [3.2, 2.6], farTint: [1, 1, 1], tints: [[1, 1, 1], [1.12, 1.06, 0.78], [0.85, 0.97, 0.86], [1.25, 0.82, 0.72], [0.95, 1.06, 0.9]] },
    hedge: { shape: 'hedge', far: null, farTint: [1, 1, 1], tints: [[1, 1, 1], [0.92, 1.0, 0.9], [1.04, 1.02, 0.86]] },
};
const SHAPES: Shape[] = ['broadleaf', 'conifer', 'bush', 'hedge'];
const VEG_CELL = 100;
/** Cells further than this use the distant version. */
const DISTANT = 750;
type Slot = Shape | 'far' | 'distant';
const SLOTS: Slot[] = [...SHAPES, 'far', 'distant'];

type Plant = { shape: Shape; near: Float32Array; far: Float32Array | null; color: [number, number, number]; farColor: [number, number, number] };
type Cell = { plants: Plant[]; sphere: THREE.Sphere; dirty: boolean; box: THREE.Box3 };

export function createVegetationKit(scene: THREE.Scene, driver: CullingDriver, disposables: THREE.Object3D[], materials: THREE.Material[], atlas: THREE.Texture) {
    const rand = seededRandom(9001);
    const material = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.9, metalness: 0 });
    materials.push(material);
    const CAP: Record<Shape, number> = { broadleaf: 2200, conifer: 1600, bush: 1200, hedge: 900 };
    const geos: Record<Shape, THREE.BufferGeometry> = { broadleaf: broadleafGeometry(rand), conifer: coniferGeometry(), bush: bushGeometry(), hedge: hedgeGeometry() };
    const near = {} as Record<Shape, THREE.InstancedMesh>;
    const mk = (name: string, geo: THREE.BufferGeometry, cap: number, shadows: boolean) => {
        const m = new THREE.InstancedMesh(geo, material, cap);
        m.name = `plants:${name}`;
        m.count = 0;
        m.castShadow = shadows; m.receiveShadow = true;
        m.setColorAt(0, new THREE.Color(1, 1, 1)); // allocate per-plant colours before the first draw
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
        m.boundingSphere = new THREE.Sphere(new THREE.Vector3(), -1);
        m.userData.dynamic = true;
        scene.add(m); disposables.push(m);
        return m;
    };
    SHAPES.forEach(s => { near[s] = mk(s, geos[s], CAP[s], s === 'broadleaf' || s === 'conifer'); });
    const far = mk('far', farGeometry(), 4000, false), distant = mk('distant', distantGeometry(), 6000, false);
    const meshOf: Record<Slot, THREE.InstancedMesh> = { ...near, far, distant };

    const cells = new Map<string, Cell>();
    const dummy = new THREE.Object3D();
    /** Plants one tree, bush or hedge segment at (x, z); `random` drives its size, turn and colour. */
    const add = (kind: PlantKind, x: number, z: number, random: () => number, scale = 1, rotY?: number) => {
        const K = KINDS[kind];
        const round = kind === 'roundleaf', hedge = kind === 'hedge';
        const s = scale * (hedge ? 1 : (0.82 + random() * 0.4) * (round ? 1.12 : 1));
        const sy = s * (hedge ? 1 : (0.9 + random() * 0.22) * (round ? 0.8 : 1));
        const ry = rotY ?? random() * Math.PI * 2;
        dummy.position.set(x, 0, z); dummy.rotation.set(0, ry, 0); dummy.scale.set(s, sy, s); dummy.updateMatrix();
        const nearM = new Float32Array(dummy.matrix.elements);
        let farM: Float32Array | null = null;
        if (K.far) { dummy.scale.set(s * K.far[0], sy * K.far[1], s * K.far[0]); dummy.updateMatrix(); farM = new Float32Array(dummy.matrix.elements); }
        const t = K.tints[Math.floor(random() * K.tints.length)], b = 0.86 + random() * 0.24;
        const color: [number, number, number] = [t[0] * b, t[1] * b, t[2] * b];
        const key = `${Math.floor(x / VEG_CELL)},${Math.floor(z / VEG_CELL)}`;
        let c = cells.get(key);
        if (!c) { c = { plants: [], sphere: new THREE.Sphere(), dirty: true, box: new THREE.Box3() }; cells.set(key, c); }
        c.plants.push({ shape: K.shape, near: nearM, far: farM, color, farColor: [color[0] * K.farTint[0], color[1] * K.farTint[1], color[2] * K.farTint[2]] });
        const r = hedge ? 3 : 6 * s;
        c.box.expandByPoint(dummy.position.set(x - r, 0, z - r)).expandByPoint(dummy.position.set(x + r, (K.far ? K.far[1] : 2.5) * sy, z + r));
        c.dirty = true;
        driver.invalidate();
    };

    let lastKey = '';
    const counts = Object.fromEntries(SLOTS.map(k => [k, 0])) as Record<Slot, number>;
    const spheres = Object.fromEntries(SLOTS.map(k => [k, new THREE.Sphere()])) as Record<Slot, THREE.Sphere>;
    const culled: Culled = {
        cull(view: CullView, force: boolean) {
            // which cells are in view (or in the sun's shadow box), and how far
            const vis: [Cell, number][] = [];
            let key = '';
            for (const [k, c] of cells) {
                if (c.dirty) { c.box.getBoundingSphere(c.sphere); c.dirty = false; }
                const r = c.sphere.radius;
                c.sphere.radius = r + 20;
                const visible = view.frustum.intersectsSphere(c.sphere) || (!!view.shadow && view.shadow.intersectsSphere(c.sphere));
                c.sphere.radius = r;
                if (!visible) continue;
                const d = view.camPos.distanceTo(c.sphere.center), lod = d < NEAR_DISTANCE ? 0 : d < DISTANT ? 1 : 2;
                vis.push([c, lod]);
                key += k + lod + c.plants.length + ';';
            }
            if (!force && key === lastKey) return;
            lastKey = key;
            SLOTS.forEach(s => { counts[s] = 0; spheres[s].makeEmpty(); });
            const put = (s: Slot, mat: Float32Array, col: [number, number, number]) => {
                const m = meshOf[s], i = counts[s];
                if (i >= m.instanceMatrix.count) return;
                (m.instanceMatrix.array as Float32Array).set(mat, i * 16);
                (m.instanceColor!.array as Float32Array).set(col, i * 3);
                counts[s] = i + 1;
            };
            const before = { ...counts };
            for (const [c, lod] of vis) {
                Object.assign(before, counts);
                for (const p of c.plants) {
                    if (lod === 0 || !p.far) put(p.shape, p.near, p.color);
                    else put(lod === 1 && p.shape !== 'bush' ? 'far' : 'distant', p.far, p.farColor); // (small far bushes: the simplest version)
                }
                // the drawn meshes' bounds: every cell that put a plant in them
                SLOTS.forEach(s => { if (counts[s] > before[s]) spheres[s].union(c.sphere); });
            }
            SLOTS.forEach(s => {
                const m = meshOf[s], n = counts[s];
                m.count = n;
                m.visible = n > 0;
                m.boundingSphere!.copy(spheres[s]);
                if (!n) return;
                m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, n * 16); m.instanceMatrix.needsUpdate = true;
                m.instanceColor!.clearUpdateRanges(); m.instanceColor!.addUpdateRange(0, n * 3); m.instanceColor!.needsUpdate = true;
            });
        },
    };
    driver.register(culled);
    return { add };
}

export type VegetationKit = ReturnType<typeof createVegetationKit>;
