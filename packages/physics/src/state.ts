// Allocates a vehicle's state: once per car, never inside the step.
import type { Controls, SurfaceSample, Telemetry, VehicleModel, VehicleState, WorldQuery } from './types';
import { AUTO_GEAR } from './types';

/** A zeroed state for a model, facing +X at the origin. vehicle.ts's createVehicle settles it at rest. */
export function createState(model: VehicleModel): VehicleState {
  return {
    model, time: 0,
    x: 0, y: 0, hx: 1, hy: 0,
    u: 0, v: 0, r: 0, ax: 0, ay: 0,
    heave: 0, pitch: 0, roll: 0, heaveRate: 0, pitchRate: 0, rollRate: 0,
    wheelOmega: new Float64Array(4), wheelLoad: new Float64Array(4), wheelFx: new Float64Array(4), wheelFy: new Float64Array(4),
    wheelMz: new Float64Array(4), wheelDefX: new Float64Array(4), wheelDefY: new Float64Array(4),
    wheelSlipRatio: new Float64Array(4), wheelSlipTan: new Float64Array(4), wheelSteer: new Float64Array(4), wheelBrake: new Float64Array(4),
    engineOmega: model.engine.idle, boost: 0, engineTorque: 0, clutchTorque: 0, clutchLocked: 0,
    gear: 1, gearNext: 1, shiftTimer: 0, ratio: model.driveline.gears[0],
    absActive: new Float64Array(4), tcsActive: 0, escActive: 0, limiterActive: 0,
    absHold: new Float64Array([1, 1, 1, 1]), tcsCut: 1,
    nitrousLeft: model.nitrous ? model.nitrous.bottleMass : 0,
    distance: 0, energyUsed: 0,
  };
}

/** Controls at rest: nothing pressed, the car choosing its own gear, its systems on. */
export function defaultControls(): Controls {
  return { steer: 0, throttle: 0, brake: 0, handbrake: 0, clutch: 0, gear: AUTO_GEAR, autoClutch: true, abs: true, tcs: true, esc: true, launchOmega: 0, nitrous: false };
}

/** An empty telemetry record to pass to telemetry(). */
export function createTelemetry(): Telemetry {
  return {
    speed: 0, u: 0, v: 0, accelLong: 0, accelLat: 0, yawRate: 0, sideslip: 0, roll: 0, pitch: 0, heave: 0,
    rpm: 0, gear: 0, boost: 0, throttleTorque: 0, clutchSlip: 0, shifting: false,
    wheelLoad: new Float64Array(4), wheelSlipRatio: new Float64Array(4), wheelSlipAngle: new Float64Array(4), wheelSpeed: new Float64Array(4),
    wheelUse: new Float64Array(4),
    absActive: false, tcsActive: false, escActive: false, limiterActive: false, nitrousLeft: 0,
  };
}

/** Flat, dry asphalt everywhere. */
export const FLAT: WorldQuery = {
  surfaceAt(_x: number, _y: number, out: SurfaceSample): void { out.height = 0; out.gradX = 0; out.gradY = 0; out.grip = 1; out.rolling = 1; },
};
/** An empty surface sample to pass to WorldQuery.surfaceAt. */
export function createSurfaceSample(): SurfaceSample { return { height: 0, gradX: 0, gradY: 0, grip: 1, rolling: 1 }; }
