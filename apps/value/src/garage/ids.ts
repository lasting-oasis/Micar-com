// Randomness for the Garage. The engine never makes its own: it asks the caller for bytes, so every result it gives
// can be reproduced. This is where the page supplies them, for MiCar IDs and for the ids of entries, files and snapshots.
import { checkCharacter, idFromBytes } from '@micar/engine';

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  try {
    crypto.getRandomValues(out);
    return out;
  } catch { /* no Web Crypto (an old browser, a locked-down frame): fall through */ }
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** A fresh 16-character id for an entry, a file or a snapshot. */
export const newId = (): string => idFromBytes(randomBytes(10));

/** A Garage ID from bytes: G-, thirteen characters, and the engine's check character, so a slipped or swapped character is caught before a car is sent to nobody. */
export function garageIdFromBytes(bytes: ArrayLike<number>): string {
  const body = idFromBytes(Array.from({ length: 8 }, (_, i) => Number(bytes[i]) & 255));
  return `G-${body}${checkCharacter(body)}`;
}

/** A fresh Garage ID for this device: what a buyer gives a seller to receive a car, until accounts exist. */
export const newOwnerId = (): string => garageIdFromBytes(randomBytes(8));

/**
 * What a person typed, as a Garage ID, or null when it is not one. Case, spaces and dashes do not matter, and the
 * usual slips are put right (O for 0, I or L for 1). The check character has to agree, so a wrong or swapped
 * character is refused instead of naming a garage that does not exist.
 */
export function normalizeGarageId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const text = input.toUpperCase().replace(/[\s-]/g, '');
  if (text[0] !== 'G') return null;
  const body = text.slice(1).replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{14}$/.test(body)) return null;
  return checkCharacter(body.slice(0, 13)) === body[13] ? `G-${body}` : null;
}

const two = (n: number) => String(n).padStart(2, '0');

/**
 * The device's wall clock as an ISO timestamp. It is written with a Z but it is local time, on purpose: the
 * passport's days are the days on the owner's calendar, so an entry dated "today" is never refused as being in
 * the future because the owner lives ahead of UTC.
 */
export function stamp(d: Date = new Date()): string {
  // To the millisecond: the passport orders two entries of the same day by when each was written down, and two
  // written within the same second would otherwise fall back to the order of their (random) ids.
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}Z`;
}
/** Today on the owner's calendar, YYYY-MM-DD. */
export const today = (d: Date = new Date()): string => stamp(d).slice(0, 10);
