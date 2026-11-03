// New-car price level by model year (2025 = 1), measured from the sticker data by
// scripts/build-data.ts. Outside the measured years: 1%/yr before, 2.5%/yr after.
import index from '../data/price-index.json';

const LEVEL = (index as { level: Record<string, number> }).level;
const YEARS = Object.keys(LEVEL).map(Number).sort((a, b) => a - b);
const FIRST = YEARS[0], LAST = YEARS[YEARS.length - 1];

export function priceLevel(year: number): number {
  const y = Math.round(year);
  if (y < FIRST) return LEVEL[FIRST] * Math.pow(1.01, y - FIRST);
  if (y > LAST) return LEVEL[LAST] * Math.pow(1.025, y - LAST);
  return LEVEL[y];
}

/** How much more a comparable new car costs in `toYear` than it did in `fromYear`. */
export function priceGrowth(fromYear: number, toYear: number): number {
  return priceLevel(toYear) / priceLevel(fromYear);
}
