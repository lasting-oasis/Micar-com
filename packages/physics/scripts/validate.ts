// The validation table (DESIGN.md section 9, the plan of record's section 7): every researched sheet that carries test
// figures is calibrated (tyre grip to its skidpad, drag to an ungoverned top speed, nothing else), resolved, run on the
// bench, and checked against its tests at the plan's tolerances. Prints one table, the totals and the stage gate, and
// each car's basis counts (how many of its model's parameters are sourced, derived, calibrated or estimated).
//
// From the repository root:
//   pnpm --filter @micar/sim exec tsx ../../packages/physics/scripts/validate.ts
import type { Basis, PhysicsSheet, SheetTests } from '../src/types';
import type { Check } from '../src/calibrate';
import { runBench } from '../src/bench';
import { MEDIAN_QUARTER, MEDIAN_ZERO_TO_SIXTY, ORDER_GAP, calibrate, checkSheet, fleetMedians, orderInversions } from '../src/calibrate';
import { SHEETS } from '../src/data/sheets';
import { resolveModel } from '../src/resolve';

// The host's clock and console: not in the ES2020 library the package compiles against, so reached through globalThis.
type Host = { performance: { now(): number }; console: { log(...args: unknown[]): void } };
const host = globalThis as unknown as Host;
const print = (line: string): void => host.console.log(line);

/** The plan's gate: at least this share of the cars with GATE_CHECKS or more checks pass every one... */
const GATE_SHARE = 0.8;
const GATE_CHECKS = 5;
/** ...and none of them misses any check by more than this many times its tolerance... */
const GATE_MISS = 2;
/** ...on at least this many cars (the plan's stage 1: "at least ten of the sixteen")... */
const GATE_CARS = 10;
// ...with the fleet's median 0-60 and quarter-mile errors within MEDIAN_ZERO_TO_SIXTY and MEDIAN_QUARTER, and no two
// cars more than ORDER_GAP apart on a published figure put the other way round (calibrate.ts).

const TEST_KEYS: readonly (keyof SheetTests)[] = [
  'zeroToThirtySec', 'zeroToSixtySec', 'zeroToHundredSec', 'quarterMileSec', 'quarterMileMph',
  'braking60to0Ft', 'braking70to0Ft', 'skidpadG', 'topSpeedMph',
];

function hasTests(sheet: PhysicsSheet): boolean {
  return TEST_KEYS.some((k) => sheet.tests[k] !== null);
}

