// Specification normalization: a factory specification in, seven scores from 0 to 1000 out.
// The specification is never changed and never filled in. When a figure is missing the score says so: it is either
// estimated from other figures by a documented rule and marked 'estimated', or left null and marked 'unavailable'.
// The same tables (rules.ts) score every vehicle.
import { ACCELERATION, DURABILITY, EFFICIENCY, HANDLING, POWER, POWER_RATING_WEIGHTS, RELIABILITY, SPEED } from './rules';
import { ATTRIBUTE_KEYS } from './types';
import type { AttributeBasis, AttributeKey, AttributeScore, AttributeScores, Attributes, DataQuality, MaybeAttributes, SourceKind, Sourced, SpecField, StatLayer, VehicleSpec } from './types';
import { clamp, score1000 } from './util';

/* ----------------------------------------------------------------- provenance ---- */

const QUALITY: Record<SourceKind, DataQuality> = {
  manufacturer: 'sourced', agency: 'sourced', test: 'sourced', reference: 'reference', owner: 'owner', illustrative: 'illustrative',
};
const QUALITY_ORDER: readonly DataQuality[] = ['illustrative', 'owner', 'reference', 'sourced'];

export const qualityOf = (kind: SourceKind): DataQuality => QUALITY[kind];

/** The weakest of a set of qualities; null when the set is empty. */
export function weakestQuality(list: readonly (DataQuality | null)[]): DataQuality | null {
  let worst: DataQuality | null = null;
  for (const q of list) {
    if (q === null) continue;
    if (worst === null || QUALITY_ORDER.indexOf(q) < QUALITY_ORDER.indexOf(worst)) worst = q;
  }
  return worst;
}

/** The weakest source behind the fields named, skipping fields that are empty. */
export function qualityOfFields(spec: VehicleSpec, fields: readonly SpecField[]): DataQuality | null {
  return weakestQuality(fields.map((f) => {
    const cell = spec[f] as Sourced<unknown> | null;
    return cell ? qualityOf(cell.source.kind) : null;
  }));
}

/** The weakest source behind every field the specification holds; null for an empty specification. */
export function specQuality(spec: VehicleSpec): DataQuality | null {
  const fields = (Object.keys(spec) as (keyof VehicleSpec)[]).filter((k): k is SpecField => k !== 'identity');
  return qualityOfFields(spec, fields);
}

/* -------------------------------------------------------------------- metrics ---- */

const val = <T>(cell: Sourced<T> | null): T | null => (cell ? cell.value : null);

/**
 * The lowest and the highest figure in a table of terms. Where a choice is blank and one of its terms could cost the
 * car something, the estimate takes the term that costs most: a blank is read as the least favourable case, never
 * skipped, so leaving a field empty is never worth more than filling it in.
 */
const lowest = (table: Record<string, number>): number => Math.min(...Object.keys(table).map((k) => table[k]));
const highest = (table: Record<string, number>): number => Math.max(...Object.keys(table).map((k) => table[k]));

/**
 * True when the engine-stress terms apply: a petrol or diesel engine, or a powertrain nobody has named yet (which is
 * read as one). A hybrid's horsepower is its system output, not its engine's, and an electric motor has no
 * displacement, so neither is charged.
 */
export function stressApplies(spec: VehicleSpec): boolean {
  const powertrain = val(spec.powertrain);
  return powertrain === null || powertrain === 'gasoline' || powertrain === 'diesel';
}

/** Horsepower per litre of a petrol or diesel engine; null when the stress terms do not apply or a figure is missing. */
export function specificOutput(spec: VehicleSpec): number | null {
  const hp = val(spec.horsepower), litres = val(spec.displacementL);
  if (hp === null || litres === null || litres <= 0 || !stressApplies(spec)) return null;
  return hp / litres;
}

/**
 * The output index POWER reads: 70% horsepower and 30% torque. With no torque on file it is estimated low, taking
 * torque as POWER.missingTorqueShare of the horsepower figure, which is under nearly every production engine's.
 */
