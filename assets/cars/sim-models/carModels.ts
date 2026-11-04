// MiCar category cars for the 3D world.
//
// Loads the nine body-style models baked in Blender (public/models/cars/<style>.glb) and
// builds a car that is a drop-in replacement for buildCarModel() in VanillaThreeScene:
// it returns the same { group, wheels, body, frontPivots, smokeParticles } shape, so the
// existing code for paint, mud, star glow, wheel spin, steering and smoke keeps working.
//
// Each GLB holds: body_paint (one mesh, one material), body_trim (glass, chrome, black trim,
// lights) and wheel_FL / wheel_FR / wheel_RL / wheel_RR (origin at the hub, axle along X).
// Forward is +Z, up is +Y, the tyres touch y = 0, sizes are real metres.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type CarStyle = 'sedan' | 'coupe' | 'hatchback' | 'suv' | 'truck' | 'sports' | 'van' | 'wagon' | 'convertible';
export const CAR_STYLES: CarStyle[] = ['sedan', 'coupe', 'hatchback', 'suv', 'truck', 'sports', 'van', 'wagon', 'convertible'];

// Same footprint lengths as the old box cars, so lot rows, gates and collisions stay where they are.
export const SIM_LENGTH: Record<CarStyle, number> = {
    sedan: 9.0, coupe: 8.6, hatchback: 7.8, suv: 10.0, truck: 11.0, sports: 9.4, van: 10.6, wagon: 9.2, convertible: 7.6,
};

const ALIASES: Record<string, CarStyle> = { pickup: 'truck', hatch: 'hatchback', roadster: 'convertible', cabrio: 'convertible', estate: 'wagon', minivan: 'van', crossover: 'suv' };
export function normalizeStyle(style: string | undefined): CarStyle {
    const s = (style || '').toLowerCase().trim();
    if ((CAR_STYLES as string[]).includes(s)) return s as CarStyle;
    return ALIASES[s] || 'sedan';
}

export interface CarAssets {
    group: THREE.Group;
    wheels: THREE.Object3D[];        // FL, FR, RL, RR: rotateX() rolls them
    body: THREE.Mesh;                // its material is this car's own paint (MeshPhysicalMaterial)
    frontPivots: THREE.Group[];      // FL, FR: rotation.y steers them
    smokeParticles: THREE.Points;
}

interface Template { scene: THREE.Object3D; length: number; height: number; }
const templates = new Map<CarStyle, Template>();
let loading: Promise<void> | null = null;

/** Start loading every model once. Resolves when all have loaded (or failed; failures fall back to the old cars). */
export function preloadCarModels(baseUrl = 'models/cars/'): Promise<void> {
    if (loading) return loading;
    const loader = new GLTFLoader();
    loading = Promise.all(CAR_STYLES.map(style =>
        loader.loadAsync(`${baseUrl}${style}.glb`).then(gltf => {
            const box = new THREE.Box3().setFromObject(gltf.scene);
            templates.set(style, { scene: gltf.scene, length: box.max.z - box.min.z, height: box.max.y - box.min.y });
        }).catch(err => console.warn(`[carModels] ${style}.glb did not load; using the box car`, err))
    )).then(() => undefined);
    return loading;
}

export const carModelReady = (style?: string) => (style ? templates.has(normalizeStyle(style)) : templates.size > 0);

// Trim materials are shared between cars in the same condition band; paint is always per car.
const shared = new Map<string, THREE.Material>();
function sharedMat(key: string, make: () => THREE.Material) {
    let m = shared.get(key);
    if (!m) { m = make(); shared.set(key, m); }
    return m;
}

