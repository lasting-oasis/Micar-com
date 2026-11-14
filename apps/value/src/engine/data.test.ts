import { describe, expect, it } from 'vitest';
import { ACCIDENTS, BRANDED_NOTES, TITLES, optionLabel } from './data';

describe('title and accident options', () => {
  it('keeps the values and multipliers that links, saved records and prices use', () => {
    // the owner's dealer rule of thumb (2026-11-14): rebuilt 30-35% under clean (the middle, 32.5%), salvage 40% under
    expect(TITLES.map((o) => [o.name, o.mult])).toEqual([['Clean', 1], ['Rebuilt', 0.675], ['Salvage', 0.6]]);
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
  it('every title that is not clean has a warning, and a clean one has none', () => {
    expect(Object.keys(BRANDED_NOTES)).toEqual(TITLES.filter((o) => o.mult !== 1).map((o) => o.name));
    for (const note of Object.values(BRANDED_NOTES)) expect(note).toMatch(/has checked no record/);
  });
  it('each warning states the cut its title is priced at', () => {
    for (const o of TITLES.filter((t) => t.mult !== 1)) {
      const m = BRANDED_NOTES[o.name].match(/about (\d+)(?:–(\d+))?% less/);
      expect(m, o.name).not.toBeNull();
      const lo = Number(m![1]) / 100, hi = Number(m![2] ?? m![1]) / 100, cut = 1 - o.mult;
      expect(cut, o.name).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(cut, o.name).toBeLessThanOrEqual(hi + 1e-9);
    }
  });
});
