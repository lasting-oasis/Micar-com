import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LAMP_OFF, LAMP_ON, PALETTES, TRACK_TEX, applyTrackMaterials, gantryLamps, makeTrackLib, setLamps, type TexLoad } from './trackMaterials';

/** A texture loader that answers at once (or fails for the names in `fail`) and records what it was asked for. */
const stubLoad = (fail: string[] = []) => {
  const urls: string[] = [];
  const load: TexLoad = (url, onLoad, onError) => {
    urls.push(url);
    if (fail.some(f => url.endsWith(f))) onError(); else onLoad(new THREE.Texture());
  };
  return { load, urls };
};
const mesh = (name: string) => { const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()); (m.material as THREE.Material).name = name; return m; };
const root = (...names: string[]) => { const g = new THREE.Group(); for (const n of names) g.add(mesh(n)); return g; };
const matOf = (g: THREE.Object3D, i: number) => (g.children[i] as THREE.Mesh).material as THREE.Material;
/** cell j of a palette texture, as 0xRRGGBB */
const cell = (t: THREE.DataTexture, j: number) => { const d = t.image.data; return (d[4 * j] << 16) | (d[4 * j + 1] << 8) | d[4 * j + 2]; };
const mapOf = (m: THREE.Material | null) => (m as THREE.MeshBasicMaterial).map as THREE.DataTexture;