function paintFor(color: string, bodyCond: number) {
    let tint: THREE.Color;
    try { tint = new THREE.Color(color); } catch { tint = new THREE.Color('#ffffff'); }
    let roughness = 0.2, metalness = 0.6, clearcoat = 1.0;
    if (bodyCond < 50) {                      // same rust rule as the box cars
        roughness = 0.9; metalness = 0.1; clearcoat = 0;
        tint.lerp(new THREE.Color('#8b4513'), 1 - bodyCond / 50);
    }
    return new THREE.MeshPhysicalMaterial({ color: tint, metalness, roughness, clearcoat, clearcoatRoughness: 0.08 });
}

function trimFor(name: string, bodyCond: number): THREE.Material | null {
    const worn = bodyCond < 50, cracked = bodyCond < 40;
    switch (name) {
        case 'glass': return sharedMat('glass' + cracked, () => new THREE.MeshStandardMaterial({ color: '#0f172a', metalness: 0.9, roughness: 0.05, transparent: true, opacity: cracked ? 0.35 : 0.85 }));
        case 'chrome': return sharedMat('chrome' + worn, () => new THREE.MeshStandardMaterial({ color: '#e2e8f0', metalness: 1.0, roughness: worn ? 0.8 : 0.18 }));
        case 'trim': return sharedMat('trim', () => new THREE.MeshStandardMaterial({ color: '#0b0d12', metalness: 0.2, roughness: 0.55 }));
        case 'rubber': return sharedMat('rubber', () => new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.9 }));
        case 'headlight': return sharedMat('head', () => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4dc', emissiveIntensity: 2.0 }));
        case 'taillight': return sharedMat('tail', () => new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#dc2626', emissiveIntensity: 2.0 }));
        default: return null;
    }
}

const matKey = (m: THREE.Material) => m.name.replace(/^EX_/, '').replace(/\.\d+$/, '');

/** Build a car from its model, or return null if that model has not loaded yet (call the box-car builder then). */
export function buildCarFromModel(style: string, color: string, bodyCond = 100, mechCond = 100): CarAssets | null {
    const st = normalizeStyle(style);
    const tpl = templates.get(st);
    if (!tpl) return null;

    const group = new THREE.Group();
    const model = tpl.scene.clone(true);           // geometry is shared, materials are replaced below
    const scale = SIM_LENGTH[st] / tpl.length;
    model.scale.setScalar(scale);
    group.add(model);

    const paint = paintFor(color, bodyCond);
    let body: THREE.Mesh | null = null;
    model.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        const name = matKey(mesh.material as THREE.Material);
        if (name === 'paint') {
            mesh.material = paint; mesh.receiveShadow = true;
            if (o.name.startsWith('body_paint') || !body) body = mesh;
        } else {
            const m = trimFor(name, bodyCond);
            if (m) mesh.material = m;
        }
    });

    // Each wheel gets a pivot at its hub, like the box cars: pivots steer (rotation.y), wheels roll (rotateX).
    const wheels: THREE.Object3D[] = [];
    const frontPivots: THREE.Group[] = [];
    (['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'] as const).forEach((name, i) => {
        const wheel = model.getObjectByName(name);
        if (!wheel) return;
        const pivot = new THREE.Group();
        pivot.position.copy(wheel.position);
        wheel.position.set(0, 0, 0);
        wheel.parent!.add(pivot);
        pivot.add(wheel);
        wheels.push(wheel);
        if (i < 2) frontPivots.push(pivot);
    });

    // Engine smoke for poor mechanical condition (visibility is updated by the scene each frame).
    const partGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(50 * 3);
    for (let i = 0; i < pPos.length; i++) pPos[i] = (Math.random() - 0.5) * 2;
    partGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const smokeParticles = new THREE.Points(partGeo, new THREE.PointsMaterial({ color: 0x888888, size: 0.8, transparent: true, opacity: 0.4 }));
    smokeParticles.position.set(0, tpl.height * scale * 0.75, SIM_LENGTH[st] / 2 - 1.6);
    smokeParticles.visible = mechCond < 50;
    group.add(smokeParticles);

    return { group, wheels, body: body!, frontPivots, smokeParticles };
}
