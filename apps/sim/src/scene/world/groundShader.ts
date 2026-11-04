import * as THREE from 'three';

// Ground surfaces (grass, asphalt, concrete, road paint) are ordinary MeshStandardMaterials
// with one small shader addition, shared by all of them (one shader program):
//  - `map` is read either with the mesh's UVs or, when mapScale > 0, in world space
//    (x/z in metres times mapScale), so a texture keeps its real-world size on any mesh;
//  - a fine "detail" texture (asphalt aggregate) is multiplied in, in world space; the
//    map's alpha says how strongly (e.g. less on the sealed lot than on the worn road);
//  - a large-scale noise texture tints the colour between two multipliers and blends in a
//    "dirt" colour where its blue channel is high, so big surfaces never look like one flat
//    colour or show their tiling.
// World-space mapping needs no UVs, so the static batcher can merge these meshes freely.

export type GroundLook = {
    /** > 0: sample `map` in world space at this many repeats per metre; 0: use the mesh UVs. */
    mapScale: number;
    detail: THREE.Texture;
    detailScale: number;
    detailStrength: number;
    macro: THREE.Texture;
    macroScale: number;
    /** Colour multipliers at the two ends of the large-scale noise (red channel). */
    macroLo: THREE.ColorRepresentation;
    macroHi: THREE.ColorRepresentation;
    /** Blended in where the noise's blue channel is between dirtFrom and dirtTo. */
    dirtColor?: THREE.ColorRepresentation;
    dirtAmount?: number;
    dirtFrom?: number;
    dirtTo?: number;
};

const vertexDecl = /* glsl */`
#include <common>
varying vec2 vGroundXZ;`;
const vertexMain = /* glsl */`
#include <project_vertex>
#ifdef USE_INSTANCING
	vGroundXZ = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xz;
#else
	vGroundXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;
#endif`;
const fragmentDecl = /* glsl */`
#include <common>
varying vec2 vGroundXZ;
uniform float gMapScale;
uniform sampler2D gDetailMap;
uniform float gDetailScale;
uniform float gDetailStrength;
uniform sampler2D gMacroMap;
uniform float gMacroScale;
uniform vec3 gMacroLo;
uniform vec3 gMacroHi;
uniform vec3 gDirtColor;
uniform float gDirtAmount;
uniform vec2 gDirtRange;`;
const fragmentMap = /* glsl */`
#ifdef USE_MAP
	vec2 gUv = gMapScale > 0.0 ? vGroundXZ * gMapScale : vMapUv;
	vec4 sampledDiffuseColor = texture2D( map, gUv );
	diffuseColor.rgb *= sampledDiffuseColor.rgb;
#ifndef GROUND_LOW
	float gDetail = texture2D( gDetailMap, vGroundXZ * gDetailScale ).g * 2.0;
	diffuseColor.rgb *= mix( 1.0, gDetail, gDetailStrength * sampledDiffuseColor.a );
#endif
	vec3 gMacro = texture2D( gMacroMap, vGroundXZ * gMacroScale ).rgb;
	diffuseColor.rgb *= mix( gMacroLo, gMacroHi, gMacro.r );
	diffuseColor.rgb = mix( diffuseColor.rgb, gDirtColor, smoothstep( gDirtRange.x, gDirtRange.y, gMacro.b ) * gDirtAmount );
#endif`;

// Low graphics skips the fine detail texture (GROUND_LOW): one of the three texture reads
// per ground pixel, and the one that tiles finest. The large-scale noise stays, so big
// lawns still don't show their tiling.
const groundMaterials = new Set<THREE.MeshStandardMaterial>();
let lowQuality = false;
/** Switch every ground material between the full look and Low's single texture read. */
export function setGroundLowQuality(low: boolean) {
    if (low === lowQuality) return;
    lowQuality = low;
    for (const m of groundMaterials) applyQuality(m);
}
function applyQuality(m: THREE.MeshStandardMaterial) {
    if (lowQuality) m.defines = { ...m.defines, GROUND_LOW: '' };
    else if (m.defines) delete m.defines.GROUND_LOW;
    m.needsUpdate = true;
}

// Low also skips the sun's highlight on the ground (the GGX term) and the multiple-
// scattering part of the sky reflection. The ground is rough (roughness 0.6-0.96), so the
// highlight is faint on it. The sky's reflection itself stays (a cheap approximation):
// without it dark asphalt looked clearly darker. The street lamps still light it.
const lowLighting = /* glsl */`
#include <lights_physical_pars_fragment>
#ifdef GROUND_LOW
void RE_Direct_GroundLow( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	reflectedLight.directDiffuse += dotNL * directLight.color * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_GroundLow( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += material.diffuseColor * irradiance * RECIPROCAL_PI;
	reflectedLight.indirectSpecular += radiance * EnvironmentBRDF( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness );
}
#undef RE_Direct
#define RE_Direct RE_Direct_GroundLow
#undef RE_IndirectSpecular
#define RE_IndirectSpecular RE_IndirectSpecular_GroundLow
#endif`;

/** A MeshStandardMaterial with the ground look (see above). Needs a `map`. */
export function makeGroundMaterial(params: THREE.MeshStandardMaterialParameters, look: GroundLook) {
    const material = new THREE.MeshStandardMaterial(params);
    const uniforms = {
        gMapScale: { value: look.mapScale },
        gDetailMap: { value: look.detail },
        gDetailScale: { value: look.detailScale },
        gDetailStrength: { value: look.detailStrength },
        gMacroMap: { value: look.macro },
        gMacroScale: { value: look.macroScale },
        gMacroLo: { value: new THREE.Color(look.macroLo) },
        gMacroHi: { value: new THREE.Color(look.macroHi) },
        gDirtColor: { value: new THREE.Color(look.dirtColor ?? '#000000') },
        gDirtAmount: { value: look.dirtAmount ?? 0 },
        gDirtRange: { value: new THREE.Vector2(look.dirtFrom ?? 0.6, look.dirtTo ?? 0.8) },
    };
    material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', vertexDecl)
            .replace('#include <project_vertex>', vertexMain);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', fragmentDecl)
            .replace('#include <map_fragment>', fragmentMap)
            .replace('#include <lights_physical_pars_fragment>', lowLighting);
    };
    // Same code for every ground material, so they all share one compiled program
    material.customProgramCacheKey = () => lowQuality ? 'cds-ground-v1-low' : 'cds-ground-v1';
    groundMaterials.add(material);
    applyQuality(material);
    material.addEventListener('dispose', () => groundMaterials.delete(material));
    return material;
}
