// The racing line (DESIGN.md section 14): from a closed circuit's centreline and its width, the line a driver takes to
// keep the car's path as gently curved as the track allows. Less curvature is more speed for the same grip, so the
// line runs wide on the way into a corner, clips the inside at the apex and runs wide again on the way out.
//
// It is found by relaxation, the scheme of Remi Coulom's K1999 robot (TORCS): each point of the line slides along the
// track's normal at that point until its curvature is the distance-weighted mean of its two neighbours' curvatures,
// never closer to an edge than the margin. A curve whose curvature is everywhere the mean of its neighbours' bends
// as evenly as the edges let it: between the places where it touches an edge its curvature changes in a straight line
// with distance, which is the curve of least squared curvature for the gentle bends of a road. Relaxing point by point
// alone would need tens of thousands of passes to move a 300 m straight, so it runs coarse to fine: every 64th point
// first (the circuit's rough shape), then every 32nd, down to every point, with the points in between laid on the
// coarse curve after each level. The number of passes at each level is fixed and the order of the points is fixed, so
// the same centreline gives the same line, bit for bit, on every machine.
//
// Coordinates are the core's world plane: X, Y in metres, Y to the left of X. A line is built once per circuit (it
// allocates then); finding a car on it (placeOnLine, placeOnTrack) allocates nothing and can run every step.
import { PI, dcos, dsin } from './math';

/* ------------------------------------------------------------------ the line */

/**
 * A racing line on a closed circuit. Point i of the line lies on the track's normal through point i of the evenly
 * resampled centreline, `offset[i]` metres to its left; point n - 1 joins point 0.
 */
export type RacingLine = {
  /** Number of points. */
  n: number;
  /** Track width, m, and the margin the line keeps from each edge, m. */
  width: number; margin: number;
  /** The centreline, resampled evenly, its unit normal to the left at each point, and distance along it from point 0, m. */
  cx: Float64Array; cy: Float64Array; nx: Float64Array; ny: Float64Array; cs: Float64Array;
  /** Length of the centreline round the lap, m. */
  centreLength: number;
  /** How far the line lies to the left of the centreline at each point, m (never more than width / 2 - margin either way). */
  offset: Float64Array;
  /** The line's points, m, and its unit tangent at each. */
  x: Float64Array; y: Float64Array; tx: Float64Array; ty: Float64Array;
  /** Distance along the line from point 0, m, and the length of the line round the lap, m. */
  s: Float64Array; length: number;
  /** Curvature of the line at each point, 1/m, positive turning left. */
  k: Float64Array;
};

/** How finely a line is built unless asked otherwise: a point every this many metres of centreline. */
export const LINE_SPACING = 2;
/** The margin a line keeps from each edge unless asked otherwise, m: half a wide car and half a metre to spare. */
export const LINE_MARGIN = 1.6;
/** Relaxation passes at each level: this many times the square root of the level's step (more where points are few). */
export const LINE_PASSES = 100;
// The coarsest level takes every 64th point, or fewer if that would leave under eight points to shape the circuit.
const COARSEST = 64;
const FEWEST = 8;
// A coarse point is held back from the edges by the sagitta of an arc of this radius, m, between its neighbours, so
// that the curve laid through it later does not cut across an edge between coarse points (K1999's security margin).
const SAGITTA_RADIUS = 100;
// Lateral nudge for the numerical slope of curvature against offset, m.
const NUDGE = 1e-4;
/**
 * On the inside of a bend of the centreline the line keeps no further from it than this share of the bend's radius
 * (the centreline's own, the tightest within INSIDE_SPAN points either side). The normals of a bend tighter than the
 * offset cross before they reach it: a line laid that far in folds back on itself, steps backward and turns in a
 * cusp (the Eifel GP's centreline turns 72 degrees in 6 m, a 4.2 m radius, where the line sat 4.4 m in: 0.12 m of
 * radius, turning the wrong way). Half the radius keeps the offset curve's steps at least half the centreline's.
 */
export const INSIDE_SHARE = 0.5;
const INSIDE_SPAN = 2;

/**
 * Signed curvature of the circle through three points, 1/m, positive when a, b, c turn left: twice the cross product
 * of the two chords over the product of the three sides. Zero for coincident points.
 */
export function curvature3(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const x1 = bx - ax, y1 = by - ay, x2 = cx - bx, y2 = cy - by, x3 = cx - ax, y3 = cy - ay;
  const d = Math.sqrt((x1 * x1 + y1 * y1) * (x2 * x2 + y2 * y2) * (x3 * x3 + y3 * y3));
  return d > 0 ? 2 * (x1 * y2 - y1 * x2) / d : 0;
}

