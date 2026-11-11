import { describe, expect, it } from 'vitest';
import { distanceToFill, multiply, perspective, rotationYX, transformPoint, translation } from './mat';

const FOV = (24 * Math.PI) / 180;

describe('matrices', () => {
  it('moves the right edge away for a positive yaw', () => {
    const p = transformPoint(rotationYX(0.2, 0), [1, 0, 0]);
    expect(p[2]).toBeCloseTo(-Math.sin(0.2), 6);
    expect(p[0]).toBeCloseTo(Math.cos(0.2), 6);
  });

  it('moves the top away for a negative pitch', () => {
    const p = transformPoint(rotationYX(0, -0.2), [0, 1, 0]);
    expect(p[2]).toBeCloseTo(-Math.sin(0.2), 6);
    expect(p[1]).toBeCloseTo(Math.cos(0.2), 6);
  });

  it('leaves a point alone when nothing is turned', () => {
    expect(transformPoint(rotationYX(0, 0), [0.3, -0.4, 0.5]).map((v) => +v.toFixed(6))).toEqual([0.3, -0.4, 0.5]);
  });

  it('pitches first and yaws second', () => {
    // a point on the card's top edge: the pitch tips it back, then the yaw swings that depth sideways
    const both = transformPoint(rotationYX(0.3, -0.2), [0, 1, 0]);
    const pitched = transformPoint(rotationYX(0, -0.2), [0, 1, 0]);
    const expected = transformPoint(rotationYX(0.3, 0), pitched);
    for (let i = 0; i < 3; i++) expect(both[i]).toBeCloseTo(expected[i], 6);
  });

  it('multiplies so the right-hand matrix is applied first', () => {
    const p = transformPoint(multiply(translation(1, 0, 0), rotationYX(Math.PI / 2, 0)), [0, 0, 1]);
    expect(p[0]).toBeCloseTo(2, 6);     // turned onto +x, then moved one along x
    expect(p[2]).toBeCloseTo(0, 6);
  });

  it('projects a point on the axis to the centre, inside the depth range', () => {
    const m = multiply(perspective(FOV, 0.75, 0.1, 100), translation(0, 0, -5));
    const p = transformPoint(m, [0, 0, 0]);
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(0, 6);
    expect(p[2]).toBeGreaterThan(-1);
    expect(p[2]).toBeLessThan(1);
  });

  it('puts the camera where a card one unit tall fills the asked share of the height', () => {
    const d = distanceToFill(FOV, 0.72);
    const m = multiply(perspective(FOV, 0.75, 0.1, 100), translation(0, 0, -d));
    expect(transformPoint(m, [0, 0.5, 0])[1]).toBeCloseTo(0.72, 6);
    expect(transformPoint(m, [0, -0.5, 0])[1]).toBeCloseTo(-0.72, 6);
  });

  it('narrows x by the aspect, and takes an aspect that makes no sense as square', () => {
    const d = distanceToFill(FOV, 0.72);
    const at = (aspect: number) => transformPoint(multiply(perspective(FOV, aspect, 0.1, 100), translation(0, 0, -d)), [0.5, 0, 0])[0];
    expect(at(0.75)).toBeCloseTo(0.72 / 0.75, 6);
    for (const aspect of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(at(aspect)).toBeCloseTo(0.72, 6);
  });
});
