import { describe, expect, it } from 'vitest';
import { FOILS } from './foils';
import { multiply, transformPoint, translation } from './mat';
import { CANVAS_ASPECT, FILL, KEY_LIGHT, WIDTH_FILL, foilUniforms, framing, pose, shadowFor } from './scene';
import { MAX_TILT } from './tilt';

const HALF_WIDTH = 0.5 * (63 / 87.86);      // the card is one unit tall
const CORNERS: [number, number, number][] = [[-HALF_WIDTH, -0.5, 0], [HALF_WIDTH, -0.5, 0], [HALF_WIDTH, 0.5, 0], [-HALF_WIDTH, 0.5, 0]];

/** Where a point of the card lands in the picture (-1..1 each way) for a canvas shape and a tilt. */
function seen(aspect: number, point: [number, number, number], tilt = { x: 0, y: 0 }): [number, number, number] {
  const { distance, projection } = framing(aspect, 2 * HALF_WIDTH);
  return transformPoint(multiply(projection, multiply(translation(0, 0, -distance), pose(tilt).rotation)), point);
}

describe('the camera', () => {
  it('fills 72% of the height of a 3:4 canvas with the card', () => {
    expect(FILL).toBe(0.72);
    expect(seen(3 / 4, [0, 0.5, 0])[1]).toBeCloseTo(0.72, 6);
    expect(seen(3 / 4, [0, -0.5, 0])[1]).toBeCloseTo(-0.72, 6);
  });

  it('keeps 72% of the height in a wider canvas', () => {
    expect(seen(2, [0, 0.5, 0])[1]).toBeCloseTo(0.72, 6);
  });

  it('gives the card 84% of the width of a canvas too narrow for 72% of its height', () => {
    // a phone held upright: the room is taller than 3:4, and the card should use its width
    for (const aspect of [0.55, 0.45, 0.3]) {
      expect(seen(aspect, [HALF_WIDTH, 0, 0])[0]).toBeCloseTo(WIDTH_FILL, 6);
      expect(seen(aspect, [0, 0.5, 0])[1]).toBeLessThan(0.72);
    }
    expect(WIDTH_FILL).toBe(0.84);
  });

  it('changes over without a jump where the two limits meet', () => {
    const meet = (WIDTH_FILL / 0.72) * (2 * HALF_WIDTH);      // the canvas shape at which 72% of the height is 84% of the width
    const below = seen(meet - 1e-6, [HALF_WIDTH, 0.5, 0]), above = seen(meet + 1e-6, [HALF_WIDTH, 0.5, 0]);
    expect(below[0]).toBeCloseTo(above[0], 4);
    expect(below[1]).toBeCloseTo(above[1], 4);
    expect(above[1]).toBeCloseTo(0.72, 4);
  });

  it('frames a card of another shape by that shape', () => {
    const square = framing(0.5, 1);
    const p = transformPoint(multiply(square.projection, translation(0, 0, -square.distance)), [0.5, 0, 0]);
    expect(p[0]).toBeCloseTo(WIDTH_FILL, 6);
    expect(framing(0.5, Number.NaN).fill).toBeCloseTo(framing(0.5).fill, 9);     // a shape that makes no sense: the card's own
  });

  it('keeps every corner inside the picture and inside the depth range at full tilt, whatever the canvas', () => {
    for (const aspect of [0.3, 0.5, 3 / 4, 1, 2, 5]) {
      for (const x of [-MAX_TILT, 0, MAX_TILT]) {
        for (const y of [-MAX_TILT, 0, MAX_TILT]) {
          for (const corner of CORNERS) {
            const p = seen(aspect, corner, { x, y });
            expect(Math.abs(p[0]), `x at aspect ${aspect}`).toBeLessThan(0.95);
            expect(Math.abs(p[1]), `y at aspect ${aspect}`).toBeLessThan(0.95);
            expect(Math.abs(p[2]), `depth at aspect ${aspect}`).toBeLessThan(1);
          }
        }
      }
    }
  });

  it('takes a canvas shape that makes no sense as 3:4', () => {
    const expected = seen(3 / 4, [HALF_WIDTH, 0.5, 0]);
    for (const aspect of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const p = seen(aspect, [HALF_WIDTH, 0.5, 0]);
      expect(p[0]).toBeCloseTo(expected[0], 6);
      expect(p[1]).toBeCloseTo(expected[1], 6);
    }
  });
});

