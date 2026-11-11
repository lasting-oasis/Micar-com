// Where the pointer is on the canvas, as the angles the card should tilt to; and how many pixels to draw.
import type { Angles } from './spring';

/** The card tilts this far each way, and no further. */
export const MAX_TILT = (16 * Math.PI) / 180;

export type Rect = { left: number; top: number; width: number; height: number };

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * The tilt for a pointer at (clientX, clientY) over a canvas at `rect`. The side under the pointer moves away, as
 * if pressed: at the right edge the yaw is +MAX_TILT, at the top edge the pitch is -MAX_TILT. A pointer outside the
 * canvas holds the card at the limit. A canvas with no size, or a pointer that is not a number, gives a flat card.
 */
export function tiltTarget(clientX: number, clientY: number, rect: Rect): Angles {
  if (!(rect.width > 0) || !(rect.height > 0) || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return { x: 0, y: 0 };
  const right = clamp(((clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
  const up = clamp(1 - ((clientY - rect.top) / rect.height) * 2, -1, 1);
  if (!Number.isFinite(right) || !Number.isFinite(up)) return { x: 0, y: 0 };
  return { x: (0 - up) * MAX_TILT, y: right * MAX_TILT };
}

/**
 * The drawing buffer for a canvas of a CSS size: whole pixels, never fewer than one each way, at the device's
 * pixel ratio capped at `maxPixelRatio` (a phone at 3x draws more than twice the pixels of 2x for a difference
 * nobody sees on a moving card). A ratio that is missing or under one is taken as one.
 */
export function viewport(cssWidth: number, cssHeight: number, devicePixelRatio: number, maxPixelRatio: number): { width: number; height: number; ratio: number } {
  const ratio = Math.min(devicePixelRatio >= 1 ? devicePixelRatio : 1, maxPixelRatio >= 1 ? maxPixelRatio : 1);
  const pixels = (css: number): number => Math.max(1, Math.round((css > 0 ? css : 0) * ratio));
  return { width: pixels(cssWidth), height: pixels(cssHeight), ratio };
}
