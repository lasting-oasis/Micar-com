// Synth audio, ported as is from Night Tuner 08-hud.js: a three-oscillator engine through a
// lowpass, turbo whine, tyre skid / nitrous hiss / wind noise beds, and the blip/burst sfx table.
// The AudioContext is made lazily on resume() (call it from a user gesture); before that, and in
// node where there is no AudioContext, every call is a no-op.
// With ?sound=model the engine comes from the physical model in ../sound instead (an AudioWorklet); the
// three oscillators stay as the default and as the fallback wherever the model cannot start.
import { clamp, type Vehicle } from './physics';
import type { SoundFacts } from '../sound/facts';

export type SoundMode = 'classic' | 'model';
/** Which engine sound the page asked for: `?sound=model` turns the physical model on. */
export function soundMode(search: string): SoundMode { return /[?&]sound=classic(&|$)/.test(search) ? 'classic' : 'model'; }

/** What the engine sound model is told about the engine each frame, read from today's driving model. */
export function engineDrive(V: Vehicle): { rpm: number; throttle: number; load: number; boost: number; cut: number } {
  const cut = V.shift > 0 || V.blown || V.rpm > V.P.redline + 150 ? 1 : 0;
  return { rpm: V.rpm, throttle: V.thr, load: V.thr > 0 ? V.thr : -0.3 * V.rpm / V.P.redline, boost: V.boost, cut };
}

type Ctx = AudioContext;
type Nodes = {
  master: GainNode; noise: AudioBuffer;
  e1: OscillatorNode; e2: OscillatorNode; e3: OscillatorNode; ef: BiquadFilterNode; eg: GainNode;
  wh: OscillatorNode; whg: GainNode; skg: GainNode; nsg: GainNode; wdg: GainNode;
};

export const SFX_NAMES = ['tick', 'buy', 'ok', 'no', 'beep', 'go', 'cp', 'finish', 'perfect', 'crash', 'horn', 'shift', 'bov', 'nosfire'] as const;

/** The page's one audio context and how many Audio instances are using it. */
let shared: { AC: Ctx; refs: number } | null = null;
const workletLoaded = new WeakMap<object, Promise<void>>();

export class Audio {
  private AC: Ctx | null = null;
  private A: Nodes | null = null;
  private failed = false;
  private quiet = true;
  private facts: SoundFacts | null = null;
  private node: AudioWorkletNode | null = null;
  private nodeGain: GainNode | null = null;
  private sentTurbo = false;
  private sources: AudioScheduledSourceNode[] = [];
  // Health: an iPhone can leave the output interrupted, or 'running' with its clock stopped. Watched each frame.
  private clock = (): number => performance.now();
  private seenTime = -1; private stuckSince = -1; private rebuilt = 0;

  /** 'ok', 'stalled' (its clock has not moved for over a second), 'interrupted'/'suspended' (stuck so for over a second), 'closed', or 'none' before the first tap. */
  health(): 'ok' | 'stalled' | 'interrupted' | 'suspended' | 'closed' | 'none' {
    const AC = this.AC; if (!AC) return 'none';
    if (AC.state === 'closed') return 'closed'; // closed by something else: never coming back
    if (this.stuckSince < 0 || this.clock() - this.stuckSince < 1000) return 'ok';
    return AC.state === 'running' ? 'stalled' : (AC.state as 'interrupted' | 'suspended');
  }
  /** One line for the on-screen readout (?audiodebug). */
  debugLine(): string {
    const AC = this.AC; if (!AC) return 'audio: not started (tap)';
    return `audio: ${AC.state} t=${AC.currentTime.toFixed(1)} ${AC.sampleRate}Hz ${this.health()} model=${this.modelActive ? 'on' : 'off'} rebuilt=${this.rebuilt}`;
  }
  private watch(): void {
    const AC = this.AC; if (!AC) return;
    const moving = AC.state === 'running' && AC.currentTime !== this.seenTime;
    if (moving) this.stuckSince = -1; else if (this.stuckSince < 0) this.stuckSince = this.clock();
    this.seenTime = AC.currentTime;
  }

  constructor(private muted = false, private mode: SoundMode = 'classic') {}