/**
 * The racing line of a closed circuit: its centreline as ordered points (m, world X and Y, either direction round,
 * dense enough to describe its curves; a last point repeating the first is dropped), its width (m), the margin to keep
 * from each edge (m, LINE_MARGIN unless given), the spacing of the line's points (m, LINE_SPACING unless given) and the
 * relaxation passes per level (LINE_PASSES unless given; more only shows the line has settled). The line keeps within
 * width / 2 - margin of the centreline; a track too narrow for the margin gives the centreline itself.
 */
export function racingLine(xs: ArrayLike<number>, ys: ArrayLike<number>, width: number, margin = LINE_MARGIN, spacing = LINE_SPACING, passes = LINE_PASSES): RacingLine {
  let m = Math.min(xs.length, ys.length);
  if (m > 1 && xs[m - 1] === xs[0] && ys[m - 1] === ys[0]) m--;
  if (m < 4) throw new Error('a circuit needs at least four centreline points');
  if (!(width > 0) || !(spacing > 0) || !(margin >= 0)) throw new Error('a circuit needs a positive width and spacing and a margin of zero or more');
  const line = resample(xs, ys, m, spacing);
  line.width = width;
  line.margin = margin;
  const inside = insideLimits(line);
  relax(line, width / 2 - margin, passes, inside);
  finish(line);
  return line;
}

// How far the line may lie to the left and to the right of the centreline at each point, on the inside of the
// centreline's bends: INSIDE_SHARE of the tightest radius bending that way within INSIDE_SPAN points. Infinite where
// the centreline is straight or bends the other way.
type Inside = { left: Float64Array; right: Float64Array };

function insideLimits(line: RacingLine): Inside {
  const n = line.n, k = centreCurvature(line), left = new Float64Array(n), right = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let kl = 0, kr = 0;
    for (let d = -INSIDE_SPAN; d <= INSIDE_SPAN; d++) {
      const c = k[((i + d) % n + n) % n];
      if (c > kl) kl = c; else if (-c > kr) kr = -c;
    }
    left[i] = kl > 0 ? INSIDE_SHARE / kl : Infinity;
    right[i] = kr > 0 ? INSIDE_SHARE / kr : Infinity;
  }
  return { left, right };
}

// The centreline resampled at n even steps along its polygon (straight lines between the points given), with its
// normals; the line's arrays allocated and set to the centreline.
function resample(xs: ArrayLike<number>, ys: ArrayLike<number>, m: number, spacing: number): RacingLine {
  let total = 0;
  for (let i = 0; i < m; i++) {
    const j = i + 1 < m ? i + 1 : 0, dx = xs[j] - xs[i], dy = ys[j] - ys[i];
    total += Math.sqrt(dx * dx + dy * dy);
  }
  if (!(total > 0)) throw new Error('a circuit needs a length');
  let n = Math.round(total / spacing);
  if (n < 4 * FEWEST) n = 4 * FEWEST;
  const cx = new Float64Array(n), cy = new Float64Array(n), cs = new Float64Array(n);
  let seg = 0, segStart = 0;
  let segLen = segmentLength(xs, ys, m, 0);
  for (let k = 0; k < n; k++) {
    const d = total * k / n;
    while (seg < m - 1 && d > segStart + segLen) { segStart += segLen; seg++; segLen = segmentLength(xs, ys, m, seg); }
    const j = seg + 1 < m ? seg + 1 : 0;
    const t = segLen > 0 ? (d - segStart) / segLen : 0;
    cx[k] = xs[seg] + (xs[j] - xs[seg]) * t;
    cy[k] = ys[seg] + (ys[j] - ys[seg]) * t;
    cs[k] = d;
  }
  const nx = new Float64Array(n), ny = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? i - 1 : n - 1, b = i + 1 < n ? i + 1 : 0;
    const dx = cx[b] - cx[a], dy = cy[b] - cy[a], len = Math.sqrt(dx * dx + dy * dy);
    nx[i] = len > 0 ? -dy / len : 0;
    ny[i] = len > 0 ? dx / len : 1;
  }
  return {
    n, width: 0, margin: 0, cx, cy, nx, ny, cs, centreLength: total,
    offset: new Float64Array(n), x: Float64Array.from(cx), y: Float64Array.from(cy),
    tx: new Float64Array(n), ty: new Float64Array(n), s: new Float64Array(n), length: 0, k: new Float64Array(n),
  };
}

