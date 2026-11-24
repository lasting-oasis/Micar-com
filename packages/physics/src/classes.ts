// Class tables: the one place a "typical" value lives (DESIGN.md rule 2 and section 7).
// When a sheet leaves a figure blank, resolve.ts takes it from here and marks it `estimated`. A figure here may be
// tuned, with a physical reason, for every car at once; never for one car. Estimates lean unfavourable, so that a
// real figure usually does better than a blank.
// Numbers only: tables, and formulas of one line. Nothing here reads a sheet or decides between sources.
// Everything is SI (m, kg, s, N, rad, rad/s, Pa, W). A figure the trade quotes in other units is written in those
// units and converted where it stands (750 * RPM, degPerG(5.0), 130 * MPH), so the source still reads like the
// literature it came from.
// Every table and every row is frozen. Copy a row's figures into a model, never the row object itself: parts change
// a model in place, and writing to a frozen row throws.
import type {
  AwdKind, BodyClass, DiffKind, DiffModel, Drivetrain, DrivelineModel, EngineLocation, Powertrain, SuspensionGrade,
  TransmissionType, TyreCategory,
} from './types';
import { G, PI, clamp, dpow } from './math';
import { HP, LB, MPH, RPM } from './units';

/** Freezes an object and everything inside it, so a shared default can never be changed by one car. */
function deepFreeze<T extends object>(o: T): Readonly<T> {
  const values = Object.values(o);
  for (let i = 0; i < values.length; i++) {
    const v: unknown = values[i];
    if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) deepFreeze(v);
  }
  Object.freeze(o);
  return o;
}

const DEG = PI / 180;
// Roll gradient is quoted in degrees per g; the model wants radians per m/s^2.
function degPerG(deg: number): number { return deg * DEG / G; }

/* ------------------------------------------------------------------ the unions, in a fixed order */

/** The nine body classes in a fixed order, for loops that must not depend on object key order. */
export const BODY_CLASSES: readonly BodyClass[] = deepFreeze<BodyClass[]>(['sports', 'coupe', 'sedan', 'hatchback', 'wagon', 'suv', 'van', 'pickup', 'offroad']);
/** The seven tyre categories in a fixed order, least to most grip on dry asphalt, then the drag tyre. */
export const TYRE_CATEGORIES: readonly TyreCategory[] = deepFreeze<TyreCategory[]>(['winter', 'all-terrain', 'all-season', 'summer', 'max-performance', 'track', 'drag']);
/** The six transmission types in a fixed order. */
export const TRANSMISSION_TYPES: readonly TransmissionType[] = deepFreeze<TransmissionType[]>(['manual', 'dual-clutch', 'automatic', 'cvt', 'ecvt', 'single-speed']);
/** The four suspension grades in a fixed order. */
export const SUSPENSION_GRADES: readonly SuspensionGrade[] = deepFreeze<SuspensionGrade[]>(['standard', 'sport', 'adaptive', 'offroad']);

/* ------------------------------------------------------------------ tyres */

/** What a tyre category gives a tyre (TyreParams), before its size and the car's own grip scale. */
export type TyreCategoryRow = Readonly<{
  /** Peak lateral friction at the reference load on dry asphalt, before the car's grip scale. */
  muY0: number;
  /** The friction a car calibrated to its skidpad figure may reach: muY0 x grip scale stays inside these. */
  muY0Min: number; muY0Max: number;
  /** Peak longitudinal over peak lateral friction. */
  muXRatio: number;
  /** Share of friction lost per reference load of extra load. */
  loadSens: number;
  /** Sliding friction far past the peak, as a share of the peak, and how fast it falls there. */
  slideRatio: number; slideFall: number;
  /** Cornering stiffness at the reference load over that load, per rad (cAlpha0 = this x fz0). */
  cAlphaPerFz: number;
  /** Longitudinal slip stiffness over load, per unit slip. */
  cKappaPerFz: number;
  /** Relaxation lengths, m. */
  relaxLat: number; relaxLong: number;
  /** Rolling resistance coefficient. */
  rollRes: number;
}>;

/**
 * DESIGN.md section 7's tyre table. Cornering stiffness is also given per degree in the comments (the "cornering
 * coefficient" tyre data sheets quote: about 0.15 to 0.25 per degree for road tyres, up to 0.4 for racing ones).
 */
