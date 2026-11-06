import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import * as THREE from 'three';
import { HUB, markerFor } from './district';
import { readTrackSync, setTrackDir } from './districtNode';
import { buildHub, mountTrack, roadRibbons, markerMeshes } from './park';
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

    const scene = new THREE.Scene();
    const m = mountTrack(scene, monza(), { loadModel: async () => model() });
    await m.modelReady;
    const t = resources(m.group);
    const ts = [...t.geos, ...t.mats].map(x => vi.spyOn(x, 'dispose'));
    m.dispose();
    expect(ts.length).toBeGreaterThan(4);
    for (const s of ts) expect(s).toHaveBeenCalled();
  });
});
