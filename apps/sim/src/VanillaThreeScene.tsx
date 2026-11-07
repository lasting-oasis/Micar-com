import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useGameStore } from './store';
import { LightPool } from './scene/lightPool';
import { batchStatic } from './scene/staticBatcher';
import { damp, groundLastOpaqueSort } from './scene/utils';
import { Atmosphere } from './scene/atmosphere';
import { applyCarPaint, attachCarShadows, buildCarModel, carColorHex, carFrameTick, carStyleReady, deriveStyle, precompileCarsTick, disposeCarModel, disposeSharedCarAssets, setCarLights, syncCarWheels, updateCarLights, updateCars } from './scene/carModel';
import { BlobShadows, Character, customerLook, dealerLook, disposeCharacterAssets } from './scene/characterModel';
import { createGroundHeight } from './scene/groundHeight';
import { createWorldContext } from './scene/world/context';
import { setGroundLowQuality } from './scene/world/groundShader';
import { createFenceKit } from './scene/world/fences';
import { createFurnitureKit } from './scene/world/furniture';
import { buildCity } from './scene/world/city';
import { buildGate, buildStripExit, GATE_RETURN } from './scene/world/gate';
import { createDealership, type DealershipGate } from './scene/world/dealership';
import { Driver, STEP, townCollider, type DriveOpts } from './world/driver';
import { EVENTS, EV_NAME, STOCK_CFG, TUNE_DEF, specFor, stageOf, visualRating, type BodyStyle, type CarCfg, type StripRecord } from './world/data';
import { NO_INPUT, type Input, type Tune, type VehicleSpec } from './world/physics';
import { anchorsFor, attachParts, disposeParts, syncKitLod, type PartsKit } from './world/parts';
import { StripScene, STRIP_SPAWN } from './world/strip/scene';
import { routePoint } from './world/strip/routes';
import type { EventResults } from './world/strip/events';
import { Hud, fmtT, type HudState } from './world/hud';
import { Audio as NtAudio } from './world/audio';
import { getOptions } from './world/options';
import { InputMap } from './world/input';
import { ChaseCamera } from './world/cameras';
import { WORLD_PER_M } from './world/units';
import { useDriveUi, type ShownResults } from './world/driveUi';
import { DriveLayer } from './world/DriveLayer';
import { RENTAL_BAY, canRent, heldRental, isVisitor } from './world/rental';

