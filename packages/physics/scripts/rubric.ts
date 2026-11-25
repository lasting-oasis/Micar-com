/// <reference lib="dom" />
// The driving realism rubric, measured (docs/superpowers/specs/2026-11-14-driving-realism-rubric.md). The rubric
// scores how real MiCar World's driving is on 27 criteria; its baseline, 29.0, was measured on the old model by scratch
// scripts that are not in the repo. This script measures, side by side, what code can measure of the two ways the
// game drives today:
//   - classic: the old model (apps/sim world/physics.ts), the game's default, with the old AI and the old drag cars;
//   - core: the physics core as the game drives it with ?physics=core: each world car on the sheet coreModelFor picks
//     (a researched record as filed, which nobody has calibrated; else the car table's six figures), the Garage's
//     tiers through legacyBuild, the player's pedals through the adapter (world/core/driver.ts CoreDriver), and the
//     computer racers of world/core/opponents.ts.
// Then it prints the scorecard: each criterion's level on both, the numbers that settle it, and what stands between it
// and level 3. A level is worked out from the measurements by the rubric's own bands; where a criterion turns on a
// rule of the game that code cannot measure (a red light, a handicap format, a label), the fact is stated in words,
// with the file that shows it, and scored as the game stands. When a band can be read two ways the lower level is
// taken and the reason given.
//
// From the repository root (about 40 s):
//   pnpm --filter @micar/sim exec tsx ../../packages/physics/scripts/rubric.ts
// A run is deterministic: the core is, and every draw below is seeded.
//
// The game's modules are browser code: the DOM library is referenced above so that both of the core's compilers
// (scripts/check.sh) can check this file with them.
import type { BenchResult, PhysicsSheet, TyreCategory, VehicleModel } from '../src/types';
import type { Check } from '../src/calibrate';
import { runBench, setRolling, skidpadAt, topSpeedOf } from '../src/bench';
import { asTested, calibrate, checkSheet, fleetMedians, orderInversions } from '../src/calibrate';
import { SHEETS } from '../src/data/sheets';
import { circleDriver, launchDriver } from '../src/drivers';
import { GOLDEN, PROOF_CARS, goldenRun } from '../src/golden';
import { G, datan2 } from '../src/math';
import { benchFigures, type CardFigures } from '../src/rating';
import { resolveModel, tyreParams } from '../src/resolve';
import { FLAT, defaultControls } from '../src/state';
import { tyreForces, peakSlipTan, type TyreOut } from '../src/tyre';
import { FT, IN, LB, MPH, parseTyreSize } from '../src/units';
import { createVehicle, step } from '../src/vehicle';
import { ACCELERATION, RACE_MODE_RULES, applyModifications, entrantFromLayer, simulatedSpec } from '../../engine/src/index';
import { CAR_CATALOG, ORIGINAL_MAKES } from '../../../apps/sim/src/carCatalog';
import { getCarSpec } from '../../../apps/sim/src/carSpecs';
import { cardStatsFor, engineSpecFor } from '../../../apps/sim/src/world/cardStats';
import { EVENTS, STOCK_CFG, TUNE_DEF, specFor, type CarCfg } from '../../../apps/sim/src/world/data';
import { fastestRun } from '../../../apps/sim/src/world/floors';
import { NO_INPUT, carParams, makeVehicle, resetVehicle, simStats, stepVehicle, torqueAt, type Input, type Params, type PerfCfg, type Tune } from '../../../apps/sim/src/world/physics';
import { CoreDriver } from '../../../apps/sim/src/world/core/driver';
import { cardMods, garageCard } from '../../../apps/sim/src/world/core/garageBench';
import { coreModelFor, type CoreCar } from '../../../apps/sim/src/world/core/model';
import { CoreField, circuitLine, seededRandom, type FieldRacer } from '../../../apps/sim/src/world/core/opponents';
import { FULL_BUILD, dragSeconds } from '../../../apps/sim/src/world/core/floorRuns';
import { registerTrack, routeFor, trackLoaded, trackOfEvent, type TrackData } from '../../../apps/sim/src/world/strip/district';
import { routePoint, routeProgress } from '../../../apps/sim/src/world/strip/routes';

/* ------------------------------------------------------------------ the host */

// The host's console, clock and files: not in the ES2020 library the core compiles against, so reached through
// globalThis (scripts/validate.ts does the same for the console).
type Host = { performance: { now(): number }; console: { log(...args: unknown[]): void } };
const host = globalThis as unknown as Host;
const print = (line = ''): void => host.console.log(line);
type FileSystem = { readFileSync(path: string, enc: string): string };
const NODE_FS = 'node:fs';

/* ------------------------------------------------------------------ small helpers */

