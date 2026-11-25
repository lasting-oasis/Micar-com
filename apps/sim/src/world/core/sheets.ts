// The researched sheets a world car can drive on: @micar/physics's SHEETS (generated from its data/research records)
// and its sheetById, behind one switchable look-up so that a test can put its own records in their place.
import type { PhysicsSheet } from '@micar/physics';
import { SHEETS, sheetById } from '@micar/physics';

type Lookup = (id: string) => PhysicsSheet | null;
type Listing = () => readonly PhysicsSheet[];
const ownListing: Listing = () => SHEETS;
let lookup: Lookup = sheetById;
let listing: Listing = ownListing;

/** The researched sheet filed under this id, or null when none is on file. */
export function researchedSheet(id: string): PhysicsSheet | null {
  return lookup(id);
}

/** Every researched sheet on file, in the package's order (sorted by id). */
export function researchedSheets(): readonly PhysicsSheet[] {
  return listing();
}

/**
 * Tests: read researched sheets from another source (null puts the package's own back). With a look-up alone, the
 * listing is the package's own sheets that look-up still finds by their id plus nothing else; pass `all` to list
 * exactly the sheets the test files.
 */
export function useResearchedSheets(next: Lookup | null, all?: readonly PhysicsSheet[]): void {
  lookup = next ?? sheetById;
  listing = next === null ? ownListing : all !== undefined ? () => all : () => SHEETS.filter(s => next(s.id) === s);
}
