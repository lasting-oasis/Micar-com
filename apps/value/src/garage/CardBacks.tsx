// The four backs: every card carries the same artwork on its back, and this page shows the four foils it can wear,
// side by side, each opening the inspect view. Nothing links here yet (#/garage/card-backs).
import { useState } from 'react';
import { RARITY_LABELS } from '@micar/engine';
import { FOIL_IDS, FOIL_LABELS } from '@micar/holo';
import type { FoilId } from '@micar/holo';
import { garageUrl } from '../car/record';
import { t } from '../i18n';
import { stillOf, tiersOf } from './back';
import { CardBack } from './CardBack';

/** The rarities that earn a foil, in words: "Legendary · Mythic · One-of-One". */
const earnedBy = (foil: FoilId): string => tiersOf(foil).map((tier) => t(RARITY_LABELS[tier])).join(' · ');

export default function CardBacks() {
  const [open, setOpen] = useState<FoilId | null>(null);
  return (
    <>
      <p><a className="gar-back-link" href={garageUrl()}>← {t('The Garage')}</a></p>
      <header className="gar-head">
        <h1>{t('Card backs')}</h1>
        <p className="lede">{t("Every card carries the same back. Its foil follows the card's rarity: earned, never sold.")}</p>
      </header>
      <div className="gar-backs">
        {FOIL_IDS.map((foil) => (
          <button type="button" key={foil} className="gar-backtile" aria-label={t('Show the {foil} back', { foil: t(FOIL_LABELS[foil]) })} onClick={() => setOpen(foil)}>
            <img src={stillOf(foil)} alt="" width={720} height={960} loading="lazy" draggable={false} />
            <b>{t(FOIL_LABELS[foil])}</b>
            <small>{earnedBy(foil)}</small>
          </button>
        ))}
      </div>
      {open && <CardBack key={open} foil={open} rarity={earnedBy(open)} title={t(FOIL_LABELS[open])} onClose={() => setOpen(null)} />}
    </>
  );
}
