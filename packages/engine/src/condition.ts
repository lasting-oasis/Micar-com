// The condition engine: how worn each of a vehicle's systems is on a given day, and what that wear costs each attribute.
// It exists so that layer B (this vehicle's stats) can differ from layer A (the factory specification) for a reason
// that can be read back: so many miles, so many years, this part replaced on that day, an inspector's figure.
// Wear only ever lowers a score. A documented repair moves a system back toward new and never past the base, and a
// state nobody recorded is not assumed: brakes and tires with no receipt and no inspection carry no penalty at all.
// The caller passes the day (asOf); nothing here reads a clock.
import { ATTRIBUTE_KEYS, EVIDENCE_ORDER, WEAR_SYSTEMS } from './types';
import type { AccidentHistory, AttributeKey, ConditionInputs, ConditionState, EvidenceLevel, SystemWear, TitleStatus, WearSystem } from './types';
import { clamp, isIsoDate, isNumber, yearsBetween } from './util';

/**
 * How long each system lasts: it is worn out at this many miles or this many years since new, whichever comes first.
 * A consumable (brakes, tires) is replaced as a matter of course, so its state is unknown until a receipt or an
 * inspection says what it is.
 */
export const WEAR_LIFE: Record<WearSystem, { miles: number; years: number; consumable: boolean }> = {
  engine: { miles: 200000, years: 25, consumable: false },
  transmission: { miles: 150000, years: 20, consumable: false },
  suspension: { miles: 90000, years: 12, consumable: false },
  brakes: { miles: 45000, years: 6, consumable: true },
  tires: { miles: 45000, years: 6, consumable: true },
  body: { miles: 250000, years: 20, consumable: false },
  battery: { miles: 150000, years: 12, consumable: false },
};

/** The share of each attribute a system takes away when it is fully worn: 0.12 is 12%. An attribute not listed is not touched. */
export const WEAR_LOSS: Record<WearSystem, Partial<Record<AttributeKey, number>>> = {
  engine: { power: 0.12, acceleration: 0.1, speed: 0.05, reliability: 0.25, efficiency: 0.1 },
  transmission: { acceleration: 0.05, reliability: 0.15, efficiency: 0.04 },
  suspension: { handling: 0.18, durability: 0.06 },
  brakes: { handling: 0.08 },
  tires: { handling: 0.12, acceleration: 0.03, efficiency: 0.02 },
  body: { durability: 0.3 },
  battery: { efficiency: 0.08, reliability: 0.1, power: 0.05 },
};

/** English names of the systems, for lists and for the "Engine wear" line of an adjustment. The apps translate them. */
export const WEAR_SYSTEM_LABELS: Record<WearSystem, string> = {
  engine: 'Engine', transmission: 'Transmission', suspension: 'Suspension', brakes: 'Brakes', tires: 'Tires', body: 'Body', battery: 'Battery',
};

/** The penalty grows with wear to this power: gently while a system is young, steeply near the end of its life. */
const WEAR_EXPONENT = 1.5;

/** A declared accident or a branded title means the body is at least this worn, whatever the odometer says. */
const ACCIDENT_FLOOR: Record<AccidentHistory, number> = { None: 0, Minor: 0.25, Major: 0.6 };
const TITLE_FLOOR: Record<TitleStatus, number> = { Clean: 0, Rebuilt: 0.5, Salvage: 0.8 };

type Replacement = ConditionInputs['replacements'][number];

/** The weakest of a set of evidence levels. */
const weakest = (levels: readonly EvidenceLevel[]): EvidenceLevel => levels.reduce((worst, level) => (EVIDENCE_ORDER.indexOf(level) < EVIDENCE_ORDER.indexOf(worst) ? level : worst), 'verified' as EvidenceLevel);

/** The share of a life used up. Nothing below zero, and a figure that is not a number counts as nothing. */
const share = (amount: number, life: number): number => (amount > 0 ? amount / life : 0);

/** An inspector's figure or a wear share, kept between as new (0) and worn out (1). */
const zeroToOne = (v: number): number => (v > 0 ? Math.min(v, 1) : 0);

