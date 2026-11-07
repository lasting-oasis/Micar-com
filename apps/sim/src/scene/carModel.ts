import * as THREE from 'three';
import { disposeCarAtlas, getCarAtlas, stepCarAtlas } from './car/carAtlas';
import { disposeStyleGeometries, getStyleGeometry, isStyleBuilt, stepStyle } from './car/carStyles';
import { HALO_HEAD, HALO_TAIL } from './car/carGeometry';

// Car models and paint (colour names, rust, mud, smoke), lamps and the per-frame car
// upkeep (far versions, contact shadows, headlight beam).
//
// Near the camera a car is 4 draw calls: its painted body (the only per-car material),
// the trim (lamps, grille, plates, black plastic, chrome, interior — one material shared
// by every car), the glass (shared) and the four wheels (one instanced mesh). Far away
// it is 2: a ~400-triangle version with the same paint and the shared trim material.
// Geometry is built once per body style (see car/carStyles.ts). The model faces -Z,
// the direction the game drives.

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
    trim: THREE.MeshStandardMaterial;          // lamps off (parked)
    trimLit: THREE.MeshStandardMaterial;       // lamps on (driven): glow follows the time of day
    trimBrake: THREE.MeshStandardMaterial;     // ... and braking: tail lamps brighter
    trimReverse: THREE.MeshStandardMaterial;   // ... and reversing: white reverse lamps on
    glass: THREE.MeshStandardMaterial;
    glassBroken: THREE.MeshStandardMaterial;
    smoke: THREE.PointsMaterial;
    halo: THREE.PointsMaterial;                // night glow around lit lamps
    shadow: THREE.MeshBasicMaterial;           // soft dark patch under every car
    textures: THREE.Texture[];
};
let shared: Shared | null = null;

const makeCanvas = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d')!);
    return c;
};
/** A canvas filled per pixel: f(u, v) -> [r, g, b, a] with u, v in -1..1. */
const fieldCanvas = (w: number, h: number, f: (u: number, v: number) => [number, number, number, number]) => makeCanvas(w, h, g => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const px = f((x + 0.5) / w * 2 - 1, (y + 0.5) / h * 2 - 1), o = (y * w + x) * 4;
        for (let k = 0; k < 4; k++) img.data[o + k] = Math.max(0, Math.min(255, Math.round(px[k] * 255)));
    }
    g.putImageData(img, 0, 0);
});
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

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

// Lamps glow through the atlas's emissive map. Deep red texels are tail lamps (scaled
// by lampBrake while braking); the reverse lamps are marked in the red channel of the
// roughness/metalness map (0 = reverse lamp) and glow white with lampReverse.
const LAMP_FRAG = /* glsl */`
#ifdef USE_EMISSIVEMAP
	vec4 lampMap = texture2D( emissiveMap, vEmissiveMapUv );
	float lampTail = smoothstep( 0.8, 0.9, ( lampMap.r - max( lampMap.g, lampMap.b ) ) / max( lampMap.r, 1e-4 ) ) * step( 0.002, lampMap.r );
	totalEmissiveRadiance *= lampMap.rgb * ( 1.0 + lampTail * ( lampBrake - 1.0 ) );
	#ifdef USE_ROUGHNESSMAP
		totalEmissiveRadiance += ( 1.0 - texture2D( roughnessMap, vRoughnessMapUv ).r ) * lampReverse;
	#endif
#endif`;
const lampTrim = (params: THREE.MeshStandardMaterialParameters, brake: number, reverse: number) => {
    const m = new THREE.MeshStandardMaterial(params);
    const u = { lampBrake: { value: brake }, lampReverse: { value: reverse } };
    m.onBeforeCompile = (sh) => {
        sh.uniforms.lampBrake = u.lampBrake; sh.uniforms.lampReverse = u.lampReverse;
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float lampBrake;\nuniform float lampReverse;')
            .replace('#include <emissivemap_fragment>', LAMP_FRAG);
    };
    m.customProgramCacheKey = () => 'carTrim2';
    return m;
};

