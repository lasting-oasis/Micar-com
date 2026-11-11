import { describe, expect, it } from 'vitest';
import { assessCondition } from './condition';
import { SETUP_CARDS, entrantWithSetup, race } from './game';
import { baseStats } from './normalize';
import { layerDelta, vehicleStats } from './performance';
import type { StatsInputs } from './performance';
import { emptySpec } from './specs';
import { ATTRIBUTE_KEYS, RACE_MODES } from './types';
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
    const inputs: Required<StatsInputs> = { spec: civic, modifications: [], competitionModifications: [], condition: null, competitionCondition: null, options: {} };
    expect(Object.keys(inputs).sort()).toEqual(['competitionCondition', 'competitionModifications', 'condition', 'modifications', 'options', 'spec']);
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
    // The sheet does not say whether the top speed on file is limited, so more power does not raise it...
    expect(d.speed).toBe(0);
    // ...and it does once the sheet says it is not.
    const free = vehicleStats({ spec: { ...civic, topSpeedGoverned: s(false) }, modifications: [mod('turbo', 2)] });
    expect(layerDelta(free.base, free.vehicle).speed as number).toBeGreaterThan(0);
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

describe('the specification a layer was scored from', () => {
  it('carries that layer’s modifications, so a race reads the clearance of the car it is racing', () => {
    const lifted = [mod('offroad', 3, 'declared')];
    const stats = vehicleStats({ spec: truck, modifications: lifted });
    expect(stats.vehicleSpec.groundClearanceIn?.value).toBeCloseTo(9.4 + 3.5, 9);
    // The kit is only declared, so ranked play races the factory truck.
    expect(stats.competitionSpec.groundClearanceIn?.value).toBe(9.4);
    expect(stats.competitionSpec).toEqual(truck);
    const verified = vehicleStats({ spec: truck, modifications: [mod('offroad', 3, 'verified')] });
    expect(verified.competitionSpec.groundClearanceIn?.value).toBeCloseTo(12.9, 9);
    // With nothing fitted both are the specification itself.
    const stock = vehicleStats({ spec: truck });
    expect(stock.vehicleSpec).toBe(truck);
    expect(stock.competitionSpec).toBe(truck);
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

describe('ranked play and the modifications it counts', () => {
  it('reads its own list when one is given, and still only the verified ones on it', () => {
    const turbo = mod('turbo', 3, 'verified', { install: 'professional', upkeep: 'documented' });
    const tires = mod('tires', 2, 'documented');
    // The vehicle's own list says the turbo is gone and the upkeep lapsed; the ranked list says what verifiers confirmed.
    const stats = vehicleStats({ spec: civic, modifications: [tires], competitionModifications: [{ ...turbo, upkeep: 'lapsed' }, tires] });
    expect(stats.competitionAdjustments.map((a) => a.ref)).toEqual([turbo.eventId]);
    expect(stats.adjustments.map((a) => a.ref)).toEqual([tires.eventId]);
    expect(stats.competition.scores.power.value as number).toBeGreaterThan(stats.base.scores.power.value as number);
    expect(stats.vehicle.scores.power.value).toBe(stats.base.scores.power.value);
    // The upkeep on the ranked list is the one that counts for the ranked layer.
    const kept = vehicleStats({ spec: civic, modifications: [], competitionModifications: [turbo] });
    expect(kept.competition.scores.reliability.value as number).toBeGreaterThan(stats.competition.scores.reliability.value as number);
    // An empty ranked list is an empty ranked layer, whatever the vehicle's own list holds.
    const none = vehicleStats({ spec: civic, modifications: [turbo], competitionModifications: [] });
    expect(values(none.competition)).toEqual(values(none.base));
    // With no ranked list given, the verified ones on the vehicle's list are used as they are.
    const same = vehicleStats({ spec: civic, modifications: [turbo, tires] });
    expect(same.competitionAdjustments.map((a) => a.ref)).toEqual([turbo.eventId]);
  });
});

describe('a blank field under modifications', () => {
  // Complete specifications of several kinds, each with every figure a modification can read on file. City and
  // highway economy differ from the combined figure, as on a real label.
  const MEASURED = ['topSpeedMph', 'zeroToSixtySec', 'lateralGripG'];
  const complete = (spec: VehicleSpec, over: Partial<VehicleSpec> = {}): VehicleSpec => {
    const combined = spec.combinedMpg ? spec.combinedMpg.value : 30;
    return {
      ...spec, construction: s('unibody'), suspensionGrade: s('standard'), brakeGrade: s('standard'), cityMpg: s(combined - 3), highwayMpg: s(combined + 5), lateralGripG: s(0.86),
      topSpeedGoverned: s(false), ...over,
    };
  };
  const SPECS: [string, VehicleSpec][] = [
    ['civic', complete(civic)], ['civic, limited', complete(civic, { topSpeedGoverned: s(true) })], ['civic, nobody has said', complete(civic, { topSpeedGoverned: null })],
    ['truck', complete(truck, { topSpeedGoverned: s(true), suspensionGrade: s('offroad'), construction: s('body-on-frame') })], ['truck, not limited', complete(truck, { topSpeedGoverned: s(false) })],
    ['electric', complete(ev, { topSpeedGoverned: s(true) })], ['electric, not limited', complete(ev)],
    ['hybrid', complete(civic, { powertrain: s('hybrid'), transmissionType: s('ecvt'), horsepower: s(194), combinedMpg: s(52) })],
    ['quick', complete(civic, { horsepower: s(700), torqueLbFt: s(650), curbWeightLb: s(3600), zeroToSixtySec: s(2.4), topSpeedMph: s(205), lateralGripG: s(1.05), induction: s('twin-turbo'), displacementL: s(4), cylinders: s(8), drivetrain: s('AWD'), transmissionType: s('dual-clutch') })],
    // A car whose figures on file are better than anything they would be estimated at.
    ['better than its estimates', complete(civic, { topSpeedMph: s(140), zeroToSixtySec: s(6.9), lateralGripG: s(0.95), topSpeedGoverned: null })],
    ['at its class limiter, limited', complete(civic, { horsepower: s(205), topSpeedMph: s(137), topSpeedGoverned: s(true) })],
  ];
  const fieldsOf = (spec: VehicleSpec) => (Object.keys(spec) as (keyof VehicleSpec)[]).filter((f) => f !== 'identity' && spec[f] !== null);
  // A combustion-only part waits for the powertrain to be named. Clearing the powertrain then takes the part off the
  // car altogether, its costs with its gains, which is what removing the part does: it is not a blank beating a figure.
  const COMBUSTION: ModCategory[] = ['engine', 'ecu', 'intake-exhaust', 'turbo', 'supercharger', 'nitrous'];
  // The wear a passport would hand in for the specification as it stands: the powertrain is read off the sheet.
  const worn = (spec: VehicleSpec) => condition({ modelYear: 2012, powertrain: spec.powertrain ? spec.powertrain.value : null, mileage: { value: 150000, evidence: 'documented' } });
  /**
   * A measured figure (top speed, 0-60, skidpad) is cleared too, wherever it is no worse than the estimate that
   * takes its place at the factory: a car slower than its estimate scores lower once its real figure is entered,
   * and that is the estimate's doing, not the parts'.
   */
  const comparable = (field: keyof VehicleSpec, spec: VehicleSpec): boolean => {
    if (MEASURED.indexOf(field) === -1) return true;
    const full = baseStats(spec).scores, cleared = baseStats({ ...spec, [field]: null }).scores;
    return ATTRIBUTE_KEYS.every((k) => cleared[k].value === null || (full[k].value !== null && (cleared[k].value as number) <= (full[k].value as number)));
  };

  it('never raises an attribute of the vehicle or the ranked layer, whatever is fitted and however worn the car', () => {
    const fitted = (list: [ModCategory, ModTier][]): ActiveModification[] => list.map(([category, tier], i) => mod(category, tier, 'verified', { installedOn: `2026-0${1 + i}-01` }));
    const STACKS: [ModCategory, ModTier][][] = [
      [], [['turbo', 3]], [['engine', 3], ['ecu', 3]], [['offroad', 3]], [['eco', 3], ['aero', 3]], [['weight', 3], ['tires', 3]], [['supercharger', 3], ['offroad', 3]],
      [['nitrous', 3], ['intake-exhaust', 3], ['transmission', 3]], [['suspension', 3], ['brakes', 3]], [['turbo', 1], ['weight', 1], ['eco', 2]], [['aero', 2]], [['aero', 1], ['offroad', 3]],
    ];
    let checked = 0, measured = 0;
    for (const [name, spec] of SPECS) {
      for (const stack of STACKS) {
        const mods = fitted(stack);
        for (const wear of [false, true]) {
          const full = vehicleStats({ spec, modifications: mods, competitionModifications: mods, condition: wear ? worn(spec) : null, competitionCondition: wear ? worn(spec) : null });
          for (const field of fieldsOf(spec)) {
            if (field === 'powertrain' && stack.some(([category]) => COMBUSTION.indexOf(category) !== -1)) continue;
            if (!comparable(field, spec)) continue;
            const blank = { ...spec, [field]: null };
            const cleared = vehicleStats({ spec: blank, modifications: mods, competitionModifications: mods, condition: wear ? worn(blank) : null, competitionCondition: wear ? worn(blank) : null });
            for (const layer of ['vehicle', 'competition'] as const) {
              for (const k of ATTRIBUTE_KEYS) {
                const was = full[layer].scores[k].value, is = cleared[layer].scores[k].value;
                if (is !== null && (was === null || is > was)) throw new Error(`${name}${wear ? ', worn' : ''} with ${stack.map((m) => m.join(':')).join(' + ') || 'nothing fitted'}: clearing ${field} raised ${layer} ${k} from ${was} to ${is}`);
              }
            }
            checked += 1;
            if (MEASURED.indexOf(field) !== -1) measured += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
    expect(measured).toBeGreaterThan(200);
  });

  it('never raises a free-play race score, whatever cards are in the setup', () => {
    const SETUPS = [...SETUP_CARDS.filter((c) => c.tier === 3).map((c) => [c.id]), ['turbo:3', 'engine:3'], ['supercharger:3', 'offroad:3'], ['eco:3', 'aero:3'], ['offroad:3', 'aero:3'], ['weight:3', 'tires:3'], ['aero:2'], ['aero:1'], ['eco:2']];
    const scores = (spec: VehicleSpec, cardIds: string[]): Record<string, number | null> | null => {
      const entrant = entrantWithSetup({ id: 'car', name: 'car', spec, cardIds });
      if (!entrant.ok) return null; // a setup the vehicle cannot take starts nobody
      const out: Record<string, number | null> = {};
      for (const mode of RACE_MODES) { const row = race(mode, [entrant.value], 7).rows[0]; out[mode] = row ? row.score : null; }
      return out;
    };
    let checked = 0;
    for (const [name, spec] of SPECS) {
      for (const cardIds of SETUPS) {
        const full = scores(spec, cardIds);
        for (const field of fieldsOf(spec)) {
          if (!comparable(field, spec)) continue;
          const cleared = scores({ ...spec, [field]: null }, cardIds);
          if (cleared === null) continue;
          for (const mode of RACE_MODES) {
            const was = full === null ? null : full[mode], is = cleared[mode];
            if (is !== null && (was === null || is > was)) throw new Error(`${name} with ${cardIds.join(' + ')}: clearing ${field} raised the ${mode} score from ${was} to ${is}`);
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });
});

describe('layerDelta', () => {
  it('is null where either side has no value', () => {
    const bare = vehicleStats({ spec: { ...civic, combinedMpg: null } });
    expect(layerDelta(bare.base, bare.vehicle).efficiency).toBeNull();
    expect(layerDelta(bare.base, bare.vehicle).power).toBe(0);
  });
});
