// Parts and builds (DESIGN.md section 11). One catalogue, in physical units, for the world's Garage and (through each
// part's place in the card engine's modification table) for the card. A part changes a pressure, a flow, a mass, a
// stiffness or a friction, never a percentage of performance: what that is worth on the car it is fitted to is the
// bench's to say.
//
// resolveModel(sheet, build) resolves the stock car (resolve.ts resolveStock) and hands it to fitBuild here, which:
//  1. decides which of the build's parts go on by walking the catalogue in its fixed order, never the order they were
//     bought in: a part the car cannot take, a second part where only one fits, or a part whose prerequisite is not
//     fitted is refused, with the reason (the catalogue is ordered so that a prerequisite always comes first);
//  2. lets each part change the model's pieces, rebuilding the engine's tables after an engine part and re-deriving
//     the mass split, centre-of-gravity height and inertias after a part that moves mass. Both are pure functions of
//     what they read, so doing them after each part gives the same bits as doing them once, and lets describeBuild
//     read every part's effect as it goes;
//  3. applies the build's setup (resolve.ts applySetup for the plain changes; here, what only a part gives meaning to),
//     then rebuilds and re-derives again.
// fits says whether a part goes on a car with a given build and, if not, why; describeBuild says what each part
// changed, in words and numbers; legacyBuild maps the Garage's nine three-tier parts and eight sliders onto all this.
//
// Every figure in the catalogue is an estimate until the parts exam (data/exam) says otherwise: a parameter a part
// changes is marked 'estimated'. Nothing here runs inside the step, so it may allocate; it keeps to rule 3's
// arithmetic all the same, so a build resolves to the same bits on every machine.
import type {
  Basis, Build, ChassisModel, DiffModel, DrivelineModel, EngineAir, EngineModel, FittedPart, PhysicsSheet, Setup,
  TransmissionType, TyreCategory, VehicleModel,
} from './types';
import type { Gyration, ResolvedTyres, StockCar } from './resolve';
import type { TyreSize } from './units';
import { AIR_ENERGY, enginePeaks, rebuildTables } from './engine';
import { rollGradient } from './chassis';
import { DRIVER_MASS, TYRE_CATEGORY, tyreGripScaleRange, wheelInertia, wheelMass } from './classes';
import { G, P_AMBIENT, PI, dpow } from './math';
import { HP, LBFT, PSI, RPM } from './units';
import { applySetup, chassisGyration, coastDown, derivedBasis, resolveBrakes, resolveStock, setInertias, tyreParams } from './resolve';

/* ------------------------------------------------------------------ the catalogue's shape */

/** The card engine's modification categories (@micar/engine ModCategory), by name: this package imports nothing. */
export type CardCategory =
  | 'engine' | 'ecu' | 'intake-exhaust' | 'turbo' | 'supercharger' | 'nitrous' | 'transmission' | 'suspension'
  | 'tires' | 'brakes' | 'weight' | 'aero' | 'offroad' | 'eco';

/** Where a part sits in the card engine's modification table: its category and tier (1 Street, 2 Pro, 3 Extreme). */
export type PartCard = Readonly<{ category: CardCategory; tier: 1 | 2 | 3 }>;

/** The slots of DESIGN.md 11's table. */
export type PartSlot =
  | 'induction' | 'intake' | 'exhaust' | 'cams' | 'internals' | 'intercooler' | 'fuel' | 'tune' | 'flywheel' | 'nitrous'
  | 'clutch' | 'gearbox' | 'differential' | 'tyres' | 'wheels' | 'springs' | 'anti-roll bars' | 'weight' | 'brakes' | 'aero';

/** A part's family: what it does to the car (each family's step 1, 2, 3 does more of it). */
export type PartKind =
  | 'turbo-kit' | 'supercharger-kit' | 'turbo-upgrade' | 'intake' | 'exhaust' | 'cams' | 'internals' | 'intercooler'
  | 'fuel' | 'tune' | 'flywheel' | 'nitrous' | 'clutch' | 'shifter' | 'gearbox' | 'lsd' | 'tyres' | 'tyres-wide'
  | 'wheels-light' | 'springs' | 'arb' | 'weight' | 'brakes' | 'aero-front' | 'aero-rear';

/** One part of the catalogue. */
export type PartDef = Readonly<{
  id: string;
  slot: PartSlot;
  /** English name for the Garage: "Turbo kit, 9 psi". */
  name: string;
  /** What it changes, physically, in words (DESIGN.md 11's table). */
  changes: string;
  /** What it costs, in words. */
  cost: string;
  /** Mass it adds, kg (negative: takes off). weight-1/2/3 take a share of the car's own curb weight instead (0 here). */
  massKg: number;
  card: PartCard;
  /** Parts with the same place exclude one another: only one goes there. Null: it combines with any other part. */
  place: string | null;
  kind: PartKind;
  /** Its step in its family: 1, 2 or 3. */
  step: number;
  /** A tyre part's category; null for every other part. */
  tyre: TyreCategory | null;
}>;

/* ------------------------------------------------------------------ the catalogue's figures (DESIGN.md 11) */

// Each is DESIGN.md 11's figure unless its comment says otherwise. x in a breathing curve is engine speed over the
// stock redline (the car's own, before any part moved it), so a part's curve does not depend on what else is fitted.

/** intake-1: the induction flows 10% more air, and breathing gains (1 + 0.012 x^2): most at the top, where the stock box chokes. */
const INTAKE = Object.freeze({ airflow: 1.10, breathing: 0.012 });
/**
 * exhaust-1 (cat-back), exhaust-2 (headers or downpipe and high-flow cats): breathing gains (1 + k x^2). Headers also
 * flow 12% more, and on a turbo engine let the turbine spin up 12% sooner and run cooler, worth 0.1 of pressure ratio
 * before knock. Both take mass off: a stainless cat-back is about 3 kg lighter, long-tube headers and cats 8 kg.
 */
const EXHAUST = Object.freeze({ breathing: [0.015, 0.035], airflow: 1.12, lag: 0.88, knock: 0.1, kg: [-3, -8] });
/**
 * tune-1/2/3. Unboosted: breathing (timing and fuel) x1.025, x1.035, x1.04 and redline +150, +250, +300 rpm. Boosted:
 * the full-boost pressure ratio raised by 0.22, 0.38, 0.55 of an atmosphere above the stock peak, held to the power
 * peak, always held by the knock limit and the airflow limit.
 */
const TUNE = Object.freeze({ specific: [1.025, 1.035, 1.04], redlineRpm: [150, 250, 300], boost: [0.22, 0.38, 0.55] });
/** fuel-1 (E85 or race fuel): knock limit from pump fuel's 2.6 to 3.3, breathing x1.02 (more timing, a cooler charge). */
const FUEL = Object.freeze({ knockLimitPr: 3.3, specific: 1.02 });
/** intercooler-1: charge cooler effectiveness to 0.85, and 4 kg at the front. */
const INTERCOOLER = Object.freeze({ effectiveness: 0.85, kg: 4 });
/**
 * Induction kits on an unboosted engine: gauge boost, psi (turbo-kit-1/2/3: 6, 9, 13; supercharger-kit-1/2/3: 6, 9,
 * 12); the kit's own intercooler (0.7), compressor (0.72) and a blower's drive (0.12 of indicated torque at full boost).
 * Mass on the engine: 22 to 35 kg (DESIGN.md gives the range; the steps between are this file's).
 */
const KIT = Object.freeze({
  turboPsi: [6, 9, 13], superchargerPsi: [6, 9, 12], intercooler: 0.7, compressorEff: 0.72, blowerDrive: 0.12, kg: [22, 28, 35],
});
/**
 * A turbo kit's turbo is sized for the top end of an engine that was never meant to be boosted, so it reaches full
 * boost at about half the stock redline (factory turbo engines, with small twin-scroll turbos, by about 0.3 of it).
 * It starts to build boost at 0.45 of that speed, engine.ts's figure for every turbo.
 */
const KIT_FULL_BOOST_SHARE = 0.5;
const KIT_THRESHOLD_SHARE = 0.45;
/**
 * A kit's compressor (or blower) is matched to hold its boost to the stock redline, with this much flow in hand: less
 * than a factory turbo's 30% (engine.ts AIRFLOW_MARGIN), because a kit is sold for its rated boost, not built to be
 * tuned past it. The airflow limit is what stops a tune on a kit from adding much.
 */
const KIT_FLOW_MARGIN = 1.1;
/** A crank-driven blower already makes this share of its boost at idle (engine.ts's figure), the rest by the stock torque peak. */
const SUPERCHARGER_IDLE_SHARE = 0.6;
/** Turbo lag of a kit's turbo: DESIGN.md 5.1's starting figures (engine.ts uses them for every factory turbo). */
const KIT_LAG = Object.freeze({ tauRef: 0.45, omegaRefRpm: 3000, tauMin: 0.12, tauMax: 1.6, fallTau: 0.15 });
/**
 * turbo-upgrade-1/2 on a factory turbo engine: a bigger compressor flows 35%, 80% more, spools 25%, 60% more slowly and
 * starts to build boost 10%, 22% higher. The housing and its piping add a few kg on the engine (this file's figure).
 */
const UPGRADE = Object.freeze({ airflow: [1.35, 1.8], lag: [1.25, 1.6], threshold: [1.10, 1.22], kg: [3, 6] });
/** cams-1/2: breathing x(0.95 + 0.11 x), x(0.90 + 0.20 x): low-speed torque traded for top end; redline +400, +800 rpm; idle +100, +250 rpm. */
const CAMS = Object.freeze({ base: [0.95, 0.90], slope: [0.11, 0.20], redlineRpm: [400, 800], idleRpm: [100, 250] });
/** internals-1: forged pistons and rods let the engine rev 300 rpm higher. */
const INTERNALS_REDLINE_RPM = 300;
/** flywheel-1: engine inertia x0.7. */
const FLYWHEEL = 0.7;
/**
 * nitrous-1/2/3: a 50, 100, 150 hp shot from a 4.5 kg (10 lb) bottle, using 0.36 kg per 100 hp per 10 s (a 100 hp shot
 * empties the bottle in about two minutes of full throttle). The system with a full bottle is 16 kg in the tail.
 */
