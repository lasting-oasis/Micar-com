import * as THREE from 'three';

// Procedural canvas textures and sprite signs used by the 3D world.

// (The sky light and reflections now come from the live sky: see atmosphere.ts.)

export const createBuildingSign = (text: string, bgColor: string, txtColor: string) => {
     const canvas = document.createElement('canvas');
     canvas.width = 512; canvas.height = 128;
     const ctx = canvas.getContext('2d');
     if (!ctx) return new THREE.Sprite();
     ctx.fillStyle = bgColor;
     if (ctx.roundRect) ctx.roundRect(0, 0, 512, 128, 20); else ctx.rect(0, 0, 512, 128);
     ctx.fill();
     ctx.fillStyle = txtColor; ctx.font = 'bold 56px sans-serif'; ctx.textAlign = 'center'; 
     ctx.fillText(text, 256, 85);
     const tex = new THREE.CanvasTexture(canvas);
     const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
     const sprite = new THREE.Sprite(mat);
     sprite.scale.set(12, 3, 1);
     return sprite;
};

export const generateConcreteTexture = () => {
     const size = 512;
     const canvas = document.createElement('canvas');
     canvas.width = size; canvas.height = size;
     const context = canvas.getContext('2d');
     if (!context) return new THREE.Texture();
     const imgData = context.createImageData(size, size);
     for (let i = 0; i < imgData.data.length; i += 4) {
         const v = 80 + Math.random() * 60; 
         imgData.data[i] = v; imgData.data[i+1] = v; imgData.data[i+2] = v; imgData.data[i+3] = 255;
     }
     context.putImageData(imgData, 0, 0);
     const tex = new THREE.CanvasTexture(canvas);
     tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
     tex.repeat.set(4, 4);
     return tex;
};

// ---- Ground, paint, vegetation and light textures --------------------------------------
// Generated once at start-up from seeded noise (same for every player), at most 512 px,
// tileable, with mipmaps. The ground textures are sampled in world space by the ground
// shader (see world/groundShader.ts), so their size on the ground is set there.

/** Seeded random numbers in [0, 1) (mulberry32). */
export const seededRandom = (seed: number) => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Tileable value noise in [0, 1]: size x size pixels over `cells` x `cells` lattice cells. */
const tileNoise = (size: number, cells: number, rand: () => number) => {
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
    const out = new Float32Array(size * size);
    const k = cells / size;
    for (let y = 0; y < size; y++) {
        const gy = y * k, iy = Math.floor(gy), fy = gy - iy, ty = fy * fy * (3 - 2 * fy);
        const r0 = (iy % cells) * cells, r1 = ((iy + 1) % cells) * cells;
        for (let x = 0; x < size; x++) {
            const gx = x * k, ix = Math.floor(gx), fx = gx - ix, tx = fx * fx * (3 - 2 * fx);
            const c0 = ix % cells, c1 = (ix + 1) % cells;
            const a = lattice[r0 + c0], b = lattice[r0 + c1], c = lattice[r1 + c0], d = lattice[r1 + c1];
            out[y * size + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
        }
    }
    return out;
};

/** Tileable fractal noise stretched to [0, 1]. */
const fbm = (size: number, cells: number, octaves: number, rand: () => number, gain = 0.5) => {
    const out = new Float32Array(size * size);
    let amp = 1;
    for (let o = 0; o < octaves; o++, amp *= gain) {
        const n = tileNoise(size, cells << o, rand);
        for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    }
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < out.length; i++) { lo = Math.min(lo, out[i]); hi = Math.max(hi, out[i]); }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo || 1);
    return out;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const linearToSrgb8 = (v: number) => {
    v = clamp01(v);
    return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
};
const srgbToLinear = (c8: number) => { const c = c8 / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

const dataTexture = (data: Uint8Array<ArrayBuffer>, w: number, h: number, srgb: boolean) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
};

/**
 * Fine asphalt aggregate (grey, linear, centred on 0.5): small light and dark stones in a
 * blotchy binder. Used as a world-space detail multiplier on the paving, curbs and paint.
 */
