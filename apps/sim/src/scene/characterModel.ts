import * as THREE from 'three';

// People: the player (a car dealer), customers and other players.
//
// Each person is ONE skinned mesh — a single draw call (plus one in the shadow
// pass on High), about 2.0–2.2k triangles — with 13 bones posed procedurally every
// frame (walk, run, idle). Everyone shares one material: skin, hair and clothes
// are vertex colours, so variety costs nothing. People with the same body shape
// share their geometry buffers and only own a small colour buffer.
//
// Looks come from a seed: dealerLook(playerName) (so every client draws a player
// the same) and customerLook(agentId) — sex, age, build, skin, hair, clothes.
// On Low graphics (no shadow maps) BlobShadows draws a soft disc under everyone.
//
// Model space is metres with the feet at y = 0, facing −Z (the game's forward)
// and +X to the person's right; `root` is scaled to world units (2 per metre).

export const UNITS_PER_METRE = 2;
// The road and lot paving tops are 0.03 up (scene/world/roads.ts, Y.road): people stand on them.
const GROUND_TOP = 0.03;
// Blob shadows just above the highest paving people walk on (the driveway crossing, 0.045).
const BLOB_Y = 0.05;

// ---- Looks ---------------------------------------------------------------------------

export type HairStyle = 'short' | 'buzz' | 'bald' | 'curly' | 'long' | 'ponytail' | 'bun' | 'bob';
export type Top = 'shirt' | 'blouse' | 'polo' | 'tee' | 'hoodie' | 'jacket' | 'dress';
export type Bottom = 'slacks' | 'jeans' | 'shorts' | 'skirt' | 'pencil';
export type Build = 'slim' | 'average' | 'heavy';
export type Age = 'young' | 'adult' | 'senior';
export type ShoeKind = 'dress' | 'sneaker' | 'flat';
export interface Look {
    female: boolean; age: Age; build: Build;
    /** metres; a 1.76 m man is 3.5 world units tall */
    height: number;
    hairStyle: HairStyle; beard: boolean;
    top: Top; bottom: Bottom; shoe: ShoeKind;
    /** shirt with a tie */
    tie: boolean;
    /** top tucked into the trousers (a belt shows) */
    tucked: boolean;
    skin: string; hair: string; eyes: string; lips: string;
    topColor: string;
    /** tee under a jacket, polo buttons */
    innerColor: string;
    /** tie, zip, hoodie strings */
    accentColor: string;
    bottomColor: string; beltColor: string; shoeColor: string; soleColor: string; sockColor: string;
    /** bare legs or tights under a skirt or shorts */
    legColor: string;
}

// A deterministic random generator from a seed (names, agent ids, car ids)
export const hashSeed = (seed: string | number) => {
    let h = 2166136261 >>> 0;
    const s = String(seed);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
};
type Rng = () => number;
const rng = (seed: string | number): Rng => {
    let a = hashSeed(seed) || 1;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};
const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(r() * list.length))];
const mixA = new THREE.Color(), mixB = new THREE.Color();
const mixHex = (a: string, b: string, t: number) => '#' + mixA.set(a).lerp(mixB.set(b), t).getHexString();

// Palettes. The first entries make up the original dealer.
const SKIN_TONES = ['#d7a27c', '#f4d5c0', '#ecc0a0', '#c08a66', '#a8714f', '#8d5a3b', '#6b4029', '#4b2c1d'];
const HAIR_NATURAL = ['#3a2a20', '#15110f', '#2a1c15', '#4a3122', '#6b4529', '#8a5a33', '#b08550', '#d6b57e', '#8c3a1d'];
const HAIR_GREY = ['#7d7873', '#a29d96', '#c9c5be', '#e6e3dd'];
const EYE_COLOURS = ['#4a3426', '#3a281d', '#5c4a2a', '#3f5f7a', '#4c6b4a'];
const LIPSTICK = ['#a8525a', '#8e2f3c', '#b5555f', '#9a4a46', '#c0707a'];
const M_HEIGHTS = [1.76, 1.7, 1.73, 1.79, 1.82, 1.86];
const F_HEIGHTS = [1.66, 1.58, 1.62, 1.69, 1.72];
// Dealer outfits: [shirt, tie ('' = none), slacks, belt, shoes]
const DEALER_MEN: [string, string, string, string, string][] = [
    ['#e8eef6', '#7d1f2c', '#2c3039', '#2a1d16', '#211813'],
    ['#ffffff', '#1d2c56', '#1c2130', '#111111', '#0f0e0e'],
    ['#d7e5f5', '', '#4b4f58', '#4a2e1c', '#4a2e1c'],
    ['#f4dfe4', '#1d2c56', '#2c3039', '#111111', '#0f0e0e'],
    ['#e2dcf0', '#1d4733', '#1c2130', '#2a1d16', '#211813'],
    ['#dceee2', '', '#1c2130', '#111111', '#0f0e0e'],
    ['#f2ede2', '#a5772a', '#3a3229', '#4a2e1c', '#4a2e1c'],
    ['#cfd8e3', '#232327', '#141517', '#111111', '#0f0e0e'],
    ['#ffffff', '#8c2f1c', '#2c3039', '#2a1d16', '#211813'],
];
// [blouse, bottom kind, bottom colour, shoes]
const DEALER_WOMEN: [string, Bottom, string, string][] = [
    ['#f6f1e8', 'slacks', '#2c3039', '#0f0e0e'],
    ['#ffffff', 'pencil', '#1c2130', '#0f0e0e'],
    ['#f0cfc8', 'slacks', '#4b4f58', '#4a2e1c'],
    ['#cfe0f2', 'pencil', '#141517', '#0f0e0e'],
    ['#2e3c62', 'slacks', '#4b4f58', '#0f0e0e'],
    ['#1e6656', 'slacks', '#141517', '#0f0e0e'],
    ['#d9b75e', 'slacks', '#1c2130', '#4a2e1c'],
    ['#9b3346', 'pencil', '#141517', '#0f0e0e'],
    ['#e4d6ef', 'pencil', '#2c3039', '#211813'],
];
const CASUAL = ['#1f2b45', '#2b2b2e', '#7c8085', '#ecebe6', '#e6dcc8', '#5c6b45', '#7b2333', '#d0a239', '#24706f', '#b0532f',
    '#2f5a3a', '#7fa7cf', '#d98ea0', '#9d8ec4', '#c23b32', '#3d4148'];
const CASUAL_SHIRTS = ['#d7e5f5', '#ffffff', '#e9e1cf', '#c9d6c2', '#f0d9d2', '#b8c7dd'];
const BLOUSES = ['#f6f1e8', '#ffffff', '#f0cfc8', '#cfe0f2', '#2e3c62', '#1e6656', '#d9b75e', '#9b3346', '#e4d6ef'];
const DRESSES = ['#1f2b45', '#7b2333', '#24706f', '#c23b32', '#2b2b2e', '#d98ea0', '#5c6b45', '#e6dcc8', '#9d8ec4'];
const JEANS = ['#33507a', '#24395c', '#4c6d96', '#1b2433', '#6f8db2', '#2a2a2e'];
const CHINOS = ['#b9a37a', '#7a6a50', '#3f4a5c', '#556048', '#2c3039', '#4b4f58'];
const SHORTS = ['#b9a37a', '#3f4a5c', '#556048', '#33507a', '#7c8085', '#1f2b45'];
const SKIRTS = ['#1f2b45', '#2b2b2e', '#7b2333', '#5c6b45', '#b0532f', '#33507a', '#d0a239'];
const SNEAKERS = ['#ecebe8', '#2b2b2e', '#7c8085', '#33507a', '#c23b32', '#ecebe8'];
const SNEAKER_SOLES = ['#d8d4cc', '#f2f0ea', '#2a2a2a'];
const LEATHER = ['#4a2e1c', '#211813', '#6b4a2f', '#0f0e0e'];
const FLATS = ['#211813', '#7b2333', '#e6dcc8', '#1f2b45', '#b0532f', '#0f0e0e'];
const BELTS = ['#2a1d16', '#111111', '#4a2e1c'];

const naturalLips = (skin: string) => mixHex(skin, '#8a3a36', 0.32);

/**
 * A player's dealer: chosen from a hash of their name, so every client draws the same
 * person. Men wear a dress shirt (most with a tie), women a blouse with slacks or a skirt.
 */
export const dealerLook = (name: string): Look => {
    const r = rng('dealer|' + name);
    const female = r() < 0.5;
    const age: Age = r() < 0.12 ? 'senior' : r() < 0.4 ? 'young' : 'adult';
    const build: Build = r() < 0.62 ? 'average' : r() < 0.6 ? 'slim' : 'heavy';
    const skin = pick(r, SKIN_TONES);
    const hair = age === 'senior' && r() < 0.75 ? pick(r, HAIR_GREY) : pick(r, HAIR_NATURAL);
    const eyes = pick(r, EYE_COLOURS);
    const height = pick(r, female ? F_HEIGHTS : M_HEIGHTS) - (age === 'senior' ? 0.02 : 0);
    const base = { female, age, build, height, skin, hair, eyes, beard: false, shoe: 'dress' as ShoeKind, tucked: true, soleColor: '#141110' };
    if (!female) {
        const [shirt, tie, slacks, belt, shoes] = pick(r, DEALER_MEN);
        const hairStyle: HairStyle = age === 'senior' && r() < 0.45 ? 'bald' : pick(r, ['short', 'short', 'buzz', 'curly'] as HairStyle[]);
        return {
            ...base, hairStyle, beard: age !== 'young' && r() < 0.18, top: 'shirt', bottom: 'slacks', tie: !!tie, lips: naturalLips(skin),
            topColor: shirt, innerColor: shirt, accentColor: tie || '#7d1f2c', bottomColor: slacks, beltColor: belt,
            shoeColor: shoes, sockColor: '#23262c', legColor: skin,
        };
    }
    const [blouse, bottom, bottomColor, shoes] = pick(r, DEALER_WOMEN);
    return {
        ...base, hairStyle: pick(r, ['bob', 'ponytail', 'bun', 'long', 'curly'] as HairStyle[]), top: 'blouse', bottom,
        shoe: bottom === 'pencil' ? 'flat' : 'dress', tie: false, lips: pick(r, LIPSTICK),
        topColor: blouse, innerColor: blouse, accentColor: blouse, bottomColor, beltColor: pick(r, BELTS),
        shoeColor: shoes, sockColor: bottom === 'pencil' ? skin : '#23262c', legColor: skin,
    };
};

