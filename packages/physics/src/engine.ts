// The engine, modelled as airflow (DESIGN.md 5.1).
// The published peaks become a full-throttle target curve. The air model divides the boost out of that curve, leaving
// the engine's own breathing (`air.specific`), which is what a part changes; rebuildTables multiplies the boost back in
// and takes friction off to give the tables the step reads. buildEngine and rebuildTables run once per car or build;
// engineTorque and boostStep run in every substep and allocate nothing.
import type { EngineAir, EngineKind, EngineModel } from './types';
import { P_AMBIENT, PI, T_AMBIENT, curveAt, dexp, dln, dpow, hermite, tableAt } from './math';
import { LITRE, RPM } from './units';
import { CHARGE_AIR, COMPRESSOR_EFFICIENCY, KNOCK_LIMIT_PR } from './classes';

/** The published figures buildEngine needs, already in SI (resolve.ts converts them). */
export type EngineSpec = {
  kind: EngineKind; displacementL: number; cylinders: number;
  peakPower: number; peakPowerOmega: number;                 // W, rad/s
  peakTorque: number; peakTorqueOmegaLow: number; peakTorqueOmegaHigh: number;   // N m, rad/s (equal when there is no plateau)
  redline: number; idle: number;                              // rad/s
  boostPa: number;                                            // gauge pressure at full boost, 0 when not boosted
  inertia: number;                                            // kg m^2
  curve: [number, number][] | null;                           // authored [rad/s, N m], used as given when present
};

/** Indicated work an engine gets from one kg of air at a full-throttle mixture, J/kg: what turns an airflow limit into a torque limit. */
export const AIR_ENERGY = 1.15e6;

// Friction mean effective pressure of a petrol engine, Pa, against speed in thousands of rpm (Heywood's fit; DESIGN.md's start).
const PETROL_FMEP_0 = 97e3, PETROL_FMEP_1 = 15e3, PETROL_FMEP_2 = 5e3;
// Extra mean effective pressure lost pumping against a closed throttle, Pa.
const PUMPING_MEP = 35e3;
const FOUR_PI = 4 * PI;
// Full-throttle torque at idle as a share of peak: an unboosted engine (or one with a crank-driven blower) already
// breathes well there; a turbocharged one has no boost yet.
const IDLE_SHARE = 0.6, IDLE_SHARE_TURBO = 0.45;
// A turbo starts to make boost at this share of the speed where it reaches full boost.
const THRESHOLD_SHARE = 0.45;
// Below that threshold a turbo engine is an unboosted engine, whose torque rises only gently with speed: this
// elasticity (d ln T / d ln omega) gives about 11% more torque for each doubling of speed.
const UNBOOSTED_RISE = 0.15;
// Power past its peak: power at redline = peak / (1 + REDLINE_FALL * (redline / power speed - 1)). For a power peak 7%
// below redline that leaves about 88% of the power-peak torque at redline (DESIGN.md's figure), more when the peak sits
// just under redline (no cliff in the last 200 rpm) and less when it is far below (power must still fall).
const REDLINE_FALL = 0.65;
// Rev limiter: full-throttle torque fades to nothing over this share of redline past it.
const LIMITER_SHARE = 0.03;
// An engine with an air model gets tables reaching this far past redline + limiter band, so that the parts that raise
// the redline (up to 1,400 rpm all together) still find table under it.
const HEADROOM = 1.2, HEADROOM_RPM = 1500;
// Table steps tried, rpm. Round steps put round published speeds on table points; neighbours are at most 1.5 apart,
// so the first step that keeps n within N_MAX also keeps it at 64 or more.
const STEPS_RPM = [10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 750, 1000];
const N_MAX = 96;
// Stock charge air (intercooler, compressor, a blower's drive) and the pump-fuel knock limit come from classes.ts, the
// one place a typical value lives (DESIGN.md rule 2).
const STOCK_COMPRESSOR = COMPRESSOR_EFFICIENCY;
// Below this engine speed, rad/s, the closed-throttle drag fades to nothing at rest and turns round to oppose a
// backward spin: drag opposes motion, it never drives a stopped shaft (half a radian a second is far below any idle).
const DRAG_FADE = 0.5;
// A supercharger is driven by the crank, so it already makes this share of its boost at idle.
const SUPERCHARGER_IDLE_BOOST = 0.6;
// Pressure ratio pump fuel allows before timing has to come out (DESIGN.md 11: race fuel lifts it to 3.3).
const KNOCK_PUMP_FUEL = KNOCK_LIMIT_PR;
// A production turbo or blower is matched with flow in hand at the engine's highest stock airflow: the margin a tune
// uses. Tuned stock-turbo cars gain about a third (data/exam: a GTI from 215 to 285 wheel hp on its own turbo).
const AIRFLOW_MARGIN = 1.3;
// (gamma - 1) / gamma for air: the exponent of a compressor's isentropic temperature rise.
const ISENTROPIC = 0.286;
// Turbo lag, DESIGN.md 5.1's starting figures: s, and the reference speed in rpm.
const TAU_REF = 0.45, OMEGA_REF_RPM = 3000, TAU_MIN = 0.12, TAU_MAX = 1.6, FALL_TAU = 0.15;
// Idle governor: it can add up to 40% of peak torque, all of it by 20% of idle below its set point, and never acts
// above 1.5 x idle.
const GOVERNOR_CAP = 0.4, GOVERNOR_SPAN = 0.2, GOVERNOR_REACH = 1.5;
// Electric: regenerative torque on a lifted throttle as a share of peak torque (about 0.2 g of lift-off braking in a
// typical single-speed EV), and the share of the motor's speed range over which its power tapers out.
const REGEN = 0.2, EV_TAPER = 0.1;