  /** The car being driven, for the engine sound model (null: no piston engine to model). Safe before resume(). */
  setCar(facts: SoundFacts | null): void { this.facts = facts; this.sentTurbo = false; this.send(false); }

  /** True when the physical model is voicing the engine. */
  get modelActive(): boolean { return !!this.node && !!this.facts; }

  // A Garage turbo on an engine that has none from the factory still whistles.
  private send(turbo: boolean): void {
    const f = this.facts;
    this.node?.port.postMessage({ facts: f && turbo && f.engine.induction === 'na' ? { ...f, engine: { ...f.engine, induction: 'turbo' } } : f });
  }

  private startModel(AC: Ctx, master: GainNode): void {
    if (this.mode !== 'model' || !AC.audioWorklet || typeof AudioWorkletNode === 'undefined') return;
    // The build bundles the worklet into one file. The dev server's worker wrapper does not run in a
    // worklet, so in development the module is loaded as the dev server serves it.
    const url = import.meta.env.DEV ? Promise.resolve('/src/sound/engine.worklet.ts') : import('../sound/engine.worklet.ts?worker&url').then(m => m.default);
    let loaded = workletLoaded.get(AC);   // a module registers its processor once per context
    if (!loaded) { loaded = url.then(u => AC.audioWorklet.addModule(u)); workletLoaded.set(AC, loaded); }
    loaded
      .then(() => {
        if (this.AC !== AC) return; // disposed while loading
        const node = new AudioWorkletNode(AC, 'micar-engine', { numberOfInputs: 0, outputChannelCount: [2], processorOptions: { facts: this.facts } });
        const g = AC.createGain(); g.gain.value = 0; node.connect(g).connect(master);
        this.node = node; this.nodeGain = g; this.send(this.sentTurbo);
      })
      .catch(() => { /* the classic engine keeps playing */ });
  }

  get isMuted(): boolean { return this.muted; }

  /** Make (first call) and resume the context. Call from a pointerdown/keydown handler. */
  resume(): void {
    // Dead for over a second (frozen, or a phone that will not give it back): build the sound again, now, inside this tap.
    const h = this.health();
    if (h !== 'ok' && h !== 'none') this.rebuild();
    const AC = this.ctx();
    // A phone can also leave the context 'interrupted' (a call, another app, another context closing): wake that too.
    if (AC && AC.state !== 'running' && AC.state !== 'closed') void AC.resume().catch(() => {});
  }

  setMute(m: boolean): void { this.muted = m; if (this.A) this.A.master.gain.value = m ? 0 : .55; }

  sfx(n: string): void {
    if (!this.AC) return;
    switch (n) {
      case 'tick': this.blip(1400, .04, 'square', .025); break;
      case 'buy': this.blip(660, .1, 'triangle', .08); this.blip(990, .16, 'triangle', .08, .08); this.blip(1320, .2, 'triangle', .06, .16); break;
      case 'ok': this.blip(880, .12, 'triangle', .07); break;
      case 'no': this.blip(180, .18, 'square', .06); break;
      case 'beep': this.blip(880, .12, 'square', .07); break;
      case 'go': this.blip(1320, .35, 'square', .09); break;
      case 'cp': this.blip(1100, .08, 'triangle', .06); this.blip(1650, .12, 'triangle', .06, .07); break;
      case 'finish': [523, 659, 784, 1046].forEach((f, i) => this.blip(f, .22, 'triangle', .08, i * .1)); break;
      case 'perfect': this.blip(1760, .08, 'triangle', .07); this.blip(2200, .14, 'triangle', .06, .06); break;
      case 'crash': this.burst(.35, 180, .5, 'lowpass'); break;
      case 'horn': this.blip(392, .3, 'square', .06); this.blip(494, .3, 'square', .05); break;
      case 'shift': this.burst(.05, 3000, .06); break;
      case 'bov': this.burst(.25, 2500, .09); break;
      case 'nosfire': this.burst(.3, 900, .08, 'bandpass'); break;
    }
  }

