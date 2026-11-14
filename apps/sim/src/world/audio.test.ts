import { afterEach, describe, expect, it } from 'vitest';
import { Audio, engineDrive, soundMode } from './audio';
import { soundFactsFor } from '../sound/carSound';
import { carParams, makeVehicle } from './physics';
import { ARCHETYPES, STOCK_CFG, TUNE_DEF } from './data';

describe('Audio', () => {
  it('is a no-op before resume and where there is no AudioContext (node)', () => {
    const a = new Audio(); const V = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF));
    expect(() => { a.sfx('horn'); a.engine(V, 10, true); a.resume(); a.sfx('crash'); a.engine(V, 10, false); a.silence(); a.suspend(); a.setMute(true); a.dispose(); }).not.toThrow();
    expect(a.levels()).toEqual([]);
    expect(a.isMuted).toBe(true);
  });
});

describe('engine sound model wiring', () => {
  const car = () => makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF));
  it('is the default, and ?sound=classic brings the old synth back', () => {
    expect(soundMode('?sound=model')).toBe('model');
    expect(soundMode('?physics=core&sound=model')).toBe('model');
    expect(soundMode('')).toBe('model');
    expect(soundMode('?sound=loud')).toBe('model');
    expect(soundMode('?sound=classic')).toBe('classic');
    expect(soundMode('?physics=core&sound=classic')).toBe('classic');
  });
  it('passes rpm, throttle and boost through and reads load from the throttle', () => {
    const V = car(); V.rpm = 4200; V.thr = 0.6; V.boost = 0.4;
    expect(engineDrive(V)).toEqual({ rpm: 4200, throttle: 0.6, load: 0.6, boost: 0.4, cut: 0 });
  });
  it('reports engine braking as negative load on a closed throttle', () => {
    const V = car(); V.rpm = V.P.redline; V.thr = 0;
    expect(engineDrive(V).load).toBeLessThan(0);
  });
  it('cuts the firing during a shift, past the limiter and with a blown engine', () => {
    const a = car(); a.thr = 1; a.shift = 0.2; expect(engineDrive(a).cut).toBe(1);
    const b = car(); b.thr = 1; b.rpm = b.P.redline + 200; expect(engineDrive(b).cut).toBe(1);
    const c = car(); c.thr = 1; c.blown = true; expect(engineDrive(c).cut).toBe(1);
  });
  it('accepts a car before the sound is switched on', () => {
    const a = new Audio();
    expect(() => { a.setCar(soundFactsFor({ engine: '5.0L V8', bodyStyle: 'coupe', redline: 7000 })); a.setCar(null); }).not.toThrow();
  });
});

