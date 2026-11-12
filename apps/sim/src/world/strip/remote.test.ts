import { describe, expect, it } from 'vitest';
import { buildRoute } from './routes';
import { RemoteCar, type Sample } from './remote';

// headings are the physics car's: forward is (sin h, cos h), so +z is 0 and +x is a quarter turn
const straight = buildRoute([[0, 0], [0, 2000]], false);                    // 2 km along +z
const square = buildRoute([[0, 0], [100, 0], [100, 100], [0, 100]], true);  // a 400 m lap: +x, +z, -x, -z
const smp = (t: number, over: Partial<Sample> = {}): Sample => ({ t, x: 0, z: 0, h: 0, v: 0, s: 0, sc: 0, ...over });
/** a car with these samples, each arriving the moment it was sent, read `delay` ms behind */
function car(delay: number, ...samples: Sample[]): RemoteCar {
  const c = new RemoteCar();
  for (const s of samples) c.push(s, s.t);
  c.delay = delay;
  return c;
}

describe('RemoteCar', () => {
  it('nothing before the first sample', () => {
    expect(new RemoteCar().pose(0, straight)).toBeNull();
  });

  it('one sample is drawn where it is', () => {
    const c = car(150, smp(1000, { x: 3, z: 7, h: 1, v: 20, s: 7, sc: 5 }));
    expect(c.pose(1500, straight)).toMatchObject({ x: 3, z: 7, h: 1, v: 20, s: 7, sc: 5 }); // one sample has no rate of progress: nothing to carry
  });

  it('between two samples it is interpolated, then carried to now', () => {
    // 5 m in 100 ms is 50 m/s. Read 100 ms back from t = 150: the recorded point at t = 50 (z 2.5), carried 100 ms on: z 7.5 = 50 m/s x 0.15 s
    const c = car(100, smp(0, { v: 48, sc: 10 }), smp(100, { z: 5, s: 5, v: 52, sc: 20 }));
    const p = c.pose(150, straight)!;
    expect(p.z).toBeCloseTo(7.5, 6); expect(p.s).toBeCloseTo(7.5, 6); expect(p.x).toBeCloseTo(0, 6);
    expect(p.v).toBeCloseTo(50, 6); expect(p.sc).toBeCloseTo(15, 6);
  });

  it('the rate of progress is capped at 90 m/s', () => {
    // 10 m in 100 ms would be 100 m/s: the recorded z 5 at t = 50 is carried 90 x 0.1 = 9 m
    const c = car(100, smp(0), smp(100, { z: 10, s: 10 }));
    const p = c.pose(150, straight)!;
    expect(p.z).toBeCloseTo(14, 6); expect(p.s).toBeCloseTo(14, 6);
  });

  it('a car at constant speed is drawn where it is now, whatever the delay', () => {
    const samples: Sample[] = [];
    for (let t = 0; t <= 1980; t += 66) samples.push(smp(t, { z: 50 * t / 1000, s: 50 * t / 1000, v: 50 }));
    for (const delay of [80, 150, 400]) {
      const c = car(delay, ...samples);
      expect(c.pose(2000, straight)!.z).toBeCloseTo(100, 3);
      expect(c.pose(2040, straight)!.z).toBeCloseTo(102, 3);
      expect(c.pose(2100, straight)!.z).toBeCloseTo(105, 3); // the newest sample is older than the delay: still carried to now
    }
  });

  it('heading turns the short way', () => {
    const c = car(50, smp(0, { h: 3.1 }), smp(100, { h: -3.1 }));
    const h = c.pose(100, null)!.h; // read at t = 50: half way between the two
    expect(Math.abs(Math.abs(h) - Math.PI)).toBeLessThan(0.05); // through pi, not back through 0
  });

  it('an older or repeated sample is ignored', () => {
    const c = new RemoteCar();
    c.push(smp(100, { z: 1 }), 100); c.push(smp(50, { z: 99 }), 100); c.push(smp(100, { z: 77 }), 100);
    expect(c.pose(100_000, null)!.z).toBe(1);
  });

  it('the delay follows the lag: up fast, down slowly, and inside its bounds', () => {
    const c = new RemoteCar();
    expect(c.delay).toBe(150);
    for (let k = 0; k < 4; k++) c.push(smp(k * 66), k * 66 + 400); // each arrives 400 ms after it was sent
    expect(c.delay).toBeGreaterThan(400);                          // 150 -> 308 -> 387 -> 426 -> 446, toward 466
    const up = c.delay;
    for (let k = 4; k < 8; k++) c.push(smp(k * 66), k * 66);       // then on time
    expect(c.delay).toBeLessThan(up); expect(c.delay).toBeGreaterThan(350); // four good samples do not undo it
    for (let k = 8; k < 300; k++) c.push(smp(k * 66), k * 66);
    expect(c.delay).toBeCloseTo(80, 0);                            // a steady good link settles at the floor
    for (let k = 300; k < 320; k++) c.push(smp(k * 66), k * 66 + 9000);
    expect(c.delay).toBeLessThanOrEqual(600);                      // a terrible link is capped
    expect(c.delay).toBeGreaterThan(590);
    const skew = new RemoteCar();
    for (let k = 0; k < 300; k++) skew.push(smp(k * 66), k * 66 - 5000); // samples "from the future": a clock that is off
    expect(skew.delay).toBeGreaterThanOrEqual(80);
  });

  it('the carry follows a bend', () => {
    // 4 m in 100 ms: 40 m/s along +x, at 90 m of the lap; the first corner is at 100 m. Carried 500 ms = 20 m: 10 m to the corner, 10 m up +z
    const quarter = Math.PI / 2;
    const c = car(500, smp(0, { x: 86, s: 86, h: quarter }), smp(100, { x: 90, s: 90, h: quarter }));
    const p = c.pose(600, square)!;
    expect(p.x).toBeCloseTo(100, 6); expect(p.z).toBeCloseTo(10, 6); expect(p.s).toBeCloseTo(110, 6);
    expect(p.h).toBeCloseTo(0, 6); // it turned with the road: now heading +z
  });

  it('the carry wraps a lap', () => {
    // on the last side (heading -z) at 395 m of 400, carried 250 ms at 40 m/s = 10 m: 5 m to the line, 5 m along the first side
    const c = car(250, smp(0, { z: 9, s: 391, h: Math.PI }), smp(100, { z: 5, s: 395, h: Math.PI }));
    const p = c.pose(350, square)!;
    expect(p.x).toBeCloseTo(5, 6); expect(p.z).toBeCloseTo(0, 6); expect(p.s).toBeCloseTo(405, 6); // progress counts on past the lap
    expect(p.h).toBeCloseTo(Math.PI / 2, 6);
  });

  it('past the end of a sprint it stops', () => {
    const c = car(500, smp(0, { z: 1991, s: 1991 }), smp(100, { z: 1995, s: 1995 }));
    const p = c.pose(600, straight)!; // 20 m of carry, 5 m of road
    expect(p.z).toBeCloseTo(2000, 6); expect(p.s).toBeCloseTo(2000, 6);
  });

  it('without a route it is carried along its heading', () => {
    const c = car(100, smp(0, { h: Math.PI / 2 }), smp(100, { x: 5, s: 5, h: Math.PI / 2 }));
    const p = c.pose(200, null)!; // 50 m/s along +x, 100 ms on from x 5
    expect(p.x).toBeCloseTo(10, 6); expect(p.z).toBeCloseTo(0, 6);
  });

  it('when poses stop the car eases to a stand', () => {
    // 50 m/s. With a delay of 150 ms the carry runs freely for 400 ms, then eases over another 500 ms at most: 900 ms, 45 m
    const c = car(150, smp(0), smp(100, { z: 5, s: 5 }));
    const z = (now: number) => c.pose(now, straight)!.z;
    const z1 = z(1100), z2 = z(2100), z5 = z(5100), z10 = z(10_100);
    expect(z1).toBeCloseTo(42.47, 1);  // 400 + 500 x (1 - e^-1.2) = 749 ms of carry
    expect(z2).toBeGreaterThan(z1); expect(z5).toBeGreaterThan(z2);
    expect(z10).toBeLessThanOrEqual(50);
    expect(z10 - z5).toBeLessThan(0.01);
  });

  it('a sample from a clock that runs ahead is not carried backwards', () => {
    const c = car(100, smp(1000, { z: 50, s: 50 }), smp(1100, { z: 55, s: 55 }));
    expect(c.pose(500, straight)!.z).toBe(50); // "now" is before both samples: the first one, as recorded
  });

  it('it keeps the newest 32 samples', () => {
    const c = new RemoteCar();
    for (let k = 0; k < 100; k++) c.push(smp(k * 66, { z: k }), k * 66);
    expect(c.pose(0, null)!.z).toBe(68); // the oldest it still has
  });
});
