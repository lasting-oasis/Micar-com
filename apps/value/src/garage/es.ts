// Spanish for the Garage, keyed by the English text in the code like the rest of the site (US Spanish, "usted").
// Each part of the Garage keeps its own table so the parts can be written side by side; this file joins them.
// i18n-es.ts spreads GARAGE_ES into the site's table before its own entries, so a phrase the site already
// translates keeps that translation. garage/es.test.ts fails if two tables disagree about the same phrase.
import { ES_CARD } from './es-card';
import { ES_ENGINE } from './es-engine';
import { ES_GARAGE } from './es-garage';
import { ES_PANELS } from './es-panels';

export const GARAGE_PARTS: Record<string, Record<string, string>> = {
  card: ES_CARD,
  garage: ES_GARAGE,
  panels: ES_PANELS,
  engine: ES_ENGINE,
};

export const GARAGE_ES: Record<string, string> = Object.assign({}, ...Object.values(GARAGE_PARTS));
