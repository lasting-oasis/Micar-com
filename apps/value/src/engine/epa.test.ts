import { describe, expect, it } from 'vitest';
import { findModel, modelsForMake, yearRanges } from './models';

describe('EPA model list', () => {
  it('knows which years a listed model was sold', () => {
    expect(findModel('Nissan', 'Altima')?.years).toContain(2013);
    expect(findModel('Lexus', 'IS')?.years).toContain(2013);
    expect(findModel('Toyota', 'Corolla Cross')?.years?.[0]).toBe(2022);
  });

  it('adds models the hand-set list lacks, without duplicating listed ones', () => {
    const nissan = modelsForMake('Nissan');
    expect(nissan.find((m) => m.model === '370Z')?.source).toBe('epa');
    const names = nissan.map((m) => m.model);
    expect(new Set(names).size).toBe(names.length);
    expect(modelsForMake('Pontiac').length).toBeGreaterThan(5);
  });

  it('formats year ranges', () => {
    expect(yearRanges([2005, 2006, 2007, 2010, 2012, 2013])).toBe('2005–2007, 2010, 2012–2013');
  });
});
