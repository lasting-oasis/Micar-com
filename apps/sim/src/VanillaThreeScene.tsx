import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useGameStore } from './store';

export function VanillaThreeScene() {
    const mountRef = useRef<HTMLDivElement>(null);
    const { gameState, playerId } = useGameStore();
    
    // Use refs to bypass react hook lifecycle dependencies inside the raw rAF loop
    const stateRef = useRef({ gameState, playerId });
    useEffect(() => {
        stateRef.current = { gameState, playerId };
    }, [gameState, playerId]);

    useEffect(() => {
        if (!mountRef.current) return;
        
        // --- 1. Core Scene Setup ---
        const scene = new THREE.Scene();
        
        // Procedural Daylight Environment Map for High-Fidelity PBR Reflections
        const generateEnvMap = () => {
             const canvas = document.createElement('canvas');
             canvas.width = 512; canvas.height = 512;
             const ctx = canvas.getContext('2d');
             if (!ctx) return new THREE.Texture();
             const grad = ctx.createLinearGradient(0, 0, 0, 512);
             grad.addColorStop(0, '#60a5fa'); // Sky blue top
             grad.addColorStop(0.5, '#3b82f6'); // Bright blue middle
             grad.addColorStop(1, '#bae6fd'); // Light cyan horizon
             ctx.fillStyle = grad;
             ctx.fillRect(0, 0, 512, 512);
             const tex = new THREE.CanvasTexture(canvas);
             tex.mapping = THREE.EquirectangularReflectionMapping;
             return tex;
        };
        const envTexture = generateEnvMap();
        scene.environment = envTexture; // Bind reflection map
        scene.background = new THREE.Color('#87ceeb'); // Bright Sky blue
        scene.fog = new THREE.Fog('#87ceeb', 100, 800); // Expanded fog curve

        const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        
        let renderer: THREE.WebGLRenderer;
        try {
            renderer = new THREE.WebGLRenderer({ antialias: true });
        } catch (e) {
            console.error('WebGL is not supported:', e);
            if (mountRef.current) {
                mountRef.current.innerHTML = `
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: white; font-family: sans-serif; padding: 20px; text-align: center; background: #0c0d12;">
                        <h2 style="color: #ef4444; margin-bottom: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px;">WebGL Support Required</h2>
                        <p style="font-size: 13px; max-width: 420px; color: #a1a1aa; line-height: 1.6; margin: 0 auto 15px auto;">
                            The immersive 3D simulation requires WebGL hardware acceleration. Please verify that hardware acceleration is enabled in your browser settings (e.g. Chrome: Settings -> System -> 'Use graphics acceleration when available') and reload the page.
                        </p>
                    </div>
                `;
            }
            return () => {};
        }
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        mountRef.current.appendChild(renderer.domElement);

        const createBuildingSign = (text: string, bgColor: string, txtColor: string) => {
             const canvas = document.createElement('canvas');
             canvas.width = 512; canvas.height = 128;
             const ctx = canvas.getContext('2d');
             if (!ctx) return new THREE.Sprite();
             ctx.fillStyle = bgColor;
             if (ctx.roundRect) ctx.roundRect(0, 0, 512, 128, 20); else ctx.rect(0, 0, 512, 128);
             ctx.fill();
             ctx.fillStyle = txtColor; ctx.font = 'bold 56px sans-serif'; ctx.textAlign = 'center'; 
             ctx.fillText(text, 256, 85);
             const tex = new THREE.CanvasTexture(canvas);
             const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
             const sprite = new THREE.Sprite(mat);
             sprite.scale.set(12, 3, 1);
             return sprite;
        };

        // --- 2. Lighting (Daylight) ---
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambientLight);
        
        const dirLight = new THREE.DirectionalLight(0xffffff, 2.5); // Intense Sun
        dirLight.position.set(200, 300, -100);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.bias = -0.001;
        // Keep the shadow camera tightly bounded to the dealership and town area for better resolution
        dirLight.shadow.camera.left = -150;
        dirLight.shadow.camera.right = 150;
        dirLight.shadow.camera.top = 150;
        dirLight.shadow.camera.bottom = -150;
        scene.add(dirLight);

        // --- 3. Dealership Lot Environment Building ---
        const environmentDisposables: (THREE.Object3D)[] = [];
        
        // Streetlights
        const streetLights: THREE.PointLight[] = [];
        const createStreetLight = (x: number, z: number) => {
             const poleGeo = new THREE.CylinderGeometry(0.2, 0.2, 10);
             const poleMat = new THREE.MeshStandardMaterial({ color: '#52525b', roughness: 0.8 });
             const pole = new THREE.Mesh(poleGeo, poleMat);
             pole.position.set(x, 5, z);
             scene.add(pole);
             environmentDisposables.push(pole);

             const light = new THREE.PointLight('#fef08a', 0, 50); // Start off (intensity 0)
             light.position.set(x, 9.5, z);
             light.castShadow = true;
             scene.add(light);
             streetLights.push(light);
             environmentDisposables.push(light);
        };
        createStreetLight(-15, 15);
        createStreetLight(15, 15);
        createStreetLight(-15, -15);
        createStreetLight(15, -15);

        // Procedural Gritty Bump Map Generator
        const staticCollisionBoxes: THREE.Box3[] = [];
        
        const generateConcreteTexture = () => {
             const size = 512;
             const canvas = document.createElement('canvas');
             canvas.width = size; canvas.height = size;
             const context = canvas.getContext('2d');
             if (!context) return new THREE.Texture();
             const imgData = context.createImageData(size, size);
             for (let i = 0; i < imgData.data.length; i += 4) {
                 const v = 80 + Math.random() * 60; 
                 imgData.data[i] = v; imgData.data[i+1] = v; imgData.data[i+2] = v; imgData.data[i+3] = 255;
             }
             context.putImageData(imgData, 0, 0);
             const tex = new THREE.CanvasTexture(canvas);
             tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
             tex.repeat.set(4, 4);
             return tex;
        };
        const concreteTex = generateConcreteTexture();

        const generateNoiseTexture = () => {
             const size = 512;
             const canvas = document.createElement('canvas');
             canvas.width = size; canvas.height = size;
             const context = canvas.getContext('2d');
             if (!context) return new THREE.Texture();
             const imgData = context.createImageData(size, size);
             for (let i = 0; i < imgData.data.length; i += 4) {
                 const v = Math.floor(Math.random() * 255);
                 imgData.data[i] = v; imgData.data[i+1] = v; imgData.data[i+2] = v; imgData.data[i+3] = 255;
             }
             context.putImageData(imgData, 0, 0);
             const tex = new THREE.CanvasTexture(canvas);
             tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
             tex.repeat.set(160, 160); // Scale texture repeat for massive map
             return tex;
        };
        const noiseBumpMap = generateNoiseTexture();

        // Grassy Floor (expanded to massive 2000x2000 open world)
        const floorGeo = new THREE.BoxGeometry(2000, 1, 2000);
        const floorMat = new THREE.MeshStandardMaterial({ 
            color: '#14532d', // Emerald-900 grassy green
            roughness: 0.95, 
            metalness: 0.1
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.position.y = -0.5;
        floor.receiveShadow = true;
        scene.add(floor);
        environmentDisposables.push(floor);

        // Suburbs Outbound Road Networks (Massive expansion)
        const roadGeo = new THREE.BoxGeometry(25, 0.5, 1000); // Main strip
        const roadMat = new THREE.MeshStandardMaterial({ color: '#27272a', roughness: 0.8 });
        
        const roadMain = new THREE.Mesh(roadGeo, roadMat);
        roadMain.position.set(0, 0.02, 540); 
        roadMain.receiveShadow = true;
        scene.add(roadMain);
        environmentDisposables.push(roadMain);

        const dividerGeo = new THREE.BoxGeometry(0.5, 0.6, 1000);
        const dividerMat = new THREE.MeshStandardMaterial({ color: '#fbbf24' });
        const dividerMain = new THREE.Mesh(dividerGeo, dividerMat);
        dividerMain.position.set(0, 0.03, 540);
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
        
        // 2. High-Fidelity Themed Procedural City Blocks & Zoning
        
        // Materials to dispose during cleanup
        const cityMaterials: THREE.Material[] = [];
        const cityTextures: THREE.Texture[] = [];
        const emissiveFacadeMaterials: THREE.MeshStandardMaterial[] = [];

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
        const sidewalkLeft = new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, 850), sidewalkMat);
        sidewalkLeft.position.set(-17.5, 0.05, 450);
        sidewalkLeft.receiveShadow = true;
        scene.add(sidewalkLeft);
        environmentDisposables.push(sidewalkLeft);

        const sidewalkRight = new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, 850), sidewalkMat);
        sidewalkRight.position.set(17.5, 0.05, 450);
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
                 stripe.position.set(xOffset, 0.03, zPos);
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
             const glassMat = new THREE.MeshPhysicalMaterial({ color: '#38bdf8', transmission: 0.9, opacity: 0.6, transparent: true, roughness: 0.1 });
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
             if (Math.abs(side - 40) < 30 && Math.abs(zOffset - 130) < 30) continue;
             placeTree(side, zOffset);
        }
        trunkInstanced.instanceMatrix.needsUpdate = true;
        leavesInstanced.instanceMatrix.needsUpdate = true;

        // Deploy Themed Zoned Districts
        
        // District 1: Financial & Corporate Skyscraper District (Z = 100 to 300)
        createSkyscraper(50, 95, 30, 26, 90, '#1e293b');
        createSkyscraper(55, 275, 26, 26, 75, '#111827');
        createSkyscraper(-50, 110, 28, 26, 80, '#0f172a');
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
            [80, 150, 220, 290, 360].forEach(z => {
                const poleGeo = new THREE.CylinderGeometry(0.2, 0.4, 15, 8);
                const poleMat = new THREE.MeshStandardMaterial({ color: '#27272a', metalness: 0.8, roughness: 0.2 });
                const pole = new THREE.Mesh(poleGeo, poleMat);
                pole.position.set(x, 7.5, z);
                pole.castShadow = true;
                scene.add(pole);
                environmentDisposables.push(pole);

                const lampLight = new THREE.PointLight('#fef08a', 2, 80);
                lampLight.position.set(x, 14.5, z);
                lampLight.castShadow = false;
                scene.add(lampLight);
                environmentDisposables.push(lampLight);

                const bulbGeo = new THREE.SphereGeometry(0.6);
                const bulbMat = new THREE.MeshBasicMaterial({ color: '#fef08a', emissive: '#fef08a', emissiveIntensity: 2.0 });
                const bulb = new THREE.Mesh(bulbGeo, bulbMat);
                bulb.position.set(x, 15, z);
                scene.add(bulb);
                environmentDisposables.push(bulb);
            });
        });


        const builtDealerships = new Set<string>();

        const createDealership = (lotX: number, lotZ: number, playerId: string) => {
        // --- 1. Main Office Building ---
        const officeGroup = new THREE.Group();
        officeGroup.position.set(lotX - 25, 0, lotZ - 25);

        const officeMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.8 }); // Slate-800
        const glassMat = new THREE.MeshPhysicalMaterial({ color: '#38bdf8', transmission: 0.8, opacity: 1, transparent: true, roughness: 0.1, ior: 1.5 });
        const floorMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.7, map: concreteTex });
        
        const oRoof = new THREE.Mesh(new THREE.BoxGeometry(20, 0.5, 15), officeMat);
        oRoof.position.set(0, 8, 0); oRoof.castShadow = true; officeGroup.add(oRoof);
        
        const oFloor = new THREE.Mesh(new THREE.PlaneGeometry(19, 14), floorMat);
        oFloor.rotation.x = -Math.PI / 2; oFloor.position.set(0, 0.05, 0); oFloor.receiveShadow = true; officeGroup.add(oFloor);

        const oWallB = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 0.5), officeMat);
        oWallB.position.set(0, 4, -7.25); oWallB.userData.solid = true; oWallB.castShadow = true; oWallB.receiveShadow = true; officeGroup.add(oWallB);

        const oWallL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 14.5), officeMat);
        oWallL.position.set(-9.75, 4, 0); oWallL.userData.solid = true; oWallL.castShadow = true; oWallL.receiveShadow = true; officeGroup.add(oWallL);

        const oWallR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 14.5), officeMat);
        oWallR.position.set(9.75, 4, 0); oWallR.userData.solid = true; oWallR.castShadow = true; oWallR.receiveShadow = true; officeGroup.add(oWallR);

        // Front Wall Pieces - Modern glass structure
        const oWallFL = new THREE.Mesh(new THREE.BoxGeometry(7.5, 8, 0.5), glassMat);
        oWallFL.position.set(-6.25, 4, 7.25); oWallFL.userData.solid = true; officeGroup.add(oWallFL);

        const oWallFR = new THREE.Mesh(new THREE.BoxGeometry(7.5, 8, 0.5), glassMat);
        oWallFR.position.set(6.25, 4, 7.25); oWallFR.userData.solid = true; officeGroup.add(oWallFR);
        
        // Door frame
        const oDoorFrame = new THREE.Mesh(new THREE.BoxGeometry(4.5, 8.2, 0.7), new THREE.MeshStandardMaterial({ color: '#0f172a' }));
        oDoorFrame.position.set(0, 4.1, 7.25); officeGroup.add(oDoorFrame);
        // Glass door
        const oDoorGlass = new THREE.Mesh(new THREE.BoxGeometry(4, 7.5, 0.2), glassMat);
        oDoorGlass.position.set(0, 3.75, 7.25); officeGroup.add(oDoorGlass);

        // Interior Sales Desk
        const deskGeo = new THREE.BoxGeometry(4, 1.2, 2);
        const deskMat = new THREE.MeshStandardMaterial({ color: '#475569' });
        const desk = new THREE.Mesh(deskGeo, deskMat);
        desk.position.set(0, 0.6, -3); officeGroup.add(desk);
        
        // Computer Monitor on Desk
        const monitorGeo = new THREE.BoxGeometry(1.5, 1, 0.1);
        const monitorMat = new THREE.MeshStandardMaterial({ color: '#111827', emissive: '#111827' });
        const monitor = new THREE.Mesh(monitorGeo, monitorMat);
        monitor.position.set(0, 1.7, -3); officeGroup.add(monitor);

        scene.add(officeGroup);
        environmentDisposables.push(officeGroup);

        // Dealership Neon Roof Sign
        const signGeo = new THREE.BoxGeometry(18, 2, 1);
        const signMat = new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.3, emissive: '#dc2626', emissiveIntensity: 2.0 });
        const sign = new THREE.Mesh(signGeo, signMat);
        sign.position.set(lotX - 25, 9, lotZ - 24.5);
        scene.add(sign);
        environmentDisposables.push(sign);

        // Dynamic Street Lighting
        const poleGeo = new THREE.CylinderGeometry(0.2, 0.4, 15, 8);
        const poleMat = new THREE.MeshStandardMaterial({ color: '#27272a', metalness: 0.8, roughness: 0.2 });
        const lampPositions = [{ x: lotX - 35, z: lotZ + 15 }, { x: lotX + 35, z: lotZ - 15 }, { x: lotX + 35, z: lotZ + 35 }];
        
        lampPositions.forEach(pos => {
            const pole = new THREE.Mesh(poleGeo, poleMat);
            pole.position.set(pos.x, 7.5, pos.z);
            pole.castShadow = true;
            scene.add(pole);
            environmentDisposables.push(pole);

            const lampLight = new THREE.PointLight('#fef08a', 2, 50);
            lampLight.position.set(pos.x, 14.5, pos.z);
            lampLight.castShadow = false;
            scene.add(lampLight);
            environmentDisposables.push(lampLight);

            const bulbGeo = new THREE.SphereGeometry(0.6);
            const bulbMat = new THREE.MeshBasicMaterial({ color: '#fef08a' });
            const bulb = new THREE.Mesh(bulbGeo, bulbMat);
            bulb.position.set(pos.x, 15, pos.z);
            scene.add(bulb);
            environmentDisposables.push(bulb);
        });

        // Dealership Foundation Asphalt
        const foundationGeo = new THREE.PlaneGeometry(130, 140);
        const foundationMat = new THREE.MeshStandardMaterial({ color: '#222222', roughness: 0.9, map: concreteTex });
        const foundation = new THREE.Mesh(foundationGeo, foundationMat);
        foundation.rotation.x = -Math.PI / 2;
        foundation.position.set(lotX + 10, 0.015, lotZ + 30);
        foundation.receiveShadow = true;
        scene.add(foundation);
        environmentDisposables.push(foundation);
        
        // Driveway connecting to cross street (Z=200 is street center, 25 width -> edge is 187.5)
        const drivewayGeo = new THREE.PlaneGeometry(30, 88);
        const driveway = new THREE.Mesh(drivewayGeo, foundationMat);
        driveway.rotation.x = -Math.PI / 2;
        driveway.position.set(lotX, 0.016, lotZ + 144);
        driveway.receiveShadow = true;
        scene.add(driveway);
        environmentDisposables.push(driveway);

        // Chain Link Fence
        const fenceMat = new THREE.MeshStandardMaterial({ color: '#71717a', wireframe: true, transparent: true, opacity: 0.6 }); // Simple wireframe for chain link
        const poleMat = new THREE.MeshStandardMaterial({ color: '#52525b', metalness: 0.8 });
        
        const buildFence = (x1: number, z1: number, x2: number, z2: number) => {
             const dx = x2 - x1;
             const dz = z2 - z1;
             const length = Math.sqrt(dx * dx + dz * dz);
             const angle = Math.atan2(dz, dx);
             
             // Fence panel
             const panelGeo = new THREE.PlaneGeometry(length, 6);
             const panel = new THREE.Mesh(panelGeo, fenceMat);
             panel.position.set(x1 + dx / 2, 3, z1 + dz / 2);
             panel.rotation.y = -angle;
             
             // Add some poles
             const poles = new THREE.Group();
             const numPoles = Math.ceil(length / 5);
             for(let i=0; i<=numPoles; i++) {
                 const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 6);
                 const pole = new THREE.Mesh(poleGeo, poleMat);
                 pole.position.set(x1 + (dx * (i/numPoles)), 3, z1 + (dz * (i/numPoles)));
                 poles.add(pole);
             }
             
             scene.add(panel);
             scene.add(poles);
             environmentDisposables.push(panel, poles);
        };
        
        // Boundary of foundation: X: lotX-55 to lotX+75, Z: lotZ-40 to lotZ+100
        const fL = lotX - 55;
        const fR = lotX + 75;
        const fB = lotZ - 40;
        const fT = lotZ + 100;
        
        // Back fence
        buildFence(fL, fB, fR, fB);
        // Left fence
        buildFence(fL, fB, fL, fT);
        // Right fence
        buildFence(fR, fB, fR, fT);
        // Front fence with opening for driveway (driveway from lotX-15 to lotX+15)
        buildFence(fL, fT, lotX - 15, fT);
        buildFence(lotX + 15, fT, fR, fT);

        const lineGeo = new THREE.PlaneGeometry(0.2, 8);
        const lineMat = new THREE.MeshBasicMaterial({ color: '#eab308' }); // Yellow parking lines
        
        const centerLineGeo = new THREE.PlaneGeometry(0.3, 90);
        const centerLine = new THREE.Mesh(centerLineGeo, lineMat);
        centerLine.rotation.x = -Math.PI / 2;
        centerLine.position.set(lotX, 0.025, lotZ + 58);
        scene.add(centerLine);
        environmentDisposables.push(centerLine);

        for (let i = 0; i < 15; i++) {
            const zSpot = lotZ + Math.floor(i) * 6 + 15; 
            
            // Left Column Stalls Divider
            const ll = new THREE.Mesh(lineGeo, lineMat); 
            ll.rotation.x = -Math.PI / 2;
            ll.rotation.z = Math.PI / 2;
            ll.position.set(lotX - 6, 0.025, zSpot + 3); 
            scene.add(ll);
            environmentDisposables.push(ll);

            // Right Column Stalls Divider
            const lr = new THREE.Mesh(lineGeo, lineMat); 
            lr.rotation.x = -Math.PI / 2;
            lr.rotation.z = Math.PI / 2;
            lr.position.set(lotX + 6, 0.025, zSpot + 3); 
            scene.add(lr);
            environmentDisposables.push(lr);
        }

        // Delivery Drop-Off Zone (x: -40, z: 15)
        const dropOffGeo = new THREE.BoxGeometry(15, 0.1, 80);
        const dropOffMat = new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.9 });
        const dropOffPad = new THREE.Mesh(dropOffGeo, dropOffMat);
        dropOffPad.position.set(lotX - 40, 0.05, lotZ + 50); // Top is at y: 0.1
        dropOffPad.receiveShadow = true;
        scene.add(dropOffPad);
        environmentDisposables.push(dropOffPad);

        const dropOffBorderGeo = new THREE.BoxGeometry(15.5, 0.12, 80.5);
        const dropOffBorderMat = new THREE.MeshBasicMaterial({ color: '#f87171' }); // Red outline
        const dropOffBorder = new THREE.Mesh(dropOffBorderGeo, dropOffBorderMat);
        dropOffBorder.position.set(lotX - 40, 0.06, lotZ + 50); // Top is at y: 0.12 (no z-fighting!)
        scene.add(dropOffBorder);
        environmentDisposables.push(dropOffBorder);
        // Wash Bay (Open air drive-thru)
        const washGroup = new THREE.Group();
        washGroup.position.set(lotX + 55, 0, lotZ - 40);
        
        const washGlass = new THREE.MeshPhysicalMaterial({ color: '#0ea5e9', transmission: 0.9, opacity: 1, transparent: true, ior: 1.5, roughness: 0.1, side: THREE.DoubleSide });
        const washConc = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, map: concreteTex });
        
        // Roof
        const wRoof = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 12), washConc);
        wRoof.position.y = 6;
        washGroup.add(wRoof);
        
        // 4 Pillars
        [-4.5, 4.5].forEach(x => {
            [-5.5, 5.5].forEach(z => {
                const wPillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.5), washConc);
                wPillar.position.set(x, 3, z);
                wPillar.castShadow = true;
                wPillar.receiveShadow = true;
                wPillar.userData.solid = true;
                washGroup.add(wPillar);
            });
        });
        
        // Left and Right Glass Walls (Leave front and back open for vehicles)
        const wWallGeo = new THREE.BoxGeometry(0.2, 5.5, 11);
        const wWallL = new THREE.Mesh(wWallGeo, washGlass); wWallL.position.set(-4.5, 3.25, 0); washGroup.add(wWallL);
        const wWallR = new THREE.Mesh(wWallGeo, washGlass); wWallR.position.set(4.5, 3.25, 0); washGroup.add(wWallR);
        
        const washSign = createBuildingSign('CAR WASH', '#0ea5e9', '#ffffff');
        washSign.position.set(0, 8, 0); // Hovering above
        washGroup.add(washSign);

        scene.add(washGroup);
        environmentDisposables.push(washGroup, washSign);

        // Mechanic Bay Garage
        const mechGroup = new THREE.Group();
        mechGroup.position.set(lotX + 55, 0, lotZ + 5);
        
        const darkConc = new THREE.MeshStandardMaterial({ color: '#888888', roughness: 1.0, map: concreteTex });
        const industrialFloor = new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.6 });
        const cautionMat = new THREE.MeshStandardMaterial({ color: '#eab308' }); // Yellow trim
        
        // Solid Back Wall and Side Walls
        const mWallLRGeo = new THREE.BoxGeometry(0.5, 6, 15);
        const mWallL = new THREE.Mesh(mWallLRGeo, darkConc); mWallL.position.set(-5.75, 3, 0); mWallL.castShadow = true; mWallL.receiveShadow = true; mWallL.userData.solid = true; mechGroup.add(mWallL);
        const mWallR = new THREE.Mesh(mWallLRGeo, darkConc); mWallR.position.set(5.75, 3, 0); mWallR.castShadow = true; mWallR.receiveShadow = true; mWallR.userData.solid = true; mechGroup.add(mWallR);
        
        const mWallBack = new THREE.Mesh(new THREE.BoxGeometry(11.5, 6, 0.5), darkConc);
        mWallBack.position.set(0, 3, 7.25);
        mWallBack.castShadow = true; mWallBack.receiveShadow = true; mWallBack.userData.solid = true;
        mechGroup.add(mWallBack);
        
        // Front Frame (Wide Open Garage Door)
        const mGarageTrimL = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6, 0.5), cautionMat); mGarageTrimL.position.set(-5, 3, -7.25); mechGroup.add(mGarageTrimL);
        const mGarageTrimR = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6, 0.5), cautionMat); mGarageTrimR.position.set(5, 3, -7.25); mechGroup.add(mGarageTrimR);
        const mGarageTop = new THREE.Mesh(new THREE.BoxGeometry(10, 1.5, 0.5), cautionMat); mGarageTop.position.set(0, 5.25, -7.25); mechGroup.add(mGarageTop);

        // Floor and Roof
        const mRoof = new THREE.Mesh(new THREE.BoxGeometry(12, 0.5, 15), darkConc); mRoof.position.set(0, 6.25, 0); mRoof.castShadow = true; mechGroup.add(mRoof);
        const mFloor = new THREE.Mesh(new THREE.PlaneGeometry(11, 14), industrialFloor); mFloor.rotation.x = -Math.PI / 2; mFloor.position.set(0, 0.05, 0); mFloor.receiveShadow = true; mechGroup.add(mFloor);
        
        const mechSign = createBuildingSign('MECHANIC', '#eab308', '#000000');
        mechSign.position.set(0, 9, -7.3); // Hovering above entrance
        mechGroup.add(mechSign);

        scene.add(mechGroup);
        environmentDisposables.push(mechGroup, mechSign);

        // Body Shop Garage
        const bodyGroup = new THREE.Group();
        bodyGroup.position.set(lotX + 55, 0, lotZ + 50);
        
        const bodyTrimMat = new THREE.MeshStandardMaterial({ color: '#3b82f6' }); // Blue trim for Body Shop
        
        // Solid Back Wall and Side Walls
        const bWallL = new THREE.Mesh(mWallLRGeo, darkConc); bWallL.position.set(-5.75, 3, 0); bWallL.castShadow = true; bWallL.receiveShadow = true; bWallL.userData.solid = true; bodyGroup.add(bWallL);
        const bWallR = new THREE.Mesh(mWallLRGeo, darkConc); bWallR.position.set(5.75, 3, 0); bWallR.castShadow = true; bWallR.receiveShadow = true; bWallR.userData.solid = true; bodyGroup.add(bWallR);
        
        const bWallBack = new THREE.Mesh(new THREE.BoxGeometry(11.5, 6, 0.5), darkConc);
        bWallBack.position.set(0, 3, 7.25);
        bWallBack.castShadow = true; bWallBack.receiveShadow = true; bWallBack.userData.solid = true;
        bodyGroup.add(bWallBack);
        
        // Front Frame (Wide Open Garage Door)
        const bGarageTrimL = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6, 0.5), bodyTrimMat); bGarageTrimL.position.set(-5, 3, -7.25); bodyGroup.add(bGarageTrimL);
        const bGarageTrimR = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6, 0.5), bodyTrimMat); bGarageTrimR.position.set(5, 3, -7.25); bodyGroup.add(bGarageTrimR);
        const bGarageTop = new THREE.Mesh(new THREE.BoxGeometry(10, 1.5, 0.5), bodyTrimMat); bGarageTop.position.set(0, 5.25, -7.25); bodyGroup.add(bGarageTop);

        // Floor and Roof
        const bRoof = new THREE.Mesh(new THREE.BoxGeometry(12, 0.5, 15), darkConc); bRoof.position.set(0, 6.25, 0); bRoof.castShadow = true; bodyGroup.add(bRoof);
        const bFloor = new THREE.Mesh(new THREE.PlaneGeometry(11, 14), industrialFloor); bFloor.rotation.x = -Math.PI / 2; bFloor.position.set(0, 0.05, 0); bFloor.receiveShadow = true; bodyGroup.add(bFloor);
        
        const bodySign = createBuildingSign('BODY SHOP', '#3b82f6', '#ffffff');
        bodySign.position.set(0, 9, -7.3); // Hovering above entrance
        bodyGroup.add(bodySign);

        scene.add(bodyGroup);
        environmentDisposables.push(bodyGroup, bodySign);

        [washGroup, mechGroup, bodyGroup, officeGroup].forEach(g => {
            g.updateMatrixWorld(true);
            g.children.forEach(c => {
                if (c.userData.solid) staticCollisionBoxes.push(new THREE.Box3().setFromObject(c));
            });
        });
    };

    // Physical Bank Building located on the main road outside the lot
        const bankGroup = new THREE.Group();
        bankGroup.position.set(40, 0, 130);

        const bankMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.5, metalness: 0.3 });
        const bankGlass = new THREE.MeshPhysicalMaterial({ color: '#38bdf8', transmission: 0.9, opacity: 1, transparent: true, roughness: 0.05 });

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



        // Steel Chainlink Perimeter Fence (Shatter the South Face for the Road)
        const fenceMat = new THREE.MeshStandardMaterial({ color: '#52525b', wireframe: true, transparent: true, opacity: 0.5 });
        const fenceNS = new THREE.BoxGeometry(160, 4, 0.1);
        const fenceEW = new THREE.BoxGeometry(0.1, 4, 160);
        
        const fenceNorth = new THREE.Mesh(fenceNS, fenceMat); fenceNorth.position.set(0, 2, -80); scene.add(fenceNorth);
        const fenceWest = new THREE.Mesh(fenceEW, fenceMat); fenceWest.position.set(-80, 2, 0); scene.add(fenceWest);
        const fenceEast = new THREE.Mesh(fenceEW, fenceMat); fenceEast.position.set(80, 2, 0); scene.add(fenceEast);
        environmentDisposables.push(fenceNorth, fenceWest, fenceEast);

        fenceNorth.updateMatrixWorld(true); staticCollisionBoxes.push(new THREE.Box3().setFromObject(fenceNorth));
        fenceWest.updateMatrixWorld(true); staticCollisionBoxes.push(new THREE.Box3().setFromObject(fenceWest));
        fenceEast.updateMatrixWorld(true); staticCollisionBoxes.push(new THREE.Box3().setFromObject(fenceEast));
        bankGroup.updateMatrixWorld(true);
        auctionGroup.updateMatrixWorld(true);
        walls.forEach(w => staticCollisionBoxes.push(new THREE.Box3().setFromObject(w)));
        staticCollisionBoxes.push(new THREE.Box3().setFromObject(bkDesk));
        staticCollisionBoxes.push(new THREE.Box3().setFromObject(aucBuilding));

        // --- 4. Dynamic Objects ---
        const buildCarModel = (isSUV: boolean, rawColor: string, bodyCond: number = 100, mechCond: number = 100) => {
             const group = new THREE.Group();
             let c = rawColor;
             try { new THREE.Color(c); } catch { c = '#ffffff'; }

             let roughnessVal = 0.2;
             let metalnessVal = 0.6;
             let tint = new THREE.Color(c);

             // Apply visual rust/dirt based on body condition
             if (bodyCond < 50) {
                 roughnessVal = 0.9;
                 metalnessVal = 0.1;
                 // Tint towards brown/rust
                 tint.lerp(new THREE.Color('#8b4513'), 1 - (bodyCond / 50));
             }

             const bodyMat = new THREE.MeshStandardMaterial({ color: tint, metalness: metalnessVal, roughness: roughnessVal });
             const glassMat = new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.9, roughness: 0.1, transparent: true, opacity: bodyCond < 40 ? 0.3 : 0.8 });
             const rubberMat = new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.9 });
             const chromeMat = new THREE.MeshStandardMaterial({ color: '#e2e8f0', metalness: 1.0, roughness: bodyCond < 50 ? 0.8 : 0.2 });

             const width = isSUV ? 4.5 : 4;
             const length = isSUV ? 10 : 9;
             const chassisH = isSUV ? 2 : 1.5;
             const yOff = isSUV ? 1.5 : 1.0;

             const chassisGeo = new THREE.BoxGeometry(width, chassisH, length);
             const chassis = new THREE.Mesh(chassisGeo, bodyMat);
             chassis.position.y = yOff;
             chassis.castShadow = true;
             chassis.receiveShadow = true;
             group.add(chassis);

             const cabW = width * 0.9;
             const cabL = length * 0.5;
             const cabH = isSUV ? 2.5 : 1.8;
             const cabZ = isSUV ? 0 : -0.5;
             const cabGeo = new THREE.BoxGeometry(cabW, cabH, cabL);
             const cab = new THREE.Mesh(cabGeo, glassMat);
             cab.position.set(0, yOff + (chassisH/2) + (cabH/2), cabZ);
             group.add(cab);

             const wR = isSUV ? 1.2 : 0.8;
             const wD = isSUV ? 1.0 : 0.8;
             const wheelGeo = new THREE.CylinderGeometry(wR, wR, wD, 16);
             wheelGeo.rotateZ(Math.PI / 2);

             const wPos = [
                 { x: -width/2, z: length/2 - 1.5 }, { x: width/2,  z: length/2 - 1.5 },
                 { x: -width/2, z: -length/2 + 2 },  { x: width/2,  z: -length/2 + 2 }
             ];

             const wheels: THREE.Mesh[] = [];
             const frontPivots: THREE.Group[] = [];
             wPos.forEach((p, idx) => {
                 const wheelPivot = new THREE.Group();
                 wheelPivot.position.set(p.x, wR, p.z);
                 
                 const wheel = new THREE.Mesh(wheelGeo, rubberMat);
                 wheel.castShadow = true;
                 
                 const hubGeo = new THREE.CylinderGeometry(wR*0.6, wR*0.6, wD+0.1, 8);
                 hubGeo.rotateZ(Math.PI / 2);
                 const hub = new THREE.Mesh(hubGeo, chromeMat);
                 wheel.add(hub);

                 wheelPivot.add(wheel);
                 group.add(wheelPivot);
                 wheels.push(wheel);
                 if (idx < 2) frontPivots.push(wheelPivot);
             });

             const hlM = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 2.0 });
             const hlG = new THREE.BoxGeometry(1, 0.4, 0.2);
             const hl1 = new THREE.Mesh(hlG, hlM); hl1.position.set(-width/2 + 0.8, yOff + 0.5, length/2 + 0.01); group.add(hl1);
             const hl2 = new THREE.Mesh(hlG, hlM); hl2.position.set(width/2 - 0.8, yOff + 0.5, length/2 + 0.01); group.add(hl2);

             const tlM = new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#dc2626', emissiveIntensity: 2.0 });
             const tl1 = new THREE.Mesh(hlG, tlM); tl1.position.set(-width/2 + 0.8, yOff + 0.5, -length/2 - 0.01); group.add(tl1);
             const tl2 = new THREE.Mesh(hlG, tlM); tl2.position.set(width/2 - 0.8, yOff + 0.5, -length/2 - 0.01); group.add(tl2);

             // Add smoke particle system for bad mechanical condition
             let smokeParticles: THREE.Points | null = null;
             if (mechCond < 50) {
                 const partGeo = new THREE.BufferGeometry();
                 const partCount = 50;
                 const pPos = new Float32Array(partCount * 3);
                 for (let i = 0; i < partCount * 3; i++) {
                     pPos[i] = (Math.random() - 0.5) * 2;
                 }
                 partGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
                 const partMat = new THREE.PointsMaterial({ color: 0x888888, size: 0.8, transparent: true, opacity: 0.4 });
                 smokeParticles = new THREE.Points(partGeo, partMat);
                 smokeParticles.position.set(0, yOff + chassisH, length / 2 - 1); // Hood position
                 group.add(smokeParticles);
             }

             return { group, wheels, body: chassis, frontPivots, smokeParticles };
        };

        const carMeshes: Record<string, THREE.Group> = {};
        const carBodies: Record<string, THREE.Mesh> = {};
        const carSmokes: Record<string, THREE.Points> = {};
        const carWheels: Record<string, THREE.Mesh[]> = {};
        const carSteering: Record<string, THREE.Group[]> = {};
        const vehiclePhysics: Record<string, { v: number, yaw: number }> = {};
        
        type BotState = { mesh: THREE.Group, targetPos: THREE.Vector3, status: 'walking_in' | 'waiting' | 'walking_out' };
        const aiBots: Record<string, BotState> = {}; // Mapped by target car ID
        
        const otherPlayerMeshes: Record<string, THREE.Group> = {}; // Mapped by player ID

        const avatar = new THREE.Group();
        const avatarGeo = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
        const avatarMat = new THREE.MeshStandardMaterial({ color: '#3b82f6' });
        const avatarBody = new THREE.Mesh(avatarGeo, avatarMat);
        avatarBody.position.y = 1;
        avatarBody.castShadow = true;
        avatar.add(avatarBody);

        const visorGeo = new THREE.BoxGeometry(0.8, 0.3, 0.6);
        const visorMat = new THREE.MeshStandardMaterial({ color: '#0ea5e9', emissive: '#0ea5e9', emissiveIntensity: 0.5 });
        const visor = new THREE.Mesh(visorGeo, visorMat);
        visor.position.set(0, 1.4, 0.3);
        avatar.add(visor);

        
        const initialMe = stateRef.current.gameState?.players[stateRef.current.playerId || ''];
        if (initialMe && initialMe.lotPosition) {
            let spawnX = initialMe.lotPosition.x;
            let spawnZ = initialMe.lotPosition.z;
            if ((initialMe as any).isStandaloneOperator) {
                if ((initialMe as any).shopSpecialty === 'mechanic') {
                    spawnX += 55;
                    spawnZ -= 10;
                } else if ((initialMe as any).shopSpecialty === 'body') {
                    spawnX += 55;
                    spawnZ += 35;
                } else { // dual
                    spawnX += 55;
                    spawnZ += 20;
                }
            } else {
                spawnZ += 30;
            }
            avatar.position.set(spawnX, 0, spawnZ);
        } else {
            avatar.position.set(0, 0, 30);
        }

        scene.add(avatar);

        // --- 3D Interactions HUD ---
        const uiCanvas = document.createElement('canvas');
        uiCanvas.width = 512;
        uiCanvas.height = 128;
        const uiCtx = uiCanvas.getContext('2d');
        if (uiCtx) {
            uiCtx.fillStyle = '#10b981';
            if (uiCtx.roundRect) uiCtx.roundRect(0, 0, 512, 128, 20); else uiCtx.rect(0, 0, 512, 128);
            uiCtx.fill();
            uiCtx.fillStyle = '#ffffff'; uiCtx.font = 'bold 48px sans-serif'; uiCtx.textAlign = 'center'; 
            uiCtx.fillText('[E] ENTER/EXIT  |  [R] INTERACT', 256, 80);
        }
        const uiTex = new THREE.CanvasTexture(uiCanvas);
        const uiMat = new THREE.SpriteMaterial({ map: uiTex, transparent: true, opacity: 0, depthTest: false });
        const interactPrompt = new THREE.Sprite(uiMat);
        interactPrompt.scale.set(6, 1.5, 1);
        interactPrompt.renderOrder = 999;
        scene.add(interactPrompt);
        environmentDisposables.push(interactPrompt);

        // --- Resize handling ---
        const handleResize = () => {
             camera.aspect = window.innerWidth / window.innerHeight;
             camera.updateProjectionMatrix();
             renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', handleResize);

        // --- Input State ---
        const keys = { w: false, a: false, s: false, d: false, e: false, r: false };
        let eWasPressed = false;
        let rWasPressed = false;
        
        // Expose input state setter for mobile touch controls
        (window as any).setMobileKey = (key: string, pressed: boolean) => {
            const k = key.toLowerCase();
            if (k in keys) {
                keys[k as keyof typeof keys] = pressed;
            }
        };
        (window as any).setMobileTap = (key: string) => {
            const k = key.toLowerCase();
            if (k === 'e') (window as any).mobileETap = true;
            if (k === 'r') (window as any).mobileRTap = true;
        };
        
        const handleKeyDown = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            if (key === 'w' || e.key === 'ArrowUp') keys.w = true;
            if (key === 'a' || e.key === 'ArrowLeft') keys.a = true;
            if (key === 's' || e.key === 'ArrowDown') keys.s = true;
            if (key === 'd' || e.key === 'ArrowRight') keys.d = true;
            if (key === 'e') keys.e = true;
            if (key === 'r') keys.r = true;
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            if (key === 'w' || e.key === 'ArrowUp') keys.w = false;
            if (key === 'a' || e.key === 'ArrowLeft') keys.a = false;
            if (key === 's' || e.key === 'ArrowDown') keys.s = false;
            if (key === 'd' || e.key === 'ArrowRight') keys.d = false;
            if (key === 'e') keys.e = false;
            if (key === 'r') keys.r = false;
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        // --- Game Loop ---
        const clock = new THREE.Clock();
        let animationFrameId: number;
        let localDrivingCarId: string | null = null; // Localized driving state!
        let hasInitializedSpawn = false;
        let lastPosEmitTime = 0;
        let lastRenderedTime = -1; // Throttle time of day updates

        const animate = () => {
            animationFrameId = requestAnimationFrame(animate);
            const time = Date.now() * 0.001;

            // Animate smoke particles
            Object.values(carSmokes).forEach(smoke => {
                if (!smoke) return;
                const positions = smoke.geometry.attributes.position.array as Float32Array;
                for (let i = 0; i < positions.length; i += 3) {
                    positions[i + 1] += 0.05; // move Y up
                    positions[i] += (Math.random() - 0.5) * 0.05; // waver X
                    if (positions[i + 1] > 3) {
                        positions[i + 1] = 0; // reset Y
                    }
                }
                smoke.geometry.attributes.position.needsUpdate = true;
            });
            const delta = clock.getDelta();
            
            const current = stateRef.current;
            const isDriving = !!localDrivingCarId;
            const me = current.gameState?.players[current.playerId || ''];

            // Time of Day Rendering Sync
            if (current.gameState && current.gameState.timeOfDay !== undefined) {
                 const t = current.gameState.timeOfDay;
                 if (Math.abs(t - lastRenderedTime) > 0.01) {
                     lastRenderedTime = t;
                     // Progress from 8.0 to 20.0 (0.0 to 1.0)
                     const progress = Math.max(0, Math.min(1, (t - 8) / 12)); 
                     
                     // Sun trajectory (East to West arc)
                     const sunHeight = Math.sin(progress * Math.PI) * 400 + 10;
                     const sunX = Math.cos(progress * Math.PI) * 500;
                     dirLight.position.set(sunX, sunHeight, -100);
                     
                      // Fade Sun and Ambient Light as evening approaches (progress > 0.7)
                      if (progress > 0.7) {
                          const fade = 1 - ((progress - 0.7) / 0.3); // 1.0 at 0.7, 0.0 at 1.0
                          dirLight.intensity = 2.5 * fade;
                          ambientLight.intensity = 0.7 * fade + 0.1; // Never fully pitch black
                          
                          // Turn on Streetlights!
                          streetLights.forEach(l => l.intensity = 1.5 * (1 - fade));

                          // Fade up skyscraper window emissive glow!
                          const glowIntensity = 0.15 + 1.25 * (1 - fade);
                          emissiveFacadeMaterials.forEach(m => m.emissiveIntensity = glowIntensity);
                      } else {
                          dirLight.intensity = 2.5;
                          ambientLight.intensity = 0.7;
                          streetLights.forEach(l => l.intensity = 0);

                          // Daytime default low window light level
                          emissiveFacadeMaterials.forEach(m => m.emissiveIntensity = 0.15);
                      }
                     
                     // Sky color lerping (Morning -> Noon -> Evening -> Night)
                     const morningColor = new THREE.Color('#fcd34d');
                     const noonColor = new THREE.Color('#60a5fa');
                     const eveningColor = new THREE.Color('#f97316');
                     const nightColor = new THREE.Color('#0f172a');
                     
                     const skyC = new THREE.Color();
                     if (progress < 0.3) {
                         skyC.lerpColors(morningColor, noonColor, progress / 0.3);
                     } else if (progress < 0.7) {
                         skyC.lerpColors(noonColor, eveningColor, (progress - 0.3) / 0.4);
                     } else {
                         skyC.lerpColors(eveningColor, nightColor, (progress - 0.7) / 0.3);
                     }
                     
                     scene.background = skyC;
                     if (scene.fog) { (scene.fog as THREE.Fog).color.copy(skyC); }
                 }
            }

            if (me && !hasInitializedSpawn && me.lotPosition) {
                 // Rescue players trapped in previous (-80, -80) corner bounds
                 let safeX = me.lotPosition.x;
                 let safeZ = me.lotPosition.z;
                 if (safeX <= -75) safeX = -20;
                 if (safeZ <= -75) safeZ = -20;
                 
                 let spawnX = safeX;
                 let spawnZ = safeZ;
                 if ((me as any).isStandaloneOperator) {
                     if ((me as any).shopSpecialty === 'mechanic') {
                         spawnX += 55;
                         spawnZ -= 10;
                     } else if ((me as any).shopSpecialty === 'body') {
                         spawnX += 55;
                         spawnZ += 35;
                     } else { // dual
                         spawnX += 55;
                         spawnZ += 20;
                     }
                 } else {
                     spawnZ += 30;
                 }
                 avatar.position.set(spawnX, 0, spawnZ);
                 hasInitializedSpawn = true;
            }

            const eJustPressed = (keys.e && !eWasPressed) || (window as any).mobileETap;
            const rJustPressed = (keys.r && !rWasPressed) || (window as any).mobileRTap;
            
            // Reset mobile taps immediately so they only last 1 frame
            (window as any).mobileETap = false;
            (window as any).mobileRTap = false;

            if (keys.e) eWasPressed = true; else eWasPressed = false;
            if (keys.r) rWasPressed = true; else rWasPressed = false;

            // E key toggle interaction (Enter / Exit vehicle)
            if (eJustPressed) {
                if (!isDriving) {
                    if (me && me.inventory.length > 0) {
                        // Find closest car to enter
                        let closestCar = null;
                        let minDist = 6.0; // Restored to a closer 6 units to prevent accidental teleporting through walls
                        me.inventory.forEach(car => {
                             const m = carMeshes[car.id];
                             if (m) {
                                 const d = avatar.position.distanceTo(m.position);
                                 if (d < minDist) { minDist = d; closestCar = car.id; }
                             }
                        });
                        if (closestCar) {
                             localDrivingCarId = closestCar; // Hijack locally!
                        }
                    }
                } else {
                    // EXITED CAR
                    if (carMeshes[localDrivingCarId!]) {
                         const m = carMeshes[localDrivingCarId!];
                         const pPos = m.position;
                         const lotX = me?.lotPosition?.x || 0;
                         const lotZ = me?.lotPosition?.z || 0;
                         
                         // Auto-park if exited inside the Show Lot
                         if (Math.abs(pPos.x - lotX) < 15 && (pPos.z - lotZ) > 10) {
                             const car = me?.inventory.find(c => c.id === localDrivingCarId);
                             if (car && !car.isDirty && !car.isProcessed && car.isRegistered) {
                                 const needsInspection = car.titleStatus === 'Salvage' && car.inspectionStatus !== 'Passed';
                                 if (!needsInspection) {
                                     useGameStore.getState().placeOnLot(car.id);
                                     // Visual flash to confirm
                                     m.scale.setScalar(1.05);
                                     setTimeout(() => { if (m) m.scale.setScalar(1.0); }, 300);
                                 }
                             }
                         }

                         // Teleport avatar to driver side door!
                         const offset = new THREE.Vector3(-3, 0, 0).applyQuaternion(m.quaternion);
                         avatar.position.copy(m.position).add(offset);
                    }
                    localDrivingCarId = null;
                }
            }

            // Object Synchronization
            if (me) {
                me.inventory.forEach((car, idx) => {
                    if (!carMeshes[car.id]) {
                        
                        let c = car.color;
                        if (c === 'Trade-In Silver') c = '#C0C0C0';
                        else if (c === 'Repo Gray') c = '#808080';
                        else if (!c) c = '#4b5563';

                        const isSUV = car.model.includes('SUV') || car.model.includes('Truck');
                        const assets = buildCarModel(isSUV, c, car.bodyCondition, car.mechanicCondition);
                        
                        const mesh = assets.group;
                        if (car.lotPosition) {
                             mesh.position.set(car.lotPosition.x, 0, car.lotPosition.z);
                             mesh.rotation.y = car.lotPosition.r;
                        } else {
                             // Random spot in Delivery Drop-off Zone instead of fixed overlapping idx coords
                             const xPos = -30 + (Math.random() * 8 - 4);
                             const zPos = (Math.random() * 12 - 6);
                             mesh.position.set(xPos, 0.02, zPos);
                        }
                        
                        scene.add(mesh);
                        carMeshes[car.id] = mesh;
                        carBodies[car.id] = assets.body;
                        if (assets.smokeParticles) carSmokes[car.id] = assets.smokeParticles;
                        carWheels[car.id] = assets.wheels;
                        carSteering[car.id] = assets.frontPivots;
                        vehiclePhysics[car.id] = { v: 0, yaw: 0 };
                    }

                    // dynamic state update
                    const body = carBodies[car.id];
                    if (body) {
                        const mat = body.material as THREE.MeshPhysicalMaterial;
                        if (car.isDirty) {
                            if (mat.roughness !== 1.0) {
                                mat.color.set('#5c4033'); // Farm thick mud!
                                mat.clearcoat = 0;
                                mat.roughness = 1.0;
                            }
                        } else {
                            let origC = car.color || '#ffffff';
                            if (origC === 'Trade-In Silver') origC = '#C0C0C0';
                            if (mat.roughness !== 0.2) {
                                try { mat.color.set(origC); } catch {}
                                mat.clearcoat = 1.0;
                                mat.roughness = 0.2;
                            }
                        }
                    }
                    // AI Pathing Spawn Subroutine
                    if (car.hasOffer && !aiBots[car.id]) {
                        const botGeo = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
                        const botMat = new THREE.MeshStandardMaterial({ color: '#10b981' });
                        const bMesh = new THREE.Mesh(botGeo, botMat);
                        bMesh.position.set(0, 1, 40); // Spawn at perimeter gate
                        bMesh.castShadow = true;
                        
                        const visorGeo = new THREE.BoxGeometry(0.8, 0.3, 0.6);
                        const visorMat = new THREE.MeshStandardMaterial({ color: '#fbbf24', emissive: '#fbbf24', emissiveIntensity: 0.5 });
                        const visor = new THREE.Mesh(visorGeo, visorMat);
                        visor.position.set(0, 0.4, 0.3);
                        bMesh.add(visor);

                        const group = new THREE.Group();
                        group.add(bMesh);
                        const lotX = me?.lotPosition?.x || 0;
                        const lotZ = me?.lotPosition?.z || 0;
                        group.position.set(lotX + (Math.random() * 20 - 10), 1, lotZ + 40); // Distributed slightly relative to lot
                        scene.add(group);

                        aiBots[car.id] = { mesh: group, targetPos: carMeshes[car.id].position.clone(), status: 'walking_in' };
                    } else if (!car.hasOffer && aiBots[car.id] && aiBots[car.id].status !== 'walking_out') {
                        // Offer accepted or declined, customer leaves!
                        aiBots[car.id].status = 'walking_out';
                        aiBots[car.id].targetPos = new THREE.Vector3(Math.random() * 20 - 10, 1, 45);
                    }
                });

                // Detect sold cars that no longer exist in inventory array
                Object.keys(aiBots).forEach(key => {
                    const carExists = me.inventory.some(c => c.id === key);
                    if (!carExists && aiBots[key].status !== 'walking_out') {
                        aiBots[key].status = 'walking_out';
                        aiBots[key].targetPos = new THREE.Vector3(Math.random() * 20 - 10, 1, 45);
                    }
                });

                // Clean up 3D meshes for sold cars
                Object.keys(carMeshes).forEach(carId => {
                    const carExists = me.inventory.some(c => c.id === carId);
                    if (!carExists) {
                        const mesh = carMeshes[carId];
                        scene.remove(mesh);
                        mesh.traverse((child: any) => {
                            if (child.isMesh) {
                                child.geometry?.dispose();
                                child.material?.dispose();
                            }
                        });
                        delete carMeshes[carId];
                    }
                });
            }

            // Passive Automatic Car Wash
            if (me) {
                me.inventory.forEach(car => {
                    const m = carMeshes[car.id];
                    if (!m) return;
                    
                    // Wash Bay Zone (x: 55, z: -40, radius: 10)
                    const inWashBay = Math.abs(m.position.x - ((me?.lotPosition?.x || 0) + 55)) < 10 && Math.abs(m.position.z - ((me?.lotPosition?.z || 0) - 40)) < 10;
                    
                    if (inWashBay && car.isDirty) {
                        if (!m.userData.isWashing) {
                            m.userData.isWashing = true;
                            // Add a visual burst of water particles (mocked with scaling for now)
                            m.scale.setScalar(1.05);
                            setTimeout(() => { if (m) m.scale.setScalar(1.0); }, 500);
                            
                            useGameStore.getState().washCar(car.id);
                        }
                    } else if (!car.isDirty && m.userData.isWashing) {
                        m.userData.isWashing = false;
                    }
                });
            }

            // Farming Simulator Physical Interactions
            if (rJustPressed && me) {
                 const pPos = localDrivingCarId ? carMeshes[localDrivingCarId].position : avatar.position;
                 me.inventory.forEach(car => {
                      if (localDrivingCarId && car.id !== localDrivingCarId) return;

                      const m = carMeshes[car.id];
                      if (!m) return;
                      // Allow 20 unit distance for interaction to make it easier for big cars
                      if (pPos.distanceTo(m.position) < 20) {
                          // Removed wash bay logic from manual interaction block
                          // Mechanic Garage Zone
                          if (Math.abs(pPos.x - ((me?.lotPosition?.x || 0) + 55)) < 25 && Math.abs(pPos.z - ((me?.lotPosition?.z || 0) + 5)) < 25) {
                              keys.e = false; keys.r = false; eWasPressed = false; rWasPressed = false;
                              useGameStore.getState().openInspectionModal(car.id, 'mechanic');
                          }
                          // Body Shop Zone
                          if (Math.abs(pPos.x - ((me?.lotPosition?.x || 0) + 55)) < 25 && Math.abs(pPos.z - ((me?.lotPosition?.z || 0) + 50)) < 25) {
                              keys.e = false; keys.r = false; eWasPressed = false; rWasPressed = false;
                              useGameStore.getState().openInspectionModal(car.id, 'body');
                          }
                          // Designated Parking Spaces (Show Lot)
                          // To park a car for sale, it must be clean, inside the designated x bounds and z > 10, and not already processed.
                          const lotX = me?.lotPosition?.x || 0;
                          const lotZ = me?.lotPosition?.z || 0;
                          if (Math.abs(pPos.x - lotX) < 12 && (pPos.z - lotZ) > 10) {
                              if (!car.isDirty && !car.isProcessed) {
                                  keys.e = false; keys.r = false; eWasPressed = false; rWasPressed = false;
                                  
                                  // Visual flash to confirm parking
                                  m.scale.setScalar(1.05);
                                  setTimeout(() => { if (m) m.scale.setScalar(1.0); }, 300);
                                  
                                  useGameStore.getState().placeOnLot(car.id);
                              }
                          }
                      }
                 });
            }
             // AI Customer Pathing & Autonomous Test Drive Physics
             const cpuSpeed = 8 * delta;
             const aiDriveSequence: Record<string, { state: 'out'|'back'|'done', startZ: number, startX: number }> = {};
             
             Object.entries(aiBots).forEach(([key, bot]) => {
                  const d = bot.mesh.position.distanceTo(bot.targetPos);
                  if (bot.status === 'walking_in') {
                      if (d > 4.0) {
                          const dir = bot.targetPos.clone().sub(bot.mesh.position).normalize();
                          bot.mesh.position.add(dir.multiplyScalar(cpuSpeed));
                          bot.mesh.children[0].position.y = 1 + Math.abs(Math.sin(Date.now() * 0.01)) * 0.2; // bobbing
                          bot.mesh.lookAt(bot.targetPos);
                      } else {
                          bot.status = 'waiting';
                          bot.mesh.children[0].position.y = 1; // reset bob
                      }
                  } else if (bot.status === 'waiting') {
                      bot.mesh.children[0].position.y = 1 + Math.sin(Date.now() * 0.005) * 0.1; // gentle breathing
                      bot.mesh.lookAt(bot.targetPos);
                      
                      // Exponential AI spontaneous paths to utilize roads
                      if (Math.random() < 0.002) {
                           bot.status = 'test_driving';
                           const goDeep = Math.random() > 0.5;
                           aiDriveSequence[key] = { state: 'out', startZ: carMeshes[key].position.z, startX: carMeshes[key].position.x, targetZ: goDeep ? 600 : 250 };
                      }
                  } else if (bot.status === 'test_driving') {
                      bot.mesh.visible = false;
                      const car = carMeshes[key];
                      const seq = aiDriveSequence[key] as any;
                      if (car && seq) {
                           if (seq.state === 'out') {
                                // Drive down the road
                                car.position.z += 40 * delta; // Faster AI driving
                                car.rotation.y = 0; // Fixed south
                                const localWheels = carWheels[key];
                                if (localWheels) localWheels.forEach(w => w.rotateX(-40 * delta * 0.5));
                                if (car.position.z > seq.targetZ) seq.state = 'back';
                           } else if (seq.state === 'back') {
                                // Return to dealership
                                car.position.z -= 40 * delta;
                                car.rotation.y = Math.PI; // Fixed north
                                const localWheels = carWheels[key];
                                if (localWheels) localWheels.forEach(w => w.rotateX(-40 * delta * 0.5));
                                if (car.position.z < seq.startZ + 5) {
                                    // Seamless auto-park!
                                    car.position.z = seq.startZ;
                                    car.position.x = seq.startX;
                                    car.rotation.y = 0;
                                    bot.status = 'waiting';
                                    bot.mesh.visible = true;
                                    delete aiDriveSequence[key];
                                }
                           }
                      }
                  } else if (bot.status === 'walking_out') {
                      bot.mesh.visible = true; // In case they left from a test drive
                      if (bot.mesh.position.z < 42) {
                          const dir = bot.targetPos.clone().sub(bot.mesh.position).normalize();
                          bot.mesh.position.add(dir.multiplyScalar(cpuSpeed));
                          bot.mesh.children[0].position.y = 1 + Math.abs(Math.sin(Date.now() * 0.01)) * 0.2;
                          bot.mesh.lookAt(bot.targetPos);
                      } else {
                          // Destroy mesh memory on exit
                          scene.remove(bot.mesh);
                          delete aiBots[key];
                      }
                  }
             });

             // --- Dynamic Interaction Prompts ---
             interactPrompt.material.opacity = Math.max(0.0, interactPrompt.material.opacity - 0.1);
             if (!localDrivingCarId) {
                 let nearestCar: string | null = null;
                 let minD = 6.0;
                 Object.entries(carMeshes).forEach(([id, mesh]) => {
                      const dist = avatar.position.distanceTo(mesh.position);
                      if (dist < minD) { minD = dist; nearestCar = id; }
                 });

                 // Check distance to bank desk inside Capital Bank (40, 1.5, 130 world coords)
                 const bankWorldDesk = new THREE.Vector3(40, 1.5, 130);
                 const dDesk = avatar.position.distanceTo(bankWorldDesk);
                 
                 const auctionWorldKiosk = new THREE.Vector3(-60, 1, 205);
                 const dAuction = avatar.position.distanceTo(auctionWorldKiosk);

                  const activeInt = useGameStore.getState().activeInteraction;
                  if (dDesk < 12.0) {
                       interactPrompt.position.copy(bankWorldDesk).add(new THREE.Vector3(0, 3, 0));
                       interactPrompt.material.opacity = Math.min(1.0, interactPrompt.material.opacity + 0.2);
                       if (!activeInt || activeInt.type !== 'bank') {
                            useGameStore.getState().setActiveInteraction({ type: 'bank', label: 'Access Capital Bank' });
                       }
                       if (eJustPressed || rJustPressed) {
                            keys.e = false; keys.r = false; eWasPressed = false; rWasPressed = false;
                            useGameStore.getState().openBankModal();
                       }
                  } else if (dAuction < 15.0) {
                       interactPrompt.position.copy(auctionWorldKiosk).add(new THREE.Vector3(0, 3, 0));
                       interactPrompt.material.opacity = Math.min(1.0, interactPrompt.material.opacity + 0.2);
                       if (!activeInt || activeInt.type !== 'auction') {
                            useGameStore.getState().setActiveInteraction({ type: 'auction', label: 'Access Global Auction' });
                       }
                       if (eJustPressed || rJustPressed) {
                            keys.e = false; keys.r = false; eWasPressed = false; rWasPressed = false;
                            window.dispatchEvent(new CustomEvent('open_auction'));
                       }
                  } else if (nearestCar) {
                       interactPrompt.position.copy(carMeshes[nearestCar].position).add(new THREE.Vector3(0, 4, 0));
                       interactPrompt.material.opacity = Math.min(1.0, interactPrompt.material.opacity + 0.2);
                       if (!activeInt || activeInt.type !== 'car' || activeInt.carId !== nearestCar) {
                            useGameStore.getState().setActiveInteraction({ type: 'car', label: 'Drive Vehicle', carId: nearestCar });
                       }
                  } else {
                       if (activeInt !== null) {
                            useGameStore.getState().setActiveInteraction(null);
                       }
                  }
             } else {
                  const activeInt = useGameStore.getState().activeInteraction;
                  if (activeInt !== null) {
                       useGameStore.getState().setActiveInteraction(null);
                  }
                  const pPos = carMeshes[localDrivingCarId!].position;
                  const lotX = me?.lotPosition?.x || 0;
                  const lotZ = me?.lotPosition?.z || 0;
                  const inWashOrShop = (Math.abs(pPos.x - (lotX + 55)) < 25 && (Math.abs(pPos.z - (lotZ - 40)) < 25 || Math.abs(pPos.z - (lotZ + 5)) < 25 || Math.abs(pPos.z - (lotZ + 50)) < 25));
                  const inShowLot = (Math.abs(pPos.x - lotX) < 15 && (pPos.z - lotZ) > 10);
                  
                  if (inWashOrShop || inShowLot) {
                       interactPrompt.position.copy(pPos).add(new THREE.Vector3(0, 6, 0));
                       interactPrompt.material.opacity = Math.min(1.0, interactPrompt.material.opacity + 0.2);
                  }
             }

            // Custom Realistic Driving Physics Engine
            if (localDrivingCarId) {
                avatar.visible = false;
                const activeCar = carMeshes[localDrivingCarId];
                const phys = vehiclePhysics[localDrivingCarId];
                
                if (activeCar && phys) {
                    const acc = 25 * delta;
                    const drag = 15 * delta;
                    const maxV = 120; // Vastly higher top speed for the open world

                    // Throttle with exponential multiplier based on current velocity!
                    if (keys.w) {
                         let tempAcc = acc;
                         if (phys.v < 0) tempAcc = acc * 3; // Triple braking power against reverse momentum
                         else tempAcc = acc * (1.0 + (phys.v / 20.0)); // exponential speed scale
                         phys.v = Math.min(phys.v + tempAcc, maxV);
                    }
                    else if (keys.s) {
                         let tempAcc = acc * 2;
                         if (phys.v > 0) tempAcc = acc * 4; // Quadruple braking power against forward momentum
                         phys.v = Math.max(phys.v - tempAcc, -maxV / 3);
                    }
                    else {
                         // Friction drag
                         if (phys.v > 0) phys.v = Math.max(0, phys.v - drag);
                         else if (phys.v < 0) phys.v = Math.min(0, phys.v + drag);
                    }

                    // Steering changes based on speed (stiffer steering at high speed to prevent spinning out)
                    let angularVel = 1.5 * delta;
                    if (phys.v > 40) angularVel *= (40 / phys.v); 
                    
                    const isMoving = Math.abs(phys.v) > 0.1;
                    let targetYaw = 0;
                    
                    if (keys.a) targetYaw = Math.PI / 6 * (angularVel / (1.5 * delta));
                    if (keys.d) targetYaw = -Math.PI / 6 * (angularVel / (1.5 * delta));

                    // Interpolate wheel yaw
                    phys.yaw += (targetYaw - phys.yaw) * 0.1;
                    
                    const steeringPivots = carSteering[localDrivingCarId!];
                    if (steeringPivots) steeringPivots.forEach(p => p.rotation.y = phys.yaw);

                    // Store previous matrix state
                    const prevPos = activeCar.position.clone();
                    const prevQuat = activeCar.quaternion.clone();

                    // Apply yaw to vehicle ONLY if moving
                    if (isMoving) {
                        activeCar.rotateY(phys.yaw * phys.v * 0.05 * delta);
                    }

                    // Apply velocity translation
                    activeCar.translateZ(-phys.v * delta);
                    activeCar.updateMatrixWorld(true);

                    // Use multi-sphere intersection to permanently eliminate diagonal AABB bloat
                    const r = 1.6; // Sphere radius (fitting within car width)
                    const spheres = [
                        activeCar.position.clone().add(new THREE.Vector3(0, 0, 3.2).applyQuaternion(activeCar.quaternion)),
                        activeCar.position.clone(),
                        activeCar.position.clone().add(new THREE.Vector3(0, 0, -3.2).applyQuaternion(activeCar.quaternion))
                    ];
                    
                    let wallCollided = false;
                    const closestPoint = new THREE.Vector3();
                    staticCollisionBoxes.forEach(sBox => {
                        spheres.forEach(sphereCenter => {
                            sBox.clampPoint(sphereCenter, closestPoint);
                            if (closestPoint.distanceToSquared(sphereCenter) < r * r) {
                                wallCollided = true;
                            }
                        });
                    });
                    
                    if (wallCollided) {
                         activeCar.position.copy(prevPos);
                         activeCar.quaternion.copy(prevQuat);
                         phys.v = -phys.v * 0.5; // Bounce gracefully off the static wall
                    }

                    // Revolve all 4 wheels based on velocity (pitch)
                    const localWheels = carWheels[localDrivingCarId!];
                    if (localWheels) {
                        localWheels.forEach(w => w.rotateX(-phys.v * delta * 0.5));
                    }

                    // Camera follow
                    const camOffset = new THREE.Vector3(0, 6, 18).applyQuaternion(activeCar.quaternion);
                    camera.position.lerp(activeCar.position.clone().add(camOffset), 0.1);
                    camera.lookAt(activeCar.position);

                    // Periodically sync physical position with server
                    if (Math.random() < 0.05) {
                         const store = useGameStore.getState() as any;
                         if (store.socket) {
                              store.socket.emit('sync_car_pos', { 
                                  carId: localDrivingCarId, 
                                  position: { x: activeCar.position.x, z: activeCar.position.z, r: activeCar.rotation.y } 
                              });
                         }
                    }
                }
            } else {
                avatar.visible = true;
                // Avatar Physics with Orthogonal Sliding and Shaved AABBs
                const walkSpeed = 15 * delta;
                const walkRotSpeed = 3 * delta;

                const moveVec = new THREE.Vector3();
                if (keys.w) moveVec.add(new THREE.Vector3(0, 0, -walkSpeed));
                if (keys.s) moveVec.add(new THREE.Vector3(0, 0, walkSpeed));
                moveVec.applyQuaternion(avatar.quaternion);

                // Avatar Box size reduced to prevent getting stuck
                const avatarSz = new THREE.Vector3(0.6, 2, 0.6);

                // X-Axis Movement Try
                if (Math.abs(moveVec.x) > 0.001) {
                    const tryX = avatar.position.clone();
                    tryX.x += moveVec.x;
                    const boxX = new THREE.Box3().setFromCenterAndSize(tryX.clone().add(new THREE.Vector3(0, 1, 0)), avatarSz);
                    let hitX = false;
                    Object.values(carMeshes).forEach(carMesh => {
                        const cP = carMesh.position;
                        const fP = cP.clone().add(new THREE.Vector3(0, 0, 3.0).applyQuaternion(carMesh.quaternion));
                        const bP = cP.clone().add(new THREE.Vector3(0, 0, -3.0).applyQuaternion(carMesh.quaternion));
                        if (tryX.distanceTo(cP) < 2.2 || tryX.distanceTo(fP) < 2.2 || tryX.distanceTo(bP) < 2.2) hitX = true;
                    });
                    staticCollisionBoxes.forEach(sBox => {
                        if (boxX.intersectsBox(sBox)) hitX = true;
                    });
                    if (!hitX) avatar.position.x = tryX.x;
                }

                // Z-Axis Movement Try
                if (Math.abs(moveVec.z) > 0.001) {
                    const tryZ = avatar.position.clone();
                    tryZ.z += moveVec.z;
                    const boxZ = new THREE.Box3().setFromCenterAndSize(tryZ.clone().add(new THREE.Vector3(0, 1, 0)), avatarSz);
                    let hitZ = false;
                    Object.values(carMeshes).forEach(carMesh => {
                        const cP = carMesh.position;
                        const fP = cP.clone().add(new THREE.Vector3(0, 0, 3.0).applyQuaternion(carMesh.quaternion));
                        const bP = cP.clone().add(new THREE.Vector3(0, 0, -3.0).applyQuaternion(carMesh.quaternion));
                        if (tryZ.distanceTo(cP) < 2.2 || tryZ.distanceTo(fP) < 2.2 || tryZ.distanceTo(bP) < 2.2) hitZ = true;
                    });
                    staticCollisionBoxes.forEach(sBox => {
                        if (boxZ.intersectsBox(sBox)) hitZ = true;
                    });
                    if (!hitZ) avatar.position.z = tryZ.z;
                }
                
                if (keys.a) avatar.rotateY(walkRotSpeed);
                if (keys.d) avatar.rotateY(-walkRotSpeed);

                const camOffset = new THREE.Vector3(0, 4, 10).applyQuaternion(avatar.quaternion);
                camera.position.lerp(avatar.position.clone().add(camOffset), 0.15);
                camera.lookAt(avatar.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
            }

            // --- MULTIPLAYER POSITION SYNC ---
            if (current.playerId && useGameStore.getState().socket && (time - lastPosEmitTime > 0.1)) {
                lastPosEmitTime = time;
                const activeMesh = (isDriving && localDrivingCarId && carMeshes[localDrivingCarId]) ? carMeshes[localDrivingCarId] : avatar;
                useGameStore.getState().socket?.emit('sync_player_pos', { 
                    x: activeMesh.position.x, 
                    y: activeMesh.position.y, 
                    z: activeMesh.position.z, 
                    rotation: activeMesh.rotation.y 
                });
            }

            if (current.gameState && current.gameState.players) {
                const activeIds = new Set(Object.keys(current.gameState.players));
                Object.keys(otherPlayerMeshes).forEach(id => {
                    if (!activeIds.has(id) || id === current.playerId) {
                        scene.remove(otherPlayerMeshes[id]);
                        delete otherPlayerMeshes[id];
                    }
                });

                Object.values(current.gameState.players).forEach(p => {
                    if (!builtDealerships.has(p.id) && p.lotPosition) {
                        createDealership(p.lotPosition.x, p.lotPosition.z, p.id);
                        builtDealerships.add(p.id);
                    }
                    if (p.id === current.playerId || !p.worldPosition) return;
                    
                    let meshGroup = otherPlayerMeshes[p.id];
                    if (!meshGroup) {
                        meshGroup = new THREE.Group();
                        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 4, 8), new THREE.MeshStandardMaterial({ color: '#f59e0b' }));
                        body.position.y = 1; body.castShadow = true; meshGroup.add(body);
                        const vis = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.6), new THREE.MeshStandardMaterial({ color: '#d97706' }));
                        vis.position.set(0, 1.4, 0.3); meshGroup.add(vis);
                        
                        const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                            ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0,0,256,64);
                            ctx.fillStyle = '#ffffff'; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(p.name, 128, 42);
                        }
                        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
                        sprite.position.y = 2.5; sprite.scale.set(3, 0.75, 1); meshGroup.add(sprite);

                        scene.add(meshGroup);
                        otherPlayerMeshes[p.id] = meshGroup;
                    }
                    meshGroup.position.lerp(new THREE.Vector3(p.worldPosition.x, p.worldPosition.y, p.worldPosition.z), 0.2);
                    meshGroup.quaternion.slerp(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), p.worldPosition.rotation), 0.2);
                });
            }
            
            renderer.render(scene, camera);
        };
        
        animate(); // Kick off

        // Cleanup
        return () => {
            cancelAnimationFrame(animationFrameId);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            mountRef.current?.removeChild(renderer.domElement);
            renderer.dispose();
            
            // Dispose procedural city materials & textures
            cityMaterials.forEach(m => m.dispose());
            cityTextures.forEach(t => t.dispose());
            
            Object.values(carMeshes).forEach(group => {
               group.traverse(child => {
                   if (child instanceof THREE.Mesh) {
                       child.geometry?.dispose();
                       if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                       else child.material?.dispose();
                   }
               });
            });
            
            environmentDisposables.forEach(obj => {
                if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
                    if (obj.geometry) obj.geometry.dispose();
                    if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                    else if (obj.material) obj.material.dispose();
                } else if (obj instanceof THREE.Light) {
                    obj.dispose();
                } else if (obj instanceof THREE.Group) {
                    obj.traverse(child => {
                        if (child instanceof THREE.Mesh) {
                           child.geometry?.dispose();
                           if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                           else child.material?.dispose();
                        }
                    });
                }
            });
            
            avatarGeo.dispose();
            avatarMat.dispose();
        };
    }, []);

    return <div ref={mountRef} className="absolute inset-0 z-[0] pointer-events-auto overflow-hidden" />;
}
