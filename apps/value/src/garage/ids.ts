// Randomness for the Garage. The engine never makes its own: it asks the caller for bytes, so every result it gives
// can be reproduced. This is where the page supplies them, for MiCar IDs and for the ids of entries, files and snapshots.
import { idFromBytes } from '@micar/engine';

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

/** A fresh Garage ID for this device: what a buyer gives a seller to receive a car, until accounts exist. */
export const newOwnerId = (): string => `G-${idFromBytes(randomBytes(8))}`;

const two = (n: number) => String(n).padStart(2, '0');

/**
 * The device's wall clock as an ISO timestamp. It is written with a Z but it is local time, on purpose: the
 * passport's days are the days on the owner's calendar, so an entry dated "today" is never refused as being in
 * the future because the owner lives ahead of UTC.
 */
export function stamp(d: Date = new Date()): string {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.000Z`;
}
/** Today on the owner's calendar, YYYY-MM-DD. */
export const today = (d: Date = new Date()): string => stamp(d).slice(0, 10);
