// @micar/physics: every type the modules share. DESIGN.md explains the conventions and the equations.
// Units inside the core are SI (m, s, kg, N, rad, rad/s, Pa, K, W). A sheet keeps published units; resolve.ts converts once.
// Axes (ISO 8855): body x forward, y left, z up. Yaw and steer are positive to the LEFT (counter-clockwise from above).
// Wheels: 0 front-left, 1 front-right, 2 rear-left, 3 rear-right.

/* ------------------------------------------------------------------ where a figure comes from */

/** The same six kinds the card engine uses (@micar/engine SourceKind), so a card specification's figures pass straight in. */
export type SourceKind = 'manufacturer' | 'agency' | 'test' | 'reference' | 'owner' | 'illustrative';
export type Source = { kind: SourceKind; name?: string; url?: string; asOf?: string; note?: string };
export type Sourced<T> = { value: T; source: Source };

/**
 * How a parameter of the resolved model was reached.
 * sourced: a published figure, converted. derived: worked out from sourced figures by a stated formula.
 * calibrated: fitted to a test, which only tyre grip (to the skidpad) and drag area (to an ungoverned top speed) may be.
 * estimated: a class table's typical value. Estimates lean unfavourable.
 */
export type Basis = 'sourced' | 'derived' | 'calibrated' | 'estimated';

export type BodyClass = 'sports' | 'coupe' | 'sedan' | 'hatchback' | 'wagon' | 'suv' | 'offroad' | 'pickup' | 'van';
export type Drivetrain = 'FWD' | 'RWD' | 'AWD' | '4WD';
export type Powertrain = 'gasoline' | 'diesel' | 'hybrid' | 'plug-in-hybrid' | 'electric';
export type Induction = 'natural' | 'turbo' | 'twin-turbo' | 'quad-turbo' | 'supercharged' | 'twincharged';
export type TransmissionType = 'manual' | 'automatic' | 'dual-clutch' | 'cvt' | 'ecvt' | 'single-speed';
export type EngineLocation = 'front' | 'mid' | 'rear';
export type TyreCategory = 'all-season' | 'summer' | 'max-performance' | 'track' | 'all-terrain' | 'winter' | 'drag';
export type SuspensionGrade = 'standard' | 'sport' | 'adaptive' | 'offroad';
export type BrakeGrade = 'standard' | 'performance' | 'carbon-ceramic';
export type DiffKind = 'open' | 'limited-slip' | 'locked' | 'active';
/** fixed: a centre differential with a set split. front-on-demand / rear-on-demand: the named axle is driven and a coupling sends torque to the other when it slips. part-time: locked front to rear when engaged. */
export type AwdKind = 'fixed' | 'front-on-demand' | 'rear-on-demand' | 'part-time';

/* ------------------------------------------------------------------ the sheet: figures in, published units */

type N = Sourced<number> | null;

/** Instrumented test results. Checks only: nothing here is ever an input to the model, except through calibration (types.Basis). */
export type SheetTests = {
  zeroToThirtySec: N; zeroToSixtySec: N; zeroToHundredSec: N;
  /** True when the tester's 0-60 leaves out the first foot of travel (Car and Driver and MotorTrend do). */
  rollout: Sourced<boolean> | null;
  quarterMileSec: N; quarterMileMph: N;
  braking60to0Ft: N; braking70to0Ft: N;
  skidpadG: N; skidpadDiameterFt: N;
  topSpeedMph: N;
  testWeightLb: N; testWeightDistFrontPct: N;
};