/** A walk-in customer, seeded by their agent (or car) id: age, build, hair and a casual outfit. */
export const customerLook = (seed: string | number): Look => {
    const r = rng('customer|' + seed);
    const female = r() < 0.5;
    const age: Age = r() < 0.2 ? 'senior' : r() < 0.45 ? 'young' : 'adult';
    const build: Build = pick(r, ['slim', 'average', 'average', 'heavy'] as Build[]);
    const skin = pick(r, SKIN_TONES);
    const hair = age === 'senior' && r() < 0.75 ? pick(r, HAIR_GREY) : pick(r, HAIR_NATURAL);
    const height = pick(r, female ? F_HEIGHTS : M_HEIGHTS) - (age === 'senior' ? 0.03 : 0);
    const hairStyle: HairStyle = female
        ? pick(r, (age === 'senior' ? ['bob', 'bun', 'short', 'curly'] : ['long', 'long', 'ponytail', 'bun', 'bob', 'curly']) as HairStyle[])
        : pick(r, (age === 'senior' ? ['bald', 'bald', 'short', 'buzz'] : ['short', 'short', 'buzz', 'curly', age === 'adult' ? 'bald' : 'short']) as HairStyle[]);
    let top: Top = pick(r, (female ? ['tee', 'blouse', 'hoodie', 'jacket', 'dress', 'polo'] : ['tee', 'polo', 'hoodie', 'jacket', 'shirt']) as Top[]);
    if (age === 'senior' && top === 'hoodie') top = female ? 'blouse' : 'shirt';
    let bottom: Bottom;
    if (top === 'dress') bottom = 'skirt';
    else if (female && r() < 0.28) bottom = 'skirt';
    else if (age !== 'senior' && top !== 'jacket' && top !== 'hoodie' && r() < 0.18) bottom = 'shorts';
    else bottom = r() < 0.62 ? 'jeans' : 'slacks';
    const tucked = (top === 'shirt' || top === 'blouse') && bottom !== 'skirt';
    const shoe: ShoeKind = female && bottom === 'skirt' ? 'flat' : age === 'senior' || top === 'shirt' ? (r() < 0.7 ? 'dress' : 'sneaker') : r() < 0.78 ? 'sneaker' : 'dress';
    const topColor = top === 'shirt' ? pick(r, CASUAL_SHIRTS) : top === 'blouse' ? pick(r, BLOUSES) : top === 'dress' ? pick(r, DRESSES) : pick(r, CASUAL);
    const bottomColor = bottom === 'jeans' ? pick(r, JEANS) : bottom === 'shorts' ? pick(r, SHORTS) : bottom === 'skirt' ? pick(r, SKIRTS) : pick(r, CHINOS);
    const tights = bottom === 'skirt' && r() < 0.25;
    const legColor = tights ? '#1d1c1f' : skin;
    const shoeColor = shoe === 'sneaker' ? pick(r, SNEAKERS) : shoe === 'flat' ? pick(r, FLATS) : pick(r, LEATHER);
    return {
        female, age, build, height, hairStyle, beard: !female && age !== 'young' && r() < 0.3, top, bottom, shoe, tie: false, tucked,
        skin, hair, eyes: pick(r, EYE_COLOURS), lips: female && r() < 0.6 ? pick(r, LIPSTICK) : naturalLips(skin),
        topColor, innerColor: pick(r, ['#efebe4', '#2b2b2e', '#7c8085', '#efebe4']), accentColor: top === 'hoodie' ? '#e8e4dc' : '#3a3633',
        bottomColor, beltColor: pick(r, BELTS), shoeColor, soleColor: shoe === 'sneaker' ? pick(r, SNEAKER_SOLES) : '#141110',
        sockColor: bottom === 'skirt' ? legColor : bottom === 'shorts' ? pick(r, ['#f2f0ea', '#2b2b2e', '#c9c5be']) : '#23262c', legColor,
    };
};

// ---- Small math helpers --------------------------------------------------------------

type V3 = [number, number, number];
/** up to four bone influences: bone A, weight A, bone B, weight B, ... */
type W = [number, number, number, number, number, number, number, number];
const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** superellipse profile: sign(v)·|v|^(2/n) (n = 2 is an ellipse, larger is boxier) */
const spow = (v: number, n: number) => (v < 0 ? -1 : 1) * Math.pow(Math.abs(v), 2 / n);
const TAU = Math.PI * 2;

// ---- Bones and colour slots ----------------------------------------------------------

const HIPS = 0, SPINE = 1, HEAD = 2, ARM_L = 3, FORE_L = 4, ARM_R = 5, FORE_R = 6,
    THIGH_L = 7, SHIN_L = 8, FOOT_L = 9, THIGH_R = 10, SHIN_R = 11, FOOT_R = 12;
const SKIN = 0, HAIR = 1, BROW = 2, EYE = 3, IRIS = 4, LIPS = 5, TOP = 6, INNER = 7, ACCENT = 8,
    BOTTOM = 9, BELT = 10, METAL = 11, SHOE = 12, SOLE = 13, SOCK = 14, LEGS = 15, SLOTS = 16;

// ---- Body proportions ------------------------------------------------------------------

/** A horizontal cross-section: centre (0|x, y, z), half width rx, depth to the front f and back b. */
type Ring = { y: number; rx: number; f: number; b: number; z: number };
const R = (y: number, rx: number, f: number, b: number, z = 0): Ring => ({ y, rx, f, b, z });

interface Body {
    female: boolean;
    ankleY: number; kneeY: number; hipY: number; hipX: number; pelvisY: number; spineY: number;
    headY: number; headZ: number; shoulderX: number; shoulderY: number; armTilt: number;
    upperArm: number; forearm: number; heel: number; toe: number;
    waistLo: number; waistHi: number;
    waistY: number;    // top of the trousers
    hemY: number;      // hem of untucked tops
    shirt: Ring[];     // close-fitting top, tucked in below waistY
    pelvis: Ring[];
    skirt: Ring[];     // knee-length A-line skirt (women)
    pencil: Ring[];    // narrow skirt (women)
    leg: Ring[];       // centred on ±hipX
    head: Ring[];
    neck: Ring[];
    arm: [number, number][];             // [distance from the shoulder joint, radius]
    hand: [number, number, number, number][]; // [s, thickness, width, curl]
    shoe: [number, number, number, number][]; // [z, half width, centre y, half height]
    face: number;      // scale of the face features
}

const MALE: Body = {
    female: false,
    ankleY: 0.08, kneeY: 0.5, hipY: 0.93, hipX: 0.092, pelvisY: 0.975, spineY: 1.13,
    headY: 1.585, headZ: 0.01, shoulderX: 0.186, shoulderY: 1.418, armTilt: 0.075,
    upperArm: 0.3, forearm: 0.262, heel: 0.064, toe: 0.218,
    waistLo: 1.04, waistHi: 1.17, waistY: 1.05, hemY: 0.935,
    shirt: [R(0.99, 0.15, 0.103, 0.105), R(1.05, 0.151, 0.106, 0.106), R(1.15, 0.159, 0.113, 0.108), R(1.25, 0.171, 0.121, 0.11),
        R(1.33, 0.177, 0.123, 0.112), R(1.39, 0.181, 0.113, 0.108), R(1.435, 0.18, 0.097, 0.093), R(1.452, 0.17, 0.09, 0.087, 0.003), R(1.47, 0.138, 0.08, 0.078, 0.006),
        R(1.495, 0.072, 0.066, 0.066, 0.012)],
    pelvis: [R(1.05, 0.158, 0.111, 0.111), R(0.99, 0.163, 0.108, 0.116), R(0.925, 0.176, 0.1, 0.129), R(0.865, 0.16, 0.09, 0.118),
        R(0.815, 0.095, 0.068, 0.075)],
    skirt: [], pencil: [],
    leg: [R(0.95, 0.073, 0.077, 0.077), R(0.86, 0.08, 0.08, 0.085), R(0.7, 0.068, 0.07, 0.072), R(0.565, 0.058, 0.06, 0.058),
        R(0.5, 0.056, 0.06, 0.056), R(0.44, 0.054, 0.056, 0.062), R(0.3, 0.054, 0.052, 0.064, 0.004),
        R(0.085, 0.054, 0.058, 0.057)],
    head: [R(1.528, 0.026, 0.02, 0.026, -0.06), R(1.548, 0.053, 0.03, 0.05, -0.05), R(1.578, 0.068, 0.045, 0.07, -0.036),
        R(1.612, 0.073, 0.057, 0.088, -0.026), R(1.648, 0.077, 0.066, 0.1, -0.018), R(1.684, 0.078, 0.071, 0.11, -0.012),
        R(1.716, 0.074, 0.066, 0.104, -0.006), R(1.738, 0.062, 0.054, 0.088, -0.002), R(1.752, 0.04, 0.034, 0.058, 0.002)],
    neck: [R(1.455, 0.056, 0.052, 0.052, 0.02), R(1.52, 0.054, 0.05, 0.05, 0.012), R(1.6, 0.052, 0.048, 0.048, 0.004)],
    arm: [[-0.031, 0.022], [-0.021, 0.042], [0.0, 0.053], [0.07, 0.053], [0.24, 0.045], [0.3, 0.043],
        [0.36, 0.044], [0.545, 0.034]],
    hand: [[0.548, 0.021, 0.028, 0], [0.598, 0.021, 0.045, 0], [0.652, 0.019, 0.046, 0.003], [0.7, 0.016, 0.04, 0.009], [0.735, 0.013, 0.03, 0.015]],
    shoe: [[0.064, 0.026, 0.05, 0.03], [0.052, 0.038, 0.055, 0.042], [0.0, 0.045, 0.06, 0.05], [-0.07, 0.05, 0.05, 0.04],
        [-0.15, 0.049, 0.037, 0.026], [-0.2, 0.038, 0.03, 0.018]],
    face: 1,
};

const FEMALE: Body = {
    female: true,
    ankleY: 0.075, kneeY: 0.468, hipY: 0.872, hipX: 0.088, pelvisY: 0.912, spineY: 1.06,
    headY: 1.494, headZ: 0.008, shoulderX: 0.166, shoulderY: 1.33, armTilt: 0.1,
    upperArm: 0.282, forearm: 0.245, heel: 0.058, toe: 0.192,
    waistLo: 0.98, waistHi: 1.1, waistY: 0.985, hemY: 0.875,
    shirt: [R(0.94, 0.15, 0.096, 0.106), R(0.985, 0.136, 0.092, 0.098), R(1.035, 0.128, 0.09, 0.092), R(1.11, 0.137, 0.098, 0.096),
        R(1.18, 0.149, 0.124, 0.1), R(1.235, 0.154, 0.132, 0.102), R(1.29, 0.159, 0.11, 0.1), R(1.345, 0.16, 0.088, 0.085),
        R(1.362, 0.152, 0.081, 0.078, 0.003), R(1.38, 0.122, 0.072, 0.07, 0.006), R(1.403, 0.064, 0.058, 0.058, 0.01)],
    pelvis: [R(0.985, 0.148, 0.097, 0.108), R(0.93, 0.171, 0.096, 0.127), R(0.875, 0.18, 0.094, 0.131), R(0.82, 0.165, 0.085, 0.118),
        R(0.775, 0.092, 0.064, 0.072)],
    skirt: [R(0.985, 0.153, 0.102, 0.113), R(0.93, 0.18, 0.106, 0.134), R(0.875, 0.194, 0.112, 0.145), R(0.76, 0.205, 0.13, 0.152),
        R(0.64, 0.219, 0.148, 0.162), R(0.5, 0.232, 0.166, 0.175)],
    pencil: [R(0.985, 0.153, 0.102, 0.113), R(0.93, 0.18, 0.106, 0.134), R(0.875, 0.194, 0.112, 0.145), R(0.76, 0.19, 0.112, 0.146),
        R(0.64, 0.182, 0.112, 0.142), R(0.5, 0.176, 0.112, 0.138)],
    leg: [R(0.89, 0.075, 0.076, 0.078), R(0.81, 0.081, 0.08, 0.086), R(0.66, 0.065, 0.066, 0.07), R(0.53, 0.054, 0.056, 0.055),
        R(0.468, 0.052, 0.055, 0.052), R(0.41, 0.05, 0.052, 0.058), R(0.29, 0.051, 0.048, 0.06, 0.004),
        R(0.08, 0.043, 0.046, 0.046)],
    head: [], neck: [], arm: [], hand: [], shoe: [],
    face: 0.95,
};
// The woman's head, neck, arms, hands and feet: the man's, scaled.
{
    const f = 0.95, dy = FEMALE.headY - MALE.headY;
    FEMALE.head = MALE.head.map((r, i) => R(MALE.headY + dy + (r.y - MALE.headY) * f, r.rx * f * (i < 3 ? 0.95 : 1), r.f * f, r.b * f, r.z * f));
    FEMALE.neck = [R(1.37, 0.049, 0.045, 0.046, 0.018), R(1.43, 0.047, 0.043, 0.044, 0.011), R(1.51, 0.046, 0.042, 0.042, 0.004)];
    const a = 0.282 / 0.3;
    FEMALE.arm = MALE.arm.map(([s, r]) => [s * a, r * 0.88]);
    FEMALE.hand = MALE.hand.map(([s, t, w, c]) => [(s - 0.545) * 0.9 + 0.545 * a, t * 0.9, w * 0.88, c * 0.9]);
    FEMALE.shoe = MALE.shoe.map(([z, w, y, h]) => [z * 0.88, w * 0.88, y * 0.92, h * 0.92]);
}