const NITROUS = Object.freeze({ hp: [50, 100, 150], bottleKg: 4.5, kgPerHpSecond: 0.36 / 100 / 10, kg: 16 });
/** clutch-1/2: clutch capacity x1.5, x2.2. */
const CLUTCH = Object.freeze([1.5, 2.2]);
/** shifter-1 on a manual: shift time x0.75. gearbox-2: a sequential or dual-clutch conversion, 0.08 s and half the drive held through a shift, 10 kg. */
const SHIFTER = 0.75;
const GEARBOX2 = Object.freeze({ shiftTime: 0.08, hold: 0.5, kg: 10 });
/** lsd-1 street, lsd-2 race, on the driven axles: preload, N m, and locking torque per N m through the differential. */
const LSD = Object.freeze({ preload: [60, 150], lockPerTorque: [0.25, 0.5] });
/** tyres-wide-1: 20 mm more section width on both axles. */
const WIDE_M = 0.020;
/** wheels-light-1: 3 kg less unsprung mass at each corner, and wheel inertia x0.85. */
const LIGHT_WHEEL = Object.freeze({ kgPerCorner: 3, inertia: 0.85 });
/**
 * springs-1/2/3 (sport, coilovers, race coilovers): ride frequency x1.2, x1.45, x1.75 (spring rate goes with its
 * square), damping ratio +0.06, +0.12, +0.18 and ride height 25, 40, 55 mm lower, the centre of gravity with it.
 */
const SPRINGS = Object.freeze({ frequency: [1.2, 1.45, 1.75], damping: [0.06, 0.12, 0.18], drop: [0.025, 0.040, 0.055] });
/** arb-1, arb-2: both anti-roll bars x1.3 (arb-2's are adjustable, x0.7 to x1.9 of the car's own). */
const ARB = 1.3;
/** weight-1/2/3: curb weight -3%, -7%, -12% from the sprung body, the rear a little more: front share +0.3, +0.7, +1.2 points. */
const WEIGHT = Object.freeze({ share: [0.03, 0.07, 0.12], frontPoints: [0.003, 0.007, 0.012] });
/** brakes-1/2/3: brake torque capacity x1.15, x1.4, x1.6; the big brake kits weigh 2 and 3 kg more at each front corner. */
const BRAKES = Object.freeze({ torque: [1.15, 1.4, 1.6], kgPerFrontCorner: [0, 2, 3] });
/**
 * aero-front-1/2 (splitter): front lift area -0.10, -0.22 m^2 with drag area +0.012, +0.03; aero-rear-1/2 (wing): rear
 * -0.18, -0.40 with +0.03, +0.07. Mass 3 to 8 kg (DESIGN.md's range; the steps are this file's): 3 and 5 kg at the
 * nose, 6 and 8 kg at the tail.
 */
const AERO = Object.freeze({
  frontLift: [-0.10, -0.22], frontDrag: [0.012, 0.03], frontKg: [3, 5],
  rearLift: [-0.18, -0.40], rearDrag: [0.03, 0.07], rearKg: [6, 8],
});
/**
 * Downforce set up with no aero part to make it (the Garage's aero slider on a car without one): a modest lip and
 * wing, -0.06 m^2 front and -0.12 rear for +0.02 m^2 of drag at most, so drag in proportion: 1/9 m^2 for each m^2.
 */
const MODEST_AERO = Object.freeze({ front: -0.06, rear: -0.12, drag: 0.02 });
const MODEST_DRAG_PER_LIFT = MODEST_AERO.drag / -(MODEST_AERO.front + MODEST_AERO.rear);
/** (gamma - 1) / gamma for air: the exponent of a compressor's temperature rise (engine.ts's). */
const ISENTROPIC = 0.286;
const DEG = PI / 180;

/* ------------------------------------------------------------------ the catalogue */

function part(
  id: string, kind: PartKind, step: number, slot: PartSlot, name: string, changes: string, cost: string, massKg: number,
  category: CardCategory, tier: 1 | 2 | 3, place: string | null, tyre: TyreCategory | null = null,
): PartDef {
  return Object.freeze({ id, kind, step, slot, name, changes, cost, massKg, card: Object.freeze({ category, tier }), place, tyre });
}

const KIT_WORDS = 'the engine becomes boosted: a pressure-ratio table, intercooler 0.7, compressor efficiency 0.72, maxAirflow sized to the kit';
const TYRE_WORDS = 'the whole tyre category (DESIGN.md 7), keeping the car\'s grip scale in proportion; the brakes sized again for it';

/**
 * The catalogue, in its fixed order: the order parts are fitted in, whatever order they were bought in. A part's
 * prerequisite always comes before it (an induction kit before the intercooler and the tune that read whether the
 * engine is boosted; intake and exhaust before the tune that needs them), and the parts that multiply the same figure
 * commute, so the order decides only who wins a place both want.
 */
