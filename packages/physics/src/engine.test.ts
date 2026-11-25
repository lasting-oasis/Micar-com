// The engine against published figures: peaks where the maker puts them, an air model a part can work on, turbo lag,
// engine braking, the limiter, idle and an electric motor.
import { describe, expect, it } from 'vitest';
import type { EngineKind, EngineModel } from './types';
import type { EngineSpec } from './engine';
import { AIR_ENERGY, boostStep, buildEngine, enginePeaks, engineTorque, rebuildTables, targetTorque, throttleForShare } from './engine';
import { HP, LBFT, PSI, RPM } from './units';

type Published = {
  name: string; kind: EngineKind; litres: number; cylinders: number;
  hp: number; hpRpm: number; lbft: number; tqRpm: number; tqRpmHigh?: number; redline: number; psi?: number;
};

/** A spec from a maker's figures, with the class defaults DESIGN.md 7 gives for idle and inertia. */
function spec(p: Published): EngineSpec {
  return {
    kind: p.kind, displacementL: p.litres, cylinders: p.cylinders,
    peakPower: p.hp * HP, peakPowerOmega: p.hpRpm * RPM,
    peakTorque: p.lbft * LBFT, peakTorqueOmegaLow: p.tqRpm * RPM, peakTorqueOmegaHigh: (p.tqRpmHigh ?? p.tqRpm) * RPM,
    redline: p.redline * RPM, idle: (p.cylinders >= 8 ? 650 : 750) * RPM,
    boostPa: (p.psi ?? 0) * PSI, inertia: 0.08 + 0.04 * p.litres, curve: null,
  };
}

const SMALL_FOUR: Published = { name: 'unboosted 2.0 four', kind: 'na', litres: 2.0, cylinders: 4, hp: 158, hpRpm: 6500, lbft: 138, tqRpm: 4200, redline: 6700 };
const V8: Published = { name: 'unboosted 5.0 V8', kind: 'na', litres: 5.0, cylinders: 8, hp: 486, hpRpm: 7250, lbft: 418, tqRpm: 4900, redline: 7500 };
const TURBO_FOUR: Published = { name: 'turbo 2.0 four, 21 psi', kind: 'turbo', litres: 2.0, cylinders: 4, hp: 241, hpRpm: 5000, lbft: 273, tqRpm: 1750, tqRpmHigh: 4300, redline: 6500, psi: 21 };
const FLAT_SIX: Published = { name: 'twin-turbo 3.0 flat six, 15 psi', kind: 'turbo', litres: 3.0, cylinders: 6, hp: 379, hpRpm: 6500, lbft: 331, tqRpm: 1950, tqRpmHigh: 5000, redline: 7500, psi: 15 };
const TRUCK_V6: Published = { name: 'turbo 3.5 truck V6, 18 psi', kind: 'turbo', litres: 3.5, cylinders: 6, hp: 450, hpRpm: 5850, lbft: 510, tqRpm: 3000, redline: 6250, psi: 18 };
const PUSHROD_V8: Published = { name: 'pushrod 6.2 V8', kind: 'na', litres: 6.2, cylinders: 8, hp: 495, hpRpm: 6450, lbft: 470, tqRpm: 5150, redline: 6600 };
const BLOWN_V8: Published = { name: 'supercharged 6.2 V8, 9.4 psi', kind: 'supercharged', litres: 6.2, cylinders: 8, hp: 650, hpRpm: 6400, lbft: 650, tqRpm: 3600, redline: 6600, psi: 9.4 };
const PUBLISHED = [SMALL_FOUR, V8, TURBO_FOUR, FLAT_SIX, TRUCK_V6, PUSHROD_V8];

const ELECTRIC: EngineSpec = {
  kind: 'electric', displacementL: 0, cylinders: 0, peakPower: 350e3, peakPowerOmega: 350e3 / 660, peakTorque: 660,
  peakTorqueOmegaLow: 0, peakTorqueOmegaHigh: 350e3 / 660, redline: 18000 * RPM, idle: 0, boostPa: 0, inertia: 0.05, curve: null,
};

