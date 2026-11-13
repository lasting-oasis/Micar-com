import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as THREE from 'three';
import { LAMP_OFF, LAMP_ON, makeTrackLib } from './trackMaterials';

// the lofted bodies need a browser (canvas atlas): stand in a bare group with the model's wheel nodes
vi.mock('../../scene/carModel', () => {
  let shadow: THREE.Object3D | null = null;
  return {
    buildCarModel: () => {
      const group = new THREE.Group(); const pivots: THREE.Object3D[] = [], wheels: THREE.Object3D[] = [];
      for (let i = 0; i < 4; i++) { const p = new THREE.Object3D(), w = new THREE.Object3D(); p.add(w); pivots.push(p); wheels.push(w); }
      const body = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
      const wheelMesh = new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial(), 4);
      const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute([0, 1, -4, 0, 1, 4], 3)); hg.setAttribute('lampDir', new THREE.Float32BufferAttribute([-1, 1], 1));
      const halos = new THREE.Points(hg); const tilt = new THREE.Group(); tilt.add(body, halos); group.add(tilt, wheelMesh);
      group.userData.car = { pivots, wheels, body, wheelMesh, halos, tilt, far: false };
      return { group, wheels, frontPivots: pivots.slice(0, 2) };
    },
    disposeCarModel: (g: THREE.Object3D) => { g.removeFromParent(); g.userData.disposed = true; },
    setCarLights: () => {}, syncCarWheels: () => {},
    attachCarShadows: (s: THREE.Object3D) => { shadow = s; }, carShadowScene: () => shadow,
  };
});
const { StripScene, STRIP_SPAWN, tagSize } = await import('./scene');
const { EVENTS } = await import('../data');
const { DRAG_LANES } = await import('./events');
const { routePoint } = await import('./routes');
const { makeVehicle, carParams, resetVehicle } = await import('../physics');
const { ARCHETYPES, STOCK_CFG, TUNE_DEF } = await import('../data');
const { RENTAL_CAM } = await import('../rental');
const { WORLD_PER_M } = await import('../units');
const { HUB, TRACKS, offsetOf, forgetTrack } = await import('./district');
const { setTrackDir, readTrackSync } = await import('./districtNode');
const path = await import('node:path');

beforeAll(() => {
  setTrackDir(path.resolve(process.cwd(), 'public/strip/tracks'));
  for (const t of TRACKS) readTrackSync(t.id);
});