export const PARTS: readonly PartDef[] = Object.freeze([
  part('turbo-kit-1', 'turbo-kit', 1, 'induction', 'Turbo kit, 6 psi', `${KIT_WORDS}, with turbo lag`, '+22 kg on the engine; lag; heat; reliability and durability on the card', KIT.kg[0], 'turbo', 1, 'induction'),
  part('turbo-kit-2', 'turbo-kit', 2, 'induction', 'Turbo kit, 9 psi', `${KIT_WORDS}, with turbo lag`, '+28 kg on the engine; lag; heat; reliability and durability on the card', KIT.kg[1], 'turbo', 2, 'induction'),
  part('turbo-kit-3', 'turbo-kit', 3, 'induction', 'Turbo kit, 13 psi', `${KIT_WORDS}, with turbo lag`, '+35 kg on the engine; lag; heat; reliability and durability on the card', KIT.kg[2], 'turbo', 3, 'induction'),
  part('supercharger-kit-1', 'supercharger-kit', 1, 'induction', 'Supercharger kit, 6 psi', `${KIT_WORDS}; boost from idle, growing with speed; the blower takes 12% of indicated torque at full boost`, '+22 kg on the engine; the blower\'s drive; heat; reliability and durability on the card', KIT.kg[0], 'supercharger', 1, 'induction'),
  part('supercharger-kit-2', 'supercharger-kit', 2, 'induction', 'Supercharger kit, 9 psi', `${KIT_WORDS}; boost from idle, growing with speed; the blower takes 12% of indicated torque at full boost`, '+28 kg on the engine; the blower\'s drive; heat; reliability and durability on the card', KIT.kg[1], 'supercharger', 2, 'induction'),
  part('supercharger-kit-3', 'supercharger-kit', 3, 'induction', 'Supercharger kit, 12 psi', `${KIT_WORDS}; boost from idle, growing with speed; the blower takes 12% of indicated torque at full boost`, '+35 kg on the engine; the blower\'s drive; heat; reliability and durability on the card', KIT.kg[2], 'supercharger', 3, 'induction'),
  part('turbo-upgrade-1', 'turbo-upgrade', 1, 'induction', 'Turbo upgrade', 'maxAirflow x1.35; spool time x1.25; boost starts 10% higher in engine speed', '+3 kg; more lag; needs a tune to use the flow', UPGRADE.kg[0], 'turbo', 2, 'induction'),
  part('turbo-upgrade-2', 'turbo-upgrade', 2, 'induction', 'Big turbo upgrade', 'maxAirflow x1.8; spool time x1.6; boost starts 22% higher in engine speed', '+6 kg; much more lag; needs a tune to use the flow', UPGRADE.kg[1], 'turbo', 3, 'induction'),
  part('intake-1', 'intake', 1, 'intake', 'Cold-air intake', 'maxAirflow x1.10; breathing x(1 + 0.012 x^2), x = engine speed over the stock redline', 'none worth modelling', 0, 'intake-exhaust', 1, null),
  part('exhaust-1', 'exhaust', 1, 'exhaust', 'Cat-back exhaust', 'breathing x(1 + 0.015 x^2)', '-3 kg', EXHAUST.kg[0], 'intake-exhaust', 1, null),
  part('exhaust-2', 'exhaust', 2, 'exhaust', 'Headers or downpipe and high-flow cats', 'breathing x(1 + 0.035 x^2), maxAirflow x1.12; on a turbo engine spool time x0.88 and knock limit +0.1', '-8 kg', EXHAUST.kg[1], 'intake-exhaust', 2, null),
  part('cams-1', 'cams', 1, 'cams', 'Street cams', 'breathing x(0.95 + 0.11 x); redline +400 rpm; idle +100 rpm', 'low-speed torque lost', 0, 'engine', 1, 'cams'),
  part('cams-2', 'cams', 2, 'cams', 'Race cams', 'breathing x(0.90 + 0.20 x); redline +800 rpm; idle +250 rpm', 'more low-speed torque lost', 0, 'engine', 2, 'cams'),
  part('internals-1', 'internals', 1, 'internals', 'Forged internals', 'redline +300 rpm; raises the torque the card engine treats as safe', 'none on the road', 0, 'engine', 3, null),
  part('intercooler-1', 'intercooler', 1, 'intercooler', 'Front-mount intercooler', 'charge cooler effectiveness to 0.85', '+4 kg at the front', INTERCOOLER.kg, 'intake-exhaust', 1, null),
  part('fuel-1', 'fuel', 1, 'fuel', 'E85 or race fuel', 'knock limit from 2.6 to 3.3 pressure ratio; breathing x1.02', 'fuel flow x1.3 for the same power', 0, 'ecu', 1, null),
  part('tune-1', 'tune', 1, 'tune', 'Stage 1 tune', 'unboosted: breathing x1.025, redline +150 rpm; boosted: full-boost pressure ratio +0.22', 'less margin: reliability on the card', 0, 'ecu', 1, 'tune'),
  part('tune-2', 'tune', 2, 'tune', 'Stage 2 tune', 'unboosted: breathing x1.035, redline +250 rpm (needs intake and exhaust); boosted: pressure ratio +0.38 (needs exhaust-2)', 'less margin: reliability on the card', 0, 'ecu', 2, 'tune'),
  part('tune-3', 'tune', 3, 'tune', 'Stage 3 tune', 'unboosted: breathing x1.04, redline +300 rpm (needs intake and exhaust); boosted: pressure ratio +0.55 (needs intercooler-1 and fuel-1)', 'less margin: reliability on the card', 0, 'ecu', 3, 'tune'),
  part('flywheel-1', 'flywheel', 1, 'flywheel', 'Lightweight flywheel', 'engine inertia x0.7', 'none worth modelling', 0, 'transmission', 1, null),
  part('nitrous-1', 'nitrous', 1, 'nitrous', 'Nitrous, 50 hp', '50 hp while it flows; 4.5 kg bottle at 0.36 kg per 100 hp per 10 s', '+16 kg in the tail; the bottle empties', NITROUS.kg, 'nitrous', 1, 'nitrous'),
  part('nitrous-2', 'nitrous', 2, 'nitrous', 'Nitrous, 100 hp', '100 hp while it flows; 4.5 kg bottle at 0.36 kg per 100 hp per 10 s', '+16 kg in the tail; the bottle empties', NITROUS.kg, 'nitrous', 2, 'nitrous'),
  part('nitrous-3', 'nitrous', 3, 'nitrous', 'Nitrous, 150 hp', '150 hp while it flows; 4.5 kg bottle at 0.36 kg per 100 hp per 10 s', '+16 kg in the tail; the bottle empties', NITROUS.kg, 'nitrous', 3, 'nitrous'),
  part('clutch-1', 'clutch', 1, 'clutch', 'Uprated clutch', 'clutch capacity x1.5', 'none worth modelling', 0, 'transmission', 1, 'clutch'),
  part('clutch-2', 'clutch', 2, 'clutch', 'Twin-plate clutch', 'clutch capacity x2.2', 'none worth modelling', 0, 'transmission', 2, 'clutch'),
  part('shifter-1', 'shifter', 1, 'gearbox', 'Short shifter', 'a manual\'s shift time x0.75', 'none worth modelling', 0, 'transmission', 1, null),
  part('gearbox-1', 'gearbox', 1, 'gearbox', 'Close-ratio gear set', 'ratios respaced evenly between the stock first and top', 'none worth modelling', 0, 'transmission', 2, 'gear set'),
  part('gearbox-2', 'gearbox', 2, 'gearbox', 'Sequential conversion', 'shift time 0.08 s, half the drive held through a shift; close ratios between the stock first and top', '+10 kg', GEARBOX2.kg, 'transmission', 3, 'gear set'),
  part('lsd-1', 'lsd', 1, 'differential', 'Street limited-slip differential', 'driven axles: limited-slip, preload 60 N m, locking 0.25 N m per N m', 'understeer on the way in when over-locked', 0, 'transmission', 2, 'differential'),
  part('lsd-2', 'lsd', 2, 'differential', 'Race limited-slip differential', 'driven axles: limited-slip, preload 150 N m, locking 0.5 N m per N m', 'understeer on the way in when over-locked', 0, 'transmission', 3, 'differential'),
  part('tyres-all-season', 'tyres', 1, 'tyres', 'All-season tyres', TYRE_WORDS, 'grip lost against a summer tyre', 0, 'eco', 1, 'tyre category', 'all-season'),
  part('tyres-summer', 'tyres', 1, 'tyres', 'Summer tyres', TYRE_WORDS, 'rolling resistance; wear later', 0, 'tires', 1, 'tyre category', 'summer'),
  part('tyres-max-performance', 'tyres', 1, 'tyres', 'Max-performance tyres', TYRE_WORDS, 'rolling resistance; wear later', 0, 'tires', 2, 'tyre category', 'max-performance'),
  part('tyres-track', 'tyres', 1, 'tyres', 'Track tyres', TYRE_WORDS, 'rolling resistance; wear later', 0, 'tires', 3, 'tyre category', 'track'),
  part('tyres-all-terrain', 'tyres', 1, 'tyres', 'All-terrain tyres', TYRE_WORDS, 'grip on the road; rolling resistance', 0, 'offroad', 1, 'tyre category', 'all-terrain'),
  part('tyres-drag', 'tyres', 1, 'tyres', 'Drag radials', TYRE_WORDS, 'cornering grip; rolling resistance; wear later', 0, 'tires', 3, 'tyre category', 'drag'),
  part('tyres-wide-1', 'tyres-wide', 1, 'tyres', 'Wider tyres', '20 mm more section width front and rear: a higher reference load, so more grip at the same load', 'a little wheel inertia', 0, 'tires', 1, null),
  part('wheels-light-1', 'wheels-light', 1, 'wheels', 'Lightweight wheels', 'unsprung mass -3 kg a corner; wheel inertia x0.85', 'none', -4 * LIGHT_WHEEL.kgPerCorner, 'weight', 1, null),
  part('springs-1', 'springs', 1, 'springs', 'Sport springs', 'ride frequency x1.2, damping ratio +0.06, ride height -25 mm', 'ride; ground clearance', 0, 'suspension', 1, 'springs'),
  part('springs-2', 'springs', 2, 'springs', 'Coilovers', 'ride frequency x1.45, damping ratio +0.12, ride height -40 mm; the setup may move springs, dampers and height', 'ride; ground clearance', 0, 'suspension', 2, 'springs'),
  part('springs-3', 'springs', 3, 'springs', 'Race coilovers', 'ride frequency x1.75, damping ratio +0.18, ride height -55 mm; the setup may move springs, dampers and height', 'ride; ground clearance', 0, 'suspension', 3, 'springs'),
  part('arb-1', 'arb', 1, 'anti-roll bars', 'Stiffer anti-roll bars', 'both bars x1.3', 'none', 0, 'suspension', 1, 'anti-roll bars'),
  part('arb-2', 'arb', 2, 'anti-roll bars', 'Adjustable anti-roll bars', 'both bars x1.3; the setup may move each from x0.7 to x1.9', 'none', 0, 'suspension', 2, 'anti-roll bars'),
  part('weight-1', 'weight', 1, 'weight', 'Weight reduction, street', 'curb weight -3% from the body; front weight share +0.3 points', 'durability on the card', 0, 'weight', 1, 'weight'),
  part('weight-2', 'weight', 2, 'weight', 'Weight reduction, pro', 'curb weight -7% from the body; front weight share +0.7 points', 'durability on the card', 0, 'weight', 2, 'weight'),
  part('weight-3', 'weight', 3, 'weight', 'Weight reduction, extreme', 'curb weight -12% from the body; front weight share +1.2 points', 'durability on the card', 0, 'weight', 3, 'weight'),
  part('brakes-1', 'brakes', 1, 'brakes', 'Pads and fluid', 'brake torque capacity x1.15 (a first stop is still the tyres\')', 'none', 0, 'brakes', 1, 'brakes'),
  part('brakes-2', 'brakes', 2, 'brakes', 'Big brake kit', 'brake torque capacity x1.4; the setup may move the bias', '+2 kg unsprung at each front corner', 4, 'brakes', 2, 'brakes'),
  part('brakes-3', 'brakes', 3, 'brakes', 'Race brake kit', 'brake torque capacity x1.6; the setup may move the bias', '+3 kg unsprung at each front corner', 6, 'brakes', 3, 'brakes'),
  part('aero-front-1', 'aero-front', 1, 'aero', 'Front splitter', 'front lift area -0.10 m^2, drag area +0.012 m^2; the setup may trim it', 'drag; +3 kg at the nose', AERO.frontKg[0], 'aero', 1, 'front aero'),
  part('aero-front-2', 'aero-front', 2, 'aero', 'Race splitter', 'front lift area -0.22 m^2, drag area +0.03 m^2; the setup may trim it', 'drag; +5 kg at the nose', AERO.frontKg[1], 'aero', 2, 'front aero'),
  part('aero-rear-1', 'aero-rear', 1, 'aero', 'Rear wing', 'rear lift area -0.18 m^2, drag area +0.03 m^2; the setup may trim it', 'drag; +6 kg at the tail', AERO.rearKg[0], 'aero', 2, 'rear aero'),
  part('aero-rear-2', 'aero-rear', 2, 'aero', 'Race wing', 'rear lift area -0.40 m^2, drag area +0.07 m^2; the setup may trim it', 'drag; +8 kg at the tail', AERO.rearKg[1], 'aero', 3, 'rear aero'),
]);

/** A part of the catalogue by its id, or null. */
export function partById(id: string): PartDef | null {
  for (let i = 0; i < PARTS.length; i++) if (PARTS[i].id === id) return PARTS[i];
  return null;
}

// A part's position in the fixed order (the catalogue's length for an id it does not hold).
function orderOf(id: string): number {
  for (let i = 0; i < PARTS.length; i++) if (PARTS[i].id === id) return i;
  return PARTS.length;
}

/* ------------------------------------------------------------------ what decides whether a part goes on */

/** What a part's refusal turns on, read off the stock car before any part. */
type Facts = {
  electric: boolean;
  /** The engine has an air model for a part to change (not an electric motor, not a drawn torque curve). */
  air: boolean;
  boosted: boolean; turbo: boolean; diesel: boolean;
  transmission: TransmissionType; launch: DrivelineModel['launch']; gearCount: number;
  layout: DrivelineModel['layout']; diffFront: DiffModel; diffRear: DiffModel;
  category: TyreCategory;
};

// The highest full-boost pressure ratio in an air model's table: 1 for an unboosted engine.
function peakPressure(e: EngineModel): number {
  const air = e.air;
  let peak = 1;
  if (air !== null) for (let i = 0; i < e.n; i++) if (air.pressureRatio[i] > peak) peak = air.pressureRatio[i];
  return peak;
}

function isBoosted(e: EngineModel): boolean {
  return e.air !== null && (e.kind === 'turbo' || e.kind === 'supercharged') && peakPressure(e) > 1;
}

function factsOf(car: StockCar): Facts {
  const m = car.model, e = m.engine, d = m.driveline;
  const boosted = isBoosted(e);
  return {
    electric: e.kind === 'electric', air: e.air !== null, boosted, turbo: boosted && e.kind === 'turbo' && e.boost !== null,
    diesel: car.layout.powertrain === 'diesel',
    transmission: d.transmission, launch: d.launch, gearCount: d.gears.length, layout: d.layout,
    diffFront: { kind: d.diffFront.kind, preload: d.diffFront.preload, lockPerTorque: d.diffFront.lockPerTorque },
    diffRear: { kind: d.diffRear.kind, preload: d.diffRear.preload, lockPerTorque: d.diffRear.lockPerTorque },
    category: car.tyres.category,
  };
}

// The parts that work on a combustion engine's air model.
const AIR_KINDS: readonly PartKind[] = ['turbo-kit', 'supercharger-kit', 'turbo-upgrade', 'intake', 'exhaust', 'cams', 'internals', 'intercooler', 'fuel', 'tune'];

// Whether a differential would be stronger with a limited-slip part of this step fitted in its place.
function lsdGains(d: DiffModel, step: number): boolean {
  if (d.kind === 'locked') return false;
  return d.kind === 'open' || d.preload < LSD.preload[step - 1] || d.lockPerTorque < LSD.lockPerTorque[step - 1];
}

// The driven axles a limited-slip part of this step would make stronger.
function lsdAxles(f: Facts, step: number): ('front' | 'rear')[] {
  const out: ('front' | 'rear')[] = [];
  if (f.layout !== 'RWD' && lsdGains(f.diffFront, step)) out.push('front');
  if (f.layout !== 'FWD' && lsdGains(f.diffRear, step)) out.push('rear');
  return out;
}