describe('circuit materials', () => {
  it('swaps trk materials by name and leaves others', () => {
    const { load } = stubLoad(), lib = makeTrackLib(load, '/s/');
    const g = root('trk_asphalt', 'trk_lamps', 'tarmac');
    expect(applyTrackMaterials(g, lib)).toBe(2);
    expect(matOf(g, 0)).toBe(lib.material('trk_asphalt'));
    expect(matOf(g, 2).name).toBe('tarmac');
  });

  it('one material per name, shared across circuits', () => {
    const { load } = stubLoad(), lib = makeTrackLib(load, '/s/');
    const a = root('trk_grass'), b = root('trk_grass');
    applyTrackMaterials(a, lib); applyTrackMaterials(b, lib);
    expect(matOf(a, 0)).toBe(matOf(b, 0));
  });

  it('every planned material has an entry', () => {
    // what build_strip.py exports (tools/blender/test_build_scenery.py NEW)
    const names = ['trk_asphalt', 'trk_rubber', 'trk_marks', 'trk_grass', 'trk_grass_mow', 'trk_gravel', 'trk_solid', 'trk_wall', 'trk_boards',
      'trk_tyres', 'trk_fence', 'trk_stand', 'trk_crowd', 'trk_pit', 'trk_brake', 'trk_trees', 'trk_lamps', 'trk_treeline'];
    for (const n of names) expect(TRACK_TEX[n], n).toBeTruthy();
    expect(Object.keys(TRACK_TEX).sort()).toEqual([...names].sort());
  });

  it('rubber is see-through with a polygon offset; trees cut out their alpha on both sides; the fence is a veil', () => {
    const { load } = stubLoad(), lib = makeTrackLib(load, '/s/');
    const r = lib.material('trk_rubber')!;
    expect(r.transparent && !r.depthWrite && r.polygonOffset).toBe(true);
    for (const n of ['trk_trees', 'trk_treeline']) {
      const m = lib.material(n)!;
      expect(m.alphaTest).toBeGreaterThan(0); expect(m.side).toBe(THREE.DoubleSide);
    }
    // the chain-link is a blended veil: it fades with distance instead of vanishing and leaving its posts alone
    const f = lib.material('trk_fence')!;
    expect(f.transparent && !f.depthWrite && f.alphaTest === 0 && f.side === THREE.DoubleSide && !f.polygonOffset).toBe(true);
    expect(f.forceSinglePass).toBe(true);                                       // one draw, not a back pass and a front pass
  });

  it('flat colours come from palettes made here: a sharp cell per member, in order', () => {
    const { load, urls } = stubLoad(), lib = makeTrackLib(load, '/s/');
    for (const [g, cells] of Object.entries(PALETTES)) {
      const t = mapOf(lib.material(g));
      expect(t.image.width).toBe(Object.keys(cells).length);
      expect(t.magFilter).toBe(THREE.NearestFilter); expect(t.minFilter).toBe(THREE.NearestFilter); expect(t.generateMipmaps).toBe(false);
      Object.values(cells).forEach((c, j) => expect(cell(t, j), g + ' ' + j).toBe(c));
    }
    expect(urls).toEqual([]);
    expect(lib.material('trk_lamps')).toBeInstanceOf(THREE.MeshBasicMaterial);   // the lamps glow: unlit
    expect(lib.material('trk_marks')!.polygonOffset).toBe(true);                  // lines and kerbs lie on the asphalt
  });

  it('the lamps light cell by cell', () => {
    const { load } = stubLoad(), lib = makeTrackLib(load, '/s/');
    const t = mapOf(lib.material('trk_lamps')), v = t.version;
    setLamps(lib, [true, true, false, false, false]);
    expect([0, 1, 2, 3, 4].map(j => cell(t, j))).toEqual([LAMP_ON, LAMP_ON, LAMP_OFF, LAMP_OFF, LAMP_OFF]);
    expect(t.version).toBeGreaterThan(v);
    setLamps(lib, [false, false, false, false, false]);
    expect([0, 1, 2, 3, 4].map(j => cell(t, j))).toEqual([LAMP_OFF, LAMP_OFF, LAMP_OFF, LAMP_OFF, LAMP_OFF]);
  });

  it("the pictures stand the right way up: the glb's UVs are glTF's (v from the top), so no map is flipped", () => {
    const { load } = stubLoad(), lib = makeTrackLib(load, '/s/');
    for (const [name, s] of Object.entries(TRACK_TEX)) {
      if (!s.map) continue;
      const m = lib.material(name) as THREE.MeshStandardMaterial;
      expect(m.map!.flipY, name).toBe(false);
      if (m.normalMap) expect(m.normalMap.flipY, name).toBe(false);
    }
    // the atlases are in tiles: the tree line's u counts its 104 m tiles and v climbs one 26.5 m tile
    expect(TRACK_TEX.trk_treeline.repeat).toEqual([1, 1]);
  });

  it("the relief follows the glTF UVs too: no tangents, so the normal maps' green is turned (as three's GLTFLoader does)", () => {
    const { load } = stubLoad(), lib = makeTrackLib(load, '/s/');
    for (const [name, s] of Object.entries(TRACK_TEX)) {
      if (!s.normal) continue;
      const m = lib.material(name) as THREE.MeshStandardMaterial;
      expect([m.normalScale.x, m.normalScale.y], name).toEqual([.8, -.8]);
    }
  });

  it("the lamp box shares the lamps' palette and stays black when they light", () => {
    const { load } = stubLoad(), lib = makeTrackLib(load, '/s/');
    const t = mapOf(lib.material('trk_lamps'));
    expect(Object.keys(PALETTES.trk_lamps)).toEqual(['trk_lamp1', 'trk_lamp2', 'trk_lamp3', 'trk_lamp4', 'trk_lamp5', 'trk_lamp_box']);
    setLamps(lib, [true, true, true, true, true]);
    expect(cell(t, 5)).toBe(PALETTES.trk_lamps.trk_lamp_box);
    expect(PALETTES.trk_lamps.trk_lamp_box).toBeLessThan(0x202020);
  });

  it('cut-out trees stay hidden until their picture lands (no green boards), and for good if it never does', () => {
    const later: (() => void)[] = [];
    const lib = makeTrackLib((url, ok, fail) => later.push(() => url.endsWith('treeline.webp') ? fail() : ok(new THREE.Texture())), '/s/');
    const trees = lib.material('trk_trees')!, line = lib.material('trk_treeline')!, asphalt = lib.material('trk_asphalt')!;
    expect([trees.visible, line.visible, asphalt.visible]).toEqual([false, false, true]);
    for (const f of later) f();
    expect([trees.visible, line.visible]).toEqual([true, false]);
  });

  it('a texture that fails to load leaves the material its colour', () => {
    const { load } = stubLoad(['asphalt.jpg']), lib = makeTrackLib(load, '/s/');
    const m = lib.material('trk_asphalt') as THREE.MeshStandardMaterial;
    expect(m.map).toBeNull();
    expect(m.color.getHex()).toBe(TRACK_TEX.trk_asphalt.color);
  });

  it('loads each file once, from the base folder', () => {
    const { load, urls } = stubLoad(), lib = makeTrackLib(load, '/s/');
    lib.material('trk_wall'); lib.material('trk_stand'); lib.material('trk_grass'); lib.material('trk_grass_mow');
    expect(urls.filter(u => u === '/s/strip/tex/concrete.jpg').length).toBe(1);
    expect(urls.filter(u => u === '/s/strip/tex/grass.jpg').length).toBe(1);
  });

  it('gives the meshes normals once, for lighting', () => {
    const { load } = stubLoad(), lib = makeTrackLib(load, '/s/');
    const m = mesh('trk_wall');
    m.geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const g = new THREE.Group(); g.add(m); applyTrackMaterials(g, lib);
    expect(m.geometry.getAttribute('normal')).toBeTruthy();
  });
});

describe('the gantry lamps', () => {
  it('light one by one with the start lights and go out at the green', () => {
    expect(gantryLamps(null, true)).toEqual([false, false, false, false, false]);
    expect(gantryLamps(0, true)).toEqual([false, false, false, false, false]);
    expect(gantryLamps(3, true)).toEqual([true, true, true, false, false]);
    expect(gantryLamps(5, true)).toEqual([true, true, true, true, true]);
    expect(gantryLamps(5, false)).toEqual([false, false, false, false, false]);
  });
});
