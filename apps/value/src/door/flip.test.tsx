// Every card on the site turns over to its back. A card nobody else turns keeps its own state and turns on a tap;
// a card whose tap already means something (the bay's showcase opens the inspect view, a Garage tile opens the
// car) gets a corner button instead. Read from markup; the turning itself is e2e/every-card.smoke.mjs.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLES, exampleCard } from '@micar/engine';
import { CollectibleCard } from '../garage/CollectibleCard';
import { FlipCue } from './flip';
import { sampleCard } from './card';
import { Slab } from './Slab';

const slab = sampleCard(new Date('2026-11-11T12:00:00Z'))!;
const car = exampleCard(EXAMPLES[0], '2026-11-11');
const root = (html: string): string => html.slice(0, html.indexOf('>') + 1);

describe.each([
  ['the home page card', (p: object) => <Slab card={slab} {...p} />],
  ['the Garage card', (p: object) => <CollectibleCard card={car} {...p} />],
])('%s', (_name, make) => {
  it('turns on a tap when nobody else turns it, and says so', () => {
    const html = renderToStaticMarkup(make({ mini: true }));
    expect(root(html)).toContain('role="button"');
    expect(html).toMatch(/<span class="flip-cue" aria-hidden="true">/);
    expect(html).toContain('sl-face back');
    expect(html).toContain('class="art cb cb-');
  });

  it('gets a corner button where its tap is already taken', () => {
    const html = renderToStaticMarkup(make({ turn: 'corner' }));
    expect(root(html)).not.toContain('role="button"');
    expect(html).toMatch(/<button type="button" class="flip-cue" aria-label="Turn the card over" aria-pressed="false">/);
  });

  it('is turned by the page when the page says so', () => {
    const html = renderToStaticMarkup(make({ turn: 'page', flipped: true }));
    expect(root(html)).toContain('flipped');
    expect(root(html)).not.toContain('role="button"');
    expect(html).not.toContain('flip-cue');
  });

  it('still obeys a page that turns it by tap', () => {
    const html = renderToStaticMarkup(make({ flipped: true, onFlip: () => {} }));
    expect(root(html)).toContain('flipped');
    expect(root(html)).toContain('role="button"');
  });
});

describe('the corner button on its own', () => {
  it('says which way the card is', () => {
    expect(renderToStaticMarkup(<FlipCue flipped onFlip={() => {}} />)).toContain('aria-pressed="true"');
  });
});
