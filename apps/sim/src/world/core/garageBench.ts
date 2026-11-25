// The Garage on the physics core (packages/physics DESIGN.md sections 12 and 13). With the switch on, the Garage's stat
// bars and dyno show the core's own bench for the car as built: the same bench a card's figures come from, so what the
// Garage says a part does is what it does on the road and on the card. And the world's class letter for a build is the
// card engine's raceClassOf on the Power Rating of the card with the bench's ratios (simulatedStats): one rating for
// the card and the road.
//
// A bench run takes half a second to a second of computing a car, and a build needs two (the car stock and as built),
// so nothing here runs while a frame is drawn: the page asks with requestGarageBench and draws what is ready; the runs
// are done in a worker (garageBench.worker.ts) where the page has workers, else on a timer after the menu has opened.
// Each car and build is measured once and kept.
import { benchFigures, buildCardMods, legacyBuild, runBench } from '@micar/physics';
import type { CardFigures, VehicleModel } from '@micar/physics';
import { raceClassOf, simulatedStats } from '@micar/engine';
import type { ActiveModification, Powertrain, RaceClassId, StatLayer, VehicleSpec } from '@micar/engine';
import { engineSpecFor } from '../cardStats';
import { STOCK_CFG, TUNE_DEF } from '../data';
import type { PerfCfg, Tune } from '../physics';
import { buildKey, coreModelFor, coreSheetFor, type CoreCar } from './model';
import { nitrousOf, rpmOf } from './params';

/** What the Garage knows of a car: what the core needs to model it, and the year the card is scored for. */
export type GarageCar = CoreCar & { year?: number };

/** One point of the dyno: engine speed (rev/min), torque at the crank (N m), power (hp). */
export type DynoPoint = [rpm: number, nm: number, hp: number];

/** The core's Garage figures for one car and build. */
export type CoreGarage = {
  /** The bench in the card's units, as built and stock (rating.ts benchFigures). */
  built: CardFigures; stock: CardFigures;
  /** The engine speed of peak power (rev/min), the car's mass as driven (kg), the driven wheels. */
  peakHpRpm: number; massKg: number; drive: 'FWD' | 'RWD' | 'AWD';
  /** The nitrous kit: its shot (hp) and the seconds of it in a full bottle (0 and 0 without one). */
  nitrousHp: number; nitrousSeconds: number;
  /** The full-throttle curve from the core engine's own tables (with full boost on a boosted engine), idle to redline. */
  dyno: DynoPoint[]; redlineRpm: number;
  /** The card's Power Rating with the bench's ratios (provisional when the card has unrated attributes), and its class. */
  powerRating: number | null; provisional: boolean; raceClass: RaceClassId | null;
};

const HP_W = 745.69987;
const DYNO_POINTS = 48;

/** The core engine's full-throttle curve, idle to redline: its own torque table (wot, full boost on a boosted engine) read straight. */
export function dynoOf(model: VehicleModel): DynoPoint[] {
  const e = model.engine, out: DynoPoint[] = [];
  const lo = e.idle, hi = e.redline;
  for (let i = 0; i <= DYNO_POINTS; i++) {
    const w = lo + (hi - lo) * i / DYNO_POINTS, k = w / e.dOmega, j = Math.min(e.n - 2, Math.max(0, Math.floor(k)));
    const nm = Math.max(0, e.wot[j] + (e.wot[j + 1] - e.wot[j]) * (k - j));
    out.push([rpmOf(w), nm, nm * w / HP_W]);
  }
  return out;
}

/** The fitted parts as the card engine's modification records: the Strip's Garage fits them (a professional install), declared by the owner, new. */
export function cardMods(car: GarageCar, perf: Partial<PerfCfg> | null | undefined, tune: Partial<Tune> | null | undefined): ActiveModification[] {
  const sheet = coreSheetFor(car).sheet;
  return buildCardMods(sheet, legacyBuild(perf, tune, sheet)).map((m, i) => ({
    eventId: `garage-${i}`, category: m.category, tier: m.tier, install: 'professional', evidence: 'declared',
    installedOn: '2026-01-01', installedAtMileage: null, upkeep: 'recent',
  }));
}

