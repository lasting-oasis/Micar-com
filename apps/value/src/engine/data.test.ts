import { describe, expect, it } from 'vitest';
import { ACCIDENTS, TITLES, optionLabel } from './data';

describe('title and accident options', () => {
  it('keeps the values and multipliers that links, saved records and prices use', () => {
    expect(TITLES.map((o) => [o.name, o.mult])).toEqual([['Clean', 1], ['Rebuilt', 0.75], ['Salvage', 0.55]]);
    expect(ACCIDENTS.map((o) => [o.name, o.mult])).toEqual([['None', 1], ['Minor', 0.94], ['Major', 0.82]]);
  });
  it('shows an accident as reported, and any other option by its name', () => {
    expect(ACCIDENTS.map((o) => optionLabel(ACCIDENTS, o.name))).toEqual(['None reported', 'Minor reported', 'Major reported']);
    expect(optionLabel(TITLES, 'Rebuilt')).toBe('Rebuilt');
    expect(optionLabel(ACCIDENTS, 'Unknown')).toBe('Unknown');
  });
  it('no title description claims a check MiCar did not make', () => {
    for (const o of TITLES) expect(o.desc).not.toMatch(/re-certified|no total-loss history/i);
    expect(TITLES[0].desc).toMatch(/checked no record/);
  });
});
