import * as THREE from 'three';

// Free the GPU memory of a car / bot / player marker that leaves the world.
export const disposeObject = (obj: THREE.Object3D) => {
    obj.removeFromParent();
    obj.traverse((child: any) => {
        if (!(child.isMesh || child.isPoints || child.isSprite)) return;
        child.geometry?.dispose();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m: any) => { m?.map?.dispose(); m?.dispose(); });
    });
};
/** Frame-rate independent smoothing: `rate` is the per-frame factor at 60 fps. */
export const damp = (rate: number, dt: number) => 1 - Math.pow(1 - rate, dt * 60);

// Opaque draw order. three.js sorts opaque objects by material, then by the
// distance of their origin — but the merged scenery meshes all sit at the
// origin, so the huge ground layers (grass, roads, lot paving) used to be drawn
// early and then painted over by everything above them: most ground pixels
// were shaded twice or more. Drawing the flat ground layers last, higher layers
// first, lets the depth test skip what's hidden. Same image, fewer pixels shaded.
const groundRanks = new WeakMap<THREE.Object3D, number>();
const tmpBox = new THREE.Box3();
/** 0 = normal; > 0 = flat ground layer near y = 0 (larger = lower = drawn later). */
const groundRank = (object: THREE.Object3D) => {
    let rank = groundRanks.get(object);
    if (rank === undefined) {
        rank = 0;
        const geometry = (object as THREE.Mesh).geometry;
        if ((object as THREE.Mesh).isMesh && geometry?.attributes?.position) {
            if (!geometry.boundingBox) geometry.computeBoundingBox();
            const b = tmpBox.copy(geometry.boundingBox!).applyMatrix4(object.matrixWorld);
            const flat = b.max.y - b.min.y < 0.6 && b.max.y < 1;
            const large = (b.max.x - b.min.x) * (b.max.z - b.min.z) > 2000;
            if (flat && large) rank = 2 - b.max.y;
        }
        groundRanks.set(object, rank);
    }
    return rank;
};
type RenderItem = { id: number; object: THREE.Object3D; material: THREE.Material; groupOrder: number; renderOrder: number; z: number };
export const groundLastOpaqueSort = (a: RenderItem, b: RenderItem) => {
    if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
    if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
    const ga = groundRank(a.object), gb = groundRank(b.object);
    if (ga !== gb) return ga - gb;
    // three.js's own order from here on
    if (a.material.id !== b.material.id) return a.material.id - b.material.id;
    if (a.z !== b.z) return a.z - b.z;
    return a.id - b.id;
};
