import { CELL, uvIn } from './carAtlas';
import { Curve, TRIM, buildStyleGeometry, type BodySpec, type StyleGeometry } from './carGeometry';

// Body styles: proportions at ~2 world units per metre, nose toward -Z.
// Each style = profile curves (see BodySpec) + its details (lamps, grille, plates,
// seams, handles, mirrors, interior).

type Builder = () => StyleGeometry;
type Soup = Parameters<Parameters<typeof buildStyleGeometry>[1]>[0];
type T = Parameters<Parameters<typeof buildStyleGeometry>[1]>[2];

/** Licence plate: a flat 0.62 x 0.3 plate standing just proud of the body (dir -1 front, +1 rear). */
function flatPlate(soup: Soup, s: BodySpec, t: T, dir: number, yc: number, cell: typeof CELL.plate) {
    const x0 = -0.31, x1 = 0.31, y0 = yc - 0.15, y1 = yc + 0.15;
    let z = dir < 0 ? Infinity : -Infinity;
    for (const x of [x0, 0, x1]) for (const y of [y0, yc, y1]) {
        const zz = dir < 0 ? t.frontZ(s, x, y) : t.rearZ(s, x, y);
        if (!Number.isNaN(zz)) z = dir < 0 ? Math.min(z, zz) : Math.max(z, zz);
    }
    z += dir * 0.02;
    const flip = dir < 0; // read correctly from the front
    const u0 = flip ? 1 : 0, u1 = flip ? 0 : 1;
    soup.quadF([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, dir], { slot: TRIM, uv: () => [0, 0] },
        [uvIn(cell, u0, 0), uvIn(cell, u1, 0), uvIn(cell, u1, 1), uvIn(cell, u0, 1)]);
}

