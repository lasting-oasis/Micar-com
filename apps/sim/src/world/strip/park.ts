/* The Strip's daylight hub and its mountable circuits. The hub (roads, portals, rental lot, exit) is built
   once; each circuit is a group mounted at its offset on demand. Data is in metres (district.ts); geometry
   and positions here are in world units (WORLD_PER_M per metre). Roads are drawn as flat ribbons from the
   data; a Blender model (public/strip/hub.glb, tracks/<id>.glb, metres) replaces them when it loads, and a
   failed load leaves the ribbons; a circuit's model is loaded once a session and cloned per mount. Markers: a ring and a
   beam per event / portal / return spot, and a park-name sign over each portal. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EVENTS, EV_COL, TRACK_NAMES } from '../data';
import { WORLD_PER_M } from '../units';
import { HUB, getAssetBase, type TrackData } from './district';
import type { RoadData } from './routes';

const W = WORLD_PER_M;
export const SKY = 0x9fc5ee;
export const GRASS = 0x5e7a3a;
export const ACCENT = '#ffd23f';
export const TUBE_BLUE = '#79a6ff';
export const CHROME = '#f3f6fb';

export type Loader = (url: string) => Promise<THREE.Object3D>;
/** A marker: x, z in world metres; a portal carries its park's name (label) and, in a browser, a name sprite over the ring. */
export type SceneMarker = { id: string; kind: 'event' | 'portal' | 'return'; x: number; z: number; ring: THREE.Mesh; beam: THREE.Mesh; label?: string; sign?: THREE.Sprite };
/** setVisible hides or shows the hub's scenery (model, ribbons, portal markers) while a circuit is mounted; cpMark stays. */
export type Hub = { scene: THREE.Scene; markers: SceneMarker[]; cpMark: THREE.Group; roads: THREE.Mesh; modelReady: Promise<void>; setVisible(v: boolean): void; dispose(): void };
export type Mounted = { group: THREE.Group; markers: SceneMarker[]; roads: THREE.Mesh; modelReady: Promise<void>; dispose(): void };
/** assetBase defaults to district's setAssetBase setting. */
export type ParkOpts = { loadModel?: Loader | null; assetBase?: string };
const baseOf = (opts: ParkOpts): string => opts.assetBase ?? getAssetBase();

// ---------------------------------------------------------------------------------- textures (browser only)
const hasDom = () => typeof document !== 'undefined';
function ctex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, o: { srgb?: boolean; rep?: boolean } = {}): THREE.CanvasTexture | null {
  if (!hasDom()) return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); if (!g) return null;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (o.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (o.rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
/** A soft white dot (glows, light pools, rival tags). The caller owns (disposes) it. */
export function radialTexture(): THREE.CanvasTexture | null {
  return ctex(128, 128, g => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.35, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); }, { srgb: false });
}

/** A park-name sign (dark rounded box, paint-yellow text), 12 x 3 m, 6 m up; null without a DOM. The caller owns it (disposeSign). */
export function nameSprite(text: string): THREE.Sprite | null {
  const tex = ctex(512, 128, (g, w, h) => {
    g.fillStyle = '#0e1217'; g.beginPath(); if (g.roundRect) g.roundRect(0, 0, w, h, 18); else g.rect(0, 0, w, h); g.fill();
    g.strokeStyle = ACCENT; g.lineWidth = 6; g.stroke();
    g.fillStyle = ACCENT; g.textAlign = 'center'; g.font = "italic 900 74px 'Barlow Condensed','Arial Narrow',sans-serif";
    g.fillText(text, w / 2, 92);
  });
  if (!tex) return null;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(12 * W, 3 * W, 1); s.position.y = 6 * W; s.name = 'sign';
  return s;
}
function disposeSign(s: THREE.Sprite | undefined): void { if (!s) return; s.material.map?.dispose(); s.material.dispose(); }

// ---------------------------------------------------------------------------------- road ribbons
/** Every road as a flat strip at its width, y = .01 m, in world units; loops close. */
export function roadRibbons(roads: RoadData[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const road of roads) {
    let pts = road.pts;
    if (road.loop && pts.length > 1) { const a = pts[0], b = pts[pts.length - 1]; if (a[0] === b[0] && a[1] === b[1]) pts = pts.slice(0, -1); }
    const n = pts.length; if (n < 2) continue;
    const hw = road.width / 2, y = .01 * W;
    const pos: number[] = [], nor: number[] = [], idx: number[] = [];
    const seg = (i: number): [number, number] => {
      const a = pts[i], b = pts[(i + 1) % n]; const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l];
    };
    for (let i = 0; i < n; i++) {
      const prev = i > 0 || road.loop ? seg((i - 1 + n) % n) : seg(0), next = i < n - 1 || road.loop ? seg(i) : seg(n - 2);
      let tx = prev[0] + next[0], tz = prev[1] + next[1]; const l = Math.hypot(tx, tz);
      if (l < 1e-6) { tx = next[0]; tz = next[1]; } else { tx /= l; tz /= l; }
      const nx = -tz, nz = tx; // left of travel
      pos.push((pts[i][0] + nx * hw) * W, y, (pts[i][1] + nz * hw) * W, (pts[i][0] - nx * hw) * W, y, (pts[i][1] - nz * hw) * W);
      nor.push(0, 1, 0, 0, 1, 0);
    }
    const last = road.loop ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % n, l0 = 2 * i, r0 = 2 * i + 1, l1 = 2 * j, r1 = 2 * j + 1;
      idx.push(l0, l1, r0, r0, l1, r1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    parts.push(g);
  }
  if (!parts.length) { const e = new THREE.BufferGeometry(); e.setAttribute('position', new THREE.Float32BufferAttribute([], 3)); return e; }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('strip park: road ribbons do not merge');
  merged.computeBoundingSphere(); merged.computeBoundingBox();
  return merged;
}

