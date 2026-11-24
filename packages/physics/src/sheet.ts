// Figures in (DESIGN.md section 7, first part): the physics sheet and the three ways one is made.
// A sheet keeps every figure in the unit its source printed it in, with who printed it; resolve.ts converts once and
// falls back to the class tables (classes.ts) for every field left null. So a builder here never invents a figure:
// what it cannot read with confidence it leaves null, and the class tables, which are the only place a typical value
// lives, take over.
//   sheetFromResearch  a researched record (data/research/*.json). A figure that is refuted, cannot be read, or lies
//                      outside any sane range for the car is left out and named (sheetProblems), never guessed.
//   sheetFromTable     an estimated sheet from one row of the game's car table: only what the row says.
//   sheetFromAuthored  a drawn, fictional rental car, one to one.
// Nothing here runs inside the step, so it may allocate; it still keeps to rule 3's arithmetic like all of src/.
import type {
  AwdKind, BodyClass, BrakeGrade, DiffKind, Drivetrain, EngineLocation, Induction, PhysicsSheet, Powertrain, SheetTests,
  Source, SourceKind, Sourced, SuspensionGrade, TransmissionType, TyreCategory,
} from './types';
import { HP, IN, LB, LBFT, RPM, SQFT, parseTyreSize } from './units';

/* ------------------------------------------------------------------ the fixed shapes (DESIGN.md section 10) */

/** One figure of a research record, as data/research/README.md describes it. */
export type ResearchField = { key: string; number?: number; numbers?: number[]; text?: string; publisher?: string; url?: string; sourceKind?: string; note?: string; check?: string };
/** One researched car configuration: data/research/<id>.json. */
export type ResearchRecord = { id: string; year: number; make: string; model: string; trim: string; bodyClass: string; gathered?: string; fields: ResearchField[] };
/** One row of the game's car table (apps/sim carSpecs.ts): six published figures and the engine in words. */
export type TableRow = { make: string; model: string; bodyClass: BodyClass; engine: string; hp: number; weightLb: number; zeroToSixty: number; topSpeedMph: number; drive: Drivetrain };
/**
 * A drawn rental car as the game authored it, SI: mass kg as driven, a and b m (centre of gravity to front and rear
 * axle), h m (centre-of-gravity height), cd, area m^2, redline rpm, r m (loaded tyre radius), fin (final drive),
 * gears (first gear first), tq [rpm, N m] at full throttle.
 */
export type AuthoredSpec = { id: string; name: string; drive: 'FWD' | 'RWD' | 'AWD'; mass: number; a: number; b: number; h: number; cd: number; area: number; redline: number; r: number; fin: number; gears: number[]; tq: [number, number][] };

/** A figure a sheet builder left out, and why, in words a researcher can act on. */
export type SheetProblem = { key: string; value: string; reason: string };

/**
 * What reading one research record gave: the sheet; the keys whose figures it holds; what was dropped and why; the
 * keys on file that are not inputs to the model (kept for the card or as cross-checks); and remarks on what it kept.
 */
export type ResearchReading = { sheet: PhysicsSheet; used: string[]; dropped: SheetProblem[]; unused: string[]; notes: SheetProblem[] };

/* ------------------------------------------------------------------ constants */

/** The driver resolve.ts adds to the curb weight, kg (DESIGN.md section 7). */
export const DRIVER_KG = 75;
/** The loaded radius resolve.ts takes for a tyre, as a share of the unloaded radius its size gives. */
export const LOADED_RADIUS_SHARE = 0.97;
/** The note every figure from the game's car table carries. */
export const TABLE_NOTE = 'MiCar World car table: one common US trim stands for the model. Not verified.';
/**
 * The model year a table sheet stands for. The table has no year; its figures are a common US trim of the 2013 to
 * 2024 model years the auction sells, so the earliest of them. Any year from 2012 on gives the resolver's rule for
 * ABS, traction and stability control the right answer (DESIGN.md section 7).
 */
export const TABLE_YEAR = 2013;
/** The model year a drawn rental car stands for: a current car, so it carries the systems every car since 2012 has. */
export const AUTHORED_YEAR = 2024;

// hp = lb ft x rpm / 5252.1: power is torque times shaft speed, in the published units.
const LBFT_RPM_PER_HP = HP / (LBFT * RPM);

/* ------------------------------------------------------------------ an empty sheet */

function emptyTests(): SheetTests {
  return {
    zeroToThirtySec: null, zeroToSixtySec: null, zeroToHundredSec: null, rollout: null,
    quarterMileSec: null, quarterMileMph: null, braking60to0Ft: null, braking70to0Ft: null,
    skidpadG: null, skidpadDiameterFt: null, topSpeedMph: null, testWeightLb: null, testWeightDistFrontPct: null,
  };
}

/** A sheet for this car with every figure null and nothing calibrated: the class tables would supply all of it. */
export function emptySheet(id: string, identity: PhysicsSheet['identity']): PhysicsSheet {
  return {
    id, identity: { year: identity.year, make: identity.make, model: identity.model, trim: identity.trim, bodyClass: identity.bodyClass },
    curbWeightLb: null, weightDistFrontPct: null,
    wheelbaseIn: null, trackFrontIn: null, trackRearIn: null, lengthIn: null, widthIn: null, heightIn: null, groundClearanceIn: null, cgHeightIn: null,
    powertrain: null, induction: null, engineLocation: null,
    displacementL: null, cylinders: null,
    horsepower: null, horsepowerRpm: null, torqueLbFt: null,
    torqueRpmLow: null, torqueRpmHigh: null,
    redlineRpm: null, boostPsi: null, compressionRatio: null,
    torqueCurve: null,
    drivetrain: null, awdKind: null,
    transmissionType: null,
    gearRatios: null,
    finalDriveRatio: null,
    diffFront: null, diffRear: null,
    tyreFront: null, tyreRear: null, tyreCategory: null,
    dragCoefficient: null, frontalAreaSqFt: null, liftCoefficientFront: null, liftCoefficientRear: null,
    roadLoadA: null, roadLoadB: null, roadLoadC: null,
    steeringRatio: null, turningCircleFt: null,
    suspensionGrade: null, brakeGrade: null,
    topSpeedMph: null, topSpeedGoverned: null,
    abs: null, tractionControl: null, stabilityControl: null, launchControl: null,
    tests: emptyTests(),
    calibration: { tyreGripScale: null, dragAreaM2: null },
  };
}

/* ------------------------------------------------------------------ sane ranges */

type SN = Sourced<number> | null;
type SB = Sourced<boolean> | null;
type NumberKey = { [K in keyof PhysicsSheet]-?: PhysicsSheet[K] extends SN ? (SN extends PhysicsSheet[K] ? K : never) : never }[keyof PhysicsSheet];
type TestNumberKey = { [K in keyof SheetTests]-?: SheetTests[K] extends SN ? (SN extends SheetTests[K] ? K : never) : never }[keyof SheetTests];
type FlagKey = { [K in keyof PhysicsSheet]-?: PhysicsSheet[K] extends SB ? (SB extends PhysicsSheet[K] ? K : never) : never }[keyof PhysicsSheet];

