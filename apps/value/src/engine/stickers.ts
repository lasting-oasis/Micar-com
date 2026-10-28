// Real sticker prices (MSRP, excluding destination) by model year and trim,
// from the manufacturers' own pricing announcements, merged from
// data/research/stickers/*.json by scripts/build-data.ts. When a sticker
// exists for the chosen make, model and year, the page offers the trims and
// prefills the exact MSRP instead of the rough typicalMsrp estimate.

import raw from '../data/stickers.json';

export type StickerTrim = { trim: string; msrp: number; config: string; note: string };
export type StickerYear = {
  year: number;
  destination: number | null;
  /** Base trim first (its cheapest configuration). */
  trims: StickerTrim[];
  source: string;
  sourceType: 'manufacturer' | 'secondary';
  note: string;
};
export type StickerSet = { make: string; model: string; body: string; note: string; gaps: string[]; years: StickerYear[] };

export const STICKERS: StickerSet[] = raw as StickerSet[];

export function stickerFor(make: string, model: string, year: number): { set: StickerSet; year: StickerYear } | undefined {
  const set = STICKERS.find((s) => s.make === make && s.model === model);
  const y = set?.years.find((s) => s.year === year);
  return set && y ? { set, year: y } : undefined;
}

/** Trim rows de-duplicated by trim name (first = cheapest configuration), for pickers. */
export function trimChoices(y: StickerYear): StickerTrim[] {
  const seen = new Set<string>();
  return y.trims.filter((t) => { const k = t.trim.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The row for a trim name (case-insensitive, hyphen/space-insensitive); falls back to the base trim. */
export function stickerTrim(y: StickerYear, trim: string): StickerTrim {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const want = norm(trim);
  return (want && y.trims.find((t) => norm(t.trim) === want)) || y.trims.find((t) => want && norm(t.trim).startsWith(want)) || y.trims[0];
}

/** Pick the sticker row for a used listing: the listing's own trim if it is on
 * file, else the search filter's trim, else the base trim. For pickups, prefer
 * the crew-cab 4x4 configuration of that trim, which is what most used trucks are. */
export function resolveStickerTrim(y: StickerYear, candidates: string[], body?: string): StickerTrim {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  for (const c of candidates) {
    const want = norm(c);
    if (!want) continue;
    const rows = y.trims.filter((t) => norm(t.trim) === want);
    if (!rows.length) continue;
    if (body === 'Pickup Truck') {
      const crew4x4 = rows.find((t) => /(supercrew|crew\s*cab|double\s*cab|crewmax)/i.test(t.config) && /(4x4|4wd|awd)/i.test(t.config));
      if (crew4x4) return crew4x4;
    }
    return rows[0];
  }
  return y.trims[0];
}

export function stickerMsrp(y: StickerYear, trim: string): number {
  return stickerTrim(y, trim).msrp;
}

/** Base-trim MSRP for the year (used to split a trim's premium from the base car). */
export function baseMsrp(y: StickerYear): number {
  return Math.min(...y.trims.map((t) => t.msrp));
}

/** Where the sticker came from, for the UI. */
export function stickerSourceLabel(set: StickerSet, y: StickerYear): string {
  try {
    const host = new URL(y.source).hostname.replace(/^www\./, '');
    return y.sourceType === 'manufacturer' ? `${set.make}'s pricing release (${host})` : host;
  } catch { return y.sourceType === 'manufacturer' ? `${set.make}'s pricing release` : 'a published price list'; }
}
