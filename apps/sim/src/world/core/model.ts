// A car of the game as a model of the physics core (packages/physics DESIGN.md section 13): the figures it has on file
// become a sheet, the Garage's build becomes real parts, and resolveModel turns both into SI.
//
// Which figures, in the order world/data.ts specFor decides for the old model:
//   1. a rental (or a tester's fleet car): its drawn, fictional record, one to one (sheetFromAuthored);
//   2. a world car with a researched record of the same car (researchedFor): the record's make and model are the
//      world car's real ones (a car the world names by its game name has a real one behind it), and, when the car
//      table has a row for it, the record's horsepower is within POWER_MATCH of the row's (a record of another
//      configuration of the model, a Raptor for a 2.7 EcoBoost F-150, a newer generation's Prius, is not that car);
//      of several, the one whose engine is the row's (displacement and cylinders), then the nearest power;
//   3. a world car in the game's car table: the table's six figures, the rest from the class tables (sheetFromTable);
//   4. anything else (an unknown car, or a finished 3D model with no figures of its own): its body style's drawn
//      archetype, as the old model drives it, one to one.
// Then resolveModel(sheet, legacyBuild(perf, tune, sheet)), cached per car and build.
import { legacyBuild, resolveModel, sheetFromAuthored, sheetFromTable } from '@micar/physics';
import type { AuthoredSpec, BodyClass, Build, PhysicsSheet, VehicleModel } from '@micar/physics';
import { ARCHETYPES, FLEET_NAMES, FLEET_SPECS, STYLE_CHASSIS, type BodyStyle } from '../data';
import type { PerfCfg, Tune } from '../physics';
import { getCarSpec, hasModelSpec, type CarSpec } from '../../carSpecs';
import { realNameOf } from '../../carModels';
import { researchedSheets } from './sheets';

/** What the game knows of a car: the fields specFor reads. */
export type CoreCar = { make?: string; model?: string; bodyStyle?: string; rental?: boolean; testCar?: boolean };

/** Where a car's figures came from. */
export type CoreSource = 'rental' | 'researched' | 'table' | 'style';

/** A car of the game resolved for the core: the model, the sheet it came from, which kind of figures, the build of real parts it was resolved with, and the cache key. */
export type CoreCarModel = { model: VehicleModel; sheet: PhysicsSheet; source: CoreSource; bodyClass: BodyClass; build: Build; key: string };

/** The game's body styles as the core's body classes (a truck is a pickup). */
export const STYLE_CLASS: Readonly<Record<BodyStyle, BodyClass>> = {
  sedan: 'sedan', coupe: 'coupe', sports: 'sports', hatchback: 'hatchback', suv: 'suv', van: 'van', truck: 'pickup',
};

/** The rental fleet's body classes: the bodies world/rental.ts gives them (the Brute 440 is drawn as a sports car). */
export const FLEET_CLASS: Readonly<Record<keyof typeof FLEET_SPECS, BodyClass>> = {
  civet: 'hatchback', kanjo: 'hatchback', ronin: 'coupe', tsubasa: 'sedan', brute: 'sports',
};

const isStyle = (s: string | undefined): s is BodyStyle => !!s && s in ARCHETYPES;