export function outputIndex(spec: VehicleSpec): number | null {
  const hp = val(spec.horsepower), tq = val(spec.torqueLbFt);
  if (hp === null) return null;
  return POWER.horsepowerWeight * hp + POWER.torqueWeight * (tq === null ? hp * POWER.missingTorqueShare : tq);
}

/**
 * Top speed estimated from power: the speed at which the engine's power at the wheels equals aerodynamic drag plus
 * rolling resistance, times the share of it a car really reaches, capped at the limiter usual for the class (which
 * climbs smoothly toward the performance limiter as horsepower per pound rises). Null without horsepower or curb
 * weight: the weight sets the rolling resistance and how far the limiter is raised, and a weight nobody entered
 * (the class's usual one, say) would flatter every car heavier than it.
 */
export function estimateTopSpeedMph(spec: VehicleSpec): number | null {
  const hp = val(spec.horsepower), lb = val(spec.curbWeightLb);
  if (hp === null || lb === null) return null;
  const e = SPEED.estimate;
  const cls = spec.identity.bodyClass;
  const watts = hp * 745.7 * e.drivelineEfficiency;
  const a = 0.5 * e.airDensity * e.dragArea[cls];
  const b = e.rollingResistance * lb * 0.45359237 * 9.80665;
  let v = Math.cbrt(watts / a);
  for (let i = 0; i < 12; i++) v -= (a * v * v * v + b * v - watts) / (3 * a * v * v + b);
  const band = e.performanceBand;
  const quick = clamp((hp / lb - band.from) / (band.to - band.from), 0, 1);
  const limiter = e.limiter[cls] + Math.max(0, e.performanceLimiter[cls] - e.limiter[cls]) * quick;
  return Math.round(Math.min(v * 2.2369363 * e.realisation, limiter) * 10) / 10;
}

/**
 * 0-60 estimated from pounds per horsepower, the drivetrain, the powertrain and the transmission. Null without
 * horsepower and curb weight. A blank drivetrain is read as the slowest one and a blank transmission as a
 * continuously variable one: both factors can only slow the car, so neither is skipped for want of an entry. The
 * electric factor only helps, so it waits for the powertrain to be named.
 */
export function estimateZeroToSixtySec(spec: VehicleSpec): number | null {
  const hp = val(spec.horsepower), lb = val(spec.curbWeightLb);
  if (hp === null || lb === null) return null;
  const e = ACCELERATION.estimate;
  const drive = val(spec.drivetrain), gearbox = val(spec.transmissionType);
  const t = e.k * Math.pow(lb / hp, e.exponent) * (drive ? e.drivetrain[drive] : highest(e.drivetrain)) * (val(spec.powertrain) === 'electric' ? e.electric : 1)
    * (gearbox === null || gearbox === 'cvt' ? e.cvt : 1);
  return Math.round(Math.max(e.floor, t) * 10) / 10;
}

/**
 * Lateral grip modelled from the class, the weight and the suspension. Null without curb weight. A blank suspension
 * grade is read as the grade with the least grip: one of the grades costs grip, so the term is not skipped.
 */
export function modelledGripG(spec: VehicleSpec): number | null {
  const lb = val(spec.curbWeightLb);
  if (lb === null) return null;
  const m = HANDLING.model;
  const cls = spec.identity.bodyClass;
  const grade = val(spec.suspensionGrade);
  return m.classGrip[cls] + clamp((lb - m.referenceWeightLb[cls]) * m.gripPerLb, -m.weightLimit, m.weightLimit) + (grade ? m.suspension[grade] : lowest(m.suspension));
}

/** The control term added to grip, measured or modelled: a little for driven wheels and for the brakes. */
export function controlTermG(spec: VehicleSpec): number {
  const drive = val(spec.drivetrain), brakes = val(spec.brakeGrade);
  return (drive ? HANDLING.control.drivetrain[drive] : 0) + (brakes ? HANDLING.control.brakes[brakes] : 0);
}

