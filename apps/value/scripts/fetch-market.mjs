#!/usr/bin/env node
// Weekly national used-car market snapshot.
//
// Pulls the Bureau of Labor Statistics CPI-U index for "Used cars and trucks"
// (series CUSR0000SETA02, seasonally adjusted), a public-domain monthly series,
// and turns it into a market-cycle reading the valuation engine can use.
// Falls back to the same series on FRED if the BLS API is unavailable.
//
// Usage:
//   node scripts/fetch-market.mjs                 # fetch and write src/data/market.json
//   node scripts/fetch-market.mjs --from bls.json # build the snapshot from a saved BLS response
//   node scripts/fetch-market.mjs --check         # print the reading without writing
//
// No API key, no scraping: both endpoints are published for exactly this use.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERIES = 'CUSR0000SETA02';
const BLS_URL = `https://api.bls.gov/publicAPI/v1/timeseries/data/${SERIES}`;
const FRED_URL = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${SERIES}`;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/market.json');

const args = process.argv.slice(2);
const fromFile = args.includes('--from') ? args[args.indexOf('--from') + 1] : null;
const checkOnly = args.includes('--check');

/** @returns {Promise<{period: string, value: number}[]>} oldest first, period = YYYY-MM */
async function loadSeries() {
  if (fromFile) return parseBls(JSON.parse(readFileSync(fromFile, 'utf8')));
  try {
    const res = await fetch(BLS_URL, { headers: { 'User-Agent': 'queen_city_mycarvalue market snapshot (github actions)' } });
    if (!res.ok) throw new Error(`BLS HTTP ${res.status}`);
    const json = await res.json();
    if (json.status !== 'REQUEST_SUCCEEDED') throw new Error(`BLS status ${json.status}: ${(json.message || []).join('; ')}`);
    const rows = parseBls(json);
    if (rows.length < 15) throw new Error(`BLS returned only ${rows.length} months`);
    return rows;
  } catch (err) {
    console.warn(`BLS failed (${err.message}); trying FRED`);
    const res = await fetch(FRED_URL);
    if (!res.ok) throw new Error(`FRED HTTP ${res.status}`);
    return parseFred(await res.text());
  }
}

function parseBls(json) {
  const data = json?.Results?.series?.[0]?.data ?? [];
  return data
    .filter((d) => /^M(0[1-9]|1[0-2])$/.test(d.period))
    .map((d) => ({ period: `${d.year}-${d.period.slice(1)}`, value: Number(d.value) }))
    .filter((d) => Number.isFinite(d.value))
    .sort((a, b) => a.period.localeCompare(b.period));
}

function parseFred(csv) {
  return csv
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      const [date, value] = line.split(',');
      return { period: date.slice(0, 7), value: Number(value) };
    })
    .filter((d) => Number.isFinite(d.value))
    .sort((a, b) => a.period.localeCompare(b.period));
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pct = (now, then) => ((now - then) / then) * 100;
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Turn the index history into a market reading. */
export function summarize(rows, fetchedAt = new Date()) {
  const latest = rows[rows.length - 1];
  const yearAgo = rows.find((r) => r.period === shiftPeriod(latest.period, -12)) ?? rows[Math.max(0, rows.length - 13)];
  const threeAgo = rows.find((r) => r.period === shiftPeriod(latest.period, -3)) ?? rows[Math.max(0, rows.length - 4)];
  const yoyPct = pct(latest.value, yearAgo.value);
  const threeMonthPct = pct(latest.value, threeAgo.value);
  // Blend the year-over-year move with recent momentum (3-month change, annualized).
  // ±8% a year is treated as a full-strength soft or tight market.
  const trend = 0.6 * yoyPct + 0.4 * (threeMonthPct * 4);
  const index = round(clamp(trend / 8, -1, 1), 3);
  const condition = index <= -0.35 ? 'soft' : index >= 0.35 ? 'tight' : 'normal';
  return {
    source: 'U.S. Bureau of Labor Statistics, CPI-U: Used cars and trucks, seasonally adjusted',
    seriesId: SERIES,
    fetchedAt: fetchedAt.toISOString().slice(0, 10),
    latestPeriod: latest.period,
    latestValue: latest.value,
    yoyPct: round(yoyPct),
    threeMonthPct: round(threeMonthPct),
    index,
    condition,
    history: rows.slice(-25),
  };
}

function shiftPeriod(period, months) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const rows = await loadSeries();
const snapshot = summarize(rows);
console.log(
  `${snapshot.latestPeriod}: index ${snapshot.latestValue} · ${snapshot.yoyPct >= 0 ? '+' : ''}${snapshot.yoyPct}% vs a year ago · ` +
  `${snapshot.threeMonthPct >= 0 ? '+' : ''}${snapshot.threeMonthPct}% over 3 months → ${snapshot.condition} (${snapshot.index})`,
);
if (!checkOnly) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`wrote ${OUT}`);
}
