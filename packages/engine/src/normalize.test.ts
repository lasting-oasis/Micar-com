import { describe, expect, it } from 'vitest';
import {
  baseStats, combinedEconomy, durabilityNeeds, estimateTopSpeedMph, estimateZeroToSixtySec, illustrativeLayer, layerOf, outputIndex, powerRating, provisionalRating, qualityOf,
  reliabilityNeeds, scoreSpec, specQuality, specificOutput, stressApplies, weakestQuality,
} from './normalize';
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
  highwayMpg: s(40), groundClearanceIn: s(5.3), construction: s('unibody'), suspensionGrade: s('standard'), brakeGrade: s('standard'),
  warrantyPowertrainMiles: s(60000), warrantyPowertrainYears: s(5),
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
    // With no curb weight either there is no estimate: the class's usual weight used to stand in, and it flattered
    // every car heavier than it (a 4,500 lb sedan gained 16 mph by leaving its weight blank).
    const noWeight = scoreSpec({ ...civic, curbWeightLb: null }).speed;
    expect(noWeight).toMatchObject({ value: null, basis: 'unavailable', missing: ['topSpeedMph', 'curbWeightLb'] });
    expect(estimateTopSpeedMph({ ...civic, curbWeightLb: null })).toBeNull();
    expect(estimateTopSpeedMph({ ...civic, horsepower: null })).toBeNull();
  });

  it('estimates a top speed that moves smoothly with power and weight', () => {
    // There used to be a step here: one horsepower across a threshold was worth 25 mph and 175 points.
    for (const bodyClass of ['sedan', 'coupe', 'hatchback', 'wagon', 'suv', 'van', 'pickup', 'offroad', 'sports'] as const) {
      let last: number | null = null, biggest = 0;
      for (let hp = 80; hp <= 900; hp += 1) {
        const mph = estimateTopSpeedMph({ ...blank(bodyClass), horsepower: s(hp), curbWeightLb: s(3500) }) as number;
        if (last !== null) {
          expect(mph, `${bodyClass} at ${hp} hp`).toBeGreaterThanOrEqual(last);
          biggest = Math.max(biggest, mph - last);
        }
        last = mph;
      }
      expect(biggest, bodyClass).toBeLessThan(1.5);
    }
    // One per cent more power, or one per cent less weight, is never worth more than a few points of SPEED.
    for (let hp = 100; hp <= 600; hp += 7) {
      for (const lb of [2600, 3500, 4400, 5300]) {
        const at = (h: number, w: number) => scoreSpec({ ...blank('sedan'), horsepower: s(h), curbWeightLb: s(w) }).speed.value as number;
        expect(Math.abs(at(hp * 1.01, lb) - at(hp, lb)), `${hp} hp ${lb} lb`).toBeLessThanOrEqual(8);
        expect(Math.abs(at(hp, lb * 0.99) - at(hp, lb)), `${hp} hp ${lb} lb`).toBeLessThanOrEqual(8);
      }
    }
  });

  it('keeps a truck near its tires’ rating however much power it has', () => {
    const truck = (hp: number) => estimateTopSpeedMph({ ...blank('pickup'), horsepower: s(hp), curbWeightLb: s(5600) }) as number;
    expect(truck(300)).toBeLessThanOrEqual(SPEED.estimate.limiter.pickup);
    expect(truck(700)).toBe(SPEED.estimate.performanceLimiter.pickup);
    expect(SPEED.estimate.performanceLimiter.pickup).toBeLessThan(125);
  });

  it('leans low when it estimates, so a measured figure beats a blank on the calibration car', () => {
    // The GT-R's real figures against what the engine would guess without them.
    expect(estimateTopSpeedMph(gtr) as number).toBeLessThanOrEqual(196);
    expect(estimateZeroToSixtySec(gtr) as number).toBeGreaterThanOrEqual(2.9);
    expect(outputIndex({ ...gtr, torqueLbFt: null }) as number).toBeLessThan(outputIndex(gtr) as number);
    for (const field of ['topSpeedMph', 'zeroToSixtySec', 'torqueLbFt', 'combinedMpg', 'lateralGripG', 'displacementL', 'cylinders', 'warrantyPowertrainMiles'] as const) {
      const cleared = scoreSpec({ ...gtr, [field]: null }), full = scoreSpec(gtr);
      for (const k of ATTRIBUTE_KEYS) {
        if (cleared[k].value !== null) expect(cleared[k].value as number, `${field} cleared, ${k}`).toBeLessThanOrEqual(full[k].value as number);
      }
    }
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

  it('needs everything reliability reads before it will model it, and says what is missing', () => {
    // Every one of these can take points away, so none is assumed.
    for (const field of ['powertrain', 'induction', 'transmissionType', 'drivetrain', 'cylinders', 'horsepower', 'displacementL'] as const) {
      const score = scoreSpec({ ...civic, [field]: null }).reliability;
      expect(score.value, field).toBeNull();
      expect(score.missing, field).toContain(field);
    }
    expect(reliabilityNeeds(civic)).toEqual(['powertrain', 'transmissionType', 'drivetrain', 'induction', 'cylinders', 'horsepower', 'displacementL']);
    // A warranty can only add points, so a car without one on file is still rated; the sheet says it would firm the score.
    const noWarranty = scoreSpec({ ...civic, warrantyPowertrainMiles: null }).reliability;
    expect(noWarranty.value).toBe(scoreSpec(civic).reliability.value);
    expect(noWarranty.missing).toEqual(['warrantyPowertrainMiles']);
    // An electric powertrain has no induction, cylinders or displacement to know.
    const ev = { ...blank('sedan'), powertrain: s('electric' as const), transmissionType: s('single-speed' as const), drivetrain: s('RWD' as const), curbWeightLb: s(3900) };
    expect(reliabilityNeeds(ev)).toEqual(['powertrain', 'transmissionType', 'drivetrain']);
    expect(scoreSpec(ev).reliability.value).toBe(835 + 60 + 30);
    expect(scoreSpec({ ...ev, drivetrain: null }).reliability.value).toBeNull();
  });

  it('never charges engine stress to a blank: durability is not given without the figures it reads', () => {
    // Before this rule, clearing the displacement of a highly boosted engine removed the stress term and raised two scores.
    for (const field of ['curbWeightLb', 'horsepower', 'displacementL'] as const) {
      const score = scoreSpec({ ...gtr, [field]: null }).durability;
      expect(score.value, field).toBeNull();
      expect(score.missing, field).toContain(field);
    }
    expect(durabilityNeeds(gtr)).toEqual(['curbWeightLb', 'horsepower', 'displacementL']);
    // A powertrain nobody has named is read as a combustion engine, so it needs them too.
    const unnamed = { ...blank('sedan'), curbWeightLb: s(3300) };
    expect(scoreSpec(unnamed).durability.value).toBeNull();
    expect(scoreSpec({ ...unnamed, horsepower: s(200), displacementL: s(2) }).durability.value).not.toBeNull();
    // An electric motor has no displacement and a hybrid's horsepower is not its engine's: neither is charged, so neither needs them.
    for (const powertrain of ['electric', 'hybrid', 'plug-in-hybrid'] as const) {
      const spec = { ...blank('sedan'), powertrain: s(powertrain), curbWeightLb: s(3300) };
      expect(durabilityNeeds(spec), powertrain).toEqual(['curbWeightLb']);
      expect(scoreSpec(spec).durability.value, powertrain).toBe(640 + 12);
    }
  });

  it('does not charge a hybrid’s engine for its electric motors', () => {
    // 302 system horsepower on a 2.5-litre engine is not 121 hp per litre of engine.
    const plugIn = { ...civic, powertrain: s('plug-in-hybrid' as const), horsepower: s(302), displacementL: s(2.5), transmissionType: s('ecvt' as const) };
    expect(specificOutput(plugIn)).toBeNull();
    expect(stressApplies(plugIn)).toBe(false);
    expect(specificOutput({ ...plugIn, powertrain: s('gasoline' as const) })).toBeCloseTo(120.8, 1);
    // More motor power never lowers a hybrid's durability or reliability.
    const stronger = { ...plugIn, horsepower: s(455) };
    expect(scoreSpec(stronger).durability.value).toBe(scoreSpec(plugIn).durability.value);
    expect(scoreSpec(stronger).reliability.value).toBe(scoreSpec(plugIn).reliability.value);
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

  it('reads a blank drivetrain or transmission as the slowest when it estimates 0-60, and says they are missing', () => {
    const e = ACCELERATION.estimate;
    const car = { ...blank('suv'), powertrain: s('gasoline' as const), horsepower: s(190), curbWeightLb: s(3500) };
    const time = (over: Partial<VehicleSpec>) => estimateZeroToSixtySec({ ...car, ...over }) as number;
    const raw = e.k * Math.pow(3500 / 190, e.exponent);
    // Nothing named: the slowest drivetrain's factor and the continuously variable transmission's.
    expect(time({})).toBe(Math.round(raw * e.drivetrain.FWD * e.cvt * 10) / 10);
    // Naming either can only help, and naming the worst case changes nothing.
    expect(time({ drivetrain: s('FWD'), transmissionType: s('cvt') })).toBe(time({}));
    expect(time({ drivetrain: s('AWD') })).toBeLessThan(time({}));
    expect(time({ transmissionType: s('automatic') })).toBeLessThan(time({}));
    for (const drive of ['AWD', '4WD', 'RWD', 'FWD'] as const) expect(time({ drivetrain: s(drive) }), drive).toBeLessThanOrEqual(time({}));
    for (const gearbox of ['manual', 'automatic', 'dual-clutch', 'cvt', 'ecvt', 'single-speed'] as const) expect(time({ transmissionType: s(gearbox) }), gearbox).toBeLessThanOrEqual(time({}));
    expect(scoreSpec(car).acceleration.missing).toEqual(['zeroToSixtySec', 'drivetrain', 'transmissionType']);
    expect(scoreSpec({ ...car, drivetrain: s('AWD'), transmissionType: s('automatic') }).acceleration.missing).toEqual(['zeroToSixtySec']);
    // The electric factor only helps, so it waits for the powertrain to be named.
    expect(time({ powertrain: s('electric') })).toBeLessThan(time({}));
    expect(time({ powertrain: null })).toBe(time({}));
  });

  it('reads a blank suspension grade as the one with the least grip, and says it is missing', () => {
    const car = { ...blank('offroad'), curbWeightLb: s(4450), drivetrain: s('4WD' as const) };
    const grip = (over: Partial<VehicleSpec>) => scoreSpec({ ...car, ...over }).handling;
    // Clearing an off-road grade used to be worth 0.03 g.
    expect(grip({}).metric).toBe(grip({ suspensionGrade: s('offroad') }).metric);
    for (const grade of ['standard', 'sport', 'adaptive', 'offroad'] as const) expect(grip({ suspensionGrade: s(grade) }).value as number, grade).toBeGreaterThanOrEqual(grip({}).value as number);
    expect(grip({ suspensionGrade: s('standard') }).value as number).toBeGreaterThan(grip({}).value as number);
    expect(grip({}).missing).toEqual(['lateralGripG', 'suspensionGrade']);
    expect(grip({ suspensionGrade: s('standard') }).missing).toEqual(['lateralGripG']);
    // A measured skidpad figure reads no suspension grade at all.
    expect(grip({ lateralGripG: s(0.72) }).missing).toEqual([]);
  });

  it('never scores a specification higher for a field left blank', () => {
    // Every complete specification below is scored, then scored again with one field cleared at a time. A cleared
    // field may leave a score unrated or lower it; it never raises one. Figures an estimate stands in for (a top
    // speed, a 0-60 time, a skidpad figure) are left out here: a slow measured car is simply slower than the estimate.
    const fields = [
      'powertrain', 'induction', 'displacementL', 'cylinders', 'horsepower', 'torqueLbFt', 'transmissionType', 'drivetrain', 'curbWeightLb', 'groundClearanceIn',
      'construction', 'suspensionGrade', 'brakeGrade', 'warrantyPowertrainMiles', 'combinedMpg',
    ] as const;
    const pairs: [number, number][] = [[120, 2600], [300, 3900], [650, 5600]];
    let checked = 0;
    for (const bodyClass of ['sports', 'coupe', 'sedan', 'hatchback', 'wagon', 'suv', 'offroad', 'pickup', 'van'] as const) {
      for (const powertrain of ['gasoline', 'diesel', 'hybrid', 'plug-in-hybrid', 'electric'] as const) {
        for (const drivetrain of ['FWD', 'RWD', 'AWD', '4WD'] as const) {
          for (const gearbox of ['manual', 'automatic', 'cvt', 'single-speed'] as const) {
            for (const grade of ['standard', 'sport', 'adaptive', 'offroad'] as const) {
              for (const [hp, lb] of pairs) {
                const electric = powertrain === 'electric';
                const full: VehicleSpec = {
                  ...blank(bodyClass), powertrain: s(powertrain), induction: electric ? null : s('turbo'), displacementL: electric ? null : s(2.5), cylinders: electric ? null : s(10),
                  horsepower: s(hp), torqueLbFt: s(Math.round(hp * 0.9)), transmissionType: s(gearbox), drivetrain: s(drivetrain), curbWeightLb: s(lb), groundClearanceIn: s(8.5),
                  construction: s('body-on-frame'), suspensionGrade: s(grade), brakeGrade: s('performance'), warrantyPowertrainMiles: s(100000), combinedMpg: s(24), cityMpg: s(21), highwayMpg: s(28),
                };
                const before = scoreSpec(full);
                for (const field of fields) {
                  if (full[field] === null) continue;
                  const after = scoreSpec({ ...full, [field]: null });
                  for (const k of ATTRIBUTE_KEYS) {
                    const was = before[k].value, is = after[k].value;
                    if (is !== null && (was === null || is > was)) throw new Error(`${bodyClass} ${powertrain} ${drivetrain} ${gearbox} ${grade} ${hp} hp: clearing ${field} raised ${k} from ${was} to ${is}`);
                  }
                  checked += 1;
                }
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100000);
  });

  it('marks POWER as estimated when torque is missing and never rates it without horsepower', () => {
    expect(scoreSpec({ ...civic, torqueLbFt: null }).power.basis).toBe('estimated');
    // The estimate takes torque as 60% of the horsepower figure, which is under nearly every production engine: even
    // the highest-revving road engines (about 0.64 lb-ft for each horsepower) do better by entering the real figure.
    expect(outputIndex({ ...civic, torqueLbFt: null })).toBeCloseTo(158 * (0.7 + 0.3 * 0.6), 9);
    expect(POWER.missingTorqueShare).toBe(0.6);
    const revvy = { ...blank('sports'), horsepower: s(553), torqueLbFt: s(354) };
    expect(outputIndex({ ...revvy, torqueLbFt: null }) as number).toBeLessThan(outputIndex(revvy) as number);
    expect(scoreSpec({ ...civic, torqueLbFt: null }).power.value as number).toBeLessThan(scoreSpec(civic).power.value as number);
    expect(scoreSpec({ ...civic, torqueLbFt: null }, { estimates: false }).power.value).toBeNull();
    expect(scoreSpec({ ...civic, horsepower: null }).power.value).toBeNull();
  });

  it('blends city and highway the way the EPA does when the combined figure is missing', () => {
    // To the whole number, as a label prints it. The label's own combined figure is worked out from unrounded city
    // and highway figures, so the blend of the printed ones can fall a mile short of it (34 against the Civic's 35)
    // and is never taken in place of a combined figure that is on file.
    expect(combinedEconomy({ ...civic, combinedMpg: null })).toBe(34);
    expect(combinedEconomy(civic)).toBe(35);
    // 16 city and 22 highway is the GT-R's own 18 combined, not 18.2.
    expect(combinedEconomy({ ...gtr, combinedMpg: null })).toBe(18);
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

  it('calls a figure the modification engine worked out modelled, not measured, and no better than an owner’s own', () => {
    const measured = scoreSpec(gtr);
    expect(measured.power).toMatchObject({ basis: 'measured', quality: 'reference' });
    const derived = scoreSpec({ ...gtr, horsepower: s(690, { ...ref, kind: 'owner', note: 'after modifications' }) }, { derived: ['horsepower'] });
    expect(derived.power).toMatchObject({ basis: 'modelled', quality: 'owner' });
    // Scores that do not read the changed figure keep their own basis; durability and reliability read horsepower through the stress term.
    expect(derived.speed.basis).toBe('measured');
    expect(derived.efficiency.basis).toBe('measured');
    expect(derived.durability.quality).toBe('owner');
    // A factor on a time or a speed on file makes it a worked-out figure too.
    const quicker = scoreSpec(gtr, { adjust: { sprintFactor: 0.95, topSpeedFactor: 1.02, gripG: 0.03 } });
    expect(quicker.acceleration).toMatchObject({ basis: 'modelled', quality: 'owner' });
    expect(quicker.speed).toMatchObject({ basis: 'modelled', quality: 'owner' });
    expect(quicker.handling).toMatchObject({ basis: 'modelled', quality: 'owner' });
    // An estimate stays an estimate.
    expect(scoreSpec({ ...civic, zeroToSixtySec: null }, { adjust: { sprintFactor: 0.95 } }).acceleration.basis).toBe('estimated');
  });

  it('never lets a modification take a 0-60 time below the quickest the estimate allows', () => {
    // Stacked parts used to report a "measured" 1.03 s.
    expect(scoreSpec(gtr, { adjust: { sprintFactor: 0.4 } }).acceleration.metric).toBe(ACCELERATION.estimate.floor);
    expect(scoreSpec(gtr, { adjust: { sprintFactor: 0.9 } }).acceleration.metric).toBe(2.61);
    // A car already quicker than the floor is not slowed by fitting a part.
    const hyper = { ...gtr, zeroToSixtySec: s(1.7) };
    expect(scoreSpec(hyper, { adjust: { sprintFactor: 0.9 } }).acceleration.metric).toBe(1.7);
    expect(scoreSpec(hyper, { adjust: { sprintFactor: 1.1 } }).acceleration.metric).toBe(1.87);
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
