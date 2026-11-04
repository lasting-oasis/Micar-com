import * as THREE from 'three';
import {
    generateAggregateTexture, generateChainLinkTexture, generateConcreteTexture, generateGrassTexture, generateMacroTexture,
    generatePaintPaletteTexture, generateRoadAtlasTexture, generateSlabTexture, generateVegetationTexture, lazyTexture, ROAD_ATLAS_BASE, SLAB_REPEAT,
} from '../textures';
import { createArchitectureKit, type ArchitectureKit } from './architecture';
import { CullingDriver, PackedMesh } from './cells';
import { makeGroundMaterial } from './groundShader';
import { createPropsKit, type PropsKit } from './streetProps';
import { createVegetationKit, type VegetationKit } from './vegetation';

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
    fencePostMat: THREE.MeshStandardMaterial;
    fenceWireMat: THREE.MeshStandardMaterial;
    /** A fence panel whose UVs tile the wire diamonds at a constant real-world size. */
    wirePanelGeo: (width: number, height: number) => THREE.PlaneGeometry;
    /** Plain see-through glass (tracked for disposal). */
    makeGlass: (color: string, opacity?: number, side?: THREE.Side) => THREE.MeshStandardMaterial;
    /** Registers a lamp/interior light with the shared light pool. */
    addLightSource: (x: number, y: number, z: number, color: string, intensity: number, distance: number, nightOnly: boolean) => void;
    /** Shared windows / doors / trim (one material per look, merged by the batcher). */
    arch: ArchitectureKit;
    /**
     * The ground (one material per surface for the whole world; see groundShader.ts).
     * grass: the world floor only (kept apart so it stays one flat layer, drawn last).
     * lawn: the same grass on raised lawns and slopes. asphalt: roads (UVs = road atlas cross-section),
     * junctions and lots (UVs into the atlas's clean / sealed columns). concrete: sidewalks,
     * curbs, gutters, wheel stops. paint: all road and lot markings (u picks the colour).
     */
    ground: { grass: THREE.MeshStandardMaterial; lawn: THREE.MeshStandardMaterial; asphalt: THREE.MeshStandardMaterial; concrete: THREE.MeshStandardMaterial; paint: THREE.MeshStandardMaterial };
    /**
     * The town's ground layers in those materials, one mesh each, drawn only where in view
     * (see cells.ts). Add geometry near (x, z) with `layers.asphalt.at(x, z)` etc., before
     * the first frame. (Dealership lots, built later, make meshes of their own.)
     */
    layers: { asphalt: PackedMesh; concrete: PackedMesh; paint: PackedMesh; lawn: PackedMesh };
    /** Runs the per-cell culling of the packed layers, plants and props. */
    culling: CullingDriver;
    /** Trees, bushes and hedges for the whole world (instanced, culled by cell). */
    plants: VegetationKit;
    /** Street and lot lights and street furniture (with night glow and light pools). */
    props: PropsKit;
    /** 0 = day, 1 = night: lamp glow, light pools. Call whenever the time of day changes. */
    setNight: (nightFactor: number) => void;
};

/** A linear colour from an sRGB hex, times k (for colours that a texture's average scales down). */
const scaledColor = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const linear = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b);

