import { describe, expect, it } from 'vitest';
import { baseStats, combinedEconomy, estimateTopSpeedMph, estimateZeroToSixtySec, illustrativeLayer, layerOf, powerRating, provisionalRating, qualityOf, scoreSpec, specQuality, weakestQuality } from './normalize';
import { ACCELERATION, EFFICIENCY, HANDLING, POWER, SPEED } from './rules';
import { ATTRIBUTE_KEYS } from './types';
import type { Source, Sourced, VehicleSpec } from './types';
import { score1000 } from './util';

const ref: Source = { kind: 'reference', name: 'test fixture', asOf: '2026-11-10' };
const owner: Source = { kind: 'owner', asOf: '2026-11-10' };
const s = <T>(value: T, source: Source = ref): Sourced<T> => ({ value, source });

const blank = (bodyClass: VehicleSpec['identity']['bodyClass'], model = 'Test'): VehicleSpec => ({
  identity: { year: 2024, make: 'Test', model, trim: '', bodyClass },
  engine: null, powertrain: null, induction: null, displacementL: null, cylinders: null, horsepower: null, torqueLbFt: null,
  transmission: null, transmissionType: null, drivetrain: null, curbWeightLb: null, zeroToSixtySec: null, topSpeedMph: null,
  topSpeedGoverned: null, combinedMpg: null, cityMpg: null, highwayMpg: null, evRangeMiles: null, lateralGripG: null,
  braking60to0Ft: null, braking70to0Ft: null, groundClearanceIn: null, construction: null, suspension: null, suspensionGrade: null,
  brakes: null, brakeGrade: null, warrantyPowertrainMiles: null, warrantyPowertrainYears: null, productionUnits: null,
});

// The reference figures gathered for the 2024 Nissan GT-R NISMO (see data/research). This is the calibration vehicle.
const gtr: VehicleSpec = {
  ...blank('sports', 'GT-R'),
  powertrain: s('gasoline'), induction: s('twin-turbo'), displacementL: s(3.8), cylinders: s(6), horsepower: s(600), torqueLbFt: s(481),
  transmissionType: s('dual-clutch'), drivetrain: s('AWD'), curbWeightLb: s(3867), zeroToSixtySec: s(2.9), topSpeedMph: s(196),
  combinedMpg: s(18), cityMpg: s(16), highwayMpg: s(22), lateralGripG: s(1.02), construction: s('unibody'), brakeGrade: s('carbon-ceramic'),
  suspensionGrade: s('sport'), warrantyPowertrainMiles: s(60000), warrantyPowertrainYears: s(5),
};

// The reference figures gathered for the 2024 Honda Civic Sedan LX: no top speed and no skidpad figure were found.
const civic: VehicleSpec = {
  ...blank('sedan', 'Civic'),
  powertrain: s('gasoline'), induction: s('natural'), displacementL: s(2), cylinders: s(4), horsepower: s(158), torqueLbFt: s(138),
  transmissionType: s('cvt'), drivetrain: s('FWD'), curbWeightLb: s(2877), zeroToSixtySec: s(9.7), combinedMpg: s(35), cityMpg: s(31),
  highwayMpg: s(40), groundClearanceIn: s(5.3), construction: s('unibody'), warrantyPowertrainMiles: s(60000), warrantyPowertrainYears: s(5),
};

const values = (spec: VehicleSpec) => {
  const layer = baseStats(spec);
  return Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, layer.scores[k].value]));
};

describe('the calibration vehicle', () => {
  it('scores the brief’s example exactly from its reference specification', () => {
    expect(values(gtr)).toEqual({ power: 950, speed: 920, acceleration: 880, handling: 880, durability: 650, reliability: 700, efficiency: 500 });
    expect(baseStats(gtr).powerRating).toBe(783);
    expect(baseStats(gtr).rated).toBe(7);
  });

  it('marks how each score was reached', () => {
    const sc = scoreSpec(gtr);
    expect(sc.power.basis).toBe('measured');
    expect(sc.speed.basis).toBe('measured');
    expect(sc.acceleration.basis).toBe('measured');
    expect(sc.handling.basis).toBe('measured');
    expect(sc.durability.basis).toBe('modelled');
    expect(sc.reliability.basis).toBe('modelled');
    expect(sc.efficiency.basis).toBe('measured');
    expect(sc.power.metric).toBeCloseTo(564.3, 5);
    expect(sc.handling.metric).toBe(1.05);
    expect(sc.power.quality).toBe('reference');
  });
});

