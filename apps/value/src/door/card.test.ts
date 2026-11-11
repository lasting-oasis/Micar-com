import { describe, expect, it } from 'vitest';
import { GRADE_CATEGORIES, GRADE_FORMULA, GRADE_WEIGHTS } from '@micar/engine';
import type { GradeCategoryKey } from '@micar/engine';
import { emptyRecord, type CarRecord } from '../car/record';
import { RAISE_BY_VERIFIER, RAISE_IN_GARAGE, makeCard, sampleCard, startingGrade, type Card } from './card';

const NOW = new Date(2026, 10, 11, 12, 0, 0);
const DAY = '2026-11-11';
const sample = (): Card => sampleCard(NOW) as Card;
const scores = (card: Card, g = card.g): Record<GradeCategoryKey | 'overall' | 'G', number> => {
  const grade = startingGrade(card.r, g, DAY);
  if (!grade) throw new Error('no grade');
  const c = grade.report.categories;
  return { identity: c.identity.score, documentation: c.documentation.score, condition: c.condition.score, originality: c.originality.score, verification: c.verification.score, overall: grade.report.overall, G: grade.G };
};

describe('the starting grade on the home page', () => {
  it('is the engine’s own five-category grade of what the page was told', () => {
    // A 2021 Tacoma, Excellent, 41,200 miles. The name is on record (10 of Identity's 100); one odometer reading and
    // one owner (9 of Documentation's); a self-reported condition stops at 60; originality was not stated (50);
    // nothing has been verified.
    const card = sample();
    expect(scores(card)).toEqual({ identity: 10, documentation: 9, condition: 60, originality: 50, verification: 0, overall: 26.8, G: 2.7 });
    expect(card.grade.report.formula).toBe(GRADE_FORMULA);
    expect(card.grade.G).toBe(2.7);
    // The number is the weighted sum the engine documents, a tenth of it on the label.
    let sum = 0;
    for (const k of GRADE_CATEGORIES) sum += card.grade.report.categories[k].score * GRADE_WEIGHTS[k];
    expect(card.grade.report.overall).toBe(Math.round(sum * 10) / 10);
  });

  it('marks every category the page cannot know, and never says records raise Verification', () => {
    expect(sample().grade.notes).toEqual({
      identity: RAISE_IN_GARAGE, documentation: RAISE_IN_GARAGE, condition: '', originality: RAISE_IN_GARAGE, verification: RAISE_BY_VERIFIER,
    });
    expect(RAISE_IN_GARAGE).toBe('add records in the Garage to raise this');
  });

  it('follows the condition and the accident history it is told', () => {
    const card = sample();
    const condition = (cond: string, accident: string) => scores(card, { ...card.g, cond, accident }).condition;
    expect([condition('Excellent', 'None'), condition('Good', 'None'), condition('Fair', 'None'), condition('Poor', 'None')]).toEqual([60, 60, 50, 25]);
    expect([condition('Excellent', 'Minor'), condition('Excellent', 'Major'), condition('Good', 'Minor'), condition('Poor', 'Major')]).toEqual([60, 60, 55, 0]);
    // Nothing else moves with them.
    expect(scores(card, { ...card.g, cond: 'Poor', accident: 'Major' })).toMatchObject({ identity: 10, documentation: 9, originality: 50, verification: 0 });
  });

  it('reads no price, no value curve and no model: two cars told the same start the same', () => {
    const mk = (r: Partial<CarRecord>) => makeCard({ ...emptyRecord(NOW), ...r, price: 0, features: [], notes: '' } as CarRecord, NOW) as Card;
    const truck = mk({ year: 2021, make: 'Toyota', model: 'Tacoma', trim: 'TRD Off-Road', body: 'Pickup Truck', mileage: 41200, condition: 'Good' });
    const sedan = mk({ year: 2020, make: 'Honda', model: 'Civic', trim: 'Si', body: 'Sedan', mileage: 91200, condition: 'Good' });
    expect(truck.value).not.toBe(sedan.value);
    expect(scores(truck)).toEqual(scores(sedan));
  });
});
