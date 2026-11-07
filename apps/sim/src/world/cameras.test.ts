import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChaseCamera } from './cameras';
import { carParams, makeVehicle, resetVehicle } from './physics';
import { ARCHETYPES, STOCK_CFG, TUNE_DEF } from './data';
import { WORLD_PER_M } from './units';
import { buildRoute } from './strip/routes';

const W = WORLD_PER_M;
const car = (x: number, z: number, h: number) => { const V = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF)); resetVehicle(V, x, z, h); return V; };

describe('ChaseCamera', () => {
  it('sits 6 m behind and 2 m up a parked car, in world units, looking along its heading', () => {
    const cam = new THREE.PerspectiveCamera(64, 1, .1 * W, 900 * W), C = new ChaseCamera(cam);
    const PV = car(10, 20, 0); C.reset(PV);
    for (let i = 0; i < 200; i++) C.update(PV, 1 / 60, false);
    expect(cam.position.x).toBeCloseTo(10 * W, 3); expect(cam.position.y).toBeCloseTo(2 * W, 3); expect(cam.position.z).toBeCloseTo((20 - 6) * W, 3);
    const dir = cam.getWorldDirection(new THREE.Vector3());
    expect(dir.z).toBeGreaterThan(.9); // heading 0 faces +Z
  });

  it('follows a quarter turn: heading pi/2 puts the chase cam on -X of the car', () => {
    const C = new ChaseCamera(new THREE.PerspectiveCamera()); const PV = car(0, 0, Math.PI / 2); C.reset(PV);
    for (let i = 0; i < 200; i++) C.update(PV, 1 / 60, false);
    expect(C.cam.position.x).toBeCloseTo(-6 * W, 3); expect(C.cam.position.z).toBeCloseTo(0, 3);
  });

  it('look-back flips to the front and hood mode rides on the car', () => {
    const C = new ChaseCamera(new THREE.PerspectiveCamera()); const PV = car(0, 0, 0); C.reset(PV);
    C.lookBack = true; C.update(PV, 1 / 60, false);
    expect(C.cam.position.z).toBeCloseTo(6 * W, 3);
    C.lookBack = false; C.mode = 2; C.update(PV, 1 / 60, false);
    expect(C.cam.position.z).toBeCloseTo(.4 * W, 3); expect(C.cam.position.y).toBeCloseTo(1.18 * W, 3);
  });

  it('shake decays and the nitrous fov kick widens the view', () => {
    const C = new ChaseCamera(new THREE.PerspectiveCamera(62)); const PV = car(0, 0, 0); C.reset(PV); C.shake = 1;
    for (let i = 0; i < 120; i++) C.update(PV, 1 / 60, true);
    expect(C.shake).toBe(0); expect(C.cam.fov).toBeGreaterThan(69);
  });

  it('lags a slide: the yaw settles half a slip angle toward the way the car is travelling', () => {
    const C = new ChaseCamera(new THREE.PerspectiveCamera()); const PV = car(10, 20, 0); C.reset(PV);
    PV.u = 20; PV.v = 20 * Math.tan(.4); PV.beta = .4;
    for (let i = 0; i < 200; i++) C.update(PV, 1 / 60, false);
    expect(Math.abs(C.yaw - (PV.h + .2))).toBeLessThan(.01);
  });

  it('the countdown flyover starts 28 m up and lands exactly on the chase camera', () => {
    const C = new ChaseCamera(new THREE.PerspectiveCamera(62)); const PV = car(0, 0, 0), route = buildRoute([[0, 0], [0, 400]], false);
    C.preview(route, 0, PV); expect(Math.abs(C.cam.position.y - 28 * W)).toBeLessThan(.01);
    C.preview(route, 1, PV); const got = C.cam.position.clone(); C.reset(PV);
    expect(got.distanceTo(C.cam.position)).toBeLessThan(.01 * W);
  });
});
