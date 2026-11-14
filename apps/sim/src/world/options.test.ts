import { afterEach, describe, expect, it } from 'vitest';
import { OPTIONS_KEY, OPTION_DEFAULTS, carModelsOn, getOptions, parseOptions, resetOptionsCache, setOption } from './options';

const g = globalThis as { localStorage?: unknown };
const memStore = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };

afterEach(() => { delete g.localStorage; resetOptionsCache(); });

describe('drive options', () => {
  it('defaults when nothing or junk is stored', () => {
    expect(parseOptions(null)).toEqual(OPTION_DEFAULTS);
    expect(parseOptions('{nope')).toEqual(OPTION_DEFAULTS);
    expect(parseOptions(JSON.stringify({ manual: 'yes', units: 'knots', cam: 7, mute: 1 }))).toEqual(OPTION_DEFAULTS);
  });
  it('saves every option under one key and reads it back', () => {
    const s = memStore(); g.localStorage = s;
    setOption('manual', true); setOption('units', 'kmh'); setOption('cam', 2); setOption('mute', true); setOption('controls', 'buttons');
    setOption('models', false);
    expect(JSON.parse(s.m.get(OPTIONS_KEY)!)).toEqual({ manual: true, units: 'kmh', cam: 2, mute: true, controls: 'buttons', models: false, ver: 2 });
    resetOptionsCache();
    expect(getOptions()).toEqual({ manual: true, units: 'kmh', cam: 2, mute: true, controls: 'buttons', models: false });
  });
  it('touch controls default to the sticks, also for options saved before the setting existed', () => {
    expect(OPTION_DEFAULTS.controls).toBe('sticks');
    expect(parseOptions(JSON.stringify({ manual: true, units: 'kmh', cam: 1, mute: false })).controls).toBe('sticks');
    expect(parseOptions(JSON.stringify({ controls: 'joystick' })).controls).toBe('sticks');
  });
  it('car models follow Graphics until the player chooses (also for options saved before the setting existed, and a bad value)', () => {
    expect(OPTION_DEFAULTS.models).toBeNull();
    expect(parseOptions(JSON.stringify({ manual: true, units: 'kmh', cam: 1, mute: false, controls: 'sticks' })).models).toBeNull();
    expect(parseOptions(JSON.stringify({ models: 'off' })).models).toBeNull();
    expect(parseOptions(JSON.stringify({ models: false })).models).toBe(false);
    expect(parseOptions(JSON.stringify({ ver: 2, models: true })).models).toBe(true);
  });
  it('options saved before the Graphics rule (no version): Simple was a choice and stays one; Detailed may be the old default, so it follows Graphics', () => {
    expect(parseOptions(JSON.stringify({ manual: false, units: 'mph', cam: 0, mute: false, controls: 'sticks', models: true })).models).toBeNull();
    expect(parseOptions(JSON.stringify({ manual: false, units: 'mph', cam: 0, mute: false, controls: 'sticks', models: false })).models).toBe(false);
    expect(parseOptions(JSON.stringify({ ver: 2, models: true })).models).toBe(true); // saved since: a choice
    expect(parseOptions(JSON.stringify({ ver: 2, models: null })).models).toBeNull();
  });
  it('a save of any other option keeps "no choice" as no choice, and a choice as a choice', () => {
    const s = memStore(); g.localStorage = s;
    setOption('units', 'kmh');
    resetOptionsCache(); expect(getOptions().models).toBeNull();
    setOption('models', true); setOption('cam', 1);
    resetOptionsCache(); expect(getOptions().models).toBe(true);
    expect(JSON.parse(s.m.get(OPTIONS_KEY)!).ver).toBe(2);
  });
  it('car models are on unless Graphics is Low; a choice in the Garage wins either way', () => {
    expect(carModelsOn({ models: null }, 'high')).toBe(true);
    expect(carModelsOn({ models: null }, 'low')).toBe(false);
    expect(carModelsOn({ models: true }, 'low')).toBe(true);
    expect(carModelsOn({ models: false }, 'high')).toBe(false);
  });
  it('ignores a bad value and keeps working when storage throws', () => {
    g.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(getOptions()).toEqual(OPTION_DEFAULTS);
    setOption('units', 'kmh'); setOption('cam', 9);
    expect(getOptions()).toEqual({ ...OPTION_DEFAULTS, units: 'kmh' });
  });
});
