// The back face of a card in its case: the MiCar card back, flat, under the foil its rarity earned. One small
// picture and a few CSS layers, so a page can hold dozens of them; the foil's bands, sparkle and glare follow the
// pointer through the --mx and --my the card already keeps (door/Slab.tsx, useLive). The live 3D card, lit and
// tilted for real, is the inspect view (CardBack.tsx). A card with no rarity yet (the home page's) gets no name
// under the picture and wears the plain gloss back. The picture is not lazy-loaded: it sits on a face turned away
// from the reader, and iPhone Safari never fetched it there.
import { FOIL_LABELS } from '@micar/holo';
import type { FoilId } from '@micar/holo';
import { t } from '../i18n';
import { CARD_FACE, CARD_FACE_AVIF } from './back';

type Props = {
  foil: FoilId;
  /** The rarity that earned the foil, already in the reader's language. */
  rarity?: string;
};

export function BackFace({ foil, rarity }: Props) {
  return (
    <div className={`art cb cb-${foil}`}>
      <div className="cb-card">
        <picture>
          <source srcSet={CARD_FACE_AVIF} type="image/avif" />
          <img src={CARD_FACE} alt={t('The MiCar card back')} width={531} height={741} decoding="async" draggable={false} />
        </picture>
        <div className="cb-foil" /><div className="cb-spark" /><div className="cb-glare" />
      </div>
      {rarity && <div className="cb-rar"><b>{rarity}</b><span>{t(FOIL_LABELS[foil])}</span></div>}
    </div>
  );
}
