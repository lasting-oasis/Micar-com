import { describe, expect, it } from 'vitest';
import { EngineSound } from './engineSound';
import { orderDb, rmsDb } from './orders';
import type { EngineFacts, ExhaustFacts, SoundFacts } from './facts';

const SR = 48000;
const engine = (o: Partial<EngineFacts>): EngineFacts => ({ cylinders: 4, layout: 'inline', crank: null, displacementL: 2, induction: 'na', ...o });
const exhaust = (o: Partial<ExhaustFacts>): ExhaustFacts => ({ layout: 'single', crossover: 0, runnerM: [0.4, 0.4], branchM: [0.6, 0.6], pipeM: 3, pipeDiaMm: 60, muffler: 'chambered', overrunPops: false, ...o });
const facts = (e: Partial<EngineFacts>, x: Partial<ExhaustFacts> = {}, more: Partial<SoundFacts> = {}): SoundFacts =>
  ({ engine: engine(e), exhaust: exhaust(x), redline: 7000, basis: { engine: 'class', exhaust: 'class' }, ...more });

type Drive = { rpm?: number; throttle?: number; load?: number; boost?: number; cut?: number };
type Mix = { exhaustGain: number; intakeGain: number; bayGain: number };
const EXHAUST: Mix = { exhaustGain: 1, intakeGain: 0, bayGain: 0 }, INTAKE: Mix = { exhaustGain: 0, intakeGain: 1, bayGain: 0 };
/** Render `seconds` after a one second warm-up at a steady state; returns the left and right channels. The pipe tests listen to the exhaust alone. */
function render(f: SoundFacts, d: Drive, seconds = 2, spread = 1, mix: Mix = EXHAUST): [Float32Array, Float32Array] {
  const s = new EngineSound(f, SR, { seed: 7, spread });
  Object.assign(s, { rpm: 3000, throttle: 1, load: 1, boost: 0, cut: 0, ...d, ...mix });
  const warm = new Float32Array(SR); s.render(warm, new Float32Array(SR));
  const L = new Float32Array(SR * seconds), R = new Float32Array(SR * seconds); s.render(L, R);
  return [L, R];
}
const V8 = { cylinders: 8, layout: 'v', displacementL: 5 } as const;

describe('EngineSound: what the firing pattern does', () => {
  it('an inline-four into one pipe is dominated by order 2, with no half orders', () => {
    const [L] = render(facts({}), {});
    const main = orderDb(L, SR, 3000, 2);
    for (const o of [0.5, 1, 1.5, 2.5]) expect(main - orderDb(L, SR, 3000, o)).toBeGreaterThan(20);
  });
  it('one bank pipe of a cross-plane V8 carries orders 1.5 and 2.5 near order 4, and none at 1 or 2: the burble', () => {
    const [L] = render(facts({ ...V8, crank: 'cross' }, { layout: 'dual' }), {});
    const at = (o: number) => orderDb(L, SR, 3000, o);
    expect(at(4) - Math.max(at(1.5), at(2.5))).toBeLessThan(10);
    for (const half of [1.5, 2.5]) for (const whole of [1, 2]) expect(at(half) - at(whole)).toBeGreaterThan(15);
  });
  it('merging the banks of a cross-plane V8 through equal pipes removes the burble', () => {
    const [L] = render(facts({ ...V8, crank: 'cross' }, { layout: 'merge' }), {});
    const main = orderDb(L, SR, 3000, 4);
    expect(main - orderDb(L, SR, 3000, 1.5)).toBeGreaterThan(20);
    expect(main - orderDb(L, SR, 3000, 2.5)).toBeGreaterThan(20);
  });
  it('unequal bank pipes before the join bring part of the burble back', () => {
    const eq = render(facts({ ...V8, crank: 'cross' }, { layout: 'merge' }), {})[0];
    const uneq = render(facts({ ...V8, crank: 'cross' }, { layout: 'merge', branchM: [0.5, 0.9] }), {})[0];
    expect(orderDb(uneq, SR, 3000, 2.5) - orderDb(eq, SR, 3000, 2.5)).toBeGreaterThan(10);
  });
  it('one bank pipe of a flat-plane V8 has order 2 and no half orders', () => {
    const [L] = render(facts({ ...V8, crank: 'flat' }, { layout: 'dual' }), {});
    const o2 = orderDb(L, SR, 3000, 2);
    expect(o2 - orderDb(L, SR, 3000, 1.5)).toBeGreaterThan(20);
    expect(o2 - orderDb(L, SR, 3000, 2.5)).toBeGreaterThan(20);
  });
  it('unequal runners on a flat-four raise the half orders by at least 10 dB: the rumble', () => {
    const eq = render(facts({ layout: 'flat', displacementL: 2.5 }), {})[0];
    const uneq = render(facts({ layout: 'flat', displacementL: 2.5 }, { runnerM: [0.3, 0.75] }), {})[0];
    expect(orderDb(uneq, SR, 3000, 2.5) - orderDb(eq, SR, 3000, 2.5)).toBeGreaterThan(10);
    expect(orderDb(uneq, SR, 3000, 3.5) - orderDb(eq, SR, 3000, 3.5)).toBeGreaterThan(10);
  });
  it('a stereo pair of dual pipes keeps each bank mostly on its own side', () => {
    const [L, R] = render(facts({ ...V8, crank: 'cross' }, { layout: 'dual' }), {}, 2, 0.7);
    let diff = 0; for (let i = 0; i < L.length; i++) diff += Math.abs(L[i] - R[i]);
    expect(diff / L.length).toBeGreaterThan(1e-4);
  });
});

