import { describe, it, expect } from 'vitest';
import { carParams, simStats } from './physics';
import { ARCHETYPES, EVENTS, STOCK_CFG, TUNE_DEF, prizeFor, specFor, stageOf, visualRating } from './data';

describe('world data', () => {
  it('every archetype drives plausibly', () => { for (const s of Object.values(ARCHETYPES)) { const st = simStats(carParams(s, STOCK_CFG.perf, TUNE_DEF)); expect(st.t100).toBeGreaterThan(3); expect(st.t100).toBeLessThan(14); expect(st.top).toBeGreaterThan(150); expect(st.top).toBeLessThan(330); } });
  it('specFor scales a known car to its horsepower', () => { const s = specFor({ make: 'Ford', model: 'Mustang', bodyStyle: 'coupe' }); const st = simStats(carParams(s, STOCK_CFG.perf, TUNE_DEF)); expect(Math.abs(st.hp - 460) / 460).toBeLessThan(0.1); expect(s.drive).toBe('RWD'); expect(s.mass).toBeCloseTo(3800 * 0.4536, 0); });
  it('specFor falls back to the archetype for an unknown car', () => { expect(specFor({ make: 'Zork', model: 'Blat', bodyStyle: 'van' }).id).toBe('van'); expect(() => specFor({})).not.toThrow(); });
  it('stages', () => { expect(stageOf(0)).toBe(1); expect(stageOf(400)).toBe(2); expect(stageOf(3800)).toBe(5); });
  it('prizes', () => { const ev = EVENTS[0]; expect(prizeFor(ev, 1, 1, 0, false)).toEqual({ cash: 1500, rep: 150, styleBonus: 0, octane: 38 }); expect(prizeFor(ev, 2, 3, 0, false).cash).toBe(Math.round(1500 * 1.5 * 0.4)); expect(prizeFor(ev, 1, 1, 10, false).styleBonus).toBe(750); expect(prizeFor(ev, 1, 1, 10, true).cash).toBe(0); expect(prizeFor(ev, 4, 1, 0, false).octane).toBe(0); });
  it('visual rating caps at 10 and is 0 for stock', () => { expect(visualRating(STOCK_CFG)).toBe(0); expect(visualRating({ ...STOCK_CFG, spoiler: 4, rim: 'split', front: 3, vinyl: 4, hydraulics: 1, neon: '#22e5ff', finish: 'candy', hood: 3, rear: 2, skirts: 2, rimSize: 20, tint: 3, roof: 1 })).toBeLessThanOrEqual(10); });
});