/** One exact configuration, in the units its sources publish. A field nobody has supplied is null and resolve.ts falls back to a class table. */
export type PhysicsSheet = {
  id: string;
  identity: { year: number; make: string; model: string; trim: string; bodyClass: BodyClass };

  curbWeightLb: N; weightDistFrontPct: N;
  wheelbaseIn: N; trackFrontIn: N; trackRearIn: N; lengthIn: N; widthIn: N; heightIn: N; groundClearanceIn: N; cgHeightIn: N;

  powertrain: Sourced<Powertrain> | null; induction: Sourced<Induction> | null; engineLocation: Sourced<EngineLocation> | null;
  displacementL: N; cylinders: N;
  horsepower: N; horsepowerRpm: N; torqueLbFt: N;
  /** The engine speed of peak torque, or the two ends of the plateau when the maker gives a range. */
  torqueRpmLow: N; torqueRpmHigh: N;
  redlineRpm: N; boostPsi: N; compressionRatio: N;
  /**
   * An authored full-throttle torque curve, [rpm, N m] pairs in rising rpm. Only the fictional rental cars have one
   * (their specs were drawn, not published); when present it is used as the curve and the peaks above are ignored.
   */
  torqueCurve: Sourced<[number, number][]> | null;

  drivetrain: Sourced<Drivetrain> | null; awdKind: Sourced<AwdKind> | null;
  transmissionType: Sourced<TransmissionType> | null;
  /** Forward ratios, first gear first. For a cvt or ecvt: the lowest and the highest ratio. */
  gearRatios: Sourced<number[]> | null;
  finalDriveRatio: N;
  diffFront: Sourced<DiffKind> | null; diffRear: Sourced<DiffKind> | null;

  /** Size as printed on the sidewall: "245/35ZR19". */
  tyreFront: Sourced<string> | null; tyreRear: Sourced<string> | null; tyreCategory: Sourced<TyreCategory> | null;

  dragCoefficient: N; frontalAreaSqFt: N; liftCoefficientFront: N; liftCoefficientRear: N;
  /** EPA dynamometer target coefficients from a coast-down: force (lbf) = A + B v + C v^2, v in mph. */
  roadLoadA: N; roadLoadB: N; roadLoadC: N;

  steeringRatio: N; turningCircleFt: N;
  suspensionGrade: Sourced<SuspensionGrade> | null; brakeGrade: Sourced<BrakeGrade> | null;

  topSpeedMph: N; topSpeedGoverned: Sourced<boolean> | null;
  abs: Sourced<boolean> | null; tractionControl: Sourced<boolean> | null; stabilityControl: Sourced<boolean> | null; launchControl: Sourced<boolean> | null;

  tests: SheetTests;

  /** The two things that may be fitted to a test (calibrate.ts writes them; their basis is 'calibrated'). */
  calibration: { tyreGripScale: number | null; dragAreaM2: number | null };
};

/* ------------------------------------------------------------------ the model: SI, resolved once */

export type TyreParams = {
  /** Loaded rolling radius, m. */
  radius: number;
  /** Section width, m. */
  width: number;
  /** Reference load, N: the load the friction and stiffness figures are quoted at. */
  fz0: number;
  /** Peak lateral friction coefficient at fz0 on dry asphalt, with the car's calibrated grip scale already in it. */
  muY0: number;
  /** Peak longitudinal friction over peak lateral friction. */
  muXRatio: number;
  /** Share of muY0 lost for each fz0 of load above fz0 (and gained below it): grip grows more slowly than load. */
  loadSens: number;
  /** Friction far past the peak, as a share of the peak. */
  slideRatio: number;
  /** How quickly friction falls from the peak toward slideRatio once the whole patch slides (q in DESIGN.md's g). */
  slideFall: number;
  /** Cornering stiffness at fz0, N/rad. */
  cAlpha0: number;
  /** The load at which cornering stiffness peaks, N. */
  fzStiffPeak: number;
  /** Longitudinal slip stiffness per unit of load, N per unit slip per N. */
  cKappaPerFz: number;
  /** Relaxation lengths, m: the distance rolled before force has built up. */
  relaxLat: number; relaxLong: number;
  /** Rolling resistance coefficient. */
  rollRes: number;
  /** Pneumatic trail at small slip, m. */
  trail0: number;
};