/**
 * The card a build is charged and rated on: the world's own card for the model (cardStats.ts engineSpecFor), with the
 * powertrain the core drives filled in where the card has none on file. The world's car table has no word for it, and
 * the card engine waits on a blank powertrain: it refused every combustion part's charge (turbo, engine, ECU, intake
 * and exhaust, nitrous) as "needs the powertrain on file", so a power build was rated 3 to 15 points high and a Camry
 * with engine, ECU, turbo and nitrous at their third tier read Class A where it is a B. The core's sheet for the car
 * knows it (resolve.ts reads a blank one as petrol, and so drives it).
 */
export function garageCard(car: GarageCar): VehicleSpec {
  const card = engineSpecFor({ year: car.year, make: car.make, model: car.model, bodyStyle: car.bodyStyle });
  if (card.powertrain !== null) return card;
  const sheet = coreSheetFor(car).sheet;
  const value: Powertrain = sheet.powertrain !== null ? sheet.powertrain.value : 'gasoline';
  return { ...card, powertrain: { value, source: { kind: sheet.powertrain !== null ? sheet.powertrain.source.kind : 'illustrative', name: 'the physics core\'s sheet for the car', note: sheet.powertrain !== null ? `as ${sheet.id} has it` : 'none on file: the core drives it as petrol' } } };
}

/** The card's layer for a build from two bench runs: the card engine's simulatedStats with the fitted parts' charges. */
export function simulatedLayer(car: GarageCar, stock: CardFigures, built: CardFigures, mods: readonly ActiveModification[]): StatLayer {
  return simulatedStats(garageCard(car), stock, built, mods);
}

/** A layer's Power Rating as the world shows it (CardStatsPanel: the provisional one when attributes are unrated) and its class letter. */
export function classOfLayer(layer: StatLayer): { powerRating: number | null; provisional: boolean; raceClass: RaceClassId | null } {
  const rating = layer.powerRating ?? layer.provisionalRating ?? null;
  return { powerRating: rating, provisional: layer.powerRating === null, raceClass: raceClassOf(rating) };
}

// Bench runs kept per model object (a model is the same object for the same car and build: model.ts coreModelFor).
const benches = new WeakMap<VehicleModel, CardFigures>();
function benchOf(model: VehicleModel): CardFigures {
  let f = benches.get(model);
  if (!f) { f = benchFigures(runBench(model), model); benches.set(model, f); }
  return f;
}

/** The key a car and build are measured under: the sheet it drives on, its body class and the build. */
export function garageKey(car: GarageCar, perf: Partial<PerfCfg> | null | undefined, tune: Partial<Tune> | null | undefined): string {
  const c = coreSheetFor(car);
  return `${c.sheet.id}|${c.bodyClass}|${car.year ?? ''}|${car.make ?? ''}|${car.model ?? ''}|${buildKey(perf, tune)}`;
}

/** The Garage's figures for a car and build, worked out now (two bench runs the first time: up to a couple of seconds). */
export function computeGarage(car: GarageCar, perf: Partial<PerfCfg> | null | undefined, tune: Partial<Tune> | null | undefined): CoreGarage {
  const m = coreModelFor(car, perf, tune).model, s = coreModelFor(car, STOCK_CFG.perf, TUNE_DEF).model;
  const built = benchOf(m), stock = benchOf(s), nos = nitrousOf(m);
  const cls = classOfLayer(simulatedLayer(car, stock, built, cardMods(car, perf, tune)));
  const peak = runBenchPeak(m);
  return {
    built, stock, peakHpRpm: peak, massKg: m.chassis.mass, drive: m.driveline.layout,
    nitrousHp: m.nitrous ? m.nitrous.power / HP_W : 0, nitrousSeconds: nos.cap,
    dyno: dynoOf(m), redlineRpm: rpmOf(m.engine.redline), ...cls,
  };
}

