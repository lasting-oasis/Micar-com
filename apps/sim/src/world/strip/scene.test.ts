import { describe, it, expect, vi } from 'vitest';
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

const cars = (s: THREE.Scene) => s.children.filter(o => o.userData.strip);
const lights = (s: THREE.Scene) => { let n = 0; s.traverse(o => { if ((o as THREE.Light).isLight) n++; }); return n; };
function setup() {
  const banners: string[] = [];
  const S = new StripScene({ onBanner: t => { banners.push(t); }, onSfx: () => {} });
  S.load();
  const PV = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF)); resetVehicle(PV, STRIP_SPAWN.x, STRIP_SPAWN.z, STRIP_SPAWN.h);
  const town = new THREE.Scene(), car = new THREE.Group(); town.add(car);
  return { S, PV, town, car, banners };
}

describe('StripScene', () => {
  it('loads 14 traffic cars and 3 rivals with no lights of their own', () => {
    const { S } = setup();
    expect(S.ais.filter(A => A.kind === 'traffic').length).toBe(14);
    expect(S.ais.filter(A => A.kind === 'rival').length).toBe(3);
    expect(cars(S.scene).length).toBe(17);
    expect(lights(S.scene)).toBe(2); // the city's sky light and moon
    expect(S.markers[0].x).toBe(EVENTS[0].nodes[0][0] * 90); // markers in metres for nearEvent / the HUD
    S.dispose();
  });

  it('draws the AI in world units, facing -Z', () => {
    const { S } = setup(); S.update(1 / 60, true);
    const A = S.ais[0], m = A.m as THREE.Group;
    expect(m.position.x).toBeCloseTo(A.x * 2, 6); expect(m.position.z).toBeCloseTo(A.z * 2, 6);
    expect(m.rotation.y).toBeCloseTo(A.h + Math.PI, 6); expect(m.visible).toBe(true);
    S.dispose();
  });

  it('enter / exit move the player car in and out; a drag race places its cars by lane and cleans up', () => {
    const { S, PV, town, car } = setup();
    S.enter(PV, car); expect(car.parent).toBe(S.scene);
    const L0 = lights(S.scene);
    S.startEvent(EVENTS.find(e => e.id === 'dr1')!);
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
});