/** The body for a build: slimmer or heavier torso and limbs (a belly for heavy builds). */
const bodies = new Map<string, Body>();
const bodyFor = (female: boolean, build: Build): Body => {
    const base = female ? FEMALE : MALE;
    if (build === 'average') return base;
    const key = (female ? 'f' : 'm') + build;
    let b = bodies.get(key);
    if (b) return b;
    const heavy = build === 'heavy';
    const w = heavy ? 1.13 : 0.92, limb = heavy ? 1.1 : 0.93;
    const belly = heavy ? (female ? 0.028 : 0.045) : 0, bellyY = female ? 1.06 : 1.13;
    const torso = (r: Ring) => R(r.y, r.rx * w, r.f * w + belly * Math.exp(-(((r.y - bellyY) / 0.11) ** 2)), r.b * w, r.z);
    const lastTwo = (rings: Ring[]) => rings.map((r, i) => i >= rings.length - 2 ? R(r.y, r.rx * (heavy ? 1.04 : 0.97), r.f, r.b, r.z) : torso(r));
    b = {
        ...base,
        hipX: base.hipX * (heavy ? 1.06 : 0.97), shoulderX: base.shoulderX * (heavy ? 1.07 : 0.96), armTilt: base.armTilt + (heavy ? 0.04 : -0.01),
        shirt: lastTwo(base.shirt), pelvis: base.pelvis.map(torso), skirt: base.skirt.map(torso), pencil: base.pencil.map(torso),
        leg: base.leg.map(r => R(r.y, r.rx * limb, r.f * limb, r.b * limb, r.z)),
        neck: base.neck.map(r => R(r.y, r.rx * (heavy ? 1.08 : 0.96), r.f * (heavy ? 1.08 : 0.96), r.b * (heavy ? 1.08 : 0.96), r.z)),
        arm: base.arm.map(([s, r], i) => [s, i < 2 ? r : r * limb] as [number, number]),
    };
    bodies.set(key, b);
    return b;
};

/** Interpolate a ring table (sorted by y, either direction) at height y. */
const ringAt = (rings: Ring[], y: number, out: Ring): Ring => {
    const n = rings.length;
    const asc = rings[n - 1].y > rings[0].y;
    let i = 0;
    while (i < n - 2 && (asc ? y > rings[i + 1].y : y < rings[i + 1].y)) i++;
    const a = rings[i], b = rings[i + 1];
    const t = clamp((y - a.y) / (b.y - a.y), 0, 1);
    out.y = y; out.rx = lerp(a.rx, b.rx, t); out.f = lerp(a.f, b.f, t); out.b = lerp(a.b, b.b, t); out.z = lerp(a.z, b.z, t);
    return out;
};
/** Point on a ring at angle theta (0 = front/−Z, π/2 = +X) */
const onRing = (r: Ring, theta: number, n: number, out: V3, cx = 0): V3 => {
    const c = Math.cos(theta);
    out[0] = cx + r.rx * spow(Math.sin(theta), n);
    out[1] = r.y;
    out[2] = r.z - (c >= 0 ? r.f : r.b) * spow(c, n);
    return out;
};

// ---- Mesh builder ---------------------------------------------------------------------

class Builder {
    pos: number[] = []; idx: number[] = []; bone: number[] = []; wgt: number[] = []; slot: number[] = []; shade: number[] = [];
    surf: number[] = [];      // surface id per vertex: normals are smoothed within a surface
    flatSurf = new Set<number>();
    private sid = 0;
    begin(flat = false) { this.sid++; if (flat) this.flatSurf.add(this.sid); }
    v(p: V3, slot: number, shade: number, w: W) {
        this.pos.push(p[0], p[1], p[2]);
        this.bone.push(w[0], w[2], w[4], w[6]);
        this.wgt.push(w[1], w[3], w[5], w[7]);
        this.slot.push(slot); this.shade.push(shade); this.surf.push(this.sid);
        return this.pos.length / 3 - 1;
    }
    /** Triangle wound so that its normal points along `out` (any outward reference). */
    tri(a: number, b: number, c: number, ox: number, oy: number, oz: number) {
        const P = this.pos;
        const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
        const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (nx * nx + ny * ny + nz * nz < 1e-14) return; // degenerate
        if (nx * ox + ny * oy + nz * oz < 0) this.idx.push(a, c, b); else this.idx.push(a, b, c);
    }
    normals(): Float32Array {
        const P = this.pos, I = this.idx, N = new Float32Array(P.length);
        for (let t = 0; t < I.length; t += 3) {
            const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
            const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
            const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
        }
        // Smooth across duplicated vertices (colour seams) of the same surface
        const groups = new Map<string, number[]>();
        for (let i = 0; i < P.length / 3; i++) {
            if (this.flatSurf.has(this.surf[i])) continue;
            const key = `${this.surf[i]}|${Math.round(P[i * 3] * 1e5)}|${Math.round(P[i * 3 + 1] * 1e5)}|${Math.round(P[i * 3 + 2] * 1e5)}`;
            const g = groups.get(key); if (g) g.push(i); else groups.set(key, [i]);
        }
        groups.forEach(g => {
            if (g.length < 2) return;
            let x = 0, y = 0, z = 0;
            for (const i of g) { x += N[i * 3]; y += N[i * 3 + 1]; z += N[i * 3 + 2]; }
            for (const i of g) { N[i * 3] = x; N[i * 3 + 1] = y; N[i * 3 + 2] = z; }
        });
        for (let i = 0; i < N.length; i += 3) {
            const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
            N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
        }
        return N;
    }
}

interface LoftSpec {
    rows: number;
    point: (row: number, theta: number, out: V3) => void;
    /** column angles (0 = front). Default: `segs` evenly spaced. */
    angles?: number[];
    segs?: number;
    /** open arc [from, to] instead of a closed ring */
    arc?: [number, number];
    /** angles where the colour changes (vertices are duplicated there) */
    splits?: number[];
    slot: number | ((theta: number) => number);
    capStart?: number; capEnd?: number;   // cap bulge (undefined = open end)
    capSlot?: number;
    weight: (p: V3, w: W) => void;
    shade?: (p: V3) => number;
    /** fixed outward direction for flat strips (default: away from each ring's centre) */
    out?: V3;
}

const tmpP: V3 = [0, 0, 0];
const tmpW: W = [0, 1, 0, 0, 0, 0, 0, 0];

/** A surface swept through rings of points (limbs, torso, head, hair, shoes...). */
function loft(B: Builder, L: LoftSpec) {
    B.begin();
    // Columns, split into strips at colour seams
    let base = L.angles ?? Array.from({ length: L.segs ?? 8 }, (_, k) => k * TAU / (L.segs ?? 8));
    const strips: { cols: number[]; closed: boolean; slot: number }[] = [];
    const slotOf = (th: number) => typeof L.slot === 'number' ? L.slot : L.slot(th);
    if (L.arc) {
        const [a0, a1] = L.arc;
        const cuts = [a0, ...(L.splits ?? []).filter(s => s > a0 && s < a1), a1];
        base = base.map(t => { let u = t; while (u < a0) u += TAU; while (u >= a0 + TAU) u -= TAU; return u; });
        for (let i = 0; i < cuts.length - 1; i++) {
            const cols = [cuts[i], ...base.filter(t => t > cuts[i] + 1e-4 && t < cuts[i + 1] - 1e-4).sort((p, q) => p - q), cuts[i + 1]];
            strips.push({ cols, closed: false, slot: slotOf((cuts[i] + cuts[i + 1]) / 2) });
        }
    } else if (L.splits && L.splits.length) {
        const cuts = L.splits.map(s => ((s % TAU) + TAU) % TAU).sort((p, q) => p - q);
        for (let i = 0; i < cuts.length; i++) {
            const a0 = cuts[i], a1 = i + 1 < cuts.length ? cuts[i + 1] : cuts[0] + TAU;
            const inner = base.map(t => ((t % TAU) + TAU) % TAU).map(t => t < a0 ? t + TAU : t).filter(t => t > a0 + 1e-4 && t < a1 - 1e-4).sort((p, q) => p - q);
            strips.push({ cols: [a0, ...inner, a1], closed: false, slot: slotOf((a0 + a1) / 2) });
        }
    } else {
        strips.push({ cols: base, closed: true, slot: slotOf(0) });
    }

    const rowCentre: V3[] = [];
    const around = base.length ? base : strips.flatMap(s => s.cols);
    for (let r = 0; r < L.rows; r++) {
        let x = 0, y = 0, z = 0;
        for (const t of around) { L.point(r, t, tmpP); x += tmpP[0]; y += tmpP[1]; z += tmpP[2]; }
        rowCentre.push([x / around.length, y / around.length, z / around.length]);
    }
    const ids: number[][][] = strips.map(s => {
        const rows: number[][] = [];
        for (let r = 0; r < L.rows; r++) {
            const row: number[] = [];
            for (const t of s.cols) {
                const p: V3 = [0, 0, 0];
                L.point(r, t, p);
                L.weight(p, tmpW);
                row.push(B.v(p, typeof L.slot === 'number' ? L.slot : s.slot, L.shade ? L.shade(p) : 1, tmpW));
            }
            rows.push(row);
        }
        return rows;
    });
    const P = B.pos;
    strips.forEach((s, si) => {
        const rows = ids[si];
        const nc = s.cols.length, last = s.closed ? nc : nc - 1;
        for (let r = 0; r < L.rows - 1; r++) {
            const c0 = rowCentre[r], c1 = rowCentre[r + 1];
            for (let c = 0; c < last; c++) {
                const a = rows[r][c], b = rows[r][(c + 1) % nc], cc = rows[r + 1][(c + 1) % nc], d = rows[r + 1][c];
                // outward reference: from the axis to the quad
                const ox = L.out ? L.out[0] : (P[a * 3] + P[cc * 3]) / 2 - (c0[0] + c1[0]) / 2;
                const oy = L.out ? L.out[1] : (P[a * 3 + 1] + P[cc * 3 + 1]) / 2 - (c0[1] + c1[1]) / 2;
                const oz = L.out ? L.out[2] : (P[a * 3 + 2] + P[cc * 3 + 2]) / 2 - (c0[2] + c1[2]) / 2;
                B.tri(a, b, cc, ox, oy, oz);
                B.tri(a, cc, d, ox, oy, oz);
            }
        }
    });
    // Caps: a fan around a centre vertex pushed out along the axis
    const cap = (row: number, bulge: number, toward: number) => {
        const c = rowCentre[row], o = rowCentre[toward];
        let ax = c[0] - o[0], ay = c[1] - o[1], az = c[2] - o[2];
        const l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
        const p: V3 = [c[0] + ax * bulge, c[1] + ay * bulge, c[2] + az * bulge];
        L.weight(p, tmpW);
        const centre = B.v(p, L.capSlot ?? (typeof L.slot === 'number' ? L.slot : strips[0].slot), L.shade ? L.shade(p) : 1, tmpW);
        const ring: number[] = [];
        ids.forEach(rows => ring.push(...rows[row]));
        const closed = !L.arc;
        for (let i = 0; i < ring.length - (closed ? 0 : 1); i++) B.tri(centre, ring[i], ring[(i + 1) % ring.length], ax, ay, az);
    };
    if (L.capStart !== undefined) cap(0, L.capStart, 1);
    if (L.capEnd !== undefined) cap(L.rows - 1, L.capEnd, L.rows - 2);
}

/** A small closed lens/ellipsoid (eyes, lips, ears): ring of `segs` points plus two poles. */
function lens(B: Builder, c: V3, U: V3, V: V3, N: V3, ru: number, rv: number, front: number, back: number, segs: number, slot: number, shade: number, w: W, shadeTop = 1) {
    B.begin();
    const ring: number[] = [];
    for (let k = 0; k < segs; k++) {
        const t = k * TAU / segs, cu = Math.cos(t) * ru, cv = Math.sin(t) * rv;
        ring.push(B.v([c[0] + U[0] * cu + V[0] * cv, c[1] + U[1] * cu + V[1] * cv, c[2] + U[2] * cu + V[2] * cv], slot, Math.sin(t) > 0.3 ? shade * shadeTop : shade, w));
    }
    const f = B.v([c[0] + N[0] * front, c[1] + N[1] * front, c[2] + N[2] * front], slot, shade, w);
    const b = B.v([c[0] - N[0] * back, c[1] - N[1] * back, c[2] - N[2] * back], slot, shade, w);
    for (let k = 0; k < segs; k++) {
        B.tri(f, ring[k], ring[(k + 1) % segs], N[0], N[1], N[2]);
        B.tri(b, ring[k], ring[(k + 1) % segs], -N[0], -N[1], -N[2]);
    }
}

