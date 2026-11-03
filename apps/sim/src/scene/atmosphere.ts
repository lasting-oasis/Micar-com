import * as THREE from 'three';

// Sky, sun, sky light, fog and exposure for any time of day.
//
// The visible sky is a cheap gradient shader (zenith → horizon, a warmer horizon
// on the sun's side, the sun's disc and glow, stars at night) drawn behind
// everything. The same colours light the world:
//  - High graphics: the sky is rendered into a small cube map whenever the sun has
//    moved, and turned into a reflection/sky-light map (PMREM) for every material.
//  - Low graphics: no map; the shader patch below works out the same gradient per
//    pixel from three shared colours (cheap: no texture reads).
// Colours come from keyframes by sun elevation, hand-tuned to real skies.

type Key = {
    el: number;          // sun elevation, degrees
    zenith: string; horizon: string; horizonSun: string; ground: string;
    sun: string; sunI: number;   // direct sunlight colour / intensity
    glow: number;        // sun halo strength
    stars: number;       // 0..1
    exposure: number;
};
const KEYS: Key[] = [
    { el: -18, zenith: '#060c1c', horizon: '#141d33', horizonSun: '#161f35', ground: '#090c14', sun: '#8fa8d8', sunI: 0.0, glow: 0.0, stars: 1.0, exposure: 1.55 },
    { el: -8,  zenith: '#0c1530', horizon: '#252e4c', horizonSun: '#383452', ground: '#10131d', sun: '#8fa8d8', sunI: 0.0, glow: 0.05, stars: 0.75, exposure: 1.4 },
    { el: -3,  zenith: '#1d2c55', horizon: '#6a5f80', horizonSun: '#c56f55', ground: '#2a2833', sun: '#ff7f4f', sunI: 0.0, glow: 0.45, stars: 0.15, exposure: 1.2 },
    { el: 0,   zenith: '#33508a', horizon: '#c99a82', horizonSun: '#ff8a47', ground: '#4b4646', sun: '#ff9858', sunI: 0.8, glow: 1.1, stars: 0.0, exposure: 1.1 },
    { el: 4,   zenith: '#3f68a8', horizon: '#dcc0a6', horizonSun: '#ffb064', ground: '#585a52', sun: '#ffbd80', sunI: 1.7, glow: 0.95, stars: 0.0, exposure: 1.05 },
    { el: 12,  zenith: '#3a6cb2', horizon: '#bcd0e3', horizonSun: '#f2d6ae', ground: '#6b7360', sun: '#ffdcb0', sunI: 2.5, glow: 0.55, stars: 0.0, exposure: 1.0 },
    { el: 30,  zenith: '#2f68b6', horizon: '#adc9e6', horizonSun: '#d8e2ec', ground: '#6d7763', sun: '#fff0db', sunI: 3.0, glow: 0.35, stars: 0.0, exposure: 1.0 },
    { el: 60,  zenith: '#2a62b4', horizon: '#a6c4e4', horizonSun: '#cbdcee', ground: '#6e7864', sun: '#fff5e6', sunI: 3.2, glow: 0.25, stars: 0.0, exposure: 1.0 },
];
// The sky as a light source is boosted relative to the visible sky: open shade in a
// game reads better a little brighter than physically exact.
const SKY_LIGHT_BOOST = 1.8;
const MOON_COLOR = new THREE.Color('#9db4e6');
const MOON_INTENSITY = 0.7;

// Sun path for the game clock (the business day runs 8:00–20:00 and the clock stops at 20:00).
const SUNRISE = 6.5, SUNSET = 19.0, PEAK_ELEVATION = 55;
export const sunElevationAt = (t: number) => {
    if (t >= SUNRISE && t <= SUNSET) return PEAK_ELEVATION * Math.sin(Math.PI * (t - SUNRISE) / (SUNSET - SUNRISE));
    const hoursOutside = t > SUNSET ? t - SUNSET : SUNRISE - t;
    return -Math.min(18, hoursOutside * 14);
};
// Azimuth (radians, from +z toward +x): rises in the east (+x), crosses the south (−z) and sets in the west (−x, a little +z).
const sunAzimuthAt = (t: number) => {
    const p = THREE.MathUtils.clamp((t - SUNRISE) / (SUNSET - SUNRISE), -0.25, 1.25);
    return THREE.MathUtils.degToRad(105 + p * 180);
};

