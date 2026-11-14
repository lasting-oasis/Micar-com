// The static JSON data API: the same sticker and EPA data the app uses, as plain files an agent can fetch.
// GitHub Pages serves files, not code, so every response is written at build time (tools/build-seo.ts):
//   api/v1/index.json         what's here, with links
//   api/v1/cars.json          every model, one line each
//   api/v1/cars/<id>.json     one model: every year, every trim's MSRP, the EPA's configurations, sources
//   api/v1/openapi.json       the format of all of the above (OpenAPI 3.1)
// Pure functions only, so the tests can check the output.
import { SITE_URL, slugify, valueLink, type ModelPage, type YearRow } from './pages';

export const API_VERSION = 'v1';
export const API_URL = `${SITE_URL}api/${API_VERSION}/`;
/** The one live endpoint, on the sim server (GitHub Pages can't run code). Free Render hosting: the first call after a quiet spell can take up to a minute. */
export const VALUE_API_URL = 'https://micar-sim.onrender.com/api/v1/value';

export type ApiStickerTrim = { trim: string; msrp: number; config?: string };
export type ApiStickerYear = { year: number; destination?: number | null; trims: ApiStickerTrim[]; source?: string; sourceType?: string };
export type ApiSticker = { make: string; model: string; body: string; years: ApiStickerYear[] };
export type EpaFile = { source: string; url: string; asOf: string; configs: (string | number)[][]; models: Record<string, Record<string, number[]>> };

export type CarSpec = { displacementL: number | null; cylinders: number | null; transmission: string; drive: string; fuel: string; type: string };
export type CarTrim = { name: string; msrpUsd: number; config: string | null };
export type CarYear = {
  year: number;
  msrpUsd: { low: number; high: number };
  destinationUsd: number | null;
  trims: CarTrim[];
  specs: CarSpec[];
  source: { url: string | null; kind: 'manufacturer' | 'secondary' | null };
  valueUrl: string;
};
export type CarRecord = {
  id: string;
  make: string;
  model: string;
  body: string;
  years: CarYear[];
  links: { self: string; html: string; value: string };
};
export type CarSummary = {
  id: string;
  make: string;
  model: string;
  body: string;
  years: { first: number; last: number; count: number };
  msrpUsd: { low: number; high: number };
  links: { self: string; html: string };
};

const carUrl = (id: string) => `${API_URL}cars/${id}.json`;
const htmlUrl = (id: string) => `${SITE_URL}cars/${id}/`;

function epaSpecs(epa: EpaFile | null, keys: string[], year: number): CarSpec[] {
  if (!epa) return [];
  for (const key of keys) {
    const list = epa.models[key]?.[String(year)];
    if (!list) continue;
    return list
      .map((i) => epa.configs[i])
      .filter(Boolean)
      .map((c) => ({
        displacementL: Number(c[0]) > 0 ? Number(c[0]) : null,
        cylinders: Number(c[1]) > 0 ? Number(c[1]) : null,
        transmission: String(c[2] ?? ''),
        drive: String(c[3] ?? ''),
        fuel: String(c[4] ?? ''),
        type: String(c[5] ?? ''),
      }));
  }
  return [];
}

/**
 * One record per make/model id, merged the same way as the HTML pages (buildModelPages): case-only duplicates share
 * an id, and for a year both carry, the entry with more priced trims wins. Ids therefore match the /cars/<id>/ pages.
 */
