import { CELL, uvIn, type Rect, type Swatch } from './carAtlas';
import { Curve, TRIM, buildStyleGeometry, type BodySpec, type GhMark, type StyleGeometry, type V2 } from './carGeometry';

// Body styles: proportions at ~2 world units per metre, nose toward -Z.
// Each style = profile curves (see BodySpec) + its details (lamps, grille, plates,
// seams, handles, mirrors, interior).

type Builder = () => Generator<void, StyleGeometry, void>;
type Soup = Parameters<Parameters<typeof buildStyleGeometry>[1]>[0];
type T = Parameters<Parameters<typeof buildStyleGeometry>[1]>[2];
const C = (k: V2[]) => new Curve(k);
const LAMP = { slot: TRIM, uv: () => [0, 0] as V2 };

// ---------------------------------------------------------------------------------
// Details shared by the styles
/** Licence plate: a flat 0.62 x 0.3 plate standing just proud of the body (dir -1 front, +1 rear). */
function plate(soup: Soup, s: BodySpec, t: T, dir: number, yc: number) {
    const x0 = -0.31, x1 = 0.31, y0 = yc - 0.15, y1 = yc + 0.15;
    let z = dir < 0 ? Infinity : -Infinity;
    for (const x of [x0, 0, x1]) for (const y of [y0, yc, y1]) {
        const zz = dir < 0 ? t.frontZ(s, x, y) : t.rearZ(s, x, y);
        if (!Number.isNaN(zz)) z = dir < 0 ? Math.min(z, zz) : Math.max(z, zz);
    }
    flatPlate(soup, x0, x1, y0, y1, z + dir * 0.02, dir);
    t.farQuad(dir, x0, x1, y0, y1, z + dir * 0.02, 'white');
}
function flatPlate(soup: Soup, x0: number, x1: number, y0: number, y1: number, z: number, dir: number) {
    const u0 = dir < 0 ? 1 : 0, u1 = 1 - u0; // read correctly from the front too
    soup.quadF([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, dir], LAMP,
        [uvIn(CELL.plate, u0, 0), uvIn(CELL.plate, u1, 0), uvIn(CELL.plate, u1, 1), uvIn(CELL.plate, u0, 1)]);
}
/** A pair of lamps (right-hand rectangle, mirrored) that also glow at night and show on the far version. */
function lamps(soup: Soup, s: BodySpec, t: T, kind: 'head' | 'tail', cell: Rect, x0: number, x1: number, y0: number, y1: number, na = 8, nb = 2) {
    t.decal(soup, s, kind === 'head' ? 'front' : 'rear', x0, x1, y0, y1, { r: LAMP, cell, na, nb, mirror: true });
    t.lamp(kind, x0 + (x1 - x0) * 0.45, (y0 + y1) / 2, (x1 - x0) * 0.42, (y1 - y0) * 0.38);
}
/** Vertical panel gaps on both sides: [z, y0, y1, half-width]. */
function seams(soup: Soup, s: BodySpec, t: T, list: number[][]) {
    for (const [z, y0, y1, w = 0.011] of list) t.decal(soup, s, 'side', z - w, z + w, y0, y1, { r: t.trim('bodyGap'), na: 1, nb: 5, mirror: true, eps: 0.006 });
}
function handles(soup: Soup, s: BodySpec, t: T, zs: number[], y: number, mat: Swatch | 'paint') {
    for (const zc of zs) for (const sd of [1, -1]) {
        const x = t.sideX(s, zc, y);
        t.cbox(soup, [sd * (x + 0.012), y, zc], [0.03, 0.034, 0.16], 0, mat === 'paint' ? t.R_PAINT : t.trim(mat));
    }
}
/** Door mirrors on a black stalk; the housing is body colour or black. */
function mirrors(soup: Soup, s: BodySpec, t: T, z: number, yStalk: number, y: number, size: [number, number, number], body: boolean) {
    for (const sd of [1, -1]) {
        const xs = t.sideX(s, z, yStalk - 0.12);
        t.cbox(soup, [sd * (xs + 0.07), yStalk, z], [0.09, 0.035, 0.06], 0, t.trim('blackMatte'));
        t.cbox(soup, [sd * (xs + 0.07 + size[0]), y, z - 0.02], size, 0.05, body ? t.R_PAINT : t.trim('blackMatte'), 0, sd * 0.08);
        t.cbox(soup, [sd * (xs + 0.07 + size[0]), y, z - 0.02 + size[2] + 0.005], [size[0] * 0.85, size[1] * 0.8, 0.012], 0, t.trim('mirror'), 0, sd * 0.08);
    }
}
/** What you see of the interior through the glass: dash, steering wheel, seat backs and headrests. */
function interior(soup: Soup, t: T, o: { dash: [number, number, number, number]; wheel: [number, number, number]; rows: [number, number, number][] }) {
    const seat = t.trim('seat');
    const [dz, dy, dhw, dhz] = o.dash;
    t.cbox(soup, [0, dy, dz], [dhw, 0.12, dhz], 0, t.trim('interior'));
    t.ring(soup, o.wheel, 0.2, 0.25, 0.45, t.trim('interiorLt'));
    o.rows.forEach(([z, y, hw], i) => {
        if (i === 0) for (const x of [-0.72, 0.72]) {
            t.cbox(soup, [x * hw, y, z], [0.3, 0.22, 0.09], 0, seat, 0.22);
            t.cbox(soup, [x * hw, y + 0.38, z + 0.08], [0.2, 0.12, 0.07], 0, seat, 0.15);
        } else {
            t.cbox(soup, [0, y, z], [1.18 * hw, 0.2, 0.09], 0, seat, 0.3);
            for (const x of [-0.75, 0.75]) t.cbox(soup, [x * hw, y + 0.32, z + 0.1], [0.17, 0.1, 0.06], 0, seat, 0.3);
        }
    });
}

