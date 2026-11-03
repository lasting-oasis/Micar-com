// Everything the sticker and the car page show about value, computed once from a record.
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