function segmentLength(xs: ArrayLike<number>, ys: ArrayLike<number>, m: number, i: number): number {
  const j = i + 1 < m ? i + 1 : 0, dx = xs[j] - xs[i], dy = ys[j] - ys[i];
  return Math.sqrt(dx * dx + dy * dy);
}

// Coarse to fine: at each level, LINE_PASSES x sqrt(step) passes over every step-th point, then the points between
// laid on the curve the coarse points make.
function relax(line: RacingLine, room: number, perLevel: number, inside: Inside): void {
  if (!(room > 0)) return;
  let step = COARSEST;
  while (step > 1 && line.n / step < FEWEST) step >>= 1;
  for (; step >= 1; step >>= 1) {
    const passes = perLevel * Math.floor(Math.sqrt(step));
    for (let p = 0; p < passes; p++) smooth(line, step, room, inside);
    if (step > 1) fillBetween(line, step, room, inside);
  }
}

// The coarse points of a level are 0, step, 2 step ... up to (count - 1) step, count = floor(n / step); the last gap,
// back round to point 0, is between step and 2 step - 1 points long.
function coarse(line: RacingLine, step: number, j: number): number {
  const count = Math.floor(line.n / step);
  const w = ((j % count) + count) % count;
  return w * step;
}

// One pass of the level: each coarse point moved toward the curvature its neighbours ask of it.
function smooth(line: RacingLine, step: number, room: number, inside: Inside): void {
  const count = Math.floor(line.n / step), X = line.x, Y = line.y;
  for (let j = 0; j < count; j++) {
    const pp = coarse(line, step, j - 2), p = coarse(line, step, j - 1), i = j * step, q = coarse(line, step, j + 1), qq = coarse(line, step, j + 2);
    const kPrev = curvature3(X[pp], Y[pp], X[p], Y[p], X[i], Y[i]);
    const kNext = curvature3(X[i], Y[i], X[q], Y[q], X[qq], Y[qq]);
    const lp = dist(X[i], Y[i], X[p], Y[p]), ln = dist(X[i], Y[i], X[q], Y[q]);
    // The curvature here if it changed in a straight line with distance from the point behind to the point ahead.
    const target = lp + ln > 0 ? (ln * kPrev + lp * kNext) / (lp + ln) : 0;
    adjust(line, p, i, q, target, room - lp * ln / (8 * SAGITTA_RADIUS), inside);
  }
}

// After a level, each point between two coarse points is laid where the curvature changes evenly between theirs.
function fillBetween(line: RacingLine, step: number, room: number, inside: Inside): void {
  const count = Math.floor(line.n / step), n = line.n, X = line.x, Y = line.y;
  for (let j = 0; j < count; j++) {
    const a = j * step, bIndex = j + 1 < count ? (j + 1) * step : n, b = bIndex < n ? bIndex : 0;
    const p = coarse(line, step, j - 1), q = coarse(line, step, j + 2);
    const ka = curvature3(X[p], Y[p], X[a], Y[a], X[b], Y[b]);
    const kb = curvature3(X[a], Y[a], X[b], Y[b], X[q], Y[q]);
    for (let k = a + 1; k < bIndex; k++) {
      const t = (k - a) / (bIndex - a);
      adjust(line, a, k, b, ka + (kb - ka) * t, room, inside);
    }
  }
}