const tmpA = new THREE.Color(), tmpB = new THREE.Color();
const mixKeyColor = (a: Key, b: Key, f: number, field: 'zenith' | 'horizon' | 'horizonSun' | 'ground' | 'sun', out: THREE.Color) =>
    out.copy(tmpA.set(a[field])).lerp(tmpB.set(b[field]), f);

// ---- Low graphics: sky light worked out in the shader ------------------------------
// Shared by reference with every MeshStandard/Physical material (three.js copies plain
// objects in material uniforms by reference), so updating these updates them all.
const lowSkyZenith = { r: 0.2, g: 0.3, b: 0.6 };
const lowSkyHorizon = { r: 0.4, g: 0.55, b: 0.8 };
const lowSkyGround = { r: 0.1, g: 0.11, b: 0.09 };
let cheapSkyInstalled = false;
export const installCheapSkyLighting = () => {
    if (cheapSkyInstalled) return;
    cheapSkyInstalled = true;
    for (const lib of [THREE.ShaderLib.standard, THREE.ShaderLib.physical]) {
        lib.uniforms.lowSkyZenith = { value: lowSkyZenith };
        lib.uniforms.lowSkyHorizon = { value: lowSkyHorizon };
        lib.uniforms.lowSkyGround = { value: lowSkyGround };
    }
    THREE.ShaderChunk.lights_physical_pars_fragment += /* glsl */`
#ifndef USE_ENVMAP
uniform vec3 lowSkyZenith;
uniform vec3 lowSkyHorizon;
uniform vec3 lowSkyGround;
// the visible sky's gradient (see SkyDome) as seen in direction with height y
vec3 lowSkyRadiance( const in float y ) {
	return y >= 0.0 ? mix( lowSkyHorizon, lowSkyZenith, sqrt( y ) ) : mix( lowSkyHorizon, lowSkyGround, smoothstep( 0.0, 0.12, - y ) );
}
// the same sky through a fully rough (cosine) lobe
vec3 lowSkyIrradiance( const in float y ) {
	vec3 skyAvg = 0.6 * lowSkyZenith + 0.4 * lowSkyHorizon;
	return mix( lowSkyGround, skyAvg, clamp( y * 0.5 + 0.5, 0.0, 1.0 ) );
}
#endif
`;
    THREE.ShaderChunk.lights_fragment_maps += /* glsl */`
#if defined( STANDARD ) && ! defined( USE_ENVMAP ) && defined( RE_IndirectDiffuse ) && defined( RE_IndirectSpecular )
	{
		float skyUp = inverseTransformDirection( geometryNormal, viewMatrix ).y;
		iblIrradiance += PI * lowSkyIrradiance( skyUp );
		vec3 skyDir = reflect( - geometryViewDir, geometryNormal );
		skyDir = normalize( mix( skyDir, geometryNormal, material.roughness * material.roughness ) );
		float skyY = inverseTransformDirection( skyDir, viewMatrix ).y;
		radiance += mix( lowSkyRadiance( skyY ), lowSkyIrradiance( skyY ), material.roughness );
	}
#endif
`;
};

