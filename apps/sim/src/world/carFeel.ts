import { clamp, type Vehicle } from './physics';

/* Pure visual-feel state derived from the vehicle: body roll, pitch, hydraulic lift,
   wheel overspin, tyre smoke and skid levels. No THREE or DOM imports. */

export type Feel = { roll: number; pitch: number; lift: number };

export const freshFeel = (): Feel => ({ roll: 0, pitch: 0, lift: 0 });

export function feelStep(V: Vehicle, dt: number, F: Feel): Feel {
  if (!(dt > 0) || ![V.u, V.w, V.ax, V.hyd.f, V.hyd.r, V.hyd.l].every(Number.isFinite)) return F;
  const roll = clamp(V.u * V.w * .012 + V.hyd.l * .6, -.08, .08);
  const pitch = clamp(-V.ax * .01 + (V.hyd.f - V.hyd.r) * .45, -.06, .06);
  const lift = (V.hyd.f + V.hyd.r) / 2;
  const k = Math.min(1, dt * 6);
  F.roll += (roll - F.roll) * k;
  F.pitch += (pitch - F.pitch) * k;
  F.lift += (lift - F.lift) * k;
  return F;
}

export function wheelRollRate(V: Vehicle, front: boolean): number {
  return V.u * (1 + 1.5 * (front ? V.spinF : V.spinR));
}

export function smokeLevel(V: Vehicle): number {
  const burnout = V.spinR;
  const frontSpin = V.spinF;
  const handbrake = V.hand && Math.abs(V.u) > 3 ? 1 : 0;
  const slide = Math.abs(V.beta) > .17 && Math.abs(V.u) > 8 ? Math.min(1, (Math.abs(V.beta) - .17) / .25) : 0;
  return Math.max(burnout, frontSpin, handbrake, slide);
}

export function skidLevel(V: Vehicle): number {
  const handbrake = V.hand && Math.abs(V.u) > 3 ? 1 : 0;
  const spin = Math.max(V.spinF, V.spinR) > .5 ? 1 : 0;
  const slip = Math.abs(V.beta) > .2 && Math.abs(V.u) > 6 ? 1 : 0;
  return Math.max(handbrake, spin, slip);
}
