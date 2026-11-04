import * as THREE from 'three';

// One texture atlas shared by every car: rims, tyres, lamps, grilles, plates,
// bed liner and flat swatches (black plastic, chrome, interior ...). Three canvases
// with the same layout: colour, roughness/metalness (G/B, three.js convention) and
// the glow of the lamps (emissive). Drawn once at runtime; nothing to download.

export const ATLAS_W = 1024, ATLAS_H = 512;
export type Rect = { x: number; y: number; w: number; h: number };

export const CELL = {
    rim:     { x: 0,   y: 0,   w: 256, h: 256 },
    headS:   { x: 256, y: 0,   w: 256, h: 80 },   // sedan headlight (u: inner→outer end)
    tailS:   { x: 256, y: 80,  w: 256, h: 80 },   // sedan tail light (u: inner→outer end)
    grilleS: { x: 256, y: 160, w: 256, h: 96 },   // sedan upper grille
    grilleT: { x: 0,   y: 256, w: 256, h: 128 },  // truck grille
    headT:   { x: 256, y: 256, w: 128, h: 96 },   // truck headlight (u: inner→outer)
    tailT:   { x: 384, y: 256, w: 64,  h: 128 },  // truck tail light (vertical)
    plate:   { x: 256, y: 352, w: 128, h: 64 },
    intakeS: { x: 0,   y: 384, w: 256, h: 64 },   // sedan lower intake with fog lamps
    bed:     { x: 0,   y: 448, w: 128, h: 64 },   // ribbed bed liner
    tyre:    { x: 128, y: 448, w: 128, h: 64 },   // u: around the tyre, v: across the tread/sidewall
    rimBlur: { x: 512, y: 0,   w: 128, h: 128 },  // the rim spinning fast (spokes smeared into rings)
    headSp:  { x: 640, y: 0,   w: 256, h: 64 },   // slim sports / coupe headlight (u: inner→outer)
    tailSp:  { x: 640, y: 64,  w: 256, h: 64 },   // twin round tail lamps (u: inner→outer)
    grilleC: { x: 512, y: 128, w: 256, h: 96 },   // coupe grille with vertical slats
    tailBar: { x: 768, y: 128, w: 256, h: 32 },   // full-width light bar across a tailgate
    vent:    { x: 768, y: 160, w: 128, h: 64 },   // black side / hood vent with slats
    grilleM: { x: 512, y: 224, w: 256, h: 96 },   // sports car's big black mesh grille
} satisfies Record<string, Rect>;

// Flat swatches, 32x32 px, in two 128x128 blocks
const SWATCH_NAMES = [
    'blackMatte', 'blackGloss', 'chrome', 'interior',
    'interiorLt', 'under', 'mirror', 'redRefl',
    'amber', 'darkMetal', 'white', 'rubber',
    'sideAmber', 'bodyGap', 'satin', 'seat',
    'glassFar', 'lampHead', 'lampTail', 'roofRail',
    'rimFar', 'carbon', 'lampRev', 'exhaustIn',
] as const;
export type Swatch = typeof SWATCH_NAMES[number];
const swatchRect = (name: Swatch): Rect => {
    const i = SWATCH_NAMES.indexOf(name), j = i % 16;
    const bx = i < 16 ? 384 : 896, by = i < 16 ? 384 : 0;
    return { x: bx + (j % 4) * 32, y: by + Math.floor(j / 4) * 32, w: 32, h: 32 };
};

/** Atlas UV of the point (u, v) of a cell; u left→right, v bottom→top, both 0..1. */
export const uvIn = (r: Rect, u: number, v: number): [number, number] => {
    const px = r.x + 0.75 + u * (r.w - 1.5), py = r.y + 0.75 + (1 - v) * (r.h - 1.5);
    return [px / ATLAS_W, 1 - py / ATLAS_H];
};
/** Atlas UV of the centre of a flat swatch. */
export const swatchUV = (name: Swatch): [number, number] => uvIn(swatchRect(name), 0.5, 0.5);

