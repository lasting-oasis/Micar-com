// The Garage on the physics core (DESIGN.md 12 and 13): with the switch on, its stat bars and dyno are the core's own
// bench for the car as built, measured once per car and build and never while a frame is drawn, and the class letter
// of a build is the card engine's raceClassOf on the Power Rating of the card with the bench's ratios. With the switch
// off the panel is the old model's, exactly as before.
import { afterEach, describe, expect, it } from 'vitest';
import { RACE_CLASSES, applyModifications, baseStats, raceClassOf } from '@micar/engine';
import { enginePeaks, runBench } from '@micar/physics';
import { GarageModel, type GarageCtx } from '../garage';
import { STOCK_CFG, TUNE_DEF, specFor } from '../data';
import type { PerfCfg, Tune } from '../physics';
import { engineSpecFor } from '../cardStats';
import { FULL_BUILD } from './floorRuns';
import { clearCoreModels, coreModelFor } from './model';
import { cardMods, computeGarage, dynoOf, garageCard, garageReady, requestGarageBench, useGarageRunner, type CoreGarage, type GarageCar } from './garageBench';

const LB = 0.45359237;
const camry: GarageCar = { year: 2020, make: 'Toyota', model: 'Camry', bodyStyle: 'sedan' };
const stock = STOCK_CFG.perf;

afterEach(() => { useGarageRunner(null); clearCoreModels(); });

describe('the core\'s Garage figures for a car as built', () => {
  it('stock, they are the bench\'s own: the Camry\'s 203 hp and its 3,310 lb, built and stock the same run; the class is its card\'s', () => {
    const g = computeGarage(camry, stock, TUNE_DEF);
    expect(g.built).toEqual(g.stock);
    expect(g.built.horsepower).toBeGreaterThan(203 * 0.97);
    expect(g.built.horsepower).toBeLessThan(203 * 1.03);
    const curb = coreModelFor(camry, stock, TUNE_DEF).sheet.curbWeightLb?.value ?? 3310;
    expect(g.built.curbWeightLb).toBeCloseTo(curb, 0);
    // A front-drive family sedan: 0-60 in 6.5 to 8 s, a 300 ft skidpad at 0.75 to 0.9 g, 60-0 in 110 to 140 ft.
    expect(g.built.zeroToSixtySec).toBeGreaterThan(6.5); expect(g.built.zeroToSixtySec).toBeLessThan(8);
    expect(g.built.lateralGripG).toBeGreaterThan(0.75); expect(g.built.lateralGripG).toBeLessThan(0.9);
    expect(g.built.braking60to0Ft).toBeGreaterThan(110); expect(g.built.braking60to0Ft).toBeLessThan(140);
    expect(g.drive).toBe('FWD');
    expect(g.nitrousHp).toBe(0);
    // Stock, the bench moves no figure: the rating and the class are the card's own (the world's provisional rating).
    const card = baseStats(engineSpecFor(camry));
    const rating = card.powerRating ?? card.provisionalRating;
    expect(g.powerRating).toBe(rating);
    expect(g.raceClass).toBe(raceClassOf(rating));
    expect(g.raceClass).not.toBeNull();
  }, 60_000);

  it('fully built, the parts show on the bench and on the card alike: more power, a quicker 0-60, more grip, a nitrous shot, a higher rating', () => {
    const s = computeGarage(camry, stock, TUNE_DEF), b = computeGarage(camry, FULL_BUILD, TUNE_DEF);
    expect(b.stock).toEqual(s.built);
    expect(b.built.horsepower).toBeGreaterThan(s.built.horsepower * 1.3);   // a turbo kit, cams, a tune: a third more and then some
    expect(b.built.zeroToSixtySec).toBeLessThan(s.built.zeroToSixtySec - 1);
    expect(b.built.lateralGripG).toBeGreaterThan(s.built.lateralGripG + 0.1);  // track tyres and race coilovers
    expect(b.built.curbWeightLb).toBeLessThan(s.built.curbWeightLb * 0.95);    // 12% off the curb weight, the kit's mass back on
    expect(b.nitrousHp).toBeCloseTo(150, 0);                                    // the biggest kit's 150 hp shot
    expect(b.nitrousSeconds).toBeGreaterThan(30);
    expect(b.powerRating!).toBeGreaterThan(s.powerRating!);
    // A higher rating is never a lower class: classes run D, C, B, A, S, X.
    const order = RACE_CLASSES.map(c => c.id as string);
    expect(order.indexOf(b.raceClass!)).toBeGreaterThanOrEqual(order.indexOf(s.raceClass!));
    // The class letter is the card engine's on that rating.
    expect(b.raceClass).toBe(raceClassOf(b.powerRating));
  }, 60_000);

  it('every part the Garage fits is charged on the card: the combustion parts too (the world\'s card has no powertrain on file; the core\'s sheet has)', () => {
    // The card engine waits on a blank powertrain: it refused the turbo, engine, ECU, intake-exhaust and nitrous charges
    // as "needs the powertrain on file", so a power build's durability was charged half what the parts cost and the
    // Camry with engine, ECU, turbo and nitrous at their third tier read Class A at 650 where it is a B.
    const power: Partial<PerfCfg> = { ...stock, engine: 3, ecu: 3, turbo: 3, nos: 3 };
    expect(engineSpecFor(camry).powertrain).toBeNull();
    const card = garageCard(camry);
    expect(card.powertrain?.value).toBe('gasoline');
    const mods = cardMods(camry, FULL_BUILD, TUNE_DEF), applied = applyModifications(card, mods);
    expect(applied.refused).toEqual([]);
    expect(applied.applied.map(m => m.category).sort()).toEqual(mods.map(m => m.category).sort());
    expect(new Set(applied.applied.map(m => m.category))).toEqual(new Set(['turbo', 'engine', 'ecu', 'intake-exhaust', 'nitrous', 'transmission', 'tires', 'suspension', 'weight', 'brakes']));
    const g = computeGarage(camry, power, TUNE_DEF);
    expect(g.powerRating!).toBeLessThan(645);
    expect(g.raceClass).toBe('B');
  }, 60_000);

  it('the dyno is the core engine\'s own full-throttle table, idle to redline: its peak is the bench\'s peak power', () => {
    const m = coreModelFor(camry, FULL_BUILD, TUNE_DEF).model, d = dynoOf(m), bench = runBench(m, 'dyno');
    expect(d[0][0]).toBe(Math.round(m.engine.idle * 60 / (2 * Math.PI)));
    expect(d[d.length - 1][0]).toBe(Math.round(m.engine.redline * 60 / (2 * Math.PI)));
    const peak = Math.max(...d.map(p => p[2]));
    expect(peak / bench.peakHp).toBeGreaterThan(0.99);
    expect(peak / bench.peakHp).toBeLessThan(1.01);
    expect(Math.max(...d.map(p => p[1]))).toBeCloseTo(enginePeaks(m.engine).torque, -1);
  }, 60_000);
});