  /** Night Tuner's engineAudio, once per frame: `speed` in m/s; `on` false fades every bed out. */
  engine(V: Vehicle, sp: number, on: boolean): void {
    const AC = this.AC, A = this.A; if (!AC || !A) return; const t = AC.currentTime;
    this.watch();
    if (!on) { this.silence(); return; }
    this.quiet = false;
    const model = this.modelActive && this.node && this.nodeGain;
    if (model) {
      if (!!V.P.turbo !== this.sentTurbo) { this.sentTurbo = !!V.P.turbo; this.send(this.sentTurbo); }
      const d = engineDrive(V), p = this.node!.parameters;
      for (const k of ['rpm', 'throttle', 'load', 'boost', 'cut'] as const) p.get(k)?.setTargetAtTime(d[k], t, .01);
      this.nodeGain!.gain.setTargetAtTime(this.muted ? 0 : .9, t, .03);
    } else if (this.nodeGain) this.nodeGain.gain.setTargetAtTime(0, t, .03);
    const f = 28 + V.rpm / 60 * 1.6;
    A.e1.frequency.setTargetAtTime(f, t, .02); A.e2.frequency.setTargetAtTime(f * .5, t, .02); A.e3.frequency.setTargetAtTime(f * 1.51, t, .02);
    A.ef.frequency.setTargetAtTime(300 + V.thr * 1800 + V.rpm * .25, t, .04);
    A.eg.gain.setTargetAtTime(model ? 0 : (this.muted ? 0 : (.07 + V.thr * .09)) * (V.shift > 0 ? .45 : 1) * (V.blown ? .2 : 1), t, .03);
    const tb = V.P.turbo;
    A.whg.gain.setTargetAtTime(tb && !model ? V.boost * .014 * (1 + tb.gain * 4) : 0, t, .08); A.wh.frequency.setTargetAtTime(1400 + V.rpm * .5 + V.boost * 800, t, .05);
    const skid = clamp((Math.abs(V.beta) - .14) * 3, 0, 1) * Math.min(1, sp / 12) + Math.max(V.spinF, V.spinR) * .6 * Math.min(1, sp / 4) + (V.hand ? .5 * Math.min(1, sp / 6) : 0);
    A.skg.gain.setTargetAtTime(Math.min(1, skid) * .16, t, .05);
    A.nsg.gain.setTargetAtTime(V.nosOn ? .09 : 0, t, .05); A.wdg.gain.setTargetAtTime(Math.min(.12, sp * sp * .00006), t, .1);
  }