const onRecord = (date: string, asOf: string): boolean => isIsoDate(date) && date <= asOf;

/** The newest replacement or rebuild of a system that is documented or verified and dated on or before the day asked about. */
function lastReplacement(inputs: ConditionInputs, system: WearSystem): Replacement | null {
  let best: Replacement | null = null;
  for (const r of inputs.replacements) {
    if (r.system !== system || r.evidence === 'declared' || !onRecord(r.date, inputs.asOf)) continue;
    // Two on the same day: the one with the higher odometer reading is the later of the two.
    if (best === null || r.date > best.date || (r.date === best.date && (r.mileage ?? -1) > (best.mileage ?? -1))) best = r;
  }
  return best;
}

/** The figure from the newest inspection, dated on or before the day asked about, that read this system. */
function lastReading(inputs: ConditionInputs, system: WearSystem): number | null {
  let date = '';
  let figure: number | null = null;
  for (const inspection of inputs.inspections) {
    const read = inspection.systems[system];
    if (!isNumber(read) || !onRecord(inspection.date, inputs.asOf)) continue;
    // Two readings on the same day: the more worn one stands.
    if (figure === null || inspection.date > date || (inspection.date === date && read > figure)) {
      date = inspection.date;
      figure = read;
    }
  }
  return figure;
}

/**
 * The state of every system of one vehicle on the day `inputs.asOf`.
 *
 * A system's wear is the larger of (miles since new / life in miles) and (years since new / life in years), from 0 to 1.
 * "Since new" is the first day of the model year at odometer 0, unless a replacement or rebuild of that system is on
 * record at 'documented' or better: then it is that day and that odometer reading. A replacement the owner only
 * declared resets nothing. Records dated after `asOf` are not counted, and a part fitted before the model year began
 * counts its years from the vehicle's own start.
 *
 * What a caller should know about the result:
 * - With no mileage on file, or from a replacement that came without an odometer reading, only the years count.
 * - Brakes and tires are 'unknown' (wear 0, no penalty) until a documented replacement or an inspection gives them a state.
 * - The battery is 'unknown' on a petrol or diesel powertrain. It wears on a hybrid, plug-in hybrid or electric one,
 *   and on a vehicle whose powertrain nobody has named.
 * - A declared accident or title sets a floor under body wear: Minor 0.25, Major 0.6, Rebuilt 0.5, Salvage 0.8.
 * - The newest inspection that read a system replaces its wear with the inspector's figure, at evidence 'verified'.
 * - Modelled wear carries the weakest evidence among what it was counted from: the mileage reading (when miles were
 *   counted) and the replacement it is counted since (when there is one). Wear counted from the model year alone,
 *   and body wear that comes from the accident or title floor, is 'declared'.
 * - To know what ranked play may read, do not filter this state: assess a second one from verified inputs alone
 *   (verification.competitionConditionInputs). In that state nothing declared exists, so nothing declared can lower,
 *   raise or relabel a verified figure.
 */