export const TYRE_CATEGORY: Readonly<Record<TyreCategory, TyreCategoryRow>> = deepFreeze<Record<TyreCategory, TyreCategoryRow>>({
  // Touring tyre: family cars on it test 0.80 to 0.88 g on a skidpad. 0.23 per degree; rolling resistance 0.007 to 0.010.
  'all-season': { muY0: 0.92, muY0Min: 0.82, muY0Max: 1.00, muXRatio: 1.08, loadSens: 0.12, slideRatio: 0.80, slideFall: 1.2, cAlphaPerFz: 13, cKappaPerFz: 16, relaxLat: 0.55, relaxLong: 0.20, rollRes: 0.0085 },
  // Summer performance tyre: sporty cars on it test 0.88 to 0.98 g. 0.28 per degree.
  summer: { muY0: 1.02, muY0Min: 0.94, muY0Max: 1.10, muXRatio: 1.10, loadSens: 0.13, slideRatio: 0.82, slideFall: 1.2, cAlphaPerFz: 16, cKappaPerFz: 19, relaxLat: 0.50, relaxLong: 0.18, rollRes: 0.0095 },
  // Max-performance (Pilot Sport 4S class): sports cars on it test 0.95 to 1.08 g. 0.33 per degree.
  'max-performance': { muY0: 1.12, muY0Min: 1.04, muY0Max: 1.22, muXRatio: 1.12, loadSens: 0.14, slideRatio: 0.83, slideFall: 1.3, cAlphaPerFz: 19, cKappaPerFz: 22, relaxLat: 0.45, relaxLong: 0.16, rollRes: 0.0105 },
  // Road-legal track tyre (Cup 2, R-compound): 1.05 to 1.2 g in magazine tests. 0.38 per degree.
  track: { muY0: 1.28, muY0Min: 1.18, muY0Max: 1.40, muXRatio: 1.12, loadSens: 0.15, slideRatio: 0.85, slideFall: 1.5, cAlphaPerFz: 22, cKappaPerFz: 25, relaxLat: 0.40, relaxLong: 0.15, rollRes: 0.012 },
  // All-terrain: open tread blocks squirm. Trucks on it test 0.70 to 0.80 g. 0.17 per degree; rolling resistance 0.010 to 0.015.
  'all-terrain': { muY0: 0.80, muY0Min: 0.72, muY0Max: 0.88, muXRatio: 1.05, loadSens: 0.10, slideRatio: 0.80, slideFall: 1.0, cAlphaPerFz: 10, cKappaPerFz: 13, relaxLat: 0.65, relaxLong: 0.25, rollRes: 0.011 },
  // Winter tyre on DRY asphalt: soft siped compound, below an all-terrain. (Snow and ice are surface grip, not this.)
  winter: { muY0: 0.78, muY0Min: 0.70, muY0Max: 0.86, muXRatio: 1.05, loadSens: 0.10, slideRatio: 0.80, slideFall: 1.0, cAlphaPerFz: 10, cKappaPerFz: 13, relaxLat: 0.65, relaxLong: 0.25, rollRes: 0.011 },
  // Drag radial on a prepared, rubbered-in strip: longitudinal friction 1.5 and up is what 1.5 g launches need.
  drag: { muY0: 1.00, muY0Min: 0.90, muY0Max: 1.10, muXRatio: 1.55, loadSens: 0.10, slideRatio: 0.85, slideFall: 1.0, cAlphaPerFz: 12, cKappaPerFz: 20, relaxLat: 0.60, relaxLong: 0.22, rollRes: 0.014 },
});

/** The grip scales a category allows a calibrated car: its friction range over its starting friction. */
export function tyreGripScaleRange(category: TyreCategory): { min: number; max: number } {
  const t = TYRE_CATEGORY[category];
  return { min: t.muY0Min / t.muY0, max: t.muY0Max / t.muY0 };
}

/** Loaded rolling radius over the unloaded radius the size gives (a road tyre deflects about 3% under its load). */
export const LOADED_RADIUS_RATIO = 0.97;
/** The load where cornering stiffness peaks, over the reference load (TyreParams.fzStiffPeak = this x fz0). */
export const FZ_STIFF_PEAK_RATIO = 2.2;
/** Pneumatic trail at small slip, m: road tyres measure 20 to 40 mm. */
export const TRAIL0 = 0.03;

/**
 * The reference load fz0 scales with the tyre's size, because a tyre is built to carry a load like the one its size
 * is fitted for: 4000 N for a 225 mm wide, 0.66 m tall tyre (a mid-size car's corner), kept to 3000 to 7500 N.
 */
export const TYRE_REFERENCE_LOAD = deepFreeze({ load: 4000, width: 0.225, diameter: 0.66, min: 3000, max: 7500 });

/** fz0 for a tyre of this section width and unloaded overall diameter (both m), N. */
export function tyreReferenceLoad(width: number, diameter: number): number {
  const r = TYRE_REFERENCE_LOAD;
  return clamp(r.load * (width / r.width) * (diameter / r.diameter), r.min, r.max);
}

/* ------------------------------------------------------------------ body classes */

/** What a body class gives the chassis and the body's air, when the sheet does not (DESIGN.md section 7's table). */
export type ChassisClassRow = Readonly<{
  /** Height of the centre of gravity over the car's overall height. */
  cgHeightRatio: number;
  /** Ride frequency of the sprung mass on its springs at each axle, Hz. */
  rideHzFront: number; rideHzRear: number;
  /** Damping as a share of critical damping, both axles. */
  dampingRatio: number;
  /** Body roll per unit of lateral acceleration, rad per m/s^2 (written as the deg/g the trade quotes). */
  rollGradient: number;
  /** Front share of roll stiffness minus front share of weight: positive is a road car's understeering set-up. */
  rollShareOverWeight: number;
  /** Roll-centre heights above the road, m. */
  rollCentreFront: number; rollCentreRear: number;
  /** Unsprung mass of each axle (both corners), kg. */
  unsprungFront: number; unsprungRear: number;
  /** Dynamic index Izz / (m a b): 1 is a car that yaws like two masses at its axles. */
  yawIndex: number;
  /** Drag coefficient x frontal area, m^2. */
  dragArea: number;
  /** Lift coefficient x frontal area at each axle, m^2 (positive lifts). */
  liftAreaFront: number; liftAreaRear: number;
}>;

/**
 * DESIGN.md section 7's body-class table. Published ranges: ride frequencies 1.0 to 1.5 Hz for comfort cars and 1.5
 * to 2.5 Hz for sports cars, the rear 10 to 20% above the front (a flat ride over a bump); damping 0.25 to 0.5 of
 * critical; roll gradients 3 to 7 deg/g for road cars and 1.5 to 3 for sports cars; dynamic index 0.9 to 1.1. The
 * drag areas are the card engine's own (packages/engine/src/rules.ts, SPEED.estimate.dragArea), so the two agree.
 */