export const generateAggregateTexture = () => {
    const N = 512, rand = seededRandom(1103);
    const v = new Float32Array(N * N);
    const blot = fbm(N, 8, 3, rand), fine = tileNoise(N, 128, rand);
    for (let i = 0; i < v.length; i++) v[i] = 0.5 + (blot[i] - 0.5) * 0.2 + (fine[i] - 0.5) * 0.1 + (rand() - 0.5) * 0.12;
    for (let k = 0; k < 12000; k++) {
        const cx = rand() * N, cy = rand() * N, r = 0.55 + rand() * rand() * 2.3;
        const dv = rand() < 0.25 ? -(0.08 + rand() * 0.14) : 0.05 + rand() * 0.28;
        const R = Math.ceil(r + 1);
        for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
            const px = Math.floor(cx) + ox, py = Math.floor(cy) + oy;
            const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
            const w = clamp01(r + 0.5 - d);
            if (w > 0) v[((py + N) % N) * N + ((px + N) % N)] += dv * w * (0.7 + 0.3 * (1 - d / r));
        }
    }
    let mean = 0;
    for (let i = 0; i < v.length; i++) mean += v[i];
    mean /= v.length;
    const data = new Uint8Array(N * N * 4);
    for (let i = 0; i < v.length; i++) {
        const c = Math.round(255 * clamp01(v[i] - mean + 0.5));
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = c; data[i * 4 + 3] = 255;
    }
    return dataTexture(data, N, N, false);
};

/** Large-scale variation (linear): three independent soft noises in R, G and B. */
export const generateMacroTexture = () => {
    const N = 256, rand = seededRandom(3301);
    const r = fbm(N, 4, 4, rand), g = fbm(N, 6, 3, rand), b = fbm(N, 3, 4, rand, 0.55);
    const data = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {
        data[i * 4] = Math.round(255 * r[i]); data[i * 4 + 1] = Math.round(255 * g[i]); data[i * 4 + 2] = Math.round(255 * b[i]); data[i * 4 + 3] = 255;
    }
    const t = dataTexture(data, N, N, false);
    t.anisotropy = 1;
    return t;
};

/** Draws `fn` at (x, y) and at its wrapped copies near the edges, so strokes tile. */
const wrapDraw = (size: number, x: number, y: number, margin: number, fn: (x: number, y: number) => void) => {
    for (const ox of [0, -size, size]) for (const oy of [0, -size, size]) {
        const px = x + ox, py = y + oy;
        if (px > -margin && px < size + margin && py > -margin && py < size + margin) fn(px, py);
    }
};

/** Lawn seen from above (sRGB): clumps, blades in several greens, a little straw and soil. */
export const generateGrassTexture = () => {
    const N = 512, rand = seededRandom(2207);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = N;
    const g = canvas.getContext('2d');
    if (!g) return new THREE.Texture();
    const img = g.createImageData(N, N);
    const clump = fbm(N, 16, 3, rand), fine = tileNoise(N, 96, rand);
    const dark = [52, 76, 30], light = [92, 118, 50];
    for (let i = 0; i < N * N; i++) {
        const t = clamp01(clump[i] * 0.75 + fine[i] * 0.35 - 0.05), n = (rand() - 0.5) * 14;
        for (let c = 0; c < 3; c++) img.data[i * 4 + c] = dark[c] + (light[c] - dark[c]) * t + n;
        img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const blades = ['#5b7b31', '#4b6a29', '#68873a', '#3f5d23', '#789341', '#56732d', '#82904a', '#8f8a50', '#45652a'];
    const weights = [14, 14, 10, 10, 6, 12, 3, 1.5, 10];
    const total = weights.reduce((a, b) => a + b, 0);
    const pick = () => { let r = rand() * total; for (let i = 0; i < blades.length; i++) { r -= weights[i]; if (r <= 0) return blades[i]; } return blades[0]; };
    g.lineCap = 'round';
    for (let k = 0; k < 17000; k++) {
        const x = rand() * N, y = rand() * N, len = 2.5 + rand() * 7, a = rand() * Math.PI * 2;
        const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
        g.strokeStyle = pick(); g.globalAlpha = 0.32 + rand() * 0.4; g.lineWidth = 0.8 + rand() * 0.9;
        wrapDraw(N, x, y, 12, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + dx, py + dy); g.stroke(); });
    }
    for (let k = 0; k < 1500; k++) {
        const x = rand() * N, y = rand() * N, r = 0.6 + rand() * 1.1;
        g.fillStyle = rand() < 0.6 ? '#4a3d28' : '#6d6038'; g.globalAlpha = 0.35 + rand() * 0.35;
        wrapDraw(N, x, y, 3, (px, py) => { g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill(); });
    }
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
};

