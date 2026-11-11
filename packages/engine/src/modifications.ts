// The modification engine: the catalogue of what can be fitted to a vehicle and what each fitment does to it.
// It exists so that a modification is never a free bonus. Each one changes specification figures (horsepower, torque,
// weight, economy, clearance) that are then scored by the same tables as any factory figure, adds stated points to
// the modelled indexes, and carries its price: a turbo kit gives power and takes reliability and economy. What it
// costs in reliability and durability depends on who fitted it and whether its upkeep is documented.
// Nothing here stores anything: the factory specification is never changed, a modified copy is returned.
import { combinedEconomy, estimateTopSpeedMph } from './normalize';
import type { ScoreAdjustments } from './normalize';
import { ACCELERATION, HANDLING, SPEC_RANGES } from './rules';
import type { ActiveModification, InstallQuality, ModCategory, ModTier, Sourced, SpecField, VehicleSpec } from './types';
import { isNumber, timestampKey } from './util';

/**
 * What one tier of a modification does.
 * Multipliers (1 = no change): horsepower, torque, weight, economy, sprint (the 0-60 time, so below 1 is quicker), topSpeed.
 * Additions (0 = no change): clearanceIn (inches of ground clearance), gripG (lateral grip in g), durability and
 * reliability (points on the two modelled indexes), originality (points taken off the Originality grade).
 */
export type ModEffect = { horsepower: number; torque: number; weight: number; economy: number; sprint: number; topSpeed: number; clearanceIn: number; gripG: number; durability: number; reliability: number; originality: number };

export type ModDefinition = {
  category: ModCategory;
  /** English name for the modification card: "Turbocharger kit". The apps translate it. */
  name: string;
  /** One or two English sentences for the card: what it is, what it gives and what it costs. */
  summary: string;
  /** True for work on a combustion engine: refused on an electric powertrain. */
  combustionOnly: boolean;
  /** Modifications in the same group replace one another: only the latest install of the group counts. */
  group: 'tires' | 'induction' | null;
  /** Street, Pro, Extreme. */
  tiers: readonly [ModEffect, ModEffect, ModEffect];
};

/** The three tiers, in order: tier 1 is Street, 2 is Pro, 3 is Extreme. */
export const MOD_TIER_NAMES = ['Street', 'Pro', 'Extreme'] as const;

const NO_EFFECT: ModEffect = { horsepower: 1, torque: 1, weight: 1, economy: 1, sprint: 1, topSpeed: 1, clearanceIn: 0, gripG: 0, durability: 0, reliability: 0, originality: 0 };

type Triple = readonly [street: number, pro: number, extreme: number];

/** Builds the three tiers of one row of the table: a column that is not listed has no effect. */
function tiers(row: Partial<Record<keyof ModEffect, Triple>>): readonly [ModEffect, ModEffect, ModEffect] {
  const tier = (index: 0 | 1 | 2): ModEffect => {
    const effect = { ...NO_EFFECT };
    for (const column of Object.keys(row) as (keyof ModEffect)[]) {
      const figures = row[column];
      if (figures) effect[column] = figures[index];
    }
    return effect;
  };
  return [tier(0), tier(1), tier(2)];
}

/**
 * The catalogue: fourteen modifications, three tiers each (Street / Pro / Extreme).
 * The vocabulary is the world's Garage (engine, ECU, turbo, transmission, suspension, nitrous, tires, brakes, weight)
 * plus supercharger, intake and exhaust, aero, off-road and economy setups.
 */