// The engine speed of peak power off the dyno curve the Garage draws (the same table the bench's dyno reads).
function runBenchPeak(m: VehicleModel): number {
  let best = 0, at = 0;
  for (const p of dynoOf(m)) if (p[2] > best) { best = p[2]; at = p[0]; }
  return Math.round(at / 100) * 100;
}

/* ------------------------------------------------------------------ asking without waiting */

const KEPT = 24;
const done = new Map<string, CoreGarage>();
const pending = new Map<string, (() => void)[]>();

/** The figures already measured for a car and build, or null. */
export function garageReady(car: GarageCar, perf: Partial<PerfCfg> | null | undefined, tune: Partial<Tune> | null | undefined): CoreGarage | null {
  return done.get(garageKey(car, perf, tune)) ?? null;
}

/** How the runs are done: by default a worker where the page has workers, else a timer. Tests put their own in. */
export type GarageRunner = (car: GarageCar, perf: PerfCfg, tune: Tune, reply: (g: CoreGarage) => void) => void;

let runner: GarageRunner | null = null;

/** Tests: run the bench some other way (null puts the default back), and forget what was measured. */
export function useGarageRunner(next: GarageRunner | null): void { runner = next; done.clear(); pending.clear(); }

// A timer: the run after the frame that asked has been drawn.
const onTimer: GarageRunner = (car, perf, tune, reply) => { setTimeout(() => reply(computeGarage(car, perf, tune)), 0); };

let worker: Worker | null | undefined;
let nextId = 0;
type Asked = { car: GarageCar; perf: PerfCfg; tune: Tune; reply: (g: CoreGarage) => void };
const waiting = new Map<number, Asked>();
// A worker for the bench runs, once, where the page can make one (not under test, not where workers are blocked). If
// it fails, what it was asked is run on the timer instead, and so is everything after.
function workerRunner(): GarageRunner | null {
  if (worker === undefined) {
    worker = null;
    try {
      if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
        const w = new Worker(new URL('./garageBench.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<{ id: number; garage: CoreGarage }>) => { const a = waiting.get(e.data.id); waiting.delete(e.data.id); a?.reply(e.data.garage); };
        w.onerror = () => {
          worker = null;
          const left = [...waiting.values()];
          waiting.clear();
          for (const a of left) onTimer(a.car, a.perf, a.tune, a.reply);
        };
        worker = w;
      }
    } catch { worker = null; }
  }
  if (!worker) return null;
  const w = worker;
  return (car, perf, tune, reply) => { const id = nextId++; waiting.set(id, { car, perf, tune, reply }); w.postMessage({ id, car, perf, tune }); };
}

/**
 * The figures for a car and build if they are measured; else null, and the bench runs once in the background, then
 * `ready` is called (once per call that found nothing). The same car and build asked again while it runs share the run.
 */
export function requestGarageBench(car: GarageCar, perf: PerfCfg, tune: Tune, ready: () => void): CoreGarage | null {
  const key = garageKey(car, perf, tune), hit = done.get(key);
  if (hit) return hit;
  const queue = pending.get(key);
  if (queue) { queue.push(ready); return null; }
  pending.set(key, [ready]);
  const run = runner ?? workerRunner() ?? onTimer;
  const plain: GarageCar = { make: car.make, model: car.model, bodyStyle: car.bodyStyle, rental: car.rental, testCar: car.testCar, year: car.year };
  run(plain, { ...perf }, { ...tune }, (g) => {
    done.set(key, g);
    if (done.size > KEPT) done.delete(done.keys().next().value as string);
    const calls = pending.get(key) ?? [];
    pending.delete(key);
    for (const f of calls) f();
  });
  return null;
}