/** Flat-shaded polyhedron from explicit triangles (nose, collar points). */
function facets(B: Builder, tris: V3[][], centre: V3, slot: number, shade: number, w: W) {
    B.begin(true);
    for (const [a, b, c] of tris) {
        const ia = B.v(a, slot, shade, w), ib = B.v(b, slot, shade, w), ic = B.v(c, slot, shade, w);
        B.tri(ia, ib, ic, (a[0] + b[0] + c[0]) / 3 - centre[0], (a[1] + b[1] + c[1]) / 3 - centre[1], (a[2] + b[2] + c[2]) / 3 - centre[2]);
    }
}

// ---- Building a body ---------------------------------------------------------------------

const set = (w: W, a: number, wa: number, b = a, wb = 0, c = a, wc = 0) => { w[0] = a; w[1] = wa; w[2] = b; w[3] = wb; w[4] = c; w[5] = wc; w[6] = a; w[7] = 0; };
const blend = (w: W, a: number, b: number, t: number) => t <= 0 ? set(w, a, 1) : t >= 1 ? set(w, b, 1) : set(w, a, 1 - t, b, t);
const fixed = (bone: number) => (_p: V3, w: W) => set(w, bone, 1);
const only = (bone: number): W => [bone, 1, bone, 0, bone, 0, bone, 0];

/** Gentle ambient occlusion baked into the vertex colours: darker toward the feet and in creases. */
const ambient = (body: Body) => (p: V3) => {
    const h = body.hipY / MALE.hipY;
    let s = lerp(0.8, 1, smooth(0, 0.5 * h, p[1]));
    if (Math.abs(p[0]) < 0.06 && p[1] < 0.95 * h && p[1] > 0.6 * h) s *= 0.86; // inner thighs
    return s;
};

type Shape = Pick<Look, 'female' | 'build' | 'hairStyle' | 'beard' | 'top' | 'bottom' | 'shoe' | 'tie' | 'tucked'>;
const shapeKey = (s: Shape) => [s.female ? 'f' : 'm', s.build, s.hairStyle, s.beard ? 'b' : '', s.top, s.bottom, s.shoe, s.tie ? 't' : '', s.tucked ? 'i' : ''].join('|');

// Hairlines: [angle from the front, height above the head's lowest ring in units of head size]
const KEYS_SHORT: [number, number][] = [[0, 0.183], [0.45, 0.172], [0.95, 0.148], [1.2, 0.112], [1.32, 0.118], [1.5, 0.142], [1.95, 0.128], [2.45, 0.085], [Math.PI, 0.066]];
const KEYS_CURLY: [number, number][] = [[0, 0.178], [0.45, 0.168], [0.95, 0.142], [1.25, 0.112], [1.5, 0.13], [2.0, 0.112], [2.5, 0.078], [Math.PI, 0.058]];
const KEYS_LONG: [number, number][] = [[0, 0.17], [0.45, 0.155], [0.85, 0.06], [1.2, -0.01], [1.6, -0.02], [2.2, -0.03], [Math.PI, -0.035]];
const KEYS_BOB: [number, number][] = [[0, 0.168], [0.45, 0.152], [0.85, 0.07], [1.2, 0.015], [1.6, 0.005], [2.2, 0.01], [Math.PI, 0.02]];
const KEYS_BACK: [number, number][] = [[0, 0.172], [0.45, 0.16], [0.95, 0.13], [1.25, 0.105], [1.5, 0.125], [2.0, 0.09], [2.5, 0.06], [Math.PI, 0.05]];
const ANGLES_SHORT = [0, 0.45, 0.9, 1.2, 1.36, 1.6, 2.0, 2.5, Math.PI, -2.5, -2.0, -1.6, -1.36, -1.2, -0.9, -0.45];
const ANGLES_LONG = [0, 0.45, 0.9, 1.3, 1.75, 2.3, 2.8, Math.PI, -2.8, -2.3, -1.75, -1.3, -0.9, -0.45];
const BOX4 = [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4];
const hash2 = (a: number, b: number) => { const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); };