export function VanillaThreeScene() {
    const mountRef = useRef<HTMLDivElement>(null);
    const layerRef = useRef<HTMLDivElement>(null);      // the driving HUD's DOM layer (world/DriveLayer.tsx)
    const hudCanvasRef = useRef<HTMLCanvasElement>(null); // ... and its canvas (world/hud.ts)

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
        // Low renders at 1x, High at up to 2x on hi-DPI screens. Set before the first
        // sizing: every size change re-allocates the (multisampled) drawing buffer,
        // and a phone on Low used to allocate a 2x one just to drop it again.
        const pixelRatioFor = (q: 'high' | 'low') => q === 'low' ? 1 : Math.min(window.devicePixelRatio, 2);
        renderer.setPixelRatio(pixelRatioFor(useGameStore.getState().graphicsQuality));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.setOpaqueSort(groundLastOpaqueSort); // big ground layers last: far fewer pixels shaded twice
        // Filmic tone mapping: bright skies and sunlit paint roll off softly instead of clipping
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        mountRef.current.appendChild(renderer.domElement);


        // --- 2. Lighting ---
        // The sun (a faint moon at night) plus the sky: sky colours, sky light, fog and
        // exposure all follow the time of day (see scene/atmosphere.ts). The sun's
        // shadow box follows the player.
        const dirLight = new THREE.DirectionalLight(0xffffff, 3);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        scene.add(dirLight);
        const atmosphere = new Atmosphere(renderer, scene, dirLight);

        // Small fixed pool of real lights that follows the player around the lamps
        // (see lightPool.ts). Every lamp below registers a light *source* instead of
        // adding its own PointLight.
        const lightPool = new LightPool(scene, 8);
        const addLightSource = (x: number, y: number, z: number, color: string, intensity: number, distance: number, nightOnly: boolean) =>
            lightPool.add({ position: new THREE.Vector3(x, y, z), color, intensity, distance, nightOnly });
        // Pool lights in the scene: none, on High or Low. The street and lot lamps now light
        // the scene in the shader (scene/world/lampLight.ts); with that, these point lights
        // changed under 0.05% of the pixels at night, and each one costs every lit pixel.
        const poolSizeFor = (_q: 'high' | 'low') => 0;

        // --- 3. World ---
        // The builders live in ./scene/world; they share this context (scene,
        // collision boxes, cleanup lists, common materials).
        const world = createWorldContext(scene, addLightSource);
        const { environmentDisposables, staticCollisionBoxes, cityMaterials, cityTextures, emissiveFacadeMaterials } = world;
        const fences = createFenceKit(world);
        // the ground people stand on (sidewalks, lawns, curbs are a few cm above the road)
        const groundHeight = createGroundHeight([world.layers.concrete, world.layers.lawn]);
        const furniture = createFurnitureKit(world.makeGlass);

        // Everything added to the scene from here until the world is finished is
        // static scenery that gets merged into a few big meshes (see batchStatic).
        const worldStartIndex = scene.children.length;
        const { libraryWorldPos, insuranceWorldPos, gasPumps } = buildCity(world, furniture);
        const gate = buildGate(world); // the Speedway's footprint: the lit gate to the Strip

        // Driveway gates of every dealership built so far. The owner's opens from
        // the inside automatically and from the outside after the gate code.
        const dealershipGates: DealershipGate[] = [];
        const builtDealerships = new Set<string>();


        // fuel state consumed by the render loop
        let localFuel: number | null = null;     // tank of the car currently being driven
        let refuelRequestedIn: object | null = null; // game state seen when R was pressed at a pump (refuel pending)
        let fuelUiAccum = 0, fuelNetAccum = 0;    // throttle the HUD write and the server sync

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
        const carWheels: Record<string, THREE.Object3D[]> = {};   // wheel nodes: rotateX rolls them (then syncCarWheels)
        const carSteering: Record<string, THREE.Object3D[]> = {}; // front steering pivots: rotation.y
        attachCarShadows(scene); // a soft shadow under every car (one draw for all of them)
        let carPrecompileAt = 0, carPrecompileFrames = 0; // car shader programs are prepared in the background after joining
        // --- People (scene/characterModel.ts) ----------------------------------------------
        // Customers at a car, by car ID: walk-ins negotiating for that car (`agentId`) and the
        // older offer customers. `mesh` places and turns them, `person` is their body; they
        // follow `route` (waypoints) before heading for `targetPos`.
        type BotState = { mesh: THREE.Group, person: Character, targetPos: THREE.Vector3, status: 'walking_in' | 'waiting' | 'walking_out' | 'test_driving', route?: THREE.Vector3[], agentId?: string };
        const aiBots: Record<string, BotState> = {}; // Mapped by target car ID
        const CUSTOMER_WALK_SPEED = 3.4; // world units per second: a natural walk
        // Turn a person (they face −Z) toward the direction (dx, dz), at most 9 rad/s. Returns the turn rate.
        const faceToward = (obj: THREE.Object3D, dx: number, dz: number, delta: number) => {
            if (dx * dx + dz * dz < 1e-6 || delta <= 0) return 0;
            const off = Math.atan2(-dx, -dz) - obj.rotation.y;
            const diff = Math.atan2(Math.sin(off), Math.cos(off)); // shortest way round
            const turn = Math.max(-9 * delta, Math.min(9 * delta, diff));
            obj.rotation.y += turn;
            return turn / delta;
        };
        // Walk a person through `route`'s waypoints and on to `target`, facing where they go; true once there.
        const walkTo = (mesh: THREE.Group, person: Character, route: THREE.Vector3[] | undefined, target: THREE.Vector3, delta: number) => {
            const p = mesh.position;
            const goal = route && route.length ? route[0] : target;
            const dx = goal.x - p.x, dz = goal.z - p.z, d = Math.hypot(dx, dz);
            if (d < 0.3 || delta <= 0) {
                if (route && route.length && delta > 0) { route.shift(); person.update(delta, CUSTOMER_WALK_SPEED); return false; }
                person.update(delta, 0);
                return d < 0.3;
            }
            const step = Math.min(d, CUSTOMER_WALK_SPEED * delta);
            p.x += dx / d * step; p.z += dz / d * step;
            faceToward(mesh, dx, dz, delta);
            person.update(delta, step / delta);
            return false;
        };
        const walkCustomer = (bot: BotState, target: THREE.Vector3, delta: number) => walkTo(bot.mesh, bot.person, bot.route, target, delta);
        // Where a customer stands to look at a car: beside it, on the side they come from.
        const tmpSide = new THREE.Vector3();
        const customerSpot = (car: THREE.Object3D, from: THREE.Vector3, side = 0) => {
            const across = tmpSide.set(1, 0, 0).applyQuaternion(car.quaternion);
            const s = side || ((from.x - car.position.x) * across.x + (from.z - car.position.z) * across.z >= 0 ? 1 : -1);
            return car.position.clone().addScaledVector(across, s * 3.6).setY(0);
        };
        // Customers leave toward the middle of the lot they came from
        const customerExit = (lot?: { x: number; z: number }) => new THREE.Vector3((lot?.x || 0) + Math.random() * 20 - 10, 0, (lot?.z || 0) + 45);
        // Walking on a lot: along the central drive lane (lot x ± 5, between the display rows),
        // out to the lane and in again at the ends, so people don't cut through parked cars.
        type Lot = { x: number; z: number };
        const lanePoint = (lot: Lot, side: number, z: number) => new THREE.Vector3(lot.x + side * 5, 0, lot.z + Math.max(-25, Math.min(90, z - lot.z)));
        const laneRoute = (lot: Lot, from: THREE.Vector3, to: THREE.Vector3) => {
            const toSide = to.x >= lot.x ? 1 : -1, fromSide = Math.abs(from.x - lot.x) < 5 ? toSide : Math.sign(from.x - lot.x);
            const pts = [lanePoint(lot, fromSide, from.z), lanePoint(lot, toSide, to.z)];
            return pts.filter((q, i) => q.distanceTo(i ? pts[0] : from) > 1.5 && q.distanceTo(to) > 1.5);
        };
        // Would walking from a to b go through a car or a wall?
        const tmpSeg = new THREE.Vector3();
        const tmpWalkBox = new THREE.Box3();
        const segmentBlocked = (a: THREE.Vector3, b: THREE.Vector3) => {
            const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 1.2);
            for (let i = 1; i < n; i++) {
                const x = a.x + (b.x - a.x) * i / n, z = a.z + (b.z - a.z) * i / n;
                for (const id in carMeshes) {
                    if (district === 'strip' && id === localDrivingCarId) continue; // away in the Strip
                    const c = carMeshes[id].position;
                    if (Math.abs(x - c.x) > 8 || Math.abs(z - c.z) > 8) continue;
                    const f = tmpSeg.set(0, 0, 3).applyQuaternion(carMeshes[id].quaternion);
                    if (Math.hypot(x - c.x, z - c.z) < 2.6 || Math.hypot(x - c.x - f.x, z - c.z - f.z) < 2.6 || Math.hypot(x - c.x + f.x, z - c.z + f.z) < 2.6) return true;
                }
                tmpWalkBox.min.set(x - 0.4, 0.1, z - 0.4); tmpWalkBox.max.set(x + 0.4, 3, z + 0.4);
                for (let j = 0; j < staticCollisionBoxes.length; j++) if (tmpWalkBox.intersectsBox(staticCollisionBoxes[j])) return true;
            }
            return false;
        };
        // Customer test drives in progress, by car ID: a list of waypoints the car
        // drives through (out the gate, down the road, back, and into its spot).
        const aiDriveSequence: Record<string, { waypoints: THREE.Vector3[]; index: number; startRotY: number }> = {};
        const AI_DRIVE_SPEED = 40;

        // Walk-in customers mirrored from the server (gameState.activeWalkIns): one person per
        // agent. Browsing: they wander the lot and look at cars. Negotiating: they hand over to
        // aiBots[carId] (walk up to that car, wait by it, maybe take it for a test drive).
        // Gone or left: they walk out through the gate.
        type WalkIn = { mesh: THREE.Group; person: Character; mode: 'walking' | 'looking' | 'attached' | 'leaving'; route: THREE.Vector3[]; target: THREE.Vector3; look: THREE.Vector3 | null; lookCar: string | null; until: number; leftAt: number; carId: string | null };
        const walkIns: Record<string, WalkIn> = {};
        const arrivals: Record<string, number> = {}; // when each new walk-in shows up (they don't all arrive at once)
        const agentById = (agents: { id: string; state: string; carId?: string }[], id: string) => { for (const a of agents) if (a.id === id) return a; return undefined; };
        // Is this car customer a walk-in who is (still) negotiating for this car?
        const negotiatingFor = (bot: BotState, carId: string) => {
            if (!bot.agentId) return false;
            const st = stateRef.current;
            const a = agentById((st.gameState?.activeWalkIns?.[st.playerId || ''] || []) as { id: string; state: string; carId?: string }[], bot.agentId);
            return !!a && a.state === 'negotiating' && a.carId === carId;
        };
        const onLot = (lot: Lot, p: THREE.Vector3) => p.x > lot.x - 50 && p.x < lot.x + 70 && p.z > lot.z - 35 && p.z < lot.z + 96;
        // Choose the next car to look at (or a spot on the lane) and the way there
        const planBrowse = (w: WalkIn, lot: Lot, cars: { id: string }[]) => {
            const taken = new Set<string>(Object.keys(aiBots));
            for (const id in walkIns) if (walkIns[id] !== w && walkIns[id].lookCar) taken.add(walkIns[id].lookCar!);
            const choices = cars.filter(c => carMeshes[c.id] && !taken.has(c.id) && c.id !== w.lookCar && !aiDriveSequence[c.id] && c.id !== localDrivingCarId && onLot(lot, carMeshes[c.id].position));
            // one of the nearest few, so they work their way along the rows
            const here = w.mesh.position;
            choices.sort((p, q) => carMeshes[p.id].position.distanceToSquared(here) - carMeshes[q.id].position.distanceToSquared(here));
            for (let tries = 0; tries < 4 && choices.length; tries++) {
                const id = choices.splice(Math.floor(Math.random() * Math.min(3, choices.length)), 1)[0].id, car = carMeshes[id];
                for (const side of Math.random() < 0.5 ? [1, -1] : [-1, 1]) {
                    const spot = customerSpot(car, w.mesh.position, side);
                    const route = laneRoute(lot, w.mesh.position, spot);
                    const from = route.length ? route[route.length - 1] : w.mesh.position;
                    if (!onLot(lot, spot) || segmentBlocked(from, spot)) continue;
                    w.route = route; w.target = spot; w.look = car.position; w.lookCar = id; w.mode = 'walking';
                    return;
                }
            }
            // nothing to look at: stroll along the lane
            const spot = lanePoint(lot, Math.random() < 0.5 ? 1 : -1, lot.z + 5 + Math.random() * 70);
            w.route = laneRoute(lot, w.mesh.position, spot); w.target = spot; w.look = null; w.lookCar = null; w.mode = 'walking';
        };
        const removeWalkIn = (id: string) => {
            const w = walkIns[id];
            if (w.carId && aiBots[w.carId]?.agentId === id) delete aiBots[w.carId];
            w.person.dispose(); w.mesh.removeFromParent();
            delete walkIns[id];
        };
        const tmpFrustum = new THREE.Frustum(), tmpProj = new THREE.Matrix4(), tmpSphere = new THREE.Sphere();
        const updateWalkIns = (me: { id: string; lotPosition?: Lot; inventory: { id: string }[] }, delta: number) => {
            const lot = me.lotPosition;
            const agents = (stateRef.current.gameState?.activeWalkIns?.[me.id] || []) as { id: string; state: string; carId?: string }[];
            if (!lot) return;
            const now = performance.now();
            // A new walk-in arrives from the customer parking by the gate
            for (const a of agents) {
                if (a.state === 'left') { delete arrivals[a.id]; continue; }
                if (walkIns[a.id]) continue;
                arrivals[a.id] ??= now + Math.random() * 12000;
                if (now < arrivals[a.id] && a.state === 'browsing') continue;
                delete arrivals[a.id];
                const person = new Character(customerLook(a.id), a.id);
                const mesh = new THREE.Group();
                mesh.add(person.root);
                mesh.userData.walkIn = a.id;
                mesh.position.set(lot.x + 36 + Math.random() * 8, 0, lot.z + 82 + Math.random() * 8);
                mesh.rotation.y = Math.PI / 2; // facing the lot
                scene.add(mesh);
                const w: WalkIn = walkIns[a.id] = { mesh, person, mode: 'walking', route: [], target: mesh.position.clone(), look: null, lookCar: null, until: 0, leftAt: 0, carId: null };
                planBrowse(w, lot, me.inventory);
            }
            tmpFrustum.setFromProjectionMatrix(tmpProj.multiplyMatrices(viewCam.projectionMatrix, viewCam.matrixWorldInverse));
            for (const id in walkIns) {
                const w = walkIns[id];
                const a = agentById(agents, id);
                const gone = !a || a.state === 'left';
                if (w.mode === 'attached') {
                    // aiBots walks them while they're at "their" car, until it lets them go
                    if (w.carId && aiBots[w.carId]?.agentId === id) continue;
                    w.carId = null; w.lookCar = null;
                    if (!gone) { planBrowse(w, lot, me.inventory); continue; }
                }
                if (gone) {
                    if (w.mode !== 'leaving') {
                        // out through the gate
                        const gate = new THREE.Vector3(lot.x + Math.random() * 10 - 5, 0, lot.z + 95);
                        w.mode = 'leaving'; w.leftAt = now; w.look = null; w.lookCar = null;
                        w.route = laneRoute(lot, w.mesh.position, gate); w.target = gate;
                    }
                } else if (a.state === 'negotiating' && a.carId && carMeshes[a.carId] && !aiBots[a.carId]) {
                    // walk up to the car they're negotiating for (aiBots takes over)
                    const spot = customerSpot(carMeshes[a.carId], w.mesh.position);
                    aiBots[a.carId] = { mesh: w.mesh, person: w.person, targetPos: spot, status: 'walking_in', agentId: id, route: laneRoute(lot, w.mesh.position, spot) };
                    w.mode = 'attached'; w.carId = a.carId; w.lookCar = a.carId;
                    continue;
                }
                if (w.mode === 'walking') {
                    if (walkTo(w.mesh, w.person, w.route, w.target, delta)) { w.mode = 'looking'; w.until = now + 4000 + Math.random() * 6000; }
                } else if (w.mode === 'looking') {
                    // look at the car for a while (breathing, glancing around), then on to the next one
                    const turning = w.look ? faceToward(w.mesh, w.look.x - w.mesh.position.x, w.look.z - w.mesh.position.z, delta) : 0;
                    w.person.update(delta, 0, turning);
                    if (now > w.until) planBrowse(w, lot, me.inventory);
                } else if (w.mode === 'leaving') {
                    const there = walkTo(w.mesh, w.person, w.route, w.target, delta);
                    if (there && w.target.z < lot.z + 100) {
                        // at the gate: walk on out if it's open
                        const gate = dealershipGates.find(g => g.ownerId === me.id);
                        if (gate && Math.abs(gate.left.rotation.y) > 1.2) w.target = new THREE.Vector3(w.mesh.position.x, 0, lot.z + 115);
                    }
                    // gone once outside the lot, or (out of sight / after a while) at the closed gate
                    const outside = w.mesh.position.z > lot.z + 105;
                    tmpSphere.center.copy(w.mesh.position).setY(1.7); tmpSphere.radius = 2.5;
                    const unseen = there && !tmpFrustum.intersectsSphere(tmpSphere);
                    if (outside || unseen || (there && now - w.leftAt > 30000) || now - w.leftAt > 60000) removeWalkIn(id);
                }
            }
        };

        const otherPlayerMeshes: Record<string, THREE.Group> = {}; // Mapped by player ID
        // Another player's dealer and name label
        const removeOtherPlayer = (id: string) => {
            const g = otherPlayerMeshes[id];
            if (!g) return;
            (g.userData.person as Character | undefined)?.dispose();
            g.traverse(o => { if ((o as THREE.Sprite).isSprite) { const m = (o as THREE.Sprite).material; m.map?.dispose(); m.dispose(); } });
            g.removeFromParent();
            delete otherPlayerMeshes[id];
        };

        // The player: a car dealer (scene/characterModel.ts) facing −Z like the game's forward,
        // posed every frame by the walking code below. Their look comes from their name, so
        // every client draws them the same.
        const avatar = new THREE.Group();
        let avatarName = stateRef.current.gameState?.players[stateRef.current.playerId || '']?.name ?? '';
        let avatarPerson = new Character(dealerLook(avatarName), avatarName);
        avatar.add(avatarPerson.root);
        // Low graphics has no shadow maps: a soft blob under each person keeps them on the ground
        const blobs = new BlobShadows(64);
        scene.add(blobs.mesh);

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
        let quality = useGameStore.getState().graphicsQuality;
        const maxAnisotropy = renderer.capabilities.getMaxAnisotropy;
        const applyGraphics = (q: 'high' | 'low', recompile: boolean) => {
             quality = q;
             lightPool.setActiveCount(poolSizeFor(q));
             world.setLampLimit(q === 'low' ? 4 : 8); // lamps lighting the scene (a uniform count: no recompile)
             // Low: one texture read per ground pixel instead of three, and no anisotropic
             // filtering (it takes several texture reads per pixel at a glancing angle). Three.js
             // caps every texture's anisotropy at getMaxAnisotropy() when it uploads it.
             setGroundLowQuality(q === 'low');
             renderer.capabilities.getMaxAnisotropy = q === 'low' ? () => 1 : maxAnisotropy;
             // High: sky light + reflections from a map of the live sky; Low: the same sky
             // worked out in the shader (no map)
             atmosphere.updateEnvironment(q === 'high');
             if (renderer.getPixelRatio() !== pixelRatioFor(q)) renderer.setPixelRatio(pixelRatioFor(q));
             renderer.shadowMap.enabled = q === 'high';
             dirLight.castShadow = q === 'high';
             // Free the 2048x2048 sun shadow map while shadows are off; three.js
             // re-creates it the next time the light casts shadows.
             if (q === 'low' && dirLight.shadow.map) {
                 dirLight.shadow.map.dispose();
                 dirLight.shadow.map = null;
             }
             if (recompile) {
                 // Shaders are built with or without shadow code, so rebuild them once (the Strip's too,
                 // once it is built: `strip` is declared further down, and the first call never recompiles)
                 const scenes: THREE.Object3D[] = strip?.ready ? [scene, strip.scene] : [scene];
                 for (const sc of scenes) sc.traverse(o => {
                     const mat = (o as THREE.Mesh).material;
                     if (mat) (Array.isArray(mat) ? mat : [mat]).forEach(m => {
                         m.needsUpdate = true;
                         // re-upload filtered textures so the new anisotropy cap applies
                         for (const v of Object.values(m)) if ((v as THREE.Texture)?.isTexture && (v as THREE.Texture).anisotropy > 1) (v as THREE.Texture).needsUpdate = true;
                     });
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
             driveCam.aspect = camera.aspect; driveCam.updateProjectionMatrix();
             hud?.resize();
             // Ratio first, so the drawing buffer is re-allocated once, not twice
             const pr = pixelRatioFor(useGameStore.getState().graphicsQuality);
             if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);
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
            // a fresh ◀ / ▶ tap while driving is a lane change in a drag (the InputMap's left / right edge)
            if (localDrivingCarId && pressed) { if (k === 'a' && !keys.a) im.edge.laneL = true; if (k === 'd' && !keys.d) im.edge.laneR = true; }
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
            if (e.key === 'Backspace' && localDrivingCarId) { e.preventDefault(); backspaceTap = true; } // reset the car (in the town)
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
        // a hidden tab: no keys held, the sound suspended (the AudioContext is made further down)
        const handleVisibility = () => { if (document.hidden) { releaseAllKeys(); audio.suspend(); } else audio.wake(); };
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

        let nightFactor = 0;          // 0 = daylight, 1 = full night (drives the lamps)
        let lastServerTime = -1;      // last clock value received from the server
        let localTime = 8;            // smoothly advanced between the server's 1-second ticks

        const applyTimeOfDay = (t: number) => {
            atmosphere.setTime(t);
            nightFactor = atmosphere.nightFactor; // street lamps and lit windows fade in as the sun goes down
            const glowIntensity = 0.15 + 1.25 * nightFactor;
            emissiveFacadeMaterials.forEach(m => m.emissiveIntensity = glowIntensity);
            world.setNight(nightFactor); // street and lot lights: glowing heads, pools of light
        };

        // Buildings you can walk up to and use. Defined once (the old code rebuilt
        // these positions every frame).
        const buildingStops = [
            { pos: new THREE.Vector3(40, 1.5, 130), range: 12, yOff: 3, type: 'bank' as const, label: 'Access Capital Bank', prompt: '[R] CAPITAL BANK', open: () => useGameStore.getState().openBankModal() },
            { pos: new THREE.Vector3(-60, 1, 205), range: 15, yOff: 3, type: 'auction' as const, label: 'Access Global Auction', prompt: '[R] GLOBAL AUCTION', open: () => { window.dispatchEvent(new CustomEvent('open_auction')); } },
            { pos: libraryWorldPos, range: 11, yOff: 3, type: 'library' as const, label: 'Browse the Library', prompt: '[R] LIBRARY', open: () => { window.dispatchEvent(new CustomEvent('open_library')); } },
            { pos: insuranceWorldPos, range: 11, yOff: 3, type: 'insurance' as const, label: 'Apex Mutual Insurance', prompt: '[R] INSURANCE', open: () => useGameStore.getState().openInsuranceModal() },
        ];

        // Scratch objects reused every frame (allocating new vectors each frame causes GC stutter)
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
        let carSyncAccum = 0;
        let lastDrawAt = 0; // performance.now() of the last renderer.render

        // ===================== Driving: one model in the town and in the Strip =====================
        // Night Tuner's vehicle (world/driver.ts) stepped at 120 Hz in metres; the car group follows
        // driver.pose(). The Speedway is now the gate to the Strip (scene/world/gate.ts), a second
        // scene (world/strip/scene.ts) the car group is moved into.
        const W = WORLD_PER_M;
        let district: 'town' | 'strip' = 'town';
        let driver: Driver | null = null;
        let driveSpec: { key: string; spec: VehicleSpec } | null = null; // specFor takes ~20 ms: once per car
        let paramsKey = '', kitKey = '';
        let kit: PartsKit | null = null;
        let wheelR = 1;                       // the driven body's wheel radius (world units), for the roll
        let lastStripRec: StripRecord | null | undefined;
        let driftMode = false, paused = false, resultsShown = false;
        let lobby = false, lobbyChecked = false, restarting = false;
        let rentalId: string | null = null;  // the rental being driven
        // a Strip visitor: a guest or an account holder (no lot in the town)
        const visitor = (): boolean => isVisitor(stateRef.current.gameState?.players[stateRef.current.playerId || '']);
        let lastShift = 0, lastBov = false, lastNos = false;
        let backspaceTap = false;             // Backspace: reset in the town (R parks / opens a bay there)
        let lastGarageCarId: string | null = null;
        let promptShown = '', nosShown = false, bannerId = 0;
        let mapFwd = false, mapBack = false;
        let viewCam: THREE.PerspectiveCamera = camera;
        let camOpt = 0;                       // the Camera option last applied (C still cycles the camera)
        const hudCanvas = hudCanvasRef.current, layerRoot = layerRef.current;
        const hud = hudCanvas ? new Hud(hudCanvas) : null;
        let hudSized = false;
        // App's phone layout (on-screen D-pad and buttons): the same test as App's isMobile
        const touchUi = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
        const driveCam = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 1, 6500);
        const chase = new ChaseCamera(driveCam);
        const audio = new NtAudio(getOptions().mute); // the Garage's Options: Sound
        const resumeAudio = () => audio.resume();
        window.addEventListener('keydown', resumeAudio);
        window.addEventListener('pointerdown', resumeAudio);
        const STOCK_BUILD = { cfg: STOCK_CFG, tune: TUNE_DEF };
        // A car's Garage build, read from the store's record without adding to it (carState would).
        const buildOf = (carId: string): { cfg: CarCfg; tune: Tune } => useGameStore.getState().strip?.cars[carId] ?? STOCK_BUILD;
        // the Garage's Options: Transmission (a drag is always manual)
        const isDrag = () => district === 'strip' && strip?.runner.active?.type === 'drag';
        const manualNow = () => getOptions().manual || isDrag();
        const im = new InputMap({ manual: manualNow, hydraulics: () => !!(localDrivingCarId && buildOf(localDrivingCarId).cfg.hydraulics) });
        type InvCar = { id: string; make?: string; model: string; bodyStyle?: string; fuel?: number };
        const styleOf = (car: InvCar) => (car.bodyStyle || deriveStyle(car.model)) as BodyStyle;
        const meNow = () => { const st = stateRef.current; return st.gameState?.players[st.playerId || '']; };
        const drivenCar = (): InvCar | undefined => meNow()?.inventory.find(c => c.id === localDrivingCarId);
        const specOf = (car: InvCar): VehicleSpec => {
            const key = `${car.id}|${car.make}|${car.model}|${styleOf(car)}`;
            if (!driveSpec || driveSpec.key !== key) driveSpec = { key, spec: specFor({ make: car.make, model: car.model, bodyStyle: styleOf(car) }) };
            return driveSpec.spec;
        };
        const perfKey = (b: { cfg: CarCfg; tune: Tune }) => JSON.stringify(b.cfg.perf) + JSON.stringify(b.tune);
        // The driven car wears its Garage build. The kit's neon PointLight is left out: a light added
        // to a scene recompiles every material in it (its glow stays).
        const fitKit = (mesh: THREE.Group, car: InvCar) => {
            if (kit) { disposeParts(kit); kit = null; }
            const { cfg } = buildOf(car.id);
            kit = attachParts(mesh, cfg, styleOf(car), cfg.perf.brakes);
            if (kit.neonLight) { kit.neonLight.removeFromParent(); kit.neonLight.dispose(); kit.neonLight = null; }
            kitKey = JSON.stringify(cfg);
        };
        // The Garage changed the record: new Params for new parts or tune, a new kit for new looks.
        const syncBuild = () => {
            const car = drivenCar(), mesh = localDrivingCarId ? carMeshes[localDrivingCarId] : undefined;
            if (!driver || !car || !mesh) return;
            const b = buildOf(car.id), pk = perfKey(b);
            if (pk !== paramsKey) { paramsKey = pk; driver.rebuild(specOf(car), b); }
            if (JSON.stringify(b.cfg) !== kitKey) fitKit(mesh, car);
        };
        const say = (txt: string, bad = false, hold = false) => useDriveUi.setState({ banner: { txt, bad, hold, id: ++bannerId } });
        const socketEmit = (ev: string, payload: unknown) => { useGameStore.getState().socket?.emit(ev, payload); };

        // ---- the Strip
        const stripExit = buildStripExit();
        const stripStage = () => stageOf(useGameStore.getState().strip?.rep ?? 0);
        const ordinal = (n: number) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
        const shownResults = (r: EventResults): ShownResults => ({
            title: r.failed ? r.failed : r.pos === 1 ? 'You won' : `${ordinal(r.pos)} place`,
            sub: `${EV_NAME[r.type]} · ${r.ev.name}`, pos: r.pos, failed: r.failed,
            rows: r.list.map(p => ({ name: p.name, me: !!p.me, txt: r.type === 'drift' ? (p.score ?? 0).toLocaleString('en-US') : p.ft != null ? fmtT(p.ft) + (p.estimated ? '*' : '') : 'DNF' })),
        });
        let strip: StripScene | null = null;
        const getStrip = () => strip ??= new StripScene({
            onBanner: (txt, bad, hold) => say(txt, !!bad, !!hold),
            onSfx: n => audio.sfx(n),
            stage: stripStage,
            styleRating: () => localDrivingCarId ? visualRating(buildOf(localDrivingCarId).cfg) : 0,
            renderer,
            onEventStart: (ev, PV) => { chase.reset(PV); resultsShown = false; paused = false; socketEmit('enter_event', { eventId: ev.id }); },
            onResults: r => {
                resultsShown = true;
                socketEmit('finish_event', { eventId: r.ev.id, pos: r.pos, time: r.time, score: r.score, failed: !!r.failed });
                useDriveUi.setState({ results: shownResults(r), reward: null });
            },
            // a restart keeps a rental for the entry that follows (the server returns it on a plain quit)
            onEventQuit: ev => socketEmit('quit_event', restarting ? { eventId: ev.id, restart: true } : { eventId: ev.id }),
            onOutrun: won => socketEmit('finish_outrun', { won }),
            // Night Tuner's near-miss cash is not ported (onNearMiss)
        });
        // a drag can blow the engine: it is fixed when the run is over (the event's cleanup does not touch the car)
        const mendEngine = () => { if (driver) { driver.V.blown = false; driver.V.overRev = 0; } };
        const closeResults = () => {
            resultsShown = false;
            useDriveUi.setState({ results: null, returned: null });
            strip?.runner.cleanup();
            mendEngine();
        };
        /** Into the Strip with the car being driven: the car group moves into the Strip's scene at its spawn. */
        const enterStrip = (): boolean => {
            const mesh = localDrivingCarId ? carMeshes[localDrivingCarId] : undefined;
            if (!driver || !mesh || district === 'strip') return false;
            const S = getStrip();
            S.load(); // builds the city and its cars (a short stall); S.scene is the city's scene from here
            if (stripExit.group.parent !== S.scene) S.scene.add(stripExit.group);
            // while it is away, the car's town spot is the gate
            socketEmit('sync_car_pos', { carId: localDrivingCarId, position: { x: GATE_RETURN.x, z: GATE_RETURN.z, r: GATE_RETURN.rotY }, district: 'town' });
            driver.place(STRIP_SPAWN.x, STRIP_SPAWN.z, STRIP_SPAWN.h);
            S.enter(driver.V, mesh);
            district = 'strip'; paused = false; resultsShown = false; driftMode = false;
            chase.reset(driver.V);
            interactPrompt.material.opacity = 0;
            const st = useGameStore.getState();
            if (st.activeInteraction) st.setActiveInteraction(null);
            useDriveUi.setState({ district: 'strip', paused: false, results: null, help: useDriveUi.getState().help + 1 });
            sendPlayerPos(); // now, so an event entered at once (a quick race) is entered from inside the Strip
            return true;
        };
        /** Back to the town gate (the exit ring, the pause menu): any event or outrun ends without a result.
         *  Not for a Strip visitor (a guest or an account holder): they have no town to go back to. */
        const exitStrip = (): boolean => {
            if (district !== 'strip' || !strip || visitor() || lobby) return false;
            strip.exit(); // cleans up the event, gives the car group back to the town scene
            district = 'town'; paused = false; resultsShown = false;
            mendEngine(); // a drag's blown engine stays in the Strip
            const mesh = localDrivingCarId ? carMeshes[localDrivingCarId] : undefined;
            if (driver) {
                driver.place(GATE_RETURN.x / W, GATE_RETURN.z / W, GATE_RETURN.rotY - Math.PI);
                const p = driver.pose();
                mesh?.position.set(p.x, 0, p.z); mesh?.rotation.set(0, p.rotY, 0);
                chase.reset(driver.V);
            }
            useDriveUi.setState({ district: 'town', paused: false, results: null, prompt: '' }); promptShown = '';
            sendPlayerPos();
            return true;
        };
        /** Night Tuner's respawn(): in a live event, back onto the route where you got to (a drag: nothing;
         *  the countdown and a finished run: nothing, so R never throws a race or a win away); else onto the nearest road. */
        const respawn = (S: StripScene, D: Driver) => {
            const a = S.runner.active, V = D.V;
            if (a) {
                if (a.type === 'drag' || a.state !== 'race' || a.results) return;
                const p = routePoint(a.route, a.pS);
                D.place(p.x, p.z, Math.atan2(p.tx, p.tz));
            } else { S.snap(V); mendEngine(); }
            chase.reset(V);
        };
        /** Our position to the server: in the Strip, the car's pose in the Strip's scene (world units, district 'strip'),
         *  which the server keeps apart from our town position (the gate spot), so Strip players see each other. */
        const sendPlayerPos = (): THREE.Object3D => {
            const activeMesh = (localDrivingCarId && carMeshes[localDrivingCarId]) || avatar;
            const at = lobby ? LOBBY_POS : activeMesh.position; // the lobby: standing at the rental bay
            useGameStore.getState().socket?.emit('sync_player_pos', {
                x: at.x, y: district === 'strip' ? 0 : at.y, z: at.z,
                rotation: lobby ? RENTAL_BAY.h : headingOf(activeMesh), // true heading (see headingOf)
                district,
            });
            return activeMesh;
        };
        // ---- other players in the Strip: name tags over where they drive (the town draws their dealers)
        const stripTags: Record<string, THREE.Sprite> = {};
        const dropStripTag = (id: string) => { const t = stripTags[id]; if (!t) return; t.removeFromParent(); t.material.map?.dispose(); t.material.dispose(); delete stripTags[id]; };
        const syncStripTags = (S: StripScene | null, follow: number) => {
            const cur = stateRef.current, players = cur.gameState?.players ?? {}, live = useGameStore.getState().playerPositions;
            for (const id in stripTags) {
                const sp = S && id !== cur.playerId && players[id] && live[id]?.district === 'strip' ? live[id].stripPosition : undefined;
                if (!sp || stripTags[id].userData.name !== players[id].name) dropStripTag(id);
            }
            if (!S) return;
            for (const id in players) {
                const sp = id !== cur.playerId && live[id]?.district === 'strip' ? live[id].stripPosition : undefined;
                if (!sp) continue;
                let t = stripTags[id];
                if (!t) {
                    t = stripTags[id] = nameSprite(players[id].name);
                    t.scale.set(7, 1.75, 1); t.position.set(sp.x, 5, sp.z);
                    S.scene.add(t);
                } else t.position.lerp(tmpTarget.set(sp.x, 5, sp.z), follow);
            }
        };
        const startEventById = (id: string, quick = false): boolean => {
            const ev = EVENTS.find(e => e.id === id);
            if (!ev || (district !== 'strip' && !enterStrip())) return false;
            if (resultsShown) closeResults();
            strip!.startEvent(ev, { quick });
            return true;
        };

        // ---- getting in and out
        const beginDriving = (carId: string): boolean => {
            const car = meNow()?.inventory.find(c => c.id === carId), mesh = carMeshes[carId];
            if (!car || !mesh || driver || aiDriveSequence[carId]) return false; // not a car out on a customer's test drive
            localDrivingCarId = carId;
            localFuel = car.fuel ?? 100; refuelRequestedIn = null;
            const b = buildOf(carId);
            paramsKey = perfKey(b);
            driver = new Driver(specOf(car), b, { x: mesh.position.x / W, z: mesh.position.z / W, h: headingOf(mesh) - Math.PI });
            wheelR = anchorsFor(styleOf(car)).wheelR;
            fitKit(mesh, car);
            lastStripRec = useGameStore.getState().strip;
            if (layerRoot) im.attach(layerRoot);
            chase.reset(driver.V);
            driftMode = false; hudSized = false; carSyncAccum = 0;
            const st = useGameStore.getState();
            st.setDrivingCarId(carId); st.setDrivingFuel(localFuel);
            chase.mode = camOpt = getOptions().cam; // the Garage's Options: Camera
            useDriveUi.setState({ driving: true, help: useDriveUi.getState().help + 1 }); // the controls line, for a few seconds
            return true;
        };
        /** Out of the car (always in the town): the kit comes off, the walking camera picks up from the chase camera. */
        const endDriving = () => {
            if (district === 'strip') exitStrip();
            dropCar();
            camera.position.copy(driveCam.position);
        };
        /** Leave the driven car where it is: input, kit, sound and the driving HUD go. */
        const dropCar = () => {
            im.detach();
            if (kit) { disposeParts(kit); kit = null; }
            audio.silence(); // the engine, skid and wind beds: nothing keeps playing on foot (or in the lobby)
            kitKey = ''; driver = null; localDrivingCarId = null; localFuel = null; rentalId = null;
            const st = useGameStore.getState();
            st.setDrivingCarId(null); st.setDrivingFuel(null);
            hud?.clear();
            useDriveUi.setState({ driving: false, prompt: '', nos: false, paused: false, eventLive: false, gears: false, mapOpen: false }); promptShown = ''; nosShown = false;
        };

        // ---- the rental lobby: a Strip visitor's "on foot" (Strip loaded, the camera on the bay, the counter open)
        const LOBBY_POS = new THREE.Vector3(RENTAL_BAY.x * W, 0, RENTAL_BAY.z * W);
        /** Into the lobby: the Strip without a car, the camera fixed on the rental bay. */
        const enterLobby = () => {
            const S = getStrip();
            S.load();
            if (stripExit.group.parent !== S.scene) S.scene.add(stripExit.group);
            stripExit.group.visible = !visitor(); // a visitor has no way back to town
            S.lobby(driveCam);
            lobby = true; district = 'strip'; paused = false;
            if (layerRoot) im.attach(layerRoot); // Esc and Enter (the pause menu, the results card)
            interactPrompt.material.opacity = 0;
            const st = useGameStore.getState();
            if (st.activeInteraction) st.setActiveInteraction(null);
            useDriveUi.setState({ district: 'strip', lobby: true, counter: !resultsShown, paused: false, prompt: '', driving: false }); promptShown = '';
            sendPlayerPos();
        };
        /** A dealer who landed in the lobby (a reload while in the Strip) walks back into the town. */
        const lobbyToTown = () => {
            strip?.leaveLobby(); lobby = false; district = 'town'; paused = false;
            im.detach();
            useDriveUi.setState({ district: 'town', lobby: false, counter: false, paused: false });
            sendPlayerPos();
        };
        /** The rental just arrived in the inventory: into it, at the bay, nose toward the exit ring at node [8, 8]. */
        const driveRental = (carId: string): boolean => {
            const S = strip, mesh = carMeshes[carId];
            if (!S || !mesh || driver || !beginDriving(carId)) return false;
            const D = driver as Driver | null; if (!D) return false;
            lobby = false; S.leaveLobby(); rentalId = carId;
            // the server's driven car: an event locks it, and closing the event hands it back
            socketEmit('sync_car_pos', { carId, district: 'strip' });
            D.place(RENTAL_BAY.x, RENTAL_BAY.z, RENTAL_BAY.h);
            S.enter(D.V, mesh);
            driveCam.fov = 62; driveCam.updateProjectionMatrix(); // from the lobby's narrower view
            paused = false; resultsShown = false; driftMode = false;
            chase.reset(D.V);
            useDriveUi.setState({ lobby: false, counter: false, paused: false, results: null, returned: null });
            sendPlayerPos();
            return true;
        };
        /** The driven rental went back (its event closed on the server): out of it, staying in the Strip, back to the
         *  lobby. A results card stays up until dismissed; `money` is what is on hand after the payout. */
        const rentalGone = (money: number) => {
            strip?.exit(); // ends what is left of the event, gives the car group back (the caller disposes it)
            mendEngine();
            dropCar();
            // on the results card when one is up; else (an outrun, a quit, a card already closed) as a banner
            if (resultsShown) useDriveUi.setState({ returned: money });
            else { useDriveUi.setState({ returned: null }); say(`Rental returned — $${Math.round(money).toLocaleString('en-US')} on hand`); }
            enterLobby();
        };
        /** One lobby frame: Esc / II pauses (Sign out for account holders), Enter / Continue closes the results card;
         *  the Strip's traffic drives by behind the counter. No car, no walking, no sound. */
        const lobbyFrame = (delta: number) => {
            const S = strip!;
            avatar.visible = false;
            im.poll();
            const E = im.edge, tapped = useDriveUi.getState().tap;
            if (tapped) useDriveUi.setState({ tap: null });
            const pauseK = E.pause || tapped === 'pause', enter = E.enter || tapped === 'enter';
            im.clearEdges();
            if (resultsShown) { if (enter || tapped === 'continue') closeResults(); }
            else if (paused) {
                if (pauseK || tapped === 'resume') paused = false;
                else if (tapped === 'signout' && useGameStore.getState().account) { paused = false; useGameStore.getState().signOut(); } // a fresh guest init follows: still the lobby
                else if (tapped === 'town' && !visitor()) { lobbyToTown(); return; }
            } else if (pauseK) paused = true;
            S.update(delta, true);
            stripExit.pulse(performance.now());
            const ui = useDriveUi.getState(), counter = !paused && !resultsShown;
            if (ui.paused !== paused || ui.counter !== counter || ui.eventLive) useDriveUi.setState({ paused, counter, eventLive: false });
        };

        // ---- the per-frame step
        const fuelNow = () => localFuel ?? 100;
        const burnFuel = (f: number) => { localFuel = Math.max(0, (localFuel ?? 100) - f); };
        const townOpts: DriveOpts = { drift: false, fuel: fuelNow, burn: burnFuel, collide: townCollider(staticCollisionBoxes) };
        const stripOpts: DriveOpts = {
            drift: false, fuel: fuelNow, burn: burnFuel,
            collide: V => { const S = strip!; const i = S.collide(V); S.runner.postStep(STEP); return i; },
            map: (I, dt) => strip!.runner.input(I, dt),
        };
        const NONE: never[] = [];
        const hudState: HudState = { PV: null as never, event: null, standings: NONE, outrun: null, gps: null, markers: NONE, roads: NONE, ais: NONE, money: 0, units: 'mph', manual: false, small: false, touch: touchUi, district: 'town' };
        // the old keys (and the phone D-pad, which sets them) drive too
        const legacyInput = (I: Input) => {
            if (I.hyd) return;
            if (keys.w) I.fwd = 1;
            if (keys.s) I.back = 1;
            if (keys.a || keys.d) I.steer = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
        };
        const drawMap = (S: StripScene) => {
            const g = hudCanvas?.getContext('2d'); if (!g || !hudCanvas) return;
            const w = hudCanvas.clientWidth || window.innerWidth, h = hudCanvas.clientHeight || window.innerHeight, d = Math.min(2, window.devicePixelRatio || 1);
            g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
            S.drawMapInto(g, w, h - 40);
            const items = S.mapItems(), it = items[S.mapSel];
            g.fillStyle = '#ffd23f'; g.textAlign = 'center'; g.font = "italic 800 20px 'Barlow Condensed','Arial Narrow',sans-serif";
            g.fillText((it ? it.n : '') + '   ·   ↑↓ choose · Enter set GPS · M close', w / 2, h - 16);
        };
        const driveFrame = (delta: number, me: { money: number; lotPosition?: Lot; inventory: InvCar[] }) => {
            const id = localDrivingCarId!, mesh = carMeshes[id], D = driver!, V = D.V, opt = getOptions();
            if (opt.cam !== camOpt) chase.mode = camOpt = opt.cam;
            if (opt.mute !== audio.isMuted) audio.setMute(opt.mute);
            const st = useGameStore.getState(), S = district === 'strip' ? strip : null;
            avatar.visible = false;
            // fuel: adopt a server refuel (a big jump, or the full tank just paid for at a pump)
            const liveCar = me.inventory.find(c => c.id === id);
            if (localFuel === null) localFuel = liveCar?.fuel ?? 100;
            if (liveCar && typeof liveCar.fuel === 'number' && (liveCar.fuel - localFuel > 15 || (refuelRequestedIn && stateRef.current.gameState !== refuelRequestedIn && liveCar.fuel >= 100))) { localFuel = liveCar.fuel; refuelRequestedIn = null; }
            if (st.strip !== lastStripRec) { lastStripRec = st.strip; syncBuild(); }
            const garageOpen = !!st.garageCarId;
            if (garageOpen) im.releaseAll();

            // ---- input: edges once per frame
            im.poll();
            const E = im.edge, tapped = useDriveUi.getState().tap;
            if (tapped) useDriveUi.setState({ tap: null });
            const frozen = garageOpen || paused || resultsShown || !!S?.mapOpen;
            let I: Input = NO_INPUT;
            if (!frozen) { I = im.build(); legacyInput(I); }
            if (E.camera) chase.cycle();
            if (E.horn) audio.sfx('horn');
            if (E.lights) V.lights = !V.lights;
            if (E.drift && !frozen) { driftMode = !driftMode; say(driftMode ? 'Drift mode' : 'Grip mode'); }
            chase.lookBack = !!im.keys.look && !frozen;
            const enter = E.enter || tapped === 'enter';
            // the phone's buttons (DriveLayer): the same as Esc, M and R
            const pauseK = E.pause || tapped === 'pause', mapK = E.map || tapped === 'map', resetK = E.reset || tapped === 'reset';
            let prompt = '', leave = false;
            if (S) {
                const a = S.runner.active, free = !a && !S.outrun;
                const fwdK = !!im.keys.fwd || keys.w, backK = !!im.keys.back || keys.s; // keys: the phone's D-pad
                if (S.mapOpen) {
                    if (fwdK && !mapFwd) S.mapMove(-1);
                    if (backK && !mapBack) S.mapMove(1);
                    if (enter) S.mapActivate(); else if (mapK || pauseK) S.toggleMap(false);
                } else if (resultsShown) {
                    if (enter || tapped === 'continue') closeResults();
                } else if (paused) {
                    if (pauseK || tapped === 'resume') paused = false;
                    else if (tapped === 'town' && !visitor()) leave = true;
                    else if (tapped === 'restart' && a && !a.results) { paused = false; restarting = true; try { startEventById(a.ev.id, a.quick); } finally { restarting = false; } } // cleanup (quit_event, restart: true), then enter_event
                    else if (tapped === 'quit' && a && !a.results) { paused = false; S.runner.quit(); mendEngine(); chase.reset(V); } // quit_event
                } else {
                    if (pauseK) paused = true;
                    else if (mapK && free) S.toggleMap(true);
                    else if (resetK) respawn(S, D);
                    if (E.laneL) S.runner.dragLane(-1);
                    if (E.laneR) S.runner.dragLane(1);
                    if (free && !visitor() && stripExit.isOnExit(V.x, V.z)) { prompt = '[Enter] BACK TO TOWN'; if (enter) leave = true; }
                    else { const t = S.promptText(); if (t) prompt = t.replace('Enter · ', '[Enter] '); if (enter) S.pressEnter(); }
                }
                mapFwd = fwdK; mapBack = backK;
            } else if (!garageOpen) {
                if (backspaceTap || tapped === 'reset') { D.place(V.x, V.z, V.h); }
                if (gate.isOnGate(mesh.position.x, mesh.position.z)) { prompt = '[Enter] THE STRIP'; if (enter) enterStrip(); }
                else if (me.lotPosition && onLot(me.lotPosition, mesh.position) && Math.abs(V.u) < 1.5) {
                    prompt = '[Enter] GARAGE';
                    if (enter) { im.releaseAll(); st.openGarage(id); }
                }
            }
            backspaceTap = false;

            // ---- physics
            const inStrip = district === 'strip' && !!strip, halt = paused || (inStrip && strip!.mapOpen);
            // simDt: the time the physics actually ran this frame (≤ 0.05 s, 0 when halted); the Strip's AI and
            // events, the wheels and the camera run on it, so nothing outpaces the player on a slow frame
            let impact = 0, simDt = 0;
            if (!halt) {
                const opts = inStrip ? stripOpts : townOpts;
                opts.drift = driftMode || (inStrip && strip!.runner.active?.type === 'drift');
                const r = D.stepFrame(delta, I, opts); impact = r.impact; simDt = r.steps * STEP;
            }
            im.clearEdges();
            if (impact > 3) { chase.shake = Math.min(1, chase.shake + impact / 14); audio.sfx('crash'); }
            if (V.shift > 0 && lastShift <= 0) audio.sfx('shift');
            lastShift = V.shift;
            const bov = V.bov > .38; if (bov && !lastBov) audio.sfx('bov'); lastBov = bov;
            if (V.nosOn && !lastNos) audio.sfx('nosfire'); lastNos = V.nosOn;
            audio.engine(V, Math.abs(V.u), !halt && !garageOpen);

            // ---- the car follows the physics
            const p = D.pose();
            mesh.position.set(p.x, 0, p.z); mesh.rotation.set(0, p.rotY, 0);
            const wheels = carWheels[id];
            if (wheels && !halt) { const roll = -V.u * W / wheelR * simDt; for (const w of wheels) w.rotateX(roll); }
            const pivots = carSteering[id];
            if (pivots) for (const q of pivots) q.rotation.y = V.delta;
            syncCarWheels(mesh);
            setCarLights(mesh, !V.lights ? 'off' : V.gear === -1 && V.u < -0.5 ? 'reverse' : V.brk > 0 && V.u > 0.5 ? 'brake' : 'on');
            if (inStrip) { strip!.update(simDt, !paused && !resultsShown && !strip!.mapOpen && !garageOpen); stripExit.pulse(performance.now()); }
            chase.update(V, simDt, V.nosOn);

            // ---- HUD
            if (hud && hudCanvas) {
                if (!hudSized && hudCanvas.clientWidth > 0) { hud.resize(); hudSized = true; }
                if (inStrip && strip!.mapOpen) drawMap(strip!);
                else {
                    const h = hudState, T = inStrip ? strip! : null, a = T ? T.runner.active : null;
                    h.PV = V; h.district = district; h.event = a; h.standings = a ? T!.runner.standings() : NONE;
                    h.outrun = T ? T.outrun : null; h.gps = T ? T.gpsTarget : null; h.markers = T ? T.hudMarkers() : NONE; h.roads = T ? T.hudRoads() : NONE; h.ais = T ? T.ais : NONE;
                    h.money = me.money; h.units = opt.units; h.manual = manualNow(); h.touch = touchUi || window.innerWidth <= 1024; h.small = window.innerWidth < 700 || h.touch; h.stage = stripStage();
                    hud.draw(h);
                }
            }
            if (prompt !== promptShown) { promptShown = prompt; useDriveUi.setState({ prompt }); }
            if (V.nosOn !== nosShown) { nosShown = V.nosOn; useDriveUi.setState({ nos: nosShown }); }
            const ui = useDriveUi.getState(), act = inStrip ? strip!.runner.active : null, live = !!act && !act.results;
            const gearsOn = manualNow(), mapOn = inStrip && strip!.mapOpen;
            if (paused !== ui.paused || live !== ui.eventLive || gearsOn !== ui.gears || mapOn !== ui.mapOpen) useDriveUi.setState({ paused, eventLive: live, gears: gearsOn, mapOpen: mapOn });

            // ---- fuel gauge 5x/s, the tank and the car's spot to the server
            fuelUiAccum += delta; fuelNetAccum += delta; carSyncAccum += delta;
            if (fuelUiAccum > 0.2) { fuelUiAccum = 0; useGameStore.setState({ drivingFuel: Math.round(localFuel ?? 100), drivingSpeed: Math.round(Math.abs(V.u) * 2.237) }); }
            if (fuelNetAccum > 1.5) { fuelNetAccum = 0; st.consumeFuel(id, Math.round(localFuel ?? 100)); }
            // ~3x a second in the town (in the Strip the car's town spot stays the gate)
            if (carSyncAccum > 0.33) { carSyncAccum = 0; if (district === 'town') st.socket?.emit('sync_car_pos', { carId: id, position: { x: mesh.position.x, z: mesh.position.z, r: headingOf(mesh) }, district: 'town' }); }
            if (leave) exitStrip();
        };

        // A tiny handle for scripted checks (the Task 12 smoke test), in every build.
        const micar = {
            pose: () => {
                const p = driver ? driver.pose() : { x: avatar.position.x, y: avatar.position.y, z: avatar.position.z, rotY: headingOf(avatar) };
                const V = driver?.V;
                return { x: p.x, y: p.y, z: p.z, rotY: p.rotY, district, driving: !!driver, speed: V ? V.u : 0, gear: V ? V.gear : 0, rpm: V ? Math.round(V.rpm) : 0, redline: V ? V.P.redline : 0 };
            },
            /** get into a car: `carId`, else the nearest of your cars */
            drive: (carId?: string): boolean => {
                if (driver) return true;
                let id = carId ?? null, best = Infinity;
                if (!id) for (const c of meNow()?.inventory ?? []) { const m = carMeshes[c.id]; if (!m || aiDriveSequence[c.id]) continue; const d = m.position.distanceTo(avatar.position); if (d < best) { best = d; id = c.id; } }
                return !!id && beginDriving(id);
            },
            /** put the car being driven at (x, z) world units of the current district, facing rotY (a scene rotation.y) */
            place: (x: number, z: number, rotY = Math.PI): boolean => { if (!driver) return false; driver.place(x / W, z / W, rotY - Math.PI); chase.reset(driver.V); return true; },
            enterStrip: () => enterStrip(),
            exitStrip: () => exitStrip(),
            /** rent a car at the counter (the same call the counter's buttons make) */
            rent: (key: string): boolean => { const me = meNow(); if (!me || !canRent(me).ok) return false; useGameStore.getState().rentCar(key); return true; },
            /** in the rental lobby (a Strip visitor without a car) */
            lobby: () => lobby,
            startEvent: (id: string) => startEventById(id),
            district: () => district,
            /** the engine beds' gains (engine, turbo, skid, nitrous, wind); all 0 once out of the car */
            audioLevels: () => audio.levels(),
            /** your money (dollars), as the client has it */
            money: (): number => meNow()?.money ?? 0,
            /** the ids of the cars you hold (the smoke checks a returned rental is gone) */
            cars: (): string[] => (meNow()?.inventory ?? []).map(c => c.id),
            /** the live event, if any: its id, state ('count' | 'race' | 'done') and whether results are in */
            event: () => { const a = district === 'strip' ? strip?.runner.active : null; return a ? { id: a.ev.id, state: a.state, results: !!a.results, pS: a.pS } : null; },
            /** the ids of the other players drawn in the Strip */
            stripPlayers: () => Object.keys(stripTags),
            /** sign in with a magic-link token, as the link's page does (the smoke) */
            linkMagic: (token: string) => { useGameStore.getState().linkAccount({ magic: token }); },
            /** open the Garage menu on `carId`, else your first car (the same call the lot's [Enter] GARAGE makes) */
            openGarage: (carId?: string): boolean => { const c = carId ?? meNow()?.inventory?.[0]?.id; if (!c) return false; useGameStore.getState().openGarage(c); return true; },
        };
        (window as unknown as { __micar?: typeof micar }).__micar = micar;


        const FAR_AWAY = new THREE.Vector3(1e6, 0, 1e6);
        /** a player's name on a billboard (the town's remote players, and the Strip's) */
        function nameSprite(name: string): THREE.Sprite {
            const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0,0,256,64);
                ctx.fillStyle = '#ffffff'; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(name, 128, 42);
            }
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
            sprite.userData.name = name;
            return sprite;
        }
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
            // a quick race asked for from the Garage: drive the Garage's car (if on foot) into the Strip and start it
            const garageId = useGameStore.getState().garageCarId;
            if (garageId) lastGarageCarId = garageId;
            // the Garage was left on another of your cars ("Your cars"): step out of this one and into that one
            const wantCar = useDriveUi.getState().driveCar;
            if (wantCar) {
                useDriveUi.setState({ driveCar: null });
                if (driver && localDrivingCarId !== wantCar && carMeshes[wantCar] && !aiDriveSequence[wantCar] && meNow()?.inventory.some(c => c.id === wantCar)) { endDriving(); beginDriving(wantCar); }
            }
            const quick = useDriveUi.getState().quick;
            if (quick) {
                useDriveUi.setState({ quick: null });
                if (!driver && lastGarageCarId) beginDriving(lastGarageCarId);
                if (driver) startEventById(quick, true);
            }
            const isDriving = !!localDrivingCarId;
            viewCam = driver ? driveCam : camera;
            gate.pulse(performance.now());
            const me = current.gameState?.players[current.playerId || ''];
            // A Strip visitor never stands in the town: a guest (or, on mount, anyone the server has in the
            // Strip without a car) starts in the rental lobby
            if (me && !lobby && !driver && district === 'town' && (me.guest || (!lobbyChecked && me.worldPosition?.district === 'strip'))) enterLobby();
            if (me) lobbyChecked = true;

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
            const gatePos = district === 'strip' ? FAR_AWAY : activeObj.position; // in the Strip: nowhere near a lot
            const now = performance.now();
            const authorized = now < gateAuthorizedUntil;
            let showGateKeypad = false;
            dealershipGates.forEach(g => {
                let open = false;
                if (g.ownerId === current.playerId) {
                    const dx = gatePos.x - g.x;
                    const dz = gatePos.z - g.z;
                    const near = Math.hypot(dx, dz) < 24 && Math.abs(dx) < 26;
                    const inside = gatePos.z < g.z - 0.5;
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
            if (eJustPressed && !lobby) {
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
                        if (closestCar) beginDriving(closestCar);
                    }
                } else if (district === 'strip') {
                    if (!visitor()) say('Drive onto the gate ring to leave the Strip');
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
                    // Persist where the car was left (the periodic sync can be up to 0.33 s old, many
                    // units at speed) and the final fuel level. (The car stops: the next drive starts a new Driver.)
                    const exitedCar = carMeshes[localDrivingCarId!];
                    if (exitedCar) useGameStore.getState().socket?.emit('sync_car_pos', { carId: localDrivingCarId, position: { x: exitedCar.position.x, z: exitedCar.position.z, r: headingOf(exitedCar) }, district: 'town' });
                    if (localDrivingCarId && localFuel !== null) useGameStore.getState().consumeFuel(localDrivingCarId, localFuel);
                    endDriving();
                }
            }

            // Object Synchronization
            carFrameTick();
            updateCarLights(district === 'strip' ? 1 : nightFactor); // lamps of driven cars glow brighter as night falls (always night in the Strip)
            if (me) {
                me.inventory.forEach((car) => {
                    if (!carMeshes[car.id]) {
                        const carStyle = (car as any).bodyStyle || deriveStyle(car.model);
                        // body styles are built a few milliseconds per frame; the car appears once its style is ready
                        if (!carStyleReady(carStyle)) return;
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
                            // the driven car's kit set the paint finish: take it off, repaint, fit it again
                            const refit = car.id === localDrivingCarId && kit;
                            if (refit) { disposeParts(kit!); kit = null; }
                            applyCarPaint(body, carColorHex(car.color), car.bodyCondition ?? 100, !!car.isDirty);
                            if (refit) fitKit(carMeshes[car.id], car);
                        }
                    }
                    // head and tail lamps on while a customer test-drives it (yours: driveFrame, with braking and reversing)
                    if (car.id !== localDrivingCarId) setCarLights(carMeshes[car.id], aiDriveSequence[car.id] ? 'on' : 'off');
                    // AI Pathing Spawn Subroutine
                    if (car.hasOffer && !aiBots[car.id]) {
                        // A customer walks up to the car (seeded by the car, so the same car brings the same person)
                        const person = new Character(customerLook(car.id), car.id);
                        const group = new THREE.Group();
                        group.add(person.root);
                        const lotX = me?.lotPosition?.x || 0;
                        const lotZ = me?.lotPosition?.z || 0;
                        group.position.set(lotX + (Math.random() * 20 - 10), 0, lotZ + 40); // Distributed slightly relative to lot
                        scene.add(group);

                        const spot = customerSpot(carMeshes[car.id], group.position);
                        aiBots[car.id] = { mesh: group, person, targetPos: spot, status: 'walking_in', route: laneRoute({ x: lotX, z: lotZ }, group.position, spot) };
                    } else if (!car.hasOffer && aiBots[car.id] && aiBots[car.id].status !== 'walking_out' && !negotiatingFor(aiBots[car.id], car.id)) {
                        // Offer accepted or declined (or the walk-in stopped negotiating), customer leaves!
                        aiBots[car.id].status = 'walking_out';
                        aiBots[car.id].targetPos = customerExit(me.lotPosition);
                        aiBots[car.id].route = laneRoute(me.lotPosition, aiBots[car.id].mesh.position, aiBots[car.id].targetPos);
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
                        aiBots[key].targetPos = customerExit(me.lotPosition);
                        aiBots[key].route = laneRoute(me.lotPosition, aiBots[key].mesh.position, aiBots[key].targetPos);
                    }
                });

                // Clean up 3D meshes (and every per-car record) for sold cars
                const ownedIds = new Set(me.inventory.map(c => c.id));
                Object.keys(carMeshes).forEach(carId => {
                    if (ownedIds.has(carId)) return;
                    if (carId === localDrivingCarId && (carId === rentalId || visitor())) rentalGone(me.money); // a rental went back: the lobby
                    else if (carId === localDrivingCarId) {
                        // The car was sold/removed while we were driving it: step out (leaving the Strip and any event).
                        if (district === 'strip') exitStrip();
                        avatar.position.copy(carMeshes[carId].position).add(new THREE.Vector3(-3, 0, 0));
                        endDriving();
                    }
                    disposeCarModel(carMeshes[carId]);
                    delete carMeshes[carId];
                    delete carBodies[carId];
                    delete carSmokes[carId];
                    delete carWheels[carId];
                    delete carSteering[carId];
                    delete aiDriveSequence[carId];
                });
                // in the lobby, a rental (just rented, or held from before) is driven at once
                if (lobby && !driver) { const r = heldRental(me); if (r && carMeshes[r.id]) driveRental(r.id); }
            }

            // Passive Automatic Car Wash
            if (me) {
                me.inventory.forEach(car => {
                    const m = carMeshes[car.id];
                    if (!m || (district === 'strip' && car.id === localDrivingCarId)) return;
                    
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
            if (rJustPressed && me && district === 'town') {
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
             // ~12% chance per second that a waiting customer takes the car out
             const testDriveChance = 1 - Math.pow(1 - 0.002, delta * 60);
             
             Object.entries(aiBots).forEach(([key, bot]) => {
                  if (bot.status === 'walking_in') {
                      // Walk up beside the car
                      if (walkCustomer(bot, bot.targetPos, delta)) bot.status = 'waiting';
                  } else if (bot.status === 'waiting') {
                      // Stand by the car looking at it: breathing, shifting weight, glancing around
                      const viewed = carMeshes[key];
                      if (viewed && key !== localDrivingCarId && me?.lotPosition && viewed.position.distanceTo(bot.mesh.position) > 9) {
                          // the car was parked somewhere else: walk over to it
                          bot.targetPos = customerSpot(viewed, bot.mesh.position);
                          bot.route = laneRoute(me.lotPosition, bot.mesh.position, bot.targetPos);
                          bot.status = 'walking_in';
                          return;
                      }
                      const turning = viewed ? faceToward(bot.mesh, viewed.position.x - bot.mesh.position.x, viewed.position.z - bot.mesh.position.z, delta) : 0;
                      bot.person.update(delta, 0, turning);
                      
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
                           if (dist > 0.01) car.rotation.set(0, Math.atan2(-dx, -dz), 0); // nose (-Z) along the direction of travel
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
                           if (localWheels) { localWheels.forEach(w => w.rotateX(-AI_DRIVE_SPEED * delta * 0.5)); syncCarWheels(car); }
                      }
                  } else if (bot.status === 'walking_out') {
                      bot.mesh.visible = true; // In case they left from a test drive
                      if (bot.agentId) { delete aiBots[key]; return; } // a walk-in: updateWalkIns walks them on
                      if (walkCustomer(bot, bot.targetPos, delta)) {
                          // Gone: free their colours and skeleton (the body shape and material are shared)
                          bot.person.dispose();
                          bot.mesh.removeFromParent();
                          delete aiBots[key];
                      }
                  }
             });

             // Walk-in customers browsing the lot, arriving and leaving
             if (me) updateWalkIns(me, delta);
             // Our look comes from our name (every client draws us the same)
             if (me && me.name !== avatarName) {
                 avatarName = me.name;
                 avatarPerson.dispose();
                 avatarPerson = new Character(dealerLook(avatarName), avatarName);
                 avatar.add(avatarPerson.root);
             }

             // --- Dynamic Interaction Prompts ---
             // Fade speeds are per second so the label behaves the same at any frame rate.
             interactPrompt.material.opacity = Math.max(0.0, interactPrompt.material.opacity - 6 * delta);
             const showPrompt = (pos: THREE.Vector3, yOff: number, text: string) => {
                  interactPrompt.position.set(pos.x, pos.y + yOff, pos.z);
                  interactPrompt.material.opacity = Math.min(1.0, interactPrompt.material.opacity + 12 * delta);
                  setPromptText(text);
             };
             if (!localDrivingCarId && !lobby) {
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
             } else if (district === 'town') {
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

            // Driving: one model in the town and in the Strip (driveFrame, above)
            if (localDrivingCarId && driver && carMeshes[localDrivingCarId] && me) {
                driveFrame(delta, me);
                // Refuel at a gas station (R while parked at a pump), in the town
                if (district === 'town' && localDrivingCarId) {
                    const activeCar = carMeshes[localDrivingCarId];
                    if (gasPumps.some(p => activeCar.position.distanceTo(p) < 9)) {
                        showPrompt(activeCar.position, 6, '[R] REFUEL');
                        if (rJustPressed && (localFuel ?? 100) < 99) { keys.r = false; rWasPressed = false; refuelRequestedIn = current.gameState; useGameStore.getState().refuel(localDrivingCarId); }
                    }
                }
            } else if (lobby && strip) {
                lobbyFrame(delta);
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
                    // Avatar box (0.6 x 3.4 x 0.6: as tall as the dealer) — kept narrow so it doesn't snag on corners
                    tmpAvatarBox.min.set(x - 0.3, avatar.position.y, z - 0.3);
                    tmpAvatarBox.max.set(x + 0.3, avatar.position.y + 3.4, z + 0.3);
                    for (let i = 0; i < staticCollisionBoxes.length; i++) if (tmpAvatarBox.intersectsBox(staticCollisionBoxes[i])) return true;
                    return false;
                };

                // Try each axis separately so the avatar slides along walls
                const fromX = avatar.position.x, fromZ = avatar.position.z;
                if (Math.abs(moveVec.x) > 0.001 && !blockedAt(avatar.position.x + moveVec.x, avatar.position.z)) avatar.position.x += moveVec.x;
                if (Math.abs(moveVec.z) > 0.001 && !blockedAt(avatar.position.x, avatar.position.z + moveVec.z)) avatar.position.z += moveVec.z;

                // Animate the dealer by how far they really moved along their facing (so they stop
                // stepping against a wall, and step backward when backing up)
                tmpFwd.set(0, 0, -1).applyQuaternion(avatar.quaternion);
                const forwardSpeed = delta > 0 ? ((avatar.position.x - fromX) * tmpFwd.x + (avatar.position.z - fromZ) * tmpFwd.z) / delta : 0;
                avatarPerson.update(delta, forwardSpeed, (keys.a ? 3 : 0) - (keys.d ? 3 : 0));

                if (keys.a) avatar.rotateY(walkRotSpeed);
                if (keys.d) avatar.rotateY(-walkRotSpeed);

                // Behind and above the 3.5-unit-tall dealer, looking at their upper body
                tmpCam.set(0, 5.2, 11.5).applyQuaternion(avatar.quaternion).add(avatar.position);
                camera.position.lerp(tmpCam, damp(0.15, delta));
                tmpLook.set(avatar.position.x, avatar.position.y + 2.6, avatar.position.z);
                camera.lookAt(tmpLook);
            }

            // --- MULTIPLAYER POSITION SYNC ---
            if (current.playerId && useGameStore.getState().socket && (time - lastPosEmitTime > 0.1)) {
                lastPosEmitTime = time;
                const activeMesh = sendPlayerPos();
                // Feed the GPS our live position directly so it follows instantly (the town's map: not from the Strip).
                const st = useGameStore.getState();
                if (district === 'town' && (!st.myWorldPos || Math.hypot(activeMesh.position.x - st.myWorldPos.x, activeMesh.position.z - st.myWorldPos.z) > 2.5)) { // ~0.4 px on the minimap; finer updates only re-rendered it
                    st.setMyWorldPos({ x: activeMesh.position.x, z: activeMesh.position.z });
                }
            }

            if (current.gameState && current.gameState.players) {
                const activeIds = new Set(Object.keys(current.gameState.players));
                Object.keys(otherPlayerMeshes).forEach(id => {
                    if (!activeIds.has(id) || id === current.playerId) removeOtherPlayer(id);
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
                    if (meshGroup && meshGroup.userData.name !== p.name) { removeOtherPlayer(p.id); meshGroup = otherPlayerMeshes[p.id]; } // renamed: new look
                    if (!meshGroup) {
                        // Their dealer, from their name (the same rule as our own avatar)
                        meshGroup = new THREE.Group();
                        const person = new Character(dealerLook(p.name), p.name);
                        meshGroup.add(person.root);
                        meshGroup.userData.person = person;
                        meshGroup.userData.name = p.name;
                        meshGroup.userData.inCar = 0;
                        
                        const sprite = nameSprite(p.name);
                        sprite.position.y = 4.4; sprite.scale.set(3, 0.75, 1); meshGroup.add(sprite); // above their head

                        // Start where they are (not at the world origin, sliding in from there)
                        meshGroup.position.set(wp.x, wp.y ?? 0, wp.z);
                        meshGroup.quaternion.setFromAxisAngle(UP, wp.rotation ?? 0);
                        scene.add(meshGroup);
                        otherPlayerMeshes[p.id] = meshGroup;
                    }
                    // only players in the town are drawn here (a missing district is the town: older servers drop it)
                    meshGroup.visible = ((wp as { district?: string }).district ?? 'town') === 'town';
                    meshGroup.position.lerp(tmpTarget.set(wp.x, wp.y ?? 0, wp.z), follow);
                    meshGroup.quaternion.slerp(tmpQuat.setFromAxisAngle(UP, wp.rotation ?? 0), follow);
                    // How fast they really move: their network position over half-second windows
                    // (updates arrive in bursts, so per-update speeds are noisy). Walk or run at that
                    // speed; faster than anyone runs means they're driving (we don't draw their
                    // car): hide their body and keep the name label.
                    const ud = meshGroup.userData, person = ud.person as Character, nowS = now / 1000;
                    if (ud.winT === undefined) { ud.winX = wp.x; ud.winZ = wp.z; ud.winT = nowS; ud.netSpeed = 0; ud.netDir = 1; }
                    else if (nowS - ud.winT >= 0.5) {
                        const ddx = wp.x - ud.winX, ddz = wp.z - ud.winZ;
                        ud.netSpeed = Math.hypot(ddx, ddz) / (nowS - ud.winT);
                        tmpFwd.set(0, 0, -1).applyQuaternion(meshGroup.quaternion);
                        ud.netDir = ddx * tmpFwd.x + ddz * tmpFwd.z < 0 ? -1 : 1; // backing up?
                        ud.winX = wp.x; ud.winZ = wp.z; ud.winT = nowS;
                    }
                    ud.inCar = ud.netSpeed > 26 ? 1.5 : Math.max(0, ud.inCar - delta); // seconds left
                    person.root.visible = ud.inCar <= 0;
                    if (person.root.visible) person.update(delta, Math.min(ud.netSpeed, 18) * (ud.netDir ?? 1));
                });

                syncStripTags(district === 'strip' ? strip : null, follow);

                // Everyone stands on the ground under them (sidewalks, lawns and curbs are higher than the road)
                groundHeight.tick();
                if (avatar.visible) avatarPerson.standOn(groundHeight.at(avatar.position.x, avatar.position.z), delta);
                for (const id in aiBots) { const b = aiBots[id]; if (b.mesh.visible) b.person.standOn(groundHeight.at(b.mesh.position.x, b.mesh.position.z), delta); }
                for (const id in walkIns) { const w = walkIns[id]; if (w.mode !== 'attached') w.person.standOn(groundHeight.at(w.mesh.position.x, w.mesh.position.z), delta); }
                for (const id in otherPlayerMeshes) {
                    const g = otherPlayerMeshes[id], pp = g.userData.person as Character | undefined;
                    if (pp && pp.root.visible) pp.standOn(groundHeight.at(g.position.x, g.position.z), delta);
                }

                // Low graphics: a soft blob shadow under everyone (High has real shadows)
                blobs.begin();
                if (quality === 'low') {
                    if (avatar.visible) blobs.add(avatar.position.x, avatar.position.z, avatarPerson);
                    for (const id in aiBots) { const b = aiBots[id]; if (b.mesh.visible) blobs.add(b.mesh.position.x, b.mesh.position.z, b.person); }
                    for (const id in walkIns) { const w = walkIns[id]; if (w.mode !== 'attached') blobs.add(w.mesh.position.x, w.mesh.position.z, w.person); }
                    for (const id in otherPlayerMeshes) {
                        const g = otherPlayerMeshes[id], pp = g.userData.person as Character | undefined;
                        if (pp && pp.root.visible) blobs.add(g.position.x, g.position.z, pp);
                    }
                }
                blobs.end();
            }
            
            const drivenMesh = (localDrivingCarId && carMeshes[localDrivingCarId]) || null;
            if (district === 'town') {
                // Move the small pool of real lights to the lamps nearest the player
                const focusObj = drivenMesh || avatar;
                lightPool.update(focusObj.position, nightFactor, delta);
                atmosphere.followShadow(focusObj.position);
                atmosphere.updateEnvironment(quality === 'high');
            }
            // distant cars as their far versions, contact shadows under moved cars, headlight beam
            updateCars(viewCam.position, quality === 'high', drivenMesh);
            if (drivenMesh && kit) syncKitLod(drivenMesh);
            // (from 1.5 s and 30 frames after the first frame, so joining itself is not slowed down)
            if (!carPrecompileAt) carPrecompileAt = now + 1500;
            else if (now >= carPrecompileAt && ++carPrecompileFrames > 30 && district === 'town') precompileCarsTick(renderer, scene, viewCam);

            // On Low, while the phone menu covers the world and nothing moves the
            // camera, draw ~10x a second instead of every frame (the game itself
            // keeps running every frame). Frees the phone's GPU for the menu.
            const idleBehindMenu = quality === 'low' && useGameStore.getState().menuCoversWorld
                && !localDrivingCarId && !keys.w && !keys.a && !keys.s && !keys.d;
            if (district === 'strip' && strip) {
                // the Strip is lit for itself: the town's time-of-day exposure stays the town's
                const exposure = renderer.toneMappingExposure;
                renderer.toneMappingExposure = 1;
                renderer.render(strip.scene, driveCam);
                renderer.toneMappingExposure = exposure;
                lastDrawAt = now;
            } else if (!idleBehindMenu || now - lastDrawAt >= 100) {
                lastDrawAt = now;
                renderer.render(scene, viewCam);
            }
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
            window.removeEventListener('keydown', resumeAudio);
            window.removeEventListener('pointerdown', resumeAudio);
            delete (window as unknown as { __micar?: unknown }).__micar;
            im.detach();
            audio.dispose();
            hud?.clear();
            useDriveUi.setState({ driving: false, district: 'town', prompt: '', results: null, paused: false, eventLive: false, gears: false, mapOpen: false, nos: false, lobby: false, counter: false, account: false, returned: null });
            lightPool.dispose();
            uiTex.dispose();
            gate.dispose();
            Object.values(aiBots).forEach(b => { if (!b.agentId) { b.mesh.removeFromParent(); b.person.dispose(); } }); // walk-ins: below
            Object.keys(walkIns).forEach(removeWalkIn);
            Object.keys(otherPlayerMeshes).forEach(removeOtherPlayer);

            // Dispose procedural city materials & textures
            cityMaterials.forEach(m => m.dispose());
            cityTextures.forEach(t => t.dispose());
            
            if (kit) { disposeParts(kit); kit = null; }
            strip?.dispose(); // gives a driven car back to the town scene; before the shared car assets go
            stripExit.dispose();
            Object.values(carMeshes).forEach(disposeCarModel);
            disposeSharedCarAssets(); // body-style geometry, trim/glass materials and the car textures
            
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
            
            avatarPerson.dispose();
            blobs.dispose();
            disposeCharacterAssets(); // shared material, blob texture and body shapes, after every person is gone
            atmosphere.dispose();

            // Last: renderer.dispose() forgets which GPU textures belong to which
            // texture objects, so textures disposed after it would never be freed.
            renderer.domElement.remove();
            renderer.dispose();
        };
    }, []);

    return (
        <>
            <div ref={mountRef} className="absolute inset-0 z-[0] pointer-events-auto overflow-hidden" />
            <DriveLayer ref={layerRef} canvasRef={hudCanvasRef} />
        </>
    );
}
