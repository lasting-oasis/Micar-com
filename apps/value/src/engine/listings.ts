// Pulls listings out of text copied from a search-results page (Facebook
// Marketplace, OfferUp, Craigslist, CarGurus, Autotrader, Cars.com, CarMax…).
// The person reads the page themselves and pastes it; nothing here touches
// any website.

import { MAKES } from './data';

export type ParsedListing = {
  price: number;
  year?: number;
  miles?: number;
  /** The listing's title line when one was found, for the summary. */
  title?: string;
};

export type SkipReasons = { payments: number; outOfRange: number; otherYears: number; otherModels: number; duplicates: number };

export type ParseResult = {
  listings: ParsedListing[];
  skipped: SkipReasons;
  source: string | null;
  /** "123 results" if the page states a total, which is usually more than it shows. */
  resultCount: number | null;
};

export type ParseTarget = {
  /** Model name as in the MODELS table; alternatives separated by " / " all count. */
  model?: string;
  year?: number;
  /** Keep listings within this many model years of the target. Default 2. */
  yearTolerance?: number;
};

const SOURCES: [RegExp, string][] = [
  [/facebook\.com\/marketplace|\bmarketplace\b/i, 'Facebook Marketplace'],
  [/offerup/i, 'OfferUp'],
  [/craigslist/i, 'Craigslist'],
  [/cargurus/i, 'CarGurus'],
  [/autotrader/i, 'Autotrader'],
  [/cars\.com/i, 'Cars.com'],
  [/carmax/i, 'CarMax'],
  [/carvana/i, 'Carvana'],
  [/truecar/i, 'TrueCar'],
  [/edmunds/i, 'Edmunds'],
];

const PRICE_RE = /\$\s?(\d{1,3}(?:,\d{3})+|\d{4,6})(?:\.\d{2})?(?![\d,])|\$\s?(\d{1,3}(?:\.\d)?)\s?[kK]\b/g;
const MILES_RE = /\b(\d{1,3}(?:,\d{3})+|\d{1,6})(?:\.\d)?\s?([kK])?\s?(?:mi\b\.?|miles?\b|mileage)/g;
// A price followed closely by any of these is a payment or a discount, not an asking price.
const NOT_ASKING_AFTER = /^\s*(?:\/\s?mo(?:nth)?\b|per\s+mo|a\s+month|monthly|\bmo\.?\b|est\.?\s*(?:\/|per)?\s*mo|under\b|below\b|off\b|savings?\b|down\b|less\b)/i;
// A price preceded by these is an old price, a discount or a down payment.
const NOT_ASKING_BEFORE = /(?:was|msrp|save|off|below|under|down|drop(?:ped)?\s+by|discount|reduced\s+by|minus|-)\s*$/i;

const MAKE_WORDS = MAKES.map((m) => m.name).filter((n) => n !== 'Other');
const TITLE_RE = new RegExp(
  `\\b(19[89]\\d|20[0-4]\\d)\\b[^\\n$]{0,45}?\\b(${MAKE_WORDS.map(escape).join('|')})\\b`,
  'gi',
);