const H = 1 / 480;
const full = (e: EngineModel, rpm: number): number => engineTorque(e, rpm * RPM, 1, 1);
const kw = (e: EngineModel, rpm: number): number => full(e, rpm) * rpm * RPM / 1000;
const relErr = (a: number, b: number): number => Math.abs(a / b - 1);
/** Multiplies the boost above ambient so that the full-boost pressure ratio goes up by `factor`, as a boost controller would. */
function raiseBoost(e: EngineModel, prFactor: number): void {
  const pr = e.air!.pressureRatio;
  let top = 1;
  for (let i = 0; i < pr.length; i++) top = Math.max(top, pr[i]);
  const k = top > 1 ? (prFactor * top - 1) / (top - 1) : prFactor;
  for (let i = 0; i < pr.length; i++) pr[i] = 1 + (pr[i] - 1) * k;
}
/** Seconds of full throttle, held at one engine speed, for the boost to reach `to` from `from`. */
function boostTime(e: EngineModel, rpm: number, throttle: number, from: number, to: number): number {
  let b = from, t = 0;
  while ((to > from ? b < to : b > to) && t < 20) { b = boostStep(e, b, rpm * RPM, throttle, H); t += H; }
  return t;
}

describe('published peaks come out where the maker puts them', () => {
  for (const p of [...PUBLISHED, BLOWN_V8]) {
    it(`${p.name}: ${p.hp} hp at ${p.hpRpm} rpm, ${p.lbft} lb ft at ${p.tqRpm}${p.tqRpmHigh ? `-${p.tqRpmHigh}` : ''} rpm`, () => {
      const s = spec(p), e = buildEngine(s), peaks = enginePeaks(e), step = e.dOmega / RPM;
      expect(relErr(peaks.power, s.peakPower)).toBeLessThan(0.005);
      expect(relErr(peaks.torque, s.peakTorque)).toBeLessThan(0.005);
      expect(Math.abs(peaks.powerOmega / RPM - p.hpRpm)).toBeLessThanOrEqual(step);
      expect(peaks.torqueOmega / RPM).toBeGreaterThanOrEqual(p.tqRpm - step);
      expect(peaks.torqueOmega / RPM).toBeLessThanOrEqual((p.tqRpmHigh ?? p.tqRpm) + step);

      // Every 5 rpm from idle to redline at full throttle: nothing beats either published figure, and the best of each
      // sits where the maker says (or on the maker's plateau).
      let best = 0, bestRpm = 0, most = 0, mostRpm = 0;
      for (let rpm = s.idle / RPM; rpm <= p.redline; rpm += 5) {
        const t = full(e, rpm), pw = t * rpm * RPM;
        expect(t).toBeLessThanOrEqual(s.peakTorque * 1.005);
        expect(pw).toBeLessThanOrEqual(s.peakPower * 1.005);
        if (t > best + 1e-9) { best = t; bestRpm = rpm; }
        if (pw > most) { most = pw; mostRpm = rpm; }
      }
      expect(Math.abs(mostRpm - p.hpRpm)).toBeLessThanOrEqual(step);
      expect(bestRpm).toBeGreaterThanOrEqual(p.tqRpm - step);
      expect(bestRpm).toBeLessThanOrEqual((p.tqRpmHigh ?? p.tqRpm) + step);

      // The table: 64 to 96 points from 0, reaching past redline and the limiter band.
      expect(e.n).toBeGreaterThanOrEqual(64);
      expect(e.n).toBeLessThanOrEqual(96);
      expect((e.n - 1) * e.dOmega).toBeGreaterThan(e.redline + e.limiterBand);
    });
  }

  it('an unboosted engine pulls about 60% of its peak torque at idle, a turbocharged one under half', () => {
    const na = buildEngine(spec(SMALL_FOUR)), turbo = buildEngine(spec(TURBO_FOUR));
    expect(full(na, 750) / (SMALL_FOUR.lbft * LBFT)).toBeCloseTo(0.6, 1);
    expect(full(turbo, 750) / (TURBO_FOUR.lbft * LBFT)).toBeLessThan(0.5);
    // ...and by 1,500 rpm the turbo four's boost is up: well past the unboosted four, which is still climbing.
    expect(full(turbo, 1500) / (TURBO_FOUR.lbft * LBFT)).toBeGreaterThan(0.85);
    expect(full(na, 1500) / (SMALL_FOUR.lbft * LBFT)).toBeLessThan(0.9);
  });
});

