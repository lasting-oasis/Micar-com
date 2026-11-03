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
// Generated once at start-up from seeded noise (the same for every player), 256 px or
// less, tileable, with mipmaps. Built to be cheap on a phone: smooth noise is made by
// letting the canvas scale up a small random grid (native, smoothed), not by per-pixel
// noise in JavaScript, and every texture needs only one or two passes over its pixels.
// The ground textures are sampled in world space (see world/groundShader.ts), which sets
// their size on the ground. World units are half-metres.

/** Seeded random numbers in [0, 1) (mulberry32). */
export const seededRandom = (seed: number) => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(clamp01(v), 1 / 2.4) - 0.055);
// sRGB byte -> linear, as a table (used per pixel)
const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
// linear [0,1] in 1/1024 steps -> sRGB byte, as a table
const LINEAR_TO_SRGB8 = Uint8Array.from({ length: 1025 }, (_, i) => Math.round(255 * toSrgb(i / 1024)));
const lin2s = (v: number) => LINEAR_TO_SRGB8[(clamp01(v) * 1024) | 0];

const canvas2d = (w: number, h = w) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return { c, g: c.getContext('2d', { willReadFrequently: true })! };
};

/**
 * Tileable smooth noise, values 0..255 (Uint8, one per pixel): `octaves` random grids of
 * `cells`, 2x`cells`, ... cells, each scaled up to `size` by the canvas (smoothed), wrapped
 * at the edges, and blended with weights 1, gain, gain^2, ...
 */
const smoothNoise = (size: number, cells: number, octaves: number, rand: () => number, gain = 0.5) => {
    const { g } = canvas2d(size);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    let wsum = 0;
    for (let o = 0, w = 1; o < octaves && (cells << o) <= size / 2; o++, w *= gain) {
        const n = cells << o;
        const { c: lc, g: lg } = canvas2d(n + 2);
        const img = lg.createImageData(n + 2, n + 2);
        const v = new Uint8Array(n * n).map(() => (rand() * 256) | 0);
        for (let y = 0; y < n + 2; y++) for (let x = 0; x < n + 2; x++) {
            const val = v[((y + n - 1) % n) * n + ((x + n - 1) % n)], p = (y * (n + 2) + x) * 4;
            img.data[p] = img.data[p + 1] = img.data[p + 2] = val; img.data[p + 3] = 255;
        }
        lg.putImageData(img, 0, 0);
        wsum += w;
        g.globalAlpha = w / wsum; // running weighted average of the octaves
        const sc = size / n;
        g.drawImage(lc, -sc, -sc, (n + 2) * sc, (n + 2) * sc);
    }
    g.globalAlpha = 1;
    const d = g.getImageData(0, 0, size, size).data;
    const out = new Uint8Array(size * size);
    let lo = 255, hi = 0;
    for (let i = 0; i < out.length; i++) { const v = d[i * 4]; out[i] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
    const k = 255 / Math.max(1, hi - lo);
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) * k; // stretch to 0..255
    return out;
};

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

/** Adds soft discs (stones, stains) to a value array, wrapping at the edges. */
const discs = (v: Float32Array, N: number, count: number, rand: () => number, rMin: number, rMax: number, value: () => number) => {
    for (let k = 0; k < count; k++) {
        const cx = rand() * N, cy = rand() * N, r = rMin + rand() * rand() * (rMax - rMin), dv = value();
        const R = Math.ceil(r + 1);
        for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
            const px = Math.floor(cx) + ox, py = Math.floor(cy) + oy;
            const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy), w = r + 0.5 - d;
            if (w > 0) v[((py + N) % N) * N + ((px + N) % N)] += dv * (w > 1 ? 1 : w);
        }
    }
};

/**
 * Fine asphalt aggregate (grey, linear, centred on 0.5): small light and dark stones in a
 * blotchy binder. A world-space detail multiplier on paving, curbs and paint (3.2 units).
 */
export const generateAggregateTexture = () => {
    const N = 256, rand = seededRandom(1103);
    const blot = smoothNoise(N, 16, 3, rand);
    const v = new Float32Array(N * N);
    for (let i = 0; i < v.length; i++) v[i] = 0.5 + (blot[i] / 255 - 0.5) * 0.2 + (rand() - 0.5) * 0.12;
    discs(v, N, 2400, rand, 0.45, 1.7, () => (rand() < 0.25 ? -(0.08 + rand() * 0.14) : 0.05 + rand() * 0.28));
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
    const N = 128, rand = seededRandom(3301);
    const r = smoothNoise(N, 4, 4, rand), g = smoothNoise(N, 6, 3, rand), b = smoothNoise(N, 3, 4, rand, 0.55);
    const data = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) { data[i * 4] = r[i]; data[i * 4 + 1] = g[i]; data[i * 4 + 2] = b[i]; data[i * 4 + 3] = 255; }
    const t = dataTexture(data, N, N, false);
    t.anisotropy = 1;
    return t;
};

