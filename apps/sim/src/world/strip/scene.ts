/* The Strip: Night Tuner's night city as a second district. Owns the city scene (its own THREE.Scene),
   the traffic and the rivals (lofted bodies), the event runner and its effects, the event markers,
   the checkpoint mark, the GPS route and the world map. Ported from Night Tuner 05-world.js
   (spawnTraffic, spawnRivals, drawAI), 09-main.js (simulate's AI part, updateMarkers, pressEnter,
   promptText) and 08-hud.js (the world map overlay).
   Units: the AI, the events and the player's Vehicle are in metres, as in Night Tuner; everything in
   the THREE scene is in world units (WORLD_PER_M per metre). Night Tuner's cars face +Z with
   rotation.y = h; the lofted bodies face -Z, so a car's rotation.y is h + PI.
   The player's own physics step is not here: the main scene steps it (calling `runner.input` before
   and `collide` + `runner.postStep` after each sub-step) and places its car group. */
import * as THREE from 'three';
import { attachCarShadows, buildCarModel, carShadowScene, disposeCarModel, setCarLights, syncCarWheels } from '../../scene/carModel';
import { getStyleGeometry } from '../../scene/car/carStyles';
import { anchorsFor, attachParts, disposeParts, syncKitLod, type PartsKit } from '../parts';
import { ARCHETYPES, EVENTS, EV_COL, EV_NAME, PALETTE, STOCK_CFG, STYLES, TUNE_DEF, type BodyStyle, type CarCfg, type EventDef, type VisualCfg } from '../data';
import { carParams, makeVehicle, type Vehicle } from '../physics';
import { WORLD_PER_M } from '../units';
import { RENTAL_KIOSK, buildRentalLot } from '../../scene/world/rentalLot';
import { RENTAL_BAY, RENTAL_BLOCK, RENTAL_CAM } from '../rental';
import { buildCity, radialTexture, ACCENT, CHROME, TUBE_BLUE, type City } from './city';
import { CELL, N, RW, SPAN, buildRoute, gridPath, nearestNode, type Node, type Route } from './routes';
import { collideBlocks, collideCar, makeAI, separateAIs, setWander, stepAI, type AI } from './ai';
import { EventRunner, nearEvent, nearRival, playerAccel, playerTopMs, startOutrun, updateOutrun, type ActiveEvent, type EventFx, type EventResults, type Outrun } from './events';

const W = WORLD_PER_M;
const TRAFFIC_COLS = ['#c8102e', '#e9ecef', '#1f4fbf', '#3d434b', '#0c0c0e', '#b9bec5', '#ffd21f', '#0f8b8d', '#134a32', '#5a0a14'];
const RIVAL_NAMES = ['Kira', 'Dex', 'Mako'];
const RIVAL_NEON = [ACCENT, TUBE_BLUE, CHROME];
const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

/** Where the player starts in the Strip (metres, Night Tuner's spawnPlayer). */
export const STRIP_SPAWN = { x: 2 * CELL, z: 2 * CELL + CELL / 2, h: 0 };
export const STRIP_TRAFFIC = 14, STRIP_RIVALS = 3;
/** the lobby camera's field of view (degrees) */
export const LOBBY_FOV = 44;

export type Gps = { label: string; node: Node; path: Node[] };
export type MapItem = { n: string; clear?: true; ev?: EventDef; node?: Node };
/** An event marker in metres (what nearEvent and the HUD use); ring and beam are the scene's meshes. */
export type Marker = { ev: EventDef; x: number; z: number; ring: THREE.Mesh; beam: THREE.Mesh };

export type StripSceneOpts = {
  onBanner(txt: string, bad?: boolean, hold?: boolean): void;
  onSfx(name: string): void;
  /** the career stage (1..5); default 1 */
  stage?: () => number;
  /** the player's style rating (visualRating of their cfg); default 0 */
  styleRating?: () => number;
  /** used once in load() to make the city's reflection map (PMREM); without it the Strip has none */
  renderer?: THREE.WebGLRenderer;
  /** an event just started: the player's car was moved to its grid slot (reset the chase camera's yaw to PV.h) */
  onEventStart?(ev: EventDef, PV: Vehicle): void;
  /** the event's standings froze (1.4 s after the finish): show the results */
  onResults?(r: EventResults): void;
  /** a live event ended without results: quit with R, left the Strip, or replaced by another start (once per event) */
  onEventQuit?(ev: EventDef): void;
  /** an outrun was decided (once per outrun) */
  onOutrun?(won: boolean, rival: AI): void;
  /** a near miss with traffic above 22 m/s (Night Tuner paid $50) */
  onNearMiss?(): void;
  seed?: number;
};

