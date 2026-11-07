import * as THREE from 'three';
import { WORLD_PER_M } from '../world/units';

const W = WORLD_PER_M;
const FADE_RATE = .06; // alpha per second: a .55 mark is gone in about nine seconds

/** Tyre marks on the paving: one mesh of `max` quads (oldest reused), laid in world units. */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private pos: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;
  private head = 0;
  private live = 0;
  private maxA = 0; // the strongest alpha still on the mesh: 0 means nothing is visible, so nothing needs work

  constructor(private scene: THREE.Scene, private max = 400) {
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 12), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(max * 16), 4);
    for (let i = 0; i < max * 4; i++) this.col.setXYZW(i, .043, .047, .055, 0); // #0b0c0e, clear
    const idx = new Uint32Array(max * 6);
    for (let q = 0; q < max; q++) idx.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4, q * 4 + 3, q * 4 + 2], q * 6);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('color', this.col);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  get count(): number { return this.live; }

  /** A 0.3 x 0.6 W quad centred on (x, z), long side along heading h (physics heading: forward = (sin h, cos h)). */
  lay(x: number, z: number, h: number, alpha: number): void {
    const q = this.head;
    this.head = (q + 1) % this.max;
    this.live = Math.min(this.max, this.live + 1);
    const fx = Math.sin(h) * .3 * W, fz = Math.cos(h) * .3 * W; // half the length
    const rx = Math.cos(h) * .15 * W, rz = -Math.sin(h) * .15 * W; // half the width
    const y = .045 * W;
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let k = 0; k < 4; k++) {
      const [s, f] = c[k];
      this.pos.setXYZ(q * 4 + k, x + rx * s + fx * f, y, z + rz * s + fz * f);
      this.col.setW(q * 4 + k, alpha);
    }
    this.maxA = Math.max(this.maxA, alpha);
    this.pos.needsUpdate = this.col.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, this.live * 6);
  }

  fade(dt: number): void {
    if (this.maxA <= 0) return;
    const d = FADE_RATE * dt, a = this.col.array as Float32Array;
    for (let i = 0; i < this.max * 4; i++) { const j = i * 4 + 3; if (a[j] > 0) a[j] = Math.max(0, a[j] - d); }
    this.maxA = Math.max(0, this.maxA - d);
    this.col.needsUpdate = true;
    if (this.maxA <= 0) this.mesh.geometry.setDrawRange(0, 0); // all faded: draw nothing until the next mark
  }

  clear(): void {
    this.head = this.live = 0; this.maxA = 0;
    (this.col.array as Float32Array).forEach((_, i) => { if (i % 4 === 3) (this.col.array as Float32Array)[i] = 0; });
    this.col.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