// ---------------------------------------------------------------------------------- markers
let ringGeo: THREE.RingGeometry | null = null, beamGeo: THREE.CylinderGeometry | null = null;
const sharedRing = (): THREE.RingGeometry => ringGeo ??= (() => { const g = new THREE.RingGeometry(5.5 * W, 7 * W, 48); g.rotateX(-Math.PI / 2); return g; })();
const sharedBeam = (): THREE.CylinderGeometry => beamGeo ??= new THREE.CylinderGeometry(.5 * W, 1.4 * W, 46 * W, 12, 1, true);

/** A marker's ring (flat on the ground) and beam; materials are per marker, geometries shared. Position them yourself (x, z). */
export function markerMeshes(_kind: SceneMarker['kind'], color: THREE.ColorRepresentation): { ring: THREE.Mesh; beam: THREE.Mesh } {
  const ring = new THREE.Mesh(sharedRing(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false }));
  ring.position.y = .06 * W;
  const beam = new THREE.Mesh(sharedBeam(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .2, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.position.y = 23 * W;
  return { ring, beam };
}

// ---------------------------------------------------------------------------------- model loading
const defaultLoader: Loader = async url => {
  const { GLTFLoader } = await import('three-stdlib');
  return (await new GLTFLoader().loadAsync(url)).scene;
};
function loaderOf(opts: ParkOpts): Loader | null {
  if (opts.loadModel === null) return null;
  if (opts.loadModel) return opts.loadModel;
  return hasDom() ? defaultLoader : null;
}
function disposeObject(root: THREE.Object3D): void {
  root.traverse(o => {
    const m = o as THREE.Mesh; if (!m.geometry) return;
    m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      if (!mat) continue;
      for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
      mat.dispose();
    }
  });
}
/** The circuits' loaded models, per loader and URL, kept for the session: a mount adds a clone (shared geometries and
 *  materials), never the original. A failed load is dropped, so the next entry tries again. */
const modelCache = new WeakMap<Loader, Map<string, Promise<THREE.Object3D>>>();
function cachedLoader(loader: Loader): Loader {
  return async url => {
    let m = modelCache.get(loader); if (!m) modelCache.set(loader, m = new Map());
    const cache = m; let p = cache.get(url);
    if (!p) { const q = loader(url); p = q; cache.set(url, q); q.catch(() => { if (cache.get(url) === q) cache.delete(url); }); }
    return (await p).clone();
  };
}
/** Load a model into `parent` (scaled to world units); hide `roads` on success, warn and keep them on failure.
 *  `shared`: the model is a clone of a cached original, so it owns no geometry or material (nothing to dispose).
 *  `hidden`: the owner is hidden, so the model arrives hidden. */
function attachModel(loader: Loader | null, url: string, parent: THREE.Object3D, roads: THREE.Mesh, label: string, isDisposed: () => boolean, o: { shared?: boolean; hidden?: () => boolean } = {}): { ready: Promise<void>; model(): THREE.Object3D | null } {
  let model: THREE.Object3D | null = null;
  if (!loader) return { ready: Promise.resolve(), model: () => null };
  const ready = (async () => {
    try {
      const root = await loader(url);
      if (isDisposed()) { if (!o.shared) disposeObject(root); return; }
      if (o.hidden?.()) root.visible = false;
      root.scale.setScalar(W);
      root.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.matrixAutoUpdate = false; o.updateMatrix(); } });
      root.name = 'model'; parent.add(root); roads.visible = false; model = root;
    } catch (err) { console.warn(label, err); }
  })();
  return { ready, model: () => model };
}

