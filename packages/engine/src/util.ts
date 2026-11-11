// Small pure helpers shared by every module. Nothing here reads a clock, a random source or the environment:
// the caller passes the day and the seed, so every result can be reproduced.

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const round1 = (v: number): number => Math.round(v * 10) / 10;
export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A finite number inside [lo, hi], or null. Out-of-range input is refused, not clipped, so a typo never becomes a figure. */
export function numberIn(v: unknown, lo: number, hi: number): number | null {
  return isNumber(v) && v >= lo && v <= hi ? v : null;
}

/**
 * Text from anything: control characters removed, runs of white space made one space, trimmed, and cut to at most
 * `max` characters. Cleaning text that is already clean changes nothing, so a stored text reads back exactly as it
 * was stored: the cut never leaves a trailing space or half of a character behind.
 */
export function clipText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  let clean = '';
  for (const ch of v) {
    const c = ch.charCodeAt(0);
    // A lone half of a surrogate pair is not a character.
    if (ch.length === 1 && c >= 0xd800 && c <= 0xdfff) continue;
    clean += c < 32 || c === 127 ? ' ' : ch;
  }
  clean = clean.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  let out = '';
  for (const ch of clean) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out.trimEnd();
}

/**
 * JSON with every object's keys in sorted order, so the same data gives the same text however it was built.
 * A signature or a fingerprint is taken over this text.
 */
export function canonicalJson(v: unknown): string {
  if (v === null || v === undefined || typeof v === 'function' || typeof v === 'symbol') return 'null';
  if (typeof v === 'bigint') return JSON.stringify(String(v));
  if (typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(o).sort()) if (o[k] !== undefined) parts.push(`${JSON.stringify(k)}:${canonicalJson(o[k])}`);
  return `{${parts.join(',')}}`;
}

/* ------------------------------------------------------------------ scoring ---- */

/** One point of a scoring table: a quantity in its own unit and the score it earns. */
export type Anchor = readonly [x: number, y: number];

/**
 * Reads a scoring table: straight lines between the anchors, flat beyond the first and the last.
 * The anchors are listed by rising x; y may rise (more is better) or fall (less is better, as with seconds).
 */
export function interpolate(x: number, anchors: readonly Anchor[]): number {
  if (anchors.length === 0) return 0;
  if (x <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    if (x <= x1) {
      const [x0, y0] = anchors[i - 1];
      return x1 === x0 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return anchors[anchors.length - 1][1];
}

/** A table read as a whole score from 0 to 1000. */
export const score1000 = (x: number, anchors: readonly Anchor[]): number => Math.round(clamp(interpolate(x, anchors), 0, 1000));

/* --------------------------------------------------------------- fingerprints ---- */

const SHA256_K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** A text as UTF-8 bytes. Written out here because the engine may use nothing but the language itself. */
function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (low - 0xdc00); i += 1; }
    }
    // A surrogate with no partner is written as U+FFFD, the way every UTF-8 encoder writes it.
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/**
 * SHA-256 of a text (as UTF-8), as 64 hex characters. Plain arithmetic, so it gives the same answer in a browser, in
 * Node and anywhere else, and needs nothing from the host. It is what the engine uses when a fingerprint has to hold
 * up against someone trying to find another text with the same one.
 */
export function sha256Text(text: string): string {
  const bytes = utf8Bytes(text);
  const bits = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bits / 4294967296), low = bits >>> 0;
  bytes.push((high >>> 24) & 255, (high >>> 16) & 255, (high >>> 8) & 255, high & 255, (low >>> 24) & 255, (low >>> 16) & 255, (low >>> 8) & 255, low & 255);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w: number[] = [];
  for (let at = 0; at < bytes.length; at += 64) {
    for (let i = 0; i < 16; i++) w[i] = ((bytes[at + 4 * i] << 24) | (bytes[at + 4 * i + 1] << 16) | (bytes[at + 4 * i + 2] << 8) | bytes[at + 4 * i + 3]) >>> 0;
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      k = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + k) >>> 0;
  }
  let out = '';
  for (const word of h) { const hex = word.toString(16); out += '00000000'.slice(hex.length) + hex; }
  return out;
}

/* ------------------------------------------------------------------- chance ---- */