function pad(s: string, n: number): string { return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function lpad(s: string, n: number): string { return s.length >= n ? s : ' '.repeat(n - s.length) + s; }
function num(x: number, digits: number): string { return Number.isFinite(x) ? x.toFixed(digits) : String(x); }
function digitsFor(unit: string): number { return unit === 'g' ? 3 : unit === 's' ? 2 : 1; }

type CarResult = { sheet: PhysicsSheet; checks: Check[]; basis: Record<Basis, number>; grip: number | null; drag: number | null; ms: number };

function runCar(sheet: PhysicsSheet): CarResult {
  const t0 = host.performance.now();
  const fitted = calibrate(sheet);
  const { model, basis } = resolveModel(fitted);
  const bench = runBench(model);
  const checks = checkSheet(fitted, bench);
  const counts: Record<Basis, number> = { sourced: 0, derived: 0, calibrated: 0, estimated: 0 };
  for (const k of Object.keys(basis).sort()) counts[basis[k]]++;
  return { sheet, checks, basis: counts, grip: fitted.calibration.tyreGripScale, drag: fitted.calibration.dragAreaM2, ms: host.performance.now() - t0 };
}

function main(): void {
  const sheets = SHEETS.filter(hasTests);
  print(`Validation: ${sheets.length} of ${SHEETS.length} researched sheet(s) carry test figures.\n`);
  const results = sheets.map(runCar);

  const header = `${pad('car', 28)} ${pad('check', 30)} ${lpad('real', 9)} ${lpad('model', 9)} ${lpad('error', 9)} ${lpad('tol', 8)} ${lpad('x tol', 6)}  result`;
  print(header);
  print('-'.repeat(header.length));
  let worst = 0, worstWhat = 'none';
  for (const r of results) {
    if (r.checks.length === 0) print(`${pad(r.sheet.id, 28)} (no test the bench can check)`);
    for (const c of r.checks) {
      const d = digitsFor(c.unit);
      const ratio = c.tolerance > 0 ? Math.abs(c.error) / c.tolerance : Infinity;
      if (!(ratio <= worst)) { worst = ratio; worstWhat = `${r.sheet.id}: ${c.name}`; }
      print(`${pad(r.sheet.id, 28)} ${pad(`${c.name} (${c.unit})`, 30)} ${lpad(num(c.real, d), 9)} ${lpad(num(c.model, d), 9)} `
        + `${lpad((c.error >= 0 ? '+' : '') + num(c.error, d), 9)} ${lpad(num(c.tolerance, d), 8)} ${lpad(num(ratio, 2), 6)}  ${c.pass ? 'pass' : 'MISS'}`);
    }
  }

  print('\nCalibration and basis (model parameters by how each was reached):');
  for (const r of results) {
    const b = r.basis;
    print(`  ${pad(r.sheet.id, 28)} grip scale ${r.grip === null ? '-' : r.grip.toFixed(4)}, drag area ${r.drag === null ? '-' : `${r.drag.toFixed(3)} m^2`}; `
      + `sourced ${b.sourced}, derived ${b.derived}, calibrated ${b.calibrated}, estimated ${b.estimated}  (${r.ms.toFixed(0)} ms)`);
  }

  const passing = results.filter((r) => r.checks.length > 0 && r.checks.every((c) => c.pass));
  print(`\nCars passing every check: ${passing.length} of ${results.length}.`);
  print(`Worst miss: ${num(worst, 2)} x its tolerance (${worstWhat}).`);

  // The fleet: medians over every car that has the figure (what the gate judges), and over the cars that pass every
  // check, shown beside it so that a median of the cars that passed is never the only number in view.
  const pct = (x: number | null): string => x === null ? 'no car has it' : `${(100 * x).toFixed(2)}%`;
  const everyCar = fleetMedians(results.map((r) => r.checks)), passed = fleetMedians(passing.map((r) => r.checks));
  print(`Median 0-60 error: ${pct(everyCar.zeroToSixty)} over every car with the figure, ${pct(passed.zeroToSixty)} over the cars passing every check (limit ${pct(MEDIAN_ZERO_TO_SIXTY)}).`);
  print(`Median quarter-mile error: ${pct(everyCar.quarter)} over every car with the figure, ${pct(passed.quarter)} over the cars passing every check (limit ${pct(MEDIAN_QUARTER)}).`);
  const inversions = orderInversions(results.map((r) => ({ id: r.sheet.id, checks: r.checks })));
  print(`Cars more than ${ORDER_GAP * 100}% apart on a published figure that the core orders the other way: ${inversions.length}.`);
  for (const line of inversions) print(`  ${line}`);

  const gated = results.filter((r) => r.checks.length >= GATE_CHECKS);
  const allPass = gated.filter((r) => r.checks.every((c) => c.pass)).length;
  const farMiss = gated.filter((r) => r.checks.some((c) => !(Math.abs(c.error) <= GATE_MISS * c.tolerance)));
  const enough = gated.length >= GATE_CARS;
  const medians = everyCar.zeroToSixty !== null && everyCar.zeroToSixty <= MEDIAN_ZERO_TO_SIXTY && everyCar.quarter !== null && everyCar.quarter <= MEDIAN_QUARTER;
  const ok = enough && allPass >= GATE_SHARE * gated.length && farMiss.length === 0 && medians && inversions.length === 0;
  print(`Gate: ${gated.length} car(s) with ${GATE_CHECKS}+ checks (need ${GATE_CARS}); ${allPass} pass every check (need ${Math.ceil(GATE_SHARE * Math.max(gated.length, GATE_CARS))}); `
    + `${farMiss.length} miss(es) by more than ${GATE_MISS}x tolerance; medians ${medians ? 'within' : 'not within'} their limits; `
    + `${inversions.length} ordering inversion(s). ${ok ? 'PASSED' : 'NOT PASSED'}.`);
}

main();
