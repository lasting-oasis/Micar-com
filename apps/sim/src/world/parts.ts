/* Night Tuner's visual parts and wheels (02-core.js buildCar: the `if(!lod){…}` parts block
   and the wheel loop), fitted to the sim's lofted body styles.
   Night Tuner's body is a ~4.4 m box facing +Z in metres; here the bodies are in world units
   (2 per metre) facing -Z. A Night Tuner coordinate becomes: z -> -z × scale, x and y × scale,
   then snapped to the body: front parts follow the nose outline, rear parts the tail outline,
   hood parts the hood surface, wings the deck (or the roof's back edge on long-roof bodies),
   skirts the sill between the arches, wheels the axles. */
import * as THREE from 'three';
import { BODY_SPECS } from '../scene/car/carStyles';
import { frontZ, halfWidthAt, lowerSection, rearZ, sideX, topY, type BodySpec } from '../scene/car/carGeometry';
import type { BodyStyle, VisualCfg } from './data';

export type Anchors = {
  noseZ: number; tailZ: number; hw: number; hoodY: number; roofY: number; roofZ: number; sillY: number;
  wheelR: number; wheelX: number; axles: [number, number]; scale: number;
};

/** Night Tuner's body: length the parts were laid out on, half width, nose / tail, sill, hood, deck, roof heights. */
const NT_LEN = 4.4, NT_HW = 0.9, NT_NOSE = 2.3, NT_TAIL = 2.3, NT_SILL = 0.3, NT_HOOD = 0.9, NT_DECK = 0.92, NT_ROOF = 1.33;
const NT_TIRE_R = 0.34, NT_TIRE_W = 0.26;
const RIMR: Record<number, number> = { 17: 0.205, 18: 0.222, 19: 0.238, 20: 0.255 };
const CALIPER = ['#4a4d55', '#c41a1a', '#e0b21b', '#ff6a13'];
/** Night Tuner's window tint: glass opacity by tint level (clear, light, dark, limo). */
export const TINT = [.42, .62, .8, .94];
const FIN: Record<VisualCfg['finish'], THREE.MeshPhysicalMaterialParameters> = {
  gloss: { metalness: .05, roughness: .3, clearcoat: 1, clearcoatRoughness: .04 }, metallic: { metalness: .62, roughness: .34, clearcoat: 1, clearcoatRoughness: .03 },
  pearl: { metalness: .42, roughness: .22, clearcoat: 1, clearcoatRoughness: .02 }, candy: { metalness: .88, roughness: .12, clearcoat: 1, clearcoatRoughness: 0 },
  matte: { metalness: .1, roughness: .82, clearcoat: 0, clearcoatRoughness: 1 },
};
const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------------------------------- anchors
const anchorCache = new Map<BodyStyle, Anchors>();
const specOf = (style: BodyStyle): BodySpec => BODY_SPECS[style] ?? BODY_SPECS.sedan;
const ghEnds = (s: BodySpec) => [s.gh.marks[0].z, s.gh.marks[s.gh.marks.length - 1].z] as const;

export function anchorsFor(style: BodyStyle): Anchors {
  let a = anchorCache.get(style);
  if (a) return a;
  const s = specOf(style), [g0, g1] = ghEnds(s);
  let roofY = -Infinity, roofZ = 0;
  for (let z = g0; z <= g1 + 1e-9; z += 0.02) { const y = s.gh.roof.at(z); if (y > roofY) { roofY = y; roofZ = z; } }
  a = {
    noseZ: s.noseZ, tailZ: s.tailZ, hw: s.hw, hoodY: s.shoulder.at(s.noseZ + 1.5), roofY, roofZ, sillY: s.bottom.at(0),
    wheelR: s.wheelR, wheelX: s.wheelX, axles: [s.axles[0], s.axles[1]], scale: (s.tailZ - s.noseZ) / NT_LEN,
  };
  anchorCache.set(style, a);
  return a;
}

// ---------------------------------------------------------------------------------- textures (browser only)
const hasDom = () => typeof document !== 'undefined';
function ctex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb: boolean, rep = false): THREE.Texture | null {
  if (!hasDom()) return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); if (!g) return null;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
let radialTex: THREE.Texture | null | undefined, carbonTex: THREE.Texture | null | undefined;
const numberTexs = new Map<string, THREE.Texture | null>();
const radial = () => radialTex !== undefined ? radialTex : (radialTex = ctex(128, 128, g => {
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.35, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
}, false));
const carbon = () => {
  if (carbonTex !== undefined) return carbonTex;
  carbonTex = ctex(64, 64, g => {
    g.fillStyle = '#0b0c0e'; g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const v = (x + y) % 2, gr = g.createLinearGradient(x * 8, y * 8, x * 8 + (v ? 8 : 0), y * 8 + (v ? 0 : 8));
      gr.addColorStop(0, '#1d2026'); gr.addColorStop(.5, '#2c3038'); gr.addColorStop(1, '#14161a');
      g.fillStyle = gr; g.fillRect(x * 8 + .5, y * 8 + .5, 7, 7);
    }
  }, true, true);
  carbonTex?.repeat.set(8, 8);
  return carbonTex;
};
const numberTex = (col: string) => {
  if (numberTexs.has(col)) return numberTexs.get(col)!;
  const t = ctex(256, 256, g => {
    g.fillStyle = col; g.beginPath(); g.arc(128, 128, 120, 0, 7); g.fill();
    g.fillStyle = (col === '#111111' || col === '#e10600') ? '#fff' : '#0b0b0b';
    g.font = 'italic 900 150px "Barlow Condensed","Arial Narrow",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('27', 124, 138);
  }, true);
  numberTexs.set(col, t);
  return t;
};
const SHARED_MAPS = () => [radialTex, carbonTex, ...numberTexs.values()];

