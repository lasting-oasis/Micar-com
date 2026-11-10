import { describe, expect, it } from 'vitest';
import { assessCondition } from './condition';
import { baseStats } from './normalize';
import { layerDelta, vehicleStats } from './performance';
import type { StatsInputs } from './performance';
import { emptySpec } from './specs';
import { ATTRIBUTE_KEYS } from './types';
import type { ActiveModification, ConditionInputs, EvidenceLevel, ModCategory, ModTier, Sourced, StatAdjustment, StatLayer, VehicleSpec } from './types';

const ref = { kind: 'reference', name: 'fixture', asOf: '2026-11-10' } as const;
const s = <T>(value: T): Sourced<T> => ({ value, source: ref });

const civic: VehicleSpec = {
  ...emptySpec({ year: 2019, make: 'Honda', model: 'Civic', trim: 'LX', bodyClass: 'sedan' }),
  powertrain: s('gasoline'), induction: s('natural'), displacementL: s(2), cylinders: s(4), horsepower: s(158), torqueLbFt: s(138), transmissionType: s('cvt'),
  drivetrain: s('FWD'), curbWeightLb: s(2877), zeroToSixtySec: s(9.7), topSpeedMph: s(126), combinedMpg: s(35), groundClearanceIn: s(5.3), warrantyPowertrainMiles: s(60000),
};
const truck: VehicleSpec = {
  ...emptySpec({ year: 2021, make: 'Toyota', model: 'Tacoma', trim: 'TRD Off-Road', bodyClass: 'pickup' }),
  powertrain: s('gasoline'), induction: s('natural'), displacementL: s(3.5), cylinders: s(6), horsepower: s(278), torqueLbFt: s(265), transmissionType: s('automatic'),
  drivetrain: s('4WD'), curbWeightLb: s(4445), zeroToSixtySec: s(7.7), topSpeedMph: s(113), topSpeedGoverned: s(true), combinedMpg: s(20), groundClearanceIn: s(9.4),
  construction: s('body-on-frame'), warrantyPowertrainMiles: s(60000),
};
const ev: VehicleSpec = {
  ...emptySpec({ year: 2024, make: 'Tesla', model: 'Model 3', trim: 'RWD', bodyClass: 'sedan' }),
  powertrain: s('electric'), transmissionType: s('single-speed'), horsepower: s(271), torqueLbFt: s(310), drivetrain: s('RWD'), curbWeightLb: s(3880),
  zeroToSixtySec: s(5.8), topSpeedMph: s(125), combinedMpg: s(132), warrantyPowertrainMiles: s(100000),
};

let n = 0;
const mod = (category: ModCategory, tier: ModTier, evidence: EvidenceLevel = 'declared', over: Partial<ActiveModification> = {}): ActiveModification =>
  ({ eventId: `m${++n}`, category, tier, install: 'owner', evidence, installedOn: `2026-0${1 + (n % 9)}-01`, installedAtMileage: null, upkeep: 'recent', ...over });

const condition = (over: Partial<ConditionInputs> = {}) => assessCondition({
  asOf: '2026-11-10', modelYear: 2019, powertrain: 'gasoline', mileage: { value: 120000, evidence: 'documented' }, replacements: [], inspections: [], accident: null, titleStatus: null, ...over,
});

const values = (layer: StatLayer) => ATTRIBUTE_KEYS.map((k) => layer.scores[k].value);
const sumDeltas = (list: StatAdjustment[]) => {
  const out: Record<string, number> = {};
  for (const k of ATTRIBUTE_KEYS) out[k] = 0;
  for (const a of list) for (const k of ATTRIBUTE_KEYS) out[k] += a.deltas[k] ?? 0;
  return out;
};

describe('the three layers', () => {
  it('are equal when nothing is recorded', () => {
    const stats = vehicleStats({ spec: civic });
    expect(stats.base).toEqual(baseStats(civic));
    expect(stats.vehicle).toEqual(stats.base);
    expect(stats.competition).toEqual(stats.base);
    expect(stats.adjustments).toEqual([]);
    expect(stats.competitionAdjustments).toEqual([]);
    expect(stats.ruleset).toBe('micar-rules-v1');
  });

  it('take a specification, modification records and a condition, and nothing else', () => {
    // There is no place to hand in a document, a receipt or a grade: an upload cannot become horsepower.
    const inputs: Required<StatsInputs> = { spec: civic, modifications: [], condition: null, competitionCondition: null, options: {} };
    expect(Object.keys(inputs).sort()).toEqual(['competitionCondition', 'condition', 'modifications', 'options', 'spec']);
  });

  it('do not change what they are given, and give the same answer twice', () => {
    const mods = [mod('turbo', 2), mod('tires', 1)];
    const cond = condition();
    const before = JSON.stringify([civic, mods, cond]);
    const a = vehicleStats({ spec: civic, modifications: mods, condition: cond });
    const b = vehicleStats({ spec: civic, modifications: mods, condition: cond });
    expect(a).toEqual(b);
    expect(JSON.stringify([civic, mods, cond])).toBe(before);
  });
});