export function buildCarRecords(stickers: ApiSticker[], epa: EpaFile | null): CarRecord[] {
  type Acc = { make: string; model: string; body: string; keys: string[]; years: Map<number, ApiStickerYear & { trims: ApiStickerTrim[] }> };
  const byId = new Map<string, Acc>();
  for (const s of stickers) {
    const id = slugify(`${s.make} ${s.model}`);
    if (!id) continue;
    let acc = byId.get(id);
    if (!acc) byId.set(id, (acc = { make: s.make, model: s.model, body: s.body, keys: [], years: new Map() }));
    acc.keys.push(`${s.make}|${s.model}`);
    for (const y of s.years) {
      const priced = y.trims.filter((t) => Number.isFinite(t.msrp) && t.msrp > 0);
      if (priced.length > (acc.years.get(y.year)?.trims.length ?? 0)) acc.years.set(y.year, { ...y, trims: priced });
    }
  }
  const out: CarRecord[] = [];
  for (const [id, a] of byId) {
    const page: ModelPage = { slug: id, make: a.make, model: a.model, body: a.body, years: [] };
    const years: CarYear[] = [...a.years.values()]
      .filter((y) => y.trims.length > 0)
      .sort((x, y) => y.year - x.year)
      .map((y) => {
        const trims = [...y.trims].sort((p, q) => p.msrp - q.msrp).map((t) => ({ name: t.trim, msrpUsd: t.msrp, config: t.config ? t.config : null }));
        const row: YearRow = { year: y.year, trims: trims.length, low: trims[0].msrpUsd, high: trims[trims.length - 1].msrpUsd, baseTrim: trims[0].name };
        const kind = y.sourceType === 'manufacturer' || y.sourceType === 'secondary' ? y.sourceType : null;
        return {
          year: y.year,
          msrpUsd: { low: row.low, high: row.high },
          destinationUsd: typeof y.destination === 'number' && y.destination > 0 ? y.destination : null,
          trims,
          specs: epaSpecs(epa, a.keys, y.year),
          source: { url: y.source && /^https?:\/\//.test(y.source) ? y.source : null, kind },
          valueUrl: valueLink(SITE_URL, page, row),
        };
      });
    if (!years.length) continue;
    out.push({ id, make: a.make, model: a.model, body: a.body, years, links: { self: carUrl(id), html: htmlUrl(id), value: valueLink(SITE_URL, page) } });
  }
  return out.sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model));
}

export function carSummary(c: CarRecord): CarSummary {
  const ys = c.years.map((y) => y.year);
  return {
    id: c.id,
    make: c.make,
    model: c.model,
    body: c.body,
    years: { first: Math.min(...ys), last: Math.max(...ys), count: ys.length },
    msrpUsd: { low: Math.min(...c.years.map((y) => y.msrpUsd.low)), high: Math.max(...c.years.map((y) => y.msrpUsd.high)) },
    links: { self: c.links.self, html: c.links.html },
  };
}

export function carsListJson(cars: CarRecord[], generatedAt: string) {
  return { version: API_VERSION, generatedAt, count: cars.length, cars: cars.map(carSummary) };
}

export function apiIndexJson(cars: CarRecord[], epa: EpaFile | null, generatedAt: string) {
  return {
    name: 'MiCar data API',
    version: API_VERSION,
    generatedAt,
    description:
      'Free, read-only, static JSON. Original window-sticker prices (MSRP, US dollars, excluding destination) for every trim of every model year MiCar covers, with the EPA configurations for each year. No key, no rate limit beyond the host. Values (trade-in, private-party, dealer retail, range, five-year forecast) come from the live valuation endpoint (links.value), the same engine as the calculator.',
    counts: { models: cars.length, modelYears: cars.reduce((n, c) => n + c.years.length, 0), trims: cars.reduce((n, c) => n + c.years.reduce((m, y) => m + y.trims.length, 0), 0) },
    links: { value: `${VALUE_API_URL}?id={id}&year={year}&mileage={miles}`, cars: `${API_URL}cars.json`, car: `${API_URL}cars/{id}.json`, openapi: `${API_URL}openapi.json`, html: `${SITE_URL}cars/`, llms: `${SITE_URL}llms.txt` },
    sources: {
      msrp: 'Manufacturer pricing where available, otherwise secondary pricing sites; each model year names its own source.',
      specs: epa ? { name: epa.source, url: epa.url, asOf: epa.asOf } : null,
    },
  };
}

