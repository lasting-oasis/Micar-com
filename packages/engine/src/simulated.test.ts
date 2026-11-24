import { describe, expect, it } from 'vitest';
import { catalogueEntry } from './database';
import { RACE_CLASSES, raceClassOf } from './game';
import { MODS } from './modifications';
import { baseStats, estimateTopSpeedMph, estimateZeroToSixtySec, modelledGripG, scoreSpec } from './normalize';
import { POWER } from './rules';
import { SIMULATED_FIELDS, SIMULATED_NOTE, simulatedSpec, simulatedStats } from './simulated';
import type { BenchFigures, SimulatedField } from './simulated';
import type { ActiveModification, AttributeKey, Sourced, VehicleSpec } from './types';
import { interpolate } from './util';

/** A real research card from the catalogue. */
function card(id: string): VehicleSpec {
  const entry = catalogueEntry(id);
  if (entry === null) throw new Error(`no catalogue entry ${id}`);
  return entry.spec;
}

/** A copy that cannot be changed, however deep: a function that wrote into its input would throw. */
function frozen<T>(v: T): T {
  if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v as object)) frozen((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}

const value = (cell: Sourced<number> | null): number | null => (cell === null ? null : cell.value);
const scoresOf = (layer: ReturnType<typeof baseStats>): Record<AttributeKey, number | null> => {
  const out = {} as Record<AttributeKey, number | null>;
  for (const k of Object.keys(layer.scores) as AttributeKey[]) out[k] = layer.scores[k].value;
  return out;
};

// Three real cards of different kinds. The GT-R NISMO (a twin-turbo all-wheel-drive sports car) has every figure on
// file; the Civic LX (a front-drive four-cylinder sedan with a CVT) has no top speed or skidpad figure; the Odyssey
// EX-L (a V6 minivan) has no 0-60, top speed or skidpad figure.
const GTR = '2024-nissan-gt-r-nismo', CIVIC = '2024-honda-civic-sedan-lx', ODYSSEY = '2024-honda-odyssey-ex-l';

// What a stock run of the bench might read for each: the peaks the engine was built from, the published weight, and
// timed figures a few per cent off the published ones, as any model is. Only the ratio of two runs is ever used.
const STOCK: Record<string, BenchFigures> = {
  [GTR]: { horsepower: 600, torqueLbFt: 481, curbWeightLb: 3867, zeroToSixtySec: 2.78, topSpeedMph: 193.6, lateralGripG: 1.04 },
  [CIVIC]: { horsepower: 158, torqueLbFt: 138, curbWeightLb: 2877, zeroToSixtySec: 9.31, topSpeedMph: 124.2, lateralGripG: 0.83 },
  [ODYSSEY]: { horsepower: 280, torqueLbFt: 262, curbWeightLb: 4526, zeroToSixtySec: 6.9, topSpeedMph: 112.4, lateralGripG: 0.79 },
};

describe('a stock bench', () => {
  for (const id of [GTR, CIVIC, ODYSSEY]) {
    it(`gives back the ${id} card exactly as published, though the bench reads it off its figures`, () => {
      const spec = frozen(card(id));
      const bench = STOCK[id];
      // Two runs of the same stock car: the same numbers, read twice.
      const out = simulatedSpec(spec, bench, { ...bench });
      expect(out.changed).toEqual([]);
      expect(out.adjust).toEqual({});
      for (const field of SIMULATED_FIELDS) expect(out.spec[field]).toBe(spec[field]);
      expect(out.spec).toEqual(spec);
      // Scored with the tables every card is scored with, it is the published card: the same seven scores, the same
      // bases and sources, the same Power Rating and the same class.
      const sim = simulatedStats(spec, bench, bench);
      expect(sim).toEqual(baseStats(spec));
      expect(raceClassOf(sim.powerRating)).toBe(raceClassOf(baseStats(spec).powerRating));
    });
  }

  it('reads the card unchanged even when the bench is far off the published figures: only the change is simulated', () => {
    // The bench's 0-60 here is 20% slower than the GT-R's published 2.9 s, and its skidpad 10% short of 1.02 g.
    const spec = card(GTR);
    const poor: BenchFigures = { ...STOCK[GTR], zeroToSixtySec: 3.48, lateralGripG: 0.918 };
    expect(simulatedSpec(spec, poor, poor).spec).toEqual(spec);
  });
});

describe('a build that raises bench power 20%', () => {
  const boosted = (id: string): BenchFigures => ({ ...STOCK[id], horsepower: STOCK[id].horsepower * 1.2 });

  it('raises each card\'s horsepower 20% and marks it as simulated on the bench', () => {
    for (const [id, hp] of [[GTR, 720], [CIVIC, 189.6], [ODYSSEY, 336]] as const) {
      const spec = card(id);
      const out = simulatedSpec(spec, STOCK[id], boosted(id));
      expect(value(out.spec.horsepower), id).toBe(hp);
      expect(out.changed, id).toEqual(['horsepower']);
      const was = spec.horsepower as Sourced<number>, now = out.spec.horsepower as Sourced<number>;
      expect(now.source).toEqual({ ...was.source, kind: 'owner', note: SIMULATED_NOTE });
      // The torque the bench did not move stays the published figure, the same object.
      expect(out.spec.torqueLbFt).toBe(spec.torqueLbFt);
    }
  });

  it('moves POWER by the POWER table and charges the higher specific output, as the tables say', () => {
    // POWER reads 0.7 hp + 0.3 lb-ft on straight lines between anchors.
    //   GT-R    0.7 x 600 + 0.3 x 481 = 564.3 (the 950 anchor) -> 0.7 x 720 + 144.3 = 648.3: 950 + 84 / 135.7 x 20 = 962.4
    //   Civic   0.7 x 158 + 0.3 x 138 = 152.0: 400 + 2 x 2 = 404       -> 0.7 x 189.6 + 41.4 = 174.12: 400 + 24.12 x 2 = 448.2
    //   Odyssey 0.7 x 280 + 0.3 x 262 = 274.6: 580 + 24.6 x 1.4 = 614.4 -> 0.7 x 336 + 78.6 = 313.8: 650 + 13.8 x 1.2 = 666.6
    expect(Math.round(interpolate(648.3, POWER.anchors))).toBe(962);
    const want: Record<string, Record<AttributeKey, number>> = {
      // 3.8 L: 157.9 hp/L becomes 189.5. Durability loses 0.5 a point per hp/L above 90 (15.8), reliability 0.6 above
      // 100 (19.0). At the top of the POWER table 20% more power earns 12 points and the stress costs 35.
      [GTR]: { power: 962, speed: 920, acceleration: 880, handling: 880, durability: 634, reliability: 681, efficiency: 500 },
      // 2.0 L: 79 hp/L becomes 94.8, past durability's pivot by 4.8 (2.4 points) and short of reliability's.
      [CIVIC]: { power: 448, speed: 506, acceleration: 370, handling: 565, durability: 633, reliability: 855, efficiency: 720 },
      // 3.5 L: 80 hp/L becomes 96, 6 past durability's pivot (3 points).
      [ODYSSEY]: { power: 667, speed: 460, acceleration: 464, handling: 347, durability: 718, reliability: 875, efficiency: 560 },
    };
    for (const id of [GTR, CIVIC, ODYSSEY]) {
      const stock = baseStats(card(id));
      const built = simulatedStats(card(id), STOCK[id], boosted(id));
      expect(scoresOf(built), id).toEqual(want[id]);
      // Speed, acceleration and handling stay where they were: the bench did not move them. The Civic's top speed
      // and the Odyssey's 0-60 are not on file, and their estimates are held to the bench as a figure would be.
      for (const k of ['speed', 'acceleration', 'handling', 'efficiency'] as const) expect(built.scores[k].value, `${id} ${k}`).toBe(stock.scores[k].value);
    }
  });

  it('moves the Power Rating and the class letter the way the rating and the class table say', () => {
    // The Power Rating is the plain mean of the seven, rounded; the class is the highest whose floor it reaches.
    //   GT-R    (962 + 920 + 880 + 880 + 634 + 681 + 500) / 7 = 779.6 -> 780, down from 783: still S (750 to 849)
    //   Civic   (448 + 506 + 370 + 565 + 633 + 855 + 720) / 7 = 585.3 -> 585, up from 579: still B (550 to 649)
    //   Odyssey (667 + 460 + 464 + 347 + 718 + 875 + 560) / 7 = 584.4 -> 584, up from 577: still B
    const want: Record<string, [number, number, string]> = { [GTR]: [783, 780, 'S'], [CIVIC]: [579, 585, 'B'], [ODYSSEY]: [577, 584, 'B'] };
    for (const id of [GTR, CIVIC, ODYSSEY]) {
      const before = baseStats(card(id)).powerRating, after = simulatedStats(card(id), STOCK[id], boosted(id)).powerRating;
      expect([before, after, raceClassOf(after)], id).toEqual(want[id]);
      const floor = RACE_CLASSES.filter((c) => c.id === want[id][2])[0].min;
      expect(after as number).toBeGreaterThanOrEqual(floor);
    }
  });

  it('moves the class letter when a build carries the rating over a floor', () => {
    // The Civic's bench run with a turbocharger kit's worth of change: 60% more power and 55% more torque, 0-60 in
    // 71% of the time, a top speed 12% higher and 6% more grip from the tyres that come with it.
    const spec = card(CIVIC), stock = STOCK[CIVIC];
    const built: BenchFigures = {
      ...stock, horsepower: stock.horsepower * 1.6, torqueLbFt: stock.torqueLbFt * 1.55, zeroToSixtySec: stock.zeroToSixtySec * 0.71,
      topSpeedMph: stock.topSpeedMph * 1.12, lateralGripG: stock.lateralGripG * 1.06,
    };
    const layer = simulatedStats(spec, stock, built);
    // 252.8 hp and 213.9 lb-ft: index 241.1, 500 + 41.1 x 1.6 -> POWER 566. 0-60 9.7 x 0.71 = 6.89 s -> 563.
    // Top speed (not on file): the estimate 120.7 mph x 1.12 = 135.2 -> 611. Grip (not on file): the modelled
    // 0.858 g x 1.06 = 0.910 g -> 656. 126.4 hp/L costs durability 18.2 points and reliability 15.8.
    expect(scoresOf(layer)).toEqual({ power: 566, speed: 611, acceleration: 563, handling: 656, durability: 617, reliability: 839, efficiency: 720 });
    // (566 + 611 + 563 + 656 + 617 + 839 + 720) / 7 = 653.1: past Class A's floor of 650, from 579 in Class B.
    expect(layer.powerRating).toBe(653);
    expect([raceClassOf(baseStats(spec).powerRating), raceClassOf(layer.powerRating)]).toEqual(['B', 'A']);
  });
});

describe('a figure not on file', () => {
  // Every one of the six moved at once: 20% more power, 15% more torque, 5% lighter, 8% quicker, 4% faster, 6% more grip.
  const everything = (b: BenchFigures): BenchFigures => ({
    horsepower: b.horsepower * 1.2, torqueLbFt: b.torqueLbFt * 1.15, curbWeightLb: b.curbWeightLb * 0.95,
    zeroToSixtySec: b.zeroToSixtySec * 0.92, topSpeedMph: b.topSpeedMph * 1.04, lateralGripG: b.lateralGripG * 1.06,
  });
  const anyBench: BenchFigures = { horsepower: 400, torqueLbFt: 380, curbWeightLb: 3600, zeroToSixtySec: 4.4, topSpeedMph: 160, lateralGripG: 0.95 };

  it('stays missing, on a card with no power figures (the Tesla) and one with no weight (the Corvette)', () => {
    const tesla = frozen(card('2024-tesla-model-3-long-range-awd'));
    const t = simulatedSpec(tesla, anyBench, everything(anyBench));
    expect([t.spec.horsepower, t.spec.torqueLbFt]).toEqual([null, null]);
    // 4,030 lb x 0.95 = 3,828.5, kept to the pound; 4.2 s x 0.92 = 3.864; 125 mph x 1.04; 0.92 g x 1.06 = 0.9752.
    expect([value(t.spec.curbWeightLb), value(t.spec.zeroToSixtySec), value(t.spec.topSpeedMph), value(t.spec.lateralGripG)]).toEqual([3829, 3.86, 130, 0.975]);
    expect(t.changed).toEqual(['curbWeightLb', 'zeroToSixtySec', 'topSpeedMph', 'lateralGripG']);
    // No horsepower on file, no POWER score, before or after: a missing figure is never invented.
    expect(simulatedStats(tesla, anyBench, everything(anyBench)).scores.power.value).toBeNull();

    const vette = frozen(card('2024-chevrolet-corvette-stingray-z51'));
    const v = simulatedSpec(vette, anyBench, everything(anyBench));
    expect([v.spec.curbWeightLb, v.spec.topSpeedMph, v.spec.lateralGripG]).toEqual([null, null, null]);
    expect([value(v.spec.horsepower), value(v.spec.torqueLbFt), value(v.spec.zeroToSixtySec)]).toEqual([594, 540.5, 2.67]);
    expect(v.changed).toEqual(['horsepower', 'torqueLbFt', 'zeroToSixtySec']);
    // No weight on file, so no SPEED, HANDLING or DURABILITY, before or after.
    const vs = simulatedStats(vette, anyBench, everything(anyBench));
    expect([vs.scores.speed.value, vs.scores.handling.value, vs.scores.durability.value]).toEqual([null, null, null]);
  });

  it('is scored from its estimate moved by the bench\'s ratio, as a figure on file would be', () => {
    // The Odyssey has no 0-60, top speed or skidpad figure: each is estimated. The build moves the bench 8% quicker,
    // 4% faster and 6% grippier, and so each estimate, while the estimate's own rule would have read the new power
    // and weight its own way.
    const spec = card(ODYSSEY), stock = STOCK[ODYSSEY], built = everything(stock);
    const out = simulatedSpec(spec, stock, built);
    const scores = scoreSpec(out.spec, { adjust: out.adjust, derived: out.changed });
    // The factory estimates: 8.3 s (16.2 lb per hp, front drive), 115 mph (a van's usual limiter) and 0.737 g (a
    // van's 0.77 g, less 0.0025 g for 126 lb over the class's 4,400 and 0.03 g for a suspension grade not on file).
    expect([estimateZeroToSixtySec(spec), estimateTopSpeedMph(spec), modelledGripG(spec)]).toEqual([8.3, 115, expect.closeTo(0.73748, 5)]);
    // 8.3 s x 0.92 = 7.636 s; 115 mph x 1.04 = 119.6 mph; 0.73748 g x 1.06 = 0.7817 g (and no control term: front
    // drive, standard brakes).
    expect([scores.acceleration.metric, scores.speed.metric, scores.handling.metric]).toEqual([7.64, 119.6, 0.782]);
    // Still estimates, and worked out: no better than an owner's own figure.
    expect([scores.acceleration.basis, scores.speed.basis, scores.handling.basis]).toEqual(['estimated', 'estimated', 'modelled']);
    expect([scores.acceleration.quality, scores.speed.quality]).toEqual(['owner', 'owner']);
  });

  it('is held where the bench holds it: more power does not raise an estimated top speed the limiter keeps', () => {
    // The Civic's top speed is not on file. Its estimate reads horsepower: with 20% more it would rise from 120.7 to
    // 128.8 mph and SPEED from 506 to 567. The bench, at the limiter, says the top speed did not move, nor does SPEED.
    const spec = card(CIVIC), stock = STOCK[CIVIC], built = { ...stock, horsepower: stock.horsepower * 1.2 };
    const out = simulatedSpec(spec, stock, built);
    expect(estimateTopSpeedMph(out.spec) as number).toBeGreaterThan(estimateTopSpeedMph(spec) as number);
    expect(scoreSpec(out.spec, { derived: out.changed }).speed.value).toBe(567);
    expect(scoreSpec(out.spec, { adjust: out.adjust, derived: out.changed }).speed.value).toBe(baseStats(spec).scores.speed.value);
  });
});

describe('the list of fields changed', () => {
  const spec = card(GTR), stock = STOCK[GTR];
  const scaled = (field: SimulatedField, by: number): BenchFigures => ({ ...stock, [field]: stock[field] * by });

  it('names exactly the field that moved, one at a time, and every one when all six move', () => {
    for (const field of SIMULATED_FIELDS) {
      const out = simulatedSpec(spec, stock, scaled(field, 1.05));
      expect(out.changed, field).toEqual([field]);
      for (const other of SIMULATED_FIELDS) if (other !== field) expect(out.spec[other], `${field} left ${other}`).toBe(spec[other]);
    }
    const all: BenchFigures = { horsepower: 660, torqueLbFt: 520, curbWeightLb: 3700, zeroToSixtySec: 2.6, topSpeedMph: 199, lateralGripG: 1.1 };
    const out = simulatedSpec(spec, stock, all);
    expect(out.changed).toEqual(['horsepower', 'torqueLbFt', 'curbWeightLb', 'zeroToSixtySec', 'topSpeedMph', 'lateralGripG']);
    // Published 600 hp, 481 lb-ft, 3,867 lb, 2.9 s, 196 mph, 1.02 g times built / stock.
    expect(SIMULATED_FIELDS.map((f) => value(out.spec[f]))).toEqual([660, 520, 3700, 2.71, 201.5, 1.079]);
    for (const f of SIMULATED_FIELDS) {
      const was = spec[f] as Sourced<number>, now = out.spec[f] as Sourced<number>;
      expect(now.source, f).toEqual({ ...was.source, kind: 'owner', note: SIMULATED_NOTE });
    }
  });

  it('leaves out a change the card cannot show: a governed top speed 0.03 mph higher, a skidpad 0.0002 g', () => {
    // The bench holds a car at its limiter, and laps a skidpad, to a few hundredths either side whatever the engine
    // makes; a tune moves those figures by that much and no more.
    const out = simulatedSpec(spec, stock, { ...stock, horsepower: 660, topSpeedMph: stock.topSpeedMph + 0.03, lateralGripG: stock.lateralGripG + 0.0002 });
    expect(out.changed).toEqual(['horsepower']);
    expect(out.spec.topSpeedMph).toBe(spec.topSpeedMph);
    expect(out.spec.lateralGripG).toBe(spec.lateralGripG);
  });

  it('leaves a figure as published when the bench did not measure it', () => {
    const out = simulatedSpec(spec, { ...stock, topSpeedMph: NaN }, { ...stock, horsepower: 660, topSpeedMph: 205, lateralGripG: NaN });
    expect(out.changed).toEqual(['horsepower']);
  });

  it('keeps an illustrative figure illustrative', () => {
    const spec2: VehicleSpec = { ...spec, horsepower: { value: 300, source: { kind: 'illustrative', name: 'placeholder' } } };
    const out = simulatedSpec(spec2, stock, scaled('horsepower', 1.1));
    expect(out.spec.horsepower).toEqual({ value: 330, source: { kind: 'illustrative', name: 'placeholder', note: SIMULATED_NOTE } });
  });
});

describe('the modification table still charges what parts cost', () => {
  it('takes the fitted parts\' reliability and durability points, and none of their figures', () => {
    // An ECU tune at the Pro tier, fitted by the owner and recently: the table charges 25 reliability and 5
    // durability points. Its own +9% horsepower is not applied: the bench measured 20%.
    const spec = card(CIVIC), stock = STOCK[CIVIC], built = { ...stock, horsepower: stock.horsepower * 1.2 };
    const ecu: ActiveModification = { eventId: 'e1', category: 'ecu', tier: 2, install: 'owner', evidence: 'declared', installedOn: '2026-11-01', installedAtMileage: null, upkeep: 'recent' };
    expect([MODS.ecu.tiers[1].reliability, MODS.ecu.tiers[1].durability]).toEqual([-25, -5]);
    const plain = simulatedStats(spec, stock, built), charged = simulatedStats(spec, stock, built, [ecu]);
    expect(charged.scores.reliability.value).toBe((plain.scores.reliability.value as number) - 25);
    expect(charged.scores.durability.value).toBe((plain.scores.durability.value as number) - 5);
    expect(charged.scores.power.value).toBe(plain.scores.power.value);
    // (448 + 506 + 370 + 565 + 628 + 830 + 720) / 7 = 581.0
    expect(charged.powerRating).toBe(581);
    expect(raceClassOf(charged.powerRating)).toBe('B');
  });
});

describe('ranked play', () => {
  it('reads none of it: no module but the index imports the simulated card', () => {
    const sources = import.meta.glob(['./*.ts', '!./*.test.ts', '!./simulated.ts', '!./index.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    for (const file of Object.keys(sources)) expect(sources[file], file).not.toMatch(/from\s+['"]\.\/simulated['"]/);
  });
});
