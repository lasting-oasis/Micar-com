import * as THREE from 'three';
import { disposeCarAtlas, getCarAtlas } from './car/carAtlas';
import { disposeStyleGeometries, getStyleGeometry } from './car/carStyles';

// Car models and paint (colour names, rust, mud, smoke).
//
// A car is 4 draw calls: its painted body (the only per-car material), the trim
// (lamps, grille, plates, black plastic, chrome, interior — one material shared by
// every car), the glass (shared) and the four wheels (one instanced mesh, shared
// material). Geometry is built once per body style and shared by every car of that
// style (see car/carStyles.ts). The model faces -Z, the direction the game drives.

// Map the game's colour names to real colours.
export const carColorHex = (c?: string) => {
    if (c === 'Trade-In Silver') return '#C0C0C0';
    if (c === 'Repo Gray') return '#808080';
    if (c === 'Rusted Scrap') return '#6e5446';
    return c || '#4b5563';
};
// Fallback body style for legacy/customer cars that have no bodyStyle set.
export const deriveStyle = (model: string) => {
    const m = (model || '').toLowerCase();
    if (/f-150|silverado|tacoma|tundra|ranger|colorado|ridgeline|truck|pickup/.test(m)) return 'truck';
    if (/rav4|cr-v|explorer|tahoe|x5|x3|pilot|equinox|escape|suv/.test(m)) return 'suv';
    if (/mustang|camaro|corvette|supra|\bz4\b|sport/.test(m)) return 'sports';
    if (/\bm4\b|4 series|coupe/.test(m)) return 'coupe';
    if (/prius|\bfit\b|focus|hatch/.test(m)) return 'hatchback';
    if (/sienna|odyssey|\bvan\b/.test(m)) return 'van';
    return 'sedan';
};

// ---------------------------------------------------------------------------------
// Shared materials (one set for all cars)
type Shared = {
    trim: THREE.MeshStandardMaterial;      // lamps off (parked)
    trimLit: THREE.MeshStandardMaterial;   // lamps on (driven): glow follows the time of day
    glass: THREE.MeshStandardMaterial;
    glassBroken: THREE.MeshStandardMaterial;
    smoke: THREE.PointsMaterial;
    textures: THREE.Texture[];
};
let shared: Shared | null = null;

const makeCanvas = (size: number, draw: (g: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d')!);
    return c;
};

/** Glass whose reflections are not dimmed by its transparency (only what is seen through it is). */
const reflectiveGlass = (m: THREE.MeshStandardMaterial) => {
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
            'gl_FragColor = vec4( ( totalDiffuse + totalEmissiveRadiance ) * diffuseColor.a + totalSpecular, diffuseColor.a );');
    };
    m.customProgramCacheKey = () => 'carGlass1';
};

