// The MiCar ID: a vehicle's own identity on MiCar, written MC-XXXX-XXXX-XXXC.
// It is made from random bytes the host supplies, never from the VIN (a VIN can be guessed and its hash looked up),
// and it stays the same when the vehicle changes hands. The last character is a check (util.checkCharacter), so an
// ID with a wrong character, or with two characters swapped, is caught instead of opening the wrong car. The alphabet has no I, L, O or U, so an ID read aloud is hard to get wrong.
import type { Result } from './types';
import { BASE32, checkCharacter } from './util';

const BODY = /^[0-9A-HJKMNP-TV-Z]{12}$/;

const format = (body: string): string => `MC-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;

/** A MiCar ID from at least seven bytes: the first 55 bits become eleven characters, and a check character follows. */
export function micarIdFromBytes(bytes: ArrayLike<number>): Result<string> {
  if (!bytes || typeof bytes.length !== 'number' || bytes.length < 7) return { ok: false, reason: 'A MiCar ID needs at least seven bytes' };
  const values: number[] = [];
  let acc = 0, bits = 0;
  for (let i = 0; i < 7; i++) {
    const b = Number(bytes[i]);
    if (!Number.isInteger(b) || b < 0 || b > 255) return { ok: false, reason: 'A MiCar ID is made from bytes' };
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5 && values.length < 11) {
      values.push((acc >>> (bits - 5)) & 31);
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  const body = values.map((v) => BASE32[v]).join('');
  return { ok: true, value: format(body + checkCharacter(body)) };
}

/** True for a MiCar ID in its canonical form whose check character is right. */
export function isMicarId(id: string): boolean {
  if (typeof id !== 'string' || id.length !== 17 || id.slice(0, 3) !== 'MC-' || id[7] !== '-' || id[12] !== '-') return false;
  const body = id.slice(3, 7) + id.slice(8, 12) + id.slice(13, 17);
  return BODY.test(body) && checkCharacter(body.slice(0, 11)) === body[11];
}

/**
 * A MiCar ID as someone typed it, put in its canonical form: lower case, missing dashes and the usual misreadings
 * (O for 0, I and L for 1) are forgiven. Null when it is not a MiCar ID or its check character is wrong.
 */
export function normalizeMicarId(input: string): string | null {
  if (typeof input !== 'string') return null;
  const text = input.toUpperCase().replace(/[\s-]+/g, '');
  if (text.length !== 14 || text.slice(0, 2) !== 'MC') return null;
  const body = text.slice(2).replace(/O/g, '0').replace(/[IL]/g, '1');
  const id = format(body);
  return isMicarId(id) ? id : null;
}