export const CHASSIS_CLASS: Readonly<Record<BodyClass, ChassisClassRow>> = deepFreeze<Record<BodyClass, ChassisClassRow>>({
  // Mid- or front-mid-engine sports car (911, Corvette, Cayman): low, stiff, near-neutral roll split.
  sports: { cgHeightRatio: 0.37, rideHzFront: 1.9, rideHzRear: 2.1, dampingRatio: 0.45, rollGradient: degPerG(2.6), rollShareOverWeight: 0.04, rollCentreFront: 0.03, rollCentreRear: 0.08, unsprungFront: 80, unsprungRear: 85, yawIndex: 0.92, dragArea: 0.58, liftAreaFront: 0.03, liftAreaRear: 0.03 },
  // Sporty two-door (Mustang, M4): firmer than a sedan, softer than a sports car.
  coupe: { cgHeightRatio: 0.38, rideHzFront: 1.5, rideHzRear: 1.7, dampingRatio: 0.38, rollGradient: degPerG(3.6), rollShareOverWeight: 0.05, rollCentreFront: 0.04, rollCentreRear: 0.10, unsprungFront: 78, unsprungRear: 78, yawIndex: 0.96, dragArea: 0.60, liftAreaFront: 0.07, liftAreaRear: 0.08 },
  // Mid-size sedan (Camry, Accord): comfort springs, a road car's understeering bar split.
  sedan: { cgHeightRatio: 0.385, rideHzFront: 1.2, rideHzRear: 1.35, dampingRatio: 0.30, rollGradient: degPerG(5.0), rollShareOverWeight: 0.07, rollCentreFront: 0.05, rollCentreRear: 0.11, unsprungFront: 75, unsprungRear: 70, yawIndex: 1.00, dragArea: 0.62, liftAreaFront: 0.09, liftAreaRear: 0.10 },
  // Compact hatchback (Golf, Civic): lighter corners, a short tail.
  hatchback: { cgHeightRatio: 0.39, rideHzFront: 1.25, rideHzRear: 1.4, dampingRatio: 0.30, rollGradient: degPerG(5.0), rollShareOverWeight: 0.07, rollCentreFront: 0.05, rollCentreRear: 0.11, unsprungFront: 70, unsprungRear: 62, yawIndex: 0.98, dragArea: 0.64, liftAreaFront: 0.08, liftAreaRear: 0.10 },
  // Estate car: a sedan with a long roof, the mass reaching further back.
  wagon: { cgHeightRatio: 0.39, rideHzFront: 1.2, rideHzRear: 1.35, dampingRatio: 0.30, rollGradient: degPerG(5.0), rollShareOverWeight: 0.07, rollCentreFront: 0.05, rollCentreRear: 0.11, unsprungFront: 78, unsprungRear: 74, yawIndex: 1.02, dragArea: 0.66, liftAreaFront: 0.09, liftAreaRear: 0.09 },
  // Car-based crossover (RAV4, CR-V): taller, more roll, heavier corners.
  suv: { cgHeightRatio: 0.405, rideHzFront: 1.2, rideHzRear: 1.35, dampingRatio: 0.30, rollGradient: degPerG(5.6), rollShareOverWeight: 0.07, rollCentreFront: 0.07, rollCentreRear: 0.14, unsprungFront: 100, unsprungRear: 100, yawIndex: 1.03, dragArea: 0.84, liftAreaFront: 0.10, liftAreaRear: 0.10 },
  // Minivan (Odyssey, Sienna): soft for passengers, long, the mass spread out.
  van: { cgHeightRatio: 0.40, rideHzFront: 1.15, rideHzRear: 1.3, dampingRatio: 0.30, rollGradient: degPerG(5.6), rollShareOverWeight: 0.07, rollCentreFront: 0.06, rollCentreRear: 0.13, unsprungFront: 95, unsprungRear: 95, yawIndex: 1.05, dragArea: 0.95, liftAreaFront: 0.10, liftAreaRear: 0.10 },
  // Body-on-frame pickup: leaf-sprung live rear axle (high roll centre, heavy, stiff to carry a payload).
  pickup: { cgHeightRatio: 0.41, rideHzFront: 1.3, rideHzRear: 1.6, dampingRatio: 0.30, rollGradient: degPerG(5.6), rollShareOverWeight: 0.08, rollCentreFront: 0.08, rollCentreRear: 0.30, unsprungFront: 110, unsprungRear: 150, yawIndex: 1.10, dragArea: 1.15, liftAreaFront: 0.12, liftAreaRear: 0.10 },
  // Off-roader (Wrangler, 4Runner): live axles for articulation, long soft travel, the most roll.
  offroad: { cgHeightRatio: 0.42, rideHzFront: 1.15, rideHzRear: 1.35, dampingRatio: 0.30, rollGradient: degPerG(6.2), rollShareOverWeight: 0.08, rollCentreFront: 0.20, rollCentreRear: 0.30, unsprungFront: 130, unsprungRear: 140, yawIndex: 1.08, dragArea: 1.05, liftAreaFront: 0.12, liftAreaRear: 0.10 },
});

/** A body class's typical size, m: what the resolver uses when the sheet has no wheelbase, tracks or body size. */
export type ClassDimensions = Readonly<{ wheelbase: number; trackFront: number; trackRear: number; length: number; width: number; height: number }>;