// ---------------------------------------------------------------------------------
// Drawing: every shape is drawn on all three canvases at once with one "material":
// colour, roughness, metalness, glow (emissive) and whether it is a reverse lamp. The
// roughness/metalness canvas keeps red (ambient occlusion in three.js, unused here) for
// marking the reverse lamps: red 0 = reverse lamp, lit only while reversing.
type Fill = string | ((g: CanvasRenderingContext2D) => CanvasGradient);
type Mat = { c: Fill; r: number; m: number; e?: string; rev?: boolean };
type Ctxs = { c?: CanvasRenderingContext2D; o?: CanvasRenderingContext2D; e?: CanvasRenderingContext2D }; // the canvases being drawn
const ormStyle = (m: Mat) => `rgb(${m.rev ? 0 : 255},${Math.round(m.r * 255)},${Math.round(m.m * 255)})`;

const paint = (X: Ctxs, path: (g: CanvasRenderingContext2D) => void, m: Mat) => {
    for (const k of ['c', 'o', 'e'] as const) {
        const g = X[k];
        if (!g) continue;
        g.beginPath(); path(g);
        g.fillStyle = k === 'c' ? (typeof m.c === 'function' ? m.c(g) : m.c) : k === 'o' ? ormStyle(m) : (m.e ?? '#000');
        g.fill();
    }
};
const strokeAll = (X: Ctxs, path: (g: CanvasRenderingContext2D) => void, width: number, m: Mat) => {
    for (const k of ['c', 'o', 'e'] as const) {
        const g = X[k];
        if (!g) continue;
        g.beginPath(); path(g);
        g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round';
        g.strokeStyle = k === 'c' ? (typeof m.c === 'function' ? m.c(g) : m.c) : k === 'o' ? ormStyle(m) : (m.e ?? '#000');
        g.stroke();
    }
};
const rect = (x: number, y: number, w: number, h: number) => (g: CanvasRenderingContext2D) => g.rect(x, y, w, h);
const rrect = (x: number, y: number, w: number, h: number, r: number) => (g: CanvasRenderingContext2D) => {
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
};
const circle = (x: number, y: number, r: number) => (g: CanvasRenderingContext2D) => g.arc(x, y, r, 0, Math.PI * 2);
const poly = (pts: number[][]) => (g: CanvasRenderingContext2D) => { pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); };
const linGrad = (x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) => (g: CanvasRenderingContext2D) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([t, c]) => gr.addColorStop(t, c)); return gr;
};
const radGrad = (x: number, y: number, r0: number, r1: number, stops: [number, string][]) => (g: CanvasRenderingContext2D) => {
    const gr = g.createRadialGradient(x, y, r0, x, y, r1); stops.forEach(([t, c]) => gr.addColorStop(t, c)); return gr;
};

// Materials used in the drawings
const GLOSS_BLACK: Mat = { c: '#050607', r: 0.12, m: 0 };
const CHROME = (x0: number, y0: number, x1: number, y1: number): Mat => ({ c: linGrad(x0, y0, x1, y1, [[0, '#f4f6f8'], [0.45, '#b9c0c8'], [0.55, '#8d949c'], [1, '#e6eaee']]), r: 0.1, m: 1 });

