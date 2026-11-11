// The engine sound model: exhaust pulses clocked by the crank, sent through delay-line pipes laid out
// like the car's exhaust. Facts in (firing table, pipe lengths, muffler kind), sound out. No recordings.
// Pure numbers: no browser calls, so the same code runs in an AudioWorklet and in the tests.
// render() allocates nothing.
// Design: docs/superpowers/specs/2026-11-11-engine-sound-design.md
import type { SoundFacts } from './facts';
import { firingTable } from './firing';

// ---- global constants: the same for every car. A car contributes facts only. ----
const SOUND_SPEED = 500;      // m/s in exhaust gas at about 350 C; one figure for the whole pipe in this version
const ENGINE_END = 0.6;       // how much of a wave the closed valves send back down the pipe
const TAIL_REFLECT = 0.97;    // how much of the low end the open tailpipe sends back
const PIPE_LOSS_PER_M = 0.02; // wall loss per metre travelled
const RISE_SOFT = 0.0016;     // s: pulse rise time at no load
const RISE_HARD = 0.0006;     // s: pulse rise time at full load
const PUSH_SHARE = 0.3;       // size of the piston's push after the blow-down, against the blow-down
const MOTORED = 0.18;         // size of an air-only pulse (fuel cut) against a full-load one; an estimate, not measured
const FUEL_BACK_RPM = 1800;   // with the pedal off, fuel is fully back by this many rpm less the band below
const FUEL_BACK_BAND = 500;   // rpm over which it comes back
const JITTER_LOAD = 0.05;     // cycle-to-cycle variation at speed
const JITTER_IDLE = 0.14;     // extra variation near idle
const TURBINE_GAIN = 0.55;    // class estimate: what a turbine leaves of a pulse
const CHAMBER_AREA = 9;       // chambered muffler: chamber area over pipe area
const RING = 16384, MASK = RING - 1;

class Seg {
  f: Float32Array; b: Float32Array; pos = 0; lpF = 0; lpB = 0;
  fo = 0; bo = 0; fi = 0; bi = 0;
  readonly a: number; readonly g: number;
  /** A pipe section: `metres` long, `area` relative to the main pipe, low-pass corner `fc`, `mix` of it applied, extra `gain`. */
  constructor(metres: number, readonly area: number, sr: number, fc = 7000, readonly mix = 1, gain = 1) {
    const n = Math.max(2, Math.round(metres / SOUND_SPEED * sr));
    this.f = new Float32Array(n); this.b = new Float32Array(n);
    this.a = 1 - Math.exp(-2 * Math.PI * fc / sr);
    this.g = gain * Math.exp(-PIPE_LOSS_PER_M * metres);
  }
}

export type EngineSoundOptions = { seed?: number; /** 0 = both tailpipes in the middle, 1 = one per side. */ spread?: number };

export class EngineSound {
  // What the driving model sets, as often as it likes. Smoothed inside.
  rpm = 0; throttle = 0; /** -1..1: share of the torque available at this rpm; negative on engine braking. */ load = 0;
  /** 0..1: the boost state. */ boost = 0; /** 1 while the limiter or a shift cuts the firing. */ cut = 0;
  // The camera's mix.
  exhaustGain = 1; intakeGain = 0.5; bayGain = 0.3;