// The ranges are wide on purpose: they catch a unit slip (millimetres in an inch field), a typo or a figure for some
// other machine, never a merely unusual car. Each end is past the most extreme road car on sale.
type NumberRule = { key: NumberKey; lo: number; hi: number; unit: string; whole?: boolean };
const NUMBER_RULES: readonly NumberRule[] = [
  { key: 'wheelbaseIn', lo: 70, hi: 200, unit: 'in' },            // a city car's 73 in to a long-bed crew-cab pickup
  { key: 'trackFrontIn', lo: 40, hi: 90, unit: 'in' },
  { key: 'trackRearIn', lo: 40, hi: 90, unit: 'in' },             // a dually's rear track is about 75 in
  { key: 'lengthIn', lo: 100, hi: 300, unit: 'in' },
  { key: 'widthIn', lo: 55, hi: 110, unit: 'in' },
  { key: 'heightIn', lo: 38, hi: 120, unit: 'in' },               // a Ford GT's 44 in to a high-roof van
  { key: 'weightDistFrontPct', lo: 28, hi: 72, unit: '% front' },
  { key: 'groundClearanceIn', lo: 2, hi: 20, unit: 'in' },
  { key: 'cgHeightIn', lo: 12, hi: 45, unit: 'in' },
  { key: 'displacementL', lo: 0.6, hi: 10, unit: 'L' },
  { key: 'cylinders', lo: 1, hi: 16, unit: 'cylinders', whole: true },
  { key: 'horsepower', lo: 40, hi: 2100, unit: 'hp' },
  { key: 'torqueLbFt', lo: 40, hi: 1800, unit: 'lb ft' },
  { key: 'boostPsi', lo: 1, hi: 45, unit: 'psi' },
  { key: 'compressionRatio', lo: 6, hi: 23, unit: ':1' },
  { key: 'finalDriveRatio', lo: 1.8, hi: 12, unit: ':1' },         // an electric car's single reduction runs to about 9.7
  { key: 'dragCoefficient', lo: 0.18, hi: 0.75, unit: 'Cd' },
  { key: 'frontalAreaSqFt', lo: 12, hi: 60, unit: 'sq ft' },
  { key: 'liftCoefficientFront', lo: -2.5, hi: 1, unit: 'Cl' },
  { key: 'liftCoefficientRear', lo: -2.5, hi: 1, unit: 'Cl' },
  { key: 'roadLoadA', lo: 0, hi: 200, unit: 'lbf' },
  { key: 'roadLoadB', lo: -5, hi: 5, unit: 'lbf/mph' },
  { key: 'roadLoadC', lo: 0.003, hi: 0.2, unit: 'lbf/mph^2' },
  { key: 'steeringRatio', lo: 8, hi: 30, unit: ':1' },
  { key: 'turningCircleFt', lo: 20, hi: 70, unit: 'ft' },
  { key: 'topSpeedMph', lo: 50, hi: 320, unit: 'mph' },
];
// Engine speeds: an electric motor turns far faster than a piston engine and makes its torque from standstill.
type SpeedRule = { key: NumberKey; lo: number; hi: number; loElectric: number; hiElectric: number };
const SPEED_RULES: readonly SpeedRule[] = [
  { key: 'horsepowerRpm', lo: 1500, hi: 12500, loElectric: 1500, hiElectric: 25000 },
  { key: 'torqueRpmLow', lo: 800, hi: 12000, loElectric: 0, hiElectric: 25000 },
  { key: 'torqueRpmHigh', lo: 800, hi: 12000, loElectric: 0, hiElectric: 25000 },
  { key: 'redlineRpm', lo: 3000, hi: 12500, loElectric: 5000, hiElectric: 25000 },
];
type TestRule = { research: string; key: TestNumberKey; lo: number; hi: number; unit: string };
const TEST_RULES: readonly TestRule[] = [
  { research: 'test0to30Sec', key: 'zeroToThirtySec', lo: 0.8, hi: 12, unit: 's' },
  { research: 'test0to60Sec', key: 'zeroToSixtySec', lo: 1.5, hi: 30, unit: 's' },
  { research: 'test0to100Sec', key: 'zeroToHundredSec', lo: 3, hi: 80, unit: 's' },
  { research: 'testQuarterMileSec', key: 'quarterMileSec', lo: 7, hi: 26, unit: 's' },
  { research: 'testQuarterMileMph', key: 'quarterMileMph', lo: 50, hi: 210, unit: 'mph' },
  { research: 'testBraking60to0Ft', key: 'braking60to0Ft', lo: 70, hi: 250, unit: 'ft' },
  { research: 'testBraking70to0Ft', key: 'braking70to0Ft', lo: 100, hi: 330, unit: 'ft' },
  { research: 'testSkidpadG', key: 'skidpadG', lo: 0.5, hi: 1.7, unit: 'g' },
  { research: 'testSkidpadDiameterFt', key: 'skidpadDiameterFt', lo: 100, hi: 600, unit: 'ft' },
  { research: 'testTopSpeedMph', key: 'topSpeedMph', lo: 50, hi: 320, unit: 'mph' },
  { research: 'testWeightDistFrontPct', key: 'testWeightDistFrontPct', lo: 28, hi: 72, unit: '% front' },
];
// Curb weight by body class, lb: the lightest roadster or city car to the heaviest electric truck on sale (a GMC
// Hummer EV is about 9,100 lb). A 9,000 lb pickup is a real truck; a 9,000 lb sedan is a mistake.
const CURB_LB: Record<BodyClass, readonly [number, number]> = {
  sports: [1000, 5500], coupe: [1500, 6000], sedan: [1800, 7000], hatchback: [1400, 5000], wagon: [2000, 6500],
  suv: [2200, 9800], offroad: [2000, 9800], pickup: [2500, 9800], van: [2500, 9000],
};
// A tester weighs the car with fuel, instruments and often a passenger: up to about 800 lb over the curb weight.
const TEST_WEIGHT_EXTRA_LB = 800;

// Keys a research record may carry that are not inputs to the model: the card shows them or they cross-check others.
const NOT_INPUTS: readonly string[] = [
  'engineDescription', 'gearCount', 'tyreModel', 'brakeFrontDiscIn', 'brakeRearDiscIn', 'epaCombinedMpg', 'epaCityMpg', 'epaHighwayMpg',
];

/* ------------------------------------------------------------------ reading words */

const BODY_CLASSES: readonly BodyClass[] = ['sports', 'coupe', 'sedan', 'hatchback', 'wagon', 'suv', 'offroad', 'pickup', 'van'];
const SOURCE_KINDS: readonly SourceKind[] = ['manufacturer', 'agency', 'test', 'reference', 'owner', 'illustrative'];
const AWD_KINDS: readonly AwdKind[] = ['fixed', 'front-on-demand', 'rear-on-demand', 'part-time'];
const DIFF_KINDS: readonly DiffKind[] = ['open', 'limited-slip', 'locked', 'active'];

/** Lower case, every kind of dash a hyphen, single spaces: what the word tests below read. */
function words(text: string): string {
  return text.toLowerCase().replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim();
}

function readBodyClass(text: unknown): BodyClass | null {
  if (typeof text !== 'string') return null;
  const t = words(text);
  for (const c of BODY_CLASSES) if (t === c) return c;
  if (/^(pickup|pick-up|truck|pickup truck)$/.test(t)) return 'pickup';
  if (/^(minivan|mini-van|minibus|passenger van)$/.test(t)) return 'van';
  if (/^(crossover|cuv|sport utility|sport utility vehicle)$/.test(t)) return 'suv';
  if (/^(estate|shooting brake)$/.test(t)) return 'wagon';
  if (/^(liftback|hatch)$/.test(t)) return 'hatchback';
  if (/^(roadster|supercar|sports car)$/.test(t)) return 'sports';
  if (/^saloon$/.test(t)) return 'sedan';
  if (/^(off-road|offroader|off-roader)$/.test(t)) return 'offroad';
  return null;
}