/**
 * Sidewalk concrete (sRGB): one repeat = 4 x 4 slabs with tooled joints, a slightly
 * different tone per slab, a broom finish, grime along the joints and a few stains.
 * Sampled at 6 m per repeat, i.e. 1.5 m slabs.
 */
export const generateSlabTexture = () => {
    const N = 512, S = 128, rand = seededRandom(4409);
    const blot = fbm(N, 8, 3, rand), broom = tileNoise(N, 256, rand);
    const slabTone = Array.from({ length: 16 }, () => 1 + (rand() - 0.5) * 0.09);
    const slabWarm = Array.from({ length: 16 }, () => (rand() - 0.5) * 0.025);
    const v = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const sx = x % S, sy = y % S, slab = Math.floor(y / S) * 4 + Math.floor(x / S);
        const e = Math.min(sx, S - 1 - sx, sy, S - 1 - sy);
        let k = slabTone[slab] * (1 + (blot[y * N + x] - 0.5) * 0.1 + (rand() - 0.5) * 0.08 + (broom[y * N + (x >> 4)] - 0.5) * 0.035);
        if (e < 6) k *= 0.955 + 0.0075 * e;
        if (e === 0) k *= 0.62;
        v[y * N + x] = k;
    }
    const spot = (cx: number, cy: number, r: number, f: number) => {
        const R = Math.ceil(r + 1);
        for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
            const d = Math.hypot(ox, oy), w = clamp01(r + 0.5 - d);
            if (w > 0) { const i = ((Math.floor(cy) + oy + N) % N) * N + ((Math.floor(cx) + ox + N) % N); v[i] *= 1 - (1 - f) * w; }
        }
    };
    for (let k = 0; k < 45; k++) spot(rand() * N, rand() * N, 0.8 + rand() * 1.6, 0.7);
    for (let k = 0; k < 7; k++) spot(rand() * N, rand() * N, 8 + rand() * 18, 0.95);
    const base = [156, 154, 148].map(srgbToLinear);
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const i = y * N + x, slab = Math.floor(y / S) * 4 + Math.floor(x / S), w = slabWarm[slab];
        data[i * 4] = linearToSrgb8(base[0] * v[i] * (1 + w));
        data[i * 4 + 1] = linearToSrgb8(base[1] * v[i]);
        data[i * 4 + 2] = linearToSrgb8(base[2] * v[i] * (1 - w));
        data[i * 4 + 3] = 255;
    }
    return dataTexture(data, N, N, true);
};

/** Road atlas layout: u in [0, ROAD_ATLAS_ROAD_U) is a 25 m road cross-section, the rest is the sealed lot paving. */
export const ROAD_ATLAS_ROAD_U = 0.625;
/** u of the sealed-lot column (a texel centre well inside its region, so mipmaps don't bleed). */
export const ROAD_ATLAS_LOT_U = 0.8125;
/** Road metres per repeat along the road (v). */
export const ROAD_ATLAS_LENGTH = 40;
/** Linear albedo multiplier stored for unworn road; the paving material colour divides it back out. */
export const ROAD_ATLAS_BASE = 0.9;

/**
 * Asphalt wear atlas (sRGB multiplier on the asphalt colour; alpha = how much aggregate
 * detail shows). The road part is a 25 m cross-section: darker, slightly polished wheel
 * paths and an oil streak in every lane, dusty gutters, sealed cracks and patches.
 * The lot part is an even, freshly sealed surface.
 */
