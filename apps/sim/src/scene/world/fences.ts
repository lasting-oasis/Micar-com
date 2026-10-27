import * as THREE from 'three';
import type { WorldContext } from './context';

// Chain-link fence runs and hinged gate leaves, sharing one wire material.
export function createFenceKit(ctx: WorldContext) {
    const { scene, environmentDisposables, fencePostMat, fenceWireMat, wirePanelGeo } = ctx;

    // Builds a chain-link fence run from (x1,z1) to (x2,z2): woven wire panel,
    // top + bottom tension rails, and capped vertical posts every ~6 units.
    const buildChainLinkFence = (x1: number, z1: number, x2: number, z2: number, height = 6) => {
         const group = new THREE.Group();
         const dx = x2 - x1, dz = z2 - z1;
         const length = Math.hypot(dx, dz);
         if (length < 0.01) return group;
         const angle = Math.atan2(dz, dx);
         const midX = x1 + dx / 2, midZ = z1 + dz / 2;

         // Woven wire panel (tiled so diamonds stay a consistent real-world size)
         const panel = new THREE.Mesh(wirePanelGeo(length, height), fenceWireMat);
         panel.position.set(midX, height / 2, midZ);
         panel.rotation.y = -angle;
         group.add(panel);

         // Horizontal tension rails (top + bottom)
         const railGeo = new THREE.CylinderGeometry(0.07, 0.07, length, 8);
         railGeo.rotateZ(Math.PI / 2);
         [height - 0.15, 0.25].forEach(y => {
             const rail = new THREE.Mesh(railGeo, fencePostMat);
             rail.position.set(midX, y, midZ);
             rail.rotation.y = -angle;
             rail.castShadow = true;
             group.add(rail);
         });

         // Vertical posts with rounded caps
         const numPosts = Math.max(1, Math.round(length / 6));
         const postGeo = new THREE.CylinderGeometry(0.13, 0.13, height + 0.5, 8);
         const capGeo = new THREE.SphereGeometry(0.16, 8, 6);
         for (let i = 0; i <= numPosts; i++) {
             const t = i / numPosts;
             const px = x1 + dx * t, pz = z1 + dz * t;
             const post = new THREE.Mesh(postGeo, fencePostMat);
             post.position.set(px, (height + 0.5) / 2, pz);
             post.castShadow = true;
             group.add(post);
             const cap = new THREE.Mesh(capGeo, fencePostMat);
             cap.position.set(px, height + 0.5, pz);
             group.add(cap);
         }

         scene.add(group);
         environmentDisposables.push(group);
         return group;
    };

    // Builds one hinged gate leaf. `panelDir` = +1 means the leaf extends toward
    // +x from its hinge, -1 toward -x. rotation.y = 0 is closed (across the gap).
    const buildGateLeaf = (hingeX: number, hingeZ: number, panelDir: number, height = 6) => {
         const pivot = new THREE.Group();
         pivot.position.set(hingeX, 0, hingeZ);
         pivot.userData.dynamic = true; // swings open/closed — never merged
         const width = 15;
         const cx = (panelDir * width) / 2;

         const panel = new THREE.Mesh(wirePanelGeo(width, height), fenceWireMat);
         panel.position.set(cx, height / 2, 0);
         pivot.add(panel);

         // Sturdier gate frame: top/bottom rails + hinge & latch posts
         const railGeo = new THREE.CylinderGeometry(0.09, 0.09, width, 8);
         railGeo.rotateZ(Math.PI / 2);
         [height - 0.1, 0.2].forEach(y => {
             const rail = new THREE.Mesh(railGeo, fencePostMat);
             rail.position.set(cx, y, 0);
             rail.castShadow = true;
             pivot.add(rail);
         });
         const barGeo = new THREE.CylinderGeometry(0.11, 0.11, height + 0.3, 8);
         [0, panelDir * width].forEach(x => {
             const bar = new THREE.Mesh(barGeo, fencePostMat);
             bar.position.set(x, (height + 0.3) / 2, 0);
             bar.castShadow = true;
             pivot.add(bar);
         });

         scene.add(pivot);
         environmentDisposables.push(pivot);
         return pivot;
    };

    return { buildChainLinkFence, buildGateLeaf };
}

export type FenceKit = ReturnType<typeof createFenceKit>;
