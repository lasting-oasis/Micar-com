// The four backs, on the home page: every card carries the same back, and this shows the four foils it can wear,
// side by side, each with what it is made of and the rarities that earn it. The backs are the flat ones
// (BackFace.tsx), so the foil follows the pointer; the link goes to the page where each can be tilted in 3D.
import { RARITY_LABELS } from '@micar/engine';
import { FOIL_IDS, FOIL_LABELS } from '@micar/holo';
import type { FoilId } from '@micar/holo';
import { garageUrl } from '../car/record';
import { useLive } from '../door/Slab';
import { t } from '../i18n';
import { CARD_BACKS, tiersOf } from './back';
import { BackFace } from './BackFace';

/** What each foil is made of, in plain English: what the renderer and the flat back actually draw. */
export const FOIL_MADE_OF: Record<FoilId, string> = {
  gloss: 'The artwork under a clear gloss coat. No foil: the light slides over it and nothing more.',
  holo: 'Soft bands of colour that slide across the card as it turns, with a light scatter of sparkle.',
  rainbow: 'The whole spectrum, closer and brighter, in two sets of bands that cross, with more sparkle.',
  prismatic: 'Cut facets that bend the art and flash as they turn to the light. The brightest sparkle of the four.',
};

function Tile({ foil, step }: { foil: FoilId; step: number }) {
  const ref = useLive(true);
  return (
    <div className={`foil-tile live foil-${foil}`} ref={ref}>
      <div className="foil-card"><BackFace foil={foil} /></div>
      <small>{t('Back {n} of 4', { n: step })}</small>
      <h3>{t(FOIL_LABELS[foil])}</h3>
      <p>{t(FOIL_MADE_OF[foil])}</p>
      <ul aria-label={t('Earned by')}>{tiersOf(foil).map((tier) => <li key={tier} className={`rar-${tier}`}>{t(RARITY_LABELS[tier])}</li>)}</ul>
    </div>
  );
}

export function FoilShelf() {
  return (
    <section className="sec gutter foils" id="backs"><div className="inner">
      <h2 className="painted big">{t('Four backs. Earned, never sold.')}</h2>
      <p className="lede">{t("Every MiCar card carries the same back. The foil on it follows the card's rarity, and the rarity is worked out from the car: nothing here is for sale.")}</p>
      <div className="foil-shelf">{FOIL_IDS.map((foil, i) => <Tile key={foil} foil={foil} step={i + 1} />)}</div>
      <p className="foil-more"><a className="ghostbtn" href={garageUrl(CARD_BACKS)}>{t('Tilt them in 3D')}</a></p>
    </div></section>
  );
}
