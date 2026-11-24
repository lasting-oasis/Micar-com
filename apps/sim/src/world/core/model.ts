// A car of the game as a model of the physics core (packages/physics DESIGN.md section 13): the figures it has on file
// become a sheet, the Garage's build becomes real parts, and resolveModel turns both into SI.
//
// Which figures, in the order world/data.ts specFor decides for the old model:
//   1. a rental (or a tester's fleet car): its drawn, fictional record, one to one (sheetFromAuthored);
//   2. a world car with a researched sheet on file, `world-<make>-<model>` (the real make and model, also for a car
//      the world names by its game name);
//   3. a world car in the game's car table: the table's six figures, the rest from the class tables (sheetFromTable);
//   4. anything else (an unknown car, or a finished 3D model with no figures of its own): its body style's drawn
//      archetype, as the old model drives it, one to one.
// Then resolveModel(sheet, legacyBuild(perf, tune, sheet)), cached per car and build.
import { legacyBuild, resolveModel, sheetFromAuthored, sheetFromTable } from '@micar/physics';
import type { AuthoredSpec, BodyClass, PhysicsSheet, VehicleModel } from '@micar/physics';
import { ARCHETYPES, FLEET_NAMES, FLEET_SPECS, STYLE_CHASSIS, type BodyStyle } from '../data';
import type { PerfCfg, Tune } from '../physics';
import { getCarSpec, hasModelSpec } from '../../carSpecs';
import { realNameOf } from '../../carModels';
import { researchedSheet } from './sheets';

/** What the game knows of a car: the fields specFor reads. */
export type CoreCar = { make?: string; model?: string; bodyStyle?: string; rental?: boolean; testCar?: boolean };

/** Where a car's figures came from. */
export type CoreSource = 'rental' | 'researched' | 'table' | 'style';

/** A car of the game resolved for the core: the model, the sheet it came from, which kind of figures, and the cache key. */
export type CoreCarModel = { model: VehicleModel; sheet: PhysicsSheet; source: CoreSource; bodyClass: BodyClass; key: string };

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

/** The id a researched sheet for a world car is filed under: `world-<make>-<model>`. */
export function worldSheetId(make: string, model: string): string {
  return `world-${slugOf(make)}-${slugOf(model)}`;
}

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
    const bodyClass = STYLE_CLASS[style], real = realName(car);
    const researched = real.make && real.model ? researchedSheet(worldSheetId(real.make, real.model)) : null;
    if (researched) out = { sheet: researched, source: 'researched', bodyClass: researched.identity.bodyClass };
    else if (hasModelSpec(real)) {
      const row = getCarSpec(real, style);
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
  const { model } = resolveModel(choice.sheet, legacyBuild(perf, tune, choice.sheet));
  const out: CoreCarModel = { model, sheet: choice.sheet, source: choice.source, bodyClass: choice.bodyClass, key };
  modelCache.unshift(out);
  if (modelCache.length > MODEL_CACHE_SIZE) modelCache.length = MODEL_CACHE_SIZE;
  return out;
}

/** Tests: forget every cached sheet and model. */
export function clearCoreModels(): void { sheetCache.clear(); modelCache.length = 0; }