export function assessCondition(inputs: ConditionInputs): ConditionState {
  const reading = inputs.mileage !== null && isNumber(inputs.mileage.value) ? inputs.mileage : null;
  const built = `${inputs.modelYear}-01-01`;
  // With no powertrain on file the vehicle is read as one with a traction battery to wear: a blank is read as the
  // option that costs most, here as everywhere, or clearing a hybrid's powertrain would take its battery wear away.
  const electrified = inputs.powertrain === null || inputs.powertrain === 'hybrid' || inputs.powertrain === 'plug-in-hybrid' || inputs.powertrain === 'electric';
  const bodyFloor = Math.max(inputs.accident === null ? 0 : ACCIDENT_FLOOR[inputs.accident], inputs.titleStatus === null ? 0 : TITLE_FLOOR[inputs.titleStatus]);

  const systems = {} as Record<WearSystem, SystemWear>;
  for (const system of WEAR_SYSTEMS) {
    const unknown: SystemWear = { system, wear: 0, basis: 'unknown', evidence: null, sinceMileage: null, sinceDate: null };
    if (system === 'battery' && !electrified) {
      systems[system] = unknown;
      continue;
    }
    const life = WEAR_LIFE[system];
    const replacement = lastReplacement(inputs, system);
    const sinceDate = replacement === null ? null : replacement.date;
    const sinceMileage = replacement === null || !isNumber(replacement.mileage) ? null : replacement.mileage;

    const inspected = lastReading(inputs, system);
    if (inspected !== null) {
      systems[system] = { system, wear: zeroToOne(inspected), basis: 'inspected', evidence: 'verified', sinceMileage, sinceDate };
      continue;
    }
    if (life.consumable && replacement === null) {
      systems[system] = unknown;
      continue;
    }

    // Miles count only when there is a reading today and a reading to count from: 0 at the factory, or the receipt's odometer.
    const fromMileage = replacement === null ? 0 : sinceMileage;
    const miles = reading !== null && fromMileage !== null ? share(reading.value - fromMileage, life.miles) : null;
    // A part fitted before the model year began is no older than the vehicle, so a receipt can never add years.
    const years = share(yearsBetween(sinceDate !== null && sinceDate > built ? sinceDate : built, inputs.asOf), life.years);
    let wear = clamp(Math.max(miles ?? 0, years), 0, 1);
    // The figure is only as good as the weakest thing it was counted from: the reading (when miles were counted) and
    // the replacement it was counted since (when there is one). Years counted from the model year alone are the
    // owner's word, because the model year is.
    const counted: EvidenceLevel[] = [];
    if (reading !== null && miles !== null) counted.push(reading.evidence);
    if (replacement !== null) counted.push(replacement.evidence);
    let evidence: EvidenceLevel = counted.length === 0 ? 'declared' : weakest(counted);
    if (system === 'body' && bodyFloor > wear) {
      wear = bodyFloor;
      evidence = 'declared';
    }
    systems[system] = { system, wear, basis: 'modelled', evidence, sinceMileage, sinceDate };
  }

  return { asOf: inputs.asOf, mileage: reading === null ? null : reading.value, mileageEvidence: reading === null ? null : reading.evidence, systems };
}

/**
 * What wear costs each attribute: a multiplier from 0 to 1 per attribute, and the same broken down by system.
 *
 * For each attribute the factor is the product, over the systems that count, of `1 - loss x wear ^ 1.5` (WEAR_LOSS).
 * A system counts when its basis is not 'unknown' and its evidence is at least `minEvidence`: pass 'declared' for
 * everything on record, 'verified' for what ranked play may read. `bySystem` lists the systems that counted, in
 * WEAR_SYSTEMS order, each with the factors for the attributes it touches; multiplied together they give `factors`.
 *
 * No factor is ever above 1, for any state: wear lowers a score and nothing here raises one. `null` (no condition
 * on record) gives all ones.
 */
export function wearFactors(
  state: ConditionState | null,
  minEvidence: EvidenceLevel,
): { factors: Record<AttributeKey, number>; bySystem: { system: WearSystem; evidence: EvidenceLevel; factors: Partial<Record<AttributeKey, number>> }[] } {
  const factors = {} as Record<AttributeKey, number>;
  for (const key of ATTRIBUTE_KEYS) factors[key] = 1;
  const bySystem: { system: WearSystem; evidence: EvidenceLevel; factors: Partial<Record<AttributeKey, number>> }[] = [];
  if (state === null) return { factors, bySystem };

  const least = EVIDENCE_ORDER.indexOf(minEvidence);
  for (const system of WEAR_SYSTEMS) {
    const entry = state.systems[system];
    if (!entry || entry.basis === 'unknown' || entry.evidence === null || EVIDENCE_ORDER.indexOf(entry.evidence) < least) continue;
    const worn = Math.pow(zeroToOne(entry.wear), WEAR_EXPONENT);
    const own: Partial<Record<AttributeKey, number>> = {};
    for (const key of ATTRIBUTE_KEYS) {
      const loss = WEAR_LOSS[system][key];
      if (loss === undefined) continue;
      const factor = Math.min(1, 1 - loss * worn);
      own[key] = factor;
      factors[key] *= factor;
    }
    bySystem.push({ system, evidence: entry.evidence, factors: own });
  }
  return { factors, bySystem };
}
