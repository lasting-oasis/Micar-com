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
