import { describe, expect, it } from 'vitest';
import { FOILS, FOIL_IDS, FOIL_LABELS, foilForRarity } from './foils';
import type { FoilParams } from './foils';

const KEYS: (keyof FoilParams)[] = ['kind', 'K', 'S', 'K2', 'S2', 'sat', 'm0', 'm1', 'cover', 'strength', 'add', 'mul', 'metal', 'sparkle', 'cell', 'refr', 'amp', 'lobe', 'edge'];

describe('foil by rarity', () => {
  it('maps the tiers the brief names', () => {
    expect(foilForRarity('rare')).toBe('holo');
    expect(foilForRarity('epic')).toBe('rainbow');
    for (const tier of ['legendary', 'mythic', 'one-of-one']) expect(foilForRarity(tier)).toBe('prismatic');
    for (const tier of ['common', 'uncommon']) expect(foilForRarity(tier)).toBe('gloss');
  });

  it('shows gloss, never foil, for a tier it does not know', () => {
    for (const tier of ['', 'Rare', 'EPIC', 'ultra', 'one of one', 'prismatic', ' rare']) expect(foilForRarity(tier)).toBe('gloss');
  });

  it('is not fooled by the names every object carries', () => {
    for (const tier of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) expect(foilForRarity(tier)).toBe('gloss');
  });
});

describe('the foil table', () => {
  it('gives every foil every number, all finite', () => {
    for (const id of FOIL_IDS) {
      expect(Object.keys(FOILS[id]).sort()).toEqual([...KEYS].sort());
      for (const key of KEYS) expect(Number.isFinite(FOILS[id][key]), `${id}.${key}`).toBe(true);
    }
  });

  it('numbers the foils in the order the shader branches on', () => {
    expect(FOIL_IDS.map((id) => FOILS[id].kind)).toEqual([0, 1, 2, 3]);
  });

  it('keeps gloss free of foil', () => {
    expect(FOILS.gloss.strength).toBe(0);
    expect(FOILS.gloss.sparkle).toBe(0);
    expect(FOILS.gloss.metal).toBe(0);
  });

  it('gives every real foil a mask that can open and something to show through it', () => {
    for (const id of ['holo', 'rainbow', 'prismatic'] as const) {
      const f = FOILS[id];
      expect(f.m0, id).toBeLessThan(f.m1);
      expect(f.cover, id).toBeGreaterThanOrEqual(0);
      expect(f.cover, id).toBeLessThan(1);
      expect(f.strength, id).toBeGreaterThan(0);
      expect(f.sat, id).toBeGreaterThan(0);
      expect(f.sat, id).toBeLessThanOrEqual(1);
    }
  });

  it('gives the prismatic foil facets of a real size', () => {
    expect(FOILS.prismatic.cell).toBeGreaterThan(1);
    expect(FOILS.prismatic.lobe).toBeGreaterThan(0);
  });

  it('names every foil', () => {
    for (const id of FOIL_IDS) expect(FOIL_LABELS[id]).toMatch(/\S/);
    expect(new Set(Object.values(FOIL_LABELS)).size).toBe(FOIL_IDS.length);
  });
});
