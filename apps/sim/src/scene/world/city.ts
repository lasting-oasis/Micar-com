import * as THREE from 'three';
import type { WorldContext } from './context';
import type { FurnitureKit } from './furniture';
import { createBuildingSign } from '../textures';
import { boxUVsWorld, type Face } from './architecture';

// The town: ground, roads, trees, districts, bank, auction house, library,
// insurance office and gas stations. Returns the spots the game loop needs.
// Seeded random numbers (mulberry32) so trees and lit office windows land in the same
// places for every player and on every reload.
const seededRandom = (seed: number) => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function buildCity(ctx: WorldContext, furniture: FurnitureKit) {
    const random = seededRandom(20261027);
    const { scene, environmentDisposables, staticCollisionBoxes, cityMaterials, cityTextures, emissiveFacadeMaterials, concreteTex, makeGlass, addLightSource, arch } = ctx;
    const { makeSofa, makePlant, makePainting, makeCoffeeTable } = furniture;

    // Streetlights (no shadows: a shadow-casting point light re-renders the
    // whole scene six times per frame, even while switched off)
    const createStreetLight = (x: number, z: number) => {
         const poleGeo = new THREE.CylinderGeometry(0.2, 0.2, 10);
         const poleMat = new THREE.MeshStandardMaterial({ color: '#52525b', roughness: 0.8 });
         const pole = new THREE.Mesh(poleGeo, poleMat);
         pole.position.set(x, 5, z);
         scene.add(pole);
         environmentDisposables.push(pole);
         addLightSource(x, 9.5, z, '#fef08a', 1.5, 50, true);
    };
    createStreetLight(-15, 15);
    createStreetLight(15, 15);
    createStreetLight(-15, -15);
    createStreetLight(15, -15);

    // Grassy Floor (huge 10000x10000 open world so the giant speedway has ground under it).
    // Split into 125-unit tiles: as two giant triangles, its depth values were too
    // imprecise near the camera and the grass was drawn over the lot paving, lane
    // lines and track that sit a few centimetres above it. The polygon offset also
    // pushes the grass slightly "behind" anything lying on it.
    const floorGeo = new THREE.PlaneGeometry(10000, 10000, 80, 80);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
        color: '#14532d', // Emerald-900 grassy green
        roughness: 0.95,
        metalness: 0.1,
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 2
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = 0;
    floor.receiveShadow = true;
    scene.add(floor);
    environmentDisposables.push(floor);

    // Suburbs Outbound Road Networks (Massive expansion)
    const roadGeo = new THREE.BoxGeometry(25, 0.5, 840); // Main strip — starts north of the lot so it never runs through the dealership
    const roadMat = new THREE.MeshStandardMaterial({ color: '#191a1d', roughness: 0.95 }); // near-black asphalt, clearly darker than the grey lot paving

    const roadMain = new THREE.Mesh(roadGeo, roadMat);
    roadMain.position.set(0, 0.02, 620);
    roadMain.receiveShadow = true;
    scene.add(roadMain);
    environmentDisposables.push(roadMain);

    const dividerGeo = new THREE.BoxGeometry(0.5, 0.6, 840);
    const dividerMat = new THREE.MeshStandardMaterial({ color: '#fbbf24' });
    const dividerMain = new THREE.Mesh(dividerGeo, dividerMat);
    dividerMain.position.set(0, 0.03, 620);
    scene.add(dividerMain);
    environmentDisposables.push(dividerMain);

    // Cross street at Z=200
    const roadCross1 = new THREE.Mesh(new THREE.BoxGeometry(1000, 0.5, 25), roadMat);
    roadCross1.position.set(0, 0.02, 200);
    roadCross1.receiveShadow = true;
    scene.add(roadCross1);
    environmentDisposables.push(roadCross1);

    const dividerCross1 = new THREE.Mesh(new THREE.BoxGeometry(1000, 0.6, 0.5), dividerMat);
    dividerCross1.position.set(0, 0.03, 200);
    scene.add(dividerCross1);
    environmentDisposables.push(dividerCross1);
    
    // Cross street at Z=500
    const roadCross2 = new THREE.Mesh(new THREE.BoxGeometry(1000, 0.5, 25), roadMat);
    roadCross2.position.set(0, 0.02, 500);
    roadCross2.receiveShadow = true;
    scene.add(roadCross2);
    environmentDisposables.push(roadCross2);

    const dividerCross2 = new THREE.Mesh(new THREE.BoxGeometry(1000, 0.6, 0.5), dividerMat);
    dividerCross2.position.set(0, 0.03, 500);
    scene.add(dividerCross2);
    environmentDisposables.push(dividerCross2);

    // --- Procedural Generation 3D Assets ---
    // 1. Organic Trees
    const treeTrunkGeo = new THREE.CylinderGeometry(0.8, 1, 4, 8);
    const treeTrunkMat = new THREE.MeshStandardMaterial({ color: '#5c4033', roughness: 0.9 });
    const treeLeavesGeo = new THREE.ConeGeometry(3, 8, 8);
    const treeLeavesMat = new THREE.MeshStandardMaterial({ color: '#15803d', roughness: 0.9, flatShading: true });

    const numTrees = 80 + 40; // roadside trees + the pocket parks
    const trunkInstanced = new THREE.InstancedMesh(treeTrunkGeo, treeTrunkMat, numTrees);
    trunkInstanced.castShadow = true;
    scene.add(trunkInstanced);
    environmentDisposables.push(trunkInstanced);

    const leavesInstanced = new THREE.InstancedMesh(treeLeavesGeo, treeLeavesMat, numTrees);
    leavesInstanced.castShadow = true;
    scene.add(leavesInstanced);
    environmentDisposables.push(leavesInstanced);

    let treeIndex = 0;
    const placeTree = (x: number, z: number) => {
         if (treeIndex >= numTrees) return;
         const s = 0.8 + random() * 0.6; // Organic scale variation
         const rot = random() * Math.PI;

         const dummy = new THREE.Object3D();
         dummy.position.set(x, 0, z);
         dummy.rotation.y = rot;
         dummy.scale.set(s, s, s);
         dummy.updateMatrixWorld(true);

         const trunkMatrix = new THREE.Matrix4();
         const trunkLocal = new THREE.Matrix4().makeTranslation(0, 2, 0);
         trunkMatrix.multiplyMatrices(dummy.matrixWorld, trunkLocal);
         trunkInstanced.setMatrixAt(treeIndex, trunkMatrix);
         
         const leavesMatrix = new THREE.Matrix4();
         const leavesLocal = new THREE.Matrix4().makeTranslation(0, 6, 0);
         leavesMatrix.multiplyMatrices(dummy.matrixWorld, leavesLocal);
         leavesInstanced.setMatrixAt(treeIndex, leavesMatrix);

         treeIndex++;
    };
    

    // Procedural curtain-wall facade for the office towers: per floor a glass
    // band between aluminium mullions over an opaque spandrel panel at the slab.
    // One texture repeat = FACADE_COLS bays x FACADE_ROWS floors; the tower boxes
    // get world-scale UVs (boxUVsWorld) so every tier has the same floor height
    // and the floor lines run on across the setbacks. The emissive map holds
    // only the lit offices, so at night the glass glows and the frame stays dark.
    const FACADE_COLS = 8, FACADE_ROWS = 32, BAY_W = 3.2, FLOOR_H = 3.6;
    const generateFacadeTextures = (baseColorHex: string) => {
         const W = 256, H = 1024, cw = W / FACADE_COLS, ch = H / FACADE_ROWS, span = 9, mull = 2;
         const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
         const colorCanvas = mk(), glowCanvas = mk();
         const g = colorCanvas.getContext('2d')!, e = glowCanvas.getContext('2d')!;
         const base = new THREE.Color(baseColorHex);
         const css = (c: THREE.Color) => `#${c.getHexString()}`;
         const spandrel = css(base.clone().lerp(new THREE.Color('#8b95a3'), 0.35));
         const mullion = css(base.clone().lerp(new THREE.Color('#b8c2ce'), 0.55));
         const glassTop = base.clone().lerp(new THREE.Color('#9db6cf'), 0.65), glassBot = base.clone().lerp(new THREE.Color('#2a3c55'), 0.5);
         g.fillStyle = mullion; g.fillRect(0, 0, W, H);
         e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
         for (let r = 0; r < FACADE_ROWS; r++) {
             const floorLit = 0.1 + random() * 0.6; // some floors busier than others
             for (let c = 0; c < FACADE_COLS; c++) {
                 const x0 = c * cw + mull, y0 = r * ch, gw = cw - mull, gh = ch - span;
                 const k = 0.9 + random() * 0.2;
                 const grad = g.createLinearGradient(0, y0, 0, y0 + gh);
                 grad.addColorStop(0, css(glassTop.clone().multiplyScalar(k))); grad.addColorStop(1, css(glassBot.clone().multiplyScalar(k)));
                 g.fillStyle = grad; g.fillRect(x0, y0, gw, gh);
                 g.fillStyle = spandrel; g.fillRect(x0 - mull, y0 + gh, cw, span);
                 g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x0 - mull, y0 + gh, cw, 1); // slab edge shadow
                 if (random() < floorLit) {
                     const roll = random();
                     e.fillStyle = roll < 0.7 ? '#ffe2a8' : roll < 0.85 ? '#e8f1ff' : '#8a7550';
                     e.fillRect(x0 + 1, y0 + 1, gw - 2, gh - 2);
                 }
             }
         }
         const tex = (c: HTMLCanvasElement) => {
             const t = new THREE.CanvasTexture(c);
             t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
             cityTextures.push(t);
             return t;
         };
         return { map: tex(colorCanvas), emissiveMap: tex(glowCanvas) };
    };

    // Procedural Warehouse Texture Generator
    const generateWarehouseTexture = () => {
         const canvas = document.createElement('canvas');
         canvas.width = 256;
         canvas.height = 256;
         const ctx = canvas.getContext('2d');
         if (!ctx) return new THREE.Texture();
         ctx.fillStyle = '#4b5563'; // Industrial metallic gray
         ctx.fillRect(0, 0, 256, 256);
         
         ctx.strokeStyle = '#1f2937';
         ctx.lineWidth = 4;
         for (let y = 0; y < 256; y += 16) {
             ctx.beginPath();
             ctx.moveTo(0, y);
             ctx.lineTo(256, y);
             ctx.stroke();
         }
         
         const tex = new THREE.CanvasTexture(canvas);
         tex.wrapS = THREE.RepeatWrapping;
         tex.wrapT = THREE.RepeatWrapping;
         cityTextures.push(tex);
         return tex;
    };

    // Sidewalk and Crosswalk Structures
    const sidewalkMat = new THREE.MeshStandardMaterial({ 
        color: '#a1a1aa', 
        roughness: 0.85, 
        map: concreteTex 
    });
    cityMaterials.push(sidewalkMat);

    // Main highway sidewalks
    // Flank the main road only (z=200..1040) so the walk never reaches the lot
    const sidewalkLeft = new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, 840), sidewalkMat);
    sidewalkLeft.position.set(-17.5, 0.05, 620);
    sidewalkLeft.receiveShadow = true;
    scene.add(sidewalkLeft);
    environmentDisposables.push(sidewalkLeft);

    const sidewalkRight = new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, 840), sidewalkMat);
    sidewalkRight.position.set(17.5, 0.05, 620);
    sidewalkRight.receiveShadow = true;
    scene.add(sidewalkRight);
    environmentDisposables.push(sidewalkRight);

    // Sidewalks framing cross streets
    const sidewalkC1A = new THREE.Mesh(new THREE.BoxGeometry(800, 0.2, 10), sidewalkMat);
    sidewalkC1A.position.set(0, 0.05, 217.5);
    sidewalkC1A.receiveShadow = true;
    scene.add(sidewalkC1A);
    environmentDisposables.push(sidewalkC1A);

    const sidewalkC1B = new THREE.Mesh(new THREE.BoxGeometry(800, 0.2, 10), sidewalkMat);
    sidewalkC1B.position.set(0, 0.05, 182.5);
    sidewalkC1B.receiveShadow = true;
    scene.add(sidewalkC1B);
    environmentDisposables.push(sidewalkC1B);

    const sidewalkC2A = new THREE.Mesh(new THREE.BoxGeometry(800, 0.2, 10), sidewalkMat);
    sidewalkC2A.position.set(0, 0.05, 517.5);
    sidewalkC2A.receiveShadow = true;
    scene.add(sidewalkC2A);
    environmentDisposables.push(sidewalkC2A);

    const sidewalkC2B = new THREE.Mesh(new THREE.BoxGeometry(800, 0.2, 10), sidewalkMat);
    sidewalkC2B.position.set(0, 0.05, 482.5);
    sidewalkC2B.receiveShadow = true;
    scene.add(sidewalkC2B);
    environmentDisposables.push(sidewalkC2B);

    // White crosswalk paint stripes
    const createCrosswalk = (zPos: number) => {
         const stripeMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
         const stripeGeo = new THREE.BoxGeometry(1.5, 0.02, 8);
         cityMaterials.push(stripeMat);
         
         for (let xOffset = -10; xOffset <= 10; xOffset += 4) {
             const stripe = new THREE.Mesh(stripeGeo, stripeMat);
             stripe.position.set(xOffset, 0.28, zPos); // just above the road surface (road top is y=0.27)
             scene.add(stripe);
             environmentDisposables.push(stripe);
         }
    };
    createCrosswalk(200);
    createCrosswalk(500);

    // Specialized Procedural Building Model Constructors
    
    // 1. Skyscraper / Office Tower: curtain-wall tiers over a recessed, double-
    // height glass lobby with stone piers, an entrance canopy facing the road.
    const createSkyscraper = (x: number, z: number, w: number, d: number, h: number, baseColorHex: string) => {
         const group = new THREE.Group();
         group.position.set(x, 0, z);

         const { map, emissiveMap } = generateFacadeTextures(baseColorHex);
         const facadeMat = new THREE.MeshStandardMaterial({
             map,
             roughness: 0.25,
             metalness: 0.6,
             emissiveMap,
             emissive: new THREE.Color('#ffffff'),
             emissiveIntensity: 0.15
         });
         emissiveFacadeMaterials.push(facadeMat);
         cityMaterials.push(facadeMat);
         const tier = (tw: number, th: number, td: number, y0: number) => {
             const geo = boxUVsWorld(new THREE.BoxGeometry(tw, th, td), tw, th, td, FACADE_COLS * BAY_W, FACADE_ROWS * FLOOR_H, y0);
             const m = new THREE.Mesh(geo, facadeMat);
             m.position.y = y0 + th / 2;
             m.castShadow = true;
             m.receiveShadow = true;
             group.add(m);
             // Projecting cornice at the top of the tier
             const c = arch.box(group, arch.trimMat, tw + 0.5, 0.7, td + 0.5, 0, y0 + th - 0.35, 0);
             c.receiveShadow = true;
             return m;
         };

         // Ground floor: a recessed glass lobby behind a row of stone piers
         const LOBBY_H = 7, INSET = 0.9;
         const baseH = h * 0.25;
         arch.glassBox(group, arch.litGlassMat, w - 2 * INSET, LOBBY_H, d - 2 * INSET, 0, LOBBY_H / 2, 0, 2.4, LOBBY_H / 2);
         const pier = (px: number, pz: number) => { const p = arch.box(group, arch.trimMat, 0.9, LOBBY_H, 0.9, px, LOBBY_H / 2, pz); p.receiveShadow = true; };
         const piersAlong = (len: number) => { const n = Math.max(2, Math.round(len / 6)); return Array.from({ length: n + 1 }, (_, i) => -len / 2 + 0.45 + (i * (len - 0.9)) / n); };
         piersAlong(w).forEach(px => { pier(px, -d / 2 + 0.45); pier(px, d / 2 - 0.45); });
         // (no pier in front of the entrance, which is in the middle of the road-facing side)
         const entranceSide = x > 0 ? -1 : 1;
         piersAlong(d).slice(1, -1).forEach(pz => [-1, 1].forEach(sx => { if (sx !== entranceSide || Math.abs(pz) > 3) pier(sx * (w / 2 - 0.45), pz); }));
         const band = arch.box(group, arch.trimMat, w + 0.3, 1.0, d + 0.3, 0, LOBBY_H + 0.5, 0); // transfer band over the lobby
         band.receiveShadow = true;

         // Main entrance on the side facing the main road: glass doors, canopy, entry slab
         const face = x > 0 ? '-x' : '+x';
         const s = entranceSide; // outward direction along x
         const lobbyFace = s * (w / 2 - INSET);
         arch.place(group, arch.glassDoors(3.8, 3.1, { transom: 0.9 }), face, lobbyFace, 0, 0);
         arch.box(group, arch.frameMat, 4.6, 0.35, 9, lobbyFace + s * 2.3, 4.9, 0);            // canopy
         arch.box(group, arch.trimMat, 0.18, 0.55, 9.1, lobbyFace + s * 4.6, 4.9, 0);          // canopy fascia
         arch.box(group, arch.trimMat, 4.4, 0.14, 7, lobbyFace + s * 2.2, 0.07, 0);            // entry slab

         // Tier 1 Base (above the lobby), Tier 2 Middle, Tier 3 Penthouse Top
         const baseMesh = tier(w, baseH - LOBBY_H, d, LOBBY_H);
         const midH = h * 0.55;
         const midMesh = tier(w * 0.85, midH, d * 0.85, baseH);
         const topH = h * 0.2;
         tier(w * 0.7, topH, d * 0.7, baseH + midH);

         // HVAC Rooftop Unit Box
         const hvacMat = new THREE.MeshStandardMaterial({ color: '#4b5563', metalness: 0.7, roughness: 0.3 });
         cityMaterials.push(hvacMat);
         const hvacBox = new THREE.Mesh(new THREE.BoxGeometry(w * 0.2, 2, d * 0.2), hvacMat);
         hvacBox.position.set(0, h + 1, 0);
         hvacBox.castShadow = true;
         group.add(hvacBox);
         
         // Antenna Spire
         const antennaGeo = new THREE.CylinderGeometry(0.15, 0.25, 8, 8);
         const antennaMat = new THREE.MeshBasicMaterial({ color: '#f87171' });
         cityMaterials.push(antennaMat);
         const antenna = new THREE.Mesh(antennaGeo, antennaMat);
         antenna.position.set(0, h + 4, 0);
         group.add(antenna);
         
         // Red Warning Light at Spire tip
         const beaconBulb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 6), new THREE.MeshBasicMaterial({ color: '#ef4444' }));
         beaconBulb.position.set(0, h + 8, 0);
         group.add(beaconBulb);
         
         scene.add(group);
         environmentDisposables.push(group);
         group.updateMatrixWorld(true);
         
         // The base box now starts above the lobby: the solid footprint still goes down to the ground.
         const baseBox = new THREE.Box3().setFromObject(baseMesh); baseBox.min.y = 0;
         staticCollisionBoxes.push(baseBox);
         staticCollisionBoxes.push(new THREE.Box3().setFromObject(midMesh));
    };

    // 2. Pocket park: a curbed lawn with crossing paths, benches and trees.
    // All parks share one lawn material; paths, curbs and benches use the shared trim.
    const lawnMat = new THREE.MeshStandardMaterial({ color: '#3f7d34', roughness: 0.95 });
    cityMaterials.push(lawnMat);
    const parkTrees: [number, number][] = [];
    const createPocketPark = (x: number, z: number, w: number, d: number) => {
         const group = new THREE.Group();
         group.position.set(x, 0, z);
         const lawn = arch.box(group, lawnMat, w, 0.12, d, 0, 0.06, 0); lawn.receiveShadow = true;
         // Curb around the lawn
         ([[0, -d / 2, w + 0.4, 0.4], [0, d / 2, w + 0.4, 0.4], [-w / 2, 0, 0.4, d], [w / 2, 0, 0.4, d]] as [number, number, number, number][])
             .forEach(([cx, cz, cw, cd]) => { arch.box(group, arch.trimMat, cw, 0.3, cd, cx, 0.15, cz).receiveShadow = true; });
         // Crossing paths
         arch.box(group, arch.trimMat, w, 0.16, 2.2, 0, 0.08, 0).receiveShadow = true;
         arch.box(group, arch.trimMat, 2.2, 0.16, d, 0, 0.08, 0).receiveShadow = true;
         // Benches facing the paths (concrete seat, dark metal backrest)
         const bench = (bx: number, bz: number, alongX: boolean, back: number) => {
             const [sw, sd] = alongX ? [2.4, 0.7] : [0.7, 2.4];
             arch.box(group, arch.trimMat, sw, 0.14, sd, bx, 0.5, bz);
             arch.box(group, arch.trimMat, alongX ? 0.2 : 0.6, 0.45, alongX ? 0.6 : 0.2, bx - (alongX ? 0.9 : 0), 0.22, bz - (alongX ? 0 : 0.9));
             arch.box(group, arch.trimMat, alongX ? 0.2 : 0.6, 0.45, alongX ? 0.6 : 0.2, bx + (alongX ? 0.9 : 0), 0.22, bz + (alongX ? 0 : 0.9));
             arch.box(group, arch.frameMat, alongX ? 2.4 : 0.08, 0.5, alongX ? 0.08 : 2.4, bx + (alongX ? 0 : back * 0.33), 0.92, bz + (alongX ? back * 0.33 : 0));
         };
         bench(-w / 4, -1.9, true, -1); bench(w / 4, 1.9, true, 1);
         // Trees in the four lawn quarters
         ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]).forEach(([sx, sz]) => {
             parkTrees.push([x + sx * w * 0.3, z + sz * d * 0.3]);
             if (w > 20) parkTrees.push([x + sx * w * 0.42, z + sz * d * 0.12]);
         });
         scene.add(group);
         environmentDisposables.push(group);
    };

    // 3. Warehouse / Industrial complex: corrugated shed under a shallow barrel
    // roof, truck roll-up doors and a personnel door in front, an office corner
    // with windows and a glass entrance on the road side, clerestory windows high
    // on the long walls and a raised loading dock at the back.
    const warehouseMetalTex = generateWarehouseTexture(); // one texture/material for every shed
    const metalWallMat = new THREE.MeshStandardMaterial({ color: '#6b7280', roughness: 0.45, metalness: 0.75, map: warehouseMetalTex });
    const warehouseRoofMat = new THREE.MeshStandardMaterial({ color: '#4b5563', roughness: 0.3, metalness: 0.7 });
    const cautionMat = new THREE.MeshStandardMaterial({ color: '#fbbf24', roughness: 0.7 });
    const bollardGeo = new THREE.CylinderGeometry(0.18, 0.18, 1.2, 8);
    cityMaterials.push(metalWallMat, warehouseRoofMat, cautionMat);
    const createWarehouse = (x: number, z: number, w: number, d: number, h: number) => {
         const group = new THREE.Group();
         group.position.set(x, 0, z);
         
         const mainGeo = new THREE.BoxGeometry(w, h, d);
         const mainMesh = new THREE.Mesh(mainGeo, metalWallMat);
         mainMesh.position.y = h / 2;
         mainMesh.castShadow = true;
         mainMesh.receiveShadow = true;
         group.add(mainMesh);
         
         // Shallow barrel roof (an arc of a big cylinder) with gable infills at both ends
         const rise = w * 0.12, R = ((w / 2) ** 2 + rise ** 2) / (2 * rise), alpha = Math.asin(w / 2 / R);
         const roofGeo = new THREE.CylinderGeometry(R, R, d + 0.6, 12, 1, true, -alpha, 2 * alpha);
         roofGeo.rotateX(-Math.PI / 2);
         const roofMesh = new THREE.Mesh(roofGeo, warehouseRoofMat);
         roofMesh.position.set(0, h - R * Math.cos(alpha), 0);
         roofMesh.castShadow = true;
         group.add(roofMesh);
         const gable = new THREE.Shape();
         for (let i = 0; i <= 12; i++) { const t = -alpha + (2 * alpha * i) / 12; const px = R * Math.sin(t), py = R * Math.cos(t) - R * Math.cos(alpha); if (i === 0) gable.moveTo(px, py); else gable.lineTo(px, py); }
         const gableGeo = new THREE.ShapeGeometry(gable);
         ([[-d / 2, Math.PI], [d / 2, 0]] as [number, number][]).forEach(([gz, ry]) => { const gm = new THREE.Mesh(gableGeo, metalWallMat); gm.position.set(0, h, gz); gm.rotation.y = ry; gm.castShadow = gm.receiveShadow = true; group.add(gm); });

         // FRONT (-z): two truck doors with bollards and aprons, a personnel door between them
         const doorW = w * 0.3, doorH = Math.min(h * 0.6, 9.5);
         [-1, 1].forEach(sx => {
             const dx = sx * w * 0.22;
             arch.place(group, arch.rollupDoor(doorW, doorH), '-z', dx, 0, -d / 2);
             arch.box(group, arch.trimMat, doorW + 1.2, 0.1, 4, dx, 0.05, -d / 2 - 2).receiveShadow = true;
             [-1, 1].forEach(b => { const bo = new THREE.Mesh(bollardGeo, cautionMat); bo.position.set(dx + b * (doorW / 2 + 0.8), 0.6, -d / 2 - 0.7); bo.receiveShadow = true; group.add(bo); });
         });
         arch.place(group, arch.steelDoor(), '-z', 0, 0, -d / 2);
         arch.place(group, arch.windowUnit(1.6, 1.0, { cols: 2, rows: 1, lit: 0.6 }), '-z', 0, 4.2, -d / 2);
         arch.box(group, cautionMat, w * 0.85, 0.6, 0.3, 0, Math.max(doorH + 2, h * 0.82), -d / 2 - 0.15);

         // ROAD SIDE: office corner at the front end, glass office entrance, back personnel door
         const rs = x > 0 ? -1 : 1; // local x direction of the road
         const roadFace: Face = rs < 0 ? '-x' : '+x', farFace: Face = rs < 0 ? '+x' : '-x';
         const sideX = rs * w / 2;
         arch.place(group, arch.glassDoors(2.6, 2.6, { transom: 0.6 }), roadFace, sideX, 0, -d / 2 + 4.5);
         arch.box(group, arch.frameMat, 2.4, 0.3, 4.2, sideX + rs * 1.2, 3.9, -d / 2 + 4.5);
         arch.box(group, arch.trimMat, 2.4, 0.12, 3.6, sideX + rs * 1.2, 0.06, -d / 2 + 4.5);
         arch.windowRow(group, roadFace, 3, 3.2, -d / 2 + 11.4, 1.9, sideX, 2.2, 1.5, { cols: 2, rows: 1, lit: 0.7 });
         arch.windowRow(group, roadFace, 5, 3.2, -d / 2 + 8.2, 6.2, sideX, 2.2, 1.5, { cols: 2, rows: 1, lit: 0.6 });
         arch.place(group, arch.steelDoor(), roadFace, sideX, 0, d / 2 - 4);
         // Clerestory ribbons high on both long walls
         const ribbonLen = d - 5;
         ([[roadFace, sideX], [farFace, -sideX]] as [Face, number][]).forEach(([f, sxx]) => {
             arch.place(group, arch.windowUnit(ribbonLen, 1.6, { cols: Math.round(ribbonLen / 1.7), rows: 1, lit: 0.6, sill: false }), f, sxx, h - 2.4, 0);
         });
         arch.place(group, arch.steelDoor(), farFace, -sideX, 0, -d / 2 + 5);

         // BACK (+z): raised loading dock with three dock doors, bumpers, canopy and steps
         const dockW = w * 0.8, dockH = 1.2, dockD = 3.2;
         const dock = arch.box(group, arch.trimMat, dockW, dockH, dockD, 0, dockH / 2, d / 2 + dockD / 2);
         [-1, 0, 1].forEach(i => {
             const dx = i * w * 0.25;
             arch.place(group, arch.rollupDoor(3.4, 3.4), '+z', dx, dockH, d / 2);
             [-1, 1].forEach(b => arch.box(group, arch.frameMat, 0.35, 0.55, 0.3, dx + b * 1.3, 0.7, d / 2 + dockD + 0.15));
         });
         arch.box(group, arch.frameMat, dockW + 1, 0.3, dockD + 0.6, 0, dockH + 4.9, d / 2 + (dockD + 0.6) / 2);
         [0.8, 0.4].forEach((sh, i) => arch.box(group, arch.trimMat, 0.8, sh, 1.6, dockW / 2 + 0.4 + i * 0.8, sh / 2, d / 2 + 1.0)); // steps up to the dock
         arch.place(group, arch.windowUnit(w - 8, 1.6, { cols: Math.round((w - 8) / 1.7), rows: 1, lit: 0.6, sill: false }), '+z', 0, h - 2.4, d / 2);
         
         const warehouseSign = createBuildingSign('LOGISTICS BAY', '#1f2937', '#eab308');
         warehouseSign.position.set(0, h + rise + 2.5, -d / 2);
         group.add(warehouseSign);
         
         scene.add(group);
         environmentDisposables.push(group);
         group.updateMatrixWorld(true);
         
         staticCollisionBoxes.push(new THREE.Box3().setFromObject(mainMesh));
         staticCollisionBoxes.push(new THREE.Box3().setFromObject(dock));
    };

    // Populate Suburban trees
    for(let i = 0; i < 80; i++) {
         const zOffset = 50 + random() * 900;
         const side = random() > 0.5 ? (-20 - random() * 40) : (20 + random() * 40);
         // Keep the dealership plot (x -62..82, z < 115) clear of trees
         if (zOffset < 115 && side > -62 && side < 82) continue;
         placeTree(side, zOffset);
    }

    // Deploy Themed Zoned Districts
    
    // District 1: Financial & Corporate Skyscraper District (Z = 100 to 300)
    // All skyscrapers sit well north of the dealership plot (lot ends at z=100)
    createSkyscraper(50, 330, 30, 26, 90, '#1e293b');
    createSkyscraper(55, 275, 26, 26, 75, '#111827');
    createSkyscraper(-50, 360, 28, 26, 80, '#0f172a');
    createSkyscraper(-50, 285, 30, 26, 105, '#1e1b4b');

    // District 2: pocket parks where the old shop plaza stood (Z = 330 to 555)
    createPocketPark(50, 470, 26, 20);
    createPocketPark(45, 545, 22, 18);
    createPocketPark(-45, 336, 22, 12);
    createPocketPark(-50, 400, 26, 22);
    createPocketPark(-45, 460, 22, 18);
    parkTrees.forEach(([tx, tz]) => placeTree(tx, tz));
    // Only draw the trees actually placed: unused instance slots default to the
    // world origin, which put a stray tree in the middle of the first player's lot.
    trunkInstanced.count = treeIndex;
    leavesInstanced.count = treeIndex;
    trunkInstanced.instanceMatrix.needsUpdate = true;
    leavesInstanced.instanceMatrix.needsUpdate = true;

    // District 3: Industrial Logistics & Warehouse District (Z = 550 to 800)
    createWarehouse(60, 620, 40, 32, 16);
    createWarehouse(65, 740, 36, 28, 14);
    createWarehouse(-60, 635, 38, 28, 14);
    createWarehouse(-65, 745, 40, 32, 15);

    // Extra streetlights for the newly expanded Test Drive Road
    [-15, 15].forEach(x => {
        [240, 300, 360, 420, 470].forEach(z => {
            const poleGeo = new THREE.CylinderGeometry(0.2, 0.4, 15, 8);
            const poleMat = new THREE.MeshStandardMaterial({ color: '#27272a', metalness: 0.8, roughness: 0.2 });
            const pole = new THREE.Mesh(poleGeo, poleMat);
            pole.position.set(x, 7.5, z);
            pole.castShadow = true;
            scene.add(pole);
            environmentDisposables.push(pole);

            addLightSource(x, 14.5, z, '#fef08a', 2, 80, true);

            const bulbGeo = new THREE.SphereGeometry(0.6, 12, 8); // a small unlit bulb: the 32x16 default was ~1k triangles each
            const bulbMat = new THREE.MeshBasicMaterial({ color: '#fef08a' }); // MeshBasic is unlit — already full-bright, emissive props don't apply
            const bulb = new THREE.Mesh(bulbGeo, bulbMat);
            bulb.position.set(x, 15, z);
            scene.add(bulb);
            environmentDisposables.push(bulb);
        });
    });



    // Physical Bank Building located on the main road outside the lot
    const bankGroup = new THREE.Group();
    bankGroup.position.set(45, 0, 140); // just outside the front-right fence, beside the entrance — accessible but not on the lot

    const bankMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.5, metalness: 0.3 });
    const bankGlass = makeGlass('#38bdf8', 0.3);

    // Hollow Capital Bank building
    const walls = [
        new THREE.Mesh(new THREE.BoxGeometry(30, 20, 1), bankMat),  // South (Back)
        new THREE.Mesh(new THREE.BoxGeometry(1, 20, 20), bankMat),  // West (Left)
        new THREE.Mesh(new THREE.BoxGeometry(1, 20, 20), bankMat),  // East (Right)
        new THREE.Mesh(new THREE.BoxGeometry(12, 20, 1), bankMat),  // North Left (Front)
        new THREE.Mesh(new THREE.BoxGeometry(12, 20, 1), bankMat),  // North Right (Front)
        new THREE.Mesh(new THREE.BoxGeometry(30, 1, 20), bankMat)   // Roof
    ];
    walls[0].position.set(0, 10, 9.5);   // South wall
    walls[1].position.set(-14.5, 10, 0); // West wall
    walls[2].position.set(14.5, 10, 0);  // East wall
    // Front wall (North)
    walls[3].position.set(-9, 10, -9.5); // Leaves 6-unit gap in middle for door
    walls[4].position.set(9, 10, -9.5);
    walls[5].position.set(0, 20.5, 0);

    walls.forEach(w => {
        w.castShadow = true;
        w.receiveShadow = true;
        w.userData.solid = true;
        bankGroup.add(w);
    });

    // Add a teller desk inside
    const bkDeskMat = new THREE.MeshStandardMaterial({ color: '#1e293b' });
    const bkDesk = new THREE.Mesh(new THREE.BoxGeometry(10, 3, 3), bkDeskMat);
    bkDesk.position.set(0, 1.5, 0);
    bkDesk.userData.solid = true;
    bankGroup.add(bkDesk);

    // Bank lobby: waiting sofas facing the teller, plants, and framed art.
    const bSofaL = makeSofa('#475569'); bSofaL.position.set(-7, 0, -6); bankGroup.add(bSofaL);
    const bSofaR = makeSofa('#475569'); bSofaR.position.set(7, 0, -6); bankGroup.add(bSofaR);
    const bTable = makeCoffeeTable(); bTable.position.set(-7, 0, -4.2); bankGroup.add(bTable);
    ([[-13, 7], [13, 7], [-13, -8]] as [number, number][]).forEach(([x, z]) => { const pl = makePlant(); pl.position.set(x, 0, z); bankGroup.add(pl); });
    const bArt1 = makePainting(3, 1.8, '#065f46', '#a7f3d0'); bArt1.position.set(-7, 9, 9.4); bArt1.rotation.y = Math.PI; bankGroup.add(bArt1);
    const bArt2 = makePainting(3, 1.8, '#1e3a8a', '#93c5fd'); bArt2.position.set(7, 9, 9.4); bArt2.rotation.y = Math.PI; bankGroup.add(bArt2);
    addLightSource(45, 12, 136, '#fff3da', 1.0, 46, false);

    // Facade: framed curtain wall either side of the entrance over a stone base,
    // stone pilasters, a frieze and a cornice; tall windows on the sides and back.
    {
        const { box, trimMat, frameMat, litGlassMat, glassMat, paneGeo, plane } = arch;
        const t = (m: THREE.Mesh) => { m.receiveShadow = true; return m; };
        [-1, 1].forEach(sx => {
            const cx = sx * 9; // centre of each front wall piece (x 3..15)
            t(box(bankGroup, trimMat, 12.2, 1.2, 0.5, cx, 0.6, -10.1));                     // stone base
            plane(bankGroup, litGlassMat, paneGeo(10.2, 15.6, 4, 5), cx - sx * 0.3, 9.0, -10.06).rotation.y = Math.PI;
            const inner = plane(bankGroup, glassMat, paneGeo(10.2, 15.6, 4, 5), cx - sx * 0.3, 9.0, -8.94); inner.rotation.y = 0; // seen from the lobby
            box(bankGroup, frameMat, 10.6, 0.3, 0.35, cx - sx * 0.3, 16.95, -10.15);          // curtain-wall frame
            box(bankGroup, frameMat, 0.3, 15.6, 0.35, cx - sx * 0.3 - 5.25, 9.0, -10.15);
            box(bankGroup, frameMat, 0.3, 15.6, 0.35, cx - sx * 0.3 + 5.25, 9.0, -10.15);
            t(box(bankGroup, trimMat, 0.9, 20, 0.7, sx * 14.6, 10, -10.2));                   // corner pilasters
            t(box(bankGroup, trimMat, 0.9, 20, 0.7, sx * 3.45, 10, -10.2));                   // entrance pilasters
        });
        t(box(bankGroup, trimMat, 30.4, 0.9, 0.5, 0, 18.4, -10.2));                            // frieze
        t(box(bankGroup, trimMat, 31.2, 0.9, 21.2, 0, 20.75, 0));                              // cornice
        // Entrance: frame in the 6-unit gap, transom glass, solid header, propped-open glass doors
        box(bankGroup, bankMat, 6, 11.8, 1, 0, 14.1, -9.5).castShadow = true;                  // header above the doors
        box(bankGroup, frameMat, 0.3, 8.2, 1.05, -2.85, 4.1, -9.5);                            // jambs
        box(bankGroup, frameMat, 0.3, 8.2, 1.05, 2.85, 4.1, -9.5);
        box(bankGroup, frameMat, 5.4, 0.3, 1.05, 0, 4.55, -9.5);                               // transom bar
        box(bankGroup, frameMat, 6, 0.25, 1.05, 0, 8.08, -9.5);
        plane(bankGroup, litGlassMat, paneGeo(5.4, 3.4, 3, 1), 0, 6.4, -9.9).rotation.y = Math.PI;
        // Door leaves propped open outward, either side of the walkway (no collision)
        [-1, 1].forEach(sx => { const leaf = arch.openLeaf(2.7, 4.4, Math.PI / 2 - sx * 0.15, bankGlass); leaf.position.set(sx * 2.7, 0, -10.05); bankGroup.add(leaf); });
        box(bankGroup, frameMat, 9.6, 0.4, 3.6, 0, 8.6, -11.8);                                // canopy
        t(box(bankGroup, trimMat, 9.7, 0.6, 0.2, 0, 8.6, -13.6));
        t(box(bankGroup, trimMat, 9, 0.12, 4, 0, 0.06, -12));                                  // entry slab
        // Sides and back: two storeys of tall windows with sills and lintels, stone base
        const wo = { cols: 2, rows: 2, lintel: true, lit: 0.55 };
        [['+x', 15], ['-x', -15]].forEach(([f, sx]) => {
            arch.windowRow(bankGroup, f as Face, 3, 5.6, 0, 5.2, sx as number, 2.8, 4.6, wo);
            arch.windowRow(bankGroup, f as Face, 3, 5.6, 0, 13.4, sx as number, 2.8, 4.6, wo);
            t(box(bankGroup, trimMat, 0.5, 1.2, 20.4, (sx as number) + Math.sign(sx as number) * 0.1, 0.6, 0));
        });
        arch.windowRow(bankGroup, '+z', 4, 6.5, 0, 5.2, 10, 2.8, 4.6, wo);
        arch.windowRow(bankGroup, '+z', 4, 6.5, 0, 13.4, 10, 2.8, 4.6, wo);
        t(box(bankGroup, trimMat, 30.4, 1.2, 0.5, 0, 0.6, 10.1));
        t(box(bankGroup, trimMat, 28, 0.1, 18, 0, 0.05, 0));                                    // stone lobby floor
    }

    const bankSign = createBuildingSign('CAPITAL BANK', '#0f172a', '#38bdf8');
    bankSign.position.set(0, 23, -10);
    bankGroup.add(bankSign);

    scene.add(bankGroup);
    environmentDisposables.push(bankGroup, bankSign);

    // --- Massive Global Auction House (Down the Street X: -60, Z: 240) ---
    const auctionGroup = new THREE.Group();
    auctionGroup.position.set(-60, 0, 240); // Place south of the cross-street
    
    const aucMat = new THREE.MeshStandardMaterial({ color: '#27272a', roughness: 0.9, map: concreteTex });
    // Main Warehouse Building
    const aucBuildingGeo = new THREE.BoxGeometry(80, 25, 60);
    const aucBuilding = new THREE.Mesh(aucBuildingGeo, aucMat);
    aucBuilding.position.set(0, 12.5, 0);
    aucBuilding.castShadow = true;
    aucBuilding.receiveShadow = true;
    aucBuilding.userData.solid = true;
    auctionGroup.add(aucBuilding);

    // Facade: stone base, pilasters dividing the walls into bays, a cornice,
    // ribbon windows at street level and clerestory windows up high, a tall
    // glass entrance hall in a stone portal facing the street (with a canopy over
    // the bidding kiosk), a side entrance toward the main road and truck doors
    // at the back.
    const aucPortalPosts: THREE.Mesh[] = [];
    {
        const { box, trimMat, frameMat, litGlassMat, paneGeo, plane } = arch;
        const t = (m: THREE.Mesh) => { m.receiveShadow = true; return m; };
        const W = 40, D = 30; // half extents
        t(box(auctionGroup, trimMat, 81.2, 1.2, 61.2, 0, 24.6, 0));                          // cornice
        // Stone base, left open in front of every door: runs of [from, to] along a face
        const baseX = (z: number, runs: [number, number][]) => runs.forEach(([a, b]) => t(box(auctionGroup, trimMat, b - a, 1.4, 0.5, (a + b) / 2, 0.7, z)));
        const baseZ = (x: number, runs: [number, number][]) => runs.forEach(([a, b]) => t(box(auctionGroup, trimMat, 0.5, 1.4, b - a, x, 0.7, (a + b) / 2)));
        const BACK_DOORS = [-26.75, 0, 26.75];
        baseX(-D - 0.1, [[-40.3, -10], [10, 40.3]]);
        baseX(D + 0.1, [[-40.3, -30.5], [-23, -3.5], [3.5, 23], [30.5, 40.3]]);
        baseZ(-W - 0.1, [[-30.3, 30.3]]);
        baseZ(W + 0.1, [[-30.3, -9.9], [-5.1, 30.3]]);
        // Pilasters
        [-40, -30, -20, 20, 30, 40].forEach(px => t(box(auctionGroup, trimMat, 1.4, 22.6, 0.6, px, 12.7, -D - 0.2)));
        [-40, -13.4, 13.4, 40].forEach(px => t(box(auctionGroup, trimMat, 1.4, 22.6, 0.6, px, 12.7, D + 0.2)));
        [-15, 0, 15].forEach(pz => [-1, 1].forEach(sx => t(box(auctionGroup, trimMat, 0.6, 22.6, 1.4, sx * (W + 0.2), 12.7, pz))));
        // Front bays: street-level ribbon + clerestory in each bay
        [-35, -25, -15, 15, 25, 35].forEach(px => {
            arch.place(auctionGroup, arch.windowUnit(7.6, 3.6, { cols: 4, rows: 1, lit: 0.7 }), '-z', px, 3.9, -D);
            arch.place(auctionGroup, arch.windowUnit(7.6, 4.4, { cols: 4, rows: 2, lit: 0.6 }), '-z', px, 18.6, -D);
        });
        // Entrance hall: glass wall in a deep stone portal, two pairs of doors, canopy
        plane(auctionGroup, litGlassMat, paneGeo(17.6, 13, 6, 4), 0, 7.9, -D - 0.06).rotation.y = Math.PI;
        t(box(auctionGroup, trimMat, 20.4, 1.6, 1.4, 0, 15.2, -D - 0.6));
        [-1, 1].forEach(sx => aucPortalPosts.push(t(box(auctionGroup, trimMat, 1.4, 14.4, 1.4, sx * 9.5, 7.2, -D - 0.6))));
        box(auctionGroup, frameMat, 17.6, 0.35, 0.3, 0, 7.9, -D - 0.15);                      // mid transom
        [-4.4, 4.4].forEach(px => arch.place(auctionGroup, arch.glassDoors(3.6, 3.1, { transom: 0.8 }), '-z', px, 0, -D));
        box(auctionGroup, frameMat, 19, 0.45, 5, 0, 5.4, -D - 2.5);                            // canopy over the kiosk
        t(box(auctionGroup, trimMat, 19.1, 0.7, 0.2, 0, 5.4, -D - 5));
        arch.place(auctionGroup, arch.windowUnit(17, 5, { cols: 6, rows: 2, lit: 0.8, sill: false }), '-z', 0, 19.6, -D); // clerestory over the hall
        // Sides: four bays each; the side facing the main road (+x) has an entrance in one bay
        ([['+x', W], ['-x', -W]] as [Face, number][]).forEach(([f, sx]) => {
            [-22.5, -7.5, 7.5, 22.5].forEach(pz => {
                arch.place(auctionGroup, arch.windowUnit(12, 4.4, { cols: 6, rows: 2, lit: 0.6 }), f, sx, 18.6, pz);
                if (f === '+x' && pz === -7.5) return;
                arch.place(auctionGroup, arch.windowUnit(12, 3.6, { cols: 6, rows: 1, lit: 0.7 }), f, sx, 3.9, pz);
            });
        });
        arch.place(auctionGroup, arch.glassDoors(3.6, 3.1, { transom: 0.8 }), '+x', W, 0, -7.5);
        [-1, 1].forEach(s => arch.place(auctionGroup, arch.windowUnit(3.2, 3.6, { cols: 2, rows: 1, lit: 0.7 }), '+x', W, 3.9, -7.5 + s * 4.2));
        box(auctionGroup, frameMat, 4, 0.4, 8, W + 2, 4.9, -7.5);
        t(box(auctionGroup, trimMat, 0.2, 0.6, 8.1, W + 4, 4.9, -7.5));
        // Back: three truck doors with aprons, clerestory per bay
        BACK_DOORS.forEach(px => {
            arch.place(auctionGroup, arch.rollupDoor(7, 6), '+z', px, 0, D);
            t(box(auctionGroup, trimMat, 8.5, 0.1, 5, px, 0.05, D + 2.5));
            arch.place(auctionGroup, arch.windowUnit(22, 4.4, { cols: 10, rows: 2, lit: 0.5 }), '+z', px, 18.6, D);
        });
    }

    // Huge glowing sign
    const aucSign = createBuildingSign('GLOBAL AUCTION EXCHANGE', '#000000', '#f97316');
    aucSign.position.set(0, 28, -20);
    auctionGroup.add(aucSign);

    // Kiosks in front (Z is negative relative so it's closer to the street)
    const kioskGeo = new THREE.BoxGeometry(4, 2, 2);
    const kioskMat = new THREE.MeshStandardMaterial({ color: '#1e3a8a', emissive: '#1e3a8a', emissiveIntensity: 0.5 });
    const kioskMesh = new THREE.Mesh(kioskGeo, kioskMat);
    kioskMesh.position.set(0, 1, -35); // World Z: 205
    auctionGroup.add(kioskMesh);

    const screenGeo = new THREE.BoxGeometry(3.5, 1.5, 0.2);
    const screenMat = new THREE.MeshStandardMaterial({ color: '#38bdf8', emissive: '#38bdf8', emissiveIntensity: 1.0 });
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.set(0, 2, -35);
    screenMesh.rotation.x = -Math.PI / 8;
    auctionGroup.add(screenMesh);

    scene.add(auctionGroup);
    environmentDisposables.push(auctionGroup, aucSign);

    // --- Public Library with Minecraft-style bookshelves --------------------
    const LIB_X = -95, LIB_Z = 140;
    const libraryWorldPos = new THREE.Vector3(LIB_X, 1.5, LIB_Z);
    const libraryGroup = new THREE.Group();
    libraryGroup.position.set(LIB_X, 0, LIB_Z);

    // Pixel-art bookshelf texture: wood planks top/bottom, colourful spines.
    const generateBookshelfTexture = () => {
         const c = document.createElement('canvas'); c.width = 64; c.height = 64;
         const ctx = c.getContext('2d'); if (!ctx) return new THREE.Texture();
         ctx.fillStyle = '#6b4f2a'; ctx.fillRect(0, 0, 64, 64);
         ctx.fillStyle = '#8a6a3a'; ctx.fillRect(0, 0, 64, 11); ctx.fillRect(0, 53, 64, 11);
         const colors = ['#b91c1c','#1d4ed8','#15803d','#a16207','#7c3aed','#0e7490','#be123c','#4d7c0f','#9333ea'];
         const drawRow = (y: number, h: number) => {
             let x = 1;
             while (x < 63) {
                 const w = 5 + Math.floor(random() * 4);
                 ctx.fillStyle = colors[Math.floor(random() * colors.length)];
                 ctx.fillRect(x, y, w - 1, h);
                 ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x, y, 1, h);
                 x += w;
             }
         };
         drawRow(13, 18); drawRow(34, 17);
         const tex = new THREE.CanvasTexture(c);
         tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
         cityTextures.push(tex);
         return tex;
    };
    const shelfTex = generateBookshelfTexture();
    const shelfMat = new THREE.MeshStandardMaterial({ map: shelfTex, roughness: 0.9 });
    cityMaterials.push(shelfMat);

    // All bookshelf blocks in ONE InstancedMesh = a single draw call.
    const shelfGeo = new THREE.BoxGeometry(1, 1, 0.6);
    const shelfMesh = new THREE.InstancedMesh(shelfGeo, shelfMat, 160);
    shelfMesh.castShadow = true; shelfMesh.receiveShadow = true;
    let shelfIdx = 0;
    const shelfDummy = new THREE.Object3D();
    const placeShelf = (x: number, y: number, z: number, ry = 0) => {
         if (shelfIdx >= 160) return;
         shelfDummy.position.set(x, y, z); shelfDummy.rotation.set(0, ry, 0); shelfDummy.updateMatrix();
         shelfMesh.setMatrixAt(shelfIdx++, shelfDummy.matrix);
    };
    for (let row = 0; row < 3; row++) {
         const y = 0.7 + row * 1.05;
         for (let x = -6.5; x <= 6.5; x += 1) placeShelf(x, y, 5.4);          // back wall
         for (let z = -4.5; z <= 4.5; z += 1) { placeShelf(-7.4, y, z, Math.PI / 2); placeShelf(7.4, y, z, Math.PI / 2); } // sides
    }
    shelfMesh.count = shelfIdx;
    shelfMesh.instanceMatrix.needsUpdate = true;
    libraryGroup.add(shelfMesh);

    // Building shell (warm wood), door gap on the south side facing the lot.
    const libWallMat = new THREE.MeshStandardMaterial({ color: '#7c5c3a', roughness: 0.9, map: concreteTex });
    const libFloorMat = new THREE.MeshStandardMaterial({ color: '#3a2c1a', roughness: 0.9 });
    cityMaterials.push(libWallMat, libFloorMat);
    const libFloor = new THREE.Mesh(new THREE.BoxGeometry(16, 0.2, 12), libFloorMat); libFloor.position.set(0, 0.1, 0); libFloor.receiveShadow = true; libraryGroup.add(libFloor);
    const mkWall = (w: number, h: number, d: number, x: number, y: number, z: number) => {
         const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), libWallMat);
         m.position.set(x, y, z);
         return m;
    };
    const libWalls: THREE.Mesh[] = [
         mkWall(16, 5, 0.5, 0, 2.5, 6),
         mkWall(0.5, 5, 12, 8, 2.5, 0),
         mkWall(0.5, 5, 12, -8, 2.5, 0),
         mkWall(5.5, 5, 0.5, -5.25, 2.5, -6),
         mkWall(5.5, 5, 0.5, 5.25, 2.5, -6),
    ];
    libWalls.forEach(w => { w.castShadow = true; w.receiveShadow = true; libraryGroup.add(w); });
    const libRoof = new THREE.Mesh(new THREE.BoxGeometry(17, 0.5, 13), libWallMat); libRoof.position.set(0, 5.25, 0); libRoof.castShadow = true; libraryGroup.add(libRoof);
    addLightSource(LIB_X, 4, LIB_Z, '#ffd9a0', 1.2, 32, false);

    // Classic civic front: stone plinth and cornice, small-paned windows in
    // stone surrounds, a stone door case with fanlight and wooden double doors
    // propped open, and a pair of pillars carrying a short entablature.
    const libPillars: THREE.Mesh[] = [];
    {
        const { box, trimMat, frameMat, litGlassMat, glassMat, paneGeo, plane } = arch;
        const t = (m: THREE.Mesh) => { m.receiveShadow = true; return m; };
        t(box(libraryGroup, trimMat, 17.4, 0.35, 13.4, 0, 5.12, 0));                          // cornice
        [-1, 1].forEach(sx => {
            t(box(libraryGroup, trimMat, 5.8, 0.6, 0.3, sx * 5.5, 0.3, -6.35));               // plinth (front, split at the door)
            t(box(libraryGroup, trimMat, 0.3, 0.6, 12.8, sx * 8.35, 0.3, 0));                  // plinth (sides)
        });
        t(box(libraryGroup, trimMat, 16.8, 0.6, 0.3, 0, 0.3, 6.35));                            // plinth (back)
        // Door case: stone jambs and head in the gap, fanlight, wall infill above
        [-1, 1].forEach(sx => t(box(libraryGroup, trimMat, 0.45, 4.2, 0.7, sx * 2.3, 2.1, -6)));
        t(box(libraryGroup, trimMat, 5.4, 0.5, 0.7, 0, 4.45, -6));
        box(libraryGroup, libWallMat, 5, 0.3, 0.5, 0, 4.85, -6);
        box(libraryGroup, frameMat, 4.15, 0.14, 0.3, 0, 3.47, -6);
        plane(libraryGroup, litGlassMat, paneGeo(4.15, 0.66, 4, 1), 0, 3.87, -6.12).rotation.y = Math.PI;
        [-1, 1].forEach(sx => { const leaf = arch.openLeaf(2.05, 3.4, Math.PI / 2 - sx * 0.15, null, true); leaf.position.set(sx * 2.075, 0, -6.3); libraryGroup.add(leaf); });
        t(box(libraryGroup, trimMat, 6.4, 0.12, 1.8, 0, 0.06, -7.2));                           // entry step
        // Pillars and entablature
        [-1, 1].forEach(sx => {
            libPillars.push(t(box(libraryGroup, trimMat, 0.6, 4.4, 0.6, sx * 3.3, 2.2, -6.75)));
            t(box(libraryGroup, trimMat, 0.85, 0.28, 0.85, sx * 3.3, 4.45, -6.75));
        });
        t(box(libraryGroup, trimMat, 8, 0.6, 1.3, 0, 4.9, -6.85));
        // Windows (lit warmly at night — the reading room is open late)
        const wo = { cols: 2, rows: 3, lintel: true, lit: 0.85, surround: trimMat, frame: 0.18 };
        [-1, 1].forEach(sx => {
            arch.place(libraryGroup, arch.windowUnit(1.5, 2.5, wo), '-z', sx * 5.4, 2.35, -6.25);
            plane(libraryGroup, glassMat, paneGeo(1.5, 2.5, 2, 3), sx * 5.4, 2.35, -5.69);   // seen from inside
        });
        arch.windowRow(libraryGroup, '+x', 3, 3.6, 0, 2.35, 8.25, 1.5, 2.5, wo);
        arch.windowRow(libraryGroup, '-x', 3, 3.6, 0, 2.35, -8.25, 1.5, 2.5, wo);
        arch.windowRow(libraryGroup, '+z', 3, 5, 0, 2.35, 6.25, 1.5, 2.5, wo);
    }

    const librarySign = createBuildingSign('LIBRARY', '#1f2937', '#fcd34d');
    librarySign.position.set(0, 6.2, -6.2);
    libraryGroup.add(librarySign);

    scene.add(libraryGroup);
    environmentDisposables.push(libraryGroup, librarySign);
    libraryGroup.updateMatrixWorld(true);
    libWalls.forEach(w => staticCollisionBoxes.push(new THREE.Box3().setFromObject(w)));
    libPillars.forEach(p => staticCollisionBoxes.push(new THREE.Box3().setFromObject(p)));

    // --- Apex Mutual Insurance office (teal glass storefront) ---------------
    const INS_X = 95, INS_Z = 150;
    const insuranceWorldPos = new THREE.Vector3(INS_X, 1.5, INS_Z);
    const insGroup = new THREE.Group();
    insGroup.position.set(INS_X, 0, INS_Z);
    const insWallMat = new THREE.MeshStandardMaterial({ color: '#0f766e', roughness: 0.7, metalness: 0.2, map: concreteTex });
    const insGlassMat = makeGlass('#5eead4', 0.45);
    cityMaterials.push(insWallMat, insGlassMat);
    const insFloor = new THREE.Mesh(new THREE.BoxGeometry(14, 0.2, 11), new THREE.MeshStandardMaterial({ color: '#134e4a', roughness: 0.9 }));
    insFloor.position.set(0, 0.1, 0); insFloor.receiveShadow = true; insGroup.add(insFloor);
    const insWall = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material = insWallMat) => {
         const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
         m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
         return m;
    };
    const insWalls = [
         insWall(14, 6, 0.5, 0, 3, 5.5),   // back
         insWall(0.5, 6, 11, 7, 3, 0),     // east
         insWall(0.5, 6, 11, -7, 3, 0),    // west
         insWall(4.5, 6, 0.4, -4.75, 3, -5.5, insGlassMat), // front-left glass
         insWall(4.5, 6, 0.4, 4.75, 3, -5.5, insGlassMat),  // front-right glass (door gap in the middle)
    ];
    insWalls.forEach(w => insGroup.add(w));
    const insRoof = new THREE.Mesh(new THREE.BoxGeometry(15, 0.5, 12), insWallMat); insRoof.position.set(0, 6.25, 0); insRoof.castShadow = true; insGroup.add(insRoof);
    addLightSource(INS_X, 4.5, INS_Z, '#ccfbf1', 1.0, 28, false);
    // Storefront: mullions and a transom over the glass, automatic sliding
    // doors standing open behind the side lites, a canopy, metal fascia, and
    // windows on the sides and back.
    {
        const { box, trimMat, frameMat, glassMat, paneGeo, plane } = arch;
        box(insGroup, frameMat, 15.2, 0.6, 12.2, 0, 6.2, 0);                                     // fascia
        [-1, 1].forEach(sx => {
            [2.5, 4, 5.5, 7].forEach(px => box(insGroup, frameMat, 0.14, 6, 0.5, sx * px, 3, -5.5));    // mullions
            box(insGroup, frameMat, 4.5, 0.14, 0.5, sx * 4.75, 3.2, -5.5);                       // transom bars
            box(insGroup, frameMat, 4.5, 0.25, 0.5, sx * 4.75, 0.125, -5.5);                     // bottom rail
            const leaf = arch.openLeaf(2.5, 3.1, 0, insGlassMat); leaf.position.set(sx < 0 ? -5 : 2.5, 0, -5.12); insGroup.add(leaf);
        });
        box(insGroup, frameMat, 5, 0.18, 0.5, 0, 3.2, -5.5);                                     // door head
        box(insGroup, insGlassMat, 5, 2.8, 0.4, 0, 4.6, -5.5);                                   // transom glass over the doorway
        box(insGroup, frameMat, 10.4, 0.3, 0.3, 0, 3.3, -5.12);                                  // sliding-door track
        box(insGroup, frameMat, 7, 0.25, 2.2, 0, 3.75, -6.8);                                    // canopy
        box(insGroup, trimMat, 6, 0.1, 2.2, 0, 0.05, -6.8).receiveShadow = true;                 // entry slab
        const wo = { cols: 2, rows: 1, lit: 0.7 };
        ([['+x', 7.25], ['-x', -7.25]] as [Face, number][]).forEach(([f, sx]) => {
            arch.windowRow(insGroup, f, 2, 4.8, 0, 3.4, sx, 2.4, 2.2, wo);
            [-2.4, 2.4].forEach(pz => { const p = plane(insGroup, glassMat, paneGeo(2.4, 2.2, 2, 1), sx - Math.sign(sx) * 0.56, 3.4, pz); p.rotation.y = -Math.sign(sx) * Math.PI / 2; });
        });
        arch.windowRow(insGroup, '+z', 3, 4.5, 0, 3.4, 5.75, 2.4, 2.2, wo);
        [-4.5, 0, 4.5].forEach(px => { const p = plane(insGroup, glassMat, paneGeo(2.4, 2.2, 2, 1), px, 3.4, 5.19); p.rotation.y = Math.PI; });
    }
    const insSign = createBuildingSign('INSURANCE', '#042f2e', '#5eead4');
    insSign.position.set(0, 6.7, -5.7); insGroup.add(insSign);
    scene.add(insGroup);
    environmentDisposables.push(insGroup, insSign);
    insGroup.updateMatrixWorld(true);
    insWalls.forEach(w => staticCollisionBoxes.push(new THREE.Box3().setFromObject(w)));

    // ============================================================
    //  GAS STATIONS  (fuel up before/after a race — all driving burns gas)
    // ============================================================
    const gasPumps: THREE.Vector3[] = []; // world positions of every pump
    const buildGasStation = (gx: number, gz: number) => {
        const g = new THREE.Group();
        g.position.set(gx, 0, gz);
        const pad = new THREE.Mesh(new THREE.BoxGeometry(26, 0.2, 18), new THREE.MeshStandardMaterial({ color: '#3f3f46', roughness: 0.95 }));
        pad.position.set(0, 0.1, 0); pad.receiveShadow = true; g.add(pad);
        const canopyMat = new THREE.MeshStandardMaterial({ color: '#e11d48', roughness: 0.5, metalness: 0.3 });
        const whiteMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.6 });
        const roof = new THREE.Mesh(new THREE.BoxGeometry(22, 0.9, 14), canopyMat); roof.position.set(0, 7, 0); roof.castShadow = true; g.add(roof);
        const roofUnder = new THREE.Mesh(new THREE.BoxGeometry(21, 0.3, 13), whiteMat); roofUnder.position.set(0, 6.5, 0); g.add(roofUnder);
        const pillarMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.5, metalness: 0.4 });
        ([[-9, -5], [9, -5], [-9, 5], [9, 5]] as [number, number][]).forEach(([px, pz]) => {
            const p = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 7, 10), pillarMat); p.position.set(px, 3.5, pz); p.castShadow = true; g.add(p);
        });
        ([[-4, 0], [4, 0]] as [number, number][]).forEach(([px, pz]) => {
            const island = new THREE.Mesh(new THREE.BoxGeometry(3, 0.4, 5), new THREE.MeshStandardMaterial({ color: '#52525b' })); island.position.set(px, 0.3, pz); g.add(island);
            const pump = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3, 1.4), new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.4 })); pump.position.set(px, 1.9, pz); pump.castShadow = true; g.add(pump);
            const pumpTop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 1.5), new THREE.MeshStandardMaterial({ color: '#1e293b' })); pumpTop.position.set(px, 3.0, pz); g.add(pumpTop);
            const wp = new THREE.Vector3(px, 1.5, pz); g.localToWorld(wp); gasPumps.push(wp);
        });
        // Small convenience kiosk beside the pad: glass shopfront and door facing the pumps
        const KX = 17.5;
        const kiosk = arch.box(g, arch.trimMat, 6, 4.2, 9, KX, 2.1, 0);
        const fascia = arch.box(g, canopyMat, 6.3, 0.7, 9.3, KX, 4.35, 0);                        // red fascia
        fascia.castShadow = true; fascia.receiveShadow = false; // same flags as the canopy roof, so they merge
        arch.place(g, arch.glassDoors(1.8, 2.3, { leaves: 1, transom: 0.5 }), '-x', KX - 3, 0, -1.2);
        arch.place(g, arch.windowUnit(4.2, 2.2, { cols: 3, rows: 1, lit: true, sill: false }), '-x', KX - 3, 1.9, 2.2);
        arch.place(g, arch.windowUnit(1.6, 2.2, { cols: 1, rows: 1, lit: true, sill: false }), '-x', KX - 3, 1.9, -3.5);
        arch.box(g, arch.frameMat, 1.8, 0.2, 9, KX - 3.9, 3.4, 0);                                // shopfront awning
        arch.place(g, arch.steelDoor(1.1, 2.3, { canopy: false }), '+x', KX + 3, 0, 2.5);
        arch.place(g, arch.windowUnit(1.4, 1.0, { cols: 1, rows: 1, lit: 0.5 }), '+z', KX, 2.6, 4.5);
        const sign = createBuildingSign('FUEL', '#7f1d1d', '#fca5a5'); sign.position.set(0, 9, 0); g.add(sign);
        scene.add(g);
        environmentDisposables.push(g, sign);
        g.updateMatrixWorld(true);
        staticCollisionBoxes.push(new THREE.Box3().setFromObject(kiosk));
    };
    buildGasStation(135, 80);   // near the dealership district
    buildGasStation(45, 1700);  // in the speedway paddock, by the start line

    bankGroup.updateMatrixWorld(true);
    auctionGroup.updateMatrixWorld(true);
    walls.forEach(w => staticCollisionBoxes.push(new THREE.Box3().setFromObject(w)));
    staticCollisionBoxes.push(new THREE.Box3().setFromObject(bkDesk));
    staticCollisionBoxes.push(new THREE.Box3().setFromObject(aucBuilding));
    aucPortalPosts.forEach(p => staticCollisionBoxes.push(new THREE.Box3().setFromObject(p)));

    return { libraryWorldPos, insuranceWorldPos, gasPumps };
}