/* ------------------------------------------------------------------ the target curve (build time only) */

/**
 * The full-throttle curve the published figures describe. A combustion engine's is a piecewise cubic Hermite in
 * log speed and log torque, whose slope is the curve's elasticity (d ln T / d ln omega): 0 at a torque peak, -1 at a
 * power peak (that is where power stops rising). From the torque peak on, each piece's slopes are chosen so it is a
 * quadratic, so elasticity runs straight between knots and can never leave [-1, 0] between the torque and power
 * peaks: torque never rises there and power never falls, so neither peak can be beaten anywhere else. Below the
 * torque peak torque only rises, so it cannot beat either peak there either.
 */
type Target = {
  mode: 'peaks' | 'electric' | 'authored';
  curve: [number, number][];
  /** After making the figures consistent: idle, boost threshold, torque plateau, power peak, rad/s and N m. */
  wIdle: number; tIdle: number; wThreshold: number; wLow: number; wHigh: number; tMax: number; wPower: number; tPower: number; pMax: number;
  /**
   * Knots in rising speed: idle, (a turbo's threshold), torque low, torque high, mid, power, redline.
   * u = ln omega, y = ln T, e = dy/du. The piece starting at knot `plateau` is the flat top.
   */
  ku: number[]; ky: number[]; ke: number[]; plateau: number;
  /** Electric: base speed (torque gives way to power), start of the taper, top speed. */
  wBase: number; wTaper: number; wEnd: number;
};