/** The fields the two modelled indexes cannot do without, for this specification, in the order a sheet lists them. */
export function durabilityNeeds(spec: VehicleSpec): SpecField[] {
  return stressApplies(spec) ? ['curbWeightLb', 'horsepower', 'displacementL'] : ['curbWeightLb'];
}
export function reliabilityNeeds(spec: VehicleSpec): SpecField[] {
  const needs: SpecField[] = ['powertrain', 'transmissionType', 'drivetrain'];
  if (val(spec.powertrain) !== 'electric') needs.push('induction', 'cylinders');
  if (stressApplies(spec)) needs.push('horsepower', 'displacementL');
  return needs;
}

/**
 * The durability index in points before clamping. Null without curb weight and, for a petrol or diesel engine,
 * without the horsepower and displacement the stress term reads: a term that can only take points away is never
 * skipped because its figures are missing.
 */
export function durabilityPoints(spec: VehicleSpec): number | null {
  const lb = val(spec.curbWeightLb);
  if (lb === null || durabilityNeeds(spec).some((f) => spec[f] === null)) return null;
  const d = DURABILITY;
  const drive = val(spec.drivetrain), clearance = val(spec.groundClearanceIn), stress = specificOutput(spec);
  return d.classBase[spec.identity.bodyClass]
    + (val(spec.construction) === 'body-on-frame' ? d.bodyOnFrame : 0)
    + clamp((lb - d.mass.pivotLb) * d.mass.perLb, d.mass.min, d.mass.max)
    + (drive ? d.drivetrain[drive] : 0)
    + (clearance === null ? 0 : clamp((clearance - d.clearance.pivotIn) * d.clearance.perIn, 0, d.clearance.max))
    - (stress === null ? 0 : clamp((stress - d.stress.pivotHpPerL) * d.stress.perHpPerL, 0, d.stress.max));
}

/**
 * The reliability index in points before clamping. Null until everything it reads is on file (reliabilityNeeds): the
 * powertrain, the transmission type and the drivetrain; unless electric, the induction and the cylinder count; and
 * for a petrol or diesel engine the horsepower and displacement. Every one of those can take points away, so none
 * is assumed.
 */
export function reliabilityPoints(spec: VehicleSpec): number | null {
  const powertrain = val(spec.powertrain), induction = val(spec.induction), gearbox = val(spec.transmissionType);
  const electric = powertrain === 'electric';
  if (powertrain === null || gearbox === null || (!electric && induction === null) || reliabilityNeeds(spec).some((f) => spec[f] === null)) return null;
  const r = RELIABILITY;
  const drive = val(spec.drivetrain), cylinders = val(spec.cylinders), miles = val(spec.warrantyPowertrainMiles), stress = specificOutput(spec);
  return r.base
    + (electric ? r.electricPowertrain : r.induction[induction as keyof typeof r.induction])
    + (powertrain === 'plug-in-hybrid' ? r.plugInHybrid : 0)
    + r.transmission[gearbox]
    + (drive ? r.drivetrain[drive] : 0)
    - (stress === null ? 0 : clamp((stress - r.stress.pivotHpPerL) * r.stress.perHpPerL, 0, r.stress.max))
    + (cylinders !== null && cylinders > r.manyCylinders.above ? r.manyCylinders.points : 0)
    + (miles === null ? 0 : clamp(((miles - r.warranty.pivotMiles) / 1000) * r.warranty.perThousandMiles, r.warranty.min, r.warranty.max));
}

