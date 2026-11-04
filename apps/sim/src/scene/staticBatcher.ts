import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Merges static (never-moving) meshes that share the same look into a single
// mesh, so the GPU draws e.g. every fence post on a lot in one call instead of
// hundreds. Materials are matched by their visible properties, so two
// separately-created "grey concrete" materials are treated as one.
//
// Anything under an object with `userData.dynamic = true` is left alone (gates,
// item boxes, cars…). Sprites, lights, points and instanced meshes are skipped.

const NUMERIC_OR_FLAG_PROPS = [
    'type', 'transparent', 'opacity', 'side', 'alphaTest', 'depthWrite', 'depthTest',
    'flatShading', 'roughness', 'metalness', 'emissiveIntensity', 'polygonOffset',
    'polygonOffsetFactor', 'polygonOffsetUnits', 'fog', 'toneMapped', 'vertexColors',
    'wireframe', 'envMapIntensity', 'blending',
] as const;
const COLOR_PROPS = ['color', 'emissive'] as const;
const TEXTURE_PROPS = ['map', 'alphaMap', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'bumpMap', 'aoMap'] as const;

export function materialSignature(material: THREE.Material): string {
    const m = material as any;
    const parts: string[] = [];
    for (const k of NUMERIC_OR_FLAG_PROPS) if (m[k] !== undefined) parts.push(`${k}=${m[k]}`);
    for (const k of COLOR_PROPS) if (m[k]?.isColor) parts.push(`${k}=${m[k].getHexString()}`);
    for (const k of TEXTURE_PROPS) if (m[k]) parts.push(`${k}=${m[k].uuid}`);
    return parts.join('|');
}

type Candidate = { mesh: THREE.Mesh; rootIndex: number };

function collectCandidates(roots: THREE.Object3D[]): Candidate[] {
    const out: Candidate[] = [];
    const visit = (obj: THREE.Object3D, rootIndex: number) => {
        if (!obj.visible || obj.userData.dynamic) return;
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh && !(obj as any).isInstancedMesh && !(obj as any).isSkinnedMesh
            && !Array.isArray(mesh.material) && mesh.geometry?.attributes?.position
            && !mesh.morphTargetInfluences && mesh.matrixWorld.determinant() > 0) {
            out.push({ mesh, rootIndex });
        }
        obj.children.forEach(c => visit(c, rootIndex));
    };
    roots.forEach((r, i) => { r.updateMatrixWorld(true); visit(r, i); });
    return out;
}

// Bring every geometry to the same attribute layout (position/normal/uv) and
// the same indexing so they can be concatenated.
function normaliseForMerge(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry[] {
    const anyNonIndexed = geoms.some(g => !g.index);
    return geoms.map(g => {
        let out = anyNonIndexed && g.index ? g.toNonIndexed() : g;
        if (out !== g) g.dispose();
        for (const name of Object.keys(out.attributes)) {
            if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
        }
        if (!out.attributes.normal) out.computeVertexNormals();
        if (!out.attributes.uv) {
            out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
        }
        out.clearGroups();
        return out;
    });
}

export type BatchOptions = {
    /** Where merged meshes are added (normally the scene). */
    parent: THREE.Object3D;
    /** Materials changed at runtime (e.g. glowing windows) — never swapped for a look-alike. */
    keepUnique?: Set<THREE.Material>;
};

/**
 * Merge the static meshes found under `roots`. Returns the new merged meshes
 * (already added to `options.parent`) so the caller can dispose them later.
 * Collision boxes etc. must be computed BEFORE calling this.
 */
export function batchStatic(roots: THREE.Object3D[], options: BatchOptions): THREE.Mesh[] {
    const candidates = collectCandidates(roots);
    const groups = new Map<string, Candidate[]>();
    const representative = new Map<string, THREE.Material>();

    for (const c of candidates) {
        const mat = c.mesh.material as THREE.Material;
        const matKey = options.keepUnique?.has(mat) ? `u:${mat.uuid}` : materialSignature(mat);
        // Transparent surfaces are only merged within one building so the
        // renderer can still sort glass of different buildings back-to-front.
        const rootKey = mat.transparent ? `|r${c.rootIndex}` : '';
        const key = `${matKey}${rootKey}|cs${c.mesh.castShadow}|rs${c.mesh.receiveShadow}|ro${c.mesh.renderOrder}`;
        if (!groups.has(key)) { groups.set(key, []); representative.set(key, mat); }
        groups.get(key)!.push(c);
    }

    const merged: THREE.Mesh[] = [];
    for (const [key, list] of groups) {
        const mat = representative.get(key)!;
        if (list.length < 2) {
            // Nothing to merge, but still share the look-alike material.
            list[0].mesh.material = mat;
            continue;
        }
        const geoms = normaliseForMerge(list.map(({ mesh }) => mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)));
        const geometry = mergeGeometries(geoms, false);
        geoms.forEach(g => g.dispose());
        if (!geometry) {
            list.forEach(({ mesh }) => { mesh.material = mat; });
            continue;
        }
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
        const first = list[0].mesh;
        const batch = new THREE.Mesh(geometry, mat);
        batch.name = 'static-batch';
        batch.castShadow = first.castShadow;
        batch.receiveShadow = first.receiveShadow;
        batch.renderOrder = first.renderOrder;
        batch.matrixAutoUpdate = false;
        batch.updateMatrix();
        list.forEach(({ mesh }) => mesh.removeFromParent());
        options.parent.add(batch);
        merged.push(batch);
    }
    return merged;
}