export const MODS: Record<ModCategory, ModDefinition> = {
  engine: {
    category: 'engine', name: 'Engine build', combustionOnly: true, group: null,
    summary: 'Internal engine work: pistons, cams and head. More power and torque, at a cost in economy, durability and reliability.',
    tiers: tiers({ horsepower: [1.08, 1.16, 1.25], torque: [1.06, 1.12, 1.2], economy: [0.98, 0.96, 0.93], durability: [-5, -10, -20], reliability: [-20, -45, -80], originality: [10, 18, 28] }),
  },
  ecu: {
    category: 'ecu', name: 'ECU tune', combustionOnly: true, group: null,
    summary: 'A remapped engine computer. More power and torque from the same parts, with less margin left for the engine.',
    tiers: tiers({ horsepower: [1.05, 1.09, 1.13], torque: [1.05, 1.1, 1.15], economy: [1, 0.99, 0.97], durability: [0, -5, -10], reliability: [-10, -25, -45], originality: [4, 6, 8] }),
  },
  'intake-exhaust': {
    category: 'intake-exhaust', name: 'Intake and exhaust', combustionOnly: true, group: null,
    summary: 'A freer-flowing intake and exhaust. A little more power, and at the higher tiers a little less weight and reliability.',
    tiers: tiers({ horsepower: [1.02, 1.04, 1.06], torque: [1.02, 1.03, 1.05], weight: [1, 0.995, 0.99], reliability: [0, -5, -10], originality: [3, 5, 7] }),
  },
  turbo: {
    category: 'turbo', name: 'Turbocharger kit', combustionOnly: true, group: 'induction',
    summary: 'A turbocharger and what it needs around it. A large gain in power and torque that costs economy, durability and reliability.',
    tiers: tiers({ horsepower: [1.25, 1.45, 1.7], torque: [1.25, 1.45, 1.65], weight: [1.01, 1.015, 1.02], economy: [0.94, 0.9, 0.85], durability: [-15, -30, -50], reliability: [-60, -100, -150], originality: [18, 26, 35] }),
  },
  supercharger: {
    category: 'supercharger', name: 'Supercharger kit', combustionOnly: true, group: 'induction',
    summary: 'A belt-driven supercharger. A large gain in power and torque that costs economy, durability and reliability.',
    tiers: tiers({ horsepower: [1.3, 1.45, 1.6], torque: [1.28, 1.4, 1.52], weight: [1.015, 1.02, 1.025], economy: [0.9, 0.86, 0.82], durability: [-15, -25, -45], reliability: [-50, -85, -130], originality: [18, 26, 35] }),
  },
  nitrous: {
    category: 'nitrous', name: 'Nitrous', combustionOnly: true, group: null,
    summary: 'Nitrous oxide injection. A strong gain in power and torque that is hard on the engine.',
    tiers: tiers({ horsepower: [1.1, 1.18, 1.28], torque: [1.1, 1.18, 1.28], weight: [1.005, 1.008, 1.01], durability: [-5, -10, -20], reliability: [-30, -60, -100], originality: [6, 9, 12] }),
  },
  transmission: {
    category: 'transmission', name: 'Transmission and clutch', combustionOnly: false, group: null,
    summary: 'An uprated clutch, gearing and shift hardware. Quicker to 60; the higher tiers are tougher and a little less reliable.',
    tiers: tiers({ sprint: [0.98, 0.96, 0.94], durability: [0, 5, 5], reliability: [0, -5, -15], originality: [4, 7, 10] }),
  },
  suspension: {
    category: 'suspension', name: 'Suspension', combustionOnly: false, group: null,
    summary: 'Lower, stiffer springs and dampers. More grip, less ground clearance and a harder life for the chassis.',
    tiers: tiers({ clearanceIn: [-0.3, -0.6, -1], gripG: [0.02, 0.04, 0.06], durability: [-5, -15, -30], originality: [5, 8, 12] }),
  },
  tires: {
    category: 'tires', name: 'Performance tires', combustionOnly: false, group: 'tires',
    summary: 'Stickier performance tires. More grip and a quicker launch; they cost economy and durability.',
    tiers: tiers({ economy: [0.98, 0.96, 0.93], sprint: [0.99, 0.98, 0.97], gripG: [0.03, 0.06, 0.09], durability: [-5, -15, -30], originality: [2, 3, 4] }),
  },
  brakes: {
    category: 'brakes', name: 'Brakes', combustionOnly: false, group: null,
    summary: 'Larger discs and better pads. A little more control, and the higher tiers stand up to hard use better.',
    tiers: tiers({ gripG: [0.005, 0.01, 0.02], durability: [0, 5, 5], originality: [2, 4, 6] }),
  },
  weight: {
    category: 'weight', name: 'Weight reduction', combustionOnly: false, group: null,
    summary: 'Lighter panels, seats and wheels. Quicker and easier on fuel, with less of the car left to take a knock.',
    tiers: tiers({ weight: [0.97, 0.94, 0.9], durability: [-10, -25, -45], originality: [6, 12, 20] }),
  },
  aero: {
    category: 'aero', name: 'Aero', combustionOnly: false, group: null,
    summary: 'A splitter, a wing and underbody work. More grip, at a cost in top speed and economy.',
    tiers: tiers({ weight: [1.002, 1.004, 1.006], economy: [0.995, 0.99, 0.98], topSpeed: [0.99, 0.98, 0.96], gripG: [0.01, 0.02, 0.04], originality: [3, 5, 8] }),
  },
  offroad: {
    category: 'offroad', name: 'Off-road kit', combustionOnly: false, group: 'tires',
    summary: 'A lift, all-terrain tires and skid plates. More ground clearance and durability; slower, thirstier and less sure on the road.',
    tiers: tiers({ weight: [1.01, 1.02, 1.035], economy: [0.97, 0.94, 0.9], sprint: [1.01, 1.02, 1.04], topSpeed: [0.98, 0.96, 0.93], clearanceIn: [1, 2, 3.5], gripG: [-0.02, -0.04, -0.07], durability: [15, 30, 45], reliability: [0, -5, -10], originality: [6, 10, 15] }),
  },
  eco: {
    category: 'eco', name: 'Economy setup', combustionOnly: false, group: 'tires',
    summary: 'Low-rolling-resistance tires and an economy tune. Better economy, with a little less power, pace and grip.',
    tiers: tiers({ horsepower: [0.99, 0.98, 0.97], economy: [1.03, 1.05, 1.07], sprint: [1.01, 1.02, 1.03], gripG: [-0.01, -0.02, -0.03], reliability: [0, 5, 5], originality: [2, 3, 4] }),
  },
};

