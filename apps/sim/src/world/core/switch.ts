// The switch between the two driving models (packages/physics DESIGN.md section 13). The old model (world/physics.ts)
// stays the default. `?physics=core` in the address, or "Driving: New (beta)" in the Garage's Options, puts the next
// car the player gets into on the new physics core; `?physics=classic` keeps the old one whatever is stored.
//
// The stored choice lives under its own localStorage key, not inside the drive options' object, so the options' saved
// shape (and everything that reads it) is exactly what it was with the switch off. This file imports nothing from the
// physics core, so reading the switch costs the old path nothing.

/** The two driving models: the old one (world/physics.ts) and the new physics core (@micar/physics). */
export type DrivingMode = 'classic' | 'core';

/** The Garage's Options row and the getOption/setOption key that read and write the switch. */
export const DRIVING_OPTION = 'physics';
/** The localStorage key the Garage's choice is kept under (per device, never sent to the server). */
export const DRIVING_KEY = 'micar.physics';
/** The values the Options row cycles through, the old model first because it is the default. */
export const DRIVING_MODES: readonly DrivingMode[] = ['classic', 'core'];

const storage = (): Storage | null => {
  try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; }
};

// The choice as last read or made in this page (the scene asks every frame; storage is read once). When storage is
// blocked the choice still holds for the page.
let held: DrivingMode | null = null;

/** What the address asks for: 'core' for ?physics=core, 'classic' for ?physics=classic, null when it says nothing. */
export function modeInAddress(search: string): DrivingMode | null {
  const m = /[?&]physics=(core|classic)(&|$)/.exec(search || '');
  return m ? (m[1] as DrivingMode) : null;
}

/** The choice stored by the Garage's Options: 'classic' when none is stored or the stored value is not a mode. */
export function storedMode(): DrivingMode {
  if (held !== null) return held;
  let raw: string | null = null;
  try { raw = storage()?.getItem(DRIVING_KEY) ?? null; } catch { /* blocked: the default */ }
  held = raw === 'core' ? 'core' : 'classic';
  return held;
}

/** Store the Garage's choice. Anything that is not one of the two modes is ignored. */
export function setStoredMode(v: unknown): void {
  if (v !== 'core' && v !== 'classic') return;
  held = v;
  try { storage()?.setItem(DRIVING_KEY, v); } catch { /* storage blocked: kept for this page */ }
}

/** The driving model to use: the address wins when it names one, else the Garage's stored choice. */
export function drivingMode(search: string = currentSearch()): DrivingMode {
  return modeInAddress(search) ?? storedMode();
}

/** True when the next car driven goes on the physics core. */
export function coreChosen(search: string = currentSearch()): boolean {
  return drivingMode(search) === 'core';
}

/** The assist preset the address asks for (?assists=casual|standard|pure), or null for the default (Standard). */
export function assistsInAddress(search: string = currentSearch()): 'casual' | 'standard' | 'pure' | null {
  const m = /[?&]assists=(casual|standard|pure)(&|$)/.exec(search || '');
  return m ? (m[1] as 'casual' | 'standard' | 'pure') : null;
}

/** Tests: forget the page's own choice, so the next read goes to storage. */
export function resetDrivingMode(): void { held = null; }

function currentSearch(): string {
  try { return (globalThis as { location?: { search?: string } }).location?.search ?? ''; } catch { return ''; }
}
