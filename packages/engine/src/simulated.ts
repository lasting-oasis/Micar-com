// A card from the bench: what a build does to a card, measured on the physics core's test bench instead of read off
// the modification table. Offered beside ruleset v1, not in place of it: nothing in ranked play reads this until the
// owner approves a new ruleset.
//
// The bench is a model, and a model is wrong by a few per cent on any one car. Dividing the built car by the stock car
// on the same bench cancels that error: a car the bench reads 3% slow reads 3% slow built and stock alike, so the
// published figure times built / stock carries only the change the parts made. The published figure stays the anchor.
//
// This package never imports the physics package: the bench's figures arrive as plain numbers, in the card's units
// and under the card's names (@micar/physics `benchFigures` gives them so). Reliability, durability and originality
// are still charged by the modification table (`simulatedStats` takes the fitted modifications for that), and the
// figures it moves are scored by the same tables as every other card.
import { applyModifications } from './modifications';
import type { ScoreAdjustments } from './normalize';
import { estimateTopSpeedMph, estimateZeroToSixtySec, layerOf, modelledGripG, scoreSpec } from './normalize';
import type { ActiveModification, Sourced, SpecField, StatLayer, VehicleSpec } from './types';
import { isNumber } from './util';

/**
 * One run of the bench in the card's units: peak horsepower, peak torque (lb-ft), curb weight (lb), 0-60 mph with the
 * magazines' one-foot rollout (s), top speed (mph) and skidpad grip on a 300 ft circle (g). A figure the bench did
 * not measure is NaN.
 */
export type BenchFigures = Readonly<{
  horsepower: number; torqueLbFt: number; curbWeightLb: number; zeroToSixtySec: number; topSpeedMph: number; lateralGripG: number;
}>;

/** The figures the bench moves, in the order a specification sheet lists them. */
export const SIMULATED_FIELDS = ['horsepower', 'torqueLbFt', 'curbWeightLb', 'zeroToSixtySec', 'topSpeedMph', 'lateralGripG'] as const;
/** One of the six figures the bench moves. */
export type SimulatedField = (typeof SIMULATED_FIELDS)[number];

/** The note a figure carries once the bench has moved it. Its source kind becomes 'owner' (an illustrative one stays illustrative). */
export const SIMULATED_NOTE = 'simulated on the bench';

/**
 * Decimals a simulated figure is kept to: one place finer than a maker or a magazine prints it (horsepower, torque and
 * top speed to a tenth, curb weight to the pound, 0-60 to a hundredth of a second, grip to a thousandth of a g), which
 * is also as fine as the scoring reads them. A change the bench measures below that is no change: the bench holds a
 * governed top speed or a skidpad lap to a few hundredths either side whatever the engine makes, and a tune that
 * moved a card's skidpad figure by 0.0003 g would mark the figure as simulated for nothing a card can show.
 */
export const SIMULATED_DECIMALS: Readonly<Record<SimulatedField, number>> = {
  horsepower: 1, torqueLbFt: 1, curbWeightLb: 0, zeroToSixtySec: 2, topSpeedMph: 1, lateralGripG: 3,
};
const SCALE: readonly number[] = [1, 10, 100, 1000];

/** A simulated specification: the copy, the fields the bench moved, and what the scoring needs for the figures that are missing. */
export type SimulatedSpec = {
  spec: VehicleSpec;
  /** The figures the bench moved, in SIMULATED_FIELDS order. Pass them to scoreSpec as `derived`. */
  changed: SpecField[];
  /**
   * For a top speed, 0-60 or skidpad figure that is not on file: the factor (or for grip, the g) that makes the
   * score's own estimate move by the bench's ratio, as a figure on file would have. Pass it to scoreSpec as `adjust`.
   */
  adjust: ScoreAdjustments;
};

/** built / stock, or null when either is not a positive finite number (a test the bench did not run). */
function ratioOf(stock: number, built: number): number | null {
  return isNumber(stock) && isNumber(built) && stock > 0 && built > 0 ? built / stock : null;
}

/**
 * A figure times the bench's ratio, kept to its decimals. The figure itself comes back, exactly, when there is no
 * ratio or the change does not show at those decimals; so a stock bench (built and stock the same run) gives every
 * figure back as it was.
 */
function simulate(value: number, ratio: number | null, decimals: number): number {
  if (ratio === null || ratio === 1) return value;
  const scale = SCALE[decimals];
  const moved = Math.round(value * ratio * scale) / scale;
  return moved === Math.round(value * scale) / scale ? value : moved;
}

/**
 * A figure with a new value. Nobody published or measured the result, so it is marked as worked out, the way the
 * modification engine marks its figures: its source kind becomes 'owner' (an illustrative figure stays illustrative),
 * the note says the bench moved it, and the publisher, address and day stay as they were.
 */
