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
