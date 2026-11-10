// The vehicle database: the reference catalogue (real vehicles, each figure with the source it was gathered from)
// and the example vehicles (placeholders for demonstration). The two are kept apart and labelled differently, so a
// placeholder can never be mistaken for data about a real car.
import { CATALOGUE_DATA } from './data/catalogue';
import { EXAMPLE_DATA } from './data/examples';
import type { CatalogueEntry, ExampleVehicle } from './types';

/** Real vehicles gathered from public sources. Reference data: not checked against a primary document. */
export const CATALOGUE: readonly CatalogueEntry[] = CATALOGUE_DATA;
/** The brief's two specimens. Illustrative values, never data about a real car. */
export const EXAMPLES: readonly ExampleVehicle[] = EXAMPLE_DATA;

const MAKE_ALIASES: Record<string, string> = { chevy: 'chevrolet', vw: 'volkswagen', mercedes: 'mercedesbenz' };
const plain = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const plainMake = (s: string): string => MAKE_ALIASES[plain(s)] ?? plain(s);

export function catalogueEntry(id: string): CatalogueEntry | null {
  return CATALOGUE.filter((e) => e.id === id)[0] ?? null;
}

/**
 * Looks vehicles up in the catalogue. Make and model are compared without case or punctuation ("gt-r" finds "GT-R",
 * "Chevy" finds Chevrolet); a trim matches when the entry's trim contains it. Newest first, then by trim.
 */
export function findCatalogue(query: { year?: number; make?: string; model?: string; trim?: string }): CatalogueEntry[] {
  const make = query.make ? plainMake(query.make) : null;
  const model = query.model ? plain(query.model) : null;
  const trim = query.trim ? plain(query.trim) : null;
  return CATALOGUE.filter((e) => {
    const id = e.spec.identity;
    if (query.year !== undefined && id.year !== query.year) return false;
    if (make !== null && plainMake(id.make) !== make) return false;
    if (model !== null && plain(id.model) !== model) return false;
    if (trim !== null && plain(id.trim).indexOf(trim) === -1) return false;
    return true;
  }).slice().sort((a, b) => b.spec.identity.year - a.spec.identity.year || (a.spec.identity.trim < b.spec.identity.trim ? -1 : a.spec.identity.trim > b.spec.identity.trim ? 1 : 0));
}
