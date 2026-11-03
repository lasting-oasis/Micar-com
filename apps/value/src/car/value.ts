// Everything the sticker and the car page show about value, computed once from a record.
import { MODELS, findModel } from '../engine/models';
import { forecast, valuate, type Inputs, type Valuation } from '../engine/valuation';
import { recordInputs, recordMsrp, type CarRecord } from './record';

export type Snapshot = {
  inputs: Inputs;
  val: Valuation;
  msrp: ReturnType<typeof recordMsrp>;
  /** Value by year from today, at `milesPerYear`. */
  curve: ReturnType<typeof forecast>;
  /** Where the asking price sits against the private-party range. */
  verdict: { kind: 'below' | 'within' | 'above' | 'none'; diff: number; text: string };
};

export function snapshot(r: CarRecord, now = new Date(), milesPerYear = 12000): Snapshot | null {
  const inputs = recordInputs(r, now);
  if (!inputs) return null;
  const val = valuate(inputs, now);
  const curve = forecast(inputs, 5, milesPerYear, now);
  let verdict: Snapshot['verdict'] = { kind: 'none', diff: 0, text: '' };
  if (r.price > 0) {
    // Dealer asking prices are judged against dealer retail, which includes reconditioning and margin.
    const diff = r.price - val.dealerRetail;
    const pct = diff / val.dealerRetail;
    if (pct <= -0.03) verdict = { kind: 'below', diff, text: `${usd(-diff)} below typical dealer retail` };
    else if (pct < 0.03) verdict = { kind: 'within', diff, text: 'In line with typical dealer retail' };
    else verdict = { kind: 'above', diff, text: `${usd(diff)} above typical dealer retail` };
  }
  return { inputs, val, msrp: recordMsrp(r), curve, verdict };
}

export const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
export const miles = (n: number) => `${new Intl.NumberFormat('en-US').format(n)} mi`;
export const monthYear = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

/** How this model holds value next to others of its body style: the share of a new one's price
 *  a 5-year-old keeps, against the median for curated models with the same body. */
export type Retention = {
  /** This model's 5-year share, when it is a model we have data for. */
  own?: number;
  /** Median 5-year share for this body style. */
  typical: number;
  /** 'sedan', 'SUV', 'pickup'... for a sentence. */
  bodyWord: string;
  kind: 'better' | 'average' | 'worse' | 'unknown';
  calibrated: boolean;
};

const BODY_WORDS: Record<string, string> = { 'Sedan': 'sedan', 'SUV / Crossover': 'SUV', 'Pickup Truck': 'pickup', 'Coupe / Sports': 'coupe', 'Hatchback / Wagon': 'hatchback or wagon', 'Minivan': 'minivan' };
const typicalByBody = new Map<string, number>();

export function retention(r: CarRecord): Retention {
  const info = r.model ? findModel(r.make, r.model) : undefined;
  const body = info?.body ?? r.body;
  let typical = typicalByBody.get(body);
  if (typical === undefined) {
    const xs = MODELS.filter((m) => m.body === body && !m.source).map((m) => m.residual5).sort((a, b) => a - b);
    typical = xs.length ? xs[Math.floor(xs.length / 2)] : 0.5;
    typicalByBody.set(body, typical);
  }
  const bodyWord = BODY_WORDS[body] ?? 'car';
  // EPA-only models carry a make-and-body average rather than their own figure.
  if (!info || info.source === 'epa') return { typical, bodyWord, kind: 'unknown', calibrated: false };
  const d = info.residual5 - typical;
  return { own: info.residual5, typical, bodyWord, kind: d >= 0.04 ? 'better' : d <= -0.04 ? 'worse' : 'average', calibrated: !!info.calibrated };
}
