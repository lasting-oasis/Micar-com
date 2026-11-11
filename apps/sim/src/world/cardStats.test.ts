import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_KEYS, baseStats } from '@micar/engine';
import { STAND_IN_SOURCE, TABLE_SOURCE, cardStatsFor, engineSpecFor } from './cardStats';

const KNOWN = [
  { year: 2019, make: 'Toyota', model: 'Camry', bodyStyle: 'sedan' },
  { year: 2018, make: 'Toyota', model: 'Corolla', bodyStyle: 'sedan' },
  { year: 2020, make: 'Chevrolet', model: 'Corvette', bodyStyle: 'sports' },
  { year: 2021, make: 'Ford', model: 'F-150', bodyStyle: 'truck' },
  { year: 2022, make: 'BMW', model: 'M4', bodyStyle: 'coupe' },
  { year: 2017, make: 'Honda', model: 'Civic', bodyStyle: 'sedan' },
  { year: 2016, make: 'Toyota', model: 'Prius', bodyStyle: 'hatchback' },
];

describe('a world car on a MiCar card', () => {
  it('rates five attributes from the car table and leaves the two it has no figures for unrated', () => {
    for (const car of KNOWN) {
      const layer = cardStatsFor(car);
      for (const k of ['power', 'speed', 'acceleration', 'handling', 'durability'] as const) expect(layer.scores[k].value, `${car.model} ${k}`).not.toBeNull();
      expect(layer.scores.efficiency.value, car.model).toBeNull();
      expect(layer.scores.reliability.value, car.model).toBeNull();
      expect(layer.rated).toBe(5);
      expect(layer.powerRating).toBeNull();
      expect(layer.provisionalRating).not.toBeNull();
    }
  });

  it('marks what was read, what was estimated and what was modelled', () => {
    const scores = cardStatsFor(KNOWN[0]).scores;
    expect(scores.speed.basis).toBe('measured');
    expect(scores.acceleration.basis).toBe('measured');
    expect(scores.power.basis).toBe('estimated'); // the table has no torque
    expect(scores.handling.basis).toBe('modelled');
    expect(scores.durability.basis).toBe('modelled');
    expect(scores.efficiency.basis).toBe('unavailable');
    expect(scores.efficiency.missing).toContain('combinedMpg');
  });

  it('keeps the table’s figures as reference data, never verified', () => {
    const spec = engineSpecFor(KNOWN[0]);
    expect(spec.horsepower).toEqual({ value: 203, source: TABLE_SOURCE });
    expect(spec.curbWeightLb?.value).toBe(3340);
    expect(spec.displacementL?.value).toBe(2.5);
    expect(spec.cylinders?.value).toBe(4);
    expect(spec.drivetrain?.value).toBe('FWD');
    expect(spec.identity.bodyClass).toBe('sedan');
    expect(cardStatsFor(KNOWN[0]).scores.speed.quality).toBe('reference');
    // Nothing the table does not hold was filled in.
    expect(spec.torqueLbFt).toBeNull();
    expect(spec.combinedMpg).toBeNull();
    expect(spec.induction).toBeNull();
    expect(spec.transmissionType).toBeNull();
  });

  it('reads Chevrolet as the table’s Chevy and a truck as a pickup', () => {
    expect(engineSpecFor(KNOWN[2]).horsepower?.value).toBe(490);
    expect(engineSpecFor(KNOWN[3]).identity.bodyClass).toBe('pickup');
  });

  it('marks a car with no row of its own as illustrative', () => {
    const spec = engineSpecFor({ make: 'Zork', model: 'Blat', bodyStyle: 'van' });
    expect(spec.horsepower?.source).toEqual(STAND_IN_SOURCE);
    expect(cardStatsFor({ make: 'Zork', model: 'Blat', bodyStyle: 'van' }).scores.power.quality).toBe('illustrative');
    expect(() => cardStatsFor({})).not.toThrow();
  });

  it('puts a sports car ahead of an economy car where it should be, and is the engine’s own answer', () => {
    const vette = cardStatsFor(KNOWN[2]), corolla = cardStatsFor(KNOWN[1]);
    for (const k of ['power', 'speed', 'acceleration', 'handling'] as const) expect(vette.scores[k].value as number).toBeGreaterThan(corolla.scores[k].value as number);
    expect(cardStatsFor(KNOWN[4])).toEqual(baseStats(engineSpecFor(KNOWN[4])));
    for (const k of ATTRIBUTE_KEYS) { const v = vette.scores[k].value; if (v !== null) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1000); } }
  });
});