/** Typical sizes by class, from the makers' figures for the cars named (rounded toward the middle of the class). */
export const CLASS_DIMENSIONS: Readonly<Record<BodyClass, ClassDimensions>> = deepFreeze<Record<BodyClass, ClassDimensions>>({
  // 911, Cayman, Supra, Corvette C8: wheelbase 2.45 to 2.72.
  sports: { wheelbase: 2.50, trackFront: 1.58, trackRear: 1.58, length: 4.40, width: 1.85, height: 1.28 },
  // Mustang, M4, Camaro: wheelbase 2.72 to 2.86.
  coupe: { wheelbase: 2.75, trackFront: 1.58, trackRear: 1.60, length: 4.75, width: 1.87, height: 1.37 },
  // Camry, Accord, 3 Series, Model 3: wheelbase 2.74 to 2.88.
  sedan: { wheelbase: 2.82, trackFront: 1.58, trackRear: 1.59, length: 4.75, width: 1.84, height: 1.44 },
  // Golf, Civic, Mazda3, Prius: wheelbase 2.63 to 2.74.
  hatchback: { wheelbase: 2.68, trackFront: 1.54, trackRear: 1.55, length: 4.40, width: 1.79, height: 1.45 },
  // V60, Outback, Golf estate: wheelbase 2.63 to 2.87.
  wagon: { wheelbase: 2.75, trackFront: 1.57, trackRear: 1.57, length: 4.75, width: 1.84, height: 1.50 },
  // RAV4, CR-V, Highlander, Model Y: wheelbase 2.69 to 2.89.
  suv: { wheelbase: 2.80, trackFront: 1.62, trackRear: 1.63, length: 4.75, width: 1.90, height: 1.70 },
  // Odyssey, Sienna, Pacifica, Carnival: wheelbase 3.00 to 3.09.
  van: { wheelbase: 3.05, trackFront: 1.73, trackRear: 1.73, length: 5.18, width: 2.00, height: 1.75 },
  // A crew cab between the mid-size (Tacoma 3.23 m) and the full-size (F-150 3.68 m).
  pickup: { wheelbase: 3.55, trackFront: 1.70, trackRear: 1.70, length: 5.70, width: 2.00, height: 1.90 },
  // Wrangler four-door, Bronco, 4Runner: wheelbase 2.79 to 3.01.
  offroad: { wheelbase: 2.90, trackFront: 1.62, trackRear: 1.62, length: 4.80, width: 1.92, height: 1.85 },
});

/** Steering-wheel angle over road-wheel angle (the ratio makers publish, "15.0:1"), by class. */
export const CLASS_STEER_RATIO: Readonly<Record<BodyClass, number>> = deepFreeze<Record<BodyClass, number>>({
  sports: 14.0,     // quick racks: 13 to 15.7
  coupe: 14.5,      // 14 to 16
  sedan: 15.0,      // 14 to 16
  hatchback: 14.5,  // 13.5 to 15.5
  wagon: 15.0,      // 14 to 16
  suv: 15.5,        // 15 to 17
  van: 16.0,        // 15.5 to 17
  pickup: 17.5,     // full-size trucks 17 to 20
  offroad: 16.5,    // 15.5 to 20 (slow racks for rock work)
});

/** Front-wheel steer angle at full lock when the sheet has no turning circle, rad (about 34 degrees). */
export const MAX_STEER_DEFAULT = 0.60;

/** Anti-dive when not on file: share of the braking pitch moment the front links take at once (production cars 0.1 to 0.5). */
export const ANTI_DIVE = 0.25;
/** Anti-squat when not on file: share of the driving pitch moment the rear links take at once (production cars 0.1 to 0.5). */
export const ANTI_SQUAT = 0.30;

/** Radius of gyration of the sprung mass in roll over the body's width, and in pitch over its length. */
export const ROLL_GYRATION_PER_WIDTH = 0.36;
/** Radius of gyration of the sprung mass in pitch over the body's length (see ROLL_GYRATION_PER_WIDTH). */
export const PITCH_GYRATION_PER_LENGTH = 0.26;

/** kg added to curb weight for the driver (DESIGN.md section 7: the car as tested, one person aboard). */
export const DRIVER_MASS = 75;

/* ------------------------------------------------------------------ suspension grade */

/** How a suspension grade moves a class's springs, dampers and roll (DESIGN.md section 7). */
export type SuspensionGradeRow = Readonly<{
  /** Multiplies both ride frequencies. */
  rideScale: number;
  /** Added to the damping ratio. */
  dampingAdd: number;
  /** Multiplies the roll gradient (less is flatter). */
  rollGradientScale: number;
}>;

/** The four suspension grades. */
export const SUSPENSION_GRADE: Readonly<Record<SuspensionGrade, SuspensionGradeRow>> = deepFreeze<Record<SuspensionGrade, SuspensionGradeRow>>({
  standard: { rideScale: 1, dampingAdd: 0, rollGradientScale: 1 },          // the class as it is
  sport: { rideScale: 1.15, dampingAdd: 0.06, rollGradientScale: 0.8 },     // firmer springs, stiffer bars
  adaptive: { rideScale: 1.10, dampingAdd: 0.08, rollGradientScale: 0.75 }, // a sport set-up with dampers that can be firm when cornering
  offroad: { rideScale: 0.92, dampingAdd: 0, rollGradientScale: 1.1 },      // long soft travel and thin bars, for articulation
});

/* ------------------------------------------------------------------ layout: weight, brakes */

/** Front share of the car's weight by layout, when not on file (DESIGN.md section 7). */
export const WEIGHT_FRONT_SHARE = deepFreeze({
  frontFwd: 0.60,   // engine and gearbox over the front wheels: 58 to 64%
  frontRwd: 0.53,   // gearbox moved back under the tunnel: 50 to 55%
  frontAwd: 0.57,   // a transfer case and front differential on top of a front-engine layout
  mid: 0.41,        // engine ahead of the rear axle: 40 to 45%
  rear: 0.39,       // engine behind the rear axle (911): 37 to 40%
  pickup: 0.57,     // an empty bed: 55 to 60% whatever drives
});