/** Who fitted it scales what a modification costs in durability and reliability. Gains are never scaled. */
export const INSTALL_FACTOR: Record<InstallQuality, number> = { professional: 0.75, owner: 1, unknown: 1.25 };

/** How it has been looked after scales the same costs: see ActiveModification['upkeep'] for what each word means. */
export const UPKEEP_FACTOR: Record<ActiveModification['upkeep'], number> = { documented: 0.85, recent: 1, lapsed: 1.15 };

/** The English label of one fitment: "Turbocharger kit · Pro". */
export function modLabel(category: ModCategory, tier: ModTier): string {
  return `${MODS[category].name} · ${MOD_TIER_NAMES[tier - 1]}`;
}

/** A modification on record that does not count, and why. */
export type ModRefusal = { eventId: string; category: ModCategory; reason: string };

/** Why a modification on record does not count. The apps translate these. */
export const MOD_REFUSALS = { notElectric: 'not for an electric powertrain', noPowertrain: 'needs the powertrain on file', replaced: 'replaced by a later fitment' } as const;
const NOT_ELECTRIC = MOD_REFUSALS.notElectric;
const NO_POWERTRAIN = MOD_REFUSALS.noPowertrain;
const REPLACED = MOD_REFUSALS.replaced;

/**
 * Install order: by the day it was fitted, then by when it was written down, then by event id. Plain string
 * comparison, so it is the same in every locale. Without the middle step two parts fitted the same day would be
 * ordered by their ids, which are random: fitting a bigger turbo on the day the car was parked was a coin flip.
 */
