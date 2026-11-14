import { afterEach, describe, expect, it } from 'vitest';
import { AUTO_DETAILED_ON_HIGH, OPTIONS_KEY, OPTION_DEFAULTS, carModelsOn, getOptions, modelsHint, parseOptions, resetOptionsCache, setOption } from './options';

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
  it('car models are Auto (null) until the player chooses (also for options saved before the setting existed, and a bad value)', () => {
    expect(OPTION_DEFAULTS.models).toBeNull();
    expect(parseOptions(JSON.stringify({ manual: true, units: 'kmh', cam: 1, mute: false, controls: 'sticks' })).models).toBeNull();
    expect(parseOptions(JSON.stringify({ models: 'off' })).models).toBeNull();
    expect(parseOptions(JSON.stringify({ models: false })).models).toBe(false);
    expect(parseOptions(JSON.stringify({ ver: 2, models: true })).models).toBe(true);
  });
  it('options saved before the Graphics rule (no version): Simple was a choice and stays one; Detailed may be the old default, so it is Auto', () => {
    expect(parseOptions(JSON.stringify({ manual: false, units: 'mph', cam: 0, mute: false, controls: 'sticks', models: true })).models).toBeNull();
    expect(parseOptions(JSON.stringify({ manual: false, units: 'mph', cam: 0, mute: false, controls: 'sticks', models: false })).models).toBe(false);
    expect(parseOptions(JSON.stringify({ ver: 2, models: true })).models).toBe(true); // saved since: a choice
    expect(parseOptions(JSON.stringify({ ver: 2, models: null })).models).toBeNull();
  });
  it('Auto (null) can be chosen again after a choice', () => {
    const s = memStore(); g.localStorage = s;
    setOption('models', false); setOption('models', null);
    resetOptionsCache(); expect(getOptions().models).toBeNull();
  });
  it('a save of any other option keeps "no choice" as no choice, and a choice as a choice', () => {
    const s = memStore(); g.localStorage = s;
    setOption('units', 'kmh');
    resetOptionsCache(); expect(getOptions().models).toBeNull();
    setOption('models', true); setOption('cam', 1);
    resetOptionsCache(); expect(getOptions().models).toBe(true);
    expect(JSON.parse(s.m.get(OPTIONS_KEY)!).ver).toBe(2);
  });
  it("for now (the owner's decision, until the fixed models are in) Auto gives the built-in bodies on every Graphics setting", () => {
    expect(AUTO_DETAILED_ON_HIGH).toBe(false); // flip this one constant back once the fixed models are in
    expect(carModelsOn({ models: null }, 'high')).toBe(false);
    expect(carModelsOn({ models: null }, 'low')).toBe(false);
    // a choice in the Garage wins: Detailed shows the models on any Graphics setting
    expect(carModelsOn({ models: true }, 'low')).toBe(true); expect(carModelsOn({ models: true }, 'high')).toBe(true);
    expect(carModelsOn({ models: false }, 'high')).toBe(false);
  });
  it("the Garage row's hint says what Auto comes to (for now Simple on High and Low; flipped back, Detailed on High), and only on Auto", () => {
    expect(modelsHint({ models: null }, 'high')).toBe(AUTO_DETAILED_ON_HIGH ? 'Detailed' : 'Simple');
    expect(modelsHint({ models: null }, 'high')).toBe('Simple'); expect(modelsHint({ models: null }, 'low')).toBe('Simple');
    expect(modelsHint({ models: null }, 'high', true)).toBe('Detailed'); expect(modelsHint({ models: null }, 'low', true)).toBe('Simple');
    expect(modelsHint({ models: true }, 'low')).toBeUndefined(); expect(modelsHint({ models: false }, 'high', true)).toBeUndefined(); // a choice: no hint
  });
  it('flipped back, Auto follows Graphics: models on High, built-in bodies on Low; a choice still wins', () => {
    expect(carModelsOn({ models: null }, 'high', true)).toBe(true);
    expect(carModelsOn({ models: null }, 'low', true)).toBe(false);
    expect(carModelsOn({ models: true }, 'low', true)).toBe(true);
    expect(carModelsOn({ models: false }, 'high', true)).toBe(false);
  });
  it('ignores a bad value and keeps working when storage throws', () => {
    g.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(getOptions()).toEqual(OPTION_DEFAULTS);
    setOption('units', 'kmh'); setOption('cam', 9);
    expect(getOptions()).toEqual({ ...OPTION_DEFAULTS, units: 'kmh' });
  });
});
