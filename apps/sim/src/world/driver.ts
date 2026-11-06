/* One driving model for the whole world: Night Tuner's vehicle (physics.ts) stepped at a fixed
   120 Hz from the render loop, with the fuel burn, and the town's collision boxes as walls.
   Physics is in metres with heading h facing +Z (forward = (sin h, cos h)); the scene is in world
   units (WORLD_PER_M per metre) and the lofted bodies face -Z, so a car's rotation.y is h + PI. */
import type * as THREE from 'three';
import { carParams, makeVehicle, resetVehicle, stepVehicle, syncBody, type Input, type Tune, type Vehicle, type VehicleSpec } from './physics';
import type { CarCfg } from './data';
import { WORLD_PER_M } from './units';

const W = WORLD_PER_M;
export const STEP = 1 / 120;
/** a frame longer than this is clamped (a slow frame, a tab switch) */
export const MAX_FRAME = 0.05;
export const MAX_STEPS = 6;
/** Fuel: 0.0009 of the 100-unit tank per second at full throttle, plus 0.00004 units per second per m/s. */
export const FUEL_PER_THR = 0.0009 * 100, FUEL_PER_MS = 0.00004;

export type DriveState = { cfg: CarCfg; tune: Tune };
export type DriveOpts = {
  drift: boolean;
  /** the tank now (0..100); at 0 the car gets no throttle and coasts */
  fuel: () => number;
  /** fuel used by one sub-step */
  burn: (f: number) => void;
  /** collisions after each sub-step; returns the impact (m/s into the wall) */
  collide: (V: Vehicle) => number;
  /** the input the car gets for a sub-step (the Strip's EventRunner.input); default: as given */
  map?: (I: Input, dt: number) => Input;
};

export class Driver {
  V: Vehicle;
  private acc = 0;
  private readonly I = {} as Input;
  private readonly res = { impact: 0, steps: 0 };
  private readonly out = { x: 0, y: 0, z: 0, rotY: 0 };

  constructor(spec: VehicleSpec, state: DriveState, start: { x: number; z: number; h: number }) {
    this.V = makeVehicle(carParams(spec, state.cfg.perf, state.tune));
    resetVehicle(this.V, start.x, start.z, start.h);
  }

  /** New parts or tune (or another spec): the car keeps its place and speed. */
  rebuild(spec: VehicleSpec, state: DriveState): void {
    const P = carParams(spec, state.cfg.perf, state.tune), V = this.V;
    V.P = P; V.nos = Math.min(V.nos, P.nos.cap); if (V.rpm < P.idle) V.rpm = P.idle;
  }

  /** Put the car at (x, z) metres facing h, stopped. */
  place(x: number, z: number, h: number): void { resetVehicle(this.V, x, z, h); this.acc = 0; }

  /** Step the frame's worth of fixed 1/120 s sub-steps (dt clamped to 0.05 s, at most 6 steps). */
  stepFrame(dtFrame: number, input: Input, opts: DriveOpts): { impact: number; steps: number } {
    const V = this.V, I = Object.assign(this.I, input);
    this.acc += Math.min(MAX_FRAME, Math.max(0, dtFrame));
    let steps = 0, impact = 0;
    while (this.acc >= STEP - 1e-9 && steps < MAX_STEPS) {
      this.acc -= STEP;
      const J = opts.map ? opts.map(I, STEP) : I;
      const empty = opts.fuel() <= 0;
      if (empty) { if (V.gear === -1) J.back = 0; else J.fwd = 0; }
      stepVehicle(V, J, STEP, opts.drift);
      if (!empty) opts.burn((FUEL_PER_THR * V.thr + FUEL_PER_MS * Math.abs(V.u)) * STEP);
      const imp = opts.collide(V); if (imp > impact) impact = imp;
      I.shiftUp = I.shiftDn = I.hop = false; // one-shot edges reach one sub-step
      steps++;
    }
    if (this.acc > STEP) this.acc = STEP;
    V.hit = impact;
    this.res.impact = impact; this.res.steps = steps;
    return this.res;
  }

  /** The car group's transform in world units (lofted bodies face -Z). One reused object. */
  pose(): { x: number; y: number; z: number; rotY: number } {
    const o = this.out, V = this.V;
    o.x = V.x * W; o.y = 0; o.z = V.z * W; o.rotY = V.h + Math.PI;
    return o;
  }
}

const OFFS = [1.25, -1.25] as const, R = .98;
/** above this (world units) a box is overhead: a sign, an awning (the old car's spheres reached 1.6) */
const TOP = 1.6;

/**
 * The town's walls for the physics car: the axis-aligned boxes (world units) read live each call
 * (gate barriers open and close by changing their box), with collideBlocks' response.
 */
export function townCollider(colliders: THREE.Box3[]): (V: Vehicle) => number {
  return (V: Vehicle): number => {
    let hit = 0;
    const sh = Math.sin(V.h), ch = Math.cos(V.h);
    for (const off of OFFS) {
      let cx = V.x + sh * off, cz = V.z + ch * off;
      for (let i = 0; i < colliders.length; i++) {
        const b = colliders[i], mn = b.min, mx = b.max;
        if (mn.y > TOP || mx.x < mn.x || mx.z < mn.z || mx.y < mn.y) continue; // overhead or empty
        const x0 = mn.x / W, x1 = mx.x / W, z0 = mn.z / W, z1 = mx.z / W;
        if (cx < x0 - R || cx > x1 + R || cz < z0 - R || cz > z1 + R) continue;
        const qx = Math.max(x0, Math.min(cx, x1)), qz = Math.max(z0, Math.min(cz, z1));
        const dx = cx - qx, dz = cz - qz, d = Math.hypot(dx, dz);
        if (d >= R) continue;
        let nx: number, nz: number, pen: number;
        if (d > 1e-4) { nx = dx / d; nz = dz / d; pen = R - d; }
        else {
          const l = cx - x0, r = x1 - cx, t = cz - z0, bt = z1 - cz, m = Math.min(l, r, t, bt);
          nx = m === l ? -1 : m === r ? 1 : 0; nz = nx !== 0 ? 0 : m === t ? -1 : 1; pen = m + R;
        }
        V.x += nx * pen; V.z += nz * pen; cx += nx * pen; cz += nz * pen;
        const vn = V.vx * nx + V.vz * nz;
        if (vn < 0) { V.vx -= 1.3 * vn * nx; V.vz -= 1.3 * vn * nz; V.vx *= .92; V.vz *= .92; V.w += off * (nx * ch - nz * sh) * (-vn) * .05; hit = Math.max(hit, -vn); }
      }
    }
    if (hit > 0) syncBody(V);
    return hit;
  };
}