export const generateRoadAtlasTexture = () => {
    const N = 512, RW = Math.round(N * ROAD_ATLAS_ROAD_U), rand = seededRandom(5501);
    const m = new Float32Array(N * N).fill(1);
    const wearN = fbm(N, 6, 3, rand), oilN = fbm(N, 24, 3, rand), toneN = fbm(N, 10, 3, rand), lotN = fbm(N, 4, 3, rand);
    const laneCentres = [-5.68, -1.99, 1.99, 5.68]; // same lanes as the paint in world/roads.ts
    for (let y = 0; y < N; y++) for (let x = 0; x < RW; x++) {
        const i = y * N + x, d = ((x + 0.5) / RW) * 25 - 12.5, ad = Math.abs(d);
        let k = 1 + (toneN[i] - 0.5) * 0.07;
        for (const lc of laneCentres) {
            for (const wp of [lc - 0.92, lc + 0.92]) k *= 1 - 0.12 * Math.exp(-(((d - wp) / 0.34) ** 2)) * (0.7 + 0.6 * wearN[i]);
            k *= 1 - 0.16 * Math.exp(-(((d - lc) / 0.26) ** 2)) * clamp01((oilN[i] - 0.42) * 3);
        }
        if (ad > 7.7 && ad < 11.8) k *= 1 - 0.1 * clamp01((oilN[i] - 0.62) * 4); // parked-car drips
        if (ad > 11.2) k *= 1 + 0.07 * clamp01((ad - 11.2) / 1.1);                // dusty gutter
        m[i] = k;
    }
    // Sealed cracks: wandering lines along the lane joints and across the road, and two patches
    const crack = (x0: number, y0: number, dx: number, dy: number, steps: number) => {
        let x = x0, y = y0;
        for (let s = 0; s < steps; s++) {
            x += dx + (rand() - 0.5) * 0.9; y += dy + (rand() - 0.5) * 0.9;
            const px = Math.floor(x), py = ((Math.floor(y) % N) + N) % N;
            if (px < 0 || px >= RW) break;
            m[py * N + px] *= 0.58;
            if (rand() < 0.35 && px + 1 < RW) m[py * N + px + 1] *= 0.8;
        }
    };
    for (const d of [-3.85, 3.85, -0.6]) {
        const px = ((d + 12.5) / 25) * RW;
        for (let k = 0; k < 3; k++) crack(px + (rand() - 0.5) * 4, rand() * N, (rand() - 0.5) * 0.25, 1, 30 + rand() * 90);
    }
    for (let k = 0; k < 4; k++) crack(rand() * 20, rand() * N, 1, (rand() - 0.5) * 0.3, 80 + rand() * 240);
    for (let k = 0; k < 2; k++) {
        const pw = 30 + rand() * 25, ph = 35 + rand() * 50, px0 = 40 + rand() * (RW - 120), py0 = rand() * N;
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
            const i = (((Math.floor(py0 + y)) % N) * N) + Math.floor(px0 + x);
            m[i] *= (x < 1 || x >= pw - 1 || y < 1 || y >= ph - 1) ? 0.8 : 0.95 + (toneN[i] - 0.5) * 0.04;
        }
    }
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const lot = x >= RW;
        const k = lot ? 0.79 * (1 + (lotN[i] - 0.5) * 0.05) : m[i];
        const g8 = linearToSrgb8(k * ROAD_ATLAS_BASE);
        const warm = !lot && Math.abs(((x + 0.5) / RW) * 25 - 12.5) > 11.2 ? 1.025 : 1;
        data[i * 4] = Math.min(255, Math.round(g8 * warm)); data[i * 4 + 1] = g8; data[i * 4 + 2] = Math.round(g8 / warm);
        data[i * 4 + 3] = lot ? 185 : 255;
    }
    const t = dataTexture(data, N, N, true);
    t.wrapS = THREE.ClampToEdgeWrapping;
    return t;
};

