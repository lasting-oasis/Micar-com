/* Night Tuner 04-physics.js — vehicle dynamics (no DOM, no THREE), ported verbatim.
   Two-axle model: longitudinal load transfer, friction ellipse per axle, nonlinear lateral tire curve,
   engine torque curve → gearbox → wheels, turbo spool, nitrous bottle, hand brake, counter-steer assist. */

export type Drive = 'FWD' | 'RWD' | 'AWD';
export type VehicleSpec = { id: string; name: string; drive: Drive; mass: number; a: number; b: number; h: number; cd: number; area: number; redline: number; r: number; fin: number; gears: number[]; tq: [number, number][]; gripMul?: number };
type Tier = 0 | 1 | 2 | 3;
export type PerfCfg = { engine: Tier; ecu: Tier; turbo: Tier; trans: Tier; susp: Tier; nos: Tier; tires: Tier; brakes: Tier; weight: Tier };
export type Tune = { turbo: number; nitrous: number; aero: number; bias: number; ride: number; stiff: number; steer: number; gears: number };

export type Params = {
  spec: VehicleSpec; mass: number; a: number; b: number; L: number; h: number; Iz: number;
  mu: number; B: number; yawDamp: number;
  brakeMu: number; bias: number;
  cdA: number; downK: number; roll: number;
  tq: [number, number][]; tqMul: number; peakT: number; redline: number; idle: number;
  gears: number[]; rev: number; fin: number; r: number; eff: number; shiftT: number;
  turbo: { gain: number; spool: number } | null;
  nos: { cap: number; pow: number; regen: number };
  drive: Drive; split: [number, number];
  steerMul: number;
};

export type Hydraulics = { f: number; r: number; l: number; vf: number; vr: number; vl: number; hop: number };

export type Vehicle = {
  P: Params; x: number; z: number; h: number; u: number; v: number; w: number; vx: number; vz: number; ax: number;
  rpm: number; gear: number; shift: number; boost: number; nos: number; nosOn: boolean; spinF: number; spinR: number;
  hand: boolean; beta: number; steer: number; delta: number;
  perfectT: number; perfect: boolean; perfectN?: number; overRev: number; revHold: number; Fdrive: number; thr: number; brk: number;
  odo: number; top: number; shiftFlash: number; bov: number; blown: boolean; hit: number; lights: boolean; high: boolean;
  hyd: Hydraulics;
};

export type Input = {
  fwd: number; back: number; steer: number; nos: boolean; hb: boolean; manual: boolean; shiftUp: boolean; shiftDn: boolean;
  hyd: boolean; hydF: boolean; hydR: boolean; hydL: boolean; hydRt: boolean; hop: boolean;
};

