import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as THREE from 'three';

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
      const halos = new THREE.Points(hg); group.add(body, wheelMesh, halos);
      group.userData.car = { pivots, wheels, body, wheelMesh, halos, far: false };
      return { group, wheels, frontPivots: pivots.slice(0, 2) };
    },
    disposeCarModel: (g: THREE.Object3D) => { g.removeFromParent(); g.userData.disposed = true; },
    setCarLights: () => {}, syncCarWheels: () => {},
    attachCarShadows: (s: THREE.Object3D) => { shadow = s; }, carShadowScene: () => shadow,
  };
});
const { StripScene, STRIP_SPAWN } = await import('./scene');
const { EVENTS } = await import('../data');
const { DRAG_LANES } = await import('./events');
const { makeVehicle, carParams, resetVehicle } = await import('../physics');
const { ARCHETYPES, STOCK_CFG, TUNE_DEF } = await import('../data');
const { RENTAL_CAM } = await import('../rental');
const { WORLD_PER_M } = await import('../units');
const { HUB, TRACKS, offsetOf } = await import('./district');
const { setTrackDir, readTrackSync } = await import('./districtNode');
const path = await import('node:path');

beforeAll(() => {
  setTrackDir(path.resolve(process.cwd(), 'public/strip/tracks'));
  for (const t of TRACKS) readTrackSync(t.id);
});

const cars = (s: THREE.Scene) => s.children.filter(o => o.userData.strip);
const lights = (s: THREE.Scene) => { let n = 0; s.traverse(o => { if ((o as THREE.Light).isLight) n++; }); return n; };
const ev = (id: string) => EVENTS.find(e => e.id === id)!;
function setup(extra: { onEventQuit?: () => void } = {}) {
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

  it('exit from a track returns home first', async () => {
    const { S, PV, car } = setup(); S.enter(PV, car);
    await S.enterTrack('monza');
    S.exit();
    expect(S.zone.kind).toBe('hub'); expect(S.mounted).toBeNull();
    S.dispose();
  });
});