/** What the engine's tables were built from. A part changes these and the tables are rebuilt: see engine.ts. */
export type EngineAir = {
  /** Indicated torque per unit of charge density ratio at each table point, N m (displacement and breathing are inside it). */
  specific: Float64Array;
  /** Manifold absolute pressure over ambient at full boost, at each table point (1 everywhere when not boosted). */
  pressureRatio: Float64Array;
  /** Charge cooler effectiveness, 0 (none) to 1. */
  intercooler: number;
  /** Compressor efficiency, about 0.6 to 0.78. */
  compressorEff: number;
  /** Friction mean effective pressure, Pa = fmep[0] + fmep[1] x + fmep[2] x^2 with x in thousands of rpm. */
  fmep: [number, number, number];
  /** The most air the induction hardware can flow, kg/s (Infinity when it does not limit). */
  maxAirflow: number;
  /** The highest pressure ratio the fuel allows before timing has to come out. */
  knockLimitPr: number;
  /** Share of indicated torque taken to drive a supercharger at full boost (0 otherwise). */
  blowerDrive: number;
};

export type EngineKind = 'na' | 'turbo' | 'supercharged' | 'electric';

export type EngineModel = {
  kind: EngineKind;
  /** m^3; 0 for an electric motor. */
  displacement: number;
  cylinders: number;
  /** Engine with flywheel and clutch (or motor rotor), kg m^2. */
  inertia: number;
  /** rad/s. */
  idle: number;
  /** rad/s: where the limiter starts to cut. */
  redline: number;
  /** rad/s past redline over which full-throttle torque falls to nothing. */
  limiterBand: number;
  /** Table layout: n points, the first at 0 rad/s, dOmega apart. The last point is past redline + limiterBand. */
  n: number; dOmega: number;
  /** Brake torque at full throttle and full boost, N m. */
  wot: Float64Array;
  /** Brake torque at full throttle with no boost (the same as wot when the engine is not turbocharged). */
  offBoost: Float64Array;
  /** Drag torque with the throttle closed, N m, as a positive number. */
  friction: Float64Array;
  /** Turbo lag: null when boost is always there (none, or a supercharger). Times in s, speeds in rad/s. See engine.ts. */
  boost: { tauRef: number; omegaRef: number; tauMin: number; tauMax: number; fallTau: number } | null;
  /** Electric: the most regenerative torque on a lifted throttle, as a share of peak torque (0 for combustion). */
  regen: number;
  /** Null for an electric motor and for an authored torque curve. */
  air: EngineAir | null;
};

export type DiffModel = { kind: DiffKind; /** N m of locking torque always there. */ preload: number; /** Locking torque added per N m of torque through the differential. */ lockPerTorque: number };

export type DrivelineModel = {
  layout: 'FWD' | 'RWD' | 'AWD';
  transmission: TransmissionType;
  /** Forward ratios, first gear first. One entry for single-speed. For cvt and ecvt: [lowest, highest]. */
  gears: Float64Array;
  reverse: number;
  finalDrive: number;
  /** Share of torque that reaches the wheels: gearbox, final drive and any transfer case. */
  efficiency: number;
  /** Seconds from a shift request to full drive in the next gear. */
  shiftTime: number;
  /** Share of drive torque kept through a shift: 0 for a manual, about 0.9 for a dual-clutch. */
  shiftTorqueHold: number;
  /** What joins engine and gearbox when pulling away. direct: an electric motor, always joined. */
  launch: 'clutch' | 'converter' | 'direct';
  /** N m the clutch (or the converter's lock-up clutch) holds when fully closed. */
  clutchCapacity: number;
  /** Torque converter: stall speed rad/s at full throttle, torque multiplication at stall, the speed ratio where multiplication ends, the gear from which it locks. */
  converter: { stallOmega: number; torqueRatio: number; couplingRatio: number; lockGear: number } | null;
  /** CVT: how fast the ratio can change (ratio units per second). */
  cvtRatioRate: number;
  /** Centre: none (two-wheel drive), fixed (a centre differential: frontShare of torque to the front), coupling (frontShare is the driven-axle share at rest and up to lockTorque N m moves to the other axle when the axles' speeds differ). */
  centre: { kind: 'none' | 'fixed' | 'coupling'; frontShare: number; lockTorque: number };
  diffFront: DiffModel; diffRear: DiffModel;
};