function readPowertrain(text: string): Powertrain | null {
  const t = words(text);
  // A 48 V belt starter-generator only helps a petrol or diesel engine along: neither a hybrid the motor can drive
  // nor plainly not one, so it is not read either way.
  if (/\bmild[- ]?hybrid\b|\bmhev\b|\b48[- ]?v(olt)?\b/.test(t)) return null;
  const hybrid = /\bhybrid\b|\bhev\b|\bphev\b/.test(t);
  if (/\bplug[- ]?in\b|\bphev\b/.test(t)) return hybrid ? 'plug-in-hybrid' : null;   // "plug-in" alone may be a battery car
  if (hybrid) return 'hybrid';
  const electric = /\belectric\b|\bbev\b|\bev\b|\bbattery\b/.test(t);
  const diesel = /\bdiesel\b|\bturbodiesel\b|\btdi\b/.test(t);
  const petrol = /\bgasoline\b|\bpetrol\b|\bgas\b|\bunleaded\b|\bflex[- ]?fuel\b|\be85\b/.test(t);
  if ((electric ? 1 : 0) + (diesel ? 1 : 0) + (petrol ? 1 : 0) !== 1) return null;
  return electric ? 'electric' : diesel ? 'diesel' : 'gasoline';
}

function readInduction(text: string): Induction | null {
  const t = words(text);
  const turbo = /turbo|ecoboost/.test(t);
  const blower = /super[- ]?charg|\bblower\b|\broots[- ]type\b|\btwin[- ]screw\b/.test(t);
  const natural = /\bnatural(ly)?\b|\bnormally aspirated\b|\batmospheric\b|\bnon[- ]turbo\b|\bunboosted\b/.test(t);
  if ((turbo || blower) && natural) return null;
  if (/twin[- ]?charg/.test(t) || (turbo && blower)) return 'twincharged';
  if (/\bquad[- ]?turbo|\bfour turbo/.test(t)) return 'quad-turbo';
  // "Twin-scroll" is one turbocharger with a divided housing, and BMW's "TwinPower Turbo" names that too: neither
  // is two turbochargers, and neither matches here because "twin" is not followed by "turbo".
  if (/\b(twin|bi|dual|two|double)[- ]?turbo|\bsequential turbo/.test(t)) return 'twin-turbo';
  if (turbo) return 'turbo';
  if (blower) return 'supercharged';
  return natural ? 'natural' : null;
}

function readLocation(text: string): EngineLocation | null {
  let t = words(text);
  // Phrases that name an end of the car without placing the engine (a GT-R is front-engined with a rear transaxle).
  t = t.replace(/\b(front|rear|all|four)[- ]wheel[- ]drive\b|\b(front|rear)[- ](mounted )?transaxle\b|\b(front|rear)[- ]drive\b/g, ' ');
  // Front-mid: behind the front axle but ahead of the cabin, a front-engined car for weight split and brakes.
  // Rear-mid: ahead of the rear axle, the mid-engined layout.
  t = t.replace(/\bfront[- ]mid(ship)?\b/g, ' front ').replace(/\brear[- ]mid(ship)?\b/g, ' mid ');
  const front = /\bfront\b/.test(t), mid = /\bmid(ship)?\b/.test(t), rear = /\brear\b/.test(t);
  if ((front ? 1 : 0) + (mid ? 1 : 0) + (rear ? 1 : 0) !== 1) return null;
  return front ? 'front' : mid ? 'mid' : 'rear';
}

function readDrivetrain(text: string): Drivetrain | null {
  let t = words(text);
  // "Rear-biased" or "front-wheel-drive-based" describe how an all-wheel-drive system leans, not which wheels drive.
  t = t.replace(/\b(front|rear)[- ]wheel[- ]drive[- ]based\b|\b(fwd|rwd)[- ]based\b|\b(front|rear)[- ]biased\b/g, ' ');
  const four = /\b4wd\b|\b4x4\b|\bfour[- ]wheel[- ]drive\b|\bpart[- ]time\b/.test(t);
  const all = /\bawd\b|\ball[- ]wheel[- ]drive\b|\bxdrive\b|\bquattro\b|\b4matic\b|\b4motion\b/.test(t);
  const front = /\bfwd\b|\bfront[- ]wheel[- ]drive\b|\bfront[- ]drive\b/.test(t);
  const rear = /\brwd\b|\brear[- ]wheel[- ]drive\b|\brear[- ]drive\b/.test(t);
  if ((four ? 1 : 0) + (all ? 1 : 0) + (front ? 1 : 0) + (rear ? 1 : 0) !== 1) return null;   // "2WD", "4x2": which axle?
  return four ? '4WD' : all ? 'AWD' : front ? 'FWD' : 'RWD';
}

function readTransmission(text: string): TransmissionType | null {
  let t = words(text);
  // A hybrid's power-split device (Toyota's eCVT) is not a belt CVT: it has no ratio range to slip through.
  if (/\be-?cvt\b|\bpower[- ]split\b|\belectronic(ally controlled)? continuously variable\b/.test(t)) return 'ecvt';
  if (/\bcvt\b|\bcontinuously variable\b|\blineartronic\b|\bxtronic\b|\bivt\b|\bav(-s\d+)?\b/.test(t)) return 'cvt';
  if (/\bdual[- ]clutch\b|\bdouble[- ]clutch\b|\btwin[- ]clutch\b|\bdct\b|\bdsg\b|\bpdk\b|\bs[- ]?tronic\b|\bpowershift\b/.test(t)) return 'dual-clutch';
  if (/\bsingle[- ]speed\b|\b1[- ]speed\b|\bone[- ]speed\b|\bsingle[- ]gear\b|\bfixed[- ](gear|ratio)\b|\bdirect[- ]drive\b|\breduction gear\b/.test(t)) return 'single-speed';
  // A single-clutch automated manual (and the EPA's "AM" code, which also covers dual-clutch boxes) is neither a
  // manual nor an automatic as the class tables mean them.
  if (/\bautomated manual\b|\bamt\b|\bsmg\b|\bsingle[- ]clutch\b|\bam-?s?\d+\b/.test(t)) return null;
  // Words that mention the other kind without being it.
  t = t.replace(/\bauto(matic)?[- ]rev[- ]?match\w*/g, ' ')
    .replace(/\bmanual (shift )?(mode|control|gate|shifting)\b|\bmanual shift\w*\b|\bmanumatic\b|\bpaddle\w*\b/g, ' ')
    .replace(/\btiptronic\b|\bsteptronic\b|\bsportmatic\b|\bselect[- ]?shift\b/g, ' automatic ');
  const manual = /\bmanual\b|\bstick[- ]?shift\b|\bmt\b|\bm\d{1,2}\b/.test(t);
  const auto = /\bautomatic\b|\bauto\b|\btorque[- ]converter\b|\b(a|s|a-s)\d{1,2}\b/.test(t);
  if (manual === auto) return null;
  return manual ? 'manual' : 'automatic';
}