function hasPart(have: readonly PartDef[], id: string): boolean {
  for (let i = 0; i < have.length; i++) if (have[i].id === id) return true;
  return false;
}

/**
 * Why this part does not go on a car with these facts and these parts already fitted, or null when it does: it is
 * there already; another part holds its place; the car has nothing for it to work on; or a part it needs is missing.
 */
function refusal(f: Facts, p: PartDef, have: readonly PartDef[]): string | null {
  for (let i = 0; i < have.length; i++) {
    const q = have[i];
    if (q.id === p.id) return `${p.id} is fitted already`;
    if (p.place !== null && q.place === p.place) {
      return p.place === 'induction'
        ? `a second induction part: ${q.id} is fitted already, and an engine takes one turbo or blower`
        : `${q.id} is fitted already in the same place (${p.place}), and only one goes there`;
    }
  }
  let kit = false;
  for (let i = 0; i < have.length; i++) if (have[i].kind === 'turbo-kit' || have[i].kind === 'supercharger-kit') kit = true;
  const boosted = f.boosted || kit;
  if (AIR_KINDS.indexOf(p.kind) >= 0) {
    if (f.electric) return `${p.id} works on a combustion engine, and this car is electric`;
    if (!f.air) return `${p.id} changes how an engine breathes, and this engine is a drawn torque curve with no air model to change`;
  }
  switch (p.kind) {
    case 'turbo-kit':
    case 'supercharger-kit':
      if (f.boosted) return `the engine is boosted from the factory: a turbo upgrade, an intercooler or a tune is the way on from here`;
      break;
    case 'turbo-upgrade':
      if (!f.turbo) return `${p.id} replaces a factory turbo, and this engine has none`;
      break;
    case 'intercooler':
      if (!boosted) return 'nothing to cool: the engine is not boosted (an induction kit comes first)';
      break;
    case 'fuel':
      if (f.diesel) return 'E85 and race fuel are for a petrol engine, and this one is a diesel';
      break;
    case 'tune':
      if (p.step >= 2) {
        if (boosted) {
          if (p.step === 2 && !hasPart(have, 'exhaust-2')) return 'tune-2 on a boosted engine needs exhaust-2: the extra boost needs a freer exhaust';
          if (p.step === 3 && !(hasPart(have, 'intercooler-1') && hasPart(have, 'fuel-1'))) return 'tune-3 on a boosted engine needs intercooler-1 and fuel-1: the extra boost has to be cooled and needs the fuel\'s knock margin';
        } else if (!(hasPart(have, 'intake-1') && (hasPart(have, 'exhaust-1') || hasPart(have, 'exhaust-2')))) {
          return `${p.id} on an unboosted engine needs intake-1 and an exhaust part: the map alone has nothing more to give`;
        }
      }
      break;
    case 'flywheel':
    case 'nitrous':
      if (f.electric) return `${p.id} works on a combustion engine, and this car is electric`;
      break;
    case 'clutch':
      if (f.launch === 'direct') return 'no clutch to uprate: the motor drives the wheels directly';
      break;
    case 'shifter':
      if (f.transmission !== 'manual') return 'a short shifter is for a manual gearbox';
      break;
    case 'gearbox':
      if (f.transmission === 'cvt' || f.transmission === 'ecvt' || f.transmission === 'single-speed') return `no gears to change: the car has a ${f.transmission} transmission`;
      if (f.gearCount < 3) return 'no gears between first and top to respace';
      break;
    case 'lsd':
      if (lsdAxles(f, p.step).length === 0) return 'every driven axle already has a differential as strong as this one';
      break;
    case 'tyres':
      if (p.tyre === f.category) return `the car is on ${f.category} tyres already`;
      break;
    default:
      break;
  }
  return null;
}

/** The parts of a build that go on, in the catalogue's order, and those that do not with the reason. */
type Plan = { accepted: PartDef[]; refused: { id: string; reason: string }[] };

function planParts(f: Facts, fitted: readonly FittedPart[] | null | undefined): Plan {
  const wanted: string[] = [];
  const refused: { id: string; reason: string }[] = [];
  const list = Array.isArray(fitted) ? fitted : [];
  for (let i = 0; i < list.length; i++) {
    const item: unknown = list[i];
    const id = typeof item === 'object' && item !== null && typeof (item as FittedPart).id === 'string' ? (item as FittedPart).id : null;
    if (id === null) { refused.push({ id: String(id), reason: 'a fitted part needs an id' }); continue; }
    if (partById(id) === null) { refused.push({ id, reason: `${id} is not in the catalogue` }); continue; }
    if (wanted.indexOf(id) < 0) wanted.push(id);
  }
  const accepted: PartDef[] = [];
  const known: { id: string; reason: string }[] = [];
  for (let i = 0; i < PARTS.length; i++) {
    const p = PARTS[i];
    if (wanted.indexOf(p.id) < 0) continue;
    const why = refusal(f, p, accepted);
    if (why === null) accepted.push(p); else known.push({ id: p.id, reason: why });
  }
  return { accepted, refused: known.concat(refused) };
}

/* ------------------------------------------------------------------ fitting: the state of a build in progress */

type AeroPart = { lift: number; drag: number };

type Fit = {
  model: VehicleModel; basis: Record<string, Basis>; layout: StockCar['layout']; facts: Facts;
  /** The stock chassis, as resolved (a copy): what the springs' damping ratio is read from. */
  stock: ChassisModel;
  gyration: Gyration;
  /** Stock redline, rad/s (the x of every breathing curve), stock curb weight, kg, and stock mass as driven. */
  redline0: number; curb0: number; mass0: number;
  /** The tyres as now fitted: category, grip scale, sizes. */
  category: TyreCategory; gripScale: number; sizeFront: TyreSize; sizeRear: TyreSize;
  /** A coast-down's A on file holds the tyres' rolling loss: its stock figure and the stock tyres' rolling resistance. */
  rollingOnFile: boolean; roadLoadA0: number; rollRes0: number;
  /** The engine's tables, and the mass and heights, are out of date. */
  engineDirty: boolean; chassisDirty: boolean;
  aeroFront: AeroPart | null; aeroRear: AeroPart | null;
  /** The limited-slip part's own figures on each axle it went on (for the setup's diffLock). */
  lsdFront: DiffModel | null; lsdRear: DiffModel | null;
};

function startFit(sheet: PhysicsSheet, car: StockCar): Fit {
  const m = car.model, c = m.chassis;
  const road = coastDown(sheet);
  return {
    model: m, basis: car.basis, layout: car.layout, facts: factsOf(car),
    stock: { ...c },
    gyration: chassisGyration(sheet, car.layout.bodyClass),
    redline0: m.engine.redline, curb0: c.mass - DRIVER_MASS, mass0: c.mass,
    category: car.tyres.category, gripScale: car.tyres.gripScale, sizeFront: car.tyres.sizeFront, sizeRear: car.tyres.sizeRear,
    rollingOnFile: road !== null && road.hasA, roadLoadA0: m.aero.roadLoadA, rollRes0: TYRE_CATEGORY[car.tyres.category].rollRes,
    engineDirty: false, chassisDirty: false,
    aeroFront: null, aeroRear: null, lsdFront: null, lsdRear: null,
  };
}

function estimate(f: Fit, keys: readonly string[]): void {
  for (let i = 0; i < keys.length; i++) f.basis[keys[i]] = 'estimated';
}

const ENGINE_TABLE_KEYS = ['engine.wot', 'engine.offBoost', 'engine.air'];
const MASS_KEYS = ['chassis.mass', 'chassis.sprungMass', 'chassis.a', 'chassis.b', 'chassis.cgHeight', 'chassis.izz', 'chassis.ixx', 'chassis.iyy'];

/* ------------------------------------------------------------------ fitting: mass */

/**
 * Adds sprung mass (negative takes it off) at `atFront` of the way from the rear axle to the front one (1 at the
 * front axle, 0 at the rear), at the sprung body's own height: the weight split moves by the moment it adds.
 */
function addSprungMass(f: Fit, kg: number, atFront: number): void {
  const c = f.model.chassis, L = c.wheelbase;
  const front = c.mass * c.b / L + kg * atFront;
  c.mass += kg; c.sprungMass += kg;
  c.b = L * front / c.mass; c.a = L - c.b;
  f.chassisDirty = true;
}

/** Adds sprung mass at the car's own centre of gravity: the split stays exactly as it is. */
function addCentredMass(f: Fit, kg: number): void {
  const c = f.model.chassis;
  c.mass += kg; c.sprungMass += kg;
  f.chassisDirty = true;
}

/** Adds unsprung mass at each axle, kg for the axle (both corners): at the wheel centres, so the split moves with it. */
function addUnsprungMass(f: Fit, front: number, rear: number): void {
  const c = f.model.chassis, L = c.wheelbase;
  const frontLoad = c.mass * c.b / L + front;
  c.mass += front + rear; c.unsprungFront += front; c.unsprungRear += rear;
  c.b = L * frontLoad / c.mass; c.a = L - c.b;
  f.chassisDirty = true;
  estimate(f, ['chassis.unsprungFront', 'chassis.unsprungRear']);
}

/** Mass on the engine: at the front axle for a front engine, at the car's centre for a mid engine, the rear axle for a rear one. */
function addEngineMass(f: Fit, kg: number): void {
  const where = f.layout.location;
  if (where === 'mid') addCentredMass(f, kg);
  else addSprungMass(f, kg, where === 'front' ? 1 : 0);
}

/**
 * Brings what depends on mass and heights up to date: the whole car's centre-of-gravity height from the sprung and
 * unsprung masses' (ms hs + mu hu = m h, as resolve.ts keeps it), the three inertias by resolve.ts's own formulas,
 * and a coast-down's A, whose rolling share moves with the weight and the tyres' rolling resistance.
 */
function settleChassis(f: Fit): void {
  const c = f.model.chassis;
  c.cgHeight = (c.sprungMass * c.sprungCgHeight + c.unsprungFront * c.unsprungHeightFront + c.unsprungRear * c.unsprungHeightRear) / c.mass;
  setInertias(c, f.gyration);
  if (f.rollingOnFile) {
    const a = f.roadLoadA0 + G * (c.mass * TYRE_CATEGORY[f.category].rollRes - f.mass0 * f.rollRes0);
    f.model.aero.roadLoadA = a > 0 ? a : 0;
    estimate(f, ['aero.roadLoadA']);
  }
  estimate(f, MASS_KEYS);
  f.chassisDirty = false;
}

