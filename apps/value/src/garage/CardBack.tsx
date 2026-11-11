// The inspect view: the back of a card, large, on a dark ground, to tilt under the light. A native modal dialog, so
// the keyboard stays inside it, Escape closes it, and focus goes back to whatever opened it.
import { useEffect, useRef } from 'react';
import { FOIL_LABELS } from '@micar/holo';
import type { FoilId } from '@micar/holo';
import { t } from '../i18n';
import { HoloCard } from './HoloCard';

type Props = {
  foil: FoilId;
  /** The rarity that earned the foil, already in the reader's language. */
  rarity: string;
  /** Whose back this is: the car's name, or the foil's on the four-backs page. */
  title: string;
  onClose: () => void;
};

export function CardBack({ foil, rarity, title, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const el = dialog.current;
    if (!el || el.open) return;
    // A browser too old for modal dialogs still shows it, as an ordinary open one.
    try { el.showModal(); } catch { el.setAttribute('open', ''); }
  }, []);
  const name = t(FOIL_LABELS[foil]);
  return (
    <dialog ref={dialog} className="gar-cardback" aria-label={t('Card back: {title}', { title })} onClose={onClose}>
      <HoloCard foil={foil} touch="capture" label={t('The back of the card: {rarity}, {foil}', { rarity, foil: name })} hint={t('Drag to tilt the card')} />
      <p className="gar-cardback-name"><b>{rarity}</b><span>{name}</span></p>
      <button type="button" className="gar-btn" autoFocus onClick={() => dialog.current?.close()}>{t('Close')}</button>
    </dialog>
  );
}
