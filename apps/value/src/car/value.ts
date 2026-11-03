// Everything the sticker and the car page show about value, computed once from a record.
import { MODELS, findModel } from '../engine/models';
import { t } from '../i18n';
import { forecast, valuate, type Inputs, type Valuation } from '../engine/valuation';
import { recordInputs, recordMsrp, type CarRecord } from './record';

export type Snapshot = {
  inputs: Inputs;
  val: Valuation;
  msrp: ReturnType<typeof recordMsrp>;
  /** Value by year from today, at `milesPerYear`. */
  curve: ReturnType<typeof forecast>;
  /** Where the asking price sits against typical dealer retail, with a deal rating in the terms
   *  shoppers know from the big listing sites: great deal, good deal, fair price, above market, high price. */
  verdict: { kind: 'below' | 'within' | 'above' | 'none'; tier: 'great' | 'good' | 'fair' | 'above' | 'high' | 'none'; diff: number; label: string; text: string };
};

export function snapshot(r: CarRecord, now = new Date(), milesPerYear = 12000): Snapshot | null {
  const inputs = recordInputs(r, now);
  if (!inputs) return null;
  const val = valuate(inputs, now);
  const curve = forecast(inputs, 5, milesPerYear, now);
  let verdict: Snapshot['verdict'] = { kind: 'none', tier: 'none', diff: 0, label: '', text: '' };
  if (r.price > 0) {
    // Dealer asking prices are judged against dealer retail, which includes reconditioning and margin.
    const diff = r.price - val.dealerRetail;
    const pct = diff / val.dealerRetail;
    const tier = pct <= -0.08 ? 'great' : pct <= -0.03 ? 'good' : pct < 0.03 ? 'fair' : pct < 0.08 ? 'above' : 'high';
    const label = { great: 'Great deal', good: 'Good deal', fair: 'Fair price', above: 'Above market', high: 'High price' }[tier];
    const kind = pct <= -0.03 ? 'below' : pct < 0.03 ? 'within' : 'above';
    const text = kind === 'below' ? `${usd(-diff)} under market value` : kind === 'within' ? 'At market value' : `${usd(diff)} over market value`;
    verdict = { kind, tier, diff, label, text };
  }
  return { inputs, val, msrp: recordMsrp(r), curve, verdict };
}

export const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
export const miles = (n: number) => `${new Intl.NumberFormat('en-US').format(n)} mi`;
export { monthYear } from '../i18n';

/** The deal rating's name, in the page's language. */
export function dealLabel(tier: Snapshot['verdict']['tier']): string {
  return tier === 'great' ? t('Great deal') : tier === 'good' ? t('Good deal') : tier === 'fair' ? t('Fair price') : tier === 'above' ? t('Above market') : tier === 'high' ? t('High price') : '';
}

/** "$1,082 under market value" / "at market value" / "$500 over market value", in the page's language. */
export function dealGap(v: Snapshot['verdict']): string {
  const gap = usd(Math.abs(v.diff));
  return v.kind === 'below' ? t('{gap} under market value', { gap }) : v.kind === 'within' ? t('at market value') : t('{gap} over market value', { gap });
}

/** How this model holds value next to others of its body style: the share of a new one's price
 *  a 5-year-old keeps, against the median for models with the same body. */
export type Retention = {
  /** The 5-year share for this model, or for the make's cars of this body when the model has no data of its own. */
  own: number;
  /** Median 5-year share for this body style. */
  typical: number;
  /** Canonical body style ('SUV / Crossover'...), for the words around the numbers. */
  body: string;
  make: string;
  /** "2019 Civic" when the figure is the model's own. */
  modelLabel: string;
  /** True when `own` is the make-and-body average rather than this model's own figure. */
  makeLevel: boolean;
  /** False when the car isn't in our lists at all; then only `typical` means anything. */
  rated: boolean;
  /** Share of models with this body style that keep less value than this one (0-1). */
  percentile: number;
  /** 1-5, from the percentile. */
  stars: number;
  kind: 'better' | 'average' | 'worse';
  calibrated: boolean;
};

const peersByBody = new Map<string, number[]>();

/** 5-year shares of the models we have figures for, by body style (ascending); bodies with few models borrow the whole list. */
function peers(body: string): number[] {
  let xs = peersByBody.get(body);
  if (!xs) {
    xs = MODELS.filter((m) => m.body === body && !m.source).map((m) => m.residual5);
    if (xs.length < 10) xs = MODELS.filter((m) => !m.source).map((m) => m.residual5);
    xs.sort((a, b) => a - b);
    peersByBody.set(body, xs);
  }
  return xs;
}

export function retention(r: CarRecord): Retention {
  const info = r.model ? findModel(r.make, r.model) : undefined;
  const body = info?.body ?? r.body;
  const xs = peers(body);
  const typical = xs[Math.floor(xs.length / 2)];
  const makeLevel = !info || info.source === 'epa';
  // A model the EPA lists but we have no figure for carries its make's average for the body style.
  const own = info?.residual5 ?? typical;
  const below = xs.filter((x) => x < own).length, ties = xs.filter((x) => x === own).length;
  const percentile = xs.length ? (below + ties / 2) / xs.length : 0.5;
  const stars = percentile >= 0.9 ? 5 : percentile >= 0.7 ? 4 : percentile >= 0.45 ? 3 : percentile >= 0.2 ? 2 : 1;
  const d = own - typical;
  return {
    own, typical, body, make: r.make, modelLabel: info ? `${r.year} ${info.model}` : '', makeLevel, rated: !!info, percentile, stars,
    kind: d >= 0.04 ? 'better' : d <= -0.04 ? 'worse' : 'average', calibrated: !!info?.calibrated,
  };
}
