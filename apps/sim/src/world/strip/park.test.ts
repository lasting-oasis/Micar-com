import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import * as THREE from 'three';
import { HUB, markerFor } from './district';
import { readTrackSync, setTrackDir } from './districtNode';
import { buildHub, dressSky, gltfLoader, mountTrack, nameSprite, roadRibbons, markerMeshes, routeRibbon, gateMeshes, HORIZON, OVERCAST, SKY } from './park';
import { makeTrackLib } from './trackMaterials';
import { buildRoute } from './routes';
import { WORLD_PER_M as W } from '../units';

setTrackDir(path.resolve(process.cwd(), 'public/strip/tracks'));
const monza = () => readTrackSync('monza');

function resources(root: THREE.Object3D): { geos: Set<THREE.BufferGeometry>; mats: Set<THREE.Material> } {
  const geos = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>();
  root.traverse(o => {
    const m = o as THREE.Mesh; if (!m.geometry) return;
    geos.add(m.geometry);
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) mats.add(x);
  });
  return { geos, mats };
}

describe('route ribbon and gates', () => {
  it('routeRibbon covers the route in world units with 2 vertices per sample, lifted to .06 W', () => {
    const m = routeRibbon(buildRoute([[0, 0], [100, 0]], false));
    expect(m.name).toBe('routeRibbon');
    const box = new THREE.Box3().setFromObject(m);
    expect(box.min.x).toBeCloseTo(0, 3); expect(box.max.x).toBeCloseTo(100 * W, 3);
    expect(m.geometry.getAttribute('position').count).toBe(4);
    expect(box.min.y).toBeCloseTo(.06 * W, 4);
    expect(m.renderOrder).toBe(1);
  });
  it('gateMeshes makes two posts and a beam at the given width', () => {
    const g = gateMeshes(20);
    expect(g.name).toBe('cpGate');
    const posts = g.children.filter(c => Math.abs(Math.abs(c.position.x) - 10 * W) < 1e-6);
    expect(posts).toHaveLength(2);
    const box = new THREE.Box3().setFromObject(g);
    expect(box.max.y).toBeCloseTo(6.2 * W, 3);
  });
});