function byInstall(a: ActiveModification, b: ActiveModification): number {
  if (a.installedOn !== b.installedOn) return a.installedOn < b.installedOn ? -1 : 1;
  const wa = a.recordedAt ? timestampKey(a.recordedAt) : '', wb = b.recordedAt ? timestampKey(b.recordedAt) : '';
  if (wa !== wb) return wa < wb ? -1 : 1;
  if (a.eventId !== b.eventId) return a.eventId < b.eventId ? -1 : 1;
  return 0;
}

/**
 * Decides which of the modifications on record count for this specification.
 *
 * - A combustion-only modification on an electric powertrain is refused: "not for an electric powertrain". On a
 *   specification with no powertrain on file it waits: "needs the powertrain on file". A blank is not read as an
 *   engine that can take a turbocharger, or clearing the powertrain of an electric car would be worth hundreds of points.
 * - The latest install in a category (by `installedOn`, then when it was written down, then `eventId`) counts; an
 *   earlier one in the same category is refused: "replaced by a later fitment".
 * - Within a group (turbocharger and supercharger; performance tires, off-road kit and economy setup) only the
 *   latest install counts; the others are refused with the same reason.
 * Nothing else is ever refused. Every record comes back in exactly one of the two lists, both in install order,
 * whatever order the records arrive in. The records returned are copies.
 */
export function resolveModifications(spec: VehicleSpec, mods: readonly ActiveModification[]): { applied: ActiveModification[]; refused: ModRefusal[] } {
  return resolve(mods, spec.powertrain === null ? 'blank' : spec.powertrain.value === 'electric' ? 'electric' : 'combustion');
}

function resolve(mods: readonly ActiveModification[], powertrain: 'combustion' | 'electric' | 'blank'): { applied: ActiveModification[]; refused: ModRefusal[] } {
  const ordered = mods.map((mod) => ({ ...mod })).sort(byInstall);
  const applied: ActiveModification[] = [];
  const refused: ModRefusal[] = [];
  const taken = new Set<string>();
  // From the newest to the oldest, so the first fitment met in a category or a group is the one that counts.
  for (let i = ordered.length - 1; i >= 0; i--) {
    const mod = ordered[i];
    const definition = MODS[mod.category];
    const slots = definition.group === null ? [mod.category] : [mod.category, `group:${definition.group}`];
    if (definition.combustionOnly && powertrain !== 'combustion') {
      refused.push({ eventId: mod.eventId, category: mod.category, reason: powertrain === 'electric' ? NOT_ELECTRIC : NO_POWERTRAIN });
    } else if (slots.some((slot) => taken.has(slot))) {
      refused.push({ eventId: mod.eventId, category: mod.category, reason: REPLACED });
    } else {
      for (const slot of slots) taken.add(slot);
      applied.push(mod);
    }
  }
  return { applied: applied.reverse(), refused: refused.reverse() };
}

/** The note a figure carries once a modification has changed it. Its source kind, publisher and day stay as they were. */
const AFTER_MODIFICATIONS = 'after modifications';
/** The figures a modification can move. */
const MOVABLE: readonly SpecField[] = ['horsepower', 'torqueLbFt', 'curbWeightLb', 'combinedMpg', 'cityMpg', 'highwayMpg', 'zeroToSixtySec', 'topSpeedMph', 'groundClearanceIn'];

/** Economy gained for each share of weight removed: 10% lighter is 6% more miles per gallon. */
const ECONOMY_PER_WEIGHT_SHARE = 0.6;

/**
 * A figure with a new value. It is no longer its source's figure: nobody published or measured the result, so it is
 * marked as worked out (an illustrative figure stays illustrative) and says why. A missing figure stays missing, an
 * unmoved one stays as it was, and a result that is not a number (a record with no horsepower to compare) never
 * replaces a figure.
 */
function moved(cell: Sourced<number> | null, value: number | null): Sourced<number> | null {
  if (cell === null || value === null || !isNumber(value) || value === cell.value) return cell;
  return { value, source: { ...cell.source, kind: cell.source.kind === 'illustrative' ? 'illustrative' : 'owner', note: AFTER_MODIFICATIONS } };
}