// ------------------------------------------------------------------------- sedan
// Mid-size four-door saloon (Camry / Accord / 3 Series class): 9.6 x 3.7 x 2.9.
const sedanSpec = (): BodySpec => ({
    noseZ: -4.8, tailZ: 4.8, hw: 1.85,
    front: { x0: 0.85, bulge: 0.2, len: 0.7, rake: 0.22 }, rear: { x0: 1.0, bulge: 0.1, len: 0.5, rake: 0.08 },
    wheelR: 0.68, tyreW: 0.46, rimR: 0.45, wheelX: 1.56, axles: [-2.9, 2.75],
    archR: 0.84, archY: 0.62, archP: 2,
    bottom: C([[-4.8, 0.5], [-4.74, 0.44], [-4.55, 0.39], [-4.0, 0.36], [-3.4, 0.34], [3.3, 0.34], [4.0, 0.4], [4.5, 0.52], [4.72, 0.66], [4.8, 0.76]]),
    shoulder: C([[-4.8, 1.36], [-4.76, 1.44], [-4.66, 1.5], [-4.45, 1.55], [-3.8, 1.61], [-2.9, 1.69], [-1.75, 1.84], [-0.5, 1.94], [1.0, 2.0],
        [2.5, 2.06], [3.3, 2.09], [4.3, 2.1], [4.62, 2.09], [4.72, 2.04], [4.78, 1.95], [4.8, 1.86]]),
    crown: C([[-4.8, 0.02], [-4.4, 0.05], [-1.9, 0.07], [3.3, 0.04], [4.8, 0.02]]),
    widest: 0.6, tumble: 0.08, rS: 0.12, rL: 0.12, rLip: 0.05, sillIn: 0.07, ledge: 0.05, wellDepth: 0.78,
    cabin: [-1.75, 3.12],
    railR: 0.14, roofCrown: 0.07,
    gh: {
        roof: C([[-1.75, 1.83], [-1.35, 2.1], [-0.9, 2.42], [-0.45, 2.7], [-0.15, 2.83], [0.15, 2.88], [0.7, 2.9], [1.25, 2.87],
            [1.55, 2.8], [1.95, 2.62], [2.5, 2.35], [2.9, 2.16], [3.12, 2.08]]),
        rail: C([[-1.75, 1.56], [-0.9, 1.44], [-0.15, 1.37], [0.7, 1.37], [1.5, 1.35], [2.4, 1.3], [3.12, 1.3]]),
        plan: C([[-1.75, 0.2], [-0.4, 0.15], [0.25, 0], [1.2, 0], [1.8, -0.08], [3.12, -0.16]]),
        marks: [
            { z: -1.75, zone: 'ws', side: 'glass' }, { z: -0.12, zone: 'roof', side: 'glass' },
            { z: 0.52, zone: 'roof', side: 'b' }, { z: 0.76, zone: 'roof', side: 'glass' },
            { z: 1.4, zone: 'bl', side: 'glass' }, { z: 1.9, zone: 'bl', side: 'c', slant: 0.28 }, { z: 3.12, zone: 'bl', side: 'c' },
        ],
    },
});
const sedan: Builder = () => {
    const s = BODY_SPECS.sedan;
    return buildStyleGeometry(s, (soup, s, t) => {
        const black = t.trim('blackMatte');
        // front: swept headlights, grille with badge, lower intake with fog lamps, plate
        lamps(soup, s, t, 'head', CELL.headS, 0.52, 1.68, 1.18, 1.4, 10);
        t.decal(soup, s, 'front', -0.47, 0.47, 0.98, 1.3, { r: LAMP, cell: CELL.grilleS, na: 6, nb: 2, flipU: true, far: 'blackMatte' });
        t.decal(soup, s, 'front', -1.12, 1.12, 0.5, 0.86, { r: LAMP, cell: CELL.intakeS, na: 12, nb: 3, flipU: true, far: 'blackMatte' });
        t.decal(soup, s, 'front', -1.4, 1.4, 0.41, 0.5, { r: black, na: 12, nb: 1 });
        plate(soup, s, t, -1, 0.66);
        // rear: tall wraparound tail lamps on the crisp trunk edge, chrome bar, plate, diffuser, twin exhausts
        lamps(soup, s, t, 'tail', CELL.tailS, 0.55, 1.74, 1.48, 1.83, 10);
        t.decal(soup, s, 'rear', -0.55, 0.55, 1.64, 1.7, { r: t.trim('chrome'), na: 6, nb: 1, far: 'chrome' });
        t.decal(soup, s, 'rear', -0.36, 0.36, 0.96, 1.34, { r: black, na: 4, nb: 2 });
        plate(soup, s, t, 1, 1.15);
        t.decal(soup, s, 'rear', -1.25, 1.25, 0.66, 0.8, { r: black, na: 10, nb: 2, far: 'blackMatte' });
        t.decal(soup, s, 'rear', 1.25, 1.62, 0.84, 0.9, { r: t.trim('redRefl'), na: 2, nb: 1, mirror: true });
        for (const sd of [1, -1]) { const z = t.rearZ(s, 0.78, 0.7); t.exhaust(soup, sd * 0.78, 0.7, z - 0.3, z + 0.07, 0.09, 0.07); }
        // sides
        seams(soup, s, t, [[-1.62, 0.5, 1.78], [0.64, 0.45, 1.93], [1.86, 0.45, 1.99]]);
        handles(soup, s, t, [0.28, 1.55], 1.7, 'satin');
        t.decal(soup, s, 'side', -4.1, -3.88, 0.98, 1.06, { r: t.trim('sideAmber'), na: 2, nb: 1, mirror: true });
        t.decal(soup, s, 'side', 3.95, 4.18, 1.0, 1.08, { r: t.trim('redRefl'), na: 2, nb: 1, mirror: true });
        mirrors(soup, s, t, -1.28, 1.9, 2.02, [0.2, 0.12, 0.1], true);
        interior(soup, t, { dash: [-1.1, 1.92, 1.42, 0.25], wheel: [-0.72, 2.1, -0.78], rows: [[0.66, 2.12, 1], [1.84, 2.1, 1]] });
    }, 1.85);
};