/** FNV-1a, 32 bits: turns any text into a stable seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded generator. The same seed always gives the same run of numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------------------------------------------------------- dates ---- */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day written YYYY-MM-DD. */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = DAY.exec(v);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

const CLOCK = /^T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,3})?Z$/;

/**
 * True for a timestamp in the one form the engine writes and reads: a real day, a real time of day and a Z
 * (2026-11-10T14:03:00.000Z). An offset, a 24:00 or anything after the Z is refused. The fraction of a second may be
 * left out or given to one, two or three places, so two timestamps are put in order by their keys (timestampKey),
 * not as they are written.
 */
export function isIsoTimestamp(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 20 && v.length <= 24 && isIsoDate(v.slice(0, 10)) && CLOCK.test(v.slice(10));
}

/**
 * A timestamp written out to the millisecond, so that keys compare as text the way the times compare. Written as
 * they are, "12:00:00Z" sorts after "12:00:00.500Z": the Z comes after the full stop.
 */
export function timestampKey(timestamp: string): string {
  const dot = timestamp.indexOf('.');
  const digits = dot === -1 ? 0 : timestamp.length - dot - 2;
  return `${timestamp.slice(0, -1)}${dot === -1 ? '.' : ''}${'000'.slice(digits)}Z`;
}

/** The day part of a day or a timestamp. */
export const dayOf = (iso: string): string => iso.slice(0, 10);
/** The month part: YYYY-MM. */
export const monthOf = (iso: string): string => iso.slice(0, 7);

const utc = (day: string): number => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));

/** Whole days from a to b (negative when b is earlier). Both are days or timestamps; only the day part counts. */
export const daysBetween = (a: string, b: string): number => Math.round((utc(dayOf(b)) - utc(dayOf(a))) / 86400000);
/** Whole months from a to b, counted the way a calendar counts them. */
export function monthsBetween(a: string, b: string): number {
  return monthsApart(monthsOf(a), monthsOf(b));
}
/** A day as monthsBetween reads it: a count of months and the day of the month. Worked out once for a day that is compared with many others. */
export type MonthCount = { months: number; day: number };
export function monthsOf(iso: string): MonthCount {
  const d = dayOf(iso);
  return { months: Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)), day: Number(d.slice(8, 10)) };
}
/** Whole months from a to b: the months between them, less one when b's day of the month has not reached a's. */
export const monthsApart = (a: MonthCount, b: MonthCount): number => b.months - a.months - (b.day < a.day ? 1 : 0);
/** Years from a to b as a fraction (365.25-day years). */
export const yearsBetween = (a: string, b: string): number => daysBetween(a, b) / 365.25;

/* ---------------------------------------------------------------------- ids ---- */

/** Crockford's base 32: no I, L, O or U, so an id read aloud or typed from a card is hard to get wrong. */
export const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Multiplication in the field of 32 elements (the polynomial x^5 + x^2 + 1). Every value but 0 has an inverse there, which plain arithmetic modulo 32 does not give. */
function multiply32(a: number, b: number): number {
  let product = 0;
  for (let i = 0; i < 5; i++) {
    if (b & 1) product ^= a;
    b >>= 1;
    a <<= 1;
    if (a & 32) a ^= 0x25;
  }
  return product;
}

/**
 * The check character for a run of base-32 characters (up to thirty): each character's value times its own weight,
 * a different power of 2 in the field of 32 elements, added up there. The weights start at 2, which leaves 1 for
 * the check character itself, so every character of the finished id has a weight no other has. Any one wrong
 * character then fails the check, and so does swapping any two characters that differ, the check character
 * included. Weights that are merely odd numbers modulo 32 catch the first and miss one swap in thirty-two.
 */
export function checkCharacter(body: string): string {
  let sum = 0, weight = 2;
  for (let i = 0; i < body.length; i++) {
    const value = BASE32.indexOf(body[i]);
    sum ^= multiply32(value < 0 ? 0 : value, weight);
    weight = multiply32(weight, 2);
  }
  return BASE32[sum];
}

/** A short id for an event, attachment or snapshot, from bytes the caller supplies (16 characters from 10 bytes). */
export function idFromBytes(bytes: ArrayLike<number>): string {
  let out = '';
  let acc = 0, bits = 0;
  for (let i = 0; i < bytes.length; i++) {
    acc = (acc << 8) | (bytes[i] & 0xff);
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(acc << (5 - bits)) & 31];
  return out;
}
