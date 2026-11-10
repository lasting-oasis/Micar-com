// The example cards: the two specimens from the brief (placeholder values, stamped as such) and, below them,
// the reference catalogue as house cards. Nothing here belongs to anyone: it shows what a card is.
import { useState } from 'react';
import { ATTRIBUTE_KEYS, illustrativeLayer } from '@micar/engine';
import type { Attributes, CollectibleCard as CardData, VehicleIdentity } from '@micar/engine';
import { t } from '../i18n';
import { CollectibleCard } from './CollectibleCard';

// Stand-in until the engine's card generator lands: builds the brief's two example cards by hand.
function example(micarId: string, identity: VehicleIdentity, attributes: Attributes): CardData {
  const layer = illustrativeLayer(attributes);
  return {
    micarId, serial: `${micarId} · E1`, identity, title: `${identity.year} ${identity.make} ${identity.model}`, subtitle: identity.trim, color: '',
    photoAttachmentId: null, powerRating: layer.powerRating, provisionalRating: layer.provisionalRating,
    attributes: ATTRIBUTE_KEYS.map((key) => ({ key, value: layer.scores[key].value, base: layer.scores[key].value, delta: 0, basis: 'illustrative' })),
    statsBasis: 'base', level: 'registered', grade: { overall: 0, grade10: 1, tier: 1, tierName: 'Parts', slabbed: false },
    rarity: { tier: 'common', score: 0, factors: [] }, edition: { number: 1, name: 'Registration Edition', issuedAt: '2026-11-10T00:00:00.000Z' },
    mods: [], finish: 'raw', foil: 0, quality: 'illustrative', illustrative: true, ruleset: 'micar-rules-v1',
  };
}

const EXAMPLES: CardData[] = [
  example('MC-EXAM-PLE0-0001', { year: 2024, make: 'Nissan', model: 'GT-R', trim: 'NISMO', bodyClass: 'sports' }, { power: 950, speed: 920, acceleration: 880, handling: 880, durability: 650, reliability: 700, efficiency: 500 }),
  example('MC-EXAM-PLE0-0002', { year: 2024, make: 'Honda', model: 'Civic', trim: 'Sedan LX', bodyClass: 'sedan' }, { power: 400, speed: 570, acceleration: 370, handling: 560, durability: 640, reliability: 860, efficiency: 720 }),
];

export function Examples() {
  const [flipped, setFlipped] = useState<string | null>(null);
  return (
    <section className="gar-sec" aria-labelledby="gar-examples">
      <h2 id="gar-examples">{t('Example cards')}</h2>
      <p>{t('Two specimens to show what a card carries. Their numbers are illustrative placeholders, not verified manufacturer data.')}</p>
      <div className="gar-grid">
        {EXAMPLES.map((c) => (
          <div className="gar-cell" key={c.micarId}>
            <CollectibleCard card={c} live flipped={flipped === c.micarId} onFlip={() => setFlipped(flipped === c.micarId ? null : c.micarId)} />
            <p className="gar-cap">{c.title}<small>{c.subtitle}</small></p>
          </div>
        ))}
      </div>
    </section>
  );
}