function readTyreCategory(text: string): TyreCategory | null {
  const t = words(text);
  // The season words decide the family; two families ("summer and winter sets") are not one tyre.
  const allSeason = /\ball[- ]?season\b|\ba\/s\b|\ball[- ]weather\b/.test(t);
  const terrain = /\ball[- ]?terrain\b|\ba\/t\b|\bmud[- ]terrain\b|\bm\/t\b|\brugged[- ]terrain\b|\br\/t\b|\boff[- ]road\b/.test(t);
  const winter = /\bwinter\b|\bstudless\b|\bstudded\b|\bsnow (tyre|tire)s?\b/.test(t);
  const drag = /\bdrag\b/.test(t);
  if ((allSeason ? 1 : 0) + (terrain ? 1 : 0) + (winter ? 1 : 0) + (drag ? 1 : 0) > 1) return null;
  if (allSeason) return 'all-season';      // "ultra-high performance all-season" is still an all-season tyre
  if (terrain) return 'all-terrain';
  if (winter) return 'winter';
  if (drag) return 'drag';
  // Within the summer family, the most specific grade named.
  if (/\btrack\b|\bcompetition\b|\br[- ]?compound\b|\bextreme performance\b|\bsemi[- ]slick\b|\bdot[- ]r\b/.test(t)) return 'track';
  if (/\bmax(imum)?[- ]performance\b|\bultra[- ]high[- ]performance\b|\buhp\b/.test(t)) return 'max-performance';
  if (/\bsummer\b/.test(t)) return 'summer';
  return null;   // a tyre's name ("Michelin Pilot Sport 4S") is not its category
}

function readSuspension(text: string): SuspensionGrade | null {
  const t = words(text);
  const adaptive = /\badaptive\b|\bmagnetic\b|\bmagneride\b|\bmagnetorheological\b|\belectronic(ally)? (controlled|adjustable) damp|\bactive (suspension|damp)|\bair suspension\b/.test(t);
  const offroad = /\boff[- ]?road\b/.test(t);
  if (adaptive && offroad) return null;
  if (adaptive) return 'adaptive';
  if (offroad) return 'offroad';
  if (/\bsports?\b/.test(t)) return 'sport';
  if (/\bstandard\b|\bconventional\b|\bpassive\b/.test(t)) return 'standard';
  return null;
}

function readBrakeGrade(text: string): BrakeGrade | null {
  const t = words(text);
  if (/\bcarbon[- ]?ceramic\b|\bceramic composite\b|\bpccb\b|\bccb\b|\bccm\b/.test(t)) return 'carbon-ceramic';
  if (/\bperformance\b|\bbig[- ]brake\b|\bbrembo\b|\bakebono\b/.test(t)) return 'performance';
  if (/\bstandard\b|\bconventional\b|\bbase\b/.test(t)) return 'standard';
  return null;
}

/** Which axle a published torque split leaves with nothing ("0:100 front:rear", "100% to the rear"), or both, or none. */
function emptyAxle(t: string): 'front' | 'rear' | 'both' | null {
  const rearFirst = /\brear ?[:\/] ?front\b/.test(t);
  let front0 = false, rear0 = false;
  const split = /\b(\d{1,3}(?:\.\d+)?) ?%? ?[:\/] ?(\d{1,3}(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = split.exec(t)) !== null) {
    const p = Number(m[1]), q = Number(m[2]);
    if (Math.abs(p + q - 100) > 0.5) continue;          // not a split
    const front = rearFirst ? q : p, rear = rearFirst ? p : q;
    if (front === 0) front0 = true;
    if (rear === 0) rear0 = true;
  }
  if (/\b100 ?(%|percent)( of (the )?(torque|power|drive))? (to|at|through|goes to) the rear\b/.test(t)) front0 = true;
  if (/\b100 ?(%|percent)( of (the )?(torque|power|drive))? (to|at|through|goes to) the front\b/.test(t)) rear0 = true;
  return front0 && rear0 ? 'both' : front0 ? 'front' : rear0 ? 'rear' : null;
}

function readAwdKind(text: string): AwdKind | null {
  const t = words(text);
  for (const k of AWD_KINDS) if (t === k) return k;
  if (/\bpart[- ]time\b/.test(t)) {
    // A box with both a part-time and an automatic or full-time mode is not one kind.
    return /\bfull[- ]time\b|\bauto(matic)? (mode|4wd|4x4)\b|\b4a\b/.test(t) ? null : 'part-time';
  }
  // An axle that gets nothing in normal driving means the other one drives and a coupling feeds this one on demand.
  const empty = emptyAxle(t);
  if (empty === 'both') return null;
  if (empty === 'front') return 'rear-on-demand';
  if (empty === 'rear') return 'front-on-demand';
  if (/\bcent(er|re)[- ]diff\w*|\btorsen\b|\bfixed (torque )?split\b|\bplanetary cent/.test(t)) return 'fixed';
  const coupling = /\bon[- ]demand\b|\bcoupling\b|\bmulti[- ]plate\b|\bclutch[- ]pack\b|\btransfer clutch\b|\bhaldex\b|\bwhen (needed|required)\b|\bas needed\b|\bwhen (the )?(front |rear )?wheels? (slip|lose)/.test(t);
  const front = /\bfront[- ]biased\b|\bfront[- ]wheel[- ]drive[- ]based\b|\bfwd[- ]based\b|\bfront[- ]drive[- ]based\b|\bprimarily (to )?(the )?front\b/.test(t);
  const rear = /\brear[- ]biased\b|\brear[- ]wheel[- ]drive[- ]based\b|\brwd[- ]based\b|\brear[- ]drive[- ]based\b|\bprimarily (to )?(the )?rear\b/.test(t);
  if (coupling && front !== rear) return front ? 'front-on-demand' : 'rear-on-demand';
  return null;   // a brand name or "intelligent all-wheel drive" says nothing about the hardware
}

// One clause's differential: a kind, 'unclear' when it says something that cannot be pinned down, or null when it
// names no kind at all.
function diffKindOf(clause: string): DiffKind | 'unclear' | null {
  if (/\b(optional|available|option)\b/.test(clause)) return 'unclear';   // may not be on this configuration
  // Brakes on an open differential (VW's XDS, "electronic differential lock") leave the differential open.
  if (/\bno (limited[- ]?slip|lsd)\b|\bbrake[- ]?(based|actuated)\b|\bby brak\w*|\belectronic differential lock\b|\bedl\b|\bxds\b/.test(clause)) return 'open';
  const families: readonly (readonly [RegExp, DiffKind])[] = [
    // GM's G80 locks by itself when one wheel outruns the other: it limits slip.
    [/\bautomatic(ally)?[- ]lock\w*|\bauto[- ]?lock\w*|\bg80\b/, 'limited-slip'],
    [/\belectronic(ally)?[- ](controlled )?limited[- ]?slip|\be-?lsd\b|\be-?diff\b|\bactive (limited[- ]?slip|m differential|diff\w*)|\btorque[- ]vectoring diff\w*/, 'active'],
    // A selectable locker is open on the road: the driver locks it off the road, at walking pace.
    [/\block(ing|er|ers)\b|\btru[- ]?lok\b/, 'open'],
    [/\blimited[- ]?slip\b|\blsd\b|\btorsen\b|\bhelical\b|\bquaife\b|\bclutch[- ]type\b|\bmulti[- ]plate\b|\bviscous\b/, 'limited-slip'],
    [/\bopen\b|\bconventional\b/, 'open'],
  ];
  let t = clause, found: DiffKind | null = null;
  for (const [re, kind] of families) {
    if (!re.test(t)) continue;
    if (found !== null && found !== kind) return 'unclear';
    found = kind;
    t = t.replace(new RegExp(re.source, 'g'), ' ');   // so "electronic limited-slip" is not read again as limited-slip
  }
  return found;
}

