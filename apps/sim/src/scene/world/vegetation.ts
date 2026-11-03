import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seededRandom, VEG_V } from '../textures';

// Trees and bushes for the whole world: one instanced mesh per species (one draw call each),
// all sharing one material (a leaf/needle/bark atlas, baked ambient occlusion in the vertex
// colours, and a colour per instance so no two neighbours look the same).

export type PlantKind = 'broadleaf' | 'roundleaf' | 'conifer' | 'bush';

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
function foliageLump(r: number, cx: number, cy: number, cz: number, crown: THREE.Vector3, crownBottom: number, crownTop: number, w = 8, h = 6, flatten = 1) {
    const g = toBand(new THREE.SphereGeometry(r, w, h), VEG_V.leaf, 2);
    const pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute, col = g.attributes.color as THREE.BufferAttribute;
    const p = new THREE.Vector3(), n = new THREE.Vector3(), radial = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i);
        const k = 1 + (hash3(p.x * 3.1 + cx, p.y * 3.1 + cy, p.z * 3.1 + cz) - 0.5) * 0.28;
        p.multiplyScalar(k); p.y *= flatten;
        p.add(new THREE.Vector3(cx, cy, cz));
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

function trunk(r0: number, r1: number, h: number, segs = 7, y0 = 0, tilt?: { ax: number; az: number; x: number; z: number }) {
    const g = toBand(new THREE.CylinderGeometry(r1, r0, h, segs, 1, true), VEG_V.bark, 1);
    g.translate(0, h / 2, 0);
    if (tilt) { g.rotateZ(tilt.az); g.rotateX(tilt.ax); g.translate(tilt.x, 0, tilt.z); }
    g.translate(0, y0, 0);
    const pos = g.attributes.position as THREE.BufferAttribute, col = g.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) { const ao = 0.62 + 0.38 * smooth(0, 2.2, pos.getY(i)); col.setXYZ(i, ao, ao, ao); }
    return g;
}

function mergeParts(parts: THREE.BufferGeometry[]) {
    const g = mergeGeometries(parts, false)!;
    parts.forEach(p => p.dispose());
    g.computeBoundingSphere();
    return g;
}

/** Broad-leaved street tree (about 9 m): a trunk forking into a crown of clustered foliage. */
function broadleafGeometry(rand: () => number) {
    const parts: THREE.BufferGeometry[] = [];
    const trunkH = 3.6;
    parts.push(trunk(0.24, 0.15, trunkH, 7));
    // three limbs into the crown
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + rand() * 0.6, lean = 0.5 + rand() * 0.25;
        parts.push(trunk(0.11, 0.06, 1.9, 5, trunkH - 0.35, { ax: Math.sin(a) * lean, az: -Math.cos(a) * lean, x: 0, z: 0 }));
    }
    const cy = trunkH + 2.9;
    const crown = new THREE.Vector3(0, cy, 0);
    const lumps: [number, number, number, number][] = [[0, cy, 0, 2.05], [0.9, cy - 1.1, 0.6, 1.55], [-1.0, cy - 0.8, -0.6, 1.55], [0.2, cy + 1.4, -0.3, 1.5], [-0.4, cy + 0.5, 1.1, 1.45]];
    const bottom = cy - 2.6, top = cy + 2.8;
    lumps.forEach(([x, y, z, r]) => parts.push(foliageLump(r, x, y, z, crown, bottom, top, 7, 5)));
    return mergeParts(parts);
}

/** Conifer (about 9 m): stacked, drooping tiers of needles with ragged rims. */
function coniferGeometry() {
    const parts: THREE.BufferGeometry[] = [trunk(0.2, 0.12, 2.2, 6)];
    const tiers = 5;
    for (let i = 0; i < tiers; i++) {
        const t = i / (tiers - 1);
        const r = lerp(2.5, 0.9, t), h = lerp(2.9, 2.2, t), y0 = 1.3 + i * 1.45;
        const seg = 11;
        const cone = toBand(new THREE.ConeGeometry(r, h, seg, 1, true), VEG_V.needle, 2);
        cone.translate(0, y0 + h / 2, 0);
        const pos = cone.attributes.position as THREE.BufferAttribute, nor = cone.attributes.normal as THREE.BufferAttribute, col = cone.attributes.color as THREE.BufferAttribute;
        const n = new THREE.Vector3();
        for (let k = 0; k < pos.count; k++) {
            let x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
            const rim = Math.abs(y - y0) < 0.01;
            if (rim) { // ragged, drooping rim
                const j = hash3(x * 1.7, i, z * 1.7);
                const s = 0.82 + 0.3 * j;
                x *= s; z *= s; y -= 0.15 + 0.35 * j;
                pos.setXYZ(k, x, y, z);
            }
            const rl = Math.hypot(x, z) || 1;
            n.set(x / rl, 0.75, z / rl).normalize();
            nor.setXYZ(k, n.x, n.y, n.z);
            const ao = rim ? lerp(0.45, 0.62, t) : lerp(0.85, 1.05, t);
            col.setXYZ(k, ao, ao, ao);
        }
        parts.push(cone);
        // underside, so the tier isn't hollow from below
        const cap = toBand(new THREE.CircleGeometry(r * 0.85, seg).rotateX(Math.PI / 2), VEG_V.needle, 1);
        cap.translate(0, y0 - 0.12, 0);
        const cc = cap.attributes.color as THREE.BufferAttribute;
        for (let k = 0; k < cc.count; k++) cc.setXYZ(k, 0.35, 0.35, 0.35);
        parts.push(cap);
    }
    return mergeParts(parts);
}