// ------------------------------------------------------------------------- coupe
// Two-door sports coupe (M4 / 4 Series class): 9.4 x 3.8 x 2.75. Long doors, a short
// sloping greenhouse with a small quarter window, wide slatted grille, quad exhausts.
const coupeSpec = (): BodySpec => ({
    noseZ: -4.7, tailZ: 4.7, hw: 1.9,
    front: { x0: 0.9, bulge: 0.18, len: 0.7, rake: 0.28 }, rear: { x0: 1.05, bulge: 0.08, len: 0.5, rake: 0.1 },
    wheelR: 0.68, tyreW: 0.52, rimR: 0.48, wheelX: 1.59, axles: [-2.95, 2.75],
    archR: 0.84, archY: 0.62, archP: 2,
    bottom: C([[-4.7, 0.44], [-4.64, 0.37], [-4.45, 0.32], [-3.9, 0.3], [3.5, 0.3], [4.2, 0.38], [4.6, 0.52], [4.7, 0.64]]),
    shoulder: C([[-4.7, 1.24], [-4.66, 1.33], [-4.55, 1.4], [-4.3, 1.46], [-3.6, 1.53], [-2.95, 1.6], [-1.55, 1.78], [0, 1.88], [1.5, 1.95],
        [2.9, 1.99], [4.25, 2.0], [4.52, 1.99], [4.62, 1.95], [4.67, 1.88], [4.7, 1.78]]),
    crown: C([[-4.7, 0.02], [-4.2, 0.07], [-1.7, 0.09], [3.0, 0.04], [4.7, 0.02]]),
    widest: 0.6, tumble: 0.1, rS: 0.13, rL: 0.12, rLip: 0.05, sillIn: 0.08, ledge: 0.05, wellDepth: 0.85,
    cabin: [-1.55, 2.95],
    railR: 0.14, roofCrown: 0.07,
    gh: {
        roof: C([[-1.55, 1.77], [-1.15, 2.08], [-0.7, 2.42], [-0.3, 2.63], [0.1, 2.72], [0.5, 2.74], [1.0, 2.7], [1.45, 2.58], [1.9, 2.38], [2.4, 2.17], [2.95, 1.98]]),
        rail: C([[-1.55, 1.62], [-0.7, 1.46], [0.2, 1.38], [1.2, 1.36], [2.2, 1.32], [2.95, 1.34]]),
        plan: C([[-1.55, 0.22], [-0.4, 0.15], [0.3, 0], [1.2, 0], [1.9, -0.1], [2.95, -0.18]]),
        marks: [
            { z: -1.55, zone: 'ws', side: 'glass' }, { z: -0.28, zone: 'roof', side: 'glass' },
            { z: 1.0, zone: 'roof', side: 'b' }, { z: 1.12, zone: 'roof', side: 'glass' },
            { z: 1.42, zone: 'bl', side: 'glass' }, { z: 1.7, zone: 'bl', side: 'c', slant: 0.38 }, { z: 2.95, zone: 'bl', side: 'c' },
        ],
    },
});
const coupe: Builder = () => {
    const s = BODY_SPECS.coupe;
    return buildStyleGeometry(s, (soup, s, t) => {
        const black = t.trim('blackMatte');
        lamps(soup, s, t, 'head', CELL.headSp, 0.55, 1.74, 1.1, 1.34, 10);
        t.decal(soup, s, 'front', -0.52, 0.52, 0.86, 1.26, { r: LAMP, cell: CELL.grilleC, na: 6, nb: 3, flipU: true, far: 'darkMetal' });
        t.decal(soup, s, 'front', -1.3, 1.3, 0.42, 0.76, { r: LAMP, cell: CELL.intakeS, na: 12, nb: 3, flipU: true, far: 'blackMatte' });
        t.decal(soup, s, 'front', -1.5, 1.5, 0.36, 0.44, { r: black, na: 12, nb: 1 });
        plate(soup, s, t, -1, 0.62);
        lamps(soup, s, t, 'tail', CELL.tailS, 0.62, 1.8, 1.44, 1.72, 10);
        t.decal(soup, s, 'rear', -0.36, 0.36, 0.92, 1.3, { r: black, na: 4, nb: 2 });
        plate(soup, s, t, 1, 1.11);
        t.decal(soup, s, 'rear', -1.3, 1.3, 0.56, 0.74, { r: t.trim('carbon'), na: 10, nb: 2, far: 'carbon' });
        for (const x of [-0.92, -0.62, 0.62, 0.92]) { const z = t.rearZ(s, Math.abs(x), 0.62); t.exhaust(soup, x, 0.62, z - 0.3, z + 0.07, 0.085, 0.085); }
        // a small lip spoiler on the trunk edge
        t.cbox(soup, [0, t.topY(s, 4.55) + 0.025, 4.56], [1.05, 0.025, 0.1], 0.02, t.R_PAINT, -0.25);
        seams(soup, s, t, [[-1.45, 0.45, 1.74], [1.12, 0.42, 1.93]]);
        handles(soup, s, t, [0.75], 1.62, 'paint');
        t.decal(soup, s, 'side', -1.98, -1.62, 1.18, 1.34, { r: LAMP, cell: CELL.vent, na: 2, nb: 2, mirror: true });
        t.decal(soup, s, 'side', -4.0, -3.8, 0.9, 0.98, { r: t.trim('sideAmber'), na: 2, nb: 1, mirror: true });
        mirrors(soup, s, t, -1.18, 1.84, 1.96, [0.2, 0.11, 0.1], true);
        interior(soup, t, { dash: [-0.95, 1.86, 1.45, 0.25], wheel: [-0.74, 2.04, -0.6], rows: [[0.6, 2.02, 1.02], [1.75, 1.98, 0.9]] });
    }, 1.8);
};