export type ChassisModel = {
  /** kg, as driven: curb weight and a 75 kg driver. */
  mass: number;
  sprungMass: number;
  /** Unsprung mass of each axle (both wheels, hubs, brakes, part of the links), kg. */
  unsprungFront: number; unsprungRear: number;
  /** Centre of gravity to front axle, to rear axle; wheelbase; tracks. m. */
  a: number; b: number; wheelbase: number; trackFront: number; trackRear: number;
  /** Heights above the road, m: the whole car's centre of gravity, the sprung mass's, each axle's unsprung mass. */
  cgHeight: number; sprungCgHeight: number; unsprungHeightFront: number; unsprungHeightRear: number;
  /** kg m^2: yaw (whole car), roll and pitch (sprung mass). */
  izz: number; ixx: number; iyy: number;
  /** Wheel rate of one corner, N/m; damping of one corner, N s/m. */
  springFront: number; springRear: number; damperFront: number; damperRear: number;
  /** Anti-roll bars' roll stiffness, N m/rad. */
  arbFront: number; arbRear: number;
  rollCentreFront: number; rollCentreRear: number;
  /** Share of the pitching moment carried by the links at once, not through the springs: braking (front), driving (rear). 0 to 1. */
  antiDive: number; antiSquat: number;
  /** Steer angle of the front wheels at full lock, rad; turns of the steering wheel per radian at the road wheels. */
  maxSteer: number; steerRatio: number;
};

export type BrakeModel = {
  /** N m at ONE wheel at full pedal. */
  maxTorqueFront: number; maxTorqueRear: number;
  /** N m at one rear wheel at full handbrake. */
  handbrakeTorque: number;
};

export type AeroModel = {
  /** Cd x frontal area, m^2. */
  dragArea: number;
  /** Lift coefficient x frontal area at each axle, m^2. Positive lifts the car; negative is downforce. */
  liftAreaFront: number; liftAreaRear: number;
  /** Extra road load from a coast-down, N and N per m/s (0 when none is on file: the tyres' rolling resistance is then the only other loss). */
  roadLoadA: number; roadLoadB: number;
};

export type SystemsModel = {
  abs: boolean; tcs: boolean; esc: boolean; launchControl: boolean;
  /** m/s; Infinity when the car has no governor. */
  limiterSpeed: number;
};

export type NitrousModel = {
  /** W added while it flows. */
  power: number;
  /** kg of nitrous in a full bottle, and kg used per second while it flows. */
  bottleMass: number; flow: number;
};

export type VehicleModel = {
  id: string; name: string;
  chassis: ChassisModel;
  tyreFront: TyreParams; tyreRear: TyreParams;
  /** One wheel with its tyre, brake disc and share of the half-shaft, kg m^2. */
  wheelInertiaFront: number; wheelInertiaRear: number;
  engine: EngineModel;
  driveline: DrivelineModel;
  brakes: BrakeModel;
  aero: AeroModel;
  systems: SystemsModel;
  nitrous: NitrousModel | null;
};

/* ------------------------------------------------------------------ the world */

export type SurfaceSample = {
  /** Road height, m, and its slope along world X and Y (rise over run). */
  height: number; gradX: number; gradY: number;
  /** Multiplies tyre friction (1 on dry asphalt) and rolling resistance (1 on asphalt). */
  grip: number; rolling: number;
};
export type WorldQuery = { surfaceAt(x: number, y: number, out: SurfaceSample): void };

