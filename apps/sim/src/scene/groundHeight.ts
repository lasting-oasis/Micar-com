import type * as THREE from 'three';

// The height of the walkable ground under a point, for people only (the avatar, customers and
// other players): sidewalks, plazas, park paths, lawns, curbs and driveway crossings stand a
// few centimetres above the road (see scene/world/roads.ts, Y). Cars keep to y = 0.
//
// Built from the town's raised ground layers (concrete and lawn), a little each frame so joining
// doesn't stall (until a spot is done, people there stand at road height): every raised triangle
// (tops and the grass slopes; walls have no area from above) is rasterized into a sparse grid of
// 0.25-unit cells (16-unit tiles, allocated only where there is raised ground). A lookup is one
// tile fetch and one array read. Anything not
// covered (roads, lots, the open grass) reads as the road top, 0.03.

const CELL = 0.25;                 // world units per cell (curb tops are 0.3 wide)
const TILE = 64;                   // cells per tile side (16 units)
const BASE = 0.03;                 // road / lot paving top
const MIN_RAISED = 0.035;          // ignore the gutter pans and paint (within 1 cm of the road)
const START_DELAY_MS = 8000;       // after the first frame (out of the way of joining)

type LayerLike = { mesh: THREE.Mesh };

export type GroundHeight = {
    /** Top of the ground at (x, z), world units. */
    at: (x: number, z: number) => number;
    /** True once the grid is built. */
    readonly ready: boolean;
    /** Builds a little more of the grid (call once a frame; about `budgetMs` of work, so joining doesn't stall). */
    tick: (budgetMs?: number) => void;
};

export function createGroundHeight(layers: LayerLike[]): GroundHeight {
    const tiles = new Map<number, Uint8Array>(); // height in centimetre units (0 = not raised)
    let built = false;
    const key = (tx: number, tz: number) => (tx + 32768) * 65536 + (tz + 32768);

    // The layers' triangles: the packed layers keep their full list in `master` once finished
    // (cells.ts; they are finished on the first frame drawn).
    type Source = { p: Float32Array; ix: Uint32Array };
    let sources: Source[] | null = null;
    let src = 0, tri = 0, startAt = 0;
    const gather = (): Source[] | null => {
        const out: Source[] = [];
        for (const l of layers) {
            const pos = l.mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
            const ix = (l as unknown as { master?: Uint32Array | null }).master;
            if (!pos || !ix) return null;
            out.push({ p: pos.array as Float32Array, ix });
        }
        return out;
    };
    const raster = (p: Float32Array, ix: Uint32Array, t: number) => {
        const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
        const ya = p[a + 1], yb = p[b + 1], yc = p[c + 1];
        const top = Math.max(ya, yb, yc);
        if (top < MIN_RAISED || top > 1) return; // raised ground only (walls drop out below: no area seen from above)
        const ax = p[a], az = p[a + 2], bx = p[b], bz = p[b + 2], cx = p[c], cz = p[c + 2];
        const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(det) < 1e-9) return;
        const i0 = Math.floor(Math.min(ax, bx, cx) / CELL), i1 = Math.floor(Math.max(ax, bx, cx) / CELL);
        const j0 = Math.floor(Math.min(az, bz, cz) / CELL), j1 = Math.floor(Math.max(az, bz, cz) / CELL);
        for (let i = i0; i <= i1; i++) {
            const x = (i + 0.5) * CELL, tx = Math.floor(i / TILE);
            for (let j = j0; j <= j1; j++) {
                const z = (j + 0.5) * CELL;
                const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
                const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
                if (l1 < -1e-4 || l2 < -1e-4 || l1 + l2 > 1 + 1e-4) continue;
                const h = Math.round((l1 * ya + l2 * yb + (1 - l1 - l2) * yc) * 100); // (slopes: the berms down to the open ground)
                if (h < 4) continue;
                const tz = Math.floor(j / TILE), k = key(tx, tz);
                let tile = tiles.get(k);
                if (!tile) { tile = new Uint8Array(TILE * TILE); tiles.set(k, tile); }
                const o = (j - tz * TILE) * TILE + (i - tx * TILE);
                if (h > tile[o]) tile[o] = h; // overlapping pieces (a path on a lawn): the top one
            }
        }
    };

    return {
        get ready() { return built; },
        tick(budgetMs = 1.5) {
            if (built) return;
            // start a few seconds in: joining has enough to do (everyone starts on the lot, at road height)
            const now = performance.now();
            if (!startAt) startAt = now + START_DELAY_MS;
            if (now < startAt) return;
            sources ??= gather();
            if (!sources) return;
            const deadline = now + budgetMs;
            for (; src < sources.length; src++, tri = 0) {
                const { p, ix } = sources[src];
                for (; tri + 2 < ix.length; tri += 3) {
                    if (tri % 600 === 0 && performance.now() > deadline) return;
                    raster(p, ix, tri);
                }
            }
            built = true; sources = null;
        },
        at(x: number, z: number) {
            const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
            const tx = Math.floor(i / TILE), tz = Math.floor(j / TILE);
            const tile = tiles.get(key(tx, tz));
            if (!tile) return BASE;
            const h = tile[(j - tz * TILE) * TILE + (i - tx * TILE)];
            return h ? h / 100 : BASE;
        },
    };
}