// ------------------------------------------------------------------------- sports
// Low, wide front-engined sports car (Mustang / Camaro class; Corvette, Supra and Z4
// use it too): 9.3 x 3.96 x 2.66. Long hood with a power bulge, blunt nose with a big
// black grille, cab pushed back, short fastback, twin round tail lamps, quad exhausts, wing.
const sportsSpec = (): BodySpec => ({
    noseZ: -4.65, tailZ: 4.65, hw: 1.98,
    front: { x0: 1.15, bulge: 0.12, len: 0.6, rake: 0.2 }, rear: { x0: 1.25, bulge: 0.06, len: 0.4, rake: 0.04 },
    wheelR: 0.7, tyreW: 0.6, rimR: 0.5, wheelX: 1.64, axles: [-2.85, 2.62],
    archR: 0.86, archY: 0.62, archP: 2.2,
    bottom: C([[-4.65, 0.46], [-4.58, 0.36], [-4.3, 0.3], [-3.5, 0.28], [3.4, 0.28], [4.2, 0.36], [4.65, 0.52]]),
    shoulder: C([[-4.65, 1.3], [-4.6, 1.38], [-4.45, 1.43], [-4.0, 1.47], [-2.85, 1.53], [-1.5, 1.6], [-0.6, 1.66], [0.6, 1.72], [2.0, 1.78],
        [3.4, 1.83], [4.3, 1.85], [4.52, 1.84], [4.6, 1.79], [4.65, 1.71]]),
    crown: C([[-4.65, 0.02], [-4.2, 0.08], [-3.4, 0.12], [-1.2, 0.13], [-0.6, 0.06], [4.65, 0.03]]),
    widest: 0.55, tumble: 0.14, rS: 0.14, rL: 0.1, rLip: 0.04, sillIn: 0.12, ledge: 0.04, wellDepth: 0.9,
    cabin: [-0.6, 2.9],
    railR: 0.13, roofCrown: 0.06,
    gh: {
        roof: C([[-0.6, 1.65], [-0.25, 1.97], [0.15, 2.28], [0.5, 2.48], [0.85, 2.57], [1.25, 2.57], [1.7, 2.46], [2.2, 2.24], [2.6, 2.03], [2.9, 1.86]]),
        rail: C([[-0.6, 1.68], [0.0, 1.52], [0.6, 1.4], [1.3, 1.36], [2.2, 1.36], [2.9, 1.4]]),
        plan: C([[-0.6, 0.24], [0.4, 0.14], [0.9, 0], [1.5, 0], [2.2, -0.12], [2.9, -0.2]]),
        marks: [
            { z: -0.6, zone: 'ws', side: 'glass' }, { z: 0.66, zone: 'roof', side: 'glass' },
            { z: 1.38, zone: 'bl', side: 'glass' }, { z: 1.62, zone: 'bl', side: 'c', slant: 0.42 }, { z: 2.9, zone: 'bl', side: 'c' },
        ],
    },
});
const sports: Builder = () => {
    const s = BODY_SPECS.sports;
    return buildStyleGeometry(s, (soup, s, t) => {
        const black = t.trim('blackMatte'), gloss = t.trim('blackGloss');
        // slim headlights at the top corners, big mesh grille between them, lower intake with fog lamps, splitter
        lamps(soup, s, t, 'head', CELL.headSp, 0.98, 1.8, 1.06, 1.26, 10);
        t.decal(soup, s, 'front', -0.94, 0.94, 0.76, 1.24, { r: LAMP, cell: CELL.grilleM, na: 8, nb: 3, flipU: true, far: 'blackMatte' });
        t.decal(soup, s, 'front', -1.36, 1.36, 0.44, 0.7, { r: LAMP, cell: CELL.intakeS, na: 12, nb: 2, flipU: true, far: 'blackMatte' });
        t.decal(soup, s, 'front', -1.62, 1.62, 0.34, 0.44, { r: t.trim('carbon'), na: 12, nb: 1 });
        plate(soup, s, t, -1, 0.92);
        // twin round tail lamps on a black panel, plate, diffuser, quad exhausts, wing
        t.decal(soup, s, 'rear', -0.55, 0.55, 1.34, 1.62, { r: gloss, na: 4, nb: 1, far: 'blackGloss' });
        lamps(soup, s, t, 'tail', CELL.tailSp, 0.55, 1.8, 1.32, 1.64, 10);
        plate(soup, s, t, 1, 1.0);
        t.decal(soup, s, 'rear', -1.35, 1.35, 0.44, 0.68, { r: t.trim('carbon'), na: 10, nb: 2, far: 'carbon' });
        for (const x of [-1.22, -0.98, 0.98, 1.22]) { const z = t.rearZ(s, Math.abs(x), 0.58); t.exhaust(soup, x, 0.58, z - 0.3, z + 0.08, 0.09, 0.09); }
        const yd = t.topY(s, 4.3);
        for (const x of [-1.05, 1.05]) t.cbox(soup, [x, yd + 0.08, 4.32], [0.04, 0.08, 0.08], 0, black);
        t.cbox(soup, [0, yd + 0.18, 4.36], [1.45, 0.03, 0.2], 0.02, t.R_PAINT, 0.12);
        seams(soup, s, t, [[-0.55, 0.42, 1.62], [1.66, 0.4, 1.8]]);
        handles(soup, s, t, [1.3], 1.5, 'paint');
        t.decal(soup, s, 'side', -1.95, -1.5, 0.92, 1.18, { r: LAMP, cell: CELL.vent, na: 2, nb: 2, mirror: true });
        t.decal(soup, s, 'side', -4.0, -3.78, 0.9, 0.98, { r: t.trim('sideAmber'), na: 2, nb: 1, mirror: true });
        mirrors(soup, s, t, -0.38, 1.68, 1.8, [0.2, 0.1, 0.1], true);
        interior(soup, t, { dash: [0.05, 1.7, 1.45, 0.25], wheel: [-0.74, 1.86, 0.3], rows: [[1.28, 1.8, 1.04]] });
    }, 1.75);
};