// ------------------------------------------------------------------------- sedan
// Mid-size four-door saloon (Camry / Accord / 3 Series class): 9.6 x 3.7 x 2.9.
const sedan: Builder = () => {
    const s: BodySpec = {
        noseZ: -4.8, tailZ: 4.8, hw: 1.85,
        front: { bulge: 0.22, x0: 0.8 }, rear: { bulge: 0.1, x0: 1.0 },
        wheelR: 0.68, tyreW: 0.46, rimR: 0.45, wheelX: 1.56, axles: [-2.9, 2.75],
        archR: 0.84, archY: 0.62, archP: 2,
        bottom: new Curve([[-4.8, 0.54], [-4.74, 0.45], [-4.55, 0.39], [-4.0, 0.36], [-3.4, 0.34], [3.3, 0.34], [4.0, 0.4], [4.5, 0.5], [4.72, 0.62], [4.8, 0.76]]),
        shoulder: new Curve([[-4.8, 1.32], [-4.77, 1.42], [-4.7, 1.49], [-4.5, 1.54], [-3.8, 1.61], [-2.9, 1.69], [-1.75, 1.84], [-0.5, 1.94], [1.0, 2.0],
            [2.5, 2.06], [3.3, 2.09], [4.3, 2.1], [4.6, 2.06], [4.72, 1.98], [4.78, 1.86], [4.8, 1.72]]),
        crown: new Curve([[-4.8, 0], [-4.4, 0.05], [-1.9, 0.07], [3.3, 0.04], [4.8, 0.02]]),
        widest: 0.6, tumble: 0.08, rS: 0.12, rL: 0.12, rLip: 0.05, sillIn: 0.07, ledge: 0.05, wellDepth: 0.78,
        cabin: [-1.75, 3.12],
        railR: 0.14, roofCrown: 0.07,
        gh: {
            roof: new Curve([[-1.75, 1.83], [-1.35, 2.1], [-0.9, 2.42], [-0.45, 2.7], [-0.15, 2.83], [0.15, 2.88], [0.7, 2.9], [1.25, 2.87],
                [1.55, 2.8], [1.95, 2.62], [2.5, 2.35], [2.9, 2.16], [3.12, 2.08]]),
            rail: new Curve([[-1.75, 1.56], [-0.9, 1.44], [-0.15, 1.37], [0.7, 1.37], [1.5, 1.35], [2.4, 1.3], [3.12, 1.3]]),
            plan: new Curve([[-1.75, 0.2], [-0.4, 0.15], [0.25, 0], [1.2, 0], [1.8, -0.08], [3.12, -0.16]]),
            marks: [
                { z: -1.75, zone: 'ws', side: 'glass' },
                { z: -0.12, zone: 'roof', side: 'glass' },
                { z: 0.52, zone: 'roof', side: 'b' },
                { z: 0.76, zone: 'roof', side: 'glass' },
                { z: 1.4, zone: 'bl', side: 'glass' },
                { z: 1.9, zone: 'bl', side: 'c', slant: 0.28 },
                { z: 3.12, zone: 'bl', side: 'c' },
            ],
        },
    };
    return buildStyleGeometry(s, (soup, s, t) => {
        const black = t.trim('blackMatte'), chrome = t.trim('chrome');
        const lamp = { slot: TRIM, uv: () => [0, 0] as [number, number] };
        // --- front: swept headlights, upper grille with badge, lower intake with fog lamps, plate
        t.decal(soup, s, 'front', 0.52, 1.68, 1.18, 1.4, { r: lamp, cell: CELL.headS, na: 10, nb: 2, mirror: true });
        t.decal(soup, s, 'front', -0.47, 0.47, 0.98, 1.3, { r: lamp, cell: CELL.grilleS, na: 6, nb: 2, flipU: true });
        t.decal(soup, s, 'front', -1.12, 1.12, 0.5, 0.86, { r: lamp, cell: CELL.intakeS, na: 12, nb: 3, flipU: true });
        t.decal(soup, s, 'front', -1.4, 1.4, 0.41, 0.5, { r: black, na: 12, nb: 1 });
        flatPlate(soup, s, t, -1, 0.66, CELL.plate);
        // --- rear: wraparound tail lights, chrome bar, plate in a recess, diffuser, reflectors
        t.decal(soup, s, 'rear', 0.62, 1.7, 1.6, 1.9, { r: lamp, cell: CELL.tailS, na: 8, nb: 2, mirror: true });
        t.decal(soup, s, 'rear', -0.62, 0.62, 1.74, 1.8, { r: chrome, na: 6, nb: 1 });
        t.decal(soup, s, 'rear', -0.36, 0.36, 1.08, 1.46, { r: black, na: 4, nb: 2 });
        flatPlate(soup, s, t, 1, 1.27, CELL.plate);
        t.decal(soup, s, 'rear', -1.25, 1.25, 0.64, 0.8, { r: black, na: 10, nb: 2 });
        t.decal(soup, s, 'rear', 1.25, 1.62, 0.82, 0.88, { r: t.trim('redRefl'), na: 2, nb: 1, mirror: true });
        // --- sides: door gaps, handles, marker lamps
        for (const [z, y0, y1] of [[-1.62, 0.5, 1.78], [0.64, 0.45, 1.93], [1.86, 0.45, 1.99]])
            t.decal(soup, s, 'side', z - 0.011, z + 0.011, y0, y1, { r: t.trim('bodyGap'), na: 1, nb: 5, mirror: true, eps: 0.006 });
        for (const zc of [0.28, 1.55]) for (const sd of [1, -1]) {
            const x = t.sideX(s, zc, 1.7);
            t.cbox(soup, [sd * (x + 0.012), 1.7, zc], [0.03, 0.034, 0.16], 0, t.trim('satin'));
        }
        t.decal(soup, s, 'side', -4.1, -3.88, 0.98, 1.06, { r: t.trim('sideAmber'), na: 2, nb: 1, mirror: true });
        t.decal(soup, s, 'side', 3.95, 4.18, 1.0, 1.08, { r: t.trim('redRefl'), na: 2, nb: 1, mirror: true });
        // --- door mirrors: body-colour housing on a black stalk, mirror glass facing back
        for (const sd of [1, -1]) {
            const xs = t.sideX(s, -1.28, 1.76);
            t.cbox(soup, [sd * (xs + 0.07), 1.9, -1.28], [0.09, 0.035, 0.06], 0, black);
            t.cbox(soup, [sd * (xs + 0.25), 2.02, -1.3], [0.2, 0.12, 0.1], 0.05, t.R_PAINT, 0, sd * 0.08);
            t.cbox(soup, [sd * (xs + 0.25), 2.02, -1.205], [0.17, 0.095, 0.012], 0, t.trim('mirror'), 0, sd * 0.08);
        }
        // --- interior seen through the glass: dashboard, steering wheel, seats and headrests
        const seat = t.trim('seat'), dark = t.trim('interior');
        t.cbox(soup, [0, 1.92, -1.1], [1.42, 0.12, 0.25], 0, dark);
        t.ring(soup, [-0.72, 2.1, -0.78], 0.2, 0.25, 0.45, t.trim('interiorLt'));
        for (const x of [-0.72, 0.72]) {
            t.cbox(soup, [x, 2.12, 0.66], [0.3, 0.22, 0.09], 0, seat, 0.22);
            t.cbox(soup, [x, 2.5, 0.74], [0.2, 0.12, 0.07], 0.04, seat, 0.15);
        }
        t.cbox(soup, [0, 2.1, 1.84], [1.18, 0.2, 0.09], 0, seat, 0.3);
        for (const x of [-0.75, 0.75]) t.cbox(soup, [x, 2.42, 1.95], [0.17, 0.1, 0.06], 0, seat, 0.3);
    }, 1.85);
};