const cars = (s: THREE.Scene) => s.children.filter(o => o.userData.strip);
const lights = (s: THREE.Scene) => { let n = 0; s.traverse(o => { if ((o as THREE.Light).isLight) n++; }); return n; };
const ev = (id: string) => EVENTS.find(e => e.id === id)!;
function setup(extra: object = {}) {
  const banners: string[] = [];
  const S = new StripScene({
    onBanner: t => { banners.push(t); }, onSfx: () => {}, loadModel: null, stage: () => 5, ...extra,
    fetchTrack: async url => { const id = url.match(/tracks\/(\w+)\.json/)![1]; return readTrackSync(id); },
  });
  S.load();
  const PV = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF)); resetVehicle(PV, STRIP_SPAWN.x, STRIP_SPAWN.z, STRIP_SPAWN.h);
  const town = new THREE.Scene(), car = new THREE.Group(); town.add(car);
  return { S, PV, town, car, banners };
}
// a 2D context stub that counts every method call (and swallows property writes)
const ctxStub = () => {
  const calls: Record<string, number> = {};
  const ctx = new Proxy({}, { get: (_t, k: string) => (..._a: unknown[]) => { calls[k] = (calls[k] ?? 0) + 1; }, set: () => true }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
};

describe('StripScene', () => {
  it('loads 14 traffic cars and 3 rivals with no lights of their own; the hub shows the ten portals and no events', () => {
    const { S } = setup();
    expect(S.ais.filter(A => A.kind === 'traffic').length).toBe(14);
    expect(S.ais.filter(A => A.kind === 'rival').length).toBe(3);
    expect(cars(S.scene).length).toBe(17);
    expect(lights(S.scene)).toBe(3); // the hub's hemisphere light and sun, the rental bay's spot
    expect(S.markers.length).toBe(10); expect(S.markers.every(m => m.kind === 'portal')).toBe(true);
    expect(S.hudMarkers().length).toBe(0);
    expect(S.zone.kind).toBe('hub');
    S.dispose();
  });

  it('builds the rental lot and leaves the lobby camera on the bay', () => {
    const { S } = setup();
    S.load();
    expect(S.scene.getObjectByName('rentalLot')).toBeTruthy();
    const cam = new THREE.PerspectiveCamera();
    S.lobby(cam);
    expect(S.inLobby).toBe(true);
    expect(cam.position.x).toBe(RENTAL_CAM.x * WORLD_PER_M); expect(cam.position.z).toBe(RENTAL_CAM.z * WORLD_PER_M);
    const fwd = cam.getWorldDirection(new THREE.Vector3()); // looks from the camera toward the bay
    const bay = new THREE.Vector3(HUB.rental.bay.x * WORLD_PER_M, 0, HUB.rental.bay.z * WORLD_PER_M).sub(cam.position).setY(0).normalize();
    expect(fwd.setY(0).normalize().dot(bay)).toBeGreaterThan(0.5);
    S.leaveLobby(); expect(S.inLobby).toBe(false);
    S.dispose();
    expect(S.scene.getObjectByName('rentalLot')).toBeUndefined();
  });

  it('draws the AI in world units, facing -Z', () => {
    const { S } = setup(); S.update(1 / 60, true);
    const A = S.ais[0], m = A.m as THREE.Group;
    expect(m.position.x).toBeCloseTo(A.x * 2, 6); expect(m.position.z).toBeCloseTo(A.z * 2, 6);
    expect(m.rotation.y).toBeCloseTo(A.h + Math.PI, 6); expect(m.visible).toBe(true);
    S.dispose();
  });

  it('enter / exit move the player car in and out; a drag race places its cars by lane and cleans up', async () => {
    const { S, PV, town, car } = setup();
    S.enter(PV, car); expect(car.parent).toBe(S.scene);
    await S.startEvent(ev('royal_drag'));
    const L0 = lights(S.scene);
    expect(cars(S.scene).length).toBe(17 + 3);
    for (let i = 0; i < 300; i++) S.update(1 / 60, true);
    const a = S.runner.active!, d = a.drag;
    for (const o of d.ai) {
      const m = o.m as THREE.Group, lat = (m.position.x / 2 - d.p0!.x) * d.right[0] + (m.position.z / 2 - d.p0!.z) * d.right[1];
      expect(lat).toBeCloseTo(DRAG_LANES[o.lane], 4); expect(m.visible).toBe(true);
    }
    expect(S.ais.filter(A => A.kind === 'rival').every(A => !(A.m as THREE.Group).visible)).toBe(true);
    expect(lights(S.scene)).toBe(L0); // racers' neon lights are left out
    S.exit();
    expect(car.parent).toBe(town); expect(S.runner.active).toBeNull();
    expect(cars(S.scene).length).toBe(17);
    S.dispose();
  });

  it('an exit during the outrun wind-down still gives the rival back its pace and a cooldown', async () => {
    const { startOutrun } = await import('./events');
    const { S, PV, car } = setup(); S.enter(PV, car);
    const R = S.ais.find(A => A.kind === 'rival')!;
    S.outrun = startOutrun(R, 60, 5, 1); S.outrun.state = 'done'; // decided: the 2.2 s wind-down
    S.exit();
    expect(S.outrun).toBeNull(); expect(R.vmax).toBe(16); expect(R.acc).toBe(6); expect(R.brk).toBe(8); expect(R.cool).toBe(20);
    S.dispose();
  });

  it('a circuit has the overcast day and the hub its sunny look, reflections included', async () => {
    const { OVERCAST, SKY } = await import('./park');
    const { S, PV, car } = setup(); S.enter(PV, car);
    const fog = () => (S.scene.fog as THREE.FogExp2).color.getHex(), env0 = S.scene.environment;
    expect(fog()).toBe(SKY);
    await S.enterTrack('monza');
    expect(fog()).toBe(OVERCAST);
    expect(S.scene.environment === env0).toBe(env0 === null);   // a renderer gives each look its own reflections
    S.returnToHub();
    expect(fog()).toBe(SKY); expect(S.scene.environment).toBe(env0);
    S.dispose();
  });

  it('reports the mounted circuit as drawn (the smoke checks it): its trk meshes and whether the asphalt has its picture', async () => {
    const { makeTrackLib } = await import('./trackMaterials');
    const lib = makeTrackLib((_u, ok) => ok(new THREE.Texture()), '/s/');
    const loadModel = async (url: string) => {
      const g = new THREE.Group();
      if (url.includes('tracks/')) for (const n of ['trk_asphalt', 'trk_grass']) { const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()); (m.material as THREE.Material).name = n; g.add(m); }
      return g;
    };
    const { S, PV, car } = setup({ loadModel, trackLib: lib }); S.enter(PV, car);
    expect(S.circuitModel()).toBeNull();
    await S.enterTrack('monza');
    await vi.waitFor(() => expect(S.circuitModel()).toEqual({ id: 'monza', meshes: 2, asphaltMap: true }));
    S.returnToHub();
    expect(S.circuitModel()).toBeNull();
    S.dispose(); lib.dispose();
  });

  it('the cars drive with their lamps off on a circuit (a day) and glowing in the hub', async () => {
    const { S, PV, car } = setup(); S.enter(PV, car);
    expect(S.carLampGlow()).toBe(1);
    await S.enterTrack('monza');
    expect(S.carLampGlow()).toBe(0);
    S.returnToHub();
    expect(S.carLampGlow()).toBe(1);
    S.dispose();
  });

  it('entering a track mounts it, parks the hub traffic and places the car at the lobby', async () => {
    const { S, PV, car } = setup(); S.enter(PV, car);
    await S.enterTrack('monza');
    expect(S.zone.kind).toBe('track');
    const t = S.zone.kind === 'track' ? S.zone.track : null, off = offsetOf('monza');
    expect(t!.id).toBe('monza'); expect(S.mounted).not.toBeNull();
    expect(Math.abs(PV.x - (t!.lobby.x + off[0]))).toBeLessThan(0.01); expect(Math.abs(PV.z - (t!.lobby.z + off[1]))).toBeLessThan(0.01);
    expect(car.position.x).toBeCloseTo(PV.x * WORLD_PER_M, 6);
    expect(S.ais.filter(A => A.kind === 'traffic' || A.kind === 'rival').every(A => A.parked && A.hold)).toBe(true);
    const ids = S.markers.map(m => m.id);
    for (const e of EVENTS.filter(e => e.track === 'monza')) expect(ids).toContain(e.id);
    expect(S.markers.filter(m => m.kind === 'return').length).toBe(1);
    S.update(1 / 60, true); // the traffic stays parked
    expect(S.ais.filter(A => A.kind === 'traffic' || A.kind === 'rival').every(A => A.parked)).toBe(true);
    S.dispose();
  });

  it('pressEnter at a portal enters the track', async () => {
    const { S, PV, car } = setup(); S.enter(PV, car);
    const [px, pz] = HUB.portals.monza; resetVehicle(PV, px, pz, 0);
    expect(S.promptText()).toBe('Enter · Royal Park');
    expect(S.pressEnter()).toBe(true);
    await S.enterTrack('monza'); // resolves once the mount (started by pressEnter) is done
    expect(S.zone.kind).toBe('track');
    S.dispose();
  });

  it('returning during a live event abandons it and restores the hub walls', async () => {
    let quits = 0;
    const { S, PV, car } = setup({ onEventQuit: () => { quits++; } }); S.enter(PV, car);
    await S.enterTrack('monza');
    await S.startEvent(ev('royal_gp'));
    expect(S.runner.active).not.toBeNull();
    S.returnToHub();
    expect(S.runner.active).toBeNull(); expect(quits).toBe(1); expect(S.zone.kind).toBe('hub'); expect(S.mounted).toBeNull();
    expect(S.ais.filter(A => A.kind === 'traffic').every(A => !A.parked)).toBe(true);
    const w = HUB.walls[0]; let k = 0, best = 0;
    for (let i = 0; i + 1 < w.length; i++) { const L = Math.hypot(w[i + 1][0] - w[i][0], w[i + 1][1] - w[i][1]); if (L > best) { best = L; k = i; } }
    const a = w[k], b = w[k + 1], tx = (b[0] - a[0]) / best, tz = (b[1] - a[1]) / best, nx = -tz, nz = tx;
    const V = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF));
    resetVehicle(V, (a[0] + b[0]) / 2 + nx * .5, (a[1] + b[1]) / 2 + nz * .5, Math.atan2(tx, tz));
    V.vx = -nx * 5; V.vz = -nz * 5;
    expect(S.collide(V)).toBeGreaterThan(0);
    S.dispose();
  });

  it('drag and drift draw a route ribbon that cleanup removes; a lap race draws none (the circuit shows the way)', async () => {
    const { S, PV, car } = setup(); S.enter(PV, car);
    await S.startEvent(ev('harbour_gp'));
    const count = () => { let n = 0; S.scene.traverse(o => { if (o.name === 'routeRibbon') n++; }); return n; };
    expect(count()).toBe(0);
    S.runner.cleanup();
    await S.startEvent(ev('harbour_drift'));
    expect(count()).toBe(1);
    S.runner.cleanup();
    expect(count()).toBe(0);
    await S.startEvent(ev('royal_drag'));
    expect(count()).toBe(1);
    S.returnToHub();
    expect(count()).toBe(0);
    S.dispose();
  });

  it('a lap race shows no checkpoint gate or beam', async () => {
    const { S, PV, car } = setup(); S.enter(PV, car);
    await S.startEvent(ev('harbour_gp'));
    for (let i = 0; i < 600 && S.runner.active!.state !== 'race'; i++) S.update(1 / 60, true);
    expect(S.runner.active!.state).toBe('race');
    expect(S.scene.getObjectByName('cpMark')!.visible).toBe(false);
    S.dispose();
  });

  it('the gantry lamps light with the start lights and go out at the green', async () => {
    const lib = makeTrackLib((_u, ok) => ok(new THREE.Texture()), '/b/');
    const { S, PV, car } = setup({ trackLib: lib }); S.enter(PV, car);
    await S.startEvent(ev('harbour_gp'));
    const lamps = (lib.material('trk_lamps') as THREE.MeshBasicMaterial).map as THREE.DataTexture;
    const lamp = (i: number) => { const d = lamps.image.data, j = 4 * (i - 1); return (d[j] << 16) | (d[j + 1] << 8) | d[j + 2]; };
    for (let i = 0; i < 600 && (S.runner.active!.lit ?? 0) < 3; i++) S.update(1 / 60, true);
    expect(S.runner.active!.lit).toBe(3);
    expect([1, 2, 3, 4, 5].map(lamp)).toEqual([LAMP_ON, LAMP_ON, LAMP_ON, LAMP_OFF, LAMP_OFF]);
    for (let i = 0; i < 600 && S.runner.active!.state !== 'race'; i++) S.update(1 / 60, true);
    S.update(1 / 60, true);
    expect([1, 2, 3, 4, 5].map(lamp)).toEqual([LAMP_OFF, LAMP_OFF, LAMP_OFF, LAMP_OFF, LAMP_OFF]);
    S.dispose();
  });

  it('the checkpoint gate faces along the route at the next checkpoint', async () => {
    const { S, PV, car } = setup(); S.enter(PV, car);
    await S.startEvent(ev('harbour_drift'));
    for (let i = 0; i < 400 && S.runner.active!.state !== 'race'; i++) S.update(1 / 60, true);
    const a = S.runner.active!; expect(a.state).toBe('race');
    const t = routePoint(a.route, a.route.cps[a.pCp % a.route.cps.length]);
    const mark = S.scene.getObjectByName('cpMark')!;
    expect(mark.visible).toBe(true);
    const want = Math.atan2(t.tx, t.tz), d = mark.rotation.y - want;
    expect(Math.abs(Math.atan2(Math.sin(d), Math.cos(d)))).toBeLessThan(.01);
    expect(mark.getObjectByName('cpGate')).toBeDefined();
    S.dispose();
  });

  it('racers are coupes or sports cars', async () => {
    const { S, PV, car } = setup(); S.enter(PV, car);
    await S.startEvent(ev('harbour_gp'));
    const a = S.runner.active!; expect(a.racers.length).toBeGreaterThan(0);
    for (const R of a.racers) expect(['coupe', 'sports']).toContain((R.m as THREE.Object3D).userData.strip.style);
    S.dispose();
  });

  it('startEvent for an unmounted track mounts it first', async () => {
    const { S, PV, car } = setup(); S.enter(PV, car);
    await S.startEvent(ev('harbour_gp'));
    expect(S.zone.kind === 'track' && S.zone.track.id).toBe('monaco');
    expect(S.runner.active!.ev.id).toBe('harbour_gp');
    S.dispose();
  });

  it('the map draws for both zones', async () => {
    const { S, PV, car } = setup(); S.enter(PV, car);
    const h = ctxStub(); S.drawMapInto(h.ctx, 300, 300); expect(h.calls.stroke).toBeGreaterThanOrEqual(1);
    await S.enterTrack('monza');
    const t = ctxStub(); S.drawMapInto(t.ctx, 300, 300); expect(t.calls.stroke).toBeGreaterThanOrEqual(1);
    S.dispose();
  });

  it('setGps in the hub routes to the portal', () => {
    const { S, PV, car } = setup(); S.enter(PV, car);
    S.setGps(ev('royal_gp'));
    expect(S.gpsTarget!.target).toEqual(HUB.portals.monza); expect(S.gpsTarget!.path.length).toBeGreaterThanOrEqual(2);
    S.dispose();
  });

  it('a circuit hides the hub scenery (ribbons, portals, rental lot) and the paddock shows it again', async () => {
    const { S, PV, car } = setup(); S.enter(PV, car);
    const hub = S.hub!, portals = hub.markers.filter(m => m.kind === 'portal'), lot = S.scene.getObjectByName('rentalLot')!;
    expect(hub.roads.visible).toBe(true); expect(portals.every(m => m.ring.visible)).toBe(true);
    await S.enterTrack('monza');
    expect(hub.roads.visible).toBe(false); expect(lot.visible).toBe(false);
    expect(portals.every(m => !m.ring.visible && !m.beam.visible)).toBe(true);
    S.update(1 / 60, true); // the circuit's markers are updated, the hub's stay hidden
    expect(portals.every(m => !m.ring.visible)).toBe(true);
    S.returnToHub();
    expect(hub.roads.visible).toBe(true); expect(lot.visible).toBe(true);
    expect(portals.every(m => m.ring.visible && m.beam.visible)).toBe(true);
    S.dispose();
  });

  it('onZone fires on a circuit entry and on the way back, with the player\'s vehicle', async () => {
    const zones: string[] = [];
    const S = new StripScene({ onBanner: () => {}, onSfx: () => {}, loadModel: null, stage: () => 5, onZone: (z, V) => { zones.push(z.kind === 'track' ? z.track.id : 'hub'); expect(V).toBe(PV); },
      fetchTrack: async url => readTrackSync(url.match(/tracks\/(\w+)\.json/)![1]) });
    const PV = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF)); resetVehicle(PV, STRIP_SPAWN.x, STRIP_SPAWN.z, STRIP_SPAWN.h);
    S.enter(PV, new THREE.Group());
    await S.enterTrack('monza'); S.returnToHub();
    expect(zones).toEqual(['monza', 'hub']);
    S.dispose();
  });

  it('an exit while the circuit is still loading leaves the hub as it was and starts nothing', async () => {
    forgetTrack('monza');
    const slow = (url: string) => new Promise<ReturnType<typeof readTrackSync>>(res => setTimeout(() => res(readTrackSync(url.match(/tracks\/(\w+)\.json/)![1])), 50));
    const S = new StripScene({ onBanner: () => {}, onSfx: () => {}, loadModel: null, stage: () => 5, fetchTrack: slow });
    S.load();
    try {
      const PV = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF)); resetVehicle(PV, STRIP_SPAWN.x, STRIP_SPAWN.z, STRIP_SPAWN.h);
      S.enter(PV, new THREE.Group());
      const p = S.enterTrack('monza'), q = S.startEvent(ev('royal_gp'));
      S.exit();
      await p; await q;
      expect(S.zone.kind).toBe('hub'); expect(S.mounted).toBeNull(); expect(S.runner.active).toBeNull();
      expect(S.hub!.roads.visible).toBe(true);
      expect(Math.abs(PV.x - STRIP_SPAWN.x)).toBeLessThan(0.01); // the car was not moved to the circuit
    } finally { S.dispose(); readTrackSync('monza'); }
  });

  it('the map credits OpenStreetMap in both zones', async () => {
    const { OSM_CREDIT } = await import('./scene');
    const texts: string[] = [];
    const ctx = new Proxy({}, { get: (_t, k: string) => k === 'fillText' ? (t: string) => { texts.push(t); } : () => {}, set: () => true }) as unknown as CanvasRenderingContext2D;
    const { S, PV, car } = setup(); S.enter(PV, car);
    S.drawMapInto(ctx, 300, 300); expect(texts).toContain(OSM_CREDIT);
    texts.length = 0; await S.enterTrack('monza');
    S.drawMapInto(ctx, 300, 300); expect(texts).toContain(OSM_CREDIT);
    expect(OSM_CREDIT).toBe('Map data © OpenStreetMap contributors (ODbL)');
    S.dispose();
  });

  it('exit from a track returns home first', async () => {
    const { S, PV, car } = setup(); S.enter(PV, car);
    await S.enterTrack('monza');
    S.exit();
    expect(S.zone.kind).toBe('hub'); expect(S.mounted).toBeNull();
    S.dispose();
  });

  describe('a circuit that fails to load', () => {
    const failing = () => {
      const bad: [string, boolean | undefined][] = [];
      const S = new StripScene({ onBanner: (t, b) => { bad.push([t, b]); }, onSfx: () => {}, loadModel: null, stage: () => 5, fetchTrack: async () => { throw new Error('offline'); } });
      S.load(); forgetTrack('monza');
      const PV = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF)); resetVehicle(PV, STRIP_SPAWN.x, STRIP_SPAWN.z, STRIP_SPAWN.h);
      S.enter(PV, new THREE.Group());
      return { S, bad };
    };
    it('keeps the hub and shows a banner', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { S, bad } = failing();
      try {
        await S.enterTrack('monza');
        expect(S.zone.kind).toBe('hub'); expect(S.mounted).toBeNull();
        expect(bad).toContainEqual(['Could not load the circuit', true]);
      } finally { warn.mockRestore(); S.dispose(); readTrackSync('monza'); }
    });
    it('startEvent on a circuit that fails to load starts nothing', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { S } = failing();
      try {
        await S.startEvent(ev('royal_gp'));
        expect(S.runner.active).toBeNull(); expect(S.zone.kind).toBe('hub');
      } finally { warn.mockRestore(); S.dispose(); readTrackSync('monza'); }
    });
  });
});

