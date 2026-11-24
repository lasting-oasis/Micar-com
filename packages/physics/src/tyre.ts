// The tyre (DESIGN.md section 3): a brush on the combined slip, with friction and stiffness that depend on load, a
// fall after the peak toward a sliding friction, an aligning moment that fades at the limit, and two deflection states
// that make force build over distance rolled and hold the car like a spring at a standstill.
// Everything here runs inside the step for every wheel: plain arithmetic on numbers, nothing allocated.
import type { TyreParams } from './types';
import { dpow } from './math';

/** What one tyre gives the car: forces in the wheel's own frame (N, forward and left positive), aligning moment (N m), and how much of its grip is in use (1 at the peak). */
export type TyreOut = { fx: number; fy: number; mz: number; use: number };

// The rise to the peak is g(p) = 1 - (1 - p)^K. K = 3 is the brush on a rigid belt (3p - 3p^2 + p^3, as DESIGN.md
// section 3 first had it). A real belt is compliant: it twists under the tyre's own aligning moment, so the stiffness
// measured on a whole tyre is lower than the tread's and the force peaks at a smaller slip than the rigid brush says.
// K = 2 puts that peak at 2 mu Fz / C, where a brush on a belt that takes a third of the tyre's compliance at small
// slip peaks, and puts every category's starting values at 6.6 to 9.5 degrees and 0.11 to 0.16 slip ratio, where
// measured tyres peak (K = 3 gives up to 14 degrees and 0.23). The first slope is still the stiffness, the peak is
// still 1 at p = 1 with slope 0, so nothing else moves.
const SHAPE = 2;
// Load sensitivity may not push friction outside this band of the reference figure (a sheet's odd load stays sane).
const MU_LOW = 0.55;
const MU_HIGH = 1.25;
// Sliding friction falls with sliding speed (rubber heats and loses hysteresis grip), but not without limit.
const SLIDE_LOSS_PER_MS = 0.004;
const SLIDE_FLOOR = 0.6;
// A deflection is held within this many peak slips: past it the force is at the sliding share anyway, and a spinning
// or locked wheel would otherwise wind up a deflection that takes metres to unwind.
const WINDUP_PEAKS = 3;
/** Rolling speed, m/s, by which the low-speed damping has faded out completely. */
export const LOW_SPEED_FADE = 1.5;

/** Peak lateral friction coefficient at this load on this surface: grip grows more slowly than load. */
export function tyreMuY(p: TyreParams, fz: number, grip: number): number {
  const base = p.muY0 * grip;
  if (!(base > 0)) return 0;
  const mu = base * (1 - p.loadSens * (fz / p.fz0 - 1));
  return mu < MU_LOW * base ? MU_LOW * base : mu > MU_HIGH * base ? MU_HIGH * base : mu;
}

/** Peak longitudinal friction coefficient at this load on this surface: the lateral one times the tyre's ratio. */
export function tyreMuX(p: TyreParams, fz: number, grip: number): number {
  return tyreMuY(p, fz, grip) * p.muXRatio;
}

// Cornering stiffness per newton of load. Ca = cAlphaMax 2n / (1 + n^2) with n = Fz / fzStiffPeak and Ca(fz0) = cAlpha0
// reduces to Ca / Fz = cAlpha0 (1 + n0^2) / (fz0 (1 + n^2)), which stays finite as the load goes to zero, so the peak
// slip of a wheel that is lifting does not divide zero by zero.
function stiffnessPerLoad(p: TyreParams, fz: number): number {
  const n0 = p.fz0 / p.fzStiffPeak, n = fz / p.fzStiffPeak;
  return p.cAlpha0 * (1 + n0 * n0) / (p.fz0 * (1 + n * n));
}

/** Cornering stiffness at this load, N per radian of slip angle: rises with load to a peak at fzStiffPeak, then falls. */
export function cornerStiffness(p: TyreParams, fz: number): number {
  return fz > 0 ? fz * stiffnessPerLoad(p, fz) : 0;
}

