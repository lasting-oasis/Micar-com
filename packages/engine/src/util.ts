// Small pure helpers shared by every module. Nothing here reads a clock, a random source or the environment:
// the caller passes the day and the seed, so every result can be reproduced.

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const round1 = (v: number): number => Math.round(v * 10) / 10;
export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A finite number inside [lo, hi], or null. Out-of-range input is refused, not clipped, so a typo never becomes a figure. */
export function numberIn(v: unknown, lo: number, hi: number): number | null {
  return isNumber(v) && v >= lo && v <= hi ? v : null;
}

/** Text from anything, trimmed, control characters removed, cut to max characters. */
export function clipText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  let out = '';
  for (const ch of v) {
    const c = ch.charCodeAt(0);
    out += c < 32 || c === 127 ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
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

/** True for a timestamp Date can read that starts with a real day (2026-11-10T14:03:00.000Z). */
export function isIsoTimestamp(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 20 && v.length <= 35 && v[10] === 'T' && isIsoDate(v.slice(0, 10)) && Number.isFinite(Date.parse(v));
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
  const da = dayOf(a), db = dayOf(b);
  let months = (Number(db.slice(0, 4)) - Number(da.slice(0, 4))) * 12 + (Number(db.slice(5, 7)) - Number(da.slice(5, 7)));
  if (Number(db.slice(8, 10)) < Number(da.slice(8, 10))) months -= 1;
  return months;
}
/** Years from a to b as a fraction (365.25-day years). */
export const yearsBetween = (a: string, b: string): number => daysBetween(a, b) / 365.25;

/* ---------------------------------------------------------------------- ids ---- */

/** Crockford's base 32: no I, L, O or U, so an id read aloud or typed from a card is hard to get wrong. */
export const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

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