/* ------------------------------------------------------------------ controls, state, telemetry */

export type Controls = {
  /** -1 to 1 of full lock. +1 is full LEFT. */
  steer: number;
  /** 0 to 1. */
  throttle: number; brake: number; handbrake: number;
  /** 0 (joined) to 1 (pedal down). Used only when autoClutch is false. */
  clutch: number;
  /** The gear wanted: -1 reverse, 0 neutral, 1.. forward; or AUTO_GEAR to let the car's own shift logic choose. */
  gear: number;
  autoClutch: boolean;
  /** The car's own systems, each switchable. A system the model does not have stays off whatever is asked. */
  abs: boolean; tcs: boolean; esc: boolean;
  /** Hold the engine at the launch speed with the pedal down, standing still (the bench's launch and a driver's). rad/s; 0 for none. */
  launchOmega: number;
  nitrous: boolean;
};
/** Controls.gear value that leaves the choice to the car. */
export const AUTO_GEAR = 99;

export type VehicleState = {
  model: VehicleModel;
  /** Seconds simulated. */
  time: number;
  /** World position of the centre of gravity, m, and heading as a unit vector (cos, sin of yaw). */
  x: number; y: number; hx: number; hy: number;
  /** Body-frame velocity of the centre of gravity, m/s (u forward, v to the left), and yaw rate, rad/s (left positive). */
  u: number; v: number; r: number;
  /** Acceleration of the centre of gravity along body x and y, m/s^2, from the last substep (what an accelerometer reads, without gravity). */
  ax: number; ay: number;
  /** Sprung body: heave m (up positive, 0 at rest), pitch rad (nose DOWN positive), roll rad (right side DOWN positive), and their rates. */
  heave: number; pitch: number; roll: number; heaveRate: number; pitchRate: number; rollRate: number;
  /** Per wheel (length 4). */
  wheelOmega: Float64Array;      // rad/s, forward rolling positive
  wheelLoad: Float64Array;       // N
  wheelFx: Float64Array;         // N in the wheel's own frame, forward positive
  wheelFy: Float64Array;         // N in the wheel's own frame, left positive
  wheelMz: Float64Array;         // N m, aligning moment
  wheelDefX: Float64Array;       // m, the tyre's longitudinal deflection state
  wheelDefY: Float64Array;       // m, the tyre's lateral deflection state
  wheelSlipRatio: Float64Array;  // transient longitudinal slip (driving positive)
  wheelSlipTan: Float64Array;    // transient tangent of the slip angle (a force to the left positive)
  wheelSteer: Float64Array;      // rad, left positive
  wheelBrake: Float64Array;      // N m of brake torque being applied (after ABS)
  /** Engine and driveline. */
  engineOmega: number;           // rad/s
  /** 0 (none) to 1 (full): how much of the turbo's boost has built. */
  boost: number;
  /** Brake torque the engine made in the last substep, N m (negative on a closed throttle). */
  engineTorque: number;
  /** Torque through the clutch or converter in the last substep, N m at the engine side. */
  clutchTorque: number;
  /** 1 when the clutch (or lock-up) is not slipping. */
  clutchLocked: number;
  /** -1 reverse, 0 neutral, 1.. forward: the gear the box is in. */
  gear: number;
  /** The gear being shifted to, and the seconds left in the shift (0 when none). */
  gearNext: number; shiftTimer: number;
  /** The ratio in use right now, engine turns per turn of the final drive's input (what a CVT varies; a geared box's current ratio, 0 in neutral). */
  ratio: number;
  /** Systems acting in the last substep: 1 or 0. */
  absActive: Float64Array;       // length 4
  tcsActive: number; escActive: number; limiterActive: number;
  /** Controller memory for ABS (per wheel), TCS and ESC. */
  absHold: Float64Array;         // length 4
  tcsCut: number;
  /** N m of brake traction control holds on each driven wheel that spins past its partner on the axle. */
  tcsBrake: Float64Array;        // length 4
  /** kg of nitrous left. */
  nitrousLeft: number;
  /** m driven, kg of fuel (or J of battery energy for an electric car) used. */
  distance: number; energyUsed: number;
};