function drawRim(X: Ctxs, R: Rect) {
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    paint(X, rect(R.x, R.y, R.w, R.h), { c: '#0a0a0b', r: 0.9, m: 0 });
    // lip, barrel and the dark inside of the wheel
    paint(X, circle(cx, cy, 127), { c: radGrad(cx, cy, 110, 127, [[0, '#9aa1a9'], [0.6, '#eef1f4'], [1, '#aab1b9']]), r: 0.16, m: 1 });
    paint(X, circle(cx, cy, 117), { c: radGrad(cx, cy, 90, 117, [[0, '#30343a'], [1, '#6d747c']]), r: 0.35, m: 1 });
    paint(X, circle(cx, cy, 109), { c: '#101113', r: 0.85, m: 0 });
    // brake disc behind the spokes
    paint(X, circle(cx, cy, 90), { c: radGrad(cx, cy, 40, 90, [[0, '#2a2c2f'], [1, '#55585c']]), r: 0.5, m: 0.8 });
    paint(X, circle(cx, cy, 44), { c: '#141517', r: 0.8, m: 0 });
    // five split spokes
    for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
        for (const side of [-1, 1]) {
            const pts: number[][] = [];
            const half0 = 0.13, half1 = 0.085; // angular half-widths at hub / rim (radians)
            const off0 = side * 0.06, off1 = side * 0.12;
            const r0 = 26, r1 = 112;
            pts.push([cx + Math.cos(a + off0 - half0 * 0.5) * r0, cy + Math.sin(a + off0 - half0 * 0.5) * r0]);
            pts.push([cx + Math.cos(a + off1 - half1 * 0.5) * r1, cy + Math.sin(a + off1 - half1 * 0.5) * r1]);
            pts.push([cx + Math.cos(a + off1 + half1 * 0.5) * r1, cy + Math.sin(a + off1 + half1 * 0.5) * r1]);
            pts.push([cx + Math.cos(a + off0 + half0 * 0.5) * r0, cy + Math.sin(a + off0 + half0 * 0.5) * r0]);
            const ex = Math.cos(a + Math.PI / 2) * 8 * side, ey = Math.sin(a + Math.PI / 2) * 8 * side;
            paint(X, poly(pts), { c: linGrad(cx - ex, cy - ey, cx + ex, cy + ey, [[0, '#f2f4f6'], [1, '#9ea5ad']]), r: 0.22, m: 1 });
        }
    }
    // centre cap, lug nuts
    paint(X, circle(cx, cy, 31), { c: radGrad(cx - 8, cy - 8, 4, 34, [[0, '#f3f5f7'], [1, '#8f969e']]), r: 0.18, m: 1 });
    strokeAll(X, circle(cx, cy, 31), 2.5, { c: '#4a4f55', r: 0.4, m: 1 });
    for (let k = 0; k < 5; k++) {
        const a = ((k + 0.5) / 5) * Math.PI * 2 - Math.PI / 2;
        paint(X, circle(cx + Math.cos(a) * 21, cy + Math.sin(a) * 21, 4.2), { c: '#5d636a', r: 0.3, m: 1 });
    }
    paint(X, circle(cx, cy, 12), { c: '#1c2230', r: 0.3, m: 0.4 });
    strokeAll(X, circle(cx, cy, 12), 2, { c: '#c9ced4', r: 0.15, m: 1 });
}

function drawTyre(X: Ctxs, R: Rect) {
    // canvas y = R.y + (profile position) * h: 0.3-0.6 tread, 0.8-0.97 outer sidewall
    const at = (t: number) => R.y + t * R.h;
    paint(X, rect(R.x, R.y, R.w, R.h), { c: '#141415', r: 0.92, m: 0 });
    paint(X, rect(R.x, at(0.3), R.w, at(0.6) - at(0.3)), { c: '#1c1c1d', r: 0.95, m: 0 });
    paint(X, (g) => { for (const t of [0.37, 0.45, 0.53]) g.rect(R.x, at(t) - 1, R.w, 2); }, { c: '#080808', r: 1, m: 0 });
    paint(X, (g) => { for (let x = R.x; x < R.x + R.w; x += 6) g.rect(x, at(0.3), 1, at(0.37) - at(0.3)); }, { c: '#101011', r: 1, m: 0 });
    paint(X, rect(R.x, at(0.82), R.w, at(0.95) - at(0.82)), { c: '#19191a', r: 0.88, m: 0 });
    paint(X, rect(R.x, at(0.88), R.w, 1.5), { c: '#2a2a2b', r: 0.8, m: 0 });
}

function drawHeadS(X: Ctxs, R: Rect) {
    const { x, y, w, h } = R;
    paint(X, rect(x, y, w, h), GLOSS_BLACK);
    // swept lens: low at the inner end, tall and pulled back at the outer end
    const lens = [[x + 4, y + h - 14], [x + 30, y + 18], [x + w - 4, y + 6], [x + w - 4, y + h - 22], [x + w - 46, y + h - 6], [x + 4, y + h - 4]];
    paint(X, poly(lens), { c: linGrad(x, y, x, y + h, [[0, '#d7dce2'], [0.5, '#8a929b'], [1, '#c3c9d0']]), r: 0.1, m: 1, e: '#3a3f46' });
    // projector lenses
    for (const [px, py, pr] of [[x + 82, y + 44, 17], [x + 136, y + 40, 15]] as number[][]) {
        paint(X, circle(px, py, pr + 4), { c: '#1e2227', r: 0.2, m: 0.6 });
        paint(X, circle(px, py, pr), { c: radGrad(px - 4, py - 4, 2, pr, [[0, '#ffffff'], [0.5, '#cfe0ff'], [1, '#56657a']]), r: 0.04, m: 0.3, e: '#f2f6ff' });
    }
    // LED daytime-running strip along the top edge of the lens
    strokeAll(X, (g) => { g.moveTo(x + 32, y + 20); g.lineTo(x + w - 8, y + 10); }, 5, { c: '#ffffff', r: 0.05, m: 0, e: '#ffffff' });
    // amber indicator at the outer end
    paint(X, poly([[x + w - 36, y + 14], [x + w - 6, y + 9], [x + w - 6, y + 34], [x + w - 36, y + 36]]), { c: '#e3a24a', r: 0.15, m: 0.2, e: '#5a3000' });
}