// ------------------------------------------------------------------------- hatchback
// Compact five-door hatchback (Fit / Focus / Prius): 8.6 x 3.56 x 2.95. Short nose,
// long roof, steep hatch with tall tail lamps.
const hatchbackSpec = (): BodySpec => ({
    noseZ: -4.3, tailZ: 4.3, hw: 1.78,
    front: { x0: 0.75, bulge: 0.22, len: 0.7, rake: 0.32 }, rear: { x0: 0.95, bulge: 0.08, len: 0.45, rake: -0.04 },
    wheelR: 0.62, tyreW: 0.42, rimR: 0.41, wheelX: 1.51, axles: [-2.62, 2.62],
    archR: 0.78, archY: 0.56, archP: 2,
    bottom: C([[-4.3, 0.5], [-4.24, 0.42], [-4.05, 0.37], [-3.5, 0.34], [3.0, 0.34], [3.8, 0.4], [4.2, 0.5], [4.3, 0.6]]),
    shoulder: C([[-4.3, 1.34], [-4.26, 1.42], [-4.15, 1.48], [-3.9, 1.54], [-3.2, 1.62], [-2.6, 1.7], [-1.85, 1.82], [-0.5, 1.95], [1.0, 2.03],
        [2.5, 2.1], [3.6, 2.14], [4.05, 2.14], [4.2, 2.1], [4.26, 2.03], [4.3, 1.95]]),
    crown: C([[-4.3, 0.02], [-3.8, 0.05], [-1.9, 0.06], [3.6, 0.03], [4.3, 0.02]]),
    widest: 0.6, tumble: 0.08, rS: 0.12, rL: 0.12, rLip: 0.05, sillIn: 0.07, ledge: 0.05, wellDepth: 0.74,
    cabin: [-1.85, 4.02],
    railR: 0.15, roofCrown: 0.07,
    gh: {
        roof: C([[-1.85, 1.81], [-1.45, 2.12], [-1.0, 2.46], [-0.6, 2.72], [-0.3, 2.85], [0.3, 2.93], [1.2, 2.94], [2.2, 2.91], [2.75, 2.86],
            [3.2, 2.7], [3.6, 2.48], [3.85, 2.3], [4.02, 2.13]]),
        rail: C([[-1.85, 1.52], [-1.0, 1.4], [-0.3, 1.33], [1.0, 1.33], [2.5, 1.3], [3.4, 1.25], [4.02, 1.22]]),
        plan: C([[-1.85, 0.2], [-0.5, 0.14], [0.2, 0], [2.6, 0], [3.2, -0.06], [4.02, -0.12]]),
        marks: [
            { z: -1.85, zone: 'ws', side: 'glass' }, { z: -0.32, zone: 'roof', side: 'glass' },
            { z: 0.55, zone: 'roof', side: 'b' }, { z: 0.76, zone: 'roof', side: 'glass' },
            { z: 2.2, zone: 'roof', side: 'c', slant: 0.25 }, { z: 2.8, zone: 'bl', side: 'c' }, { z: 4.02, zone: 'bl', side: 'c' },
        ],
    },
});
const hatchback: Builder = () => {
    const s = BODY_SPECS.hatchback;
    return buildStyleGeometry(s, (soup, s, t) => {
        const black = t.trim('blackMatte');
        lamps(soup, s, t, 'head', CELL.headS, 0.45, 1.6, 1.16, 1.38, 10);
        t.decal(soup, s, 'front', -0.42, 0.42, 1.0, 1.24, { r: LAMP, cell: CELL.grilleS, na: 6, nb: 2, flipU: true, far: 'blackMatte' });
        t.decal(soup, s, 'front', -0.98, 0.98, 0.5, 0.82, { r: LAMP, cell: CELL.intakeS, na: 10, nb: 3, flipU: true, far: 'blackMatte' });
        t.decal(soup, s, 'front', -1.3, 1.3, 0.42, 0.5, { r: black, na: 10, nb: 1 });
        plate(soup, s, t, -1, 0.66);
        // tall tail lamps on the hatch corners joined by a thin light bar, spoiler over the hatch glass
        lamps(soup, s, t, 'tail', CELL.tailT, 1.12, 1.68, 1.42, 1.92, 4, 3);
        t.decal(soup, s, 'rear', -1.12, 1.12, 1.6, 1.68, { r: LAMP, cell: CELL.tailBar, na: 8, nb: 1 });
        plate(soup, s, t, 1, 1.24);
        t.decal(soup, s, 'rear', -1.2, 1.2, 0.6, 0.74, { r: black, na: 10, nb: 2, far: 'blackMatte' });
        // roof spoiler: sits on the roof's back edge, over the top of the hatch glass
        const zs = 2.74, ys = s.gh.roof.at(zs) + s.roofCrown;
        t.cbox(soup, [0, ys + 0.015, zs + 0.1], [1.02, 0.035, 0.22], 0.02, t.R_PAINT, 0.08);
        seams(soup, s, t, [[-1.7, 0.5, 1.8], [0.65, 0.45, 1.97], [2.12, 0.45, 2.08]]);
        handles(soup, s, t, [0.3, 1.78], 1.72, 'paint');
        t.decal(soup, s, 'side', -3.75, -3.55, 0.95, 1.03, { r: t.trim('sideAmber'), na: 2, nb: 1, mirror: true });
        mirrors(soup, s, t, -1.38, 1.88, 2.0, [0.19, 0.12, 0.1], true);
        interior(soup, t, { dash: [-1.2, 1.9, 1.38, 0.25], wheel: [-0.7, 2.1, -0.85], rows: [[0.66, 2.12, 0.98], [2.05, 2.12, 0.96]] });
    }, 1.82);
};

