// Scene lengths come from the voiceover: each scene holds its narration plus a little air.
// Each language has its own voice files, so its own timeline.
import en from '../public/audio/durations.json';
import es from '../public/audio/durations-es.json';

export type Lang = 'en' | 'es';
export const FPS = 30;
export const LEAD = 12; // frames before the voice starts in each scene

const order = ['intro', 'doors', 'pick', 'ledger', 'prices', 'market', 'sheet', 'phone', 'spanish', 'sources'] as const;
export type SceneId = (typeof order)[number];
const tail: Record<SceneId, number> = { intro: 1.4, doors: 1.3, pick: 1.4, ledger: 1.6, prices: 1.4, market: 1.6, sheet: 1.4, phone: 1.5, spanish: 1.8, sources: 2.6 };

export function scenesFor(lang: Lang) {
  const durations = (lang === 'es' ? es : en) as Record<string, number>;
  let from = 0;
  return order.map((id) => {
    const vo = durations[id];
    const frames = Math.round((LEAD / FPS + vo + tail[id]) * FPS);
    const s = { id, from, frames, vo };
    from += frames;
    return s;
  });
}
export const totalFor = (lang: Lang) => scenesFor(lang).reduce((a, s) => a + s.frames, 0);
/** The voice file for a scene in a language. */
export const voFile = (lang: Lang, id: SceneId) => (lang === 'es' ? `vo-es-${id}` : `vo-${id}`);
