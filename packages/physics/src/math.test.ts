import { describe, expect, it } from 'vitest';
import { curveAt, datan, datan2, dcos, dexp, dln, dpow, dsin, hashNumber, HASH_START, hermite, rng, tableAt } from './math';

describe('deterministic arithmetic', () => {
  it('sine and cosine agree with the library to 1e-12 over a wide range', () => {
    for (let x = -40; x <= 40; x += 0.0137) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-12);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-12);
    }
  });
  it('arctangent agrees to 1e-9, in every quadrant', () => {
    for (let x = -50; x <= 50; x += 0.0113) expect(Math.abs(datan(x) - Math.atan(x))).toBeLessThan(1e-9);
    for (let a = -3.1; a <= 3.1; a += 0.05) expect(Math.abs(datan2(Math.sin(a) * 3, Math.cos(a) * 3) - a)).toBeLessThan(1e-9);
    expect(datan2(0, 0)).toBe(0);
  });
  it('exponential, logarithm and power agree to a part in 1e11', () => {
    for (let x = -20; x <= 20; x += 0.173) expect(Math.abs(dexp(x) / Math.exp(x) - 1)).toBeLessThan(1e-11);
    for (let x = 0.001; x <= 5000; x *= 1.37) expect(Math.abs(dln(x) - Math.log(x))).toBeLessThan(1e-11);
    for (let x = 1; x <= 4; x += 0.1) expect(Math.abs(dpow(x, 0.286) / Math.pow(x, 0.286) - 1)).toBeLessThan(1e-11);
    expect(dpow(0, 2)).toBe(0);
  });
  it('tables and curves read straight lines between points and hold flat past the ends', () => {
    const t = new Float64Array([0, 10, 30]);
    expect(tableAt(t, 2, -1)).toBe(0); expect(tableAt(t, 2, 1)).toBe(5); expect(tableAt(t, 2, 3)).toBe(20); expect(tableAt(t, 2, 99)).toBe(30);
    expect(curveAt([[1, 2], [3, 6]], 2)).toBe(4); expect(curveAt([[1, 2], [3, 6]], 0)).toBe(2); expect(curveAt([[1, 2], [3, 6]], 9)).toBe(6);
  });
  it('a Hermite cubic passes through its ends with the slopes given', () => {
    expect(hermite(0, 1, 2, 4, 5, -1, 0)).toBe(1); expect(hermite(0, 1, 2, 4, 5, -1, 4)).toBe(5);
    const e = 1e-6; expect((hermite(0, 1, 2, 4, 5, -1, e) - 1) / e).toBeCloseTo(2, 4);
  });
  it('the random source repeats for a seed and the hash tells states apart', () => {
    const a = rng(7), b = rng(7); for (let i = 0; i < 5; i++) expect(a()).toBe(b());
    expect(hashNumber(HASH_START, 1.5)).not.toBe(hashNumber(HASH_START, 1.5000000000000002));
    expect(hashNumber(HASH_START, 0)).toBe(hashNumber(HASH_START, -0));
  });
  it('the hash folds a number\'s bytes in one fixed order on every host, and every NaN alike', () => {
    // FNV-1a over the IEEE 754 bytes, least significant first, written out by hand: no typed array of the host's
    // byte order is involved, so this is the value a big-endian machine must give too.
    const fnv = (bytes: number[]): number => { let h = HASH_START; for (const b of bytes) h = Math.imul(h ^ b, 0x01000193); return h >>> 0; };
    expect(hashNumber(HASH_START, 1)).toBe(fnv([0, 0, 0, 0, 0, 0, 0xf0, 0x3f]));                   // 0x3ff0000000000000
    expect(hashNumber(HASH_START, -2.5)).toBe(fnv([0, 0, 0, 0, 0, 0, 0x04, 0xc0]));                // 0xc004000000000000
    expect(hashNumber(HASH_START, 0.1)).toBe(fnv([0x9a, 0x99, 0x99, 0x99, 0x99, 0x99, 0xb9, 0x3f])); // 0x3fb999999999999a
    // A NaN made at run time carries whatever sign and payload the hardware gives it (x86 sets the sign bit, ARM
    // does not): a diverged state must hash the same everywhere, as the quiet NaN 0x7ff8000000000000.
    const zero = Number('0'), inf = Number('Infinity');
    const canonical = fnv([0, 0, 0, 0, 0, 0, 0xf8, 0x7f]);
    for (const nan of [NaN, zero / zero, inf - inf, -NaN, Math.sqrt(-1)]) expect(hashNumber(HASH_START, nan)).toBe(canonical);
  });
  it('the logarithm of infinity is infinity and of NaN is NaN, as the library\'s are, and returns at once', () => {
    expect(dln(Infinity)).toBe(Infinity);
    expect(dln(NaN)).toBeNaN();
    expect(dln(Number.MAX_VALUE)).toBeCloseTo(Math.log(Number.MAX_VALUE), 9);
    expect(dln(Number.MIN_VALUE)).toBeCloseTo(Math.log(Number.MIN_VALUE), 9);
    expect(dpow(Infinity, 0.5)).toBe(Infinity);
  });
});
