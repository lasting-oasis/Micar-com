import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clockOffset, dropRemotes, offsetFrom, remotes, serverNow, syncClock, takePose } from './raceNet';

describe('the clock the racers share', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
  afterEach(() => { vi.useRealTimers(); });

  it('one timed round trip gives the offset: the answer is taken to come from the middle of the trip', () => {
    expect(offsetFrom(1000, 5000, 1200)).toBe(3900);
    expect(offsetFrom(0, 600_050, 100)).toBe(600_000);   // a browser clock ten minutes behind the server
    expect(offsetFrom(600_000, 50, 600_100)).toBe(-600_000); // or ten minutes ahead
  });

  it('syncClock keeps the offset of the fastest round trip', () => {
    // the server's clock is 5 s ahead. Each probe: [ms up to the server, ms for the whole trip]
    const trips = [[250, 300], [20, 40], [30, 120]];
    let k = 0;
    const socket = { emit: (ev: string, ...args: unknown[]) => {
      expect(ev).toBe('race_time');
      const [up, trip] = trips[k++], answer = args[args.length - 1] as (t: number) => void, serverAt = Date.now() + up + 5000;
      setTimeout(() => answer(serverAt), trip);
      return true;
    } };
    syncClock(socket, 3, 300);
    vi.advanceTimersByTime(310);          // the first probe is back: a lopsided 300 ms trip, 100 ms out
    expect(clockOffset()).toBe(5100);
    vi.advanceTimersByTime(2000);
    expect(k).toBe(3);
    expect(clockOffset()).toBe(5000);     // the 40 ms trip, not the 120 ms one that came later
    expect(serverNow() - Date.now()).toBe(5000);
  });

  it('a junk answer, or one from a measurement that was replaced, changes nothing', () => {
    const answers: ((t: unknown) => void)[] = [];
    const socket = { emit: (_ev: string, ...args: unknown[]) => { answers.push(args[args.length - 1] as (t: unknown) => void); return true; } };
    syncClock(socket, 1, 300); vi.advanceTimersByTime(1);
    answers[0](Date.now() + 7000);
    expect(clockOffset()).toBeCloseTo(7000, -1);
    for (const junk of [null, 'soon', NaN, Infinity, {}]) answers[0](junk);
    expect(clockOffset()).toBeCloseTo(7000, -1);
    syncClock(socket, 1, 300); vi.advanceTimersByTime(1); // a new measurement
    answers[0](Date.now() + 99_000);                     // the old probe answers late: ignored
    expect(clockOffset()).toBeCloseTo(7000, -1);
    answers[1](Date.now() + 8000);
    expect(clockOffset()).toBeCloseTo(8000, -1);
  });
});

describe('the other racers', () => {
  afterEach(() => dropRemotes());

  it('a pose from the server is kept under its sender', () => {
    takePose(['p2', 10, 1, 2, .5, 30, 100, 7], 20);
    expect([...remotes.keys()]).toEqual(['p2']);
    expect(remotes.get('p2')!.pose(20, null)).toMatchObject({ x: 1, z: 2, h: .5, v: 30, s: 100, sc: 7 });
    takePose(['p3', 10, 5, 6, 0, 0, 0, 0], 20);
    expect([...remotes.keys()]).toEqual(['p2', 'p3']);
  });
  it('anything else is ignored', () => {
    for (const junk of [null, undefined, 'x', 42, {}, [], ['p2', 10, 1, 2, .5, 30, 100], ['p2', 10, 1, 2, .5, 30, 100, 7, 8], ['p2', NaN, 1, 2, .5, 30, 100, 7],
      ['p2', 10, 1, 2, .5, 30, '100', 7], [7, 10, 1, 2, .5, 30, 100, 7], ['', 10, 1, 2, .5, 30, 100, 7], ['p2', 10, 1, 2, Infinity, 30, 100, 7]]) takePose(junk, 20);
    expect(remotes.size).toBe(0);
  });
  it('no more cars are kept than a room can hold', () => {
    for (let i = 0; i < 20; i++) takePose(['p' + i, 10, 1, 2, .5, 30, 100, 7], 20);
    expect(remotes.size).toBe(3); // a room is four people: three others
  });
  it('dropRemotes forgets them all', () => {
    takePose(['p2', 10, 1, 2, .5, 30, 100, 7], 20);
    dropRemotes();
    expect(remotes.size).toBe(0);
  });
});