/** Draws `fn` at (x, y) and at its wrapped copies near the edges, so strokes tile. */
const wrapDraw = (size: number, x: number, y: number, margin: number, fn: (x: number, y: number) => void) => {
    const xs = x < margin ? [x, x + size] : x > size - margin ? [x, x - size] : [x];
    const ys = y < margin ? [y, y + size] : y > size - margin ? [y, y - size] : [y];
    for (const px of xs) for (const py of ys) fn(px, py);
};

/** Lawn seen from above (sRGB): clumps, blades in several greens, a little straw and soil. 4.5 units per repeat. */
export const generateGrassTexture = () => {
    const N = 256, rand = seededRandom(2207);
    const { c, g } = canvas2d(N);
    const clump = smoothNoise(N, 12, 3, rand);
    const img = g.createImageData(N, N);
    const dark = [52, 76, 30], light = [92, 118, 50];
    for (let i = 0; i < N * N; i++) {
        const t = clamp01(clump[i] / 255 * 1.05 - 0.02 + (rand() - 0.5) * 0.25);
        for (let k = 0; k < 3; k++) img.data[i * 4 + k] = dark[k] + (light[k] - dark[k]) * t;
        img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const blades = ['#5b7b31', '#4b6a29', '#68873a', '#3f5d23', '#789341', '#56732d', '#82904a', '#45652a'];
    g.lineCap = 'round';
    g.lineWidth = 1;
    for (let k = 0; k < 1700; k++) {
        const x = rand() * N, y = rand() * N, len = 1.5 + rand() * 3.5, a = rand() * Math.PI * 2;
        const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
        g.strokeStyle = blades[(rand() * blades.length) | 0]; g.globalAlpha = 0.35 + rand() * 0.4;
        wrapDraw(N, x, y, 6, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + dx, py + dy); g.stroke(); });
    }
    g.fillStyle = '#4a3d28';
    for (let k = 0; k < 260; k++) { g.globalAlpha = 0.3 + rand() * 0.3; g.fillRect((rand() * N) | 0, (rand() * N) | 0, 1, 1); }
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
};

/**
 * Sidewalk concrete (sRGB): one repeat = 4 x 4 slabs with tooled joints, a slightly
 * different tone per slab, a broom finish, grime along the joints and a few stains.
 * Sampled at 12 units (6 m) per repeat, i.e. 1.5 m slabs.
 */
export const SLAB_REPEAT = 12;
export const generateSlabTexture = () => {
    const N = 256, S = 64, rand = seededRandom(4409);
    const blot = smoothNoise(N, 8, 3, rand);
    const broom = Float32Array.from({ length: N }, () => (rand() - 0.5) * 0.035);
    const tone = Array.from({ length: 16 }, () => 1 + (rand() - 0.5) * 0.09);
    const warm = Array.from({ length: 16 }, () => (rand() - 0.5) * 0.025);
    const v = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const sx = x & (S - 1), sy = y & (S - 1), e = Math.min(sx, S - 1 - sx, sy, S - 1 - sy);
        let k = tone[(y >> 6) * 4 + (x >> 6)] * (1 + (blot[y * N + x] / 255 - 0.5) * 0.1 + (rand() - 0.5) * 0.07 + broom[y]);
        if (e < 4) k *= 0.955 + 0.011 * e;
        if (e === 0) k *= 0.64;
        v[y * N + x] = k;
    }
    discs(v, N, 30, rand, 0.6, 1.4, () => -0.3);
    discs(v, N, 6, rand, 4, 11, () => -0.05);
    const base = [156, 154, 148].map(c => SRGB_TO_LINEAR[c]);
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const i = y * N + x, w = warm[(y >> 6) * 4 + (x >> 6)];
        data[i * 4] = lin2s(base[0] * v[i] * (1 + w)); data[i * 4 + 1] = lin2s(base[1] * v[i]); data[i * 4 + 2] = lin2s(base[2] * v[i] * (1 - w));
        data[i * 4 + 3] = 255;
    }
    return dataTexture(data, N, N, true);
};

