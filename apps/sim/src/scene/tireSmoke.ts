import * as THREE from 'three';
import { WORLD_PER_M } from '../world/units';

const W = WORLD_PER_M;
const PER_POINT = 48, LIFE = .9, RISE = 1.2 * W, BACK = .5 * W, EMIT = 40;

/** Grey tyre smoke at the given contact points, in the parent car's local frame (the car faces -Z, so back is +Z). */
export class TireSmoke {
  private pts: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.PointsMaterial;
  private pos: Float32Array;
  private col: THREE.BufferAttribute;
  private grow: THREE.BufferAttribute;
  private age: Float32Array;
  private acc: number[];
  private n: number;

  constructor(private parent: THREE.Object3D, private points: THREE.Vector3[]) {
    this.n = points.length * PER_POINT;
    this.pos = new Float32Array(this.n * 3);
    this.age = new Float32Array(this.n).fill(LIFE);
    this.acc = points.map(() => 0);
    this.col = new THREE.BufferAttribute(new Float32Array(this.n * 4).fill(1), 4);
    this.grow = new THREE.BufferAttribute(new Float32Array(this.n), 1); // per-particle size factor
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', this.col);
    this.geo.setAttribute('psize', this.grow);
    this.mat = new THREE.PointsMaterial({ color: 0x9aa0a6, size: 1.2 * W, transparent: true, opacity: .35, depthWrite: false, vertexColors: true });
    this.mat.onBeforeCompile = sh => {
      sh.vertexShader = 'attribute float psize;\n' + sh.vertexShader.replace('gl_PointSize = size;', 'gl_PointSize = size * psize;');
      // a soft round puff instead of a square: alpha falls off with the distance from the centre
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n float pd = length(gl_PointCoord - .5); if (pd > .5) discard; diffuseColor.a *= smoothstep(.5, .1, pd);');
    };
    this.pts = new THREE.Points(this.geo, this.mat);
    this.pts.frustumCulled = false;
    parent.add(this.pts);
  }

  update(dt: number, level: number): void {
    const { pos, age, col, grow } = this;
    for (let p = 0; p < this.points.length; p++) {
      if (level > 0) this.acc[p] += level * EMIT * dt; else this.acc[p] = 0;
      const base = p * PER_POINT;
      for (let k = 0; k < PER_POINT && this.acc[p] >= 1; k++) {
        const i = base + k;
        if (age[i] < LIFE) continue;
        age[i] = 0; this.acc[p] -= 1;
        pos[i * 3] = this.points[p].x + (Math.random() - .5) * .2 * W;
        pos[i * 3 + 1] = this.points[p].y;
        pos[i * 3 + 2] = this.points[p].z + (Math.random() - .5) * .2 * W;
      }
      this.acc[p] = Math.min(this.acc[p], 1);
    }
    for (let i = 0; i < this.n; i++) {
      if (age[i] >= LIFE) { grow.setX(i, 0); col.setW(i, 0); continue; }
      age[i] += dt;
      const t = Math.min(1, age[i] / LIFE);
      pos[i * 3 + 1] += RISE * dt; pos[i * 3 + 2] += BACK * dt;
      grow.setX(i, (1 + 2 * t) / 3); // x3 over its life; the material size is the full size
      col.setW(i, 1 - t);
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    col.needsUpdate = grow.needsUpdate = true;
  }

  dispose(): void {
    this.parent.remove(this.pts);
    this.geo.dispose();
    this.mat.dispose();
  }
}