/** Combined fuel economy: the figure on file, or the EPA's own blend of city and highway (55% / 45%, harmonic, to the whole number below) when only those are. */
export function combinedEconomy(spec: VehicleSpec): number | null {
  const combined = val(spec.combinedMpg);
  if (combined !== null) return combined;
  const city = val(spec.cityMpg), highway = val(spec.highwayMpg);
  if (city === null || highway === null || city <= 0 || highway <= 0) return null;
  // The whole number below. A label prints whole numbers, and its combined figure is worked out from city and highway
  // figures that were not yet rounded, so the blend of the printed ones can land a mile either side of it. Rounding
  // down keeps the blend from ever being worth more than the combined figure it stands in for.
  // (The small allowance is for arithmetic: 48 and 48 blend to 47.99999999999999, and are 48.)
  return Math.floor(1 / (0.55 / city + 0.45 / highway) + 1e-9);
}

/* --------------------------------------------------------------------- scores ---- */

/**
 * Changes a modification makes that are not a specification figure: grip in g, points on the two modelled indexes,
 * and multipliers on the 0-60 time and the top speed that apply whether those were on file or estimated.
 */
export type ScoreAdjustments = {
  gripG?: number; durabilityPoints?: number; reliabilityPoints?: number; sprintFactor?: number; topSpeedFactor?: number;
  /**
   * The most an estimated top speed may be, before `topSpeedFactor`: what a figure on file would have become, had
   * the estimate from the factory figures been one. Set when parts that move power or weight are fitted.
   */
  topSpeedCeilingMph?: number | null;
  /** True when more power would have raised a top speed on file, and did not because the sheet does not say whether it is limited. */
  topSpeedHeld?: boolean;
};
export type ScoreOptions = {
  /** Estimate a missing top speed, 0-60 or torque from other figures. Default true. With false those scores are 'unavailable'. */
  estimates?: boolean;
  adjust?: ScoreAdjustments;
  /**
   * Fields whose values were worked out by the modification engine rather than read from a source. A score that reads
   * one of them is 'modelled', not 'measured', and its quality is no better than an owner's own figure: nobody
   * measured the result.
   */
  derived?: readonly SpecField[];
};

const present = (spec: VehicleSpec, fields: readonly SpecField[]): SpecField[] => fields.filter((f) => spec[f] !== null);
const absent = (spec: VehicleSpec, fields: readonly SpecField[]): SpecField[] => fields.filter((f) => spec[f] === null);
/** A list without repeats, in the order first met. */
const once = (fields: readonly SpecField[]): SpecField[] => fields.filter((f, i) => fields.indexOf(f) === i);

function made(spec: VehicleSpec, value: number | null, basis: AttributeBasis, metric: number | null, metricUnit: string, inputs: SpecField[], missing: SpecField[], derived = false): AttributeScore {
  if (value === null) return { value: null, basis: 'unavailable', metric: null, metricUnit, inputs: [], missing, quality: null };
  const quality = qualityOfFields(spec, inputs);
  return {
    value, basis: derived && basis === 'measured' ? 'modelled' : basis, metric, metricUnit, inputs, missing,
    quality: derived ? weakestQuality([quality, 'owner']) : quality,
  };
}