describe('EngineSound: load, pipes and add-ons', () => {
  it('is louder at full load than at light load', () => {
    expect(rmsDb(render(facts({}), {})[0]) - rmsDb(render(facts({}), { throttle: 0.15, load: 0.1 })[0])).toBeGreaterThan(6);
  });
  it('idles with the pedal off: the engine keeps firing near idle speed', () => {
    const off = rmsDb(render(facts({}), { rpm: 800, throttle: 0, load: 0 })[0]);
    const cracked = rmsDb(render(facts({}), { rpm: 800, throttle: 0.08, load: 0.05 })[0]);
    expect(cracked - off).toBeLessThan(4);
  });
  it('on the overrun the exhaust is well down on full load but still there', () => {
    const full = rmsDb(render(facts({}), { rpm: 5000 })[0]);
    const lifted = rmsDb(render(facts({}), { rpm: 5000, throttle: 0, load: -0.5 })[0]);
    expect(full - lifted).toBeGreaterThan(12);
    expect(full - lifted).toBeLessThan(26);
  });
  it('coming down to idle with the pedal off never steps the level by more than 6 dB between 200 rpm steps', () => {
    let last = NaN;
    for (let rpm = 2600; rpm >= 800; rpm -= 200) {
      const db = rmsDb(render(facts({}), { rpm, throttle: 0, load: -0.2 }, 1)[0]);
      if (!Number.isNaN(last)) expect(Math.abs(db - last)).toBeLessThan(6);
      last = db;
    }
  });
  it('a cut engine (limiter, shift) is much quieter than a firing one', () => {
    expect(rmsDb(render(facts({}), {})[0]) - rmsDb(render(facts({}), { cut: 1 })[0])).toBeGreaterThan(10);
  });
  it('a chambered muffler is quieter than a straight pipe', () => {
    expect(rmsDb(render(facts({}, { muffler: 'none' }), {})[0]) - rmsDb(render(facts({}, { muffler: 'chambered' }), {})[0])).toBeGreaterThan(3);
  });
  it('a packed muffler takes more from the high orders than from the low ones', () => {
    const open = render(facts({}, { muffler: 'none' }), {})[0], packed = render(facts({}, { muffler: 'straight' }), {})[0];
    const lossAt = (o: number) => orderDb(open, SR, 3000, o) - orderDb(packed, SR, 3000, o);
    expect(lossAt(40) - lossAt(2)).toBeGreaterThan(6);
  });
  it('the intake is loud with the throttle open and nearly gone with it shut', () => {
    const open = render(facts({}), {}, 2, 1, INTAKE)[0], shut = render(facts({}), { throttle: 0.05, load: 0 }, 2, 1, INTAKE)[0];
    expect(rmsDb(open) - rmsDb(shut)).toBeGreaterThan(30);
  });
  it('a supercharger adds a whine at its lobe order', () => {
    const f = facts({ ...V8, crank: 'cross', induction: 'super' }, { layout: 'dual' });
    const plain = render(f, {})[0], blown = render({ ...f, blowerOrder: 18.4 }, {})[0];
    expect(orderDb(blown, SR, 3000, 18.4) - orderDb(plain, SR, 3000, 18.4)).toBeGreaterThan(10);
  });
  it('a turbo softens the exhaust at the same load', () => {
    expect(rmsDb(render(facts({}), {})[0]) - rmsDb(render(facts({ induction: 'turbo' }), {})[0])).toBeGreaterThan(2);
  });
  it('pops on the overrun only when the car leaves fuel in', () => {
    const liftOff = (pops: boolean) => {
      const s = new EngineSound(facts({ ...V8, crank: 'cross' }, { layout: 'dual', overrunPops: pops }), SR, { seed: 3, spread: 1 });
      Object.assign(s, { rpm: 5500, throttle: 1, load: 1 });
      const buf = new Float32Array(SR * 2), r = new Float32Array(SR * 2); s.render(buf, r);
      Object.assign(s, { throttle: 0, load: -0.3 }); s.render(buf, r);
      let peak = 0; for (let i = SR / 2; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
      return peak;
    };
    expect(liftOff(true)).toBeGreaterThan(liftOff(false) * 2);
  });
});

describe('EngineSound: safety and cost', () => {
  it('stays finite and inside -1..1 for twenty seconds of random driving', () => {
    const s = new EngineSound(facts({ ...V8, crank: 'cross', induction: 'turbo' }, { layout: 'dual', crossover: 0.25, overrunPops: true }, { blowerOrder: 18.4 }), SR, { seed: 11 });
    const L = new Float32Array(128), R = new Float32Array(128);
    let bad = 0, x = 12345; const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let q = 0; q < 20 * SR / 128; q++) {
      if (q % 20 === 0) Object.assign(s, { rpm: rnd() * 9000, throttle: rnd(), load: rnd() * 2 - 1, boost: rnd(), cut: rnd() > 0.8 ? 1 : 0 });
      s.render(L, R);
      for (let i = 0; i < 128; i++) if (!(Math.abs(L[i]) <= 1 && Math.abs(R[i]) <= 1)) bad++;
    }
    expect(bad).toBe(0);
  });
  it('falls silent when the engine stops', () => {
    const s = new EngineSound(facts({}), SR, { seed: 1 });
    Object.assign(s, { rpm: 3000, throttle: 1, load: 1 });
    const L = new Float32Array(SR), R = new Float32Array(SR); s.render(L, R);
    s.rpm = 0; s.throttle = 0; s.load = 0; s.render(L, R); s.render(L, R);
    expect(rmsDb(L.subarray(SR / 2))).toBeLessThan(-80);
  });
  it('renders a V8 with dual pipes at least five times faster than real time', () => {
    const s = new EngineSound(facts({ ...V8, crank: 'cross' }, { layout: 'dual', crossover: 0.25 }), SR, { seed: 1 });
    Object.assign(s, { rpm: 6000, throttle: 1, load: 1 });
    const L = new Float32Array(128), R = new Float32Array(128);
    for (let q = 0; q < 2 * SR / 128; q++) s.render(L, R); // warm the JIT
    const t0 = performance.now();
    for (let q = 0; q < 10 * SR / 128; q++) s.render(L, R);
    const ms = performance.now() - t0;
    console.log(`engine sound: 10 s of V8 audio in ${ms.toFixed(0)} ms (${(ms / 100).toFixed(2)}% of one core here)`);
    expect(ms).toBeLessThan(2000);
  });
});