function drawTailS(X: Ctxs, R: Rect) {
    const { x, y, w, h } = R;
    paint(X, rect(x, y, w, h), { c: '#120607', r: 0.15, m: 0 });
    const lens = [[x + 3, y + 18], [x + w - 3, y + 6], [x + w - 3, y + h - 8], [x + 3, y + h - 14]];
    paint(X, poly(lens), { c: linGrad(x, y, x, y + h, [[0, '#c0161d'], [0.5, '#7d070c'], [1, '#a5121a']]), r: 0.12, m: 0, e: '#8a0508' });
    // LED bars
    for (const dy of [26, 40, 54]) strokeAll(X, (g) => { g.moveTo(x + 70, y + dy - 6 * (dy / 54)); g.lineTo(x + w - 10, y + dy - 10); }, 4, { c: '#ff4a4a', r: 0.1, m: 0, e: '#ff2a2a' });
    // reverse lamp (white) at the inner end, chrome edge
    paint(X, rrect(x + 10, y + 24, 50, 30, 5), { c: linGrad(x, y + 24, x, y + 54, [[0, '#f4f4f4'], [1, '#b8bcc2']]), r: 0.08, m: 0.4, rev: true });
    strokeAll(X, (g) => { g.moveTo(x + 4, y + 17); g.lineTo(x + w - 4, y + 5); }, 2, { c: '#d9dde2', r: 0.1, m: 1 });
}

function hexMesh(X: Ctxs, R: Rect, size: number, cell: Mat, gap: Mat) {
    paint(X, rect(R.x, R.y, R.w, R.h), gap);
    const dx = size * 1.75, dy = size * 1.5;
    paint(X, (g) => {
        for (let row = 0, yy = R.y; yy < R.y + R.h + size; row++, yy += dy) {
            for (let xx = R.x + (row % 2 ? dx / 2 : 0); xx < R.x + R.w + size; xx += dx) {
                for (let k = 0; k < 6; k++) {
                    const a = Math.PI / 6 + k * Math.PI / 3, px = xx + Math.cos(a) * size * 0.78, py = yy + Math.sin(a) * size * 0.78;
                    if (k) g.lineTo(px, py); else g.moveTo(px, py);
                }
                g.closePath();
            }
        }
    }, cell);
}

function drawGrilleS(X: Ctxs, R: Rect) {
    const { x, y, w, h } = R;
    hexMesh(X, R, 8, { c: '#25272a', r: 0.45, m: 0.3 }, { c: '#040404', r: 0.9, m: 0 });
    // chrome top bar and frame
    paint(X, rect(x, y, w, 9), CHROME(x, y, x, y + 9));
    paint(X, rect(x, y + h - 5, w, 5), { c: '#2b2e33', r: 0.3, m: 0.5 });
    // generic badge
    paint(X, (g) => g.ellipse(x + w / 2, y + 46, 30, 19, 0, 0, Math.PI * 2), CHROME(x + w / 2 - 30, y + 27, x + w / 2 + 30, y + 65));
    paint(X, (g) => g.ellipse(x + w / 2, y + 46, 25, 15, 0, 0, Math.PI * 2), { c: '#101a2c', r: 0.15, m: 0.3 });
    paint(X, rect(x + w / 2 - 18, y + 43, 36, 6), CHROME(x, y + 43, x, y + 49));
}

function drawIntakeS(X: Ctxs, R: Rect) {
    const { x, y, w, h } = R;
    hexMesh(X, R, 6, { c: '#1d1f22', r: 0.5, m: 0.2 }, { c: '#030303', r: 0.9, m: 0 });
    // fog lamps in chrome bezels at both ends
    for (const fx of [x + 22, x + w - 22]) {
        paint(X, circle(fx, y + h / 2, 15), CHROME(fx - 15, y, fx + 15, y + h));
        paint(X, circle(fx, y + h / 2, 11), { c: radGrad(fx - 3, y + h / 2 - 3, 1, 11, [[0, '#ffffff'], [1, '#9fb0c4']]), r: 0.05, m: 0.4, e: '#c9d6e8' });
    }
}

