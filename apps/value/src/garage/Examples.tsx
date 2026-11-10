// The example cards: the two specimens from the brief (placeholder values, stamped as such) and, below them,
// the reference catalogue as house cards. Nothing here belongs to anyone: it shows what a card is.
import { useMemo, useState } from 'react';
import { CATALOGUE, EXAMPLES, catalogueCard, exampleCard } from '@micar/engine';
import type { CollectibleCard as CardData } from '@micar/engine';
import { t } from '../i18n';
import { CollectibleCard } from './CollectibleCard';

function Shelf({ cards, flipped, onFlip }: { cards: { key: string; card: CardData; note: string }[]; flipped: string | null; onFlip: (key: string) => void }) {
  return (
    <div className="gar-grid">
      {cards.map(({ key, card, note }) => (
        <div className="gar-cell" key={key}>
          <CollectibleCard card={card} live flipped={flipped === key} onFlip={() => onFlip(key)} />
          <p className="gar-cap">{card.title}<small>{card.subtitle}{note ? ` · ${note}` : ''}</small></p>
        </div>
      ))}
    </div>
  );
}

export function Examples({ today }: { today: string }) {
  const [flipped, setFlipped] = useState<string | null>(null);
  const flip = (key: string) => setFlipped((f) => (f === key ? null : key));
  const examples = useMemo(() => EXAMPLES.map((e) => ({ key: e.id, card: exampleCard(e, today), note: '' })), [today]);
  const house = useMemo(() => CATALOGUE.map((e) => ({ key: e.id, card: catalogueCard(e, today), note: '' })), [today]);
  return (
    <>
      <section className="gar-sec" aria-labelledby="gar-examples">
        <h2 id="gar-examples">{t('Example cards')}</h2>
        <p>{t('Two specimens to show what a card carries. Their numbers are illustrative placeholders, not verified manufacturer data.')}</p>
        <Shelf cards={examples} flipped={flipped} onFlip={flip} />
      </section>
      <section className="gar-sec" aria-labelledby="gar-house">
        <h2 id="gar-house">{t('House cards')}</h2>
        <p>{t('Real vehicles from the reference catalogue, scored by the same rules as yours. Their figures were gathered from public sources and have not been verified; a dash means a figure could not be sourced, so that attribute is not rated.')}</p>
        <Shelf cards={house} flipped={flipped} onFlip={flip} />
      </section>
    </>
  );
}