function buildBody(B: Builder, body: Body, s: Shape) {
    const ao = ambient(body);
    const F = s.female;
    const k = body.kneeY / MALE.kneeY;          // vertical scale against the man
    const tmpRing: Ring = R(0, 0, 0, 0), tmpRing2: Ring = R(0, 0, 0, 0);
    const torsoW = (p: V3, w: W) => blend(w, HIPS, SPINE, (p[1] - body.waistLo) / (body.waistHi - body.waistLo));
    const dress = s.top === 'dress';
    const skirt = dress || s.bottom === 'skirt' || s.bottom === 'pencil';
    const untucked = !s.tucked && !dress;
    const loose = s.top === 'hoodie' ? 0.012 : s.top === 'jacket' ? 0.009 : 0.004;
    const lowerSlot = dress ? TOP : BOTTOM;

    // --- Torso. A tucked top (or a dress's bodice) ends inside the trousers/skirt; an
    // untucked one hangs over the hips, sized from them.
    let torso = body.shirt;
    if (untucked) {
        const hip = (y: number, extra: number) => { const q = ringAt(body.pelvis, y, R(0, 0, 0, 0)); return R(y, q.rx + loose + extra, q.f + loose + extra, q.b + loose + extra, q.z); };
        const upper = body.shirt.filter(r => r.y > body.waistY + 0.01);
        torso = [hip(body.hemY, 0.008), hip((body.hemY + body.waistY) / 2, 0.005), hip(body.waistY, 0.003),
            ...upper.map((r, i) => { const l = i >= upper.length - 2 ? loose * 0.5 : loose; return R(r.y, r.rx + l, r.f + l, r.b + l * 0.8, r.z); })];
    }
    loft(B, {
        rows: torso.length + (untucked ? 1 : 0), segs: 12,
        point: (r, t, o) => {
            if (untucked && r === 0) { // hem lip, turned inward
                const h = torso[0]; onRing(h, t, 2.4, o);
                o[0] *= 0.93; o[2] = h.z + (o[2] - h.z) * 0.93; o[1] += 0.012;
                return;
            }
            onRing(torso[r - (untucked ? 1 : 0)], t, 2.4, o);
        },
        slot: TOP, capEnd: 0.004, weight: torsoW,
        shade: p => ao(p) * (s.top === 'hoodie' && p[1] < body.hemY + 0.035 ? 0.86 : 1), // a hoodie's ribbed hem
    });

    // --- Hips, legs, skirt
    loft(B, { rows: body.pelvis.length, segs: 12, point: (r, t, o) => onRing(body.pelvis[r], t, 2.4, o), slot: lowerSlot, capEnd: 0.01, weight: fixed(HIPS), shade: ao });
    const scaled = (r: Ring, f: number) => R(r.y, r.rx * f, r.f * f, r.b * f, r.z);
    // bare legs (under a skirt or shorts) from yTop down into the shoe
    const bareLeg = (yTop: number) => [scaled(ringAt(body.leg, yTop, R(0, 0, 0, 0)), 0.9),
        ...body.leg.filter(r => r.y < yTop - 0.02 && r.y > 0.2 * k).map(r => scaled(r, 0.9)),
        R(0.13 * k, 0.036, 0.036, 0.04, 0.004), R(0.07 * k, 0.033, 0.033, 0.036, 0.004)];
    for (const side of [-1, 1]) {
        const thigh = side < 0 ? THIGH_L : THIGH_R, shin = side < 0 ? SHIN_L : SHIN_R, foot = side < 0 ? FOOT_L : FOOT_R;
        const legX = (y: number) => side * (body.hipX - 0.006 * (1 - y / body.hipY));
        const legW = (p: V3, w: W) => blend(w, thigh, shin, smooth(body.kneeY + 0.06, body.kneeY - 0.06, p[1]));
        // a leg tube through `rings`, optionally with a lip folded inside its lower end
        const legLoft = (rings: Ring[], slot: number, lip: boolean) => loft(B, {
            rows: rings.length + (lip ? 1 : 0), segs: 8,
            point: (r, t, o) => {
                const ring = rings[Math.min(r, rings.length - 1)], cx = legX(ring.y);
                onRing(ring, t, 2.2, o, cx);
                if (r >= rings.length) { o[0] = cx + (o[0] - cx) * 0.85; o[2] = ring.z + (o[2] - ring.z) * 0.85; o[1] += 0.008; }
            },
            slot, weight: legW, shade: ao,
        });
        if (s.bottom === 'slacks' || s.bottom === 'jeans') {
            // jeans narrow toward the ankle
            legLoft(s.bottom === 'jeans' ? body.leg.map(r => r.y < body.kneeY ? scaled(r, lerp(0.86, 1, r.y / body.kneeY)) : r) : body.leg, BOTTOM, true);
        } else if (s.bottom === 'shorts') {
            const hemY = body.kneeY + 0.1 * k, hem = ringAt(body.leg, hemY, R(0, 0, 0, 0));
            legLoft([...body.leg.filter(r => r.y > hemY + 0.02), R(hemY, hem.rx + 0.01, hem.f + 0.01, hem.b + 0.01, hem.z)], BOTTOM, true);
            legLoft(bareLeg(hemY + 0.04), LEGS, false);
        } else {
            legLoft(bareLeg(body.hipY + 0.02), LEGS, false);
        }
        // sock / ankle filling the gap between the hem and the shoe (or an ankle sock above a sneaker)
        const ax = legX(body.ankleY), trousers = s.bottom === 'slacks' || s.bottom === 'jeans';
        loft(B, { rows: 2, segs: 6, point: (r, t, o) => onRing(R(r ? (trousers ? 0.17 : 0.12) * k : 0.05, 0.038, 0.038, 0.041, 0.004), t, 2, o, ax), slot: SOCK, weight: fixed(shin), shade: () => (trousers ? 0.8 : 0.95) });
        // shoe: upper and a sole with a crisp edge
        const sole = s.shoe === 'sneaker' ? 0.9 : s.shoe === 'flat' ? 0.5 : 0.62;
        const shoe = body.shoe.map(([z, hw, cy, hh]) => s.shoe === 'sneaker' ? [z * 1.03, hw * 1.08, cy * 1.06, hh * 1.1] : s.shoe === 'flat' ? [z, hw * 0.94, cy * 0.82, hh * 0.78] : [z, hw, cy, hh]);
        loft(B, {
            rows: shoe.length, segs: 6,
            point: (r, t, o) => {
                const [z, hw, cy, hh] = shoe[r];
                o[0] = ax + hw * spow(Math.sin(t), 2.6);
                o[1] = Math.max(0, cy + hh * spow(Math.cos(t), 2.6));
                o[2] = z;
            },
            splits: [Math.PI - sole, Math.PI + sole],
            slot: t => Math.abs(t - Math.PI) < sole ? SOLE : SHOE,
            capStart: 0.012, capEnd: 0.02, capSlot: SHOE,
            weight: fixed(foot), shade: ao,
        });
    }
    if (skirt) {
        // follows the hips at the top and partly each thigh toward the hem, so knees stay inside
        const rings = s.bottom === 'pencil' ? body.pencil : body.skirt;
        const hemY = rings[rings.length - 1].y, topY = body.hipY + 0.02, share = s.bottom === 'pencil' ? 0.72 : 0.56;
        const last = rings.length - 1;
        loft(B, {
            rows: rings.length + 1, segs: 14,
            point: (r, t, o) => {
                const ring = rings[Math.min(r, last)];
                onRing(ring, t, 2.3, o);
                if (r > last) { o[0] *= 0.93; o[2] = ring.z + (o[2] - ring.z) * 0.93; o[1] += 0.01; }
            },
            slot: lowerSlot, shade: ao,
            weight: (p, w) => {
                const t = smooth(0, 1, (topY - p[1]) / (topY - hemY)) * share, l = smooth(0.05, -0.05, p[0]);
                if (t <= 0) set(w, HIPS, 1); else set(w, HIPS, 1 - t, THIGH_L, t * l, THIGH_R, t * (1 - l));
            },
        });
    }
    // Belt on the trousers' waistband
    if (s.tucked && (s.bottom === 'slacks' || s.bottom === 'jeans')) {
        const top = body.pelvis[0];
        const belt = [R(top.y - 0.04, top.rx + 0.005, top.f + 0.005, top.b + 0.005), R(top.y - 0.004, top.rx + 0.004, top.f + 0.004, top.b + 0.004)];
        loft(B, { rows: 2, segs: 12, point: (r, t, o) => onRing(belt[r], t, 2.4, o), slot: BELT, weight: fixed(HIPS) });
        const bz = -top.f - 0.012, by = top.y - 0.022;
        loft(B, { rows: 2, segs: 4, angles: BOX4,
            point: (r, t, o) => { o[0] = 0.021 * Math.sign(Math.sin(t)); o[1] = by + 0.015 * Math.sign(Math.cos(t)); o[2] = bz + (r ? 0.008 : 0.0); },
            slot: METAL, capStart: 0, weight: fixed(HIPS) });
    }

    // --- Arms: long sleeves to a cuff, or a short sleeve over a bare arm; then the hand
    const longSleeves = s.top === 'shirt' || s.top === 'blouse' || s.top === 'hoodie' || s.top === 'jacket';
    const sleeveLoose = s.top === 'hoodie' || s.top === 'jacket' ? 0.007 : 0;
    const armScale = body.upperArm / MALE.upperArm;
    for (const side of [-1, 1]) {
        const arm = side < 0 ? ARM_L : ARM_R, fore = side < 0 ? FORE_L : FORE_R;
        const a = body.armTilt;
        const sx = side * body.shoulderX, sy = body.shoulderY;
        const D: V3 = [side * Math.sin(a), -Math.cos(a), 0];          // down the arm
        const U: V3 = [side * Math.cos(a), Math.sin(a), 0];           // outward
        const along = (s: number, u: number, v: number, o: V3) => {   // v: toward the front (−Z)
            o[0] = sx + D[0] * s + U[0] * u; o[1] = sy + D[1] * s + U[1] * u; o[2] = -v;
        };
        const sOf = (p: V3) => (p[0] - sx) * D[0] + (p[1] - sy) * D[1];
        const elbow = body.upperArm;
        const armW = (p: V3, w: W) => blend(w, arm, fore, smooth(elbow - 0.045, elbow + 0.045, sOf(p)));
        const prof = body.arm, last = prof[prof.length - 1];
        const radAt = (q: number) => { let i = 0; while (i < prof.length - 2 && q > prof[i + 1][0]) i++; return lerp(prof[i][1], prof[i + 1][1], clamp((q - prof[i][0]) / (prof[i + 1][0] - prof[i][0]), 0, 1)); };
        const tube = (rows: [number, number][], slot: number, shade: (p: V3) => number, capStart?: number) => loft(B, {
            rows: rows.length, segs: 8,
            point: (r, t, o) => { const [q, rad] = rows[r]; along(q, rad * Math.sin(t), rad * Math.cos(t) * 1.02, o); },
            slot, capStart, weight: armW, shade,
        });
        if (longSleeves) {
            // sleeve + a cuff (a step out; ribbed on hoodies and jackets) + a lip inside
            const cuffR = last[1] + 0.005 + sleeveLoose;
            const rows: [number, number][] = [...prof.map(([q, r], i) => [q, i < 2 ? r : r + sleeveLoose] as [number, number]),
                [last[0] + 0.003, cuffR], [last[0] + 0.03, cuffR], [last[0] + 0.033, last[1] - 0.006]];
            const rib = sleeveLoose > 0;
            tube(rows, TOP, p => ao(p) * (rib && sOf(p) > last[0] ? 0.86 : 1), 0.006);
        } else {
            // short sleeve (a cap sleeve on a dress) with a hem, over a bare arm
            const end = (dress ? 0.07 : 0.15) * armScale;
            const endR = radAt(end) + 0.009;
            tube([...prof.filter(([q]) => q < end - 0.01).map(([q, r], i) => [q, i < 2 ? r : r + 0.006] as [number, number]), [end, endR], [end + 0.003, endR - 0.008]],
                TOP, ao, 0.006);
            tube([[0.0, prof[2][1] * 0.94], ...prof.filter(([q]) => q > 0.03).map(([q, r]) => [q, r * 0.92] as [number, number]), [last[0] + 0.004, last[1] * 0.8]], SKIN, () => 0.97);
        }
        // hand (palm facing the thigh), fingers slightly curled, and a thumb
        const hand = body.hand;
        loft(B, {
            rows: hand.length, segs: 6,
            point: (r, t, o) => { const [q, th, wd, curl] = hand[r]; along(q, th * Math.sin(t) - curl, wd * Math.cos(t), o); },
            slot: SKIN, capEnd: 0.008, weight: fixed(fore), shade: () => 0.97,
        });
        const h0 = hand[1], h1 = hand[2];
        const thumbRows: [number, number, number, number][] = [[h0[0] - 0.01, -0.006, h0[2] * 0.62, 0.011], [h1[0] + 0.005, -0.012, h1[2] * 1.02, 0.0095]];
        loft(B, {
            rows: 2, segs: 5,
            point: (r, t, o) => { const [q, u, v, rad] = thumbRows[r]; along(q + rad * 0.3 * Math.cos(t), u + rad * Math.sin(t), v + rad * 0.8 * Math.cos(t), o); },
            slot: SKIN, capEnd: 0.008, weight: fixed(fore), shade: () => 0.95,
        });
    }

    // --- Neck and head
    loft(B, {
        rows: body.neck.length, segs: 8, point: (r, t, o) => onRing(body.neck[r], t, 2, o), slot: SKIN,
        weight: (p, w) => blend(w, SPINE, HEAD, smooth(body.neck[0].y + 0.05, body.neck[2].y - 0.03, p[1])),
        shade: p => lerp(0.72, 0.95, smooth(body.neck[2].y, body.neck[0].y + 0.02, p[1])), // in the shadow of the jaw
    });
    const head = body.head;
    const eyeY = lerp(head[4].y, head[5].y, 0.08), faceS = body.face;
    loft(B, {
        rows: head.length, segs: 12, point: (r, t, o) => onRing(head[r], t, 2.25, o), slot: SKIN,
        capStart: 0.004, capEnd: 0.007, weight: fixed(HEAD),
        // eye sockets a little darker
        shade: p => (p[2] < -0.04 && Math.abs(p[0]) > 0.012 && Math.abs(p[0]) < 0.06 && Math.abs(p[1] - eyeY) < 0.02) ? 0.86 : 1,
    });
    // face front surface at (x, y), using the same superellipse
    const faceZ = (x: number, y: number) => {
        const r = ringAt(head, y, tmpRing);
        const st = Math.pow(clamp(Math.abs(x) / r.rx, 0, 1), 2.25 / 2);
        return r.z - r.f * Math.pow(Math.max(0, 1 - st * st), 1 / 2.25);
    };
    const W_HEAD = only(HEAD);
    for (const side of [-1, 1]) {
        // eye white, iris, brow
        const ex = side * 0.031 * faceS, ez = faceZ(ex, eyeY);
        const eyeN: V3 = [side * 0.25, 0.04, -1];
        const nl = Math.hypot(...eyeN); eyeN[0] /= nl; eyeN[1] /= nl; eyeN[2] /= nl;
        lens(B, [ex, eyeY, ez + 0.002], [1, 0, 0], [0, 1, 0], eyeN, 0.0135 * faceS * (F ? 1.06 : 1), 0.0062 * faceS * (F ? 1.1 : 1), 0.0045, 0.002, 8, EYE, 1, W_HEAD, 0.82);
        lens(B, [ex + eyeN[0] * 0.0038, eyeY + 0.0004, ez + 0.002 + eyeN[2] * 0.0038], [1, 0, 0], [0, 1, 0], eyeN, 0.0058 * faceS, 0.0058 * faceS, 0.0016, 0.0005, 6, IRIS, 1, W_HEAD);
        if (F) // lash line
            lens(B, [ex, eyeY + 0.0062, ez + 0.0005], [1, 0, 0], [0, 1, 0], eyeN, 0.0148 * faceS, 0.0018, 0.0042, 0.001, 6, BROW, 0.7, W_HEAD);
        const by = eyeY + 0.022 * faceS;
        const brow: V3[] = [[0.012, by - 0.001, 0], [0.032, by + (F ? 0.006 : 0.003), 0], [0.052, by - (F ? 0.002 : 0.004), 0]];
        loft(B, {
            rows: 3, segs: 4, angles: BOX4,
            point: (r, t, o) => {
                const [bx, yy] = brow[r]; const x = side * bx * faceS;
                o[0] = x; o[1] = yy + Math.sign(Math.cos(t)) * (F ? 0.0022 : 0.0035) * (r === 1 ? 1 : 0.8);
                o[2] = faceZ(x, yy) - 0.002 - (Math.sin(t) > 0 ? 0.004 : 0);
            },
            slot: BROW, capStart: 0, capEnd: 0, weight: fixed(HEAD),
        });
        // ear
        const er = ringAt(head, eyeY - 0.012, tmpRing);
        lens(B, [side * (er.rx + 0.006), eyeY - 0.012, 0.014], [0, 0, 1], [0, 1, 0], [side, 0, 0], 0.017 * faceS, 0.03 * faceS, 0.007, 0.004, 8, SKIN, 0.93, W_HEAD);
    }
    // nose (flat-shaded wedge)
    {
        const sc = faceS * (F ? 0.9 : 1);
        const topY = eyeY + 0.012, baseY = eyeY - 0.044 * sc, tipY = baseY + 0.008;
        const zf = (x: number, y: number) => faceZ(x, y) + 0.004;
        const B0: V3 = [0, topY, zf(0, topY) - 0.002], T: V3 = [0, tipY, zf(0, tipY) - 0.019 * sc];
        const L: V3 = [-0.017 * sc, baseY, zf(0.017 * sc, baseY) - 0.004], Rr: V3 = [0.017 * sc, baseY, zf(0.017 * sc, baseY) - 0.004];
        const N: V3 = [0, baseY - 0.002, zf(0, baseY) - 0.01 * sc];
        const SL: V3 = [-0.011 * sc, eyeY - 0.012, zf(0.011, eyeY - 0.012) - 0.003], SR: V3 = [0.011 * sc, eyeY - 0.012, zf(0.011, eyeY - 0.012) - 0.003];
        facets(B, [[B0, SL, T], [B0, T, SR], [SL, L, T], [SR, T, Rr], [L, N, T], [Rr, T, N], [L, Rr, N]], [0, eyeY - 0.02, zf(0, eyeY) + 0.03], SKIN, 0.94, W_HEAD);
    }
    // lips
    const my = eyeY - 0.068 * faceS, mz = faceZ(0, my);
    lens(B, [0, my, mz + 0.003], [1, 0, 0], [0, 1, 0], [0, 0.1, -1], 0.023 * faceS, (F ? 0.0068 : 0.0055) * faceS, 0.0045, 0.002, 8, LIPS, 1, W_HEAD, 0.85);

    // --- Hair
    const crown = head[head.length - 1];
    const topY = crown.y + 0.007;
    const O: V3 = [0, lerp(head[0].y, topY, 0.55), 0.004];
    let widest = 0; head.forEach((r, i) => { if (r.rx > head[widest].rx) widest = i; });
    // Meridian of the head at angle theta from height y0 to the crown, resampled by arc length
    // (`straightBelow`: below the head's widest point hair falls straight down instead of following the jaw)
    const meridian = (theta: number, y0: number, fractions: number[], straightBelow: boolean): V3[] => {
        const pts: V3[] = [];
        const ys = [y0, ...head.map(r => r.y).filter(y => y > y0 + 0.002)];
        for (const y of ys) {
            const ring = y < head[widest].y && straightBelow ? { ...head[widest], y } : ringAt(head, Math.max(y, head[0].y), { ...tmpRing });
            pts.push(onRing(ring, theta, 2.25, [0, 0, 0]));
        }
        pts.push([0, topY, crown.z]);
        const len: number[] = [0];
        for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
        const total = len[len.length - 1];
        return fractions.map(f => {
            const d = f * total; let i = 1;
            while (i < len.length - 1 && len[i] < d) i++;
            const t = (d - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]);
            return [lerp(pts[i - 1][0], pts[i][0], t), lerp(pts[i - 1][1], pts[i][1], t), lerp(pts[i - 1][2], pts[i][2], t)];
        });
    };
    const hs = (head[5].y - head[0].y) / (MALE.head[5].y - MALE.head[0].y); // head size
    const keyY = (keys: [number, number][], theta: number) => {
        const t = Math.abs(((theta + Math.PI) % TAU + TAU) % TAU - Math.PI); // 0..π, symmetric
        let i = 0; while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
        const [a0, v0] = keys[i], [a1, v1] = keys[i + 1];
        return head[0].y + lerp(v0, v1, smooth(0, 1, (t - a0) / (a1 - a0))) * hs;
    };
    // A shell of hair over the head from a hairline up to the crown (or, for a balding head, a band)
    const cap = (keys: [number, number][], o: { angles: number[]; edge?: number; thick: number; grow: number; quiff?: number; straight?: boolean; fall?: number; curls?: number; band?: number; arc?: [number, number] }) => {
        const fr = [0, 0.09, 0.3, 0.55, 0.78, 0.94].map(f => f * (o.band ?? 1));
        const merid = new Map<number, V3[]>();
        loft(B, {
            rows: fr.length, angles: o.angles, arc: o.arc,
            point: (r, t, out) => {
                let m = merid.get(t);
                if (!m) { m = meridian(t, keyY(keys, t), fr, !!o.straight); merid.set(t, m); }
                const p = m[r], f = fr[r] / (o.band ?? 1);
                // thickness: tapering to nothing at the hairline, fuller on top; hair below the head's
                // widest point falls away from the face
                let th = lerp(o.edge ?? 0.0015, o.thick + o.grow * f, smooth(0, 0.3, f));
                th += (o.quiff ?? 0) * Math.max(0, Math.cos(t)) * smooth(0.3, 0.75, f);
                if (o.curls) th += o.curls * (hash2(t * 3.1, r * 1.7) - 0.35) * smooth(0, 0.2, f);
                const below = o.straight ? Math.max(0, head[widest].y - p[1]) : 0;
                th += below * (o.fall ?? 0.3);
                const dx = p[0] - O[0], dy = Math.max(0, p[1] - O[1]) * 0.6, dz = p[2] - O[2];
                const l = Math.hypot(dx, dy, dz) || 1;
                out[0] = p[0] + dx / l * th; out[1] = p[1] + dy / l * th + (r === 0 ? 0.002 : 0); out[2] = p[2] + dz / l * th + below * 0.35;
            },
            slot: HAIR, capEnd: o.band ? undefined : 0.004, weight: fixed(HEAD), shade: p => lerp(0.82, 1.06, smooth(head[2].y, topY, p[1])),
        });
    };
    const backZ = (y: number) => { const r = ringAt(head, y, tmpRing2); return r.z + r.b; };
    switch (s.hairStyle) {
        case 'short': cap(KEYS_SHORT, { angles: ANGLES_SHORT, thick: 0.007, grow: 0.008, quiff: 0.007 }); break;
        case 'buzz': cap(KEYS_SHORT, { angles: ANGLES_SHORT, edge: 0.001, thick: 0.0028, grow: 0.0015 }); break;
        case 'bald': cap(KEYS_SHORT, { angles: ANGLES_SHORT, edge: 0.001, thick: 0.004, grow: 0, band: 0.42, arc: [1.05, TAU - 1.05] }); break;
        case 'curly':
            if (F) cap(KEYS_BOB, { angles: ANGLES_LONG, thick: 0.02, grow: 0.012, straight: true, fall: 0.4, curls: 0.014 });
            else cap(KEYS_CURLY, { angles: ANGLES_SHORT, thick: 0.015, grow: 0.01, curls: 0.012 });
            break;
        case 'bob': cap(KEYS_BOB, { angles: ANGLES_LONG, thick: 0.011, grow: 0.008, straight: true, fall: 0.45 }); break;
        case 'long': cap(KEYS_LONG, { angles: ANGLES_LONG, thick: 0.011, grow: 0.008, straight: true }); break;
        case 'ponytail': case 'bun': cap(KEYS_BACK, { angles: ANGLES_SHORT, thick: 0.0045, grow: 0.004 }); break;
    }
    if (s.hairStyle === 'long') {
        // hair falling behind the shoulders
        const nk = body.neck;
        const hy = head[3].y, ly = nk[0].y - 0.12;
        const rows = [R(hy, 0.084, 0.04, 0.05, 0.055), R(lerp(hy, ly, 0.3), 0.096, 0.036, 0.05, 0.062), R(lerp(hy, ly, 0.65), 0.104, 0.03, 0.046, 0.074),
            R(ly + 0.03, 0.1, 0.026, 0.04, 0.086), R(ly, 0.08, 0.018, 0.026, 0.09)];
        loft(B, {
            rows: rows.length, segs: 8, point: (r, t, o) => onRing(rows[r], t, 2.6, o), slot: HAIR, capEnd: 0.008,
            weight: (p, w) => blend(w, SPINE, HEAD, smooth(nk[0].y + 0.02, head[2].y, p[1])),
            shade: p => lerp(0.75, 0.95, smooth(ly, hy, p[1])),
        });
    } else if (s.hairStyle === 'ponytail') {
        // a tail from the back of the head, hanging down and away
        const y0 = eyeY + 0.03 * hs, z0 = backZ(y0) - 0.012;
        const pts: V3[] = [[0, y0, z0], [0, y0 - 0.04, z0 + 0.045], [0, y0 - 0.12, z0 + 0.06], [0, y0 - 0.2, z0 + 0.05], [0, y0 - 0.25, z0 + 0.035]];
        const radii = [0.022, 0.026, 0.022, 0.015, 0.006];
        loft(B, {
            rows: pts.length, segs: 6,
            point: (r, t, o) => {
                const a = pts[Math.max(0, r - 1)], b = pts[Math.min(pts.length - 1, r + 1)];
                const dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dy, dz) || 1;
                // ring perpendicular to the tail (which runs in the y-z plane): x across, and the in-plane normal
                const ny = -dz / l, nz = dy / l;
                o[0] = radii[r] * Math.sin(t) * 1.15; o[1] = pts[r][1] + ny * radii[r] * Math.cos(t); o[2] = pts[r][2] + nz * radii[r] * Math.cos(t);
            },
            slot: HAIR, capEnd: 0.004, weight: fixed(HEAD), shade: () => 0.92,
        });
    } else if (s.hairStyle === 'bun') {
        const y0 = eyeY + 0.06 * hs, z0 = backZ(y0);
        const n: V3 = [0, 0.35, 0.94];
        lens(B, [0, y0, z0 + 0.012], [1, 0, 0], [0, 0.94, -0.35], n, 0.034 * hs, 0.031 * hs, 0.03 * hs, 0.012, 8, HAIR, 0.95, W_HEAD);
    }
    if (s.beard) {
        // a short beard on the jaw and chin, and a moustache
        const angles = [-1.45, -1.2, -0.9, -0.55, -0.25, 0, 0.25, 0.55, 0.9, 1.2, 1.45];
        const topAt = (t: number) => lerp(my - 0.008, lerp(head[3].y, head[4].y, 0.3), smooth(0.5, 1.4, Math.abs(t)));
        const yLow = head[0].y + 0.004;
        loft(B, {
            rows: 4, angles, arc: [-1.45, 1.45],
            point: (r, t, o) => {
                const y = lerp(yLow, topAt(t), r / 3);
                onRing(ringAt(head, y, tmpRing), t, 2.25, o);
                const th = r === 3 ? 0.001 : 0.0055;
                const dx = o[0], dz = o[2] - (head[2].z + 0.01), l = Math.hypot(dx, dz) || 1;
                o[0] += dx / l * th; o[2] += dz / l * th; o[1] -= r === 0 ? 0.006 : 0;
            },
            slot: HAIR, weight: fixed(HEAD), shade: () => 0.9,
        });
        lens(B, [0, my + 0.0085, mz - 0.0005], [1, 0, 0], [0, 1, 0], [0, 0.15, -1], 0.024 * faceS, 0.0055, 0.0045, 0.002, 8, HAIR, 0.9, W_HEAD);
    }

    // --- Collars, ties and other details on the torso front
    const n0 = body.neck[0], top = torso[torso.length - 1];
    const torsoZ = (x: number, y: number) => {
        const r = ringAt(torso, y, tmpRing);
        const u = Math.min(0.999, Math.abs(x) / r.rx);
        return r.z - r.f * Math.pow(1 - Math.pow(u, 2.4), 1 / 2.4);
    };
    const torsoFront = (y: number) => torsoZ(0, y);
    // heights from y0 down to y1 that include every torso ring in between, so strips lying on the
    // front (tie, zip, necklines) bend exactly where the torso does
    const frontRows = (y0: number, y1: number) => [y0, ...torso.map(r => r.y).filter(y => y < y0 - 0.01 && y > y1 + 0.01).sort((a, b) => b - a), y1];
    // A thin patch lying on the torso front, centred on x = cx, between heights y0 > y1
    const patch = (y0: number, y1: number, hw: (y: number) => number, slot: number, shade: number, lift: number, cx = 0) => {
        B.begin();
        const rows = frontRows(y0, y1).map(y => [-1, 0, 1].map(j => {
            const x = cx + j * hw(y), p: V3 = [x, y, torsoZ(x, y) - lift];
            torsoW(p, tmpW);
            return B.v(p, slot, shade, tmpW);
        }));
        for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < 2; j++) {
            B.tri(rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], 0, 0, -1);
            B.tri(rows[i][j], rows[i + 1][j + 1], rows[i + 1][j], 0, 0, -1);
        }
    };
    const collar = (gap: number, rise: number, out: number, slot: number, shade = 1) => {
        const cRows = [R(top.y - 0.008, top.rx + 0.004, top.f + 0.004, top.b + 0.002, top.z), R(top.y + rise, n0.rx + out, n0.f + out, n0.b + out * 0.8, n0.z - 0.007),
            R(top.y + rise - 0.006, n0.rx + out - 0.007, n0.f + out - 0.007, n0.b + out * 0.8 - 0.006, n0.z - 0.007)];
        loft(B, { rows: 3, segs: 12, arc: [gap, TAU - gap], point: (r, t, o) => onRing(cRows[r], t, 2.2, o), slot, weight: fixed(SPINE), shade: () => shade });
    };
    const collarPoints = (spread: number) => {
        for (const side of [-1, 1]) {
            const y0 = top.y + 0.03, y1 = top.y - 0.035;
            const a: V3 = [side * spread, y0, torsoFront(top.y) - 0.012], b: V3 = [side * (spread + 0.032), y0 - 0.01, torsoFront(top.y) + 0.002], c: V3 = [side * (spread + 0.018), y1, torsoFront(y1) - 0.005];
            facets(B, [[a, b, c]], [side * 0.03, y1, 0.05], TOP, 0.97, only(SPINE));
        }
    };
    if (s.top === 'shirt' || s.top === 'blouse') {
        const open = s.top === 'blouse' || !s.tie;
        collar(s.top === 'blouse' ? 0.55 : s.tie ? 0.3 : 0.42, 0.04, 0.011, TOP);
        collarPoints(s.top === 'blouse' ? 0.03 : s.tie ? 0.018 : 0.024);
        if (open) {
            // open neck: a V of skin
            const depth = s.top === 'blouse' ? 0.085 : 0.045, w0 = s.top === 'blouse' ? 0.034 : 0.021;
            patch(top.y + 0.004, top.y - depth * k, y => w0 * clamp((y - (top.y - depth * k)) / (depth * k + 0.004), 0, 1), SKIN, 0.92, 0.0012);
        } else {
            // tie: knot and blade following the shirt front
            const ky = top.y + 0.006, kz = torsoFront(top.y) - 0.016;
            loft(B, {
                rows: 2, segs: 4, angles: BOX4,
                point: (r, t, o) => { const w = r ? 0.017 : 0.011; o[0] = w * Math.sign(Math.sin(t)); o[1] = ky + (r ? 0.016 : -0.016); o[2] = kz + (Math.cos(t) > 0 ? -0.008 : 0.008); },
                slot: ACCENT, capStart: 0, capEnd: 0, weight: fixed(SPINE),
            });
            const tieTop = top.y - 0.012, tieEnd = body.pelvis[0].y + 0.012;
            const tieY = frontRows(tieTop, tieEnd);
            const tieW = (y: number) => lerp(0.011, 0.037, Math.pow((tieTop - y) / (tieTop - tieEnd), 0.8));
            loft(B, {
                rows: tieY.length, segs: 4, angles: BOX4,
                point: (r, t, o) => { o[0] = tieW(tieY[r]) * Math.sign(Math.sin(t)); o[1] = tieY[r]; o[2] = torsoFront(tieY[r]) - 0.0035 + (Math.cos(t) > 0 ? -0.004 : 0.0); },
                slot: ACCENT, capStart: 0, capEnd: 0.03, weight: torsoW, shade: () => 1,
            });
        }
    } else if (s.top === 'polo') {
        collar(0.42, 0.026, 0.016, TOP, 0.94);
        collarPoints(0.026);
        patch(top.y - 0.004, top.y - 0.11 * k, () => 0.014, TOP, 0.9, 0.0015);
        for (const by of [top.y - 0.04 * k, top.y - 0.085 * k]) lens(B, [0, by, torsoFront(by) - 0.003], [1, 0, 0], [0, 1, 0], [0, 0, -1], 0.0045, 0.0045, 0.002, 0.001, 6, INNER, 1, only(SPINE));
    } else if (s.top === 'tee') {
        const tee = [R(top.y - 0.008, n0.rx + 0.016, n0.f + 0.016, n0.b + 0.013, n0.z - 0.004), R(top.y + 0.012, n0.rx + 0.007, n0.f + 0.007, n0.b + 0.006, n0.z - 0.004)];
        loft(B, { rows: 2, segs: 12, point: (r, t, o) => onRing(tee[r], t, 2.2, o), slot: TOP, weight: fixed(SPINE), shade: () => 0.85 });
    } else if (s.top === 'hoodie') {
        // the hood lying on the shoulders and upper back, drawstrings and a front pocket
        const hood = [R(top.y - 0.025, n0.rx + 0.075, n0.f + 0.055, n0.b + 0.07, n0.z), R(top.y + 0.03, n0.rx + 0.058, n0.f + 0.042, n0.b + 0.075, n0.z),
            R(top.y + 0.058, n0.rx + 0.03, n0.f + 0.025, n0.b + 0.05, n0.z), R(top.y + 0.046, n0.rx + 0.014, n0.f + 0.012, n0.b + 0.02, n0.z)];
        loft(B, {
            rows: hood.length, segs: 12, arc: [0.85, TAU - 0.85],
            point: (r, t, o) => { onRing(hood[r], t, 2.2, o); if (r === 0) o[1] -= 0.09 * Math.pow(Math.max(0, -Math.cos(t)), 1.5) * k; },
            slot: TOP, weight: fixed(SPINE), shade: () => 0.9,
        });
        for (const side of [-1, 1]) patch(top.y - 0.006, top.y - 0.15 * k, () => 0.0035, ACCENT, 0.95, 0.002, side * 0.03);
        const p0 = body.hemY + 0.15 * k, p1 = body.hemY + 0.045 * k;
        patch(p0, p1, y => lerp(0.11, 0.085, (y - p1) / (p0 - p1)), TOP, 0.88, 0.004);
    } else if (s.top === 'jacket') {
        // tee neckline, the jacket's collar (open at the front) and the zip
        const tee = [R(top.y - 0.01, n0.rx + 0.014, n0.f + 0.014, n0.b + 0.012, n0.z - 0.004), R(top.y + 0.012, n0.rx + 0.006, n0.f + 0.006, n0.b + 0.006, n0.z - 0.004)];
        loft(B, { rows: 2, segs: 12, point: (r, t, o) => onRing(tee[r], t, 2.2, o), slot: INNER, weight: fixed(SPINE) });
        const cRows = [R(top.y - 0.012, top.rx + 0.008, top.f + 0.01, top.b + 0.006, top.z), R(top.y + 0.05, n0.rx + 0.028, n0.f + 0.03, n0.b + 0.022, n0.z - 0.004),
            R(top.y + 0.045, n0.rx + 0.02, n0.f + 0.022, n0.b + 0.015, n0.z - 0.004)];
        loft(B, { rows: 3, segs: 12, arc: [0.55, TAU - 0.55], point: (r, t, o) => onRing(cRows[r], t, 2.2, o), slot: TOP, weight: fixed(SPINE), shade: () => 0.95 });
        const zy = frontRows(top.y - 0.03, torso[1].y);
        loft(B, {
            rows: zy.length, angles: [], arc: [-Math.PI / 2, Math.PI / 2], out: [0, 0, -1],
            point: (r, t, o) => { o[0] = 0.0032 * Math.sin(t); o[1] = zy[r]; o[2] = torsoFront(zy[r]) - 0.0016; },
            slot: ACCENT, weight: torsoW,
        });
    } else if (s.top === 'dress') {
        // scoop neckline
        const depth = 0.07 * k;
        patch(top.y + 0.004, top.y - depth, y => 0.056 * Math.sqrt(clamp((y - (top.y - depth)) / (depth + 0.004), 0, 1)), SKIN, 0.92, 0.0012);
    }
}