function drawGrilleT(X: Ctxs, R: Rect) {
    const { x, y, w, h } = R;
    // chunky chrome surround, dark mesh, three bold bars, big generic badge
    paint(X, rrect(x, y, w, h, 14), CHROME(x, y, x, y + h));
    paint(X, rrect(x + 12, y + 12, w - 24, h - 24, 8), { c: '#050505', r: 0.9, m: 0 });
    paint(X, (g) => { for (let yy = y + 16; yy < y + h - 14; yy += 9) for (let xx = x + 16; xx < x + w - 16; xx += 9) g.rect(xx, yy, 6, 6); },
        { c: '#222427', r: 0.4, m: 0.5 });
    for (const by of [y + 34, y + 60, y + 86]) paint(X, rect(x + 12, by, w - 24, 10), CHROME(x, by, x, by + 10));
    paint(X, rrect(x + w / 2 - 38, y + h / 2 - 17, 76, 34, 10), CHROME(x, y + h / 2 - 17, x, y + h / 2 + 17));
    paint(X, rrect(x + w / 2 - 32, y + h / 2 - 12, 64, 24, 8), { c: '#0d1a33', r: 0.12, m: 0.4 });
    paint(X, rect(x + w / 2 - 22, y + h / 2 - 2, 44, 4), CHROME(x, y, x, y + 4));
}

function drawHeadT(X: Ctxs, R: Rect) {
    const { x, y, w, h } = R;
    paint(X, rect(x, y, w, h), GLOSS_BLACK);
    paint(X, rrect(x + 5, y + 6, w - 10, h - 12, 8), { c: linGrad(x, y, x, y + h, [[0, '#d5dae0'], [0.5, '#7f878f'], [1, '#c0c6cd']]), r: 0.1, m: 1, e: '#3a3f46' });
    for (const [px, py, pr] of [[x + 40, y + 50, 16], [x + 82, y + 50, 16]] as number[][]) {
        paint(X, circle(px, py, pr + 3), { c: '#1c2025', r: 0.2, m: 0.6 });
        paint(X, circle(px, py, pr), { c: radGrad(px - 4, py - 4, 2, pr, [[0, '#ffffff'], [0.5, '#d2e2ff'], [1, '#56657a']]), r: 0.04, m: 0.3, e: '#f2f6ff' });
    }
    // C-shaped LED signature around the outer end
    strokeAll(X, (g) => { g.moveTo(x + 14, y + 14); g.lineTo(x + w - 14, y + 14); g.lineTo(x + w - 14, y + h - 14); g.lineTo(x + 60, y + h - 14); }, 5, { c: '#ffffff', r: 0.05, m: 0, e: '#ffffff' });
}

function drawTailT(X: Ctxs, R: Rect) {
    const { x, y, w, h } = R;
    paint(X, rect(x, y, w, h), { c: '#120607', r: 0.15, m: 0 });
    paint(X, rrect(x + 4, y + 4, w - 8, h - 8, 6), { c: linGrad(x, y, x + w, y, [[0, '#7a070c'], [0.5, '#c2161e'], [1, '#86080d']]), r: 0.12, m: 0, e: '#8a0508' });
    paint(X, rrect(x + 10, y + 56, w - 20, 22, 4), { c: linGrad(x, y + 56, x, y + 78, [[0, '#f4f4f4'], [1, '#b8bcc2']]), r: 0.08, m: 0.4, rev: true });
    for (const yy of [y + 18, y + 34, y + 94, y + 110]) strokeAll(X, (g) => { g.moveTo(x + 12, yy); g.lineTo(x + w - 12, yy); }, 4, { c: '#ff4a4a', r: 0.1, m: 0, e: '#ff2a2a' });
}

