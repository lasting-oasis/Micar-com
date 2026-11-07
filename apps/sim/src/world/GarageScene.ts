/* The Garage's turntable: Night Tuner 07-garage.js's garage scene (floor grid, turntable and its ring,
   back and side walls, light tubes, cabinets, tyre stacks, key and rim spotlights), its CAMS and orbit
   camera (drag, wheel, slow auto-turn), with the lofted car and its kit for the previewed cfg.
   Units: world units, Night Tuner's metres x WORLD_PER_M. MiCar identity: tubes and ring in paint
   yellow, the floor night. The lofted bodies face -Z; the car is turned to face +Z as Night Tuner's.
   It owns its renderer (a second canvas over the world); dispose() frees everything it made. */
import * as THREE from 'three';
import { buildCarModel, disposeCarModel, setCarLights } from '../scene/carModel';
import { attachParts, disposeParts, syncKitLod, type PartsKit } from './parts';
import { clamp } from './physics';
import type { BodyStyle, CarCfg } from './data';
import type { Tune } from './physics';
import { WORLD_PER_M } from './units';
import { radialTexture } from './strip/park';

const W = WORLD_PER_M;
const PAINT = 0xffd23f, NIGHT = 0x0e1217;
type Cam = { az: number; pol: number; r: number; t: [number, number, number] };
const m2 = (c: Cam): Cam => ({ az: c.az, pol: c.pol, r: c.r * W, t: [c.t[0] * W, c.t[1] * W, c.t[2] * W] });
/** Night Tuner's garage cameras, in world units. */
export const CAMS: Record<string, Cam> = Object.fromEntries(Object.entries({
  orbit: { az: .7, pol: 1.22, r: 8.6, t: [0, .65, 0] }, front34: { az: .7, pol: 1.22, r: 8, t: [0, .65, 0] }, top34: { az: .85, pol: .95, r: 8, t: [0, .7, 0] },
  wheel: { az: 1.25, pol: 1.42, r: 3.4, t: [.75, .38, 1.1] }, front: { az: .32, pol: 1.36, r: 6.2, t: [0, .55, 1.4] }, rear: { az: 2.65, pol: 1.2, r: 6.6, t: [0, .8, -1.2] },
  side: { az: Math.PI / 2, pol: 1.36, r: 7.2, t: [0, .45, 0] }, side34: { az: 1.15, pol: 1.26, r: 6.8, t: [0, .95, 0] }, hood: { az: .42, pol: .88, r: 5.6, t: [0, .8, 1.2] }, low: { az: .95, pol: 1.5, r: 7, t: [0, .3, 0] },
} satisfies Record<string, Cam>).map(([k, c]) => [k, m2(c)]));
const rideYOf = (tune: Tune) => -.07 * (tune.ride + 1) / 2 * W;

type ModelParts = { body: THREE.Mesh; trim: THREE.Mesh; glass: THREE.Mesh; wheelMesh: THREE.Object3D; farBody: THREE.Mesh; farTrim: THREE.Mesh; far: boolean };

