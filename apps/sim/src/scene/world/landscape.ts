import type { WorldContext } from './context';
import { seededRandom } from '../textures';
import type { PlantKind } from './vegetation';

// The land around the town: loose trees on open ground in town, groves in the fields
// around it, a tree line beyond the speedway and a ring of low hills on the horizon.
// The hills stay well inside the camera's reach (6500): the fog has mostly swallowed them
// by ~4.5 km, so they read as soft, hazy ridges. All placement is seeded (the same town
// for every player). Trees go into the shared vegetation kit (culled, with far versions);
// the hills into the town's lawn layer (one mesh, drawn where in view).

const CX = 0, CZ = 300;                 // the speedway's centre: the town sits in its infield
const TRACK_IN = 1395, TRACK_OUT = 1515; // the track with its kerbs and run-off: no trees
const TREE_LINE = 1700;                 // the wooded edge beyond the speedway

type V3 = [number, number, number];

export function buildLandscape(ctx: WorldContext, clear: (x: number, z: number, r: number) => boolean) {
    const rand = seededRandom(31337);
    const radius = (x: number, z: number) => Math.hypot(x - CX, z - CZ);
    const onTrack = (x: number, z: number) => { const r = radius(x, z); return r > TRACK_IN && r < TRACK_OUT; };
    const speedwayRoad = (x: number, z: number) => Math.abs(x) < 45 && z > 1000 && z < 1800; // access road, paddock, start line
    const ok = (x: number, z: number, r: number) => clear(x, z, r) && !onTrack(x, z) && !speedwayRoad(x, z);
    const inTown = (x: number, z: number) => x > -540 && x < 1100 && z > -570 && z < 1070;
    const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    const plant = (kind: PlantKind, x: number, z: number, scale: number) => { if (ok(x, z, 4)) ctx.plants.add(kind, x, z, rand, scale); };

    // ---- Loose trees and small clumps on open ground in town ----
    for (let n = 0, tries = 0; n < 20 && tries < 900; tries++) {
        const x = -470 + rand() * 940, z = 130 + rand() * 880;
        if (!ok(x, z, 9)) continue;
        n++;
        const k = 1 + Math.floor(rand() * 3), kind = pick<PlantKind>(['broadleaf', 'roundleaf', 'conifer', 'broadleaf']);
        for (let i = 0; i < k; i++) plant(i && rand() < 0.4 ? 'bush' : kind, x + (rand() - 0.5) * 14 * i, z + (rand() - 0.5) * 14 * i, 0.9 + rand() * 0.35);
    }

    // ---- Groves in the fields between the town and the track, and beyond it ----
    const groves: [number, number][] = [];
    for (let tries = 0; tries < 2000 && groves.length < 26; tries++) {
        const a = rand() * Math.PI * 2, r = 650 + rand() * 1000;
        const x = CX + Math.cos(a) * r, z = CZ + Math.sin(a) * r;
        if (inTown(x, z) || Math.abs(radius(x, z) - (TRACK_IN + TRACK_OUT) / 2) < 110 || speedwayRoad(x, z) || Math.abs(x) < 70) continue;
        if (groves.some(([gx, gz]) => Math.hypot(gx - x, gz - z) < 190)) continue;
        groves.push([x, z]);
    }
    groves.forEach(([gx, gz]) => {
        const type = rand();
        const kinds: PlantKind[] = type < 0.35 ? ['conifer', 'conifer', 'conifer', 'broadleaf'] : type < 0.7 ? ['broadleaf', 'roundleaf', 'broadleaf', 'bush'] : ['conifer', 'broadleaf', 'roundleaf'];
        const n = 6 + Math.floor(rand() * 10), spread = 16 + rand() * 24;
        for (let i = 0; i < n; i++) {
            const a = rand() * Math.PI * 2, r = spread * Math.sqrt(rand());
            plant(pick(kinds), gx + Math.cos(a) * r, gz + Math.sin(a) * r * 0.8, 0.95 + rand() * 0.45);
        }
    });

    // ---- The tree line beyond the speedway: clumps of woodland with gaps between ----
    const lineLen = 2 * Math.PI * TREE_LINE;
    for (let s = 0; s < lineLen; s += 55 + rand() * 60) {
        const a0 = s / TREE_LINE;
        if (Math.sin(a0 * 7 + 1.3) + Math.sin(a0 * 17 + 0.4) * 0.6 < -1.05) continue; // the odd clearing
        const conifers = rand() < 0.55, n = 3 + Math.floor(rand() * 4), width = 18 + rand() * 26;
        for (let i = 0; i < n; i++) {
            const a = a0 + ((rand() - 0.5) * width) / TREE_LINE, r = TREE_LINE + (rand() - 0.5) * 40;
            const kind: PlantKind = conifers ? (rand() < 0.8 ? 'conifer' : 'broadleaf') : (rand() < 0.7 ? 'broadleaf' : rand() < 0.5 ? 'roundleaf' : 'conifer');
            plant(kind, CX + Math.cos(a) * r, CZ + Math.sin(a) * r, 1.2 + rand() * 0.6);
        }
    }

    // ---- Hills: a ring of grass ridges around the whole map ----
    // Rings at these radii; heights follow this profile times a ridge height that rises
    // and falls around the ring (60..260 units), so the skyline is uneven.
    const RINGS = [2650, 2950, 3300, 3650, 4000, 4350, 4700];
    const PROFILE = [0, 0.22, 0.62, 1.0, 0.78, 1.04, 0.55];
    const SEG = 160;
    const ph = Array.from({ length: 6 }, () => rand() * Math.PI * 2);
    const ridge = (a: number, k: number) => {
        const t = a + k * 0.07;
        const v = 0.5 + 0.27 * Math.sin(3 * t + ph[0]) + 0.15 * Math.sin(7 * t + ph[1]) + 0.08 * Math.sin(13 * t + ph[2]) + 0.05 * Math.sin(29 * t + ph[3]);
        return 60 + 200 * Math.min(1, Math.max(0, v));
    };
    const height = (i: number, k: number) => PROFILE[k] * ridge((i / SEG) * Math.PI * 2, k) * (k ? 0.9 + 0.2 * Math.sin(i * 1.7 + k * 2.3 + ph[4]) * Math.sin(i * 0.31 + ph[5]) : 1);
    const P = (i: number, k: number): V3 => {
        const a = (i / SEG) * Math.PI * 2;
        return [CX + Math.cos(a) * RINGS[k], height(i % SEG, k), CZ + Math.sin(a) * RINGS[k]];
    };
    // smooth normals from the neighbouring points
    const N = (i: number, k: number): V3 => {
        const t0 = P((i + SEG - 1) % SEG, k), t1 = P((i + 1) % SEG, k);
        const r0 = P(i, Math.max(0, k - 1)), r1 = P(i, Math.min(RINGS.length - 1, k + 1));
        const tx = t1[0] - t0[0], ty = t1[1] - t0[1], tz = t1[2] - t0[2];
        const rx = r1[0] - r0[0], ry = r1[1] - r0[1], rz = r1[2] - r0[2];
        let nx = ty * rz - tz * ry, ny = tz * rx - tx * rz, nz = tx * ry - ty * rx;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const l = Math.hypot(nx, ny, nz) || 1;
        return [nx / l, ny / l, nz / l];
    };
    for (let i = 0; i < SEG; i++) for (let k = 0; k + 1 < RINGS.length; k++) {
        const pts = [P(i, k), P(i + 1, k), P(i + 1, k + 1), P(i, k + 1)];
        const nor = [N(i, k), N((i + 1) % SEG, k), N((i + 1) % SEG, k + 1), N(i, k + 1)];
        const cx = (pts[0][0] + pts[2][0]) / 2, cz = (pts[0][2] + pts[2][2]) / 2;
        // (counter-clockwise seen from above, so the faces point up)
        ctx.layers.lawn.at(cx, cz).mesh(pts, nor, [0, 1, 2, 0, 2, 3]);
    }
}
