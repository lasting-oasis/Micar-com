// The card back in the Garage: the foil table against the engine's own list of rarities.
import { describe, expect, it } from 'vitest';
import { RARITY_TIERS } from '@micar/engine';
import { FOIL_IDS, foilForRarity } from '@micar/holo';

describe('card backs and the engine', () => {
  it('gives every rarity the engine knows a foil', () => {
    for (const tier of RARITY_TIERS) expect(FOIL_IDS).toContain(foilForRarity(tier));
  });

  it('gives the engine\'s tiers, in the engine\'s order, the foils of the brief', () => {
    expect([...RARITY_TIERS]).toEqual(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'one-of-one']);
    expect(RARITY_TIERS.map((tier) => foilForRarity(tier))).toEqual(['gloss', 'gloss', 'holo', 'rainbow', 'prismatic', 'prismatic', 'prismatic']);
  });
});
