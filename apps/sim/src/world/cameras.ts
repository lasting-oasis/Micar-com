// The driving camera, ported from Night Tuner 09-main.js updateCamera: chase (0), far chase (1)
// and hood (2), a B look-back, crash shake and a nitrous fov kick.
// Physics is in metres with heading h facing +Z: the car's forward is (sin h, cos h) in the x/z
// plane (syncBody's u = vx·sin h + vz·cos h). The THREE scene is the same plane scaled by
// WORLD_PER_M (the lofted bodies face −Z locally and get rotation.y = h + π to line up), so the
// camera works out Night Tuner's metre offsets and multiplies by WORLD_PER_M.
import type * as THREE from 'three';
import { clamp, type Vehicle } from './physics';
import { WORLD_PER_M } from './units';
import { routePoint, type Route } from './strip/routes';

const W = WORLD_PER_M;
export const CAM_NAMES = ['Chase', 'Far chase', 'Hood'] as const;

export class ChaseCamera {
  /** 0 chase, 1 far chase, 2 hood */
  mode: 0 | 1 | 2 = 0;
  /** hold to look behind (Night Tuner: B held) */
  lookBack = false;
  /** crash shake 0..1; decays 2/s. Add to it on an impact (Night Tuner: shake = min(1, shake + imp/14)). */
  shake = 0;
  /** the smoothed yaw the chase cams follow */
  yaw = 0;

  constructor(readonly cam: THREE.PerspectiveCamera) {}

  cycle(): void { this.mode = ((this.mode + 1) % 3) as 0 | 1 | 2; }

  /** Snap behind the car (spawn, respawn, event start). */
  reset(PV: Vehicle): void {
    this.yaw = PV.h; this.shake = 0;
    const fx = Math.sin(PV.h), fz = Math.cos(PV.h);
    this.cam.position.set((PV.x - fx * 6) * W, 2 * W, (PV.z - fz * 6) * W);
    this.cam.lookAt((PV.x + fx * 3.5) * W, .95 * W, (PV.z + fz * 3.5) * W);
  }

  /** Countdown flyover: from 40 m behind the start and 28 m up, looking down the first 150 m of the route,
   *  settling (smoothstep) onto exactly the pose reset(PV) gives. */
  preview(route: Route, t01: number, PV: Vehicle): void {
    const t = clamp(t01, 0, 1), s = t * t * (3 - 2 * t), cam = this.cam;
    const st = routePoint(route, 0), la = routePoint(route, 150);
    const fx = Math.sin(PV.h), fz = Math.cos(PV.h);
    const ax = (st.x - st.tx * 40) * W, ay = 28 * W, az = (st.z - st.tz * 40) * W;
    const bx = (PV.x - fx * 6) * W, by = 2 * W, bz = (PV.z - fz * 6) * W;
    cam.position.set(ax + (bx - ax) * s, ay + (by - ay) * s, az + (bz - az) * s);
    const lx = la.x * W, ly = 1 * W, lz = la.z * W;
    const mx = (PV.x + fx * 3.5) * W, my = .95 * W, mz = (PV.z + fz * 3.5) * W;
    cam.lookAt(lx + (mx - lx) * s, ly + (my - ly) * s, lz + (mz - lz) * s);
    cam.fov += (62 - cam.fov) * .1; cam.updateProjectionMatrix();
    this.yaw = PV.h; this.shake = 0;
  }

  update(PV: Vehicle, dt: number, nosOn: boolean): void {
    const cam = this.cam, p = cam.position, sp = Math.hypot(PV.vx, PV.vz);
    let d = PV.h + (this.mode === 2 ? 0 : clamp(PV.beta, -.6, .6) * .5) - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw += d * Math.min(1, dt * (this.mode === 2 ? 20 : 4.2));
    const yaw = this.lookBack ? this.yaw + Math.PI : this.yaw; const fx = Math.sin(yaw), fz = Math.cos(yaw);
    this.shake = Math.max(0, this.shake - dt * 2); const sh = (this.shake + (nosOn ? .12 : 0)) * .35;
    if (this.mode === 2 && !this.lookBack) {
      const hx = Math.sin(PV.h), hz = Math.cos(PV.h);
      p.set((PV.x + hx * .4) * W, 1.18 * W, (PV.z + hz * .4) * W);
      cam.lookAt((PV.x + hx * 20) * W, 1.0 * W, (PV.z + hz * 20) * W);
    } else {
      const dist = (this.mode === 1 ? 8.6 : 6.0) + sp * .025, hgt = this.mode === 1 ? 3.1 : 2.0;
      const tx = (PV.x - fx * dist) * W, tz = (PV.z - fz * dist) * W, k = this.lookBack ? 1 : 1 - Math.exp(-dt * 8);
      p.x += (tx - p.x) * k; p.z += (tz - p.z) * k; p.y += (hgt * W - p.y) * k;
      if (sh > 0) { p.x += (Math.random() - .5) * sh * W; p.y += (Math.random() - .5) * sh * .6 * W; }
      cam.lookAt((PV.x + fx * 3.5) * W, .95 * W, (PV.z + fz * 3.5) * W);
    }
    const fov = 62 + Math.min(16, sp * .2) + (nosOn ? 8 : 0); cam.fov += (fov - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix();
  }
}
