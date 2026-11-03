import * as THREE from 'three';
import { generateGlowTexture } from '../textures';
import { GeoBuilder } from './meshBuilder';
import { PackedMesh, type CullingDriver } from './cells';
import { LampLighting } from './lampLight';

// Street lights, lot lights and street furniture (traffic signals, stop signs, hydrants,
// bins, benches, bus shelters, flags, pennants). All of it is low-poly geometry in ONE
// material whose colours come from a small palette (picked by UV); lamp lenses and
// signal lamps glow through a matching emissive palette. City props are merged into one
// mesh drawn only where it's in view (see cells.ts); each dealership's lot lights and
// dressing go into that lot's own merged mesh. At night the nearest lamps light the scene
// in the shader (lampLight.ts) and a soft glare shows round their heads.
// Sizes are real (2 world units per metre).

const P = {
    pole: 0, housing: 1, lens: 2, bronze: 3, concrete: 4, signal: 5, red: 6, amber: 7, green: 8,
    stop: 9, white: 10, yellow: 11, binGreen: 12, wood: 13, panel: 14, blue: 15,
} as const;
export type PropColor = keyof typeof P;
const PALETTE = ['#868a8d', '#4b4f53', '#e9e5da', '#3a3631', '#a3a09a', '#1f2123', '#7a1a14', '#7a5110', '#14583a',
    '#b2231d', '#e6e4dd', '#d9a62a', '#2f4a37', '#7b5a3c', '#a7b6bf', '#2a4380'];
const u = (p: number) => (p + 0.5) / 16;
/** Strength of a street / lot lamp's light (see lampLight.ts). */
const STREET_LAMP = 5, LOT_LAMP = 3;
const uv = (c: PropColor): [number, number] => [u(P[c]), 0.5];

const paletteTexture = (colors: number[][], srgb: boolean) => {
    const data = new Uint8Array(16 * 4);
    colors.forEach((c, i) => data.set([c[0], c[1], c[2], 255], i * 4));
    const t = new THREE.DataTexture(data, 16, 1, THREE.RGBAFormat);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
};
const hexRGB = (h: string) => { const c = parseInt(h.slice(1), 16); return [(c >> 16) & 255, (c >> 8) & 255, c & 255]; };

// Shared unit primitives (appended with a matrix)
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
const CYL4 = new THREE.CylinderGeometry(1, 1, 1, 4, 1, true).rotateY(Math.PI / 4);
const CONE6 = new THREE.ConeGeometry(1, 1, 6, 1, true);
const QUAD = new THREE.PlaneGeometry(1, 1);
const DISC8 = new THREE.CircleGeometry(1, 8);
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3(), e3 = new THREE.Euler();
/** Matrix: translate (x,y,z), rotate (rx,ry,rz), scale (sx,sy,sz). */
const M = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0) =>
    m4.compose(p3.set(x, y, z), q.setFromEuler(e3.set(rx, ry, rz, 'YXZ')), s3.set(sx, sy, sz)).clone();

/** A placed prop: local coordinates (x right, y up, z forward along `dir`) mapped to the world. */
class Placer {
    private readonly base: THREE.Matrix4;
    constructor(private b: GeoBuilder, x: number, z: number, rotY: number) { this.base = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0, z); }
    put(geo: THREE.BufferGeometry, local: THREE.Matrix4, c: PropColor) { this.b.geometry(geo, new THREE.Matrix4().multiplyMatrices(this.base, local), uv(c)); }
    box(x: number, y: number, z: number, sx: number, sy: number, sz: number, c: PropColor, ry = 0, rx = 0, rz = 0) { this.put(BOX, M(x, y, z, sx, sy, sz, ry, rx, rz), c); }
    /** Vertical post from y0 to y1 (6 or 4 sides). */
    post(x: number, z: number, y0: number, y1: number, r: number, c: PropColor, sides: 4 | 6 = 6) { this.put(sides === 6 ? CYL6 : CYL4, M(x, (y0 + y1) / 2, z, r, y1 - y0, r), c); }
    /** Thin bar between two local points (4 sides). */
    bar(a: THREE.Vector3, b: THREE.Vector3, r: number, c: PropColor) {
        const d = b.clone().sub(a), len = d.length();
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
        this.put(CYL4, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), quat, new THREE.Vector3(r, len, r)), c);
    }
    /** Flat quad facing +z (or -z with back = true), centred at (x, y, z). */
    quad(x: number, y: number, z: number, w: number, h: number, c: PropColor, ry = 0) { this.put(QUAD, M(x, y, z, w, h, 1, ry), c); }
}
/** Rotation that turns local +z toward (dx, dz). */
const yaw = (dx: number, dz: number) => Math.atan2(dx, dz);