// ---------------------------------------------------------------------------------- materials
type Mats = { paint: THREE.Material; carbon: THREE.Material; chrome: THREE.Material; dark: THREE.Material; head: THREE.SpriteMaterial; tail: THREE.SpriteMaterial };
const POLY = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
/** The kit's materials; everything it creates goes into `own` (to dispose). Body-colour parts share the lofted body's paint when there is one. */
function mats(cfg: VisualCfg, own: THREE.Material[], bodyPaint: THREE.Material | null): Mats {
  const M = <T extends THREE.Material>(m: T) => { own.push(m); return m; };
  const cmap = carbon();
  const glow = (c: THREE.Color) => M(new THREE.SpriteMaterial({ map: radial(), color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  return {
    paint: bodyPaint ?? M(new THREE.MeshPhysicalMaterial({ color: cfg.color, envMapIntensity: 1, ...(FIN[cfg.finish] ?? FIN.gloss) })),
    carbon: M(new THREE.MeshStandardMaterial({ color: cmap ? 0xffffff : 0x22252b, map: cmap, roughness: .35, metalness: .5, envMapIntensity: 1.2, ...POLY })),
    chrome: M(new THREE.MeshStandardMaterial({ color: 0xe8edf5, metalness: 1, roughness: .08, envMapIntensity: 1.5 })),
    dark: M(new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: .7, metalness: .2 })),
    head: glow(new THREE.Color(cfg.lights).multiplyScalar(.6)),
    tail: glow(new THREE.Color(0xff1828).multiplyScalar(.6)),
  };
}
const disposeMat = (m: THREE.Material) => {
  const map = (m as THREE.MeshStandardMaterial).map;
  if (map && !SHARED_MAPS().includes(map)) map.dispose();
  m.dispose();
};

// ---------------------------------------------------------------------------------- shared geometry (bounded: keyed by size / style)
const GEO = new Map<string, THREE.BufferGeometry>();
const cached = (key: string, make: () => THREE.BufferGeometry) => { let g = GEO.get(key); if (!g) GEO.set(key, g = make()); return g; };
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const box = (w: number, h: number, d: number) => cached(`b${r4(w)},${r4(h)},${r4(d)}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (r: number, h: number, seg = 20, open = false) => cached(`c${r4(r)},${r4(h)},${seg},${open}`, () => new THREE.CylinderGeometry(r, r, h, seg, 1, open));
const torus = (R: number, r: number) => cached(`t${r4(R)},${r4(r)}`, () => new THREE.TorusGeometry(R, r, 8, 40));
const ringG = (r0: number, r1: number) => cached(`r${r4(r0)},${r4(r1)}`, () => new THREE.RingGeometry(r0, r1, 40));
const PLANE = new THREE.PlaneGeometry(1, 1);
const DISC = new THREE.CircleGeometry(0.5, 40);

/** A grid surface: P(i, j) for i < ni, j < nj; faces turned so their normal points along `out`. */
function gridGeo(ni: number, nj: number, P: (i: number, j: number) => THREE.Vector3, out: THREE.Vector3) {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) { const p = P(i, j); pos.push(p.x, p.y, p.z); }
  const at = (i: number, j: number) => i * nj + j;
  const v = (k: number) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
  const a0 = v(at(0, 0)), n = new THREE.Vector3().crossVectors(v(at(1, 0)).sub(a0), v(at(0, 1)).sub(a0));
  const flip = n.dot(out) < 0;
  for (let i = 0; i < ni - 1; i++) for (let j = 0; j < nj - 1; j++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    if (flip) idx.push(a, d, c, a, c, b); else idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv: number[] = []; for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) uv.push(j / Math.max(1, nj - 1), i / Math.max(1, ni - 1));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** A flat slab in plan: outline in (x, z), top at yTop, `thick` deep. */
function slabGeo(outline: [number, number][], yTop: number, thick: number) {
  const sh = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // shape (x, v) -> (x, -depth .. 0, z = v)
  g.translate(0, yTop, 0);
  return g;
}
const lin = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));

// ---------------------------------------------------------------------------------- body surfaces
/** Height of the hood / deck surface at (z, x) (crowned top of the lower body). */
function topAt(s: BodySpec, z: number, x: number) {
  const P = lowerSection(s, z, { top: 'crown' }).slice(8), ax = Math.abs(x);
  if (ax >= P[0][0]) return P[0][1];
  for (let i = 0; i < P.length - 1; i++) {
    const [x0, y0] = P[i], [x1, y1] = P[i + 1];
    if (ax <= x0 && ax >= x1) return y0 + (y1 - y0) * (x0 === x1 ? 0 : (ax - x0) / (x1 - x0));
  }
  return P[P.length - 1][1];
}
/** Height of the roof at (z, x) (centre line plus the roof's crown). */
function roofAt(s: BodySpec, z: number, x: number) {
  const P = lowerSection(s, z), yS = P[8][1], yR = s.gh.roof.at(z);
  const xr = Math.max(0.2, Math.min(s.gh.rail.at(z), P[9][0]) - s.railR);
  const crown = s.roofCrown * clamp((yR - yS) / 0.6, 0, 1);
  return yR + crown * (1 - Math.min(1, (x / xr) ** 2));
}
/** The z range of the flat roof (from the first 'roof' mark to the next mark that is not roof). */
function roofSpan(s: BodySpec): [number, number] {
  const m = s.gh.marks, i0 = m.findIndex(k => k.zone === 'roof');
  if (i0 < 0) return [m[0].z, m[m.length - 1].z];
  let i1 = i0; while (i1 < m.length - 1 && m[i1].zone === 'roof') i1++;
  return [m[i0].z, m[i1].z];
}
const inBed = (s: BodySpec, z: number) => !!s.bed && z > s.bed.z0 - 0.05 && z < s.bed.z1 + 0.05;
const fz = (s: BodySpec, x: number, y: number) => { const z = frontZ(s, x, y); return Number.isNaN(z) ? s.noseZ : z; };
const rz = (s: BodySpec, x: number, y: number) => { const z = rearZ(s, x, y); return Number.isNaN(z) ? s.tailZ : z; };
const sx = (s: BodySpec, z: number, y: number) => { const x = sideX(s, z, y); return Number.isNaN(x) ? halfWidthAt(s, z) - s.sillIn : x; };

/** Everything the kit needs about one body style, worked out once. */
type Fit = {
  s: BodySpec; a: Anchors; k: number; kx: number;
  yF: number; yR: number;                      // underside height at the nose / tail
  hoodZ0: number; hoodZ1: number;              // hood surface from the nose to the windscreen base
  deckZ0: number; deckZ1: number;              // deck behind the rear glass (trunk bodies)
  roof: [number, number];
  trunk: boolean;                              // wings stand on the deck (else on the roof's back edge)
  wingZ: number; wingY: number; wingLift: number;
};
const fitCache = new Map<BodyStyle, Fit>();
function fitFor(style: BodyStyle): Fit {
  let f = fitCache.get(style);
  if (f) return f;
  const s = specOf(style), a = anchorsFor(style), k = a.scale, kx = s.hw / NT_HW, [g0, g1] = ghEnds(s);
  const yF = s.bottom.at(s.noseZ + 0.15 * k), yR = s.bottom.at(s.tailZ - 0.15 * k);
  const hoodZ0 = fz(s, 0, topY(s, s.noseZ + 0.5) - 0.04) + 0.06, hoodZ1 = g0 - 0.04;
  const deckZ1 = rz(s, 0, topY(s, s.tailZ - 0.5) - 0.04) - 0.06, deckZ0 = g1 + 0.04;
  const trunk = s.tailZ - g1 > 0.12 * (s.tailZ - s.noseZ);
  const roof = roofSpan(s);
  let wingZ: number, wingY: number, wingLift: number;
  if (trunk) {
    wingZ = s.tailZ - (NT_TAIL - 2.06) * k;
    wingY = inBed(s, wingZ) ? s.shoulder.at(wingZ) : topY(s, wingZ);
    wingLift = 1;
  } else { // hatch, SUV, van: a roof wing over the top of the rear glass, on shorter stalks
    wingZ = roof[1] - 0.05 * k;
    wingY = roofAt(s, wingZ, 0);
    wingLift = 0.45;
  }
  f = { s, a, k, kx, yF, yR, hoodZ0, hoodZ1, deckZ0, deckZ1, roof, trunk, wingZ, wingY, wingLift };
  fitCache.set(style, f);
  return f;
}

// ---------------------------------------------------------------------------------- the kit
export type PartsKit = {
  neonLight: THREE.PointLight | null; glows: THREE.Sprite[]; mats: THREE.Material[];
  /** the four wheel spin nodes (rotation.x rolls them) */
  wheels: THREE.Object3D[];
  root: THREE.Group; car: THREE.Group;
  /** puts back what the kit changed on the lofted model (paint finish, glass) */
  undo: (() => void)[];
};
type ModelParts = {
  body: THREE.Mesh; wheelMesh: THREE.InstancedMesh; pivots: THREE.Object3D[]; wheels: THREE.Object3D[]; halos: THREE.Points; far: boolean; glass?: THREE.Mesh;
};
const modelOf = (car: THREE.Object3D) => car.userData.car as ModelParts | undefined;

/**
 * Add Night Tuner's body kit for `cfg` to a lofted car of `style` (also replaces its wheels).
 * Calling it again on the same car replaces the previous kit.
 */
export function attachParts(car: THREE.Group, cfg: VisualCfg, style: BodyStyle, perfBrakes: number): PartsKit {
  const prev = car.userData.ntParts as PartsKit | undefined;
  if (prev) disposeParts(prev);
  const F = fitFor(style), { s, a, k, kx } = F;
  const model = modelOf(car);
  const own: THREE.Material[] = [];
  const m = mats(cfg, own, model ? model.body.material as THREE.Material : null);
  const root = new THREE.Group(); root.name = 'ntParts';
  if (model) root.position.copy(model.body.position); // the model is lifted onto the paving
  car.add(root);
  const undo: (() => void)[] = [];
  if (model) {
    // paint finish on the model's own (per-car) paint; clearcoat only where the material has one
    const pm = model.body.material as THREE.MeshPhysicalMaterial, fin = FIN[cfg.finish] ?? FIN.gloss;
    const keys = (['metalness', 'roughness', 'clearcoat', 'clearcoatRoughness'] as const).filter(key => key in pm && fin[key] !== undefined);
    const before = keys.map(key => pm[key]);
    for (const key of keys) pm[key] = fin[key]!;
    undo.push(() => keys.forEach((key, i) => { pm[key] = before[i]; }));
    // window tint: the glass material is shared by every car, so this car gets its own copy
    const glass = model.glass ?? model.body.userData.glass as THREE.Mesh | undefined;
    if (glass) {
      const orig = glass.material as THREE.Material, mine = orig.clone();
      mine.onBeforeCompile = orig.onBeforeCompile; mine.customProgramCacheKey = orig.customProgramCacheKey; // clone() drops the reflective-glass shader hook
      mine.transparent = true; mine.opacity = TINT[cfg.tint] ?? TINT[0];
      glass.material = mine;
      undo.push(() => { if (glass.material === mine) glass.material = orig; mine.dispose(); });
    }
  }
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.set(rx, ry, rz);
    o.castShadow = true; root.add(o); return o;
  };
  const both = (f: (sd: number) => void) => { f(-1); f(1); };
  const slope = (y: (z: number) => number, z: number) => -Math.atan((y(z + 0.1) - y(z - 0.1)) / 0.2); // rotation.x that lies a part on the surface

  // ---- front: street lip, lip + canards, wide splitter with end plates
  if (cfg.front) {
    const wide = cfg.front === 3, yRef = F.yF + 0.05;
    const ahead = (wide ? 0.14 : 0.06) * k, back = (wide ? 0.2 : 0.07) * k, thick = 0.05 * k;
    const zBackX = fz(s, 0, yRef) + back;
    const xm = Math.min((wide ? 1.0 : 0.94) * halfWidthAt(s, zBackX), (wide ? 0.96 : 0.85) * kx);
    const front = lin(-xm, xm, 21).map(x => [x, Math.min(fz(s, Math.min(Math.abs(x), halfWidthAt(s, zBackX) - 0.02), yRef) - ahead, zBackX - 0.02)] as [number, number]);
    const zBack = Math.max(zBackX, Math.max(...front.map(p => p[1])) + 0.02);
    const outline: [number, number][] = [...front, [xm, zBack], [-xm, zBack]];
    const yTop = F.yF - (wide ? 0.035 : 0.005) * k;
    add(cached(`front${wide ? 'W' : 'L'}:${style}`, () => slabGeo(outline, yTop, thick)), m.carbon);
    if (cfg.front === 2) both(sd => {
      const y = F.yF + (0.42 - NT_SILL) * k, xc = Math.min(0.8 * kx, 0.9 * halfWidthAt(s, s.noseZ + 0.25 * k));
      add(box(.3 * kx, .03 * k, .16 * k), m.carbon, sd * xc, y, fz(s, xc, y), 0, 0, sd * .3);
    });
    if (wide) both(sd => add(box(.04 * kx, .13 * k, .32 * k), m.carbon, sd * xm, F.yF, fz(s, Math.min(xm, halfWidthAt(s, zBackX) - 0.02), yRef) + 0.02 * k));
  }

  // ---- rear: diffuser / race diffuser (plate under the tail, fins hanging below)
  if (cfg.rear) {
    const race = cfg.rear === 2, w = (race ? 1.7 : 1.4) * kx, n = race ? 6 : 4;
    const fh = Math.min((race ? .2 : .12) * k, F.yR + .03 * k - .14); // the lofted bodies sit lower: keep the fins off the road
    const yRef = F.yR + 0.05, behind = 0.12 * k, fwd = 0.18 * k;
    const zFront = rz(s, 0, yRef) - fwd;
    const xm = Math.min(w / 2, 0.96 * halfWidthAt(s, zFront));
    const backAt = (x: number) => Math.max(rz(s, Math.min(Math.abs(x), halfWidthAt(s, zFront) - 0.02), yRef) + behind, zFront + 0.1 * k);
    const outline: [number, number][] = [[-xm, zFront], [xm, zFront], ...lin(xm, -xm, 21).map(x => [x, backAt(x)] as [number, number])];
    add(cached(`rear${cfg.rear}:${style}`, () => slabGeo(outline, F.yR + 0.03 * k, 0.06 * k)), m.carbon);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1) - .5) * xm * 2 * .85;
      add(box(.025 * kx, fh, .34 * k), m.carbon, x, F.yR + 0.03 * k - fh / 2, backAt(x) - 0.18 * k);
    }
  }

  // ---- side skirts: slim carbon blade or deep body-colour skirt, between the arches
  if (cfg.skirts) {
    const deep = cfg.skirts === 2;
    const z0 = s.axles[0] + s.archR + 0.04, z1 = s.axles[1] - s.archR - 0.04, zc = (z0 + z1) / 2, len = z1 - z0;
    const h = (deep ? .18 : .1) * k, w = (deep ? .14 : .08) * kx, yc = s.bottom.at(zc) + ((deep ? .37 : .34) - NT_SILL) * k;
    const xo = sx(s, zc, s.bottom.at(zc) + 0.1 * k) + (deep ? .1 : .06) * kx; // outer face
    both(sd => add(box(w, h, len), deep ? m.paint : m.carbon, sd * (xo - w / 2), yc, zc));
  }

  // ---- spoilers: ducktail, low wing, GT wing, swan neck
  const sp = cfg.spoiler;
  if (sp) {
    const L = F.wingLift;
    const wz = (zNT: number) => F.wingZ + (-zNT - 2.06) * k;          // Night Tuner z (negative = rear) -> world
    const wy = (yNT: number) => F.wingY + (yNT - NT_DECK) * k * L;
    const strutX = (xNT: number) => s.bed && inBed(s, F.wingZ) ? sx(s, F.wingZ, s.shoulder.at(F.wingZ) - 0.05) - 0.08 : xNT * kx;
    if (sp === 1) { // ducktail: a lip on the trailing edge
      const surf = (zz: number) => F.trunk ? (inBed(s, zz) ? s.shoulder.at(zz) : topY(s, zz)) : roofAt(s, zz, 0);
      const z = F.trunk ? wz(-2.12) : F.wingZ, zs = F.trunk ? z : z - .15 * k; // a roof lip takes the flat roof's slope, not the rear glass's
      add(box(1.62 * kx, .05 * k, .3 * k), m.paint, 0, surf(z) + .05 * k, z, slope(surf, zs) - .28);
    }
    if (sp === 2) {
      both(sd => add(box(.05 * kx, .12 * k * L + .04 * k, .1 * k), m.paint, sd * strutX(.55), wy(1.0), wz(-2.05)));
      add(box(1.75 * kx, .035 * k, .3 * k), m.paint, 0, wy(1.07), wz(-2.08));
    }
    if (sp === 3) {
      both(sd => {
        add(box(.04 * kx, .32 * k * L + .04 * k, .14 * k), m.carbon, sd * strutX(.5), wy(1.1), wz(-2.02));
        add(box(.03 * kx, .18 * k, .42 * k), m.carbon, sd * .98 * kx, wy(1.26), wz(-2.06));
      });
      add(box(1.95 * kx, .04 * k, .36 * k), m.carbon, 0, wy(1.27), wz(-2.06), -.1);
    }
    if (sp === 4) {
      both(sd => {
        add(box(.04 * kx, .44 * k * L + .04 * k, .12 * k), m.carbon, sd * strutX(.42), wy(1.18), wz(-1.98), .2);
        add(box(.03 * kx, .24 * k, .5 * k), m.carbon, sd * 1.0 * kx, wy(1.34), wz(-2.06));
      });
      add(box(2.0 * kx, .045 * k, .42 * k), m.carbon, 0, wy(1.38), wz(-2.06), -.12);
    }
  }

  // ---- hoods: ram scoop, twin vents, carbon hood. Night Tuner's hood runs z 2.3 (nose) .. 0.95 (windscreen).
  if (cfg.hood) {
    const hz = (zNT: number) => s.noseZ + (NT_NOSE - zNT) / (NT_NOSE - 0.95) * (F.hoodZ1 - s.noseZ);
    const kz = Math.min(k, (F.hoodZ1 - s.noseZ) / (NT_NOSE - 0.95));
    const surf = (z: number) => topAt(s, z, 0);
    if (cfg.hood === 1) {
      const z = hz(1.35);
      add(box(.56 * kx, .11 * k, .6 * kz), m.paint, 0, surf(z) + (.93 - NT_HOOD) * k, z, slope(surf, z));
      add(box(.46 * kx, .07 * k, .03 * k), m.dark, 0, surf(z - .3 * kz) + (.95 - NT_HOOD) * k, z - .3 * kz, slope(surf, z));
    }
    if (cfg.hood === 2) both(sd => {
      const z = hz(1.45), x = sd * .38 * kx;
      add(box(.22 * kx, .025 * k, .52 * kz), m.dark, x, topAt(s, z, x) + (.915 - NT_HOOD) * k, z, slope(zz => topAt(s, zz, x), z));
    });
    if (cfg.hood === 3) {
      const z0 = Math.max(F.hoodZ0, hz(2.2)), z1 = F.hoodZ1, zs = lin(z0, z1, 24);
      const xw = (z: number) => 0.8 * halfWidthAt(s, z) * Math.min(1, (lowerSection(s, z)[8][0]) / Math.max(1e-6, halfWidthAt(s, z)));
      add(cached(`hood3:${style}`, () => gridGeo(zs.length, 9, (i, j) => {
        const z = zs[i], x = xw(z) * (j / 4 - 1);
        return new THREE.Vector3(x, topAt(s, z, x) + 0.012, z);
      }, new THREE.Vector3(0, 1, 0))), m.carbon);
    }
  }

  // ---- roof scoop
  if (cfg.roof === 1) {
    const [r0, r1] = F.roof, z = clamp(a.roofZ, r0 + .25 * k, r1 - .25 * k), surf = (zz: number) => roofAt(s, zz, 0);
    add(box(.42 * kx, .12 * k, .45 * k), m.paint, 0, surf(z) + (1.38 - NT_ROOF) * k, z, slope(surf, z));
    add(box(.34 * kx, .07 * k, .02 * k), m.dark, 0, surf(z) + (1.38 - NT_ROOF) * k, z - .23 * k, slope(surf, z));
  }

  // ---- vinyls: twin stripes, centre stripe, side stripe, race number
  if (cfg.vinyl) {
    const vm = new THREE.MeshPhysicalMaterial({ color: cfg.vinylColor, roughness: .3, metalness: .05, clearcoat: 1, ...POLY }); own.push(vm);
    const stripe = (xc: number, hwS: number, key: string) => {
      const runs: [number, number, (z: number, x: number) => number][] = [[F.hoodZ0, F.hoodZ1, (z, x) => topAt(s, z, x)], [F.roof[0], F.roof[1], (z, x) => roofAt(s, z, x)]];
      if (F.trunk && !s.bed && F.deckZ1 > F.deckZ0 + 0.2) runs.push([F.deckZ0, F.deckZ1, (z, x) => topAt(s, z, x)]);
      runs.forEach(([z0, z1, y], r) => {
        const zs = lin(z0, z1, Math.max(4, Math.round((z1 - z0) / 0.15)));
        add(cached(`vin${key}${r}:${style}`, () => gridGeo(zs.length, 3, (i, j) => {
          const x = xc + hwS * (j - 1); return new THREE.Vector3(x, y(zs[i], x) + 0.008, zs[i]);
        }, new THREE.Vector3(0, 1, 0))), vm);
      });
    };
    if (cfg.vinyl === 1) both(sd => stripe(sd * .22 * kx, .08 * kx, `1${sd}`));
    if (cfg.vinyl === 2) stripe(0, .23 * kx, '2');
    if (cfg.vinyl === 3) {
      const z0 = Math.max(s.noseZ + s.front.len + 0.1, -1.9 * k), z1 = Math.min(s.tailZ - s.rear.len - 0.1, 1.9 * k), zs = lin(z0, z1, 40);
      const archTop = s.archY + s.archR + (s.flare ?? 0) + 0.06;
      const nearArch = (z: number) => s.axles.some(ax => Math.abs(z - ax) < s.archR + .15);
      const yc = (z: number) => { const y = Math.min(s.shoulder.at(z) - s.rS - 0.12 * k, s.shoulder.at(z) - s.rS - .03 * k); return nearArch(z) ? Math.max(y, archTop + .03 * k) : y; };
      both(sd => add(cached(`vin3${sd}:${style}`, () => gridGeo(zs.length, 2, (i, j) => {
        const z = zs[i], y = yc(z) + (j - .5) * .06 * k;
        return new THREE.Vector3(sd * (sx(s, z, y) + 0.008), y, z);
      }, new THREE.Vector3(sd, 0, 0))), vm));
    }
    if (cfg.vinyl === 4) {
      const map = numberTex(cfg.vinylColor);
      const nm = new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : cfg.vinylColor, transparent: true, roughness: .35, ...POLY }); own.push(nm);
      const y = (a.sillY + s.shoulder.at(0)) / 2, d = .56 * k;
      both(sd => { const o = add(DISC, nm, sd * (sx(s, 0, y) + 0.01), y, 0, 0, sd * Math.PI / 2); o.scale.set(d, d, 1); o.castShadow = false; });
    }
  }

  // ---- hydraulics: a chrome ram inboard of each wheel
  if (cfg.hydraulics) for (const z of s.axles) both(sd => add(cyl(.05 * k, .3 * k, 8), m.chrome, sd * s.wheelX * (.6 / .78), s.wheelR + (.42 - NT_TIRE_R) * k, z));

  // ---- lamp glows (Night Tuner's head / tail sprites): at the model's lamps, or where Night Tuner had them
  const glows: THREE.Sprite[] = [];
  const spr = (mat: THREE.SpriteMaterial, kind: 'head' | 'tail', x: number, y: number, z: number, size: number) => {
    const o = new THREE.Sprite(mat); o.position.set(x, y, z); o.scale.setScalar(size); o.userData.lamp = kind; root.add(o); glows.push(o);
  };
  const lampPts: { kind: 'head' | 'tail'; p: THREE.Vector3 }[] = [];
  if (model) {
    const pos = model.halos.geometry.getAttribute('position'), dir = model.halos.geometry.getAttribute('lampDir');
    for (let i = 0; i < pos.count; i++) lampPts.push({ kind: dir.getX(i) < 0 ? 'head' : 'tail', p: new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)) });
  }
  if (!lampPts.length) both(sd => {
    const xh = sd * .6 * kx, yh = F.yF + (.66 - NT_SILL) / (NT_HOOD - NT_SILL) * (topY(s, s.noseZ + .3) - F.yF);
    const yt = F.yR + (.74 - NT_SILL) / (NT_DECK - NT_SILL) * (topY(s, s.tailZ - .3) - F.yR);
    lampPts.push({ kind: 'head', p: new THREE.Vector3(xh, yh, fz(s, Math.abs(xh), yh) - .12) }, { kind: 'tail', p: new THREE.Vector3(xh, yt, rz(s, Math.abs(xh), yt) + .12) });
  });
  for (const l of lampPts) spr(l.kind === 'head' ? m.head : m.tail, l.kind, l.p.x, l.p.y, l.p.z, (l.kind === 'head' ? .5 : .38) * k);

  // ---- underglow: a soft pool on the ground, two tubes under the sills, a point light
  let neonLight: THREE.PointLight | null = null;
  if (cfg.neon && cfg.neon !== 'none') {
    const nc = new THREE.Color(cfg.neon), len = a.tailZ - a.noseZ;
    const gm = new THREE.MeshBasicMaterial({ map: radial(), color: nc, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false }); own.push(gm);
    const pool = add(PLANE, gm, 0, .02 - root.position.y, (a.noseZ + a.tailZ) / 2, -Math.PI / 2);
    pool.scale.set(2 * a.hw + 1.4, len + .8, 1); pool.renderOrder = 2; pool.castShadow = false;
    const tm = new THREE.MeshBasicMaterial({ color: nc.clone().multiplyScalar(2) }); own.push(tm);
    const xt = Math.min(.8 * a.hw, s.wheelX - s.tyreW / 2 - .1);
    both(sd => { const o = add(box(.03 * k, .03 * k, .74 * len), tm, sd * xt, a.sillY - .03 * k, (a.noseZ + a.tailZ) / 2); o.castShadow = false; });
    // Night Tuner's 2.2 (legacy lights) at 6 m: physical units (×π) and world-unit distances (×scale²)
    neonLight = new THREE.PointLight(nc, 2.2 * Math.PI * k * k, 6 * k, 2);
    neonLight.position.set(0, .6 * a.sillY, (a.noseZ + a.tailZ) / 2);
    root.add(neonLight);
  }

  const wheels = replaceWheels(car, cfg, a, perfBrakes);
  const kit: PartsKit = { neonLight, glows, mats: own, wheels, root, car, undo };
  car.userData.ntParts = kit;
  syncKitLod(car);
  return kit;
}

/**
 * Match the kit's visibility to the lofted model's far version (call after the model's LOD
 * update, e.g. once per frame for kitted cars): kit and Night Tuner wheels hide when the car is drawn far.
 */
export function syncKitLod(car: THREE.Object3D): void {
  const far = !!modelOf(car)?.far;
  const kit = car.userData.ntParts as PartsKit | undefined, st = car.userData.ntWheels as WheelState | undefined;
  if (kit) kit.root.visible = !far;
  if (st?.holder) st.holder.visible = !far;
}

/** Remove a kit from its car (and its wheels: the lofted wheels come back) and free its materials. */
export function disposeParts(r: ReturnType<typeof attachParts>): void {
  r.root.removeFromParent();
  for (const f of r.undo.splice(0)) f();
  for (const m of r.mats) disposeMat(m);
  r.mats.length = 0;
  removeWheels(r.car);
  if (r.car.userData.ntParts === r) delete r.car.userData.ntParts;
}

// ---------------------------------------------------------------------------------- wheels
type WheelState = { added: THREE.Object3D[]; holder: THREE.Object3D | null; pivots: THREE.Object3D[]; mats: THREE.Material[] };

/**
 * Night Tuner's wheels for `cfg` (rim style, size and colour, tyre, disc, caliper by brake tier) at the
 * car's wheel positions. On a lofted model the new wheels hang on its own pivots / roll nodes (so its
 * steering and rolling keep working) and its instanced wheels are hidden; on a bare group four pivots
 * are made from the anchors. Returns the four spin nodes (FL, FR, RL, RR; rotation.x rolls them).
 */
export function replaceWheels(car: THREE.Group, cfg: VisualCfg, anchors: Anchors, perfBrakes: number): THREE.Object3D[] {
  removeWheels(car);
  const st: WheelState = { added: [], holder: null, pivots: [], mats: [] };
  const model = modelOf(car);
  let pivots: THREE.Object3D[], spins: THREE.Object3D[];
  if (model) {
    const holder = new THREE.Group(); holder.name = 'ntWheels'; holder.position.copy(model.wheelMesh.position); car.add(holder); st.holder = holder;
    for (const p of model.pivots) if (!p.parent) { holder.add(p); st.pivots.push(p); }
    pivots = model.pivots; spins = model.wheels;
    model.wheelMesh.visible = false; model.wheelMesh.count = 0; // count survives the far/near switch, which resets `visible`
  } else {
    pivots = []; spins = [];
    for (const [sxn, ax] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) {
      const pivot = new THREE.Group(); pivot.position.set(sxn * anchors.wheelX, anchors.wheelR, anchors.axles[ax]); car.add(pivot);
      const spin = new THREE.Group(); pivot.add(spin);
      pivots.push(pivot); spins.push(spin); st.added.push(pivot);
    }
  }

  const M = <T extends THREE.Material>(m: T) => { st.mats.push(m); return m; };
  const rr = RIMR[cfg.rimSize] ?? .205;
  const rimCol = cfg.rimColor === 'body' ? cfg.color : cfg.rimColor === 'chrome' ? '#eef3ff' : cfg.rimColor;
  const rimM = M(new THREE.MeshStandardMaterial({ color: rimCol, metalness: cfg.rimColor === '#141518' ? .4 : .95, roughness: cfg.rimColor === 'chrome' ? .05 : .28, envMapIntensity: 1.4 }));
  const tire = M(new THREE.MeshStandardMaterial({ color: 0x111214, roughness: .85, side: THREE.DoubleSide }));
  const disc = M(new THREE.MeshStandardMaterial({ color: 0x6d7178, metalness: .8, roughness: .4 }));
  const cal = M(new THREE.MeshStandardMaterial({ color: CALIPER[perfBrakes] ?? CALIPER[0], roughness: .4, metalness: .3 }));
  const dark = M(new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: .7, metalness: .2 }));
  // Night Tuner builds a 0.34 m x 0.26 m wheel; scale it to this body's tyre (radius on y/z, width on x)
  const kr = anchors.wheelR / NT_TIRE_R, kw = (wheelWidth(anchors) / NT_TIRE_W);

  pivots.forEach((pivot, i) => {
    const side = Math.sign(pivot.position.x) || 1;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, p: THREE.Object3D, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; p.add(o); return o;
    };
    const wheel = new THREE.Group(); wheel.name = 'ntWheel'; wheel.scale.set(kw, kr, kr); spins[i].add(wheel); st.added.push(wheel);
    const fixed = new THREE.Group(); fixed.name = 'ntBrake'; fixed.scale.set(kw, kr, kr); pivot.add(fixed); st.added.push(fixed);
    add(cyl(NT_TIRE_R, NT_TIRE_W, 32, true), tire, wheel, 0, 0, 0, 0, 0, Math.PI / 2);
    for (const sxx of [-1, 1]) add(ringG(rr * 1.04, NT_TIRE_R), tire, wheel, sxx * .13, 0, 0, 0, sxx * Math.PI / 2);
    const face = new THREE.Group(); face.position.x = side * .112; wheel.add(face);
    add(cyl(rr * 1.04, .22, 24, true), dark, face, -side * .11, 0, 0, 0, 0, Math.PI / 2);
    add(torus(rr, .018), rimM, face, 0, 0, 0, 0, Math.PI / 2);
    add(cyl(rr * .82, .025, 24), disc, fixed, -side * .07, 0, 0, 0, 0, Math.PI / 2);
    add(box(.07, .12, .16), cal, fixed, side * .03, rr * .62, .06); // behind the axle (the car faces -Z)
    const chord = (a1: number, r1: number, a2: number, r2: number, w: number, dx = 0) => {
      const y1 = Math.cos(a1) * r1, z1 = Math.sin(a1) * r1, y2 = Math.cos(a2) * r2, z2 = Math.sin(a2) * r2;
      const len = Math.hypot(y2 - y1, z2 - z1);
      const o = add(box(.03, len, w), rimM, face, dx * side, (y1 + y2) / 2, (z1 + z2) / 2); o.rotation.x = Math.atan2(z2 - z1, y2 - y1); return o;
    };
    add(cyl(rr * .2, .05, 16), rimM, face, side * .01, 0, 0, 0, 0, Math.PI / 2);
    if (cfg.rim === 'stock') for (let q = 0; q < 6; q++) { const t = q * TAU / 6; chord(t, rr * .18, t, rr * .97, .06); }
    if (cfg.rim === 'spoke5') for (let q = 0; q < 5; q++) { const t = q * TAU / 5; chord(t, rr * .18, t, rr * .97, .1); chord(t + .12, rr * .5, t + .2, rr * .97, .025); }
    if (cfg.rim === 'mesh') for (let q = 0; q < 14; q++) { const t = q * TAU / 14; chord(t, rr * .2, t + .42, rr * .97, .018); chord(t, rr * .2, t - .42, rr * .97, .018); }
    if (cfg.rim === 'dish') {
      face.position.x = side * .09;
      add(ringG(rr * .72, rr * 1.04), rimM, face, side * .045, 0, 0, 0, side * Math.PI / 2);
      for (let q = 0; q < 6; q++) { const t = q * TAU / 6; chord(t, rr * .18, t, rr * .74, .07); }
    }
    if (cfg.rim === 'fan') { add(cyl(rr * .92, .02, 30), dark, face, -side * .005, 0, 0, 0, 0, Math.PI / 2); for (let q = 0; q < 12; q++) { const t = q * TAU / 12; chord(t, rr * .24, t + .38, rr * .9, .04, .008); } }
    if (cfg.rim === 'split') for (let q = 0; q < 7; q++) { const t = q * TAU / 7; chord(t, rr * .2, t - .12, rr * .97, .03); chord(t, rr * .2, t + .12, rr * .97, .03); }
  });
  if (cfg.rim === 'dish') rimM.side = THREE.DoubleSide;
  car.userData.ntWheels = st;
  return spins;
}

/** Tyre width for anchors (Anchors carries no tyre width: take it from the matching body style). */
function wheelWidth(a: Anchors) {
  for (const s of Object.values(BODY_SPECS)) if (s.wheelR === a.wheelR && s.wheelX === a.wheelX) return s.tyreW;
  return a.wheelR * 0.7;
}

/** Take Night Tuner's wheels off a car and bring back the lofted ones. */
function removeWheels(car: THREE.Object3D) {
  const st = car.userData.ntWheels as WheelState | undefined;
  if (!st) return;
  for (const o of st.added) o.removeFromParent();
  for (const p of st.pivots) p.removeFromParent();
  st.holder?.removeFromParent();
  for (const m of st.mats) m.dispose();
  const model = modelOf(car);
  if (model) { model.wheelMesh.count = 4; model.wheelMesh.visible = !model.far; }
  delete car.userData.ntWheels;
}