/** Front share of the car's weight when not on file. Pass the drivetrain as on file (4WD counts as AWD). */
export function weightFrontShare(location: EngineLocation, drive: Drivetrain, bodyClass: BodyClass): number {
  const w = WEIGHT_FRONT_SHARE;
  if (bodyClass === 'pickup') return w.pickup;
  if (location === 'mid') return w.mid;
  if (location === 'rear') return w.rear;
  return drive === 'FWD' ? w.frontFwd : drive === 'RWD' ? w.frontRwd : w.frontAwd;
}

/**
 * Front share of brake torque at full pedal by layout (DESIGN.md section 7). Each sits between the car's static front
 * weight share and the share a 1.3 g stop would ideally want, so the fronts lock first at moderate braking and the
 * brake-force distribution trims the rear at the limit, as production cars are set up.
 */
export const BRAKE_FRONT_SHARE = deepFreeze({
  frontFwd: 0.70,
  frontRwd: 0.66,
  frontAwd: 0.68,   // not in DESIGN.md: between front- and rear-drive, as its weight split is
  midOrRear: 0.60,
});

/** Front share of brake torque when the sheet does not set it. Pass the drivetrain as on file (4WD counts as AWD). */
export function brakeFrontShare(location: EngineLocation, drive: Drivetrain): number {
  const b = BRAKE_FRONT_SHARE;
  if (location !== 'front') return b.midOrRear;
  return drive === 'FWD' ? b.frontFwd : drive === 'RWD' ? b.frontRwd : b.frontAwd;
}

/**
 * Brakes are sized so full pedal is worth at least this many g on the car's own tyres, and more where the axles need
 * it (BRAKE_AXLE_MARGIN): 1.3 g locks any all-season, all-terrain or winter tyre outright.
 */
export const BRAKE_SIZING_G = 1.3;
/**
 * Each axle's brakes can give this many times the force its tyres brake with at their peak in the ideal stop on the
 * stickiest tyres of the car's category (wheel inertia included). ABS has to be able to drive the slip past 1.15 times
 * the peak to find it (brakes.ts ABS_CUT_SLIP); a brake that only just reaches the peak leaves the stop to the calipers.
 */
export const BRAKE_AXLE_MARGIN = 1.15;
/**
 * How far a setup may move the brakes' front share either side of the class's (DESIGN.md 11: the bias slider moves it
 * by 0.06 a step). The sizing covers the whole range, so that a setup's bias never leaves an axle short.
 */
export const BRAKE_BIAS_RANGE = 0.06;
/**
 * Handbrake torque at one rear wheel, N m: enough to lock a statically loaded rear wheel of a 1,600 kg car on summer
 * tyres (about 1,300 N m), as a pulled lever does at low speed. Not in DESIGN.md.
 */
export const HANDBRAKE_TORQUE = 1500;
/** Model year from which ABS, traction and stability control are taken as fitted (US FMVSS 126 required stability control from 2012). */
export const SYSTEMS_STANDARD_FROM = 2012;

/* ------------------------------------------------------------------ transmissions and gearing */

/** What a transmission type gives the driveline, and the usual shape of its gear set. */
export type TransmissionRow = Readonly<{
  /** Share of crank torque reaching the wheels with two-wheel drive. */
  efficiency: number;
  /** Seconds from a shift request to full drive in the next gear. */
  shiftTime: number;
  /** Share of drive torque kept through a shift. */
  shiftTorqueHold: number;
  launch: DrivelineModel['launch'];
  converter: Readonly<NonNullable<DrivelineModel['converter']>> | null;
  /** How fast a CVT can move its ratio, ratio units per second (0 for a stepped box). */
  cvtRatioRate: number;
  /** Forward gears a box of this type usually has (cvt and ecvt: the two ends of the range). */
  gearCount: number;
  /** First (or lowest) ratio over top (or highest) ratio. */
  spread: number;
  /** Where the top (or highest) ratio usually sits. */
  topMin: number; topMax: number;
  /** Reverse ratio over first gear. */
  reverseOverFirst: number;
}>;

/**
 * DESIGN.md section 7's transmission table, with the usual gear sets. Ratio spreads from makers' published ratios:
 * six-speed manuals 3.9 (S2000) to 5.6 (Mustang MT82); seven-speed dual-clutch 5.9 to 6.3 (PDK 6.3); eight-speed
 * automatics 6.7 to 7.6 (ZF 8HP 7.07, GM 8L90 7.0); belt CVTs 6.2 to 7.3. Gears are spaced geometrically from first
 * to top (gearRatioAt).
 */
