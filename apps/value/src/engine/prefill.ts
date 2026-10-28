import { findModel, typicalMsrp } from './models';
import { stickerFor, stickerMsrp } from './stickers';

export type Prefill = { msrp: number; source: 'sticker' | 'typical'; label: string; note?: string };

/** The MSRP to prefill for a make/model/year/trim: a real sticker when we
 * have one, otherwise the rough typical figure scaled to the year. */
export function prefillMsrp(make: string, model: string, year: number, trim: string): Prefill | null {
  const st = stickerFor(make, model, year);
  if (st) {
    const trimName = st.year.trims.find(([n]) => n.toLowerCase() === trim.trim().toLowerCase())?.[0] ?? st.year.trims[0][0];
    return {
      msrp: stickerMsrp(st.year, trimName),
      source: 'sticker',
      label: `Sticker for the ${year} ${model} ${trimName}, from ${st.set.source.split(' (')[0]}. Change it if yours differs.`,
      note: st.year.note,
    };
  }
  const info = findModel(make, model);
  if (!info) return null;
  return { msrp: typicalMsrp(info, year), source: 'typical', label: 'Rough typical sticker for this model and year; no official price on file yet. Change it if you know the real one.' };
}