  private readonly sr: number;
  private readonly redline: number;
  private readonly spread: number;
  // firing
  private readonly evPhase: Float32Array; private readonly evGroup: Uint8Array; private readonly evDelay: Float32Array;
  private readonly nEv: number; private phase = 0; private next = 0; private nextAbs = 0;
  private readonly a0: number; private riseK = 1; private readonly turbo: boolean; private readonly pops: boolean;
  private readonly blowerOrder: number;
  // sources
  private readonly src: Float32Array[]; private rp = 0;
  private readonly intake = new Float32Array(RING);
  private srcLp0 = 0; private srcLp1 = 0;
  // pipes
  private readonly segs: Seg[] = []; private readonly lines: Seg[][] = []; private readonly kR: Float32Array[] = [];
  private readonly branches: Seg[] | null = null; private readonly crossover: number;
  private readonly aTail: number; private tailLp0 = 0; private tailLp1 = 0;
  // smoothed inputs and slow states
  private rpmS = 0; private thrS = 0; private loadS = 0; private boostS = 0; private readonly kS: number;
  private heat = 0; private bov = 0; private lastThr = 0;
  // noise, tones, small filters
  private seed: number; private nLp = 0; private flow = 0;
  private inZ1 = 0; private inZ2 = 0; private readonly inB: number; private readonly inA1: number; private readonly inA2: number;
  private bayClick = 0; private bayLp1 = 0; private bayLp2 = 0;
  private whistle = 0; private blower = 0; private dcL = 0; private dcR = 0;

  constructor(facts: SoundFacts, sampleRate: number, opts: EngineSoundOptions = {}) {
    const sr = this.sr = sampleRate, e = facts.engine, x = facts.exhaust;
    this.redline = facts.redline; this.spread = opts.spread ?? 0.7; this.seed = (opts.seed ?? 1) | 0 || 1;
    this.kS = 1 - Math.exp(-1 / (0.015 * sr));
    this.turbo = e.induction === 'turbo'; this.pops = x.overrunPops; this.blowerOrder = facts.blowerOrder ?? 0;
    this.a0 = Math.sqrt(e.displacementL / e.cylinders / 0.5);
    // A cylinder empties through a valve whose area grows as the square of its size while its volume grows as the cube: the time goes as the cube root of the volume.
    this.riseK = Math.cbrt(e.displacementL / e.cylinders / 0.5);

    // An engine with one bank has one pipe, whatever the exhaust facts say.
    const table = firingTable(e);
    const twoBanks = table.some(t => t.bank === 1);
    const layout = twoBanks ? x.layout : 'single';
    this.crossover = layout === 'dual' ? Math.min(0.5, Math.max(0, x.crossover)) : 0;

    this.nEv = table.length;
    this.evPhase = new Float32Array(this.nEv); this.evGroup = new Uint8Array(this.nEv); this.evDelay = new Float32Array(this.nEv);
    table.forEach((t, i) => {
      this.evPhase[i] = t.angle / 720;
      this.evGroup[i] = layout === 'single' ? 0 : t.bank;
      this.evDelay[i] = x.runnerM[t.bank] / SOUND_SPEED * sr; // the runner: a pure delay
    });
    this.src = layout === 'single' ? [new Float32Array(RING)] : [new Float32Array(RING), new Float32Array(RING)];

    // The pipe from the collector back: pipe, converter, pipe, muffler, tailpipe.
    const line = (lead: number): Seg[] => {
      const s: Seg[] = [];
      if (lead > 0) s.push(new Seg(lead, 1, sr));
      s.push(new Seg(x.pipeM * 0.3, 1, sr), new Seg(0.25, 4, sr, 3000, 1, 0.9), new Seg(x.pipeM * 0.45, 1, sr));
      if (x.muffler === 'chambered') s.push(new Seg(0.45, CHAMBER_AREA, sr, 1200, 0.7));
      else if (x.muffler === 'straight') s.push(new Seg(0.5, 1, sr, 700, 0.9));
      s.push(new Seg(Math.max(0.2, x.pipeM * 0.25), 1, sr));
      return s;
    };
    if (layout === 'dual') this.lines.push(line(x.branchM[0]), line(x.branchM[1]));
    else this.lines.push(line(0));
    if (layout === 'merge') this.branches = [new Seg(x.branchM[0], 0.7, sr), new Seg(x.branchM[1], 0.7, sr)];
    for (const l of this.lines) {
      this.segs.push(...l);
      const k = new Float32Array(l.length - 1);
      for (let j = 0; j < k.length; j++) k[j] = (l[j].area - l[j + 1].area) / (l[j].area + l[j + 1].area);
      this.kR.push(k);
    }
    if (this.branches) this.segs.push(...this.branches);
    // The open end lets through what is short against the tip's circumference.
    this.aTail = 1 - Math.exp(-2 * Math.PI * (SOUND_SPEED / (Math.PI * x.pipeDiaMm / 1000)) / sr);

    // The plenum: one resonance, lower for a bigger engine.
    const f0 = 330 / Math.sqrt(Math.max(0.6, e.displacementL) / 2), w = 2 * Math.PI * f0 / sr, r = 1 - w / (2 * 2.5);
    this.inB = 1 - r; this.inA1 = 2 * r * Math.cos(w); this.inA2 = -r * r;
  }

