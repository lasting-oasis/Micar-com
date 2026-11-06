/* Night Tuner 05-world.js buildCity — the Strip's night city: block slabs, towers with lit facades,
   parks, neon signs, street lights with their pools of light, lane dashes and crossings, event markers
   and the checkpoint mark. Laid out in metres as in Night Tuner (seeded), then baked to world units
   (WORLD_PER_M per metre): every geometry here is in world units, every position too.
   Brand colours: night ground #0e1217, signs in paint yellow / steel ("tube") blue / chrome, the
   checkpoint mark in the accent yellow, markers by event type (EV_COL). Textures are made only in a
   browser (tests run in node: no textures, same geometry). */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EVENTS, EV_COL, type EventDef } from '../data';
import { WORLD_PER_M } from '../units';
import { N, CELL, RW, BL, SPAN } from './routes';

const W = WORLD_PER_M;
export const NIGHT_GROUND = 0x0e1217;
export const ACCENT = '#ffd23f';
export const TUBE_BLUE = '#79a6ff';
export const CHROME = '#f3f6fb';

export type StripMarker = { ev: EventDef; x: number; z: number; ring: THREE.Mesh; beam: THREE.Mesh };
export type City = { scene: THREE.Scene; markers: StripMarker[]; cpMark: THREE.Group; dispose(): void };

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

