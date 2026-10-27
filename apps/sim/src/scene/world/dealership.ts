import * as THREE from 'three';
import type { WorldContext } from './context';
import type { FenceKit } from './fences';
import type { FurnitureKit } from './furniture';
import { createBuildingSign } from '../textures';

// Hinged driveway gate of one dealership lot (animated by the render loop).
export type DealershipGate = { left: THREE.Group; right: THREE.Group; ownerId: string; x: number; z: number; barrier: THREE.Box3; isOwner: boolean };

/** Builds a player's whole dealership lot. `isOwnerLot` = it belongs to the local player (gets solid fences + gate barrier). */
export function createDealership(ctx: WorldContext, fences: FenceKit, furniture: FurnitureKit, lotX: number, lotZ: number, playerId: string, isOwnerLot: boolean): DealershipGate {
    const { scene, environmentDisposables, staticCollisionBoxes, concreteTex, asphaltTex, makeGlass, addLightSource } = ctx;
    const { buildChainLinkFence, buildGateLeaf } = fences;
    const { makeSofa, makePlant, makePainting, makeCoffeeTable } = furniture;

    // --- 1. Main Office Building ---
    const officeGroup = new THREE.Group();
    officeGroup.position.set(lotX - 25, 0, lotZ - 25);

    const officeMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.8 }); // Slate-800
    const glassMat = makeGlass('#38bdf8', 0.35);
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

    // --- Showroom lounge & decor (makes the office look lived-in) ---
    // A waiting lounge: two sofas facing each other across a glass coffee table.
    const sofaA = makeSofa('#3f5b7a'); sofaA.position.set(-6.2, 0, 3.5); sofaA.rotation.y = Math.PI / 2; officeGroup.add(sofaA);
    const sofaB = makeSofa('#3f5b7a'); sofaB.position.set(-2.2, 0, 3.5); sofaB.rotation.y = -Math.PI / 2; officeGroup.add(sofaB);
    const table = makeCoffeeTable(); table.position.set(-4.2, 0, 3.5); officeGroup.add(table);
    // Potted plants in the corners
    const p1 = makePlant(); p1.position.set(8.5, 0, 6); officeGroup.add(p1);
    const p2 = makePlant(); p2.position.set(8.5, 0, -6); officeGroup.add(p2);
    const p3 = makePlant(); p3.position.set(-8.7, 0, -6); officeGroup.add(p3);
    // Framed art on the walls
    const art1 = makePainting(2.4, 1.5, '#0e7490', '#f59e0b'); art1.position.set(4.5, 4.6, -6.95); officeGroup.add(art1);
    const art2 = makePainting(1.8, 1.8, '#7c3aed', '#22d3ee'); art2.position.set(7.6, 4.6, -6.95); officeGroup.add(art2);
    const art3 = makePainting(2.2, 1.4, '#b91c1c', '#fde68a'); art3.position.set(-9.55, 4.6, 0); art3.rotation.y = Math.PI / 2; officeGroup.add(art3);
    // Chrome push-handle on the glass entrance door
    const handleMat = new THREE.MeshStandardMaterial({ color: '#e2e8f0', metalness: 1.0, roughness: 0.15 });
    const doorHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 8), handleMat); doorHandle.position.set(1.2, 3.6, 7.45); officeGroup.add(doorHandle);
    // Soft warm interior light so the furnishings are visible from outside.
    addLightSource(lotX - 25, 6, lotZ - 24, '#fff3da', 0.9, 34, false);

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

        addLightSource(pos.x, 14.5, pos.z, '#fef08a', 2, 50, true);

        const bulbGeo = new THREE.SphereGeometry(0.6);
        const bulbMat = new THREE.MeshBasicMaterial({ color: '#fef08a' });
        const bulb = new THREE.Mesh(bulbGeo, bulbMat);
        bulb.position.set(pos.x, 15, pos.z);
        scene.add(bulb);
        environmentDisposables.push(bulb);
    });

    // Dealership Foundation Asphalt
    const foundationGeo = new THREE.PlaneGeometry(130, 140);
    const foundationMat = new THREE.MeshStandardMaterial({ color: '#48484d', roughness: 0.95, metalness: 0.0, map: asphaltTex }); // mid-grey lot paving, distinct from the near-black roads
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

    // Galvanized chain-link perimeter fence around the lot
    // Boundary of foundation: X: lotX-55 to lotX+75, Z: lotZ-40 to lotZ+100
    const fL = lotX - 55;
    const fR = lotX + 75;
    const fB = lotZ - 40;
    const fT = lotZ + 100;

    // Perimeter fence — back / left / right plus two front runs that leave a
    // gate opening for the driveway (lotX-15 to lotX+15)
    const fenceSegs = [
        buildChainLinkFence(fL, fB, fR, fB),
        buildChainLinkFence(fL, fB, fL, fT),
        buildChainLinkFence(fR, fB, fR, fT),
        buildChainLinkFence(fL, fT, lotX - 15, fT),
        buildChainLinkFence(lotX + 15, fT, fR, fT)
    ];
    // Enclose the owner's own lot so the gate is the only way in or out
    if (isOwnerLot) {
        fenceSegs.forEach(g => {
            g.updateMatrixWorld(true);
            staticCollisionBoxes.push(new THREE.Box3().setFromObject(g).expandByScalar(0.2));
        });
    }

    // Secured automatic driveway gate (two leaves). Starts closed; the render
    // loop opens it from the inside automatically and from the outside only
    // after the owner enters their code, and physically blocks the driveway
    // (gateBarrier) whenever it is closed.
    const gateLeft = buildGateLeaf(lotX - 15, fT, 1);
    const gateRight = buildGateLeaf(lotX + 15, fT, -1);
    gateLeft.rotation.y = 0;
    gateRight.rotation.y = 0;
    const gateBarrier = new THREE.Box3();
    gateBarrier.makeEmpty();
    if (isOwnerLot) staticCollisionBoxes.push(gateBarrier);
    const gate: DealershipGate = { left: gateLeft, right: gateRight, ownerId: playerId, x: lotX, z: fT, barrier: gateBarrier, isOwner: isOwnerLot };

    // Physical keypad terminal just outside the gate (driver's-side) so the code
    // entry has a visible machine to walk/drive up to.
    const term = new THREE.Group(); term.position.set(lotX + 20, 0, fT + 4);
    const tPost = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 3, 8), new THREE.MeshStandardMaterial({ color: '#3f3f46', metalness: 0.6, roughness: 0.4 })); tPost.position.y = 1.5; tPost.castShadow = true; term.add(tPost);
    const tHead = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.8, 0.6), new THREE.MeshStandardMaterial({ color: '#18181b' })); tHead.position.set(0, 3, 0); tHead.castShadow = true; term.add(tHead);
    const tScreen = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.05), new THREE.MeshStandardMaterial({ color: '#10b981', emissive: '#10b981', emissiveIntensity: 0.8 })); tScreen.position.set(0, 3.35, 0.32); term.add(tScreen);
    const tPad = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 0.05), new THREE.MeshStandardMaterial({ color: '#27272a' })); tPad.position.set(0, 2.6, 0.32); term.add(tPad);
    const tSign = createBuildingSign('GATE CODE', '#064e3b', '#6ee7b7'); tSign.position.set(0, 4.3, 0); tSign.scale.setScalar(0.6); term.add(tSign);
    scene.add(term); environmentDisposables.push(term, tSign);

    // --- Parking & traffic layout -----------------------------------------
    // A clear central drive lane runs from the front gate to the back of the
    // lot, so customer and service traffic never weaves through the display
    // rows. Inventory is shown in perpendicular rows either side of that lane;
    // visitor parking sits by the entrance; the delivery lane stays on the far
    // left (x-40) where the server spawns newly-bought stock.
    const stallLineMat = new THREE.MeshBasicMaterial({ color: '#eef2f6' }); // white stall paint
    const laneLineMat = new THREE.MeshBasicMaterial({ color: '#fde047' });  // yellow drive-lane edge
    const wheelStopMat = new THREE.MeshStandardMaterial({ color: '#9ca3af', roughness: 0.95 });
    const wheelStopGeo = new THREE.BoxGeometry(4.0, 0.3, 0.5);

    const addFlat = (mesh: THREE.Mesh) => { mesh.rotation.x = -Math.PI / 2; scene.add(mesh); environmentDisposables.push(mesh); };

    // Central drive lane: two yellow edge lines from the gate back into the lot
    [-8, 8].forEach(ex => {
        const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 135), laneLineMat);
        edge.position.set(lotX + ex, 0.025, lotZ + 32);
        addFlat(edge);
    });

    // Paint a block of perpendicular stalls. Cars nose toward `openX` (the drive
    // aisle); wheel stops sit at the closed/back end.
    const paintParkingRow = (openX: number, backX: number, zFrom: number, zTo: number, withStops = true) => {
        const cx = (openX + backX) / 2;
        const depth = Math.abs(backX - openX);
        const count = Math.max(1, Math.round((zTo - zFrom) / 6));
        for (let s = 0; s <= count; s++) {
            const z = zFrom + (s * (zTo - zFrom)) / count;
            const divider = new THREE.Mesh(new THREE.PlaneGeometry(depth, 0.3), stallLineMat);
            divider.position.set(cx, 0.025, lotZ + z);
            addFlat(divider);
        }
        // Back boundary line along the stall heads
        const back = new THREE.Mesh(new THREE.PlaneGeometry(0.3, zTo - zFrom), stallLineMat);
        back.position.set(backX, 0.025, lotZ + (zFrom + zTo) / 2);
        addFlat(back);
        if (withStops) {
            const stopX = backX + (openX - backX) * 0.18;
            for (let s = 0; s < count; s++) {
                const z = zFrom + ((s + 0.5) * (zTo - zFrom)) / count;
                const stop = new THREE.Mesh(wheelStopGeo, wheelStopMat);
                stop.rotation.y = Math.PI / 2;
                stop.position.set(stopX, 0.15, lotZ + z);
                stop.castShadow = true; stop.receiveShadow = true;
                scene.add(stop); environmentDisposables.push(stop);
            }
        }
    };

    // Display rows flanking the central drive lane (set back from the gate)
    paintParkingRow(10, 28, -30, 78);    // right display row, opens to the drive
    paintParkingRow(-10, -28, 2, 78);     // left display row (north of the office)

    // Visitor parking by the entrance, clearly separated from the display rows
    paintParkingRow(34, 46, 58, 92);
    const visitorSign = createBuildingSign('CUSTOMER PARKING', '#0f172a', '#38bdf8');
    visitorSign.scale.set(8, 2, 1);
    visitorSign.position.set(lotX + 40, 3, lotZ + 95);
    scene.add(visitorSign);
    environmentDisposables.push(visitorSign);

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

    // Label the delivery lane so it reads as a transporter drop zone
    const deliverySign = createBuildingSign('DELIVERY', '#7f1d1d', '#fecaca');
    deliverySign.scale.set(6, 1.6, 1);
    deliverySign.position.set(lotX - 40, 3, lotZ + 92);
    scene.add(deliverySign);
    environmentDisposables.push(deliverySign);
    // Wash Bay (Open air drive-thru)
    const washGroup = new THREE.Group();
    washGroup.position.set(lotX + 55, 0, lotZ - 40);
    
    const washGlass = makeGlass('#0ea5e9', 0.3, THREE.DoubleSide);
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

    return gate;
}
