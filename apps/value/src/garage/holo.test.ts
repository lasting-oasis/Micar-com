// The card back in the Garage: the foil table against the engine's own list of rarities, the route word, and
// where the page looks for the card's files.
import { describe, expect, it } from 'vitest';
import { RARITY_TIERS, normalizeMicarId } from '@micar/engine';
import { FOIL_IDS, foilForRarity } from '@micar/holo';
import { routeFromHash } from '../route';
import { CARD_ART, CARD_BACKS, CARD_MODEL, stillOf, tiersOf } from './back';

describe('card backs and the engine', () => {
  it('gives every rarity the engine knows a foil', () => {
    for (const tier of RARITY_TIERS) expect(FOIL_IDS).toContain(foilForRarity(tier));
  });

  it('gives the engine\'s tiers, in the engine\'s order, the foils of the brief', () => {
    expect([...RARITY_TIERS]).toEqual(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'one-of-one']);
    expect(RARITY_TIERS.map((tier) => foilForRarity(tier))).toEqual(['gloss', 'gloss', 'holo', 'rainbow', 'prismatic', 'prismatic', 'prismatic']);
  });

  it('gives each foil at least one tier and every tier exactly one foil', () => {
    expect(tiersOf('gloss')).toEqual(['common', 'uncommon']);
    expect(tiersOf('holo')).toEqual(['rare']);
    expect(tiersOf('rainbow')).toEqual(['epic']);
    expect(tiersOf('prismatic')).toEqual(['legendary', 'mythic', 'one-of-one']);
    expect(FOIL_IDS.flatMap((foil) => tiersOf(foil)).sort()).toEqual([...RARITY_TIERS].sort());
  });
});

describe('the four-backs page', () => {
  it('keeps its route word clear of a MiCar ID', () => {
    expect(CARD_BACKS).toBe('card-backs');
    expect(normalizeMicarId(CARD_BACKS)).toBeNull();
  });

  it('is reached at #/garage/card-backs', () => {
    expect(routeFromHash(`#/garage/${CARD_BACKS}`, '')).toEqual({ view: 'garage', code: CARD_BACKS });
  });
});

describe('the card\'s files', () => {
  it('are looked for under the site\'s own path', () => {
    const base = import.meta.env.BASE_URL;
    expect(CARD_MODEL).toBe(`${base}cards/card.glb`);
    expect(stillOf('prismatic')).toBe(`${base}cards/back-prismatic.webp`);
    for (const foil of FOIL_IDS) expect(stillOf(foil)).toMatch(new RegExp(`cards/back-${foil}\\.webp$`));
  });

  it('offer the artwork with full colour first, and the one every browser reads second', () => {
    const base = import.meta.env.BASE_URL;
    expect(CARD_ART).toEqual([`${base}cards/back.avif`, `${base}cards/back.webp`]);
  });
});