function moved(cell: Sourced<number> | null, value: number): Sourced<number> | null {
  if (cell === null || value === cell.value) return cell;
  return { value, source: { ...cell.source, kind: cell.source.kind === 'illustrative' ? 'illustrative' : 'owner', note: SIMULATED_NOTE } };
}

/**
 * The card after a build, from two runs of the same bench: the car stock and the car built.
 *
 * Each of horsepower, torque, curb weight, 0-60, top speed and skidpad grip on file becomes the published figure
 * times built / stock (kept to SIMULATED_DECIMALS), and is marked as worked out with the note 'simulated on the
 * bench'. A figure not on file stays missing. A figure the bench did not measure (NaN, or not positive) is left as
 * published. Nothing else on the card changes: the configuration, the economy and the braking distances are the
 * published ones.
 *
 * A missing top speed, 0-60 or skidpad figure is scored from an estimate, and that estimate reads the new horsepower
 * and weight by its own rule: more power would raise an estimated top speed that the bench, holding the car at its
 * limiter, does not raise, and clearing a figure would then be worth more than filling it in. So `adjust` moves each
 * such estimate by the bench's ratio instead, exactly as a figure on file moves. (A missing torque is estimated from
 * the horsepower and follows the horsepower's ratio; nothing in the scoring can hold it to the torque's.)
 *
 * Score the result with `scoreSpec(result.spec, { adjust: result.adjust, derived: result.changed })`, the tables every
 * card is scored with, or use `simulatedStats`. The input is never changed.
 */
export function simulatedSpec(spec: VehicleSpec, stock: BenchFigures, built: BenchFigures): SimulatedSpec {
  const after: VehicleSpec = { ...spec };
  const ratio = {} as Record<SimulatedField, number | null>;
  for (const field of SIMULATED_FIELDS) {
    ratio[field] = ratioOf(stock[field], built[field]);
    const cell = spec[field];
    if (cell !== null) after[field] = moved(cell, simulate(cell.value, ratio[field], SIMULATED_DECIMALS[field]));
  }
  const changed: SpecField[] = SIMULATED_FIELDS.filter((field) => after[field] !== spec[field]);

  // The estimates that stand in for missing figures: where the estimate from the new figures is not the factory
  // estimate moved by the bench's ratio, a factor (a difference, for grip) brings it there.
  const adjust: ScoreAdjustments = {};
  if (spec.topSpeedMph === null) {
    const target = held(estimateTopSpeedMph(spec), ratio.topSpeedMph, SIMULATED_DECIMALS.topSpeedMph);
    const now = estimateTopSpeedMph(after);
    if (target !== null && now !== null && now > 0 && now !== target) adjust.topSpeedFactor = target / now;
  }
  if (spec.zeroToSixtySec === null) {
    const target = held(estimateZeroToSixtySec(spec), ratio.zeroToSixtySec, SIMULATED_DECIMALS.zeroToSixtySec);
    const now = estimateZeroToSixtySec(after);
    if (target !== null && now !== null && now > 0 && now !== target) adjust.sprintFactor = target / now;
  }
  if (spec.lateralGripG === null) {
    const target = held(modelledGripG(spec), ratio.lateralGripG, SIMULATED_DECIMALS.lateralGripG);
    const now = modelledGripG(after);
    if (target !== null && now !== null && now !== target) adjust.gripG = target - now;
  }
  return { spec: after, changed, adjust };
}

/** An estimate from the factory figures, moved as a figure on file would be; null when there is no estimate. */
function held(estimate: number | null, ratio: number | null, decimals: number): number | null {
  return estimate === null ? null : simulate(estimate, ratio, decimals);
}

/**
 * The stats of a built car from the bench: the simulated specification scored by the same tables as every card, with
 * the modification table's points for reliability and durability charged for the fitted modifications (who fitted
 * them and how they are kept scale those points as they always do). The modification table's own figures (its
 * horsepower, weight, 0-60, top speed and grip multipliers) are not applied: the bench has measured those.
 * The world's class letter for a build is `raceClassOf` of this layer's Power Rating.
 */
export function simulatedStats(spec: VehicleSpec, stock: BenchFigures, built: BenchFigures, mods: readonly ActiveModification[] = []): StatLayer {
  const sim = simulatedSpec(spec, stock, built);
  const charged = mods.length === 0 ? null : applyModifications(spec, mods).adjust;
  const adjust: ScoreAdjustments = charged === null ? sim.adjust
    : { ...sim.adjust, durabilityPoints: charged.durabilityPoints, reliabilityPoints: charged.reliabilityPoints };
  return layerOf(scoreSpec(sim.spec, { adjust, derived: sim.changed }));
}
