import { describe, expect, it } from 'vitest';
// The card engine, by path: this package depends on nothing, and only this test reaches across, to show the two
// halves of DESIGN.md 12 meeting on plain numbers.
import { raceClassOf } from '../../engine/src/game';
import { baseStats, estimateZeroToSixtySec, scoreSpec } from '../../engine/src/normalize';
import { simulatedSpec, simulatedStats } from '../../engine/src/simulated';
import type { ActiveModification, Source, Sourced, VehicleSpec } from '../../engine/src/types';
import { runBench } from './bench';
import { DRIVER_MASS } from './classes';
import { proofSheet } from './golden';
import { buildCardMods } from './parts';
import { benchFigures } from './rating';
import { resolveModel } from './resolve';
import type { Build } from './types';
import { LB } from './units';

const build = (ids: string[]): Build => ({ parts: ids.map((id) => ({ id })), setup: {} });

describe('benchFigures', () => {
  const sedan = resolveModel(proofSheet('sedan')).model;
  const bench = runBench(sedan);
  const card = benchFigures(bench, sedan);

  it('reads the proof sedan in the card\'s units: the dyno\'s 200 hp and 184 lb-ft, and its 3,300 lb without the driver', () => {
    expect(card.horsepower).toBeCloseTo(200, 6);
    expect(card.torqueLbFt).toBeCloseTo(184, 6);
    // The model carries the 75 kg driver the bench drives it with (3,465 lb as driven); a card's curb weight does not.
    expect(sedan.chassis.mass / LB).toBeCloseTo(3300 + DRIVER_MASS / LB, 6);
    expect(card.curbWeightLb).toBeCloseTo(3300, 6);
  });

  it('times the 0-60 as the magazines do, from the first foot of travel, and takes the 60-0 and the 300 ft skidpad', () => {
    // The rollout leaves out the first foot. A family sedan pulls away at 0.3 to 0.6 g, so that foot takes
    // sqrt(2 x 0.3048 m / a): 0.32 to 0.46 s.
    expect(card.zeroToSixtySec).toBe(bench.zeroToSixtyRollout);
    expect(bench.zeroToSixty - card.zeroToSixtySec).toBeGreaterThan(Math.sqrt(2 * 0.3048 / (0.6 * 9.80665)));
    expect(bench.zeroToSixty - card.zeroToSixtySec).toBeLessThan(Math.sqrt(2 * 0.3048 / (0.3 * 9.80665)));
    // From 60 mph the car stops in less road than from 70: the card's figure is the 60-0.
    expect(card.braking60to0Ft).toBe(bench.braking60);
    expect(card.braking60to0Ft).toBeLessThan(bench.braking70 * 0.8);
    expect(card.lateralGripG).toBe(bench.skidpad300);
    expect([card.topSpeedMph, card.quarterMileSec, card.quarterMileMph]).toEqual([bench.topSpeed, bench.timeslip.quarter, bench.timeslip.trapMph]);
    for (const k of Object.keys(card) as (keyof typeof card)[]) expect(Number.isFinite(card[k]), k).toBe(true);
  });

  it('gives a nitrous kit\'s 100 hp shot as horsepower and its bottle as weight', () => {
    const kitted = resolveModel(proofSheet('sedan'), build(['nitrous-2'])).model;
    const dyno = runBench(kitted, 'dyno');
    // The dyno reads the engine alone, as stock; the card reads it with the kit armed, and 16 kg heavier.
    expect(dyno.peakHp).toBeCloseTo(bench.peakHp, 9);
    const fig = benchFigures(dyno, kitted);
    expect(fig.horsepower - card.horsepower).toBeCloseTo(100, 9);
    expect(fig.torqueLbFt).toBeCloseTo(card.torqueLbFt, 9);
    expect(fig.curbWeightLb - card.curbWeightLb).toBeCloseTo(16 / LB, 6);
    // A test the bench did not run is NaN, as in the bench's own result: the card engine leaves such a figure as published.
    expect([fig.zeroToSixtySec, fig.topSpeedMph, fig.lateralGripG]).toEqual([NaN, NaN, NaN]);
  });
});