function getShared(): Shared {
    if (shared) return shared;
    const atlas = getCarAtlas();
    const trimParams: THREE.MeshStandardMaterialParameters = {
        map: atlas.map, roughnessMap: atlas.orm, metalnessMap: atlas.orm, roughness: 1, metalness: 1,
        emissiveMap: atlas.emissive, emissive: 0xffffff, emissiveIntensity: 0,
    };
    const trim = lampTrim(trimParams, 1, 0);
    const trimLit = lampTrim({ ...trimParams, emissiveIntensity: 1 }, 1, 0);
    const trimBrake = lampTrim({ ...trimParams, emissiveIntensity: 1 }, 2.6, 0);
    const trimReverse = lampTrim({ ...trimParams, emissiveIntensity: 1 }, 1, 3);
    // Tinted glass: you see the dark cabin and headrests, not the world behind the car
    const glassParams: THREE.MeshStandardMaterialParameters = {
        color: '#0b1218', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.72,
        side: THREE.DoubleSide, depthWrite: false, forceSinglePass: true,
    };
    // (a plain white map, so the clean and the cracked glass share one shader program)
    const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.needsUpdate = true;
    const glass = new THREE.MeshStandardMaterial({ ...glassParams, map: white });
    reflectiveGlass(glass);
    // Wrecked bodies: cloudy, cracked glass
    const crackTex = new THREE.CanvasTexture(makeCanvas(256, 256, g => {
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
    // Soft round puff: engine smoke and the lamps' night glow
    const puffTex = new THREE.CanvasTexture(makeCanvas(64, 64, g => {
        const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    }));
    const smoke = new THREE.PointsMaterial({ color: 0x8a8a8a, size: 1.3, map: puffTex, vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false });
    const halo = new THREE.PointsMaterial({ size: 1.5, map: puffTex, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    // a lamp's glow is seen from in front of the lamp only (head lamps from ahead, tail lamps from
    // behind); smoke (lampDir 0) from everywhere. Smoke and glow share one shader program.
    smoke.onBeforeCompile = halo.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float lampDir;')
            .replace('#include <fog_vertex>', `#include <fog_vertex>
	float lampFacing = lampDir == 0.0 ? 1.0 : smoothstep( 0.0, 0.5, dot( normalize( ( modelViewMatrix * vec4( 0.0, 0.0, lampDir, 0.0 ) ).xyz ), normalize( - mvPosition.xyz ) ) );
	gl_PointSize *= 0.3 + 0.7 * lampFacing;
	#ifdef USE_COLOR
		vColor *= lampFacing;
	#endif`);
    };
    smoke.customProgramCacheKey = halo.customProgramCacheKey = () => 'carPoints1';
    // Contact shadow: darkest under the middle of the car, fading out past its edges
    const shadowTex = new THREE.CanvasTexture(fieldCanvas(32, 64, (u, v) => [0, 0, 0, (1 - smooth(0.45, 1, Math.abs(u))) * (1 - smooth(0.62, 1, Math.abs(v)))]));
    const shadow = new THREE.MeshBasicMaterial({ map: shadowTex, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    shared = { trim, trimLit, trimBrake, trimReverse, glass, glassBroken, smoke, halo, shadow, textures: [crackTex, puffTex, shadowTex, white] };
    return shared;
}

// ---------------------------------------------------------------------------------
// The shared atlas and each body style are built in small steps spread over frames
// (a few milliseconds of car building per frame), so filling a lot never stalls the game.
let frameNo = 0, frameStart = 0, stepsThisFrame = 0;
const STEP_BUDGET_MS = 3;
/** Call once per frame, before creating cars. */
export const carFrameTick = () => { frameNo++; frameStart = performance.now(); stepsThisFrame = 0; };
const mayStep = () => stepsThisFrame === 0 || performance.now() - frameStart < STEP_BUDGET_MS;
/** True if cars of this style can be created now; otherwise builds a little more of it (call again next frame). */
export const carStyleReady = (style: string) => {
    if (shared && isStyleBuilt(style)) return true;
    while (mayStep()) {
        stepsThisFrame++;
        if (!shared) { if (stepCarAtlas()) getShared(); continue; }
        if (stepStyle(style)) return true;
    }
    return false;
};

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
export type LampMode = 'off' | 'on' | 'brake' | 'reverse';
type CarParts = {
    style: string; length: number; width: number;
    tilt: THREE.Group; // carries everything but the wheels; the driving code pitches/rolls it
    body: THREE.Mesh; trim: THREE.Mesh; glass: THREE.Mesh; wheelMesh: THREE.InstancedMesh;
    farBody: THREE.Mesh; farTrim: THREE.Mesh; halos: THREE.Points;
    pivots: THREE.Object3D[]; wheels: THREE.Object3D[]; smoke: THREE.Points;
    lamps: LampMode; far: boolean;
    blur: boolean; lastRoll: THREE.Quaternion; syncFrame: number; // blurred rims while the wheels spin fast
    // contact shadow bookkeeping: the transform last written to the instanced mesh
    sx: number; sz: number; sqy: number; sqw: number; ss: number; sv: boolean;
};
const CAR_LIFT = 0.03; // the paving's top, above y = 0
const cars: THREE.Object3D[] = []; // every car built and not yet disposed (also CPU racers)
const partsOf = (g: THREE.Object3D) => g.userData.car as CarParts | undefined;
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

    const paint = makePaintMaterial();
    const body = new THREE.Mesh(geo.paint, paint);
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
    // Far version: same paint, shared trim material; no shadows
    const farBody = new THREE.Mesh(geo.farPaint, paint);
    const farTrim = new THREE.Mesh(geo.farTrim, S.trim);
    farBody.visible = farTrim.visible = false;
    // Night glow around the lamps (shown while the lamps are on at night); its own colours
    // (a few points) so braking and reversing can tint the tail glow
    const halos = new THREE.Points(geo.halos.clone(), S.halo);
    halos.visible = false;
    // the tilt node (at the car's origin) holds the body so it can pitch and roll; the wheels
    // stay on the group, placed from the pivots' world matrices
    const tilt = new THREE.Group();
    tilt.add(body, trim, glass, farBody, farTrim, halos);
    group.add(tilt, wheelMesh);

    // Smoke for poor mechanical condition. Always built; its visibility tracks the
    // car's CURRENT condition, so it clears on a repair.
    const partGeo = new THREE.BufferGeometry();
    const partCount = 40;
    const pPos = new Float32Array(partCount * 3);
    for (let i = 0; i < partCount; i++) {
        pPos[i * 3] = (Math.random() - 0.5) * 1.6; pPos[i * 3 + 1] = Math.random() * 3; pPos[i * 3 + 2] = (Math.random() - 0.5) * 1.6;
    }
    partGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    partGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(partCount * 3).fill(1), 3));
    partGeo.setAttribute('lampDir', new THREE.BufferAttribute(new Float32Array(partCount), 1));
    const smokeParticles = new THREE.Points(partGeo, S.smoke);
    smokeParticles.position.copy(geo.smokePos);
    smokeParticles.visible = mechCond < 50;
    tilt.add(smokeParticles);
    // the paving's top is 3 cm up: lift the whole model so the tyres stand on it
    for (const o of [...tilt.children, wheelMesh]) o.position.y += CAR_LIFT;

    const parts: CarParts = {
        style, length: geo.length, width: geo.width, tilt, body, trim, glass, wheelMesh, farBody, farTrim, halos, pivots, wheels, smoke: smokeParticles,
        lamps: 'off', far: false, blur: false, lastRoll: new THREE.Quaternion(), syncFrame: 0,
        sx: NaN, sz: NaN, sqy: NaN, sqw: NaN, ss: NaN, sv: false,
    };
    group.userData.car = parts;
    syncCarWheels(group);
    wheelMesh.computeBoundingSphere();
    cars.push(group);
    shadowsDirtyFrom = Math.min(shadowsDirtyFrom, cars.length - 1);
    return { group, tilt, wheels, body, frontPivots: pivots.slice(0, 2), smokeParticles };
};

const setBlur = (c: CarParts, blur: boolean) => {
    if (blur === c.blur) return;
    c.blur = blur;
    const g = getStyleGeometry(c.style);
    c.wheelMesh.geometry = blur ? g.wheelBlur : g.wheel;
};
/**
 * Copy the wheel nodes' roll and steer into the instanced wheel mesh (call after turning
 * them). Wheels that turn more than ~1/4 of a spoke per frame show a blurred rim, so the
 * spokes never seem to stand still or turn backwards at speed.
 */
export const syncCarWheels = (group: THREE.Object3D) => {
    const c = partsOf(group);
    if (!c) return;
    const q = c.wheels[2].quaternion, p = c.lastRoll; // a rear wheel: roll only
    const turned = 2 * Math.acos(Math.min(1, Math.abs(q.x * p.x + q.y * p.y + q.z * p.z + q.w * p.w)));
    p.copy(q);
    c.syncFrame = frameNo;
    setBlur(c, c.blur ? turned > 0.2 : turned > 0.28);
    for (let i = 0; i < 4; i++) {
        const pivot = c.pivots[i];
        tmpQ.copy(pivot.quaternion).multiply(c.wheels[i].quaternion);
        if (pivot.position.x < 0) tmpQ.multiply(FLIP); // left wheels: rim faces outward (-X)
        c.wheelMesh.setMatrixAt(i, tmpM.compose(pivot.position, tmpQ, ONE));
    }
    c.wheelMesh.instanceMatrix.needsUpdate = true;
};

// ---------------------------------------------------------------------------------
// Lamps
let nightOn = false;
const trimFor = (m: LampMode) => !shared ? null : m === 'off' ? shared.trim : m === 'brake' ? shared.trimBrake : m === 'reverse' ? shared.trimReverse : shared.trimLit;
/** Head and tail lamps: off (parked), on (driven), or on and braking / reversing. */
export const setCarLights = (group: THREE.Object3D, mode: LampMode | boolean) => {
    const c = partsOf(group);
    const m: LampMode = mode === true ? 'on' : mode === false ? 'off' : mode;
    if (!c || c.lamps === m) return;
    c.lamps = m;
    const mat = trimFor(m)!;
    c.trim.material = mat; c.farTrim.material = mat;
    c.halos.visible = m !== 'off' && nightOn;
    // tail glow: dim red when on, bright red when braking, whitish when reversing
    const col = c.halos.geometry.getAttribute('color') as THREE.BufferAttribute, dir = c.halos.geometry.getAttribute('lampDir') as THREE.BufferAttribute;
    const tail = m === 'brake' ? HALO_TAIL.map(v => v * 1.3) : m === 'reverse' ? [1, 0.8, 0.75] : HALO_TAIL.map(v => v * 0.7);
    for (let i = 0; i < col.count; i++) { const v = dir.getX(i) < 0 ? HALO_HEAD : tail; col.setXYZ(i, v[0], v[1], v[2]); }
    col.needsUpdate = true;
};

// The driven car's headlight beam on the road at night: one additive patch on the ground.
let beam: THREE.Mesh | null = null;
const getBeam = () => {
    if (beam) return beam;
    const tex = new THREE.CanvasTexture(fieldCanvas(64, 128, (u, v) => {
        const d = (1 - v) / 2; // 0 at the nose, 1 far ahead (canvas rows run top to bottom)
        const w = 0.22 + 0.7 * d; // the fan widens ahead
        let a = Math.exp(-((u / w) ** 2) * 1.6);
        a *= smooth(0.02, 0.3, d) * (1 - smooth(0.6, 1, d));
        return [a, a * 0.95, a * 0.84, 1];
    }));
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(14, 34);
    geo.rotateX(-Math.PI / 2);
    beam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    beam.renderOrder = -1;
    beam.visible = false;
    return beam;
};
/** Lamp glow for the time of day (0 = day, 1 = night). Call once per frame. */
export const updateCarLights = (nightFactor: number) => {
    if (!shared) return;
    const k = 0.7 + 2.3 * nightFactor;
    shared.trimLit.emissiveIntensity = k; shared.trimBrake.emissiveIntensity = k; shared.trimReverse.emissiveIntensity = k;
    const on = nightFactor > 0.05;
    shared.halo.opacity = 0.75 * nightFactor;
    if (beam) (beam.material as THREE.MeshBasicMaterial).opacity = 0.5 * nightFactor;
    if (on !== nightOn) { nightOn = on; for (const g of cars) { const c = partsOf(g)!; c.halos.visible = c.lamps !== 'off' && on; } }
};

// ---------------------------------------------------------------------------------
// Per-frame upkeep: far versions and contact shadows
let shadowMesh: THREE.InstancedMesh | null = null, shadowScene: THREE.Object3D | null = null;
let shadowsDirtyFrom = 0, lastLodCheck = -1e9;
const tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3();
const SHADOW_Y = 0.05; // just above the paving (top at 0.03, paint 0.038, driveway aprons 0.045); polygonOffset does the rest

/**
 * Add the shared contact-shadow mesh (one draw for every car) to the scene. Call once, and again
 * to move the shadows to another scene (e.g. a second district): only cars in that scene cast them.
 */
export const attachCarShadows = (scene: THREE.Object3D) => {
    shadowScene = scene;
    if (shadowMesh) scene.add(shadowMesh);
    shadowsDirtyFrom = 0;
};
/** The scene the contact shadows are drawn in (null before attachCarShadows). */
export const carShadowScene = () => shadowScene;
const rootOf = (o: THREE.Object3D) => { while (o.parent) o = o.parent; return o; };
const ensureShadowMesh = (n: number) => {
    if (!shadowScene || !shared) return null;
    if (shadowMesh && shadowMesh.instanceMatrix.count >= n) return shadowMesh;
    const cap = Math.max(32, 2 ** Math.ceil(Math.log2(Math.max(1, n))));
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    if (shadowMesh) { shadowMesh.removeFromParent(); shadowMesh.geometry.dispose(); shadowMesh.dispose(); }
    shadowMesh = new THREE.InstancedMesh(plane, shared.shadow, cap);
    shadowMesh.frustumCulled = false;   // spans every car; 2 triangles each
    shadowMesh.renderOrder = -1;        // before the cars' glass
    shadowMesh.userData.dynamic = true;
    shadowMesh.count = 0;
    shadowScene.add(shadowMesh);
    shadowsDirtyFrom = 0;
    return shadowMesh;
};

/**
 * Once per frame, after the cars have moved: switch distant cars to their far version
 * (checked 4x a second, with hysteresis; never the car being driven), move the contact
 * shadows of cars that moved, and put the headlight beam under the driven car at night.
 * `high`: High graphics (far versions beyond 120 units, lighter shadows) or Low (90).
 */
export const updateCars = (camPos: THREE.Vector3, high: boolean, driven: THREE.Object3D | null) => {
    const now = performance.now();
    if (now - lastLodCheck > 250) {
        lastLodCheck = now;
        const farAt = high ? 120 : 90, nearAt = high ? 108 : 80;
        for (const g of cars) {
            const c = partsOf(g)!;
            const d = g.position.distanceTo(camPos);
            const far = g !== driven && (c.far ? d > nearAt : d > farAt);
            if (far !== c.far) {
                c.far = far;
                c.body.visible = c.trim.visible = c.glass.visible = c.wheelMesh.visible = !far;
                c.farBody.visible = c.farTrim.visible = far;
            }
            if (c.blur && frameNo - c.syncFrame > 2) setBlur(c, false); // stopped turning the wheels
        }
    }
    // headlight beam on the road ahead of the car being driven, at night
    if (driven && nightOn && partsOf(driven)) {
        const b = getBeam();
        if (b.parent !== driven) { b.removeFromParent(); driven.add(b); b.position.set(0, 0.12, getStyleGeometry(partsOf(driven)!.style).beamZ - 16.4); }
        b.visible = true;
    } else if (beam && beam.parent) { beam.removeFromParent(); beam.visible = false; }
    if (shared) shared.shadow.opacity = high ? 0.38 : 0.6;
    const sm = ensureShadowMesh(cars.length);
    if (!sm) return;
    let changed = false;
    for (let i = 0; i < cars.length; i++) {
        const g = cars[i], c = partsOf(g)!;
        const vis = g.visible && !!g.parent && rootOf(g) === shadowScene, q = g.quaternion, s = g.scale.x;
        if (i < shadowsDirtyFrom && vis === c.sv && g.position.x === c.sx && g.position.z === c.sz && q.y === c.sqy && q.w === c.sqw && s === c.ss) continue;
        c.sx = g.position.x; c.sz = g.position.z; c.sqy = q.y; c.sqw = q.w; c.ss = s; c.sv = vis;
        tmpQ.set(0, q.y, 0, q.w).normalize(); // cars only turn about the vertical
        tmpS.set(vis ? (c.width + 0.7) * s : 0, 1, vis ? (c.length + 0.9) * s : 0);
        sm.setMatrixAt(i, tmpM.compose(tmpV.set(g.position.x, SHADOW_Y, g.position.z), tmpQ, tmpS));
        changed = true;
    }
    shadowsDirtyFrom = cars.length;
    if (sm.count !== cars.length) { sm.count = cars.length; changed = true; }
    if (changed) sm.instanceMatrix.needsUpdate = true;
};
/**
 * Get every car shader program ready ahead of time, a little per frame, without holding
 * up joining: call once per frame from a second or two after the first frame. Builds the
 * shared atlas and the sedan in steps, then one hidden car with every variant shown (body,
 * trim, both glasses, wheels, far version, glow, smoke, beam, contact shadows), compiles
 * the scene with compileAsync (off the main thread where the GPU driver supports it), and
 * in a later frame draws it once into a single pixel: some drivers, and software
 * rendering, only finish a shader (and upload textures) on its first draw.
 */
type Precompile = { state: 'build' | 'compiling' | 'draw' | 'done'; probe?: THREE.Group; broken?: THREE.Mesh; idleFrames: number };
const pre: Precompile = { state: 'build', idleFrames: 0 };
let keptPaint: THREE.Material | null = null;
const FAR_AWAY = 1e5; // the probe waits out of sight (and its contact shadow with it)
export const precompileCarsTick = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => {
    if (pre.state === 'done' || pre.state === 'compiling') return;
    if (pre.state === 'build') {
        if (!carStyleReady('sedan')) return;
        const g = buildCarModel('sedan', '#808080', 100, 20).group, c = partsOf(g)!;
        g.position.set(FAR_AWAY, -500, FAR_AWAY);
        const broken = new THREE.Mesh(c.glass.geometry, shared!.glassBroken);
        const b = getBeam();
        c.farBody.visible = c.farTrim.visible = c.halos.visible = c.smoke.visible = true;
        g.add(broken, b); b.visible = true;
        scene.add(g);
        ensureShadowMesh(1);
        pre.probe = g as THREE.Group; pre.broken = broken; pre.state = 'compiling';
        const r = renderer as THREE.WebGLRenderer & { compileAsync?: (o: THREE.Object3D, c: THREE.Camera, t?: THREE.Scene) => Promise<unknown> };
        const next = () => { if (pre.probe === g) { pre.state = 'draw'; pre.idleFrames = 0; } }; // (unless the world closed meanwhile)
        if (r.compileAsync) r.compileAsync(scene, camera).then(next, next);
        else { renderer.compile(scene, camera); next(); }
        return;
    }
    // 'draw': wait for a quiet frame (no car building this frame), then draw the probe once
    if (stepsThisFrame > 0 && ++pre.idleFrames < 30) return;
    const g = pre.probe!, c = partsOf(g)!, b = getBeam();
    camera.updateMatrixWorld();
    g.position.copy(camera.position).add(tmpV.set(0, 0, -12).applyQuaternion(camera.quaternion));
    g.position.y = 0;
    const sc = renderer.getScissorTest(), box = renderer.getScissor(new THREE.Vector4());
    renderer.setScissorTest(true); renderer.setScissor(0, 0, 1, 1);
    if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true; // the shadow-casting variants too
    renderer.render(scene, camera);
    if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true; // and redraw the real shadows without the probe
    renderer.setScissor(box); renderer.setScissorTest(sc);
    // Take the probe away again, but keep its paint material: disposing it would release the
    // shared paint program (and its shadow variant), which the next car would compile again.
    b.removeFromParent(); b.visible = false; pre.broken!.removeFromParent(); g.removeFromParent();
    const i = cars.indexOf(g); if (i >= 0) { cars.splice(i, 1); shadowsDirtyFrom = Math.min(shadowsDirtyFrom, i); }
    keptPaint?.dispose(); keptPaint = c.body.material as THREE.Material;
    c.smoke.geometry.dispose(); c.halos.geometry.dispose(); c.wheelMesh.dispose();
    pre.state = 'done'; pre.probe = pre.broken = undefined;
};

/** Remove a car and free what belongs to it alone (shared geometry/materials stay). */
export const disposeCarModel = (group: THREE.Object3D) => {
    group.removeFromParent();
    const c = partsOf(group);
    if (!c) return;
    if (beam && beam.parent === group) { beam.removeFromParent(); beam.visible = false; }
    const i = cars.indexOf(group);
    if (i >= 0) { cars.splice(i, 1); shadowsDirtyFrom = Math.min(shadowsDirtyFrom, i); }
    (c.body.material as THREE.Material).dispose();
    c.smoke.geometry.dispose();
    c.halos.geometry.dispose();
    c.wheelMesh.dispose();
};

/** Free the shared car geometry, materials and textures (when the 3D world closes). */
export const disposeSharedCarAssets = () => {
    disposeStyleGeometries();
    if (shadowMesh) { shadowMesh.removeFromParent(); shadowMesh.geometry.dispose(); shadowMesh.dispose(); shadowMesh = null; }
    shadowScene = null;
    if (beam) { beam.removeFromParent(); beam.geometry.dispose(); const m = beam.material as THREE.MeshBasicMaterial; m.map?.dispose(); m.dispose(); beam = null; }
    if (shared) {
        [shared.trim, shared.trimLit, shared.trimBrake, shared.trimReverse, shared.glass, shared.glassBroken, shared.smoke, shared.halo, shared.shadow].forEach(m => m.dispose());
        shared.textures.forEach(t => t.dispose());
        shared = null;
    }
    disposeCarAtlas();
    keptPaint?.dispose(); keptPaint = null;
    pre.state = 'build'; pre.probe = pre.broken = undefined;
    cars.length = 0;
    nightOn = false; frameNo = 0; stepsThisFrame = 0;
};