export class GarageScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(42, 1, .1 * W, 200 * W);
  private cur = { az: .7, pol: 1.22, r: 8.6 * W, t: new THREE.Vector3(0, .65 * W, 0) };
  private tgt: Cam = { ...CAMS.orbit };
  private autoRot = true;
  private drag: { x: number; y: number } | null = null;
  private owned: { dispose(): void }[] = [];
  private car: THREE.Group | null = null;
  private kit: PartsKit | null = null;
  private shownKey = '';
  private raf = 0;
  private last = 0;
  private ro: ResizeObserver | null = null;
  private envRT: THREE.WebGLRenderTarget;
  private off: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
    this.envRT = garageEnv(r);
    this.build();
    this.bindInput();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas); this.resize();
    const loop = (t: number) => { this.raf = requestAnimationFrame(loop); const dt = Math.min(.1, this.last ? (t - this.last) / 1000 : 0); this.last = t; this.frame(dt); };
    this.raf = requestAnimationFrame(loop);
  }

  private keep<T extends { dispose(): void }>(o: T): T { this.owned.push(o); return o; }

  private build(): void {
    const g = this.scene, k = this.keep.bind(this);
    g.background = new THREE.Color(0x04060b); g.fog = new THREE.Fog(0x04060b, 16 * W, 42 * W); g.environment = this.envRT.texture;
    // floor grid
    const fc = document.createElement('canvas'); fc.width = fc.height = 512; const fx = fc.getContext('2d');
    if (fx) { fx.fillStyle = '#0e1217'; fx.fillRect(0, 0, 512, 512); fx.strokeStyle = 'rgba(255,210,63,.07)'; fx.lineWidth = 2; for (let i = 0; i <= 512; i += 64) { fx.beginPath(); fx.moveTo(i, 0); fx.lineTo(i, 512); fx.moveTo(0, i); fx.lineTo(512, i); fx.stroke(); } }
    const floorTex = k(new THREE.CanvasTexture(fc)); floorTex.colorSpace = THREE.SRGBColorSpace; floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(10, 10); floorTex.anisotropy = 8;
    const floor = new THREE.Mesh(k(new THREE.PlaneGeometry(80 * W, 80 * W)), k(new THREE.MeshStandardMaterial({ map: floorTex, roughness: .35, metalness: .5, envMapIntensity: .3 })));
    floor.rotation.x = -Math.PI / 2; g.add(floor);
    const tt = new THREE.Mesh(k(new THREE.CylinderGeometry(3.5 * W, 3.6 * W, .08 * W, 72)), k(new THREE.MeshStandardMaterial({ color: NIGHT, metalness: .6, roughness: .4, envMapIntensity: .4 })));
    g.add(tt);
    const ring = new THREE.Mesh(k(new THREE.TorusGeometry(3.55 * W, .025 * W, 8, 96)), k(new THREE.MeshBasicMaterial({ color: new THREE.Color(PAINT).multiplyScalar(2) })));
    ring.rotation.x = Math.PI / 2; ring.position.y = .045 * W; g.add(ring);
    const wallM = k(new THREE.MeshStandardMaterial({ color: 0x0b0e14, roughness: .6, metalness: .3 }));
    const wall = new THREE.Mesh(k(new THREE.BoxGeometry(40 * W, 9 * W, .4 * W)), wallM); wall.position.set(0, 4.5 * W, -12 * W); g.add(wall);
    const sideG = k(new THREE.BoxGeometry(.4 * W, 9 * W, 30 * W));
    for (const s of [-1, 1]) { const w = new THREE.Mesh(sideG, wallM); w.position.set(s * 14 * W, 4.5 * W, 2 * W); g.add(w); }
    // light tubes with a soft glow behind each
    const radial = radialTexture(); if (radial) k(radial);
    const tubeM = k(new THREE.MeshBasicMaterial({ color: new THREE.Color(PAINT).multiplyScalar(2.2) }));
    const tubeWarm = k(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf3f6fb).multiplyScalar(1.6) }));
    const glowM = (col: number) => k(new THREE.SpriteMaterial({ map: radial, color: col, blending: THREE.AdditiveBlending, transparent: true, opacity: .35, depthWrite: false }));
    const glowP = glowM(PAINT), glowW = glowM(0xf3f6fb);
    const tube = (mat: THREE.Material, glow: THREE.SpriteMaterial, x: number, y: number, z: number, h: number, rz = 0) => {
      const m = new THREE.Mesh(k(new THREE.CylinderGeometry(.05 * W, .05 * W, h * W, 8)), mat); m.position.set(x * W, y * W, z * W); m.rotation.z = rz; g.add(m);
      if (radial) { const s = new THREE.Sprite(glow); s.position.set(x * W, y * W, (z + .3) * W); s.scale.set((rz ? h * 1.3 : 2.4) * W, (rz ? 2.4 : h * 1.3) * W, 1); g.add(s); }
    };
    for (let i = -3; i <= 3; i++) tube(i % 2 ? tubeM : tubeWarm, i % 2 ? glowP : glowW, i * 3.6, 3.4, -11.75, 4.2);
    tube(tubeM, glowP, 0, 6.2, -11.75, 22, Math.PI / 2);
    // tool cabinets and tyre stacks
    const cabM = k(new THREE.MeshStandardMaterial({ color: 0x3d434b, metalness: .6, roughness: .35 })), cabG = k(new THREE.BoxGeometry(1.5 * W, 1.1 * W, .7 * W));
    for (const x of [-9, -7.4, 8]) { const b = new THREE.Mesh(cabG, cabM); b.position.set(x * W, .55 * W, -11.3 * W); g.add(b); }
    const tyreG = k(new THREE.CylinderGeometry(.35 * W, .35 * W, .28 * W, 20)), tyreM = k(new THREE.MeshStandardMaterial({ color: 0x101114, roughness: .9 }));
    for (const x of [-11, 11]) for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(tyreG, tyreM); t.position.set(x * W, (.14 + i * .29) * W, -9.8 * W); g.add(t); }
    // lights
    g.add(new THREE.HemisphereLight(0x8aa0c8, 0x080808, .25 * Math.PI));
    const spot = (col: number, i: number, x: number, y: number, z: number, ang: number, pen: number) => { const s = new THREE.SpotLight(col, i * Math.PI * Math.pow(W, 1.2), 30 * W, ang, pen, 1.2); s.position.set(x * W, y * W, z * W); g.add(s, s.target); return s; };
    spot(0xffffff, 1.3, 3, 9, 5, .5, .6);
    spot(PAINT, 1.1, -7, 4, -6, .6, .7);
    spot(0xf3f6fb, .9, 7, 3, -5, .6, .7);
  }

  /** Show `cfg` / `tune` on a lofted `style` body. Rebuilds the body when the style or paint changes; otherwise re-fits the kit. */
  setCar(style: BodyStyle, cfg: CarCfg, tune: Tune): void {
    const key = JSON.stringify([cfg, style]), bodyKey = style + cfg.color;
    if (key === this.shownKey && this.car) { this.car.position.y = rideYOf(tune); return; }
    if (!this.car || this.car.userData.garageBody !== bodyKey) {
      this.clearCar();
      const car = buildCarModel(style, cfg.color).group;
      car.userData.garageBody = bodyKey; car.rotation.y = Math.PI; setCarLights(car, 'on');
      this.scene.add(car); this.car = car;
    } else if (this.kit) { disposeParts(this.kit); this.kit = null; }
    this.kit = attachParts(this.car, cfg, style, cfg.perf.brakes);
    this.car.position.y = rideYOf(tune);
    this.shownKey = key;
  }
  private clearCar(): void {
    if (this.kit) { disposeParts(this.kit); this.kit = null; }
    if (this.car) { disposeCarModel(this.car); this.car = null; }
    this.shownKey = '';
  }

  /** Night Tuner's setCam: ease to a named camera, the short way round. */
  setCam(name: string): void {
    const c = CAMS[name] || CAMS.orbit; this.tgt = { ...c }; this.autoRot = name === 'orbit';
    let d = this.tgt.az - this.cur.az; d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; this.tgt.az = this.cur.az + d;
  }

  private bindInput(): void {
    const c = this.canvas;
    const down = (e: PointerEvent) => { this.drag = { x: e.clientX, y: e.clientY }; try { c.setPointerCapture(e.pointerId); } catch { /* gone */ } };
    const move = (e: PointerEvent) => { if (!this.drag) return; this.tgt.az -= (e.clientX - this.drag.x) * .006; this.tgt.pol = clamp(this.tgt.pol - (e.clientY - this.drag.y) * .004, .5, 1.52); this.drag = { x: e.clientX, y: e.clientY }; };
    const up = () => { this.drag = null; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); this.tgt.r = clamp(this.tgt.r * (1 + Math.sign(e.deltaY) * .08), 3 * W, 13 * W); };
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', wheel, { passive: false });
    this.off.push(() => { c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up); c.removeEventListener('wheel', wheel); });
  }

  private resize(): void {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
  }

  /** The world's LOD pass judges every car by the world camera: the garage car always shows near. */
  private keepNear(): void {
    const c = this.car?.userData.car as ModelParts | undefined;
    if (!c || !c.far) return;
    c.far = false; c.body.visible = c.trim.visible = c.glass.visible = c.wheelMesh.visible = true; c.farBody.visible = c.farTrim.visible = false;
    syncKitLod(this.car!);
  }

  private frame(dt: number): void {
    const k = 1 - Math.exp(-dt * 3.2), cur = this.cur, tgt = this.tgt;
    if (this.autoRot && !this.drag) tgt.az += dt * .16;
    cur.az += (tgt.az - cur.az) * k; cur.pol += (tgt.pol - cur.pol) * k; cur.r += (tgt.r - cur.r) * k;
    cur.t.lerp(new THREE.Vector3(...tgt.t), k);
    const s = Math.sin(cur.pol);
    this.cam.position.set(cur.t.x + cur.r * s * Math.sin(cur.az), cur.t.y + cur.r * Math.cos(cur.pol), cur.t.z + cur.r * s * Math.cos(cur.az));
    this.cam.lookAt(cur.t);
    this.keepNear();
    this.renderer.render(this.scene, this.cam);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect(); this.ro = null;
    for (const f of this.off.splice(0)) f();
    this.clearCar();
    for (const o of this.owned.splice(0)) o.dispose();
    this.envRT.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // free the WebGL context now, not at GC: repeated opens must not crowd out the world's
  }
}

/** Night Tuner's makeEnv(false), the garage reflections: ceiling strips, side panels (paint yellow and white), dim walls. */
function garageEnv(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const s = new THREE.Scene(); s.background = new THREE.Color(0x05070c);
  const g = new THREE.BoxGeometry(1, 1, 1); const ms: THREE.Material[] = [];
  const P = (c: THREE.ColorRepresentation, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => { const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i) }); ms.push(mat); const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); s.add(m); };
  for (let i = -2; i <= 2; i++) P(0xffffff, 2.2, i * 3.2, 10, 0, .5, .1, 16);
  P(PAINT, 1.4, -13, 3, 0, .3, 5, 24); P(0xf3f6fb, 1.2, 13, 3, 0, .3, 5, 24);
  P(0x8fa3c8, .5, 0, 1.5, -15, 30, 3, .3); P(0x8fa3c8, .35, 0, 1.5, 15, 30, 3, .3);
  P(0x05070c, 1, 0, -4, 0, 60, .2, 60);
  const pm = new THREE.PMREMGenerator(renderer); const t = pm.fromScene(s, .035); pm.dispose();
  g.dispose(); ms.forEach(m => m.dispose());
  return t;
}