export const TRANSMISSION: Readonly<Record<TransmissionType, TransmissionRow>> = deepFreeze<Record<TransmissionType, TransmissionRow>>({
  // Driver-operated clutch: drive is cut for the whole shift. Spread 4.2, at the low end of real six-speeds (estimates lean unfavourable).
  manual: { efficiency: 0.92, shiftTime: 0.30, shiftTorqueHold: 0, launch: 'clutch', converter: null, cvtRatioRate: 0, gearCount: 6, spread: 4.2, topMin: 0.67, topMax: 0.80, reverseOverFirst: 0.95 },
  // Two clutches hand drive over in about 80 ms with almost no gap.
  'dual-clutch': { efficiency: 0.92, shiftTime: 0.08, shiftTorqueHold: 0.9, launch: 'clutch', converter: null, cvtRatioRate: 0, gearCount: 7, spread: 6.0, topMin: 0.67, topMax: 0.80, reverseOverFirst: 0.90 },
  // Planetary automatic behind a torque converter (stall 2,000 to 2,600 rpm, multiplication 1.7 to 2.2 in road cars).
  automatic: {
    efficiency: 0.90, shiftTime: 0.25, shiftTorqueHold: 0.6, launch: 'converter',
    converter: { stallOmega: 2300 * RPM, torqueRatio: 1.9, couplingRatio: 0.88, lockGear: 2 },
    cvtRatioRate: 0, gearCount: 8, spread: 7.0, topMin: 0.67, topMax: 0.80, reverseOverFirst: 0.80,
  },
  // Belt or chain CVT behind a converter that locks as soon as the ratio starts to move. The highest ratio of a real
  // CVT is 0.38 to 0.56 behind a final drive of 4.5 to 5.7; the range reaches 0.80 so a class final drive can carry it.
  cvt: {
    efficiency: 0.87, shiftTime: 0, shiftTorqueHold: 1, launch: 'converter',
    converter: { stallOmega: 2100 * RPM, torqueRatio: 1.9, couplingRatio: 0.88, lockGear: 1 },
    cvtRatioRate: 1.5, gearCount: 2, spread: 6.5, topMin: 0.40, topMax: 0.80, reverseOverFirst: 0.90,
  },
  // Power-split hybrid: the motors set the ratio electrically, quickly, and the car moves off on its motor.
  ecvt: { efficiency: 0.90, shiftTime: 0, shiftTorqueHold: 1, launch: 'direct', converter: null, cvtRatioRate: 3.0, gearCount: 2, spread: 6.5, topMin: 0.40, topMax: 0.80, reverseOverFirst: 1 },
  // Electric car's fixed reduction: one gear, carried as 1 with the whole reduction in the final drive.
  'single-speed': { efficiency: 0.94, shiftTime: 0, shiftTorqueHold: 1, launch: 'direct', converter: null, cvtRatioRate: 0, gearCount: 1, spread: 1, topMin: 1, topMax: 1, reverseOverFirst: 1 },
});

/** Efficiency lost to a transfer case, prop shaft and second differential with all- or four-wheel drive. */
export const AWD_EFFICIENCY_PENALTY = 0.04;

/** Driveline efficiency of a transmission type with this drivetrain. */
export function drivelineEfficiency(type: TransmissionType, drive: Drivetrain): number {
  const e = TRANSMISSION[type].efficiency;
  return drive === 'AWD' || drive === '4WD' ? e - AWD_EFFICIENCY_PENALTY : e;
}

/** Clutch (or lock-up clutch) capacity over the engine's peak torque: enough margin that a stock clutch never slips once closed. */
export const CLUTCH_CAPACITY_RATIO = 1.6;

/** Ratio of gear `gear` (1 is first) in a set of `count` spaced geometrically from top x spread down to top. */
export function gearRatioAt(gear: number, count: number, top: number, spread: number): number {
  if (count <= 1) return top;
  return top * dpow(spread, (count - gear) / (count - 1));
}

/** Final drive ratio by class when not on file, for a stepped box whose top gear sits in its usual range. */
export const CLASS_FINAL_DRIVE: Readonly<Record<BodyClass, number>> = deepFreeze<Record<BodyClass, number>>({
  sports: 3.50,     // 3.15 (Supra) to 3.73 (Camaro SS); a mid-engine transaxle's sits in the same overall range
  coupe: 3.40,      // 3.15 to 3.73
  sedan: 3.60,      // 2.8 behind tall-first eight-speeds to 4.35 behind manuals
  hatchback: 3.80,  // 3.4 to 4.4: small engines are geared short
  wagon: 3.60,      // as a sedan
  suv: 3.70,        // 3.3 to 4.1
  van: 3.80,        // 3.3 to 4.1
  pickup: 3.73,     // 3.15 to 4.30; the common towing axle, short enough for 0.40 m tyres
  offroad: 4.10,    // 3.73 to 4.88: short for crawling on big tyres
});

/** A single-speed car's whole reduction, motor to wheel (Leaf 8.19, Model 3 9.03, Mach-E 9.05; range 7 to 10.7). */
export const SINGLE_SPEED_FINAL_DRIVE = 9.0;

/* ------------------------------------------------------------------ top speed governors */

/**
 * The electronic speed limit usual for each class, m/s: the same figures the card engine uses for
 * SPEED.estimate.limiter in packages/engine/src/rules.ts (copied in mph, so the two estimates agree; keep them in
 * step). Sports cars' 400 mph is rules.ts's way of saying "no governor": no car reaches it.
 */
export const CLASS_LIMITER: Readonly<Record<BodyClass, number>> = deepFreeze<Record<BodyClass, number>>({
  sports: 400 * MPH, coupe: 155 * MPH, sedan: 130 * MPH, hatchback: 125 * MPH, wagon: 130 * MPH,
  suv: 125 * MPH, offroad: 110 * MPH, pickup: 110 * MPH, van: 115 * MPH,
});

/** Where the limit ends up on a class's quickest models, m/s: rules.ts's SPEED.estimate.performanceLimiter, copied likewise. */
export const CLASS_LIMITER_PERFORMANCE: Readonly<Record<BodyClass, number>> = deepFreeze<Record<BodyClass, number>>({
  sports: 400 * MPH, coupe: 155 * MPH, sedan: 155 * MPH, hatchback: 155 * MPH, wagon: 155 * MPH,
  suv: 155 * MPH, offroad: 112 * MPH, pickup: 118 * MPH, van: 120 * MPH,
});

