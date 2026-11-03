import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { generateGlowTexture } from '../textures';

// Street lights and lot lights for the whole world, all instanced:
//  - one draw call for every pole, arm and lamp head (one geometry per kind, one material;
//    the lenses glow through an emissive map whose strength follows the night),
//  - one draw call for the fake pools of light on the ground (additive, depth-tested quads),
//  - one draw call for the glare around the lit heads (additive point sprites).
// No real lights: each head registers a light *source* with the shared light pool.

export type LampKind = 'street' | 'lot';

// Colours of the lamp parts, picked by u (8 texels wide): see PART
const PART = { pole: 0, housing: 1, lens: 2, bronze: 3, concrete: 4 } as const;
const partU = (p: number) => (p + 0.5) / 8;
const PALETTE = ['#878b8e', '#5d6164', '#e8e4d8', '#3a3631', '#a19f99', '#000000', '#000000', '#000000'];

const paletteTexture = (colors: string[]) => {
    const data = new Uint8Array(8 * 4);
    colors.forEach((hex, i) => { const c = new THREE.Color(hex); data.set([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), 255], i * 4); });
    const t = new THREE.DataTexture(data, 8, 1, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
};
// (THREE.Color('#hex') is linear; the palette stores sRGB bytes, so convert back)
const srgbHex = (hex: string) => '#' + new THREE.Color(hex).getHexString(THREE.SRGBColorSpace);

/** Paints every vertex of `g` with one palette part (by UV) and returns it non-indexed-safe. */
const part = (g: THREE.BufferGeometry, p: number) => {
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, partU(p), 0.5);
    return g;
};

// Cobra-head street light, arm along +x: pole 9.5 m, head 2.8 m out over the road.
const STREET_HEAD = new THREE.Vector3(2.8, 9.5, 0);
function streetLightGeometry() {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(part(new THREE.CylinderGeometry(0.24, 0.3, 0.6, 8).translate(0, 0.3, 0), PART.housing));      // base
    parts.push(part(new THREE.CylinderGeometry(0.075, 0.13, 9.0, 8, 1, true).translate(0, 5.1, 0), PART.pole)); // pole
    const arm = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 9.0, 0), new THREE.Vector3(0.06, 9.45, 0), new THREE.Vector3(0.45, 9.66, 0),
        new THREE.Vector3(1.4, 9.68, 0), new THREE.Vector3(2.35, 9.6, 0),
    ]);
    parts.push(part(new THREE.TubeGeometry(arm, 6, 0.055, 5, false), PART.pole));
    // Head: a shallow housing over a glowing dome lens
    parts.push(part(new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.55, 0.2, 0.26).translate(STREET_HEAD.x, STREET_HEAD.y, 0), PART.housing));
    parts.push(part(new THREE.SphereGeometry(1, 8, 2, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(0.5, 0.07, 0.22).translate(STREET_HEAD.x, STREET_HEAD.y, 0), PART.lens));
    return merge(parts);
}

// Dealership lot light: square bronze pole on a concrete pier, two shoebox heads on a cross arm.
const LOT_HEADS = [new THREE.Vector3(-1.3, 10.7, 0), new THREE.Vector3(1.3, 10.7, 0)];
function lotLightGeometry() {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(part(new THREE.BoxGeometry(0.62, 0.8, 0.62).translate(0, 0.4, 0), PART.concrete));
    parts.push(part(new THREE.CylinderGeometry(0.09, 0.13, 10.0, 4, 1, true).rotateY(Math.PI / 4).translate(0, 5.8, 0), PART.bronze));
    parts.push(part(new THREE.BoxGeometry(2.3, 0.12, 0.12).translate(0, 10.82, 0), PART.bronze));
    LOT_HEADS.forEach(h => {
        parts.push(part(new THREE.BoxGeometry(0.66, 0.17, 0.5).translate(h.x, h.y + 0.05, 0), PART.bronze));
        parts.push(part(new THREE.PlaneGeometry(0.58, 0.42).rotateX(Math.PI / 2).translate(h.x, h.y - 0.04, 0), PART.lens));
    });
    return merge(parts);
}

function merge(parts: THREE.BufferGeometry[]) {
    const flat = parts.map(g => (g.index ? g : g.toNonIndexed().setIndex([...Array(g.attributes.position.count).keys()])));
    const g = mergeGeometries(flat, false)!;
    parts.forEach(p => p.dispose());
    g.computeBoundingSphere();
    return g;
}

