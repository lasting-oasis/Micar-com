// The `P` a core-driven Vehicle carries (packages/physics DESIGN.md section 13, step 4). Everything that reads the
// Vehicle reads P as the old model's Params: the HUD and the sound read redline, idle, turbo, nos, gears and drive;
// the Strip's events still hand the whole P to the old model's simStats (the AI's pace) and makeVehicle (the drag
// opponents), which stay on the old model until opponents move onto the core.
//
// So P is the old model's portrait of the core's car: the old Params of the same build (grip, brakes, steering and
// the rest of what only the old model has), with every field the core can describe set from the core's model: its
// engine's full-throttle curve, its gearing and wheel size, its mass and geometry, its turbo, its nitrous and its
// drive. The readers then see the car being driven, and the AI paces itself on a straight-line run of that same car.
import type { VehicleModel } from '@micar/physics';
import { RHO_AIR, enginePeaks } from '@micar/physics';
import { carParams, type Params, type PerfCfg, type Tune, type VehicleSpec } from '../physics';

/** Radians a second in one rev a minute. */
export const RPM = (2 * Math.PI) / 60;
// Points of the torque curve handed to the old model: enough to keep the shape between idle and redline.
const CURVE_POINTS = 12;

/** Rev/min of an engine speed in rad/s, rounded to a whole number so that it is the same from frame to frame. */
export function rpmOf(omega: number): number { return Math.round(omega / RPM); }

/** Whether the core's gearbox has gears to change (a CVT, eCVT or single-speed car has only drive). */
export function stepped(m: VehicleModel): boolean {
  const t = m.driveline.transmission;
  return t !== 'cvt' && t !== 'ecvt' && t !== 'single-speed';
}

/** The forward ratios as the old model and the HUD count them: a stepped box's own; a CVT spread over six steps between its ends; a single speed's one. */
export function forwardRatios(m: VehicleModel): number[] {
  const g = Array.from(m.driveline.gears);
  if (g.length === 0) return [1];
  if (stepped(m) || g.length < 2) return m.driveline.transmission === 'single-speed' ? [g[0]] : g;
  const hi = Math.max(g[0], g[1]), lo = Math.min(g[0], g[1]), out: number[] = [];
  // A geometric spread, as a stepped box's ratios are: only the old model's straight-line run uses it.
  for (let i = 0; i < 6; i++) out.push(hi * Math.pow(lo / hi, i / 5));
  return out;
}

/** Turbo or supercharger, and the share of torque its boost adds at the power peak (the old model's turbo.gain), or null when the engine is not boosted. */
export function boostGain(m: VehicleModel): number | null {
  const e = m.engine;
  if (e.kind !== 'turbo' && e.kind !== 'supercharged') return null;
  const at = Math.min(e.n - 1, Math.max(0, Math.round(enginePeaks(e).powerOmega / e.dOmega)));
  const wot = e.wot[at], off = e.offBoost[at];
  const gain = off > 0 ? wot / off - 1 : 0;
  // Finite and inside the range the old turbo ran (0.16 to 0.46 at its tiers): the sound's whine is scaled by it.
  return Math.min(1.5, Math.max(0.05, Number.isFinite(gain) ? gain : 0.05));
}

/** The nitrous bottle in the old model's units: seconds of full shot in a full bottle, the shot as a share of peak power, and no refill (a real bottle stays empty until it is filled). */
export function nitrousOf(m: VehicleModel): { cap: number; pow: number; regen: number } {
  const n = m.nitrous;
  if (n === null || !(n.flow > 0) || !(n.bottleMass > 0)) return { cap: 0, pow: 0, regen: 0 };
  const cap = n.bottleMass / n.flow, peak = enginePeaks(m.engine).power;
  return { cap, pow: peak > 0 ? n.power / peak : 0, regen: 0 };
}

/** The engine's torque curve as the old model reads one, [rpm, N m] from idle to past redline: off boost for a boosted engine (the old model adds its turbo on top). */
export function torqueCurveOf(m: VehicleModel): [number, number][] {
  const e = m.engine, table = e.kind === 'turbo' || e.kind === 'supercharged' ? e.offBoost : e.wot;
  const lo = Math.max(e.dOmega, e.idle * 0.8), hi = e.redline + e.limiterBand, out: [number, number][] = [];
  for (let i = 0; i < CURVE_POINTS; i++) {
    const w = lo + (hi - lo) * i / (CURVE_POINTS - 1), k = w / e.dOmega, j = Math.min(e.n - 2, Math.floor(k));
    const t = table[j] + (table[j + 1] - table[j]) * (k - j);
    out.push([Math.round(w / RPM), Math.max(1, t)]);
  }
  return out;
}

/**
 * The P a core-driven Vehicle carries: the old Params of the same spec and build, with what the core's model
 * describes (redline and idle in rev/min, gearing, wheel size, mass and geometry, drag, torque curve, turbo,
 * nitrous, drive) set from it. A fresh object; the Driver keeps it until the build changes.
 */
export function paramsFor(core: VehicleModel, spec: VehicleSpec, perf: PerfCfg, tune: Tune): Params {
  const P = carParams(spec, perf, tune), ch = core.chassis, d = core.driveline;
  P.mass = ch.mass; P.a = ch.a; P.b = ch.b; P.L = ch.wheelbase; P.h = ch.cgHeight; P.Iz = ch.izz;
  P.cdA = 0.5 * RHO_AIR * core.aero.dragArea;
  P.redline = rpmOf(core.engine.redline);
  P.idle = rpmOf(core.engine.idle);
  P.tq = torqueCurveOf(core); P.tqMul = 1; P.peakT = Math.max(...P.tq.map(q => q[1]));
  P.gears = forwardRatios(core);
  P.rev = d.reverse > 0 ? d.reverse : P.gears[0];
  P.fin = d.finalDrive;
  P.r = d.layout === 'FWD' ? core.tyreFront.radius : core.tyreRear.radius;
  P.eff = d.efficiency;
  P.shiftT = d.shiftTime;
  const gain = boostGain(core);
  P.turbo = gain === null ? null : { gain, spool: core.engine.boost ? Math.min(0.9, Math.max(0.18, core.engine.boost.tauRef)) : 0.18 };
  P.nos = nitrousOf(core);
  P.drive = d.layout;
  P.split = d.layout === 'FWD' ? [1, 0] : d.layout === 'RWD' ? [0, 1] : [d.centre.frontShare, 1 - d.centre.frontShare];
  return P;
}
