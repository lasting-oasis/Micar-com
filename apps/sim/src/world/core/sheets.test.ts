// The package's public surface gives the game what it used to reach for by path or copy (DESIGN.md 10 and 13): the
// researched sheets (SHEETS, sheetById) and the tyre's own peak slips (peakSlipRatio, peakSlipTan). The adapter reads
// them from '@micar/physics', so a world car drives on the same sheets the bench validates and the assists hold a car
// under the same peaks its tyres have.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHEETS, createVehicle, defaultControls, peakSlipRatio, peakSlipTan, setRolling, sheetById, step, FLAT } from '@micar/physics';
import { frontPeakSlip } from './assists';
import { researchedSheet, researchedSheets } from './sheets';
import { coreModelFor } from './model';
import { STOCK_CFG, TUNE_DEF } from '../data';

const DEG = Math.PI / 180;

describe('the researched sheets, from the package', () => {
  it('the adapter lists the package\'s own sheets and finds each by its id: the Camry LE is the 2024 2.5 L at 203 hp', () => {
    expect(SHEETS.length).toBeGreaterThanOrEqual(16);
    expect(researchedSheets()).toBe(SHEETS);
    const camry = sheetById('2024-toyota-camry-le')!;
    expect(researchedSheet('2024-toyota-camry-le')).toBe(camry);
    expect(camry.identity.make).toBe('Toyota');
    expect(camry.horsepower?.value).toBe(203);
    expect(camry.displacementL?.value).toBe(2.5);
    expect(sheetById('no-such-car')).toBeNull();
  });
});

describe('the tyre\'s own peak slips, from the package', () => {
  it('a summer tyre on a sports car peaks at a slip angle of 4 to 10 degrees and a slip ratio of 0.08 to 0.2 at its static load; the assists read the same', () => {
    const m = coreModelFor({ make: 'Ford', model: 'Mustang', bodyStyle: 'sports' }, STOCK_CFG.perf, TUNE_DEF).model;
    const s = createVehicle(m);
    setRolling(s, 25, 0);
    step(s, defaultControls(), FLAT);
    const load = 0.5 * (s.wheelLoad[0] + s.wheelLoad[1]);
    const angle = Math.atan(peakSlipTan(m.tyreFront, load, 1));
    expect(angle).toBeGreaterThan(4 * DEG);
    expect(angle).toBeLessThan(10 * DEG);
    const ratio = peakSlipRatio(m.tyreRear, s.wheelLoad[2], 1);
    expect(ratio).toBeGreaterThan(0.08);
    expect(ratio).toBeLessThan(0.2);
    // The assist layer's limit is that same peak, at the same loads.
    expect(frontPeakSlip(s)).toBe(angle);
    // On a wet road (grip 0.6) the tyre peaks sooner: the friction falls, the stiffness does not.
    expect(peakSlipTan(m.tyreFront, load, 0.6)).toBeLessThan(peakSlipTan(m.tyreFront, load, 1));
  });

  it('the adapter no longer reaches into the package by path or keeps a copy of its tyre formula', () => {
    for (const file of ['sheets.ts', 'assists.ts', 'driver.ts', 'model.ts']) {
      const src = readFileSync(path.resolve(__dirname, file), 'utf8');
      expect(src, file).not.toMatch(/packages\/physics\/src/);
    }
    const assists = readFileSync(path.resolve(__dirname, 'assists.ts'), 'utf8');
    expect(assists).not.toMatch(/const SHAPE\b/);
    expect(assists).not.toMatch(/function muY\b/);
    expect(assists).toMatch(/import \{[^}]*peakSlipRatio[^}]*peakSlipTan[^}]*\} from '@micar\/physics'/);
  });
});
