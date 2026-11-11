// The phone's stick controls (docs/superpowers/plans/2026-11-11-mobile-sticks.md): a steering stick, an up-and-down
// gas stick, and hold buttons for Drift and NOS. TouchSticks.tsx writes the thumbs into `touchSticks`; InputMap reads
// it into the same Input the keys and buttons make, so the driving engine sees nothing new.

/** a dead zone in the middle, then a curve: small thumb moves make small changes, the edge gives full travel */
export const DEAD = .14;
export const STEER_POWER = 1.8;
export const GAS_POWER = 1.4;
/** a hand-brake pull when Drift is pressed, in 120 Hz physics steps (0.3 s) */
export const DRIFT_KICK_STEPS = 36;
/** a flick of the steering stick past this changes a drag's lane; it re-arms under LANE_REARM */
export const LANE_FLICK = .6;
export const LANE_REARM = .3;

export function shapeAxis(v: number, dead = DEAD, power = 1): number {
  if (!Number.isFinite(v)) return 0;
  const a = Math.min(1, Math.abs(v));
  return a <= dead ? 0 : Math.sign(v) * Math.pow((a - dead) / (1 - dead), power);
}

/** The two sticks as driving input. The gas stick's sideways travel is ignored; down is brake, then reverse. */
export function stickToInput(steerX: number, gasY: number): { steer: number; fwd: number; back: number } {
  const g = shapeAxis(gasY, DEAD, GAS_POWER);
  return { steer: shapeAxis(steerX, DEAD, STEER_POWER), fwd: Math.max(0, g), back: Math.max(0, -g) };
}

/** A fresh flick of the steering stick, for a drag's lane change: fires once, re-arms near the middle. */
export function laneEdge(x: number, armed: boolean): { laneL: boolean; laneR: boolean; armed: boolean } {
  if (Math.abs(x) < LANE_REARM) return { laneL: false, laneR: false, armed: true };
  if (armed && Math.abs(x) > LANE_FLICK) return { laneL: x < 0, laneR: x > 0, armed: false };
  return { laneL: false, laneR: false, armed };
}

export type TouchSticks = {
  /** raw stick positions, -1..1 (x right, y up) */
  steerX: number; gasY: number;
  drift: boolean; nos: boolean;
  /** set by the steering stick, taken by InputMap as edges */
  laneL: boolean; laneR: boolean; laneArmed: boolean;
  /** the gear buttons beside the sticks: one shift per tap, taken by InputMap as edges */
  shiftUp: boolean; shiftDn: boolean;
};
export const touchSticks: TouchSticks = { steerX: 0, gasY: 0, drift: false, nos: false, laneL: false, laneR: false, laneArmed: true, shiftUp: false, shiftDn: false };

export function setSteerStick(x: number): void {
  touchSticks.steerX = x;
  const e = laneEdge(x, touchSticks.laneArmed);
  touchSticks.laneArmed = e.armed;
  if (e.laneL) touchSticks.laneL = true;
  if (e.laneR) touchSticks.laneR = true;
}

export function releaseSticks(): void {
  Object.assign(touchSticks, { steerX: 0, gasY: 0, drift: false, nos: false, laneL: false, laneR: false, laneArmed: true, shiftUp: false, shiftDn: false });
}