/** OpenAPI 3.1 for the static files. Paths are relative to the server URL, which ends in /api/v1. */
export function openApiJson() {
  const usdRange = { type: 'object', required: ['low', 'high'], properties: { low: { type: 'integer' }, high: { type: 'integer' } } };
  const links = (keys: string[]) => ({ type: 'object', required: keys, properties: Object.fromEntries(keys.map((k) => [k, { type: 'string', format: 'uri' }])) });
  return {
    openapi: '3.1.0',
    info: {
      title: 'MiCar data API',
      version: '1.0.0',
      description: 'Static, read-only JSON files: original MSRP by trim and model year, and EPA configurations, for every model MiCar values; plus one live endpoint, /value, that runs the calculator. Ids match the HTML pages at /cars/{id}/. No key.',
    },
    servers: [{ url: API_URL.replace(/\/$/, '') }],
    paths: {
      '/index.json': { get: { operationId: 'getIndex', summary: 'What the API holds, with counts and links', responses: { '200': { description: 'Index', content: { 'application/json': { schema: { type: 'object' } } } } } } },
      '/cars.json': {
        get: {
          operationId: 'listCars',
          summary: 'Every model, one summary each, sorted by make then model',
          responses: { '200': { description: 'All models', content: { 'application/json': { schema: { $ref: '#/components/schemas/CarList' } } } } },
        },
      },
      '/value': {
        servers: [{ url: VALUE_API_URL.replace(/\/value$/, ''), description: 'Live endpoint on the MiCar World server. Free hosting: the first call after a quiet spell can take up to a minute.' }],
        get: {
          operationId: 'getValue',
          summary: "Today's value for one car: trade-in, private-party and dealer retail, range, confidence, the line-by-line build-up and a five-year forecast",
          description: 'Same engine and parameters as the calculator links. Give id, or make and model; and year. MSRP and mileage are filled in when left out and listed in "assumed". Errors are 400 with a message per field.',
          parameters: [
            { name: 'id', in: 'query', description: 'Model id from /cars.json, e.g. honda-civic. Or give make and model.', schema: { type: 'string' } },
            { name: 'make', in: 'query', schema: { type: 'string' } },
            { name: 'model', in: 'query', schema: { type: 'string' } },
            { name: 'year', in: 'query', required: true, schema: { type: 'integer' } },
            { name: 'trim', in: 'query', description: "A trim on file for that year (listed in /cars/{id}.json). Left out, the cheapest trim's sticker is used and named under \"assumed\"; a trim not on file is refused with 400 unless msrp is given, when it is only a label.", schema: { type: 'string' } },
            { name: 'msrp', in: 'query', description: 'Original MSRP in dollars, excluding destination. Required for a car not in the data.', schema: { type: 'number' } },
            { name: 'mileage', in: 'query', schema: { type: 'number' } },
            { name: 'body', in: 'query', schema: { $ref: '#/components/schemas/Body' } },
            { name: 'condition', in: 'query', schema: { enum: ['Excellent', 'Good', 'Fair', 'Poor'] } },
            { name: 'title', in: 'query', schema: { enum: ['Clean', 'Rebuilt', 'Salvage'] } },
            { name: 'accident', in: 'query', schema: { enum: ['None', 'Minor', 'Major'] } },
            { name: 'region', in: 'query', schema: { enum: ['Northeast', 'Southeast', 'Midwest', 'Southwest', 'West'] } },
            { name: 'market', in: 'query', description: 'Used-car market: Auto (the weekly index, default), Soft, Normal or Tight.', schema: { enum: ['Auto', 'Soft', 'Normal', 'Tight'] } },
            { name: 'listings', in: 'query', description: 'How many similar cars are for sale nearby (0-999).', schema: { type: 'integer' } },
            { name: 'urgency', in: 'query', description: 'How fast it needs to sell.', schema: { enum: ['No rush', 'Within a month', 'This week'] } },
            { name: 'comps', in: 'query', description: 'Up to 8 asking prices for similar cars, separated by a comma and a space or by spaces, e.g. "21500, 22900" or "$21.5k 22900" (as the calculator reads them; "21500,22900" without a space reads as one number and is dropped); ones far from the estimate are ignored. The prices used are echoed in inputs.comps.', schema: { type: 'string' } },
            { name: 'annual', in: 'query', description: 'Miles driven a year, for the forecast; clamped to 3,000-30,000, default 12,000.', schema: { type: 'number' } },
          ],
          responses: {
            '200': { description: 'The valuation', content: { 'application/json': { schema: { $ref: '#/components/schemas/Value' } } } },
            '400': { description: 'Missing or invalid parameters; errors has one message per field', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '404': { description: 'Unknown id', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/cars/{id}.json': {
        get: {
          operationId: 'getCar',
          summary: 'One model: every year, every trim and its MSRP, EPA configurations, sources, and calculator links',
          parameters: [{ name: 'id', in: 'path', required: true, description: 'Lowercase make and model joined by hyphens, e.g. honda-civic. Listed in /cars.json.', schema: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' } }],
          responses: {
            '200': { description: 'One model', content: { 'application/json': { schema: { $ref: '#/components/schemas/Car' } } } },
            '404': { description: 'No model with that id' },
          },
        },
      },
    },
    components: {
      schemas: {
        CarList: {
          type: 'object',
          required: ['version', 'generatedAt', 'count', 'cars'],
          properties: { version: { type: 'string' }, generatedAt: { type: 'string', format: 'date-time' }, count: { type: 'integer' }, cars: { type: 'array', items: { $ref: '#/components/schemas/CarSummary' } } },
        },
        CarSummary: {
          type: 'object',
          required: ['id', 'make', 'model', 'body', 'years', 'msrpUsd', 'links'],
          properties: {
            id: { type: 'string' },
            make: { type: 'string' },
            model: { type: 'string' },
            body: { $ref: '#/components/schemas/Body' },
            years: { type: 'object', required: ['first', 'last', 'count'], properties: { first: { type: 'integer' }, last: { type: 'integer' }, count: { type: 'integer' } } },
            msrpUsd: usdRange,
            links: links(['self', 'html']),
          },
        },
        Car: {
          type: 'object',
          required: ['id', 'make', 'model', 'body', 'years', 'links'],
          properties: {
            id: { type: 'string' },
            make: { type: 'string' },
            model: { type: 'string' },
            body: { $ref: '#/components/schemas/Body' },
            years: { type: 'array', description: 'Newest first', items: { $ref: '#/components/schemas/CarYear' } },
            links: links(['self', 'html', 'value']),
          },
        },
        CarYear: {
          type: 'object',
          required: ['year', 'msrpUsd', 'destinationUsd', 'trims', 'specs', 'source', 'valueUrl'],
          properties: {
            year: { type: 'integer' },
            msrpUsd: { ...usdRange, description: 'Cheapest and dearest trim, excluding destination' },
            destinationUsd: { type: ['integer', 'null'] },
            trims: { type: 'array', description: 'Cheapest first', items: { type: 'object', required: ['name', 'msrpUsd', 'config'], properties: { name: { type: 'string' }, msrpUsd: { type: 'integer' }, config: { type: ['string', 'null'] } } } },
            specs: { type: 'array', description: "The EPA's configurations for this model year; empty when the EPA lists none", items: { $ref: '#/components/schemas/Spec' } },
            source: { type: 'object', required: ['url', 'kind'], properties: { url: { type: ['string', 'null'], format: 'uri' }, kind: { enum: ['manufacturer', 'secondary', null] } } },
            valueUrl: { type: 'string', format: 'uri', description: 'Opens the MiCar calculator on this year, its cheapest trim and that MSRP' },
          },
        },
        Spec: {
          type: 'object',
          required: ['displacementL', 'cylinders', 'transmission', 'drive', 'fuel', 'type'],
          properties: {
            displacementL: { type: ['number', 'null'] },
            cylinders: { type: ['integer', 'null'] },
            transmission: { type: 'string', description: "EPA wording, e.g. 'Automatic (S10)'" },
            drive: { type: 'string' },
            fuel: { type: 'string' },
            type: { type: 'string', description: "'' for conventional, or Hybrid, EV, Plug-in Hybrid, Diesel, FFV, ..." },
          },
        },
        Value: {
          type: 'object',
          required: ['ok', 'asOf', 'car', 'inputs', 'assumed', 'valueUsd', 'confidence', 'steps', 'forecastUsd', 'links'],
          properties: {
            ok: { const: true },
            asOf: { type: 'string', format: 'date' },
            car: { type: 'object', properties: { make: { type: 'string' }, model: { type: 'string' }, trim: { type: ['string', 'null'] }, body: { type: 'string' }, year: { type: 'integer' } } },
            inputs: { type: 'object', description: 'Every input the engine used' },
            assumed: { type: 'array', items: { type: 'string' }, description: 'What was filled in because the query left it out' },
            valueUsd: { type: 'object', properties: { tradeIn: { type: 'integer' }, privateParty: { type: 'integer' }, dealerRetail: { type: 'integer' }, range: usdRange } },
            confidence: { type: 'object', properties: { level: { enum: ['High', 'Medium', 'Low'] }, reasons: { type: 'array', items: { type: 'string' } } } },
            drivers: { type: 'array', items: { type: 'string' } },
            steps: { type: 'array', description: 'The line-by-line build-up shown in the app', items: { type: 'object', properties: { label: { type: 'string' }, detail: { type: 'string' }, valueUsd: { type: 'integer' }, deltaUsd: { type: 'integer' } } } },
            forecastUsd: { type: 'array', items: { type: 'object', properties: { year: { type: 'integer' }, privateParty: { type: 'integer' }, low: { type: 'integer' }, high: { type: 'integer' }, mileage: { type: 'number' } } } },
            modelKnown: { type: 'boolean' },
            links: { type: 'object', properties: { app: { type: 'string', format: 'uri' } } },
            note: { type: 'string' },
          },
        },
        Error: { type: 'object', required: ['ok', 'errors'], properties: { ok: { const: false }, errors: { type: 'object', additionalProperties: { type: 'string' } } } },
        Body: { enum: ['Sedan', 'SUV / Crossover', 'Pickup Truck', 'Coupe / Sports', 'Hatchback / Wagon', 'Minivan'] },
      },
    },
  };
}
