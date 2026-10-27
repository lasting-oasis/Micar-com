import * as THREE from 'three';
import type { WorldContext } from './context';
import { createBuildingSign } from '../textures';

export function buildSpeedway(ctx: WorldContext) {
    const { scene, environmentDisposables, makeGlass } = ctx;

    // ============================================================
    //  SPEEDWAY  (big circular circuit on open ground far WEST of the city —
    //  no buildings/lots/trees out here. Reached via the z=200 / z=500 cross
    //  streets, which both span the full map width to x=-255.)
    // ============================================================
    const RACE_CX = 0, RACE_CZ = 300;       // circuit centre — the whole city sits inside the infield
    const RC = 1450;                         // centreline radius — HUGE (~2900 across, ~10x bigger)
    const TRACK_W = 40;                      // track width in world units (wide for the scale)
    const baseR = 50;
    const raceScale = RC / baseR;
    const halfW = (TRACK_W / raceScale) / 2; // base-space half-width so the scaled ring is exactly TRACK_W wide
    // No infield disc: this ring encircles the whole city, so the inside is just
    // the existing grass floor + the town (a disc here would paint over the roads/lots).
    // asphalt ring track surface. Pushed slightly back (like the grass, which is
    // pushed back further) so the curbs, start/finish strip and access road lying
    // on it always draw on top; pulling it forward hid them at a distance.
    const ring = new THREE.Mesh(new THREE.RingGeometry(baseR - halfW, baseR + halfW, 200), new THREE.MeshStandardMaterial({ color: '#2b2b30', roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(RACE_CX, 0.05, RACE_CZ); ring.scale.set(raceScale, raceScale, 1); ring.receiveShadow = true;
    scene.add(ring); environmentDisposables.push(ring);
    // red/white curbs on inner & outer edges
    ([[baseR - halfW, '#dc2626'], [baseR + halfW, '#e5e7eb']] as [number, string][]).forEach(([rr, col]) => {
        const curb = new THREE.Mesh(new THREE.RingGeometry(rr - 0.7, rr, 200), new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, side: THREE.DoubleSide }));
        curb.rotation.x = -Math.PI / 2; curb.position.set(RACE_CX, 0.08, RACE_CZ); curb.scale.set(raceScale, raceScale, 1);
        scene.add(curb); environmentDisposables.push(curb);
    });
    // centreline points (perfect circle, so uniform track width everywhere)
    const racePt = (deg: number) => new THREE.Vector3(RACE_CX + RC * Math.cos(deg * Math.PI / 180), 0, RACE_CZ + RC * Math.sin(deg * Math.PI / 180));
    const raceStartPos = racePt(90);                                   // start/finish (south side, by the paddock)
    const raceStartRotY = Math.PI / 2;                                 // faces -x toward turn 1
    const raceCheckpoints = [racePt(180), racePt(270), racePt(0)];     // W, N, E — must be hit in order
    // start/finish checkered strip across the full track width (radial = z at the south point)
    const sfGroup = new THREE.Group(); sfGroup.position.copy(raceStartPos); sfGroup.position.y = 0.1;
    for (let i = 0; i < 10; i++) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(2, 0.06, TRACK_W / 10), new THREE.MeshStandardMaterial({ color: i % 2 ? '#0a0a0a' : '#fafafa' }));
        c.position.set(0, 0, -TRACK_W / 2 + (i + 0.5) * (TRACK_W / 10)); sfGroup.add(c);
    }
    scene.add(sfGroup); environmentDisposables.push(sfGroup);
    // checkpoint marker pylons flanking the track so the route reads clearly
    raceCheckpoints.forEach((cp, i) => {
        ([-TRACK_W / 2 - 1.5, TRACK_W / 2 + 1.5]).forEach(off => {
            const dir = new THREE.Vector3(cp.x - RACE_CX, 0, cp.z - RACE_CZ).normalize();
            const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 5, 8), new THREE.MeshStandardMaterial({ color: ['#38bdf8', '#facc15', '#f472b6'][i], emissive: ['#0ea5e9', '#eab308', '#ec4899'][i], emissiveIntensity: 0.4 }));
            pylon.position.set(cp.x + dir.x * off, 2.5, cp.z + dir.z * off); scene.add(pylon); environmentDisposables.push(pylon);
        });
    });
    const speedwaySign = createBuildingSign('SPEEDWAY', '#1e1b4b', '#a5b4fc'); speedwaySign.position.set(RACE_CX, 28, RACE_CZ + RC + 35); speedwaySign.scale.setScalar(6); scene.add(speedwaySign); environmentDisposables.push(speedwaySign);

    // Access road across the grass connecting the city road network to the start line.
    const accRoadFrom = 1040, accRoadTo = RACE_CZ + RC - 5; // ends just before the start strip
    const accLen = accRoadTo - accRoadFrom, accCenter = (accRoadFrom + accRoadTo) / 2;
    const accessRoadMat = new THREE.MeshStandardMaterial({ color: '#191a1d', roughness: 0.95 });
    const accessRoad = new THREE.Mesh(new THREE.BoxGeometry(26, 0.5, accLen), accessRoadMat);
    accessRoad.position.set(0, 0.06, accCenter); accessRoad.receiveShadow = true;
    scene.add(accessRoad); environmentDisposables.push(accessRoad);
    const accessDivider = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, accLen), new THREE.MeshStandardMaterial({ color: '#fbbf24' }));
    accessDivider.position.set(0, 0.08, accCenter); scene.add(accessDivider); environmentDisposables.push(accessDivider);

    // Paddock in the infield just inside the start line: rental kiosk.
    const rentalKioskPos = new THREE.Vector3(-45, 1.5, 1700);
    const kiosk = new THREE.Group(); kiosk.position.set(-45, 0, 1700);
    const kFloor = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 6), new THREE.MeshStandardMaterial({ color: '#3f3f46' })); kFloor.position.y = 0.1; kiosk.add(kFloor);
    const kMat = new THREE.MeshStandardMaterial({ color: '#4338ca', roughness: 0.5, metalness: 0.3 });
    const kBooth = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 4), kMat); kBooth.position.set(0, 2.2, 0); kBooth.castShadow = true; kiosk.add(kBooth);
    const kGlass = new THREE.Mesh(new THREE.BoxGeometry(4, 1.6, 0.2), makeGlass('#a5b4fc', 0.45)); kGlass.position.set(0, 2.6, -2.05); kiosk.add(kGlass);
    const kRoof = new THREE.Mesh(new THREE.BoxGeometry(6, 0.4, 5), new THREE.MeshStandardMaterial({ color: '#312e81' })); kRoof.position.set(0, 4.4, 0); kRoof.castShadow = true; kiosk.add(kRoof);
    const kSign = createBuildingSign('CAR RENTALS', '#1e1b4b', '#c7d2fe'); kSign.position.set(0, 5.4, 0); kiosk.add(kSign);
    scene.add(kiosk); environmentDisposables.push(kiosk, kSign);

    // --- Mario-Kart-style item boxes scattered around the circuit ---
    // "?" decal for every face: dark backing (no glow) + a glowing white "?".
    const qCanvas = document.createElement('canvas'); qCanvas.width = 128; qCanvas.height = 128;
    const qctx = qCanvas.getContext('2d')!;
    qctx.fillStyle = '#0a0a16'; qctx.fillRect(0, 0, 128, 128);
    qctx.fillStyle = '#ffffff'; qctx.font = 'bold 94px sans-serif'; qctx.textAlign = 'center'; qctx.textBaseline = 'middle';
    qctx.fillText('?', 64, 72);
    const qTex = new THREE.CanvasTexture(qCanvas);
    const itemBoxes: { mesh: THREE.Mesh; baseY: number; active: boolean; respawnAt: number }[] = [];
    const itemBoxGeo = new THREE.BoxGeometry(5, 5, 5);
    for (let i = 0; i < 16; i++) {
        const ang = i * (360 / 16);
        const cp = racePt(ang); // on the centreline
        const radial = new THREE.Vector3(cp.x - RACE_CX, 0, cp.z - RACE_CZ).normalize();
        const lane = ((i % 3) - 1) * (TRACK_W / 3); // inner / centre / outer lane
        // Holographic foil: chrome-like, transparent, with the glowing "?" emissive decal.
        // Its colour is shifted through the spectrum each frame for the foil shimmer.
        const mat = new THREE.MeshStandardMaterial({ color: '#7dd3fc', metalness: 0.95, roughness: 0.08, transparent: true, opacity: 0.85, emissive: '#ffffff', emissiveIntensity: 1.5, emissiveMap: qTex });
        const box = new THREE.Mesh(itemBoxGeo, mat);
        box.position.set(cp.x + radial.x * lane, 4.5, cp.z + radial.z * lane);
        box.castShadow = true;
        box.userData.dynamic = true; // spins, bobs and changes colour every frame
        scene.add(box); environmentDisposables.push(box);
        itemBoxes.push({ mesh: box, baseY: 4.5, active: true, respawnAt: 0 });
    }

    return { RACE_CX, RACE_CZ, RC, TRACK_W, raceStartPos, raceStartRotY, raceCheckpoints, rentalKioskPos, itemBoxes, itemBoxGeo, qTex };
}