describe('asked for without waiting', () => {
  it('the first ask gets nothing and starts one run; the answer comes once, then every ask has it; two asks share one run', () => {
    const runs: (() => void)[] = [];
    let calls = 0;
    useGarageRunner((car, perf, tune, reply) => { calls++; runs.push(() => reply(computeGarage(car, perf, tune))); });
    let told = 0;
    expect(requestGarageBench(camry, stock, TUNE_DEF, () => told++)).toBeNull();
    expect(requestGarageBench(camry, { ...stock }, { ...TUNE_DEF }, () => told++)).toBeNull();
    expect(calls).toBe(1);
    expect(garageReady(camry, stock, TUNE_DEF)).toBeNull();
    runs[0]();
    expect(told).toBe(2);
    const g = requestGarageBench(camry, stock, TUNE_DEF, () => told++);
    expect(g).not.toBeNull();
    expect(garageReady(camry, stock, TUNE_DEF)).toBe(g);
    expect(calls).toBe(1);
    expect(told).toBe(2);
  }, 60_000);
});

/* ------------------------------------------------------------------ the Garage's stat panel */

const ctxFor = (perf: PerfCfg, tune: Tune, coreBench?: GarageCtx['coreBench']): GarageCtx => ({
  money: () => 0, stage: () => 5,
  car: () => ({ id: 'c1', spec: specFor(camry), state: { cfg: { ...STOCK_CFG, perf }, tune, owned: [] } }),
  cars: () => [], buy: () => {}, equip: () => {}, tune: () => {}, toast: () => {}, sfx: () => {}, coreBench,
});

describe('the Garage\'s stat panel', () => {
  it('with the switch off (no core bench) it is the old model\'s, exactly as before', () => {
    const plain = new GarageModel(ctxFor(FULL_BUILD, TUNE_DEF)).stats();
    const off = new GarageModel(ctxFor(FULL_BUILD, TUNE_DEF, () => undefined)).stats();
    expect(off).toEqual(plain);
    expect(off.core).toBeUndefined();
  });

  it('with the switch on it shows the core\'s bench for the car as built and its class letter', () => {
    const g: CoreGarage = computeGarage(camry, FULL_BUILD, TUNE_DEF);
    const st = new GarageModel(ctxFor(FULL_BUILD, TUNE_DEF, () => g)).stats();
    expect(st.core).toBeDefined();
    expect(st.core!.measuring).toBe(false);
    expect(st.core!.cls).toBe(g.raceClass);
    expect(st.core!.rating).toBe(g.powerRating);
    expect(st.hp).toBe(Math.round(g.built.horsepower));
    const bars = Object.fromEntries(st.bars.map(b => [b.n, b.txt]));
    expect([`${Math.round(g.built.topSpeedMph)} mph`, `${Math.round(g.built.topSpeedMph * 1.609344)} km/h`]).toContain(bars['Top speed']);
    expect(bars.Acceleration).toBe(`${g.built.zeroToSixtySec.toFixed(1)} s 0-60`);
    expect(bars.Handling).toBe(`${g.built.lateralGripG.toFixed(2)} g`);
    expect(bars.Braking).toBe(`${Math.round(g.built.braking60to0Ft)} ft 60-0`);
    expect(bars.Nitrous).toMatch(/^150 hp · \d+ s$/);
    expect(st.core!.dyno!.preview).toBe(g.dyno);
    // the curb weight and the driver: the car as driven
    expect(st.mass).toBe(Math.round(g.massKg));
    expect(g.massKg).toBeCloseTo(g.built.curbWeightLb * LB + 75, 0);
  }, 60_000);

  it('while the bench measures, the panel draws at once and says so; it never runs the bench itself', () => {
    let asked = 0;
    const t0 = performance.now();
    const st = new GarageModel(ctxFor(FULL_BUILD, TUNE_DEF, () => { asked++; return null; })).stats();
    expect(performance.now() - t0).toBeLessThan(250);   // the old model's straight-line run only, not two bench runs
    expect(asked).toBeGreaterThan(0);
    expect(st.core!.measuring).toBe(true);
    expect(st.core!.cls).toBeNull();
    expect(st.bars.every(b => b.txt === '…')).toBe(true);
  });
});