type CarRec = { style: BodyStyle; wheelR: number };
const recOf = (g: THREE.Object3D) => g.userData.strip as CarRec;
type ModelNodes = { pivots: THREE.Object3D[]; wheels: THREE.Object3D[] };

export class StripScene {
  ready = false;
  scene: THREE.Scene = new THREE.Scene();
  city: City | null = null;
  runner: EventRunner;
  ais: AI[] = [];
  markers: Marker[] = [];
  gpsTarget: Gps | null = null;
  outrun: Outrun | null = null;
  mapOpen = false;
  mapSel = 0;
  PV: Vehicle;
  entered = false;
  /** the rental lobby: the camera on the bay, no car (lobby()) */
  inLobby = false;

  private readonly opts: StripSceneOpts;
  private readonly kitted = new Set<THREE.Group>();
  private tags: THREE.Sprite[] = [];
  private tagTex: THREE.Texture | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private gpsMesh: THREE.Mesh | null = null;
  private gpsMat: THREE.MeshBasicMaterial | null = null;
  private carGroup: THREE.Group | null = null;
  private prevParent: THREE.Object3D | null = null;
  private prevShadow: THREE.Object3D | null = null;
  private reported: ActiveEvent | null = null;
  private readonly noRacers: AI[] = [];
  private readonly fx: EventFx;
  private lot: ReturnType<typeof buildRentalLot> | null = null;

