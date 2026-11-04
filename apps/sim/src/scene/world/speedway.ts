import * as THREE from 'three';
import type { WorldContext } from './context';
import { createBuildingSign, ROAD_ATLAS_LENGTH } from '../textures';
import type { UVFn } from './meshBuilder';
import { chunks, cleanUV, gravelUV, paintUV, roadUV, Y } from './roads';

export function buildSpeedway(ctx: WorldContext) {
    const { scene, environmentDisposables, makeGlass } = ctx;

    // ============================================================
    //  SPEEDWAY  (big circular circuit round the whole town, on open ground.
    //  Reached via the main road and its access road north to the paddock.)
    // ============================================================
    const RACE_CX = 0, RACE_CZ = 300;       // circuit centre — the whole city sits inside the infield
    const RC = 1450;                         // centreline radius — HUGE (~2900 across, ~10x bigger)
    const TRACK_W = 40;                      // track width in world units (wide for the scale)
    // centreline points (perfect circle, so uniform track width everywhere)
    const racePt = (deg: number) => new THREE.Vector3(RACE_CX + RC * Math.cos(deg * Math.PI / 180), 0, RACE_CZ + RC * Math.sin(deg * Math.PI / 180));
    const raceStartPos = racePt(90);                                   // start/finish (south side, by the paddock)
    const raceStartRotY = Math.PI / 2;                                 // faces -x toward turn 1
    const raceCheckpoints = [racePt(180), racePt(270), racePt(0)];     // W, N, E — must be hit in order

    // No infield disc: this ring encircles the whole city, so the inside is just the grass
    // floor and the town. The track is part of the town's ground layers (asphalt and paint,
    // drawn only where in view: see cells.ts), at road height; the asphalt is pushed back
    // in depth and the paint pulled forward, so kerbs and the start line always draw on top.
    const { asphalt, paint } = ctx.layers;
    const R_IN = RC - TRACK_W / 2, R_OUT = RC + TRACK_W / 2, KERB = 2.6, KERB_LEN = 7.4, SEGS = 360;
    const ringPt = (r: number, a: number): [number, number] => [RACE_CX + r * Math.cos(a), RACE_CZ + r * Math.sin(a)];
    const arcQuad = (layer: typeof asphalt, r0: number, r1: number, a0: number, a1: number, y: number, uv: UVFn) => {
        const [mx, mz] = ringPt((r0 + r1) / 2, (a0 + a1) / 2);
        layer.at(mx, mz).flat([ringPt(r0, a0), ringPt(r1, a0), ringPt(r1, a1), ringPt(r0, a1)], y, uv);
    };
    // the surface: the road atlas's clean column, a whole number of repeats round the ring
    const REPEATS = Math.round((2 * Math.PI * RC) / ROAD_ATLAS_LENGTH), U = cleanUV(0, 0, 0)[0];
    for (let i = 0; i < SEGS; i++) {
        const a0 = (i / SEGS) * Math.PI * 2, a1 = ((i + 1) / SEGS) * Math.PI * 2, am = (a0 + a1) / 2;
        const uv: UVFn = (x, _y, z) => {
            let a = Math.atan2(z - RACE_CZ, x - RACE_CX);
            a += 2 * Math.PI * Math.round((am - a) / (2 * Math.PI)); // the same turn as this piece
            return [U, (a / (2 * Math.PI)) * REPEATS];
        };
        arcQuad(asphalt, R_IN, R_OUT, a0, a1, Y.road, uv);
    }
    // red and white kerbs on both edges; a white line inside each (not across the start line)
    const kerbs = Math.round((2 * Math.PI * RC) / KERB_LEN);
    for (let i = 0; i < kerbs; i++) {
        const a0 = (i / kerbs) * Math.PI * 2, a1 = ((i + 1) / kerbs) * Math.PI * 2, uv = paintUV(i % 2 ? 'red' : 'white');
        arcQuad(paint, R_IN, R_IN + KERB, a0, a1, Y.paint, uv);
        arcQuad(paint, R_OUT - KERB, R_OUT, a0, a1, Y.paint, uv);
    }
    const SQ = 2, START_COLS = 3, startHalf = (START_COLS * SQ) / 2 / RC + 0.002;
    for (let i = 0; i < SEGS; i++) {
        const a0 = (i / SEGS) * Math.PI * 2, a1 = ((i + 1) / SEGS) * Math.PI * 2;
        const cut = (a: number) => Math.min(Math.max(a, Math.PI / 2 - startHalf), Math.PI / 2 + startHalf);
        for (const r of [R_IN + KERB + 0.8, R_OUT - KERB - 0.8]) {
            // (split round the start line)
            [[a0, Math.min(a1, cut(a0))], [Math.max(a0, cut(a1)), a1]].forEach(([p, q]) => { if (q - p > 1e-6) arcQuad(paint, r - 0.15, r + 0.15, p, q, Y.paint, paintUV('white')); });
        }
    }
    // start/finish: a checkered band across the track between the kerbs (radial = z here)
    {
        const z0 = raceStartPos.z - TRACK_W / 2 + KERB, rows = 18, h = (TRACK_W - 2 * KERB) / rows;
        for (let i = 0; i < START_COLS; i++) for (let k = 0; k < rows; k++) {
            const x0 = raceStartPos.x - (START_COLS * SQ) / 2 + i * SQ;
            paint.at(raceStartPos.x, raceStartPos.z).rect(x0, z0 + k * h, x0 + SQ, z0 + (k + 1) * h, Y.paint, paintUV((i + k) % 2 ? 'black' : 'white'));
        }
    }
    // checkpoint marker pylons flanking the track so the route reads clearly
    raceCheckpoints.forEach((cp, i) => {
        ([-TRACK_W / 2 - 1.5, TRACK_W / 2 + 1.5]).forEach(off => {
            const dir = new THREE.Vector3(cp.x - RACE_CX, 0, cp.z - RACE_CZ).normalize();
            const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 5, 8), new THREE.MeshStandardMaterial({ color: ['#38bdf8', '#facc15', '#f472b6'][i], emissive: ['#0ea5e9', '#eab308', '#ec4899'][i], emissiveIntensity: 0.4 }));
            pylon.position.set(cp.x + dir.x * off, 2.5, cp.z + dir.z * off); scene.add(pylon); environmentDisposables.push(pylon);
        });
    });
    const speedwaySign = createBuildingSign('SPEEDWAY', '#1e1b4b', '#a5b4fc'); speedwaySign.position.set(RACE_CX, 28, RACE_CZ + RC + 35); speedwaySign.scale.setScalar(6); scene.add(speedwaySign); environmentDisposables.push(speedwaySign);

    // Access road across the fields from the end of the main road to the track (26 wide,
    // as before; it now stops at the track's inner edge instead of running on under the
    // start line): a country road with gravel shoulders, then a gravel paddock apron either
    // side of it by the rental kiosk and the gas station.
    const ROAD_FROM = 1040, ROAD_TO = RACE_CZ + R_IN, H = 13, SHOULDER = 2.6;
    const roadSurface = roadUV('z', 0, H);
    for (const [z0, z1] of chunks(ROAD_FROM, ROAD_TO)) {
        asphalt.at(0, (z0 + z1) / 2).rect(-H, z0, H, z1, Y.road, roadSurface);
        for (const sgn of [-1, 1]) asphalt.at(sgn * H, (z0 + z1) / 2).rect(sgn * H, z0, sgn * (H + SHOULDER), z1, Y.road - 0.004, gravelUV);
    }
    const lines = (d0: number, d1: number, col: 'white' | 'yellow', dash: number, period: number) => {
        for (const sgn of [-1, 1]) for (let z = Math.ceil(ROAD_FROM / period) * period; z < ROAD_TO - 1; z += period) {
            paint.at(sgn * d0, z).rect(Math.min(sgn * d0, sgn * d1), z, Math.max(sgn * d0, sgn * d1), Math.min(ROAD_TO - 1, z + dash), Y.paint, paintUV(col));
        }
    };
    lines(0.1, 0.3, 'yellow', 30, 30);    // double yellow centre line
    lines(5.9, 6.1, 'white', 6, 24);       // lane lines
    lines(12.1, 12.35, 'white', 30, 30);   // edge lines
    for (const sgn of [-1, 1]) {
        const [x0, x1] = [sgn * (H + SHOULDER), sgn * 78].sort((p, q) => p - q);
        asphalt.at((x0 + x1) / 2, 1700).rect(x0, 1672, x1, ROAD_TO - 3, Y.road - 0.004, gravelUV);
    }
    // street lights along the paddock
    for (const z of [1650, 1700]) for (const sgn of [-1, 1]) ctx.props.street(sgn * (H + 1.4), z + (sgn > 0 ? 25 : 0), -sgn, 0, Y.road);

    // Paddock in the infield just inside the start line: rental kiosk.
    const rentalKioskPos = new THREE.Vector3(-45, 1.5, 1700);
    const kiosk = new THREE.Group(); kiosk.position.set(-45, 0, 1700);
    const kFloor = new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 6), new THREE.MeshStandardMaterial({ color: '#3f3f46' })); kFloor.position.y = 0.05; kiosk.add(kFloor);
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