function makeTarget(spec: EngineSpec): Target {
  const tMax = spec.peakTorque, pMax = spec.peakPower;
  const t: Target = {
    mode: 'peaks', curve: [], wIdle: 0, tIdle: 0, wThreshold: 0, wLow: 0, wHigh: 0, tMax, wPower: 0, tPower: 0, pMax,
    ku: [], ky: [], ke: [], plateau: 0, wBase: 0, wTaper: 0, wEnd: 0,
  };
  if (spec.kind === 'electric') {
    t.mode = 'electric';
    t.wBase = pMax / tMax; t.wEnd = spec.redline; t.wTaper = (1 - EV_TAPER) * spec.redline;
    return t;
  }
  if (spec.curve !== null && spec.curve.length > 0) { t.mode = 'authored'; t.curve = spec.curve; return t; }

  // Published figures that cannot all be true are made consistent here, never silently elsewhere: the torque at the
  // power peak must be below peak torque, and power on the torque plateau must stay below peak power.
  const wPower = Math.max(spec.peakPowerOmega, 1.02 * pMax / tMax);
  const wHigh = Math.min(Math.max(spec.peakTorqueOmegaHigh, spec.peakTorqueOmegaLow), 0.97 * pMax / tMax);
  const wLow = Math.min(spec.peakTorqueOmegaLow, wHigh);
  const wIdle = spec.idle > 0 ? Math.min(spec.idle, 0.8 * wLow) : 0.3 * wLow;
  const turbo = spec.kind === 'turbo';
  const tIdle = (turbo ? IDLE_SHARE_TURBO : IDLE_SHARE) * tMax;
  const tPower = pMax / wPower;
  const wRed = Math.max(spec.redline, 1.02 * wPower);
  const powerAtRed = pMax / (1 + REDLINE_FALL * (wRed / wPower - 1));
  t.wIdle = wIdle; t.tIdle = tIdle; t.wLow = wLow; t.wHigh = wHigh; t.wPower = wPower; t.tPower = tPower;
  t.wThreshold = Math.max(THRESHOLD_SHARE * wLow, wIdle);

  const uI = dln(wIdle), uL = dln(wLow), uH = dln(wHigh), uP = dln(wPower), uR = dln(wRed);
  const yI = dln(tIdle), yM = dln(tMax), yP = dln(tPower), yR = dln(powerAtRed / wRed);
  const ku: number[] = [], ky: number[] = [], ke: number[] = [];
  if (turbo) {
    // Unboosted up to the threshold, then the boost lifts it to the plateau: one cubic from the gentle unboosted
    // slope to slope 0. Its secant is far steeper than either end slope, so it rises monotonically, in an S.
    ku.push(uI); ky.push(yI); ke.push(UNBOOSTED_RISE);
    if (t.wThreshold > 1.001 * wIdle) {
      // The boost always adds at least 10% (in log torque), which keeps the cubic's secant above its end slopes.
      const uT = dln(t.wThreshold);
      ku.push(uT); ky.push(Math.min(yI + UNBOOSTED_RISE * (uT - uI), yM - 0.1)); ke.push(UNBOOSTED_RISE);
    }
  } else {
    // Idle to torque peak: elasticity falls straight from eI to 0, steep early and rounding into the peak, as an
    // unboosted engine (or one with a crank-driven blower) fills its cylinders better and better.
    ku.push(uI); ky.push(yI); ke.push(2 * (yM - yI) / (uL - uI));
  }
  t.plateau = ku.length;
  ku.push(uL, uH); ky.push(yM, yM); ke.push(0, 0);
  // Torque peak to power peak: elasticity 0 -> -lam -> -1 with the middle knot at (1 - lam) of the way, which makes
  // the average -lam, as the two peaks demand. lam is in (0, 1) because the figures were made consistent above.
  const span = uP - uH, lam = (yM - yP) / span;
  ku.push(uH + (1 - lam) * span); ky.push(yM - 0.5 * lam * (1 - lam) * span); ke.push(-lam);
  ku.push(uP); ky.push(yP); ke.push(-1);
  // Power peak to redline: elasticity from -1 straight to eR, which lands on the power chosen for redline.
  ku.push(uR); ky.push(yR); ke.push(2 * dln(powerAtRed / pMax) / (uR - uP) - 1);
  t.ku = ku; t.ky = ky; t.ke = ke;
  return t;
}

function targetAt(t: Target, w: number): number {
  if (t.mode === 'authored') return curveAt(t.curve, w);
  if (t.mode === 'electric') {
    let torque = w <= t.wBase ? t.tMax : t.pMax / w;
    if (w > t.wTaper) torque *= w >= t.wEnd ? 0 : (t.wEnd - w) / (t.wEnd - t.wTaper);
    return torque;
  }
  // Below idle the table holds the idle figure: the model has no stall, and the clutch and idle governor keep a
  // running engine near idle, so this only has to be finite and sensible.
  if (w <= t.wIdle) return t.tIdle;
  const u = dln(w), ku = t.ku, ky = t.ky, ke = t.ke, last = ku.length - 1;
  if (u >= ku[last]) return dexp(ky[last] + ke[last] * (u - ku[last]));   // past redline: the same elasticity on
  for (let k = 0; k < last; k++) {
    // A plateau of zero width is never entered: u < ku[k + 1] = ku[k] cannot hold once u >= ku[k].
    if (u < ku[k + 1]) return k === t.plateau ? t.tMax : dexp(hermite(ku[k], ky[k], ke[k], ku[k + 1], ky[k + 1], ke[k + 1], u));
  }
  return dexp(ky[last]);
}