/** Scores one specification. Pure: the same specification and options always give the same scores. */
export function scoreSpec(spec: VehicleSpec, options: ScoreOptions = {}): AttributeScores {
  const estimates = options.estimates !== false;
  const adjust = options.adjust ?? {};
  const derived = options.derived ?? [];
  const reads = (fields: readonly SpecField[]): boolean => fields.some((f) => derived.indexOf(f) !== -1);

  // POWER
  const hasTorque = spec.torqueLbFt !== null;
  const output = hasTorque || estimates ? outputIndex(spec) : null;
  const power = made(
    spec, output === null ? null : score1000(output, POWER.anchors), hasTorque ? 'measured' : 'estimated', output === null ? null : Math.round(output * 10) / 10, 'output index',
    present(spec, ['horsepower', 'torqueLbFt']), absent(spec, ['horsepower', 'torqueLbFt']), reads(['horsepower', 'torqueLbFt']),
  );

  // SPEED
  const topFactor = adjust.topSpeedFactor ?? 1;
  const estimatedTop = spec.topSpeedMph || !estimates ? null : estimateTopSpeedMph(spec);
  // With parts fitted, an estimate may not pass what a figure on file would have become under the same parts (more
  // power raises it only when the sheet says the top speed is not limited), so the blank is never worth more than
  // the figure.
  const ceiling = adjust.topSpeedCeilingMph ?? null;
  const overCeiling = estimatedTop !== null && ceiling !== null && estimatedTop > ceiling;
  const rawTop = spec.topSpeedMph ? spec.topSpeedMph.value : overCeiling ? ceiling : estimatedTop;
  const top = rawTop === null ? null : Math.round(rawTop * topFactor * 10) / 10;
  // When a gain was held only because nobody has said whether the top speed is limited, that answer would firm the score up.
  const unanswered: SpecField[] = spec.topSpeedGoverned === null && (overCeiling || adjust.topSpeedHeld === true) ? ['topSpeedGoverned'] : [];
  const speed = made(
    spec, top === null ? null : score1000(top, SPEED.anchors), spec.topSpeedMph ? 'measured' : 'estimated', top, 'mph',
    spec.topSpeedMph ? ['topSpeedMph'] : present(spec, ['horsepower', 'curbWeightLb']),
    spec.topSpeedMph ? unanswered : ['topSpeedMph', ...absent(spec, ['horsepower', 'curbWeightLb']), ...unanswered],
    topFactor !== 1 || reads(['topSpeedMph']),
  );

  // ACCELERATION
  const sprintFactor = adjust.sprintFactor ?? 1;
  const rawSprint = spec.zeroToSixtySec ? spec.zeroToSixtySec.value : estimates ? estimateZeroToSixtySec(spec) : null;
  // A modification can shorten a time, but not past the quickest the estimate itself allows (unless the car was already quicker).
  const sprint = rawSprint === null ? null
    : Math.round((sprintFactor < 1 ? Math.max(rawSprint * sprintFactor, Math.min(rawSprint, ACCELERATION.estimate.floor)) : rawSprint * sprintFactor) * 100) / 100;
  const acceleration = made(
    spec, sprint === null ? null : score1000(sprint, ACCELERATION.anchors), spec.zeroToSixtySec ? 'measured' : 'estimated', sprint, 's 0-60',
    spec.zeroToSixtySec ? ['zeroToSixtySec'] : present(spec, ['horsepower', 'curbWeightLb', 'drivetrain', 'transmissionType', 'powertrain']),
    spec.zeroToSixtySec ? [] : ['zeroToSixtySec', ...absent(spec, ['horsepower', 'curbWeightLb', 'drivetrain', 'transmissionType'])],
    sprintFactor !== 1 || reads(['zeroToSixtySec']),
  );

  // HANDLING
  const gripChange = adjust.gripG ?? 0;
  const rawGrip = spec.lateralGripG ? spec.lateralGripG.value : modelledGripG(spec);
  const grip = rawGrip === null ? null : rawGrip + controlTermG(spec) + gripChange;
  const handling = made(
    spec, grip === null ? null : score1000(grip, HANDLING.anchors), spec.lateralGripG ? 'measured' : 'modelled', grip === null ? null : Math.round(grip * 1000) / 1000, 'g',
    spec.lateralGripG ? present(spec, ['lateralGripG', 'drivetrain', 'brakeGrade']) : present(spec, ['curbWeightLb', 'suspensionGrade', 'drivetrain', 'brakeGrade']),
    spec.lateralGripG ? [] : ['lateralGripG', ...absent(spec, ['curbWeightLb', 'suspensionGrade'])],
    gripChange !== 0 || reads(['lateralGripG']),
  );

  // DURABILITY
  const dPoints = durabilityPoints(spec);
  const dFinal = dPoints === null ? null : Math.round(clamp(dPoints + (adjust.durabilityPoints ?? 0), 0, 1000));
  const durability = made(
    spec, dFinal, 'modelled', dFinal, 'points',
    present(spec, once([...durabilityNeeds(spec), 'construction', 'drivetrain', 'groundClearanceIn'])),
    absent(spec, once([...durabilityNeeds(spec), 'construction', 'drivetrain', 'groundClearanceIn'])),
    (adjust.durabilityPoints ?? 0) !== 0 || reads(['curbWeightLb', 'horsepower', 'groundClearanceIn']),
  );

  // RELIABILITY
  const rPoints = reliabilityPoints(spec);
  const rFinal = rPoints === null ? null : Math.round(clamp(rPoints + (adjust.reliabilityPoints ?? 0), 0, 1000));
  const reliability = made(
    spec, rFinal, 'modelled', rFinal, 'points',
    present(spec, once([...reliabilityNeeds(spec), 'warrantyPowertrainMiles'])),
    absent(spec, once([...reliabilityNeeds(spec), 'warrantyPowertrainMiles'])),
    (adjust.reliabilityPoints ?? 0) !== 0 || reads(['horsepower']),
  );

  // EFFICIENCY
  const economy = combinedEconomy(spec);
  const efficiency = made(
    spec, economy === null ? null : score1000(economy, EFFICIENCY.anchors), 'measured', economy, val(spec.powertrain) === 'electric' ? 'MPGe' : 'mpg',
    spec.combinedMpg ? ['combinedMpg'] : present(spec, ['cityMpg', 'highwayMpg']),
    economy === null ? ['combinedMpg'] : [],
    reads(spec.combinedMpg ? ['combinedMpg'] : ['cityMpg', 'highwayMpg']),
  );

  return { power, speed, acceleration, handling, durability, reliability, efficiency };
}

