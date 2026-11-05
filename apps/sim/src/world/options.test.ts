import { afterEach, describe, expect, it } from 'vitest';
import { OPTIONS_KEY, OPTION_DEFAULTS, getOptions, parseOptions, resetOptionsCache, setOption } from './options';

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
    setOption('manual', true); setOption('units', 'kmh'); setOption('cam', 2); setOption('mute', true);
    expect(JSON.parse(s.m.get(OPTIONS_KEY)!)).toEqual({ manual: true, units: 'kmh', cam: 2, mute: true });
    resetOptionsCache();
    expect(getOptions()).toEqual({ manual: true, units: 'kmh', cam: 2, mute: true });
  });
  it('ignores a bad value and keeps working when storage throws', () => {
    g.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(getOptions()).toEqual(OPTION_DEFAULTS);
    setOption('units', 'kmh'); setOption('cam', 9);
    expect(getOptions()).toEqual({ ...OPTION_DEFAULTS, units: 'kmh' });
  });
});
