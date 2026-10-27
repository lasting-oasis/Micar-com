import * as THREE from 'three';
import type { WorldContext } from './context';
import type { FurnitureKit } from './furniture';
import { createBuildingSign } from '../textures';

// The town: ground, roads, trees, districts, bank, auction house, library,
// insurance office and gas stations. Returns the spots the game loop needs.
export function buildCity(ctx: WorldContext, furniture: FurnitureKit) {
    const { scene, environmentDisposables, staticCollisionBoxes, cityMaterials, cityTextures, emissiveFacadeMaterials, concreteTex, makeGlass, addLightSource } = ctx;
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

    const numTrees = 80;
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
         const s = 0.8 + Math.random() * 0.6; // Organic scale variation
         const rot = Math.random() * Math.PI;

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
    

    // Procedural Skyscraper Facade Texture Generator
    const generateFacadeTexture = (cols: number, rows: number, baseColorHex: string) => {
         const canvas = document.createElement('canvas');
         canvas.width = 512;
         canvas.height = 1024;
         const ctx = canvas.getContext('2d');
         if (!ctx) return new THREE.Texture();
         ctx.fillStyle = baseColorHex;
         ctx.fillRect(0, 0, 512, 1024);
         
         const winW = 512 / cols;
         const winH = 1024 / rows;
         
         for (let r = 0; r < rows; r++) {
             for (let c = 0; c < cols; c++) {
                 const roll = Math.random();
                 if (roll < 0.22) {
                     ctx.fillStyle = '#fef08a'; // Lit yellow window
                 } else if (roll < 0.30) {
                     ctx.fillStyle = '#93c5fd'; // Lit blue window
                 } else {
                     ctx.fillStyle = '#0b0f19'; // Dark unlit window
                 }
                 // Margin frame
                 ctx.fillRect(c * winW + 4, r * winH + 4, winW - 8, winH - 8);
             }
         }
         
         const tex = new THREE.CanvasTexture(canvas);
         tex.wrapS = THREE.RepeatWrapping;
         tex.wrapT = THREE.RepeatWrapping;
         cityTextures.push(tex);
         return tex;
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
    
    // 1. Skyscraper / Office Tower
    const createSkyscraper = (x: number, z: number, w: number, d: number, h: number, baseColorHex: string) => {
         const group = new THREE.Group();
         group.position.set(x, 0, z);
         
         const tex = generateFacadeTexture(8, 16, baseColorHex);
         const facadeMat = new THREE.MeshStandardMaterial({
             map: tex,
             roughness: 0.15,
             metalness: 0.85,
             emissiveMap: tex,
             emissive: new THREE.Color('#ffffff'),
             emissiveIntensity: 0.15
         });
         emissiveFacadeMaterials.push(facadeMat);
         cityMaterials.push(facadeMat);
         
         // Tier 1 Base
         const baseH = h * 0.25;
         const baseGeo = new THREE.BoxGeometry(w, baseH, d);
         const baseMesh = new THREE.Mesh(baseGeo, facadeMat);
         baseMesh.position.y = baseH / 2;
         baseMesh.castShadow = true;
         baseMesh.receiveShadow = true;
         group.add(baseMesh);
         
         // Tier 2 Middle
         const midW = w * 0.85;
         const midD = d * 0.85;
         const midH = h * 0.55;
         const midGeo = new THREE.BoxGeometry(midW, midH, midD);
         const midMesh = new THREE.Mesh(midGeo, facadeMat);
         midMesh.position.y = baseH + midH / 2;
         midMesh.castShadow = true;
         midMesh.receiveShadow = true;
         group.add(midMesh);
         
         // Tier 3 Penthouse Top
         const topW = w * 0.7;
         const topD = d * 0.7;
         const topH = h * 0.2;
         const topGeo = new THREE.BoxGeometry(topW, topH, topD);
         const topMesh = new THREE.Mesh(topGeo, facadeMat);
         topMesh.position.y = baseH + midH + topH / 2;
         topMesh.castShadow = true;
         topMesh.receiveShadow = true;
         group.add(topMesh);
         
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
         const beaconBulb = new THREE.Mesh(new THREE.SphereGeometry(0.4), new THREE.MeshBasicMaterial({ color: '#ef4444' }));
         beaconBulb.position.set(0, h + 8, 0);
         group.add(beaconBulb);
         
         scene.add(group);
         environmentDisposables.push(group);
         group.updateMatrixWorld(true);
         
         staticCollisionBoxes.push(new THREE.Box3().setFromObject(baseMesh));
         staticCollisionBoxes.push(new THREE.Box3().setFromObject(midMesh));
    };

    // 2. Retail Storefront / Shop
    const createStorefront = (x: number, z: number, w: number, d: number, h: number, awningColorHex: string) => {
         const group = new THREE.Group();
         group.position.set(x, 0, z);
         
         const wallMat = new THREE.MeshStandardMaterial({ color: '#eae5d9', roughness: 0.9, map: concreteTex });
         const glassMat = makeGlass('#38bdf8', 0.4);
         cityMaterials.push(wallMat, glassMat);
         
         const storeGeo = new THREE.BoxGeometry(w, h, d);
         const storeMesh = new THREE.Mesh(storeGeo, wallMat);
         storeMesh.position.y = h / 2;
         storeMesh.castShadow = true;
         storeMesh.receiveShadow = true;
         group.add(storeMesh);
         
         const windowGeo = new THREE.BoxGeometry(w * 0.7, h * 0.5, 0.5);
         const windowMesh = new THREE.Mesh(windowGeo, glassMat);
         windowMesh.position.set(0, h * 0.4, -d / 2 - 0.1);
         group.add(windowMesh);
         
         const awningGeo = new THREE.BoxGeometry(w * 0.8, 1.2, 3);
         const awningMat = new THREE.MeshStandardMaterial({ color: awningColorHex, roughness: 0.7 });
         cityMaterials.push(awningMat);
         const awning = new THREE.Mesh(awningGeo, awningMat);
         awning.position.set(0, h * 0.7, -d / 2 - 1.2);
         awning.rotation.x = Math.PI / 8;
         awning.castShadow = true;
         group.add(awning);
         
         const doorGeo = new THREE.BoxGeometry(3, h * 0.6, 0.6);
         const doorMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.2 });
         cityMaterials.push(doorMat);
         const door = new THREE.Mesh(doorGeo, doorMat);
         door.position.set(0, h * 0.3, -d / 2 - 0.25);
         group.add(door);
         
         const sign = createBuildingSign('RETAIL STORE', '#0f172a', awningColorHex);
         sign.position.set(0, h + 2, -d / 2);
         group.add(sign);
         
         scene.add(group);
         environmentDisposables.push(group);
         group.updateMatrixWorld(true);
         
         staticCollisionBoxes.push(new THREE.Box3().setFromObject(storeMesh));
    };

    // 3. Warehouse / Industrial complex
    const createWarehouse = (x: number, z: number, w: number, d: number, h: number) => {
         const group = new THREE.Group();
         group.position.set(x, 0, z);
         
         const metalTex = generateWarehouseTexture();
         const metalWallMat = new THREE.MeshStandardMaterial({ 
             color: '#6b7280', 
             roughness: 0.45, 
             metalness: 0.75,
             map: metalTex
         });
         cityMaterials.push(metalWallMat);
         
         const mainGeo = new THREE.BoxGeometry(w, h, d);
         const mainMesh = new THREE.Mesh(mainGeo, metalWallMat);
         mainMesh.position.y = h / 2;
         mainMesh.castShadow = true;
         mainMesh.receiveShadow = true;
         group.add(mainMesh);
         
         const roofR = w * 0.52;
         const roofGeo = new THREE.CylinderGeometry(roofR, roofR, d, 16, 1, false, 0, Math.PI);
         roofGeo.rotateX(Math.PI / 2);
         const roofMesh = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: '#4b5563', roughness: 0.3, metalness: 0.7 }));
         roofMesh.position.set(0, h, 0);
         roofMesh.castShadow = true;
         group.add(roofMesh);
         
         const doorGeo = new THREE.BoxGeometry(w * 0.32, h * 0.75, 0.4);
         const doorMat = new THREE.MeshStandardMaterial({ color: '#9ca3af', roughness: 0.5, metalness: 0.5 });
         cityMaterials.push(doorMat);
         
         const doorL = new THREE.Mesh(doorGeo, doorMat);
         doorL.position.set(-w * 0.22, h * 0.375, -d / 2 - 0.1);
         doorL.castShadow = true;
         group.add(doorL);
         
         const doorR = new THREE.Mesh(doorGeo, doorMat);
         doorR.position.set(w * 0.22, h * 0.375, -d / 2 - 0.1);
         doorR.castShadow = true;
         group.add(doorR);
         
         const cautionMat = new THREE.MeshStandardMaterial({ color: '#fbbf24', roughness: 0.7 });
         cityMaterials.push(cautionMat);
         const stripeGeo = new THREE.BoxGeometry(w * 0.85, 1.0, 0.5);
         const cautionStripe = new THREE.Mesh(stripeGeo, cautionMat);
         cautionStripe.position.set(0, h * 0.82, -d / 2 - 0.2);
         group.add(cautionStripe);
         
         const warehouseSign = createBuildingSign('LOGISTICS BAY', '#1f2937', '#eab308');
         warehouseSign.position.set(0, h + roofR * 0.5 + 2, -d / 2);
         group.add(warehouseSign);
         
         scene.add(group);
         environmentDisposables.push(group);
         group.updateMatrixWorld(true);
         
         staticCollisionBoxes.push(new THREE.Box3().setFromObject(mainMesh));
    };

    // Populate Suburban trees
    for(let i = 0; i < 80; i++) {
         const zOffset = 50 + Math.random() * 900;
         const side = Math.random() > 0.5 ? (-20 - Math.random() * 40) : (20 + Math.random() * 40);
         // Keep the dealership plot (x -62..82, z < 115) clear of trees
         if (zOffset < 115 && side > -62 && side < 82) continue;
         placeTree(side, zOffset);
    }
    // Only draw the trees actually placed: unused instance slots default to the
    // world origin, which put a stray tree in the middle of the first player's lot.
    trunkInstanced.count = treeIndex;
    leavesInstanced.count = treeIndex;
    trunkInstanced.instanceMatrix.needsUpdate = true;
    leavesInstanced.instanceMatrix.needsUpdate = true;

    // Deploy Themed Zoned Districts
    
    // District 1: Financial & Corporate Skyscraper District (Z = 100 to 300)
    // All skyscrapers sit well north of the dealership plot (lot ends at z=100)
    createSkyscraper(50, 330, 30, 26, 90, '#1e293b');
    createSkyscraper(55, 275, 26, 26, 75, '#111827');
    createSkyscraper(-50, 360, 28, 26, 80, '#0f172a');
    createSkyscraper(-50, 285, 30, 26, 105, '#1e1b4b');

    // District 2: Commercial & Storefront Plaza District (Z = 300 to 550)
    createStorefront(50, 470, 24, 18, 10, '#b91c1c'); // Red shop
    createStorefront(45, 545, 20, 16, 9, '#047857');  // Green shop
    createStorefront(-45, 340, 22, 18, 10, '#3b82f6'); // Blue shop
    createStorefront(-50, 400, 24, 20, 11, '#eab308'); // Yellow department
    createStorefront(-45, 460, 20, 16, 9, '#7c3aed');  // Purple bookstore

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

            const bulbGeo = new THREE.SphereGeometry(0.6);
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

    // Render glass panels specifically on either side of the entrance gap!
    const bkGlassLeft = new THREE.Mesh(new THREE.BoxGeometry(12, 15, 1), bankGlass);
    bkGlassLeft.position.set(-9, 8.5, -9.6);
    const bkGlassRight = new THREE.Mesh(new THREE.BoxGeometry(12, 15, 1), bankGlass);
    bkGlassRight.position.set(9, 8.5, -9.6);
    bankGroup.add(bkGlassLeft, bkGlassRight);

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
                 const w = 5 + Math.floor(Math.random() * 4);
                 ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
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

    const librarySign = createBuildingSign('LIBRARY', '#1f2937', '#fcd34d');
    librarySign.position.set(0, 6.2, -6.2);
    libraryGroup.add(librarySign);

    scene.add(libraryGroup);
    environmentDisposables.push(libraryGroup, librarySign);
    libraryGroup.updateMatrixWorld(true);
    libWalls.forEach(w => staticCollisionBoxes.push(new THREE.Box3().setFromObject(w)));

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
        const sign = createBuildingSign('FUEL', '#7f1d1d', '#fca5a5'); sign.position.set(0, 9, 0); g.add(sign);
        scene.add(g);
        environmentDisposables.push(g, sign);
    };
    buildGasStation(135, 80);   // near the dealership district
    buildGasStation(45, 1700);  // in the speedway paddock, by the start line

    bankGroup.updateMatrixWorld(true);
    auctionGroup.updateMatrixWorld(true);
    walls.forEach(w => staticCollisionBoxes.push(new THREE.Box3().setFromObject(w)));
    staticCollisionBoxes.push(new THREE.Box3().setFromObject(bkDesk));
    staticCollisionBoxes.push(new THREE.Box3().setFromObject(aucBuilding));

    return { libraryWorldPos, insuranceWorldPos, gasPumps };
}