/** The full-throttle torque (N m) the published figures describe at this speed: the curve buildEngine aims the tables at. */
export function targetTorque(spec: EngineSpec, omega: number): number {
  return targetAt(makeTarget(spec), omega);
}

/* ------------------------------------------------------------------ air */

/** Closed-throttle friction torque from a friction mean effective pressure fit, N m (a positive number). */
function fmepTorque(fmep: readonly number[], displacement: number, omega: number): number {
  const x = omega / (1000 * RPM);   // thousands of rpm, the unit the fit is written in
  return (fmep[0] + fmep[1] * x + fmep[2] * x * x) * displacement / FOUR_PI;
}

/** Charge density over ambient for a manifold pressure ratio: compression heats the charge, the intercooler takes some back. */
function densityRatio(pr: number, intercooler: number, compressorEff: number): number {
  const tMan = T_AMBIENT + (1 - intercooler) * T_AMBIENT * (dpow(pr, ISENTROPIC) - 1) / compressorEff;
  return pr * T_AMBIENT / tMan;
}

/** Share of indicated torque spent driving a blower at this pressure ratio (0 for a turbo, whose drive is the exhaust). */
function blowerShare(air: EngineAir, pr: number, prPeak: number): number {
  return air.blowerDrive > 0 && prPeak > 1 ? air.blowerDrive * (pr - 1) / (prPeak - 1) : 0;
}

/** Table step for a table that must reach past `span` rad/s with at most N_MAX points. */
function tableStep(span: number): number {
  for (let k = 0; k < STEPS_RPM.length; k++) {
    const d = STEPS_RPM[k] * RPM;
    if (Math.floor(span / d) + 2 <= N_MAX) return d;
  }
  return span / (N_MAX - 3);
}

/**
 * Builds an engine from its published figures: the target curve, friction from fmep and, for a combustion engine
 * described by its peaks, the air model with the boost divided out. An electric motor and an authored curve get
 * air = null and their tables are written here, once. Throws for a spec built from its peaks whose peak torque or
 * power is not a positive, finite number.
 */