  private rand(): number { let s = this.seed; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.seed = s; return (s >>> 0) / 4294967296; }
  private gauss(): number { return (this.rand() + this.rand() + this.rand() - 1.5) * 1.155; }

  /** Add one pulse to a ring `at` samples from now: a fast rise and decay, then the piston's longer push. */
  private pulse(ring: Float32Array, at: number, amp: number, rise: number, push: number): void {
    const sr = this.sr, i0 = Math.ceil(at), tr = rise * sr, n = Math.ceil(tr * 8);
    for (let i = 0; i < n; i++) { const t = (i0 + i - at) / tr; ring[(this.rp + i0 + i) & MASK] += amp * t * Math.exp(1 - t); }
    if (push > 0) {
      const m = Math.min(RING - 4096, Math.ceil(push * sr)), w = Math.PI / m, a = amp * PUSH_SHARE;
      for (let i = 0; i < m; i++) ring[(this.rp + i0 + i) & MASK] += a * Math.sin(w * i);
    }
  }

  private fire(i: number, frac: number): void {
    const rpm = this.rpmS, load = Math.max(0, this.loadS);
    // Fuel: on with the pedal down; with the pedal off it is cut on the overrun and comes back as the revs near idle, as an engine computer does.
    const pedal = Math.min(1, this.thrS / 0.06), nearIdle = Math.min(1, Math.max(0, (FUEL_BACK_RPM - rpm) / FUEL_BACK_BAND));
    const fuel = this.cut < 0.5 ? Math.max(pedal, nearIdle) : 0, firing = fuel > 0.5;
    const idle = Math.max(0, 1 - rpm / (0.45 * this.redline));
    const fired = this.a0 * (0.22 + 0.78 * load) * (1 + 0.6 * this.boostS) * (1 + (JITTER_LOAD + JITTER_IDLE * idle * idle) * this.gauss());
    const motored = this.a0 * MOTORED * (0.6 + 0.4 * this.thrS);
    let amp = motored + (fired - motored) * fuel;
    let rise = RISE_SOFT * 1.3 + (RISE_SOFT + (RISE_HARD - RISE_SOFT) * load - RISE_SOFT * 1.3) * fuel;
    rise *= this.riseK;
    if (this.turbo) { amp *= TURBINE_GAIN; rise *= 1.8; }
    const half = Math.min(0.08, 30 / Math.max(300, rpm)); // 180 crank degrees, in seconds
    const at = Math.max(0, this.evDelay[i] - frac + (firing ? idle * 1.5 * this.gauss() : 0));
    const ring = this.src[this.evGroup[i]];
    this.pulse(ring, at, amp, rise, half);
    // The intake draws once per cylinder too, as far as the throttle lets the sound out.
    const open = this.thrS * this.thrS;
    if (open > 0.001) this.pulse(this.intake, 0, -this.a0 * 0.5 * open * (1 + 0.6 * this.boostS), 0.0016, half * 0.6);
    this.bayClick += amp * 0.6;
    // Unburnt fuel lighting in a hot pipe after lift-off.
    if (this.pops && !firing && this.cut < 0.5 && rpm > 0.4 * this.redline && this.rand() < 0.3 * this.heat) {
      this.pulse(ring, at + this.rand() * 0.006 * this.sr, this.a0 * (1.2 + 1.6 * this.rand()), 0.00016, 0);
    }
  }