function getShared(): Shared {
    if (shared) return shared;
    const atlas = getCarAtlas();
    const trimParams: THREE.MeshStandardMaterialParameters = {
        map: atlas.map, roughnessMap: atlas.orm, metalnessMap: atlas.orm, roughness: 1, metalness: 1,
        emissiveMap: atlas.emissive, emissive: 0xffffff, emissiveIntensity: 0,
    };
    const trim = new THREE.MeshStandardMaterial(trimParams);
    const trimLit = new THREE.MeshStandardMaterial({ ...trimParams, emissiveIntensity: 1 });
    // Tinted glass: you see the dark cabin and headrests, not the world behind the car
    const glassParams: THREE.MeshStandardMaterialParameters = {
        color: '#0b1218', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.72,
        side: THREE.DoubleSide, depthWrite: false, forceSinglePass: true,
    };
    const glass = new THREE.MeshStandardMaterial(glassParams);
    reflectiveGlass(glass);
    // Wrecked bodies: cloudy, cracked glass
    const crackTex = new THREE.CanvasTexture(makeCanvas(256, g => {
        g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
        g.strokeStyle = 'rgba(40,46,52,0.85)'; g.lineWidth = 1.4;
        const cx = 120, cy = 140;
        for (let i = 0; i < 14; i++) {
            const a = i / 14 * Math.PI * 2 + (i % 3) * 0.13;
            g.beginPath(); g.moveTo(cx, cy);
            let x = cx, y = cy;
            for (let k = 0; k < 6; k++) { x += Math.cos(a + (k % 2 ? 0.2 : -0.15)) * 26; y += Math.sin(a + (k % 2 ? 0.2 : -0.15)) * 26; g.lineTo(x, y); }
            g.stroke();
        }
        for (const r of [22, 48, 80]) { g.beginPath(); for (let i = 0; i <= 14; i++) { const a = i / 14 * Math.PI * 2; const rr = r * (0.85 + 0.3 * ((i * 7) % 5) / 5); i ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.stroke(); }
    }));
    crackTex.wrapS = crackTex.wrapT = THREE.RepeatWrapping;
    crackTex.colorSpace = THREE.SRGBColorSpace;
    const glassBroken = new THREE.MeshStandardMaterial({ ...glassParams, color: '#8d98a3', map: crackTex, roughness: 0.55, metalness: 0, opacity: 0.86 });
    reflectiveGlass(glassBroken);
    // Engine smoke: soft round puffs
    const puffTex = new THREE.CanvasTexture(makeCanvas(64, g => {
        const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    }));
    const smoke = new THREE.PointsMaterial({ color: 0x8a8a8a, size: 1.3, map: puffTex, transparent: true, opacity: 0.5, depthWrite: false });
    shared = { trim, trimLit, glass, glassBroken, smoke, textures: [crackTex, puffTex] };
    return shared;
}

// ---------------------------------------------------------------------------------
// Paint: metallic car paint, plus patchy rust (badly damaged body) and caked mud
// (dirty car) worked out in the shader from the car-space position. All paint
// materials share one shader program.
const PAINT_PARS = /* glsl */`
varying vec3 vCarPos;
uniform float carDirt;
uniform float carRust;
float carHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float carNoise( vec3 x ) {
	vec3 i = floor( x ); vec3 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( mix( carHash( i ), carHash( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ), mix( carHash( i + vec3( 0.0, 1.0, 0.0 ) ), carHash( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),
		mix( mix( carHash( i + vec3( 0.0, 0.0, 1.0 ) ), carHash( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ), mix( carHash( i + vec3( 0.0, 1.0, 1.0 ) ), carHash( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ), f.z );
}`;
const PAINT_FRAG = /* glsl */`
if ( carRust > 0.0 ) {
	float rn = carNoise( vCarPos * 2.7 ) * 0.62 + carNoise( vCarPos * 8.3 ) * 0.38;
	float low = 1.0 - smoothstep( 0.4, 1.8, vCarPos.y );
	float spots = smoothstep( 0.6, 0.68, rn + low * 0.3 + carRust * 0.34 - 0.24 );
	vec3 rustCol = mix( vec3( 0.1, 0.022, 0.006 ), vec3( 0.24, 0.06, 0.012 ), carNoise( vCarPos * 13.0 ) );
	diffuseColor.rgb = mix( diffuseColor.rgb, rustCol, spots );
	roughnessFactor = mix( roughnessFactor, 0.95, spots );
	metalnessFactor = mix( metalnessFactor, 0.0, spots );
}
if ( carDirt > 0.0 ) {
	float dn = carNoise( vCarPos * 1.9 ) * 0.6 + carNoise( vCarPos * 6.5 ) * 0.4;
	float caked = 1.0 - smoothstep( 0.6, 1.5, vCarPos.y + ( dn - 0.5 ) * 0.9 );
	float film = 0.58 + 0.25 * dn;
	float m = carDirt * max( caked, film );
	vec3 mudCol = mix( vec3( 0.05, 0.03, 0.017 ), vec3( 0.14, 0.09, 0.055 ), smoothstep( 0.6, 2.4, vCarPos.y ) * ( 0.7 + 0.3 * dn ) );
	diffuseColor.rgb = mix( diffuseColor.rgb, mudCol, m );
	roughnessFactor = mix( roughnessFactor, 1.0, m );
	metalnessFactor = mix( metalnessFactor, 0.0, m );
}`;
type PaintUniforms = { carDirt: { value: number }; carRust: { value: number } };
const makePaintMaterial = () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.3 });
    const u: PaintUniforms = { carDirt: { value: 0 }, carRust: { value: 0 } };
    mat.userData.carPaint = u;
    mat.onBeforeCompile = (sh) => {
        sh.uniforms.carDirt = u.carDirt; sh.uniforms.carRust = u.carRust;
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vCarPos;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvCarPos = position;');
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\n' + PAINT_PARS)
            .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + PAINT_FRAG);
    };
    mat.customProgramCacheKey = () => 'carPaint1';
    // the body is an open shell: put every face in the sun's shadow map, not only the back faces
    mat.shadowSide = THREE.DoubleSide;
    return mat;
};

const RUST_FADE = new THREE.Color('#7a5a48');
const tmpColor = new THREE.Color();
/** Paint a car: its colour, rust and a dull finish when the body is badly damaged, mud when dirty, cracked glass when wrecked. */
export const applyCarPaint = (body: THREE.Mesh, hex: string, bodyCond: number, dirty: boolean) => {
    const mat = body.material as THREE.MeshStandardMaterial;
    const u = mat.userData.carPaint as PaintUniforms;
    mat.color.set(hex);
    // light colours read best as solid paint, darker ones as metallic
    const lum = tmpColor.copy(mat.color).getHSL({ h: 0, s: 0, l: 0 }).l;
    const rust = bodyCond < 50 ? 1 - bodyCond / 50 : 0;
    if (rust > 0) {
        mat.color.lerp(RUST_FADE, rust * 0.4);
        mat.roughness = 0.55 + 0.35 * rust; mat.metalness = 0.3 * (1 - rust);
    } else {
        mat.roughness = 0.28; mat.metalness = lum > 0.8 ? 0.25 : 0.55;
    }
    u.carRust.value = rust;
    u.carDirt.value = dirty ? 1 : 0;
    const glass = body.userData.glass as THREE.Mesh | undefined;
    if (glass && shared) glass.material = bodyCond < 25 ? shared.glassBroken : shared.glass;
};