/** Lowers the sprung body by `drop` m on its springs (never below the wheel centres), as resolve.ts applySetup does. */
function lowerBody(f: Fit, drop: number): void {
  const c = f.model.chassis;
  const floor = Math.max(c.unsprungHeightFront, c.unsprungHeightRear);
  const hs = c.sprungCgHeight - drop;
  c.sprungCgHeight = hs > floor ? hs : floor;
  f.chassisDirty = true;
  estimate(f, ['chassis.sprungCgHeight']);
}

/* ------------------------------------------------------------------ fitting: the engine */

/** Charge density over ambient at a pressure ratio through this air model's compressor and cooler (DESIGN.md 5.1). */
function chargeDensity(pr: number, air: EngineAir): number {
  return pr / (1 + (1 - air.intercooler) * (dpow(pr, ISENTROPIC) - 1) / air.compressorEff);
}

/** Multiplies the engine's own breathing by c0 + c1 x + c2 x^2 at each table point, x = speed over the stock redline. */
function scaleBreathing(f: Fit, c0: number, c1: number, c2: number): void {
  const e = f.model.engine, air = e.air as EngineAir;
  for (let i = 0; i < e.n; i++) {
    const x = i * e.dOmega / f.redline0;
    air.specific[i] *= c0 + c1 * x + c2 * x * x;
  }
  f.engineDirty = true;
}

/**
 * Raises the redline by `rpm` (the limiter's band in step), never past the table buildEngine made: its headroom covers
 * every raise the catalogue makes together (engine.ts HEADROOM_RPM).
 */
function raiseRedline(f: Fit, rpm: number): void {
  const e = f.model.engine;
  const top = (e.n - 1) * e.dOmega;
  let want = e.redline + rpm * RPM;
  const bandShare = e.limiterBand / e.redline;
  if (want * (1 + bandShare) > top) want = top / (1 + bandShare);
  e.redline = want;
  e.limiterBand = bandShare * want;
  f.engineDirty = true;
  estimate(f, ['engine.redline', 'engine.limiterBand']);
}

/** Scales the gauge pressure (pressure ratio less one) of every point of the full-boost table: the same shape, more boost. */
function scaleBoost(air: EngineAir, n: number, k: number): void {
  const pr = air.pressureRatio;
  for (let i = 0; i < n; i++) pr[i] = 1 + (pr[i] - 1) * k;
}

/**
 * An induction kit on an unboosted engine. The full-boost pressure-ratio table: a turbo's rises smoothly from its
 * threshold to full boost at half the stock redline; a blower's makes 0.6 of its boost at idle and the rest by the
 * stock torque peak. Both hold full boost from there (the compressor is matched to hold it to redline, with 10% in
 * hand: maxAirflow). The kit's own intercooler, compressor and (a blower) drive; turbo lag for a turbo.
 */
function fitInductionKit(f: Fit, psi: number, supercharged: boolean, kg: number): void {
  const e = f.model.engine, air = e.air as EngineAir;
  const prMax = 1 + psi * PSI / P_AMBIENT;
  const d = e.dOmega, pr = air.pressureRatio;
  const wFull = KIT_FULL_BOOST_SHARE * f.redline0, wStart = KIT_THRESHOLD_SHARE * wFull;
  const idle = e.idle, wTorque = enginePeaks(e).torqueOmega;
  for (let i = 0; i < e.n; i++) {
    const w = i * d;
    let share: number;
    if (supercharged) {
      const t = wTorque > idle ? (w - idle) / (wTorque - idle) : 1;
      share = SUPERCHARGER_IDLE_SHARE + (1 - SUPERCHARGER_IDLE_SHARE) * (t < 0 ? 0 : t > 1 ? 1 : t);
    } else {
      const t = (w - wStart) / (wFull - wStart);
      share = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);   // smoothstep: no kink where boost starts or where it is full
    }
    pr[i] = 1 + (prMax - 1) * share;
  }
  e.kind = supercharged ? 'supercharged' : 'turbo';
  air.intercooler = KIT.intercooler;
  air.compressorEff = KIT.compressorEff;
  air.blowerDrive = supercharged ? KIT.blowerDrive : 0;
  if (air.knockLimitPr < prMax) air.knockLimitPr = prMax;
  e.boost = supercharged ? null : { tauRef: KIT_LAG.tauRef, omegaRef: KIT_LAG.omegaRefRpm * RPM, tauMin: KIT_LAG.tauMin, tauMax: KIT_LAG.tauMax, fallTau: KIT_LAG.fallTau };
  // The compressor holds full boost to the stock redline with flow in hand.
  let peakFlow = 0;
  for (let i = 0; i < e.n; i++) {
    const w = i * d;
    if (w > f.redline0) break;
    const flow = air.specific[i] * chargeDensity(pr[i], air) * w / AIR_ENERGY;
    if (flow > peakFlow) peakFlow = flow;
  }
  air.maxAirflow = KIT_FLOW_MARGIN * peakFlow;
  addEngineMass(f, kg);
  f.engineDirty = true;
  estimate(f, ['engine.kind', 'engine.boost']);
}

/**
 * A bigger turbo on a factory turbo engine: more flow, more lag, and boost that starts later: the rising part of the
 * full-boost table is stretched to higher speed by `later` (the plateau and the taper past the power peak stay).
 */
function upgradeTurbo(f: Fit, step: number): void {
  const e = f.model.engine, air = e.air as EngineAir, d = e.dOmega;
  air.maxAirflow *= UPGRADE.airflow[step - 1];
  if (e.boost !== null) e.boost.tauRef *= UPGRADE.lag[step - 1];
  const later = UPGRADE.threshold[step - 1];
  const pr = air.pressureRatio, old = Float64Array.from(pr);
  const peak = peakPressure(e);
  let full = 0;
  while (full < e.n - 1 && old[full] < peak) full++;
  const end = later * full * d;
  for (let i = 0; i < e.n; i++) {
    const w = i * d;
    if (w >= end) break;
    const at = w / later / d, j = Math.floor(at);
    pr[i] = j + 1 < e.n ? old[j] + (old[j + 1] - old[j]) * (at - j) : old[e.n - 1];
  }
  addEngineMass(f, UPGRADE.kg[step - 1]);
  f.engineDirty = true;
  estimate(f, ['engine.boost']);
}

/* ------------------------------------------------------------------ fitting: one part */

/** What a stock corner's damping ratio is: c / (2 sqrt(k m)), m the corner's sprung mass as resolve.ts sizes it. */
function cornerDamping(c0: ChassisModel, front: boolean): number {
  const share = c0.b / c0.wheelbase;
  const axle = front ? c0.mass * share - c0.unsprungFront : c0.mass * (1 - share) - c0.unsprungRear;
  const corner = 0.5 * Math.max(axle, 0.1 * c0.sprungMass);
  const k = front ? c0.springFront : c0.springRear, c = front ? c0.damperFront : c0.damperRear;
  return k > 0 && corner > 0 && c > 0 ? c / (2 * Math.sqrt(k * corner)) : 0;
}

/** The tyres as now fitted, in the shape resolve.ts's brake sizing reads. */
function tyresNow(f: Fit): ResolvedTyres {
  const m = f.model;
  return {
    front: m.tyreFront, rear: m.tyreRear, wheelInertiaFront: m.wheelInertiaFront, wheelInertiaRear: m.wheelInertiaRear,
    category: f.category, gripScale: f.gripScale, sizeFront: f.sizeFront, sizeRear: f.sizeRear,
  };
}

/**
 * Fits tyres of a category (the car's grip scale kept, held to the new category's range) and a width added to each
 * axle's size, builds both axles' tyres again from their sizes (resolve.ts tyreParams) and, new tyres moving the stop
 * the brakes are sized for, sizes the brakes again on them (resolve.ts resolveBrakes).
 */
function refitTyres(f: Fit, category: TyreCategory, widthAdd: number): void {
  const m = f.model;
  const range = tyreGripScaleRange(category);
  const scale = f.gripScale < range.min ? range.min : f.gripScale > range.max ? range.max : f.gripScale;
  const sf: TyreSize = { width: f.sizeFront.width + widthAdd, aspect: f.sizeFront.aspect, rimIn: f.sizeFront.rimIn, radius: f.sizeFront.radius };
  const sr: TyreSize = { width: f.sizeRear.width + widthAdd, aspect: f.sizeRear.aspect, rimIn: f.sizeRear.rimIn, radius: f.sizeRear.radius };
  m.tyreFront = tyreParams(sf, category, scale, f.rollingOnFile);
  m.tyreRear = tyreParams(sr, category, scale, f.rollingOnFile);
  if (widthAdd !== 0) {
    m.wheelInertiaFront = wheelInertia(wheelMass(sf.width, sf.rimIn), m.tyreFront.radius);
    m.wheelInertiaRear = wheelInertia(wheelMass(sr.width, sr.rimIn), m.tyreRear.radius);
    estimate(f, ['wheelInertiaFront', 'wheelInertiaRear']);
  }
  f.category = category; f.gripScale = scale; f.sizeFront = sf; f.sizeRear = sr;
  for (const axle of ['tyreFront', 'tyreRear']) for (const k of ['width', 'fz0', 'muY0', 'cAlpha0', 'fzStiffPeak', 'rollRes']) f.basis[`${axle}.${k}`] = 'estimated';
  m.brakes = resolveBrakes(f.layout, m.chassis, tyresNow(f), f.basis);
  if (f.rollingOnFile) f.chassisDirty = true;
}