// ---- Clouds: a tileable noise texture built once (two reads per sky pixel) --------
const makeCloudTexture = (size = 256) => {
    let seed = 1337;
    const rand = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const grids = [4, 8, 16, 32, 64].map(period => { const g = new Float32Array(period * period); for (let i = 0; i < g.length; i++) g[i] = rand(); return { period, g }; });
    const smooth = (t: number) => t * t * (3 - 2 * t);
    const sample = (o: { period: number; g: Float32Array }, u: number, v: number) => {
        const x = u * o.period, y = v * o.period;
        const x0 = Math.floor(x), y0 = Math.floor(y), fx = smooth(x - x0), fy = smooth(y - y0);
        const P = o.period, at = (i: number, j: number) => o.g[((j % P) + P) % P * P + ((i % P) + P) % P];
        const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
        return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
    };
    const data = new Uint8Array(size * size * 4);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
        let v = 0, amp = 0.5, norm = 0;
        for (const o of grids) { v += sample(o, i / size, j / size) * amp; norm += amp; amp *= 0.5; }
        const k = (j * size + i) * 4;
        data[k] = data[k + 1] = data[k + 2] = Math.round(255 * v / norm); data[k + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
};

// ---- The visible sky ---------------------------------------------------------------
const skyVertex = /* glsl */`
varying vec3 vDir;
void main() {
	vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
	vDir = worldPosition.xyz - cameraPosition;
	gl_Position = projectionMatrix * viewMatrix * worldPosition;
	gl_Position.z = gl_Position.w; // always at the far plane, behind everything
}`;
const skyFragment = /* glsl */`
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHorizonSun;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uGlow;
uniform float uSunDisc;
uniform float uStars;
uniform float uIntensity;
uniform sampler2D uClouds;
uniform float uCloudTime;
uniform float uCloudCover;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
varying vec3 vDir;
float starHash( vec3 p ) {
	p = fract( p * 0.3183099 + 0.1 ); p *= 17.0;
	return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
void main() {
	vec3 d = normalize( vDir );
	float y = d.y;
	vec2 dh = normalize( d.xz + 1e-5 );
	vec2 sh = normalize( uSunDir.xz + 1e-5 );
	float sunSide = pow( max( dot( dh, sh ) * 0.5 + 0.5, 0.0 ), 3.0 );
	vec3 horizon = mix( uHorizon, uHorizonSun, sunSide );
	vec3 col = y >= 0.0 ? mix( horizon, uZenith, sqrt( y ) ) : mix( horizon, uGround, smoothstep( 0.0, 0.12, - y ) );
	float cosSun = max( dot( d, uSunDir ), 0.0 );
	col += uSunColor * uGlow * ( 0.25 * pow( cosSun, 5.0 ) + 0.5 * pow( cosSun, 48.0 ) );
	col += uSunColor * uSunDisc * smoothstep( 0.99975, 0.9999, cosSun );
	if ( uStars > 0.0 && y > 0.0 ) {
		float h = starHash( floor( d * 700.0 ) );
		col += vec3( step( 0.9982, h ) * ( 0.35 + 0.65 * fract( h * 91.7 ) ) ) * uStars * smoothstep( 0.02, 0.2, y );
	}
	if ( y > 0.0 ) {
		// a cloud layer seen from below: project onto a plane, flatten toward the horizon
		vec2 uv = d.xz / ( y + 0.08 ) * 0.11;
		float n = texture2D( uClouds, uv + vec2( uCloudTime * 0.0025, uCloudTime * 0.001 ) ).r * 0.62
			+ texture2D( uClouds, uv * 2.9 + vec2( - uCloudTime * 0.004, uCloudTime * 0.002 ) ).r * 0.38;
		float c = smoothstep( uCloudCover, uCloudCover + 0.22, n ) * smoothstep( 0.0, 0.18, y );
		float thick = smoothstep( uCloudCover, uCloudCover + 0.45, n );
		vec3 cloud = mix( uCloudLit, uCloudShade, thick * 0.75 );
		cloud += uSunColor * uGlow * 0.6 * pow( cosSun, 10.0 ) * ( 1.0 - thick ); // bright edges toward the sun
		col = mix( col, cloud, c * 0.92 );
	}
	gl_FragColor = vec4( col * uIntensity, 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

export class Atmosphere {
    readonly sky: THREE.Mesh;
    /** 0 = daylight, 1 = full night (drives lamps and lit windows) */
    nightFactor = 0;
    elevation = 30;
    readonly sunDir = new THREE.Vector3(0, 1, 0);

    private readonly uniforms: Record<string, THREE.IUniform>;
    private readonly fog: THREE.FogExp2;
    private readonly envScene = new THREE.Scene();
    private readonly cubeTarget: THREE.WebGLCubeRenderTarget;
    private readonly cubeCamera: THREE.CubeCamera;
    private readonly pmrem: THREE.PMREMGenerator;
    private envTarget: THREE.WebGLRenderTarget | null = null;
    private envDirty = true;
    private lastEnvAt = -1e9;
    private lastEnvElevation = 999;
    private readonly shadowFocus = new THREE.Vector3();

    constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private sun: THREE.DirectionalLight) {
        installCheapSkyLighting();
        this.uniforms = {
            uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uHorizonSun: { value: new THREE.Color() },
            uGround: { value: new THREE.Color() }, uSunColor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
            uGlow: { value: 0.3 }, uSunDisc: { value: 18 }, uStars: { value: 0 }, uIntensity: { value: 1 },
            uClouds: { value: makeCloudTexture() }, uCloudTime: { value: 0 }, uCloudCover: { value: 0.52 },
            uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() },
        };
        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms, vertexShader: skyVertex, fragmentShader: skyFragment,
            side: THREE.BackSide, depthWrite: false, fog: false,
        });
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        this.sky = new THREE.Mesh(geometry, material);
        this.sky.scale.setScalar(100000);
        this.sky.frustumCulled = false;
        this.sky.renderOrder = 1e6; // drawn after all opaque scenery so only open sky is shaded
        this.sky.userData.dynamic = true; // never merged by the static batcher
        scene.add(this.sky);
        scene.background = null;
        this.fog = new THREE.FogExp2(0xa6c4e4, 0.00034);
        scene.fog = this.fog;

        // Sky light / reflections for High graphics
        this.envScene.add(new THREE.Mesh(geometry, material));
        this.cubeTarget = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false });
        this.cubeCamera = new THREE.CubeCamera(0.5, 10, this.cubeTarget);
        this.pmrem = new THREE.PMREMGenerator(renderer);
        this.pmrem.compileCubemapShader();

        scene.add(sun.target);
        sun.shadow.camera.near = 10;
        sun.shadow.camera.far = 900;
        sun.shadow.normalBias = 0.04;
        sun.shadow.bias = -0.0004;
        this.setShadowRadius(90);
    }

    /** Sky, sun, sky light, fog and exposure for game time t (hours). */
    setTime(t: number) {
        const el = sunElevationAt(t);
        const az = sunAzimuthAt(t);
        this.elevation = el;
        this.uniforms.uCloudTime.value = t * 60; // drift with the game clock
        const elR = THREE.MathUtils.degToRad(Math.max(el, -6)); // keep the glow just under the horizon at dusk
        this.sunDir.set(Math.cos(elR) * Math.sin(az), Math.sin(elR), Math.cos(elR) * Math.cos(az)).normalize();

        let i = 0;
        while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++;
        const a = KEYS[i], b = KEYS[i + 1];
        const f = THREE.MathUtils.clamp((el - a.el) / (b.el - a.el), 0, 1);
        const u = this.uniforms;
        mixKeyColor(a, b, f, 'zenith', u.uZenith.value);
        mixKeyColor(a, b, f, 'horizon', u.uHorizon.value);
        mixKeyColor(a, b, f, 'horizonSun', u.uHorizonSun.value);
        mixKeyColor(a, b, f, 'ground', u.uGround.value);
        mixKeyColor(a, b, f, 'sun', u.uSunColor.value);
        u.uSunDir.value.copy(this.sunDir);
        u.uGlow.value = THREE.MathUtils.lerp(a.glow, b.glow, f);
        u.uStars.value = THREE.MathUtils.lerp(a.stars, b.stars, f);
        u.uSunDisc.value = el > -1 ? 18 : 0;
        this.renderer.toneMappingExposure = THREE.MathUtils.lerp(a.exposure, b.exposure, f);

        // Direct light: the sun by day, a faint blue moon by night (from high in the opposite sky)
        const sunI = THREE.MathUtils.lerp(a.sunI, b.sunI, f);
        this.nightFactor = THREE.MathUtils.smoothstep(-el, -2, 7); // 0 above 2°, 1 below −7°
        if (sunI > 0.05) {
            this.sun.color.copy(u.uSunColor.value);
            this.sun.intensity = sunI;
            this.sunLightDir.copy(this.sunDir);
        } else {
            this.sun.color.copy(MOON_COLOR);
            this.sun.intensity = MOON_INTENSITY * this.nightFactor;
            this.sunLightDir.set(-Math.sin(az) * 0.5, 0.8, -Math.cos(az) * 0.5).normalize();
        }

        // Clouds: lit by the sun and sky by day, warm at sunset, dim grey-blue at night
        const lit = u.uCloudLit.value as THREE.Color, shade = u.uCloudShade.value as THREE.Color;
        const sunCol = u.uSunColor.value as THREE.Color;
        const dayLight = THREE.MathUtils.clamp(sunI / 3, 0, 1);
        lit.copy(u.uZenith.value).multiplyScalar(0.55).lerp(tmpB.copy(sunCol).multiplyScalar(0.95), 0.25 + 0.55 * dayLight).add(tmpA.copy(u.uHorizonSun.value).multiplyScalar(0.25));
        shade.copy(u.uZenith.value).multiplyScalar(0.5).add(tmpA.copy(u.uHorizon.value).multiplyScalar(0.45));
        if (dayLight < 0.05) { lit.multiplyScalar(0.6); shade.multiplyScalar(0.6); }

        // Low graphics sky light (shared uniforms) and the fog: the average horizon colour
        const zen = u.uZenith.value as THREE.Color, hor = u.uHorizon.value as THREE.Color, horSun = u.uHorizonSun.value as THREE.Color;
        const k = SKY_LIGHT_BOOST;
        Object.assign(lowSkyZenith, { r: zen.r * k, g: zen.g * k, b: zen.b * k });
        tmpA.copy(hor).lerp(horSun, 0.3);
        this.fog.color.copy(tmpA);
        Object.assign(lowSkyHorizon, { r: tmpA.r * k, g: tmpA.g * k, b: tmpA.b * k });
        const gr = u.uGround.value as THREE.Color;
        Object.assign(lowSkyGround, { r: gr.r * k, g: gr.g * k, b: gr.b * k });

        if (Math.abs(el - this.lastEnvElevation) > 0.4) this.envDirty = true;
    }
    private readonly sunLightDir = new THREE.Vector3(0, 1, 0);

    /** Keep the sun's shadow box centred on what the camera follows (High graphics). */
    followShadow(focus: THREE.Vector3) {
        // Snap to the shadow map's texel size so shadows don't shimmer as you move
        const cam = this.sun.shadow.camera;
        const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.width;
        this.shadowFocus.set(Math.round(focus.x / texel) * texel, 0, Math.round(focus.z / texel) * texel);
        this.sun.target.position.copy(this.shadowFocus);
        this.sun.position.copy(this.shadowFocus).addScaledVector(this.sunLightDir, 450);
        this.sun.target.updateMatrixWorld();
    }

    setShadowRadius(r: number) {
        const cam = this.sun.shadow.camera;
        cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
        cam.updateProjectionMatrix();
    }

    /** High graphics: refresh the sky light / reflection map when the sun has moved. */
    updateEnvironment(high: boolean) {
        if (!high) { if (this.scene.environment) this.scene.environment = null; return; }
        const now = performance.now();
        if (this.envTarget && (!this.envDirty || now - this.lastEnvAt < 1000)) {
            if (this.scene.environment !== this.envTarget.texture) this.scene.environment = this.envTarget.texture;
            return;
        }
        this.uniforms.uIntensity.value = SKY_LIGHT_BOOST;
        this.cubeCamera.update(this.renderer, this.envScene);
        this.uniforms.uIntensity.value = 1;
        this.envTarget = this.pmrem.fromCubemap(this.cubeTarget.texture, this.envTarget);
        this.scene.environment = this.envTarget.texture;
        this.envDirty = false;
        this.lastEnvAt = now;
        this.lastEnvElevation = this.elevation;
    }

    dispose() {
        this.scene.remove(this.sky);
        this.sky.geometry.dispose();
        (this.sky.material as THREE.Material).dispose();
        (this.uniforms.uClouds.value as THREE.Texture).dispose();
        this.cubeTarget.dispose();
        this.envTarget?.dispose();
        this.pmrem.dispose();
        if (this.scene.fog === this.fog) this.scene.fog = null;
    }
}