export function createPropsKit(
    scene: THREE.Scene,
    driver: CullingDriver,
    disposables: THREE.Object3D[],
    materials: THREE.Material[],
    textures: THREE.Texture[],
    addLightSource: (x: number, y: number, z: number, color: string, intensity: number, distance: number, nightOnly: boolean) => void,
) {
    const map = paletteTexture(PALETTE.map(hexRGB), true);
    // Emissive palette (linear): lamp lenses follow the night, signal lamps are always lit
    const glowData = new Uint8Array(16 * 4);
    const setGlow = (p: number, r: number, g: number, b: number) => glowData.set([r * 255, g * 255, b * 255, 255], p * 4);
    setGlow(P.red, 0.95, 0.05, 0.02); setGlow(P.amber, 0.95, 0.5, 0.03); setGlow(P.green, 0.06, 0.9, 0.4);
    const glow = new THREE.DataTexture(glowData, 16, 1, THREE.RGBAFormat);
    glow.colorSpace = THREE.NoColorSpace;
    glow.magFilter = glow.minFilter = THREE.NearestFilter;
    glow.needsUpdate = true;
    const haloTex = generateGlowTexture(2);
    textures.push(map, glow, haloTex);

    const material = new THREE.MeshStandardMaterial({ map, emissiveMap: glow, emissive: '#ffffff', emissiveIntensity: 2.4, roughness: 0.55, metalness: 0.3 });
    const haloMat = new THREE.PointsMaterial({ map: haloTex, color: '#ffe0b0', size: 4.4, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
    materials.push(material, haloMat);

    // City props: one mesh, packed by cell
    const city = new PackedMesh(material, { castShadow: true, receiveShadow: true });
    city.mesh.name = 'props:city';
    scene.add(city.mesh); disposables.push(city.mesh);
    driver.register(city);

    // Night: the lamps light the scene in the shader (see lampLight.ts), and a soft glare
    // shows round their heads (one draw call, only at night)
    const lamps = new LampLighting();
    driver.register(lamps); driver.perFrame.push(lamps);
    const CAP = 2048;
    const haloPos = new Float32Array(CAP * 3), haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute('position', new THREE.BufferAttribute(haloPos, 3));
    haloGeo.setDrawRange(0, 0);
    const halos = new THREE.Points(haloGeo, haloMat);
    halos.renderOrder = 3; halos.visible = false; halos.name = 'props:glare';
    let haloCount = 0;
    scene.add(halos); disposables.push(halos);
    const addHalo = (x: number, y: number, z: number) => {
        if (haloCount >= CAP) return;
        haloPos.set([x, y, z], haloCount++ * 3);
        haloGeo.setDrawRange(0, haloCount);
        (haloGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        haloGeo.boundingSphere = null;
    };

    // ---- Lights ----
    /** Cobra-head street light: 9 m pole on a base, curved arm reaching 2.5 m toward (dirX, dirZ). */
    const streetLightGeo = (b: GeoBuilder, x: number, z: number, dirX: number, dirZ: number) => {
        const L = new Placer(b, x, z, yaw(dirX, dirZ));
        L.post(0, 0, 0, 1.2, 0.42, 'housing', 4);
        L.post(0, 0, 1.2, 17.6, 0.2, 'pole');
        L.bar(new THREE.Vector3(0, 17.2, 0), new THREE.Vector3(0, 18.1, 1.2), 0.11, 'pole');
        L.bar(new THREE.Vector3(0, 18.1, 1.2), new THREE.Vector3(0, 18.15, 4.3), 0.1, 'pole');
        L.box(0, 18.05, 5.0, 0.62, 0.32, 1.7, 'housing');
        L.put(QUAD, M(0, 17.88, 5.0, 0.5, 1.4, 1, 0, Math.PI / 2), 'lens');
        return new THREE.Vector3(0, 17.8, 5.0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw(dirX, dirZ)).add(new THREE.Vector3(x, 0, z));
    };
    /** Dealership lot light: 9 m bronze pole on a concrete pier, two box heads on a cross arm. */
    const lotLightGeo = (b: GeoBuilder, x: number, z: number, rotY: number) => {
        const L = new Placer(b, x, z, rotY);
        L.box(0, 0.6, 0, 1.1, 1.2, 1.1, 'concrete');
        L.post(0, 0, 1.2, 18, 0.2, 'bronze', 4);
        L.box(0, 18.05, 0, 4.6, 0.22, 0.22, 'bronze');
        for (const sx of [-2.2, 2.2]) {
            L.box(sx, 17.95, 0, 1.2, 0.3, 0.9, 'bronze');
            L.put(QUAD, M(sx, 17.79, 0, 1.0, 0.75, 1, 0, Math.PI / 2), 'lens');
        }
    };

    const street = (x: number, z: number, dirX: number, dirZ: number, groundY = 0.03) => {
        const head = streetLightGeo(city.at(x, z), x, z, dirX, dirZ);
        addHalo(head.x, head.y - 0.2, head.z);
        addLightSource(head.x, head.y - 0.4, head.z, '#ffd9a8', 2, 70, true);
        lamps.add(head.x, head.y - 0.4, head.z, '#ffc98a', STREET_LAMP, 48);
        void groundY;
    };
    const lot = (b: GeoBuilder, x: number, z: number, rotY: number, groundY = 0.03) => {
        lotLightGeo(b, x, z, rotY);
        const ax = Math.cos(rotY) * 2.2, az = -Math.sin(rotY) * 2.2;
        addHalo(x + ax, 17.6, z + az); addHalo(x - ax, 17.6, z - az);
        addLightSource(x, 17.5, z, '#fff0da', 2.5, 80, true);
        lamps.add(x, 17.5, z, '#ffe3c0', LOT_LAMP, 54);
        void groundY;
    };

    // ---- Street furniture (into any builder: the city's cells or a lot) ----
    const furniture = {
        /**
         * Mast-arm traffic signal on the corner (x, z): the arm reaches `arm` toward (dirX, dirZ)
         * over the approach lanes; the heads face (faceX, faceZ), toward oncoming drivers.
         */
        signal(b: GeoBuilder, x: number, z: number, dirX: number, dirZ: number, arm: number, faceX: number, faceZ: number, lit: 'red' | 'green') {
            const L = new Placer(b, x, z, yaw(dirX, dirZ));
            const side = dirZ * faceX - dirX * faceZ > 0 ? 1 : -1; // local +x is (dirZ, -dirX)
            L.post(0, 0, 0, 13, 0.22, 'signal');
            L.bar(new THREE.Vector3(0, 12.4, 0), new THREE.Vector3(0, 12.6, arm), 0.13, 'signal');
            for (const t of [arm * 0.55, arm * 0.92]) {
                L.box(0, 11.0, t, 0.75, 2.2, 0.5, 'signal');
                ([[11.7, 'red'], [11.0, 'amber'], [10.3, 'green']] as [number, 'red' | 'amber' | 'green'][]).forEach(([y, col]) => {
                    L.put(QUAD, M(side * 0.38, y, t, 0.42, 0.42, 1, side * Math.PI / 2), col === lit ? col : 'signal');
                });
            }
        },
        stopSign(b: GeoBuilder, x: number, z: number, faceX: number, faceZ: number) {
            const L = new Placer(b, x, z, yaw(faceX, faceZ));
            L.post(0, 0, 0, 4.4, 0.06, 'pole', 4);
            L.put(DISC8, M(0, 4.4, 0.08, 0.78, 0.78, 1, 0, 0, Math.PI / 8), 'stop');
            L.put(DISC8, M(0, 4.4, 0.06, 0.78, 0.78, 1, Math.PI, 0, Math.PI / 8), 'pole');
        },
        hydrant(b: GeoBuilder, x: number, z: number) {
            const L = new Placer(b, x, z, 0);
            L.post(0, 0, 0, 1.3, 0.28, 'yellow');
            L.put(CONE6, M(0, 1.45, 0, 0.32, 0.3, 0.32), 'yellow');
            L.box(0, 0.95, 0, 0.75, 0.2, 0.2, 'yellow');
        },
        bin(b: GeoBuilder, x: number, z: number) {
            const L = new Placer(b, x, z, 0);
            L.post(0, 0, 0, 1.9, 0.5, 'binGreen');
            L.put(CONE6, M(0, 2.05, 0, 0.55, 0.3, 0.55), 'binGreen');
        },
        bench(b: GeoBuilder, x: number, z: number, faceX: number, faceZ: number) {
            const L = new Placer(b, x, z, yaw(faceX, faceZ));
            L.box(0, 0.9, 0, 3.6, 0.12, 0.9, 'wood');
            L.box(0, 1.55, -0.45, 3.6, 0.8, 0.1, 'wood', 0, -0.15);
            for (const sx of [-1.5, 1.5]) L.box(sx, 0.45, -0.05, 0.12, 0.9, 0.9, 'housing');
        },
        busShelter(b: GeoBuilder, x: number, z: number, faceX: number, faceZ: number) {
            const L = new Placer(b, x, z, yaw(faceX, faceZ));
            L.box(0, 5.0, 0.2, 7.4, 0.25, 3.4, 'housing');
            L.box(0, 2.6, -1.3, 7.0, 4.6, 0.1, 'panel');
            for (const sx of [-3.5, 3.5]) { L.box(sx, 2.6, -0.3, 0.1, 4.6, 2.0, 'panel'); L.post(sx, 1.4, 0, 4.9, 0.08, 'pole', 4); }
            L.box(0, 0.9, -0.8, 5.0, 0.12, 0.8, 'wood');
            L.box(0, 4.55, 1.85, 7.4, 0.6, 0.12, 'blue');
        },
        /** End of a dead-end street: a striped barrier across (dirX, dirZ) = along the road. */
        barrier(b: GeoBuilder, x: number, z: number, alongX: number, alongZ: number, width: number) {
            const L = new Placer(b, x, z, yaw(alongX, alongZ));
            for (const sx of [-width / 2, width / 2]) L.post(sx, 0, 0, 2.2, 0.12, 'white', 4);
            for (let i = 0; i < 6; i++) L.box(-width / 2 + (i + 0.5) * width / 6, 1.7, 0, width / 6, 0.5, 0.12, i % 2 ? 'white' : 'stop');
        },
        /** Flag pole (11 m) with a flag in bands of `colors`, waving toward +x. */
        flag(b: GeoBuilder, x: number, z: number, rotY: number, colors: PropColor[]) {
            const L = new Placer(b, x, z, rotY);
            L.post(0, 0, 0, 22, 0.1, 'white');
            L.put(CONE6, M(0, 22.2, 0, 0.16, 0.4, 0.16), 'yellow');
            const W = 4.6, H = 3.0, n = colors.length;
            for (let i = 0; i < n; i++) for (const back of [false, true]) {
                const y = 21.6 - H * (i + 0.5) / n;
                for (let k = 0; k < 3; k++) {
                    const x0 = 0.15 + W * k / 3, wav = Math.sin(k * 1.4) * 0.25;
                    L.put(QUAD, M(x0 + W / 6, y, wav, W / 3, H / n, 1, back ? Math.PI : 0, 0, 0), colors[i]);
                }
            }
        },
        /** A string of pennants sagging between two points (world coordinates). */
        pennants(b: GeoBuilder, a: THREE.Vector3, c: THREE.Vector3, sag: number, colors: PropColor[]) {
            const L = new Placer(b, 0, 0, 0);
            const len = a.distanceTo(c), n = Math.max(2, Math.round(len / 2.2));
            const at = (t: number) => a.clone().lerp(c, t).setY(a.y + (c.y - a.y) * t - sag * 4 * t * (1 - t));
            const dir = c.clone().sub(a).setY(0).normalize(), side = new THREE.Vector3(-dir.z, 0, dir.x);
            for (let i = 0; i < 8; i++) L.bar(at(i / 8), at((i + 1) / 8), 0.02, 'housing');
            for (let i = 0; i < n; i++) {
                const p0 = at((i + 0.15) / n), p1 = at((i + 0.85) / n), tip = p0.clone().lerp(p1, 0.5).add(new THREE.Vector3(0, -1.0, 0));
                const col = uv(colors[i % colors.length]);
                for (const flip of [false, true]) b.poly([p0, flip ? tip : p1, flip ? p1 : tip].map(v => [v.x, v.y, v.z] as [number, number, number]), [side.x * (flip ? -1 : 1), 0, side.z * (flip ? -1 : 1)], () => col);
            }
        },
        /** Dealership pylon sign: two posts and a cabinet; returns where the face goes. */
        signCabinet(b: GeoBuilder, x: number, z: number, faceX: number, faceZ: number) {
            const L = new Placer(b, x, z, yaw(faceX, faceZ));
            for (const sx of [-3.4, 3.4]) L.box(sx, 3.5, 0, 0.5, 7, 0.5, 'bronze');
            L.box(0, 8.8, 0, 8.4, 3.8, 0.7, 'bronze');
            L.box(0, 1.0, 0, 7.8, 2.0, 0.9, 'concrete');
            return { y: 8.8, rotY: yaw(faceX, faceZ) };
        },
    };

    /** 0 = day, 1 = night: lamp lenses glow, the lamps light the scene, glare fades in. */
    let lastNight = -1;
    const setNight = (f: number) => {
        if (Math.abs(f - lastNight) < 0.005) return;
        lastNight = f;
        setGlow(P.lens, f, f * 0.84, f * 0.62);
        glow.needsUpdate = true;
        haloMat.opacity = f;
        halos.visible = f > 0.01;
        lamps.setNight(f);
    };

    return { material, city, street, lot, furniture, setNight };
}

export type PropsKit = ReturnType<typeof createPropsKit>;