/** Road atlas layout (u): a 25-unit road cross-section, then the sealed lot paving, then gravel. */
export const ROAD_ATLAS_ROAD_U = 0.625;
/** u of the sealed-lot column (a texel centre well inside its region, so mipmaps hardly bleed). */
export const ROAD_ATLAS_LOT_U = 0.71875;
export const ROAD_ATLAS_GRAVEL_U = 0.90625;
/** Road units per repeat along the road (v). */
export const ROAD_ATLAS_LENGTH = 40;
/** Linear multiplier stored for unworn road; the paving colour divides it back out (room for brighter gravel). */
export const ROAD_ATLAS_BASE = 0.4;
/** Lanes of the 25-unit street (centre-line distances): see world/roads.ts. */
export const LANE_CENTRES = [3.1, 8.85];

/**
 * Asphalt wear atlas (sRGB multiplier on the paving colour; alpha = how much aggregate
 * detail shows). The road part is the street cross-section: darker, slightly polished wheel
 * paths and an oil streak in each lane, dusty gutters, sealed cracks and a patch. Then an
 * evenly sealed, warm charcoal lot surface, and loose gravel.
 */
export const generateRoadAtlasTexture = () => {
    const N = 256, RW = Math.round(N * ROAD_ATLAS_ROAD_U), LW = 48, rand = seededRandom(5501);
    const wearN = smoothNoise(N, 6, 3, rand), oilN = smoothNoise(N, 24, 2, rand), toneN = smoothNoise(N, 10, 3, rand), coarse = smoothNoise(N, 64, 1, rand);
    // across-road profiles, per column
    const wheel = new Float32Array(RW), oil = new Float32Array(RW), dust = new Float32Array(RW);
    const lanes = [...LANE_CENTRES.map(c => -c), ...LANE_CENTRES];
    for (let x = 0; x < RW; x++) {
        const d = ((x + 0.5) / RW) * 25 - 12.5, ad = Math.abs(d);
        let w = 0, o = 0;
        for (const lc of lanes) {
            for (const wp of [lc - 1.56, lc + 1.56]) w = Math.max(w, Math.exp(-(((d - wp) / 0.45) ** 2)));
            o = Math.max(o, Math.exp(-(((d - lc) / 0.42) ** 2)));
        }
        wheel[x] = w; oil[x] = o; dust[x] = clamp01((ad - 11.3) / 1.1);
    }
    const m = new Float32Array(N * N).fill(1);
    for (let y = 0; y < N; y++) for (let x = 0; x < RW; x++) {
        const i = y * N + x;
        m[i] = (1 + (toneN[i] / 255 - 0.5) * 0.07) * (1 - 0.12 * wheel[x] * (0.7 + 0.6 * wearN[i] / 255)) * (1 - 0.16 * oil[x] * clamp01((oilN[i] / 255 - 0.42) * 3)) * (1 + 0.07 * dust[x]);
    }
    // sealed cracks along the lane joints and across the road, and a repair patch
    const crack = (x0: number, y0: number, dx: number, dy: number, steps: number) => {
        let x = x0, y = y0;
        for (let s = 0; s < steps; s++) {
            x += dx + (rand() - 0.5) * 0.8; y += dy + (rand() - 0.5) * 0.8;
            const px = Math.floor(x), py = ((Math.floor(y) % N) + N) % N;
            if (px < 0 || px >= RW) break;
            m[py * N + px] *= 0.62;
        }
    };
    for (const d of [-6, 6, -0.9]) {
        const px = ((d + 12.5) / 25) * RW;
        for (let k = 0; k < 2; k++) crack(px + (rand() - 0.5) * 2, rand() * N, (rand() - 0.5) * 0.2, 1, 20 + rand() * 50);
    }
    for (let k = 0; k < 3; k++) crack(rand() * 10, rand() * N, 1, (rand() - 0.5) * 0.3, 40 + rand() * 120);
    {
        const pw = 16 + rand() * 10, ph = 18 + rand() * 20, px0 = 20 + rand() * (RW - 60), py0 = rand() * N;
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
            const i = ((Math.floor(py0 + y)) % N) * N + Math.floor(px0 + x);
            m[i] *= (x < 1 || x >= pw - 1 || y < 1 || y >= ph - 1) ? 0.82 : 0.95;
        }
    }
    // Lot: warm charcoal (warm enough not to read lavender under the blue sky light); gravel: light warm grey-brown
    const LOT = [0.148, 0.13, 0.108], GRAVEL = [0.93, 0.85, 0.74];
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const i = y * N + x, o = i * 4;
        if (x < RW) {
            const k = m[i] * ROAD_ATLAS_BASE, warmth = dust[x] * 0.03;
            data[o] = lin2s(k * (1 + warmth)); data[o + 1] = lin2s(k); data[o + 2] = lin2s(k * (1 - warmth)); data[o + 3] = 255;
        } else if (x < RW + LW) {
            const k = 1 + (toneN[i] / 255 - 0.5) * 0.06;
            data[o] = lin2s(LOT[0] * k); data[o + 1] = lin2s(LOT[1] * k); data[o + 2] = lin2s(LOT[2] * k); data[o + 3] = 170;
        } else {
            const k = 0.8 + 0.4 * (coarse[i] / 255) + (rand() - 0.5) * 0.25;
            data[o] = lin2s(GRAVEL[0] * k); data[o + 1] = lin2s(GRAVEL[1] * k); data[o + 2] = lin2s(GRAVEL[2] * k); data[o + 3] = 255;
        }
    }
    const t = dataTexture(data, N, N, true);
    t.wrapS = THREE.ClampToEdgeWrapping;
    return t;
};

