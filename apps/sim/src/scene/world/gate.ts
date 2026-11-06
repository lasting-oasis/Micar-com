import * as THREE from 'three';
import type { WorldContext } from './context';
import { chunks, gravelUV, paintUV, roadUV, Y } from './roads';
import { HUB } from '../../world/strip/district';
import { WORLD_PER_M } from '../../world/units';

// The gate to the Strip, where the Speedway was: the country road north from the end of the main
// road still runs out to the old paddock (gravel aprons, street lights, the gas station), and ends in
// a lit ring on the road under a sign reading THE STRIP. Driving onto the ring prompts
// "[Enter] THE STRIP". The Strip has a twin of the ring at its far corner (the hub's exit spot): the way back.

const PAINT = '#ffd23f', NIGHT = '#0e1217';
import { GATE } from './gateSpot';
// the ring's centre and radius, and the spot a car comes back to (gateSpot.ts: the server reads them too)
export { GATE, GATE_RETURN } from './gateSpot';
/** the Strip's exit ring: the hub's exit spot (metres), radius in metres */
export const STRIP_EXIT = { x: HUB.exit.x, z: HUB.exit.z, r: HUB.exit.r };

function signSprite(text: string): { sprite: THREE.Sprite; dispose(): void } {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const g = canvas.getContext('2d');
    if (g) {
        g.fillStyle = NIGHT; g.beginPath(); if (g.roundRect) g.roundRect(0, 0, 512, 128, 18); else g.rect(0, 0, 512, 128); g.fill();
        g.strokeStyle = PAINT; g.lineWidth = 6; g.stroke();
        g.fillStyle = PAINT; g.textAlign = 'center'; g.font = "italic 900 74px 'Barlow Condensed','Arial Narrow',sans-serif";
        g.fillText(text, 256, 92);
    }
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(mat); sprite.scale.set(12, 3, 1);
    return { sprite, dispose: () => { tex.dispose(); mat.dispose(); } };
}

