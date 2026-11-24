// Figures in, SI out (DESIGN.md section 7). This is the one place a published unit becomes SI and a blank becomes a
// class estimate. resolveModel(sheet, build?) returns the model and, for every one of its parameters, how it was
// reached (types.Basis): sourced (a published figure, converted), derived (worked out from figures by a stated
// formula), calibrated (fitted to a test: tyre grip, drag area) or estimated (a class table's typical value).
//
// The work is split into small exported steps, each filling one piece of the model and writing the basis of what it
// filled, so that parts.ts can resolve the stock pieces, change them part by part and re-derive what depends on what
// changed. Every "typical" figure comes from classes.ts. The few this file needs that classes.ts does not yet hold
// (a blank sheet's engine and weight, mean effective pressures, a truck's converter) are named constants just below,
// each with its reason, ready to move there.
//
// Nothing here runs inside the step, so it may allocate. It still keeps to rule 3's arithmetic (math.ts for anything
// transcendental), so a sheet resolves to the same bits on every machine.
import type {
  AeroModel, Basis, BodyClass, BrakeModel, Build, ChassisModel, DiffKind, DiffModel, Drivetrain, DrivelineModel,
  EngineKind, EngineLocation, EngineModel, Induction, PhysicsSheet, Powertrain, Setup, Sourced, SystemsModel,
  TransmissionType, TyreCategory, TyreParams, VehicleModel,
} from './types';
import type { EngineSpec } from './engine';
import type { TyreSize } from './units';
import { buildEngine, enginePeaks, rebuildTables } from './engine';
import { tyreMuX } from './tyre';
import { G, PI, RHO_AIR, datan } from './math';
import { FT, HP, IN, LB, LBF, LBFT, MPH, PSI, RPM, SQFT, parseTyreSize } from './units';
import {
  ANTI_DIVE, ANTI_SQUAT, AWD_CENTRE, BRAKE_AXLE_MARGIN, BRAKE_BIAS_RANGE, BRAKE_SIZING_G, CHARGE_AIR, CHASSIS_CLASS, CLASS_DIMENSIONS, CLASS_FINAL_DRIVE,
  CLASS_LIMITER, CLASS_LIMITER_PERFORMANCE, CLASS_STEER_RATIO, CLASS_TYRES, CLUTCH_CAPACITY_RATIO, DIFF_DEFAULT,
  DRIVER_MASS, FMEP, FZ_STIFF_PEAK_RATIO, HANDBRAKE_TORQUE, LIMITER_RAISE_BAND, LOADED_RADIUS_RATIO, MAX_STEER_DEFAULT,
  PITCH_GYRATION_PER_LENGTH, REDLINE, ROLL_GYRATION_PER_WIDTH, SINGLE_SPEED_FINAL_DRIVE, SUSPENSION_GRADE,
  SYSTEMS_STANDARD_FROM, TRAIL0, TRANSMISSION, TYRE_CATEGORY, brakeFrontShare, defaultIdle, defaultRedline,
  drivelineEfficiency, engineInertia, gearRatioAt, peakSpeedShares, tyreGripScaleRange, tyreReferenceLoad,
  weightFrontShare, wheelInertia, wheelMass,
} from './classes';

/* ------------------------------------------------------------------ typical figures classes.ts does not hold yet */

/** What a body class stands for when the sheet leaves the car's weight, engine, drive or gearbox blank. */
export type ClassBlank = Readonly<{
  /** Curb weight, kg. */
  curbKg: number;
  /** Peak power, hp, and the engine that makes it. */
  hp: number; litres: number; cylinders: number; induction: Induction;
  drive: Drivetrain;
  transmission: TransmissionType;
}>;

/**
 * A typical configuration of each class, for a sheet that leaves it blank (DESIGN.md's class tables have no curb
 * weight, engine or gearbox). Each row is a common US configuration of the cars classes.ts names for the class, a
 * little heavy and a little slow, since estimates lean unfavourable. Their torque comes out of TORQUE_BMEP within a
 * few percent of the real engine's (a 2.5 L four's 249 N m, a 5.3 L V8's 519 N m).
 */
export const CLASS_BLANK: Readonly<Record<BodyClass, ClassBlank>> = Object.freeze({
  sports: Object.freeze({ curbKg: 1500, hp: 330, litres: 3.0, cylinders: 6, induction: 'turbo', drive: 'RWD', transmission: 'dual-clutch' }) as ClassBlank,
  coupe: Object.freeze({ curbKg: 1650, hp: 300, litres: 2.3, cylinders: 4, induction: 'turbo', drive: 'RWD', transmission: 'automatic' }) as ClassBlank,
  sedan: Object.freeze({ curbKg: 1550, hp: 200, litres: 2.5, cylinders: 4, induction: 'natural', drive: 'FWD', transmission: 'automatic' }) as ClassBlank,
  hatchback: Object.freeze({ curbKg: 1350, hp: 155, litres: 2.0, cylinders: 4, induction: 'natural', drive: 'FWD', transmission: 'automatic' }) as ClassBlank,
  wagon: Object.freeze({ curbKg: 1650, hp: 180, litres: 2.5, cylinders: 4, induction: 'natural', drive: 'FWD', transmission: 'automatic' }) as ClassBlank,
  suv: Object.freeze({ curbKg: 1700, hp: 200, litres: 2.5, cylinders: 4, induction: 'natural', drive: 'FWD', transmission: 'automatic' }) as ClassBlank,
  van: Object.freeze({ curbKg: 2050, hp: 280, litres: 3.5, cylinders: 6, induction: 'natural', drive: 'FWD', transmission: 'automatic' }) as ClassBlank,
  pickup: Object.freeze({ curbKg: 2300, hp: 355, litres: 5.3, cylinders: 8, induction: 'natural', drive: 'RWD', transmission: 'automatic' }) as ClassBlank,
  offroad: Object.freeze({ curbKg: 2050, hp: 285, litres: 3.6, cylinders: 6, induction: 'natural', drive: '4WD', transmission: 'automatic' }) as ClassBlank,
});

/**
 * Brake mean effective pressure at the torque peak, Pa, for a peak torque not on file: torque = bmep x displacement
 * / (4 pi). Measured on current engines: unboosted petrol 1.17 to 1.41 MPa (Civic 2.0, Camry 2.5, Corvette 6.2),
 * turbo petrol 2.0 to 2.6 (Civic 1.5T, GTI, EcoBoost), supercharged V8s 1.6 to 2.05, turbo diesels 2.0 to 2.8. Each
 * figure sits low in its range.
 */
export const TORQUE_BMEP = Object.freeze({ natural: 1.22e6, turbo: 2.0e6, supercharged: 1.75e6, diesel: 2.2e6 });

/**
 * Above this specific output an engine whose induction is not on file is taken as boosted, hp per litre: unboosted
 * road engines make 60 to 96 (a Mustang GT's 5.0 makes 96), turbo petrol engines 100 to 130.
 */
export const BOOSTED_ABOVE_HP_PER_LITRE = 100;

/** Specific output, hp per litre, that gives an engine's power when only its displacement is on file. */
export const HP_PER_LITRE = Object.freeze({ unboosted: 72, boosted: 110 });

/** An electric motor's top speed over its base speed (where torque gives way to power): 2.2 (Bolt) to 3.2 (Leaf). */
export const EV_SPEED_RANGE = 3;

/**
 * A torque converter behind a pickup's or an off-roader's automatic: tighter than a car's (stall about 2,000 rpm, to
 * tow without heat), and multiplying more at stall, as heavy-duty converters do.
 */
export const TRUCK_CONVERTER = Object.freeze({ stallOmega: 2000 * RPM, torqueRatio: 2.0 });

/** Frontal area over body width times height: the body is not a rectangle (0.81 to 0.85 for cars and trucks). */
export const FRONTAL_AREA_SHARE = 0.84;

/** An estimated redline sits at least this far above a published power-peak speed (makers' peaks sit 3 to 8% under it). */
const REDLINE_OVER_POWER = 1.05;
/** A published torque peak sits at most at this share of an estimated redline. */
const TORQUE_PEAK_MAX_SHARE = 0.8;
/** An estimated peak torque is kept at least this far above the torque at the power peak, so the power peak stands. */
const TORQUE_OVER_POWER_PEAK = 1.04;
/** ... and so low that power on the torque plateau stays this far under peak power (engine.ts makes the same cut). */
const PLATEAU_POWER_SHARE = 0.97;
/** A top gear never turns the engine past this share of redline at the car's top or governed speed. */
const TOP_GEAR_REDLINE_SHARE = 0.95;
/** An electric car's single reduction turns its motor at no more than this share of top speed at the car's top speed: below the taper. */
const EV_TOP_SHARE = 0.88;
/** The limits a front wheel's full lock is kept within, rad (20 to 46 degrees): a turning circle outside them is a misprint. */
const MIN_STEER = 0.35, MAX_STEER = 0.8;
/** Body roll centre heights far above the sprung centre of gravity leave the bars nothing to do; this is the least lever kept, m. */
const MIN_ROLL_ARM = 0.05;