/**
 * Between these two power-to-weight figures (W per kg of curb weight) the limit climbs in a straight line from the
 * class's own to its performance figure: rules.ts's SPEED.estimate.performanceBand, 0.075 and 0.115 hp per lb.
 */
export const LIMITER_RAISE_BAND = deepFreeze({ from: 0.075 * HP / LB, to: 0.115 * HP / LB });

/* ------------------------------------------------------------------ default tyres by class */

/** A class's usual tyre when the sheet has none: category and sizes as printed on the sidewall. */
export type ClassTyres = Readonly<{ category: TyreCategory; front: string; rear: string }>;

/** Default tyres by class. Sizes are common factory fitments; front and rear roll within 1% of each other. */
export const CLASS_TYRES: Readonly<Record<BodyClass, ClassTyres>> = deepFreeze<Record<BodyClass, ClassTyres>>({
  sports: { category: 'max-performance', front: '245/35R19', rear: '285/30R19' },  // staggered for a driven, heavier rear
  coupe: { category: 'summer', front: '245/40R18', rear: '245/40R18' },
  sedan: { category: 'all-season', front: '225/50R17', rear: '225/50R17' },
  hatchback: { category: 'all-season', front: '205/55R16', rear: '205/55R16' },
  wagon: { category: 'all-season', front: '225/55R17', rear: '225/55R17' },
  suv: { category: 'all-season', front: '235/60R18', rear: '235/60R18' },
  van: { category: 'all-season', front: '235/60R18', rear: '235/60R18' },
  pickup: { category: 'all-terrain', front: '275/65R18', rear: '275/65R18' },
  offroad: { category: 'all-terrain', front: '265/70R17', rear: '265/70R17' },
});

/* ------------------------------------------------------------------ wheels */

/** mWheel = base + perWidth x width (m) x rim inches / rimRef: a wheel and tyre, kg. */
export const WHEEL_MASS = deepFreeze({ base: 8, perWidth: 55, rimRef: 17 });
/** J = shape x mWheel x radius^2 + hub: most of the mass sits near the rim and tread; hub is the disc, hub and half-shaft, kg m^2. */
export const WHEEL_INERTIA = deepFreeze({ shape: 0.8, hub: 0.1 });

/** Mass of one wheel with its tyre, kg, from the section width (m) and the rim diameter (inches). */
export function wheelMass(width: number, rimIn: number): number {
  return WHEEL_MASS.base + WHEEL_MASS.perWidth * width * (rimIn / WHEEL_MASS.rimRef);
}
/** Spin inertia of one wheel with its tyre, disc and share of half-shaft, kg m^2, from its mass (kg) and rolling radius (m). */
export function wheelInertia(mass: number, radius: number): number {
  return WHEEL_INERTIA.shape * mass * radius * radius + WHEEL_INERTIA.hub;
}

/* ------------------------------------------------------------------ engines */

/** Idle speed when not on file, rad/s: 750 rpm, or 650 for eight cylinders or more (more firing strokes per turn run smoothly lower). */
export const IDLE = deepFreeze({ standard: 750 * RPM, eightPlus: 650 * RPM });

/** Idle speed when not on file, rad/s. Pass 0 cylinders when the count is not on file either. */
export function defaultIdle(cylinders: number): number {
  return cylinders >= 8 ? IDLE.eightPlus : IDLE.standard;
}

/** Redline when not on file, rad/s (DESIGN.md section 7; electric added). */
export const REDLINE = deepFreeze({
  standard: 6500 * RPM,        // a modern petrol four or six: 6,000 to 7,000
  eightPlus: 6200 * RPM,       // a pushrod or large V8: 5,800 to 6,600
  boostedFourTruck: 6000 * RPM, // a turbo four in a pickup or off-roader, tuned for low-speed torque
  diesel: 5500 * RPM,          // DESIGN.md's figure; passenger diesels cut at 4,500 to 5,200, truck diesels lower
  electric: 14000 * RPM,       // motor top speed: Bolt 8,810 to Model 3 18,000; not in DESIGN.md
});

/** Redline when not on file, rad/s. "Boosted" is any turbo or supercharger; pass 0 cylinders when not on file. */
export function defaultRedline(powertrain: Powertrain, cylinders: number, boosted: boolean, bodyClass: BodyClass): number {
  if (powertrain === 'electric') return REDLINE.electric;
  if (powertrain === 'diesel') return REDLINE.diesel;
  if (cylinders >= 8) return REDLINE.eightPlus;
  if (boosted && cylinders > 0 && cylinders <= 4 && (bodyClass === 'pickup' || bodyClass === 'offroad')) return REDLINE.boostedFourTruck;
  return REDLINE.standard;
}

/** The speeds of the published peaks as shares of redline, when a sheet gives a peak's value but not its speed. */
export type PeakSpeedShares = Readonly<{ power: number; torqueLow: number; torqueHigh: number }>;

/** DESIGN.md section 7: an unboosted engine peaks in torque at about two thirds of redline; a boosted one holds a plateau from low down. */
export const PEAK_SPEED_SHARE: Readonly<{ unboosted: PeakSpeedShares; boosted: PeakSpeedShares }> = deepFreeze({
  unboosted: { power: 0.92, torqueLow: 0.68, torqueHigh: 0.68 },  // 6,500 rpm redline: torque at 4,420, power at 5,980
  boosted: { power: 0.85, torqueLow: 0.30, torqueHigh: 0.65 },    // 6,500 rpm: plateau 1,950 to 4,225 (a 2.0 T's is 1,500 to 4,500), power at 5,525
});