describe('the air model', () => {
  it('a stock engine put through rebuildTables gives back its tables and its published curve', () => {
    for (const p of [...PUBLISHED, BLOWN_V8]) {
      const s = spec(p), e = buildEngine(s);
      const wot = Float64Array.from(e.wot), off = Float64Array.from(e.offBoost), fr = Float64Array.from(e.friction);
      e.wot.fill(NaN); e.offBoost.fill(NaN); e.friction.fill(NaN);
      rebuildTables(e);
      for (let i = 0; i < e.n; i++) {
        expect(Math.abs(e.wot[i] - wot[i])).toBeLessThanOrEqual(1e-3 * Math.abs(wot[i]));
        expect(Math.abs(e.offBoost[i] - off[i])).toBeLessThanOrEqual(1e-3 * Math.abs(off[i]));
        expect(Math.abs(e.friction[i] - fr[i])).toBeLessThanOrEqual(1e-3 * Math.abs(fr[i]));
        // Stock airflow and knock limits must not bite: the boost divided out and multiplied back in is the curve.
        const target = targetTorque(s, i * e.dOmega);
        expect(Math.abs(e.wot[i] - target)).toBeLessThanOrEqual(1e-3 * Math.abs(target));
      }
      // A part that lifts the breathing 10% lifts mid-range torque by more (friction stays); taking it off restores it.
      const mid = Math.round(0.5 * (s.peakTorqueOmegaLow + s.peakPowerOmega) / e.dOmega);
      for (let i = 0; i < e.n; i++) e.air!.specific[i] *= 1.1;
      rebuildTables(e);
      expect(e.wot[mid] / wot[mid]).toBeGreaterThan(1.1);
      for (let i = 0; i < e.n; i++) e.air!.specific[i] /= 1.1;
      rebuildTables(e);
      for (let i = 0; i < e.n; i++) expect(Math.abs(e.wot[i] - wot[i])).toBeLessThanOrEqual(1e-3 * Math.abs(wot[i]));
    }
  });

  it('25% more pressure ratio gives a turbo engine about 25% more mid-range torque; an unboosted engine has no boost to raise', () => {
    const six = buildEngine(spec(FLAT_SIX));
    const before = full(six, 3500);
    raiseBoost(six, 1.25);                      // 2.02 -> 2.53: still under pump fuel's knock limit
    rebuildTables(six);
    const gain = full(six, 3500) / before - 1;
    expect(gain).toBeGreaterThan(0.15);
    expect(gain).toBeLessThan(0.3);

    const four = buildEngine(spec(SMALL_FOUR));
    expect(Array.from(four.air!.pressureRatio).every((x) => x === 1)).toBe(true);
    const wot = Float64Array.from(four.wot);
    raiseBoost(four, 1.25);
    rebuildTables(four);
    expect(Array.from(four.wot)).toEqual(Array.from(wot));
  });

  it('a maxAirflow below what the engine needs flattens its power at that airflow', () => {
    const e = buildEngine(spec(V8));
    const stock = Float64Array.from(e.wot);
    const stockPeak = enginePeaks(e).power;
    // kg/s: 322 kW of indicated work, four fifths of the 408 kW this engine makes indicated at its power peak (its
    // 362 kW at the crank and 1.5 bar of friction).
    const limit = 0.28;
    e.air!.maxAirflow = limit;
    rebuildTables(e);
    let flat = 0;
    for (let i = 1; e.dOmega * i <= e.redline; i++) {
      const w = i * e.dOmega, indicated = (e.wot[i] + e.friction[i]) * w, stockIndicated = (stock[i] + e.friction[i]) * w;
      expect(indicated).toBeLessThanOrEqual(limit * AIR_ENERGY * (1 + 1e-12));
      if (stockIndicated > limit * AIR_ENERGY) { expect(indicated).toBeCloseTo(limit * AIR_ENERGY, 6); flat++; }
      else expect(e.wot[i]).toBe(stock[i]);
    }
    expect(flat).toBeGreaterThan(10);            // the top end is held, the bottom end is untouched
    const after = enginePeaks(e);
    expect(after.torque).toBeCloseTo(V8.lbft * LBFT, 6);
    expect(after.power).toBeLessThan(0.9 * stockPeak);
    expect(after.power).toBeLessThan(limit * AIR_ENERGY);
  });

  it('pressure ratio above knockLimitPr is not used', () => {
    const capped = buildEngine(spec(TURBO_FOUR)), atLimit = buildEngine(spec(TURBO_FOUR));
    expect(capped.air!.knockLimitPr).toBeCloseTo(2.6, 6);
    const stock = full(capped, 3000);
    raiseBoost(capped, 3.2 / (1 + 21 * PSI / 101325));     // full boost 2.43 -> 3.2
    raiseBoost(atLimit, 2.6 / (1 + 21 * PSI / 101325));    // full boost 2.43 -> 2.6, the limit
    rebuildTables(capped); rebuildTables(atLimit);
    expect(full(capped, 3000)).toBeCloseTo(full(atLimit, 3000), 9);
    expect(full(capped, 3000)).toBeGreaterThan(stock);
    // Race fuel lifts the limit to 3.3, and then the same boost is worth much more.
    capped.air!.knockLimitPr = 3.3;
    rebuildTables(capped);
    expect(full(capped, 3000) / full(atLimit, 3000)).toBeGreaterThan(1.15);
  });
});