/* ------------------------------------------------------------------ basis */

const RANK: Readonly<Record<Basis, number>> = Object.freeze({ estimated: 0, calibrated: 1, derived: 2, sourced: 3 });

/** The weaker of two bases: a figure is only as good as the weakest thing it rests on. */
export function weakerBasis(a: Basis, b: Basis): Basis {
  return RANK[a] <= RANK[b] ? a : b;
}

/** The basis of a figure worked out by a stated formula from figures of these bases: sourced inputs make it derived. */
export function derivedBasis(...inputs: Basis[]): Basis {
  let w: Basis = 'sourced';
  for (let i = 0; i < inputs.length; i++) w = weakerBasis(w, inputs[i]);
  return w === 'sourced' ? 'derived' : w;
}

/* ------------------------------------------------------------------ reading the sheet */

// A figure on file that is a finite number, or null. A sheet builder never stores anything else, but a hand-made sheet might.
function num(f: Sourced<number> | null): number | null {
  if (f === null) return null;
  const v = f.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function pos(f: Sourced<number> | null): number | null {
  const v = num(f);
  return v !== null && v > 0 ? v : null;
}
function onFile(f: Sourced<unknown> | null): Basis { return f === null ? 'estimated' : 'sourced'; }

/* ------------------------------------------------------------------ the car's layout */

/** What the rest of the resolver reads about the car's make-up: each choice with how it was reached. */
export type SheetLayout = {
  bodyClass: BodyClass;
  year: number;
  powertrain: Powertrain;
  induction: Induction;
  location: EngineLocation;
  /** The drive as on file (4WD kept apart from AWD: it decides a part-time centre). */
  drive: Drivetrain;
  /** The driveline's layout: 4WD drives all four wheels, so it is AWD here. */
  layout: DrivelineModel['layout'];
  transmission: TransmissionType;
  basisOf: { powertrain: Basis; induction: Basis; location: Basis; drive: Basis; transmission: Basis };
};

/**
 * Reads the car's make-up from the sheet, filling blanks: petrol unless the sheet says otherwise; the induction on
 * file, else natural for a hybrid's or a battery car's engine, turbo for a diesel, and for a petrol engine boosted
 * when its power per litre says so; a front engine; the class's drive (rear drive behind a mid or rear engine); the
 * gearbox on file, else single-speed for an electric car, an eCVT for a hybrid, and the class's for the rest. An
 * electric car is always single-speed: the core models one reduction.
 */
export function resolveLayout(sheet: PhysicsSheet): SheetLayout {
  const bodyClass = sheet.identity.bodyClass;
  const blank = CLASS_BLANK[bodyClass];
  const powertrain: Powertrain = sheet.powertrain !== null ? sheet.powertrain.value : 'gasoline';
  const ptBasis = onFile(sheet.powertrain);

  let induction: Induction = blank.induction, inductionBasis: Basis = 'estimated';
  if (sheet.induction !== null) { induction = sheet.induction.value; inductionBasis = 'sourced'; }
  else if (powertrain === 'electric' || powertrain === 'hybrid' || powertrain === 'plug-in-hybrid') induction = 'natural';
  else if (powertrain === 'diesel') induction = 'turbo';   // every current road diesel is turbocharged
  else if (sheet.torqueCurve !== null) induction = 'natural';   // a drawn curve is the whole engine: nothing to boost
  else {
    const hp = pos(sheet.horsepower), litres = pos(sheet.displacementL);
    if (hp !== null && litres !== null) induction = hp / litres > BOOSTED_ABOVE_HP_PER_LITRE ? 'turbo' : 'natural';
    else if (hp !== null || litres !== null) induction = 'natural';   // the class's own engine is no guide to this one
  }

  const location: EngineLocation = sheet.engineLocation !== null ? sheet.engineLocation.value : 'front';
  let drive: Drivetrain = blank.drive;
  if (sheet.drivetrain !== null) drive = sheet.drivetrain.value;
  else if (location !== 'front') drive = 'RWD';
  const layout: DrivelineModel['layout'] = drive === 'FWD' ? 'FWD' : drive === 'RWD' ? 'RWD' : 'AWD';

  let transmission: TransmissionType = blank.transmission, tBasis: Basis = 'estimated';
  if (powertrain === 'electric') {
    transmission = 'single-speed';
    tBasis = sheet.transmissionType !== null && sheet.transmissionType.value === 'single-speed' ? 'sourced' : derivedBasis(ptBasis);
  } else if (sheet.transmissionType !== null) {
    transmission = sheet.transmissionType.value; tBasis = 'sourced';
  } else if (powertrain === 'hybrid' || powertrain === 'plug-in-hybrid') {
    transmission = 'ecvt';
  }

  return {
    bodyClass, year: sheet.identity.year, powertrain, induction, location, drive, layout, transmission,
    basisOf: { powertrain: ptBasis, induction: inductionBasis, location: onFile(sheet.engineLocation), drive: onFile(sheet.drivetrain), transmission: tBasis },
  };
}

/* ------------------------------------------------------------------ tyres */

/** Both axles' tyres and wheels, with the category and grip scale they were built from. */
export type ResolvedTyres = {
  front: TyreParams; rear: TyreParams;
  wheelInertiaFront: number; wheelInertiaRear: number;
  category: TyreCategory;
  /** The grip scale in use: the calibration's, held to the category's range, or 1. */
  gripScale: number;
};

/** The coast-down on file, SI: road load A (N), B (N per m/s), C (N per (m/s)^2). Null without a C; A and B are 0 when missing. */
export function coastDown(sheet: PhysicsSheet): { a: number; b: number; c: number; hasA: boolean } | null {
  const c = pos(sheet.roadLoadC);
  if (c === null) return null;
  const a = num(sheet.roadLoadA), b = num(sheet.roadLoadB);
  // EPA target coefficients: lbf, lbf per mph, lbf per mph^2.
  return { a: a !== null && a > 0 ? a * LBF : 0, b: b !== null ? b * LBF / MPH : 0, c: c * LBF / (MPH * MPH), hasA: a !== null && a > 0 };
}

function readSize(f: Sourced<string> | null): TyreSize | null {
  if (f === null || typeof f.value !== 'string') return null;
  const size = parseTyreSize(f.value);
  return size !== null && size.width > 0 && size.radius > 0 && size.rimIn > 0 ? size : null;
}

function tyreParams(size: TyreSize, category: TyreCategory, gripScale: number, rollingOnFile: boolean): TyreParams {
  const t = TYRE_CATEGORY[category];
  const fz0 = tyreReferenceLoad(size.width, 2 * size.radius);
  return {
    radius: LOADED_RADIUS_RATIO * size.radius, width: size.width, fz0,
    muY0: t.muY0 * gripScale, muXRatio: t.muXRatio, loadSens: t.loadSens, slideRatio: t.slideRatio, slideFall: t.slideFall,
    cAlpha0: t.cAlphaPerFz * fz0, fzStiffPeak: FZ_STIFF_PEAK_RATIO * fz0, cKappaPerFz: t.cKappaPerFz,
    relaxLat: t.relaxLat, relaxLong: t.relaxLong,
    // A coast-down's A already holds the tyres' rolling loss; counting it twice would slow the car twice.
    rollRes: rollingOnFile ? 0 : t.rollRes,
    trail0: TRAIL0,
  };
}

/**
 * The tyres and wheels: each axle's size as printed (one axle's size stands for the other when only one is on file;
 * the class's sizes when neither is), loaded radius 0.97 of the free one; the category on file, else the class's,
 * for everything else; muY0 the category's times the calibrated grip scale, held to the category's range. With a
 * coast-down's A on file the rolling resistance is in it, so the tyres' is 0.
 */
export function resolveTyres(sheet: PhysicsSheet, layout: SheetLayout, basis: Record<string, Basis>): ResolvedTyres {
  const cls = CLASS_TYRES[layout.bodyClass];
  const onFront = readSize(sheet.tyreFront), onRear = readSize(sheet.tyreRear);
  const classFront = parseTyreSize(cls.front) as TyreSize, classRear = parseTyreSize(cls.rear) as TyreSize;
  const front = onFront !== null ? onFront : onRear !== null ? onRear : classFront;
  const rear = onRear !== null ? onRear : onFront !== null ? onFront : classRear;
  const frontBasis: Basis = onFront !== null ? 'sourced' : 'estimated';
  const rearBasis: Basis = onRear !== null ? 'sourced' : 'estimated';

  const category: TyreCategory = sheet.tyreCategory !== null ? sheet.tyreCategory.value : cls.category;
  let gripScale = 1, gripBasis: Basis = 'estimated';
  const scale = sheet.calibration.tyreGripScale;
  if (typeof scale === 'number' && Number.isFinite(scale) && scale > 0) {
    // A calibration may not leave the category's range (DESIGN.md 8): past it, the car is held at the edge.
    const range = tyreGripScaleRange(category);
    gripScale = scale < range.min ? range.min : scale > range.max ? range.max : scale;
    gripBasis = 'calibrated';
  }
  const road = coastDown(sheet);
  const rollingOnFile = road !== null && road.hasA;
  const tf = tyreParams(front, category, gripScale, rollingOnFile);
  const tr = tyreParams(rear, category, gripScale, rollingOnFile);

  const axles: readonly ['tyreFront' | 'tyreRear', Basis][] = [['tyreFront', frontBasis], ['tyreRear', rearBasis]];
  for (const [axle, b] of axles) {
    basis[`${axle}.radius`] = derivedBasis(b);
    basis[`${axle}.width`] = b;
    basis[`${axle}.fz0`] = derivedBasis(b);
    basis[`${axle}.muY0`] = gripBasis;
    basis[`${axle}.cAlpha0`] = 'estimated';
    basis[`${axle}.fzStiffPeak`] = 'estimated';
    for (const k of ['muXRatio', 'loadSens', 'slideRatio', 'slideFall', 'cKappaPerFz', 'relaxLat', 'relaxLong', 'trail0']) basis[`${axle}.${k}`] = 'estimated';
    basis[`${axle}.rollRes`] = rollingOnFile ? 'derived' : 'estimated';
  }
  basis.wheelInertiaFront = 'estimated';
  basis.wheelInertiaRear = 'estimated';

  return {
    front: tf, rear: tr,
    wheelInertiaFront: wheelInertia(wheelMass(front.width, front.rimIn), tf.radius),
    wheelInertiaRear: wheelInertia(wheelMass(rear.width, rear.rimIn), tr.radius),
    category, gripScale,
  };
}

/* ------------------------------------------------------------------ chassis */

/** The car's mass as driven, kg: curb weight on file (else the class's) and a 75 kg driver. */
export function drivenMass(sheet: PhysicsSheet): number {
  const lb = pos(sheet.curbWeightLb);
  return (lb !== null ? lb * LB : CLASS_BLANK[sheet.identity.bodyClass].curbKg) + DRIVER_MASS;
}

/** The car's body size, m, sourced or the class's, each with its basis. */
function bodySize(sheet: PhysicsSheet, bodyClass: BodyClass): { width: number; height: number; length: number; wb: Basis; hb: Basis; lb: Basis } {
  const dims = CLASS_DIMENSIONS[bodyClass];
  const w = pos(sheet.widthIn), h = pos(sheet.heightIn), l = pos(sheet.lengthIn);
  return {
    width: w !== null ? w * IN : dims.width, height: h !== null ? h * IN : dims.height, length: l !== null ? l * IN : dims.length,
    wb: w !== null ? 'sourced' : 'estimated', hb: h !== null ? 'sourced' : 'estimated', lb: l !== null ? 'sourced' : 'estimated',
  };
}

/**
 * The chassis: mass (curb weight and a driver), wheelbase, tracks and weight split as on file or by class, a = L (1 -
 * front share); the centre of gravity's height on file, else the class's share of the body's height; unsprung masses
 * by class, riding at their wheel centres, and the sprung mass's height set so that ms hs + mu hu = m h exactly;
 * springs from the class's ride frequencies on each axle's sprung load, dampers from its damping ratio, anti-roll
 * bars from its roll gradient and front share of roll stiffness (all moved by the suspension grade); inertias from
 * the class's yaw index and radii of gyration; full lock from the turning circle.
 */
export function resolveChassis(sheet: PhysicsSheet, layout: SheetLayout, tyres: ResolvedTyres, basis: Record<string, Basis>): ChassisModel {
  const bc = layout.bodyClass;
  const cls = CHASSIS_CLASS[bc], dims = CLASS_DIMENSIONS[bc];
  const grade = SUSPENSION_GRADE[sheet.suspensionGrade !== null ? sheet.suspensionGrade.value : 'standard'];

  const mass = drivenMass(sheet);
  const massBasis = onFile(pos(sheet.curbWeightLb) !== null ? sheet.curbWeightLb : null);

  const wbIn = pos(sheet.wheelbaseIn);
  const wheelbase = wbIn !== null ? wbIn * IN : dims.wheelbase;
  const wbBasis: Basis = wbIn !== null ? 'sourced' : 'estimated';
  // One track on file stands for the other better than the class's does: most cars' differ by a centimetre or two.
  const tfIn = pos(sheet.trackFrontIn), trIn = pos(sheet.trackRearIn);
  const trackFront = tfIn !== null ? tfIn * IN : trIn !== null ? trIn * IN : dims.trackFront;
  const trackRear = trIn !== null ? trIn * IN : tfIn !== null ? tfIn * IN : dims.trackRear;
  const tfBasis: Basis = tfIn !== null ? 'sourced' : trIn !== null ? 'derived' : 'estimated';
  const trBasis: Basis = trIn !== null ? 'sourced' : tfIn !== null ? 'derived' : 'estimated';

  const pct = num(sheet.weightDistFrontPct);
  const shareOnFile = pct !== null && pct > 0 && pct < 100;
  const share = shareOnFile ? (pct as number) / 100 : weightFrontShare(layout.location, layout.drive, bc);
  const shareBasis: Basis = shareOnFile ? 'sourced' : 'estimated';
  const a = wheelbase * (1 - share);
  const b = wheelbase - a;

  const body = bodySize(sheet, bc);
  const hIn = pos(sheet.cgHeightIn);
  const cgHeight = hIn !== null ? hIn * IN : cls.cgHeightRatio * body.height;
  const cgBasis: Basis = hIn !== null ? 'sourced' : 'estimated';

  const unsprungFront = cls.unsprungFront, unsprungRear = cls.unsprungRear;
  const sprungMass = mass - unsprungFront - unsprungRear;
  // Each axle's unsprung mass rides at its wheel centre: the tyre's loaded radius.
  const unsprungHeightFront = tyres.front.radius, unsprungHeightRear = tyres.rear.radius;
  const sprungCgHeight = (mass * cgHeight - unsprungFront * unsprungHeightFront - unsprungRear * unsprungHeightRear) / sprungMass;

  // Springs: each corner carries half its axle's sprung load at the ride frequency, k = m (2 pi f)^2. Dampers at the
  // damping ratio of that corner, c = 2 zeta sqrt(k m) = 2 zeta m omega.
  const sprungFront = Math.max(mass * share - unsprungFront, 0.1 * sprungMass);
  const sprungRear = Math.max(mass * (1 - share) - unsprungRear, 0.1 * sprungMass);
  const omegaF = 2 * PI * cls.rideHzFront * grade.rideScale, omegaR = 2 * PI * cls.rideHzRear * grade.rideScale;
  const zeta = cls.dampingRatio + grade.dampingAdd;
  const springFront = 0.5 * sprungFront * omegaF * omegaF, springRear = 0.5 * sprungRear * omegaR * omegaR;
  const damperFront = 2 * zeta * 0.5 * sprungFront * omegaF, damperRear = 2 * zeta * 0.5 * sprungRear * omegaR;

  // Anti-roll bars. The roll gradient phi / ay = ms hRoll / (Kf + Kr - ms g hRoll) gives the total roll stiffness;
  // the class's front share of it (its weight share plus the class's understeering margin, none for front drive) splits it; the springs
  // already give 0.5 k t^2 at each axle and the bars the rest. A bar cannot be negative: where an axle's springs alone
  // already pass its share (a pickup's leaf-sprung rear), that bar is 0 and the other is set to keep the split,
  // which keeps the handling balance at the cost of a little less roll.
  const rollCentreFront = cls.rollCentreFront, rollCentreRear = cls.rollCentreRear;
  const hRoll = Math.max(sprungCgHeight - (rollCentreFront + (rollCentreRear - rollCentreFront) * a / wheelbase), MIN_ROLL_ARM);
  const gradient = cls.rollGradient * grade.rollGradientScale;
  const total = sprungMass * hRoll / gradient + sprungMass * G * hRoll;
  // A front-drive car's front tyres carry the drive as well as the steering, which already makes it understeer under
  // power: makers give such cars proportionally more rear roll stiffness (a twist-beam rear axle is itself a rear bar;
  // a front-drive hatchback cornered hard lifts an inside rear wheel). Its roll split is its weight split, without
  // the class's understeering margin.
  let chi = share + (layout.drive === 'FWD' ? 0 : cls.rollShareOverWeight);
  chi = chi < 0.2 ? 0.2 : chi > 0.8 ? 0.8 : chi;
  const springRollF = 0.5 * springFront * trackFront * trackFront, springRollR = 0.5 * springRear * trackRear * trackRear;
  let arbFront = chi * total - springRollF, arbRear = (1 - chi) * total - springRollR;
  if (arbRear < 0) { arbRear = 0; arbFront = Math.max(0, springRollR * chi / (1 - chi) - springRollF); }
  else if (arbFront < 0) { arbFront = 0; arbRear = Math.max(0, springRollF * (1 - chi) / chi - springRollR); }

  // Inertias. Yaw: the class's dynamic index times m a b. Roll and pitch: the class's radii of gyration give the sprung
  // body's inertia about its own centre of gravity; chassis.ts turns it about the roll axis (hRoll below) and about
  // the ground (hs below), so the parallel-axis term is added for each.
  const izz = cls.yawIndex * mass * a * b;
  const kRoll = ROLL_GYRATION_PER_WIDTH * body.width, kPitch = PITCH_GYRATION_PER_LENGTH * body.length;
  const ixx = sprungMass * (kRoll * kRoll + hRoll * hRoll);
  const iyy = sprungMass * (kPitch * kPitch + sprungCgHeight * sprungCgHeight);

  // Full lock from the turning circle: the outer front wheel sweeps radius R about a centre on the rear axle's line,
  // so the rear axle's centre turns on sqrt(R^2 - L^2) - t / 2 and the mean front wheel is at atan(L / that).
  let maxSteer = MAX_STEER_DEFAULT, steerBasis: Basis = 'estimated';
  const circleFt = pos(sheet.turningCircleFt);
  if (circleFt !== null) {
    const R = 0.5 * circleFt * FT;
    const across = R * R - wheelbase * wheelbase;
    const rear = across > 0 ? Math.sqrt(across) - 0.5 * trackFront : 0;
    if (rear > 0) {
      const angle = datan(wheelbase / rear);
      maxSteer = angle < MIN_STEER ? MIN_STEER : angle > MAX_STEER ? MAX_STEER : angle;
      steerBasis = derivedBasis('sourced', wbBasis, tfBasis);
    }
  }
  const ratio = pos(sheet.steeringRatio);

  const chassis: ChassisModel = {
    mass, sprungMass, unsprungFront, unsprungRear,
    a, b, wheelbase, trackFront, trackRear,
    cgHeight, sprungCgHeight, unsprungHeightFront, unsprungHeightRear,
    izz, ixx, iyy,
    springFront, springRear, damperFront, damperRear, arbFront, arbRear,
    rollCentreFront, rollCentreRear, antiDive: ANTI_DIVE, antiSquat: ANTI_SQUAT,
    maxSteer, steerRatio: ratio !== null ? ratio : CLASS_STEER_RATIO[bc],
  };

  basis['chassis.mass'] = massBasis;
  basis['chassis.sprungMass'] = derivedBasis(massBasis, 'estimated');
  basis['chassis.unsprungFront'] = 'estimated';
  basis['chassis.unsprungRear'] = 'estimated';
  basis['chassis.a'] = derivedBasis(wbBasis, shareBasis);
  basis['chassis.b'] = derivedBasis(wbBasis, shareBasis);
  basis['chassis.wheelbase'] = wbBasis;
  basis['chassis.trackFront'] = tfBasis;
  basis['chassis.trackRear'] = trBasis;
  basis['chassis.cgHeight'] = cgBasis;
  basis['chassis.sprungCgHeight'] = derivedBasis(cgBasis, 'estimated');
  basis['chassis.unsprungHeightFront'] = basis['tyreFront.radius'] !== undefined ? basis['tyreFront.radius'] : 'estimated';
  basis['chassis.unsprungHeightRear'] = basis['tyreRear.radius'] !== undefined ? basis['tyreRear.radius'] : 'estimated';
  for (const k of ['izz', 'ixx', 'iyy', 'springFront', 'springRear', 'damperFront', 'damperRear', 'arbFront', 'arbRear',
    'rollCentreFront', 'rollCentreRear', 'antiDive', 'antiSquat']) basis[`chassis.${k}`] = 'estimated';
  basis['chassis.maxSteer'] = steerBasis;
  basis['chassis.steerRatio'] = ratio !== null ? 'sourced' : 'estimated';
  return chassis;
}

/* ------------------------------------------------------------------ air */

/**
 * The air: with a coast-down's C on file, drag area 2 C / rho and its A and B as the extra road load; else Cd x
 * frontal area (the area on file, else 0.84 of width x height); else a calibrated drag area; else the class's. Lift
 * areas are Cl x area when the lift coefficients are on file, else the class's.
 */
export function resolveAero(sheet: PhysicsSheet, layout: SheetLayout, basis: Record<string, Basis>): AeroModel {
  const cls = CHASSIS_CLASS[layout.bodyClass];
  const body = bodySize(sheet, layout.bodyClass);
  const areaSqFt = pos(sheet.frontalAreaSqFt);
  const area = areaSqFt !== null ? areaSqFt * SQFT : FRONTAL_AREA_SHARE * body.width * body.height;
  const areaBasis: Basis = areaSqFt !== null ? 'sourced' : 'estimated';

  let dragArea = cls.dragArea, dragBasis: Basis = 'estimated';
  let roadLoadA = 0, roadLoadB = 0, aBasis: Basis = 'estimated', bBasis: Basis = 'estimated';
  const road = coastDown(sheet);
  const cd = pos(sheet.dragCoefficient);
  const calibrated = sheet.calibration.dragAreaM2;
  if (road !== null) {
    // F = C v^2 is the air: 0.5 rho CdA v^2.
    dragArea = 2 * road.c / RHO_AIR; dragBasis = 'derived';
    roadLoadA = road.a; roadLoadB = road.b;
    if (road.hasA) aBasis = 'derived';
    if (num(sheet.roadLoadB) !== null) bBasis = 'derived';
  } else if (cd !== null) {
    dragArea = cd * area; dragBasis = derivedBasis('sourced', areaBasis);
  } else if (typeof calibrated === 'number' && Number.isFinite(calibrated) && calibrated > 0) {
    dragArea = calibrated; dragBasis = 'calibrated';
  }

  const clF = num(sheet.liftCoefficientFront), clR = num(sheet.liftCoefficientRear);
  basis['aero.dragArea'] = dragBasis;
  basis['aero.liftAreaFront'] = clF !== null ? derivedBasis('sourced', areaBasis) : 'estimated';
  basis['aero.liftAreaRear'] = clR !== null ? derivedBasis('sourced', areaBasis) : 'estimated';
  basis['aero.roadLoadA'] = aBasis;
  basis['aero.roadLoadB'] = bBasis;
  return {
    dragArea,
    liftAreaFront: clF !== null ? clF * area : cls.liftAreaFront,
    liftAreaRear: clR !== null ? clR * area : cls.liftAreaRear,
    roadLoadA, roadLoadB,
  };
}

/* ------------------------------------------------------------------ engine */

function engineKind(layout: SheetLayout): EngineKind {
  if (layout.powertrain === 'electric') return 'electric';
  const i = layout.induction;
  if (i === 'natural') return 'na';
  return i === 'supercharged' ? 'supercharged' : 'turbo';   // a twincharged engine is taken as turbocharged (classes.ts)
}

/** The nearest usual cylinder count to a displacement, at about half a litre a cylinder. */
function cylindersFor(litres: number): number {
  const counts = [3, 4, 6, 8, 10, 12];
  const want = litres / 0.55;
  let best = counts[0];
  for (let i = 1; i < counts.length; i++) if (Math.abs(counts[i] - want) < Math.abs(best - want)) best = counts[i];
  return best;
}

/** Peak power (W) and torque (N m) on an authored curve ([rad/s, N m], straight lines between points) up to a speed, and where each is. */
function curvePeaks(curve: readonly (readonly [number, number])[], top: number): { power: number; powerOmega: number; torque: number; torqueOmega: number } {
  let power = 0, powerOmega = 0, torque = 0, torqueOmega = 0;
  const consider = (w: number, t: number): void => {
    if (t > torque) { torque = t; torqueOmega = w; }
    if (t * w > power) { power = t * w; powerOmega = w; }
  };
  for (let i = 0; i < curve.length; i++) {
    const w0 = curve[i][0], t0 = curve[i][1];
    if (w0 > top) break;
    consider(w0, t0);
    if (i + 1 >= curve.length) break;
    const w1 = curve[i + 1][0], t1 = curve[i + 1][1];
    if (!(w1 > w0)) continue;
    const s = (t1 - t0) / (w1 - w0);
    const end = w1 < top ? w1 : top;
    // Torque is a line here, so power is a parabola, whose top may fall between the points.
    if (s < 0) { const wv = (s * w0 - t0) / (2 * s); if (wv > w0 && wv < end) consider(wv, t0 + s * (wv - w0)); }
    if (end < w1) consider(end, t0 + s * (end - w0));
  }
  return { power, powerOmega, torque, torqueOmega };
}

/**
 * The engine's figures in SI for buildEngine: the published peaks and redline converted; a speed not on file at the
 * family's share of redline; a redline not on file by family (and never below a published power peak); a peak torque
 * not on file from the displacement at a typical brake mean effective pressure for the induction, kept where it is
 * consistent with the power peak; a hybrid's system figures as one engine (its motor fills the low speeds, so its
 * torque sits at the top of that band); an electric motor's torque from a base speed a third of its top speed. An
 * authored curve is used as given and the peaks are read off it.
 */
export function resolveEngineSpec(sheet: PhysicsSheet, layout: SheetLayout, basis: Record<string, Basis>): EngineSpec {
  const blank = CLASS_BLANK[layout.bodyClass];
  const kind = engineKind(layout);
  const electric = kind === 'electric';
  const hybrid = layout.powertrain === 'hybrid' || layout.powertrain === 'plug-in-hybrid';
  const boosted = kind === 'turbo' || kind === 'supercharged';
  const ptB = layout.basisOf.powertrain;

  const litresOnFile = pos(sheet.displacementL), cylOnFile = pos(sheet.cylinders);
  const hpOnFile = pos(sheet.horsepower);
  const litres = electric ? 0 : litresOnFile !== null ? litresOnFile : blank.litres;
  const cylinders = electric ? 0 : cylOnFile !== null ? Math.round(cylOnFile) : litresOnFile !== null ? cylindersFor(litresOnFile) : blank.cylinders;

  // The authored curve of a drawn car: [rpm, N m] to [rad/s, N m].
  let curve: [number, number][] | null = null;
  if (sheet.torqueCurve !== null && Array.isArray(sheet.torqueCurve.value) && sheet.torqueCurve.value.length > 1) {
    const pts = sheet.torqueCurve.value;
    let ok = true;
    for (let i = 0; i < pts.length; i++) {
      if (!(Number.isFinite(pts[i][0]) && Number.isFinite(pts[i][1]) && pts[i][0] >= 0 && (i === 0 || pts[i][0] > pts[i - 1][0]))) ok = false;
    }
    if (ok) curve = pts.map((p): [number, number] => [p[0] * RPM, p[1]]);
  }

  const redlineOnFile = pos(sheet.redlineRpm);
  const hpRpm = pos(sheet.horsepowerRpm), tqLowRpm = pos(sheet.torqueRpmLow), tqHighRpm = pos(sheet.torqueRpmHigh);
  const tqOnFile = pos(sheet.torqueLbFt);

  let power: number, powerOmega: number, torque: number, torqueLow: number, torqueHigh: number, redline: number;
  let pB: Basis, pwB: Basis, tB: Basis, tlB: Basis, thB: Basis, rB: Basis;

  if (curve !== null) {
    redline = redlineOnFile !== null ? redlineOnFile * RPM : curve[curve.length - 1][0];
    rB = redlineOnFile !== null ? 'sourced' : 'derived';
    const peaks = curvePeaks(curve, redline);
    power = peaks.power; powerOmega = peaks.powerOmega; torque = peaks.torque; torqueLow = peaks.torqueOmega; torqueHigh = peaks.torqueOmega;
    pB = pwB = tB = tlB = thB = 'derived';
  } else {
    power = hpOnFile !== null ? hpOnFile * HP
      : litresOnFile !== null ? litresOnFile * (boosted ? HP_PER_LITRE.boosted : HP_PER_LITRE.unboosted) * HP
      : blank.hp * HP;
    pB = hpOnFile !== null ? 'sourced' : 'estimated';
    if (electric) {
      redline = redlineOnFile !== null ? redlineOnFile * RPM : REDLINE.electric;
      rB = redlineOnFile !== null ? 'sourced' : 'estimated';
      torque = tqOnFile !== null ? tqOnFile * LBFT : power * EV_SPEED_RANGE / redline;
      tB = tqOnFile !== null ? 'sourced' : 'estimated';
      // A base speed past the motor's top speed is not a motor: keep the top speed above it.
      if (redlineOnFile === null && power / torque > 0.8 * redline) redline = 1.25 * power / torque;
      powerOmega = power / torque; torqueLow = 0; torqueHigh = powerOmega;
      pwB = tlB = thB = derivedBasis(pB, tB);
    } else {
      const shares = peakSpeedShares(boosted);
      rB = redlineOnFile !== null ? 'sourced' : 'estimated';
      if (redlineOnFile !== null) redline = redlineOnFile * RPM;
      else {
        redline = defaultRedline(layout.powertrain, cylinders, boosted, layout.bodyClass);
        // Never below a published peak: an estimated redline sits a little above the power peak and well above torque.
        if (hpRpm !== null && REDLINE_OVER_POWER * hpRpm * RPM > redline) redline = REDLINE_OVER_POWER * hpRpm * RPM;
        const tqTop = tqHighRpm !== null ? tqHighRpm : tqLowRpm;
        if (tqTop !== null && tqTop * RPM / TORQUE_PEAK_MAX_SHARE > redline) redline = tqTop * RPM / TORQUE_PEAK_MAX_SHARE;
      }
      powerOmega = hpRpm !== null ? hpRpm * RPM : shares.power * redline;
      pwB = hpRpm !== null ? 'sourced' : 'estimated';
      const lowR = tqLowRpm !== null ? tqLowRpm : tqHighRpm, highR = tqHighRpm !== null ? tqHighRpm : tqLowRpm;
      torqueLow = lowR !== null ? lowR * RPM : shares.torqueLow * redline;
      torqueHigh = highR !== null ? highR * RPM : shares.torqueHigh * redline;
      if (torqueHigh < torqueLow) torqueHigh = torqueLow;
      tlB = tqLowRpm !== null ? 'sourced' : tqHighRpm !== null ? 'derived' : 'estimated';
      thB = tqHighRpm !== null ? 'sourced' : tqLowRpm !== null ? 'derived' : 'estimated';

      if (tqOnFile !== null) { torque = tqOnFile * LBFT; tB = 'sourced'; }
      else {
        // The torque at the power peak is P / omegaP; the peak must stand above it, and power on the torque plateau
        // must stay under peak power. Between those, the displacement at a typical bmep for the induction.
        const lo = TORQUE_OVER_POWER_PEAK * power / powerOmega;
        const hi = Math.max(lo, PLATEAU_POWER_SHARE * power / torqueHigh);
        const bmep = layout.powertrain === 'diesel' ? TORQUE_BMEP.diesel
          : kind === 'turbo' ? TORQUE_BMEP.turbo : kind === 'supercharged' ? TORQUE_BMEP.supercharged : TORQUE_BMEP.natural;
        const fromBmep = bmep * litres * 0.001 / (4 * PI);
        torque = hybrid ? hi : fromBmep < lo ? lo : fromBmep > hi ? hi : fromBmep;
        tB = 'estimated';
      }
      // Estimated speeds give way to published figures, so the published peaks stay the peaks.
      if (hpRpm === null && TORQUE_OVER_POWER_PEAK * power / torque > powerOmega) powerOmega = TORQUE_OVER_POWER_PEAK * power / torque;
      if (tqHighRpm === null && tqLowRpm === null && torque * torqueHigh > PLATEAU_POWER_SHARE * power) {
        torqueHigh = PLATEAU_POWER_SHARE * power / torque;
        if (torqueLow > torqueHigh) torqueLow = torqueHigh;
      }
      if (redlineOnFile === null && REDLINE_OVER_POWER * powerOmega > redline) redline = REDLINE_OVER_POWER * powerOmega;
    }
  }

  const boostOnFile = pos(sheet.boostPsi);
  const boostPa = !boosted ? 0 : boostOnFile !== null ? boostOnFile * PSI : CHARGE_AIR[kind === 'supercharged' ? 'supercharged' : 'turbo'].boostPa;
  const idle = electric ? 0 : defaultIdle(cylinders);

  const kindBasis: Basis = electric ? ptB : layout.basisOf.induction;
  const sizeBasis: Basis = electric ? ptB : 'estimated';
  basis['engine.kind'] = kindBasis;
  basis['engine.displacement'] = electric ? ptB : litresOnFile !== null ? 'sourced' : 'estimated';
  basis['engine.cylinders'] = electric ? ptB : cylOnFile !== null ? 'sourced' : litresOnFile !== null ? 'derived' : 'estimated';
  basis['engine.inertia'] = 'estimated';
  basis['engine.idle'] = sizeBasis;
  basis['engine.redline'] = rB;
  basis['engine.limiterBand'] = 'estimated';
  basis['engine.n'] = derivedBasis(rB);
  basis['engine.dOmega'] = derivedBasis(rB);
  const wotBasis: Basis = curve !== null ? 'sourced' : derivedBasis(pB, pwB, tB, tlB, thB, rB);
  basis['engine.wot'] = wotBasis;
  basis['engine.offBoost'] = kind === 'turbo' && curve === null ? derivedBasis(wotBasis, onFile(boostOnFile !== null ? sheet.boostPsi : null)) : wotBasis;
  basis['engine.friction'] = 'estimated';
  basis['engine.boost'] = kind === 'turbo' && curve === null ? 'estimated' : kindBasis;
  basis['engine.regen'] = electric ? 'estimated' : kindBasis;
  basis['engine.air'] = electric ? ptB : curve !== null ? 'sourced' : 'estimated';

  return {
    kind, displacementL: litres, cylinders,
    peakPower: power, peakPowerOmega: powerOmega,
    peakTorque: torque, peakTorqueOmegaLow: torqueLow, peakTorqueOmegaHigh: torqueHigh,
    redline, idle, boostPa,
    inertia: engineInertia(litres, electric),
    curve,
  };
}

/** Closed-throttle friction torque from a friction mean effective pressure fit, N m (the same formula engine.ts uses). */
function fmepTorque(fmep: readonly number[], displacement: number, omega: number): number {
  const x = omega / (1000 * RPM);
  return (fmep[0] + fmep[1] * x + fmep[2] * x * x) * displacement / (4 * PI);
}

/**
 * Gives an engine with an air model another friction fit (classes.ts FMEP) while keeping its full-throttle curve: the
 * engine's own breathing (air.specific) is scaled at each speed by (wot + new friction) / (wot + old friction), so the
 * indicated work it makes pays the new friction and leaves the same brake torque. The airflow limit moves with it, so
 * a stock engine is still not held by it. Then the tables are rebuilt. buildEngine starts every engine as petrol.
 */
export function refitFriction(e: EngineModel, fmep: readonly [number, number, number]): void {
  const air = e.air;
  if (air === null) return;
  let most = 1;
  for (let i = 0; i < e.n; i++) {
    const t = e.wot[i], before = t + e.friction[i], after = t + fmepTorque(fmep, e.displacement, i * e.dOmega);
    if (before > 0 && after > 0) {
      const k = after / before;
      air.specific[i] *= k;
      if (k > most) most = k;
    }
  }
  air.fmep = [fmep[0], fmep[1], fmep[2]];
  if (Number.isFinite(air.maxAirflow)) air.maxAirflow *= most;
  rebuildTables(e);
}

/** Builds the engine from its figures (engine.ts): a diesel gets the diesel friction fit, with its full-throttle curve kept. */
export function resolveEngine(spec: EngineSpec, layout: SheetLayout): EngineModel {
  const e = buildEngine(spec);
  if (layout.powertrain === 'diesel' && e.air !== null) refitFriction(e, FMEP.diesel);
  return e;
}

/* ------------------------------------------------------------------ the car's own systems */

/**
 * The speed limit a car of this class and power-to-weight is usually governed at, m/s (Infinity for none): the
 * class's limit, climbing to its performance limit across the power-to-weight band (classes.ts).
 */
export function classLimiter(bodyClass: BodyClass, powerW: number, curbKg: number): number {
  const base = CLASS_LIMITER[bodyClass], top = CLASS_LIMITER_PERFORMANCE[bodyClass];
  const ptw = curbKg > 0 ? powerW / curbKg : 0;
  const band = LIMITER_RAISE_BAND;
  const t = ptw <= band.from ? 0 : ptw >= band.to ? 1 : (ptw - band.from) / (band.to - band.from);
  const v = base + (top - base) * t;
  // The class tables write "no governor" as 400 mph.
  return v >= 399 * MPH ? Infinity : v;
}

/**
 * The car's own systems: ABS, traction and stability control as the sheet says, else on from the 2012 model year;
 * launch control as the sheet says, else none. The governor: the published top speed when the sheet says it is
 * governed; none when it says not; when it does not say, a published top speed within the class's usual limit is
 * taken as the governor and one above it as the air's; with no top speed on file, the class's usual limit.
 */
export function resolveSystems(sheet: PhysicsSheet, layout: SheetLayout, chassis: ChassisModel, spec: EngineSpec, basis: Record<string, Basis>): SystemsModel {
  const fitted = layout.year >= SYSTEMS_STANDARD_FROM;
  const flag = (f: Sourced<boolean> | null, fallback: boolean): boolean => (f !== null && typeof f.value === 'boolean' ? f.value : fallback);
  const usual = classLimiter(layout.bodyClass, spec.peakPower, chassis.mass - DRIVER_MASS);
  const top = pos(sheet.topSpeedMph);
  const governed = sheet.topSpeedGoverned !== null ? sheet.topSpeedGoverned.value : null;
  let limiterSpeed = usual, limBasis: Basis = 'estimated';
  if (top !== null && governed === true) { limiterSpeed = top * MPH; limBasis = 'sourced'; }
  else if (governed === false) { limiterSpeed = Infinity; limBasis = 'sourced'; }
  else if (top !== null) limiterSpeed = Number.isFinite(usual) && top * MPH <= usual + 2 * MPH ? top * MPH : Infinity;

  basis['systems.abs'] = onFile(sheet.abs);
  basis['systems.tcs'] = onFile(sheet.tractionControl);
  basis['systems.esc'] = onFile(sheet.stabilityControl);
  basis['systems.launchControl'] = onFile(sheet.launchControl);
  basis['systems.limiterSpeed'] = limBasis;
  return {
    abs: flag(sheet.abs, fitted), tcs: flag(sheet.tractionControl, fitted), esc: flag(sheet.stabilityControl, fitted),
    launchControl: flag(sheet.launchControl, false),
    limiterSpeed,
  };
}

/* ------------------------------------------------------------------ driveline */

/** What resolveDriveline reads from the pieces already resolved. */
export type DrivelineInputs = { engine: EngineModel; chassis: ChassisModel; tyres: ResolvedTyres; aero: AeroModel; systems: SystemsModel };

/**
 * The speed, m/s, at which the road load (air, the tyres' rolling resistance at their static loads, any coast-down
 * road load) takes all of this power at the wheels: the car's top speed on the flat with the engine at its power peak.
 */
export function powerLimitedSpeed(wheelPower: number, chassis: ChassisModel, tyres: ResolvedTyres, aero: AeroModel): number {
  const L = chassis.a + chassis.b;
  const rolling = chassis.mass * G * (tyres.front.rollRes * chassis.b + tyres.rear.rollRes * chassis.a) / L + aero.roadLoadA;
  const air = 0.5 * RHO_AIR * aero.dragArea;
  const surplus = (v: number): number => wheelPower - v * (rolling + aero.roadLoadB * v + air * v * v);
  let lo = 0, hi = 300;
  if (surplus(hi) > 0) return hi;
  // Bisection: deterministic, and the surplus falls monotonically once the air dominates.
  for (let i = 0; i < 80; i++) { const mid = 0.5 * (lo + hi); if (surplus(mid) > 0) lo = mid; else hi = mid; }
  return lo;
}

function copyDiff(kind: DiffKind): DiffModel {
  const d = DIFF_DEFAULT[kind];
  return { kind: d.kind, preload: d.preload, lockPerTorque: d.lockPerTorque };
}

/**
 * The driveline. The gearbox's type, efficiency, shift time and launch device from the transmission table (a pickup's
 * or off-roader's automatic gets a truck's tighter converter). Gears on file; else the type's usual count spaced
 * geometrically over its usual spread, with top gear (a CVT's highest ratio) set so that at the car's top speed (the
 * lower of where its power meets the road load and its governor) the engine is at its power peak, held to the type's
 * usual range and never past 95% of redline. Final drive on file, else the class's (an electric car's single
 * reduction turns its motor at 88% of top speed at most there). The centre: the all-wheel-drive kind on file; else
 * by layout: an electric car a fixed split by its weight, a 4WD truck part-time (locked), a transverse front-engine
 * car front-on-demand and a longitudinal or mid- or rear-engined one rear-on-demand. Differentials on file; else a
 * limited-slip rear for a sports car and a performance coupe, open for the rest. Clutch capacity 1.6 x peak torque.
 */
export function resolveDriveline(sheet: PhysicsSheet, layout: SheetLayout, inputs: DrivelineInputs, basis: Record<string, Basis>): DrivelineModel {
  const { engine, chassis, tyres, aero, systems } = inputs;
  const type = layout.transmission;
  const row = TRANSMISSION[type];
  const bc = layout.bodyClass;
  const electric = engine.kind === 'electric';
  const variator = type === 'cvt' || type === 'ecvt';
  const L = chassis.a + chassis.b;
  const peaks = enginePeaks(engine);

  // The centre first: it decides which wheels the gearing turns.
  let centre: DrivelineModel['centre'];
  let centreBasis: Basis = derivedBasis(layout.basisOf.drive);
  if (layout.layout === 'FWD') centre = { kind: 'none', frontShare: 1, lockTorque: 0 };
  else if (layout.layout === 'RWD') centre = { kind: 'none', frontShare: 0, lockTorque: 0 };
  else if (sheet.awdKind !== null) {
    const c = AWD_CENTRE[sheet.awdKind.value];
    centre = { kind: c.kind, frontShare: c.frontShare, lockTorque: c.lockTorque };
    centreBasis = 'estimated';   // the kind is on file; its split and coupling torque are typical
  } else {
    centreBasis = 'estimated';
    if (electric) centre = { kind: 'fixed', frontShare: chassis.b / L, lockTorque: 0 };   // a motor per axle, torque by the load each carries
    else {
      const longitudinal = layout.location !== 'front' || bc === 'sports' || bc === 'coupe' || bc === 'pickup' || bc === 'offroad' || engine.cylinders >= 8;
      const kind = layout.drive === '4WD' ? 'part-time' : longitudinal ? 'rear-on-demand' : 'front-on-demand';
      const c = AWD_CENTRE[kind];
      centre = { kind: c.kind, frontShare: c.frontShare, lockTorque: c.lockTorque };
    }
  }
  const frontDrive = layout.layout === 'FWD' ? 1 : layout.layout === 'RWD' ? 0 : centre.frontShare;
  const rDrive = frontDrive * tyres.front.radius + (1 - frontDrive) * tyres.rear.radius;

  const efficiency = drivelineEfficiency(type, layout.drive);
  const vMax = powerLimitedSpeed(efficiency * peaks.power, chassis, tyres, aero);
  const vTop = systems.limiterSpeed < vMax ? systems.limiterSpeed : vMax;
  const redline = engine.redline;
  const wPower = peaks.powerOmega > 0 ? peaks.powerOmega : 0.9 * redline;

  // Gears on file, if they read.
  let list: number[] | null = null;
  if (sheet.gearRatios !== null && Array.isArray(sheet.gearRatios.value) && sheet.gearRatios.value.length > 0) {
    const v = sheet.gearRatios.value;
    let ok = true;
    for (let i = 0; i < v.length; i++) if (!(Number.isFinite(v[i]) && v[i] > 0)) ok = false;
    if (ok) list = v.slice();
  }
  const fdOnFile = pos(sheet.finalDriveRatio);

  let finalDrive: number, fdBasis: Basis = fdOnFile !== null ? 'sourced' : 'estimated';
  let gears: number[], gearBasis: Basis = 'estimated';
  if (type === 'single-speed') {
    if (list !== null && fdOnFile === null && list[0] >= 3) {
      // One ratio on file and no final drive: that ratio is the whole reduction.
      gears = [1]; finalDrive = list[0]; gearBasis = 'derived'; fdBasis = 'sourced';
    } else {
      gears = list !== null ? [list[0]] : [1];
      if (list !== null) gearBasis = 'sourced';
      finalDrive = fdOnFile !== null ? fdOnFile : Math.min(SINGLE_SPEED_FINAL_DRIVE, EV_TOP_SHARE * redline * rDrive / (vTop * gears[0]));
    }
  } else {
    finalDrive = fdOnFile !== null ? fdOnFile : CLASS_FINAL_DRIVE[bc];
    // Top gear that puts the engine at its power peak at the car's top speed.
    const ideal = wPower * rDrive / (vTop * finalDrive);
    const ceiling = TOP_GEAR_REDLINE_SHARE * redline * rDrive / (vTop * finalDrive);
    if (list !== null) {
      gears = variator ? [list[0], list[list.length - 1]] : list;
      gearBasis = 'sourced';
    } else if (variator) {
      // A CVT holds the engine at its power peak itself; its highest ratio only has to let it get there.
      const highest = Math.min(row.topMax, ideal);
      gears = [highest * row.spread, highest];
    } else {
      let top = ideal < row.topMin ? row.topMin : ideal > row.topMax ? row.topMax : ideal;
      if (top > ceiling) top = ceiling;
      gears = [];
      for (let g = 1; g <= row.gearCount; g++) gears.push(gearRatioAt(g, row.gearCount, top, row.spread));
    }
  }

  // The launch device: a truck's automatic gets a tighter converter that multiplies more.
  let converter: DrivelineModel['converter'] = null;
  if (row.converter !== null) {
    converter = { stallOmega: row.converter.stallOmega, torqueRatio: row.converter.torqueRatio, couplingRatio: row.converter.couplingRatio, lockGear: row.converter.lockGear };
    if (type === 'automatic' && (bc === 'pickup' || bc === 'offroad')) {
      converter.stallOmega = TRUCK_CONVERTER.stallOmega; converter.torqueRatio = TRUCK_CONVERTER.torqueRatio;
    }
    // A stall speed is matched to its engine: never near redline, never at idle.
    const hi = 0.6 * redline, lo = 1.3 * engine.idle;
    if (converter.stallOmega > hi) converter.stallOmega = hi;
    if (converter.stallOmega < lo) converter.stallOmega = lo;
  }

  // Differentials: the kind on file; else a limited-slip rear on a sports car and on a performance coupe (power to
  // weight past the class tables' performance band), when the rear is driven.
  const curbKg = chassis.mass - DRIVER_MASS;
  const performance = bc === 'sports' || (bc === 'coupe' && peaks.power / curbKg >= LIMITER_RAISE_BAND.to);
  const rearDriven = layout.layout !== 'FWD';
  const frontKind: DiffKind = sheet.diffFront !== null ? sheet.diffFront.value : 'open';
  const rearKind: DiffKind = sheet.diffRear !== null ? sheet.diffRear.value : performance && rearDriven ? 'limited-slip' : 'open';
  const diffBasis = (f: Sourced<DiffKind> | null, kind: DiffKind): Basis => (f === null ? 'estimated' : kind === 'open' || kind === 'locked' ? 'sourced' : 'estimated');

  const ratioBasis = derivedBasis(layout.basisOf.transmission);
  basis['driveline.layout'] = layout.basisOf.drive;
  basis['driveline.transmission'] = layout.basisOf.transmission;
  basis['driveline.gears'] = gearBasis;
  basis['driveline.reverse'] = 'estimated';
  basis['driveline.finalDrive'] = fdBasis;
  basis['driveline.efficiency'] = 'estimated';
  basis['driveline.shiftTime'] = 'estimated';
  basis['driveline.shiftTorqueHold'] = 'estimated';
  basis['driveline.launch'] = ratioBasis;
  basis['driveline.clutchCapacity'] = 'estimated';
  basis['driveline.converter'] = converter === null ? ratioBasis : 'estimated';
  basis['driveline.cvtRatioRate'] = variator ? 'estimated' : ratioBasis;
  basis['driveline.centre'] = centreBasis;
  basis['driveline.diffFront'] = diffBasis(sheet.diffFront, frontKind);
  basis['driveline.diffRear'] = diffBasis(sheet.diffRear, rearKind);

  return {
    layout: layout.layout, transmission: type,
    gears: Float64Array.from(gears),
    reverse: gears[0] * row.reverseOverFirst,
    finalDrive, efficiency,
    shiftTime: row.shiftTime, shiftTorqueHold: row.shiftTorqueHold, launch: row.launch,
    clutchCapacity: CLUTCH_CAPACITY_RATIO * peaks.torque,
    converter, cvtRatioRate: row.cvtRatioRate,
    centre, diffFront: copyDiff(frontKind), diffRear: copyDiff(rearKind),
  };
}

/* ------------------------------------------------------------------ brakes */

/**
 * The brakes. The total force at full pedal is the largest of 1.3 g on the car's weight and what each axle needs: the
 * force its tyres brake with at their peak in the ideal stop on the stickiest tyres of the car's category (the
 * category's top grip, at the axle loads that stop moves forward), plus the wheels' own inertia at that deceleration,
 * with a margin for ABS to find the peak, at the least favourable bias a setup may choose (BRAKE_BIAS_RANGE). That
 * total is split by the layout's front share (or the one given); the rear is then over-provisioned at the limit and
 * the brake-force distribution trims it, as DESIGN.md 6 intends. Each axle's torque is its force times its tyre's
 * radius, half a wheel. The handbrake: the class tables' torque at each rear wheel. A part that changes the tyre
 * category has to size the brakes again.
 */
export function resolveBrakes(layout: SheetLayout, chassis: ChassisModel, tyres: ResolvedTyres, basis: Record<string, Basis>, frontShare?: number): BrakeModel {
  const share = frontShare !== undefined && frontShare >= 0 && frontShare <= 1 ? frontShare : brakeFrontShare(layout.location, layout.drive);
  const stop = idealStop(chassis, tyres);
  let force = BRAKE_SIZING_G * chassis.mass * G;
  const lo = share - BRAKE_BIAS_RANGE, hi = share + BRAKE_BIAS_RANGE;
  if (lo > 0) force = Math.max(force, BRAKE_AXLE_MARGIN * stop.front / lo);
  if (hi < 1) force = Math.max(force, BRAKE_AXLE_MARGIN * stop.rear / (1 - hi));
  basis['brakes.maxTorqueFront'] = 'estimated';
  basis['brakes.maxTorqueRear'] = 'estimated';
  basis['brakes.handbrakeTorque'] = 'estimated';
  return {
    maxTorqueFront: 0.5 * share * force * tyres.front.radius,
    maxTorqueRear: 0.5 * (1 - share) * force * tyres.rear.radius,
    handbrakeTorque: HANDBRAKE_TORQUE,
  };
}

/**
 * The ideal straight-line stop on the stickiest tyres the car's category allows (its top grip, whatever the car's own
 * calibration): every tyre braking at its peak at the load the stop gives it, the front axle's share growing with the
 * deceleration (m a h / L), found by repeating it. Returns each axle's braking force, N, with what it takes to stop
 * that axle's wheels turning at that deceleration (2 J a / R^2) added. tyreMuX at the real loads, not the reference
 * figure, because load sensitivity gives the lightly loaded rear tyres more friction per newton.
 */
export function idealStop(chassis: ChassisModel, tyres: ResolvedTyres): { front: number; rear: number; decel: number } {
  const top = TYRE_CATEGORY[tyres.category].muY0Max;
  const tf: TyreParams = { ...tyres.front, muY0: top }, tr: TyreParams = { ...tyres.rear, muY0: top };
  const c = chassis, L = c.a + c.b, weight = c.mass * G;
  let a = BRAKE_SIZING_G * G, front = 0, rear = 0;
  for (let k = 0; k < 60; k++) {
    const shift = c.mass * a * c.cgHeight / L;
    const zf = 0.5 * (weight * c.b / L + shift), zr = 0.5 * (weight * c.a / L - shift);
    front = zf > 0 ? 2 * tyreMuX(tf, zf, 1) * zf : 0;
    rear = zr > 0 ? 2 * tyreMuX(tr, zr, 1) * zr : 0;
    a = (front + rear) / c.mass;
  }
  const rf = tf.radius, rr = tr.radius;
  return {
    front: front + (rf > 0 ? 2 * tyres.wheelInertiaFront * a / (rf * rf) : 0),
    rear: rear + (rr > 0 ? 2 * tyres.wheelInertiaRear * a / (rr * rr) : 0),
    decel: a,
  };
}

/* ------------------------------------------------------------------ setup */

// A setup value changes a figure by a stated rule: a published figure it touches becomes derived.
function touched(basis: Record<string, Basis>, key: string): void {
  basis[key] = derivedBasis(basis[key] !== undefined ? basis[key] : 'estimated');
}

function goodScale(k: number | undefined): k is number {
  return typeof k === 'number' && Number.isFinite(k) && k > 0 && k !== 1;
}

/**
 * Applies a build's setup to a resolved model, for the fields that are plain changes to what the resolver computes:
 * bars, springs and dampers as multiples of the car's own; a lower ride height, which lowers the sprung mass and so
 * the whole car's centre of gravity by the sprung share of it; the brakes' front share at the same 1.3 g; the final
 * drive as a multiple; lift area added at each axle. The rest of a setup (tyre pressures, camber, differential lock)
 * waits for parts.ts.
 */
export function applySetup(model: VehicleModel, setup: Setup, basis: Record<string, Basis>): void {
  const c = model.chassis;
  const scaled = ['arbFront', 'arbRear', 'springFront', 'springRear', 'damperFront', 'damperRear'] as const;
  for (const key of scaled) {
    const k = setup[key];
    if (goodScale(k)) { c[key] *= k; touched(basis, `chassis.${key}`); }
  }
  const drop = setup.rideHeightDrop;
  if (typeof drop === 'number' && Number.isFinite(drop) && drop !== 0) {
    // The body moves on its springs; the wheels stay where they are. Never lower than the wheel centres.
    const floor = Math.max(c.unsprungHeightFront, c.unsprungHeightRear);
    const hs = Math.max(c.sprungCgHeight - drop, floor);
    c.sprungCgHeight = hs;
    c.cgHeight = (c.sprungMass * hs + c.unsprungFront * c.unsprungHeightFront + c.unsprungRear * c.unsprungHeightRear) / c.mass;
    touched(basis, 'chassis.sprungCgHeight');
    touched(basis, 'chassis.cgHeight');
  }
  const bias = setup.brakeBias;
  if (typeof bias === 'number' && Number.isFinite(bias) && bias > 0 && bias < 1) {
    // The same total at the road, shared anew.
    const rF = model.tyreFront.radius, rR = model.tyreRear.radius;
    const force = 2 * model.brakes.maxTorqueFront / rF + 2 * model.brakes.maxTorqueRear / rR;
    model.brakes.maxTorqueFront = 0.5 * bias * force * rF;
    model.brakes.maxTorqueRear = 0.5 * (1 - bias) * force * rR;
    touched(basis, 'brakes.maxTorqueFront');
    touched(basis, 'brakes.maxTorqueRear');
  }
  if (goodScale(setup.finalDrive)) { model.driveline.finalDrive *= setup.finalDrive; touched(basis, 'driveline.finalDrive'); }
  if (typeof setup.aeroFront === 'number' && Number.isFinite(setup.aeroFront) && setup.aeroFront !== 0) {
    model.aero.liftAreaFront += setup.aeroFront; touched(basis, 'aero.liftAreaFront');
  }
  if (typeof setup.aeroRear === 'number' && Number.isFinite(setup.aeroRear) && setup.aeroRear !== 0) {
    model.aero.liftAreaRear += setup.aeroRear; touched(basis, 'aero.liftAreaRear');
  }
}

/* ------------------------------------------------------------------ the whole car */

/**
 * Turns a sheet into a vehicle model, SI throughout, and records for every parameter of the model how it was reached.
 * Each blank takes its class's figure. A build's parts are not fitted yet (parts.ts will); its setup's plain
 * changes are (applySetup).
 */
export function resolveModel(sheet: PhysicsSheet, build?: Build): { model: VehicleModel; basis: Record<string, Basis> } {
  const basis: Record<string, Basis> = {};
  const layout = resolveLayout(sheet);
  const tyres = resolveTyres(sheet, layout, basis);
  const chassis = resolveChassis(sheet, layout, tyres, basis);
  const aero = resolveAero(sheet, layout, basis);
  const spec = resolveEngineSpec(sheet, layout, basis);
  const engine = resolveEngine(spec, layout);
  const systems = resolveSystems(sheet, layout, chassis, spec, basis);
  const driveline = resolveDriveline(sheet, layout, { engine, chassis, tyres, aero, systems }, basis);
  const brakes = resolveBrakes(layout, chassis, tyres, basis);
  basis.nitrous = 'estimated';   // no stock car carries it

  const id = sheet.identity;
  const model: VehicleModel = {
    id: sheet.id,
    name: `${id.year} ${id.make} ${id.model}${id.trim !== '' ? ` ${id.trim}` : ''}`,
    chassis, tyreFront: tyres.front, tyreRear: tyres.rear,
    wheelInertiaFront: tyres.wheelInertiaFront, wheelInertiaRear: tyres.wheelInertiaRear,
    engine, driveline, brakes, aero, systems, nitrous: null,
  };
  if (build !== undefined && build !== null && build.setup !== undefined && build.setup !== null) applySetup(model, build.setup, basis);
  return { model, basis };
}