/** One part's change to the car. The refusal rules have already let it on. */
function applyPart(f: Fit, p: PartDef): void {
  const m = f.model, e = m.engine, c = m.chassis, dl = m.driveline, s = p.step;
  switch (p.kind) {
    case 'turbo-kit': fitInductionKit(f, KIT.turboPsi[s - 1], false, p.massKg); return;
    case 'supercharger-kit': fitInductionKit(f, KIT.superchargerPsi[s - 1], true, p.massKg); return;
    case 'turbo-upgrade': upgradeTurbo(f, s); return;
    case 'intake': {
      const air = e.air as EngineAir;
      air.maxAirflow *= INTAKE.airflow;
      scaleBreathing(f, 1, 0, INTAKE.breathing);
      return;
    }
    case 'exhaust': {
      const air = e.air as EngineAir;
      scaleBreathing(f, 1, 0, EXHAUST.breathing[s - 1]);
      if (s === 2) {
        air.maxAirflow *= EXHAUST.airflow;
        if (e.kind === 'turbo') {
          if (e.boost !== null) e.boost.tauRef *= EXHAUST.lag;
          air.knockLimitPr += EXHAUST.knock;
          estimate(f, ['engine.boost']);
        }
      }
      addCentredMass(f, p.massKg);
      return;
    }
    case 'cams':
      scaleBreathing(f, CAMS.base[s - 1], CAMS.slope[s - 1], 0);
      raiseRedline(f, CAMS.redlineRpm[s - 1]);
      e.idle += CAMS.idleRpm[s - 1] * RPM;
      estimate(f, ['engine.idle']);
      return;
    case 'internals': raiseRedline(f, INTERNALS_REDLINE_RPM); return;
    case 'intercooler': {
      const air = e.air as EngineAir;
      if (air.intercooler < INTERCOOLER.effectiveness) air.intercooler = INTERCOOLER.effectiveness;
      addSprungMass(f, p.massKg, 1);   // a front-mounted cooler sits ahead of the radiator
      f.engineDirty = true;
      return;
    }
    case 'fuel': {
      const air = e.air as EngineAir;
      if (air.knockLimitPr < FUEL.knockLimitPr) air.knockLimitPr = FUEL.knockLimitPr;
      scaleBreathing(f, FUEL.specific, 0, 0);
      return;
    }
    case 'tune':
      if (isBoosted(e)) {
        // The stock peak raised by so much, the whole table in proportion: the rise from the threshold, the plateau to
        // the power peak and the taper past it keep their shape. The knock and airflow limits apply in rebuildTables.
        const peak = peakPressure(e);
        scaleBoost(e.air as EngineAir, e.n, (peak - 1 + TUNE.boost[s - 1]) / (peak - 1));
        f.engineDirty = true;
      } else {
        scaleBreathing(f, TUNE.specific[s - 1], 0, 0);
        raiseRedline(f, TUNE.redlineRpm[s - 1]);
      }
      return;
    case 'flywheel':
      e.inertia *= FLYWHEEL;
      estimate(f, ['engine.inertia']);
      return;
    case 'nitrous': {
      const hp = NITROUS.hp[s - 1];
      m.nitrous = { power: hp * HP, bottleMass: NITROUS.bottleKg, flow: hp * NITROUS.kgPerHpSecond };
      addSprungMass(f, p.massKg, 0);   // the bottle and its system in the boot
      estimate(f, ['nitrous']);
      return;
    }
    case 'clutch':
      dl.clutchCapacity *= CLUTCH[s - 1];
      estimate(f, ['driveline.clutchCapacity']);
      return;
    case 'shifter':
      dl.shiftTime *= SHIFTER;
      estimate(f, ['driveline.shiftTime']);
      return;
    case 'gearbox': {
      // Close ratios: the same first and top, the gears between in equal steps (a geometric progression), so no
      // upshift drops the engine further than another.
      const g = Float64Array.from(dl.gears), n = g.length, first = g[0], top = g[n - 1];
      for (let i = 1; i < n - 1; i++) g[i] = first * dpow(top / first, i / (n - 1));
      dl.gears = g;
      estimate(f, ['driveline.gears']);
      if (s === 2) {
        // A conversion never makes a box slower or more interrupting than it was.
        if (dl.shiftTime > GEARBOX2.shiftTime) dl.shiftTime = GEARBOX2.shiftTime;
        if (dl.shiftTorqueHold < GEARBOX2.hold) dl.shiftTorqueHold = GEARBOX2.hold;
        addCentredMass(f, p.massKg);
        estimate(f, ['driveline.shiftTime', 'driveline.shiftTorqueHold']);
      }
      return;
    }
    case 'lsd': {
      const axles = lsdAxles(f.facts, s);
      for (let i = 0; i < axles.length; i++) {
        const diff: DiffModel = { kind: 'limited-slip', preload: LSD.preload[s - 1], lockPerTorque: LSD.lockPerTorque[s - 1] };
        if (axles[i] === 'front') { dl.diffFront = diff; f.lsdFront = { ...diff }; estimate(f, ['driveline.diffFront']); }
        else { dl.diffRear = diff; f.lsdRear = { ...diff }; estimate(f, ['driveline.diffRear']); }
      }
      return;
    }
    case 'tyres': refitTyres(f, p.tyre as TyreCategory, 0); return;
    case 'tyres-wide': refitTyres(f, f.category, WIDE_M); return;
    case 'wheels-light':
      addUnsprungMass(f, -2 * LIGHT_WHEEL.kgPerCorner, -2 * LIGHT_WHEEL.kgPerCorner);
      m.wheelInertiaFront *= LIGHT_WHEEL.inertia;
      m.wheelInertiaRear *= LIGHT_WHEEL.inertia;
      estimate(f, ['wheelInertiaFront', 'wheelInertiaRear']);
      return;
    case 'springs': {
      // Spring rate goes with the square of ride frequency at the same corner mass; damping c = 2 zeta sqrt(k m), so
      // c moves by the frequency and by the damping ratio's rise over the stock corner's own ratio.
      const k = SPRINGS.frequency[s - 1], dz = SPRINGS.damping[s - 1];
      const zf = cornerDamping(f.stock, true), zr = cornerDamping(f.stock, false);
      c.springFront *= k * k; c.springRear *= k * k;
      c.damperFront *= zf > 0 ? k * (zf + dz) / zf : k;
      c.damperRear *= zr > 0 ? k * (zr + dz) / zr : k;
      lowerBody(f, SPRINGS.drop[s - 1]);
      estimate(f, ['chassis.springFront', 'chassis.springRear', 'chassis.damperFront', 'chassis.damperRear']);
      return;
    }
    case 'arb':
      c.arbFront *= ARB; c.arbRear *= ARB;
      estimate(f, ['chassis.arbFront', 'chassis.arbRear']);
      return;
    case 'weight': {
      // Off the sprung body at its own height, the rear a little more than the front: the front's share of the
      // weight rises by the part's points.
      const off = WEIGHT.share[s - 1] * f.curb0;
      const share = c.b / c.wheelbase + WEIGHT.frontPoints[s - 1];
      c.mass -= off; c.sprungMass -= off;
      c.b = c.wheelbase * share; c.a = c.wheelbase - c.b;
      f.chassisDirty = true;
      return;
    }
    case 'brakes':
      m.brakes.maxTorqueFront *= BRAKES.torque[s - 1];
      m.brakes.maxTorqueRear *= BRAKES.torque[s - 1];
      if (BRAKES.kgPerFrontCorner[s - 1] > 0) addUnsprungMass(f, 2 * BRAKES.kgPerFrontCorner[s - 1], 0);
      estimate(f, ['brakes.maxTorqueFront', 'brakes.maxTorqueRear']);
      return;
    case 'aero-front': {
      const a: AeroPart = { lift: AERO.frontLift[s - 1], drag: AERO.frontDrag[s - 1] };
      m.aero.liftAreaFront += a.lift; m.aero.dragArea += a.drag;
      f.aeroFront = a;
      addSprungMass(f, p.massKg, 1);
      estimate(f, ['aero.liftAreaFront', 'aero.dragArea']);
      return;
    }
    case 'aero-rear': {
      const a: AeroPart = { lift: AERO.rearLift[s - 1], drag: AERO.rearDrag[s - 1] };
      m.aero.liftAreaRear += a.lift; m.aero.dragArea += a.drag;
      f.aeroRear = a;
      addSprungMass(f, p.massKg, 0);
      estimate(f, ['aero.liftAreaRear', 'aero.dragArea']);
      return;
    }
    default:
      return;
  }
}

/* ------------------------------------------------------------------ fitting: the setup */

function isScale(k: number | undefined): k is number {
  return typeof k === 'number' && Number.isFinite(k) && k > 0 && k !== 1;
}

function isAmount(v: number | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v !== 0;
}

function touch(f: Fit, key: string): void {
  f.basis[key] = derivedBasis(f.basis[key] !== undefined ? f.basis[key] : 'estimated');
}

/**
 * Applies a build's setup. Here: what only a part gives meaning to (boost and spool on a boosted engine, the nitrous
 * shot, a limited-slip part's locking, the drag that comes with downforce, and an aero part's trim); then resolve.ts
 * applySetup for the plain changes (bars, springs, dampers, ride height, brake bias, final drive, lift). A setup
 * field with nothing to act on is left out and said so in `notes`.
 */
function fitSetup(f: Fit, setup: Setup, notes: string[] | null): void {
  const m = f.model, e = m.engine, dl = m.driveline;
  const say = (text: string): void => { if (notes !== null) notes.push(text); };

  if (isScale(setup.boostTarget)) {
    if (isBoosted(e)) { scaleBoost(e.air as EngineAir, e.n, setup.boostTarget); f.engineDirty = true; touch(f, 'engine.air'); }
    else say('boost target: the engine is not boosted, so there is no boost to set');
  }
  if (isScale(setup.spoolTime)) {
    if (e.boost !== null) { e.boost.tauRef *= setup.spoolTime; touch(f, 'engine.boost'); }
    else say('spool time: the engine has no turbo to spool');
  }
  if (isScale(setup.nitrousPower)) {
    const n = m.nitrous;
    if (n !== null) { n.power *= setup.nitrousPower; n.flow *= setup.nitrousPower; touch(f, 'nitrous'); }
    else say('nitrous shot: no nitrous kit is fitted');
  }
  if (isScale(setup.diffLock)) {
    const k = setup.diffLock;
    if (f.lsdFront === null && f.lsdRear === null) say('differential lock: no limited-slip part is fitted to set');
    if (f.lsdFront !== null) { dl.diffFront = { kind: 'limited-slip', preload: f.lsdFront.preload * k, lockPerTorque: f.lsdFront.lockPerTorque * k }; touch(f, 'driveline.diffFront'); }
    if (f.lsdRear !== null) { dl.diffRear = { kind: 'limited-slip', preload: f.lsdRear.preload * k, lockPerTorque: f.lsdRear.lockPerTorque * k }; touch(f, 'driveline.diffRear'); }
  }
  // Downforce costs drag. With an aero part at that axle the setup trims the part: its lift is replaced by the
  // setup's and its drag goes in proportion. With none, the downforce set up costs a modest kit's drag in proportion.
  const axles: readonly ['front' | 'rear', number | undefined][] = [['front', setup.aeroFront], ['rear', setup.aeroRear]];
  for (const [axle, lift] of axles) {
    if (typeof lift !== 'number' || !Number.isFinite(lift)) continue;
    const fitted = axle === 'front' ? f.aeroFront : f.aeroRear;
    if (fitted !== null) {
      if (axle === 'front') m.aero.liftAreaFront -= fitted.lift; else m.aero.liftAreaRear -= fitted.lift;
      m.aero.dragArea -= fitted.drag;
      if (lift < 0) m.aero.dragArea += fitted.drag * lift / fitted.lift;
    } else if (lift < 0) {
      m.aero.dragArea -= lift * MODEST_DRAG_PER_LIFT;
    }
    if (lift !== 0 || fitted !== null) touch(f, 'aero.dragArea');
  }
  if (isScale(setup.pressureFront) || isScale(setup.pressureRear)) say('tyre pressure: not modelled yet, left as recommended');
  if (isAmount(setup.camberFront) || isAmount(setup.camberRear)) say('camber: not modelled yet, left as delivered');

  applySetup(m, setup, f.basis);
  // applySetup lowers the body and works out the centre of gravity's height; the inertias that move with it are here.
  if (isAmount(setup.rideHeightDrop)) setInertias(m.chassis, f.gyration);
}