// ---- Shared templates (geometry per body shape) and the shared material -----------------

interface Template {
    position: THREE.BufferAttribute; normal: THREE.BufferAttribute; skinIndex: THREE.BufferAttribute; skinWeight: THREE.BufferAttribute;
    index: THREE.BufferAttribute; slot: Uint8Array; shade: Float32Array; body: Body; refs: number; triangles: number; key: string;
}
const templates = new Map<string, Template>();
const SHARED = ['position', 'normal', 'skinIndex', 'skinWeight'] as const;

function templateFor(look: Look): Template {
    const key = shapeKey(look);
    let t = templates.get(key);
    if (t) return t;
    const body = bodyFor(look.female, look.build);
    const B = new Builder();
    buildBody(B, body, look);
    const n = B.pos.length / 3;
    t = {
        position: new THREE.Float32BufferAttribute(B.pos, 3),
        normal: new THREE.BufferAttribute(B.normals(), 3),
        skinIndex: new THREE.Uint8BufferAttribute(B.bone, 4),
        skinWeight: new THREE.Float32BufferAttribute(B.wgt, 4),
        index: new THREE.Uint16BufferAttribute(B.idx, 1),
        slot: Uint8Array.from(B.slot), shade: Float32Array.from(B.shade),
        body, refs: 0, triangles: B.idx.length / 3, key,
    };
    if (n > 65535) throw new Error('character mesh too large');
    templates.set(key, t);
    return t;
}

