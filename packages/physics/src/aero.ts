// The air on the body (DESIGN.md sections 2 and 7): drag along the body and lift at each axle, both growing with the
// square of the forward speed through sea-level air (math.ts RHO_AIR; the core models no altitude, weather or wind).
// Drag and lift areas are Cd x frontal area and Cl x frontal area, the figures a wind tunnel or a coast-down gives.
// Runs inside the step: plain arithmetic, nothing allocated.
import type { AeroModel } from './types';
import { RHO_AIR, soft } from './math';

/** What the air does to the car: drag along body x (N, negative when moving forward) and lift at each axle (N, upward positive; downforce is negative). */
export type AeroOut = { drag: number; liftFront: number; liftRear: number };

/**
 * Drag and lift at a forward speed u (m/s, negative when reversing). Drag always opposes the motion; lift does not
 * care which way the car moves. Writes out; allocates nothing.
 */
export function aeroForces(a: AeroModel, u: number, out: AeroOut): void {
  // Dynamic pressure 0.5 rho u^2. Drag takes u |u| rather than u^2 so that it pulls against a reversing car too.
  const halfRho = 0.5 * RHO_AIR;
  const q = halfRho * u * u;
  out.drag = -halfRho * a.dragArea * u * Math.abs(u);
  out.liftFront = q * a.liftAreaFront;
  out.liftRear = q * a.liftAreaRear;
}

// The coast-down's constant term stands for rolling and driveline drag, which is friction: all of it against a car
// that rolls, none on one at rest (so a parked car is not pushed either way). It fades in over the first 2 cm/s only,
// to keep its sign change smooth; a wider fade would turn it into a damper that never quite stops a slowing car.
const ROAD_LOAD_FADE = 0.02;

/**
 * The extra road load a coast-down measured beyond the air (A + B v, AeroModel.roadLoadA and roadLoadB), N along
 * body x. It opposes the motion and is zero at rest. Zero for a car with no coast-down on file.
 */
export function roadLoad(a: AeroModel, u: number): number {
  return -(a.roadLoadA * soft(u, ROAD_LOAD_FADE) + a.roadLoadB * u);
}
