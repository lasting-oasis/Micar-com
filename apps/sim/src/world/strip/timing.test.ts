import { describe, expect, it } from 'vitest';
import { RaceTiming, SECTORS, withTiming } from './timing';
import type { Standing } from './events';

/** Step one car at a constant speed from s0, every dt seconds from t = 0 to `until`. */
const drive = (T: RaceTiming, key: string, v: number, s0: number, until: number, dt: number) => {
  for (let i = 0; i * dt <= until + 1e-9; i++) { const t = i * dt; T.step(key, s0 + v * t, t); }
};
/** Distance at time t along a profile of [metres, m/s] legs, from s = 0 at t = 0. */
const along = (legs: [number, number][], t: number): number => {
  let s = 0;
  for (const [len, v] of legs) { const dur = len / v; if (t <= dur) return s + v * t; s += len; t -= dur; }
  return s;
};

describe('RaceTiming', () => {
  it('counts and times laps at constant speed', () => {
    const T = new RaceTiming(1000, true);
    drive(T, 'a', 50, 0, 41, 0.1);
    expect(T.laps('a')).toBe(2);
    expect(T.last('a')).toBeCloseTo(20, 9);
    expect(T.best('a')).toBeCloseTo(20, 9);
  });

  it('interpolates a crossing between coarse steps', () => {
    const T = new RaceTiming(1000, true);
    drive(T, 'a', 50, 0, 41, 0.7);
    expect(T.last('a')).toBeCloseTo(20, 9);
  });

  it('a back-row start ends lap 1 at the line, not at the start', () => {
    const T = new RaceTiming(1000, true);
    drive(T, 'a', 50, -8, 0.1, 0.1);
    expect(T.laps('a')).toBe(0);
    drive(T, 'a', 50, -8, 20.3, 0.1);
    expect(T.laps('a')).toBe(1);
    expect(T.last('a')).toBeCloseTo(20.16, 9);
  });

  it('does not count a boundary twice when the car goes back over it', () => {
    const T = new RaceTiming(1000, true);
    T.step('a', 0, 0); T.step('a', 995, 1); T.step('a', 1005, 2); T.step('a', 995, 3); T.step('a', 1010, 4);
    expect(T.laps('a')).toBe(1);
    expect(T.last('a')).toBeCloseTo(1.5, 9);
  });

  it('splits the lap into thirds and marks sectors', () => {
    const T = new RaceTiming(900, true);
    const a: [number, number][] = [[900, 50], [300, 40], [300, 100], [300, 50]]; // lap 1: 6 s a sector; lap 2: 7.5 s, 3 s, 6 s
    const b: [number, number][] = [[300, 60], [3000, 50]]; // sector 1 in 5 s, before a's 6 s
    const run = (from: number, to: number) => { for (let t = from; t <= to + 1e-9; t += .05) { T.step('a', along(a, t), t); T.step('b', along(b, t), t); } };
    run(0, 7);
    expect(T.sectors('a')[0].time).toBeCloseTo(6, 6);
    expect(T.sectors('a')[0].mark).toBe('pb'); // a's own best, but b's 5 s is the race's
    expect(T.sectors('a')[1].mark).toBe('open');
    run(7.05, 29);
    expect(T.laps('a')).toBe(1);
    expect(T.sectors('a')[0].mark).toBe('plain'); // 7.5 s: slower than a's 6 s and b's 5 s
    expect(T.sectors('a')[1].time).toBeCloseTo(3, 6);
    expect(T.sectors('a')[1].mark).toBe('best');
    expect(T.sectors('a')[2].mark).toBe('open');
    expect(T.sectors('a')).toHaveLength(SECTORS);
  });

  it('gives the gap in seconds', () => {
    const T = new RaceTiming(1000, true);
    for (let i = 0; i <= 100; i++) { const t = i * .1; T.step('a', 50 * t, t); T.step('b', -100 + 50 * t, t); }
    expect(T.gap('b', 'a', 10)).toBeCloseTo(2, 2);
    expect(T.gap('a', 'b', 10)).toBeNull();
  });

  it("knows the race's fastest lap", () => {
    const T = new RaceTiming(1000, true);
    for (let i = 0; i <= 210; i++) { const t = i * .1; T.step('a', 50 * t, t); T.step('b', 60 * t, t); }
    expect(T.fastest()?.key).toBe('b');
    expect(T.fastest()?.time).toBeCloseTo(1000 / 60, 6);
  });

  it('a sprint has sectors but no laps', () => {
    const T = new RaceTiming(1000, false);
    drive(T, 'a', 50, 0, 21, 0.1);
    expect(T.laps('a')).toBe(0);
    expect(T.last('a')).toBeNull();
    for (const sec of T.sectors('a')) expect(sec.time).toBeCloseTo(1000 / 3 / 50, 6);
  });

  it('withTiming gives the leader no gap and the rest seconds', () => {
    const T = new RaceTiming(1000, true);
    for (let i = 0; i <= 250; i++) { const t = i * .1; T.step('a', 50 * t, t); T.step('b', -100 + 50 * t, t); T.step('c', 45 * t, t); }
    const list: Standing[] = [{ name: 'A', key: 'a', s: 1250 }, { name: 'B', key: 'b', s: 1150 }, { name: 'C', key: 'c', s: 1125 }];
    const out = withTiming(list, T, 25);
    expect(out[0].gap).toBeNull();
    expect(out[1].gap).toBeCloseTo(2, 2);
    expect(out[2].best).toBe(T.best('c'));
  });

  it('withTiming uses the finish times once both have finished', () => {
    const out = withTiming([{ name: 'A', key: 'a', ft: 100 }, { name: 'B', key: 'b', ft: 103.5 }], new RaceTiming(1000, true), 110);
    expect(out[1].gap).toBeCloseTo(3.5, 9);
  });
});
