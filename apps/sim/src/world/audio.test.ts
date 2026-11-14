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
    audioWorklet = { addModule: () => Promise.resolve() };
    /** Every analyser made, with the sample value it reads back. */
    analysers: { fill: number; fftSize: number; connect: () => void; disconnect: () => void; getFloatTimeDomainData: (b: Float32Array) => void }[] = [];
    constructor() { made.push(this); }
    createAnalyser() { const a = { fill: 0, fftSize: 2048, connect() {}, disconnect() {}, getFloatTimeDomainData(b: Float32Array) { b.fill(a.fill); } }; this.analysers.push(a); return a; }
    resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.closed++; this.state = 'closed'; return Promise.resolve(); }
    createBuffer() { return { getChannelData: () => new Float32Array(8) }; }
    createGain() { const g = node() as { disconnect: () => void; cut: number }; const m = { cut: 0, gain: { value: 0, setTargetAtTime() {}, setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d: unknown) => d, disconnect: () => { m.cut++; } }; this.masters.push(m); void g; return m; }
    createOscillator() { return node(); } createBiquadFilter() { return node(); } createBufferSource() { return node(); }
  }
  const G = globalThis as unknown as { AudioContext?: unknown; AudioWorkletNode?: unknown };
  const withFake = () => { made.length = 0; G.AudioContext = FakeCtx; };
  afterEach(() => { delete G.AudioContext; delete G.AudioWorkletNode; });
  /** The engine model's node: its port is what the processor talks to the page through. */
  const ports: { onmessage: ((e: { data: unknown }) => void) | null }[] = [];
  const withWorklet = () => {
    ports.length = 0;
    G.AudioWorkletNode = class { port = { onmessage: null, postMessage() {} }; parameters = new Map(); constructor() { ports.push(this.port); } connect(d: unknown) { return d; } disconnect() {} };
  };
  const modelStarted = () => new Promise(r => setTimeout(r, 0));

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
  // ?audiodebug, for a phone with no console: where does the sound stop?
  it('the debug line counts the engine model starting afresh after a sample that was not a number', async () => {
    withFake(); withWorklet();
    const a = new Audio(false, 'model'); a.setCar(soundFactsFor({ engine: '2.0L I4 Turbo', bodyStyle: 'coupe', redline: 7000 })); a.resume();
    try {
      await modelStarted();
      expect(a.modelActive).toBe(true);
      expect(a.debugLine()).toContain('resets=0');
      ports[0].onmessage?.({ data: { resets: 2 } });
      expect(a.debugLine()).toContain('resets=2');
    } finally { a.dispose(); }
  });
  it('the debug line says NaN when what reaches the speakers is not a number', () => {
    withFake(); const a = new Audio(false, 'classic'); a.resume();
    try {
      a.debugLine();
      for (const an of made[0].analysers) an.fill = NaN;
      expect(a.debugLine()).toMatch(/out NaN/);
    } finally { a.dispose(); }
  });
  it('the debug line gives the engine\'s level and the whole output\'s level', async () => {
    withFake(); withWorklet();
    const a = new Audio(false, 'model'); a.setCar(soundFactsFor({ engine: '2.0L I4 Turbo', bodyStyle: 'coupe', redline: 7000 })); a.resume();
    try {
      await modelStarted();
      a.debugLine();
      for (const an of made[0].analysers) an.fill = 0.125;   // -18 dB
      const line = a.debugLine();
      expect(line).toMatch(/engine -18dB/);
      expect(line).toMatch(/out -18dB/);
      for (const an of made[0].analysers) an.fill = 0;
      expect(a.debugLine()).toMatch(/engine silent.*out silent/);
    } finally { a.dispose(); }
  });
  // On an iPhone a freeze of the output's clock of about 2 s, while it says 'running', can leave every sound silent for good
  // after the clock moves again (WebKit's hand-over to its GPU process falls behind and never catches up). The health watch
  // forgets a freeze once the clock moves; the debug line keeps the longest one.
  it('the debug line keeps the longest freeze of the output\'s clock while running, once the clock has started', () => {
    withFake(); const clock = { t: 0 }, a = new Audio(false, 'classic'); (a as unknown as { clock: () => number }).clock = () => clock.t;
    a.resume();
    const V = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF));
    const frames = (n: number, moving: boolean) => { for (let i = 0; i < n; i++) { clock.t += 100; if (moving) made[0].currentTime += 0.1; a.engine(V, 10, true); } };
    try {
      frames(15, false);                         // starting up: 1.5 s before the clock first moves, not a freeze
      frames(10, true);
      expect(a.debugLine()).toContain('froze 0.0s');
      frames(24, false);                         // 2.4 s standing still while 'running'
      frames(10, true);                          // and moving again: the watch says ok
      expect(a.health()).toBe('ok');
      frames(5, false); frames(10, true);        // a shorter one later does not replace it
      expect(a.debugLine()).toContain('froze 2.4s');
      made[0].state = 'suspended'; frames(40, false); made[0].state = 'running'; frames(10, true);   // suspended is not a freeze
      expect(a.debugLine()).toContain('froze 2.4s');
    } finally { a.dispose(); }
  });
  it('after everything is closed, the next Audio starts a fresh output', () => {
    withFake(); const a = new Audio(false, 'classic'); a.resume(); a.dispose();
    const b = new Audio(false, 'classic'); b.resume();
    expect(made.length).toBe(2); b.dispose();
  });
});
