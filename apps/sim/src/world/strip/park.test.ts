import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import * as THREE from 'three';
import { HUB, markerFor } from './district';
import { readTrackSync, setTrackDir } from './districtNode';
import { buildHub, mountTrack, roadRibbons, markerMeshes, routeRibbon, gateMeshes } from './park';
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
    const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
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
});