let material: THREE.MeshStandardMaterial | null = null;
const peopleMaterial = () => material ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0 });

/** Free the shared material, blob texture and body templates (call on unmount, after disposing every Character). */
export function disposeCharacterAssets() {
    material?.dispose();
    material = null;
    blobTexture?.dispose();
    blobTexture = null;
    templates.clear();
}

// ---- Gait curves -------------------------------------------------------------------------
// Joint angles over one stride (phase 0 = this leg's foot strike), radians.
// Hip: + swings the leg forward. Knee: − bends it. Foot: the sole's pitch in the
// world, + = toes up (the ankle angle is worked out from it).

const SAMPLES = 64;
const curve = (keys: [number, number][]) => {
    const out = new Float32Array(SAMPLES);
    const n = keys.length;
    for (let i = 0; i < SAMPLES; i++) {
        const p = i / SAMPLES;
        let k = 0; while (k < n - 1 && keys[k + 1][0] <= p) k++;
        // Catmull-Rom through the (periodic) keys
        const k0 = (k - 1 + n) % n, k1 = k, k2 = (k + 1) % n, k3 = (k + 2) % n;
        const x1 = keys[k1][0], x2 = k2 > k1 ? keys[k2][0] : keys[k2][0] + 1;
        const u = (p - x1) / (x2 - x1);
        const v0 = keys[k0][1], v1 = keys[k1][1], v2 = keys[k2][1], v3 = keys[k3][1];
        out[i] = 0.5 * (2 * v1 + (-v0 + v2) * u + (2 * v0 - 5 * v1 + 4 * v2 - v3) * u * u + (-v0 + 3 * v1 - 3 * v2 + v3) * u * u * u);
    }
    return out;
};
const sample = (c: Float32Array, p: number) => {
    const x = p * SAMPLES, i = Math.floor(x), f = x - i;
    return c[i % SAMPLES] * (1 - f) + c[(i + 1) % SAMPLES] * f;
};
const WALK_HIP = curve([[0, 0.4], [0.15, 0.3], [0.3, 0.08], [0.5, -0.24], [0.6, -0.28], [0.75, 0.04], [0.88, 0.36], [0.95, 0.42]]);
const WALK_KNEE = curve([[0, -0.06], [0.12, -0.26], [0.3, -0.1], [0.45, -0.1], [0.6, -0.62], [0.72, -1.05], [0.85, -0.5], [0.95, -0.08]]);
const WALK_FOOT = curve([[0, 0.26], [0.08, 0.04], [0.14, 0], [0.4, 0], [0.5, -0.18], [0.6, -0.6], [0.7, -0.4], [0.8, -0.05], [0.92, 0.2]]);
const RUN_HIP = curve([[0, 0.48], [0.15, 0.08], [0.28, -0.36], [0.38, -0.42], [0.55, -0.02], [0.7, 0.55], [0.82, 0.78], [0.92, 0.64]]);
const RUN_KNEE = curve([[0, -0.3], [0.12, -0.55], [0.28, -0.3], [0.42, -1.3], [0.56, -2.0], [0.7, -1.55], [0.85, -0.6], [0.95, -0.32]]);
const RUN_FOOT = curve([[0, 0.12], [0.06, 0], [0.16, 0], [0.28, -0.8], [0.38, -0.85], [0.55, -0.5], [0.75, -0.1], [0.92, 0.16]]);

/** How far below the hip joint the lowest point of the sole is, for the leg's hip, knee and foot angles. */
const legDrop = (body: Body, H: number, K: number, Fp: number) => {
    const ha = body.ankleY, cf = Math.cos(Fp), sf = Math.sin(Fp);
    return (body.hipY - body.kneeY) * Math.cos(H) + (body.kneeY - body.ankleY) * Math.cos(H + K)
        + Math.max(ha * cf + body.heel * sf, ha * cf - body.toe * sf);
};

// ---- A person ------------------------------------------------------------------------------

const tmpColor = new THREE.Color();

export class Character {
    /** Add this to the scene (or a group that moves the person). Faces −Z, feet at y = 0. */
    readonly root = new THREE.Group();
    readonly mesh: THREE.SkinnedMesh;
    private readonly tpl: Template;
    private readonly b: THREE.Bone[];
    private readonly body: Body;
    private readonly scale: number;
    // animation state
    private phase: number;
    private time: number;
    private move = 0;   // 0 = standing, 1 = walking/running
    private speed = 0;  // smoothed, model metres per second
    private readonly rnd: number;
    private readonly senior: number; // 1 = a slight stoop and shorter, quicker steps

