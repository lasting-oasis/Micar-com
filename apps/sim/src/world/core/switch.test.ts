import { afterEach, describe, expect, it } from 'vitest';
import { DRIVING_KEY, assistsInAddress, coreChosen, drivingMode, modeInAddress, resetDrivingMode } from './switch';
import { OPTIONS_KEY, getOption, resetOptionsCache, setOption } from '../options';
import { Driver } from '../driver';
import { CoreDriver, driverKind, makeDriver } from './index';
import { ARCHETYPES, specFor, STOCK_CFG, TUNE_DEF } from '../data';
import { GarageModel, type GarageCtx } from '../garage';

const g = globalThis as { localStorage?: unknown };
const memStore = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };
afterEach(() => { delete g.localStorage; resetDrivingMode(); resetOptionsCache(); });

const ronin = { make: 'Ronin', model: 'GT', rental: true };
const build = { cfg: STOCK_CFG, tune: TUNE_DEF };
const start = { x: 3, z: 4, h: 0.5 };

describe('the switch between the old model and the core', () => {
  it('reads ?physics=core and ?physics=classic from the address, among other parameters, and nothing else', () => {
    expect(modeInAddress('?physics=core')).toBe('core');
    expect(modeInAddress('?race=AB12&physics=core&sound=classic')).toBe('core');
    expect(modeInAddress('?physics=classic')).toBe('classic');
    expect(modeInAddress('')).toBeNull();
    expect(modeInAddress('?physics=corex')).toBeNull();
    expect(modeInAddress('?sound=classic')).toBeNull();
  });

  it('reads the assist preset from ?assists=, Standard (null here) when it names none', () => {
    expect(assistsInAddress('?physics=core&assists=casual')).toBe('casual');
    expect(assistsInAddress('?assists=pure')).toBe('pure');
    expect(assistsInAddress('?physics=core')).toBeNull();
    expect(assistsInAddress('?assists=arcade')).toBeNull();
  });

  it('is off by default: nothing stored and nothing in the address drives the old model', () => {
    g.localStorage = memStore();
    expect(drivingMode('')).toBe('classic');
    expect(coreChosen('')).toBe(false);
  });

  it('with the switch off the driver chosen is the old one, built exactly as the scene always built it', () => {
    g.localStorage = memStore();
    const spec = specFor(ronin), d = makeDriver(ronin, spec, build, start, undefined, coreChosen(''));
    expect(d).toBeInstanceOf(Driver);
    expect(driverKind(d)).toBe('classic');
    expect(d.V).toEqual(new Driver(spec, build, start).V);
  });

  it('?physics=core, or the Garage choice stored, gives the core driver; the address overrides what is stored', () => {
    const s = memStore(); g.localStorage = s;
    const spec = specFor(ronin);
    expect(makeDriver(ronin, spec, build, start, undefined, coreChosen('?physics=core'))).toBeInstanceOf(CoreDriver);
    setOption('physics', 'core');
    expect(s.m.get(DRIVING_KEY)).toBe('core');
    expect(coreChosen('')).toBe(true);
    expect(driverKind(makeDriver(ronin, spec, build, start, undefined, coreChosen('')))).toBe('core');
    expect(drivingMode('?physics=classic')).toBe('classic');
  });

  it('the Garage reads and writes it through getOption/setOption without touching the drive options saved before it', () => {
    const s = memStore(); g.localStorage = s;
    setOption('units', 'kmh');
    const saved = s.m.get(OPTIONS_KEY);
    expect(getOption('physics')).toBe('classic');
    setOption('physics', 'core');
    expect(getOption('physics')).toBe('core');
    expect(s.m.get(OPTIONS_KEY)).toBe(saved);
    setOption('physics', 'turbo'); // not a mode: ignored
    expect(getOption('physics')).toBe('core');
    resetDrivingMode(); // a fresh page reads it back from storage
    expect(getOption('physics')).toBe('core');
  });

  it('keeps the choice for the page when storage is blocked', () => {
    g.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(drivingMode('')).toBe('classic');
    setOption('physics', 'core');
    expect(drivingMode('')).toBe('core');
  });

  it('is a row of the Garage Options: "Driving", Classic first, New (beta) after one press, saved where the switch reads it', () => {
    g.localStorage = memStore();
    const ctx: GarageCtx = {
      money: () => 0, stage: () => 1, car: () => ({ id: 'c1', spec: ARCHETYPES.sedan, state: { cfg: STOCK_CFG, tune: TUNE_DEF, owned: [] } }),
      cars: () => [], buy: () => {}, equip: () => {}, tune: () => {}, toast: () => {}, sfx: () => {},
      getOpt: k => getOption(k), setOpt: (k, v) => setOption(k, v),
    };
    const m = new GarageModel(ctx);
    m.select(m.rowIds().indexOf('options')); m.activate();
    const i = m.rowIds().indexOf('physics');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(m.rows()[i].label).toBe('Driving');
    expect(m.rows()[i].status!.text).toBe('Classic');
    m.select(i); m.activate();
    expect(m.rows()[i].status!.text).toBe('New (beta)');
    expect(coreChosen('')).toBe(true);
  });
});
