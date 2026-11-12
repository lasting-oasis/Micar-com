// The home page's four backs: every foil a card back can wear, what each is made of, and the rarities that earn it.
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RARITY_LABELS, RARITY_TIERS } from '@micar/engine';
import { FOIL_IDS, FOIL_LABELS, foilForRarity } from '@micar/holo';
import { setLang } from '../i18n';
import { FOIL_MADE_OF, FoilShelf } from './FoilShelf';

afterEach(() => setLang('en', false));

describe('the four backs on the home page', () => {
  const html = renderToStaticMarkup(<FoilShelf />);

  it('shows all four, each under its own foil, in order', () => {
    const order = [...html.matchAll(/class="art cb cb-([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual([...FOIL_IDS]);
  });

  it.each(FOIL_IDS)('names the %s back and says what it is made of', (foil) => {
    expect(html).toContain(`<h3>${FOIL_LABELS[foil]}</h3>`);
    expect(html).toContain(FOIL_MADE_OF[foil]);
  });

  it('puts every rarity under the foil it earns, and nowhere else', () => {
    const tiles = html.split('class="foil-tile').slice(1);
    expect(tiles).toHaveLength(FOIL_IDS.length);
    for (const tier of RARITY_TIERS) {
      const at = FOIL_IDS.indexOf(foilForRarity(tier));
      tiles.forEach((tile, i) => expect(tile.includes(`>${RARITY_LABELS[tier]}</li>`), `${tier} in tile ${i}`).toBe(i === at));
    }
  });

  it('links to the page where they can be tilted in 3D', () => {
    expect(html).toMatch(/href="[^"]*#\/garage\/card-backs"/);
  });

  it('speaks Spanish', () => {
    setLang('es', false);
    const es = renderToStaticMarkup(<FoilShelf />);
    for (const foil of FOIL_IDS) { expect(es).not.toContain(FOIL_MADE_OF[foil]); expect(es).not.toContain(`<h3>${FOIL_LABELS[foil]}</h3>`); }
  });
});