describe('park', () => {
  it('buildHub places one portal marker per track at HUB.portals in world units', () => {
    const hub = buildHub({ loadModel: null });
    const portals = hub.markers.filter(m => m.kind === 'portal');
    expect(portals).toHaveLength(10);
    for (const m of portals) {
      expect(m.ring.position.x).toBe(HUB.portals[m.id][0] * W);
      expect(m.x).toBe(HUB.portals[m.id][0]);
      expect(m.z).toBe(HUB.portals[m.id][1]);
    }
    expect(hub.scene.name).toBe('strip');
    hub.dispose();
  });

  it('the hub roads ribbon covers the hub bounds', () => {
    const hub = buildHub({ loadModel: null });
    hub.roads.geometry.computeBoundingBox();
    const bb = hub.roads.geometry.boundingBox!, b = HUB.bounds, m = 20;
    expect(bb.min.x).toBeLessThanOrEqual((b.minX + m) * W);
    expect(bb.min.z).toBeLessThanOrEqual((b.minZ + m) * W);
    expect(bb.max.x).toBeGreaterThanOrEqual((b.maxX - m) * W);
    expect(bb.max.z).toBeGreaterThanOrEqual((b.maxZ - m) * W);
    hub.dispose();
  });

  it('ribbons face up and loops close', () => {
    const g = roadRibbons([{ id: 'sq', pts: [[0, 0], [10, 0], [10, 10], [0, 10]], loop: true, width: 4 }]);
    expect(g.index!.count).toBe(4 * 6);
    const p = g.getAttribute('position'), ix = g.index!;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < ix.count; i += 3) {
      a.fromBufferAttribute(p, ix.getX(i)); b.fromBufferAttribute(p, ix.getX(i + 1)); c.fromBufferAttribute(p, ix.getX(i + 2));
      expect(b.sub(a).cross(c.sub(a)).y).toBeGreaterThan(0);
    }
  });

  it('markerMeshes builds a ring and a beam with their own materials', () => {
    const a = markerMeshes('event', '#fff'), b = markerMeshes('event', '#fff');
    expect(a.ring.material).not.toBe(b.ring.material);
    expect(a.ring.geometry).toBe(b.ring.geometry);
    expect((a.beam.material as THREE.MeshBasicMaterial).blending).toBe(THREE.AdditiveBlending);
  });

  it('a failing model load leaves the hub usable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hub = buildHub({ loadModel: () => Promise.reject(new Error('offline')) });
    await expect(hub.modelReady).resolves.toBeUndefined();
    expect(hub.roads.visible).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore(); hub.dispose();
  });

  it('a loaded model hides the ribbons and is scaled to world units', async () => {
    const hub = buildHub({ loadModel: async () => new THREE.Group() });
    await hub.modelReady;
    expect(hub.scene.getObjectByName('model')!.scale.x).toBe(W);
    expect(hub.roads.visible).toBe(false);
    hub.dispose();
  });

  it('mountTrack places the group at the offset and reports markers in world metres', () => {
    const track = monza(), scene = new THREE.Scene();
    const m = mountTrack(scene, track, { loadModel: null });
    expect(m.group.position.x).toBe(track.offset[0] * W);
    expect(m.group.position.z).toBe(track.offset[1] * W);
    expect(scene.children).toContain(m.group);
    const ev = m.markers.filter(k => k.kind === 'event');
    expect(ev.length).toBe(Object.keys(track.markers).length);
    for (const k of ev) { const [x, z] = markerFor(k.id); expect(k.x).toBeCloseTo(x, 2); expect(k.z).toBeCloseTo(z, 2); }
    const ret = m.markers.find(k => k.kind === 'return')!;
    expect(ret.x).toBeCloseTo(track.return[0] + track.offset[0], 2);
    expect(ret.z).toBeCloseTo(track.return[1] + track.offset[1], 2);
    m.dispose();
    expect(scene.children).not.toContain(m.group);
  });

  it('a mounted track failed model keeps its ribbons', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = mountTrack(new THREE.Scene(), monza(), { loadModel: () => Promise.reject(new Error('offline')) });
    await m.modelReady;
    expect(m.roads.visible).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore(); m.dispose();
  });

  it('a loaded track model hides them', async () => {
    let url = '';
    const m = mountTrack(new THREE.Scene(), monza(), { loadModel: async u => { url = u; return new THREE.Group(); }, assetBase: '/base/' });
    await m.modelReady;
    expect(url).toBe('/base/strip/tracks/monza.glb');
    expect(m.group.getObjectByName('model')!.scale.x).toBe(W);
    expect(m.roads.visible).toBe(false);
    m.dispose();
  });

  it('dispose frees every geometry and material', async () => {
    const model = () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const hub = buildHub({ loadModel: async () => model() });
    await hub.modelReady;
    const h = resources(hub.scene);
    const hs = [...h.geos, ...h.mats].map(x => vi.spyOn(x, 'dispose'));
    hub.dispose();
    expect(hs.length).toBeGreaterThan(4);
    for (const s of hs) expect(s).toHaveBeenCalled();

    // a circuit frees its own ribbons and marker materials; the cached model's and the shared marker geometries stay
    const scene = new THREE.Scene();
    const m = mountTrack(scene, monza(), { loadModel: async () => model() });
    await m.modelReady;
    const t = resources(m.group), mod = resources(m.group.getObjectByName('model')!);
    const shared = new Set<unknown>([m.markers[0].ring.geometry, m.markers[0].beam.geometry, ...mod.geos, ...mod.mats]);
    const own = [...t.geos, ...t.mats].filter(x => !shared.has(x)).map(x => vi.spyOn(x, 'dispose'));
    const kept = [...shared].map(x => vi.spyOn(x as THREE.Material, 'dispose'));
    m.dispose();
    expect(own.length).toBeGreaterThan(4);
    for (const s of own) expect(s).toHaveBeenCalled();
    for (const s of kept) expect(s).not.toHaveBeenCalled();
  });

  it('a circuit\'s model loads once a session and each mount gets its own clone', async () => {
    let loads = 0;
    const box = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const loadModel = async () => { loads++; const g = new THREE.Group(); g.add(box); return g; };
    const scene = new THREE.Scene();
    const a = mountTrack(scene, monza(), { loadModel }); await a.modelReady;
    const first = a.group.getObjectByName('model')!; a.dispose();
    const b = mountTrack(scene, monza(), { loadModel }); await b.modelReady;
    const second = b.group.getObjectByName('model')!;
    expect(loads).toBe(1);
    expect(second).not.toBe(first);
    expect((second.children[0] as THREE.Mesh).geometry).toBe(box.geometry); // shared, not copied
    b.dispose();
  });

  it('a failed circuit model is tried again on the next mount', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let loads = 0;
    const loadModel = async () => { loads++; if (loads === 1) throw new Error('offline'); return new THREE.Group(); };
    const a = mountTrack(new THREE.Scene(), monza(), { loadModel }); await a.modelReady; a.dispose();
    const b = mountTrack(new THREE.Scene(), monza(), { loadModel }); await b.modelReady;
    expect(loads).toBe(2); expect(b.roads.visible).toBe(false);
    warn.mockRestore(); b.dispose();
  });

  it('setVisible hides and shows the hub scenery (ribbons, portal rings and beams)', async () => {
    const hub = buildHub({ loadModel: null });
    hub.setVisible(false);
    expect(hub.roads.visible).toBe(false);
    for (const m of hub.markers) { expect(m.ring.visible).toBe(false); expect(m.beam.visible).toBe(false); }
    hub.setVisible(true);
    expect(hub.roads.visible).toBe(true);
    for (const m of hub.markers) { expect(m.ring.visible).toBe(true); expect(m.beam.visible).toBe(true); }
    hub.dispose();
    const withModel = buildHub({ loadModel: async () => new THREE.Group() }); await withModel.modelReady;
    withModel.setVisible(false); expect(withModel.scene.getObjectByName('model')!.visible).toBe(false); expect(withModel.roads.visible).toBe(false);
    withModel.setVisible(true); expect(withModel.scene.getObjectByName('model')!.visible).toBe(true); expect(withModel.roads.visible).toBe(false);
    withModel.dispose();
  });

  it('portals carry their park names; a name sprite only with a DOM, freed by dispose', () => {
    const hub = buildHub({ loadModel: null });
    const portals = hub.markers.filter(m => m.kind === 'portal');
    expect(portals).toHaveLength(10);
    expect(portals.find(m => m.id === 'monza')!.label).toBe('Royal Park');
    expect(portals.every(m => m.sign === undefined)).toBe(true); // node: no canvas
    hub.dispose();

    // a minimal DOM: a canvas whose 2D context swallows every call
    const ctx = new Proxy({}, { get: (_t, k) => k === 'measureText' ? (text: string) => ({ width: text.length * 34 }) : () => {}, set: () => true });
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
    try {
      const h = buildHub({ loadModel: null });
      const ps = h.markers.filter(m => m.kind === 'portal');
      expect(ps).toHaveLength(10);
      const sign = ps[0].sign!;
      expect(sign).toBeInstanceOf(THREE.Sprite);
      expect(sign.position.y).toBe(6 * W); expect(sign.scale.x).toBe(12 * W);
      const mat = vi.spyOn(sign.material, 'dispose'), tex = vi.spyOn(sign.material.map!, 'dispose');
      h.setVisible(false); expect(sign.visible).toBe(false); h.setVisible(true);
      h.dispose();
      expect(mat).toHaveBeenCalled(); expect(tex).toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("a long name is set smaller so that it fits the sign: a racer's name tag", () => {
    // a canvas that records the fonts it is given, and measures text at 34 px a character at 74 px
    const fonts: string[] = [];
    let px = 74;
    const ctx = new Proxy({}, {
      get: (_t, k) => k === 'measureText' ? (text: string) => ({ width: text.length * 34 * px / 74 }) : () => {},
      set: (_t, k, v) => { if (k === 'font') { fonts.push(String(v)); px = Number(/(\d+)px/.exec(String(v))![1]); } return true; },
    });
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
    try {
      const short = nameSprite('Royal Park')!;                   // 340 px of 512: as it was
      expect(fonts[fonts.length - 1]).toContain('74px');
      const long = nameSprite('W'.repeat(24))!;                  // 816 px at 74: set at 42 px to fit 464
      expect(fonts[fonts.length - 1]).toContain('42px');
      short.material.map?.dispose(); short.material.dispose(); long.material.map?.dispose(); long.material.dispose();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('the circuits\' look', () => {
  it('a loaded circuit model gets the session\'s circuit materials, shared by every mount', async () => {
    const lib = makeTrackLib((_u, ok) => ok(new THREE.Texture()), '/b/');
    const model = new THREE.Group(); const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    (mesh.material as THREE.Material).name = 'trk_asphalt'; model.add(mesh);
    const loadModel = async () => model;
    const a = mountTrack(new THREE.Scene(), monza(), { loadModel, trackLib: lib }); await a.modelReady;
    const b = mountTrack(new THREE.Scene(), monza(), { loadModel, trackLib: lib }); await b.modelReady;
    const mat = (g: THREE.Object3D) => { let f: THREE.Material | null = null; g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && (m.material as THREE.Material).name === 'trk_asphalt') f = m.material as THREE.Material; }); return f; };
    expect(mat(a.group)).toBe(lib.material('trk_asphalt'));
    expect(mat(b.group)).toBe(lib.material('trk_asphalt'));
  });

  it('the ground follows the camera in whole grass tiles, in cells small enough that the circuits’ asphalt stays on top', () => {
    // a ground of two 60 km triangles lost depth precision far from the origin and hid the asphalt from some cameras
    const hub = buildHub({ loadModel: null });
    const ground = hub.scene.getObjectByName('ground') as THREE.Mesh;
    const p = (ground.geometry as THREE.PlaneGeometry).parameters;
    expect(p.width / p.widthSegments).toBeLessThanOrEqual(512);
    expect(p.height / p.heightSegments).toBeLessThanOrEqual(512);
    expect(Math.min(p.width, p.height) / 2).toBeGreaterThanOrEqual(6500);      // to the far plane every way
    expect(ground.frustumCulled).toBe(false);
    const cam = new THREE.PerspectiveCamera(62, 1.6, 1, 6500); cam.position.set(32105.3, 35.6, 15946.3); cam.updateMatrixWorld();
    ground.onBeforeRender({} as THREE.WebGLRenderer, hub.scene, cam, ground.geometry, ground.material as THREE.Material, null as unknown as THREE.Group);
    const at = new THREE.Vector3().setFromMatrixPosition(ground.matrixWorld);
    expect([at.x, at.y, at.z]).toEqual([32104, 0, 15944]);                 // snapped to 4 m (8 units): the grass never slides
  });

  it('the circuits’ sky is the CC0 panorama and their ground grass, tiled every 4 m; a failed load keeps the flat colours', () => {
    const look = { sky: null as THREE.Texture | null, ground: new THREE.MeshStandardMaterial({ color: 0x5e7a3a }), changed: vi.fn() };
    const urls: string[] = [];
    dressSky(look, 100, (u, ok) => { urls.push(u); ok(new THREE.Texture()); }, '/b/');
    expect(urls).toEqual(['/b/strip/tex/sky.jpg', '/b/strip/tex/grass.jpg']);
    expect(look.sky!.mapping).toBe(THREE.EquirectangularReflectionMapping); expect(look.changed).toHaveBeenCalled();
    // no mipmaps on the panorama: at its seam u jumps from 1 to 0, and a mipmapped sky would draw a line down the sky there
    expect(look.sky!.generateMipmaps).toBe(false); expect(look.sky!.minFilter).toBe(THREE.LinearFilter);
    expect(look.ground.map).toBeTruthy(); expect(look.ground.map!.repeat.x).toBeCloseTo(100 / W / 4);
    const look2 = { sky: null as THREE.Texture | null, ground: new THREE.MeshStandardMaterial({ color: 0x5e7a3a }), changed: vi.fn() };
    dressSky(look2, 100, (_u, _ok, fail) => fail(), '/b/');
    expect(look2.sky).toBeNull(); expect(look2.ground.map).toBeNull(); expect(look2.changed).not.toHaveBeenCalled();
  });

  it('the hub keeps its sunny flat look; a circuit gets an overcast day: grey sky and fog, a weaker sun, more sky light', () => {
    const hub = buildHub({ loadModel: null }), s = hub.scene, fog = s.fog as THREE.FogExp2;
    const find = <T,>(test: (o: THREE.Object3D) => boolean) => { let f: T | null = null; s.traverse(o => { if (!f && test(o)) f = o as T; }); return f!; };
    const hemi = find<THREE.HemisphereLight>(o => (o as THREE.HemisphereLight).isHemisphereLight);
    const sun = find<THREE.DirectionalLight>(o => (o as THREE.DirectionalLight).isDirectionalLight);
    const ground = s.getObjectByName('ground') as THREE.Mesh, flat = ground.material;
    expect((s.background as THREE.Color).getHex()).toBe(SKY); expect(fog.color.getHex()).toBe(SKY);
    const sunny = [sun.intensity, hemi.intensity];
    hub.setWeather('circuit');
    expect((s.background as THREE.Color).getHex()).toBe(OVERCAST); expect(fog.color.getHex()).toBe(OVERCAST);   // no panorama in a test
    expect(sun.intensity).toBeLessThan(sunny[0]); expect(hemi.intensity).toBeGreaterThan(sunny[1]);
    expect(ground.material).not.toBe(flat);                                   // the textured grass
    hub.setWeather('hub');
    expect((s.background as THREE.Color).getHex()).toBe(SKY); expect(fog.color.getHex()).toBe(SKY);
    expect([sun.intensity, hemi.intensity]).toEqual(sunny); expect(ground.material).toBe(flat);
    expect(HORIZON).not.toBe(SKY);
  });
});

describe('the circuit model loader', () => {
  it('decodes on at most two workers, and starts the decoder afresh after a failed load', async () => {
    const made: { limit: number; disposed: boolean }[] = [];
    class Draco { s = { limit: 0, disposed: false }; constructor() { made.push(this.s); } setDecoderPath() {} setDecoderConfig() {} setWorkerLimit(n: number) { this.s.limit = n; } dispose() { this.s.disposed = true; } }
    let fail = true;
    class Gltf { setDRACOLoader() {} async loadAsync() { if (fail) throw new Error('no decoder'); return { scene: new THREE.Group() }; } }
    const load = gltfLoader(async () => ({ GLTFLoader: Gltf, DRACOLoader: Draco }) as never, () => '/b/');
    await expect(load('/b/strip/tracks/spa.glb')).rejects.toThrow('no decoder');
    expect(made).toEqual([{ limit: 2, disposed: true }]);
    fail = false;
    await expect(load('/b/strip/tracks/spa.glb')).resolves.toBeInstanceOf(THREE.Group);
    await load('/b/strip/tracks/monza.glb');
    expect(made).toEqual([{ limit: 2, disposed: true }, { limit: 2, disposed: false }]);   // one decoder, kept
  });
});

