import { describe, it, expect } from 'vitest';
import { carParams, simStats } from './physics';
import { ARCHETYPES, EVENTS, STOCK_CFG, TRACK_NAMES, TUNE_DEF, freshStrip, pruneStrip, prizeFor, specFor, fitSpec, stageOf, visualRating, FLEET_SPECS } from './data';
import index from './strip/tracks.json';

describe('world data', () => {
  it('every archetype drives plausibly', () => { for (const s of Object.values(ARCHETYPES)) { const st = simStats(carParams(s, STOCK_CFG.perf, TUNE_DEF)); expect(st.t100).toBeGreaterThan(3); expect(st.t100).toBeLessThan(14); expect(st.top).toBeGreaterThan(150); expect(st.top).toBeLessThan(330); } });
  const fitted = (make: string, model: string, bodyStyle: string) => { const st = simStats(carParams(specFor({ make, model, bodyStyle }), STOCK_CFG.perf, TUNE_DEF)); return { t100: st.t100 as number, top: st.top }; };
  it('specFor fits a known car to its 0-60 and top speed', () => { const s = specFor({ make: 'Ford', model: 'Mustang', bodyStyle: 'coupe' }); const st = fitted('Ford', 'Mustang', 'coupe'); expect(st.t100).toBeGreaterThanOrEqual(4.3); expect(st.t100).toBeLessThanOrEqual(6.5); /* traction-limited RWD launch */ expect(s.drive).toBe('RWD'); expect(s.mass).toBeCloseTo(3800 * 0.4536, 0); });
  it('real cars land near their published numbers', () => {
    const vette = fitted('Chevy', 'Corvette', 'sports'); expect(vette.t100).toBeLessThan(6.0); /* traction-limited RWD launch */ expect(vette.top).toBeGreaterThan(280);
    const camry = fitted('Toyota', 'Camry', 'sedan'); expect(camry.t100).toBeGreaterThanOrEqual(7.4); expect(camry.t100).toBeLessThanOrEqual(8.4); expect(camry.top).toBeGreaterThanOrEqual(205); expect(camry.top).toBeLessThanOrEqual(230);
    const f150 = fitted('Ford', 'F-150', 'truck'); expect(f150.t100).toBeGreaterThanOrEqual(6.0); expect(f150.t100).toBeLessThanOrEqual(7.2);
    expect(fitted('Toyota', 'Prius', 'hatchback').t100).toBeGreaterThan(9.5);
  });
  it('body style sets grip and ride height on every non-fleet spec', () => { const s = specFor({ bodyStyle: 'truck', make: 'Zork', model: 'Blat' }); expect(s.gripMul).toBe(.9); expect(s.h).toBe(.62); });
  it('an absurd real-car record fits to finite values', () => { const s = fitSpec(ARCHETYPES.van, { engine: 'V8', hp: 900, weightLb: 4500, zeroToSixty: 1.5, topSpeedMph: 400, drive: 'AWD' }); expect(s.tq.every(([r, t]) => Number.isFinite(r) && Number.isFinite(t))).toBe(true); expect(Number.isFinite(s.fin)).toBe(true); });
  it('specFor falls back to the archetype for an unknown car', () => { expect(specFor({ make: 'Zork', model: 'Blat', bodyStyle: 'van' }).id).toBe('van'); expect(() => specFor({})).not.toThrow(); });
  it('stages', () => { expect(stageOf(0)).toBe(1); expect(stageOf(400)).toBe(2); expect(stageOf(3800)).toBe(5); });
  it('prizes', () => { const ev = EVENTS[0]; expect(prizeFor(ev, 1, 1, 0, false)).toEqual({ cash: 1500, rep: 150, styleBonus: 0, octane: 38 }); expect(prizeFor(ev, 2, 3, 0, false).cash).toBe(Math.round(1500 * 1.5 * 0.4)); expect(prizeFor(ev, 1, 1, 10, false).styleBonus).toBe(750); expect(prizeFor(ev, 1, 1, 10, true).cash).toBe(0); expect(prizeFor(ev, 4, 1, 0, false).octane).toBe(0); });
  it('visual rating caps at 10 and is 0 for stock', () => { expect(visualRating(STOCK_CFG)).toBe(0); expect(visualRating({ ...STOCK_CFG, spoiler: 4, rim: 'split', front: 3, vinyl: 4, hydraulics: 1, neon: '#22e5ff', finish: 'candy', hood: 3, rear: 2, skirts: 2, rimSize: 20, tint: 3, roof: 1 })).toBeLessThanOrEqual(10); });
  it('the library has twenty events over five stages', () => { expect(EVENTS.length).toBe(20); for (let s = 1; s <= 5; s++) expect(EVENTS.some(e => e.stage === s)).toBe(true); for (const e of EVENTS) { expect(e.stage).toBeGreaterThanOrEqual(1); expect(e.stage).toBeLessThanOrEqual(5); } });
  it('every event names a track with park names in both languages', () => { for (const e of EVENTS) { const n = TRACK_NAMES[e.track]; expect(n).toBeDefined(); expect(n.en.length).toBeGreaterThan(0); expect(n.es.length).toBeGreaterThan(0); } expect(new Set(EVENTS.map(e => e.track)).size).toBe(10); });
  it('every event matches the exported index', () => {
    for (const t of index.tracks) expect(new Set(t.events)).toEqual(new Set(EVENTS.filter(e => e.track === t.id).map(e => e.id)));
    for (const e of EVENTS) expect(index.tracks.filter(t => t.events.includes(e.id)).length).toBe(1);
  });
  it('events have no grid nodes and all park traffic', () => { for (const e of EVENTS) { expect('nodes' in e).toBe(false); expect(e.noTraffic).toBe(true); if (e.type === 'drag') expect(e.loop).toBeUndefined(); } });
  it('pruneStrip drops records of unknown events', () => {
    const rec = { ...freshStrip(), wins: { sp1: 2, royal_gp: 1 }, best: { ci1: 90, royal_gp: 80 } };
    const out = pruneStrip(rec);
    expect(out.wins).toEqual({ royal_gp: 1 }); expect(out.best).toEqual({ royal_gp: 80 });
    expect(rec.wins).toEqual({ sp1: 2, royal_gp: 1 }); expect(rec.best).toEqual({ ci1: 90, royal_gp: 80 });
  });
  it('a rented fleet car drives on its artifact spec', () => { const s = specFor({ make: 'Brute', model: '440', bodyStyle: 'sports', rental: true }); expect(s.mass).toBe(1720); expect(s.drive).toBe('RWD'); expect(s.redline).toBe(6200); });
  it("a tester's fleet car is the fleet's car too; a tester's real model is fitted like anyone's", () => {
    expect(specFor({ make: 'Brute', model: '440', bodyStyle: 'sports', testCar: true })).toEqual(specFor({ make: 'Brute', model: '440', bodyStyle: 'sports', rental: true }));
    expect(specFor({ make: 'Ford', model: 'Mustang', bodyStyle: 'sports', testCar: true })).toEqual(specFor({ make: 'Ford', model: 'Mustang', bodyStyle: 'sports' }));
  });
  it('the same make and model without rental takes the archetype path', () => { expect(specFor({ make: 'Brute', model: '440', bodyStyle: 'sports' }).id).toBe('sports'); });
  it('the five fleet specs are distinct in character and spread at least 2 s to 100', () => {
    const f = Object.values(FLEET_SPECS); const pk = (s: typeof f[0]) => Math.max(...s.tq.map(q => q[1]));
    for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) { const a = f[i], b = f[j]; expect(a.drive !== b.drive || Math.abs(a.redline - b.redline) >= 500 || Math.abs(pk(a) - pk(b)) >= 0.2 * Math.min(pk(a), pk(b))).toBe(true); }
    const t = f.map(s => simStats(carParams(s, STOCK_CFG.perf, TUNE_DEF)).t100 ?? 99); expect(Math.max(...t) - Math.min(...t)).toBeGreaterThanOrEqual(2);
  });
});