describe('boost', () => {
  it('builds more slowly at 2000 rpm than at 5000 and falls quickly on a lifted throttle', () => {
    const e = buildEngine(spec(TURBO_FOUR));
    const at2000 = boostTime(e, 2000, 1, 0, 0.9), at5000 = boostTime(e, 5000, 1, 0, 0.9);
    expect(at2000).toBeGreaterThan(1.2);         // about 1.5 s of lag at 2000 rpm
    expect(at2000).toBeLessThan(2.0);
    expect(at5000).toBeGreaterThan(0.4);         // about 0.6 s at 5000
    expect(at5000).toBeLessThan(0.8);
    expect(at2000 / at5000).toBeGreaterThan(2);
    expect(boostTime(e, 3000, 0, 1, 0.1)).toBeLessThan(0.4);   // a blow-off valve dumps it in a third of a second
    // Half a second after flooring it at 2000 rpm the car has well under full torque.
    let b = 0;
    for (let t = 0; t < 0.5; t += H) b = boostStep(e, b, 2000 * RPM, 1, H);
    expect(engineTorque(e, 2000 * RPM, 1, b)).toBeLessThan(0.8 * full(e, 2000));
    // Held long enough, full throttle makes exactly the full-throttle curve, also where boost is still building.
    for (const rpm of [1200, 1500, 3000]) {
      let s = 0;
      for (let t = 0; t < 15; t += H) s = boostStep(e, s, rpm * RPM, 1, H);
      expect(engineTorque(e, rpm * RPM, 1, s)).toBeCloseTo(full(e, rpm), 2);
    }
  });

  it('off boost a turbo engine makes clearly less torque than on boost: about what an unboosted engine of its size makes', () => {
    for (const [p, lo, hi] of [[TURBO_FOUR, 120, 220], [FLAT_SIX, 170, 300], [TRUCK_V6, 230, 380]] as const) {
      const e = buildEngine(spec(p));
      const on = engineTorque(e, 3000 * RPM, 1, 1), off = engineTorque(e, 3000 * RPM, 1, 0);
      expect(off).toBeLessThan(0.6 * on);
      expect(off).toBeGreaterThan(lo);           // N m: 9 to 14 bar of brake mean effective pressure, unboosted
      expect(off).toBeLessThan(hi);
    }
    // Below its boost threshold (1350 rpm for a 3000 rpm torque peak) there is no boost to miss.
    const truck = buildEngine(spec(TRUCK_V6));
    expect(engineTorque(truck, 1200 * RPM, 1, 0)).toBe(engineTorque(truck, 1200 * RPM, 1, 1));
  });

  it('a supercharger has no lag: its boost is there whatever the boost state', () => {
    const e = buildEngine(spec(BLOWN_V8));
    expect(e.boost).toBeNull();
    expect(engineTorque(e, 2000 * RPM, 1, 0)).toBe(engineTorque(e, 2000 * RPM, 1, 1));
    expect(boostStep(e, 0, 2000 * RPM, 1, H)).toBe(1);
  });
});