/** Low rounded shrub (about 1.2 m). */
function bushGeometry() {
    const parts: THREE.BufferGeometry[] = [];
    const crown = new THREE.Vector3(0, 0.3, 0);
    ([[0, 0.55, 0, 0.78], [0.6, 0.42, 0.2, 0.58], [-0.45, 0.45, -0.4, 0.6]] as [number, number, number, number][])
        .forEach(([x, y, z, r]) => parts.push(foliageLump(r, x, y, z, crown, 0, 1.25, 6, 4, 0.8)));
    return mergeParts(parts);
}

// Per-instance colour multipliers (linear): greens from yellowish to bluish, the odd red shrub
const TINTS: Record<PlantKind, [number, number, number][]> = {
    broadleaf: [[1, 1, 1], [1.1, 1.05, 0.8], [0.85, 0.96, 0.86], [0.96, 1.02, 0.75], [1.16, 1.02, 0.68], [0.8, 0.9, 0.84]],
    roundleaf: [[1, 1, 1], [1.08, 1.06, 0.78], [0.88, 0.98, 0.84], [1.0, 0.95, 0.85]],
    conifer: [[1, 1, 1], [0.86, 0.95, 1.02], [0.92, 1.02, 0.9], [1.05, 1.04, 0.95]],
    bush: [[1, 1, 1], [1.12, 1.06, 0.78], [0.85, 0.97, 0.86], [1.25, 0.82, 0.72], [0.95, 1.06, 0.9]],
};

export function createVegetationKit(scene: THREE.Scene, disposables: THREE.Object3D[], materials: THREE.Material[], atlas: THREE.Texture) {
    const rand = seededRandom(9001);
    const material = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.9, metalness: 0 });
    materials.push(material);
    // One instanced mesh (one draw call) per shape; 'roundleaf' trees share the broad-leaved
    // mesh and are drawn lower and wider.
    type Shape = 'broadleaf' | 'conifer' | 'bush';
    const shapeOf = (k: PlantKind): Shape => (k === 'roundleaf' ? 'broadleaf' : k);
    const CAP: Record<Shape, number> = { broadleaf: 1600, conifer: 600, bush: 1200 };
    const geos: Record<Shape, THREE.BufferGeometry> = {
        broadleaf: broadleafGeometry(rand),
        conifer: coniferGeometry(),
        bush: bushGeometry(),
    };
    const meshes = {} as Record<Shape, THREE.InstancedMesh>;
    (Object.keys(geos) as Shape[]).forEach(k => {
        const m = new THREE.InstancedMesh(geos[k], material, CAP[k]);
        m.count = 0;
        m.castShadow = true;
        m.receiveShadow = k !== 'bush';
        m.setColorAt(0, new THREE.Color(1, 1, 1)); // allocate per-instance colours before the first draw
        scene.add(m); disposables.push(m);
        meshes[k] = m;
    });

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    /** Plants one tree or bush at (x, z); `random` drives its size, turn and colour. */
    const add = (kind: PlantKind, x: number, z: number, random: () => number, scale = 1) => {
        const shape = shapeOf(kind), m = meshes[shape];
        if (m.count >= CAP[shape]) return;
        const round = kind === 'roundleaf';
        const s = scale * (0.82 + random() * 0.4) * (round ? 1.12 : 1), sy = s * (0.9 + random() * 0.22) * (round ? 0.8 : 1);
        dummy.position.set(x, 0, z); dummy.rotation.set(0, random() * Math.PI * 2, 0); dummy.scale.set(s, sy, s); dummy.updateMatrix();
        const tints = TINTS[kind], t = tints[Math.floor(random() * tints.length)], b = 0.86 + random() * 0.24;
        color.setRGB(t[0] * b, t[1] * b, t[2] * b);
        m.setMatrixAt(m.count, dummy.matrix);
        m.setColorAt(m.count, color);
        m.count++;
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor!.needsUpdate = true;
        m.boundingSphere = null; // culled by the bounds of all its instances: recompute
    };
    return { add };
}

export type VegetationKit = ReturnType<typeof createVegetationKit>;
