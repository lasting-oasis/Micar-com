// The options the Garage's Options menu sets (Night Tuner's SAVE.opts): transmission, speed
// units, chase camera, sound, touch controls and the cars' own 3D models (off: every car on its lofted body; until the
// player chooses, Auto: off for now, see AUTO_DETAILED_ON_HIGH). One localStorage key; every read and write is in a try/catch, so a
// blocked or missing storage leaves the defaults (and the choices for this page only). The 3D view
// reads getOptions() each frame; the Garage reads and writes through getOption / setOption.

export type CamMode = 0 | 1 | 2;
/** touch controls on a phone: the steering and gas sticks, or the old buttons */
export type TouchControls = 'sticks' | 'buttons';
/** `models`: the player's choice in the Garage, or null (no choice yet: Auto, see carModelsOn). */
export type DriveOptions = { manual: boolean; units: 'mph' | 'kmh'; cam: CamMode; mute: boolean; controls: TouchControls; models: boolean | null };

export const OPTIONS_KEY = 'micar.driveOptions';
/** Saved with the options since Car models follows Graphics: before it, every save wrote models: true (the default then),
 *  so a stored true without it was not necessarily the player's choice. */
const OPTIONS_VER = 2;
export const OPTION_DEFAULTS: Readonly<DriveOptions> = { manual: false, units: 'mph', cam: 0, mute: false, controls: 'sticks', models: null };
/** What Auto (no choice in the Garage) gives on High graphics. False for now (the owner's decision): until the fixed car
 *  models are in, Auto gives every car its lighter built-in body on every Graphics setting, and a player who wants the
 *  models picks Detailed. Set it back to true once they are in: Auto then follows the Graphics quality setting again
 *  (the models on High, the built-in bodies on Low), and the Garage's description says so (garage.ts, modelsDesc). */
export const AUTO_DETAILED_ON_HIGH = false;
/** Whether the cars show their own 3D models: the player's choice; else (Auto) only on High graphics, and only while
 *  `autoOnHigh` (AUTO_DETAILED_ON_HIGH; the tests pass both). */
export const carModelsOn = (o: Pick<DriveOptions, 'models'>, graphics: 'high' | 'low', autoOnHigh = AUTO_DETAILED_ON_HIGH) =>
  o.models ?? (autoOnHigh && graphics !== 'low');

const storage = (): Storage | null => {
  try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; }
};

/** Parse a stored value: anything missing or of the wrong kind is the default. */
export function parseOptions(raw: string | null | undefined): DriveOptions {
  const o: DriveOptions = { ...OPTION_DEFAULTS };
  if (!raw) return o;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return o; }
  if (!v || typeof v !== 'object') return o;
  const s = v as Record<string, unknown>;
  if (typeof s.manual === 'boolean') o.manual = s.manual;
  if (s.units === 'mph' || s.units === 'kmh') o.units = s.units;
  if (s.cam === 0 || s.cam === 1 || s.cam === 2) o.cam = s.cam;
  if (typeof s.mute === 'boolean') o.mute = s.mute;
  if (s.controls === 'sticks' || s.controls === 'buttons') o.controls = s.controls;
  // (saved before the Graphics rule: false was a choice; true may be the old default, so it follows Graphics)
  if (typeof s.models === 'boolean' && (s.ver === OPTIONS_VER || s.models === false)) o.models = s.models;
  return o;
}

let cur: DriveOptions | null = null;

export function getOptions(): Readonly<DriveOptions> {
  if (!cur) { let raw: string | null = null; try { raw = storage()?.getItem(OPTIONS_KEY) ?? null; } catch { /* blocked */ } cur = parseOptions(raw); }
  return cur;
}

export function getOption(k: string): unknown { return (getOptions() as Record<string, unknown>)[k]; }

/** Set one option (ignored when the key or value is not one of the options) and save them all. */
export function setOption(k: string, v: unknown): void {
  const next = parseOptions(JSON.stringify({ ...getOptions(), [k]: v, ver: OPTIONS_VER }));
  if (!(k in next) || (next as Record<string, unknown>)[k] !== v) return;
  cur = next;
  try { storage()?.setItem(OPTIONS_KEY, JSON.stringify({ ...next, ver: OPTIONS_VER })); } catch { /* storage blocked: kept for this page */ }
}

/** Tests: forget the cached copy so the next read goes to storage. */
export function resetOptionsCache(): void { cur = null; }
