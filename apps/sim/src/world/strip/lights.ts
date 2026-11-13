/* The five start lights of a lap race (circuit, sprint, street X). Drag and drift keep their 3-2-1 count.
   goIn is the seconds until the lights go out (the green). The lights come on one a second, the fifth `hold`
   seconds before the green: solo, a random hold; in a challenge, NET_HOLD_S, so the five fill the 5 s for
   which the server names its green in advance and every screen goes out at the same instant. */
import type { EventType } from '../data';

export const LIGHTS = 5;
/** solo: the first light comes on this long after the count begins */
export const FIRST_LIGHT_S = 0.4;
export const HOLD_MIN_S = 0.5, HOLD_MAX_S = 2;
export const NET_HOLD_S = 1;

export const usesLights = (t: EventType): boolean => t === 'circuit' || t === 'sprint' || t === 'streetx';

/** How many lights are on, `goIn` seconds before the green; 0 once it has gone. */
export function lightsLit(goIn: number, hold: number): number {
  if (!(goIn > 0)) return 0;
  return Math.max(0, Math.min(LIGHTS, LIGHTS - Math.ceil(goIn - hold)));
}
export function soloHold(rand: () => number): number { return HOLD_MIN_S + rand() * (HOLD_MAX_S - HOLD_MIN_S); }
/** a solo count's whole length: the wait for the first light, a second for each of the other four, the hold */
export function soloCountLen(hold: number): number { return FIRST_LIGHT_S + (LIGHTS - 1) + hold; }
