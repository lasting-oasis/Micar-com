import { describe, expect, it } from 'vitest';
import { MAX_TILT, tiltTarget, viewport } from './tilt';

const rect = { left: 100, top: 50, width: 300, height: 400 };

describe('pointer to tilt', () => {
  it('tilts sixteen degrees at most', () => {
    expect(MAX_TILT).toBeCloseTo((16 * Math.PI) / 180, 12);
  });

  it('is flat at the centre', () => {
    expect(tiltTarget(250, 250, rect)).toEqual({ x: 0, y: 0 });
  });

  it('moves the side under the pointer away', () => {
    expect(tiltTarget(400, 250, rect)).toEqual({ x: 0, y: MAX_TILT });       // right edge: yaw positive
    expect(tiltTarget(100, 250, rect)).toEqual({ x: 0, y: -MAX_TILT });
    expect(tiltTarget(250, 50, rect)).toEqual({ x: -MAX_TILT, y: 0 });       // top edge: pitch negative
    expect(tiltTarget(250, 450, rect)).toEqual({ x: MAX_TILT, y: 0 });
  });

  it('is proportional in between', () => {
    const half = tiltTarget(325, 150, rect);
    expect(half.y).toBeCloseTo(MAX_TILT / 2, 12);
    expect(half.x).toBeCloseTo(-MAX_TILT / 2, 12);
  });

  it('holds at the limit for a pointer outside the canvas', () => {
    expect(tiltTarget(9999, -9999, rect)).toEqual({ x: -MAX_TILT, y: MAX_TILT });
    expect(tiltTarget(-9999, 9999, rect)).toEqual({ x: MAX_TILT, y: -MAX_TILT });
  });

  it('is flat for a canvas with no size, and for a pointer that is not a number', () => {
    expect(tiltTarget(5, 5, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
    expect(tiltTarget(5, 5, { left: 0, top: 0, width: Number.NaN, height: 10 })).toEqual({ x: 0, y: 0 });
    expect(tiltTarget(Number.NaN, 5, rect)).toEqual({ x: 0, y: 0 });
  });
});

describe('the drawing size', () => {
  it('multiplies by the pixel ratio and caps it', () => {
    expect(viewport(300, 400, 1, 2)).toEqual({ width: 300, height: 400, ratio: 1 });
    expect(viewport(300, 400, 2, 2)).toEqual({ width: 600, height: 800, ratio: 2 });
    expect(viewport(300, 400, 3, 2)).toEqual({ width: 600, height: 800, ratio: 2 });
  });

  it('never returns less than one pixel', () => {
    expect(viewport(0, 0, 2, 2)).toEqual({ width: 1, height: 1, ratio: 2 });
    expect(viewport(Number.NaN, -5, 2, 2)).toEqual({ width: 1, height: 1, ratio: 2 });
  });

  it('takes a ratio that is missing, zero or under one as one', () => {
    for (const ratio of [Number.NaN, 0, 0.5, -2]) expect(viewport(300, 400, ratio, 2).ratio).toBe(1);
  });

  it('rounds to whole pixels', () => {
    expect(viewport(333.3, 444.4, 1.5, 2)).toEqual({ width: 500, height: 667, ratio: 1.5 });
  });
});