/* ------------------------------------------------------------------ the whole build */

/** What describeBuild says about one part of a build. */
export type PartReport = {
  id: string;
  name: string;
  slot: PartSlot | null;
  /** Whether it went on. */
  fitted: boolean;
  /** Why it did not; null when it did. */
  reason: string | null;
  /** What the part does, in words (the catalogue's), and what it changed on this car, in numbers. */
  does: string;
  changed: string[];
  card: PartCard | null;
};

/** What describeBuild says about a build: each part in the catalogue's order, the setup, and anything to watch. */
export type BuildReport = { parts: PartReport[]; setup: string[]; warnings: string[] };

/**
 * Fits a build to a stock car in place (resolveModel calls it): each part that goes on, in the catalogue's order, with
 * the engine's tables rebuilt and the mass, centre of gravity and inertias re-derived after each; then the setup. An
 * empty build changes nothing at all. With `report`, every part's effect is written into it as it goes.
 */
export function fitBuild(sheet: PhysicsSheet, car: StockCar, build: Build, report: BuildReport | null = null): void {
  const f = startFit(sheet, car);
  const plan = planParts(f.facts, build !== null && typeof build === 'object' ? build.parts : null);
  const setup: Setup = build !== null && typeof build === 'object' && build.setup !== null && typeof build.setup === 'object' ? build.setup : {};
  const m = car.model;
  const settle = (): void => {
    if (f.engineDirty) { rebuildTables(m.engine); estimate(f, ENGINE_TABLE_KEYS); f.engineDirty = false; }
    if (f.chassisDirty) settleChassis(f);
  };
  for (let i = 0; i < plan.accepted.length; i++) {
    const p = plan.accepted[i];
    const before = report !== null ? readings(m, f.category) : null;
    applyPart(f, p);
    settle();
    if (report !== null && before !== null) {
      report.parts.push({ id: p.id, name: p.name, slot: p.slot, fitted: true, reason: null, does: p.changes, changed: differences(before, readings(m, f.category)), card: p.card });
    }
  }
  const before = report !== null ? readings(m, f.category) : null;
  const notes: string[] | null = report !== null ? [] : null;
  fitSetup(f, setup, notes);
  settle();
  if (report === null || before === null || notes === null) return;

  for (let i = 0; i < plan.refused.length; i++) {
    const r = plan.refused[i], p = partById(r.id);
    report.parts.push({ id: r.id, name: p !== null ? p.name : r.id, slot: p !== null ? p.slot : null, fitted: false, reason: r.reason, does: p !== null ? p.changes : '', changed: [], card: p !== null ? p.card : null });
  }
  report.parts.sort((a, b) => orderOf(a.id) - orderOf(b.id));
  report.setup = differences(before, readings(m, f.category)).concat(notes, setupGates(plan.accepted, setup));
  const peak = enginePeaks(m.engine).torque;
  if (m.engine.kind !== 'electric' && peak > m.driveline.clutchCapacity) {
    report.warnings.push(`peak torque ${Math.round(peak)} N m is past the clutch's ${Math.round(m.driveline.clutchCapacity)} N m: it slips at full throttle until an uprated clutch is fitted`);
  }
}

// The setup fields DESIGN.md 11 opens with a part, set without that part. They are applied as given (see the
// contract note in fits' doc); the report says which part section 11 asks for.
function setupGates(accepted: readonly PartDef[], setup: Setup): string[] {
  const out: string[] = [];
  const has = (kind: PartKind, from: number): boolean => {
    for (let i = 0; i < accepted.length; i++) if (accepted[i].kind === kind && accepted[i].step >= from) return true;
    return false;
  };
  if ((isScale(setup.arbFront) || isScale(setup.arbRear)) && !has('arb', 2)) out.push('anti-roll bars set without arb-2, which section 11 asks for: applied as given');
  if ((isScale(setup.springFront) || isScale(setup.springRear) || isScale(setup.damperFront) || isScale(setup.damperRear) || isAmount(setup.rideHeightDrop)) && !has('springs', 2)) {
    out.push('springs, dampers or ride height set without coilovers (springs-2 or springs-3), which section 11 asks for: applied as given');
  }
  if (typeof setup.brakeBias === 'number' && !has('brakes', 2)) out.push('brake bias set without brakes-2 or brakes-3, which section 11 asks for: applied as given');
  return out;
}

/* ------------------------------------------------------------------ reading a car for describeBuild */

type Reading = { label: string; value: number; unit: string; digits: number; text: string | null };

function diffWords(d: DiffModel): string {
  if (d.kind === 'open' || d.kind === 'locked') return d.kind;
  return `${d.kind}, preload ${Math.round(d.preload)} N m, locking ${d.lockPerTorque.toFixed(2)}`;
}

/** The figures a part can change, as a tuner would read them off the car. */
function readings(m: VehicleModel, category: TyreCategory): Reading[] {
  const e = m.engine, air = e.air, c = m.chassis, d = m.driveline, peaks = enginePeaks(e);
  const out: Reading[] = [];
  const num = (label: string, value: number, unit: string, digits: number): void => { out.push({ label, value, unit, digits, text: null }); };
  const words = (label: string, text: string): void => { out.push({ label, value: NaN, unit: '', digits: 0, text }); };
  words('engine', e.kind === 'na' ? 'unboosted' : e.kind === 'turbo' ? 'turbocharged' : e.kind === 'supercharged' ? 'supercharged' : 'electric');
  num('peak power', peaks.power / HP, 'hp', 0);
  num('peak torque', peaks.torque / LBFT, 'lb ft', 0);
  num('redline', e.redline / RPM, 'rpm', 0);
  num('idle', e.idle / RPM, 'rpm', 0);
  num('engine inertia', e.inertia, 'kg m^2', 3);
  if (air !== null) {
    num('full boost', (peakPressure(e) - 1) * P_AMBIENT / PSI, 'psi', 1);
    num('charge cooling', 100 * air.intercooler, '%', 0);
    words('airflow limit', Number.isFinite(air.maxAirflow) ? `${air.maxAirflow.toFixed(3)} kg/s` : 'none');
    num('knock limit', air.knockLimitPr, 'pressure ratio', 2);
  }
  if (e.boost !== null) num('turbo spool time at 3,000 rpm', e.boost.tauRef * e.boost.omegaRef / (3000 * RPM), 's', 2);
  num('clutch capacity', d.clutchCapacity, 'N m', 0);
  num('shift time', d.shiftTime, 's', 2);
  num('drive held through a shift', 100 * d.shiftTorqueHold, '%', 0);
  words('gears', Array.from(d.gears, (g) => g.toFixed(2)).join(', '));
  num('final drive', d.finalDrive, '', 2);
  words('front differential', diffWords(d.diffFront));
  words('rear differential', diffWords(d.diffRear));
  num('mass as driven', c.mass, 'kg', 0);
  num('weight on the front axle', 100 * c.b / c.wheelbase, '%', 1);
  num('centre of gravity height', 1000 * c.cgHeight, 'mm', 0);
  num('unsprung mass front', c.unsprungFront, 'kg', 0);
  num('unsprung mass rear', c.unsprungRear, 'kg', 0);
  num('front wheel rate', c.springFront / 1000, 'N/mm', 1);
  num('rear wheel rate', c.springRear / 1000, 'N/mm', 1);
  num('front damping', c.damperFront, 'N s/m', 0);
  num('rear damping', c.damperRear, 'N s/m', 0);
  num('front anti-roll bar', c.arbFront * DEG, 'N m/deg', 0);
  num('rear anti-roll bar', c.arbRear * DEG, 'N m/deg', 0);
  num('body roll', rollGradient(c) * G / DEG, 'deg per g', 2);
  words('tyres', category);
  num('front tyre grip', m.tyreFront.muY0, '', 3);
  num('rear tyre grip', m.tyreRear.muY0, '', 3);
  num('front tyre width', 1000 * m.tyreFront.width, 'mm', 0);
  num('rear tyre width', 1000 * m.tyreRear.width, 'mm', 0);
  num('front wheel inertia', m.wheelInertiaFront, 'kg m^2', 3);
  num('rear wheel inertia', m.wheelInertiaRear, 'kg m^2', 3);
  num('front brake torque', m.brakes.maxTorqueFront, 'N m', 0);
  num('rear brake torque', m.brakes.maxTorqueRear, 'N m', 0);
  num('drag area', m.aero.dragArea, 'm^2', 3);
  num('front lift area', m.aero.liftAreaFront, 'm^2', 3);
  num('rear lift area', m.aero.liftAreaRear, 'm^2', 3);
  num('road load', m.aero.roadLoadA, 'N', 0);
  if (m.nitrous !== null) {
    num('nitrous shot', m.nitrous.power / HP, 'hp', 0);
    num('a full bottle lasts', m.nitrous.flow > 0 ? m.nitrous.bottleMass / m.nitrous.flow : 0, 's', 0);
  }
  return out;
}

/** Each reading that reads differently after than before, in words and numbers. */
function differences(before: readonly Reading[], after: readonly Reading[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < after.length; i++) {
    const b = after[i];
    let a: Reading | null = null;
    for (let j = 0; j < before.length; j++) if (before[j].label === b.label) { a = before[j]; break; }
    if (b.text !== null) {
      const was = a !== null && a.text !== null ? a.text : 'none';
      if (was !== b.text) out.push(`${b.label}: ${was} to ${b.text}`);
      continue;
    }
    const unit = b.unit === '' ? '' : ` ${b.unit}`;
    if (a === null) { out.push(`${b.label}: ${b.value.toFixed(b.digits)}${unit}`); continue; }
    const x = a.value.toFixed(b.digits), y = b.value.toFixed(b.digits);
    if (x === y) continue;
    const pct = a.value !== 0 ? 100 * (b.value - a.value) / Math.abs(a.value) : NaN;
    const change = Number.isFinite(pct) ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : '';
    out.push(`${b.label}: ${x} to ${y}${unit}${change}`);
  }
  return out;
}