// ------------------------------------------------------------------------- truck
// Full-size crew-cab pickup (F-150 / Silverado class), short bed: 10.8 x 4.1 x 3.9.
const truck: Builder = () => {
    const s: BodySpec = {
        noseZ: -5.4, tailZ: 5.4, hw: 2.05,
        front: { bulge: 0, x0: 1.62 }, rear: { bulge: 0, x0: 1.9 },
        wheelR: 0.86, tyreW: 0.6, rimR: 0.5, wheelX: 1.72, axles: [-3.4, 3.15],
        archR: 1.06, archY: 0.78, archP: 3,
        bottom: new Curve([[-5.4, 1.0], [-5.32, 0.86], [-5.0, 0.76], [-4.4, 0.7], [4.4, 0.7], [5.2, 0.8], [5.4, 0.9]]),
        shoulder: new Curve([[-5.4, 2.36], [-5.34, 2.5], [-5.2, 2.57], [-4.6, 2.61], [-2.35, 2.68], [1.6, 2.72], [5.25, 2.72], [5.36, 2.7], [5.4, 2.64]]),
        crown: new Curve([[-5.4, 0], [-5.2, 0.07], [-2.5, 0.08], [-2.3, 0.03], [1.6, 0.03], [5.4, 0.01]]),
        widest: 0.55, tumble: 0.05, rS: 0.1, rL: 0.1, rLip: 0.05, sillIn: 0.05, ledge: 0.06, wellDepth: 0.95,
        cabin: [-2.3, 1.6],
        bed: { z0: 1.68, z1: 5.2, floorY: 1.6, railW: 0.15 },
        flare: 0.2,
        railR: 0.12, roofCrown: 0.05,
        gh: {
            roof: new Curve([[-2.3, 2.66], [-1.95, 3.15], [-1.55, 3.6], [-1.3, 3.77], [-1.0, 3.83], [0.2, 3.85], [1.2, 3.83], [1.46, 3.82],
                [1.5, 3.7], [1.53, 3.22], [1.56, 2.6]]),
            rail: new Curve([[-2.3, 1.84], [-1.55, 1.75], [-1.1, 1.72], [1.56, 1.72]]),
            plan: new Curve([[-2.3, 0.12], [-1.25, 0.06], [-0.8, 0], [1.56, 0]]),
            marks: [
                { z: -2.3, zone: 'ws', side: 'glass' },
                { z: -1.22, zone: 'roof', side: 'glass' },
                { z: 0.0, zone: 'roof', side: 'b' },
                { z: 0.22, zone: 'roof', side: 'glass' },
                { z: 1.18, zone: 'roof', side: 'c', slant: 0.12 },
                { z: 1.46, zone: 'back', side: 'c' },
                { z: 1.5, zone: 'backGlass', side: 'c' },
                { z: 1.53, zone: 'back', side: 'c' },
                { z: 1.56, zone: 'back', side: 'c' },
            ],
        },
    };
    return buildStyleGeometry(s, (soup, s, t) => {
        const black = t.trim('blackMatte'), gloss = t.trim('blackGloss');
        const lamp = { slot: TRIM, uv: () => [0, 0] as [number, number] };
        const flat = (x0: number, x1: number, y0: number, y1: number, z: number, dir: number, cell: typeof CELL.plate, flipU = false) => {
            const u0 = flipU ? 1 : 0, u1 = flipU ? 0 : 1;
            soup.quadF([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, dir], lamp,
                [uvIn(cell, u0, 0), uvIn(cell, u1, 0), uvIn(cell, u1, 1), uvIn(cell, u0, 1)]);
        };
        // --- front: big chrome grille, headlights, chrome bumper with a black lip and the plate
        t.decal(soup, s, 'front', -1.2, 1.2, 1.4, 2.28, { r: lamp, cell: CELL.grilleT, na: 2, nb: 1, flipU: true, eps: 0.03 });
        t.decal(soup, s, 'front', 1.22, 1.98, 1.84, 2.3, { r: lamp, cell: CELL.headT, na: 6, nb: 2, mirror: true });
        t.decal(soup, s, 'front', -1.55, 1.55, 1.28, 1.4, { r: black, na: 4, nb: 1 });
        t.cbox(soup, [0, 1.06, -5.47], [1.98, 0.3, 0.16], 0.08, t.trim('satin'));
        t.cbox(soup, [0, 0.8, -5.38], [1.78, 0.07, 0.13], 0, black);
        flat(-0.32, 0.32, 0.92, 1.2, -5.633, -1, CELL.plate, true);
        // --- rear: tailgate seams + handle, vertical tail lights, chrome step bumper, plate
        t.decal(soup, s, 'rear', 1.56, 1.6, 1.26, 2.62, { r: t.trim('bodyGap'), na: 1, nb: 1, mirror: true, eps: 0.006 });
        t.decal(soup, s, 'rear', -1.58, 1.58, 1.24, 1.28, { r: t.trim('bodyGap'), na: 2, nb: 1, eps: 0.006 });
        t.decal(soup, s, 'rear', -0.28, 0.28, 2.32, 2.46, { r: gloss, na: 2, nb: 1, eps: 0.02 });
        t.decal(soup, s, 'rear', 1.63, 1.89, 1.7, 2.58, { r: lamp, cell: CELL.tailT, na: 1, nb: 3, mirror: true });
        t.cbox(soup, [0, 1.02, 5.5], [1.95, 0.24, 0.16], 0.07, t.trim('satin'));
        t.cbox(soup, [0, 1.27, 5.48], [0.5, 0.02, 0.13], 0, black);
        flat(-0.32, 0.32, 0.86, 1.14, 5.663, 1, CELL.plate);
        // --- sides: door gaps, cab/bed gap, handles, running boards, marker lamps
        for (const [z, y0, y1, w] of [[-2.12, 0.95, 2.62, 0.014], [0.11, 0.78, 2.64, 0.014], [1.3, 0.78, 2.66, 0.014], [1.64, 0.92, 2.7, 0.03]])
            t.decal(soup, s, 'side', z - w, z + w, y0, y1, { r: t.trim('bodyGap'), na: 1, nb: 5, mirror: true, eps: 0.006 });
        for (const zc of [-0.25, 1.05]) for (const sd of [1, -1]) {
            const x = t.sideX(s, zc, 2.42);
            t.cbox(soup, [sd * (x + 0.015), 2.42, zc], [0.035, 0.045, 0.17], 0, gloss);
        }
        for (const sd of [1, -1]) t.cbox(soup, [sd * 2.06, 0.64, -0.42], [0.2, 0.045, 1.66], 0, black);
        t.decal(soup, s, 'side', -4.98, -4.76, 1.6, 1.68, { r: t.trim('sideAmber'), na: 2, nb: 1, mirror: true });
        t.decal(soup, s, 'side', 4.92, 5.12, 2.2, 2.28, { r: t.trim('redRefl'), na: 2, nb: 1, mirror: true });
        // --- roof marker lamps (amber, lit at night)
        for (const x of [-0.6, -0.3, 0, 0.3, 0.6]) t.cbox(soup, [x, 3.87, -1.1], [0.065, 0.025, 0.035], 0, t.trim('amber'));
        // --- big mirrors
        for (const sd of [1, -1]) {
            const xs = t.sideX(s, -1.95, 2.55);
            t.cbox(soup, [sd * (xs + 0.08), 2.78, -1.95], [0.1, 0.04, 0.07], 0, black);
            t.cbox(soup, [sd * (xs + 0.3), 2.92, -1.98], [0.24, 0.2, 0.1], 0.05, black, 0, sd * 0.06);
            t.cbox(soup, [sd * (xs + 0.3), 2.92, -1.875], [0.21, 0.17, 0.012], 0, t.trim('mirror'), 0, sd * 0.06);
        }
        // --- interior
        const seat = t.trim('seat'), dark = t.trim('interior');
        t.cbox(soup, [0, 2.78, -1.75], [1.6, 0.12, 0.28], 0, dark);
        t.ring(soup, [-0.8, 2.95, -1.25], 0.22, 0.28, 0.5, t.trim('interiorLt'));
        for (const x of [-0.8, 0.8]) {
            t.cbox(soup, [x, 2.88, 0.18], [0.33, 0.24, 0.1], 0, seat, 0.2);
            t.cbox(soup, [x, 3.3, 0.26], [0.21, 0.13, 0.08], 0.04, seat, 0.15);
        }
        t.cbox(soup, [0, 2.85, 1.28], [1.3, 0.22, 0.1], 0, seat, 0.25);
        for (const x of [-0.82, 0.82]) t.cbox(soup, [x, 3.2, 1.36], [0.18, 0.11, 0.07], 0, seat, 0.25);
    }, 2.85);
};

const BUILDERS: Record<string, Builder> = { sedan, truck };
// Styles not rebuilt yet borrow the closest new body (stage 1: sedan and pickup only).
const FALLBACK: Record<string, string> = { coupe: 'sedan', hatchback: 'sedan', sports: 'sedan', suv: 'truck', van: 'truck' };

const cache = new Map<string, StyleGeometry>();
/** Shared geometry for a body style (built on first use). */
export function getStyleGeometry(style: string): StyleGeometry {
    const key = BUILDERS[style] ? style : FALLBACK[style] ?? 'sedan';
    let g = cache.get(key);
    if (!g) { g = BUILDERS[key](); cache.set(key, g); }
    return g;
}
export function disposeStyleGeometries() {
    cache.forEach(g => { g.paint.dispose(); g.trim.dispose(); g.glass.dispose(); g.wheel.dispose(); });
    cache.clear();
}
