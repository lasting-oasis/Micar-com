// Synth audio, ported as is from Night Tuner 08-hud.js: a three-oscillator engine through a
// lowpass, turbo whine, tyre skid / nitrous hiss / wind noise beds, and the blip/burst sfx table.
// The AudioContext is made lazily on resume() (call it from a user gesture); before that, and in
// node where there is no AudioContext, every call is a no-op.
import { clamp, type Vehicle } from './physics';

type Ctx = AudioContext;
type Nodes = {
  master: GainNode; noise: AudioBuffer;
  e1: OscillatorNode; e2: OscillatorNode; e3: OscillatorNode; ef: BiquadFilterNode; eg: GainNode;
  wh: OscillatorNode; whg: GainNode; skg: GainNode; nsg: GainNode; wdg: GainNode;
};

export const SFX_NAMES = ['tick', 'buy', 'ok', 'no', 'beep', 'go', 'cp', 'finish', 'perfect', 'crash', 'horn', 'shift', 'bov', 'nosfire'] as const;

export class Audio {
  private AC: Ctx | null = null;
  private A: Nodes | null = null;
  private failed = false;
  private quiet = true;

  constructor(private muted = false) {}

  get isMuted(): boolean { return this.muted; }

  /** Make (first call) and resume the context. Call from a pointerdown/keydown handler. */
  resume(): void {
    const AC = this.ctx();
    if (AC && AC.state === 'suspended') void AC.resume().catch(() => {});
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
    if (!on) { this.silence(); return; }
    this.quiet = false;
    const f = 28 + V.rpm / 60 * 1.6;
    A.e1.frequency.setTargetAtTime(f, t, .02); A.e2.frequency.setTargetAtTime(f * .5, t, .02); A.e3.frequency.setTargetAtTime(f * 1.51, t, .02);
    A.ef.frequency.setTargetAtTime(300 + V.thr * 1800 + V.rpm * .25, t, .04);
    A.eg.gain.setTargetAtTime((this.muted ? 0 : (.07 + V.thr * .09)) * (V.shift > 0 ? .45 : 1) * (V.blown ? .2 : 1), t, .03);
    const tb = V.P.turbo;
    A.whg.gain.setTargetAtTime(tb ? V.boost * .014 * (1 + tb.gain * 4) : 0, t, .08); A.wh.frequency.setTargetAtTime(1400 + V.rpm * .5 + V.boost * 800, t, .05);
    const skid = clamp((Math.abs(V.beta) - .14) * 3, 0, 1) * Math.min(1, sp / 12) + Math.max(V.spinF, V.spinR) * .6 * Math.min(1, sp / 4) + (V.hand ? .5 * Math.min(1, sp / 6) : 0);
    A.skg.gain.setTargetAtTime(Math.min(1, skid) * .16, t, .05);
    A.nsg.gain.setTargetAtTime(V.nosOn ? .09 : 0, t, .05); A.wdg.gain.setTargetAtTime(Math.min(.12, sp * sp * .00006), t, .1);
  }

  /** Fade every engine bed (engine, turbo, skid, nitrous, wind) to silence: out of the car, paused, the Garage.
   *  A short fade, then exactly 0 from 0.4 s on. Once quiet, later calls schedule nothing. */
  silence(): void {
    const AC = this.AC, A = this.A; if (!AC || !A || this.quiet) return; const t = AC.currentTime;
    for (const g of [A.eg, A.whg, A.skg, A.nsg, A.wdg]) { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, .05); g.gain.setValueAtTime(0, t + .4); }
    this.quiet = true;
  }

  /** The engine beds' current gains (engine, turbo, skid, nitrous, wind); [] before the context exists. */
  levels(): number[] { const A = this.A; return A ? [A.eg, A.whg, A.skg, A.nsg, A.wdg].map(g => g.gain.value) : []; }

  /** Suspend the context (the tab is hidden); wake() picks it up again. */
  suspend(): void { const AC = this.AC; if (AC && AC.state === 'running') void AC.suspend().catch(() => {}); }
  /** Resume a context that exists (the tab is shown again); makes none. */
  wake(): void { if (this.AC) this.resume(); }

  /** Close the context (leaving the world). */
  dispose(): void { if (this.AC) void this.AC.close().catch(() => {}); this.AC = null; this.A = null; this.quiet = true; }

  private ctx(): Ctx | null {
    if (this.AC) return this.AC; if (this.failed) return null;
    const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = g.AudioContext || g.webkitAudioContext;
    if (!Ctor) { this.failed = true; return null; }
    let AC: Ctx; try { AC = new Ctor(); } catch { this.failed = true; return null; }
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