/** The differential at each axle from the record's words. A clause naming no axle speaks for the driven one of a two-wheel-drive car. */
function readDiffs(text: string, drive: Drivetrain | null): { front: DiffKind | null; rear: DiffKind | null } {
  const front: (DiffKind | 'unclear')[] = [], rear: (DiffKind | 'unclear')[] = [], unnamed: (DiffKind | 'unclear')[] = [];
  const place = (clause: string, split: boolean): void => {
    const c = clause.replace(/\b(front|rear|all|four)[- ]wheel[- ]drive\b/g, ' ');
    const kind = diffKindOf(c);
    if (kind === null) return;
    const f = /\bfront\b/.test(c), r = /\brear\b/.test(c);
    // "Open front and limited-slip rear": two axles and two kinds in one clause; read each half on its own.
    if (kind === 'unclear' && f && r && split) { for (const part of c.split(/\band\b/)) place(part, false); return; }
    if (f) front.push(kind);
    if (r) rear.push(kind);
    if (!f && !r && !/\bcent(er|re)\b/.test(c)) unnamed.push(kind);
  };
  for (const clause of words(text).split(/[;,()[\]]/)) place(clause, true);
  if (drive === 'FWD') front.push(...unnamed);
  if (drive === 'RWD') rear.push(...unnamed);
  const settle = (kinds: (DiffKind | 'unclear')[]): DiffKind | null => {
    if (kinds.length === 0) return null;
    for (const k of kinds) if (k === 'unclear' || k !== kinds[0]) return null;
    return kinds[0] as DiffKind;
  };
  return { front: settle(front), rear: settle(rear) };
}

function readFlag(text: string, yes: RegExp | null, no: RegExp | null): boolean | null {
  const t = words(text);
  if (/^(false|no|n|none|not fitted|not available)$/.test(t) || (no !== null && no.test(t))) return false;
  if (/^(true|yes|y|standard|fitted)$/.test(t) || (yes !== null && yes.test(t))) return true;
  return null;
}

/* ------------------------------------------------------------------ reading a research record */

function show(f: ResearchField): string {
  const raw = (f as ResearchField & { value?: unknown }).value;
  if (f.number !== undefined) return String(f.number);
  if (f.numbers !== undefined) return JSON.stringify(f.numbers);
  if (f.text !== undefined) return String(f.text);
  return raw !== undefined ? String(raw) : '';
}

function textOf(f: ResearchField): string | null {
  return typeof f.text === 'string' && f.text.trim() !== '' ? f.text.trim() : null;
}

// A figure as a number: the field's number, or a text that is nothing but a number (a ratio may say "3.73:1").
// Text with a unit in it is not read: "1600 mm" in an inch field is exactly the slip this must not let through.
function numberOf(f: ResearchField): number | null {
  const raw: unknown = f.number;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = typeof raw === 'string' ? raw : raw === undefined && f.numbers === undefined ? f.text : undefined;
  if (typeof text !== 'string') return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(?::\s*1)?\s*$/.exec(text.replace(/,(?=\d{3}\b)/g, ''));
  return m ? Number(m[1]) : null;
}

// README gives a flag as "true or false" without saying in which property, so a JSON true, 1/0 or the words all count.
function flagOf(f: ResearchField, yes: RegExp | null, no: RegExp | null): boolean | null {
  const raw = (f as ResearchField & { value?: unknown }).value;
  for (const v of [f.text as unknown, f.number as unknown, raw]) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : null;
    if (typeof v === 'string') return readFlag(v, yes, no);
  }
  return null;
}

function rangeText(lo: number, hi: number, unit: string): string { return `${lo} to ${hi} ${unit}`; }

/**
 * Reads a research record onto a sheet and reports what it did: which keys it used, which figures it left out and why
 * (refuted, unreadable, outside any sane range for the car, or contradicting another figure), and which keys are on
 * file but are not inputs to the model. Throws when the record's identity cannot be read, since the class tables
 * need the body class.
 */
