import { describe, it, expect } from 'vitest';
import {
  carParams,
  curveAt,
  makeVehicle,
  NO_INPUT,
  resetVehicle,
  simStats,
  stepVehicle,
  torqueAt,
  type PerfCfg,
  type Tune,
  type VehicleSpec,
} from './physics';
import { ARCHETYPES } from './data';

const ronin: VehicleSpec = {id:'ronin',name:'Ronin GT',drive:'RWD',mass:1340,a:1.28,b:1.32,h:.48,cd:.33,area:2.05,redline:7300,r:.32,fin:4.0,gears:[3.55,2.12,1.5,1.13,.9,.76],tq:[[1000,175],[2500,222],[4000,252],[5500,258],[6500,242],[7400,210]]};
const STOCK_PERF: PerfCfg = { engine: 0, ecu: 0, turbo: 0, trans: 0, susp: 0, nos: 0, tires: 0, brakes: 0, weight: 0 };
const TUNE_DEF: Tune = { turbo: 0, nitrous: 0, aero: 0, bias: 0, ride: 0, stiff: 0, steer: 0, gears: 0 };

describe('physics', () => {
  it('reversing with the wheel turned swings the car the opposite way to driving forward with it turned, as a real car does', () => {
    const turn = (dir: 'fwd' | 'back') => {
      const V = makeVehicle(carParams(ronin, STOCK_PERF, TUNE_DEF));
      for (let i = 0; i < 240; i++) stepVehicle(V, { ...NO_INPUT, [dir]: 1 }, 1 / 120, false);
      const h0 = V.h;
      for (let i = 0; i < 120; i++) stepVehicle(V, { ...NO_INPUT, [dir]: 1, steer: -1 }, 1 / 120, false);
      return V.h - h0;
    };
    const fwd = turn('fwd'), back = turn('back');
    expect(Math.abs(fwd)).toBeGreaterThan(.3);
    expect(Math.abs(back)).toBeGreaterThan(.3);
    expect(Math.sign(back)).toBe(-Math.sign(fwd));
  });
  it('interpolates the torque table', () => { expect(curveAt(ronin.tq, 1000)).toBe(175); expect(curveAt(ronin.tq, 3250)).toBeCloseTo(237, 0); expect(curveAt(ronin.tq, 9000)).toBe(210); });
  it('a stock Ronin does 0-100 between 5 and 9 s and tops out between 200 and 260 km/h', () => { const s = simStats(carParams(ronin, STOCK_PERF, TUNE_DEF)); expect(s.t100).toBeGreaterThan(5); expect(s.t100).toBeLessThan(9); expect(s.top).toBeGreaterThan(200); expect(s.top).toBeLessThan(260); expect(s.hp).toBeGreaterThan(200); });
  it('gripMul scales tire friction', () => { const m = carParams(ronin, STOCK_PERF, TUNE_DEF).mu; expect(carParams({ ...ronin, gripMul: .9 }, STOCK_PERF, TUNE_DEF).mu).toBeCloseTo(m * .9, 10); });
  it('tier-3 engine, ecu and turbo add at least 35% peak torque', () => { const P0 = carParams(ronin, STOCK_PERF, TUNE_DEF), P3 = carParams(ronin, { ...STOCK_PERF, engine: 3, ecu: 3, turbo: 3 }, TUNE_DEF); expect(torqueAt(P3, 5500, 1) / torqueAt(P0, 5500, 0)).toBeGreaterThan(1.35); });
  it('holding the throttle past the redline in manual blows the engine within 3 s', () => { const V = makeVehicle(carParams(ronin, STOCK_PERF, TUNE_DEF)); const I = { ...NO_INPUT, fwd: 1, manual: true }; for (let i = 0; i < 120 * 12; i++) stepVehicle(V, I, 1 / 120, false); expect(V.overRev).toBeGreaterThan(1.5); });
  it('a perfect shift is counted in the window', () => { const V = makeVehicle(carParams(ronin, STOCK_PERF, TUNE_DEF)); const I = { ...NO_INPUT, fwd: 1, manual: true }; let n = 0; for (let i = 0; i < 120 * 8; i++) { const up = V.rpm > V.P.redline * 0.92 && V.shift <= 0 && V.gear < 6; stepVehicle(V, { ...I, shiftUp: up }, 1 / 120, false); n = V.perfectN || 0; } expect(n).toBeGreaterThanOrEqual(2); });
  it('nitrous drains while firing and refills after', () => { const V = makeVehicle(carParams(ronin, { ...STOCK_PERF, nos: 2 }, TUNE_DEF)); const cap = V.P.nos.cap; for (let i = 0; i < 120; i++) stepVehicle(V, { ...NO_INPUT, fwd: 1, nos: true }, 1 / 120, false); expect(V.nos).toBeLessThan(cap); const low = V.nos; for (let i = 0; i < 120 * 30; i++) stepVehicle(V, { ...NO_INPUT, fwd: 0.2 }, 1 / 120, false); expect(V.nos).toBeGreaterThan(low); });
  it('resetVehicle zeroes motion and puts the car where asked', () => { const V = makeVehicle(carParams(ronin, STOCK_PERF, TUNE_DEF)); for (let i = 0; i < 240; i++) stepVehicle(V, { ...NO_INPUT, fwd: 1 }, 1 / 120, false); resetVehicle(V, 10, 20, 1); expect([V.x, V.z, V.h, V.u, V.gear]).toEqual([10, 20, 1, 0, 1]); });
});

