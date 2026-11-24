// The bench in the card's units. A card's figures are a maker's and a magazine's: peak horsepower and torque at the
// crank, curb weight, a 0-60 timed from the first foot of travel, top speed, grip on a 300 ft skidpad, 60-0, and a
// quarter-mile timeslip. This file reads the same figures off a bench run, in those units and under the names the card
// engine's specification uses (@micar/engine VehicleSpec), so that a stock run and a built run pass straight to the
// card engine's `simulatedSpec(spec, stock, built)`. Neither package imports the other: the hand-off is plain numbers.
//
// Only the ratio of two runs reaches a card (DESIGN.md 12): the bench's own error on a car cancels between the stock
// run and the built run, so nothing here corrects a figure toward the published one.
import { DRIVER_MASS } from './classes';
import type { BenchResult, VehicleModel } from './types';
import { HP, LB } from './units';

/**
 * One bench run in the card's units, each field named as the card engine names it. A figure from a test the bench
 * did not run is NaN, as it is in the BenchResult.
 */
export type CardFigures = {
  /** Peak power at the crank, hp; with a nitrous kit, its shot is in it (see benchFigures). */
  horsepower: number;
  /** Peak torque at the crank, lb-ft. */
  torqueLbFt: number;
  /** Curb weight, lb: the car without the driver the model carries. */
  curbWeightLb: number;
  /** 0-60 mph, s, with the one-foot rollout Car and Driver and MotorTrend leave out. */
  zeroToSixtySec: number;
  /** Top speed, mph, governed or not. */
  topSpeedMph: number;
  /** Skidpad grip on the 300 ft circle, g. */
  lateralGripG: number;
  /** 60-0 mph, ft. */
  braking60to0Ft: number;
  /** Quarter mile, s, and its trap speed, mph. */
  quarterMileSec: number;
  quarterMileMph: number;
};

/**
 * The bench's figures for one car in the card's units: the dyno's peak horsepower and torque, the curb weight, the
 * 0-60 with rollout, the top speed, the 300 ft skidpad, the 60-0 and the quarter mile.
 *
 * A nitrous kit's shot is added to the horsepower, as a kit is rated and as a dyno pull with the kit armed reads it:
 * the shot is a fixed power from well under the power peak's engine speed to the limiter, so the peak with it is the
 * engine's peak plus the shot. The bench's drivers never arm it, so its timed figures are the car without it; and the
 * peak torque stays the engine's own (the shot's torque is greatest at the bottom of its window, where the engine's
 * own torque may not be).
 */
export function benchFigures(bench: BenchResult, model: VehicleModel): CardFigures {
  const shot = model.nitrous !== null && model.nitrous.power > 0 ? model.nitrous.power / HP : 0;
  return {
    horsepower: bench.peakHp + shot,
    torqueLbFt: bench.peakTorqueLbFt,
    // The model's mass is the car as driven: curb weight and the 75 kg driver the bench drives it with.
    curbWeightLb: (model.chassis.mass - DRIVER_MASS) / LB,
    zeroToSixtySec: bench.zeroToSixtyRollout,
    topSpeedMph: bench.topSpeed,
    lateralGripG: bench.skidpad300,
    braking60to0Ft: bench.braking60,
    quarterMileSec: bench.timeslip.quarter,
    quarterMileMph: bench.timeslip.trapMph,
  };
}