  /** Fade every engine bed (engine, turbo, skid, nitrous, wind) to silence: out of the car, paused, the Garage.
   *  A short fade, then exactly 0 from 0.4 s on. Once quiet, later calls schedule nothing. */
  silence(): void {
    const AC = this.AC, A = this.A; if (!AC || !A || this.quiet) return; const t = AC.currentTime;
    for (const g of [A.eg, A.whg, A.skg, A.nsg, A.wdg, ...(this.nodeGain ? [this.nodeGain] : [])]) { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, .05); g.gain.setValueAtTime(0, t + .4); }
    this.quiet = true;
  }

  /** The engine beds' current gains (engine, turbo, skid, nitrous, wind); [] before the context exists. */
  levels(): number[] { const A = this.A; return A ? [A.eg, A.whg, A.skg, A.nsg, A.wdg].map(g => g.gain.value) : []; }

  /** Suspend the context (the tab is hidden); wake() picks it up again. */
  suspend(): void { const AC = this.AC; if (AC && AC.state === 'running') void AC.suspend().catch(() => {}); }
  /** Resume a context that exists (the tab is shown again); makes none. */
  wake(): void { if (this.AC) this.resume(); }

  /** Close the context (leaving the world). */
  private rebuild(): void {
    const old = this.AC, facts = this.facts, turbo = this.sentTurbo, n = this.rebuilt + 1;
    this.dispose();
    if (old && shared?.AC === old) { shared = null; void old.close().catch(() => {}); } // the others on it are dead too
    this.facts = facts; this.sentTurbo = turbo; this.rebuilt = n;
  }

  dispose(): void {
    const AC = this.AC;
    if (AC) {
      // Take this instance's sounds off the shared output; the context itself closes only with its last user.
      for (const src of this.sources) { try { src.stop(); } catch { /* never started */ } }
      try { this.node?.disconnect(); } catch { /* not connected */ }
      try { this.A?.master.disconnect(); } catch { /* not connected */ }
      if (shared && shared.AC === AC && --shared.refs <= 0) { shared = null; void AC.close().catch(() => {}); }
    }
    this.sources = []; this.AC = null; this.A = null; this.node = null; this.nodeGain = null; this.quiet = true; this.stuckSince = -1; this.seenTime = -1;
  }

  private ctx(): Ctx | null {
    if (this.AC) return this.AC; if (this.failed) return null;
    const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = g.AudioContext || g.webkitAudioContext;
    if (!Ctor) { this.failed = true; return null; }
    // One context for the whole page. The Garage menu has its own Audio, and on an iPhone a second context
    // closing interrupts the first: the game's sound then stayed off after a visit to the Garage.
    let AC: Ctx;
    if (shared && shared.AC.state !== 'closed' && shared.AC instanceof Ctor) { AC = shared.AC; shared.refs++; }
    else { try { AC = new Ctor(); } catch { this.failed = true; return null; } shared = { AC, refs: 1 }; }
    const master = AC.createGain(); master.gain.value = this.muted ? 0 : .55; master.connect(AC.destination);
    const nb = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noiseSrc = () => { const s = AC.createBufferSource(); s.buffer = nb; s.loop = true; s.start(); return s; };
    const e1 = AC.createOscillator(); e1.type = 'sawtooth'; const e2 = AC.createOscillator(); e2.type = 'square'; const e3 = AC.createOscillator(); e3.type = 'sawtooth';
    const ef = AC.createBiquadFilter(); ef.type = 'lowpass'; ef.Q.value = 4; const eg = AC.createGain(); eg.gain.value = 0;
    const m2 = AC.createGain(); m2.gain.value = .5; const m3 = AC.createGain(); m3.gain.value = .35;
    e1.connect(ef); e2.connect(m2).connect(ef); e3.connect(m3).connect(ef); ef.connect(eg).connect(master); e1.start(); e2.start(); e3.start();
    const wh = AC.createOscillator(); wh.type = 'sine'; const whg = AC.createGain(); whg.gain.value = 0; wh.connect(whg).connect(master); wh.start();
    const sk = noiseSrc(); const skf = AC.createBiquadFilter(); skf.type = 'bandpass'; skf.frequency.value = 1500; skf.Q.value = 3; const skg = AC.createGain(); skg.gain.value = 0; sk.connect(skf).connect(skg).connect(master);
    const ns = noiseSrc(); const nf = AC.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 1800; const nsg = AC.createGain(); nsg.gain.value = 0; ns.connect(nf).connect(nsg).connect(master);
    const wd = noiseSrc(); const wf = AC.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 600; const wdg = AC.createGain(); wdg.gain.value = 0; wd.connect(wf).connect(wdg).connect(master);
    this.AC = AC; this.A = { master, noise: nb, e1, e2, e3, ef, eg, wh, whg, skg, nsg, wdg };
    this.sources = [e1, e2, e3, wh, sk, ns, wd];
    this.startModel(AC, master);
    return AC;
  }

  private blip(f: number, dur: number, type: OscillatorType = 'square', g = .08, when = 0, f2?: number): void {
    const AC = this.AC, A = this.A; if (!AC || !A || this.muted) return;
    const o = AC.createOscillator(), v = AC.createGain(), t0 = AC.currentTime + when; o.type = type;
    o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    v.gain.setValueAtTime(g, t0); v.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    o.connect(v).connect(A.master); o.start(t0); o.stop(t0 + dur + .05);
  }

  private burst(dur: number, freq: number, g: number, type: BiquadFilterType = 'highpass'): void {
    const AC = this.AC, A = this.A; if (!AC || !A || this.muted) return;
    const s = AC.createBufferSource(); s.buffer = A.noise; const f = AC.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const v = AC.createGain(); v.gain.setValueAtTime(g, AC.currentTime); v.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + dur);
    s.connect(f).connect(v).connect(A.master); s.start(); s.stop(AC.currentTime + dur + .05);
  }
}