function drawPlate(X: Ctxs, R: Rect) {
    const { x, y, w, h } = R;
    paint(X, rect(x, y, w, h), { c: '#111', r: 0.5, m: 0.3 });
    paint(X, rrect(x + 3, y + 3, w - 6, h - 6, 5), { c: linGrad(x, y, x, y + h, [[0, '#ffffff'], [1, '#dfe3e6']]), r: 0.35, m: 0.1 });
    if (X.c) {
        const g = X.c;
        g.fillStyle = '#b3161d'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('DEALER', x + w / 2, y + 12);
        g.fillStyle = '#16264d'; g.font = 'bold 30px sans-serif';
        g.fillText('CDS 247', x + w / 2, y + 37);
        g.fillStyle = '#3a4a6a'; g.font = '8px sans-serif';
        g.fillText('USED  CARS', x + w / 2, y + 56);
    }
}

function drawBed(X: Ctxs, R: Rect) {
    paint(X, rect(R.x, R.y, R.w, R.h), { c: '#1b1c1d', r: 0.95, m: 0 });
    paint(X, (g) => { for (let xx = R.x + 4; xx < R.x + R.w; xx += 12) g.rect(xx, R.y, 5, R.h); }, { c: '#2c2d2f', r: 0.9, m: 0 });
    paint(X, (g) => { for (let xx = R.x + 9; xx < R.x + R.w; xx += 12) g.rect(xx, R.y, 1.5, R.h); }, { c: '#0c0c0d', r: 1, m: 0 });
}

function drawRimBlur(X: Ctxs, R: Rect) {
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2, k = R.w / 256; // same radii as the sharp rim, scaled
    paint(X, rect(R.x, R.y, R.w, R.h), { c: '#0a0a0b', r: 0.9, m: 0 });
    paint(X, circle(cx, cy, 127 * k), { c: radGrad(cx, cy, 110 * k, 127 * k, [[0, '#9aa1a9'], [0.6, '#eef1f4'], [1, '#aab1b9']]), r: 0.16, m: 1 });
    paint(X, circle(cx, cy, 117 * k), { c: radGrad(cx, cy, 90 * k, 117 * k, [[0, '#30343a'], [1, '#6d747c']]), r: 0.35, m: 1 });
    // spokes smeared into a soft disc with faint rings
    paint(X, circle(cx, cy, 112 * k), { c: radGrad(cx, cy, 20 * k, 112 * k, [[0, '#a7adb4'], [0.35, '#7d838a'], [0.55, '#8d939a'], [0.8, '#6a7077'], [1, '#3a3e43']]), r: 0.3, m: 1 });
    strokeAll(X, circle(cx, cy, 70 * k), 3 * k, { c: 'rgba(40,44,48,0.5)', r: 0.4, m: 1 });
    paint(X, circle(cx, cy, 31 * k), { c: radGrad(cx - 8 * k, cy - 8 * k, 4 * k, 34 * k, [[0, '#f3f5f7'], [1, '#8f969e']]), r: 0.18, m: 1 });
    paint(X, circle(cx, cy, 12 * k), { c: '#1c2230', r: 0.3, m: 0.4 });
}

function drawHeadSp(X: Ctxs, R: Rect) {
    const { x, y, w, h } = R;
    paint(X, rect(x, y, w, h), GLOSS_BLACK);
    // slim, sharply swept lens; LED "eyebrow" along the top, one projector
    const lens = [[x + 4, y + h - 10], [x + 60, y + 14], [x + w - 6, y + 6], [x + w - 6, y + 34], [x + w - 70, y + h - 8], [x + 4, y + h - 4]];
    paint(X, poly(lens), { c: linGrad(x, y, x, y + h, [[0, '#d9dee4'], [0.55, '#7c848d'], [1, '#bfc5cc']]), r: 0.1, m: 1, e: '#30353b' });
    strokeAll(X, (g) => { g.moveTo(x + 62, y + 16); g.lineTo(x + w - 8, y + 9); g.lineTo(x + w - 8, y + 30); }, 4, { c: '#ffffff', r: 0.05, m: 0, e: '#ffffff' });
    const px = x + 150, py = y + 34, pr = 13;
    paint(X, circle(px, py, pr + 3), { c: '#1e2227', r: 0.2, m: 0.6 });
    paint(X, circle(px, py, pr), { c: radGrad(px - 3, py - 3, 2, pr, [[0, '#ffffff'], [0.5, '#cfe0ff'], [1, '#56657a']]), r: 0.04, m: 0.3, e: '#f2f6ff' });
    paint(X, poly([[x + w - 34, y + 36], [x + w - 8, y + 33], [x + w - 8, y + 46], [x + w - 34, y + 50]]), { c: '#e3a24a', r: 0.15, m: 0.2, e: '#5a3000' });
}

