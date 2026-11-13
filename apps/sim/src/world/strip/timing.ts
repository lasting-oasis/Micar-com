/* Lap, sector and gap timing for a lap race, from each car's race distance (metres, cumulative across laps; a
   back-row car starts below 0) and the race clock (seconds from the green). Pure: no THREE, no DOM. Every crossing
   is interpolated between two steps, so a slow frame rate or a sparse network pose still times it to the instant.
   A car only ever moves forward here: a step at or behind its furthest distance is ignored (reversing, wrong way). */

import type { Standing } from './events';

export const SECTORS = 3;
/** the gap traces keep the time each car reached every MARK_M metres */
export const MARK_M = 10;
/** open: not run yet this lap; best: the race's fastest for that sector; pb: the car's own fastest; plain: neither */
export type SectorMark = 'open' | 'plain' | 'pb' | 'best';

type Car = {
  s: number; t: number;
  /** the next sector boundary to cross: k × (lap / SECTORS), k ≥ 1 */
  next: number;
  lapStart: number; secStart: number; laps: number;
  last: number | null; best: number | null;
  /** the current lap's sector times */
  cur: (number | null)[];
  bestSec: (number | null)[];
  /** marks[j]: the race time this car reached j × MARK_M metres */
  marks: number[];
};

const EPS = 1e-9;
const minOf = (a: number | null, b: number): number => (a == null || b < a ? b : a);

export class RaceTiming {
  private readonly cars = new Map<string, Car>();
  private readonly raceSec: (number | null)[] = new Array(SECTORS).fill(null);
  private fast: { key: string; time: number } | null = null;
  private readonly secLen: number;

  constructor(lapLen: number, private readonly loop: boolean) {
    this.secLen = lapLen / SECTORS;
  }

  step(key: string, s: number, t: number): void {
    if (!Number.isFinite(s) || !Number.isFinite(t)) return;
    const c = this.cars.get(key);
    if (!c) { this.cars.set(key, this.first(s, t)); return; }
    if (s <= c.s) return;
    const s0 = c.s, t0 = c.t, at = (x: number) => t0 + (x - s0) / (s - s0) * (t - t0);
    for (let x = c.marks.length * MARK_M; x <= s; x += MARK_M) c.marks.push(x >= s0 ? at(x) : t0);
    const lastK = this.loop ? Infinity : SECTORS;
    while (c.next <= lastK && c.next * this.secLen <= s + EPS) { this.cross(key, c, c.next, at(c.next * this.secLen)); c.next++; }
    c.s = s; c.t = t;
  }

  private first(s: number, t: number): Car {
    const marks: number[] = [];
    for (let x = 0; x <= s; x += MARK_M) marks.push(t); // reached before this browser knew of it
    return { s, t, next: Math.max(1, Math.floor(s / this.secLen + EPS) + 1), lapStart: 0, secStart: 0, laps: 0, last: null, best: null,
      cur: new Array(SECTORS).fill(null), bestSec: new Array(SECTORS).fill(null), marks };
  }

  private cross(key: string, c: Car, k: number, tc: number): void {
    const i = (k - 1) % SECTORS, dt = tc - c.secStart;
    c.cur[i] = dt; c.secStart = tc;
    c.bestSec[i] = minOf(c.bestSec[i], dt); this.raceSec[i] = minOf(this.raceSec[i], dt);
    if (i !== SECTORS - 1 || !this.loop) return;
    const lap = tc - c.lapStart;
    c.laps++; c.last = lap; c.best = minOf(c.best, lap); c.lapStart = tc;
    if (!this.fast || lap < this.fast.time) this.fast = { key, time: lap };
    c.cur = new Array(SECTORS).fill(null);
  }

  laps(key: string): number { return this.cars.get(key)?.laps ?? 0; }
  lapTime(key: string, now: number): number { const c = this.cars.get(key); return Math.max(0, now - (c ? c.lapStart : 0)); }
  last(key: string): number | null { return this.cars.get(key)?.last ?? null; }
  best(key: string): number | null { return this.cars.get(key)?.best ?? null; }
  fastest(): { key: string; time: number } | null { return this.fast; }

  sectors(key: string): { time: number | null; mark: SectorMark }[] {
    const c = this.cars.get(key);
    return Array.from({ length: SECTORS }, (_, i) => {
      const time = c ? c.cur[i] : null;
      if (time == null) return { time: null, mark: 'open' as const };
      const race = this.raceSec[i], own = c!.bestSec[i];
      const mark: SectorMark = race != null && time <= race + EPS ? 'best' : own != null && time <= own + EPS ? 'pb' : 'plain';
      return { time, mark };
    });
  }

  gap(behind: string, ahead: string, now: number): number | null {
    const b = this.cars.get(behind), a = this.cars.get(ahead);
    if (!a || !b || b.s < 0 || b.s > a.s) return null;
    const i = Math.floor(b.s / MARK_M), t0 = a.marks[i];
    if (t0 == null) return null;
    const x0 = i * MARK_M, x1 = i + 1 < a.marks.length ? (i + 1) * MARK_M : a.s, t1 = i + 1 < a.marks.length ? a.marks[i + 1] : a.t;
    const tAt = x1 > x0 ? t0 + (b.s - x0) / (x1 - x0) * (t1 - t0) : t0;
    return now - tAt;
  }
}

/** The standings (leader first) with each car's best lap and its gap to the leader in seconds: from the two finish
 *  times once both have finished, else from the leader's trace; null for the leader and wherever it isn't known. */
export function withTiming<S extends Standing>(list: S[], T: RaceTiming, now: number): (S & { best: number | null; gap: number | null })[] {
  const lead = list[0];
  return list.map((p, i) => {
    let gap: number | null = null;
    if (i > 0 && lead) {
      if (p.ft != null && lead.ft != null) gap = p.ft - lead.ft;
      else if (p.key && lead.key) gap = T.gap(p.key, lead.key, now);
    }
    return { ...p, best: p.key ? T.best(p.key) : null, gap };
  });
}