/** Slip ratio at which the longitudinal force peaks (driving positive). ABS and traction control aim near it. */
export function peakSlipRatio(p: TyreParams, fz: number, grip: number): number {
  // SHAPE mu_x Fz / (cKappaPerFz Fz): the load cancels except through friction.
  return SHAPE * tyreMuX(p, fz, grip) / p.cKappaPerFz;
}

/** Tangent of the slip angle at which the lateral force peaks. The assists keep the front tyres just short of it. */
export function peakSlipTan(p: TyreParams, fz: number, grip: number): number {
  const load = fz > 0 ? fz : 0;
  return SHAPE * tyreMuY(p, load, grip) / stiffnessPerLoad(p, load);
}

/**
 * The tyre's forces for a slip ratio and a slip-angle tangent (both from the deflection states), on a load and a
 * surface grip. slideSpeed is how fast the contact patch slides over the road, m/s (only its size matters): a faster
 * slide grips a little less. Writes out; allocates nothing. No load (or no grip) gives no force.
 */
export function tyreForces(p: TyreParams, fz: number, slipRatio: number, slipTan: number, slideSpeed: number, grip: number, out: TyreOut): void {
  if (!(fz > 0) || !(grip > 0)) { out.fx = 0; out.fy = 0; out.mz = 0; out.use = 0; return; }
  const muY = tyreMuY(p, fz, grip), muX = muY * p.muXRatio;
  // Each slip as a share of the slip at which it alone would make the whole patch slide (an ellipse: px^2 + py^2 = 1).
  const px = p.cKappaPerFz * slipRatio / (SHAPE * muX);
  const py = stiffnessPerLoad(p, fz) * slipTan / (SHAPE * muY);
  const use = Math.sqrt(px * px + py * py);
  // The force along each slip is mu Fz g(p) times that slip's share of p, so carry g / p. Below the peak
  // g / p = (1 - w^K) / (1 - w) = 1 + w + ... + w^(K-1) with w = 1 - p: no division, and exactly K at p = 0.
  // unused = 1 - g = w^K is the share of grip not yet used; past the peak it is 0.
  let gOverP = 0, unused = 0;
  if (use <= 1) {
    const w = 1 - use;
    let wk = 1;
    for (let i = 0; i < SHAPE; i++) { gOverP += wk; wk *= w; }
    unused = wk;
  } else {
    // Past the peak the whole patch slides: friction falls smoothly (value and slope match at p = 1) to the sliding share.
    gOverP = slidingGrip(p, use, slideSpeed) / use;
  }
  const fy = muY * fz * gOverP * py;
  out.fx = muX * fz * gOverP * px;
  out.fy = fy;
  // The lateral force acts behind the contact centre (pneumatic trail) and turns the wheel back toward the way it is
  // going. As the patch slides from the back forward the trail shrinks with the grip not yet used, trail0 (1 - g):
  // the contract's trail0 (1 - p)^3 for K = 3, so the moment still peaks at a quarter of trail0 mu Fz at about the same
  // slip angle, and nothing is left at the peak, which is what a driver feels go light in the steering.
  out.mz = -p.trail0 * unused * fy;
  out.use = use;
}

// g(p) past the peak (p > 1), the share of peak grip a sliding patch gives: from 1 at the peak, falling smoothly to the
// sliding share s, which itself falls a little with sliding speed (rubber heats and loses hysteresis grip).
function slidingGrip(p: TyreParams, use: number, slideSpeed: number): number {
  let s = p.slideRatio - SLIDE_LOSS_PER_MS * Math.abs(slideSpeed);
  const floor = SLIDE_FLOOR * p.slideRatio;
  if (s < floor) s = floor;
  const d = use - 1;
  return s + (1 - s) / (1 + p.slideFall * d * d);
}

