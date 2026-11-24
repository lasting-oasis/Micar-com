import { afterEach, describe, expect, it } from 'vitest';
import { enginePeaks, sheetFromResearch } from '@micar/physics';
import type { PhysicsSheet } from '@micar/physics';
import { clearCoreModels, coreModelFor, coreSheetFor, worldSheetId } from './model';
import { useResearchedSheets } from './sheets';
import { FLEET_SPECS, STOCK_CFG, TUNE_DEF } from '../data';
import type { PerfCfg } from '../physics';
import gtr from '../../../../../packages/physics/data/research/2024-nissan-gt-r-nismo.json';

const HP = 745.7, LB = 0.45359237, RPM = 2 * Math.PI / 60;
const stock = STOCK_CFG.perf;
const hpOf = (m: { engine: Parameters<typeof enginePeaks>[0] }) => enginePeaks(m.engine).power / HP;
const tier = (k: keyof PerfCfg, v: 0 | 1 | 2 | 3): PerfCfg => ({ ...stock, [k]: v });

afterEach(() => { useResearchedSheets(null); clearCoreModels(); });

describe('coreModelFor: a car of the game as a model of the core', () => {
  it('a rental drives on its drawn record, one to one: mass, gears, final drive, redline and torque curve', () => {
    const m = coreModelFor({ make: 'Ronin', model: 'GT', rental: true }, stock, TUNE_DEF);
    const ronin = FLEET_SPECS.ronin;
    expect(m.source).toBe('rental');
    expect(m.model.chassis.mass).toBeCloseTo(ronin.mass, 6);            // 1340 kg as driven
    expect(m.model.chassis.a).toBeCloseTo(ronin.a, 3);                  // 1.28 m to the front axle
    expect(Array.from(m.model.driveline.gears)).toEqual(ronin.gears);  // 3.55 ... 0.76
    expect(m.model.driveline.finalDrive).toBeCloseTo(ronin.fin, 9);     // 4.0
    expect(m.model.driveline.layout).toBe('RWD');
    expect(m.model.engine.redline / RPM).toBeCloseTo(ronin.redline, 6);  // 7300 rpm
    // The drawn curve peaks at 258 N m at 5500 rpm; the model's full-throttle curve is that curve.
    expect(enginePeaks(m.model.engine).torque).toBeCloseTo(258, 0);
    expect(m.model.tyreRear.radius).toBeCloseTo(ronin.r, 3);           // 0.32 m loaded radius
  });

  it('the same rental gives the same model to a tester, and none to a car of the same name that is not a fleet car', () => {
    const rented = coreModelFor({ make: 'Ronin', model: 'GT', rental: true }, stock, TUNE_DEF);
    expect(coreModelFor({ make: 'Ronin', model: 'GT', testCar: true }, stock, TUNE_DEF)).toBe(rented);
    expect(coreSheetFor({ make: 'Ronin', model: 'GT', bodyStyle: 'coupe' }).source).not.toBe('rental');
  });

  it('a world car with no researched sheet drives on the car table: a Camry makes its 203 hp and weighs its 3,340 lb', () => {
    const m = coreModelFor({ make: 'Toyota', model: 'Camry', bodyStyle: 'sedan' }, stock, TUNE_DEF);
    expect(m.source).toBe('table');
    expect(m.sheet.id).toBe('table-toyota-camry');
    expect(hpOf(m.model)).toBeGreaterThan(203 * 0.95);
    expect(hpOf(m.model)).toBeLessThan(203 * 1.05);
    expect(m.model.chassis.mass).toBeCloseTo(3340 * LB + 75, 0);         // curb weight and a 75 kg driver
    expect(m.model.driveline.layout).toBe('FWD');
  });

  it('a world car with a researched sheet on file drives on it, not on the table', () => {
    const research = sheetFromResearch(gtr as Parameters<typeof sheetFromResearch>[0]);
    const filed: Record<string, PhysicsSheet> = { [worldSheetId('Nissan', 'GT-R')]: research };
    expect(worldSheetId('Nissan', 'GT-R')).toBe('world-nissan-gt-r');
    useResearchedSheets(id => filed[id] ?? null);
    const m = coreModelFor({ make: 'Nissan', model: 'GT-R', bodyStyle: 'coupe' }, stock, TUNE_DEF);
    expect(m.source).toBe('researched');
    expect(m.sheet).toBe(research);
    // The NISMO's 600 hp and 3,867 lb, not anything the table would have estimated.
    expect(hpOf(m.model)).toBeGreaterThan(600 * 0.95);
    expect(hpOf(m.model)).toBeLessThan(600 * 1.05);
    expect(m.model.chassis.mass).toBeCloseTo(3867 * LB + 75, 0);
    expect(m.model.driveline.layout).toBe('AWD');
    // and without it on file, the same car falls back (no table row for it either: its body style's archetype)
    useResearchedSheets(() => null); clearCoreModels();
    expect(coreModelFor({ make: 'Nissan', model: 'GT-R', bodyStyle: 'coupe' }, stock, TUNE_DEF).source).not.toBe('researched');
  });

  it('a car with no figures at all still drives, on its body style\'s archetype (an unknown style is a sedan)', () => {
    const m = coreModelFor({ make: 'Zz', model: 'Qq', bodyStyle: 'weird' }, stock, TUNE_DEF);
    expect(m.source).toBe('style');
    expect(m.bodyClass).toBe('sedan');
    expect(m.model.chassis.mass).toBeCloseTo(1540, 3);                    // the sedan archetype's 1540 kg
    expect(() => coreModelFor({}, stock, TUNE_DEF)).not.toThrow();
  });

  it('is cached per car and build: the same build is the same object; a part is a new model that has the part', () => {
    const car = { make: 'Toyota', model: 'Camry', bodyStyle: 'sedan' };
    const a = coreModelFor(car, stock, TUNE_DEF);
    expect(coreModelFor(car, { ...stock }, { ...TUNE_DEF })).toBe(a);
    const engine = coreModelFor(car, tier('engine', 3), TUNE_DEF);
    expect(engine).not.toBe(a);
    expect(hpOf(engine.model)).toBeGreaterThan(hpOf(a.model) * 1.04);    // intake, exhaust, cams: more power
    const turbo = coreModelFor(car, tier('turbo', 1), TUNE_DEF);
    expect(a.model.engine.kind).toBe('na');
    expect(turbo.model.engine.kind).toBe('turbo');                        // a turbo kit on the naturally aspirated 2.5
    const light = coreModelFor(car, tier('weight', 3), TUNE_DEF);
    expect(light.model.chassis.mass).toBeLessThan(a.model.chassis.mass - 100); // 12% off the curb weight
    expect(coreModelFor(car, stock, TUNE_DEF)).toBe(a);
  });
});
