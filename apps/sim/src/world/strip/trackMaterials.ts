/* A circuit's scenery materials. The circuit glb (tools/blender/build_strip.py) carries geometry, UVs and material
   names (trk_*) only; here each name gets its shared material, textured from public/strip/tex (CC0 photos from Poly Haven
   and ambientCG, and our own drawings: see tex/CREDITS.md). UVs are metres on ground, walls and fences (so `repeat` is 1
   over the tile size in metres) and tiles on the atlases. A texture that fails to load leaves its material's colour.
   One library per session: every circuit shares its materials and textures. */
import * as THREE from 'three';

/** load: (url, onLoad, onError). The browser's is a THREE.TextureLoader; tests pass a stub. */
export type TexLoad = (url: string, onLoad: (t: THREE.Texture) => void, onError: () => void) => void;
export type TexSpec = {
  /** the colour while (or if) the map is missing, and the colour of untextured materials */
  color: number;
  map?: string; normal?: string; repeat?: [number, number];
  /** the colour the map is multiplied by once it loads (default white) */
  tint?: number;
  rough?: number; metal?: number;
  /** how much of the sky's reflection it takes (default 1) */
  env?: number;
  /** cut-out alpha (trees) */
  alphaTest?: number;
  /** a see-through veil, blended (the chain-link: it fades with distance instead of vanishing and leaving its posts) */
  veil?: boolean;
  /** a see-through overlay drawn over the asphalt (the rubbered line) */
  overlay?: boolean;
  double?: boolean;
  /** unlit (lamps, tree billboards: their lighting is in the picture) */
  basic?: boolean;
  /** drawn just over a coplanar surface (lines, kerbs, boards) */
  lift?: boolean;
  /** the map is this group's palette (PALETTES), made here: flat colours, one cell per member */
  palette?: boolean;
};

const FIVE: [number, number] = [1 / 5, 1 / 5], THREE_M: [number, number] = [1 / 3, 1 / 3];
export const LAMP_OFF = 0x3a0606;
export const LAMP_ON = 0xff2a2a;
/** Flat colours share a material per group: build_strip.py puts each member's faces on cell j of its group, UV
 *  ((j + .5) / n, .5), in this order (tools/blender/test_build_scenery.py checks the names and the order). */
