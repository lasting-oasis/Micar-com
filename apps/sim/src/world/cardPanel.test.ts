import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardStats } from './CardStatsPanel';

// The suite takes .test.ts files only, so the panel is rendered without JSX.
const html = (car: { year?: number; make?: string; model?: string; bodyStyle?: string }) => renderToStaticMarkup(createElement(CardStats, { car }));

describe('the card panel on an owned car', () => {
  it('calls a real model’s figures factory figures', () => {
    const out = html({ year: 2019, make: 'Toyota', model: 'Camry', bodyStyle: 'sedan' });
    expect(out).toContain('factory stats');
    expect(out).toContain('Factory figures for the model');
    expect(out).not.toContain('data-card-stand-in');
  });

  it('says so when the figures are a body-style stand-in, not data about the model', () => {
    // A junkyard shell has no row of its own in the car table.
    const out = html({ year: 2004, make: 'Scrap', model: 'Scrap Shell', bodyStyle: 'truck' });
    expect(out).toContain('data-card-stand-in="true"');
    expect(out).toContain('body-style stand-in');
    expect(out).toContain('They are not data about this model');
    expect(out).not.toContain('Factory figures for the model');
    expect(out).not.toContain('factory stats');
  });

  it('uses plain rows, never the twelve-column bars the Strip’s smoke test counts', () => {
    expect(html({ make: 'Toyota', model: 'Camry', bodyStyle: 'sedan' })).not.toContain('grid-cols-12');
  });
});