export type Telemetry = {
  /** m/s along the body, and the size of the velocity. */
  speed: number; u: number; v: number;
  /** g. */
  accelLong: number; accelLat: number;
  yawRate: number; sideslip: number;
  roll: number; pitch: number; heave: number;
  rpm: number; gear: number; boost: number; throttleTorque: number;
  clutchSlip: number; shifting: boolean;
  wheelLoad: Float64Array; wheelSlipRatio: Float64Array; wheelSlipAngle: Float64Array; wheelSpeed: Float64Array;
  /** 0 to 1 and beyond: how much of each tyre's grip is in use (1 is the peak, past 1 it slides). */
  wheelUse: Float64Array;
  absActive: boolean; tcsActive: boolean; escActive: boolean; limiterActive: boolean;
  nitrousLeft: number;
};

/* ------------------------------------------------------------------ the bench */

export type Timeslip = {
  /** Seconds from the first movement out of the stage beam (after the one-foot rollout). */
  sixtyFoot: number; threeThirty: number; eighth: number; thousand: number; quarter: number;
  /** mph. The trap speed is the average over the last 66 ft. */
  eighthMph: number; trapMph: number;
};

export type BenchResult = {
  /** Seconds from the instant the car first moves. */
  zeroToThirty: number; zeroToSixty: number; zeroToHundred: number;
  /** The same 0-60 with the first foot left out, as the magazines time it. */
  zeroToSixtyRollout: number;
  timeslip: Timeslip;
  /** What the launch driver settled on. */
  launchRpm: number; shiftRpm: number;
  /** ft. */
  braking60: number; braking70: number;
  /** g on a 300 ft and on a 200 ft circle. */
  skidpad300: number; skidpad200: number;
  /** mph, and whether the limiter set it. */
  topSpeed: number; topSpeedGoverned: boolean;
  /** Peak power (hp) and torque (lb ft) at the crank and the rpm of each, read off the model's own full-throttle curve. */
  peakHp: number; peakHpRpm: number; peakTorqueLbFt: number; peakTorqueRpm: number;
};

/** Which parts of the bench to run: the whole of it takes a few hundred milliseconds a car. */
export type BenchTest = 'accel' | 'brake' | 'skidpad' | 'topSpeed' | 'dyno' | 'all';

/* ------------------------------------------------------------------ builds (parts and setup): filled in by parts.ts */

/** A part fitted to the car: an id from the catalogue and, where the part has a size, its value in the part's own unit. */
export type FittedPart = { id: string; value?: number };
/** Adjustments within what the fitted parts allow. Every field is optional: a missing one keeps the car's own value. */
export type Setup = {
  /** Front and rear anti-roll bar stiffness, springs and dampers as multiples of the car's own. */
  arbFront?: number; arbRear?: number; springFront?: number; springRear?: number; damperFront?: number; damperRear?: number;
  /** m lower than standard (negative raises it). */
  rideHeightDrop?: number;
  /** Share of brake torque sent to the front, 0 to 1. */
  brakeBias?: number;
  /** Final drive as a multiple of the car's own. */
  finalDrive?: number;
  /** Lift area added at each axle, m^2 (negative is downforce), within what the aero parts fitted allow. */
  aeroFront?: number; aeroRear?: number;
  /** Tyre pressure as a multiple of the recommended one, front and rear. */
  pressureFront?: number; pressureRear?: number;
  /** Degrees of negative camber front and rear. */
  camberFront?: number; camberRear?: number;
  /** Locking of a limited-slip differential as a multiple of the part's own. */
  diffLock?: number;
};
export type Build = { parts: readonly FittedPart[]; setup: Setup };
