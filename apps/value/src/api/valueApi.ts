// The valuation API: the calculator's own engine, answering a query string with JSON. It is a pure function so the
// value tests check it; the sim server (apps/sim/server.ts) mounts it at GET /api/v1/value, because GitHub Pages
// can't run code. It reads the same parameters as the app's links (urlState.ts KEYS), so a link that opens the
// calculator and a call to this API with the same query get the same numbers.
import { ACCIDENTS, CONDITIONS, MAKES, REGIONS, TITLES } from '../engine/data';
import { MODELS } from '../engine/models';
import { prefillMsrp } from '../engine/prefill';
import { STICKERS, findStickerTrim, stickerFor, stickerTrim } from '../engine/stickers';
import { expectedMilesFor, forecast, valuate } from '../engine/valuation';
import { MARKET_OPTIONS, URGENCY_OPTIONS, URL_KEYS, defaults, parse, type FormState } from '../urlState';

export const APP_URL = 'https://lasting-oasis.github.io/Micar-com/';

export type ApiResponse = { status: number; body: Record<string, unknown> };

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Every make/model the engine knows, in its own spelling: the sticker sets first, then the model table. */
function knownCars(): { make: string; model: string; body: string }[] {
  const seen = new Set<string>();
  const out: { make: string; model: string; body: string }[] = [];
  for (const c of [...STICKERS, ...MODELS]) {
    const k = `${c.make}|${c.model}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ make: c.make, model: c.model, body: c.body });
  }
  return out;
}

/** Finds the engine's spelling for a make/model, ignoring case and punctuation, or for a data-API id like honda-civic. */
export function resolveCar(q: { id?: string | null; make?: string | null; model?: string | null }): { make: string; model: string; body: string } | null {
  const cars = knownCars();
  if (q.id) return cars.find((c) => slug(`${c.make} ${c.model}`) === q.id) ?? null;
  if (!q.make || !q.model) return null;
  const mk = plain(q.make), md = plain(q.model);
  return cars.find((c) => plain(c.make) === mk && plain(c.model) === md) ?? null;
}

const pick = (value: string | null, options: readonly string[], field: string, errors: Record<string, string>): string | undefined => {
  if (value === null || value === '') return undefined;
  const hit = options.find((o) => o.toLowerCase() === value.trim().toLowerCase());
  if (!hit) errors[field] = `Use one of: ${options.join(', ')}.`;
  return hit;
};

/** The query of a request URL as the server receives it (e.g. Express's req.originalUrl): all of it, a literal '?' inside
 *  a value included, where splitting on the first '?' would drop every parameter after it. Repeated keys: the first. */
export function queryOf(url: string): URLSearchParams {
  return new URL(url, 'http://micar.local').searchParams;
}

/** The Cache-Control for an answer: the same query always gets the same answer for the day, a refusal included, so an
 *  hour is safe; a server failure is never cached, so the next call tries again. */
export function cacheControlFor(status: number): string {
  return status >= 500 ? 'no-store' : 'public, max-age=3600';
}

/** GET /api/v1/value?<query>. Errors come back as 400 with a message per field, never as a guessed value. */
export function valueQuery(params: URLSearchParams, now: Date = new Date()): ApiResponse {
  const errors: Record<string, string> = {};
  const assumed: string[] = [];
  const get = (k: string) => {
    const v = params.get(k);
    return v === null ? null : v.slice(0, 120);
  };

  const id = get('id');
  if (!id && (!get('make') || !get('model'))) {
    return { status: 400, body: { ok: false, errors: { make: 'Give make and model (e.g. make=Honda&model=Civic), or id from the data API (e.g. id=honda-civic).' } } };
  }
  const car = resolveCar({ id, make: get('make'), model: get('model') });
  if (!car && id) return { status: 404, body: { ok: false, errors: { id: `No car with id "${id}". The ids are listed at ${APP_URL}api/v1/cars.json.` } } };

  const form: FormState = defaults(now);
  form.make = car?.make ?? get('make')!.trim();
  form.model = car?.model ?? get('model')!.trim();
  if (!car) {
    if (!MAKES.some((m) => m.name.toLowerCase() === form.make.toLowerCase())) assumed.push(`"${form.make} ${form.model}" isn't in MiCar's model list; the value uses general depreciation for its body style.`);
    else assumed.push(`"${form.model}" isn't in MiCar's model list for ${form.make}; the value uses general depreciation for its body style.`);
  }

  const year = get('year');
  if (!year) errors.year = 'Give the model year, e.g. year=2019.';
  else form.year = year;
  form.trim = get('trim')?.trim() || '';
  form.body = get('body') ? pick(get('body'), ['Sedan', 'SUV / Crossover', 'Pickup Truck', 'Coupe / Sports', 'Hatchback / Wagon', 'Minivan'], 'body', errors) ?? form.body : car?.body ?? form.body;
  if (!get('body') && !car) assumed.push(`Body style taken as ${form.body}; pass body to change it.`);

  const yr = Number(form.year);
  if (get('msrp')) form.msrp = get('msrp')!;
  else if (Number.isInteger(yr)) {
    // A few cars are in the sticker data under two case-only spellings (370Z / 370z, GranTurismo / Granturismo), which
    // the data API merges under one id; use the spelling that has this year's sticker, as the data API does.
    if (car) {
      const sameId = knownCars().filter((c) => slug(`${c.make} ${c.model}`) === slug(`${car.make} ${car.model}`));
      const withSticker = sameId.find((c) => stickerFor(c.make, c.model, yr));
      if (withSticker && !stickerFor(form.make, form.model, yr)) { form.make = withSticker.make; form.model = withSticker.model; }
    }
    // a trim the caller names must be on file for that year: stickerTrim would quietly fall back to the base trim
    // (the calculator's prefill does), and this API never prices a guess; with the caller's own msrp a trim is a label
    const onFile = stickerFor(form.make, form.model, yr);
    if (onFile && form.trim) {
      if (!findStickerTrim(onFile.year, form.trim)) {                       // the calculator's own matching, minus its fallback
        errors.trim = `No ${yr} ${form.make} ${form.model} trim called "${form.trim}". Trims on file for that year: ${onFile.year.trims.map((t) => t.trim).join(', ')}; or give msrp (original MSRP in dollars, excluding destination) to value it at your own sticker price.`;
      }
    } else if (form.trim) {
      // no trims on file for that year at all: the typical sticker ignores trim, so a named trim cannot be priced
      errors.trim = `No trims on file for the ${yr} ${form.make} ${form.model}, so "${form.trim}" can't be priced. Leave trim out for a typical sticker for the model and year, or give msrp to value it at your own sticker price.`;
    }
    const pre = errors.trim ? null : prefillMsrp(form.make, form.model, yr, form.trim);
    if (pre) {
      form.msrp = String(pre.msrp);
      const st = pre.source === 'sticker' ? stickerFor(form.make, form.model, yr) : undefined;
      if (st) form.trim = stickerTrim(st.year, form.trim).trim;
      assumed.push(`MSRP $${pre.msrp.toLocaleString('en-US')}: ${pre.label}`);
    } else if (!errors.trim) errors.msrp = 'No sticker price on file for this car; give msrp (original MSRP in dollars, excluding destination).';
  }

  if (get('mileage')) form.mileage = get('mileage')!;
  else if (Number.isInteger(yr)) {
    form.mileage = String(Math.round(expectedMilesFor(yr, now) / 1000) * 1000);
    assumed.push(`Mileage taken as ${Number(form.mileage).toLocaleString('en-US')}, typical for its age; pass mileage for a real figure.`);
  }

  form.condition = pick(get('condition'), CONDITIONS.map((o) => o.name), 'condition', errors) ?? form.condition;
  form.title = pick(get('title'), TITLES.map((o) => o.name), 'title', errors) ?? form.title;
  form.accident = pick(get('accident'), ACCIDENTS.map((o) => o.name), 'accident', errors) ?? form.accident;
  form.region = pick(get('region'), REGIONS, 'region', errors) ?? form.region;
  // market and urgency by the calculator's own option names, in any case; anything else is refused (the calculator
  // would quietly fall back to Auto and No rush). listings is checked by parse(), as in the calculator.
  form.market = pick(get('market'), MARKET_OPTIONS.map((o) => o.name), 'market', errors) ?? form.market;
  form.urgency = pick(get('urgency'), URGENCY_OPTIONS.map((o) => o.name), 'urgency', errors) ?? form.urgency;
  // zip is not read: it only seeds the calculator's own search for nearby listings and moves no number
  for (const k of ['listings', 'comps'] as const) {
    const v = get(k);
    if (v !== null) form[k] = v;
  }
  // miles a year for the forecast, clamped to 3,000-30,000 as the calculator clamps it (App.tsx). Not a number, zero or
  // below is refused: the calculator reads 0 as "not given" (12,000), so accepting it would forecast one way here and
  // another in the calculator.
  let annual = 12000;
  const annualGiven = get('annual');
  if (annualGiven !== null) {
    const n = Number(annualGiven);
    if (annualGiven.trim() === '' || !Number.isFinite(n) || n <= 0) errors.annual = 'Give the miles a year driven as a number above 0, e.g. annual=12000 (3,000 to 30,000).';
    else {
      form.annual = annualGiven;
      annual = Math.min(30000, Math.max(3000, n));
      if (annual !== n) assumed.push(`Miles a year ${n.toLocaleString('en-US')} taken as ${annual.toLocaleString('en-US')}, the calculator's limit (3,000 to 30,000).`);
    }
  }
  const defaulted = (['condition', 'title', 'accident', 'region', 'market', 'urgency'] as const).filter((k) => !get(k)).map((k) => `${k} ${form[k]}`);
  if (annualGiven === null) defaulted.push(`annual ${annual.toLocaleString('en-US')} miles a year`);
  if (defaulted.length) assumed.push(`Defaults used where not given: ${defaulted.join(', ')}.`);

  const parsed = parse(form, now);
  Object.assign(errors, parsed.errors);
  if (Object.keys(errors).length || !parsed.inputs) return { status: 400, body: { ok: false, errors } };

  const inputs = parsed.inputs;
  const v = valuate(inputs, now);
  if (get('comps') !== null) {
    assumed.push(inputs.comps.length
      ? `Asking prices read from comps: ${inputs.comps.map((c) => '$' + c.toLocaleString('en-US')).join(', ')}${v.compsIgnored ? ` (${v.compsIgnored} too far from the estimate, ignored)` : ''}.`
      : `No asking prices could be read from comps "${get('comps')}"; give them separated by a comma and a space, e.g. comps=21500, 22900.`);
  }
  // the calculator link carries every input this valuation used (market, listings, urgency and comps move the numbers
  // too, annual the forecast), in the calculator's own key order, so opening it shows the same figures; zip and radius
  // only drive the calculator's own listings search and are not read here
  const q = new URLSearchParams();
  const extra = new Set<string>(['listings', 'comps', 'urgency', 'market', 'annual'].filter((k) => get(k) !== null));
  for (const k of URL_KEYS) {
    const core = ['make', 'model', 'trim', 'body', 'msrp', 'year', 'mileage', 'condition', 'title', 'accident', 'region'].includes(k);
    if ((core || extra.has(k)) && form[k]) q.set(k, form[k]);
  }
  return {
    status: 200,
    body: {
      ok: true,
      asOf: now.toISOString().slice(0, 10),
      car: { make: inputs.make, model: inputs.model, trim: inputs.trim || null, body: inputs.body, year: inputs.year },
      inputs: { msrpUsd: inputs.msrp, mileage: inputs.mileage, condition: inputs.condition, title: inputs.title, accident: inputs.accident, region: inputs.region, marketChoice: form.market, market: inputs.market, listings: inputs.listings, urgency: form.urgency, comps: inputs.comps, annualMiles: annual },
      assumed,
      valueUsd: { tradeIn: Math.round(v.tradeIn), privateParty: Math.round(v.privateParty), dealerRetail: Math.round(v.dealerRetail), range: { low: Math.round(v.range.low), high: Math.round(v.range.high) } },
      confidence: { level: v.confidence, reasons: v.confidenceReasons },
      drivers: v.drivers,
      steps: v.steps.map((s) => ({ label: s.label, detail: s.detail, valueUsd: Math.round(s.value), deltaUsd: Math.round(s.delta) })),
      forecastUsd: forecast(inputs, 5, annual, now).map((f) => ({ year: Number(f.year), privateParty: f.value, low: f.low, high: f.high, mileage: f.mileage })),
      modelKnown: v.modelKnown,
      links: { app: `${APP_URL}?${q.toString()}#/value` },
      note: 'An estimate from public pricing data, not an offer or an appraisal. Same engine and inputs as the MiCar calculator.',
    },
  };
}
