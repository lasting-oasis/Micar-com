// The value block's warning for a branded title, read from its markup (no browser: the look is checked by hand).
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Prices } from './App';
import { BRANDED_NOTES } from './engine/data';
import { valuate } from './engine/valuation';
import { setLang } from './i18n';
import { defaults, parse } from './urlState';

const now = new Date('2026-11-14T12:00:00Z');
/** The markup with React's escapes undone, so a sentence with an apostrophe can be looked for as written. */
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const val = (title: string) => valuate(parse({ ...defaults(now), make: 'Honda', model: 'Civic', year: '2019', msrp: '20250', mileage: '60000', title }, now).inputs!, now);

afterEach(() => setLang('en', false));

describe('the value of a car with a branded title', () => {
  it('says it is a rule of thumb for a rebuilt or salvage title, and says nothing for a clean one', () => {
    for (const title of ['Rebuilt', 'Salvage']) {
      const html = renderToStaticMarkup(<Prices val={val(title)} title={title} />);
      expect(html, title).toContain('role="note"');
      expect(text(html), title).toContain(BRANDED_NOTES[title]);
    }
    expect(renderToStaticMarkup(<Prices val={val('Clean')} title="Clean" />)).not.toContain('role="note"');
    expect(renderToStaticMarkup(<Prices val={val('Clean')} />)).not.toContain('role="note"');
    // a title that is no option (an old or hand-made link) gets no warning and no error
    expect(renderToStaticMarkup(<Prices val={val('Clean')} title="constructor" />)).not.toContain('role="note"');
  });

  it('says it in Spanish on a Spanish page', () => {
    setLang('es', false);
    expect(renderToStaticMarkup(<Prices val={val('Salvage')} title="Salvage" />)).toContain('Los autos de salvamento suelen venderse por un 40% menos');
  });
});