export const clamp = (v: number, a: number, b: number): number => v < a ? a : v > b ? b : v;
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const G9 = 9.81;
export function curveAt(tbl: [number, number][], x: number): number { if (x <= tbl[0][0]) return tbl[0][1]; for (let i = 1; i < tbl.length; i++) { if (x <= tbl[i][0]) { const [x0, y0] = tbl[i - 1], [x1, y1] = tbl[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } } return tbl[tbl.length - 1][1]; }
export function tireCurve(a: number, B: number): number { const C = 1.45, E = .6, Bx = B * a; return Math.sin(C * Math.atan(Bx - E * (Bx - Math.atan(Bx)))); }
const NOS_CAP = [0, 4, 6, 8], NOS_POW = [0, .3, .42, .55], SHIFT_T = [.42, .32, .24, .17], DT_EFF = [.86, .89, .92, .94];

export function carParams(spec: VehicleSpec, perf: PerfCfg, tune: Tune): Params {
  const p = perf, t = tune;
  const mass = spec.mass * (1 - .035 * p.weight), L = spec.a + spec.b, aero = (t.aero + 1) / 2, s01 = (t.stiff + 1) / 2;
  const tqMul = (1 + .11 * p.engine) * (1 + .045 * p.ecu), peakT = Math.max(...spec.tq.map(q => q[1])) * tqMul;
  return {
    spec, mass, a: spec.a, b: spec.b, L, h: spec.h * (1 - .14 * (t.ride + 1) / 2), Iz: .16 * mass * L * L,
    mu: 1.02 * (1 + .055 * p.tires) * (1 + .025 * p.susp) * (spec.gripMul ?? 1), B: 16 + 1.5 * p.susp + 4 * s01, yawDamp: 1.0 * (1.3 - .6 * s01),
    brakeMu: 1 + .06 * p.brakes, bias: .62 + .12 * t.bias,
    cdA: .5 * 1.22 * spec.cd * spec.area * (1 + .35 * aero), downK: aero * .4 * mass * G9 / (55 * 55), roll: .013 * mass * G9,
    tq: spec.tq, tqMul, peakT, redline: spec.redline + 150 * p.ecu, idle: 900,
    gears: spec.gears, rev: 3.2, fin: spec.fin * (1 + .12 * t.gears), r: spec.r, eff: DT_EFF[p.trans], shiftT: SHIFT_T[p.trans],
    turbo: p.turbo ? { gain: (.11 + .09 * p.turbo) * (1 + .2 * t.turbo), spool: clamp(.5 + .35 * t.turbo, .18, .9) } : null,
    nos: { cap: NOS_CAP[p.nos] * (1 - .3 * t.nitrous), pow: NOS_POW[p.nos] * (1 + .3 * t.nitrous), regen: NOS_CAP[p.nos] / 55 },
    drive: spec.drive, split: spec.drive === 'FWD' ? [1, 0] : spec.drive === 'RWD' ? [0, 1] : [.4, .6],
    steerMul: 1 + .2 * t.steer,
  };
}
export function torqueAt(P: Params, rpm: number, boost: number): number { let Tq = curveAt(P.tq, rpm) * P.tqMul; if (P.turbo) Tq *= 1 + P.turbo.gain * boost * (.55 + .45 * Math.min(1, rpm / P.redline)); return Tq; }
/** The revs a car pulls away at with the pedal down: the lowest speed at which its engine makes 90% of its peak torque (500 rpm more with a turbo, to make boost). */
export function launchRpm(P: Params): number {
  const want = Math.max(...P.tq.map(q => q[1])) * .9; let at = P.tq[P.tq.length - 1][0];
  for (let i = 0; i < P.tq.length; i++) { const [x1, y1] = P.tq[i]; if (y1 >= want) { if (i === 0) at = x1; else { const [x0, y0] = P.tq[i - 1]; at = x0 + (x1 - x0) * (want - y0) / (y1 - y0); } break; } }
  return clamp(at + (P.turbo ? 500 : 0), P.idle + 600, P.redline * .6);
}
export function makeVehicle(P: Params): Vehicle {
  return {
    P, x: 0, z: 0, h: 0, u: 0, v: 0, w: 0, vx: 0, vz: 0, ax: 0, rpm: P.idle, gear: 1, shift: 0, boost: 0, nos: P.nos.cap, nosOn: false, spinF: 0, spinR: 0, hand: false, beta: 0, steer: 0, delta: 0,
    perfectT: 0, perfect: false, overRev: 0, revHold: 0, Fdrive: 0, thr: 0, brk: 0, odo: 0, top: 0, shiftFlash: 0, bov: 0, blown: false, hit: 0, lights: true, high: false,
    hyd: { f: 0, r: 0, l: 0, vf: 0, vr: 0, vl: 0, hop: 0 },
  };
}
export const NO_INPUT: Input = { fwd: 0, back: 0, steer: 0, nos: false, hb: false, manual: false, shiftUp: false, shiftDn: false, hyd: false, hydF: false, hydR: false, hydL: false, hydRt: false, hop: false };

function engineStep(V: Vehicle, I: Input, dt: number): number {
  const P = V.P, nG = P.gears.length;
  let thr: number, brk: number;
  if (V.gear === -1) { thr = I.back; brk = I.fwd; if (V.u > -.8 && I.fwd > 0 && !I.back) { V.gear = 1; thr = I.fwd; brk = 0; } }
  else { thr = I.fwd; brk = I.back; if (V.u < .8 && I.back > 0 && !I.fwd) { V.revHold += dt; if (V.revHold > .25) { V.gear = -1; thr = I.back; brk = 0; } } else V.revHold = 0; }
  V.thr = thr; V.brk = brk; V.perfect = false;
  if (V.shift > 0) V.shift -= dt;
  if (I.manual) {
    if (I.shiftUp) { if (V.gear === -1) V.gear = 1; else if (V.gear < nG && V.shift <= 0) { if (V.rpm > P.redline * .9 && V.rpm <= P.redline + 150) { V.perfectT = 1.2; V.perfect = true; V.perfectN = (V.perfectN || 0) + 1; } V.gear++; V.shift = P.shiftT; V.shiftFlash = .25; } }
    if (I.shiftDn && V.shift <= 0) { if (V.gear > 1) { V.gear--; V.shift = P.shiftT * .8; } else if (V.gear === 1 && Math.abs(V.u) < 1.5) V.gear = -1; }
  } else if (V.gear > 0 && V.shift <= 0) {
    if (V.rpm > P.redline * .96 && V.gear < nG && thr > 0) { V.gear++; V.shift = P.shiftT; V.shiftFlash = .25; }
    else if (V.gear > 1 && V.rpm < P.redline * .42) { V.gear--; V.shift = P.shiftT * .6; }
  }
  const ratio = V.gear === -1 ? -P.rev : P.gears[V.gear - 1], total = ratio * P.fin;
  const wheelRpm = V.u / P.r * 60 / (2 * Math.PI);
  if (V.shift > 0) { const rpmT = P.idle + thr * (P.redline - P.idle) * .9; V.rpm += (rpmT - V.rpm) * Math.min(1, dt * (thr ? 5 : 3)); }
  else {
    // Pulling away, the clutch (or converter) slips: the engine sits where its own torque comes in and the slip closes as the wheels catch up, so the revs only rise.
    const r = Math.abs(wheelRpm * total), slip = thr > 0 && (V.gear === 1 || V.gear === -1) ? P.idle + thr * (launchRpm(P) - P.idle) : 0;
    V.rpm = Math.max(P.idle, slip > 0 ? Math.cbrt(slip ** 3 + r ** 3) : r);
  }
  if (P.turbo) { const bt = (thr > .3 && V.rpm > 2200 && V.shift <= 0) ? clamp((V.rpm - 2200) / 3000, 0, 1) : 0; const rate = bt > V.boost ? dt / P.turbo.spool : dt / .22; if (bt < V.boost - .3 && V.boost > .5 && V.bov <= 0) V.bov = .4; V.boost += clamp(bt - V.boost, -rate, rate); }
  if (V.bov > 0) V.bov -= dt;
  let Tq = torqueAt(P, V.rpm, V.boost);
  const nosOn = !!(I.nos && V.nos > 0 && thr > .1 && V.gear > 0 && V.shift <= 0);
  if (nosOn) { V.nos = Math.max(0, V.nos - dt); Tq *= 1 + P.nos.pow; } else V.nos = Math.min(P.nos.cap, V.nos + P.nos.regen * dt);
  V.nosOn = nosOn;
  if (V.rpm > P.redline + 150) Tq = 0;
  V.overRev = clamp(V.overRev + ((V.rpm > P.redline + 100 && thr > 0 && V.shift <= 0) ? dt : -dt * 2), 0, 3);
  if (V.perfectT > 0) { V.perfectT -= dt; Tq *= 1.1; }
  if (V.shiftFlash > 0) V.shiftFlash -= dt;
  let Tw: number;
  if (V.shift > 0 || V.blown) Tw = 0;
  else if (thr > 0) Tw = Tq * thr * total * P.eff;
  else Tw = -.12 * P.peakT * (V.rpm / P.redline) * Math.abs(total) * (V.u > 0 ? 1 : V.u < 0 ? -1 : 0);
  V.Fdrive = Tw / P.r;
  return brk;
}
function hydStep(V: Vehicle, I: Input, dt: number): void {
  const H = V.hyd, k = 70, c = 9;
  const tf = I.hyd && I.hydF ? 1 : 0, tr = I.hyd && I.hydR ? 1 : 0, tl = I.hyd ? (I.hydL ? 1 : I.hydRt ? -1 : 0) : 0;
  if (I.hop && H.hop <= 0) { H.vf += 4.5; H.vr += 4.5; H.hop = .6; } if (H.hop > 0) H.hop -= dt;
  const sp = (x: number, v: number, t: number): [number, number] => { v += (k * (t - x) - c * v) * dt; x += v * dt; return [x, v]; };
  [H.f, H.vf] = sp(H.f, H.vf, tf * .3); [H.r, H.vr] = sp(H.r, H.vr, tr * .3); [H.l, H.vl] = sp(H.l, H.vl, tl * .25);
}
export function stepVehicle(V: Vehicle, I: Input, dt: number, drift: boolean): void {
  const P = V.P, m = P.mass;
  const brk = engineStep(V, I, dt);
  const spd = Math.abs(V.u), ux = Math.max(spd, 1.2);
  const dmax = (.62 / (1 + Math.pow(spd / 11, 1.4)) + .03) * P.steerMul * (drift ? 1.25 : 1);
  const tgt = -I.steer; V.steer += (tgt - V.steer) * Math.min(1, dt * (Math.abs(tgt) < Math.abs(V.steer) ? 10 : 7));
  V.beta = Math.atan2(V.v, ux);
  // counter-steer assist is for sliding forward; reversing has none
  const kcs = V.u < 0 ? 0 : (drift ? 1.3 : 1.0) * clamp((spd - 3) / 5, 0, 1);
  const fade = 1 - (drift ? .3 : .6) * Math.min(1, Math.abs(V.beta) / .5);
  const delta = clamp(V.steer * dmax * fade + kcs * V.beta, -dmax - .3, dmax + .3); V.delta = delta;
  const down = P.downK * V.u * V.u;
  const Fzf = Math.max(.15 * m * G9, m * G9 * P.b / P.L - m * V.ax * P.h / P.L + down * .45);
  const Fzr = Math.max(.15 * m * G9, m * G9 * P.a / P.L + m * V.ax * P.h / P.L + down * .55);
  const muF = P.mu * (drift ? 1 : 1), muR = P.mu * (drift ? .68 : 1.03);
  const [sf, sr] = drift ? [.3, .7] : P.split;
  let Fxf = V.Fdrive * sf, Fxr = V.Fdrive * sr;
  const dirU = V.u > 0 ? 1 : V.u < 0 ? -1 : 0;
  const Fb = brk * m * G9 * P.brakeMu * 1.1;
  Fxf -= Fb * P.bias * dirU; Fxr -= Fb * (1 - P.bias) * dirU;
  if (I.hb) { Fxr = -dirU * muR * Fzr * 1.2; V.hand = true; } else V.hand = false;
  const capF = muF * Fzf, capR = muR * Fzr;
  let spinF = 0, spinR = 0;
  if (Math.abs(Fxf) > capF) { Fxf = Math.sign(Fxf) * capF * .92; spinF = 1; }
  if (Math.abs(Fxr) > capR) { Fxr = Math.sign(Fxr) * capR * .92; spinR = 1; }
  V.spinF += (spinF - V.spinF) * Math.min(1, dt * 8); V.spinR += (spinR - V.spinR) * Math.min(1, dt * 8);
  const ellF = Math.sqrt(Math.max(0, 1 - (Fxf / capF) ** 2)), ellR = Math.sqrt(Math.max(0, 1 - (Fxr / capR) ** 2));
  const latF = capF * Math.max(spinF ? .45 : .2, ellF), latR = capR * Math.max(I.hb ? (drift ? .12 : .2) : spinR ? (drift ? .55 : .45) : .2, ellR);
  // slip against the way the tyre is rolling: when it rolls backwards the steered wheel pushes the other way, so reversing turns the car the way a real one does
  const af = (V.u < 0 ? -delta : delta) - Math.atan2(V.v + P.a * V.w, ux), ar = -Math.atan2(V.v - P.b * V.w, ux);
  const Fyf = latF * tireCurve(af, P.B), Fyr = latR * tireCurve(ar, P.B * 1.05);
  const Fres = P.cdA * V.u * Math.abs(V.u) + P.roll * Math.tanh(V.u * 2);
  const cd = Math.cos(delta), sd = Math.sin(delta);
  const Fx = Fxf * cd - Fyf * sd + Fxr - Fres, Fy = Fyf * cd + Fyr;
  const Mz = P.a * (Fyf * cd + Fxf * sd) - P.b * Fyr - P.yawDamp * P.Iz * V.w * (drift ? .5 : 1);
  const axl = Fx / m;
  V.ax += (axl - V.ax) * Math.min(1, dt * 10);
  V.u += (axl + V.v * V.w) * dt; V.v += (Fy / m - V.u * V.w) * dt; V.w += Mz / P.Iz * dt;
  if (brk > 0 && V.thr === 0 && Math.abs(V.u) < .5) V.u = 0;
  if (spd < 3) { V.v *= Math.exp(-dt * 5); V.w *= Math.exp(-dt * 2); }
  V.h += V.w * dt;
  const sh = Math.sin(V.h), ch = Math.cos(V.h);
  V.vx = V.u * sh + V.v * ch; V.vz = V.u * ch - V.v * sh;
  V.x += V.vx * dt; V.z += V.vz * dt; V.odo += spd * dt; V.top = Math.max(V.top, spd);
  hydStep(V, I, dt);
}
export function syncBody(V: Vehicle): void { const sh = Math.sin(V.h), ch = Math.cos(V.h); V.u = V.vx * sh + V.vz * ch; V.v = V.vx * ch - V.vz * sh; }
export function resetVehicle(V: Vehicle, x: number, z: number, h: number): void { V.x = x; V.z = z; V.h = h; V.u = V.v = V.w = V.vx = V.vz = V.ax = 0; V.gear = 1; V.shift = 0; V.rpm = V.P.idle; V.steer = V.delta = V.beta = 0; V.boost = 0; V.overRev = 0; V.blown = false; V.hit = 0; }

/* straight-line simulation for the garage stat bars and the AI's idea of how fast the player is */
export function simStats(P: Params): { t100: number | null; t200: number | null; top: number; hp: number; hpRpm: number; grip: number; brake: number } {
  const V = makeVehicle(P); const I: Input = Object.assign({}, NO_INPUT, { fwd: 1 }); let t = 0, t100: number | null = null, t200: number | null = null, top = 0;
  for (let i = 0; i < 30 * 70; i++) { stepVehicle(V, I, 1 / 30, false); t += 1 / 30; const k = V.u * 3.6; if (t100 === null && k >= 100) t100 = t; if (t200 === null && k >= 200) t200 = t; top = Math.max(top, k); }
  let hp = 0, hpR = 0; for (let i = 0; i <= 40; i++) { const r = 1000 + i * (P.redline - 1000) / 40; const h = torqueAt(P, r, P.turbo ? clamp((r - 2200) / 3000, 0, 1) : 0) * r / 7121; if (h > hp) { hp = h; hpR = r; } }
  return { t100, t200, top, hp: Math.round(hp), hpRpm: Math.round(hpR / 100) * 100, grip: P.mu, brake: P.brakeMu };
}
export function dynoCurve(P: Params): [rpm: number, nm: number, hp: number][] { const out: [rpm: number, nm: number, hp: number][] = []; for (let i = 0; i <= 48; i++) { const r = 1000 + i * (P.redline - 1000) / 48; const tq = torqueAt(P, r, P.turbo ? clamp((r - 2200) / 3000, 0, 1) : 0); out.push([r, tq, tq * r / 7121]); } return out; }