/** A make or model as a sheet id piece: lower case, every run of other characters one hyphen (sheet.ts does the same). */
export function slugOf(text: string): string {
  return text.toLowerCase().replace(/[‐-―−]/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Makes the world spells differently from the research (the car table's Chevy is Chevrolet).
const MAKE_KEY: Readonly<Record<string, string>> = { chevy: 'chevrolet', vw: 'volkswagen' };
// Words that name a body style after a model ("Civic Sedan"): the same model whichever body the record was researched on.
const BODY_WORD = /-(sedan|coupe|hatchback|hatch|wagon|fastback)$/;

/** A make as the research files it: its slug, with the world's own spellings mapped (Chevy is Chevrolet). */
export function makeKeyOf(make: string): string {
  const k = slugOf(make);
  return MAKE_KEY[k] ?? k;
}

/** A model as the research files it: its slug, less a body word at its end ("Civic Sedan" is the Civic). */
export function modelKeyOf(model: string): string {
  return slugOf(model).replace(BODY_WORD, '');
}

/**
 * How far a researched record's horsepower may be from the car table's row and still be that car, as a share of the
 * row's: model-year updates move a rating by a few per cent (the Mustang GT's 460 to 480 hp, 4%); another
 * configuration of the same model moves it by a third or more (the F-150 Raptor's 450 hp against the 2.7 EcoBoost's
 * 325, 38%; the fifth-generation Prius's 194 against the 121 of the one the table describes, 60%).
 */
export const POWER_MATCH = 0.12;

// "2.5L I4" -> 2.5 L and 4 cylinders; "3.0L Twin-Turbo I6" -> 3.0 and 6. Read only from the table's own wording.
function rowEngine(engine: string): { litres: number | null; cylinders: number | null } {
  const l = /(\d+(?:\.\d+)?)L\b/.exec(engine), c = /\b[IVHW](\d{1,2})\b/.exec(engine);
  return { litres: l ? Number(l[1]) : null, cylinders: c ? Number(c[1]) : null };
}

/**
 * The researched sheet a world car drives on, or null when none is that car: among the records whose make and model
 * are the car's real ones, those whose horsepower is within POWER_MATCH of the car table's row (any of them when the
 * table has no row: the record's own figures are then the only ones there are); of those, the one whose engine is the
 * row's (displacement within 0.15 L and the same cylinders), then the nearest horsepower, then the newest, then by id.
 */
export function researchedFor(real: { make: string; model: string }, row: CarSpec | null, sheets: readonly PhysicsSheet[]): PhysicsSheet | null {
  const make = makeKeyOf(real.make), model = modelKeyOf(real.model);
  if (!make || !model) return null;
  const want = row ? rowEngine(row.engine) : null;
  let best: PhysicsSheet | null = null, bestScore: number[] = [];
  for (const sh of sheets) {
    if (makeKeyOf(sh.identity.make) !== make || modelKeyOf(sh.identity.model) !== model) continue;
    const hp = sh.horsepower?.value ?? null;
    if (row) {
      if (hp === null || !(Math.abs(hp - row.hp) <= POWER_MATCH * row.hp)) continue;
    }
    const litres = sh.displacementL?.value ?? null, cylinders = sh.cylinders?.value ?? null;
    const engineMatch = want !== null && want.litres !== null && litres !== null && Math.abs(litres - want.litres) <= 0.15
      && (want.cylinders === null || cylinders === want.cylinders);
    // Lower is better, compared in order: engine (0 the row's), power gap, newer year first.
    const score = [engineMatch ? 0 : 1, row && hp !== null ? Math.abs(hp - row.hp) : 0, -sh.identity.year];
    if (best === null || lessThan(score, bestScore) || (equal(score, bestScore) && sh.id < best.id)) { best = sh; bestScore = score; }
  }
  return best;
}

function lessThan(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}
function equal(a: number[], b: number[]): boolean { return !lessThan(a, b) && !lessThan(b, a); }

// The make and model the figures are filed under: a car the world names by its game name has a real one behind it.
function realName(car: CoreCar): { make: string; model: string } {
  const make = car.make ?? '', model = car.model ?? '';
  return (make && model ? realNameOf(make, model) : null) ?? { make, model };
}

type SheetChoice = { sheet: PhysicsSheet; source: CoreSource; bodyClass: BodyClass };

// One sheet per car identity: sheets do not depend on the build, and the drawn ones pick a tyre size by search.
const sheetCache = new Map<string, SheetChoice>();

/** The sheet a car drives on, the kind of figures it has, and its body class (rental, researched, table, or style). */
export function coreSheetFor(car: CoreCar): SheetChoice {
  const fleet = car.rental || car.testCar ? FLEET_NAMES[`${car.make} ${car.model}`] : undefined;
  const style: BodyStyle = isStyle(car.bodyStyle) ? car.bodyStyle : 'sedan';
  const key = fleet ? `fleet|${fleet}` : `${car.make}|${car.model}|${style}`;
  const hit = sheetCache.get(key);
  if (hit) return hit;
  let out: SheetChoice;
  if (fleet) {
    const bodyClass = FLEET_CLASS[fleet];
    out = { sheet: sheetFromAuthored(FLEET_SPECS[fleet] as AuthoredSpec, bodyClass), source: 'rental', bodyClass };
  } else {
    const bodyClass = STYLE_CLASS[style], real = realName(car), row = hasModelSpec(real) ? getCarSpec(real, style) : null;
    const researched = real.make && real.model ? researchedFor(real, row, researchedSheets()) : null;
    if (researched) out = { sheet: researched, source: 'researched', bodyClass: researched.identity.bodyClass };
    else if (row) {
      out = {
        sheet: sheetFromTable({ make: real.make, model: real.model, bodyClass, engine: row.engine, hp: row.hp, weightLb: row.weightLb, zeroToSixty: row.zeroToSixty, topSpeedMph: row.topSpeedMph, drive: row.drive }),
        source: 'table', bodyClass,
      };
    } else {
      // No figures of its own: the body style's drawn archetype, with the style's centre-of-gravity height, as the old
      // model drives such a car (its grip multiplier is the old model's own and is left out).
      const base = { ...ARCHETYPES[style] }, h = STYLE_CHASSIS[style].h;
      if (h !== undefined) base.h = h;
      const spec: AuthoredSpec = { ...base, id: `style-${style}`, gears: base.gears.slice(), tq: base.tq.map(p => [p[0], p[1]] as [number, number]) };
      out = { sheet: sheetFromAuthored(spec, bodyClass), source: 'style', bodyClass };
    }
  }
  sheetCache.set(key, out);
  return out;
}

const PERF_KEYS = ['engine', 'ecu', 'turbo', 'trans', 'susp', 'nos', 'tires', 'brakes', 'weight'] as const;
const TUNE_KEYS = ['turbo', 'nitrous', 'aero', 'bias', 'ride', 'stiff', 'steer', 'gears'] as const;

/** A build as a key: the nine tiers and eight sliders in a fixed order, whatever order the save holds them in. */
export function buildKey(perf: Partial<PerfCfg> | null | undefined, tune: Partial<Tune> | null | undefined): string {
  const p = (perf ?? {}) as Record<string, unknown>, t = (tune ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '0');
  return PERF_KEYS.map(k => num(p[k])).join(',') + '|' + TUNE_KEYS.map(k => num(t[k])).join(',');
}

// Resolved models, newest first. A model is read-only to the step, so one model serves every car of that build.
const MODEL_CACHE_SIZE = 12;
const modelCache: CoreCarModel[] = [];

/**
 * The core's model of a car of the game with its Garage build: the sheet as coreSheetFor chooses it, the build through
 * legacyBuild, resolved by resolveModel. The same car and build give the same object back.
 */
export function coreModelFor(car: CoreCar, perf: Partial<PerfCfg> | null | undefined, tune: Partial<Tune> | null | undefined): CoreCarModel {
  const choice = coreSheetFor(car);
  const key = `${choice.sheet.id}|${choice.bodyClass}|${buildKey(perf, tune)}`;
  for (let i = 0; i < modelCache.length; i++) {
    const e = modelCache[i];
    if (e.key === key && e.sheet === choice.sheet) {
      if (i > 0) { modelCache.splice(i, 1); modelCache.unshift(e); }
      return e;
    }
  }
  const build = legacyBuild(perf, tune, choice.sheet);
  const { model } = resolveModel(choice.sheet, build);
  const out: CoreCarModel = { model, sheet: choice.sheet, source: choice.source, bodyClass: choice.bodyClass, build, key };
  modelCache.unshift(out);
  if (modelCache.length > MODEL_CACHE_SIZE) modelCache.length = MODEL_CACHE_SIZE;
  return out;
}

/** Tests: forget every cached sheet and model. */
export function clearCoreModels(): void { sheetCache.clear(); modelCache.length = 0; }
