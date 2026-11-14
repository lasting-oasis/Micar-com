// A plain car for tests, built by hand so that a module's tests do not depend on the resolver.
// It is not data about any real car and nothing outside tests may import it.
import type { AeroModel, BrakeModel, ChassisModel, DrivelineModel, EngineModel, SystemsModel, TyreParams, VehicleModel } from './types';
import { G } from './math';

/** A summer tyre on a mid-size car. */
export function fixtureTyre(over: Partial<TyreParams> = {}): TyreParams {
  return {
    radius: 0.33, width: 0.245, fz0: 4000, muY0: 1.02, muXRatio: 1.1, loadSens: 0.13, slideRatio: 0.82, slideFall: 1.2,
    cAlpha0: 16 * 4000, fzStiffPeak: 2.2 * 4000, cKappaPerFz: 19, relaxLat: 0.5, relaxLong: 0.18, rollRes: 0.0095, trail0: 0.03,
    ...over,
  };
}

/** A 300 kW unboosted engine with a simple torque curve: tables every 12 rad/s to past its 7000 rpm limiter. */
export function fixtureEngine(over: Partial<EngineModel> = {}): EngineModel {
  const n = 72, dOmega = 12;
  const wot = new Float64Array(n), friction = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = i * dOmega, x = w / 500;            // peak torque near 500 rad/s (4775 rpm)
    wot[i] = 430 * (0.62 + 0.76 * x - 0.38 * x * x);   // 267 N m at 0, 430 at the peak, falling after
    friction[i] = 18 + 0.045 * w;
  }
  return {
    kind: 'na', displacement: 0.005, cylinders: 8, inertia: 0.28, idle: 73, redline: 733, limiterBand: 30, n, dOmega,
    wot, offBoost: wot, friction, boost: null, regen: 0, air: null,
    ...over,
  };
}

export function fixtureChassis(over: Partial<ChassisModel> = {}): ChassisModel {
  const mass = 1600, unsprungFront = 78, unsprungRear = 78, sprungMass = mass - unsprungFront - unsprungRear;
  const a = 1.25, b = 1.45, cgHeight = 0.52, uh = 0.33;
  return {
    mass, sprungMass, unsprungFront, unsprungRear,
    a, b, wheelbase: a + b, trackFront: 1.58, trackRear: 1.6,
    cgHeight, sprungCgHeight: (mass * cgHeight - (unsprungFront + unsprungRear) * uh) / sprungMass, unsprungHeightFront: uh, unsprungHeightRear: uh,
    izz: 0.96 * mass * a * b, ixx: 480, iyy: 2100,
    springFront: 34000, springRear: 38000, damperFront: 2600, damperRear: 2800, arbFront: 26000, arbRear: 14000,
    rollCentreFront: 0.04, rollCentreRear: 0.1, antiDive: 0.2, antiSquat: 0.3, maxSteer: 0.6, steerRatio: 15,
    ...over,
  };
}

export function fixtureDriveline(over: Partial<DrivelineModel> = {}): DrivelineModel {
  return {
    layout: 'RWD', transmission: 'manual', gears: new Float64Array([3.5, 2.1, 1.5, 1.15, 0.92, 0.76]), reverse: 3.3, finalDrive: 3.7,
    efficiency: 0.92, shiftTime: 0.3, shiftTorqueHold: 0, launch: 'clutch', clutchCapacity: 700, converter: null, cvtRatioRate: 0,
    centre: { kind: 'none', frontShare: 0, lockTorque: 0 },
    diffFront: { kind: 'open', preload: 0, lockPerTorque: 0 }, diffRear: { kind: 'open', preload: 0, lockPerTorque: 0 },
    ...over,
  };
}

export type FixtureParts = {
  chassis?: Partial<ChassisModel>; tyreFront?: Partial<TyreParams>; tyreRear?: Partial<TyreParams>; engine?: Partial<EngineModel>;
  driveline?: Partial<DrivelineModel>; brakes?: Partial<BrakeModel>; aero?: Partial<AeroModel>; systems?: Partial<SystemsModel>;
};

/** A 1,600 kg rear-drive coupe on summer tyres with a six-speed manual. Pass parts to change any of it. */
export function fixtureModel(over: FixtureParts = {}): VehicleModel {
  const chassis = fixtureChassis(over.chassis);
  const tyreFront = fixtureTyre(over.tyreFront), tyreRear = fixtureTyre(over.tyreRear);
  const total = 1.3 * chassis.mass * G * tyreFront.radius; // full pedal is worth 1.3 g
  return {
    id: 'fixture', name: 'Test coupe', chassis, tyreFront, tyreRear,
    wheelInertiaFront: 1.3, wheelInertiaRear: 1.4,
    engine: fixtureEngine(over.engine),
    driveline: fixtureDriveline(over.driveline),
    brakes: { maxTorqueFront: total * 0.66 / 2, maxTorqueRear: total * 0.34 / 2, handbrakeTorque: 1800, ...over.brakes },
    aero: { dragArea: 0.62, liftAreaFront: 0.06, liftAreaRear: 0.07, roadLoadA: 0, roadLoadB: 0, ...over.aero },
    systems: { abs: true, tcs: true, esc: true, launchControl: false, limiterSpeed: Infinity, ...over.systems },
    nitrous: null,
  };
}
