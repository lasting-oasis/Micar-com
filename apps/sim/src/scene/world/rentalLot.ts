import * as THREE from 'three';
import { RENTAL_BAY, RENTAL_BLOCK } from '../../world/rental';
import { BL, CELL, RW } from '../../world/strip/routes';
import { WORLD_PER_M } from '../../world/units';

// The Strip's rental lot, on the block the city leaves empty (RENTAL_BLOCK, buildCity's `reserved`):
// a low slab, a lit canopy over the bay where a rented car waits (RENTAL_BAY) and the counter kiosk
// with its RENT sign. Laid out in metres, built in world units (×WORLD_PER_M), like the Strip's city.
// Add `group` to the Strip's scene after load (as buildStripExit's ring).

const PAINT = '#ffd23f', NIGHT = '#0e1217';
const W = WORLD_PER_M;
/** the counter kiosk (metres) */
export const RENTAL_KIOSK = { x: 660, z: 690 };

function rentSign(): { mesh: THREE.Mesh; dispose(): void } {
    let tex: THREE.CanvasTexture | null = null;
    if (typeof document !== 'undefined') {
        const c = document.createElement('canvas'); c.width = 512; c.height = 192;
        const g = c.getContext('2d');
        if (g) {
            g.fillStyle = NIGHT; g.fillRect(0, 0, 512, 192);
            g.strokeStyle = PAINT; g.lineWidth = 10; g.strokeRect(10, 10, 492, 172);
            g.fillStyle = PAINT; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.font = "italic 900 132px 'Barlow Condensed','Arial Narrow',sans-serif";
            g.fillText('RENT', 256, 100);
        }
        tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    }
    const geo = new THREE.PlaneGeometry(5 * W, 1.875 * W);
    // bright enough to bloom a little under the Strip's tone mapping
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: tex ? new THREE.Color(1.6, 1.6, 1.6) : PAINT, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat); mesh.name = 'rentSign';
    return { mesh, dispose: () => { geo.dispose(); mat.dispose(); tex?.dispose(); } };
}

export function buildRentalLot(): { group: THREE.Group; dispose(): void } {
    const group = new THREE.Group(); group.name = 'rentalLot';
    const geos: THREE.BufferGeometry[] = [], mats: THREE.Material[] = [];
    const geo = <T extends THREE.BufferGeometry>(g: T): T => { geos.push(g); return g; };
    const mat = <T extends THREE.Material>(m: T): T => { mats.push(m); return m; };
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) => {
        const mesh = new THREE.Mesh(geo(new THREE.BoxGeometry(w * W, h * W, d * W)), m);
        mesh.position.set(x * W, y * W, z * W); mesh.rotation.y = ry; group.add(mesh); return mesh;
    };

    // the slab: the whole block, a touch lower than the city's (0.22 m) so its kerb reads as the lot's
    const [bi, bj] = RENTAL_BLOCK;
    const x0 = bi * CELL + RW / 2, z0 = bj * CELL + RW / 2;
    box(BL, .16, BL, mat(new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: .85, metalness: .1 })), x0 + BL / 2, .08, z0 + BL / 2);

    // the bay: painted outline on the slab, under a canopy on four posts, lit from the underside
    const { x: bx, z: bz, h } = RENTAL_BAY, ry = h; // the bay's long side runs along the car's heading
    const paint = mat(new THREE.MeshBasicMaterial({ color: PAINT }));
    const bay = new THREE.Group(); bay.position.set(bx * W, 0, bz * W); bay.rotation.y = ry; group.add(bay);
    const local = (w: number, hh: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
        const mesh = new THREE.Mesh(geo(new THREE.BoxGeometry(w * W, hh * W, d * W)), m);
        mesh.position.set(x * W, y * W, z * W); bay.add(mesh); return mesh;
    };
    const BW = 4.4, BD = 7.2, CH = 6.4; // bay width (across) and depth (along the heading), canopy height, metres
    for (const s of [-1, 1]) local(.18, .02, BD, paint, s * BW / 2, .17, 0);
    local(BW, .02, .18, paint, 0, .17, -BD / 2);
    const postMat = mat(new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: .6, metalness: .5 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) local(.3, CH - .2, .3, postMat, sx * (BW / 2 + .6), (CH - .2) / 2 + .16, sz * (BD / 2 + .2));
    local(BW + 2, .35, BD + 1.4, mat(new THREE.MeshStandardMaterial({ color: 0x1a1e26, roughness: .7, metalness: .3 })), 0, CH + .16, 0);
    // a yellow fascia round the roof, and the glowing panel underneath
    for (const s of [-1, 1]) { local(.08, .3, BD + 1.4, paint, s * (BW / 2 + 1.04), CH + .16, 0); local(BW + 2.16, .3, .08, paint, 0, CH + .16, s * (BD / 2 + .74)); }
    // (two light bars, not a whole glowing ceiling: the chase camera sits under it)
    const barMat = mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, .97, .9).multiplyScalar(1.5) }));
    for (const s of [-1, 1]) local(.35, .08, BD, barMat, s * BW / 4, CH - .22 + .16, 0);
    // the light: one spot down onto the bay (added at load, so the Strip's light count stays fixed after)
    const spot = new THREE.SpotLight(0xfff1d6, 90 * W * W, 16 * W, Math.PI / 3, .55, 2);
    spot.position.set(0, (CH - .4) * W, 0); spot.target.position.set(0, 0, 0); bay.add(spot, spot.target);
    // and a warm pool on the slab (additive, like the street lamps' pools)
    const pool = new THREE.Mesh(geo(new THREE.CircleGeometry(5.5 * W, 40)), mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, .82, .45), transparent: true, opacity: .2, blending: THREE.AdditiveBlending, depthWrite: false })));
    pool.rotation.x = -Math.PI / 2; pool.position.y = .19 * W; pool.renderOrder = 2; bay.add(pool);

    // the counter kiosk: a small booth facing the bay, its RENT sign on a post above
    const { x: kx, z: kz } = RENTAL_KIOSK;
    const face = Math.atan2(bx - kx, bz - kz); // +Z of the kiosk looks at the bay
    const booth = mat(new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: .6, metalness: .3 }));
    const kiosk = new THREE.Group(); kiosk.position.set(kx * W, 0, kz * W); kiosk.rotation.y = face; group.add(kiosk);
    const k = (w: number, hh: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
        const mesh = new THREE.Mesh(geo(new THREE.BoxGeometry(w * W, hh * W, d * W)), m);
        mesh.position.set(x * W, y * W, z * W); kiosk.add(mesh); return mesh;
    };
    k(3.6, 2.8, 2.4, booth, 0, 1.4 + .16, 0);
    k(3.8, .14, .8, paint, 0, 1.1 + .16, 1.5);                        // the counter top
    k(3.2, 1.2, .05, mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, .85, .5).multiplyScalar(1.2) })), 0, 1.95 + .16, 1.22); // the lit window
    k(4, .2, 3, booth, 0, 2.9 + .16, .3);                             // the roof
    k(.18, 2.4, .18, postMat, 0, 4.2 + .16, 0);
    const sign = rentSign(); sign.mesh.position.set(0, 5.6 * W, 0); kiosk.add(sign.mesh);

    let disposed = false;
    return {
        group,
        dispose() {
            if (disposed) return; disposed = true;
            group.removeFromParent();
            for (const g of geos) g.dispose(); for (const m of mats) m.dispose();
            sign.dispose(); spot.dispose();
        },
    };
}