export function buildEngine(spec: EngineSpec): EngineModel {
  const electric = spec.kind === 'electric';
  // The curve is built from the two peaks (an electric motor's from its torque and power) unless one is authored. A
  // peak that is not a positive number would give no curve at all (a zero torque puts the power peak at infinite
  // speed), so such a spec is refused here rather than built into NaN or an endless table.
  if (electric || spec.curve === null || spec.curve.length === 0) {
    if (!(spec.peakTorque > 0 && spec.peakTorque < Infinity)) throw new Error(`buildEngine: peak torque must be a positive number of N m, not ${spec.peakTorque}`);
    if (!(spec.peakPower > 0 && spec.peakPower < Infinity)) throw new Error(`buildEngine: peak power must be a positive number of W, not ${spec.peakPower}`);
  }
  const target = makeTarget(spec);
  const hasAir = target.mode === 'peaks';
  const turbo = spec.kind === 'turbo' && hasAir;
  const limiterBand = LIMITER_SHARE * spec.redline;
  const reach = spec.redline + limiterBand;
  const span = hasAir ? Math.max(HEADROOM * reach, reach + HEADROOM_RPM * RPM) : reach;
  const dOmega = tableStep(span);
  const n = Math.floor(span / dOmega) + 2;
  const displacement = electric ? 0 : spec.displacementL * LITRE;
  const e: EngineModel = {
    kind: spec.kind, displacement, cylinders: spec.cylinders, inertia: spec.inertia, idle: spec.idle,
    redline: spec.redline, limiterBand, n, dOmega,
    wot: new Float64Array(n), offBoost: new Float64Array(n), friction: new Float64Array(n),
    boost: turbo ? { tauRef: TAU_REF, omegaRef: OMEGA_REF_RPM * RPM, tauMin: TAU_MIN, tauMax: TAU_MAX, fallTau: FALL_TAU } : null,
    regen: electric ? REGEN : 0,
    air: null,
  };
  const fmep: [number, number, number] = [PETROL_FMEP_0, PETROL_FMEP_1, PETROL_FMEP_2];

  if (!hasAir) {
    for (let i = 0; i < n; i++) {
      const w = i * dOmega;
      e.wot[i] = targetAt(target, w);
      e.offBoost[i] = e.wot[i];
      // An electric motor has next to no friction; its closed-throttle drag is regeneration, which fades in from
      // standstill (so a stopped car does not creep backwards) and is whole by the motor's base speed.
      e.friction[i] = electric ? REGEN * target.tMax * Math.min(1, w / target.wBase) : fmepTorque(fmep, displacement, w);
    }
    return e;
  }

  const boosted = spec.kind !== 'na' && spec.boostPa > 0;
  const prMax = boosted ? 1 + spec.boostPa / P_AMBIENT : 1;
  const supercharged = boosted && spec.kind === 'supercharged';
  const charge = CHARGE_AIR[supercharged ? 'supercharged' : 'turbo'];
  const intercooler = boosted ? charge.intercooler : 0;
  const blowerDrive = boosted ? charge.blowerDrive : 0;
  const pressureRatio = new Float64Array(n), specific = new Float64Array(n);
  const air: EngineAir = {
    specific, pressureRatio, intercooler, compressorEff: STOCK_COMPRESSOR, fmep,
    maxAirflow: Infinity, knockLimitPr: Math.max(KNOCK_PUMP_FUEL, prMax), blowerDrive,
  };

  // Full-boost pressure ratio. A turbo's rises from its threshold to full boost at the start of the torque plateau in
  // step with the target's rise (the boost is what makes that rise); a supercharger's is mostly there from idle. Both
  // hold to the power peak and then taper with the target curve, as the compressor runs out of flow.
  const wThreshold = target.wThreshold;
  const tThreshold = targetAt(target, wThreshold);
  let peakFlow = 0;
  for (let i = 0; i < n; i++) {
    const w = i * dOmega, tq = targetAt(target, w);
    let share = 1;
    if (!boosted) share = 0;
    else if (w > target.wPower) share = tq / target.tPower;
    else if (w < target.wLow) {
      if (supercharged) {
        const rise = (tq - target.tIdle) / (target.tMax - target.tIdle);
        share = SUPERCHARGER_IDLE_BOOST + (1 - SUPERCHARGER_IDLE_BOOST) * (rise < 0 ? 0 : rise > 1 ? 1 : rise);
      } else {
        const rise = w <= wThreshold ? 0 : (tq - tThreshold) / (target.tMax - tThreshold);
        share = rise < 0 ? 0 : rise > 1 ? 1 : rise;
      }
    }
    const pr = share === 1 ? prMax : 1 + (prMax - 1) * share;
    pressureRatio[i] = pr;
    const dr = densityRatio(pr, intercooler, STOCK_COMPRESSOR);
    const friction = fmepTorque(fmep, displacement, w);
    // The engine's own breathing: indicated torque per unit of charge density, the blower's drive put back.
    specific[i] = (tq + friction) / (dr * (1 - blowerShare(air, pr, prMax)));
    const flow = specific[i] * dr * w / AIR_ENERGY;
    if (flow > peakFlow) peakFlow = flow;
  }
  if (boosted) air.maxAirflow = AIRFLOW_MARGIN * peakFlow;
  e.air = air;
  rebuildTables(e);
  return e;
}

/**
 * Rewrites wot, offBoost and friction from the air model, after a part has changed it. This is the only writer of
 * those tables for an engine with an air model; one without (electric, authored curve) is left as built.
 */
export function rebuildTables(e: EngineModel): void {
  const air = e.air;
  if (air === null) return;
  const pr = air.pressureRatio, specific = air.specific, d = e.dOmega;
  const turbo = e.kind === 'turbo';
  let prPeak = 1;
  for (let i = 0; i < e.n; i++) if (pr[i] > prPeak) prPeak = pr[i];
  // A turbo engine needs its own off-boost table; a model built by hand or converted by a part may share one.
  if (turbo && e.offBoost === e.wot) e.offBoost = new Float64Array(e.n);
  for (let i = 0; i < e.n; i++) {
    const w = i * d;
    const p = pr[i] < air.knockLimitPr ? pr[i] : air.knockLimitPr;   // boost past the knock limit is not used
    let indicated = specific[i] * densityRatio(p, air.intercooler, air.compressorEff);
    let unboosted = specific[i];
    if (w > 0) {
      // The induction can flow no more than maxAirflow, and each kg of air is worth AIR_ENERGY of indicated work.
      const cap = air.maxAirflow * AIR_ENERGY / w;
      if (indicated > cap) indicated = cap;
      if (unboosted > cap) unboosted = cap;
    }
    const friction = fmepTorque(air.fmep, e.displacement, w);
    e.friction[i] = friction;
    e.wot[i] = indicated * (1 - blowerShare(air, p, prPeak)) - friction;
    e.offBoost[i] = turbo ? unboosted - friction : e.wot[i];
  }
}

