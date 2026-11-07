import * as THREE from 'three';
import type { Vehicle } from '../world/physics';
import { feelStep, freshFeel, skidLevel, smokeLevel, wheelRollRate, type Feel } from '../world/carFeel';
import { WORLD_PER_M } from '../world/units';
import { SkidMarks } from './skidMarks';
import { TireSmoke } from './tireSmoke';

const W = WORLD_PER_M;
type Rig = { tilt: THREE.Group; pivots: THREE.Object3D[]; wheels: THREE.Object3D[] };

/** The driven car's visual feel in the scene: body lean/dip/lift, wheel overspin, tyre smoke, skid marks.
 *  Wheel nodes are FL, FR, RL, RR (carGeometry's wheelPos order). */
export class CarFeelAdapter {
  private feel: Feel = freshFeel();
  private smoke: TireSmoke | null = null;
  private smokeFor: THREE.Object3D | null = null;
  private skids: Partial<Record<'town' | 'strip', SkidMarks>> = {};
  private last: [number, number] | null = null;

  /** Per frame after the pose is placed. `at` is the scene the car is in this frame. */
  frame(mesh: THREE.Group, V: Vehicle, simDt: number, wheelR: number, district: 'town' | 'strip', at: THREE.Scene, halt: boolean): void {
    const rig = mesh.userData.car as Rig | undefined;
    if (!rig) return;
    feelStep(V, simDt, this.feel);
    rig.tilt.rotation.set(-this.feel.pitch, 0, -this.feel.roll); // the body faces -Z under the pi yaw
    rig.tilt.position.y = this.feel.lift * W;
    if (!halt && simDt > 0) {
      const k = W / wheelR * simDt;
      rig.wheels.forEach((w, i) => w.rotateX(-wheelRollRate(V, i < 2) * k));
    }
    if (this.smokeFor !== mesh) {
      this.smoke?.dispose();
      const idx = V.P.drive === 'FWD' ? [2, 3, 0, 1] : [2, 3];
      this.smoke = new TireSmoke(mesh, idx.map(i => new THREE.Vector3(rig.pivots[i].position.x, 0, rig.pivots[i].position.z)));
      this.smokeFor = mesh;
    }
    this.smoke!.update(simDt, smokeLevel(V));
    this.skids[district]?.fade(simDt);
    if (skidLevel(V) > 0 && !halt) {
      const x = V.x, z = V.z;
      if (!this.last || Math.hypot(x - this.last[0], z - this.last[1]) >= .4) {
        this.last = [x, z];
        const marks = (this.skids[district] ??= new SkidMarks(at));
        const th = mesh.rotation.y, c = Math.cos(th), s = Math.sin(th);
        for (const i of [2, 3]) {
          const lx = rig.pivots[i].position.x, lz = rig.pivots[i].position.z;
          marks.lay(mesh.position.x + lx * c + lz * s, mesh.position.z - lx * s + lz * c, th - Math.PI, .55);
        }
      }
    } else this.last = null;
  }

  /** The marks of a district go when the car leaves it. */
  clearSkids(district: 'town' | 'strip'): void { this.skids[district]?.dispose(); delete this.skids[district]; this.last = null; }

  /** Out of the car: the body levels, smoke and marks go. */
  release(mesh: THREE.Group | undefined): void {
    const rig = mesh?.userData.car as Rig | undefined;
    if (rig) { rig.tilt.rotation.set(0, 0, 0); rig.tilt.position.y = 0; }
    this.smoke?.dispose(); this.smoke = this.smokeFor = null;
    this.clearSkids('town'); this.clearSkids('strip');
    this.feel = freshFeel();
  }
}