/** A pulsing ring with a faint beam (world units, centred on the group). */
function ringGroup(r: number): { group: THREE.Group; pulse(t: number): void; dispose(): void } {
    const group = new THREE.Group(); group.userData.dynamic = true; // animated: the static batcher leaves it alone
    const ringGeo = new THREE.RingGeometry(r * .82, r, 64); ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: PAINT, transparent: true, opacity: .7, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const ring = new THREE.Mesh(ringGeo, ringMat); ring.position.y = 0.06; ring.renderOrder = 1; group.add(ring);
    const beamGeo = new THREE.CylinderGeometry(r, r, 18, 48, 1, true); beamGeo.translate(0, 9, 0);
    const beamMat = new THREE.MeshBasicMaterial({ color: PAINT, transparent: true, opacity: .1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const beam = new THREE.Mesh(beamGeo, beamMat); beam.renderOrder = 1; group.add(beam);
    return {
        group,
        pulse: t => { ringMat.opacity = .55 + .3 * Math.sin(t / 300); beamMat.opacity = .08 + .05 * Math.sin(t / 400); },
        dispose: () => { group.removeFromParent(); ringGeo.dispose(); ringMat.dispose(); beamGeo.dispose(); beamMat.dispose(); },
    };
}

export function buildGate(ctx: WorldContext): { isOnGate(x: number, z: number): boolean; sign: THREE.Object3D; pulse(t: number): void; dispose(): void } {
    const { scene, layers: { asphalt, paint } } = ctx;

    // The road from the end of the main road out to the paddock (26 wide, gravel shoulders).
    const ROAD_FROM = 1040, ROAD_TO = GATE.z + GATE.r + 6, H = 13, SHOULDER = 2.6;
    const roadSurface = roadUV('z', 0, H);
    for (const [z0, z1] of chunks(ROAD_FROM, ROAD_TO)) {
        asphalt.at(0, (z0 + z1) / 2).rect(-H, z0, H, z1, Y.road, roadSurface);
        for (const sgn of [-1, 1]) asphalt.at(sgn * H, (z0 + z1) / 2).rect(sgn * H, z0, sgn * (H + SHOULDER), z1, Y.road - 0.004, gravelUV);
    }
    const LINES_TO = GATE.z - GATE.r - 4; // the markings stop short of the ring
    const lines = (d0: number, d1: number, col: 'white' | 'yellow', dash: number, period: number) => {
        for (const sgn of [-1, 1]) for (let z = Math.ceil(ROAD_FROM / period) * period; z < LINES_TO; z += period) {
            paint.at(sgn * d0, z).rect(Math.min(sgn * d0, sgn * d1), z, Math.max(sgn * d0, sgn * d1), Math.min(LINES_TO, z + dash), Y.paint, paintUV(col));
        }
    };
    lines(0.1, 0.3, 'yellow', 30, 30);    // double yellow centre line
    lines(5.9, 6.1, 'white', 6, 24);       // lane lines
    lines(12.1, 12.35, 'white', 30, 30);   // edge lines
    // the old paddock: gravel aprons either side, by the gas station
    for (const sgn of [-1, 1]) {
        const [x0, x1] = [sgn * (H + SHOULDER), sgn * 78].sort((p, q) => p - q);
        asphalt.at((x0 + x1) / 2, 1700).rect(x0, 1672, x1, ROAD_TO, Y.road - 0.004, gravelUV);
    }
    for (const z of [1650, 1700]) for (const sgn of [-1, 1]) ctx.props.street(sgn * (H + 1.4), z + (sgn > 0 ? 25 : 0), -sgn, 0, Y.road);

    // The ring on the road, and THE STRIP on two posts just beyond it.
    const ring = ringGroup(GATE.r); ring.group.position.set(GATE.x, 0, GATE.z); scene.add(ring.group);
    const sign = signSprite('THE STRIP');
    const arch = new THREE.Group(); arch.userData.dynamic = true;
    sign.sprite.position.set(0, 14, 0); sign.sprite.scale.set(28, 7, 1); arch.add(sign.sprite);
    const postGeo = new THREE.BoxGeometry(1.2, 11, 1.2); postGeo.translate(0, 5.5, 0);
    const postMat = new THREE.MeshStandardMaterial({ color: '#2a3140', roughness: .6, metalness: .4 });
    const capMat = new THREE.MeshBasicMaterial({ color: PAINT });
    const capGeo = new THREE.BoxGeometry(1.4, .5, 1.4); capGeo.translate(0, 11.25, 0);
    for (const sx of [-15, 15]) { const p = new THREE.Mesh(postGeo, postMat); p.position.x = sx; p.castShadow = true; arch.add(p); const c = new THREE.Mesh(capGeo, capMat); c.position.x = sx; arch.add(c); }
    arch.position.set(GATE.x, 0, GATE.z + GATE.r + 4);
    scene.add(arch);
    // the posts are solid
    for (const sx of [-15, 15]) ctx.staticCollisionBoxes.push(new THREE.Box3(new THREE.Vector3(GATE.x + sx - .6, 0, arch.position.z - .6), new THREE.Vector3(GATE.x + sx + .6, 11, arch.position.z + .6)));

    return {
        isOnGate: (x, z) => Math.hypot(x - GATE.x, z - GATE.z) < GATE.r,
        sign: arch,
        pulse: t => ring.pulse(t),
        dispose: () => { ring.dispose(); sign.dispose(); arch.removeFromParent(); postGeo.dispose(); postMat.dispose(); capGeo.dispose(); capMat.dispose(); },
    };
}

/** The Strip's way back to town: the same ring at the hub's exit (add `group` to the Strip's scene after load). */
export function buildStripExit(): { group: THREE.Group; isOnExit(xm: number, zm: number): boolean; pulse(t: number): void; dispose(): void } {
    const ring = ringGroup(STRIP_EXIT.r * WORLD_PER_M);
    ring.group.position.set(STRIP_EXIT.x * WORLD_PER_M, 0, STRIP_EXIT.z * WORLD_PER_M);
    return { group: ring.group, isOnExit: (x, z) => Math.hypot(x - STRIP_EXIT.x, z - STRIP_EXIT.z) < STRIP_EXIT.r, pulse: ring.pulse, dispose: ring.dispose };
}