export function readResearch(record: ResearchRecord): ResearchReading {
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (id === '') throw new Error('a research record without an id');
  if (typeof record.year !== 'number' || !Number.isInteger(record.year) || record.year < 1886 || record.year > 2100) throw new Error(`${id}: model year ${String(record.year)} cannot be read`);
  if (typeof record.make !== 'string' || typeof record.model !== 'string') throw new Error(`${id}: make or model missing`);
  const bodyClass = readBodyClass(record.bodyClass);
  if (bodyClass === null) throw new Error(`${id}: body class "${String(record.bodyClass)}" is not one the class tables know (${BODY_CLASSES.join(', ')})`);
  if (!Array.isArray(record.fields)) throw new Error(`${id}: no list of fields`);

  const sheet = emptySheet(id, { year: record.year, make: record.make, model: record.model, trim: typeof record.trim === 'string' ? record.trim : '', bodyClass });
  const asOf = typeof record.gathered === 'string' && record.gathered.trim() !== '' ? record.gathered.trim() : undefined;
  const used: string[] = [], dropped: SheetProblem[] = [], unused: string[] = [], notes: SheetProblem[] = [];
  const drop = (key: string, value: string, reason: string): void => { dropped.push({ key, value, reason }); };

  // One field per key. A refuted figure is gone; two different figures for one key cannot both be the car's.
  const byKey = new Map<string, ResearchField>();
  const order: string[] = [], clashing: string[] = [];
  for (const f of record.fields as unknown[]) {
    const field = f as ResearchField;
    if (field === null || typeof field !== 'object' || typeof field.key !== 'string' || field.key === '') { drop('(no key)', '', 'a field without a key'); continue; }
    const key = field.key;
    if (typeof field.check === 'string' && field.check.trim().toLowerCase() === 'refuted') { drop(key, show(field), 'refuted by the second reader'); continue; }
    if (clashing.indexOf(key) >= 0) { drop(key, show(field), 'more than one figure on file for this key'); continue; }
    const prev = byKey.get(key);
    if (prev === undefined) { byKey.set(key, field); order.push(key); continue; }
    if (show(prev) === show(field)) { notes.push({ key, value: show(field), reason: 'on file twice with the same figure; the first source is kept' }); continue; }
    byKey.delete(key); clashing.push(key);
    drop(key, show(prev), 'more than one figure on file for this key');
    drop(key, show(field), 'more than one figure on file for this key');
  }

  const take = (key: string): ResearchField | null => {
    const f = byKey.get(key);
    if (f === undefined) return null;
    byKey.delete(key);
    return f;
  };
  const sourceOf = (key: string, f: ResearchField): Source => {
    const word = typeof f.sourceKind === 'string' ? f.sourceKind.trim().toLowerCase() : '';
    let kind: SourceKind = 'reference';
    const known = SOURCE_KINDS.indexOf(word as SourceKind);
    if (known >= 0) kind = SOURCE_KINDS[known];
    // An unnamed or unknown kind of source is taken as the weakest claim a researcher makes: republished.
    else notes.push({ key, value: word === '' ? '(none)' : String(f.sourceKind), reason: `${word === '' ? 'no source kind given' : 'source kind not one of the six'}; taken as reference` });
    const s: Source = { kind };
    if (typeof f.publisher === 'string' && f.publisher !== '') s.name = f.publisher;
    if (typeof f.url === 'string' && f.url !== '') s.url = f.url;
    if (asOf !== undefined) s.asOf = asOf;
    if (typeof f.note === 'string' && f.note !== '') s.note = f.note;
    return s;
  };
  const keep = <T>(key: string, f: ResearchField, value: T): Sourced<T> => { used.push(key); return { value, source: sourceOf(key, f) }; };
  const takeWords = <T>(key: string, read: (text: string) => T | null, what: string): Sourced<T> | null => {
    const f = take(key);
    if (f === null) return null;
    const text = textOf(f);
    if (text === null) { drop(key, show(f), `${what} is given in words, and this field has none`); return null; }
    const value = read(text);
    if (value === null) { drop(key, text, `the words do not clearly name ${what}`); return null; }
    return keep(key, f, value);
  };
  const takeNumber = (key: string, lo: number, hi: number, unit: string, whole: boolean, why: string): Sourced<number> | null => {
    const f = take(key);
    if (f === null) return null;
    const v = numberOf(f);
    if (v === null) { drop(key, show(f), 'not a plain number'); return null; }
    if (whole && !Number.isInteger(v)) { drop(key, show(f), 'not a whole number'); return null; }
    if (v < lo || v > hi) { drop(key, show(f), `outside ${rangeText(lo, hi, unit)}${why}`); return null; }
    return keep(key, f, v);
  };
  const takeFlag = (key: string, yes: RegExp | null, no: RegExp | null): Sourced<boolean> | null => {
    const f = take(key);
    if (f === null) return null;
    const v = flagOf(f, yes, no);
    if (v === null) { drop(key, show(f), 'not true or false'); return null; }
    return keep(key, f, v);
  };

  // Words first: the powertrain sets the engine-speed ranges and the drive decides which axle a differential is on.
  sheet.powertrain = takeWords('powertrain', readPowertrain, 'a powertrain (gasoline, diesel, hybrid, plug-in-hybrid, electric)');
  sheet.induction = takeWords('induction', readInduction, 'an induction (natural, turbo, twin-turbo, supercharged)');
  sheet.engineLocation = takeWords('engineLocation', readLocation, 'an engine location (front, mid, rear)');
  sheet.drivetrain = takeWords('drivetrain', readDrivetrain, 'a drive (FWD, RWD, AWD, 4WD)');
  sheet.transmissionType = takeWords('transmissionType', readTransmission, 'a transmission (manual, automatic, dual-clutch, cvt, ecvt, single-speed)');
  sheet.tyreCategory = takeWords('tyreCategory', readTyreCategory, 'a tyre category (all-season, summer, max-performance, track, all-terrain, winter)');
  sheet.suspensionGrade = takeWords('suspensionGrade', readSuspension, 'a suspension grade (standard, sport, adaptive, offroad)');
  sheet.brakeGrade = takeWords('brakeGrade', readBrakeGrade, 'a brake grade (standard, performance, carbon-ceramic)');

  const electric = sheet.powertrain !== null && sheet.powertrain.value === 'electric';
  for (const r of NUMBER_RULES) sheet[r.key] = takeNumber(r.key, r.lo, r.hi, r.unit, r.whole === true, '');
  for (const r of SPEED_RULES) {
    sheet[r.key] = electric
      ? takeNumber(r.key, r.loElectric, r.hiElectric, 'rpm', false, ' for an electric motor')
      : takeNumber(r.key, r.lo, r.hi, 'rpm', false, ' for a piston engine');
  }
  const [curbLo, curbHi] = CURB_LB[bodyClass];
  sheet.curbWeightLb = takeNumber('curbWeightLb', curbLo, curbHi, 'lb', false, ` for a ${bodyClass}`);
  for (const r of TEST_RULES) sheet.tests[r.key] = takeNumber(r.research, r.lo, r.hi, r.unit, false, '');
  sheet.tests.testWeightLb = takeNumber('testWeightLb', curbLo, curbHi + TEST_WEIGHT_EXTRA_LB, 'lb', false, ` for a ${bodyClass} as tested`);

  // Gears: the count on file is not an input, but a list of ratios that disagrees with it is missing a gear or has one too many.
  let gearCount: number | null = null;
  const countField = take('gearCount');
  if (countField !== null) {
    const n = numberOf(countField);
    if (n !== null && Number.isInteger(n) && n >= 1 && n <= 12) { gearCount = n; unused.push('gearCount'); }
    else drop('gearCount', show(countField), 'not a gear count');
  }
  const gears = take('gearRatios');
  if (gears !== null) {
    const list = Array.isArray(gears.numbers) ? gears.numbers : null;
    const ratioRange = list !== null && list.length === 1 ? [0.5, 15] : [0.3, 7.5];   // a single reduction runs to an electric car's 9:1
    const variator = sheet.transmissionType !== null && (sheet.transmissionType.value === 'cvt' || sheet.transmissionType.value === 'ecvt');
    if (list === null || list.length === 0 || !list.every((x) => typeof x === 'number' && Number.isFinite(x))) drop('gearRatios', show(gears), 'not a list of ratios');
    else if (list.length > 12) drop('gearRatios', show(gears), 'more than twelve forward ratios');
    else if (!list.every((x) => x >= ratioRange[0] && x <= ratioRange[1])) drop('gearRatios', show(gears), `a ratio outside ${rangeText(ratioRange[0], ratioRange[1], ':1')}`);
    else if (!list.every((x, i) => i === 0 || x < list[i - 1])) drop('gearRatios', show(gears), 'not falling from first gear to top');
    else if (gearCount !== null && list.length !== gearCount && !(variator && list.length === 2)) drop('gearRatios', show(gears), `${gearCount} gears on file but ${list.length} ratios`);
    else sheet.gearRatios = keep('gearRatios', gears, list.slice());
  }

  sheet.topSpeedGoverned = takeFlag('topSpeedGoverned', /\b(governed|electronically limited|limited|capped|restricted)\b/, /\b(not (governed|limited|restricted)|ungoverned|unrestricted|derestricted|no governor)\b/);
  sheet.tests.rollout = takeFlag('testRollout', /\b(with|1[- ]?ft|one[- ]foot) rollout\b/, /\b(without|no) rollout\b/);
  const flags: readonly FlagKey[] = ['abs', 'tractionControl', 'stabilityControl', 'launchControl'];
  for (const k of flags) sheet[k] = takeFlag(k, null, null);

  for (const key of ['tyreFront', 'tyreRear'] as const) {
    const f = take(key);
    if (f === null) continue;
    const text = textOf(f);
    const size = text === null ? null : parseTyreSize(text);
    if (text === null || size === null) { drop(key, show(f), 'not a tyre size as printed (245/35ZR19, LT285/70R17, 33x12.50R17)'); continue; }
    if (size.width < 0.125 || size.width > 0.405 || size.rimIn < 12 || size.rimIn > 26 || size.radius < 0.24 || size.radius > 0.5) {
      drop(key, text, 'a size no road car runs on'); continue;
    }
    sheet[key] = keep(key, f, text);
  }

  // All-wheel-drive hardware and differentials: only when the words leave no doubt.
  const drive = sheet.drivetrain === null ? null : sheet.drivetrain.value;
  for (const key of ['awdSystem', 'awdKind']) {
    const f = take(key);
    if (f === null) continue;
    if (drive === 'FWD' || drive === 'RWD') { drop(key, show(f), `the car is ${drive}`); continue; }
    if (sheet.awdKind !== null) { drop(key, show(f), 'the all-wheel-drive kind is already read from another key'); continue; }
    const text = textOf(f);
    const kind = text === null ? null : readAwdKind(text);
    if (kind === null) { drop(key, show(f), 'the words do not clearly say fixed split, on demand (of which axle) or part-time'); continue; }
    sheet.awdKind = keep(key, f, kind);
  }
  const diffs = take('differential');
  if (diffs !== null) {
    const text = textOf(diffs);
    const read = text === null ? { front: null, rear: null } : readDiffs(text, drive);
    if (read.front === null && read.rear === null) drop('differential', show(diffs), 'the words do not clearly give a differential kind for a named or driven axle');
    else {
      used.push('differential');
      const src = sourceOf('differential', diffs);
      if (read.front !== null) sheet.diffFront = { value: read.front, source: src };
      if (read.rear !== null) sheet.diffRear = { value: read.rear, source: { ...src } };
    }
  }
  for (const key of ['diffFront', 'diffRear'] as const) {
    const f = take(key);
    if (f === null) continue;
    if (sheet[key] !== null) { drop(key, show(f), 'already read from the differential words'); continue; }
    const text = textOf(f);
    const exact = text === null ? -1 : DIFF_KINDS.indexOf(words(text) as DiffKind);
    const kind = exact >= 0 ? DIFF_KINDS[exact] : text === null ? null : diffKindOf(words(text));
    if (kind === null || kind === 'unclear') { drop(key, show(f), 'not a clear differential kind (open, limited-slip, locked, active)'); continue; }
    sheet[key] = keep(key, f, kind);
  }

  for (const key of NOT_INPUTS) if (key !== 'gearCount' && take(key) !== null) unused.push(key);
  for (const key of order) if (byKey.has(key)) { drop(key, show(byKey.get(key) as ResearchField), 'not a key of the research format (data/research/README.md)'); byKey.delete(key); }

  // Figures that cannot all be true together. Which one is wrong cannot be told from here, so each one involved
  // goes, except where the peak figures are the anchor: makers print peak power and torque far more reliably than
  // the speeds they come at.
  const unkeep = (key: NumberKey, reason: string): void => {
    const v = sheet[key];
    if (v === null) return;
    drop(key, String(v.value), reason);
    sheet[key] = null;
    const i = used.indexOf(key);
    if (i >= 0) used.splice(i, 1);
  };
  const val = (key: NumberKey): number | null => { const v = sheet[key]; return v === null ? null : v.value; };
  const wheelbase = val('wheelbaseIn'), length = val('lengthIn');
  if (wheelbase !== null && length !== null && wheelbase >= length) {
    unkeep('wheelbaseIn', `not shorter than the ${length} in length`); unkeep('lengthIn', `not longer than the ${wheelbase} in wheelbase`);
  }
  const width = val('widthIn');
  for (const key of ['trackFrontIn', 'trackRearIn'] as const) {
    const track = val(key);
    if (track !== null && width !== null && track >= width) { unkeep(key, `not narrower than the ${width} in body`); unkeep('widthIn', `narrower than the ${track} in ${key === 'trackFrontIn' ? 'front' : 'rear'} track`); }
  }
  const litres = val('displacementL'), cylinders = val('cylinders');
  if (litres !== null && cylinders !== null && (litres / cylinders < 0.12 || litres / cylinders > 1.3)) {
    const per = Math.round(litres / cylinders * 1000) / 1000;
    unkeep('displacementL', `${per} L a cylinder is no car engine's`); unkeep('cylinders', `${per} L a cylinder is no car engine's`);
  }
  const lowRpm = val('torqueRpmLow'), highRpm = val('torqueRpmHigh');
  if (lowRpm !== null && highRpm !== null && highRpm < lowRpm) {
    unkeep('torqueRpmLow', `above the ${highRpm} rpm top of the torque plateau`); unkeep('torqueRpmHigh', `below the ${lowRpm} rpm start of the torque plateau`);
  }
  // Power is torque times speed, so at the power peak the engine makes P / omega, which cannot exceed its peak
  // torque; and at the torque peak it makes T omega, which cannot exceed its peak power. 2% allows for rounding.
  const hp = val('horsepower'), torque = val('torqueLbFt'), hpRpm = val('horsepowerRpm');
  if (hp !== null && torque !== null && hpRpm !== null && hp * LBFT_RPM_PER_HP / hpRpm > torque * 1.02) {
    unkeep('horsepowerRpm', `${hp} hp at ${hpRpm} rpm needs ${Math.round(hp * LBFT_RPM_PER_HP / hpRpm)} lb ft, more than the ${torque} lb ft peak`);
  }
  for (const key of ['torqueRpmLow', 'torqueRpmHigh'] as const) {
    const rpm = val(key);
    if (hp !== null && torque !== null && rpm !== null && torque * rpm / LBFT_RPM_PER_HP > hp * 1.02) {
      unkeep(key, `${torque} lb ft at ${rpm} rpm is ${Math.round(torque * rpm / LBFT_RPM_PER_HP)} hp, more than the ${hp} hp peak`);
    }
  }
  const redline = val('redlineRpm'), powerRpm = val('horsepowerRpm');
  if (redline !== null && powerRpm !== null && powerRpm > redline) {
    unkeep('redlineRpm', `below the ${powerRpm} rpm power peak`); unkeep('horsepowerRpm', `above the ${redline} rpm redline`);
  }

  return { sheet, used, dropped, unused, notes };
}