// ------------------------------------------------------------------------- SUV
// Mid-size SUV (X5 / Explorer / Pilot; RAV4 to Tahoe use it too): 9.8 x 4.0 x 3.5.
// Tall, boxy, black arch flares and lower cladding, roof rails, near-vertical tailgate.
const suvSpec = (): BodySpec => {
    const roof = C([[-1.95, 2.35], [-1.6, 2.72], [-1.25, 3.08], [-0.95, 3.34], [-0.65, 3.44], [0.5, 3.48], [2.5, 3.47], [4.2, 3.43],
        [4.45, 3.36], [4.6, 3.0], [4.72, 2.53]]);
    const rail = C([[-1.95, 1.75], [-1.0, 1.66], [0, 1.62], [4.0, 1.6], [4.72, 1.6]]);
    return {
        noseZ: -4.9, tailZ: 4.9, hw: 2.0,
        front: { x0: 1.1, bulge: 0.12, len: 0.6, rake: 0.16 }, rear: { x0: 1.3, bulge: 0.06, len: 0.4, rake: 0.08 },
        wheelR: 0.78, tyreW: 0.56, rimR: 0.5, wheelX: 1.67, axles: [-2.98, 2.97],
        archR: 0.96, archY: 0.72, archP: 2.6, flare: 0.16, cladding: 0.32,
        bottom: C([[-4.9, 0.72], [-4.84, 0.62], [-4.6, 0.56], [-4.0, 0.54], [4.0, 0.54], [4.6, 0.6], [4.9, 0.78]]),
        shoulder: C([[-4.9, 1.9], [-4.86, 2.04], [-4.74, 2.12], [-4.4, 2.18], [-3.0, 2.26], [-1.95, 2.36], [0, 2.44], [2.0, 2.5], [3.9, 2.54],
            [4.6, 2.54], [4.8, 2.5], [4.87, 2.42], [4.9, 2.32]]),
        crown: C([[-4.9, 0.02], [-4.4, 0.07], [-2.0, 0.08], [4.9, 0.03]]),
        widest: 0.62, tumble: 0.07, rS: 0.12, rL: 0.12, rLip: 0.05, sillIn: 0.06, ledge: 0.05, wellDepth: 0.9,
        cabin: [-1.95, 4.7],
        railR: 0.15, roofCrown: 0.06,
        gh: {
            roof, rail,
            plan: C([[-1.95, 0.16], [-0.8, 0.1], [-0.3, 0], [4.2, 0], [4.72, -0.04]]),
            marks: [
                { z: -1.95, zone: 'ws', side: 'glass' }, { z: -0.75, zone: 'roof', side: 'glass' },
                { z: 0.4, zone: 'roof', side: 'b' }, { z: 0.62, zone: 'roof', side: 'glass' },
                { z: 2.35, zone: 'roof', side: 'b' }, { z: 2.55, zone: 'roof', side: 'glass' },
                { z: 3.95, zone: 'roof', side: 'c', slant: 0.2 }, { z: 4.45, zone: 'backGlass', side: 'c' }, { z: 4.72, zone: 'back', side: 'c' },
            ] as GhMark[],
        },
    };
};
const suv: Builder = () => {
    const s = BODY_SPECS.suv;
    return buildStyleGeometry(s, (soup, s, t) => {
        const black = t.trim('blackMatte'), satin = t.trim('satin');
        lamps(soup, s, t, 'head', CELL.headS, 0.84, 1.88, 1.82, 2.08, 10);
        t.decal(soup, s, 'front', -0.8, 0.8, 1.42, 2.02, { r: LAMP, cell: CELL.grilleT, na: 4, nb: 3, flipU: true, far: 'darkMetal' });
        t.decal(soup, s, 'front', -1.28, 1.28, 0.9, 1.26, { r: LAMP, cell: CELL.intakeS, na: 12, nb: 3, flipU: true, far: 'blackMatte' });
        t.decal(soup, s, 'front', -0.85, 0.85, 0.7, 0.86, { r: satin, na: 8, nb: 1, far: 'satin' });
        plate(soup, s, t, -1, 1.1);
        // wraparound tail lamps high on the tailgate, light bar, plate, skid plate, twin exhausts
        lamps(soup, s, t, 'tail', CELL.tailS, 0.95, 1.95, 2.08, 2.38, 10);
        t.decal(soup, s, 'rear', -0.95, 0.95, 2.2, 2.27, { r: LAMP, cell: CELL.tailBar, na: 8, nb: 1 });
        plate(soup, s, t, 1, 1.64);
        t.decal(soup, s, 'rear', -1.9, 1.9, 0.78, 1.12, { r: black, na: 12, nb: 2, far: 'blackMatte' });
        t.decal(soup, s, 'rear', -0.9, 0.9, 0.8, 0.94, { r: satin, na: 8, nb: 1, eps: 0.02 });
        for (const sd of [1, -1]) { const z = t.rearZ(s, 1.0, 0.86); t.exhaust(soup, sd * 1.0, 0.86, z - 0.3, z + 0.07, 0.1, 0.07); }
        // roof rails on two legs each
        for (const sd of [1, -1]) {
            const x = sd * (s.gh.rail.at(1.5) - 0.24), yr = s.gh.roof.at(1.5) + 0.16;
            t.cbox(soup, [x, yr, 1.55], [0.045, 0.035, 2.3], 0.015, t.trim('roofRail'));
            for (const z of [-0.6, 3.7]) t.cbox(soup, [x, (s.gh.roof.at(z) + yr) / 2, z], [0.05, (yr - s.gh.roof.at(z)) / 2 + 0.03, 0.08], 0, t.trim('roofRail'));
        }
        seams(soup, s, t, [[-1.85, 0.9, 2.3], [0.5, 0.85, 2.42], [2.42, 0.85, 2.48]]);
        handles(soup, s, t, [0.15, 2.0], 2.2, 'satin');
        t.decal(soup, s, 'side', -4.45, -4.25, 1.36, 1.44, { r: t.trim('sideAmber'), na: 2, nb: 1, mirror: true });
        mirrors(soup, s, t, -1.62, 2.42, 2.6, [0.24, 0.15, 0.11], true);
        interior(soup, t, { dash: [-1.25, 2.46, 1.55, 0.28], wheel: [-0.78, 2.66, -0.9], rows: [[0.75, 2.66, 1.05], [2.45, 2.7, 1.05]] });
    }, 2.6);
};