// ---------------------------------------------------------------------------------- geometry helpers
const placed = (geo: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry => { const g = geo.clone(); g.translate(x, y, z); return g; };
/** merge (metres), free the parts, bake to world units */
function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(list, false);
  for (const p of list) p.dispose();
  if (!g) throw new Error('strip city: geometries do not merge');
  g.scale(W, W, W); g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
function tint(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** The Strip's city for this seed (Night Tuner used 7). */
export function buildCity(seed: number): City {
  let sd = Math.max(1, Math.floor(seed) % 2147483647);
  const rnd = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
  const geos: THREE.BufferGeometry[] = [], mats: THREE.Material[] = [], texs: THREE.Texture[] = [];
  const keepT = <T extends THREE.Texture | null>(t: T): T => { if (t) texs.push(t); return t; };
  const keepM = <T extends THREE.Material>(m: T): T => { mats.push(m); return m; };

  const s = new THREE.Scene(); s.name = 'strip';
  s.background = new THREE.Color(NIGHT_GROUND);
  s.fog = new THREE.FogExp2(NIGHT_GROUND, .0062 / W);
  s.add(new THREE.HemisphereLight(0x3a4a78, 0x0b0806, .35 * Math.PI));
  const moon = new THREE.DirectionalLight(0x8fa6d8, .35 * Math.PI); moon.position.set(-40 * W, 80 * W, -30 * W); s.add(moon);

  // ground: asphalt
  const asph = keepT(ctex(256, 256, g => { g.fillStyle = '#17191e'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 5000; i++) { const v = 20 + Math.random() * 28 | 0; g.fillStyle = `rgb(${v},${v},${v + 4})`; g.fillRect(Math.random() * 256, Math.random() * 256, 1.4, 1.4); } }, { rep: true }));
  if (asph) asph.repeat.set(120, 120);
  const groundGeo = new THREE.PlaneGeometry((SPAN + CELL * 8) * W, (SPAN + CELL * 8) * W); geos.push(groundGeo);
  const ground = new THREE.Mesh(groundGeo, keepM(new THREE.MeshStandardMaterial({ map: asph, color: asph ? 0xffffff : 0x17191e, roughness: .5, metalness: .25, envMapIntensity: .4 })));
  ground.rotation.x = -Math.PI / 2; ground.position.set(SPAN / 2 * W, 0, SPAN / 2 * W); ground.name = 'ground'; s.add(ground);

  // facades: windows (lit ones also in the emissive map)
  const facade = (emis: boolean) => ctex(256, 512, g => {
    g.fillStyle = emis ? '#000' : '#14161c'; g.fillRect(0, 0, 256, 512);
    for (let r = 0; r < 16; r++) for (let c = 0; c < 8; c++) {
      const p = Math.random(); let col: string;
      if (p < .28) col = emis ? (Math.random() < .6 ? '#ffb35c' : '#a9d4ff') : (Math.random() < .6 ? '#ffd08a' : '#cfe6ff');
      else col = emis ? '#000' : (p < .6 ? '#1b2230' : '#252c3a');
      g.fillStyle = col; g.fillRect(c * 32 + 6, r * 32 + 7, 20, 18);
    }
    g.fillStyle = emis ? '#000' : '#101217'; g.fillRect(0, 0, 4, 512);
  }, { rep: true });
  const fT = keepT(facade(false)), fE = keepT(facade(true));

  const blds: THREE.BufferGeometry[] = [], slabs: THREE.BufferGeometry[] = [], parks: THREE.BufferGeometry[] = [], trees: THREE.BufferGeometry[] = [], signs: THREE.BufferGeometry[] = [];
  const poles: THREE.BufferGeometry[] = [], heads: THREE.BufferGeometry[] = [], pools: THREE.BufferGeometry[] = [], dashes: THREE.BufferGeometry[] = [];
  const lampPts: number[] = [];
  // a tower: the facade texture tiles one window per 2 m across, per 2 m up; roofs and floors take a dark texel
  const bgeo = (w: number, h: number, d: number, x: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv as THREE.BufferAttribute;
    const du = Math.floor(rnd() * 8) / 8, dv = Math.floor(rnd() * 16) / 16;
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k; if (f === 2 || f === 3) { uv.setXY(i, .004, .5); continue; }
      const fw = (f < 2 ? d : w) / 16; uv.setXY(i, uv.getX(i) * fw + du, uv.getY(i) * (h / 32) + dv);
    }
    g.translate(x, h / 2, z); return g;
  };
  const SIGN_COLS = [ACCENT, TUBE_BLUE, CHROME, ACCENT, TUBE_BLUE];
  for (let i = -1; i <= N; i++) for (let j = -1; j <= N; j++) {
    const x0 = i * CELL + RW / 2, z0 = j * CELL + RW / 2; const border = i < 0 || j < 0 || i >= N || j >= N;
    if (border) { const h = 30 + rnd() * 70; blds.push(bgeo(BL - 6, h, BL - 6, x0 + BL / 2, z0 + BL / 2)); continue; }
    const park = rnd() < .12;
    const sl = new THREE.BoxGeometry(BL, .22, BL); sl.translate(x0 + BL / 2, .11, z0 + BL / 2); (park ? parks : slabs).push(sl);
    if (park) {
      for (let k = 0; k < 14; k++) {
        const tx = x0 + 6 + rnd() * (BL - 12), tz = z0 + 6 + rnd() * (BL - 12), th = 4 + rnd() * 4;
        const c = new THREE.ConeGeometry(1.6 + rnd(), th, 7); c.translate(tx, th / 2 + 1.6, tz); trees.push(c);
        const t = new THREE.CylinderGeometry(.18, .22, 1.8, 6); t.translate(tx, .9, tz); trees.push(t);
      }
    } else {
      const split = rnd();
      const lots = split < .3 ? [[0, 0, 1, 1]] : split < .65 ? [[0, 0, .5, 1], [.5, 0, .5, 1]] : [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]];
      for (const [lx, lz, lw, ld] of lots) {
        const w = (BL - 8) * lw - 3, d = (BL - 8) * ld - 3, h = 12 + Math.pow(rnd(), 1.6) * 85;
        const cx = x0 + 4 + (BL - 8) * (lx + lw / 2), cz = z0 + 4 + (BL - 8) * (lz + ld / 2); blds.push(bgeo(w, h, d, cx, cz));
        if (rnd() < .45) {
          const col = new THREE.Color(SIGN_COLS[rnd() * 5 | 0]).multiplyScalar(2.2); const sy = 4 + rnd() * Math.min(18, h - 6); const side = rnd() < .5;
          const sg = new THREE.BoxGeometry(side ? .3 : Math.min(w * .6, 10), side ? Math.min(12, h * .4) : 1.4, side ? Math.min(d * .6, 10) : .3);
          sg.translate(cx + (side ? (w / 2 + .2) * (rnd() < .5 ? -1 : 1) : 0), sy, cz + (side ? 0 : (d / 2 + .2) * (rnd() < .5 ? -1 : 1)));
          signs.push(tint(sg, col));
        }
      }
    }
    for (const t of [.18, .82]) for (const [px, pz, nx, nz] of [[x0 + 1.2, z0 + t * BL, -1, 0], [x0 + BL - 1.2, z0 + t * BL, 1, 0], [x0 + t * BL, z0 + 1.2, 0, -1], [x0 + t * BL, z0 + BL - 1.2, 0, 1]]) {
      if (rnd() < .35) continue;
      const p = new THREE.CylinderGeometry(.13, .16, 8, 8); p.translate(px, 4, pz); poles.push(p);
      const a = new THREE.BoxGeometry(nx ? 2.6 : .14, .14, nz ? 2.6 : .14); a.translate(px + nx * 1.3, 7.9, pz + nz * 1.3); poles.push(a);
      const hd = new THREE.BoxGeometry(nx ? .9 : .5, .18, nz ? .9 : .5); hd.translate(px + nx * 2.4, 7.82, pz + nz * 2.4); heads.push(hd);
      lampPts.push((px + nx * 2.4) * W, (7.82 - .1) * W, (pz + nz * 2.4) * W);
      const pl = new THREE.PlaneGeometry(22, 22); pl.rotateX(-Math.PI / 2); pl.translate(px + nx * 4.5, .04, pz + nz * 4.5); pools.push(pl);
    }
  }
  // lane dashes and crossings
  const dg = new THREE.PlaneGeometry(.22, 3); dg.rotateX(-Math.PI / 2); const dgx = dg.clone(); dgx.rotateY(Math.PI / 2);
  const cw = new THREE.PlaneGeometry(.7, 5); cw.rotateX(-Math.PI / 2); const cwx = cw.clone(); cwx.rotateY(Math.PI / 2);
  for (let i = 0; i <= N; i++) for (let j = 0; j < N; j++) {
    for (let z = j * CELL + RW / 2 + 8; z < (j + 1) * CELL - RW / 2 - 4; z += 8) { dashes.push(placed(dg, i * CELL, .03, z)); dashes.push(placed(dgx, z, .03, i * CELL)); }
    for (let k = -6; k <= 6; k++) {
      dashes.push(placed(cwx, i * CELL + k * 1.3, .03, j * CELL + RW / 2 + 3)); dashes.push(placed(cwx, i * CELL + k * 1.3, .03, (j + 1) * CELL - RW / 2 - 3));
      dashes.push(placed(cw, j * CELL + RW / 2 + 3, .03, i * CELL + k * 1.3)); dashes.push(placed(cw, (j + 1) * CELL - RW / 2 - 3, .03, i * CELL + k * 1.3));
    }
  }
  [dg, dgx, cw, cwx].forEach(g => g.dispose());

  const radial = keepT(radialTexture());
  const mk = (name: string, list: THREE.BufferGeometry[], mat: THREE.Material): THREE.Mesh | null => {
    keepM(mat); if (!list.length) return null;
    const g = merge(list); geos.push(g); const m = new THREE.Mesh(g, mat); m.name = name; m.matrixAutoUpdate = false; s.add(m); return m;
  };
  mk('blds', blds, new THREE.MeshStandardMaterial({ map: fT, emissiveMap: fE, emissive: fE ? new THREE.Color(1, .95, .9) : new THREE.Color(0), color: fT ? 0x9aa0aa : 0x1b2230, roughness: .8, metalness: .2, envMapIntensity: .25 }));
  mk('slabs', slabs, new THREE.MeshStandardMaterial({ color: 0x1d2026, roughness: .9, envMapIntensity: .3 }));
  mk('parks', parks, new THREE.MeshStandardMaterial({ color: 0x10241a, roughness: .95 }));
  mk('trees', trees, new THREE.MeshStandardMaterial({ color: 0x0f2a1c, roughness: .9 }));
  mk('signs', signs, new THREE.MeshBasicMaterial({ vertexColors: true }));
  mk('poles', poles, new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: .7, roughness: .4 }));
  mk('heads', heads, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, .62, .28).multiplyScalar(2.4) }));
  const pm = mk('pools', pools, new THREE.MeshBasicMaterial({ map: radial, color: new THREE.Color(1, .55, .2), transparent: true, opacity: radial ? .3 : 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  if (pm) pm.renderOrder = 2;
  mk('dashes', dashes, new THREE.MeshBasicMaterial({ color: 0x8a8e96 }));
  // lamp glows
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(lampPts, 3)); pg.computeBoundingSphere(); geos.push(pg);
  const lamps = new THREE.Points(pg, keepM(new THREE.PointsMaterial({ map: radial, color: 0xffa04a, size: 7 * W, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: .75 })));
  lamps.name = 'lamps'; s.add(lamps);

  // event markers: a ring on the road and a beam of light, at the event's first node
  const ringGeo = new THREE.RingGeometry(5.5 * W, 7 * W, 48), beamGeo = new THREE.CylinderGeometry(.5 * W, 1.4 * W, 46 * W, 12, 1, true); geos.push(ringGeo, beamGeo);
  const markers: StripMarker[] = [];
  for (const ev of EVENTS) {
    const col = new THREE.Color(EV_COL[ev.type]); const x = ev.nodes[0][0] * CELL * W, z = ev.nodes[0][1] * CELL * W;
    const ring = new THREE.Mesh(ringGeo, keepM(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .75, side: THREE.DoubleSide, depthWrite: false })));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, .06 * W, z); s.add(ring);
    const beam = new THREE.Mesh(beamGeo, keepM(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })));
    beam.position.set(x, 23 * W, z); s.add(beam);
    markers.push({ ev, x, z, ring, beam });
  }
  // the checkpoint mark (placed by the scene)
  const cpMark = new THREE.Group(); cpMark.name = 'cpMark';
  const cpRingGeo = new THREE.RingGeometry(6 * W, 7.5 * W, 48), cpBeamGeo = new THREE.CylinderGeometry(.6 * W, 1.6 * W, 40 * W, 12, 1, true); geos.push(cpRingGeo, cpBeamGeo);
  const cpRing = new THREE.Mesh(cpRingGeo, keepM(new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false })));
  cpRing.rotation.x = -Math.PI / 2; cpRing.position.y = .07 * W; cpMark.add(cpRing);
  const cpBeam = new THREE.Mesh(cpBeamGeo, keepM(new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: .2, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })));
  cpBeam.position.y = 20 * W; cpMark.add(cpBeam);
  cpMark.visible = false; s.add(cpMark);

  let disposed = false;
  return {
    scene: s, markers, cpMark,
    dispose() {
      if (disposed) return; disposed = true;
      for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); for (const t of texs) t.dispose();
      s.clear();
    },
  };
}
