import * as THREE from 'three';
import type { Culled, CullView, PerFrame } from './cells';

// Street and lot lamps light the scene in the standard shader itself: a diffuse-only
// (Lambert) term for the few lamps nearest the camera, with a smooth, windowed distance
// falloff. No specular, no shadow maps. It lights everything the same way (ground, cars,
// people), so things standing in a pool of light are lit too, instead of a glowing quad
// painted over the ground. The lamps are picked on the CPU a few times a second.
//
// The uniforms are shared by every standard / physical material (like atmosphere.ts's
// low-sky uniforms): typed arrays are passed by reference when three.js copies a shader's
// uniforms. By day the first lamp's strength is 0 and the loop stops at once; nothing
// changes the shader's defines, so dusk causes no recompile.

export const MAX_LAMPS = 8;
/** Per lamp: position in the camera's view space (xyz; updated every render) and reach (w). */
const lampPos = new Float32Array(MAX_LAMPS * 4);
/** Per lamp: linear colour times strength (rgb) and strength (w; 0 ends the list). */
const lampCol = new Float32Array(MAX_LAMPS * 4);

let installed = false;
export const installLampLighting = () => {
    if (installed) return;
    installed = true;
    for (const lib of [THREE.ShaderLib.standard, THREE.ShaderLib.physical]) {
        lib.uniforms.lampPos = { value: lampPos };
        lib.uniforms.lampCol = { value: lampCol };
    }
    THREE.ShaderChunk.lights_physical_pars_fragment += /* glsl */`
uniform vec4 lampPos[ ${MAX_LAMPS} ];
uniform vec4 lampCol[ ${MAX_LAMPS} ];
`;
    THREE.ShaderChunk.lights_fragment_maps += /* glsl */`
#ifdef STANDARD
	for ( int i = 0; i < ${MAX_LAMPS}; i ++ ) {
		if ( lampCol[ i ].w <= 0.0 ) break; // (by day: none)
		vec3 toLamp = lampPos[ i ].xyz - geometryPosition;
		float d2 = dot( toLamp, toLamp );
		float w = clamp( 1.0 - d2 / ( lampPos[ i ].w * lampPos[ i ].w ), 0.0, 1.0 );
		float lambert = max( dot( geometryNormal, toLamp * inversesqrt( d2 ) ), 0.0 );
		reflectedLight.directDiffuse += lampCol[ i ].rgb * ( w * w * lambert ) * BRDF_Lambert( material.diffuseColor );
	}
#endif
`;
};

type Lamp = { pos: THREE.Vector3; reach: number; color: THREE.Color; strength: number };

/** The town's lamps; picks the nearest few to the camera for the shader. */
export class LampLighting implements Culled, PerFrame {
    private lamps: Lamp[] = [];
    private night = 0;
    private picked: { lamp: Lamp; fade: number }[] = [];
    private written: Lamp[] = [];
    private limit = MAX_LAMPS;
    private readonly v = new THREE.Vector3();

    constructor() { installLampLighting(); }

    /** A lamp whose light centre is at (x, y, z), lighting the ground out to about `reach`. */
    add(x: number, y: number, z: number, color: string, strength: number, reach: number) {
        this.lamps.push({ pos: new THREE.Vector3(x, y, z), reach, color: new THREE.Color(color), strength });
    }

    setNight(f: number) { this.night = f; this.write(); }

    /** How many lamps light the scene (Low 4, High 8). Only the uniform data changes: no recompile. */
    setLimit(n: number) { this.limit = Math.max(0, Math.min(MAX_LAMPS, n)); this.write(); }

    cull(view: CullView) {
        const cam = view.camPos;
        const byDist = this.lamps.map(l => ({ l, d: l.pos.distanceToSquared(cam) })).sort((a, b) => a.d - b.d);
        // fade the furthest picks out toward the next lamp's distance, so swapping one in or out doesn't pop
        const n = this.limit;
        const edge = byDist.length > n ? Math.sqrt(byDist[n].d) : Infinity;
        this.picked = byDist.slice(0, n).map(({ l, d }) => {
            const dist = Math.sqrt(d);
            return { lamp: l, fade: edge === Infinity ? 1 : 1 - THREE.MathUtils.smoothstep(dist, edge * 0.8, edge) };
        });
        this.write();
    }

    private write() {
        lampCol.fill(0);
        this.written = [];
        if (this.night <= 0.01) return;
        let n = 0;
        for (const { lamp, fade } of this.picked) {
            const s = lamp.strength * this.night * fade;
            if (s <= 0.001) continue;
            lampPos[n * 4 + 3] = lamp.reach;
            lampCol.set([lamp.color.r * s, lamp.color.g * s, lamp.color.b * s, s], n * 4);
            this.written.push(lamp);
            n++;
        }
    }

    /** Before every render: the lamps' positions in this camera's view space. */
    frame(camera: THREE.Camera) {
        this.written.forEach((lamp, i) => {
            this.v.copy(lamp.pos).applyMatrix4(camera.matrixWorldInverse);
            lampPos[i * 4] = this.v.x; lampPos[i * 4 + 1] = this.v.y; lampPos[i * 4 + 2] = this.v.z;
        });
    }
}