/** The physics sheet a research record gives: each figure with its source; refuted, unreadable and insane figures left null. */
export function sheetFromResearch(record: ResearchRecord): PhysicsSheet {
  return readResearch(record).sheet;
}

/** The figures sheetFromResearch leaves out of a research record, each with the reason, for the build script to print. */
export function sheetProblems(record: ResearchRecord): SheetProblem[] {
  return readResearch(record).dropped;
}

/* ------------------------------------------------------------------ a row of the game's car table */

type EngineWords = { displacementL: number | null; cylinders: number | null; induction: Induction | null; powertrain: Powertrain | null };

// The table's engine names follow one convention ("2.5L I4", "3.0L Twin-Turbo I6", "1.8L I4 Hybrid", "2.7L EcoBoost
// V6"): every departure from a naturally aspirated petrol engine is named. So the absence of a boost word is read as
// natural and of a fuel word as gasoline, while an engine the words do not describe at all is left null.
function readEngineWords(engine: string): EngineWords {
  const t = words(engine);
  const litres = /(\d+(?:\.\d+)?) ?-?(l|liter|litre)\b/.exec(t);
  const cyl = /\b(?:[ivhw]|flat|boxer)[- ]?(\d{1,2})\b/.exec(t);
  const displacementL = litres ? Number(litres[1]) : null;
  const cylinders = cyl ? Number(cyl[1]) : null;
  const electric = /\belectric\b|\bev\b|\bmotor\b|\bkwh?\b/.test(t) && displacementL === null;
  let powertrain: Powertrain | null = null;
  if (/\bplug[- ]?in\b|\bphev\b/.test(t)) powertrain = 'plug-in-hybrid';
  else if (/\bhybrid\b/.test(t)) powertrain = 'hybrid';
  else if (/\bdiesel\b|\btdi\b/.test(t)) powertrain = 'diesel';
  else if (electric) powertrain = 'electric';
  else if (displacementL !== null) powertrain = 'gasoline';
  let induction: Induction | null = null;
  if (/\btwin[- ]?charg/.test(t)) induction = 'twincharged';
  else if (/\b(twin|bi|dual)[- ]?turbo/.test(t)) induction = 'twin-turbo';
  else if (/turbo|ecoboost/.test(t)) induction = 'turbo';
  else if (/super[- ]?charg/.test(t)) induction = 'supercharged';
  else if (displacementL !== null) induction = 'natural';
  return { displacementL, cylinders, induction, powertrain };
}

