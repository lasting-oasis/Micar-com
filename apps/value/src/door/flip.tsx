// How a card turns over. Every card on the site has a back, so every card turns:
//   'tap'     a tap anywhere on the card turns it. If the page passes onFlip the page keeps the state; if not, the
//             card keeps its own. The default.
//   'corner'  the card's tap already means something (the bay's showcase opens the inspect view), so a small
//             button on its corner turns it. The card keeps its own state.
//   'page'    the page turns it and draws its own button (a Garage tile is a link, and a button may not sit inside
//             a link). The card only obeys `flipped`.
import { useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { t } from '../i18n';

export type Turn = 'tap' | 'corner' | 'page';

export function useFlip(flipped: boolean, onFlip: (() => void) | undefined, turn: Turn) {
  const [own, setOwn] = useState(false);
  const held = onFlip !== undefined || turn === 'page';
  return {
    isFlipped: held ? flipped : own,
    toggle: onFlip ?? (() => setOwn((f) => !f)),
    /** The whole card is the button. */
    tap: turn === 'tap',
  };
}

const ARROWS = (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9a8 8 0 0 1 14-3l2 2M20 4v4h-4M20 15a8 8 0 0 1-14 3l-2-2M4 20v-4h4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/** The mark on a card's corner that says it turns over. With onFlip it is the button that turns it. */
export function FlipCue({ flipped, onFlip }: { flipped: boolean; onFlip?: () => void }) {
  if (!onFlip) return <span className="flip-cue" aria-hidden="true">{ARROWS}</span>;
  // The card may sit inside something that has its own click and its own Enter: neither is to hear this one.
  const click = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); onFlip(); };
  const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); };
  return <button type="button" className="flip-cue" aria-label={t('Turn the card over')} aria-pressed={flipped} onClick={click} onKeyDown={key}>{ARROWS}</button>;
}
