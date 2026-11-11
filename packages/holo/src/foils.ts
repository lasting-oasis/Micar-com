// The four foils a card back can carry, and which one each rarity earns.
//
// The numbers live in foils.json, one file that two things read: the browser's shader (as uniforms) and the Blender
// build (tools/blender/build_card.py, for its preview materials). Change a number there and both follow.
import table from './foils.json';

export const FOIL_IDS = ['gloss', 'holo', 'rainbow', 'prismatic'] as const;
export type FoilId = (typeof FOIL_IDS)[number];

/**
 * One foil's recipe. Every foil carries every number so the shader always has a full set; a foil that does not use
 * one holds a value that does nothing (and never a zero where the shader divides).
 */
export type FoilParams = {
  /** Which branch of the shader: 0 gloss, 1 holo, 2 rainbow, 3 prismatic. */
  kind: number;
  /** How fast the spectrum sweeps as the card turns, and how many bands lie across the card. */
  K: number; S: number;
  /** The same two for the second, crossing set of bands (rainbow only). */
  K2: number; S2: number;
  /** Saturation of the spectral colour, 0..1. */
  sat: number;
  /** The mask opens between these two brightnesses of the artwork; `cover` is how much foil shows on dark art. */
  m0: number; m1: number; cover: number;
  /** How bright the foil is; the share that shows on any ink (`add`) and the share tinted by the ink (`mul`). */
  strength: number; add: number; mul: number;
  /** How much the bright art reflects the studio like metal. */
  metal: number;
  /** How bright the flakes are. */
  sparkle: number;
  /** Prismatic: facet size in millimetres, how far the art is displaced, how far a facet tilts, how wide its flash is, how thick its edge is drawn. */
  cell: number; refr: number; amp: number; lobe: number; edge: number;
};

export const FOILS: Record<FoilId, FoilParams> = table;

/** In plain English. Each app looks these up in its own dictionary. */
export const FOIL_LABELS: Record<FoilId, string> = {
  gloss: 'Gloss', holo: 'Standard holo', rainbow: 'Full-spectrum rainbow', prismatic: 'Refractive prismatic',
};

/**
 * The foil a rarity tier earns. The tiers are the engine's own words (`card.rarity.tier`), lower case. Anything
 * else is gloss: a tier this table has never heard of must not show foil by accident.
 */
export function foilForRarity(tier: string): FoilId {
  switch (tier) {
    case 'rare': return 'holo';
    case 'epic': return 'rainbow';
    case 'legendary':
    case 'mythic':
    case 'one-of-one': return 'prismatic';
    default: return 'gloss';
  }
}