// Moves point i along its normal so the circle through points p, i and q has the target curvature: first onto the
// chord p-q (curvature zero), then one Newton step (curvature is all but straight in the offset near the chord), then
// held within `limit` of the centreline (never less than zero) and within the inside limits of its bends.
function adjust(line: RacingLine, p: number, i: number, q: number, target: number, limit: number, inside: Inside): void {
  const X = line.x, Y = line.y;
  const px = X[p], py = Y[p], qx = X[q], qy = Y[q];
  const dx = qx - px, dy = qy - py;
  const nx = line.nx[i], ny = line.ny[i], cx = line.cx[i], cy = line.cy[i];
  let a = line.offset[i];
  const across = nx * dy - ny * dx;
  if (across > 1e-9 || across < -1e-9) a = -((cx - px) * dy - (cy - py) * dx) / across;
  const k0 = curvature3(px, py, cx + a * nx, cy + a * ny, qx, qy);
  const k1 = curvature3(px, py, cx + (a + NUDGE) * nx, cy + (a + NUDGE) * ny, qx, qy);
  const slope = (k1 - k0) / NUDGE;
  if (slope > 1e-12 || slope < -1e-12) a += (target - k0) / slope;
  const lim = limit > 0 ? limit : 0;
  if (a > lim) a = lim; else if (a < -lim) a = -lim;
  // Never further inside a bend of the centreline than its radius allows (insideLimits).
  if (a > inside.left[i]) a = inside.left[i]; else if (a < -inside.right[i]) a = -inside.right[i];
  line.offset[i] = a;
  X[i] = cx + a * nx;
  Y[i] = cy + a * ny;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

// Distance along the line, its tangents and its curvature, from its final points.
function finish(line: RacingLine): void {
  const n = line.n, X = line.x, Y = line.y;
  let s = 0;
  for (let i = 0; i < n; i++) {
    line.s[i] = s;
    const j = i + 1 < n ? i + 1 : 0;
    s += dist(X[i], Y[i], X[j], Y[j]);
  }
  line.length = s;
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? i - 1 : n - 1, b = i + 1 < n ? i + 1 : 0;
    const dx = X[b] - X[a], dy = Y[b] - Y[a], len = Math.sqrt(dx * dx + dy * dy);
    line.tx[i] = len > 0 ? dx / len : 1;
    line.ty[i] = len > 0 ? dy / len : 0;
    line.k[i] = curvature3(X[a], Y[a], X[i], Y[i], X[b], Y[b]);
  }
}

/** The bending of a closed path: the integral of curvature squared over its length, 1/m (a circle of radius R gives 2 pi / R). */
export function bending(k: Float64Array, s: Float64Array, length: number): number {
  const n = k.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = i + 1 < n ? i + 1 : 0;
    const ds = (j > 0 ? s[j] : length) - s[i];
    sum += 0.5 * (k[i] * k[i] + k[j] * k[j]) * ds;
  }
  return sum;
}

/** The centreline's own curvature at each of the line's points, 1/m: what the line is measured against. */
export function centreCurvature(line: RacingLine): Float64Array {
  const n = line.n, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? i - 1 : n - 1, b = i + 1 < n ? i + 1 : 0;
    out[i] = curvature3(line.cx[a], line.cy[a], line.cx[i], line.cy[i], line.cx[b], line.cy[b]);
  }
  return out;
}

/* ------------------------------------------------------------------ where a car is */

/**
 * Where a point is against a path: the segment it is beside (index, and how far along it, 0 to 1), the distance along
 * the path to there (m), how far the point lies to the left of the path (m), the path's unit tangent there, and the
 * distance from the path (m).
 */
export type PathPlace = { index: number; frac: number; s: number; offset: number; tx: number; ty: number; dist: number };

/** An empty place record to pass to placeOnLine and placeOnTrack. */
export function createPlace(): PathPlace {
  return { index: 0, frac: 0, s: 0, offset: 0, tx: 1, ty: 0, dist: 0 };
}

/** How many points either side of the last place are searched: a car covers under a point a step. */
const SEARCH = 12;
/** A point further than this from the nearest searched segment, m, is searched for round the whole lap. */
const LOST = 25;

/**
 * Finds a point (x, y) against the racing line: the nearest segment within a few points of `hint` (the index last
 * found; a negative hint searches the whole lap), or round the whole lap if the point is far from there. Writes out;
 * allocates nothing.
 */
export function placeOnLine(line: RacingLine, x: number, y: number, hint: number, out: PathPlace): void {
  place(line.x, line.y, line.tx, line.ty, line.s, line.length, line.n, x, y, hint, out);
}

/**
 * Finds a point (x, y) against the track: the same as placeOnLine, measured against the centreline, so `offset` is
 * how far left of the centreline the point is (the track's edges are at plus and minus width / 2) and `s` is distance
 * along the centreline. Writes out; allocates nothing.
 */
export function placeOnTrack(line: RacingLine, x: number, y: number, hint: number, out: PathPlace): void {
  // The centreline's unit tangent is its left normal turned a quarter turn right: (ny, -nx). place() blends the
  // tangent from the arrays it is given, so it is handed (ny, nx) and the sign of the second part is put right after;
  // the blend and its normalising are the same either way.
  place(line.cx, line.cy, line.ny, line.nx, line.cs, line.centreLength, line.n, x, y, hint, out);
  out.ty = -out.ty;
}