describe('modifications in the vehicle layer', () => {
  it('raise what they should and charge for it', () => {
    const stats = vehicleStats({ spec: civic, modifications: [mod('turbo', 2)] });
    const d = layerDelta(stats.base, stats.vehicle);
    expect(d.power as number).toBeGreaterThan(0);
    expect(d.acceleration as number).toBeGreaterThan(0);
    expect(d.speed as number).toBeGreaterThan(0);
    expect(d.reliability as number).toBeLessThan(0);
    expect(d.efficiency as number).toBeLessThan(0);
    expect(d.durability as number).toBeLessThan(0);
    expect(stats.adjustments).toHaveLength(1);
    expect(stats.adjustments[0]).toMatchObject({ source: 'modification', label: 'Turbocharger kit · Pro', evidence: 'declared' });
  });

  it('itemise each one in the order fitted, and the items add up to the layer', () => {
    const mods = [mod('weight', 3, 'declared', { installedOn: '2026-03-01' }), mod('turbo', 1, 'documented', { installedOn: '2026-01-01' }), mod('suspension', 2, 'declared', { installedOn: '2026-02-01' })];
    const stats = vehicleStats({ spec: civic, modifications: mods, condition: condition() });
    expect(stats.adjustments.filter((a) => a.source === 'modification').map((a) => a.label)).toEqual(['Turbocharger kit · Street', 'Suspension · Pro', 'Weight reduction · Extreme']);
    const total = sumDeltas(stats.adjustments);
    const d = layerDelta(stats.base, stats.vehicle);
    for (const k of ATTRIBUTE_KEYS) expect(total[k], k).toBe(d[k]);
  });

  it('cost less reliability when fitted professionally and kept up', () => {
    const careful = vehicleStats({ spec: civic, modifications: [mod('turbo', 3, 'declared', { install: 'professional', upkeep: 'documented' })] });
    const careless = vehicleStats({ spec: civic, modifications: [mod('turbo', 3, 'declared', { install: 'unknown', upkeep: 'lapsed' })] });
    expect(careful.vehicle.scores.reliability.value as number).toBeGreaterThan(careless.vehicle.scores.reliability.value as number);
    expect(careful.vehicle.scores.power.value).toBe(careless.vehicle.scores.power.value);
  });

  it('leave a governed top speed alone when power rises', () => {
    const stats = vehicleStats({ spec: truck, modifications: [mod('supercharger', 2)] });
    expect(stats.vehicle.scores.speed.value).toBe(stats.base.scores.speed.value);
    expect(stats.vehicle.scores.power.value as number).toBeGreaterThan(stats.base.scores.power.value as number);
  });

  it('refuse a combustion modification on an electric car and change nothing', () => {
    const stats = vehicleStats({ spec: ev, modifications: [mod('turbo', 2)] });
    expect(stats.vehicle).toEqual(stats.base);
    expect(stats.adjustments).toEqual([]);
    const tires = vehicleStats({ spec: ev, modifications: [mod('tires', 2)] });
    expect(tires.vehicle.scores.handling.value as number).toBeGreaterThan(tires.base.scores.handling.value as number);
  });

  it('never fill in a figure that is missing', () => {
    const bare: VehicleSpec = { ...civic, combinedMpg: null, topSpeedMph: null, torqueLbFt: null };
    const stats = vehicleStats({ spec: bare, modifications: [mod('turbo', 2), mod('eco', 1)] });
    expect(stats.vehicle.scores.efficiency.value).toBeNull();
    expect(stats.vehicle.powerRating).toBeNull();
    expect(stats.vehicle.scores.speed.basis).toBe('estimated');
    expect(stats.adjustments.every((a) => a.deltas.efficiency === undefined)).toBe(true);
  });
});