/* ------------------------------------------------------------------ in the step */

/** Pumping loss against a closed throttle, N m. */
function pumpingTorque(e: EngineModel): number {
  return PUMPING_MEP * e.displacement / FOUR_PI;
}

/**
 * How much of its full boost a fully spooled turbo can hold at this speed, 0 to 1: 0 below its threshold, rising
 * with the full-boost pressure ratio to 1 where that ratio stops rising, and 1 from there up (past the power peak the
 * taper is already in the wot table). Read from the pressure-ratio table, so a part that moves the threshold moves it.
 */
function spoolLimit(e: EngineModel, omega: number): number {
  const air = e.air;
  if (air === null) return 1;
  const pr = air.pressureRatio, last = e.n - 1;
  const f = omega > 0 ? omega / e.dOmega : 0;
  if (f >= last) return 1;
  const i = Math.floor(f);
  const p = pr[i] + (pr[i + 1] - pr[i]) * (f - i);
  if (!(p > 1)) return 0;
  if (!(pr[i + 1] > pr[i])) return 1;
  let j = i + 1;
  while (j < last && pr[j + 1] > pr[j]) j++;
  return (p - 1) / (pr[j] - 1);
}

/** Peak of the full-throttle table up to redline, N m. A scan: called only while the idle governor acts. */
function peakTorque(e: EngineModel): number {
  const top = Math.min(e.n - 1, Math.ceil(e.redline / e.dOmega));
  let m = 0;
  for (let i = 0; i <= top; i++) if (e.wot[i] > m) m = e.wot[i];
  return m;
}

/**
 * Idle governor torque at this speed with the throttle closed, N m. Its set point sits just above idle, by exactly
 * the drag it has to cover there, so that a free engine settles at idle itself rather than below it.
 */
function idleGovernor(e: EngineModel, omega: number): number {
  const idle = e.idle, d = e.dOmega;
  const hold = tableAt(e.friction, d, idle) + pumpingTorque(e);
  // Peak torque is at least the full-throttle torque at idle, which bounds the set point without the scan.
  const atIdle = tableAt(e.wot, d, idle);
  const most = (GOVERNOR_REACH - 1) * idle;
  let bound = hold * GOVERNOR_SPAN * idle / (GOVERNOR_CAP * (atIdle > hold ? atIdle : hold));
  if (bound > most) bound = most;
  if (omega >= idle + bound) return 0;
  const cap = GOVERNOR_CAP * peakTorque(e);
  if (!(cap > 0)) return 0;
  const k = cap / (GOVERNOR_SPAN * idle);
  let offset = hold / k;
  if (offset > most) offset = most;
  const g = (idle + offset - omega) * k;
  return g <= 0 ? 0 : g < cap ? g : cap;
}

/**
 * Brake torque (N m) at this engine speed, throttle (0 to 1) and boost state (0 to 1, from boostStep). Negative on a
 * closed throttle: friction and pumping, or regeneration for an electric motor. Past redline the positive part fades
 * to nothing over limiterBand; near and below idle a governor holds the engine at idle.
 */