/** Builds a table row's sheet and names any of its figures left out as outside a sane range or unreadable. */
function readTable(row: TableRow): { sheet: PhysicsSheet; dropped: SheetProblem[] } {
  const slug = (s: string): string => words(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const sheet = emptySheet(`table-${slug(row.make)}-${slug(row.model)}`, { year: TABLE_YEAR, make: row.make, model: row.model, trim: 'common US trim', bodyClass: row.bodyClass });
  const dropped: SheetProblem[] = [];
  const source = (): Source => ({ kind: 'reference', name: 'MiCar World car table', note: TABLE_NOTE });
  const figure = (key: string, v: number, lo: number, hi: number, unit: string): Sourced<number> | null => {
    if (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi) return { value: v, source: source() };
    dropped.push({ key, value: String(v), reason: `outside ${rangeText(lo, hi, unit)}` });
    return null;
  };
  const engine = readEngineWords(typeof row.engine === 'string' ? row.engine : '');
  if (engine.displacementL !== null) sheet.displacementL = figure('displacementL', engine.displacementL, 0.6, 10, 'L');
  if (engine.cylinders !== null) sheet.cylinders = figure('cylinders', engine.cylinders, 1, 16, 'cylinders');
  if (engine.powertrain !== 'electric' && (engine.displacementL === null || engine.cylinders === null)) {
    dropped.push({ key: 'engine', value: String(row.engine), reason: 'the words do not give both a displacement and a cylinder count' });
  }
  if (engine.induction !== null) sheet.induction = { value: engine.induction, source: source() };
  if (engine.powertrain !== null) sheet.powertrain = { value: engine.powertrain, source: source() };
  sheet.horsepower = figure('horsepower', row.hp, 40, 2100, 'hp');
  const [lo, hi] = CURB_LB[row.bodyClass];
  sheet.curbWeightLb = figure('curbWeightLb', row.weightLb, lo, hi, `lb for a ${row.bodyClass}`);
  sheet.drivetrain = { value: row.drive, source: source() };
  // The table's top speed is the rated one: for these road cars a limiter, not the air, sets it.
  sheet.topSpeedMph = figure('topSpeedMph', row.topSpeedMph, 50, 320, 'mph');
  if (sheet.topSpeedMph !== null) sheet.topSpeedGoverned = { value: true, source: source() };
  sheet.tests.zeroToSixtySec = figure('zeroToSixty', row.zeroToSixty, 1.5, 30, 's');
  return { sheet, dropped };
}

/**
 * An estimated sheet for a row of the game's car table: displacement, cylinders, induction and powertrain read from
 * the engine words, horsepower, curb weight, drive and the rated top speed (as governed). The row's 0-60 goes to
 * tests only. Everything else is left null for the class tables. Every figure is kind "reference", marked not verified.
 */
export function sheetFromTable(row: TableRow): PhysicsSheet {
  return readTable(row).sheet;
}

/** The figures of a table row that sheetFromTable left out, and why (an empty list for a sound row). */
export function tableProblems(row: TableRow): SheetProblem[] {
  return readTable(row).dropped;
}

/* ------------------------------------------------------------------ a drawn rental car */

/**
 * A tyre size, as printed, whose loaded radius in the resolver (LOADED_RADIUS_SHARE of the unloaded radius) is the
 * given one to within 0.15%. The section width follows the load the tyre carries (about 195 mm on a 1,000 kg car,
 * 245 mm on 1,700 kg); among the sizes that fit, the one a maker would more likely fit: that width, a profile in
 * steps of five, near a 50 series.
 */
export function tyreSizeFor(loadedRadius: number, massKg: number): string {
  const unloaded = loadedRadius / LOADED_RADIUS_SHARE;
  const base = 10 * Math.round((115 + 0.075 * massKg) / 10) + 5;
  let best = '', bestCost = Infinity, closest = '', closestErr = Infinity;
  for (const width of [base, base - 10, base + 10, base - 20, base + 20]) {
    if (width < 145 || width > 335) continue;
    for (let rim = 13; rim <= 22; rim++) {
      for (let aspect = 30; aspect <= 70; aspect++) {   // the profiles road cars run on
        const err = Math.abs(rim * IN / 2 + width / 1000 * aspect / 100 - unloaded) / unloaded;
        const size = `${width}/${aspect}R${rim}`;
        if (err < closestErr) { closestErr = err; closest = size; }
        if (err > 0.0015) continue;
        const cost = Math.abs(width - base) / 10 + (aspect % 5 === 0 ? 0 : 1) + Math.abs(aspect - 50) / 10 + err;
        if (cost < bestCost) { bestCost = cost; best = size; }
      }
    }
  }
  if (best !== '') return best;
  if (closest === '' || closestErr > 0.005) throw new Error(`no road tyre has a loaded radius of ${loadedRadius} m`);
  return closest;
}

/**
 * A drawn, fictional rental car converted one to one (sources kind "illustrative"): its mass less the resolver's
 * 75 kg driver as curb weight, wheelbase and weight split from a and b, centre-of-gravity height, Cd and frontal area,
 * redline, the authored torque curve, gears, final drive, drive, and a tyre size chosen so the resolver's loaded
 * radius is the drawn r.
 */
export function sheetFromAuthored(spec: AuthoredSpec, bodyClass: BodyClass): PhysicsSheet {
  if (!(spec.mass > DRIVER_KG) || !(spec.a > 0) || !(spec.b > 0) || !(spec.h > 0) || !(spec.r > 0)) {
    throw new Error(`${spec.id}: mass, a, b, h and r must be positive (and the mass more than the driver)`);
  }
  const sheet = emptySheet(spec.id, { year: AUTHORED_YEAR, make: 'MiCar', model: spec.name, trim: 'rental (drawn, fictional)', bodyClass });
  const source = (note?: string): Source => {
    const s: Source = { kind: 'illustrative', name: 'MiCar rental fleet (drawn)' };
    s.note = note === undefined ? 'A drawn, fictional car: its authored figure, converted one to one.' : note;
    return s;
  };
  const n = (value: number, note?: string): Sourced<number> => ({ value, source: source(note) });
  const wheelbase = spec.a + spec.b;
  sheet.curbWeightLb = n((spec.mass - DRIVER_KG) / LB, `Authored mass ${spec.mass} kg as driven, less the ${DRIVER_KG} kg driver the resolver adds.`);
  sheet.wheelbaseIn = n(wheelbase / IN, `a + b = ${spec.a} + ${spec.b} m.`);
  // The share of weight on the front axle is the rear lever over the wheelbase: the resolver's a = L (1 - share) gives back a.
  sheet.weightDistFrontPct = n(100 * spec.b / wheelbase, `b / (a + b) with a = ${spec.a} m, b = ${spec.b} m.`);
  sheet.cgHeightIn = n(spec.h / IN);
  sheet.dragCoefficient = n(spec.cd);
  sheet.frontalAreaSqFt = n(spec.area / SQFT);
  sheet.redlineRpm = n(spec.redline);
  sheet.torqueCurve = { value: spec.tq.map((p): [number, number] => [p[0], p[1]]), source: source('The authored full-throttle curve, [rpm, N m].') };
  sheet.gearRatios = { value: spec.gears.slice(), source: source() };
  sheet.finalDriveRatio = n(spec.fin);
  sheet.drivetrain = { value: spec.drive, source: source() };
  const size = tyreSizeFor(spec.r, spec.mass);
  const note = `Synthesised: ${LOADED_RADIUS_SHARE} of this size's unloaded radius is the drawn loaded radius ${spec.r} m.`;
  sheet.tyreFront = { value: size, source: source(note) };
  sheet.tyreRear = { value: size, source: source(note) };
  return sheet;
}