  constructor(opts: StripSceneOpts) {
    this.opts = opts;
    this.PV = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF)); // until enter()
    const stage = () => opts.stage?.() ?? 1;
    this.fx = {
      banner: (t, bad, hold) => opts.onBanner(t, bad, hold),
      sfx: n => opts.onSfx(n),
      spawnRacerMesh: (cfg: VisualCfg) => this.spawnCar(pick(STYLES), cfg.color, cfg),
      disposeMesh: m => this.disposeCar(m as THREE.Group),
      placeCp: nd => this.placeCp(nd),
      stage,
      styleRating: () => opts.styleRating?.() ?? 0,
    };
    this.runner = new EventRunner(this.PV, this.ais, this.fx, () => this.PV.P);
    this.runner.onAbandon = ev => opts.onEventQuit?.(ev);
  }
  private stage(): number { return this.fx.stage(); }

  /** Build the city and its cars (synchronous; idempotent). */
  load(): void {
    if (this.ready) return;
    const city = this.city = buildCity(this.opts.seed ?? 7, [RENTAL_BLOCK]); // the rental lot's block stays empty
    this.scene = city.scene;
    this.lot = buildRentalLot(); this.scene.add(this.lot.group);
    this.markers = city.markers.map(m => ({ ev: m.ev, x: m.x / W, z: m.z / W, ring: m.ring, beam: m.beam }));
    if (this.opts.renderer) { this.envRT = makeEnv(this.opts.renderer); this.scene.environment = this.envRT.texture; }
    for (const st of STYLES) getStyleGeometry(st); // every body style now, so a race start never builds one
    this.gpsMat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: .45, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.tagTex = radialTexture();
    this.spawnTraffic(STRIP_TRAFFIC);
    this.spawnRivals();
    this.ready = true;
  }

  // ------------------------------------------------------------------------------ cars
  /** A lofted car in the Strip; with `cfg`, Night Tuner's kit on it (its neon light left out: the light count stays fixed). */
  private spawnCar(style: BodyStyle, color: string, cfg?: VisualCfg): THREE.Group {
    const g = buildCarModel(style, color).group;
    g.userData.strip = { style, wheelR: anchorsFor(style).wheelR } satisfies CarRec;
    setCarLights(g, 'on');
    if (cfg) {
      const kit: PartsKit = attachParts(g, cfg, style, (cfg as Partial<CarCfg>).perf?.brakes ?? 0);
      if (kit.neonLight) { kit.neonLight.removeFromParent(); kit.neonLight.dispose(); kit.neonLight = null; }
      this.kitted.add(g);
    }
    g.position.set(-1e4, 0, -1e4); g.visible = false;
    this.scene.add(g);
    return g;
  }
  private disposeCar(g: THREE.Group | undefined): void {
    if (!g) return;
    const kit = g.userData.ntParts as PartsKit | undefined;
    if (kit) disposeParts(kit);
    this.kitted.delete(g);
    disposeCarModel(g);
  }
  private spawnTraffic(count: number): void {
    for (let k = 0; k < count; k++) {
      const m = this.spawnCar(pick(STYLES), pick(TRAFFIC_COLS));
      const A = makeAI({ m, vmax: 11 + Math.random() * 5, acc: 4, brk: 7, kind: 'traffic', lane: 3.2 });
      setWander(A, [1 + Math.floor(Math.random() * (N - 1)), 1 + Math.floor(Math.random() * (N - 1))]);
      this.ais.push(A);
    }
  }
  private spawnRivals(): void {
    for (let k = 0; k < STRIP_RIVALS; k++) {
      const c = clone(STOCK_CFG); c.color = pick(PALETTE)[0]; c.spoiler = (2 + k) as CarCfg['spoiler']; c.rim = 'mesh'; c.neon = RIVAL_NEON[k]; c.finish = 'candy';
      const m = this.spawnCar(pick(STYLES), c.color, c);
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTex, color: 0xffffff, transparent: true, depthWrite: false }));
      tag.position.set(0, 2.6 * W, 0); tag.scale.set(1.2 * W, 1.2 * W, 1); m.add(tag); this.tags.push(tag);
      const A = makeAI({ m, vmax: 16, acc: 6, brk: 8, kind: 'rival', lane: 3.0, name: RIVAL_NAMES[k], tag });
      setWander(A, [2 + k * 2, 2 + k]);
      this.ais.push(A);
    }
  }
  /** roll the wheels `v` m/s for dt, steer the front ones */
  private roll(m: THREE.Group, v: number, dt: number, steer: number): void {
    const c = m.userData.car as ModelNodes | undefined; if (!c) return;
    if (dt > 0) { const a = -v * W / recOf(m).wheelR * dt; for (const w of c.wheels) w.rotateX(a); }
    c.pivots[0].rotation.y = c.pivots[1].rotation.y = steer;
    syncCarWheels(m);
  }
  /** Night Tuner's drawAI: place an AI car from its state (hidden while parked) */
  drawAI(A: AI, dt: number): void {
    const m = A.m as THREE.Group | undefined; if (!m) return;
    m.visible = !A.parked;
    if (A.parked) return;
    m.position.set(A.x * W, 0, A.z * W); m.rotation.y = A.h + Math.PI;
    this.roll(m, A.v, dt, A.steer);
  }
  private placeCp(nd: Node | null): void {
    const cp = this.city?.cpMark; if (!cp) return;
    if (!nd) { cp.visible = false; return; }
    cp.visible = true; cp.position.set(nd[0] * CELL * W, 0, nd[1] * CELL * W);
  }

  // ------------------------------------------------------------------------------ in / out
  /** Put the player's car group (and the cars' contact shadows) in the Strip; PV is the player's vehicle (metres). */
  enter(PV: Vehicle, carGroup: THREE.Group): void {
    if (this.entered) this.exit();
    this.load();
    this.PV = PV; this.runner.PV = PV;
    this.carGroup = carGroup; this.prevParent = carGroup.parent;
    this.scene.add(carGroup);
    carGroup.position.set(PV.x * W, 0, PV.z * W); carGroup.rotation.y = PV.h + Math.PI;
    this.prevShadow = carShadowScene();
    attachCarShadows(this.scene);
    this.entered = true;
  }
  /** Leave: ends any event or outrun, clears the GPS and the map, gives the car group back to where it was. */
  exit(): void {
    if (!this.entered) return;
    if (this.runner.active) this.runner.cleanup();
    this.reported = null;
    this.endOutrun();
    this.setGps(null); this.mapOpen = false;
    const g = this.carGroup;
    if (g) { if (this.prevParent) this.prevParent.add(g); else g.removeFromParent(); }
    if (this.prevShadow) attachCarShadows(this.prevShadow);
    this.carGroup = this.prevParent = this.prevShadow = null;
    this.entered = false;
  }

  /** The rental lobby: no car in the Strip, `cam` fixed at RENTAL_CAM looking at the bay (world units). Leaves first if a car is in. */
  lobby(cam: THREE.PerspectiveCamera): void {
    if (this.entered) this.exit();
    this.load();
    cam.position.set(RENTAL_CAM.x * W, RENTAL_CAM.y * W, RENTAL_CAM.z * W);
    cam.up.set(0, 1, 0);
    cam.fov = LOBBY_FOV; cam.updateProjectionMatrix(); // closer on the bay (the chase camera sets its own again)
    // between the bay and the kiosk, nearer the bay: the car on the left of the counter menu, the RENT sign in view
    cam.lookAt((RENTAL_BAY.x * .7 + RENTAL_KIOSK.x * .3) * W, 1.6 * W, (RENTAL_BAY.z * .7 + RENTAL_KIOSK.z * .3) * W);
    this.inLobby = true;
  }
  leaveLobby(): void { this.inLobby = false; }

  // ------------------------------------------------------------------------------ events, outrun
  /** What Enter would do here (empty when nothing; nothing while an event or an outrun runs). */
  promptText(): string {
    if (!this.entered || this.runner.active || this.outrun) return '';
    const ev = nearEvent(this.PV, this.markers, this.stage()); if (ev) return 'Enter · ' + EV_NAME[ev.type] + ': ' + ev.name;
    const r = nearRival(this.PV, this.ais); if (r) return 'Enter · Outrun ' + r.name;
    return '';
  }
  /** Enter pressed while driving: start the event at this marker, or an outrun with the rival alongside. */
  pressEnter(): boolean {
    if (!this.entered || this.runner.active || this.outrun) return false;
    const ev = nearEvent(this.PV, this.markers, this.stage()); if (ev) { this.startEvent(ev); return true; }
    const r = nearRival(this.PV, this.ais); if (r) { this.outrun = startOutrun(r, playerTopMs(this.PV.P), playerAccel(this.PV.P), this.stage(), this.fx); return true; }
    return false;
  }
  startEvent(ev: EventDef, o: { quick?: boolean } = {}): void {
    this.load();
    this.endOutrun();
    this.reported = null;
    this.runner.start(ev, o);
    this.opts.onEventStart?.(ev, this.PV);
  }
  private endOutrun(): void {
    const o = this.outrun; if (!o) return;
    o.A.vmax = 16; o.A.acc = 6; o.A.brk = 8; o.A.cool = 20; // also during the wind-down (updateOutrun's own reset never ran)
    this.outrun = null;
  }
  /** The player's collisions for one physics sub-step (blocks, then the AI cars except in a drag race); returns the impact. */
  collide(V: Vehicle): number {
    let imp = collideBlocks(V); const a = this.runner.active;
    if (!(a && a.type === 'drag')) for (const A of this.ais) { const r = collideCar(V, A); if (r > 0) { imp = Math.max(imp, r); if (A.kind === 'traffic' && !a && r > 2 && A.nm <= 0) A.nm = 3; } }
    return imp;
  }

  // ------------------------------------------------------------------------------ frame
  /** Once per frame after the player's physics: steps the AI, the event and the outrun (when live), then draws. */
  update(dt: number, live: boolean): void {
    if (!this.ready) return;
    const PV = this.PV, run = this.runner;
    if (live) {
      const a = run.active, st = this.stage();
      this.noRacers.length = 0;
      for (const A of this.ais) {
        if (A.kind === 'racer') continue; this.noRacers.push(A);
        if (A.cool > 0) A.cool -= dt;
        if (!a || A.kind === 'traffic' || A.kind === 'rival') stepAI(A, dt, null, st);
        if (this.entered && !a && A.kind === 'traffic' && A.nm <= 0 && Math.abs(PV.u) > 22) {
          const dx = A.x - PV.x, dz = A.z - PV.z;
          if (Math.abs(dx) < 3.4 && Math.abs(dz) < 3.4 && Math.hypot(dx, dz) < 3.4) { A.nm = 3; this.opts.onNearMiss?.(); this.fx.sfx('cp'); }
        }
      }
      separateAIs(this.noRacers);
      run.update(dt);
      const b = run.active;
      if (b && b.results && this.reported !== b) { this.reported = b; const r = run.results(); if (r) this.opts.onResults?.(r); }
      if (this.outrun) {
        const o = this.outrun, r = updateOutrun(o, PV, dt, this.fx);
        if (r === 'won' || r === 'lost') this.opts.onOutrun?.(r === 'won', o.A);
        else if (r === 'done') this.outrun = null;
      }
      const g = this.gpsTarget;
      if (g && !b && Math.hypot(PV.x - g.node[0] * CELL, PV.z - g.node[1] * CELL) < 14) this.setGps(null);
    }
    const d = live ? dt : 0;
    for (const A of this.ais) this.drawAI(A, d);
    const a = run.active;
    if (a && a.type === 'drag') for (const o of a.drag.ai) {
      const m = o.m as THREE.Group; m.visible = true;
      m.position.set(o.V.x * W, 0, o.V.z * W); m.rotation.y = a.drag.dir + Math.PI;
      this.roll(m, o.V.u, d, 0);
    }
    this.updateMarkers(performance.now());
    if (this.gpsMesh) this.gpsMesh.visible = !a;
    for (const g of this.kitted) syncKitLod(g);
    if (this.carGroup) syncKitLod(this.carGroup);
  }
  /** Night Tuner's updateMarkers: pulse the open markers, dim the locked ones, hide all during an event; blink the rivals' tags */
  private updateMarkers(t: number): void {
    const a = this.runner.active, st = this.stage();
    for (const m of this.markers) {
      const locked = m.ev.stage > st;
      (m.ring.material as THREE.MeshBasicMaterial).opacity = locked ? .15 : .5 + .3 * Math.sin(t / 300 + m.x);
      (m.beam.material as THREE.MeshBasicMaterial).opacity = locked ? .04 : .14 + .06 * Math.sin(t / 400);
      m.ring.visible = m.beam.visible = !a;
    }
    for (const A of this.ais) {
      const tag = A.tag as THREE.Sprite | undefined; if (!tag) continue;
      tag.visible = !a && !A.parked; (tag.material as THREE.SpriteMaterial).opacity = .5 + .5 * Math.sin(t / 200);
    }
  }

  // ------------------------------------------------------------------------------ GPS and the world map
  /** Route the GPS from the player's nearest crossing to this event's start (null clears it). */
  setGps(ev: EventDef | null): void {
    if (this.gpsMesh) { this.gpsMesh.removeFromParent(); this.gpsMesh.geometry.dispose(); this.gpsMesh = null; }
    if (!ev) { this.gpsTarget = null; return; }
    const node = ev.nodes[0], path = gridPath(nearestNode(this.PV.x, this.PV.z), node);
    this.gpsTarget = { label: (EV_NAME[ev.type] + ': ' + ev.name).toUpperCase(), node, path };
    if (path.length > 1 && this.gpsMat) { this.gpsMesh = new THREE.Mesh(ribbon(path, 1.1, .05), this.gpsMat); this.gpsMesh.renderOrder = 1; this.scene.add(this.gpsMesh); }
  }
  toggleMap(force?: boolean): void { this.mapOpen = force ?? !this.mapOpen; if (this.mapOpen) this.mapSel = 0; }
  mapItems(): MapItem[] { const st = this.stage(); return [{ n: 'Clear GPS', clear: true }, ...EVENTS.filter(e => e.stage <= st).map(e => ({ n: EV_NAME[e.type] + ': ' + e.name, ev: e, node: e.nodes[0] }))]; }
  mapMove(dir: -1 | 1): void { const n = this.mapItems().length; this.mapSel = (this.mapSel + dir + n) % n; }
  /** Enter on the map: set (or clear) the GPS and close the map. */
  mapActivate(): void { const it = this.mapItems()[this.mapSel]; this.setGps(it && !it.clear && it.ev ? it.ev : null); this.toggleMap(false); this.opts.onSfx('ok'); }
  /** Night Tuner's drawMap into a 2D context sized w × h (CSS pixels; the caller sets up the device-pixel transform and clears). */
  drawMapInto(g: CanvasRenderingContext2D, w: number, h: number): void {
    const PV = this.PV, st = this.stage();
    const sc = Math.min(w, h) / (SPAN + CELL * 2);
    g.save(); g.translate((w - SPAN * sc) / 2, (h - SPAN * sc) / 2); g.scale(sc, sc);
    g.fillStyle = '#0e1217'; g.fillRect(-CELL, -CELL, SPAN + CELL * 2, SPAN + CELL * 2);
    g.strokeStyle = 'rgba(150,170,200,.5)'; g.lineWidth = RW; g.beginPath();
    for (let i = 0; i <= N; i++) { g.moveTo(i * CELL, -RW); g.lineTo(i * CELL, SPAN + RW); g.moveTo(-RW, i * CELL); g.lineTo(SPAN + RW, i * CELL); }
    g.stroke();
    const sel = this.mapOpen ? this.mapItems()[this.mapSel] : undefined;
    for (const m of this.markers) {
      if (m.ev.stage > st) continue; const hot = !!sel && sel.ev === m.ev;
      g.fillStyle = EV_COL[m.ev.type]; g.beginPath(); g.arc(m.x, m.z, hot ? 16 : 10, 0, 7); g.fill();
      if (hot) { const r = routeOf(m.ev); g.strokeStyle = EV_COL[m.ev.type]; g.lineWidth = 6; g.beginPath(); r.pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); if (r.loop) g.closePath(); g.stroke(); }
    }
    const gps = this.gpsTarget;
    if (gps && gps.path.length) { g.strokeStyle = ACCENT; g.lineWidth = 5; g.setLineDash([10, 8]); g.beginPath(); gps.path.forEach((n, i) => i ? g.lineTo(n[0] * CELL, n[1] * CELL) : g.moveTo(n[0] * CELL, n[1] * CELL)); g.stroke(); g.setLineDash([]); }
    for (const c of this.ais) { if (c.parked || c.kind === 'traffic') continue; g.fillStyle = c.kind === 'rival' ? TUBE_BLUE : CHROME; g.beginPath(); g.arc(c.x, c.z, 7, 0, 7); g.fill(); }
    g.save(); g.translate(PV.x, PV.z); g.rotate(Math.PI - PV.h); g.fillStyle = ACCENT; g.beginPath(); g.moveTo(0, -14); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.fill(); g.restore();
    g.restore();
  }

  /** Free everything the Strip made (leaves first if the player is in it). */
  dispose(): void {
    this.exit();
    if (this.runner.active) this.runner.cleanup();
    for (const A of this.ais) this.disposeCar(A.m as THREE.Group | undefined);
    this.ais.length = 0;
    for (const t of this.tags) t.material.dispose(); this.tags = [];
    this.tagTex?.dispose(); this.tagTex = null;
    this.setGps(null); this.gpsMat?.dispose(); this.gpsMat = null;
    this.envRT?.dispose(); this.envRT = null;
    this.lot?.dispose(); this.lot = null; this.inLobby = false;
    this.city?.dispose(); this.city = null;
    this.scene = new THREE.Scene(); this.markers = [];
    this.ready = false;
  }
}

