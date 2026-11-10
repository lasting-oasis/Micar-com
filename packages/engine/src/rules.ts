// Ruleset v1: every number the scoring uses, in one place, so the formulas can be read, checked and changed without
// touching the code that applies them. README.md explains each table in words.
//
// How a score is made. Each attribute reads one quantity (a "metric") from the specification and looks it up in a table
// of anchors: straight lines between the points, flat beyond the ends. The same tables serve every vehicle.
//
// The calibration vehicle. The tables are pinned so that the reference specification of the 2024 Nissan GT-R NISMO
// scores exactly the example the product brief gave: POWER 950, SPEED 920, ACCELERATION 880, HANDLING 880,
// DURABILITY 650, RELIABILITY 700, EFFICIENCY 500, Power Rating 783. Those seven numbers were given as illustrative
// placeholders; the tables make them the fixed point everything else is measured against.
import type { AttributeKey, BodyClass, BrakeGrade, Drivetrain, Induction, SuspensionGrade, TransmissionType } from './types';
import type { Anchor } from './util';

export const RULESET = 'micar-rules-v1';

/** POWER reads an output index, not horsepower alone: 70% horsepower, 30% torque (lb-ft). */
export const POWER = {
  horsepowerWeight: 0.7,
  torqueWeight: 0.3,
  anchors: [
    [0, 0], [50, 120], [100, 270], [150, 400], [200, 500], [250, 580], [300, 650], [400, 770],
    [500, 890], [564.3, 950], [700, 970], [1000, 990], [1500, 1000],
  ] as readonly Anchor[],
};

/** SPEED reads top speed in mph. */
export const SPEED = {
  anchors: [
    [0, 0], [60, 80], [90, 250], [105, 380], [115, 460], [125, 540], [135, 610], [145, 680],
    [155, 750], [170, 820], [186, 885], [196, 920], [205, 935], [220, 955], [250, 985], [280, 1000],
  ] as readonly Anchor[],
  /**
   * When no top speed is on file it is estimated as the speed at which the engine's power equals drag plus rolling
   * resistance, then capped at the limiter usual for the class. An estimate is always marked as one.
   */
  estimate: {
    airDensity: 1.225,
    rollingResistance: 0.012,
    drivelineEfficiency: 0.85,
    /** Drag area (Cd x frontal area, m2) typical of each class. */
    dragArea: { sports: 0.58, coupe: 0.6, sedan: 0.62, hatchback: 0.64, wagon: 0.66, suv: 0.84, offroad: 1.05, pickup: 1.15, van: 0.95 } as Record<BodyClass, number>,
    /** The electronic limit usual for the class, mph. */
    limiter: { sports: 400, coupe: 155, sedan: 130, hatchback: 125, wagon: 130, suv: 125, offroad: 110, pickup: 110, van: 115 } as Record<BodyClass, number>,
    /** At or above this many horsepower per pound a car is treated as a performance model and limited at performanceLimiter instead. */
    performanceRatio: 0.085,
    performanceLimiter: 155,
  },
};

/** ACCELERATION reads the 0-60 mph time in seconds: less is better. */
export const ACCELERATION = {
  anchors: [
    [1.8, 1000], [2.2, 960], [2.5, 925], [2.9, 880], [3.5, 820], [4, 775], [4.5, 735], [5, 700], [5.5, 660],
    [6, 625], [6.5, 590], [7, 555], [7.5, 520], [8, 485], [8.5, 450], [9, 415], [10, 350], [11, 290],
    [12, 240], [14, 160], [16, 100], [20, 30], [25, 0],
  ] as readonly Anchor[],
  /** When no 0-60 time is on file: seconds = k x (pounds per horsepower) ^ exponent x drivetrain factor (x electric factor), never below the floor. */
  estimate: {
    k: 0.9,
    exponent: 0.75,
    drivetrain: { AWD: 0.9, '4WD': 0.97, RWD: 1, FWD: 1.03 } as Record<Drivetrain, number>,
    electric: 0.9,
    floor: 1.9,
  },
};

/**
 * HANDLING reads a grip index in g: the measured skidpad figure when one is on file, otherwise a figure modelled
 * from the class and the configuration, plus a small control term for the drivetrain and the brakes in both cases.
 */