// ------------------------------------------------------------------------- van
// Minivan (Sienna / Odyssey): 10.3 x 3.96 x 3.5. One-box shape, short sloping nose,
// sliding rear door with its track along the rear quarter, blacked-out pillars.
const vanSpec = (): BodySpec => ({
    noseZ: -5.15, tailZ: 5.15, hw: 1.98,
    front: { x0: 1.05, bulge: 0.16, len: 0.7, rake: 0.3 }, rear: { x0: 1.3, bulge: 0.08, len: 0.45, rake: 0.05 },
    wheelR: 0.72, tyreW: 0.5, rimR: 0.47, wheelX: 1.68, axles: [-3.25, 2.85],
    archR: 0.88, archY: 0.66, archP: 2,
    bottom: C([[-5.15, 0.6], [-5.08, 0.5], [-4.85, 0.43], [-4.2, 0.4], [3.8, 0.4], [4.6, 0.47], [5.0, 0.58], [5.15, 0.7]]),
    shoulder: C([[-5.15, 1.5], [-5.1, 1.6], [-4.95, 1.68], [-4.6, 1.76], [-3.9, 1.88], [-3.2, 2.0], [-2.0, 2.06], [0, 2.1], [3.0, 2.16],
        [4.6, 2.18], [5.0, 2.16], [5.1, 2.1], [5.15, 2.0]]),
    crown: C([[-5.15, 0.02], [-4.6, 0.05], [-3.2, 0.06], [5.15, 0.02]]),
    widest: 0.6, tumble: 0.08, rS: 0.12, rL: 0.12, rLip: 0.05, sillIn: 0.06, ledge: 0.05, wellDepth: 0.85,
    cabin: [-3.2, 4.95],
    railR: 0.17, roofCrown: 0.07,
    gh: {
        roof: C([[-3.2, 1.99], [-2.85, 2.38], [-2.45, 2.8], [-2.05, 3.14], [-1.75, 3.33], [-1.3, 3.44], [0, 3.5], [3.0, 3.5], [4.4, 3.46],
            [4.62, 3.38], [4.8, 2.9], [4.95, 2.15]]),
        rail: C([[-3.2, 1.78], [-2.0, 1.66], [-1.0, 1.62], [4.0, 1.6], [4.95, 1.58]]),
        plan: C([[-3.2, 0.26], [-1.8, 0.16], [-1.0, 0], [4.3, 0], [4.95, -0.06]]),
        marks: [
            { z: -3.2, zone: 'ws', side: 'glass' }, { z: -1.7, zone: 'roof', side: 'glass' },
            { z: -0.25, zone: 'roof', side: 'b' }, { z: -0.05, zone: 'roof', side: 'glass' },
            { z: 1.95, zone: 'roof', side: 'b' }, { z: 2.12, zone: 'roof', side: 'glass' },
            { z: 4.4, zone: 'roof', side: 'b' }, { z: 4.62, zone: 'backGlass', side: 'b' }, { z: 4.95, zone: 'back', side: 'b' },
        ],
    },
});
const van: Builder = () => {
    const s = BODY_SPECS.van;
    return buildStyleGeometry(s, (soup, s, t) => {
        const black = t.trim('blackMatte');
        lamps(soup, s, t, 'head', CELL.headS, 0.55, 1.74, 1.42, 1.7, 10);
        t.decal(soup, s, 'front', -0.5, 0.5, 1.28, 1.52, { r: LAMP, cell: CELL.grilleS, na: 6, nb: 2, flipU: true, far: 'blackMatte' });
        t.decal(soup, s, 'front', -1.28, 1.28, 0.55, 0.98, { r: LAMP, cell: CELL.intakeS, na: 12, nb: 3, flipU: true, far: 'blackMatte' });
        t.decal(soup, s, 'front', -1.5, 1.5, 0.5, 0.56, { r: black, na: 16, nb: 1, eps: 0.03 });
        plate(soup, s, t, -1, 1.08);
        // tall tail lamps on the tailgate corners with a light bar between them
        lamps(soup, s, t, 'tail', CELL.tailT, 1.42, 1.9, 1.48, 2.08, 4, 3);
        t.decal(soup, s, 'rear', -1.42, 1.42, 1.94, 2.02, { r: LAMP, cell: CELL.tailBar, na: 8, nb: 1 });
        plate(soup, s, t, 1, 1.44);
        t.decal(soup, s, 'rear', -1.6, 1.6, 0.6, 0.84, { r: black, na: 12, nb: 2, far: 'blackMatte' });
        // front door and sliding door gaps, the sliding door's track along the rear quarter
        seams(soup, s, t, [[-2.95, 0.9, 1.98], [-0.12, 0.55, 2.08], [2.02, 0.55, 2.12]]);
        t.decal(soup, s, 'side', 2.02, 4.35, 2.02, 2.07, { r: t.trim('bodyGap'), na: 6, nb: 1, mirror: true, eps: 0.006 });
        handles(soup, s, t, [-0.95, 0.12], 1.94, 'satin');
        t.decal(soup, s, 'side', -4.7, -4.5, 1.16, 1.24, { r: t.trim('sideAmber'), na: 2, nb: 1, mirror: true });
        mirrors(soup, s, t, -2.85, 2.08, 2.3, [0.22, 0.14, 0.11], true);
        interior(soup, t, { dash: [-2.4, 2.1, 1.5, 0.3], wheel: [-0.76, 2.34, -1.95], rows: [[-0.55, 2.2, 1.04], [1.35, 2.22, 1.04], [3.25, 2.24, 1.04]] });
    }, 2.15);
};