// A stand-in for the browser's audio: nodes accept anything, and the context counts what matters here.
describe('one audio output, and waking it', () => {
  const made: FakeCtx[] = [];
  const node = (): unknown => new Proxy(function () { /* callable */ } as object, {
    get: (t, k) => k === 'then' ? undefined : k === 'value' ? 0 : ((t as Record<string | symbol, unknown>)[k] ??= node()),
    set: (t, k, v) => { (t as Record<string | symbol, unknown>)[k] = v; return true; },
    apply: () => node(),
  });
  class FakeCtx {
    state = 'running'; currentTime = 0; sampleRate = 48000; destination = node(); resumed = 0; closed = 0; masters: { disconnect: () => void; cut: number }[] = [];
    constructor() { made.push(this); }
    resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.closed++; this.state = 'closed'; return Promise.resolve(); }
    createBuffer() { return { getChannelData: () => new Float32Array(8) }; }
    createGain() { const g = node() as { disconnect: () => void; cut: number }; const m = { cut: 0, gain: { value: 0, setTargetAtTime() {}, setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d: unknown) => d, disconnect: () => { m.cut++; } }; this.masters.push(m); void g; return m; }
    createOscillator() { return node(); } createBiquadFilter() { return node(); } createBufferSource() { return node(); }
  }
  const G = globalThis as unknown as { AudioContext?: unknown };
  const withFake = () => { made.length = 0; G.AudioContext = FakeCtx; };
  afterEach(() => { delete G.AudioContext; });

  it('wakes a context the phone has interrupted, not only one it suspended itself', () => {
    withFake(); const a = new Audio(false, 'classic'); a.resume();
    made[0].state = 'interrupted'; a.resume();
    expect(made[0].resumed).toBe(1);
    made[0].state = 'running'; a.resume(); expect(made[0].resumed).toBe(1);
    a.dispose();
  });
  it('the Garage menu shares the game\'s audio output: opening and closing it neither starts nor closes a second one', () => {
    withFake(); const world = new Audio(false, 'classic'); world.resume();
    const garage = new Audio(false); garage.resume(); garage.sfx('buy');
    expect(made.length).toBe(1);
    garage.dispose();
    expect(made[0].closed).toBe(0);
    world.dispose();
    expect(made[0].closed).toBe(1);
  });
  it('a closed menu takes its own sounds off the shared output', () => {
    withFake(); const world = new Audio(false, 'classic'); world.resume();
    const before = made[0].masters.length; const garage = new Audio(false); garage.resume();
    const mine = made[0].masters[before];   // the first gain an Audio makes is its master
    garage.dispose();
    expect(mine.cut).toBeGreaterThan(0);
    world.dispose();
  });
  const drive = (a: Audio, clock: { t: number }, seconds: number) => {
    const V = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF));
    for (let i = 0; i < seconds * 10; i++) { clock.t += 100; a.engine(V, 10, true); }
  };
  it('rebuilds the sound on the next tap when the output has stopped moving (a phone can leave it frozen)', () => {
    withFake(); const clock = { t: 0 }, a = new Audio(false, 'classic'); (a as unknown as { clock: () => number }).clock = () => clock.t;
    a.resume(); drive(a, clock, 3);              // currentTime never moves: the output is dead
    expect(a.health()).toBe('stalled');
    a.resume();
    expect(made.length).toBe(2); expect(made[0].closed).toBe(1);
    expect(a.health()).toBe('ok');
    a.dispose();
  });
  it('rebuilds on the next tap when the output stays interrupted', () => {
    withFake(); const clock = { t: 0 }, a = new Audio(false, 'classic'); (a as unknown as { clock: () => number }).clock = () => clock.t;
    a.resume(); made[0].resume = () => Promise.resolve();   // a phone that will not let it go
    made[0].state = 'interrupted'; drive(a, clock, 3);
    expect(a.health()).toBe('interrupted');
    a.resume();
    expect(made.length).toBe(2);
    a.dispose();
  });
  it('rebuilds on the next tap when something else has closed the output', () => {
    withFake(); const clock = { t: 0 }, a = new Audio(false, 'classic'); (a as unknown as { clock: () => number }).clock = () => clock.t;
    a.resume(); made[0].state = 'closed'; drive(a, clock, 0.2);
    expect(a.health()).toBe('closed');
    a.resume();
    expect(made.length).toBe(2); expect(a.health()).toBe('ok');
    a.dispose();
  });
  it('leaves a healthy output alone, however many taps', () => {
    withFake(); const clock = { t: 0 }, a = new Audio(false, 'classic'); (a as unknown as { clock: () => number }).clock = () => clock.t;
    a.resume();
    const V = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF));
    for (let i = 0; i < 30; i++) { clock.t += 100; made[0].currentTime += 0.1; a.engine(V, 10, true); a.resume(); }
    expect(a.health()).toBe('ok'); expect(made.length).toBe(1);
    a.dispose();
  });
  it('does not call a briefly slow output dead', () => {
    withFake(); const clock = { t: 0 }, a = new Audio(false, 'classic'); (a as unknown as { clock: () => number }).clock = () => clock.t;
    a.resume(); drive(a, clock, 0.8);
    expect(a.health()).toBe('ok');
    a.dispose();
  });
  it('after everything is closed, the next Audio starts a fresh output', () => {
    withFake(); const a = new Audio(false, 'classic'); a.resume(); a.dispose();
    const b = new Audio(false, 'classic'); b.resume();
    expect(made.length).toBe(2); b.dispose();
  });
});