export const HANDLING = {
  anchors: [
    [0.5, 0], [0.6, 120], [0.7, 280], [0.75, 370], [0.8, 460], [0.85, 550], [0.9, 640], [0.95, 720],
    [1, 800], [1.05, 880], [1.1, 920], [1.2, 965], [1.3, 1000],
  ] as readonly Anchor[],
  model: {
    /** Lateral grip typical of each class, g. */
    classGrip: { sports: 0.95, coupe: 0.9, hatchback: 0.86, sedan: 0.85, wagon: 0.84, suv: 0.8, van: 0.77, pickup: 0.75, offroad: 0.72 } as Record<BodyClass, number>,
    /** Curb weight typical of each class, lb. Lighter than this helps, heavier hurts. */
    referenceWeightLb: { sports: 3300, coupe: 3500, hatchback: 2900, sedan: 3300, wagon: 3600, suv: 3900, van: 4400, pickup: 4800, offroad: 4600 } as Record<BodyClass, number>,
    gripPerLb: -0.00002,
    weightLimit: 0.03,
    suspension: { standard: 0, sport: 0.03, adaptive: 0.04, offroad: -0.03 } as Record<SuspensionGrade, number>,
  },
  control: {
    drivetrain: { AWD: 0.01, RWD: 0.005, FWD: 0, '4WD': 0 } as Record<Drivetrain, number>,
    brakes: { standard: 0, performance: 0.01, 'carbon-ceramic': 0.02 } as Record<BrakeGrade, number>,
  },
};

/**
 * DURABILITY is a modelled index in points (0-1000): resistance to wear and physical damage, from how the vehicle is built.
 * It is not a survey of failures. Points = class + frame + mass + drivetrain + clearance - engine stress.
 */
export const DURABILITY = {
  classBase: { sports: 634, coupe: 630, hatchback: 620, sedan: 640, wagon: 650, van: 660, suv: 690, pickup: 720, offroad: 740 } as Record<BodyClass, number>,
  bodyOnFrame: 60,
  /** Points per pound of curb weight above the pivot, within the limits. */
  mass: { pivotLb: 3000, perLb: 0.04, min: -40, max: 100 },
  drivetrain: { '4WD': 30, AWD: 15, RWD: 0, FWD: 0 } as Record<Drivetrain, number>,
  /** Points per inch of ground clearance above the pivot, up to the limit. */
  clearance: { pivotIn: 6, perIn: 8, max: 40 },
  /** Points lost per horsepower-per-litre above the pivot (combustion engines only), up to the limit. */
  stress: { pivotHpPerL: 90, perHpPerL: 0.5, max: 80 },
};

/**
 * RELIABILITY is a modelled index in points (0-1000): mechanical dependability as the design implies it, from how
 * complicated and how highly stressed the powertrain is and how long the maker warrants it. It is not a survey of
 * failures, and it knows nothing of a brand's reputation.
 */
export const RELIABILITY = {
  base: 835,
  induction: { natural: 40, turbo: -30, 'twin-turbo': -60, 'quad-turbo': -100, supercharged: -40, twincharged: -80 } as Record<Induction, number>,
  electricPowertrain: 60,
  plugInHybrid: -20,
  transmission: { manual: 20, automatic: 0, 'dual-clutch': -30, cvt: -20, ecvt: 20, 'single-speed': 30 } as Record<TransmissionType, number>,
  drivetrain: { FWD: 0, RWD: 0, AWD: -10, '4WD': -10 } as Record<Drivetrain, number>,
  /** Points lost per horsepower-per-litre above the pivot (combustion engines only), up to the limit. */
  stress: { pivotHpPerL: 100, perHpPerL: 0.6, max: 90 },
  /** More than this many cylinders costs points. */
  manyCylinders: { above: 8, points: -30 },
  /** Points per 1,000 warranted powertrain miles above the pivot, within the limits. */
  warranty: { pivotMiles: 60000, perThousandMiles: 0.75, min: -15, max: 30 },
};

/** EFFICIENCY reads EPA combined fuel economy: MPG, or MPGe for an electric powertrain. */
export const EFFICIENCY = {
  anchors: [
    [0, 0], [10, 250], [14, 400], [18, 500], [22, 560], [26, 610], [30, 660], [35, 720], [40, 770],
    [50, 840], [57, 880], [75, 920], [100, 950], [130, 985], [150, 1000],
  ] as readonly Anchor[],
};

/** The Power Rating: the weighted mean of the seven attributes. Ruleset v1 weighs them equally. */
export const POWER_RATING_WEIGHTS: Record<AttributeKey, number> = {
  power: 1 / 7, speed: 1 / 7, acceleration: 1 / 7, handling: 1 / 7, durability: 1 / 7, reliability: 1 / 7, efficiency: 1 / 7,
};

/** What an owner may type for each numeric field. A value outside its range is refused, not clipped. */
export const SPEC_RANGES = {
  displacementL: [0.2, 20],
  cylinders: [0, 16],
  horsepower: [10, 3000],
  torqueLbFt: [10, 3000],
  curbWeightLb: [500, 15000],
  zeroToSixtySec: [1, 60],
  topSpeedMph: [20, 350],
  combinedMpg: [1, 250],
  cityMpg: [1, 250],
  highwayMpg: [1, 250],
  evRangeMiles: [1, 1000],
  lateralGripG: [0.3, 2],
  braking60to0Ft: [50, 400],
  braking70to0Ft: [70, 500],
  groundClearanceIn: [1, 30],
  warrantyPowertrainMiles: [0, 1000000],
  warrantyPowertrainYears: [0, 30],
  productionUnits: [1, 50000000],
} as const;
export type NumericSpecField = keyof typeof SPEC_RANGES;