/** Paint colours, picked by u: PAINT_U.white / yellow / dark (cast iron) / blue. */
export const PAINT_U = { white: 0.125, yellow: 0.375, dark: 0.625, blue: 0.875 } as const;
export const generatePaintPaletteTexture = () => {
    const cols = [[217, 215, 207], [221, 171, 52], [60, 59, 57], [47, 95, 168]];
    const data = new Uint8Array(8 * 4);
    cols.forEach((c, i) => { for (const j of [0, 1]) { const o = (i * 2 + j) * 4; data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255; } });
    const t = new THREE.DataTexture(data, 8, 1, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
};

/**
 * Vegetation atlas (sRGB). v in [0.5, 1]: broad-leaf foliage; [0.25, 0.5]: conifer needles;
 * [0, 0.25]: bark. Each band tiles horizontally.
 */
export const VEG_V = { leaf: [0.52, 0.98], needle: [0.27, 0.48], bark: [0.02, 0.23] } as const;
export const generateVegetationTexture = () => {
    const N = 512, rand = seededRandom(6607);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = N;
    const g = canvas.getContext('2d');
    if (!g) return new THREE.Texture();
    // canvas row 0 is v = 1: leaves on rows 0-255, needles 256-383, bark 384-511
    const band = (y0: number, h: number, base: string, draw: () => void) => {
        g.save(); g.beginPath(); g.rect(0, y0, N, h); g.clip();
        g.fillStyle = base; g.fillRect(0, y0, N, h);
        draw(); g.restore();
    };
    band(0, 256, '#2c4219', () => {
        const cols = ['#3d5f22', '#4a7128', '#557d2e', '#33521d', '#648a37', '#2b461a', '#6f9440'];
        for (let k = 0; k < 5200; k++) {
            const x = rand() * N, y = rand() * 256, rx = 2 + rand() * 4.5, ry = rx * (0.45 + rand() * 0.3), a = rand() * Math.PI;
            g.fillStyle = cols[Math.floor(rand() * cols.length)]; g.globalAlpha = 0.65 + rand() * 0.35;
            wrapDraw(N, x, y, 8, (px) => { g.beginPath(); g.ellipse(px, y, rx, ry, a, 0, Math.PI * 2); g.fill(); });
        }
        for (let k = 0; k < 600; k++) { // dark gaps between leaf clusters
            const x = rand() * N, y = rand() * 256, r = 1 + rand() * 2.5;
            g.fillStyle = '#18270e'; g.globalAlpha = 0.6;
            wrapDraw(N, x, y, 4, (px) => { g.beginPath(); g.arc(px, y, r, 0, Math.PI * 2); g.fill(); });
        }
    });
    band(256, 128, '#1f3319', () => {
        const cols = ['#2d4a26', '#38592e', '#24401f', '#42653a', '#2f5030'];
        g.lineCap = 'round';
        for (let k = 0; k < 4200; k++) {
            const x = rand() * N, y = 256 + rand() * 128, len = 3 + rand() * 6, a = Math.PI / 2 + (rand() - 0.5) * 1.6;
            g.strokeStyle = cols[Math.floor(rand() * cols.length)]; g.globalAlpha = 0.7; g.lineWidth = 1 + rand();
            wrapDraw(N, x, y, 8, (px) => { g.beginPath(); g.moveTo(px, y); g.lineTo(px + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke(); });
        }
    });
    band(384, 128, '#5d5045', () => {
        for (let k = 0; k < 900; k++) {
            const x = rand() * N, y = 384 + rand() * 128, len = 6 + rand() * 30;
            g.strokeStyle = rand() < 0.6 ? '#3b322a' : '#7b6c5d'; g.globalAlpha = 0.55; g.lineWidth = 1 + rand() * 1.5;
            wrapDraw(N, x, y, 4, (px) => { g.beginPath(); g.moveTo(px, y); g.lineTo(px + (rand() - 0.5) * 3, y + len); g.stroke(); });
        }
    });
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 2;
    return t;
};

/** Soft round glow (white, falloff in alpha) for the light pools and lamp halos. */
export const generateGlowTexture = (hardness = 1) => {
    const N = 64, rand = seededRandom(7703);
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const dx = (x + 0.5) / N * 2 - 1, dy = (y + 0.5) / N * 2 - 1, r2 = dx * dx + dy * dy;
        const r = Math.sqrt(r2), t = clamp01((r - 0.18) / 0.82), plateau = 1 - t * t * (3 - 2 * t); // broad, even centre
        const f = r2 >= 1 ? 0 : hardness > 1 ? Math.pow(1 - r2, 3.2) * (0.55 + 0.45 * Math.exp(-r2 * 12)) : plateau;
        const i = (y * N + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 255;
        data[i + 3] = Math.max(0, Math.min(255, Math.round(f * 255 + (rand() - 0.5) * 1.5))); // dithered: no banding at night
    }
    const t = dataTexture(data, N, N, false);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    // No mipmaps: seen at a low angle they would average the pool into a faint smear
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.anisotropy = 1;
    return t;
};

// --- Realistic galvanized chain-link fencing ---------------------------
// Transparent diamond-wire texture used as both color + alpha map so the
// fence reads as real woven steel rather than a flat wireframe plane.
export const generateChainLinkTexture = () => {
     const size = 128;
     const canvas = document.createElement('canvas');
     canvas.width = size; canvas.height = size;
     const ctx = canvas.getContext('2d');
     if (!ctx) return new THREE.Texture();
     ctx.clearRect(0, 0, size, size);
     ctx.strokeStyle = 'rgba(214, 219, 224, 1)';
     ctx.lineWidth = 2.5;
     ctx.lineCap = 'round';
     const step = 16;
     for (let i = -size; i <= size; i += step) {
         ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke();
         ctx.beginPath(); ctx.moveTo(i + size, 0); ctx.lineTo(i, size); ctx.stroke();
     }
     const tex = new THREE.CanvasTexture(canvas);
     tex.wrapS = THREE.RepeatWrapping;
     tex.wrapT = THREE.RepeatWrapping;
     return tex;
};
