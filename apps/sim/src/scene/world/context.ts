import * as THREE from 'three';
import { generateAsphaltTexture, generateChainLinkTexture, generateConcreteTexture } from '../textures';

// Everything the world builders (city, speedway, dealerships, fences) share:
// the scene, the lists the component cleans up on unmount, collision boxes,
// and a few textures/materials reused across buildings.
export type WorldContext = {
    scene: THREE.Scene;
    /** Objects disposed when the 3D view unmounts. */
    environmentDisposables: THREE.Object3D[];
    /** Solid walls the player and driven cars collide with. */
    staticCollisionBoxes: THREE.Box3[];
    /** Materials / textures disposed on unmount. */
    cityMaterials: THREE.Material[];
    cityTextures: THREE.Texture[];
    /** Skyscraper window materials whose glow the day/night cycle changes. */
    emissiveFacadeMaterials: THREE.MeshStandardMaterial[];
    concreteTex: THREE.Texture;
    asphaltTex: THREE.Texture;
    fencePostMat: THREE.MeshStandardMaterial;
    fenceWireMat: THREE.MeshStandardMaterial;
    /** A fence panel whose UVs tile the wire diamonds at a constant real-world size. */
    wirePanelGeo: (width: number, height: number) => THREE.PlaneGeometry;
    /** Plain see-through glass (tracked for disposal). */
    makeGlass: (color: string, opacity?: number, side?: THREE.Side) => THREE.MeshStandardMaterial;
    /** Registers a lamp/interior light with the shared light pool. */
    addLightSource: (x: number, y: number, z: number, color: string, intensity: number, distance: number, nightOnly: boolean) => void;
};

export function createWorldContext(scene: THREE.Scene, addLightSource: WorldContext['addLightSource']): WorldContext {
    const cityMaterials: THREE.Material[] = [];
    const cityTextures: THREE.Texture[] = [];

    const concreteTex = generateConcreteTexture();
    const asphaltTex = generateAsphaltTexture();
    cityTextures.push(concreteTex, asphaltTex);

    // Plain see-through glass. (MeshPhysicalMaterial "transmission" glass makes
    // the renderer draw the whole scene an extra time every frame it's on screen.)
    const makeGlass = (color: string, opacity = 0.35, side: THREE.Side = THREE.FrontSide) => {
        const m = new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.05, metalness: 0.3, depthWrite: false, side });
        cityMaterials.push(m);
        return m;
    };

    const chainLinkBaseTex = generateChainLinkTexture();
    cityTextures.push(chainLinkBaseTex);

    // Shared galvanized steel material for posts, rails and caps
    const fencePostMat = new THREE.MeshStandardMaterial({ color: '#aab0b6', metalness: 0.9, roughness: 0.35 });
    cityMaterials.push(fencePostMat);

    // One woven-wire material for every fence run and gate. Each panel tiles the
    // diamonds by scaling its own UVs (instead of cloning the texture per run),
    // so all fence panels share a material and can be merged into one draw.
    const fenceWireMat = new THREE.MeshStandardMaterial({
        map: chainLinkBaseTex,
        alphaMap: chainLinkBaseTex,
        transparent: true,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
        color: '#c4c9ce',
        metalness: 0.85,
        roughness: 0.45
    });
    cityMaterials.push(fenceWireMat);
    const wirePanelGeo = (width: number, height: number) => {
        const geo = new THREE.PlaneGeometry(width, height);
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        const ru = Math.max(1, Math.round(width / 1.5)), rv = Math.max(1, Math.round(height / 1.5));
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv);
        return geo;
    };

    return {
        scene,
        environmentDisposables: [],
        staticCollisionBoxes: [],
        cityMaterials,
        cityTextures,
        emissiveFacadeMaterials: [],
        concreteTex,
        asphaltTex,
        fencePostMat,
        fenceWireMat,
        wirePanelGeo,
        makeGlass,
        addLightSource,
    };
}
