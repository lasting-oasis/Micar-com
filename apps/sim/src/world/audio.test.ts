import { describe, expect, it } from 'vitest';
import { Audio, engineDrive, soundMode } from './audio';
import { soundFactsFor } from '../sound/carSound';
import { carParams, makeVehicle } from './physics';
import { ARCHETYPES, STOCK_CFG, TUNE_DEF } from './data';

describe('Audio', () => {
  it('is a no-op before resume and where there is no AudioContext (node)', () => {
    const a = new Audio(); const V = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF));
    expect(() => { a.sfx('horn'); a.engine(V, 10, true); a.resume(); a.sfx('crash'); a.engine(V, 10, false); a.silence(); a.suspend(); a.setMute(true); a.dispose(); }).not.toThrow();
    expect(a.levels()).toEqual([]);
    expect(a.isMuted).toBe(true);
  });
});

describe('engine sound model wiring', () => {
  const car = () => makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF));
  it('is the default, and ?sound=classic brings the old synth back', () => {
    expect(soundMode('?sound=model')).toBe('model');
    expect(soundMode('?physics=core&sound=model')).toBe('model');
    expect(soundMode('')).toBe('model');
    expect(soundMode('?sound=loud')).toBe('model');
    expect(soundMode('?sound=classic')).toBe('classic');
    expect(soundMode('?physics=core&sound=classic')).toBe('classic');
  });
  it('passes rpm, throttle and boost through and reads load from the throttle', () => {
    const V = car(); V.rpm = 4200; V.thr = 0.6; V.boost = 0.4;
    expect(engineDrive(V)).toEqual({ rpm: 4200, throttle: 0.6, load: 0.6, boost: 0.4, cut: 0 });
  });
  it('reports engine braking as negative load on a closed throttle', () => {
    const V = car(); V.rpm = V.P.redline; V.thr = 0;
    expect(engineDrive(V).load).toBeLessThan(0);
  });
  it('cuts the firing during a shift, past the limiter and with a blown engine', () => {
    const a = car(); a.thr = 1; a.shift = 0.2; expect(engineDrive(a).cut).toBe(1);
    const b = car(); b.thr = 1; b.rpm = b.P.redline + 200; expect(engineDrive(b).cut).toBe(1);
    const c = car(); c.thr = 1; c.blown = true; expect(engineDrive(c).cut).toBe(1);
  });
  it('accepts a car before the sound is switched on', () => {
    const a = new Audio();
    expect(() => { a.setCar(soundFactsFor({ engine: '5.0L V8', bodyStyle: 'coupe', redline: 7000 })); a.setCar(null); }).not.toThrow();
  });
});