describe('closed throttle, limiter and idle', () => {
  it('closed-throttle torque is negative and about three times larger for a 6.2 L engine than a 2.0 L one', () => {
    const small = engineTorque(buildEngine(spec(SMALL_FOUR)), 3000 * RPM, 0, 0);
    const big = engineTorque(buildEngine(spec(PUSHROD_V8)), 3000 * RPM, 0, 0);
    expect(small).toBeLessThan(-25);             // about 35 N m of engine braking from a 2.0 L at 3000 rpm
    expect(small).toBeGreaterThan(-50);
    expect(big).toBeLessThan(small);
    expect(big / small).toBeGreaterThan(2.8);    // displacement ratio 3.1
    expect(big / small).toBeLessThan(3.4);
  });

  it('traction control\'s cut is a share of the drive: throttleForShare finds the throttle that makes that share of the torque', () => {
    for (const p of [SMALL_FOUR, TURBO_FOUR, PUSHROD_V8]) {
      const e = buildEngine(spec(p));
      for (const rpm of [2000, 3000, 5000]) {
        for (const th of [0.6, 1]) {
          for (const share of [0.25, 0.5, 0.9]) {
            const w = rpm * RPM, out = throttleForShare(e, w, 1, th, share);
            expect(engineTorque(e, w, out, 1), `${p.name} ${rpm} ${th} ${share}`).toBeCloseTo(share * engineTorque(e, w, th, 1), 6);
            // The drag in the way means a share of the drive takes more than that share of the pedal.
            expect(out).toBeGreaterThan(share * th);
          }
        }
      }
    }
  });

  it('on the overrun the engine pumps against the manifold vacuum: 68 to 81 kPa of mean pressure on top of its friction', () => {
    // A closed throttle holds the manifold 20 to 24 inHg below the air outside on the overrun (18 to 22 at idle):
    // each intake stroke pulls against that, which is the main part of a petrol engine's engine braking.
    for (const p of [SMALL_FOUR, PUSHROD_V8]) {
      const e = buildEngine(spec(p));
      for (const rpm of [2000, 3000, 5000]) {
        const i = Math.round(rpm * RPM / e.dOmega), w = i * e.dOmega;
        const pumping = -engineTorque(e, w, 0, 0) - e.friction[i];
        const mep = pumping * 4 * Math.PI / e.displacement;
        expect(mep, `${p.name} at ${rpm} rpm`).toBeGreaterThan(68e3);
        expect(mep, `${p.name} at ${rpm} rpm`).toBeLessThan(81e3);
      }
    }
  });

  it('past redline the full-throttle torque fades to nothing within limiterBand', () => {
    for (const p of PUBLISHED) {
      const e = buildEngine(spec(p));
      const band = e.limiterBand / RPM;
      expect(band).toBeGreaterThanOrEqual(100);  // a few hundred rpm, as a fuel-cut limiter does it
      expect(band).toBeLessThanOrEqual(300);
      const atRed = full(e, p.redline);
      expect(atRed).toBeGreaterThan(0.5 * p.lbft * LBFT);
      expect(full(e, p.redline + band / 2) / atRed).toBeGreaterThan(0.4);
      expect(full(e, p.redline + band / 2) / atRed).toBeLessThan(0.6);
      expect(full(e, p.redline + band)).toBeCloseTo(0, 9);
      expect(full(e, p.redline + band + 300)).toBe(0);
      let last = atRed;
      for (let rpm = p.redline + 10; rpm <= p.redline + band; rpm += 10) { const t = full(e, rpm); expect(t).toBeLessThanOrEqual(last); last = t; }
    }
  });

  it('a free engine with no throttle settles at idle, from above and from below', () => {
    for (const p of [SMALL_FOUR, TURBO_FOUR, PUSHROD_V8]) {
      const e = buildEngine(spec(p));
      for (const startRpm of [3000, 300]) {
        let w = startRpm * RPM;
        for (let t = 0; t < 5; t += H) w += engineTorque(e, w, 0, 0) * H / e.inertia;
        expect(Math.abs(w / e.idle - 1)).toBeLessThan(0.01);
      }
    }
  });

  it('part throttle scales smoothly between closed-throttle drag and full torque', () => {
    for (const p of [SMALL_FOUR, TURBO_FOUR]) {
      const e = buildEngine(spec(p)), w = 3000 * RPM;
      const closed = engineTorque(e, w, 0, 1), open = engineTorque(e, w, 1, 1);
      expect(closed).toBeLessThan(0);
      let last = closed, biggest = 0;
      for (let k = 1; k <= 100; k++) {
        const t = engineTorque(e, w, k / 100, 1);
        expect(t).toBeGreaterThan(last);
        biggest = Math.max(biggest, t - last);
        last = t;
      }
      expect(last).toBe(open);
      expect(biggest).toBeLessThan(0.015 * (open - closed));   // no step anywhere: 1% of pedal is about 1% of the range
    }
  });
});

