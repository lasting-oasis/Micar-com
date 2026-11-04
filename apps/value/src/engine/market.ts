import snapshot from '../data/market.json';
import type { MarketCondition } from './valuation';

export type MarketSnapshot = {
  source: string;
  seriesId: string;
  fetchedAt: string;
  latestPeriod: string;
  latestValue: number;
  yoyPct: number;
  threeMonthPct: number;
  index: number;
  condition: MarketCondition;
  history: { period: string; value: number }[];
};

/** The weekly national snapshot baked in at build time (see scripts/fetch-market.mjs). */
export const MARKET: MarketSnapshot = snapshot as MarketSnapshot;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y}`;
}

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`;

/** One line for the ledger and the form: "Used-car prices nationally −1.5% vs a year ago, +1.4% over 3 months (BLS, Sep 2026)". */
export function marketNote(s: MarketSnapshot = MARKET): string {
  return `Used-car prices nationally ${signed(s.yoyPct)} vs a year ago, ${signed(s.threeMonthPct)} over 3 months (BLS, ${periodLabel(s.latestPeriod)})`;
}

/** Days since the snapshot's latest data month ended; BLS publishes with ~2 weeks lag, so >75 means the weekly job has been failing. */
export function snapshotAgeDays(s: MarketSnapshot = MARKET, now = new Date()): number {
  const [y, m] = s.latestPeriod.split('-').map(Number);
  const end = new Date(y, m, 0);
  return Math.round((now.getTime() - end.getTime()) / 86_400_000);
}