function escape(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

type Hit = { price: number; start: number; end: number; ok: boolean };

export function parseListingsPage(raw: string, target: ParseTarget = {}): ParseResult {
  const text = raw.replace(/ /g, ' ').replace(/\r/g, '');
  const skipped: SkipReasons = { payments: 0, outOfRange: 0, otherYears: 0, otherModels: 0, duplicates: 0 };
  const source = SOURCES.find(([re]) => re.test(text))?.[1] ?? null;
  const countMatch = text.match(/\b(\d{1,3}(?:,\d{3})?|\d{1,5})\+?\s+(?:results?|matches|listings|vehicles(?: found)?|cars(?: found)?)\b/i);
  const resultCount = countMatch ? Number(countMatch[1].replace(/,/g, '')) : null;
  if (!text.trim()) return { listings: [], skipped, source, resultCount };

  const tolerance = target.yearTolerance ?? 2;
  const modelKeys = (target.model ?? '').split('/').map((m) => normalize(m)).filter((m) => m.length >= 2);
  // Only filter by model when the page talks about it at all.
  const filterByModel = modelKeys.length > 0 && modelKeys.some((k) => normalize(text).includes(k));
  const matchesModel = (s: string) => !filterByModel || modelKeys.some((k) => normalize(s).includes(k));

  // Every dollar figure, flagged as a plausible asking price or not.
  const hits: Hit[] = [];
  for (const m of text.matchAll(PRICE_RE)) {
    const price = m[1] ? Number(m[1].replace(/,/g, '')) : Math.round(Number(m[2]) * 1000);
    const start = m.index!, end = start + m[0].length;
    let ok = true;
    if (NOT_ASKING_AFTER.test(text.slice(end, end + 24)) || NOT_ASKING_BEFORE.test(text.slice(Math.max(0, start - 16), start))) { skipped.payments++; ok = false; }
    else if (price < 1500 || price > 400_000) { skipped.outOfRange++; ok = false; }
    hits.push({ price, start, end, ok });
  }
  const asking = hits.filter((h) => h.ok);

  // Listing titles ("2021 Buick Enclave Essence") anchor the segmentation.
  const titles = [...text.matchAll(TITLE_RE)].map((m) => ({
    start: m.index!,
    year: Number(m[1]),
    line: text.slice(m.index!, Math.min(text.length, text.indexOf('\n', m.index!) === -1 ? m.index! + 80 : text.indexOf('\n', m.index!))).slice(0, 80),
  }));

  const found: ParsedListing[] = [];
  if (titles.length >= 2) {
    // Which comes first on this page, the price or the title? Marketplace puts
    // the price above the title; most dealer sites put the title first.
    let priceFirst = 0;
    for (const t of titles) {
      const before = nearestBefore(asking, t.start);
      const after = nearestAfter(asking, t.start);
      if (before && (!after || t.start - before.end < after.start - t.start) && t.start - before.end < 40) priceFirst++;
    }
    const layoutPriceFirst = priceFirst > titles.length / 2;
    const used = new Set<Hit>();
    for (let i = 0; i < titles.length; i++) {
      const t = titles[i];
      const blockEnd = i + 1 < titles.length ? titles[i + 1].start : text.length;
      let hit: Hit | undefined;
      if (layoutPriceFirst) {
        const b = nearestBefore(asking, t.start);
        if (b && t.start - b.end < 120 && !used.has(b)) hit = b;
      } else {
        hit = asking.find((h) => h.start >= t.start && h.start < blockEnd && !used.has(h));
      }
      if (!hit) continue;
      used.add(hit);
      const block = text.slice(Math.min(t.start, hit.start), layoutPriceFirst ? (i + 1 < titles.length ? (nearestBefore(asking, titles[i + 1].start)?.start ?? blockEnd) : blockEnd) : blockEnd);
      found.push({ price: hit.price, year: t.year, miles: milesIn(block), title: t.line.trim() });
    }
  }
  if (!found.length) {
    // No recognisable titles: fall back to a window of text around each price.
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      if (!h.ok) continue;
      const lo = Math.max(i > 0 ? hits[i - 1].end : 0, h.start - 300);
      const hi = Math.min(i + 1 < hits.length ? hits[i + 1].start : text.length, h.end + 300);
      const window = text.slice(lo, hi);
      const yearMatch = nearest(window, /\b(19[89]\d|20[0-4]\d)\b/g, h.start - lo, (m) => Number(m[1]));
      found.push({ price: h.price, year: yearMatch, miles: milesIn(window), title: undefined });
      if (filterByModel && !matchesModel(window)) { found.pop(); skipped.otherModels++; }
    }
  }

  const seen = new Set<string>();
  const listings: ParsedListing[] = [];
  for (const l of found) {
    if (target.year && l.year !== undefined && Math.abs(l.year - target.year) > tolerance) { skipped.otherYears++; continue; }
    if (l.title !== undefined && !matchesModel(l.title)) { skipped.otherModels++; continue; }
    const key = `${l.price}|${l.year ?? ''}|${l.miles ?? ''}`;
    if (seen.has(key)) { skipped.duplicates++; continue; }
    seen.add(key);
    listings.push(l);
  }
  listings.sort((a, b) => a.price - b.price);
  return { listings, skipped, source, resultCount: resultCount !== null && resultCount >= listings.length ? resultCount : null };
}

function nearestBefore(hits: Hit[], pos: number): Hit | undefined {
  let best: Hit | undefined;
  for (const h of hits) if (h.end <= pos && (!best || h.end > best.end)) best = h;
  return best;
}
function nearestAfter(hits: Hit[], pos: number): Hit | undefined {
  let best: Hit | undefined;
  for (const h of hits) if (h.start >= pos && (!best || h.start < best.start)) best = h;
  return best;
}

function milesIn(block: string): number | undefined {
  for (const m of block.matchAll(MILES_RE)) {
    const n = Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
    if (n >= 100 && n <= 500_000) return Math.round(n);
  }
  return undefined;
}

/** The regex match closest to `pos` in `window`, mapped through `pick`. */
function nearest<T>(window: string, re: RegExp, pos: number, pick: (m: RegExpMatchArray) => T): T | undefined {
  let best: { d: number; v: T } | undefined;
  for (const m of window.matchAll(re)) {
    const d = Math.abs(m.index! - pos);
    if (!best || d < best.d) best = { d, v: pick(m) };
  }
  return best?.v;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** One-line summary for the UI. */
export function describe(result: ParseResult, modelName?: string): string {
  const n = result.listings.length;
  if (!n) return 'No asking prices found. Copy the whole search-results page, not just one listing.';
  const years = result.listings.map((l) => l.year).filter((y): y is number => y !== undefined);
  const miles = result.listings.map((l) => l.miles).filter((m): m is number => m !== undefined);
  const parts = [`${n} listing${n > 1 ? 's' : ''}${result.resultCount && result.resultCount > n ? ` of ${result.resultCount.toLocaleString()}` : ''}${result.source ? ` from ${result.source}` : ''}`];
  if (years.length) {
    const lo = Math.min(...years), hi = Math.max(...years);
    parts.push(`${lo === hi ? lo : `${lo}–${hi}`}${modelName ? ` ${modelName}s` : ''}`);
  }
  parts.push(`median asking $${Math.round(median(result.listings.map((l) => l.price))).toLocaleString()}`);
  if (miles.length) parts.push(`median ${Math.round(median(miles) / 1000)}k mi`);
  const sk = result.skipped;
  const skips = [
    sk.otherModels ? `${sk.otherModels} other model${sk.otherModels > 1 ? 's' : ''}` : '',
    sk.otherYears ? `${sk.otherYears} other year${sk.otherYears > 1 ? 's' : ''}` : '',
    sk.payments ? `${sk.payments} payment/discount figure${sk.payments > 1 ? 's' : ''}` : '',
    sk.duplicates ? `${sk.duplicates} duplicate${sk.duplicates > 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  return parts.join(' · ') + (skips.length ? ` · skipped ${skips.join(', ')}` : '');
}
