// Real sticker prices (MSRP, excluding destination) by model year and trim,
// from the manufacturers' own pricing announcements. When a sticker exists
// for the chosen make, model and year, the page offers the trims and
// prefills the exact MSRP instead of the rough typicalMsrp estimate.
//
// Sources are noted per model. Add models in the same shape.

export type StickerYear = {
  year: number;
  /** Trim name → MSRP excluding destination. First entry is the base trim. */
  trims: [name: string, msrp: number][];
  note?: string;
};

export type StickerSet = {
  make: string;
  model: string;
  source: string;
  years: StickerYear[];
};

export const STICKERS: StickerSet[] = [
  {
    make: 'Honda',
    model: 'Civic',
    source: 'Honda pricing releases (hondanews.com), sedan, CVT where both transmissions were offered; excludes destination',
    years: [
      { year: 2016, trims: [['LX', 19440], ['EX', 21040], ['EX-T', 22200], ['EX-L', 23700], ['Touring', 26500]], note: 'LX 6-speed manual was $18,640' },
      { year: 2017, trims: [['LX', 19540], ['EX', 21140], ['EX-T', 22300], ['EX-L', 23800], ['Touring', 26600]], note: 'LX 6-speed manual was $18,740' },
      { year: 2018, trims: [['LX', 19640], ['EX', 21240], ['EX-T', 22400], ['EX-L', 23900], ['Touring', 26700]], note: 'LX 6-speed manual was $18,840' },
      { year: 2019, trims: [['LX', 20250], ['Sport', 21950], ['EX', 23400], ['EX-L', 24600], ['Touring', 27300]], note: 'LX and Sport 6-speed manuals were $800 less' },
      { year: 2020, trims: [['LX', 20550], ['Sport', 22250], ['EX', 23700], ['EX-L', 24900], ['Touring', 27600]], note: 'LX and Sport 6-speed manuals were $800 less' },
      { year: 2021, trims: [['LX', 21050], ['Sport', 22850], ['EX', 24200], ['EX-L', 25400], ['Touring', 28100]] },
      { year: 2022, trims: [['LX', 21900], ['Sport', 23300], ['EX', 24900], ['Touring', 28500]], note: 'All-new 11th generation' },
      { year: 2023, trims: [['LX', 23450], ['Sport', 25050], ['EX', 26450], ['Touring', 30050]] },
      { year: 2024, trims: [['LX', 23950], ['Sport', 25550], ['EX', 26950], ['Touring', 30550]] },
      { year: 2025, trims: [['LX', 24250], ['Sport', 26250], ['Sport Hybrid', 28750], ['Sport Touring Hybrid', 31750]], note: 'Refresh; hybrids return' },
      { year: 2026, trims: [['LX', 24695], ['Sport', 26695], ['Sport Hybrid', 29395], ['Si', 31495], ['Sport Touring Hybrid', 32395]] },
    ],
  },
];

export function stickerFor(make: string, model: string, year: number): { set: StickerSet; year: StickerYear } | undefined {
  const set = STICKERS.find((s) => s.make === make && s.model === model);
  const y = set?.years.find((s) => s.year === year);
  return set && y ? { set, year: y } : undefined;
}

/** MSRP for a trim name in a sticker year; falls back to the base trim. */
export function stickerMsrp(y: StickerYear, trim: string): number {
  const hit = y.trims.find(([name]) => name.toLowerCase() === trim.trim().toLowerCase());
  return (hit ?? y.trims[0])[1];
}
