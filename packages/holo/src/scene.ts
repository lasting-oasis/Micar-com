// The numbers the renderer sends to the GPU, worked out from the card's angle, the canvas's shape and the foil
// table. Pure: no DOM and no GL in here, so every one of them is tested without a browser.
import type { FoilParams } from './foils';
import { distanceToFill, perspective, rotationYX } from './mat';
import type { Mat4 } from './mat';
import type { Angles } from './spring';
import { MAX_TILT } from './tilt';

/** The camera's vertical field of view. tools/blender/export_card.py frames its stills with the same lens. */
export const FOV = (24 * Math.PI) / 180;
/** The card's share of the picture's height, which leaves room for the tilt and the shadow. */
export const FILL = 0.72;
/** Its share of the width, in a canvas too narrow for that: a phone held upright. */
export const WIDTH_FILL = 0.84;
/** The canvas the card is framed for: three wide to four tall. A taller one works too; a wider one wastes pixels. */
export const CANVAS_ASPECT = 3 / 4;
/** A trading card: 63 mm wide for 87.86 tall. Used when the model's own shape is not given. */
const CARD_SHAPE = 63 / 87.86;
/** The card's corner radius as a share of its width, measured from the artwork by tools/blender/build_card.py. */
export const CORNER = 0.0675;

const LIGHT = [-0.30, 0.45, 0.84];
const LIGHT_LENGTH = Math.hypot(LIGHT[0], LIGHT[1], LIGHT[2]);
/** Toward the key light: up and to the left of the eye, fixed to the eye. The Blender preview's light, in its own axes, is (-0.30, -0.84, 0.45). */
export const KEY_LIGHT: [number, number, number] = [LIGHT[0] / LIGHT_LENGTH, LIGHT[1] / LIGHT_LENGTH, LIGHT[2] / LIGHT_LENGTH];

/**
 * Where the camera sits for a canvas of this shape (width over height), with the card one unit tall at the origin
 * and `cardShape` wide. The card takes 72% of the picture's height, or 84% of its width where the canvas is too
 * narrow for that, so on a phone held upright it is as large as the screen's width allows and is never cut off at
 * the sides. A shape that makes no sense is taken as 3:4 for the canvas, and as a trading card's for the card.
 */
export function framing(aspect: number, cardShape: number = CARD_SHAPE): { distance: number; fill: number; projection: Mat4 } {
  const shape = aspect > 0 && Number.isFinite(aspect) ? aspect : CANVAS_ASPECT;
  const card = cardShape > 0 && Number.isFinite(cardShape) ? cardShape : CARD_SHAPE;
  const fill = Math.min(FILL, (WIDTH_FILL * shape) / card);
  const distance = distanceToFill(FOV, fill);
  return { distance, fill, projection: perspective(FOV, shape, distance - 1, distance + 1) };
}

/**
 * The card's turn for a tilt: the 4 x 4 rotation for its positions, the same as a 3 x 3 for its normals, and its
 * own right and up as the eye sees them (the foil is worked out against those two).
 */
export function pose(tilt: Angles): { rotation: Mat4; turn: number[]; right: [number, number, number]; up: [number, number, number] } {
  const rotation = rotationYX(tilt.y, tilt.x);
  const at = (i: number): number => rotation[i] + 0;      // + 0 turns a negative zero into zero
  return {
    rotation,
    turn: [at(0), at(1), at(2), at(4), at(5), at(6), at(8), at(9), at(10)],
    right: [at(0), at(1), at(2)],
    up: [at(4), at(5), at(6)],
  };
}

/**
 * The shadow behind the card, in the card's units: where its centre lies from the card's, how soft its edge is and
 * how dark its middle. The light is up and to the left, so it falls down and to the right; it slides out a little
 * further on whichever side lifts toward the eye, and softens and lightens as the card leaves the surface.
 */
export function shadowFor(tilt: Angles): { x: number; y: number; blur: number; dark: number } {
  const lean = Math.min(1, Math.hypot(tilt.x, tilt.y) / MAX_TILT);
  return {
    x: 0.020 - 0.045 * Math.sin(tilt.y),
    y: -0.032 + 0.045 * Math.sin(tilt.x),
    blur: 0.045 + 0.030 * lean,
    dark: 0.50 - 0.12 * lean,
  };
}

export type FoilUniforms = {
  kind: number;
  /** K, S, K2, S2 */
  sweep: number[];
  /** m0, m1, cover, metal */
  mask: number[];
  /** strength, add, mul, sat */
  gain: number[];
  /** facets across the card's width, refr, amp, lobe */
  facet: number[];
  /** facet edge width, sparkle, grain cells across the width, flake cells across the width */
  detail: number[];
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** The grain and the flakes on a card drawn large: 420 and 120 cells across its width, as in the Blender preview. */
const GRAIN = 420, FLAKES = 120;

/**
 * One foil's recipe as the shader takes it, for a card `widthMm` wide drawn `cardPixels` wide. On a card drawn
 * large the grain and the flakes are the Blender preview's. Drawn small they are made coarser, so a grain cell
 * stays at least 1.2 pixels and a flake cell 2.6: finer than a pixel they would only shimmer. Nothing the shader
 * divides by is ever zero.
 */
export function foilUniforms(foil: FoilParams, widthMm: number, cardPixels: number): FoilUniforms {
  const width = widthMm > 0 && Number.isFinite(widthMm) ? widthMm : 63;
  const known = cardPixels > 0 && Number.isFinite(cardPixels);
  return {
    kind: foil.kind,
    sweep: [foil.K, foil.S, foil.K2, foil.S2],
    mask: [foil.m0, Math.max(foil.m1, foil.m0 + 0.001), foil.cover, foil.metal],
    gain: [foil.strength, foil.add, foil.mul, foil.sat],
    facet: [width / Math.max(foil.cell, 0.25), foil.refr, foil.amp, Math.max(foil.lobe, 0.01)],
    detail: [Math.max(foil.edge, 0.005), foil.sparkle, known ? clamp(cardPixels / 1.2, 96, GRAIN) : GRAIN, known ? clamp(cardPixels / 2.6, 48, FLAKES) : FLAKES],
  };
}