export function createWorldContext(scene: THREE.Scene, addLightSource: WorldContext['addLightSource']): WorldContext {
    const cityMaterials: THREE.Material[] = [];
    const cityTextures: THREE.Texture[] = [];
    const environmentDisposables: THREE.Object3D[] = [];

    const concreteTex = generateConcreteTexture();
    cityTextures.push(concreteTex);

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
    // so all fence panels share one material and texture. The wire is transparent,
    // and the batcher only merges transparent meshes within one root object, so
    // each fence run's panel is still a draw call of its own.
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

    // Created before the batcher's keep-unique set is built, so the lit-window
    // glass (whose glow the day/night cycle changes) is never swapped out.
    const emissiveFacadeMaterials: THREE.MeshStandardMaterial[] = [];
    const arch = createArchitectureKit(cityMaterials, cityTextures, emissiveFacadeMaterials);

    // --- Ground surfaces: realistic albedos (lighting is physically based) ---
    // (generated just after the first frame, one per task: see lazyTexture)
    const lazy = [
        lazyTexture(generateAggregateTexture, { size: 256, canvas: false, srgb: false, rgba: [128, 128, 128, 255] }),
        lazyTexture(generateMacroTexture, { size: 128, canvas: false, srgb: false, rgba: [128, 128, 128, 255] }),
        lazyTexture(generateGrassTexture, { size: 256, canvas: true, srgb: true, rgba: [70, 96, 40, 255] }),
        lazyTexture(generateSlabTexture, { size: 256, canvas: false, srgb: true, rgba: [150, 148, 142, 255] }),
        lazyTexture(generateRoadAtlasTexture, { size: 256, canvas: false, srgb: true, rgba: [170, 170, 170, 200] }),
        lazyTexture(generateVegetationTexture, { size: 256, canvas: true, srgb: true, rgba: [56, 80, 36, 255] }),
    ];
    const [aggregate, macro, grassTex, slabTex, roadTex, vegTex] = lazy.map(l => l.tex);
    lazy[4].tex.wrapS = THREE.ClampToEdgeWrapping; // (the road atlas: columns side by side)
    lazy[2].tex.anisotropy = 4; lazy[5].tex.anisotropy = 2;
    const paintTex = generatePaintPaletteTexture();
    cityTextures.push(aggregate, macro, grassTex, slabTex, roadTex, paintTex, vegTex);

    // Grass: 4.5 m texture repeat, 37 m patchiness, and over hundreds of metres drifting
    // between lush and dry grass with the odd worn, earthy stretch.
    const grassLook = {
        mapScale: 1 / 4.5, detail: macro, detailScale: 1 / 37, detailStrength: 0.2,
        macro, macroScale: 1 / 310, macroLo: linear(0.8, 0.93, 0.8), macroHi: linear(1.18, 1.08, 0.8),
        dirtColor: '#6e5f45', dirtAmount: 0.3, dirtFrom: 0.7, dirtTo: 0.95,
    };
    const ground = {
        // The floor is pushed back in depth so paving and paint lying on it always win.
        grass: makeGroundMaterial({ map: grassTex, roughness: 0.96, metalness: 0, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }, grassLook),
        lawn: makeGroundMaterial({ map: grassTex, roughness: 0.96, metalness: 0 }, grassLook),
        // Asphalt ~#5d5a57 (slightly warm: a neutral grey reads lavender under the blue sky
        // light); the road atlas darkens it where it's worn.
        asphalt: makeGroundMaterial({ color: scaledColor('#5d5a57', 1 / ROAD_ATLAS_BASE), map: roadTex, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }, {
            mapScale: 0, detail: aggregate, detailScale: 1 / 3.2, detailStrength: 0.75,
            macro, macroScale: 1 / 90, macroLo: linear(0.9, 0.9, 0.9), macroHi: linear(1.08, 1.08, 1.07),
            dirtColor: '#2e2e30', dirtAmount: 0.18, dirtFrom: 0.78, dirtTo: 0.98,
        }),
        // Concrete ~#9c9a94 (in the slab texture): 1.5 m slabs with joints
        concrete: makeGroundMaterial({ map: slabTex, roughness: 0.85, metalness: 0 }, {
            mapScale: 1 / SLAB_REPEAT, detail: aggregate, detailScale: 1 / 1.5, detailStrength: 0.22,
            macro, macroScale: 1 / 55, macroLo: linear(0.92, 0.92, 0.91), macroHi: linear(1.04, 1.03, 1.0),
            dirtColor: '#787267', dirtAmount: 0.18, dirtFrom: 0.72, dirtTo: 0.95,
        }),
        // Road paint: off-white / traffic yellow / cast iron, a little worn and dirty
        paint: makeGroundMaterial({ map: paintTex, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }, {
            mapScale: 0, detail: aggregate, detailScale: 1 / 3.2, detailStrength: 0.4,
            macro, macroScale: 1 / 45, macroLo: linear(0.84, 0.84, 0.83), macroHi: linear(1.0, 1.0, 1.0),
        }),
    };
    cityMaterials.push(ground.grass, ground.lawn, ground.asphalt, ground.concrete, ground.paint);

    const culling = new CullingDriver(scene);
    // Fill in the ground textures once the game is up and drawing (from the 15th frame,
    // one per task)
    {
        let frames = 0, i = 0;
        const next = () => { if (i < lazy.length) { lazy[i++].fill(); setTimeout(next, 60); } };
        culling.perFrame.push({ frame: () => { if (++frames === 15) setTimeout(next, 0); } });
    }
    const packed = (name: string, material: THREE.Material, castShadow = false) => {
        const p = new PackedMesh(material, { castShadow, receiveShadow: true, flatGround: true });
        p.mesh.name = `ground:${name}`;
        scene.add(p.mesh); environmentDisposables.push(p.mesh);
        culling.register(p);
        return p;
    };
    // (The paving hardly rises above the ground: none of it casts a shadow.)
    const layers = { asphalt: packed('asphalt', ground.asphalt), concrete: packed('concrete', ground.concrete), paint: packed('paint', ground.paint), lawn: packed('lawn', ground.lawn) };

    const plants = createVegetationKit(scene, culling, environmentDisposables, cityMaterials, vegTex);
    const props = createPropsKit(scene, culling, environmentDisposables, cityMaterials, cityTextures, addLightSource);

    return {
        scene,
        environmentDisposables,
        staticCollisionBoxes: [],
        cityMaterials,
        cityTextures,
        emissiveFacadeMaterials,
        concreteTex,
        fencePostMat,
        fenceWireMat,
        wirePanelGeo,
        makeGlass,
        addLightSource,
        arch,
        ground,
        layers,
        culling,
        plants,
        props,
        setNight: props.setNight,
    };
}