describe('the pose', () => {
  it('is the card\'s own axes when flat', () => {
    const flat = pose({ x: 0, y: 0 });
    expect(flat.right).toEqual([1, 0, 0]);
    expect(flat.up).toEqual([0, 1, 0]);
    expect(flat.turn).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('moves the right edge away for a positive yaw and the top away for a negative pitch', () => {
    const yawed = pose({ x: 0, y: 0.2 });
    expect(yawed.right[2]).toBeCloseTo(-Math.sin(0.2), 9);
    expect(yawed.up).toEqual([0, 1, 0]);
    const pitched = pose({ x: -0.2, y: 0 });
    expect(pitched.up[2]).toBeCloseTo(-Math.sin(0.2), 9);
  });

  it('gives the normals the same turn as the positions', () => {
    const tilt = { x: -0.21, y: 0.13 };
    const { rotation, turn } = pose(tilt);
    const moved = transformPoint(rotation, [0.3, -0.4, 0.5]);
    const viaTurn = [0, 1, 2].map((row) => turn[row] * 0.3 + turn[3 + row] * -0.4 + turn[6 + row] * 0.5);
    for (let i = 0; i < 3; i++) expect(viaTurn[i]).toBeCloseTo(moved[i], 9);
  });
});

describe('the key light', () => {
  it('is up and to the left of the eye, where the Blender preview has it, and of unit length', () => {
    const length = Math.hypot(-0.30, 0.45, 0.84);
    expect(KEY_LIGHT[0]).toBeCloseTo(-0.30 / length, 9);
    expect(KEY_LIGHT[1]).toBeCloseTo(0.45 / length, 9);
    expect(KEY_LIGHT[2]).toBeCloseTo(0.84 / length, 9);
    expect(Math.hypot(...KEY_LIGHT)).toBeCloseTo(1, 9);
  });
});

describe('the shadow', () => {
  const flat = shadowFor({ x: 0, y: 0 });

  it('falls down and to the right of a flat card, away from the light', () => {
    expect(flat.x).toBeGreaterThan(0);
    expect(flat.y).toBeLessThan(0);
    expect(flat.dark).toBeGreaterThan(0.2);
    expect(flat.dark).toBeLessThan(0.8);
    expect(flat.blur).toBeGreaterThan(0);
  });

  it('softens and lightens as the card tilts', () => {
    const tilted = shadowFor({ x: MAX_TILT, y: -MAX_TILT });
    expect(tilted.blur).toBeGreaterThan(flat.blur);
    expect(tilted.dark).toBeLessThan(flat.dark);
    expect(tilted.dark).toBeGreaterThan(0);
  });

  it('slides out on the side that lifts', () => {
    expect(shadowFor({ x: 0, y: -MAX_TILT }).x).toBeGreaterThan(flat.x);     // left edge pressed away: the right edge lifts
    expect(shadowFor({ x: 0, y: MAX_TILT }).x).toBeLessThan(flat.x);
    expect(shadowFor({ x: -MAX_TILT, y: 0 }).y).toBeLessThan(flat.y);        // top pressed away: the bottom edge lifts
    expect(shadowFor({ x: MAX_TILT, y: 0 }).y).toBeGreaterThan(flat.y);
  });

  it('moves only a little: it stays under the card', () => {
    for (const x of [-MAX_TILT, MAX_TILT]) for (const y of [-MAX_TILT, MAX_TILT]) {
      const s = shadowFor({ x, y });
      expect(Math.abs(s.x)).toBeLessThan(0.1);
      expect(Math.abs(s.y)).toBeLessThan(0.1);
    }
  });
});

describe('a foil\'s numbers, as the shader takes them', () => {
  it('packs the recipe into the shader\'s vectors', () => {
    const u = foilUniforms(FOILS.rainbow, 63, 2000);
    expect(u.kind).toBe(2);
    expect(u.sweep).toEqual([6.5, 2.6, 5.0, 1.9]);
    expect(u.mask).toEqual([0.05, 0.6, 0.46, 0.7]);
    expect(u.gain).toEqual([1.35, 0.52, 1.2, 0.92]);
  });

  it('counts the facets across the card from its real width', () => {
    const u = foilUniforms(FOILS.prismatic, 63, 2000);
    expect(u.facet).toEqual([63 / 4, 0.002, 0.45, 0.5]);
    expect(u.detail[0]).toBe(0.06);
    expect(u.detail[1]).toBe(1.3);
  });

  it('uses the Blender preview\'s grain and flakes on a card drawn large', () => {
    const u = foilUniforms(FOILS.holo, 63, 2000);
    expect(u.detail[2]).toBe(420);
    expect(u.detail[3]).toBe(120);
  });

  it('coarsens the grain and the flakes on a card drawn small, so they stay bigger than a pixel', () => {
    const u = foilUniforms(FOILS.holo, 63, 300);
    expect(u.detail[2]).toBeCloseTo(300 / 1.2, 9);
    expect(u.detail[3]).toBeCloseTo(300 / 2.6, 9);
    expect(foilUniforms(FOILS.holo, 63, 200).detail[3]).toBeCloseTo(200 / 2.6, 9);
    const tiny = foilUniforms(FOILS.holo, 63, 10);
    expect(tiny.detail[2]).toBe(96);
    expect(tiny.detail[3]).toBe(48);
  });

  it('never hands the shader a zero to divide by or a number that is not one', () => {
    const broken = { ...FOILS.prismatic, cell: 0, lobe: 0, edge: 0 };
    for (const pixels of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const u = foilUniforms(broken, 63, pixels);
      for (const value of [u.kind, ...u.sweep, ...u.mask, ...u.gain, ...u.facet, ...u.detail]) expect(Number.isFinite(value)).toBe(true);
      expect(u.facet[3]).toBeGreaterThan(0);
      expect(u.detail[0]).toBeGreaterThan(0);
    }
    expect(Number.isFinite(foilUniforms(FOILS.gloss, Number.NaN, 500).facet[0])).toBe(true);
  });
});

describe('the canvas the card expects', () => {
  it('is three wide to four tall', () => {
    expect(CANVAS_ASPECT).toBe(3 / 4);
  });
});