/**
 * Applies the modifications that count (see resolveModifications) and returns a modified copy of the specification
 * together with the adjustments that are not specification figures. Score the result with
 * `scoreSpec(result.spec, { adjust: result.adjust })`: the same tables as a factory specification, nothing separate.
 *
 * What changes in the copy. A missing (null) figure always stays missing; a changed figure is no longer its source's
 * own, so its source kind becomes 'owner' (or stays 'illustrative') with `note: 'after modifications'`, and the
 * field is named in `changed`. Pass `changed` to scoreSpec as `derived` so the scores that read those figures say
 * they were modelled, not measured.
 * - Horsepower, torque and curb weight are multiplied by the product of the tiers' multipliers.
 * - Combined, city and highway economy are multiplied by the tiers' economy multipliers and by
 *   `1 + 0.6 x (share of weight removed)`: lighter is thriftier (when a curb weight is on file), heavier the reverse.
 *   With no combined figure on file, one is written from the factory blend of city and highway, moved the same way.
 * - Ground clearance gets the sum of the tiers' inches.
 * - A 0-60 time on file is multiplied by `(weight multiplier / horsepower multiplier) ^ 0.75`, and never goes below
 *   the estimate's floor (1.9 s) unless it was already there. A slower time is applied whatever is on file; a
 *   quicker one waits for the horsepower and the curb weight to be on file.
 * - A top speed on file is multiplied by `(horsepower multiplier) ^ (1/3)`. More power raises it only when the sheet
 *   says it is not limited and the horsepower is on file (a blank answer is read as limited); less power lowers it
 *   unless the sheet says it is limited. With no top speed on file, the estimate is held to the same rule: see
 *   `topSpeedCeilingMph` below.
 * - A change that costs the car is never skipped because a figure is blank; a change that helps waits for the figure.
 * More power also raises horsepower per litre, which the stress terms of DURABILITY and RELIABILITY charge for.
 *
 * What goes to `adjust`:
 * - `sprintFactor` and `topSpeedFactor`: the products of the tiers' 0-60 and top-speed multipliers. scoreSpec
 *   applies them to the time and the speed it reads, on file or estimated, governed or not.
 * - `topSpeedCeilingMph`: with no top speed on file, the estimate from the factory figures moved as a figure on file
 *   would have been (null when no part moves power or weight). scoreSpec lets the estimate from the modified figures
 *   go no higher. `topSpeedHeld`: true when the parts add power that would raise the top speed, on file or estimated,
 *   if the sheet said it is not limited, and the answer is blank; scoreSpec then names that field as missing (for an
 *   estimate, only when the estimate was in fact held back).
 * - `gripG`: the sum of the tiers' grip, plus `weight change in lb x HANDLING.model.gripPerLb` when a skidpad figure
 *   is on file (when it is not, the grip model reads the new weight itself). With no curb weight on file, added
 *   weight is charged as a share of the heaviest weight a specification can hold.
 * - `durabilityPoints` and `reliabilityPoints`: the sums of the tiers' points. A loss is first multiplied by
 *   `INSTALL_FACTOR[install] x UPKEEP_FACTOR[upkeep]` of its own modification; a gain is not scaled.
 *
 * The input is never changed, and the order the records arrive in makes no difference.
 */