describe('an electric motor: 350 kW, 660 N m, 18,000 rpm', () => {
  const e = buildEngine(ELECTRIC);

  it('has flat torque to its base speed, then constant power, tapering out at its top speed', () => {
    expect(e.air).toBeNull();
    for (let rpm = 0; rpm <= 5000; rpm += 250) expect(relErr(engineTorque(e, rpm * RPM, 1, 0), 660)).toBeLessThan(0.005);
    for (let rpm = 5300; rpm <= 16000; rpm += 250) expect(relErr(kw(e, rpm), 350)).toBeLessThan(0.01);
    expect(kw(e, 17500)).toBeLessThan(150);
    expect(full(e, 18000)).toBeCloseTo(0, 9);
    const peaks = enginePeaks(e);
    expect(relErr(peaks.power, 350e3)).toBeLessThan(0.005);
    expect(relErr(peaks.torque, 660)).toBeLessThan(0.005);
    expect(e.n).toBeGreaterThanOrEqual(64);
    expect(e.n).toBeLessThanOrEqual(96);
    expect((e.n - 1) * e.dOmega).toBeGreaterThan(e.redline + e.limiterBand);
  });

  it('regenerates on a lifted throttle, fading out toward standstill', () => {
    const regen = engineTorque(e, 9000 * RPM, 0, 0);
    expect(regen).toBeLessThan(-0.1 * 660);      // a 0.1 to 0.3 g lift-off in a typical single-speed EV
    expect(regen).toBeGreaterThan(-0.3 * 660);
    expect(Math.abs(engineTorque(e, 50 * RPM, 0, 0))).toBeLessThan(0.02 * 660);
    expect(engineTorque(e, 0, 0, 0)).toBeCloseTo(0, 12);   // no creep backwards at a standstill
    // Half throttle is halfway between regeneration and full drive.
    expect(engineTorque(e, 9000 * RPM, 0.5, 0)).toBeCloseTo(0.5 * (regen + full(e, 9000)), 9);
  });
});

describe('a spec that cannot be built', () => {
  it('is refused at once when its peak torque or power is not a positive number, rather than hanging or making NaN', () => {
    for (const bad of [0, -100, NaN, Infinity]) {
      expect(() => buildEngine({ ...spec(SMALL_FOUR), peakTorque: bad }), `peak torque ${bad}`).toThrow(/peak torque/);
      expect(() => buildEngine({ ...spec(SMALL_FOUR), peakPower: bad }), `peak power ${bad}`).toThrow(/peak power/);
      expect(() => buildEngine({ ...ELECTRIC, peakTorque: bad }), `electric, peak torque ${bad}`).toThrow(/peak torque/);
    }
    // An authored curve stands in for the peaks, so they are not needed.
    const curve: [number, number][] = [[1000 * RPM, 180], [4000 * RPM, 260], [6500 * RPM, 210]];
    expect(() => buildEngine({ ...spec(SMALL_FOUR), peakTorque: 0, peakPower: 0, curve })).not.toThrow();
  });
});

