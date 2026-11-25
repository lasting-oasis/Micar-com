import { afterEach, describe, expect, it } from 'vitest';
import { enginePeaks, sheetFromResearch } from '@micar/physics';
import type { PhysicsSheet } from '@micar/physics';
import { clearCoreModels, coreModelFor, coreSheetFor, researchedFor } from './model';
import { researchedSheets, useResearchedSheets } from './sheets';
import { CAR_CATALOG } from '../../carCatalog';
import { getCarSpec } from '../../carSpecs';
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

  it('a world car with no researched record drives on the car table: a Corolla makes its 139 hp and weighs its 2,900 lb', () => {
    const m = coreModelFor({ make: 'Toyota', model: 'Corolla', bodyStyle: 'sedan' }, stock, TUNE_DEF);
    expect(m.source).toBe('table');
    expect(m.sheet.id).toBe('table-toyota-corolla');
    expect(hpOf(m.model)).toBeGreaterThan(139 * 0.95);
    expect(hpOf(m.model)).toBeLessThan(139 * 1.05);
    expect(m.model.chassis.mass).toBeCloseTo(2900 * LB + 75, 0);         // curb weight and a 75 kg driver
    expect(m.model.driveline.layout).toBe('FWD');
  });

  it('the world\'s Camry, Mustang, Civic and every other car with a researched record drive on it, at the record\'s own figures', () => {
    // A world car by its make and model as the world names it: the original five makes by their real names, the rest
    // by their game names (Nizzan GT-RR is the Nissan GT-R).
    const expected: Record<string, string> = {
      'Toyota Camry': '2024-toyota-camry-le', 'Toyota RAV4': '2024-toyota-rav4-xle-awd', 'Toyota Tacoma': '2024-toyota-tacoma-trd-off-road',
      'Ford Mustang': '2024-ford-mustang-gt', 'Honda Civic': '2024-honda-civic-sedan-lx', 'Honda Odyssey': '2024-honda-odyssey-ex-l',
      'Chevy Corvette': '2024-chevrolet-corvette-stingray-z51', 'Jeap Rangler': '2024-jeep-wrangler-rubicon', 'Nizzan GT-RR': '2024-nissan-gt-r-nismo',
      'Porshe 911X': '2024-porsche-911-carrera', 'Tezla Modell 3': '2024-tesla-model-3-long-range-awd', 'Folkswagen Golph GTI': '2024-volkswagen-golf-gti-s',
    };
    const onRecord: Record<string, string> = {};
    for (const [make, rows] of Object.entries(CAR_CATALOG)) for (const r of rows) {
      const c = coreSheetFor({ make, model: r.model, bodyStyle: r.style });
      if (c.source === 'researched') onRecord[`${make} ${r.model}`] = c.sheet.id;
    }
    expect(onRecord).toEqual(expected);
    // Each makes its record's horsepower, not the table's: the Camry its 203, the Mustang GT its 480 (the table's
    // older 460), the Civic LX its 158; and weighs the record's curb weight with the driver.
    for (const [make, model, hp] of [['Toyota', 'Camry', 203], ['Ford', 'Mustang', 480], ['Honda', 'Civic', 158], ['Chevy', 'Corvette', 495]] as const) {
      const m = coreModelFor({ make, model, bodyStyle: 'sedan' }, stock, TUNE_DEF);
      expect(m.source, `${make} ${model}`).toBe('researched');
      expect(hpOf(m.model), `${make} ${model}`).toBeGreaterThan(hp * 0.97);
      expect(hpOf(m.model), `${make} ${model}`).toBeLessThan(hp * 1.03);
      const curb = m.sheet.curbWeightLb?.value;
      if (curb != null) expect(m.model.chassis.mass, `${make} ${model}`).toBeCloseTo(curb * LB + 75, 0);
    }
    // The Mustang is a 5.0 V8 driving its rear wheels through a six-speed manual, as researched.
    const gt = coreModelFor({ make: 'Ford', model: 'Mustang', bodyStyle: 'sports' }, stock, TUNE_DEF).model;
    expect(gt.driveline.layout).toBe('RWD');
    expect(gt.driveline.transmission).toBe('manual');
    expect(gt.driveline.gears.length).toBe(6);
  });

  it('a record of another configuration of the model is not that car: the F-150 Raptor and the 194 hp Prius leave the table\'s F-150 and Prius on the table', () => {
    // The records are on file (make and model match), but 450 hp is 38% over the table's 2.7 EcoBoost's 325, and the
    // fifth-generation Prius's 194 hp is 60% over the 121 hp car the table describes.
    expect(researchedSheets().some(sh => sh.id === '2024-ford-f-150-raptor')).toBe(true);
    expect(researchedSheets().some(sh => sh.id === '2024-toyota-prius-le-fwd')).toBe(true);
    for (const [make, model, hp] of [['Ford', 'F-150', 325], ['Toyota', 'Prius', 121]] as const) {
      const m = coreModelFor({ make, model, bodyStyle: 'truck' }, stock, TUNE_DEF);
      expect(m.source, `${make} ${model}`).toBe('table');
      expect(hpOf(m.model), `${make} ${model}`).toBeLessThan(hp * 1.05);
    }
  });

  it('of two records of the same model, the one whose engine is the table row\'s wins over one nearer in power', () => {
    const gt = researchedSheets().find(sh => sh.id === '2024-ford-mustang-gt')!;
    // A made-up four-cylinder Mustang rated 465 hp: 5 hp from the table's 460 where the V8 GT is 20 off, but the row says 5.0L V8.
    const four: PhysicsSheet = { ...gt, id: '2024-ford-mustang-four', displacementL: { value: 2.3, source: gt.horsepower!.source }, cylinders: { value: 4, source: gt.horsepower!.source }, horsepower: { value: 465, source: gt.horsepower!.source } };
    const row = getCarSpec({ make: 'Ford', model: 'Mustang' });
    expect(researchedFor({ make: 'Ford', model: 'Mustang' }, row, [four, gt])).toBe(gt);
    // With no V8 on file the four is the nearest thing: it is a Mustang within the power band.
    expect(researchedFor({ make: 'Ford', model: 'Mustang' }, row, [four])).toBe(four);
    // Another make's or model's record is never a match.
    expect(researchedFor({ make: 'Chevy', model: 'Mustang' }, row, [gt])).toBeNull();
    expect(researchedFor({ make: 'Ford', model: 'Mustang Mach-E' }, row, [gt])).toBeNull();
  });

  it('a world car with a researched record drives on it, not on the table; without it on file it falls back', () => {
    const research = sheetFromResearch(gtr as Parameters<typeof sheetFromResearch>[0]);
    useResearchedSheets(id => (id === research.id ? research : null), [research]);
    const m = coreModelFor({ make: 'Nizzan', model: 'GT-RR', bodyStyle: 'sports' }, stock, TUNE_DEF);
    expect(m.source).toBe('researched');
    expect(m.sheet).toBe(research);
    // The NISMO's 600 hp and 3,867 lb, not anything the table would have estimated.
    expect(hpOf(m.model)).toBeGreaterThan(600 * 0.95);
    expect(hpOf(m.model)).toBeLessThan(600 * 1.05);
    expect(m.model.chassis.mass).toBeCloseTo(3867 * LB + 75, 0);
    expect(m.model.driveline.layout).toBe('AWD');
    // and without it on file, the same car falls back (no table row for it either: its body style's archetype)
    useResearchedSheets(() => null, []); clearCoreModels();
    expect(coreModelFor({ make: 'Nizzan', model: 'GT-RR', bodyStyle: 'sports' }, stock, TUNE_DEF).source).toBe('style');
  });

  it('a car with no figures at all still drives, on its body style\'s archetype (an unknown style is a sedan)', () => {
    const m = coreModelFor({ make: 'Zz', model: 'Qq', bodyStyle: 'weird' }, stock, TUNE_DEF);
    expect(m.source).toBe('style');
    expect(m.bodyClass).toBe('sedan');
    expect(m.model.chassis.mass).toBeCloseTo(1540, 3);                    // the sedan archetype's 1540 kg
    expect(() => coreModelFor({}, stock, TUNE_DEF)).not.toThrow();
  });

  it('is cached per car and build: the same build is the same object; a part is a new model that has the part', () => {
    const car = { make: 'Toyota', model: 'Corolla', bodyStyle: 'sedan' };
    const a = coreModelFor(car, stock, TUNE_DEF);
    expect(coreModelFor(car, { ...stock }, { ...TUNE_DEF })).toBe(a);
    const engine = coreModelFor(car, tier('engine', 3), TUNE_DEF);
    expect(engine).not.toBe(a);
    expect(hpOf(engine.model)).toBeGreaterThan(hpOf(a.model) * 1.04);    // intake, exhaust, cams: more power
    const turbo = coreModelFor(car, tier('turbo', 1), TUNE_DEF);
    expect(a.model.engine.kind).toBe('na');
    expect(turbo.model.engine.kind).toBe('turbo');                        // a turbo kit on the naturally aspirated 1.8
    const light = coreModelFor(car, tier('weight', 3), TUNE_DEF);
    expect(light.model.chassis.mass).toBeLessThan(a.model.chassis.mass - 100); // 12% off the curb weight
    expect(coreModelFor(car, stock, TUNE_DEF)).toBe(a);
  });
});