    constructor(look: Look, seed: string | number = 0) {
        const tpl = this.tpl = templateFor(look);
        tpl.refs++;
        const body = this.body = tpl.body;
        const h = hashSeed(seed);
        this.rnd = (h % 1000) / 1000;
        this.senior = look.age === 'senior' ? 1 : 0;
        this.phase = this.rnd;
        this.time = this.rnd * 50;

        // geometry: shared shape + this person's colours
        const geo = new THREE.BufferGeometry();
        for (const name of SHARED) geo.setAttribute(name, tpl[name]);
        geo.setIndex(tpl.index);
        const palette = new Float32Array(SLOTS * 3);
        const put = (slot: number, hex: string) => { tmpColor.set(hex); palette[slot * 3] = tmpColor.r; palette[slot * 3 + 1] = tmpColor.g; palette[slot * 3 + 2] = tmpColor.b; };
        put(SKIN, look.skin); put(HAIR, look.hair); put(EYE, '#e9e5dc'); put(IRIS, look.eyes); put(LIPS, look.lips);
        tmpColor.set(look.hair).multiplyScalar(0.75); palette[BROW * 3] = tmpColor.r; palette[BROW * 3 + 1] = tmpColor.g; palette[BROW * 3 + 2] = tmpColor.b;
        put(TOP, look.topColor); put(INNER, look.innerColor); put(ACCENT, look.accentColor); put(BOTTOM, look.bottomColor); put(BELT, look.beltColor);
        put(METAL, '#b9bcc0'); put(SHOE, look.shoeColor); put(SOLE, look.soleColor); put(SOCK, look.sockColor); put(LEGS, look.legColor);
        const n = tpl.slot.length, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const s = tpl.slot[i] * 3, k = tpl.shade[i];
            col[i * 3] = palette[s] * k; col[i * 3 + 1] = palette[s + 1] * k; col[i * 3 + 2] = palette[s + 2] * k;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

        // skeleton in the bind pose (model space, metres)
        const bone = (x: number, y: number, z: number, parent?: THREE.Bone) => {
            const bn = new THREE.Bone(); bn.position.set(x, y, z); parent?.add(bn); return bn;
        };
        const hips = bone(0, body.pelvisY, 0);
        const spine = bone(0, body.spineY - body.pelvisY, 0, hips);
        const head = bone(0, body.headY - body.spineY, body.headZ, spine);
        const arm = (side: number) => bone(side * body.shoulderX, body.shoulderY - body.spineY, 0, spine);
        const armL = arm(-1), armR = arm(1);
        const fore = (side: number, p: THREE.Bone) => bone(side * Math.sin(body.armTilt) * body.upperArm, -Math.cos(body.armTilt) * body.upperArm, 0, p);
        const foreL = fore(-1, armL), foreR = fore(1, armR);
        const thigh = (side: number) => bone(side * body.hipX, body.hipY - body.pelvisY, 0, hips);
        const thighL = thigh(-1), thighR = thigh(1);
        const shinL = bone(0, body.kneeY - body.hipY, 0, thighL), shinR = bone(0, body.kneeY - body.hipY, 0, thighR);
        const footL = bone(0, body.ankleY - body.kneeY, 0, shinL), footR = bone(0, body.ankleY - body.kneeY, 0, shinR);
        this.b = [hips, spine, head, armL, foreL, armR, foreR, thighL, shinL, footL, thighR, shinR, footR];

        const mesh = this.mesh = new THREE.SkinnedMesh(geo, peopleMaterial());
        mesh.add(hips);
        mesh.bind(new THREE.Skeleton(this.b));
        // fixed bounds covering every pose (skips three.js skinning every vertex on the CPU to find them)
        mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.3);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.root.add(mesh);
        this.scale = UNITS_PER_METRE * look.height / (look.female ? 1.66 : 1.76);
        this.root.scale.setScalar(this.scale);
        this.root.position.y = GROUND_TOP;
        this.root.userData.character = this;
        this.update(0.016, 0);
    }

    /** Triangles in one person (for measurements). */
    get triangles() { return this.tpl.triangles; }
    /** 0 standing … 1 walking or running (for the size of a blob shadow). */
    get moving() { return this.move; }
    /** World units per model metre (the person's size). */
    get size() { return this.scale; }

    /**
     * Pose for this frame. `speed`: world units per second along the person's facing
     * (negative = backing up); `turn`: turning rate (rad/s) — stepping on the spot.
     */
    update(dt: number, speed: number, turn = 0) {
        if (!(dt > 0)) return;
        const body = this.body, b = this.b;
        this.time += dt;
        let v = speed / this.scale; // model metres per second
        if (!Number.isFinite(v)) v = 0;
        v = clamp(v, -12, 12);
        let av = Math.abs(v);
        if (av < 0.3 && turn !== 0) av = Math.min(0.9, Math.abs(turn) * 0.3); // small steps while turning on the spot
        const dir = v < -0.05 ? -1 : 1;
        this.speed += (av - this.speed) * (1 - Math.exp(-dt / 0.12));
        const moving = av > 0.2 ? 1 : 0;
        this.move += (moving - this.move) * (1 - Math.exp(-dt / (moving ? 0.1 : 0.16)));
        const m = this.move, vs = Math.max(this.speed, 0.05);

        // Gait: walk below ~2.3 m/s, run above ~3.3 m/s; cadence and stride from the speed
        const run = smooth(2.3, 3.3, vs);
        const cadence = lerp(1.5 + 0.28 * vs, 2.6 + 0.09 * vs, run) * (1 + 0.1 * this.senior); // steps per second
        this.phase = (this.phase + dir * cadence * 0.5 * dt + 1) % 1;
        const step = vs / cadence;
        const ampW = clamp(step / 0.72, 0.3, 1.35), ampR = clamp(step / 1.38, 0.75, 1.15);

        // Idle: breathing, a slow weight shift from foot to foot, looking around
        const t = this.time, r = this.rnd;
        const breath = Math.sin(t * 1.5 + r * 6);
        const shift = Math.sin(t * 0.55 + r * 9) * 0.8 + Math.sin(t * 0.23 + r * 3) * 0.2; // + = weight on the left foot
        const lookYaw = 0.32 * Math.sin(t * 0.21 + r * 5) * Math.sin(t * 0.47 + r * 2);
        const lookPitch = -0.04 + 0.04 * Math.sin(t * 0.33 + r * 7);

        // Legs
        let hipL = 0, kneeL = 0, footL = 0, hipR = 0, kneeR = 0, footR = 0;
        for (let leg = 0; leg < 2; leg++) {
            const p = leg === 0 ? this.phase : (this.phase + 0.5) % 1;
            const gh = lerp(sample(WALK_HIP, p) * ampW, sample(RUN_HIP, p) * ampR, run);
            const gk = lerp(sample(WALK_KNEE, p) * Math.min(1, 0.25 + ampW), sample(RUN_KNEE, p), run);
            const gf = lerp(sample(WALK_FOOT, p) * Math.min(1, 0.3 + 0.8 * ampW), sample(RUN_FOOT, p), run);
            const relaxed = Math.max(0, leg === 0 ? -shift : shift); // this leg carries less weight
            const ih = 0.05 * relaxed + 0.03 * this.senior, ik = -0.14 * relaxed - 0.06 * this.senior;
            const H = lerp(ih, gh, m), K = lerp(ik, gk, m), Fp = lerp(0, gf, m);
            if (leg === 0) { hipL = H; kneeL = K; footL = Fp; } else { hipR = H; kneeR = K; footR = Fp; }
        }
        const pL = TAU * this.phase, cL = Math.cos(pL), sL = Math.sin(pL);

        // Pelvis and spine
        const hipsYaw = m * lerp(-0.08 * ampW, -0.11, run) * cL;
        const spineYaw = m * lerp(0.13 * ampW, 0.2, run) * cL;
        const hipsRoll = lerp(-0.03 * shift, -0.035 * sL * (1 - run), m);
        const sway = lerp(-0.022 * shift, -0.016 * sL * (1 - run), m);
        const hipsPitch = m * lerp(0, -0.05, run);
        const spinePitch = m * lerp(-0.03, -0.1, run) - 0.008 * breath * (1 - m) - 0.07 * this.senior;
        const spineRoll = 0.02 * shift * (1 - m);

        // Feet on the ground: lift the hips until the lower foot touches it
        const rollLift = body.hipX * Math.sin(hipsRoll);
        let hipJoint = Math.max(legDrop(body, hipL, kneeL, footL) + rollLift, legDrop(body, hipR, kneeR, footR) - rollLift);
        // flight phase of a run
        const q = this.phase % 0.5;
        hipJoint += m * run * 0.045 * (q > 0.3 ? Math.sin(Math.PI * (q - 0.3) / 0.2) : 0);

        b[HIPS].position.set(sway, hipJoint + body.pelvisY - body.hipY, 0);
        b[HIPS].rotation.set(hipsPitch, hipsYaw, hipsRoll);
        b[SPINE].rotation.set(spinePitch, spineYaw, spineRoll);
        b[HEAD].rotation.set(-(spinePitch + hipsPitch) * 0.7 + lerp(lookPitch, 0, m), -(hipsYaw + spineYaw) * 0.8 + lerp(lookYaw, 0, m), -spineRoll * 0.5);
        b[THIGH_L].rotation.x = hipL - hipsPitch; b[SHIN_L].rotation.x = kneeL; b[FOOT_L].rotation.x = footL - hipL - kneeL;
        b[THIGH_R].rotation.x = hipR - hipsPitch; b[SHIN_R].rotation.x = kneeR; b[FOOT_R].rotation.x = footR - hipR - kneeR;

        // Arms swing against the legs; bent elbows when running
        for (let side = -1; side <= 1; side += 2) {
            const c = side < 0 ? cL : -cL;  // this arm's leg phase
            const swing = lerp(0.02 + 0.012 * breath, lerp(-0.3 * ampW * c * (1 - 0.3 * this.senior) + 0.04, (-0.55 * c + 0.1) * ampR, run), m);
            const elbow = lerp(0.14, lerp(0.2 + 0.12 * (1 - c), 1.3 - 0.2 * c, run), m);
            const tuck = m * run * 0.12;
            const arm = b[side < 0 ? ARM_L : ARM_R];
            arm.rotation.set(swing, 0, -side * (tuck - 0.01 * breath * (1 - m)));
            b[side < 0 ? FORE_L : FORE_R].rotation.x = elbow;
        }
    }

    dispose() {
        this.root.removeFromParent();
        const g = this.mesh.geometry;
        // Other people still use the shared shape: free only this person's colours. The last one
        // frees the shape too (and it leaves the cache: most customers' shapes are one-offs).
        if (this.tpl.refs > 1) { for (const name of SHARED) g.deleteAttribute(name); g.setIndex(null); }
        if (--this.tpl.refs <= 0 && templates.get(this.tpl.key) === this.tpl) templates.delete(this.tpl.key);
        g.dispose();
        this.mesh.skeleton.dispose();
    }
}

// ---- Blob shadows (Low graphics) ---------------------------------------------------------
// Low graphics has no shadow maps, so people would seem to float. One instanced quad per
// person — a soft dark disc at their feet — draws all of them in a single call.

let blobTexture: THREE.DataTexture | null = null;
const makeBlobTexture = () => {
    const n = 32, data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1;
        const r = Math.min(1, Math.hypot(dx, dy));
        const a = Math.round(255 * Math.pow(1 - smooth(0.15, 1, r), 1.6));
        data.set([a, a, a, a], (y * n + x) * 4);
    }
    const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
};
const tmpMatrix = new THREE.Matrix4();

export class BlobShadows {
    readonly mesh: THREE.InstancedMesh;
    private count = 0;
    constructor(private capacity = 64) {
        const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
        blobTexture ??= makeBlobTexture();
        const material = new THREE.MeshBasicMaterial({
            color: 0x000000, transparent: true, opacity: 0.55, alphaMap: blobTexture, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
        });
        this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
        this.mesh.frustumCulled = false;       // instances spread over the map; one draw call anyway
        this.mesh.userData.dynamic = true;
        this.mesh.count = 0;
        this.mesh.visible = false;
    }
    begin() { this.count = 0; }
    /** A blob under a person standing at (x, z); `person` scales it (and widens it as they stride). */
    add(x: number, z: number, person: Character) {
        if (this.count >= this.capacity) return;
        const r = person.size * (0.42 + 0.08 * person.moving);
        tmpMatrix.makeScale(r * 2, 1, r * 1.8).setPosition(x, BLOB_Y, z);
        this.mesh.setMatrixAt(this.count++, tmpMatrix);
    }
    end() {
        this.mesh.count = this.count;
        this.mesh.visible = this.count > 0;
        if (this.count > 0) this.mesh.instanceMatrix.needsUpdate = true;
    }
    dispose() {
        this.mesh.removeFromParent();
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
        this.mesh.dispose();
    }
}
