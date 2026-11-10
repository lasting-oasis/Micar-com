// The EPA's own record of how each model year was built: displacement, cylinders, transmission, drive, fuel and
// whether it is a hybrid or electric. src/data/epa-configs.json is made from the EPA's vehicle file by
// scripts/build-epa-configs.ts and loaded only when the Garage needs it. When someone parks a car the Garage offers
// these, so the specification can start from a government record instead of from memory, and each figure it fills
// in carries the EPA as its source.
// What the EPA's wording does not settle is left empty for the owner to say: this file never guesses.
import type { Drivetrain, Powertrain, Source, Sourced, TransmissionType, VehicleSpec } from '@micar/engine';

export type EpaFile = { source: string; url: string; asOf: string; configs: (string | number)[][]; models: Record<string, Record<string, number[]>> };
export type EpaConfig = { displacementL: number | null; cylinders: number | null; transmission: string; drive: string; fuel: string; type: string };

let loading: Promise<EpaFile | null> | null = null;

/** Loads the file the first time it is needed. Null when it cannot be loaded; the form then simply offers nothing. */
export function loadEpaFile(): Promise<EpaFile | null> {
  if (!loading) loading = import('../data/epa-configs.json').then((m) => m.default as unknown as EpaFile).catch(() => null);
  return loading;
}

/** The configurations the EPA lists for one model year, in the file's order. Empty when it lists none. */
export function epaConfigsFor(file: EpaFile, make: string, model: string, year: number): EpaConfig[] {
  const list = file.models[`${make}|${model}`]?.[String(year)] ?? [];
  return list.map((i) => file.configs[i]).filter(Boolean).map((c) => ({
    displacementL: Number(c[0]) > 0 ? Number(c[0]) : null,
    cylinders: Number(c[1]) > 0 ? Number(c[1]) : null,
    transmission: String(c[2] ?? ''), drive: String(c[3] ?? ''), fuel: String(c[4] ?? ''), type: String(c[5] ?? ''),
  }));
}

/** One line for a picker, in the EPA's own words: "2.0 L · 4 cyl · Automatic (variable gear ratios) · Front-Wheel Drive · Regular Gasoline". */
export function describeEpaConfig(c: EpaConfig): string {
  return [
    c.displacementL === null ? '' : `${c.displacementL.toFixed(1)} L`,
    c.cylinders === null ? '' : `${c.cylinders} cyl`,
    c.transmission, c.drive, c.fuel, c.type && c.type !== 'EV' && c.type !== 'Diesel' ? c.type : '',
  ].filter(Boolean).join(' · ');
}

/**
 * The transmission type, where the EPA's label settles it. "AM" is an automated manual, which may or may not be a
 * dual-clutch, and a hybrid's "variable gear ratios" may be a belt CVT or a power-split unit: both are left for the
 * owner to say.
 */
export function transmissionTypeOf(c: EpaConfig): TransmissionType | null {
  const label = c.transmission;
  if (/^Manual/.test(label)) return 'manual';
  if (/\(AM/.test(label)) return null;
  if (/variable gear ratios|\(AV/.test(label)) return c.type === 'Hybrid' || c.type === 'Plug-in Hybrid' ? null : 'cvt';
  if (label === 'Automatic (A1)') return c.type === 'EV' ? 'single-speed' : null;
  if (/^Automatic/.test(label)) return 'automatic';
  return null;
}

/** The drivetrain, where the EPA's label settles it. "4-Wheel or All-Wheel Drive" (older model years) does not. */
export function drivetrainOf(c: EpaConfig): Drivetrain | null {
  if (c.drive === 'Front-Wheel Drive') return 'FWD';
  if (c.drive === 'Rear-Wheel Drive') return 'RWD';
  if (c.drive === 'All-Wheel Drive') return 'AWD';
  if (c.drive === '4-Wheel Drive' || c.drive === 'Part-time 4-Wheel Drive') return '4WD';
  return null;
}

/** The powertrain. Fuel-cell, natural-gas and bi-fuel vehicles are outside what the scoring models, so they stay empty. */
export function powertrainOf(c: EpaConfig): Powertrain | null {
  if (c.type === 'EV') return 'electric';
  if (c.type === 'Hybrid') return 'hybrid';
  if (c.type === 'Plug-in Hybrid') return 'plug-in-hybrid';
  if (c.type === 'Diesel' || c.fuel === 'Diesel') return 'diesel';
  if ((c.type === '' || c.type === 'FFV') && /Gasoline$/.test(c.fuel)) return 'gasoline';
  return null;
}

export const epaSource = (file: EpaFile): Source => ({ kind: 'agency', name: file.source, url: file.url, asOf: file.asOf });

export type EpaFields = Partial<Pick<VehicleSpec, 'displacementL' | 'cylinders' | 'transmission' | 'transmissionType' | 'drivetrain' | 'powertrain'>>;

/** The specification fields one EPA configuration fills, each with the EPA as its source. Fields it cannot settle are absent. */
export function epaFields(c: EpaConfig, source: Source): EpaFields {
  const cell = <T>(value: T): Sourced<T> => ({ value, source });
  const out: EpaFields = {};
  if (c.displacementL !== null) out.displacementL = cell(c.displacementL);
  if (c.cylinders !== null) out.cylinders = cell(c.cylinders);
  if (c.transmission) out.transmission = cell(c.transmission);
  const gearbox = transmissionTypeOf(c), drive = drivetrainOf(c), power = powertrainOf(c);
  if (gearbox) out.transmissionType = cell(gearbox);
  if (drive) out.drivetrain = cell(drive);
  if (power) out.powertrain = cell(power);
  return out;
}