describe('a standard car against a supercar', () => {
  it('puts the Civic well below the GT-R in performance and above it in reliability and efficiency', () => {
    const g = values(gtr), c = values(civic);
    for (const k of ['power', 'speed', 'acceleration', 'handling'] as const) expect((g[k] as number) - (c[k] as number)).toBeGreaterThan(250);
    expect(c.reliability as number).toBeGreaterThan((g.reliability as number) + 100);
    expect(c.efficiency as number).toBeGreaterThan((g.efficiency as number) + 150);
    expect(baseStats(civic).powerRating as number).toBeLessThan(baseStats(gtr).powerRating as number);
  });

  it('does not equate horsepower with POWER', () => {
    // Same horsepower, more torque: a higher POWER score.
    const torquey = { ...civic, torqueLbFt: s(300) };
    expect(scoreSpec(torquey).power.value as number).toBeGreaterThan(scoreSpec(civic).power.value as number);
    // Twice the horsepower is not twice the score.
    const doubled = { ...civic, horsepower: s(316), torqueLbFt: s(276) };
    expect(scoreSpec(doubled).power.value as number).toBeLessThan(2 * (scoreSpec(civic).power.value as number));
  });
});

describe('missing figures', () => {
  it('estimates a missing top speed and says so', () => {
    const sc = scoreSpec(civic);
    expect(sc.speed.basis).toBe('estimated');
    expect(sc.speed.missing).toContain('topSpeedMph');
    expect(sc.speed.metric).toBe(estimateTopSpeedMph(civic));
    expect(sc.speed.metric as number).toBeGreaterThanOrEqual(110);
    expect(sc.speed.metric as number).toBeLessThanOrEqual(130);
    expect(civic.topSpeedMph).toBeNull();
  });

  it('models handling when no skidpad figure exists and says so', () => {
    const sc = scoreSpec(civic);
    expect(sc.handling.basis).toBe('modelled');
    expect(sc.handling.missing).toContain('lateralGripG');
  });

  it('leaves a score empty rather than invent it when estimates are off', () => {
    const sc = scoreSpec(civic, { estimates: false });
    expect(sc.speed.value).toBeNull();
    expect(sc.speed.basis).toBe('unavailable');
    expect(sc.acceleration.value).not.toBeNull();
    const layer = layerOf(sc);
    expect(layer.powerRating).toBeNull();
    expect(layer.rated).toBe(6);
    expect(layer.provisionalRating).not.toBeNull();
  });

  it('scores nothing from an empty specification', () => {
    const layer = baseStats(blank('sedan'));
    expect(layer.rated).toBe(0);
    expect(layer.powerRating).toBeNull();
    expect(layer.provisionalRating).toBeNull();
    for (const k of ATTRIBUTE_KEYS) {
      expect(layer.scores[k].value).toBeNull();
      expect(layer.scores[k].basis).toBe('unavailable');
      expect(layer.scores[k].quality).toBeNull();
    }
  });

  it('needs the powertrain basics before it will model reliability', () => {
    expect(scoreSpec({ ...civic, induction: null }).reliability.value).toBeNull();
    expect(scoreSpec({ ...civic, transmissionType: null }).reliability.value).toBeNull();
    expect(scoreSpec({ ...civic, powertrain: null }).reliability.value).toBeNull();
    // An electric powertrain has no induction to know.
    const ev = { ...blank('sedan'), powertrain: s('electric' as const), transmissionType: s('single-speed' as const), curbWeightLb: s(3900) };
    expect(scoreSpec(ev).reliability.value).not.toBeNull();
  });

  it('estimates 0-60 from weight and power only when both are on file', () => {
    const noTime = { ...civic, zeroToSixtySec: null };
    const est = estimateZeroToSixtySec(noTime) as number;
    expect(est).toBeGreaterThan(7);
    expect(est).toBeLessThan(10.5);
    expect(scoreSpec(noTime).acceleration.basis).toBe('estimated');
    expect(estimateZeroToSixtySec({ ...noTime, curbWeightLb: null })).toBeNull();
    expect(scoreSpec({ ...noTime, curbWeightLb: null }).acceleration.value).toBeNull();
  });

  it('marks POWER as estimated when torque is missing and never rates it without horsepower', () => {
    expect(scoreSpec({ ...civic, torqueLbFt: null }).power.basis).toBe('estimated');
    expect(scoreSpec({ ...civic, torqueLbFt: null }, { estimates: false }).power.value).toBeNull();
    expect(scoreSpec({ ...civic, horsepower: null }).power.value).toBeNull();
  });

  it('blends city and highway the way the EPA does when the combined figure is missing', () => {
    expect(combinedEconomy({ ...civic, combinedMpg: null })).toBeCloseTo(34.5, 0);
    expect(scoreSpec({ ...civic, combinedMpg: null, cityMpg: null }).efficiency.value).toBeNull();
  });
});