describe('a tune on the bench, and on a card shaped like the car', () => {
  // The proof pickup: a 5,700 lb four-wheel-drive pickup with a 3.5 L twin-turbo V6 of 450 hp and 510 lb-ft. tune-1
  // asks its turbos for 0.22 atm more at full boost.
  const sheet = proofSheet('pickup');
  const stockModel = resolveModel(sheet).model, tunedModel = resolveModel(sheet, build(['tune-1'])).model;
  const stock = benchFigures(runBench(stockModel), stockModel), tuned = benchFigures(runBench(tunedModel), tunedModel);

  // The card a maker's sheet for that truck would make, figure for figure, and the EPA's 16 mpg combined that the
  // catalogue holds for the 2024 F-150 Raptor, the real truck it is shaped like. Like most cards in the catalogue it
  // has no 0-60, top speed or skidpad figure: the card engine estimates them.
  const ill: Source = { kind: 'illustrative', name: 'the proof pickup\'s sheet (src/golden.ts)' };
  const s = <T>(value: T): Sourced<T> => ({ value, source: ill });
  const card: VehicleSpec = {
    identity: { year: 2022, make: 'Illustrative', model: 'Desert pickup', trim: '3.5T', bodyClass: 'pickup' },
    engine: s('3.5 L twin-turbo V6'), powertrain: s('gasoline'), induction: s('twin-turbo'), displacementL: s(3.5), cylinders: s(6),
    horsepower: s(450), torqueLbFt: s(510), transmission: s('automatic'), transmissionType: s('automatic'), drivetrain: s('4WD'),
    curbWeightLb: s(5700), zeroToSixtySec: null, topSpeedMph: null, topSpeedGoverned: null, combinedMpg: s(16), cityMpg: null,
    highwayMpg: null, evRangeMiles: null, lateralGripG: null, braking60to0Ft: null, braking70to0Ft: null, groundClearanceIn: null,
    construction: null, suspension: null, suspensionGrade: null, brakes: null, brakeGrade: null, warrantyPowertrainMiles: null,
    warrantyPowertrainYears: null, productionUnits: null,
  };

  it('makes about 11% more power on the bench, quickens the launch, and leaves the weight and the governed top speed', () => {
    // Boost from a pressure ratio of about 1.99 to 2.21 makes the charge 11% denser. Indicated work follows the
    // charge, friction does not, and the hotter charge gives a little back: the peak rises 8 to 14%.
    const gain = tuned.horsepower / stock.horsepower;
    expect(gain).toBeGreaterThan(1.08);
    expect(gain).toBeLessThan(1.14);
    expect(tuned.torqueLbFt / stock.torqueLbFt).toBeGreaterThan(1.06);
    expect(tuned.curbWeightLb).toBe(stock.curbWeightLb);
    // A heavy four-wheel-drive truck on all-terrain tyres turns most of it into launch: 0-60 4 to 10% quicker.
    expect(tuned.zeroToSixtySec / stock.zeroToSixtySec).toBeLessThan(0.96);
    expect(tuned.zeroToSixtySec / stock.zeroToSixtySec).toBeGreaterThan(0.9);
    // The limiter holds the top speed within a few hundredths of a mile an hour either way.
    expect(Math.abs(tuned.topSpeedMph - stock.topSpeedMph)).toBeLessThan(0.1);
  });

  it('moves the card\'s horsepower and torque by the bench\'s ratio and nothing else the card shows', () => {
    const out = simulatedSpec(card, stock, tuned);
    const hp = out.spec.horsepower as Sourced<number>, tq = out.spec.torqueLbFt as Sourced<number>;
    expect(hp.value).toBeCloseTo(450 * tuned.horsepower / stock.horsepower, 1);
    expect(tq.value).toBeCloseTo(510 * tuned.torqueLbFt / stock.torqueLbFt, 1);
    expect([hp.source.note, tq.source.note]).toEqual(['simulated on the bench', 'simulated on the bench']);
    // The weight did not move, the top speed moved by less than a card can show, and the timed figures are not on file.
    expect(out.changed).toEqual(['horsepower', 'torqueLbFt']);
    expect([out.spec.zeroToSixtySec, out.spec.topSpeedMph, out.spec.lateralGripG]).toEqual([null, null, null]);
    // The 0-60 the card engine estimates for the truck moves by the bench's own ratio, not by its pounds per horsepower.
    const scores = scoreSpec(out.spec, { adjust: out.adjust, derived: out.changed });
    expect(scores.acceleration.metric as number).toBeCloseTo((estimateZeroToSixtySec(card) as number) * tuned.zeroToSixtySec / stock.zeroToSixtySec, 2);
  });

  it('shows the class letter that results: Class B before and after, with the rating a little higher', () => {
    const before = baseStats(card), after = simulatedStats(card, stock, tuned);
    expect(after.scores.power.value as number).toBeGreaterThan(before.scores.power.value as number);
    expect(after.scores.acceleration.value as number).toBeGreaterThan(before.scores.acceleration.value as number);
    // More power from the same 3.5 L is more stress: the modelled durability and reliability give a little back.
    expect(after.scores.reliability.value as number).toBeLessThan(before.scores.reliability.value as number);
    expect(after.powerRating as number).toBeGreaterThan(before.powerRating as number);
    expect((after.powerRating as number) - (before.powerRating as number)).toBeLessThan(20);
    expect([raceClassOf(before.powerRating), raceClassOf(after.powerRating)]).toEqual(['B', 'B']);

    // The same, with the tune's place in the modification table charged: an ECU tune at the Street tier costs 10
    // reliability points, 7.5 fitted by a professional (rounded with the rest of the score), and the letter is still B.
    const mods: ActiveModification[] = buildCardMods(sheet, build(['tune-1'])).map((c, i) => ({
      eventId: `part-${i}`, category: c.category, tier: c.tier, install: 'professional', evidence: 'declared', installedOn: '2026-11-24',
      installedAtMileage: null, upkeep: 'recent',
    }));
    expect(mods.map((m) => `${m.category}:${m.tier}`)).toEqual(['ecu:1']);
    const charged = simulatedStats(card, stock, tuned, mods);
    const lost = (after.scores.reliability.value as number) - (charged.scores.reliability.value as number);
    expect(lost === 7 || lost === 8, `${lost} points`).toBe(true);
    expect(charged.scores.power.value).toBe(after.scores.power.value);
    expect(raceClassOf(charged.powerRating)).toBe('B');
  });
});