// ------------------------------------------------------------------------- truck
// Full-size crew-cab pickup (F-150 / Silverado class), short bed: 10.8 x 4.1 x 3.9.
const truckSpec = (): BodySpec => ({
    noseZ: -5.4, tailZ: 5.4, hw: 2.05,
    front: { x0: 1.62, bulge: 0.04, len: 0.4, rake: 0.04 }, rear: { x0: 1.9, bulge: 0, len: 0.2, rake: 0 },
    wheelR: 0.86, tyreW: 0.6, rimR: 0.5, wheelX: 1.72, axles: [-3.4, 3.15],
    archR: 1.06, archY: 0.78, archP: 3,
    bottom: C([[-5.4, 1.0], [-5.32, 0.86], [-5.0, 0.76], [-4.4, 0.7], [4.4, 0.7], [5.2, 0.8], [5.4, 0.9]]),
    shoulder: C([[-5.4, 2.36], [-5.34, 2.5], [-5.2, 2.57], [-4.6, 2.61], [-2.35, 2.68], [1.6, 2.72], [5.25, 2.72], [5.36, 2.7], [5.4, 2.64]]),
    crown: C([[-5.4, 0], [-5.2, 0.07], [-2.5, 0.08], [-2.3, 0.03], [1.6, 0.03], [5.4, 0.01]]),
    widest: 0.55, tumble: 0.05, rS: 0.1, rL: 0.1, rLip: 0.05, sillIn: 0.05, ledge: 0.06, wellDepth: 0.95,
    cabin: [-2.3, 1.6],
    bed: { z0: 1.68, z1: 5.2, floorY: 1.6, railW: 0.15 },
    flare: 0.2,
    railR: 0.12, roofCrown: 0.05,
    gh: {
        roof: C([[-2.3, 2.66], [-1.95, 3.15], [-1.55, 3.6], [-1.3, 3.77], [-1.0, 3.83], [0.2, 3.85], [1.2, 3.83], [1.46, 3.82],
            [1.5, 3.7], [1.53, 3.22], [1.56, 2.6]]),
        rail: C([[-2.3, 1.84], [-1.55, 1.75], [-1.1, 1.72], [1.56, 1.72]]),
        plan: C([[-2.3, 0.12], [-1.25, 0.06], [-0.8, 0], [1.56, 0]]),
        marks: [
            { z: -2.3, zone: 'ws', side: 'glass' }, { z: -1.22, zone: 'roof', side: 'glass' },
            { z: 0.0, zone: 'roof', side: 'b' }, { z: 0.22, zone: 'roof', side: 'glass' },
            { z: 1.18, zone: 'roof', side: 'c', slant: 0.12 }, { z: 1.46, zone: 'back', side: 'c' },
            { z: 1.5, zone: 'backGlass', side: 'c' }, { z: 1.53, zone: 'back', side: 'c' }, { z: 1.56, zone: 'back', side: 'c' },
        ],
    },
});
const truck: Builder = () => {
    const s = BODY_SPECS.truck;
    return buildStyleGeometry(s, (soup, s, t) => {
        const black = t.trim('blackMatte'), gloss = t.trim('blackGloss'), satin = t.trim('satin');
        // front: big chrome grille, headlights, chrome bumper with a black lip and the plate
        t.decal(soup, s, 'front', -1.2, 1.2, 1.4, 2.28, { r: LAMP, cell: CELL.grilleT, na: 2, nb: 1, flipU: true, eps: 0.03, far: 'satin' });
        lamps(soup, s, t, 'head', CELL.headT, 1.22, 1.98, 1.84, 2.3, 6);
        t.decal(soup, s, 'front', -1.55, 1.55, 1.28, 1.4, { r: black, na: 4, nb: 1 });
        t.cbox(soup, [0, 1.06, -5.47], [1.98, 0.3, 0.16], 0.08, satin);
        t.farBox([0, 1.06, -5.47], [1.98, 0.3, 0.16], 'satin');
        t.cbox(soup, [0, 0.8, -5.38], [1.78, 0.07, 0.13], 0, black);
        flatPlate(soup, -0.31, 0.31, 0.92, 1.2, -5.633, -1);
        t.farQuad(-1, -0.31, 0.31, 0.92, 1.2, -5.653, 'white');
        // rear: tailgate gaps + handle, vertical tail lamps, chrome step bumper, plate, exhaust
        t.decal(soup, s, 'rear', 1.56, 1.6, 1.26, 2.62, { r: t.trim('bodyGap'), na: 1, nb: 1, mirror: true, eps: 0.006 });
        t.decal(soup, s, 'rear', -1.58, 1.58, 1.24, 1.28, { r: t.trim('bodyGap'), na: 2, nb: 1, eps: 0.006 });
        t.decal(soup, s, 'rear', -0.28, 0.28, 2.32, 2.46, { r: gloss, na: 2, nb: 1, eps: 0.02 });
        lamps(soup, s, t, 'tail', CELL.tailT, 1.63, 1.89, 1.7, 2.58, 1, 3);
        t.cbox(soup, [0, 1.02, 5.5], [1.95, 0.24, 0.16], 0.07, satin);
        t.farBox([0, 1.02, 5.5], [1.95, 0.24, 0.16], 'satin');
        t.cbox(soup, [0, 1.27, 5.48], [0.5, 0.02, 0.13], 0, black);
        flatPlate(soup, -0.31, 0.31, 0.86, 1.14, 5.663, 1);
        t.farQuad(1, -0.31, 0.31, 0.86, 1.14, 5.683, 'white');
        t.exhaust(soup, 1.35, 0.78, 5.15, 5.52, 0.1, 0.1);
        // sides: door gaps, cab/bed gap, handles, running boards, marker lamps
        seams(soup, s, t, [[-2.12, 0.95, 2.62, 0.014], [0.11, 0.78, 2.64, 0.014], [1.3, 0.78, 2.66, 0.014], [1.64, 0.92, 2.7, 0.03]]);
        handles(soup, s, t, [-0.25, 1.05], 2.42, 'blackGloss');
        for (const sd of [1, -1]) t.cbox(soup, [sd * 2.06, 0.64, -0.42], [0.2, 0.045, 1.66], 0, black);
        t.decal(soup, s, 'side', -4.98, -4.76, 1.6, 1.68, { r: t.trim('sideAmber'), na: 2, nb: 1, mirror: true });
        t.decal(soup, s, 'side', 4.92, 5.12, 2.2, 2.28, { r: t.trim('redRefl'), na: 2, nb: 1, mirror: true });
        for (const x of [-0.6, -0.3, 0, 0.3, 0.6]) t.cbox(soup, [x, 3.87, -1.1], [0.065, 0.025, 0.035], 0, t.trim('amber'));
        mirrors(soup, s, t, -1.95, 2.78, 2.92, [0.24, 0.2, 0.1], false);
        interior(soup, t, { dash: [-1.75, 2.78, 1.6, 0.28], wheel: [-0.8, 2.95, -1.25], rows: [[0.18, 2.88, 1.1], [1.28, 2.85, 1.1]] });
    }, 2.85);
};

/** Each style's profile (built once; read by the builders and by anything that fits parts to a body). */
export type CarStyleKey = 'sedan' | 'coupe' | 'sports' | 'hatchback' | 'suv' | 'van' | 'truck';
export const BODY_SPECS: Record<CarStyleKey, BodySpec> = {
    sedan: sedanSpec(), coupe: coupeSpec(), sports: sportsSpec(), hatchback: hatchbackSpec(), suv: suvSpec(), van: vanSpec(), truck: truckSpec(),
};
const BUILDERS: Record<string, Builder> = { sedan, coupe, sports, hatchback, suv, van, truck };
export const CAR_STYLES = Object.keys(BUILDERS);
export const styleKey = (style: string) => BUILDERS[style] ? style : 'sedan';

const cache = new Map<string, StyleGeometry>();
const pending = new Map<string, Generator<void, StyleGeometry, void>>();
export const isStyleBuilt = (style: string) => cache.has(styleKey(style));
/** Do the next step of building a style's geometry; true once it is built. */
export function stepStyle(style: string): boolean {
    const key = styleKey(style);
    if (cache.has(key)) return true;
    let gen = pending.get(key);
    if (!gen) pending.set(key, gen = BUILDERS[key]());
    const r = gen.next();
    if (!r.done) return false;
    cache.set(key, r.value); pending.delete(key);
    return true;
}
/** Shared geometry for a body style (built now if it isn't yet). */
export function getStyleGeometry(style: string): StyleGeometry {
    const key = styleKey(style);
    while (!stepStyle(key)) { /* build the remaining steps */ }
    return cache.get(key)!;
}
export function disposeStyleGeometries() {
    cache.forEach(g => [g.paint, g.trim, g.glass, g.wheel, g.wheelBlur, g.farPaint, g.farTrim, g.halos].forEach(x => x.dispose()));
    cache.clear(); pending.clear();
}