function drawTailSp(X: Ctxs, R: Rect) {
    const { x, y, w, h } = R;
    paint(X, rect(x, y, w, h), { c: '#0e0607', r: 0.15, m: 0 });
    // two round lamps per side with bright LED rings, small reverse lamp between them
    for (const cx of [x + 70, x + 180]) {
        const cy = y + h / 2;
        paint(X, circle(cx, cy, 27), CHROME(cx - 27, cy - 27, cx + 27, cy + 27));
        paint(X, circle(cx, cy, 24), { c: radGrad(cx, cy, 4, 24, [[0, '#5a0408'], [0.7, '#9a0a10'], [1, '#c3141b']]), r: 0.12, m: 0, e: '#6a0306' });
        strokeAll(X, circle(cx, cy, 16), 4, { c: '#ff4a4a', r: 0.1, m: 0, e: '#ff2a2a' });
    }
    paint(X, rrect(x + 112, y + h / 2 - 9, 30, 18, 4), { c: '#e8e8e8', r: 0.08, m: 0.4, rev: true });
}

function drawGrilleC(X: Ctxs, R: Rect) {
    const { x, y, w, h } = R;
    paint(X, rrect(x, y, w, h, 18), CHROME(x, y, x, y + h));
    paint(X, rrect(x + 7, y + 7, w - 14, h - 14, 13), { c: '#040404', r: 0.9, m: 0 });
    paint(X, (g) => { for (let xx = x + 16; xx < x + w - 12; xx += 11) g.rect(xx, y + 9, 4, h - 18); }, { c: '#2b2e33', r: 0.3, m: 0.7 });
    paint(X, rect(x + w / 2 - 3, y + 6, 6, h - 12), { c: '#0a0a0a', r: 0.6, m: 0 });
}

function drawGrilleM(X: Ctxs, R: Rect) {
    const { x, y, w, h } = R;
    // wide trapezoid opening (narrower at the top), black hex mesh, thin gloss surround, small badge
    hexMesh(X, R, 7, { c: '#202225', r: 0.45, m: 0.3 }, { c: '#030303', r: 0.9, m: 0 });
    strokeAll(X, poly([[x + 14, y + 3], [x + w - 14, y + 3], [x + w - 2, y + h - 3], [x + 2, y + h - 3]]), 5, GLOSS_BLACK);
    paint(X, rrect(x + w / 2 - 22, y + h / 2 - 9, 44, 18, 5), CHROME(x, y + h / 2 - 9, x, y + h / 2 + 9));
    paint(X, rrect(x + w / 2 - 18, y + h / 2 - 6, 36, 12, 4), { c: '#5b0c10', r: 0.2, m: 0.3 });
}

function drawTailBar(X: Ctxs, R: Rect) {
    const { x, y, w, h } = R;
    paint(X, rect(x, y, w, h), { c: '#120607', r: 0.15, m: 0 });
    paint(X, rrect(x + 2, y + 5, w - 4, h - 10, 6), { c: linGrad(x, y, x, y + h, [[0, '#b0141a'], [0.5, '#6d060b'], [1, '#9a1016']]), r: 0.12, m: 0, e: '#7a0407' });
    strokeAll(X, (g) => { g.moveTo(x + 8, y + h / 2); g.lineTo(x + w - 8, y + h / 2); }, 3, { c: '#ff5050', r: 0.1, m: 0, e: '#ff2a2a' });
}

function drawVent(X: Ctxs, R: Rect) {
    const { x, y, w, h } = R;
    paint(X, rrect(x, y, w, h, 10), { c: '#101112', r: 0.5, m: 0.2 });
    paint(X, (g) => { for (let yy = y + 10; yy < y + h - 6; yy += 10) g.rect(x + 8, yy, w - 16, 4); }, { c: '#2a2c2f', r: 0.35, m: 0.5 });
}

