import { describe, expect, it } from 'vitest';
import { soundFactsFor } from './carSound';
import { checkFiring } from './firing';
import { EngineSound } from './engineSound';
import { getCarSpec } from '../carSpecs';

describe('soundFactsFor', () => {
  it('reads layout, cylinders and displacement from the engine text', () => {
    const f = soundFactsFor({ engine: '2.5L I4', bodyStyle: 'sedan', redline: 6500 })!;
    expect(f.engine).toMatchObject({ layout: 'inline', cylinders: 4, displacementL: 2.5, induction: 'na' });
    expect(f.exhaust.layout).toBe('single');
    expect(f.redline).toBe(6500);
  });
  it('gives a V8 a cross-plane crank, dual pipes on a coupe and joined pipes on a truck', () => {
    const coupe = soundFactsFor({ engine: '5.0L V8', bodyStyle: 'coupe', redline: 7000 })!;
    expect(coupe.engine).toMatchObject({ layout: 'v', cylinders: 8, crank: 'cross' });
    expect(coupe.exhaust.layout).toBe('dual');
    expect(soundFactsFor({ engine: '5.3L V8', bodyStyle: 'truck', redline: 5800 })!.exhaust.layout).toBe('merge');
  });
  it('reads turbocharging in the ways the car table writes it', () => {
    for (const engine of ['3.0L Twin-Turbo I6', '2.7L EcoBoost V6', '1.5L Turbo I4']) expect(soundFactsFor({ engine, bodyStyle: 'sedan', redline: 6500 })!.engine.induction).toBe('turbo');
  });
  it('gives a supercharged engine a lobe order for its whine', () => {
    const f = soundFactsFor({ engine: '6.2L Supercharged V8', bodyStyle: 'sports', redline: 6500 })!;
    expect(f.engine.induction).toBe('super');
    expect(f.blowerOrder).toBeGreaterThan(10);
  });
  it('reads a boxer engine as flat', () => {
    expect(soundFactsFor({ engine: '2.5L H4', bodyStyle: 'suv', redline: 6000 })!.engine.layout).toBe('flat');
    expect(soundFactsFor({ engine: '3.0L Twin-Turbo Flat-6', bodyStyle: 'sports', redline: 7500 })!.engine).toMatchObject({ layout: 'flat', cylinders: 6 });
  });
  it('keeps the engine of a hybrid', () => {
    expect(soundFactsFor({ engine: '1.8L I4 Hybrid', bodyStyle: 'hatchback', redline: 5200 })!.engine.cylinders).toBe(4);
  });
  it('returns null when there is no piston engine to model', () => {
    expect(soundFactsFor({ engine: 'Dual Motor Electric', bodyStyle: 'sedan', redline: 16000 })).toBeNull();
    expect(soundFactsFor({ engine: '', bodyStyle: 'sedan', redline: 6000 })).toBeNull();
  });
  it('marks everything it guessed as a class value', () => {
    expect(soundFactsFor({ engine: '2.0L I4', bodyStyle: 'sedan', redline: 6500 })!.basis).toEqual({ engine: 'derived', exhaust: 'class' });
  });
  it('makes consistent, renderable facts for every body style the game has', () => {
    for (const bodyStyle of ['sedan', 'coupe', 'hatchback', 'suv', 'truck', 'van', 'sports']) {
      const spec = getCarSpec({ bodyStyle });
      const f = soundFactsFor({ engine: spec.engine, bodyStyle, redline: 6500 })!;
      expect(f, bodyStyle).not.toBeNull();
      expect(checkFiring(f.engine)).toBeNull();
      const s = new EngineSound(f, 48000); s.rpm = 3000; s.throttle = 1; s.load = 1;
      const L = new Float32Array(4800), R = new Float32Array(4800); s.render(L, R);
      expect(L.some(v => v !== 0)).toBe(true);
    }
  });
});
