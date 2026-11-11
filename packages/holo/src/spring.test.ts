import { describe, expect, it } from 'vitest';
import { REST, SPRING, settled, step } from './spring';
import type { Angles, Spring } from './spring';

const FRAME = 1 / 60;
/** Run the spring toward a target for some seconds of 60 Hz frames, keeping every state on the way. */
function run(from: Spring, target: Angles, seconds: number): Spring[] {
  const states = [from];
  for (let i = 0; i < Math.round(seconds / FRAME); i++) states.push(step(states[states.length - 1], target, FRAME));
  return states;
}

describe('the tilt spring', () => {
  it('uses the constants the design fixes', () => {
    expect(SPRING.k).toBe(170);
    expect(SPRING.c).toBe(20);
    expect(SPRING.step).toBeCloseTo(1 / 120, 12);
    expect(SPRING.maxFrame).toBeCloseTo(1 / 30, 12);
    expect(SPRING.restAngle).toBeCloseTo((0.02 * Math.PI) / 180, 12);
    expect(SPRING.restSpeed).toBeCloseTo((0.05 * Math.PI) / 180, 12);
  });

  it('reaches the target, settles there, and is then exactly on it', () => {
    const target = { x: 0.2, y: -0.2 };
    const end = run(REST, target, 3).pop() as Spring;
    expect(settled(end, target)).toBe(true);
    expect(end).toEqual({ x: 0.2, y: -0.2, vx: 0, vy: 0 });
  });

  it('settles within a second and a half of a full tilt', () => {
    const target = { x: 0.28, y: 0.28 };
    const states = run(REST, target, 1.5);
    expect(settled(states[states.length - 1], target)).toBe(true);
    expect(settled(states[10], target)).toBe(false);
  });

  it('overshoots a little and never rings', () => {
    const target = { x: 0.2, y: 0 };
    const xs = run(REST, target, 3).map((s) => s.x);
    const peak = Math.max(...xs);
    expect(peak).toBeGreaterThan(0.2);
    expect(peak).toBeLessThan(0.2 * 1.06);
    const afterPeak = xs.slice(xs.indexOf(peak));
    for (const x of afterPeak) expect(Math.abs(x - 0.2)).toBeLessThanOrEqual((peak - 0.2) + 1e-12);
    const firstBack = afterPeak.findIndex((x) => x <= 0.2);
    if (firstBack >= 0) for (const x of afterPeak.slice(firstBack)) expect(Math.abs(x - 0.2)).toBeLessThan(0.2 * 0.01);
  });

  it('comes back to flat when the target returns to zero', () => {
    const tilted = run(REST, { x: 0.25, y: -0.1 }, 2).pop() as Spring;
    const end = run(tilted, { x: 0, y: 0 }, 3).pop() as Spring;
    expect(end).toEqual(REST);
  });

  it('treats a long frame as a thirtieth of a second', () => {
    const target = { x: 0.2, y: 0.1 };
    const long = step(REST, target, 5);
    expect(long).toEqual(step(REST, target, SPRING.maxFrame));
    expect(Number.isFinite(long.x) && Number.isFinite(long.vx)).toBe(true);
  });

  it('does not move for a frame of no time, a negative time or no number at all', () => {
    const s = { x: 0.1, y: 0.05, vx: 0.3, vy: -0.2 };
    for (const dt of [0, -1, Number.NaN, Number.NEGATIVE_INFINITY]) expect(step(s, { x: 0.2, y: 0.2 }, dt)).toEqual(s);
  });

  it('never changes the state it was given', () => {
    const s = { x: 0, y: 0, vx: 0, vy: 0 };
    step(s, { x: 0.2, y: 0.2 }, FRAME);
    expect(s).toEqual({ x: 0, y: 0, vx: 0, vy: 0 });
  });

  it('is not settled while still moving through the target', () => {
    expect(settled({ x: 0.2, y: 0, vx: 0.5, vy: 0 }, { x: 0.2, y: 0 })).toBe(false);
    expect(settled({ x: 0.2, y: 0, vx: 0, vy: 0 }, { x: 0.2, y: 0 })).toBe(true);
    expect(settled({ x: 0.2 + SPRING.restAngle * 2, y: 0, vx: 0, vy: 0 }, { x: 0.2, y: 0 })).toBe(false);
  });
});