function drawSwatches(X: Ctxs) {
    const S: Record<Swatch, Mat> = {
        blackMatte: { c: '#141516', r: 0.7, m: 0 },
        blackGloss: { c: '#060708', r: 0.18, m: 0 },
        chrome: { c: '#eef1f4', r: 0.08, m: 1 },
        interior: { c: '#17181a', r: 0.9, m: 0 },
        interiorLt: { c: '#2c2d31', r: 0.85, m: 0 },
        under: { c: '#0b0b0c', r: 0.95, m: 0 },
        mirror: { c: '#aab3bd', r: 0.03, m: 1 },
        redRefl: { c: '#8a0a0e', r: 0.2, m: 0, e: '#5a0004' },
        amber: { c: '#d68a1e', r: 0.2, m: 0, e: '#ff8a10' },
        darkMetal: { c: '#3a3d41', r: 0.4, m: 1 },
        white: { c: '#efefef', r: 0.5, m: 0 },
        rubber: { c: '#151515', r: 0.95, m: 0 },
        sideAmber: { c: '#c87e1a', r: 0.2, m: 0, e: '#a85400' },
        bodyGap: { c: '#1d1f22', r: 0.7, m: 0 },
        satin: { c: '#c3cbd4', r: 0.24, m: 1 },
        seat: { c: '#232427', r: 0.85, m: 0 },
        glassFar: { c: '#1a232c', r: 0.08, m: 0.3 },
        lampHead: { c: '#e6ebf2', r: 0.1, m: 0.3, e: '#ffffff' },
        lampTail: { c: '#8e0b10', r: 0.15, m: 0, e: '#ff2020' },
        roofRail: { c: '#2b2e33', r: 0.35, m: 0.6 },
        rimFar: { c: '#8c939b', r: 0.3, m: 1 },
        carbon: { c: '#16181b', r: 0.3, m: 0.3 },
        lampRev: { c: '#e8e8e8', r: 0.08, m: 0.4, rev: true },
        exhaustIn: { c: '#050505', r: 0.9, m: 0 },
    };
    for (const name of SWATCH_NAMES) { const r = swatchRect(name); paint(X, rect(r.x, r.y, r.w, r.h), S[name]); }
}

export type CarAtlas = { map: THREE.CanvasTexture; orm: THREE.CanvasTexture; emissive: THREE.CanvasTexture };
let atlas: CarAtlas | null = null;
let drawn: HTMLCanvasElement[] = [];

/** Draw the whole atlas on one of its canvases (colour, roughness/metalness, glow). */
function drawAtlasCanvas(k: 'c' | 'o' | 'e') {
    const cv = document.createElement('canvas'); cv.width = ATLAS_W; cv.height = ATLAS_H;
    const X: Ctxs = { [k]: cv.getContext('2d')! };
    paint(X, rect(0, 0, ATLAS_W, ATLAS_H), { c: '#101010', r: 0.8, m: 0 });
    drawRim(X, CELL.rim); drawTyre(X, CELL.tyre); drawRimBlur(X, CELL.rimBlur);
    drawHeadS(X, CELL.headS); drawTailS(X, CELL.tailS); drawGrilleS(X, CELL.grilleS); drawIntakeS(X, CELL.intakeS);
    drawGrilleT(X, CELL.grilleT); drawHeadT(X, CELL.headT); drawTailT(X, CELL.tailT);
    drawHeadSp(X, CELL.headSp); drawTailSp(X, CELL.tailSp); drawGrilleC(X, CELL.grilleC); drawTailBar(X, CELL.tailBar); drawVent(X, CELL.vent); drawGrilleM(X, CELL.grilleM);
    drawPlate(X, CELL.plate); drawBed(X, CELL.bed); drawSwatches(X);
    return cv;
}

/** Do the next step of drawing the atlas (one canvas per step); true once it is ready. */
export function stepCarAtlas(): boolean {
    if (atlas) return true;
    drawn.push(drawAtlasCanvas((['c', 'o', 'e'] as const)[drawn.length]));
    if (drawn.length < 3) return false;
    const tex = (c: HTMLCanvasElement, srgb: boolean) => {
        const t = new THREE.CanvasTexture(c);
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
    };
    atlas = { map: tex(drawn[0], true), orm: tex(drawn[1], false), emissive: tex(drawn[2], true) };
    drawn = [];
    return true;
}

/** The shared atlas textures (drawn now if they aren't yet). */
export function getCarAtlas(): CarAtlas {
    while (!stepCarAtlas()) { /* draw the remaining canvases */ }
    return atlas!;
}

export function disposeCarAtlas() {
    drawn = [];
    if (!atlas) return;
    atlas.map.dispose(); atlas.orm.dispose(); atlas.emissive.dispose();
    atlas = null;
}