const fmt = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const pct = (x: number, d = 1): string => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(100 * x).toFixed(d)}%` : String(x));
const median = (xs: readonly number[]): number => {
  const v = xs.filter((x) => !Number.isNaN(x)).slice().sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const m = v.length >> 1;
  return v.length % 2 === 1 ? v[m] : 0.5 * (v[m - 1] + v[m]);
};
const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const STEP_S = 1 / 120;
const steps = (seconds: number): number => Math.round(seconds * 120);
const QUARTER_M = 1320 * FT;
const TRAP_M = 66 * FT;
const HALF_MILE_M = 2640 * FT;
const SKIDPAD_R = 150 * FT;
const HP_W = 745.69987;

/** Best average of `xs` over any run of `n` consecutive samples. */
function bestWindow(xs: readonly number[], n: number): number {
  if (xs.length < n || n <= 0) return NaN;
  let sum = 0, best = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i];
    if (i >= n) sum -= xs[i - n];
    if (i >= n - 1 && sum / n > best) best = sum / n;
  }
  return best;
}

// The test figures a sheet can be checked on (scripts/validate.ts hasTests).
const TEST_KEYS: readonly (keyof PhysicsSheet['tests'])[] = [
  'zeroToThirtySec', 'zeroToSixtySec', 'zeroToHundredSec', 'quarterMileSec', 'quarterMileMph', 'braking60to0Ft', 'braking70to0Ft', 'skidpadG', 'topSpeedMph',
];
const hasTests = (sheet: PhysicsSheet): boolean => TEST_KEYS.some((k) => sheet.tests[k] !== null);

/** A car of the world as the game names it: its make, model and body style (the catalogue's). */
type WorldCar = { make: string; model: string; style: string };
const asCore = (c: WorldCar): CoreCar => ({ make: c.make, model: c.model, bodyStyle: c.style });
const nameOf = (c: WorldCar): string => `${c.make} ${c.model}`;

/** The 36 models the baseline measured: the original five makes of the world's catalogue. */
const ORIGINAL_36: readonly WorldCar[] = ORIGINAL_MAKES.flatMap((make) => CAR_CATALOG[make].map((r) => ({ make, model: r.model, style: r.style })));
/** The validation cars that are world cars, as the world names them (carModels.ts: the game names of the real cars behind them). */
const VALIDATION_WORLD: Readonly<Record<string, WorldCar>> = {
  '2024-chevrolet-corvette-stingray-z51': { make: 'Chevy', model: 'Corvette', style: 'sports' },
  '2024-honda-civic-sedan-lx': { make: 'Honda', model: 'Civic', style: 'sedan' },
  '2024-porsche-911-carrera': { make: 'Porshe', model: '911X', style: 'sports' },
  '2024-tesla-model-3-long-range-awd': { make: 'Tezla', model: 'Modell 3', style: 'sedan' },
  '2024-toyota-camry-le': { make: 'Toyota', model: 'Camry', style: 'sedan' },
  '2024-toyota-tacoma-trd-off-road': { make: 'Toyota', model: 'Tacoma', style: 'truck' },
  '2024-volkswagen-golf-gti-s': { make: 'Folkswagen', model: 'Golph GTI', style: 'hatchback' },
};
/**
 * The baseline's measurement of the old model (the rubric's section 8, "The 36 models", the game's side of each
 * column): power (hp), 0-60 (s), top speed (mph), quarter mile (s) and trap (mph).
 */
const BASELINE_OLD: Readonly<Record<string, readonly [number, number, number, number, number]>> = {
  'Toyota Camry': [248, 7.9, 135, 16.1, 96], 'Toyota Corolla': [141, 9.6, 115, 17.4, 84], 'Toyota RAV4': [177, 7.9, 116, 16.0, 85],
  'Toyota Tacoma': [244, 7.4, 122, 15.6, 88], 'Toyota Tundra': [372, 6.3, 129, 14.6, 96], 'Toyota Prius': [148, 9.8, 112, 17.5, 82],
  'Toyota Sienna': [295, 9.1, 115, 16.9, 91], 'Toyota Supra': [430, 5.6, 155, 13.7, 111], 'Ford F-150': [327, 6.2, 129, 14.5, 96],
  'Ford Ranger': [255, 6.8, 124, 15.1, 91], 'Ford Mustang': [498, 5.6, 155, 13.6, 113], 'Ford Explorer': [257, 6.9, 129, 15.2, 91],
  'Ford Escape': [222, 8.9, 125, 16.7, 92], 'Ford Focus': [174, 8.3, 125, 16.3, 90], 'Ford Fusion': [228, 8.1, 125, 16.4, 93],
  'Honda Civic': [207, 7.9, 125, 16.3, 95], 'Honda Accord': [240, 7.9, 125, 16.2, 96], 'Honda CR-V': [177, 7.3, 116, 15.9, 85],
  'Honda Pilot': [255, 6.9, 129, 15.2, 91], 'Honda Odyssey': [295, 9.1, 115, 16.9, 91], 'Honda Fit': [134, 8.8, 115, 16.8, 86],
  'Honda Ridgeline': [272, 6.8, 126, 15.1, 91], 'Chevy Silverado': [327, 6.4, 129, 14.7, 95], 'Chevy Colorado': [278, 6.5, 127, 14.9, 93],
  'Chevy Camaro': [437, 5.6, 165, 13.7, 109], 'Chevy Corvette': [603, 5.2, 198, 12.9, 124], 'Chevy Equinox': [199, 8.6, 121, 16.9, 88],
  'Chevy Tahoe': [328, 6.9, 129, 15.1, 92], 'Chevy Malibu': [239, 8.4, 120, 16.3, 94], 'BMW 3 Series': [370, 5.9, 130, 14.3, 105],
  'BMW 5 Series': [357, 6.1, 130, 14.5, 102], 'BMW X5': [419, 4.9, 136, 13.6, 104], 'BMW X3': [290, 5.5, 136, 14.3, 97],
  'BMW M4': [448, 5.8, 155, 13.9, 111], 'BMW 4 Series': [385, 5.8, 130, 14.3, 106], 'BMW Z4': [419, 5.6, 155, 13.7, 111],
};
const MUSTANG: WorldCar = { make: 'Ford', model: 'Mustang', style: 'sports' };
const CORVETTE: WorldCar = { make: 'Chevy', model: 'Corvette', style: 'sports' };
const CAMRY: WorldCar = { make: 'Toyota', model: 'Camry', style: 'sedan' };
const CIVIC: WorldCar = { make: 'Honda', model: 'Civic', style: 'sedan' };
const RONIN: CoreCar = { make: 'Ronin', model: 'GT', rental: true };
const STOCK: PerfCfg = { ...STOCK_CFG.perf };
const TOP_TIER: PerfCfg = { ...FULL_BUILD };

/* ------------------------------------------------------------------ the old model (world/physics.ts), measured as the baseline was */

/** The old model's car for a world car and a build, as the scene makes it (world/data.ts specFor, world/physics.ts carParams). */
function oldParams(c: WorldCar | CoreCar, perf: PerfCfg = STOCK, tune: Tune = TUNE_DEF): Params {
  return carParams(specFor('style' in c ? asCore(c) : c), perf, tune);
}

type OldStraight = { t30: number; t60: number; peakG: number; quarter: number; trap: number; top: number; brake60Ft: number; hp: number };

/** Flat out from rest with the old model's own gear changes (0-30, 0-60, the best quarter second of launch, the quarter mile and its trap, the top speed), then a full stop from 62 mph timed from 60. */
function oldStraight(P: Params): OldStraight {
  const V = makeVehicle(P);
  resetVehicle(V, 0, 0, 0);
  const I: Input = { ...NO_INPUT, fwd: 1 };
  let t = 0, t30 = NaN, t60 = NaN, quarter = NaN, trapIn = NaN, top = 0;
  const early: number[] = [];
  for (let k = 0; k < steps(150); k++) {
    const odo0 = V.odo;
    stepVehicle(V, I, STEP_S, false);
    t += STEP_S;
    if (k < steps(4)) early.push(V.u);
    if (t30 !== t30 && V.u >= 30 * MPH) t30 = t;
    if (t60 !== t60 && V.u >= 60 * MPH) t60 = t;
    if (trapIn !== trapIn && V.odo >= QUARTER_M - TRAP_M) trapIn = t - (V.odo - (QUARTER_M - TRAP_M)) / Math.max(1e-6, V.odo - odo0) * STEP_S;
    if (quarter !== quarter && V.odo >= QUARTER_M) quarter = t - (V.odo - QUARTER_M) / Math.max(1e-6, V.odo - odo0) * STEP_S;
    if (V.u > top) top = V.u;
  }
  // The launch: the best 0.25 s of speed gained in the first four seconds.
  let peak = 0;
  const w = steps(0.25);
  for (let i = 0; i + w < early.length; i++) peak = Math.max(peak, (early[i + w] - early[i]) / 0.25);
  // The stop: up to 63 mph, then the brake alone; the distance from where it passes 60 mph to rest.
  const B = makeVehicle(P);
  resetVehicle(B, 0, 0, 0);
  for (let k = 0; k < steps(60) && B.u < 63 * MPH; k++) stepVehicle(B, I, STEP_S, false);
  const brake: Input = { ...NO_INPUT, back: 1 };
  let from = NaN;
  for (let k = 0; k < steps(20) && B.u > 0.01; k++) {
    const u0 = B.u, o0 = B.odo;
    stepVehicle(B, brake, STEP_S, false);
    if (from !== from && u0 >= 60 * MPH && B.u < 60 * MPH) from = o0 + (B.odo - o0) * (u0 - 60 * MPH) / Math.max(1e-9, u0 - B.u);
  }
  return { t30, t60, peakG: peak / G, quarter, trap: TRAP_M / (quarter - trapIn) / MPH, top: top / MPH, brake60Ft: (B.odo - from) / FT, hp: simStats(P).hp };
}

/**
 * The old model on the baseline's skidpad: a 300 ft circle, the speed aimed at rising 0.08 m/s each second, steered by
 * pure pursuit with a slow trim on the radius; the figure (g) is the best two-second average of speed times yaw rate
 * before the car runs 3 m wide.
 */
function oldSkidpad(P: Params): number {
  const V = makeVehicle(P), R = SKIDPAD_R;
  resetVehicle(V, 0, -R, Math.PI / 2);
  const I: Input = { ...NO_INPUT };
  const v0 = Math.sqrt(0.6 * G * R);
  V.u = v0; V.vx = v0; V.vz = 0; V.w = -v0 / R; V.gear = Math.min(P.gears.length, 3);
  const lat: number[] = [];
  let trim = 0, integ = 0;
  for (let k = 0; k < steps(240); k++) {
    const t = k * STEP_S, want = v0 + 0.08 * t;
    oldCircleControl(V, I, R, trim);
    const e = want - V.u;
    integ = Math.max(-2, Math.min(2, integ + e * STEP_S));
    I.fwd = Math.max(0, Math.min(1, 0.4 * e + 0.3 * integ + 0.15));
    I.back = e < -1 ? Math.min(1, -0.3 * e) : 0;
    stepVehicle(V, I, STEP_S, false);
    const r = Math.sqrt(V.x * V.x + V.z * V.z);
    trim = Math.max(-0.3, Math.min(0.3, trim + 0.02 * (r - R) * STEP_S));
    if (t > 5) {
      if (Math.abs(r - R) > 3) break;
      lat.push(Math.abs(V.u * V.w) / G);
    }
  }
  return bestWindow(lat, steps(2));
}

// Pure pursuit for the old model on a circle round the origin: steered toward the point 0.5 s ahead (at least 4 m) on
// the circle the way it is going, plus a slow trim on the radius. The old model's positions are x, z and its heading h
// points along (sin h, cos h); a positive yaw rate turns that clockwise seen with x to the right and z up, and a
// positive road-wheel angle (the input's negative) gives a positive yaw rate.
function oldCircleControl(V: ReturnType<typeof makeVehicle>, I: Input, R: number, trim: number): void {
  const P = V.P, spd = Math.abs(V.u), L = P.L;
  const theta = Math.atan2(V.z, V.x);
  const fx = Math.sin(V.h), fz = Math.cos(V.h);
  const dir = Math.sign(V.x * fz - V.z * fx) || 1;
  const look = Math.max(4, 0.5 * spd), ta = theta + dir * look / R;
  const tx = R * Math.cos(ta), tz = R * Math.sin(ta);
  const angH = Math.atan2(fz, fx), angT = Math.atan2(tz - V.z, tx - V.x);
  let a = angT - angH;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  const dmax = (0.62 / (1 + Math.pow(spd / 11, 1.4)) + 0.03) * P.steerMul;
  const delta = Math.atan(2 * L * Math.sin(a) / look) + dir * trim;
  // A target to the left (a > 0) needs a negative yaw rate, which a negative road-wheel angle gives; delta = -Input.steer x lock.
  I.steer = Math.max(-1, Math.min(1, delta / dmax));
}

/**
 * The old model in a steady corner at 0.9 of its skidpad figure for 15 s, then the steer held and the pedal held,
 * floored or lifted for one second: how far outside the circle it ends and the yaw rate it ends on. It holds one gear,
 * the one that turns its engine nearest half its redline, as the core's circle driver does (an automatic that changed
 * up as the pedal went down would hand the rear tyres less torque than the core's car gets).
 */
function oldCorner(P: Params, skid: number, action: 'hold' | 'floor' | 'lift'): { wide: number; r: number } {
  const V = makeVehicle(P), R = SKIDPAD_R, v = Math.sqrt(0.9 * skid * G * R);
  resetVehicle(V, 0, -R, Math.PI / 2);
  const wheelRpm = v / P.r * 60 / (2 * Math.PI);
  let gear = 1;
  for (let g = 1; g <= P.gears.length; g++) if (Math.abs(wheelRpm * P.gears[g - 1] * P.fin - 0.5 * P.redline) < Math.abs(wheelRpm * P.gears[gear - 1] * P.fin - 0.5 * P.redline)) gear = g;
  V.u = v; V.vx = v; V.vz = 0; V.w = -v / R; V.gear = gear;
  const I: Input = { ...NO_INPUT, manual: true };
  let integ = 0, trim = 0;
  for (let k = 0; k < steps(15); k++) {
    oldCircleControl(V, I, R, trim);
    const e = v - V.u;
    integ = Math.max(-2, Math.min(2, integ + e * STEP_S));
    I.fwd = Math.max(0, Math.min(1, 0.4 * e + 0.3 * integ + 0.15));
    stepVehicle(V, I, STEP_S, false);
    trim = Math.max(-0.3, Math.min(0.3, trim + 0.02 * (Math.sqrt(V.x * V.x + V.z * V.z) - R) * STEP_S));
  }
  const fwd = I.fwd;
  for (let k = 0; k < steps(1); k++) {
    I.fwd = action === 'hold' ? fwd : action === 'floor' ? 1 : 0;
    stepVehicle(V, I, STEP_S, false);
  }
  return { wide: Math.sqrt(V.x * V.x + V.z * V.z) - R, r: Math.abs(V.w) };
}

/** The old model's drag run as a scripted driver makes it: flat out, a perfect shift at 95% of redline (the 10% bonus), the nitrous held. Seconds to `metres`. */
function oldDrag(P: Params, metres: number): number {
  const V = makeVehicle(P);
  resetVehicle(V, 0, 0, 0);
  const I: Input = { ...NO_INPUT, fwd: 1, manual: true, nos: true };
  let t = 0;
  for (let k = 0; k < steps(120); k++) {
    I.shiftUp = V.rpm > P.redline * 0.95 && V.shift <= 0;
    const o0 = V.odo;
    stepVehicle(V, I, STEP_S, false);
    t += STEP_S;
    if (V.odo >= metres) return t - (V.odo - metres) / Math.max(1e-6, V.odo - o0) * STEP_S;
  }
  return NaN;
}

/* ------------------------------------------------------------------ the core as the game drives it */

type Live = { car: WorldCar; model: VehicleModel; sheet: PhysicsSheet; source: string; bench: BenchResult };

/** A world car on the core, stock, as coreModelFor gives it to the game, and its whole bench. */
function live(car: WorldCar, perf: PerfCfg = STOCK, tune: Tune = TUNE_DEF): Live {
  const m = coreModelFor(asCore(car), perf, tune);
  return { car, model: m.model, sheet: m.sheet, source: m.source, bench: runBench(m.model) };
}

/** The best quarter second of launch on the bench's own launch (its launch speed and shift points): g. */
function coreLaunchPeak(model: VehicleModel, bench: BenchResult): number {
  const d = launchDriver(model, bench.launchRpm * Math.PI / 30, 1), s = createVehicle(model), c = defaultControls();
  const us: number[] = [];
  for (let k = 0; k < steps(4); k++) { d.control(s, c); step(s, c, FLAT); us.push(s.u); }
  let peak = 0;
  const w = steps(0.25);
  for (let i = 0; i + w < us.length; i++) peak = Math.max(peak, (us[i + w] - us[i]) / 0.25);
  return peak / G;
}

type Driven = { t60: number; t60rollout: number; quarter: number; trap: number };

/**
 * The live game's own launch: the adapter (CoreDriver, Standard assists, the car's systems on, automatic gears) with
 * the pedal held flat from a standstill, as a player floors it. Times run from the car's first movement (0.01 m/s);
 * the rollout figure from where it has gone a foot, as the magazines time it.
 */
function drivenByPlayer(car: CoreCar): Driven {
  const spec = specFor(car), cfg: CarCfg = { ...STOCK_CFG, perf: { ...STOCK } };
  const d = new CoreDriver(car, spec, { cfg, tune: { ...TUNE_DEF } }, { x: 0, z: 0, h: 0 });
  const opts = { drift: false, fuel: () => 100, burn: () => {}, collide: () => 0 };
  const I: Input = { ...NO_INPUT, fwd: 1 };
  let t = 0, moved = NaN, roll = NaN, t60 = NaN, q = NaN, trapIn = NaN, dist = 0;
  for (let k = 0; k < steps(40) && q !== q; k++) {
    const d0 = dist;
    d.stepFrame(STEP_S, I, opts);
    t += STEP_S;
    dist = d.s.x;
    if (moved !== moved && d.s.u > 0.01) moved = t;
    if (roll !== roll && dist >= FT) roll = t;
    if (t60 !== t60 && d.s.u >= 60 * MPH) t60 = t;
    if (trapIn !== trapIn && dist >= QUARTER_M - TRAP_M) trapIn = t - (dist - (QUARTER_M - TRAP_M)) / Math.max(1e-6, dist - d0) * STEP_S;
    if (dist >= QUARTER_M) q = t - (dist - QUARTER_M) / Math.max(1e-6, dist - d0) * STEP_S;
  }
  return { t60: t60 - moved, t60rollout: t60 - roll, quarter: q - roll, trap: TRAP_M / (q - trapIn) / MPH };
}

/** The live game's engine on the limiter: the adapter in a manual box held in first gear, pedal flat for four seconds from rest. The old model's drag race blows an engine 1.5 s over redline + 100 rpm (strip/events.ts). */
function limiterHold(car: CoreCar): { overRpm: number; overRev: number; blown: boolean } {
  const spec = specFor(car), cfg: CarCfg = { ...STOCK_CFG, perf: { ...STOCK } };
  const d = new CoreDriver(car, spec, { cfg, tune: { ...TUNE_DEF } }, { x: 0, z: 0, h: 0 });
  const opts = { drift: false, fuel: () => 100, burn: () => {}, collide: () => 0 };
  const I: Input = { ...NO_INPUT, fwd: 1, manual: true };
  let over = 0, most = 0;
  for (let k = 0; k < steps(4); k++) {
    d.stepFrame(STEP_S, I, opts);
    over = Math.max(over, d.V.rpm - d.V.P.redline);
    most = Math.max(most, d.V.overRev);
  }
  return { overRpm: over, overRev: most, blown: most > 1.5 };
}

/** The old model the same way: first gear, pedal flat, four seconds. */
function oldLimiterHold(P: Params): { overRpm: number; overRev: number; blown: boolean } {
  const V = makeVehicle(P);
  resetVehicle(V, 0, 0, 0);
  const I: Input = { ...NO_INPUT, fwd: 1, manual: true };
  let over = 0, most = 0;
  for (let k = 0; k < steps(4); k++) { stepVehicle(V, I, STEP_S, false); over = Math.max(over, V.rpm - P.redline); most = Math.max(most, V.overRev); }
  return { overRpm: over, overRev: most, blown: most > 1.5 };
}

/**
 * A steady corner near the limit on the core (packages/physics car.test.ts corner(), on a car of the game): the circle
 * driver holds the 300 ft circle at 0.9 of the car's skidpad figure for 15 s; then the steer is frozen and, for one
 * second, the throttle is held, floored or lifted, stability and traction control off. How far outside the circle it
 * ends (m), its yaw rate (rad/s) and its sideslip (rad, negative is the tail out).
 */
function coreCorner(model: VehicleModel, skid: number, action: 'hold' | 'floor' | 'lift'): { wide: number; r: number; beta: number } {
  const R = SKIDPAD_R, v = Math.sqrt(0.9 * skid * G * R);
  const s = createVehicle(model), c = defaultControls(), d = circleDriver(model, 0, R, R, v, 0);
  setRolling(s, v, v / R);
  for (let k = 0; k < steps(15); k++) { d.control(s, c); step(s, c, FLAT); }
  const steer = c.steer, throttle = c.throttle, gear = s.gear;
  for (let k = 0; k < steps(1); k++) {
    c.steer = steer; c.gear = gear; c.brake = 0; c.esc = false; c.tcs = false;
    c.throttle = action === 'hold' ? throttle : action === 'floor' ? 1 : 0;
    step(s, c, FLAT);
  }
  return { wide: Math.sqrt(s.x * s.x + (s.y - R) * (s.y - R)) - R, r: s.r, beta: datan2(s.v, s.u) };
}

/** Steady on the 300 ft circle at 0.65 g for 20 s: the road-wheel angle it needs (rad) and the least share of its static load any wheel carries, averaged over the last 5 s. */
function coreSteady(model: VehicleModel, g = 0.65): { steer: number; leastLoad: number } {
  const R = SKIDPAD_R, v = Math.sqrt(g * G * R);
  const s = createVehicle(model), c = defaultControls(), d = circleDriver(model, 0, R, R, v, 0);
  setRolling(s, v, v / R);
  let steer = 0, least = Infinity, n = 0;
  const statics = [0, 1, 2, 3].map((i) => createVehicle(model).wheelLoad[i]);
  for (let k = 0; k < steps(20); k++) {
    d.control(s, c); step(s, c, FLAT);
    if (k >= steps(15)) {
      steer += c.steer * model.chassis.maxSteer; n++;
      for (let i = 0; i < 4; i++) least = Math.min(least, s.wheelLoad[i] / statics[i]);
    }
  }
  return { steer: steer / n, leastLoad: least };
}

/** A copy of a sheet with one change. */
function variant(sheet: PhysicsSheet, change: (s: PhysicsSheet) => void): PhysicsSheet {
  const s = JSON.parse(JSON.stringify(sheet)) as PhysicsSheet;
  change(s);
  return s;
}
const figure = (value: number) => ({ value, source: { kind: 'illustrative' as const, name: 'rubric.ts variant' } });

/* ------------------------------------------------------------------ the measurements */

function header(title: string): void { print(''); print(`== ${title}`); }

type Row = { name: string; old: OldStraight; core: Live; table: ReturnType<typeof getCarSpec> };

function main(): void {
  const t0 = host.performance.now();
  print('MiCar driving realism rubric: measured on the old model (classic, the default) and on the core (?physics=core).');

  /* ---------- the 36 models, both ways */
  header('The 36 models, stock: the old model and the core as the game drives them');
  const rows: Row[] = ORIGINAL_36.map((car) => ({ name: nameOf(car), old: oldStraight(oldParams(car)), core: live(car), table: getCarSpec({ make: car.make, model: car.model }, car.style) }));
  print(`${pad('model', 18)} ${pad('core sheet', 40)} ${pad('hp table/old/core', 18)} ${pad('0-60 table/old/core', 20)} ${pad('top table/old/core', 19)} ${pad('quarter old / core', 26)} skid/60-0 core`);
  for (const r of rows) {
    const b = r.core.bench;
    print(`${pad(r.name, 18)} ${pad(`${r.core.source}: ${r.core.sheet.id}`, 40)} ${pad(`${r.table.hp}/${r.old.hp}/${b.peakHp.toFixed(0)}`, 18)} `
      + `${pad(`${r.table.zeroToSixty}/${fmt(r.old.t60, 1)}/${fmt(b.zeroToSixtyRollout, 1)}`, 20)} ${pad(`${r.table.topSpeedMph}/${fmt(r.old.top, 0)}/${fmt(b.topSpeed, 0)}${b.topSpeedGoverned ? 'g' : ''}`, 19)} `
      + `${pad(`${fmt(r.old.quarter, 1)}@${fmt(r.old.trap, 0)} / ${fmt(b.timeslip.quarter, 1)}@${fmt(b.timeslip.trapMph, 0)}`, 26)} ${fmt(b.skidpad300, 2)} g / ${fmt(b.braking60, 0)} ft`);
  }
  // The old model is meant to be unchanged since the baseline: its own figures there (section 8's 36 models, the
  // "game" side of each column) must come back. Power to the horsepower, 0-60 and the quarter to the tenth printed,
  // top speed to the mile an hour, and the trap within 2 mph (the baseline did not say how it took its trap).
  const unchanged = rows.filter((r) => {
    const b = BASELINE_OLD[r.name];
    return b !== undefined && Math.abs(r.old.hp - b[0]) <= 1 && Math.abs(r.old.t60 - b[1]) <= 0.06 && Math.abs(r.old.top - b[2]) <= 1.01
      && Math.abs(r.old.quarter - b[3]) <= 0.06 && Math.abs(r.old.trap - b[4]) <= 2;
  });
  const changed = rows.filter((r) => !unchanged.includes(r)).map((r) => r.name);
  print(`The old model against the baseline's own table: ${unchanged.length} of 36 reproduced${changed.length ? ` (not: ${changed.join(', ')})` : ''}.`);
  const within0to60 = (real: number, model: number): boolean => Math.abs(model - real) <= Math.max(0.07 * real, 0.3);
  const oldHit = rows.filter((r) => within0to60(r.table.zeroToSixty, r.old.t60)).length;
  const coreHit = rows.filter((r) => within0to60(r.table.zeroToSixty, r.core.bench.zeroToSixtyRollout)).length;
  const oldPowerErr = median(rows.map((r) => Math.abs(r.old.hp / r.table.hp - 1)));
  const corePowerErr = median(rows.map((r) => Math.abs(r.core.bench.peakHp / r.table.hp - 1)));
  const sources = rows.reduce<Record<string, number>>((acc, r) => { acc[r.core.source] = (acc[r.core.source] ?? 0) + 1; return acc; }, {});
  print(`Against the car table (unverified): 0-60 within 7% or 0.3 s, old ${oldHit} of 36, core ${coreHit} of 36 (rollout); median power off the table, old ${pct(oldPowerErr)}, core ${pct(corePowerErr)}.`);
  print(`The core's sheets for the 36: ${Object.entries(sources).map(([k, v]) => `${v} ${k}`).join(', ')}.`);
  const governedOld = rows.filter((r) => r.table.topSpeedMph <= 115 && r.old.top > r.table.topSpeedMph + 1).map((r) => `${r.name} ${fmt(r.old.top, 0)} for ${r.table.topSpeedMph}`);
  const governedCore = rows.filter((r) => r.table.topSpeedMph <= 115 && r.core.bench.topSpeed > r.table.topSpeedMph + 1).map((r) => `${r.name} ${fmt(r.core.bench.topSpeed, 0)} for ${r.table.topSpeedMph}`);
  print(`Governed pickups, SUVs and vans past their table top speed by more than 1 mph: old ${governedOld.length} (${governedOld.slice(0, 4).join('; ')}), core ${governedCore.length}${governedCore.length ? ` (${governedCore.join('; ')})` : ''}.`);
  const topWithin = (r: Row, x: number): boolean => Math.abs(x / r.table.topSpeedMph - 1) <= 0.04;
  print(`Top speed within 4% of the table: old ${rows.filter((r) => topWithin(r, r.old.top)).length} of 36, core ${rows.filter((r) => topWithin(r, r.core.bench.topSpeed)).length} of 36.`);

  /* ---------- the validation cars, as validated and as the game drives them */
  header('Validation cars: the checks as VALIDATION.md runs them (calibrated, at the test weight) and as the live game drives the same sheet');
  const tested = SHEETS.filter(hasTests);
  type ValCar = { id: string; validated: Check[]; game: Check[]; gameBench: BenchResult; gameModel: VehicleModel; world: WorldCar | null };
  const val: ValCar[] = [];
  for (const sheet of tested) {
    const fitted = calibrate(asTested(sheet));
    const validated = checkSheet(fitted, runBench(resolveModel(fitted).model));
    if (validated.length === 0) continue;
    const world = VALIDATION_WORLD[sheet.id] ?? null;
    const gm = world ? coreModelFor(asCore(world), STOCK, TUNE_DEF) : null;
    const gameModel = gm ? gm.model : resolveModel(sheet).model, gameSheet = gm ? gm.sheet : sheet;
    const gameBench = runBench(gameModel);
    val.push({ id: sheet.id, validated, game: checkSheet(gameSheet, gameBench), gameBench, gameModel, world });
    if (gm && gm.sheet.id !== sheet.id) print(`  note: the game drives ${nameOf(world!)} on ${gm.sheet.id}, not ${sheet.id}`);
  }
  for (const v of val) {
    print(`${v.id}${v.world ? ` (in the world: ${nameOf(v.world)})` : ' (not a world car)'}`);
    const names = new Set([...v.validated.map((c) => c.name), ...v.game.map((c) => c.name)]);
    for (const n of names) {
      const a = v.validated.find((c) => c.name === n), b = v.game.find((c) => c.name === n);
      const show = (c: Check | undefined) => (c ? `${fmt(c.model, c.unit === 'g' ? 3 : 2)} (${(Math.abs(c.error) / c.tolerance).toFixed(2)}x ${c.pass ? 'pass' : 'MISS'})` : '-');
      const real = (a ?? b)!.real;
      print(`    ${pad(n, 40)} real ${pad(fmt(real, 2), 8)} validated ${pad(show(a), 24)} in the game ${show(b)}`);
    }
  }
  const allGame = val.map((v) => v.game), allVal = val.map((v) => v.validated);
  const carOf = (c: Check): string => { const v = val.find((x) => x.game.includes(c)); const sh = v ? SHEETS.find((q) => q.id === v.id) : undefined; return sh ? `${sh.identity.make} ${sh.identity.model}` : '?'; };
  const byKind = (tables: Check[][], re: RegExp): Check[] => tables.flatMap((t) => t.filter((c) => re.test(c.name)));
  const ratio = (c: Check): number => Math.abs(c.error) / c.tolerance;
  const sixtyGame = byKind(allGame, /^0-60/), quarterGame = byKind(allGame, /^quarter/), trapGame = byKind(allGame, /^trap/);
  const brakeGame = byKind(allGame, /-0 mph/), skidGame = byKind(allGame, /^skidpad/), topGame = byKind(allGame, /^top speed/);
  const medGame = fleetMedians(allGame), medVal = fleetMedians(allVal);
  print(`Fleet medians, 0-60 and quarter: validated ${pct(medVal.zeroToSixty ?? NaN)} / ${pct(medVal.quarter ?? NaN)}; in the game ${pct(medGame.zeroToSixty ?? NaN)} / ${pct(medGame.quarter ?? NaN)}.`);
  print(`Order inversions: validated ${orderInversions(val.map((v) => ({ id: v.id, checks: v.validated }))).length}, in the game ${orderInversions(val.map((v) => ({ id: v.id, checks: v.game }))).length}.`);
  const tally = (cs: Check[]): string => `${cs.filter((c) => c.pass).length} of ${cs.length} within tolerance, ${cs.filter((c) => ratio(c) <= 2).length} within twice`;
  print(`In the game: 0-60 ${tally(sixtyGame)}; quarter ${tally(quarterGame)}; trap ${tally(trapGame)}; braking ${tally(brakeGame)}; skidpad ${tally(skidGame)}; top speed ${tally(topGame)}.`);

  /* ---------- A1, A2: the launch as the bench and as a player makes it */
  header('A1, A2. Launch: 0-30, the best quarter second, and the live game\'s own 0-60 with the pedal floored');
  const launchCars: { car: WorldCar; drive: string }[] = [
    { car: CORVETTE, drive: 'RWD' }, { car: { make: 'BMW', model: 'M4', style: 'coupe' }, drive: 'RWD' }, { car: MUSTANG, drive: 'RWD' },
    { car: CIVIC, drive: 'FWD' }, { car: { make: 'BMW', model: 'X5', style: 'suv' }, drive: 'AWD' },
  ];
  type Launch = { name: string; drive: string; old30: number; oldPeak: number; core30: number; corePeak: number; split: string };
  const launches: Launch[] = launchCars.map(({ car, drive }) => {
    const r = rows.find((x) => x.name === nameOf(car))!;
    const basis = resolveModel(r.core.sheet).basis;
    return { name: nameOf(car), drive, old30: r.old.t30, oldPeak: r.old.peakG, core30: r.core.bench.zeroToThirty, corePeak: coreLaunchPeak(r.core.model, r.core.bench), split: basis['chassis.a'] };
  });
  for (const l of launches) print(`  ${pad(l.name, 16)} ${l.drive}  0-30 old ${fmt(l.old30)} s, core ${fmt(l.core30)} s; best launch old ${fmt(l.oldPeak)} g, core ${fmt(l.corePeak)} g; core weight split ${l.split}`);
  print('  (No sheet on file carries an instrumented 0-30 or 60 ft figure: the launch can only be judged through the 0-60 checks.)');
  const driven: { id: string; real: number; rollout: boolean; bench: number; player: number; trap: number; quarter: number }[] = [];
  for (const v of val) {
    if (!v.world) continue;
    const sheet = SHEETS.find((s) => s.id === v.id)!;
    const t = sheet.tests.zeroToSixtySec;
    if (t === null) continue;
    const rollout = sheet.tests.rollout?.value === true;
    const p = drivenByPlayer(asCore(v.world));
    driven.push({ id: v.id, real: t.value, rollout, bench: rollout ? v.gameBench.zeroToSixtyRollout : v.gameBench.zeroToSixty, player: rollout ? p.t60rollout : p.t60, trap: p.trap, quarter: p.quarter });
  }
  for (const d of driven) print(`  ${pad(d.id, 38)} 0-60${d.rollout ? ' (rollout)' : ''} real ${fmt(d.real)} s; the game's bench ${fmt(d.bench)} s (${pct(d.bench / d.real - 1, 0)}); floored by a player ${fmt(d.player)} s (${pct(d.player / d.real - 1, 0)}); quarter ${fmt(d.quarter)} s @ ${fmt(d.trap, 1)} mph`);

  /* ---------- A3: the response to power */
  header('A3. The quarter mile\'s response to power (the drag racer\'s rule: time goes as (weight / power)^(1/3), trap as its inverse)');
  const mStock = rows.find((r) => r.name === 'Ford Mustang')!;
  const mEngine = live(MUSTANG, { ...STOCK, engine: 3 });
  const oldEngine = oldStraight(oldParams(MUSTANG, { ...STOCK, engine: 3 }));
  const ruleCore = Math.cbrt(mStock.core.bench.peakHp / mEngine.bench.peakHp), ruleOld = Math.cbrt(mStock.old.hp / oldEngine.hp);
  print(`  Mustang, Engine top tier: core power ${pct(mEngine.bench.peakHp / mStock.core.bench.peakHp - 1)}, quarter ${pct(mEngine.bench.timeslip.quarter / mStock.core.bench.timeslip.quarter - 1)} (rule ${pct(ruleCore - 1)}), trap ${pct(mEngine.bench.timeslip.trapMph / mStock.core.bench.timeslip.trapMph - 1)} (rule ${pct(1 / ruleCore - 1)})`);
  print(`                             old  power ${pct(oldEngine.hp / mStock.old.hp - 1)}, quarter ${pct(oldEngine.quarter / mStock.old.quarter - 1)} (rule ${pct(ruleOld - 1)}), trap ${pct(oldEngine.trap / mStock.old.trap - 1)} (rule ${pct(1 / ruleOld - 1)})`);
  const ts = mStock.core.bench.timeslip;
  print(`  The core bench's timeslip (Mustang): 60 ft ${fmt(ts.sixtyFoot)}, 330 ft ${fmt(ts.threeThirty)}, 1/8 ${fmt(ts.eighth)} @ ${fmt(ts.eighthMph, 1)}, 1000 ft ${fmt(ts.thousand)}, 1/4 ${fmt(ts.quarter)} @ ${fmt(ts.trapMph, 1)}. The Strip shows the finish time only (strip/events.ts).`);

  /* ---------- A4 */
  header('A4. Top speed against the makers\' figures on the researched sheets the game drives');
  const tops: { id: string; name: string; maker: number; governed: boolean | null; core: number; coreGov: boolean }[] = [];
  for (const s of SHEETS) {
    if (s.topSpeedMph === null) continue;
    const t = topSpeedOf(resolveModel(s).model);
    tops.push({ id: s.id, name: `${s.identity.make} ${s.identity.model}`, maker: s.topSpeedMph.value, governed: s.topSpeedGoverned?.value ?? null, core: t.mph, coreGov: t.governed });
  }
  for (const t of tops) print(`  ${pad(t.id, 38)} maker ${t.maker} mph${t.governed ? ' (governed)' : ''}; core ${fmt(t.core, 1)} mph${t.coreGov ? ' on its limiter' : ''} (${pct(t.core / t.maker - 1)})`);

  /* ---------- B1 */
  header('B1. Skidpad, car by car (core: the game\'s sheets uncalibrated; old: the baseline\'s ramp)');
  const skidCars: WorldCar[] = [CAMRY, CIVIC, { make: 'Toyota', model: 'Prius', style: 'hatchback' }, { make: 'BMW', model: '3 Series', style: 'sedan' }, MUSTANG,
    { make: 'Toyota', model: 'Supra', style: 'sports' }, CORVETTE, { make: 'Honda', model: 'Odyssey', style: 'van' }, { make: 'Ford', model: 'F-150', style: 'truck' }, { make: 'Chevy', model: 'Tahoe', style: 'suv' }];
  // The baseline's typical ranges (quoted there from memory, marked ≈): family sedans 0.80 to 0.87 g, sports cars 0.95 to 1.07, pickups and big SUVs 0.70 to 0.80.
  const typical: Record<string, [number, number]> = { sedan: [0.8, 0.87], hatchback: [0.8, 0.87], sports: [0.95, 1.07], truck: [0.7, 0.8], suv: [0.7, 0.8], van: [0.7, 0.8] };
  const skidRows = skidCars.map((car) => {
    const r = rows.find((x) => x.name === nameOf(car))!;
    return { name: nameOf(car), style: car.style, old: oldSkidpad(oldParams(car)), core: r.core.bench.skidpad300, cat: r.core.model.tyreFront.muY0 };
  });
  for (const k of skidRows) {
    const band = typical[k.style];
    const inBand = (g: number) => (band && (k.style !== 'sedan' || !/3 Series/.test(k.name)) ? (g >= band[0] - 0.005 && g <= band[1] + 0.005 ? 'in' : 'out of') : 'n/a');
    print(`  ${pad(k.name, 18)} old ${fmt(k.old, 3)} g, core ${fmt(k.core, 3)} g (front muY0 ${fmt(k.cat, 3)}); ≈ range ${band ? `${band[0]}-${band[1]}` : '-'}: old ${inBand(k.old)}, core ${inBand(k.core)}`);
  }

  /* ---------- B2 */
  header('B2. What moves grip (Camry on the sheet the game drives; skidpad on 300 ft)');
  const camry = rows.find((r) => r.name === 'Toyota Camry')!, cs = camry.core.sheet, cm = camry.core.model;
  const hIn = cm.chassis.cgHeight / IN, tfIn = cm.chassis.trackFront / IN, trIn = cm.chassis.trackRear / IN;
  const curb = (cs.curbWeightLb?.value ?? (cm.chassis.mass - 75) / LB);
  const base = skidpadAt(resolveModel(variant(cs, (s) => { s.cgHeightIn = figure(hIn); })).model, 300);
  const high = skidpadAt(resolveModel(variant(cs, (s) => { s.cgHeightIn = figure(1.3 * hIn); })).model, 300);
  const heavy = skidpadAt(resolveModel(variant(cs, (s) => { s.cgHeightIn = figure(hIn); s.curbWeightLb = figure(curb + 300 / LB); })).model, 300);
  const narrow = skidpadAt(resolveModel(variant(cs, (s) => { s.cgHeightIn = figure(hIn); s.trackFrontIn = figure(0.9 * tfIn); s.trackRearIn = figure(0.9 * trIn); })).model, 300);
  const stiffM = resolveModel(variant(cs, (s) => { s.cgHeightIn = figure(hIn); })).model;
  const bal0 = coreSteady(stiffM);
  stiffM.chassis.arbRear = stiffM.chassis.arbRear > 0 ? 2.5 * stiffM.chassis.arbRear : 0.5 * stiffM.chassis.arbFront;
  const bal1 = coreSteady(stiffM);
  print(`  core: stock ${fmt(base, 3)} g; centre of gravity 30% higher ${fmt(high, 3)} (${fmt(high - base, 3)}); 300 kg heavier ${fmt(heavy, 3)} (${fmt(heavy - base, 3)}); tracks 10% narrower ${fmt(narrow, 3)} (${fmt(narrow - base, 3)})`);
  print(`        rear bar 2.5x: steer for 0.65 g ${fmt(bal0.steer * 180 / Math.PI, 3)} -> ${fmt(bal1.steer * 180 / Math.PI, 3)} deg (less lock: toward oversteer)`);
  const oc = oldParams(CAMRY), oldBase = oldSkidpad(oc);
  const camrySpec = specFor(asCore(CAMRY));
  const oldHigh = oldSkidpad(carParams({ ...camrySpec, h: camrySpec.h * 1.3 }, STOCK, TUNE_DEF));
  const oldHeavy = oldSkidpad(carParams({ ...camrySpec, mass: camrySpec.mass + 300 }, STOCK, TUNE_DEF));
  print(`  old:  stock ${fmt(oldBase, 3)} g; centre of gravity 30% higher ${fmt(oldHigh, 3)} (${fmt(oldHigh - oldBase, 3)}); 300 kg heavier ${fmt(oldHeavy, 3)} (${fmt(oldHeavy - oldBase, 3)}); no track and no roll stiffness in the model`);
  // An inside wheel lifting: the least share of its static load any wheel keeps, steady at 0.97 of the car's own skidpad figure.
  const liftCars = ['Chevy Tahoe', 'Ford F-150', 'Honda Civic', 'Ford Mustang', 'Toyota Supra'].map((n) => rows.find((r) => r.name === n)!);
  const lifts = liftCars.map((r) => ({ name: r.name, least: coreSteady(r.core.model, 0.97 * r.core.bench.skidpad300).leastLoad }));
  const gtiModel = coreModelFor(asCore({ make: 'Folkswagen', model: 'Golph GTI', style: 'hatchback' }), STOCK, TUNE_DEF).model;
  lifts.push({ name: 'Golf GTI', least: coreSteady(gtiModel, 0.97 * runBench(gtiModel, 'skidpad').skidpad300).leastLoad });
  const lift = lifts.reduce((a, b) => (b.least < a.least ? b : a));
  print(`  core: at 0.97 of its own skidpad figure the lightest wheel keeps ${lifts.map((l) => `${l.name} ${fmt(100 * l.least, 0)}%`).join(', ')} of its static load (chassis.test.ts: a transfer past half an axle lifts the inner wheel to exactly zero)`);

  /* ---------- B3 */
  header('B3. How a tyre lets go (core tyre model at its reference load, 20 m/s; a 245/40R18)');
  const size = parseTyreSize('245/40R18')!, out: TyreOut = { fx: 0, fy: 0, mz: 0, use: 0 };
  const cats: TyreCategory[] = ['all-season', 'summer', 'max-performance', 'track', 'all-terrain'];
  type TyreRow = { cat: TyreCategory; peakDeg: number; at20: number; loadGain: number; relax: number };
  const tyreRows: TyreRow[] = cats.map((cat) => {
    const p = tyreParams(size, cat, 1, false), fz = p.fz0;
    const fyAt = (deg: number): number => { const a = deg * Math.PI / 180; tyreForces(p, fz, 0, Math.tan(a), 20 * Math.sin(a), 1, out); return Math.abs(out.fy); };
    let peak = 0, peakDeg = 0;
    for (let d = 0.25; d <= 25; d += 0.25) { const f = fyAt(d); if (f > peak) { peak = f; peakDeg = d; } }
    const peak2 = (() => { let b = 0; for (let d = 0.25; d <= 25; d += 0.25) { const a = d * Math.PI / 180; tyreForces(p, 2 * fz, 0, Math.tan(a), 20 * Math.sin(a), 1, out); b = Math.max(b, Math.abs(out.fy)); } return b; })();
    return { cat, peakDeg, at20: fyAt(20) / peak, loadGain: peak2 / peak, relax: p.relaxLat };
  });
  for (const t of tyreRows) print(`  ${pad(t.cat, 16)} peak at ${fmt(t.peakDeg, 2)} deg (peakSlipTan ${fmt(Math.atan(peakSlipTan(tyreParams(size, t.cat, 1, false), tyreParams(size, t.cat, 1, false).fz0, 1)) * 180 / Math.PI, 2)}); at 20 deg ${fmt(100 * t.at20, 0)}% of peak; double the load gives ${fmt(t.loadGain, 2)}x the force; force builds over ${fmt(t.relax, 2)} m of rolling`);
  print('  Old model: peak at 9 deg, 96% of it at 20 deg, no load dependence, force at once (the baseline; world/physics.ts tireCurve is unchanged).');

  /* ---------- B4 */
  header('B4. Lift and downforce (core)');
  const aeroLines: string[] = [];
  for (const car of [CAMRY, CORVETTE, MUSTANG]) {
    const r = rows.find((x) => x.name === nameOf(car))!, a = r.core.model.aero, basis = resolveModel(r.core.sheet).basis;
    const wing = resolveModel(r.core.sheet, { parts: [{ id: 'aero-rear-2' }], setup: {} }).model.aero;
    const slider = coreModelFor(asCore(car), STOCK, { ...TUNE_DEF, aero: 1 }).model.aero;
    const at = (x: typeof a, v: number) => 0.5 * 1.225 * v * v * (x.liftAreaFront + x.liftAreaRear);
    const v = 55;
    print(`  ${pad(nameOf(car), 16)} stock CdA ${fmt(a.dragArea, 3)} m^2 (${basis['aero.dragArea']}), lift ${fmt(at(a, v), 0)} N at 123 mph (${basis['aero.liftAreaFront']}); `
      + `big wing: lift ${fmt(at(wing, v), 0)} N, CdA ${fmt(wing.dragArea, 3)}; aero slider +1 with no part: lift ${fmt(at(slider, v), 0)} N, CdA ${fmt(slider.dragArea, 3)}`);
    aeroLines.push(`${nameOf(car).split(' ').slice(1).join(' ')} ${fmt(at(a, v), 0)} N of lift at 123 mph (${fmt(100 * at(a, v) / (r.core.model.chassis.mass * G), 1)}% of its weight), ${fmt(at(wing, v), 0)} N with the big wing and CdA ${fmt(a.dragArea, 3)} -> ${fmt(wing.dragArea, 3)} m^2`);
  }
  print('  Old model: every car carries downforce worth 20% of its weight at 123 mph at the default setting (the baseline; carParams downK is unchanged).');

  /* ---------- B5 */
  header('B5. Balance in a steady corner at 0.9 of the limit: hold, floor, lift for one second (stability and traction control off)');
  type Bal = { name: string; hold: { wide: number; r: number; beta: number }; floor: { wide: number; r: number; beta: number }; lift: { wide: number; r: number; beta: number } };
  const balCars: WorldCar[] = [CIVIC, MUSTANG, CORVETTE];
  const bal: Bal[] = balCars.map((car) => {
    const r = rows.find((x) => x.name === nameOf(car))!, m = r.core.model, skid = r.core.bench.skidpad300;
    return { name: nameOf(car), hold: coreCorner(m, skid, 'hold'), floor: coreCorner(m, skid, 'floor'), lift: coreCorner(m, skid, 'lift') };
  });
  for (const b of bal) {
    print(`  core ${pad(b.name, 16)} wide hold/floor/lift ${fmt(b.hold.wide)}/${fmt(b.floor.wide)}/${fmt(b.lift.wide)} m; yaw ${fmt(b.hold.r, 3)}/${fmt(b.floor.r, 3)}/${fmt(b.lift.r, 3)} rad/s; sideslip ${fmt(b.hold.beta * 180 / Math.PI, 1)}/${fmt(b.floor.beta * 180 / Math.PI, 1)}/${fmt(b.lift.beta * 180 / Math.PI, 1)} deg`);
  }
  const oldBal = balCars.map((car) => {
    const P = oldParams(car), skid = skidRows.find((k) => k.name === nameOf(car))?.old ?? oldSkidpad(P);
    return { name: nameOf(car), hold: oldCorner(P, skid, 'hold'), floor: oldCorner(P, skid, 'floor'), lift: oldCorner(P, skid, 'lift') };
  });
  for (const b of oldBal) print(`  old  ${pad(b.name, 16)} wide hold/floor/lift ${fmt(b.hold.wide)}/${fmt(b.floor.wide)}/${fmt(b.lift.wide)} m; yaw ${fmt(b.hold.r, 3)}/${fmt(b.floor.r, 3)}/${fmt(b.lift.r, 3)} rad/s`);
  const civicB = bal[0], mustangB = bal[1];
  const fwdWide = civicB.floor.wide > civicB.hold.wide + 0.3 && civicB.floor.r < civicB.hold.r;
  const rwdRot = mustangB.floor.r > 1.15 * mustangB.hold.r && mustangB.floor.beta < mustangB.hold.beta - 0.03;
  const liftTight = bal.every((b) => b.lift.wide < b.hold.wide - 0.05);
  const oFwdWide = oldBal[0].floor.wide > oldBal[0].hold.wide + 0.3, oRwdRot = oldBal[1].floor.r > 1.15 * oldBal[1].hold.r, oLift = oldBal.every((b) => b.lift.wide < b.hold.wide - 0.05);

  /* ---------- C1 */
  header('C1. Power is the car\'s own: the core\'s dyno against the published peaks (every researched sheet the game can drive)');
  type Dyno = { id: string; hp: number; hpErr: number; hpRpmErr: number; hpRpmOff: boolean; tq: number; tqErr: number; tqInPlateau: boolean | null };
  const dynos: Dyno[] = [];
  for (const s of SHEETS) {
    const b = runBench(resolveModel(s).model, 'dyno');
    if (s.horsepower === null) { print(`  ${pad(s.id, 38)} no power on file: drives at ${fmt(b.peakHp, 0)} hp (a class blank)`); continue; }
    // A peak's engine speed is read off the engine's table, so it counts as at the published speed within one table step.
    const m = resolveModel(s).model, gridRpm = m.engine.dOmega * 30 / Math.PI + 1;
    const tq = s.torqueLbFt?.value ?? NaN, lo = s.torqueRpmLow?.value ?? NaN, hi = s.torqueRpmHigh?.value ?? lo;
    const hpRpmErr = s.horsepowerRpm ? b.peakHpRpm - s.horsepowerRpm.value : NaN;
    const d: Dyno = { id: s.id, hp: s.horsepower.value, hpErr: b.peakHp / s.horsepower.value - 1, hpRpmErr, hpRpmOff: Math.abs(hpRpmErr) > gridRpm,
      tq, tqErr: b.peakTorqueLbFt / tq - 1, tqInPlateau: Number.isFinite(lo) ? b.peakTorqueRpm >= lo - gridRpm && b.peakTorqueRpm <= hi + gridRpm : null };
    dynos.push(d);
    print(`  ${pad(s.id, 38)} ${d.hp} hp -> ${pct(d.hpErr, 2)}${Number.isFinite(d.hpRpmErr) ? ` at ${d.hpRpmErr >= 0 ? '+' : ''}${d.hpRpmErr.toFixed(0)} rpm` : ''}; ${Number.isFinite(tq) ? `${tq} lb ft -> ${pct(d.tqErr, 2)}${d.tqInPlateau === null ? ' (no torque speed on file)' : d.tqInPlateau ? ' at its rpm' : ` at ${b.peakTorqueRpm.toFixed(0)} rpm, published ${lo === hi ? lo : `${lo}-${hi}`}`}` : 'no torque on file'}`);
  }
  const offSpeed = dynos.filter((d) => d.tqInPlateau === false || d.hpRpmOff).map((d) => d.id);
  const worstHp = Math.max(...dynos.map((d) => Math.abs(d.hpErr))), worstTq = Math.max(...dynos.filter((d) => Number.isFinite(d.tqErr)).map((d) => Math.abs(d.tqErr)));
  const tableWorst = Math.max(...rows.filter((r) => r.core.source === 'table').map((r) => Math.abs(r.core.bench.peakHp / r.table.hp - 1)));
  const noPower = SHEETS.filter((s) => s.horsepower === null).map((s) => s.id);
  print(`  Worst: power ${pct(worstHp, 2)}, torque ${pct(worstTq, 2)} on the researched sheets, each peak within one step of the engine's table (${fmt(resolveModel(SHEETS[0]).model.engine.dOmega * 30 / Math.PI, 0)} rpm) of its published speed${offSpeed.length ? ` but on ${offSpeed.join(', ')}` : ''}; power ${pct(tableWorst, 2)} on the table's cars. Old model: median ${pct(oldPowerErr)} off the table.`);

  /* ---------- C2 */
  header('C2. Each car is itself: what the core\'s model of each of the 36 is built from');
  const own = (key: string) => rows.filter((r) => { const b = resolveModel(r.core.sheet).basis[key]; return b === 'sourced' || b === 'derived'; }).length;
  const noMass = rows.filter((r) => { const b = resolveModel(r.core.sheet).basis['chassis.mass']; return b !== 'sourced' && b !== 'derived'; }).map((r) => r.name);
  const ownGears = own('driveline.gears'), ownSplit = own('chassis.a'), ownTyre = own('tyreFront.width'), ownCg = own('chassis.cgHeight'), ownTrack = own('chassis.trackFront'), ownDrag = own('aero.dragArea'), ownTrans = own('driveline.transmission'), ownMass = own('chassis.mass');
  print(`  Of the 36: own mass ${ownMass}, weight split ${ownSplit}, gear ratios ${ownGears}, tyre size ${ownTyre}, transmission ${ownTrans}, track ${ownTrack}, centre-of-gravity height ${ownCg}, drag ${ownDrag}.`);
  const same = (a: Row, b: Row) => ['zeroToSixty', 'topSpeed', 'skidpad300', 'braking60'].every((k) => Math.abs((a.core.bench as unknown as Record<string, number>)[k] - (b.core.bench as unknown as Record<string, number>)[k]) < 0.005) && Math.abs(a.core.bench.timeslip.quarter - b.core.bench.timeslip.quarter) < 0.005;
  const sameOld = (a: Row, b: Row) => Math.abs(a.old.t60 - b.old.t60) < 0.005 && Math.abs(a.old.quarter - b.old.quarter) < 0.005 && Math.abs(a.old.top - b.old.top) < 0.05;
  const twins: string[] = [], oldTwins: string[] = [];
  let inv = 0, invOld = 0, apart = 0;
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    if (same(rows[i], rows[j])) twins.push(`${rows[i].name} = ${rows[j].name}`);
    if (sameOld(rows[i], rows[j])) oldTwins.push(`${rows[i].name} = ${rows[j].name}`);
    const a = rows[i].table.zeroToSixty, b = rows[j].table.zeroToSixty;
    if (Math.abs(a - b) > 0.1 * Math.min(a, b)) {
      apart++;
      if (Math.sign(rows[i].core.bench.zeroToSixtyRollout - rows[j].core.bench.zeroToSixtyRollout) !== Math.sign(a - b)) inv++;
      if (Math.sign(rows[i].old.t60 - rows[j].old.t60) !== Math.sign(a - b)) invOld++;
    }
  }
  print(`  Identical pairs: old ${oldTwins.length} (${oldTwins.join('; ')}); core ${twins.length}${twins.length ? ` (${twins.join('; ')})` : ''}.`);
  print(`  Pairs more than 10% apart on the table's 0-60 that come out the other way round: old ${invOld}, core ${inv}, of ${apart}.`);
  const gearsCount = rows.reduce<Record<number, number>>((acc, r) => { const n = r.core.model.driveline.gears.length; acc[n] = (acc[n] ?? 0) + 1; return acc; }, {});
  print(`  Gear counts on the core: ${Object.entries(gearsCount).map(([n, k]) => `${k} with ${n}`).join(', ')} (old model: all six).`);

  /* ---------- C3 */
  header('C3. Every number says where it came from');
  const counts = rows.map((r) => { const b = resolveModel(r.core.sheet).basis; const n = { sourced: 0, derived: 0, calibrated: 0, estimated: 0 }; for (const k of Object.keys(b)) n[b[k]]++; return n; });
  const sumOf = (k: 'sourced' | 'derived' | 'calibrated' | 'estimated') => counts.reduce((a, n) => a + n[k], 0);
  print(`  Over the 36 as the game drives them: every model parameter carries a basis: ${sumOf('sourced')} sourced, ${sumOf('derived')} derived, ${sumOf('calibrated')} calibrated, ${sumOf('estimated')} estimated.`);
  print('  The game shows none of it, and a car that has not passed its checks drives (and is benched in the Garage) like one that has (world/core/model.ts, GarageMenu.tsx).');
  // Which way the class estimates lean: a table car is its six figures and its class, and its table 0-60 is a check
  // the core never sees (sheet.ts sheetFromTable). Estimates that lean unfavourable make the car slower than its figure.
  const tableCars = rows.filter((r) => r.core.source === 'table');
  const lean = tableCars.map((r) => r.core.bench.zeroToSixty / r.table.zeroToSixty - 1), leanRoll = tableCars.map((r) => r.core.bench.zeroToSixtyRollout / r.table.zeroToSixty - 1);
  const quicker = lean.filter((x) => x < -0.07).length, slower = lean.filter((x) => x > 0.07).length;
  print(`  The ${tableCars.length} table cars against their table 0-60 (no rollout): median ${pct(median(lean))} (with rollout ${pct(median(leanRoll))}); ${quicker} more than 7% quicker, ${slower} more than 7% slower. Most quicker: ${tableCars.map((r, i) => ({ n: r.name, x: lean[i] })).sort((a, b) => a.x - b.x).slice(0, 4).map((o) => `${o.n} ${pct(o.x, 0)}`).join(', ')}.`);

  /* ---------- D: one top-tier part at a time, Mustang */
  header('D1-D5, F1. One top-tier part at a time, Ford Mustang: the road (core and old) and the card (the Garage\'s bench card on the core; ruleset v1\'s table)');
  const parts: (keyof PerfCfg)[] = ['engine', 'ecu', 'turbo', 'nos', 'trans', 'weight', 'tires', 'susp', 'brakes'];
  const mCar = asCore(MUSTANG), mFig = benchFigures(mStock.core.bench, mStock.core.model), mCard = garageCard(mCar);
  const v1 = (perf: PerfCfg): { hp: number; t60: number } => {
    const r = applyModifications(mCard, cardMods(mCar, perf, TUNE_DEF)), sp = r.spec;
    const raw = sp.zeroToSixtySec?.value ?? NaN, sf = r.adjust.sprintFactor;
    const t60 = sf < 1 ? Math.max(raw * sf, Math.min(raw, ACCELERATION.estimate.floor)) : raw * sf;
    return { hp: sp.horsepower?.value ?? NaN, t60 };
  };
  const stockV1 = v1(STOCK);
  type PartRow = { part: string; core: CardFigures; card: { hp: number; t60: number }; v1: { hp: number; t60: number }; old: OldStraight; oldSkid: number; mass: number; cda: number };
  const oldMStockSkid = skidRows.find((k) => k.name === 'Ford Mustang')!.old;
  const builds: { part: string; perf: PerfCfg }[] = [...parts.map((p) => ({ part: p, perf: { ...STOCK, [p]: 3 } as PerfCfg })), { part: 'all nine', perf: TOP_TIER }];
  const partRows: PartRow[] = builds.map(({ part, perf }) => {
    const m = coreModelFor(mCar, perf, TUNE_DEF).model, fig = benchFigures(runBench(m), m);
    const sim = simulatedSpec(mCard, mFig, fig).spec;
    const oldP = oldParams(MUSTANG, perf);
    return { part, core: fig, card: { hp: sim.horsepower?.value ?? NaN, t60: sim.zeroToSixtySec?.value ?? NaN }, v1: v1(perf), old: oldStraight(oldP),
      oldSkid: part === 'tires' || part === 'susp' || part === 'all nine' ? oldSkidpad(oldP) : oldMStockSkid, mass: m.chassis.mass, cda: m.aero.dragArea };
  });
  print(`  stock: core ${fmt(mFig.horsepower, 0)} hp, 0-60 ${fmt(mFig.zeroToSixtySec)} s, ${fmt(mFig.quarterMileSec)} s @ ${fmt(mFig.quarterMileMph, 1)}, ${fmt(mFig.lateralGripG, 3)} g, 60-0 ${fmt(mFig.braking60to0Ft, 0)} ft, ${fmt(mStock.core.model.chassis.mass, 0)} kg; `
    + `old ${mStock.old.hp} hp, ${fmt(mStock.old.t60)} s, ${fmt(mStock.old.quarter)} s @ ${fmt(mStock.old.trap, 0)}; card ${fmt(mCard.horsepower?.value ?? NaN, 0)} hp, ${fmt(mCard.zeroToSixtySec?.value ?? NaN, 1)} s`);
  for (const p of partRows) {
    const c = p.core;
    print(`  ${pad(p.part, 9)} core road: power ${pct(c.horsepower / mFig.horsepower - 1, 0)}, 0-60 ${pct(c.zeroToSixtySec / mFig.zeroToSixtySec - 1, 0)}, quarter ${pct(c.quarterMileSec / mFig.quarterMileSec - 1)}, trap ${pct(c.quarterMileMph / mFig.quarterMileMph - 1)}, `
      + `skid ${fmt(c.lateralGripG - mFig.lateralGripG, 3)} g, 60-0 ${pct(c.braking60to0Ft / mFig.braking60to0Ft - 1)}, mass ${fmt(p.mass - mStock.core.model.chassis.mass, 0)} kg, CdA ${fmt(p.cda - mStock.core.model.aero.dragArea, 3)} | `
      + `bench card: hp ${pct(p.card.hp / (mCard.horsepower?.value ?? NaN) - 1, 0)}, 0-60 ${pct(p.card.t60 / (mCard.zeroToSixtySec?.value ?? NaN) - 1, 0)} | `
      + `v1 card: hp ${pct(p.v1.hp / stockV1.hp - 1, 0)}, 0-60 ${pct(p.v1.t60 / stockV1.t60 - 1, 0)} | old road${p.part === 'nos' || p.part === 'all nine' ? ' (nitrous not fired)' : ''}: power ${pct(p.old.hp / mStock.old.hp - 1, 0)}, 0-60 ${pct(p.old.t60 / mStock.old.t60 - 1, 0)}, quarter ${pct(p.old.quarter / mStock.old.quarter - 1)}, skid ${fmt(p.oldSkid - oldMStockSkid, 3)} g`);
  }
  const all9 = partRows[partRows.length - 1], all9Core = all9.core;
  const hale = 234 * Math.cbrt(all9Core.horsepower / ((all9.mass) / LB));
  print(`  All nine on the core: ${fmt(all9Core.horsepower, 0)} hp (nitrous shot in it), 0-60 ${fmt(all9Core.zeroToSixtySec)} s, ${fmt(all9Core.quarterMileSec)} s @ ${fmt(all9Core.quarterMileMph, 1)} mph (Hale's rule for that power and mass: ${fmt(hale, 1)} mph), ${fmt(all9Core.topSpeedMph, 0)} mph, ${fmt(all9Core.lateralGripG, 3)} g, 60-0 ${fmt(all9Core.braking60to0Ft, 0)} ft.`);
  print(`  On the bench card: ${fmt(all9.card.hp, 0)} hp, ${fmt(all9.card.t60)} s. On ruleset v1's card: ${fmt(all9.v1.hp, 0)} hp, ${fmt(all9.v1.t60)} s. Old road: ${all9.old.hp} hp, ${fmt(all9.old.t60)} s, ${fmt(all9.old.quarter)} s @ ${fmt(all9.old.trap, 0)} mph.`);
  const vette9 = coreModelFor(asCore(CORVETTE), TOP_TIER, TUNE_DEF).model, vette9F = benchFigures(runBench(vette9), vette9);
  print(`  A built Corvette on the core: ${fmt(vette9F.horsepower, 0)} hp, 0-60 ${fmt(vette9F.zeroToSixtySec)} s, ${fmt(vette9F.quarterMileSec)} s @ ${fmt(vette9F.quarterMileMph, 1)} mph, ${fmt(vette9F.topSpeedMph, 0)} mph.`);
  // The launch's floor at the tyres: a rear-drive car's 0-60 can be no quicker than 60 mph over the grip its rear tyres have under the whole car's weight.
  const rearMu = coreModelFor(mCar, TOP_TIER, TUNE_DEF).model.tyreRear.muY0 * coreModelFor(mCar, TOP_TIER, TUNE_DEF).model.tyreRear.muXRatio;
  print(`  The tyres' bound for the built Mustang (every newton of its weight on its rear track tyres, mu ${fmt(rearMu, 2)}): 0-60 no quicker than ${fmt(60 * MPH / (rearMu * G), 2)} s.`);
  // ECU and turbo on a boosted engine and an unboosted one (DESIGN.md 11: a tune is worth more on a turbo engine).
  const gain = (car: WorldCar, perf: PerfCfg): number => { const a = coreModelFor(asCore(car), STOCK, TUNE_DEF).model, b = coreModelFor(asCore(car), perf, TUNE_DEF).model; return runBench(b, 'dyno').peakHp / runBench(a, 'dyno').peakHp - 1; };
  const GTI: WorldCar = { make: 'Folkswagen', model: 'Golph GTI', style: 'hatchback' }, SUPRA: WorldCar = { make: 'Toyota', model: 'Supra', style: 'sports' };
  const tuneNa = [1, 2, 3].map((t) => gain(MUSTANG, { ...STOCK, ecu: t as PerfCfg['ecu'] })), tuneTurbo = [1, 2, 3].map((t) => gain(GTI, { ...STOCK, ecu: t as PerfCfg['ecu'] }));
  const turboNa = gain(MUSTANG, { ...STOCK, turbo: 3 }), turboOnTurbo = gain(SUPRA, { ...STOCK, turbo: 3 });
  const oldTune = (car: WorldCar, perf: PerfCfg) => { const a = oldParams(car), b = oldParams(car, perf); return simStats(b).hp / simStats(a).hp - 1; };
  print(`  ECU tiers 1-3, power: core on the unboosted Mustang ${tuneNa.map((x) => pct(x)).join(', ')}; on the turbo GTI ${tuneTurbo.map((x) => pct(x)).join(', ')}. Old: ${pct(oldTune(MUSTANG, { ...STOCK, ecu: 3 }))} and ${pct(oldTune(GTI, { ...STOCK, ecu: 3 }))} at tier 3.`);
  print(`  Turbo tier 3, power: core on the unboosted Mustang ${pct(turboNa)}, on the turbo Supra ${pct(turboOnTurbo)}. Old: ${pct(oldTune(MUSTANG, { ...STOCK, turbo: 3 }))} and ${pct(oldTune(SUPRA, { ...STOCK, turbo: 3 }))}.`);
  const turboRow = partRows.find((p) => p.part === 'turbo')!;
  const oldTurboTorque = (() => { const a = oldParams(MUSTANG), b = oldParams(MUSTANG, { ...STOCK, turbo: 3 }); return torqueAt(b, a.redline * 0.9, 1) / torqueAt(a, a.redline * 0.9, 0) - 1; })();
  print(`  F1, the top-tier turbo: road ${pct(turboRow.core.horsepower / mFig.horsepower - 1, 0)} on the core (old ${pct(turboRow.old.hp / mStock.old.hp - 1, 0)}, ${pct(oldTurboTorque, 0)} torque near redline); the Garage's bench card ${pct(turboRow.card.hp / (mCard.horsepower?.value ?? NaN) - 1, 0)}; ruleset v1's card ${pct(turboRow.v1.hp / stockV1.hp - 1, 0)}.`);
  const n3 = coreModelFor(mCar, { ...STOCK, nos: 3 }, TUNE_DEF).model.nitrous!;
  print(`  D5, nitrous-3: a shot of ${fmt(n3.power / HP_W, 0)} hp, a ${fmt(n3.bottleMass, 1)} kg bottle, ${fmt(n3.bottleMass / n3.flow, 0)} s of it at ${fmt(n3.flow * 1000, 1)} g/s; the race runner fills it free at every start (strip/events.ts start: PV.nos = PV.P.nos.cap). Old: up to 55% more torque, 8 s, refills itself (NOS_CAP, regen).`);
  const kit = coreModelFor(mCar, { ...STOCK, turbo: 3 }, TUNE_DEF).model;
  print(`  D2, costs on the core: the turbo kit ${fmt(kit.chassis.mass - mStock.core.model.chassis.mass, 0)} kg and a spool time of ${fmt(kit.engine.boost?.tauRef ?? NaN, 2)} s; race fuel draws 1.3x the fuel (core/driver.ts FUEL_1_FLOW); no part makes heat (nothing in the core models it).`);

  /* ---------- E1 */
  header('E1. Opponents on the core: a stock Ronin GT field on five circuits (seeded), flying lap against its own limit lap; sustained cornering');
  const fs = loadFs();
  const circuits = ['harbour_gp', 'royal_gp', 'figure8_gp', 'mountain_gp', 'ardennes_gp'];
  const ronin = coreModelFor(RONIN, STOCK, TUNE_DEF).model, roninSkid = runBench(ronin, 'skidpad').skidpad300;
  type Race = { ev: string; limit: number; laps: { skill: number; lap: number }[]; sustained: number };
  const races: Race[] = [];
  for (const ev of circuits) {
    const track = loadTrack(fs, trackOfEvent(ev)), route = routeFor(ev);
    const field = new CoreField(ronin, circuitLine(track), route, seededRandom(7));
    const p0 = routePoint(route, 0), fwd: [number, number] = [p0.tx, p0.tz], right: [number, number] = [-p0.tz, p0.tx], dir = Math.atan2(fwd[0], fwd[1]);
    const racers: FieldRacer[] = [];
    for (const [lane, back] of [[-3, 0], [3, 0], [-3, -8]] as const) {
      const x = p0.x + right[0] * lane + fwd[0] * back, z = p0.z + right[1] * lane + fwd[1] * back;
      const R: FieldRacer = { x, z, h: dir, v: 0, s: 0, steer: 0, vmax: 0, hold: false, done: false, parked: false, route };
      field.add(R, x, z, fwd[0], fwd[1]);
      R.s = routeProgress(route, x, z, 0, 30).s;
      racers.push(R);
    }
    const cross: number[][] = racers.map(() => []), lat: number[][] = racers.map(() => []);
    const L = route.len, dt = 1 / 60;
    let t = 0;
    for (let k = 0; k < 60 * 600 && cross.some((c) => c.length < 2); k++) {
      const before = racers.map((R) => R.s);
      field.frame(racers, dt, null);
      t += dt;
      racers.forEach((R, i) => {
        const lapsDone = cross[i].length;
        if (R.s >= (lapsDone + 1) * L && before[i] < (lapsDone + 1) * L) cross[i].push(t - (R.s - (lapsDone + 1) * L) / Math.max(1e-6, R.s - before[i]) * dt);
        lat[i].push(Math.abs(R.core!.s.ay) / G);
      });
    }
    races.push({ ev, limit: field.limit.lapTime, laps: racers.map((R, i) => ({ skill: R.core!.traits.skill, lap: cross[i].length >= 2 ? cross[i][1] - cross[i][0] : NaN })), sustained: Math.max(...lat.map((l) => bestWindow(l, 60))) });
  }
  for (const r of races) print(`  ${pad(r.ev, 12)} limit lap ${fmt(r.limit, 1)} s; flying laps ${r.laps.map((l) => `${fmt(l.lap, 1)} s (skill ${fmt(l.skill, 3)}, ${fmt(r.limit / l.lap, 3)} of the limit)`).join(', ')}; best sustained 1 s: ${fmt(r.sustained, 2)} g (its skidpad ${fmt(roninSkid, 2)} g)`);
  const shares = races.flatMap((r) => r.laps.map((l) => r.limit / l.lap));
  const e1Inside = shares.every((x) => x >= 0.8 - 1e-9 && x <= 1), e1Never = shares.every((x) => x <= 1);
  print(`  Every flying lap ${fmt(Math.min(...shares), 3)} to ${fmt(Math.max(...shares), 3)} of the limit lap (the band 0.80 to 0.98 of the envelope; never above 1): ${e1Inside ? 'inside' : 'NOT inside'}.`);
  print('  Old AI (the baseline, strip/ai.ts unchanged with the switch off): 2.1 to 5.2 g sustained beside a car whose tyres hold about 1.0 g.');

  /* ---------- E3 */
  header('E3. The drag strip: an engine held on its limiter in first gear (four seconds, pedal flat, manual box)');
  const coreLim = limiterHold(RONIN), oldLim = oldLimiterHold(oldParams(RONIN));
  print(`  core: up to ${fmt(coreLim.overRpm, 0)} rpm past redline, over-rev count ${fmt(coreLim.overRev, 2)} s: ${coreLim.blown ? 'the Strip would blow it (1.5 s)' : 'the Strip would not blow it'}; old: ${fmt(oldLim.overRpm, 0)} rpm, ${fmt(oldLim.overRev, 2)} s: ${oldLim.blown ? 'blown' : 'not blown'}.`);

  /* ---------- F2 */
  header('F2. The card\'s drag order against the driven quarter mile, stock, every pair of the 36');
  const w = RACE_MODE_RULES.drag.weights as Record<string, number>;
  const cardScore = rows.map((r) => {
    const car = ORIGINAL_36.find((c) => nameOf(c) === r.name)!, wc = { year: 2024, make: car.make, model: car.model, bodyStyle: car.style };
    const e = entrantFromLayer({ id: r.name, name: r.name, spec: engineSpecFor(wc), layer: cardStatsFor(wc), basis: 'base' });
    let s = 0;
    for (const k of Object.keys(w)) s += (e.attributes as Record<string, number | null>)[k] === null ? NaN : (e.attributes as Record<string, number>)[k] * w[k];
    return s;
  });
  const agree = (times: number[]): { agree: number; pairs: number } => {
    let a = 0, n = 0;
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      const dc = cardScore[i] - cardScore[j], dt = times[j] - times[i];
      if (Math.abs(dc) < 1e-9 || Math.abs(dt) < 0.005 || !Number.isFinite(dc + dt)) continue;
      n++;
      if (Math.sign(dc) === Math.sign(dt)) a++;
    }
    return { agree: a, pairs: n };
  };
  const f2Old = agree(rows.map((r) => r.old.quarter)), f2Core = agree(rows.map((r) => r.core.bench.timeslip.quarter));
  print(`  The card's drag score orders the pair as the strip does: old ${f2Old.agree} of ${f2Old.pairs} (${(100 * f2Old.agree / f2Old.pairs).toFixed(1)}%), core ${f2Core.agree} of ${f2Core.pairs} (${(100 * f2Core.agree / f2Core.pairs).toFixed(1)}%). A card race is still the card engine's weighted scores and a seed, not a run of the physics.`);

  /* ---------- F3 */
  header('F3. The server\'s floors (world/floors.json, used for either model)');
  const evs = EVENTS.filter((e) => fastestRun(e.id) !== null);
  print(`  ${evs.length} of ${EVENTS.length} events have a floor from a run; the outrun is paid by a time rule (payout.ts OUTRUN_MIN_MS), not a floor.`);
  const half = fastestRun('mountain_drag')!, quarter = fastestRun('royal_drag')!;
  const vetteHalfCore = dragSeconds(vette9, HALF_MILE_M), vetteHalfOld = oldDrag(oldParams(CORVETTE, TOP_TIER), HALF_MILE_M), tsuHalfOld = oldDrag(oldParams({ make: 'Tsubasa', model: 'R4', rental: true }, TOP_TIER), HALF_MILE_M);
  print(`  Mountain Half Mile: floor ${fmt(half.floor)} s (fastest ${fmt(half.fastest)} s, ${half.model} ${half.car}); a built Corvette here: core ${fmt(vetteHalfCore)} s, old scripted ${fmt(vetteHalfOld)} s; a built Tsubasa R4 old ${fmt(tsuHalfOld)} s. Royal Park Quarter: floor ${fmt(quarter.floor)} s (${quarter.model} ${quarter.car} ${fmt(quarter.fastest)} s).`);
  const f3Holds = vetteHalfCore >= half.floor && vetteHalfOld >= half.floor && tsuHalfOld >= half.floor;

  /* ---------- F4 */
  header('F4. Same inputs, same result');
  const golden = PROOF_CARS.map((n) => ({ n, ok: goldenRun(n) === GOLDEN[n] }));
  print(`  Node: the golden 2,000-step run gives the pinned hash on ${golden.filter((g) => g.ok).length} of ${golden.length} proof cars. No browser runs it (DESIGN.md open question 9; .github/workflows/ci.yml installs Chromium for the Strip smokes only).`);
  print('  The adapter and the walls still use the browser\'s own trigonometry (core/driver.ts syncIn and writeBack, world/driver.ts townCollider); there are no replays or ghosts.');

  /* ==================================================================== the scorecard */
  const sc: Score[] = [];
  const sixtyAll2 = sixtyGame.every((c) => ratio(c) <= 2), sixty3 = sixtyGame.filter((c) => c.pass).length >= 0.8 * sixtyGame.length && sixtyAll2 && (medGame.zeroToSixty ?? 1) <= 0.04;
  const quarterAll2 = [...quarterGame, ...trapGame].every((c) => ratio(c) <= 2);
  const topAll8 = tops.every((t) => Math.abs(t.core / t.maker - 1) <= 0.08) && topGame.every((c) => Math.abs(c.error) / c.real <= 0.08);
  const brakeAll2 = brakeGame.every((c) => ratio(c) <= 2);
  const skidAll2 = skidGame.every((c) => Math.abs(c.error) <= 0.08), skidAll1 = skidGame.every((c) => Math.abs(c.error) <= 0.04);
  const launchRwd = driven.filter((d) => /corvette|911/.test(d.id)).map((d) => d.player / d.real - 1);

  sc.push(score('A1', 'Launch', 6, 1, 1,
    `${launches.map((l) => `${l.name.split(' ').slice(1).join(' ')} ${l.drive} ${fmt(l.old30)} s/${fmt(l.oldPeak)} g`).join(', ')}: every car on the old model's body-style split.`,
    1, `0-30 ${launches.map((l) => `${l.name.split(' ').slice(1).join(' ')} ${fmt(l.core30)} s (${fmt(l.corePeak)} g)`).join(', ')}; wheelspin is each wheel's. No instrumented 0-30 or 60 ft figure is on file, so level 2's 15% cannot be shown; the two rear-drive validation cars floored in the game take ${launchRwd.map((x) => `${fmt(100 * x, 0)}%`).join(' and ')} longer to 60 mph than their tests, the Corvette held at its rear tyres, the 911 on a front-engine weight split (its engine location is not on file), and only ${launches.filter((l) => l.split === 'sourced' || l.split === 'derived').length} of these ${launches.length} drive on a published weight split.`,
    'Instrumented 0-30 and 60 ft figures on the sheets; the 911\'s engine location; the Corvette\'s launch off its summer tyre\'s range edge (VALIDATION.md); published weight splits for the table cars.'));
  sc.push(score('A2', '0-60 mph', 5, 1, 1, `${oldHit} of 36 within 7% or 0.3 s of the table, with power bent to get there (C1).`,
    sixty3 ? 3 : sixtyAll2 ? 2 : 1,
    `In the game (sheets uncalibrated, at their own weight): ${tally(sixtyGame)}; median ${pct(medGame.zeroToSixty ?? NaN)} (level 3 asks 4%). Floored through the adapter as a player does: ${driven.map((d) => `${SHEETS.find((q) => q.id === d.id)!.identity.model} ${pct(d.player / d.real - 1, 0)}`).join(', ')}. Against the table, ${coreHit} of 36 within 7% or 0.3 s with nothing fitted.`,
    'The Model 3\'s system power and the 911\'s engine location on file; the Corvette\'s tyre; launches judged against testers who launch as an expert does (Civic, Camry).'));
  sc.push(score('A3', 'Quarter mile', 5, 1, 1, `No quarter-mile figures were compared; the Engine part moves the Mustang's time ${pct(oldEngine.quarter / mStock.old.quarter - 1)} for ${pct(oldEngine.hp / mStock.old.hp - 1, 0)} power (rule ${pct(ruleOld - 1)}).`,
    quarterAll2 ? 2 : 1,
    `In the game: quarter ${tally(quarterGame)}, trap ${tally(trapGame)}${quarterAll2 ? '' : ' (level 2 asks every one within 8%)'}. The Engine part: power ${pct(mEngine.bench.peakHp / mStock.core.bench.peakHp - 1)}, quarter ${pct(mEngine.bench.timeslip.quarter / mStock.core.bench.timeslip.quarter - 1)} against the rule's ${pct(ruleCore - 1)}; the turbo kit ${pct(turboRow.core.horsepower / mFig.horsepower - 1, 0)} power, quarter ${pct(turboRow.core.quarterMileSec / mFig.quarterMileSec - 1)} against ${pct(Math.cbrt(mFig.horsepower / turboRow.core.horsepower) - 1)}: the quarter answers power at less than half the rule's rate. The bench makes a full timeslip; the Strip shows the finish time only.`,
    'The same missing inputs as A2; a timeslip on the Strip (60 ft, 330 ft, 1/8, 1000 ft, 1/4, reaction).'));
  sc.push(score('A4', 'Top speed and the limiter', 2, 1, 1, `${rows.filter((r) => topWithin(r, r.old.top)).length} of 36 within 4% by bending the final drive; ${governedOld.length} governed trucks, SUVs and vans run past their governor (${governedOld[0] ?? ''}).`,
    topAll8 ? 2 : 1,
    `Researched cars against their makers' figures: ${tops.map((t) => `${t.name} ${fmt(t.core, 0)} for ${t.maker} mph${t.coreGov ? ' (governed)' : ''}`).join(', ')}; the Camry's tested 133 mph governor: ${topGame.map((c) => `${fmt(c.model, 1)} mph`).join('')} on the class's. ${governedCore.length} table trucks past their governor and ${rows.filter((r) => topWithin(r, r.core.bench.topSpeed)).length} of 36 within 4% of the table, by construction: sheet.ts sheetFromTable reads every table top speed as a governor. The ${rows.filter((r) => r.core.source === 'table').length} table cars run on class gear ratios, not real ones.`,
    'Each car\'s own governed speed on its sheet; real ratios and a coast-down for the table cars.'));
  sc.push(score('A5', 'Braking', 2, 2, 2, '60-0 in 115 to 133 ft by body style; 300 kg changes nothing; Brakes -1%, Tyres -4%.',
    brakeAll2 ? 2 : 1,
    `In the game: ${tally(brakeGame)} (${brakeGame.map((c) => `${carOf(c)} ${c.name} ${fmt(c.model, 0)} ft for ${c.real}`).join(', ')}). Brakes top tier ${pct(partRows.find((p) => p.part === 'brakes')!.core.braking60to0Ft / mFig.braking60to0Ft - 1)} on the first stop, Tyres ${pct(partRows.find((p) => p.part === 'tires')!.core.braking60to0Ft / mFig.braking60to0Ft - 1)}: the tyres set it. Brake fade is not modelled.`,
    'Fade, so that brakes set how often a stop can be repeated; calibrated to its skidpad, the Corvette stops 8.9% short of its 70-0 (VALIDATION.md), so the stops pass in the game only because its grip is not fitted.'));

  sc.push(score('B1', 'Skidpad, car by car', 7, 1, 1, `One grip per body style: ${skidRows.map((k) => `${k.name.split(' ').slice(1).join(' ')} ${fmt(k.old, 2)}`).join(', ')} g.`,
    skidAll1 ? 3 : skidAll2 ? 2 : 1,
    `The game drives the researched sheets uncalibrated (data/sheets.ts: every calibration null; model.ts never calls calibrate): ${skidGame.map((c) => `${carOf(c)} ${c.name.replace(/ \(.*\)/, '').replace('skidpad ', '')} ${fmt(c.model, 3)} g for ${c.real} (${c.error >= 0 ? '+' : ''}${fmt(c.error, 3)})`).join(', ')}; calibrated, as VALIDATION.md runs them, the misses are -0.075 and -0.067 g and the GTI meets its figure, which would be level 2. Table cars: ${skidRows.map((k) => `${k.name.split(' ').slice(1).join(' ')} ${fmt(k.core, 2)}`).join(', ')} g.`,
    'Calibrated sheets in the game; the Corvette\'s and the Model 3\'s figures need more grip than their tyre categories allow (VALIDATION.md); a tyre grade on the table cars\' sheets.'));
  // Level 3 asks for all four effects and an inside wheel that can lift. The model can lift one (chassis.test.ts), but
  // if no car of the game lifts one at its limit (a Golf GTI is the textbook three-wheeler) the lift is not shown on a
  // car, and the level stays at 2: the sizes above have no published figure to hold them to either.
  const b2Four = high < base - 0.005 && heavy < base - 0.005 && narrow < base - 0.005 && bal1.steer < bal0.steer - 1e-4;
  const b2Core = b2Four && lift.least < 0.02 ? 3 : high < base - 0.005 && heavy < base - 0.005 ? 2 : 1;
  sc.push(score('B2', 'What moves grip', 5, 0, 0, `30% higher costs ${fmt(oldHigh - oldBase, 3)} g and 300 kg ${fmt(oldHeavy - oldBase, 3)} g; no left and right in the model.`,
    b2Core,
    `Camry: 30% higher ${fmt(high - base, 3)} g, 300 kg ${fmt(heavy - base, 3)} g, 10% narrower ${fmt(narrow - base, 3)} g, 2.5x rear bar ${fmt((bal1.steer - bal0.steer) * 180 / Math.PI, 3)} deg of steer at 0.65 g (toward oversteer). An inner wheel lifts to exactly zero once the transfer passes half an axle (chassis.test.ts); on the game's cars at 0.97 of their limit the lightest wheel keeps ${fmt(100 * lift.least, 0)}% (${lift.name}) or more, so no car in the world lifts one, the GTI included, a car known for lifting its inside rear wheel when cornered hard.`,
    'An inside wheel that lifts on the cars that lift one (roll stiffness split and bar rates for front-drive hatchbacks); the sizes are the model\'s, with no published figure to hold them to; on the sports, coupe and pickup classes the rear bar is 0, so a part or setup that scales it moves nothing (DESIGN.md open question 4).'));
  const at20 = tyreRows.filter((t) => t.cat !== 'track').map((t) => t.at20);
  const b3Fall = at20.every((x) => x >= 0.75 && x <= 0.9);
  sc.push(score('B3', 'How a tyre lets go', 4, 1, 1, 'Peak at 9 degrees, 96% at 20, no load dependence, force at once, a fixed 8% loss for a spinning wheel.',
    b3Fall ? 2 : 1,
    `${tyreRows.map((t) => `${t.cat} peak ${fmt(t.peakDeg, 1)} deg, ${fmt(100 * t.at20, 0)}% at 20, x${fmt(t.loadGain, 2)} for double load, ${fmt(t.relax, 2)} m`).join('; ')}. One friction ellipse per wheel for drive, brake and steer.`,
    'Each grade\'s numbers are class estimates with no sourced range to sit inside; a locked wheel\'s sliding force tilts sideways (DESIGN.md open question 1).'));
  sc.push(score('B4', 'Lift and downforce', 2, 1, 1, 'Every car carries downforce worth 20% of its weight at 123 mph at the default setting.',
    2, `A stock car lifts slightly and a wing turns that to downforce with its drag: ${aeroLines.join('; ')}. But the lift is a class estimate on every car (no sheet carries a lift figure) and the drag a class estimate on ${36 - ownDrag} of the 36, and the aero slider at +1 adds a modest lip and wing with their drag even with no part fitted.`,
    'Published lift coefficients; the slider\'s downforce only with a part that makes it.'));
  sc.push(score('B5', 'Balance', 2, 2, oFwdWide && oRwdRot && oLift ? 2 : 1,
    `Measured now: Civic wide ${fmt(oldBal[0].hold.wide)} -> ${fmt(oldBal[0].floor.wide)} m floored; Mustang yaw ${fmt(oldBal[1].hold.r, 3)} -> ${fmt(oldBal[1].floor.r, 3)} rad/s floored; no rear-drive car rotates: floored in a held gear, the Mustang and the Corvette run wide (${fmt(oldBal[1].floor.wide)} and ${fmt(oldBal[2].floor.wide)} m) and yaw less; counter-steer help and a steering fade sit inside the car model; lift tightens the line on ${oldBal.filter((b) => b.lift.wide < b.hold.wide - 0.05).length} of 3. The baseline's provisional 2 does not survive the measurement.`,
    fwdWide && rwdRot && liftTight ? 3 : 2,
    `Civic floored: ${fmt(civicB.hold.wide)} -> ${fmt(civicB.floor.wide)} m wide, yaw ${fmt(civicB.hold.r, 3)} -> ${fmt(civicB.floor.r, 3)}; Mustang floored: yaw ${fmt(mustangB.hold.r, 3)} -> ${fmt(mustangB.floor.r, 3)}, sideslip ${fmt(mustangB.hold.beta * 180 / Math.PI, 1)} -> ${fmt(mustangB.floor.beta * 180 / Math.PI, 1)} deg; lifting tightens on ${bal.filter((b) => b.lift.wide < b.hold.wide - 0.05).length} of 3. Driver help is the assist layer (core/assists.ts), Pure turns it off; no special case in the car.`,
    fwdWide && rwdRot && liftTight ? '' : 'All three behaviours on every layout.'));

  sc.push(score('C1', 'Power is the car\'s own', 5, 0, 0, `Median ${pct(oldPowerErr)} off the table; torque scaled until 0-60 matches.`,
    worstHp <= 0.005 && worstTq <= 0.005 && offSpeed.length === 0 && noPower.length === 0 ? 3 : worstHp <= 0.02 && worstTq <= 0.02 ? 2 : 1,
    `Researched sheets: worst ${pct(worstHp, 2)} power and ${pct(worstTq, 2)} torque${offSpeed.length ? ` (the torque peak off its published speed on ${offSpeed.join(', ')})` : ' at their published speeds'}; the table's cars ${pct(tableWorst, 2)}. Nothing is fitted to an acceleration test. But ${noPower.join(', ')} has no power on file and the game drives it as a ${fmt(runBench(resolveModel(SHEETS.find((s) => s.id === noPower[0])!).model, 'dyno').peakHp, 0)} hp class blank${noPower.length ? ', so one world car\'s power is not its own' : ''}.`,
    'A sourced system power for the Model 3 (and a rule that a car with no power figure does not drive as if it had one).'));
  sc.push(score('C2', 'Each car is itself', 4, 1, 1, `Seven body-style chassis, all with six gears; identical pairs: ${oldTwins.join('; ')}.`,
    ownGears >= 36 && ownSplit >= 36 && ownTyre >= 36 ? 2 : 1,
    `Of the 36 the game drives: own mass ${ownMass}, weight split ${ownSplit}, gear ratios ${ownGears}, tyre size ${ownTyre}, centre-of-gravity height ${ownCg}, track ${ownTrack}; ${twins.length} identical pairs; ${inv} of ${apart} pairs 10% apart on the table's 0-60 ordered the other way (old ${invOld}). The ${rows.filter((r) => r.core.source === 'table').length} table cars are their six figures and their class${noMass.length ? `; ${noMass.join(' and ')} drive at a class blank's weight (no curb weight on file)` : ''}.`,
    'Researched sheets for the table cars (ratios, split, tyres, dimensions); the 911\'s engine location.'));
  sc.push(score('C3', 'Every number says where it came from', 3, 1, 1, 'The card engine marks its figures; the driving model marks nothing (world/physics.ts and world/data.ts specFor, unchanged).',
    // Level 3 asks that estimates lean unfavourable. A median lean quicker than the 0-60 tolerance (7%) would show
    // they lean the other way and cost a level; within it the table's own scatter (its figures are unverified) hides it.
    median(lean) < -0.07 ? 1 : 2,
    `Every parameter of every model carries a basis (36 cars: ${sumOf('sourced')} sourced, ${sumOf('derived')} derived, ${sumOf('estimated')} estimated, ${sumOf('calibrated')} calibrated). That the estimates lean unfavourable is not shown: the ${tableCars.length} table cars, built from six figures and class estimates, reach 60 mph a median ${fmt(-100 * median(lean), 1)}% quicker than their table's 0-60 (${quicker} of them more than 7% quicker, the trucks and SUVs most; ${slower} more than 7% slower). Nothing in the game labels a car that has not passed its checks, and the six that have checks drive uncalibrated; ranked card play does not read the core at all.`,
    'Class estimates that make a car slower than its figures, not quicker (gearing, transmission type and launch for the table cars); a label in the Garage for a car that has not passed its checks; ranked play kept to checked cars once it reads the core.'));

  // EXAM.md's verdict (exam.test.ts, EXAM_TABLE=1): 57 figures examined, 39 within the band.
  const exam = { examined: 57, within: 39 };
  // Level 2: the gain depends on the engine and stays inside the range published for the part: an unboosted tune
  // 2% to 5% (the baseline's ≈), a stage-1 map on a factory turbo +4% to +36% on the exam's eight dynos.
  const d1Level = tuneNa[0] >= 0.02 && tuneNa[0] <= 0.05 && tuneTurbo[0] >= 0.04 && tuneTurbo[0] <= 0.36 && tuneTurbo[0] > 2 * tuneNa[0] ? 2 : 1;
  sc.push(score('D1', 'Power parts match the dyno, by engine', 6, 1, 1, `The same percentage on any engine: ECU tier 3 ${pct(oldTune(MUSTANG, { ...STOCK, ecu: 3 }))} on the V8 and ${pct(oldTune(GTI, { ...STOCK, ecu: 3 }))} on the turbo four; Turbo tier 3 ${pct(oldTune(MUSTANG, { ...STOCK, turbo: 3 }))} and ${pct(oldTune(SUPRA, { ...STOCK, turbo: 3 }))}.`,
    d1Level, `Gains come from airflow: ECU tiers on the V8 ${tuneNa.map((x) => pct(x)).join(', ')}, on the turbo GTI ${tuneTurbo.map((x) => pct(x)).join(', ')}; a turbo kit ${pct(turboNa)} on the V8, a bigger turbo ${pct(turboOnTurbo)} on the Supra. The parts exam: ${exam.within} of ${exam.examined} figures within the band, the stage-1 map in the lower half of real results (EXAM.md).`,
    'The exam\'s 18 misses: stage-1 maps that gain more torque than power, a centrifugal kit, the nitrous window (EXAM.md, its last section).'));
  sc.push(score('D2', 'Parts carry their real costs', 4, 1, 1, 'On the road a part costs nothing but the turbo\'s spool; the card charges reliability and durability.',
    2, `A turbo kit adds ${fmt(kit.chassis.mass - mStock.core.model.chassis.mass, 0)} kg on the nose and ${fmt(kit.engine.boost?.tauRef ?? NaN, 2)} s of spool; nitrous 16 kg and a bottle that empties; wings their drag; race fuel 1.3x the fuel; clutch capacity limits what goes through; the card engine charges the same build's reliability and durability (garageBench.ts cardMods).`,
    'Heat (charge temperature, brake and engine heat) and what a gearbox can hold.'));
  const d3Tyre = partRows.find((p) => p.part === 'tires')!, d3Susp = partRows.find((p) => p.part === 'susp')!, d3Weight = partRows.find((p) => p.part === 'weight')!;
  sc.push(score('D3', 'Chassis parts do what they really do', 5, 1, 1, 'Tyres +0.18 g and -13% 0-60; Suspension +0.10 g by raising grip; Weight -1% 0-60; nothing has a downside.',
    2, `Mustang top tier: Tyres +${fmt(d3Tyre.core.lateralGripG - mFig.lateralGripG, 3)} g, 60-0 ${pct(d3Tyre.core.braking60to0Ft / mFig.braking60to0Ft - 1)}, 0-60 ${pct(d3Tyre.core.zeroToSixtySec / mFig.zeroToSixtySec - 1)}; Suspension +${fmt(d3Susp.core.lateralGripG - mFig.lateralGripG, 3)} g from a lower, stiffer car (the baseline's ≈ 0.02 to 0.05 g); Weight 0-60 ${pct(d3Weight.core.zeroToSixtySec / mFig.zeroToSixtySec - 1)}. The exam: tyres 4 of 4, weight 10 of 10, suspension 1 of 1 (its band wider than the change).`,
    'Brake fade (so that brakes change repetition, not the first stop); the rear bar on three classes (open question 4); more exam cases for springs and bars.'));
  // Level 2 asks that no build beat documented builds of its kind. None is on file, so the bound used is the tyre's:
  // a road tyre's highest speed rating (Y, or (Y) above it) is 186 mph and up, and no documented street-bodied
  // Corvette build is reported near 250 mph; the launch's bound is the tyres' grip under the car's whole weight.
  const vMustang = all9Core.zeroToSixtySec, haleOk = Math.abs(all9Core.quarterMileMph / hale - 1) <= 0.06, absurdTop = vette9F.topSpeedMph > 250;
  sc.push(score('D4', 'A fully built car stays inside reality', 3, 0, 0, `All nine on the Mustang: ${all9.old.hp} hp, ${fmt(all9.old.quarter, 1)} s @ ${fmt(all9.old.trap, 0)} mph on the road; ${fmt(all9.v1.hp, 0)} hp and ${fmt(all9.v1.t60)} s on the card.`,
    !absurdTop && haleOk && vMustang >= 60 * MPH / (rearMu * G) ? 2 : 1,
    `All nine on the Mustang: ${fmt(all9Core.horsepower, 0)} hp with the shot, 0-60 ${fmt(vMustang)} s (the tyres allow no less than ${fmt(60 * MPH / (rearMu * G), 2)} s), ${fmt(all9Core.quarterMileSec)} s @ ${fmt(all9Core.quarterMileMph, 1)} mph (Hale ${fmt(hale, 1)}); a built Corvette ${fmt(vette9F.horsepower, 0)} hp, ${fmt(vette9F.quarterMileSec)} s and ${fmt(vette9F.topSpeedMph, 0)} mph (the old model's 277 mph that the baseline called out, again: nothing limits a road tyre's speed or a body's lift). The Mustang keeps its stock 155 mph governor through a race tune, so its trap stops there. Power stops at the parts' airflow and knock limits, the launch at the tyres. The Garage's card follows the bench (${fmt(all9.card.hp, 0)} hp, ${fmt(all9.card.t60)} s); ruleset v1's card still says ${fmt(all9.v1.hp, 0)} hp and ${fmt(all9.v1.t60)} s. No documented build is on file to hold a built car to.`,
    'Documented built cars (dyno sheets and timeslips of whole builds) to land within tolerance of.'));
  sc.push(score('D5', 'Nitrous', 2, 1, 1, '30% to 55% more torque for 4 to 8 s; the bottle refills itself in under a minute; the card adds 28%, always.',
    2, `A fixed shot (${fmt(n3.power / HP_W, 0)} hp), a ${fmt(n3.bottleMass, 1)} kg bottle that empties and stays empty (${fmt(n3.bottleMass / n3.flow, 0)} s of shot); the card engine charges its reliability. The race runner fills it free at every start; nothing models its pressure.`,
    'A refill that costs money, and the bottle\'s pressure falling as it empties.'));

  sc.push(score('E1', 'Opponents obey their car', 6, 0, 0, 'A point on a line: 1.5 g on tight bends, none on gentle ones, 2.1 to 5.2 g sustained (baseline; strip/ai.ts unchanged).',
    e1Inside && e1Never ? 3 : 2,
    `Each racer is the player's car on the same step with a seeded pilot: flying laps ${fmt(Math.min(...shares), 3)} to ${fmt(Math.max(...shares), 3)} of its own limit lap on five circuits, none faster; best sustained cornering ${fmt(Math.max(...races.map((r) => r.sustained)), 2)} g against its ${fmt(roninSkid, 2)} g skidpad. The drag strip's cars are core cars with pilots too.`,
    e1Inside && e1Never ? '' : 'Every lap inside the skill band.'));
  sc.push(score('E2', 'Close racing without cheating', 3, 1, 1, 'Speed with the gap (+8% 25 m behind, +22% 70 m behind, -14% 60 m ahead); drag opponents 91% to 117% of the player\'s torque.',
    2, 'No speed changes with the gap (core/opponents.ts); the field is the player\'s own car, so of the player\'s class by construction; drag cars are the player\'s car on the core. There are no handicap rules a player can read.',
    'Handicaps as written rules: a bracket dial-in, ballast, a reversed grid.'));
  sc.push(score('E3', 'Drag strip procedure', 3, 1, 1, `A 3-2-1 count, the reaction in the time, no red light, no splits; the engine is destroyed after 1.5 s past redline (measured: ${fmt(oldLim.overRev, 2)} s of over-rev in four seconds on the limiter, ${oldLim.blown ? 'blown' : 'not blown'}).`,
    1, `Unchanged around the car (strip/events.ts): the same count and timing, no red light, no 60 ft or trap on the Strip. The core has a real limiter, and on it the engine ${coreLim.blown ? `still counts as over-revved and is destroyed (${fmt(coreLim.overRpm, 0)} rpm past redline, ${fmt(coreLim.overRev, 2)} s)` : `stays within ${fmt(coreLim.overRpm, 0)} rpm of redline and is not destroyed; the instant failure is still the rule for an engine 1.5 s past redline + 100 rpm (a missed downshift)`}.`,
    'Staging beams, the tree in both forms, the red light, the rollout, a full timeslip, heads-up and bracket racing, wear in place of the instant failure.'));
  sc.push(score('E4', 'Circuit procedure and terrain', 2, 2, 2, 'Five lights, sectors and gaps, ten layouts about 1% off the real lengths; flat world; no jump-start or track-limit penalty.',
    2, 'The same around the car: the core can take a gradient (WorldQuery), but the game passes FLAT; no penalty for a jumped start or a cut corner.',
    'Elevation in the tracks; penalties for a jumped start and a cut corner.'));
  sc.push(score('E5', 'Drift', 2, 1, 1, 'A mode that cuts rear grip to 68% and drives any car 30/70; scored by speed x angle x time.',
    1, `No grip is cut: a drift turns stability and traction control off and widens the steering limit (assists.ts); a powerful rear-drive car steps out on its own (B5: the Mustang's yaw ${fmt(mustangB.hold.r, 3)} -> ${fmt(mustangB.floor.r, 3)} rad/s floored), and a car that cannot drift says so. But the event is still a mode scored by speed x angle x time with no zones, and the computer drifters' scores are seeded dice, not their driving (strip/events.ts).`,
    'Judged zones (line, angle, speed); opponents scored on their own driving; no drift switch at all.'));

  sc.push(score('F1', 'A part does the same thing on the card and on the road', 5, 0, 0, `The top-tier turbo: road ${pct(turboRow.old.hp / mStock.old.hp - 1, 0)} power, card ${pct(turboRow.v1.hp / stockV1.hp - 1, 0)}; all nine: 0-60 ${fmt(all9.old.t60)} s on the road, ${fmt(all9.v1.t60)} s on the card (the baseline's 1.73 s; the card's 0-60 now stops at its estimate's ${ACCELERATION.estimate.floor} s floor).`,
    1, `In the switch-on Garage one catalogue (parts.ts) moves the road and the card the Garage shows: the top-tier turbo is ${pct(turboRow.core.horsepower / mFig.horsepower - 1, 0)} on the road and ${pct(turboRow.card.hp / (mCard.horsepower?.value ?? NaN) - 1, 0)} on the Garage's bench card, whose class letter is the bench's (level 3's mechanism). But the card itself, the one card races read, is still ruleset v1's table: the same turbo ${pct(turboRow.v1.hp / stockV1.hp - 1, 0)}, all nine ${fmt(all9.v1.hp, 0)} hp and ${fmt(all9.v1.t60)} s against the road's ${fmt(all9Core.horsepower, 0)} hp and ${fmt(all9Core.zeroToSixtySec)} s. Two catalogues with two sets of numbers remain, so level 2 is not met; the bench card is offered beside v1, not in its place.`,
    'The owner adopting the bench card as a ruleset (level 2 at once); worn cars benched (level 3).'));
  const f2Share = f2Core.agree / f2Core.pairs;
  // The baseline scored 90.9% of pairs at level 2: that reading (90% or better) is kept, and level 3 also needs a card race to be a run of the physics, which it is not on either model.
  sc.push(score('F2', 'The card\'s result is the driven result', 3, 2, f2Old.agree / f2Old.pairs >= 0.9 ? 2 : 1, `Measured now: the card's drag order agrees with the old model's quarter mile in ${f2Old.agree} of ${f2Old.pairs} pairs (${(100 * f2Old.agree / f2Old.pairs).toFixed(1)}%).`,
    f2Share >= 0.9 ? 2 : 1,
    `The card's drag order agrees with the core's quarter mile in ${f2Core.agree} of ${f2Core.pairs} pairs (${(100 * f2Share).toFixed(1)}%). A card race is the card engine's weighted scores and a seed, not a run of the physics.`,
    'Card races as seeded runs of the same physics, 97% of pairs in every mode.'));
  sc.push(score('F3', 'The server\'s limits come from the physics', 2, 1, f3Holds ? 3 : 2,
    `The floors are shared by both models: ${evs.length} of ${EVENTS.length} events have the fastest legal build's run less a stated 10% (floors.json, payout.ts raceFloor), each car bounded on both models. Half mile ${fmt(half.floor)} s under every built run measured here (old Corvette ${fmt(vetteHalfOld)} s, Tsubasa ${fmt(tsuHalfOld)} s).`,
    f3Holds ? 3 : 2,
    `The same table: the half mile's ${fmt(half.floor)} s floor under the built Corvette's ${fmt(vetteHalfCore)} s on the core.`,
    'The server re-running the input log in place of a floor (the rubric\'s "later").'));
  sc.push(score('F4', 'Same inputs, same result, everywhere', 2, 2, 2, 'A card race is seeded and replayable; a driven race uses the browser\'s trigonometry and unseeded random numbers.',
    2, `The core is deterministic and its golden hash holds in Node on ${golden.filter((g) => g.ok).length} of ${golden.length} proof cars; a race with the switch on is seeded. No browser has run the hash, the adapter and the walls use the browser's trigonometry, and there are no replays.`,
    'The golden hash in Chromium, Firefox and WebKit (open question 9); deterministic walls and adapter; replays.'));

  printCard(sc);
  print(`\n(${((host.performance.now() - t0) / 1000).toFixed(0)} s)`);
}