describe('a challenge in the scene: the other cars are people', () => {
  type Pose = { t: number; x: number; z: number; h: number; v: number; s: number; sc: number };
  const others = [{ id: 'p2', name: 'Ana', slot: 0, color: '#ffd23f', style: 'hatchback' }, { id: 'p3', name: 'Bo', slot: 1, color: '#2a9df4', style: 'hatchback' }];
  const field = (over: object = {}) => ({ slot: 2, others, goAt: () => null as number | null, now: () => 0, ...over });

  it('a challenge puts only the people on the grid, in the car the room lends', async () => {
    const { S, PV, car } = setup(); S.enter(PV, car);
    await S.startEvent(ev('royal_drag'), { net: field() });
    expect(cars(S.scene).length).toBe(17 + 2); // no computer car beside them
    const racers = S.runner.active!.racers;
    expect(racers.map(r => r.name)).toEqual(['Ana', 'Bo']);
    expect(racers.map(r => (r.m as THREE.Group).userData.strip.style)).toEqual(['hatchback', 'hatchback']); // the body asked for, not a racer's random one
    S.exit();
    expect(cars(S.scene).length).toBe(17);
    S.dispose();
  });

  it('the other racers are drawn from their poses; one with no pose yet stays on its grid place', async () => {
    const poses: Record<string, Pose | null> = { p2: null, p3: null };
    const { S, PV, car } = setup({ remotePose: (pid: string) => poses[pid] ?? null }); S.enter(PV, car);
    await S.startEvent(ev('harbour_gp'), { net: field() });
    const [ana, bo] = S.runner.active!.racers, m = ana.m as THREE.Group, bm = bo.m as THREE.Group;
    const boAt = [bo.x, bo.z];
    poses.p2 = { t: 0, x: PV.x + 10, z: PV.z + 30, h: 1, v: 20, s: 77, sc: 5 };
    S.update(1 / 60, true);
    expect(m.position.x).toBeCloseTo((PV.x + 10) * 2, 6); expect(m.position.z).toBeCloseTo((PV.z + 30) * 2, 6);
    expect(m.rotation.y).toBeCloseTo(1 + Math.PI, 6); expect(m.visible).toBe(true);
    expect([ana.s, ana.score, ana.v]).toEqual([77, 5, 20]); // the standings and the minimap read these
    expect([bo.x, bo.z]).toEqual(boAt);
    expect(bm.position.x).toBeCloseTo(boAt[0] * 2, 6); expect(bm.position.z).toBeCloseTo(boAt[1] * 2, 6); expect(bm.visible).toBe(true);
    // a racer who is home rolls on from its poses, but its distance and score are the ones it finished with
    S.runner.remoteDone('p2', 31.2);
    poses.p2 = { t: 0, x: PV.x + 12, z: PV.z + 40, h: 1, v: 10, s: 99, sc: 9 };
    S.update(1 / 60, true);
    expect(m.position.z).toBeCloseTo((PV.z + 40) * 2, 6);
    expect([ana.s, ana.score]).toEqual([77, 5]);
    // one who is out of the race leaves the track, whatever arrives late
    S.runner.remoteDone('p3', null);
    poses.p3 = { t: 0, x: PV.x, z: PV.z + 5, h: 0, v: 30, s: 50, sc: 0 };
    S.update(1 / 60, true);
    expect(bm.visible).toBe(false);
    S.dispose();
  });

  it('people do not collide: a car on top of the player moves nobody', async () => {
    const { S, PV, car } = setup(); S.enter(PV, car);
    await S.startEvent(ev('harbour_gp'), { net: field() });
    const ana = S.runner.active!.racers[0];
    ana.x = PV.x; ana.z = PV.z + 1; ana.h = PV.h; // overlapping: against the computer this is a crash
    const at = [PV.x, PV.z, ana.x, ana.z];
    expect(S.collide(PV)).toBe(0);
    expect([PV.x, PV.z, ana.x, ana.z]).toEqual(at);
    S.dispose();
  });

  it("a racer's name tag is small beside this driver and full size far off", () => {
    expect(tagSize(4)).toEqual({ w: 1.5, h: 0.375, y: 2.0625 }); // alongside: a third of a car's length, just over the roof
    expect(tagSize(13).w).toBeCloseTo(2.47, 2);                  // between, it grows with the distance: about one size on the screen
    expect(tagSize(13).h).toBeCloseTo(2.47 / 4, 2);
    expect(tagSize(40)).toEqual({ w: 5, h: 1.25, y: 2.5 });      // far off: as long as a car, so the name can still be read
    expect(tagSize(4000).w).toBe(5);
    expect(tagSize(0).w).toBe(1.5);
  });
  it('the tag is sized for the camera that draws it', async () => {
    const { S, PV, car } = setup(); S.enter(PV, car);
    // a minimal DOM for the tag's canvas (the suite has none): a 2D context that swallows every call
    const ctx = new Proxy({}, { get: (_t, k) => k === 'measureText' ? (text: string) => ({ width: text.length * 34 }) : () => {}, set: () => true });
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
    try {
      await S.startEvent(ev('royal_drag'), { net: field() });
      const m = S.runner.active!.racers[0].m as THREE.Group, tag = m.userData.tag as THREE.Sprite;
      expect(tag).toBeInstanceOf(THREE.Sprite);
      m.position.set(100, 0, 200); m.updateMatrixWorld(true);
      const cam = new THREE.PerspectiveCamera();
      /** the tag's width, height and height over the road (metres) once drawn from `metres` away */
      const seenFrom = (metres: number) => {
        cam.position.set(100 + metres * WORLD_PER_M, 0, 200); cam.updateMatrixWorld(true);
        tag.onBeforeRender(null as never, null as never, cam, null as never, null as never, null as never);
        return [tag.scale.x, tag.scale.y, tag.position.y].map(v => v / WORLD_PER_M);
      };
      expect(seenFrom(4)).toEqual([1.5, 0.375, 2.0625]);
      expect(seenFrom(100)).toEqual([5, 1.25, 2.5]);
      expect(seenFrom(13)[0]).toBeCloseTo(2.47, 2);
    } finally { vi.unstubAllGlobals(); }
    S.dispose();
  });

  it("the player's finish is passed on once, at the line", async () => {
    let n = 0, clock = 0;
    const { S, PV, car } = setup({ onPlayerFinish: () => { n++; } }); S.enter(PV, car);
    await S.startEvent(ev('royal_drag'), { net: field({ goAt: () => 0, now: () => clock }) });
    clock = 100; S.update(1 / 60, true); // the green light has passed: racing
    const a = S.runner.active!, d = a.drag;
    expect(a.state).toBe('race'); expect(n).toBe(0);
    resetVehicle(PV, d.p0!.x + d.fwd[0] * (a.route.len + 1), d.p0!.z + d.fwd[1] * (a.route.len + 1), d.dir);
    clock = 15_000; S.update(1 / 60, true);
    expect(a.state).toBe('done'); expect(n).toBe(1);
    for (let i = 0; i < 120; i++) S.update(1 / 60, true);
    expect(n).toBe(1);
    S.dispose();
  });
});

