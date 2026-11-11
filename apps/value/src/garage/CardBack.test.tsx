// What the card back's three components put on the page, read from their markup. Nothing here runs in a browser:
// the live card, the dialog's opening and closing and the focus coming back are the smoke test's
// (e2e/card-back.smoke.mjs). On the server there is no WebGL, so the card is its still: the same path a browser
// without WebGL takes.
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FOIL_IDS, FOIL_LABELS } from '@micar/holo';
import { setLang } from '../i18n';
import { CardBack } from './CardBack';
import CardBacks from './CardBacks';
import { HoloCard } from './HoloCard';

afterEach(() => setLang('en', false));

describe('the card, where it cannot be drawn live', () => {
  it('is the still for its foil, named for someone who cannot see it', () => {
    const html = renderToStaticMarkup(<HoloCard foil="rainbow" label="The back of the card: Epic, Full-spectrum rainbow" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="The back of the card: Epic, Full-spectrum rainbow"');
    expect(html).toMatch(/<img[^>]+src="\/cards\/back-rainbow\.webp"/);
    expect(html).toMatch(/<img[^>]+alt=""/);            // the name is on the wrapper, once
    expect(html).not.toContain('<canvas');
  });

  it('does not tell anyone to drag a picture that cannot move', () => {
    const html = renderToStaticMarkup(<HoloCard foil="holo" label="The back" hint="Drag to tilt the card" />);
    expect(html).not.toContain('Drag to tilt the card');
  });
});

describe('the inspect view', () => {
  const html = renderToStaticMarkup(<CardBack foil="holo" rarity="Rare" title="2019 Mazda MX-5" onClose={() => {}} />);

  it('is a dialog named for the car', () => {
    expect(html).toMatch(/<dialog[^>]+aria-label="Card back: 2019 Mazda MX-5"/);
    expect(html.match(/<dialog/g)).toHaveLength(1);
  });

  it('shows the card, its rarity and its foil in words, and a way out', () => {
    expect(html).toContain('aria-label="The back of the card: Rare, Standard holo"');
    expect(html).toMatch(/<img[^>]+src="\/cards\/back-holo\.webp"/);
    expect(html).toContain('>Rare<');
    expect(html).toContain('>Standard holo<');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Close<\/button>/);
  });

  it('speaks Spanish', () => {
    setLang('es', false);
    const es = renderToStaticMarkup(<CardBack foil="prismatic" rarity="Legendaria" title="Mazda" onClose={() => {}} />);
    expect(es).toContain('aria-label="El reverso de la tarjeta: Legendaria, Prismático refractivo"');
    expect(es).toMatch(/<dialog[^>]+aria-label="Reverso de la tarjeta: Mazda"/);
    expect(es).toMatch(/>Cerrar<\/button>/);
    expect(es).toContain('>Prismático refractivo<');
  });
});

describe('the four-backs page', () => {
  const html = renderToStaticMarkup(<CardBacks />);

  it('shows the four foils in order, each a button that says what it opens', () => {
    const labels = [...html.matchAll(/<button[^>]+aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual(FOIL_IDS.map((foil) => `Show the ${FOIL_LABELS[foil]} back`));
  });

  it('shows each foil\'s still and the rarities that earn it', () => {
    for (const foil of FOIL_IDS) expect(html).toMatch(new RegExp(`<img[^>]+src="/cards/back-${foil}\\.webp"`));
    expect(html).toContain('Common · Uncommon');
    expect(html).toContain('>Rare<');
    expect(html).toContain('>Epic<');
    expect(html).toContain('Legendary · Mythic · One-of-One');
  });

  it('says what the page is, and leads back to the Garage', () => {
    expect(html).toMatch(/<h1[^>]*>Card backs<\/h1>/);
    expect(html).toContain('earned, never sold');
    expect(html).toMatch(/<a[^>]+href="[^"]*#\/garage"/);
  });

  it('opens nothing until a foil is chosen', () => {
    expect(html).not.toContain('<dialog');
  });

  it('speaks Spanish', () => {
    setLang('es', false);
    const es = renderToStaticMarkup(<CardBacks />);
    expect(es).toMatch(/<h1[^>]*>Reversos de la tarjeta<\/h1>/);
    expect(es).toContain('aria-label="Mostrar el reverso: Holográfico estándar"');
    expect(es).toContain('Común · Poco común');
    expect(es).not.toContain('Card backs');
  });
});