/**
 * The share of a sliding patch's deflection that is elastic, for a patch that stops sliding (DESIGN.md 3: re-stick).
 * use is how far past the peak the deflection states are (above 1), slideSpeed the slide speed, m/s. While a patch
 * slides, the deflection states run on past the peak, but the rubber is only bent as far as carries the sliding force;
 * the rest is distance slid. When it sticks again only the bent part springs back. That part is the deflection that
 * gives the same force on the sticking side of the curve: g(pe) = g(use), pe = 1 - (1 - g)^(1/K). Returns pe / use
 * (1 at or before the peak), by which both deflections are scaled, so the force does not jump.
 */
export function elasticShare(p: TyreParams, use: number, slideSpeed: number): number {
  if (!(use > 1)) return 1;
  const g = slidingGrip(p, use, slideSpeed);
  const pe = g < 1 ? 1 - dpow(1 - g, 1 / SHAPE) : 1;
  return pe / use;
}

/**
 * Advances one deflection state by h seconds and returns the new one, m. slipVel is the contact patch's slip speed
 * along that direction (Vx - omega R along the wheel, or the speed across it), rollSpeed the wheel centre's speed
 * along the wheel, relax the relaxation length. Implicit, so it is stable at any speed; at a standstill it is a pure
 * spring that holds the car. Clamped to +-maxDef (see maxDeflectionX and maxDeflectionY).
 */
export function relaxStep(def: number, slipVel: number, rollSpeed: number, relax: number, maxDef: number, h: number): number {
  // def' = -slipVel - (|Vx| / relax) def, with the decay taken at the new value.
  const next = (def - slipVel * h) / (1 + Math.abs(rollSpeed) * h / relax);
  return next > maxDef ? maxDef : next < -maxDef ? -maxDef : next;
}

/** The longest longitudinal deflection a tyre may hold, m: three peak slips' worth, so a spinning or locked wheel does not wind it up. */
export function maxDeflectionX(p: TyreParams, fz: number, grip: number): number {
  return p.relaxLong * WINDUP_PEAKS * peakSlipRatio(p, fz, grip);
}

/** The longest lateral deflection a tyre may hold, m: three peak slips' worth. */
export function maxDeflectionY(p: TyreParams, fz: number, grip: number): number {
  return p.relaxLat * WINDUP_PEAKS * peakSlipTan(p, fz, grip);
}

/**
 * Damping that stops the standstill spring ringing, N per m/s of slip speed: critical for the corner's share of the
 * car's mass on the stiffer of the tyre's two springs, so neither direction overshoots. Apply it as -c * slip speed,
 * times lowSpeedFade.
 */
export function lowSpeedDamping(p: TyreParams, fz: number, cornerMass: number): number {
  if (!(fz > 0) || !(cornerMass > 0)) return 0;
  // At a standstill the force for a deflection def is the small-slip stiffness times def / relax.
  const kx = p.cKappaPerFz * fz / p.relaxLong;
  const ky = cornerStiffness(p, fz) / p.relaxLat;
  return 2 * Math.sqrt((kx > ky ? kx : ky) * cornerMass);
}

/** How much of the low-speed damping applies at this rolling speed: all of it at rest, none from 1.5 m/s, in a straight line between. */
export function lowSpeedFade(rollSpeed: number): number {
  const f = 1 - Math.abs(rollSpeed) / LOW_SPEED_FADE;
  return f > 0 ? f : 0;
}

/**
 * The rolling resistance a tyre puts up, N (a size: it acts against whichever way the wheel rolls): about 1% of the
 * load, times the ground's factor (rolling: 1 on asphalt, more on sand or gravel). It is friction, not a damper: the
 * driveline solves it on the wheel as it solves a brake, so a rolling wheel feels all of it, a slowing one is stopped
 * by it in the time and distance it gives, and a wheel at rest feels only what it takes to keep it there.
 */
export function rollingResistance(p: TyreParams, fz: number, rolling: number): number {
  return fz > 0 && rolling > 0 ? p.rollRes * fz * rolling : 0;
}