// ---------------------------------------------------------------------------------- the hub
export function buildHub(opts: ParkOpts = {}): Hub {
  const scene = new THREE.Scene(); scene.name = 'strip';
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.FogExp2(SKY, .0009 / W);
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x7a8a5a, .9 * Math.PI));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4); sun.position.set(200 * W, 300 * W, 100 * W); sun.castShadow = false; scene.add(sun);

  const geos: THREE.BufferGeometry[] = [], mats: THREE.Material[] = [];
  const keepG = <T extends THREE.BufferGeometry>(g: T): T => { geos.push(g); return g; };
  const keepM = <T extends THREE.Material>(m: T): T => { mats.push(m); return m; };

  const ground = new THREE.Mesh(keepG(new THREE.PlaneGeometry(60000 * W, 60000 * W)), keepM(new THREE.MeshStandardMaterial({ color: GRASS, roughness: .95 })));
  ground.rotation.x = -Math.PI / 2; ground.name = 'ground'; scene.add(ground);
  const roads = new THREE.Mesh(keepG(roadRibbons(HUB.roads)), keepM(new THREE.MeshStandardMaterial({ color: 0x2c2f35, roughness: .7 })));
  roads.name = 'roads'; scene.add(roads);

  const markers: SceneMarker[] = [];
  for (const [id, p] of Object.entries(HUB.portals)) {
    const { ring, beam } = markerMeshes('portal', ACCENT);
    ring.position.x = beam.position.x = p[0] * W; ring.position.z = beam.position.z = p[1] * W;
    scene.add(ring, beam);
    const label = TRACK_NAMES[id]?.en ?? id, sign = nameSprite(label) ?? undefined;
    if (sign) { sign.position.x = p[0] * W; sign.position.z = p[1] * W; scene.add(sign); }
    markers.push({ id, kind: 'portal', x: p[0], z: p[1], ring, beam, label, sign });
  }

  const cpMark = new THREE.Group(); cpMark.name = 'cpMark';
  const cpRing = new THREE.Mesh(keepG(new THREE.RingGeometry(6 * W, 7.5 * W, 48)), keepM(new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false })));
  cpRing.rotation.x = -Math.PI / 2; cpRing.position.y = .07 * W; cpMark.add(cpRing);
  const cpBeam = new THREE.Mesh(keepG(new THREE.CylinderGeometry(.6 * W, 1.6 * W, 40 * W, 12, 1, true)), keepM(new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: .2, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })));
  cpBeam.position.y = 20 * W; cpMark.add(cpBeam);
  cpMark.visible = false; scene.add(cpMark);

  let disposed = false, hidden = false;
  const att = attachModel(loaderOf(opts), baseOf(opts) + 'strip/hub.glb', scene, roads, 'strip hub model', () => disposed, { hidden: () => hidden });
  return {
    scene, markers, cpMark, roads, modelReady: att.ready,
    setVisible(v) {
      hidden = !v;
      const m = att.model(); if (m) m.visible = v;
      roads.visible = v && !m; // the model replaces the ribbons once it is in
      for (const mk of markers) { mk.ring.visible = mk.beam.visible = v; if (mk.sign) mk.sign.visible = v; }
    },
    dispose() {
      if (disposed) return; disposed = true;
      const m = att.model(); if (m) disposeObject(m);
      for (const mk of markers) { (mk.ring.material as THREE.Material).dispose(); (mk.beam.material as THREE.Material).dispose(); disposeSign(mk.sign); }
      sharedRing().dispose(); sharedBeam().dispose();
      for (const g of geos) g.dispose();
      for (const x of mats) x.dispose();
      scene.clear();
    },
  };
}

// ---------------------------------------------------------------------------------- a circuit
export function mountTrack(scene: THREE.Scene, track: TrackData, opts: ParkOpts = {}): Mounted {
  const [ox, oz] = track.offset;
  const group = new THREE.Group(); group.name = 'track:' + track.id; group.position.set(ox * W, 0, oz * W);
  const geo = roadRibbons([{ id: 'centre', pts: track.centre.pts, loop: true, width: track.centre.width }]);
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x2c2f35, roughness: .7 });
  const roads = new THREE.Mesh(geo, roadMat); roads.name = 'roads'; group.add(roads);

  const markers: SceneMarker[] = [];
  const put = (id: string, kind: SceneMarker['kind'], local: [number, number], color: THREE.ColorRepresentation) => {
    const { ring, beam } = markerMeshes(kind, color);
    ring.position.x = beam.position.x = local[0] * W; ring.position.z = beam.position.z = local[1] * W;
    group.add(ring, beam); markers.push({ id, kind, x: local[0] + ox, z: local[1] + oz, ring, beam });
  };
  for (const [id, p] of Object.entries(track.markers)) {
    const ev = EVENTS.find(e => e.id === id);
    put(id, 'event', p, (ev && EV_COL[ev.type]) || ACCENT);
  }
  put(track.id, 'return', track.return, CHROME);
  scene.add(group);

  let disposed = false;
  const loader = loaderOf(opts);
  const att = attachModel(loader && cachedLoader(loader), baseOf(opts) + 'strip/tracks/' + track.id + '.glb', group, roads, 'strip track model ' + track.id, () => disposed, { shared: true });
  return {
    group, markers, roads, modelReady: att.ready,
    dispose() {
      if (disposed) return; disposed = true;
      group.removeFromParent();
      // the model is a clone of the session's cached original: its geometries and materials stay for the next entry,
      // and so do the markers' shared ring and beam geometries (the hub's portals use them too)
      for (const mk of markers) { (mk.ring.material as THREE.Material).dispose(); (mk.beam.material as THREE.Material).dispose(); }
      geo.dispose(); roadMat.dispose();
      group.clear();
    },
  };
}
