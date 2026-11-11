// The back of every card on the site is the MiCar card back: the Garage's cards wear the foil their rarity earned
// and name the rarity; the home page's card, which has no rarity yet, wears the plain gloss back. Read from markup.
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLES, RARITY_LABELS, exampleCard } from '@micar/engine';
import { FOIL_IDS, FOIL_LABELS, foilForRarity } from '@micar/holo';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setLang } from '../i18n';
import { BackFace } from './BackFace';
import { CARD_FACE } from './back';
import { CollectibleCard } from './CollectibleCard';

afterEach(() => setLang('en', false));

const backOf = (html: string): string => html.slice(html.indexOf('sl-face back'));

describe('the back face', () => {
  it.each(FOIL_IDS)('shows the artwork under the %s foil', (foil) => {
    const html = renderToStaticMarkup(<BackFace foil={foil} />);
    expect(html).toMatch(new RegExp(`class="art cb cb-${foil}"`));
    expect(html).toMatch(/<img[^>]+src="\/cards\/back-face\.webp"/);
    expect(html).not.toContain('cb-rar');                // no rarity given, none claimed
  });

  it('names the rarity and its foil when the card has one', () => {
    const html = renderToStaticMarkup(<BackFace foil="rainbow" rarity="Epic" />);
    expect(html).toMatch(/class="cb-rar"><b>Epic<\/b><span>Full-spectrum rainbow<\/span>/);
  });

  it('says the foil in Spanish', () => {
    setLang('es', false);
    const html = renderToStaticMarkup(<BackFace foil="holo" rarity="Raro" />);
    expect(html).not.toContain(FOIL_LABELS.holo);
  });

  it('has its picture in the site', () => {
    expect(CARD_FACE).toBe('/cards/back-face.webp');
    const file = fileURLToPath(new URL('../../public/cards/back-face.webp', import.meta.url));
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file).length).toBeLessThan(150_000);   // every card on a page asks for it
  });
});

describe('a Garage card turned over', () => {
  const card = exampleCard(EXAMPLES[0], '2026-11-11');
  const html = renderToStaticMarkup(<CollectibleCard card={card} />);

  it('is the card back in the foil its rarity earned, with the rarity named', () => {
    const back = backOf(html);
    expect(back).toContain(`cb cb-${foilForRarity(card.rarity.tier)}`);
    expect(back).toContain(`<b>${RARITY_LABELS[card.rarity.tier]}</b>`);
  });

  it('no longer carries the old grade report', () => {
    expect(backOf(html)).not.toContain('grade report');
    expect(html).not.toContain('gar-back"');
  });
});