// ---------------------------------------------------------------------------------
type CarParts = {
    body: THREE.Mesh; trim: THREE.Mesh; glass: THREE.Mesh; wheelMesh: THREE.InstancedMesh;
    pivots: THREE.Object3D[]; wheels: THREE.Object3D[]; smoke: THREE.Points;
};
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1);
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

/**
 * Build a car. `wheels` are the four wheel nodes (FL, FR, RL, RR: rotateX rolls them)
 * and `frontPivots` the two steering pivots (rotation.y steers); call syncCarWheels
 * after changing them. Dispose with disposeCarModel (shared parts stay alive).
 */
export const buildCarModel = (style: string, rawColor: string, bodyCond: number = 100, mechCond: number = 100) => {
    const S = getShared();
    const geo = getStyleGeometry(style);
    const group = new THREE.Group();
    group.userData.dynamic = true;

    const body = new THREE.Mesh(geo.paint, makePaintMaterial());
    body.castShadow = true; body.receiveShadow = true;
    const trim = new THREE.Mesh(geo.trim, S.trim);
    trim.receiveShadow = true;
    const glass = new THREE.Mesh(geo.glass, S.glass);
    body.userData.glass = glass;
    applyCarPaint(body, rawColor, bodyCond, false);

    // Four wheels in one instanced draw; pivots/wheels are plain nodes the game turns
    const wheelMesh = new THREE.InstancedMesh(geo.wheel, S.trim, 4);
    wheelMesh.castShadow = true; wheelMesh.receiveShadow = true;
    const pivots: THREE.Object3D[] = [], wheels: THREE.Object3D[] = [];
    geo.wheelPos.forEach(p => {
        const pivot = new THREE.Object3D(); pivot.position.copy(p);
        const wheel = new THREE.Object3D(); pivot.add(wheel);
        pivots.push(pivot); wheels.push(wheel);
    });
    group.add(body, trim, glass, wheelMesh);

    // Smoke for poor mechanical condition. Always built; its visibility tracks the
    // car's CURRENT condition, so it clears on a repair.
    const partGeo = new THREE.BufferGeometry();
    const partCount = 40;
    const pPos = new Float32Array(partCount * 3);
    for (let i = 0; i < partCount; i++) {
        pPos[i * 3] = (Math.random() - 0.5) * 1.6; pPos[i * 3 + 1] = Math.random() * 3; pPos[i * 3 + 2] = (Math.random() - 0.5) * 1.6;
    }
    partGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const smokeParticles = new THREE.Points(partGeo, S.smoke);
    smokeParticles.position.copy(geo.smokePos);
    smokeParticles.visible = mechCond < 50;
    group.add(smokeParticles);

    const parts: CarParts = { body, trim, glass, wheelMesh, pivots, wheels, smoke: smokeParticles };
    group.userData.car = parts;
    syncCarWheels(group);
    wheelMesh.computeBoundingSphere();
    return { group, wheels, body, frontPivots: pivots.slice(0, 2), smokeParticles };
};

/** Copy the wheel nodes' roll and steer into the instanced wheel mesh. */
export const syncCarWheels = (group: THREE.Object3D) => {
    const c = group.userData.car as CarParts | undefined;
    if (!c) return;
    for (let i = 0; i < 4; i++) {
        const pivot = c.pivots[i];
        tmpQ.copy(pivot.quaternion).multiply(c.wheels[i].quaternion);
        if (pivot.position.x < 0) tmpQ.multiply(FLIP); // left wheels: rim faces outward (-X)
        c.wheelMesh.setMatrixAt(i, tmpM.compose(pivot.position, tmpQ, ONE));
    }
    c.wheelMesh.instanceMatrix.needsUpdate = true;
};

/** Head and tail lamps on (driven cars) or off (parked). */
export const setCarLights = (group: THREE.Object3D, on: boolean) => {
    const c = group.userData.car as CarParts | undefined;
    if (!c || !shared) return;
    const m = on ? shared.trimLit : shared.trim;
    if (c.trim.material !== m) c.trim.material = m;
};

/** Lamp glow for the time of day (0 = day, 1 = night). Call once per frame. */
export const updateCarLights = (nightFactor: number) => {
    if (shared) shared.trimLit.emissiveIntensity = 0.7 + 2.3 * nightFactor;
};

/** Remove a car and free what belongs to it alone (shared geometry/materials stay). */
export const disposeCarModel = (group: THREE.Object3D) => {
    group.removeFromParent();
    const c = group.userData.car as CarParts | undefined;
    if (!c) return;
    (c.body.material as THREE.Material).dispose();
    c.smoke.geometry.dispose();
    c.wheelMesh.dispose();
};

/** Free the shared car geometry, materials and textures (when the 3D world closes). */
export const disposeSharedCarAssets = () => {
    disposeStyleGeometries();
    if (shared) {
        [shared.trim, shared.trimLit, shared.glass, shared.glassBroken, shared.smoke].forEach(m => m.dispose());
        shared.textures.forEach(t => t.dispose());
        shared = null;
    }
    disposeCarAtlas();
};