/** The peak speed shares for an unboosted or a boosted engine. */
export function peakSpeedShares(boosted: boolean): PeakSpeedShares {
  return boosted ? PEAK_SPEED_SHARE.boosted : PEAK_SPEED_SHARE.unboosted;
}

/**
 * Friction mean effective pressure, Pa = c0 + c1 x + c2 x^2 with x in thousands of rpm (EngineAir.fmep).
 * Petrol: the fit Heywood gives for 0.85 to 2.0 litre spark-ignition engines at full throttle (DESIGN.md's start).
 * Diesel: Millington and Hartles' correlation for automotive diesels, 7 (rc - 4) + 48 x + 0.4 Sp^2 kPa (Sp the mean
 * piston speed, m/s), at a compression ratio of 16 and a 90 mm stroke (Sp = 3 x): higher everywhere, from heavier
 * pistons, stiffer rings and higher cylinder pressure.
 */
export const FMEP: Readonly<{ petrol: readonly [number, number, number]; diesel: readonly [number, number, number] }> = deepFreeze({
  petrol: [97e3, 15e3, 5e3] as const,
  diesel: [84e3, 48e3, 3.6e3] as const,
});

/** The friction coefficients for a powertrain: a hybrid's engine is a petrol engine. (An electric motor has no air model and never asks.) */
export function fmepFor(powertrain: Powertrain): readonly [number, number, number] {
  return powertrain === 'diesel' ? FMEP.diesel : FMEP.petrol;
}

/** Compressor isentropic efficiency of a stock turbo or supercharger (maps peak at 0.70 to 0.78; 0.70 is what the engine sees on average). */
export const COMPRESSOR_EFFICIENCY = 0.70;

/** What a stock boosted engine breathes through, by kind. */
export type ChargeAirRow = Readonly<{
  /** Charge cooler effectiveness, 0 (none) to 1. */
  intercooler: number;
  /** Share of indicated torque taken to drive the compressor at full boost (a turbo is driven by exhaust: 0). */
  blowerDrive: number;
  /** Gauge boost at full boost when not on file, Pa. Not in DESIGN.md. */
  boostPa: number;
}>;

/** Stock charge air by kind (a twincharged engine is taken as turbocharged). */
export const CHARGE_AIR: Readonly<Record<'turbo' | 'supercharged', ChargeAirRow>> = deepFreeze<Record<'turbo' | 'supercharged', ChargeAirRow>>({
  // Air-to-air intercooler (0.65 to 0.80). 1.0 bar: a modern 1.5 to 2.0 litre turbo makes 0.9 to 1.5 bar.
  turbo: { intercooler: 0.70, blowerDrive: 0, boostPa: 100e3 },
  // A blower's cooler is packed into the engine's valley, smaller (0.5 to 0.7). 0.7 bar: stock blowers make 0.5 to 0.85 bar.
  supercharged: { intercooler: 0.60, blowerDrive: 0.12, boostPa: 70e3 },
});

/** The highest manifold pressure ratio pump fuel allows before timing has to come out (race fuel or E85: 3.3). */
export const KNOCK_LIMIT_PR = 2.6;

/** Engine and flywheel inertia: base + perLitre x litres, kg m^2 (an electric motor's rotor: electric). */
export const ENGINE_INERTIA = deepFreeze({ base: 0.08, perLitre: 0.04, electric: 0.05 });

/** Inertia of the engine with its flywheel and clutch, or of an electric motor's rotor, kg m^2. */
export function engineInertia(litres: number, electric: boolean): number {
  return electric ? ENGINE_INERTIA.electric : ENGINE_INERTIA.base + ENGINE_INERTIA.perLitre * litres;
}

/* ------------------------------------------------------------------ differentials and all-wheel drive */

/**
 * Differentials by kind when only the kind is on file. A stock limited-slip is taken as the street part (lsd-1 in
 * DESIGN.md section 11); an active differential as the race part, since it can lock fully when it wants to.
 */
export const DIFF_DEFAULT: Readonly<Record<DiffKind, Readonly<DiffModel>>> = deepFreeze<Record<DiffKind, DiffModel>>({
  open: { kind: 'open', preload: 0, lockPerTorque: 0 },
  'limited-slip': { kind: 'limited-slip', preload: 60, lockPerTorque: 0.25 },   // torque bias ratio 1.67
  locked: { kind: 'locked', preload: Infinity, lockPerTorque: 0 },
  active: { kind: 'active', preload: 150, lockPerTorque: 0.5 },                 // torque bias ratio 3
});

/**
 * The centre of an all- or four-wheel-drive car by kind. frontShare is the front's share of drive at rest; a
 * coupling's lockTorque is the most torque, N m at the axles, it moves to the other axle when the axles' speeds differ.
 */
export const AWD_CENTRE: Readonly<Record<AwdKind, Readonly<DrivelineModel['centre']>>> = deepFreeze<Record<AwdKind, DrivelineModel['centre']>>({
  // A centre differential with a set split: published 30:70 to 50:50; 40:60 is the common rear-biased figure.
  fixed: { kind: 'fixed', frontShare: 0.40, lockTorque: 0 },
  // Front-driven, a multi-plate coupling feeds the rear: about half a 2.0 litre turbo's first-gear axle torque.
  'front-on-demand': { kind: 'coupling', frontShare: 1, lockTorque: 2000 },
  // Rear-driven, a coupling feeds the front (xDrive, ATTESA).
  'rear-on-demand': { kind: 'coupling', frontShare: 0, lockTorque: 2000 },
  // Part-time four-wheel drive engaged: front and rear locked together.
  'part-time': { kind: 'coupling', frontShare: 0, lockTorque: Infinity },
});