function place(X: Float64Array, Y: Float64Array, TX: Float64Array, TY: Float64Array, S: Float64Array, length: number, n: number,
  x: number, y: number, hint: number, out: PathPlace): void {
  if (hint >= 0 && hint < n) {
    nearestSegment(X, Y, n, x, y, hint - SEARCH, hint + SEARCH, out);
    if (out.dist > LOST) nearestSegment(X, Y, n, x, y, 0, n - 1, out);
  } else nearestSegment(X, Y, n, x, y, 0, n - 1, out);
  const i = out.index, j = i + 1 < n ? i + 1 : 0, t = out.frac;
  const segLen = (j > 0 ? S[j] : length) - S[i];
  out.s = S[i] + t * segLen;
  if (out.s >= length) out.s -= length;
  // The tangent blended between the two points' own, so it turns smoothly as the car passes a point.
  const tx = TX[i] + (TX[j] - TX[i]) * t, ty = TY[i] + (TY[j] - TY[i]) * t, len = Math.sqrt(tx * tx + ty * ty);
  out.tx = len > 0 ? tx / len : 1;
  out.ty = len > 0 ? ty / len : 0;
}

// The nearest segment among those starting at points from..to (wrapping round the lap); writes index, frac, offset
// (left of the segment's direction positive) and dist.
function nearestSegment(X: Float64Array, Y: Float64Array, n: number, x: number, y: number, from: number, to: number, out: PathPlace): void {
  let best = Infinity;
  for (let k = from; k <= to; k++) {
    const i = ((k % n) + n) % n, j = i + 1 < n ? i + 1 : 0;
    const dx = X[j] - X[i], dy = Y[j] - Y[i], l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - X[i]) * dx + (y - Y[i]) * dy) / l2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const ex = x - (X[i] + dx * t), ey = y - (Y[i] + dy * t), d2 = ex * ex + ey * ey;
    if (d2 < best) {
      best = d2;
      const len = Math.sqrt(l2);
      out.index = i; out.frac = t; out.dist = Math.sqrt(d2);
      out.offset = len > 0 ? (dx * ey - dy * ex) / len : 0;
    }
  }
}

/**
 * Reads the line at a distance s along it (m, any value: it wraps round the lap): the curvature there, 1/m, in a
 * straight line between points. `hint` is a point index at or before s to start from (negative: search).
 */
export function curvatureAt(line: RacingLine, s: number, hint: number): number {
  const i = indexAt(line.s, line.length, line.n, s, hint);
  const j = i + 1 < line.n ? i + 1 : 0;
  const d = wrap(s, line.length) - line.s[i], seg = (j > 0 ? line.s[j] : line.length) - line.s[i];
  const t = seg > 0 ? d / seg : 0;
  return line.k[i] + (line.k[j] - line.k[i]) * t;
}

/** A distance taken round a lap of this length into 0 to length. */
export function wrap(s: number, length: number): number {
  if (s >= 0 && s < length) return s;
  const r = s - Math.floor(s / length) * length;
  return r < length ? r : 0;
}

/**
 * The index of the point at or just before distance s (m, wrapped round the lap) in a table of rising distances S that
 * starts at 0. `hint` is an index at or before it to walk forward from (negative: a binary search).
 */
