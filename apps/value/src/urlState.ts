import { REGIONS, type Region } from './engine/data';
import { MARKET, marketNote } from './engine/market';
import { prefillMsrp } from './engine/prefill';
import type { Inputs, MarketCondition, Urgency } from './engine/valuation';

export type FormState = {
  make: string; model: string; trim: string; body: string; msrp: string; year: string; mileage: string;
  condition: string; title: string; accident: string; region: string;
  market: string; listings: string; urgency: string; comps: string; annual: string;
  /** Text pasted from a listings page; kept out of the URL because it is long. */
  page: string;
  zip: string;
  radius: string;
};

export const MARKET_OPTIONS = [
  { name: 'Auto', value: 'auto' as const, desc: `${marketNote()}. Updated weekly from public data.` },
  { name: 'Soft', value: 'soft' as MarketCondition, desc: 'Lots of used inventory, prices drifting down' },
  { name: 'Normal', value: 'normal' as MarketCondition, desc: 'Inventory and prices about where they usually are' },
  { name: 'Tight', value: 'tight' as MarketCondition, desc: 'Little inventory, cars selling fast above book' },
];

export const URGENCY_OPTIONS = [
  { name: 'No rush', value: 'none' as Urgency, desc: 'Hold out for the right buyer' },
  { name: 'Within a month', value: 'month' as Urgency, desc: 'Price a little under the market to move it' },
  { name: 'This week', value: 'week' as Urgency, desc: 'Priced to sell: expect to take a clear discount' },
];

export function defaults(now = new Date()): FormState {
  const year = now.getFullYear() - 4;
  return {
    make: 'Toyota', model: 'Camry', trim: 'SE', body: 'Sedan',
    msrp: String(prefillMsrp('Toyota', 'Camry', year, 'SE')?.msrp ?? 30000),
    year: String(year), mileage: '48000', condition: 'Good',
    title: 'Clean', accident: 'None', region: 'Southeast',
    market: 'Auto', listings: '', urgency: 'No rush', comps: '', annual: '12000',
    page: '', zip: '', radius: '50',
  };
}

const KEYS: (keyof FormState)[] = [
  'make', 'model', 'trim', 'body', 'msrp', 'year', 'mileage', 'condition', 'title', 'accident', 'region',
  'market', 'listings', 'urgency', 'comps', 'annual', 'zip', 'radius',
];

export function readUrl(): FormState {
  const state = defaults();
  try {
    const q = new URLSearchParams(window.location.search);
    for (const k of KEYS) { const v = q.get(k); if (v !== null) state[k] = v.slice(0, 120); }
  } catch { /* no URL access in some embeds */ }
  return state;
}

export function urlHasMsrp(): boolean {
  try { return new URLSearchParams(window.location.search).has('msrp'); } catch { return false; }
}

export function shareUrl(state: FormState): string {
  const q = new URLSearchParams();
  const d = defaults();
  for (const k of KEYS) if (state[k] !== d[k] || k === 'make' || k === 'model' || k === 'msrp' || k === 'year' || k === 'mileage') q.set(k, state[k]);
  try { return `${window.location.origin}${window.location.pathname}?${q}`; } catch { return `?${q}`; }
}

export function writeUrl(state: FormState) {
  try { window.history.replaceState(null, '', shareUrl(state)); } catch { /* sandboxed */ }
}

export type Errors = Partial<Record<keyof FormState, string>>;

/** Pull dollar amounts out of free text like "21,500; $22k 20995". */
export function parseComps(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?/gi)) {
    let n = parseFloat(m[1].replace(/,/g, ''));
    if (m[2]) n *= 1000;
    if (Number.isFinite(n) && n >= 1000 && n <= 2_000_000) out.push(Math.round(n));
    if (out.length >= 8) break;
  }
  return out;
}

export function parse(state: FormState, now = new Date()): { inputs: Inputs | null; errors: Errors } {
  const errors: Errors = {};
  const msrp = Number(state.msrp);
  const year = Number(state.year);
  const mileage = Number(state.mileage);
  const maxYear = now.getFullYear() + 1;
  if (!state.msrp || !Number.isFinite(msrp) || msrp < 3000 || msrp > 1_000_000) errors.msrp = 'Enter the original sticker price, between $3,000 and $1,000,000.';
  if (!Number.isInteger(year) || year < 1990 || year > maxYear) errors.year = `Enter a model year from 1990 to ${maxYear}.`;
  if (state.mileage === '' || !Number.isFinite(mileage) || mileage < 0 || mileage > 600_000) errors.mileage = 'Enter the odometer reading, from 0 to 600,000 miles.';
  let listings: number | null = null;
  if (state.listings.trim() !== '') {
    const n = Number(state.listings);
    if (!Number.isInteger(n) || n < 0 || n > 999) errors.listings = 'Enter a whole number of listings, or leave it blank.';
    else listings = n;
  }
  if (state.zip.trim() !== '' && !/^\d{5}$/.test(state.zip.trim())) errors.zip = 'Enter a 5-digit ZIP code.';
  if (Object.keys(errors).length) return { inputs: null, errors };
  const marketChoice = MARKET_OPTIONS.find((o) => o.name === state.market)?.value ?? 'auto';
  const auto = marketChoice === 'auto';
  const market: MarketCondition = auto ? MARKET.condition : marketChoice;
  const urgency = URGENCY_OPTIONS.find((o) => o.name === state.urgency)?.value ?? 'none';
  return {
    errors,
    inputs: {
      make: state.make, model: state.model, trim: state.trim, body: state.body, msrp, year, mileage,
      condition: state.condition, title: state.title, accident: state.accident,
      region: (REGIONS as readonly string[]).includes(state.region) ? (state.region as Region) : 'Southeast',
      market, marketIndex: auto ? MARKET.index : null, marketNote: auto ? marketNote() : undefined,
      listings, urgency, comps: parseComps(state.comps),
    },
  };
}
