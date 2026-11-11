import { describe, expect, it } from 'vitest';
import raw from '../data/epa-configs.json';
import { describeEpaConfig, drivetrainOf, epaConfigsFor, epaFields, epaSource, powertrainOf, transmissionTypeOf, type EpaConfig, type EpaFile } from './epaConfigs';
import { findModel } from './models';

const file = raw as unknown as EpaFile;
const config = (over: Partial<EpaConfig>): EpaConfig => ({ displacementL: 2, cylinders: 4, transmission: 'Automatic 6-spd', drive: 'Front-Wheel Drive', fuel: 'Regular Gasoline', type: '', ...over });

describe('the EPA configuration file', () => {
  it('says where it came from and when', () => {
    expect(file.source).toBe('EPA fueleconomy.gov vehicle file');
    expect(file.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(epaSource(file)).toEqual({ kind: 'agency', name: file.source, url: file.url, asOf: file.asOf });
  });

  it('points every model year at configurations that exist', () => {
    let years = 0;
    for (const byYear of Object.values(file.models)) {
      for (const list of Object.values(byYear)) {
        years++;
        expect(list.length).toBeGreaterThan(0);
        for (const i of list) expect(file.configs[i]).toBeDefined();
      }
    }
    expect(years).toBeGreaterThan(6000);
  });

  it('is keyed by the model names the site shows', () => {
    for (const key of ['Honda|Civic', 'Toyota|Tacoma', 'Tesla|Model 3', 'Chevrolet|Silverado 1500', 'Mazda|MX-5 Miata']) {
      const [make, model] = key.split('|');
      expect(findModel(make, model), key).toBeTruthy();
      expect(file.models[key], key).toBeDefined();
    }
  });

  it('lists the 2024 Civic sedan as the EPA tested it', () => {
    const civics = epaConfigsFor(file, 'Honda', 'Civic', 2024);
    expect(civics).toContainEqual({ displacementL: 2, cylinders: 4, transmission: 'Automatic (variable gear ratios)', drive: 'Front-Wheel Drive', fuel: 'Regular Gasoline', type: '' });
    expect(epaConfigsFor(file, 'Honda', 'Civic', 1999)).toEqual([]);
    expect(epaConfigsFor(file, 'Nobody', 'Nothing', 2024)).toEqual([]);
  });

  it('gives an electric car no displacement and no cylinders', () => {
    const teslas = epaConfigsFor(file, 'Tesla', 'Model 3', 2024);
    expect(teslas.length).toBeGreaterThan(0);
    for (const c of teslas) { expect(c.displacementL).toBeNull(); expect(c.cylinders).toBeNull(); expect(powertrainOf(c)).toBe('electric'); }
  });
});

describe('reading the EPA’s labels', () => {
  it('describes a configuration in the EPA’s own words', () => {
    expect(describeEpaConfig(config({ transmission: 'Automatic (variable gear ratios)' }))).toBe('2.0 L · 4 cyl · Automatic (variable gear ratios) · Front-Wheel Drive · Regular Gasoline');
    expect(describeEpaConfig(config({ displacementL: null, cylinders: null, transmission: 'Automatic (A1)', drive: 'Rear-Wheel Drive', fuel: 'Electricity', type: 'EV' }))).toBe('Automatic (A1) · Rear-Wheel Drive · Electricity');
    expect(describeEpaConfig(config({ type: 'Hybrid' }))).toContain('· Hybrid');
  });

  it('maps a transmission only where the label settles it', () => {
    expect(transmissionTypeOf(config({ transmission: 'Manual 6-spd' }))).toBe('manual');
    expect(transmissionTypeOf(config({ transmission: 'Automatic 8-spd' }))).toBe('automatic');
    expect(transmissionTypeOf(config({ transmission: 'Automatic (S8)' }))).toBe('automatic');
    expect(transmissionTypeOf(config({ transmission: 'Automatic (variable gear ratios)' }))).toBe('cvt');
    expect(transmissionTypeOf(config({ transmission: 'Automatic (AV-S7)' }))).toBe('cvt');
    expect(transmissionTypeOf(config({ transmission: 'Automatic (A1)', type: 'EV', fuel: 'Electricity' }))).toBe('single-speed');
    // An automated manual may or may not be a dual-clutch; a hybrid's variable ratios may or may not be a belt.
    expect(transmissionTypeOf(config({ transmission: 'Automatic (AM-S6)' }))).toBeNull();
    expect(transmissionTypeOf(config({ transmission: 'Automatic (variable gear ratios)', type: 'Hybrid' }))).toBeNull();
    expect(transmissionTypeOf(config({ transmission: '' }))).toBeNull();
  });

  it('maps a drivetrain only where the label settles it', () => {
    expect(drivetrainOf(config({ drive: 'Front-Wheel Drive' }))).toBe('FWD');
    expect(drivetrainOf(config({ drive: 'Rear-Wheel Drive' }))).toBe('RWD');
    expect(drivetrainOf(config({ drive: 'All-Wheel Drive' }))).toBe('AWD');
    expect(drivetrainOf(config({ drive: 'Part-time 4-Wheel Drive' }))).toBe('4WD');
    expect(drivetrainOf(config({ drive: '4-Wheel Drive' }))).toBe('4WD');
    expect(drivetrainOf(config({ drive: '4-Wheel or All-Wheel Drive' }))).toBeNull();
    expect(drivetrainOf(config({ drive: '' }))).toBeNull();
  });

  it('maps the powertrain and leaves what the scoring does not model empty', () => {
    expect(powertrainOf(config({}))).toBe('gasoline');
    expect(powertrainOf(config({ fuel: 'Premium Gasoline', type: 'FFV' }))).toBe('gasoline');
    expect(powertrainOf(config({ type: 'Hybrid' }))).toBe('hybrid');
    expect(powertrainOf(config({ type: 'Plug-in Hybrid' }))).toBe('plug-in-hybrid');
    expect(powertrainOf(config({ fuel: 'Diesel', type: 'Diesel' }))).toBe('diesel');
    expect(powertrainOf(config({ fuel: 'Hydrogen', type: 'FCV' }))).toBeNull();
    expect(powertrainOf(config({ fuel: 'Natural Gas', type: 'CNG' }))).toBeNull();
  });

  it('fills specification fields with the EPA as their source and skips what it cannot settle', () => {
    const source = epaSource(file);
    const fields = epaFields(config({ transmission: 'Automatic (AM-S6)', drive: 'All-Wheel Drive', displacementL: 3.8, cylinders: 6, fuel: 'Premium Gasoline' }), source);
    expect(fields.displacementL).toEqual({ value: 3.8, source });
    expect(fields.cylinders).toEqual({ value: 6, source });
    expect(fields.drivetrain).toEqual({ value: 'AWD', source });
    expect(fields.powertrain).toEqual({ value: 'gasoline', source });
    expect(fields.transmission).toEqual({ value: 'Automatic (AM-S6)', source });
    expect('transmissionType' in fields).toBe(false);
    expect(Object.keys(fields)).not.toContain('horsepower');
    expect(Object.keys(fields)).not.toContain('combinedMpg');
  });
});