/* ------------------------------------------------------------------ the scorecard */

type Score = { id: string; name: string; weight: number; baseline: number; old: number; core: number; oldWhy: string; coreWhy: string; gap: string; note: string };

/** One criterion's scores: the baseline's level, the old model's and the core's now, the evidence for each, and what level 3 still needs. */
function score(id: string, name: string, weight: number, baseline: number, old: number, oldWhy: string, core: number, coreWhy: string, gap: string, note = ''): Score {
  return { id, name, weight, baseline, old, core, oldWhy, coreWhy, gap, note };
}

const AREAS: readonly [string, string][] = [['A', 'Straight line'], ['B', 'Cornering and tyres'], ['C', 'Honest inputs'], ['D', 'Modifications, one to one'], ['E', 'Opponents and race rules'], ['F', 'One truth']];
const points = (s: Score, level: number): number => s.weight * level / 3;

function printCard(sc: readonly Score[]): void {
  header('Scorecard (levels 0 to 3; points = weight x level / 3)');
  print(`${pad('', 4)} ${pad('criterion', 52)} ${pad('w', 3)} base  old  core   old pts  core pts`);
  let tb = 0, to = 0, tc = 0;
  for (const [letter, area] of AREAS) {
    const inArea = sc.filter((s) => s.id[0] === letter);
    let b = 0, o = 0, c = 0, w = 0;
    for (const s of inArea) {
      b += points(s, s.baseline); o += points(s, s.old); c += points(s, s.core); w += s.weight;
      print(`${pad(s.id, 4)} ${pad(s.name, 52)} ${pad(String(s.weight), 3)} ${pad(String(s.baseline), 5)} ${pad(String(s.old), 4)} ${pad(String(s.core), 6)} ${pad(points(s, s.old).toFixed(1), 8)} ${points(s, s.core).toFixed(1)}`);
    }
    print(`     ${pad(`${letter}. ${area}`, 52)} ${pad(String(w), 3)} ${pad(b.toFixed(1), 10)} ${pad('', 6)} ${pad(o.toFixed(1), 8)} ${c.toFixed(1)}`);
    tb += b; to += o; tc += c;
  }
  print(`     ${pad('Total', 52)} 100 ${pad(tb.toFixed(1), 10)} ${pad('', 6)} ${pad(to.toFixed(1), 8)} ${tc.toFixed(1)}`);
  header('Evidence, criterion by criterion');
  for (const s of sc) {
    print(`${s.id} ${s.name} (weight ${s.weight}): old ${s.old}, core ${s.core}`);
    print(`   old:  ${s.oldWhy}`);
    print(`   core: ${s.coreWhy}`);
    if (s.core < 3 && s.gap) print(`   to level 3: ${s.gap}`);
    if (s.note) print(`   note: ${s.note}`);
  }
}

/* ------------------------------------------------------------------ tracks from disk */

function loadFs(): FileSystem {
  // tsx runs this file as ESM, where require is not defined, and the core's compilers know no Node types: the file
  // system is asked of Node by name (process.getBuiltinModule, Node 22) and typed by the one call it makes.
  const req = (globalThis as unknown as { process?: { getBuiltinModule?(n: string): unknown } }).process?.getBuiltinModule?.(NODE_FS);
  if (!req) throw new Error('rubric.ts needs Node 22 or newer (process.getBuiltinModule)');
  return req as FileSystem;
}

const TRACK_DIR = new URL('../../../apps/sim/public/strip/tracks/', import.meta.url);
/** A circuit's track file read from the game's public assets and put in the Strip's cache, as the server's reader does. */
function loadTrack(fs: FileSystem, id: string): TrackData {
  const hit = trackLoaded(id);
  if (hit) return hit;
  const data = JSON.parse(fs.readFileSync(decodeURIComponent(new URL(`${id}.json`, TRACK_DIR).pathname), 'utf8')) as TrackData;
  registerTrack(id, data);
  return data;
}

main();
