// The card back on a page: the live card where the browser can draw it, and a still of the same foil where it
// cannot (no WebGL, a file that would not load, a context that was lost for good). The card is decoration, not
// data, so a failure is never shown as an error: the still simply takes its place. The still also holds the card's
// place while the live card's files are on their way, so a slow connection shows a card, not an empty view.
import { useEffect, useRef, useState } from 'react';
import { createHoloCard, webglAvailable } from '@micar/holo';
import type { FoilId, HoloCard as LiveCard } from '@micar/holo';
import { CARD_ART, CARD_MODEL, stillOf } from './back';

const reducedMotion = (): boolean => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

type Props = {
  foil: FoilId;
  /** What the card is, for someone who cannot see it. */
  label: string;
  /** 'capture' where nothing scrolls behind the card; 'scroll' (the default) inside a page that scrolls. */
  touch?: 'capture' | 'scroll';
  /** How to move the card. Shown only while it can be moved: not under a still, and not with motion reduced. */
  hint?: string;
};

export function HoloCard({ foil, label, touch = 'scroll', hint }: Props) {
  const stage = useRef<HTMLDivElement | null>(null);
  const live = useRef<LiveCard | null>(null);
  const wanted = useRef(foil);
  const [still, setStill] = useState(() => !webglAvailable());
  const [drawn, setDrawn] = useState(false);
  const [flat] = useState(reducedMotion);
  const [missing, setMissing] = useState<FoilId | null>(null);

  useEffect(() => {
    const holder = stage.current;
    if (still || !holder) return;
    // A canvas of its own for every mount. The card hands its WebGL context back when it is destroyed, and a canvas
    // whose context is gone cannot be given another, so React must not be the one to keep and reuse it.
    const canvas = document.createElement('canvas');
    holder.append(canvas);
    const card = createHoloCard({
      canvas, meshUrl: CARD_MODEL, artUrls: CARD_ART, foil: wanted.current, touch, reducedMotion: flat,
      onError: (error) => { console.warn(`MiCar card back: ${error.message}`); setStill(true); },
    });
    live.current = card;
    // ready rejects when the card fails (onError has shown the still) or is destroyed first: nothing more to do.
    card.ready.then(() => { if (live.current === card) setDrawn(true); }, () => {});
    return () => {
      live.current = null;
      card.destroy();
      canvas.remove();
      setDrawn(false);
    };
  }, [still, touch, flat]);

  useEffect(() => {
    wanted.current = foil;
    live.current?.setFoil(foil);
  }, [foil]);

  return (
    <div className="gar-holo-wrap">
      <div className="gar-holo-room">
        <div className="gar-holo" ref={stage} role="img" aria-label={label}>
          {(still || !drawn) && missing !== foil && <img src={stillOf(foil)} alt="" width={720} height={960} draggable={false} onError={() => setMissing(foil)} />}
        </div>
      </div>
      {hint && drawn && !still && !flat && <p className="gar-hint">{hint}</p>}
    </div>
  );
}
