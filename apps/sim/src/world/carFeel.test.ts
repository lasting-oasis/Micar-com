import { describe, expect, it } from 'vitest';
import { carParams, makeVehicle, type Vehicle } from './physics';
import { ARCHETYPES, STOCK_CFG, TUNE_DEF } from './data';
import { feelStep, freshFeel, skidLevel, smokeLevel, wheelRollRate } from './carFeel';

const car = (): Vehicle => makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF));

describe('carFeel', () => {
  it('a left turn rolls the body, and roll is clamped at 0.08 rad', () => {
    const V = car(); V.u = 20; V.w = .8;
    let F = freshFeel();
    for (let i = 0; i < 60; i++) F = feelStep(V, 1 / 60, F);
    expect(F.roll).toBeGreaterThan(0);
    V.w = 5;
    for (let i = 0; i < 600; i++) F = feelStep(V, 1 / 60, F);
    expect(F.roll).toBeLessThanOrEqual(.08 + 1e-9);
    expect(F.roll).toBeCloseTo(.08, 6);
  });

  it('braking pitches by the formula sign (ax -8 gives pitch > 0) and pitch settles back within 0.02 rad of zero', () => {
    const V = car(); V.u = 20; V.ax = -8;
    let F = freshFeel();
    for (let i = 0; i < 60; i++) F = feelStep(V, 1 / 60, F);
    expect(F.pitch).toBeGreaterThan(0);
    V.ax = 0;
    for (let i = 0; i < 60; i++) F = feelStep(V, 1 / 60, F);
    expect(Math.abs(F.pitch)).toBeLessThan(.02);
  });

  it('dt 0 and NaN acceleration leave F unchanged and finite', () => {
    const V = car(); V.u = 15; V.w = .4;
    const F = freshFeel();
    const before = { ...F };
    const G = feelStep(V, 0, F);
    expect(G).toEqual(before);
    V.ax = NaN;
    const H = feelStep(V, 1 / 60, F);
    expect(H).toEqual(before);
    expect(Number.isFinite(H.roll) && Number.isFinite(H.pitch) && Number.isFinite(H.lift)).toBe(true);
  });

  it('wheel overspin scales the rear roll rate with spinR', () => {
    const V = car(); V.u = 10; V.spinR = 1;
    expect(wheelRollRate(V, false)).toBeCloseTo(V.u * 2.5, 9);
    expect(wheelRollRate(V, true)).toBeCloseTo(V.u, 9);
  });

  it('smoke is 0 when cruising straight and 1 under handbrake at speed', () => {
    const V = car(); V.u = 20;
    expect(smokeLevel(V)).toBe(0);
    V.hand = true; V.u = 15;
    expect(smokeLevel(V)).toBe(1);
  });

  it('skid is 1 for a large slip angle at speed and 0 for a small one', () => {
    const V = car(); V.u = 10; V.beta = .25;
    expect(skidLevel(V)).toBe(1);
    V.beta = .1;
    expect(skidLevel(V)).toBe(0);
  });
});