/* --------------------------------------------------------------------- rating ---- */

export function attributesOf(scores: AttributeScores): MaybeAttributes {
  const out = {} as MaybeAttributes;
  for (const k of ATTRIBUTE_KEYS) out[k] = scores[k].value;
  return out;
}

/** The Power Rating: the weighted mean of all seven attributes, rounded. Null while any attribute has no value. */
export function powerRating(attributes: MaybeAttributes, weights: Record<AttributeKey, number> = POWER_RATING_WEIGHTS): number | null {
  let sum = 0, total = 0;
  for (const k of ATTRIBUTE_KEYS) {
    const v = attributes[k];
    if (v === null) return null;
    sum += v * weights[k];
    total += weights[k];
  }
  return total > 0 ? Math.round(sum / total) : null;
}

/** The same mean over the attributes that have a value. Null when none has. Show it as provisional. */
export function provisionalRating(attributes: MaybeAttributes, weights: Record<AttributeKey, number> = POWER_RATING_WEIGHTS): number | null {
  let sum = 0, total = 0;
  for (const k of ATTRIBUTE_KEYS) {
    const v = attributes[k];
    if (v === null) continue;
    sum += v * weights[k];
    total += weights[k];
  }
  return total > 0 ? Math.round(sum / total) : null;
}

export function layerOf(scores: AttributeScores): StatLayer {
  const attributes = attributesOf(scores);
  return {
    scores,
    powerRating: powerRating(attributes),
    provisionalRating: provisionalRating(attributes),
    rated: ATTRIBUTE_KEYS.filter((k) => attributes[k] !== null).length,
  };
}

/** Layer A: the factory specification, scored. */
export const baseStats = (spec: VehicleSpec, options: ScoreOptions = {}): StatLayer => layerOf(scoreSpec(spec, options));

/** A layer whose seven values were typed in as placeholders, for demonstration cards. Every score is marked 'illustrative'. */
export function illustrativeLayer(attributes: Attributes): StatLayer {
  const scores = {} as AttributeScores;
  for (const k of ATTRIBUTE_KEYS) {
    scores[k] = { value: Math.round(clamp(attributes[k], 0, 1000)), basis: 'illustrative', metric: null, metricUnit: '', inputs: [], missing: [], quality: 'illustrative' };
  }
  return layerOf(scores);
}
