// The driving options the Garage's Options menu sets (Night Tuner's SAVE.opts): transmission, speed
// units, chase camera and sound. One localStorage key; every read and write is in a try/catch, so a
// blocked or missing storage leaves the defaults (and the choices for this page only). The 3D view
// reads getOptions() each frame; the Garage reads and writes through getOption / setOption.

export type CamMode = 0 | 1 | 2;
export type DriveOptions = { manual: boolean; units: 'mph' | 'kmh'; cam: CamMode; mute: boolean };

export const OPTIONS_KEY = 'micar.driveOptions';
export const OPTION_DEFAULTS: Readonly<DriveOptions> = { manual: false, units: 'mph', cam: 0, mute: false };

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
  const next = parseOptions(JSON.stringify({ ...getOptions(), [k]: v }));
  if (!(k in next) || (next as Record<string, unknown>)[k] !== v) return;
  cur = next;
  try { storage()?.setItem(OPTIONS_KEY, JSON.stringify(next)); } catch { /* storage blocked: kept for this page */ }
}

/** Tests: forget the cached copy so the next read goes to storage. */
export function resetOptionsCache(): void { cur = null; }
