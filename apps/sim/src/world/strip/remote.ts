/* Another racer's car on this screen. Its browser sends a pose about fifteen times a second; this keeps the last of
   them and answers "where is that car now": the recorded path a short moment ago (smooth, whatever the network did to
   the gaps between poses), carried forward along the route by its rate of progress, so the car is drawn where it is
   and not where it was. Pure: the clock is passed in. Units are the physics car's: metres, radians, m/s. */
import { routePoint, type Route } from './routes';

/** One pose: when (ms, on the clock the racers share), where, heading, speed, distance along the route, drift score. */
export type Sample = { t: number; x: number; z: number; h: number; v: number; s: number; sc: number };

/** how often a racer sends a pose */
export const SEND_MS = 66;
/** how far behind `now` the recorded path is read: it follows the lag that was measured, inside these bounds */
export const DELAY_MIN = 80, DELAY_MAX = 600, DELAY_START = 150;
export const KEEP = 32;
/** when poses stop, the carry runs on freely for this long past the delay, then eases out over FADE_MS */
export const STALE_MS = 250, FADE_MS = 500;
/** the most a car is taken to cover along the route, m/s (324 km/h) */
export const RATE_MAX = 90;

const clamp = (v: number, a: number, b: number): number => v < a ? a : v > b ? b : v;
/** an angle difference, the short way round */
const turn = (d: number): number => Math.atan2(Math.sin(d), Math.cos(d));

export class RemoteCar {
  delay = DELAY_START;
  private readonly buf: Sample[] = [];
  private readonly out: Sample = { t: 0, x: 0, z: 0, h: 0, v: 0, s: 0, sc: 0 };

  /** A pose that arrived at `now`. One that is not newer than the newest is dropped (packets can overtake each other). */
  push(sample: Sample, now: number): void {
    const b = this.buf;
    if (b.length && sample.t <= b[b.length - 1].t) return;
    b.push(sample);
    if (b.length > KEEP) b.shift();
    // read far enough back that the next pose has usually arrived: up at once when the link slows, down only slowly
    const target = clamp(clamp(now - sample.t, 0, 2000) + SEND_MS, DELAY_MIN, DELAY_MAX);
    this.delay += (target - this.delay) * (target > this.delay ? 0.5 : 0.05);
  }

  /** Where the car is at `now`; null before its first pose. The object returned is reused by the next call. */
  pose(now: number, route: Route | null): Sample | null {
    const b = this.buf, n = b.length;
    if (!n) return null;
    const o = this.out, first = b[0], newest = b[n - 1];
    const at = clamp(now - this.delay, first.t, newest.t);
    let rate = 0;
    if (n === 1) { o.x = first.x; o.z = first.z; o.h = first.h; o.v = first.v; o.s = first.s; o.sc = first.sc; }
    else {
      let i = n - 2;
      while (i > 0 && b[i].t > at) i--;
      const a = b[i], c = b[i + 1], gap = c.t - a.t, k = clamp((at - a.t) / gap, 0, 1);
      o.x = a.x + (c.x - a.x) * k; o.z = a.z + (c.z - a.z) * k; o.h = a.h + turn(c.h - a.h) * k;
      o.v = a.v + (c.v - a.v) * k; o.s = a.s + (c.s - a.s) * k; o.sc = a.sc + (c.sc - a.sc) * k;
      rate = clamp((c.s - a.s) / (gap / 1000), 0, RATE_MAX);
    }
    // from the recorded moment to now: freely while poses are fresh, easing to a stand once they have stopped
    const span = Math.max(0, now - at), limit = this.delay + STALE_MS;
    const carryMs = span <= limit ? span : limit + FADE_MS * (1 - Math.exp(-(span - limit) / FADE_MS));
    const ahead = rate * carryMs / 1000;
    if (ahead > 0) {
      if (route) {
        const q0 = routePoint(route, o.s), q1 = routePoint(route, o.s + ahead);
        o.x += q1.x - q0.x; o.z += q1.z - q0.z;
        o.h += turn(Math.atan2(q1.tx, q1.tz) - Math.atan2(q0.tx, q0.tz));
        o.s = route.loop ? o.s + ahead : Math.min(route.len, o.s + ahead);
      } else { o.x += Math.sin(o.h) * ahead; o.z += Math.cos(o.h) * ahead; o.s += ahead; }
    }
    o.t = now;
    return o;
  }
}
