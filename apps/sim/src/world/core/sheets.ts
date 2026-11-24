// The researched sheets a world car can drive on. @micar/physics keeps them in src/data/sheets.ts, which its package
// exports do not reach (index.ts leaves data/ to "its own path"), so they are read here by that path, in this one
// place. When the package exports sheetById, this becomes `import { sheetById } from '@micar/physics'`.
import type { PhysicsSheet } from '@micar/physics';
import { sheetById } from '../../../../../packages/physics/src/data/sheets';

type Lookup = (id: string) => PhysicsSheet | null;
let lookup: Lookup = sheetById;

/** The researched sheet filed under this id, or null when none is on file. */
export function researchedSheet(id: string): PhysicsSheet | null {
  return lookup(id);
}

/** Tests: read researched sheets from another source (null puts the package's own back). */
export function useResearchedSheets(next: Lookup | null): void {
  lookup = next ?? sheetById;
}
