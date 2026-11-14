import { describe, expect, it } from 'vitest';
import stickers from '../data/stickers.json';
import epaFile from '../data/epa-configs.json';
import { API_URL, apiIndexJson, buildCarRecords, carsListJson, openApiJson, type ApiSticker, type EpaFile } from './api';
import { buildModelPages, type Sticker } from './pages';

const epa = epaFile as unknown as EpaFile;
const real = () => buildCarRecords(stickers as unknown as ApiSticker[], epa);

describe('json api', () => {
  it('merges case-only duplicates, sorts trims cheapest first, and fills EPA specs from either spelling', () => {
    const data: ApiSticker[] = [
      { make: 'Nissan', model: '370Z', body: 'Coupe / Sports', years: [{ year: 2019, destination: 895, trims: [t('Base', 30090)], source: 'https://x.test/a', sourceType: 'secondary' }] },
      { make: 'Nissan', model: '370z', body: 'Coupe / Sports', years: [{ year: 2019, trims: [t('Nismo', 45790), t('Base', 30090)], source: 'not a url', sourceType: 'odd' }] },
    ];
    const mini: EpaFile = { source: 'EPA', url: 'https://epa.test', asOf: '2026-11-03', configs: [[3.7, 6, 'Manual 6-spd', 'Rear-Wheel Drive', 'Premium Gasoline', '']], models: { 'Nissan|370z': { '2019': [0] } } };
    const [car, ...rest] = buildCarRecords(data, mini);
    expect(rest).toHaveLength(0);
    expect(car.id).toBe('nissan-370z');
    const [y] = car.years;
    expect(y.trims.map((x) => x.name)).toEqual(['Base', 'Nismo']);
    expect(y.msrpUsd).toEqual({ low: 30090, high: 45790 });
    expect(y.destinationUsd).toBeNull();
    expect(y.source).toEqual({ url: null, kind: null });
    expect(y.specs).toEqual([{ displacementL: 3.7, cylinders: 6, transmission: 'Manual 6-spd', drive: 'Rear-Wheel Drive', fuel: 'Premium Gasoline', type: '' }]);
    expect(new URL(y.valueUrl).searchParams.get('trim')).toBe('Base');
    expect(car.links.self).toBe(`${API_URL}cars/nissan-370z.json`);
  });

  it('has one record per HTML page, with the same ids', () => {
    const cars = real();
    const pages = buildModelPages(stickers as unknown as Sticker[]);
    expect(cars.map((c) => c.id)).toEqual(pages.map((p) => p.slug));
  });

  it('every real record is well formed and survives a JSON round trip', () => {
    const cars = real();
    let withSpecs = 0;
    for (const c of cars) {
      expect(JSON.parse(JSON.stringify(c))).toEqual(c);
      expect(c.years.length).toBeGreaterThan(0);
      for (const y of c.years) {
        expect(y.trims.length).toBeGreaterThan(0);
        expect(y.msrpUsd.low).toBeLessThanOrEqual(y.msrpUsd.high);
        expect(y.trims.every((tr) => Number.isInteger(tr.msrpUsd) && tr.msrpUsd > 0)).toBe(true);
        if (y.specs.length) withSpecs++;
      }
    }
    // most model years have an EPA record; a collapse here means the key lookup broke
    expect(withSpecs).toBeGreaterThan(cars.reduce((n, c) => n + c.years.length, 0) * 0.8);
  });

  it('list and index agree with the records; the OpenAPI file names every path', () => {
    const cars = real();
    const list = carsListJson(cars, '2026-11-13T00:00:00Z');
    expect(list.count).toBe(cars.length);
    expect(list.cars[0].links.self).toMatch(/^https:\/\/.+\.json$/);
    const index = apiIndexJson(cars, epa, '2026-11-13T00:00:00Z');
    expect(index.counts.models).toBe(cars.length);
    expect(index.sources.specs?.asOf).toBe(epa.asOf);
    const spec = openApiJson();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toEqual(['/index.json', '/cars.json', '/value', '/cars/{id}.json']);
    expect(spec.paths['/value'].servers[0].url).toBe('https://micar-sim.onrender.com/api/v1');
    for (const c of cars) expect(spec.components.schemas.Body.enum).toContain(c.body);
  });

  it('the Value schema allows a withheld value and requires the evidence', () => {
    const v = (openApiJson() as any).components.schemas.Value;
    expect(v.properties.valueUsd.type).toEqual(['object', 'null']);
    expect(v.properties.confidence.type).toEqual(['object', 'null']);
    expect(v.required).toContain('evidence');
    expect(v.properties.withheld.properties.reason.enum).toEqual(['branded-title']);
  });
});

function t(trim: string, msrp: number) {
  return { trim, msrp };
}
