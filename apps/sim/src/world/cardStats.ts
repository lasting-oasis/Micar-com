// The MiCar card's attributes for a car in the world, from the same engine the Garage on the site uses
// (@micar/engine), so a card and the world cannot disagree about what a model can do.
//
// The world's car table (carSpecs.ts) holds one common US trim per model: an engine in words, horsepower, curb
// weight, 0-60, top speed and drive. That is enough for five of the seven attributes. It has no fuel economy, no
// transmission and no word on forced induction, so EFFICIENCY and RELIABILITY are left unrated rather than guessed,
// and the rating shown is provisional. These are factory figures for the model: they say nothing about one car's
// condition, and nothing here reads or changes the Strip, the Garage's stat panel or a grade.
import { baseStats, bodyClassFromSimStyle, emptySpec, sourced } from '@micar/engine';
import type { Source, StatLayer, VehicleSpec } from '@micar/engine';
import { getCarSpec, hasModelSpec } from '../carSpecs';

type WorldCar = { year?: number; make?: string; model?: string; bodyStyle?: string };

/** Real models in the table are reference figures nobody has verified. */
export const TABLE_SOURCE: Source = { kind: 'reference', name: 'MiCar World car table', note: 'One common US trim stands for the model. Not verified.' };
/** A car with no row of its own (a rental from the fictional fleet aside) gets its body style's stand-in, which is illustrative. */
export const STAND_IN_SOURCE: Source = { kind: 'illustrative', name: 'MiCar World body-style stand-in', note: 'A generic figure for the body style, not data about this model.' };

/** "2.5L I4" -> 2.5 and 4. Read only from the table's own fixed wording; anything else is left out. */
function readEngine(engine: string): { litres: number | null; cylinders: number | null } {
  const litres = /^(\d(?:\.\d)?)L\b/.exec(engine);
  const cylinders = /\b(?:I|V|H|W)(\d{1,2})\b/.exec(engine);
  return { litres: litres ? Number(litres[1]) : null, cylinders: cylinders ? Number(cylinders[1]) : null };
}

/** The engine's specification for a world car: the table's figures, each marked with where it came from. */
export function engineSpecFor(car: WorldCar): VehicleSpec {
  const row = getCarSpec(car);
  const source = hasModelSpec(car) ? TABLE_SOURCE : STAND_IN_SOURCE;
  const spec = emptySpec({ year: car.year ?? 0, make: car.make ?? '', model: car.model ?? '', trim: '', bodyClass: bodyClassFromSimStyle(car.bodyStyle ?? 'sedan') });
  const { litres, cylinders } = readEngine(row.engine);
  return {
    ...spec,
    engine: sourced(row.engine, source),
    displacementL: litres === null ? null : sourced(litres, source),
    cylinders: cylinders === null ? null : sourced(cylinders, source),
    horsepower: sourced(row.hp, source),
    curbWeightLb: sourced(row.weightLb, source),
    zeroToSixtySec: sourced(row.zeroToSixty, source),
    topSpeedMph: sourced(row.topSpeedMph, source),
    drivetrain: sourced(row.drive, source),
  };
}

/** The factory layer of a world car's card: what the model can do by its figures. */
export const cardStatsFor = (car: WorldCar): StatLayer => baseStats(engineSpecFor(car));
