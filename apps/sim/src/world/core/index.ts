// The game's way onto the physics core (packages/physics DESIGN.md section 13): which driver a car gets, by the switch.
// With the switch off (the default) makeDriver builds world/driver.ts's Driver exactly as the scene always has.
import { Driver, type DriveState } from '../driver';
import type { VehicleSpec } from '../physics';
import { CoreDriver, isCoreDriver, type DriverLike } from './driver';
import type { CoreCar } from './model';
import { assistsInAddress, coreChosen, type DrivingMode } from './switch';

export { CoreDriver, isCoreDriver, shiftCue, type CoreDriveOpts, type DriverLike } from './driver';
export { coreModelFor, type CoreCar } from './model';
export { assistsInAddress, coreChosen, drivingMode, type DrivingMode } from './switch';

/** A driver for a car got into at `start` (metres, h): the core's when the switch is on (with the assist preset ?assists= names, Standard by default), else the old model's. */
export function makeDriver(car: CoreCar, spec: VehicleSpec, state: DriveState, start: { x: number; z: number; h: number },
  notice?: (txt: string) => void, core: boolean = coreChosen()): DriverLike {
  return core ? new CoreDriver(car, spec, state, start, { notice, preset: assistsInAddress() ?? undefined }) : new Driver(spec, state, start);
}

/** Which model a driver drives on (null: none). */
export function driverKind(d: DriverLike | null | undefined): DrivingMode | null {
  return d ? (isCoreDriver(d) ? 'core' : 'classic') : null;
}

/**
 * The driver for the switch as it stands now: the same one when it already drives on that model, else one on the
 * other model that takes over the same Vehicle object (the Strip and its race runner hold it), its place and speed
 * kept, as a Garage rebuild keeps them.
 */
export function matchDrivingMode(d: DriverLike, car: CoreCar, spec: VehicleSpec, state: DriveState, notice?: (txt: string) => void,
  core: boolean = coreChosen()): DriverLike {
  if (core === isCoreDriver(d)) return d;
  const V = d.V;
  if (core) return new CoreDriver(car, spec, state, { x: V.x, z: V.z, h: V.h }, { adopt: V, notice, preset: assistsInAddress() ?? undefined });
  const next = new Driver(spec, state, { x: V.x, z: V.z, h: V.h });
  next.V = V;
  next.rebuild(spec, state);
  // The old model has no neutral and only its own gears: a gear past its box comes down to its top.
  const n = V.P.gears.length;
  if (V.gear !== -1) V.gear = Math.max(1, Math.min(n, Math.round(V.gear) || 1));
  if (V.shift > 0) V.shift = 0;
  return next;
}