export const PALETTES: Record<string, Record<string, number>> = {
  trk_marks: { trk_line: 0xf2f2ee, trk_paint: 0xffd23f, trk_kerb_red: 0xc8191e, trk_kerb_white: 0xf0f0ec },
  trk_solid: { trk_steel: 0x55595f, trk_roof: 0x8d9196, trk_marshal: 0xf4f4f4, trk_orange: 0xff7a1a, trk_canopy: 0x8c1d22, trk_armco: 0xb4bac2 },
  // the lamps' box shares their primitive (the glb compresses each primitive on its own grid, so they stay apart)
  trk_lamps: { trk_lamp1: LAMP_OFF, trk_lamp2: LAMP_OFF, trk_lamp3: LAMP_OFF, trk_lamp4: LAMP_OFF, trk_lamp5: LAMP_OFF, trk_lamp_box: 0x0b0c0e },
};
export const TRACK_TEX: Record<string, TexSpec> = {
  trk_asphalt: { color: 0x2b2d31, map: 'asphalt.jpg', normal: 'asphalt_n.jpg', repeat: FIVE, tint: 0xd6d6d6, rough: .92 },
  trk_rubber: { color: 0x0a0a0b, map: 'rubber.png', repeat: [1, 1 / 8], overlay: true, basic: true },
  trk_marks: { color: 0xffffff, palette: true, rough: .6, lift: true },
  trk_grass: { color: 0x4c6b2e, map: 'grass.jpg', normal: 'grass_n.jpg', repeat: [1 / 4, 1 / 4], tint: 0xb0a78c, rough: .95 },
  trk_grass_mow: { color: 0x5a7d36, map: 'grass.jpg', normal: 'grass_n.jpg', repeat: [1 / 4, 1 / 4], tint: 0xc3bb9f, rough: .95 },
  trk_gravel: { color: 0xa89a7a, map: 'gravel.jpg', normal: 'gravel_n.jpg', repeat: THREE_M, tint: 0xf0e6d2, rough: .95 },
  // painted and steel parts take less sky: at a low camera's grazing angle the overcast sky's reflection washed the red
  // canopy pink and the roofs white
  trk_solid: { color: 0xffffff, palette: true, metal: .1, rough: .7, env: .45, double: true },
  trk_wall: { color: 0x9a9a96, map: 'concrete.jpg', normal: 'concrete_n.jpg', repeat: THREE_M, rough: .9, double: true },
  trk_boards: { color: 0xffd23f, map: 'boards.png', repeat: [1, 1], rough: .6, double: true, lift: true },
  trk_tyres: { color: 0x151517, map: 'tyres.jpg', repeat: [1 / 2, 1], rough: .8, double: true },
  trk_fence: { color: 0x5d6168, map: 'fence.webp', repeat: [1 / 1.5, 1 / 1.5], tint: 0x8a8f96, veil: true, double: true, metal: .4, rough: .5 },
  trk_stand: { color: 0x8e8e90, map: 'concrete.jpg', normal: 'concrete_n.jpg', repeat: THREE_M, rough: .9, double: true },
  trk_crowd: { color: 0x6b5550, map: 'crowd.jpg', repeat: [1, 1 / 4], rough: .9, double: true },
  trk_pit: { color: 0xe2e4e8, map: 'pit.jpg', repeat: [1, 1], rough: .7, double: true },
  trk_brake: { color: 0xf5f6f7, map: 'brake.png', repeat: [1, 1], rough: .6, double: true },
  // the two tree species on one atlas (a left, b right); the tree line: two rows of trees, u one per 104 m tile and
  // v 0 to 26 / 26.5 (the strip's clear top rows keep the opaque bottom row from bleeding in)
  trk_trees: { color: 0x2a4420, map: 'trees.webp', repeat: [1, 1], alphaTest: .5, double: true, basic: true, tint: 0xdae2d3 },
  trk_treeline: { color: 0x26391f, map: 'treeline.webp', repeat: [1, 1], alphaTest: .5, double: true, basic: true, tint: 0xd0d8c8 },
  trk_lamps: { color: 0xffffff, palette: true, basic: true, double: true },
};

export type TrackLib = { material(name: string): THREE.Material | null; dispose(): void };