/** Paint colours, picked by u. `shade` is the dark line at the foot of a curb. */
const PAINT = { white: '#dbd9d1', yellow: '#deab36', dark: '#3c3b39', shade: '#6d685f', red: '#b5302a', black: '#1d1d1e', blue: '#2f5fa8', green: '#2e7d4f' } as const;
export const PAINT_U = Object.fromEntries(Object.keys(PAINT).map((k, i) => [k, (i + 0.5) / 8])) as Record<keyof typeof PAINT, number>;
export const generatePaintPaletteTexture = () => {
    const data = new Uint8Array(8 * 4);
    Object.values(PAINT).forEach((hex, i) => {
        const c = parseInt(hex.slice(1), 16);
        data.set([(c >> 16) & 255, (c >> 8) & 255, c & 255, 255], i * 4);
    });
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
    const N = 256, rand = seededRandom(6607);
    const { c, g } = canvas2d(N);
    // canvas row 0 is v = 1: leaves on rows 0-127, needles 128-191, bark 192-255
    const band = (y0: number, h: number, base: string, draw: () => void) => {
        g.save(); g.beginPath(); g.rect(0, y0, N, h); g.clip();
        g.fillStyle = base; g.fillRect(0, y0, N, h);
        draw(); g.restore();
    };
    band(0, 128, '#2c4219', () => {
        const cols = ['#3d5f22', '#4a7128', '#557d2e', '#33521d', '#648a37', '#2b461a', '#6f9440'];
        for (let k = 0; k < 1500; k++) {
            const x = rand() * N, y = rand() * 128, rx = 1 + rand() * 2.4, ry = rx * (0.45 + rand() * 0.3), a = rand() * Math.PI;
            g.fillStyle = cols[(rand() * cols.length) | 0]; g.globalAlpha = 0.65 + rand() * 0.35;
            wrapDraw(N, x, y, 4, (px, py) => { if (py === y) { g.beginPath(); g.ellipse(px, y, rx, ry, a, 0, Math.PI * 2); g.fill(); } });
        }
        g.fillStyle = '#18270e'; g.globalAlpha = 0.6;
        for (let k = 0; k < 220; k++) { const r = 0.6 + rand() * 1.3; g.beginPath(); g.arc(rand() * N, rand() * 128, r, 0, Math.PI * 2); g.fill(); }
    });
    band(128, 64, '#1f3319', () => {
        const cols = ['#2d4a26', '#38592e', '#24401f', '#42653a', '#2f5030'];
        g.lineCap = 'round'; g.lineWidth = 1;
        for (let k = 0; k < 1100; k++) {
            const x = rand() * N, y = 128 + rand() * 64, len = 1.5 + rand() * 3, a = Math.PI / 2 + (rand() - 0.5) * 1.6;
            g.strokeStyle = cols[(rand() * cols.length) | 0]; g.globalAlpha = 0.7;
            g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
        }
    });
    band(192, 64, '#5d5045', () => {
        g.lineWidth = 1;
        for (let k = 0; k < 260; k++) {
            const x = rand() * N, y = 192 + rand() * 64, len = 3 + rand() * 15;
            g.strokeStyle = rand() < 0.6 ? '#3b322a' : '#7b6c5d'; g.globalAlpha = 0.55;
            g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 1.5, y + len); g.stroke();
        }
    });
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 2;
    return t;
};

/** Soft round glow (white, falloff in alpha) for the light pools and lamp glare. */
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