export function engineTorque(e: EngineModel, omega: number, throttle: number, boost: number): number {
  const th = throttle < 0 ? 0 : throttle > 1 ? 1 : throttle;
  const d = e.dOmega;
  let full = tableAt(e.wot, d, omega);
  if (e.boost !== null && e.offBoost !== e.wot) {
    // The boost state is the share of full boost built; the wot table already holds what a spooled turbo can make
    // at this speed, so the state counts against that, not twice.
    const off = tableAt(e.offBoost, d, omega);
    const limit = spoolLimit(e, omega);
    const b = boost > 0 ? boost : 0;
    full = off + (limit > b ? b / limit : 1) * (full - off);
  }
  const drag = tableAt(e.friction, d, omega);
  let t = th * (full + drag) - drag - pumpingTorque(e) * (1 - th);
  if (omega < DRAG_FADE) {
    // Drag opposes the turning: none at rest (a stopped motor must not drive the car backward), and reversed for a
    // shaft turned backward. Above DRAG_FADE the line above stands exactly.
    const side = omega > -DRAG_FADE ? omega / DRAG_FADE : -1;
    t = th * full - (1 - th) * (drag + pumpingTorque(e)) * side;
  }
  if (omega > e.redline && t > 0) {
    const k = 1 - (omega - e.redline) / e.limiterBand;
    t = k > 0 ? t * k : 0;
  }
  // The governor works the idle air valve, a bypass round the throttle: with the throttle open it has nothing to add.
  if (e.kind !== 'electric' && e.idle > 0 && omega < GOVERNOR_REACH * e.idle && th < 1) t += (1 - th) * idleGovernor(e, omega);
  return t;
}

/**
 * Advances the boost state by h seconds and returns it: the share of the turbo's full boost that has built, 0 to 1.
 * It heads for throttle^2 times what the turbo can hold at this speed, quickly at high engine speed and slowly at low
 * (exhaust flow spins the turbo), and falls quickly when the throttle lifts. An engine without lag returns its
 * boost at once (throttle^2 for a supercharger, 0 for no boost).
 */
export function boostStep(e: EngineModel, boost: number, omega: number, throttle: number, h: number): number {
  const th = throttle < 0 ? 0 : throttle > 1 ? 1 : throttle;
  const lag = e.boost;
  if (lag === null) return e.kind === 'turbo' || e.kind === 'supercharged' ? th * th : 0;
  const target = th * th * spoolLimit(e, omega);
  let tau = lag.fallTau;
  if (target > boost) {
    tau = omega > 0 ? lag.tauRef * lag.omegaRef / omega : lag.tauMax;
    if (tau < lag.tauMin) tau = lag.tauMin; else if (tau > lag.tauMax) tau = lag.tauMax;
  }
  // Implicit Euler: the same first-order lag as boost += (target - boost) h / tau, stable for any h.
  return boost + (target - boost) * h / (tau + h);
}

/**
 * The engine's peak power (W) and torque (N m) and the speeds of each (rad/s), read off its full-throttle table up to
 * redline as the car makes it (straight lines between table points). On a plateau the first speed is given. For the
 * bench's dyno and for tests, not the step.
 */
export function enginePeaks(e: EngineModel): { power: number; powerOmega: number; torque: number; torqueOmega: number } {
  const w = e.wot, d = e.dOmega, top = e.redline;
  let torque = w[0], torqueOmega = 0, power = 0, powerOmega = 0;
  for (let i = 0; i < e.n; i++) {
    const w0 = i * d;
    if (w0 > top) break;
    const t0 = w[i];
    // Values on a plateau differ only by rounding: keep the first, as makers quote a plateau by its start.
    if (t0 > torque + 1e-9 * Math.abs(torque)) { torque = t0; torqueOmega = w0; }
    if (t0 * w0 > power + 1e-9 * Math.abs(power)) { power = t0 * w0; powerOmega = w0; }
    if (i + 1 >= e.n) break;
    // Between points torque is a straight line, so power is a parabola: its top may fall between them.
    const s = (w[i + 1] - t0) / d;
    const w1 = (i + 1) * d < top ? (i + 1) * d : top;
    if (s < 0) {
      const wv = (s * w0 - t0) / (2 * s);
      if (wv > w0 && wv < w1) {
        const pv = (t0 + s * (wv - w0)) * wv;
        if (pv > power + 1e-9 * Math.abs(power)) { power = pv; powerOmega = wv; }
      }
    }
    if (w1 < (i + 1) * d && w1 > w0) {   // redline falls inside this step
      const t1 = t0 + s * (w1 - w0);
      if (t1 > torque + 1e-9 * Math.abs(torque)) { torque = t1; torqueOmega = w1; }
      if (t1 * w1 > power + 1e-9 * Math.abs(power)) { power = t1 * w1; powerOmega = w1; }
    }
  }
  return { power, powerOmega, torque, torqueOmega };
}
