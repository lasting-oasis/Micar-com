import { afterEach, describe, expect, it, vi } from 'vitest';
import { Audio, engineDrive, soundMode } from './audio';
import { soundFactsFor } from '../sound/carSound';
import type { SoundFacts } from '../sound/facts';
import { carParams, makeVehicle, NO_INPUT } from './physics';
import { ARCHETYPES, STOCK_CFG, TUNE_DEF, specFor } from './data';
import { Driver } from './driver';

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
  // The Garage swaps the car's Params and keeps its state: a boost left from the turbo it had made the
  // non-turbo model's firing and intake pulses up to 1.6 times as big.
  it('tells the sound no boost once the Garage has taken the turbo off, on the throttle or off it', () => {
    const spec = specFor({ make: 'Ford', model: 'Mustang', bodyStyle: 'coupe' });
    const maxed = { ...STOCK_CFG, perf: { engine: 3, ecu: 3, turbo: 3, trans: 3, susp: 3, nos: 3, tires: 3, brakes: 3, weight: 3 } as const };
    const d = new Driver(spec, { cfg: maxed, tune: TUNE_DEF }, { x: 0, z: 0, h: 0 });
    const opts = { drift: false, fuel: () => 50, burn: () => {}, collide: () => 0 };
    const full = { ...NO_INPUT, fwd: 1 };
    for (let i = 0; i < 6 * 60; i++) d.stepFrame(1 / 60, full, opts);
    expect(engineDrive(d.V).boost).toBeGreaterThan(0.9);   // spooled up
    d.rebuild(spec, { cfg: { ...maxed, perf: { ...maxed.perf, turbo: 0 } }, tune: TUNE_DEF });
    const told: number[] = [];
    for (let i = 0; i < 2 * 60; i++) { d.stepFrame(1 / 60, full, opts); told.push(engineDrive(d.V).boost); }
    for (let i = 0; i < 10 * 60; i++) { d.stepFrame(1 / 60, NO_INPUT, opts); told.push(engineDrive(d.V).boost); }
    expect(Math.max(...told)).toBe(0);
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
    /** The browser refuses to make a context: the constructor throws. */
    static refusing = false;
    /** The state a new context starts in: 'suspended' when made outside a tap the browser counts. */
    static startState = 'running';
    /** Whether resume() takes effect: not inside a tap an iPhone does not count (pointerdown). */
    static counted = true;
    state = FakeCtx.startState; currentTime = 0; sampleRate = 48000; destination = node(); resumed = 0; closed = 0; oscillators = 0; masters: { disconnect: () => void; cut: number }[] = [];
    audioWorklet = { addModule: () => Promise.resolve() };
    /** Every analyser made, with the sample value it reads back. */
    analysers: { fill: number; fftSize: number; from: unknown; connect: () => void; disconnect: () => void; getFloatTimeDomainData: (b: Float32Array) => void }[] = [];
    /** 'statechange' listeners: a real context fires the event on every change of state. */
    private onState: (() => void)[] = [];
    addEventListener(type: string, f: () => void) { if (type === 'statechange') this.onState.push(f); }
    removeEventListener(type: string, f: () => void) { if (type === 'statechange') this.onState = this.onState.filter(g => g !== f); }
    setState(s: string) { this.state = s; for (const f of this.onState) f(); }
    constructor() { if (FakeCtx.refusing) throw new Error('cannot make an AudioContext'); made.push(this); }
    createAnalyser() { const a = { fill: 0, fftSize: 2048, from: null as unknown, connect() {}, disconnect() {}, getFloatTimeDomainData(b: Float32Array) { b.fill(a.fill); } }; this.analysers.push(a); return a; }
    resume() { this.resumed++; if (FakeCtx.counted) this.setState('running'); return Promise.resolve(); }
    suspend() { this.setState('suspended'); return Promise.resolve(); }
    close() { this.closed++; this.setState('closed'); return Promise.resolve(); }
    createBuffer() { return { getChannelData: () => new Float32Array(8) }; }
    createGain() { const g = node() as { disconnect: () => void; cut: number }; const m = { cut: 0, gain: { value: 0, setTargetAtTime() {}, setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d: unknown) => { if (this.analysers.includes(d as never)) (d as { from: unknown }).from = m; return d; }, disconnect: () => { m.cut++; } }; this.masters.push(m); void g; return m; }
    createOscillator() { this.oscillators++; return node(); } createBiquadFilter() { return node(); } createBufferSource() { return node(); }
  }
  const G = globalThis as unknown as { AudioContext?: unknown; AudioWorkletNode?: unknown };
  const withFake = () => { made.length = 0; FakeCtx.refusing = false; FakeCtx.startState = 'running'; FakeCtx.counted = true; G.AudioContext = FakeCtx; };
  afterEach(() => { delete G.AudioContext; delete G.AudioWorkletNode; });
  /** The engine model's node: its port is what the processor talks to the page through. */
  const ports: { onmessage: ((e: { data: unknown }) => void) | null }[] = [];
  /** The worklet nodes made, for telling which analyser listens to the engine. */
  const nodes: unknown[] = [];
  /** The facts each processor was built with, then every car message the page sent it, in order. */
  const told: (SoundFacts | null)[] = [];
  const withWorklet = () => {
    ports.length = 0; nodes.length = 0; told.length = 0;
    G.AudioWorkletNode = class {
      port = { onmessage: null, postMessage(m: { facts: SoundFacts | null }) { told.push(m.facts); } }; parameters = new Map();
      constructor(_ctx: unknown, _name: string, o: { processorOptions: { facts: SoundFacts | null } }) { ports.push(this.port); nodes.push(this); told.push(o.processorOptions.facts); }
      connect(d: unknown) { if (d && typeof d === 'object' && 'fill' in d) (d as unknown as { from: unknown }).from = this; return d; } disconnect() {}
    };
  };
  /** Wait until the next engine model's node is made. Loading its module takes as long as it takes: in a production build
   *  (NODE_ENV=production, as Render's build runs the tests) it is a dynamic import, longer than one tick the first time. */
  const modelStarted = (n = ports.length + 1) => vi.waitFor(() => { if (ports.length < n) throw new Error(`engine model ${n} not started yet`); });

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
  it('the debug line keeps counting fresh starts across a rebuild of the sound, and ignores the old processor', async () => {
    withFake(); withWorklet();
    const a = new Audio(false, 'model'); a.setCar(soundFactsFor({ engine: '2.0L I4 Turbo', bodyStyle: 'coupe', redline: 7000 })); a.resume();
    try {
      await modelStarted();
      ports[0].onmessage?.({ data: { resets: 3 } });
      made[0].state = 'closed'; a.resume();      // something closed the output: the next tap builds the sound again
      await modelStarted();
      expect(ports.length).toBe(2);
      ports[1].onmessage?.({ data: { resets: 1 } });
      expect(a.debugLine()).toContain('resets=4');
      ports[0].onmessage?.({ data: { resets: 5 } });   // a late word from the old processor
      expect(a.debugLine()).toContain('resets=4');
    } finally { a.dispose(); }
  });
  // The Garage's ECU remap raises the redline 150 rpm a step (carParams). The limiter cut already comes from the
  // driving model's figure, so the rest of the model (its idle, pops, intake hiss, rpm guard) takes the same one.
  describe('the redline the Garage\'s ECU moved', () => {
    const coupe = ARCHETYPES.coupe, stock = coupe.redline;
    const facts = () => soundFactsFor({ engine: '5.0L V8', bodyStyle: 'coupe', redline: stock })!;
    const remapped = (ecu: 0 | 1 | 2 | 3) => makeVehicle(carParams(coupe, { ...STOCK_CFG.perf, ecu }, TUNE_DEF));
    const started = async () => {
      withFake(); withWorklet();
      const a = new Audio(false, 'model'); a.setCar(facts()); a.resume();
      await modelStarted();
      return a;
    };
    it('reaches the engine model, with the exhaust still sized for the stock engine', async () => {
      const a = await started();
      try {
        a.engine(remapped(3), 10, true);
        const last = told[told.length - 1]!;
        expect(last.redline).toBe(stock + 450);
        expect(last.exhaust).toEqual(facts().exhaust);
        expect(last.engine).toEqual(facts().engine);
      } finally { a.dispose(); }
    });
    it('is sent once when it changes, not every frame: each message builds a new model on the audio thread', async () => {
      const a = await started();
      try {
        const V = remapped(3);
        const before = told.length;
        for (let i = 0; i < 60; i++) a.engine(V, 10, true);
        expect(told.length).toBe(before + 1);
        V.P = remapped(1).P;                     // the Garage sells two steps back
        for (let i = 0; i < 60; i++) a.engine(V, 10, true);
        expect(told.length).toBe(before + 2);
        expect(told[told.length - 1]!.redline).toBe(stock + 150);
      } finally { a.dispose(); }
    });
    it('a stock ECU sends nothing more than the car itself', async () => {
      const a = await started();
      try {
        const before = told.length;
        for (let i = 0; i < 60; i++) a.engine(remapped(0), 10, true);
        expect(told.length).toBe(before);
        expect(told[told.length - 1]!.redline).toBe(stock);
      } finally { a.dispose(); }
    });
    it('is still the remapped one after the sound is rebuilt on a tap', async () => {
      const a = await started();
      try {
        a.engine(remapped(3), 10, true);
        made[0].state = 'closed'; a.resume();    // something closed the output: the next tap builds the sound again
        await modelStarted();
        expect(ports.length).toBe(2);
        expect(told[told.length - 1]!.redline).toBe(stock + 450);
      } finally { a.dispose(); }
    });
  });
  it('the debug line says NaN when what reaches the speakers is not a number', () => {
    withFake(); const a = new Audio(false, 'classic'); a.resume();
    try {
      a.debugLine();
      for (const an of made[0].analysers) an.fill = NaN;
      expect(a.debugLine()).toMatch(/out NaN/);
    } finally { a.dispose(); }
  });
  it('makes no analyser until the debug line is asked for: without ?audiodebug the graph is as before', () => {
    withFake(); const a = new Audio(false, 'classic'); a.resume();
    const V = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF));
    try {
      for (let i = 0; i < 30; i++) a.engine(V, 10, true);
      expect(made[0].analysers.length).toBe(0);
      a.debugLine();
      expect(made[0].analysers.length).toBe(1);
    } finally { a.dispose(); }
  });
  it('the debug line gives the engine\'s level and the whole output\'s level', async () => {
    withFake(); withWorklet();
    const a = new Audio(false, 'model'); a.setCar(soundFactsFor({ engine: '2.0L I4 Turbo', bodyStyle: 'coupe', redline: 7000 })); a.resume();
    try {
      await modelStarted();
      a.debugLine();
      // 'engine' listens to the model's own node, before its gain; 'out' to the master, after everything
      const eng = made[0].analysers.find(an => an.from === nodes.at(0)), out = made[0].analysers.find(an => an.from === made[0].masters.at(0));
      expect(eng).toBeDefined(); expect(out).toBeDefined();
      eng!.fill = 0.5; out!.fill = 0.125;                  // -6 dB and -18 dB
      const line = a.debugLine();
      expect(line).toMatch(/engine -6dB/);
      expect(line).toMatch(/out -18dB/);
      eng!.fill = 0; out!.fill = 0;
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
  it('time when nothing watches (out of the car, a hidden tab) is not counted as a freeze', () => {
    withFake(); const clock = { t: 0 }, a = new Audio(false, 'classic'); (a as unknown as { clock: () => number }).clock = () => clock.t;
    a.resume();
    const V = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF));
    const frames = (n: number, moving: boolean) => { for (let i = 0; i < n; i++) { clock.t += 16; if (moving) made[0].currentTime += 0.016; a.engine(V, 10, true); } };
    try {
      frames(30, true);
      frames(1, false);                          // the last frame in the car happens to see the clock between steps
      clock.t += 5000; made[0].currentTime += 5; // five seconds on foot: the clock runs, nothing watches it
      frames(30, true);
      expect(a.debugLine()).toContain('froze 0.0s');
    } finally { a.dispose(); }
  });
  // A freeze runs from the last look that saw the clock move to the last look that saw it still: currentTime never runs
  // backwards, so a clock that reads the same across a pause in frames stood still through it. A change of state ends it.
  describe('how long a freeze lasted', () => {
    const setup = () => {
      withFake(); const clock = { t: 0 }, a = new Audio(false, 'classic'); (a as unknown as { clock: () => number }).clock = () => clock.t;
      a.resume();
      const V = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF));
      const frames = (n: number, moving: boolean, ms = 16) => { for (let i = 0; i < n; i++) { clock.t += ms; if (moving) made[0].currentTime += ms / 1000; a.engine(V, 10, true); } };
      frames(30, true);
      return { a, clock, frames };
    };
    it('counts the whole freeze when the frames also pause in the middle of it, the clock still where it was', () => {
      const { a, clock, frames } = setup();
      try {
        frames(40, false); clock.t += 600; frames(45, false); frames(5, true);   // 1.96 s standing still, 0.6 s of it with no frames
        expect(a.debugLine()).toContain('froze 2.0s');
      } finally { a.dispose(); }
    });
    it('does not count a long task on the page while the sound plays on', () => {
      const { a, clock, frames } = setup();
      try {
        frames(1, false); clock.t += 450; made[0].currentTime += 0.45; frames(5, true);   // one look between clock steps, then 450 ms of work
        expect(a.debugLine()).toContain('froze 0.0s');
      } finally { a.dispose(); }
    });
    it('does not count a hidden tab: suspended, then running again with the clock where it stopped', () => {
      const { a, clock, frames } = setup();
      try {
        frames(1, false);                                                       // the last look before hiding sees the clock between steps
        made[0].setState('suspended'); clock.t += 30000; made[0].setState('running');
        frames(10, false); frames(5, true);                                    // 160 ms to get going again
        expect(a.debugLine()).toContain('froze 0.0s');
      } finally { a.dispose(); }
    });
    it('counts a freeze that ends with the phone interrupting the sound, up to the last look', () => {
      const { a, frames } = setup();
      try {
        frames(125, false); made[0].setState('interrupted'); frames(5, false);   // 2 s standing still while 'running'
        expect(a.debugLine()).toContain('froze 2.0s');
      } finally { a.dispose(); }
    });
  });
  // The watch looks at the output each frame in the car, and at each tap. Time with no look tells it nothing: getting out
  // of the car, the lobby, the rental counter, a hidden tab, a long task on the page.
  describe('time with nothing watching', () => {
    const setup = () => {
      withFake(); const clock = { t: 0 }, a = new Audio(false, 'classic'); (a as unknown as { clock: () => number }).clock = () => clock.t;
      a.resume();
      const V = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF));
      const frames = (n: number, moving: boolean) => { for (let i = 0; i < n; i++) { clock.t += 16; if (moving) made[0].currentTime += 0.016; a.engine(V, 10, true); } };
      frames(30, true);
      frames(1, false);                            // the last frame in the car sees the clock between two of its steps
      return { a, clock, frames };
    };
    it('a tap after it leaves a working output alone', () => {
      const { a, clock } = setup();
      try {
        clock.t += 5000; made[0].currentTime += 5;   // five seconds on foot: the clock runs, nothing looks at it
        a.resume();
        expect(made.length).toBe(1); expect(made[0].closed).toBe(0); expect(a.health()).toBe('ok');
      } finally { a.dispose(); }
    });
    it('a tap still catches an output whose clock stood still all that time', () => {
      const { a, clock, frames } = setup();
      try {
        frames(1, true);                            // the last frame in the car sees the clock move
        clock.t += 5000;                            // five seconds on foot, and the clock has not moved since
        a.resume();
        expect(made.length).toBe(2); expect(made[0].closed).toBe(1);
      } finally { a.dispose(); }
    });
    it('a hidden tab shown again: the frames before its clock gets going are not a stall', () => {
      const { a, clock, frames } = setup();
      try {
        a.suspend(); clock.t += 30000; a.wake();    // the clock stood still while suspended, as it should
        frames(3, false);                           // 48 ms to get going again
        a.resume();
        expect(made.length).toBe(1); expect(made[0].closed).toBe(0);
      } finally { a.dispose(); }
    });
    it('a tab shown again does not rebuild the sound (no tap: a new output could not start on an iPhone); a tap later does', () => {
      const { a, frames } = setup();
      try {
        made[0].resume = () => Promise.resolve();   // a phone that will not let it go
        made[0].state = 'interrupted'; frames(100, false);
        expect(a.health()).toBe('interrupted');
        a.suspend(); a.wake();
        expect(made.length).toBe(1);
        frames(70, false);                          // still interrupted, 1.1 s after the tab came back
        a.resume();
        expect(made.length).toBe(2);
      } finally { a.dispose(); }
    });
  });
  it('a tab shown again does not rebuild an output something else closed either; the next tap does', () => {
    withFake(); const a = new Audio(false, 'classic'); a.resume();
    try {
      made[0].state = 'closed'; a.suspend(); a.wake();
      expect(made.length).toBe(1);
      a.resume();
      expect(made.length).toBe(2);
    } finally { a.dispose(); }
  });
  it('the tap after a rebuild wakes the new output rather than building another (an iPhone counts touchend, not pointerdown)', () => {
    withFake(); const clock = { t: 0 }, a = new Audio(false, 'classic'); (a as unknown as { clock: () => number }).clock = () => clock.t;
    a.resume(); drive(a, clock, 3);
    try {
      FakeCtx.startState = 'suspended'; FakeCtx.counted = false;
      a.resume();                                      // pointerdown: the new output is made, but cannot start
      expect(made.length).toBe(2); expect(made[1].state).toBe('suspended');
      FakeCtx.counted = true; clock.t += 80;
      a.resume();                                      // touchend, a moment later
      expect(made.length).toBe(2); expect(made[1].state).toBe('running');
    } finally { a.dispose(); }
  });
  it('an output woken from an interruption is not called stalled while its clock gets going', () => {
    withFake(); const clock = { t: 0 }, a = new Audio(false, 'classic'); (a as unknown as { clock: () => number }).clock = () => clock.t;
    a.resume(); made[0].currentTime = 1;
    try {
      made[0].state = 'interrupted'; drive(a, clock, 0.9);   // a call comes in, nearly a second
      made[0].state = 'running'; drive(a, clock, 0.3);       // back, and the clock has yet to move
      a.resume();
      expect(made.length).toBe(1);
    } finally { a.dispose(); }
  });
  it('a rebuild takes the Garage\'s sounds to the new output, not left on the closed one', () => {
    withFake(); const clock = { t: 0 }, world = new Audio(false, 'classic'); (world as unknown as { clock: () => number }).clock = () => clock.t;
    world.resume(); const garage = new Audio(false); garage.resume();
    try {
      drive(world, clock, 3);                       // the output froze
      world.resume();                               // the next tap builds it again
      expect(made.length).toBe(2); expect(made[0].closed).toBe(1);
      expect(garage.health()).toBe('ok');
      const before = made[1].oscillators; garage.sfx('buy');
      expect(made[1].oscillators).toBe(before + 3); // its three notes play on the new output
      garage.dispose(); expect(made[1].closed).toBe(0);   // leaving the Garage leaves the game's output open
      world.dispose(); expect(made[1].closed).toBe(1);
    } finally { garage.dispose(); world.dispose(); }
  });
  it('an output the browser would not make is tried again on the next tap', () => {
    withFake(); const clock = { t: 0 }, a = new Audio(false, 'classic'); (a as unknown as { clock: () => number }).clock = () => clock.t;
    a.resume(); drive(a, clock, 3);
    try {
      FakeCtx.refusing = true; a.resume();         // the rebuild's new output throws
      expect(a.health()).toBe('none');
      FakeCtx.refusing = false; a.resume();
      expect(made.length).toBe(2); expect(a.health()).toBe('ok');
    } finally { a.dispose(); }
  });
  it('after everything is closed, the next Audio starts a fresh output', () => {
    withFake(); const a = new Audio(false, 'classic'); a.resume(); a.dispose();
    const b = new Audio(false, 'classic'); b.resume();
    expect(made.length).toBe(2); b.dispose();
  });
});
