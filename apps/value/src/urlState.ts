import { REGIONS, type Region } from './engine/data';
import type { Inputs } from './engine/valuation';

export type FormState = Record<keyof Inputs, string> & { annual: string };

export function defaults(now = new Date()): FormState {
  return {
    make: 'Toyota', model: 'Camry SE', body: 'Sedan', msrp: '35000',
    year: String(now.getFullYear() - 4), mileage: '48000', condition: 'Good',
    title: 'Clean', accident: 'None', region: 'Southeast', annual: '12000',
  };
}

const KEYS: (keyof FormState)[] = ['make', 'model', 'body', 'msrp', 'year', 'mileage', 'condition', 'title', 'accident', 'region', 'annual'];

export function readUrl(): FormState {
  const state = defaults();
  try {
    const q = new URLSearchParams(window.location.search);
    for (const k of KEYS) { const v = q.get(k); if (v !== null) state[k] = v.slice(0, 60); }
  } catch { /* no URL access in some embeds */ }
  return state;
}

export function shareUrl(state: FormState): string {
  const q = new URLSearchParams();
  for (const k of KEYS) q.set(k, state[k]);
  try { return `${window.location.origin}${window.location.pathname}?${q}`; } catch { return `?${q}`; }
}

export function writeUrl(state: FormState) {
  try { window.history.replaceState(null, '', shareUrl(state)); } catch { /* sandboxed */ }
}

export type Errors = Partial<Record<keyof FormState, string>>;

export function parse(state: FormState, now = new Date()): { inputs: Inputs | null; errors: Errors } {
  const errors: Errors = {};
  const msrp = Number(state.msrp);
  const year = Number(state.year);
  const mileage = Number(state.mileage);
  const maxYear = now.getFullYear() + 1;
  if (!state.msrp || !Number.isFinite(msrp) || msrp < 3000 || msrp > 1_000_000) errors.msrp = 'Enter the original sticker price, between $3,000 and $1,000,000.';
  if (!Number.isInteger(year) || year < 1990 || year > maxYear) errors.year = `Enter a model year from 1990 to ${maxYear}.`;
  if (state.mileage === '' || !Number.isFinite(mileage) || mileage < 0 || mileage > 600_000) errors.mileage = 'Enter the odometer reading, from 0 to 600,000 miles.';
  if (Object.keys(errors).length) return { inputs: null, errors };
  return {
    errors,
    inputs: {
      make: state.make, model: state.model, body: state.body, msrp, year, mileage,
      condition: state.condition, title: state.title, accident: state.accident,
      region: (REGIONS as readonly string[]).includes(state.region) ? (state.region as Region) : 'Southeast',
    },
  };
}