const ROUTES = new WeakMap<EventDef, Route>();
const routeOf = (ev: EventDef): Route => { let r = ROUTES.get(ev); if (!r) { r = buildRoute(ev.nodes, !!ev.loop); ROUTES.set(ev, r); } return r; };

/** A flat strip along a node path (road centres), `width` m wide, `y` m up, in world units. */
export function ribbon(path: Node[], width: number, y: number): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = []; const hw = width / 2;
  for (let k = 0; k < path.length - 1; k++) {
    const ax = path[k][0] * CELL, az = path[k][1] * CELL, bx = path[k + 1][0] * CELL, bz = path[k + 1][1] * CELL;
    const L = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / L * hw, nz = (bx - ax) / L * hw;
    // run past the crossings by half a width so the turns close
    const ex = (bx - ax) / L * hw, ez = (bz - az) / L * hw;
    const o = pos.length / 3;
    pos.push((ax - ex + nx) * W, y * W, (az - ez + nz) * W, (ax - ex - nx) * W, y * W, (az - ez - nz) * W, (bx + ex + nx) * W, y * W, (bz + ez + nz) * W, (bx + ex - nx) * W, y * W, (bz + ez - nz) * W);
    idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

/** Night Tuner's makeEnv(warm) in the brand's colours: a few lit boxes turned into a reflection map. */
function makeEnv(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const s = new THREE.Scene(); s.background = new THREE.Color(0x0a0a10);
  const g = new THREE.BoxGeometry(1, 1, 1); const ms: THREE.Material[] = [];
  const P = (c: THREE.ColorRepresentation, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => { const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i) }); ms.push(mat); const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); s.add(m); };
  for (let i = -2; i <= 2; i++) P(0xffffff, 1.1, i * 3.2, 10, 0, .5, .1, 16);
  P(TUBE_BLUE, 1.4, -13, 3, 0, .3, 5, 24); P(ACCENT, 1.2, 13, 3, 0, .3, 5, 24);
  P(0xffa040, .9, 0, 1.5, -15, 30, 3, .3); P(0xff9a30, .6, 0, 1.5, 15, 30, 3, .3);
  P(0x05070c, 1, 0, -4, 0, 60, .2, 60);
  const pm = new THREE.PMREMGenerator(renderer); const t = pm.fromScene(s, .035); pm.dispose();
  g.dispose(); ms.forEach(m => m.dispose());
  return t;
}