export function indexAt(S: Float64Array, length: number, n: number, s: number, hint: number): number {
  const d = wrap(s, length);
  if (hint >= 0 && hint < n && S[hint] <= d) {
    let i = hint;
    // Usually a step or two: a car moves less than a point each step, a look-ahead a few points.
    for (let k = 0; k < n && i + 1 < n && S[i + 1] <= d; k++) i++;
    return i;
  }
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (S[mid] <= d) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/* ------------------------------------------------------------------ circuits drawn from pieces */

/** A piece of a circuit: `length` metres of road whose curvature is `curvature` (1/m, left positive; 0 for a straight). */
export type Piece = { length: number; curvature: number };

/** A straight of this many metres. */
export function straight(length: number): Piece { return { length, curvature: 0 }; }
/** An arc of this radius (m) through this angle (rad): positive turns left, negative right. */
export function arc(radius: number, angle: number): Piece { return { length: radius * Math.abs(angle), curvature: angle >= 0 ? 1 / radius : -1 / radius }; }

/**
 * A centreline drawn from pieces laid end to end, starting at the origin heading along +X: a point every `spacing`
 * metres (the last piece's end, which should be the start again, is not repeated). `gap` is how far the end of the
 * last piece lies from the start (m) and `turn` how far its heading is from the start's (rad): both zero for a circuit
 * that closes.
 */
export function centrelineFrom(pieces: readonly Piece[], spacing: number): { x: Float64Array; y: Float64Array; gap: number; turn: number } {
  let total = 0;
  for (const p of pieces) total += p.length;
  const n = Math.max(4, Math.round(total / spacing));
  const x = new Float64Array(n), y = new Float64Array(n);
  let px = 0, py = 0, heading = 0, start = 0, k = 0;
  for (const p of pieces) {
    // Points that fall on this piece, exactly on the arc (or straight) from its start pose.
    while (k < n && total * k / n < start + p.length) {
      const d = total * k / n - start;
      poseAlong(px, py, heading, p.curvature, d, x, y, k);
      k++;
    }
    poseAlong(px, py, heading, p.curvature, p.length, POSE_X, POSE_Y, 0);
    px = POSE_X[0]; py = POSE_Y[0];
    heading += p.curvature * p.length;
    start += p.length;
  }
  for (; k < n; k++) { x[k] = px; y[k] = py; }
  let turn = heading - 2 * PI * Math.round(heading / (2 * PI));
  if (turn < 0) turn = -turn;
  return { x, y, gap: Math.sqrt(px * px + py * py), turn };
}

const POSE_X = new Float64Array(1);
const POSE_Y = new Float64Array(1);

// The point d metres along a piece of curvature c that starts at (px, py) heading `heading`.
function poseAlong(px: number, py: number, heading: number, c: number, d: number, outX: Float64Array, outY: Float64Array, k: number): void {
  const hx = dcos(heading), hy = dsin(heading);
  let along: number, left: number;
  if (c > 1e-12 || c < -1e-12) { along = dsin(c * d) / c; left = (1 - dcos(c * d)) / c; } else { along = d; left = 0; }
  outX[k] = px + along * hx - left * hy;
  outY[k] = py + along * hy + left * hx;
}

/* ------------------------------------------------------------------ the proof circuits */

/** A circuit to prove a line, a lap and a pilot on: its name, its pieces (closing on themselves) and its width, m. */
export type ProofCircuit = { name: string; pieces: Piece[]; width: number };

/** An oval: two 300 m straights joined by two 180 degree left turns of 60 m radius, 12 m wide. 977 m round. */
export function proofOval(): ProofCircuit {
  return { name: 'oval', width: 12, pieces: [straight(300), arc(60, PI), straight(300), arc(60, PI)] };
}

/**
 * A club circuit, 12 m wide, run anticlockwise, about 842 m round: a 300 m main straight; a 180 degree left of 24 m
 * radius onto a back straight; a chicane on it (left 60 degrees, right 120, left 60, all of 15 m radius: the road
 * jinks 15 m toward the infield and back over 52 m); a 180 degree left hairpin of 15 m radius; a short straight; and
 * an S-bend (right then left 45 degrees, 30 m radius) back onto the main straight. The back straight's length is
 * whatever closes the loop.
 */
export function proofClub(): ProofCircuit {
  const chicaneR = 15, chicane = PI / 3, sR = 30, sTurn = PI / 4, hairpinR = 15, run = 10;
  // The S-bend drops the road 2 sR (1 - cos 45) toward the main straight, so the far turn spans that and the hairpin.
  const drop = 2 * sR * (1 - dcos(sTurn));
  const farR = (2 * hairpinR + drop) / 2;
  // Along X: 300 out, back 80 + the chicane's 4 r sin(60) + the rest, then run + the S-bend's 2 r sin(45) home.
  const back = 300 - 80 - 4 * chicaneR * dsin(chicane) + run + 2 * sR * dsin(sTurn);
  return {
    name: 'club', width: 12, pieces: [
      straight(300), arc(farR, PI), straight(80),
      arc(chicaneR, chicane), arc(chicaneR, -2 * chicane), arc(chicaneR, chicane),
      straight(back), arc(hairpinR, PI), straight(run), arc(sR, -sTurn), arc(sR, sTurn),
    ],
  };
}

/** The proof circuits by name, in a fixed order. */
export const PROOF_CIRCUITS: readonly ('oval' | 'club')[] = ['oval', 'club'];

/** A proof circuit by name. */
export function proofCircuit(name: string): ProofCircuit {
  if (name === 'oval') return proofOval();
  if (name === 'club') return proofClub();
  throw new Error(`no proof circuit named ${name}`);
}

/** The racing line of a proof circuit, its centreline drawn a point a metre. */
export function proofLine(name: string, margin = LINE_MARGIN): RacingLine {
  const c = proofCircuit(name), centre = centrelineFrom(c.pieces, 1);
  return racingLine(centre.x, centre.y, c.width, margin);
}
