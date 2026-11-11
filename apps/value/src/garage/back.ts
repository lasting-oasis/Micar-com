// The card back in the Garage, the parts with no markup: the word that routes to the four-backs page, which
// rarities carry which foil, and where the card's files are. (Not named after CardBack.tsx: on Windows and macOS
// two files whose names differ only by a capital letter are one file.)
import { RARITY_TIERS } from '@micar/engine';
import type { RarityTier } from '@micar/engine';
import { foilForRarity } from '@micar/holo';
import type { FoilId } from '@micar/holo';

const BASE = import.meta.env.BASE_URL;

/** `#/garage/card-backs`: the four backs side by side. A MiCar ID starts "MC-", so the word can never be one. */
export const CARD_BACKS = 'card-backs';

/** The engine's rarity tiers that carry this foil, in the engine's order. */
export const tiersOf = (foil: FoilId): RarityTier[] => RARITY_TIERS.filter((tier) => foilForRarity(tier) === foil);

/** The card Blender exported (tools/blender/export_card.py). */
export const CARD_MODEL = `${BASE}cards/card.glb`;
/** The artwork, best first: the AVIF keeps full colour resolution, the WebP is for a browser that cannot read AVIF. */
export const CARD_ART = [`${BASE}cards/back.avif`, `${BASE}cards/back.webp`];
/** A still of the card with this foil: what stands in where the live card cannot be drawn. */
export const stillOf = (foil: FoilId): string => `${BASE}cards/back-${foil}.webp`;

/**
 * Closes the inspect view. A browser that has dialogs closes its own, and the dialog's close event then tells the
 * page. One too old to have them (the element is there, its close() is not) has only the page to tell, and so does
 * a dialog that never opened. Either way the Close button is never a dead end.
 */
export function shut(dialog: { open?: boolean; close?: () => void } | null, onClose: () => void): void {
  if (dialog && dialog.open && typeof dialog.close === 'function') dialog.close();
  else onClose();
}