describe('pulling away: the revs while the clutch slips', () => {
  const launchOf = (key: keyof typeof ARCHETYPES, seconds = 3) => {
    const V = makeVehicle(carParams(ARCHETYPES[key], STOCK_PERF, TUNE_DEF)), rpm: number[] = [], gear: number[] = [];
    for (let i = 0; i < 60 * seconds; i++) { stepVehicle(V, { ...NO_INPUT, fwd: 1 }, 1 / 60, false); rpm.push(V.rpm); gear.push(V.gear); }
    return { rpm, gear };
  };
  it('the revs never fall while the car pulls away in first gear at full throttle', () => {
    for (const k of Object.keys(ARCHETYPES) as (keyof typeof ARCHETYPES)[]) {
      const { rpm, gear } = launchOf(k);
      for (let i = 1; i < rpm.length && gear[i] === 1; i++) expect(rpm[i - 1] - rpm[i], `${k} at step ${i}`).toBeLessThan(30);
    }
  });
  it('a truck pulls away at lower revs than a sports car: each engine slips the clutch where its own torque is', () => {
    const at = (k: keyof typeof ARCHETYPES) => launchOf(k, 1).rpm[12];
    expect(at('sports') - at('truck')).toBeGreaterThan(500);
  });
  it('the revs climb through the launch instead of holding one speed', () => {
    for (const k of Object.keys(ARCHETYPES) as (keyof typeof ARCHETYPES)[]) {
      const { rpm } = launchOf(k, 1.5);   // a heavy van gathers speed slowly, so look over a second and more
      for (let i = 13; i < 90; i++) expect(rpm[i], `${k} at step ${i}`).toBeGreaterThan(rpm[i - 1]);
      expect(rpm[89] - rpm[12], k).toBeGreaterThan(150);
    }
  });
  it('lifting off in first gear lets the revs follow the wheels again', () => {
    const V = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_PERF, TUNE_DEF));
    for (let i = 0; i < 30; i++) stepVehicle(V, { ...NO_INPUT, fwd: 1 }, 1 / 60, false);
    for (let i = 0; i < 5; i++) stepVehicle(V, NO_INPUT, 1 / 60, false);
    const wheels = Math.abs(V.u / V.P.r * 60 / (2 * Math.PI) * V.P.gears[0] * V.P.fin);
    expect(Math.abs(V.rpm - Math.max(wheels, V.P.idle))).toBeLessThan(30); // the speed moves a little after the revs are read
  });
});
