import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useGameStore } from './store';
import { LightPool } from './scene/lightPool';
import { batchStatic } from './scene/staticBatcher';
import { damp, disposeObject } from './scene/utils';
import { generateEnvMap } from './scene/textures';
import { applyCarPaint, buildCarModel, carColorHex, deriveStyle } from './scene/carModel';
import { driveTuning, getCarSpec, UNITS_PER_MPH, type DriveTuning } from './carSpecs';
import { createWorldContext } from './scene/world/context';
import { createFenceKit } from './scene/world/fences';
import { createFurnitureKit } from './scene/world/furniture';
import { buildCity } from './scene/world/city';
import { buildSpeedway } from './scene/world/speedway';
import { createDealership, type DealershipGate } from './scene/world/dealership';

export function VanillaThreeScene() {
    const mountRef = useRef<HTMLDivElement>(null);

    // The render loop reads game state through this ref. It's kept current by a
    // direct store subscription, so this component never re-renders (it used to
    // re-render on every store change — fuel, race HUD, GPS — many times a second).
    const stateRef = useRef({ gameState: useGameStore.getState().gameState, playerId: useGameStore.getState().playerId });
    useEffect(() => useGameStore.subscribe(st => {
        const cur = stateRef.current;
        if (st.gameState !== cur.gameState || st.playerId !== cur.playerId) {
            stateRef.current = { gameState: st.gameState, playerId: st.playerId };
        }
    }), []);

    useEffect(() => {
        if (!mountRef.current) return;
        
        // --- 1. Core Scene Setup ---
        const scene = new THREE.Scene();
        
        const envTexture = generateEnvMap();
        scene.environment = envTexture; // Bind reflection map
        scene.background = new THREE.Color('#87ceeb'); // Bright Sky blue
        scene.fog = new THREE.Fog('#87ceeb', 1500, 6000); // pushed way out so the giant speedway is visible across the infield

        // Far plane just past the fog's end (6000): anything further is fully fogged
        // anyway. A near plane of 2 keeps a normal depth buffer precise enough that
        // the layered ground (grass / track / curbs) doesn't flicker — the logarithmic
        // depth buffer used before stopped the GPU from skipping hidden pixels.
        const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 2, 6500);

        let renderer: THREE.WebGLRenderer;
        try {
            renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
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
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // crisper on hi-DPI without tanking perf
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        mountRef.current.appendChild(renderer.domElement);


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

        // Small fixed pool of real lights that follows the player around the lamps
        // (see lightPool.ts). Every lamp below registers a light *source* instead of
        // adding its own PointLight.
        const lightPool = new LightPool(scene, 8);
        const addLightSource = (x: number, y: number, z: number, color: string, intensity: number, distance: number, nightOnly: boolean) =>
            lightPool.add({ position: new THREE.Vector3(x, y, z), color, intensity, distance, nightOnly });

        // --- 3. World ---
        // The builders live in ./scene/world; they share this context (scene,
        // collision boxes, cleanup lists, common materials).
        const world = createWorldContext(scene, addLightSource);
        const { environmentDisposables, staticCollisionBoxes, cityMaterials, cityTextures, emissiveFacadeMaterials } = world;
        const fences = createFenceKit(world);
        const furniture = createFurnitureKit(world.makeGlass);

        // Everything added to the scene from here until the world is finished is
        // static scenery that gets merged into a few big meshes (see batchStatic).
        const worldStartIndex = scene.children.length;
        const { libraryWorldPos, insuranceWorldPos, gasPumps } = buildCity(world, furniture);
        const { RACE_CX, RACE_CZ, RC, raceStartPos, raceStartRotY, raceCheckpoints, rentalKioskPos, itemBoxes, itemBoxGeo, qTex } = buildSpeedway(world);

        // Driveway gates of every dealership built so far. The owner's opens from
        // the inside automatically and from the outside after the gate code.
        const dealershipGates: DealershipGate[] = [];
        const builtDealerships = new Set<string>();


        // race/fuel state consumed by the render loop
        let localFuel: number | null = null;     // tank of the car currently being driven
        let refuelRequestedIn: object | null = null; // game state seen when R was pressed at a pump (refuel pending)
        let fuelUiAccum = 0, fuelNetAccum = 0;    // throttle the HUD write and the server sync
        let raceActive = false, raceState = '', raceDifficulty = '', raceLapTarget = 0, raceLaps = 0, raceCpIndex = 0;
        let raceStartMs = 0, raceCountdownUntil = 0, raceHudAccum = 0;
        // CPU racing opponents
        type CpuRacer = { mesh: THREE.Group; angleDeg: number; startAngDeg: number; lane: number; speedDegPerSec: number; finished: boolean };
        let cpuRacers: CpuRacer[] = [];
        let cpuFinishCount = 0, racePlace = 1;
        const clearCpuRacers = () => { cpuRacers.forEach(c => disposeObject(c.mesh)); cpuRacers = []; };
        let boostUntil = 0, starUntil = 0, spinUntil = 0; // boost / invincible-star / spin-out timers
        const bananas: { mesh: THREE.Mesh; expireAt: number; alive: boolean }[] = [];   // dropped peel hazards
        const shells: { mesh: THREE.Mesh; dir: THREE.Vector3; expireAt: number; alive: boolean }[] = []; // fired shells
        const bananaGeo = new THREE.SphereGeometry(1.4, 8, 6);
        const bananaMat = new THREE.MeshStandardMaterial({ color: '#facc15', emissive: '#a16207', emissiveIntensity: 0.3, roughness: 0.5 });
        const shellGeo = new THREE.SphereGeometry(1.7, 12, 10);
        const shellMat = new THREE.MeshStandardMaterial({ color: '#22c55e', emissive: '#16a34a', emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.4 });
        // Take spent bananas/shells out of the scene instead of just hiding them forever.
        const pruneProjectiles = () => {
            for (const list of [bananas, shells] as { mesh: THREE.Mesh; alive: boolean }[][]) {
                for (let i = list.length - 1; i >= 0; i--) {
                    if (!list[i].alive) { scene.remove(list[i].mesh); list.splice(i, 1); }
                }
            }
        };
        const dropBanana = (car: THREE.Object3D) => {
            const back = new THREE.Vector3(0, 0, 6).applyQuaternion(car.quaternion); // behind the car
            const m = new THREE.Mesh(bananaGeo, bananaMat);
            m.position.copy(car.position).add(back); m.position.y = 1.2; m.scale.set(1.1, 0.7, 1.5); m.castShadow = true;
            scene.add(m); // geometry/material are shared and disposed on unmount
            bananas.push({ mesh: m, expireAt: performance.now() + 30000, alive: true });
        };
        const fireShell = (car: THREE.Object3D) => {
            const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(car.quaternion); // car forward
            const m = new THREE.Mesh(shellGeo, shellMat);
            m.position.copy(car.position).add(fwd.clone().multiplyScalar(9)); m.position.y = 1.6; m.castShadow = true;
            scene.add(m); // geometry/material are shared and disposed on unmount
            shells.push({ mesh: m, dir: fwd, expireAt: performance.now() + 4000, alive: true });
        };

        // Merge all the static city scenery built above into a handful of meshes
        // (one per distinct material) — thousands of draw calls become dozens.
        // Collision boxes are already computed, so the originals can go.
        const keepUniqueMaterials = new Set<THREE.Material>(emissiveFacadeMaterials);
        const batchWorld = (objects: THREE.Object3D[]) => {
            batchStatic(objects, { parent: scene, keepUnique: keepUniqueMaterials }).forEach(m => environmentDisposables.push(m));
        };
        batchWorld(scene.children.slice(worldStartIndex));

        // --- 4. Dynamic Objects ---
        const carMeshes: Record<string, THREE.Group> = {};
        const carBodies: Record<string, THREE.Mesh> = {};
        const carSmokes: Record<string, THREE.Points> = {};
        const carWheels: Record<string, THREE.Mesh[]> = {};
        const carSteering: Record<string, THREE.Group[]> = {};
        const vehiclePhysics: Record<string, { v: number, yaw: number }> = {};
        // Per-car handling from real specs (src/carSpecs.ts), recomputed only when the car's
        // model or mechanical condition changes.
        const tuningCache: Record<string, { key: string; t: DriveTuning }> = {};
        const tuningFor = (car: { id: string; make?: string; model?: string; bodyStyle?: string; mechanicCondition?: number } | undefined): DriveTuning => {
            const style = (car as any)?.bodyStyle || deriveStyle(car?.model || '');
            const mech = Math.round(car?.mechanicCondition ?? 100);
            const key = `${car?.make}|${car?.model}|${style}|${mech}`;
            const id = car?.id || '?';
            const hit = tuningCache[id];
            if (hit && hit.key === key) return hit.t;
            const t = driveTuning(getCarSpec({ make: car?.make, model: car?.model, bodyStyle: style }, style), style, mech);
            tuningCache[id] = { key, t };
            return t;
        };
        
        type BotState = { mesh: THREE.Group, targetPos: THREE.Vector3, status: 'walking_in' | 'waiting' | 'walking_out' | 'test_driving' };
        const aiBots: Record<string, BotState> = {}; // Mapped by target car ID
        // Customer test drives in progress, by car ID: a list of waypoints the car
        // drives through (out the gate, down the road, back, and into its spot).
        const aiDriveSequence: Record<string, { waypoints: THREE.Vector3[]; index: number; startRotY: number }> = {};
        const AI_DRIVE_SPEED = 40;
        
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
        const uiTex = new THREE.CanvasTexture(uiCanvas);
        // Redraws the floating label only when its text changes, so it always names
        // the action you can actually take (it used to say "[E] ENTER/EXIT | [R]
        // INTERACT" everywhere, while the on-screen prompt said something else).
        let promptText = '';
        const setPromptText = (text: string) => {
            if (!uiCtx || text === promptText) return;
            promptText = text;
            uiCtx.clearRect(0, 0, 512, 128);
            uiCtx.fillStyle = '#10b981';
            uiCtx.beginPath();
            if (uiCtx.roundRect) uiCtx.roundRect(0, 0, 512, 128, 20); else uiCtx.rect(0, 0, 512, 128);
            uiCtx.fill();
            uiCtx.fillStyle = '#ffffff'; uiCtx.textAlign = 'center';
            let size = 52;
            do { uiCtx.font = `bold ${size}px sans-serif`; size -= 2; } while (uiCtx.measureText(text).width > 480 && size > 24);
            uiCtx.fillText(text, 256, 82);
            uiTex.needsUpdate = true;
        };
        setPromptText('[E] DRIVE');
        const uiMat = new THREE.SpriteMaterial({ map: uiTex, transparent: true, opacity: 0, depthTest: false });
        const interactPrompt = new THREE.Sprite(uiMat);
        interactPrompt.scale.set(3.4, 0.85, 1);
        interactPrompt.renderOrder = 999;
        scene.add(interactPrompt);
        environmentDisposables.push(interactPrompt);

        // --- Graphics quality (Low/High toggle in the HUD) ---
        // Low: no shadows and 1x resolution — a big saving on phones and laptops.
        const pixelRatioFor = (q: 'high' | 'low') => q === 'low' ? 1 : Math.min(window.devicePixelRatio, 2);
        const applyGraphics = (q: 'high' | 'low', recompile: boolean) => {
             renderer.setPixelRatio(pixelRatioFor(q));
             renderer.shadowMap.enabled = q === 'high';
             dirLight.castShadow = q === 'high';
             // Free the 2048x2048 sun shadow map while shadows are off; three.js
             // re-creates it the next time the light casts shadows.
             if (q === 'low' && dirLight.shadow.map) {
                 dirLight.shadow.map.dispose();
                 dirLight.shadow.map = null;
             }
             if (recompile) {
                 // Shaders are built with or without shadow code, so rebuild them once
                 scene.traverse(o => {
                     const mat = (o as THREE.Mesh).material;
                     if (mat) (Array.isArray(mat) ? mat : [mat]).forEach(m => { m.needsUpdate = true; });
                 });
             }
        };
        applyGraphics(useGameStore.getState().graphicsQuality, false);
        const unsubscribeGraphics = useGameStore.subscribe((st, prev) => {
             if (st.graphicsQuality !== prev.graphicsQuality) applyGraphics(st.graphicsQuality, true);
        });

        // --- Resize handling ---
        const handleResize = () => {
             camera.aspect = window.innerWidth / window.innerHeight;
             camera.updateProjectionMatrix();
             renderer.setSize(window.innerWidth, window.innerHeight);
             renderer.setPixelRatio(pixelRatioFor(useGameStore.getState().graphicsQuality));
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
            // Don't drive the player while the user is typing (chat box, code entry, etc.).
            const el = document.activeElement as HTMLElement | null;
            const tag = (el?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return;
            const key = e.key.toLowerCase();
            if (key === 'w' || e.key === 'ArrowUp') keys.w = true;
            if (key === 'a' || e.key === 'ArrowLeft') keys.a = true;
            if (key === 's' || e.key === 'ArrowDown') keys.s = true;
            if (key === 'd' || e.key === 'ArrowRight') keys.d = true;
            if (key === 'e') keys.e = true;
            if (key === 'r') keys.r = true;
            if (key === ' ' || e.code === 'Space') { e.preventDefault(); (window as any).useItemTap = true; } // deploy held item
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
        // Release every key when the window loses focus (alt-tab, clicking another
        // app) — otherwise the key-up is never seen and the car keeps driving.
        const releaseAllKeys = () => { (Object.keys(keys) as (keyof typeof keys)[]).forEach(k => { keys[k] = false; }); };
        const handleVisibility = () => { if (document.hidden) releaseAllKeys(); };
        window.addEventListener('blur', releaseAllKeys);
        document.addEventListener('visibilitychange', handleVisibility);

        // --- Game Loop ---
        const clock = new THREE.Clock();
        let animationFrameId: number;
        let localDrivingCarId: string | null = null; // Localized driving state!
        let hasInitializedSpawn = false;
        let lastPosEmitTime = 0;
        let lastRenderedTime = -1; // Throttle time of day updates

        // Secured gate state. React calls window.__authorizeGate() after a correct
        // code entry, which opens the gate from the outside for a short window.
        let gateAuthorizedUntil = 0;
        let gateExitGraceUntil = 0;
        let lastGateKeypad = false;
        (window as any).__authorizeGate = () => { gateAuthorizedUntil = performance.now() + 9000; };

        // Sky palette + scratch colour reused every update (no per-frame allocations)
        const SKY_MORNING = new THREE.Color('#fcd34d');
        const SKY_NOON = new THREE.Color('#60a5fa');
        const SKY_EVENING = new THREE.Color('#f97316');
        const SKY_NIGHT = new THREE.Color('#0f172a');
        const skyColor = new THREE.Color('#87ceeb');
        scene.background = skyColor;
        let nightFactor = 0;          // 0 = daylight, 1 = full night (drives the lamps)
        let lastServerTime = -1;      // last clock value received from the server
        let localTime = 8;            // smoothly advanced between the server's 1-second ticks

        const applyTimeOfDay = (t: number) => {
            // Progress from 8.0 to 20.0 (0.0 to 1.0)
            const progress = Math.max(0, Math.min(1, (t - 8) / 12));

            // Sun trajectory (East to West arc)
            const sunHeight = Math.sin(progress * Math.PI) * 400 + 10;
            const sunX = Math.cos(progress * Math.PI) * 500;
            dirLight.position.set(sunX, sunHeight, -100);

            // Fade Sun and Ambient Light as evening approaches (progress > 0.7)
            const fade = progress > 0.7 ? 1 - ((progress - 0.7) / 0.3) : 1; // 1.0 until 0.7, 0.0 at 1.0
            dirLight.intensity = 2.5 * fade;
            ambientLight.intensity = progress > 0.7 ? 0.7 * fade + 0.1 : 0.7; // Never fully pitch black
            nightFactor = 1 - fade; // street lamps fade in as the sun goes down

            // Fade up skyscraper window emissive glow at night
            const glowIntensity = 0.15 + 1.25 * nightFactor;
            emissiveFacadeMaterials.forEach(m => m.emissiveIntensity = glowIntensity);

            // Sky color lerping (Morning -> Noon -> Evening -> Night)
            if (progress < 0.3) skyColor.lerpColors(SKY_MORNING, SKY_NOON, progress / 0.3);
            else if (progress < 0.7) skyColor.lerpColors(SKY_NOON, SKY_EVENING, (progress - 0.3) / 0.4);
            else skyColor.lerpColors(SKY_EVENING, SKY_NIGHT, (progress - 0.7) / 0.3);
            if (scene.fog) (scene.fog as THREE.Fog).color.copy(skyColor);
        };

        // Buildings you can walk up to and use. Defined once (the old code rebuilt
        // these positions every frame).
        const buildingStops = [
            { pos: new THREE.Vector3(40, 1.5, 130), range: 12, yOff: 3, type: 'bank' as const, label: 'Access Capital Bank', prompt: '[R] CAPITAL BANK', open: () => useGameStore.getState().openBankModal() },
            { pos: new THREE.Vector3(-60, 1, 205), range: 15, yOff: 3, type: 'auction' as const, label: 'Access Global Auction', prompt: '[R] GLOBAL AUCTION', open: () => { window.dispatchEvent(new CustomEvent('open_auction')); } },
            { pos: libraryWorldPos, range: 11, yOff: 3, type: 'library' as const, label: 'Browse the Library', prompt: '[R] LIBRARY', open: () => { window.dispatchEvent(new CustomEvent('open_library')); } },
            { pos: insuranceWorldPos, range: 11, yOff: 3, type: 'insurance' as const, label: 'Apex Mutual Insurance', prompt: '[R] INSURANCE', open: () => useGameStore.getState().openInsuranceModal() },
            { pos: rentalKioskPos, range: 12, yOff: 4, type: 'rental' as const, label: 'Rent Race Car ($1,500)', prompt: '[R] RENT RACE CAR', open: () => useGameStore.getState().rentRaceCar() },
        ];

        // Scratch objects reused every frame (allocating new vectors each frame causes GC stutter)
        const tmpPrevPos = new THREE.Vector3();
        const tmpPrevQuat = new THREE.Quaternion();
        const tmpClosest = new THREE.Vector3();
        const tmpCam = new THREE.Vector3();
        const tmpLook = new THREE.Vector3();
        const tmpMove = new THREE.Vector3();
        const tmpFwd = new THREE.Vector3();
        const tmpTarget = new THREE.Vector3();
        const tmpQuat = new THREE.Quaternion();
        const UP = new THREE.Vector3(0, 1, 0);
        // True heading of a car or the avatar. Both turn with rotateY, and past ±90° the
        // default XYZ Euler flips to x = z = ±π, y = π − heading, so rotation.y alone is wrong.
        const tmpEuler = new THREE.Euler();
        const headingOf = (o: THREE.Object3D) => tmpEuler.setFromQuaternion(o.quaternion, 'YXZ').y;
        const tmpAvatarBox = new THREE.Box3();
        const carSpheres = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
        let carSyncAccum = 0;

        const animate = () => {
            animationFrameId = requestAnimationFrame(animate);
            const time = Date.now() * 0.001;
            // Clamp so a long pause (tab switch, breakpoint) doesn't fling the car across the map
            const delta = Math.min(clock.getDelta(), 0.1);

            // Animate smoke particles (speeds are per second, so they match on any refresh rate)
            const smokeRise = 3 * delta, smokeWaver = 3 * delta;
            Object.values(carSmokes).forEach(smoke => {
                if (!smoke || !smoke.visible) return; // skip healthy cars (smoke hidden)
                const positions = smoke.geometry.attributes.position.array as Float32Array;
                for (let i = 0; i < positions.length; i += 3) {
                    positions[i + 1] += smokeRise; // move Y up
                    positions[i] += (Math.random() - 0.5) * smokeWaver; // waver X
                    if (positions[i + 1] > 3) {
                        positions[i + 1] = 0; // reset Y
                    }
                }
                smoke.geometry.attributes.position.needsUpdate = true;
            });
            
            const current = stateRef.current;
            const isDriving = !!localDrivingCarId;
            const me = current.gameState?.players[current.playerId || ''];

            // Time of Day Rendering Sync. The server sends the clock once a second
            // (time_update); between ticks we advance it locally (1 game hour = 30 s)
            // so the sun and sky move smoothly instead of in jumps.
            const serverTime = useGameStore.getState().timeOfDay;
            if (serverTime !== lastServerTime) { lastServerTime = serverTime; localTime = serverTime; }
            else if (localTime < 20) localTime = Math.min(20, localTime + delta / 30);
            if (Math.abs(localTime - lastRenderedTime) > 0.002) {
                lastRenderedTime = localTime;
                applyTimeOfDay(localTime);
            }

            // --- Secured automatic gate ----------------------------------------
            // Opens automatically from the inside (exit sensor). From the outside
            // it stays locked until the owner enters their code (the React keypad
            // calls window.__authorizeGate() on success). Other lots' gates stay shut.
            const activeObj = (isDriving && localDrivingCarId && carMeshes[localDrivingCarId])
                ? carMeshes[localDrivingCarId] : avatar;
            const now = performance.now();
            const authorized = now < gateAuthorizedUntil;
            let showGateKeypad = false;
            dealershipGates.forEach(g => {
                let open = false;
                if (g.ownerId === current.playerId) {
                    const dx = activeObj.position.x - g.x;
                    const dz = activeObj.position.z - g.z;
                    const near = Math.hypot(dx, dz) < 24 && Math.abs(dx) < 26;
                    const inside = activeObj.position.z < g.z - 0.5;
                    const customerAtGate = Object.keys(aiDriveSequence).some(id => {
                        const m = carMeshes[id];
                        return !!m && Math.abs(m.position.x - g.x) < 20 && Math.abs(m.position.z - g.z) < 30;
                    });
                    if (customerAtGate) open = true;
                    if (near && inside) {
                        open = true;                          // exit sensor: opens from inside
                        gateExitGraceUntil = now + 1500;      // let them fully clear the gate
                    } else if (near && now < gateExitGraceUntil) {
                        open = true;                          // still passing through on the way out
                    } else if (near && !inside) {
                        if (authorized) open = true;          // valid code entered
                        else showGateKeypad = true;           // locked from the outside
                    }
                }
                const lt = open ? Math.PI / 2 : 0;
                const rt = open ? -Math.PI / 2 : 0;
                const gateEase = damp(0.08, delta);
                g.left.rotation.y += (lt - g.left.rotation.y) * gateEase;
                g.right.rotation.y += (rt - g.right.rotation.y) * gateEase;
                // Physically block the driveway whenever the gate is closed (owner lot)
                if (g.isOwner) {
                    if (open) g.barrier.makeEmpty();
                    else { g.barrier.min.set(g.x - 15, 0, g.z - 2); g.barrier.max.set(g.x + 15, 6, g.z + 2); }
                }
            });
            if (showGateKeypad !== lastGateKeypad) {
                lastGateKeypad = showGateKeypad;
                useGameStore.getState().setGatePrompt(showGateKeypad);
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
                        let closestCar: string | null = null;
                        let minDist = 6.0; // Restored to a closer 6 units to prevent accidental teleporting through walls
                        me.inventory.forEach(car => {
                             const m = carMeshes[car.id];
                             if (m && !aiDriveSequence[car.id]) {
                                 const d = avatar.position.distanceTo(m.position);
                                 if (d < minDist) { minDist = d; closestCar = car.id; }
                             }
                        });
                        if (closestCar) {
                             localDrivingCarId = closestCar; // Hijack locally!
                             const ec = me?.inventory.find(c => c.id === closestCar);
                             localFuel = ec?.fuel ?? 100;
                             refuelRequestedIn = null;
                             useGameStore.getState().setDrivingCarId(closestCar);
                             useGameStore.getState().setDrivingFuel(localFuel);
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
                         // The car stops when you get out (it used to pull away at its old speed when you got back in)
                         if (vehiclePhysics[localDrivingCarId!]) vehiclePhysics[localDrivingCarId!].v = 0;
                    }
                    // Persist where the car was left (the periodic sync can be up to 0.33 s old, many
                    // units at speed) and the final fuel level; drop any active race (forfeits entry fee).
                    const exitedCar = carMeshes[localDrivingCarId!];
                    if (exitedCar) useGameStore.getState().socket?.emit('sync_car_pos', { carId: localDrivingCarId, position: { x: exitedCar.position.x, z: exitedCar.position.z, r: headingOf(exitedCar) } });
                    if (localDrivingCarId && localFuel !== null) useGameStore.getState().consumeFuel(localDrivingCarId, localFuel);
                    if (raceActive) { raceActive = false; raceState = ''; useGameStore.getState().abortRace(); }
                    clearCpuRacers();
                    localFuel = null;
                    useGameStore.getState().setDrivingCarId(null);
                    useGameStore.getState().setDrivingFuel(null);
                    useGameStore.getState().setRaceTrackPrompt(false);
                    localDrivingCarId = null;
                }
            }

            // Object Synchronization
            if (me) {
                me.inventory.forEach((car) => {
                    if (!carMeshes[car.id]) {
                        const carStyle = (car as any).bodyStyle || deriveStyle(car.model);
                        const assets = buildCarModel(carStyle, carColorHex(car.color), car.bodyCondition, car.mechanicCondition);
                        
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

                    // smoke reflects the car's CURRENT mechanical condition (clears after a repair)
                    const smoke = carSmokes[car.id];
                    if (smoke) smoke.visible = car.mechanicCondition < 50;

                    // dynamic paint: mud when dirty, otherwise the car's colour with rust
                    // for a damaged body. Only re-applied when something actually changes
                    // (previously a rusty car was repainted shiny on its very first frame).
                    const body = carBodies[car.id];
                    if (body) {
                        const paintKey = `${car.isDirty ? 1 : 0}|${car.color}|${Math.round(car.bodyCondition ?? 100)}`;
                        if (body.userData.paintKey !== paintKey) {
                            body.userData.paintKey = paintKey;
                            applyCarPaint(body.material as THREE.MeshStandardMaterial, carColorHex(car.color), car.bodyCondition ?? 100, !!car.isDirty);
                        }
                    }
                    // AI Pathing Spawn Subroutine
                    if (car.hasOffer && !aiBots[car.id]) {
                        const botGeo = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
                        const botMat = new THREE.MeshStandardMaterial({ color: '#10b981' });
                        const bMesh = new THREE.Mesh(botGeo, botMat);
                        bMesh.position.set(0, 1, 0); // centred in its group, which holds the spawn point
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
                        // If they were out on a test drive, park the car straight back in its spot
                        const seq = aiDriveSequence[car.id];
                        if (seq) {
                            const end = seq.waypoints[seq.waypoints.length - 1];
                            carMeshes[car.id].position.set(end.x, carMeshes[car.id].position.y, end.z);
                            carMeshes[car.id].rotation.set(0, seq.startRotY, 0);
                            delete aiDriveSequence[car.id];
                        }
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

                // Clean up 3D meshes (and every per-car record) for sold cars
                const ownedIds = new Set(me.inventory.map(c => c.id));
                Object.keys(carMeshes).forEach(carId => {
                    if (ownedIds.has(carId)) return;
                    if (carId === localDrivingCarId) {
                        // The car was sold/removed while we were driving it: step out (forfeiting any race).
                        avatar.position.copy(carMeshes[carId].position).add(new THREE.Vector3(-3, 0, 0));
                        localDrivingCarId = null;
                        localFuel = null;
                        if (raceActive) { raceActive = false; raceState = ''; }
                        clearCpuRacers();
                        const st = useGameStore.getState();
                        st.setDrivingCarId(null); st.setDrivingFuel(null); st.setRaceTrackPrompt(false); st.abortRace();
                    }
                    disposeObject(carMeshes[carId]);
                    delete carMeshes[carId];
                    delete carBodies[carId];
                    delete carSmokes[carId];
                    delete carWheels[carId];
                    delete carSteering[carId];
                    delete vehiclePhysics[carId];
                    delete aiDriveSequence[carId];
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
             // ~12% chance per second that a waiting customer takes the car out
             const testDriveChance = 1 - Math.pow(1 - 0.002, delta * 60);
             
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
                      
                      // Now and then a customer takes the car out for a spin on the road
                      const car = carMeshes[key];
                      if (car && key !== localDrivingCarId && Math.random() < testDriveChance) {
                           bot.status = 'test_driving';
                           const lotX = me?.lotPosition?.x || 0;
                           const lotZ = me?.lotPosition?.z || 0;
                           const turnZ = lotZ + (Math.random() > 0.5 ? 600 : 250);
                           const start = car.position.clone();
                           aiDriveSequence[key] = {
                               index: 0,
                               startRotY: headingOf(car),
                               // into the central drive lane, out through the gate, down the road, then back
                               waypoints: [new THREE.Vector3(lotX, 0, start.z), new THREE.Vector3(lotX, 0, turnZ), new THREE.Vector3(lotX, 0, start.z), start],
                           };
                      }
                  } else if (bot.status === 'test_driving') {
                      bot.mesh.visible = false;
                      const car = carMeshes[key];
                      const seq = aiDriveSequence[key];
                      if (!car || !seq) {
                           bot.status = 'waiting';
                           bot.mesh.visible = true;
                      } else {
                           const target = seq.waypoints[seq.index];
                           const dx = target.x - car.position.x, dz = target.z - car.position.z;
                           const dist = Math.hypot(dx, dz);
                           const step = AI_DRIVE_SPEED * delta;
                           if (dist > 0.01) car.rotation.set(0, Math.atan2(dx, dz), 0); // face the direction of travel
                           if (dist <= step) {
                               car.position.set(target.x, car.position.y, target.z);
                               seq.index++;
                               if (seq.index >= seq.waypoints.length) {
                                   // Seamless auto-park back in the original spot
                                   car.rotation.set(0, seq.startRotY, 0);
                                   bot.status = 'waiting';
                                   bot.mesh.visible = true;
                                   delete aiDriveSequence[key];
                               }
                           } else {
                               car.position.x += (dx / dist) * step;
                               car.position.z += (dz / dist) * step;
                           }
                           const localWheels = carWheels[key];
                           if (localWheels) localWheels.forEach(w => w.rotateX(-AI_DRIVE_SPEED * delta * 0.5));
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
                          disposeObject(bot.mesh);
                          delete aiBots[key];
                      }
                  }
             });

             // --- Dynamic Interaction Prompts ---
             // Fade speeds are per second so the label behaves the same at any frame rate.
             interactPrompt.material.opacity = Math.max(0.0, interactPrompt.material.opacity - 6 * delta);
             const showPrompt = (pos: THREE.Vector3, yOff: number, text: string) => {
                  interactPrompt.position.set(pos.x, pos.y + yOff, pos.z);
                  interactPrompt.material.opacity = Math.min(1.0, interactPrompt.material.opacity + 12 * delta);
                  setPromptText(text);
             };
             if (!localDrivingCarId) {
                 let nearestCar: string | null = null;
                 let minD = 6.0;
                 Object.entries(carMeshes).forEach(([id, mesh]) => {
                      if (aiDriveSequence[id]) return; // out on a customer's test drive
                      const dist = avatar.position.distanceTo(mesh.position);
                      if (dist < minD) { minD = dist; nearestCar = id; }
                 });

                  const store = useGameStore.getState();
                  const activeInt = store.activeInteraction;
                  const stop = buildingStops.find(b => avatar.position.distanceTo(b.pos) < b.range);
                  if (stop) {
                       showPrompt(stop.pos, stop.yOff, stop.prompt);
                       if (!activeInt || activeInt.type !== stop.type) {
                            store.setActiveInteraction({ type: stop.type, label: stop.label });
                       }
                       if (eJustPressed || rJustPressed) {
                            keys.e = false; keys.r = false; eWasPressed = false; rWasPressed = false;
                            stop.open();
                       }
                  } else if (nearestCar) {
                       showPrompt(carMeshes[nearestCar].position, 4, '[E] DRIVE');
                       if (!activeInt || activeInt.type !== 'car' || activeInt.carId !== nearestCar) {
                            store.setActiveInteraction({ type: 'car', label: 'Drive Vehicle', carId: nearestCar });
                       }
                  } else if (activeInt !== null) {
                       store.setActiveInteraction(null);
                  }
             } else {
                  const store = useGameStore.getState();
                  if (store.activeInteraction !== null) store.setActiveInteraction(null);
                  const pPos = carMeshes[localDrivingCarId!].position;
                  const lotX = me?.lotPosition?.x || 0;
                  const lotZ = me?.lotPosition?.z || 0;
                  const inShopColumn = Math.abs(pPos.x - (lotX + 55)) < 25;
                  // Same zone and conditions as the R parking handler above (clean, not yet for sale)
                  const drivenCar = me?.inventory.find(c => c.id === localDrivingCarId);
                  const inShowLot = Math.abs(pPos.x - lotX) < 12 && (pPos.z - lotZ) > 10 && !!drivenCar && !drivenCar.isDirty && !drivenCar.isProcessed;
                  if (inShopColumn) {
                       // Name the bay R acts on: R opens the mechanic (z+5) or body shop (z+50) within 25 of
                       // either, and the body shop wins where they overlap. The wash bay (z-40) is drive-through.
                       const dz = pPos.z - lotZ;
                       const label = Math.abs(dz - 50) < 25 ? '[R] BODY SHOP' : Math.abs(dz - 5) < 25 ? '[R] MECHANIC BAY' : Math.abs(dz + 40) < 25 ? 'AUTO WASH: DRIVE THROUGH' : '';
                       if (label) showPrompt(pPos, 6, label);
                  } else if (inShowLot) {
                       showPrompt(pPos, 6, '[R] PARK FOR SALE');
                  }
             }

            // Custom Realistic Driving Physics Engine
            if (localDrivingCarId) {
                avatar.visible = false;
                const activeCar = carMeshes[localDrivingCarId];
                const phys = vehiclePhysics[localDrivingCarId];
                
                if (activeCar && phys) {
                    // ===== Handling from the car's real specs (src/carSpecs.ts) =====
                    // Top speed, acceleration, braking, drag and steering differ per model, and a worn
                    // engine pulls less. The Speedway Rental GT keeps the original race tuning.
                    const tune = tuningFor(me?.inventory.find(c => c.id === localDrivingCarId));
                    const maxV = tune.maxV;
                    const reverseMax = tune.reverseMax;
                    const engineAcc = tune.accel * delta;
                    const brakeAcc = tune.brake * delta;
                    const coast = tune.coast * delta;

                    // --- Fuel burn (all driving consumes gas) ---
                    if (localFuel === null) localFuel = (me?.inventory.find(c => c.id === localDrivingCarId)?.fuel) ?? 100;
                    const liveCar = me?.inventory.find(c => c.id === localDrivingCarId);
                    // Adopt a server refuel: a big jump, or the full tank just paid for at a pump (from a state
                    // that arrived after the request; a small top-up used to be charged but never added)
                    if (liveCar && typeof liveCar.fuel === 'number' && (liveCar.fuel - localFuel > 15 || (refuelRequestedIn && current.gameState !== refuelRequestedIn && liveCar.fuel >= 100))) { localFuel = liveCar.fuel; refuelRequestedIn = null; }
                    localFuel = Math.max(0, localFuel - Math.abs(phys.v) * delta * 0.012);
                    const outOfGas = localFuel <= 0;
                    const inCountdown = raceActive && raceState === 'countdown';
                    const spinning = performance.now() < spinUntil; // spun out by a banana/shell
                    const canDrive = !outOfGas && !inCountdown && !spinning;
                    fuelUiAccum += delta; fuelNetAccum += delta;
                    if (fuelUiAccum > 0.2) { fuelUiAccum = 0; useGameStore.setState({ drivingFuel: Math.round(localFuel), drivingSpeed: Math.round(Math.abs(phys.v) / UNITS_PER_MPH) }); }
                    if (fuelNetAccum > 1.5) { fuelNetAccum = 0; useGameStore.getState().consumeFuel(localDrivingCarId!, Math.round(localFuel)); }

                    // --- Use a held Mario-Kart item (Space / mobile button) ---
                    const useTap = (window as any).useItemTap || (window as any).mobileUseItem;
                    (window as any).useItemTap = false; (window as any).mobileUseItem = false;
                    const nowI = performance.now();
                    if (useTap && !spinning) {
                        const h = useGameStore.getState().heldItem;
                        if (h === 'mushroom' || h === 'triple_mushroom') { boostUntil = nowI + 2400; phys.v = Math.min(Math.max(phys.v, 0) + 75, maxV * 1.6); useGameStore.getState().consumeHeldItem(); }
                        else if (h === 'star') { starUntil = nowI + 6500; boostUntil = nowI + 6500; useGameStore.getState().consumeHeldItem(); }
                        else if (h === 'banana') { dropBanana(activeCar); useGameStore.getState().consumeHeldItem(); }
                        else if (h === 'green_shell') { fireShell(activeCar); useGameStore.getState().consumeHeldItem(); }
                    }
                    const boosting = nowI < boostUntil;
                    const effMaxV = boosting ? maxV * 1.6 : maxV;

                    // Throttle — eased acceleration that tapers toward top speed (kart feel)
                    if (keys.w && canDrive) {
                        if (phys.v < 0) phys.v = Math.min(0, phys.v + brakeAcc);                            // cancel reverse first
                        else phys.v = Math.min(effMaxV, phys.v + engineAcc * (1 - 0.55 * (phys.v / effMaxV)));
                    } else if (keys.s && canDrive) {
                        if (phys.v > 0) phys.v = Math.max(0, phys.v - brakeAcc);                             // brake
                        else phys.v = Math.max(-reverseMax, phys.v - engineAcc * 0.5);                       // reverse
                    } else {
                        if (phys.v > 0) phys.v = Math.max(0, phys.v - coast);
                        else if (phys.v < 0) phys.v = Math.min(0, phys.v + coast);
                    }

                    // Steering — responsive, gains authority with speed, calms at the very top so you don't spin out
                    const spd = Math.abs(phys.v);
                    const grip = Math.min(1, spd / 20);
                    const highSpeedDamp = spd > 55 ? 55 / spd : 1;
                    const turn = 2.4 * tune.turn * delta * grip * highSpeedDamp;
                    let steerInput = 0;
                    if (keys.a) steerInput += 1;
                    if (keys.d) steerInput -= 1;
                    const driveDir = phys.v >= 0 ? 1 : -1;
                    phys.yaw += ((steerInput * 0.5) - phys.yaw) * damp(0.2, delta); // front-wheel visual
                    const steeringPivots = carSteering[localDrivingCarId!];
                    if (steeringPivots) steeringPivots.forEach(p => p.rotation.y = phys.yaw);

                    // Store previous transform for collision rollback
                    const prevPos = tmpPrevPos.copy(activeCar.position);
                    const prevQuat = tmpPrevQuat.copy(activeCar.quaternion);

                    // Rotate (steer) then move — or spin helplessly if hit by a banana/shell
                    if (spinning) { activeCar.rotateY(delta * 16); phys.v *= Math.pow(0.93, delta * 60); }
                    else if (steerInput !== 0 && spd > 0.3) activeCar.rotateY(turn * steerInput * driveDir);
                    activeCar.translateZ(-phys.v * delta);
                    activeCar.updateMatrixWorld(true);

                    // Multi-sphere collision against static boxes (no diagonal AABB bloat)
                    const r = 1.6;
                    carSpheres[0].set(0, 0, 3.2).applyQuaternion(activeCar.quaternion).add(activeCar.position);
                    carSpheres[1].copy(activeCar.position);
                    carSpheres[2].set(0, 0, -3.2).applyQuaternion(activeCar.quaternion).add(activeCar.position);
                    let wallCollided = false;
                    for (let i = 0; i < staticCollisionBoxes.length; i++) {
                        const sBox = staticCollisionBoxes[i];
                        if (sBox.isEmpty()) continue;
                        for (let j = 0; j < carSpheres.length; j++) {
                            const sphereCenter = carSpheres[j];
                            sBox.clampPoint(sphereCenter, tmpClosest);
                            if (tmpClosest.distanceToSquared(sphereCenter) < r * r) { wallCollided = true; break; }
                        }
                        if (wallCollided) break;
                    }
                    if (wallCollided) {
                        activeCar.position.copy(prevPos);
                        activeCar.quaternion.copy(prevQuat);
                        phys.v = -phys.v * 0.35; // soft bounce off the wall
                    }

                    // Spin the wheels with speed
                    const localWheels = carWheels[localDrivingCarId!];
                    if (localWheels) localWheels.forEach(w => w.rotateX(-phys.v * delta * 0.5));

                    // Chase cam that looks down the road ahead (keeps the track visible)
                    tmpCam.set(0, 7.5, 21).applyQuaternion(activeCar.quaternion).add(activeCar.position);
                    camera.position.lerp(tmpCam, damp(0.14, delta));
                    tmpLook.set(0, 2.2, -14).applyQuaternion(activeCar.quaternion).add(activeCar.position);
                    camera.lookAt(tmpLook);

                    // Sync the car's position with the server ~3x per second
                    carSyncAccum += delta;
                    if (carSyncAccum > 0.33) {
                         carSyncAccum = 0;
                         const store = useGameStore.getState() as any;
                         if (store.socket) {
                              store.socket.emit('sync_car_pos', {
                                  carId: localDrivingCarId,
                                  position: { x: activeCar.position.x, z: activeCar.position.z, r: headingOf(activeCar) }
                              });
                         }
                    }

                    // -------- Refuel at a gas station (R while parked at a pump) --------
                    const store2 = useGameStore.getState();
                    const nearPump = gasPumps.some(p => activeCar.position.distanceTo(p) < 9);
                    if (nearPump && !raceActive) {
                        showPrompt(activeCar.position, 6, '[R] REFUEL');
                        if (rJustPressed && (localFuel ?? 100) < 99) { keys.r = false; rWasPressed = false; refuelRequestedIn = current.gameState; store2.refuel(localDrivingCarId!); }
                    }

                    // -------- Speedway race flow --------
                    const ar = store2.activeRace;
                    const nowp = performance.now();
                    const nearStart = activeCar.position.distanceTo(raceStartPos) < 18;
                    store2.setRaceTrackPrompt(!!nearStart && !ar && !raceActive);

                    if (ar && !raceActive) {
                        // a freshly paid entry — line the car up on the grid
                        raceActive = true; raceState = 'countdown';
                        raceDifficulty = ar.difficulty; raceLapTarget = ar.laps; raceLaps = 0; raceCpIndex = 0;
                        raceCountdownUntil = nowp + 3500;
                        activeCar.position.set(raceStartPos.x, 0, raceStartPos.z);
                        activeCar.rotation.set(0, raceStartRotY, 0);
                        phys.v = 0; phys.yaw = 0;
                        // Grid up 3 CPU opponents, paced by the tier's cpuSkill (higher difficulty = faster rivals).
                        clearCpuRacers(); cpuFinishCount = 0; racePlace = 1;
                        const cpuSkill = (ar as any).cpuSkill || 0.85;
                        const cpuColors = ['#ef4444', '#f59e0b', '#a855f7'];
                        const cpuStyles = ['sports', 'coupe', 'sedan'];
                        const REF_LAP = 46; // seconds for a quick clean lap
                        ([-12, 0, 12] as number[]).forEach((lane, i) => {
                            const assets = buildCarModel(cpuStyles[i], cpuColors[i], 100, 100);
                            const m = assets.group;
                            const startA = 88; // line up just behind the player's pole
                            const aRad = startA * Math.PI / 180, rr = RC + lane;
                            m.position.set(RACE_CX + rr * Math.cos(aRad), 0, RACE_CZ + rr * Math.sin(aRad));
                            m.rotation.y = Math.PI - aRad;
                            scene.add(m); // disposed by clearCpuRacers() when the race ends
                            const variation = 0.92 + Math.random() * 0.16;
                            cpuRacers.push({ mesh: m, angleDeg: startA, startAngDeg: startA, lane, speedDegPerSec: 360 / (REF_LAP / (cpuSkill * variation)), finished: false });
                        });
                    }
                    if (raceActive) {
                        if (raceState === 'countdown') {
                            phys.v = 0;
                            if (nowp >= raceCountdownUntil) { raceState = 'go'; raceStartMs = nowp; }
                        } else if (raceState === 'go') {
                            // advance CPU rivals around the circuit + tally any that finish
                            cpuRacers.forEach(c => {
                                if (c.finished) return;
                                c.angleDeg += c.speedDegPerSec * delta;
                                const aRad = c.angleDeg * Math.PI / 180, rr = RC + c.lane;
                                c.mesh.position.set(RACE_CX + rr * Math.cos(aRad), 0, RACE_CZ + rr * Math.sin(aRad));
                                c.mesh.rotation.y = Math.PI - aRad;
                                if ((c.angleDeg - c.startAngDeg) / 360 >= raceLapTarget) { c.finished = true; cpuFinishCount++; }
                            });
                            // player's live position = 1 + rivals ahead on track
                            const pTheta = Math.atan2(activeCar.position.z - RACE_CZ, activeCar.position.x - RACE_CX) * 180 / Math.PI;
                            const playerProg = raceLaps + ((((pTheta - 90) % 360) + 360) % 360) / 360;
                            let ahead = 0;
                            cpuRacers.forEach(c => { if ((c.angleDeg - c.startAngDeg) / 360 > playerProg) ahead++; });
                            racePlace = 1 + ahead;
                            // player lap / finish detection
                            if (raceCpIndex < raceCheckpoints.length) {
                                if (activeCar.position.distanceTo(raceCheckpoints[raceCpIndex]) < 32) raceCpIndex++;
                            } else if (activeCar.position.distanceTo(raceStartPos) < 32) {
                                raceLaps++;
                                raceCpIndex = 0;
                                if (raceLaps >= raceLapTarget) {
                                    store2.finishRace({ difficulty: raceDifficulty, totalMs: Math.round(nowp - raceStartMs), laps: raceLaps, placed: 1 + cpuFinishCount });
                                    raceActive = false; raceState = '';
                                }
                            }
                        }
                        raceHudAccum += delta;
                        if (raceActive && raceHudAccum > 0.1) {
                            raceHudAccum = 0;
                            const cd = raceState === 'countdown' ? Math.max(0, Math.ceil((raceCountdownUntil - nowp) / 1000)) : 0;
                            store2.setRaceHud({ lap: Math.min(raceLaps + 1, raceLapTarget), totalLaps: raceLapTarget, ms: raceState === 'go' ? Math.round(nowp - raceStartMs) : 0, place: raceState === 'countdown' ? cd : racePlace, total: cpuRacers.length + 1, state: raceState });
                        }
                    }
                    if (!ar && raceActive) { raceActive = false; raceState = ''; store2.setRaceHud(null); }
                    if (!raceActive && cpuRacers.length > 0) clearCpuRacers(); // tidy up rivals when the race ends

                    // --- Item boxes: holographic shimmer, spin/bob, grab one during a race ---
                    const nowB = performance.now();
                    const starActive = nowB < starUntil;
                    itemBoxes.forEach((b, i) => {
                        if (b.active) {
                            b.mesh.rotation.y += delta * 1.6;
                            b.mesh.rotation.x += delta * 0.9;
                            b.mesh.position.y = b.baseY + Math.sin(nowB * 0.003 + i) * 0.7;
                            (b.mesh.material as THREE.MeshStandardMaterial).color.setHSL(((nowB * 0.0003) + i * 0.13) % 1, 0.85, 0.65); // foil shimmer
                            if (raceActive && raceState === 'go' && activeCar.position.distanceTo(b.mesh.position) < 8) {
                                b.active = false; b.mesh.visible = false; b.respawnAt = nowB + 6000;
                                store2.hitItemBox();
                            }
                        } else if (nowB > b.respawnAt) {
                            b.active = true; b.mesh.visible = true;
                        }
                    });
                    // fired shells fly forward and expire
                    shells.forEach(s => {
                        if (!s.alive) return;
                        s.mesh.position.addScaledVector(s.dir, 200 * delta);
                        s.mesh.rotation.y += delta * 8;
                        if (nowB > s.expireAt) s.alive = false;
                    });
                    // bananas spin out any car that drives over one (unless star-invincible)
                    bananas.forEach(bn => {
                        if (!bn.alive) return;
                        bn.mesh.rotation.y += delta * 1.0;
                        if (nowB > bn.expireAt) { bn.alive = false; return; }
                        if (!starActive && activeCar.position.distanceTo(bn.mesh.position) < 4.5) { bn.alive = false; spinUntil = nowB + 1300; }
                    });
                    pruneProjectiles();
                    // rainbow star glow on the driven car
                    const starBodyMat = localDrivingCarId ? (carBodies[localDrivingCarId] && (carBodies[localDrivingCarId].material as THREE.MeshStandardMaterial)) : null;
                    if (starBodyMat) {
                        if (starActive) { starBodyMat.emissive.setHSL((nowB * 0.004) % 1, 1, 0.5); starBodyMat.emissiveIntensity = 0.9; }
                        else if (starBodyMat.emissiveIntensity > 0) { starBodyMat.emissiveIntensity = 0; }
                    }
                }
            } else {
                avatar.visible = true;
                // Avatar Physics with Orthogonal Sliding and Shaved AABBs
                const walkSpeed = 15 * delta;
                const walkRotSpeed = 3 * delta;

                const moveVec = tmpMove.set(0, 0, 0);
                if (keys.w) moveVec.z -= walkSpeed;
                if (keys.s) moveVec.z += walkSpeed;
                moveVec.applyQuaternion(avatar.quaternion);

                // Would the avatar bump into a car (three circles along its length) or a wall here?
                const blockedAt = (x: number, z: number) => {
                    for (const carMesh of Object.values(carMeshes)) {
                        const cP = carMesh.position;
                        if (Math.hypot(x - cP.x, z - cP.z) > 8) continue; // cheap reject for far cars
                        const fwd = tmpFwd.set(0, 0, 3.0).applyQuaternion(carMesh.quaternion);
                        if (Math.hypot(x - cP.x, z - cP.z) < 2.2
                            || Math.hypot(x - (cP.x + fwd.x), z - (cP.z + fwd.z)) < 2.2
                            || Math.hypot(x - (cP.x - fwd.x), z - (cP.z - fwd.z)) < 2.2) return true;
                    }
                    // Avatar box (0.6 x 2 x 0.6) — kept small so it doesn't snag on corners
                    tmpAvatarBox.min.set(x - 0.3, avatar.position.y, z - 0.3);
                    tmpAvatarBox.max.set(x + 0.3, avatar.position.y + 2, z + 0.3);
                    for (let i = 0; i < staticCollisionBoxes.length; i++) if (tmpAvatarBox.intersectsBox(staticCollisionBoxes[i])) return true;
                    return false;
                };

                // Try each axis separately so the avatar slides along walls
                if (Math.abs(moveVec.x) > 0.001 && !blockedAt(avatar.position.x + moveVec.x, avatar.position.z)) avatar.position.x += moveVec.x;
                if (Math.abs(moveVec.z) > 0.001 && !blockedAt(avatar.position.x, avatar.position.z + moveVec.z)) avatar.position.z += moveVec.z;
                
                if (keys.a) avatar.rotateY(walkRotSpeed);
                if (keys.d) avatar.rotateY(-walkRotSpeed);

                tmpCam.set(0, 4, 10).applyQuaternion(avatar.quaternion).add(avatar.position);
                camera.position.lerp(tmpCam, damp(0.15, delta));
                tmpLook.set(avatar.position.x, avatar.position.y + 1.5, avatar.position.z);
                camera.lookAt(tmpLook);
            }

            // --- MULTIPLAYER POSITION SYNC ---
            if (current.playerId && useGameStore.getState().socket && (time - lastPosEmitTime > 0.1)) {
                lastPosEmitTime = time;
                const activeMesh = (isDriving && localDrivingCarId && carMeshes[localDrivingCarId]) ? carMeshes[localDrivingCarId] : avatar;
                useGameStore.getState().socket?.emit('sync_player_pos', {
                    x: activeMesh.position.x,
                    y: activeMesh.position.y,
                    z: activeMesh.position.z,
                    rotation: headingOf(activeMesh) // true heading (see headingOf)
                });
                // Feed the GPS our live position directly so it follows instantly.
                const st = useGameStore.getState();
                if (!st.myWorldPos || Math.hypot(activeMesh.position.x - st.myWorldPos.x, activeMesh.position.z - st.myWorldPos.z) > 0.6) {
                    st.setMyWorldPos({ x: activeMesh.position.x, z: activeMesh.position.z });
                }
            }

            if (current.gameState && current.gameState.players) {
                const activeIds = new Set(Object.keys(current.gameState.players));
                Object.keys(otherPlayerMeshes).forEach(id => {
                    if (!activeIds.has(id) || id === current.playerId) {
                        disposeObject(otherPlayerMeshes[id]);
                        delete otherPlayerMeshes[id];
                    }
                });
                // Live positions relayed by the server ~10x/sec; fall back to the last full update.
                const livePositions = useGameStore.getState().playerPositions;
                const follow = damp(0.2, delta);

                // Build at most one missing dealership per frame (the local player's
                // own lot first), so joining a busy world doesn't freeze while every
                // lot is built in a single frame.
                const nextLot = (me && me.lotPosition && !builtDealerships.has(me.id)) ? me
                    : Object.values(current.gameState.players).find(p => !builtDealerships.has(p.id) && p.lotPosition);
                if (nextLot) {
                    const firstNew = scene.children.length;
                    dealershipGates.push(createDealership(world, fences, furniture, nextLot.lotPosition.x, nextLot.lotPosition.z, nextLot.id, nextLot.id === current.playerId));
                    batchWorld(scene.children.slice(firstNew));
                    builtDealerships.add(nextLot.id);
                }

                Object.values(current.gameState.players).forEach(p => {
                    const wp = livePositions[p.id] || p.worldPosition;
                    if (p.id === current.playerId || !wp) return;
                    
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

                        // Start where they are (not at the world origin, sliding in from there)
                        meshGroup.position.set(wp.x, wp.y ?? 0, wp.z);
                        meshGroup.quaternion.setFromAxisAngle(UP, wp.rotation ?? 0);
                        scene.add(meshGroup);
                        otherPlayerMeshes[p.id] = meshGroup;
                    }
                    meshGroup.position.lerp(tmpTarget.set(wp.x, wp.y ?? 0, wp.z), follow);
                    meshGroup.quaternion.slerp(tmpQuat.setFromAxisAngle(UP, wp.rotation ?? 0), follow);
                });
            }
            
            // Move the small pool of real lights to the lamps nearest the player
            const focusObj = (localDrivingCarId && carMeshes[localDrivingCarId]) || avatar;
            lightPool.update(focusObj.position, nightFactor, delta);

            renderer.render(scene, camera);
        };
        
        animate(); // Kick off

        // Cleanup
        return () => {
            cancelAnimationFrame(animationFrameId);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', releaseAllKeys);
            document.removeEventListener('visibilitychange', handleVisibility);
            unsubscribeGraphics();
            lightPool.dispose();
            clearCpuRacers();
            [...bananas, ...shells].forEach(p => scene.remove(p.mesh));
            [bananaGeo, shellGeo, itemBoxGeo].forEach(g => g.dispose());
            [bananaMat, shellMat].forEach(m => m.dispose());
            qTex.dispose(); uiTex.dispose();
            Object.values(aiBots).forEach(b => disposeObject(b.mesh));
            Object.values(otherPlayerMeshes).forEach(disposeObject);

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
            envTexture.dispose();

            // Last: renderer.dispose() forgets which GPU textures belong to which
            // texture objects, so textures disposed after it would never be freed.
            renderer.domElement.remove();
            renderer.dispose();
        };
    }, []);

    return <div ref={mountRef} className="absolute inset-0 z-[0] pointer-events-auto overflow-hidden" />;
}
