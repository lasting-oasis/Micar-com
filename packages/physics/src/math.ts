// Arithmetic that gives the same bits in every browser and on the server.
// JavaScript guarantees that +, -, *, / and Math.sqrt are correctly rounded IEEE 754 operations, so anything built
// from them alone is identical everywhere. The library functions (Math.sin, Math.exp, Math.pow...) carry no such
// promise: engines may differ in the last bit, and one bit is enough to make two machines' cars drift apart.
// So the core never calls them. These stand in for them.

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
/** Standard gravity, m/s^2. */
export const G = 9.80665;
/** Air density at sea level and 15 C, kg/m^3. The core does not model altitude or weather. */
export const RHO_AIR = 1.225;
/** Ambient pressure Pa and temperature K the engine breathes. */
export const P_AMBIENT = 101325;
export const T_AMBIENT = 288.15;

export function clamp(x: number, lo: number, hi: number): number { return x < lo ? lo : x > hi ? hi : x; }
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
export function sq(x: number): number { return x * x; }
/** A smooth sign: x / (|x| + eps). -1 to 1, 0 at 0, with no jump. */
export function soft(x: number, eps: number): number { return x / (Math.abs(x) + eps); }

// pi/2 in two parts, so that x - k * pi/2 keeps its low bits (Cody and Waite).
const PIO2_HI = 1.5707963267341256;
const PIO2_LO = 6.077100506506192e-11;
const INV_PIO2 = 0.6366197723675814;

function sinPoly(r: number): number {
  const z = r * r;
  return r + r * z * (-1.66666666666666324348e-01 + z * (8.33333333332248946124e-03 + z * (-1.98412698298579493134e-04
    + z * (2.75573137070700676789e-06 + z * (-2.50507602534068634195e-08 + z * 1.58969099521155010221e-10)))));
}
function cosPoly(r: number): number {
  const z = r * r;
  return 1 - 0.5 * z + z * z * (4.16666666666666019037e-02 + z * (-1.38888888888741095749e-03 + z * (2.48015872894767294178e-05
    + z * (-2.75573143513906633035e-07 + z * (2.08757232129817482790e-09 + z * -1.13596475577881948265e-11)))));
}

/** Sine, good to about 1e-15 for arguments within a few thousand radians. */
export function dsin(x: number): number {
  const k = Math.round(x * INV_PIO2);
  const r = (x - k * PIO2_HI) - k * PIO2_LO;
  const q = ((k % 4) + 4) % 4;
  return q === 0 ? sinPoly(r) : q === 1 ? cosPoly(r) : q === 2 ? -sinPoly(r) : -cosPoly(r);
}
/** Cosine, to the same accuracy as dsin. */
export function dcos(x: number): number {
  const k = Math.round(x * INV_PIO2);
  const r = (x - k * PIO2_HI) - k * PIO2_LO;
  const q = ((k % 4) + 4) % 4;
  return q === 0 ? cosPoly(r) : q === 1 ? -sinPoly(r) : q === 2 ? -cosPoly(r) : sinPoly(r);
}

const TAN_PI_8 = 0.41421356237309503;
/** Arctangent, good to about 1e-10. */
export function datan(x: number): number {
  if (x < 0) return -datan(-x);
  if (x > 1) return HALF_PI - datan(1 / x);
  let base = 0, t = x;
  if (x > TAN_PI_8) { base = PI / 4; t = (x - 1) / (x + 1); }
  const z = t * t;
  // The series t - t^3/3 + t^5/5 ... to t^23, by Horner. |t| <= tan(pi/8), so the next term is under 1e-10.
  const s = 1 + z * (-1 / 3 + z * (1 / 5 + z * (-1 / 7 + z * (1 / 9 + z * (-1 / 11 + z * (1 / 13 + z * (-1 / 15
    + z * (1 / 17 + z * (-1 / 19 + z * (1 / 21 + z * (-1 / 23)))))))))));
  return base + t * s;
}
/** The angle of the point (x, y), -pi to pi, with atan2's argument order. */
export function datan2(y: number, x: number): number {
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI;
  return y > 0 ? HALF_PI : y < 0 ? -HALF_PI : 0;
}