/* ------------------------------------------------------------------ asking about a build */

/**
 * Whether a part goes on this car with this build, or why not: it is not in the catalogue; it is fitted already;
 * another part holds its place (a second induction kit, a second tune); the car has nothing for it to work on (a
 * turbo kit on an electric car, a short shifter on an automatic, an intercooler on an unboosted engine); or a part it
 * needs is missing (tune-3 on a boosted engine without intercooler-1 and fuel-1). Null when it fits.
 *
 * A build's setup is applied as given, not held to what its parts allow: the Garage's sliders, which every saved
 * build carries, move springs, dampers, ride height and bias on a stock car. describeBuild says where section 11 asks
 * for a part the setup went without.
 */
export function fits(sheet: PhysicsSheet, build: Build | null | undefined, partId: string): string | null {
  const p = partById(partId);
  if (p === null) return `${partId} is not in the catalogue`;
  const f = factsOf(resolveStock(sheet));
  const plan = planParts(f, build !== null && build !== undefined ? build.parts : null);
  return refusal(f, p, plan.accepted);
}

/**
 * What a build does to this car: for each part, in the catalogue's order, what it changed (in words and numbers, read
 * off the car before and after it went on) or why it was refused; what the setup changed and what in it had nothing
 * to act on; and warnings (a clutch the build's torque is past).
 */
export function describeBuild(sheet: PhysicsSheet, build: Build): BuildReport {
  const report: BuildReport = { parts: [], setup: [], warnings: [] };
  fitBuild(sheet, resolveStock(sheet), build, report);
  return report;
}

/**
 * The card engine's fitments for a build: the parts that go on, one per card category at the highest tier any of them
 * has, and one per card group (the card engine counts one induction kit and one set of tyres), in the catalogue's order.
 */
export function buildCardMods(sheet: PhysicsSheet, build: Build): PartCard[] {
  const plan = planParts(factsOf(resolveStock(sheet)), build.parts);
  const group = (c: CardCategory): string => (c === 'turbo' || c === 'supercharger' ? 'induction' : c === 'tires' || c === 'offroad' || c === 'eco' ? 'tyres' : c);
  const out: PartCard[] = [];
  for (let i = 0; i < plan.accepted.length; i++) {
    const card = plan.accepted[i].card;
    let k = -1;
    for (let j = 0; j < out.length; j++) if (group(out[j].category) === group(card.category)) k = j;
    if (k < 0) out.push(card);
    else if (card.tier > out[k].tier) out[k] = card;
  }
  return out;
}

/* ------------------------------------------------------------------ the Garage's builds */

/** The Garage's nine parts, each at tier 0 (stock) to 3 (apps/sim PerfCfg): anything else reads as 0. */
export type LegacyPerf = Readonly<{ engine?: unknown; ecu?: unknown; turbo?: unknown; trans?: unknown; susp?: unknown; nos?: unknown; tires?: unknown; brakes?: unknown; weight?: unknown }>;
/** The Garage's eight sliders, each -1 to 1 (apps/sim Tune): anything else reads as 0. */
export type LegacyTune = Readonly<{ turbo?: unknown; nitrous?: unknown; aero?: unknown; bias?: unknown; ride?: unknown; stiff?: unknown; steer?: unknown; gears?: unknown }>;

/** Each Garage slider at +1, in the setup's own units (DESIGN.md 11's slider paragraph). */
const SLIDER = Object.freeze({ spool: 0.25, boost: 0.04, shot: 0.3, bias: 0.06, ride: 0.02, stiff: 0.2, gears: 0.12 });
/** The tyre categories from the least grip on a road to the most: one Garage tier is one step up (drag radials stand at summer). */
const TYRE_LADDER: readonly TyreCategory[] = ['winter', 'all-terrain', 'all-season', 'summer', 'max-performance', 'track'];

function tierOf(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const t = Math.round(v);
  return t < 0 ? 0 : t > 3 ? 3 : t;
}

function sliderOf(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/**
 * The Garage's build as a build of real parts (DESIGN.md 11's second table and slider paragraph), so that saved builds
 * carry over and the three tiers become presets: Engine intake and cat-back, then headers and street cams, then race
 * cams, forged internals and a light flywheel; ECU a tune of its tier where what it needs is fitted (else the highest
 * below that is), and fuel-1 at tier 3; Turbo a turbo kit of its tier on an unboosted engine, an intercooler and then
 * a bigger turbo on a boosted one; Transmission clutch and short shifter, then close ratios and a street
 * limited-slip, then a twin-plate clutch, a sequential conversion and a race limited-slip; Suspension sport springs,
 * then coilovers and bars, then race coilovers and adjustable bars; Nitrous, Brakes and Weight their part of the same
 * tier; Tires one and two categories stickier than stock, then track tyres. A part the car cannot take is left out
 * (a turbo kit on an electric car). The sliders become the setup: turbo trades spool time against boost, nitrous the
 * shot against the bottle, aero adds a modest lip and wing's downforce (none at 0 or below), bias moves the brakes'
 * front share by 0.06, ride lowers the body 20 mm, stiffness moves springs and dampers by 20%, gears moves the final
 * drive by 12% (higher at +1, as the old model did). Steering is the assist layer's, not the car's.
 */
export function legacyBuild(perf: LegacyPerf | null | undefined, tune: LegacyTune | null | undefined, sheet: PhysicsSheet): Build {
  const car = resolveStock(sheet), facts = factsOf(car), m = car.model;
  const p: LegacyPerf = perf !== null && typeof perf === 'object' ? perf : {};
  const t: LegacyTune = tune !== null && typeof tune === 'object' ? tune : {};
  const ids: string[] = [];
  const engine = tierOf(p.engine), ecu = tierOf(p.ecu), turbo = tierOf(p.turbo), trans = tierOf(p.trans), susp = tierOf(p.susp);
  const nos = tierOf(p.nos), tires = tierOf(p.tires), brakes = tierOf(p.brakes), weight = tierOf(p.weight);
  if (engine >= 1) ids.push('intake-1', 'exhaust-1');
  if (engine >= 2) ids.push('exhaust-2', engine >= 3 ? 'cams-2' : 'cams-1');
  if (engine >= 3) ids.push('internals-1', 'flywheel-1');
  if (turbo >= 1) {
    if (facts.boosted) { ids.push('intercooler-1'); if (turbo >= 2) ids.push(`turbo-upgrade-${turbo - 1}`); }
    else ids.push(`turbo-kit-${turbo}`);
  }
  if (ecu >= 3) ids.push('fuel-1');
  if (trans === 1 || trans === 2) ids.push('clutch-1', 'shifter-1');
  if (trans === 2) ids.push('gearbox-1', 'lsd-1');
  if (trans === 3) ids.push('clutch-2', 'gearbox-2', 'lsd-2');
  if (susp === 1) ids.push('springs-1');
  if (susp === 2) ids.push('springs-2', 'arb-1');
  if (susp === 3) ids.push('springs-3', 'arb-2');
  if (nos >= 1) ids.push(`nitrous-${nos}`);
  if (tires >= 1) {
    let rung = TYRE_LADDER.indexOf(facts.category);
    if (rung < 0) rung = TYRE_LADDER.indexOf('summer');
    const want = tires >= 3 ? 'track' : TYRE_LADDER[Math.min(rung + tires, TYRE_LADDER.length - 1)];
    ids.push(`tyres-${want}`);
  }
  if (brakes >= 1) ids.push(`brakes-${brakes}`);
  if (weight >= 1) ids.push(`weight-${weight}`);

  // What the car can take of all that; then the ECU's tune: the highest of its tier and below whose needs are met.
  const fitted: FittedPart[] = [];
  for (let i = 0; i < ids.length; i++) fitted.push({ id: ids[i] });
  const accepted = planParts(facts, fitted).accepted.slice();
  for (let s = ecu; s >= 1; s--) {
    const tunePart = partById(`tune-${s}`) as PartDef;
    if (refusal(facts, tunePart, accepted) === null) { accepted.push(tunePart); break; }
  }
  accepted.sort((a, b) => orderOf(a.id) - orderOf(b.id));

  let kit = false, nitrous = false;
  for (let i = 0; i < accepted.length; i++) {
    if (accepted[i].kind === 'turbo-kit' || accepted[i].kind === 'supercharger-kit') kit = true;
    if (accepted[i].kind === 'nitrous') nitrous = true;
  }
  const setup: Setup = {};
  const st = sliderOf(t.turbo), sn = sliderOf(t.nitrous), sa = sliderOf(t.aero), sb = sliderOf(t.bias);
  const sr = sliderOf(t.ride), ss = sliderOf(t.stiff), sg = sliderOf(t.gears);
  if (st !== 0 && (facts.boosted || kit)) {
    // Later and harder (+1), or sooner and softer (-1).
    setup.boostTarget = 1 + SLIDER.boost * st;
    if (facts.turbo || hasKind(accepted, 'turbo-kit')) setup.spoolTime = 1 + SLIDER.spool * st;
  }
  if (sn !== 0 && nitrous) setup.nitrousPower = 1 + SLIDER.shot * sn;
  if (sa > 0) { setup.aeroFront = MODEST_AERO.front * sa; setup.aeroRear = MODEST_AERO.rear * sa; }
  if (sb !== 0) {
    const ff = 2 * m.brakes.maxTorqueFront / m.tyreFront.radius, fr = 2 * m.brakes.maxTorqueRear / m.tyreRear.radius;
    setup.brakeBias = ff / (ff + fr) + SLIDER.bias * sb;
  }
  if (sr !== 0) setup.rideHeightDrop = SLIDER.ride * sr;
  if (ss !== 0) {
    const k = 1 + SLIDER.stiff * ss;
    setup.springFront = k; setup.springRear = k; setup.damperFront = k; setup.damperRear = k;
  }
  if (sg !== 0) setup.finalDrive = 1 + SLIDER.gears * sg;
  const parts: FittedPart[] = [];
  for (let i = 0; i < accepted.length; i++) parts.push({ id: accepted[i].id });
  return { parts, setup };
}

function hasKind(list: readonly PartDef[], kind: PartKind): boolean {
  for (let i = 0; i < list.length; i++) if (list[i].kind === kind) return true;
  return false;
}