  /** Fill `left` and `right` with the next `n` samples. */
  render(left: Float32Array, right: Float32Array, n = left.length): void {
    const sr = this.sr, kS = this.kS, lines = this.lines, segs = this.segs, br = this.branches, x = this.crossover;
    const two = lines.length === 2, nSeg = segs.length, src0 = this.src[0], src1 = this.src.length > 1 ? this.src[1] : null;
    const sA = 0.5 * (1 + this.spread), sB = 0.5 * (1 - this.spread), kSlow = 1 / sr;
    for (let s = 0; s < n; s++) {
      // inputs, smoothed
      const rpm = this.rpmS += kS * (this.rpm - this.rpmS);
      const thr = this.thrS += kS * (this.throttle - this.thrS);
      this.loadS += kS * (this.load - this.loadS);
      const boost = this.boostS += kS * (this.boost - this.boostS);
      const loadP = this.loadS > 0 ? this.loadS : 0;
      this.heat += kSlow * (loadP > 0.4 ? (1 - this.heat) / 2 : -this.heat / 1.5);

      // the crank clock
      if (rpm > 60) {
        const d = rpm / 120 / sr;
        let p = this.phase + d;
        while (p >= this.nextAbs) {
          this.fire(this.next, (p - this.nextAbs) / d);
          if (++this.next === this.nEv) { this.next = 0; this.nextAbs = 1 + this.evPhase[0]; } else this.nextAbs += this.evPhase[this.next] - this.evPhase[this.next - 1];
        }
        if (p >= 1) { p -= 1; this.nextAbs -= 1; }
        this.phase = p;
      }

      // what the cylinders put into the collectors this sample
      const rp = this.rp;
      let s0 = src0[rp], s1 = 0; src0[rp] = 0;
      if (src1) { s1 = src1[rp]; src1[rp] = 0; }
      if (this.turbo) { s0 = this.srcLp0 += 0.12 * (s0 - this.srcLp0); s1 = this.srcLp1 += 0.12 * (s1 - this.srcLp1); }
      const draw = this.intake[rp]; this.intake[rp] = 0;
      this.rp = (rp + 1) & MASK;

      // pipes: read what arrives at each end
      for (let i = 0; i < nSeg; i++) {
        const g = segs[i];
        const f = g.f[g.pos], b = g.b[g.pos];
        g.lpF += g.a * (f - g.lpF); g.lpB += g.a * (b - g.lpB);
        g.fo = g.g * (f + g.mix * (g.lpF - f)); g.bo = g.g * (b + g.mix * (g.lpB - b));
      }
      // the engine end, and the join of two bank pipes
      if (br) {
        const A = br[0], B = br[1], M = lines[0][0];
        const pj = 2 * (A.area * A.fo + B.area * B.fo + M.area * M.bo) / (A.area + B.area + M.area);
        A.bi = pj - A.fo; B.bi = pj - B.fo; M.fi = pj - M.bo;
        A.fi = s0 + ENGINE_END * A.bo; B.fi = s1 + ENGINE_END * B.bo;
      } else {
        const h = lines[0][0]; h.fi = s0 + ENGINE_END * h.bo;
        if (two) { const h1 = lines[1][0]; h1.fi = s1 + ENGINE_END * h1.bo; }
      }
      // along each pipe: every change of area passes part of a wave and reflects the rest
      let t0 = 0, t1 = 0;
      for (let l = 0; l < lines.length; l++) {
        const L = lines[l], k = this.kR[l], last = L.length - 1;
        for (let j = 0; j < last; j++) {
          const a = L[j], b = L[j + 1], R = k[j];
          a.bi = R * a.fo + (1 - R) * b.bo; b.fi = (1 + R) * a.fo - R * b.bo;
        }
        // the open end: lows go back inverted, the rest radiates
        const e = L[last];
        if (l === 0) { this.tailLp0 += this.aTail * (e.fo - this.tailLp0); e.bi = -TAIL_REFLECT * this.tailLp0; t0 = e.fo - this.tailLp0; }
        else { this.tailLp1 += this.aTail * (e.fo - this.tailLp1); e.bi = -TAIL_REFLECT * this.tailLp1; t1 = e.fo - this.tailLp1; }
      }
      // an H or X pipe shares the two sides just after the bank pipes
      if (x > 0 && two) {
        const a0 = lines[0][0], a1 = lines[0][1], b0 = lines[1][0], b1 = lines[1][1];
        const fa = a1.fi, fb = b1.fi; a1.fi = fa + x * (fb - fa); b1.fi = fb + x * (fa - fb);
        const ba = a0.bi, bb = b0.bi; a0.bi = ba + x * (bb - ba); b0.bi = bb + x * (ba - bb);
      }
      for (let i = 0; i < nSeg; i++) { const g = segs[i]; g.f[g.pos] = g.fi; g.b[g.pos] = g.bi; if (++g.pos === g.f.length) g.pos = 0; }

      // flow noise at the tailpipes
      const white = this.rand() * 2 - 1; this.nLp += 0.2 * (white - this.nLp);
      const mag = (t0 < 0 ? -t0 : t0) + (t1 < 0 ? -t1 : t1); this.flow += 0.002 * (mag - this.flow);
      const hiss = (white - this.nLp) * this.flow * 0.35;
      let exL: number, exR: number;
      if (two) { exL = sA * t0 + sB * t1 + hiss; exR = sB * t0 + sA * t1 + hiss; } else exL = exR = t0 + hiss;

      // intake: the plenum rings, and air rushes through the open throttle
      const iy = this.inB * (draw + white * 0.02 * thr * thr * rpm / this.redline) + this.inA1 * this.inZ1 + this.inA2 * this.inZ2;
      this.inZ2 = this.inZ1; this.inZ1 = iy;
      // engine bay: a dull knock per firing
      this.bayLp1 += 0.03 * (this.bayClick - this.bayLp1); this.bayLp2 += 0.03 * (this.bayLp1 - this.bayLp2); this.bayClick = 0;
      let mid = this.intakeGain * iy * 0.25 + this.bayGain * (this.bayLp1 - this.bayLp2) * 6;

      // turbo: a whistle at shaft speed, and the blow-off when the throttle shuts under boost
      if (this.turbo) {
        this.whistle += (25000 + 150000 * Math.sqrt(boost)) / 60 / sr; if (this.whistle >= 1) this.whistle -= 1;
        if (this.lastThr > 0.25 && thr <= 0.25 && boost > 0.35) this.bov = boost;
        this.bov -= this.bov * 4 / sr;
        mid += 0.012 * boost * boost * Math.sin(2 * Math.PI * this.whistle) + (white - this.nLp) * (0.02 * boost + 0.25 * this.bov);
      }
      this.lastThr = thr;
      // supercharger: lobe events at a fixed multiple of engine speed
      if (this.blowerOrder > 0) {
        this.blower += this.blowerOrder * rpm / 60 / sr; if (this.blower >= 1) this.blower -= 1;
        const w = 2 * Math.PI * this.blower;
        mid += 0.02 * (0.3 + 0.7 * loadP) * Math.min(1, rpm / (0.5 * this.redline)) * (Math.sin(w) + 0.4 * Math.sin(2 * w));
      }

      // mix, remove any standing offset, and limit softly: always inside -1..1
      let l = this.exhaustGain * exL * 10 + mid, r = this.exhaustGain * exR * 10 + mid;
      this.dcL += 0.0005 * (l - this.dcL); this.dcR += 0.0005 * (r - this.dcR); l -= this.dcL; r -= this.dcR;
      left[s] = l / (1 + (l < 0 ? -l : l)); right[s] = r / (1 + (r < 0 ? -r : r));
    }
  }
}