export function createStreetLightKit(
    scene: THREE.Scene,
    disposables: THREE.Object3D[],
    materials: THREE.Material[],
    textures: THREE.Texture[],
    addLightSource: (x: number, y: number, z: number, color: string, intensity: number, distance: number, nightOnly: boolean) => void,
) {
    const map = paletteTexture(PALETTE.map(srgbHex));
    const glow = paletteTexture(PALETTE.map((_, i) => (i === PART.lens ? '#ffffff' : '#000000')));
    const poolTex = generateGlowTexture(1), haloTex = generateGlowTexture(2);
    textures.push(map, glow, poolTex, haloTex);

    const lampMat = new THREE.MeshStandardMaterial({ map, emissiveMap: glow, emissive: '#ffd6a0', emissiveIntensity: 0, roughness: 0.5, metalness: 0.45 });
    const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: '#ffd29a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
    const haloMat = new THREE.PointsMaterial({ map: haloTex, color: '#ffe0b0', size: 2.6, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
    materials.push(lampMat, poolMat, haloMat);

    const CAP = 512;
    const meshes: Record<LampKind, THREE.InstancedMesh> = {
        street: new THREE.InstancedMesh(streetLightGeometry(), lampMat, CAP),
        lot: new THREE.InstancedMesh(lotLightGeometry(), lampMat, CAP),
    };
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, CAP * 2);
    const haloPositions = new Float32Array(CAP * 3 * 3);
    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute('position', new THREE.BufferAttribute(haloPositions, 3));
    haloGeo.setDrawRange(0, 0);
    const halos = new THREE.Points(haloGeo, haloMat);
    let haloCount = 0;

    // Culled as a whole by the bounds of all their instances (reset whenever one is added)
    [meshes.street, meshes.lot, pools].forEach(m => { m.count = 0; });
    meshes.street.castShadow = meshes.lot.castShadow = true;
    meshes.street.receiveShadow = meshes.lot.receiveShadow = true;
    pools.renderOrder = 2; halos.renderOrder = 3;
    pools.visible = halos.visible = false;
    for (const o of [meshes.street, meshes.lot, pools, halos]) { scene.add(o); disposables.push(o); }

    const dummy = new THREE.Object3D();
    const tmp = new THREE.Vector3();
    const addPool = (x: number, y: number, z: number, along: number, across: number, rotY: number) => {
        dummy.position.set(x, y, z); dummy.rotation.set(0, rotY, 0); dummy.scale.set(along, 1, across); dummy.updateMatrix();
        pools.setMatrixAt(pools.count++, dummy.matrix);
        pools.instanceMatrix.needsUpdate = true;
        pools.boundingSphere = null;
    };
    const addHalo = (p: THREE.Vector3) => {
        haloPositions.set([p.x, p.y, p.z], haloCount * 3);
        haloCount++;
        haloGeo.setDrawRange(0, haloCount);
        (haloGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        haloGeo.boundingSphere = null;
    };

    /**
     * Adds a light at (x, z). Street lights reach toward (dirX, dirZ) (over the road); lot
     * lights spread their two heads across that direction. `groundY` = height of the ground
     * under the head (pool height).
     */
    const add = (kind: LampKind, x: number, z: number, dirX: number, dirZ: number, groundY = 0.03) => {
        const mesh = meshes[kind];
        if (mesh.count >= CAP) return;
        const rotY = Math.atan2(-dirZ, dirX); // local +x -> (dirX, dirZ)
        dummy.position.set(x, 0, z); dummy.rotation.set(0, rotY, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
        mesh.setMatrixAt(mesh.count++, dummy.matrix);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.boundingSphere = null;
        if (kind === 'street') {
            const head = tmp.copy(STREET_HEAD).applyMatrix4(dummy.matrix);
            addHalo(tmp.clone().setY(head.y - 0.12));
            addLightSource(head.x, head.y - 0.3, head.z, '#ffd9a8', 2, 50, true);
            // a cobra head throws its light along the road: long across the arm, shorter along it
            const px = x + (dirX * (STREET_HEAD.x - 0.6)), pz = z + (dirZ * (STREET_HEAD.x - 0.6));
            addPool(px, groundY + 0.15, pz, 17, 27, rotY);
        } else {
            LOT_HEADS.forEach(h => addHalo(tmp.copy(h).setY(h.y - 0.1).applyMatrix4(dummy.matrix)));
            addLightSource(x, 10.5, z, '#fff0da', 2.5, 60, true);
            addPool(x, groundY + 0.15, z, 38, 30, rotY);
        }
    };

    /** 0 = day, 1 = night: lenses glow, pools and glare fade in. */
    const setNight = (f: number) => {
        lampMat.emissiveIntensity = 3.2 * f;
        poolMat.opacity = 0.42 * f;
        haloMat.opacity = f;
        pools.visible = halos.visible = f > 0.01;
    };

    return { add, setNight };
}

export type StreetLightKit = ReturnType<typeof createStreetLightKit>;
