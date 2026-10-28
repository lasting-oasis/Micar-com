import { findModel, typicalMsrp } from './models';
import { stickerFor, stickerSourceLabel, stickerTrim } from './stickers';

export type Prefill = { msrp: number; source: 'sticker' | 'typical'; label: string; note?: string };

/** The MSRP to prefill for a make/model/year/trim: a real sticker when we
 * have one, otherwise the rough typical figure scaled to the year. */
export function prefillMsrp(make: string, model: string, year: number, trim: string): Prefill | null {
  const st = stickerFor(make, model, year);
  if (st) {
    const t = stickerTrim(st.year, trim);
    return {
      msrp: t.msrp,
      source: 'sticker',
      label: `Sticker for the ${year} ${model} ${t.trim}${t.config ? ` (${t.config})` : ''}, from ${stickerSourceLabel(st.set, st.year)}. Change it if yours differs.`,
      note: [st.year.note, t.note].filter(Boolean).join(' ') || undefined,
    };
  }
  const info = findModel(make, model);
  if (!info) return null;
  return { msrp: typicalMsrp(info, year), source: 'typical', label: 'Rough typical sticker for this model and year; no official price on file yet. Change it if you know the real one.' };
}