describe('the tables', () => {
  it('never score a better figure lower', () => {
    const rising: [readonly (readonly [number, number])[], number, number, number][] = [
      [POWER.anchors, 0, 1600, 10], [SPEED.anchors, 0, 300, 2], [HANDLING.anchors, 0.4, 1.4, 0.01], [EFFICIENCY.anchors, 0, 160, 1],
    ];
    for (const [anchors, from, to, step] of rising) {
      let last = -1;
      for (let x = from; x <= to; x += step) {
        const v = score1000(x, anchors);
        expect(v).toBeGreaterThanOrEqual(last);
        last = v;
      }
    }
    let last = 1001;
    for (let t = 1.5; t <= 26; t += 0.1) {
      const v = score1000(t, ACCELERATION.anchors);
      expect(v).toBeLessThanOrEqual(last);
      last = v;
    }
  });

  it('list their anchors in rising order and stay inside 0 to 1000', () => {
    for (const anchors of [POWER.anchors, SPEED.anchors, HANDLING.anchors, EFFICIENCY.anchors, ACCELERATION.anchors]) {
      for (let i = 1; i < anchors.length; i++) expect(anchors[i][0]).toBeGreaterThan(anchors[i - 1][0]);
      for (const [, y] of anchors) { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(1000); }
    }
  });
});

describe('class and configuration', () => {
  it('rates a body-on-frame 4x4 truck as more durable than a sedan of the same weight', () => {
    const sedan = { ...civic, curbWeightLb: s(4400) };
    const truck: VehicleSpec = { ...sedan, identity: { ...sedan.identity, bodyClass: 'pickup' }, drivetrain: s('4WD'), construction: s('body-on-frame'), groundClearanceIn: s(9.4) };
    expect(scoreSpec(truck).durability.value as number).toBeGreaterThan((scoreSpec(sedan).durability.value as number) + 100);
  });

  it('charges a highly stressed engine in durability and reliability', () => {
    const stressed = { ...civic, horsepower: s(320), induction: s('turbo' as const) };
    expect(scoreSpec(stressed).reliability.value as number).toBeLessThan(scoreSpec(civic).reliability.value as number);
    expect(scoreSpec(stressed).durability.value as number).toBeLessThan(scoreSpec(civic).durability.value as number);
  });

  it('models more grip for a sports car than for a pickup of the same weight', () => {
    const base = { ...blank('sports'), curbWeightLb: s(3600) };
    const pickup: VehicleSpec = { ...base, identity: { ...base.identity, bodyClass: 'pickup' } };
    expect(scoreSpec(base).handling.value as number).toBeGreaterThan(scoreSpec(pickup).handling.value as number);
  });
});

describe('the rating and provenance', () => {
  it('is the equal-weight mean of the seven, rounded', () => {
    expect(powerRating({ power: 950, speed: 920, acceleration: 880, handling: 880, durability: 650, reliability: 700, efficiency: 500 })).toBe(783);
    expect(powerRating({ power: 950, speed: 920, acceleration: 880, handling: 880, durability: 650, reliability: 700, efficiency: null })).toBeNull();
    expect(provisionalRating({ power: 950, speed: 920, acceleration: 880, handling: 880, durability: 650, reliability: 700, efficiency: null })).toBe(830);
  });

  it('builds a demonstration layer from typed-in values and marks every score illustrative', () => {
    const layer = illustrativeLayer({ power: 950, speed: 920, acceleration: 880, handling: 880, durability: 650, reliability: 700, efficiency: 500 });
    expect(layer.powerRating).toBe(783);
    for (const k of ATTRIBUTE_KEYS) { expect(layer.scores[k].basis).toBe('illustrative'); expect(layer.scores[k].quality).toBe('illustrative'); }
  });

  it('reports the weakest source behind a score', () => {
    expect(qualityOf('manufacturer')).toBe('sourced');
    expect(qualityOf('agency')).toBe('sourced');
    expect(qualityOf('test')).toBe('sourced');
    expect(weakestQuality(['sourced', 'owner', 'reference'])).toBe('owner');
    expect(weakestQuality([])).toBeNull();
    const mixed = { ...civic, torqueLbFt: s(138, owner) };
    expect(scoreSpec(mixed).power.quality).toBe('owner');
    expect(specQuality(mixed)).toBe('owner');
    expect(specQuality(blank('sedan'))).toBeNull();
  });

  it('does not change the specification it scores and gives the same answer twice', () => {
    const before = JSON.stringify(gtr);
    const a = scoreSpec(gtr), b = scoreSpec(gtr);
    expect(JSON.stringify(gtr)).toBe(before);
    expect(a).toEqual(b);
  });

  it('applies a modification’s adjustments without touching the specification', () => {
    const plain = scoreSpec(gtr);
    const adj = scoreSpec(gtr, { adjust: { gripG: 0.05, durabilityPoints: -30, reliabilityPoints: -60, sprintFactor: 0.95, topSpeedFactor: 0.98 } });
    expect(adj.handling.value as number).toBeGreaterThan(plain.handling.value as number);
    expect(adj.durability.value).toBe(620);
    expect(adj.reliability.value).toBe(640);
    expect(adj.acceleration.value as number).toBeGreaterThan(plain.acceleration.value as number);
    expect(adj.speed.value as number).toBeLessThan(plain.speed.value as number);
  });
});