export function applyModifications(
  spec: VehicleSpec,
  mods: readonly ActiveModification[],
): { spec: VehicleSpec; adjust: Required<ScoreAdjustments>; changed: SpecField[]; applied: ActiveModification[]; refused: ModRefusal[] } {
  const { applied, refused } = resolveModifications(spec, mods);

  let horsepower = 1, torque = 1, weight = 1, economy = 1, sprint = 1, topSpeed = 1;
  let clearance = 0, grip = 0, durability = 0, reliability = 0;
  for (const mod of applied) {
    const effect = MODS[mod.category].tiers[mod.tier - 1];
    const care = INSTALL_FACTOR[mod.install] * UPKEEP_FACTOR[mod.upkeep];
    horsepower *= effect.horsepower;
    torque *= effect.torque;
    weight *= effect.weight;
    economy *= effect.economy;
    sprint *= effect.sprint;
    topSpeed *= effect.topSpeed;
    clearance += effect.clearanceIn;
    grip += effect.gripG;
    durability += effect.durability < 0 ? effect.durability * care : effect.durability;
    reliability += effect.reliability < 0 ? effect.reliability * care : effect.reliability;
  }

  const oldHp = spec.horsepower === null ? null : spec.horsepower.value;
  const oldLb = spec.curbWeightLb === null ? null : spec.curbWeightLb.value;
  const newHp = oldHp === null ? null : oldHp * horsepower;
  const newLb = oldLb === null ? null : oldLb * weight;

  // What the parts do to a figure on file depends only on their multipliers, so it can be worked out whether or not
  // the horsepower and the curb weight are on file themselves. A change that costs the car something is applied
  // either way; a change that helps waits for the figures it rests on. Otherwise a blank would be worth more than
  // the figure: clearing the curb weight of a car with a lift kit would give back the economy the kit costs.
  const powerOnFile = oldHp !== null && oldHp > 0;
  const bothOnFile = powerOnFile && oldLb !== null && oldLb > 0;

  // Economy follows the weight: lighter is thriftier (when there is a curb weight on file to lighten), heavier the reverse.
  const mpg = economy * (oldLb !== null || weight > 1 ? 1 + ECONOMY_PER_WEIGHT_SHARE * (1 - weight) : 1);
  const scaled = (cell: Sourced<number> | null, factor: number): Sourced<number> | null => moved(cell, cell === null ? null : cell.value * factor);

  // A time on file follows pounds per horsepower by the same law the 0-60 estimate uses, and stops where the estimate
  // stops: no stack of parts takes it below the estimate's floor (a car already quicker than the floor keeps its time).
  const sprintRatio = Math.pow(weight / horsepower, ACCELERATION.estimate.exponent);
  const sprintOnFile = spec.zeroToSixtySec === null || !(bothOnFile || sprintRatio > 1)
    ? null
    : Math.max(spec.zeroToSixtySec.value * sprintRatio, Math.min(spec.zeroToSixtySec.value, ACCELERATION.estimate.floor));

  // A top speed on file follows the cube root of power, unless a limiter holds it. More power raises it only when the
  // sheet says it is not limited and the horsepower is on file: a blank answer is read as limited. Less power lowers
  // it unless the sheet says it is limited: there a blank answer is read as not limited.
  const limited = spec.topSpeedGoverned === null ? null : spec.topSpeedGoverned.value;
  const speedRatio = Math.cbrt(horsepower);
  // What the parts' power does to a top speed: raised only when the sheet says not limited and the horsepower is on
  // file, lowered unless the sheet says limited, otherwise left alone.
  const topRatio = speedRatio > 1 ? (limited === false && powerOnFile ? speedRatio : 1) : limited === true ? 1 : speedRatio;
  const topOnFile = spec.topSpeedMph === null ? null : spec.topSpeedMph.value * topRatio;
  // An estimated top speed is held to the same rule. The estimate from the figures as the parts leave them may not
  // pass what a figure on file would have become: the estimate from the factory figures, moved by that same ratio.
  // Otherwise clearing a limited car's top speed would let a turbocharger raise it after all, and a lighter car or
  // one that stays at its class's limiter would gain or keep what a figure on file would not. What lowers the
  // estimate further still lowers it. (With nothing fitted that moves power or weight the estimate cannot move.)
  const atFactory = spec.topSpeedMph === null && (horsepower !== 1 || weight !== 1) ? estimateTopSpeedMph(spec) : null;
  const topCeiling = atFactory === null ? null : atFactory * topRatio;
  // True when the parts add power that would raise the top speed (a figure on file, or the estimate) if the sheet
  // said it is not limited, and nobody has said either way. Nothing else is waiting on that answer: not a lighter
  // car, and not a figure whose horsepower is not on file.
  const topHeld = speedRatio > 1 && limited === null && powerOnFile;

  // With a skidpad figure on file the grip model is not run, so the weight the parts add or remove is charged here.
  // With no curb weight on file, added weight is charged as if the car weighed the most a car can: the heaviest reading.
  const weightGrip = spec.lateralGripG === null ? 0
    : oldLb !== null && newLb !== null ? (newLb - oldLb) * HANDLING.model.gripPerLb
      : weight > 1 ? SPEC_RANGES.curbWeightLb[1] * (weight - 1) * HANDLING.model.gripPerLb : 0;

  // With no combined figure on file the score blends city and highway and rounds down. Blended after the parts have
  // moved them, the fraction that rounding took off the factory blend would come back: so the parts' factor is
  // applied to the factory blend, as it would be to a combined figure on file.
  const factoryBlend = spec.combinedMpg === null && mpg !== 1 && spec.cityMpg !== null ? combinedEconomy(spec) : null;
  const blended: Sourced<number> | null = factoryBlend === null || spec.cityMpg === null ? null
    : { value: factoryBlend * mpg, source: { ...spec.cityMpg.source, kind: spec.cityMpg.source.kind === 'illustrative' ? 'illustrative' : 'owner', note: AFTER_MODIFICATIONS } };

  const after: VehicleSpec = {
    ...spec,
    horsepower: moved(spec.horsepower, newHp),
    torqueLbFt: scaled(spec.torqueLbFt, torque),
    curbWeightLb: moved(spec.curbWeightLb, newLb),
    combinedMpg: spec.combinedMpg === null ? blended : scaled(spec.combinedMpg, mpg),
    cityMpg: scaled(spec.cityMpg, mpg),
    highwayMpg: scaled(spec.highwayMpg, mpg),
    zeroToSixtySec: moved(spec.zeroToSixtySec, sprintOnFile),
    topSpeedMph: moved(spec.topSpeedMph, topOnFile),
    groundClearanceIn: moved(spec.groundClearanceIn, spec.groundClearanceIn === null ? null : spec.groundClearanceIn.value + clearance),
  };
  const changed = MOVABLE.filter((field) => after[field] !== spec[field]);
  return {
    spec: after,
    adjust: { gripG: grip + weightGrip, durabilityPoints: durability, reliabilityPoints: reliability, sprintFactor: sprint, topSpeedFactor: topSpeed, topSpeedCeilingMph: topCeiling, topSpeedHeld: topHeld },
    changed,
    applied,
    refused,
  };
}

/** A modification costs less originality the better it is evidenced: a known, attested change is worth more than a claimed one. */
const ORIGINALITY_SHARE: Record<ActiveModification['evidence'], number> = { declared: 1, documented: 0.75, verified: 0.6 };

/**
 * The points the modifications on a vehicle take off its Originality grade: the sum of the fitted tiers' originality
 * figures, each multiplied by 0.6 when the modification is verified, 0.75 when documented and 1 when only declared.
 *
 * A fitment that a later one replaced (the same category, or the same group) is not charged twice. This function
 * takes no specification and reads no figure, so it cannot know the powertrain: a combustion modification recorded
 * on an electric vehicle still costs originality here, although it changes no score.
 */
export function originalityCost(mods: readonly ActiveModification[]): number {
  let cost = 0;
  for (const mod of resolve(mods, 'combustion').applied) cost += MODS[mod.category].tiers[mod.tier - 1].originality * ORIGINALITY_SHARE[mod.evidence];
  // Every term is a whole number of twentieths, so two decimals hold the sum exactly: 5.4, not 5.3999999999999995.
  return Math.round(cost * 100) / 100;
}
