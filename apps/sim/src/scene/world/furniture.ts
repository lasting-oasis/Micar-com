import * as THREE from 'three';

// Reusable interior props for the showroom, bank lobby, etc.
export function createFurnitureKit(makeGlass: (color: string, opacity?: number) => THREE.Material) {
    // ---- Reusable interior furniture (sofas, plants, paintings, tables) ----
    const makeSofa = (col = '#6d5b47') => {
        const g = new THREE.Group();
        const fabric = new THREE.MeshStandardMaterial({ color: col, roughness: 0.95 });
        const base = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.55, 1.4), fabric); base.position.y = 0.55; base.castShadow = true; base.receiveShadow = true; g.add(base);
        const back = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 0.4), fabric); back.position.set(0, 1.05, -0.5); back.castShadow = true; g.add(back);
        ([-1.5, 1.5]).forEach(x => { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.85, 1.4), fabric); arm.position.set(x, 0.7, 0); arm.castShadow = true; g.add(arm); });
        ([-0.8, 0.8]).forEach(x => { const c = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.28, 1.2), fabric); c.position.set(x, 0.95, 0.05); g.add(c); });
        const legMat = new THREE.MeshStandardMaterial({ color: '#3f3f46', metalness: 0.5, roughness: 0.4 });
        ([[-1.4, 0.6], [1.4, 0.6], [-1.4, -0.6], [1.4, -0.6]] as [number, number][]).forEach(([x, z]) => { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.3, 6), legMat); l.position.set(x, 0.15, z); g.add(l); });
        return g;
    };
    const makePlant = () => {
        const g = new THREE.Group();
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.38, 0.85, 14), new THREE.MeshStandardMaterial({ color: '#9a6a3a', roughness: 0.85 })); pot.position.y = 0.42; pot.castShadow = true; g.add(pot);
        const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.1, 14), new THREE.MeshStandardMaterial({ color: '#2e2114' })); soil.position.y = 0.82; g.add(soil);
        const leafMat = new THREE.MeshStandardMaterial({ color: '#15803d', roughness: 0.85 });
        ([[0, 1.45, 0, 0.72], [0.45, 1.85, 0.2, 0.55], [-0.42, 1.75, -0.22, 0.5], [0.22, 2.15, 0.3, 0.4], [-0.2, 2.05, 0.35, 0.38]] as [number, number, number, number][]).forEach(([x, y, z, r]) => { const leaf = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), leafMat); leaf.position.set(x, y, z); leaf.scale.y = 1.4; leaf.castShadow = true; g.add(leaf); });
        return g;
    };
    const makePainting = (w = 2, h = 1.4, art = '#0e7490', accent = '#f59e0b') => {
        const g = new THREE.Group(); // hangs flat, facing +z by default
        const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, h + 0.2, 0.12), new THREE.MeshStandardMaterial({ color: '#1c1917', metalness: 0.3, roughness: 0.5 })); g.add(frame);
        const canvas = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.14), new THREE.MeshStandardMaterial({ color: art, roughness: 0.7 })); canvas.position.z = 0.01; g.add(canvas);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, h * 0.35, 0.16), new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6 })); stripe.position.set(-w * 0.12, h * 0.12, 0.02); g.add(stripe);
        return g;
    };
    const makeCoffeeTable = () => {
        const g = new THREE.Group();
        const topMat = makeGlass('#94a3b8', 0.55);
        const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, 1.1), topMat); top.position.y = 0.7; top.castShadow = true; g.add(top);
        const legMat = new THREE.MeshStandardMaterial({ color: '#27272a', metalness: 0.6, roughness: 0.3 });
        ([[-0.85, 0.45], [0.85, 0.45], [-0.85, -0.45], [0.85, -0.45]] as [number, number][]).forEach(([x, z]) => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.1), legMat); l.position.set(x, 0.35, z); g.add(l); });
        return g;
    };

    return { makeSofa, makePlant, makePainting, makeCoffeeTable };
}

export type FurnitureKit = ReturnType<typeof createFurnitureKit>;
