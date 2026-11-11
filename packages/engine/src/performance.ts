// The performance engine: the three layers of a vehicle's stats.
//   base         A. the factory specification, scored
//   vehicle      B. base, every recorded modification, and modelled or inspected wear: this vehicle as its passport describes it
//   competition  base, plus only the modifications and wear an independent verifier attested: what ranked play uses.
//                Its wear comes from a condition worked out from verified inputs alone, so no entry an owner makes
//                (a later reading, a receipt, a declaration) can add to it or take away from it.
// Each change is itemised, one modification at a time in the order they were fitted and then one worn system at a
// time, and the deltas of a layer add up exactly to that layer minus base.
// The only inputs are a specification, modification records and a condition state. Documents are not an input:
// nothing here can turn an uploaded receipt into horsepower.
import { WEAR_SYSTEM_LABELS, wearFactors } from './condition';
import { applyModifications, modLabel, resolveModifications } from './modifications';
import type { ScoreOptions } from './normalize';
import { layerOf, scoreSpec } from './normalize';
import { RULESET } from './rules';
import { ATTRIBUTE_KEYS, EVIDENCE_ORDER } from './types';
import type { ActiveModification, AttributeKey, AttributeScores, ConditionState, EvidenceLevel, StatAdjustment, StatLayer, VehicleSpec, VehicleStats } from './types';

export type StatsInputs = {
  spec: VehicleSpec;
  modifications?: readonly ActiveModification[];
  /** The vehicle's condition from everything on its passport. It wears the vehicle layer. */
  condition?: ConditionState | null;
  /**
   * The condition worked out from verified inputs alone (a verifier's reading, replacements a verifier confirmed,
   * inspections). It wears the competition layer, and only it does: nothing an owner types or uploads can add to
   * this state or take away from it, so nothing an owner does can move a ranked score. Leave it out and the
   * competition layer carries no wear.
   */
  competitionCondition?: ConditionState | null;
  options?: ScoreOptions;
};

// The same order the modification engine resolves in: the day fitted, then when it was written down, then the id.
const inOrder = (mods: readonly ActiveModification[]): ActiveModification[] =>
  mods.slice().sort((a, b) => {
    if (a.installedOn !== b.installedOn) return a.installedOn < b.installedOn ? -1 : 1;
    const wa = a.recordedAt ?? '', wb = b.recordedAt ?? '';
    if (wa !== wb) return wa < wb ? -1 : 1;
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
  });

const atLeast = (evidence: EvidenceLevel, least: EvidenceLevel): boolean => EVIDENCE_ORDER.indexOf(evidence) >= EVIDENCE_ORDER.indexOf(least);

/** Scores the specification with a set of modifications fitted, through the same tables that score the base. */
function scoreWith(spec: VehicleSpec, mods: readonly ActiveModification[], options: ScoreOptions): AttributeScores {
  if (mods.length === 0) return scoreSpec(spec, options);
  const modified = applyModifications(spec, mods);
  return scoreSpec(modified.spec, { ...options, adjust: modified.adjust, derived: modified.changed });
}

function buildLayer(spec: VehicleSpec, mods: readonly ActiveModification[], condition: ConditionState | null, least: EvidenceLevel, options: ScoreOptions): { layer: StatLayer; adjustments: StatAdjustment[]; spec: VehicleSpec } {
  const adjustments: StatAdjustment[] = [];
  const applied = inOrder(resolveModifications(spec, mods.filter((m) => atLeast(m.evidence, least))).applied);

  // Modifications, one at a time in the order they were fitted.
  let scores = scoreSpec(spec, options);
  for (let i = 0; i < applied.length; i++) {
    const next = scoreWith(spec, applied.slice(0, i + 1), options);
    const deltas: Partial<Record<AttributeKey, number>> = {};
    for (const k of ATTRIBUTE_KEYS) {
      const before = scores[k].value, after = next[k].value;
      if (before !== null && after !== null && after !== before) deltas[k] = after - before;
    }
    if (Object.keys(deltas).length > 0) adjustments.push({ source: 'modification', ref: applied[i].eventId, label: modLabel(applied[i].category, applied[i].tier), evidence: applied[i].evidence, deltas });
    scores = next;
  }

  // Wear, one system at a time. The running product is rounded only to report each step, so the steps add up to the total.
  const wear = wearFactors(condition, least);
  const real = {} as Record<AttributeKey, number | null>;
  const shown = {} as Record<AttributeKey, number | null>;
  for (const k of ATTRIBUTE_KEYS) { real[k] = scores[k].value; shown[k] = scores[k].value; }
  for (const step of wear.bySystem) {
    const deltas: Partial<Record<AttributeKey, number>> = {};
    for (const k of ATTRIBUTE_KEYS) {
      const factor = step.factors[k], at = real[k];
      if (factor === undefined || at === null) continue;
      const moved = at * factor, rounded = Math.round(moved);
      if (rounded !== shown[k]) deltas[k] = rounded - (shown[k] as number);
      real[k] = moved;
      shown[k] = rounded;
    }
    if (Object.keys(deltas).length > 0) adjustments.push({ source: 'wear', ref: step.system, label: `${WEAR_SYSTEM_LABELS[step.system]} wear`, evidence: step.evidence, deltas });
  }

  const worn = {} as AttributeScores;
  for (const k of ATTRIBUTE_KEYS) worn[k] = { ...scores[k], value: shown[k] };
  return { layer: layerOf(worn), adjustments, spec: applied.length === 0 ? spec : applyModifications(spec, applied).spec };
}

/** The three layers of one vehicle's stats. Pure: the same inputs always give the same layers, and none is changed. */
export function vehicleStats(inputs: StatsInputs): VehicleStats {
  const options = inputs.options ?? {};
  const mods = inputs.modifications ?? [];
  const vehicle = buildLayer(inputs.spec, mods, inputs.condition ?? null, 'declared', options);
  const competition = buildLayer(inputs.spec, mods, inputs.competitionCondition ?? null, 'verified', options);
  return {
    ruleset: RULESET,
    base: layerOf(scoreSpec(inputs.spec, options)),
    vehicle: vehicle.layer,
    competition: competition.layer,
    adjustments: vehicle.adjustments,
    competitionAdjustments: competition.adjustments,
    vehicleSpec: vehicle.spec,
    competitionSpec: competition.spec,
  };
}

/** What changed from one layer to another, attribute by attribute. Null where either side has no value. */
export function layerDelta(from: StatLayer, to: StatLayer): Record<AttributeKey, number | null> {
  const out = {} as Record<AttributeKey, number | null>;
  for (const k of ATTRIBUTE_KEYS) {
    const a = from.scores[k].value, b = to.scores[k].value;
    out[k] = a === null || b === null ? null : b - a;
  }
  return out;
}