describe('an authored curve', () => {
  it('is used as given, with no air model for a part to rebuild', () => {
    const curve: [number, number][] = [[1000 * RPM, 180], [4000 * RPM, 260], [6500 * RPM, 210]];
    const s: EngineSpec = { ...spec(SMALL_FOUR), curve };
    const e = buildEngine(s);
    expect(e.air).toBeNull();
    expect(relErr(full(e, 4000), 260)).toBeLessThan(0.005);   // the knee, read through the table's 75 rpm steps
    expect(full(e, 2500)).toBeCloseTo(220, 9);
    const before = Float64Array.from(e.wot);
    rebuildTables(e);
    expect(Array.from(e.wot)).toEqual(Array.from(before));
  });
});

describe('closed-throttle drag', () => {
  it('opposes the way the shaft turns: none at a standstill, a push forward when it is turned backward', () => {
    // A motor whose drag table does not fade to zero at rest (a hand-built model, as fixtures.ts makes): before, its
    // 18 N m of drag at 0 rad/s turned a car parked with nothing pressed backward without end.
    const motor: EngineModel = { ...buildEngine(spec(SMALL_FOUR)), kind: 'electric', idle: 0, displacement: 0 };
    motor.friction = Float64Array.from(motor.friction, () => 18);
    expect(engineTorque(motor, 0, 0, 0)).toBe(0);
    expect(engineTorque(motor, -20, 0, 0)).toBeCloseTo(18, 9);
    expect(engineTorque(motor, 20, 0, 0)).toBeCloseTo(-18, 9);
    // All of the drag from half a radian a second (far below any idle), so an engine turning at all is unchanged.
    expect(engineTorque(motor, 0.5, 0, 0)).toBeCloseTo(-18, 9);
    expect(engineTorque(motor, 0.25, 0, 0)).toBeCloseTo(-9, 9);
    const e = buildEngine(spec(SMALL_FOUR));
    expect(-engineTorque(e, 3000 * RPM, 0, 0)).toBeGreaterThan(20);
  });
});

describe('stock charge air comes from the class tables (rule 2)', () => {
  it('a turbo breathes through classes.ts\'s intercooler and compressor; a supercharger through its smaller cooler and its blower drive', async () => {
    const { CHARGE_AIR, COMPRESSOR_EFFICIENCY, KNOCK_LIMIT_PR } = await import('./classes');
    const turbo = buildEngine(spec(TURBO_FOUR)).air as NonNullable<EngineModel['air']>;
    expect(turbo.intercooler).toBe(CHARGE_AIR.turbo.intercooler);
    expect(turbo.compressorEff).toBe(COMPRESSOR_EFFICIENCY);
    expect(turbo.blowerDrive).toBe(CHARGE_AIR.turbo.blowerDrive);
    const blown = buildEngine(spec(BLOWN_V8)).air as NonNullable<EngineModel['air']>;
    expect(blown.intercooler).toBe(CHARGE_AIR.supercharged.intercooler);   // 0.60: packed in the engine's valley
    expect(blown.compressorEff).toBe(COMPRESSOR_EFFICIENCY);
    expect(blown.blowerDrive).toBe(CHARGE_AIR.supercharged.blowerDrive);
    expect(turbo.knockLimitPr).toBeGreaterThanOrEqual(KNOCK_LIMIT_PR);
    // The full-throttle curve the maker published still comes out: the cooler only changes what a part works on.
    const p = enginePeaks(buildEngine(spec(BLOWN_V8)));
    expect(relErr(p.power / HP, BLOWN_V8.hp)).toBeLessThan(0.005);
  });
  it('a petrol engine\'s friction is classes.ts\'s FMEP.petrol, so the class table is the one place it is tuned', async () => {
    const { FMEP } = await import('./classes');
    for (const p of [SMALL_FOUR, TURBO_FOUR, PUSHROD_V8]) {
      const e = buildEngine(spec(p));
      expect((e.air as NonNullable<EngineModel['air']>).fmep).toEqual([...FMEP.petrol]);
      // Near 6,000 rpm: the friction torque is that mean pressure over the displacement, V fmep / (4 pi).
      const i = Math.round(6000 * RPM / e.dOmega), x = i * e.dOmega / (1000 * RPM);
      const at = FMEP.petrol[0] + FMEP.petrol[1] * x + FMEP.petrol[2] * x * x;
      expect(e.friction[i]).toBeCloseTo(at * e.displacement / (4 * Math.PI), 6);
    }
  });
});