const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;
const LN2 = 0.6931471805599453;
/** e^x, good to about 1e-14 over the range a double can hold. */
export function dexp(x: number): number {
  if (x > 709) return Infinity;
  if (x < -745) return 0;
  const k = Math.round(x / LN2);
  const r = (x - k * LN2_HI) - k * LN2_LO;
  // Taylor to r^13: |r| <= ln2 / 2, so the remainder is under 1e-16.
  let p = 1 + r / 13;
  for (let n = 12; n >= 1; n--) p = 1 + (r / n) * p;
  let scale = 1;
  if (k > 0) for (let i = 0; i < k; i++) scale *= 2; else for (let i = 0; i < -k; i++) scale *= 0.5;
  return p * scale;
}
/** Natural logarithm of a positive number, good to about 1e-12. Zero or less gives -Infinity; Infinity and NaN give themselves. */
export function dln(x: number): number {
  // Infinity would never leave the halving loop below (Infinity / 2 is Infinity), so it is answered first.
  if (x !== x || x === Infinity) return x;
  if (!(x > 0)) return -Infinity;
  let m = x, e = 0;
  while (m >= 2) { m *= 0.5; e++; }
  while (m < 1) { m *= 2; e--; }
  // ln(m) = 2 atanh(s), s = (m - 1) / (m + 1), |s| < 1/3: the series to s^23.
  const s = (m - 1) / (m + 1), z = s * s;
  const series = 1 + z * (1 / 3 + z * (1 / 5 + z * (1 / 7 + z * (1 / 9 + z * (1 / 11 + z * (1 / 13 + z * (1 / 15
    + z * (1 / 17 + z * (1 / 19 + z * (1 / 21 + z * (1 / 23)))))))))));
  return 2 * s * series + e * LN2;
}
/** x to the power y for a positive x. Zero or less gives 0. */
export function dpow(x: number, y: number): number { return x > 0 ? dexp(y * dln(x)) : 0; }

/** Reads a table whose points are dx apart starting at 0: straight lines between points, flat past the ends. */
export function tableAt(ys: Float64Array, dx: number, x: number): number {
  const last = ys.length - 1;
  if (!(x > 0)) return ys[0];
  const f = x / dx;
  if (f >= last) return ys[last];
  const i = Math.floor(f);
  return ys[i] + (ys[i + 1] - ys[i]) * (f - i);
}
/** Reads a curve given as [x, y] points in rising x: straight lines between points, flat past the ends. */
export function curveAt(pts: readonly (readonly [number, number])[], x: number): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) { const p = pts[i - 1], q = pts[i]; return p[1] + (q[1] - p[1]) * (x - p[0]) / (q[0] - p[0]); }
  }
  return pts[pts.length - 1][1];
}
/** A cubic through (x0, y0) and (x1, y1) with slopes m0 and m1 there, read at x. */
export function hermite(x0: number, y0: number, m0: number, x1: number, y1: number, m1: number, x: number): number {
  const d = x1 - x0, t = (x - x0) / d, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * d * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * d * m1;
}

/** A seeded random source (mulberry32): the same seed gives the same numbers, 0 to 1, on every machine. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A DataView, not a typed array over the same buffer: a typed array reads in the host's byte order, a DataView in the
// order asked for, so the hash is the same on a big-endian machine.
const hashView = new DataView(new ArrayBuffer(8));
/** The starting value of a state hash. */
export const HASH_START = 0x811c9dc5;
/**
 * Folds every bit of one number into a running hash (FNV-1a over its eight IEEE 754 bytes, least significant first,
 * whatever the host's byte order). +0 and -0 are the same state; so is every NaN, which is folded as the quiet NaN
 * 0x7ff8000000000000 (a NaN made at run time carries the hardware's sign and payload, and those differ between x86
 * and ARM, and between engines when stored).
 */
export function hashNumber(h: number, x: number): number {
  if (x !== x) {
    for (let i = 0; i < 6; i++) h = Math.imul(h, 0x01000193);   // six zero bytes: h ^ 0 is h
    h = Math.imul(h ^ 0xf8, 0x01000193);
    h = Math.imul(h ^ 0x7f, 0x01000193);
    return h >>> 0;
  }
  hashView.setFloat64(0, x === 0 ? 0 : x, true);
  for (let i = 0; i < 8; i++) h = Math.imul(h ^ hashView.getUint8(i), 0x01000193);
  return h >>> 0;
}