describe('wear', () => {
  it('lowers scores, never raises them, and is itemised by system', () => {
    const stats = vehicleStats({ spec: civic, condition: condition() });
    for (const k of ATTRIBUTE_KEYS) expect(stats.vehicle.scores[k].value as number, k).toBeLessThanOrEqual(stats.base.scores[k].value as number);
    expect(stats.vehicle.scores.power.value as number).toBeLessThan(stats.base.scores.power.value as number);
    expect(stats.adjustments.every((a) => a.source === 'wear')).toBe(true);
    expect(stats.adjustments.map((a) => a.ref)).toContain('engine');
    const total = sumDeltas(stats.adjustments);
    const d = layerDelta(stats.base, stats.vehicle);
    for (const k of ATTRIBUTE_KEYS) expect(total[k], k).toBe(d[k]);
    for (const a of stats.adjustments) for (const k of ATTRIBUTE_KEYS) if (a.deltas[k] !== undefined) expect(a.deltas[k] as number).toBeLessThan(0);
  });

  it('is undone by a documented replacement, back toward factory and never past it', () => {
    const worn = vehicleStats({ spec: civic, condition: condition() });
    const rebuilt = vehicleStats({ spec: civic, condition: condition({ replacements: [{ system: 'engine', date: '2026-10-01', mileage: 119000, evidence: 'documented' }] }) });
    expect(rebuilt.vehicle.scores.power.value as number).toBeGreaterThan(worn.vehicle.scores.power.value as number);
    for (const k of ATTRIBUTE_KEYS) expect(rebuilt.vehicle.scores[k].value as number, k).toBeLessThanOrEqual(rebuilt.base.scores[k].value as number);
    // A replacement the owner only declares restores nothing.
    const claimed = vehicleStats({ spec: civic, condition: condition({ replacements: [{ system: 'engine', date: '2026-10-01', mileage: 119000, evidence: 'declared' }] }) });
    expect(values(claimed.vehicle)).toEqual(values(worn.vehicle));
  });

  it('cannot push a score above what the same modifications give with no wear', () => {
    const mods = [mod('turbo', 2), mod('tires', 2)];
    const fresh = vehicleStats({ spec: civic, modifications: mods });
    for (const miles of [0, 40000, 120000, 300000]) {
      const used = vehicleStats({ spec: civic, modifications: mods, condition: condition({ mileage: { value: miles, evidence: 'documented' } }) });
      for (const k of ATTRIBUTE_KEYS) expect(used.vehicle.scores[k].value as number, `${k} at ${miles}`).toBeLessThanOrEqual(fresh.vehicle.scores[k].value as number);
    }
  });
});

describe('ranked play', () => {
  it('is worn only by the condition assessed from verified inputs, whatever the vehicle’s own condition says', () => {
    const verified = condition({ mileage: { value: 180000, evidence: 'verified' } });
    const worn = vehicleStats({ spec: civic, condition: verified, competitionCondition: verified }).competition;
    expect(worn.scores.reliability.value as number).toBeLessThan(vehicleStats({ spec: civic }).base.scores.reliability.value as number);
    // The owner types a newer reading. The vehicle's own condition now rests on it; the verified state does not change, so neither does ranked play.
    const typed = condition({ mileage: { value: 180050, evidence: 'declared' } });
    expect(values(vehicleStats({ spec: civic, condition: typed, competitionCondition: verified }).competition)).toEqual(values(worn));
    // A declared salvage title lowers the vehicle layer and leaves ranked play exactly where the verifier put it.
    const salvage = condition({ mileage: { value: 180050, evidence: 'declared' }, titleStatus: 'Salvage' });
    const withTitle = vehicleStats({ spec: civic, condition: salvage, competitionCondition: verified });
    expect(values(withTitle.competition)).toEqual(values(worn));
    expect(withTitle.vehicle.scores.durability.value as number).toBeLessThan(worn.scores.durability.value as number);
    // With no verified state handed in, ranked play carries no wear at all: it is never read off the vehicle's own condition.
    const none = vehicleStats({ spec: civic, condition: verified });
    expect(values(none.competition)).toEqual(values(none.base));
    expect(none.competitionAdjustments).toEqual([]);
    // A state that is not verified cannot wear ranked play even when it is handed in as one.
    expect(values(vehicleStats({ spec: civic, competitionCondition: typed }).competition)).toEqual(values(none.base));
  });

  it('ignores what is only declared or documented', () => {
    const mods = [mod('turbo', 3, 'declared'), mod('weight', 2, 'documented')];
    const stats = vehicleStats({ spec: civic, modifications: mods, condition: condition() });
    expect(stats.vehicle.scores.power.value).not.toBe(stats.base.scores.power.value);
    expect(values(stats.competition)).toEqual(values(stats.base));
    expect(stats.competitionAdjustments).toEqual([]);
  });

  it('counts a verified modification and verified wear, and itemises them', () => {
    const mods = [mod('turbo', 2, 'verified'), mod('tires', 3, 'declared')];
    const verifiedWear = condition({ mileage: { value: 120000, evidence: 'verified' } });
    const stats = vehicleStats({ spec: civic, modifications: mods, condition: verifiedWear, competitionCondition: verifiedWear });
    expect(stats.competitionAdjustments.filter((a) => a.source === 'modification').map((a) => a.label)).toEqual(['Turbocharger kit · Pro']);
    expect(stats.competitionAdjustments.some((a) => a.source === 'wear')).toBe(true);
    expect(stats.competitionAdjustments.every((a) => a.evidence === 'verified')).toBe(true);
    const total = sumDeltas(stats.competitionAdjustments);
    const d = layerDelta(stats.base, stats.competition);
    for (const k of ATTRIBUTE_KEYS) expect(total[k], k).toBe(d[k]);
    // The declared tires count for the vehicle and not for ranked play.
    expect(stats.vehicle.scores.handling.value as number).toBeGreaterThan(stats.competition.scores.handling.value as number);
  });
});

describe('layerDelta', () => {
  it('is null where either side has no value', () => {
    const bare = vehicleStats({ spec: { ...civic, combinedMpg: null } });
    expect(layerDelta(bare.base, bare.vehicle).efficiency).toBeNull();
    expect(layerDelta(bare.base, bare.vehicle).power).toBe(0);
  });
});