/** The session's circuit materials, made on first use; textures from `${base}strip/tex/`, each file fetched once. */
export function makeTrackLib(load: TexLoad, base: string, o: { aniso?: number } = {}): TrackLib {
  const mats = new Map<string, THREE.Material>();
  const files = new Map<string, { tex: THREE.Texture | null; failed: boolean; waiting: ((t: THREE.Texture | null) => void)[] }>();
  const owned: THREE.Texture[] = [];
  const file = (name: string, cb: (t: THREE.Texture | null) => void) => {
    let f = files.get(name);
    if (!f) {
      const entry = { tex: null as THREE.Texture | null, failed: false, waiting: [] as ((t: THREE.Texture | null) => void)[] };
      files.set(name, f = entry);
      load(base + 'strip/tex/' + name, t => { entry.tex = t; owned.push(t); for (const w of entry.waiting.splice(0)) w(t); },
        () => { entry.failed = true; for (const w of entry.waiting.splice(0)) w(null); });
    }
    if (f.tex || f.failed) cb(f.tex); else f.waiting.push(cb);
  };
  /** the file's texture, repeated: the first user takes it, later users with another repeat get a clone (same image) */
  const tex = (name: string, repeat: [number, number], color: boolean, cb: (t: THREE.Texture) => void) => file(name, t => {
    if (!t) return;
    const same = t.userData.repeatSet === undefined || (t.repeat.x === repeat[0] && t.repeat.y === repeat[1]);
    const u = same ? t : t.clone(); if (u !== t) owned.push(u);
    u.wrapS = u.wrapT = THREE.RepeatWrapping; u.repeat.set(repeat[0], repeat[1]); u.userData.repeatSet = true;
    u.flipY = false;                                   // glTF UVs: v runs down from the picture's top
    u.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (o.aniso) u.anisotropy = o.aniso;
    u.needsUpdate = true; cb(u);
  });
  const make = (name: string, s: TexSpec): THREE.Material => {
    if (s.palette) {
      const t = paletteTexture(PALETTES[name]); owned.push(t);
      const side = s.double ? THREE.DoubleSide : THREE.FrontSide;
      const p = s.basic ? new THREE.MeshBasicMaterial({ color: 0xffffff, map: t, side })
        : new THREE.MeshStandardMaterial({ color: 0xffffff, map: t, side, roughness: s.rough ?? .8, metalness: s.metal ?? 0, envMapIntensity: s.env ?? 1 });
      p.name = name;
      if (s.lift) { p.polygonOffset = true; p.polygonOffsetFactor = -1; p.polygonOffsetUnits = -1; }
      return p;
    }
    const side = s.double ? THREE.DoubleSide : THREE.FrontSide;
    const m: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial = s.basic
      ? new THREE.MeshBasicMaterial({ color: s.color, side })
      : new THREE.MeshStandardMaterial({ color: s.color, side, roughness: s.rough ?? .8, metalness: s.metal ?? 0 });
    m.name = name;
    if (s.alphaTest) { m.alphaTest = s.alphaTest; m.visible = false; }   // a cut-out without its picture is a flat board
    if (s.veil) { m.transparent = true; m.opacity = .3; m.depthWrite = false; m.forceSinglePass = true; }
    if (s.overlay) { m.transparent = true; m.opacity = .3; m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
    if (s.lift) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1; }
    if (s.map) tex(s.map, s.repeat ?? [1, 1], true, t => {
      m.map = t; m.color.setHex(s.tint ?? 0xffffff); if (s.overlay || s.veil) m.opacity = 1; m.visible = true; m.needsUpdate = true;
    });
    if (s.normal && m instanceof THREE.MeshStandardMaterial) tex(s.normal, s.repeat ?? [1, 1], false, t => {
      // no tangents, so three derives them from the UVs; with glTF's v (down the picture) an OpenGL normal map's green
      // reads upside down unless turned, as three's GLTFLoader does for its own maps
      m.normalMap = t; m.normalScale.set(.8, -.8); m.needsUpdate = true;
    });
    return m;
  };
  return {
    material(name) {
      const s = TRACK_TEX[name]; if (!s) return null;
      let m = mats.get(name); if (!m) mats.set(name, m = make(name, s));
      return m;
    },
    dispose() { for (const m of mats.values()) m.dispose(); for (const t of owned) t.dispose(); mats.clear(); files.clear(); owned.length = 0; },
  };
}

const paint = (d: { [i: number]: number }, j: number, hex: number) => { d[4 * j] = hex >> 16 & 255; d[4 * j + 1] = hex >> 8 & 255; d[4 * j + 2] = hex & 255; d[4 * j + 3] = 255; };
/** a palette's texture: one sharp cell per member, in order */
function paletteTexture(cells: Record<string, number>): THREE.DataTexture {
  const c = Object.values(cells), d = new Uint8Array(4 * c.length);
  c.forEach((hex, j) => paint(d, j, hex));
  const t = new THREE.DataTexture(d, c.length, 1, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}

/** Light the gantry's lamps (cells of the trk_lamps palette, shared by every circuit): on[i] for lamp i + 1. */
export function setLamps(lib: TrackLib, on: boolean[]): void {
  const t = (lib.material('trk_lamps') as THREE.MeshBasicMaterial | null)?.map as THREE.DataTexture | null | undefined;
  if (!t) return;
  on.forEach((v, i) => paint(t.image.data, i, v ? LAMP_ON : LAMP_OFF)); t.needsUpdate = true;
}

/** Give every trk_* mesh under root its library material (and normals, once, when the glb has none); returns how many. */
export function applyTrackMaterials(root: THREE.Object3D, lib: TrackLib): number {
  let n = 0;
  root.traverse(o => {
    const mesh = o as THREE.Mesh; if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const m = lib.material(mesh.material.name); if (!m) return;
    const g = mesh.geometry;
    if (g && g.getAttribute('position') && !g.getAttribute('normal')) g.computeVertexNormals();
    mesh.material = m; n++;
  });
  return n;
}

/** Which of the gantry's five lamps are lit: the start lights' count while the race counts down, none otherwise. */
export function gantryLamps(lit: number | null, counting: boolean): boolean[] {
  return [0, 1, 2, 3, 4].map(i => counting && lit != null && lit > i);
}
